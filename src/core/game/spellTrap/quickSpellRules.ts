/**
 * Central Quick Spell legality helpers.
 *
 * These functions are intentionally pure and side-effect free. They define the
 * shared rule surface used by later integration steps for activation, preview,
 * UI, and chain discovery.
 */

import { DAMAGE_STEP_TIMINGS } from "../../contracts/effects.js";
import type { DamageStepTiming } from "../../contracts/effects.js";

export { DAMAGE_STEP_TIMINGS };

export interface QuickSpellCardView {
  cardKind?: string | null;
  subtype?: string | null;
  isFacedown?: boolean;
  setTurn?: number | null;
  turnSetOn?: number | null;
}

export interface QuickSpellPlayerView {
  id: string;
  hand?: readonly QuickSpellCardView[];
  spellTrap?: readonly QuickSpellCardView[];
}

export interface QuickSpellGameView {
  turn?: string | null;
  phase?: string | null;
  turnCounter?: number | null;
}

export interface QuickSpellTargetView {
  id?: string;
  requireThisCard?: boolean;
  intent?: string;
}

export interface QuickSpellActionView {
  type?: string;
  atkBoost?: number;
  defBoost?: number;
  atkBoostFromContext?: unknown;
  defBoostFromContext?: unknown;
  atkFactor?: number;
  defFactor?: number;
  atkPerCounter?: number;
  defPerCounter?: number;
  atkBoostPerCounter?: number;
  defBoostPerCounter?: number;
  stats?: readonly string[];
  atk?: number;
  def?: number;
  baseAtk?: number;
  baseDef?: number;
  atkFromContext?: unknown;
  defFromContext?: unknown;
  contextLabel?: string;
  to?: string;
  targetRef?: string;
}

export interface QuickSpellEffectView {
  speed?: number;
  isQuickEffect?: boolean;
  actions?: readonly QuickSpellActionView[];
  targets?: readonly QuickSpellTargetView[];
  damageStepTimings?: readonly string[];
  event?: string;
  timing?: string;
}

export interface QuickSpellContext {
  requiredSpellSpeed?: number;
  respondingToSpellSpeed?: number;
  lastSpellSpeed?: number;
  legalWindow?: boolean;
  isChainWindow?: boolean;
  chainWindowOpen?: boolean;
  openState?: boolean;
  type?: string | null;
  event?: string | null;
  responseContextType?: string | null;
  respondingToChainLink?: unknown;
  activationAttempt?: unknown;
  isDamageStep?: boolean;
  damageStepTiming?: DamageStepTiming | string | null;
  effect?: QuickSpellEffectView | null;
  activationZone?: string | null;
  zone?: string | null;
}

export type QuickSpellActivationZone = "hand" | "spellTrap";

export interface DamageStepActivationClassification {
  category: string | null;
  allowedTimings: DamageStepTiming[];
}

export interface QuickSpellLegalityResult
  extends Partial<DamageStepActivationClassification> {
  ok: boolean;
  spellSpeed: number;
  code?: string;
  reason?: string;
  requiredSpellSpeed?: number;
  activationZone?: QuickSpellActivationZone | null;
  timing?: DamageStepTiming | string | null;
}

type QuickSpellResultDetail = Partial<
  Omit<QuickSpellLegalityResult, "ok">
>;

const QUICK_SPELL_SUBTYPES = new Set<string>(["quick", "quick-play", "quickplay"]);

const CHAIN_WINDOW_CONTEXT_TYPES = new Set<string>([
  "attack_declaration",
  "battle_step_open",
  "battle_damage",
  "card_activation",
  "effect_activation",
  "effect_targeted",
  "main_phase_action",
  "phase_change",
  "summon",
  "summon_attempt",
]);

const DIRECT_ATK_DEF_ACTIONS = new Set<string>([
  "buff_atk_by_lp_gained_this_turn",
  "buff_stats_by_counter",
  "buff_stats_temp",
  "modify_stats_temp",
  "permanent_buff_named",
  "reduce_self_atk",
  "remove_stat_increases",
  "set_original_stats",
]);

export const DAMAGE_STEP_ACTIVATION_CATEGORIES = Object.freeze({
  COUNTER_TRAP: "counter_trap",
  ACTIVATION_NEGATION: "activation_negation",
  DIRECT_ATK_DEF: "direct_atk_def",
  EXPLICIT_TIMING: "explicit_timing",
  EVENT_TRIGGER: "event_trigger",
  GENERIC_FAST_EFFECT: "generic_fast_effect",
});

