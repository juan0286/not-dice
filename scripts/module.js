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

Hooks.once("ready", () => {
  // Escucha de socket para que un jugador envíe el popup de ataque al/los GM.
  if (!globalThis._notDiceSocketReady) {
      globalThis._notDiceSocketReady = true;
      game.socket.on("module.not-dice", async (data) => {
          if (!data || data.type !== "not-dice.show-attack-dialog") return;
          if (!game.user.isGM) return;

          try {
              const item = data.itemUuid ? await fromUuid(data.itemUuid) : null;
              const actor = item?.actor ?? null;
              if (!item || !actor) {
                  ui.notifications?.warn("No se pudo recuperar el objeto del ataque para mostrar el popup.");
                  return;
              }

              const reconstructedRolls = await Promise.all((data.rolls || []).map(r => Roll.fromData(r)));

              const subject = {
                  item,
                  actor,
                  type: "attack",
                  damage: { parts: item.system?.damage?.parts || [] }
              };

              const rollConfig = {
                  subject,
                  isNickAttack: data.isNickAttack ?? false,
                  event: null
              };

              const messageConfig = data.messageConfig || {};

              await CONFIG.Dice.DamageRoll.buildEvaluate(reconstructedRolls, rollConfig, messageConfig);
              ui.notifications?.info(`Popup de ataque recibido de ${data.senderName || "jugador"}.`);
          } catch (err) {
              console.error("Not Dice | Error al manejar popup de ataque via socket", err);
          }
      });
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
      const isAttack = rollConfig.subject && 
                       (rollConfig.subject.type === "attack" || 
                        rollConfig.subject.constructor.name === "AttackActivity");

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

    DamageRoll.buildConfigure = async function(config, dialog, message) {
       console.log("Not Dice | Damage buildConfigure intercepted", config);
       dialog = foundry.utils.mergeObject(dialog ?? {}, { configure: false });
       return originalDamageBuildConfigure.call(this, config, dialog, message);
    };

    DamageRoll.buildEvaluate = async function(rolls, rollConfig, messageConfig) {
        console.log("Not Dice | Damage buildEvaluate intercepted", rolls);
        
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
        
        let defaultMultiplier = 1; // Default to Normal

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

            // Ensure current type is in available types
            if (damageTypeKey) {
                if(!availableTypes.includes(damageTypeKey)) availableTypes.push(damageTypeKey);
                allDamageTypes.add(damageTypeKey);
            }
            if (availableTypes.length > 0) {
                 availableTypes.forEach(t => allDamageTypes.add(t));
            }

            const damageConfig = damageTypeKey ? CONFIG.DND5E.damageTypes[damageTypeKey] : null;
            let damageTypeLabel = damageConfig?.label || damageTypeKey || "None";
            
            // Add icon if available
            if (damageConfig?.icon) {
                damageTypeLabel = `<img src="${damageConfig.icon}" style="width: 18px; height: 18px; vertical-align: text-bottom; margin-right: 4px; border: none;" /> ${damageTypeLabel}`;
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
            
        // --- Gather Target Info (Combined) ---
        const targets = Array.from(game.user.targets);
        let targetHtml = "";
        
        if (targets.length > 0) {
            targetHtml += "<div style='margin-bottom: 10px;'><strong>Objetivo:</strong><div style='display: flex; flex-wrap: wrap;'>";
            for (const t of targets) {
                const traits = t.actor?.system?.traits;
                if (!traits) continue;
                
                let isResistant = false;
                let isImmune = false;
                let isVulnerable = false;

                // Check against ALL damage types involved
                for (const dt of allDamageTypes) {
                    if (traits.dr?.value?.has(dt)) isResistant = true;
                    if (traits.di?.value?.has(dt)) isImmune = true;
                    if (traits.dv?.value?.has(dt)) isVulnerable = true;
                }
                
                // Keep track of highest priority trait for default multiplier
                // (Logica eliminada para evitar doble aplicacion de daño por el sistema)

                const getLabels = (set) => {
                    if (!set) return "";
                    return Array.from(set).map(k => CONFIG.DND5E.damageTypes[k]?.label || k).join(", ");
                };
                
                const dr = getLabels(traits.dr?.value);
                const di = getLabels(traits.di?.value);
                const dv = getLabels(traits.dv?.value);
                const ac = t.actor?.system?.attributes?.ac?.value;
                
                let borderStyle = "border: 1px solid #7a7971;";
                if (isImmune) borderStyle = "border: 2px solid #c00000;";
                else if (isVulnerable) borderStyle = "border: 2px solid #007a00;";
                else if (isResistant) borderStyle = "border: 2px solid #a85d00;";

                targetHtml += `<div style="width: 100%; margin-bottom: 8px; font-size: 1.5em; color: #222; ${borderStyle} background: rgba(0,0,0,0.05); border-radius: 4px; padding: 5px;"><strong style='text-align: left;'>${t.name}</strong>${ac !== undefined ? ` <span style='text-align: right;font-size: 1.5em; font-weight: bold; color: #000; margin-left: 5px;' title='Armor Class'>[CA: ${ac}]</span>` : ""}`;
                targetHtml += `</p>`;
                if (dr) targetHtml += `<p><span style='font-size: 1em; color: #a85d00; margin-left: 4px; font-weight: bold;'>[Res: ${dr}]</span></p>`;
                if (di) targetHtml += `<p><span style='font-size: 1em; color: #c00000; margin-left: 4px; font-weight: bold;'>[Imm: ${di}]</span></p>`;
                if (dv) targetHtml += `<p><span style='font-size: 1em; color: #007a00; margin-left: 4px; font-weight: bold;'>[Vul: ${dv}]</span></p>`;
                targetHtml += `</div>`;
            }
            targetHtml += "</div></div>";
        } else {
            targetHtml = "<div style='margin-bottom: 10px; font-style: italic; color: #888;'>No hay objetivo seleccionado</div>";
        }

        // --- Gather Attack Info ---
        let attackHtml = "";
        let isNickActive = false;
        let nickWeaponName = "";
        let nickWeaponItem = null;

        if (rollConfig.subject.type === "attack") {
                const toHit = item.labels?.toHit || "";
                const isProficient = item.system.proficient || false;
                const profBadge = isProficient ? `<div style="margin-top: 4px; font-size: 0.6em; color: #444; text-transform: uppercase; letter-spacing: 1px;"><i class="fas fa-check-circle" style="color: green;"></i> Con Competencia</div>` : `<div style="margin-top: 4px; font-size: 0.6em; color: #888; text-transform: uppercase; letter-spacing: 1px;">Sin Competencia</div>`;

                let masteryBadge = "";
                if (activeMastery) {
                    masteryBadge = `<div style="margin-top: 2px; font-size: 0.6em; color: #5a005a; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;"><i class="fas fa-crown" style="color: purple;"></i> Maestria: ${activeMastery.label}</div>`;
                    
                    if (activeMastery.id === "nick" && !isNickAttack) {
                        const otherLightWeapon = item.actor?.itemTypes?.weapon?.find(w => 
                            w.id !== item.id && 
                            w.system.equipped && 
                            w.system.properties?.has("lgt")
                        );
                        if (otherLightWeapon) {
                            isNickActive = true;
                            nickWeaponName = otherLightWeapon.name;
                            nickWeaponItem = otherLightWeapon;
                        }
                    }
                }

                // Check for "Sap" / "Debilitar" effect on the attacker
                const hasSapEffect = item.actor?.effects?.some(e => 
                    (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                    (e.name.toLowerCase().includes("sap") || e.name.toLowerCase().includes("debilitar") || e.name.toLowerCase().includes("vax"))
                );
                
                let sapBadge = "";
                if (hasSapEffect) {
                    sapBadge = `<div style="margin-top: 5px; font-size: 1.2em; color: #c00; font-weight: 900; border: 2px solid #c00; padding: 2px; border-radius: 4px; background-color: #ffeaea; text-transform: uppercase;">¡Desventaja! (Debilitado)</div>`;
                }

                // Check for "Vex" / "Molestar" effect on ANY target applied by this actor
                const targets = Array.from(game.user.targets);
                const attackerName = item.actor.name;
                const hasVexAdvantage = targets.some(t => 
                    t.actor?.effects?.some(e => 
                        (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                        (e.name.toLowerCase().includes("vex") || e.name.toLowerCase().includes("molestar")) &&
                        e.name.includes(`(${attackerName})`)
                    )
                );

                let vexBadge = "";
                if (hasVexAdvantage) {
                     vexBadge = `<div style="margin-top: 5px; font-size: 1.2em; color: #007a00; font-weight: 900; border: 2px solid #007a00; padding: 2px; border-radius: 4px; background-color: #eaffea; text-transform: uppercase;">¡Ventaja! (Molestar)</div>`;
                }

                // --- Simultaneous Attack Roll ---
                let attackRollHtml = "";
                if (game.settings.get("not-dice", "enableSimultaneousRoll")) {
                    try {
                        let mod = 0;
                        if (toHit) {
                            const clean = toHit.replace(/[^\d-]/g, "");
                            if (clean) mod = parseInt(clean);
                        }

                        const isAdvantage = rollConfig.event && rollConfig.event.shiftKey;
                        const isDisadvantage = rollConfig.event && rollConfig.event.ctrlKey;
                        
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
                        
                        let color = "#333";
                        if (d20 === 20) color = "green";
                        if (d20 === 1) color = "red";
                        
                        let advLabel = "";
                        if (isAdvantage) advLabel = "<span style='color:blue; font-size:0.8em;'>(Ventaja)</span> ";
                        else if (isDisadvantage) advLabel = "<span style='color:red; font-size:0.8em;'>(Desventaja)</span> ";

                        attackRollHtml = `<div style="margin-top: 8px; font-size: 0.9em; border-top: 1px dashed #ccc; padding-top: 5px;">
                            ${advLabel}Tirada: <span style="color:${color}; font-weight:bold;">${d20}</span> (d20) + ${mod} = <span style="font-size: 1.2em; font-weight:bold;">${total}</span>
                        </div>`;
                    } catch (err) {
                        console.error("Not Dice | Failed simultaneous roll", err);
                    }
                }

                attackHtml = `<div style="margin-bottom: 8px; font-size: 1.5em; color: #222; text-align: center; border: 1px solid #7a7971; background: rgba(0,0,0,0.05); border-radius: 4px; padding: 5px;">
                    <strong>Bono de Ataque:</strong> <span style="font-weight: 800; font-size: 1.2em;">${toHit}</span>
                    ${profBadge}
                    ${masteryBadge}
                    ${sapBadge}
                    ${vexBadge}
                    ${attackRollHtml}
                </div>`;
        }

        const confirmMellar = async (weaponName) => {
            return new Promise(resolve => {
                new Dialog({
                    title: "Maestria: Mellar",
                    content: `<p>¿Atacar con Mellar: <strong>${weaponName}</strong>?</p>`,
                    buttons: {
                        yes: { label: "Si", callback: () => resolve(true) },
                        no: { label: "No", callback: () => resolve(false) }
                    },
                    default: "yes",
                    close: () => resolve(false)
                }).render(true);
            });
        };

        // --- Build Logic For Multiple Damage Parts ---
        const multiplierOptions = [
            { val: -1, label: "Curar (-1)" },
            { val: 0, label: "x0" },
            { val: 0.25, label: "x1/4" },
            { val: 0.5, label: "x1/2" },
            { val: 1, label: "x1 (Normal)" },
            { val: 2, label: "x2" }
        ];

        const damageStyle = {
             acid: { color: "#56a700", icon: "🧪" },
             bludgeoning: { color: "#666", icon: "🔨" },
             cold: { color: "#3b82f6", icon: "❄️" },
             fire: { color: "#ef4444", icon: "🔥" },
             force: { color: "#a855f7", icon: "✨" }, 
             lightning: { color: "#eab308", icon: "⚡" },
             necrotic: { color: "#1f2937", icon: "💀" },
             piercing: { color: "#666", icon: "🏹" },
             poison: { color: "#10b981", icon: "🤢" },
             psychic: { color: "#ec4899", icon: "🧠" },
             radiant: { color: "#f59e0b", icon: "☀️" },
             slashing: { color: "#666", icon: "⚔️" },
             thunder: { color: "#6366f1", icon: "🔊" },
             healing: { color: "#10b981", icon: "💚" },
             temphp: { color: "#666", icon: "🛡️" }
        };

        let damageInputsHtml = "";
        for (const part of damageParts) {
            let labelHtml = part.label;
            let currentDamageType = part.type;
            
            // --- Auto-Detect Multiplier for this part ---
            let detectedMultiplier = 1;
            const dt = part.type; 
            if (dt && targets.length > 0) {
                 for (const t of targets) {
                    const traits = t.actor?.system?.traits;
                    if (!traits) continue;
                    
                    if (traits.di?.value?.has(dt)) { detectedMultiplier = 0; break; }
                    if (traits.dv?.value?.has(dt)) detectedMultiplier = 2;
                    else if (traits.dr?.value?.has(dt) && detectedMultiplier !== 2) detectedMultiplier = 0.5;
                 }
            }

            if (part.availableTypes && part.availableTypes.length > 1) {
                let optionsHtml = part.availableTypes.map(t => {
                    const c = CONFIG.DND5E.damageTypes[t];
                    const l = c ? (c.label || t) : t;
                    const selected = t === part.type ? "selected" : "";
                    const style = damageStyle[t] || { color: "#000", icon: "" };
                    return `<option value="${t}" style="color: ${style.color}; font-weight: bold;" ${selected}>${style.icon} ${l}</option>`;
                }).join("");
                
                const initialStyle = damageStyle[currentDamageType] || { color: "#000" };
                labelHtml = `<select name="type-${part.index}" style="width: 100%; border: none; font-weight: bold; background: transparent; color: ${initialStyle.color};">${optionsHtml}</select>`;
            } else {
                 if (part.type) {
                     const style = damageStyle[part.type] || { color: "#000", icon: "" };
                     const hiddenInput = `<input type="hidden" name="type-${part.index}" value="${part.type}">`; 
                     
                     let content = part.label;
                     // If there's no system icon (img tag), prepend our emoji icon
                     if (!content.includes("<img") && style.icon) {
                         content = `${style.icon} ${content}`;
                     }
                     
                     labelHtml = `<span style="color: ${style.color}; font-weight: bold;">${content}</span>${hiddenInput}`;
                 }
            }

            damageInputsHtml += `
            <div class="damage-part-container" data-index="${part.index}" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ccc; border-radius: 5px; background: rgba(0,0,0,0.02);">
                <div style="margin-bottom: 5px; font-weight: bold; border-bottom: 1px solid #eee;">${labelHtml}</div>
                <div class="form-group">
                    <label>Formula:</label>
                    <input type="text" value="${part.formula}" disabled style="margin-bottom: 5px; width: 100%; ${part.isOffhandWithoutStyle ? 'border: 2px solid #e00; background-color: #ffeeee;' : ''}"/>
                    ${part.isOffhandWithoutStyle ? '<div style="font-size: 0.8em; color: #a00; margin-top: -4px; margin-bottom: 5px;">* Sin modificador (No Style)</div>' : ''}
                </div>
                ${part.versatileFormula ? `<div class="form-group"><label>Versatil (2M):</label><input type="text" value="${part.versatileFormula}" disabled style="margin-bottom: 5px; width: 100%;"/></div>` : ""}
                <div class="form-group">
                    <label>Valor:</label>
                    <div style="display: flex; align-items: center; gap: 5px;">
                    <input type="number" name="total-${part.index}" value="0" class="damage-total-display" style="width: 100%; margin-bottom: 0;"/>
                    <button type="button" class="roll-damage-btn" data-index="${part.index}" data-formula="${part.formula}" style="flex: 0 0 40px; height: 32px; border: 1px solid #7a7971; border-radius: 4px; background: #ddd; cursor: pointer; display:flex; align-items:center; justify-content:center;" title="Tirar"><i class="fas fa-dice"></i></button>
                    </div>
                </div>
                <div class="form-group" style="margin-top: 5px;">
                    <label>Multiplicador:</label>
                    <select name="multiplier-${part.index}" style="width: 100%;">
                        ${multiplierOptions.map(o => `<option value="${o.val}" ${o.val === detectedMultiplier ? "selected" : ""}>${o.label}</option>`).join("")}
                    </select>
                </div>
            </div>`;
        }

        const dialogContent = `
            <form>
                <div style="margin-bottom: 10px; padding: 5px; border-bottom: 1px solid #ccc;">
                    ${targetHtml}
                </div>
                <div style="margin-bottom: 10px; padding: 5px; border-bottom: 1px solid #ccc;">
                    ${attackHtml}
                </div>
                <div style="max-height: 400px; overflow-y: auto; padding-right: 5px;">
                    ${damageInputsHtml}
                </div>
            </form>
        `;

        const applyAndResolve = async (html, isDamage = false) => {
            // --- Consume Mastery Effects (Sap/Vex) ---
            // 1. Sap (Attacker)
            const sapEffect = item.actor?.effects?.find(e => 
                (e.name.toLowerCase().includes("maestria") || e.name.toLowerCase().includes("mastery")) &&
                (e.name.toLowerCase().includes("sap") || e.name.toLowerCase().includes("debilitar") || e.name.toLowerCase().includes("vax"))
            );
            if (sapEffect) {
                await item.actor.deleteEmbeddedDocuments("ActiveEffect", [sapEffect.id]);
            }

            // 2. Vex (Targets)
            const currentTargets = Array.from(game.user.targets);
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
                        ui.notifications.info(`Ventaja Consumida: ${vexEffect.name}`);
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
                const inputVal = html.find(`[name='total-${part.index}']`).val();
                let val = parseInt(inputVal);
                if (isNaN(val)) val = 0;

                // Get Multiplier Per Part
                const partMultiplierRaw = html.find(`[name='multiplier-${part.index}']`).val();
                let partMultiplier = parseFloat(partMultiplierRaw);
                if (isNaN(partMultiplier)) partMultiplier = 1;

                // Apply Multiplier (Manual Mode)
                if (isDamage) {
                    val = Math.floor(val * partMultiplier);
                }

                // Get Type
                let selectedType = html.find(`[name='type-${part.index}']`).val();
                if (!selectedType) selectedType = part.type; // Fallback
                
                // Update Roll Object
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
                const targets = Array.from(game.user.targets);

                // Apply Mastery Effect
                if (activeMastery && activeMastery.id !== "nick") {
                    for (const t of targets) {
                         if (t.actor) {
                             const effectData = {
                                name: `Maestria: ${activeMastery.label} (${item.actor.name})`,
                                icon: item.img || "icons/svg/aura.svg",
                                origin: item.uuid,
                                duration: { 
                                    rounds: 1
                                }
                             };

                             // Vex / Molestar Duration Fix (End of Next Turn = 1 Round + 1 Turn)
                             if (activeMastery.id === "vex" || activeMastery.label.toLowerCase().includes("molestar")) {
                                 effectData.duration.turns = 1;
                             }

                             // Slow / Ralentizar Effect (-10 movement)
                             if (activeMastery.id === "slow" || activeMastery.label.toLowerCase().includes("ralentizar")) {
                                 effectData.changes = [
                                     { key: "system.attributes.movement.walk", mode: 2, value: "-10" },
                                     { key: "system.attributes.movement.fly", mode: 2, value: "-10" },
                                     { key: "system.attributes.movement.swim", mode: 2, value: "-10" },
                                     { key: "system.attributes.movement.climb", mode: 2, value: "-10" },
                                     { key: "system.attributes.movement.burrow", mode: 2, value: "-10" }
                                 ];
                             }

                             // Sync with Combat Time
                             if (game.combat) {
                                effectData.duration.startRound = game.combat.round;
                                effectData.duration.startTurn = game.combat.turn;
                             } else {
                                effectData.duration.startTime = game.time.worldTime;
                             }

                             await t.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
                             ui.notifications.info(`Maestria Aplicada: ${activeMastery.label} -> ${t.name}`);
                         }
                    }
                }

                for (const t of targets) {
                    if (t.actor) {
                        // Apply all damage parts together
                        // ignore: true ensures we bypass system traits calculation (DI/DR/DV)
                        // because we already applied multipliers manually above.
                        await t.actor.applyDamage(totalValues, { ignore: true });
                    }
                }
            }
            return { total: totalValues.reduce((acc, curr) => acc + curr.value, 0) }; // return mostly irrelevant now as we modded the rolls
        };

        // Si el usuario no es GM, enviar al GM activo para que muestre el popup y salir.
        if (!game.user.isGM) {
            const gmOnline = game.users.some(u => u.isGM && u.active);
            if (gmOnline && game.socket) {
                try {
                    const payload = {
                        type: "not-dice.show-attack-dialog",
                        rolls: rolls.map(r => r.toJSON()),
                        itemUuid: item?.uuid,
                        isNickAttack,
                        messageConfig,
                        senderName: game.user.name
                    };
                    game.socket.emit("module.not-dice", payload);
                    ui.notifications?.info("Enviado al GM para resolución del ataque.");
                } catch (err) {
                    console.error("Not Dice | Error enviando popup de ataque al GM", err);
                }
            } else {
                ui.notifications?.warn("No hay GM activo para recibir el popup de ataque.");
            }
            return rolls;
        }

        const result = await new Promise(resolve => {
            new Dialog({
                title: `Ataque Manual: ${item.name}`,
                content: dialogContent,
                buttons: {
                    damage: {
                        label: "DA&Ntilde;AR",
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
                render: (html) => {
                    html.find("button").not(".roll-damage-btn").addClass("damage-button");
                    
                    // --- Dynamic Multiplier Update on Type Change ---
                    html.find("select[name^='type-']").change((ev) => {
                        const select = $(ev.currentTarget);
                        const newType = select.val();
                        const index = select.attr("name").split("-")[1];
                        const multiplierSelect = html.find(`select[name='multiplier-${index}']`);
                        
                        let detectedMultiplier = 1;
                        if (targets.length > 0) {
                             for (const t of targets) {
                                const traits = t.actor?.system?.traits;
                                if (!traits) continue;
                                
                                if (traits.di?.value?.has(newType)) { detectedMultiplier = 0; break; }
                                if (traits.dv?.value?.has(newType)) detectedMultiplier = 2;
                                else if (traits.dr?.value?.has(newType) && detectedMultiplier !== 2) detectedMultiplier = 0.5;
                             }
                        }
                        multiplierSelect.val(detectedMultiplier);
                        
                        // Update color of select element itself
                        const damageStyle = {
                             acid: { color: "#56a700" },
                             bludgeoning: { color: "#666" },
                             cold: { color: "#3b82f6" },
                             fire: { color: "#ef4444" },
                             force: { color: "#a855f7" },
                             lightning: { color: "#eab308" },
                             necrotic: { color: "#1f2937" },
                             piercing: { color: "#666" },
                             poison: { color: "#10b981" },
                             psychic: { color: "#ec4899" },
                             radiant: { color: "#f59e0b" },
                             slashing: { color: "#666" },
                             thunder: { color: "#6366f1" },
                             healing: { color: "#10b981" },
                             temphp: { color: "#888" }
                        };
                        const style = damageStyle[newType] || { color: "#000" };
                        select.css("color", style.color);
                    });

                    html.find(".roll-damage-btn").click(async (ev) => {
                        ev.preventDefault();
                        const btn = $(ev.currentTarget);
                        const idx = btn.data("index");
                        const formula = damageParts.find(p => p.index === idx)?.formula;
                        
                        if (formula) {
                            try {
                                const r = await new Roll(formula).evaluate();
                                if (game.dice3d) {
                                    game.dice3d.showForRoll(r, game.user, true);
                                } else if (game.settings.get("not-dice", "enableSound")) {
                                    AudioHelper.play({src: "sounds/dice.wav"});
                                }
                                html.find(`[name='total-${idx}']`).val(r.total);
                            } catch (err) {
                                console.error("Not Dice | Error rolling damage manually", err);
                            }
                        }
                    });
                },
                close: () => resolve(rolls)
            }, { classes: ["manual-damage-dialog", "dialog"], width: 400 }).render(true);
        });

        // Ensure rolls are marked as evaluated
        for (const r of rolls) {
            if (!r._evaluated) {
                 r._total = 0;
                 r._evaluated = true;
                 r.terms = [new foundry.dice.terms.NumericTerm({number: 0, options: {}})];
            }
        }
        return rolls;

    };
  }

  /* ------------------------------------------------------------------ */
  /*             Concentration Check on Damage Logic (Update)           */
  /* ------------------------------------------------------------------ */
  
  Hooks.on("preUpdateActor", (actor, updateData, options, userId) => {
    // Permitir al usuario que inició la actualización (el atacante) ver el popup, incluso si no es dueño
    if (game.user.id !== userId && !game.user.isGM && !actor.isOwner) return;

    // Check if HP is being modified
    const hpUpdate = updateData.system?.attributes?.hp;
    
    // Si no hay cambio de vida, ignorar
    if (!hpUpdate) return;
    
    // Calculate damage taken
    const oldHP = actor.system.attributes.hp.value;
    const oldTemp = actor.system.attributes.hp.temp || 0;
    
    // Determine new values (from updateData, or fallback to current if not changing)
    const newHP = (hpUpdate.value !== undefined) ? hpUpdate.value : oldHP;
    const newTemp = (hpUpdate.temp !== undefined) ? hpUpdate.temp : oldTemp;

    const totalOld = oldHP + oldTemp;
    const totalNew = newHP + newTemp;
    
    const damage = totalOld - totalNew;
    
    // Solo proceder si es daño real (> 0)
    if (damage > 0) {
        // Check for Concentration
        // Modern dnd5e check
        const isConcentrating = actor.statuses?.has("concentrating") || 
                                actor.effects.some(e => e.getFlag("core", "statusId") === "concentrating" || e.name === "Concentrating");

        if (isConcentrating) {
            const dc = Math.max(10, Math.floor(damage / 2));
            
            // Intentar obtener el bono de salvación de constitución
            let bonus = 0;
            
            // Check if system data structure aligns with dnd5e
            const con = actor.system?.abilities?.con;
            if (con) {
                if (typeof con.save === "number") {
                    bonus = con.save;
                } else if (typeof con.mod === "number") {
                     // Fallback: Mod + Proficiency if applicable
                     bonus = con.mod;
                     if (con.proficient) {
                         bonus += (actor.system.attributes?.prof || 0);
                     }
                }
            }

            const operator = bonus >= 0 ? "+" : "";

            // Use formatted HTML for the dialog
             const content = `
                <div style="text-align: center;">
                    <p><strong>${actor.name}</strong> ha recibido <span style="color:red; font-weight:bold;">${damage}</span> puntos de daño.</p>
                    <p>Está concentrado en un hechizo.</p>
                    <hr>
                    <p>Debe superar una <strong>Salvación de Constitución</strong> (CD <span style="font-size:1.2em; font-weight:bold;">${dc}</span>)</p>
                    <p>Bonificador de CON: <strong>${operator}${bonus}</strong></p>
                </div>
            `;

            new Dialog({
                title: "Concentración: Chequeo Requerido",
                content: content,
                buttons: {
                    ok: {
                        label: "Entendido",
                        callback: () => {}
                    }
                },
                default: "ok"
            }).render(true);
        }
    }
  });


});

