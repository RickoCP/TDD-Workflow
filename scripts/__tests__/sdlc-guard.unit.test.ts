/**
 * SDLC Guard Unit Tests
 * 
 * Tests for the SDLC Guard hook that enforces:
 * - Phase guards for file modifications
 * - TDD enforcement
 * - Fencing token validation (R02.6)
 * - Lease expiry checks for AI agents (R02.8)
 * 
 * Requirements: R02.6, R02.8, R05
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the guard module functions
// Using dynamic import for CommonJS module in ESM context
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const guard = require('../sdlc-guard.cjs');

// =============================================================================
// Test: isValidFencingToken (R02.6)
// =============================================================================

describe('isValidFencingToken', () => {
  it('should return true for valid UUID v4 tokens', () => {
    expect(guard.isValidFencingToken('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(guard.isValidFencingToken('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(guard.isValidFencingToken('a1b2c3d4-e5f6-4789-abcd-ef1234567890')).toBe(true);
  });

  it('should return false for invalid tokens', () => {
    // Not a UUID
    expect(guard.isValidFencingToken('invalid-token')).toBe(false);
    expect(guard.isValidFencingToken('not-a-uuid-at-all')).toBe(false);
    
    // Wrong UUID version (not v4)
    expect(guard.isValidFencingToken('550e8400-e29b-11d4-a716-446655440000')).toBe(false); // v1
    expect(guard.isValidFencingToken('550e8400-e29b-31d4-a716-446655440000')).toBe(false); // v3
    
    // Wrong format
    expect(guard.isValidFencingToken('550e8400e29b41d4a716446655440000')).toBe(false); // no dashes
    expect(guard.isValidFencingToken('550e8400-e29b-41d4-a716-4466554400')).toBe(false); // too short
  });

  it('should return false for non-string values', () => {
    expect(guard.isValidFencingToken(null)).toBe(false);
    expect(guard.isValidFencingToken(undefined)).toBe(false);
    expect(guard.isValidFencingToken(123)).toBe(false);
    expect(guard.isValidFencingToken({})).toBe(false);
    expect(guard.isValidFencingToken([])).toBe(false);
  });
});

// =============================================================================
// Test: isLeaseExpired (R02.8)
// =============================================================================

describe('isLeaseExpired', () => {
  it('should return false for human actors (no lease expiration)', () => {
    const ownership = {
      actor_type: 'HUMAN',
      fencing_token: '550e8400-e29b-41d4-a716-446655440000',
      acquired_at: new Date().toISOString(),
      lease_expires_at: null,
      last_heartbeat_at: null,
    };
    
    expect(guard.isLeaseExpired(ownership)).toBe(false);
  });

  it('should return false for AI agent with valid lease', () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000); // 1 hour from now
    
    const ownership = {
      actor_type: 'AI_AGENT',
      fencing_token: '550e8400-e29b-41d4-a716-446655440000',
      acquired_at: now.toISOString(),
      lease_expires_at: expiresAt.toISOString(),
      last_heartbeat_at: now.toISOString(),
      heartbeat_interval_seconds: 300,
    };
    
    expect(guard.isLeaseExpired(ownership)).toBe(false);
  });

  it('should return true for AI agent with expired lease', () => {
    const now = new Date();
    const expiredAt = new Date(now.getTime() - 1000); // 1 second ago
    const lastHeartbeat = new Date(now.getTime() - 700000); // 700 seconds ago (> 2 * 300)
    
    const ownership = {
      actor_type: 'AI_AGENT',
      fencing_token: '550e8400-e29b-41d4-a716-446655440000',
      acquired_at: new Date(now.getTime() - 3600000).toISOString(),
      lease_expires_at: expiredAt.toISOString(),
      last_heartbeat_at: lastHeartbeat.toISOString(),
      heartbeat_interval_seconds: 300,
    };
    
    expect(guard.isLeaseExpired(ownership)).toBe(true);
  });

  it('should return true for AI agent with heartbeat timeout', () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000); // lease not expired
    // But heartbeat is too old (> 2 * interval)
    const lastHeartbeat = new Date(now.getTime() - 700000); // 700 seconds ago
    
    const ownership = {
      actor_type: 'AI_AGENT',
      fencing_token: '550e8400-e29b-41d4-a716-446655440000',
      acquired_at: new Date(now.getTime() - 3600000).toISOString(),
      lease_expires_at: expiresAt.toISOString(),
      last_heartbeat_at: lastHeartbeat.toISOString(),
      heartbeat_interval_seconds: 300, // 2 * 300 = 600 seconds grace
    };
    
    expect(guard.isLeaseExpired(ownership, 2)).toBe(true);
  });

  it('should return false for null/undefined ownership', () => {
    expect(guard.isLeaseExpired(null)).toBe(false);
    expect(guard.isLeaseExpired(undefined)).toBe(false);
  });
});

// =============================================================================
// Test: getLeaseTimeRemaining (R02.8)
// =============================================================================

describe('getLeaseTimeRemaining', () => {
  it('should return null for human actors', () => {
    const ownership = {
      actor_type: 'HUMAN',
      fencing_token: '550e8400-e29b-41d4-a716-446655440000',
      lease_expires_at: null,
    };
    
    expect(guard.getLeaseTimeRemaining(ownership)).toBeNull();
  });

  it('should return positive seconds for AI agent with valid lease', () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1800000); // 30 minutes = 1800 seconds
    
    const ownership = {
      actor_type: 'AI_AGENT',
      fencing_token: '550e8400-e29b-41d4-a716-446655440000',
      lease_expires_at: expiresAt.toISOString(),
    };
    
    const remaining = guard.getLeaseTimeRemaining(ownership);
    expect(remaining).toBeGreaterThan(1700); // At least ~1700 seconds
    expect(remaining).toBeLessThanOrEqual(1800);
  });

  it('should return 0 for expired lease', () => {
    const now = new Date();
    const expiredAt = new Date(now.getTime() - 1000); // 1 second ago
    
    const ownership = {
      actor_type: 'AI_AGENT',
      fencing_token: '550e8400-e29b-41d4-a716-446655440000',
      lease_expires_at: expiredAt.toISOString(),
    };
    
    expect(guard.getLeaseTimeRemaining(ownership)).toBe(0);
  });

  it('should return null for AI agent without lease_expires_at', () => {
    const ownership = {
      actor_type: 'AI_AGENT',
      fencing_token: '550e8400-e29b-41d4-a716-446655440000',
      lease_expires_at: null,
    };
    
    expect(guard.getLeaseTimeRemaining(ownership)).toBeNull();
  });
});

// =============================================================================
// Test: validateOwnership (R02.6)
// =============================================================================

describe('validateOwnership', () => {
  it('should return valid for null/no token (backward compatibility)', () => {
    const state = {
      current_task: {
        ownership: {
          fencing_token: '550e8400-e29b-41d4-a716-446655440000',
          actor_type: 'HUMAN',
        },
      },
    };
    
    const result = guard.validateOwnership(state, null);
    expect(result.valid).toBe(true);
  });

  it('should return invalid for malformed token', () => {
    const state = {
      current_task: {
        ownership: {
          fencing_token: '550e8400-e29b-41d4-a716-446655440000',
          actor_type: 'HUMAN',
        },
      },
    };
    
    const result = guard.validateOwnership(state, 'not-a-valid-uuid');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('INVALID_FENCING_TOKEN');
  });

  it('should return invalid when ownership not found but token provided', () => {
    const state = {
      current_task: {
        id: 'TASK-001',
        // No ownership
      },
    };
    
    const result = guard.validateOwnership(state, '550e8400-e29b-41d4-a716-446655440000');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('OWNERSHIP_NOT_FOUND');
  });

  it('should return invalid for token mismatch', () => {
    const state = {
      current_task: {
        ownership: {
          fencing_token: '550e8400-e29b-41d4-a716-446655440000',
          actor_type: 'HUMAN',
        },
      },
    };
    
    const result = guard.validateOwnership(state, 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('FENCING_TOKEN_MISMATCH');
  });

  it('should return valid for matching human token', () => {
    const token = '550e8400-e29b-41d4-a716-446655440000';
    const state = {
      current_task: {
        ownership: {
          fencing_token: token,
          actor_type: 'HUMAN',
          acquired_at: new Date().toISOString(),
        },
      },
    };
    
    const result = guard.validateOwnership(state, token);
    expect(result.valid).toBe(true);
    expect(result.time_remaining_seconds).toBeNull();
    expect(result.warning).toBe(false);
  });

  it('should return valid for matching AI agent token with valid lease', () => {
    const token = '550e8400-e29b-41d4-a716-446655440000';
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000); // 1 hour
    
    const state = {
      current_task: {
        ownership: {
          fencing_token: token,
          actor_type: 'AI_AGENT',
          acquired_at: now.toISOString(),
          lease_expires_at: expiresAt.toISOString(),
          last_heartbeat_at: now.toISOString(),
          heartbeat_interval_seconds: 300,
        },
      },
    };
    
    const result = guard.validateOwnership(state, token);
    expect(result.valid).toBe(true);
    expect(result.time_remaining_seconds).toBeGreaterThan(3500);
    expect(result.warning).toBe(false);
  });

  it('should return invalid for AI agent with expired lease', () => {
    const token = '550e8400-e29b-41d4-a716-446655440000';
    const now = new Date();
    const expiredAt = new Date(now.getTime() - 1000); // 1 second ago
    const lastHeartbeat = new Date(now.getTime() - 700000); // Way past grace period
    
    const state = {
      current_task: {
        ownership: {
          fencing_token: token,
          actor_type: 'AI_AGENT',
          acquired_at: new Date(now.getTime() - 3600000).toISOString(),
          lease_expires_at: expiredAt.toISOString(),
          last_heartbeat_at: lastHeartbeat.toISOString(),
          heartbeat_interval_seconds: 300,
        },
      },
    };
    
    const result = guard.validateOwnership(state, token);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('LEASE_EXPIRED');
  });

  it('should return warning for AI agent lease close to expiry', () => {
    const token = '550e8400-e29b-41d4-a716-446655440000';
    const now = new Date();
    // Lease expires in 100 seconds (less than heartbeat interval of 300)
    const expiresAt = new Date(now.getTime() + 100000);
    
    const state = {
      current_task: {
        ownership: {
          fencing_token: token,
          actor_type: 'AI_AGENT',
          acquired_at: new Date(now.getTime() - 3500000).toISOString(),
          lease_expires_at: expiresAt.toISOString(),
          last_heartbeat_at: now.toISOString(),
          heartbeat_interval_seconds: 300,
        },
      },
    };
    
    const result = guard.validateOwnership(state, token);
    expect(result.valid).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.reason).toContain('LEASE_WARNING');
  });
});

// =============================================================================
// Test: extractFencingToken
// =============================================================================

describe('extractFencingToken', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SDLC_FENCING_TOKEN;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should extract token from ctx.fencing_token', () => {
    const ctx = { fencing_token: 'token-from-context' };
    expect(guard.extractFencingToken(ctx)).toBe('token-from-context');
  });

  it('should extract token from ctx.arguments.fencing_token', () => {
    const ctx = { arguments: { fencing_token: 'token-from-arguments' } };
    expect(guard.extractFencingToken(ctx)).toBe('token-from-arguments');
  });

  it('should extract token from ctx.metadata.fencing_token', () => {
    const ctx = { metadata: { fencing_token: 'token-from-metadata' } };
    expect(guard.extractFencingToken(ctx)).toBe('token-from-metadata');
  });

  it('should extract token from environment variable', () => {
    process.env.SDLC_FENCING_TOKEN = 'token-from-env';
    const ctx = {};
    expect(guard.extractFencingToken(ctx)).toBe('token-from-env');
  });

  it('should return null when no token is provided', () => {
    const ctx = {};
    expect(guard.extractFencingToken(ctx)).toBeNull();
  });

  it('should prefer direct context over arguments', () => {
    const ctx = { 
      fencing_token: 'direct-token',
      arguments: { fencing_token: 'arguments-token' }
    };
    expect(guard.extractFencingToken(ctx)).toBe('direct-token');
  });
});

// =============================================================================
// Test: isWriteOperation
// =============================================================================

describe('isWriteOperation', () => {
  it('should return true for fs_write tool', () => {
    expect(guard.isWriteOperation({ tool: 'fs_write' })).toBe(true);
    expect(guard.isWriteOperation({ toolName: 'fs_write' })).toBe(true);
  });

  it('should return true for str_replace tool', () => {
    expect(guard.isWriteOperation({ tool: 'str_replace' })).toBe(true);
  });

  it('should return true for fs_append tool', () => {
    expect(guard.isWriteOperation({ tool: 'fs_append' })).toBe(true);
  });

  it('should return true for delete_file tool', () => {
    expect(guard.isWriteOperation({ tool: 'delete_file' })).toBe(true);
  });

  it('should return false for read-only operations', () => {
    expect(guard.isWriteOperation({ tool: 'read_file' })).toBe(false);
    expect(guard.isWriteOperation({ tool: 'grep_search' })).toBe(false);
    expect(guard.isWriteOperation({ tool: 'file_search' })).toBe(false);
    expect(guard.isWriteOperation({ tool: 'list_directory' })).toBe(false);
  });

  it('should return true for generic write/edit/create/modify/update/delete tools', () => {
    expect(guard.isWriteOperation({ tool: 'write_code' })).toBe(true);
    expect(guard.isWriteOperation({ tool: 'edit_file' })).toBe(true);
    expect(guard.isWriteOperation({ tool: 'create_component' })).toBe(true);
    expect(guard.isWriteOperation({ tool: 'modify_config' })).toBe(true);
    expect(guard.isWriteOperation({ tool: 'update_schema' })).toBe(true);
    expect(guard.isWriteOperation({ tool: 'delete_record' })).toBe(true);
  });

  it('should handle case insensitivity', () => {
    expect(guard.isWriteOperation({ tool: 'FS_WRITE' })).toBe(true);
    expect(guard.isWriteOperation({ tool: 'Str_Replace' })).toBe(true);
  });
});

// =============================================================================
// Test: classifyFile
// =============================================================================

describe('classifyFile', () => {
  it('should classify test files correctly', () => {
    expect(guard.classifyFile('src/auth.test.ts')).toBe('TEST_CODE');
    expect(guard.classifyFile('src/auth.spec.js')).toBe('TEST_CODE');
    expect(guard.classifyFile('tests/test_auth.py')).toBe('TEST_CODE');
    expect(guard.classifyFile('src/__tests__/auth.ts')).toBe('TEST_CODE');
  });

  it('should classify production code correctly', () => {
    expect(guard.classifyFile('src/auth.ts')).toBe('PRODUCTION_CODE');
    expect(guard.classifyFile('lib/utils.js')).toBe('PRODUCTION_CODE');
    expect(guard.classifyFile('app/main.py')).toBe('PRODUCTION_CODE');
  });

  it('should classify documentation correctly', () => {
    expect(guard.classifyFile('README.md')).toBe('DOCUMENTATION');
    expect(guard.classifyFile('docs/api.md')).toBe('DOCUMENTATION');
  });

  it('should classify SDLC metadata correctly', () => {
    expect(guard.classifyFile('.kiro/sdlc/project-state.yaml')).toBe('SDLC_METADATA');
    expect(guard.classifyFile('.kiro/sdlc/tasks/TASK-001.md')).toBe('SDLC_METADATA');
  });

  it('should classify test fixtures correctly', () => {
    expect(guard.classifyFile('tests/fixtures/data.json')).toBe('TEST_FIXTURE');
    expect(guard.classifyFile('src/__mocks__/api.ts')).toBe('TEST_FIXTURE');
  });

  it('should handle Windows-style paths', () => {
    expect(guard.classifyFile('src\\auth.test.ts')).toBe('TEST_CODE');
    expect(guard.classifyFile('.kiro\\sdlc\\state.yaml')).toBe('SDLC_METADATA');
  });
});

// =============================================================================
// Test: checkPhaseGuard (existing TDD enforcement)
// =============================================================================

describe('checkPhaseGuard', () => {
  it('should allow SDLC metadata edits in any phase', () => {
    const state = { lifecycle: { phase: 'REQUIREMENTS' } };
    const result = guard.checkPhaseGuard(state, '.kiro/sdlc/project-state.yaml');
    expect(result.allowed).toBe(true);
  });

  it('should allow documentation edits in any phase', () => {
    const state = { lifecycle: { phase: 'DESIGN' } };
    const result = guard.checkPhaseGuard(state, 'docs/api.md');
    expect(result.allowed).toBe(true);
  });

  it('should block production code during pre-implementation phases', () => {
    const phases = ['INTAKE', 'DISCOVERY', 'REQUIREMENTS', 'DESIGN', 'PLANNING'];
    for (const phase of phases) {
      const state = { lifecycle: { phase } };
      const result = guard.checkPhaseGuard(state, 'src/auth.ts');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('PHASE GUARD');
    }
  });

  it('should block production code in RED phase (TDD)', () => {
    const state = {
      lifecycle: { phase: 'IMPLEMENTATION' },
      current_task: {
        id: 'TASK-001',
        tdd: { phase: 'RED' },
      },
    };
    const result = guard.checkPhaseGuard(state, 'src/auth.ts');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('TDD GUARD');
  });

  it('should allow test code in RED phase (TDD)', () => {
    const state = {
      lifecycle: { phase: 'IMPLEMENTATION' },
      current_task: {
        id: 'TASK-001',
        tdd: { phase: 'RED' },
      },
    };
    const result = guard.checkPhaseGuard(state, 'src/auth.test.ts');
    expect(result.allowed).toBe(true);
  });

  it('should allow production code in GREEN phase (TDD)', () => {
    const state = {
      lifecycle: { phase: 'IMPLEMENTATION' },
      current_task: {
        id: 'TASK-001',
        tdd: { phase: 'GREEN' },
      },
    };
    const result = guard.checkPhaseGuard(state, 'src/auth.ts');
    expect(result.allowed).toBe(true);
  });

  it('should skip TDD check when tdd_applicable is false', () => {
    const state = {
      lifecycle: { phase: 'IMPLEMENTATION' },
      current_task: {
        id: 'TASK-001',
        tdd: { applicable: false, phase: 'PENDING' },
      },
    };
    const result = guard.checkPhaseGuard(state, 'src/config.json');
    expect(result.allowed).toBe(true);
  });

  it('should block production code during VERIFICATION', () => {
    const state = { lifecycle: { phase: 'VERIFICATION' } };
    const result = guard.checkPhaseGuard(state, 'src/auth.ts');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('PHASE GUARD');
  });

  it('should block production code during RELEASE', () => {
    const state = { lifecycle: { phase: 'RELEASE' } };
    const result = guard.checkPhaseGuard(state, 'src/auth.ts');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('PHASE GUARD');
  });

  it('should block production code when no active task', () => {
    const state = {
      lifecycle: { phase: 'IMPLEMENTATION' },
      current_task: {}, // No task ID
    };
    const result = guard.checkPhaseGuard(state, 'src/auth.ts');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('NO ACTIVE TASK');
  });
});

// =============================================================================
// Test: getVal helper
// =============================================================================

describe('getVal', () => {
  it('should get nested values', () => {
    const obj = {
      a: {
        b: {
          c: 'value',
        },
      },
    };
    expect(guard.getVal(obj, 'a.b.c')).toBe('value');
  });

  it('should return undefined for non-existent paths', () => {
    const obj = { a: { b: 1 } };
    expect(guard.getVal(obj, 'a.b.c')).toBeUndefined();
    expect(guard.getVal(obj, 'x.y.z')).toBeUndefined();
  });

  it('should handle null/undefined objects', () => {
    expect(guard.getVal(null, 'a.b')).toBeUndefined();
    expect(guard.getVal(undefined, 'a.b')).toBeUndefined();
  });
});
