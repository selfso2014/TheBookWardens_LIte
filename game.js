/**
 * game.js
 * Main game loop & state machine
 * Implements extreme memory optimization via TypedArray circular buffers.
 * All texts strictly in English.
 */

const MAX_GAZE_ENTRIES = 1800; // 60s @ 30Hz

class Game {
    constructor() {
        this.seesoMgr = new SeesoManager();
        this.state = 'IDLE';

        // Gaze Data Buffer - TypedArray Circular Buffer (Zero GC overhead per frame)
        this._gx = new Int32Array(MAX_GAZE_ENTRIES);
        this._gy = new Int32Array(MAX_GAZE_ENTRIES);
        this._gt = new Uint32Array(MAX_GAZE_ENTRIES);
        this._gIdx = 0;
        this._gCount = 0;

        this._gazeDot = document.getElementById('gaze-dot');
    }

    async setState(newState) {
        this.state = newState;
        MemoryLogger.info('GAME', `State updated: ${newState}`);

        // Hide all sections
        document.querySelectorAll('.game-section').forEach(el => el.classList.remove('active'));

        // Show active section
        const sectionMap = {
            IDLE: 'section-idle',
            SDK_INIT: 'section-loading',
            CALIBRATION: 'section-calibration',
            READING: 'section-reading'
        };

        const sectionId = sectionMap[newState];
        if (sectionId) {
            const el = document.getElementById(sectionId);
            if (el) el.classList.add('active');
        }
    }

    async start() {
        MemoryLogger.info('GAME', '=== Start Sequence Initiated ===');
        await this.setState('SDK_INIT');

        // SDK loading Bridge logic wait
        const bridgeOk = await window.__seesoReady;
        if (!bridgeOk) {
            const errDetail = window.__seesoError || 'unknown';
            document.getElementById('status-text').innerHTML = `Init Fail:<br/>Module load: ${errDetail}`;
            return;
        }

        if (window.crossOriginIsolated === false) {
            document.getElementById('status-text').innerHTML = 'Init Fail: <br/> Not Cross-Origin Isolated. <br/> Please run via Local Server (HTTP), not file://';
            return;
        }

        const sdkOk = await this.seesoMgr.initSDK();
        if (!sdkOk) {
            document.getElementById('status-text').innerHTML = 'Init Fail:<br/>SDK initialization failed';
            return;
        }

        const trackOk = await this.seesoMgr.startTracking(
            (gazeInfo) => this._onGaze(gazeInfo),
            (fps) => {
                document.getElementById('debug-fps').textContent = `FPS: ${fps}`;
            }
        );

        if (!trackOk) {
            document.getElementById('status-text').textContent = 'Cam Fail';
            return;
        }

        // Delay briefly for camera to adapt before jumping into calibration
        setTimeout(() => this.startCalibration(), 1000);
    }

    startCalibration() {
        this.setState('CALIBRATION');

        const calDot = document.getElementById('cal-dot');
        const calProgress = document.getElementById('cal-progress');

        this.seesoMgr.startCalibration(
            (x, y) => {
                calDot.style.left = `${x}px`;
                calDot.style.top = `${y}px`;
                calDot.style.display = 'block';
                calProgress.style.display = 'block';
                calProgress.textContent = "0%";
            },
            (progress) => {
                calProgress.textContent = `${Math.floor(progress * 100)}%`;
            },
            (calibrationData) => {
                calDot.style.display = 'none';
                calProgress.style.display = 'none';
                MemoryLogger.info('GAME', 'Calibration successful');
                this.startGameplay();
            }
        );
    }

    startGameplay() {
        this.setState('READING');
        MemoryLogger.info('GAME', 'Gameplay started');
    }

    _onGaze(gazeInfo) {
        // Very fast path: store primitive data sequentially, no object allocations
        this._gx[this._gIdx] = Math.round(gazeInfo.x);
        this._gy[this._gIdx] = Math.round(gazeInfo.y);
        this._gt[this._gIdx] = Math.round(performance.now());

        this._gIdx = (this._gIdx + 1) % MAX_GAZE_ENTRIES;
        if (this._gCount < MAX_GAZE_ENTRIES) this._gCount++;

        // Draw debug dot (requestAnimationFrame ideally)
        if (this._gazeDot) {
            this._gazeDot.style.transform = `translate3d(${gazeInfo.x}px, ${gazeInfo.y}px, 0)`;
            this._gazeDot.style.display = 'block';
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.gameApp = new Game();
    document.getElementById('btn-start').addEventListener('click', () => {
        window.gameApp.start();
    });
});
