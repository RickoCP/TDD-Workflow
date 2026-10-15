/**
 * Property-Based Tests for Ownership_Manager
 * 
 * **Feature: sdlc-workflow-reliability**
 * 
 * These tests verify the universal correctness properties of the Ownership_Manager component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements R02.3, R02.5, R02.6**
 * 
 * Properties tested:
 * 1. At Most One Valid Token: At most one valid fencing token per task at any time
 * 2. Transfer Invalidation: Transfer atomically invalidates old token
 * 3. Lease Expiry: Expired lease implies token invalid
 * 4. Token Uniqueness: Claim always generates unique UUID v4 tokens
 * 5. Ownership Consistency: Sequential operations maintain ownership consistency
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  OwnershipManager,
  FencingToken,
  ClaimResult,
  TokenValidationResult,
  TransferResult,
  OwnershipErrorCode,
  isValidFencingToken,
  generateFencingToken,
  isLeaseExpired,
  getLeaseTimeRemaining,
  OWNERSHIP_DEFAULTS,
} from '../ownership-manager';

import { FileOwnershipManager } from '../ownership-manager-impl';

import {
  StateController,
  ProjectState,
  ActorType,
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
    this.tempDir = path.join(process.cwd(), '.test-temp', `ownership-pbt-${Date.now()}`);
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

/**
 * Creates a test ownership manager with a fresh state file.
 */
async function createTestOwnershipManager(
  tempHelper: PropertyTestFileHelper,
  actorId: string,
  options?: {
    leaseDurationSeconds?: number;
    heartbeatIntervalSeconds?: number;
    heartbeatGraceMultiplier?: number;
  }
): Promise<{
  ownershipManager: FileOwnershipManager;
  stateController: FileStateController;
  statePath: string;
}> {
  const statePath = tempHelper.createPath();
  const stateController = new FileStateController({
    projectStatePath: statePath,
    defaultActorId: actorId,
  });

  // Initialize state file
  const initialState = createDefaultProjectState(actorId);
  await stateController.writeState(initialState, 0, 'op-init', 'Initialize state');

  const ownershipManager = new FileOwnershipManager({
    stateController,
    leaseDurationSeconds: options?.leaseDurationSeconds ?? OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS,
    heartbeatIntervalSeconds: options?.heartbeatIntervalSeconds ?? OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS,
    heartbeatGraceMultiplier: options?.heartbeatGraceMultiplier ?? OWNERSHIP_DEFAULTS.HEARTBEAT_GRACE_MULTIPLIER,
  });

  return { ownershipManager, stateController, statePath };
}

// =============================================================================
// Arbitraries (Generators) for Property-Based Testing
// =============================================================================

/**
 * Generates a valid task ID.
 */
const taskIdArb: fc.Arbitrary<string> = fc.stringMatching(/^TASK-[0-9]{3,6}$/)
  .filter(id => id.length >= 8);

/**
 * Generates a valid owner ID.
 */
const ownerIdArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z]+-[0-9]{3}$/)
  .filter(id => id.length >= 7);

/**
 * Generates a valid actor type.
 */
const actorTypeArb: fc.Arbitrary<ActorType> = fc.constantFrom('HUMAN' as ActorType, 'AI_AGENT' as ActorType);

/**
 * Generates a sequence of claim operations.
 */
const claimOperationArb: fc.Arbitrary<{
  taskId: string;
  ownerId: string;
  actorType: ActorType;
}> = fc.record({
  taskId: taskIdArb,
  ownerId: ownerIdArb,
  actorType: actorTypeArb,
});

/**
 * Generates the number of operations to perform.
 */
const operationCountArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 20 });

/**
 * Generates a list of unique owner IDs.
 */
const uniqueOwnerIdsArb = (count: number): fc.Arbitrary<string[]> => 
  fc.array(ownerIdArb, { minLength: count, maxLength: count })
    .map(ids => [...new Set(ids)])
    .filter(ids => ids.length === count);

/**
 * Generates a lease duration in seconds (short for testing).
 */
const shortLeaseDurationArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10 });

/**
 * Generates a heartbeat interval in seconds (short for testing).
 */
const shortHeartbeatIntervalArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 5 });

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('Ownership_Manager Property-Based Tests', () => {
  let tempHelper: PropertyTestFileHelper;

  beforeEach(async () => {
    tempHelper = new PropertyTestFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  /**
   * **Property 1: At Most One Valid Fencing Token Per Task**
   * 
   * *For any* task at any point in time, there SHALL be at most one
   * valid fencing token. This ensures exclusive ownership.
   * 
   * **Validates: Requirements R02.3, R02.5**
   */
  describe('Property 1: At Most One Valid Fencing Token Per Task', () => {
    it('should have exactly one valid token after successful claim', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          actorTypeArb,
          async (taskId, ownerId, actorType) => {
            const { ownershipManager, stateController } = await createTestOwnershipManager(
              tempHelper,
              ownerId
            );

            // Claim the task
            const claimResult = await ownershipManager.claimTask(taskId, ownerId, actorType);
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const fencingToken = claimResult.value.fencing_token;

            // Validate the token
            const validationResult = await ownershipManager.validateFencingToken(taskId, fencingToken);
            expect(validationResult.success).toBe(true);
            if (!validationResult.success) return;

            expect(validationResult.value.valid).toBe(true);

            // Verify only this token is valid (any other random token should be invalid)
            const randomToken = generateFencingToken();
            if (randomToken !== fencingToken) {
              const randomValidation = await ownershipManager.validateFencingToken(taskId, randomToken);
              expect(randomValidation.success).toBe(true);
              if (randomValidation.success) {
                expect(randomValidation.value.valid).toBe(false);
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should reject claim when task already has an owner', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          ownerIdArb,
          actorTypeArb,
          actorTypeArb,
          async (taskId, ownerId1, ownerId2, actorType1, actorType2) => {
            // Ensure different owners
            if (ownerId1 === ownerId2) return;

            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              ownerId1
            );

            // First claim succeeds
            const claim1 = await ownershipManager.claimTask(taskId, ownerId1, actorType1);
            expect(claim1.success).toBe(true);
            if (!claim1.success) return;

            // Second claim by different owner fails
            const claim2 = await ownershipManager.claimTask(taskId, ownerId2, actorType2);
            expect(claim2.success).toBe(false);
            if (!claim2.success) {
              expect(claim2.error.code).toBe(OwnershipErrorCode.TASK_ALREADY_CLAIMED);
            }

            // Original token still valid
            const validation = await ownershipManager.validateFencingToken(taskId, claim1.value.fencing_token);
            expect(validation.success).toBe(true);
            if (validation.success) {
              expect(validation.value.valid).toBe(true);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain single valid token through multiple claim attempts', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          fc.array(ownerIdArb, { minLength: 2, maxLength: 10 }),
          actorTypeArb,
          async (taskId, ownerIds, actorType) => {
            // Get unique owner IDs
            const uniqueOwners = [...new Set(ownerIds)];
            if (uniqueOwners.length < 2) return;

            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              uniqueOwners[0]
            );

            // First claim
            const firstClaim = await ownershipManager.claimTask(taskId, uniqueOwners[0], actorType);
            expect(firstClaim.success).toBe(true);
            if (!firstClaim.success) return;

            const validToken = firstClaim.value.fencing_token;
            const invalidTokens: string[] = [];

            // All subsequent claims should fail
            for (let i = 1; i < uniqueOwners.length; i++) {
              const claim = await ownershipManager.claimTask(taskId, uniqueOwners[i], actorType);
              expect(claim.success).toBe(false);
            }

            // Only the original token remains valid
            const validation = await ownershipManager.validateFencingToken(taskId, validToken);
            expect(validation.success).toBe(true);
            if (validation.success) {
              expect(validation.value.valid).toBe(true);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Property 2: Transfer Invalidates Old Token**
   * 
   * *For any* transfer operation, the old fencing token SHALL be
   * atomically invalidated and a new token SHALL be issued.
   * 
   * **Validates: Requirements R02.6, R08.2**
   */
  describe('Property 2: Transfer Invalidates Old Token', () => {
    it('should invalidate old token and create new valid token on transfer', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          ownerIdArb,
          actorTypeArb,
          actorTypeArb,
          async (taskId, fromOwner, toOwner, fromActorType, toActorType) => {
            // Ensure different owners
            if (fromOwner === toOwner) return;

            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              fromOwner
            );

            // Initial claim
            const claimResult = await ownershipManager.claimTask(taskId, fromOwner, fromActorType);
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const oldToken = claimResult.value.fencing_token;

            // Validate old token is valid before transfer
            const beforeValidation = await ownershipManager.validateFencingToken(taskId, oldToken);
            expect(beforeValidation.success).toBe(true);
            if (beforeValidation.success) {
              expect(beforeValidation.value.valid).toBe(true);
            }

            // Transfer ownership
            const transferResult = await ownershipManager.transferOwnership(
              taskId,
              oldToken,
              toOwner,
              toActorType
            );
            expect(transferResult.success).toBe(true);
            if (!transferResult.success) return;

            const newToken = transferResult.value.new_fencing_token;

            // Old token should now be invalid
            const oldValidation = await ownershipManager.validateFencingToken(taskId, oldToken);
            expect(oldValidation.success).toBe(true);
            if (oldValidation.success) {
              expect(oldValidation.value.valid).toBe(false);
              expect(oldValidation.value.invalid_reason).toBe('OWNERSHIP_MISMATCH');
            }

            // New token should be valid
            const newValidation = await ownershipManager.validateFencingToken(taskId, newToken);
            expect(newValidation.success).toBe(true);
            if (newValidation.success) {
              expect(newValidation.value.valid).toBe(true);
            }

            // Tokens should be different
            expect(oldToken).not.toBe(newToken);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain single valid token through chain of transfers', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          fc.array(ownerIdArb, { minLength: 3, maxLength: 6 }),
          actorTypeArb,
          async (taskId, ownerIds, actorType) => {
            // Get unique owner IDs
            const uniqueOwners = [...new Set(ownerIds)];
            if (uniqueOwners.length < 3) return;

            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              uniqueOwners[0]
            );

            // Initial claim
            const initialClaim = await ownershipManager.claimTask(taskId, uniqueOwners[0], actorType);
            expect(initialClaim.success).toBe(true);
            if (!initialClaim.success) return;

            const allTokens: string[] = [initialClaim.value.fencing_token];
            let currentToken = initialClaim.value.fencing_token;

            // Chain of transfers
            for (let i = 1; i < uniqueOwners.length; i++) {
              const transferResult = await ownershipManager.transferOwnership(
                taskId,
                currentToken,
                uniqueOwners[i],
                actorType
              );
              expect(transferResult.success).toBe(true);
              if (!transferResult.success) return;

              allTokens.push(transferResult.value.new_fencing_token);
              currentToken = transferResult.value.new_fencing_token;
            }

            // Only the last token should be valid
            for (let i = 0; i < allTokens.length; i++) {
              const validation = await ownershipManager.validateFencingToken(taskId, allTokens[i]);
              expect(validation.success).toBe(true);
              if (validation.success) {
                if (i === allTokens.length - 1) {
                  // Last token should be valid
                  expect(validation.value.valid).toBe(true);
                } else {
                  // All previous tokens should be invalid
                  expect(validation.value.valid).toBe(false);
                }
              }
            }

            // All tokens should be unique
            const uniqueTokens = new Set(allTokens);
            expect(uniqueTokens.size).toBe(allTokens.length);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should reject transfer with invalid old token', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          ownerIdArb,
          actorTypeArb,
          async (taskId, fromOwner, toOwner) => {
            if (fromOwner === toOwner) return;

            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              fromOwner
            );

            // Claim task
            const claimResult = await ownershipManager.claimTask(taskId, fromOwner, 'HUMAN');
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const validToken = claimResult.value.fencing_token;

            // Try transfer with fake token
            const fakeToken = generateFencingToken();
            if (fakeToken === validToken) return; // Skip if accidentally matches

            const transferResult = await ownershipManager.transferOwnership(
              taskId,
              fakeToken,
              toOwner,
              'HUMAN'
            );
            expect(transferResult.success).toBe(false);
            if (!transferResult.success) {
              expect(transferResult.error.code).toBe(OwnershipErrorCode.TRANSFER_FAILED);
            }

            // Original token still valid
            const validation = await ownershipManager.validateFencingToken(taskId, validToken);
            expect(validation.success).toBe(true);
            if (validation.success) {
              expect(validation.value.valid).toBe(true);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Property 3: Expired Lease Implies Token Invalid**
   * 
   * *For any* AI agent with an expired lease, the fencing token
   * SHALL be invalid. No operations should succeed with that token.
   * 
   * **Validates: Requirements R02.7, R02.8, R02.9**
   */
  describe('Property 3: Expired Lease → Token Invalid', () => {
    it('should invalidate token when AI agent lease expires', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          async (taskId, ownerId) => {
            // Use very short lease (1 second) and heartbeat (0.5 seconds)
            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              ownerId,
              {
                leaseDurationSeconds: 1,
                heartbeatIntervalSeconds: 1,
                heartbeatGraceMultiplier: 1, // Expires after 1 * 1 = 1 second without heartbeat
              }
            );

            // Claim as AI agent
            const claimResult = await ownershipManager.claimTask(taskId, ownerId, 'AI_AGENT');
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const fencingToken = claimResult.value.fencing_token;

            // Token should be valid immediately
            const immediateValidation = await ownershipManager.validateFencingToken(taskId, fencingToken);
            expect(immediateValidation.success).toBe(true);
            if (immediateValidation.success) {
              expect(immediateValidation.value.valid).toBe(true);
            }

            // Wait for lease to expire (longer than grace period)
            await new Promise(resolve => setTimeout(resolve, 2500));

            // Token should now be invalid due to expired lease
            const expiredValidation = await ownershipManager.validateFencingToken(taskId, fencingToken);
            expect(expiredValidation.success).toBe(true);
            if (expiredValidation.success) {
              expect(expiredValidation.value.valid).toBe(false);
              expect(expiredValidation.value.invalid_reason).toBe('TOKEN_EXPIRED');
            }
          }
        ),
        { numRuns: 5 } // Fewer runs due to timeouts
      );
    });

    it('should keep token valid if heartbeat is sent before expiry', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          async (taskId, ownerId) => {
            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              ownerId,
              {
                leaseDurationSeconds: 2,
                heartbeatIntervalSeconds: 1,
                heartbeatGraceMultiplier: 2,
              }
            );

            // Claim as AI agent
            const claimResult = await ownershipManager.claimTask(taskId, ownerId, 'AI_AGENT');
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const fencingToken = claimResult.value.fencing_token;

            // Wait a bit but not long enough to expire
            await new Promise(resolve => setTimeout(resolve, 500));

            // Send heartbeat
            const heartbeatResult = await ownershipManager.recordHeartbeat(taskId, fencingToken);
            expect(heartbeatResult.success).toBe(true);

            // Wait again
            await new Promise(resolve => setTimeout(resolve, 500));

            // Token should still be valid due to heartbeat
            const validation = await ownershipManager.validateFencingToken(taskId, fencingToken);
            expect(validation.success).toBe(true);
            if (validation.success) {
              expect(validation.value.valid).toBe(true);
            }
          }
        ),
        { numRuns: 5 } // Fewer runs due to timeouts
      );
    });

    it('should not have lease expiry for HUMAN actor type', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          async (taskId, ownerId) => {
            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              ownerId,
              {
                leaseDurationSeconds: 1, // Short lease, but should not apply to humans
                heartbeatIntervalSeconds: 1,
                heartbeatGraceMultiplier: 1,
              }
            );

            // Claim as HUMAN
            const claimResult = await ownershipManager.claimTask(taskId, ownerId, 'HUMAN');
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const fencingToken = claimResult.value.fencing_token;

            // Human should not have lease info
            expect(claimResult.value.lease).toBeUndefined();

            // Wait past what would be lease expiry for AI
            await new Promise(resolve => setTimeout(resolve, 2500));

            // Token should still be valid for human
            const validation = await ownershipManager.validateFencingToken(taskId, fencingToken);
            expect(validation.success).toBe(true);
            if (validation.success) {
              expect(validation.value.valid).toBe(true);
              // Human has no time remaining (null)
              expect(validation.value.time_remaining_seconds).toBeNull();
            }
          }
        ),
        { numRuns: 3 } // Fewer runs due to timeouts
      );
    });
  });

  /**
   * **Property 4: Token Uniqueness (UUID v4)**
   * 
   * *For any* claim operation, the generated fencing token SHALL be
   * a valid UUID v4 and unique across all claims.
   * 
   * **Validates: Requirements R02.5**
   */
  describe('Property 4: Token Uniqueness (UUID v4)', () => {
    it('should generate valid UUID v4 tokens on every claim', () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              taskId: taskIdArb,
              ownerId: ownerIdArb,
              actorType: actorTypeArb,
            }),
            { minLength: 5, maxLength: 20 }
          ),
          async (operations) => {
            const tokens: string[] = [];

            for (const op of operations) {
              const { ownershipManager } = await createTestOwnershipManager(
                tempHelper,
                op.ownerId
              );

              const claimResult = await ownershipManager.claimTask(op.taskId, op.ownerId, op.actorType);
              expect(claimResult.success).toBe(true);
              if (!claimResult.success) continue;

              const token = claimResult.value.fencing_token;

              // Verify UUID v4 format
              expect(isValidFencingToken(token)).toBe(true);

              // UUID v4 specific checks
              const uuidParts = token.split('-');
              expect(uuidParts.length).toBe(5);
              expect(uuidParts[0].length).toBe(8);
              expect(uuidParts[1].length).toBe(4);
              expect(uuidParts[2].length).toBe(4);
              expect(uuidParts[2][0]).toBe('4'); // Version 4
              expect(uuidParts[3].length).toBe(4);
              expect(['8', '9', 'a', 'b']).toContain(uuidParts[3][0].toLowerCase()); // Variant
              expect(uuidParts[4].length).toBe(12);

              tokens.push(token);
            }

            // All tokens should be unique
            const uniqueTokens = new Set(tokens);
            expect(uniqueTokens.size).toBe(tokens.length);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should generate unique tokens across transfers', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          fc.array(ownerIdArb, { minLength: 3, maxLength: 8 }),
          async (taskId, ownerIds) => {
            const uniqueOwners = [...new Set(ownerIds)];
            if (uniqueOwners.length < 3) return;

            const { ownershipManager } = await createTestOwnershipManager(
              tempHelper,
              uniqueOwners[0]
            );

            const tokens: string[] = [];

            // Initial claim
            const claimResult = await ownershipManager.claimTask(taskId, uniqueOwners[0], 'HUMAN');
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            tokens.push(claimResult.value.fencing_token);
            let currentToken = claimResult.value.fencing_token;

            // Transfer chain
            for (let i = 1; i < uniqueOwners.length; i++) {
              const transferResult = await ownershipManager.transferOwnership(
                taskId,
                currentToken,
                uniqueOwners[i],
                'HUMAN'
              );
              expect(transferResult.success).toBe(true);
              if (!transferResult.success) break;

              // Verify new token is valid UUID
              expect(isValidFencingToken(transferResult.value.new_fencing_token)).toBe(true);

              tokens.push(transferResult.value.new_fencing_token);
              currentToken = transferResult.value.new_fencing_token;
            }

            // All tokens unique
            const uniqueTokens = new Set(tokens);
            expect(uniqueTokens.size).toBe(tokens.length);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  /**
   * **Property 5: Ownership Consistency**
   * 
   * *For any* sequence of valid operations (claim, transfer, heartbeat),
   * the ownership state remains consistent.
   * 
   * **Validates: Requirements R02.3, R02.5, R02.6**
   */
  describe('Property 5: Ownership Consistency', () => {
    it('should maintain consistent state through claim and validation cycle', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          actorTypeArb,
          fc.integer({ min: 1, max: 10 }), // validation count
          async (taskId, ownerId, actorType, validationCount) => {
            const { ownershipManager, stateController } = await createTestOwnershipManager(
              tempHelper,
              ownerId
            );

            // Claim
            const claimResult = await ownershipManager.claimTask(taskId, ownerId, actorType);
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const fencingToken = claimResult.value.fencing_token;

            // Multiple validations should all succeed consistently
            for (let i = 0; i < validationCount; i++) {
              const validation = await ownershipManager.validateFencingToken(taskId, fencingToken);
              expect(validation.success).toBe(true);
              if (validation.success) {
                expect(validation.value.valid).toBe(true);
              }
            }

            // State should reflect ownership
            const stateResult = await stateController.readState();
            expect(stateResult.success).toBe(true);
            if (stateResult.success) {
              expect(stateResult.value.state.current_task?.id).toBe(taskId);
              expect(stateResult.value.state.current_task?.assignee).toBe(ownerId);
              expect(stateResult.value.state.current_task?.ownership?.fencing_token).toBe(fencingToken);
              expect(stateResult.value.state.current_task?.ownership?.actor_type).toBe(actorType);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain consistent state through heartbeat cycle for AI agent', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          fc.integer({ min: 1, max: 5 }), // heartbeat count
          async (taskId, ownerId, heartbeatCount) => {
            const { ownershipManager, stateController } = await createTestOwnershipManager(
              tempHelper,
              ownerId,
              {
                leaseDurationSeconds: 60,
                heartbeatIntervalSeconds: 10,
              }
            );

            // Claim as AI agent
            const claimResult = await ownershipManager.claimTask(taskId, ownerId, 'AI_AGENT');
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const fencingToken = claimResult.value.fencing_token;

            // Multiple heartbeats should succeed
            for (let i = 0; i < heartbeatCount; i++) {
              const heartbeatResult = await ownershipManager.recordHeartbeat(taskId, fencingToken);
              expect(heartbeatResult.success).toBe(true);

              // Token should remain valid after each heartbeat
              const validation = await ownershipManager.validateFencingToken(taskId, fencingToken);
              expect(validation.success).toBe(true);
              if (validation.success) {
                expect(validation.value.valid).toBe(true);
              }
            }

            // State should reflect AI agent ownership
            const stateResult = await stateController.readState();
            expect(stateResult.success).toBe(true);
            if (stateResult.success) {
              const ownership = stateResult.value.state.current_task?.ownership;
              expect(ownership?.fencing_token).toBe(fencingToken);
              expect(ownership?.actor_type).toBe('AI_AGENT');
              expect(ownership?.last_heartbeat_at).toBeTruthy();
              expect(ownership?.lease_expires_at).toBeTruthy();
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should prevent operations after lease expiry check marks task abandoned', () => {
      fc.assert(
        fc.asyncProperty(
          taskIdArb,
          ownerIdArb,
          async (taskId, ownerId) => {
            const { ownershipManager, stateController } = await createTestOwnershipManager(
              tempHelper,
              ownerId,
              {
                leaseDurationSeconds: 1,
                heartbeatIntervalSeconds: 1,
                heartbeatGraceMultiplier: 1,
              }
            );

            // Claim as AI agent
            const claimResult = await ownershipManager.claimTask(taskId, ownerId, 'AI_AGENT');
            expect(claimResult.success).toBe(true);
            if (!claimResult.success) return;

            const fencingToken = claimResult.value.fencing_token;

            // Wait for lease to expire
            await new Promise(resolve => setTimeout(resolve, 2500));

            // Check expired leases - should mark task as abandoned
            const expiredResult = await ownershipManager.checkExpiredLeases();
            expect(expiredResult.success).toBe(true);
            if (expiredResult.success) {
              expect(expiredResult.value.expired_tasks).toContain(taskId);
            }

            // State should show task as abandoned with cleared ownership
            const stateResult = await stateController.readState();
            expect(stateResult.success).toBe(true);
            if (stateResult.success) {
              expect(stateResult.value.state.current_task?.status).toBe('ABANDONED');
              expect(stateResult.value.state.current_task?.ownership).toBeNull();
            }

            // Heartbeat should fail with expired token
            const heartbeatResult = await ownershipManager.recordHeartbeat(taskId, fencingToken);
            expect(heartbeatResult.success).toBe(false);
          }
        ),
        { numRuns: 3 } // Fewer runs due to timeouts
      );
    });
  });

  /**
   * **Additional Property: generateFencingToken() Always Returns Valid UUID**
   * 
   * The utility function should always generate valid UUID v4 tokens.
   */
  describe('Utility: generateFencingToken()', () => {
    it('should always generate valid UUID v4', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // count
          (count) => {
            const tokens: string[] = [];

            for (let i = 0; i < count; i++) {
              const token = generateFencingToken();
              
              // Valid UUID format
              expect(isValidFencingToken(token)).toBe(true);
              
              // UUID v4 structure
              const parts = token.split('-');
              expect(parts.length).toBe(5);
              expect(parts[2][0]).toBe('4'); // Version 4
              expect(['8', '9', 'a', 'b']).toContain(parts[3][0].toLowerCase());

              tokens.push(token);
            }

            // All unique
            expect(new Set(tokens).size).toBe(count);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Additional Property: isValidFencingToken() Correctly Validates**
   */
  describe('Utility: isValidFencingToken()', () => {
    it('should accept valid UUID v4 strings', () => {
      fc.assert(
        fc.property(
          fc.uuid().filter(u => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u)),
          (uuid) => {
            expect(isValidFencingToken(uuid)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject invalid strings', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string().filter(s => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)),
            fc.integer(),
            fc.constant(null),
            fc.constant(undefined),
            fc.constant({}),
            fc.constant([])
          ),
          (invalid) => {
            expect(isValidFencingToken(invalid)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
