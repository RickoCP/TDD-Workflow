# SDLC Workflow Power - Documentation

## Overview

SDLC Workflow Power adalah Kiro Power yang menyediakan framework Software Development Lifecycle (SDLC) yang komprehensif, auditable, dan recoverable. Power ini menerapkan metodologi Test-Driven Development (TDD) dengan guardrails otomatis untuk memastikan kualitas dan konsistensi pengembangan software.

## Filosofi

### Prinsip Utama

**DO NOT OPTIMIZE FOR "FINISHING THE TASK"**

**OPTIMIZE FOR:**
- **CORRECTNESS** - Kode yang benar lebih penting dari kode yang cepat selesai
- **TRACEABILITY** - Setiap perubahan dapat dilacak ke requirement asalnya
- **REPRODUCIBILITY** - Hasil dapat direproduksi kapan saja
- **RECOVERABILITY** - Session dapat dilanjutkan setelah interupsi
- **TESTABILITY** - Semua fitur harus dapat ditest
- **SAFETY** - Guardrails mencegah kesalahan umum
- **MAINTAINABILITY** - Kode mudah dipahami dan dimodifikasi

### Hard Guardrails

| Rule | Meaning |
|------|---------|
| NO REQUIREMENT -> NO DESIGN | Tidak boleh mendesain tanpa requirement |
| NO APPROVED DESIGN -> NO PLAN | Tidak boleh planning tanpa design yang disetujui |
| NO TASK -> NO CODE | Tidak boleh coding tanpa task yang aktif |
| NO RED -> NO GREEN | Tidak boleh implementasi tanpa failing test |
| NO GREEN -> NO REFACTOR | Tidak boleh refactor tanpa passing test |
| NO VERIFY -> NO DONE | Tidak boleh selesai tanpa verifikasi |

## Lifecycle Phases

`
INTAKE -> DISCOVERY -> REQUIREMENTS -> REQ_REVIEW [HUMAN]
    -> DESIGN -> DESIGN_REVIEW [HUMAN]
    -> PLANNING -> PLAN_REVIEW [HUMAN]
    -> IMPLEMENTATION (TDD)
    -> INTEGRATION -> QA -> SECURITY -> PERFORMANCE
    -> RELEASE_READINESS [HUMAN] -> STAGING -> PRODUCTION [HUMAN]
    -> POST_RELEASE -> MONITORING -> MAINTENANCE
`

### Phase Descriptions

| Phase | Purpose | Output |
|-------|---------|--------|
| INTAKE | Capture idea/change request | Initial description |
| DISCOVERY | Analyze repository | Tech stack, patterns |
| REQUIREMENTS | Define WHAT to build | REQ-xxx.md files |
| REQ_REVIEW | Human approval | Approved requirements |
| DESIGN | Define HOW to build | DESIGN-xxx.md, ADRs |
| DESIGN_REVIEW | Human approval | Approved design |
| PLANNING | Break into tasks | TASK-xxx.md files |
| PLAN_REVIEW | Human approval | Approved task list |
| IMPLEMENTATION | Build with TDD | Code + tests |
| INTEGRATION | Combine components | Integrated system |
| QA | Quality assurance | Test results |
| SECURITY | Security review | Security report |
| PERFORMANCE | Performance testing | Perf metrics |
| RELEASE_READINESS | Pre-release check | Release checklist |
| STAGING | Staging deployment | Staging verification |
| PRODUCTION | Production release | Live system |
| POST_RELEASE | Verify in production | Validation report |
| MONITORING | Watch for issues | Monitoring alerts |
| MAINTENANCE | Ongoing support | Bug fixes, updates |

## TDD Cycle

`
PENDING -> RED -> GREEN -> REFACTOR -> VERIFY -> COMPLETE
`

### TDD Phase Rules

