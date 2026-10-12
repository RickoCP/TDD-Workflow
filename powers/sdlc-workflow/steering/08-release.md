---
inclusion: auto
name: "SDLC Release"
description: "Release readiness, staging, and production deployment workflow with evidence-based gates"
---

# SDLC Release Phase

## Purpose

Manage release from readiness check through production deployment, with evidence-based validation at each stage. The Release_Manager component orchestrates the release lifecycle.

## Release State Machine

```
NOT_STARTED
     │
     └── planRelease() ──────────────> PLANNING
                                           │
                                           └── checkReadiness() ──> READINESS_CHECK
                                                                        │
                                    ┌───── Gates fail ─────────────────┤
                                    │                                   │
                                    v                                   v
                            READINESS_FAILED                    STAGING
                                    │                              │
                                    └── fix & retry ───────────────┤
                                                                   │
                                    ┌───── Deploy/test fail ───────┤
                                    │                               │
                                    v                               v
                              STAGING_FAILED              AWAITING_APPROVAL
                                    │                              │
                                    └── fix & retry ───────────────┤
                                                                   │
                                    ┌───── Rejected ───────────────┤
                                    │                               │
                                    │                               v (Human approves)
                                    │                          PRODUCTION
                                    │                              │
                                    │         ┌── Deploy fail ─────┤
                                    │         │                     │
                                    │         v                     v
                                    │   PRODUCTION_FAILED      MONITORING
                                    │         │                     │
                                    │         │         ┌── Issue ──┤
                                    │         │         │           │
                                    │         v         v           v
                                    │     ROLLED_BACK          CLOSED
                                    │         │
                                    │         └── retry ──> STAGING
                                    │
                                    └────────────────> CANCELLED
```

## Phases

### NOT_STARTED → PLANNING

**Trigger**: User says "plan release", "start release v1.0.0"

```
Planning release v1.0.0...

Release Configuration:
  Version: 1.0.0
  Target tasks: 15 (all committed to this release)
  Release branch: release/v1.0.0
  
Created release plan:
  - Readiness check required
  - Staging deployment configured
  - Production approval gate: HUMAN required
  - Monitoring period: 24 hours

Release status: PLANNING
Next step: Complete all tasks, then run readiness check
```

### PLANNING → READINESS_CHECK (HUMAN_GATE)

**Trigger**: User says "check release readiness", "run readiness check"

#### Generate Release Readiness Report

Create releases/v1.0.0/release-readiness.md with comprehensive validation:

| Section | Content |
|---------|---------|
| Requirements | Total, frozen, coverage % |
| Acceptance Criteria | Total, verified, coverage % |
| Tasks | Total, done, completion % |
| Evidence | Total, valid (not stale), fresh % |
| Findings | By severity, blocking count |
| Quality Gates | Each gate status |
| Tests | Unit, integration, regression results |
| Security | Status and details |
| Performance | Status and details |
| Documentation | Status |
| Known Issues | List |
| Release Blockers | List with severity |

#### Evidence Freshness Check

The Release_Manager checks all evidence for staleness:

```
Checking evidence freshness for release v1.0.0...

Evidence Summary:
  Total evidence records: 45
  Valid (fresh): 42
  Stale: 3
  
Stale Evidence Details:
  ┌─────────────────────┬────────────┬─────────────────────────────┐
  │ Evidence ID         │ Task       │ Stale Reason                │
  ├─────────────────────┼────────────┼─────────────────────────────┤
  │ EVD-TASK-003-VERIFY │ TASK-003   │ commit_changed (2 commits)  │
  │ EVD-TASK-007-GREEN  │ TASK-007   │ file_modified (src/api.ts)  │
  │ EVD-TASK-012-RED    │ TASK-012   │ commit_changed (1 commit)   │
  └─────────────────────┴────────────┴─────────────────────────────┘

⚠ Release cannot proceed with stale evidence.
Action required: Re-verify TASK-003, TASK-007, TASK-012
```

#### Findings Check

```
Checking findings for release v1.0.0...

Findings Summary:
  Total: 12
  
By Status:
  OPEN: 2
  IN_PROGRESS: 1
  RESOLVED: 8
  WONT_FIX: 1

By Severity:
  CRITICAL: 0 (none open)
  HIGH: 1 (1 OPEN - BLOCKING)
  MEDIUM: 3 (1 OPEN)
  LOW: 5
  INFO: 3

⚠ Blocking findings detected:
  - FND-008 (HIGH/SECURITY): SQL injection in user search
    Task: TASK-005
    Owner: dev-002
    Status: OPEN
    
Release cannot proceed until HIGH findings are resolved.
```

