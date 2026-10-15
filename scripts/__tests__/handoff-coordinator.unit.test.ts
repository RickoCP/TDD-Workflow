/**
 * Unit Tests for Handoff_Coordinator
 * 
 * These tests verify specific scenarios for the Handoff_Coordinator component
 * including handoff point definition, handoff initiation, acceptance/rejection,
 * checklist management, and query operations.
 * 
 * **Validates: Requirements 11.1-11.4, 12.1-12.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HandoffCoordinatorImpl,
  HandoffPointDefinition,
  HandoffPoint,
  HandoffRecord,
  HandoffRequest,
  HandoffContext,
  HandoffStatus,
  HandoffState,
  HandoffError,
  HandoffErrorCode,
  HandoffExtendedErrorCode,
  ChecklistItem,
  TeamStorageForHandoff,
  TaskStorageForHandoff,
  HandoffCoordinatorConfig,
  HANDOFF_STATUSES,
  HANDOFF_STATES,
  HANDOFF_REASONS,
  createHandoffPoint,
  createHandoffRecord,
  createChecklistItem,
  validateHandoffPointDefinition,
  areRequiredChecklistItemsComplete,
  getIncompleteRequiredItems,
  isValidHandoffStatus,
  isValidHandoffState,
  isValidHandoffReason,
  isValidStateTransition,
  stateToStatus,
  ok,
  err,
  Role,
  VALID_ROLES,
} from '../handoff-coordinator';

// =============================================================================
// Mock Storage Implementations for Testing
// =============================================================================

/**
 * In-memory team storage for testing purposes.
 */
class MockTeamStorage implements TeamStorageForHandoff {
  private members: Map<string, { id: string; name: string; roles: Role[]; status: string }> = new Map();

  registerMember(member: { id: string; name: string; roles: Role[]; status?: string }): void {
    this.members.set(member.id, {
      id: member.id,
      name: member.name,
      roles: [...member.roles],
      status: member.status || 'ACTIVE',
    });
  }

  getMember(developerId: string): { id: string; name: string; roles: Role[]; status: string } | null {
    return this.members.get(developerId) || null;
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

/**
 * In-memory task storage for testing purposes.
 */
class MockTaskStorage implements TaskStorageForHandoff {
  private tasks: Map<string, { id: string; status: string; assignee: string | null }> = new Map();

  addTask(task: { id: string; status: string; assignee: string | null }): void {
    this.tasks.set(task.id, { ...task });
  }

  getTask(taskId: string): { id: string; status: string; assignee: string | null } | null {
    return this.tasks.get(taskId) || null;
  }

  isTaskComplete(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    return task ? task.status === 'DONE' : false;
  }

  updateTaskStatus(taskId: string, status: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
    }
  }

  clear(): void {
    this.tasks.clear();
  }

  get size(): number {
    return this.tasks.size;
  }
}

// =============================================================================
// Helper Functions for Tests
// =============================================================================

/**
 * Creates a valid handoff point definition for testing.
 */
function createValidHandoffPointDefinition(
  overrides: Partial<HandoffPointDefinition> = {}
): HandoffPointDefinition {
  return {
    id: overrides.id ?? 'HP-001',
    name: overrides.name ?? 'Backend to Frontend Handoff',
    source_role: overrides.source_role ?? 'backend',
    target_role: overrides.target_role ?? 'frontend',
    checklist: overrides.checklist ?? [
      { id: 'CHK-001', description: 'API documentation updated', required: true },
      { id: 'CHK-002', description: 'Sample responses provided', required: true },
      { id: 'CHK-003', description: 'Error codes documented', required: false },
    ],
    description: overrides.description,
  };
}

/**
 * Creates a valid handoff context for testing.
 */
function createValidHandoffContext(
  overrides: Partial<HandoffContext> = {}
): HandoffContext {
  return {
    reason: overrides.reason ?? 'TASK_COMPLETION',
    notes: overrides.notes ?? 'Ready for frontend integration',
    priority: overrides.priority ?? 'MEDIUM',
    ...overrides,
  };
}

/**
 * Creates a valid handoff request for testing.
 */
function createValidHandoffRequest(
  overrides: Partial<HandoffRequest> = {}
): HandoffRequest {
  return {
    handoff_point_id: overrides.handoff_point_id ?? 'HP-001',
    source_task_id: overrides.source_task_id ?? 'TASK-001',
    target_task_id: overrides.target_task_id ?? 'TASK-002',
    source_developer_id: overrides.source_developer_id ?? 'dev-backend',
    target_developer_id: overrides.target_developer_id,
    context: overrides.context ?? createValidHandoffContext(),
  };
}

/**
 * Sets up a coordinator with common test data (handoff point, developers, tasks).
 */
function setupCoordinatorWithTestData(): {
  coordinator: HandoffCoordinatorImpl;
  teamStorage: MockTeamStorage;
  taskStorage: MockTaskStorage;
} {
  const teamStorage = new MockTeamStorage();
  const taskStorage = new MockTaskStorage();

  // Register team members
  teamStorage.registerMember({ id: 'dev-backend', name: 'Backend Developer', roles: ['backend'] });
  teamStorage.registerMember({ id: 'dev-frontend', name: 'Frontend Developer', roles: ['frontend'] });
  teamStorage.registerMember({ id: 'dev-fullstack', name: 'Fullstack Developer', roles: ['backend', 'frontend'] });
  teamStorage.registerMember({ id: 'dev-qa', name: 'QA Developer', roles: ['qa'] });

  // Add tasks
  taskStorage.addTask({ id: 'TASK-001', status: 'DONE', assignee: 'dev-backend' });
  taskStorage.addTask({ id: 'TASK-002', status: 'TODO', assignee: null });
  taskStorage.addTask({ id: 'TASK-003', status: 'IN_PROGRESS', assignee: 'dev-frontend' });

  const coordinator = new HandoffCoordinatorImpl({ teamStorage, taskStorage });

  // Define a handoff point
  const handoffPointDef = createValidHandoffPointDefinition();
  coordinator.defineHandoffPoint(handoffPointDef);

  return { coordinator, teamStorage, taskStorage };
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('Handoff_Coordinator Unit Tests', () => {
  let teamStorage: MockTeamStorage;
  let taskStorage: MockTaskStorage;
  let coordinator: HandoffCoordinatorImpl;

  beforeEach(() => {
    teamStorage = new MockTeamStorage();
    taskStorage = new MockTaskStorage();
    coordinator = new HandoffCoordinatorImpl({ teamStorage, taskStorage });
  });

  // ===========================================================================
  // 1. Handoff Point Definition Tests
  // Validates: Requirements 11.1, 11.2
  // ===========================================================================
  describe('1. Handoff Point Definition Tests (defineHandoffPoint)', () => {
    describe('Define valid handoff point with source_role, target_role, and checklist', () => {
      it('should successfully define a handoff point with valid data', () => {
        const definition = createValidHandoffPointDefinition({
          id: 'HP-TEST-001',
          name: 'Test Handoff Point',
          source_role: 'backend',
          target_role: 'frontend',
        });

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(true);
        
        const handoffPoint = coordinator.getHandoffPoint('HP-TEST-001');
        expect(handoffPoint).not.toBeNull();
        expect(handoffPoint?.id).toBe('HP-TEST-001');
        expect(handoffPoint?.name).toBe('Test Handoff Point');
        expect(handoffPoint?.source_role).toBe('backend');
        expect(handoffPoint?.target_role).toBe('frontend');
        expect(handoffPoint?.active).toBe(true);
        expect(handoffPoint?.checklist).toHaveLength(3);
      });

      it('should create handoff point with all valid role combinations', () => {
        const roleCombinations: Array<{ source: Role; target: Role }> = [
          { source: 'backend', target: 'frontend' },
          { source: 'frontend', target: 'qa' },
          { source: 'devops', target: 'backend' },
          { source: 'lead', target: 'fullstack' },
        ];

        roleCombinations.forEach(({ source, target }, index) => {
          const definition = createValidHandoffPointDefinition({
            id: `HP-COMBO-${index}`,
            source_role: source,
            target_role: target,
          });

          const result = coordinator.defineHandoffPoint(definition);
          expect(result.success).toBe(true);

          const hp = coordinator.getHandoffPoint(`HP-COMBO-${index}`);
          expect(hp?.source_role).toBe(source);
          expect(hp?.target_role).toBe(target);
        });
      });

      it('should set created_at timestamp when defining handoff point', () => {
        const beforeCreation = new Date().toISOString();
        
        const definition = createValidHandoffPointDefinition({ id: 'HP-TIMESTAMP' });
        coordinator.defineHandoffPoint(definition);
        
        const afterCreation = new Date().toISOString();

        const hp = coordinator.getHandoffPoint('HP-TIMESTAMP');
        expect(hp).not.toBeNull();
        expect(hp!.created_at).toBeDefined();
        expect(new Date(hp!.created_at).getTime()).toBeGreaterThanOrEqual(new Date(beforeCreation).getTime());
        expect(new Date(hp!.created_at).getTime()).toBeLessThanOrEqual(new Date(afterCreation).getTime());
      });

      it('should initialize checklist items with completed=false', () => {
        const definition = createValidHandoffPointDefinition({
          id: 'HP-CHECKLIST-INIT',
          checklist: [
            { id: 'CHK-1', description: 'Item 1', required: true },
            { id: 'CHK-2', description: 'Item 2', required: false },
          ],
        });

        coordinator.defineHandoffPoint(definition);

        const hp = coordinator.getHandoffPoint('HP-CHECKLIST-INIT');
        expect(hp).not.toBeNull();
        hp!.checklist.forEach(item => {
          expect(item.completed).toBe(false);
          expect(item.completed_at).toBeUndefined();
          expect(item.completed_by).toBeUndefined();
        });
      });
    });

    describe('Require at least one checklist item (Requirement 11.2)', () => {
      it('should reject handoff point with empty checklist (error 1615)', () => {
        const definition = createValidHandoffPointDefinition({
          id: 'HP-EMPTY-CHECKLIST',
          checklist: [],
        });

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.EMPTY_CHECKLIST);
          expect(result.error.code).toBe(1615);
          expect(result.error.category).toBe('HANDOFF_ERROR');
          expect(result.error.context?.handoff_point_id).toBe('HP-EMPTY-CHECKLIST');
        }
      });

      it('should accept handoff point with exactly one checklist item', () => {
        const definition = createValidHandoffPointDefinition({
          id: 'HP-SINGLE-ITEM',
          checklist: [
            { id: 'CHK-SINGLE', description: 'Single item', required: true },
          ],
        });

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(true);
        const hp = coordinator.getHandoffPoint('HP-SINGLE-ITEM');
        expect(hp?.checklist).toHaveLength(1);
      });

      it('should accept handoff point with multiple checklist items', () => {
        const definition = createValidHandoffPointDefinition({
          id: 'HP-MULTI-ITEMS',
          checklist: [
            { id: 'CHK-1', description: 'Item 1', required: true },
            { id: 'CHK-2', description: 'Item 2', required: true },
            { id: 'CHK-3', description: 'Item 3', required: false },
            { id: 'CHK-4', description: 'Item 4', required: false },
            { id: 'CHK-5', description: 'Item 5', required: true },
          ],
        });

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(true);
        const hp = coordinator.getHandoffPoint('HP-MULTI-ITEMS');
        expect(hp?.checklist).toHaveLength(5);
      });
    });

    describe('Reject invalid handoff point data (error 1616)', () => {
      it('should reject handoff point with missing ID', () => {
        const definition = {
          id: '',
          name: 'No ID Handoff',
          source_role: 'backend' as Role,
          target_role: 'frontend' as Role,
          checklist: [{ id: 'CHK-1', description: 'Item', required: true }],
        };

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.INVALID_HANDOFF_POINT_DATA);
          expect(result.error.code).toBe(1616);
        }
      });

      it('should reject handoff point with missing name', () => {
        const definition = {
          id: 'HP-NO-NAME',
          name: '',
          source_role: 'backend' as Role,
          target_role: 'frontend' as Role,
          checklist: [{ id: 'CHK-1', description: 'Item', required: true }],
        };

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1616);
          expect(result.error.message).toContain('Name');
        }
      });

      it('should reject handoff point with invalid source_role', () => {
        const definition = {
          id: 'HP-INVALID-SOURCE',
          name: 'Invalid Source Role',
          source_role: 'invalid_role' as Role,
          target_role: 'frontend' as Role,
          checklist: [{ id: 'CHK-1', description: 'Item', required: true }],
        };

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1616);
          expect(result.error.message).toContain('source role');
        }
      });

      it('should reject handoff point with invalid target_role', () => {
        const definition = {
          id: 'HP-INVALID-TARGET',
          name: 'Invalid Target Role',
          source_role: 'backend' as Role,
          target_role: 'not_a_role' as Role,
          checklist: [{ id: 'CHK-1', description: 'Item', required: true }],
        };

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1616);
          expect(result.error.message).toContain('target role');
        }
      });

      it('should reject handoff point with checklist item missing ID', () => {
        const definition = {
          id: 'HP-ITEM-NO-ID',
          name: 'Item No ID',
          source_role: 'backend' as Role,
          target_role: 'frontend' as Role,
          checklist: [{ id: '', description: 'Item without ID', required: true }],
        };

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1616);
          expect(result.error.message).toContain('ID');
        }
      });

      it('should reject handoff point with checklist item missing description', () => {
        const definition = {
          id: 'HP-ITEM-NO-DESC',
          name: 'Item No Description',
          source_role: 'backend' as Role,
          target_role: 'frontend' as Role,
          checklist: [{ id: 'CHK-1', description: '', required: true }],
        };

        const result = coordinator.defineHandoffPoint(definition);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1616);
          expect(result.error.message).toContain('description');
        }
      });

      it('should reject duplicate handoff point ID', () => {
        const definition1 = createValidHandoffPointDefinition({ id: 'HP-DUPLICATE' });
        const definition2 = createValidHandoffPointDefinition({ 
          id: 'HP-DUPLICATE',
          name: 'Different Name',
        });

        coordinator.defineHandoffPoint(definition1);
        const result = coordinator.defineHandoffPoint(definition2);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1616);
          expect(result.error.message).toContain('already exists');
        }
      });
    });
  });

  // ===========================================================================
  // 2. Update Handoff Checklist Tests
  // ===========================================================================
  describe('2. Update Handoff Checklist Tests (updateHandoffChecklist)', () => {
    beforeEach(() => {
      const definition = createValidHandoffPointDefinition({ id: 'HP-UPDATE-TEST' });
      coordinator.defineHandoffPoint(definition);
    });

    describe('Update checklist for existing handoff point', () => {
      it('should successfully update checklist with new items', () => {
        const newChecklist = [
          { id: 'NEW-CHK-1', description: 'New item 1', required: true },
          { id: 'NEW-CHK-2', description: 'New item 2', required: false },
        ];

        const result = coordinator.updateHandoffChecklist('HP-UPDATE-TEST', newChecklist);

        expect(result.success).toBe(true);
        const hp = coordinator.getHandoffPoint('HP-UPDATE-TEST');
        expect(hp?.checklist).toHaveLength(2);
        expect(hp?.checklist[0].id).toBe('NEW-CHK-1');
        expect(hp?.checklist[1].id).toBe('NEW-CHK-2');
      });

      it('should reset completed status when updating checklist', () => {
        const newChecklist = [
          { id: 'RESET-CHK', description: 'Reset item', required: true },
        ];

        coordinator.updateHandoffChecklist('HP-UPDATE-TEST', newChecklist);

        const hp = coordinator.getHandoffPoint('HP-UPDATE-TEST');
        expect(hp?.checklist[0].completed).toBe(false);
        expect(hp?.checklist[0].completed_at).toBeUndefined();
        expect(hp?.checklist[0].completed_by).toBeUndefined();
      });
    });

    describe('Reject update for non-existent handoff point (error 1609)', () => {
      it('should return HANDOFF_POINT_NOT_FOUND error', () => {
        const newChecklist = [
          { id: 'CHK-1', description: 'Item', required: true },
        ];

        const result = coordinator.updateHandoffChecklist('HP-NON-EXISTENT', newChecklist);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.HANDOFF_POINT_NOT_FOUND);
          expect(result.error.code).toBe(1609);
          expect(result.error.context?.handoff_point_id).toBe('HP-NON-EXISTENT');
        }
      });
    });

    describe('Reject update with empty checklist (error 1615)', () => {
      it('should return EMPTY_CHECKLIST error', () => {
        const result = coordinator.updateHandoffChecklist('HP-UPDATE-TEST', []);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1615);
        }
      });
    });
  });

  // ===========================================================================
  // 3. Initiate Handoff Tests
  // Validates: Requirements 11.3, 12.1, 12.2
  // ===========================================================================
  describe('3. Initiate Handoff Tests (initiateHandoff)', () => {
    describe('Create handoff record linking source and target tasks', () => {
      it('should successfully initiate handoff between complete source task and target task', () => {
        const { coordinator, taskStorage } = setupCoordinatorWithTestData();

        const result = coordinator.initiateHandoff('TASK-001', 'TASK-002', {
          sourceDeveloperId: 'dev-backend',
          reason: 'TASK_COMPLETION',
          notes: 'API ready for frontend integration',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.source_task_id).toBe('TASK-001');
          expect(result.value.target_task_id).toBe('TASK-002');
          expect(result.value.source_developer_id).toBe('dev-backend');
          expect(result.value.target_role).toBe('frontend');
          expect(result.value.status).toBe('PENDING');
          expect(result.value.state).toBe('CHECKLIST_IN_PROGRESS');
          expect(result.value.id).toMatch(/^HO-/);
          expect(result.value.initiated_at).toBeDefined();
        }
      });

      it('should include handoff point name in the record', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.initiateHandoff('TASK-001', 'TASK-002');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.handoff_point_name).toBe('Backend to Frontend Handoff');
        }
      });

      it('should copy checklist from handoff point to record', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.initiateHandoff('TASK-001', 'TASK-002');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.checklist_status).toHaveLength(3);
          result.value.checklist_status.forEach(item => {
            expect(item.completed).toBe(false);
          });
        }
      });

      it('should set target_developer_id when specified', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.initiateHandoff('TASK-001', 'TASK-002', {
          targetDeveloperId: 'dev-frontend',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.target_developer_id).toBe('dev-frontend');
        }
      });

      it('should leave target_developer_id null when not specified (available for pickup)', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.initiateHandoff('TASK-001', 'TASK-002');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.target_developer_id).toBeNull();
        }
      });

      it('should record initial history entry', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.initiateHandoff('TASK-001', 'TASK-002');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.history).toHaveLength(1);
          expect(result.value.history[0].from_state).toBe('NOT_STARTED');
          expect(result.value.history[0].to_state).toBe('CHECKLIST_IN_PROGRESS');
          expect(result.value.history[0].notes).toContain('initiated');
        }
      });
    });

    describe('Reject handoff when source task is not complete (error 1611)', () => {
      it('should return SOURCE_TASK_NOT_COMPLETE error for IN_PROGRESS task', () => {
        const { coordinator, taskStorage } = setupCoordinatorWithTestData();
        taskStorage.addTask({ id: 'TASK-INCOMPLETE', status: 'IN_PROGRESS', assignee: 'dev-backend' });

        const result = coordinator.initiateHandoff('TASK-INCOMPLETE', 'TASK-002');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.SOURCE_TASK_NOT_COMPLETE);
          expect(result.error.code).toBe(1611);
          expect(result.error.context?.task_id).toBe('TASK-INCOMPLETE');
        }
      });

      it('should return SOURCE_TASK_NOT_COMPLETE error for TODO task', () => {
        const { coordinator, taskStorage } = setupCoordinatorWithTestData();
        taskStorage.addTask({ id: 'TASK-TODO', status: 'TODO', assignee: 'dev-backend' });

        const result = coordinator.initiateHandoff('TASK-TODO', 'TASK-002');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1611);
        }
      });
    });

    describe('Reject handoff when source task is not assigned (error 1603)', () => {
      it('should return TASK_NOT_ASSIGNED error when task has no assignee', () => {
        const { coordinator, taskStorage } = setupCoordinatorWithTestData();
        taskStorage.addTask({ id: 'TASK-UNASSIGNED', status: 'DONE', assignee: null });

        const result = coordinator.initiateHandoff('TASK-UNASSIGNED', 'TASK-002');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffErrorCode.TASK_NOT_ASSIGNED);
          expect(result.error.code).toBe(1603);
        }
      });
    });

    describe('Reject duplicate handoff request (error 1605)', () => {
      it('should return DUPLICATE_HANDOFF_REQUEST when handoff already exists for source task', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        // First handoff
        const firstResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        expect(firstResult.success).toBe(true);

        // Duplicate attempt
        const result = coordinator.initiateHandoff('TASK-001', 'TASK-003');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffErrorCode.DUPLICATE_HANDOFF_REQUEST);
          expect(result.error.code).toBe(1605);
          expect(result.error.context?.task_id).toBe('TASK-001');
        }
      });
    });

    describe('Reject handoff when no matching handoff point exists (error 1609)', () => {
      it('should return HANDOFF_POINT_NOT_FOUND when no handoff point matches roles', () => {
        const { coordinator, teamStorage, taskStorage } = setupCoordinatorWithTestData();
        // Add a QA developer and task
        teamStorage.registerMember({ id: 'dev-lead', name: 'Lead', roles: ['lead'] });
        taskStorage.addTask({ id: 'TASK-LEAD', status: 'DONE', assignee: 'dev-lead' });

        const result = coordinator.initiateHandoff('TASK-LEAD', 'TASK-002');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.HANDOFF_POINT_NOT_FOUND);
          expect(result.error.code).toBe(1609);
        }
      });
    });

    describe('Reject handoff when target developer has wrong role (error 1612)', () => {
      it('should return TARGET_ROLE_INVALID when specified target lacks required role', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.initiateHandoff('TASK-001', 'TASK-002', {
          targetDeveloperId: 'dev-qa', // QA doesn't have frontend role
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.TARGET_ROLE_INVALID);
          expect(result.error.code).toBe(1612);
          expect(result.error.context?.developer_id).toBe('dev-qa');
          expect(result.error.context?.target_role).toBe('frontend');
        }
      });
    });

    describe('Reject handoff when developer does not exist (error 1604)', () => {
      it('should return DEVELOPER_NOT_AVAILABLE for non-existent target developer', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.initiateHandoff('TASK-001', 'TASK-002', {
          targetDeveloperId: 'non-existent-dev',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffErrorCode.DEVELOPER_NOT_AVAILABLE);
          expect(result.error.code).toBe(1604);
        }
      });
    });
  });

  // ===========================================================================
  // 4. Accept Handoff Tests
  // Validates: Requirements 12.3
  // ===========================================================================
  describe('4. Accept Handoff Tests (acceptHandoff)', () => {
    describe('Accept pending handoff with complete checklist', () => {
      it('should successfully accept handoff when all required checklist items are complete', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        // Initiate handoff
        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        expect(initResult.success).toBe(true);
        const handoffId = initResult.success ? initResult.value.id : '';

        // Complete all required checklist items
        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');

        // Accept handoff
        const result = coordinator.acceptHandoff(handoffId, 'dev-frontend');

        expect(result.success).toBe(true);

        // Verify status change
        const status = coordinator.getHandoffStatus(handoffId);
        expect(status).toBe('ACCEPTED');
      });

      it('should record acceptance timestamp and developer ID', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        // Complete checklist
        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');

        const beforeAccept = new Date().toISOString();
        coordinator.acceptHandoff(handoffId, 'dev-frontend');
        const afterAccept = new Date().toISOString();

        const handoffResult = coordinator.getHandoff(handoffId);
        expect(handoffResult.success).toBe(true);
        if (handoffResult.success) {
          expect(handoffResult.value.target_developer_id).toBe('dev-frontend');
          expect(handoffResult.value.accepted_at).toBeDefined();
          expect(new Date(handoffResult.value.accepted_at!).getTime()).toBeGreaterThanOrEqual(new Date(beforeAccept).getTime());
          expect(new Date(handoffResult.value.accepted_at!).getTime()).toBeLessThanOrEqual(new Date(afterAccept).getTime());
        }
      });

      it('should add history entry for acceptance', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');
        coordinator.acceptHandoff(handoffId, 'dev-frontend');

        const handoffResult = coordinator.getHandoff(handoffId);
        if (handoffResult.success) {
          const acceptEntry = handoffResult.value.history.find(h => h.to_state === 'ACCEPTED');
          expect(acceptEntry).toBeDefined();
          expect(acceptEntry?.triggered_by).toBe('dev-frontend');
        }
      });
    });

    describe('Reject acceptance when checklist incomplete (error 1610)', () => {
      it('should return CHECKLIST_INCOMPLETE when required items are not complete', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        // Only complete one required item (CHK-001 and CHK-002 are both required)
        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');

        const result = coordinator.acceptHandoff(handoffId, 'dev-frontend');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.CHECKLIST_INCOMPLETE);
          expect(result.error.code).toBe(1610);
          expect(result.error.context?.incomplete_items).toContain('CHK-002');
        }
      });

      it('should allow acceptance when only optional items are incomplete', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        // Complete required items, skip optional CHK-003
        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');

        const result = coordinator.acceptHandoff(handoffId, 'dev-frontend');

        expect(result.success).toBe(true);
      });
    });

    describe('Reject acceptance when developer lacks required role (error 1612)', () => {
      it('should return TARGET_ROLE_INVALID when accepting developer has wrong role', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');

        // Try to accept with QA developer (wrong role)
        const result = coordinator.acceptHandoff(handoffId, 'dev-qa');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1612);
          expect(result.error.context?.developer_id).toBe('dev-qa');
        }
      });
    });

    describe('Reject acceptance of non-existent handoff (error 1601)', () => {
      it('should return HANDOFF_NOT_FOUND error', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.acceptHandoff('HO-NON-EXISTENT', 'dev-frontend');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffErrorCode.HANDOFF_NOT_FOUND);
          expect(result.error.code).toBe(1601);
        }
      });
    });

    describe('Reject acceptance of already accepted handoff (error 1613)', () => {
      it('should return HANDOFF_ALREADY_ACCEPTED error', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');
        coordinator.acceptHandoff(handoffId, 'dev-frontend');

        // Try to accept again
        const result = coordinator.acceptHandoff(handoffId, 'dev-fullstack');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.HANDOFF_ALREADY_ACCEPTED);
          expect(result.error.code).toBe(1613);
        }
      });
    });
  });

  // ===========================================================================
  // 5. Reject Handoff Tests
  // Validates: Requirements 12.4
  // ===========================================================================
  describe('5. Reject Handoff Tests (rejectHandoff)', () => {
    describe('Reject pending handoff with reason', () => {
      it('should successfully reject handoff with a reason', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        const result = coordinator.rejectHandoff(handoffId, 'API documentation is incomplete');

        expect(result.success).toBe(true);

        const status = coordinator.getHandoffStatus(handoffId);
        expect(status).toBe('REJECTED');
      });

      it('should record rejection timestamp and reason', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        const rejectionReason = 'Missing error handling documentation';
        const beforeReject = new Date().toISOString();
        coordinator.rejectHandoff(handoffId, rejectionReason);
        const afterReject = new Date().toISOString();

        const handoffResult = coordinator.getHandoff(handoffId);
        expect(handoffResult.success).toBe(true);
        if (handoffResult.success) {
          expect(handoffResult.value.rejection_reason).toBe(rejectionReason);
          expect(handoffResult.value.rejected_at).toBeDefined();
          expect(new Date(handoffResult.value.rejected_at!).getTime()).toBeGreaterThanOrEqual(new Date(beforeReject).getTime());
          expect(new Date(handoffResult.value.rejected_at!).getTime()).toBeLessThanOrEqual(new Date(afterReject).getTime());
        }
      });

      it('should add history entry for rejection', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        coordinator.rejectHandoff(handoffId, 'Needs more work');

        const handoffResult = coordinator.getHandoff(handoffId);
        if (handoffResult.success) {
          const rejectEntry = handoffResult.value.history.find(h => h.to_state === 'REJECTED');
          expect(rejectEntry).toBeDefined();
          expect(rejectEntry?.notes).toContain('Needs more work');
        }
      });
    });

    describe('Reject rejection without reason (error 1608)', () => {
      it('should return CONTEXT_REQUIRED when reason is empty', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        const result = coordinator.rejectHandoff(handoffId, '');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffErrorCode.CONTEXT_REQUIRED);
          expect(result.error.code).toBe(1608);
        }
      });

      it('should return CONTEXT_REQUIRED when reason is whitespace only', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        const result = coordinator.rejectHandoff(handoffId, '   ');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1608);
        }
      });
    });

    describe('Reject rejection of non-existent handoff (error 1601)', () => {
      it('should return HANDOFF_NOT_FOUND error', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.rejectHandoff('HO-FAKE', 'Some reason');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1601);
        }
      });
    });

    describe('Reject rejection of already accepted handoff (error 1613)', () => {
      it('should return HANDOFF_ALREADY_ACCEPTED error', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');
        coordinator.acceptHandoff(handoffId, 'dev-frontend');

        const result = coordinator.rejectHandoff(handoffId, 'Too late');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1613);
        }
      });
    });

    describe('Reject rejection of already rejected handoff (error 1614)', () => {
      it('should return HANDOFF_ALREADY_REJECTED error', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        coordinator.rejectHandoff(handoffId, 'First rejection');

        const result = coordinator.rejectHandoff(handoffId, 'Second rejection');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.HANDOFF_ALREADY_REJECTED);
          expect(result.error.code).toBe(1614);
        }
      });
    });
  });

  // ===========================================================================
  // 6. Get Handoff Status Tests
  // ===========================================================================
  describe('6. Get Handoff Status Tests (getHandoffStatus)', () => {
    it('should return PENDING for newly initiated handoff', () => {
      const { coordinator } = setupCoordinatorWithTestData();

      const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
      const handoffId = initResult.success ? initResult.value.id : '';

      const status = coordinator.getHandoffStatus(handoffId);

      expect(status).toBe('PENDING');
    });

    it('should return ACCEPTED after acceptance', () => {
      const { coordinator } = setupCoordinatorWithTestData();

      const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
      const handoffId = initResult.success ? initResult.value.id : '';

      coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
      coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');
      coordinator.acceptHandoff(handoffId, 'dev-frontend');

      const status = coordinator.getHandoffStatus(handoffId);

      expect(status).toBe('ACCEPTED');
    });

    it('should return REJECTED after rejection', () => {
      const { coordinator } = setupCoordinatorWithTestData();

      const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
      const handoffId = initResult.success ? initResult.value.id : '';

      coordinator.rejectHandoff(handoffId, 'Not ready');

      const status = coordinator.getHandoffStatus(handoffId);

      expect(status).toBe('REJECTED');
    });

    it('should return null for non-existent handoff', () => {
      const { coordinator } = setupCoordinatorWithTestData();

      const status = coordinator.getHandoffStatus('HO-DOES-NOT-EXIST');

      expect(status).toBeNull();
    });
  });

  // ===========================================================================
  // 7. Get Pending Handoffs for Role Tests
  // ===========================================================================
  describe('7. Get Pending Handoffs for Role Tests (getPendingHandoffsForRole)', () => {
    it('should return pending handoffs for target role', () => {
      const { coordinator, taskStorage } = setupCoordinatorWithTestData();

      // Create multiple handoffs
      taskStorage.addTask({ id: 'TASK-004', status: 'DONE', assignee: 'dev-backend' });
      taskStorage.addTask({ id: 'TASK-005', status: 'DONE', assignee: 'dev-backend' });

      coordinator.initiateHandoff('TASK-001', 'TASK-002');
      coordinator.initiateHandoff('TASK-004', 'TASK-003');

      const pendingForFrontend = coordinator.getPendingHandoffsForRole('frontend');

      expect(pendingForFrontend).toHaveLength(2);
      pendingForFrontend.forEach(h => {
        expect(h.target_role).toBe('frontend');
        expect(h.status).toBe('PENDING');
      });
    });

    it('should return empty array when no pending handoffs for role', () => {
      const { coordinator } = setupCoordinatorWithTestData();

      coordinator.initiateHandoff('TASK-001', 'TASK-002');

      const pendingForQA = coordinator.getPendingHandoffsForRole('qa');

      expect(pendingForQA).toHaveLength(0);
    });

    it('should not include accepted or rejected handoffs', () => {
      const { coordinator, taskStorage } = setupCoordinatorWithTestData();

      taskStorage.addTask({ id: 'TASK-004', status: 'DONE', assignee: 'dev-backend' });

      const init1 = coordinator.initiateHandoff('TASK-001', 'TASK-002');
      const init2 = coordinator.initiateHandoff('TASK-004', 'TASK-003');

      const handoffId1 = init1.success ? init1.value.id : '';
      const handoffId2 = init2.success ? init2.value.id : '';

      // Accept first handoff
      coordinator.completeChecklistItem(handoffId1, 'CHK-001', 'dev-backend');
      coordinator.completeChecklistItem(handoffId1, 'CHK-002', 'dev-backend');
      coordinator.acceptHandoff(handoffId1, 'dev-frontend');

      // Reject second handoff
      coordinator.rejectHandoff(handoffId2, 'Not ready');

      const pendingForFrontend = coordinator.getPendingHandoffsForRole('frontend');

      expect(pendingForFrontend).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 8. Checklist Item Completion Tests
  // Validates: Requirements 11.4
  // ===========================================================================
  describe('8. Checklist Item Completion Tests (completeChecklistItem)', () => {
    describe('Complete checklist items', () => {
      it('should mark checklist item as complete', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        const result = coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');

        expect(result.success).toBe(true);

        const handoffResult = coordinator.getHandoff(handoffId);
        if (handoffResult.success) {
          const item = handoffResult.value.checklist_status.find(i => i.id === 'CHK-001');
          expect(item?.completed).toBe(true);
          expect(item?.completed_by).toBe('dev-backend');
          expect(item?.completed_at).toBeDefined();
        }
      });

      it('should transition to PENDING_ACCEPTANCE when all required items complete', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        // Complete all required items
        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');

        const handoffResult = coordinator.getHandoff(handoffId);
        if (handoffResult.success) {
          expect(handoffResult.value.state).toBe('PENDING_ACCEPTANCE');
        }
      });

      it('should remain in CHECKLIST_IN_PROGRESS when some required items incomplete', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        // Complete only one required item
        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');

        const handoffResult = coordinator.getHandoff(handoffId);
        if (handoffResult.success) {
          expect(handoffResult.value.state).toBe('CHECKLIST_IN_PROGRESS');
        }
      });
    });

    describe('Reject checklist completion for invalid scenarios', () => {
      it('should return HANDOFF_NOT_FOUND for non-existent handoff (error 1601)', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.completeChecklistItem('HO-FAKE', 'CHK-001', 'dev-backend');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1601);
        }
      });

      it('should return CHECKLIST_ITEM_NOT_FOUND for invalid item ID (error 1617)', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        const result = coordinator.completeChecklistItem(handoffId, 'CHK-INVALID', 'dev-backend');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffExtendedErrorCode.CHECKLIST_ITEM_NOT_FOUND);
          expect(result.error.code).toBe(1617);
        }
      });

      it('should return HANDOFF_ALREADY_COMPLETED for completed handoff (error 1606)', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');
        coordinator.acceptHandoff(handoffId, 'dev-frontend');
        coordinator.completeHandoff(handoffId);

        const result = coordinator.completeChecklistItem(handoffId, 'CHK-003', 'dev-frontend');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(HandoffErrorCode.HANDOFF_ALREADY_COMPLETED);
          expect(result.error.code).toBe(1606);
        }
      });
    });
  });

  // ===========================================================================
  // 9. Query Operations Tests
  // ===========================================================================
  describe('9. Query Operations Tests', () => {
    describe('getHandoff', () => {
      it('should return handoff record by ID', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        const handoffId = initResult.success ? initResult.value.id : '';

        const result = coordinator.getHandoff(handoffId);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.id).toBe(handoffId);
          expect(result.value.source_task_id).toBe('TASK-001');
          expect(result.value.target_task_id).toBe('TASK-002');
        }
      });

      it('should return error for non-existent handoff', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const result = coordinator.getHandoff('HO-NONEXISTENT');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1601);
        }
      });
    });

    describe('getHandoffsByTask', () => {
      it('should return handoffs for source task', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        coordinator.initiateHandoff('TASK-001', 'TASK-002');

        const handoffs = coordinator.getHandoffsByTask('TASK-001');

        expect(handoffs).toHaveLength(1);
        expect(handoffs[0].source_task_id).toBe('TASK-001');
      });

      it('should return handoffs for target task', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        coordinator.initiateHandoff('TASK-001', 'TASK-002');

        const handoffs = coordinator.getHandoffsByTask('TASK-002');

        expect(handoffs).toHaveLength(1);
        expect(handoffs[0].target_task_id).toBe('TASK-002');
      });

      it('should return empty array for task with no handoffs', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const handoffs = coordinator.getHandoffsByTask('TASK-999');

        expect(handoffs).toHaveLength(0);
      });
    });

    describe('getHandoffsByDeveloper', () => {
      it('should return handoffs where developer is source', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        coordinator.initiateHandoff('TASK-001', 'TASK-002');

        const handoffs = coordinator.getHandoffsByDeveloper('dev-backend');

        expect(handoffs).toHaveLength(1);
        expect(handoffs[0].source_developer_id).toBe('dev-backend');
      });

      it('should return handoffs where developer is target', () => {
        const { coordinator } = setupCoordinatorWithTestData();

        const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002', {
          targetDeveloperId: 'dev-frontend',
        });

        const handoffs = coordinator.getHandoffsByDeveloper('dev-frontend');

        expect(handoffs).toHaveLength(1);
        expect(handoffs[0].target_developer_id).toBe('dev-frontend');
      });
    });

    describe('getPendingHandoffs', () => {
      it('should return all pending handoffs', () => {
        const { coordinator, taskStorage } = setupCoordinatorWithTestData();

        taskStorage.addTask({ id: 'TASK-004', status: 'DONE', assignee: 'dev-backend' });

        coordinator.initiateHandoff('TASK-001', 'TASK-002');
        coordinator.initiateHandoff('TASK-004', 'TASK-003');

        const pending = coordinator.getPendingHandoffs();

        expect(pending).toHaveLength(2);
        pending.forEach(h => expect(h.status).toBe('PENDING'));
      });
    });

    describe('getActiveHandoffs', () => {
      it('should return handoffs that are not completed', () => {
        const { coordinator, taskStorage } = setupCoordinatorWithTestData();

        taskStorage.addTask({ id: 'TASK-004', status: 'DONE', assignee: 'dev-backend' });

        // Create two handoffs
        const init1 = coordinator.initiateHandoff('TASK-001', 'TASK-002');
        coordinator.initiateHandoff('TASK-004', 'TASK-003');

        // Complete first one
        const handoffId1 = init1.success ? init1.value.id : '';
        coordinator.completeChecklistItem(handoffId1, 'CHK-001', 'dev-backend');
        coordinator.completeChecklistItem(handoffId1, 'CHK-002', 'dev-backend');
        coordinator.acceptHandoff(handoffId1, 'dev-frontend');
        coordinator.completeHandoff(handoffId1);

        const active = coordinator.getActiveHandoffs();

        expect(active).toHaveLength(1);
        expect(active[0].status).not.toBe('COMPLETED');
      });
    });

    describe('listHandoffPoints', () => {
      it('should return all handoff points', () => {
        coordinator.defineHandoffPoint(createValidHandoffPointDefinition({ id: 'HP-1' }));
        coordinator.defineHandoffPoint(createValidHandoffPointDefinition({ 
          id: 'HP-2',
          source_role: 'frontend',
          target_role: 'qa',
        }));

        const points = coordinator.listHandoffPoints();

        expect(points).toHaveLength(2);
      });

      it('should filter by source_role', () => {
        coordinator.defineHandoffPoint(createValidHandoffPointDefinition({ 
          id: 'HP-BE-FE',
          source_role: 'backend',
          target_role: 'frontend',
        }));
        coordinator.defineHandoffPoint(createValidHandoffPointDefinition({ 
          id: 'HP-FE-QA',
          source_role: 'frontend',
          target_role: 'qa',
        }));

        const points = coordinator.listHandoffPoints({ source_role: 'backend' });

        expect(points).toHaveLength(1);
        expect(points[0].source_role).toBe('backend');
      });

      it('should filter by target_role', () => {
        coordinator.defineHandoffPoint(createValidHandoffPointDefinition({ 
          id: 'HP-BE-FE',
          source_role: 'backend',
          target_role: 'frontend',
        }));
        coordinator.defineHandoffPoint(createValidHandoffPointDefinition({ 
          id: 'HP-FE-QA',
          source_role: 'frontend',
          target_role: 'qa',
        }));

        const points = coordinator.listHandoffPoints({ target_role: 'qa' });

        expect(points).toHaveLength(1);
        expect(points[0].target_role).toBe('qa');
      });
    });
  });

  // ===========================================================================
  // 10. Helper Functions Tests
  // ===========================================================================
  describe('10. Helper Functions Tests', () => {
    describe('isValidHandoffStatus', () => {
      it('should return true for valid statuses', () => {
        HANDOFF_STATUSES.forEach(status => {
          expect(isValidHandoffStatus(status)).toBe(true);
        });
      });

      it('should return false for invalid statuses', () => {
        expect(isValidHandoffStatus('INVALID')).toBe(false);
        expect(isValidHandoffStatus('')).toBe(false);
        expect(isValidHandoffStatus('pending')).toBe(false); // wrong case
      });
    });

    describe('isValidHandoffState', () => {
      it('should return true for valid states', () => {
        HANDOFF_STATES.forEach(state => {
          expect(isValidHandoffState(state)).toBe(true);
        });
      });

      it('should return false for invalid states', () => {
        expect(isValidHandoffState('INVALID_STATE')).toBe(false);
        expect(isValidHandoffState('')).toBe(false);
      });
    });

    describe('isValidHandoffReason', () => {
      it('should return true for valid reasons', () => {
        HANDOFF_REASONS.forEach(reason => {
          expect(isValidHandoffReason(reason)).toBe(true);
        });
      });

      it('should return false for invalid reasons', () => {
        expect(isValidHandoffReason('INVALID_REASON')).toBe(false);
        expect(isValidHandoffReason('')).toBe(false);
      });
    });

    describe('areRequiredChecklistItemsComplete', () => {
      it('should return true when all required items are complete', () => {
        const checklist: ChecklistItem[] = [
          { id: '1', description: 'Required', required: true, completed: true },
          { id: '2', description: 'Optional', required: false, completed: false },
          { id: '3', description: 'Required', required: true, completed: true },
        ];

        expect(areRequiredChecklistItemsComplete(checklist)).toBe(true);
      });

      it('should return false when any required item is incomplete', () => {
        const checklist: ChecklistItem[] = [
          { id: '1', description: 'Required', required: true, completed: true },
          { id: '2', description: 'Required', required: true, completed: false },
        ];

        expect(areRequiredChecklistItemsComplete(checklist)).toBe(false);
      });

      it('should return true when there are no required items', () => {
        const checklist: ChecklistItem[] = [
          { id: '1', description: 'Optional', required: false, completed: false },
        ];

        expect(areRequiredChecklistItemsComplete(checklist)).toBe(true);
      });

      it('should return true for empty checklist', () => {
        expect(areRequiredChecklistItemsComplete([])).toBe(true);
      });
    });

    describe('getIncompleteRequiredItems', () => {
      it('should return only incomplete required items', () => {
        const checklist: ChecklistItem[] = [
          { id: '1', description: 'Complete required', required: true, completed: true },
          { id: '2', description: 'Incomplete required', required: true, completed: false },
          { id: '3', description: 'Incomplete optional', required: false, completed: false },
          { id: '4', description: 'Another incomplete required', required: true, completed: false },
        ];

        const incomplete = getIncompleteRequiredItems(checklist);

        expect(incomplete).toHaveLength(2);
        expect(incomplete.map(i => i.id)).toContain('2');
        expect(incomplete.map(i => i.id)).toContain('4');
      });

      it('should return empty array when all required items are complete', () => {
        const checklist: ChecklistItem[] = [
          { id: '1', description: 'Complete required', required: true, completed: true },
          { id: '2', description: 'Incomplete optional', required: false, completed: false },
        ];

        const incomplete = getIncompleteRequiredItems(checklist);

        expect(incomplete).toHaveLength(0);
      });
    });

    describe('stateToStatus', () => {
      it('should map states to correct statuses', () => {
        expect(stateToStatus('NOT_STARTED')).toBe('PENDING');
        expect(stateToStatus('CHECKLIST_IN_PROGRESS')).toBe('PENDING');
        expect(stateToStatus('PENDING_ACCEPTANCE')).toBe('PENDING');
        expect(stateToStatus('ACCEPTED')).toBe('ACCEPTED');
        expect(stateToStatus('REJECTED')).toBe('REJECTED');
        expect(stateToStatus('COMPLETE')).toBe('COMPLETED');
      });
    });

    describe('isValidStateTransition', () => {
      it('should return true for valid transitions', () => {
        expect(isValidStateTransition('NOT_STARTED', 'CHECKLIST_IN_PROGRESS')).toBe(true);
        expect(isValidStateTransition('CHECKLIST_IN_PROGRESS', 'PENDING_ACCEPTANCE')).toBe(true);
        expect(isValidStateTransition('PENDING_ACCEPTANCE', 'ACCEPTED')).toBe(true);
        expect(isValidStateTransition('PENDING_ACCEPTANCE', 'REJECTED')).toBe(true);
        expect(isValidStateTransition('ACCEPTED', 'COMPLETE')).toBe(true);
        expect(isValidStateTransition('REJECTED', 'CHECKLIST_IN_PROGRESS')).toBe(true);
      });

      it('should return false for invalid transitions', () => {
        expect(isValidStateTransition('NOT_STARTED', 'ACCEPTED')).toBe(false);
        expect(isValidStateTransition('COMPLETE', 'ACCEPTED')).toBe(false);
        expect(isValidStateTransition('CHECKLIST_IN_PROGRESS', 'COMPLETE')).toBe(false);
      });
    });

    describe('validateHandoffPointDefinition', () => {
      it('should return success for valid definition', () => {
        const definition = createValidHandoffPointDefinition();
        const result = validateHandoffPointDefinition(definition);
        expect(result.success).toBe(true);
      });

      it('should return error for missing ID', () => {
        const definition = { ...createValidHandoffPointDefinition(), id: '' };
        const result = validateHandoffPointDefinition(definition);
        expect(result.success).toBe(false);
      });

      it('should return error for empty checklist', () => {
        const definition = { ...createValidHandoffPointDefinition(), checklist: [] };
        const result = validateHandoffPointDefinition(definition);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(1615);
        }
      });
    });
  });

  // ===========================================================================
  // 11. Complete Handoff Flow Tests (Integration-like)
  // ===========================================================================
  describe('11. Complete Handoff Flow Tests', () => {
    it('should complete full handoff workflow: initiate -> checklist -> accept -> complete', () => {
      const { coordinator } = setupCoordinatorWithTestData();

      // Step 1: Initiate handoff
      const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
      expect(initResult.success).toBe(true);
      const handoffId = initResult.success ? initResult.value.id : '';

      // Verify initial state
      let handoff = coordinator.getHandoff(handoffId);
      expect(handoff.success && handoff.value.state).toBe('CHECKLIST_IN_PROGRESS');
      expect(handoff.success && handoff.value.status).toBe('PENDING');

      // Step 2: Complete checklist items
      coordinator.completeChecklistItem(handoffId, 'CHK-001', 'dev-backend');
      coordinator.completeChecklistItem(handoffId, 'CHK-002', 'dev-backend');

      // Verify state after checklist completion
      handoff = coordinator.getHandoff(handoffId);
      expect(handoff.success && handoff.value.state).toBe('PENDING_ACCEPTANCE');

      // Step 3: Accept handoff
      const acceptResult = coordinator.acceptHandoff(handoffId, 'dev-frontend');
      expect(acceptResult.success).toBe(true);

      // Verify accepted state
      handoff = coordinator.getHandoff(handoffId);
      expect(handoff.success && handoff.value.state).toBe('ACCEPTED');
      expect(handoff.success && handoff.value.status).toBe('ACCEPTED');
      expect(handoff.success && handoff.value.target_developer_id).toBe('dev-frontend');

      // Step 4: Complete handoff
      const completeResult = coordinator.completeHandoff(handoffId);
      expect(completeResult.success).toBe(true);

      // Verify final state
      handoff = coordinator.getHandoff(handoffId);
      expect(handoff.success && handoff.value.state).toBe('COMPLETE');
      expect(handoff.success && handoff.value.status).toBe('COMPLETED');
      expect(handoff.success && handoff.value.completed_at).toBeDefined();

      // Verify history has all transitions
      if (handoff.success) {
        expect(handoff.value.history.length).toBeGreaterThanOrEqual(3);
        const states = handoff.value.history.map(h => h.to_state);
        expect(states).toContain('CHECKLIST_IN_PROGRESS');
        expect(states).toContain('PENDING_ACCEPTANCE');
        expect(states).toContain('ACCEPTED');
        expect(states).toContain('COMPLETE');
      }
    });

    it('should handle rejection and allow retry flow', () => {
      const { coordinator, taskStorage } = setupCoordinatorWithTestData();

      // Create handoff
      const initResult = coordinator.initiateHandoff('TASK-001', 'TASK-002');
      const handoffId = initResult.success ? initResult.value.id : '';

      // Reject handoff
      const rejectResult = coordinator.rejectHandoff(handoffId, 'API docs incomplete');
      expect(rejectResult.success).toBe(true);

      // Verify rejected state
      const handoff = coordinator.getHandoff(handoffId);
      expect(handoff.success && handoff.value.status).toBe('REJECTED');
      expect(handoff.success && handoff.value.rejection_reason).toBe('API docs incomplete');

      // Note: After rejection, a new handoff can be created
      // (the old one stays in REJECTED state)
      // First clear the existing rejected handoff's source task reference
      taskStorage.addTask({ id: 'TASK-005', status: 'DONE', assignee: 'dev-backend' });
      
      const newInitResult = coordinator.initiateHandoff('TASK-005', 'TASK-002');
      expect(newInitResult.success).toBe(true);
    });
  });
});
