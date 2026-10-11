/**
 * Task Assigner - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Task_Assigner component
 * which handles task assignment to developers based on roles and availability.
 * 
 * Requirements: 3.1, 3.2, 4.3
 */

import { Result, ok, err, Role, VALID_ROLES, isValidRole } from './team-manager';

// =============================================================================
// Constants
// =============================================================================

/**
 * Valid task statuses that affect assignment operations.
 */
export const TASK_STATUSES = [
  'TODO',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'VERIFY',
  'DONE',
] as const;

/**
 * Task statuses that allow assignment operations.
 */
export const ASSIGNABLE_STATUSES = ['TODO', 'READY', 'BLOCKED'] as const;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Task status type derived from valid statuses constant.
 */
export type TaskStatus = typeof TASK_STATUSES[number];

/**
 * Task statuses that allow assignment.
 */
export type AssignableStatus = typeof ASSIGNABLE_STATUSES[number];

/**
 * Assignment state machine states as defined in the design document.
 */
export type AssignmentState = 
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'AVAILABLE_FOR_PICKUP'
  | 'REASSIGNED';

/**
 * Task assignment information.
 * Requirements: 3.1, 3.2
 */
export interface Assignment {
  /** Task ID that is assigned */
  taskId: string;
  /** Developer ID of the assignee (optional - null if unassigned) */
  assignee: string | null;
  /** Required role for the task (optional) */
  role_required: Role | null;
  /** Timestamp when the assignment was made */
  assigned_at: string;
  /** Developer ID of who made the assignment */
  assigned_by: string | null;
  /** Current assignment state */
  state: AssignmentState;
}

/**
 * Assignment history entry for tracking assignment changes.
 * Requirements: 16.1, 16.2
 */
export interface AssignmentHistoryEntry {
  /** Previous assignee developer ID (null for initial assignment) */
  previous_assignee: string | null;
  /** New assignee developer ID (null for unassignment) */
  new_assignee: string | null;
  /** Timestamp when the change occurred */
  timestamp: string;
  /** Reason for the assignment change (optional) */
  reason?: string;
}

/**
 * Task type used by Task_Assigner for assignment operations.
 */
export interface Task {
  /** Unique task identifier */
  id: string;
  /** Task title */
  title: string;
  /** Current task status */
  status: TaskStatus;
  /** Assignment information */
  assignment?: Assignment;
  /** Assignment history */
  assignment_history: AssignmentHistoryEntry[];
  /** Dependencies for this task */
  depends_on?: TaskDependency[];
  /** Parallel group association */
  parallel_group?: string | null;
}

/**
 * Task dependency specification.
 */