const ALL_DAMAGE_STEP_TIMINGS = Object.freeze(
  Object.values(DAMAGE_STEP_TIMINGS) as DamageStepTiming[],
);
const PRE_CALCULATION_TIMINGS: readonly DamageStepTiming[] = Object.freeze([
  DAMAGE_STEP_TIMINGS.START,
  DAMAGE_STEP_TIMINGS.BEFORE_CALCULATION,
]);
const DAMAGE_STEP_EVENT_TIMINGS: Readonly<Record<string, DamageStepTiming | null>> = Object.freeze({
  damage_step: null,
  battle_damage: DAMAGE_STEP_TIMINGS.BEFORE_CALCULATION,
  battle_damage_inflicted: DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
  battle_completed: DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
  card_flipped: DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
  battle_destroy: DAMAGE_STEP_TIMINGS.END,
  card_to_grave: DAMAGE_STEP_TIMINGS.END,
});

function result(
  ok: boolean,
  detail: QuickSpellResultDetail = {},
): QuickSpellLegalityResult {
  return {
    ok,
    spellSpeed: detail.spellSpeed ?? 2,
    ...detail,
  };
}

function failure(
  code: string,
  reason: string,
  detail: QuickSpellResultDetail = {},
): QuickSpellLegalityResult {
  return result(false, { code, reason, ...detail });
}

function getRequiredSpellSpeed(context: QuickSpellContext = {}): number {
  const candidates = [
    context.requiredSpellSpeed,
    context.respondingToSpellSpeed,
    context.lastSpellSpeed,
  ];
  let required = 0;
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      required = Math.max(required, numeric);
    }
  }
  return required;
}

function checkSpellSpeed(
  context: QuickSpellContext = {},
): QuickSpellLegalityResult {
  const required = getRequiredSpellSpeed(context);
  if (required > 2) {
    return failure(
      "QUICK_SPELL_SPEED_TOO_LOW",
      "Quick Spell cannot respond to Spell Speed 3.",
      { requiredSpellSpeed: required },
    );
  }
  return result(true);
}

function isOwnMainPhaseOpen(
  game: QuickSpellGameView | null | undefined,
  player: QuickSpellPlayerView | null | undefined,
): boolean {
  return (
    !!game &&
    !!player &&
    game.turn === player.id &&
    (game.phase === "main1" || game.phase === "main2")
  );
}

function hasExplicitLegalWindow(context: QuickSpellContext = {}): boolean {
  if (
    context.legalWindow === true ||
    context.isChainWindow === true ||
    context.chainWindowOpen === true ||
    context.openState === true
  ) {
    return true;
  }
  return (
    typeof context.type === "string" &&
    CHAIN_WINDOW_CONTEXT_TYPES.has(context.type)
  );
}

function hasLegalQuickSpellWindow(
  game: QuickSpellGameView | null | undefined,
  player: QuickSpellPlayerView | null | undefined,
  context: QuickSpellContext = {},
): boolean {
  return hasExplicitLegalWindow(context) || isOwnMainPhaseOpen(game, player);
}

function getSetTurn(card: QuickSpellCardView | null | undefined): number | null | undefined {
  return card?.setTurn ?? card?.turnSetOn ?? null;
}

function hasOwnPropertyValue(
  action: QuickSpellActionView,
  keys: readonly (keyof QuickSpellActionView)[],
): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(action, key));
}

function hasNonZeroNumber(
  action: QuickSpellActionView,
  keys: readonly (keyof QuickSpellActionView)[],
): boolean {
  return keys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(action, key)) return false;
    const value = Number(Reflect.get(action, key));
    return Number.isFinite(value) && value !== 0;
  });
}

function actionDirectlyChangesAtkDef(
  action: QuickSpellActionView | null | undefined,
): boolean {
  if (
    !action ||
    typeof action.type !== "string" ||
    !DIRECT_ATK_DEF_ACTIONS.has(action.type)
  ) {
    return false;
  }

  switch (action.type) {
    case "buff_stats_temp":
      return (
        hasNonZeroNumber(action, ["atkBoost", "defBoost"]) ||
        hasOwnPropertyValue(action, [
          "atkBoostFromContext",
          "defBoostFromContext",
        ])
      );
    case "modify_stats_temp":
      return (
        (Object.prototype.hasOwnProperty.call(action, "atkFactor") &&
          Number(action.atkFactor) !== 1) ||
        (Object.prototype.hasOwnProperty.call(action, "defFactor") &&
          Number(action.defFactor) !== 1)
      );
    case "buff_stats_by_counter":
      return hasNonZeroNumber(action, [
        "atkPerCounter",
        "defPerCounter",
        "atkBoostPerCounter",
        "defBoostPerCounter",
      ]);
    case "buff_atk_by_lp_gained_this_turn":
      return true;
    case "reduce_self_atk":
      return true;
    case "remove_stat_increases": {
      const stats = Array.isArray(action.stats)
        ? action.stats.map((stat) => String(stat).toLowerCase())
        : [];
      return (
        stats.length === 0 || stats.includes("atk") || stats.includes("def")
      );
    }
    case "permanent_buff_named":
      return hasNonZeroNumber(action, ["atkBoost", "defBoost"]);
    case "set_original_stats":
      return (
        hasOwnPropertyValue(action, [
          "atk",
          "def",
          "baseAtk",
          "baseDef",
          "atkFromContext",
          "defFromContext",
        ])
      );
    default:
      return false;
  }
}

