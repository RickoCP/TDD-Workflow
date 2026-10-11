/**
 * Parallel Group Manager - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Parallel_Group_Manager component
 * which manages parallel task groups and tracks group progress.
 * 
 * Requirements: 5.1, 6.1
 */

import { Result, ok, err, Role } from './team-manager';

// =============================================================================
// Constants
// =============================================================================

/**
 * Valid parallel group statuses.
 * Requirements: 5.5, 6.3
 */
export const PARALLEL_GROUP_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETE'] as const;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Parallel group status type derived from valid statuses constant.
 * Requirements: 5.5, 6.3
 */
export type ParallelGroupStatus = typeof PARALLEL_GROUP_STATUSES[number];

/**
 * Task status type used by parallel groups.
 */
export type TaskStatusForGroups = 'TODO' | 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'VERIFY' | 'DONE';

/**
 * Group progress metrics.
 * Requirements: 6.1, 6.2
 */
export interface GroupProgress {
  /** Total number of tasks in the group */
  total: number;
  /** Number of completed tasks (DONE status) */
  completed: number;
  /** Completion percentage (0-100) */
  percentage: number;
  /** Tasks by status breakdown */
  byStatus: Record<TaskStatusForGroups, number>;
}

/**
 * A member task within a parallel group.
 * Requirements: 5.1
 */
export interface GroupMember {
  /** Unique task identifier */
  taskId: string;
  /** Task title */
  title: string;
  /** Current task status */
  status: TaskStatusForGroups;
  /** Assignee developer ID (optional) */
  assignee?: string;
  /** Role required for this task (optional) */
  role_required?: Role;
  /** Timestamp when task was added to group */
  added_at: string;
}

/**
 * Constraints for a parallel group.
 * Requirements: 5.2 (no internal blocking dependencies)
 */
export interface GroupConstraint {
  /** Maximum number of concurrent tasks (optional, for future enhancement) */
  maxConcurrent?: number;
  /** Required skills/roles for the group (optional) */
  requiredRoles?: Role[];
  /** Whether to enforce no internal blocking dependencies (default: true) */
  enforceNoInternalBlocking: boolean;
}

/**
 * Parallel group definition used for creation.
 * Requirements: 5.1, 5.4
 */
export interface ParallelGroupDefinition {
  /** Unique identifier for the group */
  id: string;
  /** Human-readable name for the group */
  name: string;
  /** Associated milestone ID (optional) */
  milestone?: string;
  /** Initial task IDs to include in the group */
  taskIds: string[];
  /** Constraints for the group (optional) */
  constraints?: Partial<GroupConstraint>;
}

/**
 * Parallel group representation.
 * Requirements: 5.1, 5.4, 5.5, 6.1
 */
