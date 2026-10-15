/**
 * Ownership Manager - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Ownership_Manager component
 * which provides task ownership, lease management, and fencing token operations.
 * 
 * The Ownership_Manager ensures exclusive task ownership with support for both human
 * developers (no lease timeout) and AI agents (lease-based ownership with heartbeat).
 * 
 * Requirements: R02.3, R02.5, R02.6, R02.7, R02.8, R02.9, R02.10, R08.2
 */

import { 
  ActorType, 
  Result, 
  ok, 
  err,
  TaskOwnership,
  LeaseInfo,
} from './state-controller';

// =============================================================================
// Re-exports from state-controller for convenience
// =============================================================================

export { ActorType, TaskOwnership, LeaseInfo } from './state-controller';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for ownership operations.
 * Requirements: R02.7
 */
export const OWNERSHIP_DEFAULTS = {
  /** Default lease duration for AI agents in seconds (1 hour) */
  LEASE_DURATION_SECONDS: 3600,
  /** Default heartbeat interval for AI agents in seconds (5 minutes) */
  HEARTBEAT_INTERVAL_SECONDS: 300,
  /** Grace period multiplier for heartbeat (lease expires if no heartbeat for this many intervals) */
  HEARTBEAT_GRACE_MULTIPLIER: 2,
  /** Default inactivity warning threshold for humans in seconds (2 hours) */
  INACTIVITY_WARNING_SECONDS: 7200,
  /** Default handoff timeout in hours */
  HANDOFF_TIMEOUT_HOURS: 24,
  /** Maximum ownership history entries to keep per task */
  MAX_OWNERSHIP_HISTORY: 50,
} as const;

// =============================================================================
// Type Definitions - Fencing Token
// =============================================================================

/**
 * Fencing token type - UUID v4 string that uniquely identifies an ownership period.
 * Used to prevent stale owners from making changes after ownership has been transferred.
 * Requirements: R02.5
 */
export type FencingToken = string;

/**
 * Validates if a string is a valid UUID v4 format (fencing token format).
 */
export function isValidFencingToken(token: unknown): token is FencingToken {
  if (typeof token !== 'string') return false;
  // UUID v4 format validation
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(token);
}

/**
 * Generates a new fencing token (UUID v4).
 * Requirements: R02.5
 */
