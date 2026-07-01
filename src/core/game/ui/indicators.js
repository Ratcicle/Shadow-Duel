// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/ui/indicators.js
// Activation indicator methods for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

import { isQuickSpell } from "../spellTrap/quickSpellRules.js";

/**
 * Updates activation indicators for the player's cards.
 */
export function updateActivationIndicators() {
  if (!this.ui || typeof this.ui.applyActivationIndicators !== "function") {
    return;
  }

  const indicators = this.buildActivationIndicatorsForPlayer(this.player);
  if (!indicators) return;
  this.ui.applyActivationIndicators("player", indicators);
}

/**
 * Builds activation indicator data for a player's cards.
 * @param {Player} player - The player to build indicators for.
 * @returns {Object|null} Indicators map by zone and index.
 */
export function buildActivationIndicatorsForPlayer(player) {
  if (!player || player.id !== "player") return null;

  const activationContext = {
    autoSelectSingleTarget: false,
    logTargets: false,
  };

  const mapGuardHint = (guard) => {
    if (!guard || guard.ok) return null;
    if (guard.code === "BLOCKED_WRONG_PHASE") {
      return "bloqueado por fase";
    }
    if (guard.code === "BLOCKED_NOT_YOUR_TURN") {
      return "fora do seu turno";
    }
    return null;
  };

  const mapReasonHint = (reason) => {
    if (!reason) return null;
    const lower = reason.toLowerCase();
    if (lower.includes("1/turn") || lower.includes("once per turn")) {
      return "1/turn ja usado";
    }
    if (lower.includes("main phase") || lower.includes("phase")) {
      return "bloqueado por fase";
    }
    if (lower.includes("no valid targets")) {
      return "sem alvos validos";
    }
    if (lower.includes("not your turn")) {
      return "fora do seu turno";
    }
    return null;
  };

  const canStart = (kind, phaseReq, extra = {}) =>
    this.canStartAction({
      actor: player,
      kind,
      phaseReq,
      silent: true,
      ...extra,
    });

  const buildHint = (guard, preview, readyLabel) => {
    const guardHint = mapGuardHint(guard);
    if (guardHint) {
      return { canActivate: false, label: guardHint };
    }
    if (!preview) return null;
    if (preview.ok) {
      return { canActivate: true, label: readyLabel };
    }
    const reasonHint = mapReasonHint(preview.reason);
    if (reasonHint) {
      return { canActivate: false, label: reasonHint };
    }
    return null;
  };

  const indicators = {
    hand: {},
    field: {},
    spellTrap: {},
    graveyard: {},
    fieldSpell: null,
    zones: {
      graveyard: false,
      extraDeck: false,
    },
  };

  (player.hand || []).forEach((card, index) => {
    if (!card) return;
    if (card.cardKind === "spell") {
      const quickSpellContext = isQuickSpell(card)
        ? {
            activationZone: "hand",
            legalWindow: player.id === this.turn,
          }
        : null;
      const guard = canStart(
        "spell_from_hand",
        quickSpellContext ? null : ["main1", "main2"],
      );
      const preview = this.effectEngine?.canActivateSpellFromHandPreview?.(
        card,
        player,
        {
          activationContext,
          ...(quickSpellContext ? { quickSpellContext } : {}),
        }
      ) || { ok: false };
      let ok = !!preview.ok;
      // Check for fusion spell (has polymerization_fusion_summon action) - generic instead of hardcoded name
      const hasFusionAction = (card.effects || []).some(
        (e) =>
          e &&
          Array.isArray(e.actions) &&
          e.actions.some((a) => a && a.type === "polymerization_fusion_summon")
      );
      if (ok && hasFusionAction) {
        ok = this.canActivatePolymerization();
      }
      const previewResult = { ...preview, ok };
      const hint = buildHint(guard, previewResult, "ativacao disponivel");
      if (!hint && hasFusionAction && !ok) {
        indicators.hand[index] = {
          canActivate: false,
          label: "sem materiais de fusao",
        };
        return;
      }
      if (hint) {
        indicators.hand[index] = hint;
      }
    } else if (card.cardKind === "monster") {
      const guard = canStart("monster_effect", ["main1", "main2"]);
      const firstActivatable =
        this.effectEngine?.getFirstActivatableMonsterIgnitionEffect?.(
          card,
          player,
          "hand",
          { activationContext },
        );
      const preview =
        firstActivatable?.preview ||
        this.effectEngine?.canActivateMonsterEffectPreview?.(
          card,
          player,
          "hand",
          null,
          { activationContext },
        ) ||
        { ok: false };
      const hint = buildHint(guard, preview, "ignition disponivel");
      if (hint) {
        indicators.hand[index] = hint;
      }
    }
  });

  (player.field || []).forEach((card, index) => {
    if (!card || card.cardKind !== "monster") return;
    const guard = canStart("monster_effect", ["main1", "main2"]);
    const firstActivatable =
      this.effectEngine?.getFirstActivatableMonsterIgnitionEffect?.(
        card,
        player,
        "field",
        { activationContext },
      );
    const preview =
      firstActivatable?.preview ||
      this.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        player,
        "field",
        null,
        { activationContext },
      ) ||
      { ok: false };
    const hint = buildHint(guard, preview, "ignition disponivel");
    if (hint) {
      indicators.field[index] = hint;
    }
  });

  (player.spellTrap || []).forEach((card, index) => {
    if (!card) return;
    const isTrap = card.cardKind === "trap";
    const setQuickSpellContext =
      isQuickSpell(card) && card.isFacedown === true
        ? {
            activationZone: "spellTrap",
            legalWindow: true,
          }
        : null;
    const guard = canStart(
      isTrap
        ? "trap_activation"
        : setQuickSpellContext
        ? "quick_spell_activation"
        : "spelltrap_effect",
      isTrap
        ? ["main1", "battle", "main2"]
        : setQuickSpellContext
        ? null
        : ["main1", "main2"],
      setQuickSpellContext ? { allowDuringOpponentTurn: true } : {},
    );
    const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
      card,
      player,
      "spellTrap",
      null,
      {
        activationContext: {
          ...activationContext,
          trapActivationFromSet: isTrap && card.isFacedown === true,
          quickSpellActivationFromSet: !!setQuickSpellContext,
          quickSpellContext: setQuickSpellContext,
        },
        ...(setQuickSpellContext
          ? { quickSpellContext: setQuickSpellContext }
          : {}),
      }
    ) || { ok: false };
    const hint = buildHint(guard, preview, "ignition disponivel");
    if (hint) {
      indicators.spellTrap[index] = hint;
    }
  });

  if (player.fieldSpell) {
    const guard = canStart("fieldspell_effect", ["main1", "main2"]);
    const preview = this.effectEngine?.canActivateFieldSpellEffectPreview?.(
      player.fieldSpell,
      player,
      null,
      { activationContext }
    ) || { ok: false };
    const hint = buildHint(guard, preview, "ignition disponivel");
    if (hint) {
      indicators.fieldSpell = hint;
    }
  }

  (player.graveyard || []).forEach((card, index) => {
    if (!card) return;
    const guard = canStart("graveyard_effect", ["main1", "main2"]);
    const preview =
      card.cardKind === "monster"
        ? this.effectEngine?.canActivateMonsterEffectPreview?.(
            card,
            player,
            "graveyard",
            null,
            { activationContext },
          ) || { ok: false }
        : card.cardKind === "spell" || card.cardKind === "trap"
          ? this.effectEngine?.canActivateSpellTrapEffectPreview?.(
              card,
              player,
              "graveyard",
              null,
              { activationContext },
            ) || { ok: false }
          : { ok: false };
    const hint = buildHint(guard, preview, "efeito disponivel no cemiterio");
    if (hint) {
      indicators.graveyard[index] = hint;
    }
  });

  indicators.zones.graveyard = Object.values(indicators.graveyard).some(
    (hint) => hint?.canActivate,
  );

  indicators.zones.extraDeck = (player.extraDeck || []).some((card) => {
    return (
      this.canSummonExtraDeckCard?.(card, player, {
        silent: true,
      })?.ok === true
    );
  });

  return indicators;
}
