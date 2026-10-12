/**
 * FileOwnershipManager Implementation
 * 
 * Concrete implementation of the OwnershipManager interface that uses
 * FileStateController for atomic state updates with optimistic concurrency.
 * 
 * This module provides task ownership management with:
 * - Fencing token generation (UUID v4) for ownership periods
 * - Atomic claim operations via State_Controller
 * - Lease management for AI agents
 * - Ownership conflict detection
 * 
 * Requirements: R02.3, R02.5, R02.6, R02.7, R02.8, R02.9, R02.10
 */

import {
  OwnershipManager,
  OwnershipError,
  OwnershipErrorCode,
  FencingToken,
  ClaimResult,
  ClaimTaskResult,
  ReleaseTaskResult,
  ValidateTokenResult,
  RecordHeartbeatResult,
  CheckExpiredLeasesResult,
  TransferOwnershipResult,
  ExtendedLeaseInfo,
  TokenValidationResult,
  HeartbeatResult,
  TransferResult,
  ExpiredLeasesResult,
  ExpiredLeaseDetail,
  generateFencingToken,
  isValidFencingToken,
  isLeaseExpired,
  getLeaseTimeRemaining,
  isLeaseInWarningState,
  taskAlreadyClaimedError,
  claimFailedError,
  tokenValidationFailedError,
  createOwnershipError,
  createTaskOwnership,
  createLeaseInfo,
  createDefaultAIAgentLeaseConfig,
  OWNERSHIP_DEFAULTS,
} from './ownership-manager';

import {
  StateController,
  ProjectState,
  TaskOwnership,
  CurrentTask,
  ActorType,
  Result,
  ok,
  err,
} from './state-controller';

import {
  AuditLogger,
  createAuditEntry,
} from './audit-logger';

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for FileOwnershipManager.
 */
export interface FileOwnershipManagerConfig {
  /** State controller instance for atomic state operations */
  stateController: StateController;
  /** Custom lease duration for AI agents in seconds */
  leaseDurationSeconds?: number;
  /** Custom heartbeat interval for AI agents in seconds */
  heartbeatIntervalSeconds?: number;
  /** Grace period multiplier for heartbeat timeout */
  heartbeatGraceMultiplier?: number;
  /** Optional audit logger for logging ownership events */
  auditLogger?: AuditLogger;
}

// =============================================================================
// FileOwnershipManager Implementation
// =============================================================================

/**
 * File-based implementation of the OwnershipManager interface.
 * 
 * This implementation:
 * - Uses FileStateController for atomic state updates
 * - Generates UUID v4 fencing tokens for ownership periods
 * - Supports both HUMAN and AI_AGENT actor types
 * - Provides lease management for AI agents
 * 
 * Requirements: R02.3, R02.5, R02.6, R02.7, R02.8, R02.9, R02.10
 */
export class FileOwnershipManager implements OwnershipManager {
  private readonly stateController: StateController;
  private readonly leaseDurationSeconds: number;
  private readonly heartbeatIntervalSeconds: number;
  private readonly heartbeatGraceMultiplier: number;
  private readonly auditLogger?: AuditLogger;

  /**
   * Creates a new FileOwnershipManager instance.
   * 
   * @param config - Configuration options for the manager
   */
  constructor(config: FileOwnershipManagerConfig) {
    this.stateController = config.stateController;
    this.leaseDurationSeconds = config.leaseDurationSeconds ?? OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS;
    this.heartbeatIntervalSeconds = config.heartbeatIntervalSeconds ?? OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS;
    this.heartbeatGraceMultiplier = config.heartbeatGraceMultiplier ?? OWNERSHIP_DEFAULTS.HEARTBEAT_GRACE_MULTIPLIER;
    this.auditLogger = config.auditLogger;
  }

  // ===========================================================================
  // Audit Logging Helper
  // ===========================================================================

  /**
   * Logs an ownership event to the audit logger (fire-and-forget).
   * 
   * @param action - The action type (e.g., 'OWNERSHIP_CLAIMED')
   * @param taskId - The task ID
   * @param actorId - The actor who performed the action
   * @param actorType - The actor type
   * @param details - Additional details about the action
   */
  private logOwnershipEvent(
    action: string,
    taskId: string,
    actorId: string,
    actorType: ActorType,
    details?: { reason?: string; changes?: Record<string, { from: unknown; to: unknown }> }
  ): void {
    if (!this.auditLogger) return;

    const entry = createAuditEntry({
      actor_id: actorId,
      actor_type: actorType,
      action,
      resource_type: 'Task',
      resource_id: taskId,
      reason: details?.reason,
      changes: details?.changes,
      outcome: 'SUCCESS',
    });

    // Fire-and-forget: don't wait for logging to complete
    this.auditLogger.log(entry).catch(() => {
      // Silently ignore audit log failures
    });
  }

