export function createGameLauncher({ Game, Renderer }) {
  let game = null;

  function createRenderer() {
    return new Renderer();
  }

  function disposeActiveGame(reason) {
    game?.dispose?.(reason);
    game = null;
  }

  function startNormalDuel({
    botPreset,
    deck,
    extraDeck,
    playerArchetype,
  }) {
    disposeActiveGame("start_normal_duel");
    const renderer = createRenderer();
    game = new Game({
      botPreset,
      botArchetype: botPreset,
      devMode: false,
      normalDuelStrategicReport: true,
      captureReplay: true,
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
    disposeActiveGame("start_laboratory_duel");
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
    disposeActiveGame,
    startLaboratoryDuel,
    startNormalDuel,
  };
}
