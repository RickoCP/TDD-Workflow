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
  changes/
  decisions/
  blockers/
  releases/
```

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
