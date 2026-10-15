/**
 * Unit Tests for Ownership_Manager - Task Claim Operations
 * 
 * These tests verify the FileOwnershipManager functionality including:
 * - claimTask() - Claim task with fencing token generation
 * - Atomic claim operations via State_Controller
 * - Ownership conflict detection
 * 
 * Following TDD methodology - tests written first to define expected behavior.
 * 
 * **Validates: Requirements R02.3, R02.5, R02.6**
 * 
 * Test Scenarios (Task T08):
 * 1. Claim unclaimed task → success with token
 * 2. Claim already claimed task → error
 * 3. Token is valid UUID v4
 * 4. Ownership metadata recorded correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  OwnershipManager,
  OwnershipError,
  OwnershipErrorCode,
  FencingToken,
  ClaimResult,
  ClaimTaskResult,
  isValidFencingToken,
  OWNERSHIP_DEFAULTS,
} from '../ownership-manager';
import { FileOwnershipManager } from '../ownership-manager-impl';
import { FileStateController } from '../state-controller-impl';
import { ProjectState } from '../state-controller';

// =============================================================================
// Test Helper - Temporary File Management
// =============================================================================

class TempFileHelper {
  private tempDir: string = '';
  private files: string[] = [];

  async setup(): Promise<void> {
    this.tempDir = path.join(process.cwd(), '.test-temp', `ownership-manager-${Date.now()}`);
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
  }

  async createFile(filename: string, content: string): Promise<string> {
    const filePath = path.join(this.tempDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    this.files.push(filePath);
    return filePath;
  }

  getPath(filename: string): string {
    return path.join(this.tempDir, filename);
  }
}

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Creates a valid project state YAML with no current task (unclaimed state)
 */
const createUnclaimedState = () => `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "SYSTEM"
lifecycle:
  phase: IMPLEMENTATION
  phase_started_at: "2026-10-12T10:00:00Z"
team:
  members:
    - id: dev-001
      name: Developer One
      roles: [backend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
    - id: ai-agent-001
      name: AI Agent One
      roles: [backend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
  statistics:
    total_members: 2
    by_role:
      backend: 2
tasks:
  total: 3
  by_status:
    READY: 3
  by_assignee: {}
current_task: null
resource_locks: []
last_action: "Ready for task claim"
next_permitted_actions: ["CLAIM_TASK"]
`;

/**
 * Creates a project state with a task that is already claimed
 */
const createClaimedState = (ownerId: string = 'dev-001', fencingToken: string = '550e8400-e29b-41d4-a716-446655440000') => `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "${ownerId}"
lifecycle:
  phase: IMPLEMENTATION
  phase_started_at: "2026-10-12T10:00:00Z"
team:
  members:
    - id: dev-001
      name: Developer One
      roles: [backend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
    - id: dev-002
      name: Developer Two
      roles: [frontend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
  statistics:
    total_members: 2
    by_role:
      backend: 1
      frontend: 1
tasks:
  total: 3
  by_status:
    IN_PROGRESS: 1
    READY: 2
  by_assignee:
    ${ownerId}: 1
current_task:
  id: TASK-001
  status: IN_PROGRESS
  assignee: "${ownerId}"
  ownership:
    fencing_token: "${fencingToken}"
    acquired_at: "2026-10-12T10:00:00Z"
    actor_type: HUMAN
    lease_expires_at: null
    last_heartbeat_at: null
  dor_check: null
  tdd:
    phase: GREEN
    phase_started_at: "2026-10-12T10:30:00Z"
    not_applicable_reason: null
  blocked: false
  blocked_reason: null
  blocker_refs: []
  handoff_pending: false
  handoff_id: null
  working_branch: "task/TASK-001-impl"
resource_locks: []
last_action: "Task claimed"
next_permitted_actions: ["WORK_ON_TASK"]
`;

/**
 * UUID v4 regex pattern for validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Creates a project state with an AI agent whose lease has expired
 * (last heartbeat is more than 2x heartbeat interval ago)
 */
const createExpiredAIAgentState = () => {
  // Set last heartbeat to 10+ minutes ago (default heartbeat interval is 5 min, grace period is 2x)
  const now = new Date();
  const expiredHeartbeat = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes ago
  const leaseExpiry = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes ago (expired)
  
  return `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "${now.toISOString()}"
last_modified_by: "ai-agent-001"
lifecycle:
  phase: IMPLEMENTATION
  phase_started_at: "2026-10-12T10:00:00Z"
team:
  members:
    - id: ai-agent-001
      name: AI Agent One
      roles: [backend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
  statistics:
    total_members: 1
    by_role:
      backend: 1
tasks:
  total: 1
  by_status:
    IN_PROGRESS: 1
  by_assignee:
    ai-agent-001: 1
current_task:
  id: TASK-001
  status: IN_PROGRESS
  assignee: "ai-agent-001"
  ownership:
    fencing_token: "550e8400-e29b-41d4-a716-446655440000"
    acquired_at: "2026-10-12T10:00:00Z"
    actor_type: AI_AGENT
    lease_expires_at: "${leaseExpiry.toISOString()}"
    last_heartbeat_at: "${expiredHeartbeat.toISOString()}"
  dor_check: null
  tdd:
    phase: GREEN
    phase_started_at: "2026-10-12T10:30:00Z"
    not_applicable_reason: null
  blocked: false
  blocked_reason: null
  blocker_refs: []
  handoff_pending: false
  handoff_id: null
  working_branch: "task/TASK-001-impl"
resource_locks: []
last_action: "Task claimed"
next_permitted_actions: ["WORK_ON_TASK"]
`;
};

/**
 * Creates a project state with a task but no ownership (null ownership)
 */
const createStateWithTaskNoOwnership = () => `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "SYSTEM"
lifecycle:
  phase: IMPLEMENTATION
  phase_started_at: "2026-10-12T10:00:00Z"
team:
  members:
    - id: dev-001
      name: Developer One
      roles: [backend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
  statistics:
    total_members: 1
    by_role:
      backend: 1
tasks:
  total: 1
  by_status:
    ASSIGNED: 1
  by_assignee:
    dev-001: 1
current_task:
  id: TASK-001
  status: ASSIGNED
  assignee: "dev-001"
  ownership: null
  dor_check: null
  tdd: null
  blocked: false
  blocked_reason: null
  blocker_refs: []
  handoff_pending: false
  handoff_id: null
  working_branch: null
resource_locks: []
last_action: "Task assigned"
next_permitted_actions: ["START_WORK"]
`;

/**
 * Creates a project state with an AI agent lease in warning state
 * (lease expires within one heartbeat interval)
 */
