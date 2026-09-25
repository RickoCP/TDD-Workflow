---
inclusion: auto
name: "SDLC Status"
description: "Reports current workflow status and progress"
---

# SDLC Status Reporting

## Purpose

Report current workflow position and progress.

## When This Activates

- User says "status", "progress", "where are we"

## Status Report Content

### Lifecycle Position

- Current phase
- Phase started timestamp
- Last transition

### Milestone

- Current milestone ID and name
- Target date (if set)

### Requirements Progress

| Status | Count |
|--------|-------|
| DRAFT | X |
| REVIEW | X |
| APPROVED | X |
| FROZEN | X |
| Total | X |

### Task Progress

| Status | Count |
|--------|-------|
| TODO | X |
| READY | X |
| IN_PROGRESS | X |
| BLOCKED | X |
| VERIFY | X |
| DONE | X |
| Total | X |

### Current Task (if any)

- Task ID
- Task status
- TDD phase
- Phase started timestamp

### Blockers

- Count
- IDs and brief descriptions

### Pending Changes

- Count
- CR IDs

### Release Status

- Current release status
- Target version

### Last Action

- What was done
- Timestamp
- Result

### Next Permitted Actions

List of valid next actions based on current state.

## Validation Status

If validation has been run:

- Last validated timestamp
- Result (VALID/WARNINGS/ERRORS)
- Issues if any

## Progress Summary

Human-readable summary of overall progress toward milestone completion.
