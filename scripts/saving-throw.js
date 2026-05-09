// ============================================================
// not-dice | saving-throw.js (Foundry V14 + D&D5e v4)
// Detecta áreas de efecto interceptando la creación de Regiones
// y Plantillas en el Canvas (garantizando que la geometría exista).
// Incluye traducción de MyMemory en tiempo real.
// ============================================================

Hooks.once("init", () => {
    console.log("Not Dice | Módulo inicializado (Traducción Activa).");
    
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

    // MyMemory tiene un límite estricto de 500 caracteres (bytes) por petición gratuita.
    // Dividimos el texto en trozos de ~450 caracteres.
    const chunks = plainText.match(/.{1,450}(?:\s|$)/g) || [plainText];
    
    // Para no saturar la API ni ralentizar en exceso, traducimos máximo 2 bloques (~900 chars).
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
    if (userId !== game.user.id) return;
    if (!game.settings.get("not-dice", "enableTemplateIntercept")) return;

    const originUuid = document.flags?.dnd5e?.origin;
    if (!originUuid) return; 

    let spellData = {
        name: "Área de Efecto",
        caster: "Desconocido",
        img: "icons/magic/light/explosion-star-glow-blue-yellow.webp",
        level: "Desconocido",
        saveAbility: "",
        saveDC: "",
        description: ""
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

            if (actualItem.system?.activities) {
                const saveActivity = actualItem.system.activities.contents?.find(a => a.type === "save")
                    || actualItem.system.activities.getByType?.("save")?.[0]
                    || (item.type === "save" ? item : null);

                if (saveActivity) {
                    const abilitySet = saveActivity.save?.ability;
                    const ability = abilitySet ? (abilitySet instanceof Set ? Array.from(abilitySet)[0] : (Array.isArray(abilitySet) ? abilitySet[0] : abilitySet)) : null;
                    if (ability && typeof ability === 'string') spellData.saveAbility = CONFIG.DND5E?.abilities?.[ability]?.label || ability.toUpperCase();
                    
                    if (saveActivity.save?.dc?.value) {
                        spellData.saveDC = saveActivity.save.dc.value;
                    } else if (actualItem.actor && actualItem.actor.system?.attributes?.spelldc) {
                        spellData.saveDC = actualItem.actor.system.attributes.spelldc;
                    }
                }
            } else if (actualItem.system?.save?.ability) {
                const ability = actualItem.system.save.ability;
                spellData.saveAbility = CONFIG.DND5E?.abilities?.[ability]?.label || ability.toUpperCase();
                spellData.saveDC = actualItem.system?.save?.dc || "";
            }
        }
    } catch (error) {
        console.error("Not Dice | Fallo al procesar el ítem:", error);
    }

    const areaObj = await waitForAreaObject(document);
    const caughtTokens = getTokensInsideArea(areaObj);
    showCaughtTokensDialog(spellData, caughtTokens);
}

Hooks.on("createRegion", async (document, operation, userId) => handleAreaCreation(document, userId, "createRegion"));
Hooks.on("createMeasuredTemplate", async (document, operation, userId) => handleAreaCreation(document, userId, "createMeasuredTemplate"));

