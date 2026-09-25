---
inclusion: auto
name: "SDLC Planning"
description: "Generates implementation tasks from requirements and design with dependency ordering"
---

# SDLC Planning Phase

## Purpose

The PLANNING phase generates implementation tasks from approved requirements and design, establishing the work breakdown with proper dependencies.

## When This Activates

- After DESIGN_REVIEW approval
- User says "plan", "task", "create tasks", "implementation plan"
- Current phase is PLANNING

## Prerequisites

- Requirements approved
- Design approved (or NOT_APPLICABLE with rationale)
- lifecycle.phase == PLANNING

## Task Structure

Each task (TASK-xxx.md) must contain:

1. **Metadata**: ID, Status, Risk, Created
2. **Requirement Reference**: Which REQ this implements
3. **AC References**: Which acceptance criteria
4. **Design Reference**: Related design doc
5. **Dependencies**: Other tasks that must complete first
6. **Expected Files**: Files to be created/modified
7. **Test Requirements**: What tests are needed
8. **TDD Status**: RED/GREEN/REFACTOR/VERIFY tracking
9. **Definition of Done**: Checklist

## Task Guidelines

Tasks must be:

- **Small**: Completable in reasonable time
- **Deterministic**: Clear success criteria
- **Verifiable**: Can prove completion
- **Traceable**: Links to requirements and AC

Avoid generic tasks like:
- "Implement backend" (too vague)
- "Add tests" (not specific)
- "Fix frontend" (unclear scope)

## Risk Levels

| Risk | Verification Scope |
|------|-------------------|
| LOW | Unit tests |
| MEDIUM | Unit + Integration |
| HIGH | Unit + Integration + Regression |
| CRITICAL | Full suite + Security + Performance |

## Task Dependencies

Order tasks by:

1. Foundation before features
2. Data model before business logic
3. Core before edge cases
4. Tests written before implementation (TDD)

## Plan Review Gate (HUMAN)

Plan approval establishes the implementation baseline.

After approval, scope changes require Change Request.

## Guardrails

- NO code changes during PLANNING
- Every task must reference at least one AC
- Tasks must be ordered by dependencies
- Risk level required for each task
