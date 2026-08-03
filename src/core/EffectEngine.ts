import {
  ActionHandlerRegistry,
  registerDefaultHandlers,
} from "./ActionHandlers.js";
import { attachEffectModules } from "./effects/attachModules.js";
import { canUseOncePerDuelEffect } from "./effects/triggers/registration.js";
import type Game from "./Game.js";
import type {
  ActionRuntimeCard,
  ActionRuntimePlayer,
  EffectContext,
} from "./contracts/actionRuntime.js";
import type { EffectDefinition } from "./contracts/effects.js";
import type { ZoneInput } from "./contracts/zones.js";
import type { EffectModuleMethods } from "./effects/attachModules.js";

type UsageEntry = number | { turn?: number; count?: number };
type UsageMap = Record<string, UsageEntry>;

type RuntimeUsageCard = ActionRuntimeCard & {
  oncePerTurnUsageByName?: UsageMap;
};

type RuntimeUsagePlayer = ActionRuntimePlayer & {
  oncePerTurnUsageByName?: UsageMap;
};

type RuntimeUsageEffect = EffectDefinition & {
  readonly usesPerTurn?: number;
  readonly maxUsesPerTurn?: number;
};

interface LegacyEffectCondition {
  readonly requires?: string;
  readonly triggerArchetype?: string;
}

class EffectEngine {
  declare game: Game;
  declare actionHandlers: ActionHandlerRegistry;
  declare _targetingCache: Map<string, unknown>;
  declare _targetingCacheHits: number;
  declare _targetingCacheMisses: number;

  constructor(game: Game) {
    this.game = game;

    // Initialize action handler registry
    this.actionHandlers = new ActionHandlerRegistry();
    registerDefaultHandlers(this.actionHandlers);

    // Cache de targeting para evitar buscas redundantes
    // Formato: { "cacheKey": { zoneName, candidates, timestamp } }
    this._targetingCache = new Map<string, unknown>();
    this._targetingCacheHits = 0;
    this._targetingCacheMisses = 0;

    // Track per-card counters for special summon by type (used by passives like Metal Armored Dragon)
    // Defer listener registration until game is fully initialized
    if (game && typeof game.on === "function") {
      game.on("after_summon", (payload: object) => {
        this.handleSpecialSummonTypeCounters(payload);
        this.handleFieldPresenceTypeSummonCounters(payload);
      });
    }
  }

  get ui() {
    return this.game?.ui || this.game?.renderer || null;
  }

  /**
   * Limpa o cache de targeting. Deve ser chamado:
   * - No início de cada turno
   * - Após ações que modificam o estado do jogo (summon, destroy, move)
   */
  clearTargetingCache() {
    if (this._targetingCache) {
      this._targetingCache.clear();
    }
  }

  /**
   * Log de estatísticas do cache (para debug).
   */
  logTargetingCacheStats() {
    const hits = this._targetingCacheHits || 0;
    const misses = this._targetingCacheMisses || 0;
    const total = hits + misses;
    if (total > 0) {
      const hitRate = ((hits / total) * 100).toFixed(1);
      console.log(
        `[TargetingCache] Hits: ${hits} | Misses: ${misses} | Hit Rate: ${hitRate}%`,
      );
    }
  }

  /**
   * Check if card's effects are currently negated
   * @param {Object} card - The card to check
   * @returns {boolean} - True if effects are negated
   */
  isEffectNegated(
    card: ActionRuntimeCard | null | undefined,
  ): boolean | null | undefined {
    return card && card.effectsNegated === true;
  }

  checkOncePerTurn(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    effect: EffectDefinition | null | undefined,
  ) {
    const restrictionCheck =
      this.game?.canActivateCardEffectUnderRestrictions?.(card, player, effect, {
        silent: true,
      });
    if (restrictionCheck?.ok === false) return restrictionCheck;
    if (!effect || !effect.oncePerTurn) {
      return { ok: true };
    }
    if (!this.game || typeof this.game.canUseOncePerTurn !== "function") {
      console.error(
        "[EffectEngine] checkOncePerTurn: Game instance or canUseOncePerTurn not available",
      );
      return { ok: false, reason: "Game not initialized" };
    }
    return this.game.canUseOncePerTurn(card, player, effect);
  }

  checkOncePerDuel(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    effect: EffectDefinition,
  ) {
    return canUseOncePerDuelEffect(card, player, effect);
  }

