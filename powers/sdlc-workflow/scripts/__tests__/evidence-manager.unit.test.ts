/**
 * Unit Tests for Evidence_Manager - Evidence Creation Operations
 * 
 * These tests verify the FileEvidenceManager functionality including:
 * - createEvidence() - Create evidence records with full metadata
 * - Git state capture (commit SHA, dirty status)
 * - Executor info recording
 * - File hash computation for staleness tracking
 * 
 * Following TDD methodology - tests written first to define expected behavior.
 * 
 * **Validates: Requirements R06.1**
 * 
 * Test Scenarios (Task T19):
 * 1. Create evidence with all required fields
 * 2. Evidence ID generated correctly (EVD-{task_id}-{phase} format)
 * 3. Git state captured (commit SHA, branch, dirty status)
 * 4. Executor info recorded (id, type: HUMAN/AI_AGENT)
 * 5. File hashes computed for staleness tracking
 * 6. Evidence stored to .kiro/sdlc/evidence/ directory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  Evidence,
  EvidenceInput,
  EvidenceManager,
  EvidenceType,
  EvidenceResultStatus,
  EvidenceError,
  EvidenceErrorCode,
  EVIDENCE_DEFAULTS,
  generateEvidenceId,
  isValidEvidenceType,
  isValidResultStatus,
  createEvidenceResult,
  createDefaultStalenessInfo,
  validateRedPhaseEvidence,
  validateGreenPhaseEvidence,
  validateRefactorPhaseEvidence,
} from '../evidence-manager';
import { FileEvidenceManager, FileEvidenceManagerConfig, MockGitClient, GitClient } from '../evidence-manager-impl';
import { ActorType, TddPhase } from '../state-controller';

// =============================================================================
// Test Helper - Temporary File Management
// =============================================================================

class TempFileHelper {
  private tempDir: string = '';
  private files: string[] = [];
  private dirs: string[] = [];

  async setup(): Promise<void> {
    this.tempDir = path.join(process.cwd(), '.test-temp', `evidence-manager-${Date.now()}`);
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
    for (const dir of [...this.dirs].reverse()) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
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
    this.dirs = [];
  }

  async createFile(filename: string, content: string): Promise<string> {
    const filePath = path.join(this.tempDir, filename);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    if (!this.dirs.includes(dir)) {
      this.dirs.push(dir);
    }
    await fs.writeFile(filePath, content, 'utf-8');
    this.files.push(filePath);
    return filePath;
  }

  async createDir(dirname: string): Promise<string> {
    const dirPath = path.join(this.tempDir, dirname);
    await fs.mkdir(dirPath, { recursive: true });
    this.dirs.push(dirPath);
    return dirPath;
  }

  getPath(filename: string): string {
    return path.join(this.tempDir, filename);
  }

  getTempDir(): string {
    return this.tempDir;
  }
}

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Creates a valid evidence input for testing
 */
const createValidEvidenceInput = (overrides: Partial<EvidenceInput> = {}): EvidenceInput => ({
  task_id: 'TASK-001',
  type: 'TDD_RED' as EvidenceType,
  tdd_phase: 'RED' as TddPhase,
  requirement_refs: ['REQ-001'],
  ac_refs: ['REQ-001-AC1'],
  command: 'npm test -- --grep "user authentication"',
  working_directory: '/project',
  config: {
    test_framework: 'vitest',
    config_file: 'vitest.config.ts',
  },
  duration_ms: 1250,
  exit_code: 1, // Non-zero for RED phase (test fails)
  result: {
    status: 'FAIL' as EvidenceResultStatus,
    summary: 'Test correctly fails: should authenticate valid user',
    test_file: 'src/auth.test.ts',
    test_name: 'user authentication > should authenticate valid user',
    failure_type: 'BEHAVIOR_MISSING',
    tests_passed: 0,
    tests_failed: 1,
    tests_total: 1,
  },
  executor_id: 'dev-001',
  executor_type: 'HUMAN' as ActorType,
  related_files: ['src/auth.ts', 'src/auth.test.ts'],
  ...overrides,
});

/**
 * Creates a mock git client for testing
 */
const createMockGitClient = (overrides: Partial<MockGitClient> = {}): MockGitClient => ({
  getCurrentCommitSha: async () => 'abc123def456789012345678901234567890abcd',
  getCurrentBranch: async () => 'task/TASK-001-user-auth',
  isWorkingTreeDirty: async () => false,
  getUncommittedFiles: async () => [],
  commitExists: async () => true,
  getFileHash: async (filePath: string) => `sha256:${filePath.replace(/[^a-z0-9]/gi, '')}hash`,
  getChangedFilesBetween: async () => [],
  ...overrides,
});

// =============================================================================
// Unit Tests for createEvidence()
// =============================================================================

describe('FileEvidenceManager', () => {
  let tempHelper: TempFileHelper;

  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  describe('createEvidence()', () => {
    /**
     * Test: Create evidence with all required fields
     * **Validates: R06.1** - Evidence includes all required fields
     */
    it('should create evidence with all required fields', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput();

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const evidence = result.value;
        
        // Verify all required fields exist
        expect(evidence.evidence_id).toBeDefined();
        expect(evidence.created_at).toBeDefined();
        expect(evidence.type).toBe('TDD_RED');
        expect(evidence.task_id).toBe('TASK-001');
        expect(evidence.tdd_phase).toBe('RED');
        expect(evidence.requirement_refs).toEqual(['REQ-001']);
        expect(evidence.ac_refs).toEqual(['REQ-001-AC1']);
        expect(evidence.git_state).toBeDefined();
        expect(evidence.execution).toBeDefined();
        expect(evidence.result).toBeDefined();
        expect(evidence.executor).toBeDefined();
        expect(evidence.staleness).toBeDefined();
      }
    });

    /**
     * Test: Evidence ID generated in EVD-{task_id}-{phase} format
     * **Validates: R06.1** - Evidence has unique identifier
     */
    it('should generate evidence ID in EVD-{task_id}-{phase} format for TDD evidence', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({ task_id: 'TASK-003', tdd_phase: 'RED' });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // TDD evidence should be EVD-{task_id}-{phase}
        expect(result.value.evidence_id).toMatch(/^EVD-003-RED$/);
      }
    });

    /**
     * Test: Evidence ID generated for non-TDD evidence
     * **Validates: R06.1** - Evidence has unique identifier
     */
    it('should generate evidence ID with type and sequence for non-TDD evidence', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({
        task_id: 'TASK-003',
        type: 'UNIT_TEST',
        tdd_phase: undefined,
        result: {
          status: 'PASS',
          summary: 'All unit tests passed',
          tests_passed: 10,
          tests_total: 10,
        },
        exit_code: 0,
      });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Non-TDD evidence should be EVD-{task_id}-{type}-{sequence}
        expect(result.value.evidence_id).toMatch(/^EVD-003-UNIT-TEST-\d{3}$/);
      }
    });

    /**
     * Test: Git state captured (commit SHA, branch, dirty status)
     * **Validates: R06.1** - Git state captured
     */
    it('should capture git state with commit SHA, branch, and dirty status', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const expectedCommit = 'abc123def456789012345678901234567890abcd';
      const expectedBranch = 'task/TASK-001-user-auth';
      const mockGitClient = createMockGitClient({
        getCurrentCommitSha: async () => expectedCommit,
        getCurrentBranch: async () => expectedBranch,
        isWorkingTreeDirty: async () => false,
        getUncommittedFiles: async () => [],
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput();

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const gitState = result.value.git_state;
        expect(gitState.commit_sha).toBe(expectedCommit);
        expect(gitState.branch).toBe(expectedBranch);
        expect(gitState.working_tree_dirty).toBe(false);
        expect(gitState.uncommitted_files).toEqual([]);
      }
    });

    /**
     * Test: Git state captures dirty working tree with uncommitted files
     * **Validates: R06.1** - working_tree_dirty field populated
     */
    it('should capture uncommitted files when working tree is dirty', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const uncommittedFiles = ['src/auth.ts', 'src/auth.test.ts'];
      const mockGitClient = createMockGitClient({
        isWorkingTreeDirty: async () => true,
        getUncommittedFiles: async () => uncommittedFiles,
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput();

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const gitState = result.value.git_state;
        expect(gitState.working_tree_dirty).toBe(true);
        expect(gitState.uncommitted_files).toEqual(uncommittedFiles);
      }
    });

    /**
     * Test: Executor info recorded (id, type)
     * **Validates: R06.1** - Executor information recorded
     */
    it('should record executor info with id and type HUMAN', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({
        executor_id: 'dev-001',
        executor_type: 'HUMAN',
      });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.executor.id).toBe('dev-001');
        expect(result.value.executor.type).toBe('HUMAN');
      }
    });

    /**
     * Test: Executor info for AI_AGENT type
     * **Validates: R06.1** - executor_type HUMAN/AI_AGENT
     */
    it('should record executor info with type AI_AGENT', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({
        executor_id: 'ai-agent-001',
        executor_type: 'AI_AGENT',
      });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.executor.id).toBe('ai-agent-001');
        expect(result.value.executor.type).toBe('AI_AGENT');
      }
    });

    /**
     * Test: File hashes computed for staleness tracking
     * **Validates: R06.4, R06.5** - File hashes for staleness tracking
     */
    it('should compute file hashes for related files', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient({
        getFileHash: async (filePath: string) => `sha256:hash-of-${path.basename(filePath)}`,
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({
        related_files: ['src/auth.ts', 'src/auth.test.ts'],
      });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const relatedFiles = result.value.staleness.related_files;
        expect(relatedFiles).toHaveLength(2);
        expect(relatedFiles[0].path).toBe('src/auth.ts');
        expect(relatedFiles[0].hash_at_verification).toBe('sha256:hash-of-auth.ts');
        expect(relatedFiles[1].path).toBe('src/auth.test.ts');
        expect(relatedFiles[1].hash_at_verification).toBe('sha256:hash-of-auth.test.ts');
      }
    });

    /**
     * Test: Evidence stored to .kiro/sdlc/evidence/ directory
     * **Validates: R06.1** - Evidence stored to expected directory
     */
    it('should store evidence to storage directory as YAML file', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({ task_id: 'TASK-001', tdd_phase: 'RED' });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Verify file exists
        const expectedPath = path.join(storagePath, `${result.value.evidence_id}.yaml`);
        const fileExists = await fs.access(expectedPath).then(() => true).catch(() => false);
        expect(fileExists).toBe(true);

        // Verify file content is valid YAML
        const content = await fs.readFile(expectedPath, 'utf-8');
        expect(content).toContain('evidence_id:');
        expect(content).toContain('task_id: TASK-001');
      }
    });

    /**
     * Test: Execution details recorded correctly
     * **Validates: R06.1** - execution field captured
     */
    it('should record execution details with command, duration, exit_code', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({
        command: 'npm test -- --grep "auth"',
        working_directory: '/project/src',
        duration_ms: 2500,
        exit_code: 1,
        config: {
          test_framework: 'vitest',
          config_file: 'vitest.config.ts',
        },
      });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const execution = result.value.execution;
        expect(execution.command).toBe('npm test -- --grep "auth"');
        expect(execution.working_directory).toBe('/project/src');
        expect(execution.duration_ms).toBe(2500);
        expect(execution.exit_code).toBe(1);
        expect(execution.config?.test_framework).toBe('vitest');
        expect(execution.timestamp).toBeDefined();
      }
    });

    /**
     * Test: Result recorded with status and summary
     * **Validates: R06.2** - result field with status
     */
    it('should record result with status, summary, and test details', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({
        result: {
          status: 'FAIL',
          summary: 'Test fails as expected',
          test_file: 'src/auth.test.ts',
          test_name: 'auth > login',
          failure_type: 'BEHAVIOR_MISSING',
          tests_passed: 5,
          tests_failed: 1,
          tests_total: 6,
        },
      });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const evidenceResult = result.value.result;
        expect(evidenceResult.status).toBe('FAIL');
        expect(evidenceResult.summary).toBe('Test fails as expected');
        expect(evidenceResult.test_file).toBe('src/auth.test.ts');
        expect(evidenceResult.test_name).toBe('auth > login');
        expect(evidenceResult.failure_type).toBe('BEHAVIOR_MISSING');
        expect(evidenceResult.tests_passed).toBe(5);
        expect(evidenceResult.tests_failed).toBe(1);
        expect(evidenceResult.tests_total).toBe(6);
      }
    });

    /**
     * Test: Staleness info initialized as not stale
     * **Validates: R06.4** - staleness tracking initialized
     */
    it('should initialize staleness info as not stale with checked_at timestamp', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput();
      const beforeCreate = new Date();

      // Act
      const result = await evidenceManager.createEvidence(input);

      const afterCreate = new Date();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const staleness = result.value.staleness;
        expect(staleness.stale).toBe(false);
        expect(staleness.stale_reason).toBeNull();
        
        // Verify checked_at is within expected time range
        const checkedAt = new Date(staleness.checked_at);
        expect(checkedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
        expect(checkedAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
      }
    });

    /**
     * Test: created_at timestamp set correctly
     * **Validates: R06.1** - Evidence record timestamp
     */
    it('should set created_at timestamp to current time', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput();
      const beforeCreate = new Date();

      // Act
      const result = await evidenceManager.createEvidence(input);

      const afterCreate = new Date();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const createdAt = new Date(result.value.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
        expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
      }
    });

    /**
     * Test: Error when task_id is empty
     * **Validates: R06.1** - task_id must be non-empty
     */
    it('should return error when task_id is empty', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({ task_id: '' });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.MISSING_REQUIRED_FIELDS);
        expect(result.error.category).toBe('EVIDENCE_ERROR');
      }
    });

    /**
     * Test: Error when type is invalid
     * **Validates: R06.1** - type must be valid EvidenceType
     */
    it('should return error when evidence type is invalid', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({ type: 'INVALID_TYPE' as EvidenceType });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.INVALID_TYPE);
      }
    });

    /**
     * Test: Error when result status is invalid
     * **Validates: R06.2** - result status must be valid
     */
    it('should return error when result status is invalid', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({
        result: {
          status: 'INVALID_STATUS' as EvidenceResultStatus,
          summary: 'Test result',
        },
      });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.INVALID_RESULT_STATUS);
      }
    });

    /**
     * Test: Error when git state capture fails
     * **Validates: R06.1** - Git state error handling
     */
    it('should return error when git state capture fails', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient({
        getCurrentCommitSha: async () => { throw new Error('Git not initialized'); },
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput();

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.GIT_STATE_ERROR);
      }
    });

    /**
     * Test: Creates storage directory if it doesn't exist
     * **Validates: R06.1** - Storage path handling
     */
    it('should create storage directory if it does not exist', async () => {
      // Arrange
      const storagePath = tempHelper.getPath('.kiro/sdlc/evidence-new');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput();

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      
      // Verify directory was created
      const dirExists = await fs.access(storagePath).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);
    });

    /**
     * Test: Multiple evidences with unique IDs
     * **Validates: R06.1** - Unique evidence IDs
     */
    it('should generate unique evidence IDs for multiple evidences of same type', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      
      // Create two UNIT_TEST evidences for the same task
      const input1 = createValidEvidenceInput({
        task_id: 'TASK-001',
        type: 'UNIT_TEST',
        tdd_phase: undefined,
        result: { status: 'PASS', summary: 'First run' },
        exit_code: 0,
      });
      const input2 = createValidEvidenceInput({
        task_id: 'TASK-001',
        type: 'UNIT_TEST',
        tdd_phase: undefined,
        result: { status: 'PASS', summary: 'Second run' },
        exit_code: 0,
      });

      // Act
      const result1 = await evidenceManager.createEvidence(input1);
      const result2 = await evidenceManager.createEvidence(input2);

      // Assert
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.value.evidence_id).not.toBe(result2.value.evidence_id);
      }
    });

    /**
     * Test: Handles evidence with empty related_files
     * **Validates: R06.4** - Optional related files
     */
    it('should handle evidence creation with no related files', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({ related_files: [] });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.staleness.related_files).toEqual([]);
      }
    });

    /**
     * Test: GREEN phase evidence with PASS status
     * **Validates: R05.4** - GREEN phase expects test to pass
     */
    it('should create GREEN phase evidence with PASS status', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });
      const input = createValidEvidenceInput({
        type: 'TDD_GREEN',
        tdd_phase: 'GREEN',
        exit_code: 0,
        result: {
          status: 'PASS',
          summary: 'Test passes with implementation',
          tests_passed: 1,
          tests_failed: 0,
          tests_total: 1,
        },
      });

      // Act
      const result = await evidenceManager.createEvidence(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.type).toBe('TDD_GREEN');
        expect(result.value.tdd_phase).toBe('GREEN');
        expect(result.value.result.status).toBe('PASS');
      }
    });
  });
});

// =============================================================================
// Unit Tests for Utility Functions
// =============================================================================

describe('Evidence Utility Functions', () => {
  describe('generateEvidenceId()', () => {
    it('should generate EVD-{task}-{phase} for TDD evidence', () => {
      const id = generateEvidenceId('TASK-001', 'TDD_RED', 'RED');
      expect(id).toBe('EVD-001-RED');
    });

    it('should generate EVD-{task}-{type}-{seq} for non-TDD evidence', () => {
      const id = generateEvidenceId('TASK-001', 'UNIT_TEST', undefined, 1);
      expect(id).toBe('EVD-001-UNIT-TEST-001');
    });

    it('should handle task ID with TASK- prefix', () => {
      const id = generateEvidenceId('TASK-123', 'TDD_GREEN', 'GREEN');
      expect(id).toBe('EVD-123-GREEN');
    });
  });

  describe('isValidEvidenceType()', () => {
    it('should return true for valid evidence types', () => {
      expect(isValidEvidenceType('TDD_RED')).toBe(true);
      expect(isValidEvidenceType('TDD_GREEN')).toBe(true);
      expect(isValidEvidenceType('UNIT_TEST')).toBe(true);
      expect(isValidEvidenceType('LINT')).toBe(true);
    });

    it('should return false for invalid evidence types', () => {
      expect(isValidEvidenceType('INVALID')).toBe(false);
      expect(isValidEvidenceType('')).toBe(false);
      expect(isValidEvidenceType(null)).toBe(false);
      expect(isValidEvidenceType(undefined)).toBe(false);
    });
  });

  describe('isValidResultStatus()', () => {
    it('should return true for valid result statuses', () => {
      expect(isValidResultStatus('PASS')).toBe(true);
      expect(isValidResultStatus('FAIL')).toBe(true);
      expect(isValidResultStatus('BLOCKED')).toBe(true);
      expect(isValidResultStatus('NOT_RUN')).toBe(true);
    });

    it('should return false for invalid result statuses', () => {
      expect(isValidResultStatus('INVALID')).toBe(false);
      expect(isValidResultStatus('')).toBe(false);
      expect(isValidResultStatus(null)).toBe(false);
    });
  });

  describe('validateRedPhaseEvidence()', () => {
    it('should return valid for FAIL with BEHAVIOR_MISSING', () => {
      const result = validateRedPhaseEvidence({
        status: 'FAIL',
        summary: 'Test fails',
        failure_type: 'BEHAVIOR_MISSING',
      });
      expect(result.valid).toBe(true);
    });

    it('should return invalid for PASS status in RED phase', () => {
      const result = validateRedPhaseEvidence({
        status: 'PASS',
        summary: 'Test passes unexpectedly',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('should fail');
    });

    it('should return invalid for TEST_ERROR failure type', () => {
      const result = validateRedPhaseEvidence({
        status: 'FAIL',
        summary: 'Syntax error',
        failure_type: 'TEST_ERROR',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('fix test first');
    });
  });

  describe('validateGreenPhaseEvidence()', () => {
    it('should return valid for PASS status', () => {
      const result = validateGreenPhaseEvidence({
        status: 'PASS',
        summary: 'Test passes',
        tests_passed: 1,
        tests_failed: 0,
      });
      expect(result.valid).toBe(true);
    });

    it('should return invalid for FAIL status', () => {
      const result = validateGreenPhaseEvidence({
        status: 'FAIL',
        summary: 'Test still fails',
      });
      expect(result.valid).toBe(false);
    });

    it('should return invalid if tests_failed > 0', () => {
      const result = validateGreenPhaseEvidence({
        status: 'PASS',
        summary: 'Mixed results',
        tests_passed: 9,
        tests_failed: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('failing tests');
    });
  });

  describe('validateRefactorPhaseEvidence()', () => {
    it('should return valid for PASS status', () => {
      const result = validateRefactorPhaseEvidence({
        status: 'PASS',
        summary: 'Tests still pass after refactor',
      });
      expect(result.valid).toBe(true);
    });

    it('should return invalid for FAIL status', () => {
      const result = validateRefactorPhaseEvidence({
        status: 'FAIL',
        summary: 'Refactoring broke something',
      });
      expect(result.valid).toBe(false);
    });

    it('should return invalid for REGRESSION failure type', () => {
      const result = validateRefactorPhaseEvidence({
        status: 'PASS',
        summary: 'Pass but detected regression',
        failure_type: 'REGRESSION',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('regression');
    });
  });
});


// =============================================================================
// Unit Tests for Staleness Detection (Task T20)
// =============================================================================

describe('FileEvidenceManager - Staleness Detection', () => {
  let tempHelper: TempFileHelper;
  
  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  // ===========================================================================
  // Helper to create evidence directly (for testing retrieval/staleness)
  // ===========================================================================

  const createAndStoreEvidence = async (
    evidenceManager: FileEvidenceManager,
    overrides: Partial<EvidenceInput> = {}
  ) => {
    const input = createValidEvidenceInput(overrides);
    return await evidenceManager.createEvidence(input);
  };

  // ===========================================================================
  // getEvidence() Tests
  // ===========================================================================

  describe('getEvidence()', () => {
    /**
     * Test: Get evidence by ID
     * **Validates: R06.1** - Evidence retrieval
     */
    it('should get evidence by ID', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence first
      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Act
      const result = await evidenceManager.getEvidence(createResult.value.evidence_id);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.evidence_id).toBe(createResult.value.evidence_id);
        expect(result.value.task_id).toBe('TASK-001');
      }
    });

    /**
     * Test: Get evidence not found
     * **Validates: R06.1** - Evidence not found error
     */
    it('should return error when evidence not found', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Act
      const result = await evidenceManager.getEvidence('EVD-NONEXISTENT-001');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.EVIDENCE_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // listEvidence() Tests
  // ===========================================================================

  describe('listEvidence()', () => {
    /**
     * Test: List all evidence
     * **Validates: R06.1** - Evidence listing
     */
    it('should list all evidence', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create multiple evidences
      await createAndStoreEvidence(evidenceManager, { task_id: 'TASK-001', tdd_phase: 'RED' });
      await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'TDD_GREEN',
        tdd_phase: 'GREEN',
        exit_code: 0,
        result: { status: 'PASS', summary: 'Test passes' }
      });

      // Act
      const result = await evidenceManager.listEvidence();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
      }
    });

    /**
     * Test: List evidence filtered by task
     * **Validates: R06.1** - Evidence filtering by task
     */
    it('should list evidence filtered by task ID', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidences for different tasks
      await createAndStoreEvidence(evidenceManager, { task_id: 'TASK-001', tdd_phase: 'RED' });
      await createAndStoreEvidence(evidenceManager, { task_id: 'TASK-002', tdd_phase: 'RED' });

      // Act
      const result = await evidenceManager.listEvidence('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].task_id).toBe('TASK-001');
      }
    });

    /**
     * Test: List evidence returns empty array when no evidence exists
     * **Validates: R06.1** - Empty evidence list handling
     */
    it('should return empty array when no evidence exists', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Act
      const result = await evidenceManager.listEvidence();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual([]);
      }
    });

    /**
     * Test: List evidence returns sorted by date (newest first)
     * **Validates: R06.1** - Evidence ordering
     */
    it('should return evidence sorted by creation date (newest first)', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidences with slight delay
      await createAndStoreEvidence(evidenceManager, { task_id: 'TASK-001', tdd_phase: 'RED' });
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'TDD_GREEN',
        tdd_phase: 'GREEN',
        exit_code: 0,
        result: { status: 'PASS', summary: 'Test passes' }
      });

      // Act
      const result = await evidenceManager.listEvidence();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
        // Newest first
        const firstDate = new Date(result.value[0].created_at);
        const secondDate = new Date(result.value[1].created_at);
        expect(firstDate.getTime()).toBeGreaterThanOrEqual(secondDate.getTime());
      }
    });
  });

  // ===========================================================================
  // checkStaleness() Tests
  // ===========================================================================

  describe('checkStaleness()', () => {
    /**
     * Test: Evidence with matching commit = not stale
     * **Validates: R06.4** - Evidence not stale when commit matches
     */
    it('should return not stale when commit SHA matches current HEAD', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const commitSha = 'abc123def456789012345678901234567890abcd';
      const mockGitClient = createMockGitClient({
        getCurrentCommitSha: async () => commitSha,
        commitExists: async () => true,
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence
      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Act
      const result = await evidenceManager.checkStaleness(createResult.value.evidence_id);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.stale).toBe(false);
        expect(result.value.reason).toBeNull();
        expect(result.value.evidence_id).toBe(createResult.value.evidence_id);
        expect(result.value.current_commit_sha).toBe(commitSha);
        expect(result.value.evidence_commit_sha).toBe(commitSha);
      }
    });

    /**
     * Test: HEAD moved since evidence = stale (COMMIT_CHANGED)
     * **Validates: R06.4** - Evidence stale when HEAD moves but no file changes
     */
    it('should return stale with COMMIT_CHANGED when HEAD moved but files unchanged', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const originalCommit = 'abc123def456789012345678901234567890abcd';
      const newCommit = 'xyz789abc123456789012345678901234567890xyz';
      
      // First create with original commit
      let currentCommit = originalCommit;
      const mockGitClient = createMockGitClient({
        getCurrentCommitSha: async () => currentCommit,
        commitExists: async () => true,
        getChangedFilesBetween: async () => [], // No files changed
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence at original commit
      const createResult = await createAndStoreEvidence(evidenceManager, {
        related_files: ['src/auth.ts'],
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Simulate HEAD moving to new commit
      currentCommit = newCommit;

      // Act
      const result = await evidenceManager.checkStaleness(createResult.value.evidence_id);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.stale).toBe(true);
        expect(result.value.reason).toBe('COMMIT_CHANGED');
        expect(result.value.details).toContain(originalCommit);
        expect(result.value.details).toContain(newCommit);
        expect(result.value.current_commit_sha).toBe(newCommit);
        expect(result.value.evidence_commit_sha).toBe(originalCommit);
      }
    });

    /**
     * Test: File change after evidence = stale (FILES_MODIFIED)
     * **Validates: R06.4, R06.5** - Evidence stale when related files changed
     */
    it('should return stale with FILES_MODIFIED when related files changed', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const originalCommit = 'abc123def456789012345678901234567890abcd';
      const newCommit = 'xyz789abc123456789012345678901234567890xyz';
      
      let currentCommit = originalCommit;
      const mockGitClient = createMockGitClient({
        getCurrentCommitSha: async () => currentCommit,
        commitExists: async () => true,
        getChangedFilesBetween: async () => ['src/auth.ts', 'src/other.ts'], // Files changed
        getFileHash: async (filePath: string) => `sha256:hash-of-${filePath}`,
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence with related files
      const createResult = await createAndStoreEvidence(evidenceManager, {
        related_files: ['src/auth.ts', 'src/auth.test.ts'],
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Simulate HEAD moving with file changes
      currentCommit = newCommit;

      // Act
      const result = await evidenceManager.checkStaleness(createResult.value.evidence_id);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.stale).toBe(true);
        expect(result.value.reason).toBe('FILES_MODIFIED');
        expect(result.value.affected_files).toContain('src/auth.ts');
        expect(result.value.details).toContain('src/auth.ts');
      }
    });

    /**
     * Test: Commit no longer exists = stale (COMMIT_NOT_FOUND)
     * **Validates: R06.4** - Evidence stale when original commit gone
     */
    it('should return stale with COMMIT_NOT_FOUND when commit no longer exists', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const originalCommit = 'abc123def456789012345678901234567890abcd';
      
      let commitExists = true;
      const mockGitClient = createMockGitClient({
        getCurrentCommitSha: async () => originalCommit,
        commitExists: async () => commitExists,
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence
      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Simulate commit being deleted (e.g., force push, rebase)
      commitExists = false;

      // Act
      const result = await evidenceManager.checkStaleness(createResult.value.evidence_id);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.stale).toBe(true);
        expect(result.value.reason).toBe('COMMIT_NOT_FOUND');
        expect(result.value.details).toContain(originalCommit);
        expect(result.value.details).toContain('no longer exists');
      }
    });

    /**
     * Test: Error when evidence not found for staleness check
     * **Validates: R06.4** - Error handling for missing evidence
     */
    it('should return error when evidence not found', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Act
      const result = await evidenceManager.checkStaleness('EVD-NONEXISTENT-001');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.EVIDENCE_NOT_FOUND);
      }
    });

    /**
     * Test: Error when git operations fail during staleness check
     * **Validates: R06.4** - Git error handling
     */
    it('should return error when git operation fails during staleness check', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      let throwError = false;
      const mockGitClient = createMockGitClient({
        commitExists: async () => {
          if (throwError) throw new Error('Git operation failed');
          return true;
        },
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence first
      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Enable error
      throwError = true;

      // Act
      const result = await evidenceManager.checkStaleness(createResult.value.evidence_id);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.GIT_STATE_ERROR);
      }
    });

    /**
     * Test: checked_at timestamp is set
     * **Validates: R06.4** - Timestamp tracking
     */
    it('should set checked_at timestamp', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const beforeCheck = new Date();

      // Act
      const result = await evidenceManager.checkStaleness(createResult.value.evidence_id);

      const afterCheck = new Date();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const checkedAt = new Date(result.value.checked_at);
        expect(checkedAt.getTime()).toBeGreaterThanOrEqual(beforeCheck.getTime());
        expect(checkedAt.getTime()).toBeLessThanOrEqual(afterCheck.getTime());
      }
    });

    /**
     * Test: Only affected related files are reported
     * **Validates: R06.4** - Accurate affected file reporting
     */
    it('should only report affected related files, not all changed files', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const originalCommit = 'abc123def456789012345678901234567890abcd';
      const newCommit = 'xyz789abc123456789012345678901234567890xyz';
      
      let currentCommit = originalCommit;
      const mockGitClient = createMockGitClient({
        getCurrentCommitSha: async () => currentCommit,
        commitExists: async () => true,
        // Many files changed, but only some are related to evidence
        getChangedFilesBetween: async () => [
          'src/auth.ts',
          'src/unrelated.ts',
          'package.json',
          'README.md',
        ],
        getFileHash: async (filePath: string) => `sha256:hash-of-${filePath}`,
      });
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence with specific related files
      const createResult = await createAndStoreEvidence(evidenceManager, {
        related_files: ['src/auth.ts', 'src/auth.test.ts'], // Only these are related
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Simulate HEAD moving
      currentCommit = newCommit;

      // Act
      const result = await evidenceManager.checkStaleness(createResult.value.evidence_id);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.stale).toBe(true);
        expect(result.value.reason).toBe('FILES_MODIFIED');
        // Only affected files that are BOTH in changed list AND related files
        expect(result.value.affected_files).toEqual(['src/auth.ts']);
        expect(result.value.affected_files).not.toContain('src/unrelated.ts');
        expect(result.value.affected_files).not.toContain('package.json');
      }
    });
  });

  // ===========================================================================
  // markStale() Tests
  // ===========================================================================

  describe('markStale()', () => {
    /**
     * Test: Force mark evidence as stale
     * **Validates: R06.5** - Manual stale marking
     */
    it('should mark evidence as stale with FORCE_MARKED reason', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Verify initially not stale
      expect(createResult.value.staleness.stale).toBe(false);

      // Act
      const result = await evidenceManager.markStale(
        createResult.value.evidence_id,
        'FORCE_MARKED'
      );

      // Assert
      expect(result.success).toBe(true);

      // Verify evidence is now stale
      const getResult = await evidenceManager.getEvidence(createResult.value.evidence_id);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.value.staleness.stale).toBe(true);
        expect(getResult.value.staleness.stale_reason).toBe('FORCE_MARKED');
      }
    });

    /**
     * Test: markStale updates checked_at timestamp
     * **Validates: R06.5** - Timestamp update on mark
     */
    it('should update checked_at timestamp when marking stale', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const originalCheckedAt = createResult.value.staleness.checked_at;
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      
      const beforeMark = new Date();

      // Act
      const result = await evidenceManager.markStale(
        createResult.value.evidence_id,
        'AGE_EXCEEDED'
      );

      const afterMark = new Date();

      // Assert
      expect(result.success).toBe(true);

      const getResult = await evidenceManager.getEvidence(createResult.value.evidence_id);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        const newCheckedAt = new Date(getResult.value.staleness.checked_at);
        expect(newCheckedAt.getTime()).toBeGreaterThanOrEqual(beforeMark.getTime());
        expect(newCheckedAt.getTime()).toBeLessThanOrEqual(afterMark.getTime());
        expect(new Date(getResult.value.staleness.checked_at).getTime())
          .toBeGreaterThan(new Date(originalCheckedAt).getTime());
      }
    });

    /**
     * Test: markStale with different staleness reasons
     * **Validates: R06.5** - Various staleness reasons
     */
    it.each([
      'COMMIT_CHANGED',
      'FILES_MODIFIED', 
      'COMMIT_NOT_FOUND',
      'BRANCH_DELETED',
      'FORCE_MARKED',
      'AGE_EXCEEDED',
    ] as const)('should mark evidence as stale with reason %s', async (reason) => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Act
      const result = await evidenceManager.markStale(createResult.value.evidence_id, reason);

      // Assert
      expect(result.success).toBe(true);

      const getResult = await evidenceManager.getEvidence(createResult.value.evidence_id);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.value.staleness.stale).toBe(true);
        expect(getResult.value.staleness.stale_reason).toBe(reason);
      }
    });

    /**
     * Test: Error when evidence not found
     * **Validates: R06.5** - Error handling
     */
    it('should return error when evidence not found', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Act
      const result = await evidenceManager.markStale('EVD-NONEXISTENT-001', 'FORCE_MARKED');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.EVIDENCE_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // getStaleEvidence() Tests
  // ===========================================================================

  describe('getStaleEvidence()', () => {
    /**
     * Test: Get all stale evidence for a task
     * **Validates: R06.5** - Stale evidence retrieval
     */
    it('should return only stale evidence for a task', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create multiple evidences
      const create1 = await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        tdd_phase: 'RED' 
      });
      const create2 = await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'TDD_GREEN',
        tdd_phase: 'GREEN',
        exit_code: 0,
        result: { status: 'PASS', summary: 'Test passes' }
      });

      expect(create1.success).toBe(true);
      expect(create2.success).toBe(true);
      if (!create1.success || !create2.success) return;

      // Mark one as stale
      await evidenceManager.markStale(create1.value.evidence_id, 'FORCE_MARKED');

      // Act
      const result = await evidenceManager.getStaleEvidence('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].evidence_id).toBe(create1.value.evidence_id);
        expect(result.value[0].staleness.stale).toBe(true);
      }
    });

    /**
     * Test: Return empty array when no stale evidence exists
     * **Validates: R06.5** - Empty result handling
     */
    it('should return empty array when no stale evidence exists', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence (not stale)
      await createAndStoreEvidence(evidenceManager, { task_id: 'TASK-001' });

      // Act
      const result = await evidenceManager.getStaleEvidence('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual([]);
      }
    });

    /**
     * Test: Only return stale evidence for specified task
     * **Validates: R06.5** - Task-specific filtering
     */
    it('should only return stale evidence for specified task, not other tasks', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence for different tasks
      const create1 = await createAndStoreEvidence(evidenceManager, { task_id: 'TASK-001', tdd_phase: 'RED' });
      const create2 = await createAndStoreEvidence(evidenceManager, { task_id: 'TASK-002', tdd_phase: 'RED' });

      expect(create1.success).toBe(true);
      expect(create2.success).toBe(true);
      if (!create1.success || !create2.success) return;

      // Mark both as stale
      await evidenceManager.markStale(create1.value.evidence_id, 'FORCE_MARKED');
      await evidenceManager.markStale(create2.value.evidence_id, 'FORCE_MARKED');

      // Act
      const result = await evidenceManager.getStaleEvidence('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].task_id).toBe('TASK-001');
      }
    });

    /**
     * Test: Return multiple stale evidences for same task
     * **Validates: R06.5** - Multiple stale evidence
     */
    it('should return all stale evidence for a task', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create multiple evidences for same task
      const create1 = await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        tdd_phase: 'RED' 
      });
      const create2 = await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'TDD_GREEN',
        tdd_phase: 'GREEN',
        exit_code: 0,
        result: { status: 'PASS', summary: 'Test passes' }
      });
      const create3 = await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'UNIT_TEST',
        tdd_phase: undefined,
        exit_code: 0,
        result: { status: 'PASS', summary: 'Unit test passes' }
      });

      expect(create1.success).toBe(true);
      expect(create2.success).toBe(true);
      expect(create3.success).toBe(true);
      if (!create1.success || !create2.success || !create3.success) return;

      // Mark two as stale
      await evidenceManager.markStale(create1.value.evidence_id, 'FORCE_MARKED');
      await evidenceManager.markStale(create3.value.evidence_id, 'AGE_EXCEEDED');

      // Act
      const result = await evidenceManager.getStaleEvidence('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
        expect(result.value.every(e => e.staleness.stale)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // deleteEvidence() Tests
  // ===========================================================================

  describe('deleteEvidence()', () => {
    /**
     * Test: Delete evidence by ID
     * **Validates: R06** - Evidence deletion
     */
    it('should delete evidence by ID', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      const createResult = await createAndStoreEvidence(evidenceManager);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Act
      const result = await evidenceManager.deleteEvidence(createResult.value.evidence_id);

      // Assert
      expect(result.success).toBe(true);

      // Verify evidence no longer exists
      const getResult = await evidenceManager.getEvidence(createResult.value.evidence_id);
      expect(getResult.success).toBe(false);
      if (!getResult.success) {
        expect(getResult.error.code).toBe(EvidenceErrorCode.EVIDENCE_NOT_FOUND);
      }
    });

    /**
     * Test: Error when deleting non-existent evidence
     * **Validates: R06** - Delete error handling
     */
    it('should return error when deleting non-existent evidence', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Act
      const result = await evidenceManager.deleteEvidence('EVD-NONEXISTENT-001');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(EvidenceErrorCode.EVIDENCE_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // getLatestEvidence() Tests
  // ===========================================================================

  describe('getLatestEvidence()', () => {
    /**
     * Test: Get latest evidence for task
     * **Validates: R06** - Latest evidence retrieval
     */
    it('should return the latest evidence for a task', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidences with delays
      await createAndStoreEvidence(evidenceManager, { task_id: 'TASK-001', tdd_phase: 'RED' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const laterResult = await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'TDD_GREEN',
        tdd_phase: 'GREEN',
        exit_code: 0,
        result: { status: 'PASS', summary: 'Test passes' }
      });

      expect(laterResult.success).toBe(true);
      if (!laterResult.success) return;

      // Act
      const result = await evidenceManager.getLatestEvidence('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).not.toBeNull();
        expect(result.value!.evidence_id).toBe(laterResult.value.evidence_id);
      }
    });

    /**
     * Test: Get latest evidence filtered by TDD phase
     * **Validates: R06** - Phase-filtered latest evidence
     */
    it('should return latest evidence for specific TDD phase', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      const redResult = await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        tdd_phase: 'RED' 
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'TDD_GREEN',
        tdd_phase: 'GREEN',
        exit_code: 0,
        result: { status: 'PASS', summary: 'Test passes' }
      });

      expect(redResult.success).toBe(true);
      if (!redResult.success) return;

      // Act - get latest RED phase evidence
      const result = await evidenceManager.getLatestEvidence('TASK-001', 'RED');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).not.toBeNull();
        expect(result.value!.tdd_phase).toBe('RED');
      }
    });

    /**
     * Test: Return null when no evidence exists
     * **Validates: R06** - Null result for no evidence
     */
    it('should return null when no evidence exists for task', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Act
      const result = await evidenceManager.getLatestEvidence('TASK-NONEXISTENT');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeNull();
      }
    });
  });

  // ===========================================================================
  // listEvidenceByType() Tests
  // ===========================================================================

  describe('listEvidenceByType()', () => {
    /**
     * Test: List evidence filtered by type
     * **Validates: R06** - Type-filtered evidence listing
     */
    it('should list evidence filtered by type', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'TDD_RED',
        tdd_phase: 'RED' 
      });
      await createAndStoreEvidence(evidenceManager, { 
        task_id: 'TASK-001', 
        type: 'UNIT_TEST',
        tdd_phase: undefined,
        exit_code: 0,
        result: { status: 'PASS', summary: 'Unit test passes' }
      });

      // Act
      const result = await evidenceManager.listEvidenceByType('TASK-001', 'TDD_RED');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe('TDD_RED');
      }
    });
  });
});


// =============================================================================
// Unit Tests for Quality Gate Validation (Task T21)
// =============================================================================

import { 
  QualityGateValidationConfig, 
  QualityGatesValidationConfig,
  getDefaultGateConfig,
  getDefaultGatesConfig,
} from '../evidence-manager-impl';

import { 
  QualityGate,
  GateStatus,
  GateValidation,
  QualityGateValidationConfig as QGVConfig,
  QualityGatesValidationConfig as QGSVConfig,
} from '../evidence-manager';

describe('FileEvidenceManager - Quality Gate Validation', () => {
  let tempHelper: TempFileHelper;
  
  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  // ===========================================================================
  // Helper to create evidence for testing gates
  // ===========================================================================

  const createGateEvidence = async (
    evidenceManager: FileEvidenceManager,
    taskId: string,
    type: EvidenceType,
    status: EvidenceResultStatus = 'PASS',
    overrides: Partial<EvidenceInput> = {}
  ) => {
    const input: EvidenceInput = {
      task_id: taskId,
      type,
      tdd_phase: type.startsWith('TDD_') ? type.replace('TDD_', '') as TddPhase : undefined,
      requirement_refs: ['REQ-001'],
      ac_refs: ['REQ-001-AC1'],
      command: 'npm test',
      duration_ms: 1000,
      exit_code: status === 'PASS' ? 0 : 1,
      result: {
        status,
        summary: `Test ${status.toLowerCase()}`,
        tests_passed: status === 'PASS' ? 10 : 5,
        tests_failed: status === 'PASS' ? 0 : 5,
        tests_total: 10,
      },
      executor_id: 'dev-001',
      executor_type: 'HUMAN' as ActorType,
      ...overrides,
    };
    return await evidenceManager.createEvidence(input);
  };

  // ===========================================================================
  // validateGate() Tests
  // ===========================================================================

  describe('validateGate()', () => {
    /**
     * Test: Gate passes when required evidence exists and is fresh
     * **Validates: R06.7** - Basic gate validation
     */
    it('should return PASSED when evidence exists and is fresh', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create unit test evidence
      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.gate).toBe('unit_test');
        expect(result.value.status).toBe('PASSED');
        expect(result.value.all_evidence_fresh).toBe(true);
        expect(result.value.evidence_ids.length).toBeGreaterThan(0);
      }
    });

    /**
     * Test: Gate fails when required evidence is missing
     * **Validates: R06.7** - Missing evidence detection
     */
    it('should return FAILED when required evidence is missing', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // No evidence created

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test', {
        required: true,
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.gate).toBe('unit_test');
        expect(result.value.status).toBe('FAILED');
        expect(result.value.required).toBe(true);
        expect(result.value.message).toContain('requires evidence');
      }
    });

    /**
     * Test: Gate is skipped when not required and no evidence exists
     * **Validates: R06.7** - Optional gate handling
     */
    it('should return SKIPPED when gate is not required and no evidence', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // No evidence created

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'security_scan', {
        required: false,
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.gate).toBe('security_scan');
        expect(result.value.status).toBe('SKIPPED');
        expect(result.value.required).toBe(false);
      }
    });

    /**
     * Test: Gate fails when evidence is stale
     * **Validates: R06.7** - Stale evidence detection
     */
    it('should return FAILED when evidence is stale and stale not allowed', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create and then mark evidence as stale
      const createResult = await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      await evidenceManager.markStale(createResult.value.evidence_id, 'FORCE_MARKED');

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test', {
        required: true,
        allowStale: false,
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('FAILED');
        expect(result.value.all_evidence_fresh).toBe(false);
        expect(result.value.message).toContain('stale');
      }
    });

    /**
     * Test: Gate passes when stale evidence is allowed
     * **Validates: R06.7** - allowStale configuration
     */
    it('should return PASSED when evidence is stale but stale is allowed', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create and mark evidence as stale
      const createResult = await createGateEvidence(evidenceManager, 'TASK-001', 'MANUAL_REVIEW', 'PASS');
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      await evidenceManager.markStale(createResult.value.evidence_id, 'FORCE_MARKED');

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'manual_review', {
        required: true,
        allowStale: true,
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('PASSED');
      }
    });

    /**
     * Test: Gate fails when pass rate is below minimum
     * **Validates: R06.7** - Pass rate validation
     */
    it('should return FAILED when pass rate is below minimum', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence with low pass rate
      await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        type: 'UNIT_TEST',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        duration_ms: 1000,
        exit_code: 0,
        result: {
          status: 'PASS',
          summary: 'Tests with low pass rate',
          tests_passed: 7,
          tests_failed: 3,
          tests_total: 10,
        },
        executor_id: 'dev-001',
        executor_type: 'HUMAN',
      });

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test', {
        required: true,
        minPassRate: 90, // Require 90% pass rate
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('FAILED');
        expect(result.value.pass_rate).toBe(70); // 7/10 = 70%
        expect(result.value.required_pass_rate).toBe(90);
        expect(result.value.message).toContain('70%');
        expect(result.value.message).toContain('90%');
      }
    });

    /**
     * Test: Gate passes when pass rate meets minimum
     * **Validates: R06.7** - Pass rate validation
     */
    it('should return PASSED when pass rate meets minimum', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence with high pass rate
      await evidenceManager.createEvidence({
        task_id: 'TASK-001',
        type: 'UNIT_TEST',
        requirement_refs: ['REQ-001'],
        ac_refs: ['REQ-001-AC1'],
        command: 'npm test',
        duration_ms: 1000,
        exit_code: 0,
        result: {
          status: 'PASS',
          summary: 'Tests with high pass rate',
          tests_passed: 95,
          tests_failed: 5,
          tests_total: 100,
        },
        executor_id: 'dev-001',
        executor_type: 'HUMAN',
      });

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test', {
        required: true,
        minPassRate: 90,
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('PASSED');
        expect(result.value.pass_rate).toBe(95);
      }
    });

    /**
     * Test: Gate fails when latest evidence status is FAIL
     * **Validates: R06.7** - Evidence status validation
     */
    it('should return FAILED when latest evidence status is FAIL', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create failing evidence
      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'FAIL');

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('FAILED');
        expect(result.value.message).toContain('FAIL');
      }
    });

    /**
     * Test: TDD evidence counts for unit_test gate
     * **Validates: R06.7** - TDD evidence mapping
     */
    it('should count TDD_GREEN evidence for unit_test gate', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create TDD_GREEN evidence (not UNIT_TEST directly)
      await createGateEvidence(evidenceManager, 'TASK-001', 'TDD_GREEN', 'PASS');

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('PASSED');
        expect(result.value.evidence_ids.length).toBe(1);
      }
    });

    /**
     * Test: Uses default config when none provided
     * **Validates: R06.7** - Default configuration
     */
    it('should use default gate configuration when not provided', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // No evidence - test default required=true for unit_test
      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Default config for unit_test is required=true
        expect(result.value.required).toBe(true);
        expect(result.value.status).toBe('FAILED'); // No evidence
      }
    });

    /**
     * Test: Sets validated_at timestamp
     * **Validates: R06.7** - Timestamp tracking
     */
    it('should set validated_at timestamp', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');
      const beforeValidation = new Date();

      // Act
      const result = await evidenceManager.validateGate('TASK-001', 'unit_test');

      const afterValidation = new Date();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const validatedAt = new Date(result.value.validated_at);
        expect(validatedAt.getTime()).toBeGreaterThanOrEqual(beforeValidation.getTime());
        expect(validatedAt.getTime()).toBeLessThanOrEqual(afterValidation.getTime());
      }
    });

    /**
     * Test: Validates different gate types
     * **Validates: R06.7** - Multiple gate types
     */
    it.each([
      ['unit_test', 'UNIT_TEST'],
      ['integration_test', 'INTEGRATION_TEST'],
      ['lint', 'LINT'],
      ['type_check', 'TYPE_CHECK'],
      ['security_scan', 'SECURITY_SCAN'],
    ] as [QualityGate, EvidenceType][])('should validate %s gate with %s evidence', async (gate, evidenceType) => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      await createGateEvidence(evidenceManager, 'TASK-001', evidenceType, 'PASS');

      // Act
      const result = await evidenceManager.validateGate('TASK-001', gate, {
        required: true,
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.gate).toBe(gate);
        expect(result.value.status).toBe('PASSED');
      }
    });
  });

  // ===========================================================================
  // validateAllGates() Tests
  // ===========================================================================

  describe('validateAllGates()', () => {
    /**
     * Test: All gates pass when all evidence exists
     * **Validates: R06.7** - All gates validation
     */
    it('should return passed=true when all required gates pass', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence for all default gates
      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');
      await createGateEvidence(evidenceManager, 'TASK-001', 'INTEGRATION_TEST', 'PASS');
      await createGateEvidence(evidenceManager, 'TASK-001', 'LINT', 'PASS');
      await createGateEvidence(evidenceManager, 'TASK-001', 'TYPE_CHECK', 'PASS');

      // Act
      const result = await evidenceManager.validateAllGates('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(true);
        expect(result.value.passed_gates.length).toBeGreaterThan(0);
        expect(result.value.failed_gates.length).toBe(0);
        expect(result.value.blockers.length).toBe(0);
      }
    });

    /**
     * Test: Overall validation fails when required gate fails
     * **Validates: R06.7** - Blocker detection
     */
    it('should return passed=false when a required gate fails', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create only unit test evidence (missing others)
      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');

      // Act - validate with gates that require integration_test
      const result = await evidenceManager.validateAllGates('TASK-001', {
        gates: ['unit_test', 'integration_test'],
        gateConfigs: {
          unit_test: { required: true },
          integration_test: { required: true },
        },
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(false);
        expect(result.value.failed_gates).toContain('integration_test');
        expect(result.value.blockers.length).toBeGreaterThan(0);
      }
    });

    /**
     * Test: Overall validation passes when only optional gates fail
     * **Validates: R06.7** - Optional gate handling
     */
    it('should return passed=true when only optional gates fail', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create only required evidence
      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');

      // Act - security_scan is optional
      const result = await evidenceManager.validateAllGates('TASK-001', {
        gates: ['unit_test', 'security_scan'],
        gateConfigs: {
          unit_test: { required: true },
          security_scan: { required: false },
        },
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(true);
        expect(result.value.passed_gates).toContain('unit_test');
        expect(result.value.blockers.length).toBe(0);
      }
    });

    /**
     * Test: Uses default gates configuration
     * **Validates: R06.7** - Default configuration
     */
    it('should use default gates configuration when none provided', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // Create evidence for default required gates
      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');
      await createGateEvidence(evidenceManager, 'TASK-001', 'INTEGRATION_TEST', 'PASS');
      await createGateEvidence(evidenceManager, 'TASK-001', 'LINT', 'PASS');
      await createGateEvidence(evidenceManager, 'TASK-001', 'TYPE_CHECK', 'PASS');

      // Act
      const result = await evidenceManager.validateAllGates('TASK-001');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        // Default config includes unit_test, integration_test, lint, type_check
        expect(result.value.gates.length).toBeGreaterThanOrEqual(4);
      }
    });

    /**
     * Test: Returns complete GateValidation structure
     * **Validates: R06.7** - Complete result structure
     */
    it('should return complete GateValidation structure', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');
      await createGateEvidence(evidenceManager, 'TASK-001', 'LINT', 'FAIL');

      const beforeValidation = new Date();

      // Act
      const result = await evidenceManager.validateAllGates('TASK-001', {
        gates: ['unit_test', 'lint'],
        gateConfigs: {
          unit_test: { required: true },
          lint: { required: true },
        },
      });

      const afterValidation = new Date();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const validation = result.value;
        
        // Required fields
        expect(validation.task_id).toBe('TASK-001');
        expect(typeof validation.passed).toBe('boolean');
        expect(validation.validated_at).toBeDefined();
        expect(Array.isArray(validation.gates)).toBe(true);
        expect(Array.isArray(validation.passed_gates)).toBe(true);
        expect(Array.isArray(validation.failed_gates)).toBe(true);
        expect(Array.isArray(validation.blockers)).toBe(true);
        
        // Timestamp within range
        const validatedAt = new Date(validation.validated_at);
        expect(validatedAt.getTime()).toBeGreaterThanOrEqual(beforeValidation.getTime());
        expect(validatedAt.getTime()).toBeLessThanOrEqual(afterValidation.getTime());
        
        // Gate statuses present
        expect(validation.gates.length).toBe(2);
        expect(validation.passed_gates).toContain('unit_test');
        expect(validation.failed_gates).toContain('lint');
      }
    });

    /**
     * Test: Individual gate statuses are included
     * **Validates: R06.7** - Gate status details
     */
    it('should include detailed status for each gate', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      await createGateEvidence(evidenceManager, 'TASK-001', 'UNIT_TEST', 'PASS');

      // Act
      const result = await evidenceManager.validateAllGates('TASK-001', {
        gates: ['unit_test', 'integration_test'],
        gateConfigs: {
          unit_test: { required: true },
          integration_test: { required: false },
        },
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        const unitGate = result.value.gates.find(g => g.gate === 'unit_test');
        const intGate = result.value.gates.find(g => g.gate === 'integration_test');
        
        expect(unitGate).toBeDefined();
        expect(unitGate!.status).toBe('PASSED');
        expect(unitGate!.required).toBe(true);
        
        expect(intGate).toBeDefined();
        expect(intGate!.status).toBe('SKIPPED');
        expect(intGate!.required).toBe(false);
      }
    });

    /**
     * Test: Blockers list contains failure messages
     * **Validates: R06.7** - Blocker reporting
     */
    it('should include failure messages in blockers list', async () => {
      // Arrange
      const storagePath = await tempHelper.createDir('.kiro/sdlc/evidence');
      const mockGitClient = createMockGitClient();
      const evidenceManager = new FileEvidenceManager({
        storagePath,
        gitClient: mockGitClient,
      });

      // No evidence - all required gates will fail

      // Act
      const result = await evidenceManager.validateAllGates('TASK-001', {
        gates: ['unit_test', 'lint'],
        gateConfigs: {
          unit_test: { required: true },
          lint: { required: true },
        },
      });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.blockers.length).toBe(2);
        expect(result.value.blockers.some(b => b.includes('unit_test'))).toBe(true);
        expect(result.value.blockers.some(b => b.includes('lint'))).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Helper Functions Tests
  // ===========================================================================

  describe('getDefaultGateConfig()', () => {
    it('should return required=true for unit_test', () => {
      const config = getDefaultGateConfig('unit_test');
      expect(config.required).toBe(true);
    });

    it('should return required=false for security_scan', () => {
      const config = getDefaultGateConfig('security_scan');
      expect(config.required).toBe(false);
    });

    it('should return minPassRate=100 for unit_test', () => {
      const config = getDefaultGateConfig('unit_test');
      expect(config.minPassRate).toBe(100);
    });

    it('should return allowStale=true for manual_review', () => {
      const config = getDefaultGateConfig('manual_review');
      expect(config.allowStale).toBe(true);
    });
  });

  describe('getDefaultGatesConfig()', () => {
    it('should include default gates', () => {
      const config = getDefaultGatesConfig();
      expect(config.gates).toContain('unit_test');
      expect(config.gates).toContain('integration_test');
      expect(config.gates).toContain('lint');
      expect(config.gates).toContain('type_check');
    });

    it('should have gate configurations', () => {
      const config = getDefaultGatesConfig();
      expect(config.gateConfigs).toBeDefined();
      expect(config.gateConfigs!.unit_test).toBeDefined();
    });
  });
});


// =============================================================================
// Unit Tests for Enhanced TDD Evidence Validation (Task T22)
// =============================================================================

import {
  TddValidationResult,
  TddValidationDiagnostics,
  TestIdentifier,
  validateTddRed,
  validateTddGreen,
  validateTddRefactor,
  validateTddVerify,
  validateTddEvidence,
  extractTestIdentifier,
  testIdentifiersMatch,
} from '../evidence-manager';

describe('Enhanced TDD Evidence Validation', () => {
  
  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  /**
   * Creates a mock Evidence object for testing TDD validation.
   */
  const createMockEvidence = (
    phase: TddPhase,
    result: Partial<EvidenceResult>,
    exitCode: number = 1
  ): Evidence => ({
    evidence_id: `EVD-TEST-${phase}`,
    created_at: new Date().toISOString(),
    type: `TDD_${phase}` as EvidenceType,
    task_id: 'TASK-001',
    tdd_phase: phase,
    requirement_refs: ['REQ-001'],
    ac_refs: ['REQ-001-AC1'],
    git_state: {
      commit_sha: 'abc123',
      branch: 'feature/test',
      working_tree_dirty: false,
      uncommitted_files: [],
    },
    execution: {
      command: 'npm test',
      timestamp: new Date().toISOString(),
      duration_ms: 1000,
      exit_code: exitCode,
    },
    result: {
      status: 'FAIL',
      summary: 'Test result',
      ...result,
    },
    executor: {
      id: 'dev-001',
      type: 'HUMAN',
    },
    staleness: {
      stale: false,
      stale_reason: null,
      checked_at: new Date().toISOString(),
      related_files: [],
    },
  });

  // ===========================================================================
  // validateTddRed() Tests - Requirements R05.1, R05.2, R05.3, R05.8
  // ===========================================================================

  describe('validateTddRed()', () => {
    /**
     * Test: Valid RED phase with BEHAVIOR_MISSING
     * **Validates: R05.2** - RED valid ONLY IF test fails for BEHAVIOR_MISSING
     */
    it('should return valid for FAIL with BEHAVIOR_MISSING', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        summary: 'Test fails as expected',
        failure_type: 'BEHAVIOR_MISSING',
        test_file: 'src/auth.test.ts',
        test_name: 'should authenticate user',
      });

      // Act
      const result = validateTddRed(evidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.phase).toBe('RED');
      expect(result.error_code).toBeUndefined();
      expect(result.diagnostics?.actual_behavior).toContain('missing behavior');
    });

    /**
     * Test: Invalid RED when test PASSES unexpectedly
     * **Validates: R05.1** - Detect when behavior already exists
     */
    it('should return invalid with TEST_PASSED_UNEXPECTEDLY when test passes', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'PASS',
        summary: 'Test unexpectedly passed',
      }, 0);

      // Act
      const result = validateTddRed(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('TEST_PASSED_UNEXPECTEDLY');
      expect(result.reason).toContain('behavior already exists');
      expect(result.suggested_actions).toBeDefined();
      expect(result.suggested_actions!.length).toBeGreaterThan(0);
    });

    /**
     * Test: Invalid RED for TEST_ERROR failure type
     * **Validates: R05.8** - Distinguish TEST_ERROR from BEHAVIOR_MISSING
     */
    it('should return invalid with TEST_ERROR_DETECTED for syntax/import errors', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        summary: 'Syntax error in test',
        failure_type: 'TEST_ERROR',
      });

      // Act
      const result = validateTddRed(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('TEST_ERROR_DETECTED');
      expect(result.reason).toContain('fix test first');
      expect(result.diagnostics?.expected_behavior).toContain('not test bugs');
    });

    /**
     * Test: Invalid RED for ENVIRONMENT_ERROR failure type
     * **Validates: R05.8** - Distinguish ENVIRONMENT_ERROR from BEHAVIOR_MISSING
     */
    it('should return invalid with ENVIRONMENT_ERROR_DETECTED for runtime issues', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        summary: 'Database connection failed',
        failure_type: 'ENVIRONMENT_ERROR',
      });

      // Act
      const result = validateTddRed(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('ENVIRONMENT_ERROR_DETECTED');
      expect(result.reason).toContain('fix environment first');
      expect(result.suggested_actions).toContain('Check database/service connections');
    });

    /**
     * Test: Invalid RED when test is SKIPPED
     * **Validates: R05.8** - SKIPPED is invalid evidence
     */
    it('should return invalid with TEST_SKIPPED when test not executed', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        summary: 'Test skipped',
        failure_type: 'SKIPPED',
      });

      // Act
      const result = validateTddRed(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('TEST_SKIPPED');
      expect(result.reason).toContain('not executed');
    });

    /**
     * Test: Invalid RED when failure type is not BEHAVIOR_MISSING
     * **Validates: R05.2** - Failure must be due to missing behavior
     */
    it('should return invalid when failure type is undefined', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        summary: 'Test fails for unknown reason',
        failure_type: undefined,
      });

      // Act
      const result = validateTddRed(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('TEST_FAILED_WRONG_REASON');
      expect(result.reason).toContain('BEHAVIOR_MISSING');
    });

    /**
     * Test: Diagnostics include test file and name
     * **Validates: R05.3** - Evidence includes command, test file, test name
     */
    it('should include test_file and test_name in diagnostics', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        summary: 'Test fails',
        failure_type: 'BEHAVIOR_MISSING',
        test_file: 'src/auth.test.ts',
        test_name: 'user authentication > should login',
      });

      // Act
      const result = validateTddRed(evidence);

      // Assert
      expect(result.diagnostics?.test_file).toBe('src/auth.test.ts');
      expect(result.diagnostics?.test_name).toBe('user authentication > should login');
      expect(result.diagnostics?.exit_code).toBe(1);
    });

    /**
     * Test: validated_at timestamp is set
     */
    it('should set validated_at timestamp', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        failure_type: 'BEHAVIOR_MISSING',
      });
      const beforeValidation = new Date();

      // Act
      const result = validateTddRed(evidence);

      const afterValidation = new Date();

      // Assert
      expect(result.validated_at).toBeDefined();
      const validatedAt = new Date(result.validated_at);
      expect(validatedAt.getTime()).toBeGreaterThanOrEqual(beforeValidation.getTime());
      expect(validatedAt.getTime()).toBeLessThanOrEqual(afterValidation.getTime());
    });
  });

  // ===========================================================================
  // validateTddGreen() Tests - Requirements R05.4
  // ===========================================================================

  describe('validateTddGreen()', () => {
    /**
     * Test: Valid GREEN when test passes
     * **Validates: R05.4** - GREEN phase expects test to pass
     */
    it('should return valid for PASS status', () => {
      // Arrange
      const evidence = createMockEvidence('GREEN', {
        status: 'PASS',
        summary: 'Test passes',
        tests_passed: 1,
        tests_failed: 0,
        tests_total: 1,
      }, 0);

      // Act
      const result = validateTddGreen(evidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.phase).toBe('GREEN');
      expect(result.diagnostics?.actual_behavior).toContain('passes');
    });

    /**
     * Test: Invalid GREEN when test still fails
     * **Validates: R05.4** - GREEN requires PASS status
     */
    it('should return invalid with TEST_STILL_FAILING when test fails', () => {
      // Arrange
      const evidence = createMockEvidence('GREEN', {
        status: 'FAIL',
        summary: 'Test still failing',
        failure_type: 'BEHAVIOR_MISSING',
      });

      // Act
      const result = validateTddGreen(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('TEST_STILL_FAILING');
      expect(result.reason).toContain('PASS');
      expect(result.suggested_actions).toContain('Implement the minimum code to make the test pass');
    });

    /**
     * Test: Invalid GREEN when other tests fail (regression)
     * **Validates: R05.4** - No other tests should fail
     */
    it('should return invalid with REGRESSION_DETECTED when tests_failed > 0', () => {
      // Arrange
      const evidence = createMockEvidence('GREEN', {
        status: 'PASS',
        summary: 'Main test passes but others fail',
        tests_passed: 9,
        tests_failed: 1,
        tests_total: 10,
      }, 0);

      // Act
      const result = validateTddGreen(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('REGRESSION_DETECTED');
      expect(result.reason).toContain('1 tests failed');
    });

    /**
     * Test: GREEN validation with RED evidence correlation
     * **Validates: R05.4** - Track test IDs for correlation
     */
    it('should validate same test was run as RED phase', () => {
      // Arrange
      const redEvidence = createMockEvidence('RED', {
        status: 'FAIL',
        failure_type: 'BEHAVIOR_MISSING',
        test_file: 'src/auth.test.ts',
        test_name: 'should authenticate user',
      });

      const greenEvidence = createMockEvidence('GREEN', {
        status: 'PASS',
        test_file: 'src/auth.test.ts',
        test_name: 'should authenticate user',
      }, 0);

      // Act
      const result = validateTddGreen(greenEvidence, redEvidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.diagnostics?.reference_evidence_ids).toContain(redEvidence.evidence_id);
    });

    /**
     * Test: Invalid GREEN when test ID mismatches RED
     * **Validates: R05.4** - Same test must be correlated
     */
    it('should return invalid with TEST_ID_MISMATCH when test differs from RED', () => {
      // Arrange
      const redEvidence = createMockEvidence('RED', {
        status: 'FAIL',
        failure_type: 'BEHAVIOR_MISSING',
        test_file: 'src/auth.test.ts',
        test_name: 'should authenticate user',
      });

      const greenEvidence = createMockEvidence('GREEN', {
        status: 'PASS',
        test_file: 'src/auth.test.ts',
        test_name: 'should logout user', // Different test name!
      }, 0);

      // Act
      const result = validateTddGreen(greenEvidence, redEvidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('TEST_ID_MISMATCH');
      expect(result.reason).toContain('does not match');
    });

    /**
     * Test: GREEN validation without RED evidence (still valid)
     */
    it('should return valid without RED evidence if test passes', () => {
      // Arrange
      const greenEvidence = createMockEvidence('GREEN', {
        status: 'PASS',
      }, 0);

      // Act
      const result = validateTddGreen(greenEvidence, undefined);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.diagnostics?.reference_evidence_ids).toBeUndefined();
    });
  });

  // ===========================================================================
  // validateTddRefactor() Tests - Requirements R05.5, R05.6
  // ===========================================================================

  describe('validateTddRefactor()', () => {
    /**
     * Test: Valid REFACTOR when all tests pass
     * **Validates: R05.5** - REFACTOR requires all tests pass
     */
    it('should return valid for PASS status', () => {
      // Arrange
      const evidence = createMockEvidence('REFACTOR', {
        status: 'PASS',
        summary: 'All tests pass after refactoring',
        tests_passed: 10,
        tests_failed: 0,
        tests_total: 10,
      }, 0);

      // Act
      const result = validateTddRefactor(evidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.phase).toBe('REFACTOR');
    });

    /**
     * Test: Invalid REFACTOR when tests fail
     * **Validates: R05.6** - Test FAIL after REFACTOR
     */
    it('should return invalid with REGRESSION_DETECTED when tests fail', () => {
      // Arrange
      const evidence = createMockEvidence('REFACTOR', {
        status: 'FAIL',
        summary: 'Refactoring broke something',
      });

      // Act
      const result = validateTddRefactor(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('REGRESSION_DETECTED');
      expect(result.suggested_actions).toContain('Rollback the refactoring changes');
    });

    /**
     * Test: Invalid REFACTOR for REGRESSION failure type
     * **Validates: R05.6** - Regression detection
     */
    it('should return invalid for REGRESSION failure type even with PASS status', () => {
      // Arrange
      const evidence = createMockEvidence('REFACTOR', {
        status: 'PASS',
        failure_type: 'REGRESSION',
      }, 0);

      // Act
      const result = validateTddRefactor(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('REGRESSION_DETECTED');
      expect(result.reason).toContain('regression');
    });

    /**
     * Test: Invalid REFACTOR when tests_failed > 0
     */
    it('should return invalid when tests_failed > 0', () => {
      // Arrange
      const evidence = createMockEvidence('REFACTOR', {
        status: 'PASS', // Status PASS but some tests failed
        tests_passed: 8,
        tests_failed: 2,
        tests_total: 10,
      }, 0);

      // Act
      const result = validateTddRefactor(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('REGRESSION_DETECTED');
      expect(result.reason).toContain('2 tests failed');
    });

    /**
     * Test: REFACTOR tracks coverage changes
     * **Validates: R05.5** - Coverage changes are allowed
     */
    it('should track coverage change from GREEN phase', () => {
      // Arrange
      const greenEvidence = createMockEvidence('GREEN', {
        status: 'PASS',
        coverage_percent: 85,
      }, 0);

      const refactorEvidence = createMockEvidence('REFACTOR', {
        status: 'PASS',
        coverage_percent: 90,
      }, 0);

      // Act
      const result = validateTddRefactor(refactorEvidence, greenEvidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.diagnostics?.coverage_change).toBeDefined();
      expect(result.diagnostics?.coverage_change?.before).toBe(85);
      expect(result.diagnostics?.coverage_change?.after).toBe(90);
      expect(result.diagnostics?.coverage_change?.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // validateTddVerify() Tests
  // ===========================================================================

  describe('validateTddVerify()', () => {
    /**
     * Test: Valid VERIFY when all checks pass
     */
    it('should return valid for PASS status', () => {
      // Arrange
      const evidence = createMockEvidence('VERIFY', {
        status: 'PASS',
        summary: 'All verification checks pass',
      }, 0);

      // Act
      const result = validateTddVerify(evidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.phase).toBe('VERIFY');
    });

    /**
     * Test: Valid VERIFY for NOT_APPLICABLE status
     */
    it('should return valid for NOT_APPLICABLE status', () => {
      // Arrange
      const evidence = createMockEvidence('VERIFY', {
        status: 'NOT_APPLICABLE',
        summary: 'No additional verification needed',
      }, 0);

      // Act
      const result = validateTddVerify(evidence);

      // Assert
      expect(result.valid).toBe(true);
    });

    /**
     * Test: Invalid VERIFY when checks fail
     */
    it('should return invalid with VERIFICATION_FAILED when checks fail', () => {
      // Arrange
      const evidence = createMockEvidence('VERIFY', {
        status: 'FAIL',
        summary: 'Lint check failed',
      });

      // Act
      const result = validateTddVerify(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('VERIFICATION_FAILED');
      expect(result.suggested_actions).toContain('Fix any lint errors');
    });

    /**
     * Test: Invalid VERIFY when tests_failed > 0
     */
    it('should return invalid when tests_failed > 0', () => {
      // Arrange
      const evidence = createMockEvidence('VERIFY', {
        status: 'PASS',
        tests_passed: 8,
        tests_failed: 2,
        tests_total: 10,
      }, 0);

      // Act
      const result = validateTddVerify(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('VERIFICATION_FAILED');
      expect(result.reason).toContain('2 checks failed');
    });
  });

  // ===========================================================================
  // validateTddEvidence() Dispatcher Tests
  // ===========================================================================

  describe('validateTddEvidence()', () => {
    /**
     * Test: Dispatches to correct validator based on phase
     */
    it('should dispatch RED phase to validateTddRed', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        failure_type: 'BEHAVIOR_MISSING',
      });

      // Act
      const result = validateTddEvidence(evidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.phase).toBe('RED');
    });

    it('should dispatch GREEN phase to validateTddGreen', () => {
      // Arrange
      const evidence = createMockEvidence('GREEN', {
        status: 'PASS',
      }, 0);

      // Act
      const result = validateTddEvidence(evidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.phase).toBe('GREEN');
    });

    it('should dispatch REFACTOR phase to validateTddRefactor', () => {
      // Arrange
      const evidence = createMockEvidence('REFACTOR', {
        status: 'PASS',
      }, 0);

      // Act
      const result = validateTddEvidence(evidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.phase).toBe('REFACTOR');
    });

    it('should dispatch VERIFY phase to validateTddVerify', () => {
      // Arrange
      const evidence = createMockEvidence('VERIFY', {
        status: 'PASS',
      }, 0);

      // Act
      const result = validateTddEvidence(evidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.phase).toBe('VERIFY');
    });

    /**
     * Test: Returns error for missing TDD phase
     */
    it('should return invalid for evidence without TDD phase', () => {
      // Arrange
      const evidence = createMockEvidence('RED', {
        status: 'FAIL',
        failure_type: 'BEHAVIOR_MISSING',
      });
      evidence.tdd_phase = undefined; // Remove phase

      // Act
      const result = validateTddEvidence(evidence);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('INVALID_PHASE_SEQUENCE');
      expect(result.reason).toContain('no TDD phase');
    });

    /**
     * Test: Passes prior evidence to GREEN validation
     */
    it('should pass prior evidence for phase correlation', () => {
      // Arrange
      const redEvidence = createMockEvidence('RED', {
        status: 'FAIL',
        failure_type: 'BEHAVIOR_MISSING',
        test_file: 'test.ts',
        test_name: 'should work',
      });

      const greenEvidence = createMockEvidence('GREEN', {
        status: 'PASS',
        test_file: 'test.ts',
        test_name: 'should work',
      }, 0);

      // Act
      const result = validateTddEvidence(greenEvidence, redEvidence);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.diagnostics?.reference_evidence_ids).toContain(redEvidence.evidence_id);
    });
  });

  // ===========================================================================
  // Test Identifier Helper Functions Tests
  // ===========================================================================

  describe('extractTestIdentifier()', () => {
    /**
     * Test: Extracts test identifier from result
     */
    it('should extract test identifier from result with file and name', () => {
      // Arrange
      const result: EvidenceResult = {
        status: 'FAIL',
        summary: 'Test fails',
        test_file: 'src/auth.test.ts',
        test_name: 'should authenticate user',
      };

      // Act
      const identifier = extractTestIdentifier(result);

      // Assert
      expect(identifier).not.toBeNull();
      expect(identifier!.file).toBe('src/auth.test.ts');
      expect(identifier!.name).toBe('should authenticate user');
    });

    /**
     * Test: Returns null when test_file is missing
     */
    it('should return null when test_file is missing', () => {
      // Arrange
      const result: EvidenceResult = {
        status: 'FAIL',
        summary: 'Test fails',
        test_name: 'should authenticate user',
      };

      // Act
      const identifier = extractTestIdentifier(result);

      // Assert
      expect(identifier).toBeNull();
    });

    /**
     * Test: Returns null when test_name is missing
     */
    it('should return null when test_name is missing', () => {
      // Arrange
      const result: EvidenceResult = {
        status: 'FAIL',
        summary: 'Test fails',
        test_file: 'src/auth.test.ts',
      };

      // Act
      const identifier = extractTestIdentifier(result);

      // Assert
      expect(identifier).toBeNull();
    });
  });

  describe('testIdentifiersMatch()', () => {
    /**
     * Test: Matches identical test identifiers
     */
    it('should return true for identical identifiers', () => {
      // Arrange
      const a: TestIdentifier = {
        file: 'src/auth.test.ts',
        name: 'should authenticate',
      };
      const b: TestIdentifier = {
        file: 'src/auth.test.ts',
        name: 'should authenticate',
      };

      // Act
      const result = testIdentifiersMatch(a, b);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Test: Returns false for different file
     */
    it('should return false for different file', () => {
      // Arrange
      const a: TestIdentifier = {
        file: 'src/auth.test.ts',
        name: 'should authenticate',
      };
      const b: TestIdentifier = {
        file: 'src/user.test.ts',
        name: 'should authenticate',
      };

      // Act
      const result = testIdentifiersMatch(a, b);

      // Assert
      expect(result).toBe(false);
    });

    /**
     * Test: Returns false for different name
     */
    it('should return false for different name', () => {
      // Arrange
      const a: TestIdentifier = {
        file: 'src/auth.test.ts',
        name: 'should authenticate',
      };
      const b: TestIdentifier = {
        file: 'src/auth.test.ts',
        name: 'should logout',
      };

      // Act
      const result = testIdentifiersMatch(a, b);

      // Assert
      expect(result).toBe(false);
    });

    /**
     * Test: Returns false for null identifiers
     */
    it('should return false when either identifier is null', () => {
      const a: TestIdentifier = {
        file: 'src/auth.test.ts',
        name: 'should authenticate',
      };

      expect(testIdentifiersMatch(a, null)).toBe(false);
      expect(testIdentifiersMatch(null, a)).toBe(false);
      expect(testIdentifiersMatch(null, null)).toBe(false);
    });

    /**
     * Test: Matches by full_path as secondary
     */
    it('should match by full_path when file/name differ', () => {
      // Arrange
      const a: TestIdentifier = {
        file: 'src/auth.test.ts',
        name: 'auth > should authenticate',
        full_path: 'src/auth.test.ts::auth > should authenticate',
      };
      const b: TestIdentifier = {
        file: 'src/auth.test.ts',
        name: 'auth > should authenticate',
        full_path: 'src/auth.test.ts::auth > should authenticate',
      };

      // Act
      const result = testIdentifiersMatch(a, b);

      // Assert
      expect(result).toBe(true);
    });
  });
});
