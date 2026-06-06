// ============================================================
// not-dice | dice-colors.js
// Lógica para asignar temas de color en "Dice So Nice"
// ============================================================

Hooks.once("diceSoNiceReady", (dice3d) => {
    if (!globalThis.notDiceConstants?.diceStyle) return;
    
    // Registramos todos los colores para todos los clientes (GM y jugadores)
    // Así evitamos que si un jugador tira con un color que el GM no ha registrado, salgan dados negros.
    for (const [damageType, style] of Object.entries(globalThis.notDiceConstants.diceStyle)) {
        if (style && dice3d.addColorset) {
            dice3d.addColorset({
                name: `not-dice-${damageType}`,
                description: `Not Dice - ${damageType}`,
                category: "Not Dice",
                foreground: style.foreground,
                background: style.background,
                outline: "none",
                edge: "#222222",
                material: "plastic"
            });
        }
    }
});

globalThis.notDiceApplyColorset = (rollObj, damageType) => {
    const isEnabled = game.settings.get("not-dice", "enableCustomDiceColors");
    if (!isEnabled || !game.dice3d || !damageType || damageType === "none" || !globalThis.notDiceConstants?.diceStyle) return;
    const style = globalThis.notDiceConstants.diceStyle[damageType];
    if (style) {
        const colorSetName = `not-dice-${damageType}`;
        rollObj.terms.forEach(t => {
            if (t.faces) {
                t.options = t.options || {};
                t.options.colorset = colorSetName;
            }
        });
    }
};
