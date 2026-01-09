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
export async function tryActivateSpellTrapEffect(card, selections = null) {
  if (this.disableEffectActivation || this.disableTraps) {
    this.ui?.log?.("Spell/Trap activations are disabled in network mode.");
    return { success: false, reason: "effects_disabled" };
  }
  if (!card) return;
  console.log(`[Game] tryActivateSpellTrapEffect called for: ${card.name}`);

  // Traps can be activated on opponent's turn and during battle phase
  const isTrap = card.cardKind === "trap";
  const guardConfig = isTrap
    ? {
        actor: this.player,
        kind: "trap_activation",
        phaseReq: ["main1", "battle", "main2"],
        allowDuringOpponentTurn: true,
      }
    : {
        actor: this.player,
        kind: "spelltrap_effect",
        phaseReq: ["main1", "main2"],
      };

  const guard = this.guardActionStart(guardConfig);
  if (!guard.ok) return guard;

  // If it's a trap, show confirmation modal first
  if (card.cardKind === "trap") {
    const confirmed = await this.ui.showTrapActivationModal(
      card,
      "manual_activation"
    );

    if (!confirmed) {
      console.log(`[Game] User cancelled trap activation`);
      return;
    }

    // Flip the trap face-up after confirmation
    if (card.isFacedown) {
      card.isFacedown = false;
      this.ui.log(`${this.player.name} ativa ${card.name}!`);
      this.updateBoard();
    }
  }

  const activationContext = {
    fromHand: false,
    activationZone: "spellTrap",
    sourceZone: "spellTrap",
    committed: false,
  };
  const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
    card,
    { fromHand: false }
  );

  const pipelinePhaseReq = isTrap
    ? ["main1", "battle", "main2"]
    : ["main1", "main2"];

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner: this.player,
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
      player: this.player,
      effect: activationEffect,
    },
    activate: (chosen, ctx, zone) =>
      this.effectEngine.activateSpellTrapEffect(
        card,
        this.player,
        chosen,
        zone,
        ctx
      ),
    finalize: (result, info) => {
      if (result.placementOnly) {
        this.ui.log(`${card.name} is placed on the field.`);
      } else {
        this.finalizeSpellTrapActivation(
          card,
          this.player,
          info.activationZone
        );
        this.ui.log(`${card.name} effect activated.`);
      }
      this.updateBoard();
    },
  });
  return pipelineResult;
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
  options = {}
) {
  const owner = options.owner || this.player;
  const resume = options.resume || null;
  const actionContext = options.actionContext || null;
  const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
    card,
    { fromHand: true }
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

  // VALIDAÇÃO EXTRA: Polymerization requer materiais válidos
  if (card.name === "Polymerization" && !resume) {
    if (!this.canActivatePolymerization?.()) {
      this.ui?.showMessage?.(
        "Você não tem materiais válidos para Fusion Summon!"
      );
      this.ui?.log?.(
        `${
          owner.name || "Jogador"
        } não pode ativar Polymerization: sem materiais de fusão válidos.`
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
        ctx
      ),
    finalize: async (result, info) => {
      if (result.placementOnly) {
        this.ui.log(`${info.card.name} is placed on the field.`);
      } else {
        this.finalizeSpellTrapActivation(info.card, owner, info.activationZone);
        this.ui.log(`${info.card.name} effect activated.`);

        // Emitir evento para captura de replay
        this.emit("spell_activated", {
          card: info.card,
          player: owner,
          fromHand: baseActivationContext.fromHand,
          activationZone: info.activationZone,
        });

        // Offer chain window for opponent to respond to spell activation
        await this.checkAndOfferTraps("card_activation", {
          card: info.card,
          player: owner,
          activationType: "spell",
        });
      }
      this.updateBoard();
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
    owner === this.player
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
    oncePerTurn: {
      card,
      player: owner,
      effect: activationEffect,
    },
    activate: (selections, ctx) =>
      this.effectEngine.activateFieldSpell(card, owner, selections, ctx),
    finalize: () => {
      this.ui.log(`${card.name} field effect activated.`);
      this.updateBoard();
    },
  });
  return pipelineResult;
}
