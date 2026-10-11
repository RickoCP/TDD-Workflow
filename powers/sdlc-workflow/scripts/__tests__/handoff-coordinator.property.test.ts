/**
 * Property-Based Tests for Handoff_Coordinator
 * 
 * **Feature: multi-developer-support, Property 8: Handoff Checklist Completion Gate**
 * 
 * These tests verify the universal correctness properties of the Handoff_Coordinator component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements 11.2, 11.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  HandoffPoint,
  HandoffPointDefinition,
  HandoffRecord,
  HandoffRequest,
  HandoffContext,
  HandoffError,
  HandoffErrorCode,
  HandoffExtendedErrorCode,
  HandoffStatus,
  HandoffState,
  HandoffReason,
  ChecklistItem,
  Handoff_Coordinator,
  HANDOFF_STATUSES,
  HANDOFF_STATES,
  HANDOFF_REASONS,
  createHandoffPoint,
  createHandoffRecord,
  createChecklistItem,
  createHandoffHistoryEntry,
  generateHandoffId,
  generateHandoffPointId,
  areRequiredChecklistItemsComplete,
  getIncompleteRequiredItems,
  validateHandoffPointDefinition,
  checklistIncompleteError,
  handoffNotFoundError,
  handoffAlreadyCompletedError,
  stateToStatus,
  isValidStateTransition,
} from '../handoff-coordinator';
import { Result, ok, err, Role, VALID_ROLES, isValidRole } from '../team-manager';

// =============================================================================
// In-Memory Handoff_Coordinator Implementation for Testing
// =============================================================================

/**
 * In-memory storage for handoff points.
 */
class InMemoryHandoffPointStorage {
  private points: Map<string, HandoffPoint> = new Map();

  savePoint(point: HandoffPoint): void {
    this.points.set(point.id, { ...point });
  }

  getPoint(pointId: string): HandoffPoint | null {
    const point = this.points.get(pointId);
    return point ? { ...point } : null;
  }

  getAllPoints(): HandoffPoint[] {
    return Array.from(this.points.values()).map(p => ({ ...p }));
  }

  deletePoint(pointId: string): boolean {
    return this.points.delete(pointId);
  }

  clear(): void {
    this.points.clear();
  }
}

/**
 * In-memory storage for handoff records.
 */
class InMemoryHandoffRecordStorage {
  private records: Map<string, HandoffRecord> = new Map();

  saveRecord(record: HandoffRecord): void {
    this.records.set(record.id, { ...record });
  }

  getRecord(recordId: string): HandoffRecord | null {
    const record = this.records.get(recordId);
    return record ? { ...record } : null;
  }

  getAllRecords(): HandoffRecord[] {
    return Array.from(this.records.values()).map(r => ({ ...r }));
  }

  deleteRecord(recordId: string): boolean {
    return this.records.delete(recordId);
  }

  clear(): void {
    this.records.clear();
  }
}

/**
 * Developer info for role validation.
 */
interface DeveloperInfo {
  id: string;
  roles: Role[];
}

/**
 * In-memory storage for developers.
 */
class InMemoryDeveloperStorage {
  private developers: Map<string, DeveloperInfo> = new Map();

  addDeveloper(dev: DeveloperInfo): void {
    this.developers.set(dev.id, { ...dev });
  }

  getDeveloper(devId: string): DeveloperInfo | null {
    const dev = this.developers.get(devId);
    return dev ? { ...dev } : null;
  }

  hasRole(devId: string, role: Role): boolean {
    const dev = this.developers.get(devId);
    return dev ? dev.roles.includes(role) : false;
  }

  clear(): void {
    this.developers.clear();
  }
}

/**
 * Configuration for the in-memory Handoff_Coordinator.
 */
interface InMemoryHandoffCoordinatorConfig {
  pointStorage: InMemoryHandoffPointStorage;
  recordStorage: InMemoryHandoffRecordStorage;
  developerStorage: InMemoryDeveloperStorage;
}

/**
 * In-memory implementation of Handoff_Coordinator for testing purposes.
 * This implementation follows the interface defined in handoff-coordinator.ts
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4
 */
class InMemoryHandoffCoordinator implements Handoff_Coordinator {
  private pointStorage: InMemoryHandoffPointStorage;
  private recordStorage: InMemoryHandoffRecordStorage;
  private developerStorage: InMemoryDeveloperStorage;

  constructor(config: InMemoryHandoffCoordinatorConfig) {
    this.pointStorage = config.pointStorage;
    this.recordStorage = config.recordStorage;
    this.developerStorage = config.developerStorage;
  }

  /**
   * Defines a new handoff point.
   * Requirements: 11.1, 11.2
   */
  defineHandoffPoint(definition: HandoffPointDefinition): Result<void, HandoffError> {
    // Validate the definition
    const validationResult = validateHandoffPointDefinition(definition);
    if (!validationResult.success) {
      return validationResult;
    }

    // Check for duplicate ID
    if (this.pointStorage.getPoint(definition.id)) {
      return err({
        code: HandoffExtendedErrorCode.INVALID_HANDOFF_POINT_DATA,
        category: 'HANDOFF_ERROR',
        message: `Handoff point with id '${definition.id}' already exists`,
        context: { handoff_point_id: definition.id },
        suggested_action: 'Use a different ID or update the existing handoff point',
        timestamp: new Date().toISOString(),
      });
    }

    // Create and save the handoff point
    const handoffPoint = createHandoffPoint(definition);
    this.pointStorage.savePoint(handoffPoint);

    return ok(undefined);
  }

