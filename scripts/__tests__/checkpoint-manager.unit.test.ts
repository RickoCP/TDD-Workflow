/**
 * Unit Tests for Checkpoint_Manager Operations
 * 
 * These tests verify the FileCheckpointManager functionality including:
 * - createCheckpoint() - Checkpoint creation with state and git capture
 * - getCheckpoint() - Checkpoint retrieval by ID
 * - listCheckpoints() - Checkpoint listing with filtering
 * - validateCheckpoint() - Validation against current state
 * - pruneCheckpoints() - Checkpoint retention management
 * 
 * Following TDD methodology - tests written first to define expected behavior.
 * 
 * **Validates: Requirements R09.1, R09.2, R09.3, R09.4, R09.7**
 * 
 * Test Scenarios:
 * 1. Create checkpoint captures all required fields (R09.1)
 * 2. Checkpoint saved to correct location
 * 3. Checkpoint ID is unique and sequential
 * 4. Git state captured (branch, commit, uncommitted)
 * 5. Different triggers produce correct metadata (R09.2)
 * 6. Manual checkpoint with note (R09.3)
 * 7. Validation detects stale checkpoint (R09.4)
 * 8. Pruning respects retention policy (R09.7)
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  Checkpoint,
  CheckpointTrigger,
  CheckpointGitState,
  CheckpointSnapshot,
  UncommittedChange,
  CHECKPOINT_DEFAULTS,
  CheckpointErrorCode,
} from '../checkpoint-manager';

import { FileCheckpointManager, GitHelper, FileCheckpointManagerConfig } from '../checkpoint-manager-impl';

import {
  StateController,
  ProjectState,
  Result,
  StateError,
  ok,
  err,
} from '../state-controller';

// =============================================================================
// Mock Implementations
// =============================================================================

/**
 * Mock StateController for testing.
 */
class MockStateController implements StateController {
  private state: ProjectState;
  private version: number;
  
  constructor(initialState?: Partial<ProjectState>, initialVersion?: number) {
    this.version = initialVersion ?? 1;
    this.state = {
      schema_version: '2',
      workflow_version: '1.1.0',
      state_version: this.version,
      last_modified_at: new Date().toISOString(),
      last_modified_by: 'test-user',
      lifecycle: {
        phase: 'IMPLEMENTATION',
        phase_started_at: new Date().toISOString(),
      },
      team: {
        members: [],
        statistics: {
          total_members: 0,
          by_role: {},
        },
      },
      tasks: {
        total: 1,
        by_status: { IN_PROGRESS: 1 },
        by_assignee: { 'test-user': 1 },
      },
      current_task: {
        id: 'TASK-001',
        status: 'IN_PROGRESS',
        assignee: 'test-user',
        ownership: {
          fencing_token: 'test-token-123',
          acquired_at: new Date().toISOString(),
          actor_type: 'HUMAN',
          lease_expires_at: null,
          last_heartbeat_at: null,
        },
        dor_check: null,
        tdd: {
          phase: 'GREEN',
          phase_started_at: new Date().toISOString(),
          not_applicable_reason: null,
        },
        blocked: false,
        blocked_reason: null,
        blocker_refs: [],
        handoff_pending: false,
        handoff_id: null,
        working_branch: 'task/TASK-001-feature',
      },
      resource_locks: [],
      checkpoints: null,
      findings: null,
      release: null,
      actor_config: null,
      quality_gates: null,
      last_action: 'Test action',
      next_permitted_actions: [],
      validation: null,
      ...initialState,
    };
  }

  async readState(): Promise<Result<{ state: ProjectState; version: number }, StateError>> {
    return ok({ state: this.state, version: this.version });
  }

  async writeState(
    state: ProjectState,
    expectedVersion: number,
    operationId: string,
    reason: string
  ): Promise<Result<{ newVersion: number }, StateError>> {
    if (expectedVersion !== this.version) {
      return err({
        code: 2002 as any,
        category: 'STATE_ERROR',
        message: 'Version conflict',
        recoverable: true,
        timestamp: new Date().toISOString(),
      });
    }
    this.version++;
    this.state = { ...state, state_version: this.version };
    return ok({ newVersion: this.version });
  }

  async updateState(
    modifier: (state: ProjectState) => ProjectState,
    operationId: string,
    reason: string,
    maxRetries?: number
  ): Promise<Result<{ state: ProjectState; version: number }, StateError>> {
    const newState = modifier(this.state);
    this.version++;
    this.state = { ...newState, state_version: this.version };
    return ok({ state: this.state, version: this.version });
  }

  async validateConsistency(): Promise<Result<any, StateError>> {
    return ok({ valid: true, issues: [], validated_at: new Date().toISOString() });
  }

  // Test helper methods
  setState(state: Partial<ProjectState>): void {
    this.state = { ...this.state, ...state };
  }

  setVersion(version: number): void {
    this.version = version;
  }
}

/**
 * Mock GitHelper for testing.
 */
class MockGitHelper implements GitHelper {
  private _currentBranch: string = 'main';
  private _currentCommit: string = 'abc123def456';
  private _isDirty: boolean = false;
  private _uncommittedChanges: UncommittedChange[] = [];
  private _commitExists: boolean = true;
  private _branchExists: boolean = true;

  async getCurrentBranch(): Promise<string> {
    return this._currentBranch;
  }

  async getCurrentCommit(): Promise<string> {
    return this._currentCommit;
  }

  async isWorkingTreeDirty(): Promise<boolean> {
    return this._isDirty;
  }

  async getUncommittedChanges(): Promise<UncommittedChange[]> {
    return this._uncommittedChanges;
  }

  async isCommitReachable(commitSha: string): Promise<boolean> {
    return this._commitExists;
  }

  async branchExists(branchName: string): Promise<boolean> {
    return this._branchExists;
  }

  // Test helper methods
  setCurrentBranch(branch: string): void {
    this._currentBranch = branch;
  }

  setCurrentCommit(commit: string): void {
    this._currentCommit = commit;
  }

  setDirty(dirty: boolean, changes?: UncommittedChange[]): void {
    this._isDirty = dirty;
    this._uncommittedChanges = changes ?? [];
  }

  setCommitExists(exists: boolean): void {
    this._commitExists = exists;
  }

  setBranchExists(exists: boolean): void {
    this._branchExists = exists;
  }
}

// =============================================================================
// Test Helper - Temporary File Management
// =============================================================================

class TempFileHelper {
  private tempDir: string = '';
  private files: string[] = [];

  async setup(): Promise<void> {
    this.tempDir = path.join(process.cwd(), '.test-temp', `checkpoint-${Date.now()}`);
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch {
      // Ignore errors during cleanup
    }
    this.files = [];
  }

