#!/usr/bin/env node

/**
 * context_budget.mjs
 * 
 * Token Economics & Context Budget Telemetry CLI for GHarness.
 * Reads active conversation transcripts via 64KB reverse-chunk seeking (O(1) memory),
 * calculates token usage, cache metrics, and capacity utilization against the 1,048,576
 * Gemini context window, and enforces proactive compaction thresholds (75% advisory, 85% critical).
 *
 * Usage:
 *   node scripts/context_budget.mjs [--convo=<uuid>] [--json]
 *   node scripts/context_budget.mjs --transcript=<path> [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MAX_CONTEXT_TOKENS = 1048576; // 1M Gemini context window
const BRAIN_BASE = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');

/**
 * SEC-10: Strict Transcript Path Validation & Confinement
 */
export function validateTranscriptPath(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') {
    throw new Error('Invalid transcript path.');
  }
  if (!transcriptPath.endsWith('.jsonl')) {
    throw new Error(`Security Violation: Transcript file must be a .jsonl file: ${transcriptPath}`);
  }
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found: ${transcriptPath}`);
  }

  const realPath = fs.realpathSync(transcriptPath);
  const allowedDirs = [
    BRAIN_BASE,
    path.resolve(process.cwd()),
    REPO_ROOT,
    os.tmpdir()
  ].map(d => fs.existsSync(d) ? fs.realpathSync(d) : path.resolve(d));

  const isAllowed = allowedDirs.some(allowedDir => realPath === allowedDir || realPath.startsWith(allowedDir + path.sep));
  if (!isAllowed) {
    throw new Error(`Security Violation: Transcript path outside allowed base directories: ${realPath}`);
  }

  return realPath;
}

/**
 * Auto-detect latest active conversation ID.
 */
export function detectLatestConvoId() {
  try {
    if (!fs.existsSync(BRAIN_BASE)) return null;
    const candidates = fs.readdirSync(BRAIN_BASE, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^[0-9a-f-]{36}$/i.test(d.name))
      .map(d => {
        const p = path.join(BRAIN_BASE, d.name, '.system_generated', 'logs', 'transcript.jsonl');
        return fs.existsSync(p) ? { id: d.name, mtime: fs.statSync(p).mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    return candidates.length > 0 ? candidates[0].id : null;
  } catch {
    return null;
  }
}

/**
 * Read the latest token telemetry using 64KB tail-buffer seeking (O(1) memory).
 */
export function getContextBudget(convoIdOrPath) {
  let targetPath = null;
  let activeConvoId = null;

  if (convoIdOrPath && convoIdOrPath.endsWith('.jsonl')) {
    targetPath = validateTranscriptPath(convoIdOrPath);
  } else {
    activeConvoId = convoIdOrPath || detectLatestConvoId();
    if (!activeConvoId) {
      throw new Error('No active conversation ID detected in ~/.gemini/antigravity/brain/');
    }
    const resolvedPath = path.join(BRAIN_BASE, activeConvoId, '.system_generated', 'logs', 'transcript.jsonl');
    targetPath = validateTranscriptPath(resolvedPath);
  }

  const stat = fs.statSync(targetPath);
  if (stat.size === 0) {
    return {
      activeConvoId,
      stepIndex: 0,
      inputTokens: 0,
      cacheTokens: 0,
      outputTokens: 0,
      tokensUsed: 0,
      tokensMax: MAX_CONTEXT_TOKENS,
      percentUsed: 0,
      capacityRemaining: 100,
      status: 'OPTIMAL',
      advice: 'New conversation. Full whole-file reads and exploratory tooling permitted.'
    };
  }

  const readSize = Math.min(stat.size, 65536);
  const buffer = Buffer.alloc(readSize);
  let fd = null;
  try {
    fd = fs.openSync(targetPath, 'r');
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }

  const chunk = buffer.toString('utf8');
  const lines = chunk.trim().split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const step = JSON.parse(lines[i]);
      if (step.input_tokens !== undefined || step.total_tokens !== undefined) {
        const inputTokens = step.input_tokens || 0;
        const cacheTokens = step.cache_read_tokens || 0;
        const outputTokens = step.output_tokens || 0;
        const tokensUsed = inputTokens + cacheTokens + outputTokens;
        const percentUsed = parseFloat(((tokensUsed / MAX_CONTEXT_TOKENS) * 100).toFixed(1));
        const capacityRemaining = parseFloat((100 - percentUsed).toFixed(1));

        let status = 'OPTIMAL';
        let advice = 'Token headroom ample (<30%). Full whole-file reads and multi-tool batching permitted.';

        if (percentUsed >= 85) {
          status = 'CRITICAL_COMPACTION_REQUIRED';
          advice = 'CRITICAL (>85% capacity): Context severely loaded. Advise user to run /compact immediately to avoid attention dilution.';
        } else if (percentUsed >= 75) {
          status = 'COMPACTION_RECOMMENDED';
          advice = 'ADVISORY WARNING (75%–85% capacity): Context nearing limit. Switch to AST symbol queries and prepare compaction handoff.';
        } else if (percentUsed >= 30) {
          status = 'CONSERVATIVE';
          advice = 'CONSERVATIVE (30%–75% capacity): Prefer targeted line windows, AST symbol queries (npm run ast), and batched tool calls.';
        }

        return {
          activeConvoId,
          stepIndex: step.step_index || 0,
          inputTokens,
          cacheTokens,
          outputTokens,
          tokensUsed,
          tokensMax: MAX_CONTEXT_TOKENS,
          percentUsed,
          capacityRemaining,
          status,
          advice
        };
      }
    } catch (_) {}
  }

  throw new Error(`No token telemetry found in tail chunk of ${targetPath}`);
}

/**
 * Render visual progress bar: [██████████░░░░░░░░░░]
 */
function renderProgressBar(percent, width = 24) {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)));
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Format thousands with k/M.
 */
function formatTokens(count) {
  if (count >= 1000000) return `${(count / 1000000).toFixed(2)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

// CLI Execution
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
  let convoArg = null;
  let transcriptArg = null;
  const isJson = args.includes('--json');

  for (const a of args) {
    if (a.startsWith('--convo=')) convoArg = a.slice('--convo='.length).trim();
    else if (a.startsWith('--transcript=')) transcriptArg = a.slice('--transcript='.length).trim();
  }

  try {
    const budget = getContextBudget(transcriptArg || convoArg);

    if (isJson) {
      console.log(JSON.stringify(budget, null, 2));
      process.exit(0);
    }

    const statusIcon = budget.status === 'OPTIMAL' ? '🟢' :
      budget.status === 'CONSERVATIVE' ? '🟡' :
      budget.status === 'COMPACTION_RECOMMENDED' ? '🟠' : '🔴';

    console.log('=================================================================');
    console.log(` 🧭 Antigravity Context Budget & Token Telemetry`);
    console.log('=================================================================\n');
    console.log(` Active Conversation : ${budget.activeConvoId || 'Direct Transcript'}`);
    console.log(` Latest Step Index   : ${budget.stepIndex}`);
    console.log(` Context Window Max  : ${formatTokens(budget.tokensMax)} tokens (1,048,576)`);
    console.log(` Total Tokens Used   : ${formatTokens(budget.tokensUsed)} (${budget.tokensUsed.toLocaleString()} tokens)`);
    console.log(`   - Input Tokens    : ${formatTokens(budget.inputTokens)}`);
    console.log(`   - Cache Tokens    : ${formatTokens(budget.cacheTokens)}`);
    console.log(`   - Output Tokens   : ${formatTokens(budget.outputTokens)}`);
    console.log('');
    console.log(` Capacity Gauge      : ${renderProgressBar(budget.percentUsed)} ${budget.percentUsed}% used`);
    console.log(` Remaining Headroom  : ${budget.capacityRemaining}% capacity remaining`);
    console.log(` Operational Status  : ${statusIcon} ${budget.status}`);
    console.log('');
    console.log(` 💡 Strategy Advice  : ${budget.advice}\n`);
  } catch (err) {
    console.error(`❌ Context Budget Error: ${err.message}`);
    process.exit(1);
  }
}
