#!/usr/bin/env node

/**
 * Headless Chrome Visual Snapshot Engine (SNAP-01)
 * 
 * High-performance, zero-npm-dependency visual snapshot utility for UI artifacts.
 * Uses native macOS Google Chrome via Chromium DevTools Protocol (CDP) with
 * direct CLI fallback via execFileSync argument arrays.
 * 
 * Features:
 * - Chrome Binary Discovery Ladder (macOS standard, env override, Chromium, Linux)
 * - Dual-Theme Captures (--theme=light, --theme=dark, --theme=both)
 * - Exact Element Bounding-Box Clipping (--selector="#root, .card, svg")
 * - High-DPI Retina Rendering (--scale=2)
 * - Smart Settling: waits for fonts, requestAnimationFrame, and window.__UI_READY__
 * - Both CLI and programmatic ES Module export
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Chrome Discovery Ladder: Locate Chrome binary without shell injection
 */
export function findChromeBinary() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }

    const candidatePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];

    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return p;
    }

    // Try finding via `which` using safe execFileSync
    for (const bin of ['google-chrome', 'chromium', 'google-chrome-stable']) {
        try {
            const out = execFileSync('which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (out && fs.existsSync(out)) return out;
        } catch (_) {}
    }

    throw new Error(
        'Chrome binary not found. Please install Google Chrome or set CHROME_PATH environment variable.'
    );
}

/**
 * Promise-based WebSocket CDP Helper
 */
class CdpSession {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.msgId = 1;
        this.pending = new Map();
    }

    async connect(timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timeout')), timeoutMs);
            try {
                this.ws = new WebSocket(this.wsUrl);
                this.ws.onopen = () => {
                    clearTimeout(timer);
                    resolve();
                };
                this.ws.onerror = (err) => {
                    clearTimeout(timer);
                    reject(err);
                };
                this.ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.id && this.pending.has(msg.id)) {
                            const { resolve: res, reject: rej } = this.pending.get(msg.id);
                            this.pending.delete(msg.id);
                            if (msg.error) {
                                rej(new Error(msg.error.message || JSON.stringify(msg.error)));
                            } else {
                                res(msg.result);
                            }
                        }
                    } catch (_) {}
                };
            } catch (e) {
                clearTimeout(timer);
                reject(e);
            }
        });
    }

    send(method, params = {}, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const id = this.msgId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP request ${method} (id ${id}) timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pending.set(id, {
                resolve: (res) => {
                    clearTimeout(timer);
                    resolve(res);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                }
            });

            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        if (this.ws) {
            try { this.ws.close(); } catch (_) {}
            this.ws = null;
        }
    }
}

/**
 * Capture a snapshot using Chrome DevTools Protocol
 */
