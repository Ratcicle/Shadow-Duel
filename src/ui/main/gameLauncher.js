export function createGameLauncher({ Game, Renderer }) {
  let game = null;

  function createRenderer() {
    return new Renderer();
  }

  function startNormalDuel({
    botPreset,
    deck,
    extraDeck,
    playerArchetype,
  }) {
    const renderer = createRenderer();
    game = new Game({
      botPreset,
      botArchetype: botPreset,
      devMode: false,
      normalDuelStrategicReport: true,
      playerArchetype,
      renderer,
    });
    game.start([...deck], [...extraDeck]);
    return game;
  }

  async function startLaboratoryDuel({
    useBot,
    botPreset,
    revealBotHand,
    laboratoryMode,
    setup,
    duelDecks,
  }) {
    const renderer = createRenderer();
    game = new Game({
      laboratoryMode: true,
      laboratoryUseBot: useBot,
      laboratoryRevealBotHand: revealBotHand,
      devMode: false,
      playerName: "Jogador 1",
      opponentName: "Jogador 2",
      botPreset,
      renderer,
    });

    if (laboratoryMode === "duel") {
      await game.startWithDecks({
        ...duelDecks,
        useBot,
        revealBotHand,
        laboratoryMode: true,
        exactDecks: true,
        startAtDrawPhase: true,
      });
      return game;
    }

    await game.startLaboratory(setup, { useBot, revealBotHand });
    return game;
  }

  return {
    getActiveGame: () => game,
    startLaboratoryDuel,
    startNormalDuel,
  };
}
