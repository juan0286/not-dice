Hooks.once("ready", () => {
  console.log("Not Dice | Module Ready");

  // --- D20Roll (Attack) Patching ---
  const D20Roll = CONFIG.Dice.D20Roll;
  if (D20Roll) {
    const originalBuildConfigure = D20Roll.buildConfigure;
    const originalBuildEvaluate = D20Roll.buildEvaluate;

    D20Roll.buildConfigure = async function(config, dialog, message) {
      console.log("Not Dice | D20 buildConfigure intercepted", config);
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
          
          setTimeout(() => {
             if (rollConfig.subject && rollConfig.subject.rollDamage) {
                 console.log("Not Dice | Triggering Auto-Damage Roll");
                 rollConfig.subject.rollDamage({event: rollConfig.event});
             }
          }, 250);
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
        
        for (const roll of rolls) {
            const originalFormula = roll.formula;
            const item = rollConfig.subject.item;
            const damageTypeKey = roll.options.type;
            const damageTypeLabel = damageTypeKey ? (CONFIG.DND5E.damageTypes[damageTypeKey]?.label || damageTypeKey) : "None";

            // --- Gather Target Info ---
            const targets = Array.from(game.user.targets);
            let targetHtml = "";
            let isResistant = false;
            let isImmune = false;
            let isVulnerable = false;

            if (targets.length > 0) {
                targetHtml += "<div style='margin-bottom: 10px;'><strong>Objetivo:</strong><div style='display: flex; flex-wrap: wrap;'>";
                for (const t of targets) {
                    const traits = t.actor?.system?.traits;
                    if (!traits) continue;
                    
                    if (damageTypeKey) {
                        if (traits.dr?.value?.has(damageTypeKey)) isResistant = true;
                        if (traits.di?.value?.has(damageTypeKey)) isImmune = true;
                        if (traits.dv?.value?.has(damageTypeKey)) isVulnerable = true;
                    }
                    
                    const getLabels = (set) => {
                        if (!set) return "";
                        return Array.from(set).map(k => CONFIG.DND5E.damageTypes[k]?.label || k).join(", ");
                    };
                    
                    const dr = getLabels(traits.dr?.value);
                    const di = getLabels(traits.di?.value);
                    const dv = getLabels(traits.dv?.value);
                    const ac = t.actor?.system?.attributes?.ac?.value;
                    
                    targetHtml += `<div style="width: 100%; margin-bottom: 8px; font-size: 1.5em; color: #222; border: 1px solid #7a7971; background: rgba(0,0,0,0.05); border-radius: 4px; padding: 5px;"><strong style='text-align: left;'>${t.name}</strong>${ac !== undefined ? ` <span style='text-align: right;font-size: 1.5em; font-weight: bold; color: #000; margin-left: 5px;' title='Armor Class'>[CA: ${ac}]</span>` : ""}`;
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
            if (rollConfig.subject.type === "attack") {
                 const toHit = item.labels?.toHit || "";
                 // Check proficiency (usually 1 for proficient, 0 for not, or true/false)
                 const isProficient = item.system.proficient || false;
                 const profBadge = isProficient ? `<div style="margin-top: 4px; font-size: 0.6em; color: #444; text-transform: uppercase; letter-spacing: 1px;"><i class="fas fa-check-circle" style="color: green;"></i> Con Competencia</div>` : `<div style="margin-top: 4px; font-size: 0.6em; color: #888; text-transform: uppercase; letter-spacing: 1px;">Sin Competencia</div>`;

                 // Check Weapon Mastery (2024)
                 const baseItem = item.system.type?.baseItem;
                 const actorMasteries = item.actor?.system?.traits?.weaponProf?.mastery?.value || new Set();
                 const hasMastery = baseItem && actorMasteries.has(baseItem);
                 const masteryProperty = item.system.mastery;
                 
                 let masteryBadge = "";
                 if (hasMastery && masteryProperty) {
                     const masteryLabel = CONFIG.DND5E.weaponMasteries?.[masteryProperty]?.label || masteryProperty;
                     masteryBadge = `<div style="margin-top: 2px; font-size: 0.6em; color: #5a005a; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;"><i class="fas fa-crown" style="color: purple;"></i> Maestria: ${masteryLabel}</div>`;
                 }

                 attackHtml = `<div style="margin-bottom: 8px; font-size: 1.5em; color: #222; text-align: center; border: 1px solid #7a7971; background: rgba(0,0,0,0.05); border-radius: 4px; padding: 5px;">
                    <strong>Bono de Ataque:</strong> <span style="font-weight: 800; font-size: 1.2em;">${toHit}</span>
                    ${profBadge}
                    ${masteryBadge}
                 </div>`;
            }

            const userInput = await new Promise(resolve => {
              new Dialog({
                title: `Ataque Manual: ${item.name}`,
                content: `
                  <form>
                    <div style="margin-bottom: 10px; padding: 5px; border-bottom: 1px solid #ccc;">
                        ${targetHtml}
                    </div>
                    <div style="margin-bottom: 10px; padding: 5px; border-bottom: 1px solid #ccc;">
                        ${attackHtml}
                        <div style="margin-bottom: 5px;"><strong>Tipo de da&ntilde;o:</strong> ${damageTypeLabel}</div>
                    </div>
                    <div class="form-group">
                      <label>Formula (Dado + Mod.):</label>
                      <input type="text" value="${originalFormula}" disabled style="margin-bottom: 10px; width: 100%;"/>
                    </div>
                    <div class="form-group">
                      <label>Da&ntilde;o Total:</label>
                      <input type="number" name="total" value="5" autofocus class="damage-total-display" style="margin-bottom: 10px; width: 100%;${isImmune ? ' background-color: #ff4444 !important; color: #fff !important;' : (isVulnerable ? ' background-color: #66ff66 !important; color: #000 !important;' : (isResistant ? ' background-color: #ffeb3b !important; color: #000 !important;' : ''))}"/>     
                    </div>
                  </form>
                `,
                buttons: {
                  damage: {
                    label: "DA&Ntilde;AR",
                    icon: "<i class='fas fa-skull'></i>",
                    callback: async html => {
                      const total = parseInt(html.find("[name='total']").val());
                      const finalTotal = isNaN(total) ? 0 : total;
                      
                      // Apply damage to targets
                      const targets = Array.from(game.user.targets);
                      for (const t of targets) {
                          if (t.actor) {
                              const damageData = [{ value: finalTotal, type: damageTypeKey }];
                              await t.actor.applyDamage(damageData);
                          }
                      }
                      resolve({ total: finalTotal });
                    }
                  },
                  ok: {
                    label: "Confirmar",
                    icon: "<i class='fas fa-check'></i>",
                    callback: html => {
                      const total = parseInt(html.find("[name='total']").val());
                      resolve({ total: isNaN(total) ? 0 : total });
                    }
                  }
                },
                default: "damage",
                render: (html) => {
                    html.find("button").addClass("damage-button");
                },
                close: () => resolve({ total: 0 })
              }, { classes: ["manual-damage-dialog", "dialog"] }).render(true);
            });

            roll._total = userInput.total;
            roll._evaluated = true;
            
            const options = roll.terms[0]?.options ?? {};
            const newTerm = new foundry.dice.terms.NumericTerm({number: userInput.total, options: options});
            newTerm._evaluated = true;
            roll.terms = [newTerm];
        }
        return rolls;
    };
  }
});
