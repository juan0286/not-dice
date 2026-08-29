// ============================================================
// not-dice | especiales.js
// Habilidades especiales, dotes y estilos de combate.
// ============================================================

globalThis.notDiceEspeciales = {
    /**
     * Evalúa si un actor posee la dote de Atacante Salvaje (Savage Attacker),
     * si el ataque es con arma y si no ha sido usado este turno.
     * @param {Actor} actor - El actor a evaluar.
     * @param {Item} item - El item/arma utilizada.
     * @returns {boolean}
     */
    hasSavageAttacker(actor, item) {
        (globalThis.notDiceLogger || console).debug("hasSavageAttacker check", { actor: actor?.name, item: item?.name, itemType: item?.type });
        if (!actor || !item) return false;
        
        if (item.type !== "weapon") {
            (globalThis.notDiceLogger || console).debug("hasSavageAttacker false: item is not weapon");
            return false;
        }

        const hasFeat = actor.items?.some(i => {
            const n = (i.name || "").toLowerCase();
            const sysId = i.system?.identifier || "";
            return i.type === "feat" && (
                n.includes("savage attacker") || 
                n.includes("atacante salvaje") || 
                sysId === "savage-attacker"
            );
        });
        (globalThis.notDiceLogger || console).debug("hasSavageAttacker hasFeat", hasFeat);
        return !!hasFeat;
    },

    /**
     * Comprueba si el actor ya utilizó Atacante Salvaje en este turno (o hace menos de 6s fuera de combate).
     * @param {Actor} actor - El actor a evaluar.
     * @returns {boolean}
     */
    isSavageAttackerUsed(actor) {
        if (!actor) return false;
        const lastTurn = actor.getFlag("not-dice", `lastSavageAttacker-${actor.id}`);
        const currentTurn = game.combat
            ? `${game.combat.id}-${game.combat.round ?? 0}-${game.combat.turn ?? 0}`
            : Date.now();

        const alreadyUsed = game.combat
            ? lastTurn === currentTurn
            : (typeof lastTurn === "number" && (Date.now() - lastTurn) < 6000);

        (globalThis.notDiceLogger || console).debug("isSavageAttackerUsed check", alreadyUsed, { lastTurn, currentTurn });
        return alreadyUsed;
    },

    /**
     * Registra el uso de Atacante Salvaje para el turno actual.
     * @param {Actor} actor - El actor atacante.
     */
    async useSavageAttacker(actor) {
        if (!actor) return;
        const currentTurn = game.combat
            ? `${game.combat.id}-${game.combat.round ?? 0}-${game.combat.turn ?? 0}`
            : Date.now();
        await actor.setFlag("not-dice", `lastSavageAttacker-${actor.id}`, currentTurn);
    },

    /**
     * Evalúa si un actor posee el estilo de combate de Armas a Dos Manos (Great Weapon Fighting)
     * y si el ataque se realiza con un arma.
     * @param {Actor} actor - El actor a evaluar.
     * @param {Item} item - El item/arma utilizada.
     * @returns {boolean}
     */
    hasGreatWeaponFighting(actor, item) {
        if (!actor || !item || item.type !== "weapon") return false;
        return actor.items?.some(i => {
            const n = (i.name || "").toLowerCase();
            const sysId = i.system?.identifier || "";
            return i.type === "feat" && (
                n.includes("great weapon fighting") ||
                n.includes("armas a dos manos") ||
                n.includes("arma a dos manos") ||
                sysId === "great-weapon-fighting"
            );
        }) || false;
    },

    /**
     * Evalúa si un actor cumple con los requisitos de la dote de Maestro de Armas Pesadas (Great Weapon Master).
     * @param {Actor} actor - El actor a evaluar.
     * @param {Item} item - El arma utilizada.
     * @param {object} rollConfig - Configuración del lanzamiento.
     * @returns {boolean}
     */
    hasGreatWeaponMaster(actor, item, rollConfig) {
        if (!actor || !item || item.type !== "weapon") return false;
        
        const hasFeat = actor.items?.some(i => {
            const name = (i.name || "").toLowerCase();
            const sysId = i.system?.identifier || "";
            return i.type === "feat" && (
                name.includes("great weapon master") || 
                name.includes("maestro de armas pesadas") || 
                name.includes("maestro en armas pesadas") ||
                sysId === "great-weapon-master"
            );
        });

        const isHeavy = item.system?.properties?.has?.("hvy");
        const actionType = rollConfig?.subject?.actionType || item.system?.actionType;
        const isMelee = actionType === "mwak";

        return !!(hasFeat && isHeavy && isMelee);
    },

    /**
     * Aplica el modificador de Great Weapon Master a la fórmula de daño base si corresponde.
     * @param {Roll[]} rolls - Los lanzamientos de daño.
     * @param {Actor} actor - El actor atacante.
     * @param {Item} item - El arma utilizada.
     * @param {object} rollConfig - Configuración del lanzamiento.
     * @param {boolean} hasForcedParts - Si hay partes de daño forzadas.
     */
    applyGreatWeaponMaster(rolls, actor, item, rollConfig, hasForcedParts = false) {
        if (!hasForcedParts && this.hasGreatWeaponMaster(actor, item, rollConfig) && rolls.length > 0) {
            const profBonus = actor.system?.attributes?.prof || 0;
            if (profBonus > 0) {
                const originalRoll = rolls[0];
                const newFormula = `${originalRoll.formula} + ${profBonus}[GWM]`;
                const DamageRoll = CONFIG.Dice.DamageRoll;
                rolls[0] = new DamageRoll(newFormula, originalRoll.data, originalRoll.options);
                (globalThis.notDiceLogger || console).info(`Great Weapon Master detectado: Fórmula base modificada a ${newFormula}`);
            }
        }
    },

    /**
     * Modifica la fórmula de daño para aplicar el estilo de combate de Armas a Dos Manos (GWF).
     * @param {string} formula - La fórmula de daño original.
     * @returns {string}
     */
    applyGreatWeaponFightingFormula(formula) {
        return formula.replace(/(\d+)d(\d+)/g, "$1d$2min3");
    },

    /**
     * Realiza el lanzamiento de daño usando la dote de Atacante Salvaje (tira dos veces y se queda con el mayor).
     * @param {string} formula - La fórmula de daño.
     * @param {string} flavorBase - Texto descriptivo del daño.
     * @param {string} modsString - Modificadores aplicados en texto.
     * @param {object} actorSpeaker - Objeto speaker de Foundry.
     * @param {number} idx - Índice de la parte de daño.
     * @param {function} buildPiercerButtons - Función para construir botones de Perforador.
     * @returns {Promise<number>} El total del mayor lanzamiento.
     */
    async rollSavageAttacker(formula, flavorBase, modsString, actorSpeaker, idx, buildPiercerButtons) {
        const r1 = await new Roll(formula).evaluate();
        const r2 = await new Roll(formula).evaluate();

        await r1.toMessage({ 
            flavor: `${flavorBase}${modsString.replace(")", " - Tirada 1)")}${buildPiercerButtons(r1, idx)}`, 
            speaker: actorSpeaker 
        });
        await r2.toMessage({ 
            flavor: `${flavorBase}${modsString.replace(")", " - Tirada 2)")}${buildPiercerButtons(r2, idx)}`, 
            speaker: actorSpeaker 
        });

        return Math.max(r1.total, r2.total);
    }
};
