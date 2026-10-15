/**
 * Task Lifecycle Manager - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and implementation for the Task Lifecycle Manager
 * which handles task state transitions with validation guards and orthogonal attributes.
 * 
 * The Task Lifecycle Manager ensures:
 * - All task states from R04.1 are supported
 * - BLOCKED and HANDOFF_PENDING are orthogonal attributes (can be combined with main states)
 * - Transition guards are enforced (DoR validation, evidence checks, finding checks)
 * - State history is tracked with timestamps
 * 
 * Requirements: R04.1, R04.4, R04.5
 */

import { Result, ok, err, ActorType } from './state-controller';
import { DoRValidator, DoRValidation, CanStartWorkResult } from './dor-validator';
import { AuditLogger, createAuditEntry } from './audit-logger';

// =============================================================================
// Constants
// =============================================================================

/**
 * All valid task states as defined in R04.1.
 */
export const TASK_STATES = [
  'PENDING',           // Task created, not ready
  'READY',             // DoR met, ready to work
  'ASSIGNED',          // Has assignee, not started
  'IN_PROGRESS',       // Being worked on (TDD cycle)
  'REVIEW',            // Waiting for review
  'CHANGES_REQUESTED', // Review requested changes
  'READY_TO_MERGE',    // Review approved, ready to merge
  'INTEGRATED',        // Merged to target branch
  'DONE',              // Completed and verified
  'CANCELLED',         // Explicitly cancelled
  'SUPERSEDED',        // Replaced by another task
] as const;

/**
 * Terminal states that cannot transition to other states (except with special override).
 */
export const TERMINAL_STATES = ['DONE', 'CANCELLED', 'SUPERSEDED'] as const;

/**
 * States that support the BLOCKED orthogonal attribute.
 * Requirements: R04.2
 */
export const BLOCKABLE_STATES = [
  'PENDING',
  'READY',
  'ASSIGNED',
  'IN_PROGRESS',
  'REVIEW',
] as const;

/**
 * States that support the HANDOFF_PENDING orthogonal attribute.
 * Requirements: R04.3
 */
export const HANDOFF_PENDING_STATES = [
  'IN_PROGRESS',
] as const;

/**
 * Default configuration for task lifecycle operations.
 */
export const TASK_LIFECYCLE_DEFAULTS = {
  /** Maximum history entries to keep per task */
  MAX_HISTORY_ENTRIES: 100,
  /** Whether to require evidence for review transition */
  REQUIRE_EVIDENCE_FOR_REVIEW: true,
  /** Whether to require DoR for IN_PROGRESS transition */
  REQUIRE_DOR_FOR_IN_PROGRESS: true,
  /** Whether to require findings check for DONE transition */
  REQUIRE_FINDINGS_CHECK_FOR_DONE: true,
} as const;

// =============================================================================
// Type Definitions - Task States
// =============================================================================

/**
 * Task state type derived from valid states constant.
 * Requirements: R04.1
 */
export type TaskState = typeof TASK_STATES[number];

/**
 * Terminal state type.
 */
export type TerminalState = typeof TERMINAL_STATES[number];

/**
 * Blockable state type.
 * Requirements: R04.2
 */
export type BlockableState = typeof BLOCKABLE_STATES[number];

/**
 * Handoff pending state type.
 * Requirements: R04.3
 */
export type HandoffPendingState = typeof HANDOFF_PENDING_STATES[number];

// =============================================================================
// Type Definitions - Orthogonal Attributes
// =============================================================================

/**
 * BLOCKED orthogonal attribute.
 * Can be applied to states: PENDING, READY, ASSIGNED, IN_PROGRESS, REVIEW.
 * Requirements: R04.2
 */
export interface BlockedStatus {
  /** Whether the task is blocked */
  blocked: boolean;
  /** Reason for blocking (required if blocked) */
  blocked_reason: string | null;
  /** References to blocker records */
  blocker_refs: string[];
  /** ISO 8601 timestamp when blocking started */
  blocked_since: string | null;
  /** State the task was in when blocked */
  blocked_phase: TaskState | null;
}

/**
 * HANDOFF_PENDING orthogonal attribute.
 * Can be applied to state: IN_PROGRESS.
 * Requirements: R04.3
 */
export interface HandoffPendingStatus {
  /** Whether handoff is pending */
  handoff_pending: boolean;
  /** Handoff ID if pending */
  handoff_id: string | null;
  /** ISO 8601 timestamp when handoff was initiated */
  handoff_initiated_at: string | null;
}

// =============================================================================
// Type Definitions - State History
// =============================================================================

/**
 * Reason for state transition.
 */
export type TransitionReason =
  | 'dor_met'              // DoR conditions satisfied
  | 'assignee_set'         // Assignee was assigned
  | 'work_started'         // Developer started work
  | 'implementation_done'  // Implementation complete
  | 'changes_requested'    // Reviewer requested changes
  | 'approved'             // Review approved
  | 'merged'               // Code merged
  | 'verified'             // Post-merge verification passed
  | 'verification_failed'  // Verification failed
  | 'blocker_added'        // Blocker was added
  | 'blocker_resolved'     // Blocker was resolved
  | 'handoff_initiated'    // Handoff started
  | 'handoff_complete'     // Handoff finished
  | 'handoff_cancelled'    // Handoff was cancelled
  | 'cancelled'            // Explicit cancellation
  | 'superseded'           // Replaced by another task
  | 'reopened'             // Task reopened from DONE
  | 'unassigned'           // Assignment removed
  | 'addressing_changes'   // Working on requested changes
  | 'merge_failed'         // Merge attempt failed
  | 'manual';              // Manual/administrative transition

/**
 * State history entry for tracking state changes.
 * Requirements: R04.1
 */
export interface StateHistoryEntry {
  /** Previous task state */
  from_state: TaskState;
  /** New task state */
  to_state: TaskState;
  /** ISO 8601 timestamp of transition */
  transitioned_at: string;
  /** Reason for the transition */
  reason: TransitionReason;
  /** ID of actor who triggered the transition */
  triggered_by: string;
  /** Additional context about the transition */
  context?: string;
  /** Whether BLOCKED attribute changed */
  blocked_changed?: {
    from: boolean;
    to: boolean;
  };
  /** Whether HANDOFF_PENDING attribute changed */
  handoff_pending_changed?: {
    from: boolean;
    to: boolean;
  };
}

// =============================================================================
// Type Definitions - Task for Lifecycle
// =============================================================================

/**
 * Task data required for lifecycle management.
 */
export interface TaskForLifecycle {
  /** Task ID */
  id: string;
  /** Current task state */
  status: TaskState;
  /** Assignment information */
  assignee: string | null;
  /** Blocked status (orthogonal) */
  blocked_status: BlockedStatus;
  /** Handoff pending status (orthogonal) */
  handoff_status: HandoffPendingStatus;
  /** State history */
  state_history: StateHistoryEntry[];
  /** Evidence IDs collected for this task */
  evidence_refs?: string[];
  /** DoR validation result */
  dor_validation?: DoRValidation;
  /** Has blocking findings */
  has_blocking_findings?: boolean;
  /** 
   * List of blocking finding IDs (CRITICAL/HIGH severity, OPEN/IN_PROGRESS status).
   * Updated when findings change. Used for task lifecycle guard checks.
   * Requirements: R11.5
   */
  blocking_finding_ids?: string[];
}

// =============================================================================
// Type Definitions - Transition Definition
// =============================================================================

/**
 * Defines a valid state transition.
 * Requirements: R04.4
 */
export interface TransitionDefinition {
  /** Source state */
  from: TaskState;
  /** Target state */
  to: TaskState;
  /** Default reason for this transition */
  default_reason: TransitionReason;
  /** Guards to validate before transition */
  guards: TransitionGuardType[];
}

/**
 * Types of transition guards.
 * Requirements: R04.4
 */
export type TransitionGuardType =
  | 'dor_valid'                    // DoR must be validated
  | 'has_assignee'                 // Task must have assignee
  | 'no_blocking_findings'         // No CRITICAL/HIGH findings
  | 'has_required_evidence'        // Required evidence collected
  | 'not_blocked'                  // Task must not be blocked
  | 'handoff_not_pending'          // No pending handoff
  | 'reopen_justification'         // Requires reopen justification
  | 'blocker_specified'            // Blocker must be specified
  | 'blocker_resolved';            // All blockers must be resolved

