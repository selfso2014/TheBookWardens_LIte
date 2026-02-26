/**
 * seeso-manager.js
 * Wrapper for SeeSo SDK - Designed for extremely low memory usage and English locales.
 * 
 * - Async startTracking to prevent iOS black screen glitch
 * - Delegate Camera Resolution to SDK
 * - Error Logging fully in English
 */

class SeesoManager {
    constructor() {
        this._seeso = null;
        this._initialized = false;
        this._tracking = false;

        this.state = {
            sdk: 'idle',       // idle | loading | initialized | failed
            tracking: 'idle',  // idle | starting | running | failed
            cal: 'idle',       // idle | running | done | failed
        };
    }

    _setState(key, value) {
        const prev = this.state[key];
        this.state[key] = value;
        MemoryLogger.info('STATE', `${key}: ${prev} → ${value}`);

        const statusEl = document.getElementById('status-text');
        if (!statusEl) return;

        const messages = {
            'sdk:loading': 'Loading AI...',
            'sdk:initialized': 'SDK Ready',
            'sdk:failed': 'SDK Fail',
            'tracking:starting': 'Camera Req...',
            'tracking:running': 'Tracking',
            'tracking:failed': 'Cam Fail',
            'cal:running': 'Calibrating...',
            'cal:done': 'Calibrated',
            'cal:failed': 'Cal Fail',
        };

        const msg = messages[`${key}:${value}`];
        if (msg) statusEl.textContent = msg;
    }

    async initSDK() {
        if (this._initialized) {
            MemoryLogger.warn('SDK', 'initSDK skipped: already initialized');
            return true;
        }

        this._setState('sdk', 'loading');
        MemoryLogger.snapshot('SDK_INIT_START');

        // License key: Use Dev key by default, customize based on domain for production
        const isProd = ['selfso2014.github.io', 'bookwardens.com', 'www.bookwardens.com'].includes(window.location.hostname);
        const LICENSE_KEY = isProd
            ? 'prod_srdpyuuaumnsqoyk2pvdci0rg3ahsr923bshp32u'
            : 'dev_1ntzip9admm6g0upynw3gooycnecx0vl93hz8nox';

        MemoryLogger.info('SDK', `Initializing with License: ${LICENSE_KEY.startsWith('prod') ? 'PROD' : 'DEV'}`);

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                MemoryLogger.error('SDK', 'Initialization timeout (30s)');
                this._setState('sdk', 'failed');
                resolve({ success: false, error: 'timeout' });
            }, 30000);

            try {
                this._seeso = new window.EasySeeSo();

                this._seeso.init(
                    LICENSE_KEY,
                    () => {
                        clearTimeout(timeout);
                        this._initialized = true;
                        this._setState('sdk', 'initialized');
                        MemoryLogger.snapshot('SDK_INIT_DONE');
                        resolve({ success: true });
                    },
                    (errCode) => {
                        clearTimeout(timeout);
                        MemoryLogger.error('SDK', `Initialization failed (license or WASM issue). Error code: ${errCode}`);
                        this._setState('sdk', 'failed');
                        resolve({ success: false, error: `Code ${errCode}` });
                    }
                );
            } catch (e) {
                clearTimeout(timeout);
                MemoryLogger.error('SDK', 'Initialization threw an exception', { msg: e.message });
                this._setState('sdk', 'failed');
                resolve({ success: false, error: e.message });
            }
        });
    }

    async startTracking(onGaze, onDebug) {
        if (!this._seeso || !this._initialized) {
            MemoryLogger.error('TRACK', 'SDK not initialized');
            return false;
        }

        const wrappedOnGaze = (gazeInfo) => {
            MemoryLogger.countGaze();
            if (onGaze) onGaze(gazeInfo);
        };

        const wrappedOnDebug = (fps, latMin, latMax, latAvg) => {
            if (onDebug) onDebug(fps, latMin, latMax, latAvg);
        };

        this._setState('tracking', 'starting');
        MemoryLogger.snapshot('TRACKING_START');

        try {
            // Await tracking start so iOS waits for real camera frames before continuing
            const ok = await this._seeso.startTracking(wrappedOnGaze, wrappedOnDebug);
            MemoryLogger.info('TRACK', `Started tracking successfully: ${ok}`);
            this._tracking = ok;
            this._setState('tracking', ok ? 'running' : 'failed');
            return ok;
        } catch (e) {
            MemoryLogger.error('TRACK', 'startTracking Exception', { msg: e?.message });
            this._setState('tracking', 'failed');
            return false;
        }
    }

    startCalibration(onNextPoint, onProgress, onFinished) {
        if (!this._seeso || !this._initialized) {
            MemoryLogger.error('CAL', 'SDK not initialized');
            return false;
        }

        this._setState('cal', 'running');
        MemoryLogger.snapshot('CAL_START');

        const ok = this._seeso.startCalibration(
            (x, y) => {
                MemoryLogger.info('CAL', `Next point: (${x.toFixed(0)}, ${y.toFixed(0)})`);
                if (onNextPoint) onNextPoint(x, y);
                try {
                    // Critical for progressing calibration, without it it freezes at 0%
                    this._seeso.startCollectSamples();
                } catch (e) {
                    MemoryLogger.error('CAL', 'startCollectSamples Failed', { msg: e.message });
                }
            },
            (progress) => {
                if (onProgress) onProgress(progress);
            },
            (calibrationData) => {
                MemoryLogger.info('CAL', 'Calibration complete');
                this._setState('cal', 'done');
                if (onFinished) onFinished(calibrationData);
            },
            1 // 1-point calibration for fast/minimal setup
        );

        if (!ok) {
            MemoryLogger.error('CAL', 'startCalibration returned false');
            this._setState('cal', 'failed');
        }

        return ok;
    }

    stopTracking() {
        if (!this._seeso) return;
        this._seeso.stopTracking();
        this._tracking = false;
    }

    deinit() {
        this.stopTracking();
        if (this._seeso) {
            this._seeso.deinit();
            this._seeso = null;
        }
        this._initialized = false;
    }

    getState() { return { ...this.state }; }
    isTracking() { return this._tracking; }
}

window.SeesoManager = SeesoManager;
