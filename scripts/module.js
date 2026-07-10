// ============================================================
// not-dice | module.js
// Intercepta tiradas de ataque y daño, aplicando interfaz 
// moderna y resolución automática de maestrias/efectos.
// Compatible dinámicamente con Modo Claro y Modo Oscuro.
// ============================================================

// Helpers --------------------------------------------------------------
globalThis.notDiceGetActorEffects = (act) => {
    if (!act) return [];
    let effs = [];
    if (act.appliedEffects) {
        effs = Array.from(act.appliedEffects);
    } else if (act.effects) {
        if (act.effects.contents) {
            effs = Array.from(act.effects.contents);
        } else if (typeof act.effects.values === "function") {
            effs = Array.from(act.effects.values());
        } else {
            effs = Array.from(act.effects);
        }
    }
    return effs.map(e => Array.isArray(e) ? e[1] : e).filter(Boolean);
};

const notDiceIsSlowEffect = (e) => {
    if (!e) return false;
    const name = (e.name || e.label || "").toLowerCase();
    const flags = e.flags?.["not-dice"] || (typeof e.getFlag === "function" ? e.getFlag("not-dice") : null) || {};
    return name.includes("slow") ||
        name.includes("ralentizar") ||
        name.includes("ralentizacion") ||
        name.includes("ralentización") ||
        name.includes("frenar") ||
        name.includes("freno") ||
        name.includes("lentitud") ||
        !!flags.isSlowEffect;
};

const notDiceIsSapEffect = (e) => {
    if (!e) return false;
    const name = (e.name || e.label || "").toLowerCase();
    const flags = e.flags?.["not-dice"] || (typeof e.getFlag === "function" ? e.getFlag("not-dice") : null) || {};
    return name.includes("sap") ||
        name.includes("debilitar") ||
        name.includes("minar") ||
        !!flags.isSapEffect;
};

const notDiceIsVexEffect = (e) => {
    if (!e) return false;
    const name = (e.name || e.label || "").toLowerCase();
    const flags = e.flags?.["not-dice"] || (typeof e.getFlag === "function" ? e.getFlag("not-dice") : null) || {};
    return name.includes("vex") ||
        name.includes("molestar") ||
        name.includes("irritar") ||
        !!flags.isVexEffect;
};

const notDiceIsAttack = (subject) => {
    return subject && (subject.type === "attack" || subject.constructor?.name === "AttackActivity");
};

const notDiceFirstActiveGmId = () => {
    return game.users.find(u => u.isGM && u.active)?.id || null;
};

const notDiceMockEvent = (extra = {}) => {
    return {
        target: { closest: () => null },
        currentTarget: { closest: () => null },
        preventDefault: () => { },
        stopPropagation: () => { },
        ...extra
    };
};

/**
 * Extrae solo la parte de dados (NdX) de un arma o fórmula.
 * Para Mellar (Nick) y Hender (Cleave): solo se aplica el dado, sin modificador de característica.
 * Si el modifier es negativo, se conserva (regla de D&D5e).
 * @param {Item} item  - El item de arma (puede ser null).
 * @param {string} formula - La fórmula resuelta del roll (fallback).
 * @param {number} negativeMod - Si el mod es negativo, se añade al resultado.
 * @returns {string} Fórmula con solo los dados (y mod negativo si aplica).
 */
const notDiceExtractDiceOnly = (item, formula, negativeMod = 0) => {
    // Intento 1: leer el dado directamente de las damage parts del item
    if (item) {
        try {
            const activities = item.system?.activities;
            if (activities) {
                for (const activity of activities.values()) {
                    const parts = activity?.damage?.parts || [];
                    if (parts.length > 0) {
                        const part = parts[0];
                        let diceFormula = "";
                        if (part?.number && part?.denomination) {
                            diceFormula = `${part.number}d${part.denomination}`;
                        } else if (typeof part?.formula === "string" && part.formula) {
                            // Extraer solo la parte NdX de la formula del part
                            const diceMatch = part.formula.match(/(\d+)d(\d+)/i);
                            if (diceMatch) diceFormula = `${diceMatch[1]}d${diceMatch[2]}`;
                        }
                        if (diceFormula) {
                            return negativeMod < 0 ? `${diceFormula} - ${Math.abs(negativeMod)}` : diceFormula;
                        }
                    }
                }
            }
            // Fallback a system.damage.parts (formato legado)
            const legacyParts = item.system?.damage?.parts;
            if (Array.isArray(legacyParts) && legacyParts.length > 0) {
                const rawFormula = Array.isArray(legacyParts[0]) ? legacyParts[0][0] : legacyParts[0]?.formula;
                if (rawFormula) {
                    const diceMatch = String(rawFormula).match(/(\d+)d(\d+)/i);
                    if (diceMatch) {
                        const diceFormula = `${diceMatch[1]}d${diceMatch[2]}`;
                        return negativeMod < 0 ? `${diceFormula} - ${Math.abs(negativeMod)}` : diceFormula;
                    }
                }
            }
        } catch (e) {
            console.warn("Not Dice | notDiceExtractDiceOnly: error reading item parts", e);
        }
    }
    // Intento 2: extraer todos los NdX de la fórmula resuelta y concatenarlos
    if (formula) {
        const matches = [...String(formula).matchAll(/(\d+)d(\d+)/gi)];
        if (matches.length > 0) {
            const diceFormula = matches.map(m => `${m[1]}d${m[2]}`).join(" + ");
            return negativeMod < 0 ? `${diceFormula} - ${Math.abs(negativeMod)}` : diceFormula;
        }
    }
    // Ultimo fallback: devolver la formula original sin tocar
    return formula || "";
};

/**
 * Construye el payload de datos del ataque/hechizo para ser enviado a través de sockets
 * desde el cliente del jugador al del GM para su resolución en el panel central.
 * @param {object} rollConfig - Objeto de configuración de tirada de dnd5e.
 * @param {boolean} isDamage - Indica si es un flujo de daño directo en vez de ataque.
 * @returns {object|null} El payload estructurado o null si ocurre un error.
 */