// =============================================================================
// Type Definitions - Transition Request
// =============================================================================

/**
 * Reopen justification type for reopening a task from DONE state.
 * Requirements: R04.7
 */
export interface ReopenJustification {
  /** Reason for reopening the task (required, non-empty) */
  reason: string;
  /** Evidence reference (issue ID, test failure ID, etc.) - required */
  evidence_ref: string;
  /** Target state after reopen (defaults to IN_PROGRESS) */
  target_state?: TaskState;
}

/**
 * Valid target states for reopening a task.
 * Requirements: R04.7
 */
export const VALID_REOPEN_TARGET_STATES: TaskState[] = ['IN_PROGRESS', 'ASSIGNED', 'READY'];

/**
 * Request to transition a task to a new state.
 */
export interface TransitionRequest {
  /** Task ID to transition */
  task_id: string;
  /** Target state */
  to_state: TaskState;
  /** Reason for transition */
  reason?: TransitionReason;
  /** Actor triggering the transition */
  triggered_by: string;
  /** Additional context */
  context?: string;
  /** For blocked transitions: blocker information */
  blocker_info?: {
    reason: string;
    blocker_refs: string[];
  };
  /** For reopen transitions: justification */
  reopen_justification?: {
    reason: string;
    evidence_ref?: string;
    target_state?: TaskState;
  };
}

/**
 * Request to reopen a task from DONE state.
 * Requirements: R04.7
 */
export interface ReopenTaskRequest {
  /** Task ID to reopen */
  task_id: string;
  /** Justification for reopening */
  justification: ReopenJustification;
  /** Actor triggering the reopen */
  triggered_by: string;
}

/**
 * Result of a successful reopen operation.
 */
export interface ReopenTaskResult extends TransitionResult {
  /** The justification that was provided */
  justification: ReopenJustification;
  /** Whether blocking findings flag was cleared */
  blocking_findings_cleared: boolean;
}

/**
 * History entry for reopen operation - extends StateHistoryEntry with justification.
 */
export interface ReopenHistoryEntry extends StateHistoryEntry {
  /** Reopen justification details */
  reopen_justification: ReopenJustification;
}

// =============================================================================
// Type Definitions - Transition Result
// =============================================================================

/**
 * Result of a successful state transition.
 */
export interface TransitionResult {
  /** Task ID that was transitioned */
  task_id: string;
  /** Previous state */
  from_state: TaskState;
  /** New state */
  to_state: TaskState;
  /** ISO 8601 timestamp of transition */
  transitioned_at: string;
  /** History entry created */
  history_entry: StateHistoryEntry;
  /** Updated blocked status (if changed) */
  blocked_status?: BlockedStatus;
  /** Updated handoff status (if changed) */
  handoff_status?: HandoffPendingStatus;
}

/**
 * Result of checking valid transitions.
 */
export interface ValidTransitionsResult {
  /** Current task state */
  current_state: TaskState;
  /** Whether task is blocked */
  is_blocked: boolean;
  /** Whether handoff is pending */
  is_handoff_pending: boolean;
  /** Valid target states */
  valid_transitions: TaskState[];
  /** Transitions with their reasons */
  transitions_with_reasons: Array<{
    to_state: TaskState;
    reason: TransitionReason;
    guard_requirements: TransitionGuardType[];
  }>;
}

/**
 * Result of checking if transition is allowed.
 */
export interface CanTransitionResult {
  /** Whether transition is allowed */
  allowed: boolean;
  /** Reasons why not allowed (if not allowed) */
  blockers: string[];
  /** Required guards and their status */
  guard_results: Array<{
    guard: TransitionGuardType;
    passed: boolean;
    reason?: string;
  }>;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Task lifecycle error codes.
 * Error codes in range 4100-4199 for LIFECYCLE_ERROR category.
 * Requirements: R04.5
 */
export enum LifecycleErrorCode {
  /** Invalid state transition attempted */
  INVALID_STATE_TRANSITION = 4101,
  /** Task not found */
  TASK_NOT_FOUND = 4102,
  /** Transition guard failed */
  GUARD_FAILED = 4103,
  /** Task is blocked */
  TASK_BLOCKED = 4104,
  /** Handoff is pending */
  HANDOFF_PENDING = 4105,
  /** DoR not validated */
  DOR_NOT_VALIDATED = 4106,
  /** No assignee */
  NO_ASSIGNEE = 4107,
  /** Blocking findings exist */
  BLOCKING_FINDINGS_EXIST = 4108,
  /** Required evidence missing */
  EVIDENCE_MISSING = 4109,
  /** Reopen justification required */
  REOPEN_JUSTIFICATION_REQUIRED = 4110,
  /** Blocker not specified */
  BLOCKER_NOT_SPECIFIED = 4111,
  /** Cannot unblock - blockers not resolved */
  BLOCKERS_NOT_RESOLVED = 4112,
  /** Invalid orthogonal attribute change */
  INVALID_ORTHOGONAL_CHANGE = 4113,
}

/**
 * Task lifecycle error structure.
 */
export interface LifecycleError {
  /** Error code */
  code: LifecycleErrorCode;
  /** Error category */
  category: 'LIFECYCLE_ERROR';
  /** Human-readable message */
  message: string;
  /** Additional context */
  context?: {
    task_id?: string;
    from_state?: TaskState;
    to_state?: TaskState;
    failed_guards?: TransitionGuardType[];
    blocker_refs?: string[];
    details?: string;
    [key: string]: unknown;
  };
  /** Whether recoverable */
  recoverable: boolean;
  /** Suggested action */
  suggested_action?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Creates a LifecycleError with the given code and details.
 */
export function createLifecycleError(
  code: LifecycleErrorCode,
  message: string,
  context?: LifecycleError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): LifecycleError {
  return {
    code,
    category: 'LIFECYCLE_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an "invalid state transition" error.
 * Requirements: R04.5
 */
export function invalidStateTransitionError(
  taskId: string,
  fromState: TaskState,
  toState: TaskState
): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.INVALID_STATE_TRANSITION,
    `Cannot transition task ${taskId} from '${fromState}' to '${toState}'`,
    {
      task_id: taskId,
      from_state: fromState,
      to_state: toState,
    },
    false,
    `Check valid transitions from '${fromState}' state`
  );
}

/**
 * Creates a "task not found" error.
 */
export function taskNotFoundError(taskId: string): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.TASK_NOT_FOUND,
    `Task ${taskId} not found`,
    { task_id: taskId },
    false,
    'Verify the task ID is correct'
  );
}

/**
 * Creates a "guard failed" error.
 */
export function guardFailedError(
  taskId: string,
  fromState: TaskState,
  toState: TaskState,
  failedGuards: TransitionGuardType[],
  details?: string
): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.GUARD_FAILED,
    `Transition guard(s) failed for task ${taskId}: ${failedGuards.join(', ')}`,
    {
      task_id: taskId,
      from_state: fromState,
      to_state: toState,
      failed_guards: failedGuards,
      details,
    },
    true,
    `Satisfy the following conditions: ${failedGuards.join(', ')}`
  );
}

/**
 * Creates a "task blocked" error.
 */
export function taskBlockedError(
  taskId: string,
  blockerRefs: string[]
): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.TASK_BLOCKED,
    `Task ${taskId} is blocked by: ${blockerRefs.join(', ')}`,
    {
      task_id: taskId,
      blocker_refs: blockerRefs,
    },
    true,
    'Resolve the blockers before transitioning'
  );
}

/**
 * Creates a "handoff pending" error.
 */
export function handoffPendingError(
  taskId: string,
  handoffId: string
): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.HANDOFF_PENDING,
    `Task ${taskId} has a pending handoff: ${handoffId}`,
    {
      task_id: taskId,
      details: `Handoff ID: ${handoffId}`,
    },
    true,
    'Complete or cancel the handoff before transitioning'
  );
}

/**
 * Creates a "DoR not validated" error.
 */
