/**
 * Checkpoint Manager - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Checkpoint_Manager component
 * which provides checkpoint creation, validation, and recovery operations.
 * 
 * The Checkpoint_Manager ensures recoverability after crashes or context resets by
 * capturing and restoring state snapshots with git state correlation.
 * 
 * Requirements: R09.1, R09.2, R09.3, R09.4, R09.5, R09.6, R09.7
 */

import { 
  ActorType, 
  Result, 
  ok, 
  err,
  TddPhase,
} from './state-controller';

// =============================================================================
// Re-exports from state-controller for convenience
// =============================================================================

export { ActorType, TddPhase } from './state-controller';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for checkpoint operations.
 * Requirements: R09.2, R09.7
 */
export const CHECKPOINT_DEFAULTS = {
  /** Default periodic checkpoint interval in minutes */
  PERIODIC_INTERVAL_MINUTES: 15,
  /** Default number of checkpoints to keep per task */
  KEEP_COUNT_PER_TASK: 10,
  /** Maximum age in days for checkpoint retention */
  MAX_AGE_DAYS: 30,
  /** Directory name for checkpoint storage */
  STORAGE_DIR: '.kiro/sdlc/checkpoints',
  /** Checkpoint ID prefix */
  ID_PREFIX: 'CP',
} as const;

// =============================================================================
// Type Definitions - Checkpoint Trigger
// =============================================================================

/**
 * Trigger types that cause checkpoint creation.
 * Requirements: R09.2
 */
export type CheckpointTrigger = 
  | 'STATE_TRANSITION'      // Task status change
  | 'TDD_PHASE_TRANSITION'  // TDD phase change (RED -> GREEN, etc.)
  | 'EVIDENCE_CREATED'      // New evidence record created
  | 'HANDOFF_INITIATED'     // Handoff process started
  | 'HANDOFF_COMPLETED'     // Handoff process completed
  | 'PERIODIC'              // Periodic interval checkpoint
  | 'MANUAL';               // User-triggered checkpoint

/**
 * Maps trigger types to human-readable descriptions.
 */
export const CHECKPOINT_TRIGGER_DESCRIPTIONS: Record<CheckpointTrigger, string> = {
  STATE_TRANSITION: 'Task status changed',
  TDD_PHASE_TRANSITION: 'TDD phase changed',
  EVIDENCE_CREATED: 'Evidence record created',
  HANDOFF_INITIATED: 'Handoff process started',
  HANDOFF_COMPLETED: 'Handoff process completed',
  PERIODIC: 'Periodic checkpoint',
  MANUAL: 'Manual checkpoint by user',
};

// =============================================================================
// Type Definitions - Git State
// =============================================================================

/**
 * Uncommitted file change information.
 * Requirements: R09.1
 */
export interface UncommittedChange {
  /** Relative path to the file */
  path: string;
  /** Type of change */
  type: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  /** Original path if renamed */
  original_path?: string;
}

/**
 * Git state captured in checkpoint.
 * Requirements: R09.1
 */
export interface CheckpointGitState {
  /** Working branch name */
  branch_name: string;
  /** Last known commit SHA */
  commit_sha: string;
  /** Whether working tree has uncommitted changes */
  working_tree_dirty: boolean;
  /** List of uncommitted file changes */
  uncommitted_changes: UncommittedChange[];
  /** Stash reference if changes were stashed */
  stash_ref?: string;
  /** Remote tracking branch if any */
  remote_tracking_branch?: string;
  /** Commits ahead of remote */
  commits_ahead?: number;
  /** Commits behind remote */
  commits_behind?: number;
}

// =============================================================================
// Type Definitions - Checkpoint Metadata
// =============================================================================

/**
 * Metadata about the checkpoint.
 * Requirements: R09.1, R09.3
 */
export interface CheckpointMetadata {
  /** Unique checkpoint identifier (CP-YYYY-MM-DD-XXX) */
  checkpoint_id: string;
  /** ISO 8601 timestamp when checkpoint was created */
  created_at: string;
  /** ID of the actor who created the checkpoint */
  created_by: string;
  /** Type of actor who created the checkpoint */
  actor_type: ActorType;
  /** Trigger that caused checkpoint creation */
  trigger: CheckpointTrigger;
  /** Optional user note for manual checkpoints */
  note?: string;
  /** Size of checkpoint data in bytes */
  size_bytes?: number;
}

// =============================================================================
// Type Definitions - Checkpoint Snapshot
// =============================================================================

/**
 * Active blockers captured in checkpoint.
 */
