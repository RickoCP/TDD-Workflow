/**
 * State Controller - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the State_Controller component
 * which provides atomic state read/write operations with optimistic concurrency control.
 * 
 * The State_Controller is the foundation component for SDLC Workflow reliability,
 * ensuring consistent state management with version tracking and conflict detection.
 * 
 * Requirements: R02.1, R02.2, R16.1
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for state controller operations.
 */
export const STATE_CONTROLLER_DEFAULTS = {
  /** Default number of retries for updateState operation */
  MAX_RETRIES: 3,
  /** Default version number for states without version field (backward compat) */
  DEFAULT_VERSION: 1,
  /** Base delay in milliseconds for exponential backoff */
  BASE_RETRY_DELAY_MS: 100,
  /** Schema version for new reliability features */
  SCHEMA_VERSION: '2',
} as const;

/**
 * Valid schema versions supported by the State_Controller.
 */
export const SUPPORTED_SCHEMA_VERSIONS = ['1', '2'] as const;

// =============================================================================
// Type Definitions - State Versioning
// =============================================================================

/**
 * Schema version type derived from supported versions.
 */
export type SchemaVersion = typeof SUPPORTED_SCHEMA_VERSIONS[number];

/**
 * Actor type for tracking who made state changes.
 * Requirements: R12.1
 */
export type ActorType = 'HUMAN' | 'AI_AGENT' | 'SYSTEM';

/**
 * State version metadata for optimistic concurrency control.
 * Requirements: R02.1
 */
export interface StateVersionMetadata {
  /** Current version number, incremented on every write */
  state_version: number;
  /** ISO 8601 timestamp of last modification */
  last_modified_at: string;
  /** ID of the actor who made the last modification */
  last_modified_by: string;
}

// =============================================================================
// Type Definitions - Ownership
// =============================================================================

/**
 * Lease information for AI agents.
 * Requirements: R02.7
 */
export interface LeaseInfo {
  /** ISO 8601 timestamp when lease expires */
  lease_expires_at: string | null;
  /** Timestamp of last heartbeat */
  last_heartbeat_at: string | null;
  /** Heartbeat interval in seconds */
  heartbeat_interval_seconds: number;
}

/**
 * Task ownership details.
 * Requirements: R02.5, R02.6, R02.7
 */
export interface TaskOwnership {
  /** UUID v4 fencing token for ownership validation */
  fencing_token: string;
  /** ISO 8601 timestamp when ownership was acquired */
  acquired_at: string;
  /** Type of actor holding ownership */
  actor_type: ActorType;
  /** Lease expiry for AI agents (null for humans) */
  lease_expires_at: string | null;
  /** Last heartbeat timestamp for AI agents */
  last_heartbeat_at: string | null;
}

// =============================================================================
// Type Definitions - Definition of Ready
// =============================================================================

/**
 * DoR condition check result.
 * Requirements: R01.2
 */
export interface DoRConditionResult {
  /** Unique condition identifier */
  condition: string;
  /** Whether the condition passed */
  passed: boolean;
  /** Detailed message about the condition check */
  details?: string;
}

/**
 * DoR validation result stored in task metadata.
 * Requirements: R01.5
 */
export interface DoRCheckResult {
  /** Whether all DoR conditions passed */
  passed: boolean;
  /** ISO 8601 timestamp when check was performed */
  checked_at: string;
  /** Individual condition results */
  conditions: DoRConditionResult[];
}

// =============================================================================
// Type Definitions - TDD Status
// =============================================================================

/**
 * TDD phases as defined in the design.
 * Requirements: R05
 */
export type TddPhase = 
  | 'PENDING'
  | 'RED'
  | 'RED_INVALID'
  | 'RED_ERROR'
  | 'GREEN'
  | 'REFACTOR'
  | 'REGRESSION'
  | 'VERIFY'
  | 'VERIFY_FAILED'
  | 'COMPLETE'
  | 'NOT_APPLICABLE';

/**
 * TDD status in current task.
 */