export function dorNotValidatedError(
  taskId: string,
  failedConditions: string[]
): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.DOR_NOT_VALIDATED,
    `Task ${taskId} does not meet Definition of Ready: ${failedConditions.join(', ')}`,
    {
      task_id: taskId,
      details: `Failed conditions: ${failedConditions.join(', ')}`,
    },
    true,
    'Ensure all DoR conditions are met before starting work'
  );
}

/**
 * Creates a "no assignee" error.
 */
export function noAssigneeError(taskId: string): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.NO_ASSIGNEE,
    `Task ${taskId} has no assignee`,
    { task_id: taskId },
    true,
    'Assign the task to a developer before starting work'
  );
}

/**
 * Creates a "blocking findings exist" error.
 */
export function blockingFindingsExistError(
  taskId: string,
  findingCount: number
): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.BLOCKING_FINDINGS_EXIST,
    `Task ${taskId} has ${findingCount} blocking finding(s) that must be resolved`,
    {
      task_id: taskId,
      details: `${findingCount} CRITICAL/HIGH findings exist`,
    },
    true,
    'Resolve all CRITICAL and HIGH severity findings before completing'
  );
}

/**
 * Creates a "reopen justification required" error.
 */
export function reopenJustificationRequiredError(taskId: string): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.REOPEN_JUSTIFICATION_REQUIRED,
    `Reopening task ${taskId} requires justification (reason and evidence)`,
    { task_id: taskId },
    true,
    'Provide a reason and evidence reference (issue ID, test failure) to reopen'
  );
}

/**
 * Creates a "blocker not specified" error.
 */
export function blockerNotSpecifiedError(taskId: string): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.BLOCKER_NOT_SPECIFIED,
    `Cannot mark task ${taskId} as blocked without specifying a blocker`,
    { task_id: taskId },
    true,
    'Specify at least one blocker reference (BLOCKER-xxx)'
  );
}

/**
 * Creates a "blockers not resolved" error.
 */
export function blockersNotResolvedError(
  taskId: string,
  unresolvedBlockers: string[]
): LifecycleError {
  return createLifecycleError(
    LifecycleErrorCode.BLOCKERS_NOT_RESOLVED,
    `Cannot unblock task ${taskId}: ${unresolvedBlockers.length} blocker(s) still open`,
    {
      task_id: taskId,
      blocker_refs: unresolvedBlockers,
    },
    true,
    `Resolve the following blockers: ${unresolvedBlockers.join(', ')}`
  );
}

// =============================================================================
// Transition Definitions
// =============================================================================

/**
 * All valid state transitions with their guards.
 * Requirements: R04.4
 */
export const TRANSITION_DEFINITIONS: TransitionDefinition[] = [
  // PENDING transitions
  { from: 'PENDING', to: 'READY', default_reason: 'dor_met', guards: ['dor_valid'] },
  { from: 'PENDING', to: 'CANCELLED', default_reason: 'cancelled', guards: [] },
  { from: 'PENDING', to: 'SUPERSEDED', default_reason: 'superseded', guards: [] },
  
  // READY transitions
  { from: 'READY', to: 'ASSIGNED', default_reason: 'assignee_set', guards: ['has_assignee'] },
  { from: 'READY', to: 'CANCELLED', default_reason: 'cancelled', guards: [] },
  { from: 'READY', to: 'SUPERSEDED', default_reason: 'superseded', guards: [] },
  
  // ASSIGNED transitions
  { from: 'ASSIGNED', to: 'IN_PROGRESS', default_reason: 'work_started', guards: ['dor_valid', 'not_blocked', 'handoff_not_pending'] },
  { from: 'ASSIGNED', to: 'READY', default_reason: 'unassigned', guards: [] },
  { from: 'ASSIGNED', to: 'CANCELLED', default_reason: 'cancelled', guards: [] },
  { from: 'ASSIGNED', to: 'SUPERSEDED', default_reason: 'superseded', guards: [] },
  
  // IN_PROGRESS transitions
  { from: 'IN_PROGRESS', to: 'REVIEW', default_reason: 'implementation_done', guards: ['has_required_evidence', 'not_blocked', 'handoff_not_pending'] },
  { from: 'IN_PROGRESS', to: 'CANCELLED', default_reason: 'cancelled', guards: [] },
  
  // REVIEW transitions
  { from: 'REVIEW', to: 'CHANGES_REQUESTED', default_reason: 'changes_requested', guards: [] },
  { from: 'REVIEW', to: 'READY_TO_MERGE', default_reason: 'approved', guards: ['no_blocking_findings'] },
  { from: 'REVIEW', to: 'CANCELLED', default_reason: 'cancelled', guards: [] },
  
  // CHANGES_REQUESTED transitions
  { from: 'CHANGES_REQUESTED', to: 'IN_PROGRESS', default_reason: 'addressing_changes', guards: [] },
  
  // READY_TO_MERGE transitions
  { from: 'READY_TO_MERGE', to: 'INTEGRATED', default_reason: 'merged', guards: [] },
  { from: 'READY_TO_MERGE', to: 'CHANGES_REQUESTED', default_reason: 'merge_failed', guards: [] },
  { from: 'READY_TO_MERGE', to: 'CANCELLED', default_reason: 'cancelled', guards: [] },
  
  // INTEGRATED transitions
  { from: 'INTEGRATED', to: 'DONE', default_reason: 'verified', guards: ['no_blocking_findings'] },
  { from: 'INTEGRATED', to: 'IN_PROGRESS', default_reason: 'verification_failed', guards: [] },
  
  // DONE transitions (special - requires justification)
  { from: 'DONE', to: 'IN_PROGRESS', default_reason: 'reopened', guards: ['reopen_justification'] },
];

/**
 * Blocked state transitions (orthogonal).
 * Any blockable state can transition to its blocked version.
 * Requirements: R04.2
 */
