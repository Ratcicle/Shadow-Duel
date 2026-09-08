import type { AIPlannedAction } from "../../contracts/ai.js";
import type { GameCard } from "../../contracts/cards.js";
import type { SimulatedCardState } from "../../contracts/aiState.js";

type AiTimingRole = "reactive_backrow" | "pre_battle_value" | "post_battle_payoff";
interface PhaseTimingCard {
  id?: GameCard["id"] | number;
  name?: string;
  cardKind?: string;
  subtype?: string | null;
  lastAiActivatedTurn?: number | null;
}
type TimingAwareAction = AIPlannedAction & {
  timingRole?: AiTimingRole;
  card?: GameCard | SimulatedCardState | null;
  cardId?: number;
  cardName?: string;
  index?: number;
  cardKind?: GameCard["cardKind"];
  subtype?: GameCard["subtype"];
};

interface PhaseSource {
  phase?: unknown;
  turnCounter?: unknown;
  _gameRef?: { turnCounter?: unknown } | null;
  bot?: PhaseTimingPlayer | null;
  player?: PhaseTimingPlayer | null;
}

interface PhaseAnalysis {
  phase?: unknown;
  turnCounter?: unknown;
  game?: PhaseSource | null;
}

interface PostBattleHookOwner {
  isPostBattlePayoffAction?(
    action: TimingAwareAction,
    context: PhaseTimingContext,
  ): boolean;
  strategy?: PostBattleHookOwner | null;
}

interface PhaseTimingPlayer {
  hand?: readonly PhaseTimingCard[];
  field?: readonly PhaseTimingCard[];
  spellTrap?: readonly PhaseTimingCard[];
  graveyard?: readonly PhaseTimingCard[];
  deck?: readonly PhaseTimingCard[];
  extraDeck?: readonly PhaseTimingCard[];
  strategy?: object | null;
}

interface PhaseTimingContext {
  player?: PhaseTimingPlayer | null;
  bot?: PhaseTimingPlayer | null;
  state?: PhaseSource | null;
  game?: PhaseSource | null;
  hand?: readonly PhaseTimingCard[];
  strategy?: object | null;
  analysis?: PhaseAnalysis | null;
}

function normalizePhase(
  source: string | PhaseSource | null | undefined,
  analysis: PhaseAnalysis | null = null,
): string {
  if (typeof source === "string") return source.toLowerCase();
  const phase = source?.phase || analysis?.phase || analysis?.game?.phase || "";
  return String(phase || "").toLowerCase();
}

export function isMain1Phase(
  source: string | PhaseSource | null | undefined,
  analysis: PhaseAnalysis | null = null,
): boolean {
  const phase = normalizePhase(source, analysis);
  return phase === "main1" || phase === "main";
}

export function isMain2Phase(
  source: string | PhaseSource | null | undefined,
  analysis: PhaseAnalysis | null = null,
): boolean {
  const phase = normalizePhase(source, analysis);
  return phase === "main2" || phase === "main_2";
}

export function isQuickSpellCard(
  card: PhaseTimingCard | null | undefined,
): boolean {
  const subtype = String(card?.subtype || "").toLowerCase();
  return (
    card?.cardKind === "spell" &&
    (subtype === "quick" || subtype === "quick-play" || subtype === "quickplay")
  );
}

export function isReactiveBackrowCard(
  card: PhaseTimingCard | null | undefined,
): boolean {
  return card?.cardKind === "trap" || isQuickSpellCard(card);
}

