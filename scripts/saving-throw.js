// ============================================================
// not-dice | saving-throw.js (Foundry V14 + D&D5e v4)
// Detecta áreas de efecto interceptando la creación de Regiones
// y Plantillas en el Canvas (garantizando que la geometría exista).
// Incluye traducción de MyMemory en tiempo real, UI interactiva
// y aplicación de Efectos Activos.
// ============================================================

Hooks.once("init", () => {
    console.log("Not Dice | Módulo inicializado (Traducción y UI Interactiva Activas).");

    // Configuración para activar/desactivar la intercepción de áreas
    game.settings.register("not-dice", "enableTemplateIntercept", {
        name: "Detectar Área de Efecto",
        hint: "Muestra un diálogo con los tokens afectados al colocar una plantilla.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    // Configuración para habilitar/deshabilitar la traducción
    game.settings.register("not-dice", "enableTranslation", {
        name: "Habilitar Traducción de Descripciones",
        hint: "Traduce automáticamente la descripción de los hechizos al español usando MyMemory.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    // Configuración para el email de MyMemory (aumenta límite de palabras)
    game.settings.register("not-dice", "myMemoryEmail", {
        name: "Email para MyMemory (Opcional)",
        hint: "Ingresa tu email para aumentar el límite de uso diario de la API gratuita de MyMemory.",
        scope: "client",
        config: true,
        type: String,
        default: ""
    });
});

// 1. Espera a que el objeto visual se cargue en el canvas
const waitForAreaObject = (document) => {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 60; // Máximo 3 segundos

        const interval = setInterval(() => {
            attempts++;
            if (document.object && (typeof document.testPoint === "function" || typeof document.object.testPoint === "function" || document.object.shape)) {
                clearInterval(interval);
                resolve(document.object);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                resolve(document.object || null);
            }
        }, 50);
    });
};

// 2. Medir colisiones V14
const getTokensInsideArea = (areaObj) => {
    const caughtTokens = [];
    if (!areaObj) return caughtTokens;

    for (const token of canvas.tokens.placeables) {
        if (!token.actor) continue;

        const point = {
            x: token.center.x,
            y: token.center.y,
            elevation: token.document.elevation ?? 0
        };

        let isInside = false;

        if (typeof areaObj.document?.testPoint === "function") {
            isInside = areaObj.document.testPoint(point);
        } else if (typeof areaObj.testPoint === "function") {
            isInside = areaObj.testPoint(point);
        } else if (areaObj.shape && typeof areaObj.shape.contains === "function") {
            const localX = point.x - areaObj.document.x;
            const localY = point.y - areaObj.document.y;
            isInside = areaObj.shape.contains(localX, localY);
        }

        if (isInside) {
            caughtTokens.push(token);
        }
    }

    return caughtTokens;
};

// 3. Sistema de Traducción Asíncrona (MyMemory API)
async function translateAndUpdate(htmlDesc, targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;

    // Limpiamos etiquetas HTML para extraer el texto puro y no romper la API
    let plainText = htmlDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plainText) {
        el.innerHTML = "Sin descripción.";
        return;
    }

    // Obtenemos el email de las configuraciones
    const email = game.settings.get("not-dice", "myMemoryEmail").trim();
    const emailParam = email ? `&de=${encodeURIComponent(email)}` : "";

    // Dividimos el texto en trozos de ~450 caracteres.
    const chunks = plainText.match(/.{1,450}(?:\s|$)/g) || [plainText];

    // Traducimos máximo 2 bloques (~900 chars).
    const maxChunks = Math.min(chunks.length, 2);
    let finalTranslation = "";

    for (let i = 0; i < maxChunks; i++) {
        try {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunks[i].trim())}&langpair=en|es${emailParam}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data?.responseData?.translatedText) {
                finalTranslation += `<p style="margin-bottom: 4px;">${data.responseData.translatedText}</p>`;
            } else {
                finalTranslation += `<p>${chunks[i]}</p>`; // Fallback al texto original si falla
            }
        } catch (error) {
            console.error("Not Dice | Error en la API de MyMemory:", error);
            if (i === 0) finalTranslation = "<p><em>Error de red al intentar traducir.</em></p>";
            break;
        }
    }

    if (chunks.length > 2) {
        finalTranslation += `<p style="color: #888; font-style: italic;">[...] Traducción truncada para proteger el límite de la API gratuita.</p>`;
    }

    el.innerHTML = finalTranslation;
}

