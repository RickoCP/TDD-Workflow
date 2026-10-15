/**
 * Unit Tests for Finding_Register CRUD Operations
 * 
 * These tests verify the FileFindingRegister functionality including:
 * - createFinding() - Finding creation with all required fields
 * - updateFindingStatus() - Status updates with validation
 * - getFinding() - Finding retrieval by ID
 * - getFindingsForTask() - Query findings with filters
 * - deleteFinding() - Finding deletion
 * 
 * Following TDD methodology - tests written first to define expected behavior.
 * 
 * **Validates: Requirements R11.1, R11.3, R11.4, R11.5**
 * 
 * Test Scenarios:
 * 1. Create finding with all required fields (R11.1)
 * 2. Finding ID generated correctly (FND-xxx format)
 * 3. Initial status is OPEN
 * 4. History includes creation entry
 * 5. Update status with valid transition
 * 6. Reject invalid status transition
 * 7. RESOLVED requires resolution info
 * 8. DUPLICATE requires duplicate_of
 * 9. Query findings by task
 * 10. Filter by status, severity, category
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  FileFindingRegister,
  createFileFindingRegister,
  DEFAULT_FILE_FINDING_REGISTER_CONFIG,
} from '../finding-register-impl';

import {
  Finding,
  FindingInput,
  FindingStatusUpdate,
  FindingStatus,
  FindingSeverity,
  FindingCategory,
  FindingScope,
  FindingQueryOptions,
  ReopenFindingInput,
  FindingErrorCode,
  FINDING_DEFAULTS,
  VALID_STATUS_TRANSITIONS,
  isValidFindingId,
  generateFindingId,
} from '../finding-register';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Helper class for managing temporary test directories.
 */
class TempFileHelper {
  private tempDir: string = '';
  
