/**
 * Evidence Manager - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Evidence_Manager component
 * which provides evidence lifecycle management, staleness detection, and quality gate validation.
 * 
 * The Evidence_Manager ensures evidence accuracy and traceability by:
 * - Creating evidence records with git state correlation
 * - Detecting stale evidence via commit and file hash tracking
 * - Validating quality gates based on evidence
 * 
 * Requirements: R05, R06.1, R06.2, R06.3, R06.4, R06.5, R06.6, R06.7
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
 * Default configuration values for evidence operations.
 * Requirements: R06
 */
export const EVIDENCE_DEFAULTS = {
  /** Directory name for evidence storage */
  STORAGE_DIR: '.kiro/sdlc/evidence',
  /** Directory name for evidence logs */
  LOGS_DIR: '.kiro/sdlc/evidence/logs',
  /** Evidence ID prefix */
  ID_PREFIX: 'EVD',
  /** Maximum age in days for evidence to be considered fresh (without file changes) */
  MAX_FRESH_AGE_DAYS: 7,
  /** Log file extension */
  LOG_EXTENSION: '.log',
} as const;

// =============================================================================
// Type Definitions - Evidence Type
// =============================================================================

/**
 * Types of evidence that can be captured.
 * Requirements: R05, R06.1
 */
export type EvidenceType = 
  | 'TDD_RED'           // RED phase - test fails for expected behavior
  | 'TDD_GREEN'         // GREEN phase - test passes
  | 'TDD_REFACTOR'      // REFACTOR phase - tests still pass after refactor
  | 'TDD_VERIFY'        // VERIFY phase - all checks pass
  | 'UNIT_TEST'         // Unit test execution
  | 'INTEGRATION_TEST'  // Integration test execution
  | 'E2E_TEST'          // End-to-end test execution
  | 'LINT'              // Linting check
  | 'TYPE_CHECK'        // Type checking
  | 'SECURITY_SCAN'     // Security scan
  | 'MANUAL_REVIEW'     // Manual review/verification
  | 'BUILD'             // Build verification
  | 'DEPLOY_STAGING'    // Staging deployment verification
  | 'DEPLOY_PRODUCTION' // Production deployment verification
  | 'CUSTOM';           // Custom evidence type

/**
 * Maps evidence types to human-readable descriptions.
 */
export const EVIDENCE_TYPE_DESCRIPTIONS: Record<EvidenceType, string> = {
  TDD_RED: 'TDD RED phase - test fails for expected behavior',
  TDD_GREEN: 'TDD GREEN phase - test passes',
  TDD_REFACTOR: 'TDD REFACTOR phase - tests still pass after refactor',
  TDD_VERIFY: 'TDD VERIFY phase - all checks pass',
  UNIT_TEST: 'Unit test execution',
  INTEGRATION_TEST: 'Integration test execution',
  E2E_TEST: 'End-to-end test execution',
  LINT: 'Linting check',
  TYPE_CHECK: 'Type checking',
  SECURITY_SCAN: 'Security scan',
  MANUAL_REVIEW: 'Manual review/verification',
  BUILD: 'Build verification',
  DEPLOY_STAGING: 'Staging deployment verification',
  DEPLOY_PRODUCTION: 'Production deployment verification',
  CUSTOM: 'Custom evidence type',
};

// =============================================================================
// Type Definitions - Evidence Result
// =============================================================================

/**
 * Result status for evidence verification.
 * Requirements: R06.2
 */
export type EvidenceResultStatus = 
  | 'PASS'           // Test/check succeeded
  | 'FAIL'           // Test/check failed
  | 'BLOCKED'        // Could not run due to blocker
  | 'NOT_RUN'        // Skipped, not executed
  | 'NOT_APPLICABLE' // Check not relevant for this task
  | 'ERROR';         // Execution error (environment, config, etc.)

/**
 * Test failure type for RED phase validation.
 * Requirements: R05.8
 */
export type TestFailureType = 
  | 'BEHAVIOR_MISSING'   // Expected RED, behavior not implemented
  | 'TEST_ERROR'         // Syntax, import, assertion bug
  | 'ENVIRONMENT_ERROR'  // Runtime, connection, config issue
  | 'SKIPPED'            // Test not executed
  | 'UNEXPECTED_PASS'    // Test passed when should fail (RED invalid)
  | 'REGRESSION';        // Previously passing test now fails

/**
 * Execution result details.
 * Requirements: R06.1
 */
export interface EvidenceResult {
  /** Result status */
  status: EvidenceResultStatus;
  /** Brief summary of the result */
  summary: string;
  /** Test file that was executed (if applicable) */
  test_file?: string;
  /** Test name/description (if applicable) */
  test_name?: string;
  /** Failure type (for FAIL status) */
  failure_type?: TestFailureType;
  /** Detailed failure message */
  failure_message?: string;
  /** Number of tests passed (if applicable) */
  tests_passed?: number;
  /** Number of tests failed (if applicable) */
  tests_failed?: number;
  /** Number of tests skipped (if applicable) */
  tests_skipped?: number;
  /** Total number of tests (if applicable) */
  tests_total?: number;
  /** Coverage percentage (if applicable) */
  coverage_percent?: number;
  /** Path to detailed log file */
  log_path?: string;
  /** Additional result metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Type Definitions - Git State
// =============================================================================

/**
 * Git state captured in evidence.
 * Requirements: R06.1, R06.4
 */
export interface EvidenceGitState {
  /** Commit SHA at verification time */
  commit_sha: string;
  /** Branch name at verification time */
  branch: string;
  /** Whether working tree has uncommitted changes */
  working_tree_dirty: boolean;
  /** List of uncommitted files (if dirty) */
  uncommitted_files: string[];
}

// =============================================================================
// Type Definitions - Execution Details
// =============================================================================

/**
 * Test configuration details.
 */
export interface TestConfig {
  /** Test framework used */
  test_framework?: string;
  /** Configuration file path */
  config_file?: string;
  /** Test file pattern/filter */
  test_pattern?: string;
  /** Additional configuration */
  [key: string]: unknown;
}

/**
 * Environment information at execution time.
 */
export interface ExecutionEnvironment {
  /** Node.js version (if applicable) */
  node_version?: string;
  /** Operating system */
  os?: string;
  /** Platform architecture */
  arch?: string;
  /** Additional environment info */
  [key: string]: unknown;
}

/**
 * Execution details for evidence.
 * Requirements: R06.1
 */
export interface ExecutionDetails {
  /** Command that was executed */
  command: string;
  /** Working directory */
  working_directory?: string;
  /** Test configuration */
  config?: TestConfig;
  /** Environment information */
  environment?: ExecutionEnvironment;
  /** Execution timestamp */
  timestamp: string;
  /** Duration in milliseconds */
  duration_ms: number;
  /** Process exit code */
  exit_code: number;
}

// =============================================================================
// Type Definitions - Executor
// =============================================================================

/**
 * Executor information for evidence.
 * Requirements: R06.1
 */
export interface EvidenceExecutor {
  /** Executor ID */
  id: string;
  /** Type of executor */
  type: ActorType;
}

// =============================================================================
// Type Definitions - File Hash
// =============================================================================

/**
 * File hash for staleness detection.
 * Requirements: R06.4, R06.5
 */
export interface FileHash {
  /** Relative path to the file */
  path: string;
  /** Hash value at verification time */
  hash_at_verification: string;
  /** Hash algorithm used */
  algorithm?: 'sha256' | 'md5';
}

// =============================================================================
// Type Definitions - Staleness
// =============================================================================

/**
 * Staleness tracking information.
 * Requirements: R06.4, R06.5
 */
export interface StalenessInfo {
  /** Whether evidence is stale */
  stale: boolean;
  /** Reason for staleness (if stale) */
  stale_reason: StalenessReason | null;
  /** Timestamp when staleness was last checked */
  checked_at: string;
  /** Related files with their hashes at verification time */
  related_files: FileHash[];
}

/**
 * Reasons why evidence can become stale.
 * Requirements: R06.4, R06.5
 */
export type StalenessReason = 
  | 'COMMIT_CHANGED'      // HEAD has moved since evidence
  | 'FILES_MODIFIED'      // Related files have changed
  | 'COMMIT_NOT_FOUND'    // Original commit no longer exists
  | 'BRANCH_DELETED'      // Branch no longer exists
  | 'FORCE_MARKED'        // Manually marked as stale
  | 'AGE_EXCEEDED';       // Evidence too old (configurable)

/**
 * Result of staleness check.
 * Requirements: R06.4
 */
export interface StalenessCheck {
  /** Evidence ID that was checked */
  evidence_id: string;
  /** Whether evidence is stale */
  stale: boolean;
  /** Reason for staleness (if stale) */
  reason: StalenessReason | null;
  /** Detailed description */
  details: string | null;
  /** Timestamp of the check */
  checked_at: string;
  /** Files that were affected (if FILES_MODIFIED) */
  affected_files?: string[];
  /** Current commit SHA */
  current_commit_sha?: string;
  /** Evidence commit SHA */
  evidence_commit_sha?: string;
}

// =============================================================================
// Type Definitions - Evidence
// =============================================================================

/**
 * Complete evidence record.
 * Requirements: R06.1
 */
export interface Evidence {
  /** Unique evidence identifier */
  evidence_id: string;
  /** Timestamp when evidence was created */
  created_at: string;
  