// 4. Interceptar la creación
async function handleAreaCreation(document, userId, tipoLog) {
    if (!game.users.activeGM?.isSelf) return; // Solo el GM activo debe procesar y ver este diálogo
    if (!game.settings.get("not-dice", "enableTemplateIntercept")) return;

    const originUuid = document.flags?.dnd5e?.origin;
    if (!originUuid) return;

    let spellData = {
        originUuid: originUuid,
        userId: userId,
        name: "Área de Efecto",
        caster: "Desconocido",
        img: "icons/magic/light/explosion-star-glow-blue-yellow.webp",
        level: "Desconocido",
        saveAbilityKey: "", // Clave pura para sacar el modificador (ej. "dex")
        saveAbility: "",
        saveDC: "",
        description: "",
        effects: [], // Array para guardar los Efectos Activos extraídos
        hasDamage: false, // Bandera para saber si el hechizo hace daño
        damageLabels: [] // Textos del daño
    };

    try {
        const item = await fromUuid(originUuid);
        if (item) {
            const actualItem = item.item || item;
            spellData.name = actualItem.name || spellData.name;
            spellData.caster = actualItem.actor?.name || "Desconocido";
            spellData.img = actualItem.img || spellData.img;
            spellData.description = actualItem.system?.description?.value || "<p>Sin descripción.</p>";

            if (actualItem.type === "spell") {
                spellData.level = actualItem.system?.level === 0 ? "Truco" : `Nivel ${actualItem.system?.level}`;
            } else {
                spellData.level = "Habilidad / Objeto";
            }

            let saveActivity = null;

            if (actualItem.system?.activities) {
                saveActivity = actualItem.system.activities.contents?.find(a => a.type === "save")
                    || actualItem.system.activities.getByType?.("save")?.[0]
                    || (item.type === "save" ? item : null);

                if (saveActivity) {
                    const abilitySet = saveActivity.save?.ability;
                    const ability = abilitySet ? (abilitySet instanceof Set ? Array.from(abilitySet)[0] : (Array.isArray(abilitySet) ? abilitySet[0] : abilitySet)) : null;
                    if (ability && typeof ability === 'string') {
                        spellData.saveAbilityKey = ability;
                        spellData.saveAbility = CONFIG.DND5E?.abilities?.[ability]?.label || ability.toUpperCase();
                    }

                    if (saveActivity.save?.dc?.value) {
                        spellData.saveDC = saveActivity.save.dc.value;
                    } else if (actualItem.actor && actualItem.actor.system?.attributes?.spelldc) {
                        spellData.saveDC = actualItem.actor.system.attributes.spelldc;
                    }
                }
            } else if (actualItem.system?.save?.ability) {
                const ability = actualItem.system.save.ability;
                spellData.saveAbilityKey = ability;
                spellData.saveAbility = CONFIG.DND5E?.abilities?.[ability]?.label || ability.toUpperCase();
                spellData.saveDC = actualItem.system?.save?.dc || "";
            }

            // --- EXTRACCIÓN DE DAÑO ---
            spellData.damageLabels = [];
            let hasParts = false;
            
            if (actualItem.system?.activities) {
                for (const act of actualItem.system.activities.values()) {
                    if (act.damage && act.damage.parts && act.damage.parts.length > 0) {
                        spellData.hasDamage = true;
                        hasParts = true;
                        for (const p of act.damage.parts) {
                            let formula = "";
                            let type = "";
                            if (Array.isArray(p)) {
                                formula = p[0] || "";
                                type = p[1] || "";
                            } else {
                                formula = p.formula || (p.number && p.denomination ? `${p.number}d${p.denomination}${p.bonus ? '+' + p.bonus : ''}` : p.custom?.formula) || "";
                                type = p.types && p.types.size > 0 ? Array.from(p.types)[0] : (Array.isArray(p.types) ? p.types[0] : "");
                            }
                            if (formula) spellData.damageLabels.push({ formula: formula.trim(), type: type.trim().toLowerCase() });
                        }
                    }
                }
            } else if (actualItem.system?.damage?.parts && actualItem.system.damage.parts.length > 0) {
                spellData.hasDamage = true;
                hasParts = true;
                for (const p of actualItem.system.damage.parts) {
                    if (Array.isArray(p) && p[0]) {
                        spellData.damageLabels.push({ formula: p[0].trim(), type: (p[1] || "").trim().toLowerCase() });
                    }
                }
            }
            
            if (!hasParts && actualItem.labels?.damage) {
                spellData.hasDamage = true;
                spellData.damageLabels.push({ formula: actualItem.labels.damage, type: "" });
            }

            // --- EXTRACCIÓN DE EFECTOS ---
            if (actualItem.effects && actualItem.effects.size > 0) {
                let validEffectIds = null;
                // Si la actividad especifica qué efectos aplica, filtramos por ellos
                if (saveActivity && saveActivity.effects && saveActivity.effects.length > 0) {
                    validEffectIds = saveActivity.effects.map(e => e._id);
                }

                actualItem.effects.forEach(eff => {
                    if (eff.transfer) return; // Ignoramos efectos pasivos del lanzador
                    if (validEffectIds && !validEffectIds.includes(eff.id)) return;

                    spellData.effects.push({
                        id: eff.id,
                        name: eff.name,
                        img: eff.icon || eff.img,
                        data: eff.toObject() // Objeto de datos puro para inyectar después
                    });
                });
            }
        }
    } catch (error) {
        console.error("Not Dice | Fallo al procesar el ítem:", error);
    }

    const areaObj = await waitForAreaObject(document);
    const caughtTokens = getTokensInsideArea(areaObj);
    showCaughtTokensDialog(spellData, caughtTokens, document);
}

Hooks.on("createRegion", async (document, operation, userId) => handleAreaCreation(document, userId, "createRegion"));
Hooks.on("createMeasuredTemplate", async (document, operation, userId) => handleAreaCreation(document, userId, "createMeasuredTemplate"));

