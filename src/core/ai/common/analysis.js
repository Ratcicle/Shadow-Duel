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
    phase: game?.phase || "main1",
    player: bot,
    game,
  };
}

export function cardHasRelevantTriggerForSummonMethod(card, method) {
  if (!card || !method) return false;
  const normalizedMethod = String(method).toLowerCase();
  const methodAliases =
    normalizedMethod === "tribute"
      ? new Set(["tribute"])
      : new Set([normalizedMethod]);

  return (card.effects || []).some((effect) => {
    if (!effect) return false;

    if (
      effect.requireSelfWasSummonedBy &&
      methodAliases.has(String(effect.requireSelfWasSummonedBy).toLowerCase())
    ) {
      return true;
    }

    if (
      effect.timing === "on_event" &&
      effect.event === "after_summon" &&
      effect.requireSelfAsSummoned
    ) {
      const summonMethods = Array.isArray(effect.summonMethods)
        ? effect.summonMethods.map((entry) => String(entry).toLowerCase())
        : [];
      if (summonMethods.length === 0) return true;
      return summonMethods.some((entry) => methodAliases.has(entry));
    }

    return false;
  });
}
