/**
 * Integration Tests: Dependency-Aware TDD Flow
 * 
 * These integration tests verify the interaction between Dependency_Resolver
 * and task state transitions in TDD workflows. The tests cover:
 * 
 * 1. Task chain with blocking dependencies
 * 2. Blocked task state transition prevention
 * 3. Dependency completion enabling blocked tasks
 * 4. Non-blocking dependencies allowing start but preventing completion
 * 5. Circular dependency detection and rejection
 * 6. TDD phase transitions with dependency awareness
 * 
 * **Validates: Requirements 7.3, 7.4, 15.2**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DependencyType,
  DependencyErrorCode,
  TaskForDeps,
  TaskStatusForDeps,
  InMemoryTaskStorageForDeps,
  DependencyResolverImpl,
} from '../../dependency-resolver';

// =============================================================================
// TDD Phase Definitions (Mock)
// =============================================================================

/**
 * TDD phases as defined in the SDLC workflow
 */
type TDDPhase = 'RED' | 'GREEN' | 'REFACTOR' | 'VERIFY' | 'COMPLETE';

/**
 * Extended task type with TDD phase information for integration testing
 */
interface TaskWithTDD extends TaskForDeps {
  tdd_phase?: TDDPhase;
  tdd_phase_started_at?: string;
}

/**
 * Task state manager that integrates with Dependency_Resolver
 * for dependency-aware state transitions.
 * 
 * This mock implementation simulates the TDD workflow coordination
 * as specified in Requirements 15.2.
 */
class TDDTaskStateManager {
  private taskStorage: InMemoryTaskStorageForDeps;
  private dependencyResolver: DependencyResolverImpl;
  private tddPhases: Map<string, TDDPhase> = new Map();

  constructor(
    taskStorage: InMemoryTaskStorageForDeps,
    dependencyResolver: DependencyResolverImpl
  ) {
    this.taskStorage = taskStorage;
    this.dependencyResolver = dependencyResolver;
  }

  /**
   * Creates a new task with optional TDD phase initialization
   */
  createTask(task: TaskWithTDD): void {
    this.taskStorage.addTask(task);
    if (task.tdd_phase) {
      this.tddPhases.set(task.id, task.tdd_phase);
    }
  }

  /**
   * Gets a task by ID
   */
  getTask(taskId: string): TaskWithTDD | null {
    const task = this.taskStorage.getTask(taskId);
    if (!task) return null;
    
    return {
      ...task,
      tdd_phase: this.tddPhases.get(taskId),
    } as TaskWithTDD;
  }

  /**
   * Attempts to transition a task to IN_PROGRESS status.
   * 
   * Requirements: 7.3 - Blocking dependencies must be DONE
   * 
   * @returns Object with success status and error message if failed
   */
  startTask(taskId: string): { success: boolean; error?: string } {
    const task = this.getTask(taskId);
    if (!task) {
      return { success: false, error: `Task '${taskId}' not found` };
    }

    // Check if task can transition based on dependencies
    const canStart = this.dependencyResolver.canTransitionToInProgress(taskId);
    if (!canStart.success) {
      return { 
        success: false, 
        error: canStart.error.message 
      };
    }

    // Update task status
    const updatedTask: TaskForDeps = {
      ...task,
      status: 'IN_PROGRESS',
    };
    this.taskStorage.updateTask(updatedTask);
    this.tddPhases.set(taskId, 'RED');

    return { success: true };
  }

  /**
   * Transitions a task's TDD phase to GREEN.
   * 
   * Requirements: 15.2 - Dependency_Resolver SHALL prevent GREEN phase
   * if blocking dependencies are unsatisfied.
   * 
   * @returns Object with success status and error message if failed
   */
  transitionToGreen(taskId: string): { success: boolean; error?: string } {
    const task = this.getTask(taskId);
    if (!task) {
      return { success: false, error: `Task '${taskId}' not found` };
    }

    if (task.status !== 'IN_PROGRESS') {
      return { success: false, error: `Task must be IN_PROGRESS to enter GREEN phase` };
    }

    // Verify blocking dependencies are satisfied before GREEN phase
    const canTransition = this.dependencyResolver.canTransitionToInProgress(taskId);
    if (!canTransition.success) {
      return { 
        success: false, 
        error: `Cannot enter GREEN phase: ${canTransition.error.message}` 
      };
    }

    this.tddPhases.set(taskId, 'GREEN');
    return { success: true };
  }