  // ===========================================================================
  // Claim Operations
  // ===========================================================================

  /**
   * Claims ownership of a task.
   * Generates fencing token and records ownership atomically.
   * 
   * Requirements: R02.3, R02.5, R02.7
   * 
   * @param taskId - The task to claim
   * @param ownerId - The ID of the owner claiming the task
   * @param actorType - Type of actor (HUMAN or AI_AGENT)
   * @returns Result with ClaimResult on success, or OwnershipError on failure
   */
  async claimTask(
    taskId: string,
    ownerId: string,
    actorType: ActorType
  ): Promise<ClaimTaskResult> {
    const operationId = `claim-${taskId}-${ownerId}-${Date.now()}`;

    try {
      // Use updateState for atomic read-modify-write
      const result = await this.stateController.updateState(
        (state: ProjectState): ProjectState => {
          // Check if task already has an active owner
          if (state.current_task?.ownership?.fencing_token) {
            const currentOwner = state.current_task.assignee || 'unknown';
            // Throw error to abort the update - will be caught below
            throw new TaskAlreadyClaimedErrorInternal(taskId, currentOwner, ownerId);
          }

          // Generate new fencing token and ownership
          const now = new Date().toISOString();
          const fencingToken = generateFencingToken();

          // Create ownership based on actor type
          let ownership: TaskOwnership;
          if (actorType === 'AI_AGENT') {
            const expiresAt = new Date(Date.now() + this.leaseDurationSeconds * 1000);
            ownership = {
              fencing_token: fencingToken,
              acquired_at: now,
              actor_type: actorType,
              lease_expires_at: expiresAt.toISOString(),
              last_heartbeat_at: now,
            };
          } else {
            // HUMAN - no lease
            ownership = {
              fencing_token: fencingToken,
              acquired_at: now,
              actor_type: actorType,
              lease_expires_at: null,
              last_heartbeat_at: null,
            };
          }

          // Create or update current_task
          const newCurrentTask: CurrentTask = {
            id: taskId,
            status: 'IN_PROGRESS',
            assignee: ownerId,
            ownership,
            dor_check: state.current_task?.dor_check ?? null,
            tdd: state.current_task?.tdd ?? null,
            blocked: false,
            blocked_reason: null,
            blocker_refs: [],
            handoff_pending: false,
            handoff_id: null,
            working_branch: `task/${taskId}`,
          };

          return {
            ...state,
            current_task: newCurrentTask,
            last_modified_by: ownerId,
            last_action: `Task ${taskId} claimed by ${ownerId}`,
          };
        },
        operationId,
        `Claim task ${taskId} for ${ownerId}`
      );

      if (!result.success) {
        return {
          success: false,
          error: claimFailedError(taskId, ownerId, result.error.message),
        };
      }

      // Extract the claim result from the updated state
      const currentTask = result.value.state.current_task;
      if (!currentTask?.ownership) {
        return {
          success: false,
          error: claimFailedError(taskId, ownerId, 'Ownership not recorded in state'),
        };
      }

      const claimResult: ClaimResult = {
        fencing_token: currentTask.ownership.fencing_token,
        acquired_at: currentTask.ownership.acquired_at,
      };

      // Add lease info for AI_AGENT
      if (actorType === 'AI_AGENT' && currentTask.ownership.lease_expires_at) {
        claimResult.lease = {
          lease_expires_at: currentTask.ownership.lease_expires_at,
          last_heartbeat_at: currentTask.ownership.last_heartbeat_at,
          heartbeat_interval_seconds: this.heartbeatIntervalSeconds,
          duration_seconds: this.leaseDurationSeconds,
          extended: false,
          extension_count: 0,
        };
      }

      // Log the ownership claim event
      this.logOwnershipEvent(
        'OWNERSHIP_CLAIMED',
        taskId,
        ownerId,
        actorType,
        { reason: `Task ${taskId} claimed by ${ownerId}` }
      );

      return { success: true, value: claimResult };

    } catch (error) {
      // Handle TaskAlreadyClaimedError thrown from modifier
      if (error instanceof TaskAlreadyClaimedErrorInternal) {
        return {
          success: false,
          error: taskAlreadyClaimedError(error.taskId, error.currentOwner, error.requestedBy),
        };
      }

      // Handle other errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: claimFailedError(taskId, ownerId, errorMessage),
      };
    }
  }

  // ===========================================================================
  // Release Operations (placeholder for T09+)
  // ===========================================================================

  /**
   * Releases ownership of a task explicitly.
   * Invalidates the fencing token.
   * 
   * Requirements: R02.5, R02.6
   * 
   * @param taskId - The task to release
   * @param fencingToken - The current valid fencing token
   * @returns Result with void on success, or OwnershipError on failure
   */
  async releaseTask(
    taskId: string,
    fencingToken: FencingToken
  ): Promise<ReleaseTaskResult> {
    // TODO: Implement in T09
    throw new Error('Not implemented - see task T09');
  }

  // ===========================================================================
  // Validation Operations
  // ===========================================================================

  /**
   * Validates a fencing token for a task.
   * 
   * Requirements: R02.6
   * 
   * @param taskId - The task to validate against
   * @param fencingToken - The token to validate
   * @returns Result with TokenValidationResult on success, or OwnershipError on failure
   * 
   * Behavior:
   * - Checks token format validity (UUID v4)
   * - Checks token matches current ownership
   * - For AI_AGENT: Checks lease hasn't expired
   * - Returns time remaining and warning state for AI agents
   * - For HUMAN: No lease expiration check (null time remaining)
   */
  async validateFencingToken(
    taskId: string,
    fencingToken: FencingToken
  ): Promise<ValidateTokenResult> {
    try {
      // Step 1: Validate token format
      if (!isValidFencingToken(fencingToken)) {
        return {
          success: true,
          value: {
            valid: false,
            invalid_reason: 'TOKEN_FORMAT_INVALID',
          },
        };
      }

      // Step 2: Read current state
      const stateResult = await this.stateController.readState();
      if (!stateResult.success) {
        return {
          success: false,
          error: tokenValidationFailedError(taskId, fencingToken, stateResult.error.message),
        };
      }

      const state = stateResult.value.state;

      // Step 3: Check if task exists and has current_task
      if (!state.current_task) {
        return {
          success: true,
          value: {
            valid: false,
            invalid_reason: 'TASK_NOT_FOUND',
          },
        };
      }

      // Step 4: Check if task ID matches
      if (state.current_task.id !== taskId) {
        return {
          success: true,
          value: {
            valid: false,
            invalid_reason: 'TASK_NOT_FOUND',
          },
        };
      }

      // Step 5: Check if ownership exists
      const ownership = state.current_task.ownership;
      if (!ownership) {
        return {
          success: true,
          value: {
            valid: false,
            invalid_reason: 'TOKEN_NOT_FOUND',
          },
        };
      }

      // Step 6: Check if token matches current ownership
      if (ownership.fencing_token !== fencingToken) {
        return {
          success: true,
          value: {
            valid: false,
            invalid_reason: 'OWNERSHIP_MISMATCH',
          },
        };
      }

      // Step 7: For AI agents, check lease expiration
      if (ownership.actor_type === 'AI_AGENT') {
        const isExpired = isLeaseExpired(ownership, this.heartbeatGraceMultiplier);
        
        if (isExpired) {
          return {
            success: true,
            value: {
              valid: false,
              invalid_reason: 'TOKEN_EXPIRED',
            },
          };
        }

        // Calculate time remaining and warning state
        const timeRemaining = getLeaseTimeRemaining(ownership);
        const isWarning = isLeaseInWarningState(ownership, this.heartbeatIntervalSeconds);

        return {
          success: true,
          value: {
            valid: true,
            time_remaining_seconds: timeRemaining,
            warning: isWarning,
          },
        };
      }

      // Step 8: For HUMAN actors, token is valid (no lease expiration)
      return {
        success: true,
        value: {
          valid: true,
          time_remaining_seconds: null, // Humans don't have lease expiration
          warning: false,
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: tokenValidationFailedError(taskId, fencingToken, errorMessage),
      };
    }
  }

  // ===========================================================================
  // Heartbeat Operations
  // ===========================================================================

  /**
   * Records a heartbeat for an AI agent.
   * Updates last_heartbeat_at and optionally extends lease if close to expiry.
   * 
   * Requirements: R02.7, R02.8
   * 
   * @param taskId - The task to heartbeat
   * @param fencingToken - The current valid fencing token
   * @returns Result with HeartbeatResult on success, or OwnershipError on failure
   * 
   * Behavior:
   * - Validates fencing token matches current ownership
   * - Validates ownership is AI_AGENT (humans don't need heartbeat)
   * - Updates last_heartbeat_at to current timestamp
   * - Extends lease if within extension threshold (e.g., < heartbeat_interval remaining)
   * - Returns warning if lease is close to expiry
   * 
   * Errors:
   * - INVALID_FENCING_TOKEN: If token doesn't match or is expired
   * - LEASE_EXPIRED: If lease has already expired
   * - HEARTBEAT_FAILED: If heartbeat operation fails
   */
  async recordHeartbeat(
    taskId: string,
    fencingToken: FencingToken
  ): Promise<RecordHeartbeatResult> {
    const operationId = `heartbeat-${taskId}-${Date.now()}`;

    try {
      // Step 1: Validate fencing token first
      if (!isValidFencingToken(fencingToken)) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.INVALID_FENCING_TOKEN,
            `Invalid fencing token format for task ${taskId}`,
            { task_id: taskId, fencing_token: fencingToken },
            false,
            'Re-claim the task to obtain a new fencing token'
          ),
        };
      }

      // Step 2: Use atomic updateState for heartbeat operation
      const result = await this.stateController.updateState(
        (state: ProjectState): ProjectState => {
          // Validate task exists
          if (!state.current_task || state.current_task.id !== taskId) {
            throw new HeartbeatErrorInternal(taskId, fencingToken, 'Task not found');
          }

          // Validate ownership exists
          const ownership = state.current_task.ownership;
          if (!ownership) {
            throw new HeartbeatErrorInternal(taskId, fencingToken, 'No ownership found');
          }

          // Validate fencing token matches
          if (ownership.fencing_token !== fencingToken) {
            throw new HeartbeatErrorInternal(taskId, fencingToken, 'Fencing token mismatch');
          }

          // Validate actor type is AI_AGENT (humans don't need heartbeat)
          if (ownership.actor_type !== 'AI_AGENT') {
            throw new HeartbeatErrorInternal(taskId, fencingToken, 'Heartbeat only applies to AI agents');
          }

          // Check if lease has already expired
          if (isLeaseExpired(ownership, this.heartbeatGraceMultiplier)) {
            throw new LeaseExpiredErrorInternal(taskId, fencingToken, ownership.lease_expires_at || 'unknown');
          }

          // Update last_heartbeat_at
          const now = new Date();
          const newHeartbeatAt = now.toISOString();

          // Check if we should extend the lease
          // Extend if time remaining is less than heartbeat interval
          let newLeaseExpiresAt = ownership.lease_expires_at;
          let leaseExtended = false;

          if (ownership.lease_expires_at) {
            const expiresAt = new Date(ownership.lease_expires_at);
            const timeRemainingMs = expiresAt.getTime() - now.getTime();
            const thresholdMs = this.heartbeatIntervalSeconds * 1000;

            if (timeRemainingMs < thresholdMs) {
              // Extend lease by full lease duration from now
              const newExpiresAt = new Date(now.getTime() + this.leaseDurationSeconds * 1000);
              newLeaseExpiresAt = newExpiresAt.toISOString();
              leaseExtended = true;
            }
          }

          // Create updated ownership
          const updatedOwnership: TaskOwnership = {
            ...ownership,
            last_heartbeat_at: newHeartbeatAt,
            lease_expires_at: newLeaseExpiresAt,
          };

          return {
            ...state,
            current_task: {
              ...state.current_task,
              ownership: updatedOwnership,
            },
            last_modified_by: state.current_task.assignee || 'AI_AGENT',
            last_action: `Heartbeat recorded for task ${taskId}${leaseExtended ? ' (lease extended)' : ''}`,
          };
        },
        operationId,
        `Record heartbeat for task ${taskId}`
      );

      if (!result.success) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.HEARTBEAT_FAILED,
            `Heartbeat failed for task ${taskId}: ${result.error.message}`,
            { task_id: taskId, fencing_token: fencingToken, details: result.error.message },
            true,
            'Retry the heartbeat or reclaim the task'
          ),
        };
      }

      // Extract heartbeat result from updated state
      const updatedOwnership = result.value.state.current_task?.ownership;
      if (!updatedOwnership || !updatedOwnership.lease_expires_at) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.HEARTBEAT_FAILED,
            `Heartbeat completed but ownership not found in updated state`,
            { task_id: taskId, fencing_token: fencingToken },
            true,
            'Retry the heartbeat or reclaim the task'
          ),
        };
      }

      // Calculate time remaining and warning state
      const timeRemaining = getLeaseTimeRemaining(updatedOwnership);
      const isWarning = isLeaseInWarningState(updatedOwnership, this.heartbeatIntervalSeconds);

      // Determine if lease was extended by comparing timestamps
      const leaseExtended = updatedOwnership.lease_expires_at !== null;

      const heartbeatResult: HeartbeatResult = {
        lease_extended: leaseExtended && (result.value.state.last_action?.includes('lease extended') ?? false),
        new_expires_at: updatedOwnership.lease_expires_at ?? undefined,
        time_remaining_seconds: timeRemaining ?? 0,
        warning: isWarning,
      };

      return { success: true, value: heartbeatResult };

    } catch (error) {
      // Handle internal errors
      if (error instanceof HeartbeatErrorInternal) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.HEARTBEAT_FAILED,
            `Heartbeat failed for task ${taskId}: ${error.reason}`,
            { task_id: taskId, fencing_token: fencingToken, details: error.reason },
            true,
            'Retry the heartbeat or reclaim the task'
          ),
        };
      }

      if (error instanceof LeaseExpiredErrorInternal) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.LEASE_EXPIRED,
            `Lease expired for task ${taskId} at ${error.expiredAt}`,
            { task_id: taskId, fencing_token: fencingToken, details: `Expired at ${error.expiredAt}` },
            true,
            'Re-claim the task to obtain a new lease'
          ),
        };
      }

      // Handle other errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: createOwnershipError(
          OwnershipErrorCode.HEARTBEAT_FAILED,
          `Heartbeat failed for task ${taskId}: ${errorMessage}`,
          { task_id: taskId, fencing_token: fencingToken, details: errorMessage },
          true,
          'Retry the heartbeat or reclaim the task'
        ),
      };
    }
  }

  // ===========================================================================
  // Lease Expiry Operations
  // ===========================================================================

  /**
   * Checks and handles expired leases.
   * Called periodically by the system to clean up abandoned tasks.
   * 
   * Requirements: R02.8, R02.9
   * 
   * @returns Result with ExpiredLeasesResult on success, or OwnershipError on failure
   * 
   * Behavior:
   * - Scans current task for AI agent ownership
   * - Identifies leases where last_heartbeat + (2 * interval) < current_time
   * - Marks expired tasks as ABANDONED
   * - Invalidates fencing tokens for expired leases
   * - Records expiry details
   */
  async checkExpiredLeases(): Promise<CheckExpiredLeasesResult> {
    const operationId = `check-expired-leases-${Date.now()}`;

    try {
      // Read current state
      const stateResult = await this.stateController.readState();
      if (!stateResult.success) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.CLAIM_FAILED,
            `Failed to read state for expired lease check: ${stateResult.error.message}`,
            { details: stateResult.error.message },
            true,
            'Retry the expired lease check'
          ),
        };
      }

      const state = stateResult.value.state;
      const expiredTasks: string[] = [];
      const details: ExpiredLeaseDetail[] = [];

      // Check if current_task has an AI agent with expired lease
      if (
        state.current_task &&
        state.current_task.ownership &&
        state.current_task.ownership.actor_type === 'AI_AGENT'
      ) {
        const ownership = state.current_task.ownership;
        
        if (isLeaseExpired(ownership, this.heartbeatGraceMultiplier)) {
          const taskId = state.current_task.id;
          const ownerId = state.current_task.assignee || 'unknown';
          const now = new Date().toISOString();
          
          expiredTasks.push(taskId);
          details.push({
            task_id: taskId,
            owner_id: ownerId,
            expired_at: now,
            last_heartbeat_at: ownership.last_heartbeat_at,
            fencing_token: ownership.fencing_token,
          });

          // Mark task as ABANDONED and clear ownership
          const updateResult = await this.stateController.updateState(
            (currentState: ProjectState): ProjectState => {
              if (!currentState.current_task) {
                return currentState; // Task was already cleared
              }

              // Verify it's still the same task with same ownership
              if (
                currentState.current_task.id !== taskId ||
                currentState.current_task.ownership?.fencing_token !== ownership.fencing_token
              ) {
                return currentState; // Task or ownership changed, skip
              }

              // Mark as ABANDONED and clear ownership
              return {
                ...currentState,
                current_task: {
                  ...currentState.current_task,
                  status: 'ABANDONED',
                  ownership: null, // Clear ownership - fencing token invalidated
                },
                last_modified_by: 'SYSTEM',
                last_action: `Task ${taskId} marked ABANDONED due to lease expiry`,
              };
            },
            operationId,
            `Mark task ${taskId} as ABANDONED due to lease expiry`
          );

          if (!updateResult.success) {
            // Log warning but continue - the lease is still expired
            console.warn(`Failed to mark task ${taskId} as ABANDONED: ${updateResult.error.message}`);
          } else {
            // Log the lease expired event
            this.logOwnershipEvent(
              'LEASE_EXPIRED',
              taskId,
              ownerId,
              'AI_AGENT',
              { reason: `Lease expired for task ${taskId}, no heartbeat for grace period` }
            );
          }
        }
      }

      const result: ExpiredLeasesResult = {
        expired_tasks: expiredTasks,
        details,
      };

      return { success: true, value: result };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: createOwnershipError(
          OwnershipErrorCode.CLAIM_FAILED,
          `Failed to check expired leases: ${errorMessage}`,
          { details: errorMessage },
          true,
          'Retry the expired lease check'
        ),
      };
    }
  }

  // ===========================================================================
  // Transfer Operations
  // ===========================================================================

  /**
   * Transfers ownership atomically from one owner to another.
   * Used during handoffs.
   * 
   * Requirements: R02.6, R08.2
   * 
   * @param taskId - The task to transfer
   * @param fromFencingToken - The current owner's valid fencing token
   * @param toOwnerId - The new owner's ID
   * @param toActorType - The new owner's actor type
   * @param handoffId - Optional handoff ID to link with Handoff_Coordinator
   * @returns Result with TransferResult on success, or OwnershipError on failure
   * 
   * Behavior:
   * - Validates source fencing token matches current ownership
   * - Validates ownership exists and is not expired (for AI_AGENT)
   * - Atomically: invalidates old token, generates new token, transfers ownership
   * - Records transfer with timestamp and previous owner info
   * - For AI_AGENT target: Creates new lease
   * - For HUMAN target: No lease (null values)
   * 
   * Errors:
   * - INVALID_FENCING_TOKEN: If source token format invalid or doesn't match
   * - LEASE_EXPIRED: If source is AI_AGENT with expired lease
   * - TASK_NOT_FOUND: If task doesn't exist
   * - TRANSFER_FAILED: If atomic transfer fails
   */
  async transferOwnership(
    taskId: string,
    fromFencingToken: FencingToken,
    toOwnerId: string,
    toActorType: ActorType,
    handoffId?: string
  ): Promise<TransferOwnershipResult> {
    const operationId = `transfer-${taskId}-${toOwnerId}-${Date.now()}`;

    try {
      // Step 1: Validate source fencing token format
      if (!isValidFencingToken(fromFencingToken)) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.INVALID_FENCING_TOKEN,
            `Invalid fencing token format for task ${taskId}`,
            { task_id: taskId, fencing_token: fromFencingToken },
            false,
            'Re-claim the task to obtain a valid fencing token'
          ),
        };
      }

      // Step 2: Use atomic updateState for transfer operation
      const result = await this.stateController.updateState(
        (state: ProjectState): ProjectState => {
          // Validate task exists
          if (!state.current_task || state.current_task.id !== taskId) {
            throw new TransferErrorInternal(taskId, fromFencingToken, toOwnerId, 'Task not found');
          }

          // Validate ownership exists
          const ownership = state.current_task.ownership;
          if (!ownership) {
            throw new TransferErrorInternal(taskId, fromFencingToken, toOwnerId, 'No ownership found for task');
          }

          // Validate fencing token matches
          if (ownership.fencing_token !== fromFencingToken) {
            throw new TransferErrorInternal(taskId, fromFencingToken, toOwnerId, 'Fencing token mismatch');
          }

          // For AI_AGENT source, check if lease has expired
          if (ownership.actor_type === 'AI_AGENT') {
            if (isLeaseExpired(ownership, this.heartbeatGraceMultiplier)) {
              throw new TransferLeaseExpiredErrorInternal(
                taskId, 
                fromFencingToken, 
                ownership.lease_expires_at || 'unknown'
              );
            }
          }

          // Generate new fencing token for target owner
          const now = new Date();
          const newFencingToken = generateFencingToken();
          const previousOwner = state.current_task.assignee || 'unknown';

          // Create new ownership based on target actor type
          let newOwnership: TaskOwnership;
          if (toActorType === 'AI_AGENT') {
            const expiresAt = new Date(now.getTime() + this.leaseDurationSeconds * 1000);
            newOwnership = {
              fencing_token: newFencingToken,
              acquired_at: now.toISOString(),
              actor_type: toActorType,
              lease_expires_at: expiresAt.toISOString(),
              last_heartbeat_at: now.toISOString(),
            };
          } else {
            // HUMAN - no lease
            newOwnership = {
              fencing_token: newFencingToken,
              acquired_at: now.toISOString(),
              actor_type: toActorType,
              lease_expires_at: null,
              last_heartbeat_at: null,
            };
          }

          // Update current_task with new ownership
          const updatedCurrentTask: CurrentTask = {
            ...state.current_task,
            assignee: toOwnerId,
            ownership: newOwnership,
            // If handoffId provided, mark handoff as pending (Handoff_Coordinator integration)
            handoff_pending: handoffId ? true : false,
            handoff_id: handoffId || state.current_task.handoff_id,
          };

          // Store transfer metadata in the state for retrieval
          const transferMetadata = {
            old_fencing_token: fromFencingToken,
            new_fencing_token: newFencingToken,
            previous_owner: previousOwner,
            transferred_at: now.toISOString(),
          };

          return {
            ...state,
            current_task: updatedCurrentTask,
            last_modified_by: toOwnerId,
            last_action: `Ownership of task ${taskId} transferred from ${previousOwner} to ${toOwnerId}`,
            // Store transfer metadata in a way we can retrieve it
            // Using a convention of storing in state for atomic operations
            _transfer_metadata: transferMetadata as any,
          };
        },
        operationId,
        `Transfer ownership of task ${taskId} to ${toOwnerId}`
      );

      if (!result.success) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.TRANSFER_FAILED,
            `Failed to transfer task ${taskId}: ${result.error.message}`,
            { task_id: taskId, fencing_token: fromFencingToken, owner_id: toOwnerId },
            true,
            'Retry the transfer operation'
          ),
        };
      }

      // Extract transfer result from updated state
      const updatedOwnership = result.value.state.current_task?.ownership;
      if (!updatedOwnership) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.TRANSFER_FAILED,
            `Transfer completed but ownership not found in updated state`,
            { task_id: taskId },
            true,
            'Retry the transfer operation'
          ),
        };
      }

      // Get the transfer metadata from the state (or reconstruct from context)
      const transferredAt = updatedOwnership.acquired_at;
      const newFencingToken = updatedOwnership.fencing_token;

      // Build TransferResult
      const transferResult: TransferResult = {
        new_fencing_token: newFencingToken,
        transferred_at: transferredAt,
        old_fencing_token: fromFencingToken,
      };

      // Add lease info for AI_AGENT target
      if (toActorType === 'AI_AGENT' && updatedOwnership.lease_expires_at) {
        transferResult.new_lease = {
          lease_expires_at: updatedOwnership.lease_expires_at,
          last_heartbeat_at: updatedOwnership.last_heartbeat_at,
          heartbeat_interval_seconds: this.heartbeatIntervalSeconds,
          duration_seconds: this.leaseDurationSeconds,
          extended: false,
          extension_count: 0,
        };
      }

      // Log the ownership transfer event
      this.logOwnershipEvent(
        'OWNERSHIP_TRANSFERRED',
        taskId,
        toOwnerId,
        toActorType,
        { 
          reason: `Ownership transferred from ${fromFencingToken} to ${toOwnerId}`,
          changes: {
            owner: { from: fromFencingToken, to: toOwnerId },
            actor_type: { from: 'unknown', to: toActorType },
          }
        }
      );

      return { success: true, value: transferResult };

    } catch (error) {
      // Handle internal transfer errors
      if (error instanceof TransferErrorInternal) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.TRANSFER_FAILED,
            `Transfer failed for task ${taskId}: ${error.reason}`,
            { 
              task_id: taskId, 
              fencing_token: fromFencingToken, 
              owner_id: toOwnerId,
              details: error.reason 
            },
            true,
            'Retry the transfer operation or re-validate the fencing token'
          ),
        };
      }

      if (error instanceof TransferLeaseExpiredErrorInternal) {
        return {
          success: false,
          error: createOwnershipError(
            OwnershipErrorCode.LEASE_EXPIRED,
            `Cannot transfer task ${taskId}: source lease expired at ${error.expiredAt}`,
            { 
              task_id: taskId, 
              fencing_token: fromFencingToken, 
              details: `Lease expired at ${error.expiredAt}` 
            },
            true,
            'Re-claim the task to obtain a new lease before transferring'
          ),
        };
      }

      // Handle other errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: createOwnershipError(
          OwnershipErrorCode.TRANSFER_FAILED,
          `Transfer failed for task ${taskId}: ${errorMessage}`,
          { task_id: taskId, fencing_token: fromFencingToken, owner_id: toOwnerId },
          true,
          'Retry the transfer operation'
        ),
      };
    }
  }
}

