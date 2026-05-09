import Game from "./core/Game.js";
import Bot from "./core/Bot.js";
import BotArena from "./core/BotArena.js";
import Renderer from "./ui/Renderer.js";
import { validateCardDatabase } from "./core/CardDatabaseValidator.js";
import ShadowHeartStrategy from "./core/ai/ShadowHeartStrategy.js";
import LuminarchStrategy from "./core/ai/LuminarchStrategy.js";

import {
  initializeLocale,
  setLocale,
  getLocale,
  getCardDisplayDescription,
  getCardDisplayName,
} from "./core/i18n.js";

import { createBotArenaController } from "./ui/main/botArenaController.js";
import { createDeckBuilderController } from "./ui/main/deckBuilderController.js";
import { createDeckState } from "./ui/main/deckState.js";
import { getMainDom } from "./ui/main/domRefs.js";
import { createGameLauncher } from "./ui/main/gameLauncher.js";
import { createLaboratoryController } from "./ui/main/laboratoryController.js";
import { bindLocaleControls } from "./ui/main/localeControls.js";
import { createValidationPanel } from "./ui/main/validationPanel.js";

initializeLocale();

const dom = getMainDom();
const deckState = createDeckState();
const validationPanel = createValidationPanel({
  messagesEl: dom.validation.messages,
  validateCardDatabase,
});
const gameLauncher = createGameLauncher({ Game, Renderer });

bindLocaleControls({
  buttons: dom.locale.buttons,
  getLocale,
  setLocale,
});

const deckBuilder = createDeckBuilderController({
  dom: dom.deckBuilder,
  deckState,
  Bot,
  getCardDisplayDescription,
  getCardDisplayName,
});

const laboratory = createLaboratoryController({
  dom: dom.laboratory,
  startScreenRoot: dom.startScreen.root,
  getCardDisplayName,
});

const botArena = createBotArenaController({
  dom: dom.botArena,
  startScreenRoot: dom.startScreen.root,
  validationPanel,
  BotArena,
  Game,
  Bot,
  ShadowHeartStrategy,
  LuminarchStrategy,
});

function startDuel() {
  if (!validationPanel.run()) {
    return;
  }

  const config = deckBuilder.prepareForDuel();
  if (!config) {
    return;
  }

  dom.startScreen.root?.classList.add("hidden");
  dom.deckBuilder.root?.classList.add("hidden");
  gameLauncher.startNormalDuel(config);
}

async function startLaboratoryDuel() {
  if (!validationPanel.run()) {
    return;
  }

  const config = laboratory.getStartConfig();
  laboratory.hideForDuel(dom.deckBuilder.root);
  await gameLauncher.startLaboratoryDuel(config);
}

async function rematch() {
  if (!validationPanel.run({ silent: true })) {
    alert("Corrija os erros do Card DB antes de reiniciar o duelo.");
    return;
  }

  const wasLaboratoryDuel =
    gameLauncher.getActiveGame()?.laboratoryModeEnabled === true;

  if (wasLaboratoryDuel) {
    const config = laboratory.getStartConfig();
    laboratory.hideForDuel(dom.deckBuilder.root);
    await gameLauncher.startLaboratoryDuel(config);
    return;
  }

  const config = deckBuilder.prepareForDuel();
  if (!config) {
    return;
  }
  dom.startScreen.root?.classList.add("hidden");
  dom.deckBuilder.root?.classList.add("hidden");
  gameLauncher.startNormalDuel(config);
}

function bindMainEvents() {
  deckBuilder.bind(dom.startScreen.root);
  laboratory.bind({ onStart: startLaboratoryDuel });
  botArena.bind();

  dom.startScreen.deckBuilderButton?.addEventListener("click", () => {
    deckBuilder.open(dom.startScreen.root);
  });
  dom.startScreen.startDuelButton?.addEventListener("click", startDuel);
  dom.startScreen.botArenaButton?.addEventListener("click", botArena.open);
  dom.startScreen.laboratoryButton?.addEventListener("click", laboratory.open);
  window.addEventListener("shadow-duel-rematch", rematch);
}

function ensureDomReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

validationPanel.run({ silent: true });
bindMainEvents();

ensureDomReady(() => {
  dom.startScreen.root?.classList.remove("hidden");
});
