# GHarness (agy-enhanced)

Runtime patches, interface indicators, and development harness utilities for Google Antigravity on macOS.

---

## Features

### 1. Context Window Indicator (HUD)
- **Compact UI Gauge**: Embedded 18px SVG ring in the chat prompt bar next to the model selector, showing remaining context capacity.
- **Token Breakdown**: Displays total tokens used, maximum limit, and detailed prompt cache statistics (input tokens, cached tokens, output tokens).
- **Theme Matching**: Automatically adapts colors to Antigravity's light and dark themes.
- **Swarm Indicator**: Displays active background worktree count and workspace paths.

### 2. Runtime Security & Sandbox Boundaries
- **Isolated Iframe Sandbox**: Generative UI artifacts run in sandboxed iframes with `sandbox="allow-scripts allow-forms allow-downloads allow-modals"`. The `allow-same-origin` token is omitted to keep artifact code isolated from the host application.
- **Unrestricted Frame Content Security Policy**: Allows generative UI artifacts to load external libraries (KaTeX, Three.js, Chart.js, Plotly.js, Tailwind, etc.) from CDNs while keeping the host process WebSockets unblocked.
- **Same-Origin Policy**: Enforces `webSecurity: true` on the main application window.
- **DevTools Access**: Keeps Chromium DevTools enabled for debugging artifacts and scripts.

### 3. Headless Chrome Visual Snapshots
- **Standalone CLI & Utility (`visual-snapshot` / `scripts/visual_snapshot.mjs`)**: Captures images of generated HTML artifacts using macOS Google Chrome. Installed globally in `~/.local/bin/visual-snapshot`.
- **Dual-Theme Capture**: The `--theme=both` flag generates both light and dark mode screenshots in one run.
- **Element Clipping**: The `--selector` option tightly clips screenshots to specific elements (such as charts or cards) to minimize image token size.
- **Smart Settle**: Waits for fonts, `requestAnimationFrame`, and optional `window.__UI_READY__` flags before capturing.
- **Zero NPM Dependencies**: Uses Chrome DevTools Protocol over native WebSockets with a direct CLI fallback.

### 4. Context Budget Telemetry
- **Fast Transcript Inspection (`context-budget` / `scripts/context_budget.mjs`)**: Standalone global CLI installed in `~/.local/bin/context-budget` that reads token usage and context limits from active session transcripts across any workspace.
- **Reverse Chunk Seeking**: Reads from the final 64KB of large transcript files directly on disk, avoiding loading large JSONL logs into memory.
- **Compaction Warnings**: Highlights when context reaches 75% (advisory) and 85% (recommended compaction).

### 5. Git Worktree Swarm Manager
- **Sibling Worktree Isolation (`worktree-swarm` / `scripts/worktree_manager.mjs`)**: Standalone global CLI installed in `~/.local/bin/worktree-swarm` that creates and manages separate Git worktrees in a sibling directory (`../worktrees/<feature-name>`), keeping parallel agent work outside the active editor workspace.
- **Project-Agnostic Repo Discovery**: Dynamically resolves the active Git repository root via `git rev-parse --show-toplevel`.
- **Automated Symlinks**: Automatically links `.venv`, `node_modules`, `.env`, and `AGENTS.md` (if present) into newly created worktrees so tools run immediately without reinstalling packages.
- **Clean Teardown**: Removes worktrees, runs `git worktree prune`, and deletes merged branches in a single command.

### 6. Multi-Agent Task Workboard
- **Workboard CLI (`scripts/doc_manager.mjs task`)**: Commands to list, claim, resolve, and block tasks recorded in `docs/INDEX.md`.
- **Atomic File Locking**: Uses POSIX `O_EXCL` file locks (`docs/.workboard.lock`) with timeout handling to prevent concurrent write collisions.
- **Role Enforcement**: Prevents review and audit roles from claiming implementation tasks.

### 7. Unified Regression Test Suite
- **Fast Test Runner (`npm test`)**: A 32-vector automated test suite (`scripts/tests/harness_test_suite.mjs`) that validates security boundaries, zero hardcoded paths, CSP rules, self-contained skills, worktree operations, and file locking in under 100ms.

