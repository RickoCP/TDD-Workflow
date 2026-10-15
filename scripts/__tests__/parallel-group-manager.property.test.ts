/**
 * Property-Based Tests for Parallel_Group_Manager
 * 
 * **Feature: multi-developer-support, Property 7: Parallel Group Internal Dependency Constraint**
 * 
 * These tests verify the universal correctness properties of the Parallel_Group_Manager component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements 5.2, 5.3**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  ParallelGroup,
  ParallelGroupDefinition,
  ParallelGroupError,
  ParallelGroupErrorCode,
  GroupProgress,
  GroupMember,
  TaskForGroups,
  TaskStatusForGroups,
  Parallel_Group_Manager,
  InMemoryParallelGroupStorage,
  InMemoryTaskStorageForGroups,
  ParallelGroupManagerConfig,
  calculateProgress,
  determineGroupStatus,
  createGroupMember,
  createParallelGroup,
  internalDependencyConflictError,
  groupNotFoundError,
  duplicateGroupError,
  taskAlreadyInGroupError,
  taskNotFoundForGroupError,
} from '../parallel-group-manager';
import { Result, ok, err, Role } from '../team-manager';

// =============================================================================
// In-Memory Parallel_Group_Manager Implementation for Testing
// =============================================================================

/**
 * In-memory implementation of Parallel_Group_Manager for testing purposes.
 * This implementation follows the interface defined in parallel-group-manager.ts
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3
 */
class InMemoryParallelGroupManager implements Parallel_Group_Manager {
  private taskStorage: InMemoryTaskStorageForGroups;
  private groupStorage: InMemoryParallelGroupStorage;
  private validateMilestone?: (milestoneId: string) => boolean;

  constructor(config: ParallelGroupManagerConfig) {
    this.taskStorage = config.taskStorage as InMemoryTaskStorageForGroups;
    this.groupStorage = config.groupStorage as InMemoryParallelGroupStorage;
    this.validateMilestone = config.validateMilestone;
  }

  /**
   * Creates a new parallel task group.
   * 
   * Requirements: 5.1, 5.2, 5.3, 5.4
   */
  createGroup(definition: ParallelGroupDefinition): Result<void, ParallelGroupError> {
    // Check for duplicate group ID
    if (this.groupStorage.getGroup(definition.id)) {
      return err(duplicateGroupError(definition.id));
    }

    // Validate group name
    if (!definition.name || definition.name.trim().length === 0 || definition.name.length >= 100) {
      return err({
        code: ParallelGroupErrorCode.INVALID_GROUP_NAME,
        category: 'PARALLEL_GROUP_ERROR',
        message: `Group name '${definition.name}' is invalid`,
        context: { group_name: definition.name },
        suggested_action: 'Provide a non-empty group name with less than 100 characters',
        timestamp: new Date().toISOString(),
      });
    }

    // Validate all tasks exist
    const members: GroupMember[] = [];
    for (const taskId of definition.taskIds) {
      const task = this.taskStorage.getTask(taskId);
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

    // Check tasks are not already in another group
    for (const taskId of definition.taskIds) {
      const existingGroup = this.getGroupByTask(taskId);
      if (existingGroup) {
        return err(taskAlreadyInGroupError(taskId, existingGroup.id));
      }
    }

    // Validate no internal blocking dependencies - Requirement 5.2, 5.3
    const validationResult = this.validateGroupTasks(definition.taskIds);
    if (!validationResult.success) {
      return validationResult;
    }

    // Validate milestone if provided
    if (definition.milestone && this.validateMilestone) {
      if (!this.validateMilestone(definition.milestone)) {
        return err({
          code: ParallelGroupErrorCode.INVALID_MILESTONE_REF,
          category: 'PARALLEL_GROUP_ERROR',
          message: `Milestone '${definition.milestone}' referenced by group '${definition.id}' does not exist`,
          context: { group_id: definition.id, milestone_id: definition.milestone },
          suggested_action: 'Create the milestone first or use an existing milestone ID',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Create the parallel group
    const group = createParallelGroup(definition, members);
    this.groupStorage.saveGroup(group);

    return ok(undefined);
  }

  /**
   * Adds a task to an existing parallel group.
   * 
   * Requirements: 5.2, 5.3
   */
  addToGroup(groupId: string, taskId: string): Result<void, ParallelGroupError> {
    const group = this.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }

    const task = this.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForGroupError(taskId, groupId));
    }

    // Check if task is already in another group
    const existingGroup = this.getGroupByTask(taskId);
    if (existingGroup) {
      return err(taskAlreadyInGroupError(taskId, existingGroup.id));
    }

    // Validate no internal blocking dependencies with new task
    const newTaskIds = [...group.taskIds, taskId];
    const validationResult = this.validateGroupTasks(newTaskIds);
    if (!validationResult.success) {
      return validationResult;
    }

    // Add the task to the group
    const newMember = createGroupMember(
      task.id,
      task.title,
      task.status,
      task.assignee,
      task.role_required
    );

    const updatedGroup: ParallelGroup = {
      ...group,
      tasks: [...group.tasks, newMember],
      taskIds: newTaskIds,
      progress: calculateProgress([...group.tasks, newMember]),
    };
    updatedGroup.status = determineGroupStatus(updatedGroup.progress);

    this.groupStorage.saveGroup(updatedGroup);
    return ok(undefined);
  }

  /**
   * Removes a task from a parallel group.
   */
  removeFromGroup(groupId: string, taskId: string): Result<void, ParallelGroupError> {
    const group = this.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }

    if (!group.taskIds.includes(taskId)) {
      return err({
        code: ParallelGroupErrorCode.TASK_NOT_IN_GROUP,
        category: 'PARALLEL_GROUP_ERROR',
        message: `Task '${taskId}' is not in parallel group '${groupId}'`,
        context: { task_id: taskId, group_id: groupId },
        suggested_action: 'Verify the task belongs to this group or add it first',
        timestamp: new Date().toISOString(),
      });
    }

    const updatedTasks = group.tasks.filter(t => t.taskId !== taskId);
    const updatedTaskIds = group.taskIds.filter(id => id !== taskId);

    const updatedGroup: ParallelGroup = {
      ...group,
      tasks: updatedTasks,
      taskIds: updatedTaskIds,
      progress: calculateProgress(updatedTasks),
    };
    updatedGroup.status = determineGroupStatus(updatedGroup.progress);

    this.groupStorage.saveGroup(updatedGroup);
    return ok(undefined);
  }

  /**
   * Gets a parallel group by its ID.
   */
  getGroup(groupId: string): Result<ParallelGroup, ParallelGroupError> {
    const group = this.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }
    return ok(group);
  }

