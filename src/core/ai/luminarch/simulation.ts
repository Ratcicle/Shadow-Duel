import { appendSimulatedZoneCard } from "../common/zones.js";
import { estimateCardValue } from "../StrategyUtils.js";
import { hasActivePiercing } from "../../game/combat/availability.js";
import { buildStrategyAnalysis } from "../common/analysis.js";
import { resolvePerspectiveSlotForPlayer } from "../common/perspective.js";
import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getPiercingDamage,
  getStrongestAttackThreat,
} from "../common/cardStats.js";
import {
  applyGenericSimulatedMainPhaseAction,
  attachSimulatedEventEmitter,
  simulateGenericSpellEffect,
} from "../common/simulation.js";
import { applySimulatedActions } from "../common/simulatedActions/index.js";
import { canUseSimulatedPassive, type SimulatedActionOptions } from "../common/simulatedActions/shared.js";
import { isLuminarch } from "./knowledge.js";
import { shouldPlaySpell } from "./priorities.js";
import type {
  AIAction,
  AIStrategyBotPort,
  AIActivationContext,
  AIPlannedAction,
} from "../../contracts/ai.js";
import type { PerspectiveGameState, SimulatedCardState, SimulatedLuminarchState, SimulatedPlayerState, SimulationGameState } from "../../contracts/aiState.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { GameCard } from "../../contracts/cards.js";

type LuminarchState = SimulationGameState | PerspectiveGameState;
type LuminarchPositionName =
  | "Luminarch Megashield Barbarias"
  | "Sanctum of the Luminarch Citadel"
  | "Luminarch Celestial Marshal"
  | "Luminarch Enchanted Halberd"
  | "Luminarch Fortress Aegis"
  | "Luminarch Magic Sickle"
  | "Luminarch Pure Knight"
  | "Luminarch Aegisbearer"
  | "Luminarch Sanctified Arbiter"
  | "Luminarch Crescent Shield"
  | "Luminarch Holy Shield"
  | "Luminarch Moonlit Blessing"
  | "Luminarch Moonblade Captain"
  | "Luminarch Sunforged Blade"
  | "Luminarch Valiant - Knight of the Dawn";

interface LuminarchActionContext {
  preferredSearchNames?: Array<string | undefined>;
  specialSummonPositions?: {
    byTargetRef?: Partial<Record<"moonblade_revive_target", "attack" | "defense" | "choice">>;
    byName?: Partial<Record<LuminarchPositionName, "attack" | "defense">>;
    default?: "attack" | "defense";
  };
  fusionPositions?: {
    byName?: Partial<Record<LuminarchPositionName, "attack" | "defense">>;
  };
}

type LuminarchActivationContext = Omit<
  AIActivationContext,
  "actionContext"
> & {
  actionContext?: LuminarchActionContext;
};

interface LuminarchAction {
  type: AIPlannedAction["type"] | "special_summon_from_zone";
  cardName?: string;
  index?: number;
  fieldIndex?: number;
  zoneIndex?: number;
  materialIndex?: number | undefined;
  position?: "attack" | "defense" | "choice";
  facedown?: boolean;
  targetRef?: string;
  zone?: string;
  activationContext?: LuminarchActivationContext;
  sourceAction?: LuminarchAction;
  fusionTargetHint?: string | null | undefined;
  fusionTarget?: string | null;
}

type PreparedLuminarchAction = AIPlannedAction & {
  fusionTargetHint?: string | null | undefined;
  fusionTarget?: string | null;
};

interface LuminarchStrategyContext {
  bot?: AIStrategyBotPort;
}

interface LuminarchSimulationOptions extends Pick<NonNullable<Parameters<typeof applyGenericSimulatedMainPhaseAction>[2]>, "getTributeRequirementFor" | "selectBestTributes" | "placeSpellCard" | "onLpPayment"> {
  chooseSummonPosition?(card: SimulatedCardState, game: LuminarchState): "attack" | "defense";
  strategy?: LuminarchStrategyContext;
  getOpponent?: (
    state: LuminarchState,
    player: SimulatedPlayerState,
  ) => SimulatedPlayerState | null | undefined;
  citadelTempBuff?: unknown;
  sourceAction?: LuminarchAction;
  activationContext?: LuminarchActivationContext;
  actionOverrides?: {
    handIgnition?: (input: LuminarchActionOverrideInput) => unknown;
    special_summon_sanctum_protector?: (
      input: LuminarchActionOverrideInput,
    ) => unknown;
  };
}

interface LuminarchSearchContext {
  player?: SimulatedPlayerState;
  opponent?: SimulatedPlayerState;
  strategy?: LuminarchStrategyContext | undefined;
  getOpponent?: LuminarchSimulationOptions["getOpponent"];
  game?: LuminarchState & {
    getOpponent?(
      player: SimulatedPlayerState,
    ): SimulatedPlayerState | null | undefined;
  };
  state?: LuminarchState;
  source?: SimulatedCardState;
  sourceCard?: SimulatedCardState;
  ctx?: { activationContext?: LuminarchActivationContext };
  activationContext?: LuminarchActivationContext | undefined;
}

interface LuminarchPositionContext extends LuminarchSearchContext {
  action?: LuminarchAction | undefined;
  sourceAction?: LuminarchAction | undefined;
  options?: LuminarchSimulationOptions | undefined;
}

interface LuminarchActionOverrideInput {
  state: LuminarchState;
  action: LuminarchAction;
  options: LuminarchSimulationOptions;
  player?: SimulatedPlayerState;
  card?: SimulatedCardState;
  newCard?: SimulatedCardState;
  resolveSimulatedHandIndex(
    player: SimulatedPlayerState,
    action: LuminarchAction,
    expectedKind?: string | string[] | null,
  ): number;
  resolveSimulatedFieldIndex(
    player: SimulatedPlayerState,
    action: Partial<LuminarchAction>,
    predicate?: ((card: SimulatedCardState) => boolean) | null,
  ): number;
}

interface LuminarchBattleEvent {
  tag?: string;
  type?: string;
  cardName?: string;
  hostName?: string | null;
  sourceName?: string | null;
  attackerName?: string | null;
  targetName?: string | null;
  counterType?: string;
  amount?: number;
  baseAmount?: number;
  cost?: number;
  beforeLp?: number;
  afterLp?: number;
  destroyedCount?: number;
  direct?: boolean;
  barbariasDoubled?: boolean;
  changed?: boolean | undefined;
  directLethal?: boolean;
  createsRemoval?: boolean;
  preventsAttackerLoss?: boolean;
  createsPiercingDamage?: boolean | undefined;
  damageGain?: number;
  attackStat?: number;
  boostedAtk?: number;
  targetStat?: number;
  destroysBefore?: boolean;
  destroysAfter?: boolean;
  attackerDiesBefore?: boolean;
  attackerDiesAfter?: boolean;
}

interface LuminarchLpGain {
  playerId?: string;
  amount: number;
  baseAmount?: number;
  sourceName?: string | null;
  reason?: string;
  barbariasDoubled?: boolean;
  _luminarchProcessed?: boolean;
}