async function captureViaCdp({ chromePath, fileUrl, theme, selector, scale, width, height, timeout, outputPath }) {
    const chrome = spawn(chromePath, [
        '--headless=new',
        '--remote-debugging-port=0',
        '--disable-gpu',
        '--no-first-run',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-background-networking'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let browserWsUrl = null;
    try {
        browserWsUrl = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Headless Chrome failed to start within 5s')), 5000);
            chrome.stderr.on('data', (d) => {
                const match = d.toString().match(/DevTools listening on (ws:\/\/\S+)/);
                if (match) {
                    clearTimeout(timer);
                    resolve(match[1]);
                }
            });
            chrome.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });

        const browser = new CdpSession(browserWsUrl);
        await browser.connect();

        // Create page target
        const { targetId } = await browser.send('Target.createTarget', { url: fileUrl });
        const pageWsUrl = browserWsUrl.replace(/\/browser\/\S+/, '/page/' + targetId);

        const page = new CdpSession(pageWsUrl);
        await page.connect();

        try {
            await page.send('Page.enable');
            await page.send('DOM.enable');

            // Set Retina scale and viewport dimensions
            await page.send('Emulation.setDeviceMetricsOverride', {
                width: Math.floor(width),
                height: Math.floor(height),
                deviceScaleFactor: Number(scale),
                mobile: false
            });

            // Set color scheme emulation (dark vs light)
            await page.send('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-color-scheme', value: theme }]
            });

            // Apply theme DOM class if page supports Tailwind .dark / .theme-dark
            if (theme === 'dark') {
                await page.send('Runtime.evaluate', {
                    expression: `(() => {
                        document.documentElement.classList.add('dark', 'theme-dark');
                        if (document.body) document.body.classList.add('dark', 'theme-dark');
                    })()`
                });
            }

            // Smart settle: wait for fonts + rAF + optional window.__UI_READY__
            const settlePromise = page.send('Runtime.evaluate', {
                expression: `new Promise((resolve) => {
                    const checkReady = () => {
                        if (window.__UI_READY__ !== false) {
                            if (document.fonts && document.fonts.ready) {
                                document.fonts.ready.then(() => requestAnimationFrame(() => resolve(true)));
                            } else {
                                requestAnimationFrame(() => resolve(true));
                            }
                        } else {
                            setTimeout(checkReady, 50);
                        }
                    };
                    checkReady();
                })`,
                awaitPromise: true
            }, timeout);

            await Promise.race([
                settlePromise,
                new Promise(resolve => setTimeout(resolve, timeout))
            ]);

            // Query element bounding box if selector provided
            let clip = undefined;
            if (selector && typeof selector === 'string') {
                const evalRes = await page.send('Runtime.evaluate', {
                    expression: `(() => {
                        const sel = ${JSON.stringify(selector)};
                        const el = document.querySelector(sel);
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        if (r.width <= 0 || r.height <= 0) return null;
                        return { x: r.x, y: r.y, width: r.width, height: r.height };
                    })()`,
                    returnByValue: true
                });

                const rect = evalRes?.result?.value;
                if (rect && rect.width > 0 && rect.height > 0) {
                    clip = {
                        x: Math.max(0, rect.x),
                        y: Math.max(0, rect.y),
                        width: Math.ceil(rect.width),
                        height: Math.ceil(rect.height),
                        scale: 1
                    };
                }
            }

            // Capture screenshot
            const shotParams = { format: 'png' };
            if (clip) {
                shotParams.clip = clip;
            }

            const shotResult = await page.send('Page.captureScreenshot', shotParams);
            if (!shotResult || !shotResult.data) {
                throw new Error('Page.captureScreenshot returned empty payload');
            }

            const imgBuffer = Buffer.from(shotResult.data, 'base64');
            fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
            fs.writeFileSync(outputPath, imgBuffer);

            return {
                path: outputPath,
                bytes: imgBuffer.length,
                theme,
                selector: clip ? selector : 'viewport',
                scale
            };
        } finally {
            page.close();
            await browser.send('Target.closeTarget', { targetId }).catch(() => {});
            browser.close();
        }
    } finally {
        try {
            chrome.kill('SIGKILL');
        } catch (_) {}
    }
}

/**
 * Fallback CLI-only snapshot via direct execFileSync
 */
function captureViaCli({ chromePath, fileUrl, theme, scale, width, height, timeout, outputPath }) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

    const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--hide-scrollbars',
        `--window-size=${Math.floor(width)},${Math.floor(height)}`,
        `--force-device-scale-factor=${scale}`,
        `--virtual-time-budget=${timeout}`,
        `--screenshot=${outputPath}`
    ];

    if (theme === 'dark') {
        args.push('--force-dark-mode');
    }

    args.push(fileUrl);

    execFileSync(chromePath, args, { stdio: 'pipe', encoding: 'utf8', timeout: timeout + 5000 });

    if (!fs.existsSync(outputPath)) {
        throw new Error(`CLI snapshot failed to write ${outputPath}`);
    }

    return {
        path: outputPath,
        bytes: fs.statSync(outputPath).size,
        theme,
        selector: 'viewport',
        scale
    };
}

/**
 * Main Snapshot Function
 * 
 * @param {string} targetPath - Relative or absolute path to an HTML file
 * @param {object} options
 * @param {'light'|'dark'|'both'} [options.theme='light']
 * @param {string} [options.selector] - CSS selector to clip screenshot to
 * @param {number} [options.scale=2] - Device scale factor (Retina 2x default)
 * @param {number} [options.width=1280] - Viewport width
 * @param {number} [options.height=800] - Viewport height
 * @param {number} [options.timeout=2500] - Settling timeout in ms
 * @param {string} [options.output] - Custom output file path
 * @param {boolean} [options.cliOnly=false] - Force CLI execution
 */
