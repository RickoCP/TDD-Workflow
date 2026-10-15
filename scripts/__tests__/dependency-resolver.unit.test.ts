/**
 * Unit Tests for Dependency_Resolver
 * 
 * These tests verify specific scenarios for the Dependency_Resolver component
 * including addDependency, removeDependency, getDependencies, getDependents,
 * getBlockingDependencies, detectCycles, canTransitionToInProgress, canTransitionToDone,
 * and generateDependencyGraph methods.
 * 
 * **Validates: Requirements 7.1-7.5, 8.1-8.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Dependency,
  DependencyType,
  DependencyError,
  DependencyErrorCode,
  DependencyInput,
  TaskForDeps,
  TaskStatusForDeps,
  CycleDetectionResult,
  MermaidDiagram,
  DEPENDENCY_TYPES,
  TASK_STATUSES_FOR_DEPS,
  InMemoryTaskStorageForDeps,
  DependencyResolverImpl,
  Result,
  ok,
  err,
  isValidDependencyType,
  isValidTaskIdForDep,
  validateDependencyInput,
  createDependency,
  circularDependencyError,
  dependencyNotFoundError,
  selfDependencyError,
  dependencyAlreadyExistsError,
  invalidDependencyTypeError,
  taskNotFoundForDepError,
  blockingDepUnsatisfiedError,
  nonBlockingDepUnsatisfiedError,
  Role,
} from '../dependency-resolver';

// =============================================================================
// Helper Functions for Tests
// =============================================================================

/**
 * Creates a valid task for testing.
 */
function createValidTask(overrides: Partial<TaskForDeps> = {}): TaskForDeps {
  return {
    id: overrides.id ?? 'TASK-001',
    title: overrides.title ?? 'Test Task',
    status: overrides.status ?? 'TODO',
    role_required: overrides.role_required,
    assignee: overrides.assignee,
    depends_on: overrides.depends_on ?? [],
  };
}

/**
 * Creates a task with a specific status.
 */
function createTaskWithStatus(
  taskId: string,
  status: TaskStatusForDeps,
  title?: string
): TaskForDeps {
  return {
    id: taskId,
    title: title ?? `Task ${taskId}`,
    status,
    depends_on: [],
  };
}

/**
 * Creates a task with a specific role.
 */