const createAIAgentWarningState = () => {
  const now = new Date();
  // Lease expires in 2 minutes (less than 5 min heartbeat interval)
  const leaseExpiry = new Date(now.getTime() + 2 * 60 * 1000);
  // Last heartbeat was recent (within grace period)
  const lastHeartbeat = new Date(now.getTime() - 1 * 60 * 1000); // 1 minute ago
  
  return `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "${now.toISOString()}"
last_modified_by: "ai-agent-001"
lifecycle:
  phase: IMPLEMENTATION
  phase_started_at: "2026-10-12T10:00:00Z"
team:
  members:
    - id: ai-agent-001
      name: AI Agent One
      roles: [backend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
  statistics:
    total_members: 1
    by_role:
      backend: 1
tasks:
  total: 1
  by_status:
    IN_PROGRESS: 1
  by_assignee:
    ai-agent-001: 1
current_task:
  id: TASK-001
  status: IN_PROGRESS
  assignee: "ai-agent-001"
  ownership:
    fencing_token: "550e8400-e29b-41d4-a716-446655440000"
    acquired_at: "2026-10-12T10:00:00Z"
    actor_type: AI_AGENT
    lease_expires_at: "${leaseExpiry.toISOString()}"
    last_heartbeat_at: "${lastHeartbeat.toISOString()}"
  dor_check: null
  tdd:
    phase: GREEN
    phase_started_at: "2026-10-12T10:30:00Z"
    not_applicable_reason: null
  blocked: false
  blocked_reason: null
  blocker_refs: []
  handoff_pending: false
  handoff_id: null
  working_branch: "task/TASK-001-impl"
resource_locks: []
last_action: "Task claimed"
next_permitted_actions: ["WORK_ON_TASK"]
`;
};

// =============================================================================
// Unit Tests for claimTask()
// =============================================================================

