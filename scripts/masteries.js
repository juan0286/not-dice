// ============================================================
// not-dice | scripts/masteries.js
// Lógica para efectos y condiciones de las maestrías de armas.
// ============================================================

globalThis.notDiceMasteries = {
    /**
     * Detección de la maestría activa para un item/actor.
     */
    getActiveMastery(item) {
        if (!item) return null;
        const masteryId = item.system?.mastery;
        if (!masteryId) return null;

        return {
            id: masteryId,
            label: CONFIG.DND5E.weaponMasteries?.[masteryId]?.label || masteryId
        };
    },

    /**
     * Comprueba si un actor ya tiene aplicado el efecto de Debilitar (Sap).
     */
    hasSapEffect(actor) {
        if (!actor) return false;
        const effects = actor.appliedEffects || actor.effects || [];
        return effects.some(e => {
            const name = (e.name || "").toLowerCase();
            return (name.includes("maestría:") || name.includes("maestria:") || name.includes("mastery:")) &&
                (name.includes("debilitar") || name.includes("sap") || name.includes("minar"));
        });
    },

    /**
     * Aplica el efecto de Debilitar (Sap) a un actor.
     */
    async applySapEffect(targetActor, attackerActor, weaponItem) {
        if (!targetActor || !attackerActor) return false;

        // Verificar si ya tiene el efecto (no acumulable de ningún oponente)
        if (this.hasSapEffect(targetActor)) {
            ui.notifications?.warn(`Not Dice | ${targetActor.name} ya tiene un efecto de Debilitar (Sap) activo.`);
            return false;
        }

        // Límite de aplicación: una vez por turno
        const masteryFlagKey = `lastMastery-sap-${attackerActor.id}`;
        const lastTurn = targetActor.getFlag("not-dice", masteryFlagKey);
        const currentTurn = game.combat
            ? `${game.combat.id}-${game.combat.round ?? 0}-${game.combat.turn ?? 0}`
            : Date.now();

        const alreadyApplied = game.combat
            ? lastTurn === currentTurn
            : (typeof lastTurn === "number" && (Date.now() - lastTurn) < 6000);

        if (alreadyApplied) {
            ui.notifications?.warn(`Not Dice | Ya se aplicó Debilitar (Sap) a ${targetActor.name} este turno.`);
            return false;
        }

        const effectData = {
            name: `Maestría: Debilitar (${attackerActor.name})`,
            img: weaponItem?.img || "icons/svg/aura.svg",
            icon: weaponItem?.img || "icons/svg/aura.svg",
            origin: weaponItem?.uuid || attackerActor.uuid,
            duration: { rounds: 1, turns: 1 }
        };

        if (game.combat) {
            effectData.duration.startRound = game.combat.round;
            effectData.duration.startTurn = game.combat.turn;
        } else {
            effectData.duration.startTime = game.time.worldTime;
        }

        const created = await targetActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        if (created.length > 0) {
            await targetActor.setFlag("not-dice", masteryFlagKey, currentTurn);
            return true;
        }
        return false;
    }
};