  /**
   * Transitions a task's TDD phase to REFACTOR.
   */
  transitionToRefactor(taskId: string): { success: boolean; error?: string } {
    const task = this.getTask(taskId);
    if (!task) {
      return { success: false, error: `Task '${taskId}' not found` };
    }

    if (this.tddPhases.get(taskId) !== 'GREEN') {
      return { success: false, error: `Task must be in GREEN phase to enter REFACTOR` };
    }

    this.tddPhases.set(taskId, 'REFACTOR');
    return { success: true };
  }

  /**
   * Attempts to complete a task (transition to DONE).
   * 
   * Requirements: 7.4 - Non-blocking dependencies must be DONE
   * 
   * @returns Object with success status and error message if failed
   */
  completeTask(taskId: string): { success: boolean; error?: string } {
    const task = this.getTask(taskId);
    if (!task) {
      return { success: false, error: `Task '${taskId}' not found` };
    }

    // Check if task can transition to DONE based on dependencies
    const canComplete = this.dependencyResolver.canTransitionToDone(taskId);
    if (!canComplete.success) {
      return { 
        success: false, 
        error: canComplete.error.message 
      };
    }

    // Update task status
    const updatedTask: TaskForDeps = {
      ...task,
      status: 'DONE',
    };
    this.taskStorage.updateTask(updatedTask);
    this.tddPhases.set(taskId, 'COMPLETE');

    return { success: true };
  }

  /**
   * Gets the TDD phase for a task
   */
  getTDDPhase(taskId: string): TDDPhase | undefined {
    return this.tddPhases.get(taskId);
  }

  /**
   * Adds a dependency between tasks
   */
  addDependency(
    taskId: string, 
    dependsOn: string, 
    type: DependencyType
  ): { success: boolean; error?: string } {
    const result = this.dependencyResolver.addDependency(taskId, dependsOn, type);
    if (!result.success) {
      return { success: false, error: result.error.message };
    }
    return { success: true };
  }

  /**
   * Gets blocking dependencies for a task
   */
  getBlockingDependencies(taskId: string) {
    return this.dependencyResolver.getBlockingDependencies(taskId);
  }

  /**
   * Gets all dependencies for a task
   */
  getDependencies(taskId: string) {
    return this.dependencyResolver.getDependencies(taskId);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates a test task with specified properties
 */
function createTestTask(
  id: string, 
  status: TaskStatusForDeps = 'TODO',
  role?: string
): TaskWithTDD {
  return {
    id,
    title: `Test Task ${id}`,
    status,
    role_required: role as any,
    depends_on: [],
  };
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration Tests: Dependency-Aware TDD Flow', () => {
  let taskStorage: InMemoryTaskStorageForDeps;
  let dependencyResolver: DependencyResolverImpl;
  let stateManager: TDDTaskStateManager;

  beforeEach(() => {
    taskStorage = new InMemoryTaskStorageForDeps();
    dependencyResolver = new DependencyResolverImpl({ taskStorage });
    stateManager = new TDDTaskStateManager(taskStorage, dependencyResolver);
  });

  // ===========================================================================
  // 1. Task Chain with Blocking Dependencies
  // Validates: Requirements 7.3
  // ===========================================================================
  describe('1. Task Chain with Blocking Dependencies', () => {
    it('should create a chain of tasks with blocking dependencies', () => {
      // Create task chain: TASK-A → TASK-B → TASK-C
      // (A blocks B, B blocks C)
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      // TASK-B depends on TASK-A (blocking)
      const result1 = stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');
      expect(result1.success).toBe(true);

      // TASK-C depends on TASK-B (blocking)
      const result2 = stateManager.addDependency('TASK-C', 'TASK-B', 'blocking');
      expect(result2.success).toBe(true);

      // Verify dependencies were registered
      const depsB = stateManager.getDependencies('TASK-B');
      expect(depsB.length).toBe(1);
      expect(depsB[0].dependsOn).toBe('TASK-A');
      expect(depsB[0].type).toBe('blocking');

      const depsC = stateManager.getDependencies('TASK-C');
      expect(depsC.length).toBe(1);
      expect(depsC[0].dependsOn).toBe('TASK-B');
      expect(depsC[0].type).toBe('blocking');
    });

    it('should allow starting the first task in a chain (no dependencies)', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');

      // TASK-A has no dependencies, should start
      const result = stateManager.startTask('TASK-A');
      expect(result.success).toBe(true);

      const task = stateManager.getTask('TASK-A');
      expect(task?.status).toBe('IN_PROGRESS');
      expect(stateManager.getTDDPhase('TASK-A')).toBe('RED');
    });

    it('should support multiple tasks depending on the same task', () => {
      // Fan-out pattern: A blocks both B and C
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-A', 'blocking');

      // Both B and C should be blocked
      const blockingB = stateManager.getBlockingDependencies('TASK-B');
      const blockingC = stateManager.getBlockingDependencies('TASK-C');

      expect(blockingB.length).toBe(1);
      expect(blockingC.length).toBe(1);
      expect(blockingB[0].dependsOn).toBe('TASK-A');
      expect(blockingC[0].dependsOn).toBe('TASK-A');
    });
  });

  // ===========================================================================
  // 2. Blocked Task Cannot Start (IN_PROGRESS)
  // Validates: Requirements 7.3
  // ===========================================================================
  describe('2. Blocked Task Cannot Start (IN_PROGRESS)', () => {
    it('should prevent task with unsatisfied blocking dependency from starting', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');

      // TASK-A is TODO (not DONE), so TASK-B should not start
      const result = stateManager.startTask('TASK-B');

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocking');
      expect(result.error).toContain('TASK-A');

      // Verify task status unchanged
      const task = stateManager.getTask('TASK-B');
      expect(task?.status).toBe('TODO');
    });

    it('should prevent task with multiple unsatisfied blocking dependencies', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));
      
      stateManager.addDependency('TASK-C', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-B', 'blocking');

      // Neither A nor B is DONE
      const result = stateManager.startTask('TASK-C');

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocking');
    });

