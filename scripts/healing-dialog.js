// ============================================================
// not-dice | healing-dialog.js
// Diálogo interactivo de curación con detección de objetivos no amistosos
// ============================================================

/**
 * Diálogo de advertencia previo cuando el objetivo seleccionado no es amistoso.
 * Permite elegir entre redirigir la curación al propio lanzador o mantener el objetivo original.
 * @param {object} params
 * @param {Token} params.casterToken - Token del lanzador/actor origen.
 * @param {Token} params.targetToken - Token del objetivo seleccionado actualmente.
 * @param {string} params.itemName - Nombre del hechizo, objeto o habilidad de curación.
 * @param {boolean} params.isTempHp - Si es curación de PV temporales.
 * @returns {Promise<string|null>} "self" | "target" | null (si cancela)
 */
async function notDicePromptHealingTargetWarning({ casterToken, targetToken, itemName, isTempHp = false }) {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    const disposition = targetToken.document?.disposition;
    
    let dispLabel = "No Amistoso";
    let dispBadgeBg = "rgba(239, 68, 68, 0.15)";
    let dispBadgeBorder = "rgba(239, 68, 68, 0.45)";
    let dispBadgeColor = "#ef4444";
    let icon = "fa-skull-crossbones";

    if (disposition === (CONST.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0)) {
        dispLabel = "Neutral";
        dispBadgeBg = "rgba(245, 158, 11, 0.15)";
        dispBadgeBorder = "rgba(245, 158, 11, 0.45)";
        dispBadgeColor = "#f59e0b";
        icon = "fa-shield-halved";
    } else if (disposition === (CONST.TOKEN_DISPOSITIONS?.HOSTILE ?? -1)) {
        dispLabel = "Hostil (Enemigo)";
        dispBadgeBg = "rgba(239, 68, 68, 0.18)";
        dispBadgeBorder = "rgba(239, 68, 68, 0.55)";
        dispBadgeColor = "#ef4444";
        icon = "fa-skull";
    }

    const casterImg = casterToken?.document?.texture?.src || casterToken?.actor?.img || "icons/svg/mystery-man.svg";
    const targetImg = targetToken?.document?.texture?.src || targetToken?.actor?.img || "icons/svg/mystery-man.svg";
    const casterName = casterToken?.name || casterToken?.actor?.name || "Tú mismo";
    const targetName = targetToken?.name || targetToken?.actor?.name || "Objetivo";
    const actionNoun = isTempHp ? "PV Temporales" : "Curación";

    const dialogContent = `
        <div style="font-family:inherit; padding:4px; display:flex; flex-direction:column; gap:12px; text-align:center;">
            <div style="background: ${dispBadgeBg}; border: 1px solid ${dispBadgeBorder}; color: ${dispBadgeColor}; padding: 8px 12px; border-radius: 8px; font-weight: bold; font-size: 0.92em; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: inset 0 0 6px ${dispBadgeBg};">
                <i class="fas ${icon}" style="font-size:1.15em;"></i>
                <span>¡Atención! El objetivo seleccionado es <u>${dispLabel}</u>.</span>
            </div>
            
            <p style="margin:0; font-size:0.9em; opacity:0.9; line-height:1.35;">
                ¿Deseas aplicar la ${actionNoun} de <strong>${itemName}</strong> sobre ti mismo o continuar curando a este objetivo?
            </p>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:2px;">
                <!-- Opción 1: Curarse a uno mismo -->
                <div class="not-dice-target-choice-card" data-choice="self" style="cursor:pointer; border:2px solid #22c55e; background:rgba(34, 197, 94, 0.1); border-radius:10px; padding:12px 8px; display:flex; flex-direction:column; align-items:center; gap:6px; transition: all 0.2s ease; box-shadow: 0 4px 10px rgba(34, 197, 94, 0.15);">
                    <img src="${casterImg}" style="width:58px; height:58px; border-radius:50%; border:2px solid #22c55e; object-fit:cover; box-shadow: 0 0 10px rgba(34, 197, 94, 0.35);">
                    <span style="font-weight:800; font-size:0.95em; color:#16a34a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;" title="${casterName}">${casterName}</span>
                    <span style="font-size:0.75em; background:rgba(34, 197, 94, 0.25); color:#15803d; font-weight:bold; padding:2px 8px; border-radius:10px;">Lanzador (Tú)</span>
                    <button type="button" class="not-dice-btn-select-self" style="margin-top:6px; background:#16a34a; color:#fff; border:none; border-radius:6px; padding:6px 8px; font-weight:bold; font-size:0.85em; width:100%; cursor:pointer;">
                        <i class="fas fa-user-shield"></i> Curarme a mí
                    </button>
                </div>

                <!-- Opción 2: Mantener objetivo original -->
                <div class="not-dice-target-choice-card" data-choice="target" style="cursor:pointer; border:2px solid ${dispBadgeBorder}; background:${dispBadgeBg}; border-radius:10px; padding:12px 8px; display:flex; flex-direction:column; align-items:center; gap:6px; transition: all 0.2s ease;">
                    <img src="${targetImg}" style="width:58px; height:58px; border-radius:50%; border:2px solid ${dispBadgeColor}; object-fit:cover; box-shadow: 0 0 8px ${dispBadgeBorder};">
                    <span style="font-weight:800; font-size:0.95em; color:${dispBadgeColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;" title="${targetName}">${targetName}</span>
                    <span style="font-size:0.75em; background:${dispBadgeBg}; color:${dispBadgeColor}; font-weight:bold; padding:2px 8px; border-radius:10px; border:1px solid ${dispBadgeBorder};">${dispLabel}</span>
                    <button type="button" class="not-dice-btn-select-target" style="margin-top:6px; background:rgba(128,128,128,0.2); color:inherit; border:1px solid var(--color-border-light-2, #ccc); border-radius:6px; padding:6px 8px; font-weight:bold; font-size:0.85em; width:100%; cursor:pointer;">
                        <i class="fas fa-crosshairs"></i> Curar a ${targetName}
                    </button>
                </div>
            </div>
        </div>
    `;

    return new Promise((resolve) => {
        let choiceMade = false;
        let app = null;

        const bindEvents = (element) => {
            const selfCard = element.querySelector('[data-choice="self"]');
            const targetCard = element.querySelector('[data-choice="target"]');
            const selfBtn = element.querySelector('.not-dice-btn-select-self');
            const targetBtn = element.querySelector('.not-dice-btn-select-target');

            const choose = (type) => {
                if (choiceMade) return;
                choiceMade = true;
                resolve(type);
                if (app && typeof app.close === "function") app.close();
            };

            if (selfCard) selfCard.addEventListener("click", () => choose("self"));
            if (targetCard) targetCard.addEventListener("click", () => choose("target"));
            if (selfBtn) selfBtn.addEventListener("click", (e) => { e.stopPropagation(); choose("self"); });
            if (targetBtn) targetBtn.addEventListener("click", (e) => { e.stopPropagation(); choose("target"); });
        };

        if (DialogV2) {
            app = new DialogV2({
                window: { title: "Confirmar Objetivo de Curación" },
                content: dialogContent,
                position: { width: 420 },
                buttons: [
                    { action: "cancel", icon: "fa-solid fa-xmark", label: "Cancelar Acción" }
                ],
                submit: (result) => {
                    if (!choiceMade) resolve(result === "cancel" ? null : result);
                }
            });
            app.addEventListener("close", () => {
                if (!choiceMade) resolve(null);
            }, { once: true });
            app.render(true).then(() => bindEvents(app.element));
        } else {
            app = new Dialog({
                title: "Confirmar Objetivo de Curación",
                content: dialogContent,
                render: (html) => bindEvents(html[0] || html),
                buttons: {
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancelar Acción",
                        callback: () => { if (!choiceMade) resolve(null); }
                    }
                },
                close: () => { if (!choiceMade) resolve(null); }
            }, { width: 420 });
            app.render(true);
        }
    });
}