export interface TddStatus {
  /** Current TDD phase */
  phase: TddPhase;
  /** ISO 8601 timestamp when current phase started */
  phase_started_at: string;
  /** Reason if TDD is not applicable */
  not_applicable_reason: string | null;
}

// =============================================================================
// Type Definitions - Current Task
// =============================================================================

/**
 * Current task tracking in project state.
 * Requirements: R02, R04
 */
export interface CurrentTask {
  /** Task identifier */
  id: string;
  /** Current task status */
  status: string;
  /** Assigned developer ID */
  assignee: string | null;
  /** Ownership details with fencing token */
  ownership: TaskOwnership | null;
  /** Definition of Ready check result */
  dor_check: DoRCheckResult | null;
  /** TDD status */
  tdd: TddStatus | null;
  /** Whether task is blocked */
  blocked: boolean;
  /** Reason for blocking */
  blocked_reason: string | null;
  /** References to blockers */
  blocker_refs: string[];
  /** Whether handoff is pending */
  handoff_pending: boolean;
  /** Handoff ID if pending */
  handoff_id: string | null;
  /** Working branch name */
  working_branch: string | null;
}

// =============================================================================
// Type Definitions - Resource Locks
// =============================================================================

/**
 * Exclusive resource lock for conflict prevention.
 * Requirements: R03.5
 */
export interface ResourceLock {
  /** Unique resource identifier */
  resource_id: string;
  /** Task holding the lock */
  held_by_task: string;
  /** Owner holding the lock */
  held_by_owner: string;
  /** ISO 8601 timestamp when acquired */
  acquired_at: string;
  /** ISO 8601 timestamp when lock expires */
  expires_at: string;
}

// =============================================================================
// Type Definitions - Checkpoints Summary
// =============================================================================

/**
 * Checkpoint summary in project state.
 * Requirements: R09
 */
export interface CheckpointsSummary {
  /** ID of the last checkpoint */
  last_checkpoint_id: string | null;
  /** ISO 8601 timestamp of last checkpoint */
  last_checkpoint_at: string | null;
  /** Total number of checkpoints */
  checkpoint_count: number;
}

// =============================================================================
// Type Definitions - Findings Summary
// =============================================================================

/**
 * Findings summary in project state.
 * Requirements: R11
 */
export interface FindingsSummary {
  /** Total number of findings */
  total: number;
  /** Counts by status */
  by_status: Record<string, number>;
  /** Counts by severity */
  by_severity: Record<string, number>;
  /** Number of findings blocking release */
  blocking_release: number;
}

// =============================================================================
// Type Definitions - Release
// =============================================================================

/**
 * Release stage status.
 * Requirements: R15
 */
export interface ReleaseStageStatus {
  /** Stage status */
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  /** ISO 8601 timestamp when completed */
  completed_at: string | null;
  /** Evidence ID for this stage */
  evidence_id: string | null;
  /** Deployed timestamp (for staging/production) */
  deployed_at?: string | null;
  /** Verified timestamp (for staging/production) */
  verified_at?: string | null;
  /** Approver ID (for production) */
  approved_by?: string | null;
  /** Approved timestamp (for production) */
  approved_at?: string | null;
}

/**
 * Release tracking in project state.
 * Requirements: R15
 */
export interface ReleaseTracking {
  /** Current release status */
  status: 'NOT_STARTED' | 'PLANNING' | 'READINESS_CHECK' | 'STAGING' | 'AWAITING_APPROVAL' | 'PRODUCTION' | 'MONITORING' | 'ROLLED_BACK' | 'CLOSED' | 'CANCELLED';
  /** Release version */
  version: string | null;
  /** Current stage name */
  current_stage: string | null;
  /** Stage details */
  stages: {
    readiness_check: ReleaseStageStatus;
    staging: ReleaseStageStatus;
    production: ReleaseStageStatus;
  };
  /** Whether rollback is available */
  rollback_available: boolean;
  /** Previous version for rollback */
  previous_version: string | null;
}

// =============================================================================
// Type Definitions - Actor Configuration
// =============================================================================

/**
 * Actor configuration for lease and timeout settings.
 * Requirements: R02.7, R12
 */
