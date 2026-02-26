/**
 * seeso-manager.js
 * SeeSo SDK 래퍼 — 공식 방법만 사용, 최소한의 추상화
 *
 * 핵심 원칙:
 * - EasySeeso.startTracking(onGaze, onDebug) 공식 시그니처 (2인자)
 * - 내부에서 getUserMedia() 호출 → 외부 stream 전달 없음
 * - 에러 발생 시 즉시 MemoryLogger에 기록
 * - 카메라 해상도 제어는 SDK 내부에 위임 (공식 방법 그대로)
 *
 * 흐름: initSDK() → startTracking() → startCalibration()
 */

class SeesoManager {
    constructor() {
        this._seeso = null;        // EasySeeso 인스턴스
        this._onGaze = null;
        this._onDebug = null;
        this._initialized = false;
        this._tracking = false;

        this.state = {
            sdk: 'idle',   // idle | loading | initialized | failed
            tracking: 'idle',   // idle | starting | running | failed
            cal: 'idle',   // idle | running | done | failed
        };
    }

    // ── 상태 업데이트 ────────────────────────────────────────────
    _setState(key, value) {
        const prev = this.state[key];
        this.state[key] = value;
        MemoryLogger.info('STATE', `${key}: ${prev} → ${value}`);

        // 상태별 statusText 자동 업데이트
        const el = document.getElementById('status-text');
        if (!el) return;
        const messages = {
            'sdk:loading': '🔄 AI 모델 다운로드 중...',
            'sdk:initialized': '✅ SDK 초기화 완료',
            'sdk:failed': '❌ SDK 초기화 실패',
            'tracking:starting': '📷 카메라 권한 요청 중...',
            'tracking:running': '👁️ 시선 추적 중',
            'tracking:failed': '❌ 시선 추적 실패',
            'cal:running': '🎯 캘리브레이션 진행 중...',
            'cal:done': '✅ 캘리브레이션 완료',
            'cal:failed': '❌ 캘리브레이션 실패',
        };
        const msg = messages[`${key}:${value}`];
        if (msg) el.textContent = msg;
    }

    // ── 1단계: SDK 초기화 ────────────────────────────────────────
    async initSDK() {
        if (this._initialized) {
            MemoryLogger.warn('SDK', 'initSDK skipped: already initialized');
            return true;
        }

        this._setState('sdk', 'loading');
        MemoryLogger.snapshot('SDK_INIT_START');

        // 라이선스 키: prod(github.io) / dev(그 외)
        const LICENSE_KEY = window.location.hostname === 'selfso2014.github.io'
            ? 'prod_srdpyuuaumnsqoyk2pvdci0rg3ahsr923bshp32u'
            : 'dev_1ntzip9admm6g0upynw3gooycnecx0vl93hz8nox';

        MemoryLogger.info('SDK', `License: ${LICENSE_KEY.startsWith('prod') ? 'PROD' : 'DEV'} | Host: ${window.location.hostname}`);

        return new Promise((resolve) => {
            // 30초 타임아웃
            const timeout = setTimeout(() => {
                MemoryLogger.error('SDK', 'initSDK TIMEOUT (30s)');
                this._setState('sdk', 'failed');
                resolve(false);
            }, 30000);

            try {
                this._seeso = new window.EasySeeSo();
                window.__seeso = this._seeso; // 디버그용 전역 참조

                this._seeso.init(
                    LICENSE_KEY,
                    () => {
                        // afterInitialized
                        clearTimeout(timeout);
                        this._initialized = true;
                        this._setState('sdk', 'initialized');
                        MemoryLogger.snapshot('SDK_INIT_DONE');
                        resolve(true);
                    },
                    () => {
                        // afterFailed
                        clearTimeout(timeout);
                        MemoryLogger.error('SDK', 'EasySeeso.init → afterFailed (license or WASM error)');
                        this._setState('sdk', 'failed');
                        resolve(false);
                    }
                );
            } catch (e) {
                clearTimeout(timeout);
                MemoryLogger.error('SDK', 'initSDK threw exception', { msg: e.message, stack: e.stack });
                this._setState('sdk', 'failed');
                resolve(false);
            }
        });
    }

