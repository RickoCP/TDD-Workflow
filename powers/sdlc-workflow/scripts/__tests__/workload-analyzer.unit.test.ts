/**
 * Unit Tests for Workload_Analyzer
 * 
 * These tests verify specific scenarios for the Workload_Analyzer component
 * including task counting accuracy, bottleneck threshold detection,
 * workload distribution, and rebalance recommendations.
 * 
 * **Validates: Requirements 9.1-9.3, 10.1-10.3**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkloadAnalyzerImpl,
  WorkloadAnalyzerConfig,
  InMemoryTaskStorageForWorkload,
  InMemoryTeamStorageForWorkload,
  TaskForWorkload,
  TeamMemberForWorkload,
  WorkloadErrorCode,
  StatusCounts,
  DeveloperWorkload,
  WorkloadDistribution,
  Bottleneck,
  RebalanceRecommendation,
  DEFAULT_BOTTLENECK_THRESHOLD,
  TASK_STATUSES_FOR_WORKLOAD,
  VALID_ROLES,
  Role,
  createEmptyStatusCounts,
} from '../workload-analyzer';

// =============================================================================
// Helper Functions for Tests
// =============================================================================

/**
 * Creates a valid team member for testing.
 */
function createTestMember(overrides: Partial<TeamMemberForWorkload> = {}): TeamMemberForWorkload {
  return {
    id: overrides.id ?? 'dev-001',
    name: overrides.name ?? 'Test Developer',
    roles: overrides.roles ?? ['backend'],
    status: overrides.status ?? 'ACTIVE',
  };
}

/**
 * Creates a valid task for testing.
 */
function createTestTask(overrides: Partial<TaskForWorkload> = {}): TaskForWorkload {
  return {
    id: overrides.id ?? 'TASK-001',
    title: overrides.title ?? 'Test Task',
    status: overrides.status ?? 'TODO',
    assignee: overrides.assignee ?? null,
    role_required: overrides.role_required ?? null,
    estimated_effort: overrides.estimated_effort ?? null,
    actual_effort: overrides.actual_effort ?? null,
  };
}

/**
 * Creates an analyzer with storage instances.
 */
