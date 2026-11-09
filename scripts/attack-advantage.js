// ============================================================
// not-dice | attack-advantage.js
// Evaluación de Ventaja y Desventaja basada en estados y reglas de D&D 5e
// ============================================================

/**
 * Obtiene todos los efectos activos aplicables a un Actor o Token.
 * @param {Actor} act - Actor a inspeccionar.
 * @returns {ActiveEffect[]}
 */
function notDiceGetApplicableActorEffects(act) {
    if (!act) return [];
    if (typeof globalThis.notDiceGetActorEffects === "function") {
        return globalThis.notDiceGetActorEffects(act);
    }
    let effs = [];
    if (typeof act.allApplicableEffects === "function") {
        try { effs = Array.from(act.allApplicableEffects()); } catch (_) {}
    }
    if (effs.length === 0 && act.appliedEffects) {
        effs = Array.from(act.appliedEffects);
    }
    if (effs.length === 0 && act.effects) {
        effs = Array.from(act.effects.contents || (typeof act.effects.values === "function" ? act.effects.values() : act.effects));
    }
    return effs.filter(Boolean);
}

function notDiceEscapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function notDiceMatchesConditionName(effectName, terms) {
    const cleanName = String(effectName || "").toLowerCase().trim();
    if (!cleanName) return false;

    for (const term of terms) {
        if (cleanName === term) return true;
        const escaped = notDiceEscapeRegex(term);
        // Permite formatos como "Blinded (2 rounds)", "Estado: Cegado", "Condition: Prone"
        const pattern = new RegExp(`^(?:(?:estado|condici[oó]n|condition|status|efecto|effect)\\s*[:\\-]\\s*)?${escaped}(?:\\s*\\([^)]*\\))?$`, "i");
        if (pattern.test(cleanName)) return true;
    }
    return false;
}

/**
 * Comprueba si un Actor o Token tiene un estado o condición activa.
 * Revisa de forma estricta:
 * 1. actor.statuses (Set nativo de Foundry v11/v12/v13/v14) por ID exacto
 * 2. ActiveEffects no pasivos (e.transfer !== true) por e.statuses exacto o nombre exacto de condición
 * 
 * @param {Actor|Token} tokenOrActor - Token o Actor a inspeccionar.
 * @param {string} statusId - Identificador canónico del estado (ej: "prone", "dodge", "poisoned", "blinded").
 * @param {string[]} [alternateNames=[]] - Nombres exactos alternativos o traducciones de la condición.
 * @returns {boolean} True si tiene el estado activo.
 */
export function notDiceHasCondition(tokenOrActor, statusId, alternateNames = []) {
    if (!tokenOrActor) return false;
    const actor = tokenOrActor.actor || tokenOrActor;
    if (!actor) return false;

    const canonicalId = String(statusId || "").toLowerCase().trim();
    const terms = [canonicalId, ...alternateNames]
        .map(s => String(s || "").toLowerCase().trim())
        .filter(Boolean);
    const termSet = new Set(terms);

    // 1. actor.statuses (Set de IDs canónicos de Foundry v11/v12/v13/v14)
    if (actor.statuses) {
        const statusIter = (actor.statuses instanceof Set || Array.isArray(actor.statuses))
            ? actor.statuses
            : [];
        for (const st of statusIter) {
            const stLower = String(st || "").toLowerCase().trim();
            if (stLower && termSet.has(stLower)) return true;
        }
    }

    // 2. Active Effects del Actor (ignorando efectos pasivos de equipamiento/rasgos salvo que tengan el statusId canónico)
    const effects = notDiceGetApplicableActorEffects(actor);
    for (const e of effects) {
        if (!e || e.disabled === true || e.isSuppressed === true) continue;

        // 2a. e.statuses (Set o Array de IDs canónicos de estado en el efecto)
        if (e.statuses) {
            const stColl = e.statuses instanceof Set
                ? Array.from(e.statuses)
                : (Array.isArray(e.statuses) ? e.statuses : [e.statuses]);
            for (const st of stColl) {
                const stLower = String(st || "").toLowerCase().trim();
                if (stLower && termSet.has(stLower)) return true;
            }
        }

        // 2b. Ignorar efectos pasivos transferidos de ítems/dotes/armaduras si no tenían el statusId en e.statuses
        if (e.transfer === true) continue;

        // 2c. Flag explícito de statusId (compatibilidad core.statusId)
        const flagStatusId = String(e.flags?.core?.statusId || "").toLowerCase().trim();
        if (flagStatusId && termSet.has(flagStatusId)) return true;

        // 2d. Nombre exacto de la condición en efectos temporales
        const eName = (e.name || e.label || "").toLowerCase().trim();
        if (notDiceMatchesConditionName(eName, terms)) return true;
    }

    return false;
}