export async function takeSnapshot(targetPath, options = {}) {
    if (!targetPath || typeof targetPath !== 'string') {
        throw new Error('Target HTML path is required.');
    }

    const resolvedTarget = path.resolve(process.cwd(), targetPath);
    if (!fs.existsSync(resolvedTarget)) {
        throw new Error(`Target HTML file does not exist: ${resolvedTarget}`);
    }

    const chromePath = findChromeBinary();
    const fileUrl = 'file://' + resolvedTarget;

    const theme = options.theme || 'light';
    const selector = options.selector || null;
    const scale = Number(options.scale) || 2;
    const width = Number(options.width) || 1280;
    const height = Number(options.height) || 800;
    const timeout = Number(options.timeout) || 2500;
    const cliOnly = Boolean(options.cliOnly);

    // Determine target themes
    const themesToCapture = theme === 'both' ? ['light', 'dark'] : [theme];
    const results = [];

    const parsedTarget = path.parse(resolvedTarget);

    for (const t of themesToCapture) {
        let outPath = options.output;
        if (!outPath) {
            const suffix = theme === 'both' ? `_${t}` : (t === 'dark' ? '_dark' : '');
            outPath = path.join(parsedTarget.dir, `${parsedTarget.name}${suffix}.png`);
        } else if (theme === 'both') {
            const parsedOut = path.parse(path.resolve(process.cwd(), outPath));
            outPath = path.join(parsedOut.dir, `${parsedOut.name}_${t}${parsedOut.ext || '.png'}`);
        } else {
            outPath = path.resolve(process.cwd(), outPath);
        }

        const runConfig = {
            chromePath,
            fileUrl,
            theme: t,
            selector,
            scale,
            width,
            height,
            timeout,
            outputPath: outPath
        };

        let result;
        if (!cliOnly) {
            try {
                result = await captureViaCdp(runConfig);
            } catch (cdpErr) {
                console.warn(`[visual_snapshot] CDP mode failed (${cdpErr.message}), attempting CLI fallback...`);
                result = captureViaCli(runConfig);
            }
        } else {
            result = captureViaCli(runConfig);
        }

        results.push(result);
    }

    return theme === 'both' ? results : results[0];
}

/**
 * Capture screenshot directly from the live running Antigravity Electron app
 */
export async function captureViaLiveApp(options = {}) {
    let targetPort = options.port;
    if (!targetPort) {
        const portFile = path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
        if (!fs.existsSync(portFile)) {
            throw new Error(`Cannot locate Antigravity DevTools port. File not found: ${portFile}`);
        }
        targetPort = fs.readFileSync(portFile, 'utf8').trim().split('\n')[0];
    }

    const res = await fetch(`http://127.0.0.1:${targetPort}/json`);
    const targets = await res.json();
    const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) {
        throw new Error(`No active Antigravity page target found on port ${targetPort}`);
    }

    const cdp = new CdpSession(page.webSocketDebuggerUrl);
    await cdp.connect();

    try {
        const shotParams = { format: 'png' };
        const selector = options.selector;

        if (selector && typeof selector === 'string') {
            const evalRes = await cdp.send('Runtime.evaluate', {
                expression: `(() => {
                    const el = document.querySelector(${JSON.stringify(selector)});
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: r.x, y: r.y, width: r.width, height: r.height };
                })()`,
                returnByValue: true
            });
            const rect = evalRes?.result?.value;
            if (rect && rect.width > 0 && rect.height > 0) {
                shotParams.clip = {
                    x: Math.max(0, rect.x),
                    y: Math.max(0, rect.y),
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height),
                    scale: 1
                };
            }
        }

        const shotResult = await cdp.send('Page.captureScreenshot', shotParams);
        if (!shotResult || !shotResult.data) {
            throw new Error('Page.captureScreenshot returned empty payload from live app');
        }

        const outPath = options.output ? path.resolve(process.cwd(), options.output) : path.join(process.cwd(), 'antigravity_live_snapshot.png');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const imgBuffer = Buffer.from(shotResult.data, 'base64');
        fs.writeFileSync(outPath, imgBuffer);

        return {
            path: outPath,
            bytes: imgBuffer.length,
            target: page.title,
            selector: selector || 'full-window',
            port: targetPort
        };
    } finally {
        cdp.close();
    }
}