export function generateFencingToken(): FencingToken {
  // Simple UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// =============================================================================
// Type Definitions - Extended Lease Info
// =============================================================================

/**
 * Extended lease information for ownership operations.
 * Requirements: R02.7
 */
export interface ExtendedLeaseInfo extends LeaseInfo {
  /** Duration of the lease in seconds */
  duration_seconds: number;
  /** Whether the lease has been extended at least once */
  extended: boolean;
  /** Number of times the lease has been extended */
  extension_count: number;
}

/**
 * Lease configuration for ownership claims.
 * Requirements: R02.7
 */
export interface LeaseConfig {
  /** Duration of the lease in seconds (null for human = no lease) */
  duration_seconds: number | null;
  /** Heartbeat interval in seconds (null for human = no heartbeat required) */
  heartbeat_interval_seconds: number | null;
}

// =============================================================================
// Type Definitions - Ownership History
// =============================================================================

/**
 * Reason for ownership release.
 */
export type ReleaseReason = 
  | 'explicit_release'   // Owner explicitly released
  | 'handoff'            // Ownership transferred via handoff
  | 'lease_expired'      // AI agent lease expired
  | 'abandoned'          // Task was abandoned
  | 'reassigned'         // Reassigned by project lead
  | 'task_completed'     // Task completed
  | 'task_cancelled';    // Task was cancelled

/**
 * Historical ownership entry for a task.
 * Requirements: R02.5, R08.2
 */
export interface OwnershipHistoryEntry {
  /** The fencing token for this ownership period */
  token: FencingToken;
  /** Owner ID who held ownership */
  owner_id: string;
  /** Type of actor */
  actor_type: ActorType;
  /** ISO 8601 timestamp when ownership was acquired */
  acquired_at: string;
  /** ISO 8601 timestamp when ownership was released (null if still active) */
  released_at: string | null;
  /** Reason for release (null if still active) */
  release_reason: ReleaseReason | null;
  /** Additional context about the release */
  release_context?: string;
}

// =============================================================================
// Type Definitions - Claim Result
// =============================================================================

/**
 * Result of a successful task claim operation.
 * Requirements: R02.3, R02.5, R02.7
 */
export interface ClaimResult {
  /** The newly issued fencing token */
  fencing_token: FencingToken;
  /** ISO 8601 timestamp when ownership was acquired */
  acquired_at: string;
  /** Lease information (present only for AI agents) */
  lease?: ExtendedLeaseInfo;
}

// =============================================================================
// Type Definitions - Heartbeat Result
// =============================================================================

/**
 * Result of a heartbeat operation.
 * Requirements: R02.7, R02.8
 */
export interface HeartbeatResult {
  /** Whether the lease was extended */
  lease_extended: boolean;
  /** New lease expiry timestamp if extended */
  new_expires_at?: string;
  /** Time remaining until lease expires (in seconds) */
  time_remaining_seconds: number;
  /** Whether lease is in warning state (close to expiry) */
  warning: boolean;
}

// =============================================================================
// Type Definitions - Transfer Result
// =============================================================================

/**
 * Result of an ownership transfer operation.
 * Requirements: R02.6, R08.2
 */
export interface TransferResult {
  /** The newly issued fencing token for the new owner */
  new_fencing_token: FencingToken;
  /** ISO 8601 timestamp of the transfer */
  transferred_at: string;
  /** The invalidated fencing token */
  old_fencing_token: FencingToken;
  /** New lease info if the new owner is an AI agent */
  new_lease?: ExtendedLeaseInfo;
}

// =============================================================================
// Type Definitions - Lease Check Result
// =============================================================================

/**
 * Result of checking expired leases.
 * Requirements: R02.8, R02.9
 */
export interface ExpiredLeasesResult {
  /** List of task IDs with expired leases */
  expired_tasks: string[];
  /** Details for each expired task */
  details: ExpiredLeaseDetail[];
}

/**
 * Details about an expired lease.
 */
export interface ExpiredLeaseDetail {
  /** Task ID */
  task_id: string;
  /** Owner ID whose lease expired */
  owner_id: string;
  /** When the lease expired */
  expired_at: string;
  /** Last heartbeat timestamp */
  last_heartbeat_at: string | null;
  /** The invalidated fencing token */
  fencing_token: FencingToken;
}

// =============================================================================
// Type Definitions - Validation Result
// =============================================================================

/**
 * Result of fencing token validation.
 * Requirements: R02.6
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Reason if invalid */
  invalid_reason?: TokenInvalidReason;
  /** Time remaining if valid (null for human owners) */
  time_remaining_seconds?: number | null;
  /** Whether the lease is in warning state */
  warning?: boolean;
}

/**
 * Reasons why a fencing token might be invalid.
 */
export type TokenInvalidReason = 
  | 'TOKEN_NOT_FOUND'      // Token doesn't exist
  | 'TOKEN_EXPIRED'        // Token's lease has expired
  | 'TOKEN_SUPERSEDED'     // Token was replaced by a newer one
  | 'TASK_NOT_FOUND'       // Task doesn't exist
  | 'TOKEN_FORMAT_INVALID' // Token format is invalid
  | 'OWNERSHIP_MISMATCH';  // Token doesn't match current ownership

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Ownership error codes following the design specification.
 * Error codes in range 2100-2199 for OWNERSHIP_ERROR category.
 * Requirements: R02.3, R02.4, R02.6, R02.8
 */
export enum OwnershipErrorCode {
  /** Task already has an active owner */
  TASK_ALREADY_CLAIMED = 2101,
  /** Fencing token is invalid or expired */
  INVALID_FENCING_TOKEN = 2102,
  /** AI agent lease has expired */
  LEASE_EXPIRED = 2103,
  /** Task not found */
  TASK_NOT_FOUND = 2104,
  /** Cannot claim task in current state */
  INVALID_TASK_STATE = 2105,
  /** Owner not found */
  OWNER_NOT_FOUND = 2106,
  /** Heartbeat failed */
  HEARTBEAT_FAILED = 2107,
  /** Transfer failed */
  TRANSFER_FAILED = 2108,
  /** Release failed */
  RELEASE_FAILED = 2109,
  /** Invalid actor type for operation */
  INVALID_ACTOR_TYPE = 2110,
  /** Operation requires human approval */
  HUMAN_APPROVAL_REQUIRED = 2111,
  /** Task is abandoned */
  TASK_ABANDONED = 2112,
  /** Claim operation failed atomically */
  CLAIM_FAILED = 2113,
}