| Phase | What to Do | File Types Allowed |
|-------|------------|-------------------|
| PENDING | Select task, prepare | SDLC metadata, docs |
| RED | Write FAILING test | Test files only |
| GREEN | Minimum code to pass | Production + test |
| REFACTOR | Improve code quality | Production + test |
| VERIFY | Confirm all tests pass | Evidence files |
| COMPLETE | Mark task done | SDLC metadata |

### Critical TDD Rules

1. **RED Phase**: Test MUST fail
   - If test passes unexpectedly: STOP and investigate
   - Do not proceed to GREEN without confirmed failure

2. **GREEN Phase**: Minimum implementation
   - Write only enough code to make test pass
   - No premature optimization

3. **REFACTOR Phase**: Improve quality
   - Tests must still pass after refactoring
   - No new functionality

4. **VERIFY Phase**: Final confirmation
   - Run full test suite
   - Record evidence with git ref

## Project Structure

`
.kiro/sdlc/
├── .config.yaml           # Workflow configuration
├── project-state.yaml     # Runtime state (authoritative)
├── traceability.yaml      # Cross-references (authoritative)
├── progress.md            # Human-readable summary (derived)
├── requirements/          # REQ-xxx.md files
├── designs/               # DESIGN-xxx.md + adr/
├── tasks/                 # TASK-xxx.md files
├── evidence/              # TDD evidence per task
├── changes/               # CR-xxx change requests
├── decisions/             # DEC-xxx decisions
├── blockers/              # BLOCKER-xxx issues
└── releases/              # Release artifacts
`

## State Management

### Source of Truth Precedence

1. **Repository reality / test results** (HIGHEST)
2. **Git state/history**
3. **Authoritative artifacts** (REQ, DESIGN, TASK)
4. **project-state.yaml**
5. **traceability.yaml**
6. **Derived docs** (progress.md, index.md)
7. **Conversation context** (LOWEST)

### State File Format

**project-state.yaml:**
`yaml
workflow_version: "1.0.0"
schema_version: "1"

project:
  name: "my-project"
  initialized_at: "2024-01-15T10:00:00Z"
  
lifecycle:
  phase: IMPLEMENTATION
  phase_started_at: "2024-01-15T14:00:00Z"
  
current_task:
  id: TASK-001
  title: "Implement user authentication"
  tdd:
    phase: GREEN
    applicable: true
    
counters:
  requirements: 5
  designs: 2
  tasks: 12
  
approvals:
  - gate: REQ_REVIEW
    approver: "john@example.com"
    timestamp: "2024-01-15T12:00:00Z"
    outcome: APPROVED
`

## Human Approval Gates

| Gate | Transition | Purpose |
|------|------------|---------|
| REQ_REVIEW | REQUIREMENTS -> DESIGN | Validate requirements complete |
| DESIGN_REVIEW | DESIGN -> PLANNING | Validate architecture sound |
| PLAN_REVIEW | PLANNING -> IMPLEMENTATION | Confirm task scope |
| RELEASE_READINESS | QA -> STAGING | Quality gate before release |
| PRODUCTION | STAGING -> PRODUCTION | Final authorization |

### Approval Record Format

`yaml
approvals:
  - gate: REQ_REVIEW
    approver: "email@domain.com"
    timestamp: "ISO-8601 timestamp"
    outcome: APPROVED | REJECTED | SKIPPED
    notes: "Optional comments"
`

## Guard Script

### File Classification

