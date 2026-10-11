/**
 * Integration Tests for Parallel Execution Flow
 * 
 * This test file verifies the integration between:
 * - Parallel_Group_Manager: Creates and manages parallel task groups
 * - Dependency_Resolver: Validates dependencies and prevents internal blocking
 * - Workload_Analyzer: Tracks workload distribution during parallel execution
 * 
 * **Requirements: 5.1-5.5, 6.1-6.3, 15.3**
 * 
 * Test Scenarios:
 * 1. Create parallel group with multiple tasks
 * 2. Validate no internal blocking dependencies
 * 3. Multiple developers start tasks simultaneously
 * 4. Track parallel group progress as tasks complete
 * 5. Group completion triggers milestone update
 * 6. Workload balancing during parallel execution
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ParallelGroupDefinition,
  ParallelGroupError,
  ParallelGroupErrorCode,
  GroupProgress,
  TaskForGroups,
  TaskStatusForGroups,
  Parallel_Group_Manager,
  InMemoryParallelGroupStorage,
  InMemoryTaskStorageForGroups,
  ParallelGroupManagerConfig,
  ParallelGroupManagerImpl,
  calculateProgress,
  determineGroupStatus,
  createGroupMember,
} from '../../parallel-group-manager';
import {
  DependencyResolverImpl,
  InMemoryTaskStorageForDeps,
  TaskForDeps,
  DependencyType,
  DependencyErrorCode,
} from '../../dependency-resolver';
import {
  WorkloadAnalyzerImpl,
  InMemoryTaskStorageForWorkload,
  InMemoryTeamStorageForWorkload,
  TaskForWorkload,
  TeamMemberForWorkload,
  DEFAULT_BOTTLENECK_THRESHOLD,
  StatusCounts,
  Bottleneck,
} from '../../workload-analyzer';
import { Result, ok, err, Role } from '../../team-manager';

// =============================================================================
// Test Fixtures and Setup
// =============================================================================

/**
 * Creates a unified task that can be used across all components.
 */
interface UnifiedTask {
  id: string;
  title: string;
  status: TaskStatusForGroups;
  assignee?: string;
  role_required?: Role;
  depends_on?: Array<{ task_id: string; type: 'blocking' | 'non_blocking' }>;
  estimated_effort?: number;
}

/**
 * Creates a team member for testing.
 */
function createTestTeamMember(
  id: string,
  name: string,
  roles: Role[],
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'
): TeamMemberForWorkload {
  return { id, name, roles, status };
}

/**
 * Creates a unified task for testing across all components.
 */
function createUnifiedTask(
  id: string,
  title: string,
  status: TaskStatusForGroups,
  options?: {
    assignee?: string;
    role_required?: Role;
    depends_on?: Array<{ task_id: string; type: 'blocking' | 'non_blocking' }>;
    estimated_effort?: number;
  }
): UnifiedTask {
  return {
    id,
    title,
    status,
    assignee: options?.assignee,
    role_required: options?.role_required,
    depends_on: options?.depends_on || [],
    estimated_effort: options?.estimated_effort,
  };
}

/**
 * Test harness that provides coordinated access to all components.
 */
class ParallelExecutionTestHarness {
  // Storage backends
  public taskStorageForGroups: InMemoryTaskStorageForGroups;
  public taskStorageForDeps: InMemoryTaskStorageForDeps;
  public taskStorageForWorkload: InMemoryTaskStorageForWorkload;
  public groupStorage: InMemoryParallelGroupStorage;
  public teamStorage: InMemoryTeamStorageForWorkload;

  // Components
  public parallelGroupManager: ParallelGroupManagerImpl;
  public dependencyResolver: DependencyResolverImpl;
  public workloadAnalyzer: WorkloadAnalyzerImpl;

  // Milestone tracking (simplified for testing)
  private milestones: Map<string, { id: string; name: string; status: string }> = new Map();

  constructor() {
    // Initialize storage backends
    this.taskStorageForGroups = new InMemoryTaskStorageForGroups();
    this.taskStorageForDeps = new InMemoryTaskStorageForDeps();
    this.taskStorageForWorkload = new InMemoryTaskStorageForWorkload();
    this.groupStorage = new InMemoryParallelGroupStorage();
    this.teamStorage = new InMemoryTeamStorageForWorkload();

    // Initialize Parallel Group Manager
    this.parallelGroupManager = new ParallelGroupManagerImpl({
      taskStorage: this.taskStorageForGroups,
      groupStorage: this.groupStorage,
      validateMilestone: (milestoneId: string) => this.milestones.has(milestoneId),
    });

    // Initialize Dependency Resolver
    this.dependencyResolver = new DependencyResolverImpl({
      taskStorage: this.taskStorageForDeps,
    });

    // Initialize Workload Analyzer
    this.workloadAnalyzer = new WorkloadAnalyzerImpl({
      taskStorage: this.taskStorageForWorkload,
      teamStorage: this.teamStorage,
      bottleneckThreshold: DEFAULT_BOTTLENECK_THRESHOLD,
    });
  }

  /**
   * Adds a milestone for testing.
   */
  addMilestone(id: string, name: string): void {
    this.milestones.set(id, { id, name, status: 'IN_PROGRESS' });
  }

  /**
   * Completes a milestone if all associated parallel groups are complete.
   */
  checkAndUpdateMilestone(milestoneId: string): boolean {
    const milestone = this.milestones.get(milestoneId);
    if (!milestone) return false;

    const associatedGroups = this.parallelGroupManager.getGroupsByMilestone(milestoneId);
    const allComplete = associatedGroups.every(g => g.status === 'COMPLETE');

    if (allComplete && associatedGroups.length > 0) {
      milestone.status = 'COMPLETE';
      return true;
    }
    return false;
  }