  checkEffectCondition(
    condition: LegacyEffectCondition | null | undefined,
    sourceCard: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    summonedCard: ActionRuntimeCard,
    sourceZone: ZoneInput | null | undefined,
    summonFromZone: ZoneInput | null | undefined,
  ): boolean {
    if (!condition) return true;

    if (condition.requires === "self_in_hand") {
      const isCurrentlyInHand =
        sourceZone === "hand" && player?.hand?.includes(sourceCard);
      const wasSummonedFromHand =
        summonFromZone === "hand" && summonedCard === sourceCard;
      if (!isCurrentlyInHand && !wasSummonedFromHand) return false;
    }

    if (condition.triggerArchetype) {
      const archetypes = summonedCard.archetypes
        ? summonedCard.archetypes
        : summonedCard.archetype
          ? [summonedCard.archetype]
          : [];
      if (!archetypes.includes(condition.triggerArchetype)) {
        return false;
      }
    }

    return true;
  }

  canUseOncePerTurn(
    effect: RuntimeUsageEffect | null | undefined,
    ctx: EffectContext,
  ): boolean {
    if (!effect || !effect.oncePerTurn) return true;
    const player = ctx?.player as RuntimeUsagePlayer | null | undefined;
    const card = ctx?.source as RuntimeUsageCard | null | undefined;
    if (!player) return true;
    if (this.game && typeof this.game.canUseOncePerTurn === "function") {
      return this.game.canUseOncePerTurn(card, player, effect).ok === true;
    }
    const key = effect.oncePerTurnName || effect.id || ctx?.source?.name;
    if (!key) return true;
    const useCardScope =
      effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard;
    const usage = useCardScope
      ? card?.oncePerTurnUsageByName || {}
      : player.oncePerTurnUsageByName || {};
    const currentTurn = this.game?.turnCounter || 0;
    const limit = Math.max(
      1,
      Math.floor(
        Number(
          effect.oncePerTurnLimit ??
            effect.usesPerTurn ??
            effect.maxUsesPerTurn ??
            1,
        ),
      ) || 1,
    );
    const entry = usage[key];
    const used =
      entry === currentTurn
        ? 1
        : entry && typeof entry === "object" && Number(entry.turn) === currentTurn
          ? Math.max(0, Math.floor(Number(entry.count ?? 0)) || 0)
          : 0;
    return used < limit;
  }

  markOncePerTurn(
    effect: RuntimeUsageEffect | null | undefined,
    ctx: EffectContext,
  ): void {
    if (!effect || !effect.oncePerTurn) return;
    const player = ctx?.player as RuntimeUsagePlayer | null | undefined;
    const card = ctx?.source as RuntimeUsageCard | null | undefined;
    if (!player) return;
    if (this.game && typeof this.game.markOncePerTurnUsed === "function") {
      this.game.markOncePerTurnUsed(card, player, effect);
      return;
    }
    const key = effect.oncePerTurnName || effect.id || ctx?.source?.name;
    if (!key) return;
    const useCardScope =
      effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard;
    const currentTurn = this.game?.turnCounter || 0;
    const limit = Math.max(
      1,
      Math.floor(
        Number(
          effect.oncePerTurnLimit ??
            effect.usesPerTurn ??
            effect.maxUsesPerTurn ??
            1,
        ),
      ) || 1,
    );
    const mark = (usage: UsageMap): void => {
      const entry = usage[key];
      const used =
        entry === currentTurn
          ? 1
          : entry && typeof entry === "object" && Number(entry.turn) === currentTurn
            ? Math.max(0, Math.floor(Number(entry.count ?? 0)) || 0)
            : 0;
      usage[key] =
        limit <= 1
          ? currentTurn
          : { turn: currentTurn, count: Math.min(limit, used + 1) };
    };
    if (useCardScope && card) {
      card.oncePerTurnUsageByName = card.oncePerTurnUsageByName || {};
      mark(card.oncePerTurnUsageByName);
      return;
    }

    player.oncePerTurnUsageByName = player.oncePerTurnUsageByName || {};
    mark(player.oncePerTurnUsageByName);
  }
}

// Type-only declaration merge for methods installed by attachEffectModules().
// No class fields are emitted for the dynamically attached methods.
interface EffectEngine extends EffectModuleMethods {}

attachEffectModules(EffectEngine);

export default EffectEngine;