  /**
   * Updates the checklist for an existing handoff point.
   */
  updateHandoffChecklist(
    handoffPointId: string,
    checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[]
  ): Result<void, HandoffError> {
    const point = this.pointStorage.getPoint(handoffPointId);
    if (!point) {
      return err({
        code: HandoffExtendedErrorCode.HANDOFF_POINT_NOT_FOUND,
        category: 'HANDOFF_ERROR',
        message: `Handoff point with id '${handoffPointId}' not found`,
        context: { handoff_point_id: handoffPointId },
        suggested_action: 'Verify the handoff point ID or create it first',
        timestamp: new Date().toISOString(),
      });
    }

    // Requirement 11.2: Must have at least one checklist item
    if (!checklist || checklist.length === 0) {
      return err({
        code: HandoffExtendedErrorCode.EMPTY_CHECKLIST,
        category: 'HANDOFF_ERROR',
        message: `Handoff point '${handoffPointId}' must have at least one checklist item`,
        context: { handoff_point_id: handoffPointId },
        suggested_action: 'Add at least one checklist item to the handoff point definition',
        timestamp: new Date().toISOString(),
      });
    }

    // Update the checklist
    const updatedPoint: HandoffPoint = {
      ...point,
      checklist: checklist.map(item => ({
        id: item.id,
        description: item.description,
        required: item.required,
        completed: false,
      })),
    };

    this.pointStorage.savePoint(updatedPoint);
    return ok(undefined);
  }

  /**
   * Gets a handoff point by ID.
   */
  getHandoffPoint(handoffPointId: string): HandoffPoint | null {
    return this.pointStorage.getPoint(handoffPointId);
  }

  /**
   * Lists all handoff points.
   */
  listHandoffPoints(filter?: { source_role?: Role; target_role?: Role }): HandoffPoint[] {
    let points = this.pointStorage.getAllPoints();
    
    if (filter?.source_role) {
      points = points.filter(p => p.source_role === filter.source_role);
    }
    if (filter?.target_role) {
      points = points.filter(p => p.target_role === filter.target_role);
    }
    
    return points;
  }

  /**
   * Requests a handoff from source to target.
   * Requirements: 11.3, 12.1
   */
  requestHandoff(request: HandoffRequest): Result<HandoffRecord, HandoffError> {
    // Validate handoff point exists
    const handoffPoint = this.pointStorage.getPoint(request.handoff_point_id);
    if (!handoffPoint) {
      return err({
        code: HandoffExtendedErrorCode.HANDOFF_POINT_NOT_FOUND,
        category: 'HANDOFF_ERROR',
        message: `Handoff point with id '${request.handoff_point_id}' not found`,
        context: { handoff_point_id: request.handoff_point_id },
        suggested_action: 'Create the handoff point first',
        timestamp: new Date().toISOString(),
      });
    }

    // Check for duplicate handoff
    const existingHandoffs = this.recordStorage.getAllRecords().filter(
      r => r.source_task_id === request.source_task_id && 
           r.status !== 'COMPLETED' && 
           r.status !== 'REJECTED'
    );
    if (existingHandoffs.length > 0) {
      return err({
        code: HandoffErrorCode.DUPLICATE_HANDOFF_REQUEST,
        category: 'HANDOFF_ERROR',
        message: `A handoff request already exists for task '${request.source_task_id}'`,
        context: { task_id: request.source_task_id, handoff_id: existingHandoffs[0].id },
        suggested_action: 'Complete or cancel the existing handoff before creating a new one',
        timestamp: new Date().toISOString(),
      });
    }

    // Create handoff record
    const handoffId = generateHandoffId();
    const record = createHandoffRecord(handoffId, request, handoffPoint);
    
    this.recordStorage.saveRecord(record);
    return ok(record);
  }

  /**
   * Accepts a pending handoff.
   * Requirements: 12.3
   */
  acceptHandoff(handoffId: string, developerId: string): Result<void, HandoffError> {
    const record = this.recordStorage.getRecord(handoffId);
    if (!record) {
      return err(handoffNotFoundError(handoffId));
    }

    // Check status
    if (record.status === 'COMPLETED') {
      return err(handoffAlreadyCompletedError(handoffId));
    }

    if (record.status !== 'PENDING') {
      return err({
        code: HandoffErrorCode.INVALID_HANDOFF_STATUS,
        category: 'HANDOFF_ERROR',
        message: `Cannot accept handoff '${handoffId}' in '${record.status}' status`,
        context: { handoff_id: handoffId, current_status: record.status },
        suggested_action: 'Handoff must be in PENDING status to accept',
        timestamp: new Date().toISOString(),
      });
    }

    // Requirement 11.4: Check checklist is complete before acceptance
    if (!areRequiredChecklistItemsComplete(record.checklist_status)) {
      const incompleteItems = getIncompleteRequiredItems(record.checklist_status);
      return err(checklistIncompleteError(handoffId, incompleteItems.map(i => i.id)));
    }

    // Validate developer has the target role
    const hasRole = this.developerStorage.hasRole(developerId, record.target_role);
    if (!hasRole) {
      return err({
        code: HandoffExtendedErrorCode.TARGET_ROLE_INVALID,
        category: 'HANDOFF_ERROR',
        message: `Developer '${developerId}' does not have required role '${record.target_role}'`,
        context: { developer_id: developerId, target_role: record.target_role },
        suggested_action: `Select a developer with '${record.target_role}' role`,
        timestamp: new Date().toISOString(),
      });
    }

    // Update record
    const now = new Date().toISOString();
    const updatedRecord: HandoffRecord = {
      ...record,
      status: 'ACCEPTED',
      state: 'ACCEPTED',
      target_developer_id: developerId,
      accepted_at: now,
      history: [
        ...record.history,
        createHandoffHistoryEntry(record.state, 'ACCEPTED', developerId, 'Handoff accepted'),
      ],
    };

    this.recordStorage.saveRecord(updatedRecord);
    return ok(undefined);
  }