  /**
   * Gets milestone status.
   */
  getMilestoneStatus(milestoneId: string): string | null {
    const milestone = this.milestones.get(milestoneId);
    return milestone?.status || null;
  }

  /**
   * Adds a team member to all relevant storages.
   */
  addTeamMember(member: TeamMemberForWorkload): void {
    this.teamStorage.addMember(member);
  }

  /**
   * Adds a unified task to all relevant storages.
   */
  addTask(task: UnifiedTask): void {
    // Add to group storage
    const taskForGroups: TaskForGroups = {
      id: task.id,
      title: task.title,
      status: task.status,
      assignee: task.assignee,
      role_required: task.role_required,
      depends_on: task.depends_on,
    };
    this.taskStorageForGroups.addTask(taskForGroups);

    // Add to dependency resolver storage
    const taskForDeps: TaskForDeps = {
      id: task.id,
      title: task.title,
      status: task.status,
      assignee: task.assignee,
      role_required: task.role_required,
      depends_on: task.depends_on?.map(d => ({
        task_id: d.task_id,
        type: d.type,
      })),
    };
    this.taskStorageForDeps.addTask(taskForDeps);

    // Add to workload storage
    const taskForWorkload: TaskForWorkload = {
      id: task.id,
      title: task.title,
      status: task.status,
      assignee: task.assignee,
      role_required: task.role_required,
      estimated_effort: task.estimated_effort,
    };
    this.taskStorageForWorkload.addTask(taskForWorkload);
  }

  /**
   * Updates task status across all storages.
   */
  updateTaskStatus(taskId: string, newStatus: TaskStatusForGroups, assignee?: string): void {
    // Update in group storage
    const taskForGroups = this.taskStorageForGroups.getTask(taskId);
    if (taskForGroups) {
      const updated: TaskForGroups = {
        ...taskForGroups,
        status: newStatus,
        assignee: assignee ?? taskForGroups.assignee,
      };
      this.taskStorageForGroups.updateTask(updated);
    }

    // Update in dependency resolver storage
    const taskForDeps = this.taskStorageForDeps.getTask(taskId);
    if (taskForDeps) {
      const updated: TaskForDeps = {
        ...taskForDeps,
        status: newStatus,
        assignee: assignee ?? taskForDeps.assignee,
      };
      this.taskStorageForDeps.updateTask(updated);
    }

    // Update in workload storage
    const taskForWorkload = this.taskStorageForWorkload.getTask(taskId);
    if (taskForWorkload) {
      const updated: TaskForWorkload = {
        ...taskForWorkload,
        status: newStatus,
        assignee: assignee ?? taskForWorkload.assignee,
      };
      this.taskStorageForWorkload.updateTask(updated);
    }

    // Notify parallel group manager of status change
    this.parallelGroupManager.notifyTaskStatusChange(taskId, newStatus);
  }

  /**
   * Simulates a developer starting to work on a task.
   */
  startTask(taskId: string, developerId: string): Result<void, { message: string }> {
    // Check dependencies first using dependency resolver
    const canStart = this.dependencyResolver.canTransitionToInProgress(taskId);
    if (!canStart.success) {
      return err({ message: canStart.error.message });
    }

    // Update task status
    this.updateTaskStatus(taskId, 'IN_PROGRESS', developerId);
    return ok(undefined);
  }

  /**
   * Simulates a developer completing a task.
   */
  completeTask(taskId: string): Result<void, { message: string }> {
    // Check non-blocking dependencies first
    const canComplete = this.dependencyResolver.canTransitionToDone(taskId);
    if (!canComplete.success) {
      return err({ message: canComplete.error.message });
    }

    // Update task status
    this.updateTaskStatus(taskId, 'DONE');
    return ok(undefined);
  }

  /**
   * Clears all storages.
   */
  clear(): void {
    this.taskStorageForGroups.clear();
    this.taskStorageForDeps.clear();
    this.taskStorageForWorkload.clear();
    this.groupStorage.clear();
    this.teamStorage.clear();
    this.milestones.clear();
  }
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Parallel Execution Flow Integration Tests', () => {
  let harness: ParallelExecutionTestHarness;

  beforeEach(() => {
    harness = new ParallelExecutionTestHarness();
  });

  // ===========================================================================
  // Test Scenario 1: Create parallel group with multiple tasks
  // Requirements: 5.1, 5.4
  // ===========================================================================
  describe('Scenario 1: Create parallel group with multiple tasks', () => {
    it('should create a parallel group with multiple independent tasks', () => {
      // Arrange: Create independent tasks (no dependencies between them)
      const tasks = [
        createUnifiedTask('TASK-001', 'Implement user authentication API', 'TODO', {
          role_required: 'backend',
          estimated_effort: 8,
        }),
        createUnifiedTask('TASK-002', 'Create login form UI', 'TODO', {
          role_required: 'frontend',
          estimated_effort: 5,
        }),
        createUnifiedTask('TASK-003', 'Write unit tests for auth service', 'TODO', {
          role_required: 'qa',
          estimated_effort: 3,
        }),
      ];

      tasks.forEach(task => harness.addTask(task));

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Sprint 1 - Authentication Feature',
        taskIds: tasks.map(t => t.id),
      };

      // Act: Create the parallel group
      const result = harness.parallelGroupManager.createGroup(groupDef);

      // Assert: Group created successfully
      expect(result.success).toBe(true);

      const groupResult = harness.parallelGroupManager.getGroup('PG-001');
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        expect(groupResult.value.taskIds).toHaveLength(3);
        expect(groupResult.value.status).toBe('PENDING');
        expect(groupResult.value.progress.total).toBe(3);
        expect(groupResult.value.progress.completed).toBe(0);
        expect(groupResult.value.progress.percentage).toBe(0);
      }
    });