interface LuminarchBattleSummary {
  attackerName?: string;
  damage?: number;
  rewardNames?: string[];
  lpGains?: LuminarchLpGain[];
  destroyedCards?: Array<{
    card?: SimulatedCardState;
    owner?: "self" | "opponent" | string;
    cardKind?: string;
    name?: string;
    baseAtk?: number;
    atk?: number;
  }>;
}

interface LuminarchBattlePlan {
  attackerCard?: SimulatedCardState;
}


interface LuminarchLpPaymentInput {
  cardName: string;
  cost: number;
  beforeLp: number;
  afterLp: number;
  createsWall?: boolean;
  createsPayoff?: boolean;
  opponentThreat?: number;
  risky?: boolean;
}

interface PrepareLuminarchBattleInput {
  state: LuminarchState;
  attacker: SimulatedCardState;
  target: SimulatedCardState | null;
  opponent: Partial<SimulatedPlayerState>;
}

interface ApplyLuminarchBattleRewardsInput {
  state: LuminarchState;
  battlePlan?: LuminarchBattlePlan;
  summary?: LuminarchBattleSummary;
  bot?: SimulatedPlayerState;
}

interface ScoreLuminarchBattleInput {
  attacker?: LuminarchBattleReadCard | null;
  target?: LuminarchBattleReadCard | null;
  lethalNow?: boolean;
  attackerSurvived?: boolean;
  targetSurvived?: boolean;
  summary?: LuminarchBattleReadSummary;
  simState?: LuminarchBattleReadState;
  opponent?: LuminarchBattleReadPlayer;
  isSecondAttack?: boolean;
}

type EnsuredLuminarchMeta = Omit<
  SimulatedLuminarchState,
  "lpPayments" | "milestones" | "battleEvents"
> & {
  lpPayments: LuminarchLpPaymentInput[];
  milestones: string[];
  battleEvents: LuminarchBattleEvent[];
};

const BARBARIAS_NAME = "Luminarch Megashield Barbarias";
const CITADEL_NAME = "Sanctum of the Luminarch Citadel";
const CELESTIAL_MARSHAL_NAME = "Luminarch Celestial Marshal";
const ENCHANTED_HALBERD_NAME = "Luminarch Enchanted Halberd";
const FORTRESS_AEGIS_NAME = "Luminarch Fortress Aegis";
const MAGIC_SICKLE_NAME = "Luminarch Magic Sickle";
const PURE_KNIGHT_NAME = "Luminarch Pure Knight";
const AEGISBEARER_NAME = "Luminarch Aegisbearer";
const ARBITER_NAME = "Luminarch Sanctified Arbiter";
const CRESCENT_SHIELD_NAME = "Luminarch Crescent Shield";
const HOLY_SHIELD_NAME = "Luminarch Holy Shield";
const MOONLIT_BLESSING_NAME = "Luminarch Moonlit Blessing";
const MOONBLADE_CAPTAIN_NAME = "Luminarch Moonblade Captain";
const SUNFORGED_BLADE_NAME = "Luminarch Sunforged Blade";
const VALIANT_NAME = "Luminarch Valiant - Knight of the Dawn";