export interface CheckpointBlocker {
  /** Blocker ID */
  blocker_id: string;
  /** Blocker reason */
  reason: string;
  /** When blocker was created */
  created_at: string;
}

/**
 * Snapshot data captured in checkpoint.
 * Requirements: R09.1
 */
export interface CheckpointSnapshot {
  /** State version at checkpoint time */
  state_version: number;
  /** Task ID being worked on (if any) */
  task_id: string | null;
  /** Task status at checkpoint time */
  task_status: string | null;
  /** Owner ID at checkpoint time */
  owner_id: string | null;
  /** Fencing token at checkpoint time */
  fencing_token: string | null;
  /** TDD phase at checkpoint time */
  tdd_phase: TddPhase | null;
  /** Git state */
  git_state: CheckpointGitState;
  /** Evidence references collected so far */
  evidence_refs: string[];
  /** Active blockers */
  blockers: CheckpointBlocker[];
  /** Recommended next action */
  next_action: string | null;
  /** Additional context data */
  context?: Record<string, unknown>;
}

// =============================================================================
// Type Definitions - Checkpoint Validation
// =============================================================================

/**
 * Discrepancy types that can be detected during validation.
 * Requirements: R09.4
 */
export type DiscrepancyType = 
  | 'COMMIT_NOT_FOUND'       // Commit no longer exists
  | 'BRANCH_NOT_FOUND'       // Branch no longer exists
  | 'STATE_VERSION_MISMATCH' // Newer state exists
  | 'REPOSITORY_DIVERGED'    // Commits not in checkpoint
  | 'FILES_MODIFIED'         // Files modified outside workflow
  | 'FENCING_TOKEN_INVALID'  // Fencing token no longer valid
  | 'TASK_STATUS_CHANGED'    // Task status changed since checkpoint
  | 'OWNER_CHANGED';         // Task owner changed since checkpoint

/**
 * Individual discrepancy detected during validation.
 * Requirements: R09.4
 */
export interface Discrepancy {
  /** Type of discrepancy */
  type: DiscrepancyType;
  /** Human-readable description */
  description: string;
  /** Expected value from checkpoint */
  expected?: unknown;
  /** Actual current value */
  actual?: unknown;
  /** Severity level */
  severity: 'ERROR' | 'WARNING' | 'INFO';
  /** Whether this discrepancy is recoverable */
  recoverable: boolean;
}

/**
 * Result of checkpoint validation.
 * Requirements: R09.4
 */
export interface CheckpointValidation {
  /** Checkpoint ID that was validated */
  checkpoint_id: string;
  /** Whether validation passed (no errors) */
  valid: boolean;
  /** ISO 8601 timestamp of validation */
  validated_at: string;
  /** List of discrepancies found */
  discrepancies: Discrepancy[];
  /** Recommended recovery strategy */
  recommended_strategy: RecoveryStrategy;
  /** Whether checkpoint can be restored */
  can_restore: boolean;
  /** Reason if cannot restore */
  cannot_restore_reason?: string;
}

// =============================================================================
// Type Definitions - Recovery
// =============================================================================

/**
 * Recovery strategies based on discrepancies found.
 * Requirements: R09.5
 */
export type RecoveryStrategy = 
  | 'AUTO_MERGE'    // Changes compatible, auto-reconcile
  | 'PROMPT_USER'   // Conflict or ambiguous, ask user
  | 'REJECT';       // Checkpoint too stale, require fresh start

/**
 * Recovery action types.
 */
export type RecoveryActionType = 
  | 'RESTORE_STATE'       // Restore project state
  | 'RESTORE_GIT'         // Restore git state (checkout, etc.)
  | 'APPLY_STASH'         // Apply stashed changes
  | 'RECLAIM_OWNERSHIP'   // Reclaim task ownership
  | 'UPDATE_TDD_PHASE'    // Update TDD phase
  | 'SKIP'                // Skip this action
  | 'MANUAL_INTERVENTION' // Requires manual action
  | 'MERGE_CHANGES'       // Merge checkpoint state with current
  | 'NOTIFY_USER';        // Notify user of recovery

/**
 * Individual recovery action in recovery plan.
 * Requirements: R09.4, R09.5
 */
export interface RecoveryAction {
  /** Unique action ID within the plan */
  action_id: string;
  /** Action type */
  type: RecoveryActionType;
  /** Human-readable description */
  description: string;
  /** Order in execution sequence */
  order: number;
  /** Whether this action requires user confirmation */
  requires_confirmation: boolean;
  /** Whether this action is reversible */
  reversible: boolean;
  /** Parameters for the action */
  params?: Record<string, unknown>;
  /** Dependencies on other actions (action_ids) */
  depends_on?: string[];
}

