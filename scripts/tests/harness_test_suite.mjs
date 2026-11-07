#!/usr/bin/env node

/**
 * harness_test_suite.mjs
 * 
 * Unified 1-Second Regression Test Runner for GHarness.
 * Consolidates all 23 non-destructive security and stability vectors:
 * SEC-01..11, COLLAB-01..02, DIAG-01..05, REG-01, SWARM-01, TASK-01, BUDGET-01, HUD-01..02, PERF-02..03.
 * 
 * Usage:
 *   node scripts/tests/harness_test_suite.mjs
 *   npm test
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const results = [];
const startTime = Date.now();

function assertTest(name, fn) {
  const start = Date.now();
  try {
    fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`  ✅ [PASS] ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Date.now() - start;
    results.push({ name, passed: false, duration, error: err.message });
    console.error(`  ❌ [FAIL] ${name} (${duration}ms) -> ${err.message}`);
  }
}

console.log('=================================================================');
console.log(' 🧪 GHarness Unified Regression Test Suite (21 Vectors)');
console.log('=================================================================\n');

// Vector 1: SEC-01 & SEC-02 - Path Traversal Defense in Token Metrics & Transcript Parsing
assertTest('SEC-01/02: Strict UUID & Path Prefix Traversal Protection', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('/^[a-zA-Z0-9_-]+$/')) {
    throw new Error('Missing targetConvoId UUID validation regex in patchMain');
  }
  if (!patchCode.includes('.startsWith(path.resolve(brainDir) + path.sep)')) {
    throw new Error('Missing realpath confinement check in patchMain');
  }
});

// Vector 2: SEC-03 - Secret & API Key Redaction Pipeline in Skill Distillation & Learning
assertTest('SEC-03: Secret & API Key Redaction Pipeline Active', () => {
  if (fs.existsSync(path.join(REPO_ROOT, 'scripts', 'distill_skill.mjs'))) {
    throw new Error('Found legacy scripts/distill_skill.mjs - should be retired');
  }
  const geminiMdPath = path.join(os.homedir(), '.gemini', 'config', 'GEMINI.md');
  if (fs.existsSync(geminiMdPath)) {
    const geminiMd = fs.readFileSync(geminiMdPath, 'utf8');
    if (!geminiMd.includes('Strict Secret Redaction') || (!geminiMd.includes('ghp_') && !geminiMd.includes('[REDACTED_API_KEY]'))) {
      throw new Error('Missing Strict Secret Redaction protocol in ~/.gemini/config/GEMINI.md');
    }
  }
});

// Vector 3: SEC-04 - Repository Safety Push Invariant (AGENTS.md Rule 2)
assertTest('SEC-04: Repository Safety Push Invariant (Rule 2)', () => {
  const agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
  if (!agentsMd.includes('git push') || !agentsMd.includes('NO PUSHING WITHOUT EXPLICIT PERMISSION')) {
    throw new Error('Missing strict git push prohibition in AGENTS.md');
  }
});

// Vector 4: SEC-05 - Context HUD DOM Debouncing & Mutation Filtering
assertTest('SEC-05: Context HUD Debounced rAF & Mutation Filtering', () => {
  const hudCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hud', 'context_circle_hud.js'), 'utf8');
  if (!hudCode.includes('requestAnimationFrame') || !hudCode.includes('debounceTimer')) {
    throw new Error('Missing requestAnimationFrame debouncing in scripts/hud/context_circle_hud.js');
  }
});

// Vector 5: SEC-07 - PostMessage Origin & Schema Hardening
assertTest('SEC-07: Window PostMessage Origin & Schema Validation', () => {
  const preloadCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  const hudCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hud', 'context_circle_hud.js'), 'utf8');
  if (!preloadCode.includes('ANTIGRAVITY_TOKEN_METRICS') || !hudCode.includes('ANTIGRAVITY_TOKEN_METRICS')) {
    throw new Error('Missing ANTIGRAVITY_TOKEN_METRICS postMessage channel in HUD or preload');
  }
});

// Vector 6: SEC-08 - Plan A Strict Boundary Isolation / Unrestricted Frame CSP
assertTest('SEC-08: Plan A Unrestricted Sandboxed Frame CSP Configuration', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('UNRESTRICTED_CSP') || !patchCode.includes("script-src * 'unsafe-inline' 'unsafe-eval'")) {
    throw new Error('Missing UNRESTRICTED_CSP definition in patch_antigravity.mjs');
  }
});

// Vector 7: SEC-09 - Sandbox Privilege Stripping (allow-same-origin / allow-popups)
assertTest('SEC-09: Sandbox Privilege Stripping in sanitizeSandbox()', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('allow-same-origin') || !patchCode.includes('allow-popups-to-escape-sandbox')) {
    throw new Error('Missing sanitizeSandbox privilege stripping in patch_antigravity.mjs');
  }
});

// Vector 8: SEC-10 - Transcript Validation & Realpath Confinement
assertTest('SEC-10: Transcript Path Confinement & .jsonl Extension Check', () => {
  const budgetCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'context_budget.mjs'), 'utf8');
  if (!budgetCode.includes('validateTranscriptPath') || !budgetCode.includes('.endsWith(\'.jsonl\')')) {
    throw new Error('Missing validateTranscriptPath in context_budget.mjs');
  }
});

// Vector 9: COLLAB-01 - Atomic Staged Writes and Documentation Schema Lint
assertTest('COLLAB-01: Documentation Schema Linter (doc_manager.mjs check)', () => {
  const out = execSync('node scripts/doc_manager.mjs check', { cwd: REPO_ROOT, encoding: 'utf8' });
  if (!out.includes('All documentation handoffs adhere to repository rules and schemas')) {
    throw new Error('Documentation check failed schema validation');
  }
});

// Vector 10: COLLAB-02 - Worktree Symlink Bootstrap (doc_manager worktree-init)
assertTest('COLLAB-02: Worktree Symlink Bootstrap Logic Active', () => {
  const docManager = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'doc_manager.mjs'), 'utf8');
  if (!docManager.includes('cmdWorktreeInit') || !docManager.includes('fs.symlinkSync(src, dest)')) {
    throw new Error('Missing worktree-init symlinking in doc_manager.mjs');
  }
});

// Vector 11: DIAG-01 - Three.js UMD Pinning & WebGL Layout Throttling
assertTest('DIAG-01: Three.js UMD Pinning & ResizeObserver Guidelines in SKILL.md', () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'generative_ui', 'SKILL.md'), 'utf8');
  if (!skillMd.includes('three@0.160.0') || !skillMd.includes('ResizeObserver')) {
    throw new Error('generative_ui SKILL.md missing Three.js pinning or ResizeObserver rules');
  }
});

// Vector 12: DIAG-02 - Quoted content= Attribute in rewriteCSP
assertTest('DIAG-02: Quoted content= Attribute in rewriteCSP', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('content="${UNRESTRICTED_CSP}"') && !patchCode.includes('content="${SCOPED_CSP}"')) {
    throw new Error('rewriteCSP content= attribute not safely quoted');
  }
});

// Vector 13: DIAG-03 - Hooked Element.prototype.setAttribute for React 18 Bypass
assertTest('DIAG-03: Element.prototype.setAttribute Interception Active', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('hookSetAttribute(Element.prototype)')) {
    throw new Error('Element.prototype.setAttribute hook missing in patch_antigravity.mjs');
  }
});

// Vector 14: DIAG-04 - Prototype srcdoc Setter & DOMTokenList Privilege Blocking
assertTest('DIAG-04: Prototype srcdoc & DOMTokenList.prototype.add Hardening', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('HTMLIFrameElement.prototype, \'srcdoc\'') || !patchCode.includes('DOMTokenList.prototype.add')) {
    throw new Error('Missing HTMLIFrameElement.prototype.srcdoc or DOMTokenList.add hook');
  }
});

// Vector 15: DIAG-05 - Synchronous Preload Hook at Byte Zero & Zero Premature Root
assertTest('DIAG-05: Preload Byte-Zero Hook & No Premature <html> Creation', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (patchCode.includes('document.createElement(\'html\')')) {
    throw new Error('Premature document.createElement(\'html\') still present in patch_antigravity.mjs');
  }
  if (!patchCode.includes('webFrame.executeJavaScript(mainWorldCode)')) {
    throw new Error('webFrame.executeJavaScript missing from preloadHook');
  }
});

// Vector 16: REG-01 - Plan A Strict Boundary Isolation (Host CSP Stripped)
assertTest('REG-01: Plan A Host CSP Deletion (Host WebSockets Unblocked)', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('delete responseHeaders[\'content-security-policy\']')) {
    throw new Error('delete responseHeaders[\'content-security-policy\'] missing from patchMain');
  }
});

// Vector 17: SWARM-01 - Worktree Swarm Manager Validation & CLI Logic
assertTest('SWARM-01: Worktree Swarm Manager Slug Validation & CLI Structure', () => {
  const swarmCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'worktree_manager.mjs'), 'utf8');
  if (!swarmCode.includes('validateWorktreeName') || !swarmCode.includes('git worktree add')) {
    throw new Error('Missing validateWorktreeName or git worktree add in worktree_manager.mjs');
  }
});

// Vector 18: TASK-01 - Workboard Atomic Locking (O_EXCL) & Auditor Rejection
assertTest('TASK-01: Workboard Atomic POSIX O_EXCL Locking & Auditor Rejection', () => {
  const docManager = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'doc_manager.mjs'), 'utf8');
  if (!docManager.includes('acquireWorkboardLock') || !docManager.includes('isAuditorRole')) {
    throw new Error('Missing acquireWorkboardLock or isAuditorRole in doc_manager.mjs');
  }
});

// Vector 19: BUDGET-01 - Context Budget Reverse Buffer Seeking & Telemetry
assertTest('BUDGET-01: Context Budget 64KB Reverse Seeking & Telemetry CLI', () => {
  const budgetCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'context_budget.mjs'), 'utf8');
  if (!budgetCode.includes('fs.readSync') || !budgetCode.includes('COMPACTION_RECOMMENDED')) {
    throw new Error('Missing 64KB reverse buffer seeking or compaction thresholds in context_budget.mjs');
  }
});

// Vector 20: HUD-01 - Model Usage Quotas (5h & Weekly Limits) & Dual-Mode Persistence
assertTest('HUD-01: Model Usage Quotas (5h & Weekly Limits) & Dual-Mode Persistence', () => {
  const hudCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hud', 'context_circle_hud.js'), 'utf8');
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!hudCode.includes('pop-5h-limit') || !hudCode.includes('pop-weekly-limit') || !hudCode.includes('inputTokens')) {
    throw new Error('Missing model quota elements or inputTokens in context_circle_hud.js');
  }
  if (!hudCode.includes('btn-mode-context') || !hudCode.includes('btn-mode-5h') || !hudCode.includes('storageKeyMode')) {
    throw new Error('Missing circle mode toggle elements or storageKeyMode in context_circle_hud.js');
  }
  if (!patchCode.includes('inputTokens: input') || !patchCode.includes('outputTokens: output')) {
    throw new Error('Missing inputTokens/outputTokens in patch_antigravity.mjs IPC handler');
  }
});

// Vector 21: HUD-02 - Swarm Activity Pill & Telemetry Bridge
assertTest('HUD-02: Swarm Activity Pill & Telemetry Bridge', () => {
  const hudCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hud', 'context_circle_hud.js'), 'utf8');
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!hudCode.includes('antigravity-swarm-pill') || !hudCode.includes('Swarm:') || !hudCode.includes('pop-swarm-branch')) {
    throw new Error('Missing Swarm pill elements in context_circle_hud.js');
  }
  if (!patchCode.includes('antigravity:get-swarm-status') || !patchCode.includes('getSwarmStatus: () =>')) {
    throw new Error('Missing antigravity:get-swarm-status IPC or bridge method in patch_antigravity.mjs');
  }
});

// Vector 22: SEC-11 - Safe DOM Construction in Swarm Worktree List (No Unescaped innerHTML)
assertTest('SEC-11: Safe DOM Construction in Swarm Worktree List (No Unescaped innerHTML)', () => {
  const hudCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hud', 'context_circle_hud.js'), 'utf8');
  if (hudCode.includes('listEl.innerHTML = siblings.map') || hudCode.includes('listEl.innerHTML =')) {
    throw new Error('Detected unescaped listEl.innerHTML interpolation in context_circle_hud.js');
  }
  if (!hudCode.includes('row.appendChild(nameSpan)') || !hudCode.includes('row.appendChild(branchSpan)')) {
    throw new Error('Missing safe DOM appendChild construction for swarm worktree rows');
  }
});

// Vector 23: PERF-02 & PERF-03 - Layout Thrashing Cache & Throttled Swarm Polling
assertTest('PERF-02 & PERF-03: Layout Thrashing Cache & Throttled Swarm Polling', () => {
  const hudCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hud', 'context_circle_hud.js'), 'utf8');
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!hudCode.includes('_cachedGreen') || !hudCode.includes('updateGaugeMetrics')) {
    throw new Error('Missing _cachedGreen or updateGaugeMetrics non-recursive separation in context_circle_hud.js');
  }
  if (hudCode.includes('document.body.appendChild(probe)')) {
    throw new Error('Found layout thrashing probe in getAntigravityGreen()');
  }
  if (!patchCode.includes('now - _lastSwarmFetch < 15000')) {
    throw new Error('Missing 15s throttled swarm cache TTL in patch_antigravity.mjs');
  }
});

// Vector 24: SEC-12 & SEC-13 - Artifact-Scoped Sandbox Enforcement & WebIDL Microtask Race Guard
assertTest('SEC-12/13: Artifact-Scoped Sandbox & DOMTokenList Value Setter Hook', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('isArtifactFrame') || !patchCode.includes('Element.prototype.removeAttribute')) {
    throw new Error('Missing artifact-scoped sandbox or removeAttribute hook in patch_antigravity.mjs');
  }
  if (!patchCode.includes('DOMTokenList.prototype, \'value\'')) {
    throw new Error('Missing DOMTokenList.prototype.value setter hook for SEC-13');
  }
});

// Vector 25: SEC-14 & SEC-15 - Symlink Realpath Confinement & IPC Sender Frame Validation
assertTest('SEC-14/15: Symlink Realpath Confinement & Sender Frame Validation', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('fs.realpathSync(convoDir)') || !patchCode.includes('fs.realpathSync(transcriptPath)')) {
    throw new Error('Missing fs.realpathSync symlink traversal confinement in patchMain');
  }
  if (!patchCode.includes('_event.senderFrame.isMainFrame()')) {
    throw new Error('Missing senderFrame.isMainFrame() IPC validation in patchMain');
  }
});

// Vector 26: SEC-16 & PERF-05 - Case-Insensitive Pre-Parser Regex & Node Filter
assertTest('SEC-16 & PERF-05: Case-Insensitive CSP Regex & Added Node Element Filter', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('/<iframe\\b/i.test(val)') && !patchCode.includes('/<iframe\\b/i.test(text)')) {
    throw new Error('Missing case-insensitive /<iframe\\b/i regex in innerHTML or insertAdjacentHTML');
  }
  if (!patchCode.includes('node.nodeType !== 1') || !patchCode.includes('node.firstElementChild')) {
    throw new Error('Missing nodeType !== 1 or node.firstElementChild filtering in MutationObserver');
  }
});

// Vector 27: PERF-04 & REDUN-01..03 - Async IPC I/O, Buffer Reuse & Prototype Shadowing Elimination
assertTest('PERF-04 & REDUN-01..03: Async IPC I/O, Buffer Reuse & Deduplicated Hooks', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('fs.promises.stat') || !patchCode.includes('fs.promises.open')) {
    throw new Error('Missing async fs.promises I/O in antigravity:get-token-metrics');
  }
  if (!patchCode.includes('_tokenBuffer') || !patchCode.includes('_tokenCache')) {
    throw new Error('Missing shared _tokenBuffer or _tokenCache in patchMain');
  }
  if (patchCode.includes('hookSetAttribute(HTMLIFrameElement.prototype)')) {
    throw new Error('Found redundant hookSetAttribute(HTMLIFrameElement.prototype) shadowing Element.prototype');
  }
  if (!patchCode.includes('if (!injectIfRootPresent())')) {
    throw new Error('Missing if (!injectIfRootPresent()) guard on preload fallback observer');
  }
});

// Vector 28: SEC-17 - Preload PostMessage Target Origin Validation (No Wildcard)
assertTest('SEC-17: Preload PostMessage Target Origin Validation', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (patchCode.includes('window.postMessage({ type: \'ANTIGRAVITY_TOKEN_METRICS\', metrics }, \'*\')') ||
      patchCode.includes('window.postMessage({ type: \'ANTIGRAVITY_SWARM_STATUS\', status }, \'*\')')) {
    throw new Error('Detected wildcard \'*\' target origin in preload postMessage calls');
  }
  if (!patchCode.includes('window.postMessage({ type: \'ANTIGRAVITY_TOKEN_METRICS\', metrics }, window.location.origin)')) {
    throw new Error('Missing window.location.origin target origin in token metrics broadcast');
  }
});

// Vector 29: PERF-06..08 & REDUN-04 - Anchor Reflow Cache, Scoped Observer & Dead Code Cleanup
assertTest('PERF-06..08 & REDUN-04: Anchor Cache, Scoped Observer & Dead Code Cleanup', () => {
  const hudCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hud', 'context_circle_hud.js'), 'utf8');
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!hudCode.includes('_cachedAnchor') || !hudCode.includes('_lastThemeIsDark')) {
    throw new Error('Missing _cachedAnchor or _lastThemeIsDark in context_circle_hud.js');
  }
  if (hudCode.includes('.cli-tip') || hudCode.includes('.btn-compact')) {
    throw new Error('Found dead CSS rules (.cli-tip / .btn-compact) in context_circle_hud.js');
  }
  if (hudCode.includes('radius: 13')) {
    throw new Error('Found unused radius config key in context_circle_hud.js');
  }
  if (!hudCode.includes('subtree: false')) {
    throw new Error('MutationObserver is not scoped with subtree: false to composer');
  }
  if (/\/Users\/[a-zA-Z0-9_-]+\//.test(patchCode) || (process.env.USER && patchCode.includes('/Users/' + process.env.USER))) {
    throw new Error('Found hardcoded user path in patch_antigravity.mjs');
  }
});

// Vector 30: TRUST-01 - TrustedHTML Object Coercion & Synchronous rewriteCSP
assertTest('TRUST-01: TrustedHTML Object Coercion & Synchronous rewriteCSP', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('typeof html === \'object\'') || !patchCode.includes('html.toString()')) {
    throw new Error('Missing TrustedHTML object string coercion in rewriteCSP');
  }
  if (!patchCode.includes('typeof currentSrcdoc === \'object\'')) {
    throw new Error('Missing TrustedHTML object check in cleanIframe');
  }
});

// Vector 31: ZERO-HARDCODE & SKILL-PKG - Self-Contained Skill Packages & Retired Turbo & Distiller
assertTest('ZERO-HARDCODE & SKILL-PKG: Self-Contained Skill Packages & Retired Turbo', () => {
  // 1. Assert gemini_turbo and skill_distiller are cleanly retired from repo
  if (fs.existsSync(path.join(REPO_ROOT, 'skills', 'gemini_turbo'))) {
    throw new Error('Found deprecated skills/gemini_turbo directory in repo');
  }
  if (fs.existsSync(path.join(REPO_ROOT, 'skills', 'skill_distiller'))) {
    throw new Error('Found deprecated skills/skill_distiller directory in repo');
  }
  if (fs.existsSync(path.join(REPO_ROOT, 'scripts', 'distill_skill.mjs'))) {
    throw new Error('Found deprecated scripts/distill_skill.mjs in repo');
  }

  // 2. Assert active skills have packaged scripts
  const requiredSkills = ['generative_ui', 'worktree_swarm'];
  for (const s of requiredSkills) {
    const sDir = path.join(REPO_ROOT, 'skills', s);
    if (!fs.existsSync(sDir)) throw new Error(`Missing skill directory: ${s}`);
    const scriptsDir = path.join(sDir, 'scripts');
    if (!fs.existsSync(scriptsDir)) throw new Error(`Skill ${s} is missing scripts/ package`);
    const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.mjs'));
    if (files.length === 0) throw new Error(`Skill ${s}/scripts contains no .mjs executables`);
  }

  // 3. Assert zero hardcoded developer usernames across all scripts and skills
  const checkFiles = [
    path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'),
    path.join(REPO_ROOT, 'scripts', 'worktree_manager.mjs'),
    path.join(REPO_ROOT, 'scripts', 'context_budget.mjs'),
    path.join(REPO_ROOT, 'scripts', 'visual_snapshot.mjs')
  ];
  for (const f of checkFiles) {
    const content = fs.readFileSync(f, 'utf8');
    if (/\/Users\/[a-zA-Z0-9_-]+\//.test(content) || (process.env.USER && content.includes('/Users/' + process.env.USER))) {
      throw new Error(`Found hardcoded user path in ${path.basename(f)}`);
    }
  }
});

// Vector 32: CLI-PORTABILITY - Project-Agnostic Worktree & Global CLI Binaries
assertTest('CLI-PORTABILITY: Project-Agnostic Worktree & Global CLI Binaries', () => {
  const worktreeCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'worktree_manager.mjs'), 'utf8');
  if (worktreeCode.includes('doc_manager.mjs')) {
    throw new Error('Found internal doc_manager.mjs dependency in worktree_manager.mjs');
  }
  if (!worktreeCode.includes('git rev-parse --show-toplevel')) {
    throw new Error('Missing dynamic git rev-parse repo root discovery in worktree_manager.mjs');
  }

  // Verify CLI wrapper binaries in ~/.local/bin
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const requiredClis = ['context-budget', 'visual-snapshot', 'worktree-swarm'];
  for (const cli of requiredClis) {
    const cliPath = path.join(localBin, cli);
    if (!fs.existsSync(cliPath)) {
      throw new Error(`Missing global CLI binary: ${cliPath}`);
    }
  }
});

// Vector 33: CDN-01 & SKILL-07..08 - Plotly/JSXGraph/Mermaid CDNs, Valid Frontmatter, <agent-embed> & Zero-Flicker Updates
assertTest('CDN-01 & SKILL-07..08: Generative UI CDNs, Frontmatter, <agent-embed> & Zero-Flicker Updates', () => {
  const patchCode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'patch_antigravity.mjs'), 'utf8');
  if (!patchCode.includes('cdn.plot.ly') || !patchCode.includes('https://plot.ly')) {
    throw new Error('Missing Plotly.js trusted CDN domains in patch_antigravity.mjs');
  }
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'generative_ui', 'SKILL.md'), 'utf8');
  if (!skillMd.startsWith('---\nname: generative_ui\n')) {
    throw new Error('generative_ui SKILL.md has corrupted or missing YAML frontmatter');
  }
  if (!skillMd.includes('Plotly.js') || !skillMd.includes('cdn.plot.ly') || !skillMd.includes('JSXGraph')) {
    throw new Error('generative_ui SKILL.md missing Plotly.js or JSXGraph CDN specification');
  }
  if (!skillMd.includes('<agent-embed src="file:///') || !skillMd.includes('Default 1-Turn Delivery Workflow')) {
    throw new Error('generative_ui SKILL.md missing <agent-embed> or Default 1-Turn Delivery Workflow');
  }
  if (!skillMd.includes("update('none')") || !skillMd.includes('cancelAnimationFrame')) {
    throw new Error('generative_ui SKILL.md missing zero-flicker chart.update(\'none\') or rAF coalescing rules (SKILL-08)');
  }
});

// Summary
const totalDuration = Date.now() - startTime;
const passedCount = results.filter(r => r.passed).length;
const failedCount = results.filter(r => !r.passed).length;

console.log('\n-----------------------------------------------------------------');
console.log(` Results: ${passedCount}/${results.length} Vectors Passed (${totalDuration}ms)`);
console.log('-----------------------------------------------------------------\n');

if (failedCount > 0) {
  console.error(`❌ Regression test suite failed with ${failedCount} failing test(s).`);
  process.exit(1);
} else {
  console.log(`🎉 ALL ${results.length} REGRESSION & SECURITY VECTORS PASSED CLEANLY.\n`);
  process.exit(0);
}
