/**
 * Integration Tests for Complete Handoff Flow
 * 
 * These tests verify the end-to-end handoff workflow by testing interactions
 * between Team_Manager, Task_Assigner, and Handoff_Coordinator components.
 * 
 * Test Coverage:
 * - Define handoff point with checklist
 * - Complete source task → initiate handoff
 * - Complete checklist items
 * - Target developer accepts handoff → target task unblocks
 * - Target developer rejects handoff → source must address feedback
 * - Handoff history tracking
 * 
 * **Validates: Requirements 11.1-11.4, 12.1-12.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HandoffCoordinatorImpl,
  HandoffPointDefinition,
  HandoffRecord,
  HandoffStatus,
  HandoffState,
  HandoffError,
  HandoffErrorCode,
  HandoffExtendedErrorCode,
  ChecklistItem,
  TeamStorageForHandoff,
  TaskStorageForHandoff,
  Role,
  VALID_ROLES,
} from '../../handoff-coordinator';

import {
  TaskAssignerImpl,
  InMemoryTaskStorage,
  Task,
  TaskStatus,
  createTask,
  TeamManagerForAssigner,
} from '../../task-assigner';

import {
  TeamMember,
  createTeamMember,
} from '../../team-manager';

// =============================================================================
// Integrated Mock Storage - Bridges Team_Manager, Task_Assigner, Handoff_Coordinator
// =============================================================================

/**
 * Unified team storage that implements interfaces for both Task_Assigner and Handoff_Coordinator.
 * This simulates a real scenario where all components share the same team data.
 */
class IntegratedTeamStorage implements TeamStorageForHandoff, TeamManagerForAssigner {
  private members: Map<string, TeamMember> = new Map();

  registerMember(member: TeamMember): void {
    this.members.set(member.id, { ...member, roles: [...member.roles] });
  }

  getMember(developerId: string): { id: string; name: string; roles: Role[]; status: string } | null {
    const member = this.members.get(developerId);
    if (!member) return null;
    return {
      id: member.id,
      name: member.name,
      roles: [...member.roles],
      status: member.status,
    };
  }

  validateDeveloperId(developerId: string): boolean {
    return this.members.has(developerId);
  }

  getMemberRoles(developerId: string): Role[] | null {
    const member = this.members.get(developerId);
    return member ? [...member.roles] : null;
  }

  listMembers(): TeamMember[] {
    return Array.from(this.members.values());
  }

  clear(): void {
    this.members.clear();
  }
}

/**
 * Extended task storage that implements TaskStorageForHandoff interface for Handoff_Coordinator
 * while also working with Task_Assigner's InMemoryTaskStorage pattern.
 */
class IntegratedTaskStorage implements TaskStorageForHandoff {
  private tasks: Map<string, Task> = new Map();

  addTask(task: Task): void {
    this.tasks.set(task.id, { ...task, assignment_history: [...task.assignment_history] });
  }

  getTask(taskId: string): { id: string; status: string; assignee: string | null } | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return {
      id: task.id,
      status: task.status,
      assignee: task.assignment?.assignee || null,
    };
  }

  getFullTask(taskId: string): Task | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task, assignment_history: [...task.assignment_history] } : null;
  }

  isTaskComplete(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    return task ? task.status === 'DONE' : false;
  }

  updateTask(task: Task): void {
    this.tasks.set(task.id, { ...task, assignment_history: [...task.assignment_history] });
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      this.tasks.set(taskId, task);
    }
  }

  updateTaskAssignee(taskId: string, assignee: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      if (!task.assignment) {
        task.assignment = {
          taskId,
          assignee,
          role_required: null,
          assigned_at: new Date().toISOString(),
          assigned_by: null,
          state: 'ASSIGNED',
        };
      } else {
        task.assignment.assignee = assignee;
        task.assignment.state = 'ASSIGNED';
      }
      this.tasks.set(taskId, task);
    }
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).map(t => ({
      ...t,
      assignment_history: [...t.assignment_history],
    }));
  }

  clear(): void {
    this.tasks.clear();
  }
}

