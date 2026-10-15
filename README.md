# SDLC Workflow Power - Documentation

## Overview

SDLC Workflow Power adalah Kiro Power yang menyediakan framework Software Development Lifecycle (SDLC) yang komprehensif, auditable, dan recoverable. Power ini menerapkan metodologi Test-Driven Development (TDD) dengan guardrails otomatis untuk memastikan kualitas dan konsistensi pengembangan software.

**Version 1.1.0** menambahkan fitur enterprise reliability:
- State versioning dengan optimistic concurrency
- Task ownership dengan fencing tokens
- Checkpoint dan crash recovery
- Evidence staleness detection
- Definition of Ready enforcement
- Review finding register
- Full release lifecycle dengan rollback
- Audit logging

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
| NO DoR -> NO START | Tidak boleh mulai tanpa Definition of Ready |
| NO DoD -> NO DONE | Tidak boleh selesai tanpa Definition of Done |

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
├── project-state.yaml     # Runtime state with versioning (authoritative)
├── traceability.yaml      # Cross-references (authoritative)
├── progress.md            # Human-readable summary (derived)
├── audit.log              # Audit trail (JSONL format)
├── requirements/          # REQ-xxx.md files
├── designs/               # DESIGN-xxx.md + adr/
├── tasks/                 # TASK-xxx.md files
├── evidence/              # TDD evidence per task
├── checkpoints/           # Recovery checkpoints
├── findings/              # Review findings (FND-xxx.yaml)
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
workflow_version: "1.1.0"
schema_version: "2"

# State versioning for optimistic concurrency
state_version: 42
last_modified_at: "2024-01-15T10:00:00Z"
last_modified_by: "dev-001"

project:
  name: "my-project"
  initialized_at: "2024-01-15T10:00:00Z"
  
lifecycle:
  phase: IMPLEMENTATION
  phase_started_at: "2024-01-15T14:00:00Z"
  
current_task:
  id: TASK-001
  title: "Implement user authentication"
  status: IN_PROGRESS
  # Ownership tracking
  ownership:
    fencing_token: "uuid-here"
    acquired_at: "2024-01-15T14:00:00Z"
    actor_type: HUMAN  # or AI_AGENT
    lease_expires_at: null  # null for humans
    last_heartbeat_at: null
  # Definition of Ready check result
  dor_check:
    passed: true
    checked_at: "2024-01-15T14:00:00Z"
  tdd:
    phase: GREEN
    applicable: true
  # Blocked as orthogonal attribute
  blocked: false
  blocked_reason: null
  blocker_refs: []
    
# Resource locks for exclusive access
resource_locks:
  - resource_id: "db-migration-slot"
    held_by_task: "TASK-001"
    held_by_owner: "dev-001"
    acquired_at: "2024-01-15T14:00:00Z"

# Checkpoints summary
checkpoints:
  last_checkpoint_id: "CP-2024-01-15-001"
  last_checkpoint_at: "2024-01-15T14:30:00Z"
  checkpoint_count: 5

# Findings summary  
findings:
  total: 3
  by_status:
    OPEN: 1
    RESOLVED: 2
  blocking_release: 0

# Release tracking
release:
  status: NOT_STARTED
  version: null
  current_stage: null

# Actor configuration
actor_config:
  lease_duration_seconds: 3600
  heartbeat_interval_seconds: 300
  inactivity_warning_seconds: 7200
  handoff_timeout_hours: 24

# Quality gates configuration
quality_gates:
  unit_test:
    required: true
    min_pass_rate: 100
  integration_test:
    required: true
  lint:
    required: true
  type_check:
    required: true

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
evidence_id: EVD-TASK-001-RED
task_id: TASK-001
phase: RED | GREEN | REFACTOR | VERIFY
timestamp: "ISO-8601"
command: "npm test"
result:
  status: PASS | FAIL | BLOCKED | NOT_RUN | NOT_APPLICABLE
  summary: "Test correctly fails: expected behavior missing"
  failure_type: BEHAVIOR_MISSING | TEST_ERROR | ENVIRONMENT_ERROR
exit_code: 0 | 1
test_file: "src/auth.test.js"
test_name: "should authenticate valid user"
git_state:
  commit_sha: "abc123"
  branch: "task/TASK-001-user-auth"
  working_tree_dirty: false
executor:
  id: "dev-001"
  type: HUMAN | AI_AGENT
staleness:
  stale: false
  stale_reason: null
  related_files:
    - path: "src/auth.ts"
      hash_at_verification: "sha256:..."
