/**
 * seeso-bridge.js
 * Dynamically imports easy-seeso.js (ESM) and exposes EasySeeSo on window.
 * Paths are relative to project root.
 *
 * Usage: await window.__seesoReady
 */
window.__seesoReady = (async () => {
    try {
        const mod = await import('./seeso/easy-seeso.js');
        window.EasySeeSo = mod.default || mod.EasySeeso || mod.EasySeeSo;

        MemoryLogger.info('BRIDGE', 'easy-seeso.js loaded successfully', {
            hasDefault: !!mod.default,
            exportKeys: Object.keys(mod).slice(0, 10),
        });
        return true;
    } catch (e) {
        MemoryLogger.error('BRIDGE', 'Failed to load easy-seeso.js', { msg: e.message });
        return false;
    }
})();
