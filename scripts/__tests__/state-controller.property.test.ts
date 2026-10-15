/**
 * Property-Based Tests for State_Controller
 * 
 * **Feature: sdlc-workflow-reliability**
 * 
 * These tests verify the universal correctness properties of the State_Controller component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements R02.2**
 * 
 * Properties tested:
 * 1. Version Monotonicity: Version always monotonically increases
 * 2. Write Correctness: Successful write ⇒ version = expected + 1
 * 3. Read-Write Consistency: Read after write returns same data
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  ProjectState,
  StateErrorCode,
  STATE_CONTROLLER_DEFAULTS,
  createDefaultProjectState,
} from '../state-controller';

import { FileStateController } from '../state-controller-impl';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Temporary file helper for property tests.
 */
class PropertyTestFileHelper {
  private tempDir: string = '';
  private fileCounter: number = 0;
  private files: string[] = [];

  async setup(): Promise<void> {
    this.tempDir = path.join(process.cwd(), '.test-temp', `state-controller-pbt-${Date.now()}`);
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async cleanup(): Promise<void> {
    for (const file of this.files) {
      try {
        await fs.unlink(file);
      } catch {
        // Ignore errors during cleanup
      }
    }
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch {
      // Ignore errors during cleanup
    }
    this.files = [];
    this.fileCounter = 0;
  }

  createPath(): string {
    const filePath = path.join(this.tempDir, `state-${++this.fileCounter}.yaml`);
    this.files.push(filePath);
    return filePath;
  }
}

// =============================================================================
// Arbitraries (Generators) for Property-Based Testing
// =============================================================================

/**
 * Generates a valid schema version.
 */
const schemaVersionArb: fc.Arbitrary<'1' | '2'> = fc.constantFrom('1' as const, '2' as const);

/**
 * Generates a valid workflow version string.
 */
const workflowVersionArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1, max: 5 }),
    fc.integer({ min: 0, max: 20 }),
    fc.integer({ min: 0, max: 20 })
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/**
 * Generates a valid actor ID.
 */
const actorIdArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z]+-[0-9]{3}$/)
  .filter(id => id.length >= 7);

/**
 * Generates a valid last_action string.
 */
const lastActionArb: fc.Arbitrary<string> = fc.string({ minLength: 5, maxLength: 200 })
  .filter(s => s.trim().length > 0);

/**
 * Generates a valid lifecycle phase.
 */
const lifecyclePhaseArb: fc.Arbitrary<string> = fc.constantFrom(
  'PLANNING',
  'REQUIREMENTS',
  'DESIGN',
  'IMPLEMENTATION',
  'TESTING',
  'RELEASE',
  'MAINTENANCE'
);

/**
 * Generates a valid initial version number (>= 1).
 */
const initialVersionArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10000 });

/**
 * Generates the number of sequential writes to perform.
 */
const writeCountArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 50 });

/**
 * Generates a valid minimal ProjectState for testing.
 */
const minimalProjectStateArb: fc.Arbitrary<ProjectState> = fc.record({
  schema_version: schemaVersionArb,
  workflow_version: workflowVersionArb,
  state_version: initialVersionArb,
  last_modified_at: fc.constant(new Date().toISOString()),
  last_modified_by: actorIdArb,
  last_action: lastActionArb,
}).map(record => ({
  ...record,
  next_permitted_actions: [],
}));

/**
 * Generates a valid ProjectState with optional fields for testing.
 */
const fullProjectStateArb: fc.Arbitrary<ProjectState> = fc.record({
  schema_version: schemaVersionArb,
  workflow_version: workflowVersionArb,
  state_version: initialVersionArb,
  last_modified_at: fc.constant(new Date().toISOString()),
  last_modified_by: actorIdArb,
  lifecycle: fc.record({
    phase: lifecyclePhaseArb,
    phase_started_at: fc.constant(new Date().toISOString()),
  }),
  team: fc.record({
    members: fc.constant([]),
    statistics: fc.record({
      total_members: fc.constant(0),
      by_role: fc.constant({}),
    }),
  }),
  tasks: fc.record({
    total: fc.integer({ min: 0, max: 100 }),
    by_status: fc.constant({}),
    by_assignee: fc.constant({}),
  }),
  current_task: fc.constant(null),
  resource_locks: fc.constant([]),
  last_action: lastActionArb,
  next_permitted_actions: fc.constant([]),
}).map(record => ({
  ...record,
}));