  /**
   * Gets all parallel groups.
   */
  getAllGroups(): ParallelGroup[] {
    return this.groupStorage.getAllGroups();
  }

  /**
   * Finds which group a task belongs to.
   */
  getGroupByTask(taskId: string): ParallelGroup | null {
    const allGroups = this.groupStorage.getAllGroups();
    return allGroups.find(g => g.taskIds.includes(taskId)) || null;
  }

  /**
   * Gets groups associated with a specific milestone.
   */
  getGroupsByMilestone(milestoneId: string): ParallelGroup[] {
    const allGroups = this.groupStorage.getAllGroups();
    return allGroups.filter(g => g.milestone === milestoneId);
  }

  /**
   * Checks if a task can be added to a group.
   * 
   * Requirements: 5.2, 5.3
   */
  canAddToGroup(groupId: string, taskId: string): Result<void, ParallelGroupError> {
    const group = this.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }

    const task = this.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForGroupError(taskId, groupId));
    }

    // Check if task is already in another group
    const existingGroup = this.getGroupByTask(taskId);
    if (existingGroup) {
      return err(taskAlreadyInGroupError(taskId, existingGroup.id));
    }

    // Validate no internal blocking dependencies with new task
    const newTaskIds = [...group.taskIds, taskId];
    return this.validateGroupTasks(newTaskIds);
  }

  /**
   * Validates that a set of task IDs have no internal blocking dependencies.
   * 
   * Requirements: 5.2, 5.3
   * 
   * This is the core validation that enforces Property 7:
   * "For any parallel group definition, if any task in the group has a blocking
   * dependency on another task in the same group, the group creation SHALL be rejected."
   */
  validateGroupTasks(taskIds: string[]): Result<void, ParallelGroupError> {
    const taskIdSet = new Set(taskIds);
    const conflicts: Array<{ from: string; to: string; type: string }> = [];

    for (const taskId of taskIds) {
      const task = this.taskStorage.getTask(taskId);
      if (!task) {
        continue; // Task existence is validated separately
      }

      // Check if this task has any blocking dependencies on other tasks in the group
      if (task.depends_on) {
        for (const dep of task.depends_on) {
          // Only blocking dependencies violate the parallel group constraint
          if (dep.type === 'blocking' && taskIdSet.has(dep.task_id)) {
            conflicts.push({
              from: taskId,
              to: dep.task_id,
              type: dep.type,
            });
          }
        }
      }
    }

    if (conflicts.length > 0) {
      return err(internalDependencyConflictError('validation', conflicts));
    }

    return ok(undefined);
  }

  /**
   * Gets the progress metrics for a parallel group.
   * 
   * Requirements: 6.1, 6.2
   */
  getGroupProgress(groupId: string): Result<GroupProgress, ParallelGroupError> {
    const group = this.groupStorage.getGroup(groupId);
    if (!group) {
      return err(groupNotFoundError(groupId));
    }
    return ok(group.progress);
  }

  /**
   * Notifies the group manager that a task has been completed.
   * 
   * Requirements: 5.5, 6.3, 15.3
   */
  notifyTaskCompletion(taskId: string): void {
    this.notifyTaskStatusChange(taskId, 'DONE');
  }

  /**
   * Notifies the group manager that a task status has changed.
   */
  notifyTaskStatusChange(taskId: string, newStatus: TaskStatusForGroups): void {
    const group = this.getGroupByTask(taskId);
    if (!group) {
      return; // Task is not in any group
    }

    // Update the task status in the group
    const updatedTasks = group.tasks.map(t => 
      t.taskId === taskId ? { ...t, status: newStatus } : t
    );

    const updatedProgress = calculateProgress(updatedTasks);
    const updatedStatus = determineGroupStatus(updatedProgress);

    const updatedGroup: ParallelGroup = {
      ...group,
      tasks: updatedTasks,
      progress: updatedProgress,
      status: updatedStatus,
    };

    this.groupStorage.saveGroup(updatedGroup);
  }

  /**
   * Clears all storage (for testing).
   */
  clear(): void {
    this.groupStorage.clear();
    this.taskStorage.clear();
  }
}

// =============================================================================
// Arbitraries (Generators) for Property-Based Testing
// =============================================================================

/**
 * Generates a valid task ID.
 */
const taskIdArb = fc.stringMatching(/^TASK-[0-9]{3,6}$/).filter(id => id.length >= 8);

/**
 * Generates a valid task title.
 */
const taskTitleArb = fc.string({ minLength: 5, maxLength: 100 }).filter(title => title.trim().length > 0);

/**
 * Generates a valid group ID.
 */
const groupIdArb = fc.stringMatching(/^PG-[0-9]{3,6}$/).filter(id => id.length >= 6);

/**
 * Generates a valid group name.
 */
const groupNameArb = fc.string({ minLength: 3, maxLength: 50 }).filter(name => name.trim().length > 0);

/**
 * Valid task statuses for groups.
 */
const TASK_STATUSES: TaskStatusForGroups[] = ['TODO', 'READY', 'IN_PROGRESS', 'BLOCKED', 'VERIFY', 'DONE'];

/**
 * Generates a valid task status.
 */
const taskStatusArb: fc.Arbitrary<TaskStatusForGroups> = fc.constantFrom(...TASK_STATUSES);

/**
 * Generates a basic task without dependencies.
 */
const basicTaskArb: fc.Arbitrary<TaskForGroups> = fc.record({
  id: taskIdArb,
  title: taskTitleArb,
  status: taskStatusArb,
}).map(task => ({
  ...task,
  depends_on: [],
}));