export function rankLuminarchSearchCandidates(
  cards: SimulatedCardState[],
  action: Partial<LuminarchAction> = {},
  ctx: LuminarchSearchContext = {},
): SimulatedCardState[] {
  if (!Array.isArray(cards) || cards.length <= 1) return cards || [];
  const player = (ctx.player ||
    ctx.strategy?.bot || {}) as SimulatedPlayerState;
  const opponent =
    (ctx.opponent ||
      ctx.getOpponent?.((ctx.game || {}) as LuminarchState, player) ||
      {}) as SimulatedPlayerState;
  const hand = player.hand || [];
  const field = player.field || [];
  const spellTrap = player.spellTrap || [];
  const graveyard = player.graveyard || [];
  const sourceName = ctx.source?.name || ctx.sourceCard?.name || "";
  const isValiantSearch = sourceName === VALIANT_NAME;
  const isArbiterSearch = sourceName === ARBITER_NAME;
  const isCitadel = (card: SimulatedCardState | null | undefined) =>
    (card?.name || "").includes("Citadel");
  const hasActiveCitadel = isCitadel(player.fieldSpell);
  const hasCitadelInHand = hand.some(isCitadel);
  const hasCitadelAccess = hasActiveCitadel || hasCitadelInHand;
  const hasTank = field.some(
    (card) =>
      card?.name === AEGISBEARER_NAME ||
      card?.name === "Luminarch Sanctum Protector" ||
      card?.name === FORTRESS_AEGIS_NAME,
  );
  const hasFaceupLuminarch = field.some(
    (card) => card && isLuminarch(card) && !card.isFacedown,
  );
  const controlsSunforged = spellTrap.some(
    (card) => card?.name === SUNFORGED_BLADE_NAME,
  );
  const hasUsefulEquipHost = hasFaceupLuminarch && !controlsSunforged;
  const hasGyLuminarch = graveyard.some((entry) => entry && isLuminarch(entry));
  const hasProtection = [...hand, ...spellTrap].some(
    (card) =>
      card?.name === HOLY_SHIELD_NAME ||
      card?.name === CRESCENT_SHIELD_NAME ||
      card?.name === MOONLIT_BLESSING_NAME,
  );
  const oppStrongest = getStrongestAttackThreat(opponent.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const underPressure =
    oppStrongest >= 2200 || (opponent.field || []).length >= 2;
  const namesInHand = new Set(hand.map((card) => card?.name).filter(Boolean));

  const analysis = buildStrategyAnalysis({
    bot: player,
    opponent,
    game: ctx.game as NonNullable<
      Parameters<typeof buildStrategyAnalysis>[0]
    >["game"],
  });
  const preferredSearchNames =
    ctx.ctx?.activationContext?.actionContext?.preferredSearchNames ||
    ctx.activationContext?.actionContext?.preferredSearchNames ||
    [];

  const scoreCard = (card: SimulatedCardState | null | undefined) => {
    if (!card) return -999;
    let score = estimateCardValue(card, {
      archetype: "Luminarch",
      fieldSpell: player.fieldSpell || null,
      preferDefense: true,
    });
    if (!isLuminarch(card)) score -= 20;
    if (namesInHand.has(card.name)) score -= 4;
    if (preferredSearchNames.includes(card.name as string)) score += 100;

    if (card.cardKind === "monster") {
      if (card.name === AEGISBEARER_NAME && !hasTank) score += 60;
      if (
        card.name === ARBITER_NAME &&
        !hasActiveCitadel &&
        !hasCitadelInHand
      ) {
        score += 45;
      }
      if (card.name === "Luminarch Enchanted Halberd") score += 18;
      if (card.name === MAGIC_SICKLE_NAME) {
        score += underPressure ? 10 : 2;
      }
      if (isValiantSearch) {
        if (card.name === AEGISBEARER_NAME) score += !hasTank ? 90 : 12;
        if (card.name === ARBITER_NAME) score += !hasCitadelAccess ? 70 : 18;
        if (card.name === ENCHANTED_HALBERD_NAME) {
          score += hasOpenMonsterZone(player) ? 32 : 8;
        }
        if (card.name === MAGIC_SICKLE_NAME) score += underPressure ? 28 : 10;
      }
      if (underPressure && !hasTank && (card.def as number) >= 2000) score += 20;
      return score;
    }

    if (isCitadel(card)) {
      score += hasActiveCitadel || hasCitadelInHand ? -120 : 90;
      if (isArbiterSearch && !hasCitadelAccess) score += 120;
    }
    if (card.name === HOLY_SHIELD_NAME) {
      score += underPressure && !hasProtection ? 55 : 24;
      if (isArbiterSearch) score += underPressure ? 70 : 24;
    }
    if (card.name === CRESCENT_SHIELD_NAME) {
      score += hasUsefulEquipHost ? (underPressure ? 42 : 14) : -60;
    }
    if (card.name === MOONLIT_BLESSING_NAME) {
      score += hasGyLuminarch ? 35 : 8;
      if (isArbiterSearch) score += hasGyLuminarch ? 45 : -20;
    }
    if (card.name === "Luminarch Radiant Wave") {
      score += shouldPlaySpell(card, analysis).yes ? 32 : -35;
    }
    if (card.name === "Luminarch Holy Ascension") {
      score += shouldPlaySpell(card, analysis).yes ? 28 : -30;
    }
    if (card.name === "Luminarch Knights Convocation") {
      const convocationDecision = shouldPlaySpell(card, analysis);
      score += convocationDecision.yes
        ? (convocationDecision.priority as number) * 4
        : -40;
    }
    if (card.name === SUNFORGED_BLADE_NAME) {
      if (!hasUsefulEquipHost || controlsSunforged) score -= 90;
      else score += hasActiveCitadel ? 22 : 8;
    }
    return score;
  };

  return cards.slice().sort((a, b) => scoreCard(b) - scoreCard(a));
}

export function simulateLuminarchSearch(
  player: SimulatedPlayerState,
  sourceCard: SimulatedCardState,
  action: Partial<LuminarchAction>,
  state: LuminarchState,
  options: LuminarchSimulationOptions = {},
): SimulatedCardState | null {
  const effect = sourceCard.effects?.find(effect => effect.actions?.some(action => action.type === "search_any"));
  const search = effect?.actions?.find(action => action.type === "search_any");
  if (!effect || !search) return null;
  const before = new Set(player.hand);
  applySimulatedActions({ state, selfId: resolvePerspectiveSlotForPlayer(state, player) || "bot", actions: [search], options: {
    ...buildLuminarchSimulationOptions(state, null, options), activationContext: {}, strategy: {}, sourceCard, effect,
    rankSearchCandidates: (cards, searchAction, context) => rankLuminarchSearchCandidates(cards, action, {
      ...context, player, opponent: state.player, game: state,
      source: sourceCard, strategy: options.strategy, getOpponent: options.getOpponent,
    }),
  } });
  return player.hand.find(card => !before.has(card)) || null;
}

function handleSanctumProtectorShortcut({
  state,
  action,
  options,
  resolveSimulatedHandIndex,
}: LuminarchActionOverrideInput): true {
  const player = state.bot;
  const handIndex = resolveSimulatedHandIndex(
    player,
    {
      ...action,
      cardName: action.cardName || "Luminarch Sanctum Protector",
    },
    "monster",
  );
  if (handIndex < 0) return true;
  const materialIndex = Number.isInteger(action.materialIndex) ? action.materialIndex! :
    player.field.findIndex(card => card.name === AEGISBEARER_NAME && !card.isFacedown);
  if (materialIndex < 0) return true;
  const material = player.field[materialIndex];
  const protector = player.hand[handIndex];
  if (!protector || protector.name !== "Luminarch Sanctum Protector" || !material ||
    material.name !== AEGISBEARER_NAME || material.isFacedown || material.instanceId === undefined) return true;
  const effect = protector.effects?.find(effect => effect.timing === "ignition" && effect.activationZones?.includes("hand"));
  const costTarget = effect?.targets?.find(target => target.intent === "cost");
  if (!effect || !costTarget) return true;
  applyGenericSimulatedMainPhaseAction(state, {
    type: "handIgnition", index: handIndex, cardName: protector.name, effectId: effect.id, priority: 0,
    activationContext: {
      decisions: { selections: { [costTarget.id]: [material.instanceId] } },
      actionContext: { specialSummonPositions: {
        byName: { [protector.name]: action.position === "attack" ? "attack" : "defense" },
      } },
    },
  }, options);
  return true;
}

function ensureLuminarchSimMeta(
  state: LuminarchState,
): EnsuredLuminarchMeta {
  if (!state._simLuminarch) {
    state._simLuminarch = {
      lpPayments: [],
      milestones: [],
      battleEvents: [],
    };
  }
  if (!Array.isArray(state._simLuminarch.lpPayments)) {
    state._simLuminarch.lpPayments = [];
  }
  if (!Array.isArray(state._simLuminarch.milestones)) {
    state._simLuminarch.milestones = [];
  }
  if (!Array.isArray(state._simLuminarch.battleEvents)) {
    state._simLuminarch.battleEvents = [];
  }
  return state._simLuminarch as EnsuredLuminarchMeta;
}

function recordLuminarchBattleEvent(
  state: LuminarchState,
  event: LuminarchBattleEvent = {},
): LuminarchBattleEvent | null {
  const tag = event?.tag || event?.type;
  if (!tag) return null;
  const meta = ensureLuminarchSimMeta(state);
  const entry = {
    ...event,
    tag,
  };
  meta.battleEvents.push(entry);
  return entry;
}

function getOpponentStrongestAttack(state: LuminarchState): number {
  return getStrongestAttackThreat(state?.player?.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
}

function isLuminarchMonster(
  card: GameCard | SimulatedCardState | null | undefined,
): boolean {
  return card?.cardKind === "monster" && isLuminarch(card);
}

function hasFaceupBarbarias(
  player: Partial<SimulatedPlayerState> = {},
): boolean {
  return (player.field || []).some(
    (card) => card?.name === BARBARIAS_NAME && !card.isFacedown,
  );
}

function applyNewLuminarchLpGain(
  state: LuminarchState,
  player: SimulatedPlayerState,
  amount: number,
  sourceName: string,
  summary: LuminarchBattleSummary | null | undefined,
  rewards: string[],
  sourceCard: SimulatedCardState | null = null,
): number {
  const base = Math.max(0, Math.floor(Number(amount || 0)));
  if (!player || base <= 0) return 0;
  const before = player.lp;
  const eventsBefore = ensureLuminarchSimMeta(state).battleEvents.length;
  // Battle dispatch remains scoped to the existing Luminarch reward adapter.
  // Healing and its LP triggers use the same actions as main-phase effects.
  applySimulatedActions({ state, selfId: resolvePerspectiveSlotForPlayer(state, player) || "bot", actions: [{ type: "heal", amount: base }],
    options: attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, sourceCard,
      onEffectActivated: handleLuminarchEffectActivated }) });
  const gained = player.lp - before;
  const doubled = hasFaceupBarbarias(player) && gained === base * 2;
  for (const event of ensureLuminarchSimMeta(state).battleEvents.slice(eventsBefore)) {
    if (event.tag === "sunforgedCounter") rewards.push("Sunforged Blade gained a Solar Counter");
  }
  if (summary) {
    if (!Array.isArray(summary.lpGains)) summary.lpGains = [];
    summary.lpGains.push({
      playerId: player.id || "bot",
      amount: gained,
      baseAmount: base,
      sourceName,
      barbariasDoubled: doubled,
    });
  }
  recordLuminarchBattleEvent(state, {
    tag: sourceName === "Luminarch Aurora Seraph" ? "auroraHeal" : "luminarchLpGain",
    sourceName,
    amount: gained,
    baseAmount: base,
    barbariasDoubled: doubled,
  });
  if (doubled) {
    recordLuminarchBattleEvent(state, {
      tag: "barbariasDoubledHeal",
      sourceName,
      amount: gained,
      baseAmount: base,
    });
    rewards.push("Barbarias doubled LP gain");
  }
  ensureLuminarchSimMeta(state).milestones.push("luminarch_battle_lp_gain");
  return gained;
}