| Type | Pattern | Description |
|------|---------|-------------|
| SDLC_METADATA | .kiro/sdlc/* | Always allowed |
| TEST_CODE | *.test.js, *.spec.ts, __tests__/* | Allowed in RED+ |
| TEST_FIXTURE | fixtures/*, mocks/* | Always allowed |
| DOCUMENTATION | *.md, docs/* | Always allowed |
| PRODUCTION_CODE | src/*, lib/*, *.js, *.ts, *.py | GREEN+ only |

### Guard Behavior

| Phase | Production Code | Test Code | SDLC Metadata |
|-------|-----------------|-----------|---------------|
| INTAKE-PLANNING | BLOCKED | ALLOWED | ALLOWED |
| IMPL - PENDING/RED | BLOCKED | ALLOWED | ALLOWED |
| IMPL - GREEN/REFACTOR | ALLOWED | ALLOWED | ALLOWED |
| VERIFICATION+ | BLOCKED | ALLOWED | ALLOWED |

## Evidence System

### Evidence Requirements

Every TDD phase transition must record evidence containing:

`yaml
task_id: TASK-001
phase: RED | GREEN | REFACTOR | VERIFY
timestamp: "ISO-8601"
command: "npm test"
result: PASS | FAIL
exit_code: 0 | 1
test_file: "src/auth.test.js"
test_name: "should authenticate valid user"
git_ref: "abc123"
`

### Evidence Freshness

Evidence becomes **STALE** when:
- Implementation files change after verification
- Dependencies update
- Configuration changes

Stale evidence must be refreshed before marking task complete.

## Steering Files

| File | Trigger | Purpose |
|------|---------|---------|
| 01-intake.md | "start project", "new feature" | Capture initial idea |
| 02-discovery.md | After intake | Analyze repository |
| 03-requirements.md | After discovery | Write requirements |
| 04-design.md | After requirements approved | Technical design |
| 05-planning.md | After design approved | Create tasks |
| 06-implementation.md | Task selected | TDD cycle |
| 07-verification.md | After implementation | QA/testing |
| 08-release.md | After verification | Release process |
| 09-post-release.md | After release | Monitor production |
| 10-change-mgmt.md | "change request" | Handle changes |
| resume.md | "resume", session start | Recover state |
| status.md | "status", "progress" | Show current state |
| validate.md | "validate" | Check consistency |

## Commands

### Lifecycle Commands

| Command | Action |
|---------|--------|
| "start SDLC project" | Initialize workflow |
| "resume" | Recover from interruption |
| "status" | Show current phase/task |
| "validate" | Check state consistency |

### Task Commands

| Command | Action |
|---------|--------|
| "select task TASK-xxx" | Activate a task |
| "start TDD" | Begin RED phase |
| "test passes" | Move to GREEN |
| "tests pass" | Move to REFACTOR |
| "refactor done" | Move to VERIFY |
| "task complete" | Mark done |

### Phase Commands

| Command | Action |
|---------|--------|
| "requirements complete" | Request REQ_REVIEW |
| "design complete" | Request DESIGN_REVIEW |
| "planning complete" | Request PLAN_REVIEW |
| "ready for release" | Request RELEASE_READINESS |

## Installation

### 1. Copy Power

`ash
cp -r powers/sdlc-workflow ~/.kiro/powers/
`

### 2. Install Guard Hook (Optional)

Copy to project:
`ash
mkdir -p scripts
cp powers/sdlc-workflow/scripts/sdlc-guard.js scripts/
`

Add hook:
`json
{
  "version": "v1",
  "hooks": [{
    "name": "SDLC Phase Guard",
    "trigger": "PreToolUse",
    "matcher": "fs_write|str_replace|edit_file",
    "action": {
      "type": "command",
      "command": "node scripts/sdlc-guard.js"
    }
  }]
}
`

### 3. Initialize Project

Say: **"start SDLC project"**

## Best Practices

1. **Commit state files with code**
   - Include .kiro/sdlc/ in commits
   - State and code should be in sync

2. **Use meaningful IDs**
   - TASK-001-user-auth not TASK-001
   - REQ-002-password-policy not REQ-002

3. **Document NOT_APPLICABLE**
   - When skipping TDD: explain why
   - Future maintainers need context

4. **Keep evidence fresh**
   - Re-verify after changes
   - Don't rely on stale evidence

5. **Review before transitions**
   - Ensure state matches reality
   - Check all requirements met

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues and solutions.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-09-25 | Initial release |

## License

MIT License

## Author

Built with Kiro Power Builder
