import type {
  AIPlannedAction,
  StrategyRuntimePort,
} from "../contracts/ai.js";
import type {
  AiLiveGamePort,
  AiPlayerInput,
  BotPerspectiveGameState,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
} from "../contracts/aiState.js";

interface SimulationBotPort extends SimulatedPlayerState {
  strategy: Pick<
    StrategyRuntimePort,
    "simulateMainPhaseAction" | "simulateSpellEffect"
  >;
  resolveOpponent(game: AiLiveGamePort): SimulatedPlayerState | null;
}

type CloneablePlayerInput = AiPlayerInput & {
  hand: NonNullable<AiPlayerInput["hand"]>;
  field: NonNullable<AiPlayerInput["field"]>;
  graveyard: NonNullable<AiPlayerInput["graveyard"]>;
};

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
  return bot.strategy.simulateSpellEffect?.(state, card);
}

export function cloneBotGameState(
  bot: SimulationBotPort,
  game: AiLiveGamePort,
): BotPerspectiveGameState {
  const clonePlayer = (p: AiPlayerInput): SimulatedPlayerState => {
    // Live Player instances always own these three core zones. Keep the
    // permissive input port for legacy fixtures without adding runtime defaults.
    const cloneablePlayer = p as CloneablePlayerInput;
    return {
      id: p.id,
      lp: p.lp,
      hand: cloneablePlayer.hand.map((c) => ({ ...c })),
      field: cloneablePlayer.field.map((c) => ({ ...c })),
      graveyard: cloneablePlayer.graveyard.map((c) => ({ ...c })),
      deck: p.deck ? p.deck.map((c) => ({ ...c })) : [],
      extraDeck: p.extraDeck ? p.extraDeck.map((c) => ({ ...c })) : [],
      banished: p.banished ? p.banished.map((c) => ({ ...c })) : [],
      fieldSpell: p.fieldSpell ? { ...p.fieldSpell } : null,
      spellTrap: p.spellTrap ? p.spellTrap.map((c) => ({ ...c })) : [],
      summonCount: p.summonCount || 0,
      additionalNormalSummons: p.additionalNormalSummons || 0,
      controllerType: p.controllerType,
    } as SimulatedPlayerState;
  };
  const opponent = bot.resolveOpponent(game) || game.player;

  return {
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
}