function getEffectTarget(
  effect: QuickSpellEffectView | null | undefined,
  targetRef: string | null | undefined,
): QuickSpellTargetView | null {
  if (!targetRef || !Array.isArray(effect?.targets)) return null;
  return effect.targets.find((target) => target?.id === targetRef) || null;
}

function isSelfGraveyardCostAction(
  action: QuickSpellActionView | null | undefined,
  effect: QuickSpellEffectView | null | undefined,
): boolean {
  if (!action || action.type !== "move") return false;
  if (action.contextLabel !== "cost") return false;
  if (String(action.to || "").toLowerCase() !== "graveyard") return false;
  if (action.targetRef === "self") return true;

  const target = getEffectTarget(effect, action.targetRef);
  return target?.requireThisCard === true || target?.intent === "cost";
}

function isDamageStepContext(context: QuickSpellContext = {}): boolean {
  return (
    context.type === "battle_damage" ||
    context.isDamageStep === true ||
    context.damageStepTiming != null
  );
}

function getCardSpellSpeed(
  card: QuickSpellCardView | null | undefined,
  effect: QuickSpellEffectView | null = null,
): number {
  const effectSpeed = effect?.speed;
  if (Number.isFinite(Number(effectSpeed))) {
    return Number(effectSpeed);
  }
  if (card?.cardKind === "trap" && card?.subtype === "counter") return 3;
  if (isQuickSpell(card)) return 2;
  if (card?.cardKind === "trap") return 2;
  if (card?.cardKind === "monster") {
    return effect?.isQuickEffect === true ? 2 : 1;
  }
  return 1;
}

function isCounterTrap(card: QuickSpellCardView | null | undefined): boolean {
  return card?.cardKind === "trap" && card?.subtype === "counter";
}

function actionNegatesActivation(
  action: QuickSpellActionView | null | undefined,
): boolean {
  if (!action) return false;
  return (
    action.type === "negate_activation" ||
    action.type === "negate_summon_or_activation_and_destroy"
  );
}

function effectNegatesActivation(
  effect: QuickSpellEffectView | null | undefined,
): boolean {
  return (effect?.actions || []).some(actionNegatesActivation);
}

function normalizeDamageStepTimings(
  effect: QuickSpellEffectView | null | undefined,
): DamageStepTiming[] {
  const declared = Array.isArray(effect?.damageStepTimings)
    ? effect.damageStepTimings
    : [];
  return [...new Set(declared.filter(
    (timing): timing is DamageStepTiming =>
      ALL_DAMAGE_STEP_TIMINGS.includes(timing as DamageStepTiming),
  ))];
}

function isActivationResponseContext(context: QuickSpellContext = {}): boolean {
  const type = context.responseContextType || context.type || null;
  return (
    type === "card_activation" ||
    type === "effect_activation" ||
    context.respondingToChainLink != null ||
    context.activationAttempt != null
  );
}

export function classifyDamageStepActivation(
  effect: QuickSpellEffectView | null | undefined,
  card: QuickSpellCardView | null | undefined,
  context: QuickSpellContext = {},
): DamageStepActivationClassification {
  const explicitTimings = normalizeDamageStepTimings(effect);
  if (isCounterTrap(card)) {
    return {
      category: DAMAGE_STEP_ACTIVATION_CATEGORIES.COUNTER_TRAP,
      allowedTimings: [...ALL_DAMAGE_STEP_TIMINGS],
    };
  }
  if (effectNegatesActivation(effect) && isActivationResponseContext(context)) {
    return {
      category: DAMAGE_STEP_ACTIVATION_CATEGORIES.ACTIVATION_NEGATION,
      allowedTimings: [...ALL_DAMAGE_STEP_TIMINGS],
    };
  }
  if (explicitTimings.length > 0) {
    return {
      category: DAMAGE_STEP_ACTIVATION_CATEGORIES.EXPLICIT_TIMING,
      allowedTimings: explicitTimings,
    };
  }
  const eventName = effect?.event;
  const eventTiming = eventName
    ? DAMAGE_STEP_EVENT_TIMINGS[eventName]
    : undefined;
  if (effect?.timing === "on_event" && eventTiming) {
    return {
      category: DAMAGE_STEP_ACTIVATION_CATEGORIES.EVENT_TRIGGER,
      allowedTimings: [eventTiming],
    };
  }
  if (
    isDamageStepEffectSource(effect, card) &&
    effectDirectlyChangesAtkDef(effect)
  ) {
    return {
      category: DAMAGE_STEP_ACTIVATION_CATEGORIES.DIRECT_ATK_DEF,
      allowedTimings: [...PRE_CALCULATION_TIMINGS],
    };
  }
  return {
    category: DAMAGE_STEP_ACTIVATION_CATEGORIES.GENERIC_FAST_EFFECT,
    allowedTimings: [],
  };
}

