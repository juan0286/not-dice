// ============================================================
// not-dice | damage-effects.js
// Lógica para descubrir y analizar Efectos Activos en el Actor 
// que modifican el daño (añaden dados, modificadores fijos, etc.)
// ============================================================

export function getDamageIncreasingEffects(actor) {
    if (!actor) return [];

    const relevantEffects = [];
    
    // Palabras clave comunes de hechizos o habilidades que suman daño
    const keywords = [
        "hunter's mark", "marca del cazador", 
        "divine favor", "favor divino", 
        "hex", "maleficio", 
        "enlarge", "agrandar", 
        "sneak attack", "ataque furtivo", 
        "smite", "castigo"
    ];
    
    const effects = actor.appliedEffects || actor.effects || [];

    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;

        let isRelevant = false;
        let reasons = [];
        let addedFormulas = [];
        
        // 1. Detección por nombre
        const name = (effect.name || "").toLowerCase();
        if (keywords.some(k => name.includes(k))) {
            isRelevant = true;
            reasons.push("Nombre Clave");
        }
        
        // 2. Detección por el array de 'changes' (modificadores internos de Foundry)
        if (effect.changes && effect.changes.length > 0) {
            for (const change of effect.changes) {
                if (change.key.includes("bonuses") && change.key.includes("damage")) {
                    isRelevant = true;
                    reasons.push(`Modifica: ${change.key}`);
                    addedFormulas.push(change.value);
                }
            }
        }
        
        // 3. Inspección Profunda: Buscar flags de macros u otros módulos
        if (effect.flags) {
            const flagsStr = JSON.stringify(effect.flags).toLowerCase();
            // Módulos como Midi-QOL o DAE usan flags específicas
            if (flagsStr.includes("damagebonus") || flagsStr.includes("damage_bonus")) {
                isRelevant = true;
                reasons.push("Contiene Flags de Daño Extra");
            }
        }
        
        // 4. Inspección del Objeto Origen: Si el efecto viene de un Item, lo analizamos
        if (effect.origin) {
            try {
                let originItem = null;
                if (typeof fromUuidSync === "function") {
                    originItem = fromUuidSync(effect.origin);
                } else {
                    const parts = effect.origin.split(".");
                    if (parts.length >= 4 && parts[0] === "Actor" && parts[2] === "Item") {
                        const originActor = game.actors?.get(parts[1]);
                        originItem = originActor?.items?.get(parts[3]);
                    }
                }
                
                if (originItem) {
                    let hasDamage = false;
                    
                    // a) Revisamos Actividades (D&D5e v4)
                    const activities = originItem.system?.activities?.contents || [];
                    for (const act of activities) {
                        if (act.type === "damage" || act.type === "attack" || act.type === "save") {
                            const parts = act.damage?.parts || [];
                            if (parts.length > 0) {
                                hasDamage = true;
                                parts.forEach(p => {
                                    if (p.custom && p.custom.formula) addedFormulas.push(p.custom.formula);
                                    else if (p.number && p.denomination) addedFormulas.push(`${p.number}d${p.denomination}`);
                                });
                            }
                        }
                    }
                    
                    // b) Revisamos sistema tradicional (D&D5e v3 o anterior)
                    const damageParts = originItem.system?.damage?.parts || [];
                    if (damageParts.length > 0) {
                        hasDamage = true;
                        damageParts.forEach(p => {
                            if (p[0]) addedFormulas.push(p[0]);
                        });
                    }
                    
                    // c) Revisar si la descripción menciona daño adicional
                    const description = (originItem.system?.description?.value || "").toLowerCase();
                    const extraDamagePhrases = ["daño adicional", "extra damage", "additional damage", "daño extra"];
                    if (extraDamagePhrases.some(phrase => description.includes(phrase))) {
                         hasDamage = true;
                         reasons.push("Descripción menciona Daño Adicional");
                    }
                    
                    if (hasDamage) {
                        isRelevant = true;
                        reasons.push("Item Origen contiene Daño");
                    }
                }
            } catch(e) {
                console.warn("Not Dice | Error inspeccionando origen de efecto", e);
            }
        }
        
        if (isRelevant) {
            const uniqueFormulas = [...new Set(addedFormulas)].filter(f => f);
            
            relevantEffects.push({
                id: effect.id,
                name: effect.name,
                icon: effect.icon || effect.img,
                reasons: [...new Set(reasons)].join(" | "),
                formulas: uniqueFormulas.join(" + ") || "Revisar Manualmente",
                origin: effect.origin || "Desconocido"
            });
        }
    }
    
    return relevantEffects;
}

// Exponemos la función globalmente por si queremos usarla en otros archivos del módulo
globalThis.notDiceGetDamageEffects = getDamageIncreasingEffects;
