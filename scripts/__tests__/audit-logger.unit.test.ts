/**
 * Unit Tests for Audit_Logger Operations
 * 
 * These tests verify the FileAuditLogger functionality including:
 * - log() - Log entries with retry and fallback
 * - getLogsForResource() - Query logs by resource
 * - getLogsByCorrelation() - Query logs by correlation ID
 * - archiveLogs() - Archive old log entries
 * 
 * Following TDD methodology - tests written first to define expected behavior.
 * 
 * **Validates: Requirements R16.1, R16.2, R16.3**
 * 
 * Test Scenarios:
 * 1. Log entry creation with all required fields
 * 2. JSONL format validation
 * 3. Retry on log write failure
 * 4. Fallback log when primary fails
 * 5. Query by resource type and ID
 * 6. Query by correlation ID
 * 7. Query with filters (date range, action, outcome)
 * 8. Archive logs older than date
 * 9. Handle corrupted entries gracefully
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuditEntry,
  AuditEntryInput,
  AuditError,
  AuditErrorCode,
  LogQueryOptions,
  createAuditEntry,
  serializeAuditEntry,
  deserializeAuditEntry,
  isValidAuditEntry,
  isValidOperationId,
  generateOperationId,
  createStateChangeEntry,
  createFailureEntry,
  AUDIT_LOGGER_DEFAULTS,
} from '../audit-logger';

import { FileAuditLogger } from '../audit-logger-impl';

// =============================================================================
// Test Fixtures
// =============================================================================

const VALID_AUDIT_ENTRY: AuditEntry = {
  operation_id: '550e8400-e29b-41d4-a716-446655440000',
  correlation_id: 'corr-123456',
  timestamp: '2026-10-12T10:00:00.000Z',
  actor_id: 'dev-001',
  actor_type: 'HUMAN',
  action: 'TASK_STATUS_CHANGE',
  resource_type: 'Task',
  resource_id: 'TASK-003',
  state_version_before: 41,
  state_version_after: 42,
  changes: {
    status: { from: 'ASSIGNED', to: 'IN_PROGRESS' },
    'tdd.phase': { from: null, to: 'PENDING' },
  },
  reason: 'Developer started work on task',
  outcome: 'SUCCESS',
};

const MINIMAL_AUDIT_ENTRY: AuditEntry = {
  operation_id: '550e8400-e29b-41d4-a716-446655440001',
  timestamp: '2026-10-12T11:00:00.000Z',
  actor_id: 'system',
  actor_type: 'SYSTEM',
  action: 'CHECKPOINT_CREATED',
  resource_type: 'Checkpoint',
  resource_id: 'CP-001',
  outcome: 'SUCCESS',
};

const FAILURE_AUDIT_ENTRY: AuditEntry = {
  operation_id: '550e8400-e29b-41d4-a716-446655440002',
  timestamp: '2026-10-12T12:00:00.000Z',
  actor_id: 'agent-001',
  actor_type: 'AI_AGENT',
  action: 'TASK_ASSIGNED',
  resource_type: 'Task',
  resource_id: 'TASK-005',
  outcome: 'FAILURE',
  error_details: 'Task already claimed by another developer',
};

// Multiple entries for query tests
const MULTIPLE_ENTRIES: AuditEntry[] = [
  {
    operation_id: '550e8400-e29b-41d4-a716-446655440010',
    correlation_id: 'corr-batch-001',
    timestamp: '2026-10-12T09:00:00.000Z',
    actor_id: 'dev-001',
    actor_type: 'HUMAN',
    action: 'TASK_CREATED',
    resource_type: 'Task',
    resource_id: 'TASK-001',
    outcome: 'SUCCESS',
  },
  {
    operation_id: '550e8400-e29b-41d4-a716-446655440011',
    correlation_id: 'corr-batch-001',
    timestamp: '2026-10-12T09:30:00.000Z',
    actor_id: 'dev-001',
    actor_type: 'HUMAN',
    action: 'TASK_ASSIGNED',
    resource_type: 'Task',
    resource_id: 'TASK-001',
    outcome: 'SUCCESS',
  },
  {
    operation_id: '550e8400-e29b-41d4-a716-446655440012',
    timestamp: '2026-10-12T10:00:00.000Z',
    actor_id: 'dev-002',
    actor_type: 'HUMAN',
    action: 'TASK_STATUS_CHANGE',
    resource_type: 'Task',
    resource_id: 'TASK-002',
    outcome: 'SUCCESS',
  },
  {
    operation_id: '550e8400-e29b-41d4-a716-446655440013',
    correlation_id: 'corr-batch-002',
    timestamp: '2026-10-12T11:00:00.000Z',
    actor_id: 'agent-001',
    actor_type: 'AI_AGENT',
    action: 'EVIDENCE_CREATED',
    resource_type: 'Evidence',
    resource_id: 'EVD-001',
    outcome: 'SUCCESS',
  },
  {
    operation_id: '550e8400-e29b-41d4-a716-446655440014',
    timestamp: '2026-10-12T12:00:00.000Z',
    actor_id: 'dev-001',
    actor_type: 'HUMAN',
    action: 'TASK_STATUS_CHANGE',
    resource_type: 'Task',
    resource_id: 'TASK-001',
    outcome: 'FAILURE',
    error_details: 'Validation failed',
  },
];

// =============================================================================
// Test Helper - Temporary File Management
// =============================================================================

class TempFileHelper {
  private tempDir: string = '';
  private files: string[] = [];

  async setup(): Promise<void> {
    this.tempDir = path.join(process.cwd(), '.test-temp', `audit-logger-${Date.now()}`);
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

  async readFile(filename: string): Promise<string> {
    const filePath = path.join(this.tempDir, filename);
    return fs.readFile(filePath, 'utf-8');
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.tempDir, filename));
      return true;
    } catch {
      return false;
    }
  }

  getPath(filename: string): string {
    return path.join(this.tempDir, filename);
  }

  getTempDir(): string {
    return this.tempDir;
  }
}

// =============================================================================
// Unit Tests for Validation Functions
// =============================================================================

describe('Audit Logger Validation Functions', () => {
  describe('isValidOperationId()', () => {
    /**
     * Test: Valid UUID v4 operation ID
     * **Validates: R16.1** - operation_id uniqueness
     */
    it('should return true for valid UUID v4', () => {
      expect(isValidOperationId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidOperationId('6ba7b810-9dad-41d4-80b4-00c04fd430c8')).toBe(true);
    });

    it('should return false for invalid formats', () => {
      expect(isValidOperationId('')).toBe(false);
      expect(isValidOperationId('not-a-uuid')).toBe(false);
      expect(isValidOperationId('550e8400-e29b-41d4-a716')).toBe(false); // Too short
      expect(isValidOperationId(123)).toBe(false);
      expect(isValidOperationId(null)).toBe(false);
      expect(isValidOperationId(undefined)).toBe(false);
    });
  });

  describe('generateOperationId()', () => {
    /**
     * Test: Generate unique operation IDs
     * **Validates: R16.1** - operation_id generation
     */
    it('should generate valid UUID v4 format', () => {
      const id = generateOperationId();
      expect(isValidOperationId(id)).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateOperationId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('isValidAuditEntry()', () => {
    /**
     * Test: Validate audit entry structure
     * **Validates: R16.1** - entry schema validation
     */
    it('should return true for valid complete entry', () => {
      expect(isValidAuditEntry(VALID_AUDIT_ENTRY)).toBe(true);
    });

    it('should return true for valid minimal entry', () => {
      expect(isValidAuditEntry(MINIMAL_AUDIT_ENTRY)).toBe(true);
    });

    it('should return false for missing required fields', () => {
      expect(isValidAuditEntry({})).toBe(false);
      expect(isValidAuditEntry({ operation_id: '123' })).toBe(false);
      
      // Missing actor_type
      expect(isValidAuditEntry({
        operation_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-10-12T10:00:00Z',
        actor_id: 'dev-001',
        action: 'TEST',
        resource_type: 'Task',
        resource_id: 'TASK-001',
        outcome: 'SUCCESS',
      })).toBe(false);
    });

    it('should return false for invalid actor_type', () => {
      const entry = { ...MINIMAL_AUDIT_ENTRY, actor_type: 'INVALID' };
      expect(isValidAuditEntry(entry)).toBe(false);
    });

    it('should return false for invalid outcome', () => {
      const entry = { ...MINIMAL_AUDIT_ENTRY, outcome: 'MAYBE' };
      expect(isValidAuditEntry(entry)).toBe(false);
    });

    it('should return false for non-object inputs', () => {
      expect(isValidAuditEntry(null)).toBe(false);
      expect(isValidAuditEntry(undefined)).toBe(false);
      expect(isValidAuditEntry('string')).toBe(false);
      expect(isValidAuditEntry(123)).toBe(false);
    });
  });
});

// =============================================================================
// Unit Tests for Serialization
// =============================================================================

describe('Audit Logger Serialization', () => {
  describe('serializeAuditEntry()', () => {
    /**
     * Test: Serialize entry to JSONL format
     * **Validates: R16.1** - JSONL format
     */
    it('should serialize entry to single line JSON', () => {
      const serialized = serializeAuditEntry(VALID_AUDIT_ENTRY);
      
      // Should be valid JSON
      expect(() => JSON.parse(serialized)).not.toThrow();
      
      // Should be single line
      expect(serialized.includes('\n')).toBe(false);
    });

    it('should preserve all fields', () => {
      const serialized = serializeAuditEntry(VALID_AUDIT_ENTRY);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.operation_id).toBe(VALID_AUDIT_ENTRY.operation_id);
      expect(parsed.correlation_id).toBe(VALID_AUDIT_ENTRY.correlation_id);
      expect(parsed.actor_id).toBe(VALID_AUDIT_ENTRY.actor_id);
      expect(parsed.actor_type).toBe(VALID_AUDIT_ENTRY.actor_type);
      expect(parsed.action).toBe(VALID_AUDIT_ENTRY.action);
      expect(parsed.outcome).toBe(VALID_AUDIT_ENTRY.outcome);
      expect(parsed.changes).toEqual(VALID_AUDIT_ENTRY.changes);
    });
  });

  describe('deserializeAuditEntry()', () => {
    /**
     * Test: Deserialize JSONL line to entry
     * **Validates: R16.1** - JSONL parsing
     */
    it('should deserialize valid JSON line', () => {
      const serialized = serializeAuditEntry(VALID_AUDIT_ENTRY);
      const deserialized = deserializeAuditEntry(serialized);
      
      expect(deserialized.operation_id).toBe(VALID_AUDIT_ENTRY.operation_id);
      expect(deserialized.actor_id).toBe(VALID_AUDIT_ENTRY.actor_id);
    });

    it('should handle whitespace trimming', () => {
      const serialized = '  ' + serializeAuditEntry(MINIMAL_AUDIT_ENTRY) + '  ';
      const deserialized = deserializeAuditEntry(serialized);
      
      expect(deserialized.operation_id).toBe(MINIMAL_AUDIT_ENTRY.operation_id);
    });

    it('should throw on empty line', () => {
      expect(() => deserializeAuditEntry('')).toThrow('Empty line');
      expect(() => deserializeAuditEntry('   ')).toThrow('Empty line');
    });

    it('should throw on invalid JSON', () => {
      expect(() => deserializeAuditEntry('not json')).toThrow();
      expect(() => deserializeAuditEntry('{ broken')).toThrow();
    });

    it('should throw on invalid entry structure', () => {
      expect(() => deserializeAuditEntry('{"foo": "bar"}')).toThrow('Invalid audit entry');
    });
  });
});

// =============================================================================
// Unit Tests for Entry Creation Helpers
// =============================================================================

describe('Audit Logger Entry Creation', () => {
  describe('createAuditEntry()', () => {
    /**
     * Test: Create entry with auto-generated fields
     * **Validates: R16.1** - entry creation
     */
    it('should auto-generate operation_id if not provided', () => {
      const input: AuditEntryInput = {
        actor_id: 'dev-001',
        actor_type: 'HUMAN',
        action: 'TEST',
        resource_type: 'Task',
        resource_id: 'TASK-001',
        outcome: 'SUCCESS',
      };
      
      const entry = createAuditEntry(input);
      
      expect(isValidOperationId(entry.operation_id)).toBe(true);
    });

    it('should auto-generate timestamp if not provided', () => {
      const before = Date.now();
      
      const entry = createAuditEntry({
        actor_id: 'dev-001',
        actor_type: 'HUMAN',
        action: 'TEST',
        resource_type: 'Task',
        resource_id: 'TASK-001',
        outcome: 'SUCCESS',
      });
      
      const after = Date.now();
      const entryTime = new Date(entry.timestamp).getTime();
      
      expect(entryTime).toBeGreaterThanOrEqual(before);
      expect(entryTime).toBeLessThanOrEqual(after);
    });

    it('should use provided operation_id and timestamp', () => {
      const input: AuditEntryInput = {
        operation_id: '550e8400-e29b-41d4-a716-446655440099',
        timestamp: '2026-01-01T00:00:00Z',
        actor_id: 'dev-001',
        actor_type: 'HUMAN',
        action: 'TEST',
        resource_type: 'Task',
        resource_id: 'TASK-001',
        outcome: 'SUCCESS',
      };
      
      const entry = createAuditEntry(input);
      
      expect(entry.operation_id).toBe(input.operation_id);
      expect(entry.timestamp).toBe(input.timestamp);
    });

    it('should include optional fields only when provided', () => {
      const minimalInput: AuditEntryInput = {
        actor_id: 'dev-001',
        actor_type: 'HUMAN',
        action: 'TEST',
        resource_type: 'Task',
        resource_id: 'TASK-001',
        outcome: 'SUCCESS',
      };
      
      const entry = createAuditEntry(minimalInput);
      
      expect(entry.correlation_id).toBeUndefined();
      expect(entry.state_version_before).toBeUndefined();
      expect(entry.changes).toBeUndefined();
      expect(entry.reason).toBeUndefined();
      expect(entry.error_details).toBeUndefined();
    });
  });

  describe('createStateChangeEntry()', () => {
    /**
     * Test: Create state change entry
     * **Validates: R16.1, R16.2** - state change logging
     */
    it('should create entry with changes', () => {
      const entry = createStateChangeEntry(
        'dev-001',
        'HUMAN',
        'Task',
        'TASK-001',
        'TASK_STATUS_CHANGE',
        { status: { from: 'PENDING', to: 'IN_PROGRESS' } },
        1,
        2,
        'Developer started work'
      );
      
      expect(entry.actor_id).toBe('dev-001');
      expect(entry.action).toBe('TASK_STATUS_CHANGE');
      expect(entry.changes?.status).toEqual({ from: 'PENDING', to: 'IN_PROGRESS' });
      expect(entry.state_version_before).toBe(1);
      expect(entry.state_version_after).toBe(2);
      expect(entry.outcome).toBe('SUCCESS');
    });
  });

  describe('createFailureEntry()', () => {
    /**
     * Test: Create failure entry
     * **Validates: R16.1, R16.2** - failure logging
     */
    it('should create entry with error details', () => {
      const entry = createFailureEntry(
        'agent-001',
        'AI_AGENT',
        'Task',
        'TASK-001',
        'TASK_ASSIGNED',
        'Task already claimed',
        'Attempted auto-assignment'
      );
      
      expect(entry.actor_id).toBe('agent-001');
      expect(entry.actor_type).toBe('AI_AGENT');
      expect(entry.outcome).toBe('FAILURE');
      expect(entry.error_details).toBe('Task already claimed');
      expect(entry.reason).toBe('Attempted auto-assignment');
    });
  });
});

// =============================================================================
// Unit Tests for FileAuditLogger
// =============================================================================

describe('FileAuditLogger', () => {
  let tempHelper: TempFileHelper;

  beforeEach(async () => {
    tempHelper = new TempFileHelper();
    await tempHelper.setup();
  });

  afterEach(async () => {
    await tempHelper.cleanup();
  });

  describe('log()', () => {
    /**
     * Test: Log entry to primary log file
     * **Validates: R16.1, R16.2** - basic logging
     */
    it('should write entry to primary log file in JSONL format', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      const result = await logger.log(VALID_AUDIT_ENTRY);

      expect(result.success).toBe(true);

      // Verify file contents
      const content = await tempHelper.readFile(AUDIT_LOGGER_DEFAULTS.PRIMARY_LOG_FILE);
      const lines = content.trim().split('\n');
      
      expect(lines.length).toBe(1);
      
      const parsed = JSON.parse(lines[0]);
      expect(parsed.operation_id).toBe(VALID_AUDIT_ENTRY.operation_id);
      expect(parsed.action).toBe(VALID_AUDIT_ENTRY.action);
    });

    /**
     * Test: Log multiple entries
     * **Validates: R16.2** - multiple entries
     */
    it('should append entries to log file', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      await logger.log(VALID_AUDIT_ENTRY);
      await logger.log(MINIMAL_AUDIT_ENTRY);
      await logger.log(FAILURE_AUDIT_ENTRY);

      const content = await tempHelper.readFile(AUDIT_LOGGER_DEFAULTS.PRIMARY_LOG_FILE);
      const lines = content.trim().split('\n').filter(l => l);
      
      expect(lines.length).toBe(3);
    });

    /**
     * Test: Reject invalid entry
     * **Validates: R16.1** - entry validation
     */
    it('should reject invalid audit entry', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      const invalidEntry = {
        operation_id: '123',
        // Missing required fields
      } as unknown as AuditEntry;

      const result = await logger.log(invalidEntry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AuditErrorCode.INVALID_ENTRY_FORMAT);
      }
    });

    /**
     * Test: Create log directory if it doesn't exist
     */
    it('should create log directory if it does not exist', async () => {
      const nestedDir = path.join(tempHelper.getTempDir(), 'nested', 'logs');
      const logger = new FileAuditLogger({
        logDirectory: nestedDir,
      });

      const result = await logger.log(VALID_AUDIT_ENTRY);

      expect(result.success).toBe(true);
      
      // Verify directory was created
      const exists = await tempHelper.fileExists('nested/logs/' + AUDIT_LOGGER_DEFAULTS.PRIMARY_LOG_FILE);
      // Check via direct fs access since our helper is relative to tempDir
      const logPath = path.join(nestedDir, AUDIT_LOGGER_DEFAULTS.PRIMARY_LOG_FILE);
      const stat = await fs.stat(logPath);
      expect(stat.isFile()).toBe(true);
    });

    /**
     * Test: Write to fallback on primary failure
     * **Validates: R16.3** - fallback mechanism
     */
    it('should write to fallback log when primary fails', async () => {
      // Create a directory with the same name as the log file to cause write failure
      const logDir = tempHelper.getTempDir();
      const primaryLogPath = path.join(logDir, AUDIT_LOGGER_DEFAULTS.PRIMARY_LOG_FILE);
      
      // Create primary log path as a directory to force failure
      await fs.mkdir(primaryLogPath, { recursive: true });

      const logger = new FileAuditLogger({
        logDirectory: logDir,
        maxRetries: 0, // No retries for faster test
      });

      const result = await logger.log(VALID_AUDIT_ENTRY);

      // Should succeed via fallback
      expect(result.success).toBe(true);

      // Verify fallback was used
      const fallbackContent = await tempHelper.readFile(AUDIT_LOGGER_DEFAULTS.FALLBACK_LOG_FILE);
      expect(fallbackContent.length).toBeGreaterThan(0);
      
      const parsed = JSON.parse(fallbackContent.trim());
      expect(parsed.operation_id).toBe(VALID_AUDIT_ENTRY.operation_id);
    });
  });

  describe('getLogsForResource()', () => {
    /**
     * Test: Query logs by resource
     * **Validates: R16.4** - resource query
     */
    it('should return logs for specific resource', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      // Log multiple entries
      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const result = await logger.getLogsForResource('Task', 'TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(3); // TASK-001 has 3 entries
        expect(result.value.every(e => e.resource_id === 'TASK-001')).toBe(true);
      }
    });

    /**
     * Test: Query with date filters
     */
    it('should filter by date range', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const options: LogQueryOptions = {
        startDate: new Date('2026-10-12T10:00:00Z'),
        endDate: new Date('2026-10-12T11:30:00Z'),
      };

      const result = await logger.getLogsForResource('Task', 'TASK-001', options);

      expect(result.success).toBe(true);
      if (result.success) {
        // Only entries within date range
        expect(result.value.length).toBe(1); // Only the 12:00 entry (failure)
      }
    });

    /**
     * Test: Query with action filter
     */
    it('should filter by action types', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const options: LogQueryOptions = {
        actions: ['TASK_ASSIGNED'],
      };

      const result = await logger.getLogsForResource('Task', 'TASK-001', options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].action).toBe('TASK_ASSIGNED');
      }
    });

    /**
     * Test: Query with outcome filter
     */
    it('should filter by outcome', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const options: LogQueryOptions = {
        outcome: 'FAILURE',
      };

      const result = await logger.getLogsForResource('Task', 'TASK-001', options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].outcome).toBe('FAILURE');
      }
    });

    /**
     * Test: Return empty array when no matches
     */
    it('should return empty array when no entries match', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const result = await logger.getLogsForResource('Task', 'TASK-999');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(0);
      }
    });

    /**
     * Test: Return empty array when log file doesn't exist
     */
    it('should return empty array when log file does not exist', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      const result = await logger.getLogsForResource('Task', 'TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(0);
      }
    });

    /**
     * Test: Sorting order
     */
    it('should sort by timestamp ascending by default', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const result = await logger.getLogsForResource('Task', 'TASK-001');

      expect(result.success).toBe(true);
      if (result.success) {
        for (let i = 1; i < result.value.length; i++) {
          const prev = new Date(result.value[i - 1].timestamp).getTime();
          const curr = new Date(result.value[i].timestamp).getTime();
          expect(curr).toBeGreaterThanOrEqual(prev);
        }
      }
    });

    /**
     * Test: Descending sort
     */
    it('should sort by timestamp descending when specified', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const result = await logger.getLogsForResource('Task', 'TASK-001', {
        sortOrder: 'desc',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        for (let i = 1; i < result.value.length; i++) {
          const prev = new Date(result.value[i - 1].timestamp).getTime();
          const curr = new Date(result.value[i].timestamp).getTime();
          expect(curr).toBeLessThanOrEqual(prev);
        }
      }
    });

    /**
     * Test: Pagination
     */
    it('should apply pagination with limit and offset', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const result = await logger.getLogsForResource('Task', 'TASK-001', {
        limit: 2,
        offset: 1,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
      }
    });
  });

  describe('getLogsByCorrelation()', () => {
    /**
     * Test: Query logs by correlation ID
     * **Validates: R16.4** - correlation query
     */
    it('should return all logs with matching correlation ID', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const result = await logger.getLogsByCorrelation('corr-batch-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(2);
        expect(result.value.every(e => e.correlation_id === 'corr-batch-001')).toBe(true);
      }
    });

    /**
     * Test: Return empty for non-existent correlation ID
     */
    it('should return empty array for non-existent correlation ID', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const result = await logger.getLogsByCorrelation('non-existent');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(0);
      }
    });

    /**
     * Test: Chronological order
     */
    it('should return entries in chronological order', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      const result = await logger.getLogsByCorrelation('corr-batch-001');

      expect(result.success).toBe(true);
      if (result.success && result.value.length > 1) {
        const first = new Date(result.value[0].timestamp).getTime();
        const second = new Date(result.value[1].timestamp).getTime();
        expect(second).toBeGreaterThan(first);
      }
    });
  });

  describe('archiveLogs()', () => {
    /**
     * Test: Archive logs older than date
     * **Validates: R16.5** - log archival
     */
    it('should archive logs older than specified date', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      // Archive logs before 10:30
      const cutoffDate = new Date('2026-10-12T10:30:00Z');
      const result = await logger.archiveLogs(cutoffDate);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.archived).toBe(3); // 3 entries before 10:30
        expect(result.value.archivePath).toBeDefined();
      }

      // Verify primary log now only has newer entries
      const remainingResult = await logger.getLogsForResource('Task', 'TASK-001');
      expect(remainingResult.success).toBe(true);
      if (remainingResult.success) {
        // Only the 12:00 entry should remain
        expect(remainingResult.value.length).toBe(1);
      }
    });

    /**
     * Test: Return 0 when nothing to archive
     */
    it('should return 0 when no logs are older than date', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      for (const entry of MULTIPLE_ENTRIES) {
        await logger.log(entry);
      }

      // Archive logs before all entries
      const cutoffDate = new Date('2026-01-01T00:00:00Z');
      const result = await logger.archiveLogs(cutoffDate);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.archived).toBe(0);
      }
    });

    /**
     * Test: Handle empty log file
     */
    it('should handle non-existent log file gracefully', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      const result = await logger.archiveLogs(new Date());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.archived).toBe(0);
      }
    });
  });

  describe('Error Handling', () => {
    /**
     * Test: Handle corrupted lines gracefully
     */
    it('should skip corrupted lines when querying', async () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      // Write valid entry
      await logger.log(VALID_AUDIT_ENTRY);
      
      // Manually append corrupted line
      const logPath = path.join(tempHelper.getTempDir(), AUDIT_LOGGER_DEFAULTS.PRIMARY_LOG_FILE);
      await fs.appendFile(logPath, 'this is not valid json\n', 'utf-8');
      
      // Write another valid entry
      await logger.log(MINIMAL_AUDIT_ENTRY);

      // Query should still work, skipping corrupted line
      const result = await logger.getLogsForResource('Task', 'TASK-003');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.length).toBe(1); // Only the valid TASK-003 entry
      }
    });
  });

  describe('Utility Methods', () => {
    it('should expose log paths', () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
      });

      expect(logger.getPrimaryLogPath()).toBe(
        path.join(tempHelper.getTempDir(), AUDIT_LOGGER_DEFAULTS.PRIMARY_LOG_FILE)
      );
      expect(logger.getFallbackLogPath()).toBe(
        path.join(tempHelper.getTempDir(), AUDIT_LOGGER_DEFAULTS.FALLBACK_LOG_FILE)
      );
    });

    it('should expose configuration', () => {
      const logger = new FileAuditLogger({
        logDirectory: tempHelper.getTempDir(),
        maxRetries: 5,
      });

      const config = logger.getConfig();
      expect(config.maxRetries).toBe(5);
      expect(config.logDirectory).toBe(tempHelper.getTempDir());
    });
  });
});