/**
 * Complete recovery plan from checkpoint.
 * Requirements: R09.4, R09.5
 */
export interface RecoveryPlan {
  /** Checkpoint being recovered from */
  checkpoint_id: string;
  /** ISO 8601 timestamp of plan creation */
  created_at: string;
  /** Validation result that led to this plan */
  validation: CheckpointValidation;
  /** Recovery strategy to use */
  strategy: RecoveryStrategy;
  /** List of discrepancies being addressed */
  discrepancies: Discrepancy[];
  /** Ordered list of actions to execute */
  actions: RecoveryAction[];
  /** Whether plan requires user confirmation before execution */
  requires_confirmation: boolean;
  /** Estimated time to execute in seconds */
  estimated_duration_seconds?: number;
  /** Warnings for user attention */
  warnings: string[];
}

/**
 * Result of recovery execution.
 */
export interface RecoveryResult {
  /** Whether recovery completed successfully */
  success: boolean;
  /** Recovery plan that was executed */
  plan: RecoveryPlan;
  /** ISO 8601 timestamp of recovery completion */
  completed_at: string;
  /** Actions that were executed */
  executed_actions: string[];
  /** Actions that were skipped */
  skipped_actions: string[];
  /** Actions that failed */
  failed_actions: Array<{
    action_id: string;
    error: string;
  }>;
  /** New state after recovery (if successful) */
  new_state_version?: number;
  /** New fencing token (if ownership reclaimed) */
  new_fencing_token?: string;
  /** Warnings generated during recovery */
  warnings: string[];
}

// =============================================================================
// Type Definitions - Full Checkpoint
// =============================================================================

/**
 * Complete checkpoint structure.
 * Requirements: R09.1
 */
export interface Checkpoint {
  /** Checkpoint metadata */
  metadata: CheckpointMetadata;
  /** Snapshot data */
  snapshot: CheckpointSnapshot;
  /** Optional validation info from last validation */
  last_validation?: CheckpointValidation;
  /** Hash of checkpoint content for integrity checking */
  content_hash?: string;
}

// =============================================================================
// Type Definitions - Prune Options
// =============================================================================

/**
 * Options for checkpoint pruning.
 * Requirements: R09.7
 */
export interface PruneOptions {
  /** Task ID to prune checkpoints for (null = all tasks) */
  task_id?: string | null;
  /** Number of checkpoints to keep per task */
  keep_count?: number;
  /** Maximum age in days (checkpoints older than this are pruned) */
  max_age_days?: number;
  /** Keep at least one checkpoint per task regardless of age */
  keep_at_least_one?: boolean;
  /** Dry run - don't actually delete, just report what would be deleted */
  dry_run?: boolean;
}

/**
 * Result of checkpoint pruning.
 */
