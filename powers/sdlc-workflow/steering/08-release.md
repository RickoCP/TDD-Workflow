---
inclusion: auto
name: "SDLC Release"
description: "Release readiness, staging, and production deployment workflow"
---

# SDLC Release Phase

## Purpose

Manage release from readiness check through production deployment.

## Phases

RELEASE_READINESS -> STAGING -> PRODUCTION

## RELEASE_READINESS Phase (HUMAN_GATE)

### Generate Release Readiness Report

Create releases/release-readiness.md with:

| Section | Content |
|---------|---------|
| Requirements | Total, frozen, coverage % |
| Acceptance Criteria | Total, verified, coverage % |
| Tasks | Total, done, completion % |
| Tests | Unit, integration, regression results |
| Security | Status and details |
| Performance | Status and details |
| Documentation | Status |
| Known Issues | List |
| Release Blockers | List |

### Release Status

- READY: All gates pass, no blockers
- NOT_READY: Gates failing or blockers exist

### Human Approval Required

Release cannot proceed without explicit approval recorded in traceability.yaml

## STAGING Phase

### Actions

1. Build release candidate
2. Deploy to staging environment
3. Run staging smoke tests
4. Validate deployment health

### On Failure

Return to IMPLEMENTATION or fix deployment issues.

## PRODUCTION Phase (HUMAN_GATE)

### Prerequisites

- Staging validation passed
- Explicit human approval

### Actions

1. Deploy to production
2. Run production smoke tests
3. Validate health metrics
4. Tag release in git
5. Generate changelog and release notes

### Post-Deployment

Create releases/vX.Y.Z/ with:
- release-notes.md
- deployment log
- health validation results

## Guardrails

- NO release without readiness report
- NO staging without approval
- NO production without explicit approval
- ALL checks must be evidence-based
