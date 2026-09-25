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
import { createPlanningCopy } from "../ai/common/planningCopy.js";

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

export function cloneBotGameState(
  bot: SimulationBotPort,
  game: BotCloneGamePort,
): BotPerspectiveGameState {
  const copy = createPlanningCopy();
  const clonePlayer = (p: CloneablePlayerInput): SimulatedPlayerState => {
    return {
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
  };
  const opponent = bot.resolveOpponent(game) || game.player;

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
  copy.copyFields(game, state, ["temporaryControlEffects", "_simTemporaryControlCounter"]);
  return state;
}
