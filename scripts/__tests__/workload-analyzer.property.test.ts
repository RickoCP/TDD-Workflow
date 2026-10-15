/**
 * Property-Based Tests for Workload_Analyzer
 * 
 * **Feature: multi-developer-support, Property 9: Workload Calculation Consistency**
 * 
 * These tests verify the universal correctness properties of the Workload_Analyzer component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements 9.1, 9.2**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  StatusCounts,
  WorkloadMetrics,
  DeveloperWorkload,
  WorkloadDistribution,
  WorkloadError,
  WorkloadErrorCode,
  TaskStatusForWorkload,
  TaskForWorkload,
  TeamMemberForWorkload,
  InMemoryTaskStorageForWorkload,
  InMemoryTeamStorageForWorkload,
  TASK_STATUSES_FOR_WORKLOAD,
  DEFAULT_BOTTLENECK_THRESHOLD,
  createEmptyStatusCounts,
  calculateWorkloadMetrics,
  calculateStandardDeviation,
  createDeveloperWorkload,
  Result,
  ok,
  err,
  Role,
  VALID_ROLES,
} from '../workload-analyzer';

// =============================================================================
// In-Memory Workload_Analyzer Implementation for Testing
// =============================================================================

/**
 * In-memory implementation of Workload_Analyzer for testing purposes.
 * This implementation follows the interface defined in workload-analyzer.ts
 * 
 * Requirements: 9.1, 9.2
 */
class InMemoryWorkloadAnalyzer {
  private taskStorage: InMemoryTaskStorageForWorkload;
  private teamStorage: InMemoryTeamStorageForWorkload;
  private bottleneckThreshold: number;

  constructor(
    taskStorage: InMemoryTaskStorageForWorkload,
    teamStorage: InMemoryTeamStorageForWorkload,
    bottleneckThreshold: number = DEFAULT_BOTTLENECK_THRESHOLD
  ) {
    this.taskStorage = taskStorage;
    this.teamStorage = teamStorage;
    this.bottleneckThreshold = bottleneckThreshold;
  }

  /**
   * Gets tasks assigned to a specific developer.
   * Used for Property 9 verification.
   */
  getTasksByDeveloper(developerId: string): TaskForWorkload[] {
    return this.taskStorage.getTasksByDeveloper(developerId);
  }

  /**
   * Gets task count by status for a developer.
   * 
   * Requirements: 9.1
   */
  getTaskCountByStatus(developerId: string): Result<StatusCounts, WorkloadError> {
    // Check if developer exists
    if (!this.teamStorage.validateDeveloperId(developerId)) {
      return err({
        code: WorkloadErrorCode.DEVELOPER_NOT_FOUND,
        category: 'WORKLOAD_ERROR',
        message: `Developer '${developerId}' not found in team registry`,
        context: { developer_id: developerId },
        suggested_action: 'Verify the developer ID or register the developer first',
        timestamp: new Date().toISOString(),
      });
    }

    // Get tasks for this developer
    const tasks = this.taskStorage.getTasksByDeveloper(developerId);
    
    // Count by status
    const counts = createEmptyStatusCounts();
    for (const task of tasks) {
      if (task.status in counts) {
        counts[task.status]++;
      }
    }

    return ok(counts);
  }

  /**
   * Gets workload metrics for a specific developer.
   * 
   * Requirements: 9.1, 9.2
   */
  getDeveloperWorkload(developerId: string): Result<DeveloperWorkload, WorkloadError> {
    // Check if developer exists
    const member = this.teamStorage.getMember(developerId);
    if (!member) {
      return err({
        code: WorkloadErrorCode.DEVELOPER_NOT_FOUND,
        category: 'WORKLOAD_ERROR',
        message: `Developer '${developerId}' not found in team registry`,
        context: { developer_id: developerId },
        suggested_action: 'Verify the developer ID or register the developer first',
        timestamp: new Date().toISOString(),
      });
    }

    // Get task count by status
    const statusCountsResult = this.getTaskCountByStatus(developerId);
    if (!statusCountsResult.success) {
      return err(statusCountsResult.error);
    }

    // Calculate effort if available
    const tasks = this.taskStorage.getTasksByDeveloper(developerId);
    let estimatedEffort: number | null = null;
    let completedEffort: number | null = null;
    
    const hasEffortEstimates = tasks.some(t => t.estimated_effort != null);
    if (hasEffortEstimates) {
      estimatedEffort = tasks.reduce((sum, t) => sum + (t.estimated_effort || 0), 0);
      completedEffort = tasks
        .filter(t => t.status === 'DONE')
        .reduce((sum, t) => sum + (t.actual_effort || t.estimated_effort || 0), 0);
    }

    // Calculate metrics
    const metrics = calculateWorkloadMetrics(
      statusCountsResult.value,
      estimatedEffort,
      completedEffort
    );

    // Get team average for underutilization check
    const teamAverage = this.getTeamAverage();

    // Create workload object
    const workload = createDeveloperWorkload(
      member.id,
      member.name,
      member.roles,
      metrics,
      this.bottleneckThreshold,
      teamAverage
    );

    return ok(workload);
  }

