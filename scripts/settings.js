// ============================================================
// not-dice | settings.js
// Configuración de ajustes del módulo
// ============================================================

Hooks.once("init", () => {
    (globalThis.notDiceLogger || console).info("Registrando configuraciones...");

    game.settings.register("not-dice", "enableDebugLogs", {
        name: "Habilitar Logs de Depuración",
        hint: "Muestra logs detallados y trazas de depuración del módulo en la consola.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    // --- Configuraciones Generales (module.js) ---
    game.settings.register("not-dice", "enableSimultaneousRoll", {
        name: "Tirada de Ataque Simultánea",
        hint: "Realiza la tirada de ataque automáticamente al abrir el diálogo de daño.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register("not-dice", "enableAutoDamageRequestOnHit", {
        name: "Auto Solicitar Daño al Acertar",
        hint: "Si un jugador acierta un ataque, el GM envía automáticamente al jugador el botón para lanzar daño.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register("not-dice", "enableSound", {
        name: "Sonido de Dados",
        hint: "Reproducir sonido si Dice So Nice no está activo.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("not-dice", "enableCustomDiceColors", {
        name: "Colores de Dados Personalizados",
        hint: "Si está activo, colorea los dados en 3D (Dice So Nice) según el tipo de daño.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("not-dice", "enablePlayerColorChat", {
        name: "Fondo de Chat por Jugador",
        hint: "Colorea el fondo y los bordes de los mensajes del chat con el color asignado a cada jugador.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    // --- Configuraciones de Áreas y Traducción (saving-throw.js) ---
    game.settings.register("not-dice", "enableTemplateIntercept", {
        name: "Detectar Área de Efecto",
        hint: "Muestra un diálogo con los tokens afectados al colocar una plantilla.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register("not-dice", "enableTranslation", {
        name: "Habilitar Traducción de Descripciones",
        hint: "Traduce automáticamente la descripción de los hechizos al español usando MyMemory.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register("not-dice", "myMemoryEmail", {
        name: "Email para MyMemory (Opcional)",
        hint: "Ingresa tu email para aumentar el límite de uso diario de la API gratuita de MyMemory.",
        scope: "client",
        config: true,
        type: String,
        default: "",
        restricted: true
    });
});
