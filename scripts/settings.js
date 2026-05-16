// ============================================================
// not-dice | settings.js
// Configuración de ajustes del módulo
// ============================================================

Hooks.once("init", () => {
    console.log("Not Dice | Registrando configuraciones...");

    // --- Configuraciones Generales (module.js) ---
    game.settings.register("not-dice", "enableModule", {
        name: "Habilitar Módulo",
        hint: "Activa o desactiva la funcionalidad completa del módulo. Requiere recargar.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => window.location.reload()
    });

    game.settings.register("not-dice", "enableSimultaneousRoll", {
        name: "Tirada de Ataque Simultánea",
        hint: "Realiza la tirada de ataque automáticamente al abrir el diálogo de daño.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("not-dice", "enableSound", {
        name: "Sonido de Dados",
        hint: "Reproducir sonido si Dice So Nice no está activo.",
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
        default: true
    });

    game.settings.register("not-dice", "enableTranslation", {
        name: "Habilitar Traducción de Descripciones",
        hint: "Traduce automáticamente la descripción de los hechizos al español usando MyMemory.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("not-dice", "myMemoryEmail", {
        name: "Email para MyMemory (Opcional)",
        hint: "Ingresa tu email para aumentar el límite de uso diario de la API gratuita de MyMemory.",
        scope: "client",
        config: true,
        type: String,
        default: ""
    });
});
