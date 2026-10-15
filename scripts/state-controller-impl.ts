/**
 * FileStateController Implementation
 * 
 * Concrete implementation of the StateController interface that uses file-based
 * storage with YAML format for project state persistence.
 * 
 * This module provides atomic state read/write operations with optimistic
 * concurrency control using version tracking.
 * 
 * Requirements: R02.1, R02.2, R02.11, R16.6
 */

import * as fs from 'node:fs/promises';
import * as yaml from 'yaml';

import {
  StateController,
  StateControllerConfig,
  ProjectState,
  StateError,
  StateErrorCode,
  Result,
  ValidationResult,
  ValidationIssue,
  ok,
  err,
  stateNotFoundError,
  invalidStateFormatError,
  writeFailedError,
  versionConflictError,
  maxRetriesExceededError,
  consistencyError,
  isValidVersion,
  STATE_CONTROLLER_DEFAULTS,
  calculateBackoffDelay,
  sleep,
  StateVersionConflictError,
} from './state-controller';

import {
  AuditLogger,
  createAuditEntry,
  FieldChange,
} from './audit-logger';

// =============================================================================
// FileStateController Implementation
// =============================================================================

/**
 * File-based implementation of the StateController interface.
 * 
 * This implementation:
 * - Reads and writes project state from a YAML file
 * - Tracks version for optimistic concurrency control
 * - Supports backward compatibility with legacy states (no version field)
 * - Provides atomic read-modify-write operations with retry logic
 * 
 * Requirements: R02.1, R02.2, R02.11
 */
export class FileStateController implements StateController {
  private readonly config: Required<StateControllerConfig>;
  private readonly auditLogger?: AuditLogger;

