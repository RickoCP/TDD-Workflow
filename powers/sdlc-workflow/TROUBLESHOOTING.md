
## Troubleshooting

### Guard Script Issues

**Problem: Guard blocks unexpected files**
- Check lifecycle.phase in .kiro/sdlc/project-state.yaml
- Verify current_task.id is set during IMPLEMENTATION
- Ensure current_task.tdd.phase reflects correct TDD state

**Problem: Guard allows when it should block**
- Verify .kiro/sdlc/project-state.yaml exists
- Check file classification patterns in guard script
- Ensure YAML parsing handles your state format

**Problem: Node.js not found**
- Install Node.js 18+ from nodejs.org
- Verify with: `node --version`

### State Recovery

**Problem: Inconsistent state after crash**
- Run `validate` to check state consistency
- Use `resume` to recover from last checkpoint
- Check git history for state file changes

**Problem: Lost work after interruption**
- State files are committed to git regularly
- Use `git log -- .kiro/sdlc/` to find recovery point
- Restore specific files with `git checkout <commit> -- <file>`

### TDD Issues

**Problem: Test passes unexpectedly in RED phase**
- STOP - do not proceed to GREEN
- Investigate: is the test actually testing the new behavior?
- Check if code already implements the feature
- Re-evaluate root cause analysis

**Problem: Cannot write production code**
- Verify you have an active task selected
- Check TDD phase is GREEN or REFACTOR
- Ensure TDD is not marked as NOT_APPLICABLE incorrectly

### Human Approval Gates

**Problem: Stuck at approval gate**
- Check pprovals section in project-state.yaml
- Verify required fields: approver, timestamp, outcome
- Use SKIP only for documented exceptions

### Common Commands

| Command | Purpose |
|---------|---------|
| `sdlc status` | Show current phase and task |
| `sdlc resume` | Recover after interruption |
| `sdlc validate` | Check workflow consistency |
| `sdlc task select <id>` | Activate a task |
| `sdlc tdd advance` | Move to next TDD phase |

## Installation

### 1. Copy Power to Kiro

Copy the `powers/sdlc-workflow` directory to your Kiro powers location.

### 2. Install Hook (Optional)

Copy guard script to project:
```bash
mkdir -p .kiro/hooks
cp powers/sdlc-workflow/scripts/sdlc-guard.js scripts/
```

Add hook configuration to `.kiro/hooks/hooks.json`:
```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "SDLC Phase Guard",
      "trigger": "PreToolUse",
      "matcher": "fs_write|str_replace|edit_file",
      "action": {
        "type": "command",
        "command": "node scripts/sdlc-guard.js"
      }
    }
  ]
}
```

### 3. Initialize Project

Say: "start SDLC project" or "initialize SDLC workflow"

The workflow will create `.kiro/sdlc/` with all necessary state files.

## Best Practices

1. **Commit state files regularly** - Include `.kiro/sdlc/` in commits
2. **Use meaningful task IDs** - TASK-001-user-auth not TASK-001
3. **Document NOT_APPLICABLE reasons** - Future maintainers need context
4. **Keep evidence fresh** - Re-verify after implementation changes
5. **Review before phase transitions** - State should match reality