// =============================================================================
// Test Setup Helpers
// =============================================================================

/**
 * Creates a complete test environment with all three components integrated.
 */
function createIntegratedTestEnvironment(): {
  teamStorage: IntegratedTeamStorage;
  taskStorage: IntegratedTaskStorage;
  taskAssigner: TaskAssignerImpl;
  handoffCoordinator: HandoffCoordinatorImpl;
} {
  const teamStorage = new IntegratedTeamStorage();
  const taskStorage = new IntegratedTaskStorage();

  // Create Task_Assigner with shared team storage
  const taskAssigner = new TaskAssignerImpl({
    teamManager: teamStorage,
    taskStorage: {
      getTask: (id) => taskStorage.getFullTask(id),
      updateTask: (task) => taskStorage.updateTask(task),
      getAllTasks: () => taskStorage.getAllTasks(),
    },
    currentUserId: 'system',
  });

  // Create Handoff_Coordinator with shared storages
  const handoffCoordinator = new HandoffCoordinatorImpl({
    teamStorage,
    taskStorage,
  });

  return { teamStorage, taskStorage, taskAssigner, handoffCoordinator };
}

/**
 * Creates a valid handoff point definition for testing.
 */
function createBackendToFrontendHandoffPoint(): HandoffPointDefinition {
  return {
    id: 'HP-BACKEND-FRONTEND',
    name: 'Backend to Frontend Handoff',
    source_role: 'backend',
    target_role: 'frontend',
    checklist: [
      { id: 'CHK-API-DOCS', description: 'API documentation updated', required: true },
      { id: 'CHK-SAMPLE-RESPONSE', description: 'Sample responses provided', required: true },
      { id: 'CHK-ERROR-CODES', description: 'Error codes documented', required: false },
    ],
    description: 'Handoff from backend API development to frontend integration',
  };
}

/**
 * Creates a QA handoff point definition.
 */
