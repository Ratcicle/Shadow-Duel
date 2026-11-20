import { removeTrackedStatChange } from "../actions/stats.js";
import type { DuelEventMap, ResolvableEventName, TurnCardActivationHistory } from "../../contracts/events.js";
import { matchesPositionChangeEvent } from "../triggers/collectors/positionChange.js";
import { cardMatchesEventFilters, matchesZoneFilter } from "../triggers/collectors/shared.js";
import { countTurnCardActivations } from "../../game/events/activationHistory.js";
import type {
  ActionRuntimeCard,
  ActionRuntimePlayer,
  ActionConditionResult,
  ActionHandlerEnginePort,
} from "../../contracts/actionRuntime.js";
import type { ConditionContext } from "../conditions/runtime.js";
import type {
  CardDynamicBuffEntry,
  CardPassiveExtraAttackBonus,
  CardPermanentBuffMap,
} from "../../contracts/cards.js";
import type {
  BanishProtectionSnapshot,
  BanishProtectionSnapshotSource,
  CardFilter,
  EffectDefinition,
  EffectCondition,
  PassiveRuleDefinition,
  EffectOwner,
} from "../../contracts/effects.js";
import type { FilterCard, RuntimeCardFilter } from "../filters/cardFilters.js";
import { isZoneInput, normalizeZoneInput, type CanonicalZone } from "../../contracts/zones.js";
import type { ActionOf, CardAction } from "../../contracts/actions.js";

type PassiveStat = "atk" | "def";
type PassiveStatCard = {
  [Key in "atk" | "def" | "dynamicBuffs" | "suppressedDynamicBuffStatsByKey" |
    "temporarySuppressedDynamicBuffStatsByKey" | "permanentBuffsBySource"]?: ActionRuntimeCard[Key] | undefined;
};
/** Proven origin is private planner capability metadata, never serialized card data. */
type ModeledPassiveFamily = "field_archetype_aura_buff" | "activated_card_count_buff" |
  "field_presence_type_summon_count_buff" | "equipped_field_counter_buff" | "equipped_counter_buff" | "field_counter_stat_aura" |
  "archetype_count_buff" | "graveyard_card_count_buff" | "graveyard_archetype_count_buff" | "graveyard_type_count_buff";
const modeledPassiveContributions = new WeakMap<object, Map<string, ModeledPassiveFamily>>();
type PassiveProofCard = Pick<PassiveStatCard, "dynamicBuffs" | "temporarySuppressedDynamicBuffStatsByKey">;

export function registerModeledPassiveContribution(card: PassiveProofCard, key: string, family: ModeledPassiveFamily): void {
  let contributions = modeledPassiveContributions.get(card);
  const suppression = card.temporarySuppressedDynamicBuffStatsByKey?.[key];
  // A refresh observes today's declaration, not the origin of an inherited
  // suppression. Only proof recorded before that suppression may survive it.
  if ((suppression?.atk === true || suppression?.def === true) && !contributions?.has(key)) return;
  if (!contributions) modeledPassiveContributions.set(card, contributions = new Map());
  contributions.set(key, family);
}

