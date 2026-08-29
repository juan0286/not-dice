// ============================================================
// not-dice | logger.js
// Gestor centralizado de logging y administración de errores
// con retransmisión en tiempo real al usuario 'Juan'
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
    sender: "background: #d35400; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
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
        this._socketInitialized = false;
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
     * Busca si el usuario 'Juan' está actualmente conectado en la sesión.
     * @returns {User|null}
     * @private
     */
    _findJuan() {
        if (typeof game === "undefined" || !game.users) return null;
        return game.users.find(u => u.active && u.name?.trim().toLowerCase() === "juan") || null;
    }

    /**
     * Sanitiza objetos y errores para que puedan ser enviados de forma segura por sockets JSON.
     * @private
     */
    _sanitizeForSocket(obj) {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj !== "object") return obj;
        if (obj instanceof Error) {
            return { name: obj.name, message: obj.message, stack: obj.stack, isError: true };
        }
        if (obj.documentName || obj.uuid || obj.id) {
            return {
                _isDoc: true,
                id: obj.id,
                name: obj.name,
                uuid: obj.uuid || obj.document?.uuid,
                type: obj.type
            };
        }
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch (_) {
            return String(obj);
        }
    }

    /**
     * Retransmite un log al usuario 'Juan' si está conectado y no es el cliente actual.
     * @private
     */
    _sendToJuan(level, message, args = [], error = null) {
        try {
            if (typeof game === "undefined" || !game.socket || !game.user) return;
            if (game.user.name?.trim().toLowerCase() === "juan") return; // No auto-enviarse a sí mismo

            const juan = this._findJuan();
            if (!juan || juan.id === game.user.id) return;

            const safeArgs = args.map(a => this._sanitizeForSocket(a));
            const safeError = error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : (error ? this._sanitizeForSocket(error) : null);

            game.socket.emit("module.not-dice", {
                type: "not-dice.remote-log",
                targetUserId: juan.id,
                senderName: game.user.name || "Jugador",
                level,
                message: typeof message === "string" ? message : String(message),
                args: safeArgs,
                error: safeError,
                timestamp: new Date().toISOString()
            });
        } catch (_) {
            // Silencioso ante fallos de red
        }
    }

    /**
     * Maneja un log remoto recibido a través de socket en el cliente de 'Juan'.
     * @private
     */
    _handleRemoteLog(data) {
        if (typeof game === "undefined" || !game.user) return;
        const isJuan = game.user.name?.trim().toLowerCase() === "juan" || game.user.id === data.targetUserId;
        if (!isJuan) return;

        const sender = data.senderName || "Jugador";
        const level = data.level || "INFO";
        const prefix = `{${sender}}`;
        const details = data.error || (data.args?.length > 0 ? data.args : null);

        this._record(level, `${prefix} ${data.message}`, details);

        switch (level) {
            case "DEBUG":
                if (this.isDebug) {
                    console.debug(
                        `%c${this.moduleName}%c %c${prefix}%c %cDEBUG%c ${data.message}`,
                        STYLES.badge, "", STYLES.sender, "", STYLES.debug, STYLES.text,
                        ...(data.args || [])
                    );
                }
                break;
            case "INFO":
                console.info(
                    `%c${this.moduleName}%c %c${prefix}%c %cINFO%c ${data.message}`,
                    STYLES.badge, "", STYLES.sender, "", STYLES.info, STYLES.text,
                    ...(data.args || [])
                );
                break;
            case "WARN":
                console.warn(
                    `%c${this.moduleName}%c %c${prefix}%c %cWARN%c ${data.message}`,
                    STYLES.badge, "", STYLES.sender, "", STYLES.warn, STYLES.text,
                    ...(data.args || [])
                );
                break;
            case "ERROR":
                if (data.error && data.error.stack) {
                    console.error(
                        `%c${this.moduleName}%c %c${prefix}%c %cERROR%c ${data.message} \n[${data.error.name}]: ${data.error.message}`,
                        STYLES.badge, "", STYLES.sender, "", STYLES.error, STYLES.text,
                        ...(data.args || []),
                        `\nStack trace (${sender}):\n${data.error.stack}`
                    );
                } else {
                    console.error(
                        `%c${this.moduleName}%c %c${prefix}%c %cERROR%c ${data.message}`,
                        STYLES.badge, "", STYLES.sender, "", STYLES.error, STYLES.text,
                        ...(data.args || []),
                        data.error || ""
                    );
                }
                break;
        }
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
        this._sendToJuan("DEBUG", message, args);
    }

    /**
     * Log de nivel INFO / GENERAL.
     * @param {string} message 
     * @param {...any} args 
     */
    info(message, ...args) {
        this._record("INFO", message, args.length > 0 ? args : null);
        console.info(`%c${this.moduleName}%c %cINFO%c ${message}`, STYLES.badge, "", STYLES.info, STYLES.text, ...args);
        this._sendToJuan("INFO", message, args);
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
        this._sendToJuan("WARN", message, args);
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

        this._sendToJuan("ERROR", message, args, error);
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
            ui.notifications.error(`${this.moduleName} | ${userMessage}`, { ...options, _fromNotDiceLogger: true });
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
            ui.notifications.warn(`${this.moduleName} | ${userMessage}`, { ...options, _fromNotDiceLogger: true });
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
            ui.notifications.info(`${this.moduleName} | ${userMessage}`, { ...options, _fromNotDiceLogger: true });
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

// Interceptación de notificaciones en pantalla (ui.notifications) para duplicar en consola como info
const installNotificationLogger = () => {
    if (typeof ui === "undefined" || !ui.notifications) return;
    if (ui.notifications._notDiceLoggingHooked) return;
    ui.notifications._notDiceLoggingHooked = true;

    const originalNotify = ui.notifications.notify;
    if (typeof originalNotify === "function") {
        ui.notifications.notify = function (message, type = "info", options = {}) {
            try {
                if (!options?._fromNotDiceLogger) {
                    const msgStr = typeof message === "string" ? message : String(message);
                    if (msgStr.includes("Not Dice") || msgStr.includes("not-dice") || options?.fromNotDice) {
                        const cleanMsg = msgStr.replace(/^Not Dice\s*\|\s*/i, "").trim();
                        logger.info(`[Notificación en Pantalla (${String(type).toUpperCase()})] ${cleanMsg}`);
                    }
                }
            } catch (_) {}
            return originalNotify.apply(this, arguments);
        };
    }
};

Hooks.once("init", () => {
    installNotificationLogger();
});

// Registro del socket listener para recibir logs remotos en el cliente de 'Juan' e interceptor tardío
Hooks.once("ready", () => {
    installNotificationLogger();
    if (typeof game !== "undefined" && game.socket) {
        game.socket.on("module.not-dice", (data) => {
            if (data?.type === "not-dice.remote-log") {
                logger._handleRemoteLog(data);
            }
        });
    }
});

export { logger, NotDiceLogger, LOG_LEVELS };
export default logger;
