/**
 * Audit Logger - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Audit_Logger component
 * which provides audit logging capabilities for tracking all significant actions in the SDLC workflow.
 * 
 * The Audit_Logger ensures:
 * - Complete audit trail of all state changes
 * - Correlation tracking for related operations
 * - Retry mechanism for log failures
 * - Fallback logging when primary fails
 * 
 * Requirements: R16.1, R16.2, R16.3, R16.4, R16.5
 */

import { ActorType, Result, ok, err } from './state-controller';

// =============================================================================
// Re-exports from state-controller for convenience
// =============================================================================

export { ActorType } from './state-controller';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for audit logger operations.
 * Requirements: R16.3
 */
export const AUDIT_LOGGER_DEFAULTS = {
  /** Default number of retries for log write failures */
  MAX_RETRIES: 3,
  /** Base delay in milliseconds for retry backoff */
  BASE_RETRY_DELAY_MS: 100,
  /** Default retention period in days */
  RETENTION_DAYS: 90,
  /** Maximum entries per query */
  MAX_QUERY_RESULTS: 1000,
  /** Primary log file name */
  PRIMARY_LOG_FILE: 'audit.log',
  /** Fallback log file name */
  FALLBACK_LOG_FILE: 'audit-fallback.log',
  /** Default log directory */
  LOG_DIRECTORY: '.kiro/sdlc',
} as const;

/**
 * Actions that must be logged per R16.2.
 */
export const LOGGABLE_ACTIONS = [
  // State transitions
  'TASK_STATUS_CHANGE',
  'TASK_CREATED',
  'TASK_CANCELLED',
  'TASK_SUPERSEDED',
  'TASK_REOPENED',
  'TDD_PHASE_CHANGE',
  'LIFECYCLE_PHASE_CHANGE',
  'BLOCKED_STATUS_CHANGE',
  
  // Assignment changes
  'TASK_ASSIGNED',
  'TASK_UNASSIGNED',
  'TASK_REASSIGNED',
  
  // Ownership changes
  'OWNERSHIP_CLAIMED',
  'OWNERSHIP_RELEASED',
  'OWNERSHIP_TRANSFERRED',
  'LEASE_EXPIRED',
  'LEASE_EXTENDED',
  'HEARTBEAT_RECEIVED',
  
  // Evidence
  'EVIDENCE_CREATED',
  'EVIDENCE_MARKED_STALE',
  'EVIDENCE_REVALIDATED',
  
  // Approval/rejection
  'APPROVAL_GRANTED',
  'APPROVAL_DENIED',
  'GATE_PASSED',
  'GATE_FAILED',
  
  // Handoff events
  'HANDOFF_INITIATED',
  'HANDOFF_ACCEPTED',
  'HANDOFF_REJECTED',
  'HANDOFF_CANCELLED',
  'HANDOFF_COMPLETED',
  'HANDOFF_TIMEOUT',
  
  // Checkpoint events
  'CHECKPOINT_CREATED',
  'CHECKPOINT_RESTORED',
  'CHECKPOINT_PRUNED',
  
  // Configuration changes
  'CONFIG_UPDATED',
  'QUALITY_GATE_CONFIG_UPDATED',
  'ACTOR_CONFIG_UPDATED',
  
  // Release events
  'RELEASE_PLANNED',
  'RELEASE_READINESS_CHECK',
  'RELEASE_STAGING_DEPLOYED',
  'RELEASE_STAGING_VERIFIED',
  'RELEASE_PRODUCTION_APPROVED',
  'RELEASE_PRODUCTION_DEPLOYED',
  'RELEASE_ROLLBACK',
  'RELEASE_CLOSED',
  'RELEASE_CANCELLED',
  
  // Finding events
  'FINDING_CREATED',
  'FINDING_STATUS_CHANGE',
  'FINDING_RESOLVED',
  'FINDING_REOPENED',
  
  // Error events
  'OPERATION_FAILED',
  'STATE_CORRUPTION_DETECTED',
  'VALIDATION_FAILED',
  
  // DoR events
  'DOR_CHECK_PASSED',
  'DOR_CHECK_FAILED',
  'DOR_REVALIDATED',
] as const;

/**
 * Type for loggable actions derived from the constant array.
 */
export type LoggableAction = typeof LOGGABLE_ACTIONS[number];

/**
 * Resource types that can be affected by logged actions.
 */
export const RESOURCE_TYPES = [
  'Task',
  'Evidence',
  'Checkpoint',
  'Release',
  'Team',
  'Finding',
  'Handoff',
  'Config',
  'State',
  'Gate',
] as const;