    it('should prevent starting if ANY blocking dependency is unsatisfied', () => {
      stateManager.createTask(createTestTask('TASK-A', 'DONE'));
      stateManager.createTask(createTestTask('TASK-B')); // Still TODO
      stateManager.createTask(createTestTask('TASK-C'));

      stateManager.addDependency('TASK-C', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-B', 'blocking');

      // A is DONE, but B is not
      const result = stateManager.startTask('TASK-C');

      expect(result.success).toBe(false);
      expect(result.error).toContain('TASK-B');
    });

    it('should track blocking dependencies correctly across chain', () => {
      // Chain: A → B → C
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-B', 'blocking');

      // C cannot start because B is not DONE (regardless of A's status)
      const resultC = stateManager.startTask('TASK-C');
      expect(resultC.success).toBe(false);

      // B cannot start because A is not DONE
      const resultB = stateManager.startTask('TASK-B');
      expect(resultB.success).toBe(false);

      // Only A can start
      const resultA = stateManager.startTask('TASK-A');
      expect(resultA.success).toBe(true);
    });
  });

  // ===========================================================================
  // 3. Complete Dependency → Verify Blocked Task Becomes Ready
  // Validates: Requirements 7.3
  // ===========================================================================
  describe('3. Complete Dependency → Blocked Task Becomes Ready', () => {
    it('should allow blocked task to start after dependency is completed', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');

      // B cannot start initially
      expect(stateManager.startTask('TASK-B').success).toBe(false);

      // Start and complete A
      stateManager.startTask('TASK-A');
      stateManager.completeTask('TASK-A');

      // Verify A is DONE
      expect(stateManager.getTask('TASK-A')?.status).toBe('DONE');

      // Now B should be able to start
      const result = stateManager.startTask('TASK-B');
      expect(result.success).toBe(true);
      expect(stateManager.getTask('TASK-B')?.status).toBe('IN_PROGRESS');
    });

    it('should unblock task when all blocking dependencies are completed', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      stateManager.addDependency('TASK-C', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-B', 'blocking');

      // C cannot start
      expect(stateManager.startTask('TASK-C').success).toBe(false);

      // Complete A
      stateManager.startTask('TASK-A');
      stateManager.completeTask('TASK-A');

      // C still cannot start (B not done)
      expect(stateManager.startTask('TASK-C').success).toBe(false);

      // Complete B
      stateManager.startTask('TASK-B');
      stateManager.completeTask('TASK-B');

      // Now C can start
      const result = stateManager.startTask('TASK-C');
      expect(result.success).toBe(true);
    });

    it('should allow chain progression as dependencies complete', () => {
      // Chain: A → B → C
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-B', 'blocking');

      // Start and complete A
      expect(stateManager.startTask('TASK-A').success).toBe(true);
      expect(stateManager.completeTask('TASK-A').success).toBe(true);

      // Now B can start and complete
      expect(stateManager.startTask('TASK-B').success).toBe(true);
      expect(stateManager.completeTask('TASK-B').success).toBe(true);

      // Now C can start and complete
      expect(stateManager.startTask('TASK-C').success).toBe(true);
      expect(stateManager.completeTask('TASK-C').success).toBe(true);

      // All tasks should be DONE
      expect(stateManager.getTask('TASK-A')?.status).toBe('DONE');
      expect(stateManager.getTask('TASK-B')?.status).toBe('DONE');
      expect(stateManager.getTask('TASK-C')?.status).toBe('DONE');
    });

    it('should update blocking dependencies list after completion', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');

      // Initially blocking
      const blockingBefore = stateManager.getBlockingDependencies('TASK-B');
      expect(blockingBefore.length).toBe(1);

      // Complete A
      stateManager.startTask('TASK-A');
      stateManager.completeTask('TASK-A');

      // No longer blocking
      const blockingAfter = stateManager.getBlockingDependencies('TASK-B');
      expect(blockingAfter.length).toBe(0);
    });
  });

  // ===========================================================================
  // 4. Non-Blocking Dependency: Can Start but Not Complete
  // Validates: Requirements 7.4
  // ===========================================================================
  describe('4. Non-Blocking Dependency: Can Start but Not Complete', () => {
    it('should allow task with non-blocking dependency to start', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'non_blocking');

      // B should be able to start even though A is not DONE
      const result = stateManager.startTask('TASK-B');
      expect(result.success).toBe(true);
      expect(stateManager.getTask('TASK-B')?.status).toBe('IN_PROGRESS');
    });

    it('should prevent task with unsatisfied non-blocking dependency from completing', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'non_blocking');

      // Start B
      stateManager.startTask('TASK-B');

      // B cannot complete because A is not DONE
      const result = stateManager.completeTask('TASK-B');
      expect(result.success).toBe(false);
      expect(result.error).toContain('non-blocking');
      expect(result.error).toContain('TASK-A');

      // B should still be IN_PROGRESS
      expect(stateManager.getTask('TASK-B')?.status).toBe('IN_PROGRESS');
    });

    it('should allow completion after non-blocking dependency is satisfied', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'non_blocking');

      // Start B
      stateManager.startTask('TASK-B');

      // Cannot complete yet
      expect(stateManager.completeTask('TASK-B').success).toBe(false);

      // Complete A
      stateManager.startTask('TASK-A');
      stateManager.completeTask('TASK-A');

      // Now B can complete
      const result = stateManager.completeTask('TASK-B');
      expect(result.success).toBe(true);
      expect(stateManager.getTask('TASK-B')?.status).toBe('DONE');
    });

    it('should handle mixed blocking and non-blocking dependencies', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      // C has blocking dependency on A, non-blocking on B
      stateManager.addDependency('TASK-C', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-B', 'non_blocking');

      // C cannot start (A is blocking)
      expect(stateManager.startTask('TASK-C').success).toBe(false);

      // Complete A
      stateManager.startTask('TASK-A');
      stateManager.completeTask('TASK-A');

      // Now C can start (blocking dependency satisfied)
      expect(stateManager.startTask('TASK-C').success).toBe(true);

      // C cannot complete (non-blocking dependency B not satisfied)
      expect(stateManager.completeTask('TASK-C').success).toBe(false);

      // Complete B
      stateManager.startTask('TASK-B');
      stateManager.completeTask('TASK-B');

      // Now C can complete
      expect(stateManager.completeTask('TASK-C').success).toBe(true);
    });

    it('should allow parallel work on non-blocking dependent tasks', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'non_blocking');

      // Both A and B can be started simultaneously
      expect(stateManager.startTask('TASK-A').success).toBe(true);
      expect(stateManager.startTask('TASK-B').success).toBe(true);

      // Both are IN_PROGRESS
      expect(stateManager.getTask('TASK-A')?.status).toBe('IN_PROGRESS');
      expect(stateManager.getTask('TASK-B')?.status).toBe('IN_PROGRESS');

      // Complete A first
      expect(stateManager.completeTask('TASK-A').success).toBe(true);

      // Now B can complete
      expect(stateManager.completeTask('TASK-B').success).toBe(true);
    });
  });

  // ===========================================================================
  // 5. Detect and Reject Circular Dependencies
  // Validates: Requirements 7.5
  // ===========================================================================
  describe('5. Detect and Reject Circular Dependencies', () => {
    it('should reject direct two-task cycle (A→B, B→A)', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));

      // A depends on B
      expect(stateManager.addDependency('TASK-A', 'TASK-B', 'blocking').success).toBe(true);

      // B depends on A (would create cycle)
      const result = stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');
      expect(result.success).toBe(false);
      expect(result.error).toContain('circular');
    });

    it('should reject indirect three-task cycle (A→B→C→A)', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      // Build chain: A→B→C
      expect(stateManager.addDependency('TASK-A', 'TASK-B', 'blocking').success).toBe(true);
      expect(stateManager.addDependency('TASK-B', 'TASK-C', 'blocking').success).toBe(true);

      // Attempt C→A (would create cycle)
      const result = stateManager.addDependency('TASK-C', 'TASK-A', 'blocking');
      expect(result.success).toBe(false);
      expect(result.error).toContain('circular');
    });

    it('should reject cycle with non-blocking dependency type', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));

      expect(stateManager.addDependency('TASK-A', 'TASK-B', 'non_blocking').success).toBe(true);

      // Even non-blocking would create cycle
      const result = stateManager.addDependency('TASK-B', 'TASK-A', 'non_blocking');
      expect(result.success).toBe(false);
      expect(result.error).toContain('circular');
    });

    it('should reject cycle in mixed dependency types', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      // A depends on B (blocking)
      expect(stateManager.addDependency('TASK-A', 'TASK-B', 'blocking').success).toBe(true);
      // B depends on C (non_blocking)
      expect(stateManager.addDependency('TASK-B', 'TASK-C', 'non_blocking').success).toBe(true);

      // C depends on A would create cycle
      const result = stateManager.addDependency('TASK-C', 'TASK-A', 'blocking');
      expect(result.success).toBe(false);
      expect(result.error).toContain('circular');
    });

    it('should reject self-dependency', () => {
      stateManager.createTask(createTestTask('TASK-A'));

      const result = stateManager.addDependency('TASK-A', 'TASK-A', 'blocking');
      expect(result.success).toBe(false);
    });

    it('should allow diamond dependency pattern (not a cycle)', () => {
      // Diamond: D depends on both B and C, both B and C depend on A
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));
      stateManager.createTask(createTestTask('TASK-D'));

      // B and C depend on A
      expect(stateManager.addDependency('TASK-B', 'TASK-A', 'blocking').success).toBe(true);
      expect(stateManager.addDependency('TASK-C', 'TASK-A', 'blocking').success).toBe(true);

      // D depends on B and C
      expect(stateManager.addDependency('TASK-D', 'TASK-B', 'blocking').success).toBe(true);
      expect(stateManager.addDependency('TASK-D', 'TASK-C', 'blocking').success).toBe(true);

      // All dependencies should be registered
      expect(stateManager.getDependencies('TASK-D').length).toBe(2);
    });
  });

  // ===========================================================================
  // 6. TDD Phase Transitions with Dependency Awareness
  // Validates: Requirements 15.2
  // ===========================================================================
  describe('6. TDD Phase Transitions with Dependency Awareness', () => {
    it('should initialize TDD phase to RED when task starts', () => {
      stateManager.createTask(createTestTask('TASK-A'));

      stateManager.startTask('TASK-A');

      expect(stateManager.getTDDPhase('TASK-A')).toBe('RED');
    });

    it('should allow GREEN transition when blocking dependencies satisfied', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');

      // Complete A first
      stateManager.startTask('TASK-A');
      stateManager.transitionToGreen('TASK-A');
      stateManager.transitionToRefactor('TASK-A');
      stateManager.completeTask('TASK-A');

      // Start B and transition to GREEN
      stateManager.startTask('TASK-B');
      expect(stateManager.getTDDPhase('TASK-B')).toBe('RED');

      const result = stateManager.transitionToGreen('TASK-B');
      expect(result.success).toBe(true);
      expect(stateManager.getTDDPhase('TASK-B')).toBe('GREEN');
    });

    it('should complete full TDD cycle with dependency chain', () => {
      // Chain: A → B
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');

      // Complete TDD cycle for A
      stateManager.startTask('TASK-A');
      expect(stateManager.getTDDPhase('TASK-A')).toBe('RED');

      stateManager.transitionToGreen('TASK-A');
      expect(stateManager.getTDDPhase('TASK-A')).toBe('GREEN');

      stateManager.transitionToRefactor('TASK-A');
      expect(stateManager.getTDDPhase('TASK-A')).toBe('REFACTOR');

      stateManager.completeTask('TASK-A');
      expect(stateManager.getTDDPhase('TASK-A')).toBe('COMPLETE');
      expect(stateManager.getTask('TASK-A')?.status).toBe('DONE');

      // Now B can complete TDD cycle
      stateManager.startTask('TASK-B');
      expect(stateManager.getTDDPhase('TASK-B')).toBe('RED');

      stateManager.transitionToGreen('TASK-B');
      expect(stateManager.getTDDPhase('TASK-B')).toBe('GREEN');

      stateManager.transitionToRefactor('TASK-B');
      expect(stateManager.getTDDPhase('TASK-B')).toBe('REFACTOR');

      stateManager.completeTask('TASK-B');
      expect(stateManager.getTDDPhase('TASK-B')).toBe('COMPLETE');
    });

    it('should allow parallel TDD cycles for non-blocking dependencies', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.addDependency('TASK-B', 'TASK-A', 'non_blocking');

      // Both can start TDD cycle
      stateManager.startTask('TASK-A');
      stateManager.startTask('TASK-B');

      expect(stateManager.getTDDPhase('TASK-A')).toBe('RED');
      expect(stateManager.getTDDPhase('TASK-B')).toBe('RED');

      // Both can progress to GREEN
      stateManager.transitionToGreen('TASK-A');
      stateManager.transitionToGreen('TASK-B');

      expect(stateManager.getTDDPhase('TASK-A')).toBe('GREEN');
      expect(stateManager.getTDDPhase('TASK-B')).toBe('GREEN');

      // Both can progress to REFACTOR
      stateManager.transitionToRefactor('TASK-A');
      stateManager.transitionToRefactor('TASK-B');

      // A can complete
      stateManager.completeTask('TASK-A');
      expect(stateManager.getTDDPhase('TASK-A')).toBe('COMPLETE');

      // Now B can complete (non-blocking dependency satisfied)
      const result = stateManager.completeTask('TASK-B');
      expect(result.success).toBe(true);
      expect(stateManager.getTDDPhase('TASK-B')).toBe('COMPLETE');
    });

    it('should handle multiple developers working on independent tasks', () => {
      // Scenario: Dev1 works on A, Dev2 works on B (no dependencies)
      stateManager.createTask({ ...createTestTask('TASK-A'), assignee: 'dev-001' });
      stateManager.createTask({ ...createTestTask('TASK-B'), assignee: 'dev-002' });

      // Both can complete full TDD cycles independently
      stateManager.startTask('TASK-A');
      stateManager.startTask('TASK-B');

      stateManager.transitionToGreen('TASK-A');
      stateManager.transitionToGreen('TASK-B');

      stateManager.transitionToRefactor('TASK-A');
      stateManager.transitionToRefactor('TASK-B');

      expect(stateManager.completeTask('TASK-A').success).toBe(true);
      expect(stateManager.completeTask('TASK-B').success).toBe(true);

      expect(stateManager.getTask('TASK-A')?.status).toBe('DONE');
      expect(stateManager.getTask('TASK-B')?.status).toBe('DONE');
    });

    it('should enforce TDD phase prerequisites', () => {
      stateManager.createTask(createTestTask('TASK-A'));

      // Cannot transition to GREEN before starting
      const greenBeforeStart = stateManager.transitionToGreen('TASK-A');
      expect(greenBeforeStart.success).toBe(false);

      // Start task
      stateManager.startTask('TASK-A');

      // Cannot transition to REFACTOR before GREEN
      const refactorBeforeGreen = stateManager.transitionToRefactor('TASK-A');
      expect(refactorBeforeGreen.success).toBe(false);

      // Transition to GREEN, then REFACTOR
      stateManager.transitionToGreen('TASK-A');
      const refactorResult = stateManager.transitionToRefactor('TASK-A');
      expect(refactorResult.success).toBe(true);
    });
  });

  // ===========================================================================
  // 7. Complex Scenarios
  // ===========================================================================
  describe('7. Complex Scenarios', () => {
    it('should handle long dependency chains correctly', () => {
      // Chain: A → B → C → D → E
      const tasks = ['TASK-A', 'TASK-B', 'TASK-C', 'TASK-D', 'TASK-E'];
      
      for (const taskId of tasks) {
        stateManager.createTask(createTestTask(taskId));
      }

      for (let i = 1; i < tasks.length; i++) {
        stateManager.addDependency(tasks[i], tasks[i - 1], 'blocking');
      }

      // Only A can start
      for (let i = 1; i < tasks.length; i++) {
        expect(stateManager.startTask(tasks[i]).success).toBe(false);
      }
      expect(stateManager.startTask(tasks[0]).success).toBe(true);

      // Complete each task in order
      for (let i = 0; i < tasks.length; i++) {
        if (i > 0) {
          expect(stateManager.startTask(tasks[i]).success).toBe(true);
        }
        expect(stateManager.completeTask(tasks[i]).success).toBe(true);
        expect(stateManager.getTask(tasks[i])?.status).toBe('DONE');
      }
    });

    it('should handle complex mixed dependency graph', () => {
      // Complex graph:
      // A (no deps)
      // B depends on A (blocking)
      // C depends on A (non_blocking)
      // D depends on B (blocking) and C (non_blocking)
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));
      stateManager.createTask(createTestTask('TASK-D'));

      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-A', 'non_blocking');
      stateManager.addDependency('TASK-D', 'TASK-B', 'blocking');
      stateManager.addDependency('TASK-D', 'TASK-C', 'non_blocking');

      // A can start, C can start (non-blocking)
      expect(stateManager.startTask('TASK-A').success).toBe(true);
      expect(stateManager.startTask('TASK-C').success).toBe(true);

      // B cannot start (A not DONE)
      expect(stateManager.startTask('TASK-B').success).toBe(false);

      // Complete A
      stateManager.completeTask('TASK-A');

      // Now B can start
      expect(stateManager.startTask('TASK-B').success).toBe(true);

      // C can complete (A is done)
      stateManager.completeTask('TASK-C');

      // D still cannot start (B not done)
      expect(stateManager.startTask('TASK-D').success).toBe(false);

      // Complete B
      stateManager.completeTask('TASK-B');

      // Now D can start and complete
      expect(stateManager.startTask('TASK-D').success).toBe(true);
      expect(stateManager.completeTask('TASK-D').success).toBe(true);
    });

    it('should maintain consistency after multiple operations', () => {
      stateManager.createTask(createTestTask('TASK-A'));
      stateManager.createTask(createTestTask('TASK-B'));
      stateManager.createTask(createTestTask('TASK-C'));

      // Add and verify dependencies
      stateManager.addDependency('TASK-B', 'TASK-A', 'blocking');
      stateManager.addDependency('TASK-C', 'TASK-B', 'blocking');

      // Start A, complete it
      stateManager.startTask('TASK-A');
      stateManager.completeTask('TASK-A');

      // Start B, complete it
      stateManager.startTask('TASK-B');
      stateManager.completeTask('TASK-B');

      // Start C, complete it
      stateManager.startTask('TASK-C');
      stateManager.completeTask('TASK-C');

      // Verify final state
      expect(stateManager.getTask('TASK-A')?.status).toBe('DONE');
      expect(stateManager.getTask('TASK-B')?.status).toBe('DONE');
      expect(stateManager.getTask('TASK-C')?.status).toBe('DONE');

      // Verify no blocking dependencies remain
      expect(stateManager.getBlockingDependencies('TASK-A').length).toBe(0);
      expect(stateManager.getBlockingDependencies('TASK-B').length).toBe(0);
      expect(stateManager.getBlockingDependencies('TASK-C').length).toBe(0);
    });
  });
});
