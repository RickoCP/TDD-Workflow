/**
 * Unit Tests for Task Lifecycle Manager
 * 
 * Tests the TaskLifecycleManager implementation covering:
 * - All task states from R04.1
 * - BLOCKED as orthogonal attribute (R04.2)
 * - HANDOFF_PENDING as orthogonal attribute (R04.3)
 * - Transition guards enforcement (R04.4)
 * - Invalid transition rejection (R04.5)
 * 
 * Requirements: R04.1, R04.2, R04.3, R04.4, R04.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Types
  TaskState,
  TaskForLifecycle,
  TransitionRequest,
  TransitionResult,
  CanTransitionResult,
  ValidTransitionsResult,
  BlockedStatus,
  HandoffPendingStatus,
  StateHistoryEntry,
  LifecycleError,
  LifecycleErrorCode,
  TransitionReason,
  // Constants
  TASK_STATES,
  TERMINAL_STATES,
  BLOCKABLE_STATES,
  HANDOFF_PENDING_STATES,
  TRANSITION_DEFINITIONS,
  // Helper functions
  isValidState,
  isTerminalState,
  isBlockableState,
  isHandoffPendingState,
  getTransitionDefinition,
  getValidTransitionsFrom,
  createEmptyBlockedStatus,
  createBlockedStatus,
  createEmptyHandoffStatus,
  createHandoffPendingStatus,
  createStateHistoryEntry,
  createInitialTaskForLifecycle,
  // Implementation
  TaskLifecycleManagerImpl,
  InMemoryTaskStorageForLifecycle,
  TaskStorageForLifecycle,
  DoRValidatorForLifecycle,
  FindingsCheckerForLifecycle,
  BlockerCheckerForLifecycle,
} from '../task-lifecycle';
import { Result, ok, err } from '../state-controller';
import { CanStartWorkResult } from '../dor-validator';

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestTask(
  id: string,
  status: TaskState,
  overrides: Partial<TaskForLifecycle> = {}
): TaskForLifecycle {
  return {
    ...createInitialTaskForLifecycle(id, status),
    ...overrides,
  };
}

function createMockDoRValidator(result: boolean, blockers: string[] = []): DoRValidatorForLifecycle {
  return {
    canStartWork: async (_taskId: string) => {
      return ok({
        allowed: result,
        blockers,
        validation: {
          task_id: _taskId,
          passed: result,
          last_checked_at: new Date().toISOString(),
          conditions: [],
          summary: {
            total_conditions: 0,
            passed_conditions: 0,
            failed_conditions: 0,
            failed_condition_ids: [],
            blocking_reasons: blockers,
          },
        },
      });
    },
  };
}

function createMockFindingsChecker(hasBlocking: boolean): FindingsCheckerForLifecycle {
  return {
    hasBlockingFindings: async () => hasBlocking,
  };
}

function createMockBlockerChecker(
  resolvedBlockers: string[] = [],
  unresolvedBlockers: string[] = []
): BlockerCheckerForLifecycle {
  return {
    areBlockersResolved: async (refs: string[]) => {
      return refs.every(r => resolvedBlockers.includes(r));
    },
    getUnresolvedBlockers: async (refs: string[]) => {
      return refs.filter(r => unresolvedBlockers.includes(r));
    },
  };
}

// =============================================================================
// Tests: Task States (R04.1)
// =============================================================================

describe('Task States - R04.1', () => {
  describe('TASK_STATES constant', () => {
    it('should include all required states from R04.1', () => {
      const requiredStates = [
        'PENDING',
        'READY',
        'ASSIGNED',
        'IN_PROGRESS',
        'REVIEW',
        'CHANGES_REQUESTED',
        'READY_TO_MERGE',
        'INTEGRATED',
        'DONE',
        'CANCELLED',
        'SUPERSEDED',
      ];

      for (const state of requiredStates) {
        expect(TASK_STATES).toContain(state);
      }
    });

    it('should have exactly 11 states', () => {
      expect(TASK_STATES.length).toBe(11);
    });
  });

  describe('isValidState', () => {
    it('should return true for all valid states', () => {
      for (const state of TASK_STATES) {
        expect(isValidState(state)).toBe(true);
      }
    });

    it('should return false for invalid states', () => {
      expect(isValidState('INVALID')).toBe(false);
      expect(isValidState('')).toBe(false);
      expect(isValidState('pending')).toBe(false); // case sensitive
    });
  });

  describe('Terminal states', () => {
    it('should include DONE, CANCELLED, SUPERSEDED', () => {
      expect(TERMINAL_STATES).toContain('DONE');
      expect(TERMINAL_STATES).toContain('CANCELLED');
      expect(TERMINAL_STATES).toContain('SUPERSEDED');
    });

    it('should correctly identify terminal states', () => {
      expect(isTerminalState('DONE')).toBe(true);
      expect(isTerminalState('CANCELLED')).toBe(true);
      expect(isTerminalState('SUPERSEDED')).toBe(true);
      expect(isTerminalState('IN_PROGRESS')).toBe(false);
      expect(isTerminalState('PENDING')).toBe(false);
    });
  });
});

// =============================================================================
// Tests: BLOCKED Orthogonal Attribute (R04.2)
// =============================================================================

describe('BLOCKED Orthogonal Attribute - R04.2', () => {
  describe('BLOCKABLE_STATES constant', () => {
    it('should include PENDING, READY, ASSIGNED, IN_PROGRESS, REVIEW', () => {
      expect(BLOCKABLE_STATES).toContain('PENDING');
      expect(BLOCKABLE_STATES).toContain('READY');
      expect(BLOCKABLE_STATES).toContain('ASSIGNED');
      expect(BLOCKABLE_STATES).toContain('IN_PROGRESS');
      expect(BLOCKABLE_STATES).toContain('REVIEW');
    });

    it('should not include terminal states', () => {
      expect(BLOCKABLE_STATES).not.toContain('DONE');
      expect(BLOCKABLE_STATES).not.toContain('CANCELLED');
      expect(BLOCKABLE_STATES).not.toContain('SUPERSEDED');
    });
  });

  describe('isBlockableState', () => {
    it('should return true for blockable states', () => {
      expect(isBlockableState('PENDING')).toBe(true);
      expect(isBlockableState('READY')).toBe(true);
      expect(isBlockableState('ASSIGNED')).toBe(true);
      expect(isBlockableState('IN_PROGRESS')).toBe(true);
      expect(isBlockableState('REVIEW')).toBe(true);
    });

    it('should return false for non-blockable states', () => {
      expect(isBlockableState('DONE')).toBe(false);
      expect(isBlockableState('CANCELLED')).toBe(false);
      expect(isBlockableState('READY_TO_MERGE')).toBe(false);
    });
  });

  describe('BlockedStatus creation', () => {
    it('should create empty blocked status', () => {
      const status = createEmptyBlockedStatus();
      expect(status.blocked).toBe(false);
      expect(status.blocked_reason).toBeNull();
      expect(status.blocker_refs).toEqual([]);
      expect(status.blocked_since).toBeNull();
      expect(status.blocked_phase).toBeNull();
    });

    it('should create blocked status with details', () => {
      const status = createBlockedStatus(
        'Waiting for API',
        ['BLOCKER-001', 'BLOCKER-002'],
        'IN_PROGRESS'
      );
      expect(status.blocked).toBe(true);
      expect(status.blocked_reason).toBe('Waiting for API');
      expect(status.blocker_refs).toEqual(['BLOCKER-001', 'BLOCKER-002']);
      expect(status.blocked_since).not.toBeNull();
      expect(status.blocked_phase).toBe('IN_PROGRESS');
    });
  });

  describe('setBlocked operation', () => {
    let storage: InMemoryTaskStorageForLifecycle;
    let manager: TaskLifecycleManagerImpl;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForLifecycle();
      manager = new TaskLifecycleManagerImpl({ taskStorage: storage });
    });

    it('should block a task in blockable state', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS');
      storage.addTask(task);

      const result = await manager.setBlocked('TASK-001', true, {
        reason: 'Waiting for external API',
        blocker_refs: ['BLOCKER-001'],
      }, 'dev-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.blocked_status?.blocked).toBe(true);
        expect(result.value.blocked_status?.blocked_reason).toBe('Waiting for external API');
        expect(result.value.blocked_status?.blocker_refs).toContain('BLOCKER-001');
        expect(result.value.history_entry.reason).toBe('blocker_added');
      }
    });

    it('should reject blocking non-blockable state', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.setBlocked('TASK-001', true, {
        reason: 'Test',
        blocker_refs: ['BLOCKER-001'],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.INVALID_ORTHOGONAL_CHANGE);
      }
    });

    it('should require blocker info when blocking', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS');
      storage.addTask(task);

      const result = await manager.setBlocked('TASK-001', true);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.BLOCKER_NOT_SPECIFIED);
      }
    });

    it('should unblock a task', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS', {
        blocked_status: createBlockedStatus('Test', ['BLOCKER-001'], 'IN_PROGRESS'),
      });
      storage.addTask(task);

      const blockerChecker = createMockBlockerChecker(['BLOCKER-001'], []);
      const managerWithChecker = new TaskLifecycleManagerImpl({
        taskStorage: storage,
        blockerChecker,
      });

      const result = await managerWithChecker.setBlocked('TASK-001', false, undefined, 'dev-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.blocked_status?.blocked).toBe(false);
        expect(result.value.history_entry.reason).toBe('blocker_resolved');
      }
    });

    it('should prevent unblocking when blockers not resolved', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS', {
        blocked_status: createBlockedStatus('Test', ['BLOCKER-001'], 'IN_PROGRESS'),
      });
      storage.addTask(task);

      const blockerChecker = createMockBlockerChecker([], ['BLOCKER-001']);
      const managerWithChecker = new TaskLifecycleManagerImpl({
        taskStorage: storage,
        blockerChecker,
      });

      const result = await managerWithChecker.setBlocked('TASK-001', false);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.BLOCKERS_NOT_RESOLVED);
      }
    });
  });
});

// =============================================================================
// Tests: HANDOFF_PENDING Orthogonal Attribute (R04.3)
// =============================================================================

describe('HANDOFF_PENDING Orthogonal Attribute - R04.3', () => {
  describe('HANDOFF_PENDING_STATES constant', () => {
    it('should include IN_PROGRESS', () => {
      expect(HANDOFF_PENDING_STATES).toContain('IN_PROGRESS');
    });

    it('should only include IN_PROGRESS', () => {
      expect(HANDOFF_PENDING_STATES.length).toBe(1);
    });
  });

  describe('isHandoffPendingState', () => {
    it('should return true for IN_PROGRESS', () => {
      expect(isHandoffPendingState('IN_PROGRESS')).toBe(true);
    });

    it('should return false for other states', () => {
      expect(isHandoffPendingState('PENDING')).toBe(false);
      expect(isHandoffPendingState('REVIEW')).toBe(false);
      expect(isHandoffPendingState('DONE')).toBe(false);
    });
  });

  describe('HandoffPendingStatus creation', () => {
    it('should create empty handoff status', () => {
      const status = createEmptyHandoffStatus();
      expect(status.handoff_pending).toBe(false);
      expect(status.handoff_id).toBeNull();
      expect(status.handoff_initiated_at).toBeNull();
    });

    it('should create handoff pending status', () => {
      const status = createHandoffPendingStatus('HO-001');
      expect(status.handoff_pending).toBe(true);
      expect(status.handoff_id).toBe('HO-001');
      expect(status.handoff_initiated_at).not.toBeNull();
    });
  });

  describe('setHandoffPending operation', () => {
    let storage: InMemoryTaskStorageForLifecycle;
    let manager: TaskLifecycleManagerImpl;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForLifecycle();
      manager = new TaskLifecycleManagerImpl({ taskStorage: storage });
    });

    it('should set handoff pending on IN_PROGRESS task', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS');
      storage.addTask(task);

      const result = await manager.setHandoffPending('TASK-001', true, 'HO-001', 'dev-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.handoff_status?.handoff_pending).toBe(true);
        expect(result.value.handoff_status?.handoff_id).toBe('HO-001');
        expect(result.value.history_entry.reason).toBe('handoff_initiated');
      }
    });

    it('should reject handoff pending on non-IN_PROGRESS state', async () => {
      const task = createTestTask('TASK-001', 'REVIEW');
      storage.addTask(task);

      const result = await manager.setHandoffPending('TASK-001', true, 'HO-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.INVALID_ORTHOGONAL_CHANGE);
      }
    });

    it('should require handoff ID when setting pending', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS');
      storage.addTask(task);

      const result = await manager.setHandoffPending('TASK-001', true);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.INVALID_ORTHOGONAL_CHANGE);
      }
    });

    it('should clear handoff pending', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS', {
        handoff_status: createHandoffPendingStatus('HO-001'),
      });
      storage.addTask(task);

      const result = await manager.setHandoffPending('TASK-001', false, undefined, 'dev-002');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.handoff_status?.handoff_pending).toBe(false);
        expect(result.value.handoff_status?.handoff_id).toBeNull();
        expect(result.value.history_entry.reason).toBe('handoff_complete');
      }
    });
  });
});

// =============================================================================
// Tests: Transition Guards (R04.4)
// =============================================================================

describe('Transition Guards - R04.4', () => {
  describe('TRANSITION_DEFINITIONS', () => {
    it('should define PENDING → READY transition', () => {
      const def = getTransitionDefinition('PENDING', 'READY');
      expect(def).not.toBeNull();
      expect(def?.guards).toContain('dor_valid');
    });

    it('should define READY → ASSIGNED transition', () => {
      const def = getTransitionDefinition('READY', 'ASSIGNED');
      expect(def).not.toBeNull();
      expect(def?.guards).toContain('has_assignee');
    });

    it('should define ASSIGNED → IN_PROGRESS transition', () => {
      const def = getTransitionDefinition('ASSIGNED', 'IN_PROGRESS');
      expect(def).not.toBeNull();
      expect(def?.guards).toContain('dor_valid');
      expect(def?.guards).toContain('not_blocked');
      expect(def?.guards).toContain('handoff_not_pending');
    });

    it('should define IN_PROGRESS → REVIEW transition', () => {
      const def = getTransitionDefinition('IN_PROGRESS', 'REVIEW');
      expect(def).not.toBeNull();
      expect(def?.guards).toContain('has_required_evidence');
      expect(def?.guards).toContain('not_blocked');
    });

    it('should define REVIEW → READY_TO_MERGE transition', () => {
      const def = getTransitionDefinition('REVIEW', 'READY_TO_MERGE');
      expect(def).not.toBeNull();
      expect(def?.guards).toContain('no_blocking_findings');
    });

    it('should define DONE → IN_PROGRESS transition (reopen)', () => {
      const def = getTransitionDefinition('DONE', 'IN_PROGRESS');
      expect(def).not.toBeNull();
      expect(def?.guards).toContain('reopen_justification');
    });
  });

  describe('Guard enforcement', () => {
    let storage: InMemoryTaskStorageForLifecycle;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForLifecycle();
    });

    it('should enforce dor_valid guard for IN_PROGRESS transition', async () => {
      const task = createTestTask('TASK-001', 'ASSIGNED', { assignee: 'dev-001' });
      storage.addTask(task);

      const dorValidator = createMockDoRValidator(false, ['AC not defined']);
      const manager = new TaskLifecycleManagerImpl({
        taskStorage: storage,
        dorValidator,
      });

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'IN_PROGRESS',
        triggered_by: 'dev-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
        expect(result.error.context?.failed_guards).toContain('dor_valid');
      }
    });

    it('should enforce has_assignee guard for ASSIGNED transition', async () => {
      const task = createTestTask('TASK-001', 'READY', { assignee: null });
      storage.addTask(task);

      const manager = new TaskLifecycleManagerImpl({ taskStorage: storage });

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'ASSIGNED',
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
        expect(result.error.context?.failed_guards).toContain('has_assignee');
      }
    });

    it('should enforce not_blocked guard', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS', {
        blocked_status: createBlockedStatus('Test', ['BLOCKER-001'], 'IN_PROGRESS'),
        evidence_refs: ['EVD-001'],
      });
      storage.addTask(task);

      const manager = new TaskLifecycleManagerImpl({ taskStorage: storage });

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'REVIEW',
        triggered_by: 'dev-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
        expect(result.error.context?.failed_guards).toContain('not_blocked');
      }
    });

    it('should enforce handoff_not_pending guard', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS', {
        handoff_status: createHandoffPendingStatus('HO-001'),
        evidence_refs: ['EVD-001'],
      });
      storage.addTask(task);

      const manager = new TaskLifecycleManagerImpl({ taskStorage: storage });

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'REVIEW',
        triggered_by: 'dev-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
        expect(result.error.context?.failed_guards).toContain('handoff_not_pending');
      }
    });

    it('should enforce has_required_evidence guard', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS', {
        evidence_refs: [], // No evidence
      });
      storage.addTask(task);

      const manager = new TaskLifecycleManagerImpl({ taskStorage: storage });

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'REVIEW',
        triggered_by: 'dev-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
        expect(result.error.context?.failed_guards).toContain('has_required_evidence');
      }
    });

    it('should enforce no_blocking_findings guard', async () => {
      const task = createTestTask('TASK-001', 'REVIEW', {
        has_blocking_findings: true,
      });
      storage.addTask(task);

      const findingsChecker = createMockFindingsChecker(true);
      const manager = new TaskLifecycleManagerImpl({
        taskStorage: storage,
        findingsChecker,
      });

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'READY_TO_MERGE',
        triggered_by: 'reviewer-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
        expect(result.error.context?.failed_guards).toContain('no_blocking_findings');
      }
    });

    it('should enforce reopen_justification guard', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const manager = new TaskLifecycleManagerImpl({ taskStorage: storage });

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'IN_PROGRESS',
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
        expect(result.error.context?.failed_guards).toContain('reopen_justification');
      }
    });

    it('should allow reopen with justification', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const manager = new TaskLifecycleManagerImpl({ taskStorage: storage });

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'IN_PROGRESS',
        triggered_by: 'lead-001',
        reason: 'reopened',
        reopen_justification: {
          reason: 'Bug found in production',
          evidence_ref: 'ISSUE-123',
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.to_state).toBe('IN_PROGRESS');
        expect(result.value.history_entry.reason).toBe('reopened');
      }
    });
  });
});

// =============================================================================
// Tests: Invalid Transition Rejection (R04.5)
// =============================================================================

describe('Invalid Transition Rejection - R04.5', () => {
  let storage: InMemoryTaskStorageForLifecycle;
  let manager: TaskLifecycleManagerImpl;

  beforeEach(() => {
    storage = new InMemoryTaskStorageForLifecycle();
    manager = new TaskLifecycleManagerImpl({ taskStorage: storage });
  });

  it('should reject PENDING → IN_PROGRESS (must go through READY and ASSIGNED)', async () => {
    const task = createTestTask('TASK-001', 'PENDING');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'IN_PROGRESS',
      triggered_by: 'dev-001',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(LifecycleErrorCode.INVALID_STATE_TRANSITION);
      expect(result.error.context?.from_state).toBe('PENDING');
      expect(result.error.context?.to_state).toBe('IN_PROGRESS');
    }
  });

  it('should reject IN_PROGRESS → DONE (must go through REVIEW)', async () => {
    const task = createTestTask('TASK-001', 'IN_PROGRESS');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'DONE',
      triggered_by: 'dev-001',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(LifecycleErrorCode.INVALID_STATE_TRANSITION);
    }
  });

  it('should reject REVIEW → INTEGRATED (must go through READY_TO_MERGE)', async () => {
    const task = createTestTask('TASK-001', 'REVIEW');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'INTEGRATED',
      triggered_by: 'dev-001',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(LifecycleErrorCode.INVALID_STATE_TRANSITION);
    }
  });

  it('should reject transition from CANCELLED', async () => {
    const task = createTestTask('TASK-001', 'CANCELLED');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'PENDING',
      triggered_by: 'lead-001',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(LifecycleErrorCode.INVALID_STATE_TRANSITION);
    }
  });

  it('should reject transition from SUPERSEDED', async () => {
    const task = createTestTask('TASK-001', 'SUPERSEDED');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'IN_PROGRESS',
      triggered_by: 'lead-001',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(LifecycleErrorCode.INVALID_STATE_TRANSITION);
    }
  });

  it('should return TASK_NOT_FOUND for non-existent task', async () => {
    const result = await manager.transitionTo({
      task_id: 'TASK-999',
      to_state: 'READY',
      triggered_by: 'dev-001',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(LifecycleErrorCode.TASK_NOT_FOUND);
    }
  });
});

// =============================================================================
// Tests: Valid State Transitions
// =============================================================================

describe('Valid State Transitions', () => {
  let storage: InMemoryTaskStorageForLifecycle;
  let manager: TaskLifecycleManagerImpl;

  beforeEach(() => {
    storage = new InMemoryTaskStorageForLifecycle();
    manager = new TaskLifecycleManagerImpl({
      taskStorage: storage,
      config: {
        requireDorForInProgress: false,
        requireEvidenceForReview: false,
        requireFindingsCheckForDone: false,
      },
    });
  });

  it('should allow PENDING → READY when DoR is met', async () => {
    const task = createTestTask('TASK-001', 'PENDING', {
      dor_validation: {
        task_id: 'TASK-001',
        passed: true,
        last_checked_at: new Date().toISOString(),
        conditions: [],
        summary: {
          total_conditions: 0,
          passed_conditions: 0,
          failed_conditions: 0,
          failed_condition_ids: [],
          blocking_reasons: [],
        },
      },
    });
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'READY',
      triggered_by: 'SYSTEM',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.from_state).toBe('PENDING');
      expect(result.value.to_state).toBe('READY');
    }
  });

  it('should allow READY → ASSIGNED when assignee is set', async () => {
    const task = createTestTask('TASK-001', 'READY', {
      assignee: 'dev-001',
    });
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'ASSIGNED',
      triggered_by: 'lead-001',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.to_state).toBe('ASSIGNED');
    }
  });

  it('should allow ASSIGNED → IN_PROGRESS', async () => {
    const task = createTestTask('TASK-001', 'ASSIGNED', {
      assignee: 'dev-001',
    });
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'IN_PROGRESS',
      triggered_by: 'dev-001',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.to_state).toBe('IN_PROGRESS');
    }
  });

  it('should allow IN_PROGRESS → REVIEW', async () => {
    const task = createTestTask('TASK-001', 'IN_PROGRESS');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'REVIEW',
      triggered_by: 'dev-001',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.to_state).toBe('REVIEW');
    }
  });

  it('should allow REVIEW → CHANGES_REQUESTED', async () => {
    const task = createTestTask('TASK-001', 'REVIEW');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'CHANGES_REQUESTED',
      triggered_by: 'reviewer-001',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.to_state).toBe('CHANGES_REQUESTED');
    }
  });

  it('should allow CHANGES_REQUESTED → IN_PROGRESS', async () => {
    const task = createTestTask('TASK-001', 'CHANGES_REQUESTED');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'IN_PROGRESS',
      triggered_by: 'dev-001',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.to_state).toBe('IN_PROGRESS');
    }
  });

  it('should allow REVIEW → READY_TO_MERGE', async () => {
    const task = createTestTask('TASK-001', 'REVIEW');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'READY_TO_MERGE',
      triggered_by: 'reviewer-001',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.to_state).toBe('READY_TO_MERGE');
    }
  });

  it('should allow READY_TO_MERGE → INTEGRATED', async () => {
    const task = createTestTask('TASK-001', 'READY_TO_MERGE');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'INTEGRATED',
      triggered_by: 'SYSTEM',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.to_state).toBe('INTEGRATED');
    }
  });

  it('should allow INTEGRATED → DONE', async () => {
    const task = createTestTask('TASK-001', 'INTEGRATED');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'DONE',
      triggered_by: 'SYSTEM',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.to_state).toBe('DONE');
    }
  });

  it('should allow any non-terminal state → CANCELLED', async () => {
    const states: TaskState[] = ['PENDING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'READY_TO_MERGE'];

    for (const state of states) {
      storage.clear();
      const task = createTestTask(`TASK-${state}`, state, {
        assignee: state === 'ASSIGNED' ? 'dev-001' : null,
      });
      storage.addTask(task);

      const result = await manager.transitionTo({
        task_id: `TASK-${state}`,
        to_state: 'CANCELLED',
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.to_state).toBe('CANCELLED');
      }
    }
  });
});

// =============================================================================
// Tests: State History Tracking
// =============================================================================

describe('State History Tracking', () => {
  let storage: InMemoryTaskStorageForLifecycle;
  let manager: TaskLifecycleManagerImpl;

  beforeEach(() => {
    storage = new InMemoryTaskStorageForLifecycle();
    manager = new TaskLifecycleManagerImpl({
      taskStorage: storage,
      config: {
        requireDorForInProgress: false,
        requireEvidenceForReview: false,
        requireFindingsCheckForDone: false,
      },
    });
  });

  it('should record transition in state history', async () => {
    const task = createTestTask('TASK-001', 'PENDING', {
      dor_validation: {
        task_id: 'TASK-001',
        passed: true,
        last_checked_at: new Date().toISOString(),
        conditions: [],
        summary: {
          total_conditions: 0,
          passed_conditions: 0,
          failed_conditions: 0,
          failed_condition_ids: [],
          blocking_reasons: [],
        },
      },
    });
    storage.addTask(task);

    await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'READY',
      triggered_by: 'SYSTEM',
      context: 'Automatic DoR validation passed',
    });

    const history = await manager.getStateHistory('TASK-001');

    expect(history.length).toBe(1);
    expect(history[0].from_state).toBe('PENDING');
    expect(history[0].to_state).toBe('READY');
    expect(history[0].reason).toBe('dor_met');
    expect(history[0].triggered_by).toBe('SYSTEM');
    expect(history[0].context).toBe('Automatic DoR validation passed');
    expect(history[0].transitioned_at).toBeDefined();
  });

  it('should accumulate history entries', async () => {
    const task = createTestTask('TASK-001', 'READY', {
      assignee: 'dev-001',
    });
    storage.addTask(task);

    // First transition
    await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'ASSIGNED',
      triggered_by: 'lead-001',
    });

    // Second transition
    await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'IN_PROGRESS',
      triggered_by: 'dev-001',
    });

    const history = await manager.getStateHistory('TASK-001');

    expect(history.length).toBe(2);
    expect(history[0].from_state).toBe('READY');
    expect(history[0].to_state).toBe('ASSIGNED');
    expect(history[1].from_state).toBe('ASSIGNED');
    expect(history[1].to_state).toBe('IN_PROGRESS');
  });

  it('should trim history when exceeding max entries', async () => {
    const managerWithLowLimit = new TaskLifecycleManagerImpl({
      taskStorage: storage,
      config: {
        maxHistoryEntries: 3,
        requireDorForInProgress: false,
        requireEvidenceForReview: false,
        requireFindingsCheckForDone: false,
      },
    });

    // Create task with existing history
    const task = createTestTask('TASK-001', 'IN_PROGRESS', {
      state_history: [
        createStateHistoryEntry('PENDING', 'READY', 'dor_met', 'SYSTEM'),
        createStateHistoryEntry('READY', 'ASSIGNED', 'assignee_set', 'lead-001'),
        createStateHistoryEntry('ASSIGNED', 'IN_PROGRESS', 'work_started', 'dev-001'),
      ],
    });
    storage.addTask(task);

    // Add two more transitions
    await managerWithLowLimit.transitionTo({
      task_id: 'TASK-001',
      to_state: 'REVIEW',
      triggered_by: 'dev-001',
    });

    await managerWithLowLimit.transitionTo({
      task_id: 'TASK-001',
      to_state: 'CHANGES_REQUESTED',
      triggered_by: 'reviewer-001',
    });

    const history = await managerWithLowLimit.getStateHistory('TASK-001');

    expect(history.length).toBe(3);
    // Oldest entries should be trimmed
    expect(history[0].to_state).toBe('IN_PROGRESS');
    expect(history[1].to_state).toBe('REVIEW');
    expect(history[2].to_state).toBe('CHANGES_REQUESTED');
  });

  it('should record blocked_changed in history', async () => {
    const task = createTestTask('TASK-001', 'IN_PROGRESS');
    storage.addTask(task);

    await manager.setBlocked('TASK-001', true, {
      reason: 'Waiting for API',
      blocker_refs: ['BLOCKER-001'],
    }, 'dev-001');

    const history = await manager.getStateHistory('TASK-001');

    expect(history.length).toBe(1);
    expect(history[0].blocked_changed).toEqual({ from: false, to: true });
  });

  it('should record handoff_pending_changed in history', async () => {
    const task = createTestTask('TASK-001', 'IN_PROGRESS');
    storage.addTask(task);

    await manager.setHandoffPending('TASK-001', true, 'HO-001', 'dev-001');

    const history = await manager.getStateHistory('TASK-001');

    expect(history.length).toBe(1);
    expect(history[0].handoff_pending_changed).toEqual({ from: false, to: true });
  });
});

// =============================================================================
// Tests: canTransition Query
// =============================================================================

describe('canTransition Query', () => {
  let storage: InMemoryTaskStorageForLifecycle;
  let manager: TaskLifecycleManagerImpl;

  beforeEach(() => {
    storage = new InMemoryTaskStorageForLifecycle();
    manager = new TaskLifecycleManagerImpl({ taskStorage: storage });
  });

  it('should return allowed=true for valid transition with all guards passing', async () => {
    const task = createTestTask('TASK-001', 'READY', {
      assignee: 'dev-001',
    });
    storage.addTask(task);

    const result = await manager.canTransition('TASK-001', 'ASSIGNED');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.allowed).toBe(true);
      expect(result.value.blockers).toEqual([]);
    }
  });

  it('should return allowed=false with blockers for invalid transition', async () => {
    const task = createTestTask('TASK-001', 'PENDING');
    storage.addTask(task);

    const result = await manager.canTransition('TASK-001', 'DONE');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.allowed).toBe(false);
      expect(result.value.blockers.length).toBeGreaterThan(0);
    }
  });

  it('should return detailed guard results', async () => {
    const task = createTestTask('TASK-001', 'ASSIGNED', {
      assignee: 'dev-001',
    });
    storage.addTask(task);

    const dorValidator = createMockDoRValidator(false, ['AC missing']);
    const managerWithDoR = new TaskLifecycleManagerImpl({
      taskStorage: storage,
      dorValidator,
    });

    const result = await managerWithDoR.canTransition('TASK-001', 'IN_PROGRESS');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.allowed).toBe(false);
      expect(result.value.guard_results.length).toBeGreaterThan(0);

      const dorGuard = result.value.guard_results.find(g => g.guard === 'dor_valid');
      expect(dorGuard).toBeDefined();
      expect(dorGuard?.passed).toBe(false);
    }
  });
});

// =============================================================================
// Tests: getValidTransitions Query
// =============================================================================

describe('getValidTransitions Query', () => {
  let storage: InMemoryTaskStorageForLifecycle;
  let manager: TaskLifecycleManagerImpl;

  beforeEach(() => {
    storage = new InMemoryTaskStorageForLifecycle();
    manager = new TaskLifecycleManagerImpl({ taskStorage: storage });
  });

  it('should return all valid transitions from PENDING', async () => {
    const task = createTestTask('TASK-001', 'PENDING');
    storage.addTask(task);

    const result = await manager.getValidTransitions('TASK-001');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.current_state).toBe('PENDING');
      expect(result.value.valid_transitions).toContain('READY');
      expect(result.value.valid_transitions).toContain('CANCELLED');
      expect(result.value.valid_transitions).toContain('SUPERSEDED');
    }
  });

  it('should return all valid transitions from IN_PROGRESS', async () => {
    const task = createTestTask('TASK-001', 'IN_PROGRESS');
    storage.addTask(task);

    const result = await manager.getValidTransitions('TASK-001');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.valid_transitions).toContain('REVIEW');
      expect(result.value.valid_transitions).toContain('CANCELLED');
    }
  });

  it('should return empty transitions for CANCELLED state', async () => {
    const task = createTestTask('TASK-001', 'CANCELLED');
    storage.addTask(task);

    const result = await manager.getValidTransitions('TASK-001');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.valid_transitions).toEqual([]);
    }
  });

  it('should include blocked and handoff_pending status', async () => {
    const task = createTestTask('TASK-001', 'IN_PROGRESS', {
      blocked_status: createBlockedStatus('Test', ['BLOCKER-001'], 'IN_PROGRESS'),
    });
    storage.addTask(task);

    const result = await manager.getValidTransitions('TASK-001');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.is_blocked).toBe(true);
      expect(result.value.is_handoff_pending).toBe(false);
    }
  });

  it('should include guard requirements for each transition', async () => {
    const task = createTestTask('TASK-001', 'ASSIGNED');
    storage.addTask(task);

    const result = await manager.getValidTransitions('TASK-001');

    expect(result.success).toBe(true);
    if (result.success) {
      const inProgressTransition = result.value.transitions_with_reasons.find(
        t => t.to_state === 'IN_PROGRESS'
      );
      expect(inProgressTransition).toBeDefined();
      expect(inProgressTransition?.guard_requirements).toContain('dor_valid');
      expect(inProgressTransition?.guard_requirements).toContain('not_blocked');
    }
  });
});

// =============================================================================
// Tests: Terminal State Behavior
// =============================================================================

describe('Terminal State Behavior', () => {
  let storage: InMemoryTaskStorageForLifecycle;
  let manager: TaskLifecycleManagerImpl;

  beforeEach(() => {
    storage = new InMemoryTaskStorageForLifecycle();
    manager = new TaskLifecycleManagerImpl({
      taskStorage: storage,
      config: {
        requireFindingsCheckForDone: false,
      },
    });
  });

  it('should clear orthogonal attributes on transition to DONE', async () => {
    const task = createTestTask('TASK-001', 'INTEGRATED');
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'DONE',
      triggered_by: 'SYSTEM',
    });

    expect(result.success).toBe(true);

    const updatedTask = await manager.getTaskState('TASK-001');
    expect(updatedTask?.blocked_status.blocked).toBe(false);
    expect(updatedTask?.handoff_status.handoff_pending).toBe(false);
  });

  it('should clear orthogonal attributes on transition to CANCELLED', async () => {
    const task = createTestTask('TASK-001', 'IN_PROGRESS', {
      blocked_status: createBlockedStatus('Test', ['BLOCKER-001'], 'IN_PROGRESS'),
    });
    storage.addTask(task);

    const result = await manager.transitionTo({
      task_id: 'TASK-001',
      to_state: 'CANCELLED',
      triggered_by: 'lead-001',
    });

    expect(result.success).toBe(true);

    const updatedTask = await manager.getTaskState('TASK-001');
    expect(updatedTask?.blocked_status.blocked).toBe(false);
  });
});

// =============================================================================
// Tests: Helper Functions
// =============================================================================

describe('Helper Functions', () => {
  describe('getTransitionDefinition', () => {
    it('should return definition for valid transition', () => {
      const def = getTransitionDefinition('PENDING', 'READY');
      expect(def).not.toBeNull();
      expect(def?.from).toBe('PENDING');
      expect(def?.to).toBe('READY');
    });

    it('should return null for invalid transition', () => {
      const def = getTransitionDefinition('PENDING', 'DONE');
      expect(def).toBeNull();
    });
  });

  describe('getValidTransitionsFrom', () => {
    it('should return all transitions from a state', () => {
      const transitions = getValidTransitionsFrom('PENDING');
      expect(transitions.length).toBe(3);
      expect(transitions.map(t => t.to)).toContain('READY');
      expect(transitions.map(t => t.to)).toContain('CANCELLED');
      expect(transitions.map(t => t.to)).toContain('SUPERSEDED');
    });

    it('should return empty array for terminal states', () => {
      expect(getValidTransitionsFrom('CANCELLED').length).toBe(0);
      expect(getValidTransitionsFrom('SUPERSEDED').length).toBe(0);
    });

    it('should include DONE → IN_PROGRESS for reopen', () => {
      const transitions = getValidTransitionsFrom('DONE');
      expect(transitions.length).toBe(1);
      expect(transitions[0].to).toBe('IN_PROGRESS');
      expect(transitions[0].guards).toContain('reopen_justification');
    });
  });

  describe('createInitialTaskForLifecycle', () => {
    it('should create task with default PENDING state', () => {
      const task = createInitialTaskForLifecycle('TASK-001');
      expect(task.id).toBe('TASK-001');
      expect(task.status).toBe('PENDING');
      expect(task.assignee).toBeNull();
      expect(task.blocked_status.blocked).toBe(false);
      expect(task.handoff_status.handoff_pending).toBe(false);
      expect(task.state_history).toEqual([]);
    });

    it('should create task with specified initial state', () => {
      const task = createInitialTaskForLifecycle('TASK-001', 'READY');
      expect(task.status).toBe('READY');
    });
  });
});


// =============================================================================
// Tests: Findings Integration with Task Lifecycle (R11.5)
// =============================================================================

import {
  FindingRegisterFindingsChecker,
  FindingRegisterLike,
  syncBlockingFindings,
  SyncBlockingFindingsOptions,
} from '../task-lifecycle';

describe('Findings Integration - R11.5', () => {
  // Helper to create a mock FindingRegister
  function createMockFindingRegister(
    blockingFindings: Array<{ finding_id: string; severity: string }> = [],
    summary?: { open_critical: number; open_high: number }
  ): FindingRegisterLike {
    return {
      getBlockingFindings: async (_taskId: string) => ({
        success: true as const,
        value: blockingFindings,
      }),
      getFindingsSummary: summary 
        ? async (_taskId: string) => ({
            success: true as const,
            value: summary,
          })
        : undefined,
    };
  }

  describe('FindingRegisterFindingsChecker', () => {
    describe('hasBlockingFindings', () => {
      it('should return false when no blocking findings exist', async () => {
        const mockRegister = createMockFindingRegister([]);
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.hasBlockingFindings('TASK-001');

        expect(result).toBe(false);
      });

      it('should return true when blocking findings exist', async () => {
        const mockRegister = createMockFindingRegister([
          { finding_id: 'FND-001', severity: 'CRITICAL' },
          { finding_id: 'FND-002', severity: 'HIGH' },
        ]);
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.hasBlockingFindings('TASK-001');

        expect(result).toBe(true);
      });

      it('should return false on error to avoid blocking on error', async () => {
        const mockRegister: FindingRegisterLike = {
          getBlockingFindings: async () => ({
            success: false as const,
            error: { message: 'Database error' },
          }),
        };
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.hasBlockingFindings('TASK-001');

        expect(result).toBe(false);
      });
    });

    describe('getBlockingFindingIds', () => {
      it('should return empty array when no blocking findings', async () => {
        const mockRegister = createMockFindingRegister([]);
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.getBlockingFindingIds('TASK-001');

        expect(result).toEqual([]);
      });

      it('should return finding IDs when blocking findings exist', async () => {
        const mockRegister = createMockFindingRegister([
          { finding_id: 'FND-001', severity: 'CRITICAL' },
          { finding_id: 'FND-002', severity: 'HIGH' },
        ]);
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.getBlockingFindingIds('TASK-001');

        expect(result).toEqual(['FND-001', 'FND-002']);
      });

      it('should return empty array on error', async () => {
        const mockRegister: FindingRegisterLike = {
          getBlockingFindings: async () => ({
            success: false as const,
            error: { message: 'Error' },
          }),
        };
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.getBlockingFindingIds('TASK-001');

        expect(result).toEqual([]);
      });
    });

    describe('getBlockingFindingCounts', () => {
      it('should return counts using summary if available', async () => {
        const mockRegister = createMockFindingRegister(
          [], // Not used when summary is available
          { open_critical: 3, open_high: 5 }
        );
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.getBlockingFindingCounts('TASK-001');

        expect(result).toEqual({ critical: 3, high: 5 });
      });

      it('should fallback to counting from blocking findings', async () => {
        const mockRegister = createMockFindingRegister([
          { finding_id: 'FND-001', severity: 'CRITICAL' },
          { finding_id: 'FND-002', severity: 'CRITICAL' },
          { finding_id: 'FND-003', severity: 'HIGH' },
        ]);
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.getBlockingFindingCounts('TASK-001');

        expect(result).toEqual({ critical: 2, high: 1 });
      });

      it('should return zeros on error', async () => {
        const mockRegister: FindingRegisterLike = {
          getBlockingFindings: async () => ({
            success: false as const,
            error: { message: 'Error' },
          }),
        };
        const checker = new FindingRegisterFindingsChecker(mockRegister);

        const result = await checker.getBlockingFindingCounts('TASK-001');

        expect(result).toEqual({ critical: 0, high: 0 });
      });
    });
  });

  describe('syncBlockingFindings', () => {
    let storage: InMemoryTaskStorageForLifecycle;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForLifecycle();
    });

    it('should sync blocking findings to task', async () => {
      const task = createTestTask('TASK-001', 'REVIEW', {
        has_blocking_findings: false,
        blocking_finding_ids: [],
      });
      storage.addTask(task);

      const mockRegister = createMockFindingRegister([
        { finding_id: 'FND-001', severity: 'CRITICAL' },
        { finding_id: 'FND-002', severity: 'HIGH' },
      ]);
      const checker = new FindingRegisterFindingsChecker(mockRegister);

      const result = await syncBlockingFindings({
        taskId: 'TASK-001',
        taskStorage: storage,
        findingsChecker: checker,
      });

      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.currentBlockingIds).toEqual(['FND-001', 'FND-002']);
      expect(result.task?.has_blocking_findings).toBe(true);
      expect(result.task?.blocking_finding_ids).toEqual(['FND-001', 'FND-002']);
    });

    it('should not update if nothing changed', async () => {
      const task = createTestTask('TASK-001', 'REVIEW', {
        has_blocking_findings: true,
        blocking_finding_ids: ['FND-001'],
      });
      storage.addTask(task);

      const mockRegister = createMockFindingRegister([
        { finding_id: 'FND-001', severity: 'CRITICAL' },
      ]);
      const checker = new FindingRegisterFindingsChecker(mockRegister);

      const result = await syncBlockingFindings({
        taskId: 'TASK-001',
        taskStorage: storage,
        findingsChecker: checker,
      });

      expect(result.success).toBe(true);
      expect(result.changed).toBe(false);
      expect(result.previousBlockingIds).toEqual(['FND-001']);
      expect(result.currentBlockingIds).toEqual(['FND-001']);
    });

    it('should clear blocking findings when all resolved', async () => {
      const task = createTestTask('TASK-001', 'REVIEW', {
        has_blocking_findings: true,
        blocking_finding_ids: ['FND-001', 'FND-002'],
      });
      storage.addTask(task);

      const mockRegister = createMockFindingRegister([]); // All findings resolved
      const checker = new FindingRegisterFindingsChecker(mockRegister);

      const result = await syncBlockingFindings({
        taskId: 'TASK-001',
        taskStorage: storage,
        findingsChecker: checker,
      });

      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.previousBlockingIds).toEqual(['FND-001', 'FND-002']);
      expect(result.currentBlockingIds).toEqual([]);
      expect(result.task?.has_blocking_findings).toBe(false);
      expect(result.task?.blocking_finding_ids).toEqual([]);
    });

    it('should return error when task not found', async () => {
      const mockRegister = createMockFindingRegister([]);
      const checker = new FindingRegisterFindingsChecker(mockRegister);

      const result = await syncBlockingFindings({
        taskId: 'TASK-999',
        taskStorage: storage,
        findingsChecker: checker,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Task Lifecycle Integration with Findings', () => {
    let storage: InMemoryTaskStorageForLifecycle;

    beforeEach(() => {
      storage = new InMemoryTaskStorageForLifecycle();
    });

    describe('REVIEW → READY_TO_MERGE transition', () => {
      it('should block transition when blocking findings exist', async () => {
        const task = createTestTask('TASK-001', 'REVIEW');
        storage.addTask(task);

        const mockRegister = createMockFindingRegister([
          { finding_id: 'FND-001', severity: 'CRITICAL' },
        ]);
        const findingsChecker = new FindingRegisterFindingsChecker(mockRegister);

        const manager = new TaskLifecycleManagerImpl({
          taskStorage: storage,
          findingsChecker,
        });

        const result = await manager.transitionTo({
          task_id: 'TASK-001',
          to_state: 'READY_TO_MERGE',
          triggered_by: 'reviewer-001',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
          expect(result.error.context?.failed_guards).toContain('no_blocking_findings');
        }
      });

      it('should allow transition when no blocking findings', async () => {
        const task = createTestTask('TASK-001', 'REVIEW');
        storage.addTask(task);

        const mockRegister = createMockFindingRegister([]);
        const findingsChecker = new FindingRegisterFindingsChecker(mockRegister);

        const manager = new TaskLifecycleManagerImpl({
          taskStorage: storage,
          findingsChecker,
        });

        const result = await manager.transitionTo({
          task_id: 'TASK-001',
          to_state: 'READY_TO_MERGE',
          triggered_by: 'reviewer-001',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.to_state).toBe('READY_TO_MERGE');
        }
      });
    });

    describe('INTEGRATED → DONE transition', () => {
      it('should block transition when blocking findings exist', async () => {
        const task = createTestTask('TASK-001', 'INTEGRATED');
        storage.addTask(task);

        const mockRegister = createMockFindingRegister([
          { finding_id: 'FND-001', severity: 'HIGH' },
        ]);
        const findingsChecker = new FindingRegisterFindingsChecker(mockRegister);

        const manager = new TaskLifecycleManagerImpl({
          taskStorage: storage,
          findingsChecker,
        });

        const result = await manager.transitionTo({
          task_id: 'TASK-001',
          to_state: 'DONE',
          triggered_by: 'lead-001',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
          expect(result.error.context?.failed_guards).toContain('no_blocking_findings');
        }
      });

      it('should allow transition when all findings resolved', async () => {
        const task = createTestTask('TASK-001', 'INTEGRATED');
        storage.addTask(task);

        const mockRegister = createMockFindingRegister([]);
        const findingsChecker = new FindingRegisterFindingsChecker(mockRegister);

        const manager = new TaskLifecycleManagerImpl({
          taskStorage: storage,
          findingsChecker,
        });

        const result = await manager.transitionTo({
          task_id: 'TASK-001',
          to_state: 'DONE',
          triggered_by: 'lead-001',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.to_state).toBe('DONE');
        }
      });
    });

    describe('Detailed error messages', () => {
      it('should provide finding IDs in error when available', async () => {
        const task = createTestTask('TASK-001', 'REVIEW');
        storage.addTask(task);

        const mockRegister = createMockFindingRegister([
          { finding_id: 'FND-001', severity: 'CRITICAL' },
          { finding_id: 'FND-002', severity: 'HIGH' },
        ]);
        const findingsChecker = new FindingRegisterFindingsChecker(mockRegister);

        const manager = new TaskLifecycleManagerImpl({
          taskStorage: storage,
          findingsChecker,
        });

        const canResult = await manager.canTransition('TASK-001', 'READY_TO_MERGE');

        expect(canResult.success).toBe(true);
        if (canResult.success) {
          expect(canResult.value.allowed).toBe(false);
          const findingsGuard = canResult.value.guard_results.find(g => g.guard === 'no_blocking_findings');
          expect(findingsGuard?.passed).toBe(false);
          expect(findingsGuard?.reason).toContain('FND-001');
          expect(findingsGuard?.reason).toContain('FND-002');
        }
      });

      it('should provide severity counts in error when available', async () => {
        const task = createTestTask('TASK-001', 'INTEGRATED');
        storage.addTask(task);

        const mockRegister = createMockFindingRegister(
          [
            { finding_id: 'FND-001', severity: 'CRITICAL' },
            { finding_id: 'FND-002', severity: 'CRITICAL' },
            { finding_id: 'FND-003', severity: 'HIGH' },
          ],
          { open_critical: 2, open_high: 1 }
        );
        const findingsChecker = new FindingRegisterFindingsChecker(mockRegister);

        const manager = new TaskLifecycleManagerImpl({
          taskStorage: storage,
          findingsChecker,
        });

        const canResult = await manager.canTransition('TASK-001', 'DONE');

        expect(canResult.success).toBe(true);
        if (canResult.success) {
          const findingsGuard = canResult.value.guard_results.find(g => g.guard === 'no_blocking_findings');
          expect(findingsGuard?.passed).toBe(false);
          expect(findingsGuard?.reason).toContain('2 CRITICAL');
          expect(findingsGuard?.reason).toContain('1 HIGH');
        }
      });
    });

    describe('Fallback to cached findings data', () => {
      it('should use task.has_blocking_findings when no checker provided', async () => {
        const task = createTestTask('TASK-001', 'REVIEW', {
          has_blocking_findings: true,
          blocking_finding_ids: ['FND-001'],
        });
        storage.addTask(task);

        const manager = new TaskLifecycleManagerImpl({
          taskStorage: storage,
          // No findings checker provided
        });

        const result = await manager.transitionTo({
          task_id: 'TASK-001',
          to_state: 'READY_TO_MERGE',
          triggered_by: 'reviewer-001',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(LifecycleErrorCode.GUARD_FAILED);
          expect(result.error.context?.failed_guards).toContain('no_blocking_findings');
        }
      });

      it('should include blocking_finding_ids in error message when using cache', async () => {
        const task = createTestTask('TASK-001', 'REVIEW', {
          has_blocking_findings: true,
          blocking_finding_ids: ['FND-001', 'FND-002'],
        });
        storage.addTask(task);

        const manager = new TaskLifecycleManagerImpl({
          taskStorage: storage,
        });

        const canResult = await manager.canTransition('TASK-001', 'READY_TO_MERGE');

        expect(canResult.success).toBe(true);
        if (canResult.success) {
          const findingsGuard = canResult.value.guard_results.find(g => g.guard === 'no_blocking_findings');
          expect(findingsGuard?.passed).toBe(false);
          expect(findingsGuard?.reason).toContain('FND-001');
          expect(findingsGuard?.reason).toContain('FND-002');
        }
      });
    });
  });

  describe('TaskForLifecycle blocking_finding_ids field', () => {
    it('should include blocking_finding_ids in initial task', () => {
      const task = createInitialTaskForLifecycle('TASK-001');
      
      expect(task.blocking_finding_ids).toEqual([]);
      expect(task.has_blocking_findings).toBe(false);
    });

    it('should preserve blocking_finding_ids when creating test task', () => {
      const task = createTestTask('TASK-001', 'REVIEW', {
        blocking_finding_ids: ['FND-001', 'FND-002'],
        has_blocking_findings: true,
      });

      expect(task.blocking_finding_ids).toEqual(['FND-001', 'FND-002']);
      expect(task.has_blocking_findings).toBe(true);
    });
  });
});


// =============================================================================
// Tests: Task Reopen with Justification (R04.7)
// =============================================================================

describe('Task Reopen with Justification - R04.7', () => {
  let storage: InMemoryTaskStorageForLifecycle;
  let manager: TaskLifecycleManagerImpl;

  beforeEach(() => {
    storage = new InMemoryTaskStorageForLifecycle();
    manager = new TaskLifecycleManagerImpl({ taskStorage: storage });
  });

  describe('reopenTask method', () => {
    it('should reopen a DONE task with valid justification', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Bug found in production',
          evidence_ref: 'ISSUE-123',
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.from_state).toBe('DONE');
        expect(result.value.to_state).toBe('IN_PROGRESS');
        expect(result.value.justification.reason).toBe('Bug found in production');
        expect(result.value.justification.evidence_ref).toBe('ISSUE-123');
        expect(result.value.history_entry.reason).toBe('reopened');
      }
    });

    it('should support configurable target state', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Needs reassignment',
          evidence_ref: 'ISSUE-456',
          target_state: 'ASSIGNED',
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.to_state).toBe('ASSIGNED');
      }
    });

    it('should support READY as target state', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Scope changed',
          evidence_ref: 'REQ-CHANGE-001',
          target_state: 'READY',
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.to_state).toBe('READY');
      }
    });

    it('should reject reopening non-DONE task', async () => {
      const task = createTestTask('TASK-001', 'IN_PROGRESS');
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Test',
          evidence_ref: 'ISSUE-001',
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.INVALID_STATE_TRANSITION);
        expect(result.error.message).toContain('not in DONE state');
      }
    });

    it('should reject reopen without reason', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: '',
          evidence_ref: 'ISSUE-123',
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.REOPEN_JUSTIFICATION_REQUIRED);
        expect(result.error.message).toContain('Reason is required');
      }
    });

    it('should reject reopen without evidence reference', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Bug found',
          evidence_ref: '',
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.REOPEN_JUSTIFICATION_REQUIRED);
        expect(result.error.message).toContain('Evidence reference is required');
      }
    });

    it('should reject invalid target state for reopen', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Bug found',
          evidence_ref: 'ISSUE-123',
          target_state: 'REVIEW' as TaskState, // Invalid target
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.INVALID_STATE_TRANSITION);
        expect(result.error.message).toContain('Invalid reopen target state');
      }
    });

    it('should clear blocking findings flag when reopening', async () => {
      const task = createTestTask('TASK-001', 'DONE', {
        has_blocking_findings: true,
      });
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Findings addressed separately',
          evidence_ref: 'ISSUE-123',
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.blocking_findings_cleared).toBe(true);
        
        const updatedTask = await manager.getTaskState('TASK-001');
        expect(updatedTask?.has_blocking_findings).toBe(false);
      }
    });

    it('should record full justification in state history', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Critical bug in authentication',
          evidence_ref: 'ISSUE-789',
        },
        triggered_by: 'security-lead',
      });

      const history = await manager.getStateHistory('TASK-001');
      
      expect(history.length).toBe(1);
      expect(history[0].from_state).toBe('DONE');
      expect(history[0].to_state).toBe('IN_PROGRESS');
      expect(history[0].reason).toBe('reopened');
      expect(history[0].triggered_by).toBe('security-lead');
      expect(history[0].context).toContain('Critical bug in authentication');
      expect(history[0].context).toContain('ISSUE-789');
    });

    it('should return TASK_NOT_FOUND for non-existent task', async () => {
      const result = await manager.reopenTask({
        task_id: 'TASK-999',
        justification: {
          reason: 'Test',
          evidence_ref: 'ISSUE-001',
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LifecycleErrorCode.TASK_NOT_FOUND);
      }
    });

    it('should clear orthogonal attributes when reopening', async () => {
      // DONE tasks shouldn't have orthogonal attributes, but let's verify they're cleared
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Bug found',
          evidence_ref: 'ISSUE-123',
        },
        triggered_by: 'lead-001',
      });

      const updatedTask = await manager.getTaskState('TASK-001');
      expect(updatedTask?.blocked_status.blocked).toBe(false);
      expect(updatedTask?.handoff_status.handoff_pending).toBe(false);
    });

    it('should default to IN_PROGRESS when target_state not specified', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.reopenTask({
        task_id: 'TASK-001',
        justification: {
          reason: 'Bug found',
          evidence_ref: 'ISSUE-123',
          // target_state not specified
        },
        triggered_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.to_state).toBe('IN_PROGRESS');
      }
    });
  });

  describe('VALID_REOPEN_TARGET_STATES constant', () => {
    it('should include IN_PROGRESS, ASSIGNED, and READY', async () => {
      // Import the constant for testing
      const { VALID_REOPEN_TARGET_STATES } = await import('../task-lifecycle');
      
      expect(VALID_REOPEN_TARGET_STATES).toContain('IN_PROGRESS');
      expect(VALID_REOPEN_TARGET_STATES).toContain('ASSIGNED');
      expect(VALID_REOPEN_TARGET_STATES).toContain('READY');
    });

    it('should not include terminal or advanced states', async () => {
      const { VALID_REOPEN_TARGET_STATES } = await import('../task-lifecycle');
      
      expect(VALID_REOPEN_TARGET_STATES).not.toContain('DONE');
      expect(VALID_REOPEN_TARGET_STATES).not.toContain('CANCELLED');
      expect(VALID_REOPEN_TARGET_STATES).not.toContain('REVIEW');
      expect(VALID_REOPEN_TARGET_STATES).not.toContain('INTEGRATED');
    });
  });

  describe('Helper functions', () => {
    it('isValidReopenTargetState should return true for valid states', async () => {
      const { isValidReopenTargetState } = await import('../task-lifecycle');
      
      expect(isValidReopenTargetState('IN_PROGRESS')).toBe(true);
      expect(isValidReopenTargetState('ASSIGNED')).toBe(true);
      expect(isValidReopenTargetState('READY')).toBe(true);
    });

    it('isValidReopenTargetState should return false for invalid states', async () => {
      const { isValidReopenTargetState } = await import('../task-lifecycle');
      
      expect(isValidReopenTargetState('DONE')).toBe(false);
      expect(isValidReopenTargetState('REVIEW')).toBe(false);
      expect(isValidReopenTargetState('CANCELLED')).toBe(false);
    });

    it('createReopenJustification should create valid justification object', async () => {
      const { createReopenJustification } = await import('../task-lifecycle');
      
      const justification = createReopenJustification(
        'Bug found',
        'ISSUE-123',
        'ASSIGNED'
      );
      
      expect(justification.reason).toBe('Bug found');
      expect(justification.evidence_ref).toBe('ISSUE-123');
      expect(justification.target_state).toBe('ASSIGNED');
    });

    it('createReopenJustification should work without target_state', async () => {
      const { createReopenJustification } = await import('../task-lifecycle');
      
      const justification = createReopenJustification('Bug found', 'ISSUE-123');
      
      expect(justification.reason).toBe('Bug found');
      expect(justification.evidence_ref).toBe('ISSUE-123');
      expect(justification.target_state).toBeUndefined();
    });
  });

  describe('Integration with transitionTo (existing reopen via transition)', () => {
    it('should still allow reopen via transitionTo with justification', async () => {
      const task = createTestTask('TASK-001', 'DONE');
      storage.addTask(task);

      const result = await manager.transitionTo({
        task_id: 'TASK-001',
        to_state: 'IN_PROGRESS',
        triggered_by: 'lead-001',
        reason: 'reopened',
        reopen_justification: {
          reason: 'Bug found in production',
          evidence_ref: 'ISSUE-123',
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.to_state).toBe('IN_PROGRESS');
        expect(result.value.history_entry.reason).toBe('reopened');
      }
    });
  });
});
