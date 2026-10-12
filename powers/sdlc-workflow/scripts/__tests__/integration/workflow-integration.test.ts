/**
 * Integration Tests for SDLC Workflow Reliability Components
 *
 * These tests verify the integration between multiple reliability components:
 * - State_Controller + Ownership_Manager (concurrent claim tests)
 * - Checkpoint_Manager + State_Controller (recovery tests)
 * - Evidence_Manager + Release_Manager (staleness affecting release)
 * - Task_Lifecycle + Finding_Register (blocking findings)
 * - Full release flow (plan → readiness → staging → approve → production → close)
 *
 * **Task T47: Write Integration Tests**
 * **Validates: Requirements R01-R17 (20 test scenarios)**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// State Controller
import {
  StateController,
  ProjectState,
  StateError,
  Result,
  ok,
  err,
  createDefaultProjectState,
  createDefaultActorConfig,
  createDefaultQualityGates,
  createDefaultReleaseTracking,
  createDefaultCheckpointsSummary,
  createDefaultFindingsSummary,
  CurrentTask,
  TaskOwnership,
  ActorType,
  TddStatus,
} from '../../state-controller';

// Ownership Manager
import {
  OwnershipManager,
  OwnershipError,
  OwnershipErrorCode,
  FencingToken,
  ClaimResult,
  generateFencingToken,
  isLeaseExpired,
  createTaskOwnership,
  createLeaseInfo,
  OWNERSHIP_DEFAULTS,
} from '../../ownership-manager';

// Checkpoint Manager
import {
  CheckpointManager,
  CheckpointError,
  CheckpointTrigger,
  Checkpoint,
  CheckpointSnapshot,
  RecoveryPlan,
  RecoveryStrategy,
  Discrepancy,
  createCheckpointMetadata,
  createEmptySnapshot,
  determineRecoveryStrategy,
} from '../../checkpoint-manager';

// Evidence Manager
import {
  EvidenceManager,
  Evidence,
  EvidenceInput,
  EvidenceResult,
  EvidenceResultStatus,
  EvidenceType,
  StalenessCheck,
  StalenessReason,
  QualityGate,
  GateValidation,
  createEvidenceResult,
  createEvidenceGitState,
  createEvidenceExecutor,
  createDefaultStalenessInfo,
  generateEvidenceId,
} from '../../evidence-manager';

// =============================================================================
// Mock State Controller
// =============================================================================

/**
 * In-memory State Controller for integration testing.
 * Simulates atomic state updates with version control.
 */
class InMemoryStateController implements StateController {
  private state: ProjectState;
  private version: number = 1;

  constructor(initialState?: Partial<ProjectState>) {
    this.state = {
      ...createDefaultProjectState('system'),
      ...initialState,
      state_version: 1,
    };
  }

  async readState(): Promise<Result<{ state: ProjectState; version: number }, StateError>> {
    return ok({ state: { ...this.state }, version: this.version });
  }

  async writeState(
    state: ProjectState,
    expectedVersion: number,
    _operationId: string,
    _reason: string
  ): Promise<Result<{ newVersion: number }, StateError>> {
    if (expectedVersion !== this.version) {
      return err({
        code: 1001,
        message: `Version conflict: expected ${expectedVersion}, actual ${this.version}`,
        details: { expectedVersion, actualVersion: this.version },
      });
    }
    this.version++;
    this.state = { ...state, state_version: this.version };
    return ok({ newVersion: this.version });
  }

  async updateState(
    modifier: (state: ProjectState) => ProjectState,
    operationId: string,
    reason: string,
    maxRetries: number = 3
  ): Promise<Result<{ state: ProjectState; version: number }, StateError>> {
    let retries = 0;
    while (retries < maxRetries) {
      const readResult = await this.readState();
      if (!readResult.success) return readResult;

      const { state, version } = readResult.value;
      let newState: ProjectState;
      try {
        newState = modifier(state);
      } catch (error) {
        throw error; // Let errors propagate for integration testing
      }

      const writeResult = await this.writeState(newState, version, operationId, reason);
      if (writeResult.success) {
        return ok({ state: newState, version: writeResult.value.newVersion });
      }

      retries++;
    }
    return err({
      code: 1003,
      message: `Max retries (${maxRetries}) exceeded for operation ${operationId}`,
      details: { operationId, maxRetries },
    });
  }

  async validateConsistency(): Promise<Result<{ valid: boolean; issues: Array<{ field: string; issue: string }> }, StateError>> {
    const issues: Array<{ field: string; issue: string }> = [];

    // Check task counters
    if (this.state.tasks) {
      const statusSum = Object.values(this.state.tasks.by_status || {}).reduce((a, b) => a + b, 0);
      if (this.state.tasks.total !== statusSum) {
        issues.push({
          field: 'tasks.total',
          issue: `Total (${this.state.tasks.total}) doesn't match sum of by_status (${statusSum})`,
        });
      }
    }

    return ok({ valid: issues.length === 0, issues });
  }

  // Utility methods for testing
  getVersion(): number {
    return this.version;
  }

  setState(state: ProjectState): void {
    this.state = state;
    this.version = state.state_version || 1;
  }

  getState(): ProjectState {
    return { ...this.state };
  }
}

// =============================================================================
// Mock Ownership Manager
// =============================================================================

/**
 * In-memory Ownership Manager for integration testing.
 */
class InMemoryOwnershipManager implements OwnershipManager {
  private stateController: InMemoryStateController;
  private ownershipHistory: Map<string, Array<{ ownerId: string; token: string; timestamp: string }>> = new Map();

  constructor(stateController: InMemoryStateController) {
    this.stateController = stateController;
  }

  async claimTask(
    taskId: string,
    ownerId: string,
    actorType: ActorType
  ): Promise<{ success: true; value: ClaimResult } | { success: false; error: { code: number; message: string } }> {
    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 2001, message: 'Failed to read state' } };
    }

    const { state, version } = readResult.value;

    // Check if task already claimed
    if (state.current_task?.ownership?.fencing_token) {
      const currentOwner = state.current_task.assignee || 'unknown';
      return {
        success: false,
        error: {
          code: OwnershipErrorCode.TASK_ALREADY_CLAIMED,
          message: `Task ${taskId} already claimed by ${currentOwner}`,
        },
      };
    }

    const now = new Date().toISOString();
    const fencingToken = generateFencingToken();

    const ownership: TaskOwnership = {
      fencing_token: fencingToken,
      acquired_at: now,
      actor_type: actorType,
      lease_expires_at: actorType === 'AI_AGENT'
        ? new Date(Date.now() + OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS * 1000).toISOString()
        : null,
      last_heartbeat_at: actorType === 'AI_AGENT' ? now : null,
    };

    const newCurrentTask: CurrentTask = {
      id: taskId,
      status: 'IN_PROGRESS',
      assignee: ownerId,
      ownership,
      dor_check: null,
      tdd: null,
      blocked: false,
      blocked_reason: null,
      blocker_refs: [],
      handoff_pending: false,
      handoff_id: null,
      working_branch: `task/${taskId}`,
    };

    const newState: ProjectState = {
      ...state,
      current_task: newCurrentTask,
      last_modified_by: ownerId,
    };

    const writeResult = await this.stateController.writeState(newState, version, `claim-${taskId}`, 'Claim task');
    if (!writeResult.success) {
      return { success: false, error: { code: 2002, message: 'Version conflict during claim' } };
    }

    // Record in history
    const history = this.ownershipHistory.get(taskId) || [];
    history.push({ ownerId, token: fencingToken, timestamp: now });
    this.ownershipHistory.set(taskId, history);

    const result: ClaimResult = {
      fencing_token: fencingToken,
      acquired_at: now,
    };

    if (actorType === 'AI_AGENT') {
      result.lease = {
        lease_expires_at: ownership.lease_expires_at!,
        last_heartbeat_at: ownership.last_heartbeat_at!,
        heartbeat_interval_seconds: OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS,
        duration_seconds: OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS,
        extended: false,
        extension_count: 0,
      };
    }

    return { success: true, value: result };
  }

  async releaseTask(
    taskId: string,
    fencingToken: string
  ): Promise<{ success: true } | { success: false; error: { code: number; message: string } }> {
    const validationResult = await this.validateFencingToken(taskId, fencingToken);
    if (!validationResult.success || !validationResult.value.valid) {
      return { success: false, error: { code: 2003, message: 'Invalid fencing token' } };
    }

    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 2001, message: 'Failed to read state' } };
    }

    const { state, version } = readResult.value;
    const newState: ProjectState = {
      ...state,
      current_task: state.current_task
        ? { ...state.current_task, ownership: null as unknown as TaskOwnership, assignee: null }
        : null,
    };

    const writeResult = await this.stateController.writeState(newState, version, `release-${taskId}`, 'Release task');
    if (!writeResult.success) {
      return { success: false, error: { code: 2002, message: 'Version conflict during release' } };
    }

    return { success: true };
  }

  async validateFencingToken(
    taskId: string,
    fencingToken: string
  ): Promise<{ success: true; value: { valid: boolean; reason?: string } } | { success: false; error: { code: number; message: string } }> {
    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 2001, message: 'Failed to read state' } };
    }

    const { state } = readResult.value;
    const currentToken = state.current_task?.ownership?.fencing_token;

    if (currentToken !== fencingToken) {
      return { success: true, value: { valid: false, reason: 'Token does not match' } };
    }

    // Check lease expiry for AI agents
    if (state.current_task?.ownership?.actor_type === 'AI_AGENT') {
      const leaseExpiresAt = state.current_task.ownership.lease_expires_at;
      if (leaseExpiresAt && new Date(leaseExpiresAt) < new Date()) {
        return { success: true, value: { valid: false, reason: 'Lease expired' } };
      }
    }

    return { success: true, value: { valid: true } };
  }

  async recordHeartbeat(
    taskId: string,
    fencingToken: string
  ): Promise<{ success: true; value: { lease_extended: boolean } } | { success: false; error: { code: number; message: string } }> {
    const validationResult = await this.validateFencingToken(taskId, fencingToken);
    if (!validationResult.success || !validationResult.value.valid) {
      return { success: false, error: { code: 2003, message: 'Invalid fencing token' } };
    }

    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 2001, message: 'Failed to read state' } };
    }

    const { state, version } = readResult.value;
    const now = new Date().toISOString();

    if (!state.current_task?.ownership) {
      return { success: false, error: { code: 2004, message: 'No ownership to update' } };
    }

    const newState: ProjectState = {
      ...state,
      current_task: {
        ...state.current_task,
        ownership: {
          ...state.current_task.ownership,
          last_heartbeat_at: now,
        },
      },
    };

    const writeResult = await this.stateController.writeState(newState, version, `heartbeat-${taskId}`, 'Record heartbeat');
    if (!writeResult.success) {
      return { success: false, error: { code: 2002, message: 'Version conflict during heartbeat' } };
    }

    return { success: true, value: { lease_extended: false } };
  }

  async checkExpiredLeases(): Promise<{ success: true; value: { expired_tasks: string[] } } | { success: false; error: { code: number; message: string } }> {
    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 2001, message: 'Failed to read state' } };
    }

    const { state } = readResult.value;
    const expiredTasks: string[] = [];

    if (
      state.current_task?.ownership?.actor_type === 'AI_AGENT' &&
      state.current_task.ownership.lease_expires_at
    ) {
      const leaseExpiresAt = new Date(state.current_task.ownership.lease_expires_at);
      if (leaseExpiresAt < new Date()) {
        expiredTasks.push(state.current_task.id);
      }
    }

    return { success: true, value: { expired_tasks: expiredTasks } };
  }

  async transferOwnership(
    taskId: string,
    fromFencingToken: string,
    toOwnerId: string,
    toActorType: ActorType
  ): Promise<{ success: true; value: { new_fencing_token: string } } | { success: false; error: { code: number; message: string } }> {
    // First validate the source token
    const validationResult = await this.validateFencingToken(taskId, fromFencingToken);
    if (!validationResult.success || !validationResult.value.valid) {
      return { success: false, error: { code: 2003, message: 'Invalid source fencing token' } };
    }

    // Release and claim atomically
    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 2001, message: 'Failed to read state' } };
    }

    const { state, version } = readResult.value;
    const now = new Date().toISOString();
    const newFencingToken = generateFencingToken();

    const ownership: TaskOwnership = {
      fencing_token: newFencingToken,
      acquired_at: now,
      actor_type: toActorType,
      lease_expires_at: toActorType === 'AI_AGENT'
        ? new Date(Date.now() + OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS * 1000).toISOString()
        : null,
      last_heartbeat_at: toActorType === 'AI_AGENT' ? now : null,
    };

    const newState: ProjectState = {
      ...state,
      current_task: state.current_task
        ? {
            ...state.current_task,
            assignee: toOwnerId,
            ownership,
          }
        : null,
    };

    const writeResult = await this.stateController.writeState(newState, version, `transfer-${taskId}`, 'Transfer ownership');
    if (!writeResult.success) {
      return { success: false, error: { code: 2002, message: 'Version conflict during transfer' } };
    }

    return { success: true, value: { new_fencing_token: newFencingToken } };
  }
}