export interface TaskDependency {
  /** ID of the task this task depends on */
  task_id: string;
  /** Type of dependency */
  type: 'blocking' | 'non_blocking';
  /** Reason for the dependency (optional) */
  reason?: string;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Assignment error codes following the design specification.
 * Error codes in range 1100-1199.
 */
export enum AssignmentErrorCode {
  /** Assignee ID not registered */
  DEVELOPER_NOT_FOUND = 1101,
  /** Developer lacks required role */
  ROLE_MISMATCH = 1102,
  /** Task has existing assignee */
  TASK_ALREADY_ASSIGNED = 1103,
  /** Task in invalid state for assignment */
  TASK_NOT_ASSIGNABLE = 1104,
  /** role_required value invalid */
  INVALID_ROLE_REQUIRED = 1105,
  /** Task not found */
  TASK_NOT_FOUND = 1106,
  /** Task has no assignment */
  TASK_NOT_ASSIGNED = 1107,
  /** Invalid task data provided */
  INVALID_TASK_DATA = 1108,
}

/**
 * Assignment error structure following the design specification.
 */
export interface AssignmentError {
  /** Error code from AssignmentErrorCode enum */
  code: AssignmentErrorCode;
  /** Error category */
  category: 'ASSIGNMENT_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    task_id?: string;
    developer_id?: string;
    required_role?: string;
    developer_roles?: string[];
    current_status?: TaskStatus;
    valid_roles?: readonly string[];
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
 * Creates an AssignmentError with the given code and details.
 */
export function createAssignmentError(
  code: AssignmentErrorCode,
  message: string,
  context?: AssignmentError['context'],
  suggested_action?: string
): AssignmentError {
  return {
    code,
    category: 'ASSIGNMENT_ERROR',
    message,
    context,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "developer not found" error.
 * Requirements: 4.1
 */
export function developerNotFoundError(developerId: string, taskId?: string): AssignmentError {
  return createAssignmentError(
    AssignmentErrorCode.DEVELOPER_NOT_FOUND,
    `Developer '${developerId}' not found in team registry`,
    { developer_id: developerId, task_id: taskId },
    'Verify the developer ID or register the developer first using team add'
  );
}

/**
 * Creates a "role mismatch" error.
 * Requirements: 3.4
 */
export function roleMismatchError(
  developerId: string,
  requiredRole: string,
  developerRoles: string[],
  taskId?: string
): AssignmentError {
  return createAssignmentError(
    AssignmentErrorCode.ROLE_MISMATCH,
    `Developer '${developerId}' does not have required role '${requiredRole}'`,
    {
      developer_id: developerId,
      task_id: taskId,
      required_role: requiredRole,
      developer_roles: developerRoles,
    },
    `Assign to a developer with '${requiredRole}' role or update developer roles`
  );
}

/**
 * Creates a "task already assigned" error.
 */
export function taskAlreadyAssignedError(taskId: string, currentAssignee: string): AssignmentError {
  return createAssignmentError(
    AssignmentErrorCode.TASK_ALREADY_ASSIGNED,
    `Task '${taskId}' is already assigned to '${currentAssignee}'`,
    { task_id: taskId, developer_id: currentAssignee },
    'Unassign the task first or use reassignment'
  );
}

/**
 * Creates a "task not assignable" error.
 */
export function taskNotAssignableError(taskId: string, currentStatus: TaskStatus): AssignmentError {
  return createAssignmentError(
    AssignmentErrorCode.TASK_NOT_ASSIGNABLE,
    `Task '${taskId}' cannot be assigned in '${currentStatus}' status`,
    { task_id: taskId, current_status: currentStatus },
    `Task must be in one of these statuses to be assigned: ${ASSIGNABLE_STATUSES.join(', ')}`
  );
}

/**
 * Creates an "invalid role required" error.
 * Requirements: 4.2
 */
export function invalidRoleRequiredError(role: string, taskId?: string): AssignmentError {
  return createAssignmentError(
    AssignmentErrorCode.INVALID_ROLE_REQUIRED,
    `Role '${role}' is not a valid role for role_required field`,
    { task_id: taskId, required_role: role, valid_roles: VALID_ROLES },
    `Use one of the valid roles: ${VALID_ROLES.join(', ')}`
  );
}

/**
 * Creates a "task not found" error.
 */
export function taskNotFoundError(taskId: string): AssignmentError {
  return createAssignmentError(
    AssignmentErrorCode.TASK_NOT_FOUND,
    `Task '${taskId}' not found`,
    { task_id: taskId },
    'Verify the task ID or create the task first'
  );
}

/**
 * Creates a "task not assigned" error.
 */
export function taskNotAssignedError(taskId: string): AssignmentError {
  return createAssignmentError(
    AssignmentErrorCode.TASK_NOT_ASSIGNED,
    `Task '${taskId}' is not assigned to any developer`,
    { task_id: taskId },
    'The task has no current assignment to unassign'
  );
}

/**
 * Creates an "invalid task data" error.
 */
export function invalidTaskDataError(taskId: string, details: string): AssignmentError {
  return createAssignmentError(
    AssignmentErrorCode.INVALID_TASK_DATA,
    `Invalid task data for '${taskId}': ${details}`,
    { task_id: taskId },
    'Ensure task data has all required fields'
  );
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Checks if a task status allows assignment operations.
 */
export function isAssignableStatus(status: TaskStatus): status is AssignableStatus {
  return ASSIGNABLE_STATUSES.includes(status as AssignableStatus);
}

/**
 * Validates if a task ID follows valid format.
 * Task IDs must be non-empty strings.
 */
export function isValidTaskId(taskId: string): boolean {
  return typeof taskId === 'string' && taskId.trim().length > 0;
}

/**
 * Validates role_required field if provided.
 * Requirements: 4.2
 */
export function validateRoleRequired(roleRequired: string | null | undefined): Result<void, AssignmentError> {
  if (roleRequired === null || roleRequired === undefined) {
    return ok(undefined);
  }
  
  if (!isValidRole(roleRequired)) {
    return err(invalidRoleRequiredError(roleRequired));
  }
  
  return ok(undefined);
}

// =============================================================================
// Assignment Helper Functions
// =============================================================================

/**
 * Creates a new Assignment object.
 */
export function createAssignment(
  taskId: string,
  assignee: string | null,
  roleRequired: Role | null,
  assignedBy: string | null
): Assignment {
  return {
    taskId,
    assignee,
    role_required: roleRequired,
    assigned_at: new Date().toISOString(),
    assigned_by: assignedBy,
    state: assignee ? 'ASSIGNED' : (roleRequired ? 'AVAILABLE_FOR_PICKUP' : 'UNASSIGNED'),
  };
}

/**
 * Creates a new AssignmentHistoryEntry.
 */
export function createHistoryEntry(
  previousAssignee: string | null,
  newAssignee: string | null,
  reason?: string
): AssignmentHistoryEntry {
  return {
    previous_assignee: previousAssignee,
    new_assignee: newAssignee,
    timestamp: new Date().toISOString(),
    reason,
  };
}

/**
 * Determines the assignment state based on assignee and role_required.
 */
export function determineAssignmentState(
  assignee: string | null,
  roleRequired: Role | null
): AssignmentState {
  if (assignee) {
    return 'ASSIGNED';
  }
  if (roleRequired) {
    return 'AVAILABLE_FOR_PICKUP';
  }
  return 'UNASSIGNED';
}

// =============================================================================
// Task_Assigner Interface
// =============================================================================

/**
 * Task_Assigner interface for handling task assignment to developers
 * based on roles and availability.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 16.1, 16.2, 16.3
 */
export interface Task_Assigner {
  // =========================================================================
  // Assignment operations
  // =========================================================================

  /**
   * Assigns a task to a specific developer.
   * 
   * Requirements: 3.1, 3.3, 3.4, 4.1, 4.3
   * 
   * @param taskId - The ID of the task to assign
   * @param developerId - The ID of the developer to assign the task to
   * @returns Result with Assignment on success or AssignmentError on failure
   * 
   * Errors:
   * - TASK_NOT_FOUND: If the task doesn't exist
   * - DEVELOPER_NOT_FOUND: If the developer isn't registered
   * - ROLE_MISMATCH: If the developer lacks the required role
   * - TASK_ALREADY_ASSIGNED: If the task is already assigned
   * - TASK_NOT_ASSIGNABLE: If the task is in an invalid state
   */
  assignTask(taskId: string, developerId: string): Result<Assignment, AssignmentError>;

  /**
   * Removes the assignment from a task, making it unassigned.
   * 
   * @param taskId - The ID of the task to unassign
   * @returns Result with void on success or AssignmentError on failure
   * 
   * Errors:
   * - TASK_NOT_FOUND: If the task doesn't exist
   * - TASK_NOT_ASSIGNED: If the task has no current assignment
   */
  unassignTask(taskId: string): Result<void, AssignmentError>;

  /**
   * Allows a developer to pick up an unassigned task with a matching role.
   * 
   * Requirements: 3.5, 3.6
   * 
   * @param taskId - The ID of the task to pick up
   * @param developerId - The ID of the developer picking up the task
   * @returns Result with Assignment on success or AssignmentError on failure
   * 
   * Errors:
   * - TASK_NOT_FOUND: If the task doesn't exist
   * - DEVELOPER_NOT_FOUND: If the developer isn't registered
   * - ROLE_MISMATCH: If the developer lacks the required role
   * - TASK_ALREADY_ASSIGNED: If the task is already assigned
   */
  pickupTask(taskId: string, developerId: string): Result<Assignment, AssignmentError>;

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Gets the current assignment information for a task.
   * 
   * @param taskId - The ID of the task to query
   * @returns Assignment if the task has one, null otherwise
   */
  getAssignment(taskId: string): Assignment | null;

  /**
   * Gets all tasks assigned to a specific developer.
   * 
   * @param developerId - The ID of the developer
   * @returns Array of tasks assigned to the developer
   */
  getTasksByDeveloper(developerId: string): Task[];

  /**
   * Gets all unassigned tasks, optionally filtered by required role.
   * 
   * Requirements: 3.5
   * 
   * @param roleFilter - Optional role to filter unassigned tasks by
   * @returns Array of unassigned tasks matching the filter
   */
  getUnassignedTasks(roleFilter?: Role): Task[];

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Validates whether a task can be assigned to a developer.
   * 
   * Requirements: 3.3, 3.4, 4.1, 4.2
   * 
   * @param taskId - The ID of the task
   * @param developerId - The ID of the developer
   * @returns Result with void on success or AssignmentError on failure
   * 
   * Errors:
   * - TASK_NOT_FOUND: If the task doesn't exist
   * - DEVELOPER_NOT_FOUND: If the developer isn't registered
   * - ROLE_MISMATCH: If the developer lacks the required role
   * - TASK_NOT_ASSIGNABLE: If the task is in an invalid state
   */
  validateAssignment(taskId: string, developerId: string): Result<void, AssignmentError>;

  // =========================================================================
  // History
  // =========================================================================

  /**
   * Gets the assignment history for a task.
   * 
   * Requirements: 16.1, 16.2, 16.3
   * 
   * @param taskId - The ID of the task
   * @returns Array of assignment history entries (empty if no history)
   */
  getAssignmentHistory(taskId: string): AssignmentHistoryEntry[];
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { Result, ok, err, Role, VALID_ROLES, isValidRole };


// =============================================================================
// Task Storage Interface
// =============================================================================

/**
 * Interface for task storage operations.
 * Allows the TaskAssignerImpl to work with different storage backends.
 */
export interface TaskStorage {
  /**
   * Gets a task by its ID.
   * @param taskId - The ID of the task to retrieve
   * @returns The task if found, null otherwise
   */
  getTask(taskId: string): Task | null;

  /**
   * Updates a task in storage.
   * @param task - The task to update
   */
  updateTask(task: Task): void;

  /**
   * Gets all tasks.
   * @returns Array of all tasks
   */
  getAllTasks(): Task[];
}

/**
 * In-memory task storage implementation for testing and development.
 */
export class InMemoryTaskStorage implements TaskStorage {
  private tasks: Map<string, Task> = new Map();

  /**
   * Adds a task to storage.
   * @param task - The task to add
   */
  addTask(task: Task): void {
    this.tasks.set(task.id, { ...task });
  }

  /**
   * Gets a task by ID.
   */
  getTask(taskId: string): Task | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task, assignment_history: [...task.assignment_history] } : null;
  }

  /**
   * Updates a task in storage.
   */
  updateTask(task: Task): void {
    this.tasks.set(task.id, { ...task, assignment_history: [...task.assignment_history] });
  }

  /**
   * Gets all tasks.
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).map(t => ({ 
      ...t, 
      assignment_history: [...t.assignment_history] 
    }));
  }

  /**
   * Removes a task from storage.
   * @param taskId - The ID of the task to remove
   */
  removeTask(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /**
   * Clears all tasks from storage.
   */
  clear(): void {
    this.tasks.clear();
  }

  /**
   * Gets the number of tasks in storage.
   */
  get size(): number {
    return this.tasks.size;
  }
}

// =============================================================================
// Team Manager Interface for Task Assigner
// =============================================================================

/**
 * Minimal interface for Team_Manager operations needed by Task_Assigner.
 * This allows TaskAssignerImpl to work with any Team_Manager implementation.
 */
export interface TeamManagerForAssigner {
  /**
   * Validates if a developer ID exists in the team.
   * @param developerId - The developer ID to validate
   * @returns true if the developer exists, false otherwise
   */
  validateDeveloperId(developerId: string): boolean;

  /**
   * Gets the roles of a team member.
   * @param developerId - The developer ID
   * @returns Result with the member's roles on success, or error if not found
   */
  getMemberRoles(developerId: string): Role[] | null;
}

// =============================================================================
// TaskAssignerImpl Implementation
// =============================================================================

/**
 * Configuration for TaskAssignerImpl.
 */
export interface TaskAssignerConfig {
  /** Team manager instance for developer validation */
  teamManager: TeamManagerForAssigner;
  /** Task storage instance */
  taskStorage: TaskStorage;
  /** ID of the user making assignments (optional, for audit trail) */
  currentUserId?: string;
}

/**
 * Concrete implementation of the Task_Assigner interface.
 * Handles task assignment to developers based on roles and availability.
 * 
 * Requirements: 3.1, 3.3, 3.4, 4.1, 4.3
 */
export class TaskAssignerImpl implements Task_Assigner {
  private config: TaskAssignerConfig;

  constructor(config: TaskAssignerConfig) {
    this.config = config;
  }

  // =========================================================================
  // Assignment operations
  // =========================================================================

  /**
   * Assigns a task to a specific developer.
   * 
   * Requirements: 3.1, 3.3, 3.4, 4.1, 4.3
   * 
   * @param taskId - The ID of the task to assign
   * @param developerId - The ID of the developer to assign the task to
   * @returns Result with Assignment on success or AssignmentError on failure
   */
  assignTask(taskId: string, developerId: string): Result<Assignment, AssignmentError> {
    // Validate input parameters
    if (!isValidTaskId(taskId)) {
      return err(invalidTaskDataError(taskId || '', 'Task ID is required and must be a non-empty string'));
    }

    if (!developerId || typeof developerId !== 'string' || developerId.trim() === '') {
      return err(developerNotFoundError(developerId || '', taskId));
    }

    // Validate the assignment is allowed
    const validationResult = this.validateAssignment(taskId, developerId);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    // Get the task from storage
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Get the previous assignee for history tracking
    const previousAssignee = task.assignment?.assignee ?? null;

    // Create the new assignment
    // Requirement 4.3: Record assignment timestamp
    const assignment = createAssignment(
      taskId,
      developerId,
      task.assignment?.role_required ?? null,
      this.config.currentUserId ?? null
    );

    // Create history entry for the assignment change
    // Requirements: 16.1, 16.2
    const historyEntry = createHistoryEntry(
      previousAssignee,
      developerId,
      previousAssignee ? 'Reassignment' : 'Initial assignment'
    );

    // Update the task with new assignment
    const updatedTask: Task = {
      ...task,
      assignment,
      assignment_history: [...task.assignment_history, historyEntry],
    };

    // Persist the changes
    this.config.taskStorage.updateTask(updatedTask);

    return ok(assignment);
  }

  /**
   * Removes the assignment from a task, making it unassigned.
   * 
   * @param taskId - The ID of the task to unassign
   * @returns Result with void on success or AssignmentError on failure
   */
  unassignTask(taskId: string): Result<void, AssignmentError> {
    // Validate task ID
    if (!isValidTaskId(taskId)) {
      return err(invalidTaskDataError(taskId || '', 'Task ID is required and must be a non-empty string'));
    }

    // Get the task
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Check if task has an assignment
    if (!task.assignment?.assignee) {
      return err(taskNotAssignedError(taskId));
    }

    const previousAssignee = task.assignment.assignee;

    // Create new assignment state (unassigned but preserve role_required)
    const newAssignment = createAssignment(
      taskId,
      null,
      task.assignment.role_required,
      this.config.currentUserId ?? null
    );

    // Create history entry for unassignment
    const historyEntry = createHistoryEntry(
      previousAssignee,
      null,
      'Unassignment'
    );

    // Update the task
    const updatedTask: Task = {
      ...task,
      assignment: newAssignment,
      assignment_history: [...task.assignment_history, historyEntry],
    };

    this.config.taskStorage.updateTask(updatedTask);

    return ok(undefined);
  }

  /**
   * Allows a developer to pick up an unassigned task with a matching role.
   * 
   * Requirements: 3.5, 3.6
   * 
   * @param taskId - The ID of the task to pick up
   * @param developerId - The ID of the developer picking up the task
   * @returns Result with Assignment on success or AssignmentError on failure
   */
  pickupTask(taskId: string, developerId: string): Result<Assignment, AssignmentError> {
    // For pickup, we use the same validation as assignTask
    // The validation will check:
    // - Task exists
    // - Developer exists
    // - Developer has required role (if role_required is set)
    // - Task is not already assigned
    return this.assignTask(taskId, developerId);
  }

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Gets the current assignment information for a task.
   * 
   * @param taskId - The ID of the task to query
   * @returns Assignment if the task has one, null otherwise
   */
  getAssignment(taskId: string): Assignment | null {
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return null;
    }
    return task.assignment ?? null;
  }

  /**
   * Gets all tasks assigned to a specific developer.
   * 
   * @param developerId - The ID of the developer
   * @returns Array of tasks assigned to the developer
   */
  getTasksByDeveloper(developerId: string): Task[] {
    const allTasks = this.config.taskStorage.getAllTasks();
    return allTasks.filter(task => task.assignment?.assignee === developerId);
  }

  /**
   * Gets all unassigned tasks, optionally filtered by required role.
   * 
   * Requirements: 3.5
   * 
   * @param roleFilter - Optional role to filter unassigned tasks by
   * @returns Array of unassigned tasks matching the filter
   */
  getUnassignedTasks(roleFilter?: Role): Task[] {
    const allTasks = this.config.taskStorage.getAllTasks();
    
    let unassignedTasks = allTasks.filter(task => 
      !task.assignment?.assignee || task.assignment.state === 'UNASSIGNED' || task.assignment.state === 'AVAILABLE_FOR_PICKUP'
    );

    if (roleFilter) {
      unassignedTasks = unassignedTasks.filter(task => 
        task.assignment?.role_required === roleFilter
      );
    }

    return unassignedTasks;
  }

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Validates whether a task can be assigned to a developer.
   * 
   * Requirements: 3.3, 3.4, 4.1, 4.2
   * 
   * This method performs all validation checks without making any changes:
   * 1. Validates task exists
   * 2. Validates task is in an assignable state
   * 3. Validates task is not already assigned (unless reassigning)
   * 4. Validates developer exists via Team_Manager
   * 5. Validates developer has required role (if role_required is set)
   * 
   * @param taskId - The ID of the task
   * @param developerId - The ID of the developer
   * @returns Result with void on success or AssignmentError on failure
   */
  validateAssignment(taskId: string, developerId: string): Result<void, AssignmentError> {
    // 1. Validate task ID format
    if (!isValidTaskId(taskId)) {
      return err(invalidTaskDataError(taskId || '', 'Task ID is required and must be a non-empty string'));
    }

    // 2. Get the task and validate it exists
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // 3. Validate task is in an assignable state
    // Task must be in TODO, READY, or BLOCKED status to be assigned
    if (!isAssignableStatus(task.status)) {
      return err(taskNotAssignableError(taskId, task.status));
    }

    // 4. Validate task is not already assigned to someone else
    // (Note: We allow reassignment to the same developer without error)
    if (task.assignment?.assignee && task.assignment.assignee !== developerId) {
      return err(taskAlreadyAssignedError(taskId, task.assignment.assignee));
    }

    // 5. Validate developer ID format
    if (!developerId || typeof developerId !== 'string' || developerId.trim() === '') {
      return err(developerNotFoundError(developerId || '', taskId));
    }

    // Requirement 4.1: Validate developer exists via Team_Manager
    // WHEN a task is assigned to a non-existent developer id, 
    // THE Task_Assigner SHALL reject the assignment
    if (!this.config.teamManager.validateDeveloperId(developerId)) {
      return err(developerNotFoundError(developerId, taskId));
    }

    // 6. Validate role_required if set
    // Requirement 3.3: WHEN a task specifies both assignee and role_required, 
    // THE Task_Assigner SHALL verify the assignee has the required role
    // Requirement 3.4: IF a task specifies an assignee without the required role, 
    // THEN THE Task_Assigner SHALL reject the assignment
    const roleRequired = task.assignment?.role_required;
    if (roleRequired) {
      // First validate the role itself is valid
      // Requirement 4.2: WHEN a task specifies an invalid role in role_required,
      // THE Task_Assigner SHALL reject the task creation
      if (!isValidRole(roleRequired)) {
        return err(invalidRoleRequiredError(roleRequired, taskId));
      }

      // Get the developer's roles
      const developerRoles = this.config.teamManager.getMemberRoles(developerId);
      if (!developerRoles) {
        // If we can't get roles, the developer doesn't exist
        return err(developerNotFoundError(developerId, taskId));
      }

      // Check if developer has the required role
      // Requirement 3.4: Reject assignment if developer lacks required role
      if (!developerRoles.includes(roleRequired)) {
        return err(roleMismatchError(developerId, roleRequired, developerRoles, taskId));
      }
    }

    // All validations passed
    return ok(undefined);
  }

  // =========================================================================
  // History
  // =========================================================================

  /**
   * Gets the assignment history for a task.
   * 
   * Requirements: 16.1, 16.2, 16.3
   * 
   * @param taskId - The ID of the task
   * @returns Array of assignment history entries (empty if no history)
   */
  getAssignmentHistory(taskId: string): AssignmentHistoryEntry[] {
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return [];
    }
    return [...task.assignment_history];
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new Task with default assignment fields.
 * Useful for testing and task creation.
 */
export function createTask(
  id: string,
  title: string,
  status: TaskStatus = 'TODO',
  roleRequired: Role | null = null
): Task {
  return {
    id,
    title,
    status,
    assignment: roleRequired ? createAssignment(id, null, roleRequired, null) : undefined,
    assignment_history: [],
    depends_on: [],
    parallel_group: null,
  };
}

/**
 * Creates a TaskAssignerImpl with in-memory storage for testing.
 * 
 * @param teamManager - The team manager for developer validation
 * @param currentUserId - Optional ID of the user making assignments
 * @returns TaskAssignerImpl instance with in-memory storage
 */
export function createInMemoryTaskAssigner(
  teamManager: TeamManagerForAssigner,
  currentUserId?: string
): { assigner: TaskAssignerImpl; storage: InMemoryTaskStorage } {
  const storage = new InMemoryTaskStorage();
  const assigner = new TaskAssignerImpl({
    teamManager,
    taskStorage: storage,
    currentUserId,
  });
  return { assigner, storage };
}
