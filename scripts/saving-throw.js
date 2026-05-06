// ============================================================
// not-dice | saving-throw.js
// Intercepta hechizos/habilidades que colocan plantilla de área.
// Muestra diálogo con info clave antes de colocar la plantilla.
// ============================================================

// --- Setting -----------------------------------------------
Hooks.once("init", () => {
    game.settings.register("not-dice", "enableSavingThrowIntercept", {
        name: "Interceptar Tiradas de Salvación",
        hint: "Reemplaza el diálogo nativo de salvación con uno personalizado.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });
});

// --- Helpers ------------------------------------------------
const notDiceSaveAbilityLabel = (abilityKey) => {
    return CONFIG.DND5E?.abilities?.[abilityKey]?.label ?? abilityKey?.toUpperCase() ?? "?";
};

const notDiceSaveStatusES = {
    blinded: "Cegado", charmed: "Encantado", deafened: "Ensordecido",
    frightened: "Asustado", grappled: "Aferrado", incapacitated: "Incapacitado",
    invisible: "Invisible", paralyzed: "Paralizado", petrified: "Petrificado",
    poisoned: "Envenenado", prone: "Derribado", restrained: "Restringido",
    stunned: "Aturdido", unconscious: "Inconsciente", concentrating: "Concentrado",
    exhaustion: "Agotamiento", dead: "Muerto", dodging: "Esquivando",
    hiding: "Ocultado", surprised: "Sorprendido"
};

// Guarda contexto reciente de hechizos con salvación por objetivo
const notDicePendingSaveByActor = new Map();

const notDiceRememberPendingSave = (activity) => {
    if (!activity || activity.type !== "save") return;
    if (activity.item?.type !== "spell") return;

    const spellName = activity.item?.name ?? "Hechizo";
    const casterName = activity.actor?.name ?? "Desconocido";
    const dc = activity.save?.dc?.value ?? null;
    const now = Date.now();

    const targets = Array.from(game.user?.targets ?? []);
    for (const token of targets) {
        const actor = token?.actor;
        if (!actor?.uuid) continue;
        notDicePendingSaveByActor.set(actor.uuid, { spellName, casterName, dc, ts: now });
    }

    console.log(`Not Dice | Spell Save capturado: ${spellName} (CD ${dc ?? "-"}) por ${casterName}`);
};

const notDiceConsumePendingSave = (actor) => {
    if (!actor?.uuid) return null;
    const pending = notDicePendingSaveByActor.get(actor.uuid);
    if (!pending) return null;

    // Evita usar contexto viejo si pasaron muchos segundos
    if ((Date.now() - pending.ts) > 30000) {
        notDicePendingSaveByActor.delete(actor.uuid);
        return null;
    }

    notDicePendingSaveByActor.delete(actor.uuid);
    return pending;
};

// Evalúa el roll de salvación a partir del config de dnd5e
const notDiceEvaluateSave = async (config) => {
    const actor = config.subject;
    const rollConfig0 = config.rolls?.[0] ?? {};
    const parts   = rollConfig0.parts  ?? [];
    const data    = rollConfig0.data   ?? actor.getRollData();
    const options = rollConfig0.options ?? {};

    const advConfig = config.advantage ?? options.advantage ?? false;
    const disConfig = config.disadvantage ?? options.disadvantage ?? false;
    const isAdv = advConfig && !disConfig;
    const isDis = disConfig && !advConfig;

    const dicePart = isAdv ? "2d20kh" : isDis ? "2d20kl" : "1d20";
    const formula  = [dicePart, ...parts].filter(Boolean).join(" + ");

    const roll = new Roll(formula, data);
    await roll.evaluate();

    if (game.dice3d) {
        await game.dice3d.showForRoll(roll, game.user, true);
    } else if (game.settings.get("not-dice", "enableSound")) {
        AudioHelper.play({ src: "sounds/dice.wav" });
    }

    return { roll, isAdv, isDis };
};

// Muestra el diálogo personalizado de salvación
const notDiceShowSavingThrowDialog = async (config) => {
    const actor       = config.subject;
    const abilityKey  = config.ability;
    const abilityLabel = notDiceSaveAbilityLabel(abilityKey);
    const pendingSpell = notDiceConsumePendingSave(actor);
    const dc = config.target ?? config.targetValue ?? pendingSpell?.dc ?? null;

    const { roll, isAdv, isDis } = await notDiceEvaluateSave(config);

    const d20Term   = roll.terms[0];
    const d20Result = d20Term?.total ?? roll.total;
    const total     = roll.total;

    // Modificador de salvación del actor
    const saveMod  = actor.system?.abilities?.[abilityKey]?.save ?? 0;
    const modLabel = saveMod >= 0 ? `+${saveMod}` : `${saveMod}`;

    // Éxito / Fallo
    const passed = dc !== null ? total >= dc : null;

    // Colores del recuadro de resultado
    let bg = "rgba(0,0,0,0.04)", border = "#7a7971", textColor = "#222";
    if      (d20Result === 20)   { bg = "#2e7d32"; border = "#1b5e20"; textColor = "#fff"; }
    else if (d20Result === 1)    { bg = "#c62828"; border = "#b71c1c"; textColor = "#fff"; }
    else if (passed === true)    { bg = "#c8e6c9"; border = "#4caf50"; }
    else if (passed === false)   { bg = "#ffcdd2"; border = "#f44336"; }

    // HP
    const hp     = actor.system?.attributes?.hp;
    const hpText = hp ? `${hp.value} / ${hp.max}` : "—";

    // Imagen del actor
    const imgHtml = actor.img
        ? `<img src="${actor.img}" style="width:46px;height:46px;border-radius:50%;border:1px solid #aaa;object-fit:cover;flex-shrink:0;">`
        : "";

    // Condiciones activas
    const conditions = Array.from(actor.statuses ?? new Set())
        .map(s => notDiceSaveStatusES[s] || s);
    const condHtml = conditions.length
        ? `<div style="font-size:0.75em;color:#777;margin-top:3px;font-style:italic;"><i class="fas fa-exclamation-circle"></i> ${conditions.join(", ")}</div>`
        : "";

    // Badge ventaja/desventaja
    let advHtml = "";
    if      (isAdv) advHtml = `<span style="color:#1565c0;font-size:0.82em;font-weight:bold;"><i class="fas fa-arrow-up"></i> Ventaja</span>`;
    else if (isDis) advHtml = `<span style="color:#b71c1c;font-size:0.82em;font-weight:bold;"><i class="fas fa-arrow-down"></i> Desventaja</span>`;

    // Éxito / Fallo badge
    let pfHtml = "";
    if      (passed === true)  pfHtml = `<div style="font-size:1em;font-weight:900;color:#1b5e20;margin-top:4px;">✔ SUPERA</div>`;
    else if (passed === false) pfHtml = `<div style="font-size:1em;font-weight:900;color:#b71c1c;margin-top:4px;">✘ FALLA</div>`;

    // CD
    const dcHtml = dc !== null
        ? `<span style="font-size:1.05em;font-weight:900;">CD&nbsp;${dc}</span>`
        : `<span style="color:#999;font-style:italic;">CD —</span>`;

    // Detalle del d20 (muestra los dos dados si ventaja/desventaja)
    let d20Detail = `${d20Result}`;
    if ((isAdv || isDis) && d20Term?.results?.length > 1) {
        const all = d20Term.results.map(r => r.result).join(", ");
        d20Detail = `${all} → <strong>${d20Result}</strong>`;
    } else {
        d20Detail = `<strong>${d20Result}</strong>`;
    }

    const content = `
        <div style="font-family:inherit;padding:4px 2px;">
            ${pendingSpell ? `<div style="font-size:0.8em;color:#444;margin-bottom:8px;padding:6px;border:1px solid #ddd;border-radius:6px;background:rgba(0,0,0,0.03);"><strong>Hechizo:</strong> ${pendingSpell.spellName} <span style="color:#666;">(${pendingSpell.casterName})</span></div>` : ""}
            <!-- Cabecera actor -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #ddd;">
                ${imgHtml}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:1.05em;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${actor.name}</div>
                    <div style="font-size:0.8em;color:#555;">❤️ ${hpText}</div>
                    ${condHtml}
                </div>
                <div style="text-align:right;flex-shrink:0;">${dcHtml}</div>
            </div>
            <!-- Tipo de salvación -->
            <div style="text-align:center;margin-bottom:10px;">
                <div style="font-size:0.72em;text-transform:uppercase;letter-spacing:1px;color:#666;">Salvación de</div>
                <div style="font-size:1.4em;font-weight:900;">${abilityLabel} <span style="font-size:0.72em;color:#555;font-weight:normal;">(${modLabel})</span></div>
                ${advHtml ? `<div style="margin-top:2px;">${advHtml}</div>` : ""}
            </div>
            <!-- Resultado -->
            <div style="text-align:center;padding:10px 8px;border-radius:6px;border:2px solid ${border};background:${bg};color:${textColor};">
                <div style="font-size:0.82em;opacity:0.9;">d20: ${d20Detail} &nbsp;+&nbsp; (${modLabel})</div>
                <div style="font-size:2em;font-weight:900;line-height:1.1;">${total}</div>
                ${pfHtml}
            </div>
        </div>`;

    return new Promise(resolve => {
        const dialogData = {
            title: `Salvación: ${abilityLabel} — ${actor.name}`,
            content,
            buttons: {
                reroll: {
                    label: "<i class='fas fa-redo'></i> Re-tirar",
                    callback: async () => {
                        await notDiceShowSavingThrowDialog(config);
                        resolve();
                    }
                },
                ok: {
                    label: "<i class='fas fa-check'></i> Aceptar",
                    callback: () => resolve()
                }
            },
            default: "ok",
            close: () => resolve()
        };

        // Foundry v14+: usa constructor de DialogV2 (API comprobada en dnd5e 5.x)
        const DialogV2 = foundry?.applications?.api?.DialogV2;
        if (DialogV2) {
            const app = new DialogV2({
                window: { title: dialogData.title },
                content: dialogData.content,
                position: { width: 320 },
                buttons: [
                    {
                        action: "reroll",
                        icon: "fa-solid fa-rotate-right",
                        label: "Re-tirar"
                    },
                    {
                        action: "ok",
                        icon: "fa-solid fa-check",
                        label: "Aceptar",
                        default: true
                    }
                ],
                submit: async (result) => {
                    if (result === "reroll") {
                        await notDiceShowSavingThrowDialog(config);
                    }
                    resolve();
                }
            });
            app.addEventListener("close", () => resolve(), { once: true });
            app.render(true);
            return;
        }

        // Fallback legacy
        if (typeof Dialog !== "undefined") {
            new Dialog(dialogData, { width: 320 }).render(true);
            return;
        }

        console.warn("Not Dice | No se encontró Dialog ni DialogV2 para mostrar salvación.");
        ui.notifications?.warn("Not Dice: no se pudo abrir diálogo de salvación (API de diálogo no disponible)");
        resolve();
    });
};

// --- Hook principal -----------------------------------------
// Se registra en ready para garantizar que game.settings esté listo.
Hooks.once("ready", () => {
    Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
        notDiceRememberPendingSave(activity);
    });

    const interceptSaveRoll = (config, dialog, message) => {
        if (!game.settings.get("not-dice", "enableSavingThrowIntercept")) return;
        if (!config?.subject || !config?.ability) return;

        // Lanza el diálogo personalizado de forma asíncrona
        notDiceShowSavingThrowDialog(config).catch(err => {
            console.error("Not Dice | Error en salvación personalizada", err);
        });

        // Cancela el pipeline nativo (diálogo + chat message)
        return false;
    };

    // En dnd5e 5.x se disparan ambos; mantenemos ambos hooks por compatibilidad.
    Hooks.on("dnd5e.preRollSavingThrow", interceptSaveRoll);
    Hooks.on("dnd5e.preRollSavingThrowV2", interceptSaveRoll);

    // Fallback duro para Foundry v14 / dnd5e 5.x:
    // si por cualquier razón no se dispara el hook, interceptamos rollSavingThrow en cualquier prototipo compatible.
    const actorPrototypes = [
        CONFIG.Actor?.documentClass?.prototype,
        game.dnd5e?.documents?.Actor5e?.prototype,
        Actor?.prototype
    ].filter(Boolean);

    if (!globalThis._notDiceSavingThrowWrapped) {
        let wrappedAny = false;

        for (const proto of actorPrototypes) {
            if (typeof proto.rollSavingThrow !== "function") continue;
            if (proto._notDiceWrappedRollSavingThrow) continue;

            const originalRollSavingThrow = proto.rollSavingThrow;
            proto.rollSavingThrow = async function(config = {}, dialog = {}, message = {}) {
                if (!game.settings.get("not-dice", "enableSavingThrowIntercept")) {
                    return originalRollSavingThrow.call(this, config, dialog, message);
                }

                const abilityKey = config?.ability;
                if (!abilityKey) {
                    return originalRollSavingThrow.call(this, config, dialog, message);
                }

                try {
                    console.log("Not Dice | rollSavingThrow interceptado", this.name, abilityKey, config?.target);

                    const saveRaw = this.system?.abilities?.[abilityKey]?.save;
                    const saveMod = Number.isFinite(saveRaw)
                        ? saveRaw
                        : (this.system?.abilities?.[abilityKey]?.mod ?? 0);

                    const adv = config.advantage ?? !!config?.event?.shiftKey;
                    const dis = config.disadvantage ?? !!config?.event?.ctrlKey;

                    const syntheticConfig = {
                        subject: this,
                        ability: abilityKey,
                        target: config.target ?? config.targetValue ?? null,
                        advantage: adv,
                        disadvantage: dis,
                        rolls: [{
                            parts: [String(saveMod)],
                            data: this.getRollData(),
                            options: {
                                advantage: adv,
                                disadvantage: dis
                            }
                        }]
                    };

                    await notDiceShowSavingThrowDialog(syntheticConfig);
                    return [];
                } catch (err) {
                    console.error("Not Dice | Fallback rollSavingThrow falló", err);
                    return originalRollSavingThrow.call(this, config, dialog, message);
                }
            };

            proto._notDiceWrappedRollSavingThrow = true;
            wrappedAny = true;
        }

        globalThis._notDiceSavingThrowWrapped = wrappedAny;
        console.log(`Not Dice | rollSavingThrow wrapper activo: ${wrappedAny}`);
    }
});
