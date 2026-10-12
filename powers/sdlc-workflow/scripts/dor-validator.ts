/**
 * DoR (Definition of Ready) Validator - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the DoR_Validator component
 * which provides validation of Definition of Ready conditions before task can be started.
 * 
 * The DoR_Validator ensures tasks only move to IN_PROGRESS when all readiness conditions
 * are met, including:
 * - Scope and acceptance criteria defined (non-empty)
 * - All blocking dependencies in status DONE
 * - Required decisions (linked DEC-xxx) resolved
 * - Assignee has required role
 * - No active blockers
 * 
 * Requirements: R01.1, R01.2, R01.3, R01.4, R01.5, R01.6
 */

import { Result, ok, err } from './state-controller';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for DoR validation.
 */
export const DOR_DEFAULTS = {
  /** Default minimum number of acceptance criteria required */
  MIN_ACCEPTANCE_CRITERIA: 1,
  /** Default maximum age of DoR check in seconds before re-validation recommended */
  CHECK_STALENESS_SECONDS: 3600,
  /** Pattern for decision references */
  DECISION_REF_PATTERN: /^DEC-\d+$/,
  /** Pattern for blocker references */
  BLOCKER_REF_PATTERN: /^BLOCKER-\d+$/,
} as const;

// =============================================================================
// Type Definitions - Condition Types
// =============================================================================

/**
 * Types of Definition of Ready conditions.
 * Each condition type corresponds to a specific check in the DoR validation.
 * Requirements: R01.2
 */
export type DoRConditionType = 
  | 'acceptance_criteria'  // Scope and AC defined (non-empty)
  | 'dependencies'         // Blocking deps in DONE status
  | 'decisions'           // Linked decisions resolved
  | 'role_match'          // Assignee has required role
  | 'no_blockers';        // No active BLOCKER-xxx

/**
 * Status of a dependency for DoR purposes.
 */
export type DependencyStatus = 'DONE' | 'NOT_DONE' | 'NOT_FOUND';

/**
 * Status of a decision for DoR purposes.
 */
export type DecisionStatus = 'RESOLVED' | 'UNRESOLVED' | 'NOT_FOUND';

/**
 * Status of a blocker for DoR purposes.
 */
export type BlockerStatus = 'OPEN' | 'CLOSED' | 'NOT_FOUND';

// =============================================================================
// Type Definitions - DoR Condition
// =============================================================================

/**
 * Result of a single DoR condition check.
 * Requirements: R01.2, R01.5
 */
export interface DoRCondition {
  /** Unique identifier for this condition check */
  id: string;
  /** Human-readable description of what was checked */
  description: string;
  /** Type of condition check */
  type: DoRConditionType;
  /** Whether the condition passed */
  passed: boolean;
  /** Detailed explanation of the result */
  details: string;
  /** Additional context for failed conditions */
  context?: DoRConditionContext;
}

/**
 * Additional context for DoR condition results.
 */
