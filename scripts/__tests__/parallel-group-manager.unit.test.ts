/**
 * Unit Tests for Parallel_Group_Manager
 * 
 * These tests verify specific scenarios for the Parallel_Group_Manager component
 * including group creation, task addition/removal, progress tracking, and notifications.
 * 
 * **Validates: Requirements 5.1-5.5, 6.1-6.3**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ParallelGroup,
  ParallelGroupDefinition,
  ParallelGroupError,
  ParallelGroupErrorCode,
  GroupProgress,
  GroupMember,
  TaskForGroups,
  TaskStatusForGroups,
  InMemoryParallelGroupStorage,
  InMemoryTaskStorageForGroups,
  ParallelGroupManagerImpl,
  ParallelGroupManagerConfig,
  calculateProgress,
  determineGroupStatus,
  createGroupMember,
  isValidGroupId,
  isValidGroupName,
  isValidParallelGroupStatus,
  createEmptyProgress,
} from '../parallel-group-manager';
import { Role } from '../team-manager';

// =============================================================================
// Helper Functions for Tests
// =============================================================================

/**
 * Creates a valid task for testing.
 */
function createValidTask(overrides: Partial<TaskForGroups> = {}): TaskForGroups {
  return {
    id: overrides.id ?? 'TASK-001',
    title: overrides.title ?? 'Test Task',
    status: overrides.status ?? 'TODO',
    depends_on: overrides.depends_on ?? [],
    assignee: overrides.assignee,
    role_required: overrides.role_required,
  };
}

/**
 * Creates a valid parallel group definition for testing.
 */
function createValidGroupDefinition(overrides: Partial<ParallelGroupDefinition> = {}): ParallelGroupDefinition {
  return {
    id: overrides.id ?? 'PG-001',
    name: overrides.name ?? 'Test Parallel Group',
    taskIds: overrides.taskIds ?? ['TASK-001', 'TASK-002'],
    milestone: overrides.milestone,
    constraints: overrides.constraints,
  };
}

/**
 * Creates a task with a blocking dependency.
 */
function createTaskWithBlockingDep(
  taskId: string,
  dependsOnId: string,
  status: TaskStatusForGroups = 'TODO'
): TaskForGroups {
  return {
    id: taskId,
    title: `Task ${taskId}`,
    status,
    depends_on: [{ task_id: dependsOnId, type: 'blocking' }],
  };
}

/**
 * Creates a task with a non-blocking dependency.
 */
