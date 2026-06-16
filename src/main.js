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
  getUIText,
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

function uiText(key, params = {}, fallback = null) {
  return getUIText(`ui.${key}`, params, fallback);
}

function setText(el, value) {
  if (el && typeof value === "string") {
    el.textContent = value;
  }
}

function setLabelForControl(control, value) {
  const label = control?.closest?.("label");
  if (!label) return;
  const textNode = Array.from(label.childNodes).find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
  );
  if (textNode) {
    textNode.textContent = value;
  }
}

function applyStaticLocalization() {
  setText(dom.startScreen.startDuelButton, uiText("start.startDuel"));
  setText(dom.startScreen.deckBuilderButton, uiText("start.myDeck"));
  setText(dom.startScreen.botArenaButton, uiText("start.botArena"));
  setText(dom.startScreen.laboratoryButton, uiText("start.laboratory"));
  const deckMenuLabel = uiText("start.changeActiveDeck");
  dom.startScreen.deckMenuButton?.setAttribute("aria-label", deckMenuLabel);
  dom.startScreen.deckMenuButton?.setAttribute("title", deckMenuLabel);
  dom.startScreen.deckMenu?.setAttribute(
    "aria-label",
    uiText("start.savedDecks"),
  );
  setText(
    document.querySelector(".bot-preset-control label"),
    uiText("start.opponent"),
  );

  const deckRoot = dom.deckBuilder.root;
  setText(deckRoot?.querySelector(".deck-title-area h2"), uiText("deckBuilder.title"));
  deckRoot
    ?.querySelector(".deck-toolbar")
    ?.setAttribute("aria-label", uiText("deckBuilder.toolbarLabel"));
  if (dom.deckBuilder.searchInput) {
    dom.deckBuilder.searchInput.placeholder = uiText(
      "deckBuilder.searchPlaceholder",
    );
  }
  setLabelForControl(dom.deckBuilder.categoryFilterSelect, uiText("deckBuilder.category"));
  setLabelForControl(
    dom.deckBuilder.typeSubtypeFilterSelect,
    uiText("deckBuilder.typeSubtype"),
  );
  setLabelForControl(
    dom.deckBuilder.archetypeFilterSelect,
    uiText("deckBuilder.archetype"),
  );
  setLabelForControl(dom.deckBuilder.viewModeSelect, uiText("deckBuilder.view"));
  setLabelForControl(dom.deckBuilder.sortModeSelect, uiText("deckBuilder.sort"));
  dom.deckBuilder.activeFilters?.setAttribute(
    "aria-label",
    uiText("deckBuilder.activeFiltersLabel"),
  );
  setText(dom.deckBuilder.preview.name, uiText("deckBuilder.selectCard"));
  setText(
    dom.deckBuilder.preview.desc,
    uiText("deckBuilder.descriptionFallback"),
  );
  setText(dom.deckBuilder.poolCount, `0 ${uiText("deckBuilder.cardPlural")}`);
  setText(dom.deckBuilder.saveFeedback, uiText("deckBuilder.saved"));
  setText(dom.deckBuilder.saveButton, uiText("deckBuilder.save"));
  setText(dom.deckBuilder.cancelButton, uiText("deckBuilder.close"));
}

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
  deckBuilder.bindStartDeckPicker(dom.startScreen);
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
applyStaticLocalization();
bindMainEvents();

ensureDomReady(() => {
  dom.startScreen.root?.classList.remove("hidden");
});
