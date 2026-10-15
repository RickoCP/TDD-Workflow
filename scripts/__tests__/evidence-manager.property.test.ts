/**
 * Property-Based Tests for Evidence_Manager - Staleness Detection
 * 
 * **Feature: sdlc-workflow-reliability**
 * 
 * These tests verify the universal correctness properties of the Evidence_Manager component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements R06.4, R06.5**
 * 
 * Properties tested:
 * 1. Matching Commit: Evidence with matching commit SHA = not stale
 * 2. File Change: File change after evidence = stale (FILES_MODIFIED)
 * 3. Freshness: Evidence created with current state remains fresh until changes
 * 4. Determinism: Staleness check is deterministic (same input = same output)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  Evidence,
  EvidenceInput,
  EvidenceType,
  EvidenceResultStatus,
  StalenessCheck,
  StalenessReason,
  FileHash,
  EVIDENCE_DEFAULTS,
} from '../evidence-manager';

import { FileEvidenceManager, MockGitClient, FileEvidenceManagerConfig } from '../evidence-manager-impl';
import { ActorType, TddPhase } from '../state-controller';

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
  private dirs: string[] = [];

  async setup(): Promise<void> {
    this.tempDir = path.join(process.cwd(), '.test-temp', `evidence-pbt-${Date.now()}`);
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
    this.fileCounter = 0;
  }

  async createDir(dirname: string): Promise<string> {
    const dirPath = path.join(this.tempDir, dirname);
    await fs.mkdir(dirPath, { recursive: true });
    this.dirs.push(dirPath);
    return dirPath;
  }

  createUniquePath(): string {
    return path.join(this.tempDir, `storage-${++this.fileCounter}`);
  }

  getTempDir(): string {
    return this.tempDir;
  }
}

/**
 * Creates a mock git client with configurable behavior.
 */
function createConfigurableMockGitClient(config: {
  currentCommitSha?: string;
  currentBranch?: string;
  isWorkingTreeDirty?: boolean;
  uncommittedFiles?: string[];
  commitExists?: boolean;
  fileHashes?: Record<string, string>;
  changedFiles?: string[];
}): MockGitClient {
  const defaultCommitSha = 'abc123def456789012345678901234567890abcd';
  const fileHashMap = config.fileHashes ?? {};
  
  return {
    getCurrentCommitSha: async () => config.currentCommitSha ?? defaultCommitSha,
    getCurrentBranch: async () => config.currentBranch ?? 'main',
    isWorkingTreeDirty: async () => config.isWorkingTreeDirty ?? false,
    getUncommittedFiles: async () => config.uncommittedFiles ?? [],
    commitExists: async () => config.commitExists ?? true,
    getFileHash: async (filePath: string) => fileHashMap[filePath] ?? `sha256:${filePath.replace(/[^a-z0-9]/gi, '')}hash`,
    getChangedFilesBetween: async () => config.changedFiles ?? [],
  };
}

/**
 * Creates a valid evidence input for testing.
 */
function createValidEvidenceInput(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    task_id: 'TASK-001',
    type: 'TDD_RED' as EvidenceType,
    tdd_phase: 'RED' as TddPhase,
    requirement_refs: ['REQ-001'],
    ac_refs: ['REQ-001-AC1'],
    command: 'npm test',
    working_directory: '/project',
    duration_ms: 1000,
    exit_code: 1,
    result: {
      status: 'FAIL' as EvidenceResultStatus,
      summary: 'Test fails as expected in RED phase',
      failure_type: 'BEHAVIOR_MISSING',
    },
    executor_id: 'dev-001',
    executor_type: 'HUMAN' as ActorType,
    related_files: ['src/test.ts'],
    ...overrides,
  };
}

// =============================================================================
// Arbitraries (Generators) for Property-Based Testing
// =============================================================================

/**
 * Generates a valid commit SHA (40 hex characters).
 */
const commitShaArb: fc.Arbitrary<string> = fc.hexaString({ minLength: 40, maxLength: 40 }).map(s => s.toLowerCase());

/**
 * Generates a valid task ID.
 */
const taskIdArb: fc.Arbitrary<string> = fc.stringMatching(/^TASK-[0-9]{3,6}$/)
  .filter(id => id.length >= 8);

/**
 * Generates a valid file path.
 */
const filePathArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z]+\/[a-z]+\.(ts|js|tsx|jsx)$/)
  .filter(p => p.length >= 5);

/**
 * Generates a list of unique file paths.
 */