/**
 * Ownership error structure following the design specification.
 */
export interface OwnershipError {
  /** Error code from OwnershipErrorCode enum */
  code: OwnershipErrorCode;
  /** Error category */
  category: 'OWNERSHIP_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    task_id?: string;
    owner_id?: string;
    fencing_token?: string;
    current_owner?: string;
    expected_state?: string;
    actual_state?: string;
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
 * Creates an OwnershipError with the given code and details.
 */
export function createOwnershipError(
  code: OwnershipErrorCode,
  message: string,
  context?: OwnershipError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): OwnershipError {
  return {
    code,
    category: 'OWNERSHIP_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "task already claimed" error.
 * Requirements: R02.4
 */
export function taskAlreadyClaimedError(
  taskId: string,
  currentOwner: string,
  requestedBy: string
): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.TASK_ALREADY_CLAIMED,
    `Task ${taskId} is already claimed by ${currentOwner}`,
    { 
      task_id: taskId,
      current_owner: currentOwner,
      owner_id: requestedBy,
    },
    false,
    'Request handoff from the current owner or wait for them to release the task'
  );
}

/**
 * Creates an "invalid fencing token" error.
 * Requirements: R02.6
 */
export function invalidFencingTokenError(
  taskId: string,
  providedToken: string,
  reason: TokenInvalidReason
): OwnershipError {
  const reasonMessages: Record<TokenInvalidReason, string> = {
    TOKEN_NOT_FOUND: 'Token does not exist',
    TOKEN_EXPIRED: 'Token lease has expired',
    TOKEN_SUPERSEDED: 'Token has been replaced by a newer one',
    TASK_NOT_FOUND: 'Task does not exist',
    TOKEN_FORMAT_INVALID: 'Token format is invalid',
    OWNERSHIP_MISMATCH: 'Token does not match current task ownership',
  };

  return createOwnershipError(
    OwnershipErrorCode.INVALID_FENCING_TOKEN,
    `Invalid fencing token for task ${taskId}: ${reasonMessages[reason]}`,
    { 
      task_id: taskId,
      fencing_token: providedToken,
      details: reason,
    },
    false,
    'Re-claim the task to obtain a new fencing token'
  );
}

/**
 * Creates a "lease expired" error.
 * Requirements: R02.8, R02.9
 */
export function leaseExpiredError(
  taskId: string,
  ownerId: string,
  expiredAt: string
): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.LEASE_EXPIRED,
    `Lease for task ${taskId} held by ${ownerId} expired at ${expiredAt}`,
    { 
      task_id: taskId,
      owner_id: ownerId,
      details: `Lease expired at ${expiredAt}`,
    },
    true, // recoverable - can reclaim
    'Re-claim the task to obtain a new lease'
  );
}

/**
 * Creates a "task not found" error.
 */
export function taskNotFoundError(taskId: string): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.TASK_NOT_FOUND,
    `Task ${taskId} not found`,
    { task_id: taskId },
    false,
    'Verify the task ID is correct'
  );
}

/**
 * Creates an "invalid task state" error.
 */
export function invalidTaskStateError(
  taskId: string,
  currentState: string,
  expectedStates: string[]
): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.INVALID_TASK_STATE,
    `Cannot claim task ${taskId}: current state '${currentState}' is not claimable`,
    { 
      task_id: taskId,
      actual_state: currentState,
      expected_state: expectedStates.join(', '),
    },
    false,
    `Task must be in one of: ${expectedStates.join(', ')}`
  );
}

/**
 * Creates a "task abandoned" error.
 */
export function taskAbandonedError(taskId: string): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.TASK_ABANDONED,
    `Task ${taskId} is marked as abandoned and must be explicitly reclaimed`,
    { task_id: taskId },
    true,
    'Explicitly reclaim the abandoned task to take ownership'
  );
}

/**
 * Creates a "claim failed" error for atomic operation failures.
 * Requirements: R02.3
 */
export function claimFailedError(
  taskId: string,
  ownerId: string,
  details?: string
): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.CLAIM_FAILED,
    `Failed to atomically claim task ${taskId}: ${details || 'Unknown error'}`,
    { 
      task_id: taskId,
      owner_id: ownerId,
      details,
    },
    true,
    'Retry the claim operation'
  );
}

/**
 * Creates a "transfer failed" error.
 */
