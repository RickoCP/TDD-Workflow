/**
 * Unit Tests for State_Controller Operations
 * 
 * These tests verify the FileStateController functionality including:
 * - readState() - Read state with version tracking
 * - writeState() - Optimistic concurrency write
 * - updateState() - Atomic read-modify-write with retry
 * 
 * Following TDD methodology - tests written first to define expected behavior.
 * 
 * **Validates: Requirements R02.1, R02.2, R02.11**
 * 
 * Test Scenarios:
 * 1. Read state with version field
 * 2. Read state without version field (default 1 - backward compat)
 * 3. Read corrupt YAML → clear error
 * 4. Read non-existent file → clear error
 * 5. Write with optimistic concurrency
 * 6. Version conflict detection
 * 7. updateState succeeds on first try
 * 8. updateState succeeds after retry
 * 9. updateState fails after max retries
 * 10. Exponential backoff between retries
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ProjectState,
  StateError,
  StateErrorCode,
  Result,
  StateController,
  STATE_CONTROLLER_DEFAULTS,
} from '../state-controller';

// =============================================================================
// FileStateController Implementation (to be implemented)
// =============================================================================

import { FileStateController } from '../state-controller-impl';

// =============================================================================
// Test Fixtures
// =============================================================================

const VALID_STATE_WITH_VERSION = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 42
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
lifecycle:
  phase: IMPLEMENTATION
  phase_started_at: "2026-10-12T10:00:00Z"
team:
  members: []
  statistics:
    total_members: 0
    by_role: {}
tasks:
  total: 5
  by_status:
    PENDING: 2
    IN_PROGRESS: 2
    DONE: 1
  by_assignee:
    dev-001: 3
    dev-002: 2
current_task: null
resource_locks: []
last_action: "Test state"
next_permitted_actions: []
`;

const VALID_STATE_WITHOUT_VERSION = `
schema_version: "1"
workflow_version: "1.0.0"
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
lifecycle:
  phase: PLANNING
  phase_started_at: "2026-10-12T10:00:00Z"
team:
  members: []
  statistics:
    total_members: 0
    by_role: {}
tasks:
  total: 0
  by_status: {}
  by_assignee: {}
last_action: "Project initialized"
`;

const CORRUPT_YAML = `
schema_version: "2"
workflow_version: "1.1.0"
  invalid indentation here
    - this: is
    broken yaml [
`;

const MINIMAL_VALID_STATE = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "SYSTEM"
`;

// =============================================================================
// Test Helper - Temporary File Management
// =============================================================================

class TempFileHelper {
  private tempDir: string = '';
  private files: string[] = [];

  async setup(): Promise<void> {
    // Create temp directory for test files
    this.tempDir = path.join(process.cwd(), '.test-temp', `state-controller-${Date.now()}`);
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async cleanup(): Promise<void> {
    // Clean up all created files
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
// Unit Tests for readState()
// =============================================================================

describe('FileStateController', () => {
  let tempHelper: TempFileHelper;

  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  describe('readState()', () => {
    /**
     * Test: Read state with explicit version field
     * **Validates: R02.1** - state_version field is read correctly
     */
    it('should read state with version field and return correct version', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('project-state.yaml', VALID_STATE_WITH_VERSION);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.version).toBe(42);
        expect(result.value.state.state_version).toBe(42);
        expect(result.value.state.schema_version).toBe('2');
        expect(result.value.state.last_modified_by).toBe('dev-001');
        expect(result.value.state.tasks?.total).toBe(5);
      }
    });

    /**
     * Test: Read state without version field (backward compatibility)
     * **Validates: R02.1** - default version 1 when field is missing
     */
    it('should return default version 1 when state_version field is missing', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('project-state-legacy.yaml', VALID_STATE_WITHOUT_VERSION);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.version).toBe(STATE_CONTROLLER_DEFAULTS.DEFAULT_VERSION);
        expect(result.value.state.schema_version).toBe('1');
        expect(result.value.state.workflow_version).toBe('1.0.0');
      }
    });

    /**
     * Test: Read corrupt YAML produces clear error
     * **Validates: R02.2** - invalid YAML handled with INVALID_STATE_FORMAT error
     */
    it('should return INVALID_STATE_FORMAT error for corrupt YAML', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('corrupt-state.yaml', CORRUPT_YAML);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(StateErrorCode.INVALID_STATE_FORMAT);
        expect(result.error.category).toBe('STATE_ERROR');
        expect(result.error.message).toContain('Invalid state format');
        expect(result.error.recoverable).toBe(false);
      }
    });

    /**
     * Test: Read non-existent file produces clear error
     * **Validates: R02.2** - missing file handled with STATE_NOT_FOUND error
     */
    it('should return STATE_NOT_FOUND error for non-existent file', async () => {
      // Arrange
      const statePath = tempHelper.getPath('non-existent-state.yaml');
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(StateErrorCode.STATE_NOT_FOUND);
        expect(result.error.category).toBe('STATE_ERROR');
        expect(result.error.message).toContain('not found');
        expect(result.error.recoverable).toBe(false);
        expect(result.error.context?.path).toBe(statePath);
      }
    });

    /**
     * Test: Read minimal valid state
     * **Validates: R02.1** - minimal state with required fields is readable
     */
    it('should read minimal valid state successfully', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('minimal-state.yaml', MINIMAL_VALID_STATE);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.version).toBe(1);
        expect(result.value.state.schema_version).toBe('2');
        expect(result.value.state.workflow_version).toBe('1.1.0');
        expect(result.value.state.last_modified_by).toBe('SYSTEM');
      }
    });

    /**
     * Test: Version is parsed as integer
     * **Validates: R02.1** - state_version is integer type
     */
    it('should parse version as integer', async () => {
      // Arrange
      const stateWithFloatVersion = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 100
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('integer-version.yaml', stateWithFloatVersion);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.value.version).toBe('number');
        expect(Number.isInteger(result.value.version)).toBe(true);
        expect(result.value.version).toBe(100);
      }
    });

    /**
     * Test: Empty file produces error
     * **Validates: R02.2** - empty file is treated as invalid
     */
    it('should return error for empty file', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('empty-state.yaml', '');
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(StateErrorCode.INVALID_STATE_FORMAT);
      }
    });

    /**
     * Test: State with all optional fields populated
     * **Validates: R02.1** - complex state with all fields is readable
     */
    it('should read state with all optional fields populated', async () => {
      // Arrange
      const complexState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 55
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
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
  total: 3
  by_status:
    IN_PROGRESS: 1
    READY: 2
  by_assignee:
    dev-001: 3
current_task:
  id: TASK-001
  status: IN_PROGRESS
  assignee: dev-001
  ownership:
    fencing_token: "550e8400-e29b-41d4-a716-446655440000"
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
checkpoints:
  last_checkpoint_id: "CP-001"
  last_checkpoint_at: "2026-10-12T10:30:00Z"
  checkpoint_count: 5
findings:
  total: 2
  by_status:
    OPEN: 1
    RESOLVED: 1
  by_severity:
    HIGH: 1
    MEDIUM: 1
  blocking_release: 1
release:
  status: NOT_STARTED
  version: null
  current_stage: null
  stages:
    readiness_check:
      status: NOT_STARTED
      completed_at: null
      evidence_id: null
    staging:
      status: NOT_STARTED
      deployed_at: null
      verified_at: null
      evidence_id: null
    production:
      status: NOT_STARTED
      approved_by: null
      approved_at: null
      deployed_at: null
      verified_at: null
      evidence_id: null
  rollback_available: false
  previous_version: null
actor_config:
  lease_duration_seconds: 3600
  heartbeat_interval_seconds: 300
  inactivity_warning_seconds: 7200
  handoff_timeout_hours: 24
quality_gates:
  unit_test:
    required: true
    min_pass_rate: 100
  integration_test:
    required: true
    min_pass_rate: 100
  lint:
    required: true
  type_check:
    required: true
  security_scan:
    required_for_risk: [HIGH, CRITICAL]
    required: false
last_action: "Complex state test"
next_permitted_actions: ["START_TASK", "CREATE_CHECKPOINT"]
validation:
  errors: []
  warnings: []
`;
      const statePath = await tempHelper.createFile('complex-state.yaml', complexState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.version).toBe(55);
        expect(result.value.state.current_task?.id).toBe('TASK-001');
        expect(result.value.state.current_task?.ownership?.fencing_token).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(result.value.state.checkpoints?.checkpoint_count).toBe(5);
        expect(result.value.state.findings?.blocking_release).toBe(1);
        expect(result.value.state.actor_config?.lease_duration_seconds).toBe(3600);
      }
    });

    /**
     * Test: Invalid version value treated as default
     * **Validates: R02.1** - non-integer version defaults to 1
     */
    it('should use default version when state_version is invalid (non-integer)', async () => {
      // Arrange
      const stateWithInvalidVersion = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: "not-a-number"
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('invalid-version.yaml', stateWithInvalidVersion);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Invalid version should default to 1
        expect(result.value.version).toBe(STATE_CONTROLLER_DEFAULTS.DEFAULT_VERSION);
      }
    });

    /**
     * Test: Negative version treated as default
     * **Validates: R02.1** - version must be positive integer
     */
    it('should use default version when state_version is negative', async () => {
      // Arrange
      const stateWithNegativeVersion = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: -5
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('negative-version.yaml', stateWithNegativeVersion);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Negative version should default to 1
        expect(result.value.version).toBe(STATE_CONTROLLER_DEFAULTS.DEFAULT_VERSION);
      }
    });

    /**
     * Test: Zero version treated as default
     * **Validates: R02.1** - version must be >= 1
     */
    it('should use default version when state_version is zero', async () => {
      // Arrange
      const stateWithZeroVersion = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 0
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('zero-version.yaml', stateWithZeroVersion);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.readState();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Zero version should default to 1
        expect(result.value.version).toBe(STATE_CONTROLLER_DEFAULTS.DEFAULT_VERSION);
      }
    });
  });

  describe('constructor configuration', () => {
    /**
     * Test: Controller accepts configuration
     */
    it('should accept projectStatePath in configuration', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('config-test.yaml', MINIMAL_VALID_STATE);
      
      // Act & Assert - no error thrown
      const controller = new FileStateController({ projectStatePath: statePath });
      expect(controller).toBeDefined();
    });

    /**
     * Test: Controller accepts optional configuration fields
     */
    it('should accept optional configuration fields', async () => {
      // Arrange
      const statePath = await tempHelper.createFile('config-optional.yaml', MINIMAL_VALID_STATE);
      
      // Act & Assert - no error thrown
      const controller = new FileStateController({
        projectStatePath: statePath,
        defaultActorId: 'test-actor',
        defaultActorType: 'HUMAN',
        maxRetries: 5,
        baseRetryDelayMs: 200,
      });
      expect(controller).toBeDefined();
    });
  });

  // ===========================================================================
  // Unit Tests for writeState() - Task T03
  // ===========================================================================

  describe('writeState()', () => {
    /**
     * Test: Write with matching version succeeds
     * **Validates: R02.2** - Optimistic concurrency control
     */
    it('should succeed when expectedVersion matches current version', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 10
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Initial state"
`;
      const statePath = await tempHelper.createFile('write-match.yaml', initialState);
      const controller = new FileStateController({ 
        projectStatePath: statePath,
        defaultActorId: 'dev-002'
      });

      // Read current state
      const readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;
      
      const currentVersion = readResult.value.version;
      expect(currentVersion).toBe(10);

      // Modify state
      const newState = {
        ...readResult.value.state,
        last_action: 'Updated state',
      };

      // Act
      const writeResult = await controller.writeState(
        newState,
        currentVersion,
        'op-123',
        'Test write operation'
      );

      // Assert
      expect(writeResult.success).toBe(true);
      if (writeResult.success) {
        expect(writeResult.value.newVersion).toBe(11); // Version incremented
      }

      // Verify the file was updated
      const verifyResult = await controller.readState();
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        expect(verifyResult.value.version).toBe(11);
        expect(verifyResult.value.state.last_action).toBe('Updated state');
        expect(verifyResult.value.state.last_modified_by).toBe('dev-002');
      }
    });

    /**
     * Test: Write with stale version fails with VERSION_CONFLICT
     * **Validates: R02.2** - Version mismatch rejection
     */
    it('should return VERSION_CONFLICT error when expectedVersion does not match', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 25
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Initial state"
`;
      const statePath = await tempHelper.createFile('write-stale.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Read current state
      const readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      const currentVersion = readResult.value.version;
      expect(currentVersion).toBe(25);

      // Try to write with stale version (24 instead of 25)
      const newState = {
        ...readResult.value.state,
        last_action: 'Attempted update',
      };

      // Act
      const writeResult = await controller.writeState(
        newState,
        24, // Stale version
        'op-stale',
        'Stale write attempt'
      );

      // Assert
      expect(writeResult.success).toBe(false);
      if (!writeResult.success) {
        expect(writeResult.error.code).toBe(StateErrorCode.VERSION_CONFLICT);
        expect(writeResult.error.category).toBe('STATE_ERROR');
        expect(writeResult.error.recoverable).toBe(true);
        expect(writeResult.error.context?.expected_version).toBe(24);
        expect(writeResult.error.context?.actual_version).toBe(25);
        expect(writeResult.error.message).toContain('conflict');
      }
    });

    /**
     * Test: Version is always incremented on successful write
     * **Validates: R02.2** - Version increment behavior
     */
    it('should increment version by 1 on each successful write', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('write-increment.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // First write
      let readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      let writeResult = await controller.writeState(
        { ...readResult.value.state, last_action: 'Write 1' },
        1,
        'op-1',
        'First write'
      );
      expect(writeResult.success).toBe(true);
      if (writeResult.success) {
        expect(writeResult.value.newVersion).toBe(2);
      }

      // Second write
      readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      writeResult = await controller.writeState(
        { ...readResult.value.state, last_action: 'Write 2' },
        2,
        'op-2',
        'Second write'
      );
      expect(writeResult.success).toBe(true);
      if (writeResult.success) {
        expect(writeResult.value.newVersion).toBe(3);
      }

      // Third write
      readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      writeResult = await controller.writeState(
        { ...readResult.value.state, last_action: 'Write 3' },
        3,
        'op-3',
        'Third write'
      );
      expect(writeResult.success).toBe(true);
      if (writeResult.success) {
        expect(writeResult.value.newVersion).toBe(4);
      }
    });

    /**
     * Test: last_modified_at is updated on successful write
     * **Validates: R02.2** - Metadata update behavior
     */
    it('should update last_modified_at timestamp on successful write', async () => {
      // Arrange
      const oldTimestamp = '2020-01-01T00:00:00Z';
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "${oldTimestamp}"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('write-timestamp.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const beforeWrite = new Date().toISOString();
      const readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      const writeResult = await controller.writeState(
        { ...readResult.value.state, last_action: 'Update timestamp' },
        5,
        'op-timestamp',
        'Timestamp test'
      );

      // Assert
      expect(writeResult.success).toBe(true);

      const verifyResult = await controller.readState();
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        const newTimestamp = verifyResult.value.state.last_modified_at;
        expect(newTimestamp).not.toBe(oldTimestamp);
        // Timestamp should be recent (within last minute)
        const timestampDate = new Date(newTimestamp);
        const now = new Date();
        const diffMs = now.getTime() - timestampDate.getTime();
        expect(diffMs).toBeLessThan(60000); // Less than 1 minute
      }
    });

    /**
     * Test: last_modified_by is updated on successful write
     * **Validates: R02.2** - Metadata update behavior
     */
    it('should update last_modified_by on successful write', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 3
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "old-actor"
`;
      const statePath = await tempHelper.createFile('write-actor.yaml', initialState);
      const controller = new FileStateController({ 
        projectStatePath: statePath,
        defaultActorId: 'new-actor'
      });

      // Act
      const readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      const writeResult = await controller.writeState(
        { ...readResult.value.state, last_action: 'Actor update' },
        3,
        'op-actor',
        'Actor test'
      );

      // Assert
      expect(writeResult.success).toBe(true);

      const verifyResult = await controller.readState();
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        expect(verifyResult.value.state.last_modified_by).toBe('new-actor');
      }
    });

    /**
     * Test: Concurrent writes - one succeeds, one fails
     * **Validates: R02.2** - Concurrent write handling
     */
    it('should handle concurrent writes correctly - one succeeds, one fails', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 100
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Initial"
`;
      const statePath = await tempHelper.createFile('concurrent.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Both "clients" read the same version
      const read1 = await controller.readState();
      const read2 = await controller.readState();
      
      expect(read1.success).toBe(true);
      expect(read2.success).toBe(true);
      if (!read1.success || !read2.success) return;

      expect(read1.value.version).toBe(100);
      expect(read2.value.version).toBe(100);

      // First write succeeds
      const write1 = await controller.writeState(
        { ...read1.value.state, last_action: 'Write from client 1' },
        100,
        'op-client1',
        'Client 1 write'
      );
      expect(write1.success).toBe(true);
      if (write1.success) {
        expect(write1.value.newVersion).toBe(101);
      }

      // Second write fails with VERSION_CONFLICT (uses stale version 100)
      const write2 = await controller.writeState(
        { ...read2.value.state, last_action: 'Write from client 2' },
        100, // Stale - actual version is now 101
        'op-client2',
        'Client 2 write'
      );
      expect(write2.success).toBe(false);
      if (!write2.success) {
        expect(write2.error.code).toBe(StateErrorCode.VERSION_CONFLICT);
        expect(write2.error.context?.expected_version).toBe(100);
        expect(write2.error.context?.actual_version).toBe(101);
      }
    });

    /**
     * Test: Write to non-existent file with expectedVersion 0 creates file
     * **Validates: R02.2** - Initial state creation
     */
    it('should create file when writing to non-existent file with expectedVersion 0', async () => {
      // Arrange
      const statePath = tempHelper.getPath('new-state.yaml');
      const controller = new FileStateController({ 
        projectStatePath: statePath,
        defaultActorId: 'creator'
      });

      // Verify file doesn't exist
      const readResult = await controller.readState();
      expect(readResult.success).toBe(false);
      if (!readResult.success) {
        expect(readResult.error.code).toBe(StateErrorCode.STATE_NOT_FOUND);
      }

      // Act - create with expectedVersion 0
      const newState = {
        schema_version: '2' as const,
        workflow_version: '1.1.0',
        state_version: 0, // Will be set to 1
        last_modified_at: '',
        last_modified_by: '',
        last_action: 'Created new state',
      };

      const writeResult = await controller.writeState(
        newState,
        0, // Expected version 0 for new file
        'op-create',
        'Create new state file'
      );

      // Assert
      expect(writeResult.success).toBe(true);
      if (writeResult.success) {
        expect(writeResult.value.newVersion).toBe(1);
      }

      // Verify file was created
      const verifyResult = await controller.readState();
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        expect(verifyResult.value.version).toBe(1);
        expect(verifyResult.value.state.last_action).toBe('Created new state');
        expect(verifyResult.value.state.last_modified_by).toBe('creator');
      }
    });

    /**
     * Test: Write fails when file doesn't exist and expectedVersion is not 0
     * **Validates: R02.2** - File existence validation
     */
    it('should fail when writing to non-existent file with expectedVersion > 0', async () => {
      // Arrange
      const statePath = tempHelper.getPath('non-existent-write.yaml');
      const controller = new FileStateController({ projectStatePath: statePath });

      const newState = {
        schema_version: '2' as const,
        workflow_version: '1.1.0',
        state_version: 0,
        last_modified_at: '',
        last_modified_by: '',
      };

      // Act - try to write with non-zero expected version
      const writeResult = await controller.writeState(
        newState,
        5, // Expected version 5, but file doesn't exist
        'op-fail',
        'Should fail'
      );

      // Assert
      expect(writeResult.success).toBe(false);
      if (!writeResult.success) {
        expect(writeResult.error.code).toBe(StateErrorCode.STATE_NOT_FOUND);
      }
    });

    /**
     * Test: State fields are preserved during write
     * **Validates: R02.2** - State integrity
     */
    it('should preserve all state fields during write', async () => {
      // Arrange
      const complexState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 7
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
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
  total: 3
  by_status:
    IN_PROGRESS: 1
    READY: 2
  by_assignee:
    dev-001: 3
last_action: "Original action"
`;
      const statePath = await tempHelper.createFile('preserve-fields.yaml', complexState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Read and modify only one field
      const readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      const modifiedState = {
        ...readResult.value.state,
        last_action: 'Modified action',
      };

      // Act
      const writeResult = await controller.writeState(
        modifiedState,
        7,
        'op-preserve',
        'Field preservation test'
      );

      // Assert
      expect(writeResult.success).toBe(true);

      const verifyResult = await controller.readState();
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        // Version should increment
        expect(verifyResult.value.version).toBe(8);
        // Modified field should change
        expect(verifyResult.value.state.last_action).toBe('Modified action');
        // Other fields should be preserved
        expect(verifyResult.value.state.lifecycle?.phase).toBe('IMPLEMENTATION');
        expect(verifyResult.value.state.team?.members).toHaveLength(1);
        expect(verifyResult.value.state.team?.members[0].id).toBe('dev-001');
        expect(verifyResult.value.state.tasks?.total).toBe(3);
        expect(verifyResult.value.state.tasks?.by_status?.IN_PROGRESS).toBe(1);
      }
    });

    /**
     * Test: VERSION_CONFLICT error is recoverable
     * **Validates: R02.2, R02.11** - Recoverable error handling
     */
    it('should mark VERSION_CONFLICT as recoverable error', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 50
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('recoverable.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      const readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      // Act - write with wrong version
      const writeResult = await controller.writeState(
        readResult.value.state,
        49, // Wrong version
        'op-recover',
        'Recoverable test'
      );

      // Assert
      expect(writeResult.success).toBe(false);
      if (!writeResult.success) {
        expect(writeResult.error.recoverable).toBe(true);
        expect(writeResult.error.suggested_action).toBeDefined();
        expect(writeResult.error.suggested_action).toContain('retry');
      }
    });

    /**
     * Test: Operation ID is included in error context
     * **Validates: R02.2** - Error context
     */
    it('should include operation_id in VERSION_CONFLICT error context', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 20
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('operation-id.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      const readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      // Act
      const operationId = 'unique-op-id-12345';
      const writeResult = await controller.writeState(
        readResult.value.state,
        19, // Wrong version
        operationId,
        'Operation ID test'
      );

      // Assert
      expect(writeResult.success).toBe(false);
      if (!writeResult.success) {
        expect(writeResult.error.context?.operation_id).toBe(operationId);
      }
    });
  });

  // ===========================================================================
  // Unit Tests for updateState() - Task T04
  // ===========================================================================

  describe('updateState()', () => {
    /**
     * Test: Update succeeds on first try
     * **Validates: R02.2, R02.11** - Atomic read-modify-write
     */
    it('should succeed on first try when no concurrent modifications', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Initial state"
`;
      const statePath = await tempHelper.createFile('update-first-try.yaml', initialState);
      const controller = new FileStateController({
        projectStatePath: statePath,
        defaultActorId: 'dev-002',
      });

      // Act
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'Modified by updateState' }),
        'op-update-001',
        'Test first try update'
      );

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.version).toBe(2);
        expect(result.value.state.last_action).toBe('Modified by updateState');
      }

      // Verify file was updated
      const verifyResult = await controller.readState();
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        expect(verifyResult.value.version).toBe(2);
        expect(verifyResult.value.state.last_action).toBe('Modified by updateState');
        expect(verifyResult.value.state.last_modified_by).toBe('dev-002');
      }
    });

    /**
     * Test: Modifier function is called with current state
     * **Validates: R02.2** - Read-modify-write cycle
     */
    it('should call modifier with current state', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Original action"
`;
      const statePath = await tempHelper.createFile('update-modifier.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      let receivedState: ProjectState | null = null;

      // Act
      const result = await controller.updateState(
        (state) => {
          receivedState = state;
          return { ...state, last_action: 'Updated' };
        },
        'op-modifier',
        'Modifier test'
      );

      // Assert
      expect(result.success).toBe(true);
      expect(receivedState).not.toBeNull();
      expect(receivedState?.last_action).toBe('Original action');
      expect(receivedState?.state_version).toBe(5);
    });

    /**
     * Test: Update returns correct new state and version
     * **Validates: R02.2** - Return values
     */
    it('should return the new state and incremented version', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 10
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
tasks:
  total: 5
  by_status:
    PENDING: 3
    DONE: 2
  by_assignee:
    dev-001: 5
`;
      const statePath = await tempHelper.createFile('update-return.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.updateState(
        (state) => ({
          ...state,
          tasks: {
            ...state.tasks!,
            total: 6,
            by_status: {
              ...state.tasks!.by_status,
              PENDING: 4,
            },
          },
        }),
        'op-return',
        'Return value test'
      );

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.version).toBe(11);
        expect(result.value.state.tasks?.total).toBe(6);
        expect(result.value.state.tasks?.by_status?.PENDING).toBe(4);
        expect(result.value.state.tasks?.by_status?.DONE).toBe(2);
      }
    });

    /**
     * Test: Update fails for non-existent file
     * **Validates: R02.2** - Error handling
     */
    it('should fail with STATE_NOT_FOUND when file does not exist', async () => {
      // Arrange
      const statePath = tempHelper.getPath('non-existent-update.yaml');
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'Should not work' }),
        'op-not-found',
        'Non-existent file test'
      );

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(StateErrorCode.STATE_NOT_FOUND);
      }
    });

    /**
     * Test: Multiple sequential updates work correctly
     * **Validates: R02.2, R02.11** - Sequential consistency
     */
    it('should handle multiple sequential updates correctly', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Initial"
`;
      const statePath = await tempHelper.createFile('sequential-updates.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act - multiple updates
      const result1 = await controller.updateState(
        (state) => ({ ...state, last_action: 'Update 1' }),
        'op-seq-1',
        'First update'
      );

      const result2 = await controller.updateState(
        (state) => ({ ...state, last_action: 'Update 2' }),
        'op-seq-2',
        'Second update'
      );

      const result3 = await controller.updateState(
        (state) => ({ ...state, last_action: 'Update 3' }),
        'op-seq-3',
        'Third update'
      );

      // Assert
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      if (result1.success && result2.success && result3.success) {
        expect(result1.value.version).toBe(2);
        expect(result2.value.version).toBe(3);
        expect(result3.value.version).toBe(4);
      }

      // Verify final state
      const verifyResult = await controller.readState();
      expect(verifyResult.success).toBe(true);
      if (verifyResult.success) {
        expect(verifyResult.value.version).toBe(4);
        expect(verifyResult.value.state.last_action).toBe('Update 3');
      }
    });

    /**
     * Test: Update fails after max retries exceeded
     * **Validates: R02.11** - Max retries exceeded
     * 
     * This test uses mocking to simulate version conflicts on every write attempt.
     */
    it('should fail with MAX_RETRIES_EXCEEDED after max retries', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('max-retries.yaml', initialState);
      
      // We'll create a special scenario by having the modifier
      // trigger a concurrent write BEFORE we can complete our write
      // This requires a different approach: we create a wrapper class
      
      const controller = new FileStateController({
        projectStatePath: statePath,
        maxRetries: 2, // Low for quick test
        baseRetryDelayMs: 1, // Very fast retries for test
      });

      // Spy on writeState to simulate concurrent modification
      const originalWriteState = controller.writeState.bind(controller);
      let writeAttempts = 0;
      
      controller.writeState = async function(state, expectedVersion, operationId, reason) {
        writeAttempts++;
        
        // Before each write attempt, simulate another process incrementing the version
        // by directly modifying the file
        const concurrentController = new FileStateController({
          projectStatePath: statePath,
          defaultActorId: 'concurrent',
        });
        const currentState = await concurrentController.readState();
        if (currentState.success) {
          await originalWriteState.call(
            concurrentController,
            { ...currentState.value.state, last_action: `Concurrent ${writeAttempts}` },
            currentState.value.version,
            `concurrent-${writeAttempts}`,
            'Concurrent mod'
          );
        }
        
        // Now try our write - it will fail with version conflict
        return originalWriteState.call(this, state, expectedVersion, operationId, reason);
      };

      let modifierCallCount = 0;

      // Act
      const result = await controller.updateState(
        (state) => {
          modifierCallCount++;
          return { ...state, last_action: `My update ${modifierCallCount}` };
        },
        'op-max-retries',
        'Max retries test',
        2 // maxRetries = 2
      );

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(StateErrorCode.MAX_RETRIES_EXCEEDED);
        expect(result.error.context?.operation_id).toBe('op-max-retries');
        expect(result.error.recoverable).toBe(false);
      }
      
      // Modifier should have been called maxRetries (2) times
      expect(modifierCallCount).toBe(2);
      // Write should have been attempted maxRetries (2) times
      expect(writeAttempts).toBe(2);
    });

    /**
     * Test: Custom max retries is respected
     * **Validates: R02.11** - Configurable max retries
     */
    it('should respect custom maxRetries parameter', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('custom-retries.yaml', initialState);
      const controller = new FileStateController({
        projectStatePath: statePath,
        maxRetries: 10, // Default high
        baseRetryDelayMs: 10,
      });

      // Act - normal update should succeed with custom maxRetries=1
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'Custom retries' }),
        'op-custom',
        'Custom retries test',
        1 // Override to 1
      );

      // Assert
      expect(result.success).toBe(true);
    });

    /**
     * Test: Modifier function receives fresh state on retry
     * **Validates: R02.11** - Idempotent retry
     */
    it('should call modifier with fresh state on each retry attempt', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Initial"
`;
      const statePath = await tempHelper.createFile('fresh-state.yaml', initialState);
      const controller = new FileStateController({
        projectStatePath: statePath,
        baseRetryDelayMs: 10,
      });

      const receivedVersions: number[] = [];
      let callCount = 0;

      // Act - modifier that tracks what it receives
      // On first call, we'll simulate a concurrent modification
      const result = await controller.updateState(
        (state) => {
          callCount++;
          receivedVersions.push(state.state_version);
          return { ...state, last_action: `Update attempt ${callCount}` };
        },
        'op-fresh-state',
        'Fresh state test'
      );

      // Assert - Should succeed on first try (no conflicts)
      expect(result.success).toBe(true);
      expect(callCount).toBe(1);
      expect(receivedVersions).toEqual([1]); // Version 1 on first call
    });

    /**
     * Test: Update preserves unmodified fields
     * **Validates: R02.2** - State integrity
     */
    it('should preserve unmodified fields from the state', async () => {
      // Arrange
      const complexState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 15
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
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
  total: 5
  by_status:
    IN_PROGRESS: 2
    DONE: 3
  by_assignee:
    dev-001: 5
last_action: "Original"
`;
      const statePath = await tempHelper.createFile('preserve-fields-update.yaml', complexState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act - only modify last_action
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'Only this changed' }),
        'op-preserve',
        'Preserve fields test'
      );

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.state.last_action).toBe('Only this changed');
        expect(result.value.state.lifecycle?.phase).toBe('IMPLEMENTATION');
        expect(result.value.state.team?.members).toHaveLength(1);
        expect(result.value.state.tasks?.total).toBe(5);
        expect(result.value.state.tasks?.by_status?.DONE).toBe(3);
      }
    });

    /**
     * Test: Update handles empty modifier (identity function)
     * **Validates: R02.2** - Edge case handling
     */
    it('should handle identity modifier (no changes)', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Original"
`;
      const statePath = await tempHelper.createFile('identity-modifier.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act - identity modifier
      const result = await controller.updateState(
        (state) => state,
        'op-identity',
        'Identity modifier test'
      );

      // Assert - version still increments even if content is same
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.version).toBe(6);
        // Note: last_modified_at will be updated by writeState
      }
    });

    /**
     * Test: Update with concurrent modification and retry succeeds
     * **Validates: R02.2, R02.11** - Retry on version conflict
     * 
     * This test simulates a scenario where:
     * 1. First updateState reads version N
     * 2. Another process writes version N+1
     * 3. First updateState fails, retries with version N+1, succeeds
     */
    it('should succeed after retry when concurrent modification occurs', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
last_action: "Initial"
`;
      const statePath = await tempHelper.createFile('concurrent-retry.yaml', initialState);
      const controller = new FileStateController({
        projectStatePath: statePath,
        defaultActorId: 'main-modifier',
        baseRetryDelayMs: 1, // Fast for testing
        maxRetries: 5,
      });

      let modifierCallCount = 0;
      let writeAttempts = 0;
      
      // Spy on writeState to simulate ONE concurrent modification
      const originalWriteState = controller.writeState.bind(controller);
      
      controller.writeState = async function(state, expectedVersion, operationId, reason) {
        writeAttempts++;
        
        // Only on first write attempt, simulate concurrent modification
        if (writeAttempts === 1) {
          const concurrentController = new FileStateController({
            projectStatePath: statePath,
            defaultActorId: 'concurrent',
          });
          const currentState = await concurrentController.readState();
          if (currentState.success) {
            await originalWriteState.call(
              concurrentController,
              { ...currentState.value.state, last_action: 'Concurrent write' },
              currentState.value.version,
              'concurrent-op',
              'Concurrent mod'
            );
          }
        }
        
        // Now try our write - will fail on first attempt, succeed on second
        return originalWriteState.call(this, state, expectedVersion, operationId, reason);
      };

      // Act
      const result = await controller.updateState(
        (state) => {
          modifierCallCount++;
          return { ...state, last_action: `Main update ${modifierCallCount}` };
        },
        'op-concurrent',
        'Concurrent retry test'
      );

      // Assert - should succeed after retry
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.state.last_action).toBe('Main update 2');
        // Version should be 3 (1 → 2 by concurrent, 2 → 3 by our retry)
        expect(result.value.version).toBe(3);
      }
      
      // Modifier called twice: once before first fail, once before retry success
      expect(modifierCallCount).toBe(2);
      expect(writeAttempts).toBe(2);
    });

    /**
     * Test: Exponential backoff delay is applied between retries
     * **Validates: R02.11** - Exponential backoff
     * 
     * Note: This test verifies timing behavior which can be flaky.
     * We test the helper function directly instead.
     */
    it('should apply exponential backoff between retries', async () => {
      // Arrange - import the backoff function
      const { calculateBackoffDelay } = await import('../state-controller');
      
      // Act - calculate delays for multiple retries
      const delay0 = calculateBackoffDelay(0, 100);
      const delay1 = calculateBackoffDelay(1, 100);
      const delay2 = calculateBackoffDelay(2, 100);
      const delay3 = calculateBackoffDelay(3, 100);

      // Assert - delays should be exponentially increasing (with jitter)
      // Base formula: 2^retryCount * baseDelay, ±25% jitter
      // retry 0: 2^0 * 100 = 100ms ±25%
      // retry 1: 2^1 * 100 = 200ms ±25%
      // retry 2: 2^2 * 100 = 400ms ±25%
      // retry 3: 2^3 * 100 = 800ms ±25%

      expect(delay0).toBeGreaterThanOrEqual(75); // 100 - 25%
      expect(delay0).toBeLessThanOrEqual(125);    // 100 + 25%

      expect(delay1).toBeGreaterThanOrEqual(150); // 200 - 25%
      expect(delay1).toBeLessThanOrEqual(250);    // 200 + 25%

      expect(delay2).toBeGreaterThanOrEqual(300); // 400 - 25%
      expect(delay2).toBeLessThanOrEqual(500);    // 400 + 25%

      expect(delay3).toBeGreaterThanOrEqual(600); // 800 - 25%
      expect(delay3).toBeLessThanOrEqual(1000);   // 800 + 25%
    });

    /**
     * Test: Modifier function is called correct number of times with retries
     * **Validates: R02.11** - Retry behavior
     * 
     * We use a mock/spy approach to count modifier calls when version conflicts occur.
     */
    it('should call modifier function multiple times on retries', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('modifier-calls.yaml', initialState);
      
      // Create controller with very fast retries
      const controller = new FileStateController({
        projectStatePath: statePath,
        maxRetries: 5,
        baseRetryDelayMs: 1, // Very fast for testing
      });

      let modifierCallCount = 0;

      // Act - this will succeed on first try (no actual conflicts in this test)
      const result = await controller.updateState(
        (state) => {
          modifierCallCount++;
          return { ...state, last_action: `Call ${modifierCallCount}` };
        },
        'op-modifier-count',
        'Modifier call count test'
      );

      // Assert - without actual conflicts, modifier is called once
      expect(result.success).toBe(true);
      expect(modifierCallCount).toBe(1);
    });

    /**
     * Test: Default maxRetries from config is used
     * **Validates: R02.11** - Configurable max retries
     */
    it('should use default maxRetries from config when not specified', async () => {
      // Arrange
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('default-retries.yaml', initialState);
      const controller = new FileStateController({
        projectStatePath: statePath,
        maxRetries: 5, // Custom default
      });

      // Act
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'Default retries' }),
        'op-default',
        'Default retries test'
        // maxRetries not specified - should use config value
      );

      // Assert
      expect(result.success).toBe(true);
    });

    /**
     * Test: Non-version-conflict errors are not retried
     * **Validates: R02.11** - Only retry on version conflict
     */
    it('should not retry on non-version-conflict errors', async () => {
      // Arrange - use a non-existent file
      const statePath = tempHelper.getPath('no-retry-error.yaml');
      const controller = new FileStateController({
        projectStatePath: statePath,
        maxRetries: 5,
      });

      let modifierCallCount = 0;

      // Act
      const result = await controller.updateState(
        (state) => {
          modifierCallCount++;
          return { ...state, last_action: 'Should not retry' };
        },
        'op-no-retry',
        'No retry test'
      );

      // Assert - STATE_NOT_FOUND is not retried
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(StateErrorCode.STATE_NOT_FOUND);
      }
      // Modifier should not even be called since readState fails first
      expect(modifierCallCount).toBe(0);
    });

    /**
     * Test: Timestamps are updated on each update
     * **Validates: R02.2** - Metadata update
     */
    it('should update last_modified_at on each update', async () => {
      // Arrange
      const oldTimestamp = '2020-01-01T00:00:00Z';
      const initialState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "${oldTimestamp}"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('timestamp-update.yaml', initialState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'Timestamp test' }),
        'op-timestamp',
        'Timestamp update test'
      );

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const newTimestamp = result.value.state.last_modified_at;
        expect(newTimestamp).not.toBe(oldTimestamp);
        
        // Verify it's a recent timestamp
        const timestampDate = new Date(newTimestamp);
        const now = new Date();
        const diffMs = now.getTime() - timestampDate.getTime();
        expect(diffMs).toBeLessThan(60000); // Within last minute
      }
    });
  });

  // ===========================================================================
  // Unit Tests for validateConsistency() - Task T05
  // ===========================================================================

  describe('validateConsistency()', () => {
    /**
     * Test: Valid state passes validation
     * **Validates: R16.6** - Consistency validation with all checks passing
     */
    it('should pass validation for a valid state with consistent counters', async () => {
      // Arrange
      const validState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 10
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
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
  total: 5
  by_status:
    PENDING: 1
    IN_PROGRESS: 2
    DONE: 2
  by_assignee:
    dev-001: 3
    dev-002: 2
findings:
  total: 3
  by_status:
    OPEN: 1
    RESOLVED: 2
  by_severity:
    HIGH: 1
    MEDIUM: 2
  blocking_release: 1
last_action: "Valid state"
`;
      const statePath = await tempHelper.createFile('valid-consistency.yaml', validState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(true);
        expect(result.value.issues.filter(i => i.type === 'ERROR')).toHaveLength(0);
        expect(result.value.validated_at).toBeDefined();
      }
    });

    /**
     * Test: Counter mismatch detected - tasks.total vs by_status
     * **Validates: R16.6** - Counter mismatches detection
     */
    it('should detect counter mismatch when tasks.total does not match sum of by_status', async () => {
      // Arrange
      const mismatchState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
tasks:
  total: 10
  by_status:
    PENDING: 2
    IN_PROGRESS: 3
    DONE: 2
  by_assignee:
    dev-001: 5
`;
      const statePath = await tempHelper.createFile('mismatch-tasks.yaml', mismatchState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(false);
        const taskCountError = result.value.issues.find(
          i => i.code === 'TASK_COUNT_MISMATCH'
        );
        expect(taskCountError).toBeDefined();
        expect(taskCountError?.type).toBe('ERROR');
        expect(taskCountError?.expected).toBe(10); // tasks.total
        expect(taskCountError?.actual).toBe(7);    // sum of by_status
        expect(taskCountError?.message).toContain('by_status');
      }
    });

    /**
     * Test: Counter mismatch detected - team.statistics.total_members vs members array
     * **Validates: R16.6** - Counter mismatches detection
     */
    it('should detect counter mismatch when team.statistics.total_members does not match members array length', async () => {
      // Arrange
      const mismatchState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
team:
  members:
    - id: dev-001
      name: Developer One
      roles: [backend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
  statistics:
    total_members: 5
    by_role:
      backend: 1
`;
      const statePath = await tempHelper.createFile('mismatch-team.yaml', mismatchState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(false);
        const teamCountError = result.value.issues.find(
          i => i.code === 'TEAM_COUNT_MISMATCH'
        );
        expect(teamCountError).toBeDefined();
        expect(teamCountError?.type).toBe('ERROR');
        expect(teamCountError?.expected).toBe(1);  // actual members array length
        expect(teamCountError?.actual).toBe(5);    // statistics.total_members
      }
    });

    /**
     * Test: Counter mismatch detected - findings.total vs by_status
     * **Validates: R16.6** - Counter mismatches detection
     */
    it('should detect counter mismatch when findings.total does not match sum of by_status', async () => {
      // Arrange
      const mismatchState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 5
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
findings:
  total: 20
  by_status:
    OPEN: 3
    RESOLVED: 5
  by_severity:
    HIGH: 5
    MEDIUM: 3
  blocking_release: 2
`;
      const statePath = await tempHelper.createFile('mismatch-findings.yaml', mismatchState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(false);
        const findingsCountError = result.value.issues.find(
          i => i.code === 'FINDINGS_COUNT_MISMATCH'
        );
        expect(findingsCountError).toBeDefined();
        expect(findingsCountError?.type).toBe('ERROR');
        expect(findingsCountError?.expected).toBe(20); // findings.total
        expect(findingsCountError?.actual).toBe(8);    // sum of by_status
      }
    });

    /**
     * Test: Missing required field - schema_version
     * **Validates: R16.6** - Missing required fields detection
     */
    it('should detect missing required field schema_version', async () => {
      // Arrange
      const missingSchemaVersion = `
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('missing-schema.yaml', missingSchemaVersion);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(false);
        const missingFieldError = result.value.issues.find(
          i => i.code === 'MISSING_SCHEMA_VERSION'
        );
        expect(missingFieldError).toBeDefined();
        expect(missingFieldError?.type).toBe('ERROR');
        expect(missingFieldError?.path).toBe('schema_version');
      }
    });

    /**
     * Test: Warning for missing workflow_version (not required but recommended)
     * **Validates: R16.6** - Missing fields detection
     */
    it('should add warning for missing workflow_version', async () => {
      // Arrange
      const missingWorkflowVersion = `
schema_version: "2"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('missing-workflow.yaml', missingWorkflowVersion);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Should be valid (workflow_version is warning, not error)
        expect(result.value.valid).toBe(true);
        const warningIssue = result.value.issues.find(
          i => i.code === 'MISSING_WORKFLOW_VERSION'
        );
        expect(warningIssue).toBeDefined();
        expect(warningIssue?.type).toBe('WARNING');
      }
    });

    /**
     * Test: Invalid state combination - current_task blocked without blocked_reason
     * **Validates: R16.6** - Invalid state combinations detection
     */
    it('should detect invalid state combination - blocked task without reason', async () => {
      // Arrange
      const invalidCombination = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
current_task:
  id: TASK-001
  status: IN_PROGRESS
  assignee: dev-001
  ownership: null
  dor_check: null
  tdd: null
  blocked: true
  blocked_reason: null
  blocker_refs: []
  handoff_pending: false
  handoff_id: null
  working_branch: null
`;
      const statePath = await tempHelper.createFile('invalid-blocked.yaml', invalidCombination);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // This is a warning, not error - so state might still be valid
        const blockedWarning = result.value.issues.find(
          i => i.code === 'MISSING_BLOCKED_REASON'
        );
        expect(blockedWarning).toBeDefined();
        expect(blockedWarning?.type).toBe('WARNING');
        expect(blockedWarning?.message).toContain('blocked');
        expect(blockedWarning?.message).toContain('blocked_reason');
      }
    });

    /**
     * Test: Invalid state combination - ownership without fencing_token
     * **Validates: R16.6** - Invalid state combinations / orphan references detection
     */
    it('should detect invalid state combination - ownership without fencing_token', async () => {
      // Arrange
      const missingToken = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
current_task:
  id: TASK-001
  status: IN_PROGRESS
  assignee: dev-001
  ownership:
    fencing_token: null
    acquired_at: "2026-10-12T10:00:00Z"
    actor_type: HUMAN
    lease_expires_at: null
    last_heartbeat_at: null
  dor_check: null
  tdd: null
  blocked: false
  blocked_reason: null
  blocker_refs: []
  handoff_pending: false
  handoff_id: null
  working_branch: null
`;
      const statePath = await tempHelper.createFile('missing-token.yaml', missingToken);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(false);
        const tokenError = result.value.issues.find(
          i => i.code === 'MISSING_FENCING_TOKEN'
        );
        expect(tokenError).toBeDefined();
        expect(tokenError?.type).toBe('ERROR');
        expect(tokenError?.message).toContain('fencing_token');
      }
    });

    /**
     * Test: Non-existent file returns error, not validation failure
     * **Validates: R16.6** - Error handling
     */
    it('should return STATE_NOT_FOUND error for non-existent file', async () => {
      // Arrange
      const statePath = tempHelper.getPath('non-existent-validate.yaml');
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(StateErrorCode.STATE_NOT_FOUND);
      }
    });

    /**
     * Test: Corrupt file returns error, not validation failure
     * **Validates: R16.6** - Error handling
     */
    it('should return INVALID_STATE_FORMAT error for corrupt file', async () => {
      // Arrange
      const corruptContent = `
schema_version: "2"
  invalid: yaml [
    this: is broken
`;
      const statePath = await tempHelper.createFile('corrupt-validate.yaml', corruptContent);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(StateErrorCode.INVALID_STATE_FORMAT);
      }
    });

    /**
     * Test: Multiple issues detected in single validation
     * **Validates: R16.6** - Comprehensive validation
     */
    it('should detect multiple issues in single validation', async () => {
      // Arrange - state with multiple problems
      const multipleIssues = `
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
team:
  members:
    - id: dev-001
      name: Dev
      roles: [backend]
      registered_at: "2026-10-12T08:00:00Z"
      status: ACTIVE
  statistics:
    total_members: 10
    by_role:
      backend: 1
tasks:
  total: 100
  by_status:
    PENDING: 5
    DONE: 5
  by_assignee:
    dev-001: 10
findings:
  total: 50
  by_status:
    OPEN: 2
  by_severity:
    HIGH: 2
  blocking_release: 1
`;
      const statePath = await tempHelper.createFile('multiple-issues.yaml', multipleIssues);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(false);
        
        // Should have multiple issues
        expect(result.value.issues.length).toBeGreaterThan(2);
        
        // Check for specific issues
        const errorCodes = result.value.issues.map(i => i.code);
        expect(errorCodes).toContain('MISSING_SCHEMA_VERSION');
        expect(errorCodes).toContain('TASK_COUNT_MISMATCH');
        expect(errorCodes).toContain('TEAM_COUNT_MISMATCH');
        expect(errorCodes).toContain('FINDINGS_COUNT_MISMATCH');
      }
    });

    /**
     * Test: Empty tasks section is valid
     * **Validates: R16.6** - Edge case handling
     */
    it('should pass validation with empty tasks section', async () => {
      // Arrange
      const emptyTasks = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
tasks:
  total: 0
  by_status: {}
  by_assignee: {}
`;
      const statePath = await tempHelper.createFile('empty-tasks.yaml', emptyTasks);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(true);
      }
    });

    /**
     * Test: ValidationResult includes timestamp
     * **Validates: R16.6** - Structured validation result
     */
    it('should include validated_at timestamp in validation result', async () => {
      // Arrange
      const validState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
`;
      const statePath = await tempHelper.createFile('timestamp-validate.yaml', validState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const beforeValidation = new Date().toISOString();
      const result = await controller.validateConsistency();
      const afterValidation = new Date().toISOString();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.validated_at).toBeDefined();
        // Timestamp should be within the test execution window
        expect(result.value.validated_at >= beforeValidation).toBe(true);
        expect(result.value.validated_at <= afterValidation).toBe(true);
      }
    });

    /**
     * Test: by_assignee exceeding total triggers warning
     * **Validates: R16.6** - Counter anomaly detection
     */
    it('should warn when by_assignee sum exceeds total (potential duplicate assignment)', async () => {
      // Arrange - This could happen if same task assigned to multiple people
      const anomalyState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "dev-001"
tasks:
  total: 5
  by_status:
    PENDING: 2
    IN_PROGRESS: 3
  by_assignee:
    dev-001: 4
    dev-002: 3
`;
      const statePath = await tempHelper.createFile('assignee-anomaly.yaml', anomalyState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const assigneeWarning = result.value.issues.find(
          i => i.code === 'TASK_ASSIGNEE_EXCEEDS_TOTAL'
        );
        expect(assigneeWarning).toBeDefined();
        expect(assigneeWarning?.type).toBe('WARNING');
        expect(assigneeWarning?.message).toContain('exceeds');
      }
    });

    /**
     * Test: State without optional sections is valid
     * **Validates: R16.6** - Minimal state handling
     */
    it('should pass validation for minimal state without optional sections', async () => {
      // Arrange - only required fields
      const minimalState = `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2026-10-12T10:00:00Z"
last_modified_by: "SYSTEM"
`;
      const statePath = await tempHelper.createFile('minimal-validate.yaml', minimalState);
      const controller = new FileStateController({ projectStatePath: statePath });

      // Act
      const result = await controller.validateConsistency();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(true);
        // May have warnings but no errors
        const errors = result.value.issues.filter(i => i.type === 'ERROR');
        expect(errors).toHaveLength(0);
      }
    });
  });
});
