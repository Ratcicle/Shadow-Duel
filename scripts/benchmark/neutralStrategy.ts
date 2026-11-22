import BaseStrategy from "../../src/core/ai/BaseStrategy.js";
import { canUseNormalSummonForCard } from "../../src/core/Player.js";
import { getTributeCardsFromIndices, getTributeValueTotal } from "../../src/core/game/summon/tributeValue.js";
import { buildStrategyAnalysis } from "../../src/core/ai/common/analysis.js";
import { getGenericHandSpellActions, getGenericHandSummonProcedureActions, getGenericIgnitionEffectActions,
  getGenericNormalSummonActions, getGenericSynchroActions } from "../../src/core/ai/common/actionGeneration.js";
import { getGenericSetBackrowActions } from "../../src/core/ai/common/backrowPlanning.js";
import { findIgnitionEffect, findSpellActivationEffect } from "../../src/core/ai/common/effectDiscovery.js";
import { buildAutoActivationContext } from "../../src/core/ai/common/preferencePolicy.js";
import { canActivateMonsterEffect, canActivateSpellFromHand, canActivateSpellTrapEffect } from "../../src/core/ai/common/previewGuards.js";
import { evaluateSimulatedConditions } from "../../src/core/ai/common/simulatedConditions.js";
import { resolvePerspectivePlayers } from "../../src/core/ai/common/perspective.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { getTributeRequirementFor, selectBestTributes, selectPayableTributes } from "../../src/core/ai/common/tributePolicy.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import type { RegisteredStrategyConstructor } from "../../src/core/ai/StrategyRegistry.js";
import type { AIAction, AIActivationContext, AIPlannedAction, AIState, AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import type { PlanningSimulationOptions } from "../../src/core/contracts/aiPlanning.js";
import type { AiCardInput, AiPlayerInput, SimulatedCardState, SimulatedPlayerState } from "../../src/core/contracts/aiState.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import type { CanonicalZone } from "../../src/core/contracts/zones.js";

// Diagnostic-only strategy of the benchmark harness (phase 2.4, A2). It is
// registered over a preset's id only inside the case worker that asks for it
// (--strategy-override P=neutral); the Arena, the duel and the strategy
// registry of every other process never load this module.
//
// Policy: legality plus one fixed generic priority per action family, with
// the shared generators and the shared simulation. No card, archetype or
// preset id, no Chain response hook, no own planning profile (BaseStrategy's
// profile keeps the turn-line search off) and no P2.

type EffectChoiceInput = {
  sourceCard?: AiCardInput; effect?: EffectDefinition | null | undefined;
  player?: AiPlayerInput; game?: AIState | undefined; activationZone?: CanonicalZone | "temporary" | null | undefined;
};

/** The fields this strategy reads of the engine's replacement question (zones/movement.ts, effects/destructionReplacement.ts). */
type ReplacementChoiceInput = {
  game?: { turnCounter?: number } | null; sourceCard?: object | null; targetCard?: object | null;
  kind?: string; context?: unknown;
};

/** Whether the send being asked about is `target` paying a cost of its own effect (effects/actions/movement.ts). */
function isOwnCostSend(context: unknown, target: object): boolean {
  if (!context || typeof context !== "object") return false;
  const options: unknown = Reflect.get(context, "moveOptions");
  if (!options || typeof options !== "object") return false;
  return Reflect.get(options, "contextLabel") === "cost" && Reflect.get(options, "sourceCard") === target;
}

/** Generic tribute value: ATK + DEF/2, the cheapest monsters go first. */
function neutralTributeValue(card: AiCardInput): number {
  return (card.atk || 0) + (card.def || 0) / 2;
}

function selectNeutralTributes<Card extends AiCardInput>(field: readonly Card[], count: number, cardToSummon: Card): number[] {
  return selectBestTributes(field, count, cardToSummon, {}, { evaluateCardValue: card => neutralTributeValue(card) });
}

export default class NeutralDiagnosticStrategy extends BaseStrategy {
  constructor(bot: AIStrategyBotPort) { super(bot); }

  /** Sources of the send-to-GY replacements accepted this turn. */
  private sendReplacementSources: { turn: number | null; cards: Set<object> } = { turn: null, cards: new Set() };

  /**
   * Accepts every legal replacement except a send-to-GY one that would protect a card while it
   * pays the cost of its own send-to-GY replacement accepted this turn: that use is still being
   * paid, so accepting would re-enter the same hook (zones/movement.ts marks the OPT after the cost).
   */
  shouldUseReplacementEffect({ game, sourceCard, targetCard, kind, context }: ReplacementChoiceInput = {}): boolean {
    if (kind !== "send_to_grave") return true;
    const turn = game?.turnCounter ?? null;
    if (this.sendReplacementSources.turn !== turn) this.sendReplacementSources = { turn, cards: new Set() };
    if (targetCard && this.sendReplacementSources.cards.has(targetCard) && isOwnCostSend(context, targetCard)) {
      this.sendReplacementSources.cards.delete(targetCard);
      return false;
    }
    if (sourceCard) this.sendReplacementSources.cards.add(sourceCard);
    return true;
  }

  override get archetypeLabel() { return "Neutral (diagnostic)"; }

  analyzeGameState(game: AIState) {
    const { self: player } = resolvePerspectivePlayers(game, this.bot);
    return buildStrategyAnalysis({ game, strategy: this, player: player || this.bot });
  }

  /** Automatic targets at execution (AutoSelector, bot only); no decision is precomputed. */
  buildActivationContextForEffect({ sourceCard, effect, activationZone }: EffectChoiceInput = {}): AIActivationContext | null {
    if (!sourceCard || !effect) return null;
    const zone = activationZone && activationZone !== "temporary" ? activationZone : null;
    return {
      ...buildAutoActivationContext({ zone, activationZone: zone, sourceZone: zone, fromHand: zone === "hand", autoSelectTargets: true }),
      effectId: effect.id,
    };
  }

  override generateMainPhaseActions(game: AIState): AIAction[] {
    const analysis = this.analyzeGameState(game);
    const player = analysis.player;
    if (!player || (game.phase !== "main1" && game.phase !== "main2") || game.turn !== player.id) return [];
    const { self: normalSummonPlayer } = resolvePerspectivePlayers(game, player);
    const context = (card: AiCardInput, effect: EffectDefinition | null, zone: CanonicalZone) =>
      this.buildActivationContextForEffect({ sourceCard: card, effect, player, game, activationZone: zone });
    const useful = (card: AiCardInput, effect: EffectDefinition) => {
      if (card.effectsNegated) return false;
      if (game._isPerspectiveState) {
        if (!canUseSimulatedEffectUsage(game, effect, card, player.id, true)) return false;
        if (!evaluateSimulatedConditions(effect.conditions, { state: game, selfId: "bot", sourceCard: card })) return false;
      }
      return true;
    };
    const actions: AIAction[] = getGenericNormalSummonActions({
      player,
      analysis: { canNormalSummon: analysis.summonAvailable, fieldCapacity: Math.max(1, 5 - player.field.length) },
      getTributeRequirement: getTributeRequirementFor,
      shouldSummon: (card, _analysis, info) => {
        const needed = info.tributesNeeded || 0;
        const { indices: tributes } = selectPayableTributes(player, player.field, game,
          candidates => selectNeutralTributes(candidates, needed, card));
        return {
          yes: canUseNormalSummonForCard(normalSummonPlayer, card) &&
            getTributeValueTotal(getTributeCardsFromIndices(player.field, tributes), card) >= needed &&
            player.field.length - tributes.length < 5,
          priority: 5 + (card.level || 0) / 10,
          position: (card.atk || 0) >= (card.def || 0) ? "attack" : "defense",
        };
      },
    }).map(action => ({ ...action, facedown: action.position === "defense" }));
    actions.push(...getGenericHandSpellActions({
      game, player,
      shouldPlay: card => {
        const effect = findSpellActivationEffect(card);
        return { yes: effect ? useful(card, effect) : card.subtype === "field", priority: card.subtype === "field" ? 4.5 : 4 };
      },
      buildActivationContext: card => context(card, findSpellActivationEffect(card), "hand"),
      canActivate: ({ card, activationContext }) => canActivateSpellFromHand(game, card, player, activationContext),
    }));
    actions.push(...getGenericHandSummonProcedureActions(game).map(action => ({ ...action, priority: 6 })));
    for (const zone of ["hand", "field", "graveyard", "spellTrap", "fieldSpell"] as const) {
      const cards = zone === "fieldSpell" ? (player.fieldSpell ? [player.fieldSpell] : []) : player[zone];
      const type = zone === "hand" ? "handIgnition" : zone === "field" ? "monsterEffect"
        : zone === "graveyard" ? "graveyardMonsterEffect" : zone === "spellTrap" ? "spellTrapEffect" : "fieldEffect";
      actions.push(...getGenericIgnitionEffectActions({
        game, player, cards, type, sourceZone: zone,
        indexFields: zone === "field" ? ["fieldIndex"] : zone === "graveyard" ? ["graveyardIndex"] : ["index"],
        findEffect: card => findIgnitionEffect(card, zone), includeEffectId: true,
        shouldActivate: (card, _analysis, input) => ({ yes: useful(card, input.effect), priority: 6 }),
        buildActivationContext: (card, _analysis, input) => context(card, input.effect, zone),
        canActivate: ({ card, activationContext }) => card.cardKind === "monster"
          ? canActivateMonsterEffect(game, card, player, zone, activationContext)
          : canActivateSpellTrapEffect(game, card, player, zone, activationContext),
      }));
    }
    actions.push(...getGenericSynchroActions(game).map(action => {
      const synchro = player.extraDeck.find(card => card.instanceId === action.synchroInstanceId);
      return { ...action, priority: 5 + (synchro?.atk || 0) / 1000 };
    }));
    actions.push(...getGenericSetBackrowActions({ game, player, opponent: analysis.opponent,
      policy: { acceptsCard: card => card.cardKind === "trap" } }));
    // Same read-only view the specialized strategies pass (void, shadowheart): the base rule reads
    // only the public field state (cardKind, position, ATK/DEF and the turn flags) of these players.
    actions.push(...this.getPositionChangeActions(game, player as SimulatedPlayerState, analysis.opponent as SimulatedPlayerState | null));
    return this.sequenceActions(actions);
  }

  /** Stable order by descending priority. */
  override sequenceActions(actions: AIAction[]) {
    return actions.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  override getTributeRequirementFor(card: SimulatedCardState, player: SimulatedPlayerState) {
    return getTributeRequirementFor(card, player);
  }

  override selectBestTributes(field: SimulatedCardState[], count: number, card: SimulatedCardState) {
    return selectNeutralTributes(field, count, card);
  }

  override simulateMainPhaseAction(state: Parameters<BaseStrategy["simulateMainPhaseAction"]>[0], action: AIPlannedAction) {
    if (action.type === "simulatedBattle") return state;
    return applyGenericSimulatedMainPhaseAction(state, action, {
      ...this.getPlanningSimulationOptions(state), activationContext: action.activationContext,
    });
  }

  getPlanningSimulationOptions(_state: Parameters<BaseStrategy["simulateMainPhaseAction"]>[0]): PlanningSimulationOptions {
    return {
      strategy: this, selfId: "bot", archetype: null, guardLabel: "NeutralDiagnosticStrategy", enableSimulatedEvents: true,
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
    };
  }
}

// Compile-time proof that the class can take a preset's registry slot.
const registrable: RegisteredStrategyConstructor = NeutralDiagnosticStrategy;
void registrable;