function finalizeExistingLuminarchLpGains(
  state: LuminarchState, player: SimulatedPlayerState, summary: LuminarchBattleSummary,
  rewards: string[], sourceCard: SimulatedCardState | null,
): void {
  // The battle bridge records a base heal instead of damage. Reconcile that
  // one receipt through common heal; emit precisely one gain event.
  for (const gain of summary.lpGains || []) {
    if (gain._luminarchProcessed || (gain.playerId && gain.playerId !== player.id)) continue;
    const base = Math.max(0, Number(gain.amount || 0));
    if (!base) continue;
    player.lp -= base;
    gain.amount = applyNewLuminarchLpGain(state, player, base, gain.sourceName || "", null, rewards, sourceCard);
    gain.baseAmount = base;
    gain.barbariasDoubled = hasFaceupBarbarias(player) && gain.amount === base * 2;
    if (gain.reason === "battle_damage_heal") recordLuminarchBattleEvent(state, {
      tag: "holyShieldDamageHealed", sourceName: gain.sourceName || null, amount: gain.amount,
      baseAmount: base, barbariasDoubled: gain.barbariasDoubled,
    });
    gain._luminarchProcessed = true;
  }
}

function hasOpenMonsterZone(
  player: Partial<SimulatedPlayerState> | null | undefined,
): boolean {
  return (player?.field || []).length < 5;
}

function getContextOpponent(
  context: LuminarchPositionContext = {},
): Partial<SimulatedPlayerState> {
  if (context.opponent) return context.opponent;
  if (context.state?._isPerspectiveState) return context.state.player || {};
  if (context.game?._isPerspectiveState) return context.game.player || {};
  if (
    context.player &&
    context.game &&
    typeof context.game.getOpponent === "function"
  ) {
    return context.game.getOpponent(context.player) || {};
  }
  if (
    context.player &&
    context.options &&
    typeof context.options.getOpponent === "function"
  ) {
    return context.options.getOpponent(
      (context.game || context.state || {}) as LuminarchState,
      context.player,
    ) || {};
  }
  return context.state?.player || context.game?.player || {};
}