  /**
   * Gets workload distribution across all team members.
   * 
   * Requirements: 9.1, 9.2, 9.3
   */
  getWorkloadDistribution(): Result<WorkloadDistribution, WorkloadError> {
    const members = this.teamStorage.getAllMembers().filter(m => m.status === 'ACTIVE');
    
    if (members.length === 0) {
      return err({
        code: WorkloadErrorCode.INSUFFICIENT_DATA,
        category: 'WORKLOAD_ERROR',
        message: 'No active team members to analyze',
        context: {},
        suggested_action: 'Register active team members first',
        timestamp: new Date().toISOString(),
      });
    }

    const developerWorkloads: DeveloperWorkload[] = [];
    const teamStatusCounts = createEmptyStatusCounts();
    let totalTasks = 0;
    const taskCounts: number[] = [];

    for (const member of members) {
      const workloadResult = this.getDeveloperWorkload(member.id);
      if (workloadResult.success) {
        developerWorkloads.push(workloadResult.value);
        taskCounts.push(workloadResult.value.metrics.totalTasks);
        totalTasks += workloadResult.value.metrics.totalTasks;

        // Aggregate status counts
        const statusCounts = workloadResult.value.metrics.tasksByStatus;
        for (const status of TASK_STATUSES_FOR_WORKLOAD) {
          teamStatusCounts[status] += statusCounts[status];
        }
      }
    }

    const averageTasksPerDeveloper = members.length > 0 ? totalTasks / members.length : 0;
    const standardDeviation = calculateStandardDeviation(taskCounts);

    // Calculate role workload stats
    const byRole = VALID_ROLES.map(role => {
      const developersWithRole = this.teamStorage.getMembersByRole(role);
      const tasksForRole = this.taskStorage.getTasksByRole(role);
      const developerCount = developersWithRole.length;
      const taskCount = tasksForRole.length;
      const tasksPerDeveloper = developerCount > 0 ? taskCount / developerCount : taskCount;

      return {
        role,
        developerCount,
        totalTasks: taskCount,
        tasksPerDeveloper,
        hasCapacityIssue: developerCount === 0 && taskCount > 0,
      };
    });

    // Find overloaded and underutilized developers
    const overloadedDeveloperIds = developerWorkloads
      .filter(w => w.isOverloaded)
      .map(w => w.developerId);
    const underutilizedDeveloperIds = developerWorkloads
      .filter(w => w.isUnderutilized)
      .map(w => w.developerId);

    return ok({
      totalTasks,
      totalDevelopers: members.length,
      averageTasksPerDeveloper,
      standardDeviation,
      developerWorkloads,
      teamStatusCounts,
      byRole,
      overloadedDeveloperIds,
      underutilizedDeveloperIds,
      calculatedAt: new Date().toISOString(),
    });
  }

  /**
   * Gets the team average tasks per developer.
   */
  getTeamAverage(): number {
    const members = this.teamStorage.getAllMembers().filter(m => m.status === 'ACTIVE');
    if (members.length === 0) return 0;

    let totalTasks = 0;
    for (const member of members) {
      const tasks = this.taskStorage.getTasksByDeveloper(member.id);
      totalTasks += tasks.length;
    }

    return totalTasks / members.length;
  }

  /**
   * Gets total task count across all developers (including unassigned).
   */
  getTotalTaskCount(): number {
    return this.taskStorage.getAllTasks().length;
  }

  /**
   * Gets total assigned task count (sum of tasks assigned to developers).
   */
  getTotalAssignedTaskCount(): number {
    const members = this.teamStorage.getAllMembers();
    let total = 0;
    for (const member of members) {
      total += this.taskStorage.getTasksByDeveloper(member.id).length;
    }
    return total;
  }

  /**
   * Clears the analyzer state (delegates to storage).
   */
  clear(): void {
    this.taskStorage.clear();
    this.teamStorage.clear();
  }
}

// =============================================================================
// Arbitraries (Generators) for Property-Based Testing
// =============================================================================

/**
 * Generates a valid developer ID.
 */
const developerIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,19}$/).filter(id => id.length >= 3);

/**
 * Generates a valid developer name.
 */
const developerNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(name => name.trim().length > 0);

/**
 * Generates a valid task ID.
 */
const taskIdArb = fc.stringMatching(/^TASK-[0-9]{3,6}$/).filter(id => id.length >= 8);

/**
 * Generates a valid task title.
 */
const taskTitleArb = fc.string({ minLength: 5, maxLength: 100 }).filter(title => title.trim().length > 0);

/**
 * Generates a valid role from the VALID_ROLES list.
 */
const validRoleArb: fc.Arbitrary<Role> = fc.constantFrom(...VALID_ROLES);

/**
 * Generates a non-empty array of valid roles (1-3 roles).
 */
const validRolesArrayArb: fc.Arbitrary<Role[]> = fc
  .uniqueArray(validRoleArb, { minLength: 1, maxLength: 3 })
  .filter(roles => roles.length > 0);

/**
 * Generates a valid task status.
 */
const taskStatusArb: fc.Arbitrary<TaskStatusForWorkload> = fc.constantFrom(...TASK_STATUSES_FOR_WORKLOAD);

/**
 * Generates a team member for workload.
 */
const teamMemberForWorkloadArb: fc.Arbitrary<TeamMemberForWorkload> = fc.record({
  id: developerIdArb,
  name: developerNameArb,
  roles: validRolesArrayArb,
  status: fc.constantFrom('ACTIVE' as const, 'INACTIVE' as const),
});

/**
 * Generates a task for workload analysis.
 */
const taskForWorkloadArb: fc.Arbitrary<TaskForWorkload> = fc.record({
  id: taskIdArb,
  title: taskTitleArb,
  status: taskStatusArb,
  assignee: fc.option(developerIdArb, { nil: null }),
  role_required: fc.option(validRoleArb, { nil: null }),
  estimated_effort: fc.option(fc.integer({ min: 1, max: 21 }), { nil: null }),
  actual_effort: fc.option(fc.integer({ min: 1, max: 21 }), { nil: null }),
});

/**
 * Generates a list of team members with unique IDs.
 */
const uniqueTeamMembersArb = (minLength: number, maxLength: number): fc.Arbitrary<TeamMemberForWorkload[]> => {
  return fc.array(teamMemberForWorkloadArb, { minLength, maxLength }).map(members => {
    // Ensure unique IDs by appending index
    const seen = new Set<string>();
    return members.map((member, index) => {
      let id = member.id;
      let suffix = 0;
      while (seen.has(id)) {
        id = `${member.id}-${suffix++}`;
      }
      seen.add(id);
      return { ...member, id };
    });
  });
};

/**
 * Generates a list of tasks with unique IDs.
 */
const uniqueTasksArb = (minLength: number, maxLength: number): fc.Arbitrary<TaskForWorkload[]> => {
  return fc.array(taskForWorkloadArb, { minLength, maxLength }).map(tasks => {
    // Ensure unique IDs by appending index
    return tasks.map((task, index) => ({
      ...task,
      id: `TASK-${String(index + 100).padStart(3, '0')}`,
    }));
  });
};

/**
 * Generates team members and tasks where tasks are assigned to valid developers.
 */