export function getModeledPassiveContributions(card: PassiveProofCard): Array<[string, ModeledPassiveFamily]> {
  return [...(modeledPassiveContributions.get(card) || [])]
    .filter(([key]) => card.dynamicBuffs?.[key] !== undefined || card.temporarySuppressedDynamicBuffStatsByKey?.[key] !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

export function pruneModeledPassiveContributions(card: PassiveProofCard): void {
  const entries = getModeledPassiveContributions(card);
  if (entries.length) modeledPassiveContributions.set(card, new Map(entries));
  else modeledPassiveContributions.delete(card);
}

export function copyModeledPassiveContributions(source: PassiveProofCard, target: PassiveProofCard): void {
  const entries = getModeledPassiveContributions(source).filter(([key]) =>
    target.dynamicBuffs?.[key] !== undefined || target.temporarySuppressedDynamicBuffStatsByKey?.[key] !== undefined);
  if (entries.length) modeledPassiveContributions.set(target, new Map(entries));
  else modeledPassiveContributions.delete(target);
}

export function hasUnmodeledTemporaryPassiveSuppression(card: PassiveProofCard): boolean {
  const proof = modeledPassiveContributions.get(card);
  return Object.entries(card.temporarySuppressedDynamicBuffStatsByKey || {})
    .some(([key, stats]) => (stats.atk === true || stats.def === true) && !proof?.has(key));
}

type PassiveCard = ActionRuntimeCard & {
  extraAttacks?: number;
  equipExtraAttacks?: number;
  equipExtraAttacksApplied?: number;
  passiveExtraAttackBonuses?: Record<string, CardPassiveExtraAttackBonus>;
  passiveExtraAttackTargetRestriction?: string | null;
  fieldPresenceId?: string | number | null;
  fieldPresenceState?: Record<string, number> | null;
  state?: { specialSummonTypeCount?: Record<string, number> } | null;
};
type PassivePlayer = Omit<
  ActionRuntimePlayer,
  | "strategy"
  | "field"
  | "spellTrap"
  | "fieldSpell"
  | "hand"
  | "graveyard"
  | "deck"
  | "banished"
  | "extraDeck"
> & {
  field: PassiveCard[];
  spellTrap: PassiveCard[];
  fieldSpell: PassiveCard | null;
  hand: PassiveCard[];
  graveyard: PassiveCard[];
  deck: PassiveCard[];
  banished: PassiveCard[];
  extraDeck: PassiveCard[];
  opponentCannotActivateDuringBattle?: boolean;
};
export interface RuntimePassive extends Omit<PassiveRuleDefinition, "type"> {
  readonly type:
    | PassiveRuleDefinition["type"]
    | "type_special_summoned_count_buff"
    | "equip_counter_buff";
  readonly requireSourceFaceup?: boolean;
  readonly requireTargetFaceup?: boolean;
  readonly counterRequireFaceup?: boolean;
  readonly counterOwner?: EffectOwner;
  readonly owners?: readonly EffectOwner[];
  readonly zones?: readonly string[];
  readonly zone?: string;
  readonly extraAttacks?: number;
  readonly perCard?: number;
  readonly buffPerCard?: number;
  readonly perCounter?: number;
  readonly buffPerCounter?: number;
  readonly cardNames?: readonly string[];
  readonly names?: readonly string[];
  readonly name?: string;
  readonly scope?: string;
  readonly sourceScope?: string;
  readonly targetArchetype?: string;
  readonly value?: number;
  readonly defBoost?: number;
}
type PassiveEffect = EffectDefinition & { readonly passive?: RuntimePassive };
interface EquipHost {
  isSameCardReference: typeof isSameCardReference;
  getOwnerByCard(
    card: Pick<ActionRuntimeCard, "owner">,
  ): { spellTrap: readonly FilterCard[] } | null;
}
interface PassiveHost {
  game?: {
    turnCounter?: number;
    cardActivationHistory?: TurnCardActivationHistory;
    player?: PassivePlayer;
    bot?: PassivePlayer;
    getOpponent?(player: PassivePlayer | null): PassivePlayer | null;
    getSpecialSummonedTypeCount?(owner: string, type: string): number;
  } | null;
  isSameCardReference: typeof isSameCardReference;
  getOwnerByCard(card: ActionRuntimeCard): PassivePlayer | null;
  findCardZone?(player: PassivePlayer, card: ActionRuntimeCard): string | null;
  isActiveEquipForCard(
    equip: ActionRuntimeCard,
    card: ActionRuntimeCard,
  ): boolean;
  isEffectNegated?(card: ActionRuntimeCard): boolean | null | undefined;
  cardMatchesFilters(
    card: ActionRuntimeCard,
    filters?: RuntimeCardFilter,
  ): boolean;
  cardHasArchetype: typeof cardHasArchetype;
  evaluateConditions?(
    conditions: readonly EffectCondition[],
    ctx: ConditionContext,
  ): ActionConditionResult;
  applyPassiveBuffValue: typeof applyPassiveBuffValue;
}

import { cardMatchesKind } from "../../Card.js";

const IMMEDIATE_EVENT_EFFECT_FIELDS: ReadonlySet<string> = new Set([
  "id", "timing", "passive", "event", "actions", "description", "conditions",
  "requireZone", "requireFaceup", "requirePhase", "changedCardOwner",
  "changedCardRequireFaceup", "changedCardRequireFaceupBeforeChange",
  "eventCardFilters", "positionChangedByEffect", "positionChangeSourceFilters",
]);
const IMMEDIATE_EVENT_ACTION_FIELDS: ReadonlySet<string> = new Set([
  "type", "targetRef", "atkBoost", "defBoost", "duration", "sourceName", "allowEmpty",
]);
// Relationship and zone gates belong to the position event matcher, rather
// than the shared stat-card filter consumed with different runtime contexts.
const IMMEDIATE_EVENT_CARD_FILTER_FIELDS: ReadonlySet<string> = new Set([
  "archetype", "cardId", "cardKind", "cardName", "name", "type", "attribute",
  "requireFaceup", "facedown", "level", "levelOp", "minLevel", "maxLevel",
  "minAtk", "maxAtk", "minDef", "maxDef", "monsterType", "subtype",
  "isToken", "isTuner", "minCounters", "counterType", "excludeCardName",
  "excludeCardNames", "excludeMonsterTypes", "textIncludes",
]);

function unsupportedImmediateFields(value: object, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter(key => Reflect.get(value, key) !== undefined && !allowed.has(key));
}

/** Immediate observers deliberately expose no activation or decision surface. */
export function getImmediateEventEffectValidationError(effect: Omit<EffectDefinition, "targets"> & {
  readonly targets?: readonly object[];
  readonly passive?: PassiveRuleDefinition;
}): string | null {
  const unsupportedFields = unsupportedImmediateFields(effect, IMMEDIATE_EVENT_EFFECT_FIELDS);
  if (unsupportedFields.length) return `event_actions does not support effect fields: ${unsupportedFields.join(", ")}.`;
  if (effect.timing !== "passive" || effect.passive?.type !== "event_actions" ||
      Object.keys(effect.passive).some(key => key !== "type")) {
    return "event_actions requires passive: { type: 'event_actions' } without additional passive-rule fields.";
  }
  if (effect.requirePhase && (!Array.isArray(effect.requirePhase) || effect.requirePhase.length === 0 ||
      effect.requirePhase.some(phase => phase !== "main1" && phase !== "main2"))) {
    return "event_actions requirePhase must contain supported main phases: main1 or main2.";
  }
  if (effect.requireZone && !["field", "spellTrap", "fieldSpell"].includes(effect.requireZone)) {
    return "event_actions observers are only supported in field, spellTrap or fieldSpell.";
  }
  if (effect.changedCardOwner === "both") return "event_actions changedCardOwner supports self, opponent or any.";
  for (const filters of [effect.eventCardFilters, effect.positionChangeSourceFilters]) {
    if (!filters) continue;
    const unsupportedFilters = unsupportedImmediateFields(filters, IMMEDIATE_EVENT_CARD_FILTER_FIELDS);
    if (unsupportedFilters.length) return `event_actions does not support card filter fields: ${unsupportedFilters.join(", ")}.`;
  }
  if (effect.event !== "position_change" || !effect.actions?.length || effect.targets?.length ||
      effect.activationCosts?.length || effect.activationCommitActions?.length || effect.activationCases?.length ||
      effect.triggerRequirement || effect.triggerTiming || effect.oncePerTurn || effect.oncePerDuel ||
      effect.oncePerTurnName || effect.oncePerDuelName || effect.usagePolicy || effect.promptUser) {
    return "event_actions requires position_change and direct actions without targets, costs, activation, choices or usage limits.";
  }
  for (const action of effect.actions) {
    const unsupportedActionFields = unsupportedImmediateFields(action, IMMEDIATE_EVENT_ACTION_FIELDS);
    if (unsupportedActionFields.length) return `event_actions does not support action fields: ${unsupportedActionFields.join(", ")}.`;
    if (action.type !== "buff_stats_temp" || !action.targetRef ||
        !["self", "eventCard", "changedCard"].includes(action.targetRef) || action.targetScope ||
        action.atkBoostFromContext || action.atkBoostFromTarget || action.defBoostFromContext ||
        action.storeAs || action.permanent || action.durationTurns !== undefined || action.expiresOnTurn !== undefined ||
        (action.duration !== undefined && action.duration !== "end_of_turn") ||
        (action.atkBoost !== undefined && !Number.isFinite(action.atkBoost)) ||
        (action.defBoost !== undefined && !Number.isFinite(action.defBoost))) {
      return "event_actions only supports direct buff_stats_temp on self/eventCard/changedCard with numeric stats and end_of_turn duration.";
    }
  }
  return null;
}

/** Applied at the occurrence, before any trigger is captured or queued. */
interface ImmediateEventHost extends Pick<ActionHandlerEnginePort, "game" | "applyActions"> {
  isEffectNegated(card: ActionRuntimeCard): boolean | null | undefined;
  cardMatchesFilters(card: ActionRuntimeCard, filters: object): boolean;
  evaluateConditions(conditions: readonly EffectCondition[], context: import("../../contracts/actionRuntime.js").EffectContext): ActionConditionResult;
}

export async function applyImmediateEventEffects(
  this: ImmediateEventHost,
  eventName: ResolvableEventName,
  payload: DuelEventMap[ResolvableEventName],
): Promise<void> {
  if (eventName !== "position_change" || !("fromPosition" in payload)) return;
  const changedCard = [...this.game.player.field, ...this.game.bot.field].find(card => card === payload.card);
  if (!changedCard) return;
  const changedOwner = this.game.player.field.includes(changedCard) ? this.game.player : this.game.bot;
  const changedOpponent = changedOwner === this.game.player ? this.game.bot : this.game.player;
  const sourceReference = payload.sourceCard === undefined ? payload.source : payload.sourceCard;
  const positionSource = [this.game.player, this.game.bot].flatMap(owner => [
    ...owner.field, ...owner.spellTrap, ...owner.hand, ...owner.deck,
    ...owner.graveyard, ...owner.banished, ...owner.extraDeck,
    ...(owner.fieldSpell ? [owner.fieldSpell] : []),
  ])
    .find(card => card === sourceReference) || null;
  // Snapshot observer order, then revalidate each current source before applying it.
  for (const owner of [changedOwner, changedOpponent]) {
    const opponent = owner === this.game.player ? this.game.bot : this.game.player;
    const sources = [...owner.field, ...owner.spellTrap, ...(owner.fieldSpell ? [owner.fieldSpell] : [])];
    for (const source of sources) {
      const zone = owner.field.includes(source) ? "field" : owner.spellTrap.includes(source) ? "spellTrap" : owner.fieldSpell === source ? "fieldSpell" : null;
      if (!zone || !["field", "spellTrap", "fieldSpell"].includes(zone) || source.isFacedown || this.isEffectNegated(source)) continue;
      for (const effect of source.effects || []) {
        if (!(owner.field.includes(source) || owner.spellTrap.includes(source) || owner.fieldSpell === source) || source.isFacedown || this.isEffectNegated(source)) break;
        if (effect.timing !== "passive" || !("passive" in effect) || effect.passive?.type !== "event_actions" || effect.event !== eventName) continue;
        if (getImmediateEventEffectValidationError(effect) || (effect.requireZone && !matchesZoneFilter(zone, effect.requireZone))) continue;
        if (effect.requirePhase && !effect.requirePhase.some(phase => phase === (this.game.phase || "main1"))) continue;
        if (!matchesPositionChangeEvent(effect, source, changedCard, { ...payload, sourceCard: positionSource, source: positionSource }, {
          sourceOwnerId: owner.id, changedOwnerId: changedOwner.id, changedIsFacedown: changedCard.isFacedown === true,
          matchesEventFilters: filters => cardMatchesEventFilters({
            cardMatchesFilters: (_card, cardFilters) => this.cardMatchesFilters(changedCard, cardFilters || {}),
          }, changedCard, filters, { sourceOwner: { id: owner.id }, eventOwner: { id: changedOwner.id },
            sourceCard: source, fromZone: "field", toZone: "field" }),
          matchesSourceFilters: (card, filters) => !!card && this.cardMatchesFilters(card, filters),
        })) continue;
        const ctx = { source, player: owner, opponent, effect, eventCard: changedCard, changedCard,
          eventPlayer: changedOwner, eventOpponent: changedOpponent, effectId: effect.id };
        if (effect.conditions && !this.evaluateConditions(effect.conditions, ctx).ok) continue;
        await this.applyActions(effect.actions || [], ctx, { self: [source], eventCard: [changedCard], changedCard: [changedCard] });
      }
    }
  }
}

export function cardHasArchetype(
  card: ActionRuntimeCard | null | undefined,
  archetype: string | null | undefined,
) {
  if (!card || !archetype) return false;
  if (card.archetype === archetype) return true;
  if (Array.isArray(card.archetypes)) {
    return card.archetypes.includes(archetype);
  }
  return false;
}

interface CardInstanceReference {
  readonly instanceId?: number | string | null | undefined;
}

interface EquipCardView extends CardInstanceReference {
  readonly cardKind?: string | null | undefined;
  readonly subtype?: string | null | undefined;
  readonly equippedTo?: CardInstanceReference | null | undefined;
  readonly equipTarget?: CardInstanceReference | string | number | null | undefined;
}

export function isSameCardReference(
  ref:
    | CardInstanceReference
    | string
    | number
    | null
    | undefined,
  card: CardInstanceReference | null | undefined,
) {
  if (!ref || !card) return false;
  if (ref === card) return true;
  if (typeof ref === "object") {
    if (ref.instanceId != null && card.instanceId != null) {
      return ref.instanceId === card.instanceId;
    }
    return false;
  }
  if (card.instanceId != null && String(ref) === String(card.instanceId)) {
    return true;
  }
  return false;
}

/** Shared read-only equip eligibility for the runtime and planning snapshots. */
export function isActiveEquipInZone<Card extends EquipCardView>(
  equip: Card,
  card: Card,
  spellTrap: readonly Card[],
  sameReference: typeof isSameCardReference = isSameCardReference,
): boolean {
  if (equip.cardKind !== "spell" || equip.subtype !== "equip") return false;
  if (!sameReference(equip.equippedTo, card) && !sameReference(equip.equipTarget, card)) return false;
  return spellTrap.includes(equip);
}

export function isActiveEquipForCard(
  this: EquipHost,
  equip: FilterCard | null | undefined,
  card: FilterCard | null | undefined,
) {
  if (!equip || !card) return false;
  const equipOwner = this.getOwnerByCard(equip);
  if (!equipOwner) return false;
  return isActiveEquipInZone(equip, card, equipOwner.spellTrap, this.isSameCardReference);
}

function getPassiveBuffStats(
  entry: CardDynamicBuffEntry | null | undefined,
  fallback: readonly PassiveStat[] = ["atk", "def"],
): readonly PassiveStat[] {
  return Array.isArray(entry?.stats) ? entry.stats : fallback;
}

function getPassiveBuffAppliedValue(
  entry: CardDynamicBuffEntry | null | undefined,
  stat: PassiveStat,
) {
  const perStatValue = entry?.appliedValues?.[stat];
  if (Number.isFinite(Number(perStatValue))) {
    return Number(perStatValue);
  }
  return Number(entry?.value || 0);
}

function passiveSourceEffectsAreNegated(
  engine: PassiveHost,
  card: ActionRuntimeCard | null | undefined,
) {
  if (!card) return false;
  if (typeof engine?.isEffectNegated === "function") {
    return engine.isEffectNegated(card);
  }
  return card.effectsNegated === true;
}

/** Continuous rules share the same face-up and negation gate in every projection. */
export function isPassiveSourceActive(card: {
  readonly isFacedown?: boolean | undefined;
  readonly effectsNegated?: boolean | undefined;
} | null | undefined): boolean {
  return !!card && card.isFacedown !== true && card.effectsNegated !== true;
}

interface LpGainMultiplierSource {
  readonly cardKind?: string | undefined;
  readonly isFacedown?: boolean | undefined;
  readonly effectsNegated?: boolean | undefined;
  readonly effects?: readonly EffectDefinition[] | undefined;
}

/**
 * Decision V3 (16/11/2026): the highest lp_gain_multiplier among a player's
 * active monsters, read when the gain happens. A negated or face-down source
 * does not apply. Runtime, simulation and the Bot's battle step share it.
 */
export function getLpGainMultiplier(field: readonly (LpGainMultiplierSource | null | undefined)[] | null | undefined): number {
  let multiplier = 1;
  for (const card of field || []) {
    if (!card || card.cardKind !== "monster" || !isPassiveSourceActive(card)) continue;
    for (const effect of card.effects || []) {
      if (effect.timing !== "passive" || !("passive" in effect) || effect.passive?.type !== "lp_gain_multiplier") continue;
      multiplier = Math.max(multiplier, Number(effect.passive.multiplier) || 1);
    }
  }
  return multiplier;
}

/** An LP cost reducer applies only while its source is active; allowFacedown waives the face only. */
export function isLpCostReducerActive(card: {
  readonly isFacedown?: boolean | undefined;
  readonly effectsNegated?: boolean | undefined;
}, allowFacedown: boolean): boolean {
  return isPassiveSourceActive(allowFacedown ? { effectsNegated: card.effectsNegated } : card);
}

interface BattleProtectionEquipView {
  readonly grantsBattleIndestructible?: boolean | null | undefined;
  readonly isFacedown?: boolean | undefined;
  readonly effectsNegated?: boolean | undefined;
}

interface BattleProtectionHostView<Equip> {
  readonly equips?: readonly (Equip | null | undefined)[] | null | undefined;
}

/**
 * User rule D12 (15/10/2026): an attached Equip that grants battle protection
 * keeps it while that Equip is face-up and not negated. Negating the host, or
 * the host's own status rule lapsing, does not end it; negating or removing
 * the Equip does. The runtime producer, the battle check and planning share it.
 */
export function isBattleIndestructibleGrantedByEquip<Equip extends BattleProtectionEquipView>(
  card: BattleProtectionHostView<Equip>,
  isAttached: (equip: Equip) => boolean,
): boolean {
  return (card.equips || []).some(equip => !!equip &&
    equip.grantsBattleIndestructible === true && isPassiveSourceActive(equip) && isAttached(equip));
}

/**
 * D12 on a monster that no status rule of its own reconciled in this pass:
 * its Equips are the only declared source of the flag, which follows them.
 * The status producers reconcile a monster with such a rule, Equips included.
 */
export function refreshEquipBattleIndestructible<Equip extends BattleProtectionEquipView>(
  card: BattleProtectionHostView<Equip> & { battleIndestructible?: boolean | undefined },
  isAttached: (equip: Equip) => boolean,
): boolean {
  if (!(card.equips || []).some(equip => equip?.grantsBattleIndestructible === true)) return false;
  const granted = isBattleIndestructibleGrantedByEquip(card, isAttached);
  if (granted === (card.battleIndestructible === true)) return false;
  card.battleIndestructible = granted;
  return true;
}

interface GraveReplacementSource {
  readonly isFacedown?: boolean | undefined;
  readonly effectsNegated?: boolean | undefined;
  readonly effects?: readonly EffectDefinition[] | undefined;
}

interface GraveReplacementPlayer {
  readonly field?: readonly GraveReplacementSource[] | undefined;
}

/** One active send_to_grave_replacement that matches a card going to the GY. */
interface SendToGraveReplacementMatch<Source, Player> {
  readonly zone: CanonicalZone;
  readonly source: Source;
  readonly controller: Player;
}

/** Every active continuous replacement that matches, in scan order (player, then bot). */
function findSendToGraveReplacements<Source extends GraveReplacementSource, Player extends GraveReplacementPlayer & {
  readonly field?: readonly Source[] | undefined;
}>(
  card: object,
  fromOwner: Player,
  players: readonly (Player | null | undefined)[],
): SendToGraveReplacementMatch<Source, Player>[] {
  const matches: SendToGraveReplacementMatch<Source, Player>[] = [];
  for (const controller of players) {
    if (!controller) continue;
    for (const source of controller.field || []) {
      if (source === card || !isPassiveSourceActive(source)) continue;
      for (const effect of source.effects || []) {
        if (effect.timing !== "passive" || !("passive" in effect) || effect.passive?.type !== "send_to_grave_replacement") continue;
        const ownerRule = effect.passive.targetOwner || "opponent";
        if ((ownerRule === "self" && controller !== fromOwner) ||
            (ownerRule === "opponent" && controller === fromOwner)) continue;
        matches.push({ zone: effect.passive.redirectTo || "banished", source, controller });
        break;
      }
    }
  }
  return matches;
}

interface BanishProtectionSourceView {
  readonly isFacedown?: boolean | undefined;
  readonly effectsNegated?: boolean | undefined;
  readonly effects?: readonly EffectDefinition[] | undefined;
}

interface BanishProtectionHolderView<Card> {
  readonly id?: string | undefined;
  readonly field?: readonly Card[] | undefined;
  readonly spellTrap?: readonly Card[] | undefined;
  readonly fieldSpell?: Card | null | undefined;
}

/**
 * Decision V5 / P1 (18/11/2026): the banish_protection sources active at one
 * instant. An operation that moves several cards together (materials,
 * Tributes, mass destruction, several targets) takes it once at its start, so
 * a protector leaving in the same operation still protects the others. The
 * runtime and the simulation share it; it is never serialized.
 */
export function captureBanishProtectionSnapshot<
  Card extends BanishProtectionSourceView,
  Player extends BanishProtectionHolderView<Card>,
>(players: readonly (Player | null | undefined)[]): BanishProtectionSnapshot<Card, Player> {
  const sources: BanishProtectionSnapshotSource<Card, Player>[] = [];
  for (const controller of players) {
    if (!controller) continue;
    const zones: ReadonlyArray<readonly [BanishProtectionSnapshotSource["zone"], readonly Card[]]> = [
      ["field", controller.field || []],
      ["spellTrap", controller.spellTrap || []],
      ["fieldSpell", controller.fieldSpell ? [controller.fieldSpell] : []],
    ];
    for (const [zone, cards] of zones) {
      for (const source of cards) {
        if (!source || !isPassiveSourceActive(source)) continue;
        for (const effect of source.effects || []) {
          if (effect.timing !== "passive" || !("passive" in effect) || effect.passive?.type !== "banish_protection") continue;
          if (effect.requireZone && effect.requireZone !== zone) continue;
          sources.push({ source, controller, zone, passive: effect.passive });
        }
      }
    }
  }
  return { sources };
}

/**
 * P1 for one operation: a snapshot when it moves two or more cards together,
 * none for a single move, which reads the live field when it leaves.
 */
export function captureSimultaneousBanishProtection<
  Card extends BanishProtectionSourceView,
  Player extends BanishProtectionHolderView<Card>,
>(
  players: readonly (Player | null | undefined)[],
  movingCardCount: number,
): BanishProtectionSnapshot<Card, Player> | undefined {
  return movingCardCount > 1 ? captureBanishProtectionSnapshot<Card, Player>(players) : undefined;
}

/** Who a banish is attributed to: a direct banish's mover, or the controller of a redirect. */
export interface BanishAttribution {
  readonly byEffect: boolean;
  readonly controllerId: string | null;
}

type MutableProtectionFilters = { -readonly [Key in keyof CardFilter]?: CardFilter[Key] };

function buildBanishProtectionFilters(passive: PassiveRuleDefinition): CardFilter {
  const scope = passive.targetScope;
  const filters: MutableProtectionFilters = { ...(scope?.filters || passive.filters || {}) };
  if (filters.cardKind === undefined && passive.cardKind !== undefined) filters.cardKind = passive.cardKind;
  if (filters.cardName === undefined && passive.cardName !== undefined) filters.cardName = passive.cardName;
  if (filters.archetype === undefined && passive.archetype !== undefined) filters.archetype = passive.archetype;
  const requireFaceup = scope?.requireFaceup ?? passive.requireFaceup;
  if (filters.requireFaceup === undefined && requireFaceup !== undefined) filters.requireFaceup = requireFaceup;
  return filters;
}

/**
 * The protection that forbids banishing `card` from `cardZone` while `holder`
 * holds it, read from a snapshot. `protectFrom: "opponent_effects"` compares
 * the attribution with the holder; without `protectFrom` any banish is
 * forbidden. The filter reader is injected by the runtime or the simulation.
 */
export function findBanishProtection<Card, Player extends { readonly id?: string | undefined }>(
  snapshot: BanishProtectionSnapshot<Card, Player>,
  card: Card,
  holder: Player,
  cardZone: CanonicalZone,
  attribution: BanishAttribution,
  matchesFilters: (card: Card, filters: CardFilter) => boolean,
): BanishProtectionSnapshotSource<Card, Player> | null {
  for (const entry of snapshot.sources) {
    const { passive, controller, source } = entry;
    if (passive.protectFrom === "opponent_effects" &&
        (!attribution.byEffect || attribution.controllerId === null || attribution.controllerId === holder.id)) continue;
    const scope = passive.targetScope;
    const ownerRule = scope?.owner || passive.targetOwner || "self";
    if ((ownerRule === "self" && controller !== holder) ||
        (ownerRule === "opponent" && controller === holder)) continue;
    const zones = scope?.zones ?? (scope?.zone ? [scope.zone] : ["field"]);
    if (!zones.includes(cardZone)) continue;
    if (scope?.excludeSelf === true && source === card) continue;
    const filters = buildBanishProtectionFilters(passive);
    if (Object.keys(filters).length > 0 && !matchesFilters(card, filters)) continue;
    return entry;
  }
  return null;
}

export type BanishRedirectKind = "send_to_grave_replacement" | "leaves_field_clause";

/** A redirect that sends a departing card elsewhere; the banish is its controller's. */
export interface BanishRedirect<Card, Player> {
  readonly kind: BanishRedirectKind;
  readonly zone: CanonicalZone;
  readonly controllerId: string | null;
  /** The replacement source; null for the leaves-the-field clause. */
  readonly source: Card | null;
  readonly sourceController: Player | null;
}

export interface ForbiddenBanishRedirect<Card, Player> extends BanishRedirect<Card, Player> {
  readonly protection: BanishProtectionSnapshotSource<Card, Player>;
}

export interface DepartureProjection<Card, Player> {
  /** Where the card goes before the original-owner and Extra Deck rules. */
  readonly toZone: CanonicalZone;
  readonly applied: BanishRedirect<Card, Player> | null;
  readonly forbidden: readonly ForbiddenBanishRedirect<Card, Player>[];
}

interface DepartingCardView extends GraveReplacementSource, BanishProtectionSourceView {
  readonly isToken?: boolean | undefined;
  readonly banishWhenLeavesField?: boolean | undefined;
  readonly originalOwner?: string | undefined;
}

export interface DepartureProjectionInput<Card, Player> {
  readonly card: Card;
  /** The player whose zone holds the card now. */
  readonly holder: Player;
  readonly fromZone: CanonicalZone | null;
  readonly requestedZone: CanonicalZone;
  /** Both players, in scan order; a projection without them sees only the holder. */
  readonly players: readonly (Player | null | undefined)[];
  readonly skipSendToGraveReplacement?: boolean | undefined;
  /** Whose protections a snapshot taken here reads; defaults to `players`. */
  readonly protectionPlayers?: readonly (Player | null | undefined)[] | undefined;
  readonly matchesFilters: (card: Card, filters: CardFilter) => boolean;
  /** P1: the protections of the operation's start; captured now when absent. */
  readonly banishProtectionSnapshot?: BanishProtectionSnapshot<Card, Player> | undefined;
}

/**
 * Decision V5 (16/11/2026): where a departing card goes and to whom a banish
 * by redirect is attributed, decided once while the card is still in its zone.
 * - send_to_grave_replacement (Macro Cosmos style): the first active source
 *   that may banish the card wins; its controller banishes. A protection is
 *   read only when the replacement zone is the banished zone.
 * - banishWhenLeavesField: the card's original owner applied the clause.
 * A forbidden redirect leaves the requested (original) destination. A direct
 * banish (`requestedZone === "banished"`) is not projected here: its
 * protection refuses the move instead. Pure: nothing is mutated.
 */
export function projectDepartureDestination<
  Card extends DepartingCardView,
  Player extends GraveReplacementPlayer & BanishProtectionHolderView<Card>,
>(input: DepartureProjectionInput<Card, Player>): DepartureProjection<Card, Player> {
  const { card, holder, fromZone, requestedZone } = input;
  let snapshot = input.banishProtectionSnapshot ?? null;
  const protectionFor = (redirect: BanishRedirect<Card, Player>) => {
    if (redirect.zone !== "banished" || !fromZone) return null;
    snapshot ??= captureBanishProtectionSnapshot<Card, Player>(input.protectionPlayers ?? input.players);
    return findBanishProtection(snapshot, card, holder, fromZone,
      { byEffect: true, controllerId: redirect.controllerId }, input.matchesFilters);
  };
  const forbidden: ForbiddenBanishRedirect<Card, Player>[] = [];
  let toZone = requestedZone;
  let applied: BanishRedirect<Card, Player> | null = null;
  if (requestedZone === "graveyard" && card.isToken !== true && input.skipSendToGraveReplacement !== true) {
    for (const match of findSendToGraveReplacements<Card, Player>(card, holder, input.players)) {
      const redirect: BanishRedirect<Card, Player> = { kind: "send_to_grave_replacement", zone: match.zone,
        controllerId: match.controller.id ?? null, source: match.source, sourceController: match.controller };
      const protection = protectionFor(redirect);
      if (protection) {
        forbidden.push({ ...redirect, protection });
        continue;
      }
      if (match.zone !== requestedZone) {
        toZone = match.zone;
        applied = redirect;
      }
      break;
    }
  }
  if (fromZone === "field" && toZone !== "field" && toZone !== "banished" &&
      card.banishWhenLeavesField === true && card.isToken !== true) {
    const redirect: BanishRedirect<Card, Player> = { kind: "leaves_field_clause", zone: "banished",
      controllerId: card.originalOwner ?? holder.id ?? null, source: null, sourceController: null };
    const protection = protectionFor(redirect);
    if (protection) {
      forbidden.push({ ...redirect, protection });
    } else {
      toZone = "banished";
      applied = redirect;
    }
  }
  return { toZone, applied, forbidden };
}

/**
 * Whether a card paid as a cost with `requireDestination` arrives where the
 * cost sends it (decision V10). One predicate for the preview, the payment
 * and the cost candidate list: a Token leaving the field disappears, an
 * Extra Deck monster sent to the Deck (or to the hand without permission)
 * returns to the Extra Deck, and a V5 redirect leads elsewhere.
 */
export function canReachRequiredDestination<
  Card extends DepartingCardView & { readonly monsterType?: string | null | undefined },
  Player extends GraveReplacementPlayer & BanishProtectionHolderView<Card>,
>(input: DepartureProjectionInput<Card, Player> & { readonly allowExtraDeckMonsterToHand: boolean }): boolean {
  const { card, requestedZone } = input;
  if (card.isToken === true && requestedZone !== "field") return false;
  const extraDeckMonster = card.monsterType === "fusion" || card.monsterType === "synchro" ||
    card.monsterType === "ascension";
  if (extraDeckMonster && (requestedZone === "deck" ||
      (requestedZone === "hand" && !input.allowExtraDeckMonsterToHand))) return false;
  return projectDepartureDestination(input).toZone === requestedZone;
}

/** A destination-bound activation cost and the zone it sends a card to. */
export interface DestinationBoundCost {
  readonly action: ActionOf<"move"> | ActionOf<"return_to_hand">;
  readonly requestedZone: CanonicalZone;
}

/**
 * The activation cost that pays with the cards of one target definition and
 * requires them to reach its destination, if any. Resolution actions with
 * `requireDestination` are not costs and are not read here.
 */
export function findDestinationBoundCost(
  effect: { readonly activationCosts?: readonly CardAction[] | undefined } | null | undefined,
  targetId: string | null | undefined,
): DestinationBoundCost | null {
  if (!targetId) return null;
  for (const action of effect?.activationCosts ?? []) {
    if (action.type !== "move" && action.type !== "return_to_hand") continue;
    if (action.targetRef !== targetId || action.requireDestination !== true) continue;
    const zone = action.type === "return_to_hand" ? "hand" : action.to;
    if (!isZoneInput(zone)) continue;
    return { action, requestedZone: normalizeZoneInput(zone) };
  }
  return null;
}

interface EquipAttackBonusSource {
  equipExtraAttacks?: number;
  equipExtraAttacksApplied?: number;
}

interface EquipAttackBonusTarget {
  extraAttacks?: number;
  attacksUsedThisTurn?: number;
  hasAttacked?: boolean | undefined;
}

/** Keep the configured equip bonus separate from its currently active contribution. */
export function refreshEquipExtraAttackBonus(
  equip: EquipAttackBonusSource,
  host: EquipAttackBonusTarget,
  enabled: boolean,
): boolean {
  const previous = Math.max(0, Number(equip.equipExtraAttacksApplied ?? equip.equipExtraAttacks ?? 0));
  const next = enabled ? Math.max(0, Number(equip.equipExtraAttacks || 0)) : 0;
  equip.equipExtraAttacksApplied = next;
  if (previous === next) return false;
  host.extraAttacks = Math.max(0, Number(host.extraAttacks || 0) - previous + next);
  host.hasAttacked = Number(host.attacksUsedThisTurn || 0) >= 1 + host.extraAttacks;
  return true;
}

interface EquipStatBonusSource {
  equipAtkBonus?: number | undefined;
  equipDefBonus?: number | undefined;
  equipAtkBonusSuspended?: number | undefined;
  equipDefBonusSuspended?: number | undefined;
}

interface EquipStatBonusTarget {
  atk?: number | undefined;
  def?: number | undefined;
  permanentBuffsBySource?: CardPermanentBuffMap | null | undefined;
}

const EQUIP_STAT_BONUS_KEYS = [
  ["atk", "equipAtkBonus", "equipAtkBonusSuspended"],
  ["def", "equipDefBonus", "equipDefBonusSuspended"],
] as const;

/**
 * Decision V1 (16/11/2026): a negated or face-down Equip applies none of its
 * effects. Its fixed ATK/DEF bonus is withheld while it is inactive and comes
 * back when it is active again. `equipAtkBonus`/`equipDefBonus` keep meaning
 * the amount currently included in the host's stats; the withheld amount only
 * exists on an Equip that is withholding one.
 */
export function refreshEquipStatBonus(
  equip: EquipStatBonusSource,
  host: EquipStatBonusTarget,
  enabled: boolean,
): boolean {
  let changed = false;
  for (const [stat, appliedKey, suspendedKey] of EQUIP_STAT_BONUS_KEYS) {
    if (typeof host[stat] !== "number") continue;
    const applied = Number(equip[appliedKey] || 0);
    const suspended = Number(equip[suspendedKey] || 0);
    if (enabled && suspended !== 0) {
      host[stat] = (host[stat] ?? 0) + suspended;
      equip[appliedKey] = applied + suspended;
      delete equip[suspendedKey];
      changed = true;
    } else if (!enabled && applied !== 0) {
      removeTrackedStatChange(host, stat, applied);
      equip[suspendedKey] = suspended + applied;
      equip[appliedKey] = 0;
      changed = true;
    }
  }
  return changed;
}

/** Forget a withheld Equip bonus when the Equip detaches or leaves. */
export function clearSuspendedEquipStatBonus(equip: EquipStatBonusSource): void {
  delete equip.equipAtkBonusSuspended;
  delete equip.equipDefBonusSuspended;
}

function clearPassiveBuffEntry(
  card: PassiveStatCard | null | undefined,
  entry: CardDynamicBuffEntry | null | undefined,
) {
  if (!card || !entry) return false;
  let changed = false;
  for (const stat of getPassiveBuffStats(entry)) {
    if (typeof card[stat] !== "number") continue;
    const appliedValue = getPassiveBuffAppliedValue(entry, stat);
    if (appliedValue === 0) continue;
    removeTrackedStatChange(card, stat, appliedValue);
    changed = true;
  }
  return changed;
}

function addSuppressedPassiveStats(
  result: Set<string>,
  entry:
    | true
    | readonly string[]
    | Set<string>
    | { atk?: boolean; def?: boolean }
    | null
    | undefined,
) {
  if (!entry) return null;
  if (entry === true) {
    result.add("atk");
    result.add("def");
    return result;
  }
  if (Array.isArray(entry) || entry instanceof Set) {
    for (const stat of entry) result.add(stat);
    return result;
  }
  if (typeof entry === "object") {
    for (const [stat, value] of Object.entries(entry)) {
      if (value === true) result.add(stat);
    }
  }
  return result;
}

function getSuppressedPassiveStats(
  card: PassiveStatCard | null | undefined,
  effectKey: string,
) {
  if (!card || !effectKey) return null;
  const result = new Set<string>();
  addSuppressedPassiveStats(
    result,
    card.suppressedDynamicBuffStatsByKey?.[effectKey],
  );
  addSuppressedPassiveStats(
    result,
    card.temporarySuppressedDynamicBuffStatsByKey?.[effectKey],
  );
  return result.size > 0 ? result : null;
}

/** Keep clamped temporary reductions separate from the auras they suppress. */
export function suppressTemporaryDynamicStatIncreasesForDebuff(
  card: PassiveStatCard | null | undefined,
  stat: PassiveStat,
  boost: number,
): number {
  if (!card || !Number.isFinite(boost) || boost >= 0) return 0;
  const entries = Object.entries(card.dynamicBuffs || {})
    .filter(([, entry]) => getPassiveBuffStats(entry).includes(stat))
    .map(([key, entry]) => ({ key, entry, applied: getPassiveBuffAppliedValue(entry, stat) }))
    .filter(({ applied }) => applied > 0);
  const current = Number(card[stat] || 0);
  const total = entries.reduce((sum, { applied }) => sum + applied, 0);
  if (current - total + boost > 0) return 0;

  let suppressed = 0;
  for (const { key, entry, applied } of entries) {
    const actual = Math.min(applied, Math.max(0, Number(card[stat] || 0)));
    if (actual <= 0) continue;
    card[stat] = Math.max(0, Number(card[stat] || 0) - actual);
    const map = card.temporarySuppressedDynamicBuffStatsByKey ||= {};
    map[key] = { ...map[key], [stat]: true };
    entry.appliedValues ||= {};
    entry.appliedValues[stat] = applied - actual;
    suppressed += actual;
  }
  return suppressed;
}

export function applyPassiveBuffValue(
  card: PassiveStatCard | null | undefined,
  effectKey: string,
  amount: number,
  stats: PassiveStat | readonly PassiveStat[] = ["atk", "def"],
) {
  if (!card) return false;
  card.dynamicBuffs = card.dynamicBuffs || {};
  const requestedStats: readonly PassiveStat[] = Array.isArray(stats)
    ? stats
    : [stats as PassiveStat];
  const suppressedStats =
    Number(amount || 0) > 0 ? getSuppressedPassiveStats(card, effectKey) : null;
  const normalizedStats = suppressedStats
    ? requestedStats.filter((stat) => !suppressedStats.has(stat))
    : requestedStats;
  const previousEntry = card.dynamicBuffs[effectKey];
  const previousValue = previousEntry?.value || 0;
  const previousStats = getPassiveBuffStats(previousEntry, requestedStats);
  const statsChanged =
    previousEntry &&
    (previousStats.length !== normalizedStats.length ||
      previousStats.some((stat) => !normalizedStats.includes(stat)));

  // Reconcile positive contributions by their difference. Removing and then
  // reapplying them would erase a persistent reduction at the zero floor.
  if (previousEntry && previousValue > 0 && amount > 0 && !statsChanged) {
    const delta = amount - previousValue;
    if (delta === 0) return false;
    for (const stat of normalizedStats) {
      if (typeof card[stat] !== "number") continue;
      if (delta < 0) removeTrackedStatChange(card, stat, -delta);
      else card[stat] += delta;
      previousEntry.appliedValues ??= {};
      previousEntry.appliedValues[stat] = getPassiveBuffAppliedValue(previousEntry, stat) + delta;
    }
    previousEntry.value = amount;
    return true;
  }

  if (previousEntry) {
    clearPassiveBuffEntry(card, previousEntry);
  }

  if (amount === 0 || normalizedStats.length === 0) {
    delete card.dynamicBuffs[effectKey];
    if (Object.keys(card.dynamicBuffs).length === 0) {
      card.dynamicBuffs = null;
    }
    return previousValue !== 0 || statsChanged;
  }

  const appliedValues: Partial<Record<PassiveStat, number>> = {};
  let appliedAnyStat = false;
  for (const stat of normalizedStats) {
    if (typeof card[stat] !== "number") continue;
    const current = Number(card[stat] || 0);
    const next = Math.max(0, current + amount);
    const appliedValue = next - current;
    card[stat] = next;
    appliedValues[stat] = appliedValue;
    if (appliedValue !== 0) {
      appliedAnyStat = true;
    }
  }

  card.dynamicBuffs[effectKey] = {
    value: amount,
    stats: normalizedStats,
    appliedValues,
  };

  return previousValue !== amount || statsChanged || appliedAnyStat;
}

/** Stable source identity lets live and simulated state remove one aura contribution. */
export function getFieldAuraBuffKey(
  card: { id?: number | undefined; duelCardId?: number | null | undefined; instanceId?: string | number | null | undefined;
    fieldPresenceId?: string | number | null | undefined },
  effectId: string | undefined,
  effectIndex: number,
  fieldIndex: number,
  stat: PassiveStat,
): string {
  const sourceKey = card.fieldPresenceId || card.duelCardId || card.instanceId || `${card.id}_${fieldIndex}`;
  return `${effectId || `passive_${card.id}_${effectIndex}_field_aura`}_${sourceKey}_${stat}`;
}

/** Each recipient's counter total has one contribution per source presence. */
export function getFieldCounterStatAuraBuffKey(
  source: Parameters<typeof getFieldAuraBuffKey>[0],
  effectId: string | undefined,
  effectIndex: number,
  sourceIndex: number,
  counterType: string,
): string {
  const sourceKey = source.fieldPresenceId || source.duelCardId || source.instanceId || `${source.id}_${sourceIndex}`;
  return `${effectId || `passive_${source.id}_${effectIndex}_field_counter_aura`}_${sourceKey}_${counterType}`;
}

/** Use the runtime key for an equipped counter contribution. */
export function getEquippedCounterBuffKey(
  source: Parameters<typeof getFieldAuraBuffKey>[0],
  effectId: string | undefined,
  effectIndex: number,
  sourceIndex: number,
): string {
  const sourceKey = source.fieldPresenceId || source.duelCardId || source.instanceId || `${source.id}_${sourceIndex}`;
  return effectId || `passive_${source.id}_${effectIndex}_${sourceKey}_counter_equip`;
}

/** Equip counter and fixed components reconcile independently for each source. */
export function getEquippedFieldCounterBuffKeys(
  source: Parameters<typeof getFieldAuraBuffKey>[0],
  effectId: string | undefined,
  effectIndex: number,
  sourceIndex: number,
): { counterKey: string; fixedDefKey: string } {
  const sourceKey = source.fieldPresenceId || source.duelCardId || source.instanceId || `${source.id}_${sourceIndex}`;
  const baseKey = effectId || `passive_${source.id}_${effectIndex}_${sourceKey}_field_counter_equip`;
  return {
    counterKey: `${baseKey}_${sourceKey}_${effectIndex}_counter`,
    fixedDefKey: `${baseKey}_${sourceKey}_fixed_def`,
  };
}

/** Remove this source's continuous contributions before its field identity is cleared. */
export function removeFieldAuraBuffContributions(
  source: Parameters<typeof getFieldAuraBuffKey>[0] & PassiveStatCard & { effects?: readonly EffectDefinition[] | undefined },
  recipients: readonly PassiveStatCard[],
  sourceFieldIndex: number,
): void {
  source.effects?.forEach((effect, index) => {
    if (effect.timing !== "passive" || !("passive" in effect)) return;
    if (effect.passive?.type === "activated_card_count_buff") {
      applyPassiveBuffValue(source, effect.id || `passive_${source.id}_${index}_activations`, 0,
        effect.passive.stats || ["atk", "def"]);
      return;
    }
    if (effect.passive?.type === "field_counter_stat_aura") {
      const key = getFieldCounterStatAuraBuffKey(source, effect.id, index, sourceFieldIndex,
        effect.passive.counterType || "default");
      for (const recipient of recipients) {
        applyPassiveBuffValue(recipient, key, 0, effect.passive.stats || ["atk", "def"]);
      }
      return;
    }
    if (effect.passive?.type !== "field_archetype_aura_buff") return;
    for (const stat of ["atk", "def"] as const) {
      const key = getFieldAuraBuffKey(source, effect.id, index, sourceFieldIndex, stat);
      for (const recipient of recipients) {
        if (recipient.dynamicBuffs?.[key]) applyPassiveBuffValue(recipient, key, 0, [stat]);
      }
    }
  });
}

type PassiveCleanupCard = PassiveStatCard & Pick<PassiveCard, "passiveExtraAttackBonuses" | "passiveExtraAttackTargetRestriction" | "extraAttacks">;

export function clearPassiveBuffsForCard(card: PassiveCleanupCard | null | undefined) {
  if (!card) return;
  clearPassiveExtraAttacksForCard(card);
  if (card.dynamicBuffs) {
    for (const entry of Object.values(card.dynamicBuffs)) {
      clearPassiveBuffEntry(card, entry);
    }
    card.dynamicBuffs = null;
  }
  delete card.suppressedDynamicBuffStatsByKey;
  delete card.temporarySuppressedDynamicBuffStatsByKey;
  modeledPassiveContributions.delete(card);
}

/** Remove a card's own passive extra attacks; planning reuses it for a negated source. */
export function clearPassiveExtraAttacksForCard(card: PassiveCleanupCard | null | undefined) {
  if (!card?.passiveExtraAttackBonuses) {
    if (card) delete card.passiveExtraAttackTargetRestriction;
    return false;
  }
  let changed = false;
  for (const entry of Object.values(card.passiveExtraAttackBonuses)) {
    const amount = Math.max(0, Number(entry?.amount || 0));
    if (amount <= 0) continue;
    card.extraAttacks = Math.max(0, Number(card.extraAttacks || 0) - amount);
    changed = true;
  }
  card.passiveExtraAttackBonuses = {};
  delete card.passiveExtraAttackTargetRestriction;
  return changed;
}

function applyPassiveExtraAttacks(
  card: PassiveCard | null | undefined,
  effectKey: string,
  amount: number,
  targetRestriction: string | null = null,
) {
  if (!card || !effectKey) return false;
  const normalizedAmount = Math.max(0, Number(amount || 0));
  if (normalizedAmount <= 0) return false;
  card.passiveExtraAttackBonuses = card.passiveExtraAttackBonuses || {};
  card.extraAttacks =
    Math.max(0, Number(card.extraAttacks || 0)) + normalizedAmount;
  card.passiveExtraAttackBonuses[effectKey] = {
    amount: normalizedAmount,
    targetRestriction: targetRestriction || null,
  };
  if (targetRestriction) {
    card.passiveExtraAttackTargetRestriction = targetRestriction;
  }
  return true;
}

function normalizePassiveList<T>(
  value: T | readonly T[] | null | undefined,
  fallback: readonly T[] = [],
): readonly T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return fallback;
  return [value as T];
}

function getPassiveZoneCards(
  player: PassivePlayer | null | undefined,
  zone: string,
): PassiveCard[] {
  if (!player || !zone) return [];
  if (zone === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  const cards: unknown = (player as PassivePlayer & Record<string, unknown>)[
    zone
  ];
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function getPassiveCounterOwners(
  engine: PassiveHost,
  sourceOwner: PassivePlayer | null,
  passive: RuntimePassive,
): PassivePlayer[] {
  if (!sourceOwner) return [];
  const game = engine?.game;
  const opponent =
    typeof game?.getOpponent === "function"
      ? game.getOpponent(sourceOwner)
      : null;
  const ownerRules = normalizePassiveList(
    passive.counterOwners || passive.counterOwner || passive.owners,
    ["self"],
  );
  const owners: (PassivePlayer | null)[] = [];

  for (const ownerRule of ownerRules) {
    if (ownerRule === "any" || ownerRule === "both") {
      owners.push(sourceOwner, opponent);
    } else if (ownerRule === "opponent") {
      owners.push(opponent);
    } else {
      owners.push(sourceOwner);
    }
  }

  return Array.from(
    new Set(owners.filter((owner): owner is PassivePlayer => Boolean(owner))),
  );
}

function matchesPassiveCounterFilters(
  engine: PassiveHost,
  card: ActionRuntimeCard | null | undefined,
  filters: RuntimeCardFilter = {},
) {
  if (!card) return false;
  if (filters.requireFaceup === true && card.isFacedown) return false;
  if (filters.cardKind) {
    if (!cardMatchesKind(card, filters.cardKind)) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.type) {
    const types: readonly unknown[] = Array.isArray(card.types)
      ? card.types
      : [card.type];
    if (!types.includes(filters.type)) return false;
  }
  if (filters.attribute && card.attribute !== filters.attribute) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.cardName && card.name !== filters.cardName) return false;
  if (filters.subtype) {
    const allowedSubtypes: readonly unknown[] = normalizePassiveList(
      filters.subtype,
    );
    if (!allowedSubtypes.includes(card.subtype)) return false;
  }
  if (
    Object.keys(filters).length > 0 &&
    typeof engine?.cardMatchesFilters === "function" &&
    !engine.cardMatchesFilters(card, filters)
  ) {
    return false;
  }
  return true;
}

function countPassiveFieldCounters(
  engine: PassiveHost,
  sourceOwner: PassivePlayer | null,
  passive: RuntimePassive,
) {
  const counterType = passive.counterType || "default";
  const zones = normalizePassiveList(
    passive.counterZones || passive.zones || passive.zone,
    ["field"],
  );
  const filters = {
    ...(passive.counterFilters || passive.filters || {}),
  };
  if (passive.counterRequireFaceup === true && filters.requireFaceup == null) {
    filters.requireFaceup = true;
  }
  let count = 0;

  for (const owner of getPassiveCounterOwners(engine, sourceOwner, passive)) {
    for (const zone of zones) {
      for (const card of getPassiveZoneCards(owner, zone)) {
        if (!matchesPassiveCounterFilters(engine, card, filters)) continue;
        count +=
          typeof card.getCounter === "function"
            ? Math.max(0, Number(card.getCounter(counterType) || 0))
            : 0;
      }
    }
  }

  return count;
}

function passiveConditionsAreMet(
  engine: PassiveHost,
  sourceCard: ActionRuntimeCard,
  sourceOwner: PassivePlayer | null,
  passive: RuntimePassive,
) {
  const rawConditions = passive?.conditions || passive?.condition || null;
  const conditions = normalizePassiveList(rawConditions);
  if (conditions.length === 0) return true;
  if (typeof engine?.evaluateConditions !== "function") return false;

  const game = engine?.game || null;
  const opponent =
    typeof game?.getOpponent === "function"
      ? game.getOpponent(sourceOwner)
      : null;
  const result = engine.evaluateConditions(conditions, {
    player: sourceOwner,
    opponent,
    source: sourceCard,
  });
  return result?.ok !== false;
}

export function updatePassiveBuffs(this: PassiveHost) {
  if (!this.game) return false;

  const fieldCards: PassiveCard[] = [
    ...(this.game.player?.field || []),
    ...(this.game.bot?.field || []),
  ].filter((card): card is PassiveCard => Boolean(card));
  const passiveSources = [
    ...fieldCards,
    ...(this.game.player?.spellTrap || []),
    this.game.player?.fieldSpell,
    ...(this.game.bot?.spellTrap || []),
    this.game.bot?.fieldSpell,
  ].filter((card): card is PassiveCard => Boolean(card));

  let updated = false;

  // Reconcile existing contributions without removing and reapplying unchanged auras.
  // Entries not visited in this pass belong to departed or inactive sources.
  const staleBuffs = new Map<PassiveStatCard, Set<string>>(fieldCards.map(card =>
    [card, new Set(Object.keys(card.dynamicBuffs || {}))] as const));
  const refreshBuff: typeof applyPassiveBuffValue = (card, key, amount, stats) => {
    if (card) staleBuffs.get(card)?.delete(key);
    return this.applyPassiveBuffValue(card, key, amount, stats);
  };
  // A status rule only removes what it grants: battle protection from an
  // active Equip outlives the host's own rule (user rule D12, 15/10/2026).
  const ownBattleProtectionRules = new Set<PassiveCard>();
  const reconcileStatus = (card: PassiveCard, statusName: string, ruleActive: boolean): void => {
    if (statusName === "battleIndestructible") ownBattleProtectionRules.add(card);
    const statuses = card as PassiveCard & Record<string, unknown>;
    const shouldHave = ruleActive || (statusName === "battleIndestructible" &&
      isBattleIndestructibleGrantedByEquip(card, equip => this.isActiveEquipForCard(equip, card)));
    if (shouldHave && !statuses[statusName]) {
      statuses[statusName] = true;
      updated = true;
    } else if (!shouldHave && statuses[statusName]) {
      delete statuses[statusName];
      updated = true;
    }
  };
  for (const card of fieldCards) {
    if (clearPassiveExtraAttacksForCard(card)) updated = true;
  }

  for (const card of passiveSources) {
    if (card.cardKind === "spell" && card.subtype === "equip" && card.equippedTo) {
      const host = card.equippedTo as PassiveCard;
      const equipActive = fieldCards.includes(host) && card.isFacedown !== true &&
        !passiveSourceEffectsAreNegated(this, card);
      if (refreshEquipExtraAttackBonus(card, host, equipActive)) {
        updated = true;
      }
      if (refreshEquipStatBonus(card, host, equipActive)) {
        updated = true;
      }
    }
    const effects: readonly PassiveEffect[] = card.effects || [];

    effects.forEach((effect, index) => {
      if (!effect || effect.timing !== "passive") return;
      const sourceOwner = this.getOwnerByCard(card);
      const sourceZone =
        sourceOwner && typeof this.findCardZone === "function"
          ? this.findCardZone(sourceOwner, card)
          : null;
      const passive = effect.passive;
      if (
        card.isFacedown === true &&
        (sourceZone === "field" || sourceZone === "fieldSpell" || sourceZone === "spellTrap")
      ) {
        if (passive?.type === "position_status" || passive?.type === "conditional_status") {
          reconcileStatus(card, passive.status || "battleIndestructible", false);
        }
        return;
      }
      if (effect.requireZone && sourceZone !== effect.requireZone) return;
      if (effect.requireFaceup === true && card.isFacedown === true) return;
      if (!passive) return;
      const sourceEffectsNegated = passiveSourceEffectsAreNegated(this, card);
      if (sourceEffectsNegated) {
        if (
          passive.type === "position_status" ||
          passive.type === "conditional_status"
        ) {
          reconcileStatus(card, passive.status || "battleIndestructible", false);
        }
        return;
      }

      if (passive.type === "activated_card_count_buff") {
        const owner = this.getOwnerByCard(card);
        const countOwner = passive.countOwner || "any";
        const playerId = countOwner === "self" ? owner?.id
          : countOwner === "opponent" ? this.game?.getOpponent?.(owner)?.id : undefined;
        const count = this.game && ((countOwner !== "self" && countOwner !== "opponent") || playerId)
          ? countTurnCardActivations(this.game, passive.filters || {}, playerId) : 0;
        const key = effect.id || `passive_${card.id}_${index}_activations`;
        registerModeledPassiveContribution(card, key, passive.type);
        if (refreshBuff(card, key,
          count * (passive.amountPerCard ?? 0), passive.stats || ["atk", "def"])) updated = true;
        return;
      }

      if (passive.type === "conditional_extra_attacks") {
        if (card.cardKind !== "monster") return;
        const requireSourceFaceup =
          passive.requireSourceFaceup !== false ||
          effect.requireFaceup === true;
        if (requireSourceFaceup && card.isFacedown) return;

        const sourceFilters = passive.sourceFilters || null;
        if (sourceFilters && !this.cardMatchesFilters(card, sourceFilters)) {
          return;
        }
        if (
          passive.equippedWithFilters &&
          !this.cardMatchesFilters(card, {
            equippedWithFilters: passive.equippedWithFilters,
          })
        ) {
          return;
        }

        const amount = passive.amount ?? passive.extraAttacks ?? 1;
        const effectKey =
          effect.id || `passive_${card.id}_${index}_extra_attacks`;
        if (
          applyPassiveExtraAttacks(
            card,
            effectKey,
            amount,
            passive.targetRestriction || null,
          )
        ) {
          updated = true;
        }
        return;
      }

      // Passive: position-based status (e.g., battle indestructible in defense)
      if (passive.type === "position_status") {
        const activePos = passive.activePosition || "defense";
        reconcileStatus(card, passive.status || "battleIndestructible",
          (card.position || "attack") === activePos);
        return;
      }

      // Passive: applies a status while a declarative condition is true.
      if (passive.type === "conditional_status") {
        reconcileStatus(card, passive.status || "battleIndestructible",
          passiveConditionsAreMet(this, card, sourceOwner, passive));
        return;
      }

      // Passive: buff based on count of a monster type in controller's graveyard
      if (passive.type === "graveyard_type_count_buff") {
        const typeName = passive.typeName || passive.monsterType || null;
        if (!typeName) return;

        const owner = this.getOwnerByCard(card);
        const gy = owner?.graveyard || [];
        const typeCount = gy.filter((c) => {
          if (!c || c.cardKind !== "monster") return false;
          const cardTypes = Array.isArray(c.types) ? c.types : [c.type];
          return cardTypes.includes(typeName);
        }).length;

        const perCard =
          passive.amountPerCard ?? passive.perCard ?? passive.buffPerCard ?? 0;
        const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
        const buffKey = effect.id || `passive_${card.id}_${index}_gy_type`;
        registerModeledPassiveContribution(card, buffKey, "graveyard_type_count_buff");
        const applied = refreshBuff(
          card,
          buffKey,
          typeCount * perCard,
          stats,
        );
        if (applied) updated = true;
        return;
      }

      // Passive: buff based on count of specific cards in controller's graveyard
      if (passive.type === "graveyard_card_count_buff") {
        const names =
          passive.cardNames ||
          passive.names ||
          passive.name ||
          passive.cardName;
        const cardNames = Array.isArray(names) ? names : names ? [names] : [];
        if (cardNames.length === 0) return;

        const owner = this.getOwnerByCard(card);
        const gy = owner?.graveyard || [];
        const cardCount = gy.filter((c) => {
          if (!c) return false;
          if (passive.cardKind && c.cardKind !== passive.cardKind) {
            return false;
          }
          return cardNames.includes(c.name);
        }).length;

        const perCard =
          passive.amountPerCard ?? passive.perCard ?? passive.buffPerCard ?? 0;
        const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
        const buffKey = effect.id || `passive_${card.id}_${index}_gy_card`;
        registerModeledPassiveContribution(card, buffKey, "graveyard_card_count_buff");
        const applied = refreshBuff(
          card,
          buffKey,
          cardCount * perCard,
          stats,
        );
        if (applied) updated = true;
        return;
      }

      // Passive: buff based on count of monsters of an archetype in controller's graveyard
      if (passive.type === "graveyard_archetype_count_buff") {
        const archetypeName = passive.archetype || null;
        if (!archetypeName) return;

        // Optional: only apply buff when this card is the sole face-up monster its controller has
        if (passive.requireSoleMonster) {
          const owner = this.getOwnerByCard(card);
          const faceUpMonsters = (owner?.field || []).filter(
            (c) => c && c.cardKind === "monster" && !c.isFacedown,
          );
          if (faceUpMonsters.length !== 1 || faceUpMonsters[0] !== card) {
            refreshBuff(
              card,
              effect.id || `passive_${card.id}_${index}_gy_archetype`,
              0,
              passive.stats || ["atk", "def"],
            );
            return;
          }
        }

        const owner = this.getOwnerByCard(card);
        const gy = owner?.graveyard || [];
        const archetypeCount = gy.filter((c) => {
          if (!c || c.cardKind !== "monster") return false;
          return (
            c.archetype === archetypeName ||
            (c.archetypes && c.archetypes.includes(archetypeName))
          );
        }).length;

        const perCard =
          passive.amountPerCard ?? passive.perCard ?? passive.buffPerCard ?? 0;
        const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
        const buffKey = effect.id || `passive_${card.id}_${index}_gy_archetype`;
        registerModeledPassiveContribution(card, buffKey, "graveyard_archetype_count_buff");
        const applied = refreshBuff(
          card,
          buffKey,
          archetypeCount * perCard,
          stats,
        );
        if (applied) updated = true;
        return;
      }

      // Passive: buff per count of special-summoned monsters of a given type
      // Supports per-card scope (card.state) or game-level fallback for future uses
      if (passive.type === "type_special_summoned_count_buff") {
        const typeName = passive.typeName || passive.monsterType || null;
        if (!typeName) return;

        const scope = passive.scope || passive.sourceScope || "game";
        let count = 0;

        if (scope === "card_state") {
          const state = card.state || (card.state = {});
          const map = state.specialSummonTypeCount || {};
          count = map[typeName] || 0;
        } else if (
          this.game &&
          typeof this.game.getSpecialSummonedTypeCount === "function"
        ) {
          const owners = passive.owners || passive.countOwners || ["self"];
          const ownerType = "self";
          if (owners.includes(ownerType)) {
            // Board cards already have their owner assigned by the zone lifecycle.
            const ownerId = card.owner!;
            count += this.game.getSpecialSummonedTypeCount(ownerId, typeName);
          }
        }

        const perCard =
          passive.amountPerCard ?? passive.perCard ?? passive.buffPerCard ?? 0;
        const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
        const buffKey = effect.id || `passive_${card.id}_${index}_type_count`;
        const applied = refreshBuff(
          card,
          buffKey,
          count * perCard,
          stats,
        );
        if (applied) updated = true;
        return;
      }

      // Passive: field_presence_type_summon_count_buff - buff based on summons WHILE card is face-up on field
      // Uses fieldPresenceState to track summons only during this card's field presence
      if (passive.type === "field_presence_type_summon_count_buff") {
        const typeName = passive.typeName || passive.monsterType || null;
        if (!typeName) return;

        // Read counter from fieldPresenceState (set by handleFieldPresenceTypeSummonCounters)
        const counterKey = `summon_count_${typeName}`;
        const count = card.fieldPresenceState?.[counterKey] || 0;

        const perCard =
          passive.amountPerCard ?? passive.perCard ?? passive.buffPerCard ?? 0;
        const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
        const buffKey =
          effect.id || `passive_${card.id}_${index}_field_presence_type`;
        registerModeledPassiveContribution(card, buffKey, passive.type);
        const applied = refreshBuff(
          card,
          buffKey,
          count * perCard,
          stats,
        );
        if (applied) updated = true;
        return;
      }

      // Passive: Equip source buffs its equipped monster by counters on itself
      if (
        passive.type === "equipped_counter_buff" ||
        passive.type === "equip_counter_buff"
      ) {
        if (card.cardKind !== "spell" || card.subtype !== "equip") return;

        const target = card.equippedTo || card.equipTarget || null;
        if (
          !target ||
          typeof target !== "object" ||
          target.cardKind !== "monster"
        )
          return;
        if (!this.isActiveEquipForCard(card, target)) return;

        const requireSourceFaceup =
          passive.requireSourceFaceup !== false ||
          effect.requireFaceup === true;
        if (requireSourceFaceup && card.isFacedown) return;

        const requireTargetFaceup = passive.targetRequireFaceup !== false;
        if (requireTargetFaceup && target.isFacedown) return;

        const targetFilters = passive.targetFilters || null;
        if (targetFilters && !this.cardMatchesFilters(target, targetFilters)) {
          return;
        }

        const counterType = passive.counterType || "default";
        const counterCount =
          typeof card.getCounter === "function"
            ? card.getCounter(counterType)
            : 0;
        const amountPerCounter =
          passive.amountPerCounter ??
          passive.perCounter ??
          passive.buffPerCounter ??
          passive.amount ??
          0;
        const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
        const buffKey = getEquippedCounterBuffKey(card, effect.id, index, passiveSources.indexOf(card));
        registerModeledPassiveContribution(target, buffKey, "equipped_counter_buff");
        const applied = refreshBuff(
          target,
          buffKey,
          counterCount * amountPerCounter,
          stats,
        );
        if (applied) updated = true;
        return;
      }

      // Passive: Equip source buffs its equipped monster by counters across field zones
      if (passive.type === "equipped_field_counter_buff") {
        if (card.cardKind !== "spell" || card.subtype !== "equip") return;

        const target = card.equippedTo || card.equipTarget || null;
        if (
          !target ||
          typeof target !== "object" ||
          target.cardKind !== "monster"
        )
          return;
        if (!this.isActiveEquipForCard(card, target)) return;

        const requireSourceFaceup =
          passive.requireSourceFaceup !== false ||
          effect.requireFaceup === true;
        if (requireSourceFaceup && card.isFacedown) return;

        const requireTargetFaceup = passive.targetRequireFaceup !== false;
        if (requireTargetFaceup && target.isFacedown) return;

        const targetFilters = passive.targetFilters || null;
        if (targetFilters && !this.cardMatchesFilters(target, targetFilters)) {
          return;
        }

        const amountPerCounter =
          passive.amountPerCounter ??
          passive.perCounter ??
          passive.buffPerCounter ??
          passive.amount ??
          0;
        const sourceOwner = this.getOwnerByCard(card);
        const counterCount = countPassiveFieldCounters(
          this,
          sourceOwner,
          passive,
        );
        const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
        const { counterKey, fixedDefKey } = getEquippedFieldCounterBuffKeys(
          card, effect.id, index, passiveSources.indexOf(card),
        );
        registerModeledPassiveContribution(target, counterKey, passive.type);
        registerModeledPassiveContribution(target, fixedDefKey, passive.type);
        const applied = refreshBuff(
          target,
          counterKey,
          counterCount * amountPerCounter,
          stats,
        );
        if (applied) updated = true;
        if (refreshBuff(target, fixedDefKey, passive.fixedDefBonus ?? 0, ["def"])) updated = true;
        return;
      }

      // Passive: source aura that modifies field monsters by counters on each target
      if (passive.type === "field_counter_stat_aura") {
        const requireSourceFaceup =
          passive.requireSourceFaceup !== false ||
          effect.requireFaceup === true;
        if (requireSourceFaceup && card.isFacedown) return;

        const sourceFilters = passive.sourceFilters || null;
        if (sourceFilters && !this.cardMatchesFilters(card, sourceFilters)) {
          return;
        }

        const counterType = passive.counterType || "default";
        const amountPerCounter =
          passive.amountPerCounter ??
          passive.perCounter ??
          passive.buffPerCounter ??
          passive.amount ??
          0;
        if (amountPerCounter === 0) return;

        const targetOwnersRaw = passive.targetOwners ||
          passive.owners || ["self"];
        const targetOwners = Array.isArray(targetOwnersRaw)
          ? targetOwnersRaw
          : [targetOwnersRaw];
        const targetCardKindsRaw = passive.targetCardKinds ||
          passive.cardKinds || ["monster"];
        const targetCardKinds: readonly unknown[] = Array.isArray(
          targetCardKindsRaw,
        )
          ? targetCardKindsRaw
          : [targetCardKindsRaw];
        const requireTargetFaceup =
          passive.targetRequireFaceup === true ||
          passive.requireTargetFaceup === true;
        const includeSelf = passive.includeSelf !== false;
        const targetFilters = passive.targetFilters || null;
        const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
        const buffKey = getFieldCounterStatAuraBuffKey(card, effect.id, index,
          passiveSources.indexOf(card), counterType);

        for (const target of fieldCards) {
          if (!target) continue;
          if (!includeSelf && target === card) continue;
          if (!targetCardKinds.includes(target.cardKind)) continue;
          if (requireTargetFaceup && target.isFacedown) continue;
          const ownerType = target.owner === card.owner ? "self" : "opponent";
          if (!targetOwners.includes(ownerType)) continue;
          if (
            targetFilters &&
            !this.cardMatchesFilters(target, targetFilters)
          ) {
            continue;
          }

          const counterCount =
            typeof target.getCounter === "function"
              ? Math.max(0, Number(target.getCounter(counterType) || 0))
              : 0;
          registerModeledPassiveContribution(target, buffKey, "field_counter_stat_aura");
          const applied = refreshBuff(
            target,
            buffKey,
            counterCount * amountPerCounter,
            stats,
          );
          if (applied) updated = true;
        }
        return;
      }

      // Passive: field_archetype_aura_buff - source-based aura for field monsters
      if (passive.type === "field_archetype_aura_buff") {
        const archetype = passive.archetype || passive.targetArchetype;
        if (!archetype) return;

        const requireSourceFaceup =
          passive.requireSourceFaceup !== false ||
          effect.requireFaceup === true;
        if (requireSourceFaceup && card.isFacedown) return;

        const sourceFilters = passive.sourceFilters || null;
        if (sourceFilters && !this.cardMatchesFilters(card, sourceFilters)) {
          return;
        }

        if (
          passive.equippedWithFilters &&
          !this.cardMatchesFilters(card, {
            equippedWithFilters: passive.equippedWithFilters,
          })
        ) {
          return;
        }

        const targetOwnersRaw = passive.targetOwners ||
          passive.owners || ["self"];
        const targetOwners = Array.isArray(targetOwnersRaw)
          ? targetOwnersRaw
          : [targetOwnersRaw];
        const targetCardKindsRaw = passive.targetCardKinds ||
          passive.cardKinds || ["monster"];
        const targetCardKinds: readonly unknown[] = Array.isArray(
          targetCardKindsRaw,
        )
          ? targetCardKindsRaw
          : [targetCardKindsRaw];
        const requireTargetFaceup =
          passive.targetRequireFaceup === true ||
          passive.requireTargetFaceup === true;
        const includeSelf = passive.includeSelf !== false;
        const targetFilters = passive.targetFilters || null;
        const statBoosts: { stat: PassiveStat; amount: number }[] = [];

        if (typeof passive.amount === "number") {
          const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
          for (const stat of stats) {
            statBoosts.push({ stat, amount: passive.amount });
          }
        }
        if (typeof passive.value === "number") {
          const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
          for (const stat of stats) {
            statBoosts.push({ stat, amount: passive.value });
          }
        }
        if (typeof passive.atkBoost === "number") {
          statBoosts.push({ stat: "atk", amount: passive.atkBoost });
        }
        if (typeof passive.defBoost === "number") {
          statBoosts.push({ stat: "def", amount: passive.defBoost });
        }
        if (statBoosts.length === 0) return;

        for (const target of fieldCards) {
          if (!target) continue;
          if (!includeSelf && target === card) continue;
          if (!targetCardKinds.includes(target.cardKind)) continue;
          if (requireTargetFaceup && target.isFacedown) continue;
          if (!this.cardHasArchetype(target, archetype)) continue;
          const ownerType = target.owner === card.owner ? "self" : "opponent";
          if (!targetOwners.includes(ownerType)) continue;
          if (
            targetFilters &&
            !this.cardMatchesFilters(target, targetFilters)
          ) {
            continue;
          }

          for (const boost of statBoosts) {
            const key = getFieldAuraBuffKey(card, effect.id, index, fieldCards.indexOf(card), boost.stat);
            registerModeledPassiveContribution(target, key, passive.type);
            const applied = refreshBuff(
              target,
              key,
              boost.amount,
              [boost.stat],
            );
            if (applied) updated = true;
          }
        }
        return;
      }

      // Passive: archetype_count_buff - buff based on count of archetype cards on field
      if (passive.type !== "archetype_count_buff") return;

      const archetype = passive.archetype;
      if (!archetype) return;

      const perCard =
        passive.amountPerCard ?? passive.perCard ?? passive.buffPerCard ?? 0;
      const cardKinds: readonly unknown[] = passive.cardKinds || ["monster"];
      const requireFaceup = passive.requireFaceup || false;
      const includeSelf = passive.includeSelf !== false;
      const stats: readonly PassiveStat[] = passive.stats || ["atk", "def"];
      const owners = passive.countOwners ||
        passive.owners || ["self", "opponent"];

      let count = 0;
      for (const target of fieldCards) {
        if (!target) continue;
        if (!cardKinds.includes(target.cardKind)) continue;
        if (requireFaceup && target.isFacedown) continue;
        if (!this.cardHasArchetype(target, archetype)) continue;
        const ownerType = target.owner === card.owner ? "self" : "opponent";
        if (!owners.includes(ownerType)) continue;
        if (!includeSelf && target === card) continue;
        count++;
      }

      const buffKey = effect.id || `passive_${card.id}_${index}`;
      registerModeledPassiveContribution(card, buffKey, "archetype_count_buff");
      const applied = refreshBuff(
        card,
        buffKey,
        count * perCard,
        stats,
      );
      if (applied) {
        updated = true;
      }
    });

    // Clean up empty dynamicBuffs object
    if (card.dynamicBuffs && Object.keys(card.dynamicBuffs).length === 0) {
      card.dynamicBuffs = null;
    }
  }

  // D12: without a status rule of its own, a monster's battle protection
  // status follows the Equips that grant it, ending when they are negated.
  for (const card of fieldCards) {
    if (ownBattleProtectionRules.has(card)) continue;
    if (refreshEquipBattleIndestructible(card, equip => this.isActiveEquipForCard(equip, card))) {
      updated = true;
    }
  }

  // PHASE 3: Apply non-stat passive flags (e.g., battle phase activation lock)
  // Clear first, then set based on current field state
  if (this.game.player)
    this.game.player.opponentCannotActivateDuringBattle = false;
  if (this.game.bot) this.game.bot.opponentCannotActivateDuringBattle = false;

  for (const card of passiveSources) {
    const effects: readonly PassiveEffect[] = card.effects || [];
    effects.forEach((effect) => {
      if (!effect || effect.timing !== "passive") return;
      const passive = effect.passive;
      if (!passive || passive.type !== "battle_phase_activation_lock") return;
      if (card.isFacedown) return;
      if (passiveSourceEffectsAreNegated(this, card)) return;

      const owner = this.getOwnerByCard(card);
      const opponent =
        owner === this.game!.player ? this.game!.bot : this.game!.player;
      if (opponent) {
        opponent.opponentCannotActivateDuringBattle = true;
        updated = true;
      }
    });
  }

  for (const [card, keys] of staleBuffs) {
    for (const key of keys) {
      if (this.applyPassiveBuffValue(card, key, 0)) updated = true;
    }
  }

  for (const card of passiveSources) pruneModeledPassiveContributions(card);
  return updated;
}
