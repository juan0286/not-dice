// ============================================================
// not-dice | description-parser.js
// Lógica para enriquecer e interpretar textos de descripción
// usando las herramientas nativas de Foundry y D&D5e (enrichHTML)
// resolviendo macros y referencias dinámicas como [[lookup]], [[/damage]], etc.
// ============================================================

export async function enrichItemDescription(item) {
    if (!item) {
        return "<p>Sin descripción.</p>";
    }

    const actualItem = item?.item || item;
    const systemDesc = actualItem?.system?.description;
    if (!systemDesc && typeof actualItem?.description !== "string") {
        return "<p>Sin descripción.</p>";
    }
    
    const rawDescription = (typeof systemDesc === "string" 
        ? systemDesc 
        : (systemDesc?.value || systemDesc?.chat || (typeof actualItem?.description === "string" ? actualItem.description : ""))) || "";
        
    if (!rawDescription || !rawDescription.trim()) {
        return "<p>Sin descripción.</p>";
    }
    
    try {
        // Obtenemos los datos dinámicos (stats, DC, etc) del item y el actor
        const rollData = typeof actualItem.getRollData === "function" 
            ? actualItem.getRollData() 
            : (actualItem.actor?.getRollData ? actualItem.actor.getRollData() : {});
        
        // En Foundry y D&D5e v3+/v4, TextEditor.enrichHTML maneja 
        // las etiquetas [[lookup]], [[/damage]], etc., siempre y cuando le pasemos
        // el documento 'relativeTo' para que el sistema encuentre las 'activities'.
        const enriched = await TextEditor.enrichHTML(rawDescription, {
            async: true,
            rollData: rollData,
            secrets: false,
            relativeTo: actualItem
        });
        
        return enriched || rawDescription;
    } catch (error) {
        (globalThis.notDiceLogger || console).error("Error interpretando etiquetas dinámicas de la descripción:", error);
        return rawDescription; // Fallback a la versión sin procesar si hay error
    }
}

// Exponemos globalmente para accederlo fácilmente desde otros scripts del módulo
globalThis.notDiceEnrichDescription = enrichItemDescription;