function getOpponentStrongestAttackFromContext(
  context: LuminarchPositionContext = {},
): number {
  return getStrongestAttackThreat(getContextOpponent(context)?.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
}

function getActionContext(
  context: LuminarchPositionContext = {},
): LuminarchActionContext {
  return (
    context.action?.activationContext?.actionContext ||
    context.sourceAction?.activationContext?.actionContext ||
    context.activationContext?.actionContext ||
    {}
  );
}

function getPreferredSpecialSummonPosition(
  card: LuminarchBattleReadCard,
  context: LuminarchPositionContext = {},
): "attack" | "defense" | null {
  const actionContext = getActionContext(context);
  const special = actionContext.specialSummonPositions || {};
  const fusion = actionContext.fusionPositions || {};
  const targetRef = context.action?.targetRef || context.sourceAction?.targetRef;
  const byTarget =
    targetRef && special.byTargetRef
      ? special.byTargetRef[targetRef as "moonblade_revive_target"]
      : null;
  const byName =
    card?.name && special.byName
      ? special.byName[card.name as LuminarchPositionName]
      : null;
  const fusionByName =
    card?.name && fusion.byName
      ? fusion.byName[card.name as LuminarchPositionName]
      : null;
  const preferred = byTarget || byName || special.default || fusionByName;
  return preferred === "attack" || preferred === "defense" ? preferred : null;
}

export function chooseLuminarchSpecialSummonPosition(
  card: LuminarchBattleReadCard,
  context: LuminarchPositionContext = {},
): "attack" | "defense" {
  const actionPosition = context.action?.position;
  if (actionPosition && actionPosition !== "choice") return actionPosition;

  const preferred = getPreferredSpecialSummonPosition(card, context);
  if (preferred) return preferred;

  if (
    card?.name === BARBARIAS_NAME ||
    card?.name === PURE_KNIGHT_NAME ||
    card?.name === FORTRESS_AEGIS_NAME
  ) {
    return "defense";
  }

  if (card?.name === CELESTIAL_MARSHAL_NAME) {
    return getOpponentStrongestAttackFromContext(context) > 0
      ? "defense"
      : "attack";
  }

  if (card?.name === ENCHANTED_HALBERD_NAME) {
    return "defense";
  }

  const opponentStrongest = getOpponentStrongestAttackFromContext(context);
  const atk = card?.atk || 0;
  const def = card?.def || 0;
  if (opponentStrongest > atk && def >= atk) return "defense";
  return "attack";
}

function recordLuminarchLpPayment(
  state: LuminarchState,
  {
    cardName,
    cost,
    beforeLp,
    afterLp,
    createsWall = false,
    createsPayoff = false,
  }: LuminarchLpPaymentInput,
): LuminarchLpPaymentInput {
  const meta = ensureLuminarchSimMeta(state);
  const opponentThreat = getOpponentStrongestAttack(state);
  const risky =
    afterLp > 0 &&
    opponentThreat >= afterLp &&
    createsWall !== true &&
    createsPayoff !== true;
  const payment = {
    cardName,
    cost,
    beforeLp,
    afterLp,
    opponentThreat,
    createsWall,
    createsPayoff,
    risky,
  };
  meta.lpPayments.push(payment);
  return payment;
}

function handleLuminarchFusionSummon({
  state,
  player,
  fusionCard,
  materials,
}: {
  state: LuminarchState;
  player: SimulatedPlayerState;
  fusionCard: SimulatedCardState;
  materials?: SimulatedCardState[];
  options?: LuminarchSimulationOptions;
}): void {
  if (!fusionCard || !player) return;

  const meta = ensureLuminarchSimMeta(state);
  if (fusionCard.name === PURE_KNIGHT_NAME) {
    const reducer = fusionCard.effects?.find(effect => effect.timing === "passive" &&
      "passive" in effect && effect.passive?.type === "lp_cost_reduction");
    const discountAvailable = !!reducer && canUseSimulatedPassive(state, player, fusionCard, reducer);
    fusionCard._simulatedRole = "citadel_access";
    fusionCard._simulatedLpCostReductionAvailable = discountAvailable;
    fusionCard._simulatedMaterialsUsed = (materials || []).map(
      (card) => card?.name as string,
    );
    meta.pureKnightDiscountAvailable = discountAvailable;
    meta.milestones.push("pure_knight_fusion");
    return;
  }

  if (fusionCard.name === BARBARIAS_NAME) {
    fusionCard._simulatedRole = "defensive_wall";
    fusionCard._simulatedLpPayoff = true;
    fusionCard._simulatedMaterialsUsed = (materials || []).map(
      (card) => card?.name as string,
    );
    meta.barbariasLpPayoff = true;
    meta.milestones.push("barbarias_fusion_wall");
  }
}

function handleLuminarchAfterSpecialSummon({
  state,
  player,
  card,
  sourceCard,
}: {
  state: LuminarchState;
  player: SimulatedPlayerState;
  card: SimulatedCardState;
  sourceCard?: SimulatedCardState | null;
}): void {
  if (sourceCard?.name === MOONBLADE_CAPTAIN_NAME && sourceCard !== card) {
    card._simulatedMoonbladeRevive = true;
    ensureLuminarchSimMeta(state).milestones.push("moonblade_revive");
  }
}

function handleLuminarchEffectActivated({
  state,
  player,
  card,
  effect,
  options,
}: {
  state: LuminarchState;
  player: SimulatedPlayerState;
  card: SimulatedCardState;
  effect: EffectDefinition;
  options?: SimulatedActionOptions;
}): void {
  if (!card || !effect || !player) return;
  if (player.field.includes(card) && effect.id === "luminarch_celestial_marshal_hand_summon") {
    card._simulatedMarshalSelfSummon = true;
    ensureLuminarchSimMeta(state).milestones.push("marshal_self_summon");
  }
  if (player.field.includes(card) && effect.id === "luminarch_enchanted_halberd_conditional_summon") {
    card._simulatedHalberdFollowUp = true;
    card._simulatedHalberdReason = "special_summon";
    ensureLuminarchSimMeta(state).halberdSummonedThisTurn = true;
    ensureLuminarchSimMeta(state).milestones.push("halberd_followup");
  }
  const searched = options?.lastAddedToHandCard || options?.actionContext?.lastAddedToHandCard ||
    options?.activationContext?.actionContext?.lastAddedToHandCard;
  if (searched && player.hand.includes(searched)) {
    if (effect.id === "luminarch_valiant_search") card._searchedAegis = true;
    if (effect.id === "luminarch_sanctified_arbiter_search") card._searchedSpell = true;
  }
  if (card.name === PURE_KNIGHT_NAME && effect.id === "luminarch_pure_knight_fusion_search") {
    card._simulatedCitadelSearch = searched?.name === CITADEL_NAME && player.hand.includes(searched);
    if (card._simulatedCitadelSearch) ensureLuminarchSimMeta(state).milestones.push("citadel_access");
  }
  if (card.name === MAGIC_SICKLE_NAME) {
    ensureLuminarchSimMeta(state).milestones.push("sickle_spell_recovery");
  }
  if (effect.id === "luminarch_sunforged_blade_solar_counter") {
    const host = card.equippedTo || card.equipTarget;
    recordLuminarchBattleEvent(state, { tag: "sunforgedCounter", cardName: card.name || "",
      hostName: host && typeof host === "object" ? host.name || null : null, counterType: "solar" });
  }

}

type LuminarchPaymentFact = Parameters<NonNullable<SimulatedActionOptions["onLpPayment"]>>[0];
interface LuminarchPaymentReceipt extends LuminarchPaymentFact {
  fieldBefore: ReadonlySet<SimulatedCardState>;
  payment: LuminarchLpPaymentInput;
}

function observeLuminarchLpPayment({ state, player, sourceCard: card, amount: lpCost,
  before: beforeLp, after: afterLp, fieldBefore, payment }: LuminarchPaymentReceipt): void {
  if (!card || player !== state.bot) return;
  const hasWall = card.name === CELESTIAL_MARSHAL_NAME
    ? player.field.includes(card) && card.position === "defense" &&
      ((card.def || 0) >= getOpponentStrongestAttack(state) || card.battleIndestructibleOncePerTurn === true)
    : (player.field || []).some(
    (entry) =>
      entry &&
      entry.cardKind === "monster" &&
      !entry.isFacedown &&
      (entry.mustBeAttacked ||
        entry.battleIndestructibleOncePerTurn ||
        (entry.position === "defense" && (entry.def || 0) >= getOpponentStrongestAttack(state))),
  );
  const createsPayoff = card.name === CELESTIAL_MARSHAL_NAME
    ? player.field.some(entry => entry.name === ENCHANTED_HALBERD_NAME && !fieldBefore.has(entry))
    : card.name === FORTRESS_AEGIS_NAME ||
    card.name === MAGIC_SICKLE_NAME ||
    card.name === BARBARIAS_NAME ||
    card.name === PURE_KNIGHT_NAME;

  const meta = ensureLuminarchSimMeta(state);
  const opponentThreat = getOpponentStrongestAttack(state);
  // Enrich the factual record after resolution without recording/paying it
  // again. If resolution stops, the receipt already retains the actual cost.
  Object.assign(payment, { opponentThreat, createsWall: hasWall, createsPayoff,
    risky: afterLp > 0 && opponentThreat >= afterLp && !hasWall && !createsPayoff });
  if (payment.risky) meta.milestones.push("risky_lp_payment");
  else if (hasWall) meta.milestones.push("lp_payment_created_wall");
  else if (createsPayoff) meta.milestones.push("lp_payment_created_payoff");
  if (card.name === FORTRESS_AEGIS_NAME) {
    ensureLuminarchSimMeta(state).milestones.push("fortress_revive");
  }
}

function getLuminarchFieldEffectTargetPreference({
  fieldSpell,
  options,
}: {
  fieldSpell: SimulatedCardState;
  options: LuminarchSimulationOptions;
}): unknown {
  return fieldSpell.name?.includes("Citadel") ? options.citadelTempBuff : null;
}

function analyzeMagicSickleBattleImpact(
  attacker: SimulatedCardState | null | undefined,
  target: SimulatedCardState | null | undefined,
  opponent: Partial<SimulatedPlayerState> | null | undefined,
) {
  const empty = {
    changed: false,
    directLethal: false,
    createsRemoval: false,
    preventsAttackerLoss: false,
    createsPiercingDamage: false,
    damageGain: 0,
  };
  if (!attacker || !isLuminarch(attacker)) return empty;
  const attackStat = getEffectiveAtk(attacker);
  const boostedAtk = attackStat + 1200;
  if (!target) {
    const opponentLp = Number(opponent?.lp || 0);
    const directLethal = opponentLp > attackStat && opponentLp <= boostedAtk;
    return {
      ...empty,
      changed: directLethal,
      directLethal,
      damageGain: 1200,
      attackStat,
      boostedAtk,
    };
  }

  const targetStat = getBattleStatForAttackTarget(target, { facedownValue: 1500 });
  const destroysBefore = attackStat > targetStat;
  const destroysAfter = boostedAtk > targetStat;
  const attackerDiesBefore =
    target.position === "attack" && attackStat <= targetStat;
  const attackerDiesAfter =
    target.position === "attack" && boostedAtk <= targetStat;
  const createsRemoval = !destroysBefore && destroysAfter;
  const preventsAttackerLoss = attackerDiesBefore && !attackerDiesAfter;
  const damageBefore =
    target.position === "defense"
      ? getPiercingDamage(attacker, attackStat, targetStat)
      : Math.max(0, attackStat - targetStat);
  const damageAfter =
    target.position === "defense"
      ? getPiercingDamage(attacker, boostedAtk, targetStat)
      : Math.max(0, boostedAtk - targetStat);
  const createsPiercingDamage =
    hasActivePiercing(attacker) &&
    target.position === "defense" &&
    damageAfter >= 1000;
  return {
    changed: createsRemoval || preventsAttackerLoss || createsPiercingDamage,
    directLethal: false,
    createsRemoval,
    preventsAttackerLoss,
    createsPiercingDamage,
    damageGain: damageAfter - damageBefore,
    attackStat,
    boostedAtk,
    targetStat,
    destroysBefore,
    destroysAfter,
    attackerDiesBefore,
    attackerDiesAfter,
  };
}

function prepareMagicSickleBattleBoost(
  state: LuminarchState,
  attacker: SimulatedCardState,
  target: SimulatedCardState | null,
  opponent: Partial<SimulatedPlayerState>,
): string | null {
  const player = state?.bot;
  const meta = ensureLuminarchSimMeta(state);
  if (!player || meta.magicSickleBattleUsed) return null;
  const impact = analyzeMagicSickleBattleImpact(attacker, target, opponent);
  if (!impact.changed) return null;
  const handIndex = (player.hand || []).findIndex(
    (card) => card?.name === MAGIC_SICKLE_NAME,
  );
  if (handIndex < 0) return null;
  const [sickle] = player.hand.splice(handIndex, 1);
  if (!sickle) return null;
  appendSimulatedZoneCard(player.graveyard, sickle);
  attacker.tempAtkBoost = (attacker.tempAtkBoost || 0) + 1200;
  attacker.tempDefBoost = (attacker.tempDefBoost || 0) + 1700;
  attacker.atk = (attacker.atk || 0) + 1200;
  attacker.def = (attacker.def || 0) + 1700;
  attacker._simMagicSickleBattleBoost = true;
  meta.magicSickleBattleUsed = true;
  meta.milestones.push("magic_sickle_battle_boost");
  recordLuminarchBattleEvent(state, {
    tag: "sickleChangedCombat",
    attackerName: attacker.name || null,
    targetName: target?.name || null,
    direct: !target,
    ...impact,
  });
  return "Magic Sickle changed combat";
}

export function prepareLuminarchSimulatedBattle({
  state,
  attacker,
  target,
  opponent,
}: PrepareLuminarchBattleInput = {} as PrepareLuminarchBattleInput): string[] {
  const rewards: string[] = [];
  const sickle = prepareMagicSickleBattleBoost(state, attacker, target, opponent);
  if (sickle) rewards.push(sickle);
  return rewards;
}

export function applyLuminarchSimulatedBattleRewards({
  state,
  battlePlan,
  summary,
  bot,
}: ApplyLuminarchBattleRewardsInput = {} as ApplyLuminarchBattleRewardsInput): string[] {
  const player = (bot || state?.bot || {}) as SimulatedPlayerState;
  const rewards: string[] = [];
  if (!summary) return rewards;



  const attacker =
    battlePlan?.attackerCard ||
    (player.field || []).find((card) => card?.name === summary.attackerName);
  finalizeExistingLuminarchLpGains(state, player, summary, rewards, attacker || null);
  const attackerSurvived = !!attacker && (player.field || []).includes(attacker);
  const destroyedOpponentMonsters = (summary.destroyedCards || []).filter(
    (entry) => entry?.owner === "opponent" && entry?.cardKind === "monster",
  );
  const destroyedOwnMonsters = (summary.destroyedCards || []).filter(
    (entry) => entry?.owner === "self" && entry?.cardKind === "monster",
  );

  if (destroyedOpponentMonsters.length > 0 && attackerSurvived) {
    if (summary.attackerName === MOONBLADE_CAPTAIN_NAME) {
      attacker.canMakeSecondAttackThisTurn = true;
      attacker.secondAttackUsedThisTurn = false;
      attacker.hasAttacked = false;
      ensureLuminarchSimMeta(state).milestones.push("moonblade_second_attack");
      recordLuminarchBattleEvent(state, {
        tag: "moonbladeSecondAttack",
        attackerName: summary.attackerName,
        destroyedCount: destroyedOpponentMonsters.length,
      });
      rewards.push("Moonblade gained second attack");
    }
    if (summary.attackerName === "Luminarch Radiant Lancer") {
      const growth = attacker.effects?.find(effect =>
        effect.event === "battle_destroy" && effect.requireSelfAsAttacker,
      )?.actions?.find(action => action.type === "permanent_buff_named");
      const amount = (growth?.atkBoost ?? 0) * destroyedOpponentMonsters.length;
      const sourceName = growth?.sourceName || summary.attackerName;
      attacker.permanentBuffsBySource ??= {};
      const buff = attacker.permanentBuffsBySource[sourceName] ??= {};
      buff.atk = (buff.atk ?? 0) + amount;
      if (growth?.duration) buff.duration = growth.duration;
      attacker.atk = (attacker.atk || 0) + amount;
      ensureLuminarchSimMeta(state).milestones.push("radiant_lancer_growth");
      recordLuminarchBattleEvent(state, {
        tag: "radiantLancerGrowth",
        attackerName: summary.attackerName,
        amount,
      });
      rewards.push("Radiant Lancer gained ATK");
    }
    if (summary.attackerName === "Luminarch Aurora Seraph") {
      const destroyed = destroyedOpponentMonsters[0];
      if (!destroyed) return rewards;
      const baseAtk = destroyed.baseAtk ?? destroyed.atk ?? 0;
      const gained = applyNewLuminarchLpGain(
        state,
        player,
        Math.floor(Math.max(0, Number(baseAtk || 0)) / 2),
        "Luminarch Aurora Seraph",
        summary,
        rewards,
        attacker,
      );
      if (gained > 0) rewards.push("Aurora Seraph gained LP");
    }
  }

  if (
    destroyedOwnMonsters.some((entry) => entry?.name === CELESTIAL_MARSHAL_NAME)
  ) {
    const gained = applyNewLuminarchLpGain(
      state,
      player,
      1000,
      CELESTIAL_MARSHAL_NAME,
      summary,
      rewards,
      destroyedOwnMonsters.find(entry => entry.name === CELESTIAL_MARSHAL_NAME)?.card || null,
    );
    if (gained > 0) {
      recordLuminarchBattleEvent(state, {
        tag: "marshalBattleHeal",
        sourceName: CELESTIAL_MARSHAL_NAME,
        amount: gained,
      });
      rewards.push("Marshal battle destruction heal");
    }
  }

  return rewards;
}

const LUMINARCH_WALL_BATTLE_NAMES = new Set([
  AEGISBEARER_NAME,
  BARBARIAS_NAME,
  CELESTIAL_MARSHAL_NAME,
  FORTRESS_AEGIS_NAME,
  "Luminarch Sanctum Protector",
  "Luminarch Aurora Seraph",
]);

function clampBattleScore(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getBattleCardValue(
  card: LuminarchBattleReadCard | null | undefined,
): number {
  if (!card || card.cardKind !== "monster") return 0;
  const battleStat = getBattleStatForAttackTarget(card, { facedownValue: 1500 });
  const printedBest = Math.max(Number(card.atk || 0), Number(card.def || 0));
  const levelValue = Number(card.level || 0) * 180;
  return Math.max(battleStat, printedBest, levelValue);
}

function getRawBattleStatForAttackTarget(
  card: LuminarchBattleReadCard | null | undefined,
  { facedownValue = 1500 }: { facedownValue?: number } = {},
): number {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) return facedownValue;
  return card.position === "defense"
    ? Math.max(0, Number(card.def || 0))
    : Math.max(0, Number(card.atk || 0));
}

function isTemporarilyZeroedBattleTarget(
  card: LuminarchBattleReadCard | null | undefined,
): boolean {
  if (!card || card.cardKind !== "monster" || card.isFacedown) return false;
  const battleStat = getRawBattleStatForAttackTarget(card);
  if (battleStat > 0) return false;

  const atkWasReduced = Number(card.tempAtkBoost || 0) < 0;
  const defWasReduced = Number(card.tempDefBoost || 0) < 0;
  if (card.position === "defense") return defWasReduced;
  return atkWasReduced;
}

function estimateRawBattleDamage(
  attacker: LuminarchBattleReadCard | null | undefined,
  target: LuminarchBattleReadCard | null | undefined,
): number {
  if (!attacker || !target || target.cardKind !== "monster") return 0;
  const attack = Math.max(0, Number(attacker.atk || 0));
  const targetStat = getRawBattleStatForAttackTarget(target);
  if (attack <= targetStat) return 0;
  if (target.position !== "defense") return attack - targetStat;
  return getPiercingDamage(attacker, attack, targetStat);
}

function sameBattleCardIdentity(
  a: LuminarchBattleReadCard | null | undefined,
  b: LuminarchBattleReadCard | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.instanceId != null && b.instanceId != null) {
    return a.instanceId === b.instanceId;
  }
  return a.name === b.name;
}

