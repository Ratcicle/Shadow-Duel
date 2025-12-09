export default class BaseStrategy {
  constructor(bot) {
    this.bot = bot;
  }

  // Evaluate board state from the bot's perspective
  evaluateBoard(_gameOrState, _perspectivePlayer) {
    return 0;
  }

  // Generate candidate main-phase actions
  generateMainPhaseActions(_game) {
    return [];
  }

  // Order actions (optional)
  sequenceActions(actions) {
    return actions;
  }

  // Simulate a main-phase action on a cloned state
  simulateMainPhaseAction(state, action) {
    return state;
  }

  // Hook to simulate a specific spell effect inside the cloned state
  simulateSpellEffect(_state, _card) {}

  // Tribute requirement helper (can be overridden)
  getTributeRequirementFor(card, playerState) {
    let tributesNeeded = 0;
    if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
    else if (card.level >= 7) tributesNeeded = 2;
    return { tributesNeeded, usingAlt: false, alt: null };
  }

  // Pick tribute indices from field
  selectBestTributes(_field, _tributesNeeded, _cardToSummon) {
    return [];
  }
}