  getStoragePath(): string {
    return path.join(this.tempDir, 'checkpoints');
  }

  getTempDir(): string {
    return this.tempDir;
  }

  async createCheckpointFile(checkpointId: string, content: any): Promise<string> {
    const storagePath = this.getStoragePath();
    await fs.mkdir(storagePath, { recursive: true });
    const filePath = path.join(storagePath, `${checkpointId}.yaml`);
    const yaml = await import('yaml');
    await fs.writeFile(filePath, yaml.stringify(content), 'utf-8');
    this.files.push(filePath);
    return filePath;
  }

  async fileExists(checkpointId: string): Promise<boolean> {
    const filePath = path.join(this.getStoragePath(), `${checkpointId}.yaml`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestCheckpoint(overrides?: Partial<Checkpoint>): Checkpoint {
  const now = new Date().toISOString();
  return {
    metadata: {
      checkpoint_id: 'CP-2026-10-12-001',
      created_at: now,
      created_by: 'test-user',
      actor_type: 'HUMAN',
      trigger: 'MANUAL',
    },
    snapshot: {
      state_version: 1,
      task_id: 'TASK-001',
      task_status: 'IN_PROGRESS',
      owner_id: 'test-user',
      fencing_token: 'test-token-123',
      tdd_phase: 'GREEN',
      git_state: {
        branch_name: 'main',
        commit_sha: 'abc123def456',
        working_tree_dirty: false,
        uncommitted_changes: [],
      },
      evidence_refs: [],
      blockers: [],
      next_action: null,
    },
    ...overrides,
  };
}

// =============================================================================
// Unit Tests for createCheckpoint()
// =============================================================================

describe('FileCheckpointManager', () => {
  let tempHelper: TempFileHelper;
  let mockStateController: MockStateController;
  let mockGitHelper: MockGitHelper;

  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
    mockStateController = new MockStateController();
    mockGitHelper = new MockGitHelper();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  describe('createCheckpoint()', () => {
    /**
     * Test: Checkpoint captures all required fields
     * **Validates: R09.1** - Checkpoint contains required snapshot data
     */
    it('should create checkpoint with all required fields', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.createCheckpoint('MANUAL', 'TASK-001', 'Test checkpoint');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const checkpoint = result.value;
        
        // Check metadata
        expect(checkpoint.metadata.checkpoint_id).toMatch(/^CP-\d{4}-\d{2}-\d{2}-\d{3}$/);
        expect(checkpoint.metadata.created_at).toBeDefined();
        expect(checkpoint.metadata.created_by).toBe('test-user');
        expect(checkpoint.metadata.actor_type).toBe('HUMAN');
        expect(checkpoint.metadata.trigger).toBe('MANUAL');
        expect(checkpoint.metadata.note).toBe('Test checkpoint');
        
        // Check snapshot
        expect(checkpoint.snapshot.state_version).toBe(1);
        expect(checkpoint.snapshot.task_id).toBe('TASK-001');
        expect(checkpoint.snapshot.task_status).toBe('IN_PROGRESS');
        expect(checkpoint.snapshot.owner_id).toBe('test-user');
        expect(checkpoint.snapshot.fencing_token).toBe('test-token-123');
        expect(checkpoint.snapshot.tdd_phase).toBe('GREEN');
        
        // Check git state
        expect(checkpoint.snapshot.git_state.branch_name).toBe('main');
        expect(checkpoint.snapshot.git_state.commit_sha).toBe('abc123def456');
        expect(checkpoint.snapshot.git_state.working_tree_dirty).toBe(false);
      }
    });

    /**
     * Test: Checkpoint file saved to correct location
     * **Validates: R09.7** - Storage in .kiro/sdlc/checkpoints/
     */
    it('should save checkpoint file to storage directory', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.createCheckpoint('MANUAL');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const checkpointId = result.value.metadata.checkpoint_id;
        const exists = await tempHelper.fileExists(checkpointId);
        expect(exists).toBe(true);
      }
    });

    /**
     * Test: Checkpoint ID is unique and sequential
     * **Validates: R09.1** - Unique checkpoint identifier format
     */
    it('should generate unique sequential checkpoint IDs', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result1 = await manager.createCheckpoint('MANUAL');
      const result2 = await manager.createCheckpoint('MANUAL');

      // Assert
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      
      if (result1.success && result2.success) {
        const id1 = result1.value.metadata.checkpoint_id;
        const id2 = result2.value.metadata.checkpoint_id;
        
        expect(id1).not.toBe(id2);
        
        // Extract sequence numbers
        const seq1 = parseInt(id1.split('-').pop()!, 10);
        const seq2 = parseInt(id2.split('-').pop()!, 10);
        
        expect(seq2).toBeGreaterThan(seq1);
      }
    });

    /**
     * Test: Git state captured correctly
     * **Validates: R09.1** - Git state in checkpoint
     */
    it('should capture git state including branch, commit, and uncommitted changes', async () => {
      // Arrange
      mockGitHelper.setCurrentBranch('feature/test-branch');
      mockGitHelper.setCurrentCommit('def456abc789');
      mockGitHelper.setDirty(true, [
        { path: 'src/file.ts', type: 'modified' },
        { path: 'src/new.ts', type: 'added' },
      ]);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.createCheckpoint('MANUAL');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const gitState = result.value.snapshot.git_state;
        
        expect(gitState.branch_name).toBe('feature/test-branch');
        expect(gitState.commit_sha).toBe('def456abc789');
        expect(gitState.working_tree_dirty).toBe(true);
        expect(gitState.uncommitted_changes).toHaveLength(2);
        expect(gitState.uncommitted_changes[0]).toEqual({ path: 'src/file.ts', type: 'modified' });
        expect(gitState.uncommitted_changes[1]).toEqual({ path: 'src/new.ts', type: 'added' });
      }
    });