function createTaskWithNonBlockingDep(
  taskId: string,
  dependsOnId: string,
  status: TaskStatusForGroups = 'TODO'
): TaskForGroups {
  return {
    id: taskId,
    title: `Task ${taskId}`,
    status,
    depends_on: [{ task_id: dependsOnId, type: 'non_blocking' }],
  };
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('Parallel_Group_Manager Unit Tests', () => {
  let taskStorage: InMemoryTaskStorageForGroups;
  let groupStorage: InMemoryParallelGroupStorage;
  let manager: ParallelGroupManagerImpl;
  let validMilestones: Set<string>;

  beforeEach(() => {
    taskStorage = new InMemoryTaskStorageForGroups();
    groupStorage = new InMemoryParallelGroupStorage();
    validMilestones = new Set(['M1', 'M2', 'M3']);
    
    manager = new ParallelGroupManagerImpl({
      taskStorage,
      groupStorage,
      validateMilestone: (milestoneId) => validMilestones.has(milestoneId),
    });
  });

  // ===========================================================================
  // 1. createGroup Tests
  // Validates: Requirements 5.1, 5.2, 5.3, 5.4
  // ===========================================================================
  describe('1. createGroup Tests', () => {
    describe('Create group with valid data', () => {
      it('should successfully create a group with valid tasks', () => {
        // Setup: Add tasks to storage
        const task1 = createValidTask({ id: 'TASK-001', title: 'Task 1' });
        const task2 = createValidTask({ id: 'TASK-002', title: 'Task 2' });
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        // Act
        const definition = createValidGroupDefinition({
          id: 'PG-001',
          name: 'Sprint 1 Tasks',
          taskIds: ['TASK-001', 'TASK-002'],
        });
        const result = manager.createGroup(definition);

        // Assert
        expect(result.success).toBe(true);
        
        const group = manager.getGroup('PG-001');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.id).toBe('PG-001');
          expect(group.value.name).toBe('Sprint 1 Tasks');
          expect(group.value.taskIds).toEqual(['TASK-001', 'TASK-002']);
          expect(group.value.status).toBe('PENDING');
        }
      });

      it('should create group with milestone association (Requirement 5.4)', () => {
        const task1 = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task1);

        const definition = createValidGroupDefinition({
          id: 'PG-002',
          name: 'M1 Features',
          taskIds: ['TASK-001'],
          milestone: 'M1',
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(true);
        
        const group = manager.getGroup('PG-002');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.milestone).toBe('M1');
        }
      });

      it('should create group with single task', () => {
        const task = createValidTask({ id: 'TASK-SINGLE' });
        taskStorage.addTask(task);

        const definition = createValidGroupDefinition({
          id: 'PG-SINGLE',
          name: 'Single Task Group',
          taskIds: ['TASK-SINGLE'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(true);
        
        const group = manager.getGroup('PG-SINGLE');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.taskIds.length).toBe(1);
        }
      });

      it('should initialize group with correct progress', () => {
        const task1 = createValidTask({ id: 'TASK-001', status: 'TODO' });
        const task2 = createValidTask({ id: 'TASK-002', status: 'DONE' });
        const task3 = createValidTask({ id: 'TASK-003', status: 'IN_PROGRESS' });
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);
        taskStorage.addTask(task3);

        const definition = createValidGroupDefinition({
          id: 'PG-PROGRESS',
          name: 'Progress Test',
          taskIds: ['TASK-001', 'TASK-002', 'TASK-003'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(true);
        
        const group = manager.getGroup('PG-PROGRESS');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.progress.total).toBe(3);
          expect(group.value.progress.completed).toBe(1);
          expect(group.value.progress.percentage).toBe(33);
          expect(group.value.status).toBe('IN_PROGRESS');
        }
      });

      it('should set group status to PENDING when all tasks are TODO', () => {
        const task1 = createValidTask({ id: 'TASK-001', status: 'TODO' });
        const task2 = createValidTask({ id: 'TASK-002', status: 'TODO' });
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        const definition = createValidGroupDefinition({
          id: 'PG-PENDING',
          taskIds: ['TASK-001', 'TASK-002'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(true);
        const group = manager.getGroup('PG-PENDING');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.status).toBe('PENDING');
        }
      });

      it('should set group status to COMPLETE when all tasks are DONE', () => {
        const task1 = createValidTask({ id: 'TASK-001', status: 'DONE' });
        const task2 = createValidTask({ id: 'TASK-002', status: 'DONE' });
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        const definition = createValidGroupDefinition({
          id: 'PG-COMPLETE',
          taskIds: ['TASK-001', 'TASK-002'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(true);
        const group = manager.getGroup('PG-COMPLETE');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.status).toBe('COMPLETE');
          expect(group.value.progress.percentage).toBe(100);
        }
      });

      it('should allow tasks with non-blocking dependencies within group', () => {
        const task1 = createValidTask({ id: 'TASK-001' });
        const task2 = createTaskWithNonBlockingDep('TASK-002', 'TASK-001');
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        const definition = createValidGroupDefinition({
          id: 'PG-NONBLOCK',
          taskIds: ['TASK-001', 'TASK-002'],
        });
        const result = manager.createGroup(definition);

        // Non-blocking dependencies are allowed in parallel groups
        expect(result.success).toBe(true);
      });
    });

    describe('Reject group with internal blocking dependencies (error 1501)', () => {
      it('should reject group when task has blocking dependency on another group task', () => {
        const task1 = createValidTask({ id: 'TASK-001' });
        const task2 = createTaskWithBlockingDep('TASK-002', 'TASK-001');
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        const definition = createValidGroupDefinition({
          id: 'PG-BLOCK',
          taskIds: ['TASK-001', 'TASK-002'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
          expect(result.error.code).toBe(1501);
          expect(result.error.category).toBe('PARALLEL_GROUP_ERROR');
          expect(result.error.context?.conflicting_dependencies).toBeDefined();
          expect(result.error.context?.conflicting_dependencies!.length).toBeGreaterThan(0);
        }
      });

      it('should include conflicting dependencies in error context', () => {
        const task1 = createValidTask({ id: 'TASK-A' });
        const task2 = createTaskWithBlockingDep('TASK-B', 'TASK-A');
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        const definition = createValidGroupDefinition({
          id: 'PG-CONFLICT',
          taskIds: ['TASK-A', 'TASK-B'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          const conflicts = result.error.context?.conflicting_dependencies!;
          expect(conflicts.some(c => c.from === 'TASK-B' && c.to === 'TASK-A')).toBe(true);
        }
      });

      it('should detect chain of blocking dependencies', () => {
        const task1 = createValidTask({ id: 'TASK-001' });
        const task2 = createTaskWithBlockingDep('TASK-002', 'TASK-001');
        const task3 = createTaskWithBlockingDep('TASK-003', 'TASK-002');
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);
        taskStorage.addTask(task3);

        const definition = createValidGroupDefinition({
          id: 'PG-CHAIN',
          taskIds: ['TASK-001', 'TASK-002', 'TASK-003'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1501);
          expect(result.error.context?.conflicting_dependencies!.length).toBe(2);
        }
      });

      it('should include suggested_action in error for internal dependency conflict', () => {
        const task1 = createValidTask({ id: 'TASK-X' });
        const task2 = createTaskWithBlockingDep('TASK-Y', 'TASK-X');
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        const definition = createValidGroupDefinition({
          id: 'PG-SUGGEST',
          taskIds: ['TASK-X', 'TASK-Y'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.suggested_action).toBeDefined();
          expect(result.error.suggested_action!.length).toBeGreaterThan(0);
        }
      });
    });

    describe('Reject group with duplicate ID (error 1507)', () => {
      it('should reject group creation when ID already exists', () => {
        const task1 = createValidTask({ id: 'TASK-001' });
        const task2 = createValidTask({ id: 'TASK-002' });
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        // Create first group
        const definition1 = createValidGroupDefinition({
          id: 'PG-DUPLICATE',
          taskIds: ['TASK-001'],
        });
        const result1 = manager.createGroup(definition1);
        expect(result1.success).toBe(true);

        // Try to create another group with same ID
        const definition2 = createValidGroupDefinition({
          id: 'PG-DUPLICATE',
          taskIds: ['TASK-002'],
        });
        const result2 = manager.createGroup(definition2);

        expect(result2.success).toBe(false);
        if (!result2.success) {
          expect(result2.error.code).toBe(ParallelGroupErrorCode.DUPLICATE_GROUP);
          expect(result2.error.code).toBe(1507);
          expect(result2.error.context?.group_id).toBe('PG-DUPLICATE');
        }
      });
    });

    describe('Reject group when task already in another group (error 1503)', () => {
      it('should reject group when task is already in another group', () => {
        const task1 = createValidTask({ id: 'TASK-001' });
        const task2 = createValidTask({ id: 'TASK-002' });
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);

        // Create first group with TASK-001
        const definition1 = createValidGroupDefinition({
          id: 'PG-FIRST',
          taskIds: ['TASK-001'],
        });
        manager.createGroup(definition1);

        // Try to create second group also with TASK-001
        const definition2 = createValidGroupDefinition({
          id: 'PG-SECOND',
          taskIds: ['TASK-001', 'TASK-002'],
        });
        const result = manager.createGroup(definition2);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ParallelGroupErrorCode.TASK_ALREADY_IN_GROUP);
          expect(result.error.code).toBe(1503);
          expect(result.error.context?.task_id).toBe('TASK-001');
          expect(result.error.context?.existing_group).toBe('PG-FIRST');
        }
      });
    });

    describe('Reject group with invalid milestone (error 1504)', () => {
      it('should reject group when milestone does not exist', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const definition = createValidGroupDefinition({
          id: 'PG-MILESTONE',
          taskIds: ['TASK-001'],
          milestone: 'NON_EXISTENT_MILESTONE',
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ParallelGroupErrorCode.INVALID_MILESTONE_REF);
          expect(result.error.code).toBe(1504);
          expect(result.error.context?.milestone_id).toBe('NON_EXISTENT_MILESTONE');
          expect(result.error.context?.group_id).toBe('PG-MILESTONE');
        }
      });

      it('should accept group with valid milestone', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const definition = createValidGroupDefinition({
          id: 'PG-VALID-M',
          taskIds: ['TASK-001'],
          milestone: 'M1', // Valid milestone in our test setup
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(true);
      });
    });

    describe('Reject group when task not found (error 1505)', () => {
      it('should reject group when task does not exist', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const definition = createValidGroupDefinition({
          id: 'PG-NOTASK',
          taskIds: ['TASK-001', 'TASK-NONEXISTENT'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ParallelGroupErrorCode.TASK_NOT_FOUND);
          expect(result.error.code).toBe(1505);
          expect(result.error.context?.task_id).toBe('TASK-NONEXISTENT');
        }
      });
    });

    describe('Reject group with invalid name (error 1506)', () => {
      it('should reject group with empty name', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const definition = createValidGroupDefinition({
          id: 'PG-EMPTY-NAME',
          name: '',
          taskIds: ['TASK-001'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ParallelGroupErrorCode.INVALID_GROUP_NAME);
          expect(result.error.code).toBe(1506);
        }
      });

      it('should reject group with whitespace-only name', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const definition = createValidGroupDefinition({
          id: 'PG-WHITESPACE',
          name: '   ',
          taskIds: ['TASK-001'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1506);
        }
      });

      it('should reject group with name longer than 99 characters', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const longName = 'A'.repeat(100);
        const definition = createValidGroupDefinition({
          id: 'PG-LONG-NAME',
          name: longName,
          taskIds: ['TASK-001'],
        });
        const result = manager.createGroup(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1506);
        }
      });
    });
  });

  // ===========================================================================
  // 2. addToGroup Tests
  // Validates: Requirements 5.2, 5.3
  // ===========================================================================
  describe('2. addToGroup Tests', () => {
    beforeEach(() => {
      // Setup: Create a group with one task
      const task = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task);
      const definition = createValidGroupDefinition({
        id: 'PG-001',
        taskIds: ['TASK-001'],
      });
      manager.createGroup(definition);
    });

    describe('Add task to group successfully', () => {
      it('should add a task to an existing group', () => {
        const newTask = createValidTask({ id: 'TASK-002' });
        taskStorage.addTask(newTask);

        const result = manager.addToGroup('PG-001', 'TASK-002');

        expect(result.success).toBe(true);
        
        const group = manager.getGroup('PG-001');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.taskIds).toContain('TASK-002');
          expect(group.value.taskIds.length).toBe(2);
        }
      });

      it('should update progress when adding a task', () => {
        const newTask = createValidTask({ id: 'TASK-DONE', status: 'DONE' });
        taskStorage.addTask(newTask);

        manager.addToGroup('PG-001', 'TASK-DONE');

        const group = manager.getGroup('PG-001');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.progress.total).toBe(2);
          expect(group.value.progress.completed).toBe(1);
        }
      });

      it('should allow adding task with non-blocking dependency on group task', () => {
        const newTask = createTaskWithNonBlockingDep('TASK-NONBLOCK', 'TASK-001');
        taskStorage.addTask(newTask);

        const result = manager.addToGroup('PG-001', 'TASK-NONBLOCK');

        expect(result.success).toBe(true);
      });
    });

    describe('Reject adding task when group not found (error 1502)', () => {
      it('should reject when group ID does not exist', () => {
        const newTask = createValidTask({ id: 'TASK-NEW' });
        taskStorage.addTask(newTask);

        const result = manager.addToGroup('PG-NONEXISTENT', 'TASK-NEW');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ParallelGroupErrorCode.GROUP_NOT_FOUND);
          expect(result.error.code).toBe(1502);
          expect(result.error.context?.group_id).toBe('PG-NONEXISTENT');
        }
      });
    });

    describe('Reject adding task when task not found (error 1505)', () => {
      it('should reject when task does not exist', () => {
        const result = manager.addToGroup('PG-001', 'TASK-NONEXISTENT');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ParallelGroupErrorCode.TASK_NOT_FOUND);
          expect(result.error.code).toBe(1505);
          expect(result.error.context?.task_id).toBe('TASK-NONEXISTENT');
        }
      });
    });

    describe('Reject adding task already in another group (error 1503)', () => {
      it('should reject when task is in another group', () => {
        // Create second group
        const task2 = createValidTask({ id: 'TASK-002' });
        taskStorage.addTask(task2);
        manager.createGroup({
          id: 'PG-002',
          name: 'Second Group',
          taskIds: ['TASK-002'],
        });

        // Try to add TASK-002 to first group
        const result = manager.addToGroup('PG-001', 'TASK-002');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1503);
          expect(result.error.context?.task_id).toBe('TASK-002');
          expect(result.error.context?.existing_group).toBe('PG-002');
        }
      });
    });

    describe('Reject adding task that would create internal blocking dependency (error 1501)', () => {
      it('should reject when new task has blocking dependency on existing group task', () => {
        const blockingTask = createTaskWithBlockingDep('TASK-BLOCKING', 'TASK-001');
        taskStorage.addTask(blockingTask);

        const result = manager.addToGroup('PG-001', 'TASK-BLOCKING');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1501);
        }
      });

      it('should reject when existing task has blocking dependency on new task', () => {
        // Update existing task to have blocking dependency on new task
        const existingTask = taskStorage.getTask('TASK-001')!;
        existingTask.depends_on = [{ task_id: 'TASK-NEW', type: 'blocking' }];
        taskStorage.updateTask(existingTask);

        const newTask = createValidTask({ id: 'TASK-NEW' });
        taskStorage.addTask(newTask);

        const result = manager.addToGroup('PG-001', 'TASK-NEW');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1501);
        }
      });
    });
  });

  // ===========================================================================
  // 3. removeFromGroup Tests
  // ===========================================================================
  describe('3. removeFromGroup Tests', () => {
    beforeEach(() => {
      // Setup: Create a group with multiple tasks
      const task1 = createValidTask({ id: 'TASK-001' });
      const task2 = createValidTask({ id: 'TASK-002' });
      const task3 = createValidTask({ id: 'TASK-003' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);
      taskStorage.addTask(task3);
      manager.createGroup({
        id: 'PG-001',
        name: 'Test Group',
        taskIds: ['TASK-001', 'TASK-002', 'TASK-003'],
      });
    });

    describe('Remove task from group successfully', () => {
      it('should remove a task from a group', () => {
        const result = manager.removeFromGroup('PG-001', 'TASK-002');

        expect(result.success).toBe(true);
        
        const group = manager.getGroup('PG-001');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.taskIds).not.toContain('TASK-002');
          expect(group.value.taskIds.length).toBe(2);
        }
      });

      it('should update progress when removing a task', () => {
        // Update one task to DONE
        const task = taskStorage.getTask('TASK-001')!;
        task.status = 'DONE';
        taskStorage.updateTask(task);
        manager.notifyTaskStatusChange('TASK-001', 'DONE');

        // Remove the completed task
        manager.removeFromGroup('PG-001', 'TASK-001');

        const group = manager.getGroup('PG-001');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.progress.total).toBe(2);
          expect(group.value.progress.completed).toBe(0);
        }
      });

      it('should allow task to be added to another group after removal', () => {
        manager.removeFromGroup('PG-001', 'TASK-002');

        // Create new group and add the removed task
        manager.createGroup({
          id: 'PG-002',
          name: 'New Group',
          taskIds: ['TASK-002'],
        });

        const group = manager.getGroup('PG-002');
        expect(group.success).toBe(true);
        if (group.success) {
          expect(group.value.taskIds).toContain('TASK-002');
        }
      });
    });

    describe('Reject removal when group not found (error 1502)', () => {
      it('should reject when group does not exist', () => {
        const result = manager.removeFromGroup('PG-NONEXISTENT', 'TASK-001');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1502);
          expect(result.error.context?.group_id).toBe('PG-NONEXISTENT');
        }
      });
    });

    describe('Reject removal when task not in group (error 1511)', () => {
      it('should reject when task is not in the specified group', () => {
        const result = manager.removeFromGroup('PG-001', 'TASK-999');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ParallelGroupErrorCode.TASK_NOT_IN_GROUP);
          expect(result.error.code).toBe(1511);
          expect(result.error.context?.task_id).toBe('TASK-999');
          expect(result.error.context?.group_id).toBe('PG-001');
        }
      });
    });
  });

  // ===========================================================================
  // 4. getGroup Tests
  // ===========================================================================
  describe('4. getGroup Tests', () => {
    it('should return group when it exists', () => {
      const task = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task);
      manager.createGroup({
        id: 'PG-001',
        name: 'Test Group',
        taskIds: ['TASK-001'],
      });

      const result = manager.getGroup('PG-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.id).toBe('PG-001');
        expect(result.value.name).toBe('Test Group');
      }
    });

    it('should return error when group not found (error 1502)', () => {
      const result = manager.getGroup('PG-NONEXISTENT');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(1502);
      }
    });
  });

  // ===========================================================================
  // 5. getAllGroups Tests
  // ===========================================================================
  describe('5. getAllGroups Tests', () => {
    it('should return empty array when no groups exist', () => {
      const groups = manager.getAllGroups();
      expect(groups).toEqual([]);
    });

    it('should return all groups', () => {
      const task1 = createValidTask({ id: 'TASK-001' });
      const task2 = createValidTask({ id: 'TASK-002' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);
      
      manager.createGroup({
        id: 'PG-001',
        name: 'Group 1',
        taskIds: ['TASK-001'],
      });
      manager.createGroup({
        id: 'PG-002',
        name: 'Group 2',
        taskIds: ['TASK-002'],
      });

      const groups = manager.getAllGroups();

      expect(groups.length).toBe(2);
      expect(groups.map(g => g.id)).toContain('PG-001');
      expect(groups.map(g => g.id)).toContain('PG-002');
    });
  });

  // ===========================================================================
  // 6. getGroupByTask Tests
  // ===========================================================================
  describe('6. getGroupByTask Tests', () => {
    it('should return the group containing the task', () => {
      const task = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task);
      manager.createGroup({
        id: 'PG-001',
        name: 'Test Group',
        taskIds: ['TASK-001'],
      });

      const group = manager.getGroupByTask('TASK-001');

      expect(group).not.toBeNull();
      expect(group?.id).toBe('PG-001');
    });

    it('should return null when task is not in any group', () => {
      const task = createValidTask({ id: 'TASK-LONELY' });
      taskStorage.addTask(task);

      const group = manager.getGroupByTask('TASK-LONELY');

      expect(group).toBeNull();
    });

    it('should return null for non-existent task', () => {
      const group = manager.getGroupByTask('TASK-NONEXISTENT');

      expect(group).toBeNull();
    });
  });

  // ===========================================================================
  // 7. getGroupsByMilestone Tests
  // ===========================================================================
  describe('7. getGroupsByMilestone Tests', () => {
    beforeEach(() => {
      const task1 = createValidTask({ id: 'TASK-001' });
      const task2 = createValidTask({ id: 'TASK-002' });
      const task3 = createValidTask({ id: 'TASK-003' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);
      taskStorage.addTask(task3);
    });

    it('should return groups with the specified milestone', () => {
      manager.createGroup({
        id: 'PG-M1-A',
        name: 'M1 Group A',
        taskIds: ['TASK-001'],
        milestone: 'M1',
      });
      manager.createGroup({
        id: 'PG-M1-B',
        name: 'M1 Group B',
        taskIds: ['TASK-002'],
        milestone: 'M1',
      });
      manager.createGroup({
        id: 'PG-M2',
        name: 'M2 Group',
        taskIds: ['TASK-003'],
        milestone: 'M2',
      });

      const m1Groups = manager.getGroupsByMilestone('M1');

      expect(m1Groups.length).toBe(2);
      expect(m1Groups.map(g => g.id)).toContain('PG-M1-A');
      expect(m1Groups.map(g => g.id)).toContain('PG-M1-B');
    });

    it('should return empty array when no groups have the milestone', () => {
      manager.createGroup({
        id: 'PG-001',
        name: 'No Milestone',
        taskIds: ['TASK-001'],
      });

      const groups = manager.getGroupsByMilestone('M1');

      expect(groups).toEqual([]);
    });

    it('should return empty array for non-existent milestone', () => {
      const groups = manager.getGroupsByMilestone('NON_EXISTENT');

      expect(groups).toEqual([]);
    });
  });

  // ===========================================================================
  // 8. canAddToGroup Tests
  // ===========================================================================
  describe('8. canAddToGroup Tests', () => {
    beforeEach(() => {
      const task = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task);
      manager.createGroup({
        id: 'PG-001',
        name: 'Test Group',
        taskIds: ['TASK-001'],
      });
    });

    it('should return success when task can be added', () => {
      const newTask = createValidTask({ id: 'TASK-NEW' });
      taskStorage.addTask(newTask);

      const result = manager.canAddToGroup('PG-001', 'TASK-NEW');

      expect(result.success).toBe(true);
    });

    it('should return error when group does not exist', () => {
      const newTask = createValidTask({ id: 'TASK-NEW' });
      taskStorage.addTask(newTask);

      const result = manager.canAddToGroup('PG-NONEXISTENT', 'TASK-NEW');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(1502);
      }
    });

    it('should return error when task does not exist', () => {
      const result = manager.canAddToGroup('PG-001', 'TASK-NONEXISTENT');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(1505);
      }
    });

    it('should return error when task is already in another group', () => {
      const task2 = createValidTask({ id: 'TASK-002' });
      taskStorage.addTask(task2);
      manager.createGroup({
        id: 'PG-002',
        name: 'Other Group',
        taskIds: ['TASK-002'],
      });

      const result = manager.canAddToGroup('PG-001', 'TASK-002');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(1503);
      }
    });

    it('should return error when adding would create internal blocking dependency', () => {
      const blockingTask = createTaskWithBlockingDep('TASK-BLOCKING', 'TASK-001');
      taskStorage.addTask(blockingTask);

      const result = manager.canAddToGroup('PG-001', 'TASK-BLOCKING');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(1501);
      }
    });
  });

  // ===========================================================================
  // 9. validateGroupTasks Tests
  // ===========================================================================
  describe('9. validateGroupTasks Tests', () => {
    it('should return success for tasks with no internal blocking dependencies', () => {
      const task1 = createValidTask({ id: 'TASK-001' });
      const task2 = createValidTask({ id: 'TASK-002' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);

      const result = manager.validateGroupTasks(['TASK-001', 'TASK-002']);

      expect(result.success).toBe(true);
    });

    it('should return success for tasks with only non-blocking dependencies', () => {
      const task1 = createValidTask({ id: 'TASK-001' });
      const task2 = createTaskWithNonBlockingDep('TASK-002', 'TASK-001');
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);

      const result = manager.validateGroupTasks(['TASK-001', 'TASK-002']);

      expect(result.success).toBe(true);
    });

    it('should return error for tasks with internal blocking dependencies', () => {
      const task1 = createValidTask({ id: 'TASK-001' });
      const task2 = createTaskWithBlockingDep('TASK-002', 'TASK-001');
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);

      const result = manager.validateGroupTasks(['TASK-001', 'TASK-002']);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(1501);
      }
    });

    it('should return error when any task does not exist', () => {
      const task1 = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task1);

      const result = manager.validateGroupTasks(['TASK-001', 'TASK-NONEXISTENT']);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(1505);
      }
    });

    it('should ignore dependencies on tasks outside the group', () => {
      const task1 = createValidTask({ id: 'TASK-001' });
      const task2 = createTaskWithBlockingDep('TASK-002', 'TASK-EXTERNAL');
      const externalTask = createValidTask({ id: 'TASK-EXTERNAL' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);
      taskStorage.addTask(externalTask);

      // Only validate TASK-001 and TASK-002
      const result = manager.validateGroupTasks(['TASK-001', 'TASK-002']);

      // Should succeed because TASK-002's blocking dep is on TASK-EXTERNAL (outside group)
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // 10. getGroupProgress Tests
  // Validates: Requirements 6.1, 6.2
  // ===========================================================================
  describe('10. getGroupProgress Tests', () => {
    it('should return correct progress metrics (Requirement 6.1)', () => {
      const task1 = createValidTask({ id: 'TASK-001', status: 'TODO' });
      const task2 = createValidTask({ id: 'TASK-002', status: 'IN_PROGRESS' });
      const task3 = createValidTask({ id: 'TASK-003', status: 'DONE' });
      const task4 = createValidTask({ id: 'TASK-004', status: 'DONE' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);
      taskStorage.addTask(task3);
      taskStorage.addTask(task4);
      manager.createGroup({
        id: 'PG-001',
        name: 'Progress Test',
        taskIds: ['TASK-001', 'TASK-002', 'TASK-003', 'TASK-004'],
      });

      const result = manager.getGroupProgress('PG-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.total).toBe(4);
        expect(result.value.completed).toBe(2);
        expect(result.value.percentage).toBe(50);
        expect(result.value.byStatus.TODO).toBe(1);
        expect(result.value.byStatus.IN_PROGRESS).toBe(1);
        expect(result.value.byStatus.DONE).toBe(2);
      }
    });

    it('should return 0% for empty group', () => {
      const progress = calculateProgress([]);
      expect(progress.percentage).toBe(0);
      expect(progress.total).toBe(0);
      expect(progress.completed).toBe(0);
    });

    it('should return 100% when all tasks are done', () => {
      const task1 = createValidTask({ id: 'TASK-001', status: 'DONE' });
      const task2 = createValidTask({ id: 'TASK-002', status: 'DONE' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);
      manager.createGroup({
        id: 'PG-100',
        name: 'Complete',
        taskIds: ['TASK-001', 'TASK-002'],
      });

      const result = manager.getGroupProgress('PG-100');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.percentage).toBe(100);
        expect(result.value.completed).toBe(result.value.total);
      }
    });

    it('should return error when group not found', () => {
      const result = manager.getGroupProgress('PG-NONEXISTENT');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(1502);
      }
    });
  });

  // ===========================================================================
  // 11. notifyTaskCompletion Tests
  // Validates: Requirements 5.5, 6.3
  // ===========================================================================
  describe('11. notifyTaskCompletion Tests', () => {
    beforeEach(() => {
      const task1 = createValidTask({ id: 'TASK-001', status: 'TODO' });
      const task2 = createValidTask({ id: 'TASK-002', status: 'TODO' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);
      manager.createGroup({
        id: 'PG-001',
        name: 'Test Group',
        taskIds: ['TASK-001', 'TASK-002'],
      });
    });

    it('should update group progress when task is completed', () => {
      manager.notifyTaskCompletion('TASK-001');

      const result = manager.getGroupProgress('PG-001');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.completed).toBe(1);
        expect(result.value.percentage).toBe(50);
      }
    });

    it('should mark group COMPLETE when all tasks are done (Requirement 6.3)', () => {
      manager.notifyTaskCompletion('TASK-001');
      manager.notifyTaskCompletion('TASK-002');

      const group = manager.getGroup('PG-001');
      expect(group.success).toBe(true);
      if (group.success) {
        expect(group.value.status).toBe('COMPLETE');
        expect(group.value.progress.percentage).toBe(100);
      }
    });

    it('should do nothing when task is not in any group', () => {
      const loneTask = createValidTask({ id: 'TASK-LONE' });
      taskStorage.addTask(loneTask);

      // Should not throw
      expect(() => manager.notifyTaskCompletion('TASK-LONE')).not.toThrow();
    });

    it('should do nothing for non-existent task', () => {
      // Should not throw
      expect(() => manager.notifyTaskCompletion('TASK-NONEXISTENT')).not.toThrow();
    });
  });

  // ===========================================================================
  // 12. notifyTaskStatusChange Tests
  // ===========================================================================
  describe('12. notifyTaskStatusChange Tests', () => {
    beforeEach(() => {
      const task1 = createValidTask({ id: 'TASK-001', status: 'TODO' });
      const task2 = createValidTask({ id: 'TASK-002', status: 'TODO' });
      const task3 = createValidTask({ id: 'TASK-003', status: 'TODO' });
      taskStorage.addTask(task1);
      taskStorage.addTask(task2);
      taskStorage.addTask(task3);
      manager.createGroup({
        id: 'PG-001',
        name: 'Test Group',
        taskIds: ['TASK-001', 'TASK-002', 'TASK-003'],
      });
    });

    it('should update group status from PENDING to IN_PROGRESS when task starts', () => {
      const initialGroup = manager.getGroup('PG-001');
      expect(initialGroup.success).toBe(true);
      if (initialGroup.success) {
        expect(initialGroup.value.status).toBe('PENDING');
      }

      manager.notifyTaskStatusChange('TASK-001', 'IN_PROGRESS');

      const updatedGroup = manager.getGroup('PG-001');
      expect(updatedGroup.success).toBe(true);
      if (updatedGroup.success) {
        expect(updatedGroup.value.status).toBe('IN_PROGRESS');
      }
    });

    it('should update progress byStatus counts correctly', () => {
      manager.notifyTaskStatusChange('TASK-001', 'IN_PROGRESS');
      manager.notifyTaskStatusChange('TASK-002', 'BLOCKED');
      manager.notifyTaskStatusChange('TASK-003', 'DONE');

      const progress = manager.getGroupProgress('PG-001');
      expect(progress.success).toBe(true);
      if (progress.success) {
        expect(progress.value.byStatus.IN_PROGRESS).toBe(1);
        expect(progress.value.byStatus.BLOCKED).toBe(1);
        expect(progress.value.byStatus.DONE).toBe(1);
        expect(progress.value.byStatus.TODO).toBe(0);
      }
    });

    it('should transition from IN_PROGRESS to COMPLETE when last task done', () => {
      // First, start a task to get IN_PROGRESS
      manager.notifyTaskStatusChange('TASK-001', 'IN_PROGRESS');
      
      let group = manager.getGroup('PG-001');
      expect(group.success && group.value.status).toBe('IN_PROGRESS');

      // Complete all tasks
      manager.notifyTaskStatusChange('TASK-001', 'DONE');
      manager.notifyTaskStatusChange('TASK-002', 'DONE');
      manager.notifyTaskStatusChange('TASK-003', 'DONE');

      group = manager.getGroup('PG-001');
      expect(group.success).toBe(true);
      if (group.success) {
        expect(group.value.status).toBe('COMPLETE');
      }
    });

    it('should handle VERIFY status correctly', () => {
      manager.notifyTaskStatusChange('TASK-001', 'VERIFY');

      const group = manager.getGroup('PG-001');
      expect(group.success).toBe(true);
      if (group.success) {
        expect(group.value.progress.byStatus.VERIFY).toBe(1);
        expect(group.value.status).toBe('IN_PROGRESS');
      }
    });

    it('should handle READY status correctly', () => {
      manager.notifyTaskStatusChange('TASK-001', 'READY');

      const group = manager.getGroup('PG-001');
      expect(group.success).toBe(true);
      if (group.success) {
        expect(group.value.progress.byStatus.READY).toBe(1);
        // READY alone doesn't trigger IN_PROGRESS since no work has started
        expect(group.value.status).toBe('PENDING');
      }
    });

    it('should do nothing for task not in any group', () => {
      const loneTask = createValidTask({ id: 'TASK-LONE' });
      taskStorage.addTask(loneTask);

      // Should not throw
      expect(() => manager.notifyTaskStatusChange('TASK-LONE', 'DONE')).not.toThrow();
    });
  });

  // ===========================================================================
  // 13. Validation Helper Functions Tests
  // ===========================================================================
  describe('13. Validation Helper Functions', () => {
    describe('isValidGroupId', () => {
      it('should return true for valid group IDs', () => {
        expect(isValidGroupId('PG-001')).toBe(true);
        expect(isValidGroupId('group-1')).toBe(true);
        expect(isValidGroupId('a')).toBe(true);
      });

      it('should return false for invalid group IDs', () => {
        expect(isValidGroupId('')).toBe(false);
        expect(isValidGroupId('   ')).toBe(false);
      });
    });

    describe('isValidGroupName', () => {
      it('should return true for valid group names', () => {
        expect(isValidGroupName('Sprint 1 Tasks')).toBe(true);
        expect(isValidGroupName('ab')).toBe(true);
        expect(isValidGroupName('A'.repeat(99))).toBe(true);
      });

      it('should return false for invalid group names', () => {
        expect(isValidGroupName('')).toBe(false);
        expect(isValidGroupName('   ')).toBe(false);
        expect(isValidGroupName('A'.repeat(100))).toBe(false);
      });
    });

    describe('isValidParallelGroupStatus', () => {
      it('should return true for valid statuses', () => {
        expect(isValidParallelGroupStatus('PENDING')).toBe(true);
        expect(isValidParallelGroupStatus('IN_PROGRESS')).toBe(true);
        expect(isValidParallelGroupStatus('COMPLETE')).toBe(true);
      });

      it('should return false for invalid statuses', () => {
        expect(isValidParallelGroupStatus('INVALID')).toBe(false);
        expect(isValidParallelGroupStatus('pending')).toBe(false);
        expect(isValidParallelGroupStatus('')).toBe(false);
      });
    });

    describe('determineGroupStatus', () => {
      it('should return PENDING for empty group', () => {
        const progress = createEmptyProgress();
        expect(determineGroupStatus(progress)).toBe('PENDING');
      });

      it('should return PENDING when all tasks are TODO or READY', () => {
        const progress: GroupProgress = {
          total: 3,
          completed: 0,
          percentage: 0,
          byStatus: {
            TODO: 2,
            READY: 1,
            IN_PROGRESS: 0,
            BLOCKED: 0,
            VERIFY: 0,
            DONE: 0,
          },
        };
        expect(determineGroupStatus(progress)).toBe('PENDING');
      });

      it('should return IN_PROGRESS when any task is in progress', () => {
        const progress: GroupProgress = {
          total: 3,
          completed: 0,
          percentage: 0,
          byStatus: {
            TODO: 2,
            READY: 0,
            IN_PROGRESS: 1,
            BLOCKED: 0,
            VERIFY: 0,
            DONE: 0,
          },
        };
        expect(determineGroupStatus(progress)).toBe('IN_PROGRESS');
      });

      it('should return IN_PROGRESS when any task is blocked', () => {
        const progress: GroupProgress = {
          total: 3,
          completed: 0,
          percentage: 0,
          byStatus: {
            TODO: 2,
            READY: 0,
            IN_PROGRESS: 0,
            BLOCKED: 1,
            VERIFY: 0,
            DONE: 0,
          },
        };
        expect(determineGroupStatus(progress)).toBe('IN_PROGRESS');
      });

      it('should return COMPLETE when all tasks are done', () => {
        const progress: GroupProgress = {
          total: 3,
          completed: 3,
          percentage: 100,
          byStatus: {
            TODO: 0,
            READY: 0,
            IN_PROGRESS: 0,
            BLOCKED: 0,
            VERIFY: 0,
            DONE: 3,
          },
        };
        expect(determineGroupStatus(progress)).toBe('COMPLETE');
      });
    });

    describe('calculateProgress', () => {
      it('should calculate progress correctly for mixed statuses', () => {
        const members: GroupMember[] = [
          createGroupMember('T1', 'Task 1', 'TODO'),
          createGroupMember('T2', 'Task 2', 'IN_PROGRESS'),
          createGroupMember('T3', 'Task 3', 'DONE'),
          createGroupMember('T4', 'Task 4', 'DONE'),
        ];

        const progress = calculateProgress(members);

        expect(progress.total).toBe(4);
        expect(progress.completed).toBe(2);
        expect(progress.percentage).toBe(50);
        expect(progress.byStatus.TODO).toBe(1);
        expect(progress.byStatus.IN_PROGRESS).toBe(1);
        expect(progress.byStatus.DONE).toBe(2);
      });

      it('should handle empty member list', () => {
        const progress = calculateProgress([]);

        expect(progress.total).toBe(0);
        expect(progress.completed).toBe(0);
        expect(progress.percentage).toBe(0);
      });

      it('should round percentage correctly', () => {
        const members: GroupMember[] = [
          createGroupMember('T1', 'Task 1', 'DONE'),
          createGroupMember('T2', 'Task 2', 'TODO'),
          createGroupMember('T3', 'Task 3', 'TODO'),
        ];

        const progress = calculateProgress(members);

        // 1/3 = 0.333... should round to 33%
        expect(progress.percentage).toBe(33);
      });
    });
  });
});