  /**
   * Rejects a pending handoff.
   * Requirements: 12.4
   */
  rejectHandoff(handoffId: string, reason: string): Result<void, HandoffError> {
    const record = this.recordStorage.getRecord(handoffId);
    if (!record) {
      return err(handoffNotFoundError(handoffId));
    }

    if (record.status === 'COMPLETED') {
      return err(handoffAlreadyCompletedError(handoffId));
    }

    if (record.status !== 'PENDING') {
      return err({
        code: HandoffErrorCode.INVALID_HANDOFF_STATUS,
        category: 'HANDOFF_ERROR',
        message: `Cannot reject handoff '${handoffId}' in '${record.status}' status`,
        context: { handoff_id: handoffId, current_status: record.status },
        suggested_action: 'Handoff must be in PENDING status to reject',
        timestamp: new Date().toISOString(),
      });
    }

    // Update record
    const now = new Date().toISOString();
    const updatedRecord: HandoffRecord = {
      ...record,
      status: 'REJECTED',
      state: 'REJECTED',
      rejected_at: now,
      rejection_reason: reason,
      history: [
        ...record.history,
        createHandoffHistoryEntry(record.state, 'REJECTED', null, `Rejected: ${reason}`),
      ],
    };

    this.recordStorage.saveRecord(updatedRecord);
    return ok(undefined);
  }

  /**
   * Completes an accepted handoff.
   * Requirements: 11.4
   * 
   * This method enforces Property 8: Handoff Checklist Completion Gate
   * A handoff cannot complete until ALL required checklist items are marked complete.
   */
  completeHandoff(handoffId: string): Result<void, HandoffError> {
    const record = this.recordStorage.getRecord(handoffId);
    if (!record) {
      return err(handoffNotFoundError(handoffId));
    }

    if (record.status === 'COMPLETED') {
      return err(handoffAlreadyCompletedError(handoffId));
    }

    if (record.status !== 'ACCEPTED') {
      return err({
        code: HandoffErrorCode.INVALID_HANDOFF_STATUS,
        category: 'HANDOFF_ERROR',
        message: `Cannot complete handoff '${handoffId}' in '${record.status}' status`,
        context: { handoff_id: handoffId, current_status: record.status },
        suggested_action: 'Handoff must be in ACCEPTED status to complete',
        timestamp: new Date().toISOString(),
      });
    }

    // Requirement 11.4 / Property 8: Check ALL required checklist items are complete
    if (!areRequiredChecklistItemsComplete(record.checklist_status)) {
      const incompleteItems = getIncompleteRequiredItems(record.checklist_status);
      return err(checklistIncompleteError(handoffId, incompleteItems.map(i => i.id)));
    }

    // Update record
    const now = new Date().toISOString();
    const updatedRecord: HandoffRecord = {
      ...record,
      status: 'COMPLETED',
      state: 'COMPLETE',
      completed_at: now,
      history: [
        ...record.history,
        createHandoffHistoryEntry(record.state, 'COMPLETE', record.target_developer_id, 'Handoff completed'),
      ],
    };

    this.recordStorage.saveRecord(updatedRecord);
    return ok(undefined);
  }

  /**
   * Completes a checklist item for a handoff.
   * Requirements: 11.4
   */
  completeChecklistItem(
    handoffId: string,
    itemId: string,
    developerId: string
  ): Result<void, HandoffError> {
    const record = this.recordStorage.getRecord(handoffId);
    if (!record) {
      return err(handoffNotFoundError(handoffId));
    }

    if (record.status === 'COMPLETED') {
      return err(handoffAlreadyCompletedError(handoffId));
    }

    // Find the checklist item
    const itemIndex = record.checklist_status.findIndex(i => i.id === itemId);
    if (itemIndex === -1) {
      return err({
        code: HandoffExtendedErrorCode.CHECKLIST_ITEM_NOT_FOUND,
        category: 'HANDOFF_ERROR',
        message: `Checklist item '${itemId}' not found in handoff '${handoffId}'`,
        context: { handoff_id: handoffId },
        suggested_action: 'Verify the checklist item ID',
        timestamp: new Date().toISOString(),
      });
    }

    // Update the checklist item
    const now = new Date().toISOString();
    const updatedChecklist = [...record.checklist_status];
    updatedChecklist[itemIndex] = {
      ...updatedChecklist[itemIndex],
      completed: true,
      completed_at: now,
      completed_by: developerId,
    };

    // Check if we should transition to PENDING_ACCEPTANCE
    let newState = record.state;
    let newStatus = record.status;
    if (areRequiredChecklistItemsComplete(updatedChecklist) && record.state === 'CHECKLIST_IN_PROGRESS') {
      newState = 'PENDING_ACCEPTANCE';
    }

    const updatedRecord: HandoffRecord = {
      ...record,
      checklist_status: updatedChecklist,
      state: newState,
      status: stateToStatus(newState),
    };

    this.recordStorage.saveRecord(updatedRecord);
    return ok(undefined);
  }

