import { appendSimulatedZoneCard } from "../zones.js";
import { resolveExactInstanceSelection } from "../../../AutoSelector.js";
import { getEffectiveAtk } from "../cardStats.js";
import { getCounterValue, setCounterValue } from "../counters.js";
import { estimateMonsterValue, hasArchetype } from "../cardValue.js";
import {
  evaluateSimulatedConditions,
  getStoredBlueprints,
} from "../simulatedConditions.js";
import {
  getCardInstanceId,
  getCostPreference,
  getTargetPreference,
  matchesTargetFilters,
  mergeCostPreference,
  normalizeCount,
  rankCandidates,
  selectSimulatedTargets,
} from "../targetSelection.js";
import {
  attachSimulatedEquip,
  findCardOwner,
  findCardZone,
  getZoneCards,
  moveCardToZone,
  removeCardFromZones,
} from "../zones.js";
import {
  applySummonState,
  chooseRankedCards,
  getActionCandidates,
  hasOpenMonsterZone,
  hasRequiredSelections,
  markSimulatedPassiveUsed,
  pickCountForAction,
  resolveActionPlayer,
  resolveSimulatedLpCost,
  resolveTargetsForAction,
  STOP_SIMULATION,
} from "./shared.js";
import type {
  ActionTargetScope,
  DestroyDamageEntry,
} from "../../../contracts/actions.js";
import type {
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../../contracts/aiState.js";
import type { CardFilter, EffectCondition } from "../../../contracts/effects.js";
import type { SimulatedActionHandlerContext } from "./shared.js";
import type { SimulatedActionOptions, SimulatedRuntimeState } from "./shared.js";
import { hasSimulatedProtection } from "./lifecycle.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../simStateUtils.js";

/** Resolve supported equipment costs after battle damage has been calculated. */
export function replaceSimulatedBattleDestruction(
  state: SimulatedRuntimeState,
  target: SimulatedCardState,
): SimulatedCardState | null {
  const targetOwner = [state.bot, state.player].find(owner => owner.field.includes(target));
  if (!targetOwner) return null;
  for (const owner of [state.bot, state.player]) {
    for (const source of [...owner.spellTrap]) {
      if (source.isFacedown || source.effectsNegated || (source.equippedTo || source.equipTarget) !== target) continue;
      for (const effect of source.effects || []) {
        if (effect.timing !== "passive" || !("replacementEffect" in effect)) continue;
        const replacement = effect.replacementEffect;
        if (!replacement || replacement.type !== "destruction" || replacement.reason !== "battle" ||
            !replacement.targetMustBeEquippedToSource ||
            (replacement.targetRequireFaceup && target.isFacedown) ||
            (replacement.targetOwner === "self" && owner !== targetOwner) ||
            (replacement.targetOwner === "opponent" && owner === targetOwner) ||
            (replacement.targetFilters && !matchesTargetFilters(target, replacement.targetFilters)) ||
            !canUseSimulatedEffectUsage(state, effect, source, owner.id, true)) continue;
        const costs = replacement.costActions;
        // Leave unsupported cost sequences to the full runtime.
        if (costs?.length !== 1) continue;
        const costAction = costs[0];
        if (!costAction) continue;
        if (costAction.type === "move" && costAction.targetRef === "self" && costAction.to === "graveyard") {
          if (!moveCardToZone(owner, source, "graveyard", owner, { state })) continue;
          if (!owner.graveyard.includes(source)) continue;
        } else if (costAction.type === "pay_lp") {
          const opponent = owner === state.bot ? state.player : state.bot;
          const cost = resolveSimulatedLpCost({ action: costAction, targetPlayer: owner, self: owner,
            opponent, state, options: { sourceCard: source }, baseAmount: costAction.amount || 0 });
          if (owner.lp <= cost.finalAmount) continue;
          owner.lp -= cost.finalAmount;
          for (const reducer of cost.appliedReducers) markSimulatedPassiveUsed(state, reducer.board, reducer.card, reducer.effect);
        } else continue;
        markSimulatedEffectUsage(state, effect, source, owner.id, true);
        return source;
      }
    }
  }
  return null;
}

interface ScopedCard {
  card: SimulatedCardState;
  owner: SimulatedPlayerState;
}

export function destroySimulatedCard(
  card: SimulatedCardState,
  owner: SimulatedPlayerState,
  sourcePlayer: SimulatedPlayerState,
  state: SimulatedRuntimeState,
  options: SimulatedActionOptions,
): boolean {
  const fromZone = findCardZone(owner, card);
  if (!fromZone) return false;
  const protectedFromSource = hasSimulatedProtection(card, "effect_destruction", state.turnCounter || 0,
    { ownerId: owner.id, sourceOwnerId: sourcePlayer.id });
  if (fromZone === "field" && protectedFromSource) return false;
  const wasFaceupBeforeMove = card.isFacedown !== true;
  const effectsNegatedAtFieldExit = card.effectsNegated === true;
  if (!moveCardToZone(owner, card, "graveyard", owner, {
    state, movedByEffect: true, sourceCard: options.sourceCard || null, sourcePlayer,
  })) return false;
  const toZone = findCardZone(owner, card) || "removed";
  const payload = { card, player: owner, fromZone, toZone, wasFaceupBeforeMove,
    effectsNegatedAtFieldExit, wasDestroyed: true, destroyCause: "effect",
    destroySource: options.sourceCard || null, sourceCard: options.sourceCard || null,
    movedByEffect: true, actionContext: options.actionContext };
  if (toZone === "graveyard") options.emitSimulatedEvent?.("card_to_grave", payload);
  options.emitSimulatedEvent?.("card_moved", payload);
  return true;
}

type ScopeFilterKey =
  | "cardKind"
  | "cardName"
  | "name"
  | "cardId"
  | "subtype"
  | "monsterType"
  | "type"
  | "archetype"
  | "archetypes"
  | "requireFaceup"
  | "excludeCardName"
  | "excludeCardNames"
  | "minLevel"
  | "maxLevel"
  | "level"
  | "levelOp"
  | "minAtk"
  | "maxAtk"
  | "minDef"
  | "maxDef"
  | "position"
  | "isToken"
  | "isTuner";
type ScopeFilterValue = CardFilter[keyof CardFilter] | readonly string[];
type MutableScopeFilters = {
  -readonly [Key in ScopeFilterKey]?: ScopeFilterValue;
};
type LegacyActionTargetScope = ActionTargetScope & MutableScopeFilters;

export function applyDestroy(
  ctx: SimulatedActionHandlerContext<"destroy">,
): void;
export function applyDestroy(
  ctx: SimulatedActionHandlerContext<"destroy_targeted_cards">,
): void;
export function applyDestroy(
  ctx:
    | SimulatedActionHandlerContext<"destroy">
    | SimulatedActionHandlerContext<"destroy_targeted_cards">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  targets.forEach((card) => {
    const owner = findCardOwner(state, card);
    if (!owner) return;
    destroySimulatedCard(card, owner, self, state, options);
  });
  return;
}

export function applyDestroyAndDamageByTargetAtk(
  ctx: SimulatedActionHandlerContext<"destroy_and_damage_by_target_atk">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const entries = (Array.isArray(action.entries) ? action.entries : []) as
    readonly DestroyDamageEntry[];
  const destroyed = entries.flatMap((entry) => {
    const entryTargets = resolveTargetsForAction(
      entry,
      selections,
      options,
      opponent,
    );
    return entryTargets.map((card) => ({
      card,
      owner: findCardOwner(state, card),
      damagePlayer: entry.damagePlayer || "owner",
      multiplier: Number.isFinite(entry.multiplier) ? entry.multiplier : 1,
      atk: getEffectiveAtk(card),
    }));
  });
  const successful = destroyed.filter(({ card, owner }) =>
    owner && destroySimulatedCard(card, owner, self, state, options));
  const skipDamage = (playerKey: "self" | "opponent"): boolean => {
    const conditions = action.skipDamageIf?.[playerKey];
    if (!conditions) return false;
    return evaluateSimulatedConditions(conditions as readonly EffectCondition[], {
      state,
      selfId,
      options,
    });
  };
  successful.forEach(({ owner, damagePlayer, multiplier, atk }) => {
    if (!owner) return;
    let recipient: SimulatedPlayerState | null = null;
    if (damagePlayer === "self") recipient = self;
    else if (damagePlayer === "opponent") recipient = opponent;
    else recipient = owner;
    if (!recipient) return;
    const isSelf = recipient === self;
    if (skipDamage(isSelf ? "self" : "opponent")) return;
    recipient.lp = Math.max(
      0,
      (recipient.lp || 0) -
        Math.floor(Math.max(0, atk) * (multiplier as number)),
    );
  });
  return;
}

export function applyDestroyTargetedCards(
  ctx: SimulatedActionHandlerContext<"destroy_targeted_cards">,
): void | typeof STOP_SIMULATION {
  const { action, opponent, self, state, options } = ctx;
  if (action.targetRef || action.targetCountFromContext || action.minTargets !== 0) return applyDestroy(ctx);
  const zones = (action.zones || ["field", "spellTrap", "fieldSpell"])
    .filter(zone => zone === "field" || zone === "spellTrap" || zone === "fieldSpell");
  const candidates = getActionCandidates(opponent, {
    ...action, zones,
  }, "field", options);
  const max = Math.max(0, Math.floor(action.maxTargets || 1));
  const exact = options.activationContext?.decisions?.selections?.destroy_targets;
  const selected = exact !== undefined
    ? resolveExactInstanceSelection(candidates, exact, { min: 0, max })
    : rankCandidates(candidates, "harm", {
        ...options, targetPreference: getTargetPreference(options, "destroy_targets"),
      }).slice(0, max);
  if (selected === null) {
    (state._simUnsupportedActions ??= []).push("exact_selection:destroy_targets");
    return STOP_SIMULATION;
  }
  for (const card of selected) destroySimulatedCard(card, opponent, self, state, options);
}

function resolveScopeOwners(
  scope: ActionTargetScope,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): SimulatedPlayerState[] {
  const ownerRule = scope.owner || scope.player || "self";
  if (ownerRule === "opponent") return opponent ? [opponent] : [];
  if (ownerRule === "any" || ownerRule === "both" || ownerRule === "either") {
    return [self, opponent].filter(Boolean);
  }
  return self ? [self] : [];
}

function buildScopeFilters(scope: LegacyActionTargetScope = {}): CardFilter {
  const filters: MutableScopeFilters = { ...(scope.filters || {}) };
  ([
    "cardKind",
    "cardName",
    "name",
    "cardId",
    "subtype",
    "monsterType",
    "type",
    "archetype",
    "archetypes",
    "requireFaceup",
    "excludeCardName",
    "excludeCardNames",
    "minLevel",
    "maxLevel",
    "level",
    "levelOp",
    "minAtk",
    "maxAtk",
    "minDef",
    "maxDef",
    "position",
    "isToken",
    "isTuner",
  ] as readonly ScopeFilterKey[]).forEach((key) => {
    if (scope[key] !== undefined && filters[key] === undefined) {
      filters[key] = scope[key];
    }
  });
  if (filters.monsterType && filters.type === undefined) {
    filters.type = filters.monsterType;
  }
  return filters as CardFilter;
}

function resolveScopedCards(
  scope: ActionTargetScope,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): ScopedCard[] {
  const zones = Array.isArray(scope.zones)
    ? scope.zones
    : scope.zone
      ? [scope.zone]
      : ["field"];
  const filters = buildScopeFilters(scope);
  const cards: ScopedCard[] = [];
  const seen = new Set<string | number | SimulatedCardState>();

  resolveScopeOwners(scope, self, opponent).forEach((owner) => {
    zones.forEach((zone) => {
      getZoneCards(owner, zone).forEach((card) => {
        const key = getCardInstanceId(card) ?? card;
        if (!card || seen.has(key)) return;
        if (!matchesTargetFilters(card, filters)) return;
        seen.add(key);
        cards.push({ card, owner });
      });
    });
  });

  return cards;
}

export function applyDestroyCardsByScope(
  ctx: SimulatedActionHandlerContext<"destroy_cards_by_scope">,
): void {
  const { action, self, opponent } = ctx;
  const scope = (action.targetScope || {}) as LegacyActionTargetScope;
  const entries = resolveScopedCards(scope, self, opponent);
  let destroyedCount = 0;

  entries.forEach(({ card, owner }) => {
    const actualOwner = owner || findCardOwner(ctx.state, card);
    if (!actualOwner) return;
    if (destroySimulatedCard(card, actualOwner, self, ctx.state, ctx.options)) {
      destroyedCount += 1;
    }
  });

  const drawPerDestroyed = Math.max(0, Number(action.drawPerDestroyed || 0));
  const drawAmount = Math.floor(destroyedCount * drawPerDestroyed);
  if (drawAmount <= 0) return;

  ctx.applySimulatedActions({ state: ctx.state, selfId: ctx.selfId, options: ctx.options,
    actions: [{ type: "draw", amount: drawAmount, player: action.drawPlayer || "self" }] });
  return;
}