// =============================================================================
// Internal Error Classes (for control flow in modifier functions)
// =============================================================================

/**
 * Internal error class used for control flow within the updateState modifier.
 * This allows us to abort the atomic update when a task is already claimed.
 */
class TaskAlreadyClaimedErrorInternal extends Error {
  public readonly taskId: string;
  public readonly currentOwner: string;
  public readonly requestedBy: string;

  constructor(taskId: string, currentOwner: string, requestedBy: string) {
    super(`Task ${taskId} is already claimed by ${currentOwner}`);
    this.name = 'TaskAlreadyClaimedErrorInternal';
    this.taskId = taskId;
    this.currentOwner = currentOwner;
    this.requestedBy = requestedBy;
  }
}

/**
 * Internal error class used for control flow within heartbeat operations.
 * This allows us to abort the atomic update with a specific reason.
 */
class HeartbeatErrorInternal extends Error {
  public readonly taskId: string;
  public readonly fencingToken: string;
  public readonly reason: string;

  constructor(taskId: string, fencingToken: string, reason: string) {
    super(`Heartbeat failed for task ${taskId}: ${reason}`);
    this.name = 'HeartbeatErrorInternal';
    this.taskId = taskId;
    this.fencingToken = fencingToken;
    this.reason = reason;
  }
}

