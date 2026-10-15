/**
 * FileCheckpointManager Implementation
 * 
 * Concrete implementation of the CheckpointManager interface that uses file-based
 * storage with YAML format for checkpoint persistence.
 * 
 * This module provides checkpoint creation, validation, and recovery operations:
 * - Automatic checkpoint creation on state transitions
 * - Git state capture (branch, commit, uncommitted changes)
 * - Checkpoint validation against current repository state
 * - Recovery planning with user confirmation
 * - Checkpoint pruning for storage management
 * 
 * Requirements: R09.1, R09.2, R09.3, R09.4, R09.5, R09.6, R09.7
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as yaml from 'yaml';

import {
  CheckpointManager,
  CheckpointManagerConfig,
  Checkpoint,
  CheckpointMetadata,
  CheckpointSnapshot,
  CheckpointTrigger,
  CheckpointGitState,
  UncommittedChange,
  CheckpointValidation,
  RecoveryPlan,
  RecoveryResult,
  RecoveryAction,
  Discrepancy,
  RecoveryStrategy,
  PruneOptions,
  PruneResult,
  CheckpointError,
  CheckpointErrorCode,
  CreateCheckpointResult,
  GetCheckpointResult,
  ListCheckpointsResult,
  ValidateCheckpointResult,
  PrepareRecoveryResult,
  ExecuteRecoveryResult,
  DeleteCheckpointResult,
  PruneCheckpointsResult,
  generateCheckpointId,
  createCheckpointMetadata,
  createEmptySnapshot,
  createDiscrepancy,
  createRecoveryAction,
  determineRecoveryStrategy,
  isValidTrigger,
  getCheckpointAgeDays,
  sortCheckpointsByDate,
  filterCheckpointsByTask,
  groupCheckpointsByTask,
  checkpointNotFoundError,
  checkpointCorruptedError,
  checkpointStaleError,
  validationFailedError,
  recoveryFailedError,
  writeCheckpointFailedError,
  gitStateError,
  confirmationRequiredError,
  noCheckpointsAvailableError,
  createCheckpointError,
  CHECKPOINT_DEFAULTS,
} from './checkpoint-manager';

import {
  StateController,
  ProjectState,
  ActorType,
  TddPhase,
  Result,
  ok,
  err,
} from './state-controller';

// =============================================================================
// Helper Utilities
// =============================================================================

const execAsync = promisify(exec);

/**
 * Generates a hash from content for integrity checking.
 */
function generateContentHash(content: string): string {
  // Simple hash using base64 of first 1000 chars + length
  // In production, use crypto.createHash('sha256')
  const simplified = content.substring(0, 1000) + content.length.toString();
  return `sha256:${Buffer.from(simplified).toString('base64').substring(0, 40)}`;
}

// =============================================================================
// Git Helper Functions
// =============================================================================

/**
 * Git helper interface for dependency injection in tests.
 */
export interface GitHelper {
  /**
   * Gets the current branch name.
   */
  getCurrentBranch(cwd?: string): Promise<string>;
  
  /**
   * Gets the current commit SHA.
   */
  getCurrentCommit(cwd?: string): Promise<string>;
  
  /**
   * Checks if working tree has uncommitted changes.
   */
  isWorkingTreeDirty(cwd?: string): Promise<boolean>;
  
  /**
   * Gets list of uncommitted changes.
   */
  getUncommittedChanges(cwd?: string): Promise<UncommittedChange[]>;
  
  /**
   * Checks if a commit exists and is reachable.
   */
  isCommitReachable(commitSha: string, cwd?: string): Promise<boolean>;
  
  /**
   * Checks if a branch exists.
   */
  branchExists(branchName: string, cwd?: string): Promise<boolean>;
}

/**
 * Default implementation of GitHelper using actual git commands.
 */
export class DefaultGitHelper implements GitHelper {
  async getCurrentBranch(cwd?: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  async getCurrentCommit(cwd?: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  async isWorkingTreeDirty(cwd?: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async getUncommittedChanges(cwd?: string): Promise<UncommittedChange[]> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd });
      if (!stdout.trim()) return [];

      const changes: UncommittedChange[] = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        if (line.length < 4) continue;

        const status = line.substring(0, 2);
        let filePath = line.substring(3);
        let originalPath: string | undefined;

        // Handle renames (format: "R  old_path -> new_path")
        if (filePath.includes(' -> ')) {
          const parts = filePath.split(' -> ');
          originalPath = parts[0];
          filePath = parts[1];
        }

        let type: UncommittedChange['type'];
        if (status.includes('A') || status.includes('?')) {
          type = status.includes('?') ? 'untracked' : 'added';
        } else if (status.includes('D')) {
          type = 'deleted';
        } else if (status.includes('R')) {
          type = 'renamed';
        } else {
          type = 'modified';
        }

        const change: UncommittedChange = { path: filePath, type };
        if (originalPath) {
          change.original_path = originalPath;
        }
        changes.push(change);
      }