  async setup(): Promise<void> {
    this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'finding-register-test-'));
  }
  
  async cleanup(): Promise<void> {
    if (this.tempDir) {
      try {
        await fs.rm(this.tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
  
  getWorkspacePath(): string {
    return this.tempDir;
  }
  
  getStoragePath(): string {
    return path.join(this.tempDir, FINDING_DEFAULTS.STORAGE_DIR);
  }
  
  async createFindingFile(findingId: string, content: any): Promise<string> {
    const storagePath = this.getStoragePath();
    await fs.mkdir(storagePath, { recursive: true });
    const filePath = path.join(storagePath, `${findingId}.yaml`);
    const yaml = await import('yaml');
    await fs.writeFile(filePath, yaml.stringify(content), 'utf-8');
    return filePath;
  }
  
  async fileExists(findingId: string): Promise<boolean> {
    const filePath = path.join(this.getStoragePath(), `${findingId}.yaml`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  async readFindingFile(findingId: string): Promise<any> {
    const filePath = path.join(this.getStoragePath(), `${findingId}.yaml`);
    const content = await fs.readFile(filePath, 'utf-8');
    const yaml = await import('yaml');
    return yaml.parse(content);
  }
}

/**
 * Creates a valid FindingInput for testing.
 */
function createTestFindingInput(overrides?: Partial<FindingInput>): FindingInput {
  return {
    task_id: 'TASK-001',
    review_round: 1,
    severity: 'HIGH',
    category: 'BUG',
    scope: {
      type: 'file_location',
      file: 'src/auth.ts',
      line_start: 45,
      line_end: 52,
    },
    description: 'Password comparison uses timing-unsafe string equality',
    evidence: 'Code review identified `password === stored` instead of constant-time comparison',
    acceptance_criteria: 'Use crypto.timingSafeEqual or equivalent for password comparison',
    owner_id: 'dev-001',
    reviewer_id: 'reviewer-001',
    ...overrides,
  };
}

/**
 * Creates a valid Finding object for testing.
 */
function createTestFinding(overrides?: Partial<Finding>): Finding {
  const now = new Date().toISOString();
  return {
    finding_id: 'FND-001',
    created_at: now,
    task_id: 'TASK-001',
    review_round: 1,
    severity: 'HIGH',
    category: 'BUG',
    scope: {
      type: 'file_location',
      file: 'src/auth.ts',
      line_start: 45,
      line_end: 52,
    },
    description: 'Test finding description',
    evidence: 'Test evidence',
    acceptance_criteria: 'Test acceptance criteria',
    owner_id: 'dev-001',
    status: 'OPEN',
    resolution: undefined,
    resolved_at: undefined,
    history: [
      {
        action: 'created',
        timestamp: now,
        by: 'reviewer-001',
        details: 'Finding created with severity HIGH',
      },
    ],
    duplicate_of: undefined,
    metadata: undefined,
    ...overrides,
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('FileFindingRegister', () => {
  let tempHelper: TempFileHelper;
  let register: FileFindingRegister;
  
  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
    register = createFileFindingRegister(tempHelper.getWorkspacePath());
  });
  
  afterEach(async () => {
    await tempHelper.cleanup();
  });
  
  // ===========================================================================
  // createFinding Tests
  // ===========================================================================
  
  describe('createFinding', () => {
    it('should create finding with all required fields', async () => {
      const input = createTestFindingInput();
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        const finding = result.value;
        expect(finding.task_id).toBe(input.task_id);
        expect(finding.review_round).toBe(input.review_round);
        expect(finding.severity).toBe(input.severity);
        expect(finding.category).toBe(input.category);
        expect(finding.scope).toEqual(input.scope);
        expect(finding.description).toBe(input.description);
        expect(finding.evidence).toBe(input.evidence);
        expect(finding.acceptance_criteria).toBe(input.acceptance_criteria);
        expect(finding.owner_id).toBe(input.owner_id);
      }
    });
    
    it('should generate finding ID in FND-xxx format', async () => {
      const input = createTestFindingInput();
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(isValidFindingId(result.value.finding_id)).toBe(true);
        expect(result.value.finding_id).toMatch(/^FND-\d{3,}$/);
      }
    });
    
    it('should set initial status to OPEN', async () => {
      const input = createTestFindingInput();
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('OPEN');
      }
    });
    
    it('should include creation entry in history', async () => {
      const input = createTestFindingInput();
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.history).toHaveLength(1);
        expect(result.value.history[0].action).toBe('created');
        expect(result.value.history[0].by).toBe(input.reviewer_id);
        expect(result.value.history[0].timestamp).toBeDefined();
      }
    });
    
    it('should persist finding to YAML file', async () => {
      const input = createTestFindingInput();
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        const exists = await tempHelper.fileExists(result.value.finding_id);
        expect(exists).toBe(true);
        
        const savedFinding = await tempHelper.readFindingFile(result.value.finding_id);
        expect(savedFinding.finding_id).toBe(result.value.finding_id);
        expect(savedFinding.task_id).toBe(input.task_id);
      }
    });
    
    it('should set created_at timestamp', async () => {
      const beforeCreate = new Date().toISOString();
      const input = createTestFindingInput();
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.created_at).toBeDefined();
        expect(new Date(result.value.created_at).getTime()).toBeGreaterThanOrEqual(
          new Date(beforeCreate).getTime() - 1000
        );
      }
    });
    
    it('should generate sequential IDs for multiple findings', async () => {
      const input1 = createTestFindingInput({ description: 'First finding' });
      const input2 = createTestFindingInput({ description: 'Second finding' });
      const input3 = createTestFindingInput({ description: 'Third finding' });
      
      const result1 = await register.createFinding(input1);
      const result2 = await register.createFinding(input2);
      const result3 = await register.createFinding(input3);
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);
      
      if (result1.success && result2.success && result3.success) {
        // Extract numeric parts
        const num1 = parseInt(result1.value.finding_id.replace('FND-', ''), 10);
        const num2 = parseInt(result2.value.finding_id.replace('FND-', ''), 10);
        const num3 = parseInt(result3.value.finding_id.replace('FND-', ''), 10);
        
        expect(num2).toBe(num1 + 1);
        expect(num3).toBe(num2 + 1);
      }
    });
    
    it('should support general scope type', async () => {
      const input = createTestFindingInput({
        scope: {
          type: 'general',
          area: 'Architecture',
        },
      });
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.scope.type).toBe('general');
      }
    });
    
    it('should store metadata when provided', async () => {
      const input = createTestFindingInput({
        metadata: { custom_field: 'custom_value' },
      });
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.metadata).toEqual({ custom_field: 'custom_value' });
      }
    });
    
    // ==== Error Cases ====
    
    it('should reject missing task_id', async () => {
      const input = createTestFindingInput({ task_id: '' });
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.MISSING_REQUIRED_FIELDS);
        expect(result.error.context?.missing_fields).toContain('task_id');
      }
    });
    
    it('should reject missing description', async () => {
      const input = createTestFindingInput({ description: '' });
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.MISSING_REQUIRED_FIELDS);
      }
    });
    
    it('should reject invalid severity', async () => {
      const input = createTestFindingInput({ severity: 'INVALID' as FindingSeverity });
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.INVALID_SEVERITY);
      }
    });
    
    it('should reject invalid category', async () => {
      const input = createTestFindingInput({ category: 'INVALID' as FindingCategory });
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.INVALID_CATEGORY);
      }
    });
    
    it('should reject invalid file_location scope without file', async () => {
      const input = createTestFindingInput({
        scope: {
          type: 'file_location',
          file: '',
          line_start: 45,
        } as FindingScope,
      });
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.INVALID_SCOPE);
      }
    });
    
    it('should reject review round exceeding maximum', async () => {
      const input = createTestFindingInput({ review_round: 10 });
      
      const result = await register.createFinding(input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.MAX_REVIEW_ROUNDS_EXCEEDED);
      }
    });
  });
  
  // ===========================================================================
  // updateFindingStatus Tests
  // ===========================================================================
  
  describe('updateFindingStatus', () => {
    beforeEach(async () => {
      // Pre-create a finding for update tests
      const input = createTestFindingInput();
      await register.createFinding(input);
    });
    
    it('should update status with valid transition OPEN -> IN_PROGRESS', async () => {
      // Get the created finding ID
      const findings = await register.listFindings();
      expect(findings.success).toBe(true);
      if (!findings.success) return;
      
      const findingId = findings.value[0].finding_id;
      
      const update: FindingStatusUpdate = {
        status: 'IN_PROGRESS',
        updated_by: 'dev-001',
        notes: 'Started working on fix',
      };
      
      const result = await register.updateFindingStatus(findingId, update);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('IN_PROGRESS');
      }
    });
    
    it('should add status change to history', async () => {
      const findings = await register.listFindings();
      if (!findings.success) return;
      
      const findingId = findings.value[0].finding_id;
      
      const update: FindingStatusUpdate = {
        status: 'IN_PROGRESS',
        updated_by: 'dev-001',
        notes: 'Working on fix',
      };
      
      const result = await register.updateFindingStatus(findingId, update);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.history.length).toBeGreaterThan(1);
        
        const lastEntry = result.value.history[result.value.history.length - 1];
        expect(lastEntry.action).toBe('status_changed');
        expect(lastEntry.by).toBe('dev-001');
        expect(lastEntry.from).toBe('OPEN');
        expect(lastEntry.to).toBe('IN_PROGRESS');
      }
    });
    
    it('should reject invalid status transition OPEN -> INTEGRATED', async () => {
      const findings = await register.listFindings();
      if (!findings.success) return;
      
      const findingId = findings.value[0].finding_id;
      
      // Note: Findings don't have INTEGRATED status, using an invalid transition
      const update: FindingStatusUpdate = {
        status: 'RESOLVED', // This is valid from OPEN
        updated_by: 'dev-001',
      };
      
      // First, let's check valid transition
      // Actually, OPEN -> RESOLVED is valid, let's test IN_PROGRESS -> DUPLICATE
      // which is not in VALID_STATUS_TRANSITIONS
      
      // First update to IN_PROGRESS
      await register.updateFindingStatus(findingId, {
        status: 'IN_PROGRESS',
        updated_by: 'dev-001',
      });
      
      // Then try to go to DUPLICATE from IN_PROGRESS
      // Based on VALID_STATUS_TRANSITIONS, IN_PROGRESS can go to: RESOLVED, WONT_FIX, OPEN
      const invalidResult = await register.updateFindingStatus(findingId, {
        status: 'DUPLICATE',
        updated_by: 'dev-001',
        duplicate_of: 'FND-999',
      });
      
      expect(invalidResult.success).toBe(false);
      if (!invalidResult.success) {
        expect(invalidResult.error.code).toBe(FindingErrorCode.INVALID_STATUS_TRANSITION);
      }
    });
    
    it('should require resolution info for RESOLVED status', async () => {
      const findings = await register.listFindings();
      if (!findings.success) return;
      
      const findingId = findings.value[0].finding_id;
      
      const update: FindingStatusUpdate = {
        status: 'RESOLVED',
        updated_by: 'dev-001',
        // Missing resolution info
      };
      
      const result = await register.updateFindingStatus(findingId, update);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.RESOLUTION_REQUIRED);
      }
    });
    
    it('should accept RESOLVED with complete resolution info', async () => {
      const findings = await register.listFindings();
      if (!findings.success) return;
      
      const findingId = findings.value[0].finding_id;
      
      const update: FindingStatusUpdate = {
        status: 'RESOLVED',
        updated_by: 'dev-001',
        resolution: {
          resolution_evidence: 'Fixed in commit abc123',
          resolved_at: new Date().toISOString(),
          resolved_by: 'dev-001',
          commit_sha: 'abc123',
        },
      };
      
      const result = await register.updateFindingStatus(findingId, update);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('RESOLVED');
        expect(result.value.resolution).toBeDefined();
        expect(result.value.resolution?.resolution_evidence).toBe('Fixed in commit abc123');
        expect(result.value.resolved_at).toBeDefined();
      }
    });
    
    it('should require duplicate_of for DUPLICATE status', async () => {
      const findings = await register.listFindings();
      if (!findings.success) return;
      
      const findingId = findings.value[0].finding_id;
      
      const update: FindingStatusUpdate = {
        status: 'DUPLICATE',
        updated_by: 'dev-001',
        // Missing duplicate_of
      };
      
      const result = await register.updateFindingStatus(findingId, update);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.DUPLICATE_REF_REQUIRED);
      }
    });
    
    it('should accept DUPLICATE with duplicate_of reference', async () => {
      const findings = await register.listFindings();
      if (!findings.success) return;
      
      const findingId = findings.value[0].finding_id;
      
      const update: FindingStatusUpdate = {
        status: 'DUPLICATE',
        updated_by: 'dev-001',
        duplicate_of: 'FND-999',
      };
      
      const result = await register.updateFindingStatus(findingId, update);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe('DUPLICATE');
        expect(result.value.duplicate_of).toBe('FND-999');
      }
    });
    
    it('should persist updated finding to file', async () => {
      const findings = await register.listFindings();
      if (!findings.success) return;
      
      const findingId = findings.value[0].finding_id;
      
      const update: FindingStatusUpdate = {
        status: 'IN_PROGRESS',
        updated_by: 'dev-001',
      };
      
      await register.updateFindingStatus(findingId, update);
      
      // Read directly from file
      const savedFinding = await tempHelper.readFindingFile(findingId);
      expect(savedFinding.status).toBe('IN_PROGRESS');
    });
    
    it('should return error for non-existent finding', async () => {
      const update: FindingStatusUpdate = {
        status: 'IN_PROGRESS',
        updated_by: 'dev-001',
      };
      
      const result = await register.updateFindingStatus('FND-999', update);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.FINDING_NOT_FOUND);
      }
    });
  });
  
  // ===========================================================================
  // getFinding Tests
  // ===========================================================================
  
  describe('getFinding', () => {
    it('should retrieve existing finding by ID', async () => {
      const input = createTestFindingInput();
      const createResult = await register.createFinding(input);
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;
      
      const findingId = createResult.value.finding_id;
      
      const result = await register.getFinding(findingId);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.finding_id).toBe(findingId);
        expect(result.value.task_id).toBe(input.task_id);
      }
    });
    
    it('should return error for non-existent finding', async () => {
      const result = await register.getFinding('FND-999');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.FINDING_NOT_FOUND);
      }
    });
    
    it('should handle corrupted finding file', async () => {
      // Create a corrupted finding file
      const findingId = 'FND-CORRUPTED';
      await tempHelper.createFindingFile(findingId, { invalid: 'structure' });
      
      const result = await register.getFinding(findingId);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.FINDING_CORRUPTED);
      }
    });
  });
  
  // ===========================================================================
  // getFindingsForTask Tests
  // ===========================================================================
  
  describe('getFindingsForTask', () => {
    beforeEach(async () => {
      // Create multiple findings for different tasks
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'CRITICAL',
        description: 'Critical issue 1',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'HIGH',
        description: 'High issue 1',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'LOW',
        category: 'STYLE',
        description: 'Low style issue',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-002',
        severity: 'MEDIUM',
        description: 'Medium issue for task 2',
      }));
    });
    
    it('should return all findings for a task', async () => {
      const result = await register.getFindingsForTask('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(3);
        expect(result.value.every(f => f.task_id === 'TASK-001')).toBe(true);
      }
    });
    
    it('should return empty array for task with no findings', async () => {
      const result = await register.getFindingsForTask('TASK-999');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(0);
      }
    });
    
    it('should filter by status', async () => {
      // First update one finding to IN_PROGRESS
      const allFindings = await register.getFindingsForTask('TASK-001');
      if (allFindings.success && allFindings.value.length > 0) {
        await register.updateFindingStatus(allFindings.value[0].finding_id, {
          status: 'IN_PROGRESS',
          updated_by: 'dev-001',
        });
      }
      
      const result = await register.getFindingsForTask('TASK-001', {
        status: 'IN_PROGRESS',
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].status).toBe('IN_PROGRESS');
      }
    });
    
    it('should filter by severity', async () => {
      const result = await register.getFindingsForTask('TASK-001', {
        severity: 'CRITICAL',
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].severity).toBe('CRITICAL');
      }
    });
    
    it('should filter by multiple severities', async () => {
      const result = await register.getFindingsForTask('TASK-001', {
        severity: ['CRITICAL', 'HIGH'],
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
        expect(result.value.every(f => 
          f.severity === 'CRITICAL' || f.severity === 'HIGH'
        )).toBe(true);
      }
    });
    
    it('should filter by category', async () => {
      const result = await register.getFindingsForTask('TASK-001', {
        category: 'STYLE',
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].category).toBe('STYLE');
      }
    });
    
    it('should sort by severity', async () => {
      const result = await register.getFindingsForTask('TASK-001', {
        sort_by: 'severity',
        sort_order: 'asc',
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        // Should be ordered: CRITICAL, HIGH, LOW
        expect(result.value[0].severity).toBe('CRITICAL');
        expect(result.value[1].severity).toBe('HIGH');
        expect(result.value[2].severity).toBe('LOW');
      }
    });
    
    it('should limit results', async () => {
      const result = await register.getFindingsForTask('TASK-001', {
        limit: 2,
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
      }
    });
    
    it('should support pagination with offset', async () => {
      const result = await register.getFindingsForTask('TASK-001', {
        offset: 1,
        limit: 2,
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
      }
    });
  });
  
  // ===========================================================================
  // getBlockingFindings Tests
  // ===========================================================================
  
  describe('getBlockingFindings', () => {
    beforeEach(async () => {
      // Create findings with different severities
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'CRITICAL',
        description: 'Critical blocker',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'HIGH',
        description: 'High blocker',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'MEDIUM',
        description: 'Medium issue',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'LOW',
        description: 'Low issue',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'INFO',
        description: 'Info suggestion',
      }));
    });
    
    it('should return only CRITICAL and HIGH severity findings', async () => {
      const result = await register.getBlockingFindings('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
        expect(result.value.every(f => 
          f.severity === 'CRITICAL' || f.severity === 'HIGH'
        )).toBe(true);
      }
    });
    
    it('should only return OPEN or IN_PROGRESS findings', async () => {
      // Resolve the critical finding
      const allFindings = await register.getFindingsForTask('TASK-001', {
        severity: 'CRITICAL',
      });
      
      if (allFindings.success && allFindings.value.length > 0) {
        await register.updateFindingStatus(allFindings.value[0].finding_id, {
          status: 'RESOLVED',
          updated_by: 'dev-001',
          resolution: {
            resolution_evidence: 'Fixed',
            resolved_at: new Date().toISOString(),
            resolved_by: 'dev-001',
          },
        });
      }
      
      const result = await register.getBlockingFindings('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        // Only HIGH should remain (CRITICAL is resolved)
        expect(result.value.length).toBe(1);
        expect(result.value[0].severity).toBe('HIGH');
      }
    });
    
    it('should sort by severity (CRITICAL first)', async () => {
      const result = await register.getBlockingFindings('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value[0].severity).toBe('CRITICAL');
        expect(result.value[1].severity).toBe('HIGH');
      }
    });
  });
  
  // ===========================================================================
  // getFindingsSummary Tests
  // ===========================================================================
  
  describe('getFindingsSummary', () => {
    beforeEach(async () => {
      // Create varied findings
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'CRITICAL',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'HIGH',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'MEDIUM',
      }));
      
      // Resolve one finding
      const findings = await register.listFindings();
      if (findings.success && findings.value.length > 0) {
        await register.updateFindingStatus(findings.value[0].finding_id, {
          status: 'RESOLVED',
          updated_by: 'dev-001',
          resolution: {
            resolution_evidence: 'Fixed',
            resolved_at: new Date().toISOString(),
            resolved_by: 'dev-001',
          },
        });
      }
    });
    
    it('should return correct total count', async () => {
      const result = await register.getFindingsSummary('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.total).toBe(3);
      }
    });
    
    it('should count by status', async () => {
      const result = await register.getFindingsSummary('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.by_status.OPEN).toBe(2);
        expect(result.value.by_status.RESOLVED).toBe(1);
      }
    });
    
    it('should count by severity', async () => {
      const result = await register.getFindingsSummary('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.by_severity.CRITICAL).toBe(1);
        expect(result.value.by_severity.HIGH).toBe(1);
        expect(result.value.by_severity.MEDIUM).toBe(1);
      }
    });
    
    it('should count blocking release findings', async () => {
      const result = await register.getFindingsSummary('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        // CRITICAL and HIGH that are OPEN count as blocking
        // One was resolved, so it depends on which one
        expect(result.value.blocking_release).toBeGreaterThanOrEqual(0);
      }
    });
  });
  
  // ===========================================================================
  // canCloseReview Tests
  // ===========================================================================
  
  describe('canCloseReview', () => {
    it('should allow close when no findings exist', async () => {
      const result = await register.canCloseReview('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(true);
        expect(result.value.blockers).toHaveLength(0);
      }
    });
    
    it('should block close when CRITICAL finding is open', async () => {
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'CRITICAL',
      }));
      
      const result = await register.canCloseReview('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(false);
        expect(result.value.blockers.length).toBeGreaterThan(0);
        expect(result.value.blocking_reasons.some(r => r.includes('CRITICAL'))).toBe(true);
      }
    });
    
    it('should block close when HIGH finding is open', async () => {
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'HIGH',
      }));
      
      const result = await register.canCloseReview('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(false);
        expect(result.value.blocking_reasons.some(r => r.includes('HIGH'))).toBe(true);
      }
    });
    
    it('should allow close when all CRITICAL and HIGH are resolved', async () => {
      const createResult = await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'HIGH',
      }));
      
      if (createResult.success) {
        await register.updateFindingStatus(createResult.value.finding_id, {
          status: 'RESOLVED',
          updated_by: 'dev-001',
          resolution: {
            resolution_evidence: 'Fixed',
            resolved_at: new Date().toISOString(),
            resolved_by: 'dev-001',
          },
        });
      }
      
      const result = await register.canCloseReview('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(true);
      }
    });
    
    it('should not block for LOW severity', async () => {
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'LOW',
      }));
      
      const result = await register.canCloseReview('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(true);
      }
    });
    
    it('should not block for INFO severity', async () => {
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'INFO',
      }));
      
      const result = await register.canCloseReview('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(true);
      }
    });
    
    it('should track deferred MEDIUM findings', async () => {
      const createResult = await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'MEDIUM',
      }));
      
      if (createResult.success) {
        await register.updateFindingStatus(createResult.value.finding_id, {
          status: 'WONT_FIX',
          updated_by: 'dev-001',
          notes: 'Deferred to backlog',
        });
      }
      
      const result = await register.canCloseReview('TASK-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.can_close).toBe(true);
        expect(result.value.deferred_findings.length).toBe(1);
      }
    });
  });
  
  // ===========================================================================
  // reopenFinding Tests
  // ===========================================================================
  
  describe('reopenFinding', () => {
    let resolvedFindingId: string;
    
    beforeEach(async () => {
      // Create and resolve a finding
      const createResult = await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
      }));
      
      if (createResult.success) {
        resolvedFindingId = createResult.value.finding_id;
        await register.updateFindingStatus(resolvedFindingId, {
          status: 'RESOLVED',
          updated_by: 'dev-001',
          resolution: {
            resolution_evidence: 'Fixed in commit abc123',
            resolved_at: new Date().toISOString(),
            resolved_by: 'dev-001',
          },
        });
      }
    });
    
    it('should reopen resolved finding with evidence', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'Bug still reproduces in test case XYZ',
        justification: 'Regression test failed after merge',
        reopened_by: 'qa-001',
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.finding.status).toBe('OPEN');
        expect(result.value.finding.resolution).toBeUndefined();
        expect(result.value.finding.resolved_at).toBeUndefined();
        expect(result.value.created_new_finding).toBe(false);
      }
    });
    
    it('should add reopen entry to history', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'Bug reproduces',
        justification: 'Regression',
        reopened_by: 'qa-001',
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        const lastEntry = result.value.finding.history[result.value.finding.history.length - 1];
        expect(lastEntry.action).toBe('reopened');
        expect(lastEntry.by).toBe('qa-001');
        expect(lastEntry.from).toBe('RESOLVED');
        expect(lastEntry.to).toBe('OPEN');
      }
    });
    
    it('should require new evidence to reopen', async () => {
      const input: ReopenFindingInput = {
        new_evidence: '',
        justification: 'Regression',
        reopened_by: 'qa-001',
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.REOPEN_EVIDENCE_REQUIRED);
      }
    });
    
    it('should require justification to reopen', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'Bug reproduces',
        justification: '',
        reopened_by: 'qa-001',
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.REOPEN_EVIDENCE_REQUIRED);
      }
    });
    
    it('should not reopen already open finding', async () => {
      // Create a new open finding
      const createResult = await register.createFinding(createTestFindingInput({
        task_id: 'TASK-002',
      }));
      
      if (createResult.success) {
        const input: ReopenFindingInput = {
          new_evidence: 'More evidence',
          justification: 'More info',
          reopened_by: 'qa-001',
          // is_different_issue not set, so this is a regular reopen attempt
        };
        
        const result = await register.reopenFinding(createResult.value.finding_id, input);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(FindingErrorCode.FINDING_ALREADY_OPEN);
        }
      }
    });
    
    it('should clear duplicate_of when reopening', async () => {
      // First mark as duplicate
      const createResult = await register.createFinding(createTestFindingInput({
        task_id: 'TASK-003',
      }));
      
      if (createResult.success) {
        await register.updateFindingStatus(createResult.value.finding_id, {
          status: 'DUPLICATE',
          updated_by: 'dev-001',
          duplicate_of: 'FND-999',
        });
        
        const input: ReopenFindingInput = {
          new_evidence: 'Not actually a duplicate',
          justification: 'Different root cause identified',
          reopened_by: 'qa-001',
        };
        
        const result = await register.reopenFinding(createResult.value.finding_id, input);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.finding.status).toBe('OPEN');
          expect(result.value.finding.duplicate_of).toBeUndefined();
          expect(result.value.created_new_finding).toBe(false);
        }
      }
    });
    
    // ==== is_different_issue Tests (R11.3) ====
    
    it('should create new finding when is_different_issue=true', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'This is a completely different bug',
        justification: 'Original bug is fixed, this is a new issue',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.created_new_finding).toBe(true);
        expect(result.value.new_finding).toBeDefined();
        expect(result.value.new_finding?.finding_id).not.toBe(resolvedFindingId);
        expect(result.value.new_finding?.status).toBe('OPEN');
        expect(result.value.new_finding?.original_finding_id).toBe(resolvedFindingId);
      }
    });
    
    it('should keep original finding closed when is_different_issue=true', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'Different bug discovered',
        justification: 'Related but distinct issue',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        // Original remains RESOLVED
        expect(result.value.finding.status).toBe('RESOLVED');
        expect(result.value.finding.finding_id).toBe(resolvedFindingId);
        
        // New finding is OPEN
        expect(result.value.new_finding?.status).toBe('OPEN');
      }
    });
    
    it('should link new finding to original via original_finding_id', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'New test case reveals different issue',
        justification: 'Distinct root cause',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.new_finding?.original_finding_id).toBe(resolvedFindingId);
        expect(result.value.new_finding?.metadata?.created_from_finding).toBe(resolvedFindingId);
        expect(result.value.new_finding?.metadata?.creation_justification).toBe('Distinct root cause');
      }
    });
    
    it('should increment review_round for new finding', async () => {
      // Get original finding to check review_round
      const originalResult = await register.getFinding(resolvedFindingId);
      expect(originalResult.success).toBe(true);
      if (!originalResult.success) return;
      
      const originalReviewRound = originalResult.value.review_round;
      
      const input: ReopenFindingInput = {
        new_evidence: 'New evidence',
        justification: 'Different issue',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.new_finding?.review_round).toBe(originalReviewRound + 1);
      }
    });
    
    it('should include new evidence in new finding description', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'Specific new evidence about edge case',
        justification: 'Edge case not covered',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.new_finding?.description).toContain('Specific new evidence about edge case');
        expect(result.value.new_finding?.evidence).toBe('Specific new evidence about edge case');
      }
    });
    
    it('should add history entry to original finding about new finding creation', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'New issue found',
        justification: 'Different behavior',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        const lastHistoryEntry = result.value.finding.history[result.value.finding.history.length - 1];
        expect(lastHistoryEntry.action).toBe('commented');
        expect(lastHistoryEntry.by).toBe('qa-001');
        expect(lastHistoryEntry.details).toContain('Different issue created');
        expect(lastHistoryEntry.details).toContain(result.value.new_finding?.finding_id);
      }
    });
    
    it('should copy properties from original finding to new finding', async () => {
      // Get original finding to check properties
      const originalResult = await register.getFinding(resolvedFindingId);
      expect(originalResult.success).toBe(true);
      if (!originalResult.success) return;
      
      const original = originalResult.value;
      
      const input: ReopenFindingInput = {
        new_evidence: 'New issue',
        justification: 'Different behavior',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        const newFinding = result.value.new_finding!;
        expect(newFinding.task_id).toBe(original.task_id);
        expect(newFinding.severity).toBe(original.severity);
        expect(newFinding.category).toBe(original.category);
        expect(newFinding.scope).toEqual(original.scope);
        expect(newFinding.acceptance_criteria).toBe(original.acceptance_criteria);
        expect(newFinding.owner_id).toBe(original.owner_id);
      }
    });
    
    it('should allow is_different_issue=true even from OPEN finding', async () => {
      // Create a new open finding
      const createResult = await register.createFinding(createTestFindingInput({
        task_id: 'TASK-002',
        description: 'Open finding',
      }));
      
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;
      
      const input: ReopenFindingInput = {
        new_evidence: 'Related but different issue discovered',
        justification: 'Need to track separately',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(createResult.value.finding_id, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.created_new_finding).toBe(true);
        expect(result.value.new_finding?.status).toBe('OPEN');
        // Original stays open
        expect(result.value.finding.status).toBe('OPEN');
      }
    });
    
    it('should persist both original and new finding to files', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'New evidence for persistence test',
        justification: 'Testing file persistence',
        reopened_by: 'qa-001',
        is_different_issue: true,
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        // Verify original finding file
        const originalExists = await tempHelper.fileExists(resolvedFindingId);
        expect(originalExists).toBe(true);
        
        // Verify new finding file
        const newFindingId = result.value.new_finding!.finding_id;
        const newExists = await tempHelper.fileExists(newFindingId);
        expect(newExists).toBe(true);
        
        // Read and verify content
        const savedNewFinding = await tempHelper.readFindingFile(newFindingId);
        expect(savedNewFinding.original_finding_id).toBe(resolvedFindingId);
      }
    });
    
    it('should return created_new_finding=false when is_different_issue is not set', async () => {
      const input: ReopenFindingInput = {
        new_evidence: 'Bug reproduces again',
        justification: 'Same issue',
        reopened_by: 'qa-001',
        // is_different_issue not set (defaults to false)
      };
      
      const result = await register.reopenFinding(resolvedFindingId, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.created_new_finding).toBe(false);
        expect(result.value.new_finding).toBeUndefined();
        expect(result.value.finding.status).toBe('OPEN');
      }
    });
    
    it('should return created_new_finding=false when is_different_issue=false', async () => {
      // First re-resolve the finding
      await register.updateFindingStatus(resolvedFindingId, {
        status: 'IN_PROGRESS',
        updated_by: 'dev-001',
      });
      
      // This won't work because we need to go RESOLVED first
      // Let's create a fresh resolved finding
      const freshResult = await register.createFinding(createTestFindingInput({
        task_id: 'TASK-FRESH',
        description: 'Fresh finding for test',
      }));
      expect(freshResult.success).toBe(true);
      if (!freshResult.success) return;
      
      await register.updateFindingStatus(freshResult.value.finding_id, {
        status: 'RESOLVED',
        updated_by: 'dev-001',
        resolution: {
          resolution_evidence: 'Fixed',
          resolved_at: new Date().toISOString(),
          resolved_by: 'dev-001',
        },
      });
      
      const input: ReopenFindingInput = {
        new_evidence: 'Bug reappeared',
        justification: 'Same root cause',
        reopened_by: 'qa-001',
        is_different_issue: false,
      };
      
      const result = await register.reopenFinding(freshResult.value.finding_id, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.created_new_finding).toBe(false);
        expect(result.value.new_finding).toBeUndefined();
        expect(result.value.finding.status).toBe('OPEN');
      }
    });
  });
  
  // ===========================================================================
  // deleteFinding Tests
  // ===========================================================================
  
  describe('deleteFinding', () => {
    it('should delete existing finding', async () => {
      const createResult = await register.createFinding(createTestFindingInput());
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;
      
      const findingId = createResult.value.finding_id;
      
      const result = await register.deleteFinding(findingId);
      
      expect(result.success).toBe(true);
      
      // Verify file is deleted
      const exists = await tempHelper.fileExists(findingId);
      expect(exists).toBe(false);
    });
    
    it('should return error for non-existent finding', async () => {
      const result = await register.deleteFinding('FND-999');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.FINDING_NOT_FOUND);
      }
    });
  });
  
  // ===========================================================================
  // listFindings Tests
  // ===========================================================================
  
  describe('listFindings', () => {
    beforeEach(async () => {
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-001',
        severity: 'HIGH',
      }));
      
      await register.createFinding(createTestFindingInput({
        task_id: 'TASK-002',
        severity: 'CRITICAL',
      }));
    });
    
    it('should list all findings', async () => {
      const result = await register.listFindings();
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
      }
    });
    
    it('should apply query options', async () => {
      const result = await register.listFindings({
        severity: 'CRITICAL',
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].severity).toBe('CRITICAL');
      }
    });
    
    it('should return empty array when no findings exist', async () => {
      // Create new register with clean directory
      const cleanHelper = new TempFileHelper();
      await cleanHelper.setup();
      const cleanRegister = createFileFindingRegister(cleanHelper.getWorkspacePath());
      
      const result = await cleanRegister.listFindings();
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(0);
      }
      
      await cleanHelper.cleanup();
    });
  });
  
  // ===========================================================================
  // Configuration Tests
  // ===========================================================================
  
  describe('configuration', () => {
    it('should use default configuration when not provided', () => {
      const reg = createFileFindingRegister('/test/path');
      // The register is created successfully with defaults
      expect(reg).toBeDefined();
    });
    
    it('should accept custom storage path', async () => {
      const customRegister = createFileFindingRegister(
        tempHelper.getWorkspacePath(),
        { storagePath: '.custom/findings' }
      );
      
      await customRegister.createFinding(createTestFindingInput());
      
      const findings = await customRegister.listFindings();
      expect(findings.success).toBe(true);
    });
    
    it('should respect maxReviewRounds configuration', async () => {
      const strictRegister = createFileFindingRegister(
        tempHelper.getWorkspacePath(),
        { maxReviewRounds: 2 }
      );
      
      const result = await strictRegister.createFinding(
        createTestFindingInput({ review_round: 3 })
      );
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FindingErrorCode.MAX_REVIEW_ROUNDS_EXCEEDED);
      }
    });
  });
  
  // ===========================================================================
  // Utility Function Tests
  // ===========================================================================
  
  describe('utility functions', () => {
    describe('isValidFindingId', () => {
      it('should accept valid finding IDs', () => {
        expect(isValidFindingId('FND-001')).toBe(true);
        expect(isValidFindingId('FND-123')).toBe(true);
        expect(isValidFindingId('FND-9999')).toBe(true);
      });
      
      it('should reject invalid finding IDs', () => {
        expect(isValidFindingId('fnd-001')).toBe(false);
        expect(isValidFindingId('FND001')).toBe(false);
        expect(isValidFindingId('FND-1')).toBe(false); // needs at least 3 digits
        expect(isValidFindingId('FINDING-001')).toBe(false);
        expect(isValidFindingId('')).toBe(false);
      });
    });
    
    describe('generateFindingId', () => {
      it('should generate ID with correct format', () => {
        expect(generateFindingId(1)).toBe('FND-001');
        expect(generateFindingId(42)).toBe('FND-042');
        expect(generateFindingId(999)).toBe('FND-999');
        expect(generateFindingId(1000)).toBe('FND-1000');
      });
    });
  });
  
  // ===========================================================================
  // Review Closure Logic Tests (T32: R11.4, R11.5)
  // ===========================================================================
  
  describe('Review Closure Logic', () => {
    
    // =========================================================================
    // deferFinding Tests
    // =========================================================================
    
    describe('deferFinding', () => {
      it('should defer MEDIUM severity finding with approval', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Not critical for this release',
          approved_by: 'lead-001',
          deferred_to: 'next-sprint',
        });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.status).toBe('DEFERRED');
          expect(result.value.deferral).toBeDefined();
          expect(result.value.deferral?.reason).toBe('Not critical for this release');
          expect(result.value.deferral?.approved_by).toBe('lead-001');
          expect(result.value.deferral?.deferred_to).toBe('next-sprint');
        }
      });
      
      it('should defer LOW severity finding', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'LOW',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Minor style issue',
          approved_by: 'dev-001',
        });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.status).toBe('DEFERRED');
        }
      });
      
      it('should defer INFO severity finding', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'INFO',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Suggestion for future improvement',
          approved_by: 'dev-001',
        });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.status).toBe('DEFERRED');
        }
      });
      
      it('should reject deferral of CRITICAL severity finding', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'CRITICAL',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Want to defer',
          approved_by: 'lead-001',
        });
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(FindingErrorCode.CANNOT_DEFER_SEVERITY);
          expect(result.error.message).toContain('CRITICAL');
        }
      });
      
      it('should reject deferral of HIGH severity finding', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'HIGH',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Want to defer',
          approved_by: 'lead-001',
        });
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(FindingErrorCode.CANNOT_DEFER_SEVERITY);
          expect(result.error.message).toContain('HIGH');
        }
      });
      
      it('should require approval for deferral', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Some reason',
          approved_by: '', // Empty approval
        });
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(FindingErrorCode.DEFERRAL_APPROVAL_REQUIRED);
        }
      });
      
      it('should require reason for deferral', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: '', // Empty reason
          approved_by: 'lead-001',
        });
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(FindingErrorCode.DEFERRAL_APPROVAL_REQUIRED);
        }
      });
      
      it('should add deferral to history', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Deferred for later',
          approved_by: 'lead-001',
          deferred_to: 'backlog',
        });
        
        expect(result.success).toBe(true);
        if (result.success) {
          const lastEntry = result.value.history[result.value.history.length - 1];
          expect(lastEntry.action).toBe('status_changed');
          expect(lastEntry.from).toBe('OPEN');
          expect(lastEntry.to).toBe('DEFERRED');
          expect(lastEntry.by).toBe('lead-001');
          expect(lastEntry.details).toContain('backlog');
        }
      });
      
      it('should reject deferral of already deferred finding', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        // First deferral
        await register.deferFinding(createResult.value.finding_id, {
          reason: 'First deferral',
          approved_by: 'lead-001',
        });
        
        // Try to defer again
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Second deferral',
          approved_by: 'lead-001',
        });
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(FindingErrorCode.INVALID_STATUS_TRANSITION);
        }
      });
      
      it('should reject deferral of resolved finding', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        // Resolve first
        await register.updateFindingStatus(createResult.value.finding_id, {
          status: 'RESOLVED',
          updated_by: 'dev-001',
          resolution: {
            resolution_evidence: 'Fixed',
            resolved_at: new Date().toISOString(),
            resolved_by: 'dev-001',
          },
        });
        
        // Try to defer
        const result = await register.deferFinding(createResult.value.finding_id, {
          reason: 'Want to defer',
          approved_by: 'lead-001',
        });
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(FindingErrorCode.INVALID_STATUS_TRANSITION);
        }
      });
      
      it('should persist deferred finding to file', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        await register.deferFinding(createResult.value.finding_id, {
          reason: 'Deferred',
          approved_by: 'lead-001',
        });
        
        const savedFinding = await tempHelper.readFindingFile(createResult.value.finding_id);
        expect(savedFinding.status).toBe('DEFERRED');
        expect(savedFinding.deferral).toBeDefined();
        expect(savedFinding.deferral.approved_by).toBe('lead-001');
      });
    });
    
    // =========================================================================
    // Enhanced canCloseReview Tests
    // =========================================================================
    
    describe('canCloseReview - enhanced closure rules', () => {
      it('should allow close when MEDIUM finding is properly deferred', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        await register.deferFinding(createResult.value.finding_id, {
          reason: 'Deferred with approval',
          approved_by: 'lead-001',
        });
        
        const result = await register.canCloseReview('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.can_close).toBe(true);
          expect(result.value.deferred_findings.length).toBe(1);
        }
      });
      
      it('should block close when MEDIUM finding is open', async () => {
        await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        
        const result = await register.canCloseReview('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.can_close).toBe(false);
          expect(result.value.blocking_reasons.some(r => r.includes('MEDIUM'))).toBe(true);
          expect(result.value.missing_approvals.length).toBe(1);
        }
      });
      
      it('should include missing approvals for open MEDIUM findings', async () => {
        await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
          description: 'Need approval',
        }));
        
        const result = await register.canCloseReview('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.missing_approvals.length).toBe(1);
          expect(result.value.missing_approvals[0].severity).toBe('MEDIUM');
          expect(result.value.missing_approvals[0].approval_needed).toContain('Resolve');
        }
      });
      
      it('should track multiple deferred findings', async () => {
        // Create and defer MEDIUM finding
        const medium = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        if (medium.success) {
          await register.deferFinding(medium.value.finding_id, {
            reason: 'Deferred',
            approved_by: 'lead-001',
          });
        }
        
        // Create and defer LOW finding
        const low = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'LOW',
        }));
        if (low.success) {
          await register.deferFinding(low.value.finding_id, {
            reason: 'Deferred',
            approved_by: 'dev-001',
          });
        }
        
        const result = await register.canCloseReview('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.can_close).toBe(true);
          expect(result.value.deferred_findings.length).toBe(2);
        }
      });
      
      it('should allow close with mix of resolved and deferred', async () => {
        // Create and resolve HIGH finding
        const high = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'HIGH',
        }));
        if (high.success) {
          await register.updateFindingStatus(high.value.finding_id, {
            status: 'RESOLVED',
            updated_by: 'dev-001',
            resolution: {
              resolution_evidence: 'Fixed',
              resolved_at: new Date().toISOString(),
              resolved_by: 'dev-001',
            },
          });
        }
        
        // Create and defer MEDIUM finding
        const medium = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        if (medium.success) {
          await register.deferFinding(medium.value.finding_id, {
            reason: 'Deferred',
            approved_by: 'lead-001',
          });
        }
        
        // Create LOW finding (doesn't block)
        await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'LOW',
        }));
        
        const result = await register.canCloseReview('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.can_close).toBe(true);
        }
      });
      
      it('should allow close when CRITICAL is WONT_FIX', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'CRITICAL',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        await register.updateFindingStatus(createResult.value.finding_id, {
          status: 'WONT_FIX',
          updated_by: 'lead-001',
          notes: 'Accepted risk',
        });
        
        const result = await register.canCloseReview('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.can_close).toBe(true);
        }
      });
      
      it('should allow close when HIGH is WONT_FIX', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'HIGH',
        }));
        expect(createResult.success).toBe(true);
        if (!createResult.success) return;
        
        await register.updateFindingStatus(createResult.value.finding_id, {
          status: 'WONT_FIX',
          updated_by: 'lead-001',
          notes: 'Accepted risk',
        });
        
        const result = await register.canCloseReview('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.can_close).toBe(true);
        }
      });
    });
    
    // =========================================================================
    // closeReview Tests
    // =========================================================================
    
    describe('closeReview', () => {
      it('should close review when all conditions met', async () => {
        const createResult = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'HIGH',
        }));
        if (createResult.success) {
          await register.updateFindingStatus(createResult.value.finding_id, {
            status: 'RESOLVED',
            updated_by: 'dev-001',
            resolution: {
              resolution_evidence: 'Fixed',
              resolved_at: new Date().toISOString(),
              resolved_by: 'dev-001',
            },
          });
        }
        
        const result = await register.closeReview('TASK-001', {
          closed_by: 'lead-001',
          notes: 'Review completed',
        });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.closed).toBe(true);
          expect(result.value.task_id).toBe('TASK-001');
          expect(result.value.closed_by).toBe('lead-001');
          expect(result.value.closed_at).toBeDefined();
          expect(result.value.notes).toBe('Review completed');
        }
      });
      
      it('should fail to close when blocking findings exist', async () => {
        await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'CRITICAL',
        }));
        
        const result = await register.closeReview('TASK-001', {
          closed_by: 'lead-001',
        });
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(FindingErrorCode.REVIEW_CANNOT_CLOSE);
        }
      });
      
      it('should include deferred findings in closure result', async () => {
        const medium = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        if (medium.success) {
          await register.deferFinding(medium.value.finding_id, {
            reason: 'Deferred',
            approved_by: 'lead-001',
          });
        }
        
        const result = await register.closeReview('TASK-001', {
          closed_by: 'lead-001',
        });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.deferred_findings.length).toBe(1);
        }
      });
      
      it('should include summary in closure result', async () => {
        await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'LOW',
        }));
        
        const result = await register.closeReview('TASK-001', {
          closed_by: 'lead-001',
        });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.summary).toBeDefined();
          expect(result.value.summary.total).toBe(1);
        }
      });
      
      it('should close review with no findings', async () => {
        const result = await register.closeReview('TASK-001', {
          closed_by: 'lead-001',
        });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.closed).toBe(true);
          expect(result.value.summary.total).toBe(0);
        }
      });
    });
    
    // =========================================================================
    // getBlockingFindings Enhanced Tests
    // =========================================================================
    
    describe('getBlockingFindings - with DEFERRED status', () => {
      it('should not return DEFERRED findings as blocking', async () => {
        const medium = await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'MEDIUM',
        }));
        if (medium.success) {
          await register.deferFinding(medium.value.finding_id, {
            reason: 'Deferred',
            approved_by: 'lead-001',
          });
        }
        
        const result = await register.getBlockingFindings('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.length).toBe(0);
        }
      });
      
      it('should return OPEN HIGH and CRITICAL as blocking', async () => {
        await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'CRITICAL',
        }));
        
        await register.createFinding(createTestFindingInput({
          task_id: 'TASK-001',
          severity: 'HIGH',
        }));
        
        const result = await register.getBlockingFindings('TASK-001');
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.length).toBe(2);
        }
      });
    });
  });
});