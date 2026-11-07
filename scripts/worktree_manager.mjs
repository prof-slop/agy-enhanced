#!/usr/bin/env node

/**
 * worktree_manager.mjs
 * 
 * Project-Agnostic Sibling Git Worktree Swarm Lifecycle Manager.
 * Automates creation, listing, and cleanup of isolated worktrees at ../worktrees/<name>,
 * with dynamic repository root discovery (git rev-parse --show-toplevel),
 * safe universal symlink bootstrapping (.venv, node_modules, .env, AGENTS.md),
 * slug validation, and stale lock pruning.
 *
 * Usage:
 *   worktree-swarm create <feature-name>
 *   worktree-swarm list [--json]
 *   worktree-swarm cleanup <feature-name> [--force] [--delete-branch]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dynamically discover Git repository root for active workspace.
 */
export function getRepoRoot(cwd = process.cwd()) {
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (root && fs.existsSync(root)) return root;
  } catch (_) {}
  return null;
}

/**
 * Resolve sibling worktrees directory relative to repository root.
 */
export function getWorktreesDir(repoRoot) {
  const root = repoRoot || getRepoRoot();
  if (!root) return null;
  return path.resolve(root, '..', 'worktrees');
}

/**
 * Strict slug validation to prevent directory traversal or shell argument injection.
 */
export function validateWorktreeName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Worktree name is required.');
  }
  const trimmed = name.trim();
  if (!/^[a-z0-9_-]+$/i.test(trimmed)) {
    throw new Error(`Invalid worktree name '${name}'. Must be alphanumeric with dashes or underscores only (slug).`);
  }
  return trimmed;
}

/**
 * Prune stale worktrees and clear orphan locks in .git/worktrees/.
 */
export function pruneStaleWorktrees(name, repoRoot) {
  const root = repoRoot || getRepoRoot();
  if (!root) return;
  try {
    execSync('git worktree prune', { cwd: root, stdio: 'pipe' });
  } catch {}

  if (name) {
    const gitDir = path.join(root, '.git', 'worktrees', name);
    const lockFile = path.join(gitDir, 'locked');
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
        console.log(`🧹 Cleared stale worktree lock: .git/worktrees/${name}/locked`);
      } catch {}
    }
  }
}

/**
 * SUBCOMMAND: create <feature-name>
 */
export function createWorktree(rawName, options = {}) {
  const name = validateWorktreeName(rawName);
  const repoRoot = options.repoRoot || getRepoRoot();
  if (!repoRoot) {
    throw new Error('Cannot create worktree: Current directory is not a Git repository.');
  }
  const worktreesDir = getWorktreesDir(repoRoot);
  const targetPath = path.join(worktreesDir, name);
  const branchName = `feature/${name}`;

  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }

  if (fs.existsSync(targetPath)) {
    throw new Error(`Target worktree directory already exists: ${targetPath}`);
  }

  pruneStaleWorktrees(name, repoRoot);

  // Check if branch already exists
  let branchExists = false;
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, { cwd: repoRoot, stdio: 'pipe' });
    branchExists = true;
  } catch {}

  const cmd = branchExists
    ? `git worktree add "${targetPath}" "${branchName}"`
    : `git worktree add -b "${branchName}" "${targetPath}"`;

  console.log(`🌱 Creating isolated sibling worktree at ${targetPath}...`);
  execSync(cmd, { cwd: repoRoot, stdio: 'pipe' });

  // Safe universal bootstrap: symlink common root files if they exist in repoRoot
  const candidates = ['.venv', 'node_modules', '.env', 'AGENTS.md'];
  const bootstrapped = [];
  for (const item of candidates) {
    const src = path.join(repoRoot, item);
    const dest = path.join(targetPath, item);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.symlinkSync(src, dest);
        bootstrapped.push(item);
      } catch (_) {}
    }
  }

  console.log(`\n✅ Isolated Worktree Created:`);
  console.log(`   Path:         ${targetPath}`);
  console.log(`   Branch:       ${branchName}`);
  console.log(`   Bootstrapped: ${bootstrapped.length > 0 ? bootstrapped.join(', ') : 'None needed'}`);
  console.log(`\n📋 Ready-to-use subagent prompt:`);
  console.log(JSON.stringify({
    Role: `Worktree Runner (${name})`,
    TypeName: 'self',
    Workspace: 'inherit',
    Prompt: `Execute tasks in isolated worktree at ${targetPath} on branch ${branchName}. Test, verify, and commit locally. NEVER git push without explicit user instruction.`
  }, null, 2));
}

/**
 * SUBCOMMAND: list [--json]
 */
