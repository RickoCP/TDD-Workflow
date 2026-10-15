/**
 * Finding Register - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Finding_Register component
 * which provides review findings management, status tracking, and review closure logic.
 * 
 * The Finding_Register ensures review cycle convergence by:
 * - Tracking findings with severity and status
 * - Managing finding lifecycle (open → resolved)
 * - Enforcing review closure criteria
 * - Supporting finding reopen with evidence
 * 
 * Requirements: R11.1, R11.2, R11.3, R11.4, R11.5, R11.6, R11.7, R11.8
 */

import { 
  Result, 
  ok, 
  err,
} from './state-controller';

// =============================================================================
// Re-exports from state-controller for convenience
// =============================================================================

export { Result, ok, err } from './state-controller';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for finding operations.
 * Requirements: R11
 */
export const FINDING_DEFAULTS = {
  /** Directory name for findings storage */
  STORAGE_DIR: '.kiro/sdlc/findings',
  /** Finding ID prefix */
  ID_PREFIX: 'FND',
  /** Maximum review rounds before escalation */
  MAX_REVIEW_ROUNDS: 5,
  /** Default finding ID format pattern */
  ID_PATTERN: /^FND-\d{3,}$/,
} as const;

// =============================================================================
// Type Definitions - Finding Status
// =============================================================================

/**
 * Finding status values.
 * Requirements: R11.1, R11.4, R11.5
 */
export type FindingStatus = 
  | 'OPEN'        // Finding identified, not yet addressed
  | 'IN_PROGRESS' // Developer working on fix
  | 'RESOLVED'    // Fix applied and verified
  | 'WONT_FIX'    // Decided not to fix with justification
  | 'DUPLICATE'   // Duplicate of another finding
  | 'DEFERRED';   // Deferred to backlog with approval (for MEDIUM/LOW)

/**
 * Maps finding status to human-readable descriptions.
 */
export const FINDING_STATUS_DESCRIPTIONS: Record<FindingStatus, string> = {
  OPEN: 'Finding identified, not yet addressed',
  IN_PROGRESS: 'Developer working on fix',
  RESOLVED: 'Fix applied and verified',
  WONT_FIX: 'Decided not to fix with justification',
  DUPLICATE: 'Duplicate of another finding',
  DEFERRED: 'Deferred to backlog with approval',
};

/**
 * Valid status transitions for findings.
 * Requirements: R11.1, R11.3, R11.4, R11.5
 */
export const VALID_STATUS_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'WONT_FIX', 'DUPLICATE', 'DEFERRED'],
  IN_PROGRESS: ['RESOLVED', 'WONT_FIX', 'OPEN', 'DEFERRED'],
  RESOLVED: ['OPEN'], // Can be reopened with new evidence
  WONT_FIX: ['OPEN'], // Can be reopened with new evidence
  DUPLICATE: ['OPEN'], // Can be reopened if not actually duplicate
  DEFERRED: ['OPEN', 'IN_PROGRESS'], // Can be un-deferred and worked on
};

// =============================================================================
// Type Definitions - Finding Severity
// =============================================================================

/**
 * Finding severity levels.
 * Requirements: R11.4
 * 
 * Severity definitions (operational):
 * - CRITICAL: Blocks release, must fix immediately
 * - HIGH: Must fix before task DONE
 * - MEDIUM: Should fix before task DONE, may defer with justification
 * - LOW: Nice to fix, can defer to backlog
 * - INFO: Suggestion only, no action required
 */
export type FindingSeverity = 
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INFO';

/**
 * Maps finding severity to human-readable descriptions.
 * Requirements: R11.4
 */
export const FINDING_SEVERITY_DESCRIPTIONS: Record<FindingSeverity, string> = {
  CRITICAL: 'Blocks release, must fix immediately',
  HIGH: 'Must fix before task DONE',
  MEDIUM: 'Should fix before task DONE, may defer with justification',
  LOW: 'Nice to fix, can defer to backlog',
  INFO: 'Suggestion only, no action required',
};

/**
 * Severity levels that block task completion.
 * Requirements: R11.5
 */
export const BLOCKING_SEVERITIES: FindingSeverity[] = ['CRITICAL', 'HIGH'];

/**
 * Severity levels that block release.
 * Requirements: R11.5
 */
export const RELEASE_BLOCKING_SEVERITIES: FindingSeverity[] = ['CRITICAL', 'HIGH'];

// =============================================================================
// Type Definitions - Finding Category
// =============================================================================

/**
 * Finding category types.
 * Requirements: R11.1
 */
export type FindingCategory = 
  | 'BUG'           // Functional bug
  | 'SECURITY'      // Security vulnerability
  | 'PERFORMANCE'   // Performance issue
  | 'STYLE'         // Code style/convention issue
  | 'DOCUMENTATION' // Documentation issue
  | 'OTHER';        // Other type of finding