// 5. Mostrar la UI
const showCaughtTokensDialog = (spellData, tokens) => {
    const { name, caster, img, level, saveAbility, saveDC, description } = spellData;
    const enableTranslation = game.settings.get("not-dice", "enableTranslation");
    let targetsHtml = "";

    if (tokens.length === 0) {
        targetsHtml = `<div style="text-align:center; padding: 15px; color: #666; font-style: italic;">El área está vacía. Nadie resultó afectado.</div>`;
    } else {
        targetsHtml = tokens.map(t => {
            const tokenImg = t.document.texture?.src || t.actor.img;
            return `
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px; padding: 6px; border: 1px solid #ddd; border-radius: 6px; background: rgba(0,0,0,0.02);">
                    <img src="${tokenImg}" style="width:36px; height:36px; border-radius:50%; border:1px solid #aaa; object-fit:cover;">
                    <span style="font-weight:bold; font-size:1.1em;">${t.name}</span>
                </div>
            `;
        }).join("");
    }

    let saveBadge = "";
    if (saveAbility) {
        saveBadge = `
            <div style="margin-top: 6px;">
                <span style="display:inline-block; font-size:0.85em; background:#d3e3fd; color:#0b57d0; padding:3px 8px; border-radius:12px; border:1px solid #a8c7fa;">
                    <strong>Salvación:</strong> ${saveAbility} ${saveDC ? `(CD ${saveDC})` : ""}
                </span>
            </div>
        `;
    }

    const headerHtml = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:10px; border:1px solid #ddd; border-radius:6px; background:rgba(0,0,0,0.03); box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <img src="${img}" style="width:54px; height:54px; border:1px solid #aaa; border-radius:6px; object-fit:cover; flex-shrink:0;">
            <div style="flex:1; min-width:0;">
                <div style="font-size:1.2em; font-weight:bold; color:#000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
                <div style="font-size:0.85em; color:#555;">Lanzado por <strong>${caster}</strong> • <span style="font-style:italic;">${level}</span></div>
                ${saveBadge}
            </div>
        </div>
    `;

    // Generamos un ID único para los divs para evitar colisiones si se abren múltiples diálogos
    const uniqueId = "nd-desc-" + Math.random().toString(36).substring(2, 9);
    let descriptionHtml = "";

    // HTML condicional: interactivo (Traducción ON) vs Estático (Traducción OFF)
    if (enableTranslation) {
        descriptionHtml = `
            <div id="${uniqueId}-container" style="font-size: 0.85em; color: #333; max-height: 140px; overflow-y: auto; padding: 8px; margin-bottom: 12px; background: rgba(255,255,255,0.6); border: 1px solid #ddd; border-radius: 4px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.03); cursor: pointer;" title="Haz clic en este cuadro para cambiar de idioma">
                <!-- Español -->
                <div id="${uniqueId}-es" style="display: block;">
                    <div style="font-weight: bold; color: #1a73e8; margin-bottom: 6px; font-size: 0.95em; border-bottom: 1px solid rgba(26,115,232,0.3); padding-bottom:3px;">
                        <i class="fas fa-language"></i> Español <span style="font-size: 0.8em; font-weight: normal; color: #777;">(Clic para ver Original)</span>
                    </div>
                    <div id="${uniqueId}-es-content" style="line-height: 1.3;">
                        <span style="color: #666;"><em>Traduciendo descripción... <i class="fas fa-spinner fa-spin"></i></em></span>
                    </div>
                </div>
                <!-- Original (Oculto inicialmente) -->
                <div id="${uniqueId}-en" style="display: none;">
                    <div style="font-weight: bold; color: #d93025; margin-bottom: 6px; font-size: 0.95em; border-bottom: 1px solid rgba(217,48,37,0.3); padding-bottom:3px;">
                        <i class="fas fa-language"></i> Original <span style="font-size: 0.8em; font-weight: normal; color: #777;">(Clic para ver Español)</span>
                    </div>
                    <div style="line-height: 1.3;">
                        ${description}
                    </div>
                </div>
            </div>
        `;
    } else {
        descriptionHtml = `
            <div style="font-size: 0.85em; color: #333; max-height: 140px; overflow-y: auto; padding: 8px; margin-bottom: 12px; background: rgba(255,255,255,0.6); border: 1px solid #ddd; border-radius: 4px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.03);">
                <div style="font-weight: bold; color: #444; margin-bottom: 6px; font-size: 0.95em; border-bottom: 1px solid #ccc; padding-bottom:3px;">
                    Descripción del Hechizo
                </div>
                <div style="line-height: 1.3;">
                    ${description}
                </div>
            </div>
        `;
    }

    const content = `
        <div style="font-family:inherit; padding:4px 2px; margin-bottom: 10px;">
            ${headerHtml}
            ${descriptionHtml}
            <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 10px;">Objetivos Atrapados (${tokens.length}):</h3>
            <div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">
                ${targetsHtml}
            </div>
        </div>
    `;

    // Función a ejecutar una vez que el DOM está dibujado (seguridad contra sanitizadores de Foundry)
    const onRenderComplete = () => {
        if (!enableTranslation) return; // Si no hay traducción, no añadimos eventos ni llamamos a la API

        // 1. Añadimos el evento Click para alternar visibilidad
        const container = document.getElementById(`${uniqueId}-container`);
        if (container) {
            container.addEventListener("click", () => {
                const esDiv = document.getElementById(`${uniqueId}-es`);
                const enDiv = document.getElementById(`${uniqueId}-en`);
                if (esDiv && enDiv) {
                    if (esDiv.style.display === "none") {
                        esDiv.style.display = "block";
                        enDiv.style.display = "none";
                    } else {
                        esDiv.style.display = "none";
                        enDiv.style.display = "block";
                    }
                }
            });
        }
        // 2. Disparamos la API de MyMemory
        translateAndUpdate(description, `${uniqueId}-es-content`);
    };

    try {
        const DialogV2 = foundry?.applications?.api?.DialogV2;
        if (DialogV2) {
            const app = new DialogV2({
                window: { title: `Área de Efecto detectada` },
                content: content,
                position: { width: 380 },
                buttons: [
                    { action: "ok", icon: "fa-solid fa-check", label: "Aceptar", default: true }
                ]
            });
            app.render(true).then(onRenderComplete); // Ejecuta nuestra lógica tras renderizar
        } else if (typeof Dialog !== "undefined") {
            new Dialog({
                title: `Área de Efecto detectada`,
                content: content,
                render: onRenderComplete, // Fallback legacy para activar el evento y traducción
                buttons: { ok: { icon: "<i class='fas fa-check'></i>", label: "Aceptar" } },
                default: "ok"
            }, { width: 380 }).render(true);
        }
    } catch (error) {
        console.error("Not Dice | Error crítico al intentar mostrar la ventana de diálogo:", error);
    }
};