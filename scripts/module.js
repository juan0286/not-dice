Hooks.once("ready", () => {
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
          
          setTimeout(() => {
             if (rollConfig.subject && rollConfig.subject.rollDamage) {
                 console.log("Not Dice | Triggering Auto-Damage Roll");
                 rollConfig.subject.rollDamage({
                    event: rollConfig.event,
                    isNickAttack: rollConfig.isNickAttack
                 });
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
        
        for (const roll of rolls) {
            let originalFormula = roll.formula;
            
            if (isOffhandWithoutStyle) {
                 // Remove + @mod or + number from end
                 originalFormula = originalFormula.replace(/\s*\+\s*(@mod|\d+)(\s*\[.*?\])?$/, "");
            }

            const item = rollConfig.subject.item;

            // Function to calculate versatile damage scaling (d6->d8, d8->d10)
            const scaleVersatile = (formula) => {
                if (formula.includes("d6")) return formula.replace("d6", "d8");
                if (formula.includes("d8")) return formula.replace("d8", "d10");
                return null;
            };
            let versatileFormula = null;
            
            if (!versatileFormula && item?.system?.properties?.has("ver")) {
                versatileFormula = scaleVersatile(originalFormula);
            }

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
            let isNickActive = false; // Flag for Mellar
            let nickWeaponName = "";
            let nickWeaponItem = null;

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
                     
                     // Check for Mellar (Nick) activation
                     if (masteryProperty === "nick" && !isNickAttack) {
                         const otherLightWeapon = item.actor?.itemTypes?.weapon?.find(w => 
                             w.id !== item.id && 
                             w.system.equipped && 
                             w.system.properties?.has("lgt")
                         );
                         if (otherLightWeapon) {
                             isNickActive = true;
                             nickWeaponName = otherLightWeapon.name;
                             // Store weapon definition to trigger roll later
                             nickWeaponItem = otherLightWeapon;
                         }
                     }
                 }

                 // --- Simultaneous Attack Roll ---
                 let attackRollHtml = "";
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
                     } else {
                         AudioHelper.play({src: "sounds/dice.wav"}); 
                     }

                     const d20 = r.terms[0].total; 
                     const total = r.total;
                     
                     let color = "#333";
                     // For 2d20kh, the total of terms[0] is the result of keeping highest. 
                     // But terms[0] structure might be different for a pool term or keeping term.
                     // A standard KeepHighest roll `2d20kh` usually results in a Die term.
                     // Using r.dice[0].total should be safer for the d20 result.
                     
                     // Check natural 20 or 1 on the *kept* die
                     // If 2d20kh, r.terms[0] is the Die term.
                     // The total for the Die term is the kept value.
                     
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

                 attackHtml = `<div style="margin-bottom: 8px; font-size: 1.5em; color: #222; text-align: center; border: 1px solid #7a7971; background: rgba(0,0,0,0.05); border-radius: 4px; padding: 5px;">
                    <strong>Bono de Ataque:</strong> <span style="font-weight: 800; font-size: 1.2em;">${toHit}</span>
                    ${profBadge}
                    ${masteryBadge}
                    ${attackRollHtml}
                 </div>`;
            }

            const confirmMellar = async (weaponName) => {
                return new Promise(resolve => {
                    new Dialog({
                        title: "Maestria: Mellar",
                        content: `<p>¿Atacar con Mellar: <strong>${weaponName}</strong>?</p>`,
                        buttons: {
                            yes: {
                                label: "Si",
                                callback: () => resolve(true)
                            },
                            no: {
                                label: "No",
                                callback: () => resolve(false)
                            }
                        },
                        default: "yes",
                        close: () => resolve(false)
                    }).render(true);
                });
            };

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
                      <input type="text" value="${originalFormula}" disabled style="margin-bottom: 10px; width: 100%; ${isOffhandWithoutStyle ? 'border: 2px solid #e00; background-color: #ffeeee;' : ''}"/>
                      ${isOffhandWithoutStyle ? '<div style="font-size: 0.8em; color: #a00; margin-top: -8px; margin-bottom: 10px;">* Sin modificador (No Style)</div>' : ''}
                    </div>
                    ${versatileFormula ? `<div class="form-group"><label>Formula Versatil (2 Manos):</label><input type="text" value="${versatileFormula}" disabled style="margin-bottom: 10px; width: 100%;"/></div>` : ""}
                    <div class="form-group">
                      <label>Da&ntilde;o Total:</label>
                      <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 10px;">
                        <input type="number" name="total" value="0" autofocus class="damage-total-display" style="width: 100%; margin-bottom: 0; ${isImmune ? ' background-color: #ff4444 !important; color: #fff !important;' : (isVulnerable ? ' background-color: #66ff66 !important; color: #000 !important;' : (isResistant ? ' background-color: #ffeb3b !important; color: #000 !important;' : ''))}"/>
                        <button type="button" class="roll-damage-btn" style="flex: 0 0 40px; height: 32px; border: 1px solid #7a7971; border-radius: 4px; background: #ddd; cursor: pointer; display:flex; align-items:center; justify-content:center;" title="Tirar Daño"><i class="fas fa-dice"></i></button>
                      </div>
                    </div>
                  </form>
                `,
                buttons: {
                  damage: {
                    label: "DA&Ntilde;AR",
                    icon: "<i class='fas fa-skull'></i>",
                    callback: async html => {
                      if (isNickActive) {
                          const confirmed = await confirmMellar(nickWeaponName);
                          if (confirmed) {
                              console.log("Mellar activado");
                              if (nickWeaponItem) {
                                  const attackActivity = nickWeaponItem.system.activities?.find(a => a.type === "attack");
                                  if (attackActivity) {
                                      // Pass isNickAttack flag
                                      setTimeout(() => attackActivity.rollAttack({event, isNickAttack: true}), 500);
                                  } else {
                                      console.warn("Not Dice | No attack activity found for:", nickWeaponItem.name);
                                  }
                              }
                          }
                      }
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
                    callback: async html => {
                      if (isNickActive) {
                          const confirmed = await confirmMellar(nickWeaponName);
                          if (confirmed) {
                              console.log("Mellar activado");
                              if (nickWeaponItem) {
                                  const attackActivity = nickWeaponItem.system.activities?.find(a => a.type === "attack");
                                  if (attackActivity) {
                                      // Pass isNickAttack flag
                                      setTimeout(() => attackActivity.rollAttack({event, isNickAttack: true}), 500);
                                  } else {
                                      console.warn("Not Dice | No attack activity found for:", nickWeaponItem.name);
                                  }
                              }
                          }
                      }
                      const total = parseInt(html.find("[name='total']").val());
                      resolve({ total: isNaN(total) ? 0 : total });
                    }
                  }
                },
                default: "damage",
                render: (html) => {
                    html.find("button").not(".roll-damage-btn").addClass("damage-button");

                    html.find(".roll-damage-btn").click(async (ev) => {
                        ev.preventDefault();
                        try {
                             const r = await new Roll(originalFormula).evaluate();
                             
                             if (game.dice3d) {
                                 game.dice3d.showForRoll(r, game.user, true);
                             } else {
                                 AudioHelper.play({src: "sounds/dice.wav"});
                             }
                             
                             html.find("[name='total']").val(r.total);
                        } catch (err) {
                             console.error("Not Dice | Error rolling damage manually", err);
                        }
                    });
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