/**
 * Generates a set of tasks with unique IDs.
 * Returns an array of tasks where IDs are guaranteed unique.
 */
const uniqueTasksArb = (minCount: number, maxCount: number): fc.Arbitrary<TaskForGroups[]> => {
  return fc.array(basicTaskArb, { minLength: minCount, maxLength: maxCount }).map(tasks => {
    // Ensure unique IDs by appending index
    return tasks.map((task, index) => ({
      ...task,
      id: `TASK-${String(index + 100).padStart(3, '0')}`,
    }));
  });
};

/**
 * Generates tasks with no internal blocking dependencies (valid for parallel groups).
 */
const parallelTasksArb = (taskCount: number): fc.Arbitrary<TaskForGroups[]> => {
  return uniqueTasksArb(taskCount, taskCount).map(tasks => {
    // Ensure no blocking dependencies between tasks in the group
    return tasks.map(task => ({
      ...task,
      depends_on: [], // No dependencies
    }));
  });
};

/**
 * Generates tasks with only non-blocking dependencies between them (valid for parallel groups).
 */
const tasksWithNonBlockingDepsArb = (taskCount: number): fc.Arbitrary<TaskForGroups[]> => {
  return uniqueTasksArb(taskCount, taskCount).chain(tasks => {
    // Generate non-blocking dependencies between tasks
    return fc.array(
      fc.record({
        from: fc.nat({ max: taskCount - 1 }),
        to: fc.nat({ max: taskCount - 1 }),
      }).filter(edge => edge.from !== edge.to),
      { minLength: 0, maxLength: Math.floor(taskCount * 0.5) }
    ).map(edges => {
      // Remove duplicate edges
      const uniqueEdges = edges.filter((edge, index, arr) =>
        arr.findIndex(e => e.from === edge.from && e.to === edge.to) === index
      );

      // Add non-blocking dependencies
      const tasksWithDeps = tasks.map(t => ({ ...t, depends_on: [] as Array<{ task_id: string; type: 'blocking' | 'non_blocking' }> }));
      for (const edge of uniqueEdges) {
        tasksWithDeps[edge.from].depends_on.push({
          task_id: tasks[edge.to].id,
          type: 'non_blocking',
        });
      }
      return tasksWithDeps;
    });
  });
};

/**
 * Generates tasks with at least one blocking dependency between them (invalid for parallel groups).
 */
const tasksWithBlockingDepsArb = (taskCount: number): fc.Arbitrary<{
  tasks: TaskForGroups[];
  blockingEdges: Array<{ from: number; to: number }>;
}> => {
  return uniqueTasksArb(taskCount, taskCount).chain(tasks => {
    // Generate at least one blocking dependency between tasks
    return fc.array(
      fc.record({
        from: fc.nat({ max: taskCount - 1 }),
        to: fc.nat({ max: taskCount - 1 }),
      }).filter(edge => edge.from !== edge.to),
      { minLength: 1, maxLength: Math.min(3, Math.floor(taskCount * 0.5)) }
    ).map(edges => {
      // Remove duplicate edges
      const uniqueEdges = edges.filter((edge, index, arr) =>
        arr.findIndex(e => e.from === edge.from && e.to === edge.to) === index
      );

      // Add blocking dependencies
      const tasksWithDeps = tasks.map(t => ({ ...t, depends_on: [] as Array<{ task_id: string; type: 'blocking' | 'non_blocking' }> }));
      for (const edge of uniqueEdges) {
        tasksWithDeps[edge.from].depends_on.push({
          task_id: tasks[edge.to].id,
          type: 'blocking',
        });
      }
      return { tasks: tasksWithDeps, blockingEdges: uniqueEdges };
    });
  });
};

/**
 * Generates a parallel group definition.
 */