  /**
   * Creates a new FileStateController instance.
   * 
   * @param config - Configuration options for the controller
   * @param auditLogger - Optional audit logger for logging state changes
   */
  constructor(config: StateControllerConfig, auditLogger?: AuditLogger) {
    this.config = {
      projectStatePath: config.projectStatePath,
      defaultActorId: config.defaultActorId ?? 'SYSTEM',
      defaultActorType: config.defaultActorType ?? 'SYSTEM',
      maxRetries: config.maxRetries ?? STATE_CONTROLLER_DEFAULTS.MAX_RETRIES,
      baseRetryDelayMs: config.baseRetryDelayMs ?? STATE_CONTROLLER_DEFAULTS.BASE_RETRY_DELAY_MS,
    };
    this.auditLogger = auditLogger;
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

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
   * - If `state_version` is missing or invalid, defaults to 1 (backward compatibility)
   * - Invalid YAML results in INVALID_STATE_FORMAT error
   * - Missing file results in STATE_NOT_FOUND error
   */
  async readState(): Promise<Result<{ state: ProjectState; version: number }, StateError>> {
    try {
      // Check if file exists
      const fileExists = await this.checkFileExists(this.config.projectStatePath);
      if (!fileExists) {
        return err(stateNotFoundError(this.config.projectStatePath));
      }

      // Read file content
      const content = await fs.readFile(this.config.projectStatePath, 'utf-8');

      // Handle empty file
      if (!content || content.trim() === '') {
        return err(invalidStateFormatError('File is empty'));
      }

      // Parse YAML
      let state: ProjectState;
      try {
        state = yaml.parse(content) as ProjectState;
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parse error';
        return err(invalidStateFormatError(errorMessage));
      }

      // Validate parsed result is an object
      if (!state || typeof state !== 'object') {
        return err(invalidStateFormatError('Parsed state is not a valid object'));
      }

      // Extract version with backward compatibility
      const version = this.extractVersion(state);

      return ok({ state, version });
    } catch (error) {
      // Handle unexpected errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return err(invalidStateFormatError(`Failed to read state: ${errorMessage}`));
    }
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

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
   */
  async writeState(
    state: ProjectState,
    expectedVersion: number,
    operationId: string,
    reason: string
  ): Promise<Result<{ newVersion: number }, StateError>> {
    // Read current state to check version
    const currentResult = await this.readState();
    
    // Handle case where file doesn't exist - allow initial write
    if (!currentResult.success) {
      if (currentResult.error.code === StateErrorCode.STATE_NOT_FOUND && expectedVersion === 0) {
        // Initial write case - file doesn't exist yet
        return this.writeStateToFile(state, 1, operationId, reason, 0);
      }
      return err(currentResult.error);
    }

    const currentVersion = currentResult.value.version;

    // Check version for optimistic concurrency
    if (currentVersion !== expectedVersion) {
      return err(versionConflictError(expectedVersion, currentVersion, operationId));
    }

    // Increment version and write
    const newVersion = currentVersion + 1;
    return this.writeStateToFile(state, newVersion, operationId, reason, currentVersion);
  }

  // ===========================================================================
  // Atomic Update Operations
  // ===========================================================================

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
   */
  async updateState(
    modifier: (state: ProjectState) => ProjectState,
    operationId: string,
    reason: string,
    maxRetries?: number
  ): Promise<Result<{ state: ProjectState; version: number }, StateError>> {
    const retryLimit = maxRetries ?? this.config.maxRetries;
    let retryCount = 0;

    while (retryCount < retryLimit) {
      // Read current state
      const readResult = await this.readState();
      if (!readResult.success) {
        return err(readResult.error);
      }

      const { state: currentState, version: currentVersion } = readResult.value;

      // Apply modifier to get new state
      const newState = modifier(currentState);

      // Attempt to write with version check
      const writeResult = await this.writeState(newState, currentVersion, operationId, reason);

      if (writeResult.success) {
        // Success - return the new state and version
        return ok({ state: newState, version: writeResult.value.newVersion });
      }

      // Check if it's a version conflict
      if (writeResult.error.code === StateErrorCode.VERSION_CONFLICT) {
        retryCount++;
        if (retryCount < retryLimit) {
          // Wait with exponential backoff before retry
          const delay = calculateBackoffDelay(retryCount, this.config.baseRetryDelayMs);
          await sleep(delay);
          continue;
        }
      } else {
        // Non-recoverable error
        return err(writeResult.error);
      }
    }

    // Max retries exceeded
    return err(maxRetriesExceededError(operationId, retryLimit));
  }

  // ===========================================================================
  // Validation Operations
  // ===========================================================================

  /**
   * Validates state consistency.
   * 
   * Requirements: R16.6
   * 
   * @returns Result with ValidationResult on success, or StateError on failure
   */
  async validateConsistency(): Promise<Result<ValidationResult, StateError>> {
    // Read current state
    const readResult = await this.readState();
    if (!readResult.success) {
      return err(readResult.error);
    }

    const { state } = readResult.value;
    const issues: ValidationIssue[] = [];

    // Check required fields
    if (!state.schema_version) {
      issues.push({
        type: 'ERROR',
        code: 'MISSING_SCHEMA_VERSION',
        message: 'schema_version is required',
        path: 'schema_version',
      });
    }

    if (!state.workflow_version) {
      issues.push({
        type: 'WARNING',
        code: 'MISSING_WORKFLOW_VERSION',
        message: 'workflow_version is recommended',
        path: 'workflow_version',
      });
    }

    // Validate task statistics consistency
    if (state.tasks) {
      const byStatusTotal = Object.values(state.tasks.by_status || {}).reduce((a, b) => a + b, 0);
      const byAssigneeTotal = Object.values(state.tasks.by_assignee || {}).reduce((a, b) => a + b, 0);

      if (state.tasks.total !== byStatusTotal) {
        issues.push({
          type: 'ERROR',
          code: 'TASK_COUNT_MISMATCH',
          message: 'tasks.total does not match sum of by_status',
          path: 'tasks',
          expected: state.tasks.total,
          actual: byStatusTotal,
        });
      }

      // Note: by_assignee might not equal total if some tasks are unassigned
      // So we only check if by_assignee exceeds total
      if (byAssigneeTotal > state.tasks.total) {
        issues.push({
          type: 'WARNING',
          code: 'TASK_ASSIGNEE_EXCEEDS_TOTAL',
          message: 'tasks.by_assignee sum exceeds total (may indicate duplicate assignments)',
          path: 'tasks.by_assignee',
          expected: state.tasks.total,
          actual: byAssigneeTotal,
        });
      }
    }

    // Validate team statistics
    if (state.team) {
      const memberCount = state.team.members?.length ?? 0;
      if (state.team.statistics?.total_members !== memberCount) {
        issues.push({
          type: 'ERROR',
          code: 'TEAM_COUNT_MISMATCH',
          message: 'team.statistics.total_members does not match members array length',
          path: 'team.statistics.total_members',
          expected: memberCount,
          actual: state.team.statistics?.total_members,
        });
      }
    }

    // Validate current_task consistency
    if (state.current_task) {
      // If task has ownership, validate fencing token is present
      if (state.current_task.ownership && !state.current_task.ownership.fencing_token) {
        issues.push({
          type: 'ERROR',
          code: 'MISSING_FENCING_TOKEN',
          message: 'current_task.ownership exists but fencing_token is missing',
          path: 'current_task.ownership.fencing_token',
        });
      }

      // If task is blocked, validate blocked_reason is present
      if (state.current_task.blocked && !state.current_task.blocked_reason) {
        issues.push({
          type: 'WARNING',
          code: 'MISSING_BLOCKED_REASON',
          message: 'current_task is blocked but no blocked_reason provided',
          path: 'current_task.blocked_reason',
        });
      }
    }

    // Validate findings consistency
    if (state.findings) {
      const byStatusTotal = Object.values(state.findings.by_status || {}).reduce((a, b) => a + b, 0);
      if (state.findings.total !== byStatusTotal) {
        issues.push({
          type: 'ERROR',
          code: 'FINDINGS_COUNT_MISMATCH',
          message: 'findings.total does not match sum of by_status',
          path: 'findings',
          expected: state.findings.total,
          actual: byStatusTotal,
        });
      }
    }

    const valid = !issues.some(i => i.type === 'ERROR');

    return ok({
      valid,
      issues,
      validated_at: new Date().toISOString(),
    });
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Checks if a file exists at the given path.
   */
  private async checkFileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extracts version from state with backward compatibility.
   * Returns DEFAULT_VERSION (1) if version is missing or invalid.
   */
  private extractVersion(state: ProjectState): number {
    const rawVersion = state.state_version;

    // Check if version is a valid positive integer
    if (isValidVersion(rawVersion)) {
      return rawVersion;
    }

    // Default to 1 for backward compatibility
    return STATE_CONTROLLER_DEFAULTS.DEFAULT_VERSION;
  }

  /**
   * Writes state to file with the specified version.
   * Logs the state change to the audit logger if provided.
   */
  private async writeStateToFile(
    state: ProjectState,
    version: number,
    operationId: string,
    reason: string,
    previousVersion?: number
  ): Promise<Result<{ newVersion: number }, StateError>> {
    try {
      // Update version metadata in state
      const updatedState: ProjectState = {
        ...state,
        state_version: version,
        last_modified_at: new Date().toISOString(),
        last_modified_by: this.config.defaultActorId,
      };

      // Serialize to YAML
      const yamlContent = yaml.stringify(updatedState, {
        indent: 2,
        lineWidth: 0, // Disable line wrapping
      });

      // Write to file
      await fs.writeFile(this.config.projectStatePath, yamlContent, 'utf-8');

      // Log state change to audit logger (fire-and-forget)
      if (this.auditLogger) {
        const entry = createAuditEntry({
          operation_id: operationId,
          actor_id: this.config.defaultActorId,
          actor_type: this.config.defaultActorType,
          action: 'STATE_CHANGE',
          resource_type: 'State',
          resource_id: 'project-state',
          state_version_before: previousVersion,
          state_version_after: version,
          reason,
          outcome: 'SUCCESS',
        });
        // Fire-and-forget: don't wait for logging to complete
        this.auditLogger.log(entry).catch(() => {
          // Silently ignore audit log failures - they shouldn't block state changes
        });
      }

      return ok({ newVersion: version });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return err(writeFailedError(errorMessage));
    }
  }
}
