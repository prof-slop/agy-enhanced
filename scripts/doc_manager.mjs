#!/usr/bin/env node

/**
 * doc_manager.mjs
 * 
 * Documentation & Multi-Agent Collaboration CLI for GHarness.
 * Automates handoff linting, dynamic index registry generation,
 * scaffolding from template, and repository health status.
 *
 * Usage:
 *   node scripts/doc_manager.mjs whoami [--convo=<uuid>]
 *   node scripts/doc_manager.mjs check
 *   node scripts/doc_manager.mjs index
 *   node scripts/doc_manager.mjs new ["role name"] [--convo=<uuid>]
 *   node scripts/doc_manager.mjs worktree-init <worktree-path>
 *   node scripts/doc_manager.mjs resolve "role name"
 *   node scripts/doc_manager.mjs status
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const INDEX_PATH = path.join(DOCS_DIR, 'INDEX.md');
const TEMPLATE_PATH = path.join(DOCS_DIR, 'template-handoff.md');

const VALID_STATUSES = new Set([
  'IN_PROGRESS',
  'COMPLETED',
  'RESOLVED',
  'BLOCKED',
  'AUDIT_COMPLETED',
  'SUPERSEDED',
  'ARCHIVED'
]);

/**
 * Parse simple YAML frontmatter without external dependencies.
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) return null;

  const rawYaml = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 4).trim();
  const data = {};

  const lines = rawYaml.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let val = trimmed.slice(colonIdx + 1).trim();

    // Strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else if (val.startsWith('[') && val.endsWith(']')) {
      // Parse simple inline array
      const inner = val.slice(1, -1).trim();
      val = inner ? inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')) : [];
    }

    data[key] = val;
  }

  return { data, body };
}

/**
 * Convert string to safe kebab-case.
 */