export interface ParallelGroup {
  /** Unique identifier for the group */
  id: string;
  /** Human-readable name for the group */
  name: string;
  /** Associated milestone ID (optional) */
  milestone?: string;
  /** Tasks in the group */
  tasks: GroupMember[];
  /** Task IDs for quick lookup */
  taskIds: string[];
  /** Timestamp when the group was created */
  created_at: string;
  /** Current status of the group */
  status: ParallelGroupStatus;
  /** Progress metrics for the group */
  progress: GroupProgress;
  /** Constraints applied to this group */
  constraints: GroupConstraint;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Parallel group error codes following the design specification.
 * Error codes in range 1500-1599.
 * 
 * Note: The design document specifies range 1500-1599 for PARALLEL_GROUP_ERROR.
 * Error codes 1301-1307 from the task description are mapped as follows:
 * - 1301 -> 1501 GROUP_NOT_FOUND
 * - 1302 -> 1502 TASK_ALREADY_IN_GROUP
 * - 1303 -> 1503 GROUP_CAPACITY_EXCEEDED
 * - 1304 -> 1504 CONSTRAINT_VIOLATION
 * - 1305 -> 1505 INVALID_GROUP_NAME
 * - 1306 -> 1506 DUPLICATE_GROUP
 * - 1307 -> 1507 GROUP_HAS_ACTIVE_TASKS
 */
export enum ParallelGroupErrorCode {
  /** Internal blocking dependency conflict within group tasks */
  INTERNAL_DEPENDENCY_CONFLICT = 1501,
  /** Group ID not found */
  GROUP_NOT_FOUND = 1502,
  /** Task already belongs to another group */
  TASK_ALREADY_IN_GROUP = 1503,
  /** Invalid milestone reference */
  INVALID_MILESTONE_REF = 1504,
  /** Task not found */
  TASK_NOT_FOUND = 1505,
  /** Group name is invalid (empty or too long) */
  INVALID_GROUP_NAME = 1506,
  /** A group with this ID already exists */
  DUPLICATE_GROUP = 1507,
  /** Cannot delete group with active tasks */
  GROUP_HAS_ACTIVE_TASKS = 1508,
  /** Group capacity exceeded (for future maxConcurrent support) */
  GROUP_CAPACITY_EXCEEDED = 1509,
  /** General constraint violation */
  CONSTRAINT_VIOLATION = 1510,
  /** Task not in the specified group */
  TASK_NOT_IN_GROUP = 1511,
}

/**
 * Parallel group error structure following the design specification.
 */
export interface ParallelGroupError {
  /** Error code from ParallelGroupErrorCode enum */
  code: ParallelGroupErrorCode;
  /** Error category */
  category: 'PARALLEL_GROUP_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    group_id?: string;
    group_name?: string;
    task_id?: string;
    task_ids?: string[];
    milestone_id?: string;
    existing_group?: string;
    conflicting_dependencies?: Array<{ from: string; to: string; type: string }>;
    active_task_count?: number;
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
 * Creates a ParallelGroupError with the given code and details.
 */
export function createParallelGroupError(
  code: ParallelGroupErrorCode,
  message: string,
  context?: ParallelGroupError['context'],
  suggested_action?: string
): ParallelGroupError {
  return {
    code,
    category: 'PARALLEL_GROUP_ERROR',
    message,
    context,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an "internal dependency conflict" error.
 * Requirements: 5.2, 5.3
 */
export function internalDependencyConflictError(
  groupId: string,
  conflicts: Array<{ from: string; to: string; type: string }>
): ParallelGroupError {
  const conflictDescs = conflicts.map(c => `${c.from} -> ${c.to} (${c.type})`).join(', ');
  return createParallelGroupError(
    ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT,
    `Parallel group '${groupId}' contains tasks with internal blocking dependencies: ${conflictDescs}`,
    { group_id: groupId, conflicting_dependencies: conflicts },
    'Remove blocking dependencies between tasks or split them into separate groups'
  );
}

/**
 * Creates a "group not found" error.
 */
export function groupNotFoundError(groupId: string): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.GROUP_NOT_FOUND,
    `Parallel group '${groupId}' not found`,
    { group_id: groupId },
    'Verify the group ID or create the group first'
  );
}

/**
 * Creates a "task already in group" error.
 */
export function taskAlreadyInGroupError(taskId: string, existingGroupId: string): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.TASK_ALREADY_IN_GROUP,
    `Task '${taskId}' is already in parallel group '${existingGroupId}'`,
    { task_id: taskId, existing_group: existingGroupId },
    'Remove the task from the existing group first or use a different task'
  );
}

/**
 * Creates an "invalid milestone reference" error.
 */
export function invalidMilestoneRefError(groupId: string, milestoneId: string): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.INVALID_MILESTONE_REF,
    `Milestone '${milestoneId}' referenced by group '${groupId}' does not exist`,
    { group_id: groupId, milestone_id: milestoneId },
    'Create the milestone first or use an existing milestone ID'
  );
}

/**
 * Creates a "task not found" error.
 */
export function taskNotFoundForGroupError(taskId: string, groupId?: string): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.TASK_NOT_FOUND,
    `Task '${taskId}' not found`,
    { task_id: taskId, group_id: groupId },
    'Verify the task ID or create the task first'
  );
}

/**
 * Creates an "invalid group name" error.
 */
export function invalidGroupNameError(groupName: string): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.INVALID_GROUP_NAME,
    `Group name '${groupName}' is invalid`,
    { group_name: groupName },
    'Provide a non-empty group name with less than 100 characters'
  );
}

/**
 * Creates a "duplicate group" error.
 */
export function duplicateGroupError(groupId: string): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.DUPLICATE_GROUP,
    `Parallel group with ID '${groupId}' already exists`,
    { group_id: groupId },
    'Use a unique group ID or update the existing group'
  );
}

/**
 * Creates a "group has active tasks" error.
 */