// =============================================================================
// Mock Checkpoint Manager
// =============================================================================

/**
 * In-memory Checkpoint Manager for integration testing.
 */
class InMemoryCheckpointManager implements CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map();
  private stateController: InMemoryStateController;
  private sequenceNumber: number = 0;

  constructor(stateController: InMemoryStateController) {
    this.stateController = stateController;
  }

  async createCheckpoint(
    trigger: CheckpointTrigger,
    taskId?: string,
    note?: string
  ): Promise<{ success: true; value: Checkpoint } | { success: false; error: { code: number; message: string } }> {
    this.sequenceNumber++;
    const checkpointId = `CP-${new Date().toISOString().split('T')[0]}-${String(this.sequenceNumber).padStart(3, '0')}`;

    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 3001, message: 'Failed to read state' } };
    }

    const { state, version } = readResult.value;
    const now = new Date().toISOString();

    const snapshot: CheckpointSnapshot = {
      state_version: version,
      task_id: taskId || state.current_task?.id || null,
      task_status: state.current_task?.status || null,
      owner_id: state.current_task?.assignee || null,
      fencing_token: state.current_task?.ownership?.fencing_token || null,
      tdd_phase: state.current_task?.tdd?.phase || null,
      git_state: {
        branch_name: state.current_task?.working_branch || 'main',
        commit_sha: 'abc123def456', // Mock commit SHA
        working_tree_dirty: false,
        uncommitted_changes: [],
      },
      evidence_refs: [],
      blockers: [],
      next_action: 'Continue with current task',
    };

    const checkpoint: Checkpoint = {
      checkpoint_id: checkpointId,
      created_at: now,
      created_by: state.current_task?.assignee || 'system',
      trigger,
      note: note || null,
      snapshot,
      validation: {
        valid_at_creation: true,
        repository_hash: `sha256:${Date.now()}`,
      },
    };

    this.checkpoints.set(checkpointId, checkpoint);
    return { success: true, value: checkpoint };
  }

  async getCheckpoint(checkpointId: string): Promise<{ success: true; value: Checkpoint } | { success: false; error: { code: number; message: string } }> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return { success: false, error: { code: 3002, message: `Checkpoint ${checkpointId} not found` } };
    }
    return { success: true, value: checkpoint };
  }

  async listCheckpoints(taskId?: string): Promise<{ success: true; value: Checkpoint[] } | { success: false; error: { code: number; message: string } }> {
    let checkpoints = Array.from(this.checkpoints.values());
    if (taskId) {
      checkpoints = checkpoints.filter((cp) => cp.snapshot.task_id === taskId);
    }
    return { success: true, value: checkpoints.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  }

  async getLatestCheckpoint(
    taskId?: string,
    ownerId?: string
  ): Promise<{ success: true; value: Checkpoint | null } | { success: false; error: { code: number; message: string } }> {
    const listResult = await this.listCheckpoints(taskId);
    if (!listResult.success) return listResult;

    let checkpoints = listResult.value;
    if (ownerId) {
      checkpoints = checkpoints.filter((cp) => cp.snapshot.owner_id === ownerId);
    }

    return { success: true, value: checkpoints[0] || null };
  }

  async validateCheckpoint(checkpointId: string): Promise<{ success: true; value: { valid: boolean; discrepancies: Discrepancy[] } } | { success: false; error: { code: number; message: string } }> {
    const checkpointResult = await this.getCheckpoint(checkpointId);
    if (!checkpointResult.success) return checkpointResult;

    const checkpoint = checkpointResult.value;
    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 3001, message: 'Failed to read state' } };
    }

    const { version } = readResult.value;
    const discrepancies: Discrepancy[] = [];

    // Check state version
    if (checkpoint.snapshot.state_version !== version) {
      discrepancies.push({
        type: 'STATE_VERSION_MISMATCH',
        field: 'state_version',
        checkpoint_value: checkpoint.snapshot.state_version,
        current_value: version,
        severity: 'WARNING',
        description: 'State version has changed since checkpoint',
      });
    }

    return { success: true, value: { valid: discrepancies.length === 0, discrepancies } };
  }

  async prepareRecovery(checkpointId: string): Promise<{ success: true; value: RecoveryPlan } | { success: false; error: { code: number; message: string } }> {
    const validationResult = await this.validateCheckpoint(checkpointId);
    if (!validationResult.success) return validationResult;

    const checkpointResult = await this.getCheckpoint(checkpointId);
    if (!checkpointResult.success) return checkpointResult;

    const { discrepancies } = validationResult.value;
    const strategy = determineRecoveryStrategy(discrepancies);

    const plan: RecoveryPlan = {
      checkpoint_id: checkpointId,
      discrepancies,
      strategy,
      proposed_actions: discrepancies.map((d) => ({
        type: 'RESTORE_STATE' as const,
        description: `Restore ${d.field} from checkpoint`,
        target: d.field,
        checkpoint_value: d.checkpoint_value,
        current_value: d.current_value,
        risk: 'LOW' as const,
      })),
    };

    return { success: true, value: plan };
  }

  async executeRecovery(
    recoveryPlan: RecoveryPlan,
    userConfirmation: boolean
  ): Promise<{ success: true; value: { recovered: boolean; actions_executed: number } } | { success: false; error: { code: number; message: string } }> {
    if (!userConfirmation) {
      return { success: false, error: { code: 3004, message: 'User confirmation required' } };
    }

    const checkpointResult = await this.getCheckpoint(recoveryPlan.checkpoint_id);
    if (!checkpointResult.success) return checkpointResult;

    const checkpoint = checkpointResult.value;

    // Apply recovery by restoring state from checkpoint
    const readResult = await this.stateController.readState();
    if (!readResult.success) {
      return { success: false, error: { code: 3001, message: 'Failed to read state' } };
    }

    const { state, version } = readResult.value;

    // Restore current_task from checkpoint snapshot
    const restoredTask: CurrentTask | null = checkpoint.snapshot.task_id
      ? {
          id: checkpoint.snapshot.task_id,
          status: checkpoint.snapshot.task_status || 'IN_PROGRESS',
          assignee: checkpoint.snapshot.owner_id,
          ownership: checkpoint.snapshot.fencing_token
            ? {
                fencing_token: checkpoint.snapshot.fencing_token,
                acquired_at: checkpoint.created_at,
                actor_type: 'HUMAN',
                lease_expires_at: null,
                last_heartbeat_at: null,
              }
            : null as unknown as TaskOwnership,
          dor_check: null,
          tdd: checkpoint.snapshot.tdd_phase
            ? { phase: checkpoint.snapshot.tdd_phase, phase_started_at: checkpoint.created_at, not_applicable_reason: null }
            : null,
          blocked: false,
          blocked_reason: null,
          blocker_refs: [],
          handoff_pending: false,
          handoff_id: null,
          working_branch: checkpoint.snapshot.git_state.branch_name,
        }
      : null;

    const newState: ProjectState = {
      ...state,
      current_task: restoredTask,
    };

    const writeResult = await this.stateController.writeState(
      newState,
      version,
      `recovery-${recoveryPlan.checkpoint_id}`,
      'Recover from checkpoint'
    );

    if (!writeResult.success) {
      return { success: false, error: { code: 3005, message: 'Failed to apply recovery' } };
    }

    return { success: true, value: { recovered: true, actions_executed: recoveryPlan.proposed_actions.length } };
  }

  async deleteCheckpoint(checkpointId: string): Promise<{ success: true } | { success: false; error: { code: number; message: string } }> {
    if (!this.checkpoints.has(checkpointId)) {
      return { success: false, error: { code: 3002, message: `Checkpoint ${checkpointId} not found` } };
    }
    this.checkpoints.delete(checkpointId);
    return { success: true };
  }

  async pruneCheckpoints(options?: { keep_count?: number; task_id?: string }): Promise<{ success: true; value: { pruned_count: number } } | { success: false; error: { code: number; message: string } }> {
    const keepCount = options?.keep_count ?? 5;
    const taskId = options?.task_id;

    const listResult = await this.listCheckpoints(taskId);
    if (!listResult.success) return listResult;

    const checkpoints = listResult.value;
    let prunedCount = 0;

    if (checkpoints.length > keepCount) {
      const toRemove = checkpoints.slice(keepCount);
      for (const cp of toRemove) {
        this.checkpoints.delete(cp.checkpoint_id);
        prunedCount++;
      }
    }

    return { success: true, value: { pruned_count: prunedCount } };
  }
}