/**
 * Generates a state modification function.
 */
const stateModifierArb: fc.Arbitrary<(state: ProjectState) => ProjectState> = fc.oneof(
  // Modify last_action
  lastActionArb.map(action => (state: ProjectState) => ({
    ...state,
    last_action: action,
  })),
  // Modify lifecycle phase
  lifecyclePhaseArb.map(phase => (state: ProjectState) => ({
    ...state,
    lifecycle: {
      phase,
      phase_started_at: new Date().toISOString(),
    },
  })),
  // Add to next_permitted_actions
  fc.array(fc.constantFrom('START_TASK', 'CREATE_CHECKPOINT', 'RUN_TESTS'), { minLength: 1, maxLength: 3 })
    .map(actions => (state: ProjectState) => ({
      ...state,
      next_permitted_actions: actions,
    })),
  // Modify tasks count
  fc.integer({ min: 0, max: 50 }).map(total => (state: ProjectState) => ({
    ...state,
    tasks: {
      total,
      by_status: {},
      by_assignee: {},
    },
  }))
);

/**
 * Generates an operation ID.
 */
const operationIdArb: fc.Arbitrary<string> = fc.stringMatching(/^op-[a-z0-9]{6,12}$/)
  .filter(id => id.length >= 9);

/**
 * Generates a reason string for operations.
 */