export interface ActorConfig {
  /** Lease duration for AI agents in seconds */
  lease_duration_seconds: number;
  /** Heartbeat interval for AI agents in seconds */
  heartbeat_interval_seconds: number;
  /** Inactivity warning threshold for humans in seconds */
  inactivity_warning_seconds: number;
  /** Handoff timeout in hours */
  handoff_timeout_hours: number;
}

// =============================================================================
// Type Definitions - Quality Gates
// =============================================================================

/**
 * Quality gate configuration.
 * Requirements: R06.7
 */
export interface QualityGateConfig {
  /** Whether this gate is required */
  required: boolean;
  /** Minimum pass rate (0-100) */
  min_pass_rate?: number;
  /** Required only for certain risk levels */
  required_for_risk?: string[];
}

/**
 * Quality gates configuration.
 * Requirements: R06.7
 */
export interface QualityGatesConfig {
  unit_test: QualityGateConfig;
  integration_test: QualityGateConfig;
  lint: QualityGateConfig;
  type_check: QualityGateConfig;
  security_scan: QualityGateConfig;
  [key: string]: QualityGateConfig;
}

// =============================================================================
// Type Definitions - Task Statistics
// =============================================================================

/**
 * Task statistics in project state.
 */
export interface TaskStatistics {
  /** Total number of tasks */
  total: number;
  /** Tasks by status */
  by_status: Record<string, number>;
  /** Tasks by assignee */
  by_assignee: Record<string, number>;
}

// =============================================================================
// Type Definitions - Team Section
// =============================================================================

/**
 * Team member definition (from team-manager.ts).
 */
export interface TeamMember {
  id: string;
  name: string;
  roles: string[];
  registered_at: string;
  status: 'ACTIVE' | 'INACTIVE';
}

/**
 * Team statistics.
 */
export interface TeamStatistics {
  total_members: number;
  by_role: Record<string, number>;
}

/**
 * Team section in project state.
 */
export interface TeamSection {
  members: TeamMember[];
  statistics: TeamStatistics;
}

// =============================================================================
// Type Definitions - Lifecycle
// =============================================================================

/**
 * Lifecycle phase in project state.
 */
export interface LifecyclePhase {
  /** Current lifecycle phase */
  phase: string;
  /** ISO 8601 timestamp when phase started */
  phase_started_at: string;
}

// =============================================================================
// Type Definitions - Project State
// =============================================================================

/**
 * Complete project state structure for YAML operations.
 * This is the enhanced schema supporting reliability features.
 * Requirements: R02.1, R02.2
 */
export interface ProjectState {
  /** Schema version */
  schema_version: SchemaVersion;
  /** Workflow version */
  workflow_version: string;
  
  /** State version for optimistic concurrency */
  state_version: number;
  /** Last modification timestamp */
  last_modified_at: string;
  /** Last modifier ID */
  last_modified_by: string;
  
  /** Lifecycle phase */
  lifecycle?: LifecyclePhase;
  
  /** Team configuration */
  team?: TeamSection;
  
  /** Task statistics */
  tasks?: TaskStatistics;
  
  /** Current task being worked on */
  current_task?: CurrentTask | null;
  
  /** Resource locks for exclusive access */
  resource_locks?: ResourceLock[];
  
  /** Checkpoints summary */
  checkpoints?: CheckpointsSummary;
  
  /** Findings summary */
  findings?: FindingsSummary;
  
  /** Release tracking */
  release?: ReleaseTracking;
  
  /** Actor configuration */
  actor_config?: ActorConfig;
  
  /** Quality gates configuration */
  quality_gates?: QualityGatesConfig;
  
  /** Last action taken */
  last_action?: string;
  
  /** Next permitted actions */
  next_permitted_actions?: string[];
  
  /** Validation errors */
  validation?: {
    errors: string[];
    warnings: string[];
  };
  
  /** Allow additional fields for backward compatibility */
  [key: string]: unknown;
}

// =============================================================================
// Type Definitions - Validation Result
// =============================================================================

/**
 * Validation issue found during consistency check.
 * Requirements: R16.6
 */