function isQuickMonsterEffect(
  effect: QuickSpellEffectView | null | undefined,
  card: QuickSpellCardView | null | undefined,
): boolean {
  return (
    card?.cardKind === "monster" &&
    (effect?.isQuickEffect === true || Number(effect?.speed) === 2)
  );
}

function isDamageStepEffectSource(
  effect: QuickSpellEffectView | null | undefined,
  card: QuickSpellCardView | null | undefined,
): boolean {
  return (
    isQuickSpell(card) ||
    card?.cardKind === "trap" ||
    isQuickMonsterEffect(effect, card) ||
    (effect?.timing === "on_event" && effect?.event === "battle_damage")
  );
}

export function isQuickSpell(
  card: QuickSpellCardView | null | undefined,
): boolean {
  return (
    card?.cardKind === "spell" &&
    QUICK_SPELL_SUBTYPES.has(String(card.subtype || "").toLowerCase())
  );
}

export function getQuickSpellActivationZone(
  card: QuickSpellCardView | null | undefined,
  player: QuickSpellPlayerView | null | undefined,
): QuickSpellActivationZone | null {
  if (!card || !player || !isQuickSpell(card)) return null;
  if (Array.isArray(player.hand) && player.hand.includes(card)) return "hand";
  if (Array.isArray(player.spellTrap) && player.spellTrap.includes(card)) {
    return "spellTrap";
  }
  return null;
}

export function canActivateQuickSpellFromHand(
  game: QuickSpellGameView | null | undefined,
  card: QuickSpellCardView | null | undefined,
  player: QuickSpellPlayerView | null | undefined,
  context: QuickSpellContext = {},
): QuickSpellLegalityResult {
  if (!isQuickSpell(card)) {
    return failure("NOT_QUICK_SPELL", "Card is not a Quick Spell.", {
      activationZone: "hand",
    });
  }
  if (!card || !player?.hand?.includes?.(card)) {
    return failure("NOT_IN_HAND", "Quick Spell is not in hand.", {
      activationZone: "hand",
    });
  }
  if (game?.turn !== player.id) {
    return failure(
      "OPPONENT_TURN_HAND",
      "Quick Spell cannot be activated from hand on the opponent's turn.",
      { activationZone: "hand" },
    );
  }
  if ((player.spellTrap || []).length >= 5) {
    return failure(
      "SPELL_TRAP_ZONE_FULL",
      "Spell/Trap Zone is full.",
      { activationZone: "hand" },
    );
  }

  const speedCheck = checkSpellSpeed(context);
  if (!speedCheck.ok) return { ...speedCheck, activationZone: "hand" };

  const damageStepCheck = canActivateInDamageStep(
    context.effect,
    card,
    context,
  );
  if (!damageStepCheck.ok) {
    return { ...damageStepCheck, activationZone: "hand" };
  }

  if (!hasLegalQuickSpellWindow(game, player, context)) {
    return failure(
      "NO_LEGAL_WINDOW",
      "No legal Quick Spell activation window is open.",
      { activationZone: "hand" },
    );
  }

  return result(true, { activationZone: "hand" });
}

