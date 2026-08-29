// ============================================================
// not-dice | logger.js
// Gestor centralizado de logging y administración de errores
// ============================================================

const MODULE_ID = "not-dice";
const MODULE_NAME = "Not Dice";

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    OFF: 4
};

const STYLES = {
    badge: "background: #2c3e50; color: #ecf0f1; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
    debug: "background: #7b1fa2; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
    info: "background: #1976d2; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
    warn: "background: #f57f17; color: #212121; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
    error: "background: #c62828; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
    text: "color: inherit; font-weight: normal;"
};

class NotDiceLogger {
    constructor() {
        this.moduleId = MODULE_ID;
        this.moduleName = MODULE_NAME;
        this._maxHistory = 100;
        this._history = [];
        this._manualDebug = false;
    }

    /**
     * Determina si el modo depuración está activo.
     * @returns {boolean}
     */
    get isDebug() {
        if (this._manualDebug) return true;
        try {
            if (typeof game !== "undefined" && game.settings?.settings?.has?.(`${MODULE_ID}.enableDebugLogs`)) {
                return !!game.settings.get(MODULE_ID, "enableDebugLogs");
            }
        } catch (_) {
            // Entorno previo a la inicialización de game.settings
        }
        return false;
    }

    /**
     * Activa o desactiva manualmente el modo debug en tiempo de ejecución.
     * @param {boolean} enabled 
     */
    setDebugMode(enabled) {
        this._manualDebug = !!enabled;
        this.info(`Modo debug ${this._manualDebug ? "activado" : "desactivado"} manualmente.`);
    }

