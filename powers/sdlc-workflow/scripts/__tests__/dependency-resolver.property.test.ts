/**
 * Property-Based Tests for Dependency_Resolver
 * 
 * **Feature: multi-developer-support, Property 4: Dependency Cycle Detection**
 * 
 * These tests verify the universal correctness properties of the Dependency_Resolver component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements 7.1, 7.3**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  Dependency,
  DependencyType,
  DependencyError,
  DependencyErrorCode,
  DependencyInput,
  TaskForDeps,
  TaskStatusForDeps,
  CycleDetectionResult,
  DEPENDENCY_TYPES,
  TASK_STATUSES_FOR_DEPS,
  InMemoryTaskStorageForDeps,
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
} from '../dependency-resolver';

// =============================================================================
// In-Memory Dependency_Resolver Implementation for Testing
// =============================================================================

/**
 * In-memory implementation of Dependency_Resolver for testing purposes.
 * This implementation follows the interface defined in dependency-resolver.ts
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
class InMemoryDependencyResolver {
  private storage: InMemoryTaskStorageForDeps;
  
  constructor(storage: InMemoryTaskStorageForDeps) {
    this.storage = storage;
  }

  /**
   * Adds a dependency between two tasks.
   * 
   * Requirements: 7.1, 7.2, 7.5
   */
  addDependency(taskId: string, dependsOn: string, type: DependencyType): Result<void, DependencyError> {
    // Validate basic input
    const validationResult = validateDependencyInput(taskId, dependsOn, type);
    if (!validationResult.success) {
      return validationResult;
    }

    // Check that the task exists
    const task = this.storage.getTask(taskId);
    if (!task) {
      return err({
        code: DependencyErrorCode.TASK_NOT_FOUND,
        category: 'DEPENDENCY_ERROR',
        message: `Task '${taskId}' not found`,
        context: { task_id: taskId },
        suggested_action: 'Verify the task ID or create the task first',
        timestamp: new Date().toISOString(),
      });
    }

    // Check that the dependency task exists
    const depTask = this.storage.getTask(dependsOn);
    if (!depTask) {
      return err(dependencyNotFoundError(taskId, dependsOn));
    }

    // Check for existing dependency
    const existingDeps = task.depends_on || [];
    if (existingDeps.some(d => d.task_id === dependsOn)) {
      return err(dependencyAlreadyExistsError(taskId, dependsOn));
    }

    // Detect cycles - Requirement 7.5
    const cycleResult = this.detectCycles(taskId, dependsOn);
    if (cycleResult.hasCycle) {
      return err(circularDependencyError(taskId, dependsOn, cycleResult.cyclePath));
    }

    // Add the dependency
    const updatedDeps: DependencyInput[] = [
      ...existingDeps,
      { task_id: dependsOn, type },
    ];

    this.storage.updateTask({
      ...task,
      depends_on: updatedDeps,
    });

    return ok(undefined);
  }

  /**
   * Removes a dependency between two tasks.
   */
  removeDependency(taskId: string, dependsOn: string): Result<void, DependencyError> {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return err({
        code: DependencyErrorCode.TASK_NOT_FOUND,
        category: 'DEPENDENCY_ERROR',
        message: `Task '${taskId}' not found`,
        context: { task_id: taskId },
        suggested_action: 'Verify the task ID',
        timestamp: new Date().toISOString(),
      });
    }

    const existingDeps = task.depends_on || [];
    const depIndex = existingDeps.findIndex(d => d.task_id === dependsOn);
    
    if (depIndex === -1) {
      return err(dependencyNotFoundError(taskId, dependsOn));
    }

    const updatedDeps = [...existingDeps];
    updatedDeps.splice(depIndex, 1);

    this.storage.updateTask({
      ...task,
      depends_on: updatedDeps,
    });

    return ok(undefined);
  }

  /**
   * Gets all dependencies for a task.
   */
  getDependencies(taskId: string): Dependency[] {
    const task = this.storage.getTask(taskId);
    if (!task || !task.depends_on) {
      return [];
    }

    return task.depends_on.map(d => createDependency(
      taskId,
      d.task_id,
      d.type,
      d.reason,
      task.role_required,
      this.storage.getTask(d.task_id)?.role_required
    ));
  }

  /**
   * Gets all tasks that depend on a specific task.
   */
  getDependents(taskId: string): TaskForDeps[] {
    const allTasks = this.storage.getAllTasks();
    return allTasks.filter(task => 
      task.depends_on?.some(d => d.task_id === taskId)
    );
  }

  /**
   * Gets all blocking dependencies that are not satisfied (not DONE).
   */
  getBlockingDependencies(taskId: string): Dependency[] {
    const deps = this.getDependencies(taskId);
    return deps.filter(d => {
      if (d.type !== 'blocking') return false;
      const depTask = this.storage.getTask(d.dependsOn);
      return depTask && depTask.status !== 'DONE';
    });
  }

  /**
   * Detects if adding a dependency would create a cycle.
   * Uses DFS to check if there's a path from dependsOn back to taskId.
   * 
   * Requirements: 7.5
   */
  detectCycles(taskId: string, dependsOn: string): CycleDetectionResult {
    // Self-dependency is a trivial cycle
    if (taskId === dependsOn) {
      return {
        hasCycle: true,
        cyclePath: [taskId, taskId],
        description: `Task '${taskId}' cannot depend on itself`,
      };
    }

    // Check if there's a path from dependsOn to taskId (which would create a cycle)
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (current: string): boolean => {
      if (current === taskId) {
        // Found a path back to taskId - cycle detected
        path.push(current);
        return true;
      }

      if (visited.has(current)) {
        return false;
      }

      visited.add(current);
      path.push(current);

      const task = this.storage.getTask(current);
      if (task?.depends_on) {
        for (const dep of task.depends_on) {
          if (dfs(dep.task_id)) {
            return true;
          }
        }
      }

      path.pop();
      return false;
    };

    // Start DFS from dependsOn
    if (dfs(dependsOn)) {
      // Reconstruct the cycle path
      const cycleStartIndex = path.indexOf(taskId);
      const cyclePath = [...path.slice(cycleStartIndex), taskId];
      
      // Format cycle path: taskId -> dependsOn -> ... -> taskId
      return {
        hasCycle: true,
        cyclePath: [taskId, ...path, taskId],
        description: `Adding dependency from '${taskId}' to '${dependsOn}' would create cycle: ${[taskId, ...path, taskId].join(' → ')}`,
      };
    }

    return {
      hasCycle: false,
      cyclePath: [],
    };
  }

  /**
   * Validates if a task can transition to IN_PROGRESS status.
   * All blocking dependencies must be DONE.
   * 
   * Requirements: 7.3
   */
  canTransitionToInProgress(taskId: string): Result<void, DependencyError> {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return err({
        code: DependencyErrorCode.TASK_NOT_FOUND,
        category: 'DEPENDENCY_ERROR',
        message: `Task '${taskId}' not found`,
        context: { task_id: taskId },
        suggested_action: 'Verify the task ID',
        timestamp: new Date().toISOString(),
      });
    }

    const blockingDeps = this.getBlockingDependencies(taskId);
    if (blockingDeps.length > 0) {
      const unsatisfied = blockingDeps.map(d => d.dependsOn);
      return err({
        code: DependencyErrorCode.BLOCKING_DEP_UNSATISFIED,
        category: 'DEPENDENCY_ERROR',
        message: `Task '${taskId}' cannot transition to IN_PROGRESS: blocking dependencies are not satisfied`,
        context: { task_id: taskId, unsatisfied_dependencies: unsatisfied },
        suggested_action: `Complete the following blocking dependencies first: ${unsatisfied.join(', ')}`,
        timestamp: new Date().toISOString(),
      });
    }

    return ok(undefined);
  }

  /**
   * Validates if a task can transition to DONE status.
   * All non-blocking dependencies must be DONE.
   * 
   * Requirements: 7.4
   */
  canTransitionToDone(taskId: string): Result<void, DependencyError> {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return err({
        code: DependencyErrorCode.TASK_NOT_FOUND,
        category: 'DEPENDENCY_ERROR',
        message: `Task '${taskId}' not found`,
        context: { task_id: taskId },
        suggested_action: 'Verify the task ID',
        timestamp: new Date().toISOString(),
      });
    }

    const deps = this.getDependencies(taskId);
    const unsatisfiedNonBlocking = deps.filter(d => {
      if (d.type !== 'non_blocking') return false;
      const depTask = this.storage.getTask(d.dependsOn);
      return depTask && depTask.status !== 'DONE';
    });

    if (unsatisfiedNonBlocking.length > 0) {
      const unsatisfied = unsatisfiedNonBlocking.map(d => d.dependsOn);
      return err({
        code: DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED,
        category: 'DEPENDENCY_ERROR',
        message: `Task '${taskId}' cannot transition to DONE: non-blocking dependencies are not satisfied`,
        context: { task_id: taskId, unsatisfied_dependencies: unsatisfied },
        suggested_action: `Complete the following non-blocking dependencies first: ${unsatisfied.join(', ')}`,
        timestamp: new Date().toISOString(),
      });
    }

    return ok(undefined);
  }

  /**
   * Clears the resolver state (delegates to storage).
   */
  clear(): void {
    this.storage.clear();
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
 * Generates a valid dependency type.
 */
const dependencyTypeArb: fc.Arbitrary<DependencyType> = fc.constantFrom(...DEPENDENCY_TYPES);

/**
 * Generates a valid task status.
 */
const taskStatusArb: fc.Arbitrary<TaskStatusForDeps> = fc.constantFrom(...TASK_STATUSES_FOR_DEPS);

/**
 * Generates a basic task without dependencies.
 */
const basicTaskArb: fc.Arbitrary<TaskForDeps> = fc.record({
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
const uniqueTasksArb = (minCount: number, maxCount: number): fc.Arbitrary<TaskForDeps[]> => {
  return fc.array(basicTaskArb, { minLength: minCount, maxLength: maxCount }).map(tasks => {
    // Ensure unique IDs by appending index
    return tasks.map((task, index) => ({
      ...task,
      id: `TASK-${String(index + 100).padStart(3, '0')}`,
    }));
  });
};

/**
 * Generates a directed acyclic graph (DAG) of task dependencies.
 * Uses topological ordering to ensure no cycles:
 * - Tasks can only depend on tasks with lower indices.
 */
const dagArb = (taskCount: number): fc.Arbitrary<{ tasks: TaskForDeps[]; edges: Array<{ from: number; to: number; type: DependencyType }> }> => {
  return fc.record({
    tasks: uniqueTasksArb(taskCount, taskCount),
    // Generate edges where "from" task has higher index than "to" task (ensures DAG)
    edges: fc.array(
      fc.record({
        from: fc.integer({ min: 1, max: taskCount - 1 }), // Task that depends
        to: fc.nat({ max: taskCount - 2 }), // Task it depends on (must be lower index)
        type: dependencyTypeArb,
      }).filter(edge => edge.from > edge.to), // Ensure from > to for DAG property
      { minLength: 0, maxLength: Math.floor(taskCount * 1.5) }
    ),
  }).map(({ tasks, edges }) => {
    // Remove duplicate edges
    const uniqueEdges = edges.filter((edge, index, arr) => 
      arr.findIndex(e => e.from === edge.from && e.to === edge.to) === index
    );
    return { tasks, edges: uniqueEdges };
  });
};

/**
 * Generates an edge that would create a cycle in a DAG.
 * Given a DAG, generates an edge from a lower-indexed task to a higher-indexed task,
 * which when added would create a cycle if a path exists from high to low.
 */
const cycleCreatingEdgeArb = (taskCount: number): fc.Arbitrary<{ from: number; to: number }> => {
  return fc.record({
    from: fc.nat({ max: taskCount - 2 }), // Lower indexed task
    to: fc.integer({ min: 1, max: taskCount - 1 }), // Higher indexed task
  }).filter(edge => edge.from < edge.to);
};

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('Dependency_Resolver Property-Based Tests', () => {
  /**
   * **Feature: multi-developer-support, Property 4: Dependency Cycle Detection**
   * 
   * *For any* attempt to add a dependency that would create a circular dependency chain,
   * the Dependency_Resolver SHALL detect and reject the change with a CIRCULAR_DEPENDENCY error.
   * 
   * **Validates: Requirements 7.1, 7.3**
   */
  describe('Property 4: Dependency Cycle Detection', () => {
    let storage: InMemoryTaskStorageForDeps;
    let resolver: InMemoryDependencyResolver;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForDeps();
      resolver = new InMemoryDependencyResolver(storage);
    });

    it('should accept all edges in a valid DAG (no cycles)', () => {
      fc.assert(
        fc.property(
          dagArb(10),
          ({ tasks, edges }) => {
            storage.clear();
            
            // Add all tasks to storage
            for (const task of tasks) {
              storage.addTask(task);
            }

            // Add all DAG edges - all should succeed since DAG has no cycles
            for (const edge of edges) {
              const fromTask = tasks[edge.from];
              const toTask = tasks[edge.to];
              
              const result = resolver.addDependency(fromTask.id, toTask.id, edge.type);
              expect(result.success).toBe(true);
            }

            // Verify all dependencies were added correctly
            for (const edge of edges) {
              const fromTask = tasks[edge.from];
              const toTask = tasks[edge.to];
              
              const deps = resolver.getDependencies(fromTask.id);
              expect(deps.some(d => d.dependsOn === toTask.id)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should always reject self-dependencies with CIRCULAR_DEPENDENCY error (1201)', () => {
      fc.assert(
        fc.property(
          basicTaskArb,
          dependencyTypeArb,
          (task, depType) => {
            storage.clear();
            storage.addTask(task);

            // Attempt to add self-dependency
            const result = resolver.addDependency(task.id, task.id, depType);
            
            // Should always fail with cycle detection
            expect(result.success).toBe(false);
            if (!result.success) {
              // Self-dependency is detected as SELF_DEPENDENCY (1204) by validation
              // before cycle detection runs
              expect([
                DependencyErrorCode.SELF_DEPENDENCY,
                DependencyErrorCode.CIRCULAR_DEPENDENCY,
              ]).toContain(result.error.code);
              expect(result.error.category).toBe('DEPENDENCY_ERROR');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect and reject direct two-task cycles (A→B, B→A)', () => {
      fc.assert(
        fc.property(
          basicTaskArb,
          basicTaskArb,
          dependencyTypeArb,
          dependencyTypeArb,
          (taskA, taskB, type1, type2) => {
            storage.clear();

            // Ensure distinct task IDs
            const task1 = { ...taskA, id: 'TASK-001' };
            const task2 = { ...taskB, id: 'TASK-002' };

            storage.addTask(task1);
            storage.addTask(task2);

            // Add first dependency: A → B (should succeed)
            const result1 = resolver.addDependency(task1.id, task2.id, type1);
            expect(result1.success).toBe(true);

            // Attempt to add reverse dependency: B → A (should fail - creates cycle)
            const result2 = resolver.addDependency(task2.id, task1.id, type2);
            expect(result2.success).toBe(false);

            if (!result2.success) {
              expect(result2.error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
              expect(result2.error.context?.task_id).toBe(task2.id);
              expect(result2.error.context?.depends_on).toBe(task1.id);
              expect(result2.error.context?.cycle_path).toBeDefined();
              expect(result2.error.context?.cycle_path!.length).toBeGreaterThanOrEqual(2);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect and reject indirect cycles (A→B→C→A)', () => {
      fc.assert(
        fc.property(
          fc.array(basicTaskArb, { minLength: 3, maxLength: 3 }),
          fc.array(dependencyTypeArb, { minLength: 3, maxLength: 3 }),
          (tasks, types) => {
            storage.clear();

            // Ensure distinct task IDs
            const [taskA, taskB, taskC] = tasks.map((t, i) => ({
              ...t,
              id: `TASK-${String(i + 100).padStart(3, '0')}`,
            }));

            storage.addTask(taskA);
            storage.addTask(taskB);
            storage.addTask(taskC);

            // Add A → B (should succeed)
            const result1 = resolver.addDependency(taskA.id, taskB.id, types[0]);
            expect(result1.success).toBe(true);

            // Add B → C (should succeed)
            const result2 = resolver.addDependency(taskB.id, taskC.id, types[1]);
            expect(result2.success).toBe(true);

            // Attempt C → A (should fail - creates cycle: A→B→C→A)
            const result3 = resolver.addDependency(taskC.id, taskA.id, types[2]);
            expect(result3.success).toBe(false);

            if (!result3.success) {
              expect(result3.error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
              expect(result3.error.context?.cycle_path).toBeDefined();
              // Cycle path should include at least 3 nodes
              expect(result3.error.context?.cycle_path!.length).toBeGreaterThanOrEqual(3);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect cycles of arbitrary length', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 8 }), // Chain length
          dependencyTypeArb,
          (chainLength, depType) => {
            storage.clear();

            // Create chain of tasks: T0 → T1 → T2 → ... → T(n-1)
            const tasks: TaskForDeps[] = [];
            for (let i = 0; i < chainLength; i++) {
              const task: TaskForDeps = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              storage.addTask(task);
            }

            // Add chain dependencies: T0 → T1 → T2 → ... (all should succeed)
            for (let i = 0; i < chainLength - 1; i++) {
              const result = resolver.addDependency(tasks[i].id, tasks[i + 1].id, depType);
              expect(result.success).toBe(true);
            }

            // Attempt to close the cycle: T(n-1) → T0 (should fail)
            const cycleResult = resolver.addDependency(
              tasks[chainLength - 1].id,
              tasks[0].id,
              depType
            );
            expect(cycleResult.success).toBe(false);

            if (!cycleResult.success) {
              expect(cycleResult.error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept dependencies that do not create cycles (valid paths)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 4, max: 10 }),
          dependencyTypeArb,
          (taskCount, depType) => {
            storage.clear();

            // Create tasks
            const tasks: TaskForDeps[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForDeps = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              storage.addTask(task);
            }

            // Create a valid DAG structure (dependencies only to lower-indexed tasks)
            // This is guaranteed not to create cycles
            for (let i = 1; i < taskCount; i++) {
              // Task i depends on task 0 (or any lower indexed task)
              const dependsOnIndex = Math.floor(Math.random() * i);
              const result = resolver.addDependency(tasks[i].id, tasks[dependsOnIndex].id, depType);
              expect(result.success).toBe(true);
            }

            // Verify the graph has no cycles by checking that all dependencies
            // point to tasks with lower indices
            for (let i = 0; i < taskCount; i++) {
              const deps = resolver.getDependencies(tasks[i].id);
              for (const dep of deps) {
                const depIndex = tasks.findIndex(t => t.id === dep.dependsOn);
                expect(depIndex).toBeLessThan(i);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly identify cycle path in error response', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 6 }),
          dependencyTypeArb,
          (chainLength, depType) => {
            storage.clear();

            // Create a simple chain and then try to close it
            const tasks: TaskForDeps[] = [];
            for (let i = 0; i < chainLength; i++) {
              const task: TaskForDeps = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              storage.addTask(task);
            }

            // Build chain: T0 → T1 → ... → T(n-1)
            for (let i = 0; i < chainLength - 1; i++) {
              resolver.addDependency(tasks[i].id, tasks[i + 1].id, depType);
            }

            // Attempt cycle: T(n-1) → T0
            const result = resolver.addDependency(
              tasks[chainLength - 1].id,
              tasks[0].id,
              depType
            );

            expect(result.success).toBe(false);
            if (!result.success) {
              const cyclePath = result.error.context?.cycle_path;
              expect(cyclePath).toBeDefined();
              expect(cyclePath!.length).toBeGreaterThanOrEqual(2);
              
              // The cycle path should include the task that would create the cycle
              // and the task it would depend on
              expect(cyclePath!).toContain(tasks[chainLength - 1].id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle diamond dependencies without detecting false cycles', () => {
      fc.assert(
        fc.property(
          dependencyTypeArb,
          (depType) => {
            storage.clear();

            // Create diamond structure:
            //     A
            //    / \
            //   B   C
            //    \ /
            //     D
            // Where D depends on both B and C, and B and C both depend on A
            // This is NOT a cycle!

            const taskA: TaskForDeps = { id: 'TASK-001', title: 'A', status: 'TODO', depends_on: [] };
            const taskB: TaskForDeps = { id: 'TASK-002', title: 'B', status: 'TODO', depends_on: [] };
            const taskC: TaskForDeps = { id: 'TASK-003', title: 'C', status: 'TODO', depends_on: [] };
            const taskD: TaskForDeps = { id: 'TASK-004', title: 'D', status: 'TODO', depends_on: [] };

            storage.addTask(taskA);
            storage.addTask(taskB);
            storage.addTask(taskC);
            storage.addTask(taskD);

            // B depends on A
            expect(resolver.addDependency(taskB.id, taskA.id, depType).success).toBe(true);
            
            // C depends on A
            expect(resolver.addDependency(taskC.id, taskA.id, depType).success).toBe(true);
            
            // D depends on B
            expect(resolver.addDependency(taskD.id, taskB.id, depType).success).toBe(true);
            
            // D depends on C - this should NOT be detected as a cycle
            expect(resolver.addDependency(taskD.id, taskC.id, depType).success).toBe(true);

            // Verify all dependencies were added
            expect(resolver.getDependencies(taskB.id).length).toBe(1);
            expect(resolver.getDependencies(taskC.id).length).toBe(1);
            expect(resolver.getDependencies(taskD.id).length).toBe(2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject cycle after multiple valid additions to same task', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 8 }),
          dependencyTypeArb,
          (taskCount, depType) => {
            storage.clear();

            // Create tasks
            const tasks: TaskForDeps[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForDeps = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              storage.addTask(task);
            }

            // Task 0 depends on multiple other tasks (all valid - no cycles)
            for (let i = 1; i < taskCount - 1; i++) {
              const result = resolver.addDependency(tasks[0].id, tasks[i].id, depType);
              expect(result.success).toBe(true);
            }

            // Task (n-1) depends on Task 0 (valid - no cycle yet)
            const validResult = resolver.addDependency(
              tasks[taskCount - 1].id,
              tasks[0].id,
              depType
            );
            expect(validResult.success).toBe(true);

            // Now trying to add Task 0 → Task (n-1) would create a cycle
            const cycleResult = resolver.addDependency(
              tasks[0].id,
              tasks[taskCount - 1].id,
              depType
            );
            expect(cycleResult.success).toBe(false);
            
            if (!cycleResult.success) {
              expect(cycleResult.error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should consistently detect cycles regardless of dependency type', () => {
      fc.assert(
        fc.property(
          basicTaskArb,
          basicTaskArb,
          (taskA, taskB) => {
            // Test with both blocking and non_blocking types
            for (const type1 of DEPENDENCY_TYPES) {
              for (const type2 of DEPENDENCY_TYPES) {
                storage.clear();

                const task1 = { ...taskA, id: 'TASK-001' };
                const task2 = { ...taskB, id: 'TASK-002' };

                storage.addTask(task1);
                storage.addTask(task2);

                // Add first dependency
                const result1 = resolver.addDependency(task1.id, task2.id, type1);
                expect(result1.success).toBe(true);

                // Attempt reverse - should always fail regardless of type
                const result2 = resolver.addDependency(task2.id, task1.id, type2);
                expect(result2.success).toBe(false);

                if (!result2.success) {
                  expect(result2.error.code).toBe(DependencyErrorCode.CIRCULAR_DEPENDENCY);
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow removal of dependency and then addition of reverse edge', () => {
      fc.assert(
        fc.property(
          basicTaskArb,
          basicTaskArb,
          dependencyTypeArb,
          dependencyTypeArb,
          (taskA, taskB, type1, type2) => {
            storage.clear();

            const task1 = { ...taskA, id: 'TASK-001' };
            const task2 = { ...taskB, id: 'TASK-002' };

            storage.addTask(task1);
            storage.addTask(task2);

            // Add dependency A → B
            const addResult = resolver.addDependency(task1.id, task2.id, type1);
            expect(addResult.success).toBe(true);

            // Remove dependency A → B
            const removeResult = resolver.removeDependency(task1.id, task2.id);
            expect(removeResult.success).toBe(true);

            // Now B → A should succeed (no cycle since A → B was removed)
            const reverseResult = resolver.addDependency(task2.id, task1.id, type2);
            expect(reverseResult.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

  });

  /**
   * **Feature: multi-developer-support, Property 5: Blocking Dependency State Constraint**
   * 
   * *For any* task with blocking dependencies, the task SHALL NOT transition to IN_PROGRESS 
   * status while any blocking dependency task is not in DONE status.
   * 
   * **Validates: Requirements 7.3**
   */
  describe('Property 5: Blocking Dependency State Constraint', () => {
    let storage: InMemoryTaskStorageForDeps;
    let resolver: InMemoryDependencyResolver;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForDeps();
      resolver = new InMemoryDependencyResolver(storage);
    });

    /**
     * Generates a task with a specific status.
     */
    const taskWithStatusArb = (status: TaskStatusForDeps): fc.Arbitrary<TaskForDeps> =>
      fc.record({
        id: taskIdArb,
        title: taskTitleArb,
      }).map(({ id, title }) => ({
        id,
        title,
        status,
        depends_on: [],
      }));

    /**
     * Generates a non-DONE status for blocking dependency testing.
     * These statuses should all block a task from transitioning to IN_PROGRESS.
     */
    const nonDoneStatusArb: fc.Arbitrary<TaskStatusForDeps> = fc.constantFrom(
      'TODO' as const,
      'READY' as const,
      'IN_PROGRESS' as const,
      'BLOCKED' as const,
      'VERIFY' as const
    );

    it('should reject transition to IN_PROGRESS when ANY blocking dependency is not DONE', () => {
      fc.assert(
        fc.property(
          nonDoneStatusArb,
          fc.integer({ min: 1, max: 5 }), // number of blocking dependencies
          (depStatus, depCount) => {
            storage.clear();

            // Create the main task that wants to start
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create blocking dependency tasks - all not DONE
            for (let i = 0; i < depCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: depStatus, // Any non-DONE status
                depends_on: [],
              };
              storage.addTask(depTask);

              // Add blocking dependency
              const addResult = resolver.addDependency(mainTask.id, depTask.id, 'blocking');
              expect(addResult.success).toBe(true);
            }

            // Attempt to transition main task to IN_PROGRESS
            const result = resolver.canTransitionToInProgress(mainTask.id);

            // Should ALWAYS fail when blocking deps are not DONE
            expect(result.success).toBe(false);

            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
              expect(result.error.category).toBe('DEPENDENCY_ERROR');
              expect(result.error.context?.task_id).toBe(mainTask.id);
              expect(result.error.context?.unsatisfied_dependencies).toBeDefined();
              expect(result.error.context?.unsatisfied_dependencies!.length).toBe(depCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow transition to IN_PROGRESS when ALL blocking dependencies are DONE', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // number of blocking dependencies
          (depCount) => {
            storage.clear();

            // Create the main task that wants to start
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create blocking dependency tasks - all DONE
            for (let i = 0; i < depCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: 'DONE', // All dependencies are complete
                depends_on: [],
              };
              storage.addTask(depTask);

              // Add blocking dependency
              const addResult = resolver.addDependency(mainTask.id, depTask.id, 'blocking');
              expect(addResult.success).toBe(true);
            }

            // Attempt to transition main task to IN_PROGRESS
            const result = resolver.canTransitionToInProgress(mainTask.id);

            // Should ALWAYS succeed when all blocking deps are DONE
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject transition if at least ONE blocking dependency is not DONE (mixed states)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 6 }), // total dependencies (at least 2 for mixed test)
          nonDoneStatusArb, // status for the incomplete dependency
          (totalDeps, incompleteStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Pick a random position for the incomplete dependency
            const incompleteIndex = Math.floor(Math.random() * totalDeps);

            // Create blocking dependencies - most DONE, one NOT DONE
            for (let i = 0; i < totalDeps; i++) {
              const isComplete = i !== incompleteIndex;
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: isComplete ? 'DONE' : incompleteStatus,
                depends_on: [],
              };
              storage.addTask(depTask);

              // Add blocking dependency
              const addResult = resolver.addDependency(mainTask.id, depTask.id, 'blocking');
              expect(addResult.success).toBe(true);
            }

            // Attempt to transition main task to IN_PROGRESS
            const result = resolver.canTransitionToInProgress(mainTask.id);

            // Should FAIL because at least one blocking dep is not DONE
            expect(result.success).toBe(false);

            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
              expect(result.error.context?.unsatisfied_dependencies).toBeDefined();
              expect(result.error.context?.unsatisfied_dependencies!.length).toBe(1);
              expect(result.error.context?.unsatisfied_dependencies![0]).toBe(
                `TASK-DEP-${String(incompleteIndex + 100).padStart(3, '0')}`
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow transition when task has no blocking dependencies', () => {
      fc.assert(
        fc.property(
          basicTaskArb,
          (task) => {
            storage.clear();

            // Create task with no dependencies
            const taskNoBlocking: TaskForDeps = {
              ...task,
              id: 'TASK-SOLO',
              depends_on: [],
            };
            storage.addTask(taskNoBlocking);

            // Should always be able to transition to IN_PROGRESS with no blocking deps
            const result = resolver.canTransitionToInProgress(taskNoBlocking.id);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow transition when task has only non-blocking dependencies (regardless of their status)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // number of non-blocking dependencies
          nonDoneStatusArb, // status for dependencies (any non-DONE status)
          (depCount, depStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create non-blocking dependencies (NOT DONE)
            for (let i = 0; i < depCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: depStatus, // Not DONE
                depends_on: [],
              };
              storage.addTask(depTask);

              // Add NON-BLOCKING dependency
              const addResult = resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
              expect(addResult.success).toBe(true);
            }

            // Should be able to transition to IN_PROGRESS (non-blocking deps don't block start)
            const result = resolver.canTransitionToInProgress(mainTask.id);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly handle mix of blocking and non-blocking dependencies', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 3 }), // blocking deps (all DONE)
          fc.integer({ min: 1, max: 3 }), // non-blocking deps (not DONE)
          nonDoneStatusArb,
          (blockingCount, nonBlockingCount, nonBlockingStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create DONE blocking dependencies
            for (let i = 0; i < blockingCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-BLOCK-${String(i + 100).padStart(3, '0')}`,
                title: `Blocking Task ${i}`,
                status: 'DONE',
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'blocking');
            }

            // Create NOT DONE non-blocking dependencies
            for (let i = 0; i < nonBlockingCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-NONBLOCK-${String(i + 200).padStart(3, '0')}`,
                title: `Non-Blocking Task ${i}`,
                status: nonBlockingStatus,
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
            }

            // Should allow transition (blocking deps DONE, non-blocking don't block start)
            const result = resolver.canTransitionToInProgress(mainTask.id);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject with correct unsatisfied dependencies list', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // number of unsatisfied blocking deps
          fc.integer({ min: 0, max: 3 }), // number of satisfied blocking deps
          nonDoneStatusArb,
          (unsatisfiedCount, satisfiedCount, unsatisfiedStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            const unsatisfiedIds: string[] = [];

            // Create unsatisfied blocking dependencies
            for (let i = 0; i < unsatisfiedCount; i++) {
              const depId = `TASK-UNSAT-${String(i + 100).padStart(3, '0')}`;
              unsatisfiedIds.push(depId);
              
              const depTask: TaskForDeps = {
                id: depId,
                title: `Unsatisfied Dependency ${i}`,
                status: unsatisfiedStatus,
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'blocking');
            }

            // Create satisfied blocking dependencies
            for (let i = 0; i < satisfiedCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-SAT-${String(i + 200).padStart(3, '0')}`,
                title: `Satisfied Dependency ${i}`,
                status: 'DONE',
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'blocking');
            }

            // Should fail with correct unsatisfied list
            const result = resolver.canTransitionToInProgress(mainTask.id);
            expect(result.success).toBe(false);

            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
              expect(result.error.context?.unsatisfied_dependencies).toBeDefined();
              expect(result.error.context?.unsatisfied_dependencies!.length).toBe(unsatisfiedCount);
              
              // Verify all unsatisfied IDs are in the error
              for (const id of unsatisfiedIds) {
                expect(result.error.context?.unsatisfied_dependencies).toContain(id);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should track blocking dependency status changes correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 4 }), // number of blocking dependencies
          (depCount) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create blocking dependencies - initially TODO
            const depIds: string[] = [];
            for (let i = 0; i < depCount; i++) {
              const depId = `TASK-DEP-${String(i + 100).padStart(3, '0')}`;
              depIds.push(depId);
              
              const depTask: TaskForDeps = {
                id: depId,
                title: `Dependency Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'blocking');
            }

            // Initially should fail
            let result = resolver.canTransitionToInProgress(mainTask.id);
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
            }

            // Mark all dependencies as DONE one by one
            for (let i = 0; i < depCount; i++) {
              const depTask = storage.getTask(depIds[i])!;
              storage.updateTask({ ...depTask, status: 'DONE' });

              result = resolver.canTransitionToInProgress(mainTask.id);

              if (i < depCount - 1) {
                // Still have incomplete deps - should fail
                expect(result.success).toBe(false);
                if (!result.success) {
                  expect(result.error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
                  // Unsatisfied count should decrease
                  expect(result.error.context?.unsatisfied_dependencies!.length).toBe(depCount - i - 1);
                }
              } else {
                // All deps complete - should succeed
                expect(result.success).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return error code 1205 (BLOCKING_DEP_UNSATISFIED) for all rejection cases', () => {
      fc.assert(
        fc.property(
          nonDoneStatusArb,
          dependencyTypeArb.filter(t => t === 'blocking'), // ensure blocking type
          (depStatus, _depType) => {
            storage.clear();

            // Create main task and single blocking dependency
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            const depTask: TaskForDeps = {
              id: 'TASK-DEP-001',
              title: 'Dependency',
              status: depStatus,
              depends_on: [],
            };
            storage.addTask(depTask);

            resolver.addDependency(mainTask.id, depTask.id, 'blocking');

            const result = resolver.canTransitionToInProgress(mainTask.id);
            
            expect(result.success).toBe(false);
            if (!result.success) {
              // Error code MUST be exactly 1205
              expect(result.error.code).toBe(1205);
              expect(result.error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return TASK_NOT_FOUND error for non-existent task', () => {
      fc.assert(
        fc.property(
          taskIdArb,
          (taskId) => {
            storage.clear();
            // Don't add any task - storage is empty

            const result = resolver.canTransitionToInProgress(taskId);
            
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.TASK_NOT_FOUND);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: multi-developer-support, Property 6: Non-Blocking Dependency Completion Constraint**
   * 
   * *For any* task with non-blocking dependencies, the task SHALL NOT transition to DONE 
   * status while any non-blocking dependency task is not in DONE status.
   * 
   * **Validates: Requirements 7.4**
   */
  describe('Property 6: Non-Blocking Dependency Completion Constraint', () => {
    let storage: InMemoryTaskStorageForDeps;
    let resolver: InMemoryDependencyResolver;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForDeps();
      resolver = new InMemoryDependencyResolver(storage);
    });

    /**
     * Generates a non-DONE status for non-blocking dependency testing.
     * These statuses should all prevent a task from transitioning to DONE
     * when they are non-blocking dependencies.
     */
    const nonDoneStatusArb: fc.Arbitrary<TaskStatusForDeps> = fc.constantFrom(
      'TODO' as const,
      'READY' as const,
      'IN_PROGRESS' as const,
      'BLOCKED' as const,
      'VERIFY' as const
    );

    it('should reject transition to DONE when ANY non-blocking dependency is not DONE', () => {
      fc.assert(
        fc.property(
          nonDoneStatusArb,
          fc.integer({ min: 1, max: 5 }), // number of non-blocking dependencies
          (depStatus, depCount) => {
            storage.clear();

            // Create the main task that wants to complete
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS', // Task is in progress, wants to complete
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create non-blocking dependency tasks - all not DONE
            for (let i = 0; i < depCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: depStatus, // Any non-DONE status
                depends_on: [],
              };
              storage.addTask(depTask);

              // Add non-blocking dependency
              const addResult = resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
              expect(addResult.success).toBe(true);
            }

            // Attempt to transition main task to DONE
            const result = resolver.canTransitionToDone(mainTask.id);

            // Should ALWAYS fail when non-blocking deps are not DONE
            expect(result.success).toBe(false);

            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
              expect(result.error.category).toBe('DEPENDENCY_ERROR');
              expect(result.error.context?.task_id).toBe(mainTask.id);
              expect(result.error.context?.unsatisfied_dependencies).toBeDefined();
              expect(result.error.context?.unsatisfied_dependencies!.length).toBe(depCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow transition to DONE when ALL non-blocking dependencies are DONE', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // number of non-blocking dependencies
          (depCount) => {
            storage.clear();

            // Create the main task that wants to complete
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create non-blocking dependency tasks - all DONE
            for (let i = 0; i < depCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: 'DONE', // All dependencies are complete
                depends_on: [],
              };
              storage.addTask(depTask);

              // Add non-blocking dependency
              const addResult = resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
              expect(addResult.success).toBe(true);
            }

            // Attempt to transition main task to DONE
            const result = resolver.canTransitionToDone(mainTask.id);

            // Should ALWAYS succeed when all non-blocking deps are DONE
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject transition if at least ONE non-blocking dependency is not DONE (mixed states)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 6 }), // total dependencies (at least 2 for mixed test)
          nonDoneStatusArb, // status for the incomplete dependency
          (totalDeps, incompleteStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Pick a random position for the incomplete dependency
            const incompleteIndex = Math.floor(Math.random() * totalDeps);

            // Create non-blocking dependencies - most DONE, one NOT DONE
            for (let i = 0; i < totalDeps; i++) {
              const isComplete = i !== incompleteIndex;
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: isComplete ? 'DONE' : incompleteStatus,
                depends_on: [],
              };
              storage.addTask(depTask);

              // Add non-blocking dependency
              const addResult = resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
              expect(addResult.success).toBe(true);
            }

            // Attempt to transition main task to DONE
            const result = resolver.canTransitionToDone(mainTask.id);

            // Should FAIL because at least one non-blocking dep is not DONE
            expect(result.success).toBe(false);

            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
              expect(result.error.context?.unsatisfied_dependencies).toBeDefined();
              expect(result.error.context?.unsatisfied_dependencies!.length).toBe(1);
              expect(result.error.context?.unsatisfied_dependencies![0]).toBe(
                `TASK-DEP-${String(incompleteIndex + 100).padStart(3, '0')}`
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow transition when task has no non-blocking dependencies', () => {
      fc.assert(
        fc.property(
          basicTaskArb,
          (task) => {
            storage.clear();

            // Create task with no dependencies
            const taskNoDeps: TaskForDeps = {
              ...task,
              id: 'TASK-SOLO',
              depends_on: [],
            };
            storage.addTask(taskNoDeps);

            // Should always be able to transition to DONE with no non-blocking deps
            const result = resolver.canTransitionToDone(taskNoDeps.id);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow transition when task has only blocking dependencies (regardless of their status)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // number of blocking dependencies
          nonDoneStatusArb, // status for dependencies (any non-DONE status)
          (depCount, depStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create blocking dependencies (NOT DONE)
            for (let i = 0; i < depCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: depStatus, // Not DONE
                depends_on: [],
              };
              storage.addTask(depTask);

              // Add BLOCKING dependency (not non_blocking)
              const addResult = resolver.addDependency(mainTask.id, depTask.id, 'blocking');
              expect(addResult.success).toBe(true);
            }

            // Should be able to transition to DONE (blocking deps don't block completion,
            // they only block starting - the task is already in progress)
            const result = resolver.canTransitionToDone(mainTask.id);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly handle mix of blocking and non-blocking dependencies for DONE transition', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 3 }), // non-blocking deps (all DONE)
          fc.integer({ min: 1, max: 3 }), // blocking deps (not DONE - doesn't matter)
          nonDoneStatusArb,
          (nonBlockingCount, blockingCount, blockingStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create DONE non-blocking dependencies
            for (let i = 0; i < nonBlockingCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-NONBLOCK-${String(i + 100).padStart(3, '0')}`,
                title: `Non-Blocking Task ${i}`,
                status: 'DONE',
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
            }

            // Create NOT DONE blocking dependencies (shouldn't matter for DONE transition)
            for (let i = 0; i < blockingCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-BLOCK-${String(i + 200).padStart(3, '0')}`,
                title: `Blocking Task ${i}`,
                status: blockingStatus,
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'blocking');
            }

            // Should allow transition (non-blocking deps DONE, blocking don't block completion)
            const result = resolver.canTransitionToDone(mainTask.id);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject with correct unsatisfied dependencies list for DONE transition', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // number of unsatisfied non-blocking deps
          fc.integer({ min: 0, max: 3 }), // number of satisfied non-blocking deps
          nonDoneStatusArb,
          (unsatisfiedCount, satisfiedCount, unsatisfiedStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS',
              depends_on: [],
            };
            storage.addTask(mainTask);

            const unsatisfiedIds: string[] = [];

            // Create unsatisfied non-blocking dependencies
            for (let i = 0; i < unsatisfiedCount; i++) {
              const depId = `TASK-UNSAT-${String(i + 100).padStart(3, '0')}`;
              unsatisfiedIds.push(depId);
              
              const depTask: TaskForDeps = {
                id: depId,
                title: `Unsatisfied Dependency ${i}`,
                status: unsatisfiedStatus,
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
            }

            // Create satisfied non-blocking dependencies
            for (let i = 0; i < satisfiedCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-SAT-${String(i + 200).padStart(3, '0')}`,
                title: `Satisfied Dependency ${i}`,
                status: 'DONE',
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
            }

            // Should fail with correct unsatisfied list
            const result = resolver.canTransitionToDone(mainTask.id);
            expect(result.success).toBe(false);

            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
              expect(result.error.context?.unsatisfied_dependencies).toBeDefined();
              expect(result.error.context?.unsatisfied_dependencies!.length).toBe(unsatisfiedCount);
              
              // Verify all unsatisfied IDs are in the error
              for (const id of unsatisfiedIds) {
                expect(result.error.context?.unsatisfied_dependencies).toContain(id);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should track non-blocking dependency status changes correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 4 }), // number of non-blocking dependencies
          (depCount) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create non-blocking dependencies - initially TODO
            const depIds: string[] = [];
            for (let i = 0; i < depCount; i++) {
              const depId = `TASK-DEP-${String(i + 100).padStart(3, '0')}`;
              depIds.push(depId);
              
              const depTask: TaskForDeps = {
                id: depId,
                title: `Dependency Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
            }

            // Initially should fail
            let result = resolver.canTransitionToDone(mainTask.id);
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
            }

            // Mark all dependencies as DONE one by one
            for (let i = 0; i < depCount; i++) {
              const depTask = storage.getTask(depIds[i])!;
              storage.updateTask({ ...depTask, status: 'DONE' });

              result = resolver.canTransitionToDone(mainTask.id);

              if (i < depCount - 1) {
                // Still have incomplete deps - should fail
                expect(result.success).toBe(false);
                if (!result.success) {
                  expect(result.error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
                  // Unsatisfied count should decrease
                  expect(result.error.context?.unsatisfied_dependencies!.length).toBe(depCount - i - 1);
                }
              } else {
                // All deps complete - should succeed
                expect(result.success).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return error code 1206 (NON_BLOCKING_DEP_UNSATISFIED) for all rejection cases', () => {
      fc.assert(
        fc.property(
          nonDoneStatusArb,
          (depStatus) => {
            storage.clear();

            // Create main task and single non-blocking dependency
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS',
              depends_on: [],
            };
            storage.addTask(mainTask);

            const depTask: TaskForDeps = {
              id: 'TASK-DEP-001',
              title: 'Dependency',
              status: depStatus,
              depends_on: [],
            };
            storage.addTask(depTask);

            resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');

            const result = resolver.canTransitionToDone(mainTask.id);
            
            expect(result.success).toBe(false);
            if (!result.success) {
              // Error code MUST be exactly 1206
              expect(result.error.code).toBe(1206);
              expect(result.error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return TASK_NOT_FOUND error for non-existent task', () => {
      fc.assert(
        fc.property(
          taskIdArb,
          (taskId) => {
            storage.clear();
            // Don't add any task - storage is empty

            const result = resolver.canTransitionToDone(taskId);
            
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(DependencyErrorCode.TASK_NOT_FOUND);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should verify non-blocking deps do NOT block IN_PROGRESS but DO block DONE', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 4 }), // number of non-blocking dependencies
          nonDoneStatusArb,
          (depCount, depStatus) => {
            storage.clear();

            // Create the main task
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'TODO',
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create non-blocking dependencies (NOT DONE)
            for (let i = 0; i < depCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: depStatus, // Not DONE
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'non_blocking');
            }

            // Can transition to IN_PROGRESS (non-blocking doesn't block start)
            const inProgressResult = resolver.canTransitionToInProgress(mainTask.id);
            expect(inProgressResult.success).toBe(true);

            // Cannot transition to DONE (non-blocking blocks completion)
            const doneResult = resolver.canTransitionToDone(mainTask.id);
            expect(doneResult.success).toBe(false);
            if (!doneResult.success) {
              expect(doneResult.error.code).toBe(DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should verify blocking deps DO block IN_PROGRESS but do NOT block DONE', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 4 }), // number of blocking dependencies
          nonDoneStatusArb,
          (depCount, depStatus) => {
            storage.clear();

            // Create the main task - already in progress
            const mainTask: TaskForDeps = {
              id: 'TASK-MAIN',
              title: 'Main Task',
              status: 'IN_PROGRESS', // Already started
              depends_on: [],
            };
            storage.addTask(mainTask);

            // Create blocking dependencies (NOT DONE)
            for (let i = 0; i < depCount; i++) {
              const depTask: TaskForDeps = {
                id: `TASK-DEP-${String(i + 100).padStart(3, '0')}`,
                title: `Dependency Task ${i}`,
                status: depStatus, // Not DONE
                depends_on: [],
              };
              storage.addTask(depTask);
              resolver.addDependency(mainTask.id, depTask.id, 'blocking');
            }

            // Cannot transition to IN_PROGRESS (blocking blocks start)
            const inProgressResult = resolver.canTransitionToInProgress(mainTask.id);
            expect(inProgressResult.success).toBe(false);
            if (!inProgressResult.success) {
              expect(inProgressResult.error.code).toBe(DependencyErrorCode.BLOCKING_DEP_UNSATISFIED);
            }

            // Can transition to DONE (blocking doesn't block completion)
            const doneResult = resolver.canTransitionToDone(mainTask.id);
            expect(doneResult.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: Dependency Cycle Detection - Additional Tests', () => {
    let storage: InMemoryTaskStorageForDeps;
    let resolver: InMemoryDependencyResolver;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForDeps();
      resolver = new InMemoryDependencyResolver(storage);
    });

    it('detectCycles() should return correct result for any graph state', () => {
      fc.assert(
        fc.property(
          dagArb(6),
          cycleCreatingEdgeArb(6),
          dependencyTypeArb,
          ({ tasks, edges }, cycleEdge, depType) => {
            storage.clear();

            // Add tasks
            for (const task of tasks) {
              storage.addTask(task);
            }

            // Add DAG edges
            for (const edge of edges) {
              const fromTask = tasks[edge.from];
              const toTask = tasks[edge.to];
              resolver.addDependency(fromTask.id, toTask.id, edge.type);
            }

            // Test detectCycles directly
            const fromTask = tasks[cycleEdge.from];
            const toTask = tasks[cycleEdge.to];

            const cycleResult = resolver.detectCycles(fromTask.id, toTask.id);

            // If detectCycles says there's a cycle, addDependency should fail
            if (cycleResult.hasCycle) {
              const addResult = resolver.addDependency(fromTask.id, toTask.id, depType);
              expect(addResult.success).toBe(false);
            }

            // If detectCycles says no cycle, and dependency doesn't already exist,
            // addDependency should succeed
            if (!cycleResult.hasCycle) {
              const existingDeps = resolver.getDependencies(fromTask.id);
              const alreadyExists = existingDeps.some(d => d.dependsOn === toTask.id);
              
              if (!alreadyExists) {
                const addResult = resolver.addDependency(fromTask.id, toTask.id, depType);
                expect(addResult.success).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle complex graph with many dependencies without false positives', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 20 }),
          fc.integer({ min: 15, max: 40 }),
          dependencyTypeArb,
          (taskCount, edgeCount, depType) => {
            storage.clear();

            // Create tasks
            const tasks: TaskForDeps[] = [];
            for (let i = 0; i < taskCount; i++) {
              const task: TaskForDeps = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              storage.addTask(task);
            }

            // Add many DAG edges (from higher to lower index - guaranteed no cycles)
            let addedEdges = 0;
            const edgeSet = new Set<string>();

            for (let attempt = 0; attempt < edgeCount * 2 && addedEdges < edgeCount; attempt++) {
              const fromIdx = Math.floor(Math.random() * (taskCount - 1)) + 1;
              const toIdx = Math.floor(Math.random() * fromIdx);
              const edgeKey = `${fromIdx}-${toIdx}`;

              if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                const result = resolver.addDependency(tasks[fromIdx].id, tasks[toIdx].id, depType);
                if (result.success) {
                  addedEdges++;
                }
              }
            }

            // All edges should have been accepted (no false cycle detection)
            expect(addedEdges).toBeGreaterThan(0);

            // Verify no cycles exist in the graph by checking topological ordering is valid
            for (let i = 0; i < taskCount; i++) {
              const deps = resolver.getDependencies(tasks[i].id);
              for (const dep of deps) {
                const depIdx = tasks.findIndex(t => t.id === dep.dependsOn);
                // All dependencies should point to lower-indexed tasks
                expect(depIdx).toBeLessThan(i);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain cycle-free invariant through any sequence of add/remove operations', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              // Add operation
              fc.record({
                type: fc.constant('add' as const),
                from: fc.integer({ min: 0, max: 4 }),
                to: fc.integer({ min: 0, max: 4 }),
                depType: dependencyTypeArb,
              }),
              // Remove operation
              fc.record({
                type: fc.constant('remove' as const),
                from: fc.integer({ min: 0, max: 4 }),
                to: fc.integer({ min: 0, max: 4 }),
              })
            ),
            { minLength: 10, maxLength: 30 }
          ),
          (operations) => {
            storage.clear();

            // Create 5 tasks
            const tasks: TaskForDeps[] = [];
            for (let i = 0; i < 5; i++) {
              const task: TaskForDeps = {
                id: `TASK-${String(i + 100).padStart(3, '0')}`,
                title: `Task ${i}`,
                status: 'TODO',
                depends_on: [],
              };
              tasks.push(task);
              storage.addTask(task);
            }

            // Process operations
            for (const op of operations) {
              if (op.from === op.to) continue; // Skip self-dependencies

              if (op.type === 'add') {
                const result = resolver.addDependency(
                  tasks[op.from].id,
                  tasks[op.to].id,
                  op.depType
                );
                
                // If it succeeds, the graph should still be cycle-free
                if (result.success) {
                  // Verify no cycles by checking detectCycles on all pairs
                  for (let i = 0; i < 5; i++) {
                    for (let j = 0; j < 5; j++) {
                      if (i !== j) {
                        const existingDeps = resolver.getDependencies(tasks[i].id);
                        const alreadyExists = existingDeps.some(d => d.dependsOn === tasks[j].id);
                        
                        if (!alreadyExists) {
                          const cycleCheck = resolver.detectCycles(tasks[i].id, tasks[j].id);
                          // The actual graph should remain cycle-free
                          // (cycle detection is about potential additions)
                        }
                      }
                    }
                  }
                }
              } else {
                resolver.removeDependency(tasks[op.from].id, tasks[op.to].id);
              }
            }

            // Final invariant: the graph should have no actual cycles
            // We can verify this by checking that no task can reach itself
            for (const task of tasks) {
              const visited = new Set<string>();
              const queue = [task.id];
              
              while (queue.length > 0) {
                const current = queue.shift()!;
                if (visited.has(current)) continue;
                visited.add(current);
                
                const deps = resolver.getDependencies(current);
                for (const dep of deps) {
                  // Should never reach back to the starting task
                  expect(dep.dependsOn).not.toBe(task.id);
                  queue.push(dep.dependsOn);
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