describe('FileOwnershipManager', () => {
  let tempHelper: TempFileHelper;

  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  describe('claimTask()', () => {
    /**
     * Test: Claim unclaimed task succeeds with fencing token
     * **Validates: R02.3** - Atomic task claim operation
     * **Validates: R02.5** - Fencing token generated on claim
     */
    it('should successfully claim an unclaimed task with a new fencing token', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('unclaimed.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.fencing_token).toBeDefined();
        expect(result.value.acquired_at).toBeDefined();
        // Verify token is valid UUID v4
        expect(UUID_V4_REGEX.test(result.value.fencing_token)).toBe(true);
      }
    });

    /**
     * Test: Fencing token is valid UUID v4
     * **Validates: R02.5** - UUID v4 format for fencing token
     */
    it('should generate fencing token in UUID v4 format', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('uuid-test.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const token = result.value.fencing_token;
        // UUID v4 format: 8-4-4-4-12 hex digits with version 4 indicator
        expect(token).toMatch(UUID_V4_REGEX);
        // UUID v4 specific: character at position 14 should be '4'
        expect(token[14]).toBe('4');
        // UUID v4 specific: character at position 19 should be 8, 9, a, or b
        expect(['8', '9', 'a', 'b']).toContain(token[19].toLowerCase());
      }
    });

    /**
     * Test: Claim already claimed task fails with TASK_ALREADY_CLAIMED error
     * **Validates: R02.4** - Task already assigned rejection
     */
    it('should return TASK_ALREADY_CLAIMED error when task has active owner', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('claimed.yaml', createClaimedState('dev-001'));
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act - try to claim already claimed task
      const result = await ownershipManager.claimTask('TASK-001', 'dev-002', 'HUMAN');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(OwnershipErrorCode.TASK_ALREADY_CLAIMED);
        expect(result.error.category).toBe('OWNERSHIP_ERROR');
        expect(result.error.context?.current_owner).toBe('dev-001');
        expect(result.error.context?.owner_id).toBe('dev-002');
        expect(result.error.recoverable).toBe(false);
      }
    });

    /**
     * Test: Ownership metadata recorded with timestamp
     * **Validates: R02.5** - Ownership recorded with timestamp
     */
    it('should record ownership metadata with timestamp on successful claim', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('metadata.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      const beforeClaim = new Date();

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      const afterClaim = new Date();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Verify timestamp is within expected range
        const acquiredAt = new Date(result.value.acquired_at);
        expect(acquiredAt.getTime()).toBeGreaterThanOrEqual(beforeClaim.getTime());
        expect(acquiredAt.getTime()).toBeLessThanOrEqual(afterClaim.getTime());
      }

      // Verify state was updated
      const stateResult = await stateController.readState();
      expect(stateResult.success).toBe(true);
      if (stateResult.success && result.success) {
        const currentTask = stateResult.value.state.current_task;
        expect(currentTask).not.toBeNull();
        expect(currentTask?.ownership?.fencing_token).toBe(result.value.fencing_token);
        expect(currentTask?.ownership?.actor_type).toBe('HUMAN');
        expect(currentTask?.assignee).toBe('dev-001');
      }
    });

    /**
     * Test: Claim with HUMAN actor type - no lease
     * **Validates: R02.10** - Human developer not bound by lease timeout
     */
    it('should claim for HUMAN without lease info (no timeout)', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('human-claim.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // HUMAN should not have lease (lease field undefined or null)
        expect(result.value.lease).toBeUndefined();
      }

      // Verify in state
      const stateResult = await stateController.readState();
      expect(stateResult.success).toBe(true);
      if (stateResult.success) {
        const ownership = stateResult.value.state.current_task?.ownership;
        expect(ownership?.actor_type).toBe('HUMAN');
        expect(ownership?.lease_expires_at).toBeNull();
        expect(ownership?.last_heartbeat_at).toBeNull();
      }
    });

    /**
     * Test: Claim with AI_AGENT actor type - lease included
     * **Validates: R02.7** - AI Agent ownership has lease info
     */
    it('should claim for AI_AGENT with lease info (timeout enabled)', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('ai-claim.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      const beforeClaim = new Date();

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // AI_AGENT should have lease info
        expect(result.value.lease).toBeDefined();
        if (result.value.lease) {
          expect(result.value.lease.duration_seconds).toBe(OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS);
          expect(result.value.lease.heartbeat_interval_seconds).toBe(OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS);
          
          // Lease expires in the future
          const expiresAt = new Date(result.value.lease.lease_expires_at!);
          expect(expiresAt.getTime()).toBeGreaterThan(beforeClaim.getTime());
        }
      }

      // Verify in state
      const stateResult = await stateController.readState();
      expect(stateResult.success).toBe(true);
      if (stateResult.success) {
        const ownership = stateResult.value.state.current_task?.ownership;
        expect(ownership?.actor_type).toBe('AI_AGENT');
        expect(ownership?.lease_expires_at).not.toBeNull();
        expect(ownership?.last_heartbeat_at).not.toBeNull();
      }
    });

    /**
     * Test: Claim operation is atomic via State_Controller
     * **Validates: R02.3** - Task assignment is atomic
     */
    it('should perform atomic claim using State_Controller versioning', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('atomic.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Get initial version
      const initialState = await stateController.readState();
      expect(initialState.success).toBe(true);
      if (!initialState.success) return;
      const initialVersion = initialState.value.version;

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      // Assert - version should be incremented (atomic write occurred)
      expect(result.success).toBe(true);
      const afterState = await stateController.readState();
      expect(afterState.success).toBe(true);
      if (afterState.success) {
        expect(afterState.value.version).toBe(initialVersion + 1);
      }
    });

    /**
     * Test: Multiple unique fencing tokens generated for sequential claims
     * **Validates: R02.5** - Each ownership period has unique fencing token
     */
    it('should generate unique fencing tokens for different claims', async () => {
      // Arrange
      const statePath1 = await tempHelper.createFile('unique1.yaml', createUnclaimedState());
      const statePath2 = await tempHelper.createFile('unique2.yaml', createUnclaimedState());
      
      const stateController1 = new FileStateController({ projectStatePath: statePath1 });
      const stateController2 = new FileStateController({ projectStatePath: statePath2 });
      
      const ownershipManager1 = new FileOwnershipManager({ stateController: stateController1 });
      const ownershipManager2 = new FileOwnershipManager({ stateController: stateController2 });

      // Act - claim in two separate instances
      const result1 = await ownershipManager1.claimTask('TASK-001', 'dev-001', 'HUMAN');
      const result2 = await ownershipManager2.claimTask('TASK-002', 'dev-002', 'HUMAN');

      // Assert - tokens should be unique
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.value.fencing_token).not.toBe(result2.value.fencing_token);
      }
    });

    /**
     * Test: Claim records correct task ID in state
     * **Validates: R02.5** - Ownership recorded correctly
     */
    it('should record correct task ID in current_task', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('task-id.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act
      const result = await ownershipManager.claimTask('TASK-XYZ-123', 'dev-001', 'HUMAN');

      // Assert
      expect(result.success).toBe(true);

      const stateResult = await stateController.readState();
      expect(stateResult.success).toBe(true);
      if (stateResult.success) {
        expect(stateResult.value.state.current_task?.id).toBe('TASK-XYZ-123');
      }
    });

    /**
     * Test: Same owner can claim different task after releasing
     * **Validates: R02.3** - Claim behavior after ownership changes
     */
    it('should allow owner to claim task when no active task exists', async () => {
      // Arrange - state with no current task
      const statePath = await tempHelper.createFile('no-task.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act - claim first task
      const result1 = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
      expect(result1.success).toBe(true);

      // Verify state has current_task set
      const stateAfterClaim = await stateController.readState();
      expect(stateAfterClaim.success).toBe(true);
      if (stateAfterClaim.success) {
        expect(stateAfterClaim.value.state.current_task?.id).toBe('TASK-001');
        expect(stateAfterClaim.value.state.current_task?.assignee).toBe('dev-001');
      }
    });

    /**
     * Test: Claim with custom lease configuration (for AI Agent)
     * **Validates: R02.7** - Configurable lease duration and heartbeat
     */
    it('should support custom lease configuration for AI_AGENT', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('custom-lease.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const customLeaseDuration = 7200; // 2 hours
      const customHeartbeatInterval = 600; // 10 minutes
      
      const ownershipManager = new FileOwnershipManager({ 
        stateController,
        leaseDurationSeconds: customLeaseDuration,
        heartbeatIntervalSeconds: customHeartbeatInterval,
      });

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');

      // Assert
      expect(result.success).toBe(true);
      if (result.success && result.value.lease) {
        expect(result.value.lease.duration_seconds).toBe(customLeaseDuration);
        expect(result.value.lease.heartbeat_interval_seconds).toBe(customHeartbeatInterval);
      }
    });

    /**
     * Test: Error when claiming with non-existent state file
     * **Validates: R02.3** - Proper error handling
     */
    it('should handle error when state file does not exist', async () => {
      // Arrange
      const statePath = tempHelper.getPath('non-existent.yaml');
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      // Assert - should fail with appropriate error
      expect(result.success).toBe(false);
      if (!result.success) {
        // The error could be CLAIM_FAILED or a state-related error
        expect(result.error.category).toBe('OWNERSHIP_ERROR');
      }
    });
  });

  describe('isValidFencingToken utility', () => {
    /**
     * Test: Valid UUID v4 tokens recognized
     */
    it('should return true for valid UUID v4 tokens', () => {
      const validTokens = [
        '550e8400-e29b-41d4-a716-446655440000',
        '6ba7b810-9dad-41d9-80b4-00c04fd430c8',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      ];

      for (const token of validTokens) {
        expect(isValidFencingToken(token)).toBe(true);
      }
    });

    /**
     * Test: Invalid tokens rejected
     */
    it('should return false for invalid tokens', () => {
      const invalidTokens = [
        'not-a-uuid',
        '550e8400-e29b-31d4-a716-446655440000', // Version 3, not 4
        '550e8400-e29b-41d4-c716-446655440000', // Invalid variant
        '550e8400-e29b-41d4-a716',              // Too short
        '',                                      // Empty
        null,                                    // Null
        undefined,                               // Undefined
        123,                                     // Number
        {},                                      // Object
      ];

      for (const token of invalidTokens) {
        expect(isValidFencingToken(token)).toBe(false);
      }
    });
  });

  describe('Concurrent claim scenarios', () => {
    /**
     * Test: Concurrent claims to same task - only one succeeds
     * **Validates: R02.3** - Atomic claim prevents concurrent ownership
     */
    it('should only allow one claim to succeed in concurrent scenario', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('concurrent.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act - attempt concurrent claims
      // In practice, these run sequentially but simulate the race condition
      const result1 = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
      const result2 = await ownershipManager.claimTask('TASK-001', 'dev-002', 'HUMAN');

      // Assert - first succeeds, second fails
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      if (!result2.success) {
        expect(result2.error.code).toBe(OwnershipErrorCode.TASK_ALREADY_CLAIMED);
      }
    });
  });

  describe('State consistency after claim', () => {
    /**
     * Test: State is consistent after successful claim
     * **Validates: R02.3, R02.5** - Atomic operation produces consistent state
     */
    it('should maintain state consistency after successful claim', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('consistency.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act
      const result = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
      expect(result.success).toBe(true);

      // Assert - verify full state consistency
      const stateResult = await stateController.readState();
      expect(stateResult.success).toBe(true);
      if (stateResult.success && result.success) {
        const state = stateResult.value.state;
        const currentTask = state.current_task;

        // Current task populated correctly
        expect(currentTask).not.toBeNull();
        expect(currentTask?.id).toBe('TASK-001');
        expect(currentTask?.assignee).toBe('dev-001');
        expect(currentTask?.status).toBe('IN_PROGRESS');

        // Ownership populated correctly
        expect(currentTask?.ownership).not.toBeNull();
        expect(currentTask?.ownership?.fencing_token).toBe(result.value.fencing_token);
        expect(currentTask?.ownership?.actor_type).toBe('HUMAN');

        // State version incremented
        expect(state.state_version).toBeGreaterThan(1);
        expect(state.last_modified_by).toBe('dev-001');
      }
    });
  });

  // ===========================================================================
  // Unit Tests for validateFencingToken() - T09
  // ===========================================================================

  describe('validateFencingToken()', () => {
    /**
     * Test: Valid token for HUMAN returns valid=true
     * **Validates: R02.6** - Valid token validation
     */
    it('should return valid=true for correct HUMAN fencing token', async () => {
      // Arrange - claim a task first
      const statePath = await tempHelper.createFile('valid-human.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
      expect(claimResult.success).toBe(true);
      if (!claimResult.success) return;

      // Act - validate the token
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-001',
        claimResult.value.fencing_token
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(true);
        expect(validateResult.value.time_remaining_seconds).toBeNull(); // HUMAN has no lease
        expect(validateResult.value.warning).toBe(false);
      }
    });

    /**
     * Test: Valid token for AI_AGENT returns valid=true with time remaining
     * **Validates: R02.6** - Valid token validation for AI agent with lease info
     */
    it('should return valid=true with time remaining for AI_AGENT fencing token', async () => {
      // Arrange - claim a task as AI agent
      const statePath = await tempHelper.createFile('valid-ai.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      const claimResult = await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');
      expect(claimResult.success).toBe(true);
      if (!claimResult.success) return;

      // Act - validate the token
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-001',
        claimResult.value.fencing_token
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(true);
        expect(validateResult.value.time_remaining_seconds).not.toBeNull();
        expect(validateResult.value.time_remaining_seconds).toBeGreaterThan(0);
        expect(validateResult.value.warning).toBe(false); // Not yet in warning state
      }
    });

    /**
     * Test: Invalid token format returns valid=false with TOKEN_FORMAT_INVALID
     * **Validates: R02.6** - Invalid token format detection
     */
    it('should return valid=false for invalid token format', async () => {
      // Arrange - claim a task first
      const statePath = await tempHelper.createFile('invalid-format.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      // Act - validate with invalid token format
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-001',
        'not-a-valid-uuid'
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(false);
        expect(validateResult.value.invalid_reason).toBe('TOKEN_FORMAT_INVALID');
      }
    });

    /**
     * Test: Wrong token (different UUID) returns valid=false with OWNERSHIP_MISMATCH
     * **Validates: R02.6** - Token must match current ownership
     */
    it('should return valid=false for wrong fencing token', async () => {
      // Arrange - claim a task first
      const statePath = await tempHelper.createFile('wrong-token.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

      // Act - validate with different but valid UUID
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-001',
        '550e8400-e29b-41d4-a716-446655440000' // Different UUID
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(false);
        expect(validateResult.value.invalid_reason).toBe('OWNERSHIP_MISMATCH');
      }
    });

    /**
     * Test: Task not found returns valid=false with TASK_NOT_FOUND
     * **Validates: R02.6** - Task existence check
     */
    it('should return valid=false when task does not exist', async () => {
      // Arrange - use unclaimed state (no current_task)
      const statePath = await tempHelper.createFile('no-task.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act - validate token for non-existent task
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-NONEXISTENT',
        '550e8400-e29b-41d4-a716-446655440000'
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(false);
        expect(validateResult.value.invalid_reason).toBe('TASK_NOT_FOUND');
      }
    });

    /**
     * Test: Different task ID returns valid=false with TASK_NOT_FOUND
     * **Validates: R02.6** - Task ID must match
     */
    it('should return valid=false for wrong task ID', async () => {
      // Arrange - claim TASK-001
      const statePath = await tempHelper.createFile('wrong-task.yaml', createUnclaimedState());
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
      expect(claimResult.success).toBe(true);
      if (!claimResult.success) return;

      // Act - validate token with different task ID
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-002',  // Different task ID
        claimResult.value.fencing_token
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(false);
        expect(validateResult.value.invalid_reason).toBe('TASK_NOT_FOUND');
      }
    });

    /**
     * Test: Expired AI agent lease returns valid=false with TOKEN_EXPIRED
     * **Validates: R02.6, R02.8** - Expired token detection for AI agent
     */
    it('should return valid=false for expired AI agent lease', async () => {
      // Arrange - create state with expired lease
      const expiredLeaseState = createExpiredAIAgentState();
      const statePath = await tempHelper.createFile('expired-lease.yaml', expiredLeaseState);
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act - validate the expired token
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-001',
        '550e8400-e29b-41d4-a716-446655440000'  // Token in the expired state
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(false);
        expect(validateResult.value.invalid_reason).toBe('TOKEN_EXPIRED');
      }
    });

    /**
     * Test: No ownership returns valid=false with TOKEN_NOT_FOUND
     * **Validates: R02.6** - Ownership must exist
     */
    it('should return valid=false when task has no ownership', async () => {
      // Arrange - create state with task but no ownership
      const noOwnershipState = createStateWithTaskNoOwnership();
      const statePath = await tempHelper.createFile('no-ownership.yaml', noOwnershipState);
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act - validate token
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-001',
        '550e8400-e29b-41d4-a716-446655440000'
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(false);
        expect(validateResult.value.invalid_reason).toBe('TOKEN_NOT_FOUND');
      }
    });

    /**
     * Test: AI agent in warning state returns valid=true with warning=true
     * **Validates: R02.6, R02.7** - Warning state detection
     */
    it('should return warning=true when AI agent lease is close to expiry', async () => {
      // Arrange - create state with lease close to expiry (within heartbeat interval)
      const warningState = createAIAgentWarningState();
      const statePath = await tempHelper.createFile('warning-lease.yaml', warningState);
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act - validate the token
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-001',
        '550e8400-e29b-41d4-a716-446655440000'  // Token in the warning state
      );

      // Assert
      expect(validateResult.success).toBe(true);
      if (validateResult.success) {
        expect(validateResult.value.valid).toBe(true);
        expect(validateResult.value.warning).toBe(true);
        // Time remaining should be less than heartbeat interval
        expect(validateResult.value.time_remaining_seconds).not.toBeNull();
        if (validateResult.value.time_remaining_seconds !== null) {
          expect(validateResult.value.time_remaining_seconds).toBeLessThanOrEqual(OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS);
        }
      }
    });

    /**
     * Test: Error reading state results in failure
     * **Validates: R02.6** - Error handling
     */
    it('should return error when state file does not exist', async () => {
      // Arrange
      const statePath = tempHelper.getPath('non-existent.yaml');
      const stateController = new FileStateController({ projectStatePath: statePath });
      const ownershipManager = new FileOwnershipManager({ stateController });

      // Act
      const validateResult = await ownershipManager.validateFencingToken(
        'TASK-001',
        '550e8400-e29b-41d4-a716-446655440000'
      );

      // Assert
      expect(validateResult.success).toBe(false);
      if (!validateResult.success) {
        expect(validateResult.error.category).toBe('OWNERSHIP_ERROR');
      }
    });
  });
});