function hasOtherZeroedAttackTarget(
  opponent: LuminarchBattleReadPlayer = {},
  target: LuminarchBattleReadCard | null | undefined,
): boolean {
  return (opponent.field || []).some(
    (card) =>
      card &&
      card.position !== "defense" &&
      !sameBattleCardIdentity(card, target) &&
      isTemporarilyZeroedBattleTarget(card),
  );
}

function getSummaryLpGain(summary: LuminarchBattleReadSummary = {}): number {
  return (summary.lpGains || []).reduce(
    (sum, gain) => sum + Math.max(0, Number(gain?.amount || 0)),
    0,
  );
}

function getVisibleAttackTotal(
  player: LuminarchBattleReadPlayer = {},
): number {
  return (player.field || []).reduce((sum, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return sum;
    if (card.position === "defense") return sum;
    return sum + Math.max(0, getEffectiveAtk(card));
  }, 0);
}

function rewardMatches(rewards: unknown[] = [], pattern: RegExp): boolean {
  return rewards.some((name) => pattern.test(String(name || "")));
}

export function scoreLuminarchBattleAttackCandidate({
  attacker,
  target,
  lethalNow = false,
  attackerSurvived = false,
  targetSurvived = false,
  summary,
  simState,
  opponent,
  isSecondAttack = false,
}: ScoreLuminarchBattleInput = {}): number {
  if (!attacker || !isLuminarch(attacker)) return 0;
  const rewards = summary?.rewardNames || [];
  const battleEvents = simState?._simLuminarch?.battleEvents || [];
  const destroyedTarget = Boolean(target && !targetSurvived);
  const positiveDamage = Math.max(0, Number(summary?.damage || 0));
  const damageTaken = Math.max(0, -Number(summary?.damage || 0));
  const lpGain = getSummaryLpGain(summary);
  const targetValue = getBattleCardValue(target);
  const removedThreatValue = destroyedTarget ? targetValue : 0;
  const targetWasZeroed = isTemporarilyZeroedBattleTarget(target);
  const zeroedTargetDamage = targetWasZeroed
    ? estimateRawBattleDamage(attacker, target)
    : 0;
  const hasSickle = rewardMatches(rewards, /Magic Sickle/) ||
    battleEvents.some((event) => event?.tag === "sickleChangedCombat");
  const hasSunforgedProtection =
    rewardMatches(rewards, /Sunforged Blade protected/) ||
    battleEvents.some((event) => event?.tag === "sunforgedProtected");
  const hasMoonblade = rewardMatches(rewards, /Moonblade/) ||
    battleEvents.some((event) => event?.tag === "moonbladeSecondAttack");
  const hasRadiantGrowth = rewardMatches(rewards, /Radiant Lancer/) ||
    battleEvents.some((event) => event?.tag === "radiantLancerGrowth");
  const hasAuroraHeal = rewardMatches(rewards, /Aurora Seraph/) ||
    battleEvents.some((event) => event?.tag === "auroraHeal");
  const hasHolyShieldHeal =
    rewardMatches(rewards, /battle damage converted to LP/) ||
    battleEvents.some((event) => event?.tag === "holyShieldDamageHealed");
  const hasSunforged = rewardMatches(rewards, /Sunforged/) ||
    battleEvents.some((event) => event?.tag === "sunforgedCounter");
  const hasBarbariasDouble = rewardMatches(rewards, /Barbarias doubled/) ||
    battleEvents.some((event) => event?.tag === "barbariasDoubledHeal");
  let delta = 0;

  if (lethalNow) delta += 6;
  if (!target) {
    if (positiveDamage >= 2000) delta += 1.4;
    else if (positiveDamage >= 1000) delta += 0.7;
    else if (!lethalNow) delta -= 0.4;
  }
  if (destroyedTarget && attackerSurvived) {
    delta += 1.6 + Math.min(2.4, removedThreatValue / 1000);
  } else if (destroyedTarget) {
    delta += Math.min(1.5, removedThreatValue / 1600);
  }
  if (targetWasZeroed) {
    if (destroyedTarget) {
      delta += target?.position === "defense" ? 1.4 : 3.2;
      delta += Math.min(3, zeroedTargetDamage / 500);
    } else if (!lethalNow) {
      delta += target?.position === "defense" ? 0.4 : 1;
    }
  } else if (
    target &&
    !lethalNow &&
    hasOtherZeroedAttackTarget(opponent || simState?.player || {}, target)
  ) {
    delta -= 3.5;
  }

  if (hasSickle) {
    delta += destroyedTarget || lethalNow || positiveDamage >= 1000 ? 2.4 : -1.2;
  }
  if (hasSunforgedProtection) {
    delta += attackerSurvived ? 1.5 : 0.4;
  }
  if (hasMoonblade) {
    delta += destroyedTarget && attackerSurvived ? 2.2 : 0.8;
  }
  if (isSecondAttack && (destroyedTarget || positiveDamage >= 800 || lethalNow)) {
    delta += 0.9;
  }
  if (hasRadiantGrowth) delta += destroyedTarget ? 1.5 : 0.5;
  if (hasAuroraHeal) delta += 1 + Math.min(1.8, lpGain / 900);
  if (hasHolyShieldHeal) delta += 1.2 + Math.min(2, lpGain / 800);
  if (hasSunforged) delta += 0.8;
  if (hasBarbariasDouble) delta += lpGain >= 1000 ? 1.3 : 0.6;

  if (!attackerSurvived && !lethalNow) {
    const wallLoss =
      attacker.mustBeAttacked ||
      LUMINARCH_WALL_BATTLE_NAMES.has(attacker.name as string);
    if (destroyedTarget && removedThreatValue >= getBattleCardValue(attacker)) {
      delta -= wallLoss ? 0.8 : 0.3;
    } else {
      delta -= wallLoss ? 3 : 1.5;
    }
  }
  if (target && !destroyedTarget && !lethalNow) {
    delta -= damageTaken > 0 || positiveDamage <= 0 ? 1.3 : 0.6;
  }

  const botAfter = (simState?.bot || {}) as Partial<SimulatedPlayerState>;
  const opponentAfter = (opponent ||
    simState?.player || {}) as Partial<SimulatedPlayerState>;
  const exposedToLethal =
    Number(botAfter.lp || 0) > 0 &&
    getVisibleAttackTotal(opponentAfter) >= Number(botAfter.lp || 0);
  if (exposedToLethal && !lethalNow && !destroyedTarget && lpGain < 1000) {
    delta -= 2.5;
  }

  return clampBattleScore(delta, -5, 8);
}