const notDiceBuildAttackPayload = (rollConfig, isDamage = false) => {
    try {
        const subject = rollConfig?.subject;
        const item = subject?.item || (subject?.documentName === "Item" ? subject : null);
        return {
            type: "not-dice.show-attack-dialog",
            itemUuid: item?.uuid || null,
            activityId: (subject && subject !== item) ? subject.id : null,
            targetIds: Array.from(game.user.targets ?? []).map(t => t.id),
            isNickAttack: rollConfig?.isNickAttack || rollConfig?.options?.isNickAttack || rollConfig?.event?.isNickAttack || false,
            isCleaveAttack: rollConfig?.isCleaveAttack || rollConfig?.options?.isCleaveAttack || rollConfig?.event?.isCleaveAttack || false,
            notDiceVersatile: rollConfig?.options?.notDiceVersatile || rollConfig?.notDiceVersatile || null,
            senderName: game.user?.name || "Jugador",
            senderUserId: game.user?.id || null,
            targetUserId: notDiceFirstActiveGmId(),
            notDiceAutoTriggered: !isDamage
        };
    } catch (err) {
        console.error("Not Dice | Error building payload", err);
        return null;
    }
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

/**
 * Extrae las filas de daño (fórmula, tipos de daño, etc.) de un Item o Actividad de dnd5e
 * resolviendo variables de atributo nativas (como @mod) en valores numéricos.
 * @param {Item|Activity} actualItem - El Item o Actividad de origen.
 * @returns {object[]} Lista de filas de daño formateadas.
 */
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
            availableTypes: Array.isArray(availableTypes) ? availableTypes.map(t => String(t || "").trim().toLowerCase()).filter(Boolean) : [],
            weaponDamage: true
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
                    let typeList = [];
                    if (part?.types instanceof Set) typeList = Array.from(part.types);
                    else if (Array.isArray(part?.types)) typeList = part.types;
                    else if (typeof part?.types === "string") typeList = part.types.split(" ");
                    
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

const notDiceGetDamageFormulaBreakdown = (formula, isOffhandWithoutStyle, item, actor) => {
    if (!formula) return "";
    let lines = [];

    // 1. Identificar dados base
    const diceMatches = formula.match(/\b\d+d\d+/g) || [];
    if (diceMatches.length > 0) {
        lines.push(`Dado base: ${diceMatches.join(" + ")}`);
    }

    // 2. Modificador de característica
    let abilityModVal = 0;
    let abilityLabel = "";
    if (actor && item && !isOffhandWithoutStyle) {
        const abilityId = item.abilityMod || item.system?.ability || (item.system?.properties?.has("fin") ? (actor.system?.abilities?.dex?.mod > actor.system?.abilities?.str?.mod ? "dex" : "str") : "str");
        abilityModVal = actor.system?.abilities?.[abilityId]?.mod ?? 0;
        abilityLabel = CONFIG.DND5E?.abilities?.[abilityId]?.label || abilityId.toUpperCase();
    }

    // Evaluar la parte constante restante
    let totalConstant = 0;
    let cleanFormula = formula.replace(/\b\d+d\d+/g, "").trim();
    try {
        if (cleanFormula) {
            const safeExpression = cleanFormula.replace(/[^0-9+\-*/().\s]/g, "");
            if (safeExpression.trim()) {
                totalConstant = Function("return (" + safeExpression + ")")() || 0;
            }
        }
    } catch (e) {
        console.warn("Not Dice | Error parseando parte constante de la formula de daño", e);
    }

    if (abilityModVal !== 0) {
        lines.push(`Modificador de ${abilityLabel}: ${abilityModVal >= 0 ? "+" : ""}${abilityModVal}`);
    }

    const otherBonus = totalConstant - abilityModVal;
    if (otherBonus !== 0) {
        lines.push(`Otros Bonos: ${otherBonus >= 0 ? "+" : ""}${otherBonus}`);
    }

    lines.push(`Fórmula Completa: ${formula}`);
    return lines.join("\n");
};

const notDiceGetMasteryDescription = (masteryId) => {
    if (!masteryId) return "";
    const id = String(masteryId).toLowerCase();
    const descriptions = globalThis.notDiceConstants?.masteryDescriptions || {};
    return descriptions[id] || "";
};

globalThis.notDiceOpenDamageDialog = async ({
    uuid,
    itemName,
    targetIds = [],
    notDiceMultipliers = {},
    targetUserId = null,
    senderName = game.user.name,
    requestedDamageParts = null,
    isCleaveAttack = false,
    isNickAttack = false,
    masteryAlreadyUsed = false
} = {}) => {
    const item = uuid ? await fromUuid(uuid) : null;
    const actualItem = item?.item || item;

    if (!actualItem) {
        ui.notifications?.warn("Not Dice | No se pudo encontrar el objeto origen para el daño.");
        return false;
    }

    const speaker = ChatMessage.getSpeaker({ actor: actualItem.actor });
    const activeMastery = globalThis.notDiceMasteries?.getActiveMastery(actualItem) || null;
    const isMasteryDisabled = !!(isCleaveAttack || isNickAttack || masteryAlreadyUsed);
    const damageTypeLabels = CONFIG.DND5E?.damageTypes ?? {};
    const rowFaces = [4, 6, 8, 10, 12, 20];
    const dialogId = `not-dice-damage-${Math.random().toString(36).slice(2, 10)}`;
    let isCritical = false;

    const actor = actualItem?.actor;
    const hasSavageAttacker = actor && globalThis.notDiceEspeciales
        ? globalThis.notDiceEspeciales.hasSavageAttacker(actor, actualItem)
        : false;
    const isSavageUsed = hasSavageAttacker
        ? (globalThis.notDiceEspeciales?.isSavageAttackerUsed(actor) || false)
        : false;
    const hasGreatWeaponFighting = actor && globalThis.notDiceEspeciales
        ? globalThis.notDiceEspeciales.hasGreatWeaponFighting(actor, actualItem)
        : false;
    const hasPiercer = actor?.items?.some(i => {
        const n = (i.name || "").toLowerCase();
        return i.type === "feat" && (n.includes("piercer") || n.includes("perforador"));
    }) || false;
    const normalizedRequestedParts = Array.isArray(requestedDamageParts)
        ? requestedDamageParts.map((part, index) => ({
            formula: String(part?.formula || "").trim(),
            type: String(part?.type || "").trim().toLowerCase(),
            availableTypes: Array.isArray(part?.availableTypes)
                ? part.availableTypes.map(t => String(t || "").trim().toLowerCase()).filter(Boolean)
                : [],
            weaponDamage: part?.weaponDamage !== undefined ? part.weaponDamage : true
        })).filter(part => part.formula.length > 0)
        : [];

    const sourceRows = normalizedRequestedParts.length > 0
        ? normalizedRequestedParts
        : notDiceExtractDamageRows(actualItem);

    let rows = sourceRows.map((row, index) => ({
        id: `${dialogId}-${index}`,
        formula: row.formula,
        type: row.type,
        availableTypes: Array.isArray(row.availableTypes) ? row.availableTypes : [],
        weaponDamage: row.weaponDamage !== undefined ? row.weaponDamage : true
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

            ${activeMastery ? `
             <div style="display:flex; align-items:center; gap:8px; margin-top:8px; padding:8px 10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(106,27,154,0.08); ${isMasteryDisabled ? 'opacity:0.65;' : ''}; cursor:help;" title="${notDiceGetMasteryDescription(activeMastery.id)}">
                 <input type="checkbox" id="${dialogId}-mastery-cb" class="not-dice-mastery-cb" style="margin:0; cursor:pointer;" ${isMasteryDisabled ? 'disabled' : 'checked'} />
                 <label for="${dialogId}-mastery-cb" style="font-size:0.85em; font-weight:bold; color:#ba68c8; cursor:pointer; margin:0; display:flex; align-items:center; gap:4px;">
                     <i class="fas fa-crown"></i> Aplicar Maestría: ${activeMastery.label}${isMasteryDisabled ? " (Ya Usada)" : ""}
                 </label>
             </div>
             ` : ""}

            ${hasSavageAttacker ? `
            <div style="display:flex; align-items:center; gap:8px; margin-top:8px; padding:8px 10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(197,34,31,0.08); ${isSavageUsed ? 'opacity:0.65;' : ''}">
                <span style="font-size:0.85em; font-weight:bold; color:#ff5252; margin:0; display:flex; align-items:center; gap:4px;">
                    <i class="fas fa-paw"></i> Atacante Salvaje${isSavageUsed ? " (Ya Usado)" : " (Disponible)"}
                </span>
            </div>
            ` : ""}

            ${hasGreatWeaponFighting ? `
            <div style="display:flex; align-items:center; gap:8px; margin-top:8px; padding:8px 10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(26,115,232,0.08); opacity:0.85;">
                <input type="checkbox" id="${dialogId}-gwf-cb" class="not-dice-gwf-cb" style="display:none;" checked />
                <span style="font-size:0.85em; font-weight:bold; color:#1a73e8; margin:0; display:flex; align-items:center; gap:4px;">
                    <i class="fas fa-gavel"></i> Armas a Dos Manos (Activo)
                </span>
            </div>
            ` : ""}

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
            .map((row, index) => ({
                formula: String(row.formula || "").trim(),
                type: String(row.type || "").trim(),
                weaponDamage: !!row.weaponDamage
            }))
            .filter(row => row.formula.length > 0);
    };

    const executeDamageRoll = async (baseFormula, damageType, root, dmgIdx = 0) => {
        let formula = baseFormula;
        if (isCritical) formula = doubleDice(formula);

        const rootEl = root instanceof HTMLElement ? root : (root?.[0] || root);
        const isGwf = rootEl?.querySelector?.(".not-dice-gwf-cb")?.checked ?? false;

        if (isGwf && globalThis.notDiceEspeciales) {
            formula = globalThis.notDiceEspeciales.applyGreatWeaponFightingFormula(formula);
        }

        const flavorBase = isCritical ? "Daño Crítico" : "Daño Normal";
        const damageLabel = damageType ? (damageTypeLabels[damageType]?.label || damageType) : "Sin tipo";

        let extraMods = [];
        if (isGwf) extraMods.push("Armas a Dos Manos");
        if (hasPiercer && damageType === "piercing") extraMods.push("Perforador");

        const modsString = extraMods.length > 0 ? ` (${extraMods.join(" | ")})` : "";

        const buildPiercerButtons = (r, dmgIdx) => {
            if (!hasPiercer || damageType !== "piercing") return "";
            let buttonsHtml = '<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px;">';
            buttonsHtml += '<div style="width: 100%; font-size: 0.9em; font-weight: bold; margin-bottom: 4px; color: inherit;">Perforador:</div>';
            r.dice.forEach(die => {
                die.results.forEach(res => {
                    buttonsHtml += `<button type="button" class="not-dice-piercer-reroll" data-uuid="${actualItem.uuid}" data-idx="${dmgIdx}" data-faces="${die.faces}" data-original="${res.result}" data-damage-type="${damageType}" style="width: 28px; height: 28px; padding: 0; font-weight: bold; border: 1px solid var(--color-border-light-2, #ccc); border-radius: 4px; background: rgba(127,127,127,0.1); color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1em;" title="d${die.faces}">${res.result}</button>`;
                });
            });
            buttonsHtml += '</div>';
            return buttonsHtml;
        };

        const buildSavageButton = (r, dmgIdx) => {
            const firstWeaponPartIdx = rows.findIndex(row => row.weaponDamage !== false);
            if (!hasSavageAttacker || isSavageUsed || rows[dmgIdx]?.weaponDamage === false || (firstWeaponPartIdx !== -1 && firstWeaponPartIdx != dmgIdx)) return "";
            return `<div style="margin-top:8px;"><button type="button" class="not-dice-savage-reroll" data-uuid="${actualItem.uuid}" data-idx="${dmgIdx}" data-formula="${btoa(formula)}" data-flavor="${btoa(flavorBase)}" data-damagelabel="${btoa(damageLabel)}" data-mods="${btoa(modsString)}" data-original="${r.total}" data-damage-type="${damageType}" style="width:100%; font-weight:bold; padding:4px; border:1px solid rgba(197,34,31,0.5); border-radius:4px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer;"><i class="fas fa-paw"></i> Atacante Salvaje (relanza el daño)</button></div>`;
        };

        const rollObj = new Roll(formula, actualItem.getRollData());
        if (globalThis.notDiceApplyColorset) globalThis.notDiceApplyColorset(rollObj, damageType);
        const roll = await rollObj.evaluate();
        await roll.toMessage({
            speaker,
            flavor: `<strong>${flavorBase}</strong> • ${actualItem.name || itemName || "Daño"} <span style="opacity:0.75;">(${damageLabel})</span>${modsString}${buildPiercerButtons(roll, dmgIdx)}${buildSavageButton(roll, dmgIdx)}`
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
        let dmgIdx = 0;
        for (const row of damageRows) {
            const total = await executeDamageRoll(row.formula, row.type, root, dmgIdx++);
            totals.push(total);
        }

        const rootEl = root instanceof HTMLElement ? root : (root?.[0] || root);
        const applyMastery = rootEl?.querySelector?.(".not-dice-mastery-cb")?.checked ?? false;
        const applySavage = rootEl?.querySelector?.(".not-dice-savage-cb")?.checked ?? false;
        const applyGwf = rootEl?.querySelector?.(".not-dice-gwf-cb")?.checked ?? false;

        const payload = {
            type: "not-dice.show-spell-damage",
            itemUuid: uuid,
            targetIds,
            notDiceMultipliers,
            senderName: game.user.name,
            targetUserId: gmUserId,
            preCalculatedTotals: totals,
            preCalculatedParts: damageRows,
            applyMastery: applyMastery,
            applySavage: applySavage,
            applyGwf: applyGwf,
            isCleaveAttack: isCleaveAttack,
            isNickAttack: isNickAttack,
            isCritical: isCritical
        };

        if (gmUserId === game.user.id) {
            notDiceHandleAttackSocket(payload);
        } else {
            game.socket.emit("module.not-dice", payload);
        }

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

/**
 * Intercepta y detiene la tirada de daño en el cliente del jugador y la redirige
 * al GM a través de un mensaje de socket (`not-dice.show-attack-dialog`).
 * @param {Roll[]} rolls - Colección de rolls de dnd5e.
 * @param {object} rollConfig - Configuración de la tirada.
 * @returns {Promise<Roll[]>} Retorna un array vacío para evitar que se resuelva en el cliente local del jugador.
 */
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

const notDiceExecuteGrazeDamage = async (attackerId, targetIds, abilityMod, damageType, weaponName) => {
    const attacker = game.actors.get(attackerId) || canvas.tokens.placeables.find(t => t.actor?.id === attackerId)?.actor;
    const attackerName = attacker ? attacker.name : "Atacante";

    const damageSummaryLines = [];

    for (const tId of targetIds) {
        const targetToken = canvas.tokens.placeables.find(t => t.id === tId);
        const targetActor = targetToken?.actor || game.actors.get(tId);
        if (!targetActor) continue;

        // Aplicar daño
        const finalValues = [{ value: abilityMod, type: damageType }];
        await targetActor.applyDamage(finalValues, { ignore: true });

        damageSummaryLines.push(`<li><strong>${targetActor.name}</strong> recibe <span style="font-weight:bold; color:#ba68c8;">${abilityMod}</span> de daño (${damageType}) por Rozar.</li>`);
    }

    if (damageSummaryLines.length > 0) {
        const whisperUsers = game.users.filter(u => u.isGM || (attacker && attacker.testUserPermission(u, "OWNER"))).map(u => u.id);
        await ChatMessage.create({
            whisper: whisperUsers,
            speaker: { alias: "Not Dice" },
            content: `
                <div style="font-family:inherit; padding:8px;">
                    <h4 style="margin:0 0 6px 0; color:#ba68c8;"><i class="fas fa-bullseye"></i> Maestría: Rozar Aplicado</h4>
                    <p style="font-size:0.9em; margin:0 0 6px 0;"><strong>${attackerName}</strong> aplicó Rozar con <strong>${weaponName}</strong>:</p>
                    <ul style="font-size:0.85em; margin:0; padding-left:16px;">
                        ${damageSummaryLines.join("")}
                    </ul>
                </div>
            `
        });
    }
};

/**
 * Manejador principal de los eventos socket entrantes del módulo.
 * Permite al GM recibir y procesar solicitudes de ataque de los jugadores en tiempo real.
 * @param {object} data - Datos enviados a través del socket.
 * @returns {Promise<void>}
 */
const notDiceHandleAttackSocket = async (data) => {
    if (!data || !game.user.isGM) return;

    // Respeta destinatario específico si viene indicado
    if (data.targetUserId && data.targetUserId !== game.user.id) return;

    if (data.type === "not-dice.apply-graze") {
        try {
            const item = data.weaponUuid ? await fromUuid(data.weaponUuid) : null;
            const activity = item?.system?.activities?.find(a => a.type === "save" || a.type === "damage" || a.type === "attack")
                || (item?.system?.activities?.size > 0 ? item.system.activities.first() : null)
                || item;

            if (!item || !activity) return ui.notifications?.warn("Not Dice | No se pudo recuperar el arma/actividad para Rozar.");

            await activity.rollDamage({
                event: notDiceMockEvent({ targetIds: data.targetIds }),
                options: {
                    notDiceAutoTriggered: true,
                    notDicePreCalculatedTotals: [data.abilityMod],
                    notDicePreCalculatedParts: [{ formula: data.abilityMod.toString(), type: data.damageType }],
                    notDiceMultipliers: {},
                    notDiceApplyMastery: false
                }
            });
            ui.notifications?.info(`Not Dice | Abriendo caja de resolución de Rozar para el GM.`);
        } catch (e) {
            console.error("Not Dice | Error en apply-graze socket handler", e);
        }
        return;
    }

    if (data.type === "not-dice.show-spell-save-result") {
        Hooks.callAll("notDiceSaveResult", data);
        return;
    }

    // Solo log sencillo cuando un jugador inicia ataque
    if (data.type === "not-dice.attack-log") {
        console.log(`Not Dice | Ataque de ${data.userName || "Jugador"}: ${data.attacker} con ${data.itemName} -> Objetivos: ${data.targets}`);
        return;
    }

    if (data.type === "not-dice.chat-attack-mode") {
        try {
            const handlers = globalThis._notDiceAttackModeHandlers || {};
            const messageHandler = data.messageId ? handlers[`msg:${data.messageId}`] : null;
            const itemHandler = data.itemUuid ? handlers[data.itemUuid] : null;
            const handler = messageHandler || itemHandler;

            if (!handler) {
                ui.notifications?.warn("Not Dice | No se encontro una caja de ataque activa para aplicar ventaja/desventaja.");
                return;
            }

            await handler(data.mode === "disadvantage" ? "disadvantage" : "advantage");
        } catch (err) {
            console.error("Not Dice | Error aplicando modo de ataque desde chat", err);
        }
        return;
    }

    if (data.type === "not-dice.update-savage-total") {
        const { uuid, idx, total } = data;
        if (globalThis._notDiceUpdateSavageTotal && globalThis._notDiceUpdateSavageTotal[uuid]) {
            globalThis._notDiceUpdateSavageTotal[uuid](idx, total);
            ui.notifications?.info(`Not Dice | Atacante Salvaje: daño actualizado por jugador.`);
        }
        return;
    }

    if (data.type === "not-dice.update-piercer-total") {
        const { uuid, idx, original, newDieResult } = data;
        if (globalThis._notDiceUpdatePiercerTotal && globalThis._notDiceUpdatePiercerTotal[uuid]) {
            globalThis._notDiceUpdatePiercerTotal[uuid](idx, original, newDieResult);
            ui.notifications?.info(`Not Dice | Perforador: daño actualizado por jugador.`);
        }
        return;
    }

    if (data.type === "not-dice.show-spell-damage") {
        try {
            if (globalThis._notDiceActiveAttackDialogs && globalThis._notDiceActiveAttackDialogs[data.itemUuid]) {
                const wasUpdated = globalThis._notDiceActiveAttackDialogs[data.itemUuid](
                    data.preCalculatedTotals,
                    data.preCalculatedParts,
                    data.applyMastery,
                    data.applySavage,
                    data.applyGwf,
                    data.isCritical
                );
                if (wasUpdated) {
                    ui.notifications?.info(`Not Dice | Daño actualizado por ${data.senderName || "jugador"}.`);
                    return;
                }
            }

            const item = data.itemUuid ? await fromUuid(data.itemUuid) : null;
            const activity = item?.system?.activities?.find(a => a.type === "save" || a.type === "damage" || a.type === "attack") || (item?.type === "save" || item?.type === "spell" ? item : null);

            if (!item || !activity) return ui.notifications?.warn("Not Dice | No se pudo recuperar la actividad para el daño del hechizo.");

            await activity.rollDamage({
                event: notDiceMockEvent({ targetIds: data.targetIds }),
                options: {
                    notDicePreCalculatedTotals: data.preCalculatedTotals,
                    notDicePreCalculatedParts: data.preCalculatedParts,
                    notDiceMultipliers: data.notDiceMultipliers,
                    notDiceApplyMastery: data.applyMastery,
                    notDiceApplySavage: data.applySavage,
                    notDiceApplyGwf: data.applyGwf,
                    isCleaveAttack: data.isCleaveAttack,
                    isCritical: data.isCritical
                },
                isNickAttack: data.isNickAttack
            });
            ui.notifications?.info(`Not Dice | Daño de hechizo enviado por ${data.senderName || "jugador"}.`);
        } catch (e) {
            console.error("Not Dice | Error en show-spell-damage", e);
        }
        return;
    }

    if (data.type !== "not-dice.show-attack-dialog") return;

    if (!data.targetIds || data.targetIds.length === 0) {
        ui.notifications?.warn(`Not Dice | ${data.senderName} intentó atacar sin seleccionar un objetivo.`);
        return;
    }

    try {
        const item = data.itemUuid ? await fromUuid(data.itemUuid) : null;
        const activity = data.activityId ? item?.system?.activities?.get(data.activityId) : item?.system?.activities?.find(a => a.type === "damage" || a.type === "attack");
        if (!item || !activity) return ui.notifications?.warn("Not Dice | No se pudo recuperar la actividad del ataque.");

        await activity.rollDamage({
            event: notDiceMockEvent({ targetIds: data.targetIds, senderUserId: data.senderUserId }),
            options: {
                notDiceAutoTriggered: data.notDiceAutoTriggered !== false,
                isCleaveAttack: data.isCleaveAttack,
                notDiceVersatile: data.notDiceVersatile
            },
            isNickAttack: data.isNickAttack
        });
        ui.notifications?.info(`Not Dice | Resolviendo daño enviado por ${data.senderName || "jugador"}.`);
    } catch (err) {
        console.error("Not Dice | Error inyectando popup directo", err);
    }
};

globalThis.notDiceHandleAttackSocket = notDiceHandleAttackSocket;

Hooks.once("ready", () => {
    if (!globalThis._notDiceSocketReady) {
        globalThis._notDiceSocketReady = true;
        game.socket.on("module.not-dice", notDiceHandleAttackSocket);
    }
    console.log("Not Dice | Module Ready");

    // --- D20Roll (Attack) Patching ---
    const D20Roll = CONFIG.Dice.D20Roll;
    if (D20Roll) {
        const originalBuildConfigure = D20Roll.buildConfigure;
        const originalBuildEvaluate = D20Roll.buildEvaluate;

        D20Roll.buildConfigure = async function (config, dialog, message) {
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

        const notDicePromptVersatile = (item, activity = null) => {
            return new Promise(resolve => {
                if (!item || !item.system?.properties?.has?.("ver")) {
                    resolve("1h");
                    return;
                }

                // Resolver la actividad por defecto si no es provista
                const act = activity || item.system.activities?.find(a => a.type === "attack" || a.type === "damage") || item.system.activities?.first();
                const firstPart = act?.damage?.parts?.[0];

                const baseFormula = firstPart?.formula ||
                    (firstPart?.number && firstPart?.denomination ? `${firstPart.number}d${firstPart.denomination}` : "") ||
                    item.system.damage?.parts?.[0]?.[0] ||
                    "1d8";
                const baseDie = baseFormula.match(/\d+d\d+/)?.[0] || "1d8";

                // Buscar el dado versátil nativo del item, si no, aplicar la escala de dados clásica
                let versatileDie = null;
                const itemVersatile = item.system.damage?.versatile;
                if (typeof itemVersatile === "string" && itemVersatile.trim()) {
                    const match = itemVersatile.match(/\d+d\d+/);
                    if (match) versatileDie = match[0];
                }
                if (!versatileDie) {
                    versatileDie = (baseDie.includes("d6") ? baseDie.replace("d6", "d8") :
                        (baseDie.includes("d8") ? baseDie.replace("d8", "d10") :
                            (baseDie.includes("d10") ? baseDie.replace("d10", "d12") : baseDie)));
                }

                const DialogV2 = foundry?.applications?.api?.DialogV2;
                const dialogContent = `
                    <div style="text-align:center; padding:10px 5px; font-family:inherit;">
                        <h3 style="margin: 0 0 15px 0; font-size:1.15em; border-bottom:1px solid rgba(128,128,128,0.2); padding-bottom:8px; color:inherit; font-weight:bold; letter-spacing:0.5px;">Elige Empuñadura para ${item.name}</h3>
                        <div style="display:flex; justify-content:center; gap:20px; padding: 5px 0;">
                            <button class="not-dice-versatile-select-btn" data-hands="1h" style="width:130px; height:150px; border:2px solid var(--color-border-light-2, #aaa); border-radius:10px; cursor:pointer; background-image: url('/modules/not-dice/icons/1mano.png'); background-size:cover; background-position:center; position:relative; overflow:hidden; transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s; box-shadow: 0 4px 8px rgba(0,0,0,0.2); padding:0; outline: none;">
                                <div style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.75); color:#fff; padding:8px 4px; font-weight:bold; font-size:0.95em; line-height:1.2; text-shadow:1px 1px 2px #000; border-top:1px solid rgba(255,255,255,0.15);">
                                    1 Mano<br/><span style="font-size:0.85em; font-weight:bold; color:#ffca28;">(${baseDie})</span>
                                </div>
                            </button>
                            <button class="not-dice-versatile-select-btn" data-hands="2h" style="width:130px; height:150px; border:2px solid var(--color-border-light-2, #aaa); border-radius:10px; cursor:pointer; background-image: url('/modules/not-dice/icons/2manos.png'); background-size:cover; background-position:center; position:relative; overflow:hidden; transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s; box-shadow: 0 4px 8px rgba(0,0,0,0.2); padding:0; outline: none;">
                                <div style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.75); color:#fff; padding:8px 4px; font-weight:bold; font-size:0.95em; line-height:1.2; text-shadow:1px 1px 2px #000; border-top:1px solid rgba(255,255,255,0.15);">
                                    2 Manos<br/><span style="font-size:0.85em; font-weight:bold; color:#ffca28;">(${versatileDie})</span>
                                </div>
                            </button>
                        </div>
                    </div>
                    <style>
                        .not-dice-versatile-select-btn:hover {
                            transform: scale(1.05);
                            border-color: #ffca28 !important;
                            box-shadow: 0 6px 12px rgba(255, 202, 40, 0.35) !important;
                        }
                        /* Ocultar botones de footer de DialogV2 */
                        .dialog-buttons, nav.dialog-buttons, footer.dialog-buttons {
                            display: none !important;
                        }
                    </style>
                `;

                let dialogApp;
                let choiceMade = false;
                const bindEvents = (htmlElement) => {
                    htmlElement.querySelectorAll(".not-dice-versatile-select-btn").forEach(btn => {
                        btn.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            const choice = btn.dataset.hands;
                            choiceMade = true;
                            resolve(choice);
                            if (dialogApp && typeof dialogApp.close === "function") {
                                dialogApp.close();
                            }
                        });
                    });
                };

                if (DialogV2) {
                    dialogApp = new DialogV2({
                        window: { title: "Arma Versátil" },
                        content: dialogContent,
                        position: { width: 340 },
                        buttons: [
                            { action: "cancel", label: "Cancelar" }
                        ]
                    });
                    dialogApp.addEventListener("close", () => {
                        if (!choiceMade) resolve(null);
                    }, { once: true });
                    dialogApp.render(true).then(() => {
                        bindEvents(dialogApp.element);
                    });
                } else {
                    dialogApp = new Dialog({
                        title: "Arma Versátil",
                        content: dialogContent,
                        buttons: {},
                        render: (html) => {
                            const root = html[0] || html;
                            bindEvents(root);
                        },
                        close: () => {
                            if (!choiceMade) resolve(null);
                        }
                    }, { width: 340 });
                    dialogApp.render(true);
                }
            });
        };

        D20Roll.buildEvaluate = async function (rolls, rollConfig, messageConfig) {
            console.log("Not Dice | D20 buildEvaluate intercepted", rolls);
            const isAttack = notDiceIsAttack(rollConfig.subject);

            if (isAttack) {
                // Cooldown logic
                const now = Date.now();
                globalThis._notDiceAttackCooldown = globalThis._notDiceAttackCooldown || { lastAttackTime: 0, attackCount: 0, timeoutId: null };
                const cd = globalThis._notDiceAttackCooldown;

                if (now - cd.lastAttackTime > 10000) {
                    cd.attackCount = 0;
                }

                let requiredWait = 0;
                if (cd.attackCount === 1) requiredWait = 3000;
                else if (cd.attackCount === 2) requiredWait = 5000;
                else if (cd.attackCount >= 3) requiredWait = 10000;

                if (cd.attackCount > 0 && now - cd.lastAttackTime < requiredWait) {
                    const remaining = Math.ceil((requiredWait - (now - cd.lastAttackTime)) / 1000);
                    ui.notifications.warn(`Not Dice | ¡Demasiado rápido! Debes esperar ${remaining} segundo(s) antes de volver a atacar.`);
                    return [];
                }

                cd.lastAttackTime = now;
                cd.attackCount++;

                if (cd.timeoutId) clearTimeout(cd.timeoutId);
                cd.timeoutId = setTimeout(() => {
                    cd.attackCount = 0;
                }, 10000);

                const targets = game.user.targets;
                if (!targets || targets.size === 0) {
                    ui.notifications?.warn("Not Dice | Debes seleccionar al menos un objetivo para atacar.");
                    return [];
                }
            }

            // Player branch: solo empaqueta y envía al GM
            if (isAttack && !game.user.isGM) {
                const item = rollConfig.subject?.item || rollConfig.subject;
                if (item?.system?.properties?.has?.("ver")) {
                    const choice = await notDicePromptVersatile(item, rollConfig.subject);
                    if (!choice) {
                        console.log("Not Dice | Versatile weapon dialog cancelled. Aborting player attack.");
                        return [];
                    }
                    rollConfig.options = rollConfig.options || {};
                    rollConfig.options.notDiceVersatile = choice;
                }
                return notDiceHandlePlayerAttack(rolls, rollConfig);
            }

            if (isAttack) {
                console.log("Not Dice | Auto-resolving Attack Roll (Silent).");
                const item = rollConfig.subject?.item || rollConfig.subject;
                let versatileChoice = null;
                if (item?.system?.properties?.has?.("ver")) {
                    versatileChoice = await notDicePromptVersatile(item, rollConfig.subject);
                    if (!versatileChoice) {
                        console.log("Not Dice | Versatile weapon dialog cancelled. Aborting GM attack.");
                        return [];
                    }
                    rollConfig.options = rollConfig.options || {};
                    rollConfig.options.notDiceVersatile = versatileChoice;
                }

                for (const roll of rolls) {
                    const total = 20;
                    const numericTerm = new foundry.dice.terms.NumericTerm({ number: total });
                    numericTerm._evaluated = true;
                    roll.terms = [numericTerm];
                    roll._total = total;
                    roll._evaluated = true;

                    // Solo el GM debe disparar el daño automático y mostrar popup.
                    if (game.user.isGM) {
                        setTimeout(() => {
                            if (rollConfig.subject && rollConfig.subject.rollDamage) {
                                console.log("Not Dice | Triggering Auto-Damage Roll (GM)");
                                const isCleave = rollConfig.isCleaveAttack || rollConfig.options?.isCleaveAttack || rollConfig.event?.isCleaveAttack || false;
                                rollConfig.subject.rollDamage({
                                    event: rollConfig.event,
                                    options: {
                                        notDiceAutoTriggered: true,
                                        isCleaveAttack: isCleave,
                                        notDiceVersatile: versatileChoice
                                    },
                                    isNickAttack: rollConfig.isNickAttack || rollConfig.options?.isNickAttack || rollConfig.event?.isNickAttack || false,
                                    isCleaveAttack: isCleave
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

        /**
         * Intercepta la evaluación y resolución del daño de dnd5e (DamageRoll.buildEvaluate)
         * para inyectar y pintar el panel unificado de resolución de daño en el cliente del GM,
         * evaluando ventajas, aplicando modificadores, maestracías, dotes y reduciendo daño.
         * @param {DamageRoll[]} rolls - Las instancias de Roll de daño creadas por dnd5e.
         * @param {object} rollConfig - Configuración del lanzamiento.
         * @param {object} messageConfig - Configuración del mensaje de chat final.
         * @returns {Promise<DamageRoll[]>} Las tiradas modificadas y evaluadas de forma final.
         */
        const notDiceEvaluateDamageRoll = async (rolls, rollConfig, messageConfig) => {
            console.log("Not Dice | Damage buildEvaluate intercepted", rolls);

            const doubleDice = (formula) => {
                return formula.replace(/(\d+)d(\d+)/g, (match, num, sides) => {
                    return `${parseInt(num) * 2}d${sides}`;
                });
            };

            const isSpellCrit = !!(rollConfig.isCritical || rollConfig.options?.isCritical || rollConfig.event?.isCritical);
            let isAttackCrit = false;

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
            const isNickAttack = rollConfig.isNickAttack || rollConfig.options?.isNickAttack || rollConfig.event?.isNickAttack || false;
            const actor = rollConfig.subject?.actor || rollConfig.subject?.item?.actor;
            const hasTwoWeaponStyle = actor?.items?.some(i =>
                i.system?.identifier === "two-weapon-fighting" ||
                i.name === "Two-Weapon Fighting" ||
                (i.name.toLowerCase().includes("combate con dos armas") && i.type === "feat")
            );
            const isOffhandWithoutStyle = isNickAttack && !hasTwoWeaponStyle;
            if (isOffhandWithoutStyle) console.log("Not Dice | Offhand Attack without Style - Removing Ability Mod from formula.");

            const isCleaveAttack = rollConfig.isCleaveAttack || rollConfig.options?.isCleaveAttack || rollConfig.event?.isCleaveAttack || false;
            if (isCleaveAttack) console.log("Not Dice | Cleave Attack - Removing positive Ability Mod from formula.");

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

            // --- Habilidades Especiales (Maestro en Armas Pesadas, etc.) ---
            if (globalThis.notDiceEspeciales) {
                globalThis.notDiceEspeciales.applyGreatWeaponMaster(rolls, actor, item, rollConfig, hasForcedParts);
            }

            // --- Detect Mastery ---
            const activeMastery = globalThis.notDiceMasteries?.getActiveMastery(item, actor) || null;

            // --- Detect Guiding Bolt / Saeta Guía ---
            let isGuidingBolt = false;
            if (item) {
                const spellName = (item.name || "").toLowerCase();
                if (spellName.includes("guiding bolt") || spellName.includes("saeta guía") || spellName.includes("saeta guia")) {
                    isGuidingBolt = true;
                }
            }

            // Function to calculate versatile damage scaling
            const scaleVersatile = (formula) => {
                const itemVersatile = item?.system?.damage?.versatile;
                if (typeof itemVersatile === "string" && itemVersatile.trim()) {
                    const vDie = itemVersatile.match(/\d+d\d+/)?.[0];
                    if (vDie) {
                        const baseDie = formula.match(/\d+d\d+/)?.[0];
                        if (baseDie) {
                            return formula.replace(baseDie, vDie);
                        }
                    }
                }
                if (formula.includes("d6")) return formula.replace("d6", "d8");
                if (formula.includes("d8")) return formula.replace("d8", "d10");
                if (formula.includes("d10")) return formula.replace("d10", "d12");
                return null;
            };

            // --- Process All Rolls ---
            const damageParts = [];
            const allDamageTypes = new Set();
            const activityDamageParts = rollConfig?.subject?.damage?.parts || [];
            const baseWeaponPartsCount = item ? notDiceExtractDamageRows(item).length : 1;

            for (let i = 0; i < rolls.length; i++) {
                const roll = rolls[i];
                const forcedPart = hasForcedParts ? forcedParts[i] : null;
                let originalFormula = forcedPart?.formula ? String(forcedPart.formula) : roll.formula;

                if (isOffhandWithoutStyle || isCleaveAttack) {
                    const abilityId = item?.abilityMod || item?.system?.ability || (item?.system?.properties?.has("fin") ? (actor?.system?.abilities?.dex?.mod > actor?.system?.abilities?.str?.mod ? "dex" : "str") : "str");
                    const mod = actor?.system?.abilities?.[abilityId]?.mod ?? 0;
                    const negativeMod = mod < 0 ? mod : 0;
                    originalFormula = notDiceExtractDiceOnly(item, originalFormula, negativeMod);
                    console.log("Not Dice | Formula limpiada para Nick/Cleave:", originalFormula);
                }

                let versatileFormula = null;
                if (item?.system?.properties?.has("ver")) {
                    versatileFormula = scaleVersatile(originalFormula);
                }

                if (i === 0 && item?.system?.properties?.has("ver") && (rollConfig.options?.notDiceVersatile === "2h" || rollConfig.notDiceVersatile === "2h")) {
                    if (versatileFormula) {
                        originalFormula = versatileFormula;
                    }
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
                    if (!availableTypes.includes(damageTypeKey)) availableTypes.push(damageTypeKey);
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
                    isOffhandWithoutStyle: isOffhandWithoutStyle,
                    isCritical: isSpellCrit || isAttackCrit,
                    weaponDamage: hasForcedParts && forcedPart?.weaponDamage !== undefined ? forcedPart.weaponDamage : (i < baseWeaponPartsCount)
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

                    const badges = [];
                    if (dr) badges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(176,96,0,0.15); color:#ffb300; padding:2px 6px; border-radius:8px; border:1px solid rgba(176,96,0,0.3); font-weight:bold;"><i class="fas fa-shield-alt"></i> Res: ${dr}</span>`);
                    if (di) badges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(197,34,31,0.15); color:#ff5252; padding:2px 6px; border-radius:8px; border:1px solid rgba(197,34,31,0.3); font-weight:bold;"><i class="fas fa-ban"></i> Inm: ${di}</span>`);
                    if (dv) badges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(11,87,208,0.15); color:#4fc3f7; padding:2px 6px; border-radius:8px; border:1px solid rgba(11,87,208,0.3); font-weight:bold;"><i class="fas fa-heart-broken"></i> Vul: ${dv}</span>`);

                    const hasHAM = t.actor.items?.some(i => {
                        const n = (i.name || "").toLowerCase();
                        return i.type === "feat" && (n.includes("heavy armor master") || n.includes("maestro en armadura pesada"));
                    });
                    if (hasHAM) badges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(106,27,154,0.15); color:#ba68c8; padding:2px 6px; border-radius:8px; border:1px solid rgba(106,27,154,0.3); font-weight:bold;"><i class="fas fa-chess-rook"></i> Armadura Pesada (-Prof)</span>`);

                    const notDiceStatusES = globalThis.notDiceConstants.statusES;
                    const activeStatuses = t.actor?.statuses ?? new Set();
                    const conditionLabels = [];
                    for (const statusId of activeStatuses) { conditionLabels.push(notDiceStatusES[statusId] || statusId); }
                    if (conditionLabels.length > 0) {
                        badges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(255,82,82,0.15); color:#ff5252; padding:2px 6px; border-radius:8px; border:1px solid rgba(255,82,82,0.3); font-weight:bold;"><i class="fas fa-exclamation-circle"></i> ${conditionLabels.join(", ")}</span>`);
                    }

                    targetHtml += `
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding: 8px; border-radius: 6px; ${borderStyle} ${bgStyle}">
                        <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                            ${tokenImgHtml}
                            <div style="display:flex; flex-direction:column; gap:4px; min-width:0; flex:1;">
                                <span style="font-weight:bold; font-size:1.1em; color:inherit; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${t.name}">${t.name}</span>
                                ${ac !== undefined ? `<div><span style="font-size:1em; font-weight:bold; background:rgba(128,128,128,0.2); color:inherit; padding:2px 6px; border-radius:4px; border:1px solid var(--color-border-light-2, #ccc); box-shadow:0 1px 1px rgba(0,0,0,0.1);" title="Clase de Armadura">CA ${ac}</span></div>` : ""}
                            </div>
                        </div>
                        ${badges.length > 0 ? `
                        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0;">
                            ${badges.join("")}
                        </div>` : ""}
                    </div>`;
                }
                targetHtml += "</div>";
            } else {
                targetHtml = "<div style='margin-bottom: 10px; font-style: italic; color: inherit; opacity:0.6; text-align:center; padding:10px; border:1px dashed var(--color-border-light-2, #ccc); border-radius:6px;'>No hay objetivo seleccionado</div>";
            }

            // --- Gather Attack Info ---
            let attackHtml = "";
            let attackRollState = null;
            let attackRollMessageId = null;

            const getActorEffects = globalThis.notDiceGetActorEffects;

            const attackerName = item?.actor?.name || "";
            const attackerEffects = getActorEffects(item?.actor || actor);
            const hasSapEffect = attackerEffects.some(e => {
                const eName = (e.name || e.label || "").toLowerCase();
                return eName.includes("sap") || eName.includes("debilitar") || eName.includes("minar");
            });

            const hasVexAdvantage = targets.some(t => {
                const targetActor = t.actor || t;
                const targetEffects = getActorEffects(targetActor);
                return targetEffects.some(e => {
                    const eName = (e.name || e.label || "").toLowerCase();
                    return (eName.includes("vex") || eName.includes("molestar")) &&
                        eName.includes(`(${attackerName.toLowerCase()})`);
                });
            });

            const hasGuidingBoltAdvantage = targets.some(t => {
                const targetActor = t.actor || t;
                const targetEffects = getActorEffects(targetActor);
                return targetEffects.some(e => {
                    const eName = (e.name || e.label || "").toLowerCase();
                    return eName.includes("saeta guía") || eName.includes("saeta guia") || eName.includes("guiding bolt");
                });
            });

            console.log("Not Dice | Debug Vex/Sap:", {
                attackerName,
                targets: targets.map(t => t.name),
                attackerEffects: attackerEffects.map(e => e.name || e.label),
                hasSapEffect,
                hasVexAdvantage,
                hasGuidingBoltAdvantage
            });

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

                let notices = [];
                if (hasVexAdvantage) {
                    notices.push(`<div style="font-size:0.78em; color:#4caf50; font-weight:bold; margin-top:2px; display:flex; align-items:center; justify-content:center; gap:4px;"><i class="fas fa-exclamation-triangle"></i> Debe tener Ventaja por Molestar (Vex)</div>`);
                }
                if (hasGuidingBoltAdvantage) {
                    notices.push(`<div style="font-size:0.78em; color:#ffb300; font-weight:bold; margin-top:2px; display:flex; align-items:center; justify-content:center; gap:4px;"><i class="fas fa-exclamation-triangle"></i> Debe tener Ventaja por Saeta Guía</div>`);
                }
                if (hasSapEffect) {
                    notices.push(`<div style="font-size:0.78em; color:#ff5252; font-weight:bold; margin-top:2px; display:flex; align-items:center; justify-content:center; gap:4px;"><i class="fas fa-exclamation-triangle"></i> Debe tener Desventaja por Debilitar (Sap)</div>`);
                }
                const noticeHtml = notices.join("");

                const showAdvHighlight = hasVexAdvantage || hasGuidingBoltAdvantage;
                const advBtnStyle = showAdvHighlight
                    ? "width:34px; height:34px; border:2px solid #4caf50; border-radius:6px; background:rgba(19,115,51,0.25); color:#4caf50; cursor:pointer; flex-shrink:0; box-shadow: 0 0 8px rgba(76,175,80,0.5); transform: scale(1.05);"
                    : "width:34px; height:34px; border:1px solid rgba(19,115,51,0.4); border-radius:6px; background:rgba(19,115,51,0.1); color:#4caf50; cursor:pointer; flex-shrink:0;";

                const disadvBtnStyle = hasSapEffect
                    ? "width:34px; height:34px; border:2px solid #ff5252; border-radius:6px; background:rgba(197,34,31,0.25); color:#ff5252; cursor:pointer; flex-shrink:0; box-shadow: 0 0 8px rgba(255,82,82,0.5); transform: scale(1.05);"
                    : "width:34px; height:34px; border:1px solid rgba(197,34,31,0.4); border-radius:6px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer; flex-shrink:0;";

                const contentHtml = `<div style="display:flex; flex-direction:column; gap:4px; align-items:stretch; justify-content:center; width:100%;">
                    <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
                        <button type="button" class="not-dice-attack-disadvantage-btn" title="Convertir a Desventaja" style="${disadvBtnStyle}"><i class="fas fa-arrow-down"></i></button>
                        <div class="not-dice-attack-roll-result" style="flex:1; min-width:0; font-size: 1.3em; line-height:1.2;">
                            ${modeBadge}<span style="color:inherit; opacity:0.7;">d20:</span> ${diceHtml}${modifierHtml} = <span style="font-size: 1.6em; font-weight:900;">${total}</span>
                        </div>
                        <button type="button" class="not-dice-attack-advantage-btn" title="Convertir a Ventaja" style="${advBtnStyle}"><i class="fas fa-arrow-up"></i></button>
                    </div>
                    ${noticeHtml}
                </div>`;
                const boxStyle = `margin-bottom: 12px; color: ${visual.text}; text-align: center; border: 1px solid ${visual.border}; background: ${visual.bg}; border-radius: 6px; padding: 8px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.05);`;

                return { contentHtml, boxStyle, selectedD20, total };
            };

            const isAttackAct = rollConfig.subject?.type === "attack";
            const isSaveAct = rollConfig.subject?.type === "save";
            const isDamageAct = rollConfig.subject?.type === "damage";

            if (isAttackAct || isSaveAct || isDamageAct) {
                const attackImg = item.img || "icons/svg/sword.svg";
                let headerLabel = "Ataque";
                let headerValue = "";
                const headerBadges = [];

                if (isAttackAct) {
                    const toHit = item.labels?.toHit || "";
                    let isProficient = false;
                    if (item?.system?.proficient) {
                        isProficient = true;
                    } else if (actor) {
                        if (actor.type === "npc") {
                            isProficient = true;
                        } else if (item) {
                            const weaponType = item.system?.type?.value;
                            const baseItem = item.system?.type?.baseItem || item.system?.baseItem;
                            const weaponProfs = actor.system?.traits?.weaponProf?.value;
                            if (weaponProfs) {
                                const profsArray = Array.isArray(weaponProfs)
                                    ? weaponProfs
                                    : (weaponProfs instanceof Set ? Array.from(weaponProfs) : Object.values(weaponProfs || {}));
                                if (weaponType === "simpleM" || weaponType === "simpleR") {
                                    if (profsArray.includes("sim")) isProficient = true;
                                } else if (weaponType === "martialM" || weaponType === "martialR") {
                                    if (profsArray.includes("mar")) isProficient = true;
                                }
                                if (!isProficient && baseItem && profsArray.includes(baseItem)) {
                                    isProficient = true;
                                }
                            }
                        }
                    }
                    const profBadge = isProficient ? `<span style="display:inline-block; font-size:0.75em; background:rgba(19,115,51,0.15); color:#4caf50; padding:3px 8px; border-radius:12px; border:1px solid rgba(19,115,51,0.3); font-weight:bold;"><i class="fas fa-check-circle"></i> Competencia</span>` : `<span style="display:inline-block; font-size:0.75em; background:rgba(127,127,127,0.15); color:inherit; opacity:0.8; padding:3px 8px; border-radius:12px; border:1px solid rgba(127,127,127,0.3);">Sin Competencia</span>`;
                    headerBadges.push(profBadge);

                    if (activeMastery) {
                        headerBadges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(106,27,154,0.15); color:#ba68c8; padding:3px 8px; border-radius:12px; border:1px solid rgba(106,27,154,0.3); font-weight:bold;"><i class="fas fa-crown"></i> Maestría: ${activeMastery.label}</span>`);
                    }

                    if (hasSapEffect) {
                        headerBadges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(197,34,31,0.15); color:#ff5252; padding:3px 8px; border-radius:12px; border:1px solid rgba(197,34,31,0.3); font-weight:bold;"><i class="fas fa-arrow-down"></i> Desventaja (Debilitado)</span>`);
                    }

                    if (hasVexAdvantage) {
                        headerBadges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(19,115,51,0.15); color:#4caf50; padding:3px 8px; border-radius:12px; border:1px solid rgba(19,115,51,0.3); font-weight:bold;"><i class="fas fa-arrow-up"></i> Ventaja (Molestar)</span>`);
                    }

                    if (hasGuidingBoltAdvantage) {
                        headerBadges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(176,96,0,0.15); color:#ffb300; padding:3px 8px; border-radius:12px; border:1px solid rgba(176,96,0,0.3); font-weight:bold;"><i class="fas fa-star"></i> Ventaja (Saeta Guía)</span>`);
                    }

                    headerLabel = "Ataque";
                    headerValue = toHit;
                } else {
                    const saveAct = rollConfig.subject?.type === "save" ? rollConfig.subject : (item.system?.activities?.contents?.find(a => a.type === "save") || null);
                    if (saveAct) {
                        headerLabel = "Salvación";
                        headerValue = saveAct.labels?.save || "";
                        if (!headerValue && saveAct.save?.ability) {
                            const abilityLabel = CONFIG.DND5E?.abilities?.[saveAct.save.ability]?.label || saveAct.save.ability.toUpperCase();
                            const dcVal = saveAct.save.dc?.value || item.actor?.system?.attributes?.spelldc || "";
                            headerValue = `CD ${dcVal} ${abilityLabel}`;
                        }
                        headerBadges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(26,115,232,0.15); color:#1a73e8; padding:3px 8px; border-radius:12px; border:1px solid rgba(26,115,232,0.3); font-weight:bold;"><i class="fas fa-shield-alt"></i> Salvación</span>`);
                    } else {
                        headerLabel = isDamageAct ? "Daño" : "Conjuro";
                        headerValue = item.name || "";
                        headerBadges.push(`<span style="display:inline-block; font-size:0.75em; background:rgba(230,124,115,0.15); color:#d50000; padding:3px 8px; border-radius:12px; border:1px solid rgba(230,124,115,0.3); font-weight:bold;"><i class="fas fa-bolt"></i> Hechizo</span>`);
                    }
                }

                // --- Simultaneous Attack Roll ---
                let attackRollHtml = "";
                let attackRollBoxStyle = "";
                const isAutoTriggered = rollConfig?.notDiceAutoTriggered ||
                    rollConfig?.options?.notDiceAutoTriggered ||
                    rollConfig?.event?.notDiceAutoTriggered ||
                    rollConfig?.options?.event?.notDiceAutoTriggered ||
                    false;
                if (isAttackAct && game.settings.get("not-dice", "enableSimultaneousRoll") && isAutoTriggered) {
                    try {
                        let d20Term = "1d20";
                        let rollMode = "normal";

                        let formula = `${d20Term}`;
                        let parts = [];
                        if (headerValue) {
                            let cleanToHit = headerValue.trim();
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
                        const attackChatMessage = await r.toMessage({
                            speaker: actorSpeaker,
                            flavor: `<strong>Tirada de Ataque: ${item?.name || "Ataque"}</strong>`,
                            flags: {
                                "not-dice": {
                                    attackRoll: true,
                                    itemUuid: item?.uuid || null
                                }
                            }
                        });
                        attackRollMessageId = attackChatMessage?.id || null;

                        const activeDie = r.terms?.[0];
                        const dieResults = activeDie?.results ?? [];
                        const originalD20 = dieResults[0]?.result ?? 0;
                        const extraD20 = dieResults[1]?.result ?? null;

                        const selectedD20 = rollMode === "advantage"
                            ? Math.max(originalD20, extraD20 ?? originalD20)
                            : rollMode === "disadvantage"
                                ? Math.min(originalD20, extraD20 ?? originalD20)
                                : originalD20;

                        if (selectedD20 === 20) {
                            isAttackCrit = true;
                            for (const p of damageParts) {
                                p.isCritical = true;
                            }
                        }

                        attackRollState = {
                            mode: rollMode,
                            originalD20: originalD20,
                            extraD20: extraD20,
                            bonus: r.total - (activeDie?.total ?? originalD20)
                        };

                        const display = buildAttackRollDisplay(attackRollState);
                        attackRollHtml = display.contentHtml;
                        attackRollBoxStyle = display.boxStyle;
                    } catch (err) {
                        console.error("Not Dice | Failed simultaneous roll", err);
                    }
                }

                const attackerImg = item?.actor?.img || "icons/svg/mystery-man.svg";
                const attackDescId = `hover-desc-${Math.random().toString(36).substring(2, 9)}`;
                attackHtml = `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; padding:10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(127,127,127,0.1); box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <!-- Left: Attacker -->
                    <div style="display:flex; flex-direction:column; align-items:center; gap:4px; width:64px; flex-shrink:0; border-right:1px solid var(--color-border-light-2, #ccc); padding-right:12px;">
                        <img src="${attackerImg}" style="width:48px; height:48px; border:1px solid var(--color-border-light-2, #aaa); border-radius:50%; object-fit:cover; box-shadow:0 1px 2px rgba(0,0,0,0.2);">
                        <span style="font-size:0.7em; font-weight:bold; color:inherit; opacity:0.8; text-align:center; line-height:1; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${attackerName}">${attackerName}</span>
                    </div>
                    
                    <!-- Middle: Weapon & Attack Info -->
                    <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0; position:relative;">
                        <img src="${attackImg}" class="not-dice-attack-img-hover" data-desc-id="${attackDescId}" style="width:48px; height:48px; border:1px solid var(--color-border-light-2, #aaa); border-radius:6px; object-fit:cover; flex-shrink:0; cursor:pointer;" title="Haz clic para ver la descripción traducida">
                        <div id="${attackDescId}" class="not-dice-attack-hover-box" style="display:none; position:absolute; top:55px; left:0; width:320px; background:rgba(20, 20, 20, 0.96); border:1px solid #ffca28; border-radius:8px; padding:10px; box-shadow:0 6px 16px rgba(0,0,0,0.5); z-index:100; font-size:0.9em; color:#f0f0f0; max-height:220px; overflow-y:auto; line-height:1.4; text-shadow:1px 1px 1px rgba(0,0,0,0.8);">
                            <span style="color: #bbb;"><em>Traduciendo descripción... <i class="fas fa-spinner fa-spin"></i></em></span>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:1em; color:inherit; opacity:0.8; line-height:1.2;">${headerLabel}</div>
                            <div style="font-weight:900; font-size:1.4em; color:inherit; line-height:1.2;">${headerValue}</div>
                        </div>
                    </div>

                    <!-- Right: Badges in rows -->
                    ${headerBadges.length > 0 ? `
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0;">
                        ${headerBadges.join("")}
                    </div>` : ""}
                </div>`;

                if (attackRollHtml) {
                    attackHtml += `<div class="not-dice-attack-roll-box" style="${attackRollBoxStyle}">${attackRollHtml}</div>`;
                }
            }



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

            const hasSavageAttacker = globalThis.notDiceEspeciales?.hasSavageAttacker(actor, item) || false;
            const isSavageUsed = hasSavageAttacker && (globalThis.notDiceEspeciales?.isSavageAttackerUsed(actor) || false);
            const hasGreatWeaponFighting = globalThis.notDiceEspeciales?.hasGreatWeaponFighting(actor, item) || false;

            const hasPiercer = actor?.items?.some(i => {
                const n = (i.name || "").toLowerCase();
                return i.type === "feat" && (n.includes("piercer") || n.includes("perforador"));
            }) || false;


            let masteryAlreadyUsed = false;
            if (activeMastery && actor) {
                let flagKey = "";
                if (activeMastery.id === "cleave") flagKey = `lastCleave-${actor.id}`;
                else if (activeMastery.id === "nick") flagKey = `lastNick-${actor.id}`;

                if (flagKey) {
                    const lastTurn = actor.getFlag("not-dice", flagKey);
                    const currentTurn = game.combat
                        ? `${game.combat.id}-${game.combat.round ?? 0}-${game.combat.turn ?? 0}`
                        : Date.now();

                    masteryAlreadyUsed = game.combat
                        ? lastTurn === currentTurn
                        : (typeof lastTurn === "number" && (Date.now() - lastTurn) < 6000);
                }
            }

            let damageInputsHtml = "";
            for (const part of damageParts) {
                let specialModsHtml = "";
                if (part.index === 0 && activeMastery) {
                    const initialApplyMastery = rollConfig.options?.hasOwnProperty("notDiceApplyMastery")
                        ? rollConfig.options.notDiceApplyMastery
                        : true;
                    const isMasteryDisabled = !!(isCleaveAttack || isNickAttack || masteryAlreadyUsed);
                    const disabledAttr = isMasteryDisabled ? "disabled" : "";
                    const checkedAttr = (initialApplyMastery && !isMasteryDisabled) ? "checked" : "";
                    specialModsHtml += `
                    <div style="display:flex; justify-content:center; align-items:center; gap:6px; margin-bottom: 4px; padding: 2px 6px; background: rgba(106,27,154,0.08); border: 1px solid rgba(106,27,154,0.3); border-radius: 4px; width: 100%; ${isMasteryDisabled ? 'opacity:0.65;' : ''}; cursor:help;" title="${notDiceGetMasteryDescription(activeMastery.id)}">
                        <input type="checkbox" id="mastery-cb" class="mastery-cb" style="margin:0; transform:scale(0.85); cursor:pointer;" ${checkedAttr} ${disabledAttr}>
                        <label for="mastery-cb" style="font-size:0.8em; color:#ba68c8; cursor:pointer; font-weight:bold; letter-spacing: 0.5px; margin:0;"><i class="fas fa-crown"></i> ${activeMastery.label}${isMasteryDisabled ? " (Usada)" : ""}</label>
                    </div>`;
                }
                if (hasSavageAttacker && part.weaponDamage !== false) {
                    specialModsHtml += `
                    <div style="display:flex; justify-content:center; align-items:center; gap:4px; margin-bottom: 4px; padding: 2px 6px; background: rgba(197,34,31,0.08); border: 1px solid rgba(197,34,31,0.3); border-radius: 4px; width: 100%; ${isSavageUsed ? 'opacity:0.65;' : ''}" title="ATACANTE SALVAJE">
                        <span style="font-size:0.8em; color:#ff5252; font-weight:bold; letter-spacing: 0.5px; margin:0; display:flex; align-items:center; gap:4px;"><i class="fas fa-paw"></i> Atacante Salvaje${isSavageUsed ? " (Usado)" : ""}</span>
                    </div>`;
                }
                if (hasGreatWeaponFighting) {
                    specialModsHtml += `
                    <div style="display:flex; justify-content:center; align-items:center; gap:4px; margin-bottom: 4px; padding: 2px 6px; background: rgba(26,115,232,0.08); border: 1px solid rgba(26,115,232,0.3); border-radius: 4px; width: 100%; opacity:0.85;" title="ESTILO: COMBATE CON ARMAS A DOS MANOS">
                        <input type="checkbox" id="gwf-${part.index}" class="gwf-cb" data-index="${part.index}" style="display:none;" checked>
                        <span style="font-size:0.8em; color:#1a73e8; font-weight:bold; letter-spacing: 0.5px; margin:0; display:flex; align-items:center; gap:4px;"><i class="fas fa-gavel"></i> Armas a Dos Manos (Activo)</span>
                    </div>`;
                }

                if (specialModsHtml) specialModsHtml = `<div style="margin-bottom:6px; display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:4px;">${specialModsHtml}</div>`;
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
                <div class="damage-part-container" data-index="${part.index}" style="margin-bottom: 8px; padding: 6px 8px; border: 1px solid var(--color-border-light-2, #ddd); border-radius: 6px; background: rgba(127,127,127,0.05); box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; border-bottom: 1px dashed var(--color-border-light-2, #ddd); padding-bottom: 4px;">
                        <div>${labelHtml}</div>
                        <div style="font-size:1.25em; font-weight:800; opacity:0.95; font-family:monospace; background:rgba(128,128,128,0.12); padding:4px 12px; border-radius:4px; border:1px solid var(--color-border-light-1, #888); text-align:right; cursor:help;" title="${notDiceGetDamageFormulaBreakdown(part.formula, part.isOffhandWithoutStyle, item, actor)}">
                            ${part.formula} ${part.isOffhandWithoutStyle ? '<span style="color:#ff5252;" title="Sin mod. de característica">*</span>' : ''}
                        </div>
                    </div>
                    
                    ${specialModsHtml}
                    
                    <div style="display:flex; align-items:center; gap:6px; width:100%;">
                        <!-- 1. Input de daño -->
                        <input type="number" name="total-${part.index}" value="${rollConfig.options?.notDicePreCalculatedTotals?.[part.index] !== undefined ? rollConfig.options.notDicePreCalculatedTotals[part.index] : '0'}" style="width:110px; flex-shrink:0; height:32px; font-size:1.3em; font-weight:bold; text-align:center; padding:2px; border:1px solid var(--color-border-light-2, #aaa); border-radius:4px; color:#ff5252; background:rgba(128,128,128,0.1); box-sizing:border-box; margin:0;" title="Total de daño base"/>
                        
                        <!-- 2. Multiplicador(es) -->
                        ${(() => {
                        let partTargetMultipliersHtml = "";
                        if (targets.length > 0) {
                            if (targets.length === 1) {
                                const t = targets[0];
                                const traits = t.actor?.system?.traits;
                                let detectedMultiplier = 1;
                                if (traits) {
                                    if (traits.di?.value?.has(currentDamageType)) detectedMultiplier = 0;
                                    else if (traits.dv?.value?.has(currentDamageType)) detectedMultiplier = 2;
                                    else if (traits.dr?.value?.has(currentDamageType)) detectedMultiplier = 0.5;
                                }
                                const baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                                detectedMultiplier = detectedMultiplier * baseMult;

                                const selectName = `target-multiplier-${t.id}-part-${part.index}`;
                                partTargetMultipliersHtml = `
                                    <select name="${selectName}" style="width:65px; height:32px; border:1px solid var(--color-border-light-2, #ccc); background:rgba(128,128,128,0.1); color:inherit; border-radius:4px; cursor:pointer; font-weight:bold; font-size:1.05em; flex-shrink:0; text-align:center; box-sizing:border-box; margin:0; padding:0;" title="Multiplicador para ${t.name}">
                                        ${multiplierOptions.map(o => `<option value="${o.val}" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                                    </select>`;
                            } else {
                                partTargetMultipliersHtml += `<div style="display:flex; flex-direction:column; gap:2px; flex-shrink:0;">`;
                                for (const t of targets) {
                                    const traits = t.actor?.system?.traits;
                                    let detectedMultiplier = 1;
                                    if (traits) {
                                        if (traits.di?.value?.has(currentDamageType)) detectedMultiplier = 0;
                                        else if (traits.dv?.value?.has(currentDamageType)) detectedMultiplier = 2;
                                        else if (traits.dr?.value?.has(currentDamageType)) detectedMultiplier = 0.5;
                                    }
                                    const baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                                    detectedMultiplier = detectedMultiplier * baseMult;

                                    const selectName = `target-multiplier-${t.id}-part-${part.index}`;
                                    partTargetMultipliersHtml += `
                                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8em; background: rgba(128,128,128,0.08); padding: 1px 4px; border-radius: 4px; border:1px solid var(--color-border-light-2, #eee); min-height:30px; gap:4px; max-width:140px; box-sizing:border-box;">
                                            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;" title="${t.name}">${t.name}</span>
                                            <select name="${selectName}" style="width:55px; height:24px; padding:0; border:1px solid var(--color-border-light-2, #ccc); background:transparent; color:inherit; border-radius:3px; cursor:pointer; font-weight:bold; font-size:0.95em; flex-shrink:0; text-align:center; box-sizing:border-box; margin:0;">
                                                ${multiplierOptions.map(o => `<option value="${o.val}" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                                            </select>
                                        </div>`;
                                }
                                partTargetMultipliersHtml += `</div>`;
                            }
                        }
                        return partTargetMultipliersHtml;
                    })()}

                        <!-- 3. Botones de tirar dados (Normal y Crítico, estirados, en columnas si hay múltiples objetivos) -->
                        <div style="display:flex; ${targets.length > 1 ? 'flex-direction:column;' : ''} gap:4px; flex:1;">
                            <button type="button" class="roll-damage-btn" data-index="${part.index}" style="flex:1; height:32px; padding:0 6px; border:1px solid var(--color-border-light-2, #bbb); border-radius:4px; background:var(--color-bg-option, rgba(127,127,127,0.1)); color:inherit; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px; font-weight:bold; font-size:0.85em; box-sizing:border-box; margin:0;" title="Tirar Daño Normal"><i class="fas fa-dice" style="color:inherit; opacity:0.8; font-size:1.1em;"></i>Normal</button>
                            <button type="button" class="roll-damage-crit-btn" data-index="${part.index}" style="flex:1; height:32px; padding:0 6px; border:1px solid #d32f2f; border-radius:4px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px; font-weight:bold; font-size:0.85em; box-sizing:border-box; margin:0;" title="Tirar Daño Crítico"><i class="fas fa-dice-d20" style="font-size:1.1em;"></i>Crítico</button>
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
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--color-border-light-2, #ccc); padding-bottom: 4px; margin-bottom: 10px;">
                        <h3 style="margin:0; font-size:1.1em; color:inherit; opacity:0.9;">Desglose de Daño</h3>
                        <div style="position:relative;">
                            <button type="button" class="not-dice-add-gm-damage-btn" style="width:24px; height:24px; padding:0; line-height:24px; border-radius:4px; border:1px solid var(--color-border-light-2, #aaa); background:rgba(0,0,0,0.05); cursor:pointer;" title="Agregar daño extra"><i class="fas fa-plus"></i></button>
                        </div>
                    </div>
                    <div id="not-dice-damage-list" style="max-height: ${damageParts.length > 2 ? '220px' : '380px'}; overflow-y: auto; padding-right: 6px;">
                        ${damageInputsHtml}
                    </div>
                    ${requestDamageBtnHtml}
                </div>
            `;

            const applyAndResolve = async (container, isDamage = false) => {
                const root = container instanceof HTMLElement ? container : container[0];

                // --- Consume All Sap Mastery Effects ---
                const sapEffects = getActorEffects(item.actor).filter(e => {
                    const eName = (e.name || e.label || "").toLowerCase();
                    const flags = e.flags?.["not-dice"] || e.getFlag?.("not-dice") || {};
                    return eName.includes("sap") || eName.includes("debilitar") || eName.includes("minar") || !!flags.isSapEffect;
                });
                if (sapEffects.length > 0) {
                    const idsToDelete = sapEffects.map(e => e.id);
                    await item.actor.deleteEmbeddedDocuments("ActiveEffect", idsToDelete);
                    ui.notifications.info(`Not Dice | Desventajas de Debilitar Consumidas (${sapEffects.length})`);
                }

                const currentTargets = resolveTargets();
                if (currentTargets.length > 0) {
                    const attackerName = item.actor.name;
                    for (const t of currentTargets) {
                        if (!t.actor) continue;
                        const vexEffect = getActorEffects(t.actor).find(e => {
                            const eName = (e.name || e.label || "").toLowerCase();
                            const flags = e.flags?.["not-dice"] || e.getFlag?.("not-dice") || {};
                            const isVex = eName.includes("vex") || eName.includes("molestar") || !!flags.isVexEffect;
                            const isFromAttacker = eName.includes(`(${attackerName.toLowerCase()})`) || (flags.appliedActorId && flags.appliedActorId === item.actor.id);
                            return isVex && isFromAttacker;
                        });
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



                // Gather values and update rolls
                const totalValues = [];
                for (const part of damageParts) {
                    const inputEl = root.querySelector(`[name='total-${part.index}']`);
                    const inputVal = inputEl?.value || "0";
                    let val = parseInt(inputVal);
                    if (isNaN(val)) val = 0;

                    let selectedType = root.querySelector(`[name='type-${part.index}']`)?.value;
                    if (!selectedType) selectedType = part.type;

                    const roll = part.roll;
                    if (roll && roll.terms) {
                        roll._total = val;
                        roll._evaluated = true;
                        if (roll.options) roll.options.type = selectedType;

                        const options = roll.terms[0]?.options ?? {};
                        const newTerm = new foundry.dice.terms.NumericTerm({ number: val, options: options });
                        newTerm._evaluated = true;
                        roll.terms = [newTerm];
                    }

                    totalValues.push({ value: val, type: selectedType, index: part.index });
                }

                console.log("Not Dice | [DEBUG] damageParts:", damageParts.map(p => ({ index: p.index, type: p.type, formula: p.formula })));
                console.log("Not Dice | [DEBUG] totalValues:", totalValues);

                // Apply Damage
                if (isDamage) {
                    ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({actor: item?.actor}),
                        content: `<div style="padding:4px; font-family:monospace; font-size:0.85em; background:rgba(0,0,0,0.8); color:#0f0; border-radius:4px;">
                            <strong>DEBUG APPLY_DAMAGE:</strong><br/>
                            ${totalValues.map(tv => `Idx:${tv.index} Type:${tv.type} Val:${tv.value}`).join("<br/>")}
                        </div>`,
                        whisper: ChatMessage.getWhisperRecipients("GM")
                    });
                    const targetsLocal = resolveTargets();
                    const damageSummaryLines = [];

                    const applyMasteryChecked = root.querySelector("#mastery-cb")?.checked ?? false;
                    if (applyMasteryChecked && activeMastery) {
                        if (activeMastery.id === "sap") {
                            for (const t of targetsLocal) {
                                if (t.actor) {
                                    await globalThis.notDiceMasteries.applySapEffect(t.actor, item.actor, item);
                                }
                            }
                        } else if (activeMastery.id === "topple" || activeMastery.label.toLowerCase().includes("topple") || activeMastery.label.toLowerCase().includes("derribar")) {
                            for (const t of targetsLocal) {
                                if (t.actor) {
                                    await globalThis.notDiceMasteries.runToppleSave(t.actor, item.actor, item);
                                }
                            }
                        } else if (activeMastery.id === "push" || activeMastery.label.toLowerCase().includes("push") || activeMastery.label.toLowerCase().includes("empujar")) {
                            for (const t of targetsLocal) {
                                if (t.actor) {
                                    await globalThis.notDiceMasteries.runPushEffect(t.actor, item.actor, item);
                                }
                            }
                        } else if (activeMastery.id === "cleave" || activeMastery.label.toLowerCase().includes("cleave") || activeMastery.label.toLowerCase().includes("hender")) {
                            const masteryFlagKey = `lastCleave-${item.actor.id}`;
                            const lastTurn = item.actor.getFlag("not-dice", masteryFlagKey);
                            const currentTurn = game.combat
                                ? `${game.combat.id}-${game.combat.round ?? 0}-${game.combat.turn ?? 0}`
                                : Date.now();

                            const alreadyUsed = game.combat
                                ? lastTurn === currentTurn
                                : (typeof lastTurn === "number" && (Date.now() - lastTurn) < 6000);

                            if (alreadyUsed) {
                                ui.notifications.warn(`Not Dice | Ya activaste Hender (Cleave) este turno.`);
                            } else {
                                await item.actor.setFlag("not-dice", masteryFlagKey, currentTurn);
                                for (const t of targetsLocal) {
                                    if (t.actor) {
                                        await globalThis.notDiceMasteries.runCleaveEffect(t, item.actor, item);
                                    }
                                }
                            }
                        } else if (activeMastery.id === "nick" || activeMastery.label.toLowerCase().includes("nick") || activeMastery.label.toLowerCase().includes("mellar")) {
                            const masteryFlagKey = `lastNick-${item.actor.id}`;
                            const lastTurn = item.actor.getFlag("not-dice", masteryFlagKey);
                            const currentTurn = game.combat
                                ? `${game.combat.id}-${game.combat.round ?? 0}-${game.combat.turn ?? 0}`
                                : Date.now();

                            const alreadyUsed = game.combat
                                ? lastTurn === currentTurn
                                : (typeof lastTurn === "number" && (Date.now() - lastTurn) < 6000);

                            if (alreadyUsed) {
                                ui.notifications.warn(`Not Dice | Ya activaste Mellar (Nick) este turno.`);
                            } else {
                                const hasDualWielder = item.actor?.items?.some(i =>
                                    i.system?.identifier === "dual-wielder" ||
                                    i.name?.toLowerCase().includes("dual wielder") ||
                                    i.name?.toLowerCase().includes("combatiente a dos armas") ||
                                    i.name?.toLowerCase().includes("combatiente con dos armas")
                                ) || false;

                                const nickWeaponItem = item.actor?.itemTypes?.weapon?.find(w =>
                                    w.id !== item.id &&
                                    w.system.equipped &&
                                    (w.system.properties?.has("lgt") || (hasDualWielder && !w.system.properties?.has("2h")))
                                );

                                if (nickWeaponItem) {
                                    await item.actor.setFlag("not-dice", masteryFlagKey, currentTurn);
                                    const firstTarget = targetsLocal.find(t => t.actor);
                                    if (firstTarget) {
                                        await globalThis.notDiceMasteries.runNickEffect(firstTarget, item.actor, nickWeaponItem);
                                    }
                                } else {
                                    ui.notifications.warn(`Not Dice | No tienes un arma secundaria válida equipada para Mellar.`);
                                }
                            }
                        } else if (activeMastery.id !== "nick" && activeMastery.id !== "graze" && !activeMastery.label.toLowerCase().includes("rozar") && !activeMastery.label.toLowerCase().includes("graze")) {
                            for (const t of targetsLocal) {
                                if (t.actor) {
                                    let effectName = `Maestría: ${activeMastery.label} (${item.actor.name})`;
                                    if (activeMastery.id === "vex" || activeMastery.label.toLowerCase().includes("molestar")) {
                                        effectName = `Maestría: Molestar (${item.actor.name})`;
                                    }

                                    const existingEffects = globalThis.notDiceGetActorEffects(t.actor);
                                    const hasExisting = existingEffects.some(e => e.name === effectName || e.name === `Maestría: Vex (${item.actor.name})`);
                                    if (hasExisting) {
                                        console.log(`Not Dice | ${t.name} ya tiene el efecto ${effectName}.`);
                                        continue;
                                    }

                                    const isVex = (activeMastery.id === "vex" || activeMastery.label.toLowerCase().includes("molestar"));
                                    const isSlow = (activeMastery.id === "slow" ||
                                        activeMastery.label.toLowerCase().includes("ralentizar") ||
                                        activeMastery.label.toLowerCase().includes("frenar") ||
                                        activeMastery.label.toLowerCase().includes("lentitud"));

                                    const effectData = {
                                        name: effectName,
                                        img: item.img || "icons/svg/aura.svg",
                                        icon: item.img || "icons/svg/aura.svg",
                                        origin: item.uuid,
                                        duration: {},
                                        flags: {
                                            "not-dice": {
                                                isVexEffect: isVex,
                                                isSlowEffect: isSlow,
                                                appliedRound: game.combat?.round ?? 0,
                                                appliedTurn: game.combat?.turn ?? 0,
                                                appliedActorId: item.actor.id
                                            }
                                        }
                                    };

                                    if (isVex || isSlow) {
                                        effectData.duration.rounds = 99; // Evitar expiración prematura por el turno del objetivo
                                        if (activeMastery.id === "slow" ||
                                            activeMastery.label.toLowerCase().includes("ralentizar") ||
                                            activeMastery.label.toLowerCase().includes("frenar") ||
                                            activeMastery.label.toLowerCase().includes("lentitud")) {

                                            const hasExistingSlowWithChanges = existingEffects.some(e => {
                                                return notDiceIsSlowEffect(e) && e.changes && e.changes.length > 0;
                                            });

                                            if (!hasExistingSlowWithChanges) {
                                                effectData.changes = [
                                                    { key: "system.attributes.movement.walk", mode: 2, value: "-10" },
                                                    { key: "system.attributes.movement.fly", mode: 2, value: "-10" },
                                                    { key: "system.attributes.movement.swim", mode: 2, value: "-10" },
                                                    { key: "system.attributes.movement.climb", mode: 2, value: "-10" },
                                                    { key: "system.attributes.movement.burrow", mode: 2, value: "-10" }
                                                ];
                                            } else {
                                                effectData.changes = [];
                                            }
                                        }
                                    } else {
                                        effectData.duration.rounds = 1;
                                    }

                                    if (game.combat) {
                                        effectData.duration.startRound = game.combat.round;
                                        effectData.duration.startTurn = game.combat.turn;
                                    } else {
                                        effectData.duration.startTime = game.time.worldTime;
                                        effectData.duration.seconds = 6;
                                    }

                                    await t.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
                                    ui.notifications.info(`Not Dice | Maestría Aplicada: ${activeMastery.label} -> ${t.name}`);
                                }
                            }
                        }
                    }

                    if (isGuidingBolt) {
                        for (const t of targetsLocal) {
                            if (t.actor) {
                                const gbEffectData = {
                                    name: `Saeta Guía (${item.actor.name})`,
                                    img: item.img || "icons/svg/sun.svg",
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
                            const hasHeavyArmorMaster = t.actor.items?.some(i => {
                                const n = (i.name || "").toLowerCase();
                                return i.type === "feat" && (n.includes("heavy armor master") || n.includes("maestro en armadura pesada"));
                            });

                            let finalValues = [];
                            if (isDamage) {
                                for (const tv of totalValues) {
                                    const partMultRaw = root.querySelector(`[name='target-multiplier-${t.id}-part-${tv.index}']`)?.value || "1";
                                    let partMult = parseFloat(partMultRaw);
                                    if (isNaN(partMult)) partMult = 1;
                                    finalValues.push({ ...tv, value: Math.floor(tv.value * partMult) });
                                }
                            } else {
                                finalValues = totalValues;
                            }

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

                            // Group damages by type to prevent Foundry from ignoring duplicate types
                            const groupedValuesMap = new Map();
                            for (const fv of finalValues) {
                                const tKey = fv.type || "none";
                                if (groupedValuesMap.has(tKey)) {
                                    groupedValuesMap.get(tKey).value += (Number(fv.value) || 0);
                                } else {
                                    groupedValuesMap.set(tKey, { value: Number(fv.value) || 0, type: fv.type });
                                }
                            }
                            const groupedFinalValues = Array.from(groupedValuesMap.values());

                            await t.actor.applyDamage(groupedFinalValues, { ignore: true });

                            const hpAfter = Number(t.actor.system?.attributes?.hp?.value ?? 0);
                            const totalApplied = groupedFinalValues.reduce((acc, entry) => acc + (Number(entry?.value) || 0), 0);
                            const hasHealingType = finalValues.some(entry => String(entry?.type || "").toLowerCase() === "healing");
                            const operator = hasHealingType ? "+" : "-";
                            const amount = Math.abs(totalApplied);
                            const palette = hasHealingType
                                ? { fg: "#166534", accent: "#16a34a", bg: "rgba(22,101,52,0.12)", border: "rgba(22,101,52,0.35)" }
                                : { fg: "#991b1b", accent: "#dc2626", bg: "rgba(153,27,27,0.12)", border: "rgba(153,27,27,0.35)" };

                            let masteryBadge = "";
                            if (activeMastery && applyMasteryChecked) {
                                const badgeColor = activeMastery.id === "sap" ? "#ff5252" : "#ba68c8";
                                const badgeBg = activeMastery.id === "sap" ? "rgba(197,34,31,0.15)" : "rgba(106,27,154,0.15)";
                                const badgeBorder = activeMastery.id === "sap" ? "rgba(197,34,31,0.3)" : "rgba(106,27,154,0.3)";
                                masteryBadge = ` <span style="font-size:0.75em; background:${badgeBg}; color:${badgeColor}; padding:2px 6px; border-radius:8px; border:1px solid ${badgeBorder}; font-weight:bold; margin-left:4px;">${activeMastery.label}</span>`;
                            }

                            damageSummaryLines.push(`
                                <div style="display:flex; flex-direction:column; padding:6px 8px; margin-bottom:4px; border:1px solid ${palette.border}; border-radius:6px; background:${palette.bg}; font-size:0.84em; line-height:1.2;">
                                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                                        <span style="font-weight:700; color:${palette.fg}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.name}${masteryBadge}</span>
                                        <span style="color:inherit; opacity:0.9; white-space:nowrap;">${hpBefore} pv</span>
                                        <span style="color:${palette.accent}; font-weight:800; white-space:nowrap;">${operator} ${amount} pv</span>
                                        <span style="color:inherit; opacity:0.9; white-space:nowrap;">${hpAfter} pv</span>
                                    </div>
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

                    // --- Mensaje resumen público: barra de daño total ---
                    try {
                        const grandTotal = totalValues.reduce((acc, tv) => acc + (Number(tv.value) || 0), 0);
                        // Calcular max y min combinados de todas las fórmulas de daño
                        let combinedMax = 0;
                        let combinedMin = 0;
                        for (const part of damageParts) {
                            let formula = part.formula;
                            if (part.isCritical || isAttackCrit || isSpellCrit) {
                                formula = doubleDice(formula);
                            }
                            const tempRoll = new Roll(formula);
                            // Parsear los términos de la fórmula sin evaluar
                            let sign = 1;
                            for (const term of tempRoll.terms) {
                                if (term.operator) {
                                    sign = term.operator === "-" ? -1 : 1;
                                } else if (term.faces && term.number) {
                                    combinedMax += sign * term.number * term.faces;
                                    combinedMin += sign * term.number;
                                } else if (typeof term.number === "number") {
                                    combinedMax += sign * term.number;
                                    combinedMin += sign * term.number;
                                }
                            }
                        }

                        const range = combinedMax - combinedMin;
                        const pct = range > 0 ? Math.round(((grandTotal - combinedMin) / range) * 100) : 100;
                        const pctClamped = Math.max(0, Math.min(100, pct));

                        let barColor;
                        let containerStyle = "position:relative; overflow:hidden; border-radius:6px; border:1px solid rgba(128,128,128,0.3); font-family:inherit;";
                        if (pctClamped >= 100) {
                            barColor = "linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 100%), linear-gradient(90deg, #bf953f 0%, #fcf6ba 25%, #b38728 50%, #fbf5b7 75%, #aa771c 100%)";
                            containerStyle = "position:relative; overflow:hidden; border-radius:6px; border:1px solid #d4af37; box-shadow: 0 0 12px rgba(212, 175, 55, 0.45); font-family:inherit; background: rgba(30, 25, 10, 0.35);";
                        } else if (pctClamped >= 86) {
                            barColor = "linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 100%), linear-gradient(90deg, #8a8a8a 0%, #e0e0e0 25%, #8a8a8a 50%, #f0f0f0 75%, #7e7e7e 100%)";
                            containerStyle = "position:relative; overflow:hidden; border-radius:6px; border:1px solid #a0a0a0; box-shadow: 0 0 12px rgba(192, 192, 192, 0.45); font-family:inherit; background: rgba(30, 30, 30, 0.25);";
                        } else if (pctClamped >= 51) {
                            barColor = "rgba(76, 175, 80, 0.45)";
                        } else if (pctClamped >= 26) {
                            barColor = "rgba(255, 193, 7, 0.45)";
                        } else {
                            barColor = "rgba(244, 67, 54, 0.4)";
                        }

                        const barContent = `
                            <style>
                                @keyframes notDiceShimmer {
                                    0% { background-position: -150% 0; }
                                    100% { background-position: 150% 0; }
                                }
                                .not-dice-shimmer-effect {
                                    background: linear-gradient(120deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.45) 50%, rgba(255,255,255,0) 65%);
                                    background-size: 250% 100%;
                                    animation: notDiceShimmer 4s infinite linear;
                                }
                            </style>
                            <div style="${containerStyle}">
                                <div style="position:absolute; top:0; left:0; height:100%; width:${pctClamped}%; background:${barColor}; transition:width 0.3s;">
                                    ${(pctClamped >= 86) ? '<div class="not-dice-shimmer-effect" style="position:absolute; top:0; left:0; width:100%; height:100%; mix-blend-mode:overlay; pointer-events:none;"></div>' : ''}
                                </div>
                                <div style="position:relative; display:flex; align-items:center; justify-content:center; padding:8px 14px; gap:8px; text-shadow: ${(pctClamped >= 86) ? '0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.8)' : 'none'}; color: ${(pctClamped >= 86) ? '#fff' : 'inherit'};">
                                    <i class="fas fa-burst" style="font-size:1.1em; opacity:0.85;"></i>
                                    <span style="font-size:1.6em; font-weight:900;">${grandTotal}</span>
                                    <span style="font-size:0.85em; opacity:0.9; font-weight:700;">/ (${combinedMin} - ${combinedMax})</span>
                                </div>
                            </div>
                        `;

                        const hasDice = damageParts.some(part => /\b\d*d\d+/i.test(part.formula));
                        if (hasDice) {
                            const actorSpeaker = ChatMessage.getSpeaker({ actor: actor });
                            await ChatMessage.create({
                                style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                                speaker: actorSpeaker,
                                flags: { "not-dice": { hideHeader: true, damageSummaryBar: true } },
                                content: barContent
                            });
                        }
                    } catch (barErr) {
                        console.error("Not Dice | Error creating total damage bar", barErr);
                    }

                    // Topple Dialog moved to runToppleSave in masteries.js
                } else {
                    // Cuando es Falla (isDamage === false)
                    const applyMasteryChecked = root.querySelector("#mastery-cb")?.checked ?? false;
                    if (applyMasteryChecked && activeMastery && (activeMastery.id === "graze" || activeMastery.label.toLowerCase().includes("rozar") || activeMastery.label.toLowerCase().includes("graze"))) {
                        const targetsLocal = resolveTargets();
                        const missedTargets = targetsLocal;
                        if (missedTargets.length > 0) {
                            const getAbilityUsed = (itm) => {
                                if (!itm || !itm.actor) return "str";
                                const act = itm.actor;
                                if (itm.system.ability) return itm.system.ability;
                                const actionType = itm.system.actionType;
                                const properties = itm.system.properties;

                                if (properties?.has?.("fin")) {
                                    const str = act.system.abilities?.str?.mod ?? 0;
                                    const dex = act.system.abilities?.dex?.mod ?? 0;
                                    return dex > str ? "dex" : "str";
                                }

                                if (actionType === "rwg" || actionType === "rsb") {
                                    return "dex";
                                }
                                return "str";
                            };

                            const ability = getAbilityUsed(item);
                            const abilityMod = Math.max(0, item.actor.system?.abilities?.[ability]?.mod ?? 0);
                            const damageType = damageParts[0]?.type || item.system.damage?.parts?.[0]?.[1] || "slashing";

                            const targetIds = missedTargets.map(t => t.id).join(",");
                            const targetNames = missedTargets.map(t => t.name).join(", ");

                            const whisperUsers = game.users.filter(u => u.isGM || item.actor.testUserPermission(u, "OWNER")).map(u => u.id);

                            await ChatMessage.create({
                                whisper: whisperUsers,
                                content: `
                                    <div class="not-dice-graze-card" style="text-align:center; padding:10px; font-family:inherit;">
                                        <h3 style="margin-bottom:5px; color:#ba68c8;"><i class="fas fa-bullseye"></i> Maestría: Rozar (Graze)</h3>
                                        <p style="font-size:0.9em; margin-bottom:10px;">El ataque falló contra <strong>${targetNames}</strong>. ¿Deseas aplicar Rozar?</p>
                                        <button class="not-dice-graze-apply-btn" 
                                                data-attacker-id="${item.actor.id}" 
                                                data-target-ids="${targetIds}" 
                                                data-ability-mod="${abilityMod}" 
                                                data-damage-type="${damageType}" 
                                                data-weapon-name="${item.name}" 
                                                data-weapon-uuid="${item.uuid}" 
                                                style="background: rgba(106,27,154,0.1); border: 1px solid #ba68c8; color: #ba68c8; font-weight: bold; padding: 6px; border-radius:4px; cursor:pointer; width:100%; transition: all 0.2s;">
                                            <i class="fas fa-gavel"></i> Aplicar Rozar (Daño: ${abilityMod} ${damageType})
                                        </button>
                                    </div>
                                `
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
                    const match = select.name.match(/target-multiplier-([^-]+)-part/);
                    if (!match) return;
                    const tId = match[1];
                    if (forcedSet && !forcedSet.has(tId)) return;

                    const mult = parseFloat(select.value);
                    if (mult > 0 || mult === -1) {
                        if (!targetIds.includes(tId)) targetIds.push(tId);
                        if (targetMultipliers[tId] === undefined) targetMultipliers[tId] = mult;
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
                            <button class="not-dice-roll-spell-damage" data-uuid="${reqUuid}" data-formulas="${formulas}" data-damage-parts="${damagePartsStr}" data-targets="${targetIdsStr}" data-multipliers="${multipliersStr}" data-is-nick-attack="${isNickAttack}" data-is-cleave-attack="${isCleaveAttack}" style="background: rgba(197,34,31,0.1); border: 1px solid #d32f2f; color: #ff5252; font-weight: bold; padding: 6px; border-radius:4px; cursor:pointer; width:100%;">
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

                // --- Auto-roll dados o valor fijo si es curación pura ---
                if (isHealingOnly) {
                    setTimeout(async () => {
                        const rollData = typeof item?.getRollData === "function" ? item.getRollData() : {};
                        for (const part of damageParts) {
                            const hasDice = /(\d*)d(\d+)/i.test(part.formula);
                            if (hasDice) {
                                // Si tiene tirada de dados, lanzamos los dados haciendo clic en el botón de tirar daño
                                const btn = root.querySelector(`.roll-damage-btn[data-index='${part.index}']`);
                                if (btn) btn.click();
                            } else {
                                // Si no tiene dados, evaluamos el valor fijo y lo ponemos directamente en el resultado (sin toMessage)
                                try {
                                    const r = await new Roll(part.formula, rollData).evaluate();
                                    const total = r.total;
                                    const inputTotal = root.querySelector(`[name='total-${part.index}']`);
                                    if (inputTotal) {
                                        inputTotal.value = total;
                                    }
                                } catch (err) {
                                    console.error("Not Dice | Error evaluando valor fijo de curación:", err);
                                    const parsed = parseInt(part.formula);
                                    if (!isNaN(parsed)) {
                                        const inputTotal = root.querySelector(`[name='total-${part.index}']`);
                                        if (inputTotal) inputTotal.value = parsed;
                                    }
                                }
                            }
                        }
                    }, 150);
                }


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
                        const sign = attackRollState.bonus >= 0 ? "+" : "-";
                        const bonusFormula = `1d20 ${sign} ${Math.abs(attackRollState.bonus)}`;
                        const extraRoll = await new Roll(bonusFormula).evaluate();
                        const extraD20 = extraRoll.total - attackRollState.bonus;
                        const selectedD20 = mode === "advantage"
                            ? Math.max(attackRollState.originalD20, extraD20)
                            : Math.min(attackRollState.originalD20, extraD20);
                        const total = selectedD20 + attackRollState.bonus;
                        const isCrit = selectedD20 === 20;
                        if (isCrit) {
                            isAttackCrit = true;
                            for (const p of damageParts) {
                                p.isCritical = true;
                            }
                        } else {
                            isAttackCrit = false;
                        }
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

                        // Enviar solicitud automática de daño al chat si corresponde y el ataque ahora impacta
                        const autoRequestOnHit = game.settings.get("not-dice", "enableAutoDamageRequestOnHit");
                        const reqBtn = root.querySelector("#not-dice-btn-request-damage-attack");
                        if (autoRequestOnHit && canRequestPlayerDamage && reqBtn) {
                            const hitTargetIds = getHitTargetIds();
                            if (hitTargetIds.length > 0) {
                                const sent = await sendDamageRequestToPlayer(root, hitTargetIds);
                                if (sent) {
                                    ui.notifications.info("Not Dice | Solicitud de daño enviada automáticamente al jugador (ataque acertado por ventaja/desventaja).");
                                }
                            }
                        }
                    } catch (err) {
                        console.error("Not Dice | Error applying manual advantage/disadvantage", err);
                    } finally {
                        setAttackButtonsDisabled(false);
                    }
                };

                const registerChatAttackModeHandler = () => {
                    globalThis._notDiceAttackModeHandlers = globalThis._notDiceAttackModeHandlers || {};
                    if (item?.uuid) globalThis._notDiceAttackModeHandlers[item.uuid] = applyManualAttackMode;
                    if (attackRollMessageId) globalThis._notDiceAttackModeHandlers[`msg:${attackRollMessageId}`] = applyManualAttackMode;
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
                    registerChatAttackModeHandler();
                }

                // --- HOVER PARA LA DESCRIPCION DEL ATAQUE ---
                const attackImgHover = root.querySelector(".not-dice-attack-img-hover");
                if (attackImgHover) {
                    attackImgHover.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        const descId = attackImgHover.dataset.descId;
                        const hoverBox = root.querySelector(`#${descId}`);
                        if (!hoverBox) return;

                        if (hoverBox.style.display === "none") {
                            hoverBox.style.display = "block";
                            if (!hoverBox.dataset.translated) {
                                hoverBox.dataset.translated = "true";
                                let description = "";
                                if (item) {
                                    if (globalThis.notDiceEnrichDescription) {
                                        description = await globalThis.notDiceEnrichDescription(item);
                                    } else {
                                        description = item?.system?.description?.value || "<p>Sin descripción.</p>";
                                    }
                                } else {
                                    description = "<p>Sin descripción.</p>";
                                }
                                hoverBox.innerHTML = description;
                                if (globalThis.notDiceTranslateAndUpdate) {
                                    globalThis.notDiceTranslateAndUpdate(description, descId);
                                }
                            }
                        } else {
                            hoverBox.style.display = "none";
                        }
                    });

                    const middleSection = attackImgHover.parentElement;
                    if (middleSection) {
                        middleSection.addEventListener("mouseleave", () => {
                            const descId = attackImgHover.dataset.descId;
                            const hoverBox = root.querySelector(`#${descId}`);
                            if (hoverBox && hoverBox.style.display === "block") {
                                hoverBox.style.display = "none";
                            }
                        });
                    }
                }
                // ---------------------------------------------

                root.querySelectorAll("select[name^='type-']").forEach(select => {
                    select.addEventListener("change", (ev) => {
                        const newType = ev.currentTarget.value;
                        const partIndexMatch = ev.currentTarget.name.match(/type-(\d+)/);
                        const partIndex = partIndexMatch ? partIndexMatch[1] : null;

                        if (partIndex !== null) {
                            targets.forEach(t => {
                                let baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                                let detectedMultiplier = 1;
                                const traits = t.actor?.system?.traits;
                                if (traits) {
                                    if (traits.di?.value?.has(newType)) detectedMultiplier = 0;
                                    else if (traits.dv?.value?.has(newType)) detectedMultiplier = 2;
                                    else if (traits.dr?.value?.has(newType)) detectedMultiplier = 0.5;
                                }
                                detectedMultiplier = detectedMultiplier * baseMult;
                                const targetSelect = root.querySelector(`select[name='target-multiplier-${t.id}-part-${partIndex}']`);
                                if (targetSelect) targetSelect.value = detectedMultiplier;
                            });
                        }

                        const style = damageStyle[newType] || { color: "inherit" };
                        ev.currentTarget.style.color = style.color;
                    });
                });

                const doubleDice = (formula) => {
                    return formula.replace(/(\d+)d(\d+)/g, (match, num, sides) => {
                        return `${parseInt(num) * 2}d${sides}`;
                    });
                };

                const executeDamageRoll = async (baseFormula, isCrit, idx) => {
                    let formula = baseFormula;
                    if (isCrit) formula = doubleDice(formula);

                    const isGwf = root.querySelector(`#gwf-${idx}`)?.checked;
                    const selectedType = root.querySelector(`[name='type-${idx}']`)?.value || damageParts.find(p => p.index == idx)?.type;

                    if (isGwf && globalThis.notDiceEspeciales) {
                        formula = globalThis.notDiceEspeciales.applyGreatWeaponFightingFormula(formula);
                    }

                    const flavorBase = isCrit ? "Daño Crítico" : "Daño Normal";
                    const actorSpeaker = ChatMessage.getSpeaker({ actor: actor });

                    let extraMods = [];
                    if (isGwf) extraMods.push("Armas a Dos Manos");
                    if (hasPiercer && selectedType === "piercing") extraMods.push("Perforador");

                    const modsString = extraMods.length > 0 ? ` (${extraMods.join(" | ")})` : "";

                    const buildPiercerButtons = (r, dmgIdx) => {
                        if (!hasPiercer || selectedType !== "piercing") return "";
                        let buttonsHtml = '<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px;">';
                        buttonsHtml += '<div style="width: 100%; font-size: 0.9em; font-weight: bold; margin-bottom: 4px; color: inherit;">Perforador:</div>';
                        r.dice.forEach(die => {
                            die.results.forEach(res => {
                                buttonsHtml += `<button type="button" class="not-dice-piercer-reroll" data-uuid="${item.uuid}" data-idx="${dmgIdx}" data-faces="${die.faces}" data-original="${res.result}" data-damage-type="${selectedType}" style="width: 28px; height: 28px; padding: 0; font-weight: bold; border: 1px solid var(--color-border-light-2, #ccc); border-radius: 4px; background: rgba(127,127,127,0.1); color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1em;" title="d${die.faces}">${res.result}</button>`;
                            });
                        });
                        buttonsHtml += '</div>';
                        return buttonsHtml;
                    };

                    const buildSavageButton = (r, dmgIdx) => {
                        const part = damageParts.find(p => p.index == dmgIdx);
                        const isWeaponDmg = part ? part.weaponDamage !== false : true;
                        const firstWeaponPart = damageParts.find(p => p.weaponDamage !== false);
                        if (!hasSavageAttacker || isSavageUsed || !isWeaponDmg || (firstWeaponPart && firstWeaponPart.index != dmgIdx)) return "";
                        return `<div style="margin-top:8px;"><button type="button" class="not-dice-savage-reroll" data-uuid="${item.uuid}" data-idx="${dmgIdx}" data-formula="${btoa(formula)}" data-flavor="${btoa(flavorBase)}" data-damagelabel="" data-mods="${btoa(modsString)}" data-original="${r.total}" data-damage-type="${selectedType}" style="width:100%; font-weight:bold; padding:4px; border:1px solid rgba(197,34,31,0.5); border-radius:4px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer;"><i class="fas fa-paw"></i> A (relanza el daño)</button></div>`;
                    };

                    const rollObj = new Roll(formula);
                    if (globalThis.notDiceApplyColorset) globalThis.notDiceApplyColorset(rollObj, selectedType);
                    const r = await rollObj.evaluate();
                    await r.toMessage({ flavor: `${flavorBase}${modsString}${buildPiercerButtons(r, idx)}${buildSavageButton(r, idx)}`, speaker: actorSpeaker });

                    return r.total;
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
                                const part = damageParts.find(p => p.index == idx);
                                if (part) part.isCritical = false;
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
                                const part = damageParts.find(p => p.index == idx);
                                if (part) part.isCritical = true;
                            } catch (err) { console.error("Not Dice | Error rolling crit damage", err); }
                        }
                    });
                });

                // Add GM Extra Damage Popup Logic
                const addGmDamageBtn = root.querySelector(".not-dice-add-gm-damage-btn");
                if (addGmDamageBtn) {
                    addGmDamageBtn.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        const existingPopup = root.querySelector(".not-dice-gm-damage-popup");
                        if (existingPopup) {
                            existingPopup.remove();
                            return;
                        }
                        let skillsHtml = "";
                        if (item?.actor && typeof globalThis.notDiceGetGMDamageSkillsHtml === "function") {
                            skillsHtml = globalThis.notDiceGetGMDamageSkillsHtml(item.actor, item.id);
                        }

                        const popupHtml = `
                            <div class="not-dice-gm-damage-popup" style="position:absolute; top:30px; right:0; width: 200px; background:var(--color-bg-1, rgba(30,30,30,0.95)); color:var(--color-text-light-1, #f0f0f0); border:1px solid var(--color-border-light-1, #555); border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.5); z-index:100; padding:8px; backdrop-filter: blur(4px);">
                                <div class="not-dice-gm-damage-step1">
                                    <div style="font-weight:bold; font-size:0.9em; margin-bottom:6px; text-align:center; color:inherit;">Seleccionar Dado</div>
                                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px;">
                                        ${["d4","d6","d8","d10","d12","d20"].map(d => `<button class="not-dice-gm-damage-die-btn" data-die="${d}" style="padding:4px; font-weight:bold; font-size:0.9em; border-radius:4px; border:1px solid var(--color-border-light-2, #777); background:rgba(128,128,128,0.1); color:inherit; cursor:pointer;">${d}</button>`).join('')}
                                    </div>
                                    ${skillsHtml}
                                </div>
                                <div class="not-dice-gm-damage-step2" style="display:none;">
                                    <div style="font-weight:bold; font-size:0.9em; margin-bottom:6px; text-align:center; color:inherit;">
                                        <div style="display:flex; justify-content:center; align-items:center; gap:8px; margin-bottom:8px;">
                                            <button class="not-dice-gm-damage-qty-minus" style="width:24px; height:24px; padding:0; border:1px solid var(--color-border-light-2, #777); background:rgba(128,128,128,0.1); border-radius:4px; cursor:pointer; color:inherit; font-weight:bold;">-</button>
                                            <span class="not-dice-gm-damage-qty" style="font-size:1.2em;">1</span>
                                            <button class="not-dice-gm-damage-qty-plus" style="width:24px; height:24px; padding:0; border:1px solid var(--color-border-light-2, #777); background:rgba(128,128,128,0.1); border-radius:4px; cursor:pointer; color:inherit; font-weight:bold;">+</button>
                                        </div>
                                        Seleccionar Tipo
                                    </div>
                                    <div style="display:flex; flex-direction:column; gap:2px; max-height:150px; overflow-y:auto; padding-right:4px;">
                                        <!-- Types will be injected here -->
                                    </div>
                                </div>
                            </div>
                        `;
                        const wrapper = document.createElement("div");
                        wrapper.innerHTML = popupHtml;
                        const popupNode = wrapper.firstElementChild;
                        addGmDamageBtn.parentElement.appendChild(popupNode);

                        // Close popup when clicking outside
                        const closePopup = (e) => {
                            if (!popupNode.contains(e.target) && e.target !== addGmDamageBtn && !addGmDamageBtn.contains(e.target)) {
                                popupNode.remove();
                                document.removeEventListener("click", closePopup);
                            }
                        };
                        setTimeout(() => document.addEventListener("click", closePopup), 50);

                        const appendGmDamageRow = async (selectedFormula, selectedType, flavorText = "Extra GM", availableTypesStr = "") => {
                            // Execute Damage Roll locally and append row
                            const dmgIdx = damageParts.reduce((max, part) => Math.max(max, Number(part.index) || 0), -1) + 1;
                            let rollTotal = 0;
                            try {
                                const r = await new Roll(selectedFormula).evaluate();
                                rollTotal = r.total;
                                await r.toMessage({ speaker: ChatMessage.getSpeaker({actor: item?.actor}), flavor: flavorText });
                            } catch (err) {}
                            
                            const stl = damageStyle[selectedType] || {color:"inherit"};
                            
                            const targetList = typeof resolveTargets === "function" ? resolveTargets() : [];
                            let partTargetMultipliersHtml = "";
                            if (targetList.length > 0) {
                                const multiplierOptions = globalThis.notDiceConstants?.multiplierOptions || [
                                    { val: 0, label: "0" },
                                    { val: 0.5, label: "1/2" },
                                    { val: 1, label: "1" },
                                    { val: 2, label: "2" },
                                ];
                                if (targetList.length === 1) {
                                    const t = targetList[0];
                                    const traits = t.actor?.system?.traits;
                                    let detectedMultiplier = 1;
                                    if (traits) {
                                        if (traits.di?.value?.has(selectedType)) detectedMultiplier = 0;
                                        else if (traits.dv?.value?.has(selectedType)) detectedMultiplier = 2;
                                        else if (traits.dr?.value?.has(selectedType)) detectedMultiplier = 0.5;
                                    }
                                    const selectName = `target-multiplier-${t.id}-part-${dmgIdx}`;
                                    partTargetMultipliersHtml = `
                                        <select name="${selectName}" style="flex:1; height:32px; border:1px solid var(--color-border-light-2, #ccc); background:rgba(128,128,128,0.1); color:inherit; border-radius:4px; cursor:pointer; font-weight:bold; font-size:1.05em; text-align:center; box-sizing:border-box; margin:0; padding:0;" title="Multiplicador para ${t.name}">
                                            ${multiplierOptions.map(o => `<option value="${o.val}" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                                        </select>`;
                                } else {
                                    partTargetMultipliersHtml += `<div style="display:flex; flex-direction:column; gap:2px; flex:1;">`;
                                    for (const t of targetList) {
                                        const traits = t.actor?.system?.traits;
                                        let detectedMultiplier = 1;
                                        if (traits) {
                                            if (traits.di?.value?.has(selectedType)) detectedMultiplier = 0;
                                            else if (traits.dv?.value?.has(selectedType)) detectedMultiplier = 2;
                                            else if (traits.dr?.value?.has(selectedType)) detectedMultiplier = 0.5;
                                        }
                                        const selectName = `target-multiplier-${t.id}-part-${dmgIdx}`;
                                        partTargetMultipliersHtml += `
                                            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8em; background: rgba(128,128,128,0.08); padding: 1px 4px; border-radius: 4px; border:1px solid var(--color-border-light-2, #eee); min-height:30px; gap:4px; box-sizing:border-box; width:100%;">
                                                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;" title="${t.name}">${t.name}</span>
                                                <select name="${selectName}" style="width:55px; height:24px; padding:0; border:1px solid var(--color-border-light-2, #ccc); background:transparent; color:inherit; border-radius:3px; cursor:pointer; font-weight:bold; font-size:0.95em; flex-shrink:0; text-align:center; box-sizing:border-box; margin:0;">
                                                    ${multiplierOptions.map(o => `<option value="${o.val}" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                                                </select>
                                            </div>`;
                                    }
                                    partTargetMultipliersHtml += `</div>`;
                                }
                            }

                            const availableTypesArr = availableTypesStr ? availableTypesStr.split(",") : null;
                            const typesDropdownHtml = typeof notDiceGetDamageTypeOptionsHtml === "function" 
                                ? notDiceGetDamageTypeOptionsHtml(selectedType, availableTypesArr)
                                : `<option value="${selectedType}" selected>${selectedType}</option>`;

                            const nRow = document.createElement("div");
                            nRow.className = "damage-part-container not-dice-added-gm-row";
                            nRow.dataset.index = dmgIdx;
                            nRow.style.cssText = "margin-bottom: 8px; padding: 6px 8px; border: 1px solid rgba(26,115,232,0.4); border-radius: 6px; background: rgba(26,115,232,0.05); box-shadow: 0 1px 2px rgba(0,0,0,0.1); position:relative;";
                            nRow.innerHTML = `
                                <div style="position:absolute; top:-8px; right:-8px; background:#ff5252; color:#fff; border-radius:50%; width:20px; height:20px; text-align:center; line-height:20px; font-size:12px; font-weight:bold; cursor:pointer; z-index:10; border:1px solid #d32f2f; box-shadow:0 1px 2px rgba(0,0,0,0.3);" class="not-dice-remove-gm-row-btn" title="Eliminar"><i class="fas fa-times"></i></div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; border-bottom: 1px dashed var(--color-border-light-2, #ddd); padding-bottom: 4px; color:${stl.color}; font-weight:bold;">
                                    <div style="display:flex; align-items:center; gap:4px; max-width:60%;">
                                        <select name="type-${dmgIdx}" class="not-dice-gm-type-select" style="max-width:120px; text-overflow:ellipsis; height:24px; font-size:0.85em; font-weight:bold; background:transparent; border:1px solid var(--color-border-light-2, #ccc); border-radius:3px; color:inherit; cursor:pointer; padding:0 2px;">
                                            ${typesDropdownHtml}
                                        </select>
                                        <span style="font-size:0.8em; opacity:0.75; font-weight:normal; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${flavorText}">(${flavorText})</span>
                                    </div>
                                    <div style="font-size:1.25em; font-weight:800; opacity:0.95; font-family:monospace; background:rgba(128,128,128,0.12); padding:4px 12px; border-radius:4px; border:1px solid var(--color-border-light-1, #888); text-align:right; cursor:help;">${selectedFormula}</div>
                                </div>
                                <div style="display:flex; align-items:center; gap:6px; width:100%;">
                                    <input type="number" name="total-${dmgIdx}" value="${rollTotal}" class="not-dice-dmg-input" style="width:110px; flex-shrink:0; height:32px; font-size:1.3em; font-weight:bold; text-align:center; padding:2px; border:1px solid var(--color-border-light-2, #aaa); border-radius:4px; color:#ff5252; background:rgba(128,128,128,0.1); box-sizing:border-box; margin:0;" title="Total de daño base" data-index="${dmgIdx}">
                                    ${partTargetMultipliersHtml}
                                    <div style="display:flex; ${targetList.length > 1 ? 'flex-direction:column;' : ''} gap:4px; flex:1;">
                                        <button type="button" class="roll-damage-btn" data-index="${dmgIdx}" style="flex:1; height:32px; padding:0 6px; border:1px solid var(--color-border-light-2, #bbb); border-radius:4px; background:var(--color-bg-option, rgba(127,127,127,0.1)); color:inherit; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px; font-weight:bold; font-size:0.85em; box-sizing:border-box; margin:0;" title="Tirar Daño Normal"><i class="fas fa-dice" style="color:inherit; opacity:0.8; font-size:1.1em;"></i>Normal</button>
                                        <button type="button" class="roll-damage-crit-btn" data-index="${dmgIdx}" style="flex:1; height:32px; padding:0 6px; border:1px solid #d32f2f; border-radius:4px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px; font-weight:bold; font-size:0.85em; box-sizing:border-box; margin:0;" title="Tirar Daño Crítico"><i class="fas fa-dice-d20" style="font-size:1.1em;"></i>Crítico</button>
                                    </div>
                                </div>
                            `;
                            const dmgList = root.querySelector("#not-dice-damage-list");
                            if (dmgList) {
                                dmgList.appendChild(nRow);
                                nRow.querySelector(".not-dice-remove-gm-row-btn").addEventListener("click", () => {
                                    nRow.remove();
                                    const pIdx = damageParts.findIndex(p => p.index === dmgIdx);
                                    if(pIdx !== -1) damageParts.splice(pIdx, 1);
                                });
                                
                                const selectEl = nRow.querySelector("select.not-dice-gm-type-select");
                                if (selectEl) {
                                    selectEl.addEventListener("change", (ev) => {
                                        const newType = ev.currentTarget.value;
                                        const p = damageParts.find(dp => dp.index === dmgIdx);
                                        if (p) p.type = newType;
                                        const style = damageStyle[newType] || { color: "inherit" };
                                        ev.currentTarget.style.color = style.color;
                                        ev.currentTarget.parentElement.style.color = style.color;
                                    });
                                    // Trigger once to set initial color
                                    selectEl.dispatchEvent(new Event("change"));
                                }
                                
                                const newRollObj = typeof DamageRoll !== 'undefined' ? new DamageRoll(selectedFormula) : new Roll(selectedFormula);
                                newRollObj.options = newRollObj.options || {};
                                newRollObj.options.type = selectedType;
                                damageParts.push({
                                    index: dmgIdx,
                                    roll: newRollObj,
                                    formula: selectedFormula,
                                    label: flavorText,
                                    type: selectedType,
                                    availableTypes: availableTypesArr || [selectedType],
                                    isOffhandWithoutStyle: false,
                                    isCritical: typeof isAttackCrit !== "undefined" ? isAttackCrit : false
                                });

                                nRow.querySelector(".roll-damage-btn").addEventListener("click", async (evBtn) => {
                                    evBtn.preventDefault();
                                    const formula = damageParts.find(p => p.index == dmgIdx)?.formula;
                                    if (formula) {
                                        try {
                                            const total = await executeDamageRoll(formula, false, dmgIdx);
                                            const inputTotal = root.querySelector(`[name='total-${dmgIdx}']`);
                                            if (inputTotal) inputTotal.value = total;
                                            const part = damageParts.find(p => p.index == dmgIdx);
                                            if (part) part.isCritical = false;
                                        } catch (err) { console.error("Not Dice | Error rolling normal damage", err); }
                                    }
                                });
                                
                                nRow.querySelector(".roll-damage-crit-btn").addEventListener("click", async (evBtn) => {
                                    evBtn.preventDefault();
                                    const formula = damageParts.find(p => p.index == dmgIdx)?.formula;
                                    if (formula) {
                                        try {
                                            const total = await executeDamageRoll(formula, true, dmgIdx);
                                            const inputTotal = root.querySelector(`[name='total-${dmgIdx}']`);
                                            if (inputTotal) inputTotal.value = total;
                                            const part = damageParts.find(p => p.index == dmgIdx);
                                            if (part) part.isCritical = true;
                                        } catch (err) { console.error("Not Dice | Error rolling crit damage", err); }
                                    }
                                });
                            }
                        };

                        // Step 1 clicks
                        let selectedDie = "";
                        let selectedQty = 1;
                        
                        const qtySpan = popupNode.querySelector(".not-dice-gm-damage-qty");
                        popupNode.querySelector(".not-dice-gm-damage-qty-minus").addEventListener("click", (e) => {
                            e.preventDefault();
                            if (selectedQty > 1) {
                                selectedQty--;
                                qtySpan.textContent = selectedQty;
                            }
                        });
                        popupNode.querySelector(".not-dice-gm-damage-qty-plus").addEventListener("click", (e) => {
                            e.preventDefault();
                            selectedQty++;
                            qtySpan.textContent = selectedQty;
                        });

                        // Skill buttons
                        popupNode.querySelectorAll(".not-dice-gm-damage-skill-btn").forEach(btn => {
                            btn.addEventListener("click", async (e) => {
                                e.preventDefault();
                                const formula = e.currentTarget.dataset.formula;
                                let type = e.currentTarget.dataset.type;
                                const availableTypesStr = e.currentTarget.dataset.availableTypes || "";
                                const availableTypesArr = availableTypesStr ? availableTypesStr.split(",") : [];
                                
                                const weaponType = damageParts[0]?.type || "bludgeoning";
                                const hasManyTypes = availableTypesArr.length > 5;
                                
                                if (!type || type === "undefined" || type === "null" || hasManyTypes) {
                                    type = weaponType;
                                }
                                
                                if (availableTypesArr.length > 0 && !availableTypesArr.includes(type)) {
                                    type = availableTypesArr[0];
                                }
                                const name = e.currentTarget.dataset.name;
                                const availableTypes = e.currentTarget.dataset.availableTypes || "";
                                const uuid = e.currentTarget.dataset.itemUuid;
                                
                                popupNode.remove();
                                document.removeEventListener("click", closePopup);
                                await appendGmDamageRow(formula, type, name, availableTypes);

                                if (uuid) {
                                    const sourceItem = await fromUuid(uuid);
                                    if (sourceItem) {
                                        const desc = sourceItem.system?.description?.value || "";
                                        if (desc) {
                                            ChatMessage.create({
                                                speaker: ChatMessage.getSpeaker({actor: sourceItem.actor}),
                                                content: `<div class="dnd5e chat-card item-card"><header class="card-header flexrow"><img src="${sourceItem.img}" title="${sourceItem.name}" width="36" height="36" style="border:none;"/><h3 class="item-name">${sourceItem.name}</h3></header><div class="card-content">${desc}</div></div>`,
                                                flavor: `Aplicando Daño Extra`
                                            });
                                        }
                                    }
                                }
                            });
                        });

                        popupNode.querySelectorAll(".not-dice-gm-damage-die-btn").forEach(btn => {
                            btn.addEventListener("click", (e) => {
                                e.preventDefault();
                                selectedDie = e.currentTarget.dataset.die;
                                popupNode.querySelector(".not-dice-gm-damage-step1").style.display = "none";
                                const step2 = popupNode.querySelector(".not-dice-gm-damage-step2");
                                step2.style.display = "block";
                                
                                const types = Object.entries(CONFIG.DND5E.damageTypes).map(([k,v]) => ({id:k, label:v.label||v})).sort((a,b) => a.label.localeCompare(b.label));
                                const typesContainer = step2.querySelector("div:nth-child(2)");
                                typesContainer.innerHTML = types.map(t => {
                                    const st = damageStyle[t.id] || {color:"inherit"};
                                    return `<button class="not-dice-gm-damage-type-btn" data-type="${t.id}" style="padding:4px; font-size:0.85em; font-weight:bold; border-radius:4px; border:1px solid var(--color-border-light-2, #555); background:transparent; cursor:pointer; color:${st.color}; text-align:left;">${t.label}</button>`;
                                }).join("");

                                typesContainer.querySelectorAll(".not-dice-gm-damage-type-btn").forEach(typeBtn => {
                                    typeBtn.addEventListener("click", async (e2) => {
                                        e2.preventDefault();
                                        const selectedType = e2.currentTarget.dataset.type;
                                        const selectedFormula = `${selectedQty}${selectedDie}`;
                                        popupNode.remove();
                                        document.removeEventListener("click", closePopup);
                                        await appendGmDamageRow(selectedFormula, selectedType, "Extra GM");
                                    });
                                });
                            });
                        });
                    });
                }

                globalThis._notDiceActiveAttackDialogs = globalThis._notDiceActiveAttackDialogs || {};
                globalThis._notDiceActiveAttackDialogs[item.uuid] = (totals, parts = null, applyMastery = null, applySavage = null, applyGwf = null, isCritical = false) => {
                    const reqBtn = root.querySelector(`#not-dice-btn-request-damage-attack`);
                    if (!document.body.contains(root)) return false; // El DOM del dialog ya no existe

                    if (applyMastery !== null) {
                        const masteryCb = root.querySelector("#mastery-cb");
                        if (masteryCb) {
                            masteryCb.checked = !!applyMastery;
                            masteryCb.dispatchEvent(new Event("change", { bubbles: true }));
                        }
                    }

                    if (applySavage !== null && applySavage !== undefined) {
                        root.querySelectorAll("[id^='savage-']").forEach(cb => {
                            cb.checked = !!applySavage;
                            cb.dispatchEvent(new Event("change", { bubbles: true }));
                        });
                    }

                    if (applyGwf !== null && applyGwf !== undefined) {
                        root.querySelectorAll("[id^='gwf-']").forEach(cb => {
                            cb.checked = !!applyGwf;
                            cb.dispatchEvent(new Event("change", { bubbles: true }));
                        });
                    }

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
                        if (isCritical) {
                            part.isCritical = true;
                        }
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
                            isOffhandWithoutStyle: false,
                            isCritical: isCritical
                        });

                        const style = type ? (damageStyle[type] || { color: "inherit", icon: "" }) : { color: "inherit", icon: "" };
                        const hiddenTypeInput = `<input type="hidden" name="type-${newIndex}" value="${type}">`;
                        const newRowHtml = `
                        <div class="damage-part-container" data-index="${newIndex}" style="margin-bottom: 8px; padding: 6px 8px; border: 1px solid rgba(26,115,232,0.4); border-radius: 6px; background: rgba(26,115,232,0.05); box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; border-bottom: 1px dashed var(--color-border-light-2, #ddd); padding-bottom: 4px; color:${style.color}; font-weight:bold;">
                                <div>${label} <span style="font-size:0.8em; opacity:0.75; margin-left:4px; font-weight:normal;">(Jugador)</span>${hiddenTypeInput}</div>
                                <div style="font-size:1.25em; font-weight:800; opacity:0.95; font-family:monospace; background:rgba(128,128,128,0.12); padding:4px 12px; border-radius:4px; border:1px solid var(--color-border-light-1, #888); text-align:right; cursor:help;" title="${notDiceGetDamageFormulaBreakdown(formula, false, item, actor)}">${formula}</div>
                            </div>
                            
                            <div style="display:flex; align-items:center; gap:6px; width:100%;">
                                <!-- 1. Input de daño -->
                                <input type="number" name="total-${newIndex}" value="${Number(totalVal) || 0}" style="width:110px; flex-shrink:0; height:32px; font-size:1.3em; font-weight:bold; text-align:center; padding:2px; border:1px solid var(--color-border-light-2, #aaa); border-radius:4px; color:#ff5252; background:rgba(128,128,128,0.1); box-sizing:border-box; margin:0;" title="Total de daño base"/>
                                
                                <!-- 2. Multiplicador(es) (estirado) -->
                                ${(() => {
                                const targets = resolveTargets();
                                let partTargetMultipliersHtml = "";
                                if (targets.length > 0) {
                                    if (targets.length === 1) {
                                        const t = targets[0];
                                        const traits = t.actor?.system?.traits;
                                        let detectedMultiplier = 1;
                                        if (traits) {
                                            if (traits.di?.value?.has(type)) detectedMultiplier = 0;
                                            else if (traits.dv?.value?.has(type)) detectedMultiplier = 2;
                                            else if (traits.dr?.value?.has(type)) detectedMultiplier = 0.5;
                                        }
                                        const baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                                        detectedMultiplier = detectedMultiplier * baseMult;

                                        const selectName = `target-multiplier-${t.id}-part-${newIndex}`;
                                        partTargetMultipliersHtml = `
                                            <select name="${selectName}" style="flex:1; height:32px; border:1px solid var(--color-border-light-2, #ccc); background:rgba(128,128,128,0.1); color:inherit; border-radius:4px; cursor:pointer; font-weight:bold; font-size:1.05em; text-align:center; box-sizing:border-box; margin:0; padding:0;" title="Multiplicador para ${t.name}">
                                                ${multiplierOptions.map(o => `<option value="${o.val}" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                                            </select>`;
                                    } else {
                                        partTargetMultipliersHtml += `<div style="display:flex; flex-direction:column; gap:2px; flex:1;">`;
                                        for (const t of targets) {
                                            const traits = t.actor?.system?.traits;
                                            let detectedMultiplier = 1;
                                            if (traits) {
                                                if (traits.di?.value?.has(type)) detectedMultiplier = 0;
                                                else if (traits.dv?.value?.has(type)) detectedMultiplier = 2;
                                                else if (traits.dr?.value?.has(type)) detectedMultiplier = 0.5;
                                            }
                                            const baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                                            detectedMultiplier = detectedMultiplier * baseMult;

                                            const selectName = `target-multiplier-${t.id}-part-${newIndex}`;
                                            partTargetMultipliersHtml += `
                                                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8em; background: rgba(128,128,128,0.08); padding: 1px 4px; border-radius: 4px; border:1px solid var(--color-border-light-2, #eee); min-height:30px; gap:4px; box-sizing:border-box; width:100%;">
                                                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;" title="${t.name}">${t.name}</span>
                                                    <select name="${selectName}" style="width:55px; height:24px; padding:0; border:1px solid var(--color-border-light-2, #ccc); background:transparent; color:inherit; border-radius:3px; cursor:pointer; font-weight:bold; font-size:0.95em; flex-shrink:0; text-align:center; box-sizing:border-box; margin:0;">
                                                        ${multiplierOptions.map(o => `<option value="${o.val}" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                                                    </select>
                                                </div>`;
                                        }
                                        partTargetMultipliersHtml += `</div>`;
                                    }
                                }
                                return partTargetMultipliersHtml;
                            })()}
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

                globalThis._notDiceUpdateSavageTotal = globalThis._notDiceUpdateSavageTotal || {};
                globalThis._notDiceUpdateSavageTotal[item.uuid] = (targetIdx, newTotal) => {
                    if (!document.body.contains(root)) return false;
                    const inputTotal = root.querySelector(`[name='total-${targetIdx}']`);
                    if (inputTotal) {
                        inputTotal.value = newTotal;
                        return true;
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

            const unregisterChatAttackModeHandler = () => {
                const handlers = globalThis._notDiceAttackModeHandlers;
                if (!handlers) return;
                if (item?.uuid && handlers[item.uuid]) delete handlers[item.uuid];
                if (attackRollMessageId && handlers[`msg:${attackRollMessageId}`]) delete handlers[`msg:${attackRollMessageId}`];
            };

            // --- Detectar si todos los tipos son curación ---
            const healingTypes = new Set(["healing", "temphp"]);
            const isHealingOnly = damageParts.length > 0 && damageParts.every(p => healingTypes.has(p.type));

            const damageButtonLabel = isHealingOnly ? "Aplicar Curación" : "Aplicar Daño";
            const damageButtonIcon = isHealingOnly ? "fa-solid fa-heart" : "fa-solid fa-skull";
            const damageButtonIconLegacy = isHealingOnly ? "<i class='fas fa-heart'></i>" : "<i class='fas fa-skull'></i>";

            const result = await new Promise(resolve => {
                const DialogV2 = foundry?.applications?.api?.DialogV2;
                if (DialogV2) {
                    const app = new DialogV2({
                        window: { title: `Resolución: ${item.name} (v${notDiceVersion})` },
                        content: dialogContent,
                        position: { width: 440 },
                        buttons: [
                            { action: "damage", icon: damageButtonIcon, label: damageButtonLabel, default: true },
                            { action: "ok", icon: "fa-solid fa-xmark", label: "Falla" }
                        ],
                        submit: async (res) => {
                            const container = app.element;
                            if (res === "damage") await applyAndResolve(container, true);
                            else if (res === "ok") await applyAndResolve(container, false);
                            unregisterChatAttackModeHandler();
                            resolve(rolls);
                        },
                        close: () => {
                            unregisterChatAttackModeHandler();
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
                                label: damageButtonLabel,
                                icon: damageButtonIconLegacy,
                                callback: async html => {
                                    await applyAndResolve(html, true);
                                    unregisterChatAttackModeHandler();
                                    resolve(rolls);
                                }
                            },
                            ok: {
                                label: "Falla",
                                icon: "<i class='fa-solid fa-xmark'></i>",
                                callback: async html => {
                                    await applyAndResolve(html, false);
                                    unregisterChatAttackModeHandler();
                                    resolve(rolls);
                                }
                            }
                        },
                        default: "damage",
                        render: (html) => onRenderComplete(html),
                        close: () => {
                            unregisterChatAttackModeHandler();
                            resolve(rolls);
                        }
                    }, { width: 440 }).render(true);
                }
            });

            for (const r of rolls) {
                if (!r._evaluated) {
                    r._total = 0;
                    r._evaluated = true;
                    r.terms = [new foundry.dice.terms.NumericTerm({ number: 0, options: {} })];
                }
            }
            return rolls;
        };

        DamageRoll.buildConfigure = async function (config, dialog, message) {
            console.log("Not Dice | Damage buildConfigure intercepted", config);
            if (!config?.options?.notDiceBypass) {
                dialog = foundry.utils.mergeObject(dialog ?? {}, { configure: false });
                if (message) message.create = false;
            }
            return originalDamageBuildConfigure.call(this, config, dialog, message);
        };

        DamageRoll.buildEvaluate = async function (rolls, rollConfig, messageConfig) {
            if (rollConfig?.options?.notDiceBypass) {
                return originalDamageBuildEvaluate.call(this, rolls, rollConfig, messageConfig);
            }

            const hasMultipliers = rollConfig?.notDiceMultipliers || rollConfig?.options?.notDiceMultipliers || rollConfig?.event?.notDiceMultipliers;

            const healingTypes = new Set(["healing", "temphp"]);
            const isHealingOnly = rolls.length > 0 && rolls.every(r => r.options?.type && healingTypes.has(r.options.type));

            if (isHealingOnly && !game.user.isGM) {
                return notDiceHandlePlayerAttack(rolls, rollConfig);
            }

            const isAutoTriggered = rollConfig?.notDiceAutoTriggered ||
                rollConfig?.options?.notDiceAutoTriggered ||
                rollConfig?.event?.notDiceAutoTriggered ||
                rollConfig?.options?.event?.notDiceAutoTriggered ||
                !!hasMultipliers ||
                isHealingOnly ||
                false;

            const hasPreCalculated = rollConfig?.notDicePreCalculatedTotals ||
                rollConfig?.options?.notDicePreCalculatedTotals ||
                rollConfig?.event?.options?.notDicePreCalculatedTotals ||
                false;

            // Si es una tirada manual de daño (no auto-disparada y sin totales precalculados), abrimos el diálogo de daño personalizado en la pantalla del usuario
            if (!isAutoTriggered && !hasPreCalculated) {
                const subject = rollConfig?.subject;
                const item = subject?.item || (subject?.documentName === "Item" ? subject : null);

                if (item && typeof globalThis.notDiceOpenDamageDialog === "function") {
                    const isCleaveAttack = rollConfig.isCleaveAttack || rollConfig.options?.isCleaveAttack || rollConfig.event?.isCleaveAttack || false;
                    const isNickAttack = rollConfig.isNickAttack || rollConfig.options?.isNickAttack || rollConfig.event?.isNickAttack || false;
                    const actor = item.actor;
                    const hasTwoWeaponStyle = actor?.items?.some(i =>
                        i.system?.identifier === "two-weapon-fighting" ||
                        i.name === "Two-Weapon Fighting" ||
                        (i.name.toLowerCase().includes("combate con dos armas") && i.type === "feat")
                    );
                    const isOffhandWithoutStyle = isNickAttack && !hasTwoWeaponStyle;

                    const activeMastery = globalThis.notDiceMasteries?.getActiveMastery(item, actor) || null;
                    let masteryAlreadyUsed = false;
                    if (activeMastery && actor) {
                        let flagKey = "";
                        if (activeMastery.id === "cleave") flagKey = `lastCleave-${actor.id}`;
                        else if (activeMastery.id === "nick") flagKey = `lastNick-${actor.id}`;

                        if (flagKey) {
                            const lastTurn = actor.getFlag("not-dice", flagKey);
                            const currentTurn = game.combat
                                ? `${game.combat.id}-${game.combat.round ?? 0}-${game.combat.turn ?? 0}`
                                : Date.now();

                            masteryAlreadyUsed = game.combat
                                ? lastTurn === currentTurn
                                : (typeof lastTurn === "number" && (Date.now() - lastTurn) < 6000);
                        }
                    }

                    const baseWeaponRows = notDiceExtractDamageRows(item);
                    const baseWeaponPartsCount = baseWeaponRows.length;

                    const requestedDamageParts = rolls.map((r, i) => {
                        let f = r.formula;
                        if (isCleaveAttack || isOffhandWithoutStyle) {
                            const abilityId = item.abilityMod || item.system?.ability || (item.system?.properties?.has("fin") ? (actor?.system?.abilities?.dex?.mod > actor?.system?.abilities?.str?.mod ? "dex" : "str") : "str");
                            const mod = actor?.system?.abilities?.[abilityId]?.mod ?? 0;
                            const negativeMod = mod < 0 ? mod : 0;
                            f = notDiceExtractDiceOnly(item, f, negativeMod);
                        }
                        return {
                            formula: f,
                            type: r.options?.type || "",
                            availableTypes: r.options?.availableTypes || [],
                            weaponDamage: i < baseWeaponPartsCount
                        };
                    });

                    globalThis.notDiceOpenDamageDialog({
                        uuid: item.uuid,
                        itemName: item.name,
                        targetIds: Array.from(game.user.targets ?? []).map(t => t.id),
                        targetUserId: notDiceFirstActiveGmId(),
                        senderName: game.user?.name || "Jugador",
                        requestedDamageParts: requestedDamageParts,
                        isCleaveAttack: isCleaveAttack,
                        isNickAttack: isNickAttack,
                        masteryAlreadyUsed: masteryAlreadyUsed
                    });
                } else {
                    ui.notifications?.warn("Not Dice | No se pudo abrir el diálogo de daño personalizado.");
                }
                return [];
            }

            // Si es auto-disparada o precalculada, la resolución final recae en el GM
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
                        buttons: { ok: { label: "<i class='fas fa-check'></i> Entendido", callback: () => { } } },
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

    if (message.getFlag("not-dice", "attackRoll") && !html.querySelector(".not-dice-chat-attack-mode")) {
        const host = html.querySelector(".message-content") || html;
        const btnDiv = document.createElement("div");
        btnDiv.className = "not-dice-chat-attack-mode";
        btnDiv.style.cssText = "display:flex; gap:6px; margin-top:6px; padding:6px 4px 2px; border-top:1px solid rgba(128,128,128,0.25);";
        btnDiv.innerHTML = `
            <button type="button" class="not-dice-chat-disadvantage" style="flex:1; padding:5px 8px; border:1px solid rgba(197,34,31,0.4); border-radius:6px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer; font-size:0.85em; font-weight:bold;">
                <i class="fas fa-arrow-down"></i> Desventaja
            </button>
            <button type="button" class="not-dice-chat-advantage" style="flex:1; padding:5px 8px; border:1px solid rgba(19,115,51,0.4); border-radius:6px; background:rgba(19,115,51,0.1); color:#4caf50; cursor:pointer; font-size:0.85em; font-weight:bold;">
                <i class="fas fa-arrow-up"></i> Ventaja
            </button>
        `;
        host.appendChild(btnDiv);
    }
});

const notDiceApplyChatAttackMode = async (message, mode) => {
    const itemUuid = message.getFlag("not-dice", "itemUuid");
    const handlers = globalThis._notDiceAttackModeHandlers || {};
    const messageHandler = message?.id ? handlers[`msg:${message.id}`] : null;
    const itemHandler = itemUuid ? handlers[itemUuid] : null;
    const handler = messageHandler || itemHandler;

    if (handler) {
        await handler(mode);
        return;
    }

    if (game.user.isGM) {
        ui.notifications?.warn("Not Dice | La caja de ataque del GM no esta abierta para sincronizar ventaja/desventaja.");
        return;
    }

    const gmId = notDiceFirstActiveGmId();
    if (!gmId || !game.socket) {
        ui.notifications?.warn("Not Dice | No hay GM activo para aplicar ventaja/desventaja.");
        return;
    }

    game.socket.emit("module.not-dice", {
        type: "not-dice.chat-attack-mode",
        mode: mode === "disadvantage" ? "disadvantage" : "advantage",
        itemUuid,
        messageId: message?.id || null,
        targetUserId: gmId,
        senderUserId: game.user.id,
        senderName: game.user.name
    });

    ui.notifications?.info(`Not Dice | Solicitud de ${mode === "advantage" ? "Ventaja" : "Desventaja"} enviada al GM.`);
};

Hooks.on("renderChatMessage", (message, html, data) => {
    // --- Player Color Background ---
    if (game.settings.get("not-dice", "enablePlayerColorChat")) {
        const author = message.author || message.user;
        if (author && author.color) {
            const colorVal = author.color.css || (typeof author.color === "string" ? author.color : author.color.toString());
            if (colorVal && colorVal.startsWith("#")) {
                const r = parseInt(colorVal.slice(1, 3), 16) || 0;
                const g = parseInt(colorVal.slice(3, 5), 16) || 0;
                const b = parseInt(colorVal.slice(5, 7), 16) || 0;
                html[0].style.boxShadow = `inset 0 0 15px rgba(${r}, ${g}, ${b}, 0.5), inset 0 0 40px rgba(${r}, ${g}, ${b}, 0.1)`;
                html[0].style.borderColor = colorVal;
            }
        }
    }

    if (message.getFlag("not-dice", "attackRoll") && html.find(".not-dice-chat-attack-mode").length === 0) {
        const btnHtml = `
            <div class="not-dice-chat-attack-mode" style="display:flex; gap:6px; margin-top:6px; padding:6px 4px 2px; border-top:1px solid rgba(128,128,128,0.25);">
                <button type="button" class="not-dice-chat-disadvantage" style="flex:1; padding:5px 8px; border:1px solid rgba(197,34,31,0.4); border-radius:6px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer; font-size:0.85em; font-weight:bold;">
                    <i class="fas fa-arrow-down"></i> Desventaja
                </button>
                <button type="button" class="not-dice-chat-advantage" style="flex:1; padding:5px 8px; border:1px solid rgba(19,115,51,0.4); border-radius:6px; background:rgba(19,115,51,0.1); color:#4caf50; cursor:pointer; font-size:0.85em; font-weight:bold;">
                    <i class="fas fa-arrow-up"></i> Ventaja
                </button>
            </div>
        `;
        const contentNode = html.find(".message-content");
        if (contentNode.length) contentNode.append(btnHtml);
        else html.append(btnHtml);
    }

    html.off("click.notDiceChatAttackMode", ".not-dice-chat-disadvantage");
    html.off("click.notDiceChatAttackMode", ".not-dice-chat-advantage");

    html.on("click.notDiceChatAttackMode", ".not-dice-chat-disadvantage", async (ev) => {
        ev.preventDefault();
        await notDiceApplyChatAttackMode(message, "disadvantage");
    });

    html.on("click.notDiceChatAttackMode", ".not-dice-chat-advantage", async (ev) => {
        ev.preventDefault();
        await notDiceApplyChatAttackMode(message, "advantage");
    });


    html.find(".not-dice-topple-save").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const actorId = btn.dataset.actorId;

        const actor = game.actors.get(actorId) || canvas.tokens.placeables.find(t => t.actor?.id === actorId)?.actor;
        if (!actor) return ui.notifications.warn("Not Dice | Actor no encontrado.");

        try {
            await actor.rollSavingThrow({ ability: "con", event: ev });
        } catch (e) {
            if (typeof actor.rollAbilitySave === "function") {
                await actor.rollAbilitySave("con", { event: ev });
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
        const damageType = btn.dataset.damageType;

        if (!faces) return;

        const rollObj = new Roll(`1d${faces}`);
        if (globalThis.notDiceApplyColorset) globalThis.notDiceApplyColorset(rollObj, damageType);
        const rDie = await rollObj.evaluate();
        const newDieResult = rDie.total;

        let newTotal = newDieResult;
        let modifier = 0;

        if (uuid && idx !== undefined) {
            if (globalThis._notDiceUpdatePiercerTotal && globalThis._notDiceUpdatePiercerTotal[uuid]) {
                const resultObj = globalThis._notDiceUpdatePiercerTotal[uuid](idx, original, newDieResult);
                if (resultObj) {
                    newTotal = resultObj.current;
                    modifier = resultObj.previous - original;
                }
            } else {
                game.socket.emit("module.not-dice", {
                    type: "not-dice.update-piercer-total",
                    uuid: uuid,
                    idx: idx,
                    original: original,
                    newDieResult: newDieResult
                });
            }
        }

        let displayRoll;
        if (modifier !== 0) {
            const sign = modifier >= 0 ? "+" : "-";
            const displayRollObj = new Roll(`1d${faces} ${sign} ${Math.abs(modifier)}`);
            if (globalThis.notDiceApplyColorset) globalThis.notDiceApplyColorset(displayRollObj, damageType);
            displayRoll = await displayRollObj.evaluate();
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

    html.find(".not-dice-savage-reroll").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const uuid = btn.dataset.uuid;
        const idx = btn.dataset.idx;
        const formula = atob(btn.dataset.formula);
        const flavorBase = atob(btn.dataset.flavor);
        const damageLabel = atob(btn.dataset.damagelabel || "");
        const modsString = atob(btn.dataset.mods || "");
        const originalTotal = parseInt(btn.dataset.original);
        const damageType = btn.dataset.damageType;

        if (!formula) return;

        const item = await fromUuid(uuid);
        if (item?.actor && globalThis.notDiceEspeciales) {
            try {
                await globalThis.notDiceEspeciales.useSavageAttacker(item.actor);
            } catch (err) {
                console.warn("Not Dice | Error setting Savage Attacker flag (User may lack permission):", err);
            }
        }

        const rollObj = new Roll(formula);
        if (globalThis.notDiceApplyColorset) globalThis.notDiceApplyColorset(rollObj, damageType);
        const rNew = await rollObj.evaluate();
        const newTotal = rNew.total;

        let finalTotal = originalTotal;
        if (newTotal > originalTotal) {
            finalTotal = newTotal;
            if (globalThis._notDiceUpdateSavageTotal && globalThis._notDiceUpdateSavageTotal[uuid]) {
                globalThis._notDiceUpdateSavageTotal[uuid](idx, finalTotal);
            } else {
                game.socket.emit("module.not-dice", {
                    type: "not-dice.update-savage-total",
                    uuid: uuid,
                    idx: idx,
                    total: finalTotal
                });
            }
        }

        const isNewBetter = newTotal > originalTotal;
        const styleBase = "padding:4px 8px; cursor:pointer; transition:all 0.2s; border: 1px solid var(--color-border-light-2, #ccc); border-radius:4px;";
        const styleSelected = "background: rgba(19,115,51,0.2); border-color: #4caf50; box-shadow: inset 0 0 4px rgba(19,115,51,0.5); font-weight: bold; opacity: 1;";
        const styleUnselected = "background: rgba(127,127,127,0.1); font-weight: normal; opacity: 0.8;";

        const choicesHtml = `
            <div style="margin-top: 8px; text-align:center;">
                <p style="margin-bottom: 4px; font-weight:bold;">Atacante Salvaje: Elige el daño</p>
                <div class="not-dice-savage-choice-container" style="display:flex; gap:6px; justify-content:center;">
                    <button type="button" class="not-dice-savage-choice ${!isNewBetter ? 'selected' : ''}" data-uuid="${uuid}" data-idx="${idx}" data-total="${originalTotal}" style="${styleBase} ${!isNewBetter ? styleSelected : styleUnselected}">Original: ${originalTotal}</button>
                    <button type="button" class="not-dice-savage-choice ${isNewBetter ? 'selected' : ''}" data-uuid="${uuid}" data-idx="${idx}" data-total="${newTotal}" style="${styleBase} ${isNewBetter ? styleSelected : styleUnselected}">Nuevo: ${newTotal}</button>
                </div>
            </div>
        `;

        await rNew.toMessage({
            speaker: message.speaker,
            flavor: `<strong>${flavorBase}</strong> • ${item?.name || "Daño"} <span style="opacity:0.75;">(${damageLabel})</span>${modsString}${choicesHtml}`
        });

        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.textDecoration = "line-through";
        btn.innerHTML = `<i class="fas fa-paw"></i> Atacante Salvaje (Usado)`;
    });

    html.find(".not-dice-savage-choice").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;

        const container = btn.closest('.not-dice-savage-choice-container');
        if (container) {
            container.querySelectorAll('.not-dice-savage-choice').forEach(b => {
                b.style.background = "rgba(127,127,127,0.1)";
                b.style.borderColor = "var(--color-border-light-2, #ccc)";
                b.style.boxShadow = "none";
                b.style.fontWeight = "normal";
                b.style.opacity = "0.8";
                b.classList.remove('selected');
            });
            btn.style.background = "rgba(19,115,51,0.2)";
            btn.style.borderColor = "#4caf50";
            btn.style.boxShadow = "inset 0 0 4px rgba(19,115,51,0.5)";
            btn.style.fontWeight = "bold";
            btn.style.opacity = "1";
            btn.classList.add('selected');
        }
        const uuid = btn.dataset.uuid;
        const idx = btn.dataset.idx;
        const total = parseInt(btn.dataset.total);

        if (globalThis._notDiceUpdateSavageTotal && globalThis._notDiceUpdateSavageTotal[uuid]) {
            globalThis._notDiceUpdateSavageTotal[uuid](idx, total);
            ui.notifications?.info(`Not Dice | Daño actualizado a ${total}`);
        } else {
            game.socket.emit("module.not-dice", {
                type: "not-dice.update-savage-total",
                uuid: uuid,
                idx: idx,
                total: total
            });
            ui.notifications?.info(`Not Dice | Daño actualizado (enviado al GM).`);
        }
    });

    html.find(".not-dice-cleave-attack-btn").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const attackerId = btn.dataset.attackerId;
        const weaponUuid = btn.dataset.weaponUuid;
        const actor = game.actors.get(attackerId) || canvas.tokens.placeables.find(t => t.actor?.id === attackerId)?.actor;

        if (!actor) return ui.notifications.warn("Not Dice | Actor no encontrado.");
        if (!actor.isOwner && !game.user.isGM) return ui.notifications.warn("Not Dice | No tienes permiso para controlar este personaje.");

        const targets = Array.from(game.user.targets);
        if (targets.length === 0) {
            return ui.notifications.warn("Not Dice | Selecciona primero un nuevo objetivo.");
        }

        const weapon = await fromUuid(weaponUuid);
        if (!weapon) return ui.notifications.warn("Not Dice | Arma no encontrada.");

        const attackActivity = weapon.system.activities?.find(a => a.type === "attack");
        if (!attackActivity) return ui.notifications.warn("Not Dice | No se encontró actividad de ataque en este objeto.");

        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.innerHTML = "<i class='fas fa-check'></i> Ataque Hender Iniciado";

        try {
            await attackActivity.rollAttack({
                event: ev,
                isCleaveAttack: true
            });
        } catch (e) {
            console.error("Not Dice | Error launching Cleave attack", e);
        }
    });

    html.find(".not-dice-nick-attack-btn").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const attackerId = btn.dataset.attackerId;
        const weaponUuid = btn.dataset.weaponUuid;
        const actor = game.actors.get(attackerId) || canvas.tokens.placeables.find(t => t.actor?.id === attackerId)?.actor;

        if (!actor) return ui.notifications.warn("Not Dice | Actor no encontrado.");
        if (!actor.isOwner && !game.user.isGM) return ui.notifications.warn("Not Dice | No tienes permiso para controlar este personaje.");

        const targets = Array.from(game.user.targets);
        if (targets.length === 0) {
            return ui.notifications.warn("Not Dice | Selecciona primero un nuevo objetivo.");
        }

        const weapon = await fromUuid(weaponUuid);
        if (!weapon) return ui.notifications.warn("Not Dice | Arma no encontrada.");

        const attackActivity = weapon.system.activities?.find(a => a.type === "attack");
        if (!attackActivity) return ui.notifications.warn("Not Dice | No se encontró actividad de ataque en este objeto.");

        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.innerHTML = "<i class='fas fa-check'></i> Ataque Mellar Iniciado";

        try {
            await attackActivity.rollAttack({
                event: ev,
                isNickAttack: true
            });
        } catch (e) {
            console.error("Not Dice | Error launching Nick attack", e);
        }
    });

    html.find(".not-dice-graze-apply-btn").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        if (btn.disabled) return;

        const attackerId = btn.dataset.attackerId;
        const attacker = game.actors.get(attackerId) || canvas.tokens.placeables.find(t => t.actor?.id === attackerId)?.actor;
        if (!attacker) return ui.notifications.warn("Not Dice | Actor no encontrado.");
        if (!attacker.isOwner && !game.user.isGM) return ui.notifications.warn("Not Dice | No tienes permiso para controlar este personaje.");

        const targetIds = btn.dataset.targetIds.split(",");
        const abilityMod = parseInt(btn.dataset.abilityMod) || 0;
        const damageType = btn.dataset.damageType;
        const weaponName = btn.dataset.weaponName;
        const weaponUuid = btn.dataset.weaponUuid;

        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.innerHTML = "<i class='fas fa-check'></i> Rozar Iniciado";

        if (game.user.isGM) {
            const item = weaponUuid ? await fromUuid(weaponUuid) : null;
            const activity = item?.system?.activities?.find(a => a.type === "save" || a.type === "damage" || a.type === "attack")
                || (item?.system?.activities?.size > 0 ? item.system.activities.first() : null)
                || item;

            if (!item || !activity) return ui.notifications?.warn("Not Dice | No se pudo recuperar el arma/actividad para Rozar.");

            await activity.rollDamage({
                event: notDiceMockEvent({ targetIds: targetIds }),
                options: {
                    notDiceAutoTriggered: true,
                    notDicePreCalculatedTotals: [abilityMod],
                    notDicePreCalculatedParts: [{ formula: abilityMod.toString(), type: damageType }],
                    notDiceMultipliers: {},
                    notDiceApplyMastery: false
                }
            });
        } else {
            const gmId = notDiceFirstActiveGmId();
            if (!gmId || !game.socket) {
                ui.notifications.warn("Not Dice | No hay ningún GM activo para aplicar el daño.");
                btn.disabled = false;
                btn.style.opacity = "1";
                btn.innerHTML = "<i class='fas fa-gavel'></i> Aplicar Rozar";
                return;
            }
            game.socket.emit("module.not-dice", {
                type: "not-dice.apply-graze",
                attackerId,
                targetIds,
                abilityMod,
                damageType,
                weaponName,
                weaponUuid,
                senderName: game.user.name,
                targetUserId: gmId
            });
            ui.notifications.info("Not Dice | Solicitud de Rozar enviada al GM.");
        }
    });
});

Hooks.on("preUpdateCombat", (combat, updateData, options, userId) => {
    // Solo actuar si el turno o la ronda están a punto de cambiar
    const turnChanging = updateData.hasOwnProperty("turn");
    const roundChanging = updateData.hasOwnProperty("round");
    if (turnChanging || roundChanging) {
        combat._notDiceEndingCombatState = {
            actorId: combat.combatant?.actor?.id || null,
            actorName: combat.combatant?.actor?.name || null,
            round: combat.round,
            turn: combat.turn
        };
    }
});

Hooks.on("updateCombat", async (combat, changed, options, userId) => {
    if (!game.user.isGM) return;

    // Solo actuar si el turno o la ronda han cambiado
    const turnChanged = changed.hasOwnProperty("turn");
    const roundChanged = changed.hasOwnProperty("round");
    if (!turnChanged && !roundChanged) return;

    const currentRound = combat.round;
    const currentTurn = combat.turn;

    // 1. Obtener datos del combatiente que acaba de comenzar su turno (para condición 2 de Debilitar)
    const startingCombatant = combat.combatant;
    const startingActorId = startingCombatant?.actor?.id || null;
    const lowerStartingActorName = (startingCombatant?.actor?.name || "").toLowerCase();

    // 2. Obtener los datos del turno que acaba de terminar (para condición 2 de Molestar)
    const endingState = combat._notDiceEndingCombatState;
    delete combat._notDiceEndingCombatState; // Limpiar

    const previousActorId = endingState?.actorId || null;
    const lowerAttackerName = (endingState?.actorName || "").toLowerCase();
    const endingRound = endingState?.round;
    const endingTurn = endingState?.turn;

    // Recorrer todos los combatientes para buscar y procesar efectos de maestría
    for (const combatant of combat.combatants) {
        const targetActor = combatant.actor;
        if (!targetActor) continue;

        const getActorEffects = globalThis.notDiceGetActorEffects;
        const effects = typeof getActorEffects === "function"
            ? getActorEffects(targetActor)
            : Array.from(targetActor.appliedEffects || targetActor.effects || []);

        const masteryEffects = effects.filter(e => {
            return notDiceIsVexEffect(e) || notDiceIsSapEffect(e) || notDiceIsSlowEffect(e);
        });

        for (const e of masteryEffects) {
            const eName = (e.name || e.label || "").toLowerCase();
            const flags = e.flags?.["not-dice"] || e.getFlag?.("not-dice") || {};
            const isVex = notDiceIsVexEffect(e);
            const isSap = notDiceIsSapEffect(e);
            const isSlow = notDiceIsSlowEffect(e);

            const appliedRound = flags.appliedRound;
            const appliedTurn = flags.appliedTurn;
            const appliedActorId = flags.appliedActorId;

            // Si no tiene tracking de inicio, lo hacemos expirar
            if (appliedRound === undefined || appliedTurn === undefined) {
                await targetActor.deleteEmbeddedDocuments("ActiveEffect", [e.id]);
                continue;
            }

            // Condición 4: Pasa más de una ronda del turno en donde se recibió el efecto y este sigue activo
            const roundsDiff = currentRound - appliedRound;
            let roundsExceeded = false;
            if (roundsDiff > 1) {
                roundsExceeded = true;
            } else if (roundsDiff === 1) {
                if (currentTurn > appliedTurn) {
                    roundsExceeded = true;
                }
            }

            if (roundsExceeded) {
                await targetActor.deleteEmbeddedDocuments("ActiveEffect", [e.id]);
                let effectType = "Molestar";
                if (isSap) effectType = "Debilitar";
                else if (isSlow) effectType = "Ralentizar";
                ui.notifications?.info(`Not Dice | ${effectType} Expirado (más de 1 ronda transcurrida) en ${targetActor.name}`);
                continue;
            }

            // Condición 2 para Molestar: Luego de un cambio de turno, la próxima vez que el actor que lo aplicó termine un turno
            if (isVex && previousActorId && (appliedActorId === previousActorId || eName.includes(`(${lowerAttackerName})`))) {
                const wasAppliedOnEndingTurn = Number(appliedRound) === Number(endingRound) && Number(appliedTurn) === Number(endingTurn);
                if (!wasAppliedOnEndingTurn) {
                    await targetActor.deleteEmbeddedDocuments("ActiveEffect", [e.id]);
                    ui.notifications?.info(`Not Dice | Molestar Expirado: ${e.name} en ${targetActor.name}`);
                    continue;
                }
            }

            // Condición 2 para Debilitar / Ralentizar: La próxima vez que el actor que lo aplicó comience un turno
            if ((isSap || isSlow) && startingActorId && (appliedActorId === startingActorId || eName.includes(`(${lowerStartingActorName})`))) {
                const wasAppliedOnCurrentTurn = Number(appliedRound) === Number(currentRound) && Number(appliedTurn) === Number(currentTurn);
                if (!wasAppliedOnCurrentTurn) {
                    await targetActor.deleteEmbeddedDocuments("ActiveEffect", [e.id]);
                    ui.notifications?.info(`Not Dice | ${isSap ? "Debilitar" : "Ralentizar"} Expirado: ${e.name} en ${targetActor.name}`);
                }
            }
        }
    }
});

Hooks.on("deleteCombat", async (combat, options, userId) => {
    if (!game.user.isGM) return;

    for (const combatant of combat.combatants) {
        const targetActor = combatant.actor;
        if (!targetActor) continue;

        const getActorEffects = globalThis.notDiceGetActorEffects;
        const effects = typeof getActorEffects === "function"
            ? getActorEffects(targetActor)
            : Array.from(targetActor.appliedEffects || targetActor.effects || []);

        const masteryEffects = effects.filter(e => {
            return notDiceIsVexEffect(e) || notDiceIsSapEffect(e) || notDiceIsSlowEffect(e);
        });

        if (masteryEffects.length > 0) {
            const idsToDelete = masteryEffects.map(e => e.id);
            await targetActor.deleteEmbeddedDocuments("ActiveEffect", idsToDelete);
        }
    }
});

Hooks.on("updateActiveEffect", (effect, changed, options, userId) => {
    if (!game.user.isGM) return;

    // Verificar si el efecto ha sido desactivado
    if (changed.hasOwnProperty("disabled") && changed.disabled === true) {
        const name = (effect.name || effect.label || "").toLowerCase();
        const flags = effect.flags?.["not-dice"] || effect.getFlag?.("not-dice") || {};

        const isMasteryEffect = notDiceIsVexEffect(effect) || notDiceIsSapEffect(effect) || notDiceIsSlowEffect(effect);

        if (isMasteryEffect) {
            const actor = effect.parent;
            if (actor && actor.documentName === "Actor") {
                // Eliminar el documento del efecto por completo tras un breve delay para evitar colisiones
                setTimeout(async () => {
                    try {
                        const existingEffect = actor.effects.get(effect.id);
                        if (existingEffect) {
                            await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
                            console.log(`Not Dice | Deleted disabled/expired mastery effect: ${effect.name}`);
                        }
                    } catch (e) {
                        console.error("Not Dice | Error deleting disabled mastery effect", e);
                    }
                }, 100);
            }
        }
    }
});

Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
    if (!game.user.isGM) return;

    const isSlow = notDiceIsSlowEffect(effect);

    if (!isSlow) return;

    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;

    // Verificar si el efecto eliminado era el que tenía los cambios de movimiento
    const hadChanges = effect.changes && effect.changes.some(c => c.key?.startsWith("system.attributes.movement."));
    if (!hadChanges) return;

    // Obtener los efectos restantes
    const getActorEffects = globalThis.notDiceGetActorEffects;
    const effects = typeof getActorEffects === "function"
        ? getActorEffects(actor)
        : Array.from(actor.appliedEffects || actor.effects || []);

    const remainingSlows = effects.filter(e => {
        return e.id !== effect.id && notDiceIsSlowEffect(e);
    });

    if (remainingSlows.length === 0) return;

    // Verificar si alguno de los restantes ya tiene cambios (por si acaso)
    const alreadyHasChanges = remainingSlows.some(e => e.changes && e.changes.some(c => c.key?.startsWith("system.attributes.movement.")));
    if (alreadyHasChanges) return;

    // Transferir los cambios al primer efecto de ralentizar restante
    const slowToUpdate = remainingSlows[0];
    const changes = [
        { key: "system.attributes.movement.walk", mode: 2, value: "-10" },
        { key: "system.attributes.movement.fly", mode: 2, value: "-10" },
        { key: "system.attributes.movement.swim", mode: 2, value: "-10" },
        { key: "system.attributes.movement.climb", mode: 2, value: "-10" },
        { key: "system.attributes.movement.burrow", mode: 2, value: "-10" }
    ];

    try {
        await slowToUpdate.update({ changes });
        console.log(`Not Dice | Transferred Slow changes to remaining effect: ${slowToUpdate.name} on ${actor.name}`);
    } catch (err) {
        console.error("Not Dice | Error transferring Slow changes", err);
    }
});