/**
 * Type for resource types derived from the constant array.
 */
export type ResourceType = typeof RESOURCE_TYPES[number];

// =============================================================================
// Type Definitions - Audit Entry
// =============================================================================

/**
 * Outcome of an operation.
 */
export type OperationOutcome = 'SUCCESS' | 'FAILURE';

/**
 * Change record for tracking field-level changes.
 */
export interface FieldChange {
  /** Value before the change */
  from: unknown;
  /** Value after the change */
  to: unknown;
}

/**
 * Audit log entry structure following the design specification.
 * Requirements: R16.1
 */
export interface AuditEntry {
  /** UUID for each operation */
  operation_id: string;
  /** Groups related operations */
  correlation_id?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Who performed the action */
  actor_id: string;
  /** Type of actor */
  actor_type: ActorType;
  /** Action type */
  action: string;
  /** Type of resource affected */
  resource_type: string;
  /** ID of resource affected */
  resource_id: string;
  /** State version before change */
  state_version_before?: number;
  /** State version after change */
  state_version_after?: number;
  /** Diff of changed fields */
  changes?: Record<string, FieldChange>;
  /** Why the action was taken */
  reason?: string;
  /** Operation outcome */
  outcome: OperationOutcome;
  /** Error details if failure */
  error_details?: string;
}

/**
 * Input for creating an audit entry (subset of AuditEntry with auto-generated fields optional).
 */
export interface AuditEntryInput {
  /** UUID for each operation (auto-generated if not provided) */
  operation_id?: string;
  /** Groups related operations */
  correlation_id?: string;
  /** ISO 8601 timestamp (auto-generated if not provided) */
  timestamp?: string;
  /** Who performed the action */
  actor_id: string;
  /** Type of actor */
  actor_type: ActorType;
  /** Action type */
  action: string;
  /** Type of resource affected */
  resource_type: string;
  /** ID of resource affected */
  resource_id: string;
  /** State version before change */
  state_version_before?: number;
  /** State version after change */
  state_version_after?: number;
  /** Diff of changed fields */
  changes?: Record<string, FieldChange>;
  /** Why the action was taken */
  reason?: string;
  /** Operation outcome */
  outcome: OperationOutcome;
  /** Error details if failure */
  error_details?: string;
}

// =============================================================================
// Type Definitions - Query Options
// =============================================================================

/**
 * Options for querying audit logs.
 */
