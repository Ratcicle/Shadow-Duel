import type { ExactStartWithDecksOptions } from "../../core/contracts/game.js";
import type GameRuntime from "../../core/Game.js";
import type RendererRuntime from "../Renderer.js";
import type { FieldPlacementMode } from "../../core/contracts/placement.js";
import { normalizeScenarioSetup } from "../../core/game/devTools/setup.js";
import { getBotPresetPresentation } from "../../core/bot/presets.js";
export interface NormalDuelConfig {
  botPreset: string;
  deck: readonly number[];
  extraDeck: readonly number[];
  playerArchetype: string;
}
export interface LaboratoryDuelConfig {
  useBot: boolean;
  botPreset: string;
  revealBotHand: boolean;
  laboratoryMode: string;
  setup: Parameters<GameRuntime["startLaboratory"]>[0];
  duelDecks: Omit<ExactStartWithDecksOptions, "exactDecks">;
}

function nameBotParticipant(game: GameRuntime) {
  if (game.bot.controllerType !== "ai") return;
  // Bot has already resolved its preset/fallback. Keep the name on the participant.
  const preset = getBotPresetPresentation(game.bot.archetype);
  if (preset) game.bot.name = `${preset.label} Bot`;
}

export function createGameLauncher({
  Game,
  Renderer,
  getFieldPlacementMode = () => "automatic",
}: {
  Game: typeof GameRuntime;
  Renderer: typeof RendererRuntime;
  getFieldPlacementMode?: () => FieldPlacementMode;
}) {
  let game: GameRuntime | null = null;
  let laboratoryConfig: LaboratoryDuelConfig | null = null;

  function createRenderer() {
    return new Renderer();
  }

  function disposeActiveGame(reason: string) {
    game?.forceClearTargetSelection(reason);
    game?.ui.toggleModal(false);
    game?.ui.toggleExtraDeckModal(false);
    game?.dispose?.(reason);
    game = null;
    laboratoryConfig = null;
  }

  function startNormalDuel({
    botPreset,
    deck,
    extraDeck,
    playerArchetype,
  }: NormalDuelConfig) {
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
      getFieldPlacementMode,
    });
    nameBotParticipant(game);
    game.start([...deck], [...extraDeck]);
    return game;
  }

  async function startLaboratoryDuel(config: LaboratoryDuelConfig) {
    const initialConfig = structuredClone(config);
    if (initialConfig.laboratoryMode !== "duel") {
      initialConfig.setup = normalizeScenarioSetup(initialConfig.setup ?? {});
    }
    disposeActiveGame("start_laboratory_duel");
    laboratoryConfig = initialConfig;
    const {
      useBot,
      botPreset,
      revealBotHand,
      laboratoryMode,
      setup,
      duelDecks,
    } = structuredClone(initialConfig);
    const renderer = createRenderer();
    const newGame = new Game({
      laboratoryMode: true,
      laboratoryUseBot: useBot,
      laboratoryRevealBotHand: revealBotHand,
      devMode: false,
      playerName: "Jogador 1",
      opponentName: "Jogador 2",
      botPreset,
      renderer,
      getFieldPlacementMode,
    });
    game = newGame;
    nameBotParticipant(newGame);

    if (laboratoryMode === "duel") {
      const startOptions = {
        ...duelDecks,
        useBot,
        revealBotHand,
        laboratoryMode: true,
        exactDecks: true,
        startAtDrawPhase: true,
      } satisfies ExactStartWithDecksOptions & { useBot: boolean };
      await newGame.startWithDecks(startOptions);
      return newGame;
    }

    await newGame.startLaboratory(setup, { useBot, revealBotHand });
    return newGame;
  }

  async function restartLaboratoryDuel() {
    if (!game?.laboratoryModeEnabled || game.isDisposed() || !laboratoryConfig) {
      return null;
    }
    return startLaboratoryDuel(laboratoryConfig);
  }

  return {
    getActiveGame: () => game,
    disposeActiveGame,
    startLaboratoryDuel,
    restartLaboratoryDuel,
    startNormalDuel,
  };
}
