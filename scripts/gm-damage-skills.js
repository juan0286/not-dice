// ============================================================
// not-dice | gm-damage-skills.js
// Escanea y retorna los botones de habilidades de daño para el GM
// ============================================================

globalThis.notDiceGetGMDamageSkillsHtml = function(actor, currentItemId) {
    if (!actor) return "";
    
    const damageFeatures = actor.items.filter(i => 
        i.type === "feat" && 
        i.system?.damage?.parts?.length > 0 && 
        i.id !== currentItemId
    );
    
    if (damageFeatures.length === 0) return "";

    const buttonsHtml = damageFeatures.map(f => {
        const firstPart = f.system.damage.parts[0];
        const formula = firstPart[0] || "0";
        const type = firstPart[1] || "";
        return `<button class="not-dice-gm-damage-skill-btn" data-formula="${formula}" data-type="${type}" data-name="${f.name}" style="padding:4px; font-weight:bold; font-size:0.85em; border-radius:4px; border:1px solid var(--color-border-light-2, #777); background:rgba(128,128,128,0.1); color:inherit; cursor:pointer; text-align:left; display:flex; justify-content:space-between; align-items:center;">
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;" title="${f.name}">${f.name}</span>
            <span style="opacity:0.75; font-family:monospace; font-size:0.9em; flex-shrink:0;">${formula}</span>
        </button>`;
    }).join("");

    return `
        <div style="margin-top: 8px; border-top: 1px dashed var(--color-border-light-2, #777); padding-top: 6px;">
            <div style="font-weight:bold; font-size:0.85em; margin-bottom:4px; text-align:center; color:inherit; opacity:0.9;">Habilidades del Actor</div>
            <div style="display:flex; flex-direction:column; gap:4px; max-height:120px; overflow-y:auto; padding-right:4px;">
                ${buttonsHtml}
            </div>
        </div>
    `;
};