export const BLOCKED_TRANSITIONS: Array<{ state: BlockableState }> = [
  { state: 'PENDING' },
  { state: 'READY' },
  { state: 'ASSIGNED' },
  { state: 'IN_PROGRESS' },
  { state: 'REVIEW' },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Checks if a state is valid.
 */
export function isValidState(state: string): state is TaskState {
  return TASK_STATES.includes(state as TaskState);
}

/**
 * Checks if a state is terminal.
 */
export function isTerminalState(state: TaskState): state is TerminalState {
  return TERMINAL_STATES.includes(state as TerminalState);
}

/**
 * Checks if a state can be blocked.
 */
export function isBlockableState(state: TaskState): state is BlockableState {
  return BLOCKABLE_STATES.includes(state as BlockableState);
}

/**
 * Checks if a state can have handoff pending.
 */
export function isHandoffPendingState(state: TaskState): state is HandoffPendingState {
  return HANDOFF_PENDING_STATES.includes(state as HandoffPendingState);
}

/**
 * Gets the transition definition for a given from/to pair.
 */
export function getTransitionDefinition(
  fromState: TaskState,
  toState: TaskState
): TransitionDefinition | null {
  return TRANSITION_DEFINITIONS.find(
    t => t.from === fromState && t.to === toState
  ) ?? null;
}

/**
 * Gets all valid transitions from a given state.
 */
export function getValidTransitionsFrom(state: TaskState): TransitionDefinition[] {
  return TRANSITION_DEFINITIONS.filter(t => t.from === state);
}

/**
 * Creates an empty blocked status.
 */
export function createEmptyBlockedStatus(): BlockedStatus {
  return {
    blocked: false,
    blocked_reason: null,
    blocker_refs: [],
    blocked_since: null,
    blocked_phase: null,
  };
}

/**
 * Creates a blocked status.
 */
export function createBlockedStatus(
  reason: string,
  blockerRefs: string[],
  currentState: TaskState
): BlockedStatus {
  return {
    blocked: true,
    blocked_reason: reason,
    blocker_refs: blockerRefs,
    blocked_since: new Date().toISOString(),
    blocked_phase: currentState,
  };
}

/**
 * Creates an empty handoff pending status.
 */
export function createEmptyHandoffStatus(): HandoffPendingStatus {
  return {
    handoff_pending: false,
    handoff_id: null,
    handoff_initiated_at: null,
  };
}

/**
 * Creates a handoff pending status.
 */
export function createHandoffPendingStatus(handoffId: string): HandoffPendingStatus {
  return {
    handoff_pending: true,
    handoff_id: handoffId,
    handoff_initiated_at: new Date().toISOString(),
  };
}

/**
 * Creates a state history entry.
 */
export function createStateHistoryEntry(
  fromState: TaskState,
  toState: TaskState,
  reason: TransitionReason,
  triggeredBy: string,
  context?: string,
  blockedChanged?: { from: boolean; to: boolean },
  handoffPendingChanged?: { from: boolean; to: boolean }
): StateHistoryEntry {
  const entry: StateHistoryEntry = {
    from_state: fromState,
    to_state: toState,
    transitioned_at: new Date().toISOString(),
    reason,
    triggered_by: triggeredBy,
  };
  
  if (context) {
    entry.context = context;
  }
  
  if (blockedChanged) {
    entry.blocked_changed = blockedChanged;
  }
  
  if (handoffPendingChanged) {
    entry.handoff_pending_changed = handoffPendingChanged;
  }
  
  return entry;
}

/**
 * Creates an initial task for lifecycle.
 */
export function createInitialTaskForLifecycle(
  taskId: string,
  initialState: TaskState = 'PENDING'
): TaskForLifecycle {
  return {
    id: taskId,
    status: initialState,
    assignee: null,
    blocked_status: createEmptyBlockedStatus(),
    handoff_status: createEmptyHandoffStatus(),
    state_history: [],
    evidence_refs: [],
    has_blocking_findings: false,
    blocking_finding_ids: [],
  };
}

/**
 * Checks if a state is a valid target for reopen operation.
 * Requirements: R04.7
 */
export function isValidReopenTargetState(state: TaskState): boolean {
  return VALID_REOPEN_TARGET_STATES.includes(state);
}

/**
 * Creates a reopen justification object.
 * Requirements: R04.7
 */
export function createReopenJustification(
  reason: string,
  evidenceRef: string,
  targetState?: TaskState
): ReopenJustification {
  return {
    reason,
    evidence_ref: evidenceRef,
    target_state: targetState,
  };
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for transition operation.
 */
export type TransitionToResult = Result<TransitionResult, LifecycleError>;

/**
 * Result type for reopen task operation.
 */
export type ReopenTaskResultType = Result<ReopenTaskResult, LifecycleError>;

/**
 * Result type for can transition check.
 */
export type CanTransitionToResult = Result<CanTransitionResult, LifecycleError>;

/**
 * Result type for valid transitions query.
 */
export type GetValidTransitionsResult = Result<ValidTransitionsResult, LifecycleError>;

/**
 * Result type for set blocked operation.
 */
export type SetBlockedResult = Result<TransitionResult, LifecycleError>;

/**
 * Result type for set handoff pending operation.
 */
export type SetHandoffPendingResult = Result<TransitionResult, LifecycleError>;

// =============================================================================
// Task Lifecycle Manager Interface
// =============================================================================

/**
 * TaskLifecycleManager interface for managing task state transitions.
 * 
 * This component ensures:
 * - All task states from R04.1 are supported
 * - BLOCKED and HANDOFF_PENDING are orthogonal attributes
 * - Transition guards are enforced
 * - State history is tracked
 * 
 * Requirements: R04.1, R04.4, R04.5
 */
export interface TaskLifecycleManager {
  // =========================================================================
  // Transition Operations
  // =========================================================================

  /**
   * Transitions a task to a new state.
   * 
   * Requirements: R04.4, R04.5
   * 
   * @param request - Transition request details
   * @returns Result with TransitionResult on success, or LifecycleError on failure
   * 
   * Behavior:
   * - Validates transition is allowed (from current state to target state)
   * - Executes transition guards
   * - Updates task state
   * - Records state history
   * 
   * Errors:
   * - INVALID_STATE_TRANSITION: If transition not defined
   * - GUARD_FAILED: If transition guard fails
   * - TASK_NOT_FOUND: If task doesn't exist
   * - TASK_BLOCKED: If task is blocked and transition requires not_blocked
   * - HANDOFF_PENDING: If handoff is pending and transition requires handoff_not_pending
   */
  transitionTo(request: TransitionRequest): Promise<TransitionToResult>;

  /**
   * Reopens a task from DONE state.
   * 
   * Requirements: R04.7
   * 
   * @param request - Reopen request with justification
   * @returns Result with ReopenTaskResult on success, or LifecycleError on failure
   * 
   * Behavior:
   * - Validates task is in DONE state
   * - Validates justification includes reason and evidence
   * - Supports configurable target state (defaults to IN_PROGRESS)
   * - Clears blocking findings flag
   * - Records full justification in state history
   * 
   * Errors:
   * - TASK_NOT_FOUND: If task doesn't exist
   * - INVALID_STATE_TRANSITION: If task is not in DONE state
   * - REOPEN_JUSTIFICATION_REQUIRED: If justification is incomplete
   */
  reopenTask(request: ReopenTaskRequest): Promise<ReopenTaskResultType>;

  /**
   * Checks if a transition is valid without executing it.
   * 
   * @param taskId - Task to check
   * @param targetState - Target state to check
   * @returns Result with CanTransitionResult on success, or LifecycleError on failure
   * 
   * Behavior:
   * - Checks if transition is defined
   * - Evaluates all guards
   * - Returns detailed guard results
   */
  canTransition(taskId: string, targetState: TaskState): Promise<CanTransitionToResult>;

  /**
   * Gets all valid transitions from current state.
   * 
   * @param taskId - Task to check
   * @returns Result with ValidTransitionsResult on success, or LifecycleError on failure
   * 
   * Behavior:
   * - Returns all defined transitions from current state
   * - Includes guard requirements for each transition
   * - Considers blocked and handoff_pending attributes
   */
  getValidTransitions(taskId: string): Promise<GetValidTransitionsResult>;

  // =========================================================================
  // Orthogonal Attribute Operations
  // =========================================================================

  /**
   * Sets the BLOCKED orthogonal attribute on a task.
   * 
   * Requirements: R04.2
   * 
   * @param taskId - Task to block
   * @param blocked - Whether to block or unblock
   * @param info - Blocker information (required when blocking)
   * @returns Result with TransitionResult on success, or LifecycleError on failure
   * 
   * Behavior:
   * - When blocking: sets blocked=true, records blocker info
   * - When unblocking: validates all blockers resolved, sets blocked=false
   * - Records change in state history
   * 
   * Errors:
   * - INVALID_ORTHOGONAL_CHANGE: If state doesn't support blocking
   * - BLOCKER_NOT_SPECIFIED: If blocking without blocker info
   * - BLOCKERS_NOT_RESOLVED: If unblocking with unresolved blockers
   */
  setBlocked(
    taskId: string,
    blocked: boolean,
    info?: { reason: string; blocker_refs: string[] },
    triggeredBy?: string
  ): Promise<SetBlockedResult>;

  /**
   * Sets the HANDOFF_PENDING orthogonal attribute on a task.
   * 
   * Requirements: R04.3
   * 
   * @param taskId - Task to set handoff pending
   * @param pending - Whether handoff is pending
   * @param handoffId - Handoff ID (required when setting pending=true)
   * @returns Result with TransitionResult on success, or LifecycleError on failure
   * 
   * Behavior:
   * - When setting pending: sets handoff_pending=true, records handoff ID
   * - When clearing: sets handoff_pending=false
   * - Records change in state history
   * 
   * Errors:
   * - INVALID_ORTHOGONAL_CHANGE: If state doesn't support handoff pending
   */
  setHandoffPending(
    taskId: string,
    pending: boolean,
    handoffId?: string,
    triggeredBy?: string
  ): Promise<SetHandoffPendingResult>;

  // =========================================================================
  // Query Operations
  // =========================================================================

  /**
   * Gets the current state of a task including orthogonal attributes.
   * 
   * @param taskId - Task to query
   * @returns The task lifecycle data or null if not found
   */
  getTaskState(taskId: string): Promise<TaskForLifecycle | null>;

  /**
   * Gets the state history for a task.
   * 
   * @param taskId - Task to query
   * @returns Array of state history entries (empty if not found)
   */
  getStateHistory(taskId: string): Promise<StateHistoryEntry[]>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for TaskLifecycleManager implementation.
 */
export interface TaskLifecycleManagerConfig {
  /** Maximum history entries to keep per task */
  maxHistoryEntries?: number;
  /** Whether to require evidence for REVIEW transition */
  requireEvidenceForReview?: boolean;
  /** Whether to require DoR for IN_PROGRESS transition */
  requireDorForInProgress?: boolean;
  /** Whether to require findings check for DONE transition */
  requireFindingsCheckForDone?: boolean;
  /** Optional audit logger for logging state transitions */
  auditLogger?: AuditLogger;
}

/**
 * Creates default configuration.
 */
export function createDefaultTaskLifecycleConfig(): TaskLifecycleManagerConfig {
  return {
    maxHistoryEntries: TASK_LIFECYCLE_DEFAULTS.MAX_HISTORY_ENTRIES,
    requireEvidenceForReview: TASK_LIFECYCLE_DEFAULTS.REQUIRE_EVIDENCE_FOR_REVIEW,
    requireDorForInProgress: TASK_LIFECYCLE_DEFAULTS.REQUIRE_DOR_FOR_IN_PROGRESS,
    requireFindingsCheckForDone: TASK_LIFECYCLE_DEFAULTS.REQUIRE_FINDINGS_CHECK_FOR_DONE,
  };
}

// =============================================================================
// External Dependencies Interface
// =============================================================================

/**
 * Task storage interface for lifecycle manager.
 */
export interface TaskStorageForLifecycle {
  /** Gets a task by ID */
  getTask(taskId: string): Promise<TaskForLifecycle | null>;
  /** Updates a task */
  updateTask(task: TaskForLifecycle): Promise<void>;
}

/**
 * DoR validator interface for lifecycle manager.
 */
export interface DoRValidatorForLifecycle {
  /** Validates DoR for a task */
  canStartWork(taskId: string): Promise<Result<CanStartWorkResult, { message: string }>>;
}

/**
 * Findings checker interface for lifecycle manager.
 * Provides integration between FindingRegister and TaskLifecycleManager.
 * Requirements: R11.5
 */
export interface FindingsCheckerForLifecycle {
  /** 
   * Checks if task has blocking findings (CRITICAL/HIGH severity, OPEN/IN_PROGRESS status).
   * @param taskId - Task ID to check
   * @returns true if blocking findings exist
   */
  hasBlockingFindings(taskId: string): Promise<boolean>;
  
  /**
   * Gets the IDs of blocking findings for a task.
   * Blocking findings are CRITICAL/HIGH severity with OPEN/IN_PROGRESS status.
   * @param taskId - Task ID to get blocking finding IDs for
   * @returns Array of blocking finding IDs
   */
  getBlockingFindingIds?(taskId: string): Promise<string[]>;
  
  /**
   * Gets count of blocking findings by severity.
   * @param taskId - Task ID to get counts for
   * @returns Object with critical and high counts
   */
  getBlockingFindingCounts?(taskId: string): Promise<{ critical: number; high: number }>;
}

/**
 * Blocker checker interface for lifecycle manager.
 */
export interface BlockerCheckerForLifecycle {
  /** Checks if blockers are resolved */
  areBlockersResolved(blockerRefs: string[]): Promise<boolean>;
  /** Gets unresolved blocker IDs */
  getUnresolvedBlockers(blockerRefs: string[]): Promise<string[]>;
}

// =============================================================================
// TaskLifecycleManagerImpl Implementation
// =============================================================================

/**
 * Dependencies for TaskLifecycleManagerImpl.
 */
export interface TaskLifecycleManagerDependencies {
  /** Task storage */
  taskStorage: TaskStorageForLifecycle;
  /** DoR validator (optional - guards will pass if not provided) */
  dorValidator?: DoRValidatorForLifecycle;
  /** Findings checker (optional - guards will pass if not provided) */
  findingsChecker?: FindingsCheckerForLifecycle;
  /** Blocker checker (optional - guards will pass if not provided) */
  blockerChecker?: BlockerCheckerForLifecycle;
  /** Configuration */
  config?: TaskLifecycleManagerConfig;
}

/**
 * Concrete implementation of TaskLifecycleManager.
 * 
 * Requirements: R04.1, R04.4, R04.5
 */
export class TaskLifecycleManagerImpl implements TaskLifecycleManager {
  private readonly taskStorage: TaskStorageForLifecycle;
  private readonly dorValidator?: DoRValidatorForLifecycle;
  private readonly findingsChecker?: FindingsCheckerForLifecycle;
  private readonly blockerChecker?: BlockerCheckerForLifecycle;
  private readonly config: Required<Omit<TaskLifecycleManagerConfig, 'auditLogger'>>;
  private readonly auditLogger?: AuditLogger;

  constructor(deps: TaskLifecycleManagerDependencies) {
    this.taskStorage = deps.taskStorage;
    this.dorValidator = deps.dorValidator;
    this.findingsChecker = deps.findingsChecker;
    this.blockerChecker = deps.blockerChecker;
    this.auditLogger = deps.config?.auditLogger;
    this.config = {
      maxHistoryEntries: deps.config?.maxHistoryEntries ?? TASK_LIFECYCLE_DEFAULTS.MAX_HISTORY_ENTRIES,
      requireEvidenceForReview: deps.config?.requireEvidenceForReview ?? TASK_LIFECYCLE_DEFAULTS.REQUIRE_EVIDENCE_FOR_REVIEW,
      requireDorForInProgress: deps.config?.requireDorForInProgress ?? TASK_LIFECYCLE_DEFAULTS.REQUIRE_DOR_FOR_IN_PROGRESS,
      requireFindingsCheckForDone: deps.config?.requireFindingsCheckForDone ?? TASK_LIFECYCLE_DEFAULTS.REQUIRE_FINDINGS_CHECK_FOR_DONE,
    };
  }

  // =========================================================================
  // Audit Logging Helper
  // =========================================================================

  /**
   * Logs a state transition event to the audit logger (fire-and-forget).
   */
  private logStateTransition(
    taskId: string,
    fromState: TaskState,
    toState: TaskState,
    triggeredBy: string,
    reason?: string
  ): void {
    if (!this.auditLogger) return;

    const entry = createAuditEntry({
      actor_id: triggeredBy,
      actor_type: 'HUMAN', // Default to HUMAN, could be enhanced
      action: 'TASK_STATUS_CHANGE',
      resource_type: 'Task',
      resource_id: taskId,
      changes: {
        status: { from: fromState, to: toState },
      },
      reason,
      outcome: 'SUCCESS',
    });

    // Fire-and-forget
    this.auditLogger.log(entry).catch(() => {
      // Silently ignore audit log failures
    });
  }

  // =========================================================================
  // Transition Operations
  // =========================================================================

  async transitionTo(request: TransitionRequest): Promise<TransitionToResult> {
    const task = await this.taskStorage.getTask(request.task_id);
    if (!task) {
      return err(taskNotFoundError(request.task_id));
    }

    const fromState = task.status;
    const toState = request.to_state;

    // Check if transition is defined
    const transitionDef = getTransitionDefinition(fromState, toState);
    if (!transitionDef) {
      return err(invalidStateTransitionError(request.task_id, fromState, toState));
    }

    // Evaluate guards
    const guardResult = await this.evaluateGuards(task, transitionDef, request);
    if (!guardResult.passed) {
      return err(guardFailedError(
        request.task_id,
        fromState,
        toState,
        guardResult.failedGuards,
        guardResult.failureReason
      ));
    }

    // Determine reason
    const reason = request.reason ?? transitionDef.default_reason;

    // Create history entry
    const historyEntry = createStateHistoryEntry(
      fromState,
      toState,
      reason,
      request.triggered_by,
      request.context
    );

    // Update task
    const updatedTask: TaskForLifecycle = {
      ...task,
      status: toState,
      state_history: this.trimHistory([...task.state_history, historyEntry]),
    };

    // Clear orthogonal attributes on terminal states
    if (isTerminalState(toState)) {
      updatedTask.blocked_status = createEmptyBlockedStatus();
      updatedTask.handoff_status = createEmptyHandoffStatus();
    }

    await this.taskStorage.updateTask(updatedTask);

    // Log the state transition
    this.logStateTransition(
      request.task_id,
      fromState,
      toState,
      request.triggered_by,
      request.context || reason
    );

    return ok({
      task_id: request.task_id,
      from_state: fromState,
      to_state: toState,
      transitioned_at: historyEntry.transitioned_at,
      history_entry: historyEntry,
      blocked_status: updatedTask.blocked_status,
      handoff_status: updatedTask.handoff_status,
    });
  }

  async canTransition(taskId: string, targetState: TaskState): Promise<CanTransitionToResult> {
    const task = await this.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    const fromState = task.status;
    const transitionDef = getTransitionDefinition(fromState, targetState);
    
    if (!transitionDef) {
      return ok({
        allowed: false,
        blockers: [`No transition defined from '${fromState}' to '${targetState}'`],
        guard_results: [],
      });
    }

    const guardResults: CanTransitionResult['guard_results'] = [];
    const blockers: string[] = [];

    // Evaluate each guard
    for (const guard of transitionDef.guards) {
      const result = await this.evaluateSingleGuard(task, guard);
      guardResults.push({
        guard,
        passed: result.passed,
        reason: result.reason,
      });
      if (!result.passed) {
        blockers.push(result.reason ?? `Guard '${guard}' failed`);
      }
    }

    return ok({
      allowed: blockers.length === 0,
      blockers,
      guard_results: guardResults,
    });
  }

  async getValidTransitions(taskId: string): Promise<GetValidTransitionsResult> {
    const task = await this.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    const currentState = task.status;
    const validDefs = getValidTransitionsFrom(currentState);

    const transitionsWithReasons = validDefs.map(def => ({
      to_state: def.to,
      reason: def.default_reason,
      guard_requirements: def.guards,
    }));

    return ok({
      current_state: currentState,
      is_blocked: task.blocked_status.blocked,
      is_handoff_pending: task.handoff_status.handoff_pending,
      valid_transitions: validDefs.map(d => d.to),
      transitions_with_reasons: transitionsWithReasons,
    });
  }

  // =========================================================================
  // Reopen Operations (R04.7)
  // =========================================================================

  async reopenTask(request: ReopenTaskRequest): Promise<ReopenTaskResultType> {
    const task = await this.taskStorage.getTask(request.task_id);
    if (!task) {
      return err(taskNotFoundError(request.task_id));
    }

    // Validate task is in DONE state
    if (task.status !== 'DONE') {
      return err(createLifecycleError(
        LifecycleErrorCode.INVALID_STATE_TRANSITION,
        `Cannot reopen task ${request.task_id}: task is not in DONE state (current: ${task.status})`,
        {
          task_id: request.task_id,
          from_state: task.status,
          to_state: 'IN_PROGRESS',
          details: 'Only tasks in DONE state can be reopened',
        },
        false,
        'Task must be in DONE state to be reopened'
      ));
    }

    // Validate justification
    const validationResult = this.validateReopenJustification(request.justification);
    if (!validationResult.valid) {
      return err(createLifecycleError(
        LifecycleErrorCode.REOPEN_JUSTIFICATION_REQUIRED,
        `Reopening task ${request.task_id} requires valid justification: ${validationResult.error}`,
        {
          task_id: request.task_id,
          details: validationResult.error,
        },
        true,
        'Provide a non-empty reason and evidence reference (issue ID, test failure ID)'
      ));
    }

    // Determine target state
    const targetState = request.justification.target_state ?? 'IN_PROGRESS';

    // Validate target state is valid for reopen
    if (!VALID_REOPEN_TARGET_STATES.includes(targetState)) {
      return err(createLifecycleError(
        LifecycleErrorCode.INVALID_STATE_TRANSITION,
        `Invalid reopen target state: ${targetState}`,
        {
          task_id: request.task_id,
          to_state: targetState,
          details: `Valid target states: ${VALID_REOPEN_TARGET_STATES.join(', ')}`,
        },
        true,
        `Choose one of: ${VALID_REOPEN_TARGET_STATES.join(', ')}`
      ));
    }

    // Create reopen history entry with full justification
    const historyEntry = this.createReopenHistoryEntry(
      task.status,
      targetState,
      request.triggered_by,
      request.justification
    );

    // Clear blocking findings flag when reopening
    const blockingFindingsCleared = task.has_blocking_findings ?? false;

    // Update task
    const updatedTask: TaskForLifecycle = {
      ...task,
      status: targetState,
      state_history: this.trimHistory([...task.state_history, historyEntry]),
      // Clear blocking findings flag - task is being reopened
      has_blocking_findings: false,
      // Clear orthogonal attributes since we're transitioning from terminal state
      blocked_status: createEmptyBlockedStatus(),
      handoff_status: createEmptyHandoffStatus(),
    };

    await this.taskStorage.updateTask(updatedTask);

    return ok({
      task_id: request.task_id,
      from_state: 'DONE',
      to_state: targetState,
      transitioned_at: historyEntry.transitioned_at,
      history_entry: historyEntry,
      blocked_status: updatedTask.blocked_status,
      handoff_status: updatedTask.handoff_status,
      justification: request.justification,
      blocking_findings_cleared: blockingFindingsCleared,
    });
  }

  /**
   * Validates reopen justification.
   */
  private validateReopenJustification(
    justification: ReopenJustification
  ): { valid: boolean; error?: string } {
    if (!justification) {
      return { valid: false, error: 'Justification is required' };
    }

    if (!justification.reason || justification.reason.trim().length === 0) {
      return { valid: false, error: 'Reason is required and cannot be empty' };
    }

    if (!justification.evidence_ref || justification.evidence_ref.trim().length === 0) {
      return { valid: false, error: 'Evidence reference is required (issue ID, test failure ID, etc.)' };
    }

    return { valid: true };
  }

  /**
   * Creates a history entry for reopen operation with full justification.
   */
  private createReopenHistoryEntry(
    fromState: TaskState,
    toState: TaskState,
    triggeredBy: string,
    justification: ReopenJustification
  ): StateHistoryEntry {
    return {
      from_state: fromState,
      to_state: toState,
      transitioned_at: new Date().toISOString(),
      reason: 'reopened',
      triggered_by: triggeredBy,
      context: `Reopened: ${justification.reason} (Evidence: ${justification.evidence_ref})`,
    };
  }

  // =========================================================================
  // Orthogonal Attribute Operations
  // =========================================================================

  async setBlocked(
    taskId: string,
    blocked: boolean,
    info?: { reason: string; blocker_refs: string[] },
    triggeredBy: string = 'SYSTEM'
  ): Promise<SetBlockedResult> {
    const task = await this.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Check if state supports blocking
    if (!isBlockableState(task.status)) {
      return err(createLifecycleError(
        LifecycleErrorCode.INVALID_ORTHOGONAL_CHANGE,
        `State '${task.status}' does not support BLOCKED attribute`,
        { task_id: taskId, from_state: task.status },
        false,
        `BLOCKED can only be applied to: ${BLOCKABLE_STATES.join(', ')}`
      ));
    }

    if (blocked) {
      // Setting blocked
      if (!info || !info.reason || info.blocker_refs.length === 0) {
        return err(blockerNotSpecifiedError(taskId));
      }

      const newBlockedStatus = createBlockedStatus(
        info.reason,
        info.blocker_refs,
        task.status
      );

      const historyEntry = createStateHistoryEntry(
        task.status,
        task.status,
        'blocker_added',
        triggeredBy,
        `Blocked: ${info.reason}`,
        { from: task.blocked_status.blocked, to: true }
      );

      const updatedTask: TaskForLifecycle = {
        ...task,
        blocked_status: newBlockedStatus,
        state_history: this.trimHistory([...task.state_history, historyEntry]),
      };

      await this.taskStorage.updateTask(updatedTask);

      return ok({
        task_id: taskId,
        from_state: task.status,
        to_state: task.status,
        transitioned_at: historyEntry.transitioned_at,
        history_entry: historyEntry,
        blocked_status: newBlockedStatus,
      });
    } else {
      // Clearing blocked
      if (task.blocked_status.blocker_refs.length > 0 && this.blockerChecker) {
        const unresolvedBlockers = await this.blockerChecker.getUnresolvedBlockers(
          task.blocked_status.blocker_refs
        );
        if (unresolvedBlockers.length > 0) {
          return err(blockersNotResolvedError(taskId, unresolvedBlockers));
        }
      }

      const historyEntry = createStateHistoryEntry(
        task.status,
        task.status,
        'blocker_resolved',
        triggeredBy,
        'All blockers resolved',
        { from: task.blocked_status.blocked, to: false }
      );

      const updatedTask: TaskForLifecycle = {
        ...task,
        blocked_status: createEmptyBlockedStatus(),
        state_history: this.trimHistory([...task.state_history, historyEntry]),
      };

      await this.taskStorage.updateTask(updatedTask);

      return ok({
        task_id: taskId,
        from_state: task.status,
        to_state: task.status,
        transitioned_at: historyEntry.transitioned_at,
        history_entry: historyEntry,
        blocked_status: updatedTask.blocked_status,
      });
    }
  }

  async setHandoffPending(
    taskId: string,
    pending: boolean,
    handoffId?: string,
    triggeredBy: string = 'SYSTEM'
  ): Promise<SetHandoffPendingResult> {
    const task = await this.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Check if state supports handoff pending
    if (!isHandoffPendingState(task.status)) {
      return err(createLifecycleError(
        LifecycleErrorCode.INVALID_ORTHOGONAL_CHANGE,
        `State '${task.status}' does not support HANDOFF_PENDING attribute`,
        { task_id: taskId, from_state: task.status },
        false,
        `HANDOFF_PENDING can only be applied to: ${HANDOFF_PENDING_STATES.join(', ')}`
      ));
    }

    if (pending) {
      if (!handoffId) {
        return err(createLifecycleError(
          LifecycleErrorCode.INVALID_ORTHOGONAL_CHANGE,
          'Handoff ID is required when setting handoff_pending=true',
          { task_id: taskId },
          true,
          'Provide a handoff ID'
        ));
      }

      const newHandoffStatus = createHandoffPendingStatus(handoffId);

      const historyEntry = createStateHistoryEntry(
        task.status,
        task.status,
        'handoff_initiated',
        triggeredBy,
        `Handoff initiated: ${handoffId}`,
        undefined,
        { from: task.handoff_status.handoff_pending, to: true }
      );

      const updatedTask: TaskForLifecycle = {
        ...task,
        handoff_status: newHandoffStatus,
        state_history: this.trimHistory([...task.state_history, historyEntry]),
      };

      await this.taskStorage.updateTask(updatedTask);

      return ok({
        task_id: taskId,
        from_state: task.status,
        to_state: task.status,
        transitioned_at: historyEntry.transitioned_at,
        history_entry: historyEntry,
        handoff_status: newHandoffStatus,
      });
    } else {
      const reason: TransitionReason = task.handoff_status.handoff_pending
        ? 'handoff_complete'
        : 'handoff_cancelled';

      const historyEntry = createStateHistoryEntry(
        task.status,
        task.status,
        reason,
        triggeredBy,
        'Handoff cleared',
        undefined,
        { from: task.handoff_status.handoff_pending, to: false }
      );

      const updatedTask: TaskForLifecycle = {
        ...task,
        handoff_status: createEmptyHandoffStatus(),
        state_history: this.trimHistory([...task.state_history, historyEntry]),
      };

      await this.taskStorage.updateTask(updatedTask);

      return ok({
        task_id: taskId,
        from_state: task.status,
        to_state: task.status,
        transitioned_at: historyEntry.transitioned_at,
        history_entry: historyEntry,
        handoff_status: updatedTask.handoff_status,
      });
    }
  }

  // =========================================================================
  // Query Operations
  // =========================================================================

  async getTaskState(taskId: string): Promise<TaskForLifecycle | null> {
    return this.taskStorage.getTask(taskId);
  }

  async getStateHistory(taskId: string): Promise<StateHistoryEntry[]> {
    const task = await this.taskStorage.getTask(taskId);
    return task?.state_history ?? [];
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private async evaluateGuards(
    task: TaskForLifecycle,
    transitionDef: TransitionDefinition,
    request: TransitionRequest
  ): Promise<{ passed: boolean; failedGuards: TransitionGuardType[]; failureReason?: string }> {
    const failedGuards: TransitionGuardType[] = [];
    let failureReason: string | undefined;

    for (const guard of transitionDef.guards) {
      const result = await this.evaluateSingleGuard(task, guard, request);
      if (!result.passed) {
        failedGuards.push(guard);
        if (!failureReason) {
          failureReason = result.reason;
        }
      }
    }

    return {
      passed: failedGuards.length === 0,
      failedGuards,
      failureReason,
    };
  }

  private async evaluateSingleGuard(
    task: TaskForLifecycle,
    guard: TransitionGuardType,
    request?: TransitionRequest
  ): Promise<{ passed: boolean; reason?: string }> {
    switch (guard) {
      case 'dor_valid':
        if (!this.config.requireDorForInProgress) {
          return { passed: true };
        }
        if (this.dorValidator) {
          const result = await this.dorValidator.canStartWork(task.id);
          if (result.success) {
            return { passed: result.value.allowed, reason: result.value.blockers.join(', ') };
          }
          return { passed: false, reason: result.error.message };
        }
        // If no DoR validator, check if we have cached validation
        if (task.dor_validation) {
          return { 
            passed: task.dor_validation.passed, 
            reason: task.dor_validation.passed ? undefined : 'DoR not met' 
          };
        }
        return { passed: true }; // No validator, assume passed

      case 'has_assignee':
        return {
          passed: task.assignee !== null,
          reason: task.assignee === null ? 'Task has no assignee' : undefined,
        };

      case 'no_blocking_findings':
        if (!this.config.requireFindingsCheckForDone) {
          return { passed: true };
        }
        if (this.findingsChecker) {
          const hasBlocking = await this.findingsChecker.hasBlockingFindings(task.id);
          if (hasBlocking) {
            // Try to get more detailed info if available
            let detailedReason = 'Task has blocking findings (CRITICAL/HIGH)';
            if (this.findingsChecker.getBlockingFindingIds) {
              const blockingIds = await this.findingsChecker.getBlockingFindingIds(task.id);
              if (blockingIds.length > 0) {
                detailedReason = `Task has ${blockingIds.length} blocking finding(s): ${blockingIds.join(', ')}`;
              }
            }
            if (this.findingsChecker.getBlockingFindingCounts) {
              const counts = await this.findingsChecker.getBlockingFindingCounts(task.id);
              if (counts.critical > 0 || counts.high > 0) {
                detailedReason = `Task has blocking findings: ${counts.critical} CRITICAL, ${counts.high} HIGH`;
              }
            }
            return {
              passed: false,
              reason: detailedReason,
            };
          }
          return { passed: true };
        }
        // Fallback to cached has_blocking_findings if no checker
        if (task.has_blocking_findings) {
          const blockingIds = task.blocking_finding_ids ?? [];
          const reason = blockingIds.length > 0
            ? `Task has blocking findings: ${blockingIds.join(', ')}`
            : 'Task has blocking findings';
          return { passed: false, reason };
        }
        return { passed: true };

      case 'has_required_evidence':
        if (!this.config.requireEvidenceForReview) {
          return { passed: true };
        }
        const hasEvidence = task.evidence_refs && task.evidence_refs.length > 0;
        return {
          passed: hasEvidence,
          reason: hasEvidence ? undefined : 'No evidence collected for this task',
        };

      case 'not_blocked':
        return {
          passed: !task.blocked_status.blocked,
          reason: task.blocked_status.blocked 
            ? `Task is blocked: ${task.blocked_status.blocked_reason}` 
            : undefined,
        };

      case 'handoff_not_pending':
        return {
          passed: !task.handoff_status.handoff_pending,
          reason: task.handoff_status.handoff_pending
            ? `Handoff pending: ${task.handoff_status.handoff_id}`
            : undefined,
        };

      case 'reopen_justification':
        const hasJustification = request?.reopen_justification?.reason && 
          request.reopen_justification.reason.trim().length > 0;
        return {
          passed: hasJustification,
          reason: hasJustification ? undefined : 'Reopen requires justification (reason and evidence)',
        };

      case 'blocker_specified':
        const hasBlocker = request?.blocker_info?.blocker_refs && 
          request.blocker_info.blocker_refs.length > 0;
        return {
          passed: hasBlocker,
          reason: hasBlocker ? undefined : 'Blocker must be specified',
        };

      case 'blocker_resolved':
        if (this.blockerChecker && task.blocked_status.blocker_refs.length > 0) {
          const resolved = await this.blockerChecker.areBlockersResolved(
            task.blocked_status.blocker_refs
          );
          return {
            passed: resolved,
            reason: resolved ? undefined : 'Not all blockers are resolved',
          };
        }
        return { passed: true };

      default:
        return { passed: true };
    }
  }

  private trimHistory(history: StateHistoryEntry[]): StateHistoryEntry[] {
    if (history.length <= this.config.maxHistoryEntries) {
      return history;
    }
    return history.slice(-this.config.maxHistoryEntries);
  }
}

// =============================================================================
// In-Memory Task Storage for Testing
// =============================================================================

/**
 * In-memory task storage implementation for testing.
 */
export class InMemoryTaskStorageForLifecycle implements TaskStorageForLifecycle {
  private tasks: Map<string, TaskForLifecycle> = new Map();

  addTask(task: TaskForLifecycle): void {
    this.tasks.set(task.id, { ...task });
  }

  async getTask(taskId: string): Promise<TaskForLifecycle | null> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  async updateTask(task: TaskForLifecycle): Promise<void> {
    this.tasks.set(task.id, { ...task });
  }

  clear(): void {
    this.tasks.clear();
  }

  get size(): number {
    return this.tasks.size;
  }
}

// =============================================================================
// Findings Checker Adapter for FindingRegister Integration
// =============================================================================

/**
 * Import types from finding-register for the adapter.
 * NOTE: To avoid circular dependencies, the actual FindingRegister is injected.
 */
export interface FindingRegisterLike {
  /** Gets blocking findings for a task (CRITICAL/HIGH severity, OPEN/IN_PROGRESS status) */
  getBlockingFindings(taskId: string): Promise<{ success: true; value: Array<{ finding_id: string; severity: string }> } | { success: false; error: unknown }>;
  /** Gets findings summary for a task */
  getFindingsSummary?(taskId: string): Promise<{ success: true; value: { open_critical: number; open_high: number } } | { success: false; error: unknown }>;
}

/**
 * Adapter that implements FindingsCheckerForLifecycle using a FindingRegister.
 * 
 * This adapter bridges the FindingRegister component with the TaskLifecycleManager,
 * enabling the `no_blocking_findings` guard to use actual finding data.
 * 
 * Requirements: R11.5
 * 
 * @example
 * ```typescript
 * const findingRegister = new FindingRegisterImpl(...);
 * const findingsChecker = new FindingRegisterFindingsChecker(findingRegister);
 * const lifecycleManager = new TaskLifecycleManagerImpl({
 *   taskStorage,
 *   findingsChecker,
 * });
 * ```
 */
export class FindingRegisterFindingsChecker implements FindingsCheckerForLifecycle {
  constructor(private readonly findingRegister: FindingRegisterLike) {}

  /**
   * Checks if task has blocking findings (CRITICAL/HIGH severity, OPEN/IN_PROGRESS status).
   * @param taskId - Task ID to check
   * @returns true if blocking findings exist
   */
  async hasBlockingFindings(taskId: string): Promise<boolean> {
    const result = await this.findingRegister.getBlockingFindings(taskId);
    if (result.success) {
      return result.value.length > 0;
    }
    // If error, assume no blocking findings to avoid blocking on error
    return false;
  }

  /**
   * Gets the IDs of blocking findings for a task.
   * @param taskId - Task ID to get blocking finding IDs for
   * @returns Array of blocking finding IDs
   */
  async getBlockingFindingIds(taskId: string): Promise<string[]> {
    const result = await this.findingRegister.getBlockingFindings(taskId);
    if (result.success) {
      return result.value.map(f => f.finding_id);
    }
    return [];
  }

  /**
   * Gets count of blocking findings by severity.
   * @param taskId - Task ID to get counts for
   * @returns Object with critical and high counts
   */
  async getBlockingFindingCounts(taskId: string): Promise<{ critical: number; high: number }> {
    // Try using summary if available
    if (this.findingRegister.getFindingsSummary) {
      const summaryResult = await this.findingRegister.getFindingsSummary(taskId);
      if (summaryResult.success) {
        return {
          critical: summaryResult.value.open_critical,
          high: summaryResult.value.open_high,
        };
      }
    }
    
    // Fallback to counting from blocking findings
    const result = await this.findingRegister.getBlockingFindings(taskId);
    if (result.success) {
      let critical = 0;
      let high = 0;
      for (const finding of result.value) {
        if (finding.severity === 'CRITICAL') critical++;
        else if (finding.severity === 'HIGH') high++;
      }
      return { critical, high };
    }
    return { critical: 0, high: 0 };
  }
}

// =============================================================================
// Task Blocking Findings Synchronizer
// =============================================================================

/**
 * Options for synchronizing blocking findings with task.
 */
export interface SyncBlockingFindingsOptions {
  /** Task ID to synchronize */
  taskId: string;
  /** Task storage to update */
  taskStorage: TaskStorageForLifecycle;
  /** Findings checker to get current blocking findings */
  findingsChecker: FindingsCheckerForLifecycle;
}

/**
 * Result of synchronizing blocking findings.
 */
export interface SyncBlockingFindingsResult {
  /** Whether sync was successful */
  success: boolean;
  /** Updated task (if success) */
  task?: TaskForLifecycle;
  /** Previous blocking finding IDs */
  previousBlockingIds: string[];
  /** Current blocking finding IDs */
  currentBlockingIds: string[];
  /** Whether blocking status changed */
  changed: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Synchronizes a task's blocking_finding_ids and has_blocking_findings with the current
 * state of findings from the FindingRegister.
 * 
 * Call this function when:
 * - A finding is created for the task
 * - A finding status changes (resolved, deferred, reopened)
 * - Before checking if a task can transition to READY_TO_MERGE or DONE
 * 
 * Requirements: R11.5
 * 
 * @param options - Sync options including taskId, storage, and checker
 * @returns Result with previous and current blocking finding IDs
 */
export async function syncBlockingFindings(
  options: SyncBlockingFindingsOptions
): Promise<SyncBlockingFindingsResult> {
  const { taskId, taskStorage, findingsChecker } = options;
  
  try {
    // Get current task
    const task = await taskStorage.getTask(taskId);
    if (!task) {
      return {
        success: false,
        previousBlockingIds: [],
        currentBlockingIds: [],
        changed: false,
        error: `Task ${taskId} not found`,
      };
    }
    
    // Get current blocking findings
    const previousBlockingIds = task.blocking_finding_ids ?? [];
    const currentBlockingIds = findingsChecker.getBlockingFindingIds
      ? await findingsChecker.getBlockingFindingIds(taskId)
      : [];
    
    const hasBlocking = currentBlockingIds.length > 0;
    
    // Check if changed
    const previousSet = new Set(previousBlockingIds);
    const currentSet = new Set(currentBlockingIds);
    const changed = 
      previousBlockingIds.length !== currentBlockingIds.length ||
      previousBlockingIds.some(id => !currentSet.has(id)) ||
      currentBlockingIds.some(id => !previousSet.has(id));
    
    if (changed) {
      // Update task
      const updatedTask: TaskForLifecycle = {
        ...task,
        has_blocking_findings: hasBlocking,
        blocking_finding_ids: currentBlockingIds,
      };
      await taskStorage.updateTask(updatedTask);
      
      return {
        success: true,
        task: updatedTask,
        previousBlockingIds,
        currentBlockingIds,
        changed: true,
      };
    }
    
    return {
      success: true,
      task,
      previousBlockingIds,
      currentBlockingIds,
      changed: false,
    };
  } catch (error) {
    return {
      success: false,
      previousBlockingIds: [],
      currentBlockingIds: [],
      changed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