  /** Evidence type */
  type: EvidenceType;
  
  /** Task ID this evidence relates to */
  task_id: string;
  /** TDD phase (if TDD evidence) */
  tdd_phase?: TddPhase;
  
  /** Requirement references */
  requirement_refs: string[];
  /** Acceptance criteria references */
  ac_refs: string[];
  
  /** Git state at verification time */
  git_state: EvidenceGitState;
  
  /** Execution details */
  execution: ExecutionDetails;
  
  /** Result of the verification */
  result: EvidenceResult;
  
  /** Executor information */
  executor: EvidenceExecutor;
  
  /** Staleness tracking */
  staleness: StalenessInfo;
  
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Type Definitions - Evidence Input
// =============================================================================

/**
 * Input for creating new evidence.
 * Requirements: R06.1
 */
export interface EvidenceInput {
  /** Task ID this evidence relates to */
  task_id: string;
  /** Evidence type */
  type: EvidenceType;
  /** TDD phase (required for TDD evidence types) */
  tdd_phase?: TddPhase;
  /** Requirement references */
  requirement_refs: string[];
  /** Acceptance criteria references */
  ac_refs: string[];
  /** Command that was executed */
  command: string;
  /** Working directory (optional) */
  working_directory?: string;
  /** Test configuration (optional) */
  config?: TestConfig;
  /** Execution duration in milliseconds */
  duration_ms: number;
  /** Process exit code */
  exit_code: number;
  /** Result of the verification */
  result: EvidenceResult;
  /** Executor ID */
  executor_id: string;
  /** Executor type */
  executor_type: ActorType;
  /** Related files for staleness tracking */
  related_files?: string[];
  /** Optional note */
  note?: string;
}

// =============================================================================
// Type Definitions - Quality Gate
// =============================================================================

/**
 * Quality gate types.
 * Requirements: R06.7
 */
export type QualityGate = 
  | 'unit_test'
  | 'integration_test'
  | 'e2e_test'
  | 'lint'
  | 'type_check'
  | 'security_scan'
  | 'build'
  | 'manual_review';

/**
 * Gate status enumeration.
 */
export type GateStatusValue = 
  | 'PASSED'     // Gate requirements met
  | 'FAILED'     // Gate requirements not met
  | 'PENDING'    // Gate not yet evaluated
  | 'SKIPPED'    // Gate skipped (not required)
  | 'BLOCKED';   // Gate blocked by other failure

/**
 * Quality gate validation result.
 * Requirements: R06.7
 */
export interface GateStatus {
  /** Gate name */
  gate: QualityGate;
  /** Gate status */
  status: GateStatusValue;
  /** Whether this gate is required */
  required: boolean;
  /** Evidence IDs that support this gate */
  evidence_ids: string[];
  /** Whether all evidence is fresh (not stale) */
  all_evidence_fresh: boolean;
  /** Pass rate if applicable */
  pass_rate?: number;
  /** Required pass rate if applicable */
  required_pass_rate?: number;
  /** Detailed message */
  message: string;
  /** Timestamp of validation */
  validated_at: string;
}

/**
 * Complete gate validation result for a task.
 * Requirements: R06.7
 */
export interface GateValidation {
  /** Task ID */
  task_id: string;
  /** Overall validation passed */
  passed: boolean;
  /** Timestamp of validation */
  validated_at: string;
  /** Individual gate statuses */
  gates: GateStatus[];
  /** Gates that passed */
  passed_gates: QualityGate[];
  /** Gates that failed */
  failed_gates: QualityGate[];
  /** Blocking issues */
  blockers: string[];
}

/**
 * Configuration for validating a single quality gate.
 * Requirements: R06.7
 */
export interface QualityGateValidationConfig {
  /** Whether this gate is required */
  required: boolean;
  /** Minimum pass rate (0-100), default 100 */
  minPassRate?: number;
  /** Whether to allow stale evidence, default false */
  allowStale?: boolean;
}

/**
 * Configuration for validating all quality gates.
 * Requirements: R06.7
 */
export interface QualityGatesValidationConfig {
  /** List of gates to validate */
  gates: QualityGate[];
  /** Per-gate configuration */
  gateConfigs?: Partial<Record<QualityGate, QualityGateValidationConfig>>;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Evidence error codes following the design specification.
 * Error codes in range 2300-2399 for EVIDENCE_ERROR category.
 * Requirements: R06
 */
export enum EvidenceErrorCode {
  /** Evidence not found */
  EVIDENCE_NOT_FOUND = 2301,
  /** Evidence corrupted or invalid format */
  EVIDENCE_CORRUPTED = 2302,
  /** Evidence is stale */
  EVIDENCE_STALE = 2303,
  /** Evidence validation failed */
  VALIDATION_FAILED = 2304,
  /** Write evidence failed */
  WRITE_FAILED = 2305,
  /** Delete evidence failed */
  DELETE_FAILED = 2306,
  /** Invalid evidence type */
  INVALID_TYPE = 2307,
  /** Evidence already exists with same ID */
  DUPLICATE_EVIDENCE = 2308,
  /** Git state capture failed */
  GIT_STATE_ERROR = 2309,
  /** File hash computation failed */
  HASH_ERROR = 2310,
  /** Quality gate validation failed */
  GATE_VALIDATION_FAILED = 2311,
  /** Missing required fields */
  MISSING_REQUIRED_FIELDS = 2312,
  /** Invalid result status */
  INVALID_RESULT_STATUS = 2313,
  /** Task not found for evidence */
  TASK_NOT_FOUND = 2314,
  /** Evidence log not found */
  LOG_NOT_FOUND = 2315,
}

/**
 * Evidence error structure following the design specification.
 */
export interface EvidenceError {
  /** Error code from EvidenceErrorCode enum */
  code: EvidenceErrorCode;
  /** Error category */
  category: 'EVIDENCE_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    evidence_id?: string;
    task_id?: string;
    type?: EvidenceType;
    gate?: QualityGate;
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
 * Creates an EvidenceError with the given code and details.
 */
export function createEvidenceError(
  code: EvidenceErrorCode,
  message: string,
  context?: EvidenceError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): EvidenceError {
  return {
    code,
    category: 'EVIDENCE_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an "evidence not found" error.
 */
export function evidenceNotFoundError(evidenceId: string): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.EVIDENCE_NOT_FOUND,
    `Evidence ${evidenceId} not found`,
    { evidence_id: evidenceId },
    false,
    'Verify the evidence ID is correct or list available evidence'
  );
}

/**
 * Creates an "evidence corrupted" error.
 */
export function evidenceCorruptedError(
  evidenceId: string,
  details?: string
): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.EVIDENCE_CORRUPTED,
    `Evidence ${evidenceId} is corrupted: ${details || 'Invalid format'}`,
    { evidence_id: evidenceId, details },
    false,
    'Delete the corrupted evidence and create a new one'
  );
}

/**
 * Creates an "evidence stale" error.
 * Requirements: R06.4, R06.5
 */
export function evidenceStaleError(
  evidenceId: string,
  reason: StalenessReason,
  details?: string
): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.EVIDENCE_STALE,
    `Evidence ${evidenceId} is stale: ${reason}${details ? ` - ${details}` : ''}`,
    { 
      evidence_id: evidenceId,
      stale_reason: reason,
      details,
    },
    true,
    'Re-run the verification to create fresh evidence'
  );
}