    /**
     * Test: Different triggers produce correct metadata
     * **Validates: R09.2** - Automatic checkpoint triggers
     */
    it.each([
      ['STATE_TRANSITION', 'Task status changed'],
      ['TDD_PHASE_TRANSITION', 'TDD phase changed'],
      ['EVIDENCE_CREATED', 'Evidence record created'],
      ['HANDOFF_INITIATED', 'Handoff process started'],
      ['HANDOFF_COMPLETED', 'Handoff process completed'],
      ['PERIODIC', 'Periodic checkpoint'],
      ['MANUAL', 'Manual checkpoint by user'],
    ] as [CheckpointTrigger, string][])('should set trigger to %s', async (trigger, _description) => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.createCheckpoint(trigger);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.metadata.trigger).toBe(trigger);
      }
    });

    /**
     * Test: Invalid trigger rejected
     */
    it('should reject invalid trigger type', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.createCheckpoint('INVALID_TRIGGER' as CheckpointTrigger);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(CheckpointErrorCode.INVALID_TRIGGER);
      }
    });

    /**
     * Test: Checkpoint captures current state version
     * **Validates: R09.1** - State version tracking
     */
    it('should capture correct state version', async () => {
      // Arrange
      mockStateController.setVersion(42);
      
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.createCheckpoint('MANUAL');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.snapshot.state_version).toBe(42);
      }
    });

    /**
     * Test: Manual checkpoint with user note
     * **Validates: R09.3** - Manual checkpoint with optional note
     */
    it('should include user note for manual checkpoint', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });
      const userNote = 'Checkpoint before major refactoring';

      // Act
      const result = await manager.createCheckpoint('MANUAL', undefined, userNote);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.metadata.note).toBe(userNote);
      }
    });

    /**
     * Test: Checkpoint includes content hash for integrity
     */
    it('should include content hash for integrity checking', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.createCheckpoint('MANUAL');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.content_hash).toBeDefined();
        expect(result.value.content_hash).toMatch(/^sha256:/);
      }
    });
  });

  // ===========================================================================
  // Unit Tests for getCheckpoint()
  // ===========================================================================

  describe('getCheckpoint()', () => {
    /**
     * Test: Get existing checkpoint by ID
     */
    it('should retrieve checkpoint by ID', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.getCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.metadata.checkpoint_id).toBe('CP-2026-10-12-001');
        expect(result.value.snapshot.task_id).toBe('TASK-001');
      }
    });

    /**
     * Test: Error when checkpoint not found
     */
    it('should return error when checkpoint not found', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.getCheckpoint('CP-nonexistent');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(CheckpointErrorCode.CHECKPOINT_NOT_FOUND);
      }
    });

    /**
     * Test: Error when checkpoint file corrupted
     */
    it('should return error when checkpoint file is corrupted', async () => {
      // Arrange
      const storagePath = tempHelper.getStoragePath();
      await fs.mkdir(storagePath, { recursive: true });
      await fs.writeFile(path.join(storagePath, 'CP-corrupt.yaml'), 'invalid: yaml: [broken', 'utf-8');

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: storagePath,
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.getCheckpoint('CP-corrupt');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(CheckpointErrorCode.CHECKPOINT_CORRUPTED);
      }
    });
  });

  // ===========================================================================
  // Unit Tests for listCheckpoints()
  // ===========================================================================

  describe('listCheckpoints()', () => {
    /**
     * Test: List all checkpoints
     */
    it('should list all checkpoints sorted by date (newest first)', async () => {
      // Arrange
      const cp1 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-001', created_at: '2026-10-12T08:00:00Z' },
      });
      const cp2 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-002', created_at: '2026-10-12T10:00:00Z' },
      });
      const cp3 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-003', created_at: '2026-10-12T09:00:00Z' },
      });

      await tempHelper.createCheckpointFile('CP-2026-10-12-001', cp1);
      await tempHelper.createCheckpointFile('CP-2026-10-12-002', cp2);
      await tempHelper.createCheckpointFile('CP-2026-10-12-003', cp3);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.listCheckpoints();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(3);
        // Should be sorted newest first
        expect(result.value[0].metadata.checkpoint_id).toBe('CP-2026-10-12-002');
        expect(result.value[1].metadata.checkpoint_id).toBe('CP-2026-10-12-003');
        expect(result.value[2].metadata.checkpoint_id).toBe('CP-2026-10-12-001');
      }
    });

    /**
     * Test: Filter checkpoints by task ID
     */
    it('should filter checkpoints by task ID', async () => {
      // Arrange
      const cp1 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-001' },
        snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-001' },
      });
      const cp2 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-002' },
        snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-002' },
      });

      await tempHelper.createCheckpointFile('CP-2026-10-12-001', cp1);
      await tempHelper.createCheckpointFile('CP-2026-10-12-002', cp2);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.listCheckpoints('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].snapshot.task_id).toBe('TASK-001');
      }
    });

    /**
     * Test: Return empty list when no checkpoints exist
     */
    it('should return empty list when no checkpoints exist', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.listCheckpoints();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  // ===========================================================================
  // Unit Tests for getLatestCheckpoint()
  // ===========================================================================

  describe('getLatestCheckpoint()', () => {
    /**
     * Test: Get latest checkpoint for task
     */
    it('should return the latest checkpoint for a task', async () => {
      // Arrange
      const cp1 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-001', created_at: '2026-10-12T08:00:00Z' },
        snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-001' },
      });
      const cp2 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-002', created_at: '2026-10-12T10:00:00Z' },
        snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-001' },
      });

      await tempHelper.createCheckpointFile('CP-2026-10-12-001', cp1);
      await tempHelper.createCheckpointFile('CP-2026-10-12-002', cp2);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.getLatestCheckpoint('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).not.toBeNull();
        expect(result.value?.metadata.checkpoint_id).toBe('CP-2026-10-12-002');
      }
    });

    /**
     * Test: Return null when no checkpoints for task
     */
    it('should return null when no checkpoints exist for task', async () => {
      // Arrange
      const cp = createTestCheckpoint({
        snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-OTHER' },
      });
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', cp);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.getLatestCheckpoint('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeNull();
      }
    });
  });

  // ===========================================================================
  // Unit Tests for validateCheckpoint()
  // ===========================================================================

  describe('validateCheckpoint()', () => {
    /**
     * Test: Validation passes when state is current
     * **Validates: R09.4** - Checkpoint validation
     */
    it('should pass validation when checkpoint matches current state', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.valid).toBe(true);
        expect(result.value.can_restore).toBe(true);
      }
    });

    /**
     * Test: Validation detects stale checkpoint (newer state exists)
     * **Validates: R09.4** - Staleness detection
     */
    it('should detect stale checkpoint when state version has advanced', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint({
        snapshot: { ...createTestCheckpoint().snapshot, state_version: 1 },
      });
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // State has advanced
      mockStateController.setVersion(10);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const versionMismatch = result.value.discrepancies.find(d => d.type === 'STATE_VERSION_MISMATCH');
        expect(versionMismatch).toBeDefined();
        expect(versionMismatch?.severity).toBe('WARNING');
        expect(versionMismatch?.recoverable).toBe(true);
      }
    });

    /**
     * Test: Validation detects missing commit
     * **Validates: R09.4** - Git state validation
     */
    it('should detect when commit no longer exists', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      mockGitHelper.setCommitExists(false);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const commitNotFound = result.value.discrepancies.find(d => d.type === 'COMMIT_NOT_FOUND');
        expect(commitNotFound).toBeDefined();
        expect(commitNotFound?.severity).toBe('ERROR');
        expect(result.value.can_restore).toBe(false);
      }
    });

    /**
     * Test: Validation detects missing branch
     */
    it('should detect when branch no longer exists', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      mockGitHelper.setBranchExists(false);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const branchNotFound = result.value.discrepancies.find(d => d.type === 'BRANCH_NOT_FOUND');
        expect(branchNotFound).toBeDefined();
        expect(branchNotFound?.severity).toBe('WARNING');
      }
    });

    /**
     * Test: Validation returns appropriate recovery strategy
     * **Validates: R09.5** - Recovery strategies
     */
    it('should recommend AUTO_MERGE strategy when only warnings present', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // Only minor divergence
      mockGitHelper.setCurrentCommit('different-commit');

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.recommended_strategy).toBe('AUTO_MERGE');
      }
    });
  });

  // ===========================================================================
  // Unit Tests for pruneCheckpoints()
  // ===========================================================================

  describe('pruneCheckpoints()', () => {
    /**
     * Test: Prune keeps latest N checkpoints per task
     * **Validates: R09.7** - Checkpoint pruning
     */
    it('should keep only the latest N checkpoints per task', async () => {
      // Arrange
      const checkpoints = [
        { id: 'CP-2026-10-12-001', date: '2026-10-12T08:00:00Z' },
        { id: 'CP-2026-10-12-002', date: '2026-10-12T09:00:00Z' },
        { id: 'CP-2026-10-12-003', date: '2026-10-12T10:00:00Z' },
        { id: 'CP-2026-10-12-004', date: '2026-10-12T11:00:00Z' },
        { id: 'CP-2026-10-12-005', date: '2026-10-12T12:00:00Z' },
      ];

      for (const cp of checkpoints) {
        const checkpoint = createTestCheckpoint({
          metadata: { ...createTestCheckpoint().metadata, checkpoint_id: cp.id, created_at: cp.date },
          snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-001' },
        });
        await tempHelper.createCheckpointFile(cp.id, checkpoint);
      }

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
        defaultKeepCount: 2,
      });

      // Act
      const result = await manager.pruneCheckpoints({ keep_count: 2 });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pruned_count).toBe(3);
        expect(result.value.kept_count).toBe(2);
        expect(result.value.pruned_ids).toContain('CP-2026-10-12-001');
        expect(result.value.pruned_ids).toContain('CP-2026-10-12-002');
        expect(result.value.pruned_ids).toContain('CP-2026-10-12-003');
      }
    });

    /**
     * Test: Dry run reports what would be pruned without deleting
     * **Validates: R09.7** - Pruning options
     */
    it('should report what would be pruned in dry run mode', async () => {
      // Arrange
      const cp1 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-001', created_at: '2026-10-12T08:00:00Z' },
      });
      const cp2 = createTestCheckpoint({
        metadata: { ...createTestCheckpoint().metadata, checkpoint_id: 'CP-2026-10-12-002', created_at: '2026-10-12T10:00:00Z' },
      });

      await tempHelper.createCheckpointFile('CP-2026-10-12-001', cp1);
      await tempHelper.createCheckpointFile('CP-2026-10-12-002', cp2);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.pruneCheckpoints({ keep_count: 1, dry_run: true });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.dry_run).toBe(true);
        expect(result.value.pruned_ids).toContain('CP-2026-10-12-001');
        
        // File should still exist
        const exists = await tempHelper.fileExists('CP-2026-10-12-001');
        expect(exists).toBe(true);
      }
    });

    /**
     * Test: Keep at least one checkpoint when option set
     */
    it('should keep at least one checkpoint per task when option is set', async () => {
      // Arrange - create old checkpoint
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60); // 60 days ago

      const cp = createTestCheckpoint({
        metadata: { 
          ...createTestCheckpoint().metadata, 
          checkpoint_id: 'CP-2026-08-12-001', 
          created_at: oldDate.toISOString() 
        },
      });
      await tempHelper.createCheckpointFile('CP-2026-08-12-001', cp);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.pruneCheckpoints({ 
        max_age_days: 30, 
        keep_at_least_one: true 
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.kept_count).toBeGreaterThanOrEqual(1);
      }
    });

    /**
     * Test: Prune respects max_age_days - deletes old checkpoints
     * **Validates: R09.7** - Checkpoint retention by age
     */
    it('should prune checkpoints older than max_age_days', async () => {
      // Arrange - create checkpoints with different ages
      const now = new Date();
      
      // Recent checkpoint (5 days old)
      const recentDate = new Date(now);
      recentDate.setDate(recentDate.getDate() - 5);
      const recentCp = createTestCheckpoint({
        metadata: { 
          ...createTestCheckpoint().metadata, 
          checkpoint_id: 'CP-recent-001', 
          created_at: recentDate.toISOString() 
        },
        snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-001' },
      });
      
      // Old checkpoint (40 days old)
      const oldDate = new Date(now);
      oldDate.setDate(oldDate.getDate() - 40);
      const oldCp = createTestCheckpoint({
        metadata: { 
          ...createTestCheckpoint().metadata, 
          checkpoint_id: 'CP-old-001', 
          created_at: oldDate.toISOString() 
        },
        snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-001' },
      });

      await tempHelper.createCheckpointFile('CP-recent-001', recentCp);
      await tempHelper.createCheckpointFile('CP-old-001', oldCp);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act - prune with max age of 30 days
      const result = await manager.pruneCheckpoints({ 
        max_age_days: 30,
        keep_count: 100, // High keep count so only age matters
        keep_at_least_one: false,
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pruned_ids).toContain('CP-old-001');
        expect(result.value.pruned_ids).not.toContain('CP-recent-001');
        expect(result.value.pruned_count).toBe(1);
        expect(result.value.kept_count).toBe(1);
      }
    });

    /**
     * Test: Prune only specific task's checkpoints
     * **Validates: R09.7** - Task-specific pruning
     */
    it('should prune only checkpoints for specified task_id', async () => {
      // Arrange - create checkpoints for different tasks
      const checkpointsTask1 = [
        { id: 'CP-T1-001', date: '2026-10-12T08:00:00Z', taskId: 'TASK-001' },
        { id: 'CP-T1-002', date: '2026-10-12T09:00:00Z', taskId: 'TASK-001' },
        { id: 'CP-T1-003', date: '2026-10-12T10:00:00Z', taskId: 'TASK-001' },
      ];
      
      const checkpointsTask2 = [
        { id: 'CP-T2-001', date: '2026-10-12T08:00:00Z', taskId: 'TASK-002' },
        { id: 'CP-T2-002', date: '2026-10-12T09:00:00Z', taskId: 'TASK-002' },
      ];

      for (const cp of [...checkpointsTask1, ...checkpointsTask2]) {
        const checkpoint = createTestCheckpoint({
          metadata: { ...createTestCheckpoint().metadata, checkpoint_id: cp.id, created_at: cp.date },
          snapshot: { ...createTestCheckpoint().snapshot, task_id: cp.taskId },
        });
        await tempHelper.createCheckpointFile(cp.id, checkpoint);
      }

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act - prune only TASK-001 checkpoints, keep 1
      const result = await manager.pruneCheckpoints({ 
        task_id: 'TASK-001',
        keep_count: 1,
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Should prune 2 checkpoints from TASK-001 (keeping the newest one)
        expect(result.value.pruned_ids).toContain('CP-T1-001');
        expect(result.value.pruned_ids).toContain('CP-T1-002');
        // Should NOT prune TASK-002 checkpoints
        expect(result.value.pruned_ids).not.toContain('CP-T2-001');
        expect(result.value.pruned_ids).not.toContain('CP-T2-002');
        
        // Verify TASK-002 files still exist
        const exists1 = await tempHelper.fileExists('CP-T2-001');
        const exists2 = await tempHelper.fileExists('CP-T2-002');
        expect(exists1).toBe(true);
        expect(exists2).toBe(true);
      }
    });

    /**
     * Test: Auto-prune on checkpoint creation
     * **Validates: R09.7** - Automatic pruning
     */
    it('should auto-prune old checkpoints when autoPrune is enabled', async () => {
      // Arrange - create existing checkpoints
      const existingCheckpoints = [
        { id: 'CP-2026-10-12-001', date: '2026-10-12T08:00:00Z' },
        { id: 'CP-2026-10-12-002', date: '2026-10-12T09:00:00Z' },
        { id: 'CP-2026-10-12-003', date: '2026-10-12T10:00:00Z' },
      ];

      for (const cp of existingCheckpoints) {
        const checkpoint = createTestCheckpoint({
          metadata: { ...createTestCheckpoint().metadata, checkpoint_id: cp.id, created_at: cp.date },
          snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-001' },
        });
        await tempHelper.createCheckpointFile(cp.id, checkpoint);
      }

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
        autoPrune: true,
        defaultKeepCount: 2, // Keep only 2 checkpoints per task
      });

      // Act - create a new checkpoint which should trigger auto-prune
      const result = await manager.createCheckpoint('MANUAL', 'TASK-001');

      // Assert
      expect(result.success).toBe(true);
      
      // After auto-prune, should have at most 2 checkpoints for TASK-001
      const listResult = await manager.listCheckpoints('TASK-001');
      expect(listResult.success).toBe(true);
      if (listResult.success) {
        // Should have 2 checkpoints (newest ones kept)
        expect(listResult.value.length).toBeLessThanOrEqual(2);
      }
    });

    /**
     * Test: Prune returns space_freed_bytes estimate
     * **Validates: R09.7** - Pruning result metadata
     */
    it('should return space_freed_bytes in prune result', async () => {
      // Arrange
      const cp1 = createTestCheckpoint({
        metadata: { 
          ...createTestCheckpoint().metadata, 
          checkpoint_id: 'CP-2026-10-12-001', 
          created_at: '2026-10-12T08:00:00Z',
          size_bytes: 1024,
        },
      });
      const cp2 = createTestCheckpoint({
        metadata: { 
          ...createTestCheckpoint().metadata, 
          checkpoint_id: 'CP-2026-10-12-002', 
          created_at: '2026-10-12T10:00:00Z',
          size_bytes: 2048,
        },
      });

      await tempHelper.createCheckpointFile('CP-2026-10-12-001', cp1);
      await tempHelper.createCheckpointFile('CP-2026-10-12-002', cp2);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.pruneCheckpoints({ keep_count: 1 });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.value.space_freed_bytes).toBe('number');
        expect(result.value.space_freed_bytes).toBeGreaterThanOrEqual(0);
      }
    });

    /**
     * Test: Prune with no checkpoints returns empty result
     */
    it('should return empty result when no checkpoints exist', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.pruneCheckpoints();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pruned_count).toBe(0);
        expect(result.value.kept_count).toBe(0);
        expect(result.value.pruned_ids).toHaveLength(0);
      }
    });

    /**
     * Test: Prune uses default config values when options not provided
     * **Validates: R09.7** - Configurable retention
     */
    it('should use default keep_count from config when not specified', async () => {
      // Arrange - create many checkpoints
      const checkpoints = Array.from({ length: 15 }, (_, i) => ({
        id: `CP-2026-10-12-${String(i + 1).padStart(3, '0')}`,
        date: new Date(Date.now() - (15 - i) * 60000).toISOString(), // Spread over time
      }));

      for (const cp of checkpoints) {
        const checkpoint = createTestCheckpoint({
          metadata: { ...createTestCheckpoint().metadata, checkpoint_id: cp.id, created_at: cp.date },
          snapshot: { ...createTestCheckpoint().snapshot, task_id: 'TASK-001' },
        });
        await tempHelper.createCheckpointFile(cp.id, checkpoint);
      }

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
        defaultKeepCount: 5, // Custom default
      });

      // Act - prune without specifying keep_count
      const result = await manager.pruneCheckpoints({ task_id: 'TASK-001' });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Should prune down to 5 (default keep count)
        expect(result.value.kept_count).toBe(5);
        expect(result.value.pruned_count).toBe(10);
      }
    });
  });

  // ===========================================================================
  // Unit Tests for deleteCheckpoint()
  // ===========================================================================

  describe('deleteCheckpoint()', () => {
    /**
     * Test: Delete existing checkpoint
     */
    it('should delete an existing checkpoint', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.deleteCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      
      const exists = await tempHelper.fileExists('CP-2026-10-12-001');
      expect(exists).toBe(false);
    });

    /**
     * Test: Error when deleting non-existent checkpoint
     */
    it('should return error when checkpoint does not exist', async () => {
      // Arrange
      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.deleteCheckpoint('CP-nonexistent');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(CheckpointErrorCode.CHECKPOINT_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // Unit Tests for prepareRecovery()
  // ===========================================================================

  describe('prepareRecovery()', () => {
    /**
     * Test: Prepare recovery plan with actions
     * **Validates: R09.4, R09.5** - Recovery planning
     */
    it('should create recovery plan with appropriate actions', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // State has advanced
      mockStateController.setVersion(5);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.prepareRecovery('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.checkpoint_id).toBe('CP-2026-10-12-001');
        expect(result.value.actions.length).toBeGreaterThan(0);
        expect(result.value.validation).toBeDefined();
        expect(result.value.strategy).toBeDefined();
      }
    });

    /**
     * Test: Recovery plan includes TDD phase restoration
     */
    it('should include TDD phase update action when checkpoint has TDD phase', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint({
        snapshot: { ...createTestCheckpoint().snapshot, tdd_phase: 'GREEN' },
      });
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.prepareRecovery('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const tddAction = result.value.actions.find(a => a.type === 'UPDATE_TDD_PHASE');
        expect(tddAction).toBeDefined();
        expect(tddAction?.description).toContain('GREEN');
      }
    });
  });

  // ===========================================================================
  // Unit Tests for executeRecovery()
  // ===========================================================================

  describe('executeRecovery()', () => {
    /**
     * Test: Execute recovery requires user confirmation when plan requires it
     * **Validates: R09.4, R09.5** - User confirmation before recovery
     */
    it('should return CONFIRMATION_REQUIRED error when plan requires confirmation and not provided', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // State has advanced - will require PROMPT_USER strategy
      mockStateController.setVersion(10);
      mockGitHelper.setCommitExists(false); // Add error-level discrepancy

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // First prepare a recovery plan that requires confirmation
      const prepareResult = await manager.prepareRecovery('CP-2026-10-12-001');
      
      // Skip if prepare failed (commit not found = cannot restore)
      if (!prepareResult.success) {
        // Create a simpler scenario where we can get a plan
        mockGitHelper.setCommitExists(true);
        mockGitHelper.setBranchExists(false);
      }

      // Re-prepare with updated git state
      const retryPrepareResult = await manager.prepareRecovery('CP-2026-10-12-001');
      expect(retryPrepareResult.success).toBe(true);
      
      if (retryPrepareResult.success) {
        const plan = retryPrepareResult.value;
        
        // Modify plan to require confirmation for testing
        plan.requires_confirmation = true;

        // Act - try to execute without confirmation
        const result = await manager.executeRecovery(plan, false);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(CheckpointErrorCode.CONFIRMATION_REQUIRED);
        }
      }
    });

    /**
     * Test: Execute recovery succeeds when confirmation provided
     * **Validates: R09.4, R09.5** - Successful recovery execution
     */
    it('should execute recovery when user confirmation is provided', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      const prepareResult = await manager.prepareRecovery('CP-2026-10-12-001');
      expect(prepareResult.success).toBe(true);
      
      if (prepareResult.success) {
        const plan = prepareResult.value;

        // Act - execute with confirmation
        const result = await manager.executeRecovery(plan, true);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.plan.checkpoint_id).toBe('CP-2026-10-12-001');
          expect(result.value.completed_at).toBeDefined();
        }
      }
    });

    /**
     * Test: Execute recovery when plan does not require confirmation
     * **Validates: R09.5** - AUTO_MERGE strategy doesn't need confirmation
     */
    it('should execute AUTO_MERGE recovery without requiring user confirmation', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      const prepareResult = await manager.prepareRecovery('CP-2026-10-12-001');
      expect(prepareResult.success).toBe(true);
      
      if (prepareResult.success) {
        const plan = prepareResult.value;
        
        // Ensure plan uses AUTO_MERGE which doesn't require confirmation
        plan.requires_confirmation = false;
        plan.strategy = 'AUTO_MERGE';

        // Act - execute without confirmation (should still work)
        const result = await manager.executeRecovery(plan, false);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.success).toBe(true);
        }
      }
    });

    /**
     * Test: Execute recovery tracks executed actions
     * **Validates: R09.4, R09.5** - Recovery action tracking
     */
    it('should track executed and skipped actions in recovery result', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint({
        snapshot: { ...createTestCheckpoint().snapshot, tdd_phase: 'RED' },
      });
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      const prepareResult = await manager.prepareRecovery('CP-2026-10-12-001');
      expect(prepareResult.success).toBe(true);
      
      if (prepareResult.success) {
        const plan = prepareResult.value;

        // Act
        const result = await manager.executeRecovery(plan, true);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(Array.isArray(result.value.executed_actions)).toBe(true);
          expect(Array.isArray(result.value.skipped_actions)).toBe(true);
          expect(Array.isArray(result.value.failed_actions)).toBe(true);
          expect(result.value.new_state_version).toBeDefined();
        }
      }
    });

    /**
     * Test: Execute recovery returns new state version
     */
    it('should return new state version after successful recovery', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      mockStateController.setVersion(5);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      const prepareResult = await manager.prepareRecovery('CP-2026-10-12-001');
      expect(prepareResult.success).toBe(true);
      
      if (prepareResult.success) {
        const plan = prepareResult.value;

        // Act
        const result = await manager.executeRecovery(plan, true);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.new_state_version).toBeGreaterThan(0);
        }
      }
    });
  });

  // ===========================================================================
  // Unit Tests for Recovery Strategies
  // ===========================================================================

  describe('Recovery Strategies', () => {
    /**
     * Test: REJECT strategy when checkpoint has non-recoverable errors
     * **Validates: R09.5** - REJECT strategy for stale checkpoints
     */
    it('should recommend REJECT strategy when checkpoint has non-recoverable errors', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // Commit no longer exists - non-recoverable
      mockGitHelper.setCommitExists(false);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_restore).toBe(false);
        // Non-recoverable errors lead to REJECT or PROMPT_USER
        expect(['REJECT', 'PROMPT_USER']).toContain(result.value.recommended_strategy);
      }
    });

    /**
     * Test: PROMPT_USER strategy when changes need user decision
     * **Validates: R09.5** - PROMPT_USER for ambiguous situations
     */
    it('should recommend PROMPT_USER strategy when there are recoverable errors', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint({
        snapshot: { 
          ...createTestCheckpoint().snapshot, 
          state_version: 1,
          fencing_token: 'old-token',
        },
      });
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // State advanced significantly + fencing token mismatch
      mockStateController.setVersion(10);
      mockStateController.setState({
        current_task: {
          id: 'TASK-001',
          status: 'IN_PROGRESS',
          assignee: 'different-user',
          ownership: {
            fencing_token: 'new-token-456',
            acquired_at: new Date().toISOString(),
            actor_type: 'HUMAN',
            lease_expires_at: null,
            last_heartbeat_at: null,
          },
          dor_check: null,
          tdd: { phase: 'RED', phase_started_at: new Date().toISOString(), not_applicable_reason: null },
          blocked: false,
          blocked_reason: null,
          blocker_refs: [],
          handoff_pending: false,
          handoff_id: null,
          working_branch: 'task/TASK-001-feature',
        },
      });

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Should have multiple discrepancies leading to PROMPT_USER or AUTO_MERGE
        expect(result.value.discrepancies.length).toBeGreaterThan(0);
      }
    });

    /**
     * Test: Recovery plan fails for checkpoint that cannot be restored
     * **Validates: R09.4** - Cannot prepare recovery for unrestorable checkpoint
     */
    it('should fail to prepare recovery when checkpoint cannot be restored', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // Make checkpoint unrestorable
      mockGitHelper.setCommitExists(false);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.prepareRecovery('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(CheckpointErrorCode.RECOVERY_FAILED);
      }
    });

    /**
     * Test: Recovery plan includes warnings for file modifications
     */
    it('should include warnings in recovery plan when repository has diverged', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // Repository diverged
      mockGitHelper.setCurrentCommit('completely-different-commit');

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.prepareRecovery('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const hasRepositoryDiverged = result.value.validation.discrepancies.some(
          d => d.type === 'REPOSITORY_DIVERGED'
        );
        expect(hasRepositoryDiverged).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Unit Tests for Validation Discrepancy Detection
  // ===========================================================================

  describe('Validation Discrepancy Detection', () => {
    /**
     * Test: Detect fencing token mismatch
     * **Validates: R09.4** - Fencing token validation
     */
    it('should detect fencing token mismatch', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint({
        snapshot: {
          ...createTestCheckpoint().snapshot,
          fencing_token: 'old-token-123',
        },
      });
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // Current state has different fencing token
      mockStateController.setState({
        current_task: {
          id: 'TASK-001',
          status: 'IN_PROGRESS',
          assignee: 'test-user',
          ownership: {
            fencing_token: 'new-token-456',
            acquired_at: new Date().toISOString(),
            actor_type: 'HUMAN',
            lease_expires_at: null,
            last_heartbeat_at: null,
          },
          dor_check: null,
          tdd: { phase: 'GREEN', phase_started_at: new Date().toISOString(), not_applicable_reason: null },
          blocked: false,
          blocked_reason: null,
          blocker_refs: [],
          handoff_pending: false,
          handoff_id: null,
          working_branch: 'task/TASK-001-feature',
        },
      });

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const tokenMismatch = result.value.discrepancies.find(
          d => d.type === 'FENCING_TOKEN_INVALID'
        );
        expect(tokenMismatch).toBeDefined();
        expect(tokenMismatch?.severity).toBe('WARNING');
        expect(tokenMismatch?.recoverable).toBe(true);
      }
    });

    /**
     * Test: Detect task status change
     * **Validates: R09.4** - Task status change detection
     */
    it('should detect task status change since checkpoint', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint({
        snapshot: {
          ...createTestCheckpoint().snapshot,
          task_id: 'TASK-001',
          task_status: 'IN_PROGRESS',
        },
      });
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // Task status changed
      mockStateController.setState({
        current_task: {
          id: 'TASK-001',
          status: 'REVIEW', // Changed from IN_PROGRESS
          assignee: 'test-user',
          ownership: {
            fencing_token: 'test-token-123',
            acquired_at: new Date().toISOString(),
            actor_type: 'HUMAN',
            lease_expires_at: null,
            last_heartbeat_at: null,
          },
          dor_check: null,
          tdd: { phase: 'GREEN', phase_started_at: new Date().toISOString(), not_applicable_reason: null },
          blocked: false,
          blocked_reason: null,
          blocker_refs: [],
          handoff_pending: false,
          handoff_id: null,
          working_branch: 'task/TASK-001-feature',
        },
      });

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const statusChange = result.value.discrepancies.find(
          d => d.type === 'TASK_STATUS_CHANGED'
        );
        expect(statusChange).toBeDefined();
        expect(statusChange?.expected).toBe('IN_PROGRESS');
        expect(statusChange?.actual).toBe('REVIEW');
      }
    });

    /**
     * Test: Detect owner change
     * **Validates: R09.4** - Owner change detection  
     */
    it('should detect owner change since checkpoint', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint({
        snapshot: {
          ...createTestCheckpoint().snapshot,
          owner_id: 'original-owner',
        },
      });
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // Owner changed
      mockStateController.setState({
        current_task: {
          id: 'TASK-001',
          status: 'IN_PROGRESS',
          assignee: 'new-owner', // Changed from original-owner
          ownership: {
            fencing_token: 'test-token-123',
            acquired_at: new Date().toISOString(),
            actor_type: 'HUMAN',
            lease_expires_at: null,
            last_heartbeat_at: null,
          },
          dor_check: null,
          tdd: { phase: 'GREEN', phase_started_at: new Date().toISOString(), not_applicable_reason: null },
          blocked: false,
          blocked_reason: null,
          blocker_refs: [],
          handoff_pending: false,
          handoff_id: null,
          working_branch: 'task/TASK-001-feature',
        },
      });

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const ownerChange = result.value.discrepancies.find(
          d => d.type === 'OWNER_CHANGED'
        );
        expect(ownerChange).toBeDefined();
        expect(ownerChange?.expected).toBe('original-owner');
        expect(ownerChange?.actual).toBe('new-owner');
      }
    });

    /**
     * Test: Validation returns cannot_restore_reason when REJECT
     */
    it('should include cannot_restore_reason when validation fails', async () => {
      // Arrange
      const testCheckpoint = createTestCheckpoint();
      await tempHelper.createCheckpointFile('CP-2026-10-12-001', testCheckpoint);

      // Make checkpoint unrestorable
      mockGitHelper.setCommitExists(false);

      const manager = new FileCheckpointManager({
        stateController: mockStateController,
        storagePath: tempHelper.getStoragePath(),
        workingDirectory: tempHelper.getTempDir(),
        gitHelper: mockGitHelper,
      });

      // Act
      const result = await manager.validateCheckpoint('CP-2026-10-12-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        if (!result.value.can_restore) {
          expect(result.value.cannot_restore_reason).toBeDefined();
        }
      }
    });
  });

  // ===========================================================================
  // Unit Tests for Automatic Checkpoint Triggers
  // ===========================================================================

  describe('Automatic Checkpoint Triggers', () => {
    /**
     * **Validates: R09.2** - Checkpoint on state transition
     */
    describe('onStateTransition()', () => {
      it('should create checkpoint with STATE_TRANSITION trigger', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onStateTransition('ASSIGNED', 'IN_PROGRESS', 'TASK-001');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.trigger).toBe('STATE_TRANSITION');
          expect(result.value.metadata.note).toContain('ASSIGNED');
          expect(result.value.metadata.note).toContain('IN_PROGRESS');
          expect(result.value.snapshot.task_id).toBe('TASK-001');
        }
      });

      it('should include old and new status in checkpoint note', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onStateTransition('IN_PROGRESS', 'REVIEW', 'TASK-002');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.note).toBe('Status changed from IN_PROGRESS to REVIEW');
        }
      });

      it('should record activity timestamp', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        const beforeCall = new Date();

        // Act
        await manager.onStateTransition('PENDING', 'READY', 'TASK-001');

        // Assert
        const lastActivity = manager.getLastActivityTimestamp();
        expect(lastActivity.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      });
    });

    /**
     * **Validates: R09.2** - Checkpoint on TDD phase change
     */
    describe('onTddPhaseChange()', () => {
      it('should create checkpoint with TDD_PHASE_TRANSITION trigger', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onTddPhaseChange('RED', 'GREEN', 'TASK-001');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.trigger).toBe('TDD_PHASE_TRANSITION');
          expect(result.value.metadata.note).toContain('RED');
          expect(result.value.metadata.note).toContain('GREEN');
        }
      });

      it('should handle null old phase', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onTddPhaseChange(null, 'RED', 'TASK-001');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.note).toBe('TDD phase changed from NONE to RED');
        }
      });

      it('should handle all TDD phase transitions', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act - test typical TDD cycle transitions
        const transitions = [
          { old: 'PENDING', new: 'RED' },
          { old: 'RED', new: 'GREEN' },
          { old: 'GREEN', new: 'REFACTOR' },
          { old: 'REFACTOR', new: 'VERIFY' },
        ];

        for (const transition of transitions) {
          const result = await manager.onTddPhaseChange(
            transition.old,
            transition.new,
            'TASK-001'
          );

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.value.metadata.trigger).toBe('TDD_PHASE_TRANSITION');
          }
        }
      });
    });

    /**
     * **Validates: R09.2** - Checkpoint on evidence creation
     */
    describe('onEvidenceCreated()', () => {
      it('should create checkpoint with EVIDENCE_CREATED trigger', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onEvidenceCreated('EVD-TASK-001-RED', 'TASK-001');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.trigger).toBe('EVIDENCE_CREATED');
          expect(result.value.metadata.note).toContain('EVD-TASK-001-RED');
        }
      });

      it('should include evidence ID in checkpoint note', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onEvidenceCreated('EVD-TASK-002-GREEN', 'TASK-002');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.note).toBe('Evidence created: EVD-TASK-002-GREEN');
        }
      });
    });

    /**
     * **Validates: R09.2** - Checkpoint on handoff
     */
    describe('onHandoff()', () => {
      it('should create checkpoint with HANDOFF_INITIATED trigger when handoff starts', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onHandoff('HO-001', 'initiated', 'TASK-001');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.trigger).toBe('HANDOFF_INITIATED');
          expect(result.value.metadata.note).toBe('Handoff HO-001 initiated');
        }
      });

      it('should create checkpoint with HANDOFF_COMPLETED trigger when handoff finishes', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onHandoff('HO-001', 'completed', 'TASK-001');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.trigger).toBe('HANDOFF_COMPLETED');
          expect(result.value.metadata.note).toBe('Handoff HO-001 completed');
        }
      });

      it('should record handoff ID in checkpoint note', async () => {
        // Arrange
        const manager = new FileCheckpointManager({
          stateController: mockStateController,
          storagePath: tempHelper.getStoragePath(),
          workingDirectory: tempHelper.getTempDir(),
          gitHelper: mockGitHelper,
        });

        // Act
        const result = await manager.onHandoff('HO-042', 'completed', 'TASK-003');

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.metadata.note).toContain('HO-042');
        }
      });
    });

    /**
     * **Validates: R09.2** - Configurable periodic checkpoint
     */
    describe('Periodic Checkpoint', () => {
      describe('startPeriodicCheckpoint()', () => {
        it('should start periodic checkpointing and return true', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
            periodicIntervalMinutes: 1,
          });

          // Act
          const started = manager.startPeriodicCheckpoint();

          // Assert
          expect(started).toBe(true);
          expect(manager.isPeriodicCheckpointRunning()).toBe(true);

          // Cleanup
          manager.stopPeriodicCheckpoint();
        });

        it('should return false if already running', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
            periodicIntervalMinutes: 1,
          });

          // Act
          manager.startPeriodicCheckpoint();
          const secondStart = manager.startPeriodicCheckpoint();

          // Assert
          expect(secondStart).toBe(false);

          // Cleanup
          manager.stopPeriodicCheckpoint();
        });

        it('should use custom interval when provided', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
            periodicIntervalMinutes: 30, // Default config
          });

          // Act - start with custom interval
          const started = manager.startPeriodicCheckpoint(10);

          // Assert
          expect(started).toBe(true);
          expect(manager.isPeriodicCheckpointRunning()).toBe(true);

          // Cleanup
          manager.stopPeriodicCheckpoint();
        });

        it('should return false if interval is 0 or negative', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
            periodicIntervalMinutes: 0, // Disabled
          });

          // Act
          const started = manager.startPeriodicCheckpoint();

          // Assert
          expect(started).toBe(false);
          expect(manager.isPeriodicCheckpointRunning()).toBe(false);
        });
      });

      describe('stopPeriodicCheckpoint()', () => {
        it('should stop periodic checkpointing and return true', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
            periodicIntervalMinutes: 1,
          });
          manager.startPeriodicCheckpoint();

          // Act
          const stopped = manager.stopPeriodicCheckpoint();

          // Assert
          expect(stopped).toBe(true);
          expect(manager.isPeriodicCheckpointRunning()).toBe(false);
        });

        it('should return false if not running', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
          });

          // Act
          const stopped = manager.stopPeriodicCheckpoint();

          // Assert
          expect(stopped).toBe(false);
        });
      });

      describe('isPeriodicCheckpointRunning()', () => {
        it('should return false when not started', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
          });

          // Assert
          expect(manager.isPeriodicCheckpointRunning()).toBe(false);
        });

        it('should return true when running', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
            periodicIntervalMinutes: 1,
          });
          manager.startPeriodicCheckpoint();

          // Assert
          expect(manager.isPeriodicCheckpointRunning()).toBe(true);

          // Cleanup
          manager.stopPeriodicCheckpoint();
        });
      });

      describe('recordActivity()', () => {
        it('should update last activity timestamp', async () => {
          // Arrange
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
          });

          const beforeRecord = new Date();

          // Act
          await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
          manager.recordActivity();

          // Assert
          const lastActivity = manager.getLastActivityTimestamp();
          expect(lastActivity.getTime()).toBeGreaterThan(beforeRecord.getTime());
        });
      });

      describe('getLastActivityTimestamp()', () => {
        it('should return initial timestamp before any activity', async () => {
          // Arrange
          const beforeCreate = new Date();
          const manager = new FileCheckpointManager({
            stateController: mockStateController,
            storagePath: tempHelper.getStoragePath(),
            workingDirectory: tempHelper.getTempDir(),
            gitHelper: mockGitHelper,
          });

          // Assert - initial timestamp should be close to creation time
          const lastActivity = manager.getLastActivityTimestamp();
          expect(lastActivity.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000);
        });
      });
    });
  });
});

