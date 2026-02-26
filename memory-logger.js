/**
 * memory-logger.js
 * Minimal logger built to avoid memory leak and garbage collection overhead.
 */

class Logger {
    constructor() {
        this.logs = [];
        this.gazeCount = 0;
    }

    info(module, message, data = null) {
        this._log('INFO', module, message, data);
    }

    warn(module, message, data = null) {
        this._log('WARN', module, message, data);
    }

    error(module, message, data = null) {
        this._log('ERROR', module, message, data);
    }

    snapshot(label) {
        this.info('SNAPSHOT', label);
    }

    countGaze() {
        this.gazeCount++;
    }

    _log(level, module, message, data) {
        const time = new Date().toISOString().split('T')[1].replace('Z', '');
        let logStr = `[${time}] [${level}] [${module}] ${message}`;
        if (data) {
            try {
                logStr += ` | ${JSON.stringify(data)}`;
            } catch (e) {
                logStr += ` | [Unserializable Data]`;
            }
        }
        console.log(logStr);
        // Do not store indefinitely if we strictly want minimal memory overhead
        // If needed to send to server later, implement rotating buffer here.
    }
}

window.MemoryLogger = new Logger();