`

### Evidence Staleness

Evidence becomes **STALE** when:
- `commit_sha` differs from current HEAD
- Related files modified after verification (hash mismatch)
- Configuration changes affect the test

Stale evidence must be refreshed before marking task complete.

### Quality Gates

Configurable quality gates for release readiness:

`yaml
quality_gates:
  unit_test:
    required: true
    min_pass_rate: 100
  integration_test:
    required: true
    min_pass_rate: 100
  lint:
    required: true
  type_check:
    required: true
  security_scan:
    required_for_risk: [HIGH, CRITICAL]
`

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

### Ownership Commands

| Command | Action |
|---------|--------|
| "claim task TASK-xxx" | Claim ownership with fencing token |
| "release task" | Release current task ownership |
| "heartbeat" | Record heartbeat (AI agents) |
| "check leases" | Check for expired leases |

### Checkpoint Commands

| Command | Action |
|---------|--------|
| "checkpoint" | Create manual checkpoint |
| "checkpoint note 'message'" | Create checkpoint with note |
| "list checkpoints" | Show checkpoints for current task |
| "recover from CP-xxx" | Prepare recovery from checkpoint |

### Release Commands

| Command | Action |
|---------|--------|
| "plan release v1.0.0" | Plan new release |
| "check readiness" | Run release readiness check |
| "deploy to staging" | Deploy to staging environment |
| "verify staging" | Verify staging deployment |
| "request production approval" | Request approval for production |
| "deploy to production" | Deploy to production |
| "rollback release" | Rollback current release |
| "close release" | Close successful release |

### Finding Commands

| Command | Action |
|---------|--------|
| "create finding" | Create review finding |
| "update finding FND-xxx" | Update finding status |
| "list findings" | Show findings for current task |
| "blocking findings" | Show findings blocking release |

## Installation

> **Quick Start**: See [QUICK-START.md](./QUICK-START.md) for detailed step-by-step instructions with platform-specific commands.

### Quick Setup (Recommended)

Run the automated setup script from your project root:

```bash
node path/to/powers/sdlc-workflow/scripts/sdlc-setup.js
```

This automatically creates directories, copies guard script, and sets up hooks.

### Manual Setup

1. **Copy Power**: Copy `powers/sdlc-workflow` to `~/.kiro/powers/`
2. **Copy Guard Script**: Copy `scripts/sdlc-guard.js` to your project's `scripts/` folder  
3. **Create Hook**: Create `.kiro/hooks/sdlc-guard.json` with the guard hook configuration

See [QUICK-START.md](./QUICK-START.md) for full platform-specific commands.

### Initialize Workflow

Say: **"start SDLC project"**

### Prerequisites

- Node.js v14+ (for guard script)
- Git (recommended)
- Kiro IDE

## Best Practices

`ash
cp -r powers/sdlc-workflow ~/.kiro/powers/
`

### 2. Install Guard Hook (Optional)

Copy to project:
`ash
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

6. **Use checkpoints liberally**
   - Create checkpoints before risky operations
   - Checkpoints enable safe recovery

7. **Monitor AI agent leases**
   - Ensure heartbeats are sent regularly
   - Handle expired leases promptly

8. **Resolve findings before release**
   - CRITICAL and HIGH findings block release
   - Use WONT_FIX with documented justification

## Configuration

### Actor Configuration

`yaml
actor_config:
  # AI agent lease duration in seconds (default: 3600 = 1 hour)
  lease_duration_seconds: 3600
  
  # AI agent heartbeat interval in seconds (default: 300 = 5 minutes)
  heartbeat_interval_seconds: 300
  
  # Human inactivity warning threshold in seconds (default: 7200 = 2 hours)
  inactivity_warning_seconds: 7200
  
  # Handoff timeout in hours (default: 24)
  handoff_timeout_hours: 24
`

### Checkpoint Configuration

`yaml
checkpoint_config:
  # Auto-create checkpoints on state transitions
  auto_create: true
  
  # Periodic checkpoint interval in minutes
  periodic_interval_minutes: 15
  
  # Number of checkpoints to keep per task
  keep_count: 10
`

### Bottleneck Thresholds

`yaml
bottleneck_thresholds:
  # Maximum active tasks per developer
  max_active_tasks: 3
  
  # Maximum hours a task can be blocked
  max_blocked_hours: 24
  
  # Minimum utilization before flagging underutilization
  min_utilization_percent: 25
  
  # Maximum utilization before flagging overload
  max_utilization_percent: 150
`

### Quality Gates Configuration

`yaml
quality_gates:
  unit_test:
    required: true
    min_pass_rate: 100
  integration_test:
    required: true
    min_pass_rate: 100
  lint:
    required: true
  type_check:
    required: true
  security_scan:
    required_for_risk: [HIGH, CRITICAL]
`

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues and solutions.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2026-10-12 | Reliability features: state versioning, ownership, checkpoints, evidence staleness, DoR, findings, release lifecycle, audit logging |
| 1.0.0 | 2026-09-25 | Initial release |

## License

MIT License

## Author

Built with Kiro Power Builder