export const initHealingDialog = () => {
    globalThis.notDiceOpenHealingDialog = async ({
        uuid,
        itemName,
        targetIds = [],
        senderName = game.user.name,
        requestedDamageParts = null
    } = {}) => {
        let item = uuid ? await fromUuid(uuid) : null;
        let actualItem = item?.item || item;
        let actor = actualItem?.actor;

        if (!actualItem && uuid) {
            try {
                const parts = uuid.split(".");
                if (parts.length >= 4 && parts[0] === "Actor") {
                    const actorId = parts[1];
                    const itemId = parts[3];
                    const targetActor = game.actors.get(actorId) || canvas.tokens.placeables.find(t => t.actor?.id === actorId)?.actor;
                    if (targetActor) {
                        actualItem = targetActor.items.get(itemId);
                        actor = targetActor;
                    }
                }
            } catch (e) {}
        }

        // Obtener la fórmula solicitada si se pasó
        const normalizedRequestedParts = Array.isArray(requestedDamageParts)
            ? requestedDamageParts.map(part => ({
                formula: String(part?.formula || "").trim(),
                type: String(part?.type || "").trim().toLowerCase()
            })).filter(part => part.formula.length > 0)
            : [];

        if (!actualItem && normalizedRequestedParts.length === 0) {
            ui.notifications?.warn("Not Dice | No se pudo encontrar el objeto origen para la curación.");
            return false;
        }

        // Determinar el objetivo (Prioridad: IDs pasados, tokens targeteados, o el propio actor)
        let targets = targetIds.map(id => canvas.tokens.get(id)).filter(t => t);
        if (targets.length === 0) {
            targets = Array.from(game.user.targets);
        }
        if (targets.length === 0 && actor) {
            const tokens = typeof actor.getActiveTokens === "function" ? actor.getActiveTokens() : [];
            if (tokens.length > 0) targets = [tokens[0]];
        }

        // Obtener la fórmula
        let sourceRows = normalizedRequestedParts.length > 0
            ? normalizedRequestedParts
            : (typeof globalThis.notDiceExtractDamageRows === "function" 
                ? globalThis.notDiceExtractDamageRows(actualItem) 
                : []);

        // If fallback or empty, try to get activity.healing (dnd5e 3.x / 4.x / 5.x)
        if (sourceRows.length === 0 || sourceRows[0]?.type === "") {
            let foundHealing = false;
            if (actualItem?.system?.activities) {
                for (const act of actualItem.system.activities.values()) {
                    if (act.type === "heal" || act.healing) {
                        const form = act.healing?.formula || act.healing?.custom?.formula || act.damage?.parts?.[0]?.[0] || "";
                        const type = act.healing?.type || "healing";
                        if (form) {
                            sourceRows = [{ formula: form, type: type }];
                            foundHealing = true;
                            break;
                        }
                    }
                }
            }
            if (!foundHealing) {
                const legacyForm = actualItem?.system?.damage?.parts?.[0]?.[0] || "";
                if (legacyForm) sourceRows = [{ formula: legacyForm, type: "healing" }];
            }
        }

        const firstRow = sourceRows[0];
        if (!firstRow) {
            ui.notifications?.warn("Not Dice | No se encontró una fórmula de curación válida.");
            return false;
        }

        const isTempHp = firstRow.type === "temphp";
        const titleText = isTempHp ? "Puntos de Vida Temporales" : "Curación";
        const buttonText = isTempHp ? "Aplicar PV Temporales" : "Aplicar Curación";

        // --- Verificación de Objetivo No Amistoso (Hostil / Neutral) ---
        let enableWarning = true;
        try {
            if (typeof game !== "undefined" && game.settings?.settings?.has?.("not-dice.enableHealingTargetWarning")) {
                enableWarning = !!game.settings.get("not-dice", "enableHealingTargetWarning");
            }
        } catch (_) {}

        if (enableWarning && targets.length > 0) {
            const targetToken = targets[0];
            let casterToken = null;

            if (actor) {
                const activeTokens = typeof actor.getActiveTokens === "function" ? actor.getActiveTokens() : [];
                casterToken = activeTokens[0] || canvas.tokens.placeables.find(t => t.actor?.id === actor.id) || null;
            }
            if (!casterToken && game.user.character) {
                const charTokens = typeof game.user.character.getActiveTokens === "function" ? game.user.character.getActiveTokens() : [];
                casterToken = charTokens[0] || null;
            }
            if (!casterToken && canvas.tokens.controlled.length > 0) {
                casterToken = canvas.tokens.controlled[0];
            }

            const disposition = targetToken.document?.disposition;
            const isFriendly = disposition === (CONST.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1);
            const isSelf = casterToken && (targetToken.id === casterToken.id || targetToken.actor?.id === casterToken.actor?.id);

            if (!isFriendly && !isSelf && casterToken) {
                const choice = await notDicePromptHealingTargetWarning({
                    casterToken,
                    targetToken,
                    itemName: itemName || actualItem?.name || "Curación",
                    isTempHp
                });

                if (!choice || choice === "cancel") {
                    ui.notifications?.info("Not Dice | Curación cancelada.");
                    return false;
                }

                if (choice === "self") {
                    targets = [casterToken];
                    if (game.user.targets && typeof game.user.targets.clear === "function") {
                        game.user.targets.clear();
                        if (typeof casterToken.setTarget === "function") {
                            casterToken.setTarget(true, { releaseOthers: true });
                        }
                    }
                    (globalThis.notDiceLogger || console).info("Objetivo de curación cambiado al lanzador.");
                }
            }
        }
        
        let targetHtml = "";
        if (targets.length > 0) {
            const t = targets[0];
            targetHtml = `
                <div style="display:flex; flex-direction:column; align-items:center; margin-bottom:15px; padding:10px; border: 1px solid rgba(46, 204, 113, 0.3); background: rgba(46, 204, 113, 0.05); border-radius: 8px;">
                    <img src="${t.document?.texture?.src || t.actor?.img || "icons/svg/mystery-man.svg"}" style="width:64px; height:64px; border-radius:50%; border:2px solid #2ecc71; object-fit:cover; margin-bottom:5px; box-shadow: 0 0 10px rgba(46, 204, 113, 0.4);">
                    <div style="font-weight:bold; font-size:1.1em;">${t.name}</div>
                    <div style="font-size:0.85em; opacity:0.8;">Objetivo</div>
                </div>
            `;
        }

        const content = `
            <div style="padding:10px; text-align:center; display:flex; flex-direction:column; gap:12px;">
                ${targetHtml}
                
                <div style="display:flex; flex-direction:column; align-items:center; gap:8px; margin: 4px 0 6px 0;">
                    <div style="font-size:0.85em; opacity:0.85; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">
                        Fórmula: <span style="font-family:monospace; font-weight:800; color:#22c55e; background:rgba(34,197,94,0.12); padding:2px 8px; border-radius:4px; border:1px solid rgba(34,197,94,0.3); font-size:1.1em;">${firstRow.formula}</span>
                    </div>

                    <!-- Botón Grande, Centrado y Verde para Lanzar Dados -->
                    <button type="button" id="not-dice-heal-roll-btn" class="not-dice-heal-roll-btn" style="width:100%; max-width:280px; padding:12px 16px; background:linear-gradient(135deg, #22c55e 0%, #15803d 100%); color:#ffffff; font-weight:800; font-size:1.15em; border:2px solid #4ade80; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; box-shadow:0 4px 14px rgba(34, 197, 94, 0.45); transition:all 0.2s ease; text-shadow:0 1px 2px rgba(0,0,0,0.5);">
                        <i class="fas fa-dice-d20" style="font-size:1.3em;"></i>
                        <span>Lanzar Dados</span>
                    </button>
                </div>

                <div style="margin-top:2px;">
                    <label style="font-size:0.88em; font-weight:bold; display:block; margin-bottom:4px; opacity:0.9;">Resultado a Aplicar:</label>
                    <input type="number" id="not-dice-heal-result" value="0" style="width:120px; text-align:center; font-size:1.5em; font-weight:900; color:#22c55e; background:rgba(0,0,0,0.12); border:2px solid rgba(34,197,94,0.4); border-radius:6px; padding:6px; margin:0 auto; display:block; box-shadow:inset 0 0 8px rgba(34,197,94,0.15); transition: all 0.3s ease;">
                </div>

                <div style="font-size:0.82em; opacity:0.75; margin-top:2px;">
                    <i>${itemName || actualItem.name}</i> (por ${senderName})
                </div>

                <style>
                    .not-dice-heal-roll-btn:hover {
                        transform: translateY(-2px) scale(1.02);
                        box-shadow: 0 6px 18px rgba(34, 197, 94, 0.65) !important;
                        border-color: #86efac !important;
                    }
                    .not-dice-heal-roll-btn:active {
                        transform: translateY(1px) scale(0.99);
                    }
                </style>
            </div>
        `;

        const applyHealing = async (htmlOrElement) => {
            const inputVal = typeof htmlOrElement.find === "function" 
                ? htmlOrElement.find("#not-dice-heal-result").val()
                : htmlOrElement.querySelector("#not-dice-heal-result").value;
                
            const total = parseInt(inputVal) || 0;

            if (total <= 0) {
                ui.notifications?.info("Not Dice | No se aplicó curación (valor 0).");
                return false;
            }

            try {
                let summaryLines = [];
                let targetsToSocket = [];
                const palette = isTempHp 
                    ? { fg: "#0ea5e9", accent: "#38bdf8", bg: "rgba(14,165,233,0.12)", border: "rgba(14,165,233,0.35)", suffix: "pvt" }
                    : { fg: "#166534", accent: "#16a34a", bg: "rgba(22,101,52,0.12)", border: "rgba(22,101,52,0.35)", suffix: "pv" };

                if (targets.length > 0) {
                    for (let t of targets) {
                        if (t.actor) {
                            const isOwner = t.actor.isOwner;
                            const hpBefore = Number(t.actor.system?.attributes?.hp?.value ?? 0);
                            const tempBefore = Number(t.actor.system?.attributes?.hp?.temp ?? 0);
                            const hpMax = Number(t.actor.system?.attributes?.hp?.max ?? 0);
                            let beforeVal = isTempHp ? tempBefore : hpBefore;
                            let afterVal = beforeVal;
                            let amountApplied = total;

                            if (isTempHp) {
                                if (total > tempBefore) {
                                    if (isOwner) await t.actor.update({ "system.attributes.hp.temp": total });
                                    afterVal = total;
                                    amountApplied = total - tempBefore; // Diferencia aplicada
                                    ui.notifications.info(`Not Dice | ${t.name} obtuvo ${total} PV Temporales.`);
                                } else {
                                    amountApplied = 0;
                                }
                            } else {
                                afterVal = Math.min(hpMax, hpBefore + total);
                                amountApplied = afterVal - hpBefore;
                                
                                if (isOwner) {
                                    if (typeof t.actor.applyDamage === "function") {
                                        await t.actor.applyDamage([{ value: total, type: "healing" }]);
                                    } else {
                                        await t.actor.update({ "system.attributes.hp.value": afterVal });
                                    }
                                }
                                ui.notifications.info(`Not Dice | ${t.name} fue curado por ${total} puntos.`);
                            }
                            
                            if (!isOwner && amountApplied > 0) {
                                targetsToSocket.push({ tokenId: t.id, actorId: t.actor.id });
                            }

                            if (amountApplied > 0) {
                                summaryLines.push(`
                                    <div style="display:flex; flex-direction:column; padding:6px 8px; margin-bottom:4px; border:1px solid ${palette.border}; border-radius:6px; background:${palette.bg}; font-size:0.84em; line-height:1.2;">
                                        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                                            <span style="font-weight:700; color:${palette.fg}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.name}</span>
                                            <span style="color:inherit; opacity:0.9; white-space:nowrap;">${beforeVal} ${palette.suffix}</span>
                                            <span style="color:${palette.accent}; font-weight:800; white-space:nowrap;">+ ${total} ${palette.suffix}</span>
                                            <span style="color:inherit; opacity:0.9; white-space:nowrap;">${afterVal} ${palette.suffix}</span>
                                        </div>
                                    </div>
                                `);
                            }
                        }
                    }

                    if (targetsToSocket.length > 0 && !game.user.isGM) {
                        const gmId = game.users.find(u => u.isGM && u.active)?.id;
                        if (gmId && game.socket) {
                            game.socket.emit("module.not-dice", {
                                type: "not-dice.apply-healing",
                                targets: targetsToSocket,
                                total: total,
                                isTempHp: isTempHp
                            });
                        }
                    }

                    if (summaryLines.length > 0) {
                        ChatMessage.create({
                            style: CONST.CHAT_MESSAGE_STYLES?.OTHER || 0,
                            speaker: { alias: " " },
                            flags: { "not-dice": { hideHeader: true } },
                            content: `<div style="font-size:0.88em; line-height:1.2; padding:2px 2px;">${summaryLines.join("")}</div>`
                        });
                    }

                } else {
                    ui.notifications.warn("Not Dice | No se encontró objetivo para aplicar la curación.");
                }
                return true;
            } catch (err) {
                (globalThis.notDiceLogger || console).error("Error aplicando curación:", err);
                return false;
            }
        };

        const setupRollEvent = (element) => {
            const btn = element.querySelector("#not-dice-heal-roll-btn");
            const input = element.querySelector("#not-dice-heal-result");
            const icon = btn?.querySelector("i");
            
            if (btn) {
                btn.addEventListener("click", async (e) => {
                    e.preventDefault();
                    if (btn.disabled) return;
                    btn.disabled = true;
                    if (icon) icon.className = "fas fa-spinner fa-spin";

                    try {
                        const roll = await new Roll(firstRow.formula, actor?.getRollData()).evaluate({ async: true });
                        await roll.toMessage({
                            speaker: ChatMessage.getSpeaker({ actor: actor }),
                            flavor: `<b>${titleText}</b> - ${itemName || actualItem.name}`,
                        });
                        if (input) {
                            input.value = roll.total;
                            input.style.boxShadow = "0 0 16px rgba(34, 197, 94, 0.8)";
                            input.style.borderColor = "#22c55e";
                            setTimeout(() => {
                                input.style.boxShadow = "inset 0 0 8px rgba(34,197,94,0.15)";
                            }, 1200);
                        }
                    } catch (err) {
                        (globalThis.notDiceLogger || console).error("Error tirando dados de curación:", err);
                        ui.notifications?.error("Error al tirar los dados.");
                    } finally {
                        btn.disabled = false;
                        if (icon) icon.className = "fas fa-dice-d20";
                    }
                });
            }
        };

        return new Promise((resolve) => {
            const DialogV2 = foundry?.applications?.api?.DialogV2;
            
            if (DialogV2) {
                const app = new DialogV2({
                    window: { title: `Not Dice | ${titleText}` },
                    content: content,
                    position: { width: 380 },
                    buttons: [
                        { action: "apply", icon: "fa-solid fa-heart", label: buttonText, default: true },
                        { action: "cancel", icon: "fa-solid fa-xmark", label: "Cancelar" }
                    ],
                    submit: async (result) => {
                        if (result === "apply") {
                            resolve(await applyHealing(app.element));
                        } else {
                            resolve(false);
                        }
                    }
                });
                
                app.render(true).then(() => {
                    setupRollEvent(app.element);
                });
            } else {
                new Dialog({
                    title: `Not Dice | ${titleText}`,
                    content: content,
                    render: (html) => {
                        setupRollEvent(html[0] || html);
                    },
                    buttons: {
                        apply: {
                            icon: '<i class="fas fa-heart"></i>',
                            label: buttonText,
                            callback: async (html) => {
                                resolve(await applyHealing(html[0] || html));
                            }
                        },
                        cancel: {
                            icon: '<i class="fas fa-times"></i>',
                            label: "Cancelar",
                            callback: () => resolve(false)
                        }
                    },
                    default: "apply"
                }, { width: 380 }).render(true);
            }
        });
    };
};

Hooks.once("init", () => {
    initHealingDialog();
});