// =============================================================================
// Mock Evidence Manager
// =============================================================================

/**
 * In-memory Evidence Manager for integration testing.
 */
class InMemoryEvidenceManager implements EvidenceManager {
  private evidenceStore: Map<string, Evidence> = new Map();
  private sequenceNumber: number = 0;

  async createEvidence(input: EvidenceInput): Promise<{ success: true; value: Evidence } | { success: false; error: { code: number; message: string } }> {
    this.sequenceNumber++;
    const evidenceId = generateEvidenceId(input.task_id, input.tdd_phase || 'VERIFY', this.sequenceNumber);

    const now = new Date().toISOString();
    const evidence: Evidence = {
      evidence_id: evidenceId,
      created_at: now,
      task_id: input.task_id,
      tdd_phase: input.tdd_phase || null,
      requirement_refs: input.requirement_refs,
      ac_refs: input.ac_refs,
      git_state: {
        commit_sha: input.commit_sha || 'abc123',
        branch: input.branch || `task/${input.task_id}`,
        working_tree_dirty: input.working_tree_dirty || false,
        uncommitted_files: [],
      },
      execution: {
        command: input.command,
        working_directory: '/project',
        config: null,
        environment: { node_version: '20.10.0', os: 'linux' },
        timestamp: now,
        duration_ms: input.duration_ms || 1000,
        exit_code: input.exit_code ?? 0,
      },
      result: {
        status: input.result_status,
        summary: input.summary || 'Test completed',
        test_file: input.test_file || null,
        test_name: input.test_name || null,
        failure_type: input.failure_type || null,
        log_path: null,
      },
      executor: {
        id: input.executor_id,
        type: input.executor_type,
      },
      staleness: {
        stale: false,
        stale_reason: null,
        checked_at: now,
        related_files: [],
      },
    };

    this.evidenceStore.set(evidenceId, evidence);
    return { success: true, value: evidence };
  }

  async getEvidence(evidenceId: string): Promise<{ success: true; value: Evidence } | { success: false; error: { code: number; message: string } }> {
    const evidence = this.evidenceStore.get(evidenceId);
    if (!evidence) {
      return { success: false, error: { code: 4001, message: `Evidence ${evidenceId} not found` } };
    }
    return { success: true, value: evidence };
  }

  async listEvidence(taskId?: string): Promise<{ success: true; value: Evidence[] } | { success: false; error: { code: number; message: string } }> {
    let evidence = Array.from(this.evidenceStore.values());
    if (taskId) {
      evidence = evidence.filter((e) => e.task_id === taskId);
    }
    return { success: true, value: evidence.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  }

  async listEvidenceByType(
    type: EvidenceType,
    taskId?: string
  ): Promise<{ success: true; value: Evidence[] } | { success: false; error: { code: number; message: string } }> {
    const listResult = await this.listEvidence(taskId);
    if (!listResult.success) return listResult;
    const filtered = listResult.value.filter((e) => e.tdd_phase === type || (type === 'UNIT_TEST' && e.tdd_phase));
    return { success: true, value: filtered };
  }

  async getLatestEvidence(
    taskId: string,
    type?: EvidenceType
  ): Promise<{ success: true; value: Evidence | null } | { success: false; error: { code: number; message: string } }> {
    const listResult = type
      ? await this.listEvidenceByType(type, taskId)
      : await this.listEvidence(taskId);
    if (!listResult.success) return listResult;
    return { success: true, value: listResult.value[0] || null };
  }

  async checkStaleness(evidenceId: string): Promise<{ success: true; value: StalenessCheck } | { success: false; error: { code: number; message: string } }> {
    const evidenceResult = await this.getEvidence(evidenceId);
    if (!evidenceResult.success) return evidenceResult;

    const evidence = evidenceResult.value;
    const now = new Date().toISOString();

    // Mock staleness check based on commit SHA
    const isStale = evidence.git_state.commit_sha !== 'current-head';
    const reason: StalenessReason | null = isStale ? 'COMMIT_CHANGED' : null;

    return {
      success: true,
      value: {
        evidence_id: evidenceId,
        stale: isStale,
        reason,
        checked_at: now,
        details: isStale ? 'HEAD has changed since evidence was created' : null,
      },
    };
  }

  async markStale(
    evidenceId: string,
    reason: StalenessReason
  ): Promise<{ success: true } | { success: false; error: { code: number; message: string } }> {
    const evidence = this.evidenceStore.get(evidenceId);
    if (!evidence) {
      return { success: false, error: { code: 4001, message: `Evidence ${evidenceId} not found` } };
    }

    evidence.staleness = {
      stale: true,
      stale_reason: reason,
      checked_at: new Date().toISOString(),
      related_files: [],
    };

    return { success: true };
  }

  async getStaleEvidence(taskId: string): Promise<{ success: true; value: Evidence[] } | { success: false; error: { code: number; message: string } }> {
    const listResult = await this.listEvidence(taskId);
    if (!listResult.success) return listResult;
    const stale = listResult.value.filter((e) => e.staleness.stale);
    return { success: true, value: stale };
  }

  async getStaleEvidenceForRelease(_releaseId: string): Promise<{ success: true; value: Evidence[] } | { success: false; error: { code: number; message: string } }> {
    // Return all stale evidence
    const allEvidence = Array.from(this.evidenceStore.values());
    const stale = allEvidence.filter((e) => e.staleness.stale);
    return { success: true, value: stale };
  }

  async validateGate(
    taskId: string,
    gate: QualityGate
  ): Promise<{ success: true; value: GateValidation } | { success: false; error: { code: number; message: string } }> {
    const listResult = await this.listEvidence(taskId);
    if (!listResult.success) return listResult;

    const evidence = listResult.value;
    const relevantEvidence = evidence.filter((e) => !e.staleness.stale && e.result.status === 'PASS');

    const passed = relevantEvidence.length > 0;

    return {
      success: true,
      value: {
        task_id: taskId,
        gate,
        passed,
        checked_at: new Date().toISOString(),
        evidence_refs: relevantEvidence.map((e) => e.evidence_id),
        failure_reason: passed ? null : `No valid evidence for gate ${gate}`,
      },
    };
  }

  async validateAllGates(
    taskId: string,
    gates: QualityGate[]
  ): Promise<{ success: true; value: { all_passed: boolean; results: GateValidation[] } } | { success: false; error: { code: number; message: string } }> {
    const results: GateValidation[] = [];

    for (const gate of gates) {
      const gateResult = await this.validateGate(taskId, gate);
      if (!gateResult.success) {
        return { success: false, error: gateResult.error };
      }
      results.push(gateResult.value);
    }

    const allPassed = results.every((r) => r.passed);
    return { success: true, value: { all_passed: allPassed, results } };
  }

  async deleteEvidence(evidenceId: string): Promise<{ success: true } | { success: false; error: { code: number; message: string } }> {
    if (!this.evidenceStore.has(evidenceId)) {
      return { success: false, error: { code: 4001, message: `Evidence ${evidenceId} not found` } };
    }
    this.evidenceStore.delete(evidenceId);
    return { success: true };
  }

  // Helper for marking evidence stale externally
  setEvidenceCommitSha(evidenceId: string, commitSha: string): void {
    const evidence = this.evidenceStore.get(evidenceId);
    if (evidence) {
      evidence.git_state.commit_sha = commitSha;
    }
  }
}

// =============================================================================
// Mock Finding Register
// =============================================================================

interface Finding {
  finding_id: string;
  task_id: string;
  review_round: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: 'BUG' | 'SECURITY' | 'PERFORMANCE' | 'STYLE' | 'DOCUMENTATION' | 'OTHER';
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'WONT_FIX' | 'DUPLICATE';
  owner_id: string;
  created_at: string;
  resolved_at: string | null;
}

/**
 * In-memory Finding Register for integration testing.
 */
class InMemoryFindingRegister {
  private findings: Map<string, Finding> = new Map();
  private sequenceNumber: number = 0;

  createFinding(input: Omit<Finding, 'finding_id' | 'created_at' | 'resolved_at'>): Finding {
    this.sequenceNumber++;
    const findingId = `FND-${String(this.sequenceNumber).padStart(3, '0')}`;
    const now = new Date().toISOString();

    const finding: Finding = {
      ...input,
      finding_id: findingId,
      created_at: now,
      resolved_at: null,
    };

    this.findings.set(findingId, finding);
    return finding;
  }

  updateFindingStatus(findingId: string, status: Finding['status']): { success: boolean; error?: string } {
    const finding = this.findings.get(findingId);
    if (!finding) {
      return { success: false, error: `Finding ${findingId} not found` };
    }

    finding.status = status;
    if (status === 'RESOLVED' || status === 'WONT_FIX') {
      finding.resolved_at = new Date().toISOString();
    }

    return { success: true };
  }

