// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/ui/indicators.js
// Activation indicator methods for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

import { isQuickSpell } from "../spellTrap/quickSpellRules.js";
import type {
  GameCard,
  GamePlayer,
} from "../../contracts/gameRuntime.js";
import type { GamePhase } from "../../contracts/game.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { ActionGuardResult } from "../actions/guard.js";

interface ActivationPreview {
  ok: boolean;
  reason?: string | null;
}

interface ActivatableEffectEntry {
  effect: EffectDefinition;
  preview: ActivationPreview;
}

interface IndicatorEffectEnginePort {
  canActivateSpellFromHandPreview?(
    card: GameCard,
    player: GamePlayer,
    options: unknown,
  ): ActivationPreview;
  getFirstActivatableMonsterIgnitionEffect?(
    card: GameCard,
    player: GamePlayer,
    zone: "hand" | "field",
    options: unknown,
  ): ActivatableEffectEntry | null;
  canActivateMonsterEffectPreview?(
    card: GameCard,
    player: GamePlayer,
    zone: "hand" | "field" | "graveyard",
    selections: null,
    options: unknown,
  ): ActivationPreview;
  getMonsterIgnitionEffect?(
    card: GameCard,
    zone: "field",
    options: unknown,
  ): EffectDefinition | null;
  canActivateSpellTrapEffectPreview?(
    card: GameCard,
    player: GamePlayer,
    zone: "spellTrap" | "graveyard",
    selections: null,
    options: unknown,
  ): ActivationPreview;
  canActivateFieldSpellEffectPreview?(
    card: GameCard,
    player: GamePlayer,
    selections: null,
    options: unknown,
  ): ActivationPreview;
}

interface ActivationHint {
  canActivate: boolean;
  label: string;
}

export interface ActivationIndicators {
  hand: Record<number, ActivationHint>;
  field: Record<number, ActivationHint>;
  spellTrap: Record<number, ActivationHint>;
  graveyard: Record<number, ActivationHint>;
  fieldSpell: ActivationHint | null;
  zones: {
    graveyard: boolean;
    extraDeck: boolean;
  };
}

interface IndicatorUiPort {
  applyActivationIndicators(
    ownerId: "player",
    indicators: ActivationIndicators,
  ): void;
}

interface IndicatorHost {
  player: GamePlayer;
  turn: "player" | "bot";
  phase: GamePhase;
  ui?: IndicatorUiPort;
  effectEngine?: IndicatorEffectEnginePort;
  buildActivationIndicatorsForPlayer(
    player: GamePlayer,
  ): ActivationIndicators | null;
  canStartAction(options: {
    actor: GamePlayer;
    kind: string;
    phaseReq: readonly GamePhase[] | null;
    silent: true;
    allowDuringOpponentTurn?: boolean;
  }): ActionGuardResult;
  canActivatePolymerization(): boolean;
  canSummonExtraDeckCard?(
    card: GameCard,
    player: GamePlayer,
    options: { silent: true },
  ): { ok: boolean } | null;
}

/**
 * Updates activation indicators for the player's cards.
 */
export function updateActivationIndicators(this: IndicatorHost) {
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
 * @returns Indicators map by zone and index.
 */
export function buildActivationIndicatorsForPlayer(
  this: IndicatorHost,
  player: GamePlayer | null | undefined,
): ActivationIndicators | null {
  if (!player || player.id !== "player") return null;

  const activationContext = {
    autoSelectSingleTarget: false,
    logTargets: false,
  };

  const mapGuardHint = (guard: ActionGuardResult): string | null => {
    if (!guard || guard.ok) return null;
    if (guard.code === "BLOCKED_WRONG_PHASE") {
      return "bloqueado por fase";
    }
    if (guard.code === "BLOCKED_NOT_YOUR_TURN") {
      return "fora do seu turno";
    }
    return null;
  };

  const mapReasonHint = (reason: string | null | undefined): string | null => {
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

  const canStart = (
    kind: string,
    phaseReq: readonly GamePhase[] | null,
    extra: { allowDuringOpponentTurn?: boolean } = {},
  ) =>
    this.canStartAction({
      actor: player,
      kind,
      phaseReq,
      silent: true,
      ...extra,
    });

  const buildHint = (
    guard: ActionGuardResult,
    preview: ActivationPreview | null | undefined,
    readyLabel: string,
  ): ActivationHint | null => {
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

  const indicators: ActivationIndicators = {
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

  (player.hand || []).forEach((card: GameCard, index: number) => {
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
        (e: EffectDefinition) =>
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

  (player.field || []).forEach((card: GameCard, index: number) => {
    if (!card || card.cardKind !== "monster") return;
    const fieldActivationContext = {
      ...activationContext,
      activationZone: "field",
      legalWindow: player.id === this.turn && this.phase === "battle",
      context:
        this.phase === "battle"
          ? {
              type: "battle_step_open",
              legalWindow: player.id === this.turn,
            }
          : null,
    };
    const firstActivatable =
      this.effectEngine?.getFirstActivatableMonsterIgnitionEffect?.(
        card,
        player,
        "field",
        { activationContext: fieldActivationContext },
      );
    const previewEffect =
      firstActivatable?.effect ||
      this.effectEngine?.getMonsterIgnitionEffect?.(card, "field", {
        activationContext: fieldActivationContext,
      }) ||
      null;
    const isQuickFieldEffect =
      previewEffect?.isQuickEffect === true || Number(previewEffect?.speed) === 2;
    const guard = canStart(
      "monster_effect",
      isQuickFieldEffect ? ["main1", "battle", "main2"] : ["main1", "main2"],
    );
    const preview =
      firstActivatable?.preview ||
      this.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        player,
        "field",
        null,
        { activationContext: fieldActivationContext },
      ) ||
      { ok: false };
    const hint = buildHint(guard, preview, "ignition disponivel");
    if (hint) {
      indicators.field[index] = hint;
    }
  });

  (player.spellTrap || []).forEach((card: GameCard, index: number) => {
    if (!card) return;
    const isTrap = card.cardKind === "trap";
    const setQuickSpellContext =
      isQuickSpell(card) && card.isFacedown === true
        ? {
            activationZone: "spellTrap",
            legalWindow: player.id === this.turn,
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

  (player.graveyard || []).forEach((card: GameCard, index: number) => {
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

  indicators.zones.extraDeck = (player.extraDeck || []).some((card: GameCard) => {
    return (
      this.canSummonExtraDeckCard?.(card, player, {
        silent: true,
      })?.ok === true
    );
  });

  return indicators;
}
