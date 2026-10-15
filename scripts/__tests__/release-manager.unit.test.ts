/**
 * Release Manager Unit Tests
 * 
 * Tests for the FileReleaseManager implementation focusing on:
 * - Release planning (planRelease)
 * - Readiness checking (checkReadiness)
 * - Query operations (getRelease, listReleases)
 * - Release cancellation
 * 
 * Requirements: R15.1, R15.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yaml from 'yaml';

import {
  FileReleaseManager,
  TaskReader,
  TaskInfo,
  DocumentationChecker,
  createFileReleaseManager,
} from '../release-manager-impl';

import {
  Release,
  ReleaseStatus,
  ReadinessReport,
  ReleaseErrorCode,
  PlanReleaseInput,
  createDefaultReleaseConfig,
} from '../release-manager';

import type { EvidenceManager, Evidence, ListEvidenceResult } from '../evidence-manager';
import type { FindingRegister, Finding, ListFindingsResult, FindingQueryOptions } from '../finding-register';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Creates a temporary directory for testing.
 */
async function createTempDir(): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `release-manager-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Cleans up a temporary directory.
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Creates a mock task reader.
 */
function createMockTaskReader(tasks: TaskInfo[] = []): TaskReader {
  return {
    listTasksForRelease: vi.fn().mockResolvedValue(tasks),
    getTask: vi.fn().mockImplementation((id: string) => {
      return Promise.resolve(tasks.find(t => t.id === id) ?? null);
    }),
  };
}

/**
 * Creates a mock evidence manager.
 */
function createMockEvidenceManager(
  staleEvidence: Evidence[] = [],
  allEvidence: Evidence[] = []
): EvidenceManager {
  return {
    getStaleEvidenceForRelease: vi.fn().mockResolvedValue({ success: true, value: staleEvidence }),
    listEvidence: vi.fn().mockResolvedValue({ success: true, value: allEvidence }),
    createEvidence: vi.fn(),
    getEvidence: vi.fn(),
    listEvidenceByType: vi.fn(),
    getLatestEvidence: vi.fn(),
    checkStaleness: vi.fn(),
    markStale: vi.fn(),
    getStaleEvidence: vi.fn(),
    validateGate: vi.fn(),
    validateAllGates: vi.fn(),
    deleteEvidence: vi.fn(),
  } as unknown as EvidenceManager;
}

/**
 * Creates a mock finding.
 */
function createMockFinding(
  id: string,
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO',
  status: 'OPEN' | 'RESOLVED' = 'OPEN'
): Finding {
  return {
    finding_id: id,
    created_at: new Date().toISOString(),
    task_id: 'TASK-001',
    review_round: 1,
    severity,
    category: 'BUG',
    scope: { type: 'general' },
    description: `Test finding ${id}`,
    evidence: 'Test evidence',
    acceptance_criteria: 'Fix the issue',
    owner_id: 'dev-001',
    status,
    history: [],
  } as Finding;
}

/**
 * Creates a mock finding register.
 */
function createMockFindingRegister(
  criticalFindings: Finding[] = [],
  highFindings: Finding[] = [],
  mediumFindings: Finding[] = [],
  lowFindings: Finding[] = []
): FindingRegister {
  const mockListFindings = vi.fn().mockImplementation(
    (options?: FindingQueryOptions): Promise<ListFindingsResult> => {
      if (!options) {
        return Promise.resolve({ success: true, value: [] });
      }
      
      if (options.severity === 'CRITICAL') {
        return Promise.resolve({ success: true, value: criticalFindings });
      }
      if (options.severity === 'HIGH') {
        return Promise.resolve({ success: true, value: highFindings });
      }
      if (options.severity === 'MEDIUM') {
        return Promise.resolve({ success: true, value: mediumFindings });
      }
      if (options.severity === 'LOW') {
        return Promise.resolve({ success: true, value: lowFindings });
      }
      
      return Promise.resolve({ success: true, value: [] });
    }
  );

  return {
    listFindings: mockListFindings,
    createFinding: vi.fn(),
    getFinding: vi.fn(),
    updateFindingStatus: vi.fn(),
    getBlockingFindings: vi.fn(),
    canCloseReview: vi.fn(),
    reopenFinding: vi.fn(),
    deleteFinding: vi.fn(),
    getFindingsForTask: vi.fn(),
    getFindingsSummary: vi.fn(),
    deferFinding: vi.fn(),
    closeReview: vi.fn(),
  } as unknown as FindingRegister;
}

/**
 * Creates a mock documentation checker.
 */
function createMockDocumentationChecker(
  complete: boolean = true,
  missingItems: string[] = []
): DocumentationChecker {
  return {
    checkDocumentation: vi.fn().mockResolvedValue({
      complete,
      missing_items: missingItems,
      release_notes_drafted: complete,
      known_issues_documented: complete,
    }),
  };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('FileReleaseManager', () => {
  let tempDir: string;
  let releaseManager: FileReleaseManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    releaseManager = createFileReleaseManager({ storagePath: tempDir });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // ===========================================================================
  // planRelease Tests
  // ===========================================================================

  describe('planRelease', () => {
    it('should create a new release with PLANNING status', async () => {
      const input: PlanReleaseInput = {
        version: '1.0.0',
        created_by: 'dev-001',
        release_notes: 'Initial release',
      };

      const result = await releaseManager.planRelease(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.version).toBe('1.0.0');
        expect(result.value.status).toBe('PLANNING');
        expect(result.value.created_by).toBe('dev-001');
        expect(result.value.release_notes).toBe('Initial release');
        expect(result.value.release_id).toMatch(/^REL-/);
        expect(result.value.stages.readiness_check.status).toBe('NOT_STARTED');
        expect(result.value.status_history).toHaveLength(1);
        expect(result.value.status_history[0].from_status).toBe('NOT_STARTED');
        expect(result.value.status_history[0].to_status).toBe('PLANNING');
      }
    });

    it('should persist release to storage', async () => {
      const input: PlanReleaseInput = {
        version: '1.0.0',
        created_by: 'dev-001',
      };

      const result = await releaseManager.planRelease(input);

      expect(result.success).toBe(true);
      if (result.success) {
        // Verify file was written
        const filePath = path.join(tempDir, `${result.value.release_id}.yaml`);
        const content = await fs.readFile(filePath, 'utf-8');
        const savedRelease = yaml.parse(content) as Release;
        
        expect(savedRelease.version).toBe('1.0.0');
        expect(savedRelease.release_id).toBe(result.value.release_id);
      }
    });

    it('should reject duplicate version', async () => {
      const input: PlanReleaseInput = {
        version: '1.0.0',
        created_by: 'dev-001',
      };

      // Create first release
      await releaseManager.planRelease(input);

      // Try to create duplicate
      const result = await releaseManager.planRelease(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.DUPLICATE_VERSION);
      }
    });

    it('should reject empty version', async () => {
      const input: PlanReleaseInput = {
        version: '',
        created_by: 'dev-001',
      };

      const result = await releaseManager.planRelease(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.MISSING_REQUIRED_FIELDS);
      }
    });

    it('should apply default configuration', async () => {
      const input: PlanReleaseInput = {
        version: '1.0.0',
        created_by: 'dev-001',
      };

      const result = await releaseManager.planRelease(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.config).toBeDefined();
        expect(result.value.config.require_human_approval).toBe(true);
        expect(result.value.config.monitoring_period_minutes).toBe(30);
      }
    });

    it('should allow custom configuration', async () => {
      const input: PlanReleaseInput = {
        version: '1.0.0',
        created_by: 'dev-001',
        config: {
          monitoring_period_minutes: 60,
          skip_staging: true,
        },
      };

      const result = await releaseManager.planRelease(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.config.monitoring_period_minutes).toBe(60);
        expect(result.value.config.skip_staging).toBe(true);
      }
    });

    it('should include known issues if provided', async () => {
      const input: PlanReleaseInput = {
        version: '1.0.0',
        created_by: 'dev-001',
        known_issues: ['Issue 1', 'Issue 2'],
      };

      const result = await releaseManager.planRelease(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.known_issues).toEqual(['Issue 1', 'Issue 2']);
      }
    });
  });

  // ===========================================================================
  // checkReadiness Tests
  // ===========================================================================

  describe('checkReadiness', () => {
    let releaseId: string;

    beforeEach(async () => {
      // Create a release first
      const input: PlanReleaseInput = {
        version: '1.0.0',
        created_by: 'dev-001',
        release_notes: 'Test release notes',
      };
      const result = await releaseManager.planRelease(input);
      if (result.success) {
        releaseId = result.value.release_id;
      }
    });

    it('should return ready when all checks pass', async () => {
      // Setup mocks - all pass
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
        { id: 'TASK-002', status: 'DONE' },
      ]);
      const evidenceManager = createMockEvidenceManager([], [
        { evidence_id: 'EVD-001' } as Evidence,
      ]);
      const findingRegister = createMockFindingRegister();
      const docChecker = createMockDocumentationChecker(true);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setEvidenceManager(evidenceManager);
      releaseManager.setFindingRegister(findingRegister);
      releaseManager.setDocumentationChecker(docChecker);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.ready).toBe(true);
        expect(result.value.blockers).toHaveLength(0);
        expect(result.value.tasks.done).toBe(2);
        expect(result.value.tasks.total).toBe(2);
      }
    });

    it('should return not ready when tasks are incomplete', async () => {
      // Setup mocks - incomplete tasks
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
        { id: 'TASK-002', status: 'IN_PROGRESS' },
        { id: 'TASK-003', status: 'BLOCKED' },
      ]);
      const evidenceManager = createMockEvidenceManager();
      const findingRegister = createMockFindingRegister();
      const docChecker = createMockDocumentationChecker(true);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setEvidenceManager(evidenceManager);
      releaseManager.setFindingRegister(findingRegister);
      releaseManager.setDocumentationChecker(docChecker);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.ready).toBe(false);
        expect(result.value.blockers.length).toBeGreaterThan(0);
        expect(result.value.tasks.done).toBe(1);
        expect(result.value.tasks.in_progress).toBe(1);
        expect(result.value.tasks.blocked).toBe(1);
        expect(result.value.tasks.incomplete_task_ids).toContain('TASK-002');
        expect(result.value.tasks.incomplete_task_ids).toContain('TASK-003');
      }
    });

    it('should return not ready when there is stale evidence', async () => {
      // Setup mocks - stale evidence
      const staleEvidence: Evidence[] = [
        { evidence_id: 'EVD-001', staleness: { stale: true } } as Evidence,
      ];
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
      ]);
      const evidenceManager = createMockEvidenceManager(staleEvidence, staleEvidence);
      const findingRegister = createMockFindingRegister();
      const docChecker = createMockDocumentationChecker(true);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setEvidenceManager(evidenceManager);
      releaseManager.setFindingRegister(findingRegister);
      releaseManager.setDocumentationChecker(docChecker);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.ready).toBe(false);
        expect(result.value.evidence.stale).toBe(1);
        expect(result.value.evidence.stale_evidence_ids).toContain('EVD-001');
        expect(result.value.blockers.some(b => b.includes('stale'))).toBe(true);
      }
    });

    it('should return not ready when CRITICAL findings exist', async () => {
      // Setup mocks - critical findings
      const criticalFindings = [createMockFinding('FND-001', 'CRITICAL')];
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
      ]);
      const evidenceManager = createMockEvidenceManager();
      const findingRegister = createMockFindingRegister(criticalFindings);
      const docChecker = createMockDocumentationChecker(true);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setEvidenceManager(evidenceManager);
      releaseManager.setFindingRegister(findingRegister);
      releaseManager.setDocumentationChecker(docChecker);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.ready).toBe(false);
        expect(result.value.findings.critical).toBe(1);
        expect(result.value.findings.blocking_finding_ids).toContain('FND-001');
        expect(result.value.blockers.some(b => b.includes('CRITICAL'))).toBe(true);
      }
    });

    it('should return not ready when HIGH findings exist', async () => {
      // Setup mocks - high findings
      const highFindings = [
        createMockFinding('FND-001', 'HIGH'),
        createMockFinding('FND-002', 'HIGH'),
      ];
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
      ]);
      const evidenceManager = createMockEvidenceManager();
      const findingRegister = createMockFindingRegister([], highFindings);
      const docChecker = createMockDocumentationChecker(true);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setEvidenceManager(evidenceManager);
      releaseManager.setFindingRegister(findingRegister);
      releaseManager.setDocumentationChecker(docChecker);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.ready).toBe(false);
        expect(result.value.findings.high).toBe(2);
        expect(result.value.blockers.some(b => b.includes('HIGH'))).toBe(true);
      }
    });

    it('should be ready even with MEDIUM/LOW findings', async () => {
      // Setup mocks - only medium and low findings
      const mediumFindings = [createMockFinding('FND-001', 'MEDIUM')];
      const lowFindings = [createMockFinding('FND-002', 'LOW')];
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
      ]);
      const evidenceManager = createMockEvidenceManager();
      const findingRegister = createMockFindingRegister([], [], mediumFindings, lowFindings);
      const docChecker = createMockDocumentationChecker(true);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setEvidenceManager(evidenceManager);
      releaseManager.setFindingRegister(findingRegister);
      releaseManager.setDocumentationChecker(docChecker);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.ready).toBe(true);
        expect(result.value.findings.medium).toBe(1);
        expect(result.value.findings.low).toBe(1);
        expect(result.value.findings.critical).toBe(0);
        expect(result.value.findings.high).toBe(0);
      }
    });

    it('should return not ready when documentation is incomplete', async () => {
      // Setup mocks - incomplete documentation
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
      ]);
      const evidenceManager = createMockEvidenceManager();
      const findingRegister = createMockFindingRegister();
      const docChecker = createMockDocumentationChecker(false, ['README.md', 'CHANGELOG.md']);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setEvidenceManager(evidenceManager);
      releaseManager.setFindingRegister(findingRegister);
      releaseManager.setDocumentationChecker(docChecker);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.ready).toBe(false);
        expect(result.value.documentation.complete).toBe(false);
        expect(result.value.documentation.missing_items).toContain('README.md');
      }
    });

    it('should update release status to READINESS_FAILED when not ready', async () => {
      // Setup mocks - failing task check
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'IN_PROGRESS' },
      ]);
      releaseManager.setTaskReader(taskReader);

      await releaseManager.checkReadiness(releaseId);

      // Get the release and verify status
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('READINESS_FAILED');
        expect(releaseResult.value.stages.readiness_check.status).toBe('FAILED');
      }
    });

    it('should update release status to READINESS_CHECK when ready', async () => {
      // Setup mocks - all pass
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
      ]);
      const evidenceManager = createMockEvidenceManager();
      const findingRegister = createMockFindingRegister();
      const docChecker = createMockDocumentationChecker(true);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setEvidenceManager(evidenceManager);
      releaseManager.setFindingRegister(findingRegister);
      releaseManager.setDocumentationChecker(docChecker);

      await releaseManager.checkReadiness(releaseId);

      // Get the release and verify status
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('READINESS_CHECK');
        expect(releaseResult.value.stages.readiness_check.status).toBe('COMPLETED');
      }
    });

    it('should fail for release not found', async () => {
      const result = await releaseManager.checkReadiness('nonexistent-release');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });

    it('should fail for release in wrong status', async () => {
      // Manually modify release to be in MONITORING status
      const releaseResult = await releaseManager.getRelease(releaseId);
      if (releaseResult.success) {
        const release = releaseResult.value;
        release.status = 'MONITORING';
        const filePath = path.join(tempDir, `${releaseId}.yaml`);
        await fs.writeFile(filePath, yaml.stringify(release), 'utf-8');
      }

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
      }
    });

    it('should generate recommendations for improvements', async () => {
      // Setup mocks - various issues
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
        { id: 'TASK-002', status: 'BLOCKED' },
      ]);
      const mediumFindings = [createMockFinding('FND-001', 'MEDIUM')];
      const findingRegister = createMockFindingRegister([], [], mediumFindings);

      releaseManager.setTaskReader(taskReader);
      releaseManager.setFindingRegister(findingRegister);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.recommendations.length).toBeGreaterThan(0);
        expect(result.value.recommendations.some(r => r.includes('blocked'))).toBe(true);
        expect(result.value.recommendations.some(r => r.includes('MEDIUM'))).toBe(true);
      }
    });

    it('should store readiness report to disk', async () => {
      const taskReader = createMockTaskReader([
        { id: 'TASK-001', status: 'DONE' },
      ]);
      releaseManager.setTaskReader(taskReader);

      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        const reportPath = path.join(tempDir, 'reports', `${result.value.report_id}.yaml`);
        const content = await fs.readFile(reportPath, 'utf-8');
        const savedReport = yaml.parse(content) as ReadinessReport;
        
        expect(savedReport.report_id).toBe(result.value.report_id);
        expect(savedReport.release_id).toBe(releaseId);
      }
    });

    it('should work without dependencies configured (skip checks)', async () => {
      // No dependencies set - should still work with warnings
      const result = await releaseManager.checkReadiness(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have recommendations about missing configurations
        expect(result.value.recommendations.length).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // getRelease Tests
  // ===========================================================================

  describe('getRelease', () => {
    it('should retrieve an existing release', async () => {
      const input: PlanReleaseInput = {
        version: '1.0.0',
        created_by: 'dev-001',
      };
      const created = await releaseManager.planRelease(input);
      
      if (created.success) {
        const result = await releaseManager.getRelease(created.value.release_id);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.version).toBe('1.0.0');
          expect(result.value.release_id).toBe(created.value.release_id);
        }
      }
    });

    it('should return error for non-existent release', async () => {
      const result = await releaseManager.getRelease('REL-nonexistent');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // getReleaseByVersion Tests
  // ===========================================================================

  describe('getReleaseByVersion', () => {
    it('should find release by version', async () => {
      const input: PlanReleaseInput = {
        version: '2.0.0',
        created_by: 'dev-001',
      };
      await releaseManager.planRelease(input);

      const result = await releaseManager.getReleaseByVersion('2.0.0');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).not.toBeNull();
        expect(result.value?.version).toBe('2.0.0');
      }
    });

    it('should return null for non-existent version', async () => {
      const result = await releaseManager.getReleaseByVersion('999.0.0');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeNull();
      }
    });
  });

  // ===========================================================================
  // listReleases Tests
  // ===========================================================================

  describe('listReleases', () => {
    beforeEach(async () => {
      // Create multiple releases
      await releaseManager.planRelease({ version: '1.0.0', created_by: 'dev-001' });
      await releaseManager.planRelease({ version: '1.1.0', created_by: 'dev-002' });
      await releaseManager.planRelease({ version: '2.0.0', created_by: 'dev-001' });
    });

    it('should list all releases', async () => {
      const result = await releaseManager.listReleases();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(3);
      }
    });

    it('should filter by status', async () => {
      const result = await releaseManager.listReleases({ status: 'PLANNING' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(3);
        expect(result.value.every(r => r.status === 'PLANNING')).toBe(true);
      }
    });

    it('should filter by creator', async () => {
      const result = await releaseManager.listReleases({ created_by: 'dev-001' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
        expect(result.value.every(r => r.created_by === 'dev-001')).toBe(true);
      }
    });

    it('should filter by version prefix', async () => {
      const result = await releaseManager.listReleases({ version_prefix: '1.' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
        expect(result.value.every(r => r.version.startsWith('1.'))).toBe(true);
      }
    });

    it('should apply limit', async () => {
      const result = await releaseManager.listReleases({ limit: 2 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
      }
    });

    it('should sort by version ascending', async () => {
      const result = await releaseManager.listReleases({ sort: 'version_asc' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value[0].version).toBe('1.0.0');
        expect(result.value[1].version).toBe('1.1.0');
        expect(result.value[2].version).toBe('2.0.0');
      }
    });
  });

  // ===========================================================================
  // getActiveRelease Tests
  // ===========================================================================

  describe('getActiveRelease', () => {
    it('should return active release', async () => {
      await releaseManager.planRelease({ version: '1.0.0', created_by: 'dev-001' });

      const result = await releaseManager.getActiveRelease();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).not.toBeNull();
        expect(result.value?.version).toBe('1.0.0');
      }
    });

    it('should return null when no active release', async () => {
      // Create and cancel a release
      const created = await releaseManager.planRelease({ version: '1.0.0', created_by: 'dev-001' });
      if (created.success) {
        await releaseManager.cancelRelease(created.value.release_id, 'Testing');
      }

      const result = await releaseManager.getActiveRelease();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeNull();
      }
    });
  });

  // ===========================================================================
  // cancelRelease Tests
  // ===========================================================================

  describe('cancelRelease', () => {
    it('should cancel a release in PLANNING status', async () => {
      const created = await releaseManager.planRelease({ version: '1.0.0', created_by: 'dev-001' });
      
      if (created.success) {
        const result = await releaseManager.cancelRelease(created.value.release_id, 'No longer needed');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.status).toBe('CANCELLED');
          expect(result.value.status_history[result.value.status_history.length - 1].to_status).toBe('CANCELLED');
          expect(result.value.status_history[result.value.status_history.length - 1].reason).toBe('No longer needed');
        }
      }
    });

    it('should fail to cancel already closed release', async () => {
      const created = await releaseManager.planRelease({ version: '1.0.0', created_by: 'dev-001' });
      
      if (created.success) {
        // Cancel it first
        await releaseManager.cancelRelease(created.value.release_id, 'First cancel');
        
        // Try to cancel again
        const result = await releaseManager.cancelRelease(created.value.release_id, 'Second cancel');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ReleaseErrorCode.ALREADY_CANCELLED);
        }
      }
    });

    it('should fail for non-existent release', async () => {
      const result = await releaseManager.cancelRelease('REL-nonexistent', 'Testing');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });
  });
});

describe('createFileReleaseManager', () => {
  it('should create instance with default config', () => {
    const manager = createFileReleaseManager();
    expect(manager).toBeInstanceOf(FileReleaseManager);
  });

  it('should create instance with custom storage path', async () => {
    const tempDir = await createTempDir();
    try {
      const manager = createFileReleaseManager({ storagePath: tempDir });
      
      // Verify by creating a release and checking it's stored in custom path
      const result = await manager.planRelease({ version: '1.0.0', created_by: 'test' });
      expect(result.success).toBe(true);
      
      if (result.success) {
        const files = await fs.readdir(tempDir);
        expect(files.some(f => f.includes(result.value.release_id))).toBe(true);
      }
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});

// =============================================================================
// Staging Deployment Tests (R15.4)
// =============================================================================

describe('FileReleaseManager - Staging Deployment', () => {
  let tempDir: string;
  let releaseManager: FileReleaseManager;
  let releaseId: string;

  /**
   * Creates a mock smoke test runner.
   */
  function createMockSmokeTestRunner(passed: boolean = true, error?: string) {
    return {
      runSmokeTests: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Creates a mock health check runner.
   */
  function createMockHealthCheckRunner(passed: boolean = true, error?: string) {
    return {
      runHealthChecks: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Creates a mock artifact builder.
   */
  function createMockArtifactBuilder(success: boolean = true, error?: string) {
    return {
      buildArtifact: vi.fn().mockResolvedValue({
        success,
        artifact: success ? {
          artifact_id: 'ART-001',
          type: 'docker-image',
          version: '1.0.0',
          git_tag: 'v1.0.0',
          commit_sha: 'abc123def456',
          location: 'registry.example.com/app:1.0.0',
          checksum: 'sha256:abc123',
          checksum_algorithm: 'sha256',
          built_at: new Date().toISOString(),
          metadata: {},
        } : undefined,
        error,
      }),
    };
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    releaseManager = createFileReleaseManager({ storagePath: tempDir });

    // Create and prepare a release for staging
    const input: PlanReleaseInput = {
      version: '1.0.0',
      created_by: 'dev-001',
      release_notes: 'Test release notes',
    };
    const planResult = await releaseManager.planRelease(input);
    if (planResult.success) {
      releaseId = planResult.value.release_id;
    }

    // Set up mocks for readiness check
    const taskReader = createMockTaskReader([
      { id: 'TASK-001', status: 'DONE' },
    ]);
    const evidenceManager = createMockEvidenceManager();
    const findingRegister = createMockFindingRegister();
    const docChecker = createMockDocumentationChecker(true);

    releaseManager.setTaskReader(taskReader);
    releaseManager.setEvidenceManager(evidenceManager);
    releaseManager.setFindingRegister(findingRegister);
    releaseManager.setDocumentationChecker(docChecker);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('deployToStaging', () => {
    it('should fail if readiness check has not been run', async () => {
      // Try to deploy without running readiness check
      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('readiness check');
      }
    });

    it('should deploy successfully when all checks pass', async () => {
      // Run readiness check first
      await releaseManager.checkReadiness(releaseId);

      // Set up staging mocks
      const smokeTestRunner = createMockSmokeTestRunner(true);
      const healthCheckRunner = createMockHealthCheckRunner(true);
      releaseManager.setSmokeTestRunner(smokeTestRunner);
      releaseManager.setHealthCheckRunner(healthCheckRunner);

      // Deploy to staging
      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(true);
        expect(result.value.status).toBe('COMPLETED');
        expect(result.value.environment).toBe('staging');
        expect(result.value.health_check_passed).toBe(true);
        expect(result.value.smoke_test_passed).toBe(true);
        expect(result.value.error_message).toBeNull();
        expect(result.value.artifact).not.toBeNull();
        expect(result.value.evidence_id).toMatch(/^EVD-STAGING-/);
      }

      // Verify smoke tests and health checks were called
      expect(smokeTestRunner.runSmokeTests).toHaveBeenCalledWith('staging');
      expect(healthCheckRunner.runHealthChecks).toHaveBeenCalledWith('staging');
    });

    it('should update release status to STAGING during deployment', async () => {
      // Run readiness check first
      await releaseManager.checkReadiness(releaseId);

      // Deploy to staging
      await releaseManager.deployToStaging(releaseId);

      // Get the release and verify staging stage is updated
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.stages.staging.status).toBe('COMPLETED');
        expect(releaseResult.value.stages.staging.deployed_at).not.toBeNull();
        expect(releaseResult.value.stages.staging.health_checks_passed).toBe(true);
        expect(releaseResult.value.stages.staging.smoke_tests_passed).toBe(true);
        expect(releaseResult.value.artifact).not.toBeNull();
      }
    });

    it('should fail deployment when health checks fail', async () => {
      // Run readiness check first
      await releaseManager.checkReadiness(releaseId);

      // Set up failing health check
      const healthCheckRunner = createMockHealthCheckRunner(false, 'Service unavailable');
      releaseManager.setHealthCheckRunner(healthCheckRunner);

      // Deploy to staging
      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(false);
        expect(result.value.status).toBe('FAILED');
        expect(result.value.health_check_passed).toBe(false);
        expect(result.value.error_message).toBe('Service unavailable');
      }

      // Verify release status is STAGING_FAILED
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('STAGING_FAILED');
      }
    });

    it('should fail deployment when smoke tests fail', async () => {
      // Run readiness check first
      await releaseManager.checkReadiness(releaseId);

      // Set up passing health check but failing smoke test
      const healthCheckRunner = createMockHealthCheckRunner(true);
      const smokeTestRunner = createMockSmokeTestRunner(false, 'Login flow failed');
      releaseManager.setHealthCheckRunner(healthCheckRunner);
      releaseManager.setSmokeTestRunner(smokeTestRunner);

      // Deploy to staging
      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(false);
        expect(result.value.status).toBe('FAILED');
        expect(result.value.health_check_passed).toBe(true);
        expect(result.value.smoke_test_passed).toBe(false);
        expect(result.value.error_message).toBe('Login flow failed');
      }
    });

    it('should use custom artifact builder when provided', async () => {
      // Run readiness check first
      await releaseManager.checkReadiness(releaseId);

      // Set up custom artifact builder
      const artifactBuilder = createMockArtifactBuilder(true);
      releaseManager.setArtifactBuilder(artifactBuilder);

      // Deploy to staging
      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.artifact?.artifact_id).toBe('ART-001');
        expect(result.value.artifact?.type).toBe('docker-image');
      }

      // Verify artifact builder was called
      expect(artifactBuilder.buildArtifact).toHaveBeenCalled();
    });

    it('should fail if artifact build fails', async () => {
      // Run readiness check first
      await releaseManager.checkReadiness(releaseId);

      // Set up failing artifact builder
      const artifactBuilder = createMockArtifactBuilder(false, 'Build failed: missing dependencies');
      releaseManager.setArtifactBuilder(artifactBuilder);

      // Deploy to staging
      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.STAGING_DEPLOY_FAILED);
        expect(result.error.message).toContain('Artifact build failed');
      }
    });

    it('should fail for release not found', async () => {
      const result = await releaseManager.deployToStaging('REL-nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });

    it('should fail for release in wrong status', async () => {
      // Manually set release to MONITORING status (which is not valid for staging)
      const releaseResult = await releaseManager.getRelease(releaseId);
      if (releaseResult.success) {
        const release = releaseResult.value;
        release.status = 'MONITORING';
        const filePath = path.join(tempDir, `${releaseId}.yaml`);
        await fs.writeFile(filePath, yaml.stringify(release), 'utf-8');
      }

      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
      }
    });

    it('should allow retry after STAGING_FAILED status', async () => {
      // Run readiness check first
      await releaseManager.checkReadiness(releaseId);

      // First deployment fails
      const healthCheckRunner = createMockHealthCheckRunner(false, 'Service down');
      releaseManager.setHealthCheckRunner(healthCheckRunner);
      await releaseManager.deployToStaging(releaseId);

      // Fix the issue and retry
      const fixedHealthCheckRunner = createMockHealthCheckRunner(true);
      releaseManager.setHealthCheckRunner(fixedHealthCheckRunner);

      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(true);
        expect(result.value.status).toBe('COMPLETED');
      }
    });

    it('should record duration of deployment', async () => {
      // Run readiness check first
      await releaseManager.checkReadiness(releaseId);

      // Deploy to staging
      const result = await releaseManager.deployToStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.duration_ms).toBeGreaterThanOrEqual(0);
        expect(result.value.started_at).not.toBeNull();
        expect(result.value.completed_at).not.toBeNull();
      }
    });

    it('should use configured staging environment', async () => {
      // Create release with custom staging environment
      const customRelease = await releaseManager.planRelease({
        version: '2.0.0',
        created_by: 'dev-001',
        release_notes: 'Test',
        config: {
          staging_environment: 'staging-us-west',
        },
      });

      if (customRelease.success) {
        // Run readiness check
        await releaseManager.checkReadiness(customRelease.value.release_id);

        // Deploy to staging
        const result = await releaseManager.deployToStaging(customRelease.value.release_id);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.environment).toBe('staging-us-west');
        }
      }
    });
  });

  describe('verifyStaging', () => {
    it('should verify staging successfully when all checks pass', async () => {
      // Run readiness check and deploy to staging first
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);

      // Set up verification mocks
      const smokeTestRunner = createMockSmokeTestRunner(true);
      const healthCheckRunner = createMockHealthCheckRunner(true);
      releaseManager.setSmokeTestRunner(smokeTestRunner);
      releaseManager.setHealthCheckRunner(healthCheckRunner);

      // Verify staging
      const result = await releaseManager.verifyStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(true);
        expect(result.value.environment).toBe('staging');
        expect(result.value.passed_checks).toContain('health_check');
        expect(result.value.passed_checks).toContain('smoke_test');
        expect(result.value.failed_checks).toHaveLength(0);
        expect(result.value.error_message).toBeNull();
      }
    });

    it('should transition to AWAITING_APPROVAL on successful verification', async () => {
      // Run readiness check and deploy to staging first
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);

      // Verify staging
      await releaseManager.verifyStaging(releaseId);

      // Check release status
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('AWAITING_APPROVAL');
        expect(releaseResult.value.stages.staging.verified_at).not.toBeNull();
        expect(releaseResult.value.stages.staging.verify_evidence_id).toMatch(/^EVD-VERIFY-/);
      }
    });

    it('should fail verification when health checks fail', async () => {
      // Run readiness check and deploy to staging first
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);

      // Set up failing health check for verification
      const healthCheckRunner = createMockHealthCheckRunner(false, 'Database connection lost');
      releaseManager.setHealthCheckRunner(healthCheckRunner);

      // Verify staging
      const result = await releaseManager.verifyStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(false);
        expect(result.value.failed_checks).toContain('health_check');
        expect(result.value.error_message).toBe('Database connection lost');
      }

      // Check release status is STAGING_FAILED
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('STAGING_FAILED');
      }
    });

    it('should fail verification when smoke tests fail', async () => {
      // Run readiness check and deploy to staging first
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);

      // Set up passing health check but failing smoke test
      const healthCheckRunner = createMockHealthCheckRunner(true);
      const smokeTestRunner = createMockSmokeTestRunner(false, 'Checkout flow broken');
      releaseManager.setHealthCheckRunner(healthCheckRunner);
      releaseManager.setSmokeTestRunner(smokeTestRunner);

      // Verify staging
      const result = await releaseManager.verifyStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(false);
        expect(result.value.passed_checks).toContain('health_check');
        expect(result.value.failed_checks).toContain('smoke_test');
      }
    });

    it('should fail if staging deployment not completed', async () => {
      // Run readiness check but don't deploy
      await releaseManager.checkReadiness(releaseId);

      // Try to verify staging without deploying first
      const result = await releaseManager.verifyStaging(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('STAGING status');
      }
    });

    it('should fail for release not found', async () => {
      const result = await releaseManager.verifyStaging('REL-nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });

    it('should record verification checks with duration', async () => {
      // Run readiness check and deploy to staging first
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);

      // Verify staging
      const result = await releaseManager.verifyStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.checks.length).toBeGreaterThan(0);
        for (const check of result.value.checks) {
          expect(check.type).toBeDefined();
          expect(check.passed).toBeDefined();
          expect(check.duration_ms).toBeGreaterThanOrEqual(0);
        }
        expect(result.value.duration_ms).toBeGreaterThanOrEqual(0);
      }
    });

    it('should skip smoke tests if health checks fail', async () => {
      // Run readiness check and deploy to staging first
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);

      // Set up failing health check
      const healthCheckRunner = createMockHealthCheckRunner(false, 'Server down');
      const smokeTestRunner = createMockSmokeTestRunner(true);
      releaseManager.setHealthCheckRunner(healthCheckRunner);
      releaseManager.setSmokeTestRunner(smokeTestRunner);

      // Verify staging
      const result = await releaseManager.verifyStaging(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.passed).toBe(false);
        // Smoke test should not have been called since health check failed
        expect(smokeTestRunner.runSmokeTests).not.toHaveBeenCalled();
      }
    });
  });
});

// =============================================================================
// Production Approval Gate Tests (R15.5)
// =============================================================================

describe('FileReleaseManager - Production Approval Gate', () => {
  let tempDir: string;
  let releaseManager: FileReleaseManager;
  let releaseId: string;

  /**
   * Creates a mock smoke test runner.
   */
  function createMockSmokeTestRunner(passed: boolean = true, error?: string) {
    return {
      runSmokeTests: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Creates a mock health check runner.
   */
  function createMockHealthCheckRunner(passed: boolean = true, error?: string) {
    return {
      runHealthChecks: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Helper to prepare a release through staging verification to AWAITING_APPROVAL status.
   */
  async function prepareReleaseForApproval(): Promise<void> {
    // Run readiness check
    await releaseManager.checkReadiness(releaseId);
    
    // Deploy to staging
    await releaseManager.deployToStaging(releaseId);
    
    // Verify staging (this transitions to AWAITING_APPROVAL)
    await releaseManager.verifyStaging(releaseId);
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    releaseManager = createFileReleaseManager({ storagePath: tempDir });

    // Create and prepare a release
    const input: PlanReleaseInput = {
      version: '1.0.0',
      created_by: 'dev-001',
      release_notes: 'Test release notes',
    };
    const planResult = await releaseManager.planRelease(input);
    if (planResult.success) {
      releaseId = planResult.value.release_id;
    }

    // Set up mocks for readiness check
    const taskReader = createMockTaskReader([
      { id: 'TASK-001', status: 'DONE' },
    ]);
    const evidenceManager = createMockEvidenceManager();
    const findingRegister = createMockFindingRegister();
    const docChecker = createMockDocumentationChecker(true);

    releaseManager.setTaskReader(taskReader);
    releaseManager.setEvidenceManager(evidenceManager);
    releaseManager.setFindingRegister(findingRegister);
    releaseManager.setDocumentationChecker(docChecker);

    // Set up staging mocks
    const smokeTestRunner = createMockSmokeTestRunner(true);
    const healthCheckRunner = createMockHealthCheckRunner(true);
    releaseManager.setSmokeTestRunner(smokeTestRunner);
    releaseManager.setHealthCheckRunner(healthCheckRunner);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // ===========================================================================
  // requestProductionApproval Tests
  // ===========================================================================

  describe('requestProductionApproval', () => {
    it('should create approval request when release is in AWAITING_APPROVAL status', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Request production approval
      const result = await releaseManager.requestProductionApproval(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.request_id).toMatch(/^AR-/);
        expect(result.value.release_id).toBe(releaseId);
        expect(result.value.status).toBe('PENDING');
        expect(result.value.requested_at).toBeDefined();
        expect(result.value.required_capability).toBe('APPROVE_GATE');
        expect(result.value.expires_at).toBeDefined();
      }
    });

    it('should fail if release is not in AWAITING_APPROVAL status', async () => {
      // Release is in PLANNING status (not ready for approval)
      const result = await releaseManager.requestProductionApproval(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('AWAITING_APPROVAL');
      }
    });

    it('should fail if staging verification not completed', async () => {
      // Run readiness and deploy to staging, but don't verify
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);

      // Manually set status to AWAITING_APPROVAL but without verification
      const releaseResult = await releaseManager.getRelease(releaseId);
      if (releaseResult.success) {
        const release = releaseResult.value;
        release.status = 'AWAITING_APPROVAL';
        release.stages.staging.verified_at = null; // No verification
        const filePath = path.join(tempDir, `${releaseId}.yaml`);
        await fs.writeFile(filePath, yaml.stringify(release), 'utf-8');
      }

      const result = await releaseManager.requestProductionApproval(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('Staging verification');
      }
    });

    it('should fail for release not found', async () => {
      const result = await releaseManager.requestProductionApproval('REL-nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });

    it('should include staging verification evidence in approval request', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Request production approval
      const result = await releaseManager.requestProductionApproval(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.staging_evidence_id).toMatch(/^EVD-VERIFY-/);
      }
    });

    it('should set expiration time for approval request', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      const beforeRequest = new Date();
      
      // Request production approval
      const result = await releaseManager.requestProductionApproval(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.expires_at).toBeDefined();
        const expiresAt = new Date(result.value.expires_at!);
        // Should be approximately 24 hours in the future
        const hoursDiff = (expiresAt.getTime() - beforeRequest.getTime()) / (1000 * 60 * 60);
        expect(hoursDiff).toBeGreaterThanOrEqual(23.9);
        expect(hoursDiff).toBeLessThanOrEqual(24.1);
      }
    });
  });

  // ===========================================================================
  // recordApproval Tests - Approval
  // ===========================================================================

  describe('recordApproval - Approval', () => {
    it('should record approval with timestamp and approver ID', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Record approval
      const result = await releaseManager.recordApproval(
        releaseId,
        'lead-001',
        true,
        'Approved for production release'
      );

      expect(result.success).toBe(true);

      // Verify release was updated
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.stages.production.approved_by).toBe('lead-001');
        expect(releaseResult.value.stages.production.approved_at).toBeDefined();
        expect(releaseResult.value.stages.production.approval_notes).toBe('Approved for production release');
      }
    });

    it('should keep release in AWAITING_APPROVAL status after approval (until production deploy)', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Record approval
      await releaseManager.recordApproval(releaseId, 'lead-001', true);

      // Verify release status - should still be AWAITING_APPROVAL but with approval recorded
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('AWAITING_APPROVAL');
        expect(releaseResult.value.stages.production.approved_by).toBe('lead-001');
        expect(releaseResult.value.stages.production.approved_at).not.toBeNull();
      }
    });

    it('should record approval in status history', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Record approval
      await releaseManager.recordApproval(releaseId, 'lead-001', true, 'LGTM');

      // Verify status history
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        const lastTransition = releaseResult.value.status_history[releaseResult.value.status_history.length - 1];
        expect(lastTransition.actor_id).toBe('lead-001');
        expect(lastTransition.reason).toContain('Production approved');
        expect(lastTransition.reason).toContain('LGTM');
      }
    });

    it('should fail if release is not in AWAITING_APPROVAL status', async () => {
      // Release is in PLANNING status (not ready for approval)
      const result = await releaseManager.recordApproval(releaseId, 'lead-001', true);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('AWAITING_APPROVAL');
      }
    });

    it('should fail with empty approver ID', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Try to approve with empty approver ID
      const result = await releaseManager.recordApproval(releaseId, '', true);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.APPROVAL_REQUIRED);
        expect(result.error.message).toContain('Approver ID');
      }
    });

    it('should fail for release not found', async () => {
      const result = await releaseManager.recordApproval('REL-nonexistent', 'lead-001', true);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // recordApproval Tests - Rejection
  // ===========================================================================

  describe('recordApproval - Rejection', () => {
    it('should record rejection with timestamp, rejector ID, and reason', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Record rejection
      const result = await releaseManager.recordApproval(
        releaseId,
        'lead-001',
        false,
        'Security review pending'
      );

      expect(result.success).toBe(true);

      // Verify release was updated
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        // On rejection, approval fields should be cleared
        expect(releaseResult.value.stages.production.approved_by).toBeNull();
        expect(releaseResult.value.stages.production.approved_at).toBeNull();
        expect(releaseResult.value.stages.production.approval_notes).toBe('Security review pending');
      }
    });

    it('should transition release to STAGING status on rejection (for retry)', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Record rejection
      await releaseManager.recordApproval(
        releaseId,
        'lead-001',
        false,
        'Needs more testing'
      );

      // Verify release status - should be back to STAGING for retry
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('STAGING');
        // Staging should be reset for retry
        expect(releaseResult.value.stages.staging.status).toBe('NOT_STARTED');
        expect(releaseResult.value.stages.staging.verified_at).toBeNull();
      }
    });

    it('should record rejection in status history', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Record rejection
      await releaseManager.recordApproval(
        releaseId,
        'lead-001',
        false,
        'Performance regression detected'
      );

      // Verify status history
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        const lastTransition = releaseResult.value.status_history[releaseResult.value.status_history.length - 1];
        expect(lastTransition.from_status).toBe('AWAITING_APPROVAL');
        expect(lastTransition.to_status).toBe('STAGING');
        expect(lastTransition.actor_id).toBe('lead-001');
        expect(lastTransition.reason).toContain('denied');
        expect(lastTransition.reason).toContain('Performance regression');
      }
    });

    it('should allow re-submission after rejection', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Record rejection
      await releaseManager.recordApproval(releaseId, 'lead-001', false, 'Needs fixes');

      // Re-deploy to staging and verify again
      await releaseManager.deployToStaging(releaseId);
      await releaseManager.verifyStaging(releaseId);

      // Verify release is back in AWAITING_APPROVAL
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('AWAITING_APPROVAL');
      }

      // Now approve
      const approvalResult = await releaseManager.recordApproval(releaseId, 'lead-002', true, 'Approved on retry');
      expect(approvalResult.success).toBe(true);

      // Verify approval recorded
      const finalReleaseResult = await releaseManager.getRelease(releaseId);
      if (finalReleaseResult.success) {
        expect(finalReleaseResult.value.stages.production.approved_by).toBe('lead-002');
      }
    });

    it('should record default rejection note when none provided', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Record rejection without notes
      await releaseManager.recordApproval(releaseId, 'lead-001', false);

      // Verify default note
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.stages.production.approval_notes).toBe('Approval denied');
      }
    });
  });

  // ===========================================================================
  // Approval Workflow Integration Tests
  // ===========================================================================

  describe('Approval Workflow Integration', () => {
    it('should support full approval workflow: request -> approve', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Step 1: Request approval
      const requestResult = await releaseManager.requestProductionApproval(releaseId);
      expect(requestResult.success).toBe(true);

      // Step 2: Record approval
      const approvalResult = await releaseManager.recordApproval(
        releaseId,
        'lead-001',
        true,
        'All checks passed'
      );
      expect(approvalResult.success).toBe(true);

      // Verify final state
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('AWAITING_APPROVAL');
        expect(releaseResult.value.stages.production.approved_by).toBe('lead-001');
        expect(releaseResult.value.stages.production.approved_at).not.toBeNull();
        expect(releaseResult.value.stages.production.approval_notes).toBe('All checks passed');
      }
    });

    it('should support full rejection workflow: request -> reject -> fix -> request -> approve', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // Step 1: Request approval
      const requestResult1 = await releaseManager.requestProductionApproval(releaseId);
      expect(requestResult1.success).toBe(true);

      // Step 2: Reject
      const rejectResult = await releaseManager.recordApproval(
        releaseId,
        'lead-001',
        false,
        'Found critical bug'
      );
      expect(rejectResult.success).toBe(true);

      // Step 3: Fix and re-deploy to staging
      await releaseManager.deployToStaging(releaseId);
      await releaseManager.verifyStaging(releaseId);

      // Step 4: Request approval again
      const requestResult2 = await releaseManager.requestProductionApproval(releaseId);
      expect(requestResult2.success).toBe(true);

      // Step 5: Approve
      const approvalResult = await releaseManager.recordApproval(
        releaseId,
        'lead-002',
        true,
        'Bug fixed and verified'
      );
      expect(approvalResult.success).toBe(true);

      // Verify final state and history
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('AWAITING_APPROVAL');
        expect(releaseResult.value.stages.production.approved_by).toBe('lead-002');
        
        // Should have multiple transitions in history
        expect(releaseResult.value.status_history.length).toBeGreaterThan(5);
      }
    });

    it('should allow multiple rejections before final approval', async () => {
      // Prepare release through staging
      await prepareReleaseForApproval();

      // First rejection
      await releaseManager.recordApproval(releaseId, 'lead-001', false, 'Issue 1');
      
      // Re-deploy and verify
      await releaseManager.deployToStaging(releaseId);
      await releaseManager.verifyStaging(releaseId);

      // Second rejection
      await releaseManager.recordApproval(releaseId, 'lead-001', false, 'Issue 2');
      
      // Re-deploy and verify again
      await releaseManager.deployToStaging(releaseId);
      await releaseManager.verifyStaging(releaseId);

      // Final approval
      const approvalResult = await releaseManager.recordApproval(
        releaseId,
        'lead-001',
        true,
        'All issues resolved'
      );
      expect(approvalResult.success).toBe(true);

      // Verify approved
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.stages.production.approved_by).toBe('lead-001');
        expect(releaseResult.value.stages.production.approval_notes).toBe('All issues resolved');
      }
    });
  });
});

// =============================================================================
// Production Deployment Tests (R15.6, R15.7)
// =============================================================================

describe('FileReleaseManager - Production Deployment', () => {
  let tempDir: string;
  let releaseManager: FileReleaseManager;
  let releaseId: string;

  /**
   * Creates a mock smoke test runner.
   */
  function createMockSmokeTestRunner(passed: boolean = true, error?: string) {
    return {
      runSmokeTests: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Creates a mock health check runner.
   */
  function createMockHealthCheckRunner(passed: boolean = true, error?: string) {
    return {
      runHealthChecks: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Helper to prepare a release through staging and approval.
   */
  async function prepareReleaseForProduction(): Promise<void> {
    // Run readiness check
    await releaseManager.checkReadiness(releaseId);
    
    // Deploy to staging
    await releaseManager.deployToStaging(releaseId);
    
    // Verify staging (transitions to AWAITING_APPROVAL)
    await releaseManager.verifyStaging(releaseId);

    // Record approval (enables production deployment)
    await releaseManager.recordApproval(releaseId, 'lead-001', true, 'Approved');
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    releaseManager = createFileReleaseManager({ storagePath: tempDir });

    // Create and prepare a release
    const input: PlanReleaseInput = {
      version: '1.0.0',
      created_by: 'dev-001',
      release_notes: 'Test release notes',
      previous_version: '0.9.0', // Set previous version for rollback
    };
    const planResult = await releaseManager.planRelease(input);
    if (planResult.success) {
      releaseId = planResult.value.release_id;
    }

    // Set up mocks for readiness check
    const taskReader = createMockTaskReader([
      { id: 'TASK-001', status: 'DONE' },
    ]);
    const evidenceManager = createMockEvidenceManager();
    const findingRegister = createMockFindingRegister();
    const docChecker = createMockDocumentationChecker(true);

    releaseManager.setTaskReader(taskReader);
    releaseManager.setEvidenceManager(evidenceManager);
    releaseManager.setFindingRegister(findingRegister);
    releaseManager.setDocumentationChecker(docChecker);

    // Set up staging mocks (all pass)
    const stagingSmokeTestRunner = createMockSmokeTestRunner(true);
    const stagingHealthCheckRunner = createMockHealthCheckRunner(true);
    releaseManager.setSmokeTestRunner(stagingSmokeTestRunner);
    releaseManager.setHealthCheckRunner(stagingHealthCheckRunner);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // ===========================================================================
  // deployToProduction Tests
  // ===========================================================================

  describe('deployToProduction', () => {
    it('should deploy to production successfully when approval is granted and all checks pass', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Set up production mocks
      const productionSmokeTestRunner = createMockSmokeTestRunner(true);
      const productionHealthCheckRunner = createMockHealthCheckRunner(true);
      releaseManager.setProductionSmokeTestRunner(productionSmokeTestRunner);
      releaseManager.setProductionHealthCheckRunner(productionHealthCheckRunner);

      // Deploy to production
      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(true);
        expect(result.value.status).toBe('COMPLETED');
        expect(result.value.environment).toBe('production');
        expect(result.value.health_check_passed).toBe(true);
        expect(result.value.smoke_test_passed).toBe(true);
        expect(result.value.error_message).toBeNull();
        expect(result.value.evidence_id).toMatch(/^EVD-PRODUCTION-/);
      }

      // Verify production runners were called
      expect(productionSmokeTestRunner.runSmokeTests).toHaveBeenCalledWith('production');
      expect(productionHealthCheckRunner.runHealthChecks).toHaveBeenCalledWith('production');
    });

    it('should use the same artifact from staging (no rebuild)', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Get staging artifact for comparison
      const preDeployResult = await releaseManager.getRelease(releaseId);
      let stagingArtifact = null;
      if (preDeployResult.success) {
        stagingArtifact = preDeployResult.value.artifact;
      }

      // Deploy to production
      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should use the same artifact from staging
        expect(result.value.artifact).toBeDefined();
        expect(result.value.artifact?.artifact_id).toBe(stagingArtifact?.artifact_id);
        expect(result.value.artifact?.version).toBe(stagingArtifact?.version);
        expect(result.value.artifact?.commit_sha).toBe(stagingArtifact?.commit_sha);
      }
    });

    it('should transition to MONITORING status on successful deployment', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Deploy to production
      await releaseManager.deployToProduction(releaseId);

      // Check release status
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('MONITORING');
        expect(releaseResult.value.stages.production.status).toBe('COMPLETED');
        expect(releaseResult.value.stages.production.deployed_at).not.toBeNull();
        expect(releaseResult.value.stages.production.verified_at).not.toBeNull();
        expect(releaseResult.value.stages.production.monitoring_ends_at).not.toBeNull();
      }
    });

    it('should track monitoring period end time', async () => {
      // Create release with custom monitoring period
      const customRelease = await releaseManager.planRelease({
        version: '2.0.0',
        created_by: 'dev-001',
        release_notes: 'Test',
        config: {
          monitoring_period_minutes: 60, // 60 minutes
        },
      });

      if (customRelease.success) {
        const customReleaseId = customRelease.value.release_id;

        // Prepare and approve
        await releaseManager.checkReadiness(customReleaseId);
        await releaseManager.deployToStaging(customReleaseId);
        await releaseManager.verifyStaging(customReleaseId);
        await releaseManager.recordApproval(customReleaseId, 'lead-001', true);

        const beforeDeploy = Date.now();

        // Deploy to production
        await releaseManager.deployToProduction(customReleaseId);

        // Verify monitoring end time
        const releaseResult = await releaseManager.getRelease(customReleaseId);
        expect(releaseResult.success).toBe(true);
        if (releaseResult.success) {
          const monitoringEndsAt = new Date(releaseResult.value.stages.production.monitoring_ends_at!);
          const expectedEndTime = beforeDeploy + 60 * 60 * 1000; // 60 minutes from now
          
          // Should be approximately 60 minutes in the future (allow small margin)
          expect(monitoringEndsAt.getTime()).toBeGreaterThanOrEqual(expectedEndTime - 5000);
          expect(monitoringEndsAt.getTime()).toBeLessThanOrEqual(expectedEndTime + 5000);
        }
      }
    });

    it('should enable rollback when previous_version is set', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Deploy to production
      await releaseManager.deployToProduction(releaseId);

      // Verify rollback is available
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.rollback_available).toBe(true);
        expect(releaseResult.value.previous_version).toBe('0.9.0');
      }
    });

    it('should fail if approval has not been granted', async () => {
      // Prepare release through staging but skip approval
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);
      await releaseManager.verifyStaging(releaseId);
      // Don't record approval

      // Try to deploy to production
      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.APPROVAL_REQUIRED);
        expect(result.error.message).toContain('approval required');
      }
    });

    it('should fail if release is not in AWAITING_APPROVAL status', async () => {
      // Release is in PLANNING status
      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('AWAITING_APPROVAL');
      }
    });

    it('should fail if staging was not completed', async () => {
      // Set release to AWAITING_APPROVAL manually without staging
      const releaseResult = await releaseManager.getRelease(releaseId);
      if (releaseResult.success) {
        const release = releaseResult.value;
        release.status = 'AWAITING_APPROVAL';
        release.stages.production.approved_by = 'lead-001';
        release.stages.staging.status = 'NOT_STARTED'; // Staging not done
        release.artifact = null; // No artifact
        const filePath = path.join(tempDir, `${releaseId}.yaml`);
        await fs.writeFile(filePath, yaml.stringify(release), 'utf-8');
      }

      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('Staging deployment');
      }
    });

    it('should transition to PRODUCTION_FAILED when health checks fail', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Set up failing production health check
      const productionHealthCheckRunner = createMockHealthCheckRunner(false, 'Production database unavailable');
      releaseManager.setProductionHealthCheckRunner(productionHealthCheckRunner);

      // Deploy to production
      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(false);
        expect(result.value.status).toBe('FAILED');
        expect(result.value.health_check_passed).toBe(false);
        expect(result.value.error_message).toBe('Production database unavailable');
      }

      // Verify release status is PRODUCTION_FAILED
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('PRODUCTION_FAILED');
        expect(releaseResult.value.stages.production.status).toBe('FAILED');
        expect(releaseResult.value.rollback_available).toBe(true); // Should enable rollback
      }
    });

    it('should transition to PRODUCTION_FAILED when smoke tests fail', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Set up passing health check but failing smoke test
      const productionHealthCheckRunner = createMockHealthCheckRunner(true);
      const productionSmokeTestRunner = createMockSmokeTestRunner(false, 'Production checkout flow broken');
      releaseManager.setProductionHealthCheckRunner(productionHealthCheckRunner);
      releaseManager.setProductionSmokeTestRunner(productionSmokeTestRunner);

      // Deploy to production
      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(false);
        expect(result.value.health_check_passed).toBe(true);
        expect(result.value.smoke_test_passed).toBe(false);
        expect(result.value.error_message).toBe('Production checkout flow broken');
      }

      // Verify release status is PRODUCTION_FAILED
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('PRODUCTION_FAILED');
      }
    });

    it('should use configured production environment', async () => {
      // Create release with custom production environment
      const customRelease = await releaseManager.planRelease({
        version: '2.0.0',
        created_by: 'dev-001',
        release_notes: 'Test',
        config: {
          production_environment: 'production-us-west-2',
        },
      });

      if (customRelease.success) {
        const customReleaseId = customRelease.value.release_id;

        // Prepare and approve
        await releaseManager.checkReadiness(customReleaseId);
        await releaseManager.deployToStaging(customReleaseId);
        await releaseManager.verifyStaging(customReleaseId);
        await releaseManager.recordApproval(customReleaseId, 'lead-001', true);

        // Set up production mocks
        const productionSmokeTestRunner = createMockSmokeTestRunner(true);
        releaseManager.setProductionSmokeTestRunner(productionSmokeTestRunner);

        // Deploy to production
        const result = await releaseManager.deployToProduction(customReleaseId);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.environment).toBe('production-us-west-2');
        }

        // Verify production runner was called with correct environment
        expect(productionSmokeTestRunner.runSmokeTests).toHaveBeenCalledWith('production-us-west-2');
      }
    });

    it('should fall back to staging runners if production runners not set', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Reset production runners (leave staging runners)
      const stagingSmokeTestRunner = createMockSmokeTestRunner(true);
      const stagingHealthCheckRunner = createMockHealthCheckRunner(true);
      releaseManager.setSmokeTestRunner(stagingSmokeTestRunner);
      releaseManager.setHealthCheckRunner(stagingHealthCheckRunner);

      // Deploy to production (should use staging runners)
      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(true);
      }

      // Verify staging runners were called
      expect(stagingSmokeTestRunner.runSmokeTests).toHaveBeenCalledWith('production');
      expect(stagingHealthCheckRunner.runHealthChecks).toHaveBeenCalledWith('production');
    });

    it('should fail for release not found', async () => {
      const result = await releaseManager.deployToProduction('REL-nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });

    it('should record deployment duration', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Deploy to production
      const result = await releaseManager.deployToProduction(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.duration_ms).toBeGreaterThanOrEqual(0);
        expect(result.value.started_at).toBeDefined();
        expect(result.value.completed_at).toBeDefined();
      }
    });

    it('should record deployment in status history', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Deploy to production
      await releaseManager.deployToProduction(releaseId);

      // Verify status history
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        const history = releaseResult.value.status_history;
        
        // Should have PRODUCTION transition
        const productionTransition = history.find(h => h.to_status === 'PRODUCTION');
        expect(productionTransition).toBeDefined();
        expect(productionTransition?.from_status).toBe('AWAITING_APPROVAL');

        // Should have MONITORING transition
        const monitoringTransition = history.find(h => h.to_status === 'MONITORING');
        expect(monitoringTransition).toBeDefined();
        expect(monitoringTransition?.from_status).toBe('PRODUCTION');
      }
    });

    it('should not skip smoke tests even if health checks pass', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Set up both runners
      const productionSmokeTestRunner = createMockSmokeTestRunner(true);
      const productionHealthCheckRunner = createMockHealthCheckRunner(true);
      releaseManager.setProductionSmokeTestRunner(productionSmokeTestRunner);
      releaseManager.setProductionHealthCheckRunner(productionHealthCheckRunner);

      // Deploy to production
      await releaseManager.deployToProduction(releaseId);

      // Verify both runners were called
      expect(productionHealthCheckRunner.runHealthChecks).toHaveBeenCalled();
      expect(productionSmokeTestRunner.runSmokeTests).toHaveBeenCalled();
    });

    it('should skip smoke tests if health checks fail', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Set up failing health check
      const productionSmokeTestRunner = createMockSmokeTestRunner(true);
      const productionHealthCheckRunner = createMockHealthCheckRunner(false, 'Server down');
      releaseManager.setProductionSmokeTestRunner(productionSmokeTestRunner);
      releaseManager.setProductionHealthCheckRunner(productionHealthCheckRunner);

      // Deploy to production
      await releaseManager.deployToProduction(releaseId);

      // Verify health check was called but smoke test was not
      expect(productionHealthCheckRunner.runHealthChecks).toHaveBeenCalled();
      expect(productionSmokeTestRunner.runSmokeTests).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Production Deployment Workflow Integration Tests
  // ===========================================================================

  describe('Production Deployment Workflow Integration', () => {
    it('should support full deployment workflow: staging -> approval -> production', async () => {
      // Step 1: Run readiness check
      const readinessResult = await releaseManager.checkReadiness(releaseId);
      expect(readinessResult.success).toBe(true);

      // Step 2: Deploy to staging
      const stagingResult = await releaseManager.deployToStaging(releaseId);
      expect(stagingResult.success).toBe(true);

      // Step 3: Verify staging
      const verifyResult = await releaseManager.verifyStaging(releaseId);
      expect(verifyResult.success).toBe(true);

      // Step 4: Record approval
      const approvalResult = await releaseManager.recordApproval(
        releaseId,
        'lead-001',
        true,
        'Approved for production'
      );
      expect(approvalResult.success).toBe(true);

      // Step 5: Deploy to production
      const productionResult = await releaseManager.deployToProduction(releaseId);
      expect(productionResult.success).toBe(true);
      if (productionResult.success) {
        expect(productionResult.value.success).toBe(true);
        expect(productionResult.value.status).toBe('COMPLETED');
      }

      // Verify final state
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('MONITORING');
        expect(releaseResult.value.stages.production.status).toBe('COMPLETED');
        expect(releaseResult.value.stages.production.deployed_at).not.toBeNull();
        expect(releaseResult.value.stages.production.approved_by).toBe('lead-001');
      }
    });

    it('should handle production failure with rollback option', async () => {
      // Prepare release through staging and approval
      await prepareReleaseForProduction();

      // Set up failing production deployment
      const productionHealthCheckRunner = createMockHealthCheckRunner(false, 'Critical error');
      releaseManager.setProductionHealthCheckRunner(productionHealthCheckRunner);

      // Deploy to production (will fail)
      const productionResult = await releaseManager.deployToProduction(releaseId);
      expect(productionResult.success).toBe(true);
      if (productionResult.success) {
        expect(productionResult.value.success).toBe(false);
      }

      // Verify release is in PRODUCTION_FAILED state with rollback available
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('PRODUCTION_FAILED');
        expect(releaseResult.value.rollback_available).toBe(true);
        expect(releaseResult.value.previous_version).toBe('0.9.0');
      }
    });

    it('should track complete deployment history', async () => {
      // Run full workflow
      await releaseManager.checkReadiness(releaseId);
      await releaseManager.deployToStaging(releaseId);
      await releaseManager.verifyStaging(releaseId);
      await releaseManager.recordApproval(releaseId, 'lead-001', true);
      await releaseManager.deployToProduction(releaseId);

      // Verify history
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        const history = releaseResult.value.status_history;
        
        // Should have all transitions
        expect(history.some(h => h.to_status === 'PLANNING')).toBe(true);
        expect(history.some(h => h.to_status === 'READINESS_CHECK')).toBe(true);
        expect(history.some(h => h.to_status === 'STAGING')).toBe(true);
        expect(history.some(h => h.to_status === 'AWAITING_APPROVAL')).toBe(true);
        expect(history.some(h => h.to_status === 'PRODUCTION')).toBe(true);
        expect(history.some(h => h.to_status === 'MONITORING')).toBe(true);
      }
    });
  });
});


// =============================================================================
// Rollback Flow Tests (R15.7, R15.8)
// =============================================================================

describe('FileReleaseManager - Rollback Flow', () => {
  let tempDir: string;
  let releaseManager: FileReleaseManager;
  let releaseId: string;

  /**
   * Creates a mock smoke test runner.
   */
  function createMockSmokeTestRunner(passed: boolean = true, error?: string) {
    return {
      runSmokeTests: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Creates a mock health check runner.
   */
  function createMockHealthCheckRunner(passed: boolean = true, error?: string) {
    return {
      runHealthChecks: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Creates a mock rollback executor.
   */
  function createMockRollbackExecutor(success: boolean = true, error?: string) {
    return {
      restorePreviousVersion: vi.fn().mockResolvedValue({ success, error }),
    };
  }

  /**
   * Creates a mock incident recorder.
   */
  function createMockIncidentRecorder(success: boolean = true, incidentId?: string) {
    return {
      recordIncident: vi.fn().mockResolvedValue({
        success,
        incident_id: incidentId ?? 'INC-001',
      }),
    };
  }

  /**
   * Helper to prepare a release through production failure state.
   */
  async function prepareReleaseForRollback(failInProduction: boolean = true): Promise<void> {
    // Run readiness check
    await releaseManager.checkReadiness(releaseId);

    // Deploy to staging
    await releaseManager.deployToStaging(releaseId);

    // Verify staging (transitions to AWAITING_APPROVAL)
    await releaseManager.verifyStaging(releaseId);

    // Record approval
    await releaseManager.recordApproval(releaseId, 'lead-001', true, 'Approved');

    if (failInProduction) {
      // Set up failing production health check
      const productionHealthCheckRunner = createMockHealthCheckRunner(false, 'Critical error in production');
      releaseManager.setProductionHealthCheckRunner(productionHealthCheckRunner);
    }

    // Deploy to production (may fail depending on setup)
    await releaseManager.deployToProduction(releaseId);
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    releaseManager = createFileReleaseManager({ storagePath: tempDir });

    // Create a release with previous version for rollback
    const input: PlanReleaseInput = {
      version: '1.0.0',
      created_by: 'dev-001',
      release_notes: 'Test release notes',
      previous_version: '0.9.0', // Set previous version for rollback
    };
    const planResult = await releaseManager.planRelease(input);
    if (planResult.success) {
      releaseId = planResult.value.release_id;
    }

    // Set up mocks for readiness check
    const taskReader = createMockTaskReader([
      { id: 'TASK-001', status: 'DONE' },
    ]);
    const evidenceManager = createMockEvidenceManager();
    const findingRegister = createMockFindingRegister();
    const docChecker = createMockDocumentationChecker(true);

    releaseManager.setTaskReader(taskReader);
    releaseManager.setEvidenceManager(evidenceManager);
    releaseManager.setFindingRegister(findingRegister);
    releaseManager.setDocumentationChecker(docChecker);

    // Set up staging mocks (all pass)
    const stagingSmokeTestRunner = createMockSmokeTestRunner(true);
    const stagingHealthCheckRunner = createMockHealthCheckRunner(true);
    releaseManager.setSmokeTestRunner(stagingSmokeTestRunner);
    releaseManager.setHealthCheckRunner(stagingHealthCheckRunner);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // ===========================================================================
  // rollback Tests - Basic Functionality
  // ===========================================================================

  describe('rollback - Basic Functionality', () => {
    it('should successfully rollback from PRODUCTION_FAILED status', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set up rollback mocks
      const rollbackExecutor = createMockRollbackExecutor(true);
      const rollbackHealthChecker = createMockHealthCheckRunner(true);
      releaseManager.setRollbackExecutor(rollbackExecutor);
      releaseManager.setRollbackHealthChecker(rollbackHealthChecker);

      // Execute rollback
      const result = await releaseManager.rollback(releaseId, 'Production deployment failed');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(true);
        expect(result.value.status).toBe('COMPLETED');
        expect(result.value.from_version).toBe('1.0.0');
        expect(result.value.to_version).toBe('0.9.0');
        expect(result.value.reason).toBe('Production deployment failed');
        expect(result.value.health_verified).toBe(true);
        expect(result.value.evidence_id).toMatch(/^EVD-ROLLBACK-/);
      }

      // Verify rollback executor was called with correct parameters
      expect(rollbackExecutor.restorePreviousVersion).toHaveBeenCalledWith(
        'production',
        '0.9.0',
        '1.0.0'
      );
    });

    it('should transition to ROLLED_BACK status after successful rollback', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set up rollback mocks
      const rollbackExecutor = createMockRollbackExecutor(true);
      releaseManager.setRollbackExecutor(rollbackExecutor);

      // Execute rollback
      await releaseManager.rollback(releaseId, 'Critical error');

      // Verify release status
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('ROLLED_BACK');
        expect(releaseResult.value.rollback_available).toBe(false); // Cannot rollback again
      }
    });

    it('should record rollback in status history', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Execute rollback
      await releaseManager.rollback(releaseId, 'Database migration failure');

      // Verify status history
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        const lastTransition = releaseResult.value.status_history[
          releaseResult.value.status_history.length - 1
        ];
        expect(lastTransition.from_status).toBe('PRODUCTION_FAILED');
        expect(lastTransition.to_status).toBe('ROLLED_BACK');
        expect(lastTransition.reason).toContain('Rolled back from 1.0.0 to 0.9.0');
        expect(lastTransition.reason).toContain('Database migration failure');
      }
    });

    it('should verify health after rollback', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set up rollback mocks
      const rollbackExecutor = createMockRollbackExecutor(true);
      const rollbackHealthChecker = createMockHealthCheckRunner(true);
      releaseManager.setRollbackExecutor(rollbackExecutor);
      releaseManager.setRollbackHealthChecker(rollbackHealthChecker);

      // Execute rollback
      const result = await releaseManager.rollback(releaseId, 'Critical error');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.health_verified).toBe(true);
      }

      // Verify health checker was called
      expect(rollbackHealthChecker.runHealthChecks).toHaveBeenCalledWith('production');
    });
  });

  // ===========================================================================
  // rollback Tests - Rollback Triggers (R15.7)
  // ===========================================================================

  describe('rollback - Triggers (R15.7)', () => {
    it('should identify manual trigger when reason contains "manual"', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Execute rollback with manual reason
      const result = await releaseManager.rollback(releaseId, 'Manual rollback by operator');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger).not.toBeNull();
        expect(result.value.trigger?.type).toBe('manual');
      }
    });

    it('should identify health check trigger when health checks failed', async () => {
      // Prepare release in PRODUCTION_FAILED state (health checks failed)
      await prepareReleaseForRollback(true);

      // Execute rollback
      const result = await releaseManager.rollback(releaseId, 'Production health checks failing');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.trigger).not.toBeNull();
        expect(result.value.trigger?.type).toBe('health_check');
      }
    });

    it('should allow rollback during MONITORING period (manual trigger)', async () => {
      // Prepare release in MONITORING state (successful deployment)
      await prepareReleaseForRollback(false); // Don't fail production

      // Set up rollback mocks
      const rollbackExecutor = createMockRollbackExecutor(true);
      releaseManager.setRollbackExecutor(rollbackExecutor);

      // Execute manual rollback during monitoring
      const result = await releaseManager.rollback(releaseId, 'Explicit manual rollback due to user reports');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(true);
        expect(result.value.trigger?.type).toBe('manual');
      }
    });
  });

  // ===========================================================================
  // rollback Tests - Incident Recording (R15.8)
  // ===========================================================================

  describe('rollback - Incident Recording (R15.8)', () => {
    it('should record incident when rollback is due to production failure', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set up incident recorder
      const incidentRecorder = createMockIncidentRecorder(true, 'INC-2024-001');
      releaseManager.setIncidentRecorder(incidentRecorder);

      // Execute rollback
      const result = await releaseManager.rollback(releaseId, 'Production deployment crashed');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.incident_id).toBe('INC-2024-001');
      }

      // Verify incident was recorded
      expect(incidentRecorder.recordIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PRODUCTION_ROLLBACK',
          release_id: releaseId,
          version: '1.0.0',
          rolled_back_to: '0.9.0',
          reason: 'Production deployment crashed',
          environment: 'production',
        })
      );
    });

    it('should not record incident when rollback is manual during monitoring', async () => {
      // Prepare release in MONITORING state (successful deployment)
      await prepareReleaseForRollback(false);

      // Set up incident recorder
      const incidentRecorder = createMockIncidentRecorder(true, 'INC-2024-002');
      releaseManager.setIncidentRecorder(incidentRecorder);

      // Execute manual rollback during monitoring (not due to failure)
      const result = await releaseManager.rollback(releaseId, 'Manual rollback for precaution');

      expect(result.success).toBe(true);
      if (result.success) {
        // No incident should be recorded for manual rollback during monitoring
        expect(result.value.incident_id).toBeNull();
      }

      // Verify incident was NOT recorded
      expect(incidentRecorder.recordIncident).not.toHaveBeenCalled();
    });

    it('should continue even if incident recording fails', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set up failing incident recorder
      const incidentRecorder = {
        recordIncident: vi.fn().mockRejectedValue(new Error('Incident system unavailable')),
      };
      releaseManager.setIncidentRecorder(incidentRecorder);

      // Execute rollback - should still succeed
      const result = await releaseManager.rollback(releaseId, 'Critical error');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.success).toBe(true);
        expect(result.value.incident_id).toBeNull(); // Incident recording failed
      }
    });
  });

  // ===========================================================================
  // rollback Tests - Error Cases
  // ===========================================================================

  describe('rollback - Error Cases', () => {
    it('should fail if rollback is not available', async () => {
      // Create release WITHOUT previous version
      const noPrevRelease = await releaseManager.planRelease({
        version: '2.0.0',
        created_by: 'dev-001',
        release_notes: 'Test',
        // No previous_version set
      });

      if (noPrevRelease.success) {
        // Manually set to PRODUCTION_FAILED
        const releaseResult = await releaseManager.getRelease(noPrevRelease.value.release_id);
        if (releaseResult.success) {
          const release = releaseResult.value;
          release.status = 'PRODUCTION_FAILED';
          release.rollback_available = false;
          const filePath = path.join(tempDir, `${release.release_id}.yaml`);
          await fs.writeFile(filePath, yaml.stringify(release), 'utf-8');
        }

        // Try rollback
        const result = await releaseManager.rollback(
          noPrevRelease.value.release_id,
          'Need to rollback'
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(ReleaseErrorCode.NO_ROLLBACK_TARGET);
        }
      }
    });

    it('should fail if release is not in correct status for rollback', async () => {
      // Release is in PLANNING status (not eligible for rollback)
      const result = await releaseManager.rollback(releaseId, 'Need to rollback');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('PRODUCTION_FAILED or MONITORING');
      }
    });

    it('should fail if release has no previous version', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Manually remove previous version
      const releaseResult = await releaseManager.getRelease(releaseId);
      if (releaseResult.success) {
        const release = releaseResult.value;
        release.previous_version = null;
        const filePath = path.join(tempDir, `${release.release_id}.yaml`);
        await fs.writeFile(filePath, yaml.stringify(release), 'utf-8');
      }

      // Try rollback
      const result = await releaseManager.rollback(releaseId, 'Need to rollback');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.NO_ROLLBACK_TARGET);
      }
    });

    it('should fail if rollback execution fails', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set up failing rollback executor
      const rollbackExecutor = createMockRollbackExecutor(false, 'Deployment system unavailable');
      releaseManager.setRollbackExecutor(rollbackExecutor);

      // Try rollback
      const result = await releaseManager.rollback(releaseId, 'Need to rollback');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.ROLLBACK_FAILED);
        expect(result.error.message).toContain('Deployment system unavailable');
      }
    });

    it('should fail for release not found', async () => {
      const result = await releaseManager.rollback('REL-nonexistent', 'Need to rollback');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // rollback Tests - Health Verification
  // ===========================================================================

  describe('rollback - Health Verification', () => {
    it('should mark health_verified as true when health checks pass', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set up passing health checker
      const rollbackHealthChecker = createMockHealthCheckRunner(true);
      releaseManager.setRollbackHealthChecker(rollbackHealthChecker);

      // Execute rollback
      const result = await releaseManager.rollback(releaseId, 'Critical error');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.health_verified).toBe(true);
      }
    });

    it('should mark health_verified as false when health checks fail', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set up failing health checker
      const rollbackHealthChecker = createMockHealthCheckRunner(false, 'Old version also failing');
      releaseManager.setRollbackHealthChecker(rollbackHealthChecker);

      // Execute rollback - should still succeed but with unverified health
      const result = await releaseManager.rollback(releaseId, 'Critical error');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.health_verified).toBe(false);
        expect(result.value.error_message).toBe('Old version also failing');
        // Rollback still completes, just with warning about health
        expect(result.value.status).toBe('COMPLETED');
      }
    });

    it('should use production health checker as fallback if rollback checker not set', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Set production health checker (not rollback-specific)
      const productionHealthChecker = createMockHealthCheckRunner(true);
      releaseManager.setProductionHealthCheckRunner(productionHealthChecker);

      // Execute rollback
      const result = await releaseManager.rollback(releaseId, 'Critical error');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.health_verified).toBe(true);
      }

      // Verify production health checker was used
      expect(productionHealthChecker.runHealthChecks).toHaveBeenCalledWith('production');
    });

    it('should assume health verified if no health checker is configured', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Don't set any health checker

      // Execute rollback
      const result = await releaseManager.rollback(releaseId, 'Critical error');

      expect(result.success).toBe(true);
      if (result.success) {
        // Health is assumed verified when no checker is configured
        expect(result.value.health_verified).toBe(true);
      }
    });
  });

  // ===========================================================================
  // rollback Tests - Workflow Integration
  // ===========================================================================

  describe('rollback - Workflow Integration', () => {
    it('should disable further rollback after successful rollback', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Execute first rollback
      await releaseManager.rollback(releaseId, 'First rollback');

      // Verify rollback is no longer available
      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.rollback_available).toBe(false);
      }

      // Try another rollback - should fail due to status (ROLLED_BACK is not valid for rollback)
      const secondResult = await releaseManager.rollback(releaseId, 'Second rollback');
      expect(secondResult.success).toBe(false);
    });

    it('should store rollback record for tracking', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Execute rollback
      await releaseManager.rollback(releaseId, 'Critical error');

      // Check rollback record was stored
      const rollbackDir = path.join(tempDir, 'rollbacks');
      const files = await fs.readdir(rollbackDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^ROLLBACK-/);

      // Read and verify rollback record
      const rollbackContent = await fs.readFile(path.join(rollbackDir, files[0]), 'utf-8');
      const rollbackRecord = yaml.parse(rollbackContent);
      expect(rollbackRecord.from_version).toBe('1.0.0');
      expect(rollbackRecord.to_version).toBe('0.9.0');
      expect(rollbackRecord.reason).toBe('Critical error');
    });

    it('should track duration of rollback operation', async () => {
      // Prepare release in PRODUCTION_FAILED state
      await prepareReleaseForRollback(true);

      // Execute rollback
      const result = await releaseManager.rollback(releaseId, 'Critical error');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.duration_ms).toBeGreaterThanOrEqual(0);
        expect(result.value.started_at).toBeDefined();
        expect(result.value.completed_at).toBeDefined();
      }
    });

    it('should use configured production environment', async () => {
      // Create release with custom production environment
      const customRelease = await releaseManager.planRelease({
        version: '2.0.0',
        created_by: 'dev-001',
        release_notes: 'Test',
        previous_version: '1.9.0',
        config: {
          production_environment: 'production-us-east-1',
        },
      });

      if (customRelease.success) {
        const customReleaseId = customRelease.value.release_id;

        // Prepare and fail in production
        await releaseManager.checkReadiness(customReleaseId);
        await releaseManager.deployToStaging(customReleaseId);
        await releaseManager.verifyStaging(customReleaseId);
        await releaseManager.recordApproval(customReleaseId, 'lead-001', true);

        // Fail production
        const failingHealthChecker = createMockHealthCheckRunner(false, 'Error');
        releaseManager.setProductionHealthCheckRunner(failingHealthChecker);
        await releaseManager.deployToProduction(customReleaseId);

        // Set up rollback mocks
        const rollbackExecutor = createMockRollbackExecutor(true);
        releaseManager.setRollbackExecutor(rollbackExecutor);

        // Execute rollback
        await releaseManager.rollback(customReleaseId, 'Critical error');

        // Verify rollback executor was called with correct environment
        expect(rollbackExecutor.restorePreviousVersion).toHaveBeenCalledWith(
          'production-us-east-1',
          '1.9.0',
          '2.0.0'
        );
      }
    });
  });
});

// =============================================================================
// Release Closure Tests (R15.10)
// =============================================================================

describe('FileReleaseManager - Release Closure', () => {
  let tempDir: string;
  let releaseManager: FileReleaseManager;
  let releaseId: string;

  /**
   * Creates a mock smoke test runner.
   */
  function createMockSmokeTestRunner(passed: boolean = true, error?: string) {
    return {
      runSmokeTests: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Creates a mock health check runner.
   */
  function createMockHealthCheckRunner(passed: boolean = true, error?: string) {
    return {
      runHealthChecks: vi.fn().mockResolvedValue({ passed, error }),
    };
  }

  /**
   * Helper to prepare a release through MONITORING state.
   */
  async function prepareReleaseForClosure(monitoringEndsAt?: Date): Promise<void> {
    // Run readiness check
    await releaseManager.checkReadiness(releaseId);

    // Deploy to staging
    await releaseManager.deployToStaging(releaseId);

    // Verify staging (transitions to AWAITING_APPROVAL)
    await releaseManager.verifyStaging(releaseId);

    // Record approval
    await releaseManager.recordApproval(releaseId, 'lead-001', true, 'Approved');

    // Deploy to production (transitions to MONITORING)
    await releaseManager.deployToProduction(releaseId);

    // Optionally set custom monitoring_ends_at
    if (monitoringEndsAt) {
      const releaseResult = await releaseManager.getRelease(releaseId);
      if (releaseResult.success) {
        const release = releaseResult.value;
        release.stages.production.monitoring_ends_at = monitoringEndsAt.toISOString();
        const filePath = path.join(tempDir, `${release.release_id}.yaml`);
        await fs.writeFile(filePath, yaml.stringify(release), 'utf-8');
      }
    }
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    releaseManager = createFileReleaseManager({ storagePath: tempDir });

    // Create a release with previous version
    const input: PlanReleaseInput = {
      version: '1.0.0',
      created_by: 'dev-001',
      release_notes: 'Test release notes',
      previous_version: '0.9.0',
    };
    const planResult = await releaseManager.planRelease(input);
    if (planResult.success) {
      releaseId = planResult.value.release_id;
    }

    // Set up mocks for readiness check
    const taskReader = createMockTaskReader([
      { id: 'TASK-001', status: 'DONE' },
    ]);
    const evidenceManager = createMockEvidenceManager();
    const findingRegister = createMockFindingRegister();
    const docChecker = createMockDocumentationChecker(true);

    releaseManager.setTaskReader(taskReader);
    releaseManager.setEvidenceManager(evidenceManager);
    releaseManager.setFindingRegister(findingRegister);
    releaseManager.setDocumentationChecker(docChecker);

    // Set up staging mocks (all pass)
    const stagingSmokeTestRunner = createMockSmokeTestRunner(true);
    const stagingHealthCheckRunner = createMockHealthCheckRunner(true);
    releaseManager.setSmokeTestRunner(stagingSmokeTestRunner);
    releaseManager.setHealthCheckRunner(stagingHealthCheckRunner);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // ===========================================================================
  // getClosureStatus Tests
  // ===========================================================================

  describe('getClosureStatus', () => {
    it('should return can_close=true when monitoring is complete', async () => {
      // Prepare release in MONITORING state with past monitoring end time
      const pastTime = new Date(Date.now() - 60000); // 1 minute ago
      await prepareReleaseForClosure(pastTime);

      const result = await releaseManager.getClosureStatus(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(true);
        expect(result.value.monitoring_complete).toBe(true);
        expect(result.value.remaining_minutes).toBe(0);
        expect(result.value.blockers).toHaveLength(0);
        expect(result.value.release_status).toBe('MONITORING');
      }
    });

    it('should return can_close=false when monitoring is not complete', async () => {
      // Prepare release in MONITORING state with future monitoring end time
      const futureTime = new Date(Date.now() + 30 * 60000); // 30 minutes in future
      await prepareReleaseForClosure(futureTime);

      const result = await releaseManager.getClosureStatus(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(false);
        expect(result.value.monitoring_complete).toBe(false);
        expect(result.value.remaining_minutes).toBeGreaterThan(0);
        expect(result.value.blockers.length).toBeGreaterThan(0);
        expect(result.value.early_closure_allowed).toBe(true);
      }
    });

    it('should return can_close=false when not in MONITORING status', async () => {
      // Release is in PLANNING status
      const result = await releaseManager.getClosureStatus(releaseId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(false);
        expect(result.value.release_status).toBe('PLANNING');
        expect(result.value.blockers).toContain(expect.stringContaining('MONITORING'));
        expect(result.value.early_closure_allowed).toBe(false);
      }
    });

    it('should return error for non-existent release', async () => {
      const result = await releaseManager.getClosureStatus('REL-nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });
  });

  // ===========================================================================
  // closeRelease Tests - Normal Closure
  // ===========================================================================

  describe('closeRelease - Normal Closure', () => {
    it('should close release when monitoring is complete', async () => {
      // Prepare release in MONITORING state with past monitoring end time
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.release_id).toBe(releaseId);
        expect(result.value.version).toBe('1.0.0');
        expect(result.value.closed_by).toBe('lead-001');
        expect(result.value.early_closure).toBe(false);
        expect(result.value.closed_at).toBeDefined();
      }
    });

    it('should transition release to CLOSED status', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.status).toBe('CLOSED');
        expect(releaseResult.value.closed_at).toBeDefined();
      }
    });

    it('should record final metrics', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const metrics = result.value.metrics;
        expect(metrics.total_duration_ms).toBeGreaterThan(0);
        expect(metrics.production_to_close_ms).toBeGreaterThan(0);
        expect(metrics.monitoring_duration_ms).toBeGreaterThanOrEqual(0);
        expect(metrics.rollback_count).toBe(0);
        expect(metrics.issues_during_monitoring).toBe(false);
      }
    });

    it('should archive artifact', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        expect(releaseResult.value.artifact?.metadata.archived).toBe(true);
        expect(releaseResult.value.artifact?.metadata.archived_by).toBe('lead-001');
      }
    });

    it('should generate closure summary', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.summary).toContain('v1.0.0');
        expect(result.value.summary).toContain('closed');
        expect(result.value.summary).toContain('No issues detected');
      }
    });

    it('should record closure in status history', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      const releaseResult = await releaseManager.getRelease(releaseId);
      expect(releaseResult.success).toBe(true);
      if (releaseResult.success) {
        const lastTransition = releaseResult.value.status_history[
          releaseResult.value.status_history.length - 1
        ];
        expect(lastTransition.from_status).toBe('MONITORING');
        expect(lastTransition.to_status).toBe('CLOSED');
        expect(lastTransition.actor_id).toBe('lead-001');
      }
    });

    it('should store closure record for tracking', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      // Check closure record was stored
      const closureDir = path.join(tempDir, 'closures');
      const files = await fs.readdir(closureDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^CLOSURE-/);

      // Read and verify closure record
      const closureContent = await fs.readFile(path.join(closureDir, files[0]), 'utf-8');
      const closureRecord = yaml.parse(closureContent);
      expect(closureRecord.release_id).toBe(releaseId);
      expect(closureRecord.version).toBe('1.0.0');
      expect(closureRecord.closed_by).toBe('lead-001');
    });

    it('should allow closure with optional reason', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
        reason: 'All tests passed, no issues reported',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.closure_reason).toBe('All tests passed, no issues reported');
      }
    });
  });

  // ===========================================================================
  // closeRelease Tests - Early Closure
  // ===========================================================================

  describe('closeRelease - Early Closure', () => {
    it('should allow early closure with force flag and reason', async () => {
      // Prepare release in MONITORING state with future monitoring end time
      const futureTime = new Date(Date.now() + 30 * 60000);
      await prepareReleaseForClosure(futureTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
        force_early_closure: true,
        reason: 'Urgent release needed, manual verification completed',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.early_closure).toBe(true);
        expect(result.value.closure_reason).toBe('Urgent release needed, manual verification completed');
      }
    });

    it('should fail early closure without reason', async () => {
      const futureTime = new Date(Date.now() + 30 * 60000);
      await prepareReleaseForClosure(futureTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
        force_early_closure: true,
        // No reason provided
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.MISSING_REQUIRED_FIELDS);
        expect(result.error.message).toContain('reason');
      }
    });

    it('should fail closure without force flag when monitoring not complete', async () => {
      const futureTime = new Date(Date.now() + 30 * 60000);
      await prepareReleaseForClosure(futureTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.MONITORING_INCOMPLETE);
        expect(result.error.message).toContain('minutes remaining');
      }
    });

    it('should record early closure in summary', async () => {
      const futureTime = new Date(Date.now() + 30 * 60000);
      await prepareReleaseForClosure(futureTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
        force_early_closure: true,
        reason: 'Critical hotfix required',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.summary).toContain('Early closure');
        expect(result.value.summary).toContain('Critical hotfix required');
      }
    });
  });

  // ===========================================================================
  // closeRelease Tests - Error Cases
  // ===========================================================================

  describe('closeRelease - Error Cases', () => {
    it('should fail for release not found', async () => {
      const result = await releaseManager.closeRelease('REL-nonexistent', {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.RELEASE_NOT_FOUND);
      }
    });

    it('should fail for already closed release', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      // Close the release first time
      await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      // Try to close again
      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-002',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.ALREADY_CLOSED);
      }
    });

    it('should fail for release not in MONITORING status', async () => {
      // Release is in PLANNING status
      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ReleaseErrorCode.PREREQUISITE_NOT_MET);
        expect(result.error.message).toContain('MONITORING');
      }
    });
  });

  // ===========================================================================
  // closeRelease Tests - Metrics Calculation
  // ===========================================================================

  describe('closeRelease - Metrics', () => {
    it('should calculate stage durations correctly', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const stageDurations = result.value.metrics.stage_durations;
        // Planning duration should be calculated
        expect(stageDurations.planning_ms).not.toBeNull();
        // Other stages should have durations
        expect(stageDurations.staging_ms).not.toBeNull();
      }
    });

    it('should track rollback count', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // No rollbacks occurred in this test
        expect(result.value.metrics.rollback_count).toBe(0);
      }
    });

    it('should identify issues during monitoring', async () => {
      const pastTime = new Date(Date.now() - 60000);
      await prepareReleaseForClosure(pastTime);

      const result = await releaseManager.closeRelease(releaseId, {
        closed_by: 'lead-001',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // No issues in this test scenario
        expect(result.value.metrics.issues_during_monitoring).toBe(false);
      }
    });
  });
});
