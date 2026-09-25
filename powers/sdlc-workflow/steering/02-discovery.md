---
inclusion: auto
name: "SDLC Discovery"
description: "Analyzes repository structure, architecture, and existing codebase before requirements"
---

# SDLC Discovery Phase

## Purpose

DISCOVERY performs read-only analysis of the repository to understand existing architecture, conventions, and constraints before defining requirements.

## When This Activates

- After INTAKE phase completes
- User says "discover", "analyze repo", "inspect codebase"
- Current phase is DISCOVERY

## Prerequisites

- SDLC initialized (project-state.yaml exists)
- lifecycle.phase == DISCOVERY or INTAKE

## CRITICAL CONSTRAINT

**NO CODE CHANGES DURING DISCOVERY**

This phase is strictly read-only. Only SDLC metadata files may be created/modified.

## Discovery Checklist

Analyze and document:

### Repository Structure
- [ ] Directory layout
- [ ] Module organization
- [ ] Monorepo vs single project

### Technology Stack
- [ ] Programming language(s)
- [ ] Framework(s)
- [ ] Runtime environment

### Build System
- [ ] Package manager (npm, pip, cargo, etc.)
- [ ] Build tool (webpack, gradle, make, etc.)
- [ ] Build scripts and commands

### Database and Storage
- [ ] Database type (SQL, NoSQL, etc.)
- [ ] ORM/data access layer
- [ ] Migration system

### API and Interfaces
- [ ] API style (REST, GraphQL, gRPC)
- [ ] API documentation
- [ ] External integrations

### Testing Infrastructure
- [ ] Test framework(s)
- [ ] Test organization
- [ ] Coverage tools
- [ ] CI test commands

### CI/CD
- [ ] CI platform
- [ ] Pipeline configuration
- [ ] Deployment targets

### Security
- [ ] Authentication mechanism
- [ ] Authorization model
- [ ] Security dependencies

### Observability
- [ ] Logging framework
- [ ] Monitoring setup
- [ ] Error tracking

### Documentation
- [ ] README quality
- [ ] API docs
- [ ] Architecture docs
- [ ] Coding conventions

### Git State
- [ ] Current branch
- [ ] Uncommitted changes
- [ ] Recent commit history

## Discovery Output

Create discovery report documenting:

### Known Facts
Confirmed information about the codebase.

### Assumptions
Things believed to be true but not verified.

### Unknowns
Information that could not be determined.

### Constraints
Technical or architectural constraints discovered.

### Dependencies
External dependencies and their versions.

### Risks
Technical risks identified during discovery.

### Affected Areas
Parts of codebase likely affected by the proposed change.

### Existing Relevant Behavior
Current functionality related to the proposed change.

### Existing Relevant Tests
Tests that cover related functionality.

### Open Questions
Questions that need answers before proceeding.

## Transition to REQUIREMENTS

After discovery completes:

1. Update project-state.yaml:
   - lifecycle.phase: REQUIREMENTS
   - last_action: "Discovery complete"

2. Create discovery summary in decisions/

3. Inform user of findings and proceed to requirements

## Guardrails

- NO production code changes
- NO test code changes
- Only SDLC metadata changes allowed
- Must complete discovery checklist