/**
 * Creates a "write failed" error.
 */
export function writeEvidenceFailedError(
  taskId: string,
  details?: string
): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.WRITE_FAILED,
    `Failed to write evidence for task ${taskId}: ${details || 'Unknown error'}`,
    { task_id: taskId, details },
    true,
    'Check disk space and permissions, then retry'
  );
}

/**
 * Creates a "git state error" error.
 */
export function evidenceGitStateError(details?: string): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.GIT_STATE_ERROR,
    `Failed to capture git state for evidence: ${details || 'Unknown error'}`,
    { details },
    true,
    'Ensure git repository is accessible and retry'
  );
}

/**
 * Creates a "gate validation failed" error.
 * Requirements: R06.7
 */
export function gateValidationFailedError(
  taskId: string,
  gate: QualityGate,
  reason: string
): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.GATE_VALIDATION_FAILED,
    `Quality gate '${gate}' validation failed for task ${taskId}: ${reason}`,
    { task_id: taskId, gate, details: reason },
    true,
    'Address the gate requirements and re-validate'
  );
}

/**
 * Creates a "missing required fields" error.
 */
export function missingRequiredFieldsError(
  fields: string[]
): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.MISSING_REQUIRED_FIELDS,
    `Missing required fields: ${fields.join(', ')}`,
    { missing_fields: fields },
    false,
    'Provide all required fields when creating evidence'
  );
}

/**
 * Creates a "task not found" error.
 */
export function evidenceTaskNotFoundError(taskId: string): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.TASK_NOT_FOUND,
    `Task ${taskId} not found for evidence`,
    { task_id: taskId },
    false,
    'Verify the task ID is correct'
  );
}

/**
 * Creates an "invalid evidence type" error.
 */
export function invalidEvidenceTypeError(type: string): EvidenceError {
  return createEvidenceError(
    EvidenceErrorCode.INVALID_TYPE,
    `Invalid evidence type: ${type}`,
    { type: type as EvidenceType },
    false,
    `Use one of the valid evidence types: ${Object.keys(EVIDENCE_TYPE_DESCRIPTIONS).join(', ')}`
  );
}

// =============================================================================
// Custom Error Classes
// =============================================================================

/**
 * Custom error class for evidence not found.
 */
export class EvidenceNotFoundError extends Error {
  public readonly code = EvidenceErrorCode.EVIDENCE_NOT_FOUND;
  public readonly evidenceId: string;
  
  constructor(evidenceId: string) {
    super(`Evidence ${evidenceId} not found`);
    this.name = 'EvidenceNotFoundError';
    this.evidenceId = evidenceId;
  }
  
  toEvidenceError(): EvidenceError {
    return evidenceNotFoundError(this.evidenceId);
  }
}

/**
 * Custom error class for stale evidence.
 */
export class EvidenceStaleError extends Error {
  public readonly code = EvidenceErrorCode.EVIDENCE_STALE;
  public readonly evidenceId: string;
  public readonly reason: StalenessReason;
  
  constructor(evidenceId: string, reason: StalenessReason) {
    super(`Evidence ${evidenceId} is stale: ${reason}`);
    this.name = 'EvidenceStaleError';
    this.evidenceId = evidenceId;
    this.reason = reason;
  }
  
  toEvidenceError(): EvidenceError {
    return evidenceStaleError(this.evidenceId, this.reason);
  }
}

/**
 * Custom error class for gate validation failure.
 */
export class GateValidationFailedError extends Error {
  public readonly code = EvidenceErrorCode.GATE_VALIDATION_FAILED;
  public readonly taskId: string;
  public readonly gate: QualityGate;
  public readonly reason: string;
  
  constructor(taskId: string, gate: QualityGate, reason: string) {
    super(`Gate ${gate} validation failed for task ${taskId}: ${reason}`);
    this.name = 'GateValidationFailedError';
    this.taskId = taskId;
    this.gate = gate;
    this.reason = reason;
  }
  
  toEvidenceError(): EvidenceError {
    return gateValidationFailedError(this.taskId, this.gate, this.reason);
  }
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for evidence creation.
 */
export type CreateEvidenceResult = Result<Evidence, EvidenceError>;

/**
 * Result type for evidence retrieval.
 */
export type GetEvidenceResult = Result<Evidence, EvidenceError>;

/**
 * Result type for evidence listing.
 */
export type ListEvidenceResult = Result<Evidence[], EvidenceError>;

/**
 * Result type for staleness check.
 */
export type CheckStalenessResult = Result<StalenessCheck, EvidenceError>;

/**
 * Result type for marking evidence as stale.
 */
export type MarkStaleResult = Result<void, EvidenceError>;

/**
 * Result type for gate validation.
 */
export type ValidateGateResult = Result<GateValidation, EvidenceError>;

/**
 * Result type for evidence deletion.
 */
export type DeleteEvidenceResult = Result<void, EvidenceError>;

// =============================================================================
// Evidence_Manager Interface
// =============================================================================

/**
 * EvidenceManager interface for evidence lifecycle management.
 * 
 * This component ensures:
 * - Evidence records creation with git state correlation
 * - Staleness detection via commit and file hash tracking
 * - Quality gate validation based on evidence
 * - Evidence retrieval and listing
 * 
 * Requirements: R05, R06.1, R06.2, R06.3, R06.4, R06.5, R06.6, R06.7
 */
export interface EvidenceManager {
  // =========================================================================
  // Creation Operations
  // =========================================================================

  /**
   * Creates evidence record.
   * 
   * Requirements: R06.1
   * 
   * @param input - Evidence input data
   * @returns Result with Evidence on success, or EvidenceError on failure
   * 
   * Behavior:
   * - Generates unique evidence ID
   * - Captures current git state (commit SHA, branch, dirty status)
   * - Computes file hashes for related files
   * - Stores evidence to evidence directory
   * - Validates required fields
   * 
   * Validation:
   * - task_id must be non-empty
   * - type must be valid EvidenceType
   * - requirement_refs or ac_refs should be non-empty
   * - result must have valid status
   */
  createEvidence(input: EvidenceInput): Promise<CreateEvidenceResult>;

  // =========================================================================
  // Retrieval Operations
  // =========================================================================