export function transferFailedError(
  taskId: string,
  fromOwner: string,
  toOwner: string,
  details?: string
): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.TRANSFER_FAILED,
    `Failed to transfer task ${taskId} from ${fromOwner} to ${toOwner}: ${details || 'Unknown error'}`,
    { 
      task_id: taskId,
      current_owner: fromOwner,
      owner_id: toOwner,
      details,
    },
    true,
    'Retry the transfer operation'
  );
}

/**
 * Creates a "release failed" error.
 */
export function releaseFailedError(
  taskId: string,
  ownerId: string,
  details?: string
): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.RELEASE_FAILED,
    `Failed to release task ${taskId} by ${ownerId}: ${details || 'Unknown error'}`,
    { 
      task_id: taskId,
      owner_id: ownerId,
      details,
    },
    true,
    'Retry the release operation'
  );
}

/**
 * Creates a "heartbeat failed" error.
 */
export function heartbeatFailedError(
  taskId: string,
  fencingToken: string,
  details?: string
): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.HEARTBEAT_FAILED,
    `Heartbeat failed for task ${taskId}: ${details || 'Unknown error'}`,
    { 
      task_id: taskId,
      fencing_token: fencingToken,
      details,
    },
    true,
    'Retry the heartbeat or reclaim the task'
  );
}

/**
 * Creates a "token validation failed" error.
 * Requirements: R02.6
 */
export function tokenValidationFailedError(
  taskId: string,
  fencingToken: string,
  details?: string
): OwnershipError {
  return createOwnershipError(
    OwnershipErrorCode.INVALID_FENCING_TOKEN,
    `Token validation failed for task ${taskId}: ${details || 'Unknown error'}`,
    { 
      task_id: taskId,
      fencing_token: fencingToken,
      details,
    },
    false,
    'Re-claim the task to obtain a new fencing token'
  );
}

// =============================================================================
// Custom Error Classes
// =============================================================================

/**
 * Custom error class for task already claimed.
 */
export class TaskAlreadyClaimedError extends Error {
  public readonly code = OwnershipErrorCode.TASK_ALREADY_CLAIMED;
  public readonly taskId: string;
  public readonly currentOwner: string;
  public readonly requestedBy: string;
  
  constructor(taskId: string, currentOwner: string, requestedBy: string) {
    super(`Task ${taskId} is already claimed by ${currentOwner}`);
    this.name = 'TaskAlreadyClaimedError';
    this.taskId = taskId;
    this.currentOwner = currentOwner;
    this.requestedBy = requestedBy;
  }
  
  toOwnershipError(): OwnershipError {
    return taskAlreadyClaimedError(this.taskId, this.currentOwner, this.requestedBy);
  }
}

/**
 * Custom error class for invalid fencing token.
 */
export class InvalidFencingTokenError extends Error {
  public readonly code = OwnershipErrorCode.INVALID_FENCING_TOKEN;
  public readonly taskId: string;
  public readonly providedToken: string;
  public readonly reason: TokenInvalidReason;
  
  constructor(taskId: string, providedToken: string, reason: TokenInvalidReason) {
    super(`Invalid fencing token for task ${taskId}: ${reason}`);
    this.name = 'InvalidFencingTokenError';
    this.taskId = taskId;
    this.providedToken = providedToken;
    this.reason = reason;
  }
  
  toOwnershipError(): OwnershipError {
    return invalidFencingTokenError(this.taskId, this.providedToken, this.reason);
  }
}

/**
 * Custom error class for lease expired.
 */
export class LeaseExpiredError extends Error {
  public readonly code = OwnershipErrorCode.LEASE_EXPIRED;
  public readonly taskId: string;
  public readonly ownerId: string;
  public readonly expiredAt: string;
  
  constructor(taskId: string, ownerId: string, expiredAt: string) {
    super(`Lease for task ${taskId} held by ${ownerId} expired at ${expiredAt}`);
    this.name = 'LeaseExpiredError';
    this.taskId = taskId;
    this.ownerId = ownerId;
    this.expiredAt = expiredAt;
  }
  
