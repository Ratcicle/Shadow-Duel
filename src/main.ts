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
import { createPlacementPreference, bindPlacementPreference } from "./ui/main/placementPreference.js";
import { installPreviewPanelLayout } from "./ui/main/previewPanelLayout.js";
import { createValidationPanel } from "./ui/main/validationPanel.js";

initializeLocale();

const dom = getMainDom();
const previewPanelLayout = installPreviewPanelLayout(
  document.getElementById("sidebar"),
  getUIText("ui.duel.previewDragHandle"),
);
if (import.meta.hot) import.meta.hot.dispose(() => previewPanelLayout?.dispose());
const deckState = createDeckState();
const validationPanel = createValidationPanel({
  messagesEl: dom.validation.messages,
  validateCardDatabase,
});
const placementPreference = createPlacementPreference();
const gameLauncher = createGameLauncher({ Game, Renderer, getFieldPlacementMode: placementPreference.getMode });

function uiText(
  key: string,
  params: Readonly<Record<string, unknown>> = {},
  fallback: string | null = null,
) {
  return getUIText(`ui.${key}`, params, fallback);
}

function setText(el: Element | null | undefined, value: string) {
  if (el && typeof value === "string") {
    el.textContent = value;
  }
}

function setLabelForControl(control: HTMLElement | null, value: string) {
  const label = control?.closest?.("label");
  if (!label) return;
  const textNode = Array.from(label.childNodes).find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim(),
  );
  if (textNode) {
    textNode.textContent = value;
  }
}

function applyStaticLocalization() {
  bindPlacementPreference(dom.startScreen.placementSelect, dom.startScreen.placementLabel, placementPreference);
  setText(dom.startScreen.startDuelButton, uiText("start.startDuel"));
  setText(dom.startScreen.deckBuilderButton, uiText("start.myDeck"));
  setText(dom.startScreen.botArenaButton, uiText("start.botArena"));
  setText(dom.startScreen.laboratoryButton, uiText("start.laboratory"));
  setText(dom.laboratory.backToLaboratoryButton, uiText("laboratory.back"));
  setText(dom.laboratory.restartDuelButton, uiText("laboratory.restart"));
  dom.laboratory.duelControls?.setAttribute(
    "aria-label",
    uiText("laboratory.duelControls"),
  );
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
  setText(
    deckRoot?.querySelector(".deck-title-area h2"),
    uiText("deckBuilder.title"),
  );
  deckRoot
    ?.querySelector(".deck-toolbar")
    ?.setAttribute("aria-label", uiText("deckBuilder.toolbarLabel"));
  if (dom.deckBuilder.searchInput) {
    dom.deckBuilder.searchInput.placeholder = uiText(
      "deckBuilder.searchPlaceholder",
    );
  }
  setLabelForControl(
    dom.deckBuilder.categoryFilterSelect,
    uiText("deckBuilder.category"),
  );
  setLabelForControl(
    dom.deckBuilder.typeSubtypeFilterSelect,
    uiText("deckBuilder.typeSubtype"),
  );
  setLabelForControl(
    dom.deckBuilder.archetypeFilterSelect,
    uiText("deckBuilder.archetype"),
  );
  setLabelForControl(
    dom.deckBuilder.viewModeSelect,
    uiText("deckBuilder.view"),
  );
  setLabelForControl(
    dom.deckBuilder.sortModeSelect,
    uiText("deckBuilder.sort"),
  );
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
  previewPanelLayout?.cancelInteraction();
  if (!validationPanel.run()) {
    return;
  }

  const config = deckBuilder.prepareForDuel();
  if (!config) {
    return;
  }

  dom.startScreen.root?.classList.add("hidden");
  dom.deckBuilder.root?.classList.add("hidden");
  if (dom.laboratory.duelControls) dom.laboratory.duelControls.hidden = true;
  gameLauncher.startNormalDuel(config);
}

let laboratoryTransitionInProgress = false;

async function launchLaboratoryDuel(restart = false) {
  if (laboratoryTransitionInProgress) return;
  previewPanelLayout?.cancelInteraction();
  laboratoryTransitionInProgress = true;
  const buttons = [
    dom.laboratory.startButton,
    dom.laboratory.backToLaboratoryButton,
    dom.laboratory.restartDuelButton,
  ];
  for (const button of buttons) if (button) button.disabled = true;
  laboratory.hideForDuel(dom.deckBuilder.root);
  try {
    if (restart) {
      await gameLauncher.restartLaboratoryDuel();
    } else {
      await gameLauncher.startLaboratoryDuel(laboratory.getStartConfig());
    }
  } catch (error) {
    gameLauncher.disposeActiveGame("laboratory_start_failed");
    laboratory.open();
    console.error("[Laboratory] Could not start duel:", error);
    alert(uiText("laboratory.startError"));
  } finally {
    laboratoryTransitionInProgress = false;
    for (const button of buttons) if (button) button.disabled = false;
    if (dom.laboratory.duelControls) {
      dom.laboratory.duelControls.hidden =
        gameLauncher.getActiveGame()?.laboratoryModeEnabled !== true;
    }
  }
}

async function startLaboratoryDuel() {
  if (!validationPanel.run()) {
    return;
  }

  await launchLaboratoryDuel();
}

function returnToLaboratory() {
  if (
    laboratoryTransitionInProgress ||
    gameLauncher.getActiveGame()?.laboratoryModeEnabled !== true
  ) return;
  previewPanelLayout?.cancelInteraction();
  gameLauncher.disposeActiveGame("return_to_laboratory");
  if (dom.laboratory.duelControls) dom.laboratory.duelControls.hidden = true;
  laboratory.open();
}

async function rematch() {
  previewPanelLayout?.cancelInteraction();
  if (!validationPanel.run({ silent: true })) {
    alert("Corrija os erros do Card DB antes de reiniciar o duelo.");
    return;
  }

  const wasLaboratoryDuel =
    gameLauncher.getActiveGame()?.laboratoryModeEnabled === true;

  if (wasLaboratoryDuel) {
    await launchLaboratoryDuel(true);
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
  dom.laboratory.backToLaboratoryButton?.addEventListener(
    "click",
    returnToLaboratory,
  );
  dom.laboratory.restartDuelButton?.addEventListener("click", () => {
    if (gameLauncher.getActiveGame()?.laboratoryModeEnabled === true) void rematch();
  });
  window.addEventListener("shadow-duel-rematch", rematch);
}

function ensureDomReady(fn: () => void) {
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
