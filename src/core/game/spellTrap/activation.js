// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/activation.js
// Spell/Trap activation methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unified activation of spell/trap effects from field.
 * @param {Card} card - The card being activated.
 * @param {Object} selections - Pre-selected targets if any.
 * @returns {Promise<Object>} Activation result with potential async selections.
 */
export async function tryActivateSpellTrapEffect(
  card,
  selections = null,
  options = {},
) {
  if (this.disableEffectActivation || this.disableTraps) {
    this.ui?.log?.("Spell/Trap activations are disabled in network mode.");
    return { success: false, reason: "effects_disabled" };
  }
  if (!card) return;
  const owner =
    options.owner ||
    (card.owner === "bot" ? this.bot : this.player) ||
    this.player;
  console.log(`[Game] tryActivateSpellTrapEffect called for: ${card.name}`);

  // Traps can be activated on opponent's turn and during battle phase
  const isTrap = card.cardKind === "trap";
  const guardConfig = isTrap
    ? {
        actor: owner,
        kind: "trap_activation",
        phaseReq: ["main1", "battle", "main2"],
        allowDuringOpponentTurn: true,
      }
    : {
        actor: owner,
        kind: "spelltrap_effect",
        phaseReq: ["main1", "main2"],
      };

  const guard = this.guardActionStart(guardConfig);
  if (!guard.ok) return guard;

  const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
    card,
    owner,
    "spellTrap",
    selections,
    {
      activationContext: {
        autoSelectSingleTarget: true,
        trapActivationFromSet:
          card.cardKind === "trap" && card.isFacedown === true,
      },
    },
  );
  if (preview && preview.ok === false) {
    if (preview.reason) {
      this.ui.log(preview.reason);
    }
    return preview;
  }

  // If it's a trap, show confirmation modal first
  const trapActivationFromSet =
    card.cardKind === "trap" && card.isFacedown === true;
  if (card.cardKind === "trap") {
    const confirmed = await this.ui.showTrapActivationModal(
      card,
      "manual_activation",
    );

    if (!confirmed) {
      console.log(`[Game] User cancelled trap activation`);
      return;
    }

    // Flip the trap face-up after confirmation
    if (card.isFacedown) {
      card.isFacedown = false;
      this.ui.log(`${owner.name} ativa ${card.name}!`);
      this.updateBoard();
    }
  }

  const activationContext = {
    fromHand: false,
    activationZone: "spellTrap",
    sourceZone: "spellTrap",
    committed: false,
    trapActivationFromSet,
  };
  const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
    card,
    { fromHand: false, trapActivationFromSet },
  );

  const pipelinePhaseReq = isTrap
    ? ["main1", "battle", "main2"]
    : ["main1", "main2"];

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner,
    activationZone: "spellTrap",
    activationContext,
    selections,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Select target(s) for the continuous spell effect.",
    guardKind: isTrap ? "trap_activation" : "spelltrap_effect",
    phaseReq: pipelinePhaseReq,
    allowDuringOpponentTurn: isTrap,
    oncePerTurn: {
      card,
      player: owner,
      effect: activationEffect,
    },
    activate: (chosen, ctx, zone) =>
      this.effectEngine.activateSpellTrapEffect(
        card,
        owner,
        chosen,
        zone,
        ctx,
      ),
    finalize: async (result, info) => {
      if (result.placementOnly) {
        this.ui.log(`${card.name} is placed on the field.`);
      } else {
        await this.finalizeSpellTrapActivation(
          card,
          owner,
          info.activationZone,
        );
        this.ui.log(`${card.name} effect activated.`);
      }
      this.updateBoard();
    },
  });
  return pipelineResult;
}

/**
 * Complete a Spell card activation after the activation pipeline resolves.
 * This keeps hand Spell activations observable for triggers and analytics
 * across manual play and AI execution.
 */
export async function finalizeSpellCardActivation(
  result = {},
  info = {},
  options = {},
) {
  const card = info.card || options.card || null;
  const owner = info.owner || options.owner || null;
  const activationZone = info.activationZone || options.activationZone || null;
  if (!card || !owner) return;

  const placementOnly = result?.placementOnly === true;
  const placementLog =
    typeof options.placementLog === "function"
      ? options.placementLog(card, info)
      : options.placementLog;
  const activationLog =
    typeof options.activationLog === "function"
      ? options.activationLog(card, info)
      : options.activationLog;

  if (placementOnly) {
    this.ui?.log?.(placementLog || `${card.name} is placed on the field.`);
  } else {
    await this.finalizeSpellTrapActivation(card, owner, activationZone);
    this.ui?.log?.(activationLog || `${card.name} effect activated.`);
  }

  await this.emit("spell_activated", {
    card,
    player: owner,
    fromHand: options.fromHand ?? info.activationContext?.fromHand ?? false,
    activationZone,
    placementOnly,
    effect: options.effect || null,
  });

  if (!placementOnly && options.offerChainWindow !== false) {
    await this.checkAndOfferTraps("card_activation", {
      card,
      player: owner,
      activationType: "spell",
    });
  }

  this.updateBoard();
}

/**
 * Attempts to activate a spell card from hand.
 * @param {Card} card - The card to activate.
 * @param {number} handIndex - Index of the card in the player's hand.
 * @param {Object} selections - Pre-selected targets if any.
 * @param {Object} options - Activation options.
 * @returns {Promise<Object>} Activation result.
 */
export async function tryActivateSpell(
  card,
  handIndex,
  selections = null,
  options = {},
) {
  const owner = options.owner || this.player;
  const resume = options.resume || null;
  const actionContext = options.actionContext || null;
  const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
    card,
    { fromHand: true },
  );

  const resumeCommitInfo = resume?.commitInfo || null;
  const resolvedActivationZone =
    resume?.activationZone || resumeCommitInfo?.activationZone || null;
  const baseActivationContext = resume?.activationContext || {
    fromHand: true,
    activationZone: resolvedActivationZone,
    sourceZone: "hand",
    committed: false,
    commitInfo: resumeCommitInfo,
    actionContext,
  };

  // VALIDAÇÃO EXTRA: Fusion spells require valid fusion materials
  // Generic check using action type instead of hardcoded card name
  const hasFusionAction = (card.effects || []).some(
    (e) =>
      e &&
      Array.isArray(e.actions) &&
      e.actions.some((a) => a && a.type === "polymerization_fusion_summon"),
  );
  if (hasFusionAction && !resume) {
    if (!this.canActivatePolymerization?.(owner)) {
      this.ui?.showMessage?.(
        "Você não tem materiais válidos para Fusion Summon!",
      );
      this.ui?.log?.(
        `${
          owner.name || "Jogador"
        } não pode ativar ${card.name}: sem materiais de fusão válidos.`,
      );
      return {
        success: false,
        reason: "no_valid_fusion_materials",
      };
    }
  }

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner,
    selections,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Select target(s) for the continuous spell effect.",
    guardKind: "spell_from_hand",
    phaseReq: ["main1", "main2"],
    preview: resume
      ? null
      : () => this.effectEngine?.canActivateSpellFromHandPreview?.(card, owner),
    commit: resume
      ? () =>
          resumeCommitInfo || {
            cardRef: card,
            activationZone: resolvedActivationZone || "spellTrap",
            fromIndex: handIndex,
          }
      : () => this.commitCardActivationFromHand(owner, handIndex),
    activationContext: {
      ...baseActivationContext,
      committed: resume ? true : baseActivationContext.committed,
      activationZone:
        resolvedActivationZone || baseActivationContext.activationZone,
      sourceZone: baseActivationContext.sourceZone || "hand",
      commitInfo: baseActivationContext.commitInfo || resumeCommitInfo || null,
      actionContext,
    },
    oncePerTurn: {
      card,
      player: owner,
      effect: activationEffect,
    },
    activate: (chosen, ctx, zone, resolvedCard) =>
      this.effectEngine.activateSpellTrapEffect(
        resolvedCard,
        owner,
        chosen,
        zone,
        ctx,
      ),
    finalize: async (result, info) => {
      await this.finalizeSpellCardActivation(result, info, {
        owner,
        fromHand: baseActivationContext.fromHand,
        effect: activationEffect,
        placementLog: `${info.card.name} is placed on the field.`,
        activationLog: `${info.card.name} effect activated.`,
      });
    },
  });
  return pipelineResult;
}

/**
 * Activates a field spell effect (already on field).
 * @param {Card} card - The field spell card.
 * @returns {Object} Activation result.
 */
export function activateFieldSpellEffect(card) {
  const owner = card.owner === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    {
      actor: owner,
      kind: "fieldspell_effect",
      phaseReq: ["main1", "main2"],
    },
    owner === this.player,
  );
  if (!guard.ok) return guard;
  const activationContext = {
    fromHand: false,
    activationZone: "fieldSpell",
    sourceZone: "fieldSpell",
    committed: false,
  };
  const activationEffect =
    this.effectEngine?.getFieldSpellActivationEffect?.(card);
  const pipelineResult = this.runActivationPipeline({
    card,
    owner,
    activationZone: "fieldSpell",
    activationContext,
    selectionKind: "fieldSpell",
    selectionMessage: "Select target(s) for the field spell effect.",
    guardKind: "fieldspell_effect",
    phaseReq: ["main1", "main2"],
    preview: () =>
      this.effectEngine?.canActivateFieldSpellEffectPreview?.(card, owner),
    oncePerTurn: {
      card,
      player: owner,
      effect: activationEffect,
    },
    activate: (selections, ctx) =>
      this.effectEngine.activateFieldSpell(card, owner, selections, ctx),
    finalize: () => {
      this.ui.log(`${card.name} field effect activated.`);
      this.queueVisualFeedback?.({
        kind: "effect-activation",
        sourceCard: card,
        ownerId: owner.id,
        fromZone: "fieldSpell",
        tone: "gold",
      });
      this.updateBoard();
    },
  });
  return pipelineResult;
}
