import { isQuickSpell } from "../spellTrap/quickSpellRules.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../summon/tributeValue.js";
import { canUseNormalSummonForCard } from "../../Player.js";
import { getUIText } from "../../i18n.js";

/**
 * UI Interactions Module - Card interactions for the Shadow Duel game
 * Handles player hand, field, spell/trap zone, opponent zone, graveyard, and keyboard interactions
 * @module game/ui/interactions
 */

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
  const isMainPhase = () => this.phase === "main1" || this.phase === "main2";
  const getHandEffectButtonLabel = (effect, fallbackKey = "ui.summon.special") => {
    if (effect?.handModalLabel) return effect.handModalLabel;
    if (effect?.handModalLabelKey) {
      return getUIText(effect.handModalLabelKey, {}, effect.handModalLabelKey);
    }
    return getUIText(fallbackKey);
  };
  const getAvailableHandEffectChoices = (actor, card) => {
    if (!actor || !card || card.cardKind !== "monster") return [];
    const entries =
      this.effectEngine?.getActivatableMonsterIgnitionEffects?.(
        card,
        actor,
        "hand",
      ) || [];
    return entries
      .map(({ effect }) => {
        if (!effect?.id) return null;
        return {
          effectId: effect.id,
          label: getHandEffectButtonLabel(effect),
        };
      })
      .filter(Boolean);
  };
  const canNormalSummonFromHand = (actor, card, tributeInfo = null) => {
    if (!actor || !card || card.cardKind !== "monster") return false;
    if (card.cannotBeNormalSummonedOrSet) return false;
    if (card.summonRestrict === "shadow_heart_invocation_only") return false;
    if (!canUseNormalSummonForCard(actor, card)) return false;
    const info = tributeInfo || actor.getTributeRequirement?.(card);
    const tributesNeeded = Math.max(0, Number(info?.tributesNeeded || 0));
    const fieldCount = actor.field?.length || 0;
    if (!fieldHasTributeValue(actor.field || [], tributesNeeded, card)) {
      return false;
    }
    const minimumPhysicalTributes = tributesNeeded > 0 ? 1 : 0;
    return fieldCount - minimumPhysicalTributes + 1 <= 5;
  };
  const getSelectedTributeValue = (actor, summonState) =>
    getTributeValueTotal(
      getTributeCardsFromIndices(actor?.field || [], selectedTributes),
      summonState?.cardToSummon || null,
    );
  const hasSelectedRequiredTributeValue = (actor, summonState) =>
    getSelectedTributeValue(actor, summonState) >=
    Math.max(0, Number(summonState?.tributesNeeded || 0));
  const getTributeSelectionMessage = (summonState, actor) => {
    const required = Math.max(0, Number(summonState?.tributesNeeded || 0));
    const current = getSelectedTributeValue(actor, summonState);
    return `Select tribute monster(s). Tribute value: ${current}/${required}.`;
  };
  const syncPendingTributeSelectionState = () => {
    if (!tributeSelectionMode || !pendingSummon?.actor) {
      this.pendingTributeSummonSelection = null;
      return;
    }
    this.pendingTributeSummonSelection = {
      active: true,
      ownerId: pendingSummon.actor.id,
      cardIndex: pendingSummon.cardIndex,
      cardId: pendingSummon.cardToSummon?.id ?? null,
      cardName: pendingSummon.cardToSummon?.name || null,
      tributeableIndices: [...(pendingSummon.tributeableIndices || [])],
      selectedTributes: [...selectedTributes],
      tributesNeeded: pendingSummon.tributesNeeded || 0,
    };
  };
  const beginTributeSelection = (summonState, actor, tributeableIndices) => {
    tributeSelectionMode = true;
    selectedTributes = [];
    pendingSummon = {
      ...summonState,
      actor,
      tributeableIndices,
    };
    syncPendingTributeSelectionState();
  };
  const clearTributeSelection = () => {
    tributeSelectionMode = false;
    selectedTributes = [];
    pendingSummon = null;
    this.pendingTributeSummonSelection = null;
  };
  const buildQuickSpellHandContext = (card, actor) =>
    isQuickSpell(card)
      ? {
          activationZone: "hand",
          legalWindow: actor?.id === this.turn,
        }
      : null;
  const buildSetQuickSpellContext = (card, actor) =>
    isQuickSpell(card) && card?.isFacedown === true
      ? {
          activationZone: "spellTrap",
          legalWindow: actor?.id === this.turn,
        }
      : null;
  const getSpellHandPreview = (card, actor, quickSpellContext = null) =>
    this.effectEngine?.canActivateSpellFromHandPreview?.(
      card,
      actor,
      quickSpellContext ? { quickSpellContext } : undefined,
    ) || { ok: true };
  const emitAfterSummonAfterPresentation = async (payload) => {
    this.updateBoard();
    await this.waitForBoardPresentation?.();
    await this.emit("after_summon", payload);
    this.updateBoard();
  };
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
  const isManualFieldQuickEffect = (effect) =>
    !!effect && (effect.isQuickEffect === true || Number(effect.speed) === 2);
  const getManualFieldQuickEffectEntry = (actor, card) => {
    if (!actor || !card || card.cardKind !== "monster") return null;
    const entry =
      this.effectEngine?.getFirstActivatableMonsterIgnitionEffect?.(
        card,
        actor,
        "field",
        {
          activationContext: {
            activationZone: "field",
            legalWindow:
              actor.id === this.turn && this.phase === "battle",
            context:
              this.phase === "battle"
                ? {
                    type: "battle_step_open",
                    legalWindow: actor.id === this.turn,
                  }
                : null,
          },
        },
      ) || null;
    if (!entry?.preview?.ok || !isManualFieldQuickEffect(entry.effect)) {
      return null;
    }
    return entry;
  };
  const getAttackCandidates = (opponent) => {
    const opponentTargets = (opponent?.field || []).filter(
      (card) => card && card.cardKind === "monster",
    );
    const forcedTargets = opponentTargets.filter((card) =>
      this.isActiveAttackPriorityTarget
        ? this.isActiveAttackPriorityTarget(card)
        : card.mustBeAttacked && !card.isFacedown,
    );
    return forcedTargets.length ? forcedTargets : opponentTargets;
  };
  const canDeclareAttackFromField = (actor, opponent, attacker) => {
    if (!actor || !attacker || this.phase !== "battle") return { ok: false };
    const guard = this.canStartAction?.({
      actor,
      kind: "attack",
      phaseReq: "battle",
      silent: true,
    });
    if (guard && !guard.ok) return guard;
    const availability = this.getAttackAvailability(attacker);
    if (!availability.ok) return availability;

    let attackCandidates = getAttackCandidates(opponent);
    if (attacker.canAttackAllOpponentMonstersThisTurn) {
      const attackedMonsters = attacker.attackedMonstersThisTurn || new Set();
      attackCandidates = attackCandidates.filter((card) => {
        const cardId = card.instanceId || card.id || card.name;
        return !attackedMonsters.has(cardId);
      });
    }

    const usingMonsterOnlyExtraAttack =
      (attacker.attacksUsedThisTurn || 0) > 0 &&
      (attacker.extraAttackTargetRestriction ||
        attacker.passiveExtraAttackTargetRestriction) === "monster";
    const canDirect =
      !attacker.cannotAttackDirectly &&
      !actor?.forbidDirectAttacksThisTurn &&
      !attacker.canAttackAllOpponentMonstersThisTurn &&
      !usingMonsterOnlyExtraAttack &&
      (attacker.canAttackDirectlyThisTurn === true ||
        attackCandidates.length === 0);
    if (attackCandidates.length === 0 && !canDirect) {
      return {
        ok: false,
        reason: "No valid attack targets and cannot attack directly!",
      };
    }
    return { ok: true, attackCandidates };
  };
  const startAttackFromField = (actor, opponent, attacker) => {
    const guard = this.guardActionStart({
      actor,
      kind: "attack",
      phaseReq: "battle",
    });
    if (!guard.ok) return true;
    const attackCheck = canDeclareAttackFromField(actor, opponent, attacker);
    if (!attackCheck.ok) {
      if (attackCheck.reason) this.ui.log(attackCheck.reason);
      return true;
    }
    this.startAttackTargetSelection(attacker, attackCheck.attackCandidates);
    return true;
  };
  const showBattleMonsterQuickEffectChoice = (
    cardEl,
    actor,
    opponent,
    card,
    quickEntry,
  ) => {
    const attackCheck = canDeclareAttackFromField(actor, opponent, card);
    this.ui.showPositionChoiceModal(
      cardEl,
      card,
      async (choice) => {
        if (choice === "declare_attack") {
          startAttackFromField(actor, opponent, card);
        }
      },
      {
        hasIgnitionEffect: true,
        onActivateEffect: () =>
          this.tryActivateMonsterEffect(card, null, "field", actor, {
            effectId: quickEntry.effect.id,
            activationContext: {
              context: {
                type: "battle_step_open",
                legalWindow: actor.id === this.turn,
              },
            },
          }),
        canDeclareAttack: attackCheck.ok,
        onDeclareAttack: () => startAttackFromField(actor, opponent, card),
      },
    );
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

      const tributeInfo = actor.getTributeRequirement(card);
      const tributesNeeded = tributeInfo.tributesNeeded;
      const handEffectChoices = getAvailableHandEffectChoices(actor, card);
      const canUseHandEffect = handEffectChoices.length > 0;

      if (
        !canUseHandEffect &&
        tributesNeeded > 0 &&
        !fieldHasTributeValue(actor.field || [], tributesNeeded, card)
      ) {
        this.ui.log(`Not enough tributes for Level ${card.level} monster.`);
        return true;
      }

      this.ui.showSummonModal(
        index,
        async (choice) => {
          if (
            choice === "special_from_void_forgotten" ||
            choice === "special_from_hand_effect" ||
            choice?.type === "hand_effect"
          ) {
            const effectId =
              choice?.effectId || handEffectChoices[0]?.effectId || null;
            this.tryActivateMonsterEffect(card, null, "hand", actor, {
              effectId,
            });
            return;
          }
          if (choice !== "attack" && choice !== "defense") return;

          const position = choice;
          const isFacedown = choice === "defense";
          if (tributesNeeded > 0) {
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
            beginTributeSelection(
              {
                opponent,
                cardIndex: index,
                position,
                isFacedown,
                tributesNeeded,
                cardToSummon: card,
              },
              actor,
              tributeableIndices,
            );
            setLaboratoryTributeHighlight(actor, tributeableIndices);
            this.ui.log(getTributeSelectionMessage(pendingSummon, actor));
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
          await emitAfterSummonAfterPresentation({
            card: summonedCard,
            player: actor,
            opponent,
            method: "normal",
            fromZone: "hand",
            tributes,
          });
        },
        {
          canNormalSummon: canNormalSummonFromHand(actor, card, tributeInfo),
          canSet: canNormalSummonFromHand(actor, card, tributeInfo),
          specialSummonFromHand: false,
          handEffectChoices,
          specialSummonFromHandEffect:
            canUseHandEffect && handEffectChoices.length === 0,
          ownerId: actor.id,
        }
      );
      return true;
    }

    if (card.cardKind === "spell") {
      const quickSpellContext = buildQuickSpellHandContext(card, actor);
      const quickSpellOnlyActivationWindow =
        !!quickSpellContext && !isMainPhase();
      const guard = this.guardActionStart({
        actor,
        kind: "spell_from_hand",
        phaseReq: quickSpellContext ? null : ["main1", "main2"],
      });
      if (!guard.ok) return true;
      const spellPreview = getSpellHandPreview(card, actor, quickSpellContext);
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
      const activateSpell = () =>
        this.tryActivateSpell(card, index, null, {
          owner: actor,
          ...(quickSpellContext ? { quickSpellContext } : {}),
        });

      if (quickSpellOnlyActivationWindow) {
        if (!canActivateFromHand) {
          if (spellPreview.reason) this.ui.log(spellPreview.reason);
          return true;
        }
        if (this.ui && typeof this.ui.showSpellChoiceModal === "function") {
          this.ui.showSpellChoiceModal(
            index,
            (choice) => {
              if (choice === "activate") {
                activateSpell();
              }
            },
            {
              canActivate: true,
              canSet: false,
              ownerId: actor.id,
            },
          );
        } else {
          activateSpell();
        }
        return true;
      }
      this.ui.showSpellChoiceModal(
        index,
        async (choice) => {
          if (choice === "activate" && canActivateFromHand) {
            activateSpell();
          } else if (choice === "set") {
            await this.setSpellOrTrap(card, index, actor);
          }
        },
        { canActivate: canActivateFromHand, canSet: true, ownerId: actor.id }
      );
      return true;
    }

    if (card.cardKind === "trap") {
      await this.setSpellOrTrap(card, index, actor);
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
      } else if (selectedTributes.length < allowed.length) {
        selectedTributes.push(index);
      }
      syncPendingTributeSelectionState();
      setLaboratoryTributeHighlight(actor, allowed, selectedTributes);
      this.ui.log(getTributeSelectionMessage(pendingSummon, actor));
      if (hasSelectedRequiredTributeValue(actor, pendingSummon)) {
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
          clearTributeSelection();
          this.updateBoard();
          return true;
        }
        const summonedCard = actor.field[actor.field.length - 1];
        const tributes = summonResult.tributes || [];
        summonedCard.summonedTurn = this.turnCounter;
        summonedCard.positionChangedThisTurn = false;
        summonedCard.setTurn = summonedCard.isFacedown ? this.turnCounter : null;
        clearTributeSelection();
        await emitAfterSummonAfterPresentation({
          card: summonedCard,
          player: actor,
          opponent,
          method: tributes.length > 0 ? "tribute" : "normal",
          fromZone: "hand",
          tributes,
        });
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
      const ignitionPreview =
        this.effectEngine?.canActivateMonsterEffectPreview?.(
          card,
          actor,
          "field",
        ) || { ok: false };
      const hasIgnition = !!ignitionPreview.ok;
      const canFlip = this.canFlipSummon(card);
      const canPosChange = this.canChangePosition(card);
      const materialCheck = this.canUseAsAscensionMaterial(actor, card);
      const hasAscension =
        materialCheck.ok &&
        this
          .getAscensionCandidatesForMaterial(actor, card)
          .some((asc) => this.checkAscensionRequirements(actor, asc, card).ok);
      if (hasIgnition || canFlip || canPosChange || hasAscension) {
        this.ui.showPositionChoiceModal(
          cardEl,
          card,
          async (choice) => {
            if (choice === "flip" && canFlip) {
              await this.flipSummon(card);
            } else if (choice === "to_attack" && canPosChange) {
              await this.changeMonsterPosition(card, "attack");
            } else if (choice === "to_defense" && canPosChange) {
              await this.changeMonsterPosition(card, "defense");
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
    const quickEntry = getManualFieldQuickEffectEntry(actor, attacker);
    if (quickEntry) {
      showBattleMonsterQuickEffectChoice(
        cardEl,
        actor,
        opponent,
        attacker,
        quickEntry,
      );
      return true;
    }
    return startAttackFromField(actor, opponent, attacker);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Player Hand Click
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindPlayerHandClick === "function") {
    this.ui.bindPlayerHandClick(async (e, cardEl, index) => {
      if (this.targetSelection) {
        if (handleDirectAttackHandClick("player", e)) return;
        this.handleTargetSelectionClick("player", index, cardEl, "hand");
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

        const tributeInfo = this.player.getTributeRequirement(card);
        const tributesNeeded = tributeInfo.tributesNeeded;
        const handEffectChoices = getAvailableHandEffectChoices(
          this.player,
          card,
        );
        const canUseHandEffect = handEffectChoices.length > 0;

        if (
          !canUseHandEffect &&
          tributesNeeded > 0 &&
          !fieldHasTributeValue(this.player.field || [], tributesNeeded, card)
        ) {
          this.ui.log(`Not enough tributes for Level ${card.level} monster.`);
          return;
        }

        this.ui.showSummonModal(
          index,
          async (choice) => {
            if (choice === "special_from_void_forgotten") {
              this.tryActivateMonsterEffect(card, null, "hand");
              return;
            }

            if (
              choice === "special_from_hand_effect" ||
              choice?.type === "hand_effect"
            ) {
              this.devLog?.("HAND_EFFECT", {
                summary: `Activating hand effect for ${card.name}`,
              });
              const effectId =
                choice?.effectId || handEffectChoices[0]?.effectId || null;
              this.tryActivateMonsterEffect(card, null, "hand", this.player, {
                effectId,
              });
              return;
            }
            if (choice === "attack" || choice === "defense") {
              const position = choice;
              const isFacedown = choice === "defense";

              if (tributesNeeded > 0) {
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

                beginTributeSelection(
                  {
                    cardIndex: index,
                    position,
                    isFacedown,
                    tributesNeeded,
                    cardToSummon: card,
                    altTribute: tributeInfo.usingAlt ? tributeInfo.alt : null,
                  },
                  this.player,
                  tributeableIndices,
                );
                if (
                  this.ui &&
                  typeof this.ui.setPlayerFieldTributeable === "function"
                ) {
                  this.ui.setPlayerFieldTributeable(
                    pendingSummon.tributeableIndices
                  );
                }

                this.ui.log(
                  getTributeSelectionMessage(pendingSummon, this.player)
                );
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
                await emitAfterSummonAfterPresentation({
                  card: summonedCard,
                  player: this.player,
                  method: "normal",
                  fromZone: "hand",
                  tributes: tributes,
                });
              }
            }
          },
          {
            canNormalSummon: canNormalSummonFromHand(
              this.player,
              card,
              tributeInfo,
            ),
            canSet: canNormalSummonFromHand(this.player, card, tributeInfo),
            specialSummonFromHand: false,
            handEffectChoices,
            specialSummonFromHandEffect:
              canUseHandEffect && handEffectChoices.length === 0,
          }
        );
        return;
      }

      if (card.cardKind === "spell") {
        const quickSpellContext = buildQuickSpellHandContext(card, this.player);
        const quickSpellOnlyActivationWindow =
          !!quickSpellContext && !isMainPhase();
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "spell_from_hand",
          phaseReq: quickSpellContext ? null : ["main1", "main2"],
        });
        if (!guard.ok) return;

        // Check for fusion spell (has polymerization_fusion_summon action) - generic instead of hardcoded name
        const spellPreview = getSpellHandPreview(
          card,
          this.player,
          quickSpellContext,
        );
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

        const activateSpell = () =>
          this.tryActivateSpell(
            card,
            index,
            null,
            quickSpellContext ? { quickSpellContext } : {},
          );

        if (quickSpellOnlyActivationWindow) {
          if (!canActivateFromHand) {
            if (spellPreview.reason) this.ui.log(spellPreview.reason);
            return;
          }
          if (this.ui && typeof this.ui.showSpellChoiceModal === "function") {
            this.ui.showSpellChoiceModal(
              index,
              (choice) => {
                if (choice === "activate") {
                  activateSpell();
                }
              },
              { canActivate: true, canSet: false },
            );
          } else {
            activateSpell();
          }
          return;
        }

        const handleSpellChoice = async (choice) => {
          if (choice === "activate" && canActivateFromHand) {
            activateSpell();
          } else if (choice === "set") {
            await this.setSpellOrTrap(card, index);
          }
        };

        if (this.ui && typeof this.ui.showSpellChoiceModal === "function") {
          this.ui.showSpellChoiceModal(index, handleSpellChoice, {
            canActivate: canActivateFromHand,
            canSet: true,
          });
        } else {
          const shouldActivate =
            (await this.ui?.showConfirmPrompt?.(
              "OK: Activate this Spell. Cancel: Set it face-down in your Spell/Trap Zone.",
              { kind: "spell_choice", cardName: card.name }
            )) ?? false;
          await handleSpellChoice(shouldActivate ? "activate" : "set");
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
        await this.setSpellOrTrap(card, index);
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
        } else if (selectedTributes.length < allowed.length) {
          selectedTributes.push(index);
          if (this.ui && typeof this.ui.setPlayerFieldSelected === "function") {
            this.ui.setPlayerFieldSelected(index, true);
          }
        }
        syncPendingTributeSelectionState();

        this.ui.log(getTributeSelectionMessage(pendingSummon, this.player));

        if (hasSelectedRequiredTributeValue(this.player, pendingSummon)) {
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
            clearTributeSelection();
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

          const summonMethod =
            pendingSummon.tributesNeeded > 0 ? "tribute" : "normal";
          clearTributeSelection();

          await emitAfterSummonAfterPresentation({
            card: summonedCard,
            player: this.player,
            method: summonMethod,
            fromZone: "hand",
            tributes: tributes,
          });
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

        const ignitionPreview =
          this.effectEngine?.canActivateMonsterEffectPreview?.(
            card,
            this.player,
            "field",
          ) || { ok: false };
        const hasIgnition = !!ignitionPreview.ok;

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
            (asc) => this.checkAscensionRequirements(this.player, asc, card).ok
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
                await this.changeMonsterPosition(card, "attack");
              } else if (
                choice === "to_defense" &&
                canPosChange &&
                card.position !== "defense"
              ) {
                await this.changeMonsterPosition(card, "defense");
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
        const quickEntry = getManualFieldQuickEffectEntry(this.player, attacker);
        if (quickEntry) {
          showBattleMonsterQuickEffectChoice(
            cardEl,
            this.player,
            this.bot,
            attacker,
            quickEntry,
          );
          return;
        }
        startAttackFromField(this.player, this.bot, attacker);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Player Spell/Trap Zone Click
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindPlayerSpellTrapClick === "function") {
    this.ui.bindPlayerSpellTrapClick(async (e, cardEl, index) => {
      this.devLog?.("SPELL_TRAP_CLICK", {
        summary: `Spell/Trap zone clicked at index ${index}`,
      });

      if (this.targetSelection) {
        const handled = this.handleTargetSelectionClick(
          "player",
          index,
          cardEl,
          "spellTrap"
        );
        if (handled) return;
        this.devLog?.("SPELL_TRAP_CLICK", {
          summary: "Returning: targetSelection active",
        });
        return;
      }

      const card = this.player.spellTrap[index];
      if (!card) return;

      // During the opponent's turn, reactive activations are offered only by
      // ChainSystem. A board click must never manufacture a separate CL1.
      if (this.turn !== this.player.id) return;

      this.devLog?.("SPELL_TRAP_CLICK", {
        summary: `Clicked ${card.name}, facedown=${card.isFacedown}, kind=${card.cardKind}`,
      });

      // Handle traps - can be activated on opponent's turn and during battle phase
      if (card.cardKind === "trap") {
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "trap_activation",
          phaseReq: ["main1", "battle", "main2"],
        });
        if (!guard.ok) return;

        const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
          card,
          this.player,
          "spellTrap",
          null,
          {
            activationContext: {
              autoSelectSingleTarget: true,
              trapActivationFromSet: card.isFacedown === true,
            },
          },
        );
        if (preview && preview.ok === false) {
          if (
            preview.reason &&
            preview.reason !== "No ignition effect defined for this card."
          ) {
            this.ui.log(preview.reason);
          }
          return;
        }

        this.devLog?.("SPELL_TRAP_CLICK", {
          summary: `Activating trap: ${card.name}`,
        });
        await this.tryActivateSpellTrapEffect(card);
        return;
      }

      const setQuickSpellContext = buildSetQuickSpellContext(card, this.player);
      const guard = this.guardActionStart({
        actor: this.player,
        kind: setQuickSpellContext
          ? "quick_spell_activation"
          : "spelltrap_zone",
        phaseReq: setQuickSpellContext ? null : ["main1", "main2"],
      });
      if (!guard.ok) return;

      if (card.cardKind === "spell") {
        const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
          card,
          this.player,
          "spellTrap",
          null,
          {
            activationContext: {
              autoSelectSingleTarget: true,
              quickSpellActivationFromSet: !!setQuickSpellContext,
              quickSpellContext: setQuickSpellContext,
            },
            ...(setQuickSpellContext
              ? { quickSpellContext: setQuickSpellContext }
              : {}),
          }
        );
        if (preview && preview.ok === false) {
          if (preview.reason) {
            this.ui.log(preview.reason);
          }
          return;
        }
        this.devLog?.("SPELL_TRAP_CLICK", {
          summary: `Activating spell from zone: ${card.name}`,
        });
        await this.tryActivateSpellTrapEffect(
          card,
          null,
          setQuickSpellContext
            ? { quickSpellContext: setQuickSpellContext }
            : {},
        );
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
        });
        if (!guard.ok) return;

        const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
          card,
          this.bot,
          "spellTrap",
          null,
          {
            activationContext: {
              autoSelectSingleTarget: true,
              trapActivationFromSet: card.isFacedown === true,
            },
          },
        );
        if (preview && preview.ok === false) {
          if (
            preview.reason &&
            preview.reason !== "No ignition effect defined for this card."
          ) {
            this.ui.log(preview.reason);
          }
          return;
        }

        await this.tryActivateSpellTrapEffect(card, null, { owner: this.bot });
        return;
      }
      const setQuickSpellContext = buildSetQuickSpellContext(card, this.bot);
      const guard = this.guardActionStart({
        actor: this.bot,
        kind: setQuickSpellContext
          ? "quick_spell_activation"
          : "spelltrap_zone",
        phaseReq: setQuickSpellContext ? null : ["main1", "main2"],
      });
      if (!guard.ok) return;
      const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        this.bot,
        "spellTrap",
        null,
        {
          activationContext: {
            autoSelectSingleTarget: true,
            quickSpellActivationFromSet: !!setQuickSpellContext,
            quickSpellContext: setQuickSpellContext,
          },
          ...(setQuickSpellContext
            ? { quickSpellContext: setQuickSpellContext }
            : {}),
        }
      );
      if (preview && preview.ok === false) {
        if (preview.reason) this.ui.log(preview.reason);
        return;
      }
      await this.tryActivateSpellTrapEffect(card, null, {
        owner: this.bot,
        ...(setQuickSpellContext ? { quickSpellContext: setQuickSpellContext } : {}),
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bot Hand Click (Direct Attack via target selection)
  // ─────────────────────────────────────────────────────────────────────────────
  if (this.ui && typeof this.ui.bindBotHandClick === "function") {
    this.ui.bindBotHandClick(async (e, cardEl, index) => {
      if (this.targetSelection) {
        if (handleDirectAttackHandClick("bot", e)) return;
        this.handleTargetSelectionClick("bot", index, cardEl, "hand");
        return;
      }
      await handleLaboratoryHandClick(this.bot, index);
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
      if (this.turn !== this.player.id) return;
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
