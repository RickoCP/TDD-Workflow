#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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