    it('should create a parallel group associated with a milestone', () => {
      // Arrange: Create tasks and milestone
      harness.addMilestone('M1', 'MVP Release');

      const tasks = [
        createUnifiedTask('TASK-001', 'Task A', 'TODO'),
        createUnifiedTask('TASK-002', 'Task B', 'TODO'),
      ];
      tasks.forEach(task => harness.addTask(task));

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'MVP Tasks',
        milestone: 'M1',
        taskIds: tasks.map(t => t.id),
      };

      // Act
      const result = harness.parallelGroupManager.createGroup(groupDef);

      // Assert
      expect(result.success).toBe(true);

      const groupResult = harness.parallelGroupManager.getGroup('PG-001');
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        expect(groupResult.value.milestone).toBe('M1');
      }

      // Verify we can find group by milestone
      const milestoneGroups = harness.parallelGroupManager.getGroupsByMilestone('M1');
      expect(milestoneGroups).toHaveLength(1);
      expect(milestoneGroups[0].id).toBe('PG-001');
    });

    it('should allow tasks with non-blocking dependencies in the same group', () => {
      // Arrange: Create tasks where TASK-002 has non-blocking dep on TASK-001
      const task1 = createUnifiedTask('TASK-001', 'Create API spec', 'TODO', {
        role_required: 'backend',
      });
      const task2 = createUnifiedTask('TASK-002', 'Implement API (can start early)', 'TODO', {
        role_required: 'backend',
        depends_on: [{ task_id: 'TASK-001', type: 'non_blocking' }],
      });

      harness.addTask(task1);
      harness.addTask(task2);

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'API Development',
        taskIds: ['TASK-001', 'TASK-002'],
      };

      // Act
      const result = harness.parallelGroupManager.createGroup(groupDef);

      // Assert: Should succeed - non-blocking deps allowed within parallel groups
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Test Scenario 2: Validate no internal blocking dependencies
  // Requirements: 5.2, 5.3
  // ===========================================================================
  describe('Scenario 2: Validate no internal blocking dependencies', () => {
    it('should reject group creation when tasks have blocking dependencies on each other', () => {
      // Arrange: Create tasks with blocking dependency between them
      const task1 = createUnifiedTask('TASK-001', 'Design database schema', 'TODO');
      const task2 = createUnifiedTask('TASK-002', 'Implement data layer', 'TODO', {
        depends_on: [{ task_id: 'TASK-001', type: 'blocking' }],
      });

      harness.addTask(task1);
      harness.addTask(task2);

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Data Layer Development',
        taskIds: ['TASK-001', 'TASK-002'],
      };

      // Act
      const result = harness.parallelGroupManager.createGroup(groupDef);

      // Assert: Should fail with internal dependency conflict
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
        expect(result.error.context?.conflicting_dependencies).toBeDefined();
      }
    });

    it('should reject adding a task with blocking dependency on existing group task', () => {
      // Arrange: Create initial group with independent tasks
      const task1 = createUnifiedTask('TASK-001', 'Task A', 'TODO');
      const task2 = createUnifiedTask('TASK-002', 'Task B', 'TODO');
      harness.addTask(task1);
      harness.addTask(task2);

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Initial Group',
        taskIds: ['TASK-001', 'TASK-002'],
      };
      harness.parallelGroupManager.createGroup(groupDef);

      // Create new task that blocks on an existing group task
      const task3 = createUnifiedTask('TASK-003', 'Task C blocks on A', 'TODO', {
        depends_on: [{ task_id: 'TASK-001', type: 'blocking' }],
      });
      harness.addTask(task3);

      // Act: Try to add task with blocking dependency
      const result = harness.parallelGroupManager.addToGroup('PG-001', 'TASK-003');

      // Assert: Should fail
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ParallelGroupErrorCode.INTERNAL_DEPENDENCY_CONFLICT);
      }
    });

    it('should validate tasks using both ParallelGroupManager and DependencyResolver', () => {
      // Arrange: Create a chain of blocking dependencies
      const task1 = createUnifiedTask('TASK-001', 'Foundation', 'TODO');
      const task2 = createUnifiedTask('TASK-002', 'Level 1', 'TODO', {
        depends_on: [{ task_id: 'TASK-001', type: 'blocking' }],
      });
      const task3 = createUnifiedTask('TASK-003', 'Level 2', 'TODO', {
        depends_on: [{ task_id: 'TASK-002', type: 'blocking' }],
      });

      harness.addTask(task1);
      harness.addTask(task2);
      harness.addTask(task3);

      // Also register dependencies in the dependency resolver
      harness.dependencyResolver.addDependency('TASK-002', 'TASK-001', 'blocking');
      harness.dependencyResolver.addDependency('TASK-003', 'TASK-002', 'blocking');

      // Validate using ParallelGroupManager
      const groupValidation = harness.parallelGroupManager.validateGroupTasks([
        'TASK-001',
        'TASK-002',
        'TASK-003',
      ]);

      // Validate using DependencyResolver - task 3 should not be able to start
      const task3CanStart = harness.dependencyResolver.canTransitionToInProgress('TASK-003');

      // Assert
      expect(groupValidation.success).toBe(false); // Has internal blocking deps
      expect(task3CanStart.success).toBe(false); // TASK-001 and TASK-002 not complete
    });
  });

  // ===========================================================================
  // Test Scenario 3: Multiple developers start tasks simultaneously
  // Requirements: 15.1, 15.2
  // ===========================================================================
  describe('Scenario 3: Multiple developers start tasks simultaneously', () => {
    beforeEach(() => {
      // Set up team members
      harness.addTeamMember(createTestTeamMember('dev-001', 'Alice', ['backend']));
      harness.addTeamMember(createTestTeamMember('dev-002', 'Bob', ['frontend']));
      harness.addTeamMember(createTestTeamMember('dev-003', 'Carol', ['qa']));
    });

    it('should allow multiple developers to start tasks in a parallel group simultaneously', () => {
      // Arrange: Create independent tasks for different roles
      const tasks = [
        createUnifiedTask('TASK-001', 'Backend API', 'TODO', { role_required: 'backend' }),
        createUnifiedTask('TASK-002', 'Frontend UI', 'TODO', { role_required: 'frontend' }),
        createUnifiedTask('TASK-003', 'QA Tests', 'TODO', { role_required: 'qa' }),
      ];
      tasks.forEach(task => harness.addTask(task));

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Feature Sprint',
        taskIds: tasks.map(t => t.id),
      };
      harness.parallelGroupManager.createGroup(groupDef);

      // Act: Multiple developers start their tasks simultaneously
      const result1 = harness.startTask('TASK-001', 'dev-001');
      const result2 = harness.startTask('TASK-002', 'dev-002');
      const result3 = harness.startTask('TASK-003', 'dev-003');

      // Assert: All should succeed
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      // Check group status changed to IN_PROGRESS
      const groupResult = harness.parallelGroupManager.getGroup('PG-001');
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        expect(groupResult.value.status).toBe('IN_PROGRESS');
        expect(groupResult.value.progress.byStatus.IN_PROGRESS).toBe(3);
      }
    });

    it('should track workload distribution when developers start parallel tasks', () => {
      // Arrange
      const tasks = [
        createUnifiedTask('TASK-001', 'Task for Alice', 'TODO', {
          assignee: 'dev-001',
          estimated_effort: 8,
        }),
        createUnifiedTask('TASK-002', 'Task for Bob', 'TODO', {
          assignee: 'dev-002',
          estimated_effort: 5,
        }),
        createUnifiedTask('TASK-003', 'Task for Carol', 'TODO', {
          assignee: 'dev-003',
          estimated_effort: 3,
        }),
      ];
      tasks.forEach(task => harness.addTask(task));

      // Create parallel group
      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Parallel Work',
        taskIds: tasks.map(t => t.id),
      };
      harness.parallelGroupManager.createGroup(groupDef);

      // Act: Get initial workload distribution
      const distributionResult = harness.workloadAnalyzer.getWorkloadDistribution();

      // Assert
      expect(distributionResult.success).toBe(true);
      if (distributionResult.success) {
        const distribution = distributionResult.value;
        expect(distribution.totalTasks).toBe(3);
        expect(distribution.totalDevelopers).toBe(3);
        expect(distribution.averageTasksPerDeveloper).toBe(1);

        // Each developer should have 1 task
        for (const workload of distribution.developerWorkloads) {
          expect(workload.metrics.totalTasks).toBe(1);
        }
      }
    });

    it('should prevent starting a task with unsatisfied blocking dependencies', () => {
      // Arrange: Create tasks where TASK-002 depends on external TASK-EXT
      const externalTask = createUnifiedTask('TASK-EXT', 'External dependency', 'TODO');
      const task1 = createUnifiedTask('TASK-001', 'Independent task', 'TODO');
      const task2 = createUnifiedTask('TASK-002', 'Depends on external', 'TODO', {
        depends_on: [{ task_id: 'TASK-EXT', type: 'blocking' }],
      });

      harness.addTask(externalTask);
      harness.addTask(task1);
      harness.addTask(task2);

      // Register dependency
      harness.dependencyResolver.addDependency('TASK-002', 'TASK-EXT', 'blocking');

      // Create parallel group with TASK-001 and TASK-002 only
      // (TASK-EXT is external to the group but TASK-002 depends on it)
      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Mixed dependencies',
        taskIds: ['TASK-001', 'TASK-002'],
      };
      harness.parallelGroupManager.createGroup(groupDef);

      // Act: Try to start both tasks
      const result1 = harness.startTask('TASK-001', 'dev-001');
      const result2 = harness.startTask('TASK-002', 'dev-002');

      // Assert
      expect(result1.success).toBe(true); // No dependencies
      expect(result2.success).toBe(false); // Blocked by external task
    });
  });

  // ===========================================================================
  // Test Scenario 4: Track parallel group progress as tasks complete
  // Requirements: 6.1, 6.2, 6.3
  // ===========================================================================
  describe('Scenario 4: Track parallel group progress as tasks complete', () => {
    it('should update progress percentage as tasks complete', () => {
      // Arrange: Create 4 tasks in a parallel group
      const tasks = [
        createUnifiedTask('TASK-001', 'Task A', 'TODO'),
        createUnifiedTask('TASK-002', 'Task B', 'TODO'),
        createUnifiedTask('TASK-003', 'Task C', 'TODO'),
        createUnifiedTask('TASK-004', 'Task D', 'TODO'),
      ];
      tasks.forEach(task => harness.addTask(task));

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Progress Test Group',
        taskIds: tasks.map(t => t.id),
      };
      harness.parallelGroupManager.createGroup(groupDef);

      // Initial state
      let progressResult = harness.parallelGroupManager.getGroupProgress('PG-001');
      expect(progressResult.success).toBe(true);
      if (progressResult.success) {
        expect(progressResult.value.percentage).toBe(0);
        expect(progressResult.value.completed).toBe(0);
      }

      // Act: Complete tasks one by one and verify progress
      // Complete 1 of 4 = 25%
      harness.updateTaskStatus('TASK-001', 'DONE');
      progressResult = harness.parallelGroupManager.getGroupProgress('PG-001');
      expect(progressResult.success).toBe(true);
      if (progressResult.success) {
        expect(progressResult.value.percentage).toBe(25);
        expect(progressResult.value.completed).toBe(1);
      }

      // Complete 2 of 4 = 50%
      harness.updateTaskStatus('TASK-002', 'DONE');
      progressResult = harness.parallelGroupManager.getGroupProgress('PG-001');
      if (progressResult.success) {
        expect(progressResult.value.percentage).toBe(50);
        expect(progressResult.value.completed).toBe(2);
      }

      // Complete 3 of 4 = 75%
      harness.updateTaskStatus('TASK-003', 'DONE');
      progressResult = harness.parallelGroupManager.getGroupProgress('PG-001');
      if (progressResult.success) {
        expect(progressResult.value.percentage).toBe(75);
        expect(progressResult.value.completed).toBe(3);
      }

      // Complete 4 of 4 = 100%
      harness.updateTaskStatus('TASK-004', 'DONE');
      progressResult = harness.parallelGroupManager.getGroupProgress('PG-001');
      if (progressResult.success) {
        expect(progressResult.value.percentage).toBe(100);
        expect(progressResult.value.completed).toBe(4);
      }
    });

    it('should list all tasks with their current status and assignee', () => {
      // Arrange
      harness.addTeamMember(createTestTeamMember('dev-001', 'Alice', ['backend']));
      harness.addTeamMember(createTestTeamMember('dev-002', 'Bob', ['frontend']));

      const tasks = [
        createUnifiedTask('TASK-001', 'Backend work', 'IN_PROGRESS', {
          assignee: 'dev-001',
          role_required: 'backend',
        }),
        createUnifiedTask('TASK-002', 'Frontend work', 'TODO', {
          assignee: 'dev-002',
          role_required: 'frontend',
        }),
        createUnifiedTask('TASK-003', 'Done work', 'DONE'),
      ];
      tasks.forEach(task => harness.addTask(task));

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Mixed Status Group',
        taskIds: tasks.map(t => t.id),
      };
      harness.parallelGroupManager.createGroup(groupDef);

      // Act
      const groupResult = harness.parallelGroupManager.getGroup('PG-001');

      // Assert
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        const group = groupResult.value;
        expect(group.tasks).toHaveLength(3);

        // Check status breakdown
        expect(group.progress.byStatus.IN_PROGRESS).toBe(1);
        expect(group.progress.byStatus.TODO).toBe(1);
        expect(group.progress.byStatus.DONE).toBe(1);

        // Check we can find task details
        const task1 = group.tasks.find(t => t.taskId === 'TASK-001');
        expect(task1?.status).toBe('IN_PROGRESS');
        expect(task1?.assignee).toBe('dev-001');
      }
    });

    it('should mark group as COMPLETE when all tasks are DONE', () => {
      // Arrange
      const tasks = [
        createUnifiedTask('TASK-001', 'Task A', 'TODO'),
        createUnifiedTask('TASK-002', 'Task B', 'TODO'),
      ];
      tasks.forEach(task => harness.addTask(task));

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Completion Test',
        taskIds: tasks.map(t => t.id),
      };
      harness.parallelGroupManager.createGroup(groupDef);

      // Verify initial status
      let groupResult = harness.parallelGroupManager.getGroup('PG-001');
      expect(groupResult.success && groupResult.value.status).toBe('PENDING');

      // Start tasks - status should become IN_PROGRESS
      harness.updateTaskStatus('TASK-001', 'IN_PROGRESS');
      groupResult = harness.parallelGroupManager.getGroup('PG-001');
      expect(groupResult.success && groupResult.value.status).toBe('IN_PROGRESS');

      // Complete first task
      harness.updateTaskStatus('TASK-001', 'DONE');
      groupResult = harness.parallelGroupManager.getGroup('PG-001');
      expect(groupResult.success && groupResult.value.status).toBe('IN_PROGRESS');

      // Complete second task - group should be COMPLETE
      harness.updateTaskStatus('TASK-002', 'DONE');
      groupResult = harness.parallelGroupManager.getGroup('PG-001');
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        expect(groupResult.value.status).toBe('COMPLETE');
        expect(groupResult.value.progress.percentage).toBe(100);
      }
    });
  });

  // ===========================================================================
  // Test Scenario 5: Group completion triggers milestone update
  // Requirements: 5.4, 6.3
  // ===========================================================================
  describe('Scenario 5: Group completion triggers milestone update', () => {
    it('should update milestone status when associated parallel group completes', () => {
      // Arrange: Create milestone and group
      harness.addMilestone('M1', 'Phase 1 Delivery');

      const tasks = [
        createUnifiedTask('TASK-001', 'Task A', 'TODO'),
        createUnifiedTask('TASK-002', 'Task B', 'TODO'),
      ];
      tasks.forEach(task => harness.addTask(task));

      const groupDef: ParallelGroupDefinition = {
        id: 'PG-001',
        name: 'Phase 1 Tasks',
        milestone: 'M1',
        taskIds: tasks.map(t => t.id),
      };
      harness.parallelGroupManager.createGroup(groupDef);

      // Verify milestone is IN_PROGRESS
      expect(harness.getMilestoneStatus('M1')).toBe('IN_PROGRESS');

      // Act: Complete all tasks
      harness.updateTaskStatus('TASK-001', 'DONE');
      harness.updateTaskStatus('TASK-002', 'DONE');

      // Trigger milestone check
      const milestoneCompleted = harness.checkAndUpdateMilestone('M1');

      // Assert
      expect(milestoneCompleted).toBe(true);
      expect(harness.getMilestoneStatus('M1')).toBe('COMPLETE');
    });

    it('should not complete milestone if any associated group is incomplete', () => {
      // Arrange: Create milestone with two groups
      harness.addMilestone('M1', 'Multi-Group Milestone');

      // First group
      const tasksGroup1 = [
        createUnifiedTask('TASK-001', 'Group 1 Task', 'DONE'),
      ];
      tasksGroup1.forEach(task => harness.addTask(task));
      harness.parallelGroupManager.createGroup({
        id: 'PG-001',
        name: 'Complete Group',
        milestone: 'M1',
        taskIds: ['TASK-001'],
      });

      // Second group with incomplete task
      const tasksGroup2 = [
        createUnifiedTask('TASK-002', 'Group 2 Task', 'IN_PROGRESS'),
      ];
      tasksGroup2.forEach(task => harness.addTask(task));
      harness.parallelGroupManager.createGroup({
        id: 'PG-002',
        name: 'Incomplete Group',
        milestone: 'M1',
        taskIds: ['TASK-002'],
      });

      // Act
      const milestoneCompleted = harness.checkAndUpdateMilestone('M1');

      // Assert: Milestone should not be complete
      expect(milestoneCompleted).toBe(false);
      expect(harness.getMilestoneStatus('M1')).toBe('IN_PROGRESS');
    });

    it('should notify dependent tasks when parallel group task completes', () => {
      // Arrange: Create an external task that depends on a group task
      const groupTask = createUnifiedTask('TASK-001', 'Group Task', 'TODO');
      const externalTask = createUnifiedTask('TASK-002', 'External dependent', 'TODO', {
        depends_on: [{ task_id: 'TASK-001', type: 'blocking' }],
      });

      harness.addTask(groupTask);
      harness.addTask(externalTask);

      // Register dependency
      harness.dependencyResolver.addDependency('TASK-002', 'TASK-001', 'blocking');

      // Create parallel group with just the group task
      harness.parallelGroupManager.createGroup({
        id: 'PG-001',
        name: 'Dependency Source Group',
        taskIds: ['TASK-001'],
      });

      // Verify external task cannot start
      let canStart = harness.dependencyResolver.canTransitionToInProgress('TASK-002');
      expect(canStart.success).toBe(false);

      // Act: Complete the group task
      harness.completeTask('TASK-001');

      // Assert: External task should now be able to start
      canStart = harness.dependencyResolver.canTransitionToInProgress('TASK-002');
      expect(canStart.success).toBe(true);
    });
  });

  // ===========================================================================
  // Test Scenario 6: Workload balancing during parallel execution
  // Requirements: 9.1, 10.1, 10.2, 10.3
  // ===========================================================================
  describe('Scenario 6: Workload balancing during parallel execution', () => {
    beforeEach(() => {
      // Set up team
      harness.addTeamMember(createTestTeamMember('dev-001', 'Alice', ['backend', 'fullstack']));
      harness.addTeamMember(createTestTeamMember('dev-002', 'Bob', ['frontend']));
      harness.addTeamMember(createTestTeamMember('dev-003', 'Carol', ['backend']));
    });

    it('should identify bottlenecks when a developer has too many active tasks', () => {
      // Arrange: Create tasks with uneven distribution
      // Alice (dev-001) has 4 IN_PROGRESS tasks (above threshold of 3)
      const tasks = [
        createUnifiedTask('TASK-001', 'Alice Task 1', 'IN_PROGRESS', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-002', 'Alice Task 2', 'IN_PROGRESS', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-003', 'Alice Task 3', 'IN_PROGRESS', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-004', 'Alice Task 4', 'IN_PROGRESS', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-005', 'Bob Task 1', 'TODO', { assignee: 'dev-002' }),
        createUnifiedTask('TASK-006', 'Carol Task 1', 'TODO', { assignee: 'dev-003' }),
      ];
      tasks.forEach(task => harness.addTask(task));

      // Create parallel group
      harness.parallelGroupManager.createGroup({
        id: 'PG-001',
        name: 'Unbalanced Group',
        taskIds: tasks.map(t => t.id),
      });

      // Act
      const bottlenecks = harness.workloadAnalyzer.identifyBottlenecks();

      // Assert: Alice should be identified as a bottleneck
      const developerBottleneck = bottlenecks.find(
        b => b.type === 'DEVELOPER' && b.developerId === 'dev-001'
      );
      expect(developerBottleneck).toBeDefined();
      expect(developerBottleneck?.taskCount).toBe(4);
      expect(developerBottleneck?.threshold).toBe(DEFAULT_BOTTLENECK_THRESHOLD);
    });

    it('should identify role capacity bottlenecks', () => {
      // Arrange: Create many backend tasks with only 2 backend developers
      const tasks = [
        createUnifiedTask('TASK-001', 'Backend 1', 'TODO', { role_required: 'backend' }),
        createUnifiedTask('TASK-002', 'Backend 2', 'TODO', { role_required: 'backend' }),
        createUnifiedTask('TASK-003', 'Backend 3', 'TODO', { role_required: 'backend' }),
        createUnifiedTask('TASK-004', 'Backend 4', 'TODO', { role_required: 'backend' }),
        createUnifiedTask('TASK-005', 'Backend 5', 'TODO', { role_required: 'backend' }),
        createUnifiedTask('TASK-006', 'Backend 6', 'TODO', { role_required: 'backend' }),
        createUnifiedTask('TASK-007', 'Frontend 1', 'TODO', { role_required: 'frontend' }),
      ];
      tasks.forEach(task => harness.addTask(task));

      // Act
      const bottlenecks = harness.workloadAnalyzer.identifyBottlenecks();

      // Assert: Backend role should be a capacity bottleneck
      // (6 tasks for 2 backend developers = 3 tasks per developer)
      const roleBottleneck = bottlenecks.find(
        b => b.type === 'ROLE' && b.role === 'backend'
      );
      expect(roleBottleneck).toBeDefined();
      expect(roleBottleneck?.taskCount).toBe(6);
      expect(roleBottleneck?.capacityRatio).toBeCloseTo(3); // 6 tasks / 2 developers
    });

    it('should provide rebalancing recommendations', () => {
      // Arrange: Create uneven workload
      const tasks = [
        // Alice has 3 tasks
        createUnifiedTask('TASK-001', 'Alice Heavy 1', 'TODO', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-002', 'Alice Heavy 2', 'TODO', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-003', 'Alice Heavy 3', 'TODO', { assignee: 'dev-001' }),
        // Bob has no tasks (underutilized)
        // Carol has 1 task
        createUnifiedTask('TASK-004', 'Carol Task', 'TODO', { assignee: 'dev-003' }),
      ];
      tasks.forEach(task => harness.addTask(task));

      harness.parallelGroupManager.createGroup({
        id: 'PG-001',
        name: 'Rebalance Test',
        taskIds: tasks.map(t => t.id),
      });

      // Act
      const recommendations = harness.workloadAnalyzer.getRebalanceRecommendations();

      // Assert: Should recommend moving tasks from Alice to Bob
      if (recommendations.length > 0) {
        const topRecommendation = recommendations[0];
        expect(topRecommendation.fromDeveloperId).toBe('dev-001'); // Alice overloaded
        expect(topRecommendation.toDeveloperId).toBe('dev-002'); // Bob underutilized
      }
    });

    it('should track team workload distribution during parallel execution', () => {
      // Arrange: Distribute tasks across team
      const tasks = [
        createUnifiedTask('TASK-001', 'Task 1', 'IN_PROGRESS', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-002', 'Task 2', 'TODO', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-003', 'Task 3', 'IN_PROGRESS', { assignee: 'dev-002' }),
        createUnifiedTask('TASK-004', 'Task 4', 'DONE', { assignee: 'dev-003' }),
        createUnifiedTask('TASK-005', 'Task 5', 'TODO', { assignee: 'dev-003' }),
      ];
      tasks.forEach(task => harness.addTask(task));

      harness.parallelGroupManager.createGroup({
        id: 'PG-001',
        name: 'Distributed Group',
        taskIds: tasks.map(t => t.id),
      });

      // Act
      const distributionResult = harness.workloadAnalyzer.getWorkloadDistribution();

      // Assert
      expect(distributionResult.success).toBe(true);
      if (distributionResult.success) {
        const distribution = distributionResult.value;

        // Team totals
        expect(distribution.totalTasks).toBe(5);
        expect(distribution.totalDevelopers).toBe(3);

        // Team status breakdown
        expect(distribution.teamStatusCounts.IN_PROGRESS).toBe(2);
        expect(distribution.teamStatusCounts.TODO).toBe(2);
        expect(distribution.teamStatusCounts.DONE).toBe(1);

        // Individual workloads
        const aliceWorkload = distribution.developerWorkloads.find(w => w.developerId === 'dev-001');
        expect(aliceWorkload?.metrics.totalTasks).toBe(2);
        expect(aliceWorkload?.metrics.tasksByStatus.IN_PROGRESS).toBe(1);

        const bobWorkload = distribution.developerWorkloads.find(w => w.developerId === 'dev-002');
        expect(bobWorkload?.metrics.totalTasks).toBe(1);

        const carolWorkload = distribution.developerWorkloads.find(w => w.developerId === 'dev-003');
        expect(carolWorkload?.metrics.completedTasks).toBe(1);
      }
    });

    it('should update workload as tasks progress through parallel execution', () => {
      // Arrange
      const tasks = [
        createUnifiedTask('TASK-001', 'Task 1', 'TODO', { assignee: 'dev-001' }),
        createUnifiedTask('TASK-002', 'Task 2', 'TODO', { assignee: 'dev-002' }),
      ];
      tasks.forEach(task => harness.addTask(task));

      harness.parallelGroupManager.createGroup({
        id: 'PG-001',
        name: 'Workflow Test',
        taskIds: tasks.map(t => t.id),
      });

      // Initial state
      let aliceResult = harness.workloadAnalyzer.getTaskCountByStatus('dev-001');
      expect(aliceResult.success && aliceResult.value.TODO).toBe(1);
      expect(aliceResult.success && aliceResult.value.IN_PROGRESS).toBe(0);

      // Act: Alice starts her task
      harness.updateTaskStatus('TASK-001', 'IN_PROGRESS');

      // Assert: Workload updated
      aliceResult = harness.workloadAnalyzer.getTaskCountByStatus('dev-001');
      expect(aliceResult.success && aliceResult.value.TODO).toBe(0);
      expect(aliceResult.success && aliceResult.value.IN_PROGRESS).toBe(1);

      // Act: Alice completes her task
      harness.updateTaskStatus('TASK-001', 'DONE');

      // Assert: Workload updated
      aliceResult = harness.workloadAnalyzer.getTaskCountByStatus('dev-001');
      expect(aliceResult.success && aliceResult.value.IN_PROGRESS).toBe(0);
      expect(aliceResult.success && aliceResult.value.DONE).toBe(1);

      // Check group progress also updated
      const groupResult = harness.parallelGroupManager.getGroup('PG-001');
      expect(groupResult.success && groupResult.value.progress.completed).toBe(1);
    });
  });

  // ===========================================================================
  // End-to-End Integration Test
  // ===========================================================================
  describe('End-to-End: Complete parallel execution workflow', () => {
    it('should execute a complete parallel sprint workflow', () => {
      // ============================================
      // Setup: Team and Milestone
      // ============================================
      harness.addTeamMember(createTestTeamMember('dev-001', 'Alice', ['backend']));
      harness.addTeamMember(createTestTeamMember('dev-002', 'Bob', ['frontend']));
      harness.addTeamMember(createTestTeamMember('dev-003', 'Carol', ['qa']));
      harness.addMilestone('M1', 'Sprint 1 Delivery');

      // ============================================
      // Step 1: Create tasks for the sprint
      // ============================================
      const sprintTasks = [
        createUnifiedTask('TASK-001', 'Implement user API', 'TODO', {
          role_required: 'backend',
          estimated_effort: 8,
        }),
        createUnifiedTask('TASK-002', 'Create user profile page', 'TODO', {
          role_required: 'frontend',
          estimated_effort: 5,
        }),
        createUnifiedTask('TASK-003', 'Write API integration tests', 'TODO', {
          role_required: 'qa',
          estimated_effort: 4,
        }),
      ];
      sprintTasks.forEach(task => harness.addTask(task));

      // ============================================
      // Step 2: Create parallel group for the sprint
      // ============================================
      const groupDef: ParallelGroupDefinition = {
        id: 'PG-SPRINT1',
        name: 'Sprint 1 - User Feature',
        milestone: 'M1',
        taskIds: sprintTasks.map(t => t.id),
      };
      const createResult = harness.parallelGroupManager.createGroup(groupDef);
      expect(createResult.success).toBe(true);

      // Verify initial state
      let groupResult = harness.parallelGroupManager.getGroup('PG-SPRINT1');
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        expect(groupResult.value.status).toBe('PENDING');
        expect(groupResult.value.progress.percentage).toBe(0);
      }

      // ============================================
      // Step 3: All developers start their tasks simultaneously
      // ============================================
      harness.updateTaskStatus('TASK-001', 'IN_PROGRESS', 'dev-001');
      harness.updateTaskStatus('TASK-002', 'IN_PROGRESS', 'dev-002');
      harness.updateTaskStatus('TASK-003', 'IN_PROGRESS', 'dev-003');

      // Verify group is IN_PROGRESS
      groupResult = harness.parallelGroupManager.getGroup('PG-SPRINT1');
      expect(groupResult.success && groupResult.value.status).toBe('IN_PROGRESS');

      // Check workload - each developer has 1 IN_PROGRESS task
      const distributionResult = harness.workloadAnalyzer.getWorkloadDistribution();
      expect(distributionResult.success).toBe(true);
      if (distributionResult.success) {
        expect(distributionResult.value.teamStatusCounts.IN_PROGRESS).toBe(3);
        // No bottlenecks (each dev has only 1 active task)
        const bottlenecks = harness.workloadAnalyzer.identifyBottlenecks();
        const developerBottlenecks = bottlenecks.filter(b => b.type === 'DEVELOPER');
        expect(developerBottlenecks).toHaveLength(0);
      }

      // ============================================
      // Step 4: First developer completes (Bob)
      // ============================================
      harness.completeTask('TASK-002');

      groupResult = harness.parallelGroupManager.getGroup('PG-SPRINT1');
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        expect(groupResult.value.progress.completed).toBe(1);
        expect(groupResult.value.progress.percentage).toBe(33);
        expect(groupResult.value.status).toBe('IN_PROGRESS');
      }

      // ============================================
      // Step 5: Second developer completes (Alice)
      // ============================================
      harness.completeTask('TASK-001');

      groupResult = harness.parallelGroupManager.getGroup('PG-SPRINT1');
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        expect(groupResult.value.progress.completed).toBe(2);
        expect(groupResult.value.progress.percentage).toBe(67);
      }

      // ============================================
      // Step 6: Last developer completes (Carol) - Sprint complete!
      // ============================================
      harness.completeTask('TASK-003');

      groupResult = harness.parallelGroupManager.getGroup('PG-SPRINT1');
      expect(groupResult.success).toBe(true);
      if (groupResult.success) {
        expect(groupResult.value.status).toBe('COMPLETE');
        expect(groupResult.value.progress.percentage).toBe(100);
        expect(groupResult.value.progress.completed).toBe(3);
      }

      // ============================================
      // Step 7: Milestone should be complete
      // ============================================
      const milestoneCompleted = harness.checkAndUpdateMilestone('M1');
      expect(milestoneCompleted).toBe(true);
      expect(harness.getMilestoneStatus('M1')).toBe('COMPLETE');

      // Final workload check - all tasks DONE
      const finalDistribution = harness.workloadAnalyzer.getWorkloadDistribution();
      expect(finalDistribution.success).toBe(true);
      if (finalDistribution.success) {
        expect(finalDistribution.value.teamStatusCounts.DONE).toBe(3);
        expect(finalDistribution.value.teamStatusCounts.IN_PROGRESS).toBe(0);
      }
    });
  });
});