    /**
     * Registra una entrada en el historial interno en memoria.
     * @private
     */
    _record(level, message, details = null) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message: typeof message === "string" ? message : String(message),
            details: details instanceof Error ? { name: details.name, message: details.message, stack: details.stack } : details
        };

        this._history.push(entry);
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }
    }

    /**
     * Log de nivel DEBUG (solo visible si el modo debug está activo).
     * @param {string} message 
     * @param {...any} args 
     */
    debug(message, ...args) {
        if (!this.isDebug) return;
        this._record("DEBUG", message, args.length > 0 ? args : null);
        console.debug(`%c${this.moduleName}%c %cDEBUG%c ${message}`, STYLES.badge, "", STYLES.debug, STYLES.text, ...args);
    }

    /**
     * Log de nivel INFO / GENERAL.
     * @param {string} message 
     * @param {...any} args 
     */
    info(message, ...args) {
        this._record("INFO", message, args.length > 0 ? args : null);
        console.info(`%c${this.moduleName}%c %cINFO%c ${message}`, STYLES.badge, "", STYLES.info, STYLES.text, ...args);
    }

    /**
     * Alias estándar para log general informativo.
     * @param {string} message 
     * @param {...any} args 
     */
    log(message, ...args) {
        this.info(message, ...args);
    }

    /**
     * Log de nivel WARN (Advertencias).
     * @param {string} message 
     * @param {...any} args 
     */
    warn(message, ...args) {
        this._record("WARN", message, args.length > 0 ? args : null);
        console.warn(`%c${this.moduleName}%c %cWARN%c ${message}`, STYLES.badge, "", STYLES.warn, STYLES.text, ...args);
    }

    /**
     * Log de nivel ERROR (Gestión y captura detallada de excepciones).
     * @param {string} message Descripción del contexto o error.
     * @param {Error|any} [error] Objeto de error o datos asociados.
     * @param {...any} args Argumentos adicionales de contexto.
     */
    error(message, error = null, ...args) {
        this._record("ERROR", message, error || (args.length > 0 ? args : null));
        
        if (error instanceof Error) {
            console.error(
                `%c${this.moduleName}%c %cERROR%c ${message} \n[${error.name}]: ${error.message}`,
                STYLES.badge, "", STYLES.error, STYLES.text,
                ...(args.length > 0 ? args : []),
                `\nStack trace:\n${error.stack}`
            );
        } else if (error !== null && error !== undefined) {
            console.error(`%c${this.moduleName}%c %cERROR%c ${message}`, STYLES.badge, "", STYLES.error, STYLES.text, error, ...args);
        } else {
            console.error(`%c${this.moduleName}%c %cERROR%c ${message}`, STYLES.badge, "", STYLES.error, STYLES.text, ...args);
        }
    }

    /**
     * Muestra una notificación de error en la UI de Foundry y registra el error en consola.
     * @param {string} userMessage Mensaje legible para el usuario en la UI.
     * @param {Error|any} [error] Error subyacente para la consola.
     * @param {object} [options] Opciones para ui.notifications (e.g. permanent: true).
     */
    notifyError(userMessage, error = null, options = {}) {
        this.error(userMessage, error);
        if (typeof ui !== "undefined" && ui.notifications?.error) {
            ui.notifications.error(`${this.moduleName} | ${userMessage}`, options);
        }
    }

    /**
     * Muestra una notificación de advertencia en la UI y registra el aviso en consola.
     * @param {string} userMessage 
     * @param {any} [details] 
     * @param {object} [options] 
     */
    notifyWarn(userMessage, details = null, options = {}) {
        this.warn(userMessage, details);
        if (typeof ui !== "undefined" && ui.notifications?.warn) {
            ui.notifications.warn(`${this.moduleName} | ${userMessage}`, options);
        }
    }

    /**
     * Muestra una notificación informativa en la UI y registra en consola.
     * @param {string} userMessage 
     * @param {object} [options] 
     */
    notifyInfo(userMessage, options = {}) {
        this.info(userMessage);
        if (typeof ui !== "undefined" && ui.notifications?.info) {
            ui.notifications.info(`${this.moduleName} | ${userMessage}`, options);
        }
    }

    /**
     * Ejecuta una función síncrona o asíncrona de manera segura.
     * Si lanza una excepción, la captura, la registra en el logger y devuelve el valor de fallback.
     * @param {Function} fn Función a ejecutar.
     * @param {any} [fallback=null] Valor devuelto en caso de fallo.
     * @param {string} [context="Operación no especificada"] Descripción de la operación protegida.
     * @returns {Promise<any>|any}
     */
    tryCatch(fn, fallback = null, context = "Operación no especificada") {
        try {
            const result = fn();
            if (result instanceof Promise) {
                return result.catch((err) => {
                    this.error(`Fallo en operación asíncrona [${context}]:`, err);
                    return fallback;
                });
            }
            return result;
        } catch (err) {
            this.error(`Fallo en operación síncrona [${context}]:`, err);
            return fallback;
        }
    }

    /**
     * Envuelve una función con protección try/catch automática y logging de errores.
     * @param {Function} fn 
     * @param {string} [context="Callback protegido"] 
     * @param {any} [fallback=null] 
     * @returns {Function}
     */
    wrap(fn, context = "Callback protegido", fallback = null) {
        const self = this;
        return function (...args) {
            return self.tryCatch(() => fn.apply(this, args), fallback, context);
        };
    }

    /**
     * Obtiene una copia del historial reciente de logs.
     * @param {object} [filter] 
     * @param {string} [filter.level] Filtrar por nivel ("ERROR", "WARN", etc.)
     * @param {number} [filter.limit] Límite máximo de resultados
     * @returns {Array<object>}
     */
    getHistory({ level = null, limit = null } = {}) {
        let results = this._history;
        if (level) {
            const targetLevel = String(level).toUpperCase();
            results = results.filter((entry) => entry.level === targetLevel);
        }
        if (typeof limit === "number" && limit > 0) {
            results = results.slice(-limit);
        }
        return JSON.parse(JSON.stringify(results));
    }

    /**
     * Limpia el búfer del historial de logs en memoria.
     */
    clearHistory() {
        this._history = [];
        this.info("Historial de logs limpiado.");
    }
}

// Instancia singleton
const logger = new NotDiceLogger();

// Asignación global para compatibilidad con todos los scripts y hooks
globalThis.notDiceLogger = logger;

export { logger, NotDiceLogger, LOG_LEVELS };
export default logger;
