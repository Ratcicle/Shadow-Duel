// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/ui/indicators.js
// Activation indicator methods for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

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

  const canStart = (kind, phaseReq) =>
    this.canStartAction({
      actor: player,
      kind,
      phaseReq,
      silent: true,
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
    fieldSpell: null,
  };

  (player.hand || []).forEach((card, index) => {
    if (!card) return;
    if (card.cardKind === "spell") {
      const guard = canStart("spell_from_hand", ["main1", "main2"]);
      const preview = this.effectEngine?.canActivateSpellFromHandPreview?.(
        card,
        player,
        {
          activationContext,
        }
      ) || { ok: false };
      let ok = !!preview.ok;
      if (ok && card.name === "Polymerization") {
        ok = this.canActivatePolymerization();
      }
      const previewResult = { ...preview, ok };
      const hint = buildHint(guard, previewResult, "ativacao disponivel");
      if (!hint && card.name === "Polymerization" && !ok) {
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
      const preview = this.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        player,
        "hand",
        null,
        { activationContext }
      ) || { ok: false };
      const hint = buildHint(guard, preview, "ignition disponivel");
      if (hint) {
        indicators.hand[index] = hint;
      }
    }
  });

  (player.field || []).forEach((card, index) => {
    if (!card || card.cardKind !== "monster") return;
    const guard = canStart("monster_effect", ["main1", "main2"]);
    const preview = this.effectEngine?.canActivateMonsterEffectPreview?.(
      card,
      player,
      "field",
      null,
      { activationContext }
    ) || { ok: false };
    const hint = buildHint(guard, preview, "ignition disponivel");
    if (hint) {
      indicators.field[index] = hint;
    }
  });

  (player.spellTrap || []).forEach((card, index) => {
    if (!card) return;
    const guard = canStart("spelltrap_effect", ["main1", "main2"]);
    const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
      card,
      player,
      "spellTrap",
      null,
      { activationContext }
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

  return indicators;
}
