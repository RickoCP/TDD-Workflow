/**
 * Unit Tests for Task_Assigner
 * 
 * These tests verify specific scenarios for the Task_Assigner component
 * including assignment, unassignment, pickup, history tracking, and query operations.
 * 
 * **Validates: Requirements 3.1-3.6, 4.1-4.3, 16.1-16.3**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  taskNotAssignedError,
  Role,
  VALID_ROLES,
  isValidRole,
  TaskAssignerImpl,
  InMemoryTaskStorage,
  TeamManagerForAssigner,
  OwnershipManagerForAssigner,
  ownershipClaimFailedError,
} from '../task-assigner';
import {
  TeamMember,
  TeamError,
  TeamErrorCode,
  createTeamMember,
  memberNotFoundError,
} from '../team-manager';

// =============================================================================
// In-Memory Team_Manager Implementation for Unit Testing
// =============================================================================

/**
 * In-memory implementation of TeamManagerForAssigner for testing purposes.
 * This implementation follows the minimal interface required by TaskAssignerImpl.
 */
class InMemoryTeamManager implements TeamManagerForAssigner {
  private members: Map<string, TeamMember> = new Map();

  /**
   * Registers a new team member.
   */
  registerMember(member: TeamMember): void {
    this.members.set(member.id, { ...member });
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
   * Gets a member by ID (for test assertions).
   */
  getMember(developerId: string): TeamMember | null {
    const member = this.members.get(developerId);
    return member ? { ...member } : null;
  }

  /**
   * Clears all members (for test reset).
   */
  clear(): void {
    this.members.clear();
  }

  /**
   * Gets the count of registered members.
   */
  get size(): number {
    return this.members.size;
  }
}

// =============================================================================
// Helper Functions for Tests
// =============================================================================

/**
 * Creates a valid team member for testing.
 */
function createValidMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: overrides.id ?? 'dev-001',
    name: overrides.name ?? 'Test Developer',
    roles: overrides.roles ?? ['backend'],
    registered_at: overrides.registered_at ?? new Date().toISOString(),
    status: overrides.status ?? 'ACTIVE',
  };
}

/**
 * Creates a valid task for testing.
 */
function createValidTask(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? 'TASK-001';
  return {
    id,
    title: overrides.title ?? 'Test Task',
    status: overrides.status ?? 'TODO',
    assignment: overrides.assignment,
    assignment_history: overrides.assignment_history ?? [],
    depends_on: overrides.depends_on,
    parallel_group: overrides.parallel_group,
  };
}

/**
 * Creates a task with a specific role required.
 */
function createTaskWithRoleRequired(
  taskId: string,
  roleRequired: Role,
  status: TaskStatus = 'TODO'
): Task {
  return {
    id: taskId,
    title: `Task requiring ${roleRequired}`,
    status,
    assignment: {
      taskId,
      assignee: null,
      role_required: roleRequired,
      assigned_at: new Date().toISOString(),
      assigned_by: null,
      state: 'AVAILABLE_FOR_PICKUP',
    },
    assignment_history: [],
  };
}

/**
 * Creates an already assigned task.
 */