export interface LogQueryOptions {
  /** Filter by start date (inclusive) */
  startDate?: Date;
  /** Filter by end date (inclusive) */
  endDate?: Date;
  /** Filter by action types */
  actions?: string[];
  /** Filter by outcome */
  outcome?: OperationOutcome;
  /** Filter by actor ID */
  actorId?: string;
  /** Filter by actor type */
  actorType?: ActorType;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Result of an archive operation.
 */
export interface ArchiveResult {
  /** Number of entries archived */
  archived: number;
  /** Path to archive file (if applicable) */
  archivePath?: string;
  /** ISO 8601 timestamp when archiving was performed */
  archivedAt: string;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Audit logger error codes following the design specification.
 * Error codes in range 2500-2599 for AUDIT_ERROR category.
 * Requirements: R16.3
 */
export enum AuditErrorCode {
  /** Log write failed */
  LOG_WRITE_FAILED = 2501,
  /** Log read failed */
  LOG_READ_FAILED = 2502,
  /** Invalid entry format */
  INVALID_ENTRY_FORMAT = 2503,
  /** Archive operation failed */
  ARCHIVE_FAILED = 2504,
  /** Max retries exceeded */
  MAX_RETRIES_EXCEEDED = 2505,
  /** Fallback log failed */
  FALLBACK_FAILED = 2506,
  /** Query failed */
  QUERY_FAILED = 2507,
  /** Invalid operation ID */
  INVALID_OPERATION_ID = 2508,
  /** Log file not found */
  LOG_NOT_FOUND = 2509,
  /** Log corruption detected */
  LOG_CORRUPTED = 2510,
}

/**
 * Audit error structure following the design specification.
 */
export interface AuditError {
  /** Error code from AuditErrorCode enum */
  code: AuditErrorCode;
  /** Error category */
  category: 'AUDIT_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    operation_id?: string;
    path?: string;
    details?: string;
    retryCount?: number;
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
 * Creates an AuditError with the given code and details.
 */
export function createAuditError(
  code: AuditErrorCode,
  message: string,
  context?: AuditError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): AuditError {
  return {
    code,
    category: 'AUDIT_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "log write failed" error.
 * Requirements: R16.3
 */
export function logWriteFailedError(
  path?: string,
  details?: string,
  retryCount?: number
): AuditError {
  return createAuditError(
    AuditErrorCode.LOG_WRITE_FAILED,
    `Failed to write to audit log${path ? `: ${path}` : ''}`,
    { path, details, retryCount },
    true,
    'Check file permissions and disk space, then retry'
  );
}

/**
 * Creates a "log read failed" error.
 */
export function logReadFailedError(
  path?: string,
  details?: string
): AuditError {
  return createAuditError(
    AuditErrorCode.LOG_READ_FAILED,
    `Failed to read audit log${path ? `: ${path}` : ''}`,
    { path, details },
    true,
    'Check if the log file exists and is accessible'
  );
}

/**
 * Creates an "invalid entry format" error.
 */
export function invalidEntryFormatError(
  details?: string
): AuditError {
  return createAuditError(
    AuditErrorCode.INVALID_ENTRY_FORMAT,
    `Invalid audit entry format: ${details || 'Unknown format error'}`,
    { details },
    false,
    'Verify the entry structure matches the expected schema'
  );
}

/**
 * Creates a "max retries exceeded" error.
 * Requirements: R16.3
 */
export function maxRetriesExceededError(
  operationId?: string,
  maxRetries?: number
): AuditError {
  return createAuditError(
    AuditErrorCode.MAX_RETRIES_EXCEEDED,
    `Audit log write failed after ${maxRetries || 'multiple'} retries`,
    { operation_id: operationId, retryCount: maxRetries },
    false,
    'Check disk space and file permissions. Entry will be written to fallback log.'
  );
}

/**
 * Creates a "fallback failed" error.
 * Requirements: R16.3
 */
export function fallbackFailedError(
  primaryPath?: string,
  fallbackPath?: string,
  details?: string
): AuditError {
  return createAuditError(
    AuditErrorCode.FALLBACK_FAILED,
    `Both primary and fallback audit logs failed`,
    { 
      path: primaryPath, 
      fallback_path: fallbackPath, 
      details 
    },
    false,
    'Check disk space and file permissions for both log locations'
  );
}

/**
 * Creates an "archive failed" error.
 */
export function archiveFailedError(
  details?: string
): AuditError {
  return createAuditError(
    AuditErrorCode.ARCHIVE_FAILED,
    `Failed to archive audit logs: ${details || 'Unknown error'}`,
    { details },
    true,
    'Check disk space and file permissions, then retry'
  );
}

/**
 * Creates a "query failed" error.
 */
export function queryFailedError(
  details?: string
): AuditError {
  return createAuditError(
    AuditErrorCode.QUERY_FAILED,
    `Failed to query audit logs: ${details || 'Unknown error'}`,
    { details },
    true,
    'Check if the log file exists and is not corrupted'
  );
}

/**
 * Creates a "log corrupted" error.
 */
export function logCorruptedError(
  path?: string,
  lineNumber?: number,
  details?: string
): AuditError {
  return createAuditError(
    AuditErrorCode.LOG_CORRUPTED,
    `Audit log corruption detected${path ? ` in ${path}` : ''}${lineNumber ? ` at line ${lineNumber}` : ''}`,
    { path, line_number: lineNumber, details },
    false,
    'Review the corrupted log file and restore from backup if needed'
  );
}

// =============================================================================
// Custom Error Classes
// =============================================================================

/**
 * Custom error class for log write failures.
 */
export class LogWriteFailedError extends Error {
  public readonly code = AuditErrorCode.LOG_WRITE_FAILED;
  public readonly path?: string;
  public readonly retryCount?: number;
  
  constructor(path?: string, details?: string, retryCount?: number) {
    super(`Failed to write to audit log${path ? `: ${path}` : ''}${details ? ` - ${details}` : ''}`);
    this.name = 'LogWriteFailedError';
    this.path = path;
    this.retryCount = retryCount;
  }
  
  toAuditError(): AuditError {
    return logWriteFailedError(this.path, this.message, this.retryCount);
  }
}

/**
 * Custom error class for fallback failures.
 */
export class FallbackFailedError extends Error {
  public readonly code = AuditErrorCode.FALLBACK_FAILED;
  public readonly primaryPath?: string;
  public readonly fallbackPath?: string;
  
  constructor(primaryPath?: string, fallbackPath?: string, details?: string) {
    super(`Both primary and fallback audit logs failed${details ? `: ${details}` : ''}`);
    this.name = 'FallbackFailedError';
    this.primaryPath = primaryPath;
    this.fallbackPath = fallbackPath;
  }
  
  toAuditError(): AuditError {
    return fallbackFailedError(this.primaryPath, this.fallbackPath, this.message);
  }
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for log operation.
 */
export type LogResult = Result<void, AuditError>;

/**
 * Result type for query operation.
 */
export type QueryResult = Result<AuditEntry[], AuditError>;

/**
 * Result type for archive operation.
 */
export type ArchiveLogResult = Result<ArchiveResult, AuditError>;

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Generates a unique operation ID (UUID v4).
 */
export function generateOperationId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Validates if a string is a valid UUID v4 format (operation ID format).
 */
export function isValidOperationId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(id);
}

/**
 * Validates if a timestamp is a valid ISO 8601 string.
 */
export function isValidTimestamp(timestamp: unknown): timestamp is string {
  if (typeof timestamp !== 'string') return false;
  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

/**
 * Validates an AuditEntry has all required fields.
 */
export function isValidAuditEntry(entry: unknown): entry is AuditEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  
  const e = entry as Record<string, unknown>;
  
  return (
    typeof e.operation_id === 'string' &&
    typeof e.timestamp === 'string' &&
    typeof e.actor_id === 'string' &&
    typeof e.actor_type === 'string' &&
    ['HUMAN', 'AI_AGENT', 'SYSTEM'].includes(e.actor_type as string) &&
    typeof e.action === 'string' &&
    typeof e.resource_type === 'string' &&
    typeof e.resource_id === 'string' &&
    typeof e.outcome === 'string' &&
    ['SUCCESS', 'FAILURE'].includes(e.outcome as string)
  );
}

/**
 * Creates a complete AuditEntry from input, filling in auto-generated fields.
 */
export function createAuditEntry(input: AuditEntryInput): AuditEntry {
  return {
    operation_id: input.operation_id || generateOperationId(),
    timestamp: input.timestamp || new Date().toISOString(),
    actor_id: input.actor_id,
    actor_type: input.actor_type,
    action: input.action,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
    outcome: input.outcome,
    ...(input.correlation_id && { correlation_id: input.correlation_id }),
    ...(input.state_version_before !== undefined && { state_version_before: input.state_version_before }),
    ...(input.state_version_after !== undefined && { state_version_after: input.state_version_after }),
    ...(input.changes && { changes: input.changes }),
    ...(input.reason && { reason: input.reason }),
    ...(input.error_details && { error_details: input.error_details }),
  };
}

/**
 * Serializes an AuditEntry to JSONL format (single line JSON).
 */
export function serializeAuditEntry(entry: AuditEntry): string {
  return JSON.stringify(entry);
}

/**
 * Deserializes a JSONL line to an AuditEntry.
 * @throws Error if parsing fails or entry is invalid
 */
export function deserializeAuditEntry(line: string): AuditEntry {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new Error('Empty line cannot be deserialized');
  }
  
  const parsed = JSON.parse(trimmed);
  
  if (!isValidAuditEntry(parsed)) {
    throw new Error('Invalid audit entry structure');
  }
  
  return parsed;
}

// =============================================================================
// Audit_Logger Interface
// =============================================================================

/**
 * AuditLogger interface for logging all significant actions in the SDLC workflow.
 * 
 * This component ensures:
 * - Complete audit trail per R16.2
 * - JSONL format (one JSON entry per line)
 * - Retry mechanism on log failure
 * - Fallback log if primary fails
 * - Immutable logs after write
 * 
 * Requirements: R16.1, R16.2, R16.3, R16.4, R16.5
 */
export interface AuditLogger {
  // =========================================================================
  // Log Operations
  // =========================================================================

  /**
   * Logs an action.
   * 
   * Requirements: R16.1, R16.2, R16.3
   * 
   * @param entry - The audit entry to log
   * @returns Result with void on success, or AuditError on failure
   * 
   * Behavior:
   * - Validates entry structure
   * - Appends entry to audit log in JSONL format
   * - On failure: retries with configurable attempts
   * - If primary fails after retries: writes to fallback log
   * - Returns success even if only fallback succeeds
   * 
   * Errors:
   * - FALLBACK_FAILED: If both primary and fallback fail
   * - INVALID_ENTRY_FORMAT: If entry structure is invalid
   */
  log(entry: AuditEntry): Promise<LogResult>;

  // =========================================================================
  // Query Operations
  // =========================================================================

  /**
   * Gets logs for a specific resource.
   * 
   * Requirements: R16.4
   * 
   * @param resourceType - Type of resource to query
   * @param resourceId - ID of the resource
   * @param options - Query options (filters, pagination)
   * @returns Result with matching AuditEntry[] on success, or AuditError on failure
   * 
   * Behavior:
   * - Reads audit log file(s)
   * - Filters by resource type and ID
   * - Applies additional filters from options
   * - Returns entries in chronological order (default) or as specified
   * 
   * Errors:
   * - LOG_READ_FAILED: If log file cannot be read
   * - QUERY_FAILED: If query execution fails
   */
  getLogsForResource(
    resourceType: string,
    resourceId: string,
    options?: LogQueryOptions
  ): Promise<QueryResult>;

  /**
   * Gets logs by correlation ID.
   * 
   * Requirements: R16.4
   * 
   * @param correlationId - The correlation ID to search for
   * @returns Result with matching AuditEntry[] on success, or AuditError on failure
   * 
   * Behavior:
   * - Reads audit log file(s)
   * - Returns all entries with matching correlation_id
   * - Returns entries in chronological order
   * 
   * Errors:
   * - LOG_READ_FAILED: If log file cannot be read
   * - QUERY_FAILED: If query execution fails
   */
  getLogsByCorrelation(correlationId: string): Promise<QueryResult>;

  // =========================================================================
  // Maintenance Operations
  // =========================================================================

  /**
   * Archives logs older than the specified date.
   * 
   * Requirements: R16.5
   * 
   * @param before - Archive logs with timestamp before this date
   * @returns Result with ArchiveResult on success, or AuditError on failure
   * 
   * Behavior:
   * - Identifies entries older than specified date
   * - Moves old entries to archive file
   * - Removes archived entries from primary log
   * - Returns count of archived entries
   * 
   * Errors:
   * - ARCHIVE_FAILED: If archive operation fails
   * - LOG_READ_FAILED: If current log cannot be read
   */
  archiveLogs(before: Date): Promise<ArchiveLogResult>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for AuditLogger implementation.
 */
export interface AuditLoggerConfig {
  /** Path to log directory */
  logDirectory: string;
  /** Primary log file name */
  primaryLogFile?: string;
  /** Fallback log file name */
  fallbackLogFile?: string;
  /** Maximum retries for write operations */
  maxRetries?: number;
  /** Base delay for retry backoff in milliseconds */
  baseRetryDelayMs?: number;
  /** Maximum entries per query */
  maxQueryResults?: number;
  /** Whether to include entries from fallback log in queries */
  includeFallbackInQueries?: boolean;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a default AuditLoggerConfig.
 */
export function createDefaultAuditLoggerConfig(logDirectory: string): AuditLoggerConfig {
  return {
    logDirectory,
    primaryLogFile: AUDIT_LOGGER_DEFAULTS.PRIMARY_LOG_FILE,
    fallbackLogFile: AUDIT_LOGGER_DEFAULTS.FALLBACK_LOG_FILE,
    maxRetries: AUDIT_LOGGER_DEFAULTS.MAX_RETRIES,
    baseRetryDelayMs: AUDIT_LOGGER_DEFAULTS.BASE_RETRY_DELAY_MS,
    maxQueryResults: AUDIT_LOGGER_DEFAULTS.MAX_QUERY_RESULTS,
    includeFallbackInQueries: true,
  };
}

/**
 * Creates an AuditEntry for a state change action.
 */
export function createStateChangeEntry(
  actorId: string,
  actorType: ActorType,
  resourceType: string,
  resourceId: string,
  action: string,
  changes: Record<string, FieldChange>,
  versionBefore?: number,
  versionAfter?: number,
  reason?: string,
  correlationId?: string
): AuditEntry {
  return createAuditEntry({
    actor_id: actorId,
    actor_type: actorType,
    resource_type: resourceType,
    resource_id: resourceId,
    action,
    changes,
    state_version_before: versionBefore,
    state_version_after: versionAfter,
    reason,
    correlation_id: correlationId,
    outcome: 'SUCCESS',
  });
}

/**
 * Creates an AuditEntry for a failure.
 */
export function createFailureEntry(
  actorId: string,
  actorType: ActorType,
  resourceType: string,
  resourceId: string,
  action: string,
  errorDetails: string,
  reason?: string,
  correlationId?: string
): AuditEntry {
  return createAuditEntry({
    actor_id: actorId,
    actor_type: actorType,
    resource_type: resourceType,
    resource_id: resourceId,
    action,
    error_details: errorDetails,
    reason,
    correlation_id: correlationId,
    outcome: 'FAILURE',
  });
}
