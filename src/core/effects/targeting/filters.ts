import type {
  ActionRuntimeCard,
  ActionRuntimePlayer,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { ActionType } from "../../contracts/actions.js";
import type {
  CardFilter,
  EffectDefinition,
  EffectOwner,
  PassiveRuleDefinition,
} from "../../contracts/effects.js";
import type { CanonicalZone } from "../../contracts/zones.js";

type TargetingEffectType = "destruction" | "banish" | "target" | "negate";

interface TargetingCard extends ActionRuntimeCard {
  immuneToOpponentEffectsUntilTurn?: number;
  immuneToOpponentEffects?: boolean;
  unaffectedByOpponentCardEffects?: boolean;
  unaffectedByOtherCardEffects?: boolean;
  cannotBeTargeted?: boolean;
  immuneTo?: TargetingEffectType | TargetingEffectType[];
  effects?: readonly EffectDefinition[];
}

interface TargetingPlayer extends Omit<
  ActionRuntimePlayer,
  "field" | "spellTrap" | "fieldSpell"
> {
  field: TargetingCard[];
  spellTrap: TargetingCard[];
  fieldSpell: TargetingCard | null;
}

interface ConditionalUnaffectedPassive extends PassiveRuleDefinition {
  readonly allowedSourceArchetypes?: readonly string[];
  readonly sourceArchetypeExceptions?: readonly string[];
  readonly exceptSourceNames?: readonly string[];
  readonly allowedSourceNames?: readonly string[];
  readonly sourceNameExceptions?: readonly string[];
  readonly owners?: readonly EffectOwner[];
  readonly zones?: readonly CanonicalZone[];
  readonly requireZone?: CanonicalZone;
  readonly requireSourceFaceup?: boolean;
}

export interface ImmunityCheckOptions {
  effectType?: TargetingEffectType | null;
  sourceCard?: TargetingCard | null;
  source?: TargetingCard | null;
}

export interface ImmunityResult {
  immune: boolean;
  reason: string | null;
}

interface ImmunityFilterOptions extends ImmunityCheckOptions {
  actionType?: string;
  logSkipped?: boolean;
  customImmunityCheck?(
    card: TargetingCard,
    sourcePlayer: TargetingPlayer,
    options: ImmunityFilterOptions,
  ): ImmunityResult;
}

interface ImmunityAction {
  type: ActionType | string;
  targetRef?: string;
  effectType?: TargetingEffectType;
  immunityMode?: "skip_targets" | "skip_action";
  customImmunityCheck?: ImmunityFilterOptions["customImmunityCheck"];
}

interface TargetingFilterHost {
  readonly game?: {
    player?: TargetingPlayer | null;
    bot?: TargetingPlayer | null;
    turnCounter?: number;
    devModeEnabled?: boolean;
  } | null;
  readonly ui?: { log?(message: string): void } | null;
  findCardZone?(
    owner: TargetingPlayer,
    card: TargetingCard,
  ): CanonicalZone | null;
  cardMatchesFilters?(card: TargetingCard, filters: CardFilter): boolean;
  isEffectNegated?(card: TargetingCard): boolean;
  checkImmunity(
    card: TargetingCard,
    sourcePlayer: TargetingPlayer,
    options?: ImmunityCheckOptions,
  ): ImmunityResult;
  filterCardsListByImmunity(
    cards: TargetingCard[],
    sourcePlayer: TargetingPlayer,
    options?: ImmunityFilterOptions,
  ): ImmunityFilterResult<TargetingCard>;
  filterTargetsByImmunity(
    action: ImmunityAction,
    context: EffectContext,
    targets: ResolvedTargetMap,
  ): TargetImmunityFilterResult;
  inferEffectType(actionType: ActionType | string): TargetingEffectType | null;
}

export interface ImmunityFilterResult<Card extends TargetingCard> {
  allowed: Card[];
  skipped: Card[];
  skippedReasons: Map<Card, string | null>;
}

export interface TargetImmunityFilterResult {
  filteredTargets: ResolvedTargetMap;
  skippedCount: number;
  allowedCount: number;
  skipAction: boolean;
  skippedReasons: Map<TargetingCard, string | null>;
}

/**
 * Targeting Filters Module
 * Extracted from EffectEngine.js - immunity and filtering utilities
 *
 * All functions assume `this` = EffectEngine instance
 */

/**
 * Check if a card is immune to effects from a source player
 * @param {Object} card - The card to check immunity for
 * @param {Object} sourcePlayer - The player whose effect is targeting the card
 * @param {Object} options - Optional settings for specific immunity checks
 * @param {string} options.effectType - Type of effect (e.g., "destruction", "banish", "target")
 * @returns {{immune: boolean, reason: string|null}} Immunity status and reason
 */
function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
  fallback?: readonly Value[],
): readonly Value[];
function asArray(
  value: unknown,
  fallback: readonly unknown[] = [],
): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return fallback;
  return [value];
}