function toKebabCase(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Get current git branch safely.
 */
function getCurrentBranch() {
  try {
    return execSync('git branch --show-current', { cwd: REPO_ROOT, encoding: 'utf8' }).trim() || 'main';
  } catch {
    return 'main';
  }
}

/**
 * Auto-detect the most recently active conversation UUID from ~/.gemini/antigravity/brain.
 */
function detectLatestConvoId() {
  try {
    const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
    if (!fs.existsSync(brainDir)) return 'unassigned';
    const candidates = fs.readdirSync(brainDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^[0-9a-f-]{36}$/i.test(d.name))
      .map(d => {
        const p = path.join(brainDir, d.name, '.system_generated', 'logs', 'transcript.jsonl');
        return fs.existsSync(p) ? { id: d.name, mtime: fs.statSync(p).mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    return candidates.length > 0 ? candidates[0].id : 'unassigned';
  } catch {
    return 'unassigned';
  }
}

/**
 * Look up the user-assigned UI conversation title from ~/.gemini/antigravity/annotations/<convoId>.pbtxt
 * (with fallback to conversation_summaries.db).
 */
function lookupUiTitleForConvo(convoId) {
  if (!convoId || convoId === 'unassigned' || !/^[0-9a-f-]{36}$/i.test(convoId)) {
    return null;
  }
  try {
    const pbtxtPath = path.join(os.homedir(), '.gemini', 'antigravity', 'annotations', `${convoId}.pbtxt`);
    if (fs.existsSync(pbtxtPath)) {
      const raw = fs.readFileSync(pbtxtPath, 'utf8');
      const m = raw.match(/title:\s*"([^"]+)"/);
      if (m && m[1]) return m[1].trim();
    }
  } catch {}
  try {
    const dbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
    if (fs.existsSync(dbPath)) {
      const out = execSync(
        `sqlite3 "${dbPath}" "SELECT title FROM conversation_summaries WHERE conversation_id='${convoId}' LIMIT 1;"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (out) return out;
    }
  } catch {}
  return null;
}

/**
 * List all handoff files in docs/.
 */
function getHandoffFiles() {
  if (!fs.existsSync(DOCS_DIR)) return [];
  return fs.readdirSync(DOCS_DIR)
    .filter(f => f.startsWith('handoff-') && f.endsWith('.md'))
    .sort();
}

/**
 * SUBCOMMAND: check
 * Lints all handoffs for schema compliance, naming, and dead links.
 */
function cmdCheck() {
  console.log('🔍 Checking documentation consistency and handoff schemas in docs/...\n');
  const handoffs = getHandoffFiles();
  let errors = 0;
  let checkedCount = 0;

  if (handoffs.length === 0) {
    console.warn('⚠️  No handoff files found in docs/');
    return;
  }

  for (const filename of handoffs) {
    checkedCount++;
    const filePath = path.join(DOCS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');

    // 1. Filename format check
    if (!/^handoff-[a-z0-9_-]+\.md$/.test(filename)) {
      console.error(`❌ [${filename}]: Filename must be strictly lowercase kebab-case 'handoff-{role}.md'.`);
      errors++;
      continue;
    }

    // 2. Frontmatter check
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      console.error(`❌ [${filename}]: Missing or malformed YAML frontmatter.`);
      errors++;
      continue;
    }

    const { data } = parsed;
    const requiredFields = ['role', 'assigned_name', 'convo_id', 'branch', 'status', 'updated', 'summary'];
    const missing = requiredFields.filter(f => !data[f]);

    if (missing.length > 0) {
      console.error(`❌ [${filename}]: Missing required frontmatter fields: ${missing.join(', ')}`);
      errors++;
    }

    if (data.convo_id && data.convo_id !== 'unassigned' && !/^[0-9a-f-]{36}$/i.test(data.convo_id)) {
      console.error(`❌ [${filename}]: Invalid convo_id '${data.convo_id}'. Must be a 36-char UUID or 'unassigned'.`);
      errors++;
    }

    // 3. Status validation
    if (data.status && !VALID_STATUSES.has(data.status)) {
      console.error(`❌ [${filename}]: Invalid status '${data.status}'. Must be one of: ${[...VALID_STATUSES].join(', ')}`);
      errors++;
    }

    // 4. Role alignment check
    const expectedRoleSlug = filename.replace(/^handoff-/, '').replace(/\.md$/, '');
    const actualRoleSlug = toKebabCase(data.role || '');
    if (actualRoleSlug && actualRoleSlug !== expectedRoleSlug) {
      console.warn(`⚠️  [${filename}]: Frontmatter role slug '${actualRoleSlug}' deviates from filename slug '${expectedRoleSlug}'.`);
    }

    // 5. Internal link check
    const linkMatches = content.matchAll(/\[.*?\]\((docs\/.*?\.(?:md|html|mjs|js)|handoff-.*?\.(?:md|html|mjs|js))\)/g);
    for (const match of linkMatches) {
      let targetPath = match[1];
      if (targetPath.startsWith('docs/')) {
        targetPath = path.join(REPO_ROOT, targetPath);
      } else {
        targetPath = path.join(DOCS_DIR, targetPath);
      }
      if (!fs.existsSync(targetPath)) {
        console.error(`❌ [${filename}]: Broken local file link '${match[1]}'`);
        errors++;
      }
    }
  }

  // 6. Tier-1 Index budget and matrix marker validation
  if (fs.existsSync(INDEX_PATH)) {
    const indexText = fs.readFileSync(INDEX_PATH, 'utf8');
    if (!indexText.includes('<!-- MATRIX_START -->') || !indexText.includes('<!-- MATRIX_END -->')) {
      console.error('❌ [INDEX.md]: Missing <!-- MATRIX_START --> or <!-- MATRIX_END --> markers.');
      errors++;
    }
    const lines = indexText.split('\n').length;
    if (lines > 100) {
      console.warn(`⚠️  [INDEX.md]: Tier-1 Index budget warning: ${lines} lines (budget is <100 lines).`);
    }
  }

  console.log(`\nChecked ${checkedCount} handoff document(s).`);
  if (errors > 0) {
    console.error(`❌ Lint failed with ${errors} error(s).\n`);
    process.exit(1);
  } else {
    console.log('✅ All documentation handoffs adhere to repository rules and schemas.\n');
  }
}

/**
 * SUBCOMMAND: index
 * Rebuilds the Handoff Registry table inside docs/INDEX.md.
 */
function cmdIndex() {
  console.log('📋 Updating Handoff Registry in docs/INDEX.md...');
  const handoffs = getHandoffFiles();
  const records = [];

  for (const filename of handoffs) {
    const filePath = path.join(DOCS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const { data } = parsed;
    records.push({
      filename,
      assigned_name: data.assigned_name || data.role || filename,
      convo_id: data.convo_id || 'unassigned',
      branch: data.branch || 'unknown',
      status: data.status || 'IN_PROGRESS',
      updated: data.updated || 'unknown',
      summary: data.summary || 'No summary provided.'
    });
  }

  // Generate markdown table with Convo ID for 3-Tier Documentation Registry
  let table = '| Assigned Role | Conversation ID | Document | Branch | Status | Updated | Summary |\n';
  table += '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';
  for (const r of records) {
    const convoCell = r.convo_id && r.convo_id !== 'unassigned'
      ? `[\`${r.convo_id}\`](conversation://${r.convo_id})`
      : '`unassigned`';
    table += `| **${r.assigned_name}** | ${convoCell} | [\`${r.filename}\`](${r.filename}) | \`${r.branch}\` | \`${r.status}\` | ${r.updated} | ${r.summary} |\n`;
  }

  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`❌ docs/INDEX.md does not exist. Please initialize it first.`);
    process.exit(1);
  }

  let indexContent = fs.readFileSync(INDEX_PATH, 'utf8');
  const startMarker = '<!-- REGISTRY_START -->';
  const endMarker = '<!-- REGISTRY_END -->';

  const startIdx = indexContent.indexOf(startMarker);
  const endIdx = indexContent.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    console.error(`❌ Markers <!-- REGISTRY_START --> or <!-- REGISTRY_END --> not found in docs/INDEX.md`);
    process.exit(1);
  }

  const newContent = indexContent.slice(0, startIdx + startMarker.length) +
    '\n\n' + table.trim() + '\n\n' +
    indexContent.slice(endIdx);

  const stagedPath = `${INDEX_PATH}.staged`;
  fs.writeFileSync(stagedPath, newContent, 'utf8');
  fs.renameSync(stagedPath, INDEX_PATH);
  console.log(`✅ Successfully indexed ${records.length} handoff document(s) atomically into docs/INDEX.md\n`);
}

/**
 * SUBCOMMAND: new [<role>] [--convo=<uuid>]
 * Scaffolds a new handoff document from template-handoff.md.
 * Auto-resolves the exact user-assigned UI sidebar title when --convo is provided or detected.
 */
function cmdNew(rawArgs) {
  let convoId = null;
  const roleParts = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a.startsWith('--convo=')) {
      convoId = a.slice('--convo='.length).trim();
    } else if (a === '--convo' && rawArgs[i + 1]) {
      convoId = rawArgs[++i].trim();
    } else {
      roleParts.push(a);
    }
  }

  const resolvedConvoId = convoId || detectLatestConvoId();
  const uiTitle = lookupUiTitleForConvo(resolvedConvoId);
  const cliRole = roleParts.join(' ').trim();
  const rawRole = (uiTitle ? uiTitle.toLowerCase() : cliRole.toLowerCase()).trim();

  if (uiTitle && cliRole && toKebabCase(uiTitle) !== toKebabCase(cliRole)) {
    console.log(`ℹ️  Enforcing user-assigned UI tab title "${uiTitle.toLowerCase()}" over "${cliRole}" (Rule of Assigned Identity).`);
  }

  if (!rawRole) {
    console.error('❌ Error: Could not determine role name. Pass role name or --convo=<uuid>.');
    console.error('Usage: npm run docs:new -- --convo=<uuid>');
    process.exit(1);
  }

  const roleSlug = toKebabCase(rawRole);
  const targetFile = `handoff-${roleSlug}.md`;
  const targetPath = path.join(DOCS_DIR, targetFile);

  if (fs.existsSync(targetPath)) {
    console.error(`❌ Error: Document already exists at ${targetPath}`);
    console.error('To update it, edit the file directly or specify a different role.');
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`❌ Template not found at ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const branch = getCurrentBranch();
  const today = new Date().toISOString().slice(0, 10);

  const populated = template
    .replaceAll('{{role}}', roleSlug)
    .replaceAll('{{assigned_name}}', rawRole)
    .replaceAll('{{convo_id}}', resolvedConvoId)
    .replaceAll('{{branch}}', branch)
    .replaceAll('{{updated}}', today)
    .replaceAll('{{status}}', 'IN_PROGRESS')
    .replace('role: role-name', `role: ${roleSlug}`)
    .replace('assigned_name: "Role Name"', `assigned_name: "${rawRole}"`)
    .replace('convo_id: "unassigned"', `convo_id: "${resolvedConvoId}"`)
    .replace('title: "Technical Handoff: Role Name"', `title: "Technical Handoff: ${rawRole}"`)
    .replace('branch: branch-name', `branch: ${branch}`)
    .replace('updated: YYYY-MM-DD', `updated: ${today}`);

  fs.writeFileSync(targetPath, populated, 'utf8');
  console.log(`✅ Created compliant handoff document: docs/${targetFile}`);
  console.log(`   Assigned Role: "${rawRole}"${uiTitle ? ` (auto-detected from UI tab "${uiTitle}")` : ''}`);
  console.log(`   Convo ID:      ${resolvedConvoId}`);
  console.log(`   Active Branch: ${branch}`);
  console.log(`\nRemember to populate the sections and run 'npm run docs:index' when finishing your turn.\n`);
}

/**
 * SUBCOMMAND: whoami [--convo=<uuid>]
 * Resolves a conversation's exact user-assigned sidebar role title from Antigravity's local store.
 */
function cmdWhoami(rawArgs) {
  let convoId = null;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a.startsWith('--convo=')) convoId = a.slice('--convo='.length).trim();
    else if (a === '--convo' && rawArgs[i + 1]) convoId = rawArgs[++i].trim();
    else if (/^[0-9a-f-]{36}$/i.test(a)) convoId = a.trim();
  }
  const resolvedConvoId = convoId || detectLatestConvoId();
  const uiTitle = lookupUiTitleForConvo(resolvedConvoId);
  const roleName = (uiTitle || 'unassigned').toLowerCase();
  const slug = toKebabCase(roleName);
  console.log(`Conversation ID : ${resolvedConvoId}`);
  console.log(`UI Tab Title    : ${uiTitle || '(not set in sidebar)'}`);
  console.log(`Assigned Role   : ${roleName}`);
  console.log(`Handoff File    : docs/handoff-${slug}.md`);
}

/**
 * SUBCOMMAND: resolve <role>
 * Resolves a role name to its registered Conversation ID.
 */
function cmdResolve(rawRole) {
  if (!rawRole) {
    console.error('❌ Usage: npm run docs:resolve -- "<role name>"');
    process.exit(1);
  }
  const slug = toKebabCase(rawRole);
  const targetPath = path.join(DOCS_DIR, `handoff-${slug}.md`);
  if (!fs.existsSync(targetPath)) {
    console.error(`❌ No handoff found for role '${rawRole}' (expected docs/handoff-${slug}.md)`);
    process.exit(1);
  }
  const parsed = parseFrontmatter(fs.readFileSync(targetPath, 'utf8'));
  const convoId = parsed?.data?.convo_id || 'unassigned';
  console.log(convoId);
}

/**
 * SUBCOMMAND: status
 * High-density CLI status dashboard.
 */
function cmdStatus() {
  const branch = getCurrentBranch();
  const handoffs = getHandoffFiles();
  console.log('=================================================================');
  console.log(` 🧭 GHarness Documentation & Collaboration Status`);
  console.log(` 🌿 Active Branch: ${branch}`);
  console.log('=================================================================\n');

  console.log('📂 Registered Handoffs:');
  for (const filename of handoffs) {
    const filePath = path.join(DOCS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const { data } = parsed;
    const statusIcon = data.status === 'COMPLETED' || data.status === 'RESOLVED' ? '✅' :
      data.status === 'BLOCKED' ? '🛑' :
      data.status === 'AUDIT_COMPLETED' ? '⚖️' : '⏳';

    console.log(`  ${statusIcon} [${data.status || 'UNKNOWN'}] ${data.assigned_name || data.role} (${filename})`);
    console.log(`     Convo ID: ${data.convo_id || 'unassigned'} | Branch: ${data.branch || 'unknown'} | Updated: ${data.updated || 'unknown'}`);
    console.log(`     Summary: ${data.summary || 'None'}`);
    if (data.blockers && data.blockers.length > 0) {
      console.log(`     Blockers: ${Array.isArray(data.blockers) ? data.blockers.join(', ') : data.blockers}`);
    }
    console.log('');
  }
}

/**
 * SUBCOMMAND: worktree-init <dir>
 * Symlinks gitignored AGENTS.md, docs/, and .venv into an isolated git worktree.
 */
function cmdWorktreeInit(targetDir) {
  if (!targetDir) {
    console.error('❌ Usage: npm run docs:worktree -- <worktree-path>');
    process.exit(1);
  }
  const resolvedTarget = path.resolve(REPO_ROOT, targetDir);
  if (!fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isDirectory()) {
    console.error(`❌ Target worktree directory does not exist: ${resolvedTarget}`);
    process.exit(1);
  }
  for (const item of ['AGENTS.md', 'docs', '.venv']) {
    const src = path.join(REPO_ROOT, item);
    const dest = path.join(resolvedTarget, item);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.symlinkSync(src, dest);
        console.log(`🔗 Linked ${item} -> ${dest}`);
      } catch (err) {
        console.warn(`⚠️ Could not symlink ${item}: ${err.message}`);
      }
    }
  }
  console.log(`✅ Worktree at ${resolvedTarget} initialized with 3-Tier Docs & Python .venv.\n`);
}

/**
 * SUBCOMMAND: task [list|claim|resolve|block]
 * Atomic workboard task state transitions with POSIX O_EXCL advisory locking
 * and programmatic auditor/implementer role boundary enforcement.
 */
const WORKBOARD_LOCK_FILE = path.join(DOCS_DIR, '.workboard.lock');
const LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_AGE_MS = 15000;
const AUDITOR_ROLES = new Set(['tester', 'tester 1', 'tester 2', 'code reviewer', 'code-reviewer']);

function isAuditorRole(role) {
  if (!role) return false;
  return AUDITOR_ROLES.has(role.toLowerCase().trim());
}

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function acquireWorkboardLock() {
  const start = Date.now();
  let lockAcquired = false;

  const cleanupExit = () => {
    if (lockAcquired) {
      try { fs.unlinkSync(WORKBOARD_LOCK_FILE); } catch (_) {}
    }
  };
  process.once('exit', cleanupExit);

  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      const fd = fs.openSync(WORKBOARD_LOCK_FILE, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() }));
      fs.closeSync(fd);
      lockAcquired = true;
      return () => {
        lockAcquired = false;
        process.removeListener('exit', cleanupExit);
        try { fs.unlinkSync(WORKBOARD_LOCK_FILE); } catch (_) {}
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (fs.existsSync(WORKBOARD_LOCK_FILE)) {
          const lockRaw = fs.readFileSync(WORKBOARD_LOCK_FILE, 'utf8');
          const lockData = JSON.parse(lockRaw);
          if (!isPidAlive(lockData.pid) || (Date.now() - lockData.time > 5000)) {
            try { fs.unlinkSync(WORKBOARD_LOCK_FILE); } catch (_) {}
            continue;
          }
        }
      } catch (_) {}
      const sleepEnd = Date.now() + 25 + Math.floor(Math.random() * 40);
      while (Date.now() < sleepEnd) {}
    }
  }
  process.removeListener('exit', cleanupExit);
  throw new Error('Lock acquisition timeout on docs/.workboard.lock');
}

function parseMatrix(content) {
  const startMarker = '<!-- MATRIX_START -->';
  const endMarker = '<!-- MATRIX_END -->';
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Missing <!-- MATRIX_START --> or <!-- MATRIX_END --> markers in docs/INDEX.md');
  }

  const matrixSection = content.slice(startIdx + startMarker.length, endIdx);
  const lines = matrixSection.trim().split('\n');
  const rows = [];
  let headerFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (trimmed.includes(':---')) {
      headerFound = true;
      continue;
    }
    const cols = trimmed.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (!headerFound) continue;
    if (cols.length >= 6) {
      rows.push({
        id: cols[0].replace(/\*\*/g, '').trim(),
        component: cols[1].replace(/`/g, '').trim(),
        role: cols[2].replace(/`/g, '').trim(),
        status: cols[3].replace(/`/g, '').trim(),
        resolvedBy: cols[4].replace(/`/g, '').trim(),
        action: cols[5].trim()
      });
    }
  }
  return { startIdx, endIdx, rows, startMarker, endMarker };
}

function formatMatrixTable(rows) {
  let table = '| Issue ID | Component / File | Designated Role | Status | Resolved By | Action for Designated Role |\n';
  table += '| :--- | :--- | :--- | :--- | :--- | :--- |\n';
  for (const r of rows) {
    const idCell = `**${r.id}**`;
    const compCell = r.component && r.component !== '-' ? `\`${r.component}\`` : '-';
    const roleCell = r.role && r.role !== '-' ? `\`${r.role}\`` : '-';
    const statusCell = `\`${r.status}\``;
    const resolvedByCell = r.resolvedBy && r.resolvedBy !== '-' ? `\`${r.resolvedBy}\`` : '-';
    const actionCell = r.action || '-';
    table += `| ${idCell} | ${compCell} | ${roleCell} | ${statusCell} | ${resolvedByCell} | ${actionCell} |\n`;
  }
  return table;
}

function cmdTask(taskArgs) {
  const action = taskArgs[0] || 'list';

  if (!fs.existsSync(INDEX_PATH)) {
    console.error('❌ docs/INDEX.md does not exist.');
    process.exit(1);
  }

  if (action === 'list') {
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const { rows } = parseMatrix(content);
    const isJson = taskArgs.includes('--json');
    const filterStatus = taskArgs.find(a => a.startsWith('--status='))?.slice('--status='.length);

    const filtered = filterStatus ? rows.filter(r => r.status.toUpperCase() === filterStatus.toUpperCase()) : rows;

    if (isJson) {
      console.log(JSON.stringify(filtered, null, 2));
      return;
    }

    console.log('📋 GHarness Component & Issue Ownership Workboard:\n');
    console.log(formatMatrixTable(filtered));
    return;
  }

  const taskId = taskArgs[1];
  if (!taskId) {
    console.error(`❌ Usage: npm run docs:task ${action} <task-id> [--options]`);
    process.exit(1);
  }

  const cleanTaskId = taskId.replace(/\*\*/g, '').toUpperCase().trim();
  const unlock = acquireWorkboardLock();

  try {
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const parsed = parseMatrix(content);
    const target = parsed.rows.find(r => r.id.toUpperCase() === cleanTaskId);

    if (!target) {
      throw new Error(`Task '${cleanTaskId}' not found in docs/INDEX.md matrix.`);
    }

    // Parse options
    const options = {};
    for (let i = 2; i < taskArgs.length; i++) {
      const a = taskArgs[i];
      if (a.startsWith('--role=')) options.role = a.slice('--role='.length).trim();
      else if (a.startsWith('--by=')) options.by = a.slice('--by='.length).trim();
      else if (a.startsWith('--note=')) options.note = a.slice('--note='.length).trim();
      else if (a.startsWith('--reason=')) options.reason = a.slice('--reason='.length).trim();
    }

    const latestConvoId = detectLatestConvoId();
    const detectedTitle = lookupUiTitleForConvo(latestConvoId);
    const callerRole = (options.role || options.by || detectedTitle || 'core engineer').toLowerCase().trim();

    if (action === 'claim') {
      if (isAuditorRole(callerRole)) {
        throw new Error(`Boundary Protocol Violation: Auditor role '${callerRole}' cannot claim implementation task '${cleanTaskId}'. Auditors only audit and log issues.`);
      }
      if (target.status === 'RESOLVED') {
        throw new Error(`Task '${cleanTaskId}' is already RESOLVED.`);
      }
      target.status = 'IN_PROGRESS';
      target.role = callerRole;
      target.resolvedBy = '-';
      target.action = options.note || `Claimed by ${callerRole} for implementation`;
      console.log(`✅ Task **${cleanTaskId}** claimed by \`${callerRole}\` (Status: IN_PROGRESS)`);
    } else if (action === 'resolve') {
      if (isAuditorRole(callerRole)) {
        throw new Error(`Boundary Protocol Violation: Auditor role '${callerRole}' cannot mark code tasks RESOLVED. Use handoff audit notes.`);
      }
      target.status = 'RESOLVED';
      target.resolvedBy = callerRole;
      target.action = `**LEAVE ALONE** (${options.note || `Resolved by ${callerRole}`})`;
      console.log(`✅ Task **${cleanTaskId}** marked RESOLVED by \`${callerRole}\``);
    } else if (action === 'block') {
      target.status = 'BLOCKED';
      target.action = `BLOCKED: ${options.reason || 'Blocked on dependency'}`;
      console.log(`🛑 Task **${cleanTaskId}** marked BLOCKED (${options.reason || 'Dependency blocker'})`);
    } else {
      throw new Error(`Unknown task action: ${action}. Use: list, claim, resolve, block.`);
    }

    const newTable = formatMatrixTable(parsed.rows);
    const newContent = content.slice(0, parsed.startIdx + parsed.startMarker.length) +
      '\n' + newTable.trim() + '\n' +
      content.slice(parsed.endIdx);

    const stagedPath = `${INDEX_PATH}.staged`;
    fs.writeFileSync(stagedPath, newContent, 'utf8');
    fs.renameSync(stagedPath, INDEX_PATH);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  } finally {
    unlock();
  }
}

// CLI Router
const args = process.argv.slice(2);
const command = args[0] || 'status';

switch (command) {
  case 'task':
    cmdTask(args.slice(1));
    break;
  case 'check':
  case 'lint':
    cmdCheck();
    break;
  case 'index':
    cmdIndex();
    break;
  case 'new':
    cmdNew(args.slice(1));
    break;
  case 'whoami':
    cmdWhoami(args.slice(1));
    break;
  case 'resolve':
    cmdResolve(args.slice(1).join(' ').trim());
    break;
  case 'worktree-init':
  case 'worktree':
    cmdWorktreeInit(args[1]);
    break;
  case 'status':
    cmdStatus();
    break;
  default:
    console.log(`Unknown command: ${command}`);
    console.log('Available commands: whoami, check, index, new, resolve, worktree-init, status, task');
    process.exit(1);
}
