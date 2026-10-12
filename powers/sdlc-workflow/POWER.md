---
name: "sdlc-workflow"
displayName: "SDLC Workflow"
description: "End-to-end Software Development Lifecycle workflow with TDD enforcement, requirement traceability, human approval gates, multi-developer support, and enterprise reliability features."
keywords: ["sdlc", "tdd", "test driven", "requirement", "traceability", "workflow", "lifecycle", "red green refactor", "multi-developer", "checkpoint", "release"]
author: "Kiro Power Builder"
---

# SDLC Workflow Power

## Overview

SDLC Workflow Power provides a comprehensive, auditable software development lifecycle framework with enterprise-grade reliability features.

The workflow ensures:
- **No coding before requirements are defined** - Requirements define WHAT
- **No implementation before design** - Design defines HOW  
- **No code changes without active tasks** - Tasks define WORK
- **Test-first development** - Tests define expected BEHAVIOR
- **Evidence-based verification** - Evidence proves RESULT
- **Recoverable state** - State defines WHERE WE ARE
- **Full history** - Git preserves HISTORY
- **Safe concurrency** - Ownership prevents conflicts
- **Crash recovery** - Checkpoints preserve progress
- **Release lifecycle** - Gated deployment to production
## Core Principles

DO NOT OPTIMIZE FOR "FINISHING THE TASK"

OPTIMIZE FOR: CORRECTNESS, TRACEABILITY, REPRODUCIBILITY, RECOVERABILITY, TESTABILITY, SAFETY, MAINTAINABILITY

## Hard Guardrails

NO REQUIREMENT -> NO DESIGN
NO APPROVED DESIGN -> NO IMPLEMENTATION PLAN  
NO TASK -> NO CODE
NO RED -> NO GREEN
NO GREEN -> NO REFACTOR
NO VERIFY -> NO DONE
NO DoR -> NO START (Definition of Ready required)
NO DoD -> NO DONE (Definition of Done required)

When a gate is not applicable, mark it NOT_APPLICABLE with rationale.

## Lifecycle Phases

INTAKE -> DISCOVERY -> REQUIREMENTS -> REQ_REVIEW [HUMAN] -> DESIGN -> DESIGN_REVIEW [HUMAN] -> PLANNING -> PLAN_REVIEW [HUMAN] -> IMPLEMENTATION -> INTEGRATION -> QA -> SECURITY -> PERFORMANCE -> RELEASE_READINESS [HUMAN] -> STAGING -> PRODUCTION [HUMAN] -> POST_RELEASE -> MONITORING -> MAINTENANCE

## TDD Cycle

PENDING -> RED (test must FAIL) -> GREEN (minimum impl, must PASS) -> REFACTOR (must still PASS) -> VERIFY -> COMPLETE

If test passes unexpectedly during RED: STOP AND INVESTIGATE.

## Source of Truth Precedence

1. Repository reality / test results (HIGHEST)
2. Git state/history
3. Authoritative artifacts (REQ, DESIGN, TASK)
4. project-state.yaml
5. traceability.yaml
6. Derived docs (progress.md, index.md)
7. Conversation context (LOWEST)

## Project State Structure

.kiro/sdlc/
  .config.yaml          - Workflow configuration
  project-state.yaml    - AUTHORITATIVE runtime state (with versioning)
  traceability.yaml     - AUTHORITATIVE cross-references
  progress.md           - DERIVED summary
  requirements/         - REQ-xxx.md artifacts
  designs/              - DESIGN-xxx.md + adr/
  tasks/                - TASK-xxx.md artifacts
  evidence/             - TDD evidence per task
  checkpoints/          - Recovery checkpoints
  findings/             - Review findings register
  changes/              - CR-xxx change requests
  decisions/            - DEC-xxx decisions
  blockers/             - BLOCKER-xxx issues
  releases/             - Release artifacts
  audit.log             - Audit trail (JSONL)

## New Reliability Features

### State Versioning & Concurrency Control

Every state update uses optimistic concurrency:
- `state_version` increments on every write
- Version mismatch triggers automatic retry with backoff
- Prevents lost updates in concurrent scenarios

### Task Ownership & Fencing Tokens

- Each task assignment generates a unique `fencing_token`
- Operations require valid token to prevent stale writes
- AI agents have time-limited leases with heartbeat requirement
- Human developers have unlimited leases (optional inactivity warnings)

### Checkpoint & Recovery

Checkpoints automatically created on:
- State transitions
- TDD phase changes
- Evidence creation
- Handoff operations
- Configurable periodic intervals

Recovery validates repository state and reconciles discrepancies.

### Evidence Staleness Detection

Evidence becomes stale when:
- Commit SHA differs from current HEAD
- Related files modified after verification
- Configuration changed

Stale evidence blocks task completion until revalidated.

### Definition of Ready (DoR)

Tasks cannot start until:
- Acceptance criteria defined
- Blocking dependencies complete
- Required decisions resolved
- Assignee has required role
- No active blockers

### Finding Register

Formal tracking of review findings:
- Severity levels: CRITICAL, HIGH, MEDIUM, LOW, INFO
- Categories: BUG, SECURITY, PERFORMANCE, STYLE, DOCUMENTATION
- Status workflow: OPEN → IN_PROGRESS → RESOLVED/WONT_FIX
- Blocking releases until CRITICAL/HIGH resolved

### Release Lifecycle

Full release workflow:
- PLANNING → READINESS_CHECK → STAGING → PRODUCTION → MONITORING → CLOSED
- Quality gates at each stage
- Human approval required for production
- Rollback support with automatic state management

### Audit Logging