### 8. Self-Contained Bundled Skills
- **`generative_ui`**: Guidelines for building interactive HTML widgets, coordinate plotting, KaTeX formulas, and Three.js/WebGL sizing rules with a 1-turn inline delivery workflow. Packaged with the `visual-snapshot` on-demand debugging CLI (`scripts/visual_snapshot.mjs`).
- **`worktree_swarm`**: Orchestration rules for parallel subagents across isolated Git worktrees. Packaged with `scripts/worktree_manager.mjs`.
- **Autonomous Learning (`/learn`)**: LLM-native distillation workflow codified in `~/.gemini/config/GEMINI.md` to semantically synthesize rules and skills directly from verified context with zero regex log scraping and strict secret redaction.
- **`ast_query`**: Symbol extraction utility (`scripts/ast_query.mjs`) for JS, TS, and Python files to quickly find function and class definitions.
- *(Note: Operational directives from `gemini_turbo` are unified into the always-on global rule `~/.gemini/config/GEMINI.md` to prevent duplicate context prompt tokens).*

---

## Quick Start

### 1. Patch Management
```bash
# Apply runtime patch to Antigravity
npm run patch

# Check patch installation and security status
npm run patch:status

# Revert Antigravity to original unpatched state
npm run patch:revert
```

### 2. Testing & Telemetry
```bash
# Run the 21-vector regression test suite
npm test

# Check current session token usage and context headroom
npm run context:budget

# Capture on-demand diagnostic snapshot of an HTML file (defaults to light mode)
npm run visual:snapshot -- path/to/file.html

# Clip screenshot tightly to a specific CSS selector or capture dark theme
npm run visual:snapshot -- path/to/file.html --selector="#chart" --theme=dark
```

### 3. Worktree Management
```bash
# Create an isolated sibling worktree and branch
npm run worktree:create -- my-feature

# List all active worktrees
npm run worktree:list

# Clean up worktree and delete the merged branch
npm run worktree:cleanup -- my-feature --delete-branch
```

### 4. Documentation & Tasks
```bash
# List tasks from the central workboard
npm run docs:task list

# Claim a task
npm run docs:task claim TASK-ID --role="core engineer"

# Mark a task resolved
npm run docs:task resolve TASK-ID

# Validate documentation schema and check link consistency
npm run docs:check

# Update the central index table
npm run docs:index
```

### 5. Skills & Code Exploration
```bash
# Synchronize skills to ~/.gemini/config/skills/
npm run skills:sync

# Scan file or folder for function/class symbols
npm run ast -- ./scripts/patch_antigravity.mjs
```

---

## Repository Structure

```text
GHarness/
├── scripts/
│   ├── patch_antigravity.mjs       # Main Electron ASAR patcher & codesign utility
│   ├── visual_snapshot.mjs         # Headless Chrome snapshot engine (CDP + CLI)
│   ├── context_budget.mjs          # Reverse-chunk transcript token telemetry CLI
│   ├── worktree_manager.mjs        # Sibling Git worktree lifecycle automation
│   ├── doc_manager.mjs             # Documentation indexing, checks, and task workboard
│   ├── ast_query.mjs               # AST-based code symbol extractor
│   ├── hud/
│   │   └── context_circle_hud.js   # Main-world Context Circle HUD implementation
│   └── tests/
│       └── harness_test_suite.mjs  # 32-vector regression test suite (npm test)
├── skills/
│   ├── generative_ui/              # UI artifact guidelines & scripts/visual_snapshot.mjs
│   └── worktree_swarm/             # Worktree swarm & scripts/worktree_manager.mjs
├── docs/                           # Local multi-agent collaboration documents (gitignored)
│   ├── INDEX.md                    # Single Source of Truth & component matrix
│   ├── PROGRESS.md                 # Technical chronicle and architecture log
│   └── handoff-*.md                # Role-specific handoffs
├── package.json                    # Scripts and project metadata
└── README.md                       # Project documentation
```
