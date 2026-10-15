/**
 * Integration Tests for End-to-End Assignment Flow
 * 
 * These tests verify the complete integration between Team_Manager and Task_Assigner
 * components, testing the full assignment workflow from team registration to
 * task completion and history tracking.
 * 
 * **Task 18.1: Write integration test for end-to-end assignment flow**
 * **Validates: Requirements 1.1, 3.1, 4.3**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TeamMember,
  TeamManagerImpl,
  createTeamMember,
  Role,
  VALID_ROLES,
  TeamErrorCode,
  createEmptyTeamStatistics,
} from '../../team-manager';
import {
  Task,
  TaskStatus,
  Assignment,
  AssignmentErrorCode,
  TaskAssignerImpl,
  InMemoryTaskStorage,
  TeamManagerForAssigner,
  createAssignment,
  createTask,
} from '../../task-assigner';

// =============================================================================
// In-Memory Team Manager for Integration Tests
// =============================================================================

/**
 * In-memory implementation of Team_Manager for integration testing.
 * This implementation provides the full Team_Manager interface without
 * file system dependencies.
 */
class InMemoryTeamManager implements TeamManagerForAssigner {
  private members: Map<string, TeamMember> = new Map();

  /**
   * Registers a new team member.
   */
  registerMember(member: TeamMember): { success: true } | { success: false; error: { code: number; message: string } } {
    // Validate required fields
    if (!member.id || typeof member.id !== 'string' || member.id.trim() === '') {
      return { success: false, error: { code: TeamErrorCode.INVALID_MEMBER_DATA, message: 'Invalid member ID' } };
    }

    // Check for duplicate ID
    if (this.members.has(member.id)) {
      return { success: false, error: { code: TeamErrorCode.DUPLICATE_MEMBER_ID, message: `Member ${member.id} already exists` } };
    }

    // Validate roles
    if (!member.roles || member.roles.length === 0) {
      return { success: false, error: { code: TeamErrorCode.NO_ROLES_SPECIFIED, message: 'At least one role required' } };
    }

    for (const role of member.roles) {
      if (!VALID_ROLES.includes(role as Role)) {
        return { success: false, error: { code: TeamErrorCode.INVALID_ROLE, message: `Invalid role: ${role}` } };
      }
    }

    this.members.set(member.id, { ...member });
    return { success: true };
  }

  /**
   * Removes a team member.
   */
  removeMember(developerId: string): { success: true } | { success: false; error: { code: number; message: string } } {
    if (!this.members.has(developerId)) {
      return { success: false, error: { code: TeamErrorCode.TEAM_MEMBER_NOT_FOUND, message: `Member ${developerId} not found` } };
    }
    this.members.delete(developerId);
    return { success: true };
  }

  /**
   * Updates member roles.
   */
  updateMemberRoles(developerId: string, roles: Role[]): { success: true } | { success: false; error: { code: number; message: string } } {
    const member = this.members.get(developerId);
    if (!member) {
      return { success: false, error: { code: TeamErrorCode.TEAM_MEMBER_NOT_FOUND, message: `Member ${developerId} not found` } };
    }

    if (!roles || roles.length === 0) {
      return { success: false, error: { code: TeamErrorCode.NO_ROLES_SPECIFIED, message: 'At least one role required' } };
    }

    for (const role of roles) {
      if (!VALID_ROLES.includes(role as Role)) {
        return { success: false, error: { code: TeamErrorCode.INVALID_ROLE, message: `Invalid role: ${role}` } };
      }
    }

    member.roles = [...roles];
    return { success: true };
  }

  /**
   * Validates if a developer ID exists in the team.
   */
  validateDeveloperId(developerId: string): boolean {
    return this.members.has(developerId);
  }

  /**
   * Gets the roles of a team member.
   */
  getMemberRoles(developerId: string): Role[] | null {
    const member = this.members.get(developerId);
    return member ? [...member.roles] : null;
  }

  /**
   * Gets a member by ID.
   */
  getMember(developerId: string): TeamMember | null {
    const member = this.members.get(developerId);
    return member ? { ...member } : null;
  }

