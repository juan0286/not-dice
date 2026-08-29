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
            const tokens = actor.getActiveTokens();
            if (tokens.length > 0) targets = [tokens[0]];
        }

        // Obtener la fórmula
        let sourceRows = normalizedRequestedParts.length > 0
            ? normalizedRequestedParts
            : (typeof globalThis.notDiceExtractDamageRows === "function" 
                ? globalThis.notDiceExtractDamageRows(actualItem) 
                : []);

        // If fallback or empty, try to get activity.healing (dnd5e 3.x)
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
        
        let targetHtml = "";
        if (targets.length > 0) {
            const t = targets[0];
            targetHtml = `
                <div style="display:flex; flex-direction:column; align-items:center; margin-bottom:15px; padding:10px; border: 1px solid rgba(46, 204, 113, 0.3); background: rgba(46, 204, 113, 0.05); border-radius: 8px;">
                    <img src="${t.document.texture.src || t.actor.img}" style="width:64px; height:64px; border-radius:50%; border:2px solid #2ecc71; object-fit:cover; margin-bottom:5px; box-shadow: 0 0 10px rgba(46, 204, 113, 0.4);">
                    <div style="font-weight:bold; font-size:1.1em;">${t.name}</div>
                    <div style="font-size:0.85em; opacity:0.8;">Objetivo</div>
                </div>
            `;
        }

        const content = `
            <div style="padding:10px; text-align:center; display:flex; flex-direction:column; gap:12px;">
                ${targetHtml}
                
                <div>
                    <div style="font-size:0.9em; opacity:0.8; margin-bottom:4px;">Fórmula de ${titleText}</div>
                    <div style="display:flex; justify-content:center; align-items:center; gap:8px;">
                        <div style="font-size:1.2em; font-family:monospace; font-weight:bold; padding:4px 12px; background:rgba(0,0,0,0.1); border:1px solid var(--color-border-light-2, #ccc); border-radius:4px;">
                            ${firstRow.formula}
                        </div>
                        <button type="button" id="not-dice-heal-roll-btn" style="flex:0 0 auto; width:auto; padding:4px 8px; cursor:pointer;" title="Lanzar Dados">
                            <i class="fas fa-dice-d20"></i> Lanzar
                        </button>
                    </div>
                </div>

                <div>
                    <label style="font-size:0.9em; font-weight:bold; display:block; margin-bottom:4px;">Resultado a Aplicar:</label>
                    <input type="number" id="not-dice-heal-result" value="0" style="width:100px; text-align:center; font-size:1.4em; font-weight:bold; background:rgba(0,0,0,0.1); border:1px solid var(--color-border-light-2, #ccc); border-radius:4px; padding:6px; margin:0 auto; display:block;">
                </div>

                <div style="font-size:0.85em; opacity:0.7;">
                    <i>${itemName || actualItem.name}</i> (por ${senderName})
                </div>
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
            
            if (btn) {
                btn.addEventListener("click", async (e) => {
                    e.preventDefault();
                    try {
                        const roll = await new Roll(firstRow.formula, actor?.getRollData()).evaluate({ async: true });
                        await roll.toMessage({
                            speaker: ChatMessage.getSpeaker({ actor: actor }),
                            flavor: `<b>${titleText}</b> - ${itemName || actualItem.name}`,
                        });
                        if (input) input.value = roll.total;
                    } catch (err) {
                        (globalThis.notDiceLogger || console).error("Error tirando dados de curación:", err);
                        ui.notifications?.error("Error al tirar los dados.");
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
