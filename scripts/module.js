// ============================================================
// not-dice | module.js
// Intercepta tiradas de ataque y daño, aplicando interfaz 
// moderna y resolución automática de maestrias/efectos.
// Compatible dinámicamente con Modo Claro y Modo Oscuro.
// ============================================================

Hooks.once("init", () => {
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
});

// Helpers --------------------------------------------------------------
const notDiceIsAttack = (subject) => {
    return subject && (subject.type === "attack" || subject.constructor?.name === "AttackActivity");
};

const notDiceFirstActiveGmId = () => {
    return game.users.find(u => u.isGM && u.active)?.id || null;
};

const notDiceBuildAttackPayload = (rollConfig) => {
    return {
        type: "not-dice.show-attack-dialog",
        itemUuid: rollConfig.subject?.item?.uuid,
        activityId: rollConfig.subject?.id,
        targetIds: Array.from(game.user.targets ?? []).map(t => t.id),
        isNickAttack: rollConfig.isNickAttack,
        senderName: game.user.name,
        targetUserId: notDiceFirstActiveGmId()
    };
};

const notDiceHandlePlayerAttack = async (rolls, rollConfig) => {
    const payload = notDiceBuildAttackPayload(rollConfig);
    if (!payload.targetUserId || !game.socket) {
        ui.notifications?.warn("Not Dice | No hay GM activo para recibir el daño.");
        return [];
    }
    game.socket.emit("module.not-dice", payload);
    ui.notifications?.info("Not Dice | Ataque enviado al GM para resolución.");
    return [];
};

const notDiceHandleAttackSocket = async (data) => {
    if (!data || !game.user.isGM) return;

    // Respeta destinatario específico si viene indicado
    if (data.targetUserId && data.targetUserId !== game.user.id) return;

    // Solo log sencillo cuando un jugador inicia ataque
    if (data.type === "not-dice.attack-log") {
        console.log(`Not Dice | Ataque de ${data.userName || "Jugador"}: ${data.attacker} con ${data.itemName} -> Objetivos: ${data.targets}`);
        return;
    }

    if (data.type !== "not-dice.show-attack-dialog") return;

    try {
        const item = data.itemUuid ? await fromUuid(data.itemUuid) : null;
        const activity = data.activityId ? item?.system?.activities?.get(data.activityId) : item?.system?.activities?.find(a => a.type === "damage" || a.type === "attack");
        if (!item || !activity) return ui.notifications?.warn("Not Dice | No se pudo recuperar la actividad del ataque.");

        await activity.rollDamage({
            event: { targetIds: data.targetIds },
            isNickAttack: data.isNickAttack
        });
        ui.notifications?.info(`Not Dice | Resolviendo daño enviado por ${data.senderName || "jugador"}.`);
    } catch (err) {
        console.error("Not Dice | Error inyectando popup directo", err);
    }
};