  toOwnershipError(): OwnershipError {
    return leaseExpiredError(this.taskId, this.ownerId, this.expiredAt);
  }
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for claim operation.
 */
export type ClaimTaskResult = Result<ClaimResult, OwnershipError>;

/**
 * Result type for release operation.
 */
export type ReleaseTaskResult = Result<void, OwnershipError>;

/**
 * Result type for token validation.
 */
export type ValidateTokenResult = Result<TokenValidationResult, OwnershipError>;

/**
 * Result type for heartbeat operation.
 */
export type RecordHeartbeatResult = Result<HeartbeatResult, OwnershipError>;

/**
 * Result type for expired leases check.
 */
export type CheckExpiredLeasesResult = Result<ExpiredLeasesResult, OwnershipError>;

/**
 * Result type for transfer operation.
 */
export type TransferOwnershipResult = Result<TransferResult, OwnershipError>;

// =============================================================================
// Ownership_Manager Interface
// =============================================================================

/**
 * OwnershipManager interface for task ownership, lease management, and fencing tokens.
 * 
 * This component ensures:
 * - Atomic task ownership claims with fencing tokens
 * - Lease-based ownership for AI agents with heartbeat requirements
 * - Safe ownership transfers during handoffs
 * - Expired lease detection and handling
 * 
 * Requirements: R02.3, R02.5, R02.6, R02.7, R02.8, R02.9, R02.10, R08.2
 */
export interface OwnershipManager {
  // =========================================================================
  // Claim Operations
  // =========================================================================

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
   * 
   * Behavior:
   * - Generates unique fencing token (UUID v4)
   * - Records ownership atomically via State_Controller
   * - For AI_AGENT: Creates lease with configured duration and heartbeat interval
   * - For HUMAN: No lease timeout (lease fields null)
   * 
   * Errors:
   * - TASK_ALREADY_CLAIMED: If task has active owner
   * - TASK_NOT_FOUND: If task doesn't exist
   * - INVALID_TASK_STATE: If task cannot be claimed in current state
   * - CLAIM_FAILED: If atomic claim operation fails
   */
  claimTask(
    taskId: string, 
    ownerId: string, 
    actorType: ActorType
  ): Promise<ClaimTaskResult>;

  // =========================================================================
  // Release Operations
  // =========================================================================

  /**
   * Releases ownership of a task explicitly.
   * Invalidates the fencing token.
   * 
   * Requirements: R02.5, R02.6
   * 
   * @param taskId - The task to release
   * @param fencingToken - The current valid fencing token
   * @returns Result with void on success, or OwnershipError on failure
   * 
   * Behavior:
   * - Validates fencing token matches current ownership
   * - Clears ownership fields
   * - Records release in ownership history
   * - Task becomes available for claim
   * 
   * Errors:
   * - INVALID_FENCING_TOKEN: If token doesn't match
   * - TASK_NOT_FOUND: If task doesn't exist
   * - RELEASE_FAILED: If release operation fails
   */
  releaseTask(
    taskId: string, 
    fencingToken: FencingToken
  ): Promise<ReleaseTaskResult>;

  // =========================================================================
  // Validation Operations
  // =========================================================================

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
   * - Checks token format validity
   * - Checks token matches current ownership
   * - For AI_AGENT: Checks lease hasn't expired
   * - Returns time remaining and warning state for AI agents
   * 
   * The returned TokenValidationResult includes:
   * - valid: boolean indicating if token is valid
   * - invalid_reason: reason if invalid
   * - time_remaining_seconds: for AI agents, seconds until lease expires
   * - warning: true if lease is close to expiry
   */
  validateFencingToken(
    taskId: string, 
    fencingToken: FencingToken
  ): Promise<ValidateTokenResult>;

  // =========================================================================
  // Heartbeat Operations (AI Agent)
  // =========================================================================

  /**
   * Records a heartbeat for an AI agent.
   * Extends lease if close to expiry.
   * 
   * Requirements: R02.7, R02.8
   * 
   * @param taskId - The task to heartbeat
   * @param fencingToken - The current valid fencing token
   * @returns Result with HeartbeatResult on success, or OwnershipError on failure
   * 
   * Behavior:
   * - Validates fencing token
   * - Updates last_heartbeat_at timestamp
   * - Extends lease if within extension threshold
   * - Returns warning if lease is close to expiry
   * 
   * Errors:
   * - INVALID_FENCING_TOKEN: If token doesn't match
   * - LEASE_EXPIRED: If lease has already expired
   * - HEARTBEAT_FAILED: If heartbeat operation fails
   */
  recordHeartbeat(
    taskId: string, 
    fencingToken: FencingToken
  ): Promise<RecordHeartbeatResult>;

  // =========================================================================
  // Lease Expiry Operations
  // =========================================================================

