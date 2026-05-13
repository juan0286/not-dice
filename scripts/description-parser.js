// ============================================================
// not-dice | description-parser.js
// Lógica para enriquecer e interpretar textos de descripción
// usando las herramientas nativas de Foundry y D&D5e (enrichHTML)
// resolviendo macros y referencias dinámicas como [[lookup]], [[/damage]], etc.
// ============================================================

export async function enrichItemDescription(item) {
    if (!item || !item.system || !item.system.description) {
        return "<p>Sin descripción.</p>";
    }
    
    const rawDescription = item.system.description.value || "";
    if (!rawDescription) {
        return "<p>Sin descripción.</p>";
    }
    
    try {
        // Obtenemos los datos dinámicos (stats, DC, etc) del item y el actor
        const rollData = typeof item.getRollData === "function" ? item.getRollData() : (item.actor ? item.actor.getRollData() : {});
        
        // En Foundry V11/V12 y D&D5e v3.1+, TextEditor.enrichHTML maneja 
        // las etiquetas [[lookup]], [[/damage]], etc., siempre y cuando le pasemos
        // el documento 'relativeTo' para que el sistema encuentre las 'activities'.
        const enriched = await TextEditor.enrichHTML(rawDescription, {
            async: true,
            rollData: rollData,
            secrets: false,
            relativeTo: item // CRÍTICO: Esto permite que D&D5e encuentre "activity=8P7hmd3Nron4RAlv"
        });
        
        return enriched;
    } catch (error) {
        console.error("Not Dice | Error interpretando etiquetas dinámicas de la descripción:", error);
        return rawDescription; // Fallback a la versión sin procesar si hay error
    }
}

// Exponemos globalmente para accederlo fácilmente desde otros scripts del módulo
globalThis.notDiceEnrichDescription = enrichItemDescription;