export interface DoRConditionContext {
  /** List of items that failed the check (e.g., unmet dependencies) */
  failed_items?: string[];
  /** Expected value or count */
  expected?: string | number;
  /** Actual value or count */
  actual?: string | number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Type Definitions - DoR Validation Result
// =============================================================================

/**
 * Complete DoR validation result for a task.
 * Requirements: R01.1, R01.5
 */
export interface DoRValidation {
  /** Task ID that was validated */
  task_id: string;
  /** Whether all DoR conditions passed */
  passed: boolean;
  /** ISO 8601 timestamp when validation was performed */
  last_checked_at: string;
  /** Individual condition results */
  conditions: DoRCondition[];
  /** Summary of validation */
  summary: DoRValidationSummary;
}

/**
 * Summary statistics for DoR validation.
 */
export interface DoRValidationSummary {
  /** Total number of conditions checked */
  total_conditions: number;
  /** Number of conditions that passed */
  passed_conditions: number;
  /** Number of conditions that failed */
  failed_conditions: number;
  /** List of failed condition IDs */
  failed_condition_ids: string[];
  /** Blocking reasons (human-readable) */
  blocking_reasons: string[];
}

// =============================================================================
// Type Definitions - Revalidation
// =============================================================================

/**
 * Result of revalidating tasks affected by a change.
 * Requirements: R01.6
 */
export interface RevalidationResult {
  /** ID of the task that triggered revalidation */
  trigger_task_id: string;
  /** Reason for revalidation */
  trigger_reason: RevalidationTrigger;
  /** ISO 8601 timestamp when revalidation was performed */
  revalidated_at: string;
  /** Tasks that were revalidated */
  affected_tasks: AffectedTaskResult[];
  /** Summary statistics */
  summary: RevalidationSummary;
}

/**
 * Reasons that can trigger revalidation of DoR.
 * Requirements: R01.6
 */
export type RevalidationTrigger = 
  | 'dependency_completed'    // Upstream task completed
  | 'dependency_reopened'     // Upstream task re-opened
  | 'blocker_resolved'        // Blocker was closed
  | 'blocker_added'           // New blocker added
  | 'decision_resolved'       // Linked decision resolved
  | 'decision_changed'        // Linked decision changed
  | 'requirement_changed'     // Requirement was modified
  | 'role_changed'            // Assignee role changed
  | 'manual';                 // Manual revalidation request

/**
 * Change types for finding tasks needing revalidation.
 * Requirements: R01.6
 */
export type ChangeType =
  | 'dependency'    // A dependency task changed status
  | 'blocker'       // A blocker was resolved or added
  | 'decision';     // A decision was resolved or changed

/**
 * Input for finding tasks needing revalidation.
 * Requirements: R01.6
 */
export interface RevalidationChangeInput {
  /** Type of change that occurred */
  changeType: ChangeType;
  /** ID of the changed entity (task ID, blocker ID, or decision ID) */
  changeId: string;
  /** Additional details about the change */
  changeDetails?: {
    /** Previous status (for status changes) */
    previousStatus?: string;
    /** New status (for status changes) */
    newStatus?: string;
  };
}

/**
 * Result of revalidating a single affected task.
 */
export interface AffectedTaskResult {
  /** Task ID that was revalidated */
  task_id: string;
  /** Previous DoR status before revalidation */
  previous_status: boolean;
  /** New DoR status after revalidation */
  new_status: boolean;
  /** Whether status changed */
  status_changed: boolean;
  /** Full validation result */
  validation: DoRValidation;
}

/**
 * Summary of revalidation operation.
 */
export interface RevalidationSummary {
  /** Total number of affected tasks */
  total_affected: number;
  /** Tasks that changed from not-ready to ready */
  newly_ready: number;
  /** Tasks that changed from ready to not-ready */
  no_longer_ready: number;
  /** Tasks whose status didn't change */
  unchanged: number;
  /** Task IDs that became ready */
  newly_ready_task_ids: string[];
  /** Task IDs that are no longer ready */
  no_longer_ready_task_ids: string[];
}

// =============================================================================
// Type Definitions - Can Start Work
// =============================================================================

/**
 * Result of checking whether work can be started on a task.
 * Requirements: R01.1, R01.3
 */
export interface CanStartWorkResult {
  /** Whether work can be started */
  allowed: boolean;
  /** List of blocking reasons if not allowed */
  blockers: string[];
  /** Full DoR validation result */
  validation: DoRValidation;
  /** Suggestions for resolving blockers */
  suggestions?: string[];
}

// =============================================================================
// Type Definitions - Task Input
// =============================================================================

/**
 * Task data required for DoR validation.
 * This represents the minimal task information needed for validation.
 */
export interface TaskForDoRValidation {
  /** Task ID */
  id: string;
  /** Current task status */
  status: string;
  /** Acceptance criteria (may be undefined or empty) */
  acceptance_criteria?: string[];
  /** Dependencies on other tasks */
  depends_on?: TaskDependency[];
  /** Linked decision IDs (DEC-xxx) */
  linked_decisions?: string[];
  /** Assignment information */
  assignment?: TaskAssignment;
  /** Active blocker references */
  blocker_refs?: string[];
  /** Whether task is currently blocked */
  blocked?: boolean;
  /** Scope description */
  scope?: string;
}

/**
 * Task dependency definition for DoR validation.
 */
export interface TaskDependency {
  /** ID of the dependency task */
  task_id: string;
  /** Type of dependency */
  type: 'blocking' | 'non_blocking' | 'recommended';
  /** Reason for dependency */
  reason?: string;
}

/**
 * Task assignment information for DoR validation.
 */
export interface TaskAssignment {
  /** Assignee ID */
  assignee: string | null;
  /** Required role for the task */
  role_required?: string | null;
  /** Assigned timestamp */
  assigned_at?: string;
}

// =============================================================================
// Type Definitions - External Data
// =============================================================================

/**
 * External decision data for DoR validation.
 */
export interface DecisionData {
  /** Decision ID (DEC-xxx) */
  id: string;
  /** Decision status */
  status: 'RESOLVED' | 'PENDING' | 'DEFERRED';
  /** Resolution summary (if resolved) */
  resolution?: string;
}

/**
 * External blocker data for DoR validation.
 */
export interface BlockerData {
  /** Blocker ID (BLOCKER-xxx) */
  id: string;
  /** Blocker status */
  status: 'OPEN' | 'CLOSED';
  /** Blocker description */
  description?: string;
}

/**
 * External task status data for dependency validation.
 */
export interface TaskStatusData {
  /** Task ID */
  id: string;
  /** Task status */
  status: string;
  /** Whether task is done */
  is_done: boolean;
}

/**
 * Team member data for role validation.
 */
export interface MemberRoleData {
  /** Member ID */
  id: string;
  /** Roles assigned to member */
  roles: string[];
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * DoR validation error codes.
 * Error codes in range 3100-3199 for DOR_ERROR category.
 * Requirements: R01.3
 */
export enum DoRErrorCode {
  /** Task not found */
  TASK_NOT_FOUND = 3101,
  /** DoR validation failed (conditions not met) */
  DOR_NOT_MET = 3102,
  /** Invalid task state for DoR check */
  INVALID_TASK_STATE = 3103,
  /** Dependency task not found */
  DEPENDENCY_NOT_FOUND = 3104,
  /** Decision not found */
  DECISION_NOT_FOUND = 3105,
  /** Blocker not found */
  BLOCKER_NOT_FOUND = 3106,
  /** Assignee not found */
  ASSIGNEE_NOT_FOUND = 3107,
  /** Role validation failed */
  ROLE_VALIDATION_FAILED = 3108,
  /** Revalidation failed */
  REVALIDATION_FAILED = 3109,
  /** Invalid configuration */
  INVALID_CONFIG = 3110,
  /** Task is blocked */
  TASK_BLOCKED = 3111,
}

/**
 * DoR error structure following the design specification.
 */
export interface DoRError {
  /** Error code from DoRErrorCode enum */
  code: DoRErrorCode;
  /** Error category */
  category: 'DOR_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    task_id?: string;
    condition_id?: string;
    condition_type?: DoRConditionType;
    failed_conditions?: string[];
    dependency_id?: string;
    decision_id?: string;
    blocker_id?: string;
    assignee_id?: string;
    required_role?: string;
    details?: string;
    [key: string]: unknown;
  };
  /** Whether the operation can be retried or condition can be resolved */
  recoverable: boolean;
  /** Suggested action to resolve the error */
  suggested_action?: string;
  /** ISO 8601 timestamp when the error occurred */
  timestamp: string;
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Creates a DoRError with the given code and details.
 */
export function createDoRError(
  code: DoRErrorCode,
  message: string,
  context?: DoRError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): DoRError {
  return {
    code,
    category: 'DOR_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "task not found" error.
 */
export function taskNotFoundForDoRError(taskId: string): DoRError {
  return createDoRError(
    DoRErrorCode.TASK_NOT_FOUND,
    `Task ${taskId} not found for DoR validation`,
    { task_id: taskId },
    false,
    'Verify the task ID is correct and the task exists'
  );
}

/**
 * Creates a "DoR not met" error with details about failed conditions.
 * Requirements: R01.3
 */
export function dorNotMetError(
  taskId: string,
  failedConditions: DoRCondition[]
): DoRError {
  const failedIds = failedConditions.map(c => c.id);
  const failedDescriptions = failedConditions.map(c => c.description);
  
  return createDoRError(
    DoRErrorCode.DOR_NOT_MET,
    `Task ${taskId} does not meet Definition of Ready: ${failedDescriptions.join('; ')}`,
    {
      task_id: taskId,
      failed_conditions: failedIds,
      details: failedConditions.map(c => `${c.id}: ${c.details}`).join('; '),
    },
    true, // recoverable by fixing conditions
    `Resolve the following conditions: ${failedIds.join(', ')}`
  );
}

/**
 * Creates an "invalid task state" error.
 */
export function invalidTaskStateForDoRError(
  taskId: string,
  currentState: string,
  allowedStates: string[]
): DoRError {
  return createDoRError(
    DoRErrorCode.INVALID_TASK_STATE,
    `Task ${taskId} is in state '${currentState}' which cannot be validated for DoR`,
    {
      task_id: taskId,
      details: `Current state: ${currentState}, allowed: ${allowedStates.join(', ')}`,
    },
    false,
    `Task must be in one of: ${allowedStates.join(', ')}`
  );
}

/**
 * Creates a "dependency not found" error.
 */
export function dependencyNotFoundError(
  taskId: string,
  dependencyId: string
): DoRError {
  return createDoRError(
    DoRErrorCode.DEPENDENCY_NOT_FOUND,
    `Dependency ${dependencyId} for task ${taskId} not found`,
    {
      task_id: taskId,
      dependency_id: dependencyId,
    },
    false,
    'Verify the dependency task ID is correct and the task exists'
  );
}

/**
 * Creates a "decision not found" error.
 */
export function decisionNotFoundError(
  taskId: string,
  decisionId: string
): DoRError {
  return createDoRError(
    DoRErrorCode.DECISION_NOT_FOUND,
    `Decision ${decisionId} linked to task ${taskId} not found`,
    {
      task_id: taskId,
      decision_id: decisionId,
    },
    false,
    'Verify the decision ID is correct and the decision exists'
  );
}

/**
 * Creates a "blocker not found" error.
 */
export function blockerNotFoundError(
  taskId: string,
  blockerId: string
): DoRError {
  return createDoRError(
    DoRErrorCode.BLOCKER_NOT_FOUND,
    `Blocker ${blockerId} for task ${taskId} not found`,
    {
      task_id: taskId,
      blocker_id: blockerId,
    },
    false,
    'Verify the blocker ID is correct and the blocker record exists'
  );
}

/**
 * Creates an "assignee not found" error.
 */
export function assigneeNotFoundError(
  taskId: string,
  assigneeId: string
): DoRError {
  return createDoRError(
    DoRErrorCode.ASSIGNEE_NOT_FOUND,
    `Assignee ${assigneeId} for task ${taskId} not found in team`,
    {
      task_id: taskId,
      assignee_id: assigneeId,
    },
    true,
    'Ensure the assignee is a registered team member'
  );
}

/**
 * Creates a "role validation failed" error.
 */
export function roleValidationFailedError(
  taskId: string,
  assigneeId: string,
  requiredRole: string,
  actualRoles: string[]
): DoRError {
  return createDoRError(
    DoRErrorCode.ROLE_VALIDATION_FAILED,
    `Assignee ${assigneeId} does not have required role '${requiredRole}' for task ${taskId}`,
    {
      task_id: taskId,
      assignee_id: assigneeId,
      required_role: requiredRole,
      details: `Assignee has roles: ${actualRoles.join(', ')}`,
    },
    true,
    `Either assign to someone with '${requiredRole}' role or add the role to ${assigneeId}`
  );
}

/**
 * Creates a "task blocked" error.
 * Requirements: R01.4
 */
export function taskBlockedError(
  taskId: string,
  blockerRefs: string[]
): DoRError {
  return createDoRError(
    DoRErrorCode.TASK_BLOCKED,
    `Task ${taskId} is blocked and cannot transition to IN_PROGRESS`,
    {
      task_id: taskId,
      details: `Active blockers: ${blockerRefs.join(', ')}`,
    },
    true,
    `Resolve the following blockers: ${blockerRefs.join(', ')}`
  );
}

/**
 * Creates a "revalidation failed" error.
 */
export function revalidationFailedError(
  triggerTaskId: string,
  reason: string
): DoRError {
  return createDoRError(
    DoRErrorCode.REVALIDATION_FAILED,
    `Revalidation triggered by task ${triggerTaskId} failed: ${reason}`,
    {
      task_id: triggerTaskId,
      details: reason,
    },
    true,
    'Check the trigger task and affected tasks for issues'
  );
}

// =============================================================================
// Custom Error Classes
// =============================================================================

/**
 * Custom error class for DoR not met.
 */
export class DoRNotMetError extends Error {
  public readonly code = DoRErrorCode.DOR_NOT_MET;
  public readonly taskId: string;
  public readonly failedConditions: DoRCondition[];
  
  constructor(taskId: string, failedConditions: DoRCondition[]) {
    const descriptions = failedConditions.map(c => c.description).join('; ');
    super(`Task ${taskId} does not meet Definition of Ready: ${descriptions}`);
    this.name = 'DoRNotMetError';
    this.taskId = taskId;
    this.failedConditions = failedConditions;
  }
  
  toDoRError(): DoRError {
    return dorNotMetError(this.taskId, this.failedConditions);
  }
}

/**
 * Custom error class for task not found during DoR validation.
 */
export class TaskNotFoundForDoRError extends Error {
  public readonly code = DoRErrorCode.TASK_NOT_FOUND;
  public readonly taskId: string;
  
  constructor(taskId: string) {
    super(`Task ${taskId} not found for DoR validation`);
    this.name = 'TaskNotFoundForDoRError';
    this.taskId = taskId;
  }
  
  toDoRError(): DoRError {
    return taskNotFoundForDoRError(this.taskId);
  }
}

/**
 * Custom error class for task blocked.
 */
export class TaskBlockedForDoRError extends Error {
  public readonly code = DoRErrorCode.TASK_BLOCKED;
  public readonly taskId: string;
  public readonly blockerRefs: string[];
  
  constructor(taskId: string, blockerRefs: string[]) {
    super(`Task ${taskId} is blocked: ${blockerRefs.join(', ')}`);
    this.name = 'TaskBlockedForDoRError';
    this.taskId = taskId;
    this.blockerRefs = blockerRefs;
  }
  
  toDoRError(): DoRError {
    return taskBlockedError(this.taskId, this.blockerRefs);
  }
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for DoR validation.
 */
export type ValidateDoRResult = Result<DoRValidation, DoRError>;

/**
 * Result type for revalidation.
 */
export type RevalidateResult = Result<RevalidationResult, DoRError>;

/**
 * Result type for getting DoR conditions.
 */
export type GetDoRConditionsResult = Result<DoRCondition[], DoRError>;

/**
 * Result type for can start work check.
 */
export type CanStartWorkCheckResult = Result<CanStartWorkResult, DoRError>;

// =============================================================================
// DoR_Validator Interface
// =============================================================================

/**
 * DoRValidator interface for Definition of Ready validation.
 * 
 * This component ensures tasks only transition to IN_PROGRESS when all
 * readiness conditions are met:
 * 
 * 1. Acceptance criteria are defined (non-empty)
 * 2. All blocking dependencies are in DONE status
 * 3. Required decisions (linked DEC-xxx) are resolved
 * 4. Assignee has the role specified in role_required
 * 5. No active blockers (BLOCKER-xxx with OPEN status)
 * 
 * Requirements: R01.1, R01.2, R01.3, R01.4, R01.5, R01.6
 */
export interface DoRValidator {
  // =========================================================================
  // Validation Operations
  // =========================================================================

  /**
   * Validates Definition of Ready for a task.
   * 
   * Requirements: R01.1, R01.2, R01.5
   * 
   * @param taskId - The task to validate
   * @returns Result with DoRValidation on success, or DoRError on failure
   * 
   * Behavior:
   * - Checks all DoR conditions defined in R01.2:
   *   1. Scope and acceptance criteria defined (non-empty)
   *   2. All blocking dependencies in DONE status
   *   3. Required decisions (DEC-xxx) resolved
   *   4. Assignee has role matching role_required
   *   5. No active blockers (BLOCKER-xxx)
   * - Returns comprehensive validation result with each condition's status
   * - Stores DoR check result as task metadata with timestamp (R01.5)
   * 
   * Errors:
   * - TASK_NOT_FOUND: If task doesn't exist
   * - INVALID_TASK_STATE: If task is in a state where DoR doesn't apply
   */
  validateDoR(taskId: string): Promise<ValidateDoRResult>;

  // =========================================================================
  // Revalidation Operations
  // =========================================================================

  /**
   * Re-validates DoR for all tasks affected by a change.
   * Called when dependencies complete, blockers resolve, etc.
   * 
   * Requirements: R01.6
   * 
   * @param changedTaskId - The task that changed (dependency completed, etc.)
   * @returns Result with RevalidationResult on success, or DoRError on failure
   * 
   * Behavior:
   * - Identifies all tasks that depend on changedTaskId
   * - Re-validates DoR for each affected task
   * - Updates status for tasks where DoR status changed
   * - Returns summary of all revalidations
   * 
   * Triggers revalidation when:
   * - Upstream task completes (dependency satisfied)
   * - Upstream task re-opened (dependency no longer satisfied)
   * - Blocker resolved (no_blockers condition may now pass)
   * - Decision resolved (decisions condition may now pass)
   * - Requirement changes (may affect acceptance_criteria)
   */
  revalidateAffectedTasks(changedTaskId: string): Promise<RevalidateResult>;

  /**
   * Re-validates DoR for all tasks affected by a dependency completion.
   * Called when an upstream task completes (transitions to DONE status).
   * 
   * Requirements: R01.6
   * 
   * @param completedTaskId - The task that was completed
   * @returns Result with RevalidationResult on success, or DoRError on failure
   * 
   * Behavior:
   * - Finds all tasks that have blocking dependency on completedTaskId
   * - Re-validates DoR for each dependent task
   * - Updates DoR status in task metadata
   * - Returns aggregated results including:
   *   - Tasks that became ready (dependency now satisfied)
   *   - Tasks that are still not ready (other conditions failed)
   */
  revalidateOnDependencyComplete(completedTaskId: string): Promise<RevalidateResult>;

  /**
   * Re-validates DoR for all tasks affected by a blocker resolution.
   * Called when a blocker is resolved (status changes to CLOSED).
   * 
   * Requirements: R01.6
   * 
   * @param blockerId - The blocker that was resolved
   * @returns Result with RevalidationResult on success, or DoRError on failure
   * 
   * Behavior:
   * - Finds all tasks that reference blockerId in blocker_refs
   * - Re-validates DoR for each blocked task
   * - Updates blocked flag and DoR status in task metadata
   * - Returns aggregated results including:
   *   - Tasks that became unblocked and ready
   *   - Tasks that are unblocked but still not ready (other conditions failed)
   */
  revalidateOnBlockerResolved(blockerId: string): Promise<RevalidateResult>;

  /**
   * Re-validates DoR for all tasks affected by a decision resolution.
   * Called when a linked decision is resolved.
   * 
   * Requirements: R01.6
   * 
   * @param decisionId - The decision that was resolved
   * @returns Result with RevalidationResult on success, or DoRError on failure
   * 
   * Behavior:
   * - Finds all tasks that have decisionId in linked_decisions
   * - Re-validates DoR for each linked task
   * - Updates DoR status in task metadata
   * - Returns aggregated results including:
   *   - Tasks that became ready (decision now resolved)
   *   - Tasks that are still not ready (other conditions failed)
   */
  revalidateOnDecisionResolved(decisionId: string): Promise<RevalidateResult>;

  /**
   * Generic method to find and revalidate tasks affected by a change.
   * 
   * Requirements: R01.6
   * 
   * @param changeType - Type of change (dependency, blocker, decision)
   * @param changeId - ID of the changed entity
   * @returns Result with RevalidationResult on success, or DoRError on failure
   * 
   * Behavior:
   * - Determines affected tasks based on changeType
   * - Calls validateDoR for each affected task
   * - Returns aggregated results
   */
  getTasksNeedingRevalidation(changeType: ChangeType, changeId: string): Promise<Result<TaskForDoRValidation[], DoRError>>;

  // =========================================================================
  // Condition Query Operations
  // =========================================================================

  /**
   * Gets DoR conditions for a task without performing full validation.
   * Useful for displaying what conditions exist and their current state.
   * 
   * Requirements: R01.2
   * 
   * @param taskId - The task to get conditions for
   * @returns Result with DoRCondition[] on success, or DoRError on failure
   * 
   * Behavior:
   * - Returns all applicable DoR conditions for the task
   * - Each condition includes its type, description, and current status
   * - Does NOT update stored DoR check result
   * 
   * Errors:
   * - TASK_NOT_FOUND: If task doesn't exist
   */
  getDoRConditions(taskId: string): Promise<GetDoRConditionsResult>;

  // =========================================================================
  // Work Start Check
  // =========================================================================

  /**
   * Checks if work can be started on a task.
   * Combines DoR validation with blocker check.
   * 
   * Requirements: R01.1, R01.3, R01.4
   * 
   * @param taskId - The task to check
   * @returns Result with CanStartWorkResult on success, or DoRError on failure
   * 
   * Behavior:
   * - Validates all DoR conditions
   * - Checks for active blockers
   * - Returns whether work can start and why not if blocked
   * - Provides suggestions for resolving issues
   * 
   * If not allowed, blockers array contains reasons such as:
   * - "Acceptance criteria not defined"
   * - "Blocking dependency TASK-001 not complete"
   * - "Decision DEC-001 not resolved"
   * - "Assignee does not have required role 'backend'"
   * - "Active blocker: BLOCKER-001"
   * 
   * Errors:
   * - TASK_NOT_FOUND: If task doesn't exist
   * - TASK_BLOCKED: If task has active blockers (R01.4)
   */
  canStartWork(taskId: string): Promise<CanStartWorkCheckResult>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for DoRValidator implementation.
 */
export interface DoRValidatorConfig {
  /** Minimum number of acceptance criteria required */
  minAcceptanceCriteria?: number;
  /** Maximum age of DoR check before re-validation is recommended (seconds) */
  checkStalenessSeconds?: number;
  /** Whether to skip role validation if no role_required specified */
  skipRoleValidationIfNotRequired?: boolean;
  /** Whether to treat missing assignee as failed role check */
  requireAssigneeForRoleCheck?: boolean;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates default DoR validator configuration.
 */
export function createDefaultDoRValidatorConfig(): DoRValidatorConfig {
  return {
    minAcceptanceCriteria: DOR_DEFAULTS.MIN_ACCEPTANCE_CRITERIA,
    checkStalenessSeconds: DOR_DEFAULTS.CHECK_STALENESS_SECONDS,
    skipRoleValidationIfNotRequired: true,
    requireAssigneeForRoleCheck: true,
  };
}

/**
 * Creates an empty DoR validation result (all conditions unchecked).
 */
export function createEmptyDoRValidation(taskId: string): DoRValidation {
  return {
    task_id: taskId,
    passed: false,
    last_checked_at: new Date().toISOString(),
    conditions: [],
    summary: {
      total_conditions: 0,
      passed_conditions: 0,
      failed_conditions: 0,
      failed_condition_ids: [],
      blocking_reasons: [],
    },
  };
}

/**
 * Creates a passing DoR condition.
 */
export function createPassingCondition(
  id: string,
  type: DoRConditionType,
  description: string,
  details: string
): DoRCondition {
  return {
    id,
    description,
    type,
    passed: true,
    details,
  };
}

/**
 * Creates a failing DoR condition.
 */
export function createFailingCondition(
  id: string,
  type: DoRConditionType,
  description: string,
  details: string,
  context?: DoRConditionContext
): DoRCondition {
  return {
    id,
    description,
    type,
    passed: false,
    details,
    context,
  };
}

/**
 * Creates a DoR validation result from conditions.
 */
export function createDoRValidation(
  taskId: string,
  conditions: DoRCondition[]
): DoRValidation {
  const failedConditions = conditions.filter(c => !c.passed);
  const passed = failedConditions.length === 0;
  
  return {
    task_id: taskId,
    passed,
    last_checked_at: new Date().toISOString(),
    conditions,
    summary: {
      total_conditions: conditions.length,
      passed_conditions: conditions.length - failedConditions.length,
      failed_conditions: failedConditions.length,
      failed_condition_ids: failedConditions.map(c => c.id),
      blocking_reasons: failedConditions.map(c => c.description),
    },
  };
}

/**
 * Creates a revalidation result.
 */
export function createRevalidationResult(
  triggerTaskId: string,
  triggerReason: RevalidationTrigger,
  affectedTasks: AffectedTaskResult[]
): RevalidationResult {
  const newlyReady = affectedTasks.filter(t => t.status_changed && t.new_status);
  const noLongerReady = affectedTasks.filter(t => t.status_changed && !t.new_status);
  const unchanged = affectedTasks.filter(t => !t.status_changed);
  
  return {
    trigger_task_id: triggerTaskId,
    trigger_reason: triggerReason,
    revalidated_at: new Date().toISOString(),
    affected_tasks: affectedTasks,
    summary: {
      total_affected: affectedTasks.length,
      newly_ready: newlyReady.length,
      no_longer_ready: noLongerReady.length,
      unchanged: unchanged.length,
      newly_ready_task_ids: newlyReady.map(t => t.task_id),
      no_longer_ready_task_ids: noLongerReady.map(t => t.task_id),
    },
  };
}

/**
 * Creates a "can start work" result.
 */
export function createCanStartWorkResult(
  validation: DoRValidation,
  additionalBlockers: string[] = [],
  suggestions: string[] = []
): CanStartWorkResult {
  const blockers = [
    ...validation.summary.blocking_reasons,
    ...additionalBlockers,
  ];
  
  return {
    allowed: blockers.length === 0,
    blockers,
    validation,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

// =============================================================================
// Condition ID Constants
// =============================================================================

/**
 * Standard DoR condition IDs.
 * These follow a consistent naming convention for easy reference.
 */
export const DOR_CONDITION_IDS = {
  /** Acceptance criteria defined condition */
  ACCEPTANCE_CRITERIA: 'dor-ac-defined',
  /** Blocking dependencies satisfied condition */
  DEPENDENCIES: 'dor-deps-done',
  /** Decisions resolved condition */
  DECISIONS: 'dor-decisions-resolved',
  /** Role match condition */
  ROLE_MATCH: 'dor-role-match',
  /** No blockers condition */
  NO_BLOCKERS: 'dor-no-blockers',
} as const;

/**
 * Standard DoR condition descriptions.
 */
export const DOR_CONDITION_DESCRIPTIONS = {
  [DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA]: 'Acceptance criteria defined',
  [DOR_CONDITION_IDS.DEPENDENCIES]: 'Blocking dependencies complete',
  [DOR_CONDITION_IDS.DECISIONS]: 'Required decisions made',
  [DOR_CONDITION_IDS.ROLE_MATCH]: 'Assignee has required role',
  [DOR_CONDITION_IDS.NO_BLOCKERS]: 'No active blockers',
} as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Checks if a DoR validation result is stale.
 */
export function isDoRValidationStale(
  validation: DoRValidation,
  maxAgeSeconds: number = DOR_DEFAULTS.CHECK_STALENESS_SECONDS
): boolean {
  const checkedAt = new Date(validation.last_checked_at);
  const now = new Date();
  const ageSeconds = (now.getTime() - checkedAt.getTime()) / 1000;
  return ageSeconds > maxAgeSeconds;
}

/**
 * Gets the blocking dependency IDs from a failed dependencies condition.
 */
export function getBlockingDependencyIds(condition: DoRCondition): string[] {
  if (condition.type !== 'dependencies' || condition.passed) {
    return [];
  }
  return condition.context?.failed_items || [];
}

/**
 * Checks if a decision reference is valid format (DEC-xxx).
 */
export function isValidDecisionRef(ref: string): boolean {
  return DOR_DEFAULTS.DECISION_REF_PATTERN.test(ref);
}

/**
 * Checks if a blocker reference is valid format (BLOCKER-xxx).
 */
export function isValidBlockerRef(ref: string): boolean {
  return DOR_DEFAULTS.BLOCKER_REF_PATTERN.test(ref);
}
