// ============================================================
// not-dice | module.js
// Intercepta tiradas de ataque y daño, aplicando interfaz 
// moderna y resolución automática de maestrias/efectos.
// Compatible dinámicamente con Modo Claro y Modo Oscuro.
// ============================================================

// Helpers --------------------------------------------------------------
const notDiceIsAttack = (subject) => {
    return subject && (subject.type === "attack" || subject.constructor?.name === "AttackActivity");
};

const notDiceFirstActiveGmId = () => {
    return game.users.find(u => u.isGM && u.active)?.id || null;
};

const notDiceBuildAttackPayload = (rollConfig) => {
    return {
        type: "not-dice.show-attack-dialog",
        itemUuid: rollConfig.subject?.item?.uuid,
        activityId: rollConfig.subject?.id,
        targetIds: Array.from(game.user.targets ?? []).map(t => t.id),
        isNickAttack: rollConfig.isNickAttack,
        senderName: game.user.name,
        senderUserId: game.user.id,
        targetUserId: notDiceFirstActiveGmId()
    };
};

const notDiceGetDamageTypeOptionsHtml = (selectedType = "", availableTypes = null) => {
    const damageTypes = CONFIG.DND5E?.damageTypes ?? {};
    const sourceEntries = Array.isArray(availableTypes) && availableTypes.length > 0
        ? availableTypes.map(typeKey => [typeKey, damageTypes[typeKey] || { label: typeKey }])
        : Object.entries(damageTypes);

    return sourceEntries.map(([typeKey, typeData]) => {
        const label = typeData?.label || typeKey;
        const selected = typeKey === selectedType ? "selected" : "";
        return `<option value="${typeKey}" ${selected} style="color:#1f2937; background:#f3f4f6;">${label}</option>`;
    }).join("");
};

