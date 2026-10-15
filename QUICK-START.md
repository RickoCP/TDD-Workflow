# SDLC Workflow - Quick Start Guide

## Prerequisites

- **Node.js** (v14 or higher) - required for guard script
- **Git** - recommended for version control
- **Kiro IDE** - for full Power integration

## Installation Options

### Option A: Automated Setup (Recommended)

Use the setup script for one-command installation:

```bash
# From your project root directory
node path/to/powers/sdlc-workflow/scripts/sdlc-setup.cjs

# Or if the Power is installed globally
node ~/.kiro/powers/sdlc-workflow/scripts/sdlc-setup.cjs

# Windows example
node C:\Users\YourName\.kiro\powers\sdlc-workflow\scripts\sdlc-setup.cjs
```

This will automatically:
- ✅ Create all SDLC directories (`.kiro/sdlc/`, `scripts/`)
- ✅ Copy the guard script to `scripts/sdlc-guard.js`
- ✅ Set up the hook at `.kiro/hooks/sdlc-guard.json`
- ✅ Create `.gitkeep` files for version control

### Option B: Manual Setup

#### Step 1: Copy Power to Kiro

**Windows (PowerShell):**
```powershell
Copy-Item -Recurse powers\sdlc-workflow $env:USERPROFILE\.kiro\powers\
```

**Linux/macOS:**
```bash
cp -r powers/sdlc-workflow ~/.kiro/powers/
```

#### Step 2: Create Project Directories

**Windows (PowerShell):**
```powershell
# Create directories
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\requirements"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\designs\adr"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\tasks"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\evidence"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\checkpoints"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\findings"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\changes"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\decisions"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\blockers"
New-Item -ItemType Directory -Force -Path ".kiro\sdlc\releases"
New-Item -ItemType Directory -Force -Path ".kiro\hooks"
New-Item -ItemType Directory -Force -Path "scripts"
```

**Linux/macOS:**
```bash
mkdir -p .kiro/sdlc/{requirements,designs/adr,tasks,evidence,checkpoints,findings,changes,decisions,blockers,releases}
mkdir -p .kiro/hooks scripts
```

#### Step 3: Copy Guard Script

**Windows (PowerShell):**
```powershell
Copy-Item path\to\powers\sdlc-workflow\scripts\sdlc-guard.cjs scripts\
```

**Linux/macOS:**
```bash
cp path/to/powers/sdlc-workflow/scripts/sdlc-guard.cjs scripts/
```

#### Step 4: Create Hook Configuration

Create file `.kiro/hooks/sdlc-guard.json`:

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "SDLC Phase Guard",
      "trigger": "PreToolUse",
      "matcher": "fs_write|str_replace|edit_file|fs_append",
      "action": {
        "type": "command",
        "command": "node scripts/sdlc-guard.cjs"
      }
    }
  ]
}
```

## Initialize Workflow

After setup, say to Kiro: **"start SDLC project"**

The agent will guide you through:
1. **INTAKE** phase - capturing your idea
2. **DISCOVERY** phase - analyzing your repository
3. **REQUIREMENTS** phase - defining what to build
4. And subsequent lifecycle phases...

## Verify Setup

Your project should now have this structure:

```
your-project/
├── .kiro/
│   ├── hooks/
│   │   └── sdlc-guard.json    ✅ Hook configuration
│   └── sdlc/
│       ├── requirements/       ✅ Will contain REQ-xxx.md
│       ├── designs/            ✅ Will contain DESIGN-xxx.md
│       │   └── adr/            ✅ Architecture Decision Records
│       ├── tasks/              ✅ Will contain TASK-xxx.md
│       ├── evidence/           ✅ TDD evidence
│       ├── checkpoints/        ✅ Recovery checkpoints
│       ├── findings/           ✅ Review findings
│       ├── changes/            ✅ Change requests
│       ├── decisions/          ✅ Decisions
│       ├── blockers/           ✅ Blockers
│       └── releases/           ✅ Release artifacts
└── scripts/
    └── sdlc-guard.cjs          ✅ Guard script
```

## Common Commands

| Say This | Does This |
|----------|-----------|
| "start SDLC project" | Initialize workflow |
| "resume" | Recover from interruption |
| "status" | Show current phase/task |
| "validate" | Check state consistency |
| "checkpoint" | Create recovery checkpoint |

## Troubleshooting

### Guard script not working?

1. Verify Node.js is installed: `node --version`
2. Check script exists: `scripts/sdlc-guard.cjs`
3. Check hook exists: `.kiro/hooks/sdlc-guard.json`

### Need to reset SDLC state?

Delete `.kiro/sdlc/project-state.yaml` and say "start SDLC project" again.

### More help?

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for detailed solutions.
