// ============================================================
// not-dice | dice-colors.js
// Lógica para asignar temas de color en "Dice So Nice"
// ============================================================

globalThis.notDiceApplyColorset = (rollObj, damageType) => {
    if (!game.dice3d || !damageType || damageType === "none" || !globalThis.notDiceConstants?.damageStyle) return;
    const style = globalThis.notDiceConstants.damageStyle[damageType];
    if (style && style.color !== "inherit") {
        const colorSetName = `not-dice-${damageType}`;
        if (!game.dice3d.colorsets?.[colorSetName] && game.dice3d.addColorset) {
            game.dice3d.addColorset({
                name: colorSetName,
                description: `Not Dice - ${damageType}`,
                category: "Not Dice",
                foreground: "#ffffff",
                background: style.color,
                outline: "none",
                edge: "#222222",
                material: "plastic"
            });
        }
        rollObj.terms.forEach(t => {
            if (t.faces) {
                t.options = t.options || {};
                t.options.colorset = colorSetName;
            }
        });
    }
};