function isTargetingPlayer(
  value: TargetingPlayer | null | undefined,
): value is TargetingPlayer {
  return value != null;
}

function isTargetingEffectType(value: unknown): value is TargetingEffectType {
  return (
    value === "destruction" ||
    value === "banish" ||
    value === "target" ||
    value === "negate"
  );
}

function cardHasAnyArchetype(
  card: TargetingCard | null | undefined,
  archetypes: readonly string[] = [],
): boolean {
  if (!card || archetypes.length === 0) return false;
  const cardArchetypes = Array.isArray(card.archetypes)
    ? card.archetypes
    : card.archetype
      ? [card.archetype]
      : [];
  return archetypes.some((archetype) => cardArchetypes.includes(archetype));
}

function getPlayerByCardOwner(
  game: TargetingFilterHost["game"],
  card: TargetingCard | null | undefined,
): TargetingPlayer | null {
  if (!game || !card) return null;
  if (card.owner === "player" || card.controller === "player") {
    return game.player || null;
  }
  if (card.owner === "bot" || card.controller === "bot") {
    return game.bot || null;
  }
  return null;
}

function getPassiveSourceCards(
  owner: TargetingPlayer | null | undefined,
): TargetingCard[] {
  if (!owner) return [];
  const field = Array.isArray(owner.field) ? owner.field : [];
  const spellTrap = Array.isArray(owner.spellTrap) ? owner.spellTrap : [];
  const fieldSpell = owner.fieldSpell ? [owner.fieldSpell] : [];
  return [...field, ...spellTrap, ...fieldSpell].filter(Boolean);
}

function findCardZone(
  engine: TargetingFilterHost | null | undefined,
  owner: TargetingPlayer | null | undefined,
  card: TargetingCard | null | undefined,
): CanonicalZone | null {
  if (!owner || !card) return null;
  if (typeof engine?.findCardZone === "function") {
    const zone = engine.findCardZone(owner, card);
    if (zone) return zone;
  }
  if (owner.fieldSpell === card) return "fieldSpell";
  if (Array.isArray(owner.field) && owner.field.includes(card)) return "field";
  if (Array.isArray(owner.spellTrap) && owner.spellTrap.includes(card)) {
    return "spellTrap";
  }
  return null;
}

function sourceIsAllowedByPassive(
  sourceCard: TargetingCard | null | undefined,
  passive: ConditionalUnaffectedPassive,
): boolean {
  if (!sourceCard) return false;
  const allowedArchetypes = asArray(
    passive.exceptSourceArchetypes ||
      passive.allowedSourceArchetypes ||
      passive.sourceArchetypeExceptions,
  );
  if (cardHasAnyArchetype(sourceCard, allowedArchetypes)) return true;

  const allowedNames = asArray(
    passive.exceptSourceNames ||
      passive.allowedSourceNames ||
      passive.sourceNameExceptions,
  );
  return allowedNames.includes(sourceCard.name);
}

