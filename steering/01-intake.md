---
inclusion: auto
name: "SDLC Intake"
description: "Captures new ideas, features, or change requests and initializes SDLC workflow"
---

# SDLC Intake Phase

## Purpose

The INTAKE phase captures new ideas, features, bugs, or change requests and initializes the SDLC workflow for the project.

## When This Activates

- User says "start SDLC project", "init sdlc", "new feature", "bootstrap project"
- User describes a new idea or change request
- Beginning of any new development workflow

## Prerequisites

- None (this is the entry point)

## Phase Actions

### 1. Check for Existing SDLC State

First, check if SDLC is already initialized:

1. Look for `.kiro/sdlc/project-state.yaml`
2. If exists, read current state and suggest using `/resume` instead
3. If not exists, proceed with initialization

### 2. Capture the Idea

Gather from user:

- **Problem/Opportunity**: What problem are we solving or opportunity are we pursuing?
- **Proposed Solution**: High-level description of the proposed solution
- **Success Criteria**: How will we know this is successful?
- **Stakeholders**: Who is affected by or interested in this?
- **Scope Boundaries**: What is explicitly in/out of scope?
- **Constraints**: Any known constraints (time, technology, resources)?
- **Risks**: Any obvious risks?

### 3. Initialize SDLC Structure

Create the SDLC directory structure:

```
.kiro/sdlc/
  .config.yaml
  project-state.yaml
  traceability.yaml
  progress.md
  requirements/
  designs/
    adr/
  tasks/
  evidence/
  checkpoints/
  findings/
  changes/
  decisions/
  blockers/
  releases/
  audit.log
```

### 3.1 Setup Guard Script (Auto-Copy)

**IMPORTANT**: Copy the SDLC guard script to the project for TDD enforcement.

1. Create `scripts/` directory in project root if not exists
2. Copy `sdlc-guard.js` from Power to project:
   
   ```
   Project Root/
   └── scripts/
       └── sdlc-guard.js    <- Copy from Power
   ```

3. The guard script content to create at `scripts/sdlc-guard.js`:

```javascript
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
```

### 3.2 Setup SDLC Guard Hook

Create the hook file at `.kiro/hooks/sdlc-guard.json`:

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "SDLC Phase Guard",
      "trigger": "PreToolUse",
      "matcher": "fs_write|str_replace|edit_file|fs_append",
      "action": {
        "type": "command",
        "command": "node scripts/sdlc-guard.js"
      }
    }
  ]
}
```

**Note**: This hook ensures:
- No production code changes before PLANNING approval
- No implementation without failing tests (TDD RED phase)
- No code changes without an active task

### 4. Initialize Configuration

Create `.kiro/sdlc/.config.yaml` from template with:

- Project name and description from user input
- Default settings (tdd_enforcement: STRICT)
- Workflow version 1.0.0

### 5. Initialize Project State

Create `.kiro/sdlc/project-state.yaml` with:

- lifecycle.phase: INTAKE
- Empty counters for requirements, tasks
- First action recorded

### 6. Record Intake Decision

Create `decisions/DEC-001.md` documenting:

- The captured idea
- Initial scope decisions
- Any constraints identified

## Transition to DISCOVERY

After initialization:

1. Update project-state.yaml:
   - lifecycle.phase: DISCOVERY
   - last_action: "Intake complete, transitioning to Discovery"

2. Inform user:
   - SDLC initialized successfully
   - Next phase: DISCOVERY (repository analysis)
   - No code changes allowed until after PLANNING approval

## Guardrails

- NO code changes during INTAKE
- Must capture at minimum: problem statement and success criteria
- Must initialize all required SDLC directories

## Output

After INTAKE completes:

```yaml
lifecycle:
  phase: DISCOVERY
  last_transition_from: INTAKE
```