export function groupHasActiveTasksError(groupId: string, activeCount: number): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.GROUP_HAS_ACTIVE_TASKS,
    `Cannot delete parallel group '${groupId}' with ${activeCount} active task(s)`,
    { group_id: groupId, active_task_count: activeCount },
    'Complete or remove all active tasks from the group before deleting'
  );
}

/**
 * Creates a "group capacity exceeded" error (for future use).
 */
export function groupCapacityExceededError(groupId: string, maxConcurrent: number): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.GROUP_CAPACITY_EXCEEDED,
    `Parallel group '${groupId}' has exceeded maximum concurrent capacity of ${maxConcurrent}`,
    { group_id: groupId },
    'Wait for some tasks to complete or increase the group capacity'
  );
}

/**
 * Creates a "constraint violation" error.
 */
export function constraintViolationError(groupId: string, violation: string): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.CONSTRAINT_VIOLATION,
    `Constraint violation in group '${groupId}': ${violation}`,
    { group_id: groupId },
    'Adjust the tasks or constraints to resolve the violation'
  );
}

/**
 * Creates a "task not in group" error.
 */
export function taskNotInGroupError(taskId: string, groupId: string): ParallelGroupError {
  return createParallelGroupError(
    ParallelGroupErrorCode.TASK_NOT_IN_GROUP,
    `Task '${taskId}' is not in parallel group '${groupId}'`,
    { task_id: taskId, group_id: groupId },
    'Verify the task belongs to this group or add it first'
  );
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates if a string is a valid parallel group status.
 */
export function isValidParallelGroupStatus(status: string): status is ParallelGroupStatus {
  return PARALLEL_GROUP_STATUSES.includes(status as ParallelGroupStatus);
}

/**
 * Validates if a group ID follows valid format.
 * Group IDs must be non-empty strings.
 */
export function isValidGroupId(groupId: string): boolean {
  return typeof groupId === 'string' && groupId.trim().length > 0;
}

/**
 * Validates if a group name is valid.
 * Names must be non-empty strings with less than 100 characters.
 */
export function isValidGroupName(name: string): boolean {
  return typeof name === 'string' && name.trim().length > 0 && name.length < 100;
}

/**
 * Validates a parallel group definition.
 * Returns a Result with void on success or ParallelGroupError on failure.
 */
export function validateGroupDefinition(
  definition: ParallelGroupDefinition
): Result<void, ParallelGroupError> {
  // Validate group ID
  if (!isValidGroupId(definition.id)) {
    return err(createParallelGroupError(
      ParallelGroupErrorCode.INVALID_GROUP_NAME,
      'Group ID is required and must be a non-empty string',
      { group_id: definition.id },
      'Provide a valid, non-empty group ID'
    ));
  }

  // Validate group name
  if (!isValidGroupName(definition.name)) {
    return err(invalidGroupNameError(definition.name || ''));
  }

  // Validate task IDs are provided
  if (!definition.taskIds || !Array.isArray(definition.taskIds)) {
    return err(createParallelGroupError(
      ParallelGroupErrorCode.CONSTRAINT_VIOLATION,
      'Task IDs must be provided as an array',
      { group_id: definition.id },
      'Provide an array of task IDs to include in the group'
    ));
  }

  return ok(undefined);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates default group constraints.
 */
export function createDefaultConstraints(): GroupConstraint {
  return {
    enforceNoInternalBlocking: true,
  };
}

/**
 * Merges user-provided constraints with defaults.
 */
export function mergeConstraints(userConstraints?: Partial<GroupConstraint>): GroupConstraint {
  return {
    ...createDefaultConstraints(),
    ...userConstraints,
  };
}

/**
 * Creates an empty progress object.
 */
export function createEmptyProgress(): GroupProgress {
  return {
    total: 0,
    completed: 0,
    percentage: 0,
    byStatus: {
      TODO: 0,
      READY: 0,
      IN_PROGRESS: 0,
      BLOCKED: 0,
      VERIFY: 0,
      DONE: 0,
    },
  };
}

/**
 * Calculates progress from a list of group members.
 * Requirements: 6.1
 */
export function calculateProgress(members: GroupMember[]): GroupProgress {
  const progress = createEmptyProgress();
  progress.total = members.length;

  for (const member of members) {
    progress.byStatus[member.status]++;
    if (member.status === 'DONE') {
      progress.completed++;
    }
  }

  progress.percentage = progress.total > 0 
    ? Math.round((progress.completed / progress.total) * 100) 
    : 0;

  return progress;
}

/**
 * Determines the group status based on progress.
 * Requirements: 6.3
 */
export function determineGroupStatus(progress: GroupProgress): ParallelGroupStatus {
  if (progress.total === 0) {
    return 'PENDING';
  }
  if (progress.completed === progress.total) {
    return 'COMPLETE';
  }
  // Check if any task has started
  const hasStartedTasks = progress.byStatus.IN_PROGRESS > 0 || 
                          progress.byStatus.BLOCKED > 0 || 
                          progress.byStatus.VERIFY > 0 ||
                          progress.byStatus.DONE > 0;
  return hasStartedTasks ? 'IN_PROGRESS' : 'PENDING';
}

/**
 * Creates a GroupMember from basic task data.
 */
export function createGroupMember(
  taskId: string,
  title: string,
  status: TaskStatusForGroups,
  assignee?: string,
  role_required?: Role
): GroupMember {
  return {
    taskId,
    title,
    status,
    assignee,
    role_required,
    added_at: new Date().toISOString(),
  };
}

/**
 * Creates a new ParallelGroup from a definition.
 */
export function createParallelGroup(
  definition: ParallelGroupDefinition,
  members: GroupMember[]
): ParallelGroup {
  const constraints = mergeConstraints(definition.constraints);
  const progress = calculateProgress(members);
  const status = determineGroupStatus(progress);

  return {
    id: definition.id,
    name: definition.name,
    milestone: definition.milestone,
    tasks: members,
    taskIds: members.map(m => m.taskId),
    created_at: new Date().toISOString(),
    status,
    progress,
    constraints,
  };
}

// =============================================================================
// Parallel_Group_Manager Interface
// =============================================================================

/**
 * Parallel_Group_Manager interface for managing parallel task groups
 * and tracking group progress.
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3
 */
export interface Parallel_Group_Manager {
  // =========================================================================
  // Group operations
  // =========================================================================

  /**
   * Creates a new parallel task group.
   * 
   * Requirements: 5.1, 5.2, 5.3, 5.4
   * 
   * @param definition - The group definition with id, name, and task IDs
   * @returns Result with void on success or ParallelGroupError on failure
   * 
   * Errors:
   * - DUPLICATE_GROUP: If a group with the same ID already exists
   * - INVALID_GROUP_NAME: If the group name is invalid
   * - TASK_NOT_FOUND: If any task ID doesn't exist
   * - TASK_ALREADY_IN_GROUP: If any task already belongs to another group
   * - INTERNAL_DEPENDENCY_CONFLICT: If tasks have internal blocking dependencies
   * - INVALID_MILESTONE_REF: If the milestone doesn't exist
   */
  createGroup(definition: ParallelGroupDefinition): Result<void, ParallelGroupError>;

  /**
   * Adds a task to an existing parallel group.
   * 
   * Requirements: 5.2, 5.3
   * 
   * @param groupId - The ID of the group to add the task to
   * @param taskId - The ID of the task to add
   * @returns Result with void on success or ParallelGroupError on failure
   * 
   * Errors:
   * - GROUP_NOT_FOUND: If the group doesn't exist
   * - TASK_NOT_FOUND: If the task doesn't exist
   * - TASK_ALREADY_IN_GROUP: If the task already belongs to a group
   * - INTERNAL_DEPENDENCY_CONFLICT: If adding would create internal blocking deps
   */
  addToGroup(groupId: string, taskId: string): Result<void, ParallelGroupError>;

  /**
   * Removes a task from a parallel group.
   * 
   * @param groupId - The ID of the group to remove the task from
   * @param taskId - The ID of the task to remove
   * @returns Result with void on success or ParallelGroupError on failure
   * 
   * Errors:
   * - GROUP_NOT_FOUND: If the group doesn't exist
   * - TASK_NOT_IN_GROUP: If the task is not in the group
   */
  removeFromGroup(groupId: string, taskId: string): Result<void, ParallelGroupError>;

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Gets a parallel group by its ID.
   * 
   * @param groupId - The ID of the group to retrieve
   * @returns Result with ParallelGroup on success or ParallelGroupError on failure
   * 
   * Errors:
   * - GROUP_NOT_FOUND: If the group doesn't exist
   */
  getGroup(groupId: string): Result<ParallelGroup, ParallelGroupError>;

  /**
   * Gets all parallel groups.
   * 
   * @returns Array of all parallel groups
   */
  getAllGroups(): ParallelGroup[];

  /**
   * Finds which group a task belongs to.
   * 
   * @param taskId - The ID of the task to find
   * @returns The parallel group the task belongs to, or null if not in any group
   */
  getGroupByTask(taskId: string): ParallelGroup | null;

  /**
   * Gets groups associated with a specific milestone.
   * 
   * @param milestoneId - The milestone ID to filter by
   * @returns Array of parallel groups associated with the milestone
   */
  getGroupsByMilestone(milestoneId: string): ParallelGroup[];

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Checks if a task can be added to a group.
   * Validates that the task exists, isn't in another group, and wouldn't
   * create internal blocking dependencies.
   * 
   * Requirements: 5.2, 5.3
   * 
   * @param groupId - The ID of the group
   * @param taskId - The ID of the task to check
   * @returns Result with void on success or ParallelGroupError on failure
   */
  canAddToGroup(groupId: string, taskId: string): Result<void, ParallelGroupError>;

  /**
   * Validates that a set of task IDs have no internal blocking dependencies.
   * 
   * Requirements: 5.2
   * 
   * @param taskIds - Array of task IDs to validate
   * @returns Result with void on success or ParallelGroupError on failure
   */
  validateGroupTasks(taskIds: string[]): Result<void, ParallelGroupError>;

  // =========================================================================
  // Progress tracking
  // =========================================================================

  /**
   * Gets the progress metrics for a parallel group.
   * 
   * Requirements: 6.1, 6.2
   * 
   * @param groupId - The ID of the group
   * @returns Result with GroupProgress on success or ParallelGroupError on failure
   * 
   * Errors:
   * - GROUP_NOT_FOUND: If the group doesn't exist
   */
  getGroupProgress(groupId: string): Result<GroupProgress, ParallelGroupError>;

  // =========================================================================
  // Notifications
  // =========================================================================

  /**
   * Notifies the group manager that a task has been completed.
   * Updates group progress and status accordingly.
   * 
   * Requirements: 5.5, 6.3, 15.3
   * 
   * @param taskId - The ID of the completed task
   */
  notifyTaskCompletion(taskId: string): void;

  /**
   * Notifies the group manager that a task status has changed.
   * Updates group progress and status accordingly.
   * 
   * @param taskId - The ID of the task
   * @param newStatus - The new status of the task
   */
  notifyTaskStatusChange(taskId: string, newStatus: TaskStatusForGroups): void;
}

// =============================================================================
// Task Storage Interface for Parallel Group Manager
// =============================================================================

/**
 * Task data required by Parallel_Group_Manager.
 */
export interface TaskForGroups {
  /** Unique task identifier */
  id: string;
  /** Task title */
  title: string;
  /** Current task status */
  status: TaskStatusForGroups;
  /** Role required for this task (optional) */
  role_required?: Role;
  /** Assignee developer ID (optional) */
  assignee?: string;
  /** Dependencies for this task */
  depends_on?: Array<{
    task_id: string;
    type: 'blocking' | 'non_blocking';
  }>;
}

/**
 * Interface for task storage operations needed by Parallel_Group_Manager.
 */
export interface TaskStorageForGroups {
  /**
   * Gets a task by its ID.
   * @param taskId - The ID of the task to retrieve
   * @returns The task if found, null otherwise
   */
  getTask(taskId: string): TaskForGroups | null;

  /**
   * Gets all tasks.
   * @returns Array of all tasks
   */
  getAllTasks(): TaskForGroups[];
}

/**
 * Interface for parallel group storage operations.
 */
export interface ParallelGroupStorage {
  /**
   * Gets a group by its ID.
   * @param groupId - The ID of the group to retrieve
   * @returns The group if found, null otherwise
   */
  getGroup(groupId: string): ParallelGroup | null;

  /**
   * Stores a group.
   * @param group - The group to store
   */
  saveGroup(group: ParallelGroup): void;

  /**
   * Removes a group.
   * @param groupId - The ID of the group to remove
   */
  removeGroup(groupId: string): void;

  /**
   * Gets all groups.
   * @returns Array of all groups
   */
  getAllGroups(): ParallelGroup[];
}

/**
 * In-memory parallel group storage implementation for testing and development.
 */
export class InMemoryParallelGroupStorage implements ParallelGroupStorage {
  private groups: Map<string, ParallelGroup> = new Map();

  /**
   * Gets a group by ID.
   */
  getGroup(groupId: string): ParallelGroup | null {
    const group = this.groups.get(groupId);
    if (!group) return null;
    return { ...group, tasks: [...group.tasks], taskIds: [...group.taskIds] };
  }

  /**
   * Stores a group.
   */
  saveGroup(group: ParallelGroup): void {
    this.groups.set(group.id, { 
      ...group, 
      tasks: [...group.tasks], 
      taskIds: [...group.taskIds] 
    });
  }

  /**
   * Removes a group.
   */
  removeGroup(groupId: string): void {
    this.groups.delete(groupId);
  }

  /**
   * Gets all groups.
   */
  getAllGroups(): ParallelGroup[] {
    return Array.from(this.groups.values()).map(g => ({
      ...g,
      tasks: [...g.tasks],
      taskIds: [...g.taskIds],
    }));
  }

  /**
   * Clears all groups from storage.
   */
  clear(): void {
    this.groups.clear();
  }

  /**
   * Gets the number of groups in storage.
   */
  get size(): number {
    return this.groups.size;
  }
}

/**
 * In-memory task storage for testing.
 */
export class InMemoryTaskStorageForGroups implements TaskStorageForGroups {
  private tasks: Map<string, TaskForGroups> = new Map();

  /**
   * Adds a task to storage.
   */
  addTask(task: TaskForGroups): void {
    this.tasks.set(task.id, { ...task });
  }

  /**
   * Gets a task by ID.
   */
  getTask(taskId: string): TaskForGroups | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return { ...task };
  }

  /**
   * Updates a task in storage.
   */
  updateTask(task: TaskForGroups): void {
    this.tasks.set(task.id, { ...task });
  }

  /**
   * Gets all tasks.
   */
  getAllTasks(): TaskForGroups[] {
    return Array.from(this.tasks.values()).map(t => ({ ...t }));
  }

  /**
   * Removes a task from storage.
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
// Configuration for Parallel Group Manager Implementation
// =============================================================================

/**
 * Configuration for ParallelGroupManagerImpl
 */
export interface ParallelGroupManagerConfig {
  /** Task storage backend */
  taskStorage: TaskStorageForGroups;
  /** Group storage backend */
  groupStorage: ParallelGroupStorage;
  /** Optional callback to validate milestones exist */
  validateMilestone?: (milestoneId: string) => boolean;
}

// =============================================================================
// Parallel_Group_Manager Implementation
// =============================================================================

/**
 * Implementation of the Parallel_Group_Manager interface.
 * 
 * Manages parallel task groups and tracks group progress.
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3
 */
export class ParallelGroupManagerImpl implements Parallel_Group_Manager {
  private config: ParallelGroupManagerConfig;

  constructor(config: ParallelGroupManagerConfig) {
    this.config = config;
  }

  // =========================================================================
  // Group operations
  // =========================================================================

  /**
   * Creates a new parallel task group.
   * 
   * Requirements: 5.1, 5.2, 5.3, 5.4
   * 
   * @param definition - The group definition with id, name, and task IDs
   * @returns Result with void on success or ParallelGroupError on failure
   */
  createGroup(definition: ParallelGroupDefinition): Result<void, ParallelGroupError> {
    // 1. Validate the group definition (name, id)
    const definitionValidation = validateGroupDefinition(definition);
    if (!definitionValidation.success) {
      return definitionValidation;
    }

    // 2. Check for duplicate group IDs
    const existingGroup = this.config.groupStorage.getGroup(definition.id);
    if (existingGroup) {
      return err(duplicateGroupError(definition.id));
    }

    // 3. Validate all tasks exist
    const members: GroupMember[] = [];
    for (const taskId of definition.taskIds) {
      const task = this.config.taskStorage.getTask(taskId);
      if (!task) {
        return err(taskNotFoundForGroupError(taskId, definition.id));
      }
      members.push(createGroupMember(
        task.id,
        task.title,
        task.status,
        task.assignee,
        task.role_required
      ));
    }

    // 4. Validate no task is already in another group
    for (const taskId of definition.taskIds) {
      const existingGroupForTask = this.getGroupByTask(taskId);
      if (existingGroupForTask) {
        return err(taskAlreadyInGroupError(taskId, existingGroupForTask.id));
      }
    }

    // 5. Validate no internal blocking dependencies between tasks in the group
    // Requirements: 5.2, 5.3
    const internalDepValidation = this.checkInternalBlockingDependencies(definition.taskIds);
    if (!internalDepValidation.success) {
      return internalDepValidation;
    }

    // 6. Validate milestone if provided
    if (definition.milestone && this.config.validateMilestone) {
      if (!this.config.validateMilestone(definition.milestone)) {
        return err(invalidMilestoneRefError(definition.id, definition.milestone));
      }
    }

    // 7. Create the group with initial progress calculation
    const group = createParallelGroup(definition, members);

    // 8. Save the group to storage
    this.config.groupStorage.saveGroup(group);

    return ok(undefined);
  }

  /**
   * Checks for internal blocking dependencies between tasks in a group.
   * 
   * Requirements: 5.2, 5.3
   * 
   * @param taskIds - Array of task IDs to check
   * @returns Result with void on success or ParallelGroupError on failure
   */
  private checkInternalBlockingDependencies(taskIds: string[]): Result<void, ParallelGroupError> {
    const taskIdSet = new Set(taskIds);
    const conflicts: Array<{ from: string; to: string; type: string }> = [];

    for (const taskId of taskIds) {
      const task = this.config.taskStorage.getTask(taskId);
      if (!task || !task.depends_on) {
        continue;
      }

      // Check each dependency
      for (const dep of task.depends_on) {
        // If the dependency is on another task within the group AND it's blocking,
        // this is an internal blocking dependency conflict
        if (taskIdSet.has(dep.task_id) && dep.type === 'blocking') {
          conflicts.push({
            from: taskId,
            to: dep.task_id,
            type: 'blocking',
          });
        }
      }
    }

    if (conflicts.length > 0) {
      return err(internalDependencyConflictError(taskIds.join(','), conflicts));
    }

    return ok(undefined);
  }

  /**
   * Adds a task to an existing parallel group.
   * 
   * Requirements: 5.2, 5.3
   * 
   * @param groupId - The ID of the group to add the task to
   * @param taskId - The ID of the task to add
   * @returns Result with void on success or ParallelGroupError on failure
   */
  addToGroup(groupId: string, taskId: string): Result<void, ParallelGroupError> {
    // 1. Check if group exists
    const group = this.config.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }

    // 2. Check if task exists
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForGroupError(taskId, groupId));
    }

    // 3. Check if task is already in another group
    const existingGroupForTask = this.getGroupByTask(taskId);
    if (existingGroupForTask) {
      return err(taskAlreadyInGroupError(taskId, existingGroupForTask.id));
    }

    // 4. Validate adding this task won't create internal blocking dependencies
    const newTaskIds = [...group.taskIds, taskId];
    const internalDepValidation = this.checkInternalBlockingDependencies(newTaskIds);
    if (!internalDepValidation.success) {
      return internalDepValidation;
    }

    // 5. Add the task to the group
    const newMember = createGroupMember(
      task.id,
      task.title,
      task.status,
      task.assignee,
      task.role_required
    );

    group.tasks.push(newMember);
    group.taskIds.push(taskId);

    // 6. Recalculate progress and status
    group.progress = calculateProgress(group.tasks);
    group.status = determineGroupStatus(group.progress);

    // 7. Save the updated group
    this.config.groupStorage.saveGroup(group);

    return ok(undefined);
  }

  /**
   * Removes a task from a parallel group.
   * 
   * @param groupId - The ID of the group to remove the task from
   * @param taskId - The ID of the task to remove
   * @returns Result with void on success or ParallelGroupError on failure
   */
  removeFromGroup(groupId: string, taskId: string): Result<void, ParallelGroupError> {
    // 1. Check if group exists
    const group = this.config.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }

    // 2. Check if task is in the group
    const taskIndex = group.taskIds.indexOf(taskId);
    if (taskIndex === -1) {
      return err(taskNotInGroupError(taskId, groupId));
    }

    // 3. Remove the task from the group
    group.taskIds.splice(taskIndex, 1);
    group.tasks = group.tasks.filter(t => t.taskId !== taskId);

    // 4. Recalculate progress and status
    group.progress = calculateProgress(group.tasks);
    group.status = determineGroupStatus(group.progress);

    // 5. Save the updated group
    this.config.groupStorage.saveGroup(group);

    return ok(undefined);
  }

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Gets a parallel group by its ID.
   * 
   * @param groupId - The ID of the group to retrieve
   * @returns Result with ParallelGroup on success or ParallelGroupError on failure
   */
  getGroup(groupId: string): Result<ParallelGroup, ParallelGroupError> {
    const group = this.config.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }
    return ok(group);
  }

  /**
   * Gets all parallel groups.
   * 
   * @returns Array of all parallel groups
   */
  getAllGroups(): ParallelGroup[] {
    return this.config.groupStorage.getAllGroups();
  }

  /**
   * Finds which group a task belongs to.
   * 
   * @param taskId - The ID of the task to find
   * @returns The parallel group the task belongs to, or null if not in any group
   */
  getGroupByTask(taskId: string): ParallelGroup | null {
    const allGroups = this.config.groupStorage.getAllGroups();
    for (const group of allGroups) {
      if (group.taskIds.includes(taskId)) {
        return group;
      }
    }
    return null;
  }

  /**
   * Gets groups associated with a specific milestone.
   * 
   * @param milestoneId - The milestone ID to filter by
   * @returns Array of parallel groups associated with the milestone
   */
  getGroupsByMilestone(milestoneId: string): ParallelGroup[] {
    const allGroups = this.config.groupStorage.getAllGroups();
    return allGroups.filter(group => group.milestone === milestoneId);
  }

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Checks if a task can be added to a group.
   * Validates that the task exists, isn't in another group, and wouldn't
   * create internal blocking dependencies.
   * 
   * Requirements: 5.2, 5.3
   * 
   * @param groupId - The ID of the group
   * @param taskId - The ID of the task to check
   * @returns Result with void on success or ParallelGroupError on failure
   */
  canAddToGroup(groupId: string, taskId: string): Result<void, ParallelGroupError> {
    // 1. Check if group exists
    const group = this.config.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }

    // 2. Check if task exists
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForGroupError(taskId, groupId));
    }

    // 3. Check if task is already in a group
    const existingGroupForTask = this.getGroupByTask(taskId);
    if (existingGroupForTask) {
      return err(taskAlreadyInGroupError(taskId, existingGroupForTask.id));
    }

    // 4. Check for internal blocking dependencies
    const newTaskIds = [...group.taskIds, taskId];
    return this.checkInternalBlockingDependencies(newTaskIds);
  }

  /**
   * Validates that a set of task IDs have no internal blocking dependencies.
   * 
   * Requirements: 5.2
   * 
   * @param taskIds - Array of task IDs to validate
   * @returns Result with void on success or ParallelGroupError on failure
   */
  validateGroupTasks(taskIds: string[]): Result<void, ParallelGroupError> {
    // First, check all tasks exist
    for (const taskId of taskIds) {
      const task = this.config.taskStorage.getTask(taskId);
      if (!task) {
        return err(taskNotFoundForGroupError(taskId));
      }
    }

    // Then check for internal blocking dependencies
    return this.checkInternalBlockingDependencies(taskIds);
  }

  // =========================================================================
  // Progress tracking
  // =========================================================================

  /**
   * Gets the progress metrics for a parallel group.
   * 
   * Requirements: 6.1, 6.2
   * 
   * @param groupId - The ID of the group
   * @returns Result with GroupProgress on success or ParallelGroupError on failure
   */
  getGroupProgress(groupId: string): Result<GroupProgress, ParallelGroupError> {
    const group = this.config.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }
    return ok(group.progress);
  }

  // =========================================================================
  // Notifications
  // =========================================================================

  /**
   * Notifies the group manager that a task has been completed.
   * Updates group progress and status accordingly.
   * 
   * Requirements: 5.5, 6.3, 15.3
   * 
   * @param taskId - The ID of the completed task
   */
  notifyTaskCompletion(taskId: string): void {
    this.notifyTaskStatusChange(taskId, 'DONE');
  }

  /**
   * Notifies the group manager that a task status has changed.
   * Updates group progress and status accordingly.
   * 
   * @param taskId - The ID of the task
   * @param newStatus - The new status of the task
   */
  notifyTaskStatusChange(taskId: string, newStatus: TaskStatusForGroups): void {
    // Find the group containing this task
    const group = this.getGroupByTask(taskId);
    if (!group) {
      // Task is not in any group, nothing to do
      return;
    }

    // Update the task status in the group
    const member = group.tasks.find(t => t.taskId === taskId);
    if (member) {
      member.status = newStatus;
    }

    // Recalculate progress and status
    group.progress = calculateProgress(group.tasks);
    group.status = determineGroupStatus(group.progress);

    // Save the updated group
    this.config.groupStorage.saveGroup(group);
  }
}