function targetMatchesConditionalUnaffectedPassive(
  engine: TargetingFilterHost,
  card: TargetingCard,
  targetOwner: TargetingPlayer,
  sourceOwner: TargetingPlayer,
  passive: ConditionalUnaffectedPassive,
): boolean {
  if (!card || !targetOwner || !sourceOwner || !passive) return false;

  const ownerRelation =
    targetOwner.id === sourceOwner.id ? "self" : "opponent";
  const targetOwners = asArray(
    passive.targetOwners || passive.owners || ["opponent"],
  );
  if (
    !targetOwners.includes("any") &&
    !targetOwners.includes(ownerRelation)
  ) {
    return false;
  }

  const targetZones = asArray(passive.targetZones || passive.zones, ["field"]);
  const targetZone = findCardZone(engine, targetOwner, card);
  if (!targetZone || !targetZones.includes(targetZone)) return false;

  const filters = passive.targetFilters || {};
  if (
    (filters.requireFaceup === true ||
      Reflect.get(filters, "faceUp") === true ||
      passive.targetRequireFaceup === true) &&
    card.isFacedown
  ) {
    return false;
  }

  if (
    typeof engine?.cardMatchesFilters === "function" &&
    !engine.cardMatchesFilters(card, filters)
  ) {
    return false;
  }

  return true;
}

function findConditionalUnaffectedPassiveReason(
  engine: TargetingFilterHost,
  card: TargetingCard,
  sourcePlayer: TargetingPlayer,
  options: ImmunityCheckOptions,
): string | null {
  const game = engine?.game;
  const sourceCard = options.sourceCard || options.source || null;
  if (!game || !card || !sourcePlayer) return null;
  if (sourceCard && sourceCard === card) return null;

  const targetOwner = getPlayerByCardOwner(game, card);
  if (!targetOwner) return null;

  for (const sourceOwner of [game.player, game.bot].filter(isTargetingPlayer)) {
    for (const passiveSource of getPassiveSourceCards(sourceOwner)) {
      if (!passiveSource || passiveSource.isFacedown) continue;
      if (
        typeof engine?.isEffectNegated === "function" &&
        engine.isEffectNegated(passiveSource)
      ) {
        continue;
      }

      const sourceZone = findCardZone(engine, sourceOwner, passiveSource);
      for (const effect of passiveSource.effects || []) {
        if (effect?.timing !== "passive") continue;
        if (!("passive" in effect)) continue;
        const passive: ConditionalUnaffectedPassive = effect.passive;
        if (!passive || passive.type !== "conditional_unaffected_by_effects") {
          continue;
        }
        if (effect.requireZone && sourceZone !== effect.requireZone) continue;
        if (passive.requireZone && sourceZone !== passive.requireZone) continue;
        if (effect.requireFaceup === true && passiveSource.isFacedown) {
          continue;
        }
        if (passive.requireSourceFaceup === true && passiveSource.isFacedown) {
          continue;
        }
        if (sourceIsAllowedByPassive(sourceCard, passive)) continue;
        if (
          !targetMatchesConditionalUnaffectedPassive(
            engine,
            card,
            targetOwner,
            sourceOwner,
            passive,
          )
        ) {
          continue;
        }

        return (
          passive.reason ||
          `${card.name} is unaffected by this card effect.`
        );
      }
    }
  }

  return null;
}

