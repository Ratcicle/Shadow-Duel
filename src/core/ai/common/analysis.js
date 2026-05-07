export function buildStrategyAnalysis({ bot, opponent, game } = {}) {
  return {
    hand: bot?.hand || [],
    field: bot?.field || [],
    spellTrap: bot?.spellTrap || [],
    fieldSpell: bot?.fieldSpell || null,
    graveyard: bot?.graveyard || [],
    deck: bot?.deck || [],
    extraDeck: bot?.extraDeck || [],
    lp: bot?.lp || 8000,
    oppField: opponent?.field || [],
    oppLp: opponent?.lp || 8000,
    currentTurn: game?.turnCounter || 1,
    player: bot,
    game,
  };
}