  /**
   * Gets a handoff record by ID.
   */
  getHandoff(handoffId: string): Result<HandoffRecord, HandoffError> {
    const record = this.recordStorage.getRecord(handoffId);
    if (!record) {
      return err(handoffNotFoundError(handoffId));
    }
    return ok(record);
  }

  /**
   * Gets all handoffs for a specific task.
   */
  getHandoffsByTask(taskId: string): HandoffRecord[] {
    return this.recordStorage.getAllRecords().filter(
      r => r.source_task_id === taskId || r.target_task_id === taskId
    );
  }

  /**
   * Gets all handoffs involving a specific developer.
   */
  getHandoffsByDeveloper(developerId: string): HandoffRecord[] {
    return this.recordStorage.getAllRecords().filter(
      r => r.source_developer_id === developerId || r.target_developer_id === developerId
    );
  }

  /**
   * Gets all pending handoffs.
   */
  getPendingHandoffs(): HandoffRecord[] {
    return this.recordStorage.getAllRecords().filter(r => r.status === 'PENDING');
  }

  /**
   * Gets all active handoffs (not completed).
   */
  getActiveHandoffs(): HandoffRecord[] {
    return this.recordStorage.getAllRecords().filter(r => r.status !== 'COMPLETED');
  }

  /**
   * Gets pending handoffs for a specific role.
   */
  getPendingHandoffsForRole(role: Role): HandoffRecord[] {
    return this.recordStorage.getAllRecords().filter(
      r => r.status === 'PENDING' && r.target_role === role
    );
  }

  /**
   * Gets the status of a handoff.
   */
  getHandoffStatus(handoffId: string): HandoffStatus | null {
    const record = this.recordStorage.getRecord(handoffId);
    return record ? record.status : null;
  }

  /**
   * Updates the context information for a handoff.
   */
  updateHandoffContext(
    handoffId: string,
    context: Partial<HandoffContext>
  ): Result<void, HandoffError> {
    const record = this.recordStorage.getRecord(handoffId);
    if (!record) {
      return err(handoffNotFoundError(handoffId));
    }

    if (record.status === 'COMPLETED') {
      return err(handoffAlreadyCompletedError(handoffId));
    }

    const updatedRecord: HandoffRecord = {
      ...record,
      context: { ...record.context, ...context },
    };

    this.recordStorage.saveRecord(updatedRecord);
    return ok(undefined);
  }

  /**
   * Clears all storage (for testing).
   */
  clear(): void {
    this.pointStorage.clear();
    this.recordStorage.clear();
    this.developerStorage.clear();
  }
}

// =============================================================================
// Arbitraries (Generators) for Property-Based Testing
// =============================================================================

/**
 * Generates a valid handoff point ID.
 */
const handoffPointIdArb = fc.stringMatching(/^HP-[A-Z0-9]{4,8}$/).filter(id => id.length >= 7);

/**
 * Generates a valid handoff ID.
 */
const handoffIdArb = fc.stringMatching(/^HO-[A-Z0-9]{6,12}$/).filter(id => id.length >= 9);

/**
 * Generates a valid task ID.
 */
const taskIdArb = fc.stringMatching(/^TASK-[0-9]{3,6}$/).filter(id => id.length >= 8);

/**
 * Generates a valid developer ID.
 */
const developerIdArb = fc.stringMatching(/^dev-[a-z0-9]{3,10}$/).filter(id => id.length >= 7);

/**
 * Generates a valid handoff point name.
 */
const handoffPointNameArb = fc.string({ minLength: 5, maxLength: 50 }).filter(name => name.trim().length > 0);

/**
 * Generates a valid role from the VALID_ROLES list.
 */
const validRoleArb: fc.Arbitrary<Role> = fc.constantFrom(...VALID_ROLES);

/**
 * Generates a valid handoff reason.
 */
const handoffReasonArb: fc.Arbitrary<HandoffReason> = fc.constantFrom(...HANDOFF_REASONS);

/**
 * Generates a valid checklist item ID.
 */
const checklistItemIdArb = fc.stringMatching(/^CHK-[0-9]{3,6}$/).filter(id => id.length >= 7);

/**
 * Generates a valid checklist item description.
 */
const checklistItemDescriptionArb = fc.string({ minLength: 5, maxLength: 100 }).filter(desc => desc.trim().length > 0);

/**
 * Generates a checklist item definition (without completion status).
 */
const checklistItemDefinitionArb: fc.Arbitrary<Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>> = fc.record({
  id: checklistItemIdArb,
  description: checklistItemDescriptionArb,
  required: fc.boolean(),
});

/**
 * Generates a non-empty array of checklist items with unique IDs.
 */
const checklistItemsArb = (minItems: number, maxItems: number): fc.Arbitrary<Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[]> => {
  return fc.array(checklistItemDefinitionArb, { minLength: minItems, maxLength: maxItems }).map(items => {
    // Ensure unique IDs
    return items.map((item, index) => ({
      ...item,
      id: `CHK-${String(index + 100).padStart(3, '0')}`,
    }));
  });
};

/**
 * Generates checklist items with at least one required item.
 */
const checklistWithRequiredItemsArb = (minItems: number, maxItems: number): fc.Arbitrary<Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[]> => {
  return checklistItemsArb(minItems, maxItems).map(items => {
    // Ensure at least one required item
    if (!items.some(i => i.required)) {
      if (items.length > 0) {
        items[0] = { ...items[0], required: true };
      }
    }
    return items;
  });
};