/**
 * Maps finding category to human-readable descriptions.
 */
export const FINDING_CATEGORY_DESCRIPTIONS: Record<FindingCategory, string> = {
  BUG: 'Functional bug or defect',
  SECURITY: 'Security vulnerability or concern',
  PERFORMANCE: 'Performance issue or inefficiency',
  STYLE: 'Code style or convention violation',
  DOCUMENTATION: 'Documentation issue or missing docs',
  OTHER: 'Other type of finding',
};

// =============================================================================
// Type Definitions - Finding Scope
// =============================================================================

/**
 * Finding scope - either file location or general.
 * Requirements: R11.1
 */
export type FindingScope = FindingScopeFileLocation | FindingScopeGeneral;

/**
 * File location scope for findings.
 */
export interface FindingScopeFileLocation {
  /** Scope type identifier */
  type: 'file_location';
  /** File path */
  file: string;
  /** Starting line number */
  line_start: number;
  /** Ending line number (optional, defaults to line_start) */
  line_end?: number;
}

/**
 * General scope for findings (not tied to specific file).
 */
export interface FindingScopeGeneral {
  /** Scope type identifier */
  type: 'general';
  /** Description of the general scope */
  area?: string;
}

// =============================================================================
// Type Definitions - Resolution Info
// =============================================================================

/**
 * Resolution information for resolved findings.
 * Requirements: R11.1
 */
export interface ResolutionInfo {
  /** Evidence that the fix was applied */
  resolution_evidence: string;
  /** Timestamp when resolved */
  resolved_at: string;
  /** Who resolved the finding */
  resolved_by: string;
  /** Commit SHA with the fix */
  commit_sha?: string;
  /** Additional notes about resolution */
  notes?: string;
}

// =============================================================================
// Type Definitions - Finding History
// =============================================================================

/**
 * Finding history action types.
 */
export type FindingHistoryAction = 
  | 'created'
  | 'status_changed'
  | 'severity_changed'
  | 'reassigned'
  | 'reopened'
  | 'commented';

/**
 * Finding history entry.
 * Requirements: R11.1
 */
export interface FindingHistoryEntry {
  /** Action that was performed */
  action: FindingHistoryAction;
  /** Timestamp of the action */
  timestamp: string;
  /** Who performed the action */
  by: string;
  /** Previous value (for changes) */
  from?: string;
  /** New value (for changes) */
  to?: string;
  /** Additional details or comment */
  details?: string;
}

// =============================================================================
// Type Definitions - Finding
// =============================================================================

/**
 * Complete finding record.
 * Requirements: R11.1, R11.4, R11.5
 */
export interface Finding {
  /** Unique finding identifier (FND-xxx) */
  finding_id: string;
  /** Timestamp when finding was created */
  created_at: string;
  
  /** Related task ID */
  task_id: string;
  /** Which review iteration this finding is from */
  review_round: number;
  
  /** Severity of the finding */
  severity: FindingSeverity;
  /** Category of the finding */
  category: FindingCategory;
  
  /** Scope of the finding (file location or general) */
  scope: FindingScope;
  
  /** Description of the finding */
  description: string;
  /** Evidence of how finding was discovered */
  evidence: string;
  /** What constitutes a fix for this finding */
  acceptance_criteria: string;
  
  /** Owner responsible for addressing the finding */
  owner_id: string;
  /** Current status */
  status: FindingStatus;
  
  /** Resolution information (when resolved) */
  resolution?: ResolutionInfo;
  
  /** Deferral information (when deferred) */
  deferral?: DeferralInfo;
  
  /** Timestamp when resolved */
  resolved_at?: string;
  
  /** History of changes to this finding */
  history: FindingHistoryEntry[];
  
  /** Reference to duplicate finding (if status is DUPLICATE) */
  duplicate_of?: string;
  