Hooks.once("ready", () => {
    if (!globalThis._notDiceSocketReady) {
        globalThis._notDiceSocketReady = true;
        game.socket.on("module.not-dice", notDiceHandleAttackSocket);
    }

    if (!game.settings.get("not-dice", "enableModule")) return;

    console.log("Not Dice | Module Ready");

    // --- D20Roll (Attack) Patching ---
    const D20Roll = CONFIG.Dice.D20Roll;
    if (D20Roll) {
        const originalBuildConfigure = D20Roll.buildConfigure;
        const originalBuildEvaluate = D20Roll.buildEvaluate;

        D20Roll.buildConfigure = async function(config, dialog, message) {
            console.log("Not Dice | D20 buildConfigure intercepted", config);

            if (config.isNickAttack) {
                console.log("Not Dice | >>> ATAQUE MELLAR DETECTADO <<<");
                const actor = config.subject?.actor;
                const hasTwoWeaponStyle = actor?.items?.some(i => 
                    i.system?.identifier === "two-weapon-fighting" || 
                    i.name === "Two-Weapon Fighting" || 
                    (i.name.toLowerCase().includes("combate con dos armas") && i.type === "feat")
                );

                if (hasTwoWeaponStyle) {
                    console.log("Not Dice | Estilo de Combate Two-Weapon Fighting: DETECTADO");
                } else {
                    console.log("Not Dice | Estilo de Combate Two-Weapon Fighting: NO DETECTADO");
                }
            }

            const isAttack = config.subject && 
                             (config.subject.type === "attack" || 
                              config.subject.constructor.name === "AttackActivity");
            
            if (isAttack) {
                console.log("Not Dice | Skipping system dialog and chat message for Attack.");
                dialog = foundry.utils.mergeObject(dialog ?? {}, { configure: false });
                if (message) message.create = false;
            }
            return originalBuildConfigure.call(this, config, dialog, message);
        };

        D20Roll.buildEvaluate = async function(rolls, rollConfig, messageConfig) {
            console.log("Not Dice | D20 buildEvaluate intercepted", rolls);
            const isAttack = notDiceIsAttack(rollConfig.subject);

            // Player branch: solo empaqueta y envía al GM
            if (isAttack && !game.user.isGM) {
                return notDiceHandlePlayerAttack(rolls, rollConfig);
            }

            if (isAttack) {
                console.log("Not Dice | Auto-resolving Attack Roll (Silent).");
                for (const roll of rolls) {
                    const total = 20;
                    const numericTerm = new foundry.dice.terms.NumericTerm({number: total});
                    numericTerm._evaluated = true;
                    roll.terms = [numericTerm];
                    roll._total = total;
                    roll._evaluated = true;
                    
                    // Solo el GM debe disparar el daño automático y mostrar popup.
                    if (game.user.isGM) {
                        setTimeout(() => {
                            if (rollConfig.subject && rollConfig.subject.rollDamage) {
                                console.log("Not Dice | Triggering Auto-Damage Roll (GM)");
                                rollConfig.subject.rollDamage({
                                    event: rollConfig.event,
                                    isNickAttack: rollConfig.isNickAttack
                                });
                            }
                        }, 250);
                    }
                }
                return rolls;
            }
            return originalBuildEvaluate.apply(this, arguments);
        };
    }

    // --- DamageRoll Patching ---
    const DamageRoll = CONFIG.Dice.DamageRoll;
    if (DamageRoll) {
        const originalDamageBuildConfigure = DamageRoll.buildConfigure;
        const originalDamageBuildEvaluate = DamageRoll.buildEvaluate;

        const notDiceEvaluateDamageRoll = async (rolls, rollConfig, messageConfig) => {
            console.log("Not Dice | Damage buildEvaluate intercepted", rolls);
            
            const passedMultipliers = rollConfig?.notDiceMultipliers || rollConfig?.options?.notDiceMultipliers || rollConfig?.event?.notDiceMultipliers || {};
            
            // --- Nick Attack Logic ---
            const isNickAttack = rollConfig.isNickAttack;
            const actor = rollConfig.subject?.actor || rollConfig.subject?.item?.actor;
            const hasTwoWeaponStyle = actor?.items?.some(i => 
                  i.system?.identifier === "two-weapon-fighting" || 
                  i.name === "Two-Weapon Fighting" || 
                  (i.name.toLowerCase().includes("combate con dos armas") && i.type === "feat")
            );
            const isOffhandWithoutStyle = isNickAttack && !hasTwoWeaponStyle;
            if (isOffhandWithoutStyle) console.log("Not Dice | Offhand Attack without Style - Removing Ability Mod from formula.");

            const hasDivineFavor = actor?.effects?.some(e => {
                const name = (e.name || "").toLowerCase();
                return name.includes("divine favor") || name.includes("favor divino");
            });

            if (hasDivineFavor) {
                const divineFavorRoll = new DamageRoll("1d4", {}, { type: "radiant" });
                divineFavorRoll.options = divineFavorRoll.options || {};
                divineFavorRoll.options.type = "radiant";
                divineFavorRoll.options.notDiceLabel = "Favor Divino";
                rolls.push(divineFavorRoll);
            }

            // --- Detect Hunter's Mark / Marca del Cazador on targets ---
            const attackerUuid = actor?.uuid;
            const huntersMarkTargets = Array.from(game.user.targets ?? []);
            const hasHuntersMark = attackerUuid && huntersMarkTargets.some(t =>
                t.actor?.effects?.some(e => {
                    const eName = (e.name || "").toLowerCase();
                    return (eName.includes("hunter's mark") || eName.includes("marca del cazador"))
                        && (e.origin || "").includes(attackerUuid);
                })
            );

            if (hasHuntersMark) {
                console.log("Not Dice | Hunter's Mark detectada en objetivo — añadiendo 1d6 force");
                const huntersMarkRoll = new DamageRoll("1d6", {}, { type: "force" });
                huntersMarkRoll.options = huntersMarkRoll.options || {};
                huntersMarkRoll.options.type = "force";
                huntersMarkRoll.options.notDiceLabel = "Marca del Cazador";
                rolls.push(huntersMarkRoll);
            }

            const item = rollConfig.subject.item;

            // --- Detect Mastery ---
            let activeMastery = null;
            if (item) {
                 const baseItem = item.system.type?.baseItem;
                 const actorMasteries = item.actor?.system?.traits?.weaponProf?.mastery?.value || new Set();
                 if (baseItem && actorMasteries.has(baseItem) && item.system.mastery) {
                     activeMastery = {
                         id: item.system.mastery,
                         label: CONFIG.DND5E.weaponMasteries?.[item.system.mastery]?.label || item.system.mastery
                     };
                 }
            }

            // --- Detect Guiding Bolt / Saeta Guía ---
            let isGuidingBolt = false;
            if (item) {
                const spellName = (item.name || "").toLowerCase();
                if (spellName.includes("guiding bolt") || spellName.includes("saeta guía") || spellName.includes("saeta guia")) {
                    isGuidingBolt = true;
                }
            }

            // Function to calculate versatile damage scaling (d6->d8, d8->d10)
            const scaleVersatile = (formula) => {
                if (formula.includes("d6")) return formula.replace("d6", "d8");
                if (formula.includes("d8")) return formula.replace("d8", "d10");
                return null;
            };

            // --- Process All Rolls ---
            const damageParts = [];
            const allDamageTypes = new Set();
            const activityDamageParts = rollConfig?.subject?.damage?.parts || [];
            
            for (let i = 0; i < rolls.length; i++) {
                const roll = rolls[i];
                let originalFormula = roll.formula;
                
                if (isOffhandWithoutStyle) {
                     // Remove + @mod or + number from end
                     originalFormula = originalFormula.replace(/\s*\+\s*(@mod|\d+)(\s*\[.*?\])?$/, "");
                }

                let versatileFormula = null;
                if (!versatileFormula && item?.system?.properties?.has("ver")) {
                    versatileFormula = scaleVersatile(originalFormula);
                }

                const damageTypeKey = roll.options.type;
                const partConfig = activityDamageParts[i];
                let availableTypes = partConfig?.types ? Array.from(partConfig.types) : [];

                if (damageTypeKey) {
                    if(!availableTypes.includes(damageTypeKey)) availableTypes.push(damageTypeKey);
                    allDamageTypes.add(damageTypeKey);
                }
                if (availableTypes.length > 0) {
                     availableTypes.forEach(t => allDamageTypes.add(t));
                }

                const damageConfig = damageTypeKey ? CONFIG.DND5E.damageTypes[damageTypeKey] : null;
                let damageTypeLabel = damageConfig?.label || damageTypeKey || "None";
                const customLabel = roll.options?.notDiceLabel;
                if (customLabel) damageTypeLabel = `${customLabel} (${damageTypeLabel})`;
                
                if (damageConfig?.icon) {
                    damageTypeLabel = `<img src="${damageConfig.icon}" style="width: 16px; height: 16px; vertical-align: text-bottom; margin-right: 4px; border: none; filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.3));" /> ${damageTypeLabel}`;
                }

                damageParts.push({
                    index: i,
                    roll: roll,
                    formula: originalFormula,
                    versatileFormula: versatileFormula,
                    label: damageTypeLabel,
                    type: damageTypeKey,
                    availableTypes: availableTypes,
                    isOffhandWithoutStyle: isOffhandWithoutStyle
                });
            }
                
            const multiplierOptions = [
                { val: -1, label: "Curar (-1)" },
                { val: 0, label: "x0" },
                { val: 0.25, label: "x1/4" },
                { val: 0.5, label: "x1/2" },
                { val: 1, label: "x1 (Normal)" },
                { val: 2, label: "x2" }
            ];

            // Helper to resolve targets
            const resolveTargets = () => {
                const inyectedIds = rollConfig?.event?.targetIds;
                if (inyectedIds && Array.isArray(inyectedIds) && inyectedIds.length > 0) {
                    const mappedTokens = inyectedIds.map(id => canvas.tokens.get(id)).filter(Boolean);
                    if (mappedTokens.length > 0) return mappedTokens;
                }
                return Array.from(game.user.targets ?? []);
            };

            const targets = resolveTargets();
            let targetHtml = "";
            
            if (targets.length > 0) {
                targetHtml += `<h3 style="border-bottom: 1px solid var(--color-border-light-2, #ccc); padding-bottom: 4px; margin-bottom: 10px; font-size: 1.1em; color: inherit; opacity: 0.9;">Objetivos (${targets.length}):</h3>`;
                targetHtml += `<div style="display: flex; flex-direction: column; gap: 8px;">`;
                for (const t of targets) {
                    const traits = t.actor?.system?.traits;
                    if (!traits) continue;
                    
                    let isResistant = false;
                    let isImmune = false;
                    let isVulnerable = false;

                    for (const dt of allDamageTypes) {
                        if (traits.dr?.value?.has(dt)) isResistant = true;
                        if (traits.di?.value?.has(dt)) isImmune = true;
                        if (traits.dv?.value?.has(dt)) isVulnerable = true;
                    }
                    
                    const getLabels = (set) => {
                        if (!set) return "";
                        return Array.from(set).map(k => CONFIG.DND5E.damageTypes[k]?.label || k).join(", ");
                    };
                    
                    const dr = getLabels(traits.dr?.value);
                    const di = getLabels(traits.di?.value);
                    const dv = getLabels(traits.dv?.value);
                    const ac = t.actor?.system?.attributes?.ac?.value;
                    const tokenImg = t.document?.texture?.src || t.actor?.img || "";
                    
                    let borderStyle = "border: 1px solid var(--color-border-light-2, #ddd);";
                    let bgStyle = "background: rgba(127,127,127,0.1);";
                    
                    if (isImmune) { borderStyle = "border: 1px solid rgba(197,34,31,0.4);"; bgStyle = "background: rgba(197,34,31,0.1);"; }
                    else if (isVulnerable) { borderStyle = "border: 1px solid rgba(11,87,208,0.4);"; bgStyle = "background: rgba(11,87,208,0.1);"; }
                    else if (isResistant) { borderStyle = "border: 1px solid rgba(176,96,0,0.4);"; bgStyle = "background: rgba(176,96,0,0.1);"; }

                    const tokenImgHtml = tokenImg ? `<img src="${tokenImg}" style="width:38px; height:38px; border-radius:50%; border:1px solid var(--color-border-light-2, #aaa); object-fit:cover; flex-shrink:0; box-shadow: 0 1px 3px rgba(0,0,0,0.3);" />` : "";

                    let badgesHtml = "";
                    if (dr) badgesHtml += `<span style="display:inline-block; font-size:0.75em; background:rgba(176,96,0,0.15); color:#ffb300; padding:2px 6px; border-radius:8px; border:1px solid rgba(176,96,0,0.3); margin-top:4px; margin-right:4px;"><i class="fas fa-shield-alt"></i> Res: ${dr}</span>`;
                    if (di) badgesHtml += `<span style="display:inline-block; font-size:0.75em; background:rgba(197,34,31,0.15); color:#ff5252; padding:2px 6px; border-radius:8px; border:1px solid rgba(197,34,31,0.3); margin-top:4px; margin-right:4px;"><i class="fas fa-ban"></i> Inm: ${di}</span>`;
                    if (dv) badgesHtml += `<span style="display:inline-block; font-size:0.75em; background:rgba(11,87,208,0.15); color:#4fc3f7; padding:2px 6px; border-radius:8px; border:1px solid rgba(11,87,208,0.3); margin-top:4px; margin-right:4px;"><i class="fas fa-heart-broken"></i> Vul: ${dv}</span>`;

                    const hasHAM = t.actor.items?.some(i => {
                        const n = (i.name || "").toLowerCase();
                        return i.type === "feat" && (n.includes("heavy armor master") || n.includes("maestro en armadura pesada"));
                    });
                    if (hasHAM) badgesHtml += `<span style="display:inline-block; font-size:0.75em; background:rgba(106,27,154,0.15); color:#ba68c8; padding:2px 6px; border-radius:8px; border:1px solid rgba(106,27,154,0.3); margin-top:4px; margin-right:4px;"><i class="fas fa-chess-rook"></i> Armadura Pesada (-Prof)</span>`;

                    const notDiceStatusES = {
                        blinded: "Cegado", charmed: "Encantado", deafened: "Ensordecido", diseased: "Enfermo",
                        exhaustion: "Agotamiento", frightened: "Asustado", grappled: "Aferrado", incapacitated: "Incapacitado",
                        invisible: "Invisible", paralyzed: "Paralizado", petrified: "Petrificado", poisoned: "Envenenado",
                        prone: "Derribado", restrained: "Restringido", stunned: "Aturdido", unconscious: "Inconsciente",
                        concentrating: "Concentrado", dead: "Muerto", dodging: "Esquivando", hiding: "Ocultado",
                        sleeping: "Dormido", surprised: "Sorprendido", silenced: "Silenciado", transformed: "Transformado"
                    };
                    const activeStatuses = t.actor?.statuses ?? new Set();
                    const conditionLabels = [];
                    for (const statusId of activeStatuses) { conditionLabels.push(notDiceStatusES[statusId] || statusId); }
                    if (conditionLabels.length > 0) {
                        badgesHtml += `<div style="font-size:0.8em; color:inherit; opacity:0.75; font-style:italic; margin-top:4px;"><i class="fas fa-exclamation-circle"></i> ${conditionLabels.join(", ")}</div>`;
                    }

                    let baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                    let detectedMultiplier = 1;
                    for (const dt of allDamageTypes) {
                        if (traits.di?.value?.has(dt)) detectedMultiplier = 0;
                        else if (traits.dv?.value?.has(dt) && detectedMultiplier !== 0) detectedMultiplier = 2;
                        else if (traits.dr?.value?.has(dt) && detectedMultiplier !== 2 && detectedMultiplier !== 0) detectedMultiplier = 0.5;
                    }
                    detectedMultiplier = detectedMultiplier * baseMult;

                    targetHtml += `
                    <div style="display:flex; align-items:flex-start; gap:10px; padding: 8px; border-radius: 6px; ${borderStyle} ${bgStyle}">
                        ${tokenImgHtml}
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:bold; font-size:1.1em; color:inherit;">${t.name}</span>
                                ${ac !== undefined ? `<span style="font-size:0.85em; font-weight:bold; background:rgba(128,128,128,0.2); color:inherit; padding:2px 6px; border-radius:4px; border:1px solid var(--color-border-light-2, #ccc); box-shadow:0 1px 1px rgba(0,0,0,0.1);" title="Clase de Armadura">CA ${ac}</span>` : ""}
                            </div>
                            <div>${badgesHtml}</div>
                        </div>
                        <div style="flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                            <label style="font-size:0.75em; color:inherit; opacity:0.7;">Multiplicador:</label>
                            <select name="target-multiplier-${t.id}" style="padding:2px 4px; border:1px solid var(--color-border-light-2, #ccc); background:rgba(128,128,128,0.1); color:inherit; border-radius:4px; font-size:0.9em; cursor:pointer;">
                                ${multiplierOptions.map(o => `<option value="${o.val}" style="color:inherit;" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                            </select>
                        </div>
                    </div>`;
                }
                targetHtml += "</div>";
            } else {
                targetHtml = "<div style='margin-bottom: 10px; font-style: italic; color: inherit; opacity:0.6; text-align:center; padding:10px; border:1px dashed var(--color-border-light-2, #ccc); border-radius:6px;'>No hay objetivo seleccionado</div>";
            }

            // --- Gather Attack Info ---
            let attackHtml = "";
            let isNickActive = false;
            let nickWeaponName = "";
            let nickWeaponItem = null;

            if (rollConfig.subject.type === "attack") {
                const toHit = item.labels?.toHit || "";
                const isProficient = item.system.proficient || false;
                const profBadge = isProficient ? `<span style="display:inline-block; font-size:0.75em; background:rgba(19,115,51,0.15); color:#4caf50; padding:3px 8px; border-radius:12px; border:1px solid rgba(19,115,51,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-check-circle"></i> Competencia</span>` : `<span style="display:inline-block; font-size:0.75em; background:rgba(127,127,127,0.15); color:inherit; opacity:0.8; padding:3px 8px; border-radius:12px; border:1px solid rgba(127,127,127,0.3); margin-right:4px;">Sin Competencia</span>`;

                let masteryBadge = "";
                if (activeMastery) {
                    masteryBadge = `<span style="display:inline-block; font-size:0.75em; background:rgba(106,27,154,0.15); color:#ba68c8; padding:3px 8px; border-radius:12px; border:1px solid rgba(106,27,154,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-crown"></i> Maestría: ${activeMastery.label}</span>`;
                    
                    if (activeMastery.id === "nick" && !isNickAttack) {
                        const otherLightWeapon = item.actor?.itemTypes?.weapon?.find(w => 
                            w.id !== item.id && w.system.equipped && w.system.properties?.has("lgt")
                        );
                        if (otherLightWeapon) {
                            isNickActive = true;
                            nickWeaponName = otherLightWeapon.name;
                            nickWeaponItem = otherLightWeapon;
                        }
                    }
                }

                const hasSapEffect = item.actor?.effects?.some(e => 
                    (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                    (e.name.toLowerCase().includes("sap") || e.name.toLowerCase().includes("debilitar") || e.name.toLowerCase().includes("vax"))
                );
                
                let sapBadge = hasSapEffect ? `<span style="display:inline-block; font-size:0.75em; background:rgba(197,34,31,0.15); color:#ff5252; padding:3px 8px; border-radius:12px; border:1px solid rgba(197,34,31,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-arrow-down"></i> Desventaja (Debilitado)</span>` : "";

                const targetsLocal = Array.from(game.user.targets);
                const attackerName = item.actor.name;
                const hasVexAdvantage = targetsLocal.some(t => 
                    t.actor?.effects?.some(e => 
                        (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                        (e.name.toLowerCase().includes("vex") || e.name.toLowerCase().includes("molestar")) &&
                        e.name.includes(`(${attackerName})`)
                    )
                );

                let vexBadge = hasVexAdvantage ? `<span style="display:inline-block; font-size:0.75em; background:rgba(19,115,51,0.15); color:#4caf50; padding:3px 8px; border-radius:12px; border:1px solid rgba(19,115,51,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-arrow-up"></i> Ventaja (Molestar)</span>` : "";

                const hasGuidingBoltAdvantage = targetsLocal.some(t =>
                    t.actor?.effects?.some(e => {
                        const eName = (e.name || "").toLowerCase();
                        return eName.includes("saeta guía") || eName.includes("saeta guia") || eName.includes("guiding bolt");
                    })
                );

                let guidingBoltBadge = hasGuidingBoltAdvantage ? `<span style="display:inline-block; font-size:0.75em; background:rgba(176,96,0,0.15); color:#ffb300; padding:3px 8px; border-radius:12px; border:1px solid rgba(176,96,0,0.3); margin-right:4px; font-weight:bold;"><i class="fas fa-star"></i> Ventaja (Saeta Guía)</span>` : "";

                // --- Simultaneous Attack Roll ---
                let attackRollHtml = "";
                let attackRollBoxStyle = "";
                if (game.settings.get("not-dice", "enableSimultaneousRoll")) {
                    try {
                        let mod = 0;
                        if (toHit) {
                            const clean = toHit.replace(/[^\d-]/g, "");
                            if (clean) mod = parseInt(clean);
                        }

                        const keyAdvantage = rollConfig.event && rollConfig.event.shiftKey;
                        const keyDisadvantage = rollConfig.event && rollConfig.event.ctrlKey;
                        const effectAdvantage = hasVexAdvantage || hasGuidingBoltAdvantage;
                        const effectDisadvantage = hasSapEffect;

                        const totalAdvantage = keyAdvantage || effectAdvantage;
                        const totalDisadvantage = keyDisadvantage || effectDisadvantage;

                        let isAdvantage = false;
                        let isDisadvantage = false;
                        if (totalAdvantage && !totalDisadvantage) isAdvantage = true;
                        else if (totalDisadvantage && !totalAdvantage) isDisadvantage = true;

                        let formula = `1d20 + ${mod}`;
                        if (isAdvantage) formula = `2d20kh + ${mod}`;
                        else if (isDisadvantage) formula = `2d20kl + ${mod}`;
                        
                        const r = await new Roll(formula).evaluate();
                        
                        if (game.dice3d) {
                            game.dice3d.showForRoll(r, game.user, true);
                        } else if (game.settings.get("not-dice", "enableSound")) {
                            AudioHelper.play({src: "sounds/dice.wav"}); 
                        }

                        const d20 = r.terms[0].total; 
                        const total = r.total;

                        const targetAC = targets.length > 0 ? (targets[0].actor?.system?.attributes?.ac?.value ?? null) : null;
                        let rollBoxBg, rollBoxBorder, rollTextColor;
                        
                        if (d20 === 1) { rollBoxBg = "rgba(197,34,31,0.1)"; rollBoxBorder = "rgba(197,34,31,0.4)"; rollTextColor = "#ff5252"; }
                        else if (d20 === 20) { rollBoxBg = "rgba(19,115,51,0.1)"; rollBoxBorder = "rgba(19,115,51,0.4)"; rollTextColor = "#4caf50"; }
                        else if (targetAC !== null && total >= targetAC) { rollBoxBg = "rgba(19,115,51,0.1)"; rollBoxBorder = "rgba(19,115,51,0.4)"; rollTextColor = "#4caf50"; }
                        else if (targetAC !== null && total < targetAC) { rollBoxBg = "rgba(197,34,31,0.1)"; rollBoxBorder = "rgba(197,34,31,0.4)"; rollTextColor = "#ff5252"; }
                        else { rollBoxBg = "rgba(127,127,127,0.1)"; rollBoxBorder = "var(--color-border-light-2, #ddd)"; rollTextColor = "inherit"; }
                        
                        let advLabel = "";
                        if (isAdvantage) advLabel = "<span style='color:#4fc3f7; font-size:0.85em; font-weight:bold; margin-right:6px;'><i class='fas fa-arrow-up'></i> Ventaja</span>";
                        else if (isDisadvantage) advLabel = "<span style='color:#ff5252; font-size:0.85em; font-weight:bold; margin-right:6px;'><i class='fas fa-arrow-down'></i> Desventaja</span>";

                        attackRollHtml = `<div style="font-size: 1.1em; line-height:1.2;">
                            ${advLabel}<span style="color:inherit; opacity:0.7;">d20:</span> <span style="font-weight:bold;">${d20}</span> + ${mod} = <span style="font-size: 1.4em; font-weight:900;">${total}</span>
                        </div>`;
                        attackRollBoxStyle = `margin-bottom: 12px; color: ${rollTextColor}; text-align: center; border: 1px solid ${rollBoxBorder}; background: ${rollBoxBg}; border-radius: 6px; padding: 8px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.05);`;
                    } catch (err) {
                        console.error("Not Dice | Failed simultaneous roll", err);
                    }
                }

                const attackImg = item.img || "icons/svg/sword.svg";

                attackHtml = `
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:10px; border:1px solid var(--color-border-light-2, #ddd); border-radius:6px; background:rgba(127,127,127,0.1); box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <img src="${attackImg}" style="width:48px; height:48px; border:1px solid var(--color-border-light-2, #aaa); border-radius:6px; object-fit:cover; flex-shrink:0;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:1em; margin-bottom:4px; color:inherit; opacity:0.8;">Ataque: <span style="font-weight:900; font-size:1.4em; color:inherit; opacity:1;">${toHit}</span></div>
                        <div style="display:flex; flex-wrap:wrap; gap:4px;">
                            ${profBadge} ${masteryBadge} ${sapBadge} ${vexBadge} ${guidingBoltBadge}
                        </div>
                    </div>
                </div>`;
                
                if (attackRollHtml) {
                    attackHtml += `<div style="${attackRollBoxStyle}">${attackRollHtml}</div>`;
                }
            }

            const confirmMellar = async (weaponName) => {
                return new Promise(resolve => {
                    const DialogV2 = foundry?.applications?.api?.DialogV2;
                    if (DialogV2) {
                        new DialogV2({
                            window: { title: "Maestría: Mellar" },
                            content: `<p style="padding:10px;">¿Atacar con Mellar: <strong>${weaponName}</strong>?</p>`,
                            buttons: [
                                { action: "yes", label: "Sí", default: true },
                                { action: "no", label: "No" }
                            ],
                            submit: result => resolve(result === "yes")
                        }).render(true);
                    } else {
                        new Dialog({
                            title: "Maestría: Mellar",
                            content: `<p>¿Atacar con Mellar: <strong>${weaponName}</strong>?</p>`,
                            buttons: {
                                yes: { label: "Si", callback: () => resolve(true) },
                                no: { label: "No", callback: () => resolve(false) }
                            },
                            default: "yes",
                            close: () => resolve(false)
                        }).render(true);
                    }
                });
            };

            // --- Build Logic For Multiple Damage Parts ---

            const damageStyle = {
                 acid: { color: "#aeea00", icon: "🧪" },
                 bludgeoning: { color: "inherit", icon: "🔨" },
                 cold: { color: "#4fc3f7", icon: "❄️" },
                 fire: { color: "#ff5252", icon: "🔥" },
                 force: { color: "#e040fb", icon: "✨" }, 
                 lightning: { color: "#ffd600", icon: "⚡" },
                 necrotic: { color: "#b0bec5", icon: "💀" },
                 piercing: { color: "inherit", icon: "🏹" },
                 poison: { color: "#69f0ae", icon: "🤢" },
                 psychic: { color: "#ff4081", icon: "🧠" },
                 radiant: { color: "#ffca28", icon: "☀️" },
                 slashing: { color: "inherit", icon: "⚔️" },
                 thunder: { color: "#7c4dff", icon: "🔊" },
                 healing: { color: "#69f0ae", icon: "💚" },
                 temphp: { color: "inherit", icon: "🛡️" }
            };

            let damageInputsHtml = "";
            for (const part of damageParts) {
                let labelHtml = part.label;
                let currentDamageType = part.type;
                
                if (part.availableTypes && part.availableTypes.length > 1) {
                    let optionsHtml = part.availableTypes.map(t => {
                        const c = CONFIG.DND5E.damageTypes[t];
                        const l = c ? (c.label || t) : t;
                        const selected = t === part.type ? "selected" : "";
                        const style = damageStyle[t] || { color: "inherit", icon: "" };
                        return `<option value="${t}" style="color: ${style.color}; font-weight: bold;" ${selected}>${style.icon} ${l}</option>`;
                    }).join("");
                    
                    const initialStyle = damageStyle[currentDamageType] || { color: "inherit" };
                    labelHtml = `<select name="type-${part.index}" style="width: 100%; border: 1px solid transparent; font-weight: bold; background: transparent; color: ${initialStyle.color}; font-size:1.05em; cursor:pointer;">${optionsHtml}</select>`;
                } else {
                     if (part.type) {
                         const style = damageStyle[part.type] || { color: "inherit", icon: "" };
                         const hiddenInput = `<input type="hidden" name="type-${part.index}" value="${part.type}">`; 
                         let content = part.label;
                         if (!content.includes("<img") && style.icon) content = `${style.icon} ${content}`;
                         labelHtml = `<span style="color: ${style.color}; font-weight: bold; font-size:1.05em;">${content}</span>${hiddenInput}`;
                     }
                }

                damageInputsHtml += `
                <div class="damage-part-container" data-index="${part.index}" style="margin-bottom: 12px; padding: 12px; border: 1px solid var(--color-border-light-2, #ddd); border-radius: 6px; background: rgba(127,127,127,0.1); box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                    <div style="margin-bottom: 8px; border-bottom: 1px solid var(--color-border-light-2, #ddd); padding-bottom: 4px;">${labelHtml}</div>
                    
                    <div style="display:flex; gap:10px; margin-bottom: 8px;">
                        <div style="flex:1;">
                            <label style="font-size:0.85em; color:inherit; opacity:0.7;">Fórmula:</label>
                            <input type="text" value="${part.formula}" readonly style="width: 100%; padding:4px 6px; border:1px solid var(--color-border-light-2, #ccc); border-radius:4px; background:rgba(128,128,128,0.1); color:inherit; font-family:monospace; font-size:1.1em; ${part.isOffhandWithoutStyle ? 'border-color:#ff5252; background-color:rgba(197,34,31,0.1);' : ''}"/>
                            ${part.isOffhandWithoutStyle ? '<div style="font-size: 0.75em; color: #ff5252; margin-top: 2px;">* Sin mod. de característica</div>' : ''}
                        </div>
                        ${part.versatileFormula ? `
                        <div style="flex:1;">
                            <label style="font-size:0.85em; color:inherit; opacity:0.7;">Versátil (2M):</label>
                            <input type="text" value="${part.versatileFormula}" readonly style="width: 100%; padding:4px 6px; border:1px solid var(--color-border-light-2, #ccc); border-radius:4px; background:rgba(128,128,128,0.1); color:inherit; font-family:monospace; font-size:1.1em;"/>
                        </div>` : ""}
                    </div>
                    
                    <div style="display:flex; gap:10px; align-items:flex-end;">
                        <div style="flex:1;">
                            <label style="font-size:0.85em; color:inherit; opacity:0.7;">Total Daño:</label>
                            <input type="number" name="total-${part.index}" value="0" style="width: 100%; height: 38px; font-size:1.6em; font-weight:bold; text-align:center; padding:4px; border:1px solid var(--color-border-light-2, #aaa); border-radius:4px; color:#ff5252; background:rgba(128,128,128,0.1);"/>
                        </div>
                        <div style="display:flex; gap:4px; padding-bottom:1px;">
                            <button type="button" class="roll-damage-btn" data-index="${part.index}" style="width:38px; height:38px; border:1px solid var(--color-border-light-2, #bbb); border-radius:4px; background:var(--color-bg-option, rgba(127,127,127,0.1)); color:inherit; cursor:pointer;" title="Tirar Daño Normal"><i class="fas fa-dice" style="color:inherit; opacity:0.8;"></i></button>
                            <button type="button" class="roll-damage-crit-btn" data-index="${part.index}" style="width:38px; height:38px; border:1px solid #d32f2f; border-radius:4px; background:rgba(197,34,31,0.1); color:#ff5252; cursor:pointer;" title="Tirar Daño Crítico"><i class="fas fa-dice-d20"></i></button>
                        </div>
                    </div>
                </div>`;
            }

            const dialogContent = `
                <div style="font-family:inherit; padding:4px 2px;">
                    ${attackHtml}
                    ${targetHtml}
                    <h3 style="border-bottom: 1px solid var(--color-border-light-2, #ccc); padding-bottom: 4px; margin-bottom: 10px; font-size:1.1em; color:inherit; opacity:0.9;">Desglose de Daño</h3>
                    <div style="max-height: 380px; overflow-y: auto; padding-right: 6px;">
                        ${damageInputsHtml}
                    </div>
                </div>
            `;

            const applyAndResolve = async (container, isDamage = false) => {
                const root = container instanceof HTMLElement ? container : container[0];

                // --- Consume Mastery Effects (Sap/Vex) ---
                const sapEffect = item.actor?.effects?.find(e => 
                    (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                    (e.name.toLowerCase().includes("sap") || e.name.toLowerCase().includes("debilitar") || e.name.toLowerCase().includes("vax"))
                );
                if (sapEffect) {
                    await item.actor.deleteEmbeddedDocuments("ActiveEffect", [sapEffect.id]);
                }

                const currentTargets = resolveTargets();
                if (currentTargets.length > 0) {
                     const attackerName = item.actor.name;
                     for (const t of currentTargets) {
                        if (!t.actor) continue;
                        const vexEffect = t.actor.effects?.find(e => 
                            (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                            (e.name.toLowerCase().includes("vex") || e.name.toLowerCase().includes("molestar")) &&
                            e.name.includes(`(${attackerName})`)
                        );
                        if (vexEffect) {
                            await t.actor.deleteEmbeddedDocuments("ActiveEffect", [vexEffect.id]);
                            ui.notifications.info(`Not Dice | Ventaja Consumida: ${vexEffect.name}`);
                        }

                        const guidingBoltEffect = t.actor.effects?.find(e => {
                            const eName = (e.name || "").toLowerCase();
                            return eName.includes("saeta guía") || eName.includes("saeta guia") || eName.includes("guiding bolt");
                        });
                        if (guidingBoltEffect) {
                            await t.actor.deleteEmbeddedDocuments("ActiveEffect", [guidingBoltEffect.id]);
                            ui.notifications.info(`Not Dice | Ventaja Consumida: ${guidingBoltEffect.name}`);
                        }
                     }
                }

                // Nick / Mellar Logic
                if (isDamage && isNickActive) {
                    const confirmed = await confirmMellar(nickWeaponName);
                    if (confirmed && nickWeaponItem) {
                        const attackActivity = nickWeaponItem.system.activities?.find(a => a.type === "attack");
                        if (attackActivity) {
                            setTimeout(() => attackActivity.rollAttack({event: rollConfig.event, isNickAttack: true}), 500);
                        }
                    }
                }

                // Gather values and update rolls
                const totalValues = [];
                for (const part of damageParts) {
                    const inputVal = root.querySelector(`[name='total-${part.index}']`)?.value || "0";
                    let val = parseInt(inputVal);
                    if (isNaN(val)) val = 0;

                    let selectedType = root.querySelector(`[name='type-${part.index}']`)?.value;
                    if (!selectedType) selectedType = part.type;
                    
                    const roll = part.roll;
                    roll._total = val;
                    roll._evaluated = true;
                    roll.options.type = selectedType;

                    const options = roll.terms[0]?.options ?? {};
                    const newTerm = new foundry.dice.terms.NumericTerm({number: val, options: options});
                    newTerm._evaluated = true;
                    roll.terms = [newTerm];
                    
                    totalValues.push({ value: val, type: selectedType });
                }

                // Apply Damage
                if (isDamage) {
                    const targetsLocal = resolveTargets();

                    if (activeMastery && activeMastery.id !== "nick") {
                        for (const t of targetsLocal) {
                             if (t.actor) {
                                 const effectData = {
                                    name: `Maestría: ${activeMastery.label} (${item.actor.name})`,
                                    icon: item.img || "icons/svg/aura.svg",
                                    origin: item.uuid,
                                    duration: { rounds: 1 }
                                 };

                                 if (activeMastery.id === "vex" || activeMastery.label.toLowerCase().includes("molestar")) {
                                     effectData.duration.turns = 1;
                                 }

                                 if (activeMastery.id === "slow" || activeMastery.label.toLowerCase().includes("ralentizar")) {
                                     effectData.changes = [
                                         { key: "system.attributes.movement.walk", mode: 2, value: "-10" },
                                         { key: "system.attributes.movement.fly", mode: 2, value: "-10" },
                                         { key: "system.attributes.movement.swim", mode: 2, value: "-10" },
                                         { key: "system.attributes.movement.climb", mode: 2, value: "-10" },
                                         { key: "system.attributes.movement.burrow", mode: 2, value: "-10" }
                                     ];
                                 }

                                 if (game.combat) {
                                    effectData.duration.startRound = game.combat.round;
                                    effectData.duration.startTurn = game.combat.turn;
                                 } else {
                                    effectData.duration.startTime = game.time.worldTime;
                                 }

                                 await t.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
                                 ui.notifications.info(`Not Dice | Maestría Aplicada: ${activeMastery.label} -> ${t.name}`);
                             }
                        }
                    }

                    if (isGuidingBolt) {
                        for (const t of targetsLocal) {
                            if (t.actor) {
                                const gbEffectData = {
                                    name: `Saeta Guía (${item.actor.name})`,
                                    icon: item.img || "icons/svg/sun.svg",
                                    origin: item.uuid,
                                    duration: { rounds: 1 }
                                };
                                if (game.combat) {
                                    gbEffectData.duration.startRound = game.combat.round;
                                    gbEffectData.duration.startTurn = game.combat.turn;
                                } else {
                                    gbEffectData.duration.startTime = game.time.worldTime;
                                }
                                await t.actor.createEmbeddedDocuments("ActiveEffect", [gbEffectData]);
                            }
                        }
                    }

                    for (const t of targetsLocal) {
                        if (t.actor) {
                            const targetMultRaw = root.querySelector(`[name='target-multiplier-${t.id}']`)?.value || "1";
                            let targetMult = parseFloat(targetMultRaw);
                            if (isNaN(targetMult)) targetMult = 1;

                            const hasHeavyArmorMaster = t.actor.items?.some(i => {
                                const n = (i.name || "").toLowerCase();
                                return i.type === "feat" && (n.includes("heavy armor master") || n.includes("maestro en armadura pesada"));
                            });

                            let finalValues = isDamage ? totalValues.map(tv => ({ ...tv, value: Math.floor(tv.value * targetMult) })) : totalValues;

                            if (hasHeavyArmorMaster) {
                                const attackerProf = actor?.system?.attributes?.prof ?? 3;
                                const physicalTypes = new Set(["bludgeoning", "piercing", "slashing"]);
                                finalValues = totalValues.map(tv => {
                                    if (physicalTypes.has(tv.type) && tv.value > 0) {
                                        const reduced = Math.max(0, tv.value - attackerProf);
                                        ui.notifications.info(`Not Dice | Armadura Pesada: -${attackerProf} daño (${tv.type}) en ${t.name}`);
                                        return { ...tv, value: reduced };
                                    }
                                    return tv;
                                });
                            }

                            await t.actor.applyDamage(finalValues, { ignore: true });
                        }
                    }

                    // --- Topple / Derribar Mastery ---
                    const isTopple = activeMastery && (
                        activeMastery.id === "topple" || activeMastery.label.toLowerCase().includes("topple") || activeMastery.label.toLowerCase().includes("derribar")
                    );
                    if (isTopple) {
                        const attackerProf = actor?.system?.attributes?.prof ?? 0;
                        const strMod = actor?.system?.abilities?.str?.mod ?? 0;
                        const dexMod = actor?.system?.abilities?.dex?.mod ?? 0;
                        const attackMod = Math.max(strMod, dexMod);
                        const toppleDC = 8 + attackerProf + attackMod;

                        for (const t of targetsLocal) {
                            if (!t.actor) continue;
                            const conSaveRaw = t.actor.system?.abilities?.con?.save;
                            const conSave = typeof conSaveRaw === "number" ? conSaveRaw : (t.actor.system?.abilities?.con?.mod ?? 0);
                            const conSaveLabel = conSave >= 0 ? `+${conSave}` : `${conSave}`;

                            await new Promise(resolveTopple => {
                                const DialogV2 = foundry?.applications?.api?.DialogV2;
                                const toppleContent = `
                                    <div style="text-align: center; padding: 10px; font-family:inherit;">
                                        <div style="font-size:1.1em; margin-bottom:8px; color:inherit;"><strong>${t.name}</strong> debe superar una</div>
                                        <div style="font-size: 1.3em; font-weight: bold; background:rgba(197,34,31,0.1); color:#ff5252; padding:6px; border-radius:6px; border:1px solid rgba(197,34,31,0.4); margin-bottom:10px;">Salvación de Constitución</div>
                                        <div style="font-size: 1.2em; margin-bottom:10px; color:inherit;">CD: <span style="font-size: 1.4em; font-weight: 900; color: #ff5252;">${toppleDC}</span></div>
                                        <div style="font-size: 0.9em; color:inherit; opacity:0.8;">Bono CON: <strong>${conSaveLabel}</strong></div>
                                    </div>`;

                                if (DialogV2) {
                                    new DialogV2({
                                        window: { title: `Maestría: Derribar — ${t.name}` },
                                        content: toppleContent,
                                        position: { width: 320 },
                                        buttons: [
                                            { action: "prone", label: "Derribado", icon: "fa-solid fa-person-falling" },
                                            { action: "pass", label: "Pasa", icon: "fa-solid fa-check", default: true }
                                        ],
                                        submit: async result => {
                                            if (result === "prone") {
                                                await t.actor.toggleStatusEffect("prone", { active: true });
                                                ui.notifications.info(`Not Dice | Derribar: ${t.name} está Derribado.`);
                                            }
                                            resolveTopple();
                                        }
                                    }).render(true);
                                } else {
                                    new Dialog({
                                        title: `Maestría: Derribar — ${t.name}`,
                                        content: toppleContent,
                                        buttons: {
                                            prone: { label: "<i class='fas fa-person-falling'></i> Derribado", callback: async () => {
                                                await t.actor.toggleStatusEffect("prone", { active: true });
                                                ui.notifications.info(`Not Dice | Derribar: ${t.name} está Derribado.`);
                                                resolveTopple();
                                            }},
                                            pass: { label: "<i class='fas fa-check'></i> Paso", callback: () => resolveTopple() }
                                        },
                                        default: "pass",
                                        close: () => resolveTopple()
                                    }, { width: 320 }).render(true);
                                }
                            });
                        }
                    }
                }
                return { total: totalValues.reduce((acc, curr) => acc + curr.value, 0) };
            };

            const notDiceVersion = game.modules.get("not-dice")?.version || "";
            
            // --- Handlers for interactive UI ---
            const onRenderComplete = (element) => {
                const root = element instanceof HTMLElement ? element : element[0];

                root.querySelectorAll("select[name^='type-']").forEach(select => {
                    select.addEventListener("change", (ev) => {
                        const newType = ev.currentTarget.value;
                        const currentTypes = Array.from(root.querySelectorAll("select[name^='type-'], input[type='hidden'][name^='type-']")).map(el => el.value);
                        
                        targets.forEach(t => {
                            let baseMult = passedMultipliers[t.id] !== undefined ? passedMultipliers[t.id] : 1;
                            let detectedMultiplier = 1;
                            const traits = t.actor?.system?.traits;
                            if (traits) {
                                for (const dt of currentTypes) {
                                    if (traits.di?.value?.has(dt)) detectedMultiplier = 0;
                                    else if (traits.dv?.value?.has(dt) && detectedMultiplier !== 0) detectedMultiplier = 2;
                                    else if (traits.dr?.value?.has(dt) && detectedMultiplier !== 2 && detectedMultiplier !== 0) detectedMultiplier = 0.5;
                                }
                            }
                            detectedMultiplier = detectedMultiplier * baseMult;
                            const targetSelect = root.querySelector(`select[name='target-multiplier-${t.id}']`);
                            if (targetSelect) targetSelect.value = detectedMultiplier;
                        });
                        
                        const style = damageStyle[newType] || { color: "inherit" };
                        ev.currentTarget.style.color = style.color;
                    });
                });

                const doubleDice = (formula) => {
                    return formula.replace(/(\d+)d(\d+)/g, (match, num, sides) => {
                        return `${parseInt(num) * 2}d${sides}`;
                    });
                };

                root.querySelectorAll(".roll-damage-btn").forEach(btn => {
                    btn.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        const idx = btn.dataset.index;
                        const formula = damageParts.find(p => p.index == idx)?.formula;
                        if (formula) {
                            try {
                                const r = await new Roll(formula).evaluate();
                                if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);
                                else if (game.settings.get("not-dice", "enableSound")) AudioHelper.play({src: "sounds/dice.wav"});
                                
                                const inputTotal = root.querySelector(`[name='total-${idx}']`);
                                if (inputTotal) inputTotal.value = r.total;
                            } catch (err) { console.error("Not Dice | Error rolling normal damage", err); }
                        }
                    });
                });

                root.querySelectorAll(".roll-damage-crit-btn").forEach(btn => {
                    btn.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        const idx = btn.dataset.index;
                        const formula = damageParts.find(p => p.index == idx)?.formula;
                        if (formula) {
                            try {
                                const critFormula = doubleDice(formula);
                                const r = await new Roll(critFormula).evaluate();
                                if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);
                                else if (game.settings.get("not-dice", "enableSound")) AudioHelper.play({src: "sounds/dice.wav"});
                                
                                const inputTotal = root.querySelector(`[name='total-${idx}']`);
                                if (inputTotal) inputTotal.value = r.total;
                            } catch (err) { console.error("Not Dice | Error rolling crit damage", err); }
                        }
                    });
                });
            };

            const result = await new Promise(resolve => {
                const DialogV2 = foundry?.applications?.api?.DialogV2;
                if (DialogV2) {
                    const app = new DialogV2({
                        window: { title: `Resolución: ${item.name} (v${notDiceVersion})` },
                        content: dialogContent,
                        position: { width: 440 },
                        buttons: [
                            { action: "damage", icon: "fa-solid fa-skull", label: "Aplicar Daño", default: true },
                            { action: "ok", icon: "fa-solid fa-check", label: "Confirmar sin Aplicar" }
                        ],
                        submit: async (res) => {
                            const container = app.element;
                            if (res === "damage") await applyAndResolve(container, true);
                            else if (res === "ok") await applyAndResolve(container, false);
                            resolve(rolls);
                        }
                    });
                    app.render(true).then(() => onRenderComplete(app.element));
                } else {
                    new Dialog({
                        title: `Resolución: ${item.name} (v${notDiceVersion})`,
                        content: dialogContent,
                        buttons: {
                            damage: {
                                label: "Aplicar Daño",
                                icon: "<i class='fas fa-skull'></i>",
                                callback: async html => {
                                    await applyAndResolve(html, true);
                                    resolve(rolls); 
                                }
                            },
                            ok: {
                                label: "Confirmar",
                                icon: "<i class='fas fa-check'></i>",
                                callback: async html => {
                                    await applyAndResolve(html, false);
                                    resolve(rolls);
                                }
                            }
                        },
                        default: "damage",
                        render: (html) => onRenderComplete(html),
                        close: () => resolve(rolls)
                    }, { width: 440 }).render(true);
                }
            });

            for (const r of rolls) {
                if (!r._evaluated) {
                     r._total = 0;
                     r._evaluated = true;
                     r.terms = [new foundry.dice.terms.NumericTerm({number: 0, options: {}})];
                }
            }
            return rolls;
        };

        DamageRoll.buildConfigure = async function(config, dialog, message) {
           console.log("Not Dice | Damage buildConfigure intercepted", config);
           dialog = foundry.utils.mergeObject(dialog ?? {}, { configure: false });
           return originalDamageBuildConfigure.call(this, config, dialog, message);
        };

        DamageRoll.buildEvaluate = async function(rolls, rollConfig, messageConfig) {
            if (!game.user.isGM) return [];
            return notDiceEvaluateDamageRoll(rolls, rollConfig, messageConfig);
        };
    }

    /* ------------------------------------------------------------------ */
    /* Concentration Check on Damage Logic                                */
    /* ------------------------------------------------------------------ */
    Hooks.on("preUpdateActor", (actor, updateData, options, userId) => {
        if (game.user.id !== userId && !game.user.isGM && !actor.isOwner) return;

        const hpUpdate = updateData.system?.attributes?.hp;
        if (!hpUpdate) return;
        
        const oldHP = actor.system.attributes.hp.value;
        const oldTemp = actor.system.attributes.hp.temp || 0;
        const newHP = (hpUpdate.value !== undefined) ? hpUpdate.value : oldHP;
        const newTemp = (hpUpdate.temp !== undefined) ? hpUpdate.temp : oldTemp;

        const totalOld = oldHP + oldTemp;
        const totalNew = newHP + newTemp;
        const damage = totalOld - totalNew;
        
        if (damage > 0) {
            const isConcentrating = actor.statuses?.has("concentrating") || 
                                    actor.effects.some(e => e.getFlag("core", "statusId") === "concentrating" || e.name === "Concentrating");

            if (isConcentrating) {
                const dc = Math.max(10, Math.floor(damage / 2));
                let bonus = 0;
                
                const con = actor.system?.abilities?.con;
                if (con) {
                    if (typeof con.save === "number") bonus = con.save;
                    else if (typeof con.mod === "number") {
                         bonus = con.mod;
                         if (con.proficient) bonus += (actor.system.attributes?.prof || 0);
                    }
                }

                const operator = bonus >= 0 ? "+" : "";
                const content = `
                    <div style="text-align: center; font-family:inherit; padding:10px;">
                        <div style="font-size:1.1em; margin-bottom:8px; color:inherit;"><strong>${actor.name}</strong> recibió <span style="color:#ff5252; font-weight:bold;">${damage}</span> de daño.</div>
                        <div style="font-size:0.9em; color:inherit; opacity:0.8; font-style:italic; margin-bottom:12px;">Está concentrado en un hechizo.</div>
                        <div style="font-size: 1.2em; font-weight: bold; background:rgba(197,34,31,0.1); color:#ff5252; padding:6px; border-radius:6px; border:1px solid rgba(197,34,31,0.4); margin-bottom:10px;">Salvación de Constitución</div>
                        <div style="font-size: 1.2em; margin-bottom:10px; color:inherit;">CD: <span style="font-size: 1.5em; font-weight: 900; color: #ff5252;">${dc}</span></div>
                        <div style="font-size: 0.9em; color:inherit; opacity:0.8;">Bonificador CON: <strong>${operator}${bonus}</strong></div>
                    </div>
                `;

                const DialogV2 = foundry?.applications?.api?.DialogV2;
                if (DialogV2) {
                    new DialogV2({
                        window: { title: "Concentración: Chequeo Requerido" },
                        content: content,
                        position: { width: 340 },
                        buttons: [{ action: "ok", label: "Entendido", icon: "fa-solid fa-check", default: true }]
                    }).render(true);
                } else {
                    new Dialog({
                        title: "Concentración: Chequeo Requerido",
                        content: content,
                        buttons: { ok: { label: "<i class='fas fa-check'></i> Entendido", callback: () => {} } },
                        default: "ok"
                    }, { width: 340 }).render(true);
                }
            }
        }
    });
});