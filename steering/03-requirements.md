---
inclusion: auto
name: "SDLC Requirements"
description: "Creates and manages requirements with acceptance criteria in GIVEN/WHEN/THEN format"
---

# SDLC Requirements Phase

## Purpose

The REQUIREMENTS phase defines WHAT we are building through structured requirements with testable acceptance criteria.

## When This Activates

- After DISCOVERY completes
- User says "requirement", "user story", "acceptance criteria"
- Current phase is REQUIREMENTS

## Prerequisites

- SDLC initialized
- DISCOVERY completed
- lifecycle.phase == REQUIREMENTS

## Requirement Structure

Each requirement (REQ-xxx.md) must contain:

### Required Sections

1. **Metadata**: ID, Status, Created, Owner
2. **Description**: Clear description of the requirement
3. **Business Value**: Why this requirement matters
4. **Actors**: Who is involved
5. **Preconditions**: What must be true before
6. **Functional Requirements**: What the system must do
7. **Acceptance Criteria**: GIVEN/WHEN/THEN format
8. **Non-Functional Requirements**: Security, performance, etc.
9. **Constraints**: Limitations
10. **Dependencies**: Other requirements needed
11. **Out of Scope**: Explicit exclusions
12. **Risks**: Known risks
13. **Open Questions**: Unresolved questions

### Acceptance Criteria Format

Each AC must follow GIVEN/WHEN/THEN:

```
AC-001-01

GIVEN [precondition/context]
WHEN [action/trigger]
THEN [expected outcome]
```

## Requirement Status Lifecycle

```
DRAFT -> REVIEW -> APPROVED -> FROZEN -> SUPERSEDED
```

- **DRAFT**: Being written
- **REVIEW**: Ready for review
- **APPROVED**: Approved but can still be edited
- **FROZEN**: Locked, changes require Change Request
- **SUPERSEDED**: Replaced by newer requirement

## Non-Functional Requirements

Evaluate applicability of:

| Category | Consider |
|----------|----------|
| Security | Authentication, authorization, data protection |
| Performance | Response time, throughput, scalability |
| Reliability | Uptime, fault tolerance, recovery |
| Availability | SLA requirements |
| Maintainability | Code quality, documentation |
| Observability | Logging, monitoring, alerting |
| Accessibility | WCAG compliance |
| Compatibility | Browser, OS, API versions |

Mark as NOT_APPLICABLE with rationale if not relevant.

## Creating a Requirement

1. Generate next ID: REQ-001, REQ-002, etc.
2. Use requirement.md.tmpl template
3. Fill all required sections
4. Add at least one acceptance criterion
5. Set status to DRAFT
6. Update traceability.yaml
7. Update project-state.yaml counters

## Transitioning to REQ_REVIEW

When requirements are ready:

1. Change status to REVIEW
2. Update project-state.yaml:
   - lifecycle.phase: REQ_REVIEW
3. Present requirements for human approval

## REQ_REVIEW Gate (HUMAN)

Requirements cannot proceed to DESIGN without:

1. All requirements have acceptance criteria
2. Human explicitly approves
3. Approval recorded in traceability.yaml

## Guardrails

- NO code changes during REQUIREMENTS
- Every requirement MUST have at least one AC
- AC MUST use GIVEN/WHEN/THEN format
- FROZEN requirements cannot be edited without CR