// 5. Mostrar la UI
const showCaughtTokensDialog = (spellData, tokens, templateDocument) => {
    const { name, caster, img, level, saveAbilityKey, saveAbility, saveDC, description, effects } = spellData;
    const enableTranslation = game.settings.get("not-dice", "enableTranslation");
    const uniqueId = "nd-ui-" + Math.random().toString(36).substring(2, 9);

    let targetsHtml = "";

    if (tokens.length === 0) {
        targetsHtml = `<div style="text-align:center; padding: 15px; color: #666; font-style: italic;">El área está vacía. Nadie resultó afectado.</div>`;
    } else {
        targetsHtml = tokens.map(t => {
            const tokenImg = t.document.texture?.src || t.actor.img;

            // Determinar el modificador de salvación del actor para este hechizo
            let saveModRaw = null;
            if (saveAbilityKey) {
                const saveKey = saveAbilityKey.toLowerCase();
                const abilityObj = t.actor?.system?.abilities?.[saveKey];
                if (abilityObj) {
                    saveModRaw = abilityObj.save;
                    // Fallback si la propiedad .save no existe directamente en el actor (sistemas más recientes sin datos derivados en este punto)
                    if (saveModRaw === undefined && abilityObj.mod !== undefined) {
                        const profBonus = t.actor.system?.attributes?.prof || 0;
                        const isProf = abilityObj.proficient || 0;
                        saveModRaw = abilityObj.mod + (isProf * profBonus);
                    }
                }
            }
            const saveModFormateado = Number.isFinite(saveModRaw) ? (saveModRaw >= 0 ? `+${saveModRaw}` : saveModRaw) : "--";
            const saveText = saveAbilityKey ? `<span style="font-size:0.85em; color:#555; margin-left:4px;" title="Modificador de Salvación">(${saveModFormateado})</span>` : "";

            return `
                <div id="${uniqueId}-row-${t.id}" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; padding: 6px; border: 1px solid #ddd; border-radius: 6px; background: rgba(0,0,0,0.02); transition: opacity 0.2s;">
                    <!-- Checkbox de inclusión -->
                    <input type="checkbox" class="${uniqueId}-cb" data-token-id="${t.id}" checked style="width:16px; height:16px; cursor:pointer; margin:0;" title="Incluir objetivo">
                    
                    <img src="${tokenImg}" style="width:32px; height:32px; border-radius:50%; border:1px solid #aaa; object-fit:cover; flex-shrink:0;">
                    
                    <div style="flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        <span style="font-weight:bold; font-size:1.05em;">${t.name}</span>
                        ${saveText}
                    </div>
                    
                    <!-- Botonera Interactiva -->
                    <div style="display:flex; gap:4px; flex-shrink:0;">
                        ${saveAbilityKey ? `
                        <button class="${uniqueId}-btn-roll" data-token-id="${t.id}" title="Tirar Salvación" style="width:28px; height:28px; line-height:28px; padding:0; background:#f0f0f0; border:1px solid #bbb; border-radius:4px; cursor:pointer;">
                            <i class="fas fa-dice-d20" style="color:#222;"></i>
                        </button>
                        ` : ''}
                        <button class="${uniqueId}-btn-pass" data-token-id="${t.id}" title="Pasa" style="width:28px; height:28px; line-height:28px; padding:0; background:#f0f0f0; border:1px solid #bbb; border-radius:4px; cursor:pointer;">
                            <i class="fas fa-check" style="color:#888;"></i>
                        </button>
                        <button class="${uniqueId}-btn-fail" data-token-id="${t.id}" title="Falla" style="width:28px; height:28px; line-height:28px; padding:0; background:#f0f0f0; border:1px solid #bbb; border-radius:4px; cursor:pointer;">
                            <i class="fas fa-times" style="color:#888;"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    }

    let saveBadge = "";
    if (saveAbility) {
        saveBadge = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(128, 128, 128, 0.15); padding:6px 12px; border-radius:8px; border:2px solid rgba(128, 128, 128, 0.4); margin-left: auto; text-align:center; min-width: 90px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <span style="font-size:0.75em; text-transform:uppercase; font-weight:bold; opacity:0.8; letter-spacing:0.5px;">Salvación</span>
                <span style="font-size:1.3em; font-weight:900;">${saveAbility} ${saveDC ? `<span style="opacity:0.6;">CD</span> ${saveDC}` : ""}</span>
            </div>
        `;
    }

    let effectsBadge = "";
    if (effects && effects.length > 0) {
        const effectIcons = effects.map(e => `<img src="${e.img}" style="width:14px; height:14px; vertical-align:middle; border-radius:3px; margin-right:2px;" title="${e.name}">`).join("");
        effectsBadge = `
            <span style="display:inline-block; font-size:0.85em; background:#fce8e6; color:#c5221f; padding:3px 8px; border-radius:12px; border:1px solid #fad2cf;">
                <strong>Efectos:</strong> ${effectIcons}
            </span>
        `;
    }

    let damageBadge = "";
    if (spellData.damageLabels && spellData.damageLabels.length > 0) {
        const damageStyle = {
             acid: { color: "#aeea00", bg: "rgba(174, 234, 0, 0.15)", border: "rgba(174, 234, 0, 0.4)" },
             bludgeoning: { color: "inherit", bg: "rgba(128, 128, 128, 0.15)", border: "var(--color-border-light-2, #ccc)" },
             cold: { color: "#4fc3f7", bg: "rgba(79, 195, 247, 0.15)", border: "rgba(79, 195, 247, 0.4)" },
             fire: { color: "#ff5252", bg: "rgba(255, 82, 82, 0.15)", border: "rgba(255, 82, 82, 0.4)" },
             force: { color: "#e040fb", bg: "rgba(224, 64, 251, 0.15)", border: "rgba(224, 64, 251, 0.4)" }, 
             lightning: { color: "#ffd600", bg: "rgba(255, 214, 0, 0.15)", border: "rgba(255, 214, 0, 0.4)" },
             necrotic: { color: "#b0bec5", bg: "rgba(176, 190, 197, 0.15)", border: "rgba(176, 190, 197, 0.4)" },
             piercing: { color: "inherit", bg: "rgba(128, 128, 128, 0.15)", border: "var(--color-border-light-2, #ccc)" },
             poison: { color: "#69f0ae", bg: "rgba(105, 240, 174, 0.15)", border: "rgba(105, 240, 174, 0.4)" },
             psychic: { color: "#ff4081", bg: "rgba(255, 64, 129, 0.15)", border: "rgba(255, 64, 129, 0.4)" },
             radiant: { color: "#ffca28", bg: "rgba(255, 202, 40, 0.15)", border: "rgba(255, 202, 40, 0.4)" },
             slashing: { color: "inherit", bg: "rgba(128, 128, 128, 0.15)", border: "var(--color-border-light-2, #ccc)" },
             thunder: { color: "#7c4dff", bg: "rgba(124, 77, 255, 0.15)", border: "rgba(124, 77, 255, 0.4)" },
             healing: { color: "#69f0ae", bg: "rgba(105, 240, 174, 0.15)", border: "rgba(105, 240, 174, 0.4)" },
             temphp: { color: "inherit", bg: "rgba(128, 128, 128, 0.15)", border: "var(--color-border-light-2, #ccc)" }
        };

        damageBadge = spellData.damageLabels.map(d => {
            const style = damageStyle[d.type] || { color: "inherit", bg: "rgba(128,128,128,0.15)", border: "var(--color-border-light-2, #ccc)" };
            // Capitalizar la primera letra del tipo si existe
            const typeDisplay = d.type ? d.type.charAt(0).toUpperCase() + d.type.slice(1) : "";
            
            return `
                <span style="display:inline-block; font-size:0.85em; background:${style.bg}; color:${style.color}; padding:3px 8px; border-radius:12px; border:1px solid ${style.border}; white-space:nowrap; margin-right:4px;">
                    <strong style="color:inherit; opacity:0.9;">Daño:</strong> <span style="font-weight:bold;">${d.formula}</span> <span style="font-size:0.9em; opacity:0.8;">${typeDisplay}</span>
                </span>
            `;
        }).join("");
    } else if (spellData.hasDamage) {
        damageBadge = `
            <span style="display:inline-block; font-size:0.85em; background:rgba(128,128,128,0.15); color:inherit; opacity: 0.9; padding:3px 8px; border-radius:12px; border:1px solid var(--color-border-light-2, #ccc); white-space:nowrap;">
                <strong>Daño:</strong> Sí
            </span>
        `;
    }

    const headerHtml = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(128,128,128,0.1); box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <img src="${img}" style="width:54px; height:54px; border:1px solid var(--color-border-light-2, #aaa); border-radius:6px; object-fit:cover; flex-shrink:0;">
            <div style="flex:1; min-width:0;">
                <div style="font-size:1.2em; font-weight:bold; color:inherit; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
                <div style="font-size:0.95em; color:inherit; opacity:0.85;">Lanzado por <strong>${caster}</strong> • <span style="font-style:italic;">${level}</span></div>
                <div style="margin-top: 6px; display:flex; flex-wrap:wrap; gap:4px;">
                    ${effectsBadge}
                    ${damageBadge}
                </div>
            </div>
            ${saveBadge}
        </div>
    `;

    let descriptionHtml = "";
    if (enableTranslation) {
        descriptionHtml = `
            <div id="${uniqueId}-desc-container" style="font-size: 0.85em; color: inherit; max-height: 140px; overflow-y: auto; padding: 8px; margin-bottom: 12px; background: rgba(128,128,128,0.1); border: 1px solid var(--color-border-light-2, #ddd); border-radius: 4px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;" title="Haz clic en este cuadro para cambiar de idioma">
                <div id="${uniqueId}-es" style="display: block;">
                    <div style="font-weight: bold; color: #1a73e8; margin-bottom: 6px; font-size: 0.95em; border-bottom: 1px solid rgba(26,115,232,0.3); padding-bottom:3px;">
                        <i class="fas fa-language"></i> Español <span style="font-size: 0.8em; font-weight: normal; color: inherit; opacity:0.7;">(Clic para ver Original)</span>
                    </div>
                    <div id="${uniqueId}-es-content" style="line-height: 1.3;">
                        <span style="color: inherit; opacity:0.8;"><em>Traduciendo descripción... <i class="fas fa-spinner fa-spin"></i></em></span>
                    </div>
                </div>
                <div id="${uniqueId}-en" style="display: none;">
                    <div style="font-weight: bold; color: #d93025; margin-bottom: 6px; font-size: 0.95em; border-bottom: 1px solid rgba(217,48,37,0.3); padding-bottom:3px;">
                        <i class="fas fa-language"></i> Original <span style="font-size: 0.8em; font-weight: normal; color: inherit; opacity:0.7;">(Clic para ver Español)</span>
                    </div>
                    <div style="line-height: 1.3;">
                        ${description}
                    </div>
                </div>
            </div>
        `;
    } else {
        descriptionHtml = `
            <div style="font-size: 0.85em; color: inherit; max-height: 140px; overflow-y: auto; padding: 8px; margin-bottom: 12px; background: rgba(128,128,128,0.1); border: 1px solid var(--color-border-light-2, #ddd); border-radius: 4px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                <div style="font-weight: bold; color: inherit; opacity:0.9; margin-bottom: 6px; font-size: 0.95em; border-bottom: 1px solid var(--color-border-light-2, #ccc); padding-bottom:3px;">
                    Descripción del Hechizo
                </div>
                <div style="line-height: 1.3;">
                    ${description}
                </div>
            </div>
        `;
    }

    const actionsHtml = `
        <div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border-light-2, #ddd); padding-top: 10px;">
            <span style="font-size: 0.85em; color: inherit; opacity: 0.8; font-style: italic;">* Selecciona Pasa/Falla${spellData.hasDamage ? ' y luego tira Daño.' : '.'}</span>
            <div style="display: flex; gap: 8px;">
                ${effects.length > 0 ? `<button id="${uniqueId}-apply-effects" style="background: #e53935; color: white; border: 1px solid #c62828; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-family: inherit; transition: background 0.2s;"><i class="fas fa-bolt"></i> Aplicar Efectos</button>` : ""}
                ${spellData.hasDamage ? `<button id="${uniqueId}-roll-damage" style="background: #1a73e8; color: white; border: 1px solid #0b57d0; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-family: inherit; transition: background 0.2s;"><i class="fas fa-skull"></i> Tirar Daño</button>` : ""}
            </div>
        </div>
    `;

    let requestDamageBtnHtml = "";
    if (spellData.userId && spellData.userId !== game.user.id && spellData.hasDamage) {
        requestDamageBtnHtml = `
            <div style="text-align: center; margin-top: 10px; margin-bottom: 5px;">
                <button type="button" id="${uniqueId}-btn-request-damage" data-user="${spellData.userId}" data-uuid="${spellData.originUuid}" style="background: rgba(26,115,232,0.1); border: 1px solid rgba(26,115,232,0.4); color: #1a73e8; font-weight: bold; border-radius: 4px; padding: 6px 12px; cursor: pointer; transition: all 0.2s;">
                    <i class="fas fa-dice"></i> Solicitar Tirada de Daño al Jugador
                </button>
            </div>
        `;
    }

    const content = `
        <div style="font-family:inherit; padding:4px 2px; margin-bottom: 10px;" id="${uniqueId}-main-container">
            ${headerHtml}
            ${descriptionHtml}
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 10px;">
                <h3 style="margin: 0; border: none; padding: 0;">Objetivos Atrapados (${tokens.length}):</h3>
                <button id="${uniqueId}-epic-btn" style="background: #9c27b0; color: white; border: 1px solid #7b1fa2; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-family: inherit; font-size: 0.85em; display:flex; align-items:center; gap:4px; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                    <i class="fas fa-meteor"></i> Epic
                </button>
            </div>
            <div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">
                ${targetsHtml}
            </div>
            ${requestDamageBtnHtml}
            ${actionsHtml}
        </div>
    `;

    // Lógica principal de interacción post-render
    const onRenderComplete = () => {
        const container = document.getElementById(`${uniqueId}-main-container`);
        if (!container) return;

        // Objeto para rastrear el estado actual (pass/fail) de cada token
        const tokenStates = {};

        // 1. Alternar idiomas (si está habilitado)
        if (enableTranslation) {
            const descContainer = document.getElementById(`${uniqueId}-desc-container`);
            if (descContainer) {
                descContainer.addEventListener("click", () => {
                    const esDiv = document.getElementById(`${uniqueId}-es`);
                    const enDiv = document.getElementById(`${uniqueId}-en`);
                    if (esDiv && enDiv) {
                        const showEs = esDiv.style.display === "none";
                        esDiv.style.display = showEs ? "block" : "none";
                        enDiv.style.display = showEs ? "none" : "block";
                    }
                });
            }
            translateAndUpdate(description, `${uniqueId}-es-content`);
        }

        // 2. Controladores de la lista de Activos (Checkbox)
        container.querySelectorAll(`.${uniqueId}-cb`).forEach(cb => {
            cb.addEventListener('change', (e) => {
                const row = document.getElementById(`${uniqueId}-row-${e.target.dataset.tokenId}`);
                if (row) row.style.opacity = e.target.checked ? "1" : "0.5";
            });
        });

        // Función para cambiar visualmente el estado de Pasa/Falla
        const setSaveState = (tokenId, state) => {
            tokenStates[tokenId] = state; // Guardamos el estado para el botón de aplicar efectos
            const passBtn = container.querySelector(`.${uniqueId}-btn-pass[data-token-id="${tokenId}"]`);
            const failBtn = container.querySelector(`.${uniqueId}-btn-fail[data-token-id="${tokenId}"]`);
            if (!passBtn || !failBtn) return;

            const passIcon = passBtn.querySelector('i');
            const failIcon = failBtn.querySelector('i');

            if (state === 'pass') {
                passBtn.style.background = '#c8e6c9'; passBtn.style.borderColor = '#4caf50'; passIcon.style.color = '#2e7d32';
                failBtn.style.background = '#f0f0f0'; failBtn.style.borderColor = '#bbb'; failIcon.style.color = '#888';
            } else if (state === 'fail') {
                failBtn.style.background = '#ffcdd2'; failBtn.style.borderColor = '#f44336'; failIcon.style.color = '#c62828';
                passBtn.style.background = '#f0f0f0'; passBtn.style.borderColor = '#bbb'; passIcon.style.color = '#888';
            }
        };

        // 3. Botones manuales Pasa/Falla
        container.querySelectorAll(`.${uniqueId}-btn-pass`).forEach(btn => {
            btn.addEventListener('click', (e) => { e.preventDefault(); setSaveState(btn.dataset.tokenId, 'pass'); });
        });
        container.querySelectorAll(`.${uniqueId}-btn-fail`).forEach(btn => {
            btn.addEventListener('click', (e) => { e.preventDefault(); setSaveState(btn.dataset.tokenId, 'fail'); });
        });

        // 4. Lanzamiento automático de dado
        container.querySelectorAll(`.${uniqueId}-btn-roll`).forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const tokenId = btn.dataset.tokenId;
                const token = tokens.find(t => t.id === tokenId);
                if (!token || !saveAbilityKey) return;

                try {
                    // Lanzar la salvación a través del sistema D&D5e
                    const rolls = await token.actor.rollSavingThrow({ ability: saveAbilityKey });
                    if (rolls) {
                        const roll = Array.isArray(rolls) ? rolls[0] : rolls;
                        const total = roll.total;
                        const dc = parseInt(saveDC);

                        // Comprobar éxito automático si existe la CD
                        if (!isNaN(dc)) {
                            if (total >= dc) setSaveState(tokenId, 'pass');
                            else setSaveState(tokenId, 'fail');
                        }
                    }
                } catch (err) {
                    console.error("Not Dice | Error al ejecutar tirada de salvación", err);
                }
            });
        });

        // 5. Aplicar Efectos a los que fallaron
        const applyBtn = document.getElementById(`${uniqueId}-apply-effects`);
        if (applyBtn) {
            applyBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                const failedTokens = tokens.filter(t => tokenStates[t.id] === 'fail');

                // Filtramos por los que además tienen el checkbox activado
                const validFailedTokens = failedTokens.filter(t => {
                    const cb = container.querySelector(`.${uniqueId}-cb[data-token-id="${t.id}"]`);
                    return cb && cb.checked;
                });

                if (validFailedTokens.length === 0) {
                    ui.notifications.warn("Not Dice | No hay objetivos válidos marcados con 'Falla'.");
                    return;
                }

                let appliedCount = 0;
                for (const t of validFailedTokens) {
                    for (const eff of effects) {
                        const effectData = foundry.utils.duplicate(eff.data);
                        delete effectData._id; // Nos aseguramos de que Foundry genere un ID nuevo
                        effectData.origin = spellData.originUuid;

                        await t.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
                    }
                    appliedCount++;
                }
                ui.notifications.info(`Not Dice | Efectos aplicados exitosamente a ${appliedCount} objetivos.`);
            });
        }

        // 6. Tirar Daño (pasa los multiplicadores al diálogo de daño)
        const rollDamageBtn = document.getElementById(`${uniqueId}-roll-damage`);
        if (rollDamageBtn) {
            rollDamageBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const item = await fromUuid(spellData.originUuid);
                    const actualItem = item?.item || item;
                    if (!actualItem) return ui.notifications.warn("Not Dice | No se pudo encontrar el objeto origen.");

                    const dmgAct = actualItem.system.activities?.contents?.find(a => a.type === "damage" || a.type === "attack" || a.type === "save");

                    const targetMultipliers = {};
                    const targetIds = [];
                    for (const t of tokens) {
                        const cb = container.querySelector(`.${uniqueId}-cb[data-token-id="${t.id}"]`);
                        if (!cb || !cb.checked) continue;

                        const state = tokenStates[t.id];
                        targetMultipliers[t.id] = state === 'pass' ? 0.5 : 1;
                        targetIds.push(t.id);
                    }

                    // Inyectamos los datos en el evento real (e) para que el core de D&D5e tenga acceso a e.currentTarget y e.target sin arrojar TypeError
                    e.notDiceMultipliers = targetMultipliers;
                    e.targetIds = targetIds;

                    if (dmgAct && typeof dmgAct.rollDamage === "function") {
                        await dmgAct.rollDamage({ event: e, notDiceMultipliers: targetMultipliers });
                    } else if (typeof actualItem.rollDamage === "function") {
                        await actualItem.rollDamage({ event: e, notDiceMultipliers: targetMultipliers });
                    } else {
                        ui.notifications.warn("Not Dice | Este hechizo no tiene un bloque de daño configurado.");
                    }
                } catch (err) {
                    console.error("Not Dice | Error tirando daño:", err);
                }
            });
        }

        // 7. Botón Epic Roll
        const epicBtn = document.getElementById(`${uniqueId}-epic-btn`);
        if (epicBtn) {
            epicBtn.addEventListener("click", (e) => {
                e.preventDefault();

                // Targetear los tokens atrapados para que la UI de Epic Roll los tome automáticamente
                if (game.user.targets) game.user.targets.clear(); // Limpia los targets actuales
                tokens.forEach(t => t.setTarget(true, { releaseOthers: false, user: game.user }));

                let macroFound = false;

                // Opción 1: Buscamos una macro de usuario con nombre 'epic roll' o 'epic'
                const epicMacro = game.macros.find(m => m.name.toLowerCase().includes("epic roll") || m.name.toLowerCase() === "epic");
                if (epicMacro) {
                    epicMacro.execute();
                    macroFound = true;
                } else if (ui.EpicRolls5e && typeof ui.EpicRolls5e.requestRoll === "function") {
                    console.log("Not Dice | API Epic Rolls encontrada, enviando estructura estricta...");
                    // Opción 2: Fallback a llamar a la API directamente con la estructura estricta
                    const epicData = {
                        actors: tokens.map(t => t.actor?.uuid).filter(Boolean),
                        contestants: [],
                        type: `save.${spellData.saveAbilityKey}`,
                        contest: null,
                        options: {
                            formula: "",
                            DC: parseInt(spellData.saveDC) || null,
                            showDC: true,
                            useAverage: false,
                            allowReroll: false,
                            showRollResults: true,
                            blindRoll: false,
                            hideNames: false,
                            autoColor: true,
                            color: "0",
                            customLabel: ""
                        }
                    };

                    const epicPromise = ui.EpicRolls5e.requestRoll(epicData);
                    macroFound = true;

                    // Función para actualizar radios basada en resultados
                    const updateTokensFromResult = (results) => {
                        console.log("Not Dice | Procesando resultados de Epic:", results);

                        // Extraemos el objeto de resultados reales si viene anidado (común en TheRipper93)
                        let actualResults = results;
                        if (results && !Array.isArray(results)) {
                            if (results.results && typeof results.results === 'object') actualResults = results.results;
                            else if (results.contestants && typeof results.contestants === 'object') actualResults = results.contestants;
                        }

                        let updated = 0;
                        const resultsArray = Array.isArray(actualResults) ? actualResults : Object.keys(actualResults).map(k => {
                            return typeof actualResults[k] === 'object' ? { ...actualResults[k], _keyId: k } : { value: actualResults[k], _keyId: k };
                        });

                        for (const res of resultsArray) {
                            if (!res) continue;
                            console.log(`Not Dice | Inspeccionando res crudo de Epic:`, JSON.stringify({
                                total: res.total, success: res.success, isSuccess: res.isSuccess, pass: res.pass
                            }));

                            // Intentamos encontrar el booleano de éxito directo
                            let isSuccess = res.success ?? res.isSuccess ?? res.passed ?? res.pass ?? res.value?.success ?? res.value?.isSuccess ?? (res.value === 'pass' || res.value === true);

                            // FALLBACK: Extraemos el valor matemático de la tirada desde res.roll
                            let rollValue = undefined;
                            if (typeof res.roll === 'number' || typeof res.roll === 'string') {
                                rollValue = res.roll;
                            } else if (res.roll && typeof res.roll === 'object') {
                                rollValue = res.roll.total ?? res.roll._total ?? res.roll.value ?? res.roll.result;
                            }
                            if (rollValue === undefined) rollValue = res.total ?? res.value;

                            if (rollValue !== undefined && spellData.saveDC) {
                                const dc = parseInt(spellData.saveDC);
                                const numericRoll = parseInt(rollValue);
                                if (!isNaN(dc) && !isNaN(numericRoll)) {
                                    isSuccess = numericRoll >= dc;
                                    console.log(`Not Dice | Evaluación manual: Tirada (${numericRoll}) vs CD (${dc}) -> ${isSuccess ? 'PASA' : 'FALLA'}`);
                                }
                            }

                            // Intentamos encontrar el ID del actor o token
                            const actorId = res.actorId || res.actor?._id || res.actor?.id || res.tokenId || res.token?._id || res.token?.id || res.id || res._keyId || (typeof res.actor === 'string' ? res.actor : null);

                            console.log(`Not Dice | Analizando actor/token ID: ${actorId} - Éxito: ${isSuccess}`);

                            if (isSuccess !== undefined && actorId) {
                                // Buscar el token afectado comparando id, uuid del actor y uuid del token
                                const targetToken = tokens.find(t =>
                                    t.actor?.id === actorId ||
                                    t.actor?.uuid === actorId ||
                                    t.id === actorId ||
                                    t.document?.uuid === actorId
                                );

                                if (targetToken) {
                                    console.log(`Not Dice | ¡Match! Token encontrado: ${targetToken.name}`);
                                    const currentState = tokenStates[targetToken.id];
                                    const newState = isSuccess ? 'pass' : 'fail';
                                    if (currentState !== newState) {
                                        setSaveState(targetToken.id, newState);
                                        updated++;
                                    }
                                } else {
                                    console.warn(`Not Dice | No se encontró el token para ID: ${actorId}`);
                                }
                            }
                        }
                        if (updated > 0) ui.notifications.info(`Not Dice | ${updated} objetivos sincronizados desde Epic Rolls.`);
                    };

                    // Intento 1: Atrapar resultados de la Promesa de requestRoll
                    if (epicPromise && typeof epicPromise.then === "function") {
                        epicPromise.then((res) => {
                            if (res && (Array.isArray(res) || Object.keys(res).length > 0)) {
                                updateTokensFromResult(res);
                            }
                        }).catch(e => console.error("Not Dice | Promesa Epic rechazada:", e));
                    }

                    // Intento 2: Atrapar resultados directamente del chat por si la promesa no los devuelve
                    const hookId = Hooks.on("createChatMessage", (msg) => {
                        const epicFlags = msg.flags?.["epic-rolls-5e"];
                        if (epicFlags && (epicFlags.results || epicFlags.contestants)) {
                            updateTokensFromResult(epicFlags.results || epicFlags.contestants);
                            Hooks.off("createChatMessage", hookId); // Desconectar hook
                        }
                    });

                    // Desconectar el hook luego de 3 minutos por limpieza
                    setTimeout(() => Hooks.off("createChatMessage", hookId), 180000);
                }

                if (!macroFound) {
                    ui.notifications.warn("Not Dice | No se encontró la API de Epic Rolls 5e ni una macro llamada 'Epic Roll' o 'Epic'.");
                }
            });
        }

        // 8. Botón solicitar daño al jugador
        const reqBtn = container.querySelector(`#${uniqueId}-btn-request-damage`);
        if (reqBtn) {
            reqBtn.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const uId = reqBtn.dataset.user;
                const uuid = reqBtn.dataset.uuid;
                const formulas = spellData.damageLabels.map(d => d.formula).join(" + ");
                
                const targetIds = [];
                const targetMultipliers = {};
                for (const t of tokens) {
                    const cb = container.querySelector(`.${uniqueId}-cb[data-token-id="${t.id}"]`);
                    if (!cb || !cb.checked) continue;
                    
                    const state = tokenStates[t.id];
                    targetMultipliers[t.id] = state === 'pass' ? 0.5 : 1;
                    targetIds.push(t.id);
                }
                
                if (targetIds.length === 0) {
                    ui.notifications.warn("Not Dice | No hay objetivos marcados (checkbox) para solicitar daño.");
                    return;
                }
                
                const targetIdsStr = targetIds.join(",");
                const multipliersStr = JSON.stringify(targetMultipliers).replace(/"/g, '&quot;');
                
                ChatMessage.create({
                    whisper: [uId],
                    content: `
                        <div class="not-dice-damage-request" style="text-align:center; padding:10px;">
                            <h3 style="margin-bottom:5px;">Daño de ${spellData.name}</h3>
                            <p style="font-size:0.9em; margin-bottom:10px;">El GM solicita tu tirada de daño.</p>
                            <button class="not-dice-roll-spell-damage" data-uuid="${uuid}" data-formulas="${formulas}" data-targets="${targetIdsStr}" data-multipliers="${multipliersStr}" style="background: rgba(197,34,31,0.1); border: 1px solid #d32f2f; color: #ff5252; font-weight: bold; padding: 6px; border-radius:4px; cursor:pointer; width:100%;">
                                <i class="fas fa-dice-d20"></i> Lanzar Daño
                            </button>
                        </div>
                    `
                });
                
                reqBtn.innerHTML = "<i class='fas fa-check'></i> Solicitud Enviada";
                reqBtn.disabled = true;
                reqBtn.style.opacity = "0.6";
                reqBtn.style.cursor = "not-allowed";
            });
        }
    };

    try {
        const DialogV2 = foundry?.applications?.api?.DialogV2;
        if (DialogV2) {
            const app = new DialogV2({
                window: { title: `Área de Efecto detectada` },
                content: content,
                position: { width: 500 }, // Ancho aumentado para acomodar los nuevos botones
                buttons: [
                    { action: "ok", icon: "fa-solid fa-check", label: "Aceptar", default: true },
                    {
                        action: "delete",
                        icon: "fa-solid fa-trash",
                        label: "Aceptar y borrar template",
                        callback: async () => {
                            if (templateDocument && typeof templateDocument.delete === "function") {
                                await templateDocument.delete();
                            }
                        }
                    }
                ]
            });
            app.render(true).then(onRenderComplete);
        } else if (typeof Dialog !== "undefined") {
            new Dialog({
                title: `Área de Efecto detectada`,
                content: content,
                render: onRenderComplete,
                buttons: {
                    ok: { icon: "<i class='fas fa-check'></i>", label: "Aceptar" },
                    delete: {
                        icon: "<i class='fas fa-trash'></i>",
                        label: "Aceptar y borrar template",
                        callback: async () => {
                            if (templateDocument && typeof templateDocument.delete === "function") {
                                await templateDocument.delete();
                            }
                        }
                    }
                },
                default: "ok"
            }, { width: 500 }).render(true);
        }
    } catch (error) {
        console.error("Not Dice | Error crítico al intentar mostrar la ventana de diálogo:", error);
    }
};

Hooks.on("renderChatMessage", (message, html) => {
    html.find(".not-dice-roll-spell-damage").click(async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const uuid = btn.dataset.uuid;
        const formulas = btn.dataset.formulas;
        
        btn.disabled = true;
        btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Tirando...";
        btn.style.opacity = "0.7";
        btn.style.cursor = "not-allowed";
        
        try {
            const formulaParts = formulas.split(" + ");
            const totals = [];
            let grandTotal = 0;
            
            for (const f of formulaParts) {
                const roll = await new Roll(f.trim()).evaluate();
                if (game.dice3d) {
                    await game.dice3d.showForRoll(roll, game.user, true);
                } else if (game.settings.get("not-dice", "enableSound")) {
                    AudioHelper.play({src: "sounds/dice.wav"});
                }
                totals.push(roll.total);
                grandTotal += roll.total;
            }
            
            const targetUserId = game.users.find(u => u.isGM && u.active)?.id;
            
            if (!targetUserId || !game.socket) {
                ui.notifications.warn("Not Dice | No hay un GM activo para recibir el daño.");
                btn.disabled = false;
                btn.innerHTML = "Error. GM desconectado.";
                return;
            }
            
            const payload = {
                type: "not-dice.show-spell-damage",
                itemUuid: uuid,
                targetIds: btn.dataset.targets ? btn.dataset.targets.split(",") : Array.from(game.user.targets).map(t => t.id),
                notDiceMultipliers: btn.dataset.multipliers ? JSON.parse(btn.dataset.multipliers) : {},
                senderName: game.user.name,
                targetUserId: targetUserId,
                preCalculatedTotals: totals
            };
            
            game.socket.emit("module.not-dice", payload);
            ui.notifications.info("Not Dice | Resultado de daño enviado al GM.");
            
            btn.innerHTML = `<i class='fas fa-check'></i> Daño Enviado (${grandTotal})`;
        } catch(e) {
            console.error("Not Dice | Error tirando daño del hechizo", e);
            btn.disabled = false;
            btn.innerHTML = "Error. Reintentar";
        }
    });
});