/**
 * UI Interactions Module - Card interactions for the Shadow Duel game
 * Handles player hand, field, spell/trap zone, opponent zone, graveyard, and keyboard interactions
 * @module game/ui/interactions
 */

import ReplayCapture from "../../ReplayCapture.js";

/**
 * Binds all card interaction handlers.
 * This method sets up click handlers for all interactive elements in the game UI.
 */
export function bindCardInteractions() {
  this.devLog("BIND_INTERACTIONS", {
    summary: "Binding card interaction handlers",
  });

  let tributeSelectionMode = false;
  let selectedTributes = [];
  let pendingSummon = null;

  const isLaboratoryActive = (actor) =>
    this.laboratoryModeEnabled === true && actor?.id === this.turn;
  const getOpponentOf = (actor) => (actor?.id === "player" ? this.bot : this.player);
  const handleDirectAttackHandClick = (ownerId, event) => {
    if (!this.targetSelection || this.targetSelection.kind !== "attack") {
      return false;
    }
    const requirement = this.targetSelection.requirements?.[0];
    if (!requirement) return false;
    const directCandidate = requirement.candidates.find(
      (candidate) =>
        candidate &&
        candidate.isDirectAttack &&
        candidate.controller === ownerId
    );
    if (!directCandidate) return false;
    this.targetSelection.selections[requirement.id] = [directCandidate.key];
    this.targetSelection.currentRequirement =
      this.targetSelection.requirements.length;
    this.setSelectionState("confirming");
    this.finishTargetSelection();
    event?.stopPropagation?.();
    return true;
  };

  const setLaboratoryTributeHighlight = (actor, indices, selected = []) => {
    if (actor?.id === "player") {
      this.ui?.setPlayerFieldTributeable?.(indices);
      selected.forEach((idx) => this.ui?.setPlayerFieldSelected?.(idx, true));
      return;
    }
    const zone = document.getElementById("bot-field");
    if (!zone) return;
    zone.querySelectorAll(".card").forEach((el) => {
      const idx = Number.parseInt(el.dataset.index, 10);
      el.classList.toggle("tributeable", indices.includes(idx));
      el.classList.toggle("selected", selected.includes(idx));
    });
  };

  const clearLaboratoryTributeHighlight = (actor) => {
    if (actor?.id === "player") {
      this.ui?.clearPlayerFieldTributeable?.();
      return;
    }
    const zone = document.getElementById("bot-field");
    if (!zone) return;
    zone
      .querySelectorAll(".card")
      .forEach((el) => el.classList.remove("tributeable", "selected"));
  };

  const handleLaboratoryHandClick = async (actor, index) => {
    if (!isLaboratoryActive(actor)) return false;
    if (this.targetSelection || tributeSelectionMode) return true;
    const opponent = getOpponentOf(actor);
    const card = actor.hand[index];
    if (!card) return true;

    if (this.isResolvingEffect) {
      if (
        this.pendingSpecialSummon &&
        card.name === this.pendingSpecialSummon.cardName
      ) {
        this.chooseSpecialSummonPosition(actor, card, {})
          .then((position) => this.performSpecialSummon(index, position, actor))
          .catch(() => this.performSpecialSummon(index, "attack", actor));
      } else {
        this.ui.log("Finalize o efeito pendente antes de fazer outra acao.");
      }
      return true;
    }

    if (card.cardKind === "monster") {
      const guard = this.guardActionStart({
        actor,
        kind: "summon",
        phaseReq: ["main1", "main2"],
      });
      if (!guard.ok) return true;

      const canSanctumSpecialFromAegis =
        card.name === "Luminarch Sanctum Protector" &&
        actor.field.length < 5 &&
        actor.field.some(
          (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown
        );
      const tributeInfo = actor.getTributeRequirement(card);
      const tributesNeeded = tributeInfo.tributesNeeded;
      const handEffect = (card.effects || []).find(
        (effect) =>
          effect && effect.timing === "ignition" && effect.requireZone === "hand"
      );
      const handEffectPreview = handEffect
        ? this.effectEngine.canActivateMonsterEffectPreview(card, actor, "hand")
        : { ok: false };
      const canUseHandEffect = handEffectPreview.ok;

      if (
        !canUseHandEffect &&
        tributesNeeded > 0 &&
        actor.field.length < tributesNeeded &&
        !canSanctumSpecialFromAegis
      ) {
        this.ui.log(`Not enough tributes for Level ${card.level} monster.`);
        return true;
      }

      this.ui.showSummonModal(
        index,
        async (choice) => {
          if (choice === "special_from_aegisbearer") {
            this.specialSummonSanctumProtectorFromHand(index, actor);
            return;
          }
          if (
            choice === "special_from_void_forgotten" ||
            choice === "special_from_hand_effect"
          ) {
            this.tryActivateMonsterEffect(card, null, "hand", actor);
            return;
          }
          if (choice !== "attack" && choice !== "defense") return;

          const position = choice;
          const isFacedown = choice === "defense";
          if (tributesNeeded > 0) {
            tributeSelectionMode = true;
            selectedTributes = [];
            let tributeableIndices = actor.field
              .map((fieldCard, idx) => (fieldCard ? idx : null))
              .filter((idx) => idx !== null);
            if (tributeInfo.usingAlt && tributeInfo.alt?.requiresType) {
              const requiredType = tributeInfo.alt.requiresType;
              tributeableIndices = tributeableIndices.filter((idx) => {
                const fieldCard = actor.field[idx];
                if (!fieldCard || fieldCard.isFacedown) return false;
                return Array.isArray(fieldCard.types)
                  ? fieldCard.types.includes(requiredType)
                  : fieldCard.type === requiredType;
              });
            }
            pendingSummon = {
              actor,
              opponent,
              cardIndex: index,
              position,
              isFacedown,
              tributesNeeded,
              tributeableIndices,
            };
            setLaboratoryTributeHighlight(actor, tributeableIndices);
            this.ui.log(`Select ${tributesNeeded} monster(s) to tribute.`);
            return;
          }

          const before = actor.field.length;
          const summonResult = await this.performNormalSummon(
            actor,
            index,
            position,
            isFacedown,
          );
          if (!summonResult && actor.field.length === before) {
            this.updateBoard();
            return;
          }
          const summonedCard = actor.field[actor.field.length - 1];
          const tributes = summonResult.tributes || [];
          summonedCard.summonedTurn = this.turnCounter;
          summonedCard.positionChangedThisTurn = false;
          summonedCard.setTurn = summonedCard.isFacedown ? this.turnCounter : null;
          this.updateBoard();
          this.emit("after_summon", {
            card: summonedCard,
            player: actor,
            opponent,
            method: "normal",
            fromZone: "hand",
            tributes,
          }).then(() => this.updateBoard());
        },
        {
          canSanctumSpecialFromAegis,
          specialSummonFromHand: false,
          specialSummonFromHandEffect: canUseHandEffect,
          specialSummonFromHandEffectLabel: "Special Summon",
          ownerId: actor.id,
        }
      );
      return true;
    }

    if (card.cardKind === "spell") {
      const guard = this.guardActionStart({
        actor,
        kind: "spell_from_hand",
        phaseReq: ["main1", "main2"],
      });
      if (!guard.ok) return true;
      const spellPreview =
        this.effectEngine?.canActivateSpellFromHandPreview(card, actor) || {
          ok: true,
        };
      let canActivateFromHand = !!spellPreview.ok;
      const hasFusionAction = (card.effects || []).some(
        (effect) =>
          effect &&
          Array.isArray(effect.actions) &&
          effect.actions.some(
            (action) => action && action.type === "polymerization_fusion_summon"
          )
      );
      if (hasFusionAction && !this.canActivatePolymerization(actor)) {
        canActivateFromHand = false;
      }
      this.ui.showSpellChoiceModal(
        index,
        (choice) => {
          if (choice === "activate" && canActivateFromHand) {
            this.tryActivateSpell(card, index, null, { owner: actor });
          } else if (choice === "set") {
            this.setSpellOrTrap(card, index, actor);
          }
        },
        { canActivate: canActivateFromHand, ownerId: actor.id }
      );
      return true;
    }

    if (card.cardKind === "trap") {
      this.setSpellOrTrap(card, index, actor);
      return true;
    }
    return true;
  };

  const handleLaboratoryFieldClick = async (actor, cardEl, index) => {
    if (!isLaboratoryActive(actor)) return false;
    const opponent = getOpponentOf(actor);
    if (tributeSelectionMode && pendingSummon?.actor === actor) {
      const allowed = pendingSummon.tributeableIndices || [];
      if (!allowed.includes(index)) return true;
      if (selectedTributes.includes(index)) {
        selectedTributes = selectedTributes.filter((idx) => idx !== index);
      } else if (selectedTributes.length < pendingSummon.tributesNeeded) {
        selectedTributes.push(index);
      }
      setLaboratoryTributeHighlight(actor, allowed, selectedTributes);
      if (selectedTributes.length === pendingSummon.tributesNeeded) {
        clearLaboratoryTributeHighlight(actor);
        const before = actor.field.length;
        const summonResult = await this.performNormalSummon(
          actor,
          pendingSummon.cardIndex,
          pendingSummon.position,
          pendingSummon.isFacedown,
          selectedTributes
        );
        if (!summonResult && actor.field.length === before) {
          tributeSelectionMode = false;
          selectedTributes = [];
          pendingSummon = null;
          this.updateBoard();
          return true;
        }
        const summonedCard = actor.field[actor.field.length - 1];
        const tributes = summonResult.tributes || [];
        summonedCard.summonedTurn = this.turnCounter;
        summonedCard.positionChangedThisTurn = false;
        summonedCard.setTurn = summonedCard.isFacedown ? this.turnCounter : null;
        tributeSelectionMode = false;
        selectedTributes = [];
        pendingSummon = null;
        this.updateBoard();
        this.emit("after_summon", {
          card: summonedCard,
          player: actor,
          opponent,
          method: tributes.length > 0 ? "tribute" : "normal",
          fromZone: "hand",
          tributes,
        }).then(() => this.updateBoard());
      }
      return true;
    }

    if (this.phase === "main1" || this.phase === "main2") {
      const guard = this.guardActionStart({
        actor,
        kind: "monster_action",
        phaseReq: ["main1", "main2"],
      });
      if (!guard.ok) return true;
      const card = actor.field[index];
      if (!card || card.cardKind !== "monster") return true;
      const hasIgnition = (card.effects || []).some(
        (effect) => effect && effect.timing === "ignition"
      );
      const canFlip = this.canFlipSummon(card);
      const canPosChange = this.canChangePosition(card);
      const materialCheck = this.canUseAsAscensionMaterial(actor, card);
      const hasAscension =
        materialCheck.ok &&
        this
          .getAscensionCandidatesForMaterial(actor, card)
          .some((asc) => this.checkAscensionRequirements(actor, asc).ok);
      if (hasIgnition || canFlip || canPosChange || hasAscension) {
        this.ui.showPositionChoiceModal(
          cardEl,
          card,
          async (choice) => {
            if (choice === "flip" && canFlip) {
              await this.flipSummon(card);
            } else if (choice === "to_attack" && canPosChange) {
              this.changeMonsterPosition(card, "attack");
            } else if (choice === "to_defense" && canPosChange) {
              this.changeMonsterPosition(card, "defense");
            }
          },
          {
            canFlip,
            canChangePosition: canPosChange,
            hasIgnitionEffect: hasIgnition,
            onActivateEffect: hasIgnition
              ? () => this.tryActivateMonsterEffect(card, null, "field", actor)
              : null,
            hasAscensionSummon: hasAscension,
            onAscensionSummon: hasAscension
              ? () => this.tryAscensionSummon(card, { player: actor })
              : null,
          }
        );
        return true;
      }
    }

    if (this.phase !== "battle") return true;
    const attacker = actor.field[index];
    if (!attacker) return true;
    const guard = this.guardActionStart({
      actor,
      kind: "attack",
      phaseReq: "battle",
    });
    if (!guard.ok) return true;
    const availability = this.getAttackAvailability(attacker);
    if (!availability.ok) {
      this.ui.log(availability.reason);
      return true;
    }
    const opponentTargets = opponent.field.filter(
      (card) => card && card.cardKind === "monster"
    );
    const forcedTargets = opponentTargets.filter((card) => card.mustBeAttacked);
    const attackCandidates = forcedTargets.length ? forcedTargets : opponentTargets;
    if (
      attackCandidates.length === 0 &&
      attacker.cannotAttackDirectly &&
      attacker.canAttackDirectlyThisTurn !== true
    ) {
      this.ui.log("No valid attack targets and cannot attack directly!");
      return true;
    }
    this.startAttackTargetSelection(attacker, attackCandidates);
    return true;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Player Hand Click
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindPlayerHandClick === "function") {
    this.ui.bindPlayerHandClick(async (e, cardEl, index) => {
      if (this.targetSelection) {
        handleDirectAttackHandClick("player", e);
        return;
      }

      if (tributeSelectionMode) return;
      const card = this.player.hand[index];

      if (!card) return;

      // If resolving an effect, only allow the specific pending action
      if (this.isResolvingEffect) {
        if (
          this.pendingSpecialSummon &&
          card.name === this.pendingSpecialSummon.cardName
        ) {
          // Use unified position resolver
          this.chooseSpecialSummonPosition(this.player, card, {})
            .then((position) => {
              this.performSpecialSummon(index, position);
            })
            .catch(() => {
              this.performSpecialSummon(index, "attack");
            });
        } else {
          this.ui.log("Finalize o efeito pendente antes de fazer outra acao.");
        }
        return;
      }

      if (card.cardKind === "monster") {
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "summon",
          phaseReq: ["main1", "main2"],
        });
        if (!guard.ok) return;

        // LEGACY: Hardcoded check for "Luminarch Sanctum Protector" card.
        // TODO: This should be replaced with a declarative ignition effect on the card definition.
        const canSanctumSpecialFromAegis =
          card.name === "Luminarch Sanctum Protector" &&
          this.player.field.length < 5 &&
          this.player.field.some(
            (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown
          );

        const tributeInfo = this.player.getTributeRequirement(card);
        const tributesNeeded = tributeInfo.tributesNeeded;

        const handEffect = (card.effects || []).find(
          (e) => e && e.timing === "ignition" && e.requireZone === "hand"
        );

        // Generic pre-check for hand effects (filters, OPT, targets, phase/turn)
        const handEffectPreview = handEffect
          ? this.effectEngine.canActivateMonsterEffectPreview(
              card,
              this.player,
              "hand"
            )
          : { ok: false };

        const canUseHandEffect = handEffectPreview.ok;
        const handEffectLabel = "Special Summon";

        if (
          !canUseHandEffect &&
          tributesNeeded > 0 &&
          this.player.field.length < tributesNeeded &&
          !canSanctumSpecialFromAegis
        ) {
          this.ui.log(`Not enough tributes for Level ${card.level} monster.`);
          return;
        }

        // v4: Captura de available actions para humano
        if (ReplayCapture.isEnabled()) {
          const availableActions = [
            {
              type: "normal_summon",
              card: { id: card.id, name: card.name },
              position: "attack",
            },
            {
              type: "set",
              card: { id: card.id, name: card.name },
              position: "defense",
            },
          ];
          if (canSanctumSpecialFromAegis) {
            availableActions.push({
              type: "special_from_aegisbearer",
              card: { id: card.id, name: card.name },
            });
          }
          if (canUseHandEffect) {
            availableActions.push({
              type: "special_from_hand_effect",
              card: { id: card.id, name: card.name },
            });
          }
          ReplayCapture.registerAvailableActions({
            actor: "human",
            promptType: "summon_modal",
            turn: this.turnCounter,
            phase: this.phase,
            actions: availableActions,
          });
        }

        this.ui.showSummonModal(
          index,
          async (choice) => {
            if (choice === "special_from_aegisbearer") {
              this.specialSummonSanctumProtectorFromHand(index);
              return;
            }

            if (choice === "special_from_void_forgotten") {
              this.tryActivateMonsterEffect(card, null, "hand");
              return;
            }

            if (choice === "special_from_hand_effect") {
              console.log("[Game] Activating hand effect for:", card.name);
              this.tryActivateMonsterEffect(card, null, "hand");
              return;
            }
            if (choice === "attack" || choice === "defense") {
              const position = choice;
              const isFacedown = choice === "defense";

              if (tributesNeeded > 0) {
                tributeSelectionMode = true;
                selectedTributes = [];
                pendingSummon = {
                  cardIndex: index,
                  position,
                  isFacedown,
                  tributesNeeded,
                  altTribute: tributeInfo.usingAlt ? tributeInfo.alt : null,
                };

                // Filter tributeable monsters based on altTribute requirements
                let tributeableIndices = this.player.field
                  .map((card, idx) => (card ? idx : null))
                  .filter((idx) => idx !== null);

                // If using alt tribute with type requirement, only allow that type
                if (tributeInfo.usingAlt && tributeInfo.alt?.requiresType) {
                  const requiredType = tributeInfo.alt.requiresType;
                  tributeableIndices = tributeableIndices.filter((idx) => {
                    const fieldCard = this.player.field[idx];
                    if (!fieldCard || fieldCard.isFacedown) return false;
                    if (Array.isArray(fieldCard.types)) {
                      return fieldCard.types.includes(requiredType);
                    }
                    return fieldCard.type === requiredType;
                  });
                }

                pendingSummon.tributeableIndices = tributeableIndices;
                if (
                  this.ui &&
                  typeof this.ui.setPlayerFieldTributeable === "function"
                ) {
                  this.ui.setPlayerFieldTributeable(
                    pendingSummon.tributeableIndices
                  );
                }

                this.ui.log(`Select ${tributesNeeded} monster(s) to tribute.`);
              } else {
                const before = this.player.field.length;
                const summonResult = await this.performNormalSummon(
                  this.player,
                  index,
                  position,
                  isFacedown
                );
                if (!summonResult && this.player.field.length === before) {
                  this.updateBoard();
                  return;
                }
                // Handle both old (card) and new ({card, tributes}) return formats
                const card = summonResult.card || summonResult;
                const tributes = summonResult.tributes || [];

                const summonedCard =
                  this.player.field[this.player.field.length - 1];
                summonedCard.summonedTurn = this.turnCounter;
                summonedCard.positionChangedThisTurn = false;
                if (summonedCard.isFacedown) {
                  summonedCard.setTurn = this.turnCounter;
                } else {
                  summonedCard.setTurn = null;
                }
                // Update before after_summon so confirm prompts show after the summon is visible.
                this.updateBoard();
                this.emit("after_summon", {
                  card: summonedCard,
                  player: this.player,
                  method: "normal",
                  fromZone: "hand",
                  tributes: tributes,
                }).then(() => {
                  this.updateBoard();
                });
              }
            }
          },
          {
            canSanctumSpecialFromAegis,
            specialSummonFromHand: false,
            specialSummonFromHandEffect: canUseHandEffect,
            specialSummonFromHandEffectLabel: handEffectLabel,
          }
        );
        return;
      }

      if (card.cardKind === "spell") {
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "spell_from_hand",
          phaseReq: ["main1", "main2"],
        });
        if (!guard.ok) return;

        // Check for fusion spell (has polymerization_fusion_summon action) - generic instead of hardcoded name
        const spellPreview = this.effectEngine?.canActivateSpellFromHandPreview(
          card,
          this.player
        ) || { ok: true };
        let canActivateFromHand = !!spellPreview.ok;

        const hasFusionAction = (card.effects || []).some(
          (e) =>
            e &&
            Array.isArray(e.actions) &&
            e.actions.some((a) => a && a.type === "polymerization_fusion_summon")
        );
        if (hasFusionAction) {
          if (!this.canActivatePolymerization()) {
            canActivateFromHand = false;
          }
        }

        const handleSpellChoice = (choice) => {
          if (choice === "activate") {
            this.tryActivateSpell(card, index);
          } else if (choice === "set") {
            this.setSpellOrTrap(card, index);
          }
        };

        // v4: Captura de available actions para humano (spell)
        if (ReplayCapture.isEnabled()) {
          const availableActions = [
            { type: "set_spell", card: { id: card.id, name: card.name } },
          ];
          if (canActivateFromHand) {
            availableActions.unshift({
              type: "activate_spell",
              card: { id: card.id, name: card.name },
            });
          }
          ReplayCapture.registerAvailableActions({
            actor: "human",
            promptType: "spell_modal",
            turn: this.turnCounter,
            phase: this.phase,
            actions: availableActions,
          });
        }

        if (this.ui && typeof this.ui.showSpellChoiceModal === "function") {
          this.ui.showSpellChoiceModal(index, handleSpellChoice, {
            canActivate: canActivateFromHand,
          });
        } else {
          const shouldActivate =
            (await this.ui?.showConfirmPrompt?.(
              "OK: Activate this Spell. Cancel: Set it face-down in your Spell/Trap Zone.",
              { kind: "spell_choice", cardName: card.name }
            )) ?? false;
          handleSpellChoice(shouldActivate ? "activate" : "set");
        }
        return;
      }

      if (card.cardKind === "trap") {
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "set_trap",
          phaseReq: ["main1", "main2"],
        });
        if (!guard.ok) return;
        this.setSpellOrTrap(card, index);
        return;
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Player Field Click
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindPlayerFieldClick === "function") {
    this.ui.bindPlayerFieldClick(async (e, cardEl, index) => {
      if (
        this.targetSelection &&
        this.handleTargetSelectionClick("player", index, cardEl, "field")
      ) {
        return;
      }

      if (tributeSelectionMode && pendingSummon) {
        const allowed = pendingSummon.tributeableIndices || [];
        if (!allowed.includes(index)) return;

        if (selectedTributes.includes(index)) {
          selectedTributes = selectedTributes.filter((i) => i !== index);
          if (this.ui && typeof this.ui.setPlayerFieldSelected === "function") {
            this.ui.setPlayerFieldSelected(index, false);
          }
        } else if (selectedTributes.length < pendingSummon.tributesNeeded) {
          selectedTributes.push(index);
          if (this.ui && typeof this.ui.setPlayerFieldSelected === "function") {
            this.ui.setPlayerFieldSelected(index, true);
          }
        }

        if (selectedTributes.length === pendingSummon.tributesNeeded) {
          if (
            this.ui &&
            typeof this.ui.clearPlayerFieldTributeable === "function"
          ) {
            this.ui.clearPlayerFieldTributeable();
          }

          const before = this.player.field.length;
          const summonResult = await this.performNormalSummon(
            this.player,
            pendingSummon.cardIndex,
            pendingSummon.position,
            pendingSummon.isFacedown,
            selectedTributes
          );

          if (!summonResult && this.player.field.length === before) {
            tributeSelectionMode = false;
            selectedTributes = [];
            pendingSummon = null;
            this.updateBoard();
            return;
          }

          // Handle both old (card) and new ({card, tributes}) return formats
          const card = summonResult.card || summonResult;
          const tributes = summonResult.tributes || [];

          const summonedCard = this.player.field[this.player.field.length - 1];
          summonedCard.summonedTurn = this.turnCounter;
          summonedCard.positionChangedThisTurn = false;
          if (summonedCard.isFacedown) {
            summonedCard.setTurn = this.turnCounter;
          } else {
            summonedCard.setTurn = null;
          }

          // Update before after_summon so confirm prompts show after the summon is visible.
          this.updateBoard();
          this.emit("after_summon", {
            card: summonedCard,
            player: this.player,
            method: pendingSummon.tributesNeeded > 0 ? "tribute" : "normal",
            fromZone: "hand",
            tributes: tributes,
          }).then(() => {
            this.updateBoard();
          });

          tributeSelectionMode = false;
          selectedTributes = [];
          pendingSummon = null;
        }
        return;
      }

      if (
        this.turn === "player" &&
        (this.phase === "main1" || this.phase === "main2")
      ) {
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "monster_action",
          phaseReq: ["main1", "main2"],
        });
        if (!guard.ok) return;

        const card = this.player.field[index];
        if (!card || card.cardKind !== "monster") return;

        // Verificar se tem efeito ignition ativavel
        const hasIgnition =
          card.effects &&
          card.effects.some((eff) => eff && eff.timing === "ignition");

        const canFlip = this.canFlipSummon(card);
        const canPosChange = this.canChangePosition(card);

        // Verificar se pode fazer Ascension Summon
        let hasAscension = false;
        const materialCheck = this.canUseAsAscensionMaterial(this.player, card);
        if (materialCheck.ok) {
          const candidates = this.getAscensionCandidatesForMaterial(
            this.player,
            card
          );
          hasAscension = candidates.some(
            (asc) => this.checkAscensionRequirements(this.player, asc).ok
          );
        }

        // Se tem qualquer opcao disponivel, mostrar o modal unificado
        if (hasIgnition || canFlip || canPosChange || hasAscension) {
          if (e && typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
          }

          this.ui.showPositionChoiceModal(
            cardEl,
            card,
            async (choice) => {
              if (choice === "flip" && canFlip) {
                await this.flipSummon(card);
              } else if (
                choice === "to_attack" &&
                canPosChange &&
                card.position !== "attack"
              ) {
                this.changeMonsterPosition(card, "attack");
              } else if (
                choice === "to_defense" &&
                canPosChange &&
                card.position !== "defense"
              ) {
                this.changeMonsterPosition(card, "defense");
              }
            },
            {
              canFlip,
              canChangePosition: canPosChange,
              hasIgnitionEffect: hasIgnition,
              onActivateEffect: hasIgnition
                ? () => this.tryActivateMonsterEffect(card)
                : null,
              hasAscensionSummon: hasAscension,
              onAscensionSummon: hasAscension
                ? () => this.tryAscensionSummon(card)
                : null,
            }
          );
          return;
        }
      }

      if (this.turn !== "player" || this.phase !== "battle") return;

      const attacker = this.player.field[index];

      if (attacker) {
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "attack",
          phaseReq: "battle",
        });
        if (!guard.ok) return;

        const availability = this.getAttackAvailability(attacker);
        if (!availability.ok) {
          this.ui.log(availability.reason);
          return;
        }

        const canUseSecondAttack =
          attacker.canMakeSecondAttackThisTurn &&
          !attacker.secondAttackUsedThisTurn;

        // Multi-attack mode bypasses the hasAttacked check
        const isMultiAttackMode = attacker.canAttackAllOpponentMonstersThisTurn;

        // Check remaining attacks considering extraAttacks property
        const extraAttacks = attacker.extraAttacks || 0;
        const maxAttacks = 1 + extraAttacks;
        const attacksUsed = attacker.attacksUsedThisTurn || 0;
        const hasAttacksRemaining =
          attacksUsed < maxAttacks || canUseSecondAttack;

        if (!hasAttacksRemaining && !isMultiAttackMode) {
          this.ui.log(
            `${attacker.name} has already attacked the maximum number of times this turn!`
          );
          return;
        }

        const opponentTargets = this.bot.field.filter(
          (card) => card && card.cardKind === "monster"
        );

        let attackCandidates =
          opponentTargets.filter((card) => card && card.mustBeAttacked).length >
          0
            ? opponentTargets.filter((card) => card && card.mustBeAttacked)
            : opponentTargets;

        // For multi-attack mode, filter out monsters already attacked this turn
        if (attacker.canAttackAllOpponentMonstersThisTurn) {
          const attackedMonsters =
            attacker.attackedMonstersThisTurn || new Set();
          attackCandidates = attackCandidates.filter((card) => {
            const cardId = card.instanceId || card.id || card.name;
            return !attackedMonsters.has(cardId);
          });
        }

        const canDirect =
          !attacker.cannotAttackDirectly &&
          !this.player?.forbidDirectAttacksThisTurn &&
          !isMultiAttackMode && // Multi-attack can only target monsters, not direct
          (attacker.canAttackDirectlyThisTurn === true ||
            attackCandidates.length === 0);

        // Always start selection; "Direct Attack" option added when allowed
        if (!canDirect && attackCandidates.length === 0) {
          this.ui.log("No valid attack targets and cannot attack directly!");
          return;
        }

        // v4: Captura de available actions para humano (ataque)
        if (ReplayCapture.isEnabled()) {
          const attackActions = [];

          // Ataques a monstros
          attackCandidates.forEach((target) => {
            attackActions.push({
              type: "attack",
              card: { id: attacker.id, name: attacker.name },
              target: { id: target.id, name: target.name },
            });
          });

          // Ataque direto
          if (canDirect) {
            attackActions.push({
              type: "direct_attack",
              card: { id: attacker.id, name: attacker.name },
            });
          }

          // Cancelar
          attackActions.push({ type: "cancel_attack" });

          ReplayCapture.registerAvailableActions({
            actor: "human",
            promptType: "attack_target",
            turn: this.turnCounter,
            phase: this.phase,
            actions: attackActions,
          });
        }

        this.startAttackTargetSelection(attacker, attackCandidates);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Player Spell/Trap Zone Click
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindPlayerSpellTrapClick === "function") {
    this.ui.bindPlayerSpellTrapClick(async (e, cardEl, index) => {
      console.log(`[Game] Spell/Trap zone clicked! Target:`, e.target);

      if (this.targetSelection) {
        const handled = this.handleTargetSelectionClick(
          "player",
          index,
          cardEl,
          "spellTrap"
        );
        if (handled) return;
        console.log(`[Game] Returning: targetSelection active`);
        return;
      }

      const card = this.player.spellTrap[index];
      if (!card) return;

      console.log(
        `[Game] Clicked spell/trap: ${card.name}, isFacedown: ${card.isFacedown}, cardKind: ${card.cardKind}`
      );

      // Handle traps - can be activated on opponent's turn and during battle phase
      if (card.cardKind === "trap") {
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "trap_activation",
          phaseReq: ["main1", "battle", "main2"],
          allowDuringOpponentTurn: true,
        });
        if (!guard.ok) return;

        const hasActivateEffect = (card.effects || []).some(
          (e) => e && e.timing === "on_activate"
        );

        if (hasActivateEffect) {
          // Check if trap can be activated (waited at least 1 turn)
          if (!this.canActivateTrap(card)) {
            this.ui.log("Esta armadilha nao pode ser ativada neste turno.");
            return;
          }

          console.log(`[Game] Activating trap: ${card.name}`);
          await this.tryActivateSpellTrapEffect(card);
        }
        return;
      }

      // Spells can only be activated on your turn during Main Phase
      const guard = this.guardActionStart({
        actor: this.player,
        kind: "spelltrap_zone",
        phaseReq: ["main1", "main2"],
      });
      if (!guard.ok) return;

      if (card.cardKind === "spell") {
        const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
          card,
          this.player,
          "spellTrap",
          null,
          { activationContext: { autoSelectSingleTarget: true } }
        );
        if (preview && preview.ok === false) {
          if (preview.reason) {
            this.ui.log(preview.reason);
          }
          return;
        }
        console.log(`[Game] Activating spell from zone: ${card.name}`);
        await this.tryActivateSpellTrapEffect(card);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bot Field Click (for target selection)
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindBotFieldClick === "function") {
    this.ui.bindBotFieldClick(async (e, cardEl, index) => {
      if (this.targetSelection) {
        this.handleTargetSelectionClick("bot", index, cardEl, "field");
        return;
      }
      await handleLaboratoryFieldClick(this.bot, cardEl, index);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bot Spell/Trap Click (for target selection)
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindBotSpellTrapClick === "function") {
    this.ui.bindBotSpellTrapClick(async (e, cardEl, index) => {
      if (this.targetSelection) {
        this.handleTargetSelectionClick("bot", index, cardEl, "spellTrap");
        return;
      }
      if (!isLaboratoryActive(this.bot)) return;
      const card = this.bot.spellTrap[index];
      if (!card) return;
      if (card.cardKind === "trap") {
        const guard = this.guardActionStart({
          actor: this.bot,
          kind: "trap_activation",
          phaseReq: ["main1", "battle", "main2"],
          allowDuringOpponentTurn: true,
        });
        if (!guard.ok) return;
        if (!this.canActivateTrap(card)) {
          this.ui.log("Esta armadilha nao pode ser ativada neste turno.");
          return;
        }
        await this.tryActivateSpellTrapEffect(card, null, { owner: this.bot });
        return;
      }
      const guard = this.guardActionStart({
        actor: this.bot,
        kind: "spelltrap_zone",
        phaseReq: ["main1", "main2"],
      });
      if (!guard.ok) return;
      const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        this.bot,
        "spellTrap",
        null,
        { activationContext: { autoSelectSingleTarget: true } }
      );
      if (preview && preview.ok === false) {
        if (preview.reason) this.ui.log(preview.reason);
        return;
      }
      await this.tryActivateSpellTrapEffect(card, null, { owner: this.bot });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bot Hand Click (Direct Attack via target selection)
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindBotHandClick === "function") {
    this.ui.bindBotHandClick((e, cardEl, index) => {
      if (this.targetSelection) {
        handleDirectAttackHandClick("bot", e);
        return;
      }
      handleLaboratoryHandClick(this.bot, index);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Field Spell Click (Player and Bot)
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindPlayerFieldSpellClick === "function") {
    this.ui.bindPlayerFieldSpellClick((e, cardEl) => {
      if (this.targetSelection) {
        this.handleTargetSelectionClick("player", 0, cardEl, "fieldSpell");
        return;
      }
      const card = this.player.fieldSpell;
      if (card) {
        this.activateFieldSpellEffect(card);
      }
    });
  }

  if (this.ui && typeof this.ui.bindBotFieldSpellClick === "function") {
    this.ui.bindBotFieldSpellClick((e, cardEl) => {
      if (this.targetSelection) {
        this.handleTargetSelectionClick("bot", 0, cardEl, "fieldSpell");
        return;
      }
      if (!isLaboratoryActive(this.bot)) return;
      const card = this.bot.fieldSpell;
      if (card) {
        this.activateFieldSpellEffect(card);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Card Hover Preview
  // ─────────────────────────────────────────────────────────────────────────────
  this.ui.bindCardHover((owner, location, index) => {
    let card = null;
    const playerObj = owner === "player" ? this.player : this.bot;

    if (location === "hand") {
      card = playerObj.hand[index];
    } else if (location === "field") {
      card = playerObj.field[index];
    } else if (location === "spellTrap") {
      card = playerObj.spellTrap[index];
    } else if (location === "fieldSpell") {
      card = playerObj.fieldSpell;
    }

    if (card) {
      if (card.isFacedown && playerObj.controllerType === "ai") {
        this.ui.renderPreview(null);
      } else {
        this.ui.renderPreview(card);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Graveyard Click
  // ─────────────────────────────────────────────────────────────────────────────
  const showGY = (player) => {
    this.openGraveyardModal(player);
  };

  if (this.ui && typeof this.ui.bindPlayerGraveyardClick === "function") {
    this.ui.bindPlayerGraveyardClick(() => showGY(this.player));
  }
  if (this.ui && typeof this.ui.bindBotGraveyardClick === "function") {
    this.ui.bindBotGraveyardClick(() => showGY(this.bot));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Extra Deck Click
  // ─────────────────────────────────────────────────────────────────────────────
  const showExtraDeck = (player) => {
    if (player.id !== "player" && !this.laboratoryModeEnabled) return;
    this.openExtraDeckModal(player);
  };

  if (this.ui && typeof this.ui.bindPlayerExtraDeckClick === "function") {
    this.ui.bindPlayerExtraDeckClick(() => showExtraDeck(this.player));
  }
  if (this.ui && typeof this.ui.bindBotExtraDeckClick === "function") {
    this.ui.bindBotExtraDeckClick(() => showExtraDeck(this.bot));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Modal Close Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindGraveyardModalClose === "function") {
    this.ui.bindGraveyardModalClose(() => {
      this.closeGraveyardModal();
    });
  }

  if (this.ui && typeof this.ui.bindExtraDeckModalClose === "function") {
    this.ui.bindExtraDeckModalClose(() => {
      this.closeExtraDeckModal();
    });
  }

  if (this.ui && typeof this.ui.bindModalOverlayClick === "function") {
    this.ui.bindModalOverlayClick((modalKind) => {
      if (modalKind === "graveyard") {
        this.closeGraveyardModal();
      }
      if (modalKind === "extradeck") {
        this.closeExtraDeckModal();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Global Keyboard Shortcuts
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindGlobalKeydown === "function") {
    this.ui.bindGlobalKeydown((e) => {
      if (e.key === "Escape") {
        if (this.graveyardSelection) {
          this.closeGraveyardModal();
        } else {
          this.cancelTargetSelection();
        }
      }
    });
  }
}