// =============================================================================
// Unit Tests for recordHeartbeat() - T10
// =============================================================================

describe('recordHeartbeat()', () => {
  let tempHelper: TempFileHelper;

  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  /**
   * Test: Heartbeat successfully updates last_heartbeat_at
   * **Validates: R02.7** - Heartbeat updates timestamp
   */
  it('should update last_heartbeat_at on successful heartbeat', async () => {
    // Arrange - claim task as AI agent first
    const statePath = await tempHelper.createFile('heartbeat.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    const beforeHeartbeat = new Date();

    // Act - record heartbeat
    const heartbeatResult = await ownershipManager.recordHeartbeat(
      'TASK-001',
      claimResult.value.fencing_token
    );

    const afterHeartbeat = new Date();

    // Assert
    expect(heartbeatResult.success).toBe(true);
    if (heartbeatResult.success) {
      expect(heartbeatResult.value.time_remaining_seconds).toBeGreaterThan(0);
      expect(heartbeatResult.value.warning).toBe(false);
    }

    // Verify in state
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success) {
      const ownership = stateResult.value.state.current_task?.ownership;
      expect(ownership?.last_heartbeat_at).toBeDefined();
      if (ownership?.last_heartbeat_at) {
        const lastHeartbeat = new Date(ownership.last_heartbeat_at);
        expect(lastHeartbeat.getTime()).toBeGreaterThanOrEqual(beforeHeartbeat.getTime());
        expect(lastHeartbeat.getTime()).toBeLessThanOrEqual(afterHeartbeat.getTime());
      }
    }
  });

  /**
   * Test: Heartbeat fails with invalid token format
   * **Validates: R02.6** - Invalid token rejected
   */
  it('should fail heartbeat with invalid token format', async () => {
    // Arrange
    const statePath = await tempHelper.createFile('invalid-heartbeat.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');

    // Act - heartbeat with invalid token
    const heartbeatResult = await ownershipManager.recordHeartbeat(
      'TASK-001',
      'not-a-valid-uuid'
    );

    // Assert
    expect(heartbeatResult.success).toBe(false);
    if (!heartbeatResult.success) {
      expect(heartbeatResult.error.code).toBe(OwnershipErrorCode.INVALID_FENCING_TOKEN);
    }
  });

  /**
   * Test: Heartbeat fails with mismatched fencing token
   * **Validates: R02.6** - Token must match
   */
  it('should fail heartbeat with mismatched fencing token', async () => {
    // Arrange
    const statePath = await tempHelper.createFile('mismatch-heartbeat.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');

    // Act - heartbeat with different valid UUID
    const heartbeatResult = await ownershipManager.recordHeartbeat(
      'TASK-001',
      '550e8400-e29b-41d4-a716-446655440000'
    );

    // Assert
    expect(heartbeatResult.success).toBe(false);
    if (!heartbeatResult.success) {
      expect(heartbeatResult.error.code).toBe(OwnershipErrorCode.HEARTBEAT_FAILED);
      expect(heartbeatResult.error.context?.details).toContain('mismatch');
    }
  });

  /**
   * Test: Heartbeat fails for HUMAN actor (not applicable)
   * **Validates: R02.10** - Humans don't need heartbeat
   */
  it('should fail heartbeat for HUMAN actor', async () => {
    // Arrange - claim task as HUMAN
    const statePath = await tempHelper.createFile('human-heartbeat.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Act - try heartbeat on human-owned task
    const heartbeatResult = await ownershipManager.recordHeartbeat(
      'TASK-001',
      claimResult.value.fencing_token
    );

    // Assert
    expect(heartbeatResult.success).toBe(false);
    if (!heartbeatResult.success) {
      expect(heartbeatResult.error.code).toBe(OwnershipErrorCode.HEARTBEAT_FAILED);
      expect(heartbeatResult.error.context?.details).toContain('AI agents');
    }
  });

  /**
   * Test: Heartbeat fails with expired lease
   * **Validates: R02.8** - Expired lease rejected
   */
  it('should fail heartbeat when lease has expired', async () => {
    // Arrange - create state with expired AI agent lease
    const expiredLeaseState = createExpiredAIAgentState();
    const statePath = await tempHelper.createFile('expired-heartbeat.yaml', expiredLeaseState);
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act - try heartbeat on expired lease
    const heartbeatResult = await ownershipManager.recordHeartbeat(
      'TASK-001',
      '550e8400-e29b-41d4-a716-446655440000'
    );

    // Assert
    expect(heartbeatResult.success).toBe(false);
    if (!heartbeatResult.success) {
      expect(heartbeatResult.error.code).toBe(OwnershipErrorCode.LEASE_EXPIRED);
    }
  });

  /**
   * Test: Heartbeat extends lease when close to expiry
   * **Validates: R02.7** - Lease extension on heartbeat
   */
  it('should extend lease when heartbeat is received close to expiry', async () => {
    // Arrange - create state with lease in warning state
    const warningState = createAIAgentWarningState();
    const statePath = await tempHelper.createFile('extend-heartbeat.yaml', warningState);
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Get original expiry time
    const initialState = await stateController.readState();
    expect(initialState.success).toBe(true);
    if (!initialState.success) return;
    const originalExpiry = initialState.value.state.current_task?.ownership?.lease_expires_at;
    expect(originalExpiry).toBeDefined();

    // Act - heartbeat (should extend lease)
    const heartbeatResult = await ownershipManager.recordHeartbeat(
      'TASK-001',
      '550e8400-e29b-41d4-a716-446655440000'
    );

    // Assert
    expect(heartbeatResult.success).toBe(true);
    if (heartbeatResult.success) {
      expect(heartbeatResult.value.lease_extended).toBe(true);
      expect(heartbeatResult.value.new_expires_at).toBeDefined();
      
      // New expiry should be later than original
      if (originalExpiry && heartbeatResult.value.new_expires_at) {
        const newExpiry = new Date(heartbeatResult.value.new_expires_at);
        const oldExpiry = new Date(originalExpiry);
        expect(newExpiry.getTime()).toBeGreaterThan(oldExpiry.getTime());
      }
    }
  });

  /**
   * Test: Heartbeat returns warning state when lease is close to expiry
   * **Validates: R02.7** - Warning state detection
   */
  it('should return warning=true when lease is close to expiry but not yet extended', async () => {
    // Arrange - claim with short lease duration, wait briefly
    const statePath = await tempHelper.createFile('warning-heartbeat.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    
    // Use very short intervals for testing
    const ownershipManager = new FileOwnershipManager({ 
      stateController,
      leaseDurationSeconds: 60, // 1 minute
      heartbeatIntervalSeconds: 30, // 30 seconds
    });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Modify state to simulate being close to expiry (manually update lease)
    await stateController.updateState(
      (state) => {
        if (state.current_task?.ownership) {
          const now = new Date();
          // Set expiry to be within heartbeat interval (20 seconds from now)
          const expiry = new Date(now.getTime() + 20 * 1000);
          return {
            ...state,
            current_task: {
              ...state.current_task,
              ownership: {
                ...state.current_task.ownership,
                lease_expires_at: expiry.toISOString(),
              },
            },
          };
        }
        return state;
      },
      'test-modify-lease',
      'Test modification to simulate warning state'
    );

    // Act - heartbeat
    const heartbeatResult = await ownershipManager.recordHeartbeat(
      'TASK-001',
      claimResult.value.fencing_token
    );

    // Assert - should succeed and extend
    expect(heartbeatResult.success).toBe(true);
    if (heartbeatResult.success) {
      // Lease should be extended since we were in warning state
      expect(heartbeatResult.value.lease_extended).toBe(true);
    }
  });

  /**
   * Test: Heartbeat fails for non-existent task
   * **Validates: R02.7** - Task existence check
   */
  it('should fail heartbeat for non-existent task', async () => {
    // Arrange - use unclaimed state (no current task)
    const statePath = await tempHelper.createFile('no-task-heartbeat.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act - heartbeat for non-existent task
    const heartbeatResult = await ownershipManager.recordHeartbeat(
      'TASK-NONEXISTENT',
      '550e8400-e29b-41d4-a716-446655440000'
    );

    // Assert
    expect(heartbeatResult.success).toBe(false);
    if (!heartbeatResult.success) {
      expect(heartbeatResult.error.code).toBe(OwnershipErrorCode.HEARTBEAT_FAILED);
    }
  });
});

// =============================================================================
// Unit Tests for checkExpiredLeases() - T10
// =============================================================================

describe('checkExpiredLeases()', () => {
  let tempHelper: TempFileHelper;

  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  /**
   * Test: No expired leases when all are valid
   * **Validates: R02.8** - Valid leases not expired
   */
  it('should return empty list when no leases are expired', async () => {
    // Arrange - claim fresh task as AI agent
    const statePath = await tempHelper.createFile('no-expired.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');

    // Act
    const result = await ownershipManager.checkExpiredLeases();

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.expired_tasks).toHaveLength(0);
      expect(result.value.details).toHaveLength(0);
    }
  });

  /**
   * Test: Detect and handle expired AI agent lease
   * **Validates: R02.8, R02.9** - Expired lease detection and ABANDONED marking
   */
  it('should detect expired lease and mark task as ABANDONED', async () => {
    // Arrange - create state with expired AI agent lease
    const expiredLeaseState = createExpiredAIAgentState();
    const statePath = await tempHelper.createFile('expired-lease-check.yaml', expiredLeaseState);
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act
    const result = await ownershipManager.checkExpiredLeases();

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.expired_tasks).toContain('TASK-001');
      expect(result.value.details).toHaveLength(1);
      expect(result.value.details[0].task_id).toBe('TASK-001');
      expect(result.value.details[0].owner_id).toBe('ai-agent-001');
      expect(result.value.details[0].fencing_token).toBe('550e8400-e29b-41d4-a716-446655440000');
    }

    // Verify task is marked as ABANDONED
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success) {
      expect(stateResult.value.state.current_task?.status).toBe('ABANDONED');
      expect(stateResult.value.state.current_task?.ownership).toBeNull();
    }
  });

  /**
   * Test: Human-owned tasks never expire
   * **Validates: R02.10** - Human not bound by lease timeout
   */
  it('should not expire human-owned tasks', async () => {
    // Arrange - create state with human ownership
    const humanState = createClaimedState('dev-001');
    const statePath = await tempHelper.createFile('human-no-expire.yaml', humanState);
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act
    const result = await ownershipManager.checkExpiredLeases();

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.expired_tasks).toHaveLength(0);
    }

    // Verify task status unchanged
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success) {
      expect(stateResult.value.state.current_task?.status).toBe('IN_PROGRESS');
      expect(stateResult.value.state.current_task?.ownership).not.toBeNull();
    }
  });

  /**
   * Test: No tasks to check when state has no current task
   * **Validates: R02.8** - Graceful handling of empty state
   */
  it('should return empty when no current task exists', async () => {
    // Arrange - use unclaimed state
    const statePath = await tempHelper.createFile('no-task-expire.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act
    const result = await ownershipManager.checkExpiredLeases();

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.expired_tasks).toHaveLength(0);
    }
  });

  /**
   * Test: Expired lease includes correct detail information
   * **Validates: R02.9** - Expiry recorded with details
   */
  it('should include correct detail information for expired lease', async () => {
    // Arrange
    const expiredLeaseState = createExpiredAIAgentState();
    const statePath = await tempHelper.createFile('detail-check.yaml', expiredLeaseState);
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act
    const result = await ownershipManager.checkExpiredLeases();

    // Assert
    expect(result.success).toBe(true);
    if (result.success && result.value.details.length > 0) {
      const detail = result.value.details[0];
      expect(detail.task_id).toBe('TASK-001');
      expect(detail.owner_id).toBe('ai-agent-001');
      expect(detail.expired_at).toBeDefined();
      expect(detail.last_heartbeat_at).toBeDefined();
      expect(detail.fencing_token).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });
});


