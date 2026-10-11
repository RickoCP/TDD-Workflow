/**
 * Handoff Coordinator - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Handoff_Coordinator component
 * which manages task handoffs between developers, including handoff points, checklists, and
 * handoff execution workflows.
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4
 */

import { Result, ok, err, Role, VALID_ROLES, isValidRole } from './team-manager';

// =============================================================================
// Constants
// =============================================================================

/**
 * Valid handoff statuses for tracking handoff progress.
 * Requirements: 11.3, 12.1, 12.3, 12.4
 */
export const HANDOFF_STATUSES = [
  'PENDING',          // Handoff requested, waiting for target to respond
  'ACCEPTED',         // Target developer accepted the handoff
  'REJECTED',         // Target developer rejected the handoff
  'COMPLETED',        // Handoff fully completed
] as const;

/**
 * Internal handoff states for the state machine (more granular than status).
 */
export const HANDOFF_STATES = [
  'NOT_STARTED',              // Handoff point defined but not initiated
  'CHECKLIST_IN_PROGRESS',    // Checklist items being completed
  'PENDING_ACCEPTANCE',       // Waiting for target to accept/reject
  'ACCEPTED',                 // Accepted, target can start
  'REJECTED',                 // Rejected, returned to source
  'COMPLETE',                 // Fully complete
] as const;

/**
 * Handoff reasons that can be provided when requesting a handoff.
 */
export const HANDOFF_REASONS = [
  'ROLE_TRANSITION',      // Work moves from one role to another
  'CAPACITY_REBALANCE',   // Redistributing work for load balancing
  'EXPERTISE_REQUIRED',   // Specific expertise needed
  'AVAILABILITY_CHANGE',  // Original developer unavailable
  'TASK_COMPLETION',      // Natural workflow transition
  'OTHER',                // Custom reason
] as const;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Handoff status type derived from valid statuses constant.
 * Requirements: 12.1
 */
export type HandoffStatus = typeof HANDOFF_STATUSES[number];

/**
 * Internal handoff state type for state machine.
 */
export type HandoffState = typeof HANDOFF_STATES[number];

/**
 * Handoff reason type.
 */
export type HandoffReason = typeof HANDOFF_REASONS[number];

/**
 * Checklist item for handoff verification.
 * Requirements: 11.2, 11.4
 */
export interface ChecklistItem {
  /** Unique identifier for the checklist item */
  id: string;
  /** Description of what needs to be done/verified */
  description: string;
  /** Whether this item is required before handoff can complete */
  required: boolean;
  /** Whether this item has been completed */
  completed: boolean;
  /** Timestamp when the item was completed (if completed) */
  completed_at?: string;
  /** Developer ID who completed the item (if completed) */
  completed_by?: string;
}

/**
 * Handoff point definition - defines a standard handoff between roles.
 * Requirements: 11.1, 11.2
 */
export interface HandoffPoint {
  /** Unique identifier for the handoff point */
  id: string;
  /** Display name for the handoff point */
  name: string;
  /** Role that initiates/completes work before handoff */
  source_role: Role;
  /** Role that receives work after handoff */
  target_role: Role;
  /** Checklist items that must be completed for this handoff type */
  checklist: ChecklistItem[];
  /** Description of what this handoff represents */
  description?: string;
  /** Whether this handoff point is active */
  active: boolean;
  /** Timestamp when the handoff point was created */
  created_at: string;
}

/**
 * Definition for creating a new handoff point.
 * Requirements: 11.1, 11.2
 */
export interface HandoffPointDefinition {
  /** Unique identifier for the handoff point */
  id: string;
  /** Display name for the handoff point */
  name: string;
  /** Role that initiates/completes work before handoff */
  source_role: Role;
  /** Role that receives work after handoff */
  target_role: Role;
  /** Checklist items - at least one required */
  checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[];
  /** Description of what this handoff represents */
  description?: string;
}

/**
 * Context information about a handoff request.
 */
export interface HandoffContext {
  /** Reason for the handoff */
  reason: HandoffReason;
  /** Custom reason description (used when reason is OTHER) */
  custom_reason?: string;
  /** Notes from the source developer */
  notes?: string;
  /** Known blockers or issues */
  blockers?: string[];
  /** Relevant documentation links */
  documentation_links?: string[];
  /** Priority level of the handoff */
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  /** Estimated effort remaining */
  estimated_effort?: number;
  /** Additional custom context fields */
  additional_info?: Record<string, unknown>;
}

/**
 * Request to initiate a handoff.
 * Requirements: 11.3
 */
export interface HandoffRequest {
  /** Handoff point ID to use for this handoff */
  handoff_point_id: string;
  /** ID of the source task being handed off */
  source_task_id: string;
  /** ID of the target task (if different from source) */
  target_task_id?: string;
  /** Developer ID of the source developer */
  source_developer_id: string;
  /** Developer ID of the target developer (optional - can be picked up by any with role) */
  target_developer_id?: string;
  /** Context information for the handoff */
  context: HandoffContext;
}

/**
 * Complete record of a handoff including all state and history.
 * Requirements: 11.3, 12.1, 12.2, 12.3, 12.4
 */
export interface HandoffRecord {
  /** Unique identifier for this handoff instance */
  id: string;
  /** Reference to the handoff point definition */
  handoff_point_id: string;
  /** Name of the handoff point (denormalized for convenience) */
  handoff_point_name: string;
  /** ID of the source task */
  source_task_id: string;
  /** ID of the target task */
  target_task_id: string;
  /** Developer who initiated the handoff */
  source_developer_id: string;
  /** Developer who accepted/will work on the target task */
  target_developer_id: string | null;
  /** Role required for target */
  target_role: Role;
  /** Current status of the handoff */
  status: HandoffStatus;
  /** Internal state for state machine */
  state: HandoffState;
  /** Context information provided by source */
  context: HandoffContext;
  /** Status of each checklist item */
  checklist_status: ChecklistItem[];
  /** Timestamp when handoff was initiated */
  initiated_at: string;
  /** Timestamp when handoff was accepted (if accepted) */
  accepted_at: string | null;
  /** Timestamp when handoff was rejected (if rejected) */
  rejected_at: string | null;
  /** Timestamp when handoff was completed (if completed) */
  completed_at: string | null;
  /** Reason for rejection (if rejected) */
  rejection_reason: string | null;
  /** History of state transitions */
  history: HandoffHistoryEntry[];
}

/**
 * History entry for tracking handoff state changes.
 */