export function canActivateSetQuickSpell(
  game: QuickSpellGameView | null | undefined,
  card: QuickSpellCardView | null | undefined,
  player: QuickSpellPlayerView | null | undefined,
  context: QuickSpellContext = {},
): QuickSpellLegalityResult {
  if (!isQuickSpell(card)) {
    return failure("NOT_QUICK_SPELL", "Card is not a Quick Spell.", {
      activationZone: "spellTrap",
    });
  }
  if (!card || !player?.spellTrap?.includes?.(card)) {
    return failure(
      "NOT_IN_SPELL_TRAP_ZONE",
      "Quick Spell is not in the Spell/Trap Zone.",
      { activationZone: "spellTrap" },
    );
  }
  if (card.isFacedown !== true) {
    return failure("NOT_SET", "Quick Spell must be Set to activate here.", {
      activationZone: "spellTrap",
    });
  }

  const setTurn = getSetTurn(card);
  if (setTurn === null || setTurn === undefined) {
    return failure("SET_TURN_MISSING", "Set turn is missing.", {
      activationZone: "spellTrap",
    });
  }
  if (!Number.isFinite(Number(game?.turnCounter))) {
    return failure("TURN_COUNTER_MISSING", "Current turn is missing.", {
      activationZone: "spellTrap",
    });
  }
  if (Number(setTurn) >= Number(game?.turnCounter)) {
    return failure(
      "SET_THIS_TURN",
      "Quick Spell cannot be activated the turn it was Set.",
      { activationZone: "spellTrap" },
    );
  }

  const speedCheck = checkSpellSpeed(context);
  if (!speedCheck.ok) return { ...speedCheck, activationZone: "spellTrap" };

  const damageStepCheck = canActivateInDamageStep(
    context.effect,
    card,
    context,
  );
  if (!damageStepCheck.ok) {
    return { ...damageStepCheck, activationZone: "spellTrap" };
  }

  if (!hasLegalQuickSpellWindow(game, player, context)) {
    return failure(
      "NO_LEGAL_WINDOW",
      "No legal Quick Spell activation window is open.",
      { activationZone: "spellTrap" },
    );
  }

  return result(true, { activationZone: "spellTrap" });
}

export function canActivateQuickSpell(
  game: QuickSpellGameView | null | undefined,
  card: QuickSpellCardView | null | undefined,
  player: QuickSpellPlayerView | null | undefined,
  context: QuickSpellContext = {},
): QuickSpellLegalityResult {
  const requestedZone = context.activationZone || context.zone || null;
  const zone =
    requestedZone === "hand" || requestedZone === "spellTrap"
      ? requestedZone
      : getQuickSpellActivationZone(card, player);

  if (zone === "hand") {
    return canActivateQuickSpellFromHand(game, card, player, context);
  }
  if (zone === "spellTrap") {
    return canActivateSetQuickSpell(game, card, player, context);
  }

  return failure(
    "QUICK_SPELL_ZONE_NOT_FOUND",
    "Quick Spell is not in an activatable zone.",
    { activationZone: null },
  );
}

export function effectDirectlyChangesAtkDef(
  effect: QuickSpellEffectView | null | undefined,
): boolean {
  const actions = Array.isArray(effect?.actions) ? effect.actions : [];
  if (actions.length === 0) return false;

  let foundDirectStatChange = false;
  for (const action of actions) {
    if (!action || !action.type) return false;
    if (actionDirectlyChangesAtkDef(action)) {
      foundDirectStatChange = true;
      continue;
    }
    if (isSelfGraveyardCostAction(action, effect)) {
      continue;
    }
    return false;
  }

  return foundDirectStatChange;
}

export function canActivateDuringDamageStep(
  effect: QuickSpellEffectView | null | undefined,
  card: QuickSpellCardView | null | undefined,
  context: QuickSpellContext = {},
): QuickSpellLegalityResult {
  const spellSpeed = getCardSpellSpeed(card, effect);
  if (!isDamageStepContext(context)) {
    return result(true, {
      spellSpeed,
      category: null,
      timing: null,
      allowedTimings: [],
    });
  }
  const timing = context.damageStepTiming || null;
  const classification = classifyDamageStepActivation(effect, card, context);
  if (
    !timing ||
    !ALL_DAMAGE_STEP_TIMINGS.includes(timing as DamageStepTiming)
  ) {
    return failure(
      "DAMAGE_STEP_TIMING_MISSING",
      "Damage Step activation requires an exact substep.",
      { spellSpeed, timing, ...classification },
    );
  }
  const damageStepTiming = timing as DamageStepTiming;
  if (classification.allowedTimings.includes(damageStepTiming)) {
    return result(true, {
      spellSpeed,
      timing: damageStepTiming,
      ...classification,
    });
  }
  return failure(
    "DAMAGE_STEP_RESTRICTED",
    `This effect cannot be activated during ${timing}.`,
    { spellSpeed, timing, ...classification },
  );
}

export function canActivateInDamageStep(
  effect: QuickSpellEffectView | null | undefined,
  card: QuickSpellCardView | null | undefined,
  context: QuickSpellContext = {},
): QuickSpellLegalityResult {
  return canActivateDuringDamageStep(effect, card, context);
}