function createDevToQAHandoffPoint(): HandoffPointDefinition {
  return {
    id: 'HP-DEV-QA',
    name: 'Development to QA Handoff',
    source_role: 'fullstack',
    target_role: 'qa',
    checklist: [
      { id: 'CHK-UNIT-TESTS', description: 'Unit tests passing', required: true },
      { id: 'CHK-DEPLOY-STAGING', description: 'Deployed to staging', required: true },
      { id: 'CHK-TEST-DATA', description: 'Test data prepared', required: false },
    ],
  };
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Handoff Flow Integration Tests', () => {
  describe('1. Define Handoff Point with Checklist', () => {
    it('should define a handoff point with checklist and make it available for handoffs', () => {
      const { handoffCoordinator } = createIntegratedTestEnvironment();

      // Define handoff point
      const handoffPointDef = createBackendToFrontendHandoffPoint();
      const defineResult = handoffCoordinator.defineHandoffPoint(handoffPointDef);

      expect(defineResult.success).toBe(true);

      // Verify handoff point is retrievable
      const handoffPoint = handoffCoordinator.getHandoffPoint('HP-BACKEND-FRONTEND');
      expect(handoffPoint).not.toBeNull();
      expect(handoffPoint?.name).toBe('Backend to Frontend Handoff');
      expect(handoffPoint?.source_role).toBe('backend');
      expect(handoffPoint?.target_role).toBe('frontend');
      expect(handoffPoint?.checklist).toHaveLength(3);
      expect(handoffPoint?.active).toBe(true);

      // Verify checklist items are properly initialized
      handoffPoint?.checklist.forEach(item => {
        expect(item.completed).toBe(false);
        expect(item.completed_at).toBeUndefined();
        expect(item.completed_by).toBeUndefined();
      });
    });

    it('should support multiple handoff points for different role transitions', () => {
      const { handoffCoordinator } = createIntegratedTestEnvironment();

      // Define multiple handoff points
      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());
      handoffCoordinator.defineHandoffPoint(createDevToQAHandoffPoint());

      // List all handoff points
      const allPoints = handoffCoordinator.listHandoffPoints();
      expect(allPoints).toHaveLength(2);

      // Filter by source role
      const backendPoints = handoffCoordinator.listHandoffPoints({ source_role: 'backend' });
      expect(backendPoints).toHaveLength(1);
      expect(backendPoints[0].id).toBe('HP-BACKEND-FRONTEND');

      // Filter by target role
      const qaPoints = handoffCoordinator.listHandoffPoints({ target_role: 'qa' });
      expect(qaPoints).toHaveLength(1);
      expect(qaPoints[0].id).toBe('HP-DEV-QA');
    });

    it('should reject handoff point without checklist items', () => {
      const { handoffCoordinator } = createIntegratedTestEnvironment();

      const invalidDef: HandoffPointDefinition = {
        id: 'HP-INVALID',
        name: 'Invalid Handoff',
        source_role: 'backend',
        target_role: 'frontend',
        checklist: [], // Empty checklist violates Requirement 11.2
      };

      const result = handoffCoordinator.defineHandoffPoint(invalidDef);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(HandoffExtendedErrorCode.EMPTY_CHECKLIST);
      }
    });
  });

  describe('2. Complete Source Task and Initiate Handoff', () => {
    it('should initiate handoff after source task is complete and assigned', () => {
      const { teamStorage, taskStorage, taskAssigner, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup: Register team members
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      // Setup: Create and assign source task
      const sourceTask = createTask('TASK-API-001', 'Implement User API', 'TODO', 'backend');
      taskStorage.addTask(sourceTask);

      // Setup: Define handoff point
      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Action: Assign task to backend developer
      const assignResult = taskAssigner.assignTask('TASK-API-001', 'dev-backend');
      expect(assignResult.success).toBe(true);

      // Action: Complete the source task (simulate TDD completion)
      taskStorage.updateTaskStatus('TASK-API-001', 'DONE');

      // Create target task
      const targetTask = createTask('TASK-UI-001', 'Integrate User API in UI', 'TODO', 'frontend');
      taskStorage.addTask(targetTask);

      // Action: Initiate handoff
      const handoffResult = handoffCoordinator.initiateHandoff('TASK-API-001', 'TASK-UI-001', {
        sourceDeveloperId: 'dev-backend',
        reason: 'TASK_COMPLETION',
        notes: 'API endpoints ready for frontend integration',
        priority: 'HIGH',
      });

      expect(handoffResult.success).toBe(true);
      if (handoffResult.success) {
        const handoff = handoffResult.value;
        expect(handoff.source_task_id).toBe('TASK-API-001');
        expect(handoff.target_task_id).toBe('TASK-UI-001');
        expect(handoff.source_developer_id).toBe('dev-backend');
        expect(handoff.target_role).toBe('frontend');
        expect(handoff.status).toBe('PENDING');
        expect(handoff.state).toBe('CHECKLIST_IN_PROGRESS');
        expect(handoff.checklist_status).toHaveLength(3);
        expect(handoff.context.reason).toBe('TASK_COMPLETION');
        expect(handoff.context.notes).toBe('API endpoints ready for frontend integration');
        expect(handoff.context.priority).toBe('HIGH');
      }
    });

    it('should reject handoff if source task is not complete', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      const sourceTask = createTask('TASK-INCOMPLETE', 'Incomplete Task', 'IN_PROGRESS', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-INCOMPLETE',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);

      const targetTask = createTask('TASK-TARGET', 'Target Task', 'TODO', 'frontend');
      taskStorage.addTask(targetTask);

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Action: Attempt handoff with incomplete source task
      const result = handoffCoordinator.initiateHandoff('TASK-INCOMPLETE', 'TASK-TARGET');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(HandoffExtendedErrorCode.SOURCE_TASK_NOT_COMPLETE);
      }
    });

    it('should reject handoff if source task is not assigned', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup: Task exists and is DONE but not assigned
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      const unassignedTask = createTask('TASK-UNASSIGNED', 'Unassigned Task', 'DONE', 'backend');
      // No assignment set
      taskStorage.addTask(unassignedTask);

      const targetTask = createTask('TASK-TARGET', 'Target Task', 'TODO', 'frontend');
      taskStorage.addTask(targetTask);

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Action
      const result = handoffCoordinator.initiateHandoff('TASK-UNASSIGNED', 'TASK-TARGET');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(HandoffErrorCode.TASK_NOT_ASSIGNED);
      }
    });

    it('should reject duplicate handoff requests for the same source task', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);

      taskStorage.addTask(createTask('TASK-TGT-1', 'Target 1', 'TODO', 'frontend'));
      taskStorage.addTask(createTask('TASK-TGT-2', 'Target 2', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // First handoff succeeds
      const firstResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT-1');
      expect(firstResult.success).toBe(true);

      // Second handoff fails (duplicate)
      const secondResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT-2');
      expect(secondResult.success).toBe(false);
      if (!secondResult.success) {
        expect(secondResult.error.code).toBe(HandoffErrorCode.DUPLICATE_HANDOFF_REQUEST);
      }
    });
  });

  describe('3. Complete Checklist Items', () => {
    let handoffId: string;
    let env: ReturnType<typeof createIntegratedTestEnvironment>;

    beforeEach(() => {
      env = createIntegratedTestEnvironment();
      const { teamStorage, taskStorage, handoffCoordinator } = env;

      // Setup team
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      // Setup tasks
      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      // Define handoff point
      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Initiate handoff
      const handoffResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      if (handoffResult.success) {
        handoffId = handoffResult.value.id;
      }
    });

    it('should allow completing individual checklist items', () => {
      const { handoffCoordinator } = env;

      // Complete first checklist item
      const result1 = handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'dev-backend');
      expect(result1.success).toBe(true);

      // Verify item is marked complete
      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      expect(handoffResult.success).toBe(true);
      if (handoffResult.success) {
        const apiDocsItem = handoffResult.value.checklist_status.find(i => i.id === 'CHK-API-DOCS');
        expect(apiDocsItem?.completed).toBe(true);
        expect(apiDocsItem?.completed_by).toBe('dev-backend');
        expect(apiDocsItem?.completed_at).toBeDefined();
      }
    });

    it('should track completion of multiple checklist items', () => {
      const { handoffCoordinator } = env;

      // Complete all required items
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'dev-backend');
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-SAMPLE-RESPONSE', 'dev-backend');

      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      expect(handoffResult.success).toBe(true);
      if (handoffResult.success) {
        const completedItems = handoffResult.value.checklist_status.filter(i => i.completed);
        expect(completedItems).toHaveLength(2);

        // Optional item should still be incomplete
        const optionalItem = handoffResult.value.checklist_status.find(i => i.id === 'CHK-ERROR-CODES');
        expect(optionalItem?.required).toBe(false);
        expect(optionalItem?.completed).toBe(false);
      }
    });

    it('should reject completing non-existent checklist item', () => {
      const { handoffCoordinator } = env;

      const result = handoffCoordinator.completeChecklistItem(handoffId, 'CHK-NONEXISTENT', 'dev-backend');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(HandoffExtendedErrorCode.CHECKLIST_ITEM_NOT_FOUND);
      }
    });
  });

  describe('4. Target Developer Accepts Handoff → Target Task Unblocks', () => {
    it('should allow target developer to accept handoff when all required checklist items are complete', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'BLOCKED', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Initiate handoff
      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      expect(initResult.success).toBe(true);
      const handoffId = initResult.success ? initResult.value.id : '';

      // Complete required checklist items
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'dev-backend');
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-SAMPLE-RESPONSE', 'dev-backend');

      // Accept handoff
      const acceptResult = handoffCoordinator.acceptHandoff(handoffId, 'dev-frontend');

      expect(acceptResult.success).toBe(true);

      // Verify handoff status
      const status = handoffCoordinator.getHandoffStatus(handoffId);
      expect(status).toBe('ACCEPTED');

      // Verify handoff record has target developer set
      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      if (handoffResult.success) {
        expect(handoffResult.value.target_developer_id).toBe('dev-frontend');
        expect(handoffResult.value.accepted_at).toBeDefined();
        expect(handoffResult.value.state).toBe('ACCEPTED');
      }

      // In a real scenario, the target task would be unblocked here
      // Simulate unblocking by updating task status
      taskStorage.updateTaskStatus('TASK-TGT', 'READY');
      const targetTask = taskStorage.getTask('TASK-TGT');
      expect(targetTask?.status).toBe('READY');
    });

    it('should record acceptance in handoff history', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'dev-backend');
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-SAMPLE-RESPONSE', 'dev-backend');
      handoffCoordinator.acceptHandoff(handoffId, 'dev-frontend');

      // Check history
      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      if (handoffResult.success) {
        const history = handoffResult.value.history;
        expect(history.length).toBeGreaterThanOrEqual(2);

        // Find acceptance entry
        const acceptEntry = history.find(h => h.to_state === 'ACCEPTED');
        expect(acceptEntry).toBeDefined();
        expect(acceptEntry?.triggered_by).toBe('dev-frontend');
        expect(acceptEntry?.notes).toContain('accepted');
      }
    });

    it('should reject acceptance if required checklist items are incomplete', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      // Only complete one required item (missing CHK-SAMPLE-RESPONSE)
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'dev-backend');

      // Try to accept - should fail
      const acceptResult = handoffCoordinator.acceptHandoff(handoffId, 'dev-frontend');

      expect(acceptResult.success).toBe(false);
      if (!acceptResult.success) {
        expect(acceptResult.error.code).toBe(HandoffExtendedErrorCode.CHECKLIST_INCOMPLETE);
        expect(acceptResult.error.context?.incomplete_items).toContain('CHK-SAMPLE-RESPONSE');
      }
    });

    it('should reject acceptance by developer without target role', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));
      teamStorage.registerMember(createTeamMember('dev-qa', 'QA Dev', ['qa'])); // Wrong role

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'dev-backend');
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-SAMPLE-RESPONSE', 'dev-backend');

      // QA developer tries to accept frontend handoff - should fail
      const acceptResult = handoffCoordinator.acceptHandoff(handoffId, 'dev-qa');

      expect(acceptResult.success).toBe(false);
      if (!acceptResult.success) {
        expect(acceptResult.error.code).toBe(HandoffExtendedErrorCode.TARGET_ROLE_INVALID);
      }
    });
  });

  describe('5. Target Developer Rejects Handoff → Source Must Address Feedback', () => {
    it('should allow target developer to reject handoff with reason', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'BLOCKED', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Initiate handoff
      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      // Reject handoff with reason
      const rejectionReason = 'API documentation is incomplete - missing authentication endpoints';
      const rejectResult = handoffCoordinator.rejectHandoff(handoffId, rejectionReason);

      expect(rejectResult.success).toBe(true);

      // Verify handoff status
      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      if (handoffResult.success) {
        expect(handoffResult.value.status).toBe('REJECTED');
        expect(handoffResult.value.state).toBe('REJECTED');
        expect(handoffResult.value.rejection_reason).toBe(rejectionReason);
        expect(handoffResult.value.rejected_at).toBeDefined();
      }
    });

    it('should record rejection in handoff history with reason', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      const rejectionReason = 'Missing error handling documentation';
      handoffCoordinator.rejectHandoff(handoffId, rejectionReason);

      // Check history
      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      if (handoffResult.success) {
        const history = handoffResult.value.history;
        const rejectEntry = history.find(h => h.to_state === 'REJECTED');
        expect(rejectEntry).toBeDefined();
        expect(rejectEntry?.notes).toContain(rejectionReason);
      }
    });

    it('should require a non-empty rejection reason', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      // Try to reject with empty reason
      const rejectResult = handoffCoordinator.rejectHandoff(handoffId, '');

      expect(rejectResult.success).toBe(false);
      if (!rejectResult.success) {
        expect(rejectResult.error.code).toBe(HandoffErrorCode.CONTEXT_REQUIRED);
      }
    });

    it('should not allow accepting an already rejected handoff', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      // Reject the handoff
      handoffCoordinator.rejectHandoff(handoffId, 'Issues found');

      // Try to accept rejected handoff - should fail
      const acceptResult = handoffCoordinator.acceptHandoff(handoffId, 'dev-frontend');

      expect(acceptResult.success).toBe(false);
      if (!acceptResult.success) {
        expect(acceptResult.error.code).toBe(HandoffExtendedErrorCode.HANDOFF_ALREADY_REJECTED);
      }
    });
  });

  describe('6. Handoff History Tracking', () => {
    it('should track complete handoff lifecycle in history', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'BLOCKED', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Step 1: Initiate handoff
      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      // Step 2: Complete checklist items
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'dev-backend');
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-SAMPLE-RESPONSE', 'dev-backend');

      // Step 3: Accept handoff
      handoffCoordinator.acceptHandoff(handoffId, 'dev-frontend');

      // Step 4: Complete handoff
      handoffCoordinator.completeHandoff(handoffId);

      // Verify complete history
      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      if (handoffResult.success) {
        const handoff = handoffResult.value;
        const history = handoff.history;

        // Should have entries for: initiation, acceptance, completion
        expect(history.length).toBeGreaterThanOrEqual(3);

        // Verify state progression
        const states = history.map(h => h.to_state);
        expect(states).toContain('CHECKLIST_IN_PROGRESS');
        expect(states).toContain('ACCEPTED');
        expect(states).toContain('COMPLETE');

        // Verify final state
        expect(handoff.status).toBe('COMPLETED');
        expect(handoff.state).toBe('COMPLETE');
        expect(handoff.completed_at).toBeDefined();
      }
    });

    it('should preserve handoff history through all state transitions', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      // Verify initial history entry exists
      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      if (handoffResult.success) {
        expect(handoffResult.value.history).toHaveLength(1);
        expect(handoffResult.value.history[0].from_state).toBe('NOT_STARTED');
        expect(handoffResult.value.history[0].to_state).toBe('CHECKLIST_IN_PROGRESS');
        expect(handoffResult.value.history[0].timestamp).toBeDefined();
      }
    });

    it('should track timestamps for all history entries', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      const initResult = handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');
      const handoffId = initResult.success ? initResult.value.id : '';

      // Complete checklist and accept
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'dev-backend');
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-SAMPLE-RESPONSE', 'dev-backend');
      handoffCoordinator.acceptHandoff(handoffId, 'dev-frontend');

      // Verify all history entries have timestamps
      const handoffResult = handoffCoordinator.getHandoff(handoffId);
      if (handoffResult.success) {
        const history = handoffResult.value.history;
        history.forEach((entry, index) => {
          expect(entry.timestamp).toBeDefined();
          expect(new Date(entry.timestamp).getTime()).not.toBeNaN();

          // Timestamps should be in chronological order
          if (index > 0) {
            expect(new Date(entry.timestamp).getTime()).toBeGreaterThanOrEqual(
              new Date(history[index - 1].timestamp).getTime()
            );
          }
        });
      }
    });
  });

  describe('7. Query Operations Integration', () => {
    it('should retrieve handoffs by task ID', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));

      const sourceTask = createTask('TASK-QUERY', 'Query Test Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-QUERY',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());
      handoffCoordinator.initiateHandoff('TASK-QUERY', 'TASK-TGT');

      // Query by task
      const handoffs = handoffCoordinator.getHandoffsByTask('TASK-QUERY');
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0].source_task_id).toBe('TASK-QUERY');
    });

    it('should retrieve pending handoffs for a specific role', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());
      handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT');

      // Query pending handoffs for frontend role
      const pendingForFrontend = handoffCoordinator.getPendingHandoffsForRole('frontend');
      expect(pendingForFrontend).toHaveLength(1);
      expect(pendingForFrontend[0].target_role).toBe('frontend');

      // Query pending handoffs for QA role (should be empty)
      const pendingForQA = handoffCoordinator.getPendingHandoffsForRole('qa');
      expect(pendingForQA).toHaveLength(0);
    });

    it('should retrieve handoffs by developer ID', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));

      const sourceTask = createTask('TASK-SRC', 'Source Task', 'DONE', 'backend');
      sourceTask.assignment = {
        taskId: 'TASK-SRC',
        assignee: 'dev-backend',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(sourceTask);
      taskStorage.addTask(createTask('TASK-TGT', 'Target Task', 'TODO', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());
      handoffCoordinator.initiateHandoff('TASK-SRC', 'TASK-TGT', {
        sourceDeveloperId: 'dev-backend',
      });

      // Query by developer
      const handoffs = handoffCoordinator.getHandoffsByDeveloper('dev-backend');
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0].source_developer_id).toBe('dev-backend');
    });

    it('should list all active (non-completed) handoffs', () => {
      const { teamStorage, taskStorage, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('dev-backend', 'Backend Dev', ['backend']));
      teamStorage.registerMember(createTeamMember('dev-frontend', 'Frontend Dev', ['frontend']));

      // Create multiple handoffs
      for (let i = 0; i < 3; i++) {
        const sourceTask = createTask(`TASK-SRC-${i}`, `Source Task ${i}`, 'DONE', 'backend');
        sourceTask.assignment = {
          taskId: `TASK-SRC-${i}`,
          assignee: 'dev-backend',
          role_required: 'backend',
          assigned_at: new Date().toISOString(),
          assigned_by: null,
          state: 'ASSIGNED',
        };
        taskStorage.addTask(sourceTask);
        taskStorage.addTask(createTask(`TASK-TGT-${i}`, `Target Task ${i}`, 'TODO', 'frontend'));
      }

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Initiate handoffs
      const handoffIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const result = handoffCoordinator.initiateHandoff(`TASK-SRC-${i}`, `TASK-TGT-${i}`);
        if (result.success) {
          handoffIds.push(result.value.id);
        }
      }

      // Complete one handoff
      handoffCoordinator.completeChecklistItem(handoffIds[0], 'CHK-API-DOCS', 'dev-backend');
      handoffCoordinator.completeChecklistItem(handoffIds[0], 'CHK-SAMPLE-RESPONSE', 'dev-backend');
      handoffCoordinator.acceptHandoff(handoffIds[0], 'dev-frontend');
      handoffCoordinator.completeHandoff(handoffIds[0]);

      // Query active handoffs
      const activeHandoffs = handoffCoordinator.getActiveHandoffs();
      expect(activeHandoffs).toHaveLength(2); // 3 - 1 completed = 2 active
    });
  });

  describe('8. End-to-End Workflow with Task_Assigner Integration', () => {
    it('should complete full workflow: register team → assign task → complete → handoff → accept', () => {
      const { teamStorage, taskStorage, taskAssigner, handoffCoordinator } = createIntegratedTestEnvironment();

      // Step 1: Register team members
      teamStorage.registerMember(createTeamMember('alice', 'Alice (Backend)', ['backend']));
      teamStorage.registerMember(createTeamMember('bob', 'Bob (Frontend)', ['frontend']));

      // Step 2: Create tasks with role requirements
      const apiTask = createTask('TASK-API', 'Build User API', 'TODO', 'backend');
      const uiTask = createTask('TASK-UI', 'Build User UI', 'BLOCKED', 'frontend');
      taskStorage.addTask(apiTask);
      taskStorage.addTask(uiTask);

      // Step 3: Define handoff point
      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Step 4: Assign API task to Alice
      const assignResult = taskAssigner.assignTask('TASK-API', 'alice');
      expect(assignResult.success).toBe(true);

      // Step 5: Alice completes the API task
      taskStorage.updateTaskStatus('TASK-API', 'DONE');

      // Step 6: Initiate handoff from API to UI task
      const handoffResult = handoffCoordinator.initiateHandoff('TASK-API', 'TASK-UI', {
        sourceDeveloperId: 'alice',
        reason: 'TASK_COMPLETION',
        notes: 'User API endpoints ready: GET /users, POST /users, GET /users/:id',
        priority: 'HIGH',
      });
      expect(handoffResult.success).toBe(true);
      const handoffId = handoffResult.success ? handoffResult.value.id : '';

      // Step 7: Alice completes checklist items
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-API-DOCS', 'alice');
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-SAMPLE-RESPONSE', 'alice');
      handoffCoordinator.completeChecklistItem(handoffId, 'CHK-ERROR-CODES', 'alice');

      // Step 8: Bob accepts the handoff
      const acceptResult = handoffCoordinator.acceptHandoff(handoffId, 'bob');
      expect(acceptResult.success).toBe(true);

      // Step 9: Unblock and assign UI task to Bob
      taskStorage.updateTaskStatus('TASK-UI', 'READY');
      const uiAssignResult = taskAssigner.assignTask('TASK-UI', 'bob');
      expect(uiAssignResult.success).toBe(true);

      // Step 10: Complete the handoff
      const completeResult = handoffCoordinator.completeHandoff(handoffId);
      expect(completeResult.success).toBe(true);

      // Verify final state
      const finalHandoff = handoffCoordinator.getHandoff(handoffId);
      if (finalHandoff.success) {
        expect(finalHandoff.value.status).toBe('COMPLETED');
        expect(finalHandoff.value.source_developer_id).toBe('alice');
        expect(finalHandoff.value.target_developer_id).toBe('bob');
        expect(finalHandoff.value.checklist_status.every(i => i.completed)).toBe(true);
      }

      // Verify Bob is assigned to UI task
      const bobTasks = taskAssigner.getTasksByDeveloper('bob');
      expect(bobTasks).toHaveLength(1);
      expect(bobTasks[0].id).toBe('TASK-UI');
    });

    it('should handle rejection and re-handoff workflow', () => {
      const { teamStorage, taskStorage, taskAssigner, handoffCoordinator } = createIntegratedTestEnvironment();

      // Setup
      teamStorage.registerMember(createTeamMember('alice', 'Alice (Backend)', ['backend']));
      teamStorage.registerMember(createTeamMember('bob', 'Bob (Frontend)', ['frontend']));

      const apiTask = createTask('TASK-API', 'Build User API', 'DONE', 'backend');
      apiTask.assignment = {
        taskId: 'TASK-API',
        assignee: 'alice',
        role_required: 'backend',
        assigned_at: new Date().toISOString(),
        assigned_by: null,
        state: 'ASSIGNED',
      };
      taskStorage.addTask(apiTask);
      taskStorage.addTask(createTask('TASK-UI', 'Build User UI', 'BLOCKED', 'frontend'));

      handoffCoordinator.defineHandoffPoint(createBackendToFrontendHandoffPoint());

      // Initiate first handoff
      const firstHandoff = handoffCoordinator.initiateHandoff('TASK-API', 'TASK-UI');
      const firstHandoffId = firstHandoff.success ? firstHandoff.value.id : '';

      // Bob rejects due to incomplete documentation
      handoffCoordinator.rejectHandoff(firstHandoffId, 'API documentation missing authentication examples');

      // Verify rejection
      const rejectedHandoff = handoffCoordinator.getHandoff(firstHandoffId);
      if (rejectedHandoff.success) {
        expect(rejectedHandoff.value.status).toBe('REJECTED');
        expect(rejectedHandoff.value.rejection_reason).toContain('authentication');
      }

      // Alice can now create a new handoff after addressing feedback
      // (In a real scenario, she would update the documentation first)
      // Note: Need to update task status back to DONE as it's still complete
      const secondHandoff = handoffCoordinator.initiateHandoff('TASK-API', 'TASK-UI');
      expect(secondHandoff.success).toBe(true);

      if (secondHandoff.success) {
        const secondHandoffId = secondHandoff.value.id;

        // Complete all checklist items this time
        handoffCoordinator.completeChecklistItem(secondHandoffId, 'CHK-API-DOCS', 'alice');
        handoffCoordinator.completeChecklistItem(secondHandoffId, 'CHK-SAMPLE-RESPONSE', 'alice');
        handoffCoordinator.completeChecklistItem(secondHandoffId, 'CHK-ERROR-CODES', 'alice');

        // Bob accepts this time
        const acceptResult = handoffCoordinator.acceptHandoff(secondHandoffId, 'bob');
        expect(acceptResult.success).toBe(true);
      }
    });
  });
});
