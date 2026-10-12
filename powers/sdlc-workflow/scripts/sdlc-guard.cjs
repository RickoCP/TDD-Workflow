#!/usr/bin/env node
/**
 * SDLC Guard Hook
 * 
 * PreToolUse hook that enforces SDLC workflow rules:
 * - Phase guards for file modifications
 * - TDD enforcement (RED → GREEN → REFACTOR)
 * - Fencing token validation (R02.6)
 * - Lease expiry checks for AI agents (R02.8)
 * 
 * Requirements: R02.6, R02.8, R05
 */
const fs = require('fs');
const path = require('path');

// =============================================================================
// YAML Parser (Simple implementation for project-state.yaml)
// =============================================================================

function parseSimpleYaml(content) {
  const lines = content.split('\n');
  const result = {};
  const stack = [{ obj: result, indent: -1 }];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const current = stack[stack.length - 1].obj;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.substring(0, colonIndex).trim();
      const valueStr = trimmed.substring(colonIndex + 1).trim();
      if (valueStr === '' || valueStr === '|' || valueStr === '>') {
        current[key] = {};
        stack.push({ obj: current[key], indent: indent });
      } else {
        current[key] = parseYamlValue(valueStr);
      }
    }
  }
  return result;
}

function parseYamlValue(str) {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) return str.slice(1, -1);
  if (str === 'true' || str === 'yes' || str === 'on') return true;
  if (str === 'false' || str === 'no' || str === 'off') return false;
  if (str === 'null' || str === '~' || str === '') return null;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  return str;
}

// =============================================================================
// File Classification
// =============================================================================

