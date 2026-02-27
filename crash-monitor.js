/**
 * crash-monitor.js
 * iOS Crash Diagnostics — No Mac Required
 *
 * Features:
 * 1. Periodic memory measurement (performance.measureUserAgentSpecificMemory)
 * 2. Crash detection via clean-exit flag in localStorage
 * 3. On-screen HUD overlay (visible on device)
 * 4. Event timeline ring buffer (last 50 events → localStorage)
 * 5. Snapshot every 2s → localStorage for post-crash forensics
 *
 * Load FIRST in index.html, before all other scripts.
 */

(function () {
    'use strict';

    const STORAGE_KEY_SNAPSHOT = '__crash_snap';
    const STORAGE_KEY_TIMELINE = '__crash_timeline';
    const STORAGE_KEY_CLEAN = '__crash_clean_exit';
    const STORAGE_KEY_REPORT = '__crash_last_report';
    const SNAPSHOT_INTERVAL_MS = 2000;
    const TIMELINE_FLUSH_MS = 5000;
    const MEMORY_MEASURE_MS = 3000;
    const MAX_TIMELINE_EVENTS = 50;

    // ── Event Timeline Ring Buffer ──────────────────────────────
    const _timeline = [];
    let _startTime = Date.now();

    function pushEvent(type, detail) {
        const entry = {
            t: Date.now() - _startTime,   // ms since page load
            type: type,
            d: detail || ''
        };
        _timeline.push(entry);
        if (_timeline.length > MAX_TIMELINE_EVENTS) {
            _timeline.shift();
        }
    }

    // ── Memory Measurement ──────────────────────────────────────
    let _lastMemoryMB = '?';
    let _memorySupported = false;

    async function measureMemory() {
        if (!performance.measureUserAgentSpecificMemory) return;
        try {
            const result = await performance.measureUserAgentSpecificMemory();
            _memorySupported = true;
            _lastMemoryMB = (result.bytes / 1024 / 1024).toFixed(1);
            pushEvent('MEM', _lastMemoryMB + 'MB');
        } catch (e) {
            // CrossOriginIsolated may not be active
            _lastMemoryMB = 'N/A';
        }
    }

    // ── Snapshot to localStorage ────────────────────────────────
    function saveSnapshot() {
        try {
            const snap = {
                time: Date.now(),
                iso: new Date().toISOString(),
                uptime: Math.round(performance.now()),
                state: window.gameApp ? window.gameApp.state : 'NO_GAME',
                gazeCount: window.gameApp ? window.gameApp._gCount : 0,
                memMB: _lastMemoryMB,
                memSupported: _memorySupported,
                url: location.href,
                ua: navigator.userAgent.slice(0, 120)
            };
            localStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify(snap));
        } catch (e) {
            // localStorage full or unavailable — ignore
        }
    }

    function flushTimeline() {
        try {
            localStorage.setItem(STORAGE_KEY_TIMELINE, JSON.stringify(_timeline));
        } catch (e) { /* ignore */ }
    }

    // ── Crash Detection (on page load) ──────────────────────────
    function checkPreviousCrash() {
        try {
            const wasClean = localStorage.getItem(STORAGE_KEY_CLEAN);
            const prevSnap = localStorage.getItem(STORAGE_KEY_SNAPSHOT);
            const prevTimeline = localStorage.getItem(STORAGE_KEY_TIMELINE);

            if (wasClean === 'false' && prevSnap) {
                // Previous session did NOT exit cleanly → CRASH
                const snap = JSON.parse(prevSnap);
                let timeline = [];
                try { timeline = JSON.parse(prevTimeline) || []; } catch (_) { }

                const report = {
                    crashed: true,
                    snapshot: snap,
                    timeline: timeline,
                    detectedAt: new Date().toISOString()
                };

                localStorage.setItem(STORAGE_KEY_REPORT, JSON.stringify(report));

                const uptimeSec = (snap.uptime / 1000).toFixed(1);
                const msg = [
                    '⚠️ CRASH DETECTED from previous session',
                    `Last State: ${snap.state}`,
                    `Uptime: ${uptimeSec}s`,
                    `Memory: ${snap.memMB}MB`,
                    `Gaze Count: ${snap.gazeCount}`,
                    `Time: ${snap.iso}`,
                    `Events: ${timeline.length} logged`
                ].join('\n');

                console.warn(msg);
                showCrashBanner(msg);
                return report;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function showCrashBanner(msg) {
        const banner = document.createElement('div');
        banner.id = 'crash-banner';
        banner.style.cssText = [
            'position:fixed; top:0; left:0; right:0; z-index:100000;',
            'background:rgba(220,38,38,0.95); color:#fff;',
            'padding:12px 16px; font:12px/1.4 monospace;',
            'white-space:pre-wrap; max-height:40vh; overflow-y:auto;',
            'box-shadow:0 2px 12px rgba(0,0,0,0.4);'
        ].join('');
        banner.textContent = msg;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕ CLOSE';
        closeBtn.style.cssText = [
            'display:block; margin-top:8px; padding:6px 14px;',
            'background:#fff; color:#dc2626; border:none; border-radius:4px;',
            'font:bold 12px monospace; cursor:pointer;'
        ].join('');
        closeBtn.onclick = () => banner.remove();
        banner.appendChild(closeBtn);

        // Also add "Copy Report" button
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋 COPY REPORT';
        copyBtn.style.cssText = [
            'display:inline-block; margin-top:8px; margin-left:8px; padding:6px 14px;',
            'background:#fff; color:#1d4ed8; border:none; border-radius:4px;',
            'font:bold 12px monospace; cursor:pointer;'
        ].join('');
        copyBtn.onclick = () => {
            const fullReport = localStorage.getItem(STORAGE_KEY_REPORT) || msg;
            navigator.clipboard.writeText(fullReport).then(() => {
                copyBtn.textContent = '✓ Copied!';
            }).catch(() => {
                // Fallback: select text
                const range = document.createRange();
                range.selectNodeContents(banner);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(range);
            });
        };
        banner.appendChild(copyBtn);

        if (document.body) {
            document.body.appendChild(banner);
        } else {
            document.addEventListener('DOMContentLoaded', () => document.body.appendChild(banner));
        }
    }

    // ── HUD Overlay ─────────────────────────────────────────────
    let _hud = null;

    function createHUD() {
        _hud = document.createElement('div');
        _hud.id = 'crash-hud';
        _hud.style.cssText = [
            'position:fixed; bottom:8px; left:8px; z-index:99999;',
            'background:rgba(0,0,0,0.7); color:#0f0;',
            'padding:6px 10px; border-radius:6px;',
            'font:11px/1.5 monospace; pointer-events:none;',
            'min-width:180px; backdrop-filter:blur(4px);',
            'transition:opacity 0.3s;'
        ].join('');
        _hud.textContent = 'CrashMon: init...';

        if (document.body) {
            document.body.appendChild(_hud);
        } else {
            document.addEventListener('DOMContentLoaded', () => document.body.appendChild(_hud));
        }
    }

    function updateHUD() {
        if (!_hud) return;
        const upSec = (performance.now() / 1000).toFixed(0);
        const state = window.gameApp ? window.gameApp.state : '-';
        const gaze = window.gameApp ? window.gameApp._gCount : 0;
        const evts = _timeline.length;

        const lines = [
            `MEM: ${_lastMemoryMB}MB | UP: ${upSec}s`,
            `STATE: ${state} | GAZE: ${gaze}`,
            `EVENTS: ${evts} | COI: ${crossOriginIsolated ? 'Y' : 'N'}`
        ];
        _hud.textContent = lines.join('\n');
    }

    // ── Clean Exit Flag ─────────────────────────────────────────
    function markSessionStart() {
        try {
            localStorage.setItem(STORAGE_KEY_CLEAN, 'false');
        } catch (e) { /* ignore */ }
    }

    function markCleanExit() {
        try {
            localStorage.setItem(STORAGE_KEY_CLEAN, 'true');
        } catch (e) { /* ignore */ }
    }

    // ── Global Error Handlers ───────────────────────────────────
    window.addEventListener('error', (e) => {
        pushEvent('ERR', `${e.message} @ ${e.filename}:${e.lineno}`);
        saveSnapshot();
        flushTimeline();
    });

    window.addEventListener('unhandledrejection', (e) => {
        const reason = e.reason ? (e.reason.message || String(e.reason)) : 'unknown';
        pushEvent('REJECT', reason);
        saveSnapshot();
        flushTimeline();
    });

    // ── Page Lifecycle Events (iOS specific) ────────────────────
    window.addEventListener('pagehide', () => {
        pushEvent('LIFECYCLE', 'pagehide');
        saveSnapshot();
        flushTimeline();
        markCleanExit();
    });

    window.addEventListener('beforeunload', () => {
        pushEvent('LIFECYCLE', 'beforeunload');
        saveSnapshot();
        flushTimeline();
        markCleanExit();
    });

    document.addEventListener('visibilitychange', () => {
        pushEvent('LIFECYCLE', 'visibility:' + document.visibilityState);
        if (document.visibilityState === 'hidden') {
            saveSnapshot();
            flushTimeline();
        }
    });

    // iOS specific: detect memory warning via performance observer
    if (window.PerformanceObserver) {
        try {
            const obs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    pushEvent('PERF', `${entry.entryType}:${entry.name}`);
                }
            });
            obs.observe({ entryTypes: ['longtask'] });
        } catch (e) { /* longtask not supported — ok */ }
    }

    // ── Public API ──────────────────────────────────────────────
    window.CrashMonitor = {
        pushEvent: pushEvent,

        /** Call from game code at key moments */
        mark: function (label) {
            pushEvent('MARK', label);
        },

        /** Get the full crash report from previous session */
        getLastReport: function () {
            try {
                return JSON.parse(localStorage.getItem(STORAGE_KEY_REPORT));
            } catch (e) { return null; }
        },

        /** Get current snapshot */
        getCurrentSnapshot: function () {
            return {
                uptime: Math.round(performance.now()),
                state: window.gameApp ? window.gameApp.state : 'NO_GAME',
                gazeCount: window.gameApp ? window.gameApp._gCount : 0,
                memMB: _lastMemoryMB,
                timelineLength: _timeline.length
            };
        },

        /** Manually dump everything to localStorage right now */
        flush: function () {
            saveSnapshot();
            flushTimeline();
        },

        /** Clear all stored crash data */
        clearAll: function () {
            localStorage.removeItem(STORAGE_KEY_SNAPSHOT);
            localStorage.removeItem(STORAGE_KEY_TIMELINE);
            localStorage.removeItem(STORAGE_KEY_CLEAN);
            localStorage.removeItem(STORAGE_KEY_REPORT);
        }
    };

    // ── Bootstrap ───────────────────────────────────────────────
    pushEvent('BOOT', 'CrashMonitor loaded');
    const crashReport = checkPreviousCrash();
    markSessionStart();
    createHUD();

    // Start periodic tasks
    setInterval(saveSnapshot, SNAPSHOT_INTERVAL_MS);
    setInterval(flushTimeline, TIMELINE_FLUSH_MS);
    setInterval(measureMemory, MEMORY_MEASURE_MS);
    setInterval(updateHUD, 1000);

    // Initial memory measure
    setTimeout(measureMemory, 500);

    console.log('[CrashMonitor] Initialized. HUD active. Snapshot interval: ' + SNAPSHOT_INTERVAL_MS + 'ms');
    if (crashReport) {
        console.warn('[CrashMonitor] Previous crash report available. Access via CrashMonitor.getLastReport()');
    }

})();