export function checkImmunity(
  this: TargetingFilterHost,
  card: TargetingCard | null | undefined,
  sourcePlayer: TargetingPlayer | null | undefined,
  options: ImmunityCheckOptions = {},
): ImmunityResult {
  if (!card || !sourcePlayer) {
    return { immune: false, reason: null };
  }

  const sourceCard = options.sourceCard || options.source || null;

  // Check 0: Unaffected by every other card effect, including controller's.
  if (card.unaffectedByOtherCardEffects && sourceCard !== card) {
    return { immune: true, reason: "unaffected_by_other_card_effects" };
  }

  const conditionalUnaffectedReason = findConditionalUnaffectedPassiveReason(
    this,
    card,
    sourcePlayer,
    { ...options, sourceCard },
  );
  if (conditionalUnaffectedReason) {
    return {
      immune: true,
      reason: conditionalUnaffectedReason,
    };
  }

  // Check 1: Temporary immunity to opponent effects (turn-based)
  if (card.immuneToOpponentEffectsUntilTurn && card.owner) {
    const currentTurn = this.game?.turnCounter ?? 0;
    if (
      currentTurn <= card.immuneToOpponentEffectsUntilTurn &&
      card.owner !== sourcePlayer.id
    ) {
      return {
        immune: true,
        reason: "immune_to_opponent_effects_until_turn",
      };
    }
  }

  // Check 2: Permanent immunity to opponent effects (flag-based)
  if (card.immuneToOpponentEffects && card.owner !== sourcePlayer.id) {
    return { immune: true, reason: "immune_to_opponent_effects" };
  }

  // Check 3: Immunity to specific effect types (extensible)
  const effectType = options.effectType;
  if (effectType && card.immuneTo) {
    const immuneToList = Array.isArray(card.immuneTo)
      ? card.immuneTo
      : [card.immuneTo];
    if (immuneToList.includes(effectType)) {
      return { immune: true, reason: `immune_to_${effectType}` };
    }
  }

  // Check 4: Unaffected by opponent's card effects (Yu-Gi-Oh style)
  if (card.unaffectedByOpponentCardEffects && card.owner !== sourcePlayer.id) {
    return { immune: true, reason: "unaffected_by_opponent_card_effects" };
  }

  // Check 5: Cannot be targeted (only applies if effectType is "target")
  if (
    effectType === "target" &&
    card.cannotBeTargeted &&
    card.owner !== sourcePlayer.id
  ) {
    return { immune: true, reason: "cannot_be_targeted" };
  }

  // No immunity detected
  return { immune: false, reason: null };
}

/**
 * Simple boolean check for backward compatibility.
 * Use checkImmunity() for detailed immunity information.
 */
export function isImmuneToOpponentEffects(
  this: TargetingFilterHost,
  card: TargetingCard,
  sourcePlayer: TargetingPlayer,
): boolean {
  return this.checkImmunity(card, sourcePlayer).immune;
}

/**
 * Filter a list of target cards by immunity, returning allowed and skipped targets.
 * This is the central helper for immunity checking.
 *
 * @param {Array} cardsList - Array of cards to filter
 * @param {Object} sourcePlayer - The player whose effect is being applied
 * @param {Object} options - Optional settings
 * @param {string} options.actionType - Type of action for logging
 * @param {string} options.effectType - Type of effect for specific immunity checks
 * @param {boolean} options.logSkipped - Whether to log skipped targets (default: true in dev mode)
 * @param {Function} options.customImmunityCheck - Optional custom immunity check function
 * @returns {{allowed: Array, skipped: Array, skippedReasons: Map}} Filtered results with reasons
 */
export function filterCardsListByImmunity<Card extends TargetingCard>(
  this: TargetingFilterHost,
  cardsList: Card[] | null | undefined,
  sourcePlayer: TargetingPlayer,
  options: ImmunityFilterOptions = {},
): ImmunityFilterResult<Card> {
  const allowed: Card[] = [];
  const skipped: Card[] = [];
  const skippedReasons = new Map<Card, string | null>();

  if (!Array.isArray(cardsList) || cardsList.length === 0) {
    return { allowed, skipped, skippedReasons };
  }

  for (const card of cardsList) {
    if (!card) continue;

    // Use custom immunity check if provided, otherwise use standard check
    let immunityResult;
    if (typeof options.customImmunityCheck === "function") {
      immunityResult = options.customImmunityCheck(card, sourcePlayer, options);
    } else {
      immunityResult = this.checkImmunity(card, sourcePlayer, {
        effectType: options.effectType,
        sourceCard:
          options.sourceCard !== undefined
            ? options.sourceCard
            : options.source || null,
      });
    }

    if (immunityResult.immune) {
      skipped.push(card);
      skippedReasons.set(card, immunityResult.reason);

      // Log in dev mode or if explicitly requested
      const shouldLog = options.logSkipped ?? this.game?.devModeEnabled;
      if (shouldLog && this.ui?.log) {
        const actionDesc = options.actionType ? ` (${options.actionType})` : "";
        this.ui.log(
          `${card.name} is immune to this effect${actionDesc} and was skipped.`
        );
      }
    } else {
      allowed.push(card);
    }
  }

  return { allowed, skipped, skippedReasons };
}

