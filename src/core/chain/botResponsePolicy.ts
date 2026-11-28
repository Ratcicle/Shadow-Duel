import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";
import { normalizeChainResponseCandidate } from "../game/decisions/chainResponse.js";
import type {
  ChainActivationCandidate,
  ChainEffect,
  ChainGamePort,
  ChainPlayer,
  ChainRuntimePort,
  ChainStrategyPort,
  ChainStrategyResponse,
  FastEffectContextInput,
} from "../contracts/chainRuntime.js";
import type { ActionType } from "../contracts/actions.js";

/**
 * Quick Spell bonus of the generic fallback score. A strategy pack whose
 * fallbackPriorityAdjustments aim at an absolute final score for a Quick
 * Spell derives its adjustment from this value.
 */
export const GENERIC_QUICK_SPELL_RESPONSE_PRIORITY = 10;

function getStrategyForPlayer(
  game: ChainGamePort | null,
  player: ChainPlayer,
): ChainStrategyPort | null {
  if (player?.strategy) return player.strategy;
  if (game?.bot?.id && game.bot.id === player?.id) return game.bot.strategy || null;
  if (game?.player?.id && game.player.id === player?.id) {
    return game.player.strategy || null;
  }
  return null;
}

function buildResponseContext(
  baseContext: FastEffectContextInput,
  response: ChainStrategyResponse,
): FastEffectContextInput {
  const activationContext =
    response?.activationContext ||
    response?.context?.activationContext ||
    baseContext?.activationContext ||
    null;
  if (!activationContext) return response?.context || baseContext;
  return {
    ...(baseContext || {}),
    ...(response?.context || {}),
    _chainRootContext: baseContext || response?.context || null,
    activationContext,
  };
}