const parallelGroupDefinitionArb = (tasks: TaskForGroups[]): fc.Arbitrary<ParallelGroupDefinition> => {
  return fc.record({
    id: groupIdArb,
    name: groupNameArb,
    milestone: fc.option(fc.stringMatching(/^M[0-9]{1,3}$/), { nil: undefined }),
  }).map(def => ({
    ...def,
    taskIds: tasks.map(t => t.id),
  }));
};

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('Parallel_Group_Manager Property-Based Tests', () => {
  /**
   * **Feature: multi-developer-support, Property 7: Parallel Group Internal Dependency Constraint**
   * 
   * *For any* parallel group definition, if any task in the group has a blocking
   * dependency on another task in the same group, the group creation SHALL be rejected.
   * 
   * **Validates: Requirements 5.2, 5.3**
   */
  describe('Property 7: Parallel Group Internal Dependency Constraint', () => {
    let taskStorage: InMemoryTaskStorageForGroups;
    let groupStorage: InMemoryParallelGroupStorage;
    let manager: InMemoryParallelGroupManager;

    beforeEach(() => {
      taskStorage = new InMemoryTaskStorageForGroups();
      groupStorage = new InMemoryParallelGroupStorage();
      manager = new InMemoryParallelGroupManager({
        taskStorage,
        groupStorage,
      });
    });

    it('should accept parallel groups with no dependencies between tasks', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 10 }),
          (taskCount) => {
            // Setup: clear storage
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks with no dependencies
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const result = manager.createGroup(groupDef);

            // Should succeed - no internal blocking dependencies
            expect(result.success).toBe(true);

            // Verify group was created
            const group = manager.getGroup('PG-001');
            expect(group.success).toBe(true);
            if (group.success) {
              expect(group.value.taskIds.length).toBe(taskCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept parallel groups with only non-blocking dependencies between tasks', () => {
      fc.assert(
        fc.property(
          tasksWithNonBlockingDepsArb(5),
          (tasks) => {
            // Setup: clear storage
            taskStorage.clear();
            groupStorage.clear();

            // Add tasks to storage
            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const result = manager.createGroup(groupDef);

            // Should succeed - non-blocking dependencies are allowed within parallel groups
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject parallel groups with blocking dependencies between tasks (error code 1501)', () => {
      fc.assert(
        fc.property(
          tasksWithBlockingDepsArb(4),
          ({ tasks, blockingEdges }) => {
            // Setup: clear storage
            taskStorage.clear();
            groupStorage.clear();

            // Add tasks to storage
            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const result = manager.createGroup(groupDef);

            // Should fail with INTERNAL_DEPENDENCY_CONFLICT error (code 1501)
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
              expect(result.error.category).toBe('PARALLEL_GROUP_ERROR');
              expect(result.error.context?.conflicting_dependencies).toBeDefined();
              expect(result.error.context?.conflicting_dependencies!.length).toBeGreaterThan(0);
            }

            // Verify group was NOT created
            const group = manager.getGroup('PG-001');
            expect(group.success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject direct blocking dependency (A blocks B) within a group', () => {
      fc.assert(
        fc.property(
          basicTaskArb,
          basicTaskArb,
          (taskA, taskB) => {
            taskStorage.clear();
            groupStorage.clear();

            const task1: TaskForGroups = { ...taskA, id: 'TASK-001', depends_on: [] };
            const task2: TaskForGroups = {
              ...taskB,
              id: 'TASK-002',
              depends_on: [{ task_id: 'TASK-001', type: 'blocking' }],
            };

            taskStorage.addTask(task1);
            taskStorage.addTask(task2);

            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: ['TASK-001', 'TASK-002'],
            };

            const result = manager.createGroup(groupDef);

            // Should fail - task2 has blocking dependency on task1
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
              
              // Verify the conflict is correctly identified
              const conflicts = result.error.context?.conflicting_dependencies;
              expect(conflicts).toBeDefined();
              expect(conflicts!.length).toBe(1);
              expect(conflicts![0].from).toBe('TASK-002');
              expect(conflicts![0].to).toBe('TASK-001');
              expect(conflicts![0].type).toBe('blocking');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect multiple blocking dependencies within a group', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 6 }),
          (taskCount) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks where each task blocks the next (chain)
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: i > 0 
                  ? [{ task_id: `TASK-${String(i + 99).padStart(3, '0')}`, type: 'blocking' as const }]
                  : [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Chain Group',
              taskIds: tasks.map(t => t.id),
            };

            const result = manager.createGroup(groupDef);

            // Should fail - chain of blocking dependencies
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
              
              // Should detect all the blocking dependencies
              const conflicts = result.error.context?.conflicting_dependencies;
              expect(conflicts).toBeDefined();
              expect(conflicts!.length).toBe(taskCount - 1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow adding a task to a group if it has no blocking dependencies on existing tasks', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          (initialTaskCount) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create initial tasks with no dependencies
            const initialTasks: TaskForGroups[] = [];
            for (let i = 0; i < initialTaskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              initialTasks.push(task);
              taskStorage.addTask(task);
            }

            // Create group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: initialTasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Add a new task with no blocking dependencies
            const newTask: TaskForGroups = {
              id: `TASK-${String(initialTaskCount + 100).padStart(3, '0')}`,
              title: 'New Task',
              status: 'TODO',
              depends_on: [],
            };
            taskStorage.addTask(newTask);

            const addResult = manager.addToGroup('PG-001', newTask.id);

            // Should succeed
            expect(addResult.success).toBe(true);

            // Verify task was added
            const group = manager.getGroup('PG-001');
            expect(group.success).toBe(true);
            if (group.success) {
              expect(group.value.taskIds.length).toBe(initialTaskCount + 1);
              expect(group.value.taskIds).toContain(newTask.id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject adding a task to a group if it has a blocking dependency on an existing task', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          fc.nat({ max: 4 }).map(n => Math.min(n, 4)), // Index of task to block on
          (initialTaskCount, blockOnIndex) => {
            taskStorage.clear();
            groupStorage.clear();

            const safeBlockOnIndex = Math.min(blockOnIndex, initialTaskCount - 1);

            // Create initial tasks with no dependencies
            const initialTasks: TaskForGroups[] = [];
            for (let i = 0; i < initialTaskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              initialTasks.push(task);
              taskStorage.addTask(task);
            }

            // Create group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: initialTasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Add a new task with a blocking dependency on an existing task
            const newTask: TaskForGroups = {
              id: `TASK-999`,
              title: 'New Task with Blocking Dep',
              status: 'TODO',
              depends_on: [{ task_id: initialTasks[safeBlockOnIndex].id, type: 'blocking' }],
            };
            taskStorage.addTask(newTask);

            const addResult = manager.addToGroup('PG-001', newTask.id);

            // Should fail - blocking dependency on existing task
            expect(addResult.success).toBe(false);
            if (!addResult.success) {
              expect(addResult.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
            }

            // Verify task was NOT added
            const group = manager.getGroup('PG-001');
            expect(group.success).toBe(true);
            if (group.success) {
              expect(group.value.taskIds.length).toBe(initialTaskCount);
              expect(group.value.taskIds).not.toContain(newTask.id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow adding a task with non-blocking dependencies on existing group tasks', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          (initialTaskCount) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create initial tasks with no dependencies
            const initialTasks: TaskForGroups[] = [];
            for (let i = 0; i < initialTaskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              initialTasks.push(task);
              taskStorage.addTask(task);
            }

            // Create group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: initialTasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Add a new task with NON-blocking dependencies on all existing tasks
            const newTask: TaskForGroups = {
              id: `TASK-999`,
              title: 'New Task with Non-Blocking Deps',
              status: 'TODO',
              depends_on: initialTasks.map(t => ({ task_id: t.id, type: 'non_blocking' as const })),
            };
            taskStorage.addTask(newTask);

            const addResult = manager.addToGroup('PG-001', newTask.id);

            // Should succeed - non-blocking dependencies are allowed
            expect(addResult.success).toBe(true);

            // Verify task was added
            const group = manager.getGroup('PG-001');
            expect(group.success).toBe(true);
            if (group.success) {
              expect(group.value.taskIds.length).toBe(initialTaskCount + 1);
              expect(group.value.taskIds).toContain(newTask.id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly distinguish between blocking and non-blocking dependencies', () => {
      fc.assert(
        fc.property(
          fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
          (dependencyTypes) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create 4 tasks where task 0 has dependencies on tasks 1, 2, 3
            // The dependency types are determined by the boolean array
            const tasks: TaskForGroups[] = [];

            for (let i = 1; i <= 3; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Task 0 depends on tasks 1, 2, 3 with types based on boolean array
            const task0: TaskForGroups = {
              id: 'TASK-100',
              title: 'Task 0',
              status: 'TODO',
              depends_on: dependencyTypes.map((isBlocking, i) => ({
                task_id: `TASK-${String(i + 101).padStart(3, '0')}`,
                type: isBlocking ? 'blocking' as const : 'non_blocking' as const,
              })),
            };
            tasks.unshift(task0);
            taskStorage.addTask(task0);

            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Mixed Deps Group',
              taskIds: tasks.map(t => t.id),
            };

            const result = manager.createGroup(groupDef);
            const hasAnyBlocking = dependencyTypes.some(isBlocking => isBlocking);

            if (hasAnyBlocking) {
              // Should fail - at least one blocking dependency
              expect(result.success).toBe(false);
              if (!result.success) {
                expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
                
                // Number of conflicts should match number of blocking deps
                const expectedBlockingCount = dependencyTypes.filter(b => b).length;
                expect(result.error.context?.conflicting_dependencies?.length).toBe(expectedBlockingCount);
              }
            } else {
              // Should succeed - all non-blocking
              expect(result.success).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject when existing group task has blocking dependency on the new task', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          (initialTaskCount) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create new task first (will be added later)
            const newTaskId = 'TASK-999';

            // Create initial tasks where one has a blocking dependency on the new task
            const initialTasks: TaskForGroups[] = [];
            for (let i = 0; i < initialTaskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                // First task has blocking dependency on the new task
                depends_on: i === 0 ? [{ task_id: newTaskId, type: 'blocking' }] : [],
              };
              initialTasks.push(task);
              taskStorage.addTask(task);
            }

            // Create group with initial tasks only
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: initialTasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Now add the new task (which is blocked by an existing task)
            const newTask: TaskForGroups = {
              id: newTaskId,
              title: 'New Task',
              status: 'TODO',
              depends_on: [],
            };
            taskStorage.addTask(newTask);

            const addResult = manager.addToGroup('PG-001', newTask.id);

            // Should fail - existing task in group has blocking dep on the new task
            expect(addResult.success).toBe(false);
            if (!addResult.success) {
              expect(addResult.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('validateGroupTasks should be idempotent - same result for same input', () => {
      fc.assert(
        fc.property(
          tasksWithBlockingDepsArb(4),
          ({ tasks }) => {
            taskStorage.clear();
            groupStorage.clear();

            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            const taskIds = tasks.map(t => t.id);

            // Call validateGroupTasks multiple times
            const result1 = manager.validateGroupTasks(taskIds);
            const result2 = manager.validateGroupTasks(taskIds);
            const result3 = manager.validateGroupTasks(taskIds);

            // All results should be consistent
            expect(result1.success).toBe(result2.success);
            expect(result2.success).toBe(result3.success);

            if (!result1.success && !result2.success) {
              expect(result1.error.code).toBe(result2.error.code);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('canAddToGroup should correctly predict if addToGroup will succeed', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          fc.boolean(),
          (initialTaskCount, hasBlockingDep) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create initial tasks with no dependencies
            const initialTasks: TaskForGroups[] = [];
            for (let i = 0; i < initialTaskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              initialTasks.push(task);
              taskStorage.addTask(task);
            }

            // Create group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: initialTasks.map(t => t.id),
            };
            manager.createGroup(groupDef);

            // Create new task - may or may not have blocking dependency
            const newTask: TaskForGroups = {
              id: 'TASK-999',
              title: 'New Task',
              status: 'TODO',
              depends_on: hasBlockingDep
                ? [{ task_id: initialTasks[0].id, type: 'blocking' }]
                : [],
            };
            taskStorage.addTask(newTask);

            // Check with canAddToGroup
            const canAddResult = manager.canAddToGroup('PG-001', newTask.id);

            // Actually try to add
            const addResult = manager.addToGroup('PG-001', newTask.id);

            // canAddToGroup should correctly predict the outcome
            expect(canAddResult.success).toBe(addResult.success);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle bidirectional blocking dependencies (A blocks B AND B blocks A)', () => {
      fc.assert(
        fc.property(
          fc.constant(null), // No random input needed
          () => {
            taskStorage.clear();
            groupStorage.clear();

            // Create two tasks that both block each other (impossible to execute in parallel)
            const taskA: TaskForGroups = {
              id: 'TASK-001',
              title: 'Task A',
              status: 'TODO',
              depends_on: [{ task_id: 'TASK-002', type: 'blocking' }],
            };

            const taskB: TaskForGroups = {
              id: 'TASK-002',
              title: 'Task B',
              status: 'TODO',
              depends_on: [{ task_id: 'TASK-001', type: 'blocking' }],
            };

            taskStorage.addTask(taskA);
            taskStorage.addTask(taskB);

            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Bidirectional Block Group',
              taskIds: ['TASK-001', 'TASK-002'],
            };

            const result = manager.createGroup(groupDef);

            // Should fail - both tasks block each other
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
              
              // Should detect both blocking dependencies
              const conflicts = result.error.context?.conflicting_dependencies;
              expect(conflicts).toBeDefined();
              expect(conflicts!.length).toBe(2);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept single-task groups regardless of external dependencies', () => {
      fc.assert(
        fc.property(
          fc.array(taskIdArb, { minLength: 1, maxLength: 5 }),
          (externalTaskIds) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create external tasks
            for (const id of externalTaskIds) {
              taskStorage.addTask({
                id,
                title: `External ${id}`,
                status: 'TODO',
                depends_on: [],
              });
            }

            // Create a single task with blocking dependencies on external tasks
            const singleTask: TaskForGroups = {
              id: 'TASK-SINGLE',
              title: 'Single Task',
              status: 'TODO',
              depends_on: externalTaskIds.map(id => ({ task_id: id, type: 'blocking' as const })),
            };
            taskStorage.addTask(singleTask);

            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Single Task Group',
              taskIds: ['TASK-SINGLE'],
            };

            const result = manager.createGroup(groupDef);

            // Should succeed - dependencies are external, not internal to the group
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('error response should include all conflicting dependencies for debugging', () => {
      fc.assert(
        fc.property(
          tasksWithBlockingDepsArb(5),
          ({ tasks, blockingEdges }) => {
            taskStorage.clear();
            groupStorage.clear();

            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Conflict Group',
              taskIds: tasks.map(t => t.id),
            };

            const result = manager.createGroup(groupDef);

            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
              expect(result.error.context?.conflicting_dependencies).toBeDefined();
              
              const conflicts = result.error.context?.conflicting_dependencies!;
              
              // Each blocking edge should be in the conflicts
              for (const edge of blockingEdges) {
                const fromTask = tasks[edge.from];
                const toTask = tasks[edge.to];
                
                const found = conflicts.some(c => 
                  c.from === fromTask.id && c.to === toTask.id && c.type === 'blocking'
                );
                expect(found).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: multi-developer-support, Property 10: Parallel Group Progress Accuracy**
   * 
   * *For any* parallel group, the progress percentage SHALL equal (completed_tasks / total_tasks) * 100,
   * and a group SHALL be marked COMPLETE if and only if all tasks are DONE.
   * 
   * **Validates: Requirements 6.1, 6.2**
   */
  describe('Property 10: Parallel Group Progress Accuracy', () => {
    let taskStorage: InMemoryTaskStorageForGroups;
    let groupStorage: InMemoryParallelGroupStorage;
    let manager: InMemoryParallelGroupManager;

    beforeEach(() => {
      taskStorage = new InMemoryTaskStorageForGroups();
      groupStorage = new InMemoryParallelGroupStorage();
      manager = new InMemoryParallelGroupManager({
        taskStorage,
        groupStorage,
      });
    });

    /**
     * Property: Progress percentage is always between 0 and 100 (inclusive)
     * 
     * **Validates: Requirements 6.1**
     */
    it('progress percentage should always be between 0 and 100', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.array(taskStatusArb, { minLength: 1, maxLength: 20 }),
          (taskCount, statuses) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks with random statuses
            const actualTaskCount = Math.min(taskCount, statuses.length) || 1;
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < actualTaskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: statuses[i % statuses.length],
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Get group progress
            const progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);

            if (progressResult.success) {
              const progress = progressResult.value;
              
              // Percentage must be between 0 and 100
              expect(progress.percentage).toBeGreaterThanOrEqual(0);
              expect(progress.percentage).toBeLessThanOrEqual(100);
              
              // Percentage must be an integer (rounded)
              expect(Number.isInteger(progress.percentage)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Progress percentage equals (completed/total) * 100 rounded
     * 
     * **Validates: Requirements 6.1**
     */
    it('progress percentage should equal (completed/total) * 100 rounded', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 0, max: 20 }),
          (totalTasks, completedTasks) => {
            taskStorage.clear();
            groupStorage.clear();

            // Ensure completed doesn't exceed total
            const actualCompleted = Math.min(completedTasks, totalTasks);

            // Create tasks - first 'actualCompleted' are DONE, rest are TODO
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < totalTasks; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: i < actualCompleted ? 'DONE' : 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Get group progress
            const progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);

            if (progressResult.success) {
              const progress = progressResult.value;
              
              // Expected percentage calculation
              const expectedPercentage = Math.round((actualCompleted / totalTasks) * 100);
              
              // Verify the percentage calculation
              expect(progress.percentage).toBe(expectedPercentage);
              expect(progress.total).toBe(totalTasks);
              expect(progress.completed).toBe(actualCompleted);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Progress updates correctly when tasks change status
     * 
     * **Validates: Requirements 6.1, 6.2**
     */
    it('progress should update correctly when tasks change status', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 10 }),
          fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 10 }),
          (taskCount, tasksToComplete) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks all starting as TODO
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Initial progress should be 0%
            let progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);
            if (progressResult.success) {
              expect(progressResult.value.percentage).toBe(0);
              expect(progressResult.value.completed).toBe(0);
            }

            // Complete tasks one by one and verify progress updates
            const completedSet = new Set<number>();
            for (const taskIndex of tasksToComplete) {
              const safeIndex = taskIndex % taskCount;
              
              if (!completedSet.has(safeIndex)) {
                completedSet.add(safeIndex);
                
                // Update task status in storage
                const task = tasks[safeIndex];
                task.status = 'DONE';
                taskStorage.updateTask(task);
                
                // Notify manager of status change
                manager.notifyTaskCompletion(task.id);
                
                // Verify progress
                progressResult = manager.getGroupProgress('PG-001');
                expect(progressResult.success).toBe(true);
                
                if (progressResult.success) {
                  const expectedCompleted = completedSet.size;
                  const expectedPercentage = Math.round((expectedCompleted / taskCount) * 100);
                  
                  expect(progressResult.value.completed).toBe(expectedCompleted);
                  expect(progressResult.value.percentage).toBe(expectedPercentage);
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Completed count matches number of DONE tasks
     * 
     * **Validates: Requirements 6.1, 6.2**
     */
    it('completed count should match number of DONE tasks', () => {
      fc.assert(
        fc.property(
          fc.array(taskStatusArb, { minLength: 1, maxLength: 20 }),
          (statuses) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks with random statuses
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < statuses.length; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: statuses[i],
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Count expected DONE tasks
            const expectedDoneCount = statuses.filter(s => s === 'DONE').length;

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Get group progress
            const progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);

            if (progressResult.success) {
              const progress = progressResult.value;
              
              // Completed count should equal number of DONE tasks
              expect(progress.completed).toBe(expectedDoneCount);
              
              // Also verify byStatus.DONE matches
              expect(progress.byStatus.DONE).toBe(expectedDoneCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Total count matches number of tasks in group
     * 
     * **Validates: Requirements 6.1, 6.2**
     */
    it('total count should match number of tasks in group', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (taskCount) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Get group progress
            const progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);

            if (progressResult.success) {
              const progress = progressResult.value;
              
              // Total should equal task count
              expect(progress.total).toBe(taskCount);
              
              // Sum of all statuses should equal total
              const statusSum = 
                progress.byStatus.TODO + 
                progress.byStatus.READY + 
                progress.byStatus.IN_PROGRESS + 
                progress.byStatus.BLOCKED + 
                progress.byStatus.VERIFY + 
                progress.byStatus.DONE;
              
              expect(statusSum).toBe(taskCount);
            }

            // Also verify via getGroup
            const groupResult = manager.getGroup('PG-001');
            expect(groupResult.success).toBe(true);
            if (groupResult.success) {
              expect(groupResult.value.taskIds.length).toBe(taskCount);
              expect(groupResult.value.tasks.length).toBe(taskCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Group status is COMPLETE if and only if all tasks are DONE
     * 
     * **Validates: Requirements 6.3**
     */
    it('group should be COMPLETE if and only if all tasks are DONE', () => {
      fc.assert(
        fc.property(
          fc.array(taskStatusArb, { minLength: 1, maxLength: 15 }),
          (statuses) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks with random statuses
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < statuses.length; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: statuses[i],
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Check if all tasks are DONE
            const allDone = statuses.every(s => s === 'DONE');

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Get group
            const groupResult = manager.getGroup('PG-001');
            expect(groupResult.success).toBe(true);

            if (groupResult.success) {
              const group = groupResult.value;
              
              // Group should be COMPLETE if and only if all tasks are DONE
              if (allDone) {
                expect(group.status).toBe('COMPLETE');
                expect(group.progress.percentage).toBe(100);
              } else {
                expect(group.status).not.toBe('COMPLETE');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Group transitions to COMPLETE when last task is completed
     * 
     * **Validates: Requirements 6.3**
     */
    it('group should transition to COMPLETE when last task completes', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (taskCount) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks all starting as IN_PROGRESS
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'IN_PROGRESS',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Group should be IN_PROGRESS initially
            let groupResult = manager.getGroup('PG-001');
            expect(groupResult.success).toBe(true);
            if (groupResult.success) {
              expect(groupResult.value.status).toBe('IN_PROGRESS');
            }

            // Complete all tasks except the last one
            for (let i = 0; i < taskCount - 1; i++) {
              tasks[i].status = 'DONE';
              taskStorage.updateTask(tasks[i]);
              manager.notifyTaskCompletion(tasks[i].id);

              groupResult = manager.getGroup('PG-001');
              expect(groupResult.success).toBe(true);
              if (groupResult.success) {
                // Should still be IN_PROGRESS (not all tasks done)
                expect(groupResult.value.status).toBe('IN_PROGRESS');
              }
            }

            // Complete the last task
            tasks[taskCount - 1].status = 'DONE';
            taskStorage.updateTask(tasks[taskCount - 1]);
            manager.notifyTaskCompletion(tasks[taskCount - 1].id);

            // Now group should be COMPLETE
            groupResult = manager.getGroup('PG-001');
            expect(groupResult.success).toBe(true);
            if (groupResult.success) {
              expect(groupResult.value.status).toBe('COMPLETE');
              expect(groupResult.value.progress.percentage).toBe(100);
              expect(groupResult.value.progress.completed).toBe(taskCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Empty groups have 0% progress (edge case)
     * 
     * **Validates: Requirements 6.1**
     */
    it('groups with no tasks should have 0% progress and PENDING status', () => {
      taskStorage.clear();
      groupStorage.clear();

      // Create an empty group (no tasks)
      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Empty Group',
        taskIds: [],
      };

      const createResult = manager.createGroup(groupDef);
      expect(createResult.success).toBe(true);

      // Get group progress
      const progressResult = manager.getGroupProgress('PG-001');
      expect(progressResult.success).toBe(true);

      if (progressResult.success) {
        const progress = progressResult.value;
        
        // Empty group should have 0% progress
        expect(progress.total).toBe(0);
        expect(progress.completed).toBe(0);
        expect(progress.percentage).toBe(0);
      }

      // Get group
      const groupResult = manager.getGroup('PG-001');
      expect(groupResult.success).toBe(true);

      if (groupResult.success) {
        // Empty group should be PENDING
        expect(groupResult.value.status).toBe('PENDING');
      }
    });

    /**
     * Property: Progress percentage rounds correctly for non-integer results
     * 
     * **Validates: Requirements 6.1**
     */
    it('progress percentage should round correctly for non-integer results', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 11 }), // Choose task counts that give non-integer percentages
          fc.integer({ min: 1, max: 10 }),
          (totalTasks, completedTasks) => {
            taskStorage.clear();
            groupStorage.clear();

            // Ensure completed doesn't exceed total
            const actualCompleted = Math.min(completedTasks, totalTasks - 1); // At least 1 not done

            // Create tasks
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < totalTasks; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: i < actualCompleted ? 'DONE' : 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Get group progress
            const progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);

            if (progressResult.success) {
              const progress = progressResult.value;
              
              // Calculate expected with rounding
              const rawPercentage = (actualCompleted / totalTasks) * 100;
              const expectedPercentage = Math.round(rawPercentage);
              
              // Verify rounding is correct
              expect(progress.percentage).toBe(expectedPercentage);
              
              // Verify it's an integer
              expect(Number.isInteger(progress.percentage)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: byStatus counts accurately reflect task statuses
     * 
     * **Validates: Requirements 6.2**
     */
    it('byStatus counts should accurately reflect task statuses', () => {
      fc.assert(
        fc.property(
          fc.array(taskStatusArb, { minLength: 1, maxLength: 20 }),
          (statuses) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks with random statuses
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < statuses.length; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: statuses[i],
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Calculate expected counts
            const expectedCounts: Record<TaskStatusForGroups, number> = {
              TODO: 0,
              READY: 0,
              IN_PROGRESS: 0,
              BLOCKED: 0,
              VERIFY: 0,
              DONE: 0,
            };
            for (const status of statuses) {
              expectedCounts[status]++;
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Get group progress
            const progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);

            if (progressResult.success) {
              const progress = progressResult.value;
              
              // Verify each status count matches
              expect(progress.byStatus.TODO).toBe(expectedCounts.TODO);
              expect(progress.byStatus.READY).toBe(expectedCounts.READY);
              expect(progress.byStatus.IN_PROGRESS).toBe(expectedCounts.IN_PROGRESS);
              expect(progress.byStatus.BLOCKED).toBe(expectedCounts.BLOCKED);
              expect(progress.byStatus.VERIFY).toBe(expectedCounts.VERIFY);
              expect(progress.byStatus.DONE).toBe(expectedCounts.DONE);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Progress is consistent between getGroupProgress and getGroup
     * 
     * **Validates: Requirements 6.1, 6.2**
     */
    it('progress should be consistent between getGroupProgress and getGroup', () => {
      fc.assert(
        fc.property(
          fc.array(taskStatusArb, { minLength: 1, maxLength: 15 }),
          (statuses) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks with random statuses
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < statuses.length; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: statuses[i],
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Get progress via getGroupProgress
            const progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);

            // Get group via getGroup
            const groupResult = manager.getGroup('PG-001');
            expect(groupResult.success).toBe(true);

            if (progressResult.success && groupResult.success) {
              const progressFromMethod = progressResult.value;
              const progressFromGroup = groupResult.value.progress;
              
              // Both should return identical progress data
              expect(progressFromMethod.total).toBe(progressFromGroup.total);
              expect(progressFromMethod.completed).toBe(progressFromGroup.completed);
              expect(progressFromMethod.percentage).toBe(progressFromGroup.percentage);
              expect(progressFromMethod.byStatus).toEqual(progressFromGroup.byStatus);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: notifyTaskStatusChange updates progress correctly for all status transitions
     * 
     * **Validates: Requirements 6.1, 6.2**
     */
    it('notifyTaskStatusChange should update progress correctly for all status transitions', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 8 }),
          fc.constantFrom(...TASK_STATUSES),
          fc.constantFrom(...TASK_STATUSES),
          (taskCount, initialStatus, newStatus) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create tasks with initial status
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: initialStatus,
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Update first task to new status
            tasks[0].status = newStatus;
            taskStorage.updateTask(tasks[0]);
            manager.notifyTaskStatusChange(tasks[0].id, newStatus);

            // Verify progress
            const progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);

            if (progressResult.success) {
              const progress = progressResult.value;
              
              // Calculate expected counts
              const expectedCounts: Record<TaskStatusForGroups, number> = {
                TODO: 0,
                READY: 0,
                IN_PROGRESS: 0,
                BLOCKED: 0,
                VERIFY: 0,
                DONE: 0,
              };
              
              // First task has newStatus, rest have initialStatus
              expectedCounts[newStatus]++;
              expectedCounts[initialStatus] += taskCount - 1;
              
              // Verify byStatus
              expect(progress.byStatus).toEqual(expectedCounts);
              
              // Verify completed count
              const expectedCompleted = (newStatus === 'DONE' ? 1 : 0) + 
                (initialStatus === 'DONE' ? taskCount - 1 : 0);
              expect(progress.completed).toBe(expectedCompleted);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Adding task to group updates total correctly
     * 
     * **Validates: Requirements 6.1**
     */
    it('adding task to group should update total correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 8 }),
          fc.integer({ min: 1, max: 5 }),
          (initialTaskCount, tasksToAdd) => {
            taskStorage.clear();
            groupStorage.clear();

            // Create initial tasks
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < initialTaskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Verify initial total
            let progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);
            if (progressResult.success) {
              expect(progressResult.value.total).toBe(initialTaskCount);
            }

            // Add more tasks
            for (let i = 0; i < tasksToAdd; i++) {
              const newTask: TaskForGroups = {
                id: `TASK-NEW-${String(i + 200).padStart(3, '0')}`,
                title: `New Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              taskStorage.addTask(newTask);
              manager.addToGroup('PG-001', newTask.id);
            }

            // Verify updated total
            progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);
            if (progressResult.success) {
              expect(progressResult.value.total).toBe(initialTaskCount + tasksToAdd);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Removing task from group updates total and percentage correctly
     * 
     * **Validates: Requirements 6.1**
     */
    it('removing task from group should update total and percentage correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 10 }),
          fc.integer({ min: 1, max: 5 }),
          (initialTaskCount, doneCount) => {
            taskStorage.clear();
            groupStorage.clear();

            // Ensure doneCount doesn't exceed initialTaskCount - 1 (keep at least 1)
            const actualDoneCount = Math.min(doneCount, initialTaskCount - 1);

            // Create tasks - first actualDoneCount are DONE
            const tasks: TaskForGroups[] = [];
            for (let i = 0; i < initialTaskCount; i++) {
              const task: TaskForGroups = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: i < actualDoneCount ? 'DONE' : 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              taskStorage.addTask(task);
            }

            // Create parallel group
            const groupDef: ParallelGroupDefinition = {
              id: 'PG-001',
              name: 'Test Group',
              taskIds: tasks.map(t => t.id),
            };

            const createResult = manager.createGroup(groupDef);
            expect(createResult.success).toBe(true);

            // Verify initial progress
            let progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);
            if (progressResult.success) {
              expect(progressResult.value.total).toBe(initialTaskCount);
              expect(progressResult.value.completed).toBe(actualDoneCount);
            }

            // Remove a TODO task (last one)
            const removeResult = manager.removeFromGroup('PG-001', tasks[initialTaskCount - 1].id);
            expect(removeResult.success).toBe(true);

            // Verify updated progress
            progressResult = manager.getGroupProgress('PG-001');
            expect(progressResult.success).toBe(true);
            if (progressResult.success) {
              const newTotal = initialTaskCount - 1;
              expect(progressResult.value.total).toBe(newTotal);
              expect(progressResult.value.completed).toBe(actualDoneCount);
              expect(progressResult.value.percentage).toBe(Math.round((actualDoneCount / newTotal) * 100));
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