// --- CLI Runner ---
function parseArgs(args) {
    const opts = {
        theme: 'light',
        scale: 2,
        width: 1280,
        height: 800,
        timeout: 2500,
        selector: null,
        output: null,
        cliOnly: false,
        live: false,
        port: null
    };

    let target = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            opts.help = true;
        } else if (arg === '--live') {
            opts.live = true;
        } else if (arg.startsWith('--port=')) {
            opts.port = arg.split('=')[1];
            opts.live = true;
        } else if (arg.startsWith('--theme=')) {
            opts.theme = arg.split('=')[1].toLowerCase();
        } else if (arg === '--theme' && args[i + 1]) {
            opts.theme = args[++i].toLowerCase();
        } else if (arg.startsWith('--selector=')) {
            opts.selector = arg.split('=')[1];
        } else if (arg === '--selector' && args[i + 1]) {
            opts.selector = args[++i];
        } else if (arg.startsWith('--scale=')) {
            opts.scale = Number(arg.split('=')[1]);
        } else if (arg === '--scale' && args[i + 1]) {
            opts.scale = Number(args[++i]);
        } else if (arg.startsWith('--output=')) {
            opts.output = arg.split('=')[1];
        } else if (arg === '--output' && args[i + 1]) {
            opts.output = args[++i];
        } else if (arg.startsWith('--timeout=')) {
            opts.timeout = Number(arg.split('=')[1]);
        } else if (arg === '--timeout' && args[i + 1]) {
            opts.timeout = Number(args[++i]);
        } else if (arg.startsWith('--window-size=')) {
            const [w, h] = arg.split('=')[1].split(',').map(Number);
            if (w) opts.width = w;
            if (h) opts.height = h;
        } else if (arg === '--cli-only') {
            opts.cliOnly = true;
        } else if (!arg.startsWith('-') && !target) {
            target = arg;
        }
    }

    return { target, opts };
}

function showHelp() {
    console.log(`
📸 Antigravity Headless Chrome Visual Snapshot Engine (SNAP-01)

USAGE:
  node scripts/visual_snapshot.mjs <target.html> [options]
  node scripts/visual_snapshot.mjs --live [options]

OPTIONS:
  --live                     Capture live Antigravity Electron app directly via active DevTools port
  --port=<port>              Specify custom DevTools port for live capture (auto-detects if omitted)
  --theme=<light|dark|both>  Theme mode (default: light)
  --selector=<css-selector>  Clip tightly to specific element (e.g. "#app", ".card", "svg")
  --scale=<number>           Retina scale factor (default: 2)
  --window-size=<w,h>        Viewport dimensions in CSS px (default: 1280,800)
  --timeout=<ms>             Smart settle wait timeout in ms (default: 2500)
  --output=<path>            Custom destination file or base name
  --cli-only                 Force direct CLI execution (skips CDP)
  --help, -h                 Show this manual

EXAMPLES:
  # Capture dual-theme snapshots of an artifact
  node scripts/visual_snapshot.mjs test_context_circle.html --theme=both

  # Clip directly around the card widget at 2x Retina scale
  node scripts/visual_snapshot.mjs test_context_circle.html --selector="#preview-panel" --theme=dark

  # Capture LIVE running Antigravity Electron app
  node scripts/visual_snapshot.mjs --live --output=/tmp/antigravity_live.png
`);
}

// Direct Execution (handles symlinks and global links via realpath)
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
    const { target, opts } = parseArgs(process.argv.slice(2));

    if (opts.help || (!target && !opts.live)) {
        showHelp();
        process.exit(opts.help ? 0 : 1);
    }

    const runner = opts.live ? captureViaLiveApp(opts) : takeSnapshot(target, opts);

    runner
        .then((res) => {
            const list = Array.isArray(res) ? res : [res];
            console.log('✅ Visual snapshot(s) generated successfully:');
            for (const item of list) {
                const label = item.theme ? `[${item.theme.toUpperCase()}]` : `[LIVE]`;
                const scaleStr = item.scale ? ` @${item.scale}x` : '';
                console.log(`   • ${label} ${item.path} (${(item.bytes / 1024).toFixed(1)} KB, ${item.selector}${scaleStr})`);
            }
        })
        .catch((err) => {
            console.error('❌ Snapshot failed:', err.message);
            process.exit(1);
        });
}
