/**
 * seeso-bridge.js
 * Dynamically import seeso.min.js (ESM) to make it globally available without strict HTML module imports
 * avoiding CORS/extension related load issues.
 */
window.__seesoReady = (async () => {
    try {
        const mod = await import('./seeso/easy-seeso.js');
        window.EasySeeSo = mod.default || mod.EasySeeso || mod.EasySeeSo;

        MemoryLogger.info('BRIDGE', 'easy-seeso.js loaded successfully');
        return true;
    } catch (e) {
        MemoryLogger.error('BRIDGE', 'Failed to load easy-seeso.js', { msg: e.message });
        return false;
    }
})();