function prepareLuminarchAction(
  action: AIPlannedAction | null | undefined,
): PreparedLuminarchAction | null | undefined {
  if (!action) return action;
  const prepared: PreparedLuminarchAction = { ...action };
  if (
    prepared.type === "spell" &&
    prepared.cardName === "Polymerization" &&
    !prepared.fusionTargetHint
  ) {
    prepared.fusionTargetHint = prepared.fusionTarget || null;
  }
  return prepared;
}

export function simulateLuminarchMainPhaseAction(
  state: LuminarchState,
  action: AIPlannedAction,
  options: LuminarchSimulationOptions = {},
  planningOptions?: ReturnType<typeof buildLuminarchSimulationOptions>,
): LuminarchState {
  const preparedAction = prepareLuminarchAction(action);
  // Preserve the legacy planner no-op for `simulatedBattle` without making it
  // part of the generic dispatcher's public executable union.
  const simulationOptions = planningOptions || buildLuminarchSimulationOptions(state, preparedAction, options);
  applyGenericSimulatedMainPhaseAction(
    state,
    preparedAction as AIAction,
    simulationOptions,
  );
  simulationOptions.finalizeLpPayments();
  return state;
}

export function buildLuminarchSimulationOptions(
  state: LuminarchState,
  action: AIPlannedAction | null | undefined,
  options: LuminarchSimulationOptions = {},
) {
  const preparedAction = prepareLuminarchAction(action);
  const pendingPayments: LuminarchPaymentReceipt[] = [];
  const finalizeLpPayments = (card?: SimulatedCardState, effect?: EffectDefinition) => {
    for (let index = 0; index < pendingPayments.length;) {
      const receipt = pendingPayments[index]!;
      if (card && (receipt.sourceCard !== card || receipt.effect !== effect)) { index++; continue; }
      pendingPayments.splice(index, 1);
      observeLuminarchLpPayment(receipt);
    }
  };
  return {
      finalizeLpPayments,
      archetype: "Luminarch",
      preferDefense: true,
      selfId: "bot",
      guardLabel: "LuminarchStrategy.simulateMainPhaseAction",
      ...options,
      enableSimulatedEvents: true,
      onAfterSpecialSummon: handleLuminarchAfterSpecialSummon,
      onLpPayment: (fact: LuminarchPaymentFact) => {
        if (fact.sourceCard && fact.player === fact.state.bot) {
          const payment = recordLuminarchLpPayment(fact.state, { cardName: fact.sourceCard.name || "",
            cost: fact.amount, beforeLp: fact.before, afterLp: fact.after });
          pendingPayments.push({ ...fact, fieldBefore: new Set(fact.player.field), payment });
        }
        options.onLpPayment?.(fact);
      },
      onEffectActivated: (payload: Parameters<typeof handleLuminarchEffectActivated>[0]) => {
        handleLuminarchEffectActivated(payload);
      },
      onSimulatedResolutionComplete: () => { finalizeLpPayments(); },
      onFusionSummon: handleLuminarchFusionSummon,
      getFieldEffectTargetPreference: getLuminarchFieldEffectTargetPreference,
      chooseSpecialSummonPosition: (
        card: SimulatedCardState,
        context: LuminarchPositionContext,
      ) =>
        chooseLuminarchSpecialSummonPosition(card, {
          state,
          game: context?.game || state,
          action: context?.action,
          sourceAction: preparedAction as LuminarchAction,
          options,
          activationContext: context?.activationContext,
        }),
      actionOverrides: {
        ...(options.actionOverrides || {}),
        special_summon_sanctum_protector: handleSanctumProtectorShortcut,
      },
    };
}