const notDiceExtractDamageRows = (actualItem) => {
    const rows = [];
    const rollData = typeof actualItem?.getRollData === "function"
        ? actualItem.getRollData()
        : (typeof actualItem?.actor?.getRollData === "function" ? actualItem.actor.getRollData() : {});

    const resolveFormula = (formula = "") => {
        let resolved = String(formula || "").trim();
        if (!resolved) return "";

        try {
            if (typeof Roll?.replaceFormulaData === "function") {
                resolved = Roll.replaceFormulaData(resolved, rollData, { missing: 0, warn: false });
            }
        } catch (err) {
            console.warn("Not Dice | No se pudo resolver la fórmula de daño", err);
        }

        // Normaliza casos como "d8 + 4" a "1d8 + 4" para que se vea claro y sea evaluable.
        resolved = resolved.replace(/(^|[+\-*/(]\s*)d(\d+)/gi, "$11d$2");
        return resolved.replace(/\s+/g, " ").trim();
    };

    const pushPart = (formula = "", type = "", availableTypes = []) => {
        const cleanFormula = resolveFormula(formula);
        if (!cleanFormula) return;
        rows.push({
            formula: cleanFormula,
            type: String(type || "").trim().toLowerCase(),
            availableTypes: Array.isArray(availableTypes) ? availableTypes.map(t => String(t || "").trim().toLowerCase()).filter(Boolean) : []
        });
    };

    if (actualItem?.system?.activities) {
        for (const activity of actualItem.system.activities.values()) {
            const parts = activity?.damage?.parts || [];
            for (const part of parts) {
                if (Array.isArray(part)) {
                    pushPart(part[0], part[1], part[1] ? [part[1]] : []);
                } else {
                    const formula = part?.formula || (part?.number && part?.denomination ? `${part.number}d${part.denomination}${part.bonus ? `+${part.bonus}` : ""}` : part?.custom?.formula) || "";
                    const typeList = part?.types instanceof Set ? Array.from(part.types) : (Array.isArray(part?.types) ? part.types : []);
                    const type = typeList.length > 0 ? typeList[0] : "";
                    pushPart(formula, type, typeList);
                }
            }
        }
    } else if (actualItem?.system?.damage?.parts?.length > 0) {
        for (const part of actualItem.system.damage.parts) {
            if (Array.isArray(part)) {
                pushPart(part[0], part[1], part[1] ? [part[1]] : []);
            }
        }
    }

    if (!rows.length && actualItem?.labels?.damage) {
        pushPart(actualItem.labels.damage, "", []);
    }

    return rows.length > 0 ? rows : [{ formula: "1d8", type: "", availableTypes: [] }];
};

globalThis.notDiceOpenDamageDialog = async ({
    uuid,
    itemName,
    targetIds = [],
    notDiceMultipliers = {},
    targetUserId = null,
    senderName = game.user.name,
    requestedDamageParts = null
} = {}) => {
    const item = uuid ? await fromUuid(uuid) : null;
    const actualItem = item?.item || item;

    if (!actualItem) {
        ui.notifications?.warn("Not Dice | No se pudo encontrar el objeto origen para el daño.");
        return false;
    }

    const speaker = ChatMessage.getSpeaker({ actor: actualItem.actor });
    const damageTypeLabels = CONFIG.DND5E?.damageTypes ?? {};
    const rowFaces = [4, 6, 8, 10, 12, 20];
    const dialogId = `not-dice-damage-${Math.random().toString(36).slice(2, 10)}`;
    let isCritical = false;
    const normalizedRequestedParts = Array.isArray(requestedDamageParts)
        ? requestedDamageParts.map((part, index) => ({
            formula: String(part?.formula || "").trim(),
            type: String(part?.type || "").trim().toLowerCase(),
            availableTypes: Array.isArray(part?.availableTypes)
                ? part.availableTypes.map(t => String(t || "").trim().toLowerCase()).filter(Boolean)
                : []
        })).filter(part => part.formula.length > 0)
        : [];

    const sourceRows = normalizedRequestedParts.length > 0
        ? normalizedRequestedParts
        : notDiceExtractDamageRows(actualItem);

    let rows = sourceRows.map((row, index) => ({
        id: `${dialogId}-${index}`,
        formula: row.formula,
        type: row.type,
        availableTypes: Array.isArray(row.availableTypes) ? row.availableTypes : []
    }));

    const doubleDice = (formula) => formula.replace(/(\d+)d(\d+)/g, (match, quantity, faces) => `${parseInt(quantity, 10) * 2}d${faces}`);

    const buildRowHtml = (row, index) => {
        const typeOptions = notDiceGetDamageTypeOptionsHtml(row.type, row.availableTypes);
        return `
            <div class="not-dice-damage-row" data-row-id="${row.id}" style="display:flex; gap:10px; align-items:flex-start; padding:10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background: rgba(128,128,128,0.08); margin-bottom:8px;">
                <div style="flex:1; min-width:0;">
                    <label style="display:block; font-size:0.75em; color:inherit; opacity:0.7; margin-bottom:3px;">Fórmula</label>
                    <input type="text" class="not-dice-damage-formula" value="${row.formula}" style="width:100%; padding:5px 7px; border:1px solid var(--color-border-light-2, #ccc); border-radius:4px; background:rgba(128,128,128,0.1); color:inherit; font-family:monospace; font-size:0.98em;" />
                </div>
                <div style="width:150px; flex-shrink:0;">
                    <label style="display:block; font-size:0.75em; color:inherit; opacity:0.7; margin-bottom:3px;">Tipo de Daño</label>
                    <select class="not-dice-damage-type" style="width:100%; padding:5px 7px; border:1px solid #9ca3af; border-radius:4px; background:#f3f4f6; color:#111827; font-size:0.9em; font-weight:600;">
                        ${typeOptions}
                    </select>
                </div>
                <button type="button" class="not-dice-damage-remove-row" title="Eliminar fila" style="margin-top:22px; width:32px; height:32px; border:1px solid rgba(197,34,31,0.3); border-radius:4px; background:rgba(197,34,31,0.08); color:#ff5252; cursor:pointer; flex-shrink:0;">×</button>
            </div>
        `;
    };

    const buildContent = () => `
        <div style="font-family:inherit; padding:4px 2px;">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(127,127,127,0.1); box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <img src="${actualItem.img || "icons/svg/sword.svg"}" style="width:44px; height:44px; border:1px solid var(--color-border-light-2, #aaa); border-radius:6px; object-fit:cover; flex-shrink:0;">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:1.03em; font-weight:bold; color:inherit; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Tirada de Daño</div>
                    <div style="font-size:0.82em; color:inherit; opacity:0.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${itemName || actualItem.name || "Daño"} • ${senderName || game.user.name}</div>
                </div>
            </div>

            <div id="${dialogId}-rows" style="display:flex; flex-direction:column; gap:8px; max-height:320px; overflow-y:auto; padding-right:4px;">
                ${rows.map((row, index) => buildRowHtml(row, index)).join("")}
            </div>

            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:8px; padding:8px 10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(128,128,128,0.08);">
                <span style="font-size:0.8em; font-weight:bold; opacity:0.85; margin-right:4px;">Agregar daño:</span>
                ${rowFaces.map(faces => `<button type="button" class="not-dice-damage-add-row" data-faces="${faces}" style="padding:4px 8px; border:1px solid var(--color-border-light-2, #bbb); border-radius:4px; background:rgba(127,127,127,0.1); color:inherit; cursor:pointer; font-size:0.8em;">d${faces}</button>`).join("")}
            </div>

            <div style="margin-top:10px; display:flex; justify-content:flex-end; gap:8px; font-size:0.78em; opacity:0.8;">
                <span>Selecciona un botón de dado para añadir una nueva fila.</span>
            </div>
        </div>
    `;

    const syncRowsFromDom = (root) => {
        rows = rows.map(row => {
            const rowNode = root.querySelector(`[data-row-id="${row.id}"]`);
            if (!rowNode) return row;
            return {
                ...row,
                formula: rowNode.querySelector(".not-dice-damage-formula")?.value?.trim() || "",
                type: rowNode.querySelector(".not-dice-damage-type")?.value || ""
            };
        });
    };

    const renderRows = (root) => {
        const rowsContainer = root.querySelector(`#${dialogId}-rows`);
        if (!rowsContainer) return;
        rowsContainer.innerHTML = rows.map((row, index) => buildRowHtml(row, index)).join("");
    };

    const collectDamageRows = (root) => {
        syncRowsFromDom(root);
        return rows
            .map(row => ({
                formula: String(row.formula || "").trim(),
                type: String(row.type || "").trim()
            }))
            .filter(row => row.formula.length > 0);
    };

    const executeDamageRoll = async (baseFormula, damageType) => {
        let formula = baseFormula;
        if (isCritical) formula = doubleDice(formula);

        const roll = await new Roll(formula, actualItem.getRollData()).evaluate();
        const damageLabel = damageType ? (damageTypeLabels[damageType]?.label || damageType) : "Sin tipo";
        await roll.toMessage({
            speaker,
            flavor: `<strong>${isCritical ? "Daño Crítico" : "Daño"}</strong> • ${actualItem.name || itemName || "Daño"} <span style="opacity:0.75;">(${damageLabel})</span>`
        });
        return roll.total;
    };

    const sendDamageToGM = async (root) => {
        const damageRows = collectDamageRows(root);
        if (damageRows.length === 0) {
            ui.notifications?.warn("Not Dice | Agrega al menos una fila de daño.");
            return false;
        }

        const gmUserId = targetUserId || game.users.find(u => u.isGM && u.active)?.id;
        if (!gmUserId || !game.socket) {
            ui.notifications?.warn("Not Dice | No hay un GM activo para recibir el daño.");
            return false;
        }

        const totals = [];
        for (const row of damageRows) {
            const total = await executeDamageRoll(row.formula, row.type);
            totals.push(total);
        }

        game.socket.emit("module.not-dice", {
            type: "not-dice.show-spell-damage",
            itemUuid: uuid,
            targetIds,
            notDiceMultipliers,
            senderName: game.user.name,
            targetUserId: gmUserId,
            preCalculatedTotals: totals,
            preCalculatedParts: damageRows
        });

        ui.notifications?.info("Not Dice | Resultado de daño enviado al GM.");
        return true;
    };

    const openDialog = () => new Promise(resolve => {
        const DialogV2 = foundry?.applications?.api?.DialogV2;
        if (DialogV2) {
            const app = new DialogV2({
                window: { title: `Tirada de Daño - ${actualItem.name || itemName || "Daño"}` },
                content: buildContent(),
                position: { width: 520 },
                buttons: [
                    { action: "send", icon: "fa-solid fa-dice-d20", label: "Daño Normal", default: true },
                    { action: "critical", icon: "fa-solid fa-skull", label: "Daño Crítico" }
                ],
                submit: async (result) => {
                    if (result === "send") {
                        isCritical = false;
                        const sent = await sendDamageToGM(app.element);
                        resolve(sent);
                        return;
                    }
                    if (result === "critical") {
                        isCritical = true;
                        const sent = await sendDamageToGM(app.element);
                        resolve(sent);
                        return;
                    }
                    resolve(false);
                },
                close: () => resolve(false)
            });

            app.render(true).then(() => {
                const root = app.element;
                const bindEvents = () => {
                    root.addEventListener("click", async (ev) => {
                        const addBtn = ev.target.closest(".not-dice-damage-add-row");
                        if (addBtn) {
                            ev.preventDefault();
                            syncRowsFromDom(root);
                            const faces = addBtn.dataset.faces || "8";
                            const newRow = {
                                id: `${dialogId}-${Math.random().toString(36).slice(2, 8)}`,
                                formula: `1d${faces}`,
                                type: rows[0]?.type || "",
                                availableTypes: []
                            };
                            rows.push(newRow);
                            renderRows(root);
                            return;
                        }

                        const removeBtn = ev.target.closest(".not-dice-damage-remove-row");
                        if (removeBtn) {
                            ev.preventDefault();
                            if (rows.length <= 1) return;
                            syncRowsFromDom(root);
                            const rowNode = removeBtn.closest(".not-dice-damage-row");
                            const rowId = rowNode?.dataset?.rowId;
                            rows = rows.filter(row => row.id !== rowId);
                            renderRows(root);
                        }
                    });
                };

                bindEvents();
                renderRows(root);
            });
            return;
        }

        const legacyDialog = new Dialog({
            title: `Tirada de Daño - ${actualItem.name || itemName || "Daño"}`,
            content: buildContent(),
            buttons: {
                send: {
                    label: "Daño Normal",
                    callback: async html => {
                        isCritical = false;
                        resolve(await sendDamageToGM(html[0] || html));
                    }
                },
                critical: {
                    label: "Daño Crítico",
                    callback: async html => {
                        isCritical = true;
                        resolve(await sendDamageToGM(html[0] || html));
                    }
                }
            },
            default: "send",
            render: html => {
                const root = html[0] || html;
                root.addEventListener("click", async (ev) => {
                    const addBtn = ev.target.closest(".not-dice-damage-add-row");
                    if (addBtn) {
                        ev.preventDefault();
                        syncRowsFromDom(root);
                        const faces = addBtn.dataset.faces || "8";
                        const newRow = {
                            id: `${dialogId}-${Math.random().toString(36).slice(2, 8)}`,
                            formula: `1d${faces}`,
                            type: rows[0]?.type || "",
                            availableTypes: []
                        };
                        rows.push(newRow);
                        renderRows(root);
                    }

                    const removeBtn = ev.target.closest(".not-dice-damage-remove-row");
                    if (removeBtn) {
                        ev.preventDefault();
                        if (rows.length <= 1) return;
                        syncRowsFromDom(root);
                        const rowNode = removeBtn.closest(".not-dice-damage-row");
                        const rowId = rowNode?.dataset?.rowId;
                        rows = rows.filter(row => row.id !== rowId);
                        renderRows(root);
                    }
                });
                renderRows(root);
            }
        }, { width: 520 });

        legacyDialog.render(true);
        resolve(true);
    });

    return openDialog();
};

const notDiceHandlePlayerAttack = async (rolls, rollConfig) => {
    const payload = notDiceBuildAttackPayload(rollConfig);
    if (!payload.targetUserId || !game.socket) {
        ui.notifications?.warn("Not Dice | No hay GM activo para recibir el daño.");
        return [];
    }
    game.socket.emit("module.not-dice", payload);
    ui.notifications?.info("Not Dice | Ataque enviado al GM para resolución.");
    return [];
};

const notDiceHandleAttackSocket = async (data) => {
    if (!data || !game.user.isGM) return;

    // Respeta destinatario específico si viene indicado
    if (data.targetUserId && data.targetUserId !== game.user.id) return;

    if (data.type === "not-dice.show-spell-save-result") {
        Hooks.callAll("notDiceSaveResult", data);
        return;
    }

    // Solo log sencillo cuando un jugador inicia ataque
    if (data.type === "not-dice.attack-log") {
        console.log(`Not Dice | Ataque de ${data.userName || "Jugador"}: ${data.attacker} con ${data.itemName} -> Objetivos: ${data.targets}`);
        return;
    }

    if (data.type === "not-dice.show-spell-damage") {
        try {
            if (globalThis._notDiceActiveAttackDialogs && globalThis._notDiceActiveAttackDialogs[data.itemUuid]) {
                const wasUpdated = globalThis._notDiceActiveAttackDialogs[data.itemUuid](data.preCalculatedTotals, data.preCalculatedParts);
                if (wasUpdated) {
                    ui.notifications?.info(`Not Dice | Daño actualizado por ${data.senderName || "jugador"}.`);
                    return;
                }
            }

            const item = data.itemUuid ? await fromUuid(data.itemUuid) : null;
            const activity = item?.system?.activities?.find(a => a.type === "save" || a.type === "damage" || a.type === "attack") || (item?.type === "save" || item?.type === "spell" ? item : null);
            
            if (!item || !activity) return ui.notifications?.warn("Not Dice | No se pudo recuperar la actividad para el daño del hechizo.");

            await activity.rollDamage({
                event: { targetIds: data.targetIds },
                options: { 
                    notDicePreCalculatedTotals: data.preCalculatedTotals,
                    notDicePreCalculatedParts: data.preCalculatedParts,
                    notDiceMultipliers: data.notDiceMultipliers
                }
            });
            ui.notifications?.info(`Not Dice | Daño de hechizo enviado por ${data.senderName || "jugador"}.`);
        } catch(e) {
            console.error("Not Dice | Error en show-spell-damage", e);
        }
        return;
    }

    if (data.type !== "not-dice.show-attack-dialog") return;

    try {
        const item = data.itemUuid ? await fromUuid(data.itemUuid) : null;
        const activity = data.activityId ? item?.system?.activities?.get(data.activityId) : item?.system?.activities?.find(a => a.type === "damage" || a.type === "attack");
        if (!item || !activity) return ui.notifications?.warn("Not Dice | No se pudo recuperar la actividad del ataque.");

        await activity.rollDamage({
            event: { targetIds: data.targetIds, senderUserId: data.senderUserId },
            isNickAttack: data.isNickAttack
        });
        ui.notifications?.info(`Not Dice | Resolviendo daño enviado por ${data.senderName || "jugador"}.`);
    } catch (err) {
        console.error("Not Dice | Error inyectando popup directo", err);
    }
};

Hooks.once("ready", () => {
    if (!globalThis._notDiceSocketReady) {
        globalThis._notDiceSocketReady = true;
        game.socket.on("module.not-dice", notDiceHandleAttackSocket);
    }

    if (!game.settings.get("not-dice", "enableModule")) return;

    console.log("Not Dice | Module Ready");

    // --- D20Roll (Attack) Patching ---
    const D20Roll = CONFIG.Dice.D20Roll;
    if (D20Roll) {
        const originalBuildConfigure = D20Roll.buildConfigure;
        const originalBuildEvaluate = D20Roll.buildEvaluate;

        D20Roll.buildConfigure = async function(config, dialog, message) {
            console.log("Not Dice | D20 buildConfigure intercepted", config);

            if (config.isNickAttack) {
                console.log("Not Dice | >>> ATAQUE MELLAR DETECTADO <<<");
                const actor = config.subject?.actor;
                const hasTwoWeaponStyle = actor?.items?.some(i => 
                    i.system?.identifier === "two-weapon-fighting" || 
                    i.name === "Two-Weapon Fighting" || 
                    (i.name.toLowerCase().includes("combate con dos armas") && i.type === "feat")
                );

                if (hasTwoWeaponStyle) {
                    console.log("Not Dice | Estilo de Combate Two-Weapon Fighting: DETECTADO");
                } else {
                    console.log("Not Dice | Estilo de Combate Two-Weapon Fighting: NO DETECTADO");
                }
            }

            const isAttack = config.subject && 
                             (config.subject.type === "attack" || 
                              config.subject.constructor.name === "AttackActivity");
            
            if (isAttack) {
                console.log("Not Dice | Skipping system dialog and chat message for Attack.");
                dialog = foundry.utils.mergeObject(dialog ?? {}, { configure: false });
                if (message) message.create = false;
            }
            return originalBuildConfigure.call(this, config, dialog, message);
        };

        D20Roll.buildEvaluate = async function(rolls, rollConfig, messageConfig) {
            console.log("Not Dice | D20 buildEvaluate intercepted", rolls);
            const isAttack = notDiceIsAttack(rollConfig.subject);

            // Player branch: solo empaqueta y envía al GM
            if (isAttack && !game.user.isGM) {
                return notDiceHandlePlayerAttack(rolls, rollConfig);
            }

            if (isAttack) {
                console.log("Not Dice | Auto-resolving Attack Roll (Silent).");
                for (const roll of rolls) {
                    const total = 20;
                    const numericTerm = new foundry.dice.terms.NumericTerm({number: total});
                    numericTerm._evaluated = true;
                    roll.terms = [numericTerm];
                    roll._total = total;
                    roll._evaluated = true;
                    
                    // Solo el GM debe disparar el daño automático y mostrar popup.
                    if (game.user.isGM) {
                        setTimeout(() => {
                            if (rollConfig.subject && rollConfig.subject.rollDamage) {
                                console.log("Not Dice | Triggering Auto-Damage Roll (GM)");
                                rollConfig.subject.rollDamage({
                                    event: rollConfig.event,
                                    isNickAttack: rollConfig.isNickAttack
                                });
                            }
                        }, 250);
                    }
                }
                return rolls;
            }
            return originalBuildEvaluate.apply(this, arguments);
        };
    }

    // --- DamageRoll Patching ---
    const DamageRoll = CONFIG.Dice.DamageRoll;
    if (DamageRoll) {
        const originalDamageBuildConfigure = DamageRoll.buildConfigure;
        const originalDamageBuildEvaluate = DamageRoll.buildEvaluate;

        const notDiceEvaluateDamageRoll = async (rolls, rollConfig, messageConfig) => {
            console.log("Not Dice | Damage buildEvaluate intercepted", rolls);
            
            const passedMultipliers = rollConfig?.notDiceMultipliers || rollConfig?.options?.notDiceMultipliers || rollConfig?.event?.notDiceMultipliers || {};
            const forcedParts = Array.isArray(rollConfig?.options?.notDicePreCalculatedParts) ? rollConfig.options.notDicePreCalculatedParts : [];
            const hasForcedParts = forcedParts.length > 0;

            if (hasForcedParts) {
                const rebuiltRolls = [];
                for (const part of forcedParts) {
                    const partFormula = String(part?.formula || "0").trim() || "0";
                    const partType = String(part?.type || "").trim().toLowerCase();
                    const rebuilt = new DamageRoll(partFormula);
                    rebuilt.options = rebuilt.options || {};
                    if (partType) rebuilt.options.type = partType;
                    rebuiltRolls.push(rebuilt);
                }
                rolls = rebuiltRolls;
            }
            
            // --- Nick Attack Logic ---
            const isNickAttack = rollConfig.isNickAttack;
            const actor = rollConfig.subject?.actor || rollConfig.subject?.item?.actor;
            const hasTwoWeaponStyle = actor?.items?.some(i => 
                  i.system?.identifier === "two-weapon-fighting" || 
                  i.name === "Two-Weapon Fighting" || 
                  (i.name.toLowerCase().includes("combate con dos armas") && i.type === "feat")
            );
            const isOffhandWithoutStyle = isNickAttack && !hasTwoWeaponStyle;
            if (isOffhandWithoutStyle) console.log("Not Dice | Offhand Attack without Style - Removing Ability Mod from formula.");

            const hasDivineFavor = !hasForcedParts && actor?.effects?.some(e => {
                const name = (e.name || "").toLowerCase();
                return name.includes("divine favor") || name.includes("favor divino");
            });

            if (hasDivineFavor) {
                const divineFavorRoll = new DamageRoll("1d4", {}, { type: "radiant" });
                divineFavorRoll.options = divineFavorRoll.options || {};
                divineFavorRoll.options.type = "radiant";
                divineFavorRoll.options.notDiceLabel = "Favor Divino";
                rolls.push(divineFavorRoll);
            }

            // --- Detect Hunter's Mark / Marca del Cazador on targets ---
            const attackerUuid = actor?.uuid;
            const injectedTargetIds = rollConfig?.event?.targetIds;
            const huntersMarkTargets = Array.isArray(injectedTargetIds) && injectedTargetIds.length > 0
                ? injectedTargetIds.map(id => canvas.tokens.get(id)).filter(Boolean)
                : Array.from(game.user.targets ?? []);
            const hasHuntersMark = !hasForcedParts && attackerUuid && huntersMarkTargets.some(t =>
                t.actor?.effects?.some(e => {
                    const eName = (e.name || "").toLowerCase();
                    return (eName.includes("hunter's mark") || eName.includes("marca del cazador"))
                        && (e.origin || "").includes(attackerUuid);
                })
            );

            if (hasHuntersMark) {
                console.log("Not Dice | Hunter's Mark detectada en objetivo — añadiendo 1d6 force");
                const huntersMarkRoll = new DamageRoll("1d6", {}, { type: "force" });
                huntersMarkRoll.options = huntersMarkRoll.options || {};
                huntersMarkRoll.options.type = "force";
                huntersMarkRoll.options.notDiceLabel = "Marca del Cazador";
                rolls.push(huntersMarkRoll);
            }

            const item = rollConfig.subject?.item || rollConfig.subject;

            // --- Great Weapon Master / Maestro en Armas Pesadas ---
            if (item && item.type === "weapon" && actor) {
                const hasGWM = actor.items?.some(i => {
                    const name = (i.name || "").toLowerCase();
                    return i.type === "feat" && (name.includes("great weapon master") || name.includes("maestro de armas pesadas") || name.includes("maestro en armas pesadas"));
                });
                
                const isHeavy = item.system?.properties?.has("hvy");
                const actionType = rollConfig.subject?.actionType || item.system?.actionType;
                const isMelee = actionType === "mwak";

                if (!hasForcedParts && hasGWM && isHeavy && isMelee) {
                    const profBonus = actor.system?.attributes?.prof || 0;
                    if (profBonus > 0 && rolls.length > 0) {
                        const originalRoll = rolls[0];
                        const newFormula = `${originalRoll.formula} + ${profBonus}[GWM]`;
                        const newRoll = new DamageRoll(newFormula, originalRoll.data, originalRoll.options);
                        rolls[0] = newRoll;
                        console.log(`Not Dice | Great Weapon Master detectado: Fórmula base modificada a ${newFormula}`);
                    }
                }
            }

            // --- Detect Mastery ---
            let activeMastery = null;
            if (item) {
                 const baseItem = item.system.type?.baseItem;
                 const actorMasteries = item.actor?.system?.traits?.weaponProf?.mastery?.value || new Set();
                 if (baseItem && actorMasteries.has(baseItem) && item.system.mastery) {
                     activeMastery = {
                         id: item.system.mastery,
                         label: CONFIG.DND5E.weaponMasteries?.[item.system.mastery]?.label || item.system.mastery
                     };
                 }
            }

            // --- Detect Guiding Bolt / Saeta Guía ---
            let isGuidingBolt = false;
            if (item) {
                const spellName = (item.name || "").toLowerCase();
                if (spellName.includes("guiding bolt") || spellName.includes("saeta guía") || spellName.includes("saeta guia")) {
                    isGuidingBolt = true;
                }
            }

            // Function to calculate versatile damage scaling (d6->d8, d8->d10)
            const scaleVersatile = (formula) => {
                if (formula.includes("d6")) return formula.replace("d6", "d8");
                if (formula.includes("d8")) return formula.replace("d8", "d10");
                return null;
            };

            // --- Process All Rolls ---
            const damageParts = [];
            const allDamageTypes = new Set();
            const activityDamageParts = rollConfig?.subject?.damage?.parts || [];
            
            for (let i = 0; i < rolls.length; i++) {
                const roll = rolls[i];
                const forcedPart = hasForcedParts ? forcedParts[i] : null;
                let originalFormula = forcedPart?.formula ? String(forcedPart.formula) : roll.formula;
                
                if (isOffhandWithoutStyle) {
                     // Remove + @mod or + number from end
                     originalFormula = originalFormula.replace(/\s*\+\s*(@mod|\d+)(\s*\[.*?\])?$/, "");
                }

                let versatileFormula = null;
                if (!versatileFormula && item?.system?.properties?.has("ver")) {
                    versatileFormula = scaleVersatile(originalFormula);
                }

                const damageTypeKey = forcedPart?.type || roll.options.type;
                const partConfig = activityDamageParts[i];
                let availableTypes = [];
                if (Array.isArray(forcedPart?.availableTypes) && forcedPart.availableTypes.length > 0) {
                    availableTypes = Array.from(new Set(forcedPart.availableTypes.map(t => String(t || "").trim().toLowerCase()).filter(Boolean)));
                } else {
                    availableTypes = partConfig?.types ? Array.from(partConfig.types) : [];
                }

                if (damageTypeKey) {
                    if(!availableTypes.includes(damageTypeKey)) availableTypes.push(damageTypeKey);
                    allDamageTypes.add(damageTypeKey);
                }
                if (availableTypes.length > 0) {
                     availableTypes.forEach(t => allDamageTypes.add(t));
                }

                const damageConfig = damageTypeKey ? CONFIG.DND5E.damageTypes[damageTypeKey] : null;
                let damageTypeLabel = damageConfig?.label || damageTypeKey || "None";
                const customLabel = roll.options?.notDiceLabel;
                if (customLabel) damageTypeLabel = `${customLabel} (${damageTypeLabel})`;
                
                if (damageConfig?.icon) {
                    damageTypeLabel = `<img src="${damageConfig.icon}" style="width: 16px; height: 16px; vertical-align: text-bottom; margin-right: 4px; border: none; filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.3));" /> ${damageTypeLabel}`;
                }

                damageParts.push({
                    index: i,
                    roll: roll,
                    formula: originalFormula,
                    versatileFormula: versatileFormula,
                    label: damageTypeLabel,
                    type: damageTypeKey,
                    availableTypes: availableTypes,
                    isOffhandWithoutStyle: isOffhandWithoutStyle
                });
            }
                
            const multiplierOptions = globalThis.notDiceConstants.multiplierOptions;

            // Helper to resolve targets
            const resolveTargets = () => {
                const inyectedIds = rollConfig?.event?.targetIds;
                if (inyectedIds && Array.isArray(inyectedIds) && inyectedIds.length > 0) {
                    const mappedTokens = inyectedIds.map(id => canvas.tokens.get(id)).filter(Boolean);
                    if (mappedTokens.length > 0) return mappedTokens;
                }
                return Array.from(game.user.targets ?? []);
            };

            const targets = resolveTargets();
            let targetHtml = "";
            
            if (targets.length > 0) {
                targetHtml += `<h3 style="border-bottom: 1px solid var(--color-border-light-2, #ccc); padding-bottom: 4px; margin-bottom: 10px; font-size: 1.1em; color: inherit; opacity: 0.9;">Objetivos (${targets.length}):</h3>`;
                targetHtml += `<div style="display: flex; flex-direction: column; gap: 8px;">`;
                for (const t of targets) {
                    const traits = t.actor?.system?.traits;
                    if (!traits) continue;
                    
                    let isResistant = false;
                    let isImmune = false;
                    let isVulnerable = false;

                    for (const dt of allDamageTypes) {
                        if (traits.dr?.value?.has(dt)) isResistant = true;
                        if (traits.di?.value?.has(dt)) isImmune = true;
                        if (traits.dv?.value?.has(dt)) isVulnerable = true;
                    }
                    
                    const getLabels = (set) => {
                        if (!set) return "";
                        return Array.from(set).map(k => CONFIG.DND5E.damageTypes[k]?.label || k).join(", ");
                    };
                    
                    const dr = getLabels(traits.dr?.value);
                    const di = getLabels(traits.di?.value);
                    const dv = getLabels(traits.dv?.value);
                    const ac = t.actor?.system?.attributes?.ac?.value;
                    const tokenImg = t.document?.texture?.src || t.actor?.img || "";
                    
                    let borderStyle = "border: 1px solid var(--color-border-light-2, #ddd);";
                    let bgStyle = "background: rgba(127,127,127,0.1);";
                    
                    if (isImmune) { borderStyle = "border: 1px solid rgba(197,34,31,0.4);"; bgStyle = "background: rgba(197,34,31,0.1);"; }
                    else if (isVulnerable) { borderStyle = "border: 1px solid rgba(11,87,208,0.4);"; bgStyle = "background: rgba(11,87,208,0.1);"; }
                    else if (isResistant) { borderStyle = "border: 1px solid rgba(176,96,0,0.4);"; bgStyle = "background: rgba(176,96,0,0.1);"; }

                    const tokenImgHtml = tokenImg ? `<img src="${tokenImg}" style="width:38px; height:38px; border-radius:50%; border:1px solid var(--color-border-light-2, #aaa); object-fit:cover; flex-shrink:0; box-shadow: 0 1px 3px rgba(0,0,0,0.3);" />` : "";

                    let badgesHtml = "";
                    if (dr) badgesHtml += `<span style="display:inline-block; font-size:0.75em; background:rgba(176,96,0,0.15); color:#ffb300; padding:2px 6px; border-radius:8px; border:1px solid rgba(176,96,0,0.3); margin-top:4px; margin-right:4px;"><i class="fas fa-shield-alt"></i> Res: ${dr}</span>`;
                    if (di) badgesHtml += `<span style="display:inline-block; font-size:0.75em; background:rgba(197,34,31,0.15); color:#ff5252; padding:2px 6px; border-radius:8px; border:1px solid rgba(197,34,31,0.3); margin-top:4px; margin-right:4px;"><i class="fas fa-ban"></i> Inm: ${di}</span>`;
                    if (dv) badgesHtml += `<span style="display:inline-block; font-size:0.75em; background:rgba(11,87,208,0.15); color:#4fc3f7; padding:2px 6px; border-radius:8px; border:1px solid rgba(11,87,208,0.3); margin-top:4px; margin-right:4px;"><i class="fas fa-heart-broken"></i> Vul: ${dv}</span>`;

                    const hasHAM = t.actor.items?.some(i => {
                        const n = (i.name || "").toLowerCase();
                        return i.type === "feat" && (n.includes("heavy armor master") || n.includes("maestro en armadura pesada"));
                    });
                    if (hasHAM) badgesHtml += `<span style="display:inline-block; font-size:0.75em; background:rgba(106,27,154,0.15); color:#ba68c8; padding:2px 6px; border-radius:8px; border:1px solid rgba(106,27,154,0.3); margin-top:4px; margin-right:4px;"><i class="fas fa-chess-rook"></i> Armadura Pesada (-Prof)</span>`;

                    const notDiceStatusES = globalThis.notDiceConstants.statusES;
                    const activeStatuses = t.actor?.statuses ?? new Set();
                    const conditionLabels = [];
                    for (const statusId of activeStatuses) { conditionLabels.push(notDiceStatusES[statusId] || statusId); }
                    if (conditionLabels.length > 0) {
                        badgesHtml += `<div style="font-size:0.8em; color:inherit; opacity:0.75; font-style:italic; margin-top:4px;"><i class="fas fa-exclamation-circle"></i> ${conditionLabels.join(", ")}</div>`;
                    }

                    let baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                    let detectedMultiplier = 1;
                    for (const dt of allDamageTypes) {
                        if (traits.di?.value?.has(dt)) detectedMultiplier = 0;
                        else if (traits.dv?.value?.has(dt) && detectedMultiplier !== 0) detectedMultiplier = 2;
                        else if (traits.dr?.value?.has(dt) && detectedMultiplier !== 2 && detectedMultiplier !== 0) detectedMultiplier = 0.5;
                    }
                    detectedMultiplier = detectedMultiplier * baseMult;

                    targetHtml += `
                    <div style="display:flex; align-items:flex-start; gap:10px; padding: 8px; border-radius: 6px; ${borderStyle} ${bgStyle}">
                        ${tokenImgHtml}
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:bold; font-size:1.1em; color:inherit;">${t.name}</span>
                                ${ac !== undefined ? `<span style="font-size:0.85em; font-weight:bold; background:rgba(128,128,128,0.2); color:inherit; padding:2px 6px; border-radius:4px; border:1px solid var(--color-border-light-2, #ccc); box-shadow:0 1px 1px rgba(0,0,0,0.1);" title="Clase de Armadura">CA ${ac}</span>` : ""}
                            </div>
                            <div>${badgesHtml}</div>
                        </div>
                        <div style="flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                            <label style="font-size:0.75em; color:inherit; opacity:0.7;">Multiplicador:</label>
                            <select name="target-multiplier-${t.id}" style="padding:2px 4px; border:1px solid var(--color-border-light-2, #ccc); background:rgba(128,128,128,0.1); color:inherit; border-radius:4px; font-size:0.9em; cursor:pointer;">
                                ${multiplierOptions.map(o => `<option value="${o.val}" style="color:inherit;" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                            </select>
                        </div>
                    </div>`;
                }
                targetHtml += "</div>";
            } else {
                targetHtml = "<div style='margin-bottom: 10px; font-style: italic; color: inherit; opacity:0.6; text-align:center; padding:10px; border:1px dashed var(--color-border-light-2, #ccc); border-radius:6px;'>No hay objetivo seleccionado</div>";
            }

            // --- Gather Attack Info ---
            let attackHtml = "";
            let isNickActive = false;
            let nickWeaponName = "";
            let nickWeaponItem = null;
            let attackRollState = null;

            const getAttackRollVisualState = (selectedD20, total) => {
                const targetAC = targets.length > 0 ? (targets[0].actor?.system?.attributes?.ac?.value ?? null) : null;
                if (selectedD20 === 1) return { bg: "rgba(197,34,31,0.1)", border: "rgba(197,34,31,0.4)", text: "#ff5252" };
                if (selectedD20 === 20) return { bg: "rgba(19,115,51,0.1)", border: "rgba(19,115,51,0.4)", text: "#4caf50" };
                if (targetAC !== null && total >= targetAC) return { bg: "rgba(19,115,51,0.1)", border: "rgba(19,115,51,0.4)", text: "#4caf50" };
                if (targetAC !== null && total < targetAC) return { bg: "rgba(197,34,31,0.1)", border: "rgba(197,34,31,0.4)", text: "#ff5252" };
                return { bg: "rgba(127,127,127,0.1)", border: "var(--color-border-light-2, #ddd)", text: "inherit" };
            };

            const buildAttackRollDisplay = (state) => {
                if (!state) return { contentHtml: "", boxStyle: "" };

                const selectedD20 = state.mode === "advantage"
                    ? Math.max(state.originalD20, state.extraD20 ?? state.originalD20)
                    : state.mode === "disadvantage"
                        ? Math.min(state.originalD20, state.extraD20 ?? state.originalD20)
                        : state.originalD20;
                const total = selectedD20 + state.bonus;
                const visual = getAttackRollVisualState(selectedD20, total);

                let modeBadge = "";
                if (state.mode === "advantage") modeBadge = "<span style='color:#4fc3f7; font-size:0.85em; font-weight:bold; margin-right:6px;'><i class='fas fa-arrow-up'></i> Ventaja</span>";
                else if (state.mode === "disadvantage") modeBadge = "<span style='color:#ff5252; font-size:0.85em; font-weight:bold; margin-right:6px;'><i class='fas fa-arrow-down'></i> Desventaja</span>";

                const modSign = state.bonus >= 0 ? "+" : "-";
                const modifierHtml = ` ${modSign} ${Math.abs(state.bonus)}`;

                let diceHtml = `<span style="font-weight:bold;">${state.originalD20}</span>`;
                if (state.mode !== "normal" && state.extraD20 != null) {
                    const originalStyle = selectedD20 === state.originalD20 ? "font-weight:900; text-decoration:underline;" : "opacity:0.65;";
                    const extraStyle = selectedD20 === state.extraD20 ? "font-weight:900; text-decoration:underline;" : "opacity:0.65;";
                    diceHtml = `<span style="${originalStyle}">${state.originalD20}</span> / <span style="${extraStyle}">${state.extraD20}</span>`;
                }

                const contentHtml = `<div style="display:flex; align-items:center; justify-content:center; gap:8px;">
                    <button type="button" class="not-dice-attack-disadvantage-btn" title="Convertir a Desventaja" style="width:34px; height:34px; border:1px solid rgba(197,34,31,0.4); border-radius:6px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer; flex-shrink:0;"><i class="fas fa-arrow-down"></i></button>
                    <div class="not-dice-attack-roll-result" style="flex:1; min-width:0; font-size: 1.1em; line-height:1.2;">
                        ${modeBadge}<span style="color:inherit; opacity:0.7;">d20:</span> ${diceHtml}${modifierHtml} = <span style="font-size: 1.4em; font-weight:900;">${total}</span>
                    </div>
                    <button type="button" class="not-dice-attack-advantage-btn" title="Convertir a Ventaja" style="width:34px; height:34px; border:1px solid rgba(19,115,51,0.4); border-radius:6px; background:rgba(19,115,51,0.1); color:#4caf50; cursor:pointer; flex-shrink:0;"><i class="fas fa-arrow-up"></i></button>
                </div>`;
                const boxStyle = `margin-bottom: 12px; color: ${visual.text}; text-align: center; border: 1px solid ${visual.border}; background: ${visual.bg}; border-radius: 6px; padding: 8px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.05);`;

                return { contentHtml, boxStyle, selectedD20, total };
            };

            if (rollConfig.subject.type === "attack") {
                const toHit = item.labels?.toHit || "";
                const isProficient = item.system.proficient || false;
                const profBadge = isProficient ? `<span style="display:inline-block; font-size:0.75em; background:rgba(19,115,51,0.15); color:#4caf50; padding:3px 8px; border-radius:12px; border:1px solid rgba(19,115,51,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-check-circle"></i> Competencia</span>` : `<span style="display:inline-block; font-size:0.75em; background:rgba(127,127,127,0.15); color:inherit; opacity:0.8; padding:3px 8px; border-radius:12px; border:1px solid rgba(127,127,127,0.3); margin-right:4px;">Sin Competencia</span>`;

                let masteryBadge = "";
                if (activeMastery) {
                    masteryBadge = `<span style="display:inline-block; font-size:0.75em; background:rgba(106,27,154,0.15); color:#ba68c8; padding:3px 8px; border-radius:12px; border:1px solid rgba(106,27,154,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-crown"></i> Maestría: ${activeMastery.label}</span>`;
                    
                    if (activeMastery.id === "nick" && !isNickAttack) {
                        const otherLightWeapon = item.actor?.itemTypes?.weapon?.find(w => 
                            w.id !== item.id && w.system.equipped && w.system.properties?.has("lgt")
                        );
                        if (otherLightWeapon) {
                            isNickActive = true;
                            nickWeaponName = otherLightWeapon.name;
                            nickWeaponItem = otherLightWeapon;
                        }
                    }
                }

                const hasSapEffect = item.actor?.effects?.some(e => 
                    (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                    (e.name.toLowerCase().includes("sap") || e.name.toLowerCase().includes("debilitar") || e.name.toLowerCase().includes("vax"))
                );
                
                let sapBadge = hasSapEffect ? `<span style="display:inline-block; font-size:0.75em; background:rgba(197,34,31,0.15); color:#ff5252; padding:3px 8px; border-radius:12px; border:1px solid rgba(197,34,31,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-arrow-down"></i> Desventaja (Debilitado)</span>` : "";

                const targetsLocal = Array.from(game.user.targets);
                const attackerName = item.actor.name;
                const hasVexAdvantage = targetsLocal.some(t => 
                    t.actor?.effects?.some(e => 
                        (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                        (e.name.toLowerCase().includes("vex") || e.name.toLowerCase().includes("molestar")) &&
                        e.name.includes(`(${attackerName})`)
                    )
                );

                let vexBadge = hasVexAdvantage ? `<span style="display:inline-block; font-size:0.75em; background:rgba(19,115,51,0.15); color:#4caf50; padding:3px 8px; border-radius:12px; border:1px solid rgba(19,115,51,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-arrow-up"></i> Ventaja (Molestar)</span>` : "";

                const hasGuidingBoltAdvantage = targetsLocal.some(t =>
                    t.actor?.effects?.some(e => {
                        const eName = (e.name || "").toLowerCase();
                        return eName.includes("saeta guía") || eName.includes("saeta guia") || eName.includes("guiding bolt");
                    })
                );

                let guidingBoltBadge = hasGuidingBoltAdvantage ? `<span style="display:inline-block; font-size:0.75em; background:rgba(176,96,0,0.15); color:#ffb300; padding:3px 8px; border-radius:12px; border:1px solid rgba(176,96,0,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-star"></i> Ventaja (Saeta Guía)</span>` : "";

                // --- Simultaneous Attack Roll ---
                let attackRollHtml = "";
                let attackRollBoxStyle = "";
                if (game.settings.get("not-dice", "enableSimultaneousRoll")) {
                    try {
                        let formula = `1d20`;
                        let parts = [];
                        if (toHit) {
                            let cleanToHit = toHit.trim();
                            if (cleanToHit && !cleanToHit.startsWith("+") && !cleanToHit.startsWith("-")) {
                                cleanToHit = "+ " + cleanToHit;
                            }
                            parts.push(cleanToHit);
                        }

                        if (parts.length > 0) {
                            formula += ` ${parts.join(" + ")}`;
                        }
                        
                        const rollData = item.getRollData();
                        const r = await new Roll(formula, rollData).evaluate();

                        // Publicar la tirada de ataque en el chat para vista de todos (esto reproduce automáticamente la animación 3D y el sonido nativo)
                        const actorSpeaker = ChatMessage.getSpeaker({ actor: item?.actor });
                        await r.toMessage({ speaker: actorSpeaker, flavor: `<strong>Tirada de Ataque: ${item?.name || "Ataque"}</strong>` });

                        attackRollState = {
                            mode: "normal",
                            originalD20: r.terms?.[0]?.total ?? 0,
                            extraD20: null,
                            bonus: r.total - (r.terms?.[0]?.total ?? 0)
                        };

                        const display = buildAttackRollDisplay(attackRollState);
                        attackRollHtml = display.contentHtml;
                        attackRollBoxStyle = display.boxStyle;
                    } catch (err) {
                        console.error("Not Dice | Failed simultaneous roll", err);
                    }
                }

                const attackImg = item.img || "icons/svg/sword.svg";

                attackHtml = `
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(127,127,127,0.1); box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <img src="${attackImg}" style="width:48px; height:48px; border:1px solid var(--color-border-light-2, #aaa); border-radius:6px; object-fit:cover; flex-shrink:0;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:1em; margin-bottom:4px; color:inherit; opacity:0.8;">Ataque: <span style="font-weight:900; font-size:1.4em; color:inherit; opacity:1;">${toHit}</span></div>
                        <div style="display:flex; flex-wrap:wrap; gap:4px;">
                            ${profBadge} ${masteryBadge} ${sapBadge} ${vexBadge} ${guidingBoltBadge}
                        </div>
                    </div>
                </div>`;
                
                if (attackRollHtml) {
                    attackHtml += `<div class="not-dice-attack-roll-box" style="${attackRollBoxStyle}">${attackRollHtml}</div>`;
                }
            }

            const confirmMellar = async (weaponName) => {
                return new Promise(resolve => {
                    const DialogV2 = foundry?.applications?.api?.DialogV2;
                    if (DialogV2) {
                        new DialogV2({
                            window: { title: "Maestría: Mellar" },
                            content: `<p style="padding:10px;">¿Atacar con Mellar: <strong>${weaponName}</strong>?</p>`,
                            buttons: [
                                { action: "yes", label: "Sí", default: true },
                                { action: "no", label: "No" }
                            ],
                            submit: result => resolve(result === "yes")
                        }).render(true);
                    } else {
                        new Dialog({
                            title: "Maestría: Mellar",
                            content: `<p>¿Atacar con Mellar: <strong>${weaponName}</strong>?</p>`,
                            buttons: {
                                yes: { label: "Si", callback: () => resolve(true) },
                                no: { label: "No", callback: () => resolve(false) }
                            },
                            default: "yes",
                            close: () => resolve(false)
                        }).render(true);
                    }
                });
            };

            // --- Build Logic For Multiple Damage Parts ---

            const damageStyle = {
                 acid: { color: "#aeea00", icon: "🧪" },
                 bludgeoning: { color: "inherit", icon: "🔨" },
                 cold: { color: "#4fc3f7", icon: "❄️" },
                 fire: { color: "#ff5252", icon: "🔥" },
                 force: { color: "#e040fb", icon: "✨" }, 
                 lightning: { color: "#ffd600", icon: "⚡" },
                 necrotic: { color: "#b0bec5", icon: "💀" },
                 piercing: { color: "inherit", icon: "🏹" },
                 poison: { color: "#69f0ae", icon: "🤢" },
                 psychic: { color: "#ff4081", icon: "🧠" },
                 radiant: { color: "#ffca28", icon: "☀️" },
                 slashing: { color: "inherit", icon: "⚔️" },
                 thunder: { color: "#7c4dff", icon: "🔊" },
                 healing: { color: "#69f0ae", icon: "💚" },
                 temphp: { color: "inherit", icon: "🛡️" }
            };

            const hasSavageAttacker = actor?.items?.some(i => {
                const n = (i.name || "").toLowerCase();
                return i.type === "feat" && (n.includes("savage attacker") || n.includes("atacante salvaje"));
            }) || false;

            const hasGreatWeaponFighting = actor?.items?.some(i => {
                const n = (i.name || "").toLowerCase();
                const sysId = i.system?.identifier || "";
                return i.type === "feat" && (
                    n.includes("great weapon fighting") || 
                    n.includes("armas a dos manos") || 
                    n.includes("arma a dos manos") ||
                    sysId === "great-weapon-fighting"
                );
            }) || false;

            const hasPiercer = actor?.items?.some(i => {
                const n = (i.name || "").toLowerCase();
                return i.type === "feat" && (n.includes("piercer") || n.includes("perforador"));
            }) || false;


            let damageInputsHtml = "";
            for (const part of damageParts) {
                let specialModsHtml = "";
                if (hasSavageAttacker) {
                    specialModsHtml += `
                    <div style="display:flex; justify-content:center; align-items:center; gap:6px; margin-bottom: 4px; padding: 4px 8px; background: rgba(197,34,31,0.08); border: 1px solid rgba(197,34,31,0.3); border-radius: 4px; width: 100%;" title="ATACANTE SALVAJE">
                        <input type="checkbox" id="savage-${part.index}" class="savage-attacker-cb" data-index="${part.index}" style="margin:0; cursor:pointer;" checked>
                        <label for="savage-${part.index}" style="font-size:0.85em; color:#ff5252; cursor:pointer; font-weight:bold; letter-spacing: 0.5px; margin:0;"><i class="fas fa-paw"></i> Atacante Salvaje</label>
                    </div>`;
                }
                if (hasGreatWeaponFighting) {
                    specialModsHtml += `
                    <div style="display:flex; justify-content:center; align-items:center; gap:6px; margin-bottom: 4px; padding: 4px 8px; background: rgba(26,115,232,0.08); border: 1px solid rgba(26,115,232,0.3); border-radius: 4px; width: 100%;" title="ESTILO: COMBATE CON ARMAS A DOS MANOS">
                        <input type="checkbox" id="gwf-${part.index}" class="gwf-cb" data-index="${part.index}" style="margin:0; cursor:pointer;" checked>
                        <label for="gwf-${part.index}" style="font-size:0.85em; color:#1a73e8; cursor:pointer; font-weight:bold; letter-spacing: 0.5px; margin:0;"><i class="fas fa-gavel"></i> Armas a Dos Manos</label>
                    </div>`;
                }
                
                if (specialModsHtml) specialModsHtml = `<div style="margin-bottom:8px;">${specialModsHtml}</div>`;
                let labelHtml = part.label;
                let currentDamageType = part.type;
                
                if (part.availableTypes && part.availableTypes.length > 1) {
                    let optionsHtml = part.availableTypes.map(t => {
                        const c = CONFIG.DND5E.damageTypes[t];
                        const l = c ? (c.label || t) : t;
                        const selected = t === part.type ? "selected" : "";
                        const style = damageStyle[t] || { color: "inherit", icon: "" };
                        return `<option value="${t}" style="color: ${style.color}; font-weight: bold;" ${selected}>${style.icon} ${l}</option>`;
                    }).join("");
                    
                    const initialStyle = damageStyle[currentDamageType] || { color: "inherit" };
                    labelHtml = `<select name="type-${part.index}" style="width: 100%; border: 1px solid transparent; font-weight: bold; background: transparent; color: ${initialStyle.color}; font-size:1.05em; cursor:pointer;">${optionsHtml}</select>`;
                } else {
                     if (part.type) {
                         const style = damageStyle[part.type] || { color: "inherit", icon: "" };
                         const hiddenInput = `<input type="hidden" name="type-${part.index}" value="${part.type}">`; 
                         let content = part.label;
                         if (!content.includes("<img") && style.icon) content = `${style.icon} ${content}`;
                         labelHtml = `<span style="color: ${style.color}; font-weight: bold; font-size:1.05em;">${content}</span>${hiddenInput}`;
                     }
                }

                damageInputsHtml += `
                <div class="damage-part-container" data-index="${part.index}" style="margin-bottom: 12px; padding: 12px; border: 1px solid var(--color-border-light-2, #ddd); border-radius: 6px; background: rgba(127,127,127,0.1); box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                    <div style="margin-bottom: 8px; border-bottom: 1px solid var(--color-border-light-2, #ddd); padding-bottom: 4px;">${labelHtml}</div>
                    
                    <div style="display:flex; gap:10px; margin-bottom: 8px;">
                        <div style="flex:1;">
                            <label style="font-size:0.85em; color:inherit; opacity:0.7;">Fórmula:</label>
                            <input type="text" value="${part.formula}" readonly style="width: 100%; padding:4px 6px; border:1px solid var(--color-border-light-2, #ccc); border-radius:4px; background:rgba(128,128,128,0.1); color:inherit; font-family:monospace; font-size:1.1em; ${part.isOffhandWithoutStyle ? 'border-color:#ff5252; background-color:rgba(197,34,31,0.1);' : ''}"/>
                            ${part.isOffhandWithoutStyle ? '<div style="font-size: 0.75em; color: #ff5252; margin-top: 2px;">* Sin mod. de característica</div>' : ''}
                        </div>
                        ${part.versatileFormula ? `
                        <div style="flex:1;">
                            <label style="font-size:0.85em; color:inherit; opacity:0.7;">Versátil (2M):</label>
                            <input type="text" value="${part.versatileFormula}" readonly style="width: 100%; padding:4px 6px; border:1px solid var(--color-border-light-2, #ccc); border-radius:4px; background:rgba(128,128,128,0.1); color:inherit; font-family:monospace; font-size:1.1em;"/>
                        </div>` : ""}
                    </div>
                    
                    ${specialModsHtml}
                    
                    <div style="display:flex; gap:10px; align-items:flex-end;">
                        <div style="flex:1;">
                            <label style="font-size:0.85em; color:inherit; opacity:0.7;">Total Daño:</label>
                            <input type="number" name="total-${part.index}" value="${rollConfig.options?.notDicePreCalculatedTotals?.[part.index] !== undefined ? rollConfig.options.notDicePreCalculatedTotals[part.index] : '0'}" style="width: 100%; height: 38px; font-size:1.6em; font-weight:bold; text-align:center; padding:4px; border:1px solid var(--color-border-light-2, #aaa); border-radius:4px; color:#ff5252; background:rgba(128,128,128,0.1);"/>
                        </div>
                        <div style="display:flex; gap:4px; padding-bottom:1px; align-items:center;">
                            <button type="button" class="roll-damage-btn" data-index="${part.index}" style="width:38px; height:38px; border:1px solid var(--color-border-light-2, #bbb); border-radius:4px; background:var(--color-bg-option, rgba(127,127,127,0.1)); color:inherit; cursor:pointer;" title="Tirar Daño Normal"><i class="fas fa-dice" style="color:inherit; opacity:0.8;"></i></button>
                            <button type="button" class="roll-damage-crit-btn" data-index="${part.index}" style="width:38px; height:38px; border:1px solid #d32f2f; border-radius:4px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer;" title="Tirar Daño Crítico"><i class="fas fa-dice-d20"></i></button>
                        </div>
                    </div>
                </div>`;
            }

            let requestDamageBtnHtml = "";
            const senderUserId = rollConfig?.event?.senderUserId;
            const canRequestPlayerDamage = senderUserId && senderUserId !== game.user.id && damageParts.length > 0;
            if (canRequestPlayerDamage) {
                requestDamageBtnHtml = `
                    <div style="text-align: center; margin-top: 10px; margin-bottom: 5px;">
                        <button type="button" id="not-dice-btn-request-damage-attack" data-user="${senderUserId}" data-uuid="${item.uuid}" style="background: rgba(26,115,232,0.1); border: 1px solid rgba(26,115,232,0.4); color: #1a73e8; font-weight: bold; border-radius: 4px; padding: 6px 12px; cursor: pointer; transition: all 0.2s;">
                            <i class="fas fa-dice"></i> Solicitar Tirada de Daño al Jugador
                        </button>
                    </div>
                `;
            }

            const dialogContent = `
                <div style="font-family:inherit; padding:4px 2px;">
                    ${attackHtml}
                    ${targetHtml}
                    <h3 style="border-bottom: 1px solid var(--color-border-light-2, #ccc); padding-bottom: 4px; margin-bottom: 10px; font-size:1.1em; color:inherit; opacity:0.9;">Desglose de Daño</h3>
                    <div style="max-height: 380px; overflow-y: auto; padding-right: 6px;">
                        ${damageInputsHtml}
                    </div>
                    ${requestDamageBtnHtml}
                </div>
            `;

            const applyAndResolve = async (container, isDamage = false) => {
                const root = container instanceof HTMLElement ? container : container[0];

                // --- Consume Mastery Effects (Sap/Vex) ---
                const sapEffect = item.actor?.effects?.find(e => 
                    (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                    (e.name.toLowerCase().includes("sap") || e.name.toLowerCase().includes("debilitar") || e.name.toLowerCase().includes("vax"))
                );
                if (sapEffect) {
                    await item.actor.deleteEmbeddedDocuments("ActiveEffect", [sapEffect.id]);
                }

                const currentTargets = resolveTargets();
                if (currentTargets.length > 0) {
                     const attackerName = item.actor.name;
                     for (const t of currentTargets) {
                        if (!t.actor) continue;
                        const vexEffect = t.actor.effects?.find(e => 
                            (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                            (e.name.toLowerCase().includes("vex") || e.name.toLowerCase().includes("molestar")) &&
                            e.name.includes(`(${attackerName})`)
                        );
                        if (vexEffect) {
                            await t.actor.deleteEmbeddedDocuments("ActiveEffect", [vexEffect.id]);
                            ui.notifications.info(`Not Dice | Ventaja Consumida: ${vexEffect.name}`);
                        }

                        const guidingBoltEffect = t.actor.effects?.find(e => {
                            const eName = (e.name || "").toLowerCase();
                            return eName.includes("saeta guía") || eName.includes("saeta guia") || eName.includes("guiding bolt");
                        });
                        if (guidingBoltEffect) {
                            await t.actor.deleteEmbeddedDocuments("ActiveEffect", [guidingBoltEffect.id]);
                            ui.notifications.info(`Not Dice | Ventaja Consumida: ${guidingBoltEffect.name}`);
                        }
                     }
                }

                // Nick / Mellar Logic
                if (isDamage && isNickActive) {
                    const confirmed = await confirmMellar(nickWeaponName);
                    if (confirmed && nickWeaponItem) {
                        const attackActivity = nickWeaponItem.system.activities?.find(a => a.type === "attack");
                        if (attackActivity) {
                            setTimeout(() => attackActivity.rollAttack({event: rollConfig.event, isNickAttack: true}), 500);
                        }
                    }
                }

                // Gather values and update rolls
                const totalValues = [];
                for (const part of damageParts) {
                    const inputVal = root.querySelector(`[name='total-${part.index}']`)?.value || "0";
                    let val = parseInt(inputVal);
                    if (isNaN(val)) val = 0;

                    let selectedType = root.querySelector(`[name='type-${part.index}']`)?.value;
                    if (!selectedType) selectedType = part.type;
                    
                    const roll = part.roll;
                    roll._total = val;
                    roll._evaluated = true;
                    roll.options.type = selectedType;

                    const options = roll.terms[0]?.options ?? {};
                    const newTerm = new foundry.dice.terms.NumericTerm({number: val, options: options});
                    newTerm._evaluated = true;
                    roll.terms = [newTerm];
                    
                    totalValues.push({ value: val, type: selectedType });
                }

                // Apply Damage
                if (isDamage) {
                    const targetsLocal = resolveTargets();
                    const damageSummaryLines = [];

                    const isToppleMastery = activeMastery && (activeMastery.id === "topple" || activeMastery.label.toLowerCase().includes("topple") || activeMastery.label.toLowerCase().includes("derribar"));
                    
                    if (activeMastery && activeMastery.id !== "nick" && !isToppleMastery) {
                        for (const t of targetsLocal) {
                             if (t.actor) {
                                 const effectData = {
                                    name: `Maestría: ${activeMastery.label} (${item.actor.name})`,
                                    icon: item.img || "icons/svg/aura.svg",
                                    origin: item.uuid,
                                    duration: { rounds: 1 }
                                 };

                                 if (activeMastery.id === "vex" || activeMastery.label.toLowerCase().includes("molestar")) {
                                     effectData.duration.turns = 1;
                                 }

                                 if (activeMastery.id === "slow" || activeMastery.label.toLowerCase().includes("ralentizar")) {
                                     effectData.changes = [
                                         { key: "system.attributes.movement.walk", mode: 2, value: "-10" },
                                         { key: "system.attributes.movement.fly", mode: 2, value: "-10" },
                                         { key: "system.attributes.movement.swim", mode: 2, value: "-10" },
                                         { key: "system.attributes.movement.climb", mode: 2, value: "-10" },
                                         { key: "system.attributes.movement.burrow", mode: 2, value: "-10" }
                                     ];
                                 }

                                 if (game.combat) {
                                    effectData.duration.startRound = game.combat.round;
                                    effectData.duration.startTurn = game.combat.turn;
                                 } else {
                                    effectData.duration.startTime = game.time.worldTime;
                                 }

                                 await t.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
                                 ui.notifications.info(`Not Dice | Maestría Aplicada: ${activeMastery.label} -> ${t.name}`);
                             }
                        }
                    }

                    if (isGuidingBolt) {
                        for (const t of targetsLocal) {
                            if (t.actor) {
                                const gbEffectData = {
                                    name: `Saeta Guía (${item.actor.name})`,
                                    icon: item.img || "icons/svg/sun.svg",
                                    origin: item.uuid,
                                    duration: { rounds: 1 }
                                };
                                if (game.combat) {
                                    gbEffectData.duration.startRound = game.combat.round;
                                    gbEffectData.duration.startTurn = game.combat.turn;
                                } else {
                                    gbEffectData.duration.startTime = game.time.worldTime;
                                }
                                await t.actor.createEmbeddedDocuments("ActiveEffect", [gbEffectData]);
                            }
                        }
                    }

                    for (const t of targetsLocal) {
                        if (t.actor) {
                            const hpBefore = Number(t.actor.system?.attributes?.hp?.value ?? 0);
                            const targetMultRaw = root.querySelector(`[name='target-multiplier-${t.id}']`)?.value || "1";
                            let targetMult = parseFloat(targetMultRaw);
                            if (isNaN(targetMult)) targetMult = 1;

                            const hasHeavyArmorMaster = t.actor.items?.some(i => {
                                const n = (i.name || "").toLowerCase();
                                return i.type === "feat" && (n.includes("heavy armor master") || n.includes("maestro en armadura pesada"));
                            });

                            let finalValues = isDamage ? totalValues.map(tv => ({ ...tv, value: Math.floor(tv.value * targetMult) })) : totalValues;

                            if (hasHeavyArmorMaster) {
                                const attackerProf = actor?.system?.attributes?.prof ?? 3;
                                const physicalTypes = new Set(["bludgeoning", "piercing", "slashing"]);
                                finalValues = totalValues.map(tv => {
                                    if (physicalTypes.has(tv.type) && tv.value > 0) {
                                        const reduced = Math.max(0, tv.value - attackerProf);
                                        ui.notifications.info(`Not Dice | Armadura Pesada: -${attackerProf} daño (${tv.type}) en ${t.name}`);
                                        return { ...tv, value: reduced };
                                    }
                                    return tv;
                                });
                            }

                            await t.actor.applyDamage(finalValues, { ignore: true });

                            const hpAfter = Number(t.actor.system?.attributes?.hp?.value ?? 0);
                            const totalApplied = finalValues.reduce((acc, entry) => acc + (Number(entry?.value) || 0), 0);
                            const hasHealingType = finalValues.some(entry => String(entry?.type || "").toLowerCase() === "healing");
                            const operator = hasHealingType ? "+" : "-";
                            const amount = Math.abs(totalApplied);
                            const palette = hasHealingType
                                ? { fg: "#166534", accent: "#16a34a", bg: "rgba(22,101,52,0.12)", border: "rgba(22,101,52,0.35)" }
                                : { fg: "#991b1b", accent: "#dc2626", bg: "rgba(153,27,27,0.12)", border: "rgba(153,27,27,0.35)" };

                            damageSummaryLines.push(`
                                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 8px; margin-bottom:4px; border:1px solid ${palette.border}; border-radius:6px; background:${palette.bg}; font-size:0.84em; line-height:1.2;">
                                    <span style="font-weight:700; color:${palette.fg}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.name}</span>
                                    <span style="color:inherit; opacity:0.9; white-space:nowrap;">${hpBefore} pv</span>
                                    <span style="color:${palette.accent}; font-weight:800; white-space:nowrap;">${operator} ${amount} pv</span>
                                    <span style="color:inherit; opacity:0.9; white-space:nowrap;">${hpAfter} pv</span>
                                </div>
                            `);
                        }
                    }

                    if (damageSummaryLines.length > 0) {
                        const gmWhisper = game.users.filter(u => u.isGM).map(u => u.id);
                        ChatMessage.create({
                            style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                            whisper: gmWhisper,
                            speaker: { alias: " " },
                            flags: { "not-dice": { hideHeader: true } },
                            content: `<div style="font-size:0.88em; line-height:1.2; padding:2px 2px;">${damageSummaryLines.join("")}</div>`
                        });
                    }

                    // --- Topple / Derribar Mastery ---
                    const isTopple = activeMastery && (
                        activeMastery.id === "topple" || activeMastery.label.toLowerCase().includes("topple") || activeMastery.label.toLowerCase().includes("derribar")
                    );
                    if (isTopple) {
                        const attackerProf = actor?.system?.attributes?.prof ?? 0;
                        const strMod = actor?.system?.abilities?.str?.mod ?? 0;
                        const dexMod = actor?.system?.abilities?.dex?.mod ?? 0;
                        const attackMod = Math.max(strMod, dexMod);
                        const toppleDC = 8 + attackerProf + attackMod;

                        for (const t of targetsLocal) {
                            if (!t.actor) continue;
                            const conSaveRaw = t.actor.system?.abilities?.con?.save;
                            const conSave = typeof conSaveRaw === "number" ? conSaveRaw : (t.actor.system?.abilities?.con?.mod ?? 0);
                            const conSaveLabel = conSave >= 0 ? `+${conSave}` : `${conSave}`;

                            const ownerUsers = game.users.filter(u => !u.isGM && t.actor.testUserPermission(u, "OWNER")).map(u => u.id);
                            const whisperUsers = [...new Set([game.user.id, ...ownerUsers])];
                            
                            ChatMessage.create({
                                whisper: whisperUsers,
                                content: `
                                    <div style="text-align:center; padding:10px; font-family:inherit;">
                                        <h3 style="margin-bottom:5px;">Maestría: Derribar</h3>
                                        <p style="font-size:0.9em; margin-bottom:10px;"><strong>${t.name}</strong> debe superar una Salvación.</p>
                                        <div style="font-size: 1.2em; margin-bottom:10px; color:inherit;">CD: <span style="font-size: 1.4em; font-weight: 900; color: #ff5252;">${toppleDC}</span></div>
                                        <button class="not-dice-topple-save" data-actor-id="${t.actor.id}" data-dc="${toppleDC}" style="background: rgba(197,34,31,0.1); border: 1px solid #d32f2f; color: #ff5252; font-weight: bold; padding: 6px; border-radius:4px; cursor:pointer; width:100%; transition: all 0.2s;">
                                            <i class="fas fa-shield-alt"></i> Lanzar Salvación de Fuerza
                                        </button>
                                    </div>
                                `
                            });

                            await new Promise(resolveTopple => {
                                const DialogV2 = foundry?.applications?.api?.DialogV2;
                                const toppleContent = `
                                    <div style="text-align: center; padding: 10px; font-family:inherit;">
                                        <div style="font-size:1.1em; margin-bottom:8px; color:inherit;"><strong>${t.name}</strong> debe superar una</div>
                                        <div style="font-size: 1.3em; font-weight: bold; background:rgba(197,34,31,0.1); color:#ff5252; padding:6px; border-radius:6px; border:1px solid rgba(197,34,31,0.4); margin-bottom:10px;">Salvación de Constitución</div>
                                        <div style="font-size: 1.2em; margin-bottom:10px; color:inherit;">CD: <span style="font-size: 1.4em; font-weight: 900; color: #ff5252;">${toppleDC}</span></div>
                                        <div style="font-size: 0.9em; color:inherit; opacity:0.8;">Bono CON: <strong>${conSaveLabel}</strong></div>
                                    </div>`;

                                if (DialogV2) {
                                    new DialogV2({
                                        window: { title: `Maestría: Derribar — ${t.name}` },
                                        content: toppleContent,
                                        position: { width: 320 },
                                        buttons: [
                                            { action: "prone", label: "Derribado", icon: "fa-solid fa-person-falling" },
                                            { action: "pass", label: "Pasa", icon: "fa-solid fa-check", default: true }
                                        ],
                                        submit: async result => {
                                            if (result === "prone") {
                                                await t.actor.toggleStatusEffect("prone", { active: true });
                                                ui.notifications.info(`Not Dice | Derribar: ${t.name} está Derribado.`);
                                            }
                                            resolveTopple();
                                        }
                                    }).render(true);
                                } else {
                                    new Dialog({
                                        title: `Maestría: Derribar — ${t.name}`,
                                        content: toppleContent,
                                        buttons: {
                                            prone: { label: "<i class='fas fa-person-falling'></i> Derribado", callback: async () => {
                                                await t.actor.toggleStatusEffect("prone", { active: true });
                                                ui.notifications.info(`Not Dice | Derribar: ${t.name} está Derribado.`);
                                                resolveTopple();
                                            }},
                                            pass: { label: "<i class='fas fa-check'></i> Paso", callback: () => resolveTopple() }
                                        },
                                        default: "pass",
                                        close: () => resolveTopple()
                                    }, { width: 320 }).render(true);
                                }
                            });
                        }
                    }
                }
                return { total: totalValues.reduce((acc, curr) => acc + curr.value, 0) };
            };

            const getDamageRequestTargets = (root, forcedTargetIds = null) => {
                const targetIds = [];
                const targetMultipliers = {};
                const forcedSet = forcedTargetIds ? new Set(forcedTargetIds) : null;

                root.querySelectorAll("select[name^='target-multiplier-']").forEach(select => {
                    const tId = select.name.replace("target-multiplier-", "");
                    if (forcedSet && !forcedSet.has(tId)) return;

                    const mult = parseFloat(select.value);
                    if (mult > 0 || mult === -1) {
                        targetIds.push(tId);
                        targetMultipliers[tId] = mult;
                    }
                });

                if (targetIds.length === 0) return null;
                return { targetIds, targetMultipliers };
            };

            const getHitTargetIds = () => {
                if (!attackRollState || targets.length === 0) return [];

                const selectedD20 = attackRollState.mode === "advantage"
                    ? Math.max(attackRollState.originalD20, attackRollState.extraD20 ?? attackRollState.originalD20)
                    : attackRollState.mode === "disadvantage"
                        ? Math.min(attackRollState.originalD20, attackRollState.extraD20 ?? attackRollState.originalD20)
                        : attackRollState.originalD20;
                const total = selectedD20 + attackRollState.bonus;

                const hitIds = [];
                for (const target of targets) {
                    const targetAC = target.actor?.system?.attributes?.ac?.value;

                    if (selectedD20 === 1) continue;
                    if (selectedD20 === 20) {
                        hitIds.push(target.id);
                        continue;
                    }

                    if (typeof targetAC === "number" && total >= targetAC) {
                        hitIds.push(target.id);
                    }
                }

                return hitIds;
            };

            const sendDamageRequestToPlayer = async (root, forcedTargetIds = null) => {
                if (!canRequestPlayerDamage) return false;

                const reqBtn = root.querySelector("#not-dice-btn-request-damage-attack");
                if (!reqBtn || reqBtn.dataset.sent === "true") return false;

                const reqUserId = reqBtn.dataset.user;
                const reqUuid = reqBtn.dataset.uuid;
                const formulas = damageParts.map(p => p.formula).join("||");
                const damagePartsPayload = damageParts.map(p => ({
                    formula: p.formula,
                    type: p.type || "",
                    availableTypes: Array.isArray(p.availableTypes) ? p.availableTypes : []
                }));

                const requestTargets = getDamageRequestTargets(root, forcedTargetIds);
                if (!requestTargets) return false;

                const targetIdsStr = requestTargets.targetIds.join(",");
                const multipliersStr = JSON.stringify(requestTargets.targetMultipliers).replace(/"/g, '&quot;');
                const damagePartsStr = JSON.stringify(damagePartsPayload).replace(/"/g, '&quot;');

                await ChatMessage.create({
                    whisper: [reqUserId],
                    content: `
                        <div class="not-dice-damage-request" style="text-align:center; padding:10px;">
                            <h3 style="margin-bottom:5px;">Daño de ${item.name}</h3>
                            <p style="font-size:0.9em; margin-bottom:10px;">El GM solicita tu tirada de daño.</p>
                            <button class="not-dice-roll-spell-damage" data-uuid="${reqUuid}" data-formulas="${formulas}" data-damage-parts="${damagePartsStr}" data-targets="${targetIdsStr}" data-multipliers="${multipliersStr}" style="background: rgba(197,34,31,0.1); border: 1px solid #d32f2f; color: #ff5252; font-weight: bold; padding: 6px; border-radius:4px; cursor:pointer; width:100%;">
                                <i class="fas fa-dice-d20"></i> Lanzar Daño
                            </button>
                        </div>
                    `
                });

                reqBtn.innerHTML = "<i class='fas fa-check'></i> Solicitud Enviada";
                reqBtn.disabled = true;
                reqBtn.dataset.sent = "true";
                reqBtn.style.opacity = "0.6";
                reqBtn.style.cursor = "not-allowed";

                return true;
            };

            const notDiceVersion = game.modules.get("not-dice")?.version || "";
            
            // --- Handlers for interactive UI ---
            const onRenderComplete = (element) => {
                const root = element instanceof HTMLElement ? element : element[0];

                const attackRollBoxNode = root.querySelector(".not-dice-attack-roll-box");

                const setAttackButtonsDisabled = (isDisabled) => {
                    const buttons = root.querySelectorAll(".not-dice-attack-disadvantage-btn, .not-dice-attack-advantage-btn");
                    buttons.forEach(btn => {
                        btn.disabled = isDisabled;
                        btn.style.opacity = isDisabled ? "0.6" : "1";
                        btn.style.cursor = isDisabled ? "not-allowed" : "pointer";
                    });
                };

                const rerenderAttackRollState = () => {
                    if (!attackRollBoxNode || !attackRollState) return;
                    const display = buildAttackRollDisplay(attackRollState);
                    attackRollBoxNode.innerHTML = display.contentHtml;
                    attackRollBoxNode.setAttribute("style", display.boxStyle);
                };

                const applyManualAttackMode = async (mode) => {
                    if (!attackRollState || !attackRollBoxNode) return;
                    setAttackButtonsDisabled(true);
                    try {
                        const extraRoll = await new Roll("1d20").evaluate();
                        const extraD20 = extraRoll.total;
                        const selectedD20 = mode === "advantage"
                            ? Math.max(attackRollState.originalD20, extraD20)
                            : Math.min(attackRollState.originalD20, extraD20);
                        const total = selectedD20 + attackRollState.bonus;
                        const actorSpeaker = ChatMessage.getSpeaker({ actor: item?.actor });
                        const modeLabel = mode === "advantage" ? "Ventaja" : "Desventaja";

                        await extraRoll.toMessage({
                            speaker: actorSpeaker,
                            flavor: `<strong>Tirada de Ataque: ${item?.name || "Ataque"}</strong> (${modeLabel})<br>Original: ${attackRollState.originalD20} | Nuevo: ${extraD20} | Elegido: <strong>${selectedD20}</strong> | Total: <strong>${total}</strong>`
                        });

                        attackRollState = {
                            ...attackRollState,
                            mode,
                            extraD20
                        };
                        rerenderAttackRollState();
                    } catch (err) {
                        console.error("Not Dice | Error applying manual advantage/disadvantage", err);
                    } finally {
                        setAttackButtonsDisabled(false);
                    }
                };

                if (attackRollState && attackRollBoxNode) {
                    root.addEventListener("click", async (ev) => {
                        const disBtn = ev.target.closest(".not-dice-attack-disadvantage-btn");
                        const advBtn = ev.target.closest(".not-dice-attack-advantage-btn");
                        if (disBtn) {
                            ev.preventDefault();
                            await applyManualAttackMode("disadvantage");
                        } else if (advBtn) {
                            ev.preventDefault();
                            await applyManualAttackMode("advantage");
                        }
                    });
                }

                root.querySelectorAll("select[name^='type-']").forEach(select => {
                    select.addEventListener("change", (ev) => {
                        const newType = ev.currentTarget.value;
                        const currentTypes = Array.from(root.querySelectorAll("select[name^='type-'], input[type='hidden'][name^='type-']")).map(el => el.value);
                        
                        targets.forEach(t => {
                            let baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                            let detectedMultiplier = 1;
                            const traits = t.actor?.system?.traits;
                            if (traits) {
                                for (const dt of currentTypes) {
                                    if (traits.di?.value?.has(dt)) detectedMultiplier = 0;
                                    else if (traits.dv?.value?.has(dt) && detectedMultiplier !== 0) detectedMultiplier = 2;
                                    else if (traits.dr?.value?.has(dt) && detectedMultiplier !== 2 && detectedMultiplier !== 0) detectedMultiplier = 0.5;
                                }
                            }
                            detectedMultiplier = detectedMultiplier * baseMult;
                            const targetSelect = root.querySelector(`select[name='target-multiplier-${t.id}']`);
                            if (targetSelect) targetSelect.value = detectedMultiplier;
                        });
                        
                        const style = damageStyle[newType] || { color: "inherit" };
                        ev.currentTarget.style.color = style.color;
                    });
                });

                const doubleDice = (formula) => {
                    return formula.replace(/(\d+)d(\d+)/g, (match, num, sides) => {
                        return `${parseInt(num) * 2}d${sides}`;
                    });
                };

                const applyGwf = (f) => f.replace(/(\d+)d(\d+)/g, "$1d$2min3");

                const executeDamageRoll = async (baseFormula, isCrit, idx) => {
                    let formula = baseFormula;
                    if (isCrit) formula = doubleDice(formula);
                    
                    const isSavage = root.querySelector(`#savage-${idx}`)?.checked;
                    const isGwf = root.querySelector(`#gwf-${idx}`)?.checked;
                    const selectedType = root.querySelector(`[name='type-${idx}']`)?.value || damageParts.find(p => p.index == idx)?.type;
                    
                    if (isGwf) {
                        formula = applyGwf(formula);
                    }

                    const flavorBase = isCrit ? "Daño Crítico" : "Daño Normal";
                    const actorSpeaker = ChatMessage.getSpeaker({ actor: item?.actor });
                    
                    let extraMods = [];
                    if (isSavage) extraMods.push("Salvaje");
                    if (isGwf) extraMods.push("Armas a Dos Manos");
                    if (hasPiercer && selectedType === "piercing") extraMods.push("Perforador");
                    
                    const modsString = extraMods.length > 0 ? ` (${extraMods.join(" | ")})` : "";
                    
                    const buildPiercerButtons = (r, dmgIdx) => {
                        if (!hasPiercer || selectedType !== "piercing") return "";
                        let buttonsHtml = '<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px;">';
                        buttonsHtml += '<div style="width: 100%; font-size: 0.9em; font-weight: bold; margin-bottom: 4px; color: inherit;">Perforador:</div>';
                        r.dice.forEach(die => {
                            die.results.forEach(res => {
                                buttonsHtml += `<button type="button" class="not-dice-piercer-reroll" data-uuid="${item.uuid}" data-idx="${dmgIdx}" data-faces="${die.faces}" data-original="${res.result}" style="width: 28px; height: 28px; padding: 0; font-weight: bold; border: 1px solid var(--color-border-light-2, #ccc); border-radius: 4px; background: rgba(127,127,127,0.1); color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1em;" title="d${die.faces}">${res.result}</button>`;
                            });
                        });
                        buttonsHtml += '</div>';
                        return buttonsHtml;
                    };
                    
                    if (isSavage) {
                        const r1 = await new Roll(formula).evaluate();
                        const r2 = await new Roll(formula).evaluate();
                        
                        await r1.toMessage({ flavor: `${flavorBase}${modsString.replace(")", " - Tirada 1)")}${buildPiercerButtons(r1, idx)}`, speaker: actorSpeaker });
                        await r2.toMessage({ flavor: `${flavorBase}${modsString.replace(")", " - Tirada 2)")}${buildPiercerButtons(r2, idx)}`, speaker: actorSpeaker });
                        
                        return Math.max(r1.total, r2.total);
                    } else {
                        const r = await new Roll(formula).evaluate();
                        await r.toMessage({ flavor: `${flavorBase}${modsString}${buildPiercerButtons(r, idx)}`, speaker: actorSpeaker });
                        return r.total;
                    }
                };

                root.querySelectorAll(".roll-damage-btn").forEach(btn => {
                    btn.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        const idx = btn.dataset.index;
                        const formula = damageParts.find(p => p.index == idx)?.formula;
                        if (formula) {
                            try {
                                const total = await executeDamageRoll(formula, false, idx);
                                const inputTotal = root.querySelector(`[name='total-${idx}']`);
                                if (inputTotal) inputTotal.value = total;
                            } catch (err) { console.error("Not Dice | Error rolling normal damage", err); }
                        }
                    });
                });

                root.querySelectorAll(".roll-damage-crit-btn").forEach(btn => {
                    btn.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        const idx = btn.dataset.index;
                        const formula = damageParts.find(p => p.index == idx)?.formula;
                        if (formula) {
                            try {
                                const total = await executeDamageRoll(formula, true, idx);
                                const inputTotal = root.querySelector(`[name='total-${idx}']`);
                                if (inputTotal) inputTotal.value = total;
                            } catch (err) { console.error("Not Dice | Error rolling crit damage", err); }
                        }
                    });
                });

                globalThis._notDiceActiveAttackDialogs = globalThis._notDiceActiveAttackDialogs || {};
                globalThis._notDiceActiveAttackDialogs[item.uuid] = (totals, parts = null) => {
                    const reqBtn = root.querySelector(`#not-dice-btn-request-damage-attack`);
                    if (!document.body.contains(root)) return false; // El DOM del dialog ya no existe

                    const safeTotals = Array.isArray(totals) ? totals : [];
                    const safeParts = Array.isArray(parts) ? parts : [];
                    const assigned = new Set();
                    let createdRows = 0;
                    const normalize = (text) => String(text || "").replace(/\s+/g, "").toLowerCase();

                    const findRowContainer = () => {
                        const first = root.querySelector(".damage-part-container");
                        return first?.parentElement || null;
                    };

                    const applyValueAtIndex = (partIdx, value) => {
                        const part = damageParts[partIdx];
                        if (!part) return false;
                        const inputTotal = root.querySelector(`[name='total-${part.index}']`);
                        if (!inputTotal) return false;
                        inputTotal.value = Number.isFinite(value) ? value : 0;
                        assigned.add(partIdx);
                        return true;
                    };

                    const applyTypeAtIndex = (partIdx, incomingType) => {
                        const part = damageParts[partIdx];
                        if (!part) return false;

                        const normalizedType = String(incomingType || "").trim().toLowerCase();
                        if (!normalizedType) return false;

                        const select = root.querySelector(`select[name='type-${part.index}']`);
                        if (select) {
                            const hasOption = Array.from(select.options).some(o => o.value === normalizedType);
                            if (!hasOption) {
                                return false;
                            }
                            select.value = normalizedType;
                            select.dispatchEvent(new Event("change", { bubbles: true }));
                            part.type = normalizedType;
                            if (part.roll?.options) part.roll.options.type = normalizedType;
                            return true;
                        }

                        const hidden = root.querySelector(`input[type='hidden'][name='type-${part.index}']`);
                        if (hidden) {
                            hidden.value = normalizedType;
                            part.type = normalizedType;
                            if (part.roll?.options) part.roll.options.type = normalizedType;
                            return true;
                        }

                        return false;
                    };

                    const addIncomingPartRow = (incomingPart, totalVal) => {
                        const formula = String(incomingPart?.formula || "0").trim() || "0";
                        const type = String(incomingPart?.type || "").trim().toLowerCase();
                        const availableTypes = Array.isArray(incomingPart?.availableTypes)
                            ? incomingPart.availableTypes.map(t => String(t || "").trim().toLowerCase()).filter(Boolean)
                            : (type ? [type] : []);

                        const newIndex = damageParts.reduce((max, part) => Math.max(max, Number(part.index) || 0), -1) + 1;
                        const damageConfig = type ? CONFIG.DND5E.damageTypes[type] : null;
                        let label = damageConfig?.label || type || "Extra";
                        if (damageConfig?.icon) {
                            label = `<img src="${damageConfig.icon}" style="width: 16px; height: 16px; vertical-align: text-bottom; margin-right: 4px; border: none; filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.3));" /> ${label}`;
                        }

                        const newRoll = new DamageRoll(formula);
                        newRoll.options = newRoll.options || {};
                        if (type) newRoll.options.type = type;

                        damageParts.push({
                            index: newIndex,
                            roll: newRoll,
                            formula,
                            versatileFormula: null,
                            label,
                            type,
                            availableTypes,
                            isOffhandWithoutStyle: false
                        });

                        const style = type ? (damageStyle[type] || { color: "inherit", icon: "" }) : { color: "inherit", icon: "" };
                        const hiddenTypeInput = `<input type="hidden" name="type-${newIndex}" value="${type}">`;
                        const newRowHtml = `
                        <div class="damage-part-container" data-index="${newIndex}" style="margin-bottom: 12px; padding: 12px; border: 1px solid rgba(26,115,232,0.4); border-radius: 6px; background: rgba(26,115,232,0.08); box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                            <div style="margin-bottom: 8px; border-bottom: 1px solid var(--color-border-light-2, #ddd); padding-bottom: 4px; color:${style.color}; font-weight:bold;">${label} <span style="font-size:0.85em; opacity:0.75; margin-left:6px;">(Agregado por jugador)</span>${hiddenTypeInput}</div>
                            <div style="display:flex; gap:10px; margin-bottom: 8px;">
                                <div style="flex:1;">
                                    <label style="font-size:0.85em; color:inherit; opacity:0.7;">Fórmula:</label>
                                    <input type="text" value="${formula}" readonly style="width: 100%; padding:4px 6px; border:1px solid var(--color-border-light-2, #ccc); border-radius:4px; background:rgba(128,128,128,0.1); color:inherit; font-family:monospace; font-size:1.1em;"/>
                                </div>
                            </div>
                            <div style="display:flex; gap:10px; align-items:flex-end;">
                                <div style="flex:1;">
                                    <label style="font-size:0.85em; color:inherit; opacity:0.7;">Total Daño:</label>
                                    <input type="number" name="total-${newIndex}" value="${Number(totalVal) || 0}" style="width: 100%; height: 38px; font-size:1.6em; font-weight:bold; text-align:center; padding:4px; border:1px solid var(--color-border-light-2, #aaa); border-radius:4px; color:#ff5252; background:rgba(128,128,128,0.1);"/>
                                </div>
                            </div>
                        </div>`;

                        const rowContainer = findRowContainer();
                        if (rowContainer) {
                            rowContainer.insertAdjacentHTML("beforeend", newRowHtml);
                        }
                        createdRows += 1;
                        if (type) allDamageTypes.add(type);
                    };

                    if (safeParts.length === safeTotals.length && safeParts.length > 0) {
                        for (let i = 0; i < safeTotals.length; i++) {
                            const totalVal = Number(safeTotals[i]) || 0;
                            const incoming = safeParts[i] || {};
                            const incomingFormula = normalize(incoming.formula);
                            const incomingType = normalize(incoming.type);
                            const incomingAvailable = Array.isArray(incoming.availableTypes)
                                ? incoming.availableTypes.map(t => normalize(t)).filter(Boolean)
                                : [];

                            let matchedIdx = -1;
                            for (let j = 0; j < damageParts.length; j++) {
                                if (assigned.has(j)) continue;
                                const current = damageParts[j] || {};
                                const currentFormula = normalize(current.formula);
                                const currentType = normalize(current.type);
                                if (incomingFormula === currentFormula && incomingType === currentType) {
                                    matchedIdx = j;
                                    break;
                                }
                            }

                            // Same damage part with switched type (e.g. contundente -> fuerza)
                            if (matchedIdx < 0) {
                                for (let j = 0; j < damageParts.length; j++) {
                                    if (assigned.has(j)) continue;
                                    const current = damageParts[j] || {};
                                    const currentFormula = normalize(current.formula);
                                    if (incomingFormula !== currentFormula) continue;

                                    const currentAvailable = Array.isArray(current.availableTypes)
                                        ? current.availableTypes.map(t => normalize(t)).filter(Boolean)
                                        : [];

                                    const compatible = incomingType && (
                                        currentAvailable.includes(incomingType) ||
                                        incomingAvailable.includes(normalize(current.type))
                                    );

                                    if (compatible) {
                                        matchedIdx = j;
                                        break;
                                    }
                                }
                            }

                            if (matchedIdx >= 0) {
                                applyTypeAtIndex(matchedIdx, incomingType);
                                applyValueAtIndex(matchedIdx, totalVal);
                            } else {
                                addIncomingPartRow(incoming, totalVal);
                            }
                        }
                    } else {
                        for (let i = 0; i < safeTotals.length; i++) {
                            const totalVal = Number(safeTotals[i]) || 0;
                            if (i < damageParts.length) {
                                applyValueAtIndex(i, totalVal);
                            } else {
                                addIncomingPartRow(safeParts[i] || { formula: "0", type: "" }, totalVal);
                            }
                        }
                    }

                    if (reqBtn) {
                        reqBtn.innerHTML = createdRows > 0
                            ? "<i class='fas fa-check'></i> Daño Recibido (+nuevos tipos)"
                            : "<i class='fas fa-check'></i> Daño Recibido";
                    }
                    return true;
                };

                globalThis._notDiceUpdatePiercerTotal = globalThis._notDiceUpdatePiercerTotal || {};
                globalThis._notDiceUpdatePiercerTotal[item.uuid] = (targetIdx, oldResult, newResult) => {
                    if (!document.body.contains(root)) return false;
                    const inputTotal = root.querySelector(`[name='total-${targetIdx}']`);
                    if (inputTotal) {
                        let current = parseInt(inputTotal.value) || 0;
                        let previous = current;
                        current = current - oldResult + newResult;
                        inputTotal.value = current;
                        return { previous, current };
                    }
                    return false;
                };

                const reqBtn = root.querySelector(`#not-dice-btn-request-damage-attack`);
                if (reqBtn) {
                    reqBtn.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        const requestTargets = getDamageRequestTargets(root);
                        if (!requestTargets) {
                            ui.notifications.warn("Not Dice | No hay objetivos válidos para solicitar daño.");
                            return;
                        }

                        await sendDamageRequestToPlayer(root);
                    });
                }

                const autoRequestOnHit = game.settings.get("not-dice", "enableAutoDamageRequestOnHit");
                if (autoRequestOnHit && canRequestPlayerDamage && attackRollState && reqBtn) {
                    const hitTargetIds = getHitTargetIds();
                    if (hitTargetIds.length > 0) {
                        sendDamageRequestToPlayer(root, hitTargetIds).then((sent) => {
                            if (sent) {
                                ui.notifications.info("Not Dice | Solicitud de daño enviada automáticamente al jugador (ataque acertado).");
                            }
                        }).catch(err => {
                            console.error("Not Dice | Error en solicitud automática de daño", err);
                        });
                    }
                }
            };

            const result = await new Promise(resolve => {
                const DialogV2 = foundry?.applications?.api?.DialogV2;
                if (DialogV2) {
                    const app = new DialogV2({
                        window: { title: `Resolución: ${item.name} (v${notDiceVersion})` },
                        content: dialogContent,
                        position: { width: 440 },
                        buttons: [
                            { action: "damage", icon: "fa-solid fa-skull", label: "Aplicar Daño", default: true },
                            { action: "ok", icon: "fa-solid fa-check", label: "Confirmar sin Aplicar" }
                        ],
                        submit: async (res) => {
                            const container = app.element;
                            if (res === "damage") await applyAndResolve(container, true);
                            else if (res === "ok") await applyAndResolve(container, false);
                            resolve(rolls);
                        }
                    });
                    app.render(true).then(() => onRenderComplete(app.element));
                } else {
                    new Dialog({
                        title: `Resolución: ${item.name} (v${notDiceVersion})`,
                        content: dialogContent,
                        buttons: {
                            damage: {
                                label: "Aplicar Daño",
                                icon: "<i class='fas fa-skull'></i>",
                                callback: async html => {
                                    await applyAndResolve(html, true);
                                    resolve(rolls); 
                                }
                            },
                            ok: {
                                label: "Confirmar",
                                icon: "<i class='fas fa-check'></i>",
                                callback: async html => {
                                    await applyAndResolve(html, false);
                                    resolve(rolls);
                                }
                            }
                        },
                        default: "damage",
                        render: (html) => onRenderComplete(html),
                        close: () => resolve(rolls)
                    }, { width: 440 }).render(true);
                }
            });

            for (const r of rolls) {
                if (!r._evaluated) {
                     r._total = 0;
                     r._evaluated = true;
                     r.terms = [new foundry.dice.terms.NumericTerm({number: 0, options: {}})];
                }
            }
            return rolls;
        };

        DamageRoll.buildConfigure = async function(config, dialog, message) {
           console.log("Not Dice | Damage buildConfigure intercepted", config);
           if (!config?.options?.notDiceBypass) {
               dialog = foundry.utils.mergeObject(dialog ?? {}, { configure: false });
           }
           return originalDamageBuildConfigure.call(this, config, dialog, message);
        };

        DamageRoll.buildEvaluate = async function(rolls, rollConfig, messageConfig) {
            if (rollConfig?.options?.notDiceBypass) {
                 return originalDamageBuildEvaluate.call(this, rolls, rollConfig, messageConfig);
            }
            if (!game.user.isGM) return [];
            return notDiceEvaluateDamageRoll(rolls, rollConfig, messageConfig);
        };
    }

    /* ------------------------------------------------------------------ */
    /* Concentration Check on Damage Logic                                */
    /* ------------------------------------------------------------------ */
    Hooks.on("preUpdateActor", (actor, updateData, options, userId) => {
        if (game.user.id !== userId && !game.user.isGM && !actor.isOwner) return;

        const hpUpdate = updateData.system?.attributes?.hp;
        if (!hpUpdate) return;
        
        const oldHP = actor.system.attributes.hp.value;
        const oldTemp = actor.system.attributes.hp.temp || 0;
        const newHP = (hpUpdate.value !== undefined) ? hpUpdate.value : oldHP;
        const newTemp = (hpUpdate.temp !== undefined) ? hpUpdate.temp : oldTemp;

        const totalOld = oldHP + oldTemp;
        const totalNew = newHP + newTemp;
        const damage = totalOld - totalNew;
        
        if (damage > 0) {
            const isConcentrating = actor.statuses?.has("concentrating") || 
                                    actor.effects.some(e => e.getFlag("core", "statusId") === "concentrating" || e.name === "Concentrating");

            if (isConcentrating) {
                const dc = Math.max(10, Math.floor(damage / 2));
                let bonus = 0;
                
                const con = actor.system?.abilities?.con;
                if (con) {
                    if (typeof con.save === "number") bonus = con.save;
                    else if (typeof con.mod === "number") {
                         bonus = con.mod;
                         if (con.proficient) bonus += (actor.system.attributes?.prof || 0);
                    }
                }

                const operator = bonus >= 0 ? "+" : "";
                const content = `
                    <div style="text-align: center; font-family:inherit; padding:10px;">
                        <div style="font-size:1.1em; margin-bottom:8px; color:inherit;"><strong>${actor.name}</strong> recibió <span style="color:#ff5252; font-weight:bold;">${damage}</span> de daño.</div>
                        <div style="font-size:0.9em; color:inherit; opacity:0.8; font-style:italic; margin-bottom:12px;">Está concentrado en un hechizo.</div>
                        <div style="font-size: 1.2em; font-weight: bold; background:rgba(197,34,31,0.1); color:#ff5252; padding:6px; border-radius:6px; border:1px solid rgba(197,34,31,0.4); margin-bottom:10px;">Salvación de Constitución</div>
                        <div style="font-size: 1.2em; margin-bottom:10px; color:inherit;">CD: <span style="font-size: 1.5em; font-weight: 900; color: #ff5252;">${dc}</span></div>
                        <div style="font-size: 0.9em; color:inherit; opacity:0.8;">Bonificador CON: <strong>${operator}${bonus}</strong></div>
                    </div>
                `;

                const DialogV2 = foundry?.applications?.api?.DialogV2;
                if (DialogV2) {
                    new DialogV2({
                        window: { title: "Concentración: Chequeo Requerido" },
                        content: content,
                        position: { width: 340 },
                        buttons: [{ action: "ok", label: "Entendido", icon: "fa-solid fa-check", default: true }]
                    }).render(true);
                } else {
                    new Dialog({
                        title: "Concentración: Chequeo Requerido",
                        content: content,
                        buttons: { ok: { label: "<i class='fas fa-check'></i> Entendido", callback: () => {} } },
                        default: "ok"
                    }, { width: 340 }).render(true);
                }
            }
        }
    });
});

Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("not-dice", "hideHeader")) {
        const header = html.querySelector(".message-header");
        if (header) header.style.display = "none";
        const sender = html.querySelector(".message-sender, .whisper-to, header");
        if (sender) sender.style.display = "none";
    }
});