  /**
   * Checks and handles expired leases.
   * Called periodically by the system.
   * 
   * Requirements: R02.8, R02.9
   * 
   * @returns Result with ExpiredLeasesResult on success, or OwnershipError on failure
   * 
   * Behavior:
   * - Scans all tasks with AI agent ownership
   * - Identifies leases where last_heartbeat + (2 * interval) < current_time
   * - Marks expired tasks as ABANDONED
   * - Records expiry in audit log
   * - Invalidates fencing tokens for expired leases
   * 
   * The returned ExpiredLeasesResult includes:
   * - expired_tasks: array of task IDs that expired
   * - details: detailed information about each expiry
   */
  checkExpiredLeases(): Promise<CheckExpiredLeasesResult>;

  // =========================================================================
  // Transfer Operations
  // =========================================================================

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
   * @returns Result with TransferResult on success, or OwnershipError on failure
   * 
   * Behavior:
   * - Validates source fencing token
   * - Atomically: invalidates old token, generates new token, transfers ownership
   * - Records transfer in ownership history for both parties
   * - For AI_AGENT target: Creates new lease
   * 
   * Errors:
   * - INVALID_FENCING_TOKEN: If source token doesn't match
   * - TASK_NOT_FOUND: If task doesn't exist
   * - TRANSFER_FAILED: If atomic transfer fails
   */
  transferOwnership(
    taskId: string,
    fromFencingToken: FencingToken,
    toOwnerId: string,
    toActorType: ActorType
  ): Promise<TransferOwnershipResult>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for OwnershipManager implementation.
 */
export interface OwnershipManagerConfig {
  /** Default lease duration for AI agents in seconds */
  leaseDurationSeconds?: number;
  /** Default heartbeat interval for AI agents in seconds */
  heartbeatIntervalSeconds?: number;
  /** Grace period multiplier for heartbeat timeout */
  heartbeatGraceMultiplier?: number;
  /** Inactivity warning threshold for humans in seconds */
  inactivityWarningSeconds?: number;
  /** Maximum ownership history entries to keep */
  maxOwnershipHistory?: number;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates default lease config for AI agents.
 * Requirements: R02.7
 */
export function createDefaultAIAgentLeaseConfig(): LeaseConfig {
  return {
    duration_seconds: OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS,
    heartbeat_interval_seconds: OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS,
  };
}

/**
 * Creates lease config for human (no lease).
 * Requirements: R02.10
 */
export function createHumanLeaseConfig(): LeaseConfig {
  return {
    duration_seconds: null,
    heartbeat_interval_seconds: null,
  };
}

/**
 * Creates a new lease info for an AI agent claim.
 * Requirements: R02.7
 */
export function createLeaseInfo(
  durationSeconds: number = OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS,
  heartbeatIntervalSeconds: number = OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS
): ExtendedLeaseInfo {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationSeconds * 1000);
  