function getTurnCounter(
  source: PhaseSource | null | undefined,
  analysis: PhaseAnalysis | null = null,
): number | null {
  const value =
    source?.turnCounter ??
    analysis?.turnCounter ??
    analysis?.game?.turnCounter ??
    analysis?.game?._gameRef?.turnCounter;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function canSetReactiveBackrowNow(
  card: PhaseTimingCard | null | undefined,
  gameOrState: PhaseSource | null = null,
  analysis: PhaseAnalysis | null = null,
): boolean {
  if (!isReactiveBackrowCard(card)) return false;
  if (!isMain2Phase(gameOrState, analysis)) return false;
  if (isQuickSpellCard(card)) {
    const turnCounter = getTurnCounter(gameOrState, analysis);
    if (
      turnCounter !== null &&
      Number(card!.lastAiActivatedTurn) === turnCounter
    ) {
      return false;
    }
  }
  return true;
}

export function getActionCard(
  action: TimingAwareAction | null | undefined,
  context: PhaseTimingContext = {},
): PhaseTimingCard | null {
  if (!action) return null;
  if (action.card) return action.card;
  const player =
    context.player ||
    context.bot ||
    context.state?.bot ||
    context.game?.bot ||
    context.game?.player ||
    null;
  const hand = context.hand || player?.hand || [];
  if (Number.isInteger(action.index) && Array.isArray(hand)) {
    const handCard = hand[action.index!];
    if (
      handCard &&
      (!action.cardId || handCard.id === action.cardId) &&
      (!action.cardName || handCard.name === action.cardName)
    ) {
      return handCard;
    }
  }
  const zones = [
    hand,
    player?.field,
    player?.spellTrap,
    player?.graveyard,
    player?.deck,
    player?.extraDeck,
  ];
  for (const zone of zones) {
    if (!Array.isArray(zone)) continue;
    const found = zone.find(
      (card) =>
        card &&
        ((action.cardId && card.id === action.cardId) ||
          (action.cardName && card.name === action.cardName)),
    );
    if (found) return found;
  }
  if (action.cardId || action.cardName) {
    return {
      id: action.cardId,
      name: action.cardName,
      cardKind: action.cardKind,
      subtype: action.subtype,
    };
  }
  return null;
}

export function isPostBattlePayoffAction(
  action: TimingAwareAction | null | undefined,
  context: PhaseTimingContext = {},
): boolean {
  if (!action) return false;
  if (action.timingRole === "post_battle_payoff") return true;
  const hookOwner =
    typeof (context.strategy as PostBattleHookOwner | null | undefined)
        ?.isPostBattlePayoffAction === "function"
      ? context.strategy as PostBattleHookOwner
      : typeof (context.strategy as PostBattleHookOwner | null | undefined)
            ?.strategy?.isPostBattlePayoffAction === "function"
        ? (context.strategy as PostBattleHookOwner).strategy!
        : typeof (context.bot?.strategy as PostBattleHookOwner | null | undefined)
              ?.isPostBattlePayoffAction === "function"
          ? context.bot!.strategy as PostBattleHookOwner
          : null;
  const hook = hookOwner?.isPostBattlePayoffAction;
  if (typeof hook !== "function") return false;
  try {
    return hook.call(hookOwner, action, context) === true;
  } catch {
    return false;
  }
}

export function isPreBattleValueAction(
  action: TimingAwareAction | null | undefined,
  context: PhaseTimingContext = {},
): boolean {
  if (!action || action.type === "simulatedBattle") return false;
  if (isPostBattlePayoffAction(action, context)) return false;
  if (action.type === "set_spell_trap") return false;
  if (action.timingRole === "reactive_backrow") return false;
  if (action.timingRole === "pre_battle_value") return true;

  const type = action.type;
  return (
    type === "summon" ||
    type === "special_summon_sanctum_protector" ||
    type === "extraDeckProcedure" ||
    type === "ascension" ||
    type === "spell" ||
    type === "monsterEffect" ||
    type === "handIgnition" ||
    type === "fieldEffect" ||
    type === "spellTrapEffect" ||
    type === "graveyardMonsterEffect" ||
    type === "graveyardSpellEffect" ||
    (type === "position_change" && action.toPosition !== "defense")
  );
}

export function isAllowedAiActionForCurrentPhase(
  action: TimingAwareAction | null | undefined,
  context: PhaseTimingContext = {},
): boolean {
  if (!action) return false;
  const gameOrState = context.state || context.game || {};
  const card = getActionCard(action, context);

  if (action.type === "set_spell_trap") {
    return canSetReactiveBackrowNow(
      card,
      gameOrState,
      context.analysis || null,
    );
  }

  if (isMain2Phase(gameOrState, context.analysis || null)) {
    return isPostBattlePayoffAction(action, context);
  }

  return true;
}

export function filterAiActionsForCurrentPhase<Action extends TimingAwareAction>(
  actions: readonly Action[] | null | undefined,
  context: PhaseTimingContext = {},
): Action[] {
  if (!Array.isArray(actions)) return [];
  return actions.filter((action) =>
    isAllowedAiActionForCurrentPhase(action, context),
  );
}

export function hasPreBattleValueActions(
  actions: readonly TimingAwareAction[] | null | undefined,
  context: PhaseTimingContext = {},
): boolean {
  return (actions || []).some((action) =>
    isPreBattleValueAction(action, context),
  );
}
