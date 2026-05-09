// ============================================================
// not-dice | saving-throw.js (Foundry V14 + D&D5e v4)
// Detecta áreas de efecto interceptando la creación de Regiones
// y Plantillas en el Canvas (garantizando que la geometría exista).
// ============================================================

Hooks.once("init", () => {
    console.log("Not Dice | Módulo inicializado (Hooks: createRegion / createMeasuredTemplate).");
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
            // En V14 comprobamos si el testPoint está en el documento, o si usamos el fallback del objeto visual
            if (document.object && (typeof document.testPoint === "function" || typeof document.object.testPoint === "function" || document.object.shape)) {
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

        // Prioridad 1: testPoint nativo en el Documento (V14+) - Evita el warning de deprecación
        if (typeof areaObj.document?.testPoint === "function") {
            isInside = areaObj.document.testPoint(point);
        } 
        // Prioridad 2: testPoint en el Objeto (V12/V13 legacy)
        else if (typeof areaObj.testPoint === "function") {
            isInside = areaObj.testPoint(point);
        } 
        // Prioridad 3: Fallback clásico 2D
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
// Interceptar la creación real de los documentos en la escena
// ========================================================================
async function handleAreaCreation(document, userId, tipoLog) {
    if (userId !== game.user.id) return;
    if (!game.settings.get("not-dice", "enableTemplateIntercept")) return;

    // Solo nos interesan áreas generadas por un hechizo/ítem de D&D5e
    const originUuid = document.flags?.dnd5e?.origin;
    if (!originUuid) return; 

    console.log(`Not Dice | Hook ${tipoLog} disparado. Analizando área...`);

    let spellName = "Área de Efecto";
    let casterName = "Desconocido";

    try {
        const item = await fromUuid(originUuid);
        if (item) {
            spellName = item.name;
            casterName = item.actor?.name || "Desconocido";
        }
    } catch (error) {
        console.error("Not Dice | Fallo al buscar el origen del área:", error);
    }

    const areaObj = await waitForAreaObject(document);
    const caughtTokens = getTokensInsideArea(areaObj);
    showCaughtTokensDialog(spellName, casterName, caughtTokens);
}

// Hook para las nuevas Regiones (V14)
Hooks.on("createRegion", async (document, operation, userId) => {
    handleAreaCreation(document, userId, "createRegion");
});

// Hook para las Plantillas clásicas (Fallback para módulos/versiones anteriores)
Hooks.on("createMeasuredTemplate", async (document, operation, userId) => {
    handleAreaCreation(document, userId, "createMeasuredTemplate");
});

// ========================================================================
// 3. Mostrar la UI
// ========================================================================
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