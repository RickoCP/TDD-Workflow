/**
 * Unit Tests for DoR_Validator (FileDoRValidator)
 * 
 * These tests verify the Definition of Ready validation logic including:
 * 1. Acceptance criteria defined check
 * 2. Blocking dependencies satisfied check
 * 3. Linked decisions resolved check
 * 4. Assignee has required role check
 * 5. No active blockers check
 * 6. Combined validation behavior
 * 7. canStartWork method
 * 8. revalidateAffectedTasks method
 * 
 * **Validates: Requirements R01.1, R01.2, R01.3, R01.4, R01.5, R01.6**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FileDoRValidator,
  FileDoRValidatorConfig,
  InMemoryTaskStorageForDoR,
  InMemoryDecisionStorageForDoR,
  InMemoryBlockerStorageForDoR,
  InMemoryTeamStorageForDoR,
  createFileDoRValidator,
} from '../dor-validator-impl';
import {
  TaskForDoRValidation,
  TaskDependency,
  DecisionData,
  BlockerData,
  MemberRoleData,
  DoRCondition,
  DoRValidation,
  DoRErrorCode,
  DOR_CONDITION_IDS,
} from '../dor-validator';

// =============================================================================
// Helper Functions for Tests
// =============================================================================

/**
 * Creates a valid task for DoR validation testing.
 */
function createValidTask(overrides: Partial<TaskForDoRValidation> = {}): TaskForDoRValidation {
  return {
    id: overrides.id ?? 'TASK-001',
    status: overrides.status ?? 'PENDING',
    acceptance_criteria: overrides.acceptance_criteria ?? ['AC1: User can login'],
    depends_on: overrides.depends_on,
    linked_decisions: overrides.linked_decisions,
    assignment: overrides.assignment,
    blocker_refs: overrides.blocker_refs,
    blocked: overrides.blocked,
    scope: overrides.scope,
  };
}

/**
 * Creates a task with specified acceptance criteria.
 */
function createTaskWithAC(taskId: string, acceptanceCriteria: string[]): TaskForDoRValidation {
  return createValidTask({
    id: taskId,
    acceptance_criteria: acceptanceCriteria,
  });
}

/**
 * Creates a task with dependencies.
 */
function createTaskWithDependencies(
  taskId: string,
  dependencies: TaskDependency[]
): TaskForDoRValidation {
  return createValidTask({
    id: taskId,
    depends_on: dependencies,
  });
}

/**
 * Creates a task with linked decisions.
 */
function createTaskWithDecisions(
  taskId: string,
  decisionIds: string[]
): TaskForDoRValidation {
  return createValidTask({
    id: taskId,
    linked_decisions: decisionIds,
  });
}

/**
 * Creates a task with assignment info.
 */
function createTaskWithAssignment(
  taskId: string,
  assignee: string | null,
  roleRequired: string | null
): TaskForDoRValidation {
  return createValidTask({
    id: taskId,
    assignment: {
      assignee,
      role_required: roleRequired,
    },
  });
}

/**
 * Creates a task with blockers.
 */
function createTaskWithBlockers(
  taskId: string,
  blockerRefs: string[],
  blocked: boolean = false
): TaskForDoRValidation {
  return createValidTask({
    id: taskId,
    blocker_refs: blockerRefs,
    blocked,
  });
}

// =============================================================================
// Test Setup
// =============================================================================

describe('DoR_Validator Unit Tests', () => {
  let taskStorage: InMemoryTaskStorageForDoR;
  let decisionStorage: InMemoryDecisionStorageForDoR;
  let blockerStorage: InMemoryBlockerStorageForDoR;
  let teamStorage: InMemoryTeamStorageForDoR;
  let validator: FileDoRValidator;

  beforeEach(() => {
    taskStorage = new InMemoryTaskStorageForDoR();
    decisionStorage = new InMemoryDecisionStorageForDoR();
    blockerStorage = new InMemoryBlockerStorageForDoR();
    teamStorage = new InMemoryTeamStorageForDoR();

    validator = createFileDoRValidator({
      taskStorage,
      decisionStorage,
      blockerStorage,
      teamStorage,
    });
  });

  // ===========================================================================
  // 1. Acceptance Criteria Defined Tests
  // Validates: R01.2 - "Scope dan acceptance criteria terdefinisi (non-empty)"
  // ===========================================================================
  describe('1. Acceptance Criteria Defined Check', () => {
    describe('Pass cases', () => {
      it('should PASS when task has acceptance criteria defined', async () => {
        // Setup
        const task = createTaskWithAC('TASK-001', ['AC1: User can login', 'AC2: User sees dashboard']);
        taskStorage.addTask(task);

        // Act
        const result = await validator.validateDoR('TASK-001');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          const acCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA
          );
          expect(acCondition).toBeDefined();
          expect(acCondition!.passed).toBe(true);
          expect(acCondition!.details).toContain('2 acceptance criteria present');
        }
      });

      it('should PASS when task has exactly 1 acceptance criterion (minimum)', async () => {
        const task = createTaskWithAC('TASK-001', ['AC1: Single criterion']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const acCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA
          );
          expect(acCondition!.passed).toBe(true);
        }
      });
    });

    describe('Fail cases', () => {
      it('should FAIL when task has no acceptance criteria (undefined)', async () => {
        const task = createValidTask({
          id: 'TASK-001',
          acceptance_criteria: undefined,
        });
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const acCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA
          );
          expect(acCondition!.passed).toBe(false);
          expect(acCondition!.details).toContain('No acceptance criteria defined');
        }
      });

      it('should FAIL when task has empty acceptance criteria array', async () => {
        const task = createTaskWithAC('TASK-001', []);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const acCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA
          );
          expect(acCondition!.passed).toBe(false);
        }
      });

      it('should FAIL when acceptance criteria contain only empty strings', async () => {
        const task = createTaskWithAC('TASK-001', ['', '   ', '\t']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const acCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA
          );
          expect(acCondition!.passed).toBe(false);
        }
      });
    });
  });

  // ===========================================================================
  // 2. Blocking Dependencies Satisfied Tests
  // Validates: R01.2 - "Semua blocking dependencies dalam status DONE"
  // ===========================================================================
  describe('2. Blocking Dependencies Check', () => {
    describe('Pass cases', () => {
      it('should PASS when task has no dependencies', async () => {
        const task = createTaskWithDependencies('TASK-001', []);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const depCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DEPENDENCIES
          );
          expect(depCondition!.passed).toBe(true);
          expect(depCondition!.details).toBe('No blocking dependencies');
        }
      });

      it('should PASS when all blocking dependencies are DONE', async () => {
        // Setup dependent tasks
        const depTask1 = createValidTask({ id: 'TASK-DEP-1', status: 'DONE' });
        const depTask2 = createValidTask({ id: 'TASK-DEP-2', status: 'DONE' });
        taskStorage.addTask(depTask1);
        taskStorage.addTask(depTask2);

        const task = createTaskWithDependencies('TASK-001', [
          { task_id: 'TASK-DEP-1', type: 'blocking' },
          { task_id: 'TASK-DEP-2', type: 'blocking' },
        ]);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const depCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DEPENDENCIES
          );
          expect(depCondition!.passed).toBe(true);
          expect(depCondition!.details).toContain('2 blocking dependencies satisfied');
        }
      });

      it('should PASS when only non_blocking dependencies are not DONE', async () => {
        const depTask1 = createValidTask({ id: 'TASK-DEP-1', status: 'DONE' });
        const depTask2 = createValidTask({ id: 'TASK-DEP-2', status: 'IN_PROGRESS' }); // non-blocking
        taskStorage.addTask(depTask1);
        taskStorage.addTask(depTask2);

        const task = createTaskWithDependencies('TASK-001', [
          { task_id: 'TASK-DEP-1', type: 'blocking' },
          { task_id: 'TASK-DEP-2', type: 'non_blocking' },
        ]);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const depCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DEPENDENCIES
          );
          expect(depCondition!.passed).toBe(true);
        }
      });
    });

    describe('Fail cases', () => {
      it('should FAIL when a blocking dependency is not DONE', async () => {
        const depTask = createValidTask({ id: 'TASK-DEP-1', status: 'IN_PROGRESS' });
        taskStorage.addTask(depTask);

        const task = createTaskWithDependencies('TASK-001', [
          { task_id: 'TASK-DEP-1', type: 'blocking' },
        ]);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const depCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DEPENDENCIES
          );
          expect(depCondition!.passed).toBe(false);
          expect(depCondition!.details).toContain('TASK-DEP-1');
          expect(depCondition!.details).toContain('IN_PROGRESS');
        }
      });

      it('should FAIL when a blocking dependency task does not exist', async () => {
        const task = createTaskWithDependencies('TASK-001', [
          { task_id: 'TASK-NONEXISTENT', type: 'blocking' },
        ]);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const depCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DEPENDENCIES
          );
          expect(depCondition!.passed).toBe(false);
          expect(depCondition!.details).toContain('TASK-NONEXISTENT');
          expect(depCondition!.details).toContain('not found');
        }
      });

      it('should FAIL when multiple blocking dependencies are not DONE', async () => {
        const depTask1 = createValidTask({ id: 'TASK-DEP-1', status: 'BLOCKED' });
        const depTask2 = createValidTask({ id: 'TASK-DEP-2', status: 'PENDING' });
        taskStorage.addTask(depTask1);
        taskStorage.addTask(depTask2);

        const task = createTaskWithDependencies('TASK-001', [
          { task_id: 'TASK-DEP-1', type: 'blocking' },
          { task_id: 'TASK-DEP-2', type: 'blocking' },
        ]);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const depCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DEPENDENCIES
          );
          expect(depCondition!.passed).toBe(false);
          expect(depCondition!.context?.failed_items?.length).toBe(2);
        }
      });
    });
  });

  // ===========================================================================
  // 3. Decisions Resolved Tests
  // Validates: R01.2 - "Keputusan yang menghambat (linked DEC-xxx) telah resolved"
  // ===========================================================================
  describe('3. Decisions Resolved Check', () => {
    describe('Pass cases', () => {
      it('should PASS when task has no linked decisions', async () => {
        const task = createTaskWithDecisions('TASK-001', []);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const decCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DECISIONS
          );
          expect(decCondition!.passed).toBe(true);
          expect(decCondition!.details).toBe('No linked decisions');
        }
      });

      it('should PASS when all linked decisions are RESOLVED', async () => {
        decisionStorage.addDecision({ id: 'DEC-001', status: 'RESOLVED', resolution: 'Use Redis' });
        decisionStorage.addDecision({ id: 'DEC-002', status: 'RESOLVED', resolution: 'Use PostgreSQL' });

        const task = createTaskWithDecisions('TASK-001', ['DEC-001', 'DEC-002']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const decCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DECISIONS
          );
          expect(decCondition!.passed).toBe(true);
          expect(decCondition!.details).toContain('2 linked decisions resolved');
        }
      });
    });

    describe('Fail cases', () => {
      it('should FAIL when a linked decision is PENDING', async () => {
        decisionStorage.addDecision({ id: 'DEC-001', status: 'PENDING' });

        const task = createTaskWithDecisions('TASK-001', ['DEC-001']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const decCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DECISIONS
          );
          expect(decCondition!.passed).toBe(false);
          expect(decCondition!.details).toContain('DEC-001');
          expect(decCondition!.details).toContain('PENDING');
        }
      });

      it('should FAIL when a linked decision is DEFERRED', async () => {
        decisionStorage.addDecision({ id: 'DEC-001', status: 'DEFERRED' });

        const task = createTaskWithDecisions('TASK-001', ['DEC-001']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const decCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DECISIONS
          );
          expect(decCondition!.passed).toBe(false);
          expect(decCondition!.details).toContain('DEFERRED');
        }
      });

      it('should FAIL when a linked decision does not exist', async () => {
        const task = createTaskWithDecisions('TASK-001', ['DEC-NONEXISTENT']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const decCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.DECISIONS
          );
          expect(decCondition!.passed).toBe(false);
          expect(decCondition!.details).toContain('DEC-NONEXISTENT');
          expect(decCondition!.details).toContain('not found');
        }
      });
    });
  });

  // ===========================================================================
  // 4. Assignee Has Role Tests
  // Validates: R01.2 - "Assignee memiliki role yang sesuai dengan role_required"
  // ===========================================================================
  describe('4. Assignee Has Role Check', () => {
    describe('Pass cases', () => {
      it('should PASS when no role is required', async () => {
        const task = createTaskWithAssignment('TASK-001', 'dev-001', null);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const roleCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ROLE_MATCH
          );
          expect(roleCondition!.passed).toBe(true);
        }
      });

      it('should PASS when assignee has the required role', async () => {
        teamStorage.addMember({ id: 'dev-001', roles: ['backend', 'fullstack'] });

        const task = createTaskWithAssignment('TASK-001', 'dev-001', 'backend');
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const roleCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ROLE_MATCH
          );
          expect(roleCondition!.passed).toBe(true);
          expect(roleCondition!.details).toContain('dev-001');
          expect(roleCondition!.details).toContain('backend');
        }
      });

      it('should PASS when no assignee and no role required', async () => {
        const task = createTaskWithAssignment('TASK-001', null, null);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const roleCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ROLE_MATCH
          );
          expect(roleCondition!.passed).toBe(true);
        }
      });
    });

    describe('Fail cases', () => {
      it('should FAIL when assignee does not have the required role', async () => {
        teamStorage.addMember({ id: 'dev-001', roles: ['frontend'] });

        const task = createTaskWithAssignment('TASK-001', 'dev-001', 'backend');
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const roleCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ROLE_MATCH
          );
          expect(roleCondition!.passed).toBe(false);
          expect(roleCondition!.details).toContain('dev-001');
          expect(roleCondition!.details).toContain('lacks');
          expect(roleCondition!.details).toContain('backend');
        }
      });

      it('should FAIL when assignee is not found in team', async () => {
        // Don't add the member to team storage

        const task = createTaskWithAssignment('TASK-001', 'unknown-dev', 'backend');
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const roleCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ROLE_MATCH
          );
          expect(roleCondition!.passed).toBe(false);
          expect(roleCondition!.details).toContain('unknown-dev');
          expect(roleCondition!.details).toContain('not found');
        }
      });

      it('should FAIL when role required but no assignee (with requireAssigneeForRoleCheck enabled)', async () => {
        // Default config has requireAssigneeForRoleCheck: true
        const task = createTaskWithAssignment('TASK-001', null, 'backend');
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const roleCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.ROLE_MATCH
          );
          expect(roleCondition!.passed).toBe(false);
          expect(roleCondition!.details).toContain('No assignee');
          expect(roleCondition!.details).toContain('backend');
        }
      });
    });
  });

  // ===========================================================================
  // 5. No Active Blockers Tests
  // Validates: R01.2, R01.4 - "WHEN task memiliki blocker aktif (BLOCKER-xxx dengan status OPEN)"
  // ===========================================================================
  describe('5. No Active Blockers Check', () => {
    describe('Pass cases', () => {
      it('should PASS when task has no blocker refs', async () => {
        const task = createTaskWithBlockers('TASK-001', []);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const blockerCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.NO_BLOCKERS
          );
          expect(blockerCondition!.passed).toBe(true);
          expect(blockerCondition!.details).toBe('No blockers');
        }
      });

      it('should PASS when all blockers are CLOSED', async () => {
        blockerStorage.addBlocker({ id: 'BLOCKER-001', status: 'CLOSED', description: 'Old issue' });
        blockerStorage.addBlocker({ id: 'BLOCKER-002', status: 'CLOSED', description: 'Fixed' });

        const task = createTaskWithBlockers('TASK-001', ['BLOCKER-001', 'BLOCKER-002']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const blockerCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.NO_BLOCKERS
          );
          expect(blockerCondition!.passed).toBe(true);
          expect(blockerCondition!.details).toContain('2 blockers resolved');
        }
      });
    });

    describe('Fail cases', () => {
      it('should FAIL when task has an OPEN blocker', async () => {
        blockerStorage.addBlocker({ id: 'BLOCKER-001', status: 'OPEN', description: 'API not ready' });

        const task = createTaskWithBlockers('TASK-001', ['BLOCKER-001']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const blockerCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.NO_BLOCKERS
          );
          expect(blockerCondition!.passed).toBe(false);
          expect(blockerCondition!.details).toContain('BLOCKER-001');
        }
      });

      it('should FAIL when task blocked flag is true', async () => {
        const task = createTaskWithBlockers('TASK-001', ['BLOCKER-001'], true);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const blockerCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.NO_BLOCKERS
          );
          expect(blockerCondition!.passed).toBe(false);
          expect(blockerCondition!.details).toContain('Task is blocked');
        }
      });

      it('should FAIL when blocker reference exists but blocker not found (conservative)', async () => {
        // Blocker reference exists but blocker not in storage
        const task = createTaskWithBlockers('TASK-001', ['BLOCKER-UNKNOWN']);
        taskStorage.addTask(task);

        const result = await validator.validateDoR('TASK-001');

        expect(result.success).toBe(true);
        if (result.success) {
          const blockerCondition = result.value.conditions.find(
            c => c.id === DOR_CONDITION_IDS.NO_BLOCKERS
          );
          expect(blockerCondition!.passed).toBe(false);
          expect(blockerCondition!.details).toContain('BLOCKER-UNKNOWN');
          expect(blockerCondition!.details).toContain('not found');
        }
      });
    });
  });

  // ===========================================================================
  // 6. Combined Validation Tests
  // Validates: R01.1, R01.3 - "sistem SHALL memvalidasi semua kondisi Definition of Ready"
  // ===========================================================================
  describe('6. Combined Validation', () => {
    it('should PASS overall when all conditions pass', async () => {
      // Setup: All conditions satisfied
      teamStorage.addMember({ id: 'dev-001', roles: ['backend'] });
      decisionStorage.addDecision({ id: 'DEC-001', status: 'RESOLVED' });
      const depTask = createValidTask({ id: 'TASK-DEP-1', status: 'DONE' });
      taskStorage.addTask(depTask);

      const task = createValidTask({
        id: 'TASK-001',
        acceptance_criteria: ['AC1: Test criteria'],
        depends_on: [{ task_id: 'TASK-DEP-1', type: 'blocking' }],
        linked_decisions: ['DEC-001'],
        assignment: { assignee: 'dev-001', role_required: 'backend' },
        blocker_refs: [],
        blocked: false,
      });
      taskStorage.addTask(task);

      const result = await validator.validateDoR('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(true);
        expect(result.value.conditions.length).toBe(5);
        expect(result.value.conditions.every(c => c.passed)).toBe(true);
        expect(result.value.summary.failed_conditions).toBe(0);
      }
    });

    it('should FAIL overall when any condition fails', async () => {
      // Setup: AC condition fails (empty)
      const task = createValidTask({
        id: 'TASK-001',
        acceptance_criteria: [], // This will fail
      });
      taskStorage.addTask(task);

      const result = await validator.validateDoR('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(false);
        expect(result.value.summary.failed_conditions).toBeGreaterThan(0);
        expect(result.value.summary.failed_condition_ids).toContain(DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA);
      }
    });

    it('should FAIL overall when multiple conditions fail', async () => {
      // Setup: Multiple conditions fail
      const depTask = createValidTask({ id: 'TASK-DEP-1', status: 'IN_PROGRESS' });
      taskStorage.addTask(depTask);
      blockerStorage.addBlocker({ id: 'BLOCKER-001', status: 'OPEN' });

      const task = createValidTask({
        id: 'TASK-001',
        acceptance_criteria: [], // Fail
        depends_on: [{ task_id: 'TASK-DEP-1', type: 'blocking' }], // Fail
        blocker_refs: ['BLOCKER-001'], // Fail
      });
      taskStorage.addTask(task);

      const result = await validator.validateDoR('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(false);
        expect(result.value.summary.failed_conditions).toBeGreaterThanOrEqual(3);
      }
    });

    it('should return error when task not found', async () => {
      const result = await validator.validateDoR('TASK-NONEXISTENT');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(DoRErrorCode.TASK_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // 7. canStartWork Tests
  // Validates: R01.1, R01.3, R01.4
  // ===========================================================================
  describe('7. canStartWork Method', () => {
    it('should allow work when all DoR conditions pass', async () => {
      const task = createValidTask({
        id: 'TASK-001',
        acceptance_criteria: ['AC1'],
        blocked: false,
      });
      taskStorage.addTask(task);

      const result = await validator.canStartWork('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.allowed).toBe(true);
        expect(result.value.blockers.length).toBe(0);
      }
    });

    it('should block work when task has active blockers (R01.4)', async () => {
      const task = createTaskWithBlockers('TASK-001', ['BLOCKER-001'], true);
      taskStorage.addTask(task);

      const result = await validator.canStartWork('TASK-001');

      // Should return error for blocked task
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(DoRErrorCode.TASK_BLOCKED);
      }
    });

    it('should not allow work when DoR conditions fail', async () => {
      const task = createValidTask({
        id: 'TASK-001',
        acceptance_criteria: [], // Empty AC
        blocked: false,
      });
      taskStorage.addTask(task);

      const result = await validator.canStartWork('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.allowed).toBe(false);
        expect(result.value.blockers.length).toBeGreaterThan(0);
      }
    });

    it('should provide suggestions for failed conditions', async () => {
      const task = createValidTask({
        id: 'TASK-001',
        acceptance_criteria: [],
        blocked: false,
      });
      taskStorage.addTask(task);

      const result = await validator.canStartWork('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.suggestions).toBeDefined();
        expect(result.value.suggestions!.length).toBeGreaterThan(0);
      }
    });

    it('should return error when task not found', async () => {
      const result = await validator.canStartWork('TASK-NONEXISTENT');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(DoRErrorCode.TASK_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // 8. revalidateAffectedTasks Tests
  // Validates: R01.6 - "WHEN kondisi dependency berubah"
  // ===========================================================================
  describe('8. revalidateAffectedTasks Method', () => {
    it('should revalidate tasks that depend on the changed task', async () => {
      // Setup: TASK-DEP completed, TASK-001 depends on it
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'DONE' });
      taskStorage.addTask(depTask);

      const task = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      const result = await validator.revalidateAffectedTasks('TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger_task_id).toBe('TASK-DEP');
        expect(result.value.affected_tasks.length).toBe(1);
        expect(result.value.affected_tasks[0].task_id).toBe('TASK-001');
      }
    });

    it('should return empty affected tasks when no dependents', async () => {
      const task = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task);

      const result = await validator.revalidateAffectedTasks('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(0);
        expect(result.value.summary.total_affected).toBe(0);
      }
    });

    it('should track status changes in summary', async () => {
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'DONE' });
      taskStorage.addTask(depTask);

      const task1 = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task1.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task1);

      const task2 = createTaskWithDependencies('TASK-002', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task2.acceptance_criteria = ['AC2'];
      taskStorage.addTask(task2);

      const result = await validator.revalidateAffectedTasks('TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.summary.total_affected).toBe(2);
      }
    });

    it('should use stored DoR result for previous status', async () => {
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'DONE' });
      taskStorage.addTask(depTask);

      const task = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      // First validation - should pass and store result
      await validator.validateDoR('TASK-001');
      
      // Now revalidate - should detect no change
      const result = await validator.revalidateAffectedTasks('TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(1);
        expect(result.value.affected_tasks[0].previous_status).toBe(true);
        expect(result.value.affected_tasks[0].new_status).toBe(true);
        expect(result.value.affected_tasks[0].status_changed).toBe(false);
      }
    });
  });

  // ===========================================================================
  // 8b. revalidateOnDependencyComplete Tests
  // Validates: R01.6 - "Dependency completes → revalidate dependent tasks"
  // ===========================================================================
  describe('8b. revalidateOnDependencyComplete Method', () => {
    it('should revalidate tasks with blocking dependency on completed task', async () => {
      // Setup: Dependency task completed
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'DONE' });
      taskStorage.addTask(depTask);

      const task = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      const result = await validator.revalidateOnDependencyComplete('TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger_task_id).toBe('TASK-DEP');
        expect(result.value.trigger_reason).toBe('dependency_completed');
        expect(result.value.affected_tasks.length).toBe(1);
        expect(result.value.affected_tasks[0].task_id).toBe('TASK-001');
        expect(result.value.affected_tasks[0].new_status).toBe(true); // Should pass now
      }
    });

    it('should NOT revalidate tasks with non-blocking dependency', async () => {
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'DONE' });
      taskStorage.addTask(depTask);

      const task = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'non_blocking' }, // Non-blocking
      ]);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      const result = await validator.revalidateOnDependencyComplete('TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(0);
      }
    });

    it('should identify tasks that became ready after dependency completion', async () => {
      // Setup: Dependency was IN_PROGRESS, task was not ready
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'IN_PROGRESS' });
      taskStorage.addTask(depTask);

      const task = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      // Validate - should fail due to unmet dependency
      const initialResult = await validator.validateDoR('TASK-001');
      expect(initialResult.success).toBe(true);
      if (initialResult.success) {
        expect(initialResult.value.passed).toBe(false);
      }

      // Now mark dependency as complete
      taskStorage.updateTask({ ...depTask, status: 'DONE' });

      // Revalidate
      const result = await validator.revalidateOnDependencyComplete('TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(1);
        expect(result.value.affected_tasks[0].previous_status).toBe(false);
        expect(result.value.affected_tasks[0].new_status).toBe(true);
        expect(result.value.affected_tasks[0].status_changed).toBe(true);
        expect(result.value.summary.newly_ready).toBe(1);
        expect(result.value.summary.newly_ready_task_ids).toContain('TASK-001');
      }
    });

    it('should handle multiple dependent tasks', async () => {
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'DONE' });
      taskStorage.addTask(depTask);

      const task1 = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task1.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task1);

      const task2 = createTaskWithDependencies('TASK-002', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task2.acceptance_criteria = ['AC2'];
      taskStorage.addTask(task2);

      const task3 = createTaskWithDependencies('TASK-003', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      task3.acceptance_criteria = []; // Missing AC - will still fail
      taskStorage.addTask(task3);

      const result = await validator.revalidateOnDependencyComplete('TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(3);
        // TASK-001 and TASK-002 should pass, TASK-003 should fail due to missing AC
        const task3Result = result.value.affected_tasks.find(t => t.task_id === 'TASK-003');
        expect(task3Result?.new_status).toBe(false);
      }
    });
  });

  // ===========================================================================
  // 8c. revalidateOnBlockerResolved Tests
  // Validates: R01.6 - "Blocker resolved → revalidate blocked task"
  // ===========================================================================
  describe('8c. revalidateOnBlockerResolved Method', () => {
    it('should revalidate tasks that reference the resolved blocker', async () => {
      // Setup: Blocker is now CLOSED
      blockerStorage.addBlocker({ id: 'BLOCKER-001', status: 'CLOSED' });

      const task = createTaskWithBlockers('TASK-001', ['BLOCKER-001']);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      const result = await validator.revalidateOnBlockerResolved('BLOCKER-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger_task_id).toBe('BLOCKER-001');
        expect(result.value.trigger_reason).toBe('blocker_resolved');
        expect(result.value.affected_tasks.length).toBe(1);
        expect(result.value.affected_tasks[0].task_id).toBe('TASK-001');
        expect(result.value.affected_tasks[0].new_status).toBe(true); // Should pass now
      }
    });

    it('should identify tasks that became unblocked and ready', async () => {
      // Setup: Blocker was OPEN, now CLOSED
      blockerStorage.addBlocker({ id: 'BLOCKER-001', status: 'OPEN' });

      const task = createTaskWithBlockers('TASK-001', ['BLOCKER-001']);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      // Validate - should fail due to active blocker
      const initialResult = await validator.validateDoR('TASK-001');
      expect(initialResult.success).toBe(true);
      if (initialResult.success) {
        expect(initialResult.value.passed).toBe(false);
      }

      // Now resolve the blocker
      blockerStorage.addBlocker({ id: 'BLOCKER-001', status: 'CLOSED' });

      // Revalidate
      const result = await validator.revalidateOnBlockerResolved('BLOCKER-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(1);
        expect(result.value.affected_tasks[0].previous_status).toBe(false);
        expect(result.value.affected_tasks[0].new_status).toBe(true);
        expect(result.value.affected_tasks[0].status_changed).toBe(true);
        expect(result.value.summary.newly_ready).toBe(1);
      }
    });

    it('should return empty when no tasks reference the blocker', async () => {
      blockerStorage.addBlocker({ id: 'BLOCKER-001', status: 'CLOSED' });

      const task = createValidTask({ id: 'TASK-001' }); // No blocker refs
      taskStorage.addTask(task);

      const result = await validator.revalidateOnBlockerResolved('BLOCKER-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(0);
      }
    });

    it('should handle task with multiple blockers where only one resolved', async () => {
      blockerStorage.addBlocker({ id: 'BLOCKER-001', status: 'CLOSED' });
      blockerStorage.addBlocker({ id: 'BLOCKER-002', status: 'OPEN' }); // Still open

      const task = createTaskWithBlockers('TASK-001', ['BLOCKER-001', 'BLOCKER-002']);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      const result = await validator.revalidateOnBlockerResolved('BLOCKER-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(1);
        // Task should still fail because BLOCKER-002 is still OPEN
        expect(result.value.affected_tasks[0].new_status).toBe(false);
      }
    });
  });

  // ===========================================================================
  // 8d. revalidateOnDecisionResolved Tests
  // Validates: R01.6 - "Decision resolved → revalidate linked tasks"
  // ===========================================================================
  describe('8d. revalidateOnDecisionResolved Method', () => {
    it('should revalidate tasks that link to the resolved decision', async () => {
      // Setup: Decision is now RESOLVED
      decisionStorage.addDecision({ id: 'DEC-001', status: 'RESOLVED' });

      const task = createTaskWithDecisions('TASK-001', ['DEC-001']);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      const result = await validator.revalidateOnDecisionResolved('DEC-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger_task_id).toBe('DEC-001');
        expect(result.value.trigger_reason).toBe('decision_resolved');
        expect(result.value.affected_tasks.length).toBe(1);
        expect(result.value.affected_tasks[0].task_id).toBe('TASK-001');
        expect(result.value.affected_tasks[0].new_status).toBe(true); // Should pass now
      }
    });

    it('should identify tasks that became ready after decision resolution', async () => {
      // Setup: Decision was PENDING
      decisionStorage.addDecision({ id: 'DEC-001', status: 'PENDING' });

      const task = createTaskWithDecisions('TASK-001', ['DEC-001']);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      // Validate - should fail due to unresolved decision
      const initialResult = await validator.validateDoR('TASK-001');
      expect(initialResult.success).toBe(true);
      if (initialResult.success) {
        expect(initialResult.value.passed).toBe(false);
      }

      // Now resolve the decision
      decisionStorage.addDecision({ id: 'DEC-001', status: 'RESOLVED' });

      // Revalidate
      const result = await validator.revalidateOnDecisionResolved('DEC-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(1);
        expect(result.value.affected_tasks[0].previous_status).toBe(false);
        expect(result.value.affected_tasks[0].new_status).toBe(true);
        expect(result.value.affected_tasks[0].status_changed).toBe(true);
        expect(result.value.summary.newly_ready).toBe(1);
      }
    });

    it('should return empty when no tasks link to the decision', async () => {
      decisionStorage.addDecision({ id: 'DEC-001', status: 'RESOLVED' });

      const task = createValidTask({ id: 'TASK-001' }); // No linked decisions
      taskStorage.addTask(task);

      const result = await validator.revalidateOnDecisionResolved('DEC-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(0);
      }
    });

    it('should handle task with multiple decisions where only one resolved', async () => {
      decisionStorage.addDecision({ id: 'DEC-001', status: 'RESOLVED' });
      decisionStorage.addDecision({ id: 'DEC-002', status: 'PENDING' }); // Still pending

      const task = createTaskWithDecisions('TASK-001', ['DEC-001', 'DEC-002']);
      task.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task);

      const result = await validator.revalidateOnDecisionResolved('DEC-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(1);
        // Task should still fail because DEC-002 is still PENDING
        expect(result.value.affected_tasks[0].new_status).toBe(false);
      }
    });

    it('should handle multiple tasks linked to the same decision', async () => {
      decisionStorage.addDecision({ id: 'DEC-001', status: 'RESOLVED' });

      const task1 = createTaskWithDecisions('TASK-001', ['DEC-001']);
      task1.acceptance_criteria = ['AC1'];
      taskStorage.addTask(task1);

      const task2 = createTaskWithDecisions('TASK-002', ['DEC-001']);
      task2.acceptance_criteria = ['AC2'];
      taskStorage.addTask(task2);

      const result = await validator.revalidateOnDecisionResolved('DEC-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.affected_tasks.length).toBe(2);
        expect(result.value.summary.total_affected).toBe(2);
      }
    });
  });

  // ===========================================================================
  // 8e. getTasksNeedingRevalidation Tests
  // Validates: R01.6 - Generic method to find affected tasks
  // ===========================================================================
  describe('8e. getTasksNeedingRevalidation Method', () => {
    it('should find tasks needing revalidation for dependency change', async () => {
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'DONE' });
      taskStorage.addTask(depTask);

      const task = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      taskStorage.addTask(task);

      const result = await validator.getTasksNeedingRevalidation('dependency', 'TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].id).toBe('TASK-001');
      }
    });

    it('should find tasks needing revalidation for blocker change', async () => {
      const task = createTaskWithBlockers('TASK-001', ['BLOCKER-001']);
      taskStorage.addTask(task);

      const result = await validator.getTasksNeedingRevalidation('blocker', 'BLOCKER-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].id).toBe('TASK-001');
      }
    });

    it('should find tasks needing revalidation for decision change', async () => {
      const task = createTaskWithDecisions('TASK-001', ['DEC-001']);
      taskStorage.addTask(task);

      const result = await validator.getTasksNeedingRevalidation('decision', 'DEC-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].id).toBe('TASK-001');
      }
    });

    it('should return empty array when no tasks affected', async () => {
      const task = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task);

      const result = await validator.getTasksNeedingRevalidation('dependency', 'TASK-UNKNOWN');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(0);
      }
    });

    it('should filter to only blocking dependencies for dependency change type', async () => {
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'DONE' });
      taskStorage.addTask(depTask);

      const blockingTask = createTaskWithDependencies('TASK-001', [
        { task_id: 'TASK-DEP', type: 'blocking' },
      ]);
      taskStorage.addTask(blockingTask);

      const nonBlockingTask = createTaskWithDependencies('TASK-002', [
        { task_id: 'TASK-DEP', type: 'non_blocking' },
      ]);
      taskStorage.addTask(nonBlockingTask);

      const result = await validator.getTasksNeedingRevalidation('dependency', 'TASK-DEP');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].id).toBe('TASK-001');
      }
    });
  });

  // ===========================================================================
  // 9. getDoRConditions Tests
  // Validates: R01.2
  // ===========================================================================
  describe('9. getDoRConditions Method', () => {
    it('should return all DoR conditions for a task', async () => {
      const task = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task);

      const result = await validator.getDoRConditions('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(5);
        const conditionIds = result.value.map(c => c.id);
        expect(conditionIds).toContain(DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA);
        expect(conditionIds).toContain(DOR_CONDITION_IDS.DEPENDENCIES);
        expect(conditionIds).toContain(DOR_CONDITION_IDS.DECISIONS);
        expect(conditionIds).toContain(DOR_CONDITION_IDS.ROLE_MATCH);
        expect(conditionIds).toContain(DOR_CONDITION_IDS.NO_BLOCKERS);
      }
    });

    it('should return error when task not found', async () => {
      const result = await validator.getDoRConditions('TASK-NONEXISTENT');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(DoRErrorCode.TASK_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // 10. DoR Check Result Storage Tests
  // Validates: R01.5 - "Sistem SHALL menyimpan DoR check result"
  // ===========================================================================
  describe('10. DoR Check Result Storage', () => {
    it('should store DoR check result with timestamp (R01.5)', async () => {
      const task = createValidTask({ id: 'TASK-001' });
      taskStorage.addTask(task);

      const result = await validator.validateDoR('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.last_checked_at).toBeDefined();
        expect(new Date(result.value.last_checked_at).getTime()).not.toBeNaN();
      }

      // Verify it was stored
      const storedResult = taskStorage.getDoRCheckResult('TASK-001');
      expect(storedResult).toBeDefined();
      expect(storedResult!.task_id).toBe('TASK-001');
    });
  });

  // ===========================================================================
  // 11. Error Message Content Tests  
  // Validates: R01.3 - "sistem SHALL menolak transisi dengan pesan yang menyebutkan kondisi mana yang gagal"
  // ===========================================================================
  describe('11. Error Message Content', () => {
    it('should include which conditions failed in the validation summary', async () => {
      const depTask = createValidTask({ id: 'TASK-DEP', status: 'IN_PROGRESS' });
      taskStorage.addTask(depTask);

      const task = createValidTask({
        id: 'TASK-001',
        acceptance_criteria: [], // Fails
        depends_on: [{ task_id: 'TASK-DEP', type: 'blocking' }], // Fails
      });
      taskStorage.addTask(task);

      const result = await validator.validateDoR('TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.summary.blocking_reasons.length).toBeGreaterThan(0);
        // The blocking_reasons should clearly identify what failed
        expect(result.value.summary.blocking_reasons.some(
          r => r.includes('Acceptance criteria') || r.includes('dependencies')
        )).toBe(true);
      }
    });
  });
});