export function simulateLuminarchSpellEffect(
  state: LuminarchState,
  card: SimulatedCardState,
  options: LuminarchSimulationOptions = {},
): void {
  const simulationOptions = buildLuminarchSimulationOptions(state, null, options);
  simulateGenericSpellEffect(state, card, simulationOptions);
  simulationOptions.finalizeLpPayments();
}

type LuminarchBattleReadCard = Pick<import("../../contracts/aiState.js").SimulatedCardShape,"name"|"archetype"|"archetypes"|"cardKind"|"atk"|"def"|"level"|"position"|"isFacedown"|"tempAtkBoost"|"tempDefBoost"|"equipAtkBonus"|"equipDefBonus"|"piercing"|"piercingDamageMultiplier"|"piercingGrantedByEffect"|"effectsNegated"|"mustBeAttacked"|"instanceId">;
interface LuminarchBattleReadPlayer {field?: LuminarchBattleReadCard[];lp?:number}
interface LuminarchBattleReadState {bot?:LuminarchBattleReadPlayer|null;player?:LuminarchBattleReadPlayer|null;_simLuminarch?:{battleEvents?:Array<{tag?:string}>}}
interface LuminarchBattleReadSummary {rewardNames?:unknown[];damage?:number;lpGains?:Array<{amount?:number}>}