All significant operations logged:
- Operation ID for correlation
- Actor type (HUMAN/AI_AGENT)
- State version before/after
- Change details
- Outcome (SUCCESS/FAILURE)

## Human Approval Gates

| Gate | Transition | Purpose |
|------|------------|---------|
| REQ_REVIEW | REQUIREMENTS to DESIGN | Validate requirements |
| DESIGN_REVIEW | DESIGN to PLANNING | Validate architecture |
| PLAN_REVIEW | PLANNING to IMPLEMENTATION | Confirm task scope |
| RELEASE_READINESS | VERIFICATION to STAGING | Quality gate |
| PRODUCTION | STAGING to PRODUCTION | Production authorization |

## Actor Types

| Actor Type | Lease | Heartbeat | Capabilities |
|------------|-------|-----------|--------------|
| HUMAN | Unlimited | Not required | Full access |
| AI_AGENT | Time-limited (default 1hr) | Required (5min interval) | Configurable restrictions |

### AI Agent Default Restrictions
- Cannot approve gates
- Cannot deploy to production
- Cannot modify frozen requirements without human approval
- Subject to automatic lease expiry

## File Classification

| Type | RED Phase | GREEN Phase |
|------|-----------|-------------|
| PRODUCTION_CODE | BLOCKED | ALLOWED |
| TEST_CODE | ALLOWED | ALLOWED |
| TEST_FIXTURE | ALLOWED | ALLOWED |
| SDLC_METADATA | ALLOWED | ALLOWED |
| DOCUMENTATION | ALLOWED | ALLOWED |
| CONFIGURATION | ALLOWED | ALLOWED |

## Available Steering Files

| File | Phase | Purpose |
|------|-------|---------|
| 01-intake.md | INTAKE | Idea/change request capture |
| 02-discovery.md | DISCOVERY | Repository analysis |
| 03-requirements.md | REQUIREMENTS | Requirement engineering |
| 04-design.md | DESIGN | Technical design and ADR |
| 05-planning.md | PLANNING | Task generation |
| 06-implementation.md | IMPLEMENTATION | TDD cycle execution |
| 07-verification.md | INTEGRATION to PERFORMANCE | Quality verification |
| 08-release.md | RELEASE_READINESS to PRODUCTION | Release management |
| 09-post-release.md | POST_RELEASE to MONITORING | Post-release validation |
| 10-change-mgmt.md | Any | Change request handling |
| resume.md | Any | Session recovery |
| status.md | Any | Progress reporting |
| validate.md | Any | Workflow validation |

## Evidence Requirements

Evidence must contain: task_id, phase, timestamp, command, result, test_file, test_name, git_ref, executor_id, executor_type

Evidence becomes STALE when:
- Implementation changes after verification (commit SHA mismatch)
- Related files modified (file hash mismatch)
- Configuration changes

Stale evidence triggers REQUIRES_REVALIDATION status.

## Quality Gates

Configurable per project:

```yaml
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
```

## Task State Machine

States: PENDING → READY → ASSIGNED → IN_PROGRESS → REVIEW → READY_TO_MERGE → INTEGRATED → DONE

Orthogonal attributes:
- `blocked: true/false` with blocker_refs
- `handoff_pending: true/false` with handoff_id

Terminal states: CANCELLED, SUPERSEDED

Reopening DONE requires justification and new evidence.

## Release Lifecycle

NOT_STARTED → PLANNING → READINESS_CHECK → STAGING → AWAITING_APPROVAL → PRODUCTION → MONITORING → CLOSED

Alternative paths:
- READINESS_FAILED → fix → READINESS_CHECK
- STAGING_FAILED → fix → STAGING  
- PRODUCTION_FAILED → ROLLED_BACK → fix → STAGING
- Any stage → CANCELLED

## Versioning

workflow_version: "1.1.0"
schema_version: "2"

## Getting Started

1. Say "start SDLC project" or "initialize SDLC workflow"
2. Follow INTAKE phase to capture the idea
3. DISCOVERY phase analyzes your repository
4. Progress through lifecycle phases with guidance
5. Use "resume" after any session interruption
6. Use "status" to check current position
7. Use "checkpoint" to manually create recovery point

## Configuration

Key configuration options in `.kiro/sdlc/.config.yaml`:

```yaml
actor_config:
  lease_duration_seconds: 3600      # AI agent lease duration
  heartbeat_interval_seconds: 300   # AI agent heartbeat interval
  inactivity_warning_seconds: 7200  # Human inactivity warning
  handoff_timeout_hours: 24         # Handoff expiry

checkpoint_config:
  auto_create: true
  periodic_interval_minutes: 15
  keep_count: 10                    # Per task retention

bottleneck_thresholds:
  max_active_tasks: 3
  max_blocked_hours: 24
  min_utilization_percent: 25
  max_utilization_percent: 150
```

## Components

### Core Components (Existing)
- **Team_Manager**: Team member management
- **Task_Assigner**: Intelligent task assignment
- **Dependency_Resolver**: Dependency graph and validation
- **Parallel_Group_Manager**: Parallel execution coordination
- **Workload_Analyzer**: Bottleneck detection and rebalancing
- **Handoff_Coordinator**: Safe context transfer

### Reliability Components (New)
- **State_Controller**: Atomic state operations with versioning
- **Ownership_Manager**: Task ownership with fencing tokens
- **Checkpoint_Manager**: Create/restore recovery checkpoints
- **Evidence_Manager**: Evidence lifecycle and staleness detection
- **DoR_Validator**: Definition of Ready validation
- **Finding_Register**: Review findings management
- **Audit_Logger**: Audit trail writing

## Cross-Platform Support

Guard scripts use Node.js for cross-platform compatibility (Windows, Linux, macOS).