const reasonArb: fc.Arbitrary<string> = fc.string({ minLength: 5, maxLength: 100 })
  .filter(s => s.trim().length > 0);

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('State_Controller Property-Based Tests', () => {
  let tempHelper: PropertyTestFileHelper;

  beforeEach(async () => {
    tempHelper = new PropertyTestFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  /**
   * **Property 1: Version Monotonicity**
   * 
   * *For any* sequence of N successful writes starting from initial version V,
   * the final version SHALL be V + N.
   * 
   * This property ensures that version numbers always increase monotonically
   * and never skip, repeat, or decrease.
   * 
   * **Validates: Requirements R02.2**
   */
  describe('Property 1: Version Monotonicity', () => {
    it('should always increment version by exactly 1 after each successful write', () => {
      fc.assert(
        fc.property(
          initialVersionArb,
          writeCountArb,
          fc.array(stateModifierArb, { minLength: 1, maxLength: 50 }),
          actorIdArb,
          async (initialVersion, writeCount, modifiers, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state
            const initialState: ProjectState = {
              schema_version: '2',
              workflow_version: '1.1.0',
              state_version: initialVersion,
              last_modified_at: new Date().toISOString(),
              last_modified_by: actorId,
              last_action: 'Initial state',
              next_permitted_actions: [],
            };

            // Write initial state
            const createResult = await controller.writeState(
              initialState,
              0, // Version 0 for new file
              'op-init',
              'Create initial state'
            );
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;
            expect(createResult.value.newVersion).toBe(1);

            // Track versions through writes
            const versions: number[] = [1];
            let currentVersion = 1;

            // Perform N sequential writes
            const actualWriteCount = Math.min(writeCount, modifiers.length);
            for (let i = 0; i < actualWriteCount; i++) {
              const readResult = await controller.readState();
              expect(readResult.success).toBe(true);
              if (!readResult.success) return;

              expect(readResult.value.version).toBe(currentVersion);

              const modifier = modifiers[i % modifiers.length];
              const newState = modifier(readResult.value.state);

              const writeResult = await controller.writeState(
                newState,
                currentVersion,
                `op-${i}`,
                `Write ${i}`
              );

              expect(writeResult.success).toBe(true);
              if (!writeResult.success) return;

              // Version should be exactly currentVersion + 1
              expect(writeResult.value.newVersion).toBe(currentVersion + 1);

              currentVersion = writeResult.value.newVersion;
              versions.push(currentVersion);
            }

            // Verify monotonicity: each version is exactly 1 more than previous
            for (let i = 1; i < versions.length; i++) {
              expect(versions[i]).toBe(versions[i - 1] + 1);
            }

            // Final version should be initial + writeCount (+ 1 for initial creation)
            expect(currentVersion).toBe(1 + actualWriteCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain strict monotonicity across updateState retry scenarios', () => {
      fc.assert(
        fc.property(
          initialVersionArb,
          fc.integer({ min: 1, max: 10 }), // number of updateState calls
          actorIdArb,
          async (initialVersion, updateCount, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state
            const initialState: ProjectState = {
              schema_version: '2',
              workflow_version: '1.1.0',
              state_version: initialVersion,
              last_modified_at: new Date().toISOString(),
              last_modified_by: actorId,
              last_action: 'Initial state',
              next_permitted_actions: [],
            };

            await controller.writeState(initialState, 0, 'op-init', 'Create');

            const versions: number[] = [1];
            
            // Perform N updateState operations
            for (let i = 0; i < updateCount; i++) {
              const updateResult = await controller.updateState(
                (state) => ({
                  ...state,
                  last_action: `Update ${i}`,
                }),
                `op-update-${i}`,
                `Update operation ${i}`
              );

              expect(updateResult.success).toBe(true);
              if (!updateResult.success) return;

              versions.push(updateResult.value.version);
            }

            // Verify strict monotonicity
            for (let i = 1; i < versions.length; i++) {
              expect(versions[i]).toBeGreaterThan(versions[i - 1]);
              expect(versions[i]).toBe(versions[i - 1] + 1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never produce duplicate or skipped versions', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 5, max: 30 }), // number of writes
          actorIdArb,
          async (writeCount, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state
            await controller.writeState(
              createDefaultProjectState(actorId),
              0,
              'op-init',
              'Create'
            );

            const seenVersions = new Set<number>();
            seenVersions.add(1);

            let currentVersion = 1;

            for (let i = 0; i < writeCount; i++) {
              const readResult = await controller.readState();
              if (!readResult.success) return;

              const writeResult = await controller.writeState(
                { ...readResult.value.state, last_action: `Action ${i}` },
                currentVersion,
                `op-${i}`,
                `Reason ${i}`
              );

              if (!writeResult.success) return;

              const newVersion = writeResult.value.newVersion;

              // No duplicates
              expect(seenVersions.has(newVersion)).toBe(false);
              
              // No skips (must be exactly previous + 1)
              expect(newVersion).toBe(currentVersion + 1);

              seenVersions.add(newVersion);
              currentVersion = newVersion;
            }

            // Verify all versions from 1 to currentVersion are present
            for (let v = 1; v <= currentVersion; v++) {
              expect(seenVersions.has(v)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 2: Write Correctness**
   * 
   * *For any* write operation with expectedVersion V that succeeds,
   * the returned newVersion SHALL be exactly V + 1.
   * 
   * This property ensures the optimistic concurrency control mechanism
   * works correctly.
   * 
   * **Validates: Requirements R02.2**
   */
  describe('Property 2: Write Correctness (version = expected + 1)', () => {
    it('should return newVersion = expectedVersion + 1 on successful write', () => {
      fc.assert(
        fc.property(
          initialVersionArb,
          fc.array(stateModifierArb, { minLength: 1, maxLength: 20 }),
          operationIdArb,
          reasonArb,
          actorIdArb,
          async (initialVersion, modifiers, opId, reason, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state with version 1
            const initialState: ProjectState = {
              schema_version: '2',
              workflow_version: '1.1.0',
              state_version: initialVersion,
              last_modified_at: new Date().toISOString(),
              last_modified_by: actorId,
              last_action: 'Initial',
              next_permitted_actions: [],
            };

            const createResult = await controller.writeState(initialState, 0, 'op-create', 'Create');
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            let expectedVersion = 1;

            // Each write should return expectedVersion + 1
            for (const modifier of modifiers) {
              const readResult = await controller.readState();
              expect(readResult.success).toBe(true);
              if (!readResult.success) return;

              expect(readResult.value.version).toBe(expectedVersion);

              const newState = modifier(readResult.value.state);

              const writeResult = await controller.writeState(
                newState,
                expectedVersion,
                opId,
                reason
              );

              expect(writeResult.success).toBe(true);
              if (writeResult.success) {
                // Core property: newVersion = expectedVersion + 1
                expect(writeResult.value.newVersion).toBe(expectedVersion + 1);
              }

              expectedVersion++;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject write with stale version (expected != actual)', () => {
      fc.assert(
        fc.property(
          initialVersionArb,
          fc.integer({ min: 1, max: 100 }), // stale version offset
          actorIdArb,
          async (initialVersion, staleOffset, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state
            await controller.writeState(
              createDefaultProjectState(actorId),
              0,
              'op-init',
              'Create'
            );

            // Do some writes to increase version
            for (let i = 0; i < 5; i++) {
              const readResult = await controller.readState();
              if (!readResult.success) return;

              await controller.writeState(
                { ...readResult.value.state, last_action: `Write ${i}` },
                readResult.value.version,
                `op-${i}`,
                `Write ${i}`
              );
            }

            // Current version should be 6
            const currentRead = await controller.readState();
            expect(currentRead.success).toBe(true);
            if (!currentRead.success) return;

            const currentVersion = currentRead.value.version;
            expect(currentVersion).toBe(6);

            // Try to write with stale version
            const staleVersion = Math.max(1, currentVersion - staleOffset);
            if (staleVersion === currentVersion) return; // Skip if offset makes it match

            const staleWriteResult = await controller.writeState(
              { ...currentRead.value.state, last_action: 'Stale write' },
              staleVersion,
              'op-stale',
              'Stale attempt'
            );

            // Should fail with VERSION_CONFLICT
            expect(staleWriteResult.success).toBe(false);
            if (!staleWriteResult.success) {
              expect(staleWriteResult.error.code).toBe(StateErrorCode.VERSION_CONFLICT);
              expect(staleWriteResult.error.context?.expected_version).toBe(staleVersion);
              expect(staleWriteResult.error.context?.actual_version).toBe(currentVersion);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject write with future version (expected > actual)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // future version offset
          actorIdArb,
          async (futureOffset, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state (version 1)
            await controller.writeState(
              createDefaultProjectState(actorId),
              0,
              'op-init',
              'Create'
            );

            const readResult = await controller.readState();
            expect(readResult.success).toBe(true);
            if (!readResult.success) return;

            const currentVersion = readResult.value.version;
            expect(currentVersion).toBe(1);

            // Try to write with future version
            const futureVersion = currentVersion + futureOffset;

            const futureWriteResult = await controller.writeState(
              { ...readResult.value.state, last_action: 'Future write' },
              futureVersion,
              'op-future',
              'Future attempt'
            );

            // Should fail with VERSION_CONFLICT
            expect(futureWriteResult.success).toBe(false);
            if (!futureWriteResult.success) {
              expect(futureWriteResult.error.code).toBe(StateErrorCode.VERSION_CONFLICT);
              expect(futureWriteResult.error.context?.expected_version).toBe(futureVersion);
              expect(futureWriteResult.error.context?.actual_version).toBe(currentVersion);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 3: Read-Write Consistency**
   * 
   * *For any* state S written successfully, a subsequent read SHALL return
   * a state with the same data fields (excluding auto-updated metadata).
   * 
   * This property ensures data integrity - what you write is what you get back.
   * 
   * **Validates: Requirements R02.2**
   */
  describe('Property 3: Read-Write Consistency', () => {
    it('should return the same data after write (excluding auto-updated fields)', () => {
      fc.assert(
        fc.property(
          fullProjectStateArb,
          actorIdArb,
          async (state, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Prepare state for writing
            const stateToWrite: ProjectState = {
              ...state,
              state_version: 1, // Will be managed by controller
              last_modified_at: new Date().toISOString(),
              last_modified_by: actorId,
            };

            // Write state
            const writeResult = await controller.writeState(
              stateToWrite,
              0, // New file
              'op-write',
              'Write test'
            );

            expect(writeResult.success).toBe(true);
            if (!writeResult.success) return;

            // Read state back
            const readResult = await controller.readState();
            expect(readResult.success).toBe(true);
            if (!readResult.success) return;

            const readState = readResult.value.state;

            // Verify data fields match (excluding auto-updated metadata)
            expect(readState.schema_version).toBe(stateToWrite.schema_version);
            expect(readState.workflow_version).toBe(stateToWrite.workflow_version);
            expect(readState.last_action).toBe(stateToWrite.last_action);
            expect(readState.next_permitted_actions).toEqual(stateToWrite.next_permitted_actions);

            // Lifecycle should match if present
            if (stateToWrite.lifecycle) {
              expect(readState.lifecycle?.phase).toBe(stateToWrite.lifecycle.phase);
            }

            // Tasks should match if present
            if (stateToWrite.tasks) {
              expect(readState.tasks?.total).toBe(stateToWrite.tasks.total);
            }

            // Version should be 1 (incremented from 0)
            expect(readState.state_version).toBe(1);
            expect(readResult.value.version).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve state through multiple read-modify-write cycles', () => {
      fc.assert(
        fc.property(
          fc.array(stateModifierArb, { minLength: 3, maxLength: 15 }),
          actorIdArb,
          async (modifiers, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state
            const initialState = createDefaultProjectState(actorId);
            initialState.last_action = 'Initial action';

            await controller.writeState(initialState, 0, 'op-init', 'Create');

            // Track expected state through modifications
            let expectedState: ProjectState = { ...initialState, state_version: 1 };

            for (let i = 0; i < modifiers.length; i++) {
              // Read current state
              const readResult = await controller.readState();
              expect(readResult.success).toBe(true);
              if (!readResult.success) return;

              // Apply modifier
              const modifier = modifiers[i];
              const newState = modifier(readResult.value.state);

              // Write modified state
              const writeResult = await controller.writeState(
                newState,
                readResult.value.version,
                `op-${i}`,
                `Modify ${i}`
              );

              expect(writeResult.success).toBe(true);
              if (!writeResult.success) return;

              // Update expected state
              expectedState = modifier(expectedState);
              expectedState.state_version = writeResult.value.newVersion;

              // Verify read returns what we wrote
              const verifyRead = await controller.readState();
              expect(verifyRead.success).toBe(true);
              if (!verifyRead.success) return;

              // Check data consistency
              expect(verifyRead.value.state.last_action).toBe(expectedState.last_action);
              expect(verifyRead.value.state.lifecycle?.phase).toBe(expectedState.lifecycle?.phase);
              expect(verifyRead.value.version).toBe(writeResult.value.newVersion);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain consistency through updateState operations', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              action: lastActionArb,
              phase: lifecyclePhaseArb,
              taskCount: fc.integer({ min: 0, max: 100 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          actorIdArb,
          async (updates, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state
            await controller.writeState(
              createDefaultProjectState(actorId),
              0,
              'op-init',
              'Create'
            );

            for (const update of updates) {
              // Use updateState for atomic read-modify-write
              const updateResult = await controller.updateState(
                (state) => ({
                  ...state,
                  last_action: update.action,
                  lifecycle: {
                    phase: update.phase,
                    phase_started_at: new Date().toISOString(),
                  },
                  tasks: {
                    total: update.taskCount,
                    by_status: {},
                    by_assignee: {},
                  },
                }),
                'op-update',
                'Update test'
              );

              expect(updateResult.success).toBe(true);
              if (!updateResult.success) return;

              // Verify consistency
              expect(updateResult.value.state.last_action).toBe(update.action);
              expect(updateResult.value.state.lifecycle?.phase).toBe(update.phase);
              expect(updateResult.value.state.tasks?.total).toBe(update.taskCount);

              // Verify read returns same
              const readResult = await controller.readState();
              expect(readResult.success).toBe(true);
              if (!readResult.success) return;

              expect(readResult.value.state.last_action).toBe(update.action);
              expect(readResult.value.state.lifecycle?.phase).toBe(update.phase);
              expect(readResult.value.state.tasks?.total).toBe(update.taskCount);
              expect(readResult.value.version).toBe(updateResult.value.version);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve all custom fields through write-read cycle', () => {
      fc.assert(
        fc.property(
          fc.record({
            customField1: fc.string({ minLength: 1, maxLength: 50 }),
            customField2: fc.integer({ min: 0, max: 1000 }),
            customArray: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
            customNested: fc.record({
              nestedValue: fc.string({ minLength: 1, maxLength: 30 }),
              nestedNumber: fc.float({ min: 0, max: 100 }),
            }),
          }),
          actorIdArb,
          async (customData, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create state with custom fields
            const stateWithCustom: ProjectState = {
              ...createDefaultProjectState(actorId),
              // Custom fields (allowed by index signature)
              customField1: customData.customField1,
              customField2: customData.customField2,
              customArray: customData.customArray,
              customNested: customData.customNested,
            };

            // Write state
            const writeResult = await controller.writeState(
              stateWithCustom,
              0,
              'op-custom',
              'Custom fields test'
            );

            expect(writeResult.success).toBe(true);
            if (!writeResult.success) return;

            // Read state back
            const readResult = await controller.readState();
            expect(readResult.success).toBe(true);
            if (!readResult.success) return;

            // Verify custom fields preserved
            expect(readResult.value.state.customField1).toBe(customData.customField1);
            expect(readResult.value.state.customField2).toBe(customData.customField2);
            expect(readResult.value.state.customArray).toEqual(customData.customArray);
            expect(readResult.value.state.customNested).toEqual(customData.customNested);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Additional Property: Idempotency of Version on Conflict**
   * 
   * When a version conflict occurs, the state remains unchanged.
   * 
   * **Validates: Requirements R02.2, R02.11**
   */
  describe('Property 4: State Unchanged on Version Conflict', () => {
    it('should not modify state when write fails due to version conflict', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // writes before conflict test
          lastActionArb, // action to attempt with stale version
          actorIdArb,
          async (initialWrites, conflictAction, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create and populate state
            await controller.writeState(
              createDefaultProjectState(actorId),
              0,
              'op-init',
              'Create'
            );

            // Do some writes
            for (let i = 0; i < initialWrites; i++) {
              const read = await controller.readState();
              if (!read.success) return;

              await controller.writeState(
                { ...read.value.state, last_action: `Write ${i}` },
                read.value.version,
                `op-${i}`,
                `Write ${i}`
              );
            }

            // Read state before conflict attempt
            const beforeConflict = await controller.readState();
            expect(beforeConflict.success).toBe(true);
            if (!beforeConflict.success) return;

            const versionBefore = beforeConflict.value.version;
            const actionBefore = beforeConflict.value.state.last_action;

            // Attempt write with stale version
            const staleVersion = versionBefore - 1;
            if (staleVersion < 1) return; // Skip if we can't create stale version

            const conflictResult = await controller.writeState(
              { ...beforeConflict.value.state, last_action: conflictAction },
              staleVersion,
              'op-conflict',
              'Conflict attempt'
            );

            // Should fail
            expect(conflictResult.success).toBe(false);
            if (!conflictResult.success) {
              expect(conflictResult.error.code).toBe(StateErrorCode.VERSION_CONFLICT);
            }

            // State should be unchanged
            const afterConflict = await controller.readState();
            expect(afterConflict.success).toBe(true);
            if (!afterConflict.success) return;

            expect(afterConflict.value.version).toBe(versionBefore);
            expect(afterConflict.value.state.last_action).toBe(actionBefore);
            expect(afterConflict.value.state.last_action).not.toBe(conflictAction);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 5: updateState Handles Retries Correctly**
   * 
   * updateState should eventually succeed or fail definitively,
   * never leaving the state in an inconsistent condition.
   * 
   * **Validates: Requirements R02.2, R02.11**
   */
  describe('Property 5: updateState Retry Behavior', () => {
    it('should produce consistent final state after updateState (success or failure)', () => {
      fc.assert(
        fc.property(
          fc.array(lastActionArb, { minLength: 1, maxLength: 10 }),
          actorIdArb,
          async (actions, actorId) => {
            const statePath = tempHelper.createPath();
            const controller = new FileStateController({
              projectStatePath: statePath,
              defaultActorId: actorId,
            });

            // Create initial state
            await controller.writeState(
              createDefaultProjectState(actorId),
              0,
              'op-init',
              'Create'
            );

            const appliedActions: string[] = [];

            for (const action of actions) {
              const updateResult = await controller.updateState(
                (state) => ({ ...state, last_action: action }),
                'op-update',
                'Update'
              );

              if (updateResult.success) {
                appliedActions.push(action);

                // Verify the state reflects this action
                expect(updateResult.value.state.last_action).toBe(action);
              }
              // If failed, the action was not applied
            }

            // Final state should reflect only the successfully applied actions
            const finalRead = await controller.readState();
            expect(finalRead.success).toBe(true);
            if (!finalRead.success) return;

            if (appliedActions.length > 0) {
              // Last applied action should be in state
              expect(finalRead.value.state.last_action).toBe(
                appliedActions[appliedActions.length - 1]
              );
            }

            // Version should be 1 (initial) + number of successful updates
            expect(finalRead.value.version).toBe(1 + appliedActions.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
