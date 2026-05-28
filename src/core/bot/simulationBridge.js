export function simulateBotMainPhaseAction(bot, state, action) {
  return bot.strategy.simulateMainPhaseAction(state, action);
}

export function simulateBotSpellEffect(bot, state, card) {
  return bot.strategy.simulateSpellEffect(state, card);
}

export function cloneBotGameState(bot, game) {
  const clonePlayer = (p) => {
    return {
      id: p.id,
      lp: p.lp,
      hand: p.hand.map((c) => ({ ...c })),
      field: p.field.map((c) => ({ ...c })),
      graveyard: p.graveyard.map((c) => ({ ...c })),
      deck: p.deck ? p.deck.map((c) => ({ ...c })) : [],
      extraDeck: p.extraDeck ? p.extraDeck.map((c) => ({ ...c })) : [],
      banished: p.banished ? p.banished.map((c) => ({ ...c })) : [],
      fieldSpell: p.fieldSpell ? { ...p.fieldSpell } : null,
      spellTrap: p.spellTrap ? p.spellTrap.map((c) => ({ ...c })) : [],
      summonCount: p.summonCount || 0,
      additionalNormalSummons: p.additionalNormalSummons || 0,
      controllerType: p.controllerType,
    };
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
  };
}
