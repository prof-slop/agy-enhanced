/**
 * Antigravity Context Window Circle HUD & Swarm Activity Pill
 * 
 * Injected into Antigravity's Electron window.
 * Targets: Directly a little to the right of the Model Selector in the chat bar.
 * - Dynamic per-conversation token tracking (updates on SPA route switch)
 * - FULL (100% stroke) when 0% tokens used (100% capacity remaining)
 * - EMPTIES smoothly as context tokens are consumed
 * - EMPTY (0% stroke) when 100% tokens used (0% capacity remaining)
 * - Prompt Cache Economics (Feature 3): Input, Cached, Output tokens & Cache Hit Rate
 * - Swarm Activity Pill (Feature 4): Live agent/worktree count with interactive drawer
 * - Micro-interactions:
 *   - Hover: Minimal 1-line badge with tokens used and % remaining (+ cache rate if >0)
 *   - Click: Minimal CLI-style status card ($ context --status) with ASCII progress bar and /compact trigger
 *   - Swarm Pill Click: Minimal CLI-style status card ($ git swarm --status) with active worktrees & roles
 */

export const CONTEXT_CIRCLE_HUD_CODE = `
(() => {
    if (window.__antigravity_context_hud_cleanup__) {
        try { window.__antigravity_context_hud_cleanup__(); } catch (_) {}
    }
    window.__antigravity_context_hud_installed__ = true;

    const CONFIG = {
        defaultMaxTokens: 262144, // 256k tokens (auto-compaction boundary)
        pollIntervalMs: 5000,
        circumference: 81.681, // 2 * PI * 13 (exact native kib geometry)
        storageKeyLimit: 'antigravity_hud_limit_v2',
        storageKeyMode: 'antigravity_hud_circle_mode_v1'
    };

    let state = {
        tokensUsed: 0,
        tokensMax: parseInt(localStorage.getItem(CONFIG.storageKeyLimit) || CONFIG.defaultMaxTokens, 10),
        circleMode: localStorage.getItem('antigravity_hud_circle_mode_v1') || 'context', // 'context' | '5h'
        cacheTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        activeConvoId: null,
        isExpanded: false,
        swarmExpanded: false,
        swarmData: {
            count: 0,
            activeBranch: 'main',
            worktrees: []
        },
        quotaData: {
            modelName: 'Selected Model',
            limit5h: '--',
            limitWeekly: '--',
            pct5hLeft: null,
            pctWeeklyLeft: null,
            remainingFraction5h: null,
            remainingFractionWeekly: null,
            lastFetch: 0
        }
    };

    function formatTokens(num) {
        if (!num || isNaN(num)) return '0';
        if (num === 262144 || num === 256000) return '256k';
        if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
        return String(num);
    }

    // PERF-02: Cached Antigravity native model quota green to eliminate layout thrashing & reflow
    let _cachedGreen = null;
    function getAntigravityGreen() {
        if (_cachedGreen) return _cachedGreen;
        const isDark = document.documentElement?.classList?.contains('dark') || 
                       document.body?.classList?.contains('dark') || 
                       document.body?.classList?.contains('theme-dark') || 
                       (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && !document.body?.classList?.contains('theme-light'));
        _cachedGreen = isDark ? 'rgb(122, 174, 102)' : 'rgb(99, 152, 79)';
        return _cachedGreen;
    }

    function getStatusColor(remainingPct) {
        const primaryGreen = getAntigravityGreen();
        if (remainingPct >= 50) return { stroke: primaryGreen, glow: 'rgba(99, 152, 79, 0.45)', name: 'Healthy' };
        if (remainingPct >= 20) return { stroke: 'rgb(234, 179, 8)', glow: 'rgba(234, 179, 8, 0.4)', name: 'Warning' };
        return { stroke: 'rgb(222, 85, 85)', glow: 'rgba(222, 85, 85, 0.6)', name: 'Critical' };
    }

    // Extract active conversation ID from the URL pathname / hash / search
    function getActiveConversationId() {
        try {
            const pathname = window.location.pathname || '';
            const m = pathname.match(/\\/c\\/([a-zA-Z0-9-]+)/);
            if (m) return m[1];
            const search = (window.location.search || '') + (window.location.hash || '');
            const sm = search.match(/c\\/([a-zA-Z0-9-]+)/);
            if (sm) return sm[1];
        } catch (_) {}
        return null;
    }

    // =========================================================================
    // 1. Context Window Circle Host Element (18px Native kib Geometry)
    // =========================================================================
    const hostEl = document.createElement('div');
    hostEl.id = 'antigravity-model-circle-hud';
    hostEl.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; vertical-align: middle; position: relative; cursor: pointer; user-select: none; width: 18px; height: 18px; flex-shrink: 0; z-index: 50; pointer-events: auto;';

    const shadow = hostEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = \`
        :host {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            cursor: pointer;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 11px;
            color: var(--hud-text, #18181b);
        }

        .circle-wrapper {
            position: relative;
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            background-color: var(--hud-bg, rgba(255, 255, 255, 0.06));
            box-shadow: inset 0 0 0 1px var(--hud-border, rgba(255, 255, 255, 0.12));
            transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
            pointer-events: auto;
            cursor: pointer;
        }

        :host(:hover) .circle-wrapper,
        .circle-wrapper:hover {
            background-color: var(--hud-bg-hover, rgba(255, 255, 255, 0.10));
            box-shadow: inset 0 0 0 1px var(--hud-border-hover, rgba(255, 255, 255, 0.20));
            transform: scale(1.04);
        }

        svg.gauge-svg {
            width: 18px;
            height: 18px;
            transform: rotate(-90deg);
            flex-shrink: 0;
            pointer-events: none;
        }

        circle.track {
            fill: none;
            stroke: var(--hud-track, #9ca3af);
            stroke-width: 3;
        }

        circle.meter {
            fill: none;
            stroke: var(--hud-color, rgb(99, 152, 79));
            stroke-width: 4;
            stroke-linecap: butt;
            stroke-dasharray: 81.681;
            stroke-dashoffset: 0;
            transition: stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease;
        }

        /* Tooltip on hover (Minimal CLI badge) */
        .tooltip {
            position: absolute;
            bottom: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 3px 7px;
            font-size: 9.5px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            letter-spacing: -0.1px;
            white-space: nowrap;
            color: #e6edf3;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
            pointer-events: none;
            display: none;
            z-index: 10000;
        }

        :host(:not(.open):hover) .tooltip,
        .circle-wrapper:not(.open):hover .tooltip {
            display: block;
        }

        :host(.open) .tooltip,
        :host(:hover).open .tooltip,
        .circle-wrapper.open .tooltip,
        .circle-wrapper.open:hover .tooltip {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
        }

        /* Minimal CLI Popover on click */
        .popover {
            position: absolute;
            bottom: calc(100% + 10px);
            left: -10px;
            width: 250px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 11px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            color: #c9d1d9;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.85);
            display: none;
            flex-direction: column;
            gap: 6px;
            z-index: 10001;
            cursor: default;
        }

        .popover.open {
            display: flex;
        }

        .popover-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 5px;
            border-bottom: 1px solid #21262d;
            font-size: 10px;
            color: #8b949e;
        }

        .cli-mode-toggle {
            display: inline-flex;
            align-items: center;
            background: rgba(22, 27, 34, 0.9);
            border: 1px solid #21262d;
            border-radius: 4px;
            padding: 1px;
            gap: 2px;
        }

        .mode-btn {
            background: transparent;
            border: none;
            color: #8b949e;
            font-size: 9px;
            font-family: inherit;
            padding: 1px 5px;
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.15s ease;
            user-select: none;
            line-height: 1.2;
        }

        .mode-btn.active {
            background: #30363d;
            color: #f0f6fc;
            font-weight: 600;
        }

        .mode-btn:hover:not(.active) {
            color: #c9d1d9;
        }

        .cli-bar {
            color: var(--hud-color, #34A853);
            letter-spacing: 1px;
            font-size: 10px;
            line-height: 1;
        }

        .cli-cache {
            background: rgba(22, 27, 34, 0.8);
            border: 1px solid #21262d;
            border-radius: 6px;
            padding: 6px 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
    \`;
    shadow.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.className = 'circle-wrapper';

    wrapper.innerHTML = \`
        <svg class="gauge-svg" viewBox="0 0 32 32">
            <circle class="track" cx="16" cy="16" r="13" />
            <circle class="meter" id="gauge-meter" cx="16" cy="16" r="13" />
        </svg>

        <div class="tooltip" id="gauge-tooltip">
            <span style="color:#f0f6fc;font-weight:600;" id="tt-used">0</span>
            <span style="color:#8b949e;" id="tt-sep"> / 256k (</span>
            <span style="color:#d1d5db;font-weight:600;" id="tt-pct">100% left</span>
            <span style="color:#8b949e;" id="tt-close">)</span>
        </div>

        <div class="popover" id="gauge-popover">
            <div class="popover-header">
                <span>$ context --status</span>
                <div class="cli-mode-toggle" id="hud-mode-toggle">
                    <button type="button" class="mode-btn active" data-mode="context" id="btn-mode-context">Context</button>
                    <button type="button" class="mode-btn" data-mode="5h" id="btn-mode-5h">5h Quota</button>
                </div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;">
                <span style="color:#8b949e;" id="pop-capacity-label">Capacity</span>
                <span style="color:var(--hud-color, #34A853);font-weight:bold;" id="pop-rem">100.0% remaining</span>
            </div>
            <div class="cli-bar" id="pop-cli-bar">[■■■■■■■■■■■■■■]</div>
            <div style="display:flex;justify-content:space-between;font-size:10px;">
                <span style="color:#8b949e;">Tokens</span>
                <span style="color:#f0f6fc;" id="pop-used">0 / 256k</span>
            </div>
            <div class="cli-cache" id="pop-quota-section">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;">
                    <span style="color:#8b949e;" id="pop-model-name">Selected Model</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:3px;font-size:9.5px;color:#8b949e;padding-top:4px;border-top:1px solid #21262d;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span>5h Limit:</span>
                        <span style="color:#f0f6fc;font-weight:600;" id="pop-5h-limit">--</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span>Weekly Limit:</span>
                        <span style="color:#d1d5db;font-weight:600;" id="pop-weekly-limit">--</span>
                    </div>
                </div>
            </div>
        </div>
    \`;

    shadow.appendChild(wrapper);

    const meter = shadow.getElementById('gauge-meter');
    const tooltip = shadow.getElementById('gauge-tooltip');
    const ttUsed = shadow.getElementById('tt-used');
    const ttSep = shadow.getElementById('tt-sep');
    const ttPct = shadow.getElementById('tt-pct');
    const ttClose = shadow.getElementById('tt-close');
    const popover = shadow.getElementById('gauge-popover');
    const popCapacityLabel = shadow.getElementById('pop-capacity-label');
    const popRem = shadow.getElementById('pop-rem');
    const popCliBar = shadow.getElementById('pop-cli-bar');
    const popUsed = shadow.getElementById('pop-used');
    const popModelName = shadow.getElementById('pop-model-name');
    const pop5hLimit = shadow.getElementById('pop-5h-limit');
    const popWeeklyLimit = shadow.getElementById('pop-weekly-limit');
    const btnModeContext = shadow.getElementById('btn-mode-context');
    const btnMode5h = shadow.getElementById('btn-mode-5h');

    // =========================================================================
    // 2. Swarm Activity Pill Host Element (Feature 4)
    // =========================================================================
    const swarmHostEl = document.createElement('div');
    swarmHostEl.id = 'antigravity-swarm-pill';
    swarmHostEl.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; vertical-align: middle; position: relative; user-select: none; height: 18px; flex-shrink: 0; z-index: 50; pointer-events: auto; cursor: pointer;';

    const swarmShadow = swarmHostEl.attachShadow({ mode: 'open' });

    const swarmStyle = document.createElement('style');
    swarmStyle.textContent = \`
        :host {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            cursor: pointer;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 10.5px;
            color: var(--swarm-text, #d1d5db);
        }

        .pill-wrapper {
            position: relative;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 1px 7px;
            height: 18px;
            box-sizing: border-box;
            border-radius: 9999px;
            background: var(--swarm-bg, rgba(255, 255, 255, 0.06));
            border: 1px solid var(--swarm-border, rgba(255, 255, 255, 0.12));
            color: var(--swarm-text, #d1d5db);
            cursor: pointer;
            pointer-events: auto;
            transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
        }

        :host(:hover) .pill-wrapper,
        .pill-wrapper:hover {
            background: var(--swarm-bg-hover, rgba(255, 255, 255, 0.10));
            border-color: var(--swarm-border-hover, rgba(255, 255, 255, 0.20));
            transform: scale(1.04);
        }

        .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: var(--swarm-dot, #e5e7eb);
            box-shadow: 0 0 6px var(--swarm-dot-glow, rgba(229, 231, 235, 0.3));
            animation: pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes pulse-dot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.85); }
        }

        .pill-label {
            font-size: 10px;
            font-weight: 500;
            line-height: 1;
            white-space: nowrap;
        }

        /* Tooltip on hover */
        .tooltip {
            position: absolute;
            bottom: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 3px 7px;
            font-size: 9.5px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            letter-spacing: -0.1px;
            white-space: nowrap;
            color: #e6edf3;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
            pointer-events: none;
            display: none;
            z-index: 10000;
        }

        :host(:not(.open):hover) .tooltip,
        .pill-wrapper:not(.open):hover .tooltip {
            display: block;
        }

        :host(.open) .tooltip,
        :host(:hover).open .tooltip,
        .pill-wrapper.open .tooltip,
        .pill-wrapper.open:hover .tooltip {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
        }

        /* Swarm Drawer Popover on click */
        .popover {
            position: absolute;
            bottom: calc(100% + 10px);
            left: -15px;
            width: 250px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 10.5px;
            color: #c9d1d9;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.85);
            display: none;
            flex-direction: column;
            gap: 6px;
            z-index: 10001;
            cursor: default;
        }

        .popover.open {
            display: flex;
        }

        .popover-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 5px;
            border-bottom: 1px solid #21262d;
            font-size: 10px;
            color: #8b949e;
        }
    \`;
    swarmShadow.appendChild(swarmStyle);

    const swarmWrapper = document.createElement('div');
    swarmWrapper.className = 'pill-wrapper';
    swarmWrapper.innerHTML = \`
        <span class="status-dot"></span>
        <span class="pill-label" id="swarm-pill-label">Swarm: Idle</span>
        <div class="tooltip" id="swarm-tooltip">Swarm: Idle (No active worktrees)</div>
        <div class="popover" id="swarm-popover">
            <div class="popover-header">
                <span>$ git swarm --status</span>
                <span id="pop-swarm-status-badge" style="color:var(--swarm-dot, #e5e7eb);font-weight:bold;">● IDLE</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:#8b949e;">
                <div style="display:flex;justify-content:space-between;">
                    <span>Branch:</span>
                    <span style="color:var(--swarm-branch, #d1d5db);font-weight:600;" id="pop-swarm-branch">main</span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                    <span>Worktrees:</span>
                    <span style="color:#f0f6fc;" id="pop-swarm-count">0 Active</span>
                </div>
            </div>
            <div style="border-top:1px solid #21262d;padding-top:6px;display:flex;flex-direction:column;gap:4px;">
                <span style="font-size:9px;text-transform:uppercase;color:#8b949e;letter-spacing:0.5px;font-weight:bold;">Active Swarm Workspaces</span>
                <div id="pop-swarm-list" style="display:flex;flex-direction:column;gap:3px;">
                    <div style="color:#8b949e;font-size:9.5px;padding:3px 6px;">No sibling worktrees active.</div>
                </div>
            </div>
        </div>
    \`;
    swarmShadow.appendChild(swarmWrapper);

    const swarmPillLabel = swarmShadow.getElementById('swarm-pill-label');
    const swarmTooltip = swarmShadow.getElementById('swarm-tooltip');
    const swarmPopover = swarmShadow.getElementById('swarm-popover');
    const popSwarmBranch = swarmShadow.getElementById('pop-swarm-branch');
    const popSwarmCount = swarmShadow.getElementById('pop-swarm-count');

    // =========================================================================
    // 3. Theme Colors & Reactive Updates
    // =========================================================================
    let _lastThemeIsDark = null;
    function updateThemeColors() {
        const isDark = document.documentElement?.classList?.contains('dark') || 
                       document.body?.classList?.contains('dark') || 
                       document.body?.classList?.contains('theme-dark') || 
                       (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && !document.body?.classList?.contains('theme-light'));

        if (isDark === _lastThemeIsDark) return;
        _lastThemeIsDark = isDark;

        if (isDark) {
            _cachedGreen = 'rgb(122, 174, 102)';
            wrapper.style.setProperty('--hud-text', '#f1f5f9');
            wrapper.style.setProperty('--hud-track', 'rgba(255, 255, 255, 0.15)');
            wrapper.style.setProperty('--hud-bg', 'rgba(255, 255, 255, 0.06)');
            wrapper.style.setProperty('--hud-bg-hover', 'rgba(255, 255, 255, 0.10)');
            wrapper.style.setProperty('--hud-border', 'rgba(255, 255, 255, 0.12)');
            wrapper.style.setProperty('--hud-border-hover', 'rgba(255, 255, 255, 0.20)');
            wrapper.style.setProperty('--hud-link', '#e5e7eb');

            // Style 1: Graphite Glass (Monochromatic Dark)
            swarmWrapper.style.setProperty('--swarm-bg', 'rgba(255, 255, 255, 0.06)');
            swarmWrapper.style.setProperty('--swarm-bg-hover', 'rgba(255, 255, 255, 0.10)');
            swarmWrapper.style.setProperty('--swarm-border', 'rgba(255, 255, 255, 0.12)');
            swarmWrapper.style.setProperty('--swarm-border-hover', 'rgba(255, 255, 255, 0.20)');
            swarmWrapper.style.setProperty('--swarm-text', '#d1d5db');
            swarmWrapper.style.setProperty('--swarm-dot', '#e5e7eb');
            swarmWrapper.style.setProperty('--swarm-dot-glow', 'rgba(229, 231, 235, 0.3)');
            swarmWrapper.style.setProperty('--swarm-branch', '#d1d5db');
        } else {
            _cachedGreen = 'rgb(99, 152, 79)';
            wrapper.style.setProperty('--hud-text', '#18181b');
            wrapper.style.setProperty('--hud-track', 'rgba(0, 0, 0, 0.12)');
            wrapper.style.setProperty('--hud-bg', 'rgba(0, 0, 0, 0.045)');
            wrapper.style.setProperty('--hud-bg-hover', 'rgba(0, 0, 0, 0.08)');
            wrapper.style.setProperty('--hud-border', 'rgba(0, 0, 0, 0.10)');
            wrapper.style.setProperty('--hud-border-hover', 'rgba(0, 0, 0, 0.18)');
            wrapper.style.setProperty('--hud-link', '#e5e7eb');

            // Style 1: Graphite Glass (Monochromatic Light)
            swarmWrapper.style.setProperty('--swarm-bg', 'rgba(0, 0, 0, 0.045)');
            swarmWrapper.style.setProperty('--swarm-bg-hover', 'rgba(0, 0, 0, 0.08)');
            swarmWrapper.style.setProperty('--swarm-border', 'rgba(0, 0, 0, 0.10)');
            swarmWrapper.style.setProperty('--swarm-border-hover', 'rgba(0, 0, 0, 0.18)');
            swarmWrapper.style.setProperty('--swarm-text', '#374151');
            swarmWrapper.style.setProperty('--swarm-dot', '#4b5563');
            swarmWrapper.style.setProperty('--swarm-dot-glow', 'rgba(75, 85, 99, 0.3)');
            swarmWrapper.style.setProperty('--swarm-branch', '#374151');
        }
    }

    function setCircleMode(newMode) {
        if (newMode !== 'context' && newMode !== '5h') return;
        state.circleMode = newMode;
        try {
            localStorage.setItem(CONFIG.storageKeyMode, newMode);
        } catch (_) {}
        updateModeUI();
        updateUI();
    }

    function updateModeUI() {
        const is5h = state.circleMode === '5h';
        if (btnModeContext) btnModeContext.classList.toggle('active', !is5h);
        if (btnMode5h) btnMode5h.classList.toggle('active', is5h);
    }

    if (btnModeContext) {
        btnModeContext.addEventListener('click', (e) => {
            e.stopPropagation();
            setCircleMode('context');
        });
    }
    if (btnMode5h) {
        btnMode5h.addEventListener('click', (e) => {
            e.stopPropagation();
            setCircleMode('5h');
        });
    }

    // PERF-02: Isolated gauge rendering without recursion into queryModelQuota
    function updateGaugeMetrics() {
        const C = CONFIG.circumference;

        let remainingRatio = 1.0;
        let displayUsedText = '';
        let displayPctText = '';

        if (state.circleMode === '5h') {
            // Mode: 5-Hour Rolling Limit (or primary model quota if Argon / non-5h)
            const isNon5h = (state.quotaData.limit5h === 'N/A' || state.quotaData.remainingFraction5h === null) || 
                            (state.quotaData.modelName && state.quotaData.modelName.includes('Argon'));
            let quotaFrac = isNon5h ? state.quotaData.remainingFractionWeekly : state.quotaData.remainingFraction5h;
            if (quotaFrac === null || quotaFrac === undefined) {
                quotaFrac = state.quotaData.remainingFraction5h ?? state.quotaData.remainingFractionWeekly;
            }
            if (typeof quotaFrac === 'number' && !isNaN(quotaFrac)) {
                remainingRatio = Math.max(0, Math.min(1, quotaFrac));
            } else if (!isNon5h && typeof state.quotaData.pct5hLeft === 'number') {
                remainingRatio = Math.max(0, Math.min(1, state.quotaData.pct5hLeft / 100));
            } else if (typeof state.quotaData.pctWeeklyLeft === 'number') {
                remainingRatio = Math.max(0, Math.min(1, state.quotaData.pctWeeklyLeft / 100));
            }

            const modelShort = state.quotaData.modelName ? state.quotaData.modelName.split('(')[0].trim() : '5h Quota';
            displayUsedText = modelShort;

            let quotaStr = state.quotaData.limit5h;
            if ((!quotaStr || quotaStr === '--' || quotaStr === 'N/A') && state.quotaData.modelName && state.quotaData.modelName.includes('Argon')) {
                quotaStr = state.quotaData.limitWeekly;
            }
            if (quotaStr && quotaStr !== '--' && quotaStr !== 'N/A' && quotaStr.includes('(') && quotaStr.includes(')')) {
                displayPctText = quotaStr.split('(')[1].split(')')[0].trim();
            } else if (quotaStr && quotaStr !== '--' && quotaStr !== 'N/A') {
                displayPctText = quotaStr;
            } else {
                displayPctText = \`\${Math.round(remainingRatio * 100)}% left\`;
            }
        } else {
            // Mode: Context Window (256k limit)
            const usedRatio = Math.min(1, Math.max(0, state.tokensUsed / state.tokensMax));
            remainingRatio = Math.max(0, 1 - usedRatio);
            displayUsedText = formatTokens(state.tokensUsed);
            displayPctText = \`\${Math.round(remainingRatio * 100)}% left\`;
        }

        // Rule: offset = 0 at 0% used (Full Circle), offset = C at 100% used (Empty)
        const offset = C * (1 - remainingRatio);
        meter.style.strokeDashoffset = offset.toFixed(3);

        const status = getStatusColor(remainingRatio * 100);
        wrapper.style.setProperty('--hud-color', status.stroke);
        wrapper.style.setProperty('--hud-glow', status.glow);

        if (state.circleMode === '5h') {
            ttUsed.textContent = displayUsedText;
            if (ttSep) ttSep.textContent = ' • ';
            ttPct.textContent = displayPctText;
            if (ttClose) ttClose.textContent = '';
        } else {
            ttUsed.textContent = displayUsedText;
            if (ttSep) ttSep.textContent = ' / 256k (';
            ttPct.textContent = displayPctText;
            if (ttClose) ttClose.textContent = ')';
        }

        // Popover metrics based on active mode
        if (state.circleMode === '5h') {
            if (popCapacityLabel) popCapacityLabel.textContent = 'Usage';
            const remPctQuota = (remainingRatio * 100).toFixed(1);
            if (popRem) popRem.textContent = \`\${remPctQuota}% remaining\`;
            const filledQuota = Math.round(remainingRatio * 14);
            if (popCliBar) popCliBar.textContent = \`[\${'■'.repeat(filledQuota)}\${'░'.repeat(14 - filledQuota)}]\`;
        } else {
            if (popCapacityLabel) popCapacityLabel.textContent = 'Capacity';
            const usedRatioCtx = Math.min(1, Math.max(0, state.tokensUsed / state.tokensMax));
            const remRatioCtx = Math.max(0, 1 - usedRatioCtx);
            const remPctCtx = (remRatioCtx * 100).toFixed(1);
            if (popRem) popRem.textContent = \`\${remPctCtx}% remaining\`;
            const filledCtx = Math.round(remRatioCtx * 14);
            if (popCliBar) popCliBar.textContent = \`[\${'■'.repeat(filledCtx)}\${'░'.repeat(14 - filledCtx)}]\`;
        }

        if (popUsed) popUsed.textContent = \`\${formatTokens(state.tokensUsed)} / \${formatTokens(state.tokensMax)}\`;
    }

    function updateUI() {
        updateThemeColors();
        updateModeUI();
        updateGaugeMetrics();
        updateQuotaUI();
        queryModelQuota();
    }

    function getQuotaColor(leftPct, text) {
        let pct = leftPct;
        if (typeof pct !== 'number' && typeof text === 'string') {
            const m = text.match(/(\d+)%\s*left/i);
            if (m) pct = parseInt(m[1], 10);
        }
        if (typeof pct === 'number' && !isNaN(pct)) {
            return getStatusColor(pct).stroke;
        }
        return '';
    }

    function updateQuotaUI() {
        if (popModelName) popModelName.textContent = state.quotaData.modelName || 'Selected Model';
        if (pop5hLimit) {
            pop5hLimit.textContent = state.quotaData.limit5h || '--';
            const col = getQuotaColor(state.quotaData.pct5hLeft, state.quotaData.limit5h);
            pop5hLimit.style.color = col || (state.quotaData.limit5h === 'N/A' ? '#8b949e' : '#f0f6fc');
        }
        if (popWeeklyLimit) {
            popWeeklyLimit.textContent = state.quotaData.limitWeekly || '--';
            const col = getQuotaColor(state.quotaData.pctWeeklyLeft, state.quotaData.limitWeekly);
            popWeeklyLimit.style.color = col || (state.quotaData.limitWeekly === 'N/A' ? '#8b949e' : '#d1d5db');
        }
    }

    function queryModelQuota() {
        const now = Date.now();
        if (state.quotaData && now - state.quotaData.lastFetch < 15000) {
            return;
        }
        state.quotaData.lastFetch = now;

        try {
            const btn = findModelSelector();
            if (!btn) return;
            const key = Object.keys(btn).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (!key) return;
            let fiber = btn[key];

            let selectedModel = null;
            let agentService = null;
            let curr = fiber;
            while (curr) {
                if (!selectedModel && curr.memoizedProps?.selectedModel) {
                    selectedModel = curr.memoizedProps.selectedModel;
                }
                if (!agentService && curr.memoizedProps?.agentService?.retrieveUserQuotaSummary) {
                    agentService = curr.memoizedProps.agentService;
                }
                curr = curr.return;
            }

            const modelLabel = selectedModel?.label || (btn.textContent || btn.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ') || 'Selected Model';
            state.quotaData.modelName = modelLabel;

            // Immediate fallback from selectedModel.quotaInfo
            if (selectedModel?.quotaInfo && typeof selectedModel.quotaInfo.remainingFraction === 'number') {
                const rem = selectedModel.quotaInfo.remainingFraction;
                const used = Math.max(0, Math.min(100, Math.round((1 - rem) * 100)));
                const left = Math.max(0, Math.min(100, Math.round(rem * 100)));
                if (modelLabel.includes('Argon')) {
                    state.quotaData.limitWeekly = \`\${used}% used (\${left}% left)\`;
                    state.quotaData.pctWeeklyLeft = left;
                    state.quotaData.remainingFractionWeekly = rem;
                    state.quotaData.limit5h = 'N/A';
                    state.quotaData.pct5hLeft = null;
                    state.quotaData.remainingFraction5h = null;
                } else {
                    state.quotaData.limit5h = \`\${used}% used (\${left}% left)\`;
                    state.quotaData.pct5hLeft = left;
                    state.quotaData.remainingFraction5h = rem;
                }
                updateQuotaUI();
                if (state.circleMode === '5h') updateGaugeMetrics();
            }

            // Live quota summary query
            if (agentService && typeof agentService.retrieveUserQuotaSummary === 'function') {
                Promise.resolve(agentService.retrieveUserQuotaSummary({})).then(resp => {
                    const groups = resp?.response?.groups || [];
                    if (!groups.length) return;

                    let matchedGroup = null;
                    if (modelLabel.includes('Argon')) {
                        matchedGroup = groups.find(g => g.displayName && g.displayName.includes('Argon')) || groups[0];
                    } else if (modelLabel.includes('Gemini')) {
                        matchedGroup = groups.find(g => g.displayName && g.displayName.includes('Gemini') && !g.displayName.includes('Argon')) || groups[0];
                    } else if (modelLabel.includes('Claude') || modelLabel.includes('GPT')) {
                        matchedGroup = groups.find(g => g.displayName && (g.displayName.includes('Claude') || g.displayName.includes('GPT'))) || groups[1];
                    } else {
                        matchedGroup = groups[0];
                    }

                    const buckets = matchedGroup?.buckets || [];
                    const b5h = buckets.find(b => b.window === '5h' || (b.bucketId && b.bucketId.includes('5h')));
                    const bWeekly = buckets.find(b => b.window === 'weekly' || (b.bucketId && b.bucketId.includes('weekly')));

                    function formatBucket(b) {
                        if (!b || !b.remaining || b.remaining.value === undefined) return 'N/A';
                        const remainingFrac = b.remaining.value;
                        const usedPct = Math.max(0, Math.min(100, Math.round((1 - remainingFrac) * 100)));
                        const leftPct = Math.max(0, Math.min(100, Math.round(remainingFrac * 100)));
                        let resetStr = '';
                        if (b.resetTime && b.resetTime.seconds) {
                            const resetSec = Number(b.resetTime.seconds);
                            const nowSec = Math.floor(Date.now() / 1000);
                            const diffSec = resetSec - nowSec;
                            if (diffSec > 0) {
                                const days = Math.floor(diffSec / 86400);
                                const hours = Math.floor((diffSec % 86400) / 3600);
                                const mins = Math.floor((diffSec % 3600) / 60);
                                if (days > 0) resetStr = ' • ' + days + 'd ' + hours + 'h';
                                else if (hours > 0) resetStr = ' • ' + hours + 'h ' + mins + 'm';
                                else resetStr = ' • ' + mins + 'm';
                            }
                        }
                        return \`\${usedPct}% used (\${leftPct}% left\${resetStr})\`;
                    }

                    if (b5h) {
                        state.quotaData.limit5h = formatBucket(b5h);
                        state.quotaData.pct5hLeft = (typeof b5h?.remaining?.value === 'number') ? Math.round(b5h.remaining.value * 100) : null;
                        state.quotaData.remainingFraction5h = (typeof b5h?.remaining?.value === 'number') ? b5h.remaining.value : null;
                    } else if (modelLabel.includes('Argon')) {
                        state.quotaData.limit5h = 'N/A';
                        state.quotaData.pct5hLeft = null;
                        state.quotaData.remainingFraction5h = null;
                    }

                    if (bWeekly) {
                        state.quotaData.limitWeekly = formatBucket(bWeekly);
                        state.quotaData.pctWeeklyLeft = (typeof bWeekly?.remaining?.value === 'number') ? Math.round(bWeekly.remaining.value * 100) : null;
                        state.quotaData.remainingFractionWeekly = (typeof bWeekly?.remaining?.value === 'number') ? bWeekly.remaining.value : null;
                    }

                    updateQuotaUI();
                    if (state.circleMode === '5h') updateGaugeMetrics();
                }).catch(() => {});
            }
        } catch (_) {}
    }

    // Interactive Popover Toggles (Mutual Exclusivity)
    function toggleCirclePopover(e) {
        if (e) {
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
        state.isExpanded = !state.isExpanded;
        popover.classList.toggle('open', state.isExpanded);
        wrapper.classList.toggle('open', state.isExpanded);
        hostEl.classList.toggle('open', state.isExpanded);
        if (tooltip) tooltip.style.display = state.isExpanded ? 'none' : '';
        hostEl.style.zIndex = state.isExpanded ? '10000' : '50';
        if (state.isExpanded && state.swarmExpanded) {
            state.swarmExpanded = false;
            swarmPopover.classList.remove('open');
            swarmWrapper.classList.remove('open');
            swarmHostEl.classList.remove('open');
            if (swarmTooltip) swarmTooltip.style.display = '';
            swarmHostEl.style.zIndex = '50';
        }
    }

    function toggleSwarmPopover(e) {
        if (e) {
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
        state.swarmExpanded = !state.swarmExpanded;
        swarmPopover.classList.toggle('open', state.swarmExpanded);
        swarmWrapper.classList.toggle('open', state.swarmExpanded);
        swarmHostEl.classList.toggle('open', state.swarmExpanded);
        if (swarmTooltip) swarmTooltip.style.display = state.swarmExpanded ? 'none' : '';
        swarmHostEl.style.zIndex = state.swarmExpanded ? '10000' : '50';
        if (state.swarmExpanded && state.isExpanded) {
            state.isExpanded = false;
            popover.classList.remove('open');
            wrapper.classList.remove('open');
            hostEl.classList.remove('open');
            if (tooltip) tooltip.style.display = '';
            hostEl.style.zIndex = '50';
        }
    }

    // Attach click listener ONLY to shadow wrappers so single clicks do not double-toggle
    wrapper.addEventListener('click', toggleCirclePopover);
    swarmWrapper.addEventListener('click', toggleSwarmPopover);

    const outsideClickHandler = (e) => {
        const path = (e.composedPath && e.composedPath()) || [];
        if (path.includes(hostEl) || path.includes(wrapper) || path.includes(popover) ||
            path.includes(swarmHostEl) || path.includes(swarmWrapper) || path.includes(swarmPopover)) {
            return;
        }
        if (state.isExpanded) {
            state.isExpanded = false;
            popover.classList.remove('open');
            wrapper.classList.remove('open');
            hostEl.classList.remove('open');
            if (tooltip) tooltip.style.display = '';
            hostEl.style.zIndex = '50';
        }
        if (state.swarmExpanded) {
            state.swarmExpanded = false;
            swarmPopover.classList.remove('open');
            swarmWrapper.classList.remove('open');
            swarmHostEl.classList.remove('open');
            if (swarmTooltip) swarmTooltip.style.display = '';
            swarmHostEl.style.zIndex = '50';
        }
    };
    document.addEventListener('click', outsideClickHandler);

    popover.addEventListener('click', (e) => e.stopPropagation());
    swarmPopover.addEventListener('click', (e) => e.stopPropagation());

    function applyMetrics(m) {
        if (!m || typeof m !== 'object') return;
        const currentActiveId = getActiveConversationId();
        // If metrics belong to another conversation that we navigated away from, discard
        if (m.activeConvoId && currentActiveId && m.activeConvoId !== currentActiveId) {
            return;
        }
        let changed = false;
        if (typeof m.tokensUsed === 'number' && !isNaN(m.tokensUsed) && m.tokensUsed >= 0 && m.tokensUsed !== state.tokensUsed) {
            state.tokensUsed = Math.floor(m.tokensUsed);
            changed = true;
        }
        if (typeof m.tokensMax === 'number' && !isNaN(m.tokensMax) && m.tokensMax > 0 && m.tokensMax !== state.tokensMax) {
            state.tokensMax = Math.min(262144, Math.floor(m.tokensMax));
            changed = true;
        }
        if (typeof m.cacheTokens === 'number' && !isNaN(m.cacheTokens) && m.cacheTokens >= 0) {
            state.cacheTokens = Math.floor(m.cacheTokens);
            changed = true;
        }
        if (typeof m.inputTokens === 'number' && !isNaN(m.inputTokens) && m.inputTokens >= 0) {
            state.inputTokens = Math.floor(m.inputTokens);
            changed = true;
        }
        if (typeof m.outputTokens === 'number' && !isNaN(m.outputTokens) && m.outputTokens >= 0) {
            state.outputTokens = Math.floor(m.outputTokens);
            changed = true;
        }
        if (typeof m.activeConvoId === 'string' && /^[a-zA-Z0-9_-]+$/.test(m.activeConvoId)) state.activeConvoId = m.activeConvoId;
        if (changed || state.tokensUsed === 0) updateUI();
    }

    function applySwarmStatus(s) {
        if (!s || typeof s !== 'object') return;
        const badgeEl = swarmShadow.getElementById('pop-swarm-status-badge');
        if (typeof s.count === 'number') {
            state.swarmData.count = s.count;
            if (s.count === 0) {
                if (swarmPillLabel) swarmPillLabel.textContent = 'Swarm: Idle';
                if (popSwarmCount) popSwarmCount.textContent = '0 Active';
                if (swarmTooltip) swarmTooltip.textContent = 'Swarm: Idle (No active worktrees)';
                if (badgeEl) badgeEl.textContent = '● IDLE';
            } else {
                if (swarmPillLabel) swarmPillLabel.textContent = 'Swarm: ' + s.count + ' Agent' + (s.count === 1 ? '' : 's');
                if (popSwarmCount) popSwarmCount.textContent = s.count + ' Active' + (s.activeBranch ? ' (' + s.activeBranch.replace('feature/', '') + ')' : '');
                if (swarmTooltip) swarmTooltip.textContent = (s.activeBranch || 'swarm') + ' • ' + s.count + ' Worktree' + (s.count === 1 ? '' : 's') + ' Active';
                if (badgeEl) badgeEl.textContent = '● ACTIVE';
            }
        }
        if (typeof s.activeBranch === 'string' && s.activeBranch) {
            state.swarmData.activeBranch = s.activeBranch;
            if (popSwarmBranch) popSwarmBranch.textContent = s.activeBranch;
        }
        const listEl = swarmShadow.getElementById('pop-swarm-list');
        if (listEl && Array.isArray(s.worktrees)) {
            const siblings = s.worktrees.filter(w => !w.isRoot);
            listEl.textContent = '';
            if (siblings.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'color:#8b949e;font-size:9.5px;padding:3px 6px;';
                empty.textContent = 'No sibling worktrees active.';
                listEl.appendChild(empty);
            } else {
                siblings.forEach(w => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 6px;border-radius:4px;background:#161b22;border:1px solid #21262d;font-size:9.5px;';
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.style.color = 'var(--swarm-dot, #e5e7eb)';
                    nameSpan.textContent = '● ' + String(w.name || '');
                    
                    const branchSpan = document.createElement('span');
                    branchSpan.style.color = '#8b949e';
                    branchSpan.textContent = String(w.branch || 'detached');
                    
                    row.appendChild(nameSpan);
                    row.appendChild(branchSpan);
                    listEl.appendChild(row);
                });
            }
        }
    }

    // 1. Message event listener from Preload Token Tailer & Swarm Bridge
    function onWindowMessage(event) {
        if (event.source !== window) return;
        if (event.data && typeof event.data === 'object') {
            if (event.data.type === 'ANTIGRAVITY_TOKEN_METRICS' && event.data.metrics) {
                applyMetrics(event.data.metrics);
            } else if (event.data.type === 'ANTIGRAVITY_SWARM_STATUS' && event.data.status) {
                applySwarmStatus(event.data.status);
            }
        }
    }
    window.addEventListener('message', onWindowMessage);

    // 2. Query tokens & swarm specifically
    function queryTokens() {
        const activeId = getActiveConversationId();

        // If on home/new conversation screen (no conversation ID), reset to 0 used (100% full)
        if (!activeId) {
            state.activeConvoId = null;
            state.tokensUsed = 0;
            updateUI();
            return;
        }

        // If switched to a different conversation, immediately update state so old metrics do not persist
        if (state.activeConvoId !== activeId) {
            state.activeConvoId = activeId;
            state.tokensUsed = 0;
            updateUI();
        }

        if (window.__antigravity_token_bridge__ && typeof window.__antigravity_token_bridge__.getLatestMetrics === 'function') {
            try {
                Promise.resolve(window.__antigravity_token_bridge__.getLatestMetrics(activeId)).then(metrics => {
                    if (metrics) applyMetrics(metrics);
                }).catch(() => {});
            } catch (_) {}
        }
    }

    function querySwarm() {
        if (window.__antigravity_token_bridge__ && typeof window.__antigravity_token_bridge__.getSwarmStatus === 'function') {
            try {
                Promise.resolve(window.__antigravity_token_bridge__.getSwarmStatus()).then(status => {
                    if (status) applySwarmStatus(status);
                }).catch(() => {});
            } catch (_) {}
        }
    }

    let lastPath = window.location.pathname;
    function onPopState() {
        setTimeout(() => { queryTokens(); querySwarm(); }, 60);
    }
    window.addEventListener('popstate', onPopState);

    // Helper: Accurately locate the chat model selector (STRICTLY within composer card to avoid touching messages or sidebar)
    function findModelSelector() {
        const composer = document.querySelector('.surface-composer-card, [class*="composer-card"], [class*="chat-input-container"]');
        if (!composer) return null;

        // 1. Direct targeted selector for model button
        const directBtn = composer.querySelector('button[aria-label*="model" i], button[aria-label^="Select model" i]');
        if (directBtn) return directBtn;

        // 2. Search within composer card buttons
        const buttons = Array.from(composer.querySelectorAll('button, [role="button"]'));
        for (const b of buttons) {
            const txt = (b.textContent || b.getAttribute('aria-label') || '').trim();
            if (/project/i.test(txt)) continue;
            if (txt.length > 0 && txt.length < 50 && /\b(gemini|flash|pro|claude|gpt|sonnet|opus|haiku|o1|o3|argon)\b/i.test(txt)) {
                return b;
            }
        }
        return null;
    }

    // Helper: Identify the correct horizontal flex container anchor for the model selector (PERF-06)
    let _cachedAnchor = null;
    function findMountAnchor(modelBtn) {
        if (!modelBtn) return null;
        if (_cachedAnchor && _cachedAnchor.isConnected && _cachedAnchor.contains(modelBtn)) {
            return _cachedAnchor;
        }

        // 1. Direct check for Antigravity's known input container wrapper
        const knownContainer = modelBtn.closest('.no-focus-agent-input, [class*="no-focus"]');
        if (knownContainer && knownContainer.parentElement) {
            const p = knownContainer.parentElement;
            if (p.classList && (p.classList.contains('flex') || p.className.includes('flex'))) {
                _cachedAnchor = knownContainer;
                return knownContainer;
            }
        }

        // 2. Walk up parents checking class heuristics before calling computed style
        let cur = modelBtn;
        while (cur && cur.parentElement && cur.parentElement !== document.body) {
            const p = cur.parentElement;
            const cls = p.className || '';
            if (typeof cls === 'string' && cls.includes('flex') && !cls.includes('flex-col')) {
                _cachedAnchor = cur;
                return cur;
            }
            cur = cur.parentElement;
        }

        _cachedAnchor = knownContainer || modelBtn;
        return _cachedAnchor;
    }

    // Attach both Context Circle HUD and Swarm Activity Pill adjacent to the model selector in the horizontal flex flow
    function mount() {
        // PERF-06: Fast bail-out if already correctly attached immediately after anchor
        if (hostEl && hostEl.isConnected && swarmHostEl && swarmHostEl.isConnected &&
            _cachedAnchor && _cachedAnchor.isConnected &&
            hostEl.previousElementSibling === _cachedAnchor && swarmHostEl.previousElementSibling === hostEl) {
            return true;
        }

        // Clean up any stale duplicate instances if present
        document.querySelectorAll('#antigravity-model-circle-hud').forEach(el => {
            if (el !== hostEl) el.remove();
        });
        document.querySelectorAll('#antigravity-swarm-pill').forEach(el => {
            if (el !== swarmHostEl) el.remove();
        });

        const modelBtn = findModelSelector();
        const anchor = findMountAnchor(modelBtn);
        if (!anchor || !anchor.parentElement) return false;

        const parent = anchor.parentElement;
        if (!parent.contains(hostEl) || hostEl.previousElementSibling !== anchor) {
            anchor.insertAdjacentElement('afterend', hostEl);
        }
        if (!parent.contains(swarmHostEl) || swarmHostEl.previousElementSibling !== hostEl) {
            hostEl.insertAdjacentElement('afterend', swarmHostEl);
        }

        updateUI();
        queryTokens();
        querySwarm();
        console.log('[Antigravity HUD] Context Circle and Swarm Pill mounted cleanly adjacent to model selector.');
        return true;
    }

    // Initial mount and token query
    mount();
    queryTokens();
    querySwarm();

    // DOM Readiness listeners
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            mount();
            queryTokens();
            querySwarm();
        });
    }
    window.addEventListener('load', () => {
        mount();
        queryTokens();
        querySwarm();
    });

    let debounceTimer = null;
    function debouncedMount() {
        // PERF-06: Fast bail-out without calling findModelSelector or layout reflows
        if (hostEl && hostEl.isConnected && swarmHostEl && swarmHostEl.isConnected &&
            _cachedAnchor && _cachedAnchor.isConnected &&
            hostEl.previousElementSibling === _cachedAnchor &&
            swarmHostEl.previousElementSibling === hostEl) {
            return;
        }
        if (debounceTimer) return;
        debounceTimer = requestAnimationFrame(() => {
            debounceTimer = null;
            mount();
        });
    }

    // PERF-07: Scope MutationObserver to composer container with subtree: false
    let obs = null;
    try {
        obs = new MutationObserver(() => {
            if (!document.contains(hostEl) || !document.contains(swarmHostEl)) {
                debouncedMount();
            }
        });
        const composer = document.querySelector('.surface-composer-card, [class*="composer-card"], [class*="chat-input-container"]');
        const observeTarget = composer?.parentElement || composer || document.body;
        obs.observe(observeTarget, { childList: true, subtree: false });
    } catch (_) {}

    // Polling interval to maintain mount across React re-renders and refresh tokens for active conversation
    const pollTimer = setInterval(() => {
        const currentPath = window.location.pathname;
        if (currentPath !== lastPath) {
            lastPath = currentPath;
            queryTokens();
            querySwarm();
        }
        mount();
    }, CONFIG.pollIntervalMs);

    window.__antigravity_context_hud_cleanup__ = () => {
        clearInterval(pollTimer);
        if (obs) {
            try { obs.disconnect(); } catch (_) {}
            obs = null;
        }
        try { document.removeEventListener('click', outsideClickHandler); } catch (_) {}
        try { window.removeEventListener('message', onWindowMessage); } catch (_) {}
        try { window.removeEventListener('popstate', onPopState); } catch (_) {}
        document.querySelectorAll('#antigravity-model-circle-hud').forEach(el => el.remove());
        document.querySelectorAll('#antigravity-swarm-pill').forEach(el => el.remove());
        window.__antigravity_context_hud_installed__ = false;
    };
})();
`;