  /**
   * Reference to original finding ID (if this finding was created as a
   * "different issue" via reopenFinding with is_different_issue=true).
   * Requirements: R11.3
   */
  original_finding_id?: string;
  
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Type Definitions - Finding Input
// =============================================================================

/**
 * Input for creating new finding.
 * Requirements: R11.1
 */
export interface FindingInput {
  /** Related task ID */
  task_id: string;
  /** Which review iteration this finding is from */
  review_round: number;
  /** Severity of the finding */
  severity: FindingSeverity;
  /** Category of the finding */
  category: FindingCategory;
  /** Scope of the finding */
  scope: FindingScope;
  /** Description of the finding */
  description: string;
  /** Evidence of how finding was discovered */
  evidence: string;
  /** What constitutes a fix for this finding */
  acceptance_criteria: string;
  /** Owner responsible for addressing the finding */
  owner_id: string;
  /** ID of the reviewer creating this finding */
  reviewer_id: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Type Definitions - Finding Update
// =============================================================================

/**
 * Input for updating finding status.
 */
export interface FindingStatusUpdate {
  /** New status */
  status: FindingStatus;
  /** Who is updating */
  updated_by: string;
  /** Resolution info (required for RESOLVED status) */
  resolution?: ResolutionInfo;
  /** Reference to duplicate finding (required for DUPLICATE status) */
  duplicate_of?: string;
  /** Additional notes */
  notes?: string;
}

// =============================================================================
// Type Definitions - Reopen Input
// =============================================================================

/**
 * Input for reopening a closed finding.
 * Requirements: R11.3
 */
export interface ReopenFindingInput {
  /** New evidence justifying the reopen */
  new_evidence: string;
  /** Justification for reopening */
  justification: string;
  /** Who is reopening */
  reopened_by: string;
  /**
   * Whether this is a different issue than the original finding.
   * - If true: Creates a new finding with a new ID but links to the original.
   *   The original finding remains closed.
   * - If false (default): Reopens the same finding with status=OPEN.
   */
  is_different_issue?: boolean;
}

/**
 * Result type for reopen finding operation with potential new finding.
 * Used when is_different_issue=true to return both the original and new finding.
 * Requirements: R11.3
 */
export interface ReopenFindingResultData {
  /** The finding that was operated on (reopened or referenced) */
  finding: Finding;
  /** New finding created if is_different_issue=true */
  new_finding?: Finding;
  /** Whether a new finding was created */
  created_new_finding: boolean;
}

/**
 * Result type for reopen finding operation.
 */
export type ReopenFindingResult = Result<ReopenFindingResultData, FindingError>;

// =============================================================================
// Type Definitions - Defer Finding Input
// =============================================================================

/**
 * Input for deferring a finding.
 * Requirements: R11.4, R11.5
 * 
 * Deferral rules:
 * - CRITICAL: Cannot be deferred
 * - HIGH: Cannot be deferred  
 * - MEDIUM: Can be deferred with approval
 * - LOW: Can be deferred
 * - INFO: Can be deferred (doesn't block anyway)
 */
export interface DeferFindingInput {
  /** Reason for deferring the finding */
  reason: string;
  /** Who approved the deferral */
  approved_by: string;
  /** Target for addressing deferred finding (e.g., "backlog", "next-sprint") */
  deferred_to?: string;
  /** Additional notes about deferral */
  notes?: string;
}

/**
 * Deferral information stored with the finding.
 */
export interface DeferralInfo {
  /** Reason for deferring */
  reason: string;
  /** Who approved the deferral */
  approved_by: string;
  /** When the deferral was approved */
  deferred_at: string;
  /** Target for addressing deferred finding */
  deferred_to?: string;
  /** Additional notes */
  notes?: string;
}

// =============================================================================
// Type Definitions - Review Closure
// =============================================================================

/**
 * Input for closing a review.
 * Requirements: R11.5
 */
export interface CloseReviewInput {
  /** Who is closing the review */
  closed_by: string;
  /** Optional notes about the closure */
  notes?: string;
}

/**
 * Result of a review closure operation.
 * Requirements: R11.5
 */
export interface ReviewClosureResult {
  /** Whether the review was successfully closed */
  closed: boolean;
  /** Task ID */
  task_id: string;
  /** Timestamp when review was closed */
  closed_at: string;
  /** Who closed the review */
  closed_by: string;
  /** Summary of findings at closure */
  summary: FindingsSummary;
  /** Deferred findings (not blocking) */
  deferred_findings: Finding[];
  /** Notes about the closure */
  notes?: string;
}

/**
 * Review closure check result.
 * Requirements: R11.5
 */
export interface ReviewClosureCheck {
  /** Task ID that was checked */
  task_id: string;
  /** Whether review can be closed */
  can_close: boolean;
  /** Timestamp of the check */
  checked_at: string;
  /** Summary of findings status */
  summary: FindingsSummary;
  /** Findings that are blocking closure */
  blockers: Finding[];
  /** Reasons why review cannot be closed (if can_close is false) */
  blocking_reasons: string[];
  /** Deferred findings (MEDIUM with approval) */
  deferred_findings: Finding[];
  /** Missing approvals for findings that need them */
  missing_approvals: MissingApprovalInfo[];
}

/**
 * Information about missing approvals for review closure.
 */
export interface MissingApprovalInfo {
  /** Finding ID that needs approval */
  finding_id: string;
  /** Finding severity */
  severity: FindingSeverity;
  /** Current status */
  status: FindingStatus;
  /** What approval is needed */
  approval_needed: string;
}

/**
 * Summary of findings by status and severity.
 */
export interface FindingsSummary {
  /** Total number of findings */
  total: number;
  /** Count by status */
  by_status: Record<FindingStatus, number>;
  /** Count by severity */
  by_severity: Record<FindingSeverity, number>;
  /** Number of findings blocking release */
  blocking_release: number;
  /** Number of open critical findings */
  open_critical: number;
  /** Number of open high findings */
  open_high: number;
}

// =============================================================================
// Type Definitions - Query Options
// =============================================================================

/**
 * Options for querying findings.
 */
export interface FindingQueryOptions {
  /** Filter by status */
  status?: FindingStatus | FindingStatus[];
  /** Filter by severity */
  severity?: FindingSeverity | FindingSeverity[];
  /** Filter by category */
  category?: FindingCategory | FindingCategory[];
  /** Filter by owner */
  owner_id?: string;
  /** Filter by review round */
  review_round?: number;
  /** Sort field */
  sort_by?: 'created_at' | 'severity' | 'status';
  /** Sort order */
  sort_order?: 'asc' | 'desc';
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Finding error codes following the design specification.
 * Error codes in range 2700-2799 for FINDING_ERROR category.
 * Requirements: R11
 */
export enum FindingErrorCode {
  /** Finding not found */
  FINDING_NOT_FOUND = 2701,
  /** Finding corrupted or invalid format */
  FINDING_CORRUPTED = 2702,
  /** Invalid status transition */
  INVALID_STATUS_TRANSITION = 2703,
  /** Write finding failed */
  WRITE_FAILED = 2704,
  /** Delete finding failed */
  DELETE_FAILED = 2705,
  /** Finding already exists with same ID */
  DUPLICATE_FINDING = 2706,
  /** Missing required fields */
  MISSING_REQUIRED_FIELDS = 2707,
  /** Invalid severity value */
  INVALID_SEVERITY = 2708,
  /** Invalid category value */
  INVALID_CATEGORY = 2709,
  /** Task not found for finding */
  TASK_NOT_FOUND = 2710,
  /** Resolution required for status change */
  RESOLUTION_REQUIRED = 2711,
  /** Cannot reopen without evidence */
  REOPEN_EVIDENCE_REQUIRED = 2712,
  /** Duplicate reference required */
  DUPLICATE_REF_REQUIRED = 2713,
  /** Finding is already closed */
  FINDING_ALREADY_CLOSED = 2714,
  /** Review cannot be closed */
  REVIEW_CANNOT_CLOSE = 2715,
  /** Invalid scope format */
  INVALID_SCOPE = 2716,
  /** Maximum review rounds exceeded */
  MAX_REVIEW_ROUNDS_EXCEEDED = 2717,
  /** Cannot defer finding with this severity */
  CANNOT_DEFER_SEVERITY = 2718,
  /** Deferral requires approval */
  DEFERRAL_APPROVAL_REQUIRED = 2719,
  /** Review already closed */
  REVIEW_ALREADY_CLOSED = 2720,
  /** Finding is already open - cannot reopen */
  FINDING_ALREADY_OPEN = 2721,
}

/**
 * Finding error structure following the design specification.
 */
export interface FindingError {
  /** Error code from FindingErrorCode enum */
  code: FindingErrorCode;
  /** Error category */
  category: 'FINDING_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    finding_id?: string;
    task_id?: string;
    status?: FindingStatus;
    severity?: FindingSeverity;
    from_status?: FindingStatus;
    to_status?: FindingStatus;
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
 * Creates a FindingError with the given code and details.
 */
export function createFindingError(
  code: FindingErrorCode,
  message: string,
  context?: FindingError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): FindingError {
  return {
    code,
    category: 'FINDING_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "finding not found" error.
 */
export function findingNotFoundError(findingId: string): FindingError {
  return createFindingError(
    FindingErrorCode.FINDING_NOT_FOUND,
    `Finding ${findingId} not found`,
    { finding_id: findingId },
    false,
    'Verify the finding ID is correct or list available findings'
  );
}

/**
 * Creates a "finding corrupted" error.
 */
export function findingCorruptedError(
  findingId: string,
  details?: string
): FindingError {
  return createFindingError(
    FindingErrorCode.FINDING_CORRUPTED,
    `Finding ${findingId} is corrupted: ${details || 'Invalid format'}`,
    { finding_id: findingId, details },
    false,
    'Delete the corrupted finding and create a new one'
  );
}

/**
 * Creates an "invalid status transition" error.
 * Requirements: R11.1
 */
export function invalidStatusTransitionError(
  findingId: string,
  fromStatus: FindingStatus,
  toStatus: FindingStatus
): FindingError {
  const validTransitions = VALID_STATUS_TRANSITIONS[fromStatus];
  return createFindingError(
    FindingErrorCode.INVALID_STATUS_TRANSITION,
    `Cannot transition finding ${findingId} from ${fromStatus} to ${toStatus}`,
    { 
      finding_id: findingId,
      from_status: fromStatus,
      to_status: toStatus,
      valid_transitions: validTransitions,
    },
    false,
    `Valid transitions from ${fromStatus}: ${validTransitions.join(', ')}`
  );
}

/**
 * Creates a "write failed" error.
 */
export function writeFindingFailedError(
  taskId: string,
  details?: string
): FindingError {
  return createFindingError(
    FindingErrorCode.WRITE_FAILED,
    `Failed to write finding for task ${taskId}: ${details || 'Unknown error'}`,
    { task_id: taskId, details },
    true,
    'Check disk space and permissions, then retry'
  );
}

/**
 * Creates a "missing required fields" error.
 */
export function missingRequiredFieldsError(
  fields: string[]
): FindingError {
  return createFindingError(
    FindingErrorCode.MISSING_REQUIRED_FIELDS,
    `Missing required fields: ${fields.join(', ')}`,
    { missing_fields: fields },
    false,
    'Provide all required fields when creating finding'
  );
}

/**
 * Creates a "task not found" error.
 */
export function findingTaskNotFoundError(taskId: string): FindingError {
  return createFindingError(
    FindingErrorCode.TASK_NOT_FOUND,
    `Task ${taskId} not found for finding`,
    { task_id: taskId },
    false,
    'Verify the task ID is correct'
  );
}

/**
 * Creates a "resolution required" error.
 * Requirements: R11.1
 */
export function resolutionRequiredError(findingId: string): FindingError {
  return createFindingError(
    FindingErrorCode.RESOLUTION_REQUIRED,
    `Resolution information required to mark finding ${findingId} as RESOLVED`,
    { finding_id: findingId },
    false,
    'Provide resolution evidence, timestamp, and resolver ID'
  );
}

/**
 * Creates a "reopen evidence required" error.
 * Requirements: R11.3
 */
export function reopenEvidenceRequiredError(findingId: string): FindingError {
  return createFindingError(
    FindingErrorCode.REOPEN_EVIDENCE_REQUIRED,
    `New evidence required to reopen finding ${findingId}`,
    { finding_id: findingId },
    false,
    'Provide new evidence and justification for reopening'
  );
}

/**
 * Creates a "duplicate ref required" error.
 */
export function duplicateRefRequiredError(findingId: string): FindingError {
  return createFindingError(
    FindingErrorCode.DUPLICATE_REF_REQUIRED,
    `Duplicate finding reference required to mark finding ${findingId} as DUPLICATE`,
    { finding_id: findingId },
    false,
    'Provide the finding ID that this is a duplicate of'
  );
}

/**
 * Creates a "review cannot close" error.
 * Requirements: R11.5
 */
export function reviewCannotCloseError(
  taskId: string,
  reasons: string[]
): FindingError {
  return createFindingError(
    FindingErrorCode.REVIEW_CANNOT_CLOSE,
    `Review for task ${taskId} cannot be closed: ${reasons.join('; ')}`,
    { task_id: taskId, reasons },
    true,
    'Address all blocking findings before closing review'
  );
}

/**
 * Creates an "invalid scope" error.
 */
export function invalidScopeError(details?: string): FindingError {
  return createFindingError(
    FindingErrorCode.INVALID_SCOPE,
    `Invalid finding scope: ${details || 'Unknown error'}`,
    { details },
    false,
    'Provide either file_location scope with file and line_start, or general scope'
  );
}

/**
 * Creates a "max review rounds exceeded" error.
 * Requirements: R11.8
 */
export function maxReviewRoundsExceededError(
  taskId: string,
  rounds: number
): FindingError {
  return createFindingError(
    FindingErrorCode.MAX_REVIEW_ROUNDS_EXCEEDED,
    `Task ${taskId} has exceeded maximum review rounds (${rounds})`,
    { task_id: taskId, rounds },
    false,
    'Escalate for root cause diagnosis; resolution may require design change'
  );
}

/**
 * Creates a "cannot defer severity" error.
 * Requirements: R11.4, R11.5
 */
export function cannotDeferSeverityError(
  findingId: string,
  severity: FindingSeverity
): FindingError {
  return createFindingError(
    FindingErrorCode.CANNOT_DEFER_SEVERITY,
    `Cannot defer finding ${findingId} with severity ${severity}; CRITICAL and HIGH findings must be resolved`,
    { finding_id: findingId, severity },
    false,
    'CRITICAL and HIGH severity findings cannot be deferred; they must be resolved or marked as WONT_FIX with approval'
  );
}

/**
 * Creates a "deferral approval required" error.
 * Requirements: R11.4, R11.5
 */
export function deferralApprovalRequiredError(findingId: string): FindingError {
  return createFindingError(
    FindingErrorCode.DEFERRAL_APPROVAL_REQUIRED,
    `Deferral approval required for finding ${findingId}`,
    { finding_id: findingId },
    false,
    'Provide approved_by and reason to defer this finding'
  );
}

/**
 * Creates a "finding already open" error.
 * Requirements: R11.3
 */
export function findingAlreadyOpenError(findingId: string): FindingError {
  return createFindingError(
    FindingErrorCode.FINDING_ALREADY_OPEN,
    `Finding ${findingId} is already OPEN and cannot be reopened`,
    { finding_id: findingId },
    false,
    'The finding is already open - no reopen action needed'
  );
}

// =============================================================================
// Custom Error Classes
// =============================================================================

/**
 * Custom error class for finding not found.
 */
export class FindingNotFoundError extends Error {
  public readonly code = FindingErrorCode.FINDING_NOT_FOUND;
  public readonly findingId: string;
  
  constructor(findingId: string) {
    super(`Finding ${findingId} not found`);
    this.name = 'FindingNotFoundError';
    this.findingId = findingId;
  }
  
  toFindingError(): FindingError {
    return findingNotFoundError(this.findingId);
  }
}

/**
 * Custom error class for invalid status transition.
 */
export class InvalidStatusTransitionError extends Error {
  public readonly code = FindingErrorCode.INVALID_STATUS_TRANSITION;
  public readonly findingId: string;
  public readonly fromStatus: FindingStatus;
  public readonly toStatus: FindingStatus;
  
  constructor(findingId: string, fromStatus: FindingStatus, toStatus: FindingStatus) {
    super(`Cannot transition finding ${findingId} from ${fromStatus} to ${toStatus}`);
    this.name = 'InvalidStatusTransitionError';
    this.findingId = findingId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
  
  toFindingError(): FindingError {
    return invalidStatusTransitionError(this.findingId, this.fromStatus, this.toStatus);
  }
}

/**
 * Custom error class for review closure blocked.
 */
export class ReviewCannotCloseError extends Error {
  public readonly code = FindingErrorCode.REVIEW_CANNOT_CLOSE;
  public readonly taskId: string;
  public readonly reasons: string[];
  
  constructor(taskId: string, reasons: string[]) {
    super(`Review for task ${taskId} cannot be closed: ${reasons.join('; ')}`);
    this.name = 'ReviewCannotCloseError';
    this.taskId = taskId;
    this.reasons = reasons;
  }
  
  toFindingError(): FindingError {
    return reviewCannotCloseError(this.taskId, this.reasons);
  }
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for finding creation.
 */
export type CreateFindingResult = Result<Finding, FindingError>;

/**
 * Result type for finding retrieval.
 */
export type GetFindingResult = Result<Finding, FindingError>;

/**
 * Result type for finding listing.
 */
export type ListFindingsResult = Result<Finding[], FindingError>;

/**
 * Result type for finding update.
 */
export type UpdateFindingResult = Result<Finding, FindingError>;

/**
 * Result type for review closure check.
 */
export type CanCloseReviewResult = Result<ReviewClosureCheck, FindingError>;

/**
 * Result type for finding deletion.
 */
export type DeleteFindingResult = Result<void, FindingError>;

/**
 * Result type for findings summary.
 */
export type GetFindingsSummaryResult = Result<FindingsSummary, FindingError>;

/**
 * Result type for defer finding operation.
 */
export type DeferFindingResult = Result<Finding, FindingError>;

/**
 * Result type for close review operation.
 */
export type CloseReviewResult = Result<ReviewClosureResult, FindingError>;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Checks if a finding status is considered "closed".
 */
export function isClosedStatus(status: FindingStatus): boolean {
  return status === 'RESOLVED' || status === 'WONT_FIX' || status === 'DUPLICATE' || status === 'DEFERRED';
}

/**
 * Checks if a finding status is considered "open".
 */
export function isOpenStatus(status: FindingStatus): boolean {
  return status === 'OPEN' || status === 'IN_PROGRESS';
}

/**
 * Checks if a finding can be deferred based on its severity.
 * Requirements: R11.4, R11.5
 * 
 * - CRITICAL: Cannot be deferred
 * - HIGH: Cannot be deferred
 * - MEDIUM: Can be deferred with approval
 * - LOW: Can be deferred
 * - INFO: Can be deferred (doesn't block anyway)
 */
export function canDeferSeverity(severity: FindingSeverity): boolean {
  return severity === 'MEDIUM' || severity === 'LOW' || severity === 'INFO';
}

/**
 * Severities that can be deferred.
 */
export const DEFERRABLE_SEVERITIES: FindingSeverity[] = ['MEDIUM', 'LOW', 'INFO'];

/**
 * Checks if a status transition is valid.
 */
export function isValidStatusTransition(
  fromStatus: FindingStatus,
  toStatus: FindingStatus
): boolean {
  return VALID_STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

/**
 * Checks if a finding severity blocks task completion.
 * Requirements: R11.5
 */
export function isSeverityBlocking(severity: FindingSeverity): boolean {
  return BLOCKING_SEVERITIES.includes(severity);
}

/**
 * Checks if a finding severity blocks release.
 * Requirements: R11.5
 */
export function isSeverityReleaseBlocking(severity: FindingSeverity): boolean {
  return RELEASE_BLOCKING_SEVERITIES.includes(severity);
}

/**
 * Creates an empty findings summary.
 */
export function createEmptyFindingsSummary(): FindingsSummary {
  return {
    total: 0,
    by_status: {
      OPEN: 0,
      IN_PROGRESS: 0,
      RESOLVED: 0,
      WONT_FIX: 0,
      DUPLICATE: 0,
      DEFERRED: 0,
    },
    by_severity: {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    },
    blocking_release: 0,
    open_critical: 0,
    open_high: 0,
  };
}

/**
 * Generates a new finding ID.
 * @param sequenceNumber - The sequence number for the ID
 * @returns A formatted finding ID (FND-xxx)
 */
export function generateFindingId(sequenceNumber: number): string {
  return `${FINDING_DEFAULTS.ID_PREFIX}-${sequenceNumber.toString().padStart(3, '0')}`;
}

/**
 * Validates finding ID format.
 * @param findingId - The finding ID to validate
 * @returns True if valid format
 */
export function isValidFindingId(findingId: string): boolean {
  return FINDING_DEFAULTS.ID_PATTERN.test(findingId);
}

// =============================================================================
// Finding_Register Interface
// =============================================================================

/**
 * FindingRegister interface for review findings management.
 * 
 * This component ensures:
 * - Review findings creation and tracking
 * - Finding status lifecycle management
 * - Review closure criteria enforcement
 * - Finding reopen with evidence requirement
 * 
 * Requirements: R11.1, R11.2, R11.3, R11.4, R11.5, R11.6, R11.7, R11.8
 */
export interface FindingRegister {
  // =========================================================================
  // Creation Operations
  // =========================================================================

  /**
   * Creates a new finding.
   * 
   * Requirements: R11.1
   * 
   * @param input - Finding input data
   * @returns Result with Finding on success, or FindingError on failure
   * 
   * Behavior:
   * - Generates unique finding ID (FND-xxx)
   * - Sets initial status to OPEN
   * - Records creation timestamp
   * - Adds creation to history
   * - Validates required fields
   * 
   * Validation:
   * - task_id must be non-empty
   * - severity must be valid FindingSeverity
   * - category must be valid FindingCategory
   * - scope must be valid (file_location or general)
   * - description must be non-empty
   * - evidence must be non-empty
   * - acceptance_criteria must be non-empty
   * - owner_id must be non-empty
   */
  createFinding(input: FindingInput): Promise<CreateFindingResult>;

  // =========================================================================
  // Update Operations
  // =========================================================================

  /**
   * Updates finding status.
   * 
   * Requirements: R11.1, R11.3
   * 
   * @param findingId - The finding ID to update
   * @param update - Status update data
   * @returns Result with updated Finding on success, or FindingError on failure
   * 
   * Validation:
   * - Status transition must be valid
   * - RESOLVED requires resolution info
   * - DUPLICATE requires duplicate_of reference
   */
  updateFindingStatus(
    findingId: string,
    update: FindingStatusUpdate
  ): Promise<UpdateFindingResult>;

  // =========================================================================
  // Query Operations
  // =========================================================================

  /**
   * Gets a finding by ID.
   * 
   * @param findingId - The finding ID to retrieve
   * @returns Result with Finding on success, or FindingError on failure
   */
  getFinding(findingId: string): Promise<GetFindingResult>;

  /**
   * Gets findings for a task.
   * 
   * @param taskId - Task ID to get findings for
   * @param options - Optional query options
   * @returns Result with Finding array on success, or FindingError on failure
   */
  getFindingsForTask(
    taskId: string,
    options?: FindingQueryOptions
  ): Promise<ListFindingsResult>;

  /**
   * Gets open blocking findings for a task.
   * Returns findings with OPEN or IN_PROGRESS status and CRITICAL or HIGH severity.
   * 
   * Requirements: R11.5
   * 
   * @param taskId - Task ID to get blocking findings for
   * @returns Result with Finding array on success, or FindingError on failure
   */
  getBlockingFindings(taskId: string): Promise<ListFindingsResult>;

  /**
   * Gets findings summary for a task.
   * 
   * @param taskId - Task ID to get summary for
   * @returns Result with FindingsSummary on success, or FindingError on failure
   */
  getFindingsSummary(taskId: string): Promise<GetFindingsSummaryResult>;

  // =========================================================================
  // Review Closure Operations
  // =========================================================================

  /**
   * Checks if review can be closed for a task.
   * 
   * Requirements: R11.4, R11.5
   * 
   * @param taskId - Task ID to check
   * @returns Result with ReviewClosureCheck on success, or FindingError on failure
   * 
   * Review can be closed if:
   * - All CRITICAL findings resolved (RESOLVED or WONT_FIX with approval)
   * - All HIGH findings resolved (RESOLVED or WONT_FIX with approval)
   * - MEDIUM findings either resolved or explicitly deferred with approval
   * - LOW and INFO do not block (can be OPEN or DEFERRED)
   */
  canCloseReview(taskId: string): Promise<CanCloseReviewResult>;

  /**
   * Closes a review for a task.
   * 
   * Requirements: R11.5
   * 
   * @param taskId - Task ID to close review for
   * @param input - Close review input
   * @returns Result with ReviewClosureResult on success, or FindingError on failure
   * 
   * Behavior:
   * - First checks if review can be closed via canCloseReview
   * - If can_close is false, returns error with blocking reasons
   * - Records closure timestamp and who closed it
   */
  closeReview(taskId: string, input: CloseReviewInput): Promise<CloseReviewResult>;

  /**
   * Defers a finding with approval.
   * 
   * Requirements: R11.4, R11.5
   * 
   * @param findingId - Finding ID to defer
   * @param input - Defer finding input with reason and approval
   * @returns Result with updated Finding on success, or FindingError on failure
   * 
   * Deferral rules:
   * - CRITICAL: Cannot be deferred
   * - HIGH: Cannot be deferred
   * - MEDIUM: Can be deferred with approval
   * - LOW: Can be deferred
   * - INFO: Can be deferred (doesn't block anyway)
   */
  deferFinding(findingId: string, input: DeferFindingInput): Promise<DeferFindingResult>;

  // =========================================================================
  // Reopen Operations
  // =========================================================================

  /**
   * Reopens a finding with new evidence.
   * 
   * Requirements: R11.3
   * 
   * @param findingId - The finding ID to reopen
   * @param input - Reopen input with new evidence, justification, and is_different_issue flag
   * @returns Result with ReopenFindingResultData on success, or FindingError on failure
   * 
   * Behavior:
   * - Requires new evidence (non-empty)
   * - Requires explicit justification (non-empty)
   * - Records reopen in history
   * 
   * When is_different_issue=true:
   * - Creates a new finding with a new ID
   * - Links the new finding to the original via original_finding_id
   * - The original finding remains in its closed state
   * - Returns both original and new finding in result
   * 
   * When is_different_issue=false (default):
   * - Reopens the same finding with status=OPEN
   * - Clears resolution, resolved_at, and duplicate_of
   * - Adds history entry with reopen details
   * - Returns the reopened finding in result
   */
  reopenFinding(
    findingId: string,
    input: ReopenFindingInput
  ): Promise<ReopenFindingResult>;

  // =========================================================================
  // Deletion Operations
  // =========================================================================

  /**
   * Deletes a finding by ID.
   * 
   * @param findingId - The finding ID to delete
   * @returns Result with void on success, or FindingError on failure
   */
  deleteFinding(findingId: string): Promise<DeleteFindingResult>;

  // =========================================================================
  // Bulk Operations
  // =========================================================================

  /**
   * Lists all findings, optionally with query options.
   * 
   * @param options - Optional query options
   * @returns Result with Finding array on success, or FindingError on failure
   */
  listFindings(options?: FindingQueryOptions): Promise<ListFindingsResult>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for FindingRegister implementation.
 */
export interface FindingRegisterConfig {
  /** Path to findings storage directory */
  storagePath?: string;
  /** Maximum review rounds before escalation */
  maxReviewRounds?: number;
  /** Whether to enforce status transitions */
  enforceStatusTransitions?: boolean;
}

/**
 * Default configuration for FindingRegister.
 */
export const DEFAULT_FINDING_REGISTER_CONFIG: Required<FindingRegisterConfig> = {
  storagePath: FINDING_DEFAULTS.STORAGE_DIR,
  maxReviewRounds: FINDING_DEFAULTS.MAX_REVIEW_ROUNDS,
  enforceStatusTransitions: true,
};