  /**
   * Gets evidence by ID.
   * 
   * @param evidenceId - The evidence ID to retrieve
   * @returns Result with Evidence on success, or EvidenceError on failure
   */
  getEvidence(evidenceId: string): Promise<GetEvidenceResult>;

  /**
   * Lists evidence, optionally filtered by task.
   * 
   * @param taskId - Optional task ID to filter by
   * @returns Result with Evidence array on success, or EvidenceError on failure
   * 
   * Behavior:
   * - Returns evidence sorted by creation time (newest first)
   * - If taskId provided, returns only evidence for that task
   * - If taskId is null/undefined, returns all evidence
   */
  listEvidence(taskId?: string): Promise<ListEvidenceResult>;

  /**
   * Lists evidence for a task filtered by type.
   * 
   * @param taskId - Task ID to get evidence for
   * @param type - Evidence type to filter by
   * @returns Result with Evidence array on success, or EvidenceError on failure
   */
  listEvidenceByType(
    taskId: string,
    type: EvidenceType
  ): Promise<ListEvidenceResult>;

  /**
   * Gets the latest evidence for a task and optional phase.
   * 
   * @param taskId - Task ID to get latest evidence for
   * @param tddPhase - Optional TDD phase to filter by
   * @returns Result with Evidence on success, null if none found, or EvidenceError on failure
   */
  getLatestEvidence(
    taskId: string,
    tddPhase?: TddPhase
  ): Promise<Result<Evidence | null, EvidenceError>>;

  // =========================================================================
  // Staleness Operations
  // =========================================================================

  /**
   * Checks if evidence is stale.
   * Compares commit SHA and file hashes with current state.
   * 
   * Requirements: R06.4, R06.5
   * 
   * @param evidenceId - The evidence ID to check
   * @returns Result with StalenessCheck on success, or EvidenceError on failure
   * 
   * Checks performed:
   * - Commit still exists and is reachable
   * - HEAD has not moved since evidence
   * - Related files have not changed (via hash comparison)
   * - Branch still exists
   * 
   * Returns:
   * - stale: boolean indicating if evidence is stale
   * - reason: why evidence is stale (if stale)
   * - affected_files: which files changed (if FILES_MODIFIED)
   */
  checkStaleness(evidenceId: string): Promise<CheckStalenessResult>;

  /**
   * Marks evidence as stale with reason.
   * 
   * Requirements: R06.5
   * 
   * @param evidenceId - The evidence ID to mark as stale
   * @param reason - Reason for marking as stale
   * @returns Result with void on success, or EvidenceError on failure
   */
  markStale(
    evidenceId: string,
    reason: StalenessReason
  ): Promise<MarkStaleResult>;

  /**
   * Gets all stale evidence for a task.
   * 
   * @param taskId - Task ID to check
   * @returns Result with Evidence array on success, or EvidenceError on failure
   */
  getStaleEvidence(taskId: string): Promise<ListEvidenceResult>;

  /**
   * Gets all stale evidence for a release.
   * 
   * @param releaseId - Release ID to check
   * @returns Result with Evidence array on success, or EvidenceError on failure
   */
  getStaleEvidenceForRelease(releaseId: string): Promise<ListEvidenceResult>;

  // =========================================================================
  // Quality Gate Operations
  // =========================================================================

  /**
   * Validates quality gate requirements for a task.
   * 
   * Requirements: R06.7
   * 
   * @param taskId - Task ID to validate
   * @param gate - Quality gate to validate
   * @param gateConfig - Optional gate configuration (uses default if not provided)
   * @returns Result with GateStatus on success, or EvidenceError on failure
   * 
   * Validation checks:
   * - Required evidence exists
   * - Evidence is not stale
   * - Pass rate meets minimum (if applicable)
   */
  validateGate(
    taskId: string,
    gate: QualityGate,
    gateConfig?: QualityGateValidationConfig
  ): Promise<Result<GateStatus, EvidenceError>>;

  /**
   * Validates all quality gates for a task.
   * 
   * Requirements: R06.7
   * 
   * @param taskId - Task ID to validate
   * @param gatesConfig - Optional gates configuration (uses defaults if not provided)
   * @returns Result with GateValidation on success, or EvidenceError on failure
   */
  validateAllGates(
    taskId: string,
    gatesConfig?: QualityGatesValidationConfig
  ): Promise<ValidateGateResult>;

  // =========================================================================
  // Deletion Operations
  // =========================================================================