function createAnalyzer(config?: Partial<WorkloadAnalyzerConfig>): {
  analyzer: WorkloadAnalyzerImpl;
  taskStorage: InMemoryTaskStorageForWorkload;
  teamStorage: InMemoryTeamStorageForWorkload;
} {
  const taskStorage = new InMemoryTaskStorageForWorkload();
  const teamStorage = new InMemoryTeamStorageForWorkload();
  const analyzer = new WorkloadAnalyzerImpl({
    taskStorage,
    teamStorage,
    ...config,
  });
  return { analyzer, taskStorage, teamStorage };
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('Workload_Analyzer Unit Tests', () => {
  let analyzer: WorkloadAnalyzerImpl;
  let taskStorage: InMemoryTaskStorageForWorkload;
  let teamStorage: InMemoryTeamStorageForWorkload;

  beforeEach(() => {
    const setup = createAnalyzer();
    analyzer = setup.analyzer;
    taskStorage = setup.taskStorage;
    teamStorage = setup.teamStorage;
  });

  // ===========================================================================
  // 1. getDeveloperWorkload Tests
  // Validates: Requirements 9.1, 9.2
  // ===========================================================================
  describe('1. getDeveloperWorkload', () => {
    describe('Successfully returns workload for existing developer', () => {
      it('should return workload for developer with no tasks', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-empty' }));

        const result = analyzer.getDeveloperWorkload('dev-empty');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.developerId).toBe('dev-empty');
          expect(result.value.metrics.totalTasks).toBe(0);
          expect(result.value.metrics.activeTasks).toBe(0);
          expect(result.value.metrics.completedTasks).toBe(0);
          expect(result.value.isOverloaded).toBe(false);
        }
      });

      it('should return correct workload for developer with multiple tasks', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001', name: 'Alice' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-001', status: 'TODO', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-002', status: 'IN_PROGRESS', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-003', status: 'DONE', assignee: 'dev-001' }));

        const result = analyzer.getDeveloperWorkload('dev-001');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.developerId).toBe('dev-001');
          expect(result.value.developerName).toBe('Alice');
          expect(result.value.metrics.totalTasks).toBe(3);
          expect(result.value.metrics.tasksByStatus.TODO).toBe(1);
          expect(result.value.metrics.tasksByStatus.IN_PROGRESS).toBe(1);
          expect(result.value.metrics.tasksByStatus.DONE).toBe(1);
          expect(result.value.metrics.activeTasks).toBe(1); // IN_PROGRESS only
          expect(result.value.metrics.completedTasks).toBe(1);
        }
      });

      it('should include developer roles in workload', () => {
        teamStorage.addMember(createTestMember({
          id: 'dev-multi-role',
          roles: ['frontend', 'backend'],
        }));

        const result = analyzer.getDeveloperWorkload('dev-multi-role');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.roles).toEqual(['frontend', 'backend']);
        }
      });

      it('should calculate effort when estimates are available', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-effort' }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-001',
          status: 'TODO',
          assignee: 'dev-effort',
          estimated_effort: 5,
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-002',
          status: 'DONE',
          assignee: 'dev-effort',
          estimated_effort: 3,
          actual_effort: 4,
        }));

        const result = analyzer.getDeveloperWorkload('dev-effort');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metrics.estimatedEffort).toBe(8); // 5 + 3
          // Remaining = total - completed (actual_effort for DONE)
        }
      });
    });

    describe('Returns error for non-existent developer (1401: DEVELOPER_NOT_FOUND)', () => {
      it('should return DEVELOPER_NOT_FOUND error for unknown ID', () => {
        const result = analyzer.getDeveloperWorkload('non-existent');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(WorkloadErrorCode.DEVELOPER_NOT_FOUND);
          expect(result.error.code).toBe(1401);
          expect(result.error.category).toBe('WORKLOAD_ERROR');
          expect(result.error.context?.developer_id).toBe('non-existent');
        }
      });

      it('should return error for empty developer ID', () => {
        const result = analyzer.getDeveloperWorkload('');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(WorkloadErrorCode.INVALID_METRICS_QUERY);
        }
      });

      it('should return error for whitespace-only developer ID', () => {
        const result = analyzer.getDeveloperWorkload('   ');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(WorkloadErrorCode.INVALID_METRICS_QUERY);
        }
      });
    });

    describe('Identifies overloaded developers', () => {
      it('should mark developer as overloaded when active tasks exceed threshold', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-overloaded' }));
        // Add 4 IN_PROGRESS tasks (exceeds default threshold of 3)
        for (let i = 1; i <= 4; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-00${i}`,
            status: 'IN_PROGRESS',
            assignee: 'dev-overloaded',
          }));
        }

        const result = analyzer.getDeveloperWorkload('dev-overloaded');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.isOverloaded).toBe(true);
          expect(result.value.metrics.activeTasks).toBe(4);
        }
      });

      it('should not mark developer as overloaded at threshold', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-at-threshold' }));
        // Add exactly 3 IN_PROGRESS tasks (at threshold, not over)
        for (let i = 1; i <= 3; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-00${i}`,
            status: 'IN_PROGRESS',
            assignee: 'dev-at-threshold',
          }));
        }

        const result = analyzer.getDeveloperWorkload('dev-at-threshold');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.isOverloaded).toBe(false);
        }
      });

      it('should count BLOCKED tasks toward active tasks', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-blocked' }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-001',
          status: 'IN_PROGRESS',
          assignee: 'dev-blocked',
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-002',
          status: 'IN_PROGRESS',
          assignee: 'dev-blocked',
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-003',
          status: 'BLOCKED',
          assignee: 'dev-blocked',
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-004',
          status: 'BLOCKED',
          assignee: 'dev-blocked',
        }));

        const result = analyzer.getDeveloperWorkload('dev-blocked');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metrics.activeTasks).toBe(4); // 2 IN_PROGRESS + 2 BLOCKED
          expect(result.value.isOverloaded).toBe(true);
        }
      });
    });
  });

  // ===========================================================================
  // 2. getTeamWorkload Tests
  // Validates: Requirements 9.1
  // ===========================================================================
  describe('2. getTeamWorkload', () => {
    describe('Successfully returns workload for all team members', () => {
      it('should return workload for each registered team member', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001', name: 'Alice' }));
        teamStorage.addMember(createTestMember({ id: 'dev-002', name: 'Bob' }));
        teamStorage.addMember(createTestMember({ id: 'dev-003', name: 'Charlie' }));

        taskStorage.addTask(createTestTask({ id: 'TASK-001', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-002', assignee: 'dev-002' }));

        const result = analyzer.getTeamWorkload();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value).toHaveLength(3);
          expect(result.value.map(w => w.developerId)).toContain('dev-001');
          expect(result.value.map(w => w.developerId)).toContain('dev-002');
          expect(result.value.map(w => w.developerId)).toContain('dev-003');
        }
      });

      it('should include inactive members in team workload', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-active', status: 'ACTIVE' }));
        teamStorage.addMember(createTestMember({ id: 'dev-inactive', status: 'INACTIVE' }));

        const result = analyzer.getTeamWorkload();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value).toHaveLength(2);
        }
      });
    });

    describe('Returns error when no team members exist (1405: INSUFFICIENT_DATA)', () => {
      it('should return INSUFFICIENT_DATA error when no members registered', () => {
        const result = analyzer.getTeamWorkload();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(WorkloadErrorCode.INSUFFICIENT_DATA);
          expect(result.error.code).toBe(1405);
          expect(result.error.category).toBe('WORKLOAD_ERROR');
        }
      });
    });
  });

  // ===========================================================================
  // 3. getWorkloadDistribution Tests
  // Validates: Requirements 9.1, 9.2, 9.3
  // ===========================================================================
  describe('3. getWorkloadDistribution', () => {
    describe('Successfully calculates distribution metrics', () => {
      it('should calculate average tasks per developer', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001' }));
        teamStorage.addMember(createTestMember({ id: 'dev-002' }));

        // 6 tasks total, 2 developers = 3 average
        for (let i = 1; i <= 6; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-00${i}`,
            assignee: i <= 3 ? 'dev-001' : 'dev-002',
          }));
        }

        const result = analyzer.getWorkloadDistribution();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.totalTasks).toBe(6);
          expect(result.value.totalDevelopers).toBe(2);
          expect(result.value.averageTasksPerDeveloper).toBe(3);
        }
      });

      it('should calculate standard deviation for uneven distribution', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001' }));
        teamStorage.addMember(createTestMember({ id: 'dev-002' }));

        // dev-001 has 5 tasks, dev-002 has 1 task
        for (let i = 1; i <= 5; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-00${i}`,
            assignee: 'dev-001',
          }));
        }
        taskStorage.addTask(createTestTask({ id: 'TASK-006', assignee: 'dev-002' }));

        const result = analyzer.getWorkloadDistribution();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.standardDeviation).toBeGreaterThan(0);
        }
      });

      it('should aggregate team-wide status counts', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001' }));
        teamStorage.addMember(createTestMember({ id: 'dev-002' }));

        taskStorage.addTask(createTestTask({ id: 'TASK-001', status: 'TODO', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-002', status: 'IN_PROGRESS', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-003', status: 'DONE', assignee: 'dev-002' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-004', status: 'BLOCKED', assignee: 'dev-002' }));

        const result = analyzer.getWorkloadDistribution();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.teamStatusCounts.TODO).toBe(1);
          expect(result.value.teamStatusCounts.IN_PROGRESS).toBe(1);
          expect(result.value.teamStatusCounts.DONE).toBe(1);
          expect(result.value.teamStatusCounts.BLOCKED).toBe(1);
        }
      });

      it('should calculate role workload stats', () => {
        teamStorage.addMember(createTestMember({
          id: 'dev-fe',
          roles: ['frontend'],
        }));
        teamStorage.addMember(createTestMember({
          id: 'dev-be',
          roles: ['backend'],
        }));

        taskStorage.addTask(createTestTask({
          id: 'TASK-001',
          role_required: 'frontend',
          assignee: 'dev-fe',
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-002',
          role_required: 'frontend',
          assignee: 'dev-fe',
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-003',
          role_required: 'backend',
          assignee: 'dev-be',
        }));

        const result = analyzer.getWorkloadDistribution();

        expect(result.success).toBe(true);
        if (result.success) {
          const frontendStats = result.value.byRole.find(r => r.role === 'frontend');
          expect(frontendStats).toBeDefined();
          expect(frontendStats?.developerCount).toBe(1);
          expect(frontendStats?.totalTasks).toBe(2);
        }
      });

      it('should identify overloaded and underutilized developers', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-busy' }));
        teamStorage.addMember(createTestMember({ id: 'dev-idle' }));

        // dev-busy has 5 IN_PROGRESS tasks (overloaded)
        for (let i = 1; i <= 5; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-BUSY-${i}`,
            status: 'IN_PROGRESS',
            assignee: 'dev-busy',
          }));
        }
        // dev-idle has no tasks (underutilized if average > 0)

        const result = analyzer.getWorkloadDistribution();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.overloadedDeveloperIds).toContain('dev-busy');
          expect(result.value.underutilizedDeveloperIds).toContain('dev-idle');
        }
      });
    });
  });

  // ===========================================================================
  // 4. identifyBottlenecks Tests
  // Validates: Requirements 10.1, 10.2, 10.3
  // ===========================================================================
  describe('4. identifyBottlenecks', () => {
    describe('Identifies developer bottlenecks (>3 IN_PROGRESS/BLOCKED tasks)', () => {
      it('should identify developer as bottleneck when exceeding threshold', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-bottleneck', name: 'Bottleneck Dev' }));

        // Add 4 IN_PROGRESS tasks
        for (let i = 1; i <= 4; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-00${i}`,
            status: 'IN_PROGRESS',
            assignee: 'dev-bottleneck',
          }));
        }

        const bottlenecks = analyzer.identifyBottlenecks();

        expect(bottlenecks.length).toBeGreaterThan(0);
        const devBottleneck = bottlenecks.find(b => b.developerId === 'dev-bottleneck');
        expect(devBottleneck).toBeDefined();
        expect(devBottleneck?.type).toBe('DEVELOPER');
        expect(devBottleneck?.taskCount).toBe(4);
        expect(devBottleneck?.threshold).toBe(DEFAULT_BOTTLENECK_THRESHOLD);
      });

      it('should not identify developer with tasks at threshold as bottleneck', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-at-threshold' }));

        // Add exactly 3 IN_PROGRESS tasks (at threshold)
        for (let i = 1; i <= 3; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-00${i}`,
            status: 'IN_PROGRESS',
            assignee: 'dev-at-threshold',
          }));
        }

        const bottlenecks = analyzer.identifyBottlenecks();
        const devBottleneck = bottlenecks.find(b => b.developerId === 'dev-at-threshold');

        expect(devBottleneck).toBeUndefined();
      });

      it('should include BLOCKED tasks in bottleneck calculation', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-mixed' }));

        taskStorage.addTask(createTestTask({
          id: 'TASK-001',
          status: 'IN_PROGRESS',
          assignee: 'dev-mixed',
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-002',
          status: 'IN_PROGRESS',
          assignee: 'dev-mixed',
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-003',
          status: 'BLOCKED',
          assignee: 'dev-mixed',
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-004',
          status: 'BLOCKED',
          assignee: 'dev-mixed',
        }));

        const bottlenecks = analyzer.identifyBottlenecks();
        const devBottleneck = bottlenecks.find(b => b.developerId === 'dev-mixed');

        expect(devBottleneck).toBeDefined();
        expect(devBottleneck?.taskCount).toBe(4);
      });

      it('should include recommendation in developer bottleneck', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-bottleneck', name: 'Alice' }));

        for (let i = 1; i <= 5; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-00${i}`,
            status: 'IN_PROGRESS',
            assignee: 'dev-bottleneck',
          }));
        }

        const bottlenecks = analyzer.identifyBottlenecks();
        const devBottleneck = bottlenecks.find(b => b.developerId === 'dev-bottleneck');

        expect(devBottleneck?.recommendedAction).toBeDefined();
        expect(devBottleneck?.recommendedAction).toContain('reassign');
      });
    });

    describe('Identifies role capacity bottlenecks', () => {
      it('should identify role bottleneck when tasks exceed developers', () => {
        // One frontend developer
        teamStorage.addMember(createTestMember({
          id: 'dev-fe',
          roles: ['frontend'],
        }));

        // Multiple tasks requiring frontend
        for (let i = 1; i <= 5; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-FE-${i}`,
            status: 'TODO',
            role_required: 'frontend',
          }));
        }

        const bottlenecks = analyzer.identifyBottlenecks();
        const roleBottleneck = bottlenecks.find(b => b.type === 'ROLE' && b.role === 'frontend');

        expect(roleBottleneck).toBeDefined();
        expect(roleBottleneck?.hasCapacityIssue || roleBottleneck?.capacityRatio).toBeDefined();
      });

      it('should identify role with no developers as bottleneck', () => {
        // No QA developers registered
        teamStorage.addMember(createTestMember({
          id: 'dev-be',
          roles: ['backend'],
        }));

        // Tasks requiring QA
        taskStorage.addTask(createTestTask({
          id: 'TASK-QA-1',
          status: 'TODO',
          role_required: 'qa',
        }));

        const bottlenecks = analyzer.identifyBottlenecks();
        const roleBottleneck = bottlenecks.find(b => b.type === 'ROLE' && b.role === 'qa');

        expect(roleBottleneck).toBeDefined();
      });
    });

    describe('Bottleneck severity levels', () => {
      it('should assign severity based on task count', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-critical' }));

        // Add many IN_PROGRESS tasks
        for (let i = 1; i <= 10; i++) {
          taskStorage.addTask(createTestTask({
            id: `TASK-${i.toString().padStart(3, '0')}`,
            status: 'IN_PROGRESS',
            assignee: 'dev-critical',
          }));
        }

        const bottlenecks = analyzer.identifyBottlenecks();
        const devBottleneck = bottlenecks.find(b => b.developerId === 'dev-critical');

        expect(devBottleneck?.severity).toBeDefined();
        // With 10 tasks (excess of 7 over threshold of 3), should be HIGH or CRITICAL
        expect(['HIGH', 'CRITICAL']).toContain(devBottleneck?.severity);
      });
    });
  });

  // ===========================================================================
  // 5. getTaskCountByStatus Tests
  // Validates: Requirements 9.1
  // ===========================================================================
  describe('5. getTaskCountByStatus', () => {
    describe('Returns accurate task counts by status', () => {
      it('should return all zero counts for developer with no tasks', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-empty' }));

        const result = analyzer.getTaskCountByStatus('dev-empty');

        expect(result.success).toBe(true);
        if (result.success) {
          for (const status of TASK_STATUSES_FOR_WORKLOAD) {
            expect(result.value[status]).toBe(0);
          }
        }
      });

      it('should correctly count tasks by each status', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001' }));

        taskStorage.addTask(createTestTask({ id: 'TASK-001', status: 'TODO', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-002', status: 'TODO', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-003', status: 'READY', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-004', status: 'IN_PROGRESS', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-005', status: 'BLOCKED', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-006', status: 'VERIFY', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-007', status: 'DONE', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-008', status: 'DONE', assignee: 'dev-001' }));

        const result = analyzer.getTaskCountByStatus('dev-001');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.TODO).toBe(2);
          expect(result.value.READY).toBe(1);
          expect(result.value.IN_PROGRESS).toBe(1);
          expect(result.value.BLOCKED).toBe(1);
          expect(result.value.VERIFY).toBe(1);
          expect(result.value.DONE).toBe(2);
        }
      });

      it('should only count tasks assigned to the specified developer', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001' }));
        teamStorage.addMember(createTestMember({ id: 'dev-002' }));

        taskStorage.addTask(createTestTask({ id: 'TASK-001', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-002', assignee: 'dev-001' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-003', assignee: 'dev-002' }));
        taskStorage.addTask(createTestTask({ id: 'TASK-004', assignee: null })); // unassigned

        const result = analyzer.getTaskCountByStatus('dev-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const total = Object.values(result.value).reduce((sum, count) => sum + count, 0);
          expect(total).toBe(2);
        }
      });
    });

    describe('Returns error for non-existent developer (1401: DEVELOPER_NOT_FOUND)', () => {
      it('should return error for unknown developer', () => {
        const result = analyzer.getTaskCountByStatus('unknown-dev');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(WorkloadErrorCode.DEVELOPER_NOT_FOUND);
          expect(result.error.context?.developer_id).toBe('unknown-dev');
        }
      });
    });

    describe('Returns error for invalid developer ID (1404: INVALID_METRICS_QUERY)', () => {
      it('should return error for empty string', () => {
        const result = analyzer.getTaskCountByStatus('');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(WorkloadErrorCode.INVALID_METRICS_QUERY);
        }
      });
    });
  });

  // ===========================================================================
  // 6. getEstimatedEffort Tests
  // Validates: Requirements 9.2
  // ===========================================================================
  describe('6. getEstimatedEffort', () => {
    describe('Returns correct effort estimates', () => {
      it('should return null when no tasks have estimates', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001' }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-001',
          assignee: 'dev-001',
          estimated_effort: null,
        }));

        const result = analyzer.getEstimatedEffort('dev-001');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value).toBeNull();
        }
      });

      it('should sum estimated effort from all assigned tasks', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001' }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-001',
          assignee: 'dev-001',
          estimated_effort: 5,
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-002',
          assignee: 'dev-001',
          estimated_effort: 8,
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-003',
          assignee: 'dev-001',
          estimated_effort: 3,
        }));

        const result = analyzer.getEstimatedEffort('dev-001');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value).toBe(16); // 5 + 8 + 3
        }
      });

      it('should handle mixed tasks with and without estimates', () => {
        teamStorage.addMember(createTestMember({ id: 'dev-001' }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-001',
          assignee: 'dev-001',
          estimated_effort: 5,
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-002',
          assignee: 'dev-001',
          estimated_effort: null, // No estimate
        }));
        taskStorage.addTask(createTestTask({
          id: 'TASK-003',
          assignee: 'dev-001',
          estimated_effort: 3,
        }));

        const result = analyzer.getEstimatedEffort('dev-001');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value).toBe(8); // 5 + 0 + 3
        }
      });
    });

    describe('Returns error for non-existent developer', () => {
      it('should return DEVELOPER_NOT_FOUND error', () => {
        const result = analyzer.getEstimatedEffort('unknown');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(WorkloadErrorCode.DEVELOPER_NOT_FOUND);
        }
      });
    });
  });

  // ===========================================================================
  // 7. getTeamAverage Tests
  // Validates: Requirements 9.3
  // ===========================================================================
  describe('7. getTeamAverage', () => {
    it('should return 0 when no team members exist', () => {
      const average = analyzer.getTeamAverage();
      expect(average).toBe(0);
    });

    it('should return 0 when no tasks are assigned', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      teamStorage.addMember(createTestMember({ id: 'dev-002' }));

      const average = analyzer.getTeamAverage();
      expect(average).toBe(0);
    });

    it('should calculate correct average tasks per developer', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      teamStorage.addMember(createTestMember({ id: 'dev-002' }));

      // dev-001 has 4 tasks, dev-002 has 2 tasks, average = 3
      for (let i = 1; i <= 4; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-001-${i}`,
          assignee: 'dev-001',
        }));
      }
      for (let i = 1; i <= 2; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-002-${i}`,
          assignee: 'dev-002',
        }));
      }

      const average = analyzer.getTeamAverage();
      expect(average).toBe(3);
    });

    it('should only count assigned tasks', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));

      taskStorage.addTask(createTestTask({ id: 'TASK-001', assignee: 'dev-001' }));
      taskStorage.addTask(createTestTask({ id: 'TASK-002', assignee: 'dev-001' }));
      taskStorage.addTask(createTestTask({ id: 'TASK-003', assignee: null })); // Unassigned

      const average = analyzer.getTeamAverage();
      expect(average).toBe(2); // Only counts assigned tasks
    });
  });

  // ===========================================================================
  // 8. getOverloadedDevelopers Tests
  // Validates: Requirements 10.1
  // ===========================================================================
  describe('8. getOverloadedDevelopers', () => {
    it('should return empty array when no developers are overloaded', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      taskStorage.addTask(createTestTask({
        id: 'TASK-001',
        status: 'IN_PROGRESS',
        assignee: 'dev-001',
      }));

      const overloaded = analyzer.getOverloadedDevelopers();
      expect(overloaded).toHaveLength(0);
    });

    it('should return developers with active tasks exceeding default threshold', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-overloaded' }));
      teamStorage.addMember(createTestMember({ id: 'dev-normal' }));

      // Overloaded: 5 active tasks
      for (let i = 1; i <= 5; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-OL-${i}`,
          status: 'IN_PROGRESS',
          assignee: 'dev-overloaded',
        }));
      }

      // Normal: 2 active tasks
      for (let i = 1; i <= 2; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-NR-${i}`,
          status: 'IN_PROGRESS',
          assignee: 'dev-normal',
        }));
      }

      const overloaded = analyzer.getOverloadedDevelopers();

      expect(overloaded).toContain('dev-overloaded');
      expect(overloaded).not.toContain('dev-normal');
    });

    it('should use custom threshold when provided', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));

      // 2 active tasks
      taskStorage.addTask(createTestTask({
        id: 'TASK-001',
        status: 'IN_PROGRESS',
        assignee: 'dev-001',
      }));
      taskStorage.addTask(createTestTask({
        id: 'TASK-002',
        status: 'IN_PROGRESS',
        assignee: 'dev-001',
      }));

      // With threshold of 1, should be overloaded
      const overloadedCustom = analyzer.getOverloadedDevelopers(1);
      expect(overloadedCustom).toContain('dev-001');

      // With default threshold (3), should not be overloaded
      const overloadedDefault = analyzer.getOverloadedDevelopers();
      expect(overloadedDefault).not.toContain('dev-001');
    });
  });

  // ===========================================================================
  // 9. getUnderutilizedDevelopers Tests
  // Validates: Requirements 9.3
  // ===========================================================================
  describe('9. getUnderutilizedDevelopers', () => {
    it('should return empty array when all developers are equally utilized', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      teamStorage.addMember(createTestMember({ id: 'dev-002' }));

      taskStorage.addTask(createTestTask({ id: 'TASK-001', assignee: 'dev-001' }));
      taskStorage.addTask(createTestTask({ id: 'TASK-002', assignee: 'dev-002' }));

      const underutilized = analyzer.getUnderutilizedDevelopers();
      expect(underutilized).toHaveLength(0);
    });

    it('should identify developers with significantly fewer tasks than average', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-busy' }));
      teamStorage.addMember(createTestMember({ id: 'dev-idle' }));

      // dev-busy: 10 tasks
      for (let i = 1; i <= 10; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-BUSY-${i}`,
          assignee: 'dev-busy',
        }));
      }
      // dev-idle: 0 tasks (average is 5, 0 < 5 * 0.5 = 2.5)

      const underutilized = analyzer.getUnderutilizedDevelopers();

      expect(underutilized).toContain('dev-idle');
      expect(underutilized).not.toContain('dev-busy');
    });

    it('should use custom threshold when provided', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      teamStorage.addMember(createTestMember({ id: 'dev-002' }));

      // dev-001: 8 tasks, dev-002: 2 tasks, average = 5
      for (let i = 1; i <= 8; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-001-${i}`,
          assignee: 'dev-001',
        }));
      }
      for (let i = 1; i <= 2; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-002-${i}`,
          assignee: 'dev-002',
        }));
      }

      // With threshold 0.5, dev-002 (2 tasks) is < 5 * 0.5 = 2.5, so underutilized
      const underutilizedHalf = analyzer.getUnderutilizedDevelopers(0.5);
      expect(underutilizedHalf).toContain('dev-002');

      // With threshold 0.3, dev-002 (2 tasks) is not < 5 * 0.3 = 1.5
      const underutilizedLow = analyzer.getUnderutilizedDevelopers(0.3);
      expect(underutilizedLow).not.toContain('dev-002');
    });

    it('should return empty array when team average is 0', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      teamStorage.addMember(createTestMember({ id: 'dev-002' }));
      // No tasks assigned

      const underutilized = analyzer.getUnderutilizedDevelopers();
      expect(underutilized).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 10. getRebalanceRecommendations Tests
  // Validates: Requirements 10.3
  // ===========================================================================
  describe('10. getRebalanceRecommendations', () => {
    it('should return empty array when no rebalancing is needed', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      teamStorage.addMember(createTestMember({ id: 'dev-002' }));

      // Equal distribution
      taskStorage.addTask(createTestTask({ id: 'TASK-001', assignee: 'dev-001' }));
      taskStorage.addTask(createTestTask({ id: 'TASK-002', assignee: 'dev-002' }));

      const recommendations = analyzer.getRebalanceRecommendations();
      expect(recommendations).toHaveLength(0);
    });

    it('should recommend reassignment from overloaded to underutilized developers', () => {
      teamStorage.addMember(createTestMember({
        id: 'dev-busy',
        name: 'Busy Dev',
        roles: ['backend'],
      }));
      teamStorage.addMember(createTestMember({
        id: 'dev-idle',
        name: 'Idle Dev',
        roles: ['backend'],
      }));

      // dev-busy is overloaded with 6 IN_PROGRESS tasks
      for (let i = 1; i <= 4; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-IP-${i}`,
          status: 'IN_PROGRESS',
          assignee: 'dev-busy',
        }));
      }
      // And has reassignable TODO tasks
      taskStorage.addTask(createTestTask({
        id: 'TASK-TODO-1',
        status: 'TODO',
        assignee: 'dev-busy',
        role_required: 'backend',
      }));
      taskStorage.addTask(createTestTask({
        id: 'TASK-TODO-2',
        status: 'READY',
        assignee: 'dev-busy',
        role_required: 'backend',
      }));

      // dev-idle has no tasks

      const recommendations = analyzer.getRebalanceRecommendations();

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].fromDeveloperId).toBe('dev-busy');
      expect(recommendations[0].toDeveloperId).toBe('dev-idle');
    });

    it('should sort recommendations by impact score', () => {
      teamStorage.addMember(createTestMember({
        id: 'dev-very-busy',
        roles: ['backend'],
      }));
      teamStorage.addMember(createTestMember({
        id: 'dev-idle',
        roles: ['backend'],
      }));

      // Many IN_PROGRESS tasks
      for (let i = 1; i <= 6; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-IP-${i}`,
          status: 'IN_PROGRESS',
          assignee: 'dev-very-busy',
        }));
      }
      // Reassignable tasks
      for (let i = 1; i <= 3; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-TODO-${i}`,
          status: 'TODO',
          assignee: 'dev-very-busy',
          role_required: 'backend',
        }));
      }

      const recommendations = analyzer.getRebalanceRecommendations();

      if (recommendations.length > 1) {
        // Recommendations should be sorted by impact score (descending)
        for (let i = 1; i < recommendations.length; i++) {
          expect(recommendations[i - 1].impactScore).toBeGreaterThanOrEqual(
            recommendations[i].impactScore
          );
        }
      }
    });

    it('should respect role requirements when recommending reassignment', () => {
      teamStorage.addMember(createTestMember({
        id: 'dev-busy',
        roles: ['frontend'],
      }));
      teamStorage.addMember(createTestMember({
        id: 'dev-idle',
        roles: ['backend'], // Different role
      }));

      // dev-busy is overloaded
      for (let i = 1; i <= 5; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-IP-${i}`,
          status: 'IN_PROGRESS',
          assignee: 'dev-busy',
        }));
      }
      // Task requires frontend role
      taskStorage.addTask(createTestTask({
        id: 'TASK-FE',
        status: 'TODO',
        assignee: 'dev-busy',
        role_required: 'frontend', // dev-idle doesn't have this role
      }));

      const recommendations = analyzer.getRebalanceRecommendations();

      // Should not recommend reassigning frontend task to backend developer
      const feRecommendation = recommendations.find(r => r.taskId === 'TASK-FE');
      expect(feRecommendation).toBeUndefined();
    });
  });

  // ===========================================================================
  // 11. suggestReassignment Tests
  // ===========================================================================
  describe('11. suggestReassignment', () => {
    it('should return null for unassigned task', () => {
      taskStorage.addTask(createTestTask({
        id: 'TASK-UNASSIGNED',
        assignee: null,
      }));

      const result = analyzer.suggestReassignment('TASK-UNASSIGNED');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null for task in IN_PROGRESS status', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      taskStorage.addTask(createTestTask({
        id: 'TASK-IP',
        status: 'IN_PROGRESS',
        assignee: 'dev-001',
      }));

      const result = analyzer.suggestReassignment('TASK-IP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null for DONE task', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));
      taskStorage.addTask(createTestTask({
        id: 'TASK-DONE',
        status: 'DONE',
        assignee: 'dev-001',
      }));

      const result = analyzer.suggestReassignment('TASK-DONE');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeNull();
      }
    });

    it('should suggest reassignment when another developer has significantly fewer tasks', () => {
      teamStorage.addMember(createTestMember({
        id: 'dev-busy',
        name: 'Busy Dev',
        roles: ['backend'],
      }));
      teamStorage.addMember(createTestMember({
        id: 'dev-free',
        name: 'Free Dev',
        roles: ['backend'],
      }));

      // dev-busy has 5 tasks, dev-free has 0
      for (let i = 1; i <= 5; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-${i.toString().padStart(3, '0')}`,
          status: 'TODO',
          assignee: 'dev-busy',
          role_required: 'backend',
        }));
      }

      const result = analyzer.suggestReassignment('TASK-001');

      expect(result.success).toBe(true);
      if (result.success && result.value) {
        expect(result.value.fromDeveloperId).toBe('dev-busy');
        expect(result.value.toDeveloperId).toBe('dev-free');
        expect(result.value.impactScore).toBeGreaterThan(0);
      }
    });

    it('should return error for non-existent task (1404: INVALID_METRICS_QUERY)', () => {
      const result = analyzer.suggestReassignment('TASK-NONEXISTENT');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WorkloadErrorCode.INVALID_METRICS_QUERY);
      }
    });

    it('should return error for empty task ID', () => {
      const result = analyzer.suggestReassignment('');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WorkloadErrorCode.INVALID_METRICS_QUERY);
      }
    });
  });

  // ===========================================================================
  // 12. Error Code Coverage Tests
  // ===========================================================================
  describe('12. Error Code Coverage', () => {
    describe('1401: DEVELOPER_NOT_FOUND', () => {
      it('getDeveloperWorkload returns 1401 for unknown developer', () => {
        const result = analyzer.getDeveloperWorkload('unknown');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1401);
        }
      });

      it('getTaskCountByStatus returns 1401 for unknown developer', () => {
        const result = analyzer.getTaskCountByStatus('unknown');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1401);
        }
      });

      it('getEstimatedEffort returns 1401 for unknown developer', () => {
        const result = analyzer.getEstimatedEffort('unknown');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1401);
        }
      });
    });

    describe('1402: NO_TASKS_ASSIGNED', () => {
      // Note: Current implementation doesn't use this error code explicitly
      // This is here for documentation/future use
      it('error code 1402 is reserved for NO_TASKS_ASSIGNED', () => {
        expect(WorkloadErrorCode.NO_TASKS_ASSIGNED).toBe(1402);
      });
    });

    describe('1403: WORKLOAD_CALCULATION_ERROR', () => {
      // Note: This error is for calculation failures
      it('error code 1403 is reserved for WORKLOAD_CALCULATION_ERROR', () => {
        expect(WorkloadErrorCode.WORKLOAD_CALCULATION_ERROR).toBe(1403);
      });
    });

    describe('1404: INVALID_METRICS_QUERY', () => {
      it('getTaskCountByStatus returns 1404 for empty developer ID', () => {
        const result = analyzer.getTaskCountByStatus('');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1404);
        }
      });

      it('suggestReassignment returns 1404 for empty task ID', () => {
        const result = analyzer.suggestReassignment('');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1404);
        }
      });

      it('suggestReassignment returns 1404 for non-existent task', () => {
        const result = analyzer.suggestReassignment('TASK-999');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1404);
        }
      });
    });

    describe('1405: INSUFFICIENT_DATA', () => {
      it('getTeamWorkload returns 1405 when no team members exist', () => {
        const result = analyzer.getTeamWorkload();
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1405);
        }
      });

      it('getWorkloadDistribution returns 1405 when no team members exist', () => {
        const result = analyzer.getWorkloadDistribution();
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1405);
        }
      });
    });
  });

  // ===========================================================================
  // 13. Custom Configuration Tests
  // ===========================================================================
  describe('13. Custom Configuration', () => {
    it('should respect custom bottleneck threshold', () => {
      const { analyzer: customAnalyzer, taskStorage: ts, teamStorage: tms } = createAnalyzer({
        bottleneckThreshold: 1, // Very low threshold
      });

      tms.addMember(createTestMember({ id: 'dev-001' }));
      ts.addTask(createTestTask({
        id: 'TASK-001',
        status: 'IN_PROGRESS',
        assignee: 'dev-001',
      }));
      ts.addTask(createTestTask({
        id: 'TASK-002',
        status: 'IN_PROGRESS',
        assignee: 'dev-001',
      }));

      const overloaded = customAnalyzer.getOverloadedDevelopers();
      expect(overloaded).toContain('dev-001');

      const bottlenecks = customAnalyzer.identifyBottlenecks();
      const devBottleneck = bottlenecks.find(b => b.developerId === 'dev-001');
      expect(devBottleneck).toBeDefined();
      expect(devBottleneck?.threshold).toBe(1);
    });

    it('should respect custom underutilization threshold', () => {
      const { analyzer: customAnalyzer, taskStorage: ts, teamStorage: tms } = createAnalyzer({
        underutilizationThreshold: 0.8, // High threshold
      });

      tms.addMember(createTestMember({ id: 'dev-001' }));
      tms.addMember(createTestMember({ id: 'dev-002' }));

      // dev-001: 10 tasks, dev-002: 4 tasks, average = 7
      for (let i = 1; i <= 10; i++) {
        ts.addTask(createTestTask({
          id: `TASK-001-${i}`,
          assignee: 'dev-001',
        }));
      }
      for (let i = 1; i <= 4; i++) {
        ts.addTask(createTestTask({
          id: `TASK-002-${i}`,
          assignee: 'dev-002',
        }));
      }

      // With 0.8 threshold, 4 < 7 * 0.8 = 5.6, so dev-002 is underutilized
      const underutilized = customAnalyzer.getUnderutilizedDevelopers();
      expect(underutilized).toContain('dev-002');
    });
  });

  // ===========================================================================
  // 14. Edge Cases
  // ===========================================================================
  describe('14. Edge Cases', () => {
    it('should handle developer with tasks in all statuses', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-all' }));

      for (const status of TASK_STATUSES_FOR_WORKLOAD) {
        taskStorage.addTask(createTestTask({
          id: `TASK-${status}`,
          status,
          assignee: 'dev-all',
        }));
      }

      const result = analyzer.getDeveloperWorkload('dev-all');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.metrics.totalTasks).toBe(TASK_STATUSES_FOR_WORKLOAD.length);
        for (const status of TASK_STATUSES_FOR_WORKLOAD) {
          expect(result.value.metrics.tasksByStatus[status]).toBe(1);
        }
      }
    });

    it('should handle single developer team correctly', () => {
      teamStorage.addMember(createTestMember({ id: 'solo-dev' }));
      taskStorage.addTask(createTestTask({
        id: 'TASK-001',
        assignee: 'solo-dev',
      }));

      const distribution = analyzer.getWorkloadDistribution();

      expect(distribution.success).toBe(true);
      if (distribution.success) {
        expect(distribution.value.totalDevelopers).toBe(1);
        expect(distribution.value.averageTasksPerDeveloper).toBe(1);
        expect(distribution.value.standardDeviation).toBe(0);
      }
    });

    it('should correctly handle large number of tasks', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-001' }));

      const taskCount = 100;
      for (let i = 1; i <= taskCount; i++) {
        taskStorage.addTask(createTestTask({
          id: `TASK-${i.toString().padStart(4, '0')}`,
          status: i % 3 === 0 ? 'DONE' : (i % 2 === 0 ? 'IN_PROGRESS' : 'TODO'),
          assignee: 'dev-001',
        }));
      }

      const result = analyzer.getDeveloperWorkload('dev-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.metrics.totalTasks).toBe(taskCount);
      }
    });

    it('should handle inactive members in team workload', () => {
      teamStorage.addMember(createTestMember({ id: 'dev-active', status: 'ACTIVE' }));
      teamStorage.addMember(createTestMember({ id: 'dev-inactive', status: 'INACTIVE' }));

      const result = analyzer.getTeamWorkload();

      expect(result.success).toBe(true);
      if (result.success) {
        // Both members should be included in team workload
        expect(result.value).toHaveLength(2);
        expect(result.value.map(w => w.developerId)).toContain('dev-active');
        expect(result.value.map(w => w.developerId)).toContain('dev-inactive');
      }
    });
  });
});