#### Quality Gates Validation

```
Running quality gates for release v1.0.0...

Quality Gate Results:
  ┌────────────────────┬──────────┬─────────────────────────┐
  │ Gate               │ Status   │ Details                 │
  ├────────────────────┼──────────┼─────────────────────────┤
  │ unit_test          │ ✓ PASS   │ 100% pass (245/245)     │
  │ integration_test   │ ✓ PASS   │ 100% pass (48/48)       │
  │ lint               │ ✓ PASS   │ No errors               │
  │ type_check         │ ✓ PASS   │ No errors               │
  │ security_scan      │ ✗ FAIL   │ 1 HIGH vulnerability    │
  │ performance_test   │ ✓ PASS   │ Meets thresholds        │
  └────────────────────┴──────────┴─────────────────────────┘

Quality gates: 5/6 passed
Blocking: security_scan

Release not ready. Fix security issues and re-run readiness check.
```

#### Release Status

- **READY**: All gates pass, no stale evidence, no blocking findings
- **NOT_READY**: Gates failing, stale evidence, or blocking findings exist

```
Release Readiness Summary for v1.0.0:

Status: NOT_READY

Blockers:
  1. Stale evidence (3 records need revalidation)
  2. Open HIGH finding (FND-008)
  3. Security gate failed

Actions Required:
  1. Re-run tests for TASK-003, TASK-007, TASK-012
  2. Resolve FND-008 (SQL injection)
  3. Fix security vulnerability and re-scan

Human Approval: Not yet requested (resolve blockers first)
```

### READINESS_CHECK → STAGING

**Trigger**: Readiness passes, user says "deploy to staging"

```
Deploying v1.0.0 to staging...

Pre-deployment Checks:
  ✓ Readiness check passed
  ✓ All evidence fresh
  ✓ No blocking findings
  ✓ All quality gates passed

Deployment:
  Environment: staging
  Artifact: release-v1.0.0-build-42.tar.gz
  Timestamp: 2026-10-15T14:00:00Z
  
Running staging smoke tests...
  ✓ Health check endpoint responding
  ✓ Core functionality tests passed
  ✓ Database connections verified
  
Recording deployment evidence...
  Evidence ID: EVD-RELEASE-v1.0.0-STAGING

Staging deployment successful.
Release status: AWAITING_APPROVAL
Next step: Verify staging environment, then request production approval
```

### STAGING_FAILED → STAGING

On staging failure:

```
⚠ Staging deployment failed

Failure Details:
  Stage: smoke_tests
  Error: Health check timeout after 30s
  Logs: .kiro/sdlc/releases/v1.0.0/staging-failure.log

Options:
  1. Investigate and fix, then retry staging
  2. Cancel release

Release status: STAGING_FAILED
```

### STAGING → AWAITING_APPROVAL (HUMAN_GATE)

**Prerequisites**:
- Staging deployment successful
- Staging verification passed
- All staging tests green

```
Release v1.0.0 ready for production approval.

Staging Verification Summary:
  Deployed at: 2026-10-15T14:00:00Z
  Verified at: 2026-10-15T15:30:00Z
  Test results: 100% pass
  
Changes in this release:
  - 15 tasks completed
  - 3 new features
  - 8 bug fixes
  - 4 improvements
  
Documentation:
  - Release notes: releases/v1.0.0/release-notes.md
  - Changelog: releases/v1.0.0/changelog.md

Human Approval Required:
  Approver must review staging verification and confirm production deployment.
  
  [Approve for Production] [Request Changes] [Cancel Release]
```

### AWAITING_APPROVAL → PRODUCTION

**Trigger**: Human explicitly approves (HUMAN_GATE)

