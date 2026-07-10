// ============================================================
// not-dice | gm-damage-skills.js
// Escanea y retorna los botones de habilidades de daño para el GM
// ============================================================

globalThis.notDiceGetGMDamageSkillsHtml = function(actor, currentItemId) {
    if (!actor) return "";
    
    // Nombres adicionales que el usuario podría querer ver siempre (opcional)
    const whitelist = ["frenzy", "frenesí", "frenesi"];

    const damageFeatures = actor.items.filter(i => {
        if (i.id === currentItemId) return false;
        
        if (whitelist.includes(i.name.toLowerCase())) {
            return true;
        }

        // Solo queremos habilidades o hechizos, no armas ni equipo
        if (!["feat", "spell", "classFeature", "feature"].includes(i.type)) {
            return false;
        }

        // V2 legacy support
        if (i.system?.damage?.parts?.length > 0) {
            const activationType = i.system?.activation?.type || "";
            if (activationType === "action" || activationType === "reaction") return false;
            return true;
        }
        
        // V3 activities support
        if (i.system?.activities) {
            let activitiesArray = [];
            if (typeof i.system.activities.values === "function") {
                activitiesArray = Array.from(i.system.activities.values());
            } else {
                activitiesArray = Object.values(i.system.activities);
            }
            
            const parentActivationType = i.system?.activation?.type || "";
            let hasDamagePart = false;
            let isActionOrReaction = false;
            let isAttack = false;
            
            for (const act of activitiesArray) {
                if (act.type === "attack") {
                    isAttack = true;
                }
                if (act.damage?.parts?.length > 0) {
                    hasDamagePart = true;
                }
                
                // Check if this activity is an action or reaction
                const actActivationType = act.activation?.type || "";
                const actOverride = act.activation?.override || false;
                
                if (actOverride && (actActivationType === "action" || actActivationType === "reaction")) {
                    isActionOrReaction = true;
                } else if (!actOverride) {
                    if (parentActivationType === "action" || parentActivationType === "reaction") {
                        isActionOrReaction = true;
                    } else if (!parentActivationType && (actActivationType === "action" || actActivationType === "reaction")) {
                        isActionOrReaction = true;
                    }
                }
            }
            
            if (hasDamagePart && !isActionOrReaction && !isAttack) {
                return true;
            }
        }
        
        return false;
    });
    
    if (damageFeatures.length === 0) return "";

    const buttonsHtml = damageFeatures.map(f => {
        let formula = "0";
        let type = "";
        let isSpell = f.type === "spell";
        let spellLevel = f.system?.level || 0;
        let scalingMode = "";
        let scalingNumber = 0;
        
        const isWhitelisted = whitelist.includes(f.name.toLowerCase());

        // Extract formula from V2 or V3
        if (f.system?.damage?.parts?.length > 0) {
            formula = f.system.damage.parts[0][0] || "0";
            type = f.system.damage.parts[0][1] || "";
        } else if (f.system?.activities) {
            let activitiesArray = [];
            if (typeof f.system.activities.values === "function") {
                activitiesArray = Array.from(f.system.activities.values());
            } else {
                activitiesArray = Object.values(f.system.activities);
            }
            
            const act = activitiesArray.find(act => {
                if (act.type === "attack") return false;
                if (!act.damage?.parts?.length) return false;
                
                const actActivationType = act.activation?.type || "";
                const actOverride = act.activation?.override || false;
                const parentActivationType = f.system?.activation?.type || "";
                
                let isActionOrReaction = false;
                if (actOverride && (actActivationType === "action" || actActivationType === "reaction")) {
                    isActionOrReaction = true;
                } else if (!actOverride) {
                    if (parentActivationType === "action" || parentActivationType === "reaction") {
                        isActionOrReaction = true;
                    } else if (!parentActivationType && (actActivationType === "action" || actActivationType === "reaction")) {
                        isActionOrReaction = true;
                    }
                }
                return !isActionOrReaction;
            });
            
            if (act) {
                const p = act.damage.parts[0];
                if (p.scaling) {
                    scalingMode = p.scaling.mode || "";
                    scalingNumber = p.scaling.number || 0;
                }
                if (p.custom?.enabled && p.custom?.formula) {
                    formula = p.custom.formula;
                } else {
                    const parts = [];
                    if (p.number && p.denomination) parts.push(`${p.number}d${p.denomination}`);
                    if (p.bonus) parts.push(p.bonus);
                    formula = parts.join(" + ") || "0";
                }
                let typeList = [];
                if (Array.isArray(p.types)) {
                    typeList = p.types;
                } else if (p.types instanceof Set) {
                    typeList = Array.from(p.types);
                } else if (typeof p.types === "string") {
                    typeList = p.types.split(" ");
                }
                
                if (typeList.length > 0) {
                    type = typeList[0];
                    // Guardamos la lista completa unida por comas para el data-attribute
                    f.availableTypes = typeList.join(",");
                }
            }
        }

        if (isWhitelisted && formula === "0") {
            formula = "1d6"; // Default for reckless if no damage configured
        }
        
        // Hardcode fix for Favored Enemy wrong scale mapping
        const nameLower = f.name.toLowerCase();
        if ((nameLower === "favored enemy" || nameLower === "enemigo predilecto") && typeof formula === "string" && formula.includes("@scale.")) {
            formula = "1d6";
        }

        if (formula && typeof formula === "string" && formula.includes("@")) {
            const rollData = actor.getRollData ? actor.getRollData() : {};
            
            // Intento 1: API nativa de Foundry para reemplazar referencias
            try {
                if (typeof Roll !== "undefined" && Roll.replaceFormulaData) {
                    formula = Roll.replaceFormulaData(formula, rollData, { missing: "0" });
                }
            } catch(e) {}

            // Intento 2: Reemplazo manual en caso de que aún queden variables como @scale.rogue.sneak-attack
            if (formula.includes("@scale.")) {
                formula = formula.replace(/@scale\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)/g, (match, cls, key) => {
                    let val = foundry.utils.getProperty(rollData, `scale.${cls}.${key}`);
                    if (val === undefined || val === null) return "0";
                    if (typeof val === "object") {
                        return val.formula || val.value || (val.faces ? `${val.number || 1}d${val.faces}` : "0");
                    }
                    return val.toString();
                });
            }
        }

        return `<button class="not-dice-gm-damage-skill-btn" data-item-uuid="${f.uuid}" data-formula="${formula}" data-type="${type}" data-available-types="${f.availableTypes || ""}" data-name="${f.name}" data-is-spell="${isSpell}" data-spell-level="${spellLevel}" data-scaling-mode="${scalingMode}" data-scaling-number="${scalingNumber}" style="padding:4px; font-weight:bold; font-size:0.85em; border-radius:4px; border:1px solid var(--color-border-light-2, #777); background:rgba(128,128,128,0.1); color:inherit; cursor:pointer; text-align:left; display:flex; justify-content:space-between; align-items:center;">
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;" title="${f.name}">${f.name}</span>
            <span style="opacity:0.75; font-family:monospace; font-size:0.9em; flex-shrink:0;">${formula}</span>
        </button>`;
    }).join("");

    const actorName = actor.name ? (actor.name.length > 15 ? actor.name.substring(0, 15) + "..." : actor.name) : "Actor";
    return `
        <div style="margin-top: 8px; border-top: 1px dashed var(--color-border-light-2, #777); padding-top: 6px;">
            <div style="font-weight:bold; font-size:0.85em; margin-bottom:4px; text-align:center; color:inherit; opacity:0.9;" title="Habilidades de ${actor.name || "Actor"}">Habilidades de ${actorName}</div>
            <div style="display:flex; flex-direction:column; gap:4px; max-height:120px; overflow-y:auto; padding-right:4px;">
                ${buttonsHtml}
            </div>
        </div>
    `;
};
