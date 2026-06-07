// ============================================================
// not-dice | constants.js
// Constantes globales del módulo
// ============================================================

globalThis.notDiceConstants = {
    statusES: {
        blinded: "Cegado", charmed: "Encantado", deafened: "Ensordecido", diseased: "Enfermo",
        exhaustion: "Agotamiento", frightened: "Asustado", grappled: "Aferrado", incapacitated: "Incapacitado",
        invisible: "Invisible", paralyzed: "Paralizado", petrified: "Petrificado", poisoned: "Envenenado",
        prone: "Derribado", restrained: "Restringido", stunned: "Aturdido", unconscious: "Inconsciente",
        concentrating: "Concentrado", dead: "Muerto", dodging: "Esquivando", hiding: "Ocultado",
        sleeping: "Dormido", surprised: "Sorprendido", silenced: "Silenciado", transformed: "Transformado"
    },
    
    damageStyle: {
         acid: { color: "#aeea00", bg: "rgba(174, 234, 0, 0.15)", border: "rgba(174, 234, 0, 0.4)" },
         bludgeoning: { color: "inherit", bg: "rgba(128, 128, 128, 0.15)", border: "var(--color-border-light-2, #ccc)" },
         cold: { color: "#4fc3f7", bg: "rgba(79, 195, 247, 0.15)", border: "rgba(79, 195, 247, 0.4)" },
         fire: { color: "#ff5252", bg: "rgba(255, 82, 82, 0.15)", border: "rgba(255, 82, 82, 0.4)" },
         force: { color: "#e040fb", bg: "rgba(224, 64, 251, 0.15)", border: "rgba(224, 64, 251, 0.4)" }, 
         lightning: { color: "#ffd600", bg: "rgba(255, 214, 0, 0.15)", border: "rgba(255, 214, 0, 0.4)" },
         necrotic: { color: "#b0bec5", bg: "rgba(176, 190, 197, 0.15)", border: "rgba(176, 190, 197, 0.4)" },
         piercing: { color: "inherit", bg: "rgba(128, 128, 128, 0.15)", border: "var(--color-border-light-2, #ccc)" },
         poison: { color: "#69f0ae", bg: "rgba(105, 240, 174, 0.15)", border: "rgba(105, 240, 174, 0.4)" },
         psychic: { color: "#ff4081", bg: "rgba(255, 64, 129, 0.15)", border: "rgba(255, 64, 129, 0.4)" },
         radiant: { color: "#ffca28", bg: "rgba(255, 202, 40, 0.15)", border: "rgba(255, 202, 40, 0.4)" },
         slashing: { color: "inherit", bg: "rgba(128, 128, 128, 0.15)", border: "var(--color-border-light-2, #ccc)" },
         thunder: { color: "#7c4dff", bg: "rgba(124, 77, 255, 0.15)", border: "rgba(124, 77, 255, 0.4)" },
         healing: { color: "#69f0ae", bg: "rgba(105, 240, 174, 0.15)", border: "rgba(105, 240, 174, 0.4)" },
         temphp: { color: "inherit", bg: "rgba(128, 128, 128, 0.15)", border: "var(--color-border-light-2, #ccc)" }
    },
    
    diceStyle: {
         acid: { background: "#aeea00", foreground: "#ff0000" },
         bludgeoning: { background: "#808080", foreground: "#ffffff" },
         cold: { background: "#4fc3f7", foreground: "#ffffff" },
         fire: { background: "#ff5252", foreground: "#ffd600" },
         force: { background: "#e040fb", foreground: "#ffffff" },
         lightning: { background: "#ffd600", foreground: "#000000" },
         necrotic: { background: "#37474f", foreground: "#ffffff" },
         piercing: { background: "#9e9e9e", foreground: "#ffffff" },
         poison: { background: "#00c853", foreground: "#ffffff" },
         psychic: { background: "#ff4081", foreground: "#ffffff" },
         radiant: { background: "#ffca28", foreground: "#ffffff" },
         slashing: { background: "#757575", foreground: "#ffffff" },
         thunder: { background: "#7c4dff", foreground: "#ffd600" },
         healing: { background: "#69f0ae", foreground: "#000000" },
         temphp: { background: "#9e9e9e", foreground: "#ffffff" }
    },
    
    multiplierOptions: [
        { val: -1, label: "Curar" },
        { val: 0, label: "x0" },
        { val: 0.25, label: "x1/4" },
        { val: 0.5, label: "x1/2" },
        { val: 1, label: "x1" },
        { val: 2, label: "x2" }
    ],
    
    masteryDescriptions: {
        sap: "DEBILITAR\nSi aciertas a una criatura con esta arma, tendrá desventaja en su próxima tirada de ataque antes del principio de tu siguiente turno.",
        topple: "DERRIBAR\nSi aciertas a una criatura con esta arma, puedes obligarla a hacer una tirada de salvación de Constitución (CD 8 más el modificador por característica usado en la tirada de ataque y tu bonificador por competencia). Si la falla, tendrá el estado de derribada.",
        push: "EMPUJAR\nSi aciertas a una criatura con esta arma, puedes empujarla hasta 3 m respecto a ti en línea recta si es Grande o más pequeña.",
        cleave: "HENDER\nSi aciertas a una criatura con una tirada de ataque cuerpo a cuerpo con esta arma, puedes hacer una tirada de ataque cuerpo a cuerpo con el arma contra una segunda criatura que se encuentre a 1,5 m o menos de la primera y que también esté a tu alcance. Si aciertas, la segunda criatura sufrirá el daño del arma, pero no sumarás tu modificador por característica a ese daño salvo que el modificador sea negativo. Solo puedes hacer este ataque extra una vez por turno.",
        nick: "MELLAR\nCuando hagas el ataque extra de la propiedad “ligera”, puedes hacerlo como parte de la acción de atacar en vez de como acción adicional. Solo puedes hacer este ataque extra una vez por turno.",
        vex: "MOLESTAR\nSi aciertas a una criatura con esta arma y le causas daño, tendrás ventaja en tu siguiente tirada de ataque contra esa criatura antes del final de tu siguiente turno.",
        slow: "RALENTIZAR\nSi aciertas a una criatura con esta arma y le causas daño, puedes reducir su velocidad en 3 m hasta el principio de tu siguiente turno. Si la criatura sufre más de un ataque con armas que tengan esta propiedad, la reducción de su velocidad no superará los 3 m.",
        graze: "ROZAR\nSi tu tirada de ataque con esta arma no acierta a una criatura, puedes causarle una cantidad de daño igual al modificador por característica que hayas usado para hacer la tirada de ataque. Este daño es del mismo tipo que inflija el arma y solo se puede incrementar si aumentas el modificador por característica."
    }
};