/**
 * Generates a handoff point definition.
 */
const handoffPointDefinitionArb: fc.Arbitrary<HandoffPointDefinition> = fc.record({
  id: handoffPointIdArb,
  name: handoffPointNameArb,
  source_role: validRoleArb,
  target_role: validRoleArb,
  checklist: checklistWithRequiredItemsArb(1, 5),
  description: fc.option(fc.string({ minLength: 5, maxLength: 100 }), { nil: undefined }),
});

/**
 * Generates a handoff context.
 */
const handoffContextArb: fc.Arbitrary<HandoffContext> = fc.record({
  reason: handoffReasonArb,
  notes: fc.option(fc.string({ minLength: 5, maxLength: 200 }), { nil: undefined }),
  priority: fc.option(fc.constantFrom('LOW' as const, 'MEDIUM' as const, 'HIGH' as const, 'URGENT' as const), { nil: undefined }),
});

/**
 * Generates a handoff request given a handoff point ID.
 */
const handoffRequestArb = (handoffPointId: string): fc.Arbitrary<HandoffRequest> => fc.record({
  handoff_point_id: fc.constant(handoffPointId),
  source_task_id: taskIdArb,
  target_task_id: fc.option(taskIdArb, { nil: undefined }),
  source_developer_id: developerIdArb,
  target_developer_id: fc.option(developerIdArb, { nil: undefined }),
  context: handoffContextArb,
});

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('Handoff_Coordinator Property-Based Tests', () => {
  /**
   * **Feature: multi-developer-support, Property 8: Handoff Checklist Completion Gate**
   * 
   * *For any* handoff, the handoff SHALL NOT transition to COMPLETE status until all
   * required checklist items are marked as complete.
   * 
   * **Validates: Requirements 11.2, 11.4**
   */
  describe('Property 8: Handoff Checklist Completion Gate', () => {
    let pointStorage: InMemoryHandoffPointStorage;
    let recordStorage: InMemoryHandoffRecordStorage;
    let developerStorage: InMemoryDeveloperStorage;
    let coordinator: InMemoryHandoffCoordinator;

    beforeEach(() => {
      pointStorage = new InMemoryHandoffPointStorage();
      recordStorage = new InMemoryHandoffRecordStorage();
      developerStorage = new InMemoryDeveloperStorage();
      coordinator = new InMemoryHandoffCoordinator({
        pointStorage,
        recordStorage,
        developerStorage,
      });
    });

    it('should prevent handoff completion when required checklist items are incomplete', () => {
      fc.assert(
        fc.property(
          handoffPointDefinitionArb,
          developerIdArb,
          developerIdArb,
          taskIdArb,
          handoffContextArb,
          (pointDef, sourceDev, targetDev, taskId, context) => {
            // Clear storage
            coordinator.clear();

            // Ensure at least one required item exists
            const defWithRequired: HandoffPointDefinition = {
              ...pointDef,
              id: 'HP-TEST001',
              checklist: pointDef.checklist.map((item, idx) => ({
                ...item,
                id: `CHK-${String(idx + 100).padStart(3, '0')}`,
                required: idx === 0 ? true : item.required, // First item is always required
              })),
            };

            // Setup: Add developers with correct roles
            developerStorage.addDeveloper({ id: sourceDev, roles: [defWithRequired.source_role] });
            developerStorage.addDeveloper({ id: targetDev, roles: [defWithRequired.target_role] });

            // Create handoff point
            const defineResult = coordinator.defineHandoffPoint(defWithRequired);
            expect(defineResult.success).toBe(true);

            // Request handoff
            const request: HandoffRequest = {
              handoff_point_id: defWithRequired.id,
              source_task_id: taskId,
              source_developer_id: sourceDev,
              target_developer_id: targetDev,
              context,
            };

            const requestResult = coordinator.requestHandoff(request);
            expect(requestResult.success).toBe(true);
            if (!requestResult.success) return;

            const handoffId = requestResult.value.id;

            // Try to accept handoff without completing required checklist items
            // This should fail because checklist is incomplete
            const acceptResult = coordinator.acceptHandoff(handoffId, targetDev);
            expect(acceptResult.success).toBe(false);
            
            if (!acceptResult.success) {
              expect(acceptResult.error.code).toBe(HandoffExtendedErrorCode.CHECKLIST_INCOMPLETE);
              expect(acceptResult.error.category).toBe('HANDOFF_ERROR');
            }

            // Verify handoff is still in PENDING status
            const status = coordinator.getHandoffStatus(handoffId);
            expect(status).toBe('PENDING');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow handoff completion when ALL required checklist items are complete', () => {
      fc.assert(
        fc.property(
          handoffPointDefinitionArb,
          developerIdArb,
          developerIdArb,
          taskIdArb,
          handoffContextArb,
          (pointDef, sourceDev, targetDev, taskId, context) => {
            // Clear storage
            coordinator.clear();

            // Ensure we have a mix of required and optional items
            const defWithChecklist: HandoffPointDefinition = {
              ...pointDef,
              id: 'HP-TEST001',
              checklist: [
                { id: 'CHK-001', description: 'Required item 1', required: true },
                { id: 'CHK-002', description: 'Required item 2', required: true },
                { id: 'CHK-003', description: 'Optional item 1', required: false },
              ],
            };

            // Setup: Add developers with correct roles
            developerStorage.addDeveloper({ id: sourceDev, roles: [defWithChecklist.source_role] });
            developerStorage.addDeveloper({ id: targetDev, roles: [defWithChecklist.target_role] });

            // Create handoff point
            const defineResult = coordinator.defineHandoffPoint(defWithChecklist);
            expect(defineResult.success).toBe(true);

            // Request handoff
            const request: HandoffRequest = {
              handoff_point_id: defWithChecklist.id,
              source_task_id: taskId,
              source_developer_id: sourceDev,
              target_developer_id: targetDev,
              context,
            };

            const requestResult = coordinator.requestHandoff(request);
            expect(requestResult.success).toBe(true);
            if (!requestResult.success) return;

            const handoffId = requestResult.value.id;

            // Complete ALL required checklist items (but not optional)
            expect(coordinator.completeChecklistItem(handoffId, 'CHK-001', sourceDev).success).toBe(true);
            expect(coordinator.completeChecklistItem(handoffId, 'CHK-002', sourceDev).success).toBe(true);
            // Intentionally skip optional item CHK-003

            // Now accept should succeed
            const acceptResult = coordinator.acceptHandoff(handoffId, targetDev);
            expect(acceptResult.success).toBe(true);

            // Complete the handoff
            const completeResult = coordinator.completeHandoff(handoffId);
            expect(completeResult.success).toBe(true);

            // Verify handoff is COMPLETED
            const status = coordinator.getHandoffStatus(handoffId);
            expect(status).toBe('COMPLETED');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return CHECKLIST_INCOMPLETE error (1610) when completing with incomplete required items', () => {
      fc.assert(
        fc.property(
          handoffPointDefinitionArb,
          developerIdArb,
          developerIdArb,
          taskIdArb,
          handoffContextArb,
          fc.integer({ min: 2, max: 5 }),
          fc.integer({ min: 0, max: 4 }),
          (pointDef, sourceDev, targetDev, taskId, context, requiredCount, completeCount) => {
            // Clear storage
            coordinator.clear();

            // Ensure we have multiple required items
            const actualRequiredCount = Math.max(2, requiredCount);
            const actualCompleteCount = Math.min(completeCount, actualRequiredCount - 1); // Always leave at least one incomplete

            const checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[] = [];
            for (let i = 0; i < actualRequiredCount; i++) {
              checklist.push({
                id: `CHK-${String(i + 100).padStart(3, '0')}`,
                description: `Required item ${i + 1}`,
                required: true,
              });
            }

            const defWithChecklist: HandoffPointDefinition = {
              ...pointDef,
              id: 'HP-TEST001',
              checklist,
            };

            // Setup: Add developers with correct roles
            developerStorage.addDeveloper({ id: sourceDev, roles: [defWithChecklist.source_role] });
            developerStorage.addDeveloper({ id: targetDev, roles: [defWithChecklist.target_role] });

            // Create handoff point
            const defineResult = coordinator.defineHandoffPoint(defWithChecklist);
            expect(defineResult.success).toBe(true);

            // Request handoff
            const request: HandoffRequest = {
              handoff_point_id: defWithChecklist.id,
              source_task_id: taskId,
              source_developer_id: sourceDev,
              target_developer_id: targetDev,
              context,
            };

            const requestResult = coordinator.requestHandoff(request);
            expect(requestResult.success).toBe(true);
            if (!requestResult.success) return;

            const handoffId = requestResult.value.id;

            // Complete only some of the required items
            for (let i = 0; i < actualCompleteCount; i++) {
              const itemId = `CHK-${String(i + 100).padStart(3, '0')}`;
              coordinator.completeChecklistItem(handoffId, itemId, sourceDev);
            }

            // Try to accept - should fail with CHECKLIST_INCOMPLETE
            const acceptResult = coordinator.acceptHandoff(handoffId, targetDev);
            expect(acceptResult.success).toBe(false);
            
            if (!acceptResult.success) {
              expect(acceptResult.error.code).toBe(HandoffExtendedErrorCode.CHECKLIST_INCOMPLETE);
              expect(acceptResult.error.context?.incomplete_items).toBeDefined();
              expect(acceptResult.error.context?.incomplete_items!.length).toBe(
                actualRequiredCount - actualCompleteCount
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow handoff to complete when ONLY required items are complete (optional items can be incomplete)', () => {
      fc.assert(
        fc.property(
          handoffPointDefinitionArb,
          developerIdArb,
          developerIdArb,
          taskIdArb,
          handoffContextArb,
          fc.integer({ min: 1, max: 3 }),
          fc.integer({ min: 1, max: 3 }),
          (pointDef, sourceDev, targetDev, taskId, context, requiredCount, optionalCount) => {
            // Clear storage
            coordinator.clear();

            // Create checklist with required and optional items
            const checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[] = [];
            
            // Add required items
            for (let i = 0; i < requiredCount; i++) {
              checklist.push({
                id: `CHK-REQ-${String(i + 100).padStart(3, '0')}`,
                description: `Required item ${i + 1}`,
                required: true,
              });
            }
            
            // Add optional items
            for (let i = 0; i < optionalCount; i++) {
              checklist.push({
                id: `CHK-OPT-${String(i + 100).padStart(3, '0')}`,
                description: `Optional item ${i + 1}`,
                required: false,
              });
            }

            const defWithChecklist: HandoffPointDefinition = {
              ...pointDef,
              id: 'HP-TEST001',
              checklist,
            };

            // Setup: Add developers with correct roles
            developerStorage.addDeveloper({ id: sourceDev, roles: [defWithChecklist.source_role] });
            developerStorage.addDeveloper({ id: targetDev, roles: [defWithChecklist.target_role] });

            // Create handoff point
            const defineResult = coordinator.defineHandoffPoint(defWithChecklist);
            expect(defineResult.success).toBe(true);

            // Request handoff
            const request: HandoffRequest = {
              handoff_point_id: defWithChecklist.id,
              source_task_id: taskId,
              source_developer_id: sourceDev,
              target_developer_id: targetDev,
              context,
            };

            const requestResult = coordinator.requestHandoff(request);
            expect(requestResult.success).toBe(true);
            if (!requestResult.success) return;

            const handoffId = requestResult.value.id;

            // Complete ONLY required items, leave optional items incomplete
            for (let i = 0; i < requiredCount; i++) {
              const itemId = `CHK-REQ-${String(i + 100).padStart(3, '0')}`;
              const completeResult = coordinator.completeChecklistItem(handoffId, itemId, sourceDev);
              expect(completeResult.success).toBe(true);
            }
            // Intentionally do NOT complete any optional items

            // Accept should succeed
            const acceptResult = coordinator.acceptHandoff(handoffId, targetDev);
            expect(acceptResult.success).toBe(true);

            // Complete should succeed
            const completeResult = coordinator.completeHandoff(handoffId);
            expect(completeResult.success).toBe(true);

            // Verify handoff is COMPLETED
            const status = coordinator.getHandoffStatus(handoffId);
            expect(status).toBe('COMPLETED');

            // Verify some optional items are still incomplete
            const handoff = coordinator.getHandoff(handoffId);
            expect(handoff.success).toBe(true);
            if (handoff.success) {
              const incompleteOptional = handoff.value.checklist_status.filter(
                i => !i.required && !i.completed
              );
              expect(incompleteOptional.length).toBe(optionalCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain checklist completion state correctly after multiple item completions', () => {
      fc.assert(
        fc.property(
          validRoleArb,
          validRoleArb,
          developerIdArb,
          developerIdArb,
          taskIdArb,
          handoffContextArb,
          fc.array(fc.boolean(), { minLength: 3, maxLength: 6 }),
          (sourceRole, targetRole, sourceDev, targetDev, taskId, context, completionPattern) => {
            // Clear storage
            coordinator.clear();

            // Create checklist items based on pattern
            const checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[] = 
              completionPattern.map((required, idx) => ({
                id: `CHK-${String(idx + 100).padStart(3, '0')}`,
                description: `Item ${idx + 1}`,
                required,
              }));

            // Ensure at least one required item
            if (!checklist.some(i => i.required)) {
              checklist[0] = { ...checklist[0], required: true };
            }

            const pointDef: HandoffPointDefinition = {
              id: 'HP-TEST001',
              name: 'Test Handoff Point',
              source_role: sourceRole,
              target_role: targetRole,
              checklist,
            };

            // Setup: Add developers
            developerStorage.addDeveloper({ id: sourceDev, roles: [sourceRole] });
            developerStorage.addDeveloper({ id: targetDev, roles: [targetRole] });

            // Create handoff point
            const defineResult = coordinator.defineHandoffPoint(pointDef);
            expect(defineResult.success).toBe(true);

            // Request handoff
            const request: HandoffRequest = {
              handoff_point_id: pointDef.id,
              source_task_id: taskId,
              source_developer_id: sourceDev,
              target_developer_id: targetDev,
              context,
            };

            const requestResult = coordinator.requestHandoff(request);
            expect(requestResult.success).toBe(true);
            if (!requestResult.success) return;

            const handoffId = requestResult.value.id;

            // Complete items one by one and verify state at each step
            const requiredItems = checklist.filter(i => i.required).map(i => i.id);
            let completedRequired = 0;

            for (let i = 0; i < checklist.length; i++) {
              const itemId = `CHK-${String(i + 100).padStart(3, '0')}`;
              const isRequired = checklist[i].required;

              // Complete this item
              const completeResult = coordinator.completeChecklistItem(handoffId, itemId, sourceDev);
              expect(completeResult.success).toBe(true);

              if (isRequired) {
                completedRequired++;
              }

              // Check if we can accept based on required items completion
              const canAccept = completedRequired === requiredItems.length;
              const acceptResult = coordinator.acceptHandoff(handoffId, targetDev);
              
              if (canAccept) {
                expect(acceptResult.success).toBe(true);
                break; // Stop once accepted
              } else {
                expect(acceptResult.success).toBe(false);
                if (!acceptResult.success) {
                  expect(acceptResult.error.code).toBe(HandoffExtendedErrorCode.CHECKLIST_INCOMPLETE);
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should identify all incomplete required items in error context', () => {
      fc.assert(
        fc.property(
          validRoleArb,
          validRoleArb,
          developerIdArb,
          developerIdArb,
          taskIdArb,
          handoffContextArb,
          (sourceRole, targetRole, sourceDev, targetDev, taskId, context) => {
            // Clear storage
            coordinator.clear();

            // Create 5 required items
            const checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[] = [
              { id: 'CHK-001', description: 'Required 1', required: true },
              { id: 'CHK-002', description: 'Required 2', required: true },
              { id: 'CHK-003', description: 'Required 3', required: true },
              { id: 'CHK-004', description: 'Required 4', required: true },
              { id: 'CHK-005', description: 'Required 5', required: true },
            ];

            const pointDef: HandoffPointDefinition = {
              id: 'HP-TEST001',
              name: 'Test Handoff',
              source_role: sourceRole,
              target_role: targetRole,
              checklist,
            };

            // Setup
            developerStorage.addDeveloper({ id: sourceDev, roles: [sourceRole] });
            developerStorage.addDeveloper({ id: targetDev, roles: [targetRole] });

            coordinator.defineHandoffPoint(pointDef);

            const request: HandoffRequest = {
              handoff_point_id: pointDef.id,
              source_task_id: taskId,
              source_developer_id: sourceDev,
              context,
            };

            const requestResult = coordinator.requestHandoff(request);
            expect(requestResult.success).toBe(true);
            if (!requestResult.success) return;

            const handoffId = requestResult.value.id;

            // Complete only items 1 and 3
            coordinator.completeChecklistItem(handoffId, 'CHK-001', sourceDev);
            coordinator.completeChecklistItem(handoffId, 'CHK-003', sourceDev);

            // Try to accept
            const acceptResult = coordinator.acceptHandoff(handoffId, targetDev);
            expect(acceptResult.success).toBe(false);

            if (!acceptResult.success) {
              expect(acceptResult.error.code).toBe(HandoffExtendedErrorCode.CHECKLIST_INCOMPLETE);
              expect(acceptResult.error.context?.incomplete_items).toBeDefined();
              
              const incompleteItems = acceptResult.error.context?.incomplete_items;
              expect(incompleteItems).toContain('CHK-002');
              expect(incompleteItems).toContain('CHK-004');
              expect(incompleteItems).toContain('CHK-005');
              expect(incompleteItems).not.toContain('CHK-001');
              expect(incompleteItems).not.toContain('CHK-003');
              expect(incompleteItems?.length).toBe(3);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow handoff with no required items (all optional) to complete immediately after acceptance', () => {
      fc.assert(
        fc.property(
          validRoleArb,
          validRoleArb,
          developerIdArb,
          developerIdArb,
          taskIdArb,
          handoffContextArb,
          fc.integer({ min: 1, max: 4 }),
          (sourceRole, targetRole, sourceDev, targetDev, taskId, context, optionalCount) => {
            // Clear storage
            coordinator.clear();

            // Create only optional items
            const checklist: Omit<ChecklistItem, 'completed' | 'completed_at' | 'completed_by'>[] = [];
            for (let i = 0; i < optionalCount; i++) {
              checklist.push({
                id: `CHK-${String(i + 100).padStart(3, '0')}`,
                description: `Optional item ${i + 1}`,
                required: false,
              });
            }

            const pointDef: HandoffPointDefinition = {
              id: 'HP-TEST001',
              name: 'All Optional Handoff',
              source_role: sourceRole,
              target_role: targetRole,
              checklist,
            };

            // Setup
            developerStorage.addDeveloper({ id: sourceDev, roles: [sourceRole] });
            developerStorage.addDeveloper({ id: targetDev, roles: [targetRole] });

            coordinator.defineHandoffPoint(pointDef);

            const request: HandoffRequest = {
              handoff_point_id: pointDef.id,
              source_task_id: taskId,
              source_developer_id: sourceDev,
              context,
            };

            const requestResult = coordinator.requestHandoff(request);
            expect(requestResult.success).toBe(true);
            if (!requestResult.success) return;

            const handoffId = requestResult.value.id;

            // Accept without completing any checklist items (all are optional)
            const acceptResult = coordinator.acceptHandoff(handoffId, targetDev);
            expect(acceptResult.success).toBe(true);

            // Complete the handoff
            const completeResult = coordinator.completeHandoff(handoffId);
            expect(completeResult.success).toBe(true);

            // Verify status
            const status = coordinator.getHandoffStatus(handoffId);
            expect(status).toBe('COMPLETED');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should prevent completion of already completed handoff', () => {
      fc.assert(
        fc.property(
          validRoleArb,
          validRoleArb,
          developerIdArb,
          developerIdArb,
          taskIdArb,
          handoffContextArb,
          (sourceRole, targetRole, sourceDev, targetDev, taskId, context) => {
            // Clear storage
            coordinator.clear();

            const pointDef: HandoffPointDefinition = {
              id: 'HP-TEST001',
              name: 'Test Handoff',
              source_role: sourceRole,
              target_role: targetRole,
              checklist: [
                { id: 'CHK-001', description: 'Required item', required: true },
              ],
            };

            // Setup
            developerStorage.addDeveloper({ id: sourceDev, roles: [sourceRole] });
            developerStorage.addDeveloper({ id: targetDev, roles: [targetRole] });

            coordinator.defineHandoffPoint(pointDef);

            const request: HandoffRequest = {
              handoff_point_id: pointDef.id,
              source_task_id: taskId,
              source_developer_id: sourceDev,
              context,
            };

            const requestResult = coordinator.requestHandoff(request);
            expect(requestResult.success).toBe(true);
            if (!requestResult.success) return;

            const handoffId = requestResult.value.id;

            // Complete checklist, accept, and complete
            coordinator.completeChecklistItem(handoffId, 'CHK-001', sourceDev);
            coordinator.acceptHandoff(handoffId, targetDev);
            
            const firstComplete = coordinator.completeHandoff(handoffId);
            expect(firstComplete.success).toBe(true);

            // Try to complete again
            const secondComplete = coordinator.completeHandoff(handoffId);
            expect(secondComplete.success).toBe(false);
            if (!secondComplete.success) {
              expect(secondComplete.error.code).toBe(HandoffErrorCode.HANDOFF_ALREADY_COMPLETED);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