const teamWithAssignedTasksArb = (
  minMembers: number,
  maxMembers: number,
  minTasks: number,
  maxTasks: number
): fc.Arbitrary<{ members: TeamMemberForWorkload[]; tasks: TaskForWorkload[] }> => {
  return uniqueTeamMembersArb(minMembers, maxMembers).chain(members => {
    const memberIds = members.map(m => m.id);
    
    return uniqueTasksArb(minTasks, maxTasks).map(tasks => {
      // Assign some tasks to team members
      const assignedTasks = tasks.map((task, index) => {
        // Assign ~70% of tasks to team members
        if (memberIds.length > 0 && index % 3 !== 0) {
          const assigneeIndex = index % memberIds.length;
          return {
            ...task,
            assignee: memberIds[assigneeIndex],
          };
        }
        return { ...task, assignee: null };
      });
      
      return { members, tasks: assignedTasks };
    });
  });
};

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('Workload_Analyzer Property-Based Tests', () => {
  /**
   * **Feature: multi-developer-support, Property 9: Workload Calculation Consistency**
   * 
   * *For any* developer, the sum of tasks returned by getTasksByDeveloper(developerId) grouped by status
   * SHALL equal the counts in getTaskCountByStatus(developerId).
   * 
   * **Validates: Requirements 9.1, 9.2**
   */
  describe('Property 9: Workload Calculation Consistency', () => {
    let taskStorage: InMemoryTaskStorageForWorkload;
    let teamStorage: InMemoryTeamStorageForWorkload;
    let analyzer: InMemoryWorkloadAnalyzer;

    beforeEach(() => {
      taskStorage = new InMemoryTaskStorageForWorkload();
      teamStorage = new InMemoryTeamStorageForWorkload();
      analyzer = new InMemoryWorkloadAnalyzer(taskStorage, teamStorage);
    });

    it('should return consistent task counts - getTasksByDeveloper grouped by status equals getTaskCountByStatus', () => {
      fc.assert(
        fc.property(
          teamWithAssignedTasksArb(2, 10, 5, 30),
          ({ members, tasks }) => {
            taskStorage.clear();
            teamStorage.clear();

            // Setup: Add all members and tasks
            for (const member of members) {
              teamStorage.addMember(member);
            }
            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            // Property check for each developer
            for (const member of members) {
              // Get tasks by developer and group by status manually
              const tasksByDeveloper = analyzer.getTasksByDeveloper(member.id);
              const manualStatusCounts = createEmptyStatusCounts();
              for (const task of tasksByDeveloper) {
                if (task.status in manualStatusCounts) {
                  manualStatusCounts[task.status]++;
                }
              }

              // Get status counts from analyzer
              const statusCountsResult = analyzer.getTaskCountByStatus(member.id);
              expect(statusCountsResult.success).toBe(true);

              if (statusCountsResult.success) {
                const analyzerStatusCounts = statusCountsResult.value;

                // Property 9: The counts MUST be equal
                for (const status of TASK_STATUSES_FOR_WORKLOAD) {
                  expect(analyzerStatusCounts[status]).toBe(manualStatusCounts[status]);
                }

                // Total tasks should also match
                const manualTotal = tasksByDeveloper.length;
                const analyzerTotal = Object.values(analyzerStatusCounts).reduce((a, b) => a + b, 0);
                expect(analyzerTotal).toBe(manualTotal);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should ensure sum of individual developer workloads equals team total', () => {
      fc.assert(
        fc.property(
          teamWithAssignedTasksArb(2, 8, 10, 40),
          ({ members, tasks }) => {
            taskStorage.clear();
            teamStorage.clear();

            // Setup
            for (const member of members) {
              teamStorage.addMember(member);
            }
            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            // Get distribution
            const distributionResult = analyzer.getWorkloadDistribution();
            
            // Skip if no active members
            const activeMembers = members.filter(m => m.status === 'ACTIVE');
            if (activeMembers.length === 0) {
              expect(distributionResult.success).toBe(false);
              return;
            }

            expect(distributionResult.success).toBe(true);

            if (distributionResult.success) {
              const distribution = distributionResult.value;

              // Sum individual workloads
              let sumOfIndividualTasks = 0;
              const sumOfIndividualStatusCounts = createEmptyStatusCounts();

              for (const devWorkload of distribution.developerWorkloads) {
                sumOfIndividualTasks += devWorkload.metrics.totalTasks;
                
                for (const status of TASK_STATUSES_FOR_WORKLOAD) {
                  sumOfIndividualStatusCounts[status] += devWorkload.metrics.tasksByStatus[status];
                }
              }

              // Team status counts should equal sum of individual status counts
              for (const status of TASK_STATUSES_FOR_WORKLOAD) {
                expect(distribution.teamStatusCounts[status]).toBe(sumOfIndividualStatusCounts[status]);
              }

              // Total tasks should match assigned tasks (not necessarily all tasks since some may be unassigned)
              expect(distribution.totalTasks).toBe(sumOfIndividualTasks);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should ensure no tasks are double-counted across developers', () => {
      fc.assert(
        fc.property(
          teamWithAssignedTasksArb(3, 8, 10, 50),
          ({ members, tasks }) => {
            taskStorage.clear();
            teamStorage.clear();

            // Setup
            for (const member of members) {
              teamStorage.addMember(member);
            }
            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            // Track all task IDs seen across developers
            const seenTaskIds = new Set<string>();
            const duplicateTaskIds: string[] = [];

            for (const member of members) {
              const tasksForDev = analyzer.getTasksByDeveloper(member.id);
              
              for (const task of tasksForDev) {
                if (seenTaskIds.has(task.id)) {
                  duplicateTaskIds.push(task.id);
                }
                seenTaskIds.add(task.id);
              }
            }

            // No task should be counted for multiple developers
            expect(duplicateTaskIds.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should ensure no assigned tasks are missed in calculation', () => {
      fc.assert(
        fc.property(
          teamWithAssignedTasksArb(2, 6, 10, 30),
          ({ members, tasks }) => {
            taskStorage.clear();
            teamStorage.clear();

            // Setup
            for (const member of members) {
              teamStorage.addMember(member);
            }
            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            // Get all assigned task IDs from source data
            const memberIds = new Set(members.map(m => m.id));
            const assignedTaskIds = new Set(
              tasks
                .filter(t => t.assignee && memberIds.has(t.assignee))
                .map(t => t.id)
            );

            // Get all task IDs reported by analyzer for each developer
            const reportedTaskIds = new Set<string>();
            for (const member of members) {
              const tasksForDev = analyzer.getTasksByDeveloper(member.id);
              for (const task of tasksForDev) {
                reportedTaskIds.add(task.id);
              }
            }

            // All assigned tasks should be reported (no misses)
            for (const taskId of assignedTaskIds) {
              expect(reportedTaskIds.has(taskId)).toBe(true);
            }

            // Only assigned tasks should be reported (no extras)
            for (const taskId of reportedTaskIds) {
              expect(assignedTaskIds.has(taskId)).toBe(true);
            }

            // Sets should be equal
            expect(reportedTaskIds.size).toBe(assignedTaskIds.size);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return same result for same input (deterministic calculation)', () => {
      fc.assert(
        fc.property(
          teamWithAssignedTasksArb(2, 5, 5, 20),
          fc.integer({ min: 2, max: 5 }),
          ({ members, tasks }, repeatCount) => {
            taskStorage.clear();
            teamStorage.clear();

            // Setup
            for (const member of members) {
              teamStorage.addMember(member);
            }
            for (const task of tasks) {
              taskStorage.addTask(task);
            }

            // Store first results
            const firstResults: Map<string, StatusCounts> = new Map();
            for (const member of members) {
              const result = analyzer.getTaskCountByStatus(member.id);
              if (result.success) {
                firstResults.set(member.id, { ...result.value });
              }
            }

            // Repeat calculations and compare
            for (let i = 0; i < repeatCount; i++) {
              for (const member of members) {
                const result = analyzer.getTaskCountByStatus(member.id);
                expect(result.success).toBe(true);

                if (result.success && firstResults.has(member.id)) {
                  const firstResult = firstResults.get(member.id)!;
                  
                  // Results should be identical
                  for (const status of TASK_STATUSES_FOR_WORKLOAD) {
                    expect(result.value[status]).toBe(firstResult[status]);
                  }
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly calculate workload for developers with zero tasks', () => {
      fc.assert(
        fc.property(
          uniqueTeamMembersArb(3, 8),
          (members) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add only members, no tasks
            for (const member of members) {
              teamStorage.addMember(member);
            }

            // All developers should have zero tasks
            for (const member of members) {
              const statusCountsResult = analyzer.getTaskCountByStatus(member.id);
              expect(statusCountsResult.success).toBe(true);

              if (statusCountsResult.success) {
                const counts = statusCountsResult.value;
                
                // All status counts should be zero
                for (const status of TASK_STATUSES_FOR_WORKLOAD) {
                  expect(counts[status]).toBe(0);
                }

                // Total should be zero
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                expect(total).toBe(0);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle single developer with all tasks', () => {
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          uniqueTasksArb(5, 20),
          (member, tasks) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add member
            teamStorage.addMember({ ...member, status: 'ACTIVE' });

            // Assign ALL tasks to this single developer
            const assignedTasks = tasks.map(t => ({ ...t, assignee: member.id }));
            for (const task of assignedTasks) {
              taskStorage.addTask(task);
            }

            // Get status counts
            const statusCountsResult = analyzer.getTaskCountByStatus(member.id);
            expect(statusCountsResult.success).toBe(true);

            if (statusCountsResult.success) {
              // Count tasks by status manually
              const expectedCounts = createEmptyStatusCounts();
              for (const task of assignedTasks) {
                expectedCounts[task.status]++;
              }

              // Verify counts match
              for (const status of TASK_STATUSES_FOR_WORKLOAD) {
                expect(statusCountsResult.value[status]).toBe(expectedCounts[status]);
              }

              // Total should equal number of tasks
              const total = Object.values(statusCountsResult.value).reduce((a, b) => a + b, 0);
              expect(total).toBe(assignedTasks.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly segregate tasks by status', () => {
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          fc.record({
            todoCount: fc.integer({ min: 0, max: 5 }),
            readyCount: fc.integer({ min: 0, max: 5 }),
            inProgressCount: fc.integer({ min: 0, max: 5 }),
            blockedCount: fc.integer({ min: 0, max: 5 }),
            verifyCount: fc.integer({ min: 0, max: 5 }),
            doneCount: fc.integer({ min: 0, max: 5 }),
          }),
          (member, statusDistribution) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add member
            teamStorage.addMember({ ...member, status: 'ACTIVE' });

            // Create specific number of tasks for each status
            let taskIndex = 0;
            const statusMapping: [TaskStatusForWorkload, number][] = [
              ['TODO', statusDistribution.todoCount],
              ['READY', statusDistribution.readyCount],
              ['IN_PROGRESS', statusDistribution.inProgressCount],
              ['BLOCKED', statusDistribution.blockedCount],
              ['VERIFY', statusDistribution.verifyCount],
              ['DONE', statusDistribution.doneCount],
            ];

            for (const [status, count] of statusMapping) {
              for (let i = 0; i < count; i++) {
                taskStorage.addTask({
                  id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                  title: `Task ${taskIndex}`,
                  status,
                  assignee: member.id,
                });
                taskIndex++;
              }
            }

            // Verify counts
            const statusCountsResult = analyzer.getTaskCountByStatus(member.id);
            expect(statusCountsResult.success).toBe(true);

            if (statusCountsResult.success) {
              expect(statusCountsResult.value.TODO).toBe(statusDistribution.todoCount);
              expect(statusCountsResult.value.READY).toBe(statusDistribution.readyCount);
              expect(statusCountsResult.value.IN_PROGRESS).toBe(statusDistribution.inProgressCount);
              expect(statusCountsResult.value.BLOCKED).toBe(statusDistribution.blockedCount);
              expect(statusCountsResult.value.VERIFY).toBe(statusDistribution.verifyCount);
              expect(statusCountsResult.value.DONE).toBe(statusDistribution.doneCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return error for non-existent developer', () => {
      fc.assert(
        fc.property(
          developerIdArb,
          (nonExistentId) => {
            taskStorage.clear();
            teamStorage.clear();

            // Don't add any members - developer doesn't exist

            const result = analyzer.getTaskCountByStatus(nonExistentId);
            expect(result.success).toBe(false);

            if (!result.success) {
              expect(result.error.code).toBe(WorkloadErrorCode.DEVELOPER_NOT_FOUND);
              expect(result.error.category).toBe('WORKLOAD_ERROR');
              expect(result.error.context?.developer_id).toBe(nonExistentId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly calculate effort totals when estimates are available', () => {
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          fc.array(
            fc.record({
              status: taskStatusArb,
              estimatedEffort: fc.integer({ min: 1, max: 13 }),
              actualEffort: fc.integer({ min: 1, max: 13 }),
            }),
            { minLength: 3, maxLength: 15 }
          ),
          (member, taskEfforts) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add member
            teamStorage.addMember({ ...member, status: 'ACTIVE' });

            // Add tasks with effort estimates
            taskEfforts.forEach((effort, index) => {
              taskStorage.addTask({
                id: `TASK-${String(index + 100).padStart(3, '0')}`,
                title: `Task ${index}`,
                status: effort.status,
                assignee: member.id,
                estimated_effort: effort.estimatedEffort,
                actual_effort: effort.status === 'DONE' ? effort.actualEffort : null,
              });
            });

            // Get workload
            const workloadResult = analyzer.getDeveloperWorkload(member.id);
            expect(workloadResult.success).toBe(true);

            if (workloadResult.success) {
              // Calculate expected effort
              const expectedEstimated = taskEfforts.reduce((sum, t) => sum + t.estimatedEffort, 0);
              
              expect(workloadResult.value.metrics.estimatedEffort).toBe(expectedEstimated);
              expect(workloadResult.value.metrics.totalTasks).toBe(taskEfforts.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain consistency when tasks are reassigned', () => {
      fc.assert(
        fc.property(
          uniqueTeamMembersArb(3, 6),
          uniqueTasksArb(10, 20),
          fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 5, maxLength: 15 }),
          (members, tasks, reassignmentIndices) => {
            taskStorage.clear();
            teamStorage.clear();

            // Ensure we have enough members
            if (members.length < 2) return;
            const activeMembers = members.filter(m => m.status === 'ACTIVE');
            if (activeMembers.length < 2) return;

            // Setup members
            for (const member of members) {
              teamStorage.addMember(member);
            }

            // Initially assign tasks to first member
            const memberIds = activeMembers.map(m => m.id);
            const assignedTasks = tasks.map((task, idx) => ({
              ...task,
              assignee: memberIds[0],
            }));
            
            for (const task of assignedTasks) {
              taskStorage.addTask(task);
            }

            // Perform reassignments
            for (let i = 0; i < reassignmentIndices.length && i < tasks.length; i++) {
              const taskId = assignedTasks[i].id;
              const newMemberIdx = reassignmentIndices[i] % memberIds.length;
              const newAssignee = memberIds[newMemberIdx];
              
              // Update task assignment
              const task = taskStorage.getTask(taskId);
              if (task) {
                taskStorage.updateTask({ ...task, assignee: newAssignee });
              }
            }

            // Verify consistency: sum of all developer task counts equals total assigned tasks
            let sumOfAllCounts = 0;
            const allSeenTaskIds = new Set<string>();

            for (const member of activeMembers) {
              const tasksForDev = analyzer.getTasksByDeveloper(member.id);
              
              for (const task of tasksForDev) {
                expect(allSeenTaskIds.has(task.id)).toBe(false); // No duplicates
                allSeenTaskIds.add(task.id);
              }

              const statusCountsResult = analyzer.getTaskCountByStatus(member.id);
              if (statusCountsResult.success) {
                const total = Object.values(statusCountsResult.value).reduce((a, b) => a + b, 0);
                expect(total).toBe(tasksForDev.length);
                sumOfAllCounts += total;
              }
            }

            // Total should equal number of assigned tasks
            expect(sumOfAllCounts).toBe(tasks.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: multi-developer-support, Property 12: Bottleneck Detection Threshold**
   * 
   * *For any* developer, the Workload_Analyzer SHALL identify them as a bottleneck 
   * if and only if they have more than 3 tasks in IN_PROGRESS or BLOCKED status combined.
   * 
   * **Validates: Requirements 10.1, 10.2**
   */
  describe('Property 12: Bottleneck Detection Threshold', () => {
    let taskStorage: InMemoryTaskStorageForWorkload;
    let teamStorage: InMemoryTeamStorageForWorkload;

    beforeEach(() => {
      taskStorage = new InMemoryTaskStorageForWorkload();
      teamStorage = new InMemoryTeamStorageForWorkload();
    });

    /**
     * Creates an analyzer with a specific bottleneck threshold.
     */
    const createAnalyzerWithThreshold = (threshold: number = DEFAULT_BOTTLENECK_THRESHOLD) => {
      return new InMemoryWorkloadAnalyzer(taskStorage, teamStorage, threshold);
    };

    /**
     * Generates tasks with specific active task counts for a developer.
     * Active tasks are those with IN_PROGRESS or BLOCKED status.
     */
    const tasksWithActiveCountArb = (
      developerId: string,
      inProgressCount: number,
      blockedCount: number,
      otherTasksCount: number
    ): fc.Arbitrary<TaskForWorkload[]> => {
      // Generate additional non-active tasks with random statuses
      const nonActiveStatuses: TaskStatusForWorkload[] = ['TODO', 'READY', 'VERIFY', 'DONE'];
      
      return fc.array(
        fc.constantFrom(...nonActiveStatuses),
        { minLength: otherTasksCount, maxLength: otherTasksCount }
      ).map(otherStatuses => {
        const tasks: TaskForWorkload[] = [];
        let taskIndex = 0;

        // Add IN_PROGRESS tasks
        for (let i = 0; i < inProgressCount; i++) {
          tasks.push({
            id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
            title: `In Progress Task ${taskIndex}`,
            status: 'IN_PROGRESS',
            assignee: developerId,
          });
          taskIndex++;
        }

        // Add BLOCKED tasks
        for (let i = 0; i < blockedCount; i++) {
          tasks.push({
            id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
            title: `Blocked Task ${taskIndex}`,
            status: 'BLOCKED',
            assignee: developerId,
          });
          taskIndex++;
        }

        // Add other non-active tasks
        for (const status of otherStatuses) {
          tasks.push({
            id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
            title: `Other Task ${taskIndex}`,
            status,
            assignee: developerId,
          });
          taskIndex++;
        }

        return tasks;
      });
    };

    it('should identify developers with >3 active tasks as bottlenecks (default threshold)', () => {
      /**
       * Property: Developers with more than DEFAULT_BOTTLENECK_THRESHOLD (3) tasks
       * in IN_PROGRESS or BLOCKED status MUST be identified as bottlenecks.
       * 
       * **Validates: Requirements 10.1**
       */
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          // Generate active task counts where total > 3
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 0, max: 5 }),
          (member, inProgressCount, blockedCount, otherTasksCount) => {
            // Only test cases where total active > threshold
            const totalActive = inProgressCount + blockedCount;
            if (totalActive <= DEFAULT_BOTTLENECK_THRESHOLD) return;

            taskStorage.clear();
            teamStorage.clear();

            // Add member as ACTIVE
            const activeMember = { ...member, status: 'ACTIVE' as const };
            teamStorage.addMember(activeMember);

            // Create and add tasks
            let taskIndex = 0;
            
            // Add IN_PROGRESS tasks
            for (let i = 0; i < inProgressCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `In Progress Task ${taskIndex}`,
                status: 'IN_PROGRESS',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add BLOCKED tasks
            for (let i = 0; i < blockedCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Blocked Task ${taskIndex}`,
                status: 'BLOCKED',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add other non-active tasks
            const nonActiveStatuses: TaskStatusForWorkload[] = ['TODO', 'READY', 'VERIFY', 'DONE'];
            for (let i = 0; i < otherTasksCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Other Task ${taskIndex}`,
                status: nonActiveStatuses[i % nonActiveStatuses.length],
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            const analyzer = createAnalyzerWithThreshold(DEFAULT_BOTTLENECK_THRESHOLD);

            // Get developer workload and check isOverloaded flag
            const workloadResult = analyzer.getDeveloperWorkload(activeMember.id);
            expect(workloadResult.success).toBe(true);
            
            if (workloadResult.success) {
              // Verify active task count is correct
              expect(workloadResult.value.metrics.activeTasks).toBe(totalActive);
              
              // Property 12: Developer with >3 active tasks MUST be marked as overloaded
              expect(workloadResult.value.isOverloaded).toBe(true);
            }

            // Also verify via getWorkloadDistribution
            const distributionResult = analyzer.getWorkloadDistribution();
            expect(distributionResult.success).toBe(true);
            
            if (distributionResult.success) {
              // Developer should be in overloadedDeveloperIds
              expect(distributionResult.value.overloadedDeveloperIds).toContain(activeMember.id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT identify developers with ≤3 active tasks as bottlenecks (default threshold)', () => {
      /**
       * Property: Developers with 3 or fewer tasks in IN_PROGRESS or BLOCKED status
       * MUST NOT be identified as bottlenecks.
       * 
       * **Validates: Requirements 10.1**
       */
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          // Generate active task counts where total <= 3
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 10 }),
          (member, inProgressCount, blockedCount, otherTasksCount) => {
            // Only test cases where total active <= threshold
            const totalActive = inProgressCount + blockedCount;
            if (totalActive > DEFAULT_BOTTLENECK_THRESHOLD) return;

            taskStorage.clear();
            teamStorage.clear();

            // Add member as ACTIVE
            const activeMember = { ...member, status: 'ACTIVE' as const };
            teamStorage.addMember(activeMember);

            // Create and add tasks
            let taskIndex = 0;
            
            // Add IN_PROGRESS tasks
            for (let i = 0; i < inProgressCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `In Progress Task ${taskIndex}`,
                status: 'IN_PROGRESS',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add BLOCKED tasks
            for (let i = 0; i < blockedCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Blocked Task ${taskIndex}`,
                status: 'BLOCKED',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add other non-active tasks (these should NOT affect bottleneck status)
            const nonActiveStatuses: TaskStatusForWorkload[] = ['TODO', 'READY', 'VERIFY', 'DONE'];
            for (let i = 0; i < otherTasksCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Other Task ${taskIndex}`,
                status: nonActiveStatuses[i % nonActiveStatuses.length],
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            const analyzer = createAnalyzerWithThreshold(DEFAULT_BOTTLENECK_THRESHOLD);

            // Get developer workload and check isOverloaded flag
            const workloadResult = analyzer.getDeveloperWorkload(activeMember.id);
            expect(workloadResult.success).toBe(true);
            
            if (workloadResult.success) {
              // Verify active task count is correct
              expect(workloadResult.value.metrics.activeTasks).toBe(totalActive);
              
              // Property 12: Developer with ≤3 active tasks MUST NOT be marked as overloaded
              expect(workloadResult.value.isOverloaded).toBe(false);
            }

            // Also verify via getWorkloadDistribution
            const distributionResult = analyzer.getWorkloadDistribution();
            expect(distributionResult.success).toBe(true);
            
            if (distributionResult.success) {
              // Developer should NOT be in overloadedDeveloperIds
              expect(distributionResult.value.overloadedDeveloperIds).not.toContain(activeMember.id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly apply bottleneck detection at exact threshold boundary', () => {
      /**
       * Property: Bottleneck detection MUST be strictly "greater than threshold",
       * meaning exactly 3 active tasks is NOT a bottleneck, but 4 is.
       * 
       * **Validates: Requirements 10.1**
       */
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          // Test boundary: generate exactly 3 or 4 active tasks
          fc.constantFrom(3, 4),
          fc.integer({ min: 0, max: 5 }),
          (member, exactActiveCount, otherTasksCount) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add member as ACTIVE
            const activeMember = { ...member, status: 'ACTIVE' as const };
            teamStorage.addMember(activeMember);

            // Distribute active tasks between IN_PROGRESS and BLOCKED
            const inProgressCount = Math.floor(exactActiveCount / 2);
            const blockedCount = exactActiveCount - inProgressCount;

            let taskIndex = 0;
            
            // Add IN_PROGRESS tasks
            for (let i = 0; i < inProgressCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `In Progress Task ${taskIndex}`,
                status: 'IN_PROGRESS',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add BLOCKED tasks
            for (let i = 0; i < blockedCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Blocked Task ${taskIndex}`,
                status: 'BLOCKED',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add other non-active tasks
            const nonActiveStatuses: TaskStatusForWorkload[] = ['TODO', 'READY', 'VERIFY', 'DONE'];
            for (let i = 0; i < otherTasksCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Other Task ${taskIndex}`,
                status: nonActiveStatuses[i % nonActiveStatuses.length],
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            const analyzer = createAnalyzerWithThreshold(DEFAULT_BOTTLENECK_THRESHOLD);
            const workloadResult = analyzer.getDeveloperWorkload(activeMember.id);
            
            expect(workloadResult.success).toBe(true);
            
            if (workloadResult.success) {
              expect(workloadResult.value.metrics.activeTasks).toBe(exactActiveCount);
              
              // Property 12: >3 is bottleneck, =3 is NOT
              const expectedIsOverloaded = exactActiveCount > DEFAULT_BOTTLENECK_THRESHOLD;
              expect(workloadResult.value.isOverloaded).toBe(expectedIsOverloaded);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly identify all bottlenecks in team when multiple developers exceed threshold', () => {
      /**
       * Property: When multiple developers exceed the bottleneck threshold,
       * ALL of them MUST be identified as bottlenecks.
       * 
       * **Validates: Requirements 10.1, 10.2**
       */
      fc.assert(
        fc.property(
          uniqueTeamMembersArb(3, 8),
          // Array of active task counts for each member
          fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 3, maxLength: 8 }),
          (members, activeTaskCounts) => {
            taskStorage.clear();
            teamStorage.clear();

            // Ensure all members are active and have unique IDs
            const activeMembers = members.map((m, idx) => ({
              ...m,
              id: `dev-${idx}`,
              status: 'ACTIVE' as const,
            }));

            // Add all members
            for (const member of activeMembers) {
              teamStorage.addMember(member);
            }

            // Track which developers should be bottlenecks
            const expectedBottleneckIds: string[] = [];
            let taskIndex = 0;

            // Add tasks for each developer
            activeMembers.forEach((member, memberIdx) => {
              const activeCount = activeTaskCounts[memberIdx % activeTaskCounts.length];
              
              if (activeCount > DEFAULT_BOTTLENECK_THRESHOLD) {
                expectedBottleneckIds.push(member.id);
              }

              // Distribute between IN_PROGRESS and BLOCKED
              const inProgressCount = Math.ceil(activeCount / 2);
              const blockedCount = activeCount - inProgressCount;

              // Add IN_PROGRESS tasks
              for (let i = 0; i < inProgressCount; i++) {
                taskStorage.addTask({
                  id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                  title: `In Progress Task ${taskIndex}`,
                  status: 'IN_PROGRESS',
                  assignee: member.id,
                });
                taskIndex++;
              }

              // Add BLOCKED tasks
              for (let i = 0; i < blockedCount; i++) {
                taskStorage.addTask({
                  id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                  title: `Blocked Task ${taskIndex}`,
                  status: 'BLOCKED',
                  assignee: member.id,
                });
                taskIndex++;
              }

              // Add some non-active tasks
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Done Task ${taskIndex}`,
                status: 'DONE',
                assignee: member.id,
              });
              taskIndex++;
            });

            const analyzer = createAnalyzerWithThreshold(DEFAULT_BOTTLENECK_THRESHOLD);
            const distributionResult = analyzer.getWorkloadDistribution();
            
            expect(distributionResult.success).toBe(true);
            
            if (distributionResult.success) {
              const actualBottleneckIds = distributionResult.value.overloadedDeveloperIds;
              
              // All expected bottlenecks should be identified
              for (const expectedId of expectedBottleneckIds) {
                expect(actualBottleneckIds).toContain(expectedId);
              }

              // No false positives - only expected bottlenecks should be identified
              for (const actualId of actualBottleneckIds) {
                expect(expectedBottleneckIds).toContain(actualId);
              }

              // Same count
              expect(actualBottleneckIds.length).toBe(expectedBottleneckIds.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should support custom threshold values for bottleneck detection', () => {
      /**
       * Property: Custom threshold values MUST be respected for bottleneck detection.
       * A developer is a bottleneck if and only if activeTasks > customThreshold.
       * 
       * **Validates: Requirements 10.1**
       */
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          // Custom threshold (1-10)
          fc.integer({ min: 1, max: 10 }),
          // Active task count (0-15)
          fc.integer({ min: 0, max: 15 }),
          fc.integer({ min: 0, max: 5 }),
          (member, customThreshold, activeTaskCount, otherTasksCount) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add member as ACTIVE
            const activeMember = { ...member, status: 'ACTIVE' as const };
            teamStorage.addMember(activeMember);

            // Distribute active tasks between IN_PROGRESS and BLOCKED
            const inProgressCount = Math.ceil(activeTaskCount / 2);
            const blockedCount = activeTaskCount - inProgressCount;

            let taskIndex = 0;
            
            // Add IN_PROGRESS tasks
            for (let i = 0; i < inProgressCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `In Progress Task ${taskIndex}`,
                status: 'IN_PROGRESS',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add BLOCKED tasks
            for (let i = 0; i < blockedCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Blocked Task ${taskIndex}`,
                status: 'BLOCKED',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add other non-active tasks
            const nonActiveStatuses: TaskStatusForWorkload[] = ['TODO', 'READY', 'VERIFY', 'DONE'];
            for (let i = 0; i < otherTasksCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Other Task ${taskIndex}`,
                status: nonActiveStatuses[i % nonActiveStatuses.length],
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Use custom threshold
            const analyzer = createAnalyzerWithThreshold(customThreshold);
            const workloadResult = analyzer.getDeveloperWorkload(activeMember.id);
            
            expect(workloadResult.success).toBe(true);
            
            if (workloadResult.success) {
              expect(workloadResult.value.metrics.activeTasks).toBe(activeTaskCount);
              
              // Property: isOverloaded should be true if and only if activeTasks > customThreshold
              const expectedIsOverloaded = activeTaskCount > customThreshold;
              expect(workloadResult.value.isOverloaded).toBe(expectedIsOverloaded);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should only count IN_PROGRESS and BLOCKED tasks for bottleneck detection', () => {
      /**
       * Property: Only IN_PROGRESS and BLOCKED tasks contribute to bottleneck detection.
       * Tasks in TODO, READY, VERIFY, or DONE status MUST NOT affect bottleneck status.
       * 
       * **Validates: Requirements 10.1**
       */
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          // Few active tasks (≤3)
          fc.integer({ min: 0, max: 3 }),
          // Many non-active tasks
          fc.integer({ min: 10, max: 30 }),
          (member, activeTaskCount, nonActiveTaskCount) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add member as ACTIVE
            const activeMember = { ...member, status: 'ACTIVE' as const };
            teamStorage.addMember(activeMember);

            let taskIndex = 0;
            
            // Add active tasks (split between IN_PROGRESS and BLOCKED)
            const inProgressCount = Math.ceil(activeTaskCount / 2);
            const blockedCount = activeTaskCount - inProgressCount;

            for (let i = 0; i < inProgressCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `In Progress Task ${taskIndex}`,
                status: 'IN_PROGRESS',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            for (let i = 0; i < blockedCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Blocked Task ${taskIndex}`,
                status: 'BLOCKED',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add MANY non-active tasks (should NOT cause bottleneck)
            const nonActiveStatuses: TaskStatusForWorkload[] = ['TODO', 'READY', 'VERIFY', 'DONE'];
            for (let i = 0; i < nonActiveTaskCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Non-Active Task ${taskIndex}`,
                status: nonActiveStatuses[i % nonActiveStatuses.length],
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            const analyzer = createAnalyzerWithThreshold(DEFAULT_BOTTLENECK_THRESHOLD);
            const workloadResult = analyzer.getDeveloperWorkload(activeMember.id);
            
            expect(workloadResult.success).toBe(true);
            
            if (workloadResult.success) {
              // Verify active count only includes IN_PROGRESS and BLOCKED
              expect(workloadResult.value.metrics.activeTasks).toBe(activeTaskCount);
              
              // Verify total tasks includes all tasks
              expect(workloadResult.value.metrics.totalTasks).toBe(activeTaskCount + nonActiveTaskCount);
              
              // Property: With ≤3 active tasks, should NOT be a bottleneck
              // regardless of how many non-active tasks exist
              expect(workloadResult.value.isOverloaded).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle developers with zero active tasks as non-bottlenecks', () => {
      /**
       * Property: Developers with zero active tasks (IN_PROGRESS + BLOCKED = 0)
       * MUST NOT be identified as bottlenecks, regardless of other task counts.
       * 
       * **Validates: Requirements 10.1**
       */
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          // Distribution of non-active tasks
          fc.record({
            todoCount: fc.integer({ min: 0, max: 10 }),
            readyCount: fc.integer({ min: 0, max: 10 }),
            verifyCount: fc.integer({ min: 0, max: 10 }),
            doneCount: fc.integer({ min: 0, max: 10 }),
          }),
          (member, taskDistribution) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add member as ACTIVE
            const activeMember = { ...member, status: 'ACTIVE' as const };
            teamStorage.addMember(activeMember);

            let taskIndex = 0;

            // Add ONLY non-active tasks (no IN_PROGRESS or BLOCKED)
            const statusMapping: [TaskStatusForWorkload, number][] = [
              ['TODO', taskDistribution.todoCount],
              ['READY', taskDistribution.readyCount],
              ['VERIFY', taskDistribution.verifyCount],
              ['DONE', taskDistribution.doneCount],
            ];

            for (const [status, count] of statusMapping) {
              for (let i = 0; i < count; i++) {
                taskStorage.addTask({
                  id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                  title: `Task ${taskIndex}`,
                  status,
                  assignee: activeMember.id,
                });
                taskIndex++;
              }
            }

            const analyzer = createAnalyzerWithThreshold(DEFAULT_BOTTLENECK_THRESHOLD);
            const workloadResult = analyzer.getDeveloperWorkload(activeMember.id);
            
            expect(workloadResult.success).toBe(true);
            
            if (workloadResult.success) {
              // Zero active tasks
              expect(workloadResult.value.metrics.activeTasks).toBe(0);
              expect(workloadResult.value.metrics.tasksByStatus.IN_PROGRESS).toBe(0);
              expect(workloadResult.value.metrics.tasksByStatus.BLOCKED).toBe(0);
              
              // Property: Zero active tasks means NOT a bottleneck
              expect(workloadResult.value.isOverloaded).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain bottleneck detection consistency across multiple queries', () => {
      /**
       * Property: Bottleneck detection MUST be deterministic - the same developer
       * with the same tasks MUST always yield the same bottleneck status.
       * 
       * **Validates: Requirements 10.1**
       */
      fc.assert(
        fc.property(
          teamMemberForWorkloadArb,
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 2, max: 5 }),
          (member, inProgressCount, blockedCount, queryCount) => {
            taskStorage.clear();
            teamStorage.clear();

            // Add member as ACTIVE
            const activeMember = { ...member, status: 'ACTIVE' as const };
            teamStorage.addMember(activeMember);

            let taskIndex = 0;

            // Add IN_PROGRESS tasks
            for (let i = 0; i < inProgressCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `In Progress Task ${taskIndex}`,
                status: 'IN_PROGRESS',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            // Add BLOCKED tasks
            for (let i = 0; i < blockedCount; i++) {
              taskStorage.addTask({
                id: `TASK-${String(taskIndex + 100).padStart(3, '0')}`,
                title: `Blocked Task ${taskIndex}`,
                status: 'BLOCKED',
                assignee: activeMember.id,
              });
              taskIndex++;
            }

            const analyzer = createAnalyzerWithThreshold(DEFAULT_BOTTLENECK_THRESHOLD);
            
            // Get first result
            const firstResult = analyzer.getDeveloperWorkload(activeMember.id);
            expect(firstResult.success).toBe(true);
            
            if (!firstResult.success) return;
            
            const expectedIsOverloaded = firstResult.value.isOverloaded;
            const expectedActiveTasks = firstResult.value.metrics.activeTasks;

            // Query multiple times and verify consistency
            for (let i = 0; i < queryCount; i++) {
              const result = analyzer.getDeveloperWorkload(activeMember.id);
              expect(result.success).toBe(true);
              
              if (result.success) {
                // Property: Same query should yield identical results
                expect(result.value.isOverloaded).toBe(expectedIsOverloaded);
                expect(result.value.metrics.activeTasks).toBe(expectedActiveTasks);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