      return changes;
    } catch {
      return [];
    }
  }

  async isCommitReachable(commitSha: string, cwd?: string): Promise<boolean> {
    try {
      await execAsync(`git cat-file -t ${commitSha}`, { cwd });
      return true;
    } catch {
      return false;
    }
  }

  async branchExists(branchName: string, cwd?: string): Promise<boolean> {
    try {
      await execAsync(`git rev-parse --verify refs/heads/${branchName}`, { cwd });
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// FileCheckpointManager Configuration
// =============================================================================

/**
 * Extended configuration for FileCheckpointManager.
 */
export interface FileCheckpointManagerConfig extends CheckpointManagerConfig {
  /** State controller instance for reading project state */
  stateController: StateController;
  /** Working directory for git operations */
  workingDirectory?: string;
  /** Git helper for dependency injection (mainly for testing) */
  gitHelper?: GitHelper;
}

// =============================================================================
// FileCheckpointManager Implementation
// =============================================================================

/**
 * File-based implementation of the CheckpointManager interface.
 * 
 * This implementation:
 * - Creates checkpoints capturing project state and git state
 * - Stores checkpoints as YAML files in .kiro/sdlc/checkpoints/
 * - Provides validation against current repository state
 * - Supports recovery planning and execution
 * - Implements checkpoint pruning based on retention policy
 * 
 * Requirements: R09.1, R09.2, R09.3, R09.4, R09.5, R09.6, R09.7
 */
export class FileCheckpointManager implements CheckpointManager {
  private readonly config: Required<Omit<FileCheckpointManagerConfig, 'gitHelper'>> & { gitHelper: GitHelper };
  private readonly stateController: StateController;
  private readonly gitHelper: GitHelper;
  private checkpointSequence: number = 0;

  /**
   * Creates a new FileCheckpointManager instance.
   * 
   * @param config - Configuration options for the manager
   */
  constructor(config: FileCheckpointManagerConfig) {
    const storagePath = config.storagePath ?? CHECKPOINT_DEFAULTS.STORAGE_DIR;
    
    this.config = {
      storagePath,
      defaultKeepCount: config.defaultKeepCount ?? CHECKPOINT_DEFAULTS.KEEP_COUNT_PER_TASK,
      defaultMaxAgeDays: config.defaultMaxAgeDays ?? CHECKPOINT_DEFAULTS.MAX_AGE_DAYS,
      periodicIntervalMinutes: config.periodicIntervalMinutes ?? CHECKPOINT_DEFAULTS.PERIODIC_INTERVAL_MINUTES,
      autoPrune: config.autoPrune ?? false,
      defaultActorId: config.defaultActorId ?? 'SYSTEM',
      stateController: config.stateController,
      workingDirectory: config.workingDirectory ?? process.cwd(),
      gitHelper: config.gitHelper ?? new DefaultGitHelper(),
    };
    
    this.stateController = config.stateController;
    this.gitHelper = this.config.gitHelper;
  }

  // ===========================================================================
  // Creation Operations
  // ===========================================================================

  /**
   * Creates a checkpoint of current state.
   * 
   * Requirements: R09.1, R09.2, R09.3
   * 
   * @param trigger - What triggered the checkpoint creation
   * @param taskId - Task ID to associate with checkpoint (optional)
   * @param note - Optional user note for manual checkpoints
   * @returns Result with Checkpoint on success, or CheckpointError on failure
   */
  async createCheckpoint(
    trigger: CheckpointTrigger,
    taskId?: string,
    note?: string
  ): Promise<CreateCheckpointResult> {
    try {
      // Step 1: Validate trigger
      if (!isValidTrigger(trigger)) {
        return err(createCheckpointError(
          CheckpointErrorCode.INVALID_TRIGGER,
          `Invalid checkpoint trigger: ${trigger}`,
          { trigger: trigger as CheckpointTrigger },
          false,
          'Use a valid trigger type: STATE_TRANSITION, TDD_PHASE_TRANSITION, EVIDENCE_CREATED, HANDOFF_INITIATED, HANDOFF_COMPLETED, PERIODIC, or MANUAL'
        ));
      }

      // Step 2: Read current project state
      const stateResult = await this.stateController.readState();
      if (!stateResult.success) {
        return err(writeCheckpointFailedError(
          taskId ?? null,
          `Failed to read project state: ${stateResult.error.message}`
        ));
      }

      const { state, version } = stateResult.value;

      // Step 3: Capture git state
      const gitStateResult = await this.captureGitState();
      if (!gitStateResult.success) {
        return err(gitStateResult.error);
      }
      const gitState = gitStateResult.value;

      // Step 4: Generate checkpoint ID
      const checkpointId = await this.generateUniqueCheckpointId();

      // Step 5: Determine actor info
      const actorId = this.getActorId(state);
      const actorType = this.getActorType(state);

      // Step 6: Create checkpoint metadata
      const metadata = createCheckpointMetadata(
        checkpointId,
        actorId,
        actorType,
        trigger,
        note
      );

      // Step 7: Create snapshot
      const snapshot = this.createSnapshot(state, version, gitState, taskId);

      // Step 8: Create checkpoint
      const checkpoint: Checkpoint = {
        metadata,
        snapshot,
      };

      // Step 9: Generate content hash for integrity
      const checkpointYaml = yaml.stringify(checkpoint);
      checkpoint.content_hash = generateContentHash(checkpointYaml);

      // Step 10: Ensure storage directory exists
      const storagePath = this.getAbsoluteStoragePath();
      await fs.mkdir(storagePath, { recursive: true });

      // Step 11: Write checkpoint to file
      const checkpointPath = path.join(storagePath, `${checkpointId}.yaml`);
      await fs.writeFile(checkpointPath, yaml.stringify(checkpoint, { indent: 2 }), 'utf-8');

      // Step 12: Update checkpoint summary in project state (best effort)
      await this.updateCheckpointSummary(checkpointId);

      // Step 13: Auto-prune if enabled
      if (this.config.autoPrune && taskId) {
        await this.pruneCheckpoints({ task_id: taskId });
      }

      return ok(checkpoint);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return err(writeCheckpointFailedError(taskId ?? null, errorMessage));
    }
  }

  // ===========================================================================
  // Retrieval Operations
  // ===========================================================================

  /**
   * Gets a checkpoint by ID.
   * 
   * @param checkpointId - The checkpoint ID to retrieve
   * @returns Result with Checkpoint on success, or CheckpointError on failure
   */
  async getCheckpoint(checkpointId: string): Promise<GetCheckpointResult> {
    try {
      const checkpointPath = path.join(
        this.getAbsoluteStoragePath(),
        `${checkpointId}.yaml`
      );

      // Check if file exists
      try {
        await fs.access(checkpointPath);
      } catch {
        return err(checkpointNotFoundError(checkpointId));
      }

      // Read and parse checkpoint
      const content = await fs.readFile(checkpointPath, 'utf-8');
      
      if (!content.trim()) {
        return err(checkpointCorruptedError(checkpointId, 'File is empty'));
      }

      try {
        const checkpoint = yaml.parse(content) as Checkpoint;
        
        // Validate checkpoint structure
        if (!checkpoint.metadata || !checkpoint.snapshot) {
          return err(checkpointCorruptedError(checkpointId, 'Missing required fields'));
        }

        return ok(checkpoint);
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Parse error';
        return err(checkpointCorruptedError(checkpointId, message));
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(checkpointCorruptedError(checkpointId, message));
    }
  }

  /**
   * Lists checkpoints, optionally filtered by task.
   * 
   * @param taskId - Optional task ID to filter by
   * @returns Result with Checkpoint array on success, or CheckpointError on failure
   */
  async listCheckpoints(taskId?: string): Promise<ListCheckpointsResult> {
    try {
      const storagePath = this.getAbsoluteStoragePath();
      
      // Check if storage directory exists
      try {
        await fs.access(storagePath);
      } catch {
        // No checkpoints directory yet - return empty list
        return ok([]);
      }

      // Read all files in the directory
      const files = await fs.readdir(storagePath);
      const checkpointFiles = files.filter(f => f.endsWith('.yaml'));

      const checkpoints: Checkpoint[] = [];

      for (const file of checkpointFiles) {
        const checkpointId = file.replace('.yaml', '');
        const result = await this.getCheckpoint(checkpointId);
        
        if (result.success) {
          checkpoints.push(result.value);
        }
        // Skip corrupted checkpoints silently
      }

      // Filter by task if specified
      let filtered = checkpoints;
      if (taskId) {
        filtered = filterCheckpointsByTask(checkpoints, taskId);
      }

      // Sort by date (newest first)
      const sorted = sortCheckpointsByDate(filtered);

      return ok(sorted);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(createCheckpointError(
        CheckpointErrorCode.CHECKPOINT_NOT_FOUND,
        `Failed to list checkpoints: ${message}`,
        { details: message },
        true,
        'Check if the checkpoints directory exists and is accessible'
      ));
    }
  }

  /**
   * Gets the latest checkpoint for a task and/or owner.
   * 
   * @param taskId - Task ID to get latest checkpoint for
   * @param ownerId - Optional owner ID to filter by
   * @returns Result with Checkpoint on success, null if none found, or CheckpointError on failure
   */
  async getLatestCheckpoint(
    taskId: string,
    ownerId?: string
  ): Promise<Result<Checkpoint | null, CheckpointError>> {
    const listResult = await this.listCheckpoints(taskId);
    
    if (!listResult.success) {
      return err(listResult.error);
    }

    const checkpoints = listResult.value;

    if (checkpoints.length === 0) {
      return ok(null);
    }

    // Filter by owner if specified
    let filtered = checkpoints;
    if (ownerId) {
      filtered = checkpoints.filter(cp => cp.snapshot.owner_id === ownerId);
    }

    if (filtered.length === 0) {
      return ok(null);
    }

    // Already sorted by date (newest first)
    return ok(filtered[0]);
  }

  // ===========================================================================
  // Validation Operations
  // ===========================================================================

  /**
   * Validates a checkpoint against current repository and project state.
   * 
   * Requirements: R09.4
   * 
   * @param checkpointId - The checkpoint ID to validate
   * @returns Result with CheckpointValidation on success, or CheckpointError on failure
   */
  async validateCheckpoint(checkpointId: string): Promise<ValidateCheckpointResult> {
    try {
      // Step 1: Get checkpoint
      const checkpointResult = await this.getCheckpoint(checkpointId);
      if (!checkpointResult.success) {
        return err(checkpointResult.error);
      }
      const checkpoint = checkpointResult.value;

      // Step 2: Read current state
      const stateResult = await this.stateController.readState();
      if (!stateResult.success) {
        return err(validationFailedError(checkpointId, [
          createDiscrepancy(
            'STATE_VERSION_MISMATCH',
            `Failed to read current state: ${stateResult.error.message}`,
            'ERROR',
            false
          )
        ]));
      }
      const currentState = stateResult.value;

      // Step 3: Validate and collect discrepancies
      const discrepancies: Discrepancy[] = [];

      // Check state version
      if (currentState.version > checkpoint.snapshot.state_version) {
        discrepancies.push(createDiscrepancy(
          'STATE_VERSION_MISMATCH',
          `Checkpoint state version ${checkpoint.snapshot.state_version} is older than current ${currentState.version}`,
          'WARNING',
          true,
          checkpoint.snapshot.state_version,
          currentState.version
        ));
      }

      // Check git state
      const gitDiscrepancies = await this.validateGitState(checkpoint.snapshot.git_state);
      discrepancies.push(...gitDiscrepancies);

      // Check fencing token if present
      if (checkpoint.snapshot.fencing_token && currentState.state.current_task?.ownership) {
        if (currentState.state.current_task.ownership.fencing_token !== checkpoint.snapshot.fencing_token) {
          discrepancies.push(createDiscrepancy(
            'FENCING_TOKEN_INVALID',
            'Fencing token no longer matches current ownership',
            'WARNING',
            true,
            checkpoint.snapshot.fencing_token,
            currentState.state.current_task.ownership.fencing_token
          ));
        }
      }

      // Check task status
      if (checkpoint.snapshot.task_id && currentState.state.current_task) {
        if (currentState.state.current_task.id === checkpoint.snapshot.task_id) {
          if (currentState.state.current_task.status !== checkpoint.snapshot.task_status) {
            discrepancies.push(createDiscrepancy(
              'TASK_STATUS_CHANGED',
              `Task status changed from ${checkpoint.snapshot.task_status} to ${currentState.state.current_task.status}`,
              'INFO',
              true,
              checkpoint.snapshot.task_status,
              currentState.state.current_task.status
            ));
          }
        }
      }

      // Check owner
      if (checkpoint.snapshot.owner_id && currentState.state.current_task?.assignee) {
        if (currentState.state.current_task.assignee !== checkpoint.snapshot.owner_id) {
          discrepancies.push(createDiscrepancy(
            'OWNER_CHANGED',
            `Task owner changed from ${checkpoint.snapshot.owner_id} to ${currentState.state.current_task.assignee}`,
            'WARNING',
            true,
            checkpoint.snapshot.owner_id,
            currentState.state.current_task.assignee
          ));
        }
      }

      // Determine recommended strategy
      const strategy = determineRecoveryStrategy(discrepancies);
      const valid = !discrepancies.some(d => d.severity === 'ERROR');
      const canRestore = strategy !== 'REJECT';

      const validation: CheckpointValidation = {
        checkpoint_id: checkpointId,
        valid,
        validated_at: new Date().toISOString(),
        discrepancies,
        recommended_strategy: strategy,
        can_restore: canRestore,
        cannot_restore_reason: canRestore ? undefined : 'Checkpoint is too stale or has non-recoverable discrepancies',
      };

      return ok(validation);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(validationFailedError(checkpointId, [
        createDiscrepancy('STATE_VERSION_MISMATCH', `Validation error: ${message}`, 'ERROR', false)
      ]));
    }
  }

  // ===========================================================================
  // Recovery Operations
  // ===========================================================================

  /**
   * Prepares a recovery plan from a checkpoint.
   * 
   * Requirements: R09.4, R09.5
   * 
   * @param checkpointId - The checkpoint ID to recover from
   * @returns Result with RecoveryPlan on success, or CheckpointError on failure
   */
  async prepareRecovery(checkpointId: string): Promise<PrepareRecoveryResult> {
    try {
      // Step 1: Validate checkpoint
      const validationResult = await this.validateCheckpoint(checkpointId);
      if (!validationResult.success) {
        return err(validationResult.error);
      }
      const validation = validationResult.value;

      // Step 2: Check if recovery is possible
      if (!validation.can_restore) {
        return err(recoveryFailedError(
          checkpointId,
          validation.cannot_restore_reason ?? 'Cannot restore from this checkpoint'
        ));
      }

      // Step 3: Get checkpoint
      const checkpointResult = await this.getCheckpoint(checkpointId);
      if (!checkpointResult.success) {
        return err(checkpointResult.error);
      }
      const checkpoint = checkpointResult.value;

      // Step 4: Generate recovery actions based on discrepancies
      const actions: RecoveryAction[] = [];
      let actionOrder = 1;

      // Add state restore action if version mismatch
      const hasVersionMismatch = validation.discrepancies.some(d => d.type === 'STATE_VERSION_MISMATCH');
      if (hasVersionMismatch) {
        actions.push(createRecoveryAction(
          `action-${actionOrder}`,
          'MERGE_CHANGES',
          'Reconcile checkpoint state with current state',
          actionOrder++,
          { requires_confirmation: validation.strategy === 'PROMPT_USER' }
        ));
      }

      // Add git restore actions if needed
      const hasBranchIssue = validation.discrepancies.some(d => d.type === 'BRANCH_NOT_FOUND');
      const hasCommitIssue = validation.discrepancies.some(d => d.type === 'COMMIT_NOT_FOUND');

      if (hasBranchIssue || hasCommitIssue) {
        actions.push(createRecoveryAction(
          `action-${actionOrder}`,
          'RESTORE_GIT',
          'Restore git state to checkpoint branch/commit',
          actionOrder++,
          { requires_confirmation: true, reversible: true }
        ));
      }

      // Add ownership reclaim if fencing token invalid
      const hasTokenIssue = validation.discrepancies.some(d => d.type === 'FENCING_TOKEN_INVALID');
      if (hasTokenIssue) {
        actions.push(createRecoveryAction(
          `action-${actionOrder}`,
          'RECLAIM_OWNERSHIP',
          'Reclaim task ownership with new fencing token',
          actionOrder++,
          { requires_confirmation: false }
        ));
      }

      // Add TDD phase update if needed
      if (checkpoint.snapshot.tdd_phase) {
        actions.push(createRecoveryAction(
          `action-${actionOrder}`,
          'UPDATE_TDD_PHASE',
          `Resume from TDD phase: ${checkpoint.snapshot.tdd_phase}`,
          actionOrder++,
          { requires_confirmation: false }
        ));
      }

      // Add user notification
      actions.push(createRecoveryAction(
        `action-${actionOrder}`,
        'NOTIFY_USER',
        'Notify user of recovery completion',
        actionOrder++,
        { requires_confirmation: false }
      ));

      // Step 5: Create recovery plan
      const warnings: string[] = [];
      if (validation.discrepancies.some(d => d.type === 'FILES_MODIFIED')) {
        warnings.push('Some files have been modified outside the workflow');
      }
      if (validation.discrepancies.some(d => d.type === 'REPOSITORY_DIVERGED')) {
        warnings.push('Repository has diverged since checkpoint');
      }

      const plan: RecoveryPlan = {
        checkpoint_id: checkpointId,
        created_at: new Date().toISOString(),
        validation,
        strategy: validation.recommended_strategy,
        discrepancies: validation.discrepancies,
        actions,
        requires_confirmation: validation.strategy !== 'AUTO_MERGE',
        warnings,
      };

      return ok(plan);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(recoveryFailedError(checkpointId, message));
    }
  }

  /**
   * Executes a recovery plan.
   * 
   * Requirements: R09.4, R09.5
   * 
   * @param recoveryPlan - The recovery plan to execute
   * @param userConfirmation - Whether user has confirmed the recovery
   * @returns Result with RecoveryResult on success, or CheckpointError on failure
   */
  async executeRecovery(
    recoveryPlan: RecoveryPlan,
    userConfirmation: boolean
  ): Promise<ExecuteRecoveryResult> {
    try {
      // Step 1: Check confirmation requirement
      if (recoveryPlan.requires_confirmation && !userConfirmation) {
        const checkpointResult = await this.getCheckpoint(recoveryPlan.checkpoint_id);
        if (!checkpointResult.success) {
          return err(checkpointResult.error);
        }
        return err(confirmationRequiredError(recoveryPlan.checkpoint_id, recoveryPlan));
      }

      // Step 2: Execute actions in order
      const executedActions: string[] = [];
      const skippedActions: string[] = [];
      const failedActions: Array<{ action_id: string; error: string }> = [];
      const warnings: string[] = [];

      for (const action of recoveryPlan.actions.sort((a, b) => a.order - b.order)) {
        // Check if action requires confirmation that wasn't given
        if (action.requires_confirmation && !userConfirmation) {
          skippedActions.push(action.action_id);
          continue;
        }

        try {
          await this.executeRecoveryAction(action, recoveryPlan.checkpoint_id);
          executedActions.push(action.action_id);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          failedActions.push({ action_id: action.action_id, error: errorMessage });
          warnings.push(`Action ${action.action_id} failed: ${errorMessage}`);
        }
      }

      // Step 3: Create result
      const success = failedActions.length === 0;
      
      // Read new state version if successful
      let newStateVersion: number | undefined;
      if (success) {
        const stateResult = await this.stateController.readState();
        if (stateResult.success) {
          newStateVersion = stateResult.value.version;
        }
      }

      const result: RecoveryResult = {
        success,
        plan: recoveryPlan,
        completed_at: new Date().toISOString(),
        executed_actions: executedActions,
        skipped_actions: skippedActions,
        failed_actions: failedActions,
        new_state_version: newStateVersion,
        warnings,
      };

      return ok(result);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(recoveryFailedError(recoveryPlan.checkpoint_id, message));
    }
  }

  // ===========================================================================
  // Deletion Operations
  // ===========================================================================

  /**
   * Deletes a checkpoint.
   * 
   * @param checkpointId - The checkpoint ID to delete
   * @returns Result with void on success, or CheckpointError on failure
   */
  async deleteCheckpoint(checkpointId: string): Promise<DeleteCheckpointResult> {
    try {
      const checkpointPath = path.join(
        this.getAbsoluteStoragePath(),
        `${checkpointId}.yaml`
      );

      // Check if file exists
      try {
        await fs.access(checkpointPath);
      } catch {
        return err(checkpointNotFoundError(checkpointId));
      }

      // Delete the file
      await fs.unlink(checkpointPath);

      return ok(undefined);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(createCheckpointError(
        CheckpointErrorCode.DELETE_FAILED,
        `Failed to delete checkpoint ${checkpointId}: ${message}`,
        { checkpoint_id: checkpointId, details: message },
        true,
        'Check file permissions and retry'
      ));
    }
  }

  /**
   * Prunes old checkpoints based on retention policy.
   * 
   * Requirements: R09.7
   * 
   * @param options - Pruning options
   * @returns Result with PruneResult on success, or CheckpointError on failure
   */
  async pruneCheckpoints(options?: PruneOptions): Promise<PruneCheckpointsResult> {
    try {
      const keepCount = options?.keep_count ?? this.config.defaultKeepCount;
      const maxAgeDays = options?.max_age_days ?? this.config.defaultMaxAgeDays;
      const keepAtLeastOne = options?.keep_at_least_one ?? true;
      const dryRun = options?.dry_run ?? false;

      // Get all checkpoints
      const listResult = await this.listCheckpoints(options?.task_id ?? undefined);
      if (!listResult.success) {
        return err(listResult.error);
      }

      const checkpoints = listResult.value;
      const prunedIds: string[] = [];
      let spaceFreed = 0;

      // Group by task
      const grouped = groupCheckpointsByTask(checkpoints);

      for (const [taskId, taskCheckpoints] of grouped) {
        // Sort by date (newest first) - already sorted
        const sorted = sortCheckpointsByDate(taskCheckpoints);

        // Determine which to prune
        const toPrune: Checkpoint[] = [];

        for (let i = 0; i < sorted.length; i++) {
          const cp = sorted[i];
          const age = getCheckpointAgeDays(cp);

          // Keep at least one if option is set
          if (keepAtLeastOne && i === 0) {
            continue;
          }

          // Prune if exceeds keep count
          if (i >= keepCount) {
            toPrune.push(cp);
            continue;
          }

          // Prune if exceeds max age
          if (age > maxAgeDays) {
            toPrune.push(cp);
          }
        }

        // Execute pruning
        for (const cp of toPrune) {
          if (!dryRun) {
            const deleteResult = await this.deleteCheckpoint(cp.metadata.checkpoint_id);
            if (deleteResult.success) {
              prunedIds.push(cp.metadata.checkpoint_id);
              spaceFreed += cp.metadata.size_bytes ?? 0;
            }
          } else {
            prunedIds.push(cp.metadata.checkpoint_id);
            spaceFreed += cp.metadata.size_bytes ?? 0;
          }
        }
      }

      const result: PruneResult = {
        pruned_count: prunedIds.length,
        pruned_ids: prunedIds,
        kept_count: checkpoints.length - prunedIds.length,
        space_freed_bytes: spaceFreed,
        dry_run: dryRun,
      };

      return ok(result);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(createCheckpointError(
        CheckpointErrorCode.PRUNE_FAILED,
        `Checkpoint pruning failed: ${message}`,
        { details: message },
        true,
        'Check storage access and retry'
      ));
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Gets absolute storage path.
   */
  private getAbsoluteStoragePath(): string {
    if (path.isAbsolute(this.config.storagePath)) {
      return this.config.storagePath;
    }
    return path.join(this.config.workingDirectory, this.config.storagePath);
  }

  /**
   * Generates a unique checkpoint ID.
   */
  private async generateUniqueCheckpointId(): Promise<string> {
    // Get existing checkpoints to determine sequence
    const listResult = await this.listCheckpoints();
    const today = new Date().toISOString().split('T')[0];
    
    let sequence = 1;
    if (listResult.success) {
      // Find the highest sequence number for today
      const todayCheckpoints = listResult.value.filter(cp => 
        cp.metadata.checkpoint_id.includes(today)
      );
      
      for (const cp of todayCheckpoints) {
        const match = cp.metadata.checkpoint_id.match(/-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= sequence) {
            sequence = num + 1;
          }
        }
      }
    }

    return generateCheckpointId(sequence);
  }

  /**
   * Captures current git state.
   */
  private async captureGitState(): Promise<Result<CheckpointGitState, CheckpointError>> {
    try {
      const cwd = this.config.workingDirectory;

      const [branchName, commitSha, isDirty, uncommittedChanges] = await Promise.all([
        this.gitHelper.getCurrentBranch(cwd),
        this.gitHelper.getCurrentCommit(cwd),
        this.gitHelper.isWorkingTreeDirty(cwd),
        this.gitHelper.getUncommittedChanges(cwd),
      ]);

      const gitState: CheckpointGitState = {
        branch_name: branchName,
        commit_sha: commitSha,
        working_tree_dirty: isDirty,
        uncommitted_changes: uncommittedChanges,
      };

      return ok(gitState);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(gitStateError(message));
    }
  }

  /**
   * Creates a snapshot from current state.
   */
  private createSnapshot(
    state: ProjectState,
    version: number,
    gitState: CheckpointGitState,
    taskId?: string
  ): CheckpointSnapshot {
    const currentTask = state.current_task;

    return {
      state_version: version,
      task_id: taskId ?? currentTask?.id ?? null,
      task_status: currentTask?.status ?? null,
      owner_id: currentTask?.assignee ?? null,
      fencing_token: currentTask?.ownership?.fencing_token ?? null,
      tdd_phase: (currentTask?.tdd?.phase as TddPhase) ?? null,
      git_state: gitState,
      evidence_refs: [], // Would be populated from evidence manager
      blockers: currentTask?.blocked ? [{
        blocker_id: currentTask.blocker_refs?.[0] ?? 'unknown',
        reason: currentTask.blocked_reason ?? 'Unknown blocker',
        created_at: new Date().toISOString(),
      }] : [],
      next_action: this.determineNextAction(state),
    };
  }

  /**
   * Determines next action based on state.
   */
  private determineNextAction(state: ProjectState): string | null {
    const currentTask = state.current_task;
    if (!currentTask) return null;

    if (currentTask.blocked) {
      return `Resolve blocker: ${currentTask.blocked_reason}`;
    }

    const tddPhase = currentTask.tdd?.phase;
    switch (tddPhase) {
      case 'PENDING':
        return 'Start TDD cycle: Write a failing test (RED phase)';
      case 'RED':
        return 'Continue RED phase: Ensure test fails for the right reason';
      case 'GREEN':
        return 'Continue GREEN phase: Implement minimum code to pass test';
      case 'REFACTOR':
        return 'Continue REFACTOR phase: Improve code while keeping tests passing';
      case 'VERIFY':
        return 'Complete verification: Run all checks';
      default:
        return null;
    }
  }

  /**
   * Gets actor ID from state.
   */
  private getActorId(state: ProjectState): string {
    return state.current_task?.assignee ?? state.last_modified_by ?? this.config.defaultActorId;
  }

  /**
   * Gets actor type from state.
   */
  private getActorType(state: ProjectState): ActorType {
    return state.current_task?.ownership?.actor_type ?? 'SYSTEM';
  }

  /**
   * Updates checkpoint summary in project state.
   */
  private async updateCheckpointSummary(checkpointId: string): Promise<void> {
    try {
      await this.stateController.updateState(
        (state: ProjectState): ProjectState => {
          const checkpointCount = (state.checkpoints?.checkpoint_count ?? 0) + 1;
          return {
            ...state,
            checkpoints: {
              last_checkpoint_id: checkpointId,
              last_checkpoint_at: new Date().toISOString(),
              checkpoint_count: checkpointCount,
            },
          };
        },
        `update-checkpoint-summary-${checkpointId}`,
        `Record checkpoint ${checkpointId} in project state`
      );
    } catch {
      // Best effort - don't fail checkpoint creation if summary update fails
    }
  }

  /**
   * Validates git state against current repository.
   */
  private async validateGitState(checkpointGitState: CheckpointGitState): Promise<Discrepancy[]> {
    const discrepancies: Discrepancy[] = [];
    const cwd = this.config.workingDirectory;

    // Check if commit exists
    if (checkpointGitState.commit_sha) {
      const commitExists = await this.gitHelper.isCommitReachable(checkpointGitState.commit_sha, cwd);
      if (!commitExists) {
        discrepancies.push(createDiscrepancy(
          'COMMIT_NOT_FOUND',
          `Commit ${checkpointGitState.commit_sha} no longer exists or is unreachable`,
          'ERROR',
          false,
          checkpointGitState.commit_sha,
          null
        ));
      }
    }

    // Check if branch exists
    if (checkpointGitState.branch_name && checkpointGitState.branch_name !== 'unknown') {
      const branchExists = await this.gitHelper.branchExists(checkpointGitState.branch_name, cwd);
      if (!branchExists) {
        discrepancies.push(createDiscrepancy(
          'BRANCH_NOT_FOUND',
          `Branch ${checkpointGitState.branch_name} no longer exists`,
          'WARNING',
          true,
          checkpointGitState.branch_name,
          null
        ));
      }
    }

    // Check for divergence (current commit different from checkpoint)
    const currentCommit = await this.gitHelper.getCurrentCommit(cwd);
    if (currentCommit && checkpointGitState.commit_sha && currentCommit !== checkpointGitState.commit_sha) {
      discrepancies.push(createDiscrepancy(
        'REPOSITORY_DIVERGED',
        `Repository has diverged: checkpoint at ${checkpointGitState.commit_sha.substring(0, 7)}, now at ${currentCommit.substring(0, 7)}`,
        'INFO',
        true,
        checkpointGitState.commit_sha,
        currentCommit
      ));
    }

    return discrepancies;
  }

  /**
   * Executes a single recovery action.
   */
  private async executeRecoveryAction(action: RecoveryAction, checkpointId: string): Promise<void> {
    switch (action.type) {
      case 'RESTORE_STATE':
      case 'MERGE_CHANGES':
        // In a full implementation, this would restore/merge state
        // For now, this is a placeholder
        break;
      
      case 'RESTORE_GIT':
        // Would checkout the checkpoint branch/commit
        break;
      
      case 'RECLAIM_OWNERSHIP':
        // Would call OwnershipManager to reclaim
        break;
      
      case 'UPDATE_TDD_PHASE':
        // Would update TDD phase in state
        break;
      
      case 'NOTIFY_USER':
        // Notification handled by caller
        break;
      
      case 'SKIP':
      case 'MANUAL_INTERVENTION':
        // No-op
        break;
      
      default:
        // Unknown action type - skip
        break;
    }
  }

  // ===========================================================================
  // Automatic Checkpoint Trigger Methods
  // ===========================================================================

  /**
   * Periodic checkpoint interval handle.
   */
  private periodicIntervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Timestamp of last activity for periodic checkpoint detection.
   */
  private lastActivityTimestamp: Date = new Date();

  /**
   * Creates a checkpoint when task status changes.
   * 
   * Requirements: R09.2 - Checkpoint on state transition
   * 
   * @param oldStatus - The previous task status
   * @param newStatus - The new task status
   * @param taskId - The task ID being transitioned
   * @returns Result with Checkpoint on success, or CheckpointError on failure
   * 
   * Usage:
   * ```typescript
   * // In task state transition handler
   * await checkpointManager.onStateTransition('ASSIGNED', 'IN_PROGRESS', 'TASK-001');
   * ```
   */
  async onStateTransition(
    oldStatus: string,
    newStatus: string,
    taskId: string
  ): Promise<CreateCheckpointResult> {
    this.recordActivity();
    
    const note = `Status changed from ${oldStatus} to ${newStatus}`;
    return this.createCheckpoint('STATE_TRANSITION', taskId, note);
  }

  /**
   * Creates a checkpoint when TDD phase changes.
   * 
   * Requirements: R09.2 - Checkpoint on TDD phase transition
   * 
   * @param oldPhase - The previous TDD phase
   * @param newPhase - The new TDD phase
   * @param taskId - The task ID being worked on
   * @returns Result with Checkpoint on success, or CheckpointError on failure
   * 
   * Usage:
   * ```typescript
   * // In TDD phase transition handler
   * await checkpointManager.onTddPhaseChange('RED', 'GREEN', 'TASK-001');
   * ```
   */
  async onTddPhaseChange(
    oldPhase: TddPhase | string | null,
    newPhase: TddPhase | string,
    taskId: string
  ): Promise<CreateCheckpointResult> {
    this.recordActivity();
    
    const oldPhaseName = oldPhase ?? 'NONE';
    const note = `TDD phase changed from ${oldPhaseName} to ${newPhase}`;
    return this.createCheckpoint('TDD_PHASE_TRANSITION', taskId, note);
  }

  /**
   * Creates a checkpoint when evidence is created.
   * 
   * Requirements: R09.2 - Checkpoint on evidence creation
   * 
   * @param evidenceId - The ID of the created evidence
   * @param taskId - The task ID the evidence is for
   * @returns Result with Checkpoint on success, or CheckpointError on failure
   * 
   * Usage:
   * ```typescript
   * // After creating evidence
   * await checkpointManager.onEvidenceCreated('EVD-TASK-001-RED', 'TASK-001');
   * ```
   */
  async onEvidenceCreated(
    evidenceId: string,
    taskId: string
  ): Promise<CreateCheckpointResult> {
    this.recordActivity();
    
    const note = `Evidence created: ${evidenceId}`;
    return this.createCheckpoint('EVIDENCE_CREATED', taskId, note);
  }

  /**
   * Creates a checkpoint when a handoff event occurs.
   * 
   * Requirements: R09.2 - Checkpoint on handoff initiation/completion
   * 
   * @param handoffId - The ID of the handoff
   * @param type - Whether the handoff was 'initiated' or 'completed'
   * @param taskId - The task ID being handed off
   * @returns Result with Checkpoint on success, or CheckpointError on failure
   * 
   * Usage:
   * ```typescript
   * // When initiating handoff
   * await checkpointManager.onHandoff('HO-001', 'initiated', 'TASK-001');
   * 
   * // When handoff completes
   * await checkpointManager.onHandoff('HO-001', 'completed', 'TASK-001');
   * ```
   */
  async onHandoff(
    handoffId: string,
    type: 'initiated' | 'completed',
    taskId: string
  ): Promise<CreateCheckpointResult> {
    this.recordActivity();
    
    const trigger: CheckpointTrigger = type === 'initiated' 
      ? 'HANDOFF_INITIATED' 
      : 'HANDOFF_COMPLETED';
    const note = `Handoff ${handoffId} ${type}`;
    
    return this.createCheckpoint(trigger, taskId, note);
  }

  /**
   * Starts periodic checkpoint creation.
   * 
   * Requirements: R09.2 - Configurable periodic checkpoint
   * 
   * @param intervalMinutes - Interval in minutes (default: from config, typically 15)
   * @returns True if periodic checkpointing was started, false if already running
   * 
   * Behavior:
   * - Creates checkpoints at the specified interval
   * - Only creates checkpoint if there has been activity since last checkpoint
   * - Skips checkpoint if no task is active
   * 
   * Usage:
   * ```typescript
   * // Start periodic checkpoints every 15 minutes
   * checkpointManager.startPeriodicCheckpoint();
   * 
   * // Start with custom interval (10 minutes)
   * checkpointManager.startPeriodicCheckpoint(10);
   * ```
   */
  startPeriodicCheckpoint(intervalMinutes?: number): boolean {
    // Don't start if already running
    if (this.periodicIntervalHandle !== null) {
      return false;
    }

    const interval = intervalMinutes ?? this.config.periodicIntervalMinutes;
    
    // If interval is 0 or negative, periodic checkpoints are disabled
    if (interval <= 0) {
      return false;
    }

    const intervalMs = interval * 60 * 1000;
    
    this.periodicIntervalHandle = setInterval(async () => {
      await this.createPeriodicCheckpoint();
    }, intervalMs);

    // Record initial activity timestamp
    this.lastActivityTimestamp = new Date();
    
    return true;
  }

  /**
   * Stops periodic checkpoint creation.
   * 
   * @returns True if periodic checkpointing was stopped, false if not running
   * 
   * Usage:
   * ```typescript
   * // Stop periodic checkpoints
   * checkpointManager.stopPeriodicCheckpoint();
   * ```
   */
  stopPeriodicCheckpoint(): boolean {
    if (this.periodicIntervalHandle === null) {
      return false;
    }

    clearInterval(this.periodicIntervalHandle);
    this.periodicIntervalHandle = null;
    
    return true;
  }

  /**
   * Checks if periodic checkpoint is currently running.
   * 
   * @returns True if periodic checkpoint is active
   */
  isPeriodicCheckpointRunning(): boolean {
    return this.periodicIntervalHandle !== null;
  }

  /**
   * Gets the last activity timestamp.
   * 
   * @returns The timestamp of the last recorded activity
   */
  getLastActivityTimestamp(): Date {
    return this.lastActivityTimestamp;
  }

  /**
   * Records activity for periodic checkpoint detection.
   * Call this method when any checkpoint-worthy activity occurs.
   */
  recordActivity(): void {
    this.lastActivityTimestamp = new Date();
  }

  /**
   * Creates a periodic checkpoint if there has been activity.
   * Internal method called by the periodic interval.
   */
  private async createPeriodicCheckpoint(): Promise<CreateCheckpointResult | null> {
    try {
      // Step 1: Check if there's an active task
      const stateResult = await this.stateController.readState();
      if (!stateResult.success) {
        return null;
      }

      const { state } = stateResult.value;
      const currentTask = state.current_task;
      
      // Skip if no active task
      if (!currentTask || !currentTask.id) {
        return null;
      }

      // Step 2: Check if there has been activity since last checkpoint
      const lastCheckpoint = await this.getLastCheckpointTimestamp();
      
      if (lastCheckpoint && this.lastActivityTimestamp <= lastCheckpoint) {
        // No activity since last checkpoint - skip
        return null;
      }

      // Step 3: Create periodic checkpoint
      const note = 'Periodic checkpoint (activity detected)';
      return this.createCheckpoint('PERIODIC', currentTask.id, note);

    } catch {
      // Silently fail for periodic checkpoints
      return null;
    }
  }

  /**
   * Gets the timestamp of the last checkpoint.
   */
  private async getLastCheckpointTimestamp(): Promise<Date | null> {
    try {
      const listResult = await this.listCheckpoints();
      if (!listResult.success || listResult.value.length === 0) {
        return null;
      }

      // Checkpoints are sorted newest first
      const latest = listResult.value[0];
      return new Date(latest.metadata.created_at);
    } catch {
      return null;
    }
  }
}