export interface HandoffHistoryEntry {
  /** Previous state */
  from_state: HandoffState;
  /** New state */
  to_state: HandoffState;
  /** Timestamp of the transition */
  timestamp: string;
  /** Developer who triggered the transition */
  triggered_by: string | null;
  /** Additional notes about the transition */
  notes?: string;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Handoff error codes following the task specification.
 * Error codes 1601-1608 as specified.
 */
export enum HandoffErrorCode {
  /** Handoff record not found */
  HANDOFF_NOT_FOUND = 1601,
  /** Invalid handoff status for the requested operation */
  INVALID_HANDOFF_STATUS = 1602,
  /** Task is not assigned and cannot be handed off */
  TASK_NOT_ASSIGNED = 1603,
  /** Target developer is not available or doesn't exist */
  DEVELOPER_NOT_AVAILABLE = 1604,
  /** A handoff request already exists for this task */
  DUPLICATE_HANDOFF_REQUEST = 1605,
  /** Handoff has already been completed */
  HANDOFF_ALREADY_COMPLETED = 1606,
  /** Invalid state transition for the handoff */
  INVALID_HANDOFF_TRANSITION = 1607,
  /** Context is required but not provided */
  CONTEXT_REQUIRED = 1608,
}

/**
 * Additional error codes for handoff operations (extended range).
 * These extend the base error codes for more specific error cases.
 */
export enum HandoffExtendedErrorCode {
  /** Handoff point not found */
  HANDOFF_POINT_NOT_FOUND = 1609,
  /** Checklist is incomplete - required items not done */
  CHECKLIST_INCOMPLETE = 1610,
  /** Source task is not complete */
  SOURCE_TASK_NOT_COMPLETE = 1611,
  /** Target developer has wrong role */
  TARGET_ROLE_INVALID = 1612,
  /** Handoff has already been accepted */
  HANDOFF_ALREADY_ACCEPTED = 1613,
  /** Handoff has already been rejected */
  HANDOFF_ALREADY_REJECTED = 1614,
  /** Checklist must have at least one item */
  EMPTY_CHECKLIST = 1615,
  /** Invalid handoff point data */
  INVALID_HANDOFF_POINT_DATA = 1616,
  /** Checklist item not found */
  CHECKLIST_ITEM_NOT_FOUND = 1617,
}

/**
 * Combined error code type for all handoff-related errors.
 */
export type AllHandoffErrorCode = HandoffErrorCode | HandoffExtendedErrorCode;

/**
 * Handoff error structure following the design specification.
 */
export interface HandoffError {
  /** Error code from HandoffErrorCode or HandoffExtendedErrorCode enum */
  code: AllHandoffErrorCode;
  /** Error category */
  category: 'HANDOFF_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    handoff_id?: string;
    handoff_point_id?: string;
    task_id?: string;
    developer_id?: string;
    source_role?: string;
    target_role?: string;
    current_status?: HandoffStatus;
    current_state?: HandoffState;
    required_items?: string[];
    incomplete_items?: string[];
    [key: string]: unknown;
  };
  /** Suggested action to resolve the error */
  suggested_action?: string;
  /** Timestamp when the error occurred */
  timestamp: string;
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Creates a HandoffError with the given code and details.
 */
export function createHandoffError(
  code: AllHandoffErrorCode,
  message: string,
  context?: HandoffError['context'],
  suggested_action?: string
): HandoffError {
  return {
    code,
    category: 'HANDOFF_ERROR',
    message,
    context,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "handoff not found" error.
 * Error code: 1601
 */
export function handoffNotFoundError(handoffId: string): HandoffError {
  return createHandoffError(
    HandoffErrorCode.HANDOFF_NOT_FOUND,
    `Handoff with id '${handoffId}' not found`,
    { handoff_id: handoffId },
    'Verify the handoff ID or check active handoffs list'
  );
}

/**
 * Creates an "invalid handoff status" error.
 * Error code: 1602
 */
export function invalidHandoffStatusError(
  handoffId: string,
  currentStatus: HandoffStatus,
  operation: string
): HandoffError {
  return createHandoffError(
    HandoffErrorCode.INVALID_HANDOFF_STATUS,
    `Cannot ${operation} handoff '${handoffId}' in '${currentStatus}' status`,
    { handoff_id: handoffId, current_status: currentStatus },
    `Handoff must be in a different status to perform this operation`
  );
}

/**
 * Creates a "task not assigned" error.
 * Error code: 1603
 */
export function taskNotAssignedError(taskId: string): HandoffError {
  return createHandoffError(
    HandoffErrorCode.TASK_NOT_ASSIGNED,
    `Task '${taskId}' is not assigned and cannot be handed off`,
    { task_id: taskId },
    'Assign the task to a developer before initiating a handoff'
  );
}

/**
 * Creates a "developer not available" error.
 * Error code: 1604
 */
export function developerNotAvailableError(developerId: string, reason?: string): HandoffError {
  return createHandoffError(
    HandoffErrorCode.DEVELOPER_NOT_AVAILABLE,
    `Developer '${developerId}' is not available${reason ? `: ${reason}` : ''}`,
    { developer_id: developerId },
    'Select a different developer or wait for this developer to become available'
  );
}

/**
 * Creates a "duplicate handoff request" error.
 * Error code: 1605
 */
export function duplicateHandoffRequestError(taskId: string, existingHandoffId: string): HandoffError {
  return createHandoffError(
    HandoffErrorCode.DUPLICATE_HANDOFF_REQUEST,
    `A handoff request already exists for task '${taskId}'`,
    { task_id: taskId, handoff_id: existingHandoffId },
    'Complete or cancel the existing handoff before creating a new one'
  );
}

/**
 * Creates a "handoff already completed" error.
 * Error code: 1606
 */
export function handoffAlreadyCompletedError(handoffId: string): HandoffError {
  return createHandoffError(
    HandoffErrorCode.HANDOFF_ALREADY_COMPLETED,
    `Handoff '${handoffId}' has already been completed`,
    { handoff_id: handoffId, current_status: 'COMPLETED' },
    'No further actions can be taken on a completed handoff'
  );
}

/**
 * Creates an "invalid handoff transition" error.
 * Error code: 1607
 */
export function invalidHandoffTransitionError(
  handoffId: string,
  fromState: HandoffState,
  toState: HandoffState
): HandoffError {
  return createHandoffError(
    HandoffErrorCode.INVALID_HANDOFF_TRANSITION,
    `Cannot transition handoff '${handoffId}' from '${fromState}' to '${toState}'`,
    { handoff_id: handoffId, current_state: fromState },
    'Check the valid state transitions for handoffs'
  );
}

/**
 * Creates a "context required" error.
 * Error code: 1608
 */
export function contextRequiredError(handoffId?: string, missingFields?: string[]): HandoffError {
  return createHandoffError(
    HandoffErrorCode.CONTEXT_REQUIRED,
    `Handoff context is required but not provided${missingFields ? `: missing ${missingFields.join(', ')}` : ''}`,
    { handoff_id: handoffId },
    'Provide the required context information for the handoff'
  );
}

/**
 * Creates a "handoff point not found" error.
 * Error code: 1609
 */
export function handoffPointNotFoundError(handoffPointId: string): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.HANDOFF_POINT_NOT_FOUND,
    `Handoff point with id '${handoffPointId}' not found`,
    { handoff_point_id: handoffPointId },
    'Verify the handoff point ID or create the handoff point first'
  );
}

/**
 * Creates a "checklist incomplete" error.
 * Error code: 1610
 * Requirements: 11.4
 */
export function checklistIncompleteError(
  handoffId: string,
  incompleteItems: string[]
): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.CHECKLIST_INCOMPLETE,
    `Handoff '${handoffId}' cannot be completed: ${incompleteItems.length} required checklist item(s) not complete`,
    { handoff_id: handoffId, incomplete_items: incompleteItems },
    'Complete all required checklist items before completing the handoff'
  );
}

/**
 * Creates a "source task not complete" error.
 * Error code: 1611
 */
export function sourceTaskNotCompleteError(taskId: string): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.SOURCE_TASK_NOT_COMPLETE,
    `Source task '${taskId}' is not complete`,
    { task_id: taskId },
    'Complete the source task before initiating the handoff'
  );
}