const filePathsArb = (count: number): fc.Arbitrary<string[]> =>
  fc.array(filePathArb, { minLength: count, maxLength: count + 3 })
    .map(paths => [...new Set(paths)])
    .filter(paths => paths.length >= count);

/**
 * Generates a file hash in sha256:xxx format.
 */
const fileHashArb: fc.Arbitrary<string> = fc.hexaString({ minLength: 64, maxLength: 64 })
  .map(h => `sha256:${h.toLowerCase()}`);

/**
 * Generates a branch name.
 */
const branchNameArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z]+-[a-z]+-[0-9]{3}$/)
  .filter(b => b.length >= 8);

/**
 * Generates an executor ID.
 */
const executorIdArb: fc.Arbitrary<string> = fc.stringMatching(/^(dev|agent)-[0-9]{3}$/)
  .filter(id => id.length >= 7);

/**
 * Generates an actor type.
 */
const actorTypeArb: fc.Arbitrary<ActorType> = fc.constantFrom('HUMAN' as ActorType, 'AI_AGENT' as ActorType);

/**
 * Generates evidence type.
 */
const evidenceTypeArb: fc.Arbitrary<EvidenceType> = fc.constantFrom(
  'TDD_RED' as EvidenceType,
  'TDD_GREEN' as EvidenceType,
  'UNIT_TEST' as EvidenceType
);

/**
 * Generates a count for iteration tests.
 */