function createTaskWithRole(
  taskId: string,
  role: Role,
  status: TaskStatusForDeps = 'TODO'
): TaskForDeps {
  return {
    id: taskId,
    title: `${role} task ${taskId}`,
    status,
    role_required: role,
    depends_on: [],
  };
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('Dependency_Resolver Unit Tests', () => {
  let taskStorage: InMemoryTaskStorageForDeps;
  let resolver: DependencyResolverImpl;

  beforeEach(() => {
    taskStorage = new InMemoryTaskStorageForDeps();
    resolver = new DependencyResolverImpl({ taskStorage });
  });

  // ===========================================================================
  // 1. addDependency Tests
  // Validates: Requirements 7.1, 7.2, 7.5
  // ===========================================================================
  describe('1. addDependency Tests', () => {
    describe('Add valid blocking dependency', () => {
      it('should successfully add a blocking dependency between two tasks', () => {
        // Setup: Create two tasks
        const taskA = createValidTask({ id: 'TASK-001', title: 'Task A' });
        const taskB = createValidTask({ id: 'TASK-002', title: 'Task B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        // Act: Add dependency (A depends on B)
        const result = resolver.addDependency('TASK-001', 'TASK-002', 'blocking');

        // Assert
        expect(result.success).toBe(true);
        
        // Verify dependency was added
        const deps = resolver.getDependencies('TASK-001');
        expect(deps.length).toBe(1);
        expect(deps[0].taskId).toBe('TASK-001');
        expect(deps[0].dependsOn).toBe('TASK-002');
        expect(deps[0].type).toBe('blocking');
      });

      it('should persist blocking dependency in task storage', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const updatedTask = taskStorage.getTask('TASK-A');
        expect(updatedTask?.depends_on?.length).toBe(1);
        expect(updatedTask?.depends_on?.[0].task_id).toBe('TASK-B');
        expect(updatedTask?.depends_on?.[0].type).toBe('blocking');
      });
    });

    describe('Add valid non_blocking dependency', () => {
      it('should successfully add a non_blocking dependency between two tasks', () => {
        const taskA = createValidTask({ id: 'TASK-001' });
        const taskB = createValidTask({ id: 'TASK-002' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        const result = resolver.addDependency('TASK-001', 'TASK-002', 'non_blocking');

        expect(result.success).toBe(true);
        
        const deps = resolver.getDependencies('TASK-001');
        expect(deps.length).toBe(1);
        expect(deps[0].type).toBe('non_blocking');
      });

      it('should persist non_blocking dependency in task storage', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'non_blocking');

        const updatedTask = taskStorage.getTask('TASK-A');
        expect(updatedTask?.depends_on?.[0].type).toBe('non_blocking');
      });
    });

    describe('Add multiple dependencies to same task', () => {
      it('should allow a task to have multiple dependencies', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        const taskD = createValidTask({ id: 'TASK-D' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);
        taskStorage.addTask(taskD);

        // A depends on B, C, and D
        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-D', 'non_blocking');

        const deps = resolver.getDependencies('TASK-A');
        expect(deps.length).toBe(3);
        expect(deps.map(d => d.dependsOn).sort()).toEqual(['TASK-B', 'TASK-C', 'TASK-D']);
      });

      it('should allow mixed dependency types for same task', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'non_blocking');

        const deps = resolver.getDependencies('TASK-A');
        const blockingDeps = deps.filter(d => d.type === 'blocking');
        const nonBlockingDeps = deps.filter(d => d.type === 'non_blocking');

        expect(blockingDeps.length).toBe(1);
        expect(nonBlockingDeps.length).toBe(1);
      });
    });

    describe('Reject self-dependency (error 1204)', () => {
      it('should reject when task depends on itself', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const result = resolver.addDependency('TASK-001', 'TASK-001', 'blocking');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.SELF_DEPENDENCY);
          expect(result.error.code).toBe(1204);
          expect(result.error.category).toBe('DEPENDENCY_ERROR');
          expect(result.error.context?.task_id).toBe('TASK-001');
          expect(result.error.context?.depends_on).toBe('TASK-001');
        }
      });

      it('should include suggested_action for self-dependency error', () => {
        const task = createValidTask({ id: 'TASK-SELF' });
        taskStorage.addTask(task);

        const result = resolver.addDependency('TASK-SELF', 'TASK-SELF', 'non_blocking');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.suggested_action).toBeDefined();
          expect(result.error.suggested_action!.length).toBeGreaterThan(0);
        }
      });
    });

    describe('Reject duplicate dependency (error 1208 - DEPENDENCY_ALREADY_EXISTS)', () => {
      it('should reject adding the same dependency twice', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        // First addition should succeed
        const result1 = resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        expect(result1.success).toBe(true);

        // Second addition should fail
        const result2 = resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        expect(result2.success).toBe(false);
        if (!result2.success) {
          expect(result2.error.code).toBe(DependencyErrorCode.DEPENDENCY_ALREADY_EXISTS);
          expect(result2.error.code).toBe(1208);
        }
      });

      it('should reject duplicate dependency even with different type', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        
        // Try to add same dependency with different type
        const result = resolver.addDependency('TASK-A', 'TASK-B', 'non_blocking');
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.DEPENDENCY_ALREADY_EXISTS);
        }
      });
    });

    describe('Reject when source task not found (error 1207)', () => {
      it('should reject when source task does not exist', () => {
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskB);

        const result = resolver.addDependency('TASK-NONEXISTENT', 'TASK-B', 'blocking');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.TASK_NOT_FOUND);
          expect(result.error.code).toBe(1207);
          expect(result.error.context?.task_id).toBe('TASK-NONEXISTENT');
        }
      });
    });

    describe('Reject when dependency task not found (error 1202)', () => {
      it('should reject when dependency task does not exist', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        taskStorage.addTask(taskA);

        const result = resolver.addDependency('TASK-A', 'TASK-NONEXISTENT', 'blocking');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.DEPENDENCY_NOT_FOUND);
          expect(result.error.code).toBe(1202);
          expect(result.error.context?.depends_on).toBe('TASK-NONEXISTENT');
        }
      });
    });

    describe('Reject circular dependency (error 1201)', () => {
      it('should reject direct two-task cycle (A→B, B→A)', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        // Add A → B (should succeed)
        const result1 = resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        expect(result1.success).toBe(true);

        // Attempt B → A (should fail - creates cycle)
        const result2 = resolver.addDependency('TASK-B', 'TASK-A', 'blocking');
        expect(result2.success).toBe(false);
        if (!result2.success) {
          expect(result2.error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
          expect(result2.error.code).toBe(1201);
          expect(result2.error.context?.cycle_path).toBeDefined();
          expect(result2.error.context?.cycle_path!.length).toBeGreaterThanOrEqual(2);
        }
      });

      it('should reject indirect three-task cycle (A→B→C→A)', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        // Build chain: A → B → C
        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-B', 'TASK-C', 'blocking');

        // Attempt C → A (should fail - creates cycle)
        const result = resolver.addDependency('TASK-C', 'TASK-A', 'blocking');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
          expect(result.error.context?.cycle_path!.length).toBeGreaterThanOrEqual(3);
        }
      });

      it('should detect cycle regardless of dependency type', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        // Add blocking dependency A → B
        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        // Attempt non_blocking B → A (should still fail)
        const result = resolver.addDependency('TASK-B', 'TASK-A', 'non_blocking');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
        }
      });

      it('should include cycle description in error message', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        const result = resolver.addDependency('TASK-B', 'TASK-A', 'blocking');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toContain('circular');
        }
      });
    });

    describe('Reject invalid dependency type (error 1203 - INVALID_DEPENDENCY_TYPE)', () => {
      it('should reject invalid dependency type', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        // Force invalid type through validation
        const result = resolver.addDependency('TASK-A', 'TASK-B', 'invalid_type' as DependencyType);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.INVALID_DEPENDENCY_TYPE);
          expect(result.error.code).toBe(1203);
          expect(result.error.context?.valid_types).toEqual(DEPENDENCY_TYPES);
        }
      });
    });
  });

  // ===========================================================================
  // 2. removeDependency Tests
  // ===========================================================================
  describe('2. removeDependency Tests', () => {
    describe('Remove existing dependency', () => {
      it('should successfully remove an existing dependency', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        expect(resolver.getDependencies('TASK-A').length).toBe(1);

        const result = resolver.removeDependency('TASK-A', 'TASK-B');

        expect(result.success).toBe(true);
        expect(resolver.getDependencies('TASK-A').length).toBe(0);
      });

      it('should update task storage after removal', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.removeDependency('TASK-A', 'TASK-B');

        const updatedTask = taskStorage.getTask('TASK-A');
        expect(updatedTask?.depends_on?.length).toBe(0);
      });

      it('should only remove specified dependency (keep others)', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'non_blocking');

        resolver.removeDependency('TASK-A', 'TASK-B');

        const deps = resolver.getDependencies('TASK-A');
        expect(deps.length).toBe(1);
        expect(deps[0].dependsOn).toBe('TASK-C');
      });
    });

    describe('Reject when task not found', () => {
      it('should reject removal when source task does not exist', () => {
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskB);

        const result = resolver.removeDependency('TASK-NONEXISTENT', 'TASK-B');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.TASK_NOT_FOUND);
        }
      });
    });

    describe('Reject when dependency not found (error 1202)', () => {
      it('should reject removal when dependency does not exist', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        // Don't add any dependency
        const result = resolver.removeDependency('TASK-A', 'TASK-B');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.DEPENDENCY_NOT_FOUND);
        }
      });

      it('should reject removal of already removed dependency', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.removeDependency('TASK-A', 'TASK-B'); // First removal

        // Second removal should fail
        const result = resolver.removeDependency('TASK-A', 'TASK-B');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.DEPENDENCY_NOT_FOUND);
        }
      });
    });

    describe('Allow reverse dependency after removal', () => {
      it('should allow adding reverse dependency after removing original', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        // Add A → B
        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        
        // Remove A → B
        resolver.removeDependency('TASK-A', 'TASK-B');
        
        // Now B → A should work
        const result = resolver.addDependency('TASK-B', 'TASK-A', 'blocking');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // 3. getDependencies Tests
  // ===========================================================================
  describe('3. getDependencies Tests', () => {
    describe('Return empty array for task with no dependencies', () => {
      it('should return empty array for task without dependencies', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const deps = resolver.getDependencies('TASK-001');

        expect(deps).toEqual([]);
        expect(Array.isArray(deps)).toBe(true);
      });

      it('should return empty array for non-existent task', () => {
        const deps = resolver.getDependencies('TASK-NONEXISTENT');

        expect(deps).toEqual([]);
      });
    });

    describe('Return all dependencies for task', () => {
      it('should return all dependencies with correct structure', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'non_blocking');

        const deps = resolver.getDependencies('TASK-A');

        expect(deps.length).toBe(2);
        expect(deps.every(d => d.taskId === 'TASK-A')).toBe(true);
        expect(deps.find(d => d.dependsOn === 'TASK-B')?.type).toBe('blocking');
        expect(deps.find(d => d.dependsOn === 'TASK-C')?.type).toBe('non_blocking');
      });

      it('should include role information in dependencies', () => {
        const taskA = createTaskWithRole('TASK-A', 'frontend');
        const taskB = createTaskWithRole('TASK-B', 'backend');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const deps = resolver.getDependencies('TASK-A');

        expect(deps.length).toBe(1);
        expect(deps[0].sourceRole).toBe('frontend');
        expect(deps[0].targetRole).toBe('backend');
      });
    });
  });

  // ===========================================================================
  // 4. getDependents Tests
  // ===========================================================================
  describe('4. getDependents Tests', () => {
    describe('Return empty array for task with no dependents', () => {
      it('should return empty array when no tasks depend on it', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const dependents = resolver.getDependents('TASK-001');

        expect(dependents).toEqual([]);
      });
    });

    describe('Return all tasks that depend on specified task', () => {
      it('should return all dependent tasks', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        const taskD = createValidTask({ id: 'TASK-D' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);
        taskStorage.addTask(taskD);

        // B, C, and D all depend on A
        resolver.addDependency('TASK-B', 'TASK-A', 'blocking');
        resolver.addDependency('TASK-C', 'TASK-A', 'blocking');
        resolver.addDependency('TASK-D', 'TASK-A', 'non_blocking');

        const dependents = resolver.getDependents('TASK-A');

        expect(dependents.length).toBe(3);
        expect(dependents.map(t => t.id).sort()).toEqual(['TASK-B', 'TASK-C', 'TASK-D']);
      });

      it('should return full task objects', () => {
        const taskA = createValidTask({ id: 'TASK-A', title: 'Source Task' });
        const taskB = createValidTask({ id: 'TASK-B', title: 'Dependent Task', status: 'IN_PROGRESS' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-B', 'TASK-A', 'blocking');

        const dependents = resolver.getDependents('TASK-A');

        expect(dependents.length).toBe(1);
        expect(dependents[0].id).toBe('TASK-B');
        expect(dependents[0].title).toBe('Dependent Task');
        expect(dependents[0].status).toBe('IN_PROGRESS');
      });
    });
  });

  // ===========================================================================
  // 5. getBlockingDependencies Tests
  // ===========================================================================
  describe('5. getBlockingDependencies Tests', () => {
    describe('Return only unsatisfied blocking dependencies', () => {
      it('should return blocking dependencies where dependency task is not DONE', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        const taskC = createTaskWithStatus('TASK-C', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'blocking');

        const blocking = resolver.getBlockingDependencies('TASK-A');

        expect(blocking.length).toBe(2);
      });

      it('should not return blocking dependencies where dependency task is DONE', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'DONE');
        const taskC = createTaskWithStatus('TASK-C', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'blocking');

        const blocking = resolver.getBlockingDependencies('TASK-A');

        expect(blocking.length).toBe(1);
        expect(blocking[0].dependsOn).toBe('TASK-C');
      });

      it('should return empty when all blocking dependencies are satisfied', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'DONE');
        const taskC = createTaskWithStatus('TASK-C', 'DONE');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'blocking');

        const blocking = resolver.getBlockingDependencies('TASK-A');

        expect(blocking.length).toBe(0);
      });
    });

    describe('Ignore non_blocking dependencies', () => {
      it('should not include non_blocking dependencies in result', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        const taskC = createTaskWithStatus('TASK-C', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'non_blocking');

        const blocking = resolver.getBlockingDependencies('TASK-A');

        expect(blocking.length).toBe(1);
        expect(blocking[0].dependsOn).toBe('TASK-B');
      });
    });
  });

  // ===========================================================================
  // 6. detectCycles Tests
  // Validates: Requirements 7.5
  // ===========================================================================
  describe('6. detectCycles Tests', () => {
    describe('Return hasCycle: false for valid additions', () => {
      it('should return false for non-cyclic dependency', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        const result = resolver.detectCycles('TASK-A', 'TASK-B');

        expect(result.hasCycle).toBe(false);
        expect(result.cyclePath).toEqual([]);
      });

      it('should return false for diamond dependency (not a cycle)', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        const taskD = createValidTask({ id: 'TASK-D' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);
        taskStorage.addTask(taskD);

        // Diamond: B→A, C→A, D→B, D→C
        resolver.addDependency('TASK-B', 'TASK-A', 'blocking');
        resolver.addDependency('TASK-C', 'TASK-A', 'blocking');
        resolver.addDependency('TASK-D', 'TASK-B', 'blocking');

        // Check if D→C would create a cycle (it shouldn't)
        const result = resolver.detectCycles('TASK-D', 'TASK-C');

        expect(result.hasCycle).toBe(false);
      });
    });

    describe('Return hasCycle: true for cyclic additions', () => {
      it('should detect direct cycle', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const result = resolver.detectCycles('TASK-B', 'TASK-A');

        expect(result.hasCycle).toBe(true);
        expect(result.cyclePath.length).toBeGreaterThanOrEqual(2);
      });

      it('should detect indirect cycle', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-B', 'TASK-C', 'blocking');

        const result = resolver.detectCycles('TASK-C', 'TASK-A');

        expect(result.hasCycle).toBe(true);
        expect(result.cyclePath.length).toBeGreaterThanOrEqual(3);
      });

      it('should include description of cycle', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const result = resolver.detectCycles('TASK-B', 'TASK-A');

        expect(result.hasCycle).toBe(true);
        expect(result.description).toBeDefined();
        expect(result.description!.length).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // 7. canTransitionToInProgress Tests (error 1206 - BLOCKING_DEP_UNSATISFIED)
  // Validates: Requirements 7.3
  // ===========================================================================
  describe('7. canTransitionToInProgress Tests', () => {
    describe('Allow transition when all blocking dependencies are DONE', () => {
      it('should allow transition when no dependencies exist', () => {
        const task = createTaskWithStatus('TASK-A', 'TODO');
        taskStorage.addTask(task);

        const result = resolver.canTransitionToInProgress('TASK-A');

        expect(result.success).toBe(true);
      });

      it('should allow transition when all blocking dependencies are DONE', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'DONE');
        const taskC = createTaskWithStatus('TASK-C', 'DONE');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'blocking');

        const result = resolver.canTransitionToInProgress('TASK-A');

        expect(result.success).toBe(true);
      });

      it('should allow transition when only non_blocking dependencies are unsatisfied', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'IN_PROGRESS'); // non_blocking, not done
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'non_blocking');

        const result = resolver.canTransitionToInProgress('TASK-A');

        expect(result.success).toBe(true);
      });
    });

    describe('Reject transition when blocking dependencies unsatisfied (error 1205 - BLOCKING_DEP_UNSATISFIED)', () => {
      it('should reject when any blocking dependency is not DONE', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'IN_PROGRESS');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const result = resolver.canTransitionToInProgress('TASK-A');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
          expect(result.error.code).toBe(1205);
          expect(result.error.context?.unsatisfied_dependencies).toContain('TASK-B');
        }
      });

      it('should list all unsatisfied blocking dependencies in error', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        const taskC = createTaskWithStatus('TASK-C', 'TODO');
        const taskD = createTaskWithStatus('TASK-D', 'DONE');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);
        taskStorage.addTask(taskD);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-D', 'blocking');

        const result = resolver.canTransitionToInProgress('TASK-A');

        expect(result.success).toBe(false);
        if (!result.success) {
          const unsatisfied = result.error.context?.unsatisfied_dependencies!;
          expect(unsatisfied).toContain('TASK-B');
          expect(unsatisfied).toContain('TASK-C');
          expect(unsatisfied).not.toContain('TASK-D'); // D is DONE
        }
      });

      it('should include suggested action in error', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const result = resolver.canTransitionToInProgress('TASK-A');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.suggested_action).toBeDefined();
          expect(result.error.suggested_action).toContain('TASK-B');
        }
      });
    });

    describe('Reject when task not found', () => {
      it('should reject for non-existent task', () => {
        const result = resolver.canTransitionToInProgress('TASK-NONEXISTENT');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.TASK_NOT_FOUND);
        }
      });
    });
  });

  // ===========================================================================
  // 8. canTransitionToDone Tests (error 1207 - NON_BLOCKING_DEP_UNSATISFIED)
  // Validates: Requirements 7.4
  // ===========================================================================
  describe('8. canTransitionToDone Tests', () => {
    describe('Allow transition when all non_blocking dependencies are DONE', () => {
      it('should allow transition when no dependencies exist', () => {
        const task = createTaskWithStatus('TASK-A', 'IN_PROGRESS');
        taskStorage.addTask(task);

        const result = resolver.canTransitionToDone('TASK-A');

        expect(result.success).toBe(true);
      });

      it('should allow transition when all non_blocking dependencies are DONE', () => {
        const taskA = createTaskWithStatus('TASK-A', 'IN_PROGRESS');
        const taskB = createTaskWithStatus('TASK-B', 'DONE');
        const taskC = createTaskWithStatus('TASK-C', 'DONE');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'non_blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'non_blocking');

        const result = resolver.canTransitionToDone('TASK-A');

        expect(result.success).toBe(true);
      });

      it('should allow transition when only blocking dependencies exist (regardless of status)', () => {
        const taskA = createTaskWithStatus('TASK-A', 'IN_PROGRESS');
        const taskB = createTaskWithStatus('TASK-B', 'TODO'); // Blocking but not checked for DONE transition
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        // Note: canTransitionToDone only checks non_blocking dependencies
        // The blocking check happens in canTransitionToInProgress
        const result = resolver.canTransitionToDone('TASK-A');

        expect(result.success).toBe(true);
      });
    });

    describe('Reject transition when non_blocking dependencies unsatisfied (error 1206 - NON_BLOCKING_DEP_UNSATISFIED)', () => {
      it('should reject when any non_blocking dependency is not DONE', () => {
        const taskA = createTaskWithStatus('TASK-A', 'IN_PROGRESS');
        const taskB = createTaskWithStatus('TASK-B', 'IN_PROGRESS');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'non_blocking');

        const result = resolver.canTransitionToDone('TASK-A');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
          expect(result.error.code).toBe(1206);
          expect(result.error.context?.unsatisfied_dependencies).toContain('TASK-B');
        }
      });

      it('should list all unsatisfied non_blocking dependencies in error', () => {
        const taskA = createTaskWithStatus('TASK-A', 'IN_PROGRESS');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        const taskC = createTaskWithStatus('TASK-C', 'VERIFY');
        const taskD = createTaskWithStatus('TASK-D', 'DONE');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);
        taskStorage.addTask(taskD);

        resolver.addDependency('TASK-A', 'TASK-B', 'non_blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'non_blocking');
        resolver.addDependency('TASK-A', 'TASK-D', 'non_blocking');

        const result = resolver.canTransitionToDone('TASK-A');

        expect(result.success).toBe(false);
        if (!result.success) {
          const unsatisfied = result.error.context?.unsatisfied_dependencies!;
          expect(unsatisfied).toContain('TASK-B');
          expect(unsatisfied).toContain('TASK-C');
          expect(unsatisfied).not.toContain('TASK-D'); // D is DONE
        }
      });

      it('should include suggested action in error', () => {
        const taskA = createTaskWithStatus('TASK-A', 'IN_PROGRESS');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'non_blocking');

        const result = resolver.canTransitionToDone('TASK-A');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.suggested_action).toBeDefined();
          expect(result.error.suggested_action).toContain('TASK-B');
        }
      });
    });

    describe('Reject when task not found', () => {
      it('should reject for non-existent task', () => {
        const result = resolver.canTransitionToDone('TASK-NONEXISTENT');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.TASK_NOT_FOUND);
        }
      });
    });
  });

  // ===========================================================================
  // 9. generateDependencyGraph Tests
  // Validates: Requirements 8.1, 8.2, 8.3, 8.4
  // ===========================================================================
  describe('9. generateDependencyGraph Tests', () => {
    describe('Generate Mermaid diagram format (Requirement 8.4)', () => {
      it('should return valid MermaidDiagram object', () => {
        const taskA = createValidTask({ id: 'TASK-A', title: 'Task A' });
        const taskB = createValidTask({ id: 'TASK-B', title: 'Task B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const diagram = resolver.generateDependencyGraph();

        expect(diagram).toBeDefined();
        expect(diagram.content).toBeDefined();
        expect(diagram.type).toBe('flowchart');
        expect(typeof diagram.content).toBe('string');
      });

      it('should include graph TD declaration', () => {
        const task = createValidTask({ id: 'TASK-001' });
        taskStorage.addTask(task);

        const diagram = resolver.generateDependencyGraph();

        expect(diagram.content).toContain('graph TD');
      });

      it('should include task nodes', () => {
        const taskA = createValidTask({ id: 'TASK-A', title: 'Task A' });
        const taskB = createValidTask({ id: 'TASK-B', title: 'Task B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        const diagram = resolver.generateDependencyGraph();

        expect(diagram.content).toContain('TASK-A');
        expect(diagram.content).toContain('TASK-B');
      });

      it('should use different arrow styles for blocking vs non_blocking', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        const taskC = createValidTask({ id: 'TASK-C' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-A', 'TASK-C', 'non_blocking');

        const diagram = resolver.generateDependencyGraph();

        // Blocking uses --> and non_blocking uses -.->
        expect(diagram.content).toContain('-->');
        expect(diagram.content).toContain('-.->');
      });
    });

    describe('Highlight cross-role dependencies (Requirement 8.2)', () => {
      it('should identify cross-role dependencies', () => {
        const taskA = createTaskWithRole('TASK-A', 'frontend');
        const taskB = createTaskWithRole('TASK-B', 'backend');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const diagram = resolver.generateDependencyGraph();

        expect(diagram.crossRoleDependencies.length).toBe(1);
        expect(diagram.crossRoleDependencies[0].sourceRole).toBe('frontend');
        expect(diagram.crossRoleDependencies[0].targetRole).toBe('backend');
      });

      it('should not mark same-role dependencies as cross-role', () => {
        const taskA = createTaskWithRole('TASK-A', 'backend');
        const taskB = createTaskWithRole('TASK-B', 'backend');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const diagram = resolver.generateDependencyGraph();

        expect(diagram.crossRoleDependencies.length).toBe(0);
      });

      it('should include cross-role label in diagram', () => {
        const taskA = createTaskWithRole('TASK-A', 'frontend');
        const taskB = createTaskWithRole('TASK-B', 'backend');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');

        const diagram = resolver.generateDependencyGraph();

        expect(diagram.content).toContain('cross-role');
      });
    });

    describe('Include critical path (Requirement 8.3)', () => {
      it('should return critical path tasks', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        const taskC = createTaskWithStatus('TASK-C', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        // A → B → C (A blocks the most downstream work)
        resolver.addDependency('TASK-B', 'TASK-A', 'blocking');
        resolver.addDependency('TASK-C', 'TASK-B', 'blocking');

        const diagram = resolver.generateDependencyGraph();

        expect(diagram.criticalPath).toBeDefined();
        expect(Array.isArray(diagram.criticalPath)).toBe(true);
        // A should be on critical path as it blocks B which blocks C
        expect(diagram.criticalPath).toContain('TASK-A');
      });

      it('should not include DONE tasks in critical path', () => {
        const taskA = createTaskWithStatus('TASK-A', 'DONE');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        resolver.addDependency('TASK-B', 'TASK-A', 'blocking');

        const diagram = resolver.generateDependencyGraph();

        expect(diagram.criticalPath).not.toContain('TASK-A');
      });
    });

    describe('Return complete diagram with all relationships (Requirement 8.1)', () => {
      it('should show all tasks and their relationships', () => {
        const taskA = createValidTask({ id: 'TASK-A', title: 'Feature A' });
        const taskB = createValidTask({ id: 'TASK-B', title: 'Feature B' });
        const taskC = createValidTask({ id: 'TASK-C', title: 'Feature C' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-A', 'TASK-B', 'blocking');
        resolver.addDependency('TASK-C', 'TASK-A', 'non_blocking');

        const diagram = resolver.generateDependencyGraph();

        // Should contain all three tasks
        expect(diagram.content).toContain('TASK-A');
        expect(diagram.content).toContain('TASK-B');
        expect(diagram.content).toContain('TASK-C');

        // Should show dependency relationships
        expect(diagram.content).toContain('TASK-B');
        expect(diagram.content).toContain('TASK-A');
      });

      it('should include style definitions for status', () => {
        const task = createTaskWithStatus('TASK-001', 'IN_PROGRESS');
        taskStorage.addTask(task);

        const diagram = resolver.generateDependencyGraph();

        expect(diagram.content).toContain('classDef');
        expect(diagram.content).toContain('inProgress');
        expect(diagram.content).toContain('done');
        expect(diagram.content).toContain('todo');
        expect(diagram.content).toContain('blocked');
      });
    });
  });

  // ===========================================================================
  // 10. Validation Helper Function Tests
  // ===========================================================================
  describe('10. Validation Helper Function Tests', () => {
    describe('isValidDependencyType', () => {
      it('should return true for "blocking"', () => {
        expect(isValidDependencyType('blocking')).toBe(true);
      });

      it('should return true for "non_blocking"', () => {
        expect(isValidDependencyType('non_blocking')).toBe(true);
      });

      it('should return false for invalid types', () => {
        expect(isValidDependencyType('invalid')).toBe(false);
        expect(isValidDependencyType('BLOCKING')).toBe(false);
        expect(isValidDependencyType('')).toBe(false);
        expect(isValidDependencyType('soft')).toBe(false);
      });
    });

    describe('isValidTaskIdForDep', () => {
      it('should return true for valid task IDs', () => {
        expect(isValidTaskIdForDep('TASK-001')).toBe(true);
        expect(isValidTaskIdForDep('task-123')).toBe(true);
        expect(isValidTaskIdForDep('a')).toBe(true);
      });

      it('should return false for invalid task IDs', () => {
        expect(isValidTaskIdForDep('')).toBe(false);
        expect(isValidTaskIdForDep('   ')).toBe(false);
      });
    });

    describe('validateDependencyInput', () => {
      it('should succeed for valid input', () => {
        const result = validateDependencyInput('TASK-A', 'TASK-B', 'blocking');
        expect(result.success).toBe(true);
      });

      it('should fail for self-dependency', () => {
        const result = validateDependencyInput('TASK-A', 'TASK-A', 'blocking');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.SELF_DEPENDENCY);
        }
      });

      it('should fail for invalid dependency type', () => {
        const result = validateDependencyInput('TASK-A', 'TASK-B', 'invalid');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(DependencyErrorCode.INVALID_DEPENDENCY_TYPE);
        }
      });

      it('should fail for empty task ID', () => {
        const result = validateDependencyInput('', 'TASK-B', 'blocking');
        expect(result.success).toBe(false);
      });

      it('should fail for empty depends_on ID', () => {
        const result = validateDependencyInput('TASK-A', '', 'blocking');
        expect(result.success).toBe(false);
      });
    });
  });

  // ===========================================================================
  // 11. Error Factory Function Tests
  // ===========================================================================
  describe('11. Error Factory Function Tests', () => {
    describe('circularDependencyError', () => {
      it('should create error with correct code and structure', () => {
        const error = circularDependencyError('TASK-A', 'TASK-B', ['TASK-A', 'TASK-B', 'TASK-A']);

        expect(error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
        expect(error.category).toBe('DEPENDENCY_ERROR');
        expect(error.context?.task_id).toBe('TASK-A');
        expect(error.context?.depends_on).toBe('TASK-B');
        expect(error.context?.cycle_path).toEqual(['TASK-A', 'TASK-B', 'TASK-A']);
        expect(error.message).toContain('circular');
        expect(error.suggested_action).toBeDefined();
        expect(error.timestamp).toBeDefined();
      });
    });

    describe('dependencyNotFoundError', () => {
      it('should create error with correct code', () => {
        const error = dependencyNotFoundError('TASK-A', 'TASK-B');

        expect(error.code).toBe(DependencyErrorCode.DEPENDENCY_NOT_FOUND);
        expect(error.context?.task_id).toBe('TASK-A');
        expect(error.context?.depends_on).toBe('TASK-B');
      });
    });

    describe('selfDependencyError', () => {
      it('should create error with correct code', () => {
        const error = selfDependencyError('TASK-A');

        expect(error.code).toBe(DependencyErrorCode.SELF_DEPENDENCY);
        expect(error.context?.task_id).toBe('TASK-A');
        expect(error.context?.depends_on).toBe('TASK-A');
      });
    });

    describe('dependencyAlreadyExistsError', () => {
      it('should create error with correct code', () => {
        const error = dependencyAlreadyExistsError('TASK-A', 'TASK-B');

        expect(error.code).toBe(DependencyErrorCode.DEPENDENCY_ALREADY_EXISTS);
        expect(error.context?.task_id).toBe('TASK-A');
        expect(error.context?.depends_on).toBe('TASK-B');
      });
    });

    describe('blockingDepUnsatisfiedError', () => {
      it('should create error with unsatisfied dependencies list', () => {
        const error = blockingDepUnsatisfiedError('TASK-A', ['TASK-B', 'TASK-C']);

        expect(error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
        expect(error.context?.task_id).toBe('TASK-A');
        expect(error.context?.unsatisfied_dependencies).toEqual(['TASK-B', 'TASK-C']);
      });
    });

    describe('nonBlockingDepUnsatisfiedError', () => {
      it('should create error with unsatisfied dependencies list', () => {
        const error = nonBlockingDepUnsatisfiedError('TASK-A', ['TASK-B', 'TASK-C']);

        expect(error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
        expect(error.context?.task_id).toBe('TASK-A');
        expect(error.context?.unsatisfied_dependencies).toEqual(['TASK-B', 'TASK-C']);
      });
    });
  });

  // ===========================================================================
  // 12. getCriticalPath Tests
  // Validates: Requirements 8.3
  // ===========================================================================
  describe('12. getCriticalPath Tests', () => {
    describe('Identify tasks that block the most downstream work', () => {
      it('should return empty array when no tasks exist', () => {
        const criticalPath = resolver.getCriticalPath();
        expect(criticalPath).toEqual([]);
      });

      it('should return empty array when no dependencies exist', () => {
        const taskA = createValidTask({ id: 'TASK-A' });
        const taskB = createValidTask({ id: 'TASK-B' });
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);

        const criticalPath = resolver.getCriticalPath();
        expect(criticalPath).toEqual([]);
      });

      it('should identify root task in linear chain', () => {
        const taskA = createTaskWithStatus('TASK-A', 'TODO');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        const taskC = createTaskWithStatus('TASK-C', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        // Chain: A ← B ← C (C depends on B, B depends on A)
        resolver.addDependency('TASK-B', 'TASK-A', 'blocking');
        resolver.addDependency('TASK-C', 'TASK-B', 'blocking');

        const criticalPath = resolver.getCriticalPath();

        // A blocks B, B blocks C => A has impact 2, B has impact 1
        expect(criticalPath.length).toBeGreaterThan(0);
        expect(criticalPath[0].id).toBe('TASK-A'); // Highest impact first
      });

      it('should not include completed (DONE) tasks', () => {
        const taskA = createTaskWithStatus('TASK-A', 'DONE');
        const taskB = createTaskWithStatus('TASK-B', 'TODO');
        const taskC = createTaskWithStatus('TASK-C', 'TODO');
        taskStorage.addTask(taskA);
        taskStorage.addTask(taskB);
        taskStorage.addTask(taskC);

        resolver.addDependency('TASK-B', 'TASK-A', 'blocking');
        resolver.addDependency('TASK-C', 'TASK-B', 'blocking');

        const criticalPath = resolver.getCriticalPath();

        expect(criticalPath.find(t => t.id === 'TASK-A')).toBeUndefined();
      });
    });
  });
});