/**
 * Creates a "target role invalid" error.
 * Error code: 1612
 */
export function targetRoleInvalidError(
  developerId: string,
  expectedRole: Role,
  actualRoles: Role[]
): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.TARGET_ROLE_INVALID,
    `Developer '${developerId}' does not have required role '${expectedRole}'`,
    { 
      developer_id: developerId, 
      target_role: expectedRole,
      source_role: actualRoles.join(', ')
    },
    `Select a developer with '${expectedRole}' role or update developer roles`
  );
}

/**
 * Creates a "handoff already accepted" error.
 * Error code: 1613
 */
export function handoffAlreadyAcceptedError(handoffId: string): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.HANDOFF_ALREADY_ACCEPTED,
    `Handoff '${handoffId}' has already been accepted`,
    { handoff_id: handoffId, current_status: 'ACCEPTED' },
    'Cannot modify an accepted handoff'
  );
}

/**
 * Creates a "handoff already rejected" error.
 * Error code: 1614
 */
export function handoffAlreadyRejectedError(handoffId: string): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.HANDOFF_ALREADY_REJECTED,
    `Handoff '${handoffId}' has already been rejected`,
    { handoff_id: handoffId, current_status: 'REJECTED' },
    'Create a new handoff request if needed'
  );
}

/**
 * Creates an "empty checklist" error.
 * Error code: 1615
 * Requirements: 11.2
 */
export function emptyChecklistError(handoffPointId: string): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.EMPTY_CHECKLIST,
    `Handoff point '${handoffPointId}' must have at least one checklist item`,
    { handoff_point_id: handoffPointId },
    'Add at least one checklist item to the handoff point definition'
  );
}

/**
 * Creates an "invalid handoff point data" error.
 * Error code: 1616
 */
export function invalidHandoffPointDataError(handoffPointId: string, details: string): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.INVALID_HANDOFF_POINT_DATA,
    `Invalid handoff point data for '${handoffPointId}': ${details}`,
    { handoff_point_id: handoffPointId },
    'Ensure all required fields are provided with valid values'
  );
}

/**
 * Creates a "checklist item not found" error.
 * Error code: 1617
 */