export interface ValidationIssue {
  /** Issue type */
  type: 'ERROR' | 'WARNING';
  /** Issue code for programmatic handling */
  code: string;
  /** Human-readable message */
  message: string;
  /** Path to the problematic field */
  path?: string;
  /** Expected value */
  expected?: unknown;
  /** Actual value */
  actual?: unknown;
}

/**
 * Result of state consistency validation.
 * Requirements: R16.6
 */
export interface ValidationResult {
  /** Whether validation passed (no errors) */
  valid: boolean;
  /** List of issues found */
  issues: ValidationIssue[];
  /** Timestamp of validation */
  validated_at: string;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * State controller error codes following the design specification.
 * Error codes in range 2000-2099 for STATE_ERROR category.
 * Requirements: R02.2, R16
 */
export enum StateErrorCode {
  /** Version mismatch during optimistic concurrency write */
  VERSION_CONFLICT = 2001,
  /** State file not found */
  STATE_NOT_FOUND = 2002,
  /** Invalid state format (corrupted YAML) */
  INVALID_STATE_FORMAT = 2003,
  /** State file write failed */
  WRITE_FAILED = 2004,
  /** Max retries exceeded during updateState */
  MAX_RETRIES_EXCEEDED = 2005,
  /** Invalid version number */
  INVALID_VERSION = 2006,
  /** Consistency validation failed */
  CONSISTENCY_ERROR = 2007,
  /** Required field missing */
  REQUIRED_FIELD_MISSING = 2008,
  /** State corruption detected */
  STATE_CORRUPTED = 2009,
  /** Invalid operation ID */
  INVALID_OPERATION_ID = 2010,
}

/**
 * State error structure following the design specification.
 */
export interface StateError {
  /** Error code from StateErrorCode enum */
  code: StateErrorCode;
  /** Error category */
  category: 'STATE_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    operation_id?: string;
    expected_version?: number;
    actual_version?: number;
    path?: string;
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
// Result Type
// =============================================================================

/**
 * Result type for operations that can succeed or fail.
 * Follows the Result pattern for type-safe error handling.
 */
export type Result<T, E> = 
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Helper function to create a success result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { success: true, value };
}

/**
 * Helper function to create a failure result.
 */
export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Creates a StateError with the given code and details.
 */
export function createStateError(
  code: StateErrorCode,
  message: string,
  context?: StateError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): StateError {
  return {
    code,
    category: 'STATE_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "version conflict" error for optimistic concurrency failures.
 * Requirements: R02.2
 */
export function versionConflictError(
  expectedVersion: number,
  actualVersion: number,
  operationId?: string
): StateError {
  return createStateError(
    StateErrorCode.VERSION_CONFLICT,
    `State version conflict: expected ${expectedVersion}, but current version is ${actualVersion}`,
    { 
      expected_version: expectedVersion, 
      actual_version: actualVersion,
      operation_id: operationId,
    },
    true, // recoverable - can retry with new version
    'Re-read the current state and retry the operation with the updated version'
  );
}

/**
 * Creates a "state not found" error.
 */
export function stateNotFoundError(path?: string): StateError {
  return createStateError(
    StateErrorCode.STATE_NOT_FOUND,
    `State file not found${path ? `: ${path}` : ''}`,
    { path },
    false,
    'Ensure the project state file exists at the expected location'
  );
}

/**
 * Creates an "invalid state format" error for corrupted YAML.
 */
export function invalidStateFormatError(details?: string): StateError {
  return createStateError(
    StateErrorCode.INVALID_STATE_FORMAT,
    `Invalid state format: ${details || 'Failed to parse YAML'}`,
    { details },
    false,
    'Check the state file for syntax errors or restore from a backup'
  );
}

/**
 * Creates a "write failed" error.
 */
export function writeFailedError(details?: string): StateError {
  return createStateError(
    StateErrorCode.WRITE_FAILED,
    `Failed to write state: ${details || 'Unknown error'}`,
    { details },
    true,
    'Check file permissions and disk space, then retry'
  );
}

/**
 * Creates a "max retries exceeded" error.
 * Requirements: R02.11
 */
export function maxRetriesExceededError(
  operationId: string,
  maxRetries: number
): StateError {
  return createStateError(
    StateErrorCode.MAX_RETRIES_EXCEEDED,
    `Operation '${operationId}' failed after ${maxRetries} retries due to version conflicts`,
    { operation_id: operationId, max_retries: maxRetries },
    false,
    'The state is experiencing high contention. Wait and try again, or investigate concurrent operations'
  );
}

/**
 * Creates a "consistency error" for validation failures.
 * Requirements: R16.6
 */
export function consistencyError(issues: ValidationIssue[]): StateError {
  const errorMessages = issues
    .filter(i => i.type === 'ERROR')
    .map(i => i.message)
    .join('; ');
  
  return createStateError(
    StateErrorCode.CONSISTENCY_ERROR,
    `State consistency check failed: ${errorMessages}`,
    { issues: issues as unknown as StateError['context'] },
    false,
    'Fix the inconsistencies in the state file or restore from a valid checkpoint'
  );
}

// =============================================================================
// Custom Error Classes
// =============================================================================

/**
 * Custom error class for version conflicts.
 * Can be caught and handled specifically for retry logic.
 */
export class StateVersionConflictError extends Error {
  public readonly code = StateErrorCode.VERSION_CONFLICT;
  public readonly expectedVersion: number;
  public readonly actualVersion: number;
  public readonly operationId?: string;
  
  constructor(expectedVersion: number, actualVersion: number, operationId?: string) {
    super(`State version conflict: expected ${expectedVersion}, but current version is ${actualVersion}`);
    this.name = 'StateVersionConflictError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    this.operationId = operationId;
  }
  
  toStateError(): StateError {
    return versionConflictError(this.expectedVersion, this.actualVersion, this.operationId);
  }
}

/**
 * Custom error class for max retries exceeded.
 */
export class MaxRetriesExceededError extends Error {
  public readonly code = StateErrorCode.MAX_RETRIES_EXCEEDED;
  public readonly operationId: string;
  public readonly maxRetries: number;
  
  constructor(operationId: string, maxRetries: number) {
    super(`Operation '${operationId}' failed after ${maxRetries} retries`);
    this.name = 'MaxRetriesExceededError';
    this.operationId = operationId;
    this.maxRetries = maxRetries;
  }
  
  toStateError(): StateError {
    return maxRetriesExceededError(this.operationId, this.maxRetries);
  }
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates if a version number is valid.
 */
export function isValidVersion(version: unknown): version is number {
  return typeof version === 'number' && 
         Number.isInteger(version) && 
         version >= 1;
}

/**
 * Validates if an operation ID is valid (non-empty string).
 */
export function isValidOperationId(operationId: unknown): operationId is string {
  return typeof operationId === 'string' && operationId.trim().length > 0;
}

/**
 * Validates if a timestamp is a valid ISO 8601 string.
 */
export function isValidTimestamp(timestamp: unknown): timestamp is string {
  if (typeof timestamp !== 'string') return false;
  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

// =============================================================================
// State_Controller Interface
// =============================================================================

/**
 * State_Controller interface for atomic state read/write with optimistic concurrency.
 * 
 * This is the foundation component for SDLC Workflow reliability, providing:
 * - Version-tracked state reads
 * - Optimistic concurrency writes with version checking
 * - Automatic retry with exponential backoff
 * - State consistency validation
 * 
 * Requirements: R02.1, R02.2, R02.11, R16.6
 */
export interface StateController {
  // =========================================================================
  // Read Operations
  // =========================================================================

  /**
   * Reads current state with version.
   * Returns state and its version for optimistic concurrency.
   * 
   * Requirements: R02.1, R02.2
   * 
   * @returns Result with state and version on success, or StateError on failure
   * 
   * Behavior:
   * - Returns complete project state including all sections
   * - Version is read from `state_version` field
   * - If `state_version` is missing, defaults to 1 (backward compatibility)
   * - Invalid YAML results in INVALID_STATE_FORMAT error
   */
  readState(): Promise<Result<{ state: ProjectState; version: number }, StateError>>;

  // =========================================================================
  // Write Operations
  // =========================================================================

  /**
   * Writes state with version check.
   * Fails if expectedVersion doesn't match current version.
   * 
   * Requirements: R02.2, R16.1
   * 
   * @param state - The new state to write
   * @param expectedVersion - Expected current version for optimistic concurrency
   * @param operationId - Unique identifier for this operation (for audit)
   * @param reason - Human-readable reason for the change (for audit)
   * @returns Result with new version on success, or StateError on failure
   * 
   * Behavior:
   * - Reads current version and compares with expectedVersion
   * - If versions match: increments version, updates timestamps, writes state
   * - If versions mismatch: returns VERSION_CONFLICT error
   * - Updates `state_version`, `last_modified_at`, `last_modified_by`
   * 
   * Errors:
   * - VERSION_CONFLICT: If expectedVersion doesn't match current version
   * - WRITE_FAILED: If file write operation fails
   * - INVALID_OPERATION_ID: If operationId is empty
   */
  writeState(
    state: ProjectState,
    expectedVersion: number,
    operationId: string,
    reason: string
  ): Promise<Result<{ newVersion: number }, StateError>>;

  // =========================================================================
  // Atomic Update Operations
  // =========================================================================

  /**
   * Atomic read-modify-write operation.
   * Handles retry on version conflict internally with exponential backoff.
   * 
   * Requirements: R02.2, R02.11
   * 
   * @param modifier - Function that transforms current state to new state
   * @param operationId - Unique identifier for this operation (for audit)
   * @param reason - Human-readable reason for the change (for audit)
   * @param maxRetries - Maximum number of retries on conflict (default: 3)
   * @returns Result with new state and version on success, or StateError on failure
   * 
   * Behavior:
   * - Reads current state
   * - Applies modifier function to get new state
   * - Attempts to write with optimistic concurrency
   * - On VERSION_CONFLICT: waits (exponential backoff), re-reads, re-applies modifier, retries
   * - On success: returns the new state and version
   * - After maxRetries: returns MAX_RETRIES_EXCEEDED error
   * 
   * Idempotency:
   * - The modifier function should be idempotent where possible
   * - Retry applies modifier to the latest state, not cached state
   */
  updateState(
    modifier: (state: ProjectState) => ProjectState,
    operationId: string,
    reason: string,
    maxRetries?: number
  ): Promise<Result<{ state: ProjectState; version: number }, StateError>>;

  // =========================================================================
  // Validation Operations
  // =========================================================================

  /**
   * Validates state consistency.
   * 
   * Requirements: R16.6
   * 
   * @returns Result with ValidationResult on success, or StateError on failure
   * 
   * Checks performed:
   * - Counter totals match sum of by_status/by_assignee
   * - Reference integrity (task refs exist)
   * - Required fields present
   * - No orphan references
   * - Valid state combinations
   */
  validateConsistency(): Promise<Result<ValidationResult, StateError>>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for StateController implementation.
 */
export interface StateControllerConfig {
  /** Path to project-state.yaml file */
  projectStatePath: string;
  /** Default actor ID for modifications when not specified */
  defaultActorId?: string;
  /** Default actor type */
  defaultActorType?: ActorType;
  /** Custom max retries for updateState */
  maxRetries?: number;
  /** Base delay for exponential backoff in milliseconds */
  baseRetryDelayMs?: number;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates default actor configuration.
 * Requirements: R02.7
 */
export function createDefaultActorConfig(): ActorConfig {
  return {
    lease_duration_seconds: 3600,      // 1 hour
    heartbeat_interval_seconds: 300,   // 5 minutes
    inactivity_warning_seconds: 7200,  // 2 hours
    handoff_timeout_hours: 24,
  };
}

/**
 * Creates default quality gates configuration.
 * Requirements: R06.7
 */
export function createDefaultQualityGates(): QualityGatesConfig {
  return {
    unit_test: {
      required: true,
      min_pass_rate: 100,
    },
    integration_test: {
      required: true,
      min_pass_rate: 100,
    },
    lint: {
      required: true,
    },
    type_check: {
      required: true,
    },
    security_scan: {
      required_for_risk: ['HIGH', 'CRITICAL'],
      required: false,
    },
  };
}

/**
 * Creates default release tracking.
 * Requirements: R15.1
 */
export function createDefaultReleaseTracking(): ReleaseTracking {
  const defaultStageStatus: ReleaseStageStatus = {
    status: 'NOT_STARTED',
    completed_at: null,
    evidence_id: null,
  };
  
  return {
    status: 'NOT_STARTED',
    version: null,
    current_stage: null,
    stages: {
      readiness_check: { ...defaultStageStatus },
      staging: { ...defaultStageStatus, deployed_at: null, verified_at: null },
      production: { 
        ...defaultStageStatus, 
        deployed_at: null, 
        verified_at: null,
        approved_by: null,
        approved_at: null,
      },
    },
    rollback_available: false,
    previous_version: null,
  };
}

/**
 * Creates default checkpoints summary.
 */
export function createDefaultCheckpointsSummary(): CheckpointsSummary {
  return {
    last_checkpoint_id: null,
    last_checkpoint_at: null,
    checkpoint_count: 0,
  };
}

/**
 * Creates default findings summary.
 */
export function createDefaultFindingsSummary(): FindingsSummary {
  return {
    total: 0,
    by_status: {
      OPEN: 0,
      IN_PROGRESS: 0,
      RESOLVED: 0,
      WONT_FIX: 0,
      DUPLICATE: 0,
    },
    by_severity: {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    },
    blocking_release: 0,
  };
}

/**
 * Creates a minimal valid project state with default values.
 * Useful for initializing new project states or testing.
 */
export function createDefaultProjectState(modifiedBy: string = 'SYSTEM'): ProjectState {
  const now = new Date().toISOString();
  
  return {
    schema_version: STATE_CONTROLLER_DEFAULTS.SCHEMA_VERSION as SchemaVersion,
    workflow_version: '1.1.0',
    state_version: 1,
    last_modified_at: now,
    last_modified_by: modifiedBy,
    lifecycle: {
      phase: 'PLANNING',
      phase_started_at: now,
    },
    team: {
      members: [],
      statistics: {
        total_members: 0,
        by_role: {},
      },
    },
    tasks: {
      total: 0,
      by_status: {},
      by_assignee: {},
    },
    current_task: null,
    resource_locks: [],
    checkpoints: createDefaultCheckpointsSummary(),
    findings: createDefaultFindingsSummary(),
    release: createDefaultReleaseTracking(),
    actor_config: createDefaultActorConfig(),
    quality_gates: createDefaultQualityGates(),
    last_action: 'Project initialized',
    next_permitted_actions: [],
    validation: {
      errors: [],
      warnings: [],
    },
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extracts version metadata from a project state.
 */
export function extractVersionMetadata(state: ProjectState): StateVersionMetadata {
  return {
    state_version: state.state_version ?? STATE_CONTROLLER_DEFAULTS.DEFAULT_VERSION,
    last_modified_at: state.last_modified_at ?? new Date().toISOString(),
    last_modified_by: state.last_modified_by ?? 'UNKNOWN',
  };
}

/**
 * Updates version metadata in a project state.
 */
export function updateVersionMetadata(
  state: ProjectState,
  newVersion: number,
  modifiedBy: string
): ProjectState {
  return {
    ...state,
    state_version: newVersion,
    last_modified_at: new Date().toISOString(),
    last_modified_by: modifiedBy,
  };
}

/**
 * Calculates delay for exponential backoff.
 * @param retryCount - Current retry attempt (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @returns Delay in milliseconds with some jitter
 */
export function calculateBackoffDelay(
  retryCount: number,
  baseDelayMs: number = STATE_CONTROLLER_DEFAULTS.BASE_RETRY_DELAY_MS
): number {
  const exponentialDelay = Math.pow(2, retryCount) * baseDelayMs;
  // Add jitter (±25%) to prevent thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(exponentialDelay + jitter);
}

/**
 * Sleep utility for backoff delays.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