    // ── 2단계: 시선 추적 시작 ────────────────────────────────────
    // async → await 가능: 카메라가 실제로 준비된 후 resolve
    // [FIX-iOS] 이전: 즉시 true 반환 → startCalibration이 카메라 준비 전 호출 → 검은 프레임
    // [FIX-iOS] 이후: Promise 반환 → caller가 await → 카메라 ready 보장
    async startTracking(onGaze, onDebug) {
        if (!this._seeso || !this._initialized) {
            MemoryLogger.error('TRACK', 'startTracking: SDK not initialized');
            return false;
        }

        this._onGaze = (gazeInfo) => {
            MemoryLogger.countGaze();
            if (onGaze) onGaze(gazeInfo);
        };

        this._onDebug = (fps, latMin, latMax, latAvg) => {
            MemoryLogger.info('SDK_DBG', `FPS=${fps} lat(min=${latMin} max=${latMax} avg=${typeof latAvg?.toFixed === 'function' ? latAvg.toFixed(1) : latAvg}ms)`);
            const el = document.getElementById('gaze-fps');
            if (el) el.textContent = fps;
            if (onDebug) onDebug(fps, latMin, latMax, latAvg);
        };

        this._setState('tracking', 'starting');
        MemoryLogger.snapshot('TRACKING_START');

        try {
            // 공식 방법: 2인자 (stream 전달 없음)
            // Promise를 await → 카메라 스트림이 실제로 시작될 때까지 대기
            const ok = await this._seeso.startTracking(this._onGaze, this._onDebug);
            MemoryLogger.info('TRACK', `startTracking resolved: ${ok}`);
            this._tracking = ok;
            this._setState('tracking', ok ? 'running' : 'failed');
            if (ok) MemoryLogger.snapshot('TRACKING_RUNNING');
            return ok;
        } catch (e) {
            MemoryLogger.error('TRACK', 'startTracking threw', { msg: e?.message, stack: e?.stack });
            this._setState('tracking', 'failed');
            return false;
        }
    }

    // ── 3단계: 1포인트 캘리브레이션 ─────────────────────────────
    startCalibration(onNextPoint, onProgress, onFinished) {
        if (!this._seeso || !this._initialized) {
            MemoryLogger.error('CAL', 'startCalibration: SDK not initialized');
            return false;
        }

        this._setState('cal', 'running');
        MemoryLogger.snapshot('CAL_START');

        const ok = this._seeso.startCalibration(
            (x, y) => {
                MemoryLogger.info('CAL', `Next point: (${x.toFixed(0)}, ${y.toFixed(0)})`);
                if (onNextPoint) onNextPoint(x, y);
                // ⚠️ startCollectSamples() 필수: 이 호출이 없으면 progress가 0%에서 멈춤
                // onNextPoint 콜백 직후 SDK에 데이터 수집 시작을 명시적으로 지시해야 함
                try {
                    this._seeso.startCollectSamples();
                    MemoryLogger.info('CAL', 'startCollectSamples() called ✅');
                } catch (e) {
                    MemoryLogger.error('CAL', 'startCollectSamples() failed', { msg: e.message });
                }
            },
            (progress) => {
                if (onProgress) onProgress(progress);
            },
            (calibrationData) => {
                MemoryLogger.info('CAL', 'Calibration finished!');
                MemoryLogger.snapshot('CAL_DONE');
                this._setState('cal', 'done');
                if (onFinished) onFinished(calibrationData);
            },
            1  // 1포인트 캘리브레이션
        );

        if (!ok) {
            MemoryLogger.error('CAL', 'startCalibration returned false');
            this._setState('cal', 'failed');
        }

        return ok;
    }

    // ── 정지/해제 ────────────────────────────────────────────────
    stopTracking() {
        if (!this._seeso) return;
        MemoryLogger.info('TRACK', 'stopTracking called');
        this._seeso.stopTracking();
        this._tracking = false;
    }

    deinit() {
        MemoryLogger.info('SDK', 'deinit called');
        MemoryLogger.snapshot('DEINIT');
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