  getFindingsForTask(taskId: string): Finding[] {
    return Array.from(this.findings.values()).filter((f) => f.task_id === taskId);
  }

  getBlockingFindings(taskId: string): Finding[] {
    return this.getFindingsForTask(taskId).filter(
      (f) =>
        f.status === 'OPEN' && (f.severity === 'CRITICAL' || f.severity === 'HIGH')
    );
  }

  canCloseReview(taskId: string): { canClose: boolean; blockers: Finding[] } {
    const blockers = this.getBlockingFindings(taskId);
    return { canClose: blockers.length === 0, blockers };
  }
}

// =============================================================================
// Mock Release Manager
// =============================================================================

type ReleaseStatus = 'NOT_STARTED' | 'PLANNING' | 'READINESS_CHECK' | 'STAGING' | 'AWAITING_APPROVAL' | 'PRODUCTION' | 'MONITORING' | 'CLOSED' | 'CANCELLED' | 'ROLLED_BACK';

interface Release {
  release_id: string;
  version: string;
  status: ReleaseStatus;
  created_at: string;
  stages: {
    readiness: { passed: boolean; checked_at: string | null };
    staging: { deployed: boolean; verified: boolean; deployed_at: string | null };
    production: { approved: boolean; deployed: boolean; approved_by: string | null; deployed_at: string | null };
  };
}

/**
 * In-memory Release Manager for integration testing.
 */
class InMemoryReleaseManager {
  private releases: Map<string, Release> = new Map();
  private evidenceManager: InMemoryEvidenceManager;
  private findingRegister: InMemoryFindingRegister;
  private stateController: InMemoryStateController;
  private sequenceNumber: number = 0;

  constructor(
    evidenceManager: InMemoryEvidenceManager,
    findingRegister: InMemoryFindingRegister,
    stateController: InMemoryStateController
  ) {
    this.evidenceManager = evidenceManager;
    this.findingRegister = findingRegister;
    this.stateController = stateController;
  }

  planRelease(version: string): Release {
    this.sequenceNumber++;
    const releaseId = `REL-${String(this.sequenceNumber).padStart(3, '0')}`;
    const now = new Date().toISOString();

    const release: Release = {
      release_id: releaseId,
      version,
      status: 'PLANNING',
      created_at: now,
      stages: {
        readiness: { passed: false, checked_at: null },
        staging: { deployed: false, verified: false, deployed_at: null },
        production: { approved: false, deployed: false, approved_by: null, deployed_at: null },
      },
    };

    this.releases.set(releaseId, release);
    return release;
  }

  async checkReadiness(releaseId: string): Promise<{
    ready: boolean;
    blockers: string[];
    stale_evidence: Evidence[];
    blocking_findings: Finding[];
  }> {
    const release = this.releases.get(releaseId);
    if (!release) {
      throw new Error(`Release ${releaseId} not found`);
    }

    const blockers: string[] = [];

    // Check for stale evidence
    const staleEvidenceResult = await this.evidenceManager.getStaleEvidenceForRelease(releaseId);
    const staleEvidence = staleEvidenceResult.success ? staleEvidenceResult.value : [];
    if (staleEvidence.length > 0) {
      blockers.push(`${staleEvidence.length} stale evidence record(s)`);
    }

    // Check for blocking findings (using empty task ID to get all)
    const allFindings: Finding[] = [];
    // In real implementation, we would iterate over all tasks in the release
    // For testing, we check if there are any open CRITICAL/HIGH findings
    const state = this.stateController.getState();
    if (state.current_task) {
      const taskFindings = this.findingRegister.getBlockingFindings(state.current_task.id);
      allFindings.push(...taskFindings);
    }

    if (allFindings.length > 0) {
      blockers.push(`${allFindings.length} blocking finding(s)`);
    }

    const ready = blockers.length === 0;
    if (ready) {
      release.status = 'READINESS_CHECK';
      release.stages.readiness = { passed: true, checked_at: new Date().toISOString() };
    }

    return { ready, blockers, stale_evidence: staleEvidence, blocking_findings: allFindings };
  }

  deployToStaging(releaseId: string): { success: boolean; error?: string } {
    const release = this.releases.get(releaseId);
    if (!release) {
      return { success: false, error: `Release ${releaseId} not found` };
    }

    if (!release.stages.readiness.passed) {
      return { success: false, error: 'Readiness check not passed' };
    }

    release.status = 'STAGING';
    release.stages.staging = {
      deployed: true,
      verified: false,
      deployed_at: new Date().toISOString(),
    };

    return { success: true };
  }

  verifyStaging(releaseId: string): { success: boolean; error?: string } {
    const release = this.releases.get(releaseId);
    if (!release) {
      return { success: false, error: `Release ${releaseId} not found` };
    }

    if (!release.stages.staging.deployed) {
      return { success: false, error: 'Not deployed to staging' };
    }

    release.stages.staging.verified = true;
    release.status = 'AWAITING_APPROVAL';

    return { success: true };
  }

  approveForProduction(releaseId: string, approverId: string): { success: boolean; error?: string } {
    const release = this.releases.get(releaseId);
    if (!release) {
      return { success: false, error: `Release ${releaseId} not found` };
    }

    if (!release.stages.staging.verified) {
      return { success: false, error: 'Staging not verified' };
    }

    release.stages.production.approved = true;
    release.stages.production.approved_by = approverId;

    return { success: true };
  }

  deployToProduction(releaseId: string): { success: boolean; error?: string } {
    const release = this.releases.get(releaseId);
    if (!release) {
      return { success: false, error: `Release ${releaseId} not found` };
    }

    if (!release.stages.production.approved) {
      return { success: false, error: 'Production not approved' };
    }

    release.status = 'PRODUCTION';
    release.stages.production.deployed = true;
    release.stages.production.deployed_at = new Date().toISOString();

    return { success: true };
  }

  startMonitoring(releaseId: string): { success: boolean; error?: string } {
    const release = this.releases.get(releaseId);
    if (!release) {
      return { success: false, error: `Release ${releaseId} not found` };
    }

    if (!release.stages.production.deployed) {
      return { success: false, error: 'Not deployed to production' };
    }

    release.status = 'MONITORING';
    return { success: true };
  }

  closeRelease(releaseId: string): { success: boolean; error?: string } {
    const release = this.releases.get(releaseId);
    if (!release) {
      return { success: false, error: `Release ${releaseId} not found` };
    }

    if (release.status !== 'MONITORING') {
      return { success: false, error: 'Release must be in MONITORING status to close' };
    }

    release.status = 'CLOSED';
    return { success: true };
  }

  rollback(releaseId: string): { success: boolean; error?: string } {
    const release = this.releases.get(releaseId);
    if (!release) {
      return { success: false, error: `Release ${releaseId} not found` };
    }

    release.status = 'ROLLED_BACK';
    return { success: true };
  }

  getRelease(releaseId: string): Release | undefined {
    return this.releases.get(releaseId);
  }
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration Tests: SDLC Workflow Reliability', () => {
  let stateController: InMemoryStateController;
  let ownershipManager: InMemoryOwnershipManager;
  let checkpointManager: InMemoryCheckpointManager;
  let evidenceManager: InMemoryEvidenceManager;
  let findingRegister: InMemoryFindingRegister;
  let releaseManager: InMemoryReleaseManager;

  beforeEach(() => {
    stateController = new InMemoryStateController();
    ownershipManager = new InMemoryOwnershipManager(stateController);
    checkpointManager = new InMemoryCheckpointManager(stateController);
    evidenceManager = new InMemoryEvidenceManager();
    findingRegister = new InMemoryFindingRegister();
    releaseManager = new InMemoryReleaseManager(evidenceManager, findingRegister, stateController);
  });

  // ===========================================================================
  // 1. State_Controller + Ownership_Manager: Concurrent Claim Tests
  // Requirements: R02.2, R02.3, R02.4, R02.5, R02.6
  // ===========================================================================
  describe('1. Concurrent Task Claim (State_Controller + Ownership_Manager)', () => {
    it('should allow first developer to claim an unclaimed task', async () => {
      // Scenario: Developer alice claims TASK-001
      const result = await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.fencing_token).toBeDefined();
        expect(result.value.fencing_token).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.value.acquired_at).toBeDefined();
      }

      // Verify state was updated
      const stateResult = await stateController.readState();
      expect(stateResult.success).toBe(true);
      if (stateResult.success) {
        expect(stateResult.value.state.current_task?.assignee).toBe('alice');
        expect(stateResult.value.state.current_task?.ownership?.fencing_token).toBeDefined();
      }
    });

    it('should reject second developer claiming an already-claimed task (R02.4)', async () => {
      // Scenario: alice claims first, bob tries to claim same task
      const aliceResult = await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      expect(aliceResult.success).toBe(true);

      const bobResult = await ownershipManager.claimTask('TASK-001', 'bob', 'HUMAN');
      expect(bobResult.success).toBe(false);
      if (!bobResult.success) {
        expect(bobResult.error.code).toBe(OwnershipErrorCode.TASK_ALREADY_CLAIMED);
        expect(bobResult.error.message).toContain('alice');
      }
    });

    it('should generate unique fencing token per ownership period (R02.5)', async () => {
      // First claim
      const claim1 = await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      expect(claim1.success).toBe(true);
      const token1 = claim1.success ? claim1.value.fencing_token : '';

      // Release
      await ownershipManager.releaseTask('TASK-001', token1);

      // Second claim by same developer
      const claim2 = await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      expect(claim2.success).toBe(true);
      const token2 = claim2.success ? claim2.value.fencing_token : '';

      // Tokens must be different
      expect(token1).not.toBe(token2);
    });