Hooks.on("renderChatMessage", (message, html, data) => {
    html.find(".not-dice-topple-save").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const actorId = btn.dataset.actorId;
        
        const actor = game.actors.get(actorId) || canvas.tokens.placeables.find(t => t.actor?.id === actorId)?.actor;
        if (!actor) return ui.notifications.warn("Not Dice | Actor no encontrado.");
        
        try {
            await actor.rollSavingThrow({ ability: "str", event: ev });
        } catch(e) {
            if (typeof actor.rollAbilitySave === "function") {
                await actor.rollAbilitySave("str", { event: ev });
            } else {
                console.error("Not Dice | No se pudo lanzar la salvación", e);
            }
        }
        
        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.innerHTML = "<i class='fas fa-check'></i> Salvación Realizada";
    });

    html.find(".not-dice-piercer-reroll").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const faces = btn.dataset.faces;
        const original = parseInt(btn.dataset.original);
        const uuid = btn.dataset.uuid;
        const idx = btn.dataset.idx;
        
        if (!faces) return;
        
        const rDie = await new Roll(`1d${faces}`).evaluate();
        const newDieResult = rDie.total;
        
        let newTotal = newDieResult;
        let modifier = 0;

        if (uuid && idx !== undefined && globalThis._notDiceUpdatePiercerTotal && globalThis._notDiceUpdatePiercerTotal[uuid]) {
            const resultObj = globalThis._notDiceUpdatePiercerTotal[uuid](idx, original, newDieResult);
            if (resultObj) {
                newTotal = resultObj.current;
                modifier = resultObj.previous - original;
            }
        }
        
        let displayRoll;
        if (modifier !== 0) {
            const sign = modifier >= 0 ? "+" : "-";
            displayRoll = await new Roll(`1d${faces} ${sign} ${Math.abs(modifier)}`).evaluate();
            displayRoll.terms[0].results[0].result = rDie.terms[0].results[0].result;
            displayRoll._total = newTotal;
        } else {
            displayRoll = rDie;
        }

        await displayRoll.toMessage({
            speaker: message.speaker,
            flavor: `<strong>Perforador</strong>: Relanzando d${faces}<br>Original: ${original} <i class="fas fa-arrow-right"></i> <strong style="font-size:1.2em;">${newDieResult}</strong>`
        });
        
        // Deshabilitar botón para evitar multiclips y dar feedback
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.textDecoration = "line-through";
        btn.style.color = "#ff5252";
    });
});