const FILE_PATTERNS = {
  SDLC_METADATA: [/^\.kiro\/sdlc\//],
  TEST_CODE: [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /_test\.py$/, /test_.*\.py$/, /__tests__\//],
  TEST_FIXTURE: [/fixtures\//, /mocks\//, /__mocks__\//],
  DOCUMENTATION: [/\.md$/, /^docs\//],
  PRODUCTION_CODE: [/^src\//, /^lib\//, /^app\//, /\.[jt]sx?$/, /\.py$/]
};

function classifyFile(filePath) {
  const n = filePath.replace(/\\/g, '/');
  for (const [type, patterns] of Object.entries(FILE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(n) && type !== 'PRODUCTION_CODE') return type;
    }
  }
  if (/\.[jt]sx?$/.test(n) || /\.py$/.test(n)) return 'PRODUCTION_CODE';
  return 'UNKNOWN';
}

// =============================================================================
// State Management
// =============================================================================

function readState() {
  const statePath = path.join(process.cwd(), '.kiro', 'sdlc', 'project-state.yaml');
  if (!fs.existsSync(statePath)) return null;
  try { return parseSimpleYaml(fs.readFileSync(statePath, 'utf8')); } catch (e) { return null; }
}

function getVal(obj, p) { return p.split('.').reduce((o, k) => (o || {})[k], obj); }

// =============================================================================
// Fencing Token Validation (R02.6)
// =============================================================================

/**
 * Validates if a string is a valid UUID v4 format (fencing token format).
 * Requirements: R02.5, R02.6
 */
function isValidFencingToken(token) {
  if (typeof token !== 'string') return false;
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(token);
}

/**
 * Checks if an AI agent's lease has expired.
 * Requirements: R02.8
 * 
 * Lease is expired if:
 * - last_heartbeat_at + (grace_multiplier * heartbeat_interval_seconds) < current_time
 * 
 * @param {Object} ownership - The ownership object from state
 * @param {number} graceMultiplier - Grace period multiplier (default: 2)
 * @returns {boolean} True if lease is expired
 */
function isLeaseExpired(ownership, graceMultiplier = 2) {
  if (!ownership || ownership.actor_type !== 'AI_AGENT') {
    return false; // Humans don't have lease expiration
  }

  const lastHeartbeat = ownership.last_heartbeat_at;
  const heartbeatInterval = ownership.heartbeat_interval_seconds || getVal(ownership, 'heartbeat_interval_seconds') || 300;
  const leaseExpiresAt = ownership.lease_expires_at;

  // If no lease expires at, check using heartbeat-based calculation
  if (lastHeartbeat) {
    const lastHeartbeatTime = new Date(lastHeartbeat).getTime();
    const gracePeriodMs = heartbeatInterval * graceMultiplier * 1000;
    const now = Date.now();
    
    if (now > lastHeartbeatTime + gracePeriodMs) {
      return true;
    }
  }

  // Also check explicit lease_expires_at if available
  if (leaseExpiresAt) {
    const expiresAtTime = new Date(leaseExpiresAt).getTime();
    if (Date.now() > expiresAtTime) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates time remaining until lease expires (in seconds).
 * Requirements: R02.8
 * 
 * @param {Object} ownership - The ownership object from state
 * @returns {number|null} Seconds remaining, or null if not applicable
 */
function getLeaseTimeRemaining(ownership) {
  if (!ownership || ownership.actor_type !== 'AI_AGENT') {
    return null; // Humans don't have lease expiration
  }

  const leaseExpiresAt = ownership.lease_expires_at;
  if (!leaseExpiresAt) {
    return null;
  }

  const expiresAtTime = new Date(leaseExpiresAt).getTime();
  const remaining = Math.floor((expiresAtTime - Date.now()) / 1000);
  return Math.max(0, remaining);
}

/**
 * Validates the fencing token for the current task.
 * Requirements: R02.6
 * 
 * @param {Object} state - The project state
 * @param {string} providedToken - The fencing token from the operation context
 * @returns {Object} Validation result { valid, reason, warning, time_remaining_seconds }
 */
function validateOwnership(state, providedToken) {
  // If no provided token, ownership validation is not required (backward compatibility)
  if (!providedToken) {
    return { valid: true, reason: null };
  }

  // Validate token format
  if (!isValidFencingToken(providedToken)) {
    return { 
      valid: false, 
      reason: 'INVALID_FENCING_TOKEN: Token format is invalid (expected UUID v4)' 
    };
  }

  // Get current task ownership
  const ownership = getVal(state, 'current_task.ownership');
  if (!ownership) {
    // No ownership in state - allow if no token provided, reject if token provided
    // This is a strict check: if token is provided but task has no ownership, reject
    return { 
      valid: false, 
      reason: 'OWNERSHIP_NOT_FOUND: Task has no ownership record but token was provided' 
    };
  }

  const currentFencingToken = ownership.fencing_token;

  // Validate token matches
  if (currentFencingToken !== providedToken) {
    return { 
      valid: false, 
      reason: 'FENCING_TOKEN_MISMATCH: Provided token does not match current ownership. The task may have been reassigned.' 
    };
  }

  // For AI agents, check lease expiry
  if (ownership.actor_type === 'AI_AGENT') {
    if (isLeaseExpired(ownership)) {
      return { 
        valid: false, 
        reason: 'LEASE_EXPIRED: AI agent lease has expired. Re-claim the task or record a heartbeat.' 
      };
    }

    // Calculate time remaining and warning state
    const timeRemaining = getLeaseTimeRemaining(ownership);
    const heartbeatInterval = ownership.heartbeat_interval_seconds || 300;
    const isWarning = timeRemaining !== null && timeRemaining < heartbeatInterval;

    return { 
      valid: true, 
      warning: isWarning,
      time_remaining_seconds: timeRemaining,
      reason: isWarning ? 'LEASE_WARNING: Lease is close to expiry. Record a heartbeat soon.' : null
    };
  }

  // For humans, token is valid (no lease expiration)
  return { valid: true, reason: null, time_remaining_seconds: null, warning: false };
}

// =============================================================================
// Phase Guards
// =============================================================================

function checkPhaseGuard(state, targetFile) {
  const fileType = classifyFile(targetFile);
  const phase = getVal(state, 'lifecycle.phase');
  const tddPhase = getVal(state, 'current_task.tdd.phase');
  const taskId = getVal(state, 'current_task.id');
  const tddApplicable = getVal(state, 'current_task.tdd.applicable');

  if (fileType === 'SDLC_METADATA' || fileType === 'DOCUMENTATION' || fileType === 'TEST_FIXTURE') return { allowed: true };

  const preImpl = ['INTAKE', 'DISCOVERY', 'REQUIREMENTS', 'REQ_REVIEW', 'DESIGN', 'DESIGN_REVIEW', 'PLANNING', 'PLAN_REVIEW'];
  if (preImpl.includes(phase) && fileType === 'PRODUCTION_CODE') return { allowed: false, reason: 'PHASE GUARD: Cannot modify production code during ' + phase };

  if (phase === 'IMPLEMENTATION') {
    if (!taskId && fileType === 'PRODUCTION_CODE') return { allowed: false, reason: 'NO ACTIVE TASK: Select a task before modifying production code.' };
    if (tddApplicable !== false && (tddPhase === 'PENDING' || tddPhase === 'RED')) {
      if (fileType === 'PRODUCTION_CODE') return { allowed: false, reason: 'TDD GUARD: Write failing tests first. Phase: ' + (tddPhase || 'PENDING') };
      if (fileType === 'TEST_CODE') return { allowed: true };
    }
  }

  const restricted = ['VERIFICATION', 'RELEASE', 'RELEASED'];
  if (restricted.includes(phase) && fileType === 'PRODUCTION_CODE') return { allowed: false, reason: 'PHASE GUARD: Production code blocked during ' + phase };

  return { allowed: true };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Extracts fencing token from the hook context.
 * The token can be provided in several ways:
 * - ctx.fencing_token - Direct token in context
 * - ctx.arguments.fencing_token - Token in tool arguments
 * - ctx.metadata.fencing_token - Token in metadata
 * 
 * @param {Object} ctx - The hook context
 * @returns {string|null} The fencing token or null if not provided
 */
function extractFencingToken(ctx) {
  // Check direct context
  if (ctx.fencing_token) return ctx.fencing_token;
  
  // Check arguments
  if (ctx.arguments?.fencing_token) return ctx.arguments.fencing_token;
  
  // Check metadata
  if (ctx.metadata?.fencing_token) return ctx.metadata.fencing_token;
  
  // Check environment variable (for scripts/tools that set it)
  if (process.env.SDLC_FENCING_TOKEN) return process.env.SDLC_FENCING_TOKEN;
  
  return null;
}

/**
 * Determines if the operation is a write operation that requires ownership validation.
 * 
 * @param {Object} ctx - The hook context
 * @returns {boolean} True if operation is a write that requires validation
 */
function isWriteOperation(ctx) {
  // Tool names that perform write operations
  const writeTools = [
    'fs_write', 'str_replace', 'fs_append', 'delete_file',
    'write', 'edit', 'create', 'modify', 'update', 'delete'
  ];
  
  const toolName = ctx.tool || ctx.toolName || ctx.name || '';
  return writeTools.some(t => toolName.toLowerCase().includes(t));
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const ctx = JSON.parse(input);
    const targetFile = ctx.arguments?.path || ctx.path || '';
    if (!targetFile) process.exit(0);
    
    const state = readState();
    if (!state) process.exit(0);

    // Step 1: Validate fencing token for write operations (R02.6, R02.8)
    if (isWriteOperation(ctx)) {
      const providedToken = extractFencingToken(ctx);
      
      // Only validate if ownership exists in state (backward compatibility)
      // If state has ownership but no token provided, still allow for backward compatibility
      const ownership = getVal(state, 'current_task.ownership');
      
      if (ownership && ownership.fencing_token) {
        // Ownership exists - validate if token is provided
        if (providedToken) {
          const ownershipResult = validateOwnership(state, providedToken);
          
          if (!ownershipResult.valid) {
            process.stderr.write(ownershipResult.reason);
            process.exit(2);
          }
          
          // If warning (lease close to expiry), include in output but allow
          if (ownershipResult.warning && ownershipResult.reason) {
            // Output warning to stderr but continue
            process.stderr.write('WARNING: ' + ownershipResult.reason + '\n');
          }
        }
        // If ownership exists but no token provided, allow for backward compatibility
        // Future strict mode could reject here
      }
    }

    // Step 2: Check phase guards (existing TDD enforcement)
    const result = checkPhaseGuard(state, targetFile);
    if (result.allowed) process.exit(0);
    else { process.stderr.write(result.reason); process.exit(2); }
  } catch (e) { 
    // On error, allow operation (fail open for robustness)
    process.exit(0); 
  }
}

// Only run main() when executed directly (not when imported)
if (require.main === module) {
  main();
}

// =============================================================================
// Exports for testing
// =============================================================================

// Export functions for testing
module.exports = {
  parseSimpleYaml,
  parseYamlValue,
  classifyFile,
  isValidFencingToken,
  isLeaseExpired,
  getLeaseTimeRemaining,
  validateOwnership,
  checkPhaseGuard,
  extractFencingToken,
  isWriteOperation,
  getVal,
  FILE_PATTERNS
};