export interface PruneResult {
  /** Number of checkpoints pruned */
  pruned_count: number;
  /** IDs of pruned checkpoints */
  pruned_ids: string[];
  /** Number of checkpoints kept */
  kept_count: number;
  /** Total space freed in bytes */
  space_freed_bytes: number;
  /** Whether this was a dry run */
  dry_run: boolean;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Checkpoint error codes following the design specification.
 * Error codes in range 2200-2299 for CHECKPOINT_ERROR category.
 * Requirements: R09
 */
export enum CheckpointErrorCode {
  /** Checkpoint not found */
  CHECKPOINT_NOT_FOUND = 2201,
  /** Checkpoint corrupted or invalid format */
  CHECKPOINT_CORRUPTED = 2202,
  /** Checkpoint is stale (state has advanced) */
  CHECKPOINT_STALE = 2203,
  /** Checkpoint validation failed */
  VALIDATION_FAILED = 2204,
  /** Recovery failed */
  RECOVERY_FAILED = 2205,
  /** Write checkpoint failed */
  WRITE_FAILED = 2206,
  /** Delete checkpoint failed */
  DELETE_FAILED = 2207,
  /** Invalid checkpoint trigger */
  INVALID_TRIGGER = 2208,
  /** Checkpoint already exists with same ID */
  DUPLICATE_CHECKPOINT = 2209,
  /** Git state capture failed */
  GIT_STATE_ERROR = 2210,
  /** Recovery requires user confirmation */
  CONFIRMATION_REQUIRED = 2211,
  /** Recovery plan execution failed */
  PLAN_EXECUTION_FAILED = 2212,
  /** No checkpoints available for task */
  NO_CHECKPOINTS_AVAILABLE = 2213,
  /** Pruning operation failed */
  PRUNE_FAILED = 2214,
}

/**
 * Checkpoint error structure following the design specification.
 */
export interface CheckpointError {
  /** Error code from CheckpointErrorCode enum */
  code: CheckpointErrorCode;
  /** Error category */
  category: 'CHECKPOINT_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    checkpoint_id?: string;
    task_id?: string;
    trigger?: CheckpointTrigger;
    discrepancies?: Discrepancy[];
    details?: string;
    [key: string]: unknown;
  };
  /** Whether the operation can be retried */
  recoverable: boolean;
  /** Suggested action to resolve the error */
  suggested_action?: string;
  /** Timestamp when the error occurred */
  timestamp: string;
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Creates a CheckpointError with the given code and details.
 */
export function createCheckpointError(
  code: CheckpointErrorCode,
  message: string,
  context?: CheckpointError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): CheckpointError {
  return {
    code,
    category: 'CHECKPOINT_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "checkpoint not found" error.
 */
export function checkpointNotFoundError(checkpointId: string): CheckpointError {
  return createCheckpointError(
    CheckpointErrorCode.CHECKPOINT_NOT_FOUND,
    `Checkpoint ${checkpointId} not found`,
    { checkpoint_id: checkpointId },
    false,
    'Verify the checkpoint ID is correct or list available checkpoints'
  );
}

/**
 * Creates a "checkpoint corrupted" error.
 */
export function checkpointCorruptedError(
  checkpointId: string,
  details?: string
): CheckpointError {
  return createCheckpointError(
    CheckpointErrorCode.CHECKPOINT_CORRUPTED,
    `Checkpoint ${checkpointId} is corrupted: ${details || 'Invalid format'}`,
    { checkpoint_id: checkpointId, details },
    false,
    'Delete the corrupted checkpoint and create a new one'
  );
}

/**
 * Creates a "checkpoint stale" error.
 * Requirements: R09.4
 */
export function checkpointStaleError(
  checkpointId: string,
  expectedVersion: number,
  actualVersion: number
): CheckpointError {
  return createCheckpointError(
    CheckpointErrorCode.CHECKPOINT_STALE,
    `Checkpoint ${checkpointId} is stale: expected state version ${expectedVersion}, current is ${actualVersion}`,
    { 
      checkpoint_id: checkpointId,
      expected_version: expectedVersion,
      actual_version: actualVersion,
    },
    true,
    'Create a new checkpoint or use recovery with reconciliation'
  );
}

/**
 * Creates a "validation failed" error.
 * Requirements: R09.4
 */
export function validationFailedError(
  checkpointId: string,
  discrepancies: Discrepancy[]
): CheckpointError {
  const errorCount = discrepancies.filter(d => d.severity === 'ERROR').length;
  return createCheckpointError(
    CheckpointErrorCode.VALIDATION_FAILED,
    `Checkpoint ${checkpointId} validation failed with ${errorCount} error(s)`,
    { checkpoint_id: checkpointId, discrepancies },
    true,
    'Review discrepancies and use appropriate recovery strategy'
  );
}

/**
 * Creates a "recovery failed" error.
 * Requirements: R09.5
 */
export function recoveryFailedError(
  checkpointId: string,
  details?: string,
  failedActions?: string[]
): CheckpointError {
  return createCheckpointError(
    CheckpointErrorCode.RECOVERY_FAILED,
    `Recovery from checkpoint ${checkpointId} failed: ${details || 'Unknown error'}`,
    { 
      checkpoint_id: checkpointId, 
      details,
      failed_actions: failedActions,
    },
    true,
    'Review the failed actions and retry or use manual recovery'
  );
}

/**
 * Creates a "write failed" error.
 */
export function writeCheckpointFailedError(
  taskId: string | null,
  details?: string
): CheckpointError {
  return createCheckpointError(
    CheckpointErrorCode.WRITE_FAILED,
    `Failed to write checkpoint${taskId ? ` for task ${taskId}` : ''}: ${details || 'Unknown error'}`,
    { task_id: taskId ?? undefined, details },
    true,
    'Check disk space and permissions, then retry'
  );
}

/**
 * Creates a "git state error" error.
 */
export function gitStateError(details?: string): CheckpointError {
  return createCheckpointError(
    CheckpointErrorCode.GIT_STATE_ERROR,
    `Failed to capture git state: ${details || 'Unknown error'}`,
    { details },
    true,
    'Ensure git repository is accessible and retry'
  );
}

/**
 * Creates a "confirmation required" error.
 * Requirements: R09.4
 */
export function confirmationRequiredError(
  checkpointId: string,
  plan: RecoveryPlan
): CheckpointError {
  return createCheckpointError(
    CheckpointErrorCode.CONFIRMATION_REQUIRED,
    `Recovery from checkpoint ${checkpointId} requires user confirmation`,
    { 
      checkpoint_id: checkpointId,
      strategy: plan.strategy,
      action_count: plan.actions.length,
    },
    true,
    'Review the recovery plan and provide confirmation to proceed'
  );
}

/**
 * Creates a "no checkpoints available" error.
 */
export function noCheckpointsAvailableError(taskId?: string): CheckpointError {
  return createCheckpointError(
    CheckpointErrorCode.NO_CHECKPOINTS_AVAILABLE,
    taskId 
      ? `No checkpoints available for task ${taskId}` 
      : 'No checkpoints available',
    { task_id: taskId },
    false,
    'Create a checkpoint first before attempting recovery'
  );
}

// =============================================================================
// Custom Error Classes
// =============================================================================

/**
 * Custom error class for checkpoint not found.
 */
export class CheckpointNotFoundError extends Error {
  public readonly code = CheckpointErrorCode.CHECKPOINT_NOT_FOUND;
  public readonly checkpointId: string;
  
  constructor(checkpointId: string) {
    super(`Checkpoint ${checkpointId} not found`);
    this.name = 'CheckpointNotFoundError';
    this.checkpointId = checkpointId;
  }
  
  toCheckpointError(): CheckpointError {
    return checkpointNotFoundError(this.checkpointId);
  }
}

/**
 * Custom error class for checkpoint stale.
 */
export class CheckpointStaleError extends Error {
  public readonly code = CheckpointErrorCode.CHECKPOINT_STALE;
  public readonly checkpointId: string;
  public readonly expectedVersion: number;
  public readonly actualVersion: number;
  
  constructor(checkpointId: string, expectedVersion: number, actualVersion: number) {
    super(`Checkpoint ${checkpointId} is stale`);
    this.name = 'CheckpointStaleError';
    this.checkpointId = checkpointId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
  
  toCheckpointError(): CheckpointError {
    return checkpointStaleError(this.checkpointId, this.expectedVersion, this.actualVersion);
  }
}

/**
 * Custom error class for confirmation required.
 */
export class ConfirmationRequiredError extends Error {
  public readonly code = CheckpointErrorCode.CONFIRMATION_REQUIRED;
  public readonly checkpointId: string;
  public readonly plan: RecoveryPlan;
  
  constructor(checkpointId: string, plan: RecoveryPlan) {
    super(`Recovery from checkpoint ${checkpointId} requires user confirmation`);
    this.name = 'ConfirmationRequiredError';
    this.checkpointId = checkpointId;
    this.plan = plan;
  }
  
  toCheckpointError(): CheckpointError {
    return confirmationRequiredError(this.checkpointId, this.plan);
  }
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for checkpoint creation.
 */
export type CreateCheckpointResult = Result<Checkpoint, CheckpointError>;

/**
 * Result type for checkpoint retrieval.
 */
export type GetCheckpointResult = Result<Checkpoint, CheckpointError>;

/**
 * Result type for checkpoint listing.
 */
export type ListCheckpointsResult = Result<Checkpoint[], CheckpointError>;

/**
 * Result type for checkpoint validation.
 */
export type ValidateCheckpointResult = Result<CheckpointValidation, CheckpointError>;

/**
 * Result type for recovery plan generation.
 */
export type PrepareRecoveryResult = Result<RecoveryPlan, CheckpointError>;

/**
 * Result type for recovery execution.
 */
export type ExecuteRecoveryResult = Result<RecoveryResult, CheckpointError>;

/**
 * Result type for checkpoint deletion.
 */
export type DeleteCheckpointResult = Result<void, CheckpointError>;

/**
 * Result type for checkpoint pruning.
 */
export type PruneCheckpointsResult = Result<PruneResult, CheckpointError>;

// =============================================================================
// Checkpoint_Manager Interface
// =============================================================================

/**
 * CheckpointManager interface for checkpoint creation, validation, and recovery.
 * 
 * This component ensures:
 * - Automatic checkpoint creation on state transitions
 * - Validation of checkpoints against current repository state
 * - Recovery planning with user confirmation
 * - Checkpoint pruning for storage management
 * 
 * Requirements: R09.1, R09.2, R09.3, R09.4, R09.5, R09.6, R09.7
 */
export interface CheckpointManager {
  // =========================================================================
  // Creation Operations
  // =========================================================================

  /**
   * Creates a checkpoint of current state.
   * 
   * Requirements: R09.1, R09.2, R09.3
   * 
   * @param trigger - What triggered the checkpoint creation
   * @param taskId - Task ID to associate with checkpoint (optional)
   * @param note - Optional user note for manual checkpoints
   * @returns Result with Checkpoint on success, or CheckpointError on failure
   * 
   * Behavior:
   * - Captures current project state version
   * - Captures current git state (branch, commit, uncommitted changes)
   * - Captures TDD phase and evidence refs
   * - Generates unique checkpoint ID
   * - Stores checkpoint to checkpoint directory
   * - Updates checkpoints summary in project state
   * 
   * Automatic triggers (R09.2):
   * - STATE_TRANSITION: Task status change
   * - TDD_PHASE_TRANSITION: TDD phase change
   * - EVIDENCE_CREATED: New evidence created
   * - HANDOFF_INITIATED: Handoff started
   * - HANDOFF_COMPLETED: Handoff completed
   * - PERIODIC: Configurable interval if activity detected
   * - MANUAL: User-triggered
   */
  createCheckpoint(
    trigger: CheckpointTrigger,
    taskId?: string,
    note?: string
  ): Promise<CreateCheckpointResult>;

  // =========================================================================
  // Retrieval Operations
  // =========================================================================

  /**
   * Gets a checkpoint by ID.
   * 
   * @param checkpointId - The checkpoint ID to retrieve
   * @returns Result with Checkpoint on success, or CheckpointError on failure
   */
  getCheckpoint(checkpointId: string): Promise<GetCheckpointResult>;

  /**
   * Lists checkpoints, optionally filtered by task.
   * 
   * @param taskId - Optional task ID to filter by
   * @returns Result with Checkpoint array on success, or CheckpointError on failure
   * 
   * Behavior:
   * - Returns checkpoints sorted by creation time (newest first)
   * - If taskId provided, returns only checkpoints for that task
   * - If taskId is null/undefined, returns all checkpoints
   */
  listCheckpoints(taskId?: string): Promise<ListCheckpointsResult>;

  /**
   * Gets the latest checkpoint for a task and/or owner.
   * 
   * @param taskId - Task ID to get latest checkpoint for
   * @param ownerId - Optional owner ID to filter by
   * @returns Result with Checkpoint on success, null if none found, or CheckpointError on failure
   */
  getLatestCheckpoint(
    taskId: string,
    ownerId?: string
  ): Promise<Result<Checkpoint | null, CheckpointError>>;

  // =========================================================================
  // Validation Operations
  // =========================================================================

  /**
   * Validates a checkpoint against current repository and project state.
   * 
   * Requirements: R09.4
   * 
   * @param checkpointId - The checkpoint ID to validate
   * @returns Result with CheckpointValidation on success, or CheckpointError on failure
   * 
   * Validation checks:
   * - Commit still exists and is reachable
   * - Branch still exists
   * - State version is still valid or newer version exists
   * - Fencing token is still valid
   * - Task status hasn't changed unexpectedly
   * 
   * Returns:
   * - valid: true if no ERROR-level discrepancies
   * - discrepancies: list of all issues found
   * - recommended_strategy: AUTO_MERGE, PROMPT_USER, or REJECT
   * - can_restore: whether recovery is possible
   */
  validateCheckpoint(checkpointId: string): Promise<ValidateCheckpointResult>;

  // =========================================================================
  // Recovery Operations
  // =========================================================================

  /**
   * Prepares a recovery plan from a checkpoint.
   * 
   * Requirements: R09.4, R09.5
   * 
   * @param checkpointId - The checkpoint ID to recover from
   * @returns Result with RecoveryPlan on success, or CheckpointError on failure
   * 
   * Behavior:
   * - Validates checkpoint
   * - Generates list of recovery actions based on discrepancies
   * - Determines recovery strategy (AUTO_MERGE, PROMPT_USER, REJECT)
   * - Preserves existing user work (uncommitted changes)
   * - Does NOT execute recovery - only prepares plan
   * 
   * Recovery strategies (R09.5):
   * - AUTO_MERGE: Changes compatible, can auto-reconcile
   * - PROMPT_USER: Conflict or ambiguous, requires user decision
   * - REJECT: Checkpoint too stale, requires fresh start
   */
  prepareRecovery(checkpointId: string): Promise<PrepareRecoveryResult>;

  /**
   * Executes a recovery plan.
   * 
   * Requirements: R09.4, R09.5
   * 
   * @param recoveryPlan - The recovery plan to execute
   * @param userConfirmation - Whether user has confirmed the recovery
   * @returns Result with RecoveryResult on success, or CheckpointError on failure
   * 
   * Behavior:
   * - If plan requires confirmation and not confirmed, returns CONFIRMATION_REQUIRED error
   * - Executes recovery actions in order
   * - Handles partial failures (some actions succeed, some fail)
   * - Returns new state version and fencing token if applicable
   * 
   * Requirements: User confirmation required before proceeding (R09.4)
   */
  executeRecovery(
    recoveryPlan: RecoveryPlan,
    userConfirmation: boolean
  ): Promise<ExecuteRecoveryResult>;

  // =========================================================================
  // Deletion Operations
  // =========================================================================

  /**
   * Deletes a checkpoint.
   * 
   * @param checkpointId - The checkpoint ID to delete
   * @returns Result with void on success, or CheckpointError on failure
   */
  deleteCheckpoint(checkpointId: string): Promise<DeleteCheckpointResult>;

  /**
   * Prunes old checkpoints based on retention policy.
   * 
   * Requirements: R09.7
   * 
   * @param options - Pruning options
   * @returns Result with PruneResult on success, or CheckpointError on failure
   * 
   * Default behavior:
   * - Keep last N checkpoints per task (default: 10)
   * - Remove checkpoints older than max age (default: 30 days)
   * - Always keep at least one checkpoint per task
   * 
   * Options:
   * - task_id: Prune only for specific task
   * - keep_count: Number to keep per task
   * - max_age_days: Maximum age in days
   * - keep_at_least_one: Keep at least one regardless of age
   * - dry_run: Report what would be deleted without deleting
   */
  pruneCheckpoints(options?: PruneOptions): Promise<PruneCheckpointsResult>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for CheckpointManager implementation.
 */
export interface CheckpointManagerConfig {
  /** Path to checkpoints storage directory */
  storagePath?: string;
  /** Default number of checkpoints to keep per task */
  defaultKeepCount?: number;
  /** Default maximum age in days for checkpoint retention */
  defaultMaxAgeDays?: number;
  /** Periodic checkpoint interval in minutes (0 to disable) */
  periodicIntervalMinutes?: number;
  /** Whether to auto-prune on checkpoint creation */
  autoPrune?: boolean;
  /** Default actor ID for system-triggered checkpoints */
  defaultActorId?: string;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Generates a unique checkpoint ID.
 * Format: CP-YYYY-MM-DD-XXX where XXX is a sequential number
 */
export function generateCheckpointId(sequenceNumber: number = 1): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const seq = String(sequenceNumber).padStart(3, '0');
  return `${CHECKPOINT_DEFAULTS.ID_PREFIX}-${dateStr}-${seq}`;
}

/**
 * Creates checkpoint metadata.
 */
export function createCheckpointMetadata(
  checkpointId: string,
  createdBy: string,
  actorType: ActorType,
  trigger: CheckpointTrigger,
  note?: string
): CheckpointMetadata {
  return {
    checkpoint_id: checkpointId,
    created_at: new Date().toISOString(),
    created_by: createdBy,
    actor_type: actorType,
    trigger,
    note,
  };
}

/**
 * Creates an empty checkpoint snapshot.
 */
export function createEmptySnapshot(): CheckpointSnapshot {
  return {
    state_version: 0,
    task_id: null,
    task_status: null,
    owner_id: null,
    fencing_token: null,
    tdd_phase: null,
    git_state: {
      branch_name: '',
      commit_sha: '',
      working_tree_dirty: false,
      uncommitted_changes: [],
    },
    evidence_refs: [],
    blockers: [],
    next_action: null,
  };
}

/**
 * Creates a recovery action.
 */
export function createRecoveryAction(
  actionId: string,
  type: RecoveryActionType,
  description: string,
  order: number,
  options?: Partial<Omit<RecoveryAction, 'action_id' | 'type' | 'description' | 'order'>>
): RecoveryAction {
  return {
    action_id: actionId,
    type,
    description,
    order,
    requires_confirmation: options?.requires_confirmation ?? false,
    reversible: options?.reversible ?? true,
    params: options?.params,
    depends_on: options?.depends_on,
  };
}

/**
 * Creates a discrepancy object.
 */
export function createDiscrepancy(
  type: DiscrepancyType,
  description: string,
  severity: Discrepancy['severity'],
  recoverable: boolean,
  expected?: unknown,
  actual?: unknown
): Discrepancy {
  return {
    type,
    description,
    severity,
    recoverable,
    expected,
    actual,
  };
}

// =============================================================================
// Helper Result Functions
// =============================================================================

/**
 * Creates a successful checkpoint creation result.
 */
export function createCheckpointSuccess(checkpoint: Checkpoint): CreateCheckpointResult {
  return ok(checkpoint);
}

/**
 * Creates a failed checkpoint creation result.
 */
export function createCheckpointFailure(error: CheckpointError): CreateCheckpointResult {
  return err(error);
}

/**
 * Creates a successful validation result.
 */
export function validateCheckpointSuccess(validation: CheckpointValidation): ValidateCheckpointResult {
  return ok(validation);
}

/**
 * Creates a failed validation result.
 */
export function validateCheckpointFailure(error: CheckpointError): ValidateCheckpointResult {
  return err(error);
}

/**
 * Creates a successful recovery plan result.
 */
export function prepareRecoverySuccess(plan: RecoveryPlan): PrepareRecoveryResult {
  return ok(plan);
}

/**
 * Creates a failed recovery plan result.
 */
export function prepareRecoveryFailure(error: CheckpointError): PrepareRecoveryResult {
  return err(error);
}

/**
 * Creates a successful recovery execution result.
 */
export function executeRecoverySuccess(result: RecoveryResult): ExecuteRecoveryResult {
  return ok(result);
}

/**
 * Creates a failed recovery execution result.
 */
export function executeRecoveryFailure(error: CheckpointError): ExecuteRecoveryResult {
  return err(error);
}

/**
 * Creates a successful prune result.
 */
export function pruneSuccess(result: PruneResult): PruneCheckpointsResult {
  return ok(result);
}

/**
 * Creates a failed prune result.
 */
export function pruneFailure(error: CheckpointError): PruneCheckpointsResult {
  return err(error);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Determines recovery strategy based on discrepancies.
 * Requirements: R09.5
 */
export function determineRecoveryStrategy(discrepancies: Discrepancy[]): RecoveryStrategy {
  const errors = discrepancies.filter(d => d.severity === 'ERROR');
  const warnings = discrepancies.filter(d => d.severity === 'WARNING');
  
  // No errors and recoverable warnings -> AUTO_MERGE
  if (errors.length === 0 && warnings.every(w => w.recoverable)) {
    return 'AUTO_MERGE';
  }
  
  // Some errors are recoverable -> PROMPT_USER
  if (errors.some(e => e.recoverable)) {
    return 'PROMPT_USER';
  }
  
  // Non-recoverable errors -> REJECT
  if (errors.some(e => !e.recoverable)) {
    return 'REJECT';
  }
  
  // Default to PROMPT_USER for ambiguous cases
  return 'PROMPT_USER';
}

/**
 * Checks if a checkpoint trigger is valid.
 */
export function isValidTrigger(trigger: unknown): trigger is CheckpointTrigger {
  const validTriggers: CheckpointTrigger[] = [
    'STATE_TRANSITION',
    'TDD_PHASE_TRANSITION',
    'EVIDENCE_CREATED',
    'HANDOFF_INITIATED',
    'HANDOFF_COMPLETED',
    'PERIODIC',
    'MANUAL',
  ];
  return typeof trigger === 'string' && validTriggers.includes(trigger as CheckpointTrigger);
}

/**
 * Calculates checkpoint age in days.
 */
export function getCheckpointAgeDays(checkpoint: Checkpoint): number {
  const createdAt = new Date(checkpoint.metadata.created_at);
  const now = new Date();
  const diffMs = now.getTime() - createdAt.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Sorts checkpoints by creation time (newest first).
 */
export function sortCheckpointsByDate(checkpoints: Checkpoint[]): Checkpoint[] {
  return [...checkpoints].sort((a, b) => {
    const dateA = new Date(a.metadata.created_at);
    const dateB = new Date(b.metadata.created_at);
    return dateB.getTime() - dateA.getTime();
  });
}

/**
 * Filters checkpoints by task ID.
 */
export function filterCheckpointsByTask(
  checkpoints: Checkpoint[],
  taskId: string
): Checkpoint[] {
  return checkpoints.filter(cp => cp.snapshot.task_id === taskId);
}

/**
 * Groups checkpoints by task ID.
 */
export function groupCheckpointsByTask(
  checkpoints: Checkpoint[]
): Map<string, Checkpoint[]> {
  const groups = new Map<string, Checkpoint[]>();
  
  for (const checkpoint of checkpoints) {
    const taskId = checkpoint.snapshot.task_id ?? '__no_task__';
    const existing = groups.get(taskId) ?? [];
    existing.push(checkpoint);
    groups.set(taskId, existing);
  }
  
  return groups;
}