  return {
    lease_expires_at: expiresAt.toISOString(),
    last_heartbeat_at: now.toISOString(),
    heartbeat_interval_seconds: heartbeatIntervalSeconds,
    duration_seconds: durationSeconds,
    extended: false,
    extension_count: 0,
  };
}

/**
 * Creates a new task ownership record.
 * Requirements: R02.5, R02.7
 */
export function createTaskOwnership(
  ownerId: string,
  actorType: ActorType,
  leaseConfig?: LeaseConfig
): { ownership: TaskOwnership; fencingToken: FencingToken } {
  const now = new Date().toISOString();
  const fencingToken = generateFencingToken();
  
  let leaseExpiresAt: string | null = null;
  let lastHeartbeatAt: string | null = null;
  
  if (actorType === 'AI_AGENT') {
    const config = leaseConfig ?? createDefaultAIAgentLeaseConfig();
    if (config.duration_seconds !== null) {
      const expiresAt = new Date(Date.now() + config.duration_seconds * 1000);
      leaseExpiresAt = expiresAt.toISOString();
      lastHeartbeatAt = now;
    }
  }
  
  return {
    ownership: {
      fencing_token: fencingToken,
      acquired_at: now,
      actor_type: actorType,
      lease_expires_at: leaseExpiresAt,
      last_heartbeat_at: lastHeartbeatAt,
    },
    fencingToken,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Checks if a lease has expired.
 * Requirements: R02.8
 * 
 * @param ownership - The task ownership to check
 * @param heartbeatGraceMultiplier - Multiplier for heartbeat interval (default: 2)
 * @returns true if lease has expired, false otherwise
 */
export function isLeaseExpired(
  ownership: TaskOwnership,
  heartbeatGraceMultiplier: number = OWNERSHIP_DEFAULTS.HEARTBEAT_GRACE_MULTIPLIER
): boolean {
  // Human owners don't have lease expiry
  if (ownership.actor_type !== 'AI_AGENT') {
    return false;
  }
  
  // If no lease expiry set, not expired
  if (!ownership.lease_expires_at) {
    return false;
  }
  
  // Check if past expiry time
  const expiresAt = new Date(ownership.lease_expires_at);
  if (Date.now() > expiresAt.getTime()) {
    return true;
  }
  
  // Check heartbeat grace period
  if (ownership.last_heartbeat_at) {
    const lastHeartbeat = new Date(ownership.last_heartbeat_at);
    // Assume default heartbeat interval if not available
    const heartbeatIntervalMs = OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS * 1000;
    const gracePeriodMs = heartbeatIntervalMs * heartbeatGraceMultiplier;
    const deadlineMs = lastHeartbeat.getTime() + gracePeriodMs;
    
    if (Date.now() > deadlineMs) {
      return true;
    }
  }
  
  return false;
}

/**
 * Calculates time remaining until lease expires.
 * Requirements: R02.7
 * 
 * @param ownership - The task ownership to check
 * @returns Time remaining in seconds, or null for human owners
 */
export function getLeaseTimeRemaining(ownership: TaskOwnership): number | null {
  if (ownership.actor_type !== 'AI_AGENT' || !ownership.lease_expires_at) {
    return null;
  }
  
  const expiresAt = new Date(ownership.lease_expires_at);
  const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return remaining;
}

/**
 * Checks if lease is in warning state (close to expiry).
 * Warning is issued when less than one heartbeat interval remains.
 * 
 * @param ownership - The task ownership to check
 * @param warningThresholdSeconds - Threshold in seconds (default: heartbeat interval)
 * @returns true if in warning state, false otherwise
 */
export function isLeaseInWarningState(
  ownership: TaskOwnership,
  warningThresholdSeconds?: number
): boolean {
  const remaining = getLeaseTimeRemaining(ownership);
  if (remaining === null) {
    return false;
  }
  
  const threshold = warningThresholdSeconds ?? OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS;
  return remaining <= threshold;
}

/**
 * Creates an ownership history entry.
 */
export function createOwnershipHistoryEntry(
  token: FencingToken,
  ownerId: string,
  actorType: ActorType,
  acquiredAt: string,
  releasedAt: string | null = null,
  releaseReason: ReleaseReason | null = null,
  releaseContext?: string
): OwnershipHistoryEntry {
  return {
    token,
    owner_id: ownerId,
    actor_type: actorType,
    acquired_at: acquiredAt,
    released_at: releasedAt,
    release_reason: releaseReason,
    release_context: releaseContext,
  };
}

// =============================================================================
// Helper Result Functions
// =============================================================================

/**
 * Creates a successful claim result.
 */
export function claimSuccess(result: ClaimResult): ClaimTaskResult {
  return ok(result);
}

/**
 * Creates a failed claim result.
 */
export function claimFailure(error: OwnershipError): ClaimTaskResult {
  return err(error);
}

/**
 * Creates a successful release result.
 */
export function releaseSuccess(): ReleaseTaskResult {
  return ok(undefined);
}

/**
 * Creates a failed release result.
 */
export function releaseFailure(error: OwnershipError): ReleaseTaskResult {
  return err(error);
}

/**
 * Creates a successful validation result.
 */
export function validationSuccess(result: TokenValidationResult): ValidateTokenResult {
  return ok(result);
}

/**
 * Creates a failed validation result.
 */
export function validationFailure(error: OwnershipError): ValidateTokenResult {
  return err(error);
}

/**
 * Creates a successful heartbeat result.
 */
export function heartbeatSuccess(result: HeartbeatResult): RecordHeartbeatResult {
  return ok(result);
}

/**
 * Creates a failed heartbeat result.
 */
export function heartbeatFailure(error: OwnershipError): RecordHeartbeatResult {
  return err(error);
}

/**
 * Creates a successful transfer result.
 */
export function transferSuccess(result: TransferResult): TransferOwnershipResult {
  return ok(result);
}

/**
 * Creates a failed transfer result.
 */
export function transferFailure(error: OwnershipError): TransferOwnershipResult {
  return err(error);
}