  /**
   * Lists all members.
   */
  listMembers(roleFilter?: Role): TeamMember[] {
    const members = Array.from(this.members.values());
    if (roleFilter) {
      return members.filter(m => m.roles.includes(roleFilter));
    }
    return members;
  }

  /**
   * Gets members by role.
   */
  getMembersByRole(role: Role): TeamMember[] {
    return Array.from(this.members.values()).filter(m => m.roles.includes(role));
  }

  /**
   * Clears all members.
   */
  clear(): void {
    this.members.clear();
  }

  /**
   * Gets member count.
   */
  get size(): number {
    return this.members.size;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates a valid team member for testing.
 */
function createTestMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: overrides.id ?? 'dev-001',
    name: overrides.name ?? 'Test Developer',
    roles: overrides.roles ?? ['backend'],
    registered_at: overrides.registered_at ?? new Date().toISOString(),
    status: overrides.status ?? 'ACTIVE',
  };
}

/**
 * Creates a test task.
 */
function createTestTask(
  id: string,
  roleRequired: Role | null = null,
  status: TaskStatus = 'TODO'
): Task {
  return {
    id,
    title: `Test Task ${id}`,
    status,
    assignment: roleRequired
      ? {
          taskId: id,
          assignee: null,
          role_required: roleRequired,
          assigned_at: new Date().toISOString(),
          assigned_by: null,
          state: 'AVAILABLE_FOR_PICKUP',
        }
      : undefined,
    assignment_history: [],
    depends_on: [],
    parallel_group: null,
  };
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration Tests: End-to-End Assignment Flow', () => {
  let teamManager: InMemoryTeamManager;
  let taskStorage: InMemoryTaskStorage;
  let taskAssigner: TaskAssignerImpl;

  beforeEach(() => {
    teamManager = new InMemoryTeamManager();
    taskStorage = new InMemoryTaskStorage();
    taskAssigner = new TaskAssignerImpl({
      teamManager,
      taskStorage,
      currentUserId: 'lead-001',
    });
  });

  // ===========================================================================
  // 1. Register Team Member → Assign Task → Validate Assignment
  // Validates: Requirements 1.1, 3.1, 4.3
  // ===========================================================================
  describe('1. Register team member → assign task → validate assignment', () => {
    it('should complete full assignment flow: register → create task → assign → verify state', () => {
      // Step 1: Register a team member
      const developer = createTestMember({
        id: 'alice',
        name: 'Alice Developer',
        roles: ['backend', 'devops'],
      });
      const registerResult = teamManager.registerMember(developer);
      expect(registerResult.success).toBe(true);

      // Verify member is registered
      expect(teamManager.validateDeveloperId('alice')).toBe(true);
      expect(teamManager.getMemberRoles('alice')).toEqual(['backend', 'devops']);

      // Step 2: Create a task
      const task = createTestTask('TASK-001', 'backend');
      taskStorage.addTask(task);

      // Verify task exists in storage
      const storedTask = taskStorage.getTask('TASK-001');
      expect(storedTask).not.toBeNull();
      expect(storedTask?.assignment?.state).toBe('AVAILABLE_FOR_PICKUP');

      // Step 3: Assign the task to the developer
      const assignResult = taskAssigner.assignTask('TASK-001', 'alice');
      expect(assignResult.success).toBe(true);

      // Step 4: Verify the final state
      if (assignResult.success) {
        expect(assignResult.value.taskId).toBe('TASK-001');
        expect(assignResult.value.assignee).toBe('alice');
        expect(assignResult.value.role_required).toBe('backend');
        expect(assignResult.value.state).toBe('ASSIGNED');
        expect(assignResult.value.assigned_at).toBeDefined();
      }

      // Verify task is in developer's task list
      const aliceTasks = taskAssigner.getTasksByDeveloper('alice');
      expect(aliceTasks.length).toBe(1);
      expect(aliceTasks[0].id).toBe('TASK-001');

      // Verify task is no longer in unassigned list
      const unassignedTasks = taskAssigner.getUnassignedTasks('backend');
      expect(unassignedTasks.length).toBe(0);
    });

    it('should complete flow with multiple team members and tasks', () => {
      // Register multiple team members
      const alice = createTestMember({ id: 'alice', name: 'Alice', roles: ['backend'] });
      const bob = createTestMember({ id: 'bob', name: 'Bob', roles: ['frontend'] });
      const charlie = createTestMember({ id: 'charlie', name: 'Charlie', roles: ['backend', 'frontend'] });

      teamManager.registerMember(alice);
      teamManager.registerMember(bob);
      teamManager.registerMember(charlie);

      expect(teamManager.size).toBe(3);

      // Create multiple tasks with different role requirements
      const backendTask = createTestTask('TASK-BACKEND', 'backend');
      const frontendTask = createTestTask('TASK-FRONTEND', 'frontend');
      const noRoleTask = createTestTask('TASK-ANY', null);

      taskStorage.addTask(backendTask);
      taskStorage.addTask(frontendTask);
      taskStorage.addTask(noRoleTask);

      // Assign tasks appropriately
      const result1 = taskAssigner.assignTask('TASK-BACKEND', 'alice');
      const result2 = taskAssigner.assignTask('TASK-FRONTEND', 'bob');
      const result3 = taskAssigner.assignTask('TASK-ANY', 'charlie');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      // Verify each developer has their assigned task
      expect(taskAssigner.getTasksByDeveloper('alice').length).toBe(1);
      expect(taskAssigner.getTasksByDeveloper('bob').length).toBe(1);
      expect(taskAssigner.getTasksByDeveloper('charlie').length).toBe(1);

      // Verify task assignments are correct
      expect(taskAssigner.getAssignment('TASK-BACKEND')?.assignee).toBe('alice');
      expect(taskAssigner.getAssignment('TASK-FRONTEND')?.assignee).toBe('bob');
      expect(taskAssigner.getAssignment('TASK-ANY')?.assignee).toBe('charlie');
    });

    it('should fail assignment if developer not registered first', () => {
      // Create a task without registering developer
      const task = createTestTask('TASK-002', 'backend');
      taskStorage.addTask(task);

      // Attempt to assign to non-existent developer
      const result = taskAssigner.assignTask('TASK-002', 'unregistered-dev');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AssignmentErrorCode.DEVELOPER_NOT_FOUND);
      }
    });

    it('should record assignment timestamp correctly (Requirement 4.3)', () => {
      // Register developer
      const developer = createTestMember({ id: 'timestamp-dev', roles: ['qa'] });
      teamManager.registerMember(developer);

      // Create task
      const task = createTestTask('TASK-TIME', 'qa');
      taskStorage.addTask(task);

      // Record time before assignment
      const beforeTime = new Date();

      // Assign task
      const result = taskAssigner.assignTask('TASK-TIME', 'timestamp-dev');
      
      // Record time after assignment
      const afterTime = new Date();

      expect(result.success).toBe(true);
      if (result.success) {
        const assignedAt = new Date(result.value.assigned_at);
        expect(assignedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
        expect(assignedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
      }
    });
  });

  // ===========================================================================
  // 2. Assign Task with Role Requirement → Verify Role Validation
  // Validates: Requirements 3.3, 3.4
  // ===========================================================================
  describe('2. Assign task with role requirement → verify role validation', () => {
    it('should allow assignment when developer has required role', () => {
      // Register a frontend developer
      const frontend = createTestMember({ id: 'frontend-dev', roles: ['frontend'] });
      teamManager.registerMember(frontend);

      // Create task requiring frontend role
      const task = createTestTask('TASK-FE', 'frontend');
      taskStorage.addTask(task);

      // Assignment should succeed
      const result = taskAssigner.assignTask('TASK-FE', 'frontend-dev');
      expect(result.success).toBe(true);
    });

    it('should reject assignment when developer lacks required role', () => {
      // Register a backend developer
      const backend = createTestMember({ id: 'backend-dev', roles: ['backend'] });
      teamManager.registerMember(backend);

      // Create task requiring frontend role
      const task = createTestTask('TASK-FE2', 'frontend');
      taskStorage.addTask(task);

      // Assignment should fail
      const result = taskAssigner.assignTask('TASK-FE2', 'backend-dev');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
        expect(result.error.context?.required_role).toBe('frontend');
        expect(result.error.context?.developer_roles).toEqual(['backend']);
      }
    });

    it('should allow assignment when developer has one of multiple roles including required one', () => {
      // Register a fullstack developer
      const fullstack = createTestMember({
        id: 'fullstack-dev',
        roles: ['frontend', 'backend', 'devops'],
      });
      teamManager.registerMember(fullstack);

      // Create tasks for different roles
      const feTask = createTestTask('TASK-MULTI-FE', 'frontend');
      const beTask = createTestTask('TASK-MULTI-BE', 'backend');
      taskStorage.addTask(feTask);
      taskStorage.addTask(beTask);

      // Both assignments should succeed
      const result1 = taskAssigner.assignTask('TASK-MULTI-FE', 'fullstack-dev');
      expect(result1.success).toBe(true);

      // Unassign first task for second test
      taskAssigner.unassignTask('TASK-MULTI-FE');
      
      const result2 = taskAssigner.assignTask('TASK-MULTI-BE', 'fullstack-dev');
      expect(result2.success).toBe(true);
    });

    it('should validate all roles in VALID_ROLES are accepted', () => {
      // Create developers for each valid role
      for (const role of VALID_ROLES) {
        const dev = createTestMember({
          id: `dev-${role}`,
          roles: [role],
        });
        teamManager.registerMember(dev);

        const task = createTestTask(`TASK-${role.toUpperCase()}`, role);
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask(`TASK-${role.toUpperCase()}`, `dev-${role}`);
        expect(result.success).toBe(true);
      }
    });

    it('should allow task without role_required to be assigned to any developer', () => {
      // Register developer with any role
      const devWithQa = createTestMember({ id: 'qa-dev', roles: ['qa'] });
      teamManager.registerMember(devWithQa);

      // Create task without role requirement
      const task = createTestTask('TASK-NO-ROLE', null);
      taskStorage.addTask(task);

      // Assignment should succeed
      const result = taskAssigner.assignTask('TASK-NO-ROLE', 'qa-dev');
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // 3. Reassign Task Between Developers
  // Validates: Requirements 3.1, 16.1, 16.2
  // ===========================================================================
  describe('3. Reassign task between developers', () => {
    it('should successfully reassign task after unassignment', () => {
      // Register two developers
      const dev1 = createTestMember({ id: 'dev-1', roles: ['backend'] });
      const dev2 = createTestMember({ id: 'dev-2', roles: ['backend'] });
      teamManager.registerMember(dev1);
      teamManager.registerMember(dev2);

      // Create and assign task to dev1
      const task = createTestTask('TASK-REASSIGN', 'backend');
      taskStorage.addTask(task);
      taskAssigner.assignTask('TASK-REASSIGN', 'dev-1');

      // Verify dev-1 has the task
      expect(taskAssigner.getAssignment('TASK-REASSIGN')?.assignee).toBe('dev-1');
      expect(taskAssigner.getTasksByDeveloper('dev-1').length).toBe(1);

      // Unassign from dev-1
      const unassignResult = taskAssigner.unassignTask('TASK-REASSIGN');
      expect(unassignResult.success).toBe(true);

      // Verify task is unassigned
      const assignment = taskAssigner.getAssignment('TASK-REASSIGN');
      expect(assignment?.assignee).toBeNull();
      expect(taskAssigner.getTasksByDeveloper('dev-1').length).toBe(0);

      // Reassign to dev-2
      const reassignResult = taskAssigner.assignTask('TASK-REASSIGN', 'dev-2');
      expect(reassignResult.success).toBe(true);

      // Verify dev-2 now has the task
      expect(taskAssigner.getAssignment('TASK-REASSIGN')?.assignee).toBe('dev-2');
      expect(taskAssigner.getTasksByDeveloper('dev-2').length).toBe(1);
      expect(taskAssigner.getTasksByDeveloper('dev-1').length).toBe(0);
    });

    it('should track all reassignments in history', () => {
      // Register three developers
      const dev1 = createTestMember({ id: 'alice', roles: ['backend'] });
      const dev2 = createTestMember({ id: 'bob', roles: ['backend'] });
      const dev3 = createTestMember({ id: 'charlie', roles: ['backend'] });
      teamManager.registerMember(dev1);
      teamManager.registerMember(dev2);
      teamManager.registerMember(dev3);

      // Create task
      const task = createTestTask('TASK-HISTORY', 'backend');
      taskStorage.addTask(task);

      // First assignment: null -> alice
      taskAssigner.assignTask('TASK-HISTORY', 'alice');

      // Unassign: alice -> null
      taskAssigner.unassignTask('TASK-HISTORY');

      // Second assignment: null -> bob
      taskAssigner.assignTask('TASK-HISTORY', 'bob');

      // Unassign: bob -> null
      taskAssigner.unassignTask('TASK-HISTORY');

      // Third assignment: null -> charlie
      taskAssigner.assignTask('TASK-HISTORY', 'charlie');

      // Verify history has all entries
      const history = taskAssigner.getAssignmentHistory('TASK-HISTORY');
      expect(history.length).toBe(5);

      // Verify history entries
      expect(history[0].previous_assignee).toBeNull();
      expect(history[0].new_assignee).toBe('alice');

      expect(history[1].previous_assignee).toBe('alice');
      expect(history[1].new_assignee).toBeNull();

      expect(history[2].previous_assignee).toBeNull();
      expect(history[2].new_assignee).toBe('bob');

      expect(history[3].previous_assignee).toBe('bob');
      expect(history[3].new_assignee).toBeNull();

      expect(history[4].previous_assignee).toBeNull();
      expect(history[4].new_assignee).toBe('charlie');
    });

    it('should fail reassignment to developer without required role', () => {
      // Register developers with different roles
      const backend = createTestMember({ id: 'backend-dev', roles: ['backend'] });
      const frontend = createTestMember({ id: 'frontend-dev', roles: ['frontend'] });
      teamManager.registerMember(backend);
      teamManager.registerMember(frontend);

      // Create backend task and assign to backend dev
      const task = createTestTask('TASK-ROLE-CHECK', 'backend');
      taskStorage.addTask(task);
      taskAssigner.assignTask('TASK-ROLE-CHECK', 'backend-dev');

      // Unassign
      taskAssigner.unassignTask('TASK-ROLE-CHECK');

      // Try to reassign to frontend dev (should fail)
      const result = taskAssigner.assignTask('TASK-ROLE-CHECK', 'frontend-dev');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
      }
    });

    it('should block direct reassignment when task already assigned', () => {
      // Register two developers
      const dev1 = createTestMember({ id: 'holder', roles: ['backend'] });
      const dev2 = createTestMember({ id: 'wannabe', roles: ['backend'] });
      teamManager.registerMember(dev1);
      teamManager.registerMember(dev2);

      // Create and assign task
      const task = createTestTask('TASK-HELD', 'backend');
      taskStorage.addTask(task);
      taskAssigner.assignTask('TASK-HELD', 'holder');

      // Try to assign directly to wannabe without unassigning first
      const result = taskAssigner.assignTask('TASK-HELD', 'wannabe');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AssignmentErrorCode.TASK_ALREADY_ASSIGNED);
      }
    });
  });

  // ===========================================================================
  // 4. Pickup Available Task by Developer
  // Validates: Requirements 3.5, 3.6
  // ===========================================================================
  describe('4. Pickup available task by developer', () => {
    it('should allow developer to pickup unassigned task with matching role', () => {
      // Register developer
      const developer = createTestMember({ id: 'picker', roles: ['qa'] });
      teamManager.registerMember(developer);

      // Create unassigned task with role requirement
      const task = createTestTask('TASK-PICKUP', 'qa');
      taskStorage.addTask(task);

      // Verify task is in unassigned list
      let unassigned = taskAssigner.getUnassignedTasks('qa');
      expect(unassigned.length).toBe(1);
      expect(unassigned[0].id).toBe('TASK-PICKUP');

      // Developer picks up the task
      const result = taskAssigner.pickupTask('TASK-PICKUP', 'picker');
      expect(result.success).toBe(true);

      // Verify task is now assigned
      expect(taskAssigner.getAssignment('TASK-PICKUP')?.assignee).toBe('picker');
      
      // Verify task is no longer in unassigned list
      unassigned = taskAssigner.getUnassignedTasks('qa');
      expect(unassigned.length).toBe(0);
    });

    it('should list only tasks matching developer role in unassigned list', () => {
      // Create tasks with different role requirements
      const beTask = createTestTask('TASK-BE-AVAIL', 'backend');
      const feTask = createTestTask('TASK-FE-AVAIL', 'frontend');
      const qaTask = createTestTask('TASK-QA-AVAIL', 'qa');
      taskStorage.addTask(beTask);
      taskStorage.addTask(feTask);
      taskStorage.addTask(qaTask);

      // Filter by backend - should only see backend task
      const backendTasks = taskAssigner.getUnassignedTasks('backend');
      expect(backendTasks.length).toBe(1);
      expect(backendTasks[0].id).toBe('TASK-BE-AVAIL');

      // Filter by frontend - should only see frontend task
      const frontendTasks = taskAssigner.getUnassignedTasks('frontend');
      expect(frontendTasks.length).toBe(1);
      expect(frontendTasks[0].id).toBe('TASK-FE-AVAIL');

      // Without filter - should see all unassigned tasks
      const allUnassigned = taskAssigner.getUnassignedTasks();
      expect(allUnassigned.length).toBe(3);
    });

    it('should reject pickup when developer lacks required role', () => {
      // Register frontend developer
      const dev = createTestMember({ id: 'wrong-role', roles: ['frontend'] });
      teamManager.registerMember(dev);

      // Create backend task
      const task = createTestTask('TASK-WRONG-PICKUP', 'backend');
      taskStorage.addTask(task);

      // Try to pickup - should fail
      const result = taskAssigner.pickupTask('TASK-WRONG-PICKUP', 'wrong-role');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
      }
    });

    it('should reject pickup when task already assigned', () => {
      // Register two developers
      const dev1 = createTestMember({ id: 'first', roles: ['devops'] });
      const dev2 = createTestMember({ id: 'late', roles: ['devops'] });
      teamManager.registerMember(dev1);
      teamManager.registerMember(dev2);

      // Create and assign task to first developer
      const task = createTestTask('TASK-TAKEN', 'devops');
      taskStorage.addTask(task);
      taskAssigner.assignTask('TASK-TAKEN', 'first');

      // Second developer tries to pickup - should fail
      const result = taskAssigner.pickupTask('TASK-TAKEN', 'late');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AssignmentErrorCode.TASK_ALREADY_ASSIGNED);
      }
    });

    it('should record pickup in assignment history', () => {
      // Register developer
      const dev = createTestMember({ id: 'history-picker', roles: ['lead'] });
      teamManager.registerMember(dev);

      // Create task
      const task = createTestTask('TASK-PICKUP-HIST', 'lead');
      taskStorage.addTask(task);

      // Pickup task
      taskAssigner.pickupTask('TASK-PICKUP-HIST', 'history-picker');

      // Verify history
      const history = taskAssigner.getAssignmentHistory('TASK-PICKUP-HIST');
      expect(history.length).toBe(1);
      expect(history[0].previous_assignee).toBeNull();
      expect(history[0].new_assignee).toBe('history-picker');
      expect(history[0].timestamp).toBeDefined();
    });
  });

  // ===========================================================================
  // 5. Assignment History Tracking
  // Validates: Requirements 16.1, 16.2, 16.3
  // ===========================================================================
  describe('5. Assignment history tracking', () => {
    it('should maintain complete assignment history with correct values', () => {
      // Register developers
      const alice = createTestMember({ id: 'alice-hist', roles: ['fullstack'] });
      const bob = createTestMember({ id: 'bob-hist', roles: ['fullstack'] });
      teamManager.registerMember(alice);
      teamManager.registerMember(bob);

      // Create task
      const task = createTestTask('TASK-FULL-HIST', 'fullstack');
      taskStorage.addTask(task);

      // Initial assignment
      taskAssigner.assignTask('TASK-FULL-HIST', 'alice-hist');

      // Unassign
      taskAssigner.unassignTask('TASK-FULL-HIST');

      // Reassign
      taskAssigner.assignTask('TASK-FULL-HIST', 'bob-hist');

      // Get history
      const history = taskAssigner.getAssignmentHistory('TASK-FULL-HIST');

      // Verify all entries exist with correct values
      expect(history.length).toBe(3);

      // Entry 1: Initial assignment
      expect(history[0].previous_assignee).toBeNull();
      expect(history[0].new_assignee).toBe('alice-hist');
      expect(history[0].timestamp).toBeDefined();

      // Entry 2: Unassignment
      expect(history[1].previous_assignee).toBe('alice-hist');
      expect(history[1].new_assignee).toBeNull();
      expect(history[1].timestamp).toBeDefined();

      // Entry 3: Reassignment
      expect(history[2].previous_assignee).toBeNull();
      expect(history[2].new_assignee).toBe('bob-hist');
      expect(history[2].timestamp).toBeDefined();

      // Verify timestamps are in order
      const ts1 = new Date(history[0].timestamp).getTime();
      const ts2 = new Date(history[1].timestamp).getTime();
      const ts3 = new Date(history[2].timestamp).getTime();
      expect(ts1).toBeLessThanOrEqual(ts2);
      expect(ts2).toBeLessThanOrEqual(ts3);
    });

    it('should return empty history for task without assignment changes', () => {
      // Create task but don't assign
      const task = createTestTask('TASK-NO-HIST', null);
      taskStorage.addTask(task);

      // History should be empty
      const history = taskAssigner.getAssignmentHistory('TASK-NO-HIST');
      expect(history.length).toBe(0);
    });

    it('should return empty history for non-existent task', () => {
      const history = taskAssigner.getAssignmentHistory('NON-EXISTENT-TASK');
      expect(history.length).toBe(0);
    });

    it('should preserve history across multiple assignment cycles', () => {
      // Register developer
      const dev = createTestMember({ id: 'cycler', roles: ['backend'] });
      teamManager.registerMember(dev);

      // Create task
      const task = createTestTask('TASK-CYCLES', 'backend');
      taskStorage.addTask(task);

      // Multiple assignment cycles
      for (let i = 0; i < 3; i++) {
        taskAssigner.assignTask('TASK-CYCLES', 'cycler');
        taskAssigner.unassignTask('TASK-CYCLES');
      }

      // Final assignment
      taskAssigner.assignTask('TASK-CYCLES', 'cycler');

      // History should have 7 entries (3 assign + 3 unassign + 1 final assign)
      const history = taskAssigner.getAssignmentHistory('TASK-CYCLES');
      expect(history.length).toBe(7);

      // Verify alternating pattern
      for (let i = 0; i < history.length; i++) {
        if (i % 2 === 0) {
          // Assignment entries
          expect(history[i].new_assignee).toBe('cycler');
        } else {
          // Unassignment entries
          expect(history[i].new_assignee).toBeNull();
          expect(history[i].previous_assignee).toBe('cycler');
        }
      }
    });

    it('should include timestamp in ISO format', () => {
      // Register developer
      const dev = createTestMember({ id: 'iso-dev', roles: ['qa'] });
      teamManager.registerMember(dev);

      // Create and assign task
      const task = createTestTask('TASK-ISO', 'qa');
      taskStorage.addTask(task);
      taskAssigner.assignTask('TASK-ISO', 'iso-dev');

      // Get history
      const history = taskAssigner.getAssignmentHistory('TASK-ISO');
      expect(history.length).toBe(1);

      // Verify timestamp is valid ISO format
      const timestamp = history[0].timestamp;
      expect(() => new Date(timestamp)).not.toThrow();
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });
  });

  // ===========================================================================
  // 6. Complex Integration Scenarios
  // ===========================================================================
  describe('6. Complex integration scenarios', () => {
    it('should handle team changes affecting assignments', () => {
      // Register initial team
      const dev = createTestMember({ id: 'changeable', roles: ['backend'] });
      teamManager.registerMember(dev);

      // Create and assign task
      const task = createTestTask('TASK-TEAM-CHANGE', 'backend');
      taskStorage.addTask(task);
      const result = taskAssigner.assignTask('TASK-TEAM-CHANGE', 'changeable');
      expect(result.success).toBe(true);

      // Update developer roles
      teamManager.updateMemberRoles('changeable', ['backend', 'frontend', 'devops']);

      // Verify developer can still work on the task
      const assignment = taskAssigner.getAssignment('TASK-TEAM-CHANGE');
      expect(assignment?.assignee).toBe('changeable');

      // Developer should now be able to pick up frontend tasks too
      const feTask = createTestTask('TASK-NEW-ROLE', 'frontend');
      taskStorage.addTask(feTask);
      const feResult = taskAssigner.assignTask('TASK-NEW-ROLE', 'changeable');
      expect(feResult.success).toBe(true);
    });

    it('should handle concurrent task assignments to same developer', () => {
      // Register developer
      const dev = createTestMember({ id: 'busy-dev', roles: ['fullstack'] });
      teamManager.registerMember(dev);

      // Create multiple tasks
      const tasks = ['TASK-A', 'TASK-B', 'TASK-C', 'TASK-D', 'TASK-E'];
      for (const taskId of tasks) {
        const task = createTestTask(taskId, 'fullstack');
        taskStorage.addTask(task);
        taskAssigner.assignTask(taskId, 'busy-dev');
      }

      // Verify all tasks are assigned to the developer
      const devTasks = taskAssigner.getTasksByDeveloper('busy-dev');
      expect(devTasks.length).toBe(5);

      // Verify each task has the correct assignee
      for (const taskId of tasks) {
        const assignment = taskAssigner.getAssignment(taskId);
        expect(assignment?.assignee).toBe('busy-dev');
      }
    });

    it('should correctly handle task assignment to developer with all roles', () => {
      // Register a developer with all valid roles
      const superDev = createTestMember({
        id: 'super-dev',
        roles: [...VALID_ROLES],
      });
      teamManager.registerMember(superDev);

      // Create tasks for each role
      for (const role of VALID_ROLES) {
        const task = createTestTask(`TASK-${role.toUpperCase()}`, role);
        taskStorage.addTask(task);

        // Should be able to be assigned all of them
        const result = taskAssigner.assignTask(`TASK-${role.toUpperCase()}`, 'super-dev');
        expect(result.success).toBe(true);
      }

      // Verify all tasks are assigned
      const allTasks = taskAssigner.getTasksByDeveloper('super-dev');
      expect(allTasks.length).toBe(VALID_ROLES.length);
    });

    it('should handle assignment validation for tasks in different statuses', () => {
      // Register developer
      const dev = createTestMember({ id: 'status-test', roles: ['backend'] });
      teamManager.registerMember(dev);

      // Create tasks in different statuses
      const todoTask = createTestTask('TASK-TODO', 'backend');
      todoTask.status = 'TODO';

      const readyTask = createTestTask('TASK-READY', 'backend');
      readyTask.status = 'READY';

      const blockedTask = createTestTask('TASK-BLOCKED', 'backend');
      blockedTask.status = 'BLOCKED';

      const inProgressTask = createTestTask('TASK-IN-PROGRESS', 'backend');
      inProgressTask.status = 'IN_PROGRESS';

      const verifyTask = createTestTask('TASK-VERIFY', 'backend');
      verifyTask.status = 'VERIFY';

      const doneTask = createTestTask('TASK-DONE', 'backend');
      doneTask.status = 'DONE';

      taskStorage.addTask(todoTask);
      taskStorage.addTask(readyTask);
      taskStorage.addTask(blockedTask);
      taskStorage.addTask(inProgressTask);
      taskStorage.addTask(verifyTask);
      taskStorage.addTask(doneTask);

      // Assignable statuses: TODO, READY, BLOCKED
      expect(taskAssigner.assignTask('TASK-TODO', 'status-test').success).toBe(true);
      
      // Unassign for next tests
      taskAssigner.unassignTask('TASK-TODO');
      
      expect(taskAssigner.assignTask('TASK-READY', 'status-test').success).toBe(true);
      taskAssigner.unassignTask('TASK-READY');
      
      expect(taskAssigner.assignTask('TASK-BLOCKED', 'status-test').success).toBe(true);
      taskAssigner.unassignTask('TASK-BLOCKED');

      // Non-assignable statuses: IN_PROGRESS, VERIFY, DONE
      expect(taskAssigner.assignTask('TASK-IN-PROGRESS', 'status-test').success).toBe(false);
      expect(taskAssigner.assignTask('TASK-VERIFY', 'status-test').success).toBe(false);
      expect(taskAssigner.assignTask('TASK-DONE', 'status-test').success).toBe(false);
    });
  });
});
