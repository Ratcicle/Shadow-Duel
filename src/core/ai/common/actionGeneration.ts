import { isCanonicalZone } from "../../contracts/zones.js";
/**
 * Shared AI action generation primitives.
 *
 * These helpers are intentionally strategy-neutral: they do not import
 * strategies, do not know card names, and do not apply macro/safety policy
 * unless the caller explicitly provides it.
 */

import { bindPlanningActionPresence, getPlanningIdentityGame } from "./actionIdentity.js";
import type {
  AIAction,
  AIActionOf,
  AIActionType,
  AIActivationContext,
  AIStrategyBotPort,
  AIState,
  ExtraDeckMaterialHint,
  HandProcedureMaterialHint,
  SynchroAIAction,
} from "../../contracts/ai.js";
import type {
  AiCardInput,
  AiLiveGamePort,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";
import type { BattlePositionInput, GameCard } from "../../contracts/cards.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { EventZone } from "../../contracts/events.js";
import type { NormalSummonPlayerReadView } from "../../contracts/player.js";
import { enumerateSynchroMaterialCombos } from "../../game/summon/synchro.js";
import { getNormalSummonTributeOptions } from "../../game/summon/tributeValue.js";
import { matchesCardFilter, type RuntimeCardFilter } from "../../effects/filters/cardFilters.js";
import { isActiveEquipInZone } from "../../effects/passives/passiveBuffs.js";
import { canSimulatedSpecialSummon, canSimulatedProcedureEnterField } from "./simulation.js";
import { canMoveCardToZone } from "./zones.js";
import { hasActionZoneCandidates } from "./actionValidation.js";
import { canActivateSpellTrapEffect } from "./previewGuards.js";
import { canUseSimulatedEffectUsage } from "./simStateUtils.js";
import { evaluateSimulatedConditions } from "./simulatedConditions.js";
import { collectProcedureCounterSources, getCounterValue } from "./counters.js";

/** Declarative hand procedures use only projected costs, conditions and placement. */
export function getGenericHandSummonProcedureActions(game: AIState): AIActionOf<"handSummonProcedure">[] {
  if (!game._isPerspectiveState || (game.phase !== "main1" && game.phase !== "main2")) return [];
  const player = game.bot;
  const opponent = game.player;
  if (!player || !opponent || game.turn !== player.id) return [];
  const field: readonly AiCardInput[] = player.field || [];
  const graveyard: readonly AiCardInput[] = player.graveyard || [];
  const cardMatchesFilters = (candidate: AiCardInput, filters: RuntimeCardFilter): boolean =>
    matchesCardFilter(candidate, filters, {
      turnCounter: game.turnCounter,
      getCounter: (entry, type) => entry.counters?.get(type) || 0,
      hasMatchingEquip: (entry, equipFilters, requireFaceup) => (entry.equips || []).some(equip => {
        const owner = [game.player, game.bot].find(candidateOwner => candidateOwner?.id === equip.owner);
        return isActiveEquipInZone(equip, entry, owner?.spellTrap || []) &&
          (!requireFaceup || !equip.isFacedown) && cardMatchesFilters(equip, equipFilters);
      }),
    });
  return (player.hand || []).flatMap((card, index) => {
    const procedure = card.handSummonProcedure;
    if (!procedure || card.cardKind !== "monster") return [];
    if (!canUseSimulatedEffectUsage(game, procedure, card, player.id, true) ||
        !canSimulatedSpecialSummon(card, player, procedure.id, "hand", cardMatchesFilters) ||
        !evaluateSimulatedConditions(procedure.conditions || [], { state: game, sourceCard: card, selfId: "bot" })) return [];
    const cost = procedure.cost;
    const counterCost = procedure.counterCost;
    if (counterCost && (!Number.isInteger(counterCost.amount) || counterCost.amount < 1 ||
        collectProcedureCounterSources(player, opponent, counterCost, game.turnCounter || 0)
          .reduce((total, source) => total + getCounterValue(source, counterCost.counterType), 0) < counterCost.amount)) return [];
    if (cost && (!Number.isInteger(cost.count) || cost.count < 1)) return [];
    const count = cost?.count ?? 0;
    const candidates = cost ? [...new Set(cost.zones.flatMap(zone => player[zone] || []))].filter(candidate =>
      cardMatchesFilters(candidate, cost.filters) &&
      canMoveCardToZone(player, candidate, cost.destination, player, { state: game })) : [];
    const fieldCandidates = candidates.filter(candidate => field.includes(candidate));
    const graveCandidates = candidates.filter(candidate => graveyard.includes(candidate));
    const search = (fieldIndex: number, selected: AiCardInput[]): AiCardInput[] | null => {
      if (selected.length > count) return null;
      if (fieldIndex === fieldCandidates.length) {
        if (selected.length + graveCandidates.length < count ||
            !canSimulatedProcedureEnterField(card, player, game.player, selected, cardMatchesFilters)) return null;
        return [...selected, ...graveCandidates.slice(0, count - selected.length)];
      }
      const without = search(fieldIndex + 1, selected);
      if (without) return without;
      const candidate = fieldCandidates[fieldIndex];
      return candidate ? search(fieldIndex + 1, [...selected, candidate]) : null;
    };
    const selected = search(0, []);
    if (!selected) return [];
    const materials: HandProcedureMaterialHint[] = [];
    for (const material of selected) {
      if (typeof material.instanceId !== "number") return [];
      const zone = field.includes(material) ? "field" as const : "graveyard" as const;
      const index = (zone === "field" ? field : graveyard).indexOf(material);
      materials.push({ zone, index, cardId: material.id, instanceId: material.instanceId });
    }
    return [bindPlanningActionPresence({ type: "handSummonProcedure" as const, card: card as SimulatedCardState,
      cardId: card.id, cardName: card.name, index, materials }, card, player.id || "", "hand", undefined, selected.map(material => ({ card: material, zone: field.includes(material) ? "field" : "graveyard" })))];
  });
}

/** Preserve callers whose policy deliberately considers only free bodies. */
export function getGenericCostlessHandSummonActions(game: AIState): AIActionOf<"handSummonProcedure">[] {
  return getGenericHandSummonProcedureActions(game)
    .filter(action => {
      const procedure = action.index === undefined ? null : game.bot?.hand?.[action.index]?.handSummonProcedure;
      return !!procedure && !procedure.cost && !procedure.counterCost;
    });
}

/** GY ignition candidates shared by strategies; the legacy action name also covers Traps. */
export function getGenericGraveyardSpellTrapActions(game: AIState, player: AIStrategyBotPort): AIActionOf<"graveyardSpellEffect">[] {
  if ((game.phase !== "main1" && game.phase !== "main2") || game.turn !== player.id) return [];
  return (player.graveyard || []).flatMap((card, graveyardIndex) => {
    if (card.cardKind !== "spell" && card.cardKind !== "trap") return [];
    const effect = card.effects?.find(e => e.timing === "ignition" && e.activationZones?.includes("graveyard"));
    if (!effect) return [];
    const activationContext: AIActivationContext = { activationZone: "graveyard", sourceZone: "graveyard", effectId: effect.id };
    if (game._isPerspectiveState) {
      if (!canUseSimulatedEffectUsage(game, effect, card, player.id, true)) return [];
      if (!effect.actions?.every(action => hasActionZoneCandidates(player, action, card))) return [];
      if (effect.activationCosts?.some(cost => cost.type === "move" && cost.targetRef === "self" &&
        !canMoveCardToZone(player, card, cost.to || "graveyard", player, { state: game }))) return [];
    } else if (!canActivateSpellTrapEffect(game, card, player, "graveyard", activationContext)) return [];
    return [buildPrioritizedAction({ type: "graveyardSpellEffect", graveyardIndex, card, effect, priority: 6, activationContext })];
  });
}

/** Enumerate procedures from this state only; no live Game lookup or archetype scoring. */
export function getGenericSynchroActions(
  game: AIState,
  options: { existingActions?: readonly AIAction[] } = {},
): SynchroAIAction[] {
  if (game.phase !== "main1" && game.phase !== "main2") return [];
  const player = game._isPerspectiveState ? game.bot :
    [game.player, game.bot].find(candidate => candidate?.id === game.turn);
  if (!player) return [];
  const opponent = player === game.bot ? game.player : game.bot;
  const field = player.field || [];
  const cardMatchesFilters = (candidate: AiCardInput, filters: RuntimeCardFilter): boolean =>
    matchesCardFilter(candidate, filters, {
      turnCounter: game.turnCounter,
      getCounter: (entry, type) => entry.counters?.get(type) || 0,
      hasMatchingEquip: (entry, equipFilters, requireFaceup) => (entry.equips || []).some(equip => {
        const owner = [game.player, game.bot].find(entryPlayer => entryPlayer?.id === equip.owner);
        return isActiveEquipInZone(equip, entry, owner?.spellTrap || []) &&
          (!requireFaceup || !equip.isFacedown) && cardMatchesFilters(equip, equipFilters);
      }),
    });
  const actions: SynchroAIAction[] = [];
  const existingSynchros = (options.existingActions || []).filter(action => action.type === "synchro");
  for (const card of player.extraDeck || []) {
    if (card.monsterType !== "synchro" || card.instanceId == null ||
        !canSimulatedSpecialSummon(card, player, "synchro", "extraDeck", cardMatchesFilters)) continue;
    for (const materials of enumerateSynchroMaterialCombos<AiCardInput>(field, card, {
      effectEngine: { cardMatchesFilters },
      canUseMaterial: material => canMoveCardToZone(player, material, "graveyard", player, { state: game }),
    })) {
      if (!canSimulatedProcedureEnterField(card, player, opponent, materials, cardMatchesFilters)) continue;
      const materialInstanceIds = materials.map(material => material.instanceId);
      if (!materialInstanceIds.every((id): id is string | number => id != null) ||
          new Set(materialInstanceIds).size !== materials.length) continue;
      const positionPreference = card.synchro?.position;
      const positions = positionPreference === "attack" || positionPreference === "defense"
        ? [positionPreference] : ["attack", "defense"] as const;
      for (const position of positions) {
        // Keep strategy scores and choices; ordered materials preserve resolution order.
        if (existingSynchros.some(action => action.synchroInstanceId === card.instanceId &&
            action.position === position && action.materialInstanceIds.length === materialInstanceIds.length &&
            action.materialInstanceIds.every((id, index) => id === materialInstanceIds[index]))) continue;
        actions.push({
          type: "synchro", synchroInstanceId: card.instanceId, materialInstanceIds: [...materialInstanceIds],
          position, cardId: card.id, cardName: card.name,
        });
      }
    }
  }
  return actions;
}

type PlanningCard = GameCard | SimulatedCardState;
/** Preserve a physical source index when a caller visits one card at a time. */
export interface ActionGenerationEntry<Card extends PlanningCard = PlanningCard> {
  readonly card: Card;
  readonly sourceIndex: number;
}

function* generationEntries<Card extends PlanningCard>(
  cards: readonly Card[],
  entries?: readonly ActionGenerationEntry<Card>[],
): Iterable<ActionGenerationEntry<Card>> {
  if (entries) {
    yield* entries;
    return;
  }
  // Retain the original lazy array traversal for existing callers.
  for (const [sourceIndex, card] of cards.entries()) yield { card, sourceIndex };
}
type ActionIndexKey =
  | "index"
  | "fieldIndex"
  | "zoneIndex"
  | "graveyardIndex"
  | "materialIndex";
type AIActionExtraByType = {
  [Type in AIActionType]: Partial<Omit<AIActionOf<Type>, "type">>;
};
type AIActionExtra<Type extends AIActionType> = AIActionExtraByType[Type];
type AIActionExtraInput<Type extends AIActionType> =
  | AIActionExtra<Type>
  | ((context: unknown) => AIActionExtra<Type> | null);

interface MutablePrioritizedAction {
  type: AIActionType;
  priority: number;
  index?: number;
  fieldIndex?: number;
  zoneIndex?: number;
  graveyardIndex?: number;
  materialIndex?: number;
  cardId?: number;
  cardName?: string;
  effectId?: string;
  reason?: string | undefined;
  activationContext?: AIActivationContext | undefined;
}

interface BuildPrioritizedActionInput<Type extends AIActionType = AIActionType> {
  type: Type;
  index?: number | null;
  fieldIndex?: number | null;
  zoneIndex?: number | null;
  graveyardIndex?: number | null;
  materialIndex?: number | null;
  card?: PlanningCard | null;
  sourceBinding?: { controllerId: string; zone: EventZone; game?: object | null | undefined };
  priority?: number | undefined;
  reason?: string | null | undefined;
  effect?: EffectDefinition | null;
  activationContext?: AIActivationContext | null | undefined;
  extra?: AIActionExtra<NoInfer<Type>> | null;
}

interface ActionDecision {
  yes?: boolean;
  ok?: boolean;
  priority?: number | undefined;
  reason?: string | undefined;
  position?: "attack" | "defense" | "choice";
}

interface ActionAllowedResult {
  ok?: boolean;
}

interface SafetyAdjustmentResult {
  adjustment?: number;
  priority?: number | undefined;
}

interface ActionGenerationAnalysis {
  canNormalSummon?: boolean | undefined;
  fieldCapacity?: number;
  game?: object | null | undefined;
}

interface HandSpellContext<Analysis = unknown, Player extends AIStrategyBotPort = AIStrategyBotPort> {
  game?: AIState | undefined;
  player: Player;
  analysis?: Analysis | undefined;
  index: number;
  card: Player["hand"][number];
}

interface HandSpellOptions<Analysis = unknown, Player extends AIStrategyBotPort = AIStrategyBotPort> {
  game?: AIState | undefined;
  player: Player;
  hand?: Player["hand"];
  entries?: readonly ActionGenerationEntry<Player["hand"][number]>[];
  analysis?: Analysis;
  shouldPlay?(
    card: Player["hand"][number],
    analysis: Analysis | undefined,
    context: HandSpellContext<Analysis, Player>,
  ): ActionDecision;
  buildActivationContext?(
    card: Player["hand"][number],
    analysis: Analysis | undefined,
    context: HandSpellContext<Analysis, Player> & { decision: ActionDecision },
  ): AIActivationContext | null;
  canActivate?(
    context: HandSpellContext<Analysis, Player> & {
      decision: ActionDecision;
      activationContext: AIActivationContext | null;
    },
  ): boolean | ActionAllowedResult | null | undefined;
  type?: Extract<AIActionType, "spell">;
  extra?: AIActionExtraInput<"spell">;
}

interface TributeInfo {
  tributesNeeded?: number;
  usingAlt?: boolean;
  alt?: unknown;
}

interface NormalSummonOptions<Analysis extends ActionGenerationAnalysis = ActionGenerationAnalysis, Player extends AIStrategyBotPort = AIStrategyBotPort> {
  player: Player;
  hand?: Player["hand"];
  entries?: readonly ActionGenerationEntry<Player["hand"][number]>[];
  /** Optional coherent owner view; defaults preserve existing projections. */
  summonPlayer?: Omit<NormalSummonPlayerReadView, "field"> & {
    hand: readonly Player["hand"][number][];
    field: readonly Player["field"][number][];
  };
  analysis?: Analysis;
  getTributeRequirement?(
    card: Player["hand"][number],
    player: Player,
    context: unknown,
  ): TributeInfo;
  shouldSummon?(
    card: Player["hand"][number],
    analysis: Analysis,
    tributeInfo: TributeInfo,
    context: unknown,
  ): ActionDecision;
  type?: Extract<AIActionType, "summon">;
  extra?: AIActionExtraInput<"summon">;
}

interface IgnitionContext<Analysis = unknown, Player extends AIStrategyBotPort = AIStrategyBotPort> {
  game?: AIState | undefined;
  player: Player;
  analysis?: Analysis | undefined;
  sourceIndex: number;
  card: Player["hand"][number];
  sourceZone?: string | undefined;
}

interface IgnitionEffectOptions<Type extends AIActionType, Analysis = unknown, Player extends AIStrategyBotPort = AIStrategyBotPort> {
  game?: AIState | undefined;
  player: Player;
  cards?: Player["hand"];
  entries?: readonly ActionGenerationEntry<Player["hand"][number]>[];
  analysis?: Analysis;
  type: Type;
  sourceZone?: string;
  indexFields?: ActionIndexKey[];
  findEffect?(
    card: Player["hand"][number],
    sourceZone: string | undefined,
    context: IgnitionContext<Analysis, Player>,
  ): EffectDefinition | null;
  /** Opt-in multi-effect discovery; returned order is the caller's policy order. */
  findEffects?(
    card: Player["hand"][number],
    sourceZone: string | undefined,
    context: IgnitionContext<Analysis, Player>,
  ): readonly EffectDefinition[];
  /** Overrides only candidate preflight; discovery, policy and preview retain their order. */
  validateCandidate?(
    context: IgnitionContext<Analysis, Player> & { effect: EffectDefinition },
  ): boolean | ActionAllowedResult | null | undefined;
  shouldActivate?(
    card: Player["hand"][number],
    analysis: Analysis | undefined,
    context: IgnitionContext<Analysis, Player> & { effect: EffectDefinition },
  ): ActionDecision;
  buildActivationContext?(
    card: Player["hand"][number],
    analysis: Analysis | undefined,
    context: IgnitionContext<Analysis, Player> & {
      effect: EffectDefinition;
      decision: ActionDecision;
    },
  ): AIActivationContext | null;
  canActivate?(context: IgnitionContext<Analysis, Player> & { effect: EffectDefinition; decision: ActionDecision; activationContext: AIActivationContext | null }): boolean | ActionAllowedResult | null | undefined;
  cardFilter?(
    card: Player["hand"][number],
    zone: string | undefined,
    context: { player: Player; sourceIndex: number },
  ): boolean;
  includeEffectId?: boolean;
  extra?: AIActionExtraInput<NoInfer<Type>>;
}

interface SafetyResult {
  riskScore?: number;
  recommendation?: "safe" | "caution" | "risky" | "very_risky" | "blocked";
}

interface SafetyPolicyMap {
  very_risky?: number;
  medium?: number;
  safe?: number;
  caution?: number;
  risky?: number;
  blocked?: number;
  default?: number;
}

interface MacroSafetyContext<Macro = unknown> {
  priority: number;
  basePriority: number;
  actionType?: AIActionType | undefined;
  card?: PlanningCard | null | undefined;
  macroStrategy?: Macro | undefined;
  safety: SafetyResult | null;
  macroBuff: number;
  safetyScore: number | null;
}

interface MacroSafetyOptions<Macro = unknown> {
  basePriority?: number;
  actionType?: AIActionType;
  card?: PlanningCard | null;
  macroStrategy?: Macro;
  safety?: SafetyResult | null;
  safetyPolicy?:
    | SafetyPolicyMap
    | ((context: MacroSafetyContext<Macro>) => number | SafetyAdjustmentResult)
    | null;
  macroBonusFn?: ((
    actionType: AIActionType,
    card: PlanningCard,
    macroStrategy: Macro,
  ) => number) | null;
}

function hasValue<Value>(
  value: Value | null | undefined,
): value is Value {
  return value !== undefined && value !== null;
}

function finiteOr(value: unknown, fallback = 0): number {
  return Number.isFinite(value) ? value as number : fallback;
}

function applyIndex(
  action: MutablePrioritizedAction,
  key: ActionIndexKey,
  value: number | null | undefined,
): void {
  if (hasValue(value)) action[key] = value;
}

function resolveExtra<Type extends AIActionType>(
  extra: AIActionExtraInput<Type> | null | undefined,
  context: unknown,
): AIActionExtra<Type> {
  if (typeof extra === "function") return extra(context) || {};
  return extra || {};
}

function isActionAllowed(
  result: boolean | ActionAllowedResult | null | undefined,
): boolean {
  return (
    result !== false &&
    (result as ActionAllowedResult | null | undefined)?.ok !== false
  );
}

function defaultIgnitionCardFilter(
  card: PlanningCard | null | undefined,
  zone?: string,
): boolean {
  if (!card) return false;
  if (zone === "spellTrap") {
    return card.cardKind === "spell" && !card.isFacedown;
  }
  if (zone === "field") {
    return card.cardKind === "monster" && !card.isFacedown;
  }
  return true;
}

function resolveSafetyAdjustment<Macro>(
  safetyPolicy: MacroSafetyOptions<Macro>["safetyPolicy"],
  context: MacroSafetyContext<Macro>,
): number {
  if (!safetyPolicy) return 0;

  if (typeof safetyPolicy === "function") {
    const result = safetyPolicy(context);
    if (Number.isFinite(result)) return result as number;
    if (Number.isFinite((result as SafetyAdjustmentResult)?.adjustment)) {
      return (result as SafetyAdjustmentResult).adjustment as number;
    }
    if (Number.isFinite((result as SafetyAdjustmentResult)?.priority)) {
      return (result as SafetyAdjustmentResult).priority as number - context.priority;
    }
    return 0;
  }

  const recommendation = context.safety?.recommendation;
  return hasValue(recommendation) &&
    Number.isFinite(safetyPolicy[recommendation])
    ? safetyPolicy[recommendation]!
    : finiteOr(safetyPolicy.default, 0);
}

/**
 * Build a prioritized action while preserving the existing action shape.
 * Optional fields are only included when provided; `extra` is applied last so
 * callers can opt into exact per-strategy fields or overrides.
 */
export function buildPrioritizedAction<Type extends AIActionType>({
  type,
  index,
  fieldIndex,
  zoneIndex,
  graveyardIndex,
  materialIndex,
  card,
  sourceBinding,
  priority = 0,
  reason = null,
  effect = null,
  activationContext = null,
  extra = {} as AIActionExtra<Type>,
}: BuildPrioritizedActionInput<Type> = {} as BuildPrioritizedActionInput<Type>): AIActionOf<Type> {
  const action: MutablePrioritizedAction = {
    type,
    priority,
  };

  applyIndex(action, "index", index);
  applyIndex(action, "fieldIndex", fieldIndex);
  applyIndex(action, "zoneIndex", zoneIndex);
  applyIndex(action, "graveyardIndex", graveyardIndex);
  applyIndex(action, "materialIndex", materialIndex);

  if (hasValue(card?.id)) action.cardId = card!.id as number;
  if (hasValue(card?.name)) action.cardName = card!.name as string;
  if (hasValue(effect?.id)) action.effectId = effect!.id as string;
  if (hasValue(reason)) action.reason = reason as string;
  if (hasValue(activationContext)) {
    action.activationContext = activationContext as AIActivationContext;
  }

  const result = {
    ...action,
    ...(extra || {}),
  } as AIActionOf<Type>;
  return card && sourceBinding ? bindPlanningActionPresence(result, card,
    sourceBinding.controllerId, sourceBinding.zone, sourceBinding.game) : result;
}

/**
 * Build hand spell actions using caller-owned policy, context and preview.
 */
export function getGenericHandSpellActions<Analysis = unknown, Player extends AIStrategyBotPort = AIStrategyBotPort>({
  game,
  player,
  hand = player?.hand || [],
  entries,
  analysis,
  shouldPlay,
  buildActivationContext,
  canActivate,
  type = "spell",
  extra = {},
}: HandSpellOptions<Analysis, Player> = {} as HandSpellOptions<Analysis, Player>): AIActionOf<"spell">[] {
  const actions: AIActionOf<"spell">[] = [];
  for (const { sourceIndex: index, card } of generationEntries(hand || [], entries)) {
    if (!card || card.cardKind !== "spell") continue;

    const context = { game, player, analysis, index, card };
    const decision =
      typeof shouldPlay === "function"
        ? shouldPlay(card, analysis, context)
        : { yes: true };
    if (!decision?.yes) continue;

    const activationContext =
      typeof buildActivationContext === "function"
        ? buildActivationContext(card, analysis, { ...context, decision })
        : null;
    const canUse =
      typeof canActivate === "function"
        ? canActivate({ ...context, decision, activationContext })
        : true;
    if (!isActionAllowed(canUse)) continue;

    actions.push(
      buildPrioritizedAction({
        type,
        index,
        card,
        sourceBinding: { controllerId: player.id || "", zone: "hand", game: getPlanningIdentityGame(player, game) },
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
        extra: resolveExtra(extra, {
          ...context,
          decision,
          activationContext,
        }),
      }),
    );
  }
  return actions;
}

/**
 * Build normal summon actions using caller-owned tribute and summon policy.
 */
export function getGenericNormalSummonActions<Analysis extends ActionGenerationAnalysis = ActionGenerationAnalysis, Player extends AIStrategyBotPort = AIStrategyBotPort>({
  player,
  hand = player?.hand || [],
  entries,
  summonPlayer: queryPlayer,
  analysis,
  getTributeRequirement,
  shouldSummon,
  type = "summon",
  extra = {},
}: NormalSummonOptions<Analysis, Player> = {} as NormalSummonOptions<Analysis, Player>): AIActionOf<"summon">[] {
  const actions: AIActionOf<"summon">[] = [];
  if (!analysis?.canNormalSummon) {
    return actions;
  }
  const summonPlayer = queryPlayer || {
    id: player.id,
    hand: player.hand,
    field: player.field,
    spellTrap: player.spellTrap,
    fieldSpell: player.fieldSpell,
    summonCount: player.summonCount ?? 0,
    additionalNormalSummons: player.additionalNormalSummons ?? 0,
    additionalNormalSummonPermissions: [...(player.additionalNormalSummonPermissions || [])],
    normalSummonsThisTurn: [...(player.normalSummonsThisTurn || [])],
  };

  for (const { sourceIndex: index, card } of generationEntries(hand || [], entries)) {
    if (!card || card.cardKind !== "monster") continue;
    if (card.cannotBeNormalSummonedOrSet) continue;
    // The canonical query checks this card's remaining allowance and physical
    // costs, including Tribute Summons which free an otherwise full field.
    if (getNormalSummonTributeOptions(summonPlayer, card).length === 0) continue;

    const context = { player, analysis, index, card };
    const tributeInfo =
      typeof getTributeRequirement === "function"
        ? getTributeRequirement(card, player, context)
        : {};
    const decision =
      typeof shouldSummon === "function"
        ? shouldSummon(card, analysis, tributeInfo, {
            ...context,
            tributeInfo,
          })
        : { yes: true };
    if (!decision?.yes) continue;

    actions.push(
      buildPrioritizedAction({
        type,
        index,
        card,
        sourceBinding: { controllerId: player.id || "", zone: "hand", game: getPlanningIdentityGame(player, analysis.game) },
        priority: decision.priority || 1,
        reason: decision.reason,
        extra: {
          position: decision.position || "attack",
          facedown: false,
          ...resolveExtra(extra, {
            ...context,
            tributeInfo,
            decision,
          }),
        },
      }),
    );
  }

  return actions;
}

/**
 * Build ignition-style effect actions with caller-owned discovery and preview.
 */
export function getGenericIgnitionEffectActions<Type extends AIActionType, Analysis = unknown, Player extends AIStrategyBotPort = AIStrategyBotPort>({
  game,
  player,
  cards = [],
  entries,
  analysis,
  type,
  sourceZone,
  indexFields = ["index"],
  findEffect,
  findEffects,
  validateCandidate,
  shouldActivate,
  buildActivationContext,
  canActivate,
  cardFilter = defaultIgnitionCardFilter,
  includeEffectId = false,
  extra = {} as AIActionExtra<Type>,
}: IgnitionEffectOptions<Type, Analysis, Player> = {} as IgnitionEffectOptions<Type, Analysis, Player>): AIActionOf<Type>[] {
  const actions: AIActionOf<Type>[] = [];
  for (const { sourceIndex, card } of generationEntries(cards || [], entries)) {
    if (!card || !cardFilter(card, sourceZone, { player, sourceIndex })) {
      continue;
    }

    const context = {
      game,
      player,
      analysis,
      sourceIndex,
      card,
      sourceZone,
    };
    const effects = typeof findEffects === "function"
      ? findEffects(card, sourceZone, context)
      : [typeof findEffect === "function" ? findEffect(card, sourceZone, context) : null];
    for (const effect of effects) {
      if (!effect) continue;
      if (typeof validateCandidate === "function") {
        if (!isActionAllowed(validateCandidate({ ...context, effect }))) continue;
      } else if (effect.actions?.some(action => (action.type === "bounce_and_summon" || (effect.activationCosts?.length && action.type === "special_summon_from_zone")) &&
          !hasActionZoneCandidates(player, action, card))) continue;

      const decision =
        typeof shouldActivate === "function"
          ? shouldActivate(card, analysis, { ...context, effect })
          : { yes: true };
      if (!decision?.yes) continue;

      const activationContext =
        typeof buildActivationContext === "function"
          ? buildActivationContext(card, analysis, {
              ...context,
              effect,
              decision,
            })
          : null;
      const canUse =
        typeof canActivate === "function"
          ? canActivate({
              ...context,
              effect,
              decision,
              activationContext,
            })
          : true;
      if (!isActionAllowed(canUse)) continue;

      const indexes: Partial<Pick<MutablePrioritizedAction, ActionIndexKey>> = {};
      for (const field of indexFields || []) {
        indexes[field] = sourceIndex;
      }

      actions.push(
        buildPrioritizedAction({
          type,
          ...indexes,
          card,
          ...(isCanonicalZone(sourceZone) ? { sourceBinding: { controllerId: player.id || "", zone: sourceZone, game } } : {}),
          effect: includeEffectId ? effect : null,
          priority: decision.priority || 1,
          reason: decision.reason,
          activationContext,
          extra: resolveExtra(extra, {
            ...context,
            effect,
            decision,
            activationContext,
          }),
        }),
      );
    }
  }

  return actions;
}

/**
 * Combine opt-in macro and safety adjustments for action priority.
 * The helper never computes safety itself; callers pass precomputed safety and
 * policy when they want those metadata reflected.
 */
export function applyMacroAndSafety<Macro>(options: MacroSafetyOptions<Macro> & {
  actionType: AIActionType;
  card: PlanningCard;
  macroStrategy: Macro;
  macroBonusFn: NonNullable<MacroSafetyOptions<Macro>["macroBonusFn"]>;
}): { priority: number; macroBuff: number; safetyScore: number | null; safetyAdjustment: number };
export function applyMacroAndSafety<Macro = unknown>(options?: Omit<MacroSafetyOptions<Macro>, "macroBonusFn"> & {
  macroBonusFn?: null;
}): { priority: number; macroBuff: number; safetyScore: number | null; safetyAdjustment: number };
export function applyMacroAndSafety<Macro = unknown>({
  basePriority = 0,
  actionType,
  card,
  macroStrategy,
  safety = null,
  macroBonusFn = null,
  safetyPolicy = null,
}: MacroSafetyOptions<Macro> = {}) {
  const normalizedBasePriority = finiteOr(basePriority, 0);
  let priority = normalizedBasePriority;
  let macroBuff = 0;

  if (typeof macroBonusFn === "function") {
    // The callback overload requires its three inputs together.
    macroBuff = finiteOr(macroBonusFn(actionType!, card!, macroStrategy!), 0);
    priority += macroBuff;
  }

  const safetyScore = Number.isFinite(safety?.riskScore)
    ? safety!.riskScore as number
    : null;
  const safetyAdjustment = resolveSafetyAdjustment(safetyPolicy, {
    priority,
    basePriority: normalizedBasePriority,
    actionType,
    card,
    macroStrategy,
    safety,
    macroBuff,
    safetyScore,
  });

  priority += safetyAdjustment;

  return {
    priority,
    macroBuff,
    safetyScore,
    safetyAdjustment,
  };
}

/**
 * Create a shallow shared context for action-generation helpers.
 * `extra` is applied last so future callers can add or override fields without
 * changing this helper's core contract.
 */
export function createActionGenerationContext<Extra extends object>({
  game,
  strategy,
  bot,
  opponent,
  analysis,
  actualGame,
  isSimulatedState,
  macroStrategy,
  activationContext,
  log,
  extra = {} as Extra,
}: {
  game?: AIState | undefined;
  strategy?: unknown;
  bot?: SimulatedPlayerState;
  opponent?: SimulatedPlayerState;
  analysis?: unknown;
  actualGame?: AiLiveGamePort;
  isSimulatedState?: boolean;
  macroStrategy?: unknown;
  activationContext?: AIActivationContext | undefined;
  log?: ((message: string) => void) | null;
  extra?: Extra;
} = {}) {
  return {
    game,
    strategy,
    bot,
    opponent,
    analysis,
    actualGame,
    isSimulatedState,
    macroStrategy,
    activationContext,
    log,
    ...(extra || {}),
  };
}

type ProcedurePlanningCard = SimulatedCardState | GameCard;
interface ProcedurePlanningEntry<Card> {
  readonly card: Card;
  readonly sourceIndex: number;
}
interface ProcedurePlanningSelection<Card, Evaluation> {
  readonly combo: readonly Card[];
  readonly evaluation: Evaluation;
}
interface ProcedurePlanningDetails {
  readonly priority: number;
  readonly reason: string;
  readonly position: BattlePositionInput;
  readonly activationContext: AIActivationContext;
}
type ProcedurePlanningMaterialHint = ExtraDeckMaterialHint & {
  readonly index: number;
  readonly instanceIds: Array<string | number>;
};

/** Pure transport of the existing catalogue material hints, in physical order. */
export function buildGenericExtraDeckProcedureAction<Card extends ProcedurePlanningCard>(
  source: Card,
  sourceIndex: number,
  materials: ProcedurePlanningMaterialHint[],
  details: ProcedurePlanningDetails,
): AIActionOf<"extraDeckProcedure"> {
  return {
    type: "extraDeckProcedure",
    cardId: source.id,
    cardName: source.name,
    extraDeckIndex: sourceIndex,
    extraDeckCard: source,
    materialIndices: materials.map(material => material.index),
    // These legacy arrays mirror hints supplied from catalogue cards. Retain
    // their transport alongside aliases; do not repair or replace identities.
    materialIds: materials.map(material => material.id!),
    materialNames: materials.map(material => material.name!),
    materialInstanceIds: materials.map(material => material.instanceIds),
    materials,
    requiredMaterialCount: materials.length,
    ...details,
  };
}

/**
 * Preserve the caller's entry order and query the existing procedure validator
 * through its read adapter. Material rules and strategy scores are callbacks.
 * Current command consumers transport field materials; other-zone selections
 * require their own supported command rather than invalid field hints.
 */
export function getGenericExtraDeckProcedureActions<Card extends ProcedurePlanningCard, Evaluation>(
  player: { readonly id: string; readonly field: readonly Card[] },
  entries: Iterable<ProcedurePlanningEntry<Card>>,
  options: {
    readonly game?: object | null;
    readonly getMaterialCombos: (entry: ProcedurePlanningEntry<Card>) => {
      readonly ok: boolean; readonly combos: readonly Card[][];
    };
    readonly selectMaterials: (
      combos: readonly Card[][], entry: ProcedurePlanningEntry<Card>,
    ) => ProcedurePlanningSelection<Card, Evaluation> | null;
    readonly getActionDetails: (
      selected: ProcedurePlanningSelection<Card, Evaluation>, entry: ProcedurePlanningEntry<Card>,
    ) => ProcedurePlanningDetails;
    readonly getMaterialInstanceIds: (material: Card) => Array<string | number>;
    readonly decorateAction?: (
      action: AIActionOf<"extraDeckProcedure">,
      selected: ProcedurePlanningSelection<Card, Evaluation>, entry: ProcedurePlanningEntry<Card>,
    ) => AIActionOf<"extraDeckProcedure">;
  },
): AIActionOf<"extraDeckProcedure">[] {
  const actions: AIActionOf<"extraDeckProcedure">[] = [];
  for (const entry of entries) {
    const result = options.getMaterialCombos(entry);
    if (!result.ok || result.combos.length === 0) continue;
    const selected = options.selectMaterials(result.combos, entry);
    if (!selected || selected.combo.length === 0) continue;
    if (selected.combo.some(card => !player.field.includes(card))) continue;
    const materials = selected.combo.map(card => ({
      index: player.field.indexOf(card), id: card.id, name: card.name,
      instanceIds: options.getMaterialInstanceIds(card),
    }));
    let action = buildGenericExtraDeckProcedureAction(
      entry.card, entry.sourceIndex, materials, options.getActionDetails(selected, entry),
    );
    action = options.decorateAction?.(action, selected, entry) || action;
    actions.push(bindPlanningActionPresence(
      action, entry.card, player.id, "extraDeck", getPlanningIdentityGame(player, options.game),
      selected.combo.map(card => ({ card, zone: "field" })),
    ));
  }
  return actions;
}
