import type {
  AIPlannedAction,
  StrategyRuntimePort,
  AIStrategyBotPort,
} from "../contracts/ai.js";
import type {
  AiLiveGamePort,
  AiPlayerInput,
  BotPerspectiveGameState,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
  SimulatedTemporaryControlEffect,
} from "../contracts/aiState.js";
import {
  createPlanningCopy,
  projectRuntimeEffectUsage,
  projectRuntimeReplacementEffects,
  registerPublicOpponentProjection,
} from "../ai/common/planningCopy.js";
import { PLANNING_PLAYER_FIELDS, PLANNING_STATE_FIELDS } from "../ai/common/stateFingerprint.js";

interface SimulationBotPort extends AIStrategyBotPort {
  strategy: Required<Pick<
    StrategyRuntimePort,
    "simulateMainPhaseAction" | "simulateSpellEffect"
  >>;
  resolveOpponent(game: BotCloneGamePort): CloneablePlayerInput | null;
}

type CloneablePlayerInput = AiPlayerInput & {
  hand: NonNullable<AiPlayerInput["hand"]>;
  field: NonNullable<AiPlayerInput["field"]>;
  graveyard: NonNullable<AiPlayerInput["graveyard"]>;
};

export interface BotCloneGamePort extends Omit<AiLiveGamePort, "player"> {
  player: CloneablePlayerInput;
  temporaryControlEffects?: readonly SimulatedTemporaryControlEffect[];
}

export function simulateBotMainPhaseAction(
  bot: SimulationBotPort,
  state: SimulationGameState | BotPerspectiveGameState,
  action: AIPlannedAction,
) {
  return bot.strategy.simulateMainPhaseAction(state, action);
}

export function simulateBotSpellEffect(
  bot: SimulationBotPort,
  state: SimulationGameState | BotPerspectiveGameState,
  card: SimulatedCardState,
) {
  return bot.strategy.simulateSpellEffect(state, card);
}

export interface BotCloneOptions {
  /**
   * Copy the opponent through its public projection: its hidden cards (Hand,
   * Deck, Extra Deck and face-down cards) become opaque projections (the
   * battle loop's copies, phase 2.3 L12). Off by default, so the copy keeps
   * the opponent's full information; every live decision must turn it on.
   */
  publicOpponent?: boolean;
}

/**
 * The bot's copy of a game for simulation. By default it keeps the opponent's
 * full information, hidden cards included, as fixtures and simulations of a
 * known state need. A consumer deciding on the live duel passes
 * `publicOpponent: true`, as the battle loop does (phase 2.3 L12).
 */
export function cloneBotGameState(
  bot: SimulationBotPort,
  game: BotCloneGamePort,
  options: BotCloneOptions = {},
): BotPerspectiveGameState {
  const copy = createPlanningCopy();
  const clonePlayer = (p: CloneablePlayerInput): SimulatedPlayerState => {
    const player = {
      id: p.id,
      lp: p.lp,
      hand: p.hand.map(copy.cloneCardForSim),
      field: p.field.map(copy.cloneCardForSim),
      graveyard: p.graveyard.map(copy.cloneCardForSim),
      deck: p.deck ? p.deck.map(copy.cloneCardForSim) : [],
      extraDeck: p.extraDeck ? p.extraDeck.map(copy.cloneCardForSim) : [],
      banished: p.banished ? p.banished.map(copy.cloneCardForSim) : [],
      fieldSpell: p.fieldSpell ? copy.cloneCardForSim(p.fieldSpell) : null,
      spellTrap: p.spellTrap ? p.spellTrap.map(copy.cloneCardForSim) : [],
      summonCount: p.summonCount || 0,
      additionalNormalSummons: p.additionalNormalSummons || 0,
      controllerType: p.controllerType,
    } as SimulatedPlayerState;
    copy.registerPlayerCopy(p, player);
    copy.copyFields(p, player, PLANNING_PLAYER_FIELDS);
    return player;
  };
  const opponent = bot.resolveOpponent(game) || game.player;
  // Registered before either participant is copied, so links reuse the opaque projection.
  if (options.publicOpponent && opponent !== bot) registerPublicOpponentProjection(copy, opponent);

  const state = {
    player: clonePlayer(opponent),
    bot: clonePlayer(bot),
    turn: game.turn,
    phase: game.phase,
    turnCounter: game.turnCounter || 0,
    _isPerspectiveState: true,
    _gameRef: game,
    // Clone once-per-turn tracking from effectEngine if available
    usedThisTurn: game.effectEngine?.usedThisTurn
      ? new Map(game.effectEngine.usedThisTurn)
      : new Map(),
  } as BotPerspectiveGameState;
  copy.copyFields(game, state, [
    ...PLANNING_STATE_FIELDS.filter(key => key !== "_isPerspectiveState"),
    "_simUnsupportedActions",
  ]);
  projectRuntimeEffectUsage(game, state);
  projectRuntimeReplacementEffects(game, state);
  return state;
}