/** Adjustment a strategy hook declared for one offered candidate, if any. */
function fallbackPriorityAdjustment(
  adjustments: Readonly<Record<string, number>> | null,
  candidateKey: string,
): number | null {
  if (!adjustments || !Object.hasOwn(adjustments, candidateKey)) return null;
  const value = adjustments[candidateKey];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function effectHasAction(effect: ChainEffect | null | undefined, type: ActionType): boolean {
  return (effect?.actions || []).some(action => action?.type === type);
}

/**
 * Bot AI for choosing chain response
 * @param {Object} player
 * @param {Array} activatable
 * @param {ChainContext} context
 * @returns {Promise<Object|null>}
 */
export async function botChooseChainResponse(
  this: ChainRuntimePort,
  player: ChainPlayer,
  activatable: ChainActivationCandidate[],
  context: FastEffectContextInput,
): Promise<ChainActivationCandidate | null> {
  if (!activatable || activatable.length === 0) return null;

  const game = this.game;
  const opponent = this.getOpponent(player);
  const strategy = getStrategyForPlayer(game, player);
  let priorityAdjustments: Readonly<Record<string, number>> | null = null;
  if (typeof strategy?.chooseChainResponse === "function") {
    const strategyResponse = await strategy.chooseChainResponse({
      chainSystem: this,
      game,
      player,
      opponent,
      activatable,
      context,
    });
    if (strategyResponse?.pass === true) {
      this.log?.(
        `Bot strategy passing chain response${
          strategyResponse.reason ? ` (${strategyResponse.reason})` : ""
        }`,
      );
      return null;
    }
    if (strategyResponse?.card && strategyResponse?.effect) {
      const canonicalChoice = activatable.find(
        (candidate) =>
          (!strategyResponse.candidateKey || candidate.candidateKey === strategyResponse.candidateKey) &&
          candidate.card === strategyResponse.card && candidate.effect === strategyResponse.effect,
      );
      if (!canonicalChoice) {
        this.game?.notify?.("ai_activation_rejected", {
          playerId: player?.id || null,
          candidateKey: strategyResponse.candidateKey || null,
          effectId: strategyResponse.effect?.id || null,
          reason: "choice_not_in_canonical_candidate_list",
        });
        return null;
      }
      const responseContext = buildResponseContext(canonicalChoice.context, strategyResponse);
      const normalized = normalizeChainResponseCandidate(canonicalChoice, {
        ...canonicalChoice,
        context: responseContext,
      });
      if (!normalized) {
        // The strategy chose a canonical candidate but changed its context in a
        // way the contract refuses; the choice becomes a pass, now observable.
        this.game?.notify?.("ai_activation_rejected", {
          playerId: player?.id || null,
          candidateKey: canonicalChoice.candidateKey,
          effectId: canonicalChoice.effectId,
          reason: "choice_not_normalizable",
        });
      }
      return normalized;
    }
    if (strategyResponse?.declinedCandidateKeys?.length) {
      const declined = new Set(strategyResponse.declinedCandidateKeys);
      activatable = activatable.filter(candidate => !declined.has(candidate.candidateKey));
      if (activatable.length === 0) return null;
    }
    priorityAdjustments = strategyResponse?.fallbackPriorityAdjustments ?? null;
  }

  // Evaluate each activatable card for strategic value
  const evaluatedOptions = activatable.map((option) => {
    let priority = 0;
    const card = option.card;
    const effect = option.effect;

    // Counter Traps: highest priority against important plays
    if (card.subtype === "counter" || effect?.speed === 3) {
      priority += 100;
    }

    // Destroy-all-attackers trap: High priority when opponent attacks with multiple monsters
    if (
      effectHasAction(effect, "mirror_force_destroy_all") &&
      context?.type === "attack_declaration"
    ) {
      const opponentAttackMonsters =
        opponent?.field?.filter(
          (m) => m && !m.isFacedown && m.position === "attack",
        ).length || 0;
      priority += 50 + opponentAttackMonsters * 20;
    }

    // Revive-and-bind trap: Value based on graveyard monsters
    if (effectHasAction(effect, "call_of_haunted_summon_and_bind")) {
      const graveyardMonsters =
        player?.graveyard?.filter((c) => c.cardKind === "monster").length ||
        0;
      const bestMonsterAtk = Math.max(
        ...(player?.graveyard || [])
          .filter((c) => c.cardKind === "monster")
          .map((c) => c.atk || 0),
        0,
      );
      priority +=
        30 +
        Math.min(graveyardMonsters * 5, 25) +
        Math.floor(bestMonsterAtk / 100);
    }

    // General trap value: consider game state
    if (card.cardKind === "trap") {
      // Higher priority if we're behind on field presence
      const myFieldCount = player?.field?.filter((m) => m).length || 0;
      const oppFieldCount = opponent?.field?.filter((m) => m).length || 0;
      if (oppFieldCount > myFieldCount) {
        priority += 15;
      }

      // Higher priority if LP is low
      if (player?.lp < 2000) {
        priority += 20;
      }
    }

    if (isQuickSpell(card)) priority += GENERIC_QUICK_SPELL_RESPONSE_PRIORITY;

    // Archetype knowledge lives in the strategy packs; they only shift the
    // generic score, and this fallback still ranks and rolls.
    const adjustment = fallbackPriorityAdjustment(priorityAdjustments, option.candidateKey);
    if (adjustment !== null) priority += adjustment;

    return { ...option, priority };
  });

  // Sort by priority (highest first)
  evaluatedOptions.sort((a, b) => b.priority - a.priority);

  // Get best option
  const bestOption = evaluatedOptions[0]!;

  // Se a melhor opção tem priority <= 0, passar automaticamente
  if (bestOption.priority <= 0) {
    this.log(
      `Bot passing (best option priority: ${bestOption.priority} - too low)`,
    );
    return null;
  }

  // Activation threshold based on priority
  // High priority (70+): 80% chance to activate
  // Medium priority (40-69): 50% chance to activate
  // Low priority (1-39): 20% chance to activate
  let activationChance = 0.2;
  if (bestOption.priority >= 70) {
    activationChance = 0.8;
  } else if (bestOption.priority >= 40) {
    activationChance = 0.5;
  }

  // AI rolls use the seeded AI stream and never the rules RNG, which is part
  // of the replay state hash. A host without aiRandom uses the fixed midpoint
  // 0.5, so priority >= 70 always activates and lower priorities never do.
  const randomValue =
    typeof game?.aiRandom === "function" ? game.aiRandom() : 0.5;
  if (randomValue < activationChance) {
    this.log(
      `Bot activating ${bestOption.card.name} (priority: ${bestOption.priority})`,
    );

    // Phase 4: the activation transaction owns cost and target selection for
    // both human and AI responders.
    return bestOption;
  }

  this.log(`Bot passing (best option priority: ${bestOption.priority})`);
  return null;
}