export function checklistItemNotFoundError(handoffId: string, itemId: string): HandoffError {
  return createHandoffError(
    HandoffExtendedErrorCode.CHECKLIST_ITEM_NOT_FOUND,
    `Checklist item '${itemId}' not found in handoff '${handoffId}'`,
    { handoff_id: handoffId },
    'Verify the checklist item ID'
  );
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates if a string is a valid handoff status.
 */
export function isValidHandoffStatus(status: string): status is HandoffStatus {
  return HANDOFF_STATUSES.includes(status as HandoffStatus);
}

/**
 * Validates if a string is a valid handoff state.
 */
export function isValidHandoffState(state: string): state is HandoffState {
  return HANDOFF_STATES.includes(state as HandoffState);
}

/**
 * Validates if a string is a valid handoff reason.
 */
export function isValidHandoffReason(reason: string): reason is HandoffReason {
  return HANDOFF_REASONS.includes(reason as HandoffReason);
}

/**
 * Validates if a handoff ID follows valid format.
 * Handoff IDs must be non-empty strings.
 */
export function isValidHandoffId(handoffId: string): boolean {
  return typeof handoffId === 'string' && handoffId.trim().length > 0;
}

/**
 * Validates if a handoff point definition has all required fields.
 * Requirements: 11.1, 11.2
 */
export function validateHandoffPointDefinition(
  definition: Partial<HandoffPointDefinition>
): Result<void, HandoffError> {
  // Check required ID
  if (!definition.id || typeof definition.id !== 'string' || definition.id.trim() === '') {
    return err(invalidHandoffPointDataError(definition.id || '', 'ID is required'));
  }

  // Check required name
  if (!definition.name || typeof definition.name !== 'string' || definition.name.trim() === '') {
    return err(invalidHandoffPointDataError(definition.id, 'Name is required'));
  }

  // Check source role is valid
  if (!definition.source_role || !isValidRole(definition.source_role)) {
    return err(invalidHandoffPointDataError(
      definition.id,
      `Invalid source role: ${definition.source_role}. Valid roles: ${VALID_ROLES.join(', ')}`
    ));
  }

  // Check target role is valid
  if (!definition.target_role || !isValidRole(definition.target_role)) {
    return err(invalidHandoffPointDataError(
      definition.id,
      `Invalid target role: ${definition.target_role}. Valid roles: ${VALID_ROLES.join(', ')}`
    ));
  }

  // Requirement 11.2: Check checklist has at least one item
  if (!definition.checklist || !Array.isArray(definition.checklist) || definition.checklist.length === 0) {
    return err(emptyChecklistError(definition.id));
  }

  // Validate each checklist item
  for (const item of definition.checklist) {
    if (!item.id || typeof item.id !== 'string' || item.id.trim() === '') {
      return err(invalidHandoffPointDataError(definition.id, 'Each checklist item must have an ID'));
    }
    if (!item.description || typeof item.description !== 'string' || item.description.trim() === '') {
      return err(invalidHandoffPointDataError(definition.id, 'Each checklist item must have a description'));
    }
    if (typeof item.required !== 'boolean') {
      return err(invalidHandoffPointDataError(definition.id, 'Each checklist item must specify if it is required'));
    }
  }

  return ok(undefined);
}

/**
 * Validates a handoff request.
 */
export function validateHandoffRequest(request: Partial<HandoffRequest>): Result<void, HandoffError> {
  if (!request.handoff_point_id || typeof request.handoff_point_id !== 'string') {
    return err(createHandoffError(
      HandoffErrorCode.CONTEXT_REQUIRED,
      'Handoff point ID is required',
      {},
      'Provide a valid handoff point ID'
    ));
  }

  if (!request.source_task_id || typeof request.source_task_id !== 'string') {
    return err(createHandoffError(
      HandoffErrorCode.CONTEXT_REQUIRED,
      'Source task ID is required',
      {},
      'Provide a valid source task ID'
    ));
  }

  if (!request.source_developer_id || typeof request.source_developer_id !== 'string') {
    return err(createHandoffError(
      HandoffErrorCode.CONTEXT_REQUIRED,
      'Source developer ID is required',
      {},
      'Provide a valid source developer ID'
    ));
  }

  if (!request.context) {
    return err(contextRequiredError(undefined, ['context']));
  }

  if (!request.context.reason || !isValidHandoffReason(request.context.reason)) {
    return err(createHandoffError(
      HandoffErrorCode.CONTEXT_REQUIRED,
      `Invalid handoff reason: ${request.context.reason}. Valid reasons: ${HANDOFF_REASONS.join(', ')}`,
      {},
      'Provide a valid handoff reason'
    ));
  }

  return ok(undefined);
}

/**
 * Checks if all required checklist items are complete.
 * Requirements: 11.4
 */
export function areRequiredChecklistItemsComplete(checklist: ChecklistItem[]): boolean {
  return checklist
    .filter(item => item.required)
    .every(item => item.completed);
}

/**
 * Gets the list of incomplete required checklist items.
 * Requirements: 11.4
 */
export function getIncompleteRequiredItems(checklist: ChecklistItem[]): ChecklistItem[] {
  return checklist.filter(item => item.required && !item.completed);
}

// =============================================================================
// State Transition Helpers
// =============================================================================

/**
 * Valid state transitions for the handoff state machine.
 * Defines which transitions are allowed from each state.
 */
export const VALID_HANDOFF_TRANSITIONS: Record<HandoffState, HandoffState[]> = {
  'NOT_STARTED': ['CHECKLIST_IN_PROGRESS'],
  'CHECKLIST_IN_PROGRESS': ['CHECKLIST_IN_PROGRESS', 'PENDING_ACCEPTANCE'],
  'PENDING_ACCEPTANCE': ['ACCEPTED', 'REJECTED'],
  'ACCEPTED': ['COMPLETE'],
  'REJECTED': ['CHECKLIST_IN_PROGRESS'],
  'COMPLETE': [],
};

/**
 * Checks if a state transition is valid.
 */
export function isValidStateTransition(fromState: HandoffState, toState: HandoffState): boolean {
  return VALID_HANDOFF_TRANSITIONS[fromState]?.includes(toState) ?? false;
}

/**
 * Maps internal state to external status.
 */
export function stateToStatus(state: HandoffState): HandoffStatus {
  switch (state) {
    case 'NOT_STARTED':
    case 'CHECKLIST_IN_PROGRESS':
    case 'PENDING_ACCEPTANCE':
      return 'PENDING';
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'REJECTED':
      return 'REJECTED';
    case 'COMPLETE':
      return 'COMPLETED';
    default:
      return 'PENDING';
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new checklist item with default values.
 */
export function createChecklistItem(
  id: string,
  description: string,
  required: boolean = true
): ChecklistItem {
  return {
    id,
    description,
    required,
    completed: false,
  };
}

/**
 * Creates a new handoff point from a definition.
 * Requirements: 11.1, 11.2
 */
export function createHandoffPoint(definition: HandoffPointDefinition): HandoffPoint {
  return {
    id: definition.id,
    name: definition.name,
    source_role: definition.source_role,
    target_role: definition.target_role,
    checklist: definition.checklist.map(item => ({
      id: item.id,
      description: item.description,
      required: item.required,
      completed: false,
    })),
    description: definition.description,
    active: true,
    created_at: new Date().toISOString(),
  };
}

/**
 * Creates a new handoff history entry.
 */
export function createHandoffHistoryEntry(
  fromState: HandoffState,
  toState: HandoffState,
  triggeredBy: string | null,
  notes?: string
): HandoffHistoryEntry {
  return {
    from_state: fromState,
    to_state: toState,
    timestamp: new Date().toISOString(),
    triggered_by: triggeredBy,
    notes,
  };
}

/**
 * Creates a new handoff record from a request and handoff point.
 * Requirements: 11.3
 */
export function createHandoffRecord(
  id: string,
  request: HandoffRequest,
  handoffPoint: HandoffPoint
): HandoffRecord {
  const now = new Date().toISOString();
  
  return {
    id,
    handoff_point_id: handoffPoint.id,
    handoff_point_name: handoffPoint.name,
    source_task_id: request.source_task_id,
    target_task_id: request.target_task_id || request.source_task_id,
    source_developer_id: request.source_developer_id,
    target_developer_id: request.target_developer_id || null,
    target_role: handoffPoint.target_role,
    status: 'PENDING',
    state: 'CHECKLIST_IN_PROGRESS',
    context: request.context,
    checklist_status: handoffPoint.checklist.map(item => ({
      ...item,
      completed: false,
    })),
    initiated_at: now,
    accepted_at: null,
    rejected_at: null,
    completed_at: null,
    rejection_reason: null,
    history: [
      createHandoffHistoryEntry('NOT_STARTED', 'CHECKLIST_IN_PROGRESS', request.source_developer_id, 'Handoff initiated'),
    ],
  };
}

/**
 * Generates a unique handoff ID.
 */
export function generateHandoffId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `HO-${timestamp}-${random}`.toUpperCase();
}

/**
 * Generates a unique handoff point ID.
 */
export function generateHandoffPointId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `HP-${timestamp}-${random}`.toUpperCase();
}

// =============================================================================
// Handoff Initiation Types
// =============================================================================

/**
 * Options for initiating a handoff.
 * Requirements: 11.3, 11.4
 */
export interface InitiateHandoffOptions {
  /** Developer ID of the source developer (optional - inferred from task if not provided) */
  sourceDeveloperId?: string;
  /** Developer ID of the target developer (optional - can be picked up by role) */
  targetDeveloperId?: string;
  /** Reason for the handoff */
  reason?: HandoffReason;
  /** Additional context notes */
  notes?: string;
  /** Priority of the handoff */
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

// =============================================================================
// Handoff_Coordinator Interface
// =============================================================================

/**
 * Handoff_Coordinator interface for managing task handoffs between developers.
 * 
 * Manages handoff points, checklists, and handoff execution workflows including
 * initiation, acceptance/rejection, and completion of handoffs.
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4
 */
export interface Handoff_Coordinator {
  // =========================================================================
  // Handoff Point Definition
  // =========================================================================

  /**
   * Defines a new handoff point with source role, target role, and checklist.
   * 
   * Requirements: 11.1, 11.2
   * 
   * @param definition - The handoff point definition
   * @returns Result with void on success or HandoffError on failure
   * 
   * Errors:
   * - EMPTY_CHECKLIST: If checklist has no items
   * - INVALID_HANDOFF_POINT_DATA: If required fields are missing or invalid
   */
  defineHandoffPoint(definition: HandoffPointDefinition): Result<void, HandoffError>;

  /**
   * Updates the checklist for an existing handoff point.
   * 
   * @param handoffPointId - The handoff point to update
   * @param checklist - The new checklist items
   * @returns Result with void on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_POINT_NOT_FOUND: If handoff point doesn't exist
   * - EMPTY_CHECKLIST: If new checklist has no items
   */
  updateHandoffChecklist(
    handoffPointId: string,
    checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[]
  ): Result<void, HandoffError>;

  /**
   * Gets a handoff point by ID.
   * 
   * @param handoffPointId - The handoff point ID to retrieve
   * @returns The handoff point or null if not found
   */
  getHandoffPoint(handoffPointId: string): HandoffPoint | null;

  /**
   * Lists all defined handoff points.
   * 
   * @param filter - Optional filter by source or target role
   * @returns Array of handoff points matching the filter
   */
  listHandoffPoints(filter?: { source_role?: Role; target_role?: Role }): HandoffPoint[];

  // =========================================================================
  // Handoff Request and Execution
  // =========================================================================

  /**
   * Requests a handoff from source to target.
   * 
   * Requirements: 11.3, 12.1
   * 
   * @param request - The handoff request details
   * @returns Result with HandoffRecord on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_POINT_NOT_FOUND: If handoff point doesn't exist
   * - TASK_NOT_ASSIGNED: If source task is not assigned
   * - DUPLICATE_HANDOFF_REQUEST: If a handoff already exists for this task
   * - CONTEXT_REQUIRED: If required context is missing
   */
  requestHandoff(request: HandoffRequest): Result<HandoffRecord, HandoffError>;

  /**
   * Initiates a handoff between source and target tasks.
   * 
   * This is a simplified interface for creating handoffs that automatically:
   * - Validates that the source task is complete
   * - Validates that source and target developers are valid team members
   * - Finds the appropriate handoff point based on task roles
   * - Creates the handoff record
   * - Notifies the target role of the pending handoff
   * 
   * Requirements: 11.3, 11.4, 12.1, 12.2
   * 
   * @param sourceTaskId - The ID of the source task being handed off
   * @param targetTaskId - The ID of the target task receiving the handoff
   * @param options - Optional configuration for the handoff
   * @returns Result with HandoffRecord on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_POINT_NOT_FOUND: If no handoff point exists for the source/target roles
   * - SOURCE_TASK_NOT_COMPLETE: If source task is not in DONE status
   * - TASK_NOT_ASSIGNED: If source task is not assigned to a developer
   * - DEVELOPER_NOT_AVAILABLE: If specified developer doesn't exist
   * - TARGET_ROLE_INVALID: If target developer doesn't have the required role
   * - DUPLICATE_HANDOFF_REQUEST: If a handoff already exists for this task
   */
  initiateHandoff(
    sourceTaskId: string,
    targetTaskId: string,
    options?: InitiateHandoffOptions
  ): Result<HandoffRecord, HandoffError>;

  /**
   * Accepts a pending handoff.
   * 
   * Requirements: 12.3
   * 
   * @param handoffId - The handoff to accept
   * @param developerId - The developer accepting the handoff
   * @returns Result with void on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_NOT_FOUND: If handoff doesn't exist
   * - INVALID_HANDOFF_STATUS: If handoff is not in PENDING status
   * - TARGET_ROLE_INVALID: If developer doesn't have required role
   * - CHECKLIST_INCOMPLETE: If required checklist items are not complete
   */
  acceptHandoff(handoffId: string, developerId: string): Result<void, HandoffError>;

  /**
   * Rejects a pending handoff.
   * 
   * Requirements: 12.4
   * 
   * @param handoffId - The handoff to reject
   * @param reason - The reason for rejection
   * @returns Result with void on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_NOT_FOUND: If handoff doesn't exist
   * - INVALID_HANDOFF_STATUS: If handoff is not in PENDING status
   */
  rejectHandoff(handoffId: string, reason: string): Result<void, HandoffError>;

  /**
   * Completes an accepted handoff.
   * 
   * Requirements: 11.4
   * 
   * @param handoffId - The handoff to complete
   * @returns Result with void on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_NOT_FOUND: If handoff doesn't exist
   * - INVALID_HANDOFF_STATUS: If handoff is not in ACCEPTED status
   * - HANDOFF_ALREADY_COMPLETED: If handoff is already completed
   */
  completeHandoff(handoffId: string): Result<void, HandoffError>;

  /**
   * Completes a checklist item for a handoff.
   * 
   * Requirements: 11.4
   * 
   * @param handoffId - The handoff ID
   * @param itemId - The checklist item ID to mark complete
   * @param developerId - The developer completing the item
   * @returns Result with void on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_NOT_FOUND: If handoff doesn't exist
   * - CHECKLIST_ITEM_NOT_FOUND: If checklist item doesn't exist
   * - HANDOFF_ALREADY_COMPLETED: If handoff is already completed
   */
  completeChecklistItem(
    handoffId: string,
    itemId: string,
    developerId: string
  ): Result<void, HandoffError>;

  // =========================================================================
  // Query Operations
  // =========================================================================

  /**
   * Gets a handoff record by ID.
   * 
   * @param handoffId - The handoff ID to retrieve
   * @returns Result with HandoffRecord on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_NOT_FOUND: If handoff doesn't exist
   */
  getHandoff(handoffId: string): Result<HandoffRecord, HandoffError>;

  /**
   * Gets all handoffs for a specific task.
   * 
   * @param taskId - The task ID to search for
   * @returns Array of handoff records for this task
   */
  getHandoffsByTask(taskId: string): HandoffRecord[];

  /**
   * Gets all handoffs involving a specific developer (as source or target).
   * 
   * @param developerId - The developer ID to search for
   * @returns Array of handoff records involving this developer
   */
  getHandoffsByDeveloper(developerId: string): HandoffRecord[];

  /**
   * Gets all pending handoffs.
   * 
   * @returns Array of handoffs with PENDING status
   */
  getPendingHandoffs(): HandoffRecord[];

  /**
   * Gets all active handoffs (not completed).
   * 
   * @returns Array of handoffs that are not completed
   */
  getActiveHandoffs(): HandoffRecord[];

  /**
   * Gets pending handoffs for a specific role.
   * 
   * @param role - The target role to filter by
   * @returns Array of pending handoffs for this role
   */
  getPendingHandoffsForRole(role: Role): HandoffRecord[];

  /**
   * Gets the status of a handoff.
   * 
   * @param handoffId - The handoff ID
   * @returns The handoff status or null if not found
   */
  getHandoffStatus(handoffId: string): HandoffStatus | null;

  // =========================================================================
  // Context Update
  // =========================================================================

  /**
   * Updates the context information for a handoff.
   * 
   * @param handoffId - The handoff to update
   * @param context - The updated context (partial update)
   * @returns Result with void on success or HandoffError on failure
   * 
   * Errors:
   * - HANDOFF_NOT_FOUND: If handoff doesn't exist
   * - HANDOFF_ALREADY_COMPLETED: If handoff is already completed
   */
  updateHandoffContext(
    handoffId: string,
    context: Partial<HandoffContext>
  ): Result<void, HandoffError>;
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { Result, ok, err, Role, VALID_ROLES, isValidRole };


// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Interface for team storage used by HandoffCoordinatorImpl.
 * Allows dependency injection of team data access.
 */
export interface TeamStorageForHandoff {
  /**
   * Gets a team member by ID.
   */
  getMember(developerId: string): { id: string; name: string; roles: Role[]; status: string } | null;
  
  /**
   * Validates if a developer ID exists.
   */
  validateDeveloperId(developerId: string): boolean;
}

/**
 * Interface for task storage used by HandoffCoordinatorImpl.
 * Allows dependency injection of task data access.
 */
export interface TaskStorageForHandoff {
  /**
   * Gets a task by ID.
   */
  getTask(taskId: string): { id: string; status: string; assignee: string | null } | null;
  
  /**
   * Checks if a task is complete (DONE status).
   */
  isTaskComplete(taskId: string): boolean;
}

/**
 * Configuration for HandoffCoordinatorImpl.
 */
export interface HandoffCoordinatorConfig {
  /**
   * Storage for team member operations.
   */
  teamStorage: TeamStorageForHandoff;
  
  /**
   * Storage for task operations.
   */
  taskStorage: TaskStorageForHandoff;
  
  /**
   * Path to project-state.yaml file (optional, for persistence).
   */
  projectStatePath?: string;
}

// =============================================================================
// HandoffCoordinatorImpl Implementation
// =============================================================================

/**
 * Implementation of the Handoff_Coordinator interface.
 * 
 * Manages handoff points, checklists, and handoff execution workflows including
 * initiation, acceptance/rejection, and completion of handoffs.
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4
 */
export class HandoffCoordinatorImpl implements Handoff_Coordinator {
  private config: HandoffCoordinatorConfig;
  private handoffPoints: Map<string, HandoffPoint> = new Map();
  private handoffs: Map<string, HandoffRecord> = new Map();

  constructor(config: HandoffCoordinatorConfig) {
    this.config = config;
  }

  // =========================================================================
  // Handoff Point Definition
  // =========================================================================

  /**
   * Defines a new handoff point with source role, target role, and checklist.
   * 
   * Requirements: 11.1, 11.2
   * 
   * @param definition - The handoff point definition
   * @returns Result with void on success or HandoffError on failure
   */
  defineHandoffPoint(definition: HandoffPointDefinition): Result<void, HandoffError> {
    // Validate the handoff point definition
    const validationResult = validateHandoffPointDefinition(definition);
    if (!validationResult.success) {
      return validationResult;
    }

    // Requirement 11.2: Check for at least one checklist item (already validated above)
    // This is a redundant check for clarity
    if (!definition.checklist || definition.checklist.length === 0) {
      return err(emptyChecklistError(definition.id));
    }

    // Check for duplicate handoff point ID
    if (this.handoffPoints.has(definition.id)) {
      return err(invalidHandoffPointDataError(
        definition.id,
        'A handoff point with this ID already exists'
      ));
    }

    // Create and store the handoff point
    const handoffPoint = createHandoffPoint(definition);
    this.handoffPoints.set(definition.id, handoffPoint);

    return ok(undefined);
  }

  /**
   * Updates the checklist for an existing handoff point.
   * 
   * @param handoffPointId - The handoff point to update
   * @param checklist - The new checklist items
   * @returns Result with void on success or HandoffError on failure
   */
  updateHandoffChecklist(
    handoffPointId: string,
    checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[]
  ): Result<void, HandoffError> {
    // Check if handoff point exists
    const handoffPoint = this.handoffPoints.get(handoffPointId);
    if (!handoffPoint) {
      return err(handoffPointNotFoundError(handoffPointId));
    }

    // Requirement 11.2: Check for at least one checklist item
    if (!checklist || checklist.length === 0) {
      return err(emptyChecklistError(handoffPointId));
    }

    // Validate each checklist item
    for (const item of checklist) {
      if (!item.id || typeof item.id !== 'string' || item.id.trim() === '') {
        return err(invalidHandoffPointDataError(handoffPointId, 'Each checklist item must have an ID'));
      }
      if (!item.description || typeof item.description !== 'string' || item.description.trim() === '') {
        return err(invalidHandoffPointDataError(handoffPointId, 'Each checklist item must have a description'));
      }
      if (typeof item.required !== 'boolean') {
        return err(invalidHandoffPointDataError(handoffPointId, 'Each checklist item must specify if it is required'));
      }
    }

    // Update the checklist with default values for completed fields
    handoffPoint.checklist = checklist.map(item => ({
      id: item.id,
      description: item.description,
      required: item.required,
      completed: false,
    }));

    return ok(undefined);
  }

  /**
   * Gets a handoff point by ID.
   * 
   * @param handoffPointId - The handoff point ID to retrieve
   * @returns The handoff point or null if not found
   */
  getHandoffPoint(handoffPointId: string): HandoffPoint | null {
    return this.handoffPoints.get(handoffPointId) || null;
  }

  /**
   * Lists all defined handoff points.
   * 
   * @param filter - Optional filter by source or target role
   * @returns Array of handoff points matching the filter
   */
  listHandoffPoints(filter?: { source_role?: Role; target_role?: Role }): HandoffPoint[] {
    let result = Array.from(this.handoffPoints.values());

    if (filter) {
      if (filter.source_role) {
        result = result.filter(hp => hp.source_role === filter.source_role);
      }
      if (filter.target_role) {
        result = result.filter(hp => hp.target_role === filter.target_role);
      }
    }

    return result;
  }

  // =========================================================================
  // Handoff Request and Execution
  // =========================================================================

  /**
   * Requests a handoff from source to target.
   * 
   * Requirements: 11.3, 12.1
   * 
   * @param request - The handoff request details
   * @returns Result with HandoffRecord on success or HandoffError on failure
   */
  requestHandoff(request: HandoffRequest): Result<HandoffRecord, HandoffError> {
    // Validate the request
    const validationResult = validateHandoffRequest(request);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    // Check if handoff point exists
    const handoffPoint = this.handoffPoints.get(request.handoff_point_id);
    if (!handoffPoint) {
      return err(handoffPointNotFoundError(request.handoff_point_id));
    }

    // Check if handoff point is active
    if (!handoffPoint.active) {
      return err(invalidHandoffPointDataError(
        request.handoff_point_id,
        'Handoff point is not active'
      ));
    }

    // Check for duplicate handoff request for this task
    for (const handoff of this.handoffs.values()) {
      if (handoff.source_task_id === request.source_task_id && 
          handoff.status !== 'COMPLETED' && 
          handoff.status !== 'REJECTED') {
        return err(duplicateHandoffRequestError(request.source_task_id, handoff.id));
      }
    }

    // Validate source developer exists
    if (!this.config.teamStorage.validateDeveloperId(request.source_developer_id)) {
      return err(developerNotAvailableError(request.source_developer_id, 'Developer not found'));
    }

    // Validate source developer has the source role
    const sourceMember = this.config.teamStorage.getMember(request.source_developer_id);
    if (sourceMember && !sourceMember.roles.includes(handoffPoint.source_role)) {
      return err(targetRoleInvalidError(
        request.source_developer_id,
        handoffPoint.source_role,
        sourceMember.roles
      ));
    }

    // Validate target developer if specified
    if (request.target_developer_id) {
      if (!this.config.teamStorage.validateDeveloperId(request.target_developer_id)) {
        return err(developerNotAvailableError(request.target_developer_id, 'Developer not found'));
      }

      const targetMember = this.config.teamStorage.getMember(request.target_developer_id);
      if (targetMember && !targetMember.roles.includes(handoffPoint.target_role)) {
        return err(targetRoleInvalidError(
          request.target_developer_id,
          handoffPoint.target_role,
          targetMember.roles
        ));
      }
    }

    // Generate a unique handoff ID and create the record
    const handoffId = generateHandoffId();
    const handoffRecord = createHandoffRecord(handoffId, request, handoffPoint);

    // Store the handoff
    this.handoffs.set(handoffId, handoffRecord);

    return ok(handoffRecord);
  }

  /**
   * Initiates a handoff between source and target tasks.
   * 
   * This is a simplified interface for creating handoffs that automatically:
   * - Validates that the source task is complete
   * - Validates that source and target developers are valid team members
   * - Finds the appropriate handoff point based on task roles
   * - Creates the handoff record
   * - Notifies the target role of the pending handoff
   * 
   * Requirements: 11.3, 11.4, 12.1, 12.2
   * 
   * @param sourceTaskId - The ID of the source task being handed off
   * @param targetTaskId - The ID of the target task receiving the handoff
   * @param options - Optional configuration for the handoff
   * @returns Result with HandoffRecord on success or HandoffError on failure
   */
  initiateHandoff(
    sourceTaskId: string,
    targetTaskId: string,
    options?: InitiateHandoffOptions
  ): Result<HandoffRecord, HandoffError> {
    // Validate source task ID is provided
    if (!sourceTaskId || typeof sourceTaskId !== 'string' || sourceTaskId.trim() === '') {
      return err(createHandoffError(
        HandoffErrorCode.CONTEXT_REQUIRED,
        'Source task ID is required',
        { task_id: sourceTaskId },
        'Provide a valid source task ID'
      ));
    }

    // Validate target task ID is provided
    if (!targetTaskId || typeof targetTaskId !== 'string' || targetTaskId.trim() === '') {
      return err(createHandoffError(
        HandoffErrorCode.CONTEXT_REQUIRED,
        'Target task ID is required',
        { task_id: targetTaskId },
        'Provide a valid target task ID'
      ));
    }

    // Get source task to validate it exists and get assignee info
    const sourceTask = this.config.taskStorage.getTask(sourceTaskId);
    if (!sourceTask) {
      return err(createHandoffError(
        HandoffErrorCode.TASK_NOT_ASSIGNED,
        `Source task '${sourceTaskId}' not found`,
        { task_id: sourceTaskId },
        'Verify the source task ID exists'
      ));
    }

    // Requirement 11.3: Validate source task is complete (DONE status)
    if (!this.config.taskStorage.isTaskComplete(sourceTaskId)) {
      return err(sourceTaskNotCompleteError(sourceTaskId));
    }

    // Validate source task is assigned to a developer
    const sourceDeveloperId = options?.sourceDeveloperId || sourceTask.assignee;
    if (!sourceDeveloperId) {
      return err(taskNotAssignedError(sourceTaskId));
    }

    // Validate source developer exists
    if (!this.config.teamStorage.validateDeveloperId(sourceDeveloperId)) {
      return err(developerNotAvailableError(sourceDeveloperId, 'Source developer not found'));
    }

    // Get source developer info to find their role
    const sourceMember = this.config.teamStorage.getMember(sourceDeveloperId);
    if (!sourceMember) {
      return err(developerNotAvailableError(sourceDeveloperId, 'Source developer not found'));
    }

    // Get target task to find target role information (optional, may not exist yet)
    const targetTask = this.config.taskStorage.getTask(targetTaskId);
    
    // Validate target developer if specified
    let targetDeveloperId = options?.targetDeveloperId;
    let targetMember: { id: string; name: string; roles: Role[]; status: string } | null = null;
    
    if (targetDeveloperId) {
      if (!this.config.teamStorage.validateDeveloperId(targetDeveloperId)) {
        return err(developerNotAvailableError(targetDeveloperId, 'Target developer not found'));
      }
      targetMember = this.config.teamStorage.getMember(targetDeveloperId);
    }

    // Find appropriate handoff point based on source developer's role
    // Look for a handoff point where source_role matches one of the source developer's roles
    let matchingHandoffPoint: HandoffPoint | null = null;
    
    for (const point of this.handoffPoints.values()) {
      if (!point.active) continue;
      
      // Check if source developer has the source role for this handoff point
      if (sourceMember.roles.includes(point.source_role)) {
        // If target developer is specified, ensure they have the target role
        if (targetMember) {
          if (targetMember.roles.includes(point.target_role)) {
            matchingHandoffPoint = point;
            break;
          }
        } else {
          // No specific target developer, just use the first matching handoff point
          matchingHandoffPoint = point;
          break;
        }
      }
    }

    if (!matchingHandoffPoint) {
      const sourceRoles = sourceMember.roles.join(', ');
      const targetRoles = targetMember ? targetMember.roles.join(', ') : 'any';
      return err(handoffPointNotFoundError(
        `No handoff point found for source roles [${sourceRoles}] to target roles [${targetRoles}]`
      ));
    }

    // Validate target developer has the required target role (if specified)
    if (targetMember && !targetMember.roles.includes(matchingHandoffPoint.target_role)) {
      return err(targetRoleInvalidError(
        targetDeveloperId!,
        matchingHandoffPoint.target_role,
        targetMember.roles
      ));
    }

    // Check for duplicate handoff request for this source task
    for (const handoff of this.handoffs.values()) {
      if (handoff.source_task_id === sourceTaskId && 
          handoff.status !== 'COMPLETED' && 
          handoff.status !== 'REJECTED') {
        return err(duplicateHandoffRequestError(sourceTaskId, handoff.id));
      }
    }

    // Create handoff context
    const context: HandoffContext = {
      reason: options?.reason || 'TASK_COMPLETION',
      notes: options?.notes,
      priority: options?.priority || 'MEDIUM',
    };

    // Generate a unique handoff ID and create the record
    const handoffId = generateHandoffId();
    
    const handoffRequest: HandoffRequest = {
      handoff_point_id: matchingHandoffPoint.id,
      source_task_id: sourceTaskId,
      target_task_id: targetTaskId,
      source_developer_id: sourceDeveloperId,
      target_developer_id: targetDeveloperId,
      context,
    };

    const handoffRecord = createHandoffRecord(handoffId, handoffRequest, matchingHandoffPoint);

    // Store the handoff
    this.handoffs.set(handoffId, handoffRecord);

    // Requirement 12.1: The target role is notified via the handoff record
    // being stored with PENDING status and target_role set
    // The getPendingHandoffsForRole method can be used to retrieve pending handoffs
    // for notification purposes

    return ok(handoffRecord);
  }

  /**
   * Accepts a pending handoff.
   * 
   * Requirements: 12.3
   * 
   * @param handoffId - The handoff to accept
   * @param developerId - The developer accepting the handoff
   * @returns Result with void on success or HandoffError on failure
   */
  acceptHandoff(handoffId: string, developerId: string): Result<void, HandoffError> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      return err(handoffNotFoundError(handoffId));
    }

    // Check handoff state allows acceptance
    if (handoff.state !== 'PENDING_ACCEPTANCE' && handoff.state !== 'CHECKLIST_IN_PROGRESS') {
      if (handoff.state === 'ACCEPTED' || handoff.state === 'COMPLETE') {
        return err(handoffAlreadyAcceptedError(handoffId));
      }
      if (handoff.state === 'REJECTED') {
        return err(handoffAlreadyRejectedError(handoffId));
      }
      return err(invalidHandoffStatusError(handoffId, handoff.status, 'accept'));
    }

    // Validate developer exists and has the required role
    if (!this.config.teamStorage.validateDeveloperId(developerId)) {
      return err(developerNotAvailableError(developerId, 'Developer not found'));
    }

    const targetMember = this.config.teamStorage.getMember(developerId);
    if (targetMember && !targetMember.roles.includes(handoff.target_role)) {
      return err(targetRoleInvalidError(developerId, handoff.target_role, targetMember.roles));
    }

    // Check if all required checklist items are complete
    const incompleteItems = getIncompleteRequiredItems(handoff.checklist_status);
    if (incompleteItems.length > 0) {
      return err(checklistIncompleteError(handoffId, incompleteItems.map(i => i.id)));
    }

    // Update handoff state
    const previousState = handoff.state;
    const now = new Date().toISOString();

    handoff.state = 'ACCEPTED';
    handoff.status = 'ACCEPTED';
    handoff.target_developer_id = developerId;
    handoff.accepted_at = now;

    // Add history entry
    handoff.history.push(createHandoffHistoryEntry(
      previousState,
      'ACCEPTED',
      developerId,
      'Handoff accepted'
    ));

    return ok(undefined);
  }

  /**
   * Rejects a pending handoff.
   * 
   * Requirements: 12.4
   * 
   * @param handoffId - The handoff to reject
   * @param reason - The reason for rejection
   * @returns Result with void on success or HandoffError on failure
   */
  rejectHandoff(handoffId: string, reason: string): Result<void, HandoffError> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      return err(handoffNotFoundError(handoffId));
    }

    // Check handoff state allows rejection
    if (handoff.state !== 'PENDING_ACCEPTANCE' && handoff.state !== 'CHECKLIST_IN_PROGRESS') {
      if (handoff.state === 'ACCEPTED' || handoff.state === 'COMPLETE') {
        return err(handoffAlreadyAcceptedError(handoffId));
      }
      if (handoff.state === 'REJECTED') {
        return err(handoffAlreadyRejectedError(handoffId));
      }
      return err(invalidHandoffStatusError(handoffId, handoff.status, 'reject'));
    }

    // Validate reason is provided
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      return err(contextRequiredError(handoffId, ['rejection reason']));
    }

    // Update handoff state
    const previousState = handoff.state;
    const now = new Date().toISOString();

    handoff.state = 'REJECTED';
    handoff.status = 'REJECTED';
    handoff.rejected_at = now;
    handoff.rejection_reason = reason.trim();

    // Add history entry
    handoff.history.push(createHandoffHistoryEntry(
      previousState,
      'REJECTED',
      null,
      `Rejection reason: ${reason.trim()}`
    ));

    return ok(undefined);
  }

  /**
   * Completes an accepted handoff.
   * 
   * Requirements: 11.4
   * 
   * @param handoffId - The handoff to complete
   * @returns Result with void on success or HandoffError on failure
   */
  completeHandoff(handoffId: string): Result<void, HandoffError> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      return err(handoffNotFoundError(handoffId));
    }

    // Check if handoff is already completed
    if (handoff.state === 'COMPLETE') {
      return err(handoffAlreadyCompletedError(handoffId));
    }

    // Check handoff state allows completion
    if (handoff.state !== 'ACCEPTED') {
      return err(invalidHandoffStatusError(handoffId, handoff.status, 'complete'));
    }

    // Requirement 11.4: Check if all required checklist items are complete
    const incompleteItems = getIncompleteRequiredItems(handoff.checklist_status);
    if (incompleteItems.length > 0) {
      return err(checklistIncompleteError(handoffId, incompleteItems.map(i => i.id)));
    }

    // Update handoff state
    const previousState = handoff.state;
    const now = new Date().toISOString();

    handoff.state = 'COMPLETE';
    handoff.status = 'COMPLETED';
    handoff.completed_at = now;

    // Add history entry
    handoff.history.push(createHandoffHistoryEntry(
      previousState,
      'COMPLETE',
      handoff.target_developer_id,
      'Handoff completed'
    ));

    return ok(undefined);
  }

  /**
   * Completes a checklist item for a handoff.
   * 
   * Requirements: 11.4
   * 
   * @param handoffId - The handoff ID
   * @param itemId - The checklist item ID to mark complete
   * @param developerId - The developer completing the item
   * @returns Result with void on success or HandoffError on failure
   */
  completeChecklistItem(
    handoffId: string,
    itemId: string,
    developerId: string
  ): Result<void, HandoffError> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      return err(handoffNotFoundError(handoffId));
    }

    // Check if handoff is already completed
    if (handoff.state === 'COMPLETE') {
      return err(handoffAlreadyCompletedError(handoffId));
    }

    // Find the checklist item
    const checklistItem = handoff.checklist_status.find(item => item.id === itemId);
    if (!checklistItem) {
      return err(checklistItemNotFoundError(handoffId, itemId));
    }

    // Mark the item as complete
    const now = new Date().toISOString();
    checklistItem.completed = true;
    checklistItem.completed_at = now;
    checklistItem.completed_by = developerId;

    // Check if all required items are now complete, and if so, transition to PENDING_ACCEPTANCE
    if (handoff.state === 'CHECKLIST_IN_PROGRESS') {
      if (areRequiredChecklistItemsComplete(handoff.checklist_status)) {
        const previousState = handoff.state;
        handoff.state = 'PENDING_ACCEPTANCE';
        
        handoff.history.push(createHandoffHistoryEntry(
          previousState,
          'PENDING_ACCEPTANCE',
          developerId,
          'All required checklist items completed'
        ));
      }
    }

    return ok(undefined);
  }

  // =========================================================================
  // Query Operations
  // =========================================================================

  /**
   * Gets a handoff record by ID.
   * 
   * @param handoffId - The handoff ID to retrieve
   * @returns Result with HandoffRecord on success or HandoffError on failure
   */
  getHandoff(handoffId: string): Result<HandoffRecord, HandoffError> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      return err(handoffNotFoundError(handoffId));
    }
    return ok({ ...handoff });
  }

  /**
   * Gets all handoffs for a specific task.
   * 
   * @param taskId - The task ID to search for
   * @returns Array of handoff records for this task
   */
  getHandoffsByTask(taskId: string): HandoffRecord[] {
    return Array.from(this.handoffs.values()).filter(
      h => h.source_task_id === taskId || h.target_task_id === taskId
    );
  }

  /**
   * Gets all handoffs involving a specific developer (as source or target).
   * 
   * @param developerId - The developer ID to search for
   * @returns Array of handoff records involving this developer
   */
  getHandoffsByDeveloper(developerId: string): HandoffRecord[] {
    return Array.from(this.handoffs.values()).filter(
      h => h.source_developer_id === developerId || h.target_developer_id === developerId
    );
  }

  /**
   * Gets all pending handoffs.
   * 
   * @returns Array of handoffs with PENDING status
   */
  getPendingHandoffs(): HandoffRecord[] {
    return Array.from(this.handoffs.values()).filter(h => h.status === 'PENDING');
  }

  /**
   * Gets all active handoffs (not completed).
   * 
   * @returns Array of handoffs that are not completed
   */
  getActiveHandoffs(): HandoffRecord[] {
    return Array.from(this.handoffs.values()).filter(h => h.status !== 'COMPLETED');
  }

  /**
   * Gets pending handoffs for a specific role.
   * 
   * @param role - The target role to filter by
   * @returns Array of pending handoffs for this role
   */
  getPendingHandoffsForRole(role: Role): HandoffRecord[] {
    return Array.from(this.handoffs.values()).filter(
      h => h.target_role === role && h.status === 'PENDING'
    );
  }

  /**
   * Gets the status of a handoff.
   * 
   * @param handoffId - The handoff ID
   * @returns The handoff status or null if not found
   */
  getHandoffStatus(handoffId: string): HandoffStatus | null {
    const handoff = this.handoffs.get(handoffId);
    return handoff ? handoff.status : null;
  }

  // =========================================================================
  // Context Update
  // =========================================================================

  /**
   * Updates the context information for a handoff.
   * 
   * @param handoffId - The handoff to update
   * @param context - The updated context (partial update)
   * @returns Result with void on success or HandoffError on failure
   */
  updateHandoffContext(
    handoffId: string,
    context: Partial<HandoffContext>
  ): Result<void, HandoffError> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      return err(handoffNotFoundError(handoffId));
    }

    // Check if handoff is already completed
    if (handoff.state === 'COMPLETE') {
      return err(handoffAlreadyCompletedError(handoffId));
    }

    // Merge context updates
    handoff.context = {
      ...handoff.context,
      ...context,
    };

    return ok(undefined);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new HandoffCoordinatorImpl instance.
 * 
 * @param config - Configuration for the coordinator
 * @returns A new HandoffCoordinatorImpl instance
 */
export function createHandoffCoordinator(config: HandoffCoordinatorConfig): Handoff_Coordinator {
  return new HandoffCoordinatorImpl(config);
}