```
Recording production approval...

Approval Details:
  Approver: lead-001 (Project Lead)
  Approved at: 2026-10-15T16:00:00Z
  Notes: "Staging verified, ready for production"
  
Evidence ID: EVD-RELEASE-v1.0.0-APPROVAL

Deploying v1.0.0 to production...

Deployment:
  Environment: production
  Artifact: release-v1.0.0-build-42.tar.gz (same as staging)
  Timestamp: 2026-10-15T16:05:00Z
  
Running production smoke tests...
  ✓ Health check endpoint responding
  ✓ Core functionality verified
  ✓ Metrics collection active
  
Recording deployment evidence...
  Evidence ID: EVD-RELEASE-v1.0.0-PRODUCTION

Git Operations:
  ✓ Tagged: v1.0.0
  ✓ Release branch merged to main
  
Production deployment successful.
Release status: MONITORING
Monitoring period: 24 hours (until 2026-10-16T16:05:00Z)
```

### PRODUCTION → MONITORING

After successful production deployment:

```
Release v1.0.0 is in monitoring period.

Monitoring Details:
  Started: 2026-10-15T16:05:00Z
  Ends: 2026-10-16T16:05:00Z
  Duration: 24 hours
  
Monitoring Checklist:
  ☐ Error rates normal
  ☐ Latency within thresholds
  ☐ No critical alerts
  ☐ User feedback collected
  
Rollback Available:
  Previous version: v0.9.0
  Rollback command: "rollback release v1.0.0"
  
Status: MONITORING (18 hours remaining)

If issues detected, rollback is available.
```

### MONITORING → CLOSED

**Trigger**: Monitoring period completes with no issues

```
Release v1.0.0 monitoring complete.

Monitoring Summary:
  Period: 2026-10-15T16:05:00Z to 2026-10-16T16:05:00Z
  Issues detected: 0
  Rollback: Not needed
  
Final Metrics:
  Error rate: 0.01% (threshold: <1%)
  P99 latency: 120ms (threshold: <500ms)
  User reports: 0 critical issues
  
Release v1.0.0 closed successfully.

Archived to: releases/v1.0.0/
  - release-notes.md
  - deployment-log.md
  - health-validation.md
  - monitoring-report.md
  
Release status: CLOSED
```

### ROLLBACK Flow

**Trigger**: Issue detected during monitoring, or user says "rollback release"

```
Initiating rollback for v1.0.0...

Rollback Details:
  Current version: v1.0.0
  Target version: v0.9.0
  Reason: "Elevated error rate in payment processing"
  
Rolling back...
  ✓ v0.9.0 artifact retrieved
  ✓ Deployment to production
  ✓ Health checks passed
  ✓ Error rates normalized
  
Recording rollback evidence...
  Evidence ID: EVD-RELEASE-v1.0.0-ROLLBACK

Release status: ROLLED_BACK

Post-rollback Actions:
  1. Investigate root cause
  2. Fix issues in development
  3. When ready: re-deploy to staging and go through approval again
```

## Guardrails

- NO release without passing readiness check
- NO staging deployment without all quality gates passed
- NO production deployment without explicit human approval
- NO release with stale evidence (must revalidate)
- NO release with open CRITICAL or HIGH findings
- ALL evidence must be fresh at each gate
- ALL deployment artifacts must match between staging and production
- ALL checks must be evidence-based (recorded in .kiro/sdlc/evidence/)
- Rollback must be available throughout monitoring period
- Human approval cannot be automated or bypassed

## Release Evidence Trail

Each release maintains a complete evidence trail:

```
.kiro/sdlc/
├── releases/
│   └── v1.0.0/
│       ├── release-config.yaml
│       ├── release-readiness.md
│       ├── staging-deployment.log
│       ├── staging-verification.yaml
│       ├── approval-record.yaml
│       ├── production-deployment.log
│       ├── monitoring-report.yaml
│       ├── release-notes.md
│       └── changelog.md
├── evidence/
│   ├── EVD-RELEASE-v1.0.0-READINESS.yaml
│   ├── EVD-RELEASE-v1.0.0-STAGING.yaml
│   ├── EVD-RELEASE-v1.0.0-APPROVAL.yaml
│   └── EVD-RELEASE-v1.0.0-PRODUCTION.yaml
└── audit.log  # All release events logged
```

## Integration with Other Components

| Component | Integration |
|-----------|-------------|
| Evidence_Manager | Staleness check, evidence creation |
| Finding_Register | Blocking findings check |
| State_Controller | Atomic state updates with versioning |
| Audit_Logger | All release events logged |
| Checkpoint_Manager | Checkpoint on release milestones |