/**
 * Mide o estima la distancia en pies (o unidades de rejilla) entre dos tokens.
 * @param {Token} tokenA 
 * @param {Token} tokenB 
 * @returns {number|null} Distancia en unidades del mapa o null si no se puede medir.
 */
function notDiceMeasureTokenDistance(tokenA, tokenB) {
    if (!tokenA || !tokenB) return null;
    try {
        const centerA = tokenA.center || { x: tokenA.x, y: tokenA.y };
        const centerB = tokenB.center || { x: tokenB.x, y: tokenB.y };
        if (canvas?.grid?.measureDistance) {
            const d = canvas.grid.measureDistance(centerA, centerB);
            if (typeof d === "number" && !isNaN(d)) return d;
        }
        if (canvas?.grid?.measurePath) {
            const path = canvas.grid.measurePath([centerA, centerB]);
            const d = path?.distance;
            if (typeof d === "number" && !isNaN(d)) return d;
        }
    } catch (_) {}
    return null;
}

/**
 * Evalúa todas las razones de Ventaja y Desventaja para un ataque según estados,
 * maestrías, distancias y condiciones del atacante y del objetivo.
 * 
 * Regla D&D 5e (Manual del Jugador):
 * "Si las circunstancias hacen que una tirada tenga tanto ventaja como desventaja,
 * se considera que no tiene ninguna de las dos y se tira 1d20. Esto es cierto incluso si
 * múltiples circunstancias imponen desventaja y solo una otorga ventaja, o viceversa."
 * 
 * @param {object} params
 * @param {Token} [params.attackerToken] - Token del atacante en el mapa.
 * @param {Actor} [params.attackerActor] - Actor atacante.
 * @param {Token} [params.targetToken] - Token del objetivo atacado.
 * @param {Actor} [params.targetActor] - Actor del objetivo atacado.
 * @param {Item} [params.item] - Arma, conjuro o habilidad usada para el ataque.
 * @param {Activity} [params.activity] - Actividad del ataque si aplica.
 * @returns {object} { mode: "advantage"|"disadvantage"|"normal", advantages: string[], disadvantages: string[], isCancelled: boolean }
 */
