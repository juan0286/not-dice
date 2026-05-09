// ============================================================
// not-dice | saving-throw.js (Foundry V14 + D&D5e v4)
// Detecta áreas de efecto interceptando las Actividades de D&D5e
// y la creación de Regiones nativas de Foundry V14.
// ============================================================

Hooks.once("init", () => {
    console.log("Not Dice | Módulo inicializado (Nuevos Hooks: dnd5e.postUseActivity y createRegion).");
    game.settings.register("not-dice", "enableTemplateIntercept", {
        name: "Detectar Área de Efecto",
        hint: "Muestra un diálogo con los tokens afectados al colocar una plantilla.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });
});

// 1. Espera a que el objeto visual (Región o Plantilla) se cargue en el canvas
const waitForAreaObject = (document) => {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 60; // Máximo 3 segundos

        const interval = setInterval(() => {
            attempts++;
            // En V14 comprobamos si el objeto visual tiene el método testPoint (Regiones) o shape (Plantillas)
            if (document.object && (typeof document.object.testPoint === "function" || document.object.shape)) {
                clearInterval(interval);
                console.log(`Not Dice | Objeto visual del área encontrado en intento ${attempts}.`);
                resolve(document.object);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.warn("Not Dice | Timeout esperando el renderizado del área. Se intentará usar lo disponible.");
                resolve(document.object || null);
            }
        }, 50);
    });
};

// 2. Medir colisiones con la API de Foundry V14
const getTokensInsideArea = (areaObj) => {
    const caughtTokens = [];
    
    if (!areaObj) {
        console.error("Not Dice | Objeto de área inválido, no se pueden medir colisiones.");
        return caughtTokens;
    }

    for (const token of canvas.tokens.placeables) {
        if (!token.actor) continue;

        // V14 Scene Regions requiere la elevación para cálculos 3D
        const point = {
            x: token.center.x,
            y: token.center.y,
            elevation: token.document.elevation ?? 0
        };

        let isInside = false;

        // Prioridad 1: testPoint nativo de V14 (Regiones y nuevas plantillas)
        if (typeof areaObj.testPoint === "function") {
            isInside = areaObj.testPoint(point);
        } 
        // Prioridad 2: Fallback clásico 2D
        else if (areaObj.shape && typeof areaObj.shape.contains === "function") {
            const localX = point.x - areaObj.document.x;
            const localY = point.y - areaObj.document.y;
            isInside = areaObj.shape.contains(localX, localY);
        }

        if (isInside) {
            console.log(`Not Dice | Objetivo atrapado: ${token.name}`);
            caughtTokens.push(token);
        }
    }
    
    return caughtTokens;
};

// ========================================================================
// ESTRATEGIA A: Interceptar la Actividad de D&D5e (Más preciso para hechizos)
// ========================================================================
Hooks.on("dnd5e.postUseActivity", async (activity, usageConfig, results) => {
    if (!game.settings.get("not-dice", "enableTemplateIntercept")) return;
    
    console.log("Not Dice | Hook dnd5e.postUseActivity disparado.");

    // En D&D5e v4, results contiene las plantillas o regiones generadas
    const templates = results?.templates ?? [];
    const regions = results?.regions ?? [];
    const createdAreas = [...templates, ...regions];

    if (createdAreas.length === 0) {
        console.log("Not Dice | El hechizo/actividad no generó áreas en el mapa. Ignorando.");
        return;
    }

    const spellName = activity.item?.name ?? "Área de Efecto";
    const casterName = activity.actor?.name ?? "Desconocido";

    console.log(`Not Dice | Área generada por hechizo: ${spellName}`);

    // Tomamos la primera área generada
    const areaDoc = createdAreas[0];
    const areaObj = await waitForAreaObject(areaDoc);
    
    const caughtTokens = getTokensInsideArea(areaObj);
    showCaughtTokensDialog(spellName, casterName, caughtTokens);
});

// ========================================================================
// ESTRATEGIA B: Interceptar la creación nativa de Regiones en V14
// ========================================================================
Hooks.on("createRegion", async (regionDocument, operation, userId) => {
    // Si fue por dnd5e.postUseActivity ya se habrá ejecutado, esto funciona de red de seguridad
    if (userId !== game.user.id) return;
    if (!game.settings.get("not-dice", "enableTemplateIntercept")) return;

    // Solo nos interesan regiones vinculadas a un ítem/hechizo
    const originUuid = regionDocument.flags?.dnd5e?.origin;
    if (!originUuid) return; 

    console.log("Not Dice | Hook nativo createRegion disparado.");

    let spellName = "Región de Efecto";
    let casterName = "Desconocido";

    try {
        const item = await fromUuid(originUuid);
        if (item) {
            spellName = item.name;
            casterName = item.actor?.name || "Desconocido";
        }
    } catch (error) {
        console.error("Not Dice | Fallo al buscar el origen de la región:", error);
    }

    const areaObj = await waitForAreaObject(regionDocument);
    const caughtTokens = getTokensInsideArea(areaObj);
    showCaughtTokensDialog(spellName, casterName, caughtTokens);
});


// 4. Mostrar la UI (Idéntico a la versión anterior)
const showCaughtTokensDialog = (spellName, casterName, tokens) => {
    let targetsHtml = "";

    if (tokens.length === 0) {
        targetsHtml = `<div style="text-align:center; padding: 15px; color: #666; font-style: italic;">El área está vacía. Nadie resultó afectado.</div>`;
    } else {
        targetsHtml = tokens.map(t => {
            const img = t.document.texture?.src || t.actor.img;
            return `
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px; padding: 6px; border: 1px solid #ddd; border-radius: 6px; background: rgba(0,0,0,0.02);">
                    <img src="${img}" style="width:36px; height:36px; border-radius:50%; border:1px solid #aaa; object-fit:cover;">
                    <span style="font-weight:bold; font-size:1.1em;">${t.name}</span>
                </div>
            `;
        }).join("");
    }

    const content = `
        <div style="font-family:inherit; padding:4px 2px; margin-bottom: 10px;">
            <div style="font-size:0.9em; color:#444; margin-bottom:12px; padding:8px; border:1px solid #ddd; border-radius:6px; background:rgba(0,0,0,0.03);">
                <strong>Hechizo / Habilidad:</strong> <span style="font-size: 1.1em; color:#000;">${spellName}</span> <br>
                <strong>Lanzado por:</strong> <span style="color:#666;">${casterName}</span>
            </div>
            <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 10px;">Objetivos Atrapados (${tokens.length}):</h3>
            <div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">
                ${targetsHtml}
            </div>
        </div>
    `;

    try {
        const DialogV2 = foundry?.applications?.api?.DialogV2;
        if (DialogV2) {
            console.log("Not Dice | Renderizando UI...");
            const app = new DialogV2({
                window: { title: `Área de Efecto: ${spellName}` },
                content: content,
                position: { width: 350 },
                buttons: [
                    { action: "ok", icon: "fa-solid fa-check", label: "Aceptar", default: true }
                ]
            });
            app.render(true);
        } else if (typeof Dialog !== "undefined") {
            new Dialog({
                title: `Área de Efecto: ${spellName}`,
                content: content,
                buttons: { ok: { icon: "<i class='fas fa-check'></i>", label: "Aceptar" } },
                default: "ok"
            }, { width: 350 }).render(true);
        }
    } catch (error) {
        console.error("Not Dice | Error crítico al intentar mostrar la ventana de diálogo:", error);
    }
};