const iterationCountArb: fc.Arbitrary<number> = fc.integer({ min: 2, max: 5 });

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('Evidence_Manager Property-Based Tests', () => {
  let tempHelper: PropertyTestFileHelper;

  beforeEach(async () => {
    tempHelper = new PropertyTestFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  /**
   * **Property 1: Evidence with Matching Commit = Not Stale**
   * 
   * *For any* evidence where the git_state.commit_sha matches the current HEAD,
   * the evidence SHALL NOT be stale (assuming no file changes).
   * 
   * **Validates: Requirements R06.4**
   */
  describe('Property 1: Matching Commit SHA → Not Stale', () => {
    it('should report evidence as not stale when commit SHA matches current HEAD', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          taskIdArb,
          filePathsArb(1),
          branchNameArb,
          async (commitSha, taskId, filePaths, branchName) => {
            // Create storage directory
            const storagePath = await tempHelper.createDir(`evidence-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            // Git client returns same commit as will be stored in evidence
            const mockGitClient = createConfigurableMockGitClient({
              currentCommitSha: commitSha,
              currentBranch: branchName,
              commitExists: true,
              changedFiles: [], // No files changed
            });

            const evidenceManager = new FileEvidenceManager({
              storagePath,
              gitClient: mockGitClient,
            });

            // Create evidence
            const input = createValidEvidenceInput({
              task_id: taskId,
              related_files: filePaths,
            });
            const createResult = await evidenceManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            const evidenceId = createResult.value.evidence_id;

            // Check staleness - should NOT be stale since commit matches
            const stalenessResult = await evidenceManager.checkStaleness(evidenceId);
            expect(stalenessResult.success).toBe(true);
            if (!stalenessResult.success) return;

            // Property assertion: matching commit SHA → not stale
            expect(stalenessResult.value.stale).toBe(false);
            expect(stalenessResult.value.reason).toBeNull();
            expect(stalenessResult.value.current_commit_sha).toBe(commitSha);
            expect(stalenessResult.value.evidence_commit_sha).toBe(commitSha);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should always return not stale for evidence checked immediately after creation', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          taskIdArb,
          async (commitSha, taskId) => {
            const storagePath = await tempHelper.createDir(`evidence-imm-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            const mockGitClient = createConfigurableMockGitClient({
              currentCommitSha: commitSha,
              commitExists: true,
              changedFiles: [],
            });

            const evidenceManager = new FileEvidenceManager({
              storagePath,
              gitClient: mockGitClient,
            });

            const input = createValidEvidenceInput({ task_id: taskId });
            const createResult = await evidenceManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            // Immediate staleness check
            const stalenessResult = await evidenceManager.checkStaleness(createResult.value.evidence_id);
            expect(stalenessResult.success).toBe(true);
            if (!stalenessResult.success) return;

            // Evidence just created should never be stale
            expect(stalenessResult.value.stale).toBe(false);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  /**
   * **Property 2: File Change After Evidence = Stale**
   * 
   * *For any* evidence where related files have changed since creation,
   * the evidence SHALL be stale with reason FILES_MODIFIED.
   * 
   * **Validates: Requirements R06.5**
   */
  describe('Property 2: File Change → Stale (FILES_MODIFIED)', () => {
    it('should report evidence as stale when related files have changed', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          commitShaArb,
          taskIdArb,
          filePathsArb(2),
          async (originalCommit, newCommit, taskId, filePaths) => {
            // Ensure commits are different
            if (originalCommit === newCommit) return;
            
            const storagePath = await tempHelper.createDir(`evidence-fc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            // Create evidence with original commit
            const createGitClient = createConfigurableMockGitClient({
              currentCommitSha: originalCommit,
              commitExists: true,
              changedFiles: [],
            });

            const createManager = new FileEvidenceManager({
              storagePath,
              gitClient: createGitClient,
            });

            const input = createValidEvidenceInput({
              task_id: taskId,
              related_files: filePaths,
            });
            const createResult = await createManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            const evidenceId = createResult.value.evidence_id;

            // Now check staleness with different commit AND changed files
            const checkGitClient = createConfigurableMockGitClient({
              currentCommitSha: newCommit,
              commitExists: true,
              changedFiles: [filePaths[0]], // One of the related files changed
            });

            const checkManager = new FileEvidenceManager({
              storagePath,
              gitClient: checkGitClient,
            });

            const stalenessResult = await checkManager.checkStaleness(evidenceId);
            expect(stalenessResult.success).toBe(true);
            if (!stalenessResult.success) return;

            // Property assertion: file change → stale with FILES_MODIFIED
            expect(stalenessResult.value.stale).toBe(true);
            expect(stalenessResult.value.reason).toBe('FILES_MODIFIED');
            expect(stalenessResult.value.affected_files).toBeDefined();
            expect(stalenessResult.value.affected_files).toContain(filePaths[0]);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should include all affected files when multiple related files change', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          commitShaArb,
          taskIdArb,
          filePathsArb(3),
          async (originalCommit, newCommit, taskId, filePaths) => {
            if (originalCommit === newCommit) return;
            if (filePaths.length < 2) return;
            
            const storagePath = await tempHelper.createDir(`evidence-mf-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            // Create evidence
            const createGitClient = createConfigurableMockGitClient({
              currentCommitSha: originalCommit,
              commitExists: true,
            });

            const createManager = new FileEvidenceManager({
              storagePath,
              gitClient: createGitClient,
            });

            const input = createValidEvidenceInput({
              task_id: taskId,
              related_files: filePaths,
            });
            const createResult = await createManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            // Check staleness with multiple files changed
            const changedFiles = filePaths.slice(0, 2); // First 2 files changed
            const checkGitClient = createConfigurableMockGitClient({
              currentCommitSha: newCommit,
              commitExists: true,
              changedFiles,
            });

            const checkManager = new FileEvidenceManager({
              storagePath,
              gitClient: checkGitClient,
            });

            const stalenessResult = await checkManager.checkStaleness(createResult.value.evidence_id);
            expect(stalenessResult.success).toBe(true);
            if (!stalenessResult.success) return;

            // All changed files should be in affected_files
            expect(stalenessResult.value.stale).toBe(true);
            expect(stalenessResult.value.affected_files).toBeDefined();
            for (const changedFile of changedFiles) {
              expect(stalenessResult.value.affected_files).toContain(changedFile);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * **Property 3: Evidence Freshness Until Changes**
   * 
   * *For any* evidence created with current state, it SHALL remain fresh
   * until either the commit changes or related files are modified.
   * 
   * **Validates: Requirements R06.4, R06.5**
   */
  describe('Property 3: Evidence Remains Fresh Until Changes', () => {
    it('should report commit change without file change as COMMIT_CHANGED (not FILES_MODIFIED)', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          commitShaArb,
          taskIdArb,
          filePathsArb(1),
          async (originalCommit, newCommit, taskId, filePaths) => {
            if (originalCommit === newCommit) return;
            
            const storagePath = await tempHelper.createDir(`evidence-cc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            // Create evidence
            const createGitClient = createConfigurableMockGitClient({
              currentCommitSha: originalCommit,
              commitExists: true,
            });

            const createManager = new FileEvidenceManager({
              storagePath,
              gitClient: createGitClient,
            });

            const input = createValidEvidenceInput({
              task_id: taskId,
              related_files: filePaths,
            });
            const createResult = await createManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            // Check staleness: commit changed but NO related files changed
            const checkGitClient = createConfigurableMockGitClient({
              currentCommitSha: newCommit,
              commitExists: true,
              changedFiles: ['unrelated/file.ts'], // Only unrelated files changed
            });

            const checkManager = new FileEvidenceManager({
              storagePath,
              gitClient: checkGitClient,
            });

            const stalenessResult = await checkManager.checkStaleness(createResult.value.evidence_id);
            expect(stalenessResult.success).toBe(true);
            if (!stalenessResult.success) return;

            // Commit changed but related files unchanged → COMMIT_CHANGED, not FILES_MODIFIED
            expect(stalenessResult.value.stale).toBe(true);
            expect(stalenessResult.value.reason).toBe('COMMIT_CHANGED');
            expect(stalenessResult.value.current_commit_sha).toBe(newCommit);
            expect(stalenessResult.value.evidence_commit_sha).toBe(originalCommit);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should detect COMMIT_NOT_FOUND when original commit is deleted', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          taskIdArb,
          async (originalCommit, taskId) => {
            const storagePath = await tempHelper.createDir(`evidence-cnf-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            // Create evidence with commit that exists
            const createGitClient = createConfigurableMockGitClient({
              currentCommitSha: originalCommit,
              commitExists: true,
            });

            const createManager = new FileEvidenceManager({
              storagePath,
              gitClient: createGitClient,
            });

            const input = createValidEvidenceInput({ task_id: taskId });
            const createResult = await createManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            // Now check staleness with commit no longer existing
            const checkGitClient = createConfigurableMockGitClient({
              currentCommitSha: originalCommit,
              commitExists: false, // Commit was garbage collected or force-pushed away
            });

            const checkManager = new FileEvidenceManager({
              storagePath,
              gitClient: checkGitClient,
            });

            const stalenessResult = await checkManager.checkStaleness(createResult.value.evidence_id);
            expect(stalenessResult.success).toBe(true);
            if (!stalenessResult.success) return;

            // Missing commit → COMMIT_NOT_FOUND
            expect(stalenessResult.value.stale).toBe(true);
            expect(stalenessResult.value.reason).toBe('COMMIT_NOT_FOUND');
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * **Property 4: Staleness Check is Deterministic**
   * 
   * *For any* evidence and git state, calling checkStaleness multiple times
   * SHALL return the same result (deterministic).
   * 
   * **Validates: Requirements R06.4**
   */
  describe('Property 4: Determinism - Same Input = Same Output', () => {
    it('should return identical staleness results for multiple checks with same state', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          taskIdArb,
          iterationCountArb,
          async (commitSha, taskId, iterations) => {
            const storagePath = await tempHelper.createDir(`evidence-det-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            const mockGitClient = createConfigurableMockGitClient({
              currentCommitSha: commitSha,
              commitExists: true,
              changedFiles: [],
            });

            const evidenceManager = new FileEvidenceManager({
              storagePath,
              gitClient: mockGitClient,
            });

            const input = createValidEvidenceInput({ task_id: taskId });
            const createResult = await evidenceManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            const evidenceId = createResult.value.evidence_id;

            // Check staleness multiple times
            const results: StalenessCheck[] = [];
            for (let i = 0; i < iterations; i++) {
              const stalenessResult = await evidenceManager.checkStaleness(evidenceId);
              expect(stalenessResult.success).toBe(true);
              if (!stalenessResult.success) return;
              results.push(stalenessResult.value);
            }

            // All results should be identical (except for checked_at timestamp)
            const firstResult = results[0];
            for (let i = 1; i < results.length; i++) {
              expect(results[i].stale).toBe(firstResult.stale);
              expect(results[i].reason).toBe(firstResult.reason);
              expect(results[i].evidence_commit_sha).toBe(firstResult.evidence_commit_sha);
              expect(results[i].current_commit_sha).toBe(firstResult.current_commit_sha);
              // affected_files should match if present
              if (firstResult.affected_files) {
                expect(results[i].affected_files).toEqual(firstResult.affected_files);
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should return identical stale results for multiple checks when files changed', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          commitShaArb,
          taskIdArb,
          filePathsArb(2),
          iterationCountArb,
          async (originalCommit, newCommit, taskId, filePaths, iterations) => {
            if (originalCommit === newCommit) return;
            
            const storagePath = await tempHelper.createDir(`evidence-det2-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            // Create evidence
            const createGitClient = createConfigurableMockGitClient({
              currentCommitSha: originalCommit,
              commitExists: true,
            });

            const createManager = new FileEvidenceManager({
              storagePath,
              gitClient: createGitClient,
            });

            const input = createValidEvidenceInput({
              task_id: taskId,
              related_files: filePaths,
            });
            const createResult = await createManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            // Check staleness with changed state
            const changedFile = filePaths[0];
            const checkGitClient = createConfigurableMockGitClient({
              currentCommitSha: newCommit,
              commitExists: true,
              changedFiles: [changedFile],
            });

            const checkManager = new FileEvidenceManager({
              storagePath,
              gitClient: checkGitClient,
            });

            // Check staleness multiple times
            const results: StalenessCheck[] = [];
            for (let i = 0; i < iterations; i++) {
              const stalenessResult = await checkManager.checkStaleness(createResult.value.evidence_id);
              expect(stalenessResult.success).toBe(true);
              if (!stalenessResult.success) return;
              results.push(stalenessResult.value);
            }

            // All results should be identical
            const firstResult = results[0];
            for (let i = 1; i < results.length; i++) {
              expect(results[i].stale).toBe(firstResult.stale);
              expect(results[i].reason).toBe(firstResult.reason);
              expect(results[i].evidence_commit_sha).toBe(firstResult.evidence_commit_sha);
              expect(results[i].current_commit_sha).toBe(firstResult.current_commit_sha);
              expect(results[i].affected_files).toEqual(firstResult.affected_files);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * **Property 5: Staleness Reason Priority**
   * 
   * *For any* evidence check, FILES_MODIFIED takes priority over COMMIT_CHANGED
   * when related files have actually changed.
   * 
   * **Validates: Requirements R06.5**
   */
  describe('Property 5: Staleness Reason Priority', () => {
    it('should return FILES_MODIFIED when both commit changed and files changed', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          commitShaArb,
          taskIdArb,
          filePathsArb(2),
          async (originalCommit, newCommit, taskId, filePaths) => {
            if (originalCommit === newCommit) return;
            
            const storagePath = await tempHelper.createDir(`evidence-pri-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            // Create evidence
            const createGitClient = createConfigurableMockGitClient({
              currentCommitSha: originalCommit,
              commitExists: true,
            });

            const createManager = new FileEvidenceManager({
              storagePath,
              gitClient: createGitClient,
            });

            const input = createValidEvidenceInput({
              task_id: taskId,
              related_files: filePaths,
            });
            const createResult = await createManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            // Check with both commit changed AND files changed
            const checkGitClient = createConfigurableMockGitClient({
              currentCommitSha: newCommit,
              commitExists: true,
              changedFiles: filePaths, // All related files changed
            });

            const checkManager = new FileEvidenceManager({
              storagePath,
              gitClient: checkGitClient,
            });

            const stalenessResult = await checkManager.checkStaleness(createResult.value.evidence_id);
            expect(stalenessResult.success).toBe(true);
            if (!stalenessResult.success) return;

            // FILES_MODIFIED should take priority
            expect(stalenessResult.value.stale).toBe(true);
            expect(stalenessResult.value.reason).toBe('FILES_MODIFIED');
            expect(stalenessResult.value.affected_files).toBeDefined();
            expect(stalenessResult.value.affected_files!.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * **Property 6: Evidence ID Consistency**
   * 
   * *For any* staleness check, the evidence_id in the result SHALL match
   * the evidence_id that was checked.
   * 
   * **Validates: Requirements R06.4**
   */
  describe('Property 6: Evidence ID Consistency in Results', () => {
    it('should always return the correct evidence_id in staleness check result', () => {
      fc.assert(
        fc.asyncProperty(
          commitShaArb,
          taskIdArb,
          async (commitSha, taskId) => {
            const storagePath = await tempHelper.createDir(`evidence-id-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
            
            const mockGitClient = createConfigurableMockGitClient({
              currentCommitSha: commitSha,
              commitExists: true,
            });

            const evidenceManager = new FileEvidenceManager({
              storagePath,
              gitClient: mockGitClient,
            });

            const input = createValidEvidenceInput({ task_id: taskId });
            const createResult = await evidenceManager.createEvidence(input);
            expect(createResult.success).toBe(true);
            if (!createResult.success) return;

            const expectedEvidenceId = createResult.value.evidence_id;

            const stalenessResult = await evidenceManager.checkStaleness(expectedEvidenceId);
            expect(stalenessResult.success).toBe(true);
            if (!stalenessResult.success) return;

            // Evidence ID in result should match what was requested
            expect(stalenessResult.value.evidence_id).toBe(expectedEvidenceId);
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