// =============================================================================
// Unit Tests for transferOwnership() - T11
// =============================================================================

describe('transferOwnership()', () => {
  let tempHelper: TempFileHelper;

  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  /**
   * Test: Successful transfer between two humans
   * **Validates: R02.6, R08.2** - Atomic ownership transfer
   */
  it('should successfully transfer ownership between two humans', async () => {
    // Arrange - claim task as human first
    const statePath = await tempHelper.createFile('transfer-human.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    const originalToken = claimResult.value.fencing_token;

    // Act - transfer to another human
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      originalToken,
      'dev-002',
      'HUMAN'
    );

    // Assert
    expect(transferResult.success).toBe(true);
    if (transferResult.success) {
      expect(transferResult.value.new_fencing_token).toBeDefined();
      expect(transferResult.value.new_fencing_token).not.toBe(originalToken); // New token issued
      expect(transferResult.value.old_fencing_token).toBe(originalToken);
      expect(transferResult.value.transferred_at).toBeDefined();
      expect(transferResult.value.new_lease).toBeUndefined(); // HUMAN doesn't have lease
    }

    // Verify state updated correctly
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success && transferResult.success) {
      const currentTask = stateResult.value.state.current_task;
      expect(currentTask?.assignee).toBe('dev-002');
      expect(currentTask?.ownership?.fencing_token).toBe(transferResult.value.new_fencing_token);
      expect(currentTask?.ownership?.actor_type).toBe('HUMAN');
      expect(currentTask?.ownership?.lease_expires_at).toBeNull();
    }
  });

  /**
   * Test: Successful transfer from human to AI agent
   * **Validates: R02.6, R02.7, R08.2** - Transfer with lease creation for AI
   */
  it('should successfully transfer ownership from human to AI agent with lease', async () => {
    // Arrange - claim task as human first
    const statePath = await tempHelper.createFile('transfer-to-ai.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    const beforeTransfer = new Date();

    // Act - transfer to AI agent
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'ai-agent-001',
      'AI_AGENT'
    );

    // Assert
    expect(transferResult.success).toBe(true);
    if (transferResult.success) {
      expect(transferResult.value.new_fencing_token).not.toBe(claimResult.value.fencing_token);
      expect(transferResult.value.new_lease).toBeDefined();
      if (transferResult.value.new_lease) {
        expect(transferResult.value.new_lease.duration_seconds).toBe(OWNERSHIP_DEFAULTS.LEASE_DURATION_SECONDS);
        expect(transferResult.value.new_lease.heartbeat_interval_seconds).toBe(OWNERSHIP_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS);
        
        // Lease expires in the future
        const expiresAt = new Date(transferResult.value.new_lease.lease_expires_at!);
        expect(expiresAt.getTime()).toBeGreaterThan(beforeTransfer.getTime());
      }
    }

    // Verify state updated correctly
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success) {
      const ownership = stateResult.value.state.current_task?.ownership;
      expect(ownership?.actor_type).toBe('AI_AGENT');
      expect(ownership?.lease_expires_at).not.toBeNull();
      expect(ownership?.last_heartbeat_at).not.toBeNull();
    }
  });

  /**
   * Test: Successful transfer from AI agent to human
   * **Validates: R02.6, R08.2** - Transfer removes lease for human target
   */
  it('should successfully transfer ownership from AI agent to human without lease', async () => {
    // Arrange - claim task as AI agent first
    const statePath = await tempHelper.createFile('transfer-to-human.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Act - transfer to human
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'dev-001',
      'HUMAN'
    );

    // Assert
    expect(transferResult.success).toBe(true);
    if (transferResult.success) {
      expect(transferResult.value.new_fencing_token).not.toBe(claimResult.value.fencing_token);
      expect(transferResult.value.new_lease).toBeUndefined(); // HUMAN doesn't get lease
    }

    // Verify state - human has no lease
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success) {
      const ownership = stateResult.value.state.current_task?.ownership;
      expect(ownership?.actor_type).toBe('HUMAN');
      expect(ownership?.lease_expires_at).toBeNull();
      expect(ownership?.last_heartbeat_at).toBeNull();
    }
  });

  /**
   * Test: Transfer between two AI agents
   * **Validates: R02.6, R02.7** - Transfer creates new lease for AI target
   */
  it('should successfully transfer ownership between two AI agents', async () => {
    // Arrange - claim task as AI agent first
    const statePath = await tempHelper.createFile('transfer-ai-to-ai.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'ai-agent-001', 'AI_AGENT');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Act - transfer to another AI agent
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'ai-agent-002',
      'AI_AGENT'
    );

    // Assert
    expect(transferResult.success).toBe(true);
    if (transferResult.success) {
      expect(transferResult.value.new_lease).toBeDefined();
    }

    // Verify new owner
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success) {
      expect(stateResult.value.state.current_task?.assignee).toBe('ai-agent-002');
      expect(stateResult.value.state.current_task?.ownership?.actor_type).toBe('AI_AGENT');
    }
  });

  /**
   * Test: Transfer fails with invalid source token format
   * **Validates: R02.6** - Invalid token format detection
   */
  it('should fail transfer with invalid source token format', async () => {
    // Arrange - claim task first
    const statePath = await tempHelper.createFile('transfer-invalid-format.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

    // Act - transfer with invalid token format
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      'not-a-valid-uuid',
      'dev-002',
      'HUMAN'
    );

    // Assert
    expect(transferResult.success).toBe(false);
    if (!transferResult.success) {
      expect(transferResult.error.code).toBe(OwnershipErrorCode.INVALID_FENCING_TOKEN);
    }
  });

  /**
   * Test: Transfer fails with wrong source token (different UUID)
   * **Validates: R02.6** - Token must match current ownership
   */
  it('should fail transfer with wrong source token', async () => {
    // Arrange - claim task first
    const statePath = await tempHelper.createFile('transfer-wrong-token.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');

    // Act - transfer with different valid UUID
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      '550e8400-e29b-41d4-a716-446655440000', // Different UUID
      'dev-002',
      'HUMAN'
    );

    // Assert
    expect(transferResult.success).toBe(false);
    if (!transferResult.success) {
      expect(transferResult.error.code).toBe(OwnershipErrorCode.TRANSFER_FAILED);
      expect(transferResult.error.context?.details).toContain('mismatch');
    }
  });

  /**
   * Test: Transfer fails with expired source token (AI agent)
   * **Validates: R02.6, R02.8** - Expired lease cannot transfer
   */
  it('should fail transfer when source AI agent lease has expired', async () => {
    // Arrange - create state with expired AI agent lease
    const expiredLeaseState = createExpiredAIAgentState();
    const statePath = await tempHelper.createFile('transfer-expired.yaml', expiredLeaseState);
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act - try to transfer with expired lease
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      '550e8400-e29b-41d4-a716-446655440000', // Token in the expired state
      'dev-001',
      'HUMAN'
    );

    // Assert
    expect(transferResult.success).toBe(false);
    if (!transferResult.success) {
      expect(transferResult.error.code).toBe(OwnershipErrorCode.LEASE_EXPIRED);
    }
  });

  /**
   * Test: Transfer fails for non-existent task
   * **Validates: R02.6** - Task existence check
   */
  it('should fail transfer for non-existent task', async () => {
    // Arrange - use unclaimed state (no current_task)
    const statePath = await tempHelper.createFile('transfer-no-task.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act - try to transfer non-existent task
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-NONEXISTENT',
      '550e8400-e29b-41d4-a716-446655440000',
      'dev-001',
      'HUMAN'
    );

    // Assert
    expect(transferResult.success).toBe(false);
    if (!transferResult.success) {
      expect(transferResult.error.code).toBe(OwnershipErrorCode.TRANSFER_FAILED);
    }
  });

  /**
   * Test: Transfer fails when task has no ownership
   * **Validates: R02.6** - Ownership must exist
   */
  it('should fail transfer when task has no ownership', async () => {
    // Arrange - create state with task but no ownership
    const noOwnershipState = createStateWithTaskNoOwnership();
    const statePath = await tempHelper.createFile('transfer-no-ownership.yaml', noOwnershipState);
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Act - try to transfer
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      '550e8400-e29b-41d4-a716-446655440000',
      'dev-001',
      'HUMAN'
    );

    // Assert
    expect(transferResult.success).toBe(false);
    if (!transferResult.success) {
      expect(transferResult.error.code).toBe(OwnershipErrorCode.TRANSFER_FAILED);
    }
  });

  /**
   * Test: Old token is invalidated after transfer
   * **Validates: R02.6** - Old token invalidation
   */
  it('should invalidate old fencing token after transfer', async () => {
    // Arrange - claim task as human first
    const statePath = await tempHelper.createFile('transfer-invalidate.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    const oldToken = claimResult.value.fencing_token;

    // Act - transfer
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      oldToken,
      'dev-002',
      'HUMAN'
    );
    expect(transferResult.success).toBe(true);

    // Assert - old token should now be invalid
    const validateResult = await ownershipManager.validateFencingToken('TASK-001', oldToken);
    expect(validateResult.success).toBe(true);
    if (validateResult.success) {
      expect(validateResult.value.valid).toBe(false);
      expect(validateResult.value.invalid_reason).toBe('OWNERSHIP_MISMATCH');
    }
  });

  /**
   * Test: New token is valid after transfer
   * **Validates: R02.6** - New token validity
   */
  it('should issue valid new fencing token after transfer', async () => {
    // Arrange - claim task as human first
    const statePath = await tempHelper.createFile('transfer-new-valid.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Act - transfer
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'dev-002',
      'HUMAN'
    );
    expect(transferResult.success).toBe(true);
    if (!transferResult.success) return;

    // Assert - new token should be valid
    const validateResult = await ownershipManager.validateFencingToken(
      'TASK-001',
      transferResult.value.new_fencing_token
    );
    expect(validateResult.success).toBe(true);
    if (validateResult.success) {
      expect(validateResult.value.valid).toBe(true);
    }
  });

  /**
   * Test: Transfer is atomic - state version incremented
   * **Validates: R02.3, R02.6** - Atomic operation
   */
  it('should perform atomic transfer with state version increment', async () => {
    // Arrange
    const statePath = await tempHelper.createFile('transfer-atomic.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Get version after claim
    const beforeTransfer = await stateController.readState();
    expect(beforeTransfer.success).toBe(true);
    if (!beforeTransfer.success) return;
    const versionBeforeTransfer = beforeTransfer.value.version;

    // Act - transfer
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'dev-002',
      'HUMAN'
    );
    expect(transferResult.success).toBe(true);

    // Assert - version should be incremented
    const afterTransfer = await stateController.readState();
    expect(afterTransfer.success).toBe(true);
    if (afterTransfer.success) {
      expect(afterTransfer.value.version).toBe(versionBeforeTransfer + 1);
    }
  });

  /**
   * Test: Transfer records timestamp
   * **Validates: R08.2** - Transfer timestamp recorded
   */
  it('should record transfer timestamp', async () => {
    // Arrange
    const statePath = await tempHelper.createFile('transfer-timestamp.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    const beforeTransfer = new Date();

    // Act - transfer
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'dev-002',
      'HUMAN'
    );

    const afterTransfer = new Date();

    // Assert
    expect(transferResult.success).toBe(true);
    if (transferResult.success) {
      const transferredAt = new Date(transferResult.value.transferred_at);
      expect(transferredAt.getTime()).toBeGreaterThanOrEqual(beforeTransfer.getTime());
      expect(transferredAt.getTime()).toBeLessThanOrEqual(afterTransfer.getTime());
    }
  });

  /**
   * Test: Transfer with handoff_id for Handoff_Coordinator integration
   * **Validates: R08.2** - Works with Handoff_Coordinator
   */
  it('should support handoff_id for Handoff_Coordinator integration', async () => {
    // Arrange
    const statePath = await tempHelper.createFile('transfer-handoff.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Act - transfer with handoff_id (using the extended method signature)
    // Note: The interface accepts an optional handoff_id parameter
    const transferResult = await (ownershipManager as any).transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'dev-002',
      'HUMAN',
      'HO-001' // handoff_id
    );

    // Assert
    expect(transferResult.success).toBe(true);

    // Verify handoff info in state
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success) {
      const currentTask = stateResult.value.state.current_task;
      expect(currentTask?.handoff_pending).toBe(true);
      expect(currentTask?.handoff_id).toBe('HO-001');
    }
  });

  /**
   * Test: Sequential transfers work correctly
   * **Validates: R02.6** - Multiple transfers work
   */
  it('should support sequential transfers between multiple owners', async () => {
    // Arrange
    const statePath = await tempHelper.createFile('transfer-sequential.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    // Initial claim by dev-001
    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // First transfer: dev-001 -> dev-002
    const transfer1 = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'dev-002',
      'HUMAN'
    );
    expect(transfer1.success).toBe(true);
    if (!transfer1.success) return;

    // Second transfer: dev-002 -> ai-agent-001
    const transfer2 = await ownershipManager.transferOwnership(
      'TASK-001',
      transfer1.value.new_fencing_token,
      'ai-agent-001',
      'AI_AGENT'
    );
    expect(transfer2.success).toBe(true);
    if (!transfer2.success) return;

    // Third transfer: ai-agent-001 -> dev-003
    const transfer3 = await ownershipManager.transferOwnership(
      'TASK-001',
      transfer2.value.new_fencing_token,
      'dev-003',
      'HUMAN'
    );
    expect(transfer3.success).toBe(true);

    // Verify final state
    const stateResult = await stateController.readState();
    expect(stateResult.success).toBe(true);
    if (stateResult.success && transfer3.success) {
      expect(stateResult.value.state.current_task?.assignee).toBe('dev-003');
      expect(stateResult.value.state.current_task?.ownership?.fencing_token).toBe(
        transfer3.value.new_fencing_token
      );
      expect(stateResult.value.state.current_task?.ownership?.actor_type).toBe('HUMAN');
    }
  });

  /**
   * Test: Transfer generates unique fencing tokens
   * **Validates: R02.5** - UUID v4 format
   */
  it('should generate unique UUID v4 fencing token on transfer', async () => {
    // Arrange
    const statePath = await tempHelper.createFile('transfer-uuid.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const ownershipManager = new FileOwnershipManager({ stateController });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Act
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'dev-002',
      'HUMAN'
    );

    // Assert - new token is valid UUID v4
    expect(transferResult.success).toBe(true);
    if (transferResult.success) {
      const newToken = transferResult.value.new_fencing_token;
      expect(UUID_V4_REGEX.test(newToken)).toBe(true);
      // UUID v4 specific checks
      expect(newToken[14]).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(newToken[19].toLowerCase());
    }
  });

  /**
   * Test: Transfer with custom lease configuration for AI agent
   * **Validates: R02.7** - Configurable lease
   */
  it('should support custom lease configuration when transferring to AI agent', async () => {
    // Arrange
    const statePath = await tempHelper.createFile('transfer-custom-lease.yaml', createUnclaimedState());
    const stateController = new FileStateController({ projectStatePath: statePath });
    const customLeaseDuration = 7200; // 2 hours
    const customHeartbeatInterval = 600; // 10 minutes
    
    const ownershipManager = new FileOwnershipManager({ 
      stateController,
      leaseDurationSeconds: customLeaseDuration,
      heartbeatIntervalSeconds: customHeartbeatInterval,
    });

    const claimResult = await ownershipManager.claimTask('TASK-001', 'dev-001', 'HUMAN');
    expect(claimResult.success).toBe(true);
    if (!claimResult.success) return;

    // Act - transfer to AI agent
    const transferResult = await ownershipManager.transferOwnership(
      'TASK-001',
      claimResult.value.fencing_token,
      'ai-agent-001',
      'AI_AGENT'
    );

    // Assert
    expect(transferResult.success).toBe(true);
    if (transferResult.success && transferResult.value.new_lease) {
      expect(transferResult.value.new_lease.duration_seconds).toBe(customLeaseDuration);
      expect(transferResult.value.new_lease.heartbeat_interval_seconds).toBe(customHeartbeatInterval);
    }
  });
});