export function listWorktrees(isJson = false, options = {}) {
  const repoRoot = options.repoRoot || getRepoRoot();
  if (!repoRoot) {
    if (isJson) {
      console.log(JSON.stringify([], null, 2));
      return [];
    }
    console.log('Notice: Not currently inside a Git repository. No active worktrees.');
    return [];
  }
  pruneStaleWorktrees(null, repoRoot);
  let raw = '';
  try {
    raw = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  } catch (err) {
    throw new Error(`Failed to list worktrees: ${err.message}`);
  }

  const entries = [];
  const blocks = raw.trim().split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    const entry = {};
    for (const line of lines) {
      if (line.startsWith('worktree ')) entry.worktree = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD ')) entry.head = line.slice('HEAD '.length).trim();
      else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
      else if (line === 'bare') entry.bare = true;
      else if (line.startsWith('locked')) entry.locked = true;
    }
    if (entry.worktree) {
      const isRoot = path.resolve(entry.worktree) === repoRoot;
      entry.isRoot = isRoot;
      entry.exists = fs.existsSync(entry.worktree);
      entries.push(entry);
    }
  }

  if (isJson) {
    console.log(JSON.stringify(entries, null, 2));
    return entries;
  }

  console.log('🌿 Active Git Worktrees:\n');
  console.log('| Path | Branch | Type | Status |');
  console.log('| :--- | :--- | :--- | :--- |');
  for (const e of entries) {
    const type = e.isRoot ? 'Root Repo' : 'Sibling Worktree';
    const status = e.locked ? '🔒 Locked' : (e.exists ? '🟢 Active' : '🔴 Missing');
    console.log(`| \`${e.worktree}\` | \`${e.branch || 'detached'}\` | ${type} | ${status} |`);
  }
  console.log('');
  return entries;
}

/**
 * SUBCOMMAND: cleanup <feature-name> [--force] [--delete-branch]
 */
export function cleanupWorktree(rawName, options = {}) {
  const name = validateWorktreeName(rawName);
  const repoRoot = options.repoRoot || getRepoRoot();
  if (!repoRoot) {
    throw new Error('Cannot cleanup worktree: Current directory is not a Git repository.');
  }
  const worktreesDir = getWorktreesDir(repoRoot);
  const targetPath = path.join(worktreesDir, name);
  const branchName = `feature/${name}`;
  const force = options.force || false;
  const deleteBranch = options.deleteBranch || false;

  console.log(`🧹 Removing worktree at ${targetPath}...`);

  if (fs.existsSync(targetPath)) {
    try {
      execSync(`git worktree remove ${force ? '--force' : ''} "${targetPath}"`, { cwd: repoRoot, stdio: 'pipe' });
    } catch (err) {
      // If failed due to untracked files or bootstrapped symlinks, retry with --force
      try {
        execSync(`git worktree remove --force "${targetPath}"`, { cwd: repoRoot, stdio: 'pipe' });
      } catch (forceErr) {
        throw new Error(`Could not remove worktree: ${forceErr.message}`);
      }
    }
  }

  pruneStaleWorktrees(name, repoRoot);

  // If directory still exists on disk, safely purge it if strictly within worktreesDir
  if (fs.existsSync(targetPath)) {
    const resolved = path.resolve(targetPath);
    if (resolved.startsWith(worktreesDir + path.sep)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }

  if (deleteBranch) {
    try {
      execSync(`git branch -D "${branchName}"`, { cwd: repoRoot, stdio: 'pipe' });
      console.log(`🗑️ Deleted local branch ${branchName}`);
    } catch {}
  }

  console.log(`✅ Worktree '${name}' cleaned up successfully.\n`);
}

// Direct Execution Router
const isDirectCli = process.argv[1] && (() => {
  try {
    const resolvedArg = path.resolve(process.argv[1]);
    const resolvedFile = path.resolve(__filename);
    if (resolvedArg === resolvedFile) return true;
    return fs.existsSync(resolvedArg) && fs.realpathSync(resolvedArg) === fs.realpathSync(resolvedFile);
  } catch (_) {
    return false;
  }
})();

if (isDirectCli) {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  try {
    switch (command) {
      case 'create':
        createWorktree(args[1]);
        break;
      case 'list':
        listWorktrees(args.includes('--json'));
        break;
      case 'cleanup':
      case 'remove':
      case 'rm':
        cleanupWorktree(args[1], {
          force: args.includes('--force'),
          deleteBranch: args.includes('--delete-branch')
        });
        break;
      default:
        console.log(`Unknown command: ${command}`);
        console.log('Usage: worktree-swarm [create|list|cleanup]');
        process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}