export function notDiceEvaluateAttackRollMode({
    attackerToken = null,
    attackerActor = null,
    targetToken = null,
    targetActor = null,
    item = null,
    activity = null
} = {}) {
    const advantages = [];
    const disadvantages = [];

    try {
        if (typeof game !== "undefined" && game.settings?.settings?.has?.("not-dice.enableAdvantageSuggestions")) {
            if (!game.settings.get("not-dice", "enableAdvantageSuggestions")) {
                return { mode: "normal", advantages: [], disadvantages: [], isCancelled: false };
            }
        }
    } catch (_) {}

    const attacker = attackerActor || attackerToken?.actor || null;
    const target = targetActor || targetToken?.actor || null;

    if (!attacker) {
        return { mode: "normal", advantages: [], disadvantages: [], isCancelled: false };
    }

    // Identificar tipo de ataque (cuerpo a cuerpo vs distancia)
    const actionType = activity?.actionType || activity?.attack?.type?.value || item?.system?.actionType || "";
    const weaponType = item?.system?.type?.value || "";
    const isMelee = actionType === "mwak" || actionType === "msak" || weaponType === "simpleM" || weaponType === "martialM";
    const isRanged = actionType === "rwak" || actionType === "rsak" || weaponType === "simpleR" || weaponType === "martialR";

    // Distancia entre atacante y objetivo
    const distance = (attackerToken && targetToken) ? notDiceMeasureTokenDistance(attackerToken, targetToken) : null;
    const isWithin5Feet = distance !== null ? distance <= 5 : isMelee;

    // -------------------------------------------------------------
    // ESTADOS DEL OBJETIVO QUE AFECTAN AL ATAQUE
    // -------------------------------------------------------------
    if (target) {
        // 1. Objetivo Derribado (Prone)
        // Regla 5e: Da ventaja si el atacante está a ≤ 5 pies. Da desventaja si está a > 5 pies.
        const isTargetProne = notDiceHasCondition(targetToken || target, "prone", [
            "derribado", "derribada", "tumbado", "tumbada"
        ]);
        if (isTargetProne) {
            if (isWithin5Feet) {
                advantages.push("Objetivo Derribado (cuerpo a cuerpo a ≤ 5 pies)");
            } else {
                disadvantages.push("Objetivo Derribado (ataque a distancia a > 5 pies)");
            }
        }

        // 2. Objetivo Aturdido (Stunned)
        if (notDiceHasCondition(targetToken || target, "stunned", ["aturdido", "aturdida"])) {
            advantages.push("Objetivo Aturdido (Stunned)");
        }

        // 3. Objetivo Restringido / Apresado (Restrained)
        if (notDiceHasCondition(targetToken || target, "restrained", [
            "restringido", "restringida", "apresado", "apresada", "inmovilizado", "inmovilizada"
        ])) {
            advantages.push("Objetivo Apresado / Restringido (Restrained)");
        }

        // 4. Objetivo Paralizado (Paralyzed)
        if (notDiceHasCondition(targetToken || target, "paralyzed", ["paralizado", "paralizada"])) {
            advantages.push("Objetivo Paralizado (Paralyzed)");
        }

        // 5. Objetivo Inconsciente (Unconscious)
        if (notDiceHasCondition(targetToken || target, "unconscious", ["inconsciente"])) {
            advantages.push("Objetivo Inconsciente (Unconscious)");
        }

        // 6. Objetivo Petrificado (Petrified)
        if (notDiceHasCondition(targetToken || target, "petrified", ["petrificado", "petrificada"])) {
            advantages.push("Objetivo Petrificado (Petrified)");
        }

        // 7. Objetivo Cegado (Blinded)
        if (notDiceHasCondition(targetToken || target, "blinded", ["cegado", "cegada"])) {
            advantages.push("Objetivo Cegado (Blinded)");
        }

        // 8. Fuego Feérico (Faerie Fire)
        if (notDiceHasCondition(targetToken || target, "faerie-fire", ["fuego feérico", "fuego feerico", "faerie fire"])) {
            advantages.push("Objetivo bajo Fuego Feérico (Faerie Fire)");
        }

        // 9. Maestría Molestar (Vex) hacia este atacante específico
        const attackerName = (attacker.name || "").toLowerCase();
        const targetEffects = notDiceGetApplicableActorEffects(target);
        const hasVex = targetEffects.some(e => {
            if (!e || e.disabled === true || e.transfer === true) return false;
            const flags = e.flags?.["not-dice"] || (typeof e.getFlag === "function" ? e.getFlag("not-dice") : null) || {};
            const eName = (e.name || e.label || "").toLowerCase().trim();
            const isVexEffect = !!flags.isVexEffect || /^(?:maestr[ií]a:\s*)?(?:molestar|vex)\b/i.test(eName);
            if (!isVexEffect) return false;
            return (flags.appliedActorId && flags.appliedActorId === attacker.id)
                || eName.includes(`(${attackerName})`)
                || !eName.includes("(");
        });
        if (hasVex) {
            advantages.push("Maestría Molestar (Vex)");
        }

        // 10. Saeta Guía (Guiding Bolt)
        const hasGuidingBolt = targetEffects.some(e => {
            if (!e || e.disabled === true || e.transfer === true) return false;
            const eName = (e.name || e.label || "").toLowerCase().trim();
            return /^(?:saeta gu[ií]a|guiding bolt)\b/i.test(eName);
        });
        if (hasGuidingBolt) {
            advantages.push("Saeta Guía (Guiding Bolt)");
        }

        // 11. Objetivo Esquivando (Dodge)
        const isTargetDodging = notDiceHasCondition(targetToken || target, "dodge", [
            "dodging", "esquivar", "esquiva", "esquivando", "esquiva total"
        ]);
        if (isTargetDodging) {
            disadvantages.push("Objetivo Esquivando (Dodge)");
        }

        // 12. Objetivo Invisible
        if (notDiceHasCondition(targetToken || target, "invisible", ["invisibilidad"])) {
            disadvantages.push("Objetivo Invisible");
        }
    }

    // -------------------------------------------------------------
    // ESTADOS DEL ATACANTE QUE LE DAN VENTAJA
    // -------------------------------------------------------------
    // 13. Atacante Invisible
    if (notDiceHasCondition(attackerToken || attacker, "invisible", ["invisibilidad"])) {
        advantages.push("Atacante Invisible");
    }

    // 14. Ataque Temerario (Reckless Attack de Bárbaro)
    if (notDiceHasCondition(attackerToken || attacker, "reckless", ["ataque temerario", "reckless attack"])) {
        advantages.push("Ataque Temerario (Reckless Attack)");
    }

    // -------------------------------------------------------------
    // ESTADOS DEL ATACANTE QUE LE DAN DESVENTAJA
    // -------------------------------------------------------------
    // 15. Atacante Envenenado (Poisoned)
    if (notDiceHasCondition(attackerToken || attacker, "poisoned", ["envenenado", "envenenada"])) {
        disadvantages.push("Atacante Envenenado (Poisoned)");
    }

    // 16. Atacante Cegado (Blinded)
    if (notDiceHasCondition(attackerToken || attacker, "blinded", ["cegado", "cegada"])) {
        disadvantages.push("Atacante Cegado (Blinded)");
    }

    // 17. Atacante Apresado / Restringido (Restrained)
    if (notDiceHasCondition(attackerToken || attacker, "restrained", ["restringido", "restringida", "apresado", "apresada", "inmovilizado", "inmovilizada"])) {
        disadvantages.push("Atacante Apresado / Restringido (Restrained)");
    }

    // 18. Atacante Derribado (Prone)
    if (notDiceHasCondition(attackerToken || attacker, "prone", ["derribado", "derribada", "tumbado", "tumbada"])) {
        disadvantages.push("Atacante Derribado (Prone)");
    }

    // 19. Atacante Asustado (Frightened)
    if (notDiceHasCondition(attackerToken || attacker, "frightened", ["asustado", "asustada", "atemorizado", "atemorizada"])) {
        disadvantages.push("Atacante Asustado (Frightened)");
    }

    // 20. Maestría Debilitar (Sap) sufrida por el atacante
    const attackerEffects = notDiceGetApplicableActorEffects(attacker);
    const hasSap = attackerEffects.some(e => {
        if (!e || e.disabled === true || e.transfer === true) return false;
        const flags = e.flags?.["not-dice"] || (typeof e.getFlag === "function" ? e.getFlag("not-dice") : null) || {};
        const eName = (e.name || e.label || "").toLowerCase().trim();
        return !!flags.isSapEffect || /^(?:maestr[ií]a:\s*)?(?:debilitar|sap|minar)\b/i.test(eName);
    });
    if (hasSap) {
        disadvantages.push("Maestría Debilitar (Sap)");
    }

    // -------------------------------------------------------------
    // RESOLUCIÓN ESTRICTA SEGÚN REGLAS DE D&D 5E:
    // Si hay AL MENOS 1 razón de ventaja Y AL MENOS 1 razón de desventaja
    // (sin importar cuántas haya de cada una), se anulan completamente
    // resultando en un ataque NORMAL.
    // -------------------------------------------------------------
    let mode = "normal";
    let isCancelled = false;

    const hasAnyAdvantage = advantages.length > 0;
    const hasAnyDisadvantage = disadvantages.length > 0;

    if (hasAnyAdvantage && hasAnyDisadvantage) {
        mode = "normal";
        isCancelled = true;
    } else if (hasAnyAdvantage) {
        mode = "advantage";
        isCancelled = false;
    } else if (hasAnyDisadvantage) {
        mode = "disadvantage";
        isCancelled = false;
    } else {
        mode = "normal";
        isCancelled = false;
    }

    return {
        mode,
        advantages,
        disadvantages,
        isCancelled
    };
}

globalThis.notDiceEvaluateAttackRollMode = notDiceEvaluateAttackRollMode;
globalThis.notDiceHasCondition = notDiceHasCondition;
