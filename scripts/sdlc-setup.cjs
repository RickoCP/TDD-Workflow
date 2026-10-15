#!/usr/bin/env node
/**
 * SDLC Workflow Setup Script
 * 
 * Portable setup script that initializes SDLC workflow in any project.
 * Creates directory structure, copies guard script, and sets up hooks.
 * 
 * Usage:
 *   node sdlc-setup.cjs [project-root]
 * 
 * If project-root is not specified, uses current working directory.
 * 
 * Cross-platform: Works on Windows, Linux, and macOS.
 * Uses CommonJS (.cjs) for maximum compatibility across project types.
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Configuration
// =============================================================================

const SDLC_DIRECTORIES = [
  '.kiro/sdlc',
  '.kiro/sdlc/requirements',
  '.kiro/sdlc/designs',
  '.kiro/sdlc/designs/adr',
  '.kiro/sdlc/tasks',
  '.kiro/sdlc/evidence',
  '.kiro/sdlc/checkpoints',
  '.kiro/sdlc/findings',
  '.kiro/sdlc/changes',
  '.kiro/sdlc/decisions',
  '.kiro/sdlc/blockers',
  '.kiro/sdlc/releases',
  '.kiro/hooks',
  'scripts'
];

// =============================================================================
// Guard Script Content (embedded for portability)
// Uses .cjs extension for CommonJS compatibility
// =============================================================================

const GUARD_SCRIPT_CONTENT = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseSimpleYaml(content) {
  const lines = content.split('\\n');
  const result = {};
  const stack = [{ obj: result, indent: -1 }];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.search(/\\S/);
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
  if (/^-?\\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\\d+\\.\\d+$/.test(str)) return parseFloat(str);
  return str;
}

const FILE_PATTERNS = {
  SDLC_METADATA: [/^\\.kiro\\/sdlc\\//],
  TEST_CODE: [/\\.test\\.[jt]sx?$/, /\\.spec\\.[jt]sx?$/, /_test\\.py$/, /test_.*\\.py$/, /__tests__\\//],
  TEST_FIXTURE: [/fixtures\\//, /mocks\\//, /__mocks__\\//],
  DOCUMENTATION: [/\\.md$/, /^docs\\//],
  PRODUCTION_CODE: [/^src\\//, /^lib\\//, /^app\\//, /\\.[jt]sx?$/, /\\.py$/]
};

function classifyFile(filePath) {
  const n = filePath.replace(/\\\\/g, '/');
  for (const [type, patterns] of Object.entries(FILE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(n) && type !== 'PRODUCTION_CODE') return type;
    }
  }
  if (/\\.[jt]sx?$/.test(n) || /\\.py$/.test(n)) return 'PRODUCTION_CODE';
  return 'UNKNOWN';
}

function readState() {
  const statePath = path.join(process.cwd(), '.kiro', 'sdlc', 'project-state.yaml');
  if (!fs.existsSync(statePath)) return null;
  try { return parseSimpleYaml(fs.readFileSync(statePath, 'utf8')); } catch (e) { return null; }
}

function getVal(obj, p) { return p.split('.').reduce((o, k) => (o || {})[k], obj); }

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

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const ctx = JSON.parse(input);
    const targetFile = ctx.arguments?.path || ctx.path || '';
    if (!targetFile) process.exit(0);
    const state = readState();
    if (!state) process.exit(0);
    const result = checkPhaseGuard(state, targetFile);
    if (result.allowed) process.exit(0);
    else { process.stderr.write(result.reason); process.exit(2); }
  } catch (e) { process.exit(0); }
}
main();
`;

// =============================================================================
// Hook Configuration
// =============================================================================

const HOOK_CONFIG = {
  "version": "v1",
  "hooks": [
    {
      "name": "SDLC Phase Guard",
      "trigger": "PreToolUse",
      "matcher": "fs_write|str_replace|edit_file|fs_append",
      "action": {
        "type": "command",
        "command": "node scripts/sdlc-guard.cjs"
      }
    }
  ]
};

// =============================================================================
// Utility Functions
// =============================================================================

function log(message, type = 'info') {
  const prefix = {
    'info': '  ',
    'success': '✓ ',
    'error': '✗ ',
    'warn': '⚠ ',
    'step': '→ '
  };
  console.log(`${prefix[type] || '  '}${message}`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  }
  return false;
}

function writeFileIfNotExists(filePath, content, overwrite = false) {
  if (!fs.existsSync(filePath) || overwrite) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

// =============================================================================
// Setup Functions
// =============================================================================

function createDirectories(projectRoot) {
  log('Creating SDLC directory structure...', 'step');
  
  let created = 0;
  for (const dir of SDLC_DIRECTORIES) {
    const fullPath = path.join(projectRoot, dir);
    if (ensureDir(fullPath)) {
      log(`Created: ${dir}`, 'success');
      created++;
    } else {
      log(`Exists: ${dir}`, 'info');
    }
  }
  
  return created;
}

function setupGuardScript(projectRoot) {
  log('Setting up guard script...', 'step');
  
  const guardPath = path.join(projectRoot, 'scripts', 'sdlc-guard.cjs');
  
  if (writeFileIfNotExists(guardPath, GUARD_SCRIPT_CONTENT)) {
    log(`Created: scripts/sdlc-guard.cjs`, 'success');
    return true;
  } else {
    log(`Guard script already exists at scripts/sdlc-guard.cjs`, 'info');
    return false;
  }
}

function setupHook(projectRoot) {
  log('Setting up SDLC hook...', 'step');
  
  const hookPath = path.join(projectRoot, '.kiro', 'hooks', 'sdlc-guard.json');
  const hookContent = JSON.stringify(HOOK_CONFIG, null, 2);
  
  if (writeFileIfNotExists(hookPath, hookContent)) {
    log(`Created: .kiro/hooks/sdlc-guard.json`, 'success');
    return true;
  } else {
    log(`Hook already exists at .kiro/hooks/sdlc-guard.json`, 'info');
    return false;
  }
}

function createGitkeepFiles(projectRoot) {
  log('Creating .gitkeep files for empty directories...', 'step');
  
  const emptyDirs = [
    '.kiro/sdlc/requirements',
    '.kiro/sdlc/designs/adr',
    '.kiro/sdlc/tasks',
    '.kiro/sdlc/evidence',
    '.kiro/sdlc/checkpoints',
    '.kiro/sdlc/findings',
    '.kiro/sdlc/changes',
    '.kiro/sdlc/decisions',
    '.kiro/sdlc/blockers',
    '.kiro/sdlc/releases'
  ];
  
  for (const dir of emptyDirs) {
    const gitkeepPath = path.join(projectRoot, dir, '.gitkeep');
    writeFileIfNotExists(gitkeepPath, '');
  }
  
  log('Created .gitkeep files', 'success');
}

function printSummary(projectRoot) {
  console.log('\n' + '='.repeat(60));
  console.log('SDLC Workflow Setup Complete!');
  console.log('='.repeat(60));
  console.log(`\nProject: ${projectRoot}`);
  console.log('\nStructure created:');
  console.log(`  ${projectRoot}/`);
  console.log('  ├── .kiro/');
  console.log('  │   ├── hooks/');
  console.log('  │   │   └── sdlc-guard.json');
  console.log('  │   └── sdlc/');
  console.log('  │       ├── requirements/');
  console.log('  │       ├── designs/');
  console.log('  │       ├── tasks/');
  console.log('  │       ├── evidence/');
  console.log('  │       ├── checkpoints/');
  console.log('  │       ├── findings/');
  console.log('  │       └── ...');
  console.log('  └── scripts/');
  console.log('      └── sdlc-guard.cjs');
  console.log('\n' + '-'.repeat(60));
  console.log('Next steps:');
  console.log('  1. Say "start SDLC project" to initialize workflow state');
  console.log('  2. Follow the INTAKE phase to capture your idea');
  console.log('  3. Progress through lifecycle phases with guidance');
  console.log('-'.repeat(60) + '\n');
}

// =============================================================================
// Main
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  const projectRoot = args[0] ? path.resolve(args[0]) : process.cwd();
  
  console.log('\n' + '='.repeat(60));
  console.log('SDLC Workflow - Project Setup');
  console.log('='.repeat(60) + '\n');
  
  log(`Project root: ${projectRoot}`, 'info');
  console.log('');
  
  // Validate project root exists
  if (!fs.existsSync(projectRoot)) {
    log(`Project root does not exist: ${projectRoot}`, 'error');
    process.exit(1);
  }
  
  try {
    // Step 1: Create directories
    createDirectories(projectRoot);
    console.log('');
    
    // Step 2: Setup guard script
    setupGuardScript(projectRoot);
    console.log('');
    
    // Step 3: Setup hook
    setupHook(projectRoot);
    console.log('');
    
    // Step 4: Create .gitkeep files
    createGitkeepFiles(projectRoot);
    
    // Print summary
    printSummary(projectRoot);
    
    process.exit(0);
  } catch (error) {
    log(`Setup failed: ${error.message}`, 'error');
    process.exit(1);
  }
}

main();
