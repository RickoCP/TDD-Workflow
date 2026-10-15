/**
 * Property-Based Tests for Task_Assigner
 * 
 * **Feature: multi-developer-support, Property 3: Assignment Role Constraint**
 * 
 * These tests verify the universal correctness properties of the Task_Assigner component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements 3.3, 3.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  Assignment,
  AssignmentError,
  AssignmentErrorCode,
  Task,
  TaskStatus,
  TASK_STATUSES,
  ASSIGNABLE_STATUSES,
  AssignmentHistoryEntry,
  Result,
  ok,
  err,
  createAssignment,
  createHistoryEntry,
  developerNotFoundError,
  roleMismatchError,
  taskAlreadyAssignedError,
  taskNotAssignableError,
  taskNotFoundError,
  Role,
  VALID_ROLES,
  isValidRole,
} from '../task-assigner';
import {
  TeamMember,
  TeamError,
  TeamErrorCode,
  createTeamMember,
  memberNotFoundError,
  invalidRoleError,
  noRolesSpecifiedError,
  duplicateMemberIdError,
  isValidDeveloperId,
} from '../team-manager';

// =============================================================================
// In-Memory Team_Manager Implementation for Testing
// =============================================================================

/**
 * In-memory implementation of Team_Manager for testing purposes.
 */
class InMemoryTeamManager {
  private members: Map<string, TeamMember> = new Map();

  registerMember(member: TeamMember): Result<void, TeamError> {
    if (!member.roles || member.roles.length === 0) {
      return err(noRolesSpecifiedError(member.id));
    }
    for (const role of member.roles) {
      if (!isValidRole(role)) {
        return err(invalidRoleError(role));
      }
    }
    if (this.members.has(member.id)) {
      return err(duplicateMemberIdError(member.id));
    }
    this.members.set(member.id, { ...member });
    return ok(undefined);
  }

  getMember(developerId: string): Result<TeamMember, TeamError> {
    const member = this.members.get(developerId);
    if (!member) {
      return err(memberNotFoundError(developerId));
    }
    return ok({ ...member });
  }

  listMembers(): TeamMember[] {
    return Array.from(this.members.values());
  }

  validateDeveloperId(developerId: string): boolean {
    return this.members.has(developerId);
  }

  clear(): void {
    this.members.clear();
  }

  get size(): number {
    return this.members.size;
  }
}

// =============================================================================
// In-Memory Task_Assigner Implementation for Testing
// =============================================================================

/**
 * In-memory implementation of Task_Assigner for testing purposes.
 * This implementation follows the interface defined in task-assigner.ts
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 16.1, 16.2, 16.3
 */
class InMemoryTaskAssigner {
  private tasks: Map<string, Task> = new Map();
  private teamManager: InMemoryTeamManager;

  constructor(teamManager: InMemoryTeamManager) {
    this.teamManager = teamManager;
  }

  /**
   * Adds a task to the task store (for testing setup).
   */
  addTask(task: Task): void {
    this.tasks.set(task.id, { ...task, assignment_history: task.assignment_history || [] });
  }

  /**
   * Assigns a task to a specific developer.
   * 
   * Requirements: 3.1, 3.3, 3.4, 4.1, 4.3
   */
  assignTask(taskId: string, developerId: string): Result<Assignment, AssignmentError> {
    // Check task exists
    const task = this.tasks.get(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Check task is in assignable state
    if (!ASSIGNABLE_STATUSES.includes(task.status as typeof ASSIGNABLE_STATUSES[number])) {
      return err(taskNotAssignableError(taskId, task.status));
    }

    // Check task is not already assigned
    if (task.assignment?.assignee) {
      return err(taskAlreadyAssignedError(taskId, task.assignment.assignee));
    }

    // Requirement 4.1: Check developer exists
    const memberResult = this.teamManager.getMember(developerId);
    if (!memberResult.success) {
      return err(developerNotFoundError(developerId, taskId));
    }
    const member = memberResult.value;

    // Requirements 3.3, 3.4: Check role constraint
    const roleRequired = task.assignment?.role_required;
    if (roleRequired) {
      if (!member.roles.includes(roleRequired)) {
        return err(roleMismatchError(developerId, roleRequired, member.roles, taskId));
      }
    }

    // Create assignment
    const previousAssignee = task.assignment?.assignee || null;
    const assignment = createAssignment(
      taskId,
      developerId,
      roleRequired || null,
      null // assigned_by could be tracked if needed
    );

    // Record history
    const historyEntry = createHistoryEntry(
      previousAssignee,
      developerId,
      'Task assigned'
    );

    // Update task
    task.assignment = assignment;
    task.assignment_history.push(historyEntry);

    return ok(assignment);
  }

  /**
   * Validates whether a task can be assigned to a developer.
   * 
   * Requirements: 3.3, 3.4, 4.1, 4.2
   */
  validateAssignment(taskId: string, developerId: string): Result<void, AssignmentError> {
    // Check task exists
    const task = this.tasks.get(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Check task is in assignable state
    if (!ASSIGNABLE_STATUSES.includes(task.status as typeof ASSIGNABLE_STATUSES[number])) {
      return err(taskNotAssignableError(taskId, task.status));
    }

    // Requirement 4.1: Check developer exists
    const memberResult = this.teamManager.getMember(developerId);
    if (!memberResult.success) {
      return err(developerNotFoundError(developerId, taskId));
    }
    const member = memberResult.value;

    // Requirements 3.3, 3.4: Check role constraint
    const roleRequired = task.assignment?.role_required;
    if (roleRequired) {
      if (!member.roles.includes(roleRequired)) {
        return err(roleMismatchError(developerId, roleRequired, member.roles, taskId));
      }
    }

    return ok(undefined);
  }

  /**
   * Allows a developer to pick up an unassigned task with a matching role.
   * 
   * Requirements: 3.5, 3.6
   */
  pickupTask(taskId: string, developerId: string): Result<Assignment, AssignmentError> {
    // Use same logic as assignTask - role constraint applies equally
    return this.assignTask(taskId, developerId);
  }

  /**
   * Gets a task by ID.
   */
  getTask(taskId: string): Task | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Gets assignment history for a task.
   */
  getAssignmentHistory(taskId: string): AssignmentHistoryEntry[] {
    const task = this.tasks.get(taskId);
    return task?.assignment_history || [];
  }

  /**
   * Clears all tasks (for test reset).
   */
  clear(): void {
    this.tasks.clear();
  }

  /**
   * Gets the count of tasks.
   */
  get size(): number {
    return this.tasks.size;
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
 * Generates a valid TeamMember object.
 */
const teamMemberArb: fc.Arbitrary<TeamMember> = fc.record({
  id: developerIdArb,
  name: developerNameArb,
  roles: validRolesArrayArb,
  registered_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map(d => d.toISOString()),
  status: fc.constantFrom('ACTIVE' as const, 'INACTIVE' as const),
});

/**
 * Generates an assignable task status.
 */
const assignableStatusArb: fc.Arbitrary<TaskStatus> = fc.constantFrom(
  'TODO' as TaskStatus,
  'READY' as TaskStatus,
  'BLOCKED' as TaskStatus
);

/**
 * Generates a non-assignable task status.
 */
const nonAssignableStatusArb: fc.Arbitrary<TaskStatus> = fc.constantFrom(
  'IN_PROGRESS' as TaskStatus,
  'VERIFY' as TaskStatus,
  'DONE' as TaskStatus
);

/**
 * Generates a task with optional role_required.
 */
const taskWithOptionalRoleArb = (roleRequired: Role | null): fc.Arbitrary<Task> => {
  return fc.record({
    id: taskIdArb,
    title: taskTitleArb,
    status: assignableStatusArb,
    assignment: fc.constant(roleRequired ? {
      taskId: '', // Will be set later
      assignee: null,
      role_required: roleRequired,
      assigned_at: '',
      assigned_by: null,
      state: 'AVAILABLE_FOR_PICKUP' as const,
    } : undefined),
    assignment_history: fc.constant([]),
  }).map(task => {
    if (task.assignment) {
      task.assignment.taskId = task.id;
    }
    return task;
  });
};

/**
 * Generates a task with a specific role_required.
 */
const taskWithRoleRequiredArb: fc.Arbitrary<{ task: Task; roleRequired: Role }> = fc.record({
  id: taskIdArb,
  title: taskTitleArb,
  status: assignableStatusArb,
  roleRequired: validRoleArb,
}).map(data => ({
  task: {
    id: data.id,
    title: data.title,
    status: data.status,
    assignment: {
      taskId: data.id,
      assignee: null,
      role_required: data.roleRequired,
      assigned_at: '',
      assigned_by: null,
      state: 'AVAILABLE_FOR_PICKUP' as const,
    },
    assignment_history: [],
  },
  roleRequired: data.roleRequired,
}));

/**
 * Generates a team member with specific roles.
 */
const teamMemberWithRolesArb = (roles: Role[]): fc.Arbitrary<TeamMember> => {
  return fc.record({
    id: developerIdArb,
    name: developerNameArb,
    registered_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
      .map(d => d.toISOString()),
    status: fc.constantFrom('ACTIVE' as const, 'INACTIVE' as const),
  }).map(member => ({
    ...member,
    roles,
  }));
};

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('Task_Assigner Property-Based Tests', () => {
  /**
   * **Feature: multi-developer-support, Property 3: Assignment Role Constraint**
   * 
   * *For any* task with a role_required field and an assignee field, the assignee's
   * roles SHALL include the role_required value, or the assignment SHALL be rejected.
   * 
   * **Validates: Requirements 3.3, 3.4**
   */
  describe('Property 3: Assignment Role Constraint', () => {
    let teamManager: InMemoryTeamManager;
    let taskAssigner: InMemoryTaskAssigner;

    beforeEach(() => {
      teamManager = new InMemoryTeamManager();
      taskAssigner = new InMemoryTaskAssigner(teamManager);
    });

    it('should accept assignment when developer has the required role', () => {
      fc.assert(
        fc.property(
          taskWithRoleRequiredArb,
          teamMemberArb,
          ({ task, roleRequired }, memberBase) => {
            teamManager.clear();
            taskAssigner.clear();

            // Create a member that HAS the required role
            const memberWithRole: TeamMember = {
              ...memberBase,
              roles: memberBase.roles.includes(roleRequired) 
                ? memberBase.roles 
                : [...memberBase.roles, roleRequired],
            };

            // Register member
            const registerResult = teamManager.registerMember(memberWithRole);
            expect(registerResult.success).toBe(true);

            // Add task
            taskAssigner.addTask(task);

            // Assignment should succeed because developer has the required role
            const assignResult = taskAssigner.assignTask(task.id, memberWithRole.id);
            expect(assignResult.success).toBe(true);

            if (assignResult.success) {
              expect(assignResult.value.assignee).toBe(memberWithRole.id);
              expect(assignResult.value.taskId).toBe(task.id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject assignment when developer lacks the required role', () => {
      fc.assert(
        fc.property(
          taskWithRoleRequiredArb,
          fc.uniqueArray(validRoleArb, { minLength: 1, maxLength: 3 }),
          developerIdArb,
          developerNameArb,
          ({ task, roleRequired }, memberRoles, devId, devName) => {
            teamManager.clear();
            taskAssigner.clear();

            // Filter out the required role to ensure member doesn't have it
            const rolesWithoutRequired = memberRoles.filter(r => r !== roleRequired);
            
            // If all roles were filtered out, use a different role
            const finalRoles = rolesWithoutRequired.length > 0 
              ? rolesWithoutRequired 
              : [VALID_ROLES.find(r => r !== roleRequired) as Role];

            const memberWithoutRole: TeamMember = {
              id: devId,
              name: devName,
              roles: finalRoles,
              registered_at: new Date().toISOString(),
              status: 'ACTIVE',
            };

            // Register member
            const registerResult = teamManager.registerMember(memberWithoutRole);
            expect(registerResult.success).toBe(true);

            // Add task
            taskAssigner.addTask(task);

            // Assignment should fail with ROLE_MISMATCH error (code 1102)
            const assignResult = taskAssigner.assignTask(task.id, memberWithoutRole.id);
            expect(assignResult.success).toBe(false);

            if (!assignResult.success) {
              expect(assignResult.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
              expect(assignResult.error.category).toBe('ASSIGNMENT_ERROR');
              expect(assignResult.error.context?.developer_id).toBe(memberWithoutRole.id);
              expect(assignResult.error.context?.required_role).toBe(roleRequired);
              expect(assignResult.error.context?.developer_roles).toEqual(finalRoles);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept assignment when task has no role_required constraint', () => {
      fc.assert(
        fc.property(
          taskIdArb,
          taskTitleArb,
          assignableStatusArb,
          teamMemberArb,
          (taskId, title, status, member) => {
            teamManager.clear();
            taskAssigner.clear();

            // Create task without role_required
            const taskWithoutRoleRequired: Task = {
              id: taskId,
              title,
              status,
              assignment_history: [],
            };

            // Register member (any roles are fine since no constraint)
            const registerResult = teamManager.registerMember(member);
            expect(registerResult.success).toBe(true);

            // Add task
            taskAssigner.addTask(taskWithoutRoleRequired);

            // Assignment should succeed regardless of member's roles
            const assignResult = taskAssigner.assignTask(taskId, member.id);
            expect(assignResult.success).toBe(true);

            if (assignResult.success) {
              expect(assignResult.value.assignee).toBe(member.id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should consistently reject role mismatch across multiple assignment attempts', () => {
      fc.assert(
        fc.property(
          taskWithRoleRequiredArb,
          fc.array(teamMemberArb, { minLength: 2, maxLength: 5 }),
          ({ task, roleRequired }, members) => {
            teamManager.clear();
            taskAssigner.clear();

            // Ensure unique IDs for members
            const uniqueMembers = members.map((m, i) => ({
              ...m,
              id: `${m.id}-${i}`,
            }));

            // Register all members
            for (const member of uniqueMembers) {
              teamManager.registerMember(member);
            }

            // Add task
            taskAssigner.addTask(task);

            // Try to assign to each member - track results
            for (const member of uniqueMembers) {
              // Create a fresh copy of the task for each attempt
              taskAssigner.clear();
              const freshTask = { ...task, assignment_history: [] };
              taskAssigner.addTask(freshTask);

              const hasRequiredRole = member.roles.includes(roleRequired);
              const assignResult = taskAssigner.assignTask(task.id, member.id);

              if (hasRequiredRole) {
                expect(assignResult.success).toBe(true);
              } else {
                expect(assignResult.success).toBe(false);
                if (!assignResult.success) {
                  expect(assignResult.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle multi-role developers correctly', () => {
      fc.assert(
        fc.property(
          taskWithRoleRequiredArb,
          fc.uniqueArray(validRoleArb, { minLength: 1, maxLength: 5 }),
          developerIdArb,
          developerNameArb,
          ({ task, roleRequired }, allRoles, devId, devName) => {
            teamManager.clear();
            taskAssigner.clear();

            // Create a member with multiple roles
            const memberWithMultipleRoles: TeamMember = {
              id: devId,
              name: devName,
              roles: allRoles.length > 0 ? allRoles : [validRoleArb.generate(fc.random(Date.now())).value],
              registered_at: new Date().toISOString(),
              status: 'ACTIVE',
            };

            // Register member
            const registerResult = teamManager.registerMember(memberWithMultipleRoles);
            expect(registerResult.success).toBe(true);

            // Add task
            taskAssigner.addTask(task);

            // Check if member has the required role
            const hasRequiredRole = memberWithMultipleRoles.roles.includes(roleRequired);
            const assignResult = taskAssigner.assignTask(task.id, memberWithMultipleRoles.id);

            if (hasRequiredRole) {
              // Should succeed - developer has the required role among their roles
              expect(assignResult.success).toBe(true);
            } else {
              // Should fail - developer doesn't have the required role
              expect(assignResult.success).toBe(false);
              if (!assignResult.success) {
                expect(assignResult.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate assignment before actual assignment and return same result', () => {
      fc.assert(
        fc.property(
          taskWithRoleRequiredArb,
          teamMemberArb,
          ({ task, roleRequired }, memberBase) => {
            teamManager.clear();
            taskAssigner.clear();

            // Register member
            const registerResult = teamManager.registerMember(memberBase);
            expect(registerResult.success).toBe(true);

            // Add task
            taskAssigner.addTask(task);

            // Validate assignment
            const validateResult = taskAssigner.validateAssignment(task.id, memberBase.id);
            
            // Actual assignment
            const assignResult = taskAssigner.assignTask(task.id, memberBase.id);

            // Both should have the same success/failure status
            expect(validateResult.success).toBe(assignResult.success);

            // If both failed, they should fail with the same error code
            if (!validateResult.success && !assignResult.success) {
              expect(validateResult.error.code).toBe(assignResult.error.code);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject assignment to non-existent developer with DEVELOPER_NOT_FOUND error (1101)', () => {
      fc.assert(
        fc.property(
          taskWithRoleRequiredArb,
          developerIdArb,
          ({ task }, nonExistentDevId) => {
            teamManager.clear();
            taskAssigner.clear();

            // Add task without registering any developer
            taskAssigner.addTask(task);

            // Assignment should fail with DEVELOPER_NOT_FOUND error
            const assignResult = taskAssigner.assignTask(task.id, nonExistentDevId);
            expect(assignResult.success).toBe(false);

            if (!assignResult.success) {
              expect(assignResult.error.code).toBe(AssignmentErrorCode.DEVELOPER_NOT_FOUND);
              expect(assignResult.error.context?.developer_id).toBe(nonExistentDevId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly report developer roles in ROLE_MISMATCH error', () => {
      fc.assert(
        fc.property(
          taskWithRoleRequiredArb,
          fc.uniqueArray(validRoleArb, { minLength: 1, maxLength: 2 }),
          developerIdArb,
          developerNameArb,
          ({ task, roleRequired }, memberRoles, devId, devName) => {
            teamManager.clear();
            taskAssigner.clear();

            // Ensure member doesn't have the required role
            const rolesWithoutRequired = memberRoles.filter(r => r !== roleRequired);
            const finalRoles = rolesWithoutRequired.length > 0 
              ? rolesWithoutRequired 
              : [VALID_ROLES.find(r => r !== roleRequired) as Role];

            const member: TeamMember = {
              id: devId,
              name: devName,
              roles: finalRoles,
              registered_at: new Date().toISOString(),
              status: 'ACTIVE',
            };

            // Register member
            teamManager.registerMember(member);

            // Add task
            taskAssigner.addTask(task);

            // Assignment should fail
            const assignResult = taskAssigner.assignTask(task.id, member.id);
            expect(assignResult.success).toBe(false);

            if (!assignResult.success) {
              // Error should include the developer's actual roles
              expect(assignResult.error.context?.developer_roles).toBeDefined();
              expect(assignResult.error.context?.developer_roles).toEqual(finalRoles);
              
              // Error should include the required role
              expect(assignResult.error.context?.required_role).toBe(roleRequired);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should enforce role constraint for pickup task operations (Requirements 3.5, 3.6)', () => {
      fc.assert(
        fc.property(
          taskWithRoleRequiredArb,
          teamMemberArb,
          ({ task, roleRequired }, memberBase) => {
            teamManager.clear();
            taskAssigner.clear();

            // Register member
            const registerResult = teamManager.registerMember(memberBase);
            expect(registerResult.success).toBe(true);

            // Add task
            taskAssigner.addTask(task);

            // Check if member has the required role
            const hasRequiredRole = memberBase.roles.includes(roleRequired);
            
            // Pickup task should follow same role constraint as assignment
            const pickupResult = taskAssigner.pickupTask(task.id, memberBase.id);

            if (hasRequiredRole) {
              expect(pickupResult.success).toBe(true);
            } else {
              expect(pickupResult.success).toBe(false);
              if (!pickupResult.success) {
                expect(pickupResult.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain role constraint invariant for any sequence of operations', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              taskId: taskIdArb,
              title: taskTitleArb,
              status: assignableStatusArb,
              roleRequired: fc.option(validRoleArb, { nil: undefined }),
            }),
            { minLength: 3, maxLength: 10 }
          ),
          fc.array(teamMemberArb, { minLength: 2, maxLength: 5 }),
          (taskDefs, members) => {
            teamManager.clear();
            taskAssigner.clear();

            // Ensure unique IDs
            const uniqueMembers = members.map((m, i) => ({
              ...m,
              id: `dev-${i}-${m.id.slice(0, 5)}`,
            }));
            const uniqueTasks = taskDefs.map((t, i) => ({
              ...t,
              taskId: `TASK-${String(i + 100).padStart(3, '0')}`,
            }));

            // Register all members
            for (const member of uniqueMembers) {
              teamManager.registerMember(member);
            }

            // Add all tasks
            for (const taskDef of uniqueTasks) {
              const task: Task = {
                id: taskDef.taskId,
                title: taskDef.title,
                status: taskDef.status,
                assignment: taskDef.roleRequired ? {
                  taskId: taskDef.taskId,
                  assignee: null,
                  role_required: taskDef.roleRequired,
                  assigned_at: '',
                  assigned_by: null,
                  state: 'AVAILABLE_FOR_PICKUP',
                } : undefined,
                assignment_history: [],
              };
              taskAssigner.addTask(task);
            }

            // Try random assignments and verify invariant
            for (const taskDef of uniqueTasks) {
              const randomMember = uniqueMembers[Math.floor(Math.random() * uniqueMembers.length)];
              
              const assignResult = taskAssigner.assignTask(taskDef.taskId, randomMember.id);

              if (taskDef.roleRequired) {
                // Task has role constraint
                if (randomMember.roles.includes(taskDef.roleRequired)) {
                  // Member has required role - should succeed
                  expect(assignResult.success).toBe(true);
                } else {
                  // Member lacks required role - should fail with ROLE_MISMATCH
                  expect(assignResult.success).toBe(false);
                  if (!assignResult.success) {
                    expect(assignResult.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
                  }
                }
              } else {
                // No role constraint - should succeed
                expect(assignResult.success).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should verify all VALID_ROLES can be used as role_required', () => {
      fc.assert(
        fc.property(
          taskIdArb,
          taskTitleArb,
          assignableStatusArb,
          validRoleArb,
          developerIdArb,
          developerNameArb,
          (taskId, title, status, roleRequired, devId, devName) => {
            teamManager.clear();
            taskAssigner.clear();

            // Create task with the role required
            const task: Task = {
              id: taskId,
              title,
              status,
              assignment: {
                taskId,
                assignee: null,
                role_required: roleRequired,
                assigned_at: '',
                assigned_by: null,
                state: 'AVAILABLE_FOR_PICKUP',
              },
              assignment_history: [],
            };

            // Create member WITH the required role
            const memberWithRole: TeamMember = {
              id: devId,
              name: devName,
              roles: [roleRequired],
              registered_at: new Date().toISOString(),
              status: 'ACTIVE',
            };

            // Register member and add task
            teamManager.registerMember(memberWithRole);
            taskAssigner.addTask(task);

            // Assignment should succeed for any valid role
            const assignResult = taskAssigner.assignTask(taskId, memberWithRole.id);
            expect(assignResult.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// =============================================================================
// Extended In-Memory Task_Assigner with Full Assignment Operations
// =============================================================================

/**
 * Extended in-memory implementation of Task_Assigner for Property 11 testing.
 * Supports assign, unassign, and reassign operations with full history tracking.
 * 
 * Requirements: 16.1, 16.2
 */
class InMemoryTaskAssignerWithFullOperations {
  private tasks: Map<string, Task> = new Map();
  private teamManager: InMemoryTeamManager;

  constructor(teamManager: InMemoryTeamManager) {
    this.teamManager = teamManager;
  }

  /**
   * Adds a task to the task store (for testing setup).
   */
  addTask(task: Task): void {
    this.tasks.set(task.id, { 
      ...task, 
      assignment_history: task.assignment_history || [],
      assignment: task.assignment || undefined,
    });
  }

  /**
   * Assigns a task to a specific developer.
   * 
   * Requirements: 16.1 - Records assignment change in history
   */
  assignTask(taskId: string, developerId: string): Result<Assignment, AssignmentError> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Check task is not already assigned
    if (task.assignment?.assignee) {
      return err(taskAlreadyAssignedError(taskId, task.assignment.assignee));
    }

    // Check developer exists
    const memberResult = this.teamManager.getMember(developerId);
    if (!memberResult.success) {
      return err(developerNotFoundError(developerId, taskId));
    }
    const member = memberResult.value;

    // Check role constraint
    const roleRequired = task.assignment?.role_required;
    if (roleRequired && !member.roles.includes(roleRequired)) {
      return err(roleMismatchError(developerId, roleRequired, member.roles, taskId));
    }

    // Create assignment
    const previousAssignee = task.assignment?.assignee || null;
    const assignment = createAssignment(
      taskId,
      developerId,
      roleRequired || null,
      null
    );

    // Requirement 16.1: Record the assignment change in history
    const historyEntry = createHistoryEntry(
      previousAssignee,
      developerId,
      'Task assigned'
    );

    // Update task
    task.assignment = assignment;
    task.assignment_history.push(historyEntry);

    return ok(assignment);
  }

  /**
   * Unassigns a task from its current developer.
   * 
   * Requirements: 16.1 - Records unassignment in history
   */
  unassignTask(taskId: string): Result<void, AssignmentError> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Check task is assigned
    if (!task.assignment?.assignee) {
      return err({
        code: AssignmentErrorCode.TASK_NOT_ASSIGNABLE,
        category: 'ASSIGNMENT_ERROR',
        message: `Task '${taskId}' is not assigned`,
        timestamp: new Date().toISOString(),
      });
    }

    const previousAssignee = task.assignment.assignee;

    // Requirement 16.1: Record the unassignment change in history
    const historyEntry = createHistoryEntry(
      previousAssignee,
      null,
      'Task unassigned'
    );

    // Update assignment to remove assignee
    task.assignment = {
      ...task.assignment,
      assignee: null,
      assigned_at: new Date().toISOString(),
      state: task.assignment.role_required ? 'AVAILABLE_FOR_PICKUP' : 'UNASSIGNED',
    };
    task.assignment_history.push(historyEntry);

    return ok(undefined);
  }

  /**
   * Reassigns a task from one developer to another.
   * 
   * Requirements: 16.1 - Records reassignment in history
   */
  reassignTask(taskId: string, newDeveloperId: string): Result<Assignment, AssignmentError> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err(taskNotFoundError(taskId));
    }

    // Check developer exists
    const memberResult = this.teamManager.getMember(newDeveloperId);
    if (!memberResult.success) {
      return err(developerNotFoundError(newDeveloperId, taskId));
    }
    const member = memberResult.value;

    // Check role constraint
    const roleRequired = task.assignment?.role_required;
    if (roleRequired && !member.roles.includes(roleRequired)) {
      return err(roleMismatchError(newDeveloperId, roleRequired, member.roles, taskId));
    }

    // Get previous assignee (may be null for unassigned tasks)
    const previousAssignee = task.assignment?.assignee || null;

    // Create new assignment
    const assignment = createAssignment(
      taskId,
      newDeveloperId,
      roleRequired || null,
      null
    );

    // Requirement 16.1: Record the reassignment change in history
    const historyEntry = createHistoryEntry(
      previousAssignee,
      newDeveloperId,
      previousAssignee ? 'Task reassigned' : 'Task assigned'
    );

    // Update task
    task.assignment = assignment;
    task.assignment_history.push(historyEntry);

    return ok(assignment);
  }

  /**
   * Gets assignment history for a task.
   * 
   * Requirements: 16.2 - Returns complete assignment history
   */
  getAssignmentHistory(taskId: string): AssignmentHistoryEntry[] {
    const task = this.tasks.get(taskId);
    return task?.assignment_history || [];
  }

  /**
   * Gets a task by ID.
   */
  getTask(taskId: string): Task | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Clears all tasks (for test reset).
   */
  clear(): void {
    this.tasks.clear();
  }
}

// =============================================================================
// Property 11: Assignment History Completeness Tests
// =============================================================================

/**
 * **Feature: multi-developer-support, Property 11: Assignment History Completeness**
 * 
 * *For any* task that has undergone assignment changes, the assignment_history SHALL
 * contain an entry for each change with correct previous_assignee, new_assignee,
 * and timestamp values.
 * 
 * **Validates: Requirements 16.1, 16.2**
 */
describe('Property 11: Assignment History Completeness', () => {
  let teamManager: InMemoryTeamManager;
  let taskAssigner: InMemoryTaskAssignerWithFullOperations;

  beforeEach(() => {
    teamManager = new InMemoryTeamManager();
    taskAssigner = new InMemoryTaskAssignerWithFullOperations(teamManager);
  });

  // =========================================================================
  // Arbitraries for Assignment Operations
  // =========================================================================

  /**
   * Types of assignment operations.
   */
  type AssignmentOperationType = 'assign' | 'unassign' | 'reassign';

  /**
   * Represents a single assignment operation.
   */
  interface AssignmentOperation {
    type: AssignmentOperationType;
    developerId?: string;
  }

  /**
   * Generates a random assignment operation sequence that is valid
   * (respects assign/unassign/reassign constraints).
   * 
   * @param developerIds - Array of available developer IDs
   * @param length - Length of the sequence
   */
  const validOperationSequenceArb = (
    developerIds: string[],
    length: number
  ): fc.Arbitrary<AssignmentOperation[]> => {
    return fc.array(
      fc.oneof(
        fc.constant({ type: 'assign' as const }),
        fc.constant({ type: 'unassign' as const }),
        fc.constant({ type: 'reassign' as const })
      ),
      { minLength: length, maxLength: length }
    ).chain(operations => {
      // For each operation that needs a developer, assign one
      return fc.tuple(
        ...operations.map(op => {
          if (op.type === 'assign' || op.type === 'reassign') {
            return fc.constantFrom(...developerIds).map(devId => ({
              ...op,
              developerId: devId,
            }));
          }
          return fc.constant(op);
        })
      );
    });
  };

  /**
   * Generates a sequence of operations and filters to only valid transitions.
   */
  const generateValidOperationSequence = (
    developerIds: string[],
    operations: AssignmentOperation[]
  ): AssignmentOperation[] => {
    const validOps: AssignmentOperation[] = [];
    let currentAssignee: string | null = null;

    for (const op of operations) {
      if (op.type === 'assign' && currentAssignee === null && op.developerId) {
        validOps.push(op);
        currentAssignee = op.developerId;
      } else if (op.type === 'unassign' && currentAssignee !== null) {
        validOps.push(op);
        currentAssignee = null;
      } else if (op.type === 'reassign' && op.developerId && op.developerId !== currentAssignee) {
        validOps.push(op);
        currentAssignee = op.developerId;
      }
    }

    return validOps;
  };

  it('should create exactly one history entry per assignment operation', () => {
    fc.assert(
      fc.property(
        // Generate 2-5 developers
        fc.array(
          fc.record({
            id: developerIdArb,
            name: developerNameArb,
          }),
          { minLength: 2, maxLength: 5 }
        ).map(devs => devs.map((d, i) => ({
          ...d,
          id: `dev-${i}-${d.id.slice(0, 5)}`,
          roles: ['fullstack' as Role],
          registered_at: new Date().toISOString(),
          status: 'ACTIVE' as const,
        }))),
        // Task definition
        taskIdArb,
        taskTitleArb,
        // Random operation types (we'll filter to valid sequence)
        fc.array(
          fc.record({
            type: fc.constantFrom('assign' as const, 'unassign' as const, 'reassign' as const),
            devIndex: fc.nat({ max: 4 }),
          }),
          { minLength: 3, maxLength: 10 }
        ),
        (members, taskId, taskTitle, rawOperations) => {
          teamManager.clear();
          taskAssigner.clear();

          // Register all members
          for (const member of members) {
            teamManager.registerMember(member);
          }

          // Create task with no assignment
          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Build a valid operation sequence
          const developerIds = members.map(m => m.id);
          const operations: AssignmentOperation[] = rawOperations.map(op => ({
            type: op.type,
            developerId: developerIds[op.devIndex % developerIds.length],
          }));
          
          const validOperations = generateValidOperationSequence(developerIds, operations);

          // Execute operations and count successes
          let successfulOperations = 0;
          for (const op of validOperations) {
            let result: Result<unknown, AssignmentError>;
            if (op.type === 'assign') {
              result = taskAssigner.assignTask(taskId, op.developerId!);
            } else if (op.type === 'unassign') {
              result = taskAssigner.unassignTask(taskId);
            } else {
              result = taskAssigner.reassignTask(taskId, op.developerId!);
            }
            
            if (result.success) {
              successfulOperations++;
            }
          }

          // Get history and verify count matches operations
          const history = taskAssigner.getAssignmentHistory(taskId);
          expect(history.length).toBe(successfulOperations);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should record correct previous_assignee and new_assignee for each entry', () => {
    fc.assert(
      fc.property(
        // Generate 3 developers with unique IDs
        fc.tuple(developerIdArb, developerIdArb, developerIdArb).map(([id1, id2, id3]) => [
          { id: `dev-001-${id1.slice(0, 3)}`, name: 'Dev One', roles: ['fullstack' as Role], registered_at: new Date().toISOString(), status: 'ACTIVE' as const },
          { id: `dev-002-${id2.slice(0, 3)}`, name: 'Dev Two', roles: ['fullstack' as Role], registered_at: new Date().toISOString(), status: 'ACTIVE' as const },
          { id: `dev-003-${id3.slice(0, 3)}`, name: 'Dev Three', roles: ['fullstack' as Role], registered_at: new Date().toISOString(), status: 'ACTIVE' as const },
        ]),
        taskIdArb,
        taskTitleArb,
        (members, taskId, taskTitle) => {
          teamManager.clear();
          taskAssigner.clear();

          // Register members
          for (const member of members) {
            teamManager.registerMember(member);
          }

          // Create task
          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Execute a known sequence: assign -> reassign -> unassign -> assign
          const dev1 = members[0].id;
          const dev2 = members[1].id;
          const dev3 = members[2].id;

          // Track expected history
          const expectedHistory: Array<{ prev: string | null; new: string | null }> = [];

          // Operation 1: Assign to dev1
          let result = taskAssigner.assignTask(taskId, dev1);
          if (result.success) {
            expectedHistory.push({ prev: null, new: dev1 });
          }

          // Operation 2: Reassign to dev2
          result = taskAssigner.reassignTask(taskId, dev2);
          if (result.success) {
            expectedHistory.push({ prev: dev1, new: dev2 });
          }

          // Operation 3: Unassign
          const unassignResult = taskAssigner.unassignTask(taskId);
          if (unassignResult.success) {
            expectedHistory.push({ prev: dev2, new: null });
          }

          // Operation 4: Assign to dev3
          result = taskAssigner.assignTask(taskId, dev3);
          if (result.success) {
            expectedHistory.push({ prev: null, new: dev3 });
          }

          // Verify history
          const history = taskAssigner.getAssignmentHistory(taskId);
          expect(history.length).toBe(expectedHistory.length);

          for (let i = 0; i < expectedHistory.length; i++) {
            expect(history[i].previous_assignee).toBe(expectedHistory[i].prev);
            expect(history[i].new_assignee).toBe(expectedHistory[i].new);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should record timestamps in chronological order', () => {
    fc.assert(
      fc.property(
        // Generate developers
        fc.array(teamMemberArb, { minLength: 2, maxLength: 4 }).map(members =>
          members.map((m, i) => ({
            ...m,
            id: `dev-${i}-${m.id.slice(0, 5)}`,
            roles: ['fullstack' as Role],
          }))
        ),
        taskIdArb,
        taskTitleArb,
        // Sequence of developer indices to assign to
        fc.array(fc.nat({ max: 3 }), { minLength: 2, maxLength: 6 }),
        (members, taskId, taskTitle, devIndices) => {
          teamManager.clear();
          taskAssigner.clear();

          // Register members
          for (const member of members) {
            teamManager.registerMember(member);
          }

          // Create task
          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Execute operations with alternating assign/reassign pattern
          let isAssigned = false;
          let lastDevId: string | null = null;

          for (const devIndex of devIndices) {
            const devId = members[devIndex % members.length].id;
            
            if (!isAssigned) {
              const result = taskAssigner.assignTask(taskId, devId);
              if (result.success) {
                isAssigned = true;
                lastDevId = devId;
              }
            } else if (devId !== lastDevId) {
              // Reassign to different developer
              const result = taskAssigner.reassignTask(taskId, devId);
              if (result.success) {
                lastDevId = devId;
              }
            }
          }

          // Get history and verify timestamps are chronological
          const history = taskAssigner.getAssignmentHistory(taskId);
          
          if (history.length > 1) {
            for (let i = 1; i < history.length; i++) {
              const prevTime = new Date(history[i - 1].timestamp).getTime();
              const currTime = new Date(history[i].timestamp).getTime();
              // Timestamps should be non-decreasing (may be equal if operations happen in same ms)
              expect(currTime).toBeGreaterThanOrEqual(prevTime);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve complete assignment history across multiple operations', () => {
    fc.assert(
      fc.property(
        // Generate number of operations
        fc.integer({ min: 5, max: 15 }),
        // Generate developers
        fc.array(teamMemberArb, { minLength: 3, maxLength: 5 }).map(members =>
          members.map((m, i) => ({
            ...m,
            id: `dev-${i}-${m.id.slice(0, 5)}`,
            roles: ['fullstack' as Role],
          }))
        ),
        taskIdArb,
        taskTitleArb,
        (numOperations, members, taskId, taskTitle) => {
          teamManager.clear();
          taskAssigner.clear();

          // Register members
          for (const member of members) {
            teamManager.registerMember(member);
          }

          // Create task
          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Track expected previous/new assignees
          let currentAssignee: string | null = null;
          const expectedChanges: Array<{ prev: string | null; new: string | null }> = [];

          // Execute random valid operations
          for (let i = 0; i < numOperations; i++) {
            const randomDevIndex = Math.floor(Math.random() * members.length);
            const devId = members[randomDevIndex].id;

            if (currentAssignee === null) {
              // Can only assign
              const result = taskAssigner.assignTask(taskId, devId);
              if (result.success) {
                expectedChanges.push({ prev: null, new: devId });
                currentAssignee = devId;
              }
            } else {
              // Can unassign or reassign
              const operationType = Math.random();
              if (operationType < 0.3) {
                // Unassign
                const result = taskAssigner.unassignTask(taskId);
                if (result.success) {
                  expectedChanges.push({ prev: currentAssignee, new: null });
                  currentAssignee = null;
                }
              } else if (devId !== currentAssignee) {
                // Reassign to different developer
                const result = taskAssigner.reassignTask(taskId, devId);
                if (result.success) {
                  expectedChanges.push({ prev: currentAssignee, new: devId });
                  currentAssignee = devId;
                }
              }
            }
          }

          // Requirement 16.2: Verify complete history is preserved
          const history = taskAssigner.getAssignmentHistory(taskId);
          expect(history.length).toBe(expectedChanges.length);

          // Verify each entry matches expected values
          for (let i = 0; i < expectedChanges.length; i++) {
            expect(history[i].previous_assignee).toBe(expectedChanges[i].prev);
            expect(history[i].new_assignee).toBe(expectedChanges[i].new);
            // Verify timestamp is a valid ISO string
            expect(() => new Date(history[i].timestamp)).not.toThrow();
            expect(new Date(history[i].timestamp).toISOString()).toBe(history[i].timestamp);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should track history correctly for assign-unassign-assign pattern', () => {
    fc.assert(
      fc.property(
        developerIdArb,
        developerIdArb,
        developerNameArb,
        developerNameArb,
        taskIdArb,
        taskTitleArb,
        (devId1, devId2, devName1, devName2, taskId, taskTitle) => {
          teamManager.clear();
          taskAssigner.clear();

          // Ensure unique IDs
          const member1: TeamMember = {
            id: `dev-a-${devId1.slice(0, 5)}`,
            name: devName1,
            roles: ['fullstack'],
            registered_at: new Date().toISOString(),
            status: 'ACTIVE',
          };
          const member2: TeamMember = {
            id: `dev-b-${devId2.slice(0, 5)}`,
            name: devName2,
            roles: ['fullstack'],
            registered_at: new Date().toISOString(),
            status: 'ACTIVE',
          };

          teamManager.registerMember(member1);
          teamManager.registerMember(member2);

          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Execute: assign -> unassign -> assign (different dev)
          taskAssigner.assignTask(taskId, member1.id);
          taskAssigner.unassignTask(taskId);
          taskAssigner.assignTask(taskId, member2.id);

          const history = taskAssigner.getAssignmentHistory(taskId);
          
          // Should have 3 entries
          expect(history.length).toBe(3);

          // Entry 1: Initial assignment to member1
          expect(history[0].previous_assignee).toBeNull();
          expect(history[0].new_assignee).toBe(member1.id);

          // Entry 2: Unassignment from member1
          expect(history[1].previous_assignee).toBe(member1.id);
          expect(history[1].new_assignee).toBeNull();

          // Entry 3: Assignment to member2
          expect(history[2].previous_assignee).toBeNull();
          expect(history[2].new_assignee).toBe(member2.id);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should maintain history integrity when reassigning multiple times', () => {
    fc.assert(
      fc.property(
        // Generate 4 developers
        fc.array(teamMemberArb, { minLength: 4, maxLength: 4 }).map(members =>
          members.map((m, i) => ({
            ...m,
            id: `dev-${i}`,
            roles: ['fullstack' as Role],
          }))
        ),
        taskIdArb,
        taskTitleArb,
        // Number of reassignments (3-8)
        fc.integer({ min: 3, max: 8 }),
        (members, taskId, taskTitle, numReassignments) => {
          teamManager.clear();
          taskAssigner.clear();

          // Register members
          for (const member of members) {
            teamManager.registerMember(member);
          }

          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Initial assignment
          taskAssigner.assignTask(taskId, members[0].id);
          let previousAssignee = members[0].id;
          const expectedPreviousAssignees = [null]; // First entry has null previous

          // Perform reassignments cycling through developers
          for (let i = 1; i <= numReassignments; i++) {
            const nextDev = members[i % members.length];
            if (nextDev.id !== previousAssignee) {
              const result = taskAssigner.reassignTask(taskId, nextDev.id);
              if (result.success) {
                expectedPreviousAssignees.push(previousAssignee);
                previousAssignee = nextDev.id;
              }
            }
          }

          const history = taskAssigner.getAssignmentHistory(taskId);
          
          // Verify each history entry has correct previous_assignee
          expect(history.length).toBe(expectedPreviousAssignees.length);
          for (let i = 0; i < history.length; i++) {
            expect(history[i].previous_assignee).toBe(expectedPreviousAssignees[i]);
            // Verify new_assignee is not null (except for unassign which we didn't do)
            expect(history[i].new_assignee).not.toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should have valid timestamp format (ISO 8601) for all history entries', () => {
    fc.assert(
      fc.property(
        // Generate developers
        fc.array(teamMemberArb, { minLength: 2, maxLength: 3 }).map(members =>
          members.map((m, i) => ({
            ...m,
            id: `dev-${i}-${m.id.slice(0, 5)}`,
            roles: ['fullstack' as Role],
          }))
        ),
        taskIdArb,
        taskTitleArb,
        fc.integer({ min: 2, max: 6 }),
        (members, taskId, taskTitle, numOps) => {
          teamManager.clear();
          taskAssigner.clear();

          // Register members
          for (const member of members) {
            teamManager.registerMember(member);
          }

          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Perform operations
          let isAssigned = false;
          let currentDev = '';
          
          for (let i = 0; i < numOps; i++) {
            const devId = members[i % members.length].id;
            if (!isAssigned) {
              taskAssigner.assignTask(taskId, devId);
              isAssigned = true;
              currentDev = devId;
            } else if (devId !== currentDev) {
              taskAssigner.reassignTask(taskId, devId);
              currentDev = devId;
            }
          }

          const history = taskAssigner.getAssignmentHistory(taskId);
          
          // Verify all timestamps are valid ISO 8601 format
          const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
          for (const entry of history) {
            expect(entry.timestamp).toMatch(iso8601Regex);
            // Verify timestamp can be parsed
            const parsedDate = new Date(entry.timestamp);
            expect(parsedDate.toString()).not.toBe('Invalid Date');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not duplicate history entries for the same operation', () => {
    fc.assert(
      fc.property(
        teamMemberArb.map(m => ({ ...m, id: 'dev-single', roles: ['fullstack' as Role] })),
        taskIdArb,
        taskTitleArb,
        (member, taskId, taskTitle) => {
          teamManager.clear();
          taskAssigner.clear();

          teamManager.registerMember(member);

          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Perform single assignment
          const result = taskAssigner.assignTask(taskId, member.id);
          expect(result.success).toBe(true);

          const history = taskAssigner.getAssignmentHistory(taskId);
          
          // Should have exactly one entry
          expect(history.length).toBe(1);
          expect(history[0].previous_assignee).toBeNull();
          expect(history[0].new_assignee).toBe(member.id);

          // Trying to assign again should fail (task already assigned)
          const secondResult = taskAssigner.assignTask(taskId, member.id);
          expect(secondResult.success).toBe(false);

          // History should still have only one entry
          const historyAfter = taskAssigner.getAssignmentHistory(taskId);
          expect(historyAfter.length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should correctly chain previous_assignee values through history', () => {
    fc.assert(
      fc.property(
        // Generate 5 developers
        fc.array(teamMemberArb, { minLength: 5, maxLength: 5 }).map(members =>
          members.map((m, i) => ({
            ...m,
            id: `dev-chain-${i}`,
            roles: ['fullstack' as Role],
          }))
        ),
        taskIdArb,
        taskTitleArb,
        (members, taskId, taskTitle) => {
          teamManager.clear();
          taskAssigner.clear();

          // Register members
          for (const member of members) {
            teamManager.registerMember(member);
          }

          const task: Task = {
            id: taskId,
            title: taskTitle,
            status: 'TODO' as TaskStatus,
            assignment_history: [],
          };
          taskAssigner.addTask(task);

          // Perform sequential reassignments: dev0 -> dev1 -> dev2 -> dev3 -> dev4
          taskAssigner.assignTask(taskId, members[0].id);
          taskAssigner.reassignTask(taskId, members[1].id);
          taskAssigner.reassignTask(taskId, members[2].id);
          taskAssigner.reassignTask(taskId, members[3].id);
          taskAssigner.reassignTask(taskId, members[4].id);

          const history = taskAssigner.getAssignmentHistory(taskId);
          
          // Verify chain: new_assignee[i] === previous_assignee[i+1]
          expect(history.length).toBe(5);
          
          for (let i = 0; i < history.length - 1; i++) {
            expect(history[i].new_assignee).toBe(history[i + 1].previous_assignee);
          }

          // Verify first entry has null previous
          expect(history[0].previous_assignee).toBeNull();
          
          // Verify last entry has the final developer
          expect(history[history.length - 1].new_assignee).toBe(members[4].id);
        }
      ),
      { numRuns: 100 }
    );
  });
});