function createAssignedTask(
  taskId: string,
  assigneeId: string,
  roleRequired: Role | null = null,
  status: TaskStatus = 'TODO'
): Task {
  return {
    id: taskId,
    title: `Assigned task to ${assigneeId}`,
    status,
    assignment: {
      taskId,
      assignee: assigneeId,
      role_required: roleRequired,
      assigned_at: new Date().toISOString(),
      assigned_by: null,
      state: 'ASSIGNED',
    },
    assignment_history: [{
      previous_assignee: null,
      new_assignee: assigneeId,
      timestamp: new Date().toISOString(),
      reason: 'Initial assignment',
    }],
  };
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('Task_Assigner Unit Tests', () => {
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
  // 1. Assignment Tests
  // Validates: Requirements 3.1, 3.3, 3.4, 4.1, 4.2, 4.3
  // ===========================================================================
  describe('1. Assignment Tests', () => {
    describe('Assign task to valid developer with matching role', () => {
      it('should successfully assign task to developer with required role', () => {
        // Setup: Register a backend developer
        const developer = createValidMember({
          id: 'dev-backend',
          name: 'Backend Developer',
          roles: ['backend'],
        });
        teamManager.registerMember(developer);

        // Setup: Create a task requiring backend role
        const task = createTaskWithRoleRequired('TASK-001', 'backend');
        taskStorage.addTask(task);

        // Act: Assign the task
        const result = taskAssigner.assignTask('TASK-001', 'dev-backend');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.taskId).toBe('TASK-001');
          expect(result.value.assignee).toBe('dev-backend');
          expect(result.value.role_required).toBe('backend');
          expect(result.value.state).toBe('ASSIGNED');
          expect(result.value.assigned_at).toBeDefined();
        }
      });

      it('should successfully assign task to developer with multiple roles including required role', () => {
        // Setup: Register a fullstack developer with multiple roles
        const developer = createValidMember({
          id: 'dev-fullstack',
          name: 'Fullstack Developer',
          roles: ['frontend', 'backend', 'devops'],
        });
        teamManager.registerMember(developer);

        // Setup: Create a task requiring backend role
        const task = createTaskWithRoleRequired('TASK-002', 'backend');
        taskStorage.addTask(task);

        // Act
        const result = taskAssigner.assignTask('TASK-002', 'dev-fullstack');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.assignee).toBe('dev-fullstack');
        }
      });

      it('should successfully assign task without role_required to any developer', () => {
        // Setup: Register a developer
        const developer = createValidMember({
          id: 'dev-any',
          name: 'Any Developer',
          roles: ['qa'],
        });
        teamManager.registerMember(developer);

        // Setup: Create a task without role requirement
        const task = createValidTask({
          id: 'TASK-003',
          status: 'TODO',
        });
        taskStorage.addTask(task);

        // Act
        const result = taskAssigner.assignTask('TASK-003', 'dev-any');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.assignee).toBe('dev-any');
          expect(result.value.role_required).toBeNull();
        }
      });

      it('should record assignment timestamp (Requirement 4.3)', () => {
        // Setup
        const developer = createValidMember({ id: 'dev-time' });
        teamManager.registerMember(developer);
        const task = createValidTask({ id: 'TASK-004' });
        taskStorage.addTask(task);

        const beforeAssignment = new Date().toISOString();

        // Act
        const result = taskAssigner.assignTask('TASK-004', 'dev-time');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.assigned_at).toBeDefined();
          expect(new Date(result.value.assigned_at).getTime()).toBeGreaterThanOrEqual(
            new Date(beforeAssignment).getTime()
          );
        }
      });

      it('should assign task in READY status', () => {
        const developer = createValidMember({ id: 'dev-ready' });
        teamManager.registerMember(developer);
        const task = createValidTask({ id: 'TASK-READY', status: 'READY' });
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-READY', 'dev-ready');

        expect(result.success).toBe(true);
      });

      it('should assign task in BLOCKED status', () => {
        const developer = createValidMember({ id: 'dev-blocked' });
        teamManager.registerMember(developer);
        const task = createValidTask({ id: 'TASK-BLOCKED', status: 'BLOCKED' });
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-BLOCKED', 'dev-blocked');

        expect(result.success).toBe(true);
      });
    });

    describe('Reject assignment when developer does not exist (error 1101)', () => {
      it('should reject assignment to non-existent developer with DEVELOPER_NOT_FOUND error', () => {
        // Setup: Create a task but don't register any developer
        const task = createValidTask({ id: 'TASK-005' });
        taskStorage.addTask(task);

        // Act
        const result = taskAssigner.assignTask('TASK-005', 'non-existent-dev');

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.DEVELOPER_NOT_FOUND);
          expect(result.error.code).toBe(1101);
          expect(result.error.category).toBe('ASSIGNMENT_ERROR');
          expect(result.error.context?.developer_id).toBe('non-existent-dev');
          expect(result.error.message).toContain('non-existent-dev');
        }
      });

      it('should include task_id in error context for non-existent developer', () => {
        const task = createValidTask({ id: 'TASK-006' });
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-006', 'ghost-dev');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1101);
          expect(result.error.context?.task_id).toBe('TASK-006');
        }
      });

      it('should include suggested_action in error for non-existent developer', () => {
        const task = createValidTask({ id: 'TASK-007' });
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-007', 'unknown-dev');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.suggested_action).toBeDefined();
          expect(result.error.suggested_action?.length).toBeGreaterThan(0);
        }
      });
    });

    describe('Reject assignment when developer lacks required role (error 1102)', () => {
      it('should reject assignment with ROLE_MISMATCH when developer lacks required role', () => {
        // Setup: Register a frontend developer
        const developer = createValidMember({
          id: 'dev-frontend',
          name: 'Frontend Developer',
          roles: ['frontend'],
        });
        teamManager.registerMember(developer);

        // Setup: Create a task requiring backend role
        const task = createTaskWithRoleRequired('TASK-008', 'backend');
        taskStorage.addTask(task);

        // Act
        const result = taskAssigner.assignTask('TASK-008', 'dev-frontend');

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
          expect(result.error.code).toBe(1102);
          expect(result.error.category).toBe('ASSIGNMENT_ERROR');
          expect(result.error.context?.developer_id).toBe('dev-frontend');
          expect(result.error.context?.required_role).toBe('backend');
          expect(result.error.context?.developer_roles).toEqual(['frontend']);
        }
      });

      it('should reject assignment when developer has other roles but not the required one', () => {
        const developer = createValidMember({
          id: 'dev-multi',
          roles: ['qa', 'devops', 'lead'],
        });
        teamManager.registerMember(developer);

        const task = createTaskWithRoleRequired('TASK-009', 'frontend');
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-009', 'dev-multi');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1102);
          expect(result.error.context?.required_role).toBe('frontend');
          expect(result.error.context?.developer_roles).toEqual(['qa', 'devops', 'lead']);
        }
      });

      it('should include task_id in ROLE_MISMATCH error context', () => {
        const developer = createValidMember({
          id: 'dev-qa-only',
          roles: ['qa'],
        });
        teamManager.registerMember(developer);

        const task = createTaskWithRoleRequired('TASK-010', 'devops');
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-010', 'dev-qa-only');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.context?.task_id).toBe('TASK-010');
        }
      });
    });

    describe('Reject assignment when task is already assigned (error 1103)', () => {
      it('should reject assignment with TASK_ALREADY_ASSIGNED when task has assignee', () => {
        // Setup: Register two developers
        const dev1 = createValidMember({ id: 'dev-1', roles: ['backend'] });
        const dev2 = createValidMember({ id: 'dev-2', roles: ['backend'] });
        teamManager.registerMember(dev1);
        teamManager.registerMember(dev2);

        // Setup: Create an already assigned task
        const task = createAssignedTask('TASK-011', 'dev-1', 'backend');
        taskStorage.addTask(task);

        // Act: Try to assign to a different developer
        const result = taskAssigner.assignTask('TASK-011', 'dev-2');

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.TASK_ALREADY_ASSIGNED);
          expect(result.error.code).toBe(1103);
          expect(result.error.context?.task_id).toBe('TASK-011');
          expect(result.error.context?.developer_id).toBe('dev-1');
        }
      });

      it('should include current assignee in error message', () => {
        const dev1 = createValidMember({ id: 'alice', roles: ['frontend'] });
        const dev2 = createValidMember({ id: 'bob', roles: ['frontend'] });
        teamManager.registerMember(dev1);
        teamManager.registerMember(dev2);

        const task = createAssignedTask('TASK-012', 'alice', 'frontend');
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-012', 'bob');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toContain('alice');
        }
      });

      it('should allow reassignment to the same developer (idempotent)', () => {
        const developer = createValidMember({ id: 'dev-same', roles: ['backend'] });
        teamManager.registerMember(developer);

        // First assignment
        const task = createValidTask({ id: 'TASK-013' });
        taskStorage.addTask(task);
        
        const firstResult = taskAssigner.assignTask('TASK-013', 'dev-same');
        expect(firstResult.success).toBe(true);

        // Reassignment to same developer should succeed (idempotent)
        const secondResult = taskAssigner.assignTask('TASK-013', 'dev-same');
        expect(secondResult.success).toBe(true);
      });
    });

    describe('Reject assignment when task is in invalid state (error 1104)', () => {
      it('should reject assignment with TASK_NOT_ASSIGNABLE when task is IN_PROGRESS', () => {
        const developer = createValidMember({ id: 'dev-prog' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-014', status: 'IN_PROGRESS' });
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-014', 'dev-prog');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.TASK_NOT_ASSIGNABLE);
          expect(result.error.code).toBe(1104);
          expect(result.error.context?.task_id).toBe('TASK-014');
          expect(result.error.context?.current_status).toBe('IN_PROGRESS');
        }
      });

      it('should reject assignment when task is VERIFY', () => {
        const developer = createValidMember({ id: 'dev-verify' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-015', status: 'VERIFY' });
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-015', 'dev-verify');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1104);
          expect(result.error.context?.current_status).toBe('VERIFY');
        }
      });

      it('should reject assignment when task is DONE', () => {
        const developer = createValidMember({ id: 'dev-done' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-016', status: 'DONE' });
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-016', 'dev-done');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1104);
          expect(result.error.context?.current_status).toBe('DONE');
        }
      });

      it('should include list of valid statuses in suggested_action', () => {
        const developer = createValidMember({ id: 'dev-status' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-017', status: 'DONE' });
        taskStorage.addTask(task);

        const result = taskAssigner.assignTask('TASK-017', 'dev-status');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.suggested_action).toBeDefined();
          // Should mention valid assignable statuses
          const action = result.error.suggested_action || '';
          expect(
            action.includes('TODO') || action.includes('READY') || action.includes('BLOCKED')
          ).toBe(true);
        }
      });
    });

    describe('Reject assignment when task does not exist', () => {
      it('should reject assignment with TASK_NOT_FOUND when task does not exist', () => {
        const developer = createValidMember({ id: 'dev-notask' });
        teamManager.registerMember(developer);

        const result = taskAssigner.assignTask('NON-EXISTENT-TASK', 'dev-notask');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.TASK_NOT_FOUND);
          expect(result.error.code).toBe(1106);
          expect(result.error.context?.task_id).toBe('NON-EXISTENT-TASK');
        }
      });
    });
  });

  // ===========================================================================
  // 2. Unassignment Tests
  // Validates: Requirements 3.5
  // ===========================================================================
  describe('2. Unassignment Tests', () => {
    describe('Unassign task successfully', () => {
      it('should successfully unassign a task', () => {
        // Setup: Register a developer and assign a task
        const developer = createValidMember({ id: 'dev-unassign', roles: ['backend'] });
        teamManager.registerMember(developer);

        const task = createAssignedTask('TASK-020', 'dev-unassign', 'backend');
        taskStorage.addTask(task);

        // Act
        const result = taskAssigner.unassignTask('TASK-020');

        // Assert
        expect(result.success).toBe(true);
      });

      it('should update task assignment state to UNASSIGNED or AVAILABLE_FOR_PICKUP', () => {
        const developer = createValidMember({ id: 'dev-unassign2', roles: ['frontend'] });
        teamManager.registerMember(developer);

        // Create task with role_required
        const task = createAssignedTask('TASK-021', 'dev-unassign2', 'frontend');
        taskStorage.addTask(task);

        taskAssigner.unassignTask('TASK-021');

        // Check the task's assignment state
        const assignment = taskAssigner.getAssignment('TASK-021');
        expect(assignment).not.toBeNull();
        if (assignment) {
          expect(assignment.assignee).toBeNull();
          // Should be AVAILABLE_FOR_PICKUP because role_required is preserved
          expect(
            assignment.state === 'UNASSIGNED' || assignment.state === 'AVAILABLE_FOR_PICKUP'
          ).toBe(true);
        }
      });

      it('should preserve role_required after unassignment', () => {
        const developer = createValidMember({ id: 'dev-preserve', roles: ['devops'] });
        teamManager.registerMember(developer);

        const task = createAssignedTask('TASK-022', 'dev-preserve', 'devops');
        taskStorage.addTask(task);

        taskAssigner.unassignTask('TASK-022');

        const assignment = taskAssigner.getAssignment('TASK-022');
        expect(assignment).not.toBeNull();
        if (assignment) {
          expect(assignment.role_required).toBe('devops');
        }
      });
    });

    describe('Reject unassignment when task not assigned', () => {
      it('should reject unassignment with TASK_NOT_ASSIGNED when task has no assignee', () => {
        // Setup: Create an unassigned task
        const task = createValidTask({ id: 'TASK-023' });
        taskStorage.addTask(task);

        // Act
        const result = taskAssigner.unassignTask('TASK-023');

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.TASK_NOT_ASSIGNED);
          expect(result.error.code).toBe(1107);
          expect(result.error.context?.task_id).toBe('TASK-023');
        }
      });

      it('should reject unassignment when task does not exist', () => {
        const result = taskAssigner.unassignTask('NON-EXISTENT');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.TASK_NOT_FOUND);
        }
      });

      it('should reject unassignment when task has AVAILABLE_FOR_PICKUP state but no assignee', () => {
        const task = createTaskWithRoleRequired('TASK-024', 'qa');
        taskStorage.addTask(task);

        const result = taskAssigner.unassignTask('TASK-024');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1107);
        }
      });
    });
  });

  // ===========================================================================
  // 3. Pickup Tests
  // Validates: Requirements 3.5, 3.6
  // ===========================================================================
  describe('3. Pickup Tests', () => {
    describe('Developer picks up task with matching role', () => {
      it('should allow developer to pick up unassigned task with matching role', () => {
        // Setup: Register a developer
        const developer = createValidMember({
          id: 'dev-pickup',
          roles: ['qa'],
        });
        teamManager.registerMember(developer);

        // Setup: Create an unassigned task with role_required
        const task = createTaskWithRoleRequired('TASK-025', 'qa');
        taskStorage.addTask(task);

        // Act
        const result = taskAssigner.pickupTask('TASK-025', 'dev-pickup');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.assignee).toBe('dev-pickup');
          expect(result.value.state).toBe('ASSIGNED');
        }
      });

      it('should allow developer to pick up task without role_required', () => {
        const developer = createValidMember({
          id: 'dev-any-pickup',
          roles: ['lead'],
        });
        teamManager.registerMember(developer);

        const task = createValidTask({
          id: 'TASK-026',
          status: 'READY',
        });
        taskStorage.addTask(task);

        const result = taskAssigner.pickupTask('TASK-026', 'dev-any-pickup');

        expect(result.success).toBe(true);
      });

      it('should allow developer with multiple roles to pick up task matching any of their roles', () => {
        const developer = createValidMember({
          id: 'dev-multi-pickup',
          roles: ['frontend', 'backend', 'qa'],
        });
        teamManager.registerMember(developer);

        const task = createTaskWithRoleRequired('TASK-027', 'backend');
        taskStorage.addTask(task);

        const result = taskAssigner.pickupTask('TASK-027', 'dev-multi-pickup');

        expect(result.success).toBe(true);
      });
    });

    describe('Reject pickup when developer lacks required role', () => {
      it('should reject pickup with ROLE_MISMATCH when developer lacks required role', () => {
        const developer = createValidMember({
          id: 'dev-wrong-role',
          roles: ['frontend'],
        });
        teamManager.registerMember(developer);

        const task = createTaskWithRoleRequired('TASK-028', 'devops');
        taskStorage.addTask(task);

        const result = taskAssigner.pickupTask('TASK-028', 'dev-wrong-role');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
          expect(result.error.context?.required_role).toBe('devops');
          expect(result.error.context?.developer_roles).toEqual(['frontend']);
        }
      });

      it('should reject pickup when developer does not exist', () => {
        const task = createTaskWithRoleRequired('TASK-029', 'backend');
        taskStorage.addTask(task);

        const result = taskAssigner.pickupTask('TASK-029', 'ghost-developer');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.DEVELOPER_NOT_FOUND);
        }
      });

      it('should reject pickup when task is already assigned', () => {
        const dev1 = createValidMember({ id: 'dev-first', roles: ['backend'] });
        const dev2 = createValidMember({ id: 'dev-second', roles: ['backend'] });
        teamManager.registerMember(dev1);
        teamManager.registerMember(dev2);

        const task = createAssignedTask('TASK-030', 'dev-first', 'backend');
        taskStorage.addTask(task);

        const result = taskAssigner.pickupTask('TASK-030', 'dev-second');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.TASK_ALREADY_ASSIGNED);
        }
      });
    });
  });

  // ===========================================================================
  // 4. History Tests
  // Validates: Requirements 16.1, 16.2, 16.3
  // ===========================================================================
  describe('4. History Tests', () => {
    describe('Verify history entry created on assignment', () => {
      it('should create history entry on initial assignment', () => {
        const developer = createValidMember({ id: 'dev-history1' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-031' });
        taskStorage.addTask(task);

        taskAssigner.assignTask('TASK-031', 'dev-history1');

        const history = taskAssigner.getAssignmentHistory('TASK-031');
        expect(history.length).toBe(1);
        expect(history[0].previous_assignee).toBeNull();
        expect(history[0].new_assignee).toBe('dev-history1');
        expect(history[0].timestamp).toBeDefined();
      });

      it('should include reason in history entry', () => {
        const developer = createValidMember({ id: 'dev-reason' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-032' });
        taskStorage.addTask(task);

        taskAssigner.assignTask('TASK-032', 'dev-reason');

        const history = taskAssigner.getAssignmentHistory('TASK-032');
        expect(history.length).toBe(1);
        expect(history[0].reason).toBeDefined();
      });

      it('should record accurate timestamp in history entry', () => {
        const developer = createValidMember({ id: 'dev-time-hist' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-033' });
        taskStorage.addTask(task);

        const beforeTime = new Date().toISOString();
        taskAssigner.assignTask('TASK-033', 'dev-time-hist');
        const afterTime = new Date().toISOString();

        const history = taskAssigner.getAssignmentHistory('TASK-033');
        expect(history.length).toBe(1);
        const historyTime = new Date(history[0].timestamp).getTime();
        expect(historyTime).toBeGreaterThanOrEqual(new Date(beforeTime).getTime());
        expect(historyTime).toBeLessThanOrEqual(new Date(afterTime).getTime());
      });
    });

    describe('Verify history entry created on unassignment', () => {
      it('should create history entry on unassignment', () => {
        const developer = createValidMember({ id: 'dev-unassign-hist' });
        teamManager.registerMember(developer);

        const task = createAssignedTask('TASK-034', 'dev-unassign-hist');
        taskStorage.addTask(task);

        taskAssigner.unassignTask('TASK-034');

        const history = taskAssigner.getAssignmentHistory('TASK-034');
        // Should have 2 entries: initial assignment + unassignment
        expect(history.length).toBe(2);
        
        const unassignEntry = history[1];
        expect(unassignEntry.previous_assignee).toBe('dev-unassign-hist');
        expect(unassignEntry.new_assignee).toBeNull();
        expect(unassignEntry.timestamp).toBeDefined();
      });

      it('should preserve previous history entries after unassignment', () => {
        const developer = createValidMember({ id: 'dev-preserve-hist' });
        teamManager.registerMember(developer);

        const task = createAssignedTask('TASK-035', 'dev-preserve-hist');
        taskStorage.addTask(task);

        taskAssigner.unassignTask('TASK-035');

        const history = taskAssigner.getAssignmentHistory('TASK-035');
        expect(history.length).toBe(2);
        
        // First entry should be from createAssignedTask
        expect(history[0].new_assignee).toBe('dev-preserve-hist');
      });
    });

    describe('Verify history entry created on reassignment', () => {
      it('should create history entry on reassignment', () => {
        const dev1 = createValidMember({ id: 'dev-orig', roles: ['backend'] });
        const dev2 = createValidMember({ id: 'dev-new', roles: ['backend'] });
        teamManager.registerMember(dev1);
        teamManager.registerMember(dev2);

        // Create task and assign to dev1
        const task = createValidTask({ id: 'TASK-036' });
        taskStorage.addTask(task);
        taskAssigner.assignTask('TASK-036', 'dev-orig');

        // Unassign and reassign to dev2
        taskAssigner.unassignTask('TASK-036');
        taskAssigner.assignTask('TASK-036', 'dev-new');

        const history = taskAssigner.getAssignmentHistory('TASK-036');
        expect(history.length).toBe(3); // initial + unassign + reassign

        // Check reassignment entry
        const reassignEntry = history[2];
        expect(reassignEntry.previous_assignee).toBeNull(); // After unassignment
        expect(reassignEntry.new_assignee).toBe('dev-new');
      });

      it('should preserve complete assignment history chain', () => {
        const dev1 = createValidMember({ id: 'dev-a', roles: ['backend'] });
        const dev2 = createValidMember({ id: 'dev-b', roles: ['backend'] });
        const dev3 = createValidMember({ id: 'dev-c', roles: ['backend'] });
        teamManager.registerMember(dev1);
        teamManager.registerMember(dev2);
        teamManager.registerMember(dev3);

        const task = createValidTask({ id: 'TASK-037' });
        taskStorage.addTask(task);

        // Assign to dev-a
        taskAssigner.assignTask('TASK-037', 'dev-a');
        // Unassign
        taskAssigner.unassignTask('TASK-037');
        // Assign to dev-b
        taskAssigner.assignTask('TASK-037', 'dev-b');
        // Unassign
        taskAssigner.unassignTask('TASK-037');
        // Assign to dev-c
        taskAssigner.assignTask('TASK-037', 'dev-c');

        const history = taskAssigner.getAssignmentHistory('TASK-037');
        expect(history.length).toBe(5);

        // Verify chain integrity
        expect(history[0].new_assignee).toBe('dev-a');
        expect(history[1].previous_assignee).toBe('dev-a');
        expect(history[1].new_assignee).toBeNull();
        expect(history[2].new_assignee).toBe('dev-b');
        expect(history[3].previous_assignee).toBe('dev-b');
        expect(history[3].new_assignee).toBeNull();
        expect(history[4].new_assignee).toBe('dev-c');
      });
    });

    describe('getAssignmentHistory returns all entries with timestamps (Requirement 16.3)', () => {
      it('should return empty array for task with no history', () => {
        const task = createValidTask({ id: 'TASK-038' });
        taskStorage.addTask(task);

        const history = taskAssigner.getAssignmentHistory('TASK-038');
        expect(history).toEqual([]);
      });

      it('should return empty array for non-existent task', () => {
        const history = taskAssigner.getAssignmentHistory('NON-EXISTENT');
        expect(history).toEqual([]);
      });

      it('should return all history entries with timestamps', () => {
        const developer = createValidMember({ id: 'dev-all-hist' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-039' });
        taskStorage.addTask(task);

        taskAssigner.assignTask('TASK-039', 'dev-all-hist');
        taskAssigner.unassignTask('TASK-039');

        const history = taskAssigner.getAssignmentHistory('TASK-039');
        
        // All entries should have timestamps
        for (const entry of history) {
          expect(entry.timestamp).toBeDefined();
          expect(typeof entry.timestamp).toBe('string');
          expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
        }
      });
    });
  });

  // ===========================================================================
  // 5. Query Tests
  // Validates: Requirements 3.5, 3.6
  // ===========================================================================
  describe('5. Query Tests', () => {
    describe('getTasksByDeveloper returns correct tasks', () => {
      beforeEach(() => {
        // Setup: Create multiple developers
        const dev1 = createValidMember({ id: 'dev-alice', roles: ['backend'] });
        const dev2 = createValidMember({ id: 'dev-bob', roles: ['frontend'] });
        teamManager.registerMember(dev1);
        teamManager.registerMember(dev2);

        // Create and assign tasks
        const task1 = createValidTask({ id: 'TASK-040' });
        const task2 = createValidTask({ id: 'TASK-041' });
        const task3 = createValidTask({ id: 'TASK-042' });
        const task4 = createValidTask({ id: 'TASK-043' });
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);
        taskStorage.addTask(task3);
        taskStorage.addTask(task4);

        // Assign tasks
        taskAssigner.assignTask('TASK-040', 'dev-alice');
        taskAssigner.assignTask('TASK-041', 'dev-alice');
        taskAssigner.assignTask('TASK-042', 'dev-bob');
        // TASK-043 remains unassigned
      });

      it('should return all tasks assigned to a specific developer', () => {
        const aliceTasks = taskAssigner.getTasksByDeveloper('dev-alice');
        
        expect(aliceTasks.length).toBe(2);
        const taskIds = aliceTasks.map(t => t.id);
        expect(taskIds).toContain('TASK-040');
        expect(taskIds).toContain('TASK-041');
      });

      it('should return correct tasks for different developers', () => {
        const bobTasks = taskAssigner.getTasksByDeveloper('dev-bob');
        
        expect(bobTasks.length).toBe(1);
        expect(bobTasks[0].id).toBe('TASK-042');
      });

      it('should return empty array for developer with no assigned tasks', () => {
        const dev3 = createValidMember({ id: 'dev-charlie', roles: ['qa'] });
        teamManager.registerMember(dev3);

        const charlieTasks = taskAssigner.getTasksByDeveloper('dev-charlie');
        expect(charlieTasks).toEqual([]);
      });

      it('should return empty array for non-existent developer', () => {
        const tasks = taskAssigner.getTasksByDeveloper('ghost-dev');
        expect(tasks).toEqual([]);
      });
    });

    describe('getUnassignedTasks returns tasks filtered by role', () => {
      beforeEach(() => {
        // Setup: Create tasks with different role requirements
        const task1 = createTaskWithRoleRequired('TASK-050', 'backend');
        const task2 = createTaskWithRoleRequired('TASK-051', 'backend');
        const task3 = createTaskWithRoleRequired('TASK-052', 'frontend');
        const task4 = createTaskWithRoleRequired('TASK-053', 'qa');
        const task5 = createValidTask({ id: 'TASK-054' }); // No role_required
        
        taskStorage.addTask(task1);
        taskStorage.addTask(task2);
        taskStorage.addTask(task3);
        taskStorage.addTask(task4);
        taskStorage.addTask(task5);
      });

      it('should return all unassigned tasks when no role filter provided', () => {
        const unassignedTasks = taskAssigner.getUnassignedTasks();
        
        expect(unassignedTasks.length).toBe(5);
      });

      it('should return only tasks matching the specified role filter', () => {
        const backendTasks = taskAssigner.getUnassignedTasks('backend');
        
        expect(backendTasks.length).toBe(2);
        const taskIds = backendTasks.map(t => t.id);
        expect(taskIds).toContain('TASK-050');
        expect(taskIds).toContain('TASK-051');
      });

      it('should return tasks matching frontend role', () => {
        const frontendTasks = taskAssigner.getUnassignedTasks('frontend');
        
        expect(frontendTasks.length).toBe(1);
        expect(frontendTasks[0].id).toBe('TASK-052');
      });

      it('should return empty array when no tasks match the role filter', () => {
        const devopsTasks = taskAssigner.getUnassignedTasks('devops');
        
        expect(devopsTasks).toEqual([]);
      });

      it('should not return assigned tasks', () => {
        // Assign one of the backend tasks
        const developer = createValidMember({ id: 'dev-query', roles: ['backend'] });
        teamManager.registerMember(developer);
        taskAssigner.assignTask('TASK-050', 'dev-query');

        const backendTasks = taskAssigner.getUnassignedTasks('backend');
        
        expect(backendTasks.length).toBe(1);
        expect(backendTasks[0].id).toBe('TASK-051');
      });

      it('should return tasks that were unassigned after being assigned', () => {
        const developer = createValidMember({ id: 'dev-unassign-query', roles: ['frontend'] });
        teamManager.registerMember(developer);

        // Assign and then unassign
        taskAssigner.assignTask('TASK-052', 'dev-unassign-query');
        taskAssigner.unassignTask('TASK-052');

        const frontendTasks = taskAssigner.getUnassignedTasks('frontend');
        
        expect(frontendTasks.length).toBe(1);
        expect(frontendTasks[0].id).toBe('TASK-052');
      });
    });

    describe('getAssignment returns correct assignment info', () => {
      it('should return assignment for assigned task', () => {
        const developer = createValidMember({ id: 'dev-get-assign', roles: ['backend'] });
        teamManager.registerMember(developer);

        const task = createTaskWithRoleRequired('TASK-060', 'backend');
        taskStorage.addTask(task);
        taskAssigner.assignTask('TASK-060', 'dev-get-assign');

        const assignment = taskAssigner.getAssignment('TASK-060');
        
        expect(assignment).not.toBeNull();
        if (assignment) {
          expect(assignment.taskId).toBe('TASK-060');
          expect(assignment.assignee).toBe('dev-get-assign');
          expect(assignment.role_required).toBe('backend');
          expect(assignment.state).toBe('ASSIGNED');
        }
      });

      it('should return null for task without assignment', () => {
        const task = createValidTask({ id: 'TASK-061' });
        taskStorage.addTask(task);

        const assignment = taskAssigner.getAssignment('TASK-061');
        
        expect(assignment).toBeNull();
      });

      it('should return null for non-existent task', () => {
        const assignment = taskAssigner.getAssignment('NON-EXISTENT');
        expect(assignment).toBeNull();
      });

      it('should return assignment with AVAILABLE_FOR_PICKUP state for task with role_required but no assignee', () => {
        const task = createTaskWithRoleRequired('TASK-062', 'qa');
        taskStorage.addTask(task);

        const assignment = taskAssigner.getAssignment('TASK-062');
        
        expect(assignment).not.toBeNull();
        if (assignment) {
          expect(assignment.assignee).toBeNull();
          expect(assignment.role_required).toBe('qa');
          expect(assignment.state).toBe('AVAILABLE_FOR_PICKUP');
        }
      });
    });

    describe('validateAssignment returns same result as actual assignment', () => {
      it('should return success for valid assignment', () => {
        const developer = createValidMember({ id: 'dev-validate', roles: ['backend'] });
        teamManager.registerMember(developer);

        const task = createTaskWithRoleRequired('TASK-070', 'backend');
        taskStorage.addTask(task);

        const validateResult = taskAssigner.validateAssignment('TASK-070', 'dev-validate');
        expect(validateResult.success).toBe(true);
      });

      it('should return DEVELOPER_NOT_FOUND for non-existent developer', () => {
        const task = createValidTask({ id: 'TASK-071' });
        taskStorage.addTask(task);

        const validateResult = taskAssigner.validateAssignment('TASK-071', 'ghost');
        
        expect(validateResult.success).toBe(false);
        if (!validateResult.success) {
          expect(validateResult.error.code).toBe(AssignmentErrorCode.DEVELOPER_NOT_FOUND);
        }
      });

      it('should return ROLE_MISMATCH for developer without required role', () => {
        const developer = createValidMember({ id: 'dev-validate-role', roles: ['qa'] });
        teamManager.registerMember(developer);

        const task = createTaskWithRoleRequired('TASK-072', 'devops');
        taskStorage.addTask(task);

        const validateResult = taskAssigner.validateAssignment('TASK-072', 'dev-validate-role');
        
        expect(validateResult.success).toBe(false);
        if (!validateResult.success) {
          expect(validateResult.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
        }
      });

      it('should return TASK_NOT_ASSIGNABLE for task in invalid state', () => {
        const developer = createValidMember({ id: 'dev-validate-state' });
        teamManager.registerMember(developer);

        const task = createValidTask({ id: 'TASK-073', status: 'DONE' });
        taskStorage.addTask(task);

        const validateResult = taskAssigner.validateAssignment('TASK-073', 'dev-validate-state');
        
        expect(validateResult.success).toBe(false);
        if (!validateResult.success) {
          expect(validateResult.error.code).toBe(AssignmentErrorCode.TASK_NOT_ASSIGNABLE);
        }
      });

      it('validation result should match actual assignment result', () => {
        const developer = createValidMember({ id: 'dev-match', roles: ['frontend'] });
        teamManager.registerMember(developer);

        const task = createTaskWithRoleRequired('TASK-074', 'backend');
        taskStorage.addTask(task);

        const validateResult = taskAssigner.validateAssignment('TASK-074', 'dev-match');
        const assignResult = taskAssigner.assignTask('TASK-074', 'dev-match');

        expect(validateResult.success).toBe(assignResult.success);
        if (!validateResult.success && !assignResult.success) {
          expect(validateResult.error.code).toBe(assignResult.error.code);
        }
      });
    });
  });

  // ===========================================================================
  // Additional Edge Cases
  // ===========================================================================
  describe('Edge Cases', () => {
    it('should handle empty task ID gracefully', () => {
      const developer = createValidMember({ id: 'dev-edge' });
      teamManager.registerMember(developer);

      const result = taskAssigner.assignTask('', 'dev-edge');
      
      expect(result.success).toBe(false);
    });

    it('should handle empty developer ID gracefully', () => {
      const task = createValidTask({ id: 'TASK-EDGE-1' });
      taskStorage.addTask(task);

      const result = taskAssigner.assignTask('TASK-EDGE-1', '');
      
      expect(result.success).toBe(false);
    });

    it('should handle whitespace-only task ID gracefully', () => {
      const developer = createValidMember({ id: 'dev-whitespace' });
      teamManager.registerMember(developer);

      const result = taskAssigner.assignTask('   ', 'dev-whitespace');
      
      expect(result.success).toBe(false);
    });

    it('should handle concurrent-like operations correctly', () => {
      // Simulate multiple developers trying to assign/pickup the same task
      const dev1 = createValidMember({ id: 'dev-race-1', roles: ['backend'] });
      const dev2 = createValidMember({ id: 'dev-race-2', roles: ['backend'] });
      teamManager.registerMember(dev1);
      teamManager.registerMember(dev2);

      const task = createTaskWithRoleRequired('TASK-RACE', 'backend');
      taskStorage.addTask(task);

      // First assignment should succeed
      const result1 = taskAssigner.assignTask('TASK-RACE', 'dev-race-1');
      expect(result1.success).toBe(true);

      // Second assignment should fail
      const result2 = taskAssigner.assignTask('TASK-RACE', 'dev-race-2');
      expect(result2.success).toBe(false);
      if (!result2.success) {
        expect(result2.error.code).toBe(AssignmentErrorCode.TASK_ALREADY_ASSIGNED);
      }
    });

    it('should maintain data integrity after multiple operations', () => {
      const developer = createValidMember({ id: 'dev-integrity' });
      teamManager.registerMember(developer);

      const task = createValidTask({ id: 'TASK-INTEGRITY' });
      taskStorage.addTask(task);

      // Perform multiple operations
      taskAssigner.assignTask('TASK-INTEGRITY', 'dev-integrity');
      taskAssigner.unassignTask('TASK-INTEGRITY');
      taskAssigner.assignTask('TASK-INTEGRITY', 'dev-integrity');
      taskAssigner.unassignTask('TASK-INTEGRITY');
      taskAssigner.assignTask('TASK-INTEGRITY', 'dev-integrity');

      // Verify final state
      const assignment = taskAssigner.getAssignment('TASK-INTEGRITY');
      expect(assignment).not.toBeNull();
      if (assignment) {
        expect(assignment.assignee).toBe('dev-integrity');
        expect(assignment.state).toBe('ASSIGNED');
      }

      // Verify history completeness
      const history = taskAssigner.getAssignmentHistory('TASK-INTEGRITY');
      expect(history.length).toBe(5); // 3 assignments + 2 unassignments
    });
  });
});

// =============================================================================
// Mock Ownership_Manager Implementation for Unit Testing
// =============================================================================

/**
 * In-memory mock implementation of OwnershipManagerForAssigner for testing.
 */
class MockOwnershipManager implements OwnershipManagerForAssigner {
  private claimedTasks: Map<string, { ownerId: string; fencingToken: string; actorType: 'HUMAN' | 'AI_AGENT' }> = new Map();
  private tokenCounter = 0;
  
  /**
   * Track function calls for assertions.
   */
  public claimTaskCalls: Array<{ taskId: string; ownerId: string; actorType: 'HUMAN' | 'AI_AGENT' }> = [];
  
  /**
   * Set to simulate claim failure.
   */
  public simulateClaimFailure: boolean = false;
  public simulateClaimFailureCode: number = 2101; // TASK_ALREADY_CLAIMED
  public simulateClaimFailureMessage: string = 'Task is already claimed by another owner';

  /**
   * Generate a mock fencing token.
   */
  private generateToken(): string {
    this.tokenCounter++;
    return `mock-fencing-token-${this.tokenCounter}-${Date.now()}`;
  }

  /**
   * Claims ownership of a task.
   */
  async claimTask(
    taskId: string,
    ownerId: string,
    actorType: 'HUMAN' | 'AI_AGENT'
  ): Promise<{ success: true; value: { fencing_token: string; acquired_at: string } } | { success: false; error: { code: number; message: string } }> {
    // Record the call
    this.claimTaskCalls.push({ taskId, ownerId, actorType });
    
    // Simulate failure if configured
    if (this.simulateClaimFailure) {
      return {
        success: false,
        error: {
          code: this.simulateClaimFailureCode,
          message: this.simulateClaimFailureMessage,
        },
      };
    }

    // Check if task is already claimed by someone else
    const existing = this.claimedTasks.get(taskId);
    if (existing && existing.ownerId !== ownerId) {
      return {
        success: false,
        error: {
          code: 2101, // TASK_ALREADY_CLAIMED
          message: `Task ${taskId} is already claimed by ${existing.ownerId}`,
        },
      };
    }

    // Create new claim
    const fencingToken = this.generateToken();
    this.claimedTasks.set(taskId, { ownerId, fencingToken, actorType });

    return {
      success: true,
      value: {
        fencing_token: fencingToken,
        acquired_at: new Date().toISOString(),
      },
    };
  }

  /**
   * Releases ownership of a task.
   */
  async releaseTask(
    taskId: string,
    fencingToken: string
  ): Promise<{ success: true; value: void } | { success: false; error: { code: number; message: string } }> {
    const existing = this.claimedTasks.get(taskId);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 2104, // TASK_NOT_FOUND
          message: `Task ${taskId} not found`,
        },
      };
    }
    if (existing.fencingToken !== fencingToken) {
      return {
        success: false,
        error: {
          code: 2102, // INVALID_FENCING_TOKEN
          message: 'Fencing token does not match',
        },
      };
    }

    this.claimedTasks.delete(taskId);
    return { success: true, value: undefined };
  }

  /**
   * Clears all claims (for test reset).
   */
  clear(): void {
    this.claimedTasks.clear();
    this.claimTaskCalls = [];
    this.tokenCounter = 0;
    this.simulateClaimFailure = false;
  }

  /**
   * Gets the claim for a task (for test assertions).
   */
  getClaim(taskId: string): { ownerId: string; fencingToken: string; actorType: 'HUMAN' | 'AI_AGENT' } | null {
    return this.claimedTasks.get(taskId) ?? null;
  }
}

/**
 * Extended In-memory Team_Manager that supports actor type.
 */
class InMemoryTeamManagerWithActorType implements TeamManagerForAssigner {
  private members: Map<string, TeamMember & { actorType?: 'HUMAN' | 'AI_AGENT' }> = new Map();

  /**
   * Registers a new team member with optional actor type.
   */
  registerMember(member: TeamMember, actorType?: 'HUMAN' | 'AI_AGENT'): void {
    this.members.set(member.id, { ...member, actorType });
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
   * Gets the actor type of a team member.
   */
  getActorType(developerId: string): 'HUMAN' | 'AI_AGENT' | null {
    const member = this.members.get(developerId);
    return member?.actorType ?? null;
  }

  /**
   * Clears all members (for test reset).
   */
  clear(): void {
    this.members.clear();
  }
}

// =============================================================================
// Ownership Integration Tests
// =============================================================================

describe('Task_Assigner Ownership Integration Tests', () => {
  /**
   * **Validates: Requirements R02.3, R02.4**
   */
  let teamManager: InMemoryTeamManagerWithActorType;
  let taskStorage: InMemoryTaskStorage;
  let ownershipManager: MockOwnershipManager;
  let taskAssigner: TaskAssignerImpl;

  beforeEach(() => {
    teamManager = new InMemoryTeamManagerWithActorType();
    taskStorage = new InMemoryTaskStorage();
    ownershipManager = new MockOwnershipManager();
    taskAssigner = new TaskAssignerImpl({
      teamManager,
      taskStorage,
      currentUserId: 'lead-001',
      ownershipManager,
    });
  });

  // ===========================================================================
  // 6. assignTaskWithOwnership Tests
  // Validates: Requirements R02.3, R02.4
  // ===========================================================================
  describe('6. assignTaskWithOwnership Tests', () => {
    describe('Successful assignment with ownership claim', () => {
      it('should call claimTask and return fencing token on successful assignment', async () => {
        // Setup: Register a developer
        const developer = createValidMember({ id: 'dev-ownership', roles: ['backend'] });
        teamManager.registerMember(developer);

        // Setup: Create a task
        const task = createValidTask({ id: 'TASK-OWN-001' });
        taskStorage.addTask(task);

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('TASK-OWN-001', 'dev-ownership');

        // Assert: Assignment succeeded
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.taskId).toBe('TASK-OWN-001');
          expect(result.value.assignee).toBe('dev-ownership');
          expect(result.value.fencing_token).toBeDefined();
          expect(result.value.fencing_token).toContain('mock-fencing-token');
          expect(result.value.actor_type).toBe('HUMAN'); // Default
        }

        // Assert: claimTask was called with correct parameters
        expect(ownershipManager.claimTaskCalls.length).toBe(1);
        expect(ownershipManager.claimTaskCalls[0]).toEqual({
          taskId: 'TASK-OWN-001',
          ownerId: 'dev-ownership',
          actorType: 'HUMAN',
        });
      });

      it('should use actor type from team manager when available', async () => {
        // Setup: Register an AI agent
        const aiAgent = createValidMember({ id: 'ai-agent-001', roles: ['backend'] });
        teamManager.registerMember(aiAgent, 'AI_AGENT');

        // Setup: Create a task
        const task = createValidTask({ id: 'TASK-OWN-002' });
        taskStorage.addTask(task);

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('TASK-OWN-002', 'ai-agent-001');

        // Assert: Actor type is AI_AGENT
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.actor_type).toBe('AI_AGENT');
        }

        // Assert: claimTask was called with AI_AGENT actor type
        expect(ownershipManager.claimTaskCalls[0].actorType).toBe('AI_AGENT');
      });

      it('should default to HUMAN when actor type is not specified in team manager', async () => {
        // Setup: Register a developer without explicit actor type
        const developer = createValidMember({ id: 'dev-default', roles: ['frontend'] });
        teamManager.registerMember(developer); // No actor type

        // Setup: Create a task
        const task = createValidTask({ id: 'TASK-OWN-003' });
        taskStorage.addTask(task);

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('TASK-OWN-003', 'dev-default');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.actor_type).toBe('HUMAN');
        }
        expect(ownershipManager.claimTaskCalls[0].actorType).toBe('HUMAN');
      });

      it('should store fencing token in task assignment', async () => {
        // Setup
        const developer = createValidMember({ id: 'dev-store', roles: ['backend'] });
        teamManager.registerMember(developer);
        const task = createValidTask({ id: 'TASK-OWN-004' });
        taskStorage.addTask(task);

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('TASK-OWN-004', 'dev-store');
        expect(result.success).toBe(true);

        // Assert: Fencing token is stored in the task
        const storedTask = taskStorage.getTask('TASK-OWN-004');
        expect(storedTask?.assignment?.fencing_token).toBeDefined();
        expect(storedTask?.assignment?.fencing_token).toContain('mock-fencing-token');
      });
    });

    describe('Failed assignment due to ownership claim failure', () => {
      it('should fail with TASK_ALREADY_ASSIGNED when task is already claimed by another user', async () => {
        // Setup: Register two developers
        const dev1 = createValidMember({ id: 'dev-first', roles: ['backend'] });
        const dev2 = createValidMember({ id: 'dev-second', roles: ['backend'] });
        teamManager.registerMember(dev1);
        teamManager.registerMember(dev2);

        // Setup: Create a task
        const task = createValidTask({ id: 'TASK-OWN-005' });
        taskStorage.addTask(task);

        // First assignment should succeed
        const result1 = await taskAssigner.assignTaskWithOwnership('TASK-OWN-005', 'dev-first');
        expect(result1.success).toBe(true);

        // Second assignment by different user should fail due to ownership
        const result2 = await taskAssigner.assignTaskWithOwnership('TASK-OWN-005', 'dev-second');
        expect(result2.success).toBe(false);
        if (!result2.success) {
          expect(result2.error.code).toBe(AssignmentErrorCode.TASK_ALREADY_ASSIGNED);
        }
      });

      it('should fail with OWNERSHIP_CLAIM_FAILED when claim fails for other reasons', async () => {
        // Setup
        const developer = createValidMember({ id: 'dev-claim-fail', roles: ['backend'] });
        teamManager.registerMember(developer);
        const task = createValidTask({ id: 'TASK-OWN-006' });
        taskStorage.addTask(task);

        // Configure mock to simulate a different claim failure
        ownershipManager.simulateClaimFailure = true;
        ownershipManager.simulateClaimFailureCode = 2113; // CLAIM_FAILED (not TASK_ALREADY_CLAIMED)
        ownershipManager.simulateClaimFailureMessage = 'Claim operation failed due to conflict';

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('TASK-OWN-006', 'dev-claim-fail');

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.OWNERSHIP_CLAIM_FAILED);
          expect(result.error.message).toContain('Failed to claim ownership');
        }
      });
    });

    describe('Validation errors before ownership claim', () => {
      it('should fail with DEVELOPER_NOT_FOUND before attempting claim', async () => {
        // Setup: Create a task but don't register the developer
        const task = createValidTask({ id: 'TASK-OWN-007' });
        taskStorage.addTask(task);

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('TASK-OWN-007', 'non-existent');

        // Assert: No claimTask call should be made
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.DEVELOPER_NOT_FOUND);
        }
        expect(ownershipManager.claimTaskCalls.length).toBe(0);
      });

      it('should fail with ROLE_MISMATCH before attempting claim', async () => {
        // Setup: Register a developer with wrong role
        const developer = createValidMember({ id: 'dev-wrong-role', roles: ['frontend'] });
        teamManager.registerMember(developer);

        // Create a task requiring backend role
        const task: Task = {
          id: 'TASK-OWN-008',
          title: 'Backend task',
          status: 'TODO',
          assignment: {
            taskId: 'TASK-OWN-008',
            assignee: null,
            role_required: 'backend',
            assigned_at: new Date().toISOString(),
            assigned_by: null,
            state: 'AVAILABLE_FOR_PICKUP',
          },
          assignment_history: [],
        };
        taskStorage.addTask(task);

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('TASK-OWN-008', 'dev-wrong-role');

        // Assert: No claimTask call should be made
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.ROLE_MISMATCH);
        }
        expect(ownershipManager.claimTaskCalls.length).toBe(0);
      });

      it('should fail with TASK_NOT_FOUND before attempting claim', async () => {
        // Setup: Register developer but no task
        const developer = createValidMember({ id: 'dev-no-task', roles: ['backend'] });
        teamManager.registerMember(developer);

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('NON-EXISTENT-TASK', 'dev-no-task');

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(AssignmentErrorCode.TASK_NOT_FOUND);
        }
        expect(ownershipManager.claimTaskCalls.length).toBe(0);
      });
    });

    describe('Assignment history with ownership', () => {
      it('should record history entry on successful assignment with ownership', async () => {
        // Setup
        const developer = createValidMember({ id: 'dev-history', roles: ['backend'] });
        teamManager.registerMember(developer);
        const task = createValidTask({ id: 'TASK-OWN-009' });
        taskStorage.addTask(task);

        // Act
        const result = await taskAssigner.assignTaskWithOwnership('TASK-OWN-009', 'dev-history');
        expect(result.success).toBe(true);

        // Assert: History entry created
        const history = taskAssigner.getAssignmentHistory('TASK-OWN-009');
        expect(history.length).toBe(1);
        expect(history[0].previous_assignee).toBeNull();
        expect(history[0].new_assignee).toBe('dev-history');
      });
    });
  });

  // ===========================================================================
  // 7. Backward Compatibility Tests
  // Validates: Existing functionality preserved
  // ===========================================================================
  describe('7. Backward Compatibility Tests', () => {
    describe('Synchronous assignTask still works without ownership', () => {
      it('should allow assignTask without ownership manager configured', () => {
        // Create a new TaskAssigner WITHOUT ownership manager
        const simpleTeamManager = new InMemoryTeamManager();
        const simpleTaskStorage = new InMemoryTaskStorage();
        const simpleTaskAssigner = new TaskAssignerImpl({
          teamManager: simpleTeamManager,
          taskStorage: simpleTaskStorage,
          currentUserId: 'lead-simple',
          // No ownershipManager
        });

        // Setup
        const developer = createValidMember({ id: 'dev-simple', roles: ['backend'] });
        simpleTeamManager.registerMember(developer);
        const task = createValidTask({ id: 'TASK-SIMPLE' });
        simpleTaskStorage.addTask(task);

        // Act: Synchronous assignTask
        const result = simpleTaskAssigner.assignTask('TASK-SIMPLE', 'dev-simple');

        // Assert: Assignment succeeded without fencing token
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.taskId).toBe('TASK-SIMPLE');
          expect(result.value.assignee).toBe('dev-simple');
          expect(result.value.fencing_token).toBeUndefined();
          expect(result.value.actor_type).toBeUndefined();
        }
      });

      it('synchronous assignTask does not call ownership manager', () => {
        // Setup with ownership manager
        const developer = createValidMember({ id: 'dev-sync', roles: ['backend'] });
        teamManager.registerMember(developer);
        const task = createValidTask({ id: 'TASK-SYNC' });
        taskStorage.addTask(task);

        // Act: Synchronous assignTask (even with ownershipManager configured)
        const result = taskAssigner.assignTask('TASK-SYNC', 'dev-sync');

        // Assert: Assignment succeeded
        expect(result.success).toBe(true);

        // Assert: Ownership manager was NOT called (sync version doesn't use it)
        expect(ownershipManager.claimTaskCalls.length).toBe(0);
      });
    });
  });
});
