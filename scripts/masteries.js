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
    },

    /**
     * Ejecuta la lógica de la maestría Derribar (Topple) para un objetivo.
     */
    async runToppleSave(targetActor, attackerActor, weaponItem) {
        if (!targetActor || !attackerActor) return;

        const attackerProf = attackerActor.system?.attributes?.prof ?? 0;
        const strMod = attackerActor.system?.abilities?.str?.mod ?? 0;
        const dexMod = attackerActor.system?.abilities?.dex?.mod ?? 0;
        const attackMod = Math.max(strMod, dexMod);
        const toppleDC = 8 + attackerProf + attackMod;

        const conSaveRaw = targetActor.system?.abilities?.con?.save;
        const conSave = typeof conSaveRaw === "number" ? conSaveRaw : (targetActor.system?.abilities?.con?.mod ?? 0);
        const conSaveLabel = conSave >= 0 ? `+${conSave}` : `${conSave}`;

        const ownerUsers = game.users.filter(u => !u.isGM && targetActor.testUserPermission(u, "OWNER")).map(u => u.id);
        const whisperUsers = [...new Set([game.user.id, ...ownerUsers])];
        
        ChatMessage.create({
            whisper: whisperUsers,
            content: `
                <div style="text-align:center; padding:10px; font-family:inherit;">
                    <h3 style="margin-bottom:5px;">Maestría: Derribar</h3>
                    <p style="font-size:0.9em; margin-bottom:10px;"><strong>${targetActor.name}</strong> debe superar una Salvación.</p>
                    <div style="font-size: 1.2em; margin-bottom:10px; color:inherit;">CD: <span style="font-size: 1.4em; font-weight: 900; color: #ff5252;">${toppleDC}</span></div>
                    <button class="not-dice-topple-save" data-actor-id="${targetActor.id}" data-dc="${toppleDC}" style="background: rgba(197,34,31,0.1); border: 1px solid #d32f2f; color: #ff5252; font-weight: bold; padding: 6px; border-radius:4px; cursor:pointer; width:100%; transition: all 0.2s;">
                        <i class="fas fa-shield-alt"></i> Lanzar Salvación de Constitución
                    </button>
                </div>
            `
        });

        return new Promise(resolveTopple => {
            const DialogV2 = foundry?.applications?.api?.DialogV2;
            const toppleContent = `
                <div style="text-align: center; padding: 10px; font-family:inherit;">
                    <div style="font-size:1.1em; margin-bottom:8px; color:inherit;"><strong>${targetActor.name}</strong> debe superar una</div>
                    <div style="font-size: 1.3em; font-weight: bold; background:rgba(197,34,31,0.1); color:#ff5252; padding:6px; border-radius:6px; border:1px solid rgba(197,34,31,0.4); margin-bottom:10px;">Salvación de Constitución</div>
                    <div style="font-size: 1.2em; margin-bottom:10px; color:inherit;">CD: <span style="font-size: 1.4em; font-weight: 900; color: #ff5252;">${toppleDC}</span></div>
                    <div style="font-size: 0.9em; color:inherit; opacity:0.8; margin-bottom:12px;">Bono CON: <strong>${conSaveLabel}</strong></div>
                    <button class="not-dice-dialog-topple-save" style="background: rgba(26,115,232,0.1); border: 1px solid #1a73e8; color: #1a73e8; font-weight: bold; padding: 6px; border-radius:4px; cursor:pointer; width:100%; transition: all 0.2s; margin-bottom:10px;">
                        <i class="fas fa-dice-d20"></i> Tirar Salvación (CON)
                    </button>
                </div>`;

            const handleSaveRoll = async (ev) => {
                try {
                    await targetActor.rollSavingThrow({ ability: "con", event: ev });
                } catch(e) {
                    if (typeof targetActor.rollAbilitySave === "function") {
                        await targetActor.rollAbilitySave("con", { event: ev });
                    } else {
                        console.error("Not Dice | No se pudo lanzar la salvación", e);
                    }
                }
            };

            if (DialogV2) {
                const app = new DialogV2({
                    window: { title: `Maestría: Derribar — ${targetActor.name}` },
                    content: toppleContent,
                    position: { width: 320 },
                    buttons: [
                        { action: "prone", label: "Derribado", icon: "fa-solid fa-person-falling" },
                        { action: "pass", label: "Pasa", icon: "fa-solid fa-check", default: true }
                    ],
                    submit: async result => {
                        if (result === "prone") {
                            await targetActor.toggleStatusEffect("prone", { active: true });
                            ui.notifications.info(`Not Dice | Derribar: ${targetActor.name} está Derribado.`);
                        }
                        resolveTopple();
                    }
                });
                app.render(true).then(() => {
                    const btn = app.element.querySelector(".not-dice-dialog-topple-save");
                    btn?.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        await handleSaveRoll(ev);
                    });
                });
            } else {
                new Dialog({
                    title: `Maestría: Derribar — ${targetActor.name}`,
                    content: toppleContent,
                    buttons: {
                        prone: { 
                            label: "<i class='fas fa-person-falling'></i> Derribado", 
                            callback: async () => {
                                await targetActor.toggleStatusEffect("prone", { active: true });
                                ui.notifications.info(`Not Dice | Derribar: ${targetActor.name} está Derribado.`);
                                resolveTopple();
                            }
                        },
                        pass: { 
                            label: "<i class='fas fa-check'></i> Paso", 
                            callback: () => resolveTopple() 
                        }
                    },
                    default: "pass",
                    render: html => {
                        const root = html[0] || html;
                        const btn = root.querySelector(".not-dice-dialog-topple-save");
                        btn?.addEventListener("click", async (ev) => {
                            ev.preventDefault();
                            await handleSaveRoll(ev);
                        });
                    },
                    close: () => resolveTopple()
                }, { width: 320 }).render(true);
            }
        });
    },

    /**
     * Muestra el popup informativo de la maestría Empujar (Push).
     */
    async runPushEffect(targetActor, attackerActor, weaponItem) {
        if (!targetActor || !attackerActor) return;

        const DialogV2 = foundry?.applications?.api?.DialogV2;
        const pushContent = `
            <div style="text-align: center; padding: 12px; font-family: inherit; line-height: 1.4;">
                <p style="font-size: 1.05em; margin-bottom: 8px;">Si <strong>${targetActor.name}</strong> es de tamaño <strong>Large o menor</strong>:</p>
                <div style="font-size: 1.15em; font-weight: bold; background: rgba(106,27,154,0.08); border: 1px solid rgba(106,27,154,0.3); color: #ba68c8; padding: 10px; border-radius: 6px; margin-bottom: 12px;">
                    <i class="fas fa-arrow-right"></i> Es empujado 10 pies respecto a <strong>${attackerActor.name}</strong> en línea recta.
                </div>
            </div>`;

        if (DialogV2) {
            new DialogV2({
                window: { title: "Maestría: Empujar" },
                content: pushContent,
                position: { width: 340 },
                buttons: [
                    { action: "ok", label: "Entendido", icon: "fa-solid fa-check", default: true }
                ]
            }).render(true);
        } else {
            new Dialog({
                title: "Maestría: Empujar",
                content: pushContent,
                buttons: {
                    ok: {
                        label: "<i class='fas fa-check'></i> Entendido",
                        callback: () => {}
                    }
                },
                default: "ok"
            }, { width: 340 }).render(true);
        }
    },

    /**
     * Muestra la opción de iniciar un ataque especial de Hender (Cleave).
     */
    async runCleaveEffect(targetToken, attackerActor, weaponItem) {
        if (!targetToken || !attackerActor || !weaponItem) return;

        const whisperUsers = game.users.filter(u => u.isGM || attackerActor.testUserPermission(u, "OWNER")).map(u => u.id);
        
        await ChatMessage.create({
            whisper: whisperUsers,
            content: `
                <div class="not-dice-cleave-card" style="text-align:center; padding:10px; font-family:inherit;">
                    <h3 style="margin-bottom:5px; color:#ba68c8;"><i class="fas fa-hand-fist"></i> Maestría: Hender (Cleave)</h3>
                    <p style="font-size:0.9em; margin-bottom:10px;">¡Puedes realizar un ataque adicional contra otro objetivo a 5 pies de <strong>${targetToken.name}</strong>!</p>
                    <button class="not-dice-cleave-attack-btn" data-attacker-id="${attackerActor.id}" data-weapon-uuid="${weaponItem.uuid}" style="background: rgba(106,27,154,0.1); border: 1px solid #ba68c8; color: #ba68c8; font-weight: bold; padding: 6px; border-radius:4px; cursor:pointer; width:100%; transition: all 0.2s;">
                        <i class="fas fa-dice-d20"></i> Ataque Especial: Hender
                    </button>
                </div>
            `
        });
    }
};
