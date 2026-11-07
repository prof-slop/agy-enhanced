---
name: worktree-swarm
description: Coordinates parallel subagents and experimental workflows across isolated Git worktrees. Use when you need to test bug fixes, run benchmarks, or refactor without touching the user's active working directory or editor window, and optionally open draft PRs via GitHub CLI.
---

# Git Worktree Swarm & PR Automation

Execute isolated development workflows, parallel test runs, and zero-risk refactors using native Git Worktrees (`../worktrees/<feature-name>`) with automatic `.venv`, `node_modules`, and `.env` symlinking.

## Standard Orchestration Protocol

1. **Create an Isolated Worktree**:
   ```bash
   worktree-swarm create <feature-name>
   # Fallback: node ~/.gemini/config/skills/worktree_swarm/scripts/worktree_manager.mjs create <feature-name>
   ```
2. **Delegate to an Isolated Subagent**:
   ```javascript
   invoke_subagent({
     TypeName: 'self',
     Role: 'Worktree Test Runner',
     Workspace: 'inherit',
     Prompt: 'Navigate to ../worktrees/<feature-name>, run unit tests, and report results.'
   });
   ```
3. **Verify & Commit Locally**:
   ```bash
   cd ../worktrees/<feature-name> && git status -s && git add . && git commit -m "feat: <description>"
   ```
4. **Push & Open Draft PR (Explicit User Permission Required)**:
   > [!IMPORTANT]
   > **Git Push Invariant:** Never execute `git push` or `gh pr create` without explicit user instruction in that turn.
   ```bash
   git push -u origin feature/<feature-name> && gh pr create --title "feat: <description>" --body "Automated worktree PR." --draft
   ```
5. **Safe Teardown**:
   ```bash
   worktree-swarm cleanup <feature-name>
   ```
