---
inclusion: auto
name: "SDLC Implementation"
description: "TDD implementation cycle: RED -> GREEN -> REFACTOR -> VERIFY for each task"
---

# SDLC Implementation Phase

## Purpose

The IMPLEMENTATION phase executes tasks using strict Test-Driven Development (TDD). Code changes are only permitted within the TDD cycle with proper evidence.

## When This Activates

- After PLAN_REVIEW approval
- User says "start task", "implement", "tdd", "red phase", "green phase"
- Current phase is IMPLEMENTATION

## Prerequisites

- Plan approved
- lifecycle.phase == IMPLEMENTATION
- At least one task in READY status

## TDD Cycle Overview

```
PENDING -> RED -> GREEN -> REFACTOR -> VERIFY -> COMPLETE
```

Each phase has specific rules and evidence requirements.

## File Classification

Before any file operation, classify the target:

| Type | Pattern Examples | RED Phase | GREEN Phase |
|------|-----------------|-----------|-------------|
| PRODUCTION_CODE | src/*.ts, lib/*.py, app/* | BLOCKED | ALLOWED |
| TEST_CODE | *.test.ts, *_test.py, __tests__/* | ALLOWED | ALLOWED |
| TEST_FIXTURE | fixtures/*, mocks/*, __mocks__/* | ALLOWED | ALLOWED |
| SDLC_METADATA | .kiro/sdlc/* | ALLOWED | ALLOWED |
| DOCUMENTATION | *.md, docs/* | ALLOWED | ALLOWED |
| CONFIGURATION | *.config.*, *.yaml, *.json | CONTEXT | CONTEXT |

CONTEXT = depends on whether config affects behavior

## Starting a Task

1. Select next READY task (dependencies satisfied)
2. Update task status to IN_PROGRESS
3. Update current_task in project-state.yaml
4. Set tdd.phase to PENDING
5. Begin TDD cycle

## RED Phase

### Purpose
Write a failing test that defines the expected behavior.

### Rules
- ALLOWED: Test code, test fixtures, SDLC metadata
- BLOCKED: Production code

### Steps

1. Derive test from acceptance criteria
2. Write the test
3. Run the test
4. **TEST MUST FAIL**
5. Verify failure is due to missing behavior (not test error)
6. Record evidence

### If Test Passes Unexpectedly

**STOP IMMEDIATELY**

Investigate:
- Behavior already exists?
- Test is wrong?
- Test not actually testing the behavior?
- Requirement already satisfied?
- Fixture/mock returning wrong data?

Do NOT proceed to GREEN until RED is legitimate.

### Evidence Required

Create evidence/TASK-xxx/red.md with:
- task_id
- timestamp
- command executed
- result: FAIL
- test_file path
- test_name
- output excerpt (max 50 lines)
- analysis confirming legitimate failure
- git_ref if available

## GREEN Phase

### Purpose
Write minimum implementation to make the test pass.

### Prerequisites
- Valid RED evidence exists
- tdd.phase == RED completed

### Rules
- ALLOWED: Production code, test code, SDLC metadata
- FORBIDDEN: Unrelated refactoring, scope creep

### Steps

1. Write minimum code to pass the test
2. Run the test
3. **TEST MUST PASS**
4. Record evidence

### Evidence Required

Create evidence/TASK-xxx/green.md with:
- task_id
- timestamp
- command executed
- result: PASS
- files_changed list
- implementation summary
- output excerpt
- git_ref if available

## REFACTOR Phase

### Purpose
Improve code quality while maintaining behavior.

### Prerequisites
- Valid GREEN evidence exists
- tdd.phase == GREEN completed

### Rules
- ALLOWED: Code quality improvements
- FORBIDDEN: Behavioral changes

### Refactoring Activities
- Improve naming
- Remove duplication
- Simplify logic
- Improve boundaries
- Align with architecture

### Steps

1. Identify refactoring opportunities
2. Make improvements
3. Run tests
4. **TESTS MUST STILL PASS**
5. Record evidence (or "no refactoring needed")

### Evidence Required

Create evidence/TASK-xxx/refactor.md with:
- task_id
- timestamp
- refactoring_performed: true/false
- changes made (or rationale for none)
- test result: PASS
- git_ref if available

## VERIFY Phase

### Purpose
Run verification suite appropriate to task risk level.

### Prerequisites
- Valid REFACTOR evidence exists
- tdd.phase == REFACTOR completed

### Verification by Risk

| Risk | Required Checks |
|------|----------------|
| LOW | Unit tests, lint, type check |
| MEDIUM | + Integration tests |
| HIGH | + Regression tests |
| CRITICAL | + E2E, security, performance |

### Steps

1. Determine verification scope from task risk
2. Run all applicable checks
3. Record results
4. All must PASS to proceed

### Evidence Required

Create evidence/TASK-xxx/verify.md with:
- task_id
- risk_level
- verification_scope
- results for each check
- overall_result: PASS/FAIL
- Definition of Done checklist status

## Handling Verification Failure

When verification fails, classify the failure:

| Failure Type | Return To | Action |
|-------------|-----------|--------|
| Missing behavior | RED | Add test for missing behavior |
| Implementation defect | GREEN | Fix implementation |
| Refactoring regression | REFACTOR | Fix refactoring |
| Test defect | RED | Fix test |
| Integration issue | GREEN | Fix integration |
| Requirement ambiguity | BLOCKED | Clarify requirement |
| Architecture problem | BLOCKED | Review design |

**Principle**: Return to the earliest invalidated phase.

## Task Completion

When VERIFY passes:

1. Update task status to DONE
2. Update tdd.phase to COMPLETE
3. Update traceability with test refs and evidence path
4. Update project-state counters
5. Select next task or proceed to INTEGRATION

## TDD NOT_APPLICABLE

Only for tasks without executable behavior:

- Documentation-only
- Configuration without behavioral effect
- Static assets

Required fields:
- reason: Why TDD not applicable
- task_reference: The task ID
- risk_assessment: Must be LOW or NONE
- verification_alternative: How it was verified instead

## Guardrails

- NO production code without active task
- NO GREEN without RED evidence
- NO REFACTOR without GREEN evidence
- NO DONE without VERIFY evidence
- Evidence must match task and phase
- Evidence must contain required fields