/**
 * Filter targets object by immunity for a specific action.
 * Returns a new targets object with immune cards removed from the targetRef.
 *
 * @param {Object} action - The action being applied
 * @param {Object} ctx - Effect context (player, opponent, source)
 * @param {Object} targets - The targets object with targetRef keys
 * @returns {{filteredTargets: Object, skippedCount: number, allowedCount: number, skipAction: boolean, skippedReasons: Map}}
 */
export function filterTargetsByImmunity(
  this: TargetingFilterHost,
  action: ImmunityAction | null | undefined,
  ctx: EffectContext | null | undefined,
  targets: ResolvedTargetMap | null | undefined,
): TargetImmunityFilterResult {
  const result: TargetImmunityFilterResult = {
    filteredTargets: { ...targets },
    skippedCount: 0,
    allowedCount: 0,
    skipAction: false,
    skippedReasons: new Map<TargetingCard, string | null>(),
  };

  if (!action?.targetRef || !ctx?.player || !targets) {
    return result;
  }

  const targetCards = targets[action.targetRef];
  if (!Array.isArray(targetCards) || targetCards.length === 0) {
    return result;
  }

  // Determine effect type from action for more specific immunity checks
  const effectType = action.effectType || this.inferEffectType(action.type);

  const { allowed, skipped, skippedReasons } = this.filterCardsListByImmunity(
    targetCards,
    ctx.player,
    {
      actionType: action.type,
      effectType,
      sourceCard: ctx.source || null,
      customImmunityCheck: action.customImmunityCheck,
    }
  );

  result.skippedCount = skipped.length;
  result.allowedCount = allowed.length;
  result.skippedReasons = skippedReasons;

  // Create new targets object with filtered array
  result.filteredTargets = {
    ...targets,
    [action.targetRef]: allowed,
  };

  // Check immunityMode to determine if action should be skipped entirely
  const immunityMode = action.immunityMode || "skip_targets";

  if (immunityMode === "skip_action" && skipped.length > 0) {
    // If any target is immune and mode is skip_action, skip the entire action
    result.skipAction = true;
    if (this.ui?.log) {
      this.ui.log(
        `Action ${action.type} was cancelled because some targets are immune.`
      );
    }
  } else if (
    immunityMode === "skip_targets" &&
    allowed.length === 0 &&
    skipped.length > 0
  ) {
    // All targets were immune - action has no valid targets
    // Don't set skipAction=true, let handler deal with empty array gracefully
  }

  return result;
}

/**
 * Infer the effect type from an action type for immunity checking.
 * Extend this method when adding new action types.
 *
 * @param {string} actionType - The action type string
 * @returns {string|null} The inferred effect type
 */
export function inferEffectType(
  actionType: ActionType | string | null | undefined,
): TargetingEffectType | null {
  if (!actionType) return null;

  const typeMap = {
    destroy_targeted_cards: "destruction",
    destroy: "destruction",
    destroy_and_damage_by_target_atk: "destruction",
    banish: "banish",
    banish_destroyed_monster: "banish",
    switch_position: "target",
    set_stats_to_zero_and_negate: "target",
    buff_atk_temp: "target",
    modify_stats_temp: "target",
    bounce_to_hand: "target",
    bounce_to_deck: "target",
    send_to_graveyard: "target",
    negate_effects: "negate",
  };

  const inferred: unknown = Reflect.get(typeMap, actionType);
  return isTargetingEffectType(inferred) ? inferred : "target";
}

/**
 * @deprecated Use filterTargetsByImmunity instead for per-target filtering.
 * This method is kept for backward compatibility but now only returns true
 * when immunityMode is "skip_action" and any target is immune.
 */
export function shouldSkipActionDueToImmunity(
  this: TargetingFilterHost,
  action: ImmunityAction | null | undefined,
  targets: ResolvedTargetMap,
  ctx: EffectContext | null | undefined,
): boolean {
  if (!action || !action.targetRef || !ctx?.player) return false;

  // Use new filtering system
  const { skipAction } = this.filterTargetsByImmunity(action, ctx, targets);
  return skipAction;
}