  /**
   * Deletes evidence by ID.
   * 
   * @param evidenceId - The evidence ID to delete
   * @returns Result with void on success, or EvidenceError on failure
   */
  deleteEvidence(evidenceId: string): Promise<DeleteEvidenceResult>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for EvidenceManager implementation.
 */
export interface EvidenceManagerConfig {
  /** Path to evidence storage directory */
  storagePath?: string;
  /** Path to evidence logs directory */
  logsPath?: string;
  /** Default actor ID for system-triggered operations */
  defaultActorId?: string;
  /** Maximum age in days for evidence freshness */
  maxFreshAgeDays?: number;
  /** Hash algorithm for file staleness tracking */
  hashAlgorithm?: 'sha256' | 'md5';
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Generates a unique evidence ID.
 * Format: EVD-{TASK_ID}-{TYPE}-{SEQUENCE} or EVD-{TASK_ID}-{TDD_PHASE}
 */
export function generateEvidenceId(
  taskId: string,
  type: EvidenceType,
  tddPhase?: TddPhase,
  sequenceNumber: number = 1
): string {
  const taskPart = taskId.replace(/^TASK-/i, '');
  
  if (tddPhase && type.startsWith('TDD_')) {
    return `${EVIDENCE_DEFAULTS.ID_PREFIX}-${taskPart}-${tddPhase}`;
  }
  
  const typePart = type.replace(/_/g, '-');
  const seq = String(sequenceNumber).padStart(3, '0');
  return `${EVIDENCE_DEFAULTS.ID_PREFIX}-${taskPart}-${typePart}-${seq}`;
}

/**
 * Creates evidence git state from current repository state.
 */
export function createEvidenceGitState(
  commitSha: string,
  branch: string,
  workingTreeDirty: boolean = false,
  uncommittedFiles: string[] = []
): EvidenceGitState {
  return {
    commit_sha: commitSha,
    branch,
    working_tree_dirty: workingTreeDirty,
    uncommitted_files: uncommittedFiles,
  };
}

/**
 * Creates evidence executor info.
 */
export function createEvidenceExecutor(
  id: string,
  type: ActorType
): EvidenceExecutor {
  return { id, type };
}

/**
 * Creates default staleness info (not stale).
 */
export function createDefaultStalenessInfo(
  relatedFiles: FileHash[] = []
): StalenessInfo {
  return {
    stale: false,
    stale_reason: null,
    checked_at: new Date().toISOString(),
    related_files: relatedFiles,
  };
}

/**
 * Creates a file hash entry.
 */
export function createFileHash(
  path: string,
  hash: string,
  algorithm: 'sha256' | 'md5' = 'sha256'
): FileHash {
  return {
    path,
    hash_at_verification: hash,
    algorithm,
  };
}

/**
 * Creates execution details.
 */
export function createExecutionDetails(
  command: string,
  durationMs: number,
  exitCode: number,
  workingDirectory?: string,
  config?: TestConfig,
  environment?: ExecutionEnvironment
): ExecutionDetails {
  return {
    command,
    working_directory: workingDirectory,
    config,
    environment,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    exit_code: exitCode,
  };
}

/**
 * Creates evidence result.
 */
export function createEvidenceResult(
  status: EvidenceResultStatus,
  summary: string,
  options?: Partial<Omit<EvidenceResult, 'status' | 'summary'>>
): EvidenceResult {
  return {
    status,
    summary,
    ...options,
  };
}

/**
 * Creates a default gate status (pending).
 */
export function createDefaultGateStatus(
  gate: QualityGate,
  required: boolean = true
): GateStatus {
  return {
    gate,
    status: 'PENDING',
    required,
    evidence_ids: [],
    all_evidence_fresh: true,
    message: 'Gate not yet evaluated',
    validated_at: new Date().toISOString(),
  };
}

// =============================================================================
// Helper Result Functions
// =============================================================================

/**
 * Creates a successful evidence creation result.
 */
export function createEvidenceSuccess(evidence: Evidence): CreateEvidenceResult {
  return ok(evidence);
}

/**
 * Creates a failed evidence creation result.
 */
export function createEvidenceFailure(error: EvidenceError): CreateEvidenceResult {
  return err(error);
}

/**
 * Creates a successful staleness check result.
 */
export function checkStalenessSuccess(check: StalenessCheck): CheckStalenessResult {
  return ok(check);
}

/**
 * Creates a failed staleness check result.
 */
export function checkStalenessFailure(error: EvidenceError): CheckStalenessResult {
  return err(error);
}

/**
 * Creates a successful gate validation result.
 */
export function validateGateSuccess(validation: GateValidation): ValidateGateResult {
  return ok(validation);
}

/**
 * Creates a failed gate validation result.
 */
export function validateGateFailure(error: EvidenceError): ValidateGateResult {
  return err(error);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Checks if an evidence type is valid.
 */
export function isValidEvidenceType(type: unknown): type is EvidenceType {
  const validTypes: EvidenceType[] = [
    'TDD_RED', 'TDD_GREEN', 'TDD_REFACTOR', 'TDD_VERIFY',
    'UNIT_TEST', 'INTEGRATION_TEST', 'E2E_TEST',
    'LINT', 'TYPE_CHECK', 'SECURITY_SCAN',
    'MANUAL_REVIEW', 'BUILD',
    'DEPLOY_STAGING', 'DEPLOY_PRODUCTION',
    'CUSTOM',
  ];
  return typeof type === 'string' && validTypes.includes(type as EvidenceType);
}

/**
 * Checks if a result status is valid.
 */
export function isValidResultStatus(status: unknown): status is EvidenceResultStatus {
  const validStatuses: EvidenceResultStatus[] = [
    'PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_APPLICABLE', 'ERROR',
  ];
  return typeof status === 'string' && validStatuses.includes(status as EvidenceResultStatus);
}

/**
 * Checks if a quality gate is valid.
 */
export function isValidQualityGate(gate: unknown): gate is QualityGate {
  const validGates: QualityGate[] = [
    'unit_test', 'integration_test', 'e2e_test',
    'lint', 'type_check', 'security_scan',
    'build', 'manual_review',
  ];
  return typeof gate === 'string' && validGates.includes(gate as QualityGate);
}

/**
 * Maps evidence type to quality gate.
 */
export function evidenceTypeToGate(type: EvidenceType): QualityGate | null {
  const mapping: Partial<Record<EvidenceType, QualityGate>> = {
    'UNIT_TEST': 'unit_test',
    'TDD_RED': 'unit_test',
    'TDD_GREEN': 'unit_test',
    'TDD_REFACTOR': 'unit_test',
    'TDD_VERIFY': 'unit_test',
    'INTEGRATION_TEST': 'integration_test',
    'E2E_TEST': 'e2e_test',
    'LINT': 'lint',
    'TYPE_CHECK': 'type_check',
    'SECURITY_SCAN': 'security_scan',
    'BUILD': 'build',
    'MANUAL_REVIEW': 'manual_review',
  };
  return mapping[type] ?? null;
}

/**
 * Checks if evidence is for TDD phase.
 */
export function isTddEvidence(type: EvidenceType): boolean {
  return type.startsWith('TDD_');
}

/**
 * Gets TDD phase from evidence type.
 */
export function getTddPhaseFromType(type: EvidenceType): TddPhase | null {
  const mapping: Partial<Record<EvidenceType, TddPhase>> = {
    'TDD_RED': 'RED',
    'TDD_GREEN': 'GREEN',
    'TDD_REFACTOR': 'REFACTOR',
    'TDD_VERIFY': 'VERIFY',
  };
  return mapping[type] ?? null;
}

/**
 * Sorts evidence by creation time (newest first).
 */
export function sortEvidenceByDate(evidence: Evidence[]): Evidence[] {
  return [...evidence].sort((a, b) => {
    const dateA = new Date(a.created_at);
    const dateB = new Date(b.created_at);
    return dateB.getTime() - dateA.getTime();
  });
}

/**
 * Filters evidence by task ID.
 */
export function filterEvidenceByTask(
  evidence: Evidence[],
  taskId: string
): Evidence[] {
  return evidence.filter(e => e.task_id === taskId);
}

/**
 * Filters evidence by type.
 */
export function filterEvidenceByType(
  evidence: Evidence[],
  type: EvidenceType
): Evidence[] {
  return evidence.filter(e => e.type === type);
}

/**
 * Filters stale evidence.
 */
export function filterStaleEvidence(evidence: Evidence[]): Evidence[] {
  return evidence.filter(e => e.staleness.stale);
}

/**
 * Filters fresh (non-stale) evidence.
 */
export function filterFreshEvidence(evidence: Evidence[]): Evidence[] {
  return evidence.filter(e => !e.staleness.stale);
}

/**
 * Groups evidence by task ID.
 */
export function groupEvidenceByTask(
  evidence: Evidence[]
): Map<string, Evidence[]> {
  const groups = new Map<string, Evidence[]>();
  
  for (const e of evidence) {
    const existing = groups.get(e.task_id) ?? [];
    existing.push(e);
    groups.set(e.task_id, existing);
  }
  
  return groups;
}

/**
 * Groups evidence by type.
 */
export function groupEvidenceByType(
  evidence: Evidence[]
): Map<EvidenceType, Evidence[]> {
  const groups = new Map<EvidenceType, Evidence[]>();
  
  for (const e of evidence) {
    const existing = groups.get(e.type) ?? [];
    existing.push(e);
    groups.set(e.type, existing);
  }
  
  return groups;
}

/**
 * Calculates evidence age in days.
 */
export function getEvidenceAgeDays(evidence: Evidence): number {
  const createdAt = new Date(evidence.created_at);
  const now = new Date();
  const diffMs = now.getTime() - createdAt.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determines if evidence is fresh based on age.
 */
export function isEvidenceFresh(
  evidence: Evidence,
  maxAgeDays: number = EVIDENCE_DEFAULTS.MAX_FRESH_AGE_DAYS
): boolean {
  if (evidence.staleness.stale) {
    return false;
  }
  return getEvidenceAgeDays(evidence) <= maxAgeDays;
}

// =============================================================================
// TDD Validation Types
// =============================================================================

/**
 * TDD validation error codes for detailed error reporting.
 * Requirements: R05.8
 */
export type TddValidationErrorCode =
  | 'TEST_PASSED_UNEXPECTEDLY'     // Test passed when it should fail (RED invalid)
  | 'TEST_FAILED_WRONG_REASON'     // Test failed but not for expected reason
  | 'TEST_ERROR_DETECTED'          // Syntax, import, assertion bug
  | 'ENVIRONMENT_ERROR_DETECTED'   // Runtime, connection, config issue
  | 'TEST_SKIPPED'                 // Test not executed
  | 'TEST_STILL_FAILING'           // Test should pass but still fails (GREEN invalid)
  | 'REGRESSION_DETECTED'          // Previously passing test now fails
  | 'TEST_ID_MISMATCH'             // Test ID doesn't match between phases
  | 'MISSING_RED_EVIDENCE'         // GREEN/REFACTOR without prior RED
  | 'MISSING_GREEN_EVIDENCE'       // REFACTOR without prior GREEN
  | 'VERIFICATION_FAILED'          // Final verification checks failed
  | 'INVALID_PHASE_SEQUENCE';      // Phase transition not allowed

/**
 * Detailed TDD validation result.
 * Requirements: R05.1, R05.2, R05.3, R05.8
 */
export interface TddValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Phase that was validated */
  phase: TddPhase;
  /** Error code if validation failed */
  error_code?: TddValidationErrorCode;
  /** Human-readable reason for failure */
  reason?: string;
  /** Detailed diagnostics for debugging */
  diagnostics?: TddValidationDiagnostics;
  /** Suggestions for fixing the issue */
  suggested_actions?: string[];
  /** Timestamp of validation */
  validated_at: string;
}

/**
 * Diagnostics information for TDD validation.
 * Requirements: R05.3
 */
export interface TddValidationDiagnostics {
  /** Test file being validated */
  test_file?: string;
  /** Test name being validated */
  test_name?: string;
  /** Expected behavior for the phase */
  expected_behavior?: string;
  /** Actual behavior observed */
  actual_behavior?: string;
  /** Failure type observed */
  failure_type?: TestFailureType;
  /** Exit code from test execution */
  exit_code?: number;
  /** Reference evidence IDs for correlation */
  reference_evidence_ids?: string[];
  /** Tests that regressed (for REFACTOR phase) */
  regressed_tests?: string[];
  /** Coverage change (for REFACTOR phase) */
  coverage_change?: {
    before: number;
    after: number;
    allowed: boolean;
  };
}

/**
 * Test identifier for correlation between TDD phases.
 * Requirements: R05.4 - Track test IDs for correlation
 */
export interface TestIdentifier {
  /** Test file path */
  file: string;
  /** Test name or description */
  name: string;
  /** Full test path (describe blocks + test name) */
  full_path?: string;
}

/**
 * Extracts test identifier from evidence result.
 */
export function extractTestIdentifier(result: EvidenceResult): TestIdentifier | null {
  if (!result.test_file || !result.test_name) {
    return null;
  }
  return {
    file: result.test_file,
    name: result.test_name,
    full_path: result.test_name,
  };
}

/**
 * Checks if two test identifiers match.
 */
export function testIdentifiersMatch(a: TestIdentifier | null, b: TestIdentifier | null): boolean {
  if (!a || !b) return false;
  
  // Primary match: same file and name
  if (a.file === b.file && a.name === b.name) {
    return true;
  }
  
  // Secondary match: same full path (if available)
  if (a.full_path && b.full_path && a.full_path === b.full_path) {
    return true;
  }
  
  return false;
}

// =============================================================================
// TDD Phase Validation Functions
// =============================================================================

/**
 * Validates RED phase evidence.
 * RED phase expects test to fail because behavior is not yet implemented.
 * 
 * Requirements: R05.1, R05.2, R05.3, R05.8
 * 
 * @param evidence - The evidence to validate
 * @returns TddValidationResult with detailed diagnostics
 * 
 * Validation rules:
 * - Test MUST fail (status = FAIL)
 * - Failure MUST be due to BEHAVIOR_MISSING
 * - TEST_ERROR and ENVIRONMENT_ERROR are rejected
 * - SKIPPED tests are invalid evidence
 */
export function validateTddRed(evidence: Evidence): TddValidationResult {
  const now = new Date().toISOString();
  const result = evidence.result;
  
  const diagnostics: TddValidationDiagnostics = {
    test_file: result.test_file,
    test_name: result.test_name,
    expected_behavior: 'Test fails because behavior is not implemented',
    failure_type: result.failure_type,
    exit_code: evidence.execution.exit_code,
  };
  
  // Case 1: Test passed when it should fail
  // Requirements: R05.1 - Detect when behavior already exists
  if (result.status === 'PASS') {
    return {
      valid: false,
      phase: 'RED',
      error_code: 'TEST_PASSED_UNEXPECTEDLY',
      reason: 'Test passed when it should fail - behavior already exists or test is incorrect',
      diagnostics: {
        ...diagnostics,
        actual_behavior: 'Test passed',
        expected_behavior: 'Test should fail because behavior is not yet implemented',
      },
      suggested_actions: [
        'Verify the behavior being tested is not already implemented',
        'Check if the test is actually testing the intended behavior',
        'Ensure test assertions are correctly written',
        'Review if this is a new test or an existing one that was modified',
      ],
      validated_at: now,
    };
  }
  
  // Case 2: Test has error status (not FAIL)
  if (result.status !== 'FAIL') {
    return {
      valid: false,
      phase: 'RED',
      error_code: 'TEST_FAILED_WRONG_REASON',
      reason: `RED phase requires FAIL status, got ${result.status}`,
      diagnostics: {
        ...diagnostics,
        actual_behavior: `Status: ${result.status}`,
      },
      suggested_actions: [
        'Ensure test can be executed properly',
        'Check test configuration and setup',
      ],
      validated_at: now,
    };
  }
  
  // Case 3: Test failed due to TEST_ERROR
  // Requirements: R05.8 - Distinguish TEST_ERROR from BEHAVIOR_MISSING
  if (result.failure_type === 'TEST_ERROR') {
    return {
      valid: false,
      phase: 'RED',
      error_code: 'TEST_ERROR_DETECTED',
      reason: 'Test failed due to syntax, import, or assertion bug - fix test first',
      diagnostics: {
        ...diagnostics,
        actual_behavior: 'Test has syntax/import/assertion error',
        expected_behavior: 'Test should fail due to missing behavior, not test bugs',
      },
      suggested_actions: [
        'Check for syntax errors in the test file',
        'Verify all imports are correct',
        'Ensure assertion logic is valid',
        'Run test in isolation to identify the error',
      ],
      validated_at: now,
    };
  }
  
  // Case 4: Test failed due to ENVIRONMENT_ERROR
  // Requirements: R05.8 - Distinguish ENVIRONMENT_ERROR from BEHAVIOR_MISSING
  if (result.failure_type === 'ENVIRONMENT_ERROR') {
    return {
      valid: false,
      phase: 'RED',
      error_code: 'ENVIRONMENT_ERROR_DETECTED',
      reason: 'Test failed due to environment issue - fix environment first',
      diagnostics: {
        ...diagnostics,
        actual_behavior: 'Environment error (runtime, connection, config)',
        expected_behavior: 'Test should fail due to missing behavior, not environment issues',
      },
      suggested_actions: [
        'Check database/service connections',
        'Verify environment variables are set',
        'Ensure required services are running',
        'Review test configuration files',
      ],
      validated_at: now,
    };
  }
  
  // Case 5: Test was skipped
  // Requirements: R05.8 - SKIPPED is invalid evidence
  if (result.failure_type === 'SKIPPED') {
    return {
      valid: false,
      phase: 'RED',
      error_code: 'TEST_SKIPPED',
      reason: 'Test was not executed - invalid RED evidence',
      diagnostics: {
        ...diagnostics,
        actual_behavior: 'Test was skipped/not executed',
        expected_behavior: 'Test must be executed to validate RED phase',
      },
      suggested_actions: [
        'Remove skip annotation from test',
        'Check test filter/grep pattern',
        'Ensure test is not conditionally skipped',
      ],
      validated_at: now,
    };
  }
  
  // Case 6: Test failed but not for BEHAVIOR_MISSING reason
  // Requirements: R05.2 - RED valid ONLY IF test fails for behavior missing
  if (result.failure_type !== 'BEHAVIOR_MISSING') {
    return {
      valid: false,
      phase: 'RED',
      error_code: 'TEST_FAILED_WRONG_REASON',
      reason: `RED phase requires BEHAVIOR_MISSING failure type, got ${result.failure_type ?? 'undefined'}`,
      diagnostics: {
        ...diagnostics,
        actual_behavior: `Failure type: ${result.failure_type ?? 'undefined'}`,
        expected_behavior: 'Failure type should be BEHAVIOR_MISSING',
      },
      suggested_actions: [
        'Categorize the test failure correctly',
        'Ensure the failure message indicates missing behavior',
        'Review the test assertion that failed',
      ],
      validated_at: now,
    };
  }
  
  // All validations passed - RED phase is valid
  return {
    valid: true,
    phase: 'RED',
    diagnostics: {
      ...diagnostics,
      actual_behavior: 'Test fails as expected due to missing behavior',
    },
    validated_at: now,
  };
}

/**
 * Validates GREEN phase evidence against RED phase evidence.
 * GREEN phase expects the same test that failed in RED to now pass.
 * 
 * Requirements: R05.4
 * 
 * @param greenEvidence - The GREEN phase evidence to validate
 * @param redEvidence - The RED phase evidence for correlation (optional)
 * @returns TddValidationResult with detailed diagnostics
 * 
 * Validation rules:
 * - Test MUST pass (status = PASS)
 * - No other tests should fail (no regression)
 * - If redEvidence provided, same test should be correlated
 */
export function validateTddGreen(
  greenEvidence: Evidence,
  redEvidence?: Evidence
): TddValidationResult {
  const now = new Date().toISOString();
  const result = greenEvidence.result;
  
  const diagnostics: TddValidationDiagnostics = {
    test_file: result.test_file,
    test_name: result.test_name,
    expected_behavior: 'Test passes with implementation',
    exit_code: greenEvidence.execution.exit_code,
    reference_evidence_ids: redEvidence ? [redEvidence.evidence_id] : undefined,
  };
  
  // Case 1: Test still failing
  // Requirements: R05.4 - GREEN phase expects test to PASS
  if (result.status !== 'PASS') {
    return {
      valid: false,
      phase: 'GREEN',
      error_code: 'TEST_STILL_FAILING',
      reason: `GREEN phase requires PASS status, got ${result.status}`,
      diagnostics: {
        ...diagnostics,
        actual_behavior: `Test still failing with status: ${result.status}`,
        failure_type: result.failure_type,
      },
      suggested_actions: [
        'Implement the minimum code to make the test pass',
        'Check if the implementation matches the test expectations',
        'Review the test failure message for hints',
        'Ensure all dependencies are properly set up',
      ],
      validated_at: now,
    };
  }
  
  // Case 2: Regression - other tests failing
  // Requirements: R05.4 - No other tests should FAIL
  if (result.tests_failed && result.tests_failed > 0) {
    return {
      valid: false,
      phase: 'GREEN',
      error_code: 'REGRESSION_DETECTED',
      reason: `GREEN phase cannot have failing tests, ${result.tests_failed} tests failed`,
      diagnostics: {
        ...diagnostics,
        actual_behavior: `${result.tests_failed} tests failed`,
        expected_behavior: 'All tests should pass',
      },
      suggested_actions: [
        'Fix the failing tests before proceeding',
        'Check if the new implementation broke existing functionality',
        'Run tests individually to identify the regression',
      ],
      validated_at: now,
    };
  }
  
  // Case 3: Test ID mismatch (if RED evidence provided)
  // Requirements: R05.4 - Track test IDs for correlation
  if (redEvidence) {
    const greenTestId = extractTestIdentifier(result);
    const redTestId = extractTestIdentifier(redEvidence.result);
    
    if (greenTestId && redTestId && !testIdentifiersMatch(greenTestId, redTestId)) {
      return {
        valid: false,
        phase: 'GREEN',
        error_code: 'TEST_ID_MISMATCH',
        reason: 'GREEN phase test does not match RED phase test',
        diagnostics: {
          ...diagnostics,
          actual_behavior: `GREEN: ${greenTestId.file}::${greenTestId.name}`,
          expected_behavior: `Expected: ${redTestId.file}::${redTestId.name}`,
        },
        suggested_actions: [
          'Ensure you are running the same test that was written in RED phase',
          'Check test file and test name match',
          'Verify test was not renamed or moved',
        ],
        validated_at: now,
      };
    }
  }
  
  // All validations passed - GREEN phase is valid
  return {
    valid: true,
    phase: 'GREEN',
    diagnostics: {
      ...diagnostics,
      actual_behavior: 'Test passes with implementation',
    },
    validated_at: now,
  };
}

/**
 * Validates REFACTOR phase evidence against GREEN phase evidence.
 * REFACTOR phase expects all tests to still pass after refactoring.
 * 
 * Requirements: R05.5, R05.6
 * 
 * @param refactorEvidence - The REFACTOR phase evidence to validate
 * @param greenEvidence - The GREEN phase evidence for correlation (optional)
 * @returns TddValidationResult with detailed diagnostics
 * 
 * Validation rules:
 * - All tests MUST pass (status = PASS)
 * - No regression (tests that passed before should still pass)
 * - Coverage changes are allowed
 */
export function validateTddRefactor(
  refactorEvidence: Evidence,
  greenEvidence?: Evidence
): TddValidationResult {
  const now = new Date().toISOString();
  const result = refactorEvidence.result;
  
  const diagnostics: TddValidationDiagnostics = {
    test_file: result.test_file,
    test_name: result.test_name,
    expected_behavior: 'All tests pass after refactoring',
    exit_code: refactorEvidence.execution.exit_code,
    reference_evidence_ids: greenEvidence ? [greenEvidence.evidence_id] : undefined,
  };
  
  // Track coverage change if available
  if (greenEvidence?.result.coverage_percent !== undefined && result.coverage_percent !== undefined) {
    diagnostics.coverage_change = {
      before: greenEvidence.result.coverage_percent,
      after: result.coverage_percent,
      allowed: true, // Coverage changes are allowed in REFACTOR
    };
  }
  
  // Case 1: Tests failing after refactor
  // Requirements: R05.5 - All tests must still pass
  if (result.status !== 'PASS') {
    return {
      valid: false,
      phase: 'REFACTOR',
      error_code: 'REGRESSION_DETECTED',
      reason: `REFACTOR phase requires PASS status, got ${result.status}`,
      diagnostics: {
        ...diagnostics,
        actual_behavior: `Tests failing after refactor: ${result.status}`,
      },
      suggested_actions: [
        'Rollback the refactoring changes',
        'Identify which refactoring caused the regression',
        'Fix the regression before proceeding',
        'Consider smaller, incremental refactoring steps',
      ],
      validated_at: now,
    };
  }
  
  // Case 2: Regression failure type explicitly set
  // Requirements: R05.6 - Handle test FAIL after REFACTOR
  if (result.failure_type === 'REGRESSION') {
    return {
      valid: false,
      phase: 'REFACTOR',
      error_code: 'REGRESSION_DETECTED',
      reason: 'Refactoring caused regression - rollback or fix required',
      diagnostics: {
        ...diagnostics,
        actual_behavior: 'Regression detected after refactoring',
      },
      suggested_actions: [
        'Rollback to pre-refactor state',
        'Identify the specific change that caused regression',
        'Apply fix before completing refactor',
        'Consider breaking refactoring into smaller steps',
      ],
      validated_at: now,
    };
  }
  
  // Case 3: Some tests failed
  if (result.tests_failed && result.tests_failed > 0) {
    return {
      valid: false,
      phase: 'REFACTOR',
      error_code: 'REGRESSION_DETECTED',
      reason: `REFACTOR phase cannot have failing tests, ${result.tests_failed} tests failed`,
      diagnostics: {
        ...diagnostics,
        actual_behavior: `${result.tests_failed} tests failed after refactoring`,
        expected_behavior: 'All tests should pass after refactoring',
      },
      suggested_actions: [
        'Rollback refactoring changes',
        'Run tests to identify which ones regressed',
        'Fix regressions before completing refactor',
      ],
      validated_at: now,
    };
  }
  
  // Case 4: Check test count consistency (if GREEN evidence provided)
  if (greenEvidence && greenEvidence.result.tests_total !== undefined && result.tests_total !== undefined) {
    // Refactoring should not remove tests
    if (result.tests_total < greenEvidence.result.tests_total) {
      diagnostics.regressed_tests = ['Some tests may have been removed'];
    }
  }
  
  // All validations passed - REFACTOR phase is valid
  return {
    valid: true,
    phase: 'REFACTOR',
    diagnostics: {
      ...diagnostics,
      actual_behavior: 'All tests pass after refactoring',
    },
    validated_at: now,
  };
}

/**
 * Validates VERIFY phase evidence.
 * VERIFY phase performs final verification checks.
 * 
 * @param evidence - The VERIFY phase evidence to validate
 * @returns TddValidationResult with detailed diagnostics
 * 
 * Validation rules:
 * - All checks MUST pass (status = PASS)
 * - Can include additional verification (lint, type check, etc.)
 */
export function validateTddVerify(evidence: Evidence): TddValidationResult {
  const now = new Date().toISOString();
  const result = evidence.result;
  
  const diagnostics: TddValidationDiagnostics = {
    test_file: result.test_file,
    test_name: result.test_name,
    expected_behavior: 'All verification checks pass',
    exit_code: evidence.execution.exit_code,
  };
  
  // Case 1: Verification failed
  if (result.status !== 'PASS' && result.status !== 'NOT_APPLICABLE') {
    return {
      valid: false,
      phase: 'VERIFY',
      error_code: 'VERIFICATION_FAILED',
      reason: `VERIFY phase requires PASS status, got ${result.status}`,
      diagnostics: {
        ...diagnostics,
        actual_behavior: `Verification failed: ${result.status}`,
      },
      suggested_actions: [
        'Review verification failure details',
        'Fix any lint errors',
        'Fix any type check errors',
        'Ensure all quality gates pass',
      ],
      validated_at: now,
    };
  }
  
  // Case 2: Some checks failed
  if (result.tests_failed && result.tests_failed > 0) {
    return {
      valid: false,
      phase: 'VERIFY',
      error_code: 'VERIFICATION_FAILED',
      reason: `VERIFY phase failed: ${result.tests_failed} checks failed`,
      diagnostics: {
        ...diagnostics,
        actual_behavior: `${result.tests_failed} verification checks failed`,
      },
      suggested_actions: [
        'Review which checks failed',
        'Address each failing check',
        'Re-run verification after fixes',
      ],
      validated_at: now,
    };
  }
  
  // All validations passed - VERIFY phase is valid
  return {
    valid: true,
    phase: 'VERIFY',
    diagnostics: {
      ...diagnostics,
      actual_behavior: 'All verification checks pass',
    },
    validated_at: now,
  };
}

/**
 * Validates TDD evidence based on its phase.
 * Dispatches to the appropriate phase validator.
 * 
 * Requirements: R05.1, R05.2, R05.3, R05.4, R05.5, R05.8
 * 
 * @param evidence - The evidence to validate
 * @param priorEvidence - Prior phase evidence for correlation (optional)
 * @returns TddValidationResult
 */
export function validateTddEvidence(
  evidence: Evidence,
  priorEvidence?: Evidence
): TddValidationResult {
  const phase = evidence.tdd_phase;
  
  if (!phase) {
    return {
      valid: false,
      phase: 'PENDING',
      error_code: 'INVALID_PHASE_SEQUENCE',
      reason: 'Evidence has no TDD phase specified',
      validated_at: new Date().toISOString(),
    };
  }
  
  switch (phase) {
    case 'RED':
      return validateTddRed(evidence);
    case 'GREEN':
      return validateTddGreen(evidence, priorEvidence);
    case 'REFACTOR':
      return validateTddRefactor(evidence, priorEvidence);
    case 'VERIFY':
      return validateTddVerify(evidence);
    default:
      return {
        valid: false,
        phase: phase,
        error_code: 'INVALID_PHASE_SEQUENCE',
        reason: `Unknown TDD phase: ${phase}`,
        validated_at: new Date().toISOString(),
      };
  }
}

// =============================================================================
// Legacy Validation Functions (Backward Compatibility)
// =============================================================================

/**
 * Validates RED phase evidence (legacy function).
 * Requirements: R05.2
 * @deprecated Use validateTddRed() for detailed validation
 */
export function validateRedPhaseEvidence(result: EvidenceResult): {
  valid: boolean;
  reason?: string;
} {
  // RED phase expects test to fail for BEHAVIOR_MISSING reason
  if (result.status === 'PASS') {
    return {
      valid: false,
      reason: 'Test passed when it should fail - behavior already exists or test is incorrect',
    };
  }
  
  if (result.status !== 'FAIL') {
    return {
      valid: false,
      reason: `RED phase requires FAIL status, got ${result.status}`,
    };
  }
  
  if (result.failure_type === 'TEST_ERROR') {
    return {
      valid: false,
      reason: 'Test failed due to syntax, import, or assertion bug - fix test first',
    };
  }
  
  if (result.failure_type === 'ENVIRONMENT_ERROR') {
    return {
      valid: false,
      reason: 'Test failed due to environment issue - fix environment first',
    };
  }
  
  if (result.failure_type === 'SKIPPED') {
    return {
      valid: false,
      reason: 'Test was not executed - invalid RED evidence',
    };
  }
  
  if (result.failure_type !== 'BEHAVIOR_MISSING') {
    return {
      valid: false,
      reason: `RED phase requires BEHAVIOR_MISSING failure type, got ${result.failure_type}`,
    };
  }
  
  return { valid: true };
}

/**
 * Validates GREEN phase evidence (legacy function).
 * Requirements: R05.4
 * @deprecated Use validateTddGreen() for detailed validation with correlation
 */
export function validateGreenPhaseEvidence(result: EvidenceResult): {
  valid: boolean;
  reason?: string;
} {
  if (result.status !== 'PASS') {
    return {
      valid: false,
      reason: `GREEN phase requires PASS status, got ${result.status}`,
    };
  }
  
  // Check for regressions
  if (result.tests_failed && result.tests_failed > 0) {
    return {
      valid: false,
      reason: `GREEN phase cannot have failing tests, ${result.tests_failed} tests failed`,
    };
  }
  
  return { valid: true };
}

/**
 * Validates REFACTOR phase evidence (legacy function).
 * Requirements: R05.5
 * @deprecated Use validateTddRefactor() for detailed validation with correlation
 */
export function validateRefactorPhaseEvidence(result: EvidenceResult): {
  valid: boolean;
  reason?: string;
} {
  if (result.status !== 'PASS') {
    return {
      valid: false,
      reason: `REFACTOR phase requires PASS status, got ${result.status}`,
    };
  }
  
  if (result.failure_type === 'REGRESSION') {
    return {
      valid: false,
      reason: 'Refactoring caused regression - rollback or fix required',
    };
  }
  
  return { valid: true };
}