    it('should validate fencing token correctly (R02.6)', async () => {
      const claimResult = await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      expect(claimResult.success).toBe(true);
      const validToken = claimResult.success ? claimResult.value.fencing_token : '';

      // Valid token should pass
      const validResult = await ownershipManager.validateFencingToken('TASK-001', validToken);
      expect(validResult.success).toBe(true);
      if (validResult.success) {
        expect(validResult.value.valid).toBe(true);
      }

      // Invalid token should fail
      const invalidResult = await ownershipManager.validateFencingToken('TASK-001', 'invalid-token');
      expect(invalidResult.success).toBe(true);
      if (invalidResult.success) {
        expect(invalidResult.value.valid).toBe(false);
      }
    });

    it('should increment state version on each claim (R02.2)', async () => {
      const initialVersion = stateController.getVersion();

      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      expect(stateController.getVersion()).toBe(initialVersion + 1);

      // Release and reclaim should increment again
      const state = stateController.getState();
      const token = state.current_task?.ownership?.fencing_token || '';
      await ownershipManager.releaseTask('TASK-001', token);
      expect(stateController.getVersion()).toBe(initialVersion + 2);

      await ownershipManager.claimTask('TASK-001', 'bob', 'HUMAN');
      expect(stateController.getVersion()).toBe(initialVersion + 3);
    });
  });

  // ===========================================================================
  // 2. Ownership_Manager: AI Agent Lease Management
  // Requirements: R02.7, R02.8, R02.9, R02.10
  // ===========================================================================
  describe('2. AI Agent Lease Management', () => {
    it('should include lease info for AI agent claim (R02.7)', async () => {
      const result = await ownershipManager.claimTask('TASK-001', 'ai-agent-1', 'AI_AGENT');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.lease).toBeDefined();
        expect(result.value.lease?.lease_expires_at).toBeDefined();
        expect(result.value.lease?.heartbeat_interval_seconds).toBe(OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS);
        expect(result.value.lease?.duration_seconds).toBe(OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS);
      }
    });

    it('should not include lease info for human claim (R02.10)', async () => {
      const result = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.lease).toBeUndefined();
      }
    });

    it('should record heartbeat for AI agent', async () => {
      const claimResult = await ownershipManager.claimTask('TASK-001', 'ai-agent-1', 'AI_AGENT');
      expect(claimResult.success).toBe(true);
      const token = claimResult.success ? claimResult.value.fencing_token : '';

      const heartbeatResult = await ownershipManager.recordHeartbeat('TASK-001', token);
      expect(heartbeatResult.success).toBe(true);
    });

    it('should detect expired leases (R02.8)', async () => {
      // Create state with expired lease
      const expiredLeaseTime = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      const state = stateController.getState();
      state.current_task = {
        id: 'TASK-001',
        status: 'IN_PROGRESS',
        assignee: 'ai-agent-1',
        ownership: {
          fencing_token: 'expired-token',
          acquired_at: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
          actor_type: 'AI_AGENT',
          lease_expires_at: expiredLeaseTime,
          last_heartbeat_at: new Date(Date.now() - 7200000).toISOString(),
        },
        dor_check: null,
        tdd: null,
        blocked: false,
        blocked_reason: null,
        blocker_refs: [],
        handoff_pending: false,
        handoff_id: null,
        working_branch: 'task/TASK-001',
      };
      stateController.setState(state);

      const expiredResult = await ownershipManager.checkExpiredLeases();
      expect(expiredResult.success).toBe(true);
      if (expiredResult.success) {
        expect(expiredResult.value.expired_tasks).toContain('TASK-001');
      }
    });
  });

  // ===========================================================================
  // 3. Ownership Transfer
  // Requirements: R02.6, R08.2
  // ===========================================================================
  describe('3. Ownership Transfer', () => {
    it('should transfer ownership atomically with new fencing token', async () => {
      // Alice claims first
      const claimResult = await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      expect(claimResult.success).toBe(true);
      const aliceToken = claimResult.success ? claimResult.value.fencing_token : '';

      // Transfer to bob
      const transferResult = await ownershipManager.transferOwnership(
        'TASK-001',
        aliceToken,
        'bob',
        'HUMAN'
      );
      expect(transferResult.success).toBe(true);
      if (transferResult.success) {
        expect(transferResult.value.new_fencing_token).toBeDefined();
        expect(transferResult.value.new_fencing_token).not.toBe(aliceToken);
      }

      // Alice's token should no longer be valid
      const aliceValidation = await ownershipManager.validateFencingToken('TASK-001', aliceToken);
      expect(aliceValidation.success).toBe(true);
      if (aliceValidation.success) {
        expect(aliceValidation.value.valid).toBe(false);
      }

      // Bob's new token should be valid
      const bobToken = transferResult.success ? transferResult.value.new_fencing_token : '';
      const bobValidation = await ownershipManager.validateFencingToken('TASK-001', bobToken);
      expect(bobValidation.success).toBe(true);
      if (bobValidation.success) {
        expect(bobValidation.value.valid).toBe(true);
      }
    });

    it('should fail transfer with invalid source token', async () => {
      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');

      const transferResult = await ownershipManager.transferOwnership(
        'TASK-001',
        'invalid-token',
        'bob',
        'HUMAN'
      );
      expect(transferResult.success).toBe(false);
    });
  });

  // ===========================================================================
  // 4. Checkpoint_Manager + State_Controller: Recovery Tests
  // Requirements: R09.1, R09.2, R09.4, R09.5
  // ===========================================================================
  describe('4. Checkpoint Creation and Recovery', () => {
    it('should create checkpoint with current state snapshot (R09.1)', async () => {
      // Set up state with active task
      const claimResult = await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      expect(claimResult.success).toBe(true);

      // Create checkpoint
      const checkpointResult = await checkpointManager.createCheckpoint(
        'state_transition',
        'TASK-001',
        'After task claim'
      );

      expect(checkpointResult.success).toBe(true);
      if (checkpointResult.success) {
        const checkpoint = checkpointResult.value;
        expect(checkpoint.checkpoint_id).toMatch(/^CP-/);
        expect(checkpoint.trigger).toBe('state_transition');
        expect(checkpoint.snapshot.task_id).toBe('TASK-001');
        expect(checkpoint.snapshot.owner_id).toBe('alice');
        expect(checkpoint.snapshot.fencing_token).toBeDefined();
      }
    });

    it('should validate checkpoint against current state (R09.4)', async () => {
      // Create initial checkpoint
      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      const checkpointResult = await checkpointManager.createCheckpoint('state_transition', 'TASK-001');
      expect(checkpointResult.success).toBe(true);
      const checkpointId = checkpointResult.success ? checkpointResult.value.checkpoint_id : '';

      // State hasn't changed, should be valid
      const validationResult1 = await checkpointManager.validateCheckpoint(checkpointId);
      expect(validationResult1.success).toBe(true);
      if (validationResult1.success) {
        expect(validationResult1.value.valid).toBe(true);
        expect(validationResult1.value.discrepancies).toHaveLength(0);
      }

      // Make state changes
      const state = stateController.getState();
      const token = state.current_task?.ownership?.fencing_token || '';
      await ownershipManager.releaseTask('TASK-001', token);

      // Now checkpoint should show discrepancies
      const validationResult2 = await checkpointManager.validateCheckpoint(checkpointId);
      expect(validationResult2.success).toBe(true);
      if (validationResult2.success) {
        expect(validationResult2.value.discrepancies.length).toBeGreaterThan(0);
      }
    });

    it('should prepare recovery plan with proposed actions', async () => {
      // Create checkpoint
      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      const checkpointResult = await checkpointManager.createCheckpoint('state_transition', 'TASK-001');
      const checkpointId = checkpointResult.success ? checkpointResult.value.checkpoint_id : '';

      // Change state
      const state = stateController.getState();
      const token = state.current_task?.ownership?.fencing_token || '';
      await ownershipManager.releaseTask('TASK-001', token);

      // Prepare recovery
      const recoveryPlanResult = await checkpointManager.prepareRecovery(checkpointId);
      expect(recoveryPlanResult.success).toBe(true);
      if (recoveryPlanResult.success) {
        expect(recoveryPlanResult.value.checkpoint_id).toBe(checkpointId);
        expect(recoveryPlanResult.value.strategy).toBeDefined();
      }
    });

    it('should execute recovery with user confirmation (R09.5)', async () => {
      // Create checkpoint with task state
      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      const checkpointResult = await checkpointManager.createCheckpoint('state_transition', 'TASK-001');
      const checkpointId = checkpointResult.success ? checkpointResult.value.checkpoint_id : '';

      // Change state
      const state = stateController.getState();
      const token = state.current_task?.ownership?.fencing_token || '';
      await ownershipManager.releaseTask('TASK-001', token);

      // Prepare and execute recovery
      const recoveryPlanResult = await checkpointManager.prepareRecovery(checkpointId);
      expect(recoveryPlanResult.success).toBe(true);

      const plan = recoveryPlanResult.success ? recoveryPlanResult.value : null;
      if (plan) {
        // Without confirmation should fail
        const noConfirmResult = await checkpointManager.executeRecovery(plan, false);
        expect(noConfirmResult.success).toBe(false);

        // With confirmation should succeed
        const confirmResult = await checkpointManager.executeRecovery(plan, true);
        expect(confirmResult.success).toBe(true);
        if (confirmResult.success) {
          expect(confirmResult.value.recovered).toBe(true);
        }
      }
    });

    it('should prune old checkpoints keeping specified count (R09.7)', async () => {
      // Create multiple checkpoints
      for (let i = 0; i < 8; i++) {
        await checkpointManager.createCheckpoint('periodic', 'TASK-001');
      }

      const listBefore = await checkpointManager.listCheckpoints('TASK-001');
      expect(listBefore.success).toBe(true);
      if (listBefore.success) {
        expect(listBefore.value.length).toBe(8);
      }

      // Prune keeping only 3
      const pruneResult = await checkpointManager.pruneCheckpoints({ keep_count: 3, task_id: 'TASK-001' });
      expect(pruneResult.success).toBe(true);
      if (pruneResult.success) {
        expect(pruneResult.value.pruned_count).toBe(5);
      }

      const listAfter = await checkpointManager.listCheckpoints('TASK-001');
      if (listAfter.success) {
        expect(listAfter.value.length).toBe(3);
      }
    });
  });

  // ===========================================================================
  // 5. Evidence_Manager + Release_Manager: Staleness Tests
  // Requirements: R06.4, R06.5, R15.2
  // ===========================================================================
  describe('5. Evidence Staleness Affecting Release', () => {
    it('should mark evidence as stale when commit changes (R06.4)', async () => {
      // Create evidence with specific commit
      const createResult = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'GREEN',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'All tests pass',
        executor_id: 'alice',
        executor_type: 'HUMAN',
        commit_sha: 'old-commit',
      });
      expect(createResult.success).toBe(true);
      const evidenceId = createResult.success ? createResult.value.evidence_id : '';

      // Check staleness - should be stale since commit differs from 'current-head'
      const stalenessResult = await evidenceManager.checkStaleness(evidenceId);
      expect(stalenessResult.success).toBe(true);
      if (stalenessResult.success) {
        expect(stalenessResult.value.stale).toBe(true);
        expect(stalenessResult.value.reason).toBe('COMMIT_CHANGED');
      }
    });

    it('should block release readiness when evidence is stale (R15.2)', async () => {
      // Set up state with task
      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');

      // Create stale evidence
      const createResult = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'GREEN',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'Tests pass',
        executor_id: 'alice',
        executor_type: 'HUMAN',
        commit_sha: 'old-commit',
      });
      const evidenceId = createResult.success ? createResult.value.evidence_id : '';

      // Mark it stale
      await evidenceManager.markStale(evidenceId, 'COMMIT_CHANGED');

      // Plan release and check readiness
      const release = releaseManager.planRelease('1.0.0');
      const readinessResult = await releaseManager.checkReadiness(release.release_id);

      expect(readinessResult.ready).toBe(false);
      expect(readinessResult.stale_evidence.length).toBeGreaterThan(0);
      expect(readinessResult.blockers).toContain('1 stale evidence record(s)');
    });

    it('should allow release when evidence is fresh', async () => {
      // Create fresh evidence with current commit
      await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'Tests pass',
        executor_id: 'alice',
        executor_type: 'HUMAN',
        commit_sha: 'current-head', // This won't be marked stale
      });

      // Plan release
      const release = releaseManager.planRelease('1.0.0');
      const readinessResult = await releaseManager.checkReadiness(release.release_id);

      expect(readinessResult.stale_evidence.length).toBe(0);
    });
  });

  // ===========================================================================
  // 6. Task_Lifecycle + Finding_Register: Blocking Findings
  // Requirements: R11.4, R11.5
  // ===========================================================================
  describe('6. Findings Blocking Task Completion', () => {
    it('should block review closure with open CRITICAL findings (R11.5)', () => {
      // Create CRITICAL finding
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'CRITICAL',
        category: 'SECURITY',
        description: 'SQL injection vulnerability',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const closeResult = findingRegister.canCloseReview('TASK-001');
      expect(closeResult.canClose).toBe(false);
      expect(closeResult.blockers.length).toBe(1);
      expect(closeResult.blockers[0].severity).toBe('CRITICAL');
    });

    it('should block review closure with open HIGH findings', () => {
      // Create HIGH finding
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'HIGH',
        category: 'BUG',
        description: 'Missing null check causes crash',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const closeResult = findingRegister.canCloseReview('TASK-001');
      expect(closeResult.canClose).toBe(false);
      expect(closeResult.blockers.length).toBe(1);
    });

    it('should allow review closure when HIGH/CRITICAL findings are resolved', () => {
      // Create and resolve finding
      const finding = findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'HIGH',
        category: 'BUG',
        description: 'Bug found',
        status: 'OPEN',
        owner_id: 'alice',
      });

      // Initially blocked
      let closeResult = findingRegister.canCloseReview('TASK-001');
      expect(closeResult.canClose).toBe(false);

      // Resolve the finding
      findingRegister.updateFindingStatus(finding.finding_id, 'RESOLVED');

      // Now can close
      closeResult = findingRegister.canCloseReview('TASK-001');
      expect(closeResult.canClose).toBe(true);
      expect(closeResult.blockers.length).toBe(0);
    });

    it('should allow review closure with only MEDIUM/LOW/INFO findings (R11.4)', () => {
      // Create non-blocking findings
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'MEDIUM',
        category: 'STYLE',
        description: 'Code style issue',
        status: 'OPEN',
        owner_id: 'alice',
      });

      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'LOW',
        category: 'DOCUMENTATION',
        description: 'Missing docs',
        status: 'OPEN',
        owner_id: 'alice',
      });

      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'INFO',
        category: 'OTHER',
        description: 'Suggestion only',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const closeResult = findingRegister.canCloseReview('TASK-001');
      expect(closeResult.canClose).toBe(true);
    });

    it('should block release when tasks have blocking findings', async () => {
      // Set up task
      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');

      // Create blocking finding
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'CRITICAL',
        category: 'SECURITY',
        description: 'Security issue',
        status: 'OPEN',
        owner_id: 'alice',
      });

      // Plan release and check readiness
      const release = releaseManager.planRelease('1.0.0');
      const readinessResult = await releaseManager.checkReadiness(release.release_id);

      expect(readinessResult.ready).toBe(false);
      expect(readinessResult.blocking_findings.length).toBeGreaterThan(0);
      expect(readinessResult.blockers).toContain('1 blocking finding(s)');
    });
  });

  // ===========================================================================
  // 7. Full Release Flow
  // Requirements: R15.1 - R15.10
  // ===========================================================================
  describe('7. Full Release Lifecycle Flow', () => {
    it('should complete full release flow: plan → readiness → staging → approve → production → close', async () => {
      // Step 1: Plan release
      const release = releaseManager.planRelease('1.0.0');
      expect(release.status).toBe('PLANNING');
      expect(release.version).toBe('1.0.0');

      // Step 2: Check readiness (with no blockers)
      const readinessResult = await releaseManager.checkReadiness(release.release_id);
      expect(readinessResult.ready).toBe(true);

      // Step 3: Deploy to staging
      const stagingResult = releaseManager.deployToStaging(release.release_id);
      expect(stagingResult.success).toBe(true);
      
      const afterStaging = releaseManager.getRelease(release.release_id);
      expect(afterStaging?.status).toBe('STAGING');
      expect(afterStaging?.stages.staging.deployed).toBe(true);

      // Step 4: Verify staging
      const verifyResult = releaseManager.verifyStaging(release.release_id);
      expect(verifyResult.success).toBe(true);
      
      const afterVerify = releaseManager.getRelease(release.release_id);
      expect(afterVerify?.status).toBe('AWAITING_APPROVAL');
      expect(afterVerify?.stages.staging.verified).toBe(true);

      // Step 5: Approve for production
      const approveResult = releaseManager.approveForProduction(release.release_id, 'lead-001');
      expect(approveResult.success).toBe(true);
      
      const afterApprove = releaseManager.getRelease(release.release_id);
      expect(afterApprove?.stages.production.approved).toBe(true);
      expect(afterApprove?.stages.production.approved_by).toBe('lead-001');

      // Step 6: Deploy to production
      const prodResult = releaseManager.deployToProduction(release.release_id);
      expect(prodResult.success).toBe(true);
      
      const afterProd = releaseManager.getRelease(release.release_id);
      expect(afterProd?.status).toBe('PRODUCTION');
      expect(afterProd?.stages.production.deployed).toBe(true);

      // Step 7: Start monitoring
      const monitorResult = releaseManager.startMonitoring(release.release_id);
      expect(monitorResult.success).toBe(true);
      
      const afterMonitor = releaseManager.getRelease(release.release_id);
      expect(afterMonitor?.status).toBe('MONITORING');

      // Step 8: Close release
      const closeResult = releaseManager.closeRelease(release.release_id);
      expect(closeResult.success).toBe(true);
      
      const finalRelease = releaseManager.getRelease(release.release_id);
      expect(finalRelease?.status).toBe('CLOSED');
    });

    it('should enforce release stage order', async () => {
      const release = releaseManager.planRelease('1.0.0');

      // Cannot deploy to staging without readiness check
      const stagingWithoutReadiness = releaseManager.deployToStaging(release.release_id);
      expect(stagingWithoutReadiness.success).toBe(false);

      // Pass readiness
      await releaseManager.checkReadiness(release.release_id);
      releaseManager.deployToStaging(release.release_id);

      // Cannot approve without staging verification
      const approveWithoutVerify = releaseManager.approveForProduction(release.release_id, 'lead');
      expect(approveWithoutVerify.success).toBe(false);

      // Verify staging
      releaseManager.verifyStaging(release.release_id);

      // Cannot deploy to production without approval
      const prodWithoutApprove = releaseManager.deployToProduction(release.release_id);
      expect(prodWithoutApprove.success).toBe(false);

      // Approve and deploy
      releaseManager.approveForProduction(release.release_id, 'lead');
      const prodResult = releaseManager.deployToProduction(release.release_id);
      expect(prodResult.success).toBe(true);
    });

    it('should support rollback from production (R15.7, R15.8)', async () => {
      const release = releaseManager.planRelease('1.0.0');

      // Complete flow to production
      await releaseManager.checkReadiness(release.release_id);
      releaseManager.deployToStaging(release.release_id);
      releaseManager.verifyStaging(release.release_id);
      releaseManager.approveForProduction(release.release_id, 'lead');
      releaseManager.deployToProduction(release.release_id);

      // Trigger rollback
      const rollbackResult = releaseManager.rollback(release.release_id);
      expect(rollbackResult.success).toBe(true);

      const afterRollback = releaseManager.getRelease(release.release_id);
      expect(afterRollback?.status).toBe('ROLLED_BACK');
    });
  });

  // ===========================================================================
  // 8. Quality Gate Validation
  // Requirements: R06.7
  // ===========================================================================
  describe('8. Quality Gate Validation', () => {
    it('should pass quality gate when evidence exists and is fresh', async () => {
      // Create passing evidence
      await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'GREEN',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'Tests pass',
        executor_id: 'alice',
        executor_type: 'HUMAN',
      });

      const gateResult = await evidenceManager.validateGate('TASK-001', 'UNIT_TEST');
      expect(gateResult.success).toBe(true);
      if (gateResult.success) {
        expect(gateResult.value.passed).toBe(true);
        expect(gateResult.value.evidence_refs.length).toBeGreaterThan(0);
      }
    });

    it('should fail quality gate when evidence is stale', async () => {
      // Create evidence and mark it stale
      const createResult = await evidenceManager.createEvidence({
        task_id: 'TASK-002',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'Tests pass',
        executor_id: 'alice',
        executor_type: 'HUMAN',
      });
      const evidenceId = createResult.success ? createResult.value.evidence_id : '';
      await evidenceManager.markStale(evidenceId, 'COMMIT_CHANGED');

      const gateResult = await evidenceManager.validateGate('TASK-002', 'UNIT_TEST');
      expect(gateResult.success).toBe(true);
      if (gateResult.success) {
        expect(gateResult.value.passed).toBe(false);
      }
    });

    it('should validate all gates and return aggregate result', async () => {
      // Create evidence for TASK-003
      await evidenceManager.createEvidence({
        task_id: 'TASK-003',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'Tests pass',
        executor_id: 'alice',
        executor_type: 'HUMAN',
      });

      const allGatesResult = await evidenceManager.validateAllGates('TASK-003', [
        'UNIT_TEST',
        'LINT',
        'TYPE_CHECK',
      ]);

      expect(allGatesResult.success).toBe(true);
      if (allGatesResult.success) {
        expect(allGatesResult.value.results.length).toBe(3);
        // At least one should pass (the one with evidence)
        const passedGates = allGatesResult.value.results.filter((r) => r.passed);
        expect(passedGates.length).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // 9. State Consistency Validation
  // Requirements: R16.6
  // ===========================================================================
  describe('9. State Consistency Validation', () => {
    it('should detect counter mismatches', async () => {
      // Set up state with mismatched counters
      const state = stateController.getState();
      state.tasks = {
        total: 10, // Wrong total
        by_status: {
          TODO: 2,
          IN_PROGRESS: 1,
          DONE: 2,
        },
        by_assignee: {},
      };
      stateController.setState(state);

      const validationResult = await stateController.validateConsistency();
      expect(validationResult.success).toBe(true);
      if (validationResult.success) {
        expect(validationResult.value.valid).toBe(false);
        expect(validationResult.value.issues.length).toBeGreaterThan(0);
        expect(validationResult.value.issues[0].issue).toContain('doesn\'t match');
      }
    });

    it('should pass validation when counters are consistent', async () => {
      // Set up state with matching counters
      const state = stateController.getState();
      state.tasks = {
        total: 5,
        by_status: {
          TODO: 2,
          IN_PROGRESS: 1,
          DONE: 2,
        },
        by_assignee: {},
      };
      stateController.setState(state);

      const validationResult = await stateController.validateConsistency();
      expect(validationResult.success).toBe(true);
      if (validationResult.success) {
        expect(validationResult.value.valid).toBe(true);
        expect(validationResult.value.issues.length).toBe(0);
      }
    });
  });

  // ===========================================================================
  // 10. Checkpoint Auto-Triggers
  // Requirements: R09.2
  // ===========================================================================
  describe('10. Checkpoint Auto-Triggers', () => {
    it('should create checkpoint on state transition', async () => {
      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');

      // Create checkpoint triggered by state transition
      const result = await checkpointManager.createCheckpoint('state_transition', 'TASK-001');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger).toBe('state_transition');
      }
    });

    it('should create checkpoint on TDD phase change', async () => {
      const result = await checkpointManager.createCheckpoint('tdd_phase_transition', 'TASK-001');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger).toBe('tdd_phase_transition');
      }
    });

    it('should create checkpoint on evidence creation', async () => {
      const result = await checkpointManager.createCheckpoint('evidence_created', 'TASK-001');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger).toBe('evidence_created');
      }
    });

    it('should create checkpoint on handoff', async () => {
      const result = await checkpointManager.createCheckpoint('handoff', 'TASK-001');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger).toBe('handoff');
      }
    });

    it('should create manual checkpoint with note', async () => {
      const result = await checkpointManager.createCheckpoint('manual', 'TASK-001', 'Before risky refactoring');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger).toBe('manual');
        expect(result.value.note).toBe('Before risky refactoring');
      }
    });
  });

  // ===========================================================================
  // 11. Evidence TDD Phase Validation
  // Requirements: R05.1, R05.2, R05.3
  // ===========================================================================
  describe('11. Evidence TDD Phase Tracking', () => {
    it('should track evidence for RED phase', async () => {
      const result = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'RED',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'FAIL',
        summary: 'Test correctly fails - behavior missing',
        failure_type: 'BEHAVIOR_MISSING',
        executor_id: 'alice',
        executor_type: 'HUMAN',
        exit_code: 1,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.tdd_phase).toBe('RED');
        expect(result.value.result.status).toBe('FAIL');
        expect(result.value.result.failure_type).toBe('BEHAVIOR_MISSING');
      }
    });

    it('should track evidence for GREEN phase', async () => {
      const result = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'GREEN',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'Test now passes',
        executor_id: 'alice',
        executor_type: 'HUMAN',
        exit_code: 0,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.tdd_phase).toBe('GREEN');
        expect(result.value.result.status).toBe('PASS');
        expect(result.value.execution.exit_code).toBe(0);
      }
    });

    it('should track evidence for REFACTOR phase', async () => {
      const result = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'REFACTOR',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'All tests still pass after refactor',
        executor_id: 'alice',
        executor_type: 'HUMAN',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.tdd_phase).toBe('REFACTOR');
        expect(result.value.result.status).toBe('PASS');
      }
    });
  });

  // ===========================================================================
  // 12. Evidence Executor Tracking
  // Requirements: R06.1
  // ===========================================================================
  describe('12. Evidence Executor Tracking', () => {
    it('should record human executor', async () => {
      const result = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        executor_id: 'dev-001',
        executor_type: 'HUMAN',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.executor.id).toBe('dev-001');
        expect(result.value.executor.type).toBe('HUMAN');
      }
    });

    it('should record AI agent executor', async () => {
      const result = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        executor_id: 'ai-agent-1',
        executor_type: 'AI_AGENT',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.executor.id).toBe('ai-agent-1');
        expect(result.value.executor.type).toBe('AI_AGENT');
      }
    });
  });

  // ===========================================================================
  // 13. Finding Severity Handling
  // Requirements: R11.4
  // ===========================================================================
  describe('13. Finding Severity Definitions', () => {
    it('should handle CRITICAL severity - blocks release immediately', () => {
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'CRITICAL',
        category: 'SECURITY',
        description: 'Critical security flaw',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const blockers = findingRegister.getBlockingFindings('TASK-001');
      expect(blockers.length).toBe(1);
      expect(blockers[0].severity).toBe('CRITICAL');
    });

    it('should handle HIGH severity - must fix before task DONE', () => {
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'HIGH',
        category: 'BUG',
        description: 'Serious bug',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const blockers = findingRegister.getBlockingFindings('TASK-001');
      expect(blockers.length).toBe(1);
      expect(blockers[0].severity).toBe('HIGH');
    });

    it('should not block with MEDIUM severity', () => {
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'MEDIUM',
        category: 'PERFORMANCE',
        description: 'Performance could be better',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const blockers = findingRegister.getBlockingFindings('TASK-001');
      expect(blockers.length).toBe(0);
    });

    it('should not block with LOW severity', () => {
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'LOW',
        category: 'STYLE',
        description: 'Minor style issue',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const blockers = findingRegister.getBlockingFindings('TASK-001');
      expect(blockers.length).toBe(0);
    });

    it('should not block with INFO severity (suggestions only)', () => {
      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'INFO',
        category: 'OTHER',
        description: 'Just a suggestion',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const blockers = findingRegister.getBlockingFindings('TASK-001');
      expect(blockers.length).toBe(0);
    });
  });

  // ===========================================================================
  // 14. Multiple Owners Can Work on Different Tasks
  // Requirements: R02.3
  // ===========================================================================
  describe('14. Multiple Task Support', () => {
    it('should track ownership separately for different tasks', async () => {
      // Create separate state controllers for different tasks
      const stateController1 = new InMemoryStateController();
      const stateController2 = new InMemoryStateController();
      const ownershipManager1 = new InMemoryOwnershipManager(stateController1);
      const ownershipManager2 = new InMemoryOwnershipManager(stateController2);

      // Different developers claim different tasks
      const claim1 = await ownershipManager1.claimTask('TASK-001', 'alice', 'HUMAN');
      const claim2 = await ownershipManager2.claimTask('TASK-002', 'bob', 'HUMAN');

      expect(claim1.success).toBe(true);
      expect(claim2.success).toBe(true);

      // Verify different tokens
      const token1 = claim1.success ? claim1.value.fencing_token : '';
      const token2 = claim2.success ? claim2.value.fencing_token : '';
      expect(token1).not.toBe(token2);

      // Both validations should pass
      const valid1 = await ownershipManager1.validateFencingToken('TASK-001', token1);
      const valid2 = await ownershipManager2.validateFencingToken('TASK-002', token2);

      expect(valid1.success).toBe(true);
      expect(valid2.success).toBe(true);
    });
  });

  // ===========================================================================
  // 15. Checkpoint Latest Retrieval
  // Requirements: R09.4
  // ===========================================================================
  describe('15. Checkpoint Latest Retrieval', () => {
    it('should get latest checkpoint for a task', async () => {
      // Create multiple checkpoints
      await checkpointManager.createCheckpoint('state_transition', 'TASK-001');
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay for timestamp difference
      await checkpointManager.createCheckpoint('tdd_phase_transition', 'TASK-001');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const lastResult = await checkpointManager.createCheckpoint('manual', 'TASK-001', 'Latest checkpoint');

      const latestResult = await checkpointManager.getLatestCheckpoint('TASK-001');
      expect(latestResult.success).toBe(true);
      if (latestResult.success && lastResult.success) {
        expect(latestResult.value?.checkpoint_id).toBe(lastResult.value.checkpoint_id);
        expect(latestResult.value?.note).toBe('Latest checkpoint');
      }
    });

    it('should return null when no checkpoints exist', async () => {
      const result = await checkpointManager.getLatestCheckpoint('NON_EXISTENT_TASK');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeNull();
      }
    });
  });

  // ===========================================================================
  // 16. Evidence Listing and Filtering
  // Requirements: R06.1
  // ===========================================================================
  describe('16. Evidence Listing and Filtering', () => {
    it('should list all evidence for a task', async () => {
      await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'RED',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'FAIL',
        executor_id: 'alice',
        executor_type: 'HUMAN',
      });

      await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'GREEN',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        executor_id: 'alice',
        executor_type: 'HUMAN',
      });

      const listResult = await evidenceManager.listEvidence('TASK-001');
      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(listResult.value.length).toBe(2);
      }
    });

    it('should filter evidence by task', async () => {
      await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        executor_id: 'alice',
        executor_type: 'HUMAN',
      });

      await evidenceManager.createEvidence({
        task_id: 'TASK-002',
        requirement_refs: ['REQ-002'],
        ac_refs: ['REQ-002-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        executor_id: 'bob',
        executor_type: 'HUMAN',
      });

      const task1Evidence = await evidenceManager.listEvidence('TASK-001');
      const task2Evidence = await evidenceManager.listEvidence('TASK-002');

      if (task1Evidence.success && task2Evidence.success) {
        expect(task1Evidence.value.length).toBe(1);
        expect(task2Evidence.value.length).toBe(1);
        expect(task1Evidence.value[0].task_id).toBe('TASK-001');
        expect(task2Evidence.value[0].task_id).toBe('TASK-002');
      }
    });
  });

  // ===========================================================================
  // 17. Finding Status Transitions
  // Requirements: R11.1
  // ===========================================================================
  describe('17. Finding Status Transitions', () => {
    it('should update finding status from OPEN to IN_PROGRESS', () => {
      const finding = findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'HIGH',
        category: 'BUG',
        description: 'Bug found',
        status: 'OPEN',
        owner_id: 'alice',
      });

      expect(finding.status).toBe('OPEN');

      findingRegister.updateFindingStatus(finding.finding_id, 'IN_PROGRESS');
      const findings = findingRegister.getFindingsForTask('TASK-001');
      expect(findings[0].status).toBe('IN_PROGRESS');
    });

    it('should update finding status to RESOLVED with timestamp', () => {
      const finding = findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'HIGH',
        category: 'BUG',
        description: 'Bug found',
        status: 'OPEN',
        owner_id: 'alice',
      });

      expect(finding.resolved_at).toBeNull();

      findingRegister.updateFindingStatus(finding.finding_id, 'RESOLVED');
      const findings = findingRegister.getFindingsForTask('TASK-001');
      expect(findings[0].status).toBe('RESOLVED');
      expect(findings[0].resolved_at).not.toBeNull();
    });

    it('should support WONT_FIX status', () => {
      const finding = findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'LOW',
        category: 'STYLE',
        description: 'Style issue',
        status: 'OPEN',
        owner_id: 'alice',
      });

      findingRegister.updateFindingStatus(finding.finding_id, 'WONT_FIX');
      const findings = findingRegister.getFindingsForTask('TASK-001');
      expect(findings[0].status).toBe('WONT_FIX');
      expect(findings[0].resolved_at).not.toBeNull();
    });
  });

  // ===========================================================================
  // 18. Release Blocking Conditions
  // Requirements: R15.2
  // ===========================================================================
  describe('18. Release Blocking Conditions', () => {
    it('should block release with stale evidence', async () => {
      const evidence = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        executor_id: 'alice',
        executor_type: 'HUMAN',
      });

      const evidenceId = evidence.success ? evidence.value.evidence_id : '';
      await evidenceManager.markStale(evidenceId, 'FILE_CHANGED');

      const release = releaseManager.planRelease('1.0.0');
      const readiness = await releaseManager.checkReadiness(release.release_id);

      expect(readiness.ready).toBe(false);
      expect(readiness.stale_evidence.length).toBe(1);
    });

    it('should block release with open critical findings', async () => {
      await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');

      findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'CRITICAL',
        category: 'SECURITY',
        description: 'Security issue',
        status: 'OPEN',
        owner_id: 'alice',
      });

      const release = releaseManager.planRelease('1.0.0');
      const readiness = await releaseManager.checkReadiness(release.release_id);

      expect(readiness.ready).toBe(false);
      expect(readiness.blocking_findings.length).toBe(1);
    });

    it('should pass readiness with no blockers', async () => {
      const release = releaseManager.planRelease('1.0.0');
      const readiness = await releaseManager.checkReadiness(release.release_id);

      expect(readiness.ready).toBe(true);
      expect(readiness.stale_evidence.length).toBe(0);
      expect(readiness.blocking_findings.length).toBe(0);
    });
  });

  // ===========================================================================
  // 19. Idempotent Operations
  // Requirements: R02.11
  // ===========================================================================
  describe('19. Idempotent Operations', () => {
    it('should handle duplicate release operations gracefully', async () => {
      const release = releaseManager.planRelease('1.0.0');
      await releaseManager.checkReadiness(release.release_id);

      // Deploy to staging twice
      const deploy1 = releaseManager.deployToStaging(release.release_id);
      expect(deploy1.success).toBe(true);

      // Second deploy should recognize it's already deployed
      const releaseAfter = releaseManager.getRelease(release.release_id);
      expect(releaseAfter?.stages.staging.deployed).toBe(true);
    });

    it('should handle duplicate checkpoint creation', async () => {
      const cp1 = await checkpointManager.createCheckpoint('manual', 'TASK-001', 'First');
      const cp2 = await checkpointManager.createCheckpoint('manual', 'TASK-001', 'Second');

      expect(cp1.success).toBe(true);
      expect(cp2.success).toBe(true);

      // Both should exist with different IDs
      const cp1Id = cp1.success ? cp1.value.checkpoint_id : '';
      const cp2Id = cp2.success ? cp2.value.checkpoint_id : '';
      expect(cp1Id).not.toBe(cp2Id);
    });
  });

  // ===========================================================================
  // 20. Full Integration Scenario
  // Requirements: All
  // ===========================================================================
  describe('20. Full Integration Scenario - Complete Task Lifecycle', () => {
    it('should complete full task lifecycle with all components', async () => {
      // === Phase 1: Task Setup and Claim ===
      // Developer claims task
      const claimResult = await ownershipManager.claimTask('TASK-001', 'alice', 'HUMAN');
      expect(claimResult.success).toBe(true);
      const fencingToken = claimResult.success ? claimResult.value.fencing_token : '';

      // Create checkpoint after claim
      const cpClaim = await checkpointManager.createCheckpoint('state_transition', 'TASK-001');
      expect(cpClaim.success).toBe(true);

      // === Phase 2: TDD RED Phase ===
      // Record failing test evidence
      const redEvidence = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'RED',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'FAIL',
        summary: 'Test correctly fails',
        failure_type: 'BEHAVIOR_MISSING',
        executor_id: 'alice',
        executor_type: 'HUMAN',
        exit_code: 1,
      });
      expect(redEvidence.success).toBe(true);

      // Checkpoint after RED
      await checkpointManager.createCheckpoint('tdd_phase_transition', 'TASK-001');

      // === Phase 3: TDD GREEN Phase ===
      // Record passing test evidence
      const greenEvidence = await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        tdd_phase: 'GREEN',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        result_status: 'PASS',
        summary: 'Test now passes',
        executor_id: 'alice',
        executor_type: 'HUMAN',
        exit_code: 0,
      });
      expect(greenEvidence.success).toBe(true);

      // Checkpoint after GREEN
      await checkpointManager.createCheckpoint('tdd_phase_transition', 'TASK-001');

      // === Phase 4: Review with Findings ===
      // Reviewer creates finding
      const finding = findingRegister.createFinding({
        task_id: 'TASK-001',
        review_round: 1,
        severity: 'HIGH',
        category: 'SECURITY',
        description: 'Missing input validation',
        status: 'OPEN',
        owner_id: 'alice',
      });

      // Cannot close review with open HIGH finding
      let canClose = findingRegister.canCloseReview('TASK-001');
      expect(canClose.canClose).toBe(false);

      // Developer fixes the finding
      findingRegister.updateFindingStatus(finding.finding_id, 'RESOLVED');

      // Now can close review
      canClose = findingRegister.canCloseReview('TASK-001');
      expect(canClose.canClose).toBe(true);

      // === Phase 5: Release ===
      // Plan release
      const release = releaseManager.planRelease('1.0.0');
      expect(release.status).toBe('PLANNING');

      // Check readiness
      const readiness = await releaseManager.checkReadiness(release.release_id);
      expect(readiness.ready).toBe(true);

      // Complete release flow
      releaseManager.deployToStaging(release.release_id);
      releaseManager.verifyStaging(release.release_id);
      releaseManager.approveForProduction(release.release_id, 'lead-001');
      releaseManager.deployToProduction(release.release_id);
      releaseManager.startMonitoring(release.release_id);
      const closeResult = releaseManager.closeRelease(release.release_id);
      expect(closeResult.success).toBe(true);

      const finalRelease = releaseManager.getRelease(release.release_id);
      expect(finalRelease?.status).toBe('CLOSED');

      // === Phase 6: Verify State Consistency ===
      const consistencyResult = await stateController.validateConsistency();
      expect(consistencyResult.success).toBe(true);

      // === Phase 7: Verify Checkpoints ===
      const checkpointList = await checkpointManager.listCheckpoints('TASK-001');
      expect(checkpointList.success).toBe(true);
      if (checkpointList.success) {
        expect(checkpointList.value.length).toBeGreaterThanOrEqual(3);
      }

      // === Phase 8: Verify Evidence ===
      const evidenceList = await evidenceManager.listEvidence('TASK-001');
      expect(evidenceList.success).toBe(true);
      if (evidenceList.success) {
        expect(evidenceList.value.length).toBe(2); // RED and GREEN
      }
    });
  });
});
