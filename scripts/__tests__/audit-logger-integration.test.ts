/**
 * Audit Logger Integration Tests
 * 
 * Tests that verify AuditLogger integration with various components.
 * These tests ensure that:
 * - Components accept optional auditLogger parameter
 * - Audit logging is fire-and-forget (doesn't block operations)
 * - Components work correctly with or without auditLogger
 * 
 * Requirements: R16.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

import { 
  AuditLogger, 
  AuditEntry, 
  LogResult, 
  QueryResult,
  ArchiveLogResult,
  createAuditEntry,
  generateOperationId,
} from '../audit-logger';
import { FileAuditLogger, createAuditLogger } from '../audit-logger-impl';
import { FileStateController } from '../state-controller-impl';
import { FileOwnershipManager } from '../ownership-manager-impl';
import { ok, err } from '../state-controller';

// =============================================================================
// Mock Audit Logger for Testing
// =============================================================================

/**
 * Mock AuditLogger that records all logged entries for verification.
 */
class MockAuditLogger implements AuditLogger {
  public entries: AuditEntry[] = [];
  public logCalls: number = 0;
  public shouldFail: boolean = false;

  async log(entry: AuditEntry): Promise<LogResult> {
    this.logCalls++;
    if (this.shouldFail) {
      return err({
        code: 2501,
        category: 'AUDIT_ERROR',
        message: 'Mock log failure',
        recoverable: true,
        timestamp: new Date().toISOString(),
      });
    }
    this.entries.push(entry);
    return ok(undefined);
  }

  async getLogsForResource(
    resourceType: string,
    resourceId: string
  ): Promise<QueryResult> {
    return ok(this.entries.filter(
      e => e.resource_type === resourceType && e.resource_id === resourceId
    ));
  }

  async getLogsByCorrelation(correlationId: string): Promise<QueryResult> {
    return ok(this.entries.filter(e => e.correlation_id === correlationId));
  }

  async archiveLogs(before: Date): Promise<ArchiveLogResult> {
    return ok({
      archived: 0,
      archivedAt: new Date().toISOString(),
    });
  }

  clear(): void {
    this.entries = [];
    this.logCalls = 0;
    this.shouldFail = false;
  }
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('AuditLogger Integration', () => {
  let mockLogger: MockAuditLogger;
  let tempDir: string;

  beforeEach(async () => {
    mockLogger = new MockAuditLogger();
    // Create temp directory for state files
    tempDir = path.join(os.tmpdir(), `audit-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('StateController Integration', () => {
    it('should accept optional auditLogger in constructor', () => {
      const statePath = path.join(tempDir, 'project-state.yaml');
      
      // Without auditLogger - should not throw
      const controller1 = new FileStateController({ projectStatePath: statePath });
      expect(controller1).toBeDefined();
      
      // With auditLogger - should not throw
      const controller2 = new FileStateController(
        { projectStatePath: statePath },
        mockLogger
      );
      expect(controller2).toBeDefined();
    });

    it('should log STATE_CHANGE on successful write', async () => {
      const statePath = path.join(tempDir, 'project-state.yaml');
      
      // Create initial state file
      await fs.writeFile(statePath, `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2024-01-01T00:00:00Z"
last_modified_by: "test"
`, 'utf-8');

      const controller = new FileStateController(
        { projectStatePath: statePath, defaultActorId: 'test-actor' },
        mockLogger
      );

      // Read state
      const readResult = await controller.readState();
      expect(readResult.success).toBe(true);
      if (!readResult.success) return;

      // Update state
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'test update' }),
        'test-op-123',
        'Test update reason'
      );

      expect(result.success).toBe(true);
      
      // Wait a bit for async log to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Verify audit log was called
      expect(mockLogger.logCalls).toBeGreaterThan(0);
      
      // Verify entry content
      const stateChangeEntries = mockLogger.entries.filter(
        e => e.action === 'STATE_CHANGE'
      );
      expect(stateChangeEntries.length).toBeGreaterThan(0);
      expect(stateChangeEntries[0].resource_type).toBe('State');
      expect(stateChangeEntries[0].outcome).toBe('SUCCESS');
    });

    it('should work correctly without auditLogger', async () => {
      const statePath = path.join(tempDir, 'project-state-no-logger.yaml');
      
      // Create initial state file
      await fs.writeFile(statePath, `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2024-01-01T00:00:00Z"
last_modified_by: "test"
`, 'utf-8');

      // Create controller without auditLogger
      const controller = new FileStateController({ projectStatePath: statePath });

      // Update state should work without error
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'no logger test' }),
        'test-op-456',
        'Test without logger'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('OwnershipManager Integration', () => {
    it('should accept optional auditLogger in config', () => {
      const statePath = path.join(tempDir, 'ownership-state.yaml');
      const stateController = new FileStateController({ projectStatePath: statePath });
      
      // Without auditLogger
      const manager1 = new FileOwnershipManager({
        stateController,
      });
      expect(manager1).toBeDefined();
      
      // With auditLogger
      const manager2 = new FileOwnershipManager({
        stateController,
        auditLogger: mockLogger,
      });
      expect(manager2).toBeDefined();
    });

    it('should log OWNERSHIP_CLAIMED on successful claim', async () => {
      const statePath = path.join(tempDir, 'claim-state.yaml');
      
      // Create state file with a task that can be claimed
      await fs.writeFile(statePath, `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2024-01-01T00:00:00Z"
last_modified_by: "test"
current_task:
  id: "TASK-001"
  status: "ASSIGNED"
  assignee: null
  ownership: null
  dor_check: null
  tdd: null
  blocked: false
  blocked_reason: null
  blocker_refs: []
  handoff_pending: false
  handoff_id: null
  working_branch: null
`, 'utf-8');

      const stateController = new FileStateController({ projectStatePath: statePath });
      const manager = new FileOwnershipManager({
        stateController,
        auditLogger: mockLogger,
      });

      // Claim task
      const result = await manager.claimTask('TASK-001', 'dev-001', 'HUMAN');
      
      expect(result.success).toBe(true);
      
      // Wait a bit for async log
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Verify audit log
      const claimEntries = mockLogger.entries.filter(
        e => e.action === 'OWNERSHIP_CLAIMED'
      );
      expect(claimEntries.length).toBe(1);
      expect(claimEntries[0].resource_id).toBe('TASK-001');
      expect(claimEntries[0].actor_id).toBe('dev-001');
    });
  });

  describe('Fire-and-Forget Behavior', () => {
    it('should not block operation when audit log fails', async () => {
      const statePath = path.join(tempDir, 'fail-test-state.yaml');
      
      // Create initial state file
      await fs.writeFile(statePath, `
schema_version: "2"
workflow_version: "1.1.0"
state_version: 1
last_modified_at: "2024-01-01T00:00:00Z"
last_modified_by: "test"
`, 'utf-8');

      // Make mock logger fail
      mockLogger.shouldFail = true;

      const controller = new FileStateController(
        { projectStatePath: statePath },
        mockLogger
      );

      // State update should still succeed even when audit log fails
      const result = await controller.updateState(
        (state) => ({ ...state, last_action: 'test with failing logger' }),
        'test-op-fail',
        'Test with failing audit logger'
      );

      expect(result.success).toBe(true);
      
      // Wait a bit for async log attempt
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Verify log was attempted
      expect(mockLogger.logCalls).toBeGreaterThan(0);
    });
  });
});
