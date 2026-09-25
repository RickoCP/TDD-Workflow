---
name: "sdlc-workflow"
displayName: "SDLC Workflow"
description: "End-to-end Software Development Lifecycle workflow with TDD enforcement, requirement traceability, human approval gates, and session recovery."
keywords: ["sdlc", "tdd", "test driven", "requirement", "traceability", "workflow", "lifecycle", "red green refactor"]
author: "Kiro Power Builder"
---

# SDLC Workflow Power

## Overview

SDLC Workflow Power provides a comprehensive, auditable software development lifecycle framework.

The workflow ensures:
- **No coding before requirements are defined** - Requirements define WHAT
- **No implementation before design** - Design defines HOW  
- **No code changes without active tasks** - Tasks define WORK
- **Test-first development** - Tests define expected BEHAVIOR
- **Evidence-based verification** - Evidence proves RESULT
- **Recoverable state** - State defines WHERE WE ARE
- **Full history** - Git preserves HISTORY
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
  project-state.yaml    - AUTHORITATIVE runtime state
  traceability.yaml     - AUTHORITATIVE cross-references
  progress.md           - DERIVED summary
  requirements/         - REQ-xxx.md artifacts
  designs/              - DESIGN-xxx.md + adr/
  tasks/                - TASK-xxx.md artifacts
  evidence/             - TDD evidence per task
  changes/              - CR-xxx change requests
  decisions/            - DEC-xxx decisions
  blockers/             - BLOCKER-xxx issues
  releases/             - Release artifacts

## Human Approval Gates

| Gate | Transition | Purpose |
|------|------------|---------|
| REQ_REVIEW | REQUIREMENTS to DESIGN | Validate requirements |
| DESIGN_REVIEW | DESIGN to PLANNING | Validate architecture |
| PLAN_REVIEW | PLANNING to IMPLEMENTATION | Confirm task scope |
| RELEASE_READINESS | VERIFICATION to STAGING | Quality gate |
| PRODUCTION | STAGING to PRODUCTION | Production authorization |

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

Evidence must contain: task_id, phase, timestamp, command, result, test_file, test_name, git_ref

Evidence becomes STALE when implementation changes after verification.

## Versioning

workflow_version: "1.0.0"
schema_version: "1"

## Getting Started

1. Say "start SDLC project" or "initialize SDLC workflow"
2. Follow INTAKE phase to capture the idea
3. DISCOVERY phase analyzes your repository
4. Progress through lifecycle phases with guidance
5. Use "resume" after any session interruption
6. Use "status" to check current position

## Cross-Platform Support

Guard scripts use Node.js for cross-platform compatibility (Windows, Linux, macOS).