/**
 * Internal error class used for control flow when lease has expired.
 * This allows us to signal lease expiry from within the atomic update.
 */
class LeaseExpiredErrorInternal extends Error {
  public readonly taskId: string;
  public readonly fencingToken: string;
  public readonly expiredAt: string;

  constructor(taskId: string, fencingToken: string, expiredAt: string) {
    super(`Lease expired for task ${taskId} at ${expiredAt}`);
    this.name = 'LeaseExpiredErrorInternal';
    this.taskId = taskId;
    this.fencingToken = fencingToken;
    this.expiredAt = expiredAt;
  }
}

/**
 * Internal error class used for control flow within transfer operations.
 * This allows us to abort the atomic update with a specific reason.
 */
class TransferErrorInternal extends Error {
  public readonly taskId: string;
  public readonly fencingToken: string;
  public readonly toOwnerId: string;
  public readonly reason: string;

  constructor(taskId: string, fencingToken: string, toOwnerId: string, reason: string) {
    super(`Transfer failed for task ${taskId}: ${reason}`);
    this.name = 'TransferErrorInternal';
    this.taskId = taskId;
    this.fencingToken = fencingToken;
    this.toOwnerId = toOwnerId;
    this.reason = reason;
  }
}

/**
 * Internal error class used when transfer source has expired lease.
 */
class TransferLeaseExpiredErrorInternal extends Error {
  public readonly taskId: string;
  public readonly fencingToken: string;
  public readonly expiredAt: string;

  constructor(taskId: string, fencingToken: string, expiredAt: string) {
    super(`Cannot transfer task ${taskId}: lease expired at ${expiredAt}`);
    this.name = 'TransferLeaseExpiredErrorInternal';
    this.taskId = taskId;
    this.fencingToken = fencingToken;
    this.expiredAt = expiredAt;
  }
}