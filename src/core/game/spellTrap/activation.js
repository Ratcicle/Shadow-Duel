// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/activation.js
// Spell/Trap activation methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

import {
  canActivateSetQuickSpell,
  canActivateQuickSpellFromHand,
  isQuickSpell,
} from "./quickSpellRules.js";
import { getUIText } from "../../i18n.js";

function getSpellTrapSelectionMessage(card) {
  if (card?.cardKind === "spell") {
    if (card.subtype === "continuous") {
      return getUIText("ui.spell.continuousSelection");
    }
    if (card.subtype === "field") {
      return getUIText("ui.spell.fieldSelection");
    }
    return getUIText("ui.spell.spellSelection");
  }
  return getUIText("ui.spell.spellTrapSelection");
}

export async function presentSpellTrapActivationFlip(
  card,
  owner,
  activationZone = "spellTrap",
  options = {},
) {
  if (!card || !owner || activationZone !== "spellTrap") return false;
  if (!Array.isArray(owner.spellTrap) || !owner.spellTrap.includes(card)) {
    return false;
  }

  const zoneIndex = owner.spellTrap.indexOf(card);
  const boardPresentation = this.updateBoard?.(options.updateOptions || {});
  const flipPresentation = this.ui?.applySpellTrapFlipAnimation?.(
    owner.id,
    zoneIndex,
    {
      deferFrames: Number.isFinite(options.deferFrames)
        ? options.deferFrames
        : 1,
    },
  );

  const presentations = [boardPresentation, flipPresentation].filter(
    (presentation) =>
      presentation && typeof presentation.then === "function",
  );
  if (presentations.length === 0) return false;

  await Promise.allSettled(presentations);
  return true;
}

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
    return this.createActionResult({
      reason: "effects_disabled",
      code: "EFFECTS_DISABLED",
    });
  }
  if (!card) {
    return this.createActionResult({
      reason: "invalid_card",
      code: "INVALID_CARD",
    });
  }
  const owner =
    options.owner ||
    (card.owner === "bot" ? this.bot : this.player) ||
    this.player;
  if (!owner) {
    return this.createActionResult({
      reason: "invalid_owner",
      code: "INVALID_OWNER",
    });
  }
  this.devLog?.("SPELL_TRAP_ACTIVATION_ATTEMPT", {
    summary: card.name,
    card: card.name,
    owner: owner.id || null,
    zone: "spellTrap",
  });

  const isTrap = card.cardKind === "trap";
  const quickSpellActivationFromSet =
    isQuickSpell(card) &&
    card.isFacedown === true &&
    owner.spellTrap?.includes?.(card);
  const quickSpellContext = quickSpellActivationFromSet
    ? {
        ...(options.quickSpellContext || {}),
        activationZone: "spellTrap",
      }
    : null;
  const guardConfig = isTrap
    ? {
        actor: owner,
        kind: "trap_activation",
        phaseReq: ["main1", "battle", "main2"],
      }
    : quickSpellActivationFromSet
    ? {
        actor: owner,
        kind: "quick_spell_activation",
        phaseReq: null,
      }
    : {
        actor: owner,
        kind: "spelltrap_effect",
        phaseReq: ["main1", "main2"],
      };

  const guard = this.guardActionStart(guardConfig);
  if (!guard.ok) return this.normalizeActivationResult(guard);

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
        quickSpellActivationFromSet,
        quickSpellContext,
      },
      ...(quickSpellContext ? { quickSpellContext } : {}),
    },
  );
  if (preview && preview.ok === false) {
    if (preview.reason) {
      this.ui.log(preview.reason);
    }
    return this.normalizeActivationResult(preview);
  }

  // If it's a trap, show confirmation modal first
  const trapActivationFromSet =
    card.cardKind === "trap" && card.isFacedown === true;
  const fieldActivationFromSet =
    trapActivationFromSet || quickSpellActivationFromSet;
  const fieldActivationSnapshot = fieldActivationFromSet
    ? {
        card,
        owner,
        zone: "spellTrap",
        wasFacedown: card.isFacedown,
        previousTurnSetOn: card.turnSetOn,
        previousSetTurn: card.setTurn,
      }
    : null;
  if (card.cardKind === "trap") {
    const confirmed = await this.ui.showTrapActivationModal(
      card,
      "manual_activation",
    );

    if (!confirmed) {
      this.devLog?.("TRAP_ACTIVATION_CANCELLED", {
        summary: card.name,
        card: card.name,
        owner: owner.id || null,
      });
      return this.createActionResult({
        cancelled: true,
        reason: "cancelled",
        code: "CANCELLED",
      });
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
    quickSpellActivationFromSet,
    quickSpellContext,
  };
  const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
    card,
    { fromHand: false, activationZone: "spellTrap", trapActivationFromSet },
  );

  const pipelineQuickSpellContext = quickSpellActivationFromSet
    ? {
        ...(quickSpellContext || {}),
        activationZone: "spellTrap",
        effect: activationEffect,
      }
    : null;
  const pipelinePhaseReq = isTrap
    ? ["main1", "battle", "main2"]
    : quickSpellActivationFromSet
    ? null
    : ["main1", "main2"];

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner,
    activationZone: "spellTrap",
    activationContext,
    selections,
    selectionKind: "spellTrapEffect",
    selectionMessage: getSpellTrapSelectionMessage(card),
    guardKind: isTrap
      ? "trap_activation"
      : quickSpellActivationFromSet
      ? "quick_spell_activation"
      : "spelltrap_effect",
    phaseReq: pipelinePhaseReq,
    gate: quickSpellActivationFromSet
      ? () =>
          canActivateSetQuickSpell(
            this,
            card,
            owner,
            pipelineQuickSpellContext,
          )
      : null,
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
          { activationContext: info.activationContext },
        );
        this.ui.log(`${card.name} effect activated.`);
      }
      this.updateBoard();
    },
    onFailure: (result) => {
      if (fieldActivationSnapshot) {
        this.rollbackFieldSpellTrapActivation?.(
          fieldActivationSnapshot,
          result,
        );
      }
    },
    onCancel: () => {
      if (fieldActivationSnapshot) {
        this.rollbackFieldSpellTrapActivation?.(
          fieldActivationSnapshot,
          "cancelled",
        );
      }
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
    await this.finalizeSpellTrapActivation(card, owner, activationZone, {
      activationContext: info.activationContext,
    });
    this.ui?.log?.(
      result?.success === false
        ? `${card.name} failed to resolve.`
        : activationLog || `${card.name} effect activated.`,
    );
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
  if (this.disableEffectActivation) {
    this.ui?.log?.("Effect activations are disabled.");
    return this.createActionResult({
      reason: "effects_disabled",
      code: "EFFECTS_DISABLED",
    });
  }
  if (!card) {
    return this.createActionResult({
      reason: "invalid_card",
      code: "INVALID_CARD",
    });
  }
  const owner = options.owner || this.player;
  if (!owner) {
    return this.createActionResult({
      reason: "invalid_owner",
      code: "INVALID_OWNER",
    });
  }
  const resume = options.resume || null;
  const actionContext = options.actionContext || null;
  const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
    card,
    { fromHand: true },
  );
  const quickSpellFromHand = isQuickSpell(card);
  const quickSpellContext = quickSpellFromHand
    ? {
        ...(options.quickSpellContext || {}),
        activationZone: "hand",
        effect: activationEffect,
      }
    : null;

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
        getUIText("ui.spell.noFusionMaterials"),
      );
      this.ui?.log?.(
        `${
          owner.name || "Jogador"
        } não pode ativar ${card.name}: sem materiais de fusão válidos.`,
      );
      return this.createActionResult({
        reason: "no_valid_fusion_materials",
        code: "NO_VALID_FUSION_MATERIALS",
      });
    }
  }

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner,
    selections,
    selectionKind: "spellTrapEffect",
    selectionMessage: getSpellTrapSelectionMessage(card),
    guardKind: "spell_from_hand",
    phaseReq: quickSpellFromHand ? null : ["main1", "main2"],
    gate:
      resume || !quickSpellFromHand
        ? null
        : () =>
            canActivateQuickSpellFromHand(
              this,
              card,
              owner,
              quickSpellContext,
            ),
    preview: resume
      ? null
      : () =>
          this.effectEngine?.canActivateSpellFromHandPreview?.(
            card,
            owner,
            quickSpellContext ? { quickSpellContext } : undefined,
          ),
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
      quickSpellContext,
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
  if (!card) {
    return this.createActionResult({
      reason: "invalid_card",
      code: "INVALID_CARD",
    });
  }
  const owner = card.owner === "player" ? this.player : this.bot;
  if (!owner) {
    return this.createActionResult({
      reason: "invalid_owner",
      code: "INVALID_OWNER",
    });
  }
  const guard = this.guardActionStart(
    {
      actor: owner,
      kind: "fieldspell_effect",
      phaseReq: ["main1", "main2"],
    },
    owner === this.player,
  );
  if (!guard.ok) return this.normalizeActivationResult(guard);
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
    selectionMessage: getUIText("ui.spell.fieldSelection"),
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
