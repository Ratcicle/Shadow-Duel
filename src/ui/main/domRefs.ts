export function getMainDom() {
  return {
    startScreen: {
      root: document.getElementById("start-screen"),
      startDuelButton:
        document.querySelector<HTMLButtonElement>("#btn-start-duel"),
      botArenaButton:
        document.querySelector<HTMLButtonElement>("#btn-bot-arena"),
      deckBuilderButton:
        document.querySelector<HTMLButtonElement>("#btn-deck-builder"),
      deckMenuButton: document.querySelector<HTMLButtonElement>(
        "#btn-start-deck-menu",
      ),
      deckMenu: document.getElementById("start-deck-menu"),
      laboratoryButton: document.querySelector<HTMLButtonElement>(
        "#btn-open-laboratory",
      ),
    },
    deckBuilder: {
      root: document.getElementById("deck-builder"),
      mainDeckSection: document.getElementById("main-deck-section"),
      deckGrid: document.getElementById("deck-grid"),
      deckList: document.getElementById("deck-list"),
      extraDeckSection: document.getElementById("extradeck-section"),
      extraDeckGrid: document.getElementById("extradeck-grid"),
      poolGrid: document.getElementById("pool-grid"),
      deckCount: document.getElementById("deck-count"),
      extraDeckCount: document.getElementById("extradeck-count"),
      poolCount: document.getElementById("deck-pool-count"),
      searchInput: document.querySelector<HTMLInputElement>("#deck-search"),
      categoryFilterSelect: document.querySelector<HTMLSelectElement>(
        "#deck-category-filter",
      ),
      typeSubtypeFilterSelect: document.querySelector<HTMLSelectElement>(
        "#deck-type-subtype-filter",
      ),
      archetypeFilterSelect: document.querySelector<HTMLSelectElement>(
        "#deck-archetype-filter",
      ),
      viewModeSelect:
        document.querySelector<HTMLSelectElement>("#deck-view-mode"),
      sortModeSelect:
        document.querySelector<HTMLSelectElement>("#deck-sort-mode"),
      activeFilters: document.getElementById("deck-active-filters"),
      titleArea: document.querySelector<HTMLElement>(".deck-title-area"),
      slotTabs: document.getElementById("deck-slot-tabs"),
      saveButton: document.querySelector<HTMLButtonElement>("#deck-save"),
      saveFeedback: document.getElementById("deck-save-feedback"),
      cancelButton: document.querySelector<HTMLButtonElement>("#deck-cancel"),
      botPresetSelect:
        document.querySelector<HTMLSelectElement>("#bot-preset-select"),
      botPresetStatus: document.getElementById("bot-preset-status"),
      filters: {},
      preview: {
        image: document.getElementById("deck-preview-image"),
        name: document.getElementById("deck-preview-name"),
        atk: document.getElementById("deck-preview-atk"),
        def: document.getElementById("deck-preview-def"),
        level: document.getElementById("deck-preview-level"),
        desc: document.getElementById("deck-preview-desc"),
      },
    },
    botArena: {
      modal: document.getElementById("bot-arena-modal"),
      deckSeat1Select:
        document.querySelector<HTMLSelectElement>("#arena-deck-seat1"),
      deckSeat2Select:
        document.querySelector<HTMLSelectElement>("#arena-deck-seat2"),
      numDuelsSelect:
        document.querySelector<HTMLSelectElement>("#arena-num-duels"),
      speedSelect: document.querySelector<HTMLSelectElement>("#arena-speed"),
      autoPauseCheckbox:
        document.querySelector<HTMLInputElement>("#arena-auto-pause"),
      startButton:
        document.querySelector<HTMLButtonElement>("#btn-arena-start"),
      cancelButton:
        document.querySelector<HTMLButtonElement>("#btn-arena-cancel"),
      exportStrategicButton: document.querySelector<HTMLButtonElement>(
        "#btn-arena-export-strategic",
      ),
      closeButton: document.querySelector<HTMLElement>(".close-arena"),
      completed: document.getElementById("arena-completed"),
      wins1: document.getElementById("arena-wins-1"),
      wins2: document.getElementById("arena-wins-2"),
      draws: document.getElementById("arena-draws"),
      avgTurns: document.getElementById("arena-avg-turns"),
      status: document.getElementById("arena-status"),
      log: document.getElementById("arena-log"),
    },
    laboratory: {
      modal: document.getElementById("laboratory-modal"),
      body: document.getElementById("laboratory-body"),
      closeButton:
        document.querySelector<HTMLButtonElement>("#laboratory-close"),
      archetypeSelect: document.querySelector<HTMLSelectElement>(
        "#laboratory-archetype",
      ),
      randomAllButton: document.querySelector<HTMLButtonElement>(
        "#laboratory-random-all",
      ),
      exportButton:
        document.querySelector<HTMLButtonElement>("#laboratory-export"),
      importButton:
        document.querySelector<HTMLButtonElement>("#laboratory-import"),
      importFileInput: document.querySelector<HTMLInputElement>(
        "#laboratory-import-file",
      ),
      clearButton:
        document.querySelector<HTMLButtonElement>("#laboratory-clear"),
      addOwnerSelect: document.querySelector<HTMLSelectElement>(
        "#laboratory-add-owner",
      ),
      addZoneSelect: document.querySelector<HTMLSelectElement>(
        "#laboratory-add-zone",
      ),
      cardSearchInput: document.querySelector<HTMLInputElement>(
        "#laboratory-card-search",
      ),
      cardOptions: document.getElementById("laboratory-card-options"),
      positionSelect: document.querySelector<HTMLSelectElement>(
        "#laboratory-position",
      ),
      facedownInput: document.querySelector<HTMLInputElement>(
        "#laboratory-facedown",
      ),
      addCardButton: document.querySelector<HTMLButtonElement>(
        "#laboratory-add-card-btn",
      ),
      startButton:
        document.querySelector<HTMLButtonElement>("#laboratory-start"),
      useBotInput: document.querySelector<HTMLInputElement>(
        "#laboratory-use-bot",
      ),
      botArchetypeSelect: document.querySelector<HTMLSelectElement>(
        "#laboratory-bot-archetype",
      ),
      botArchetypeWrap: document.getElementById(
        "laboratory-bot-archetype-wrap",
      ),
      revealBotHandInput: document.querySelector<HTMLInputElement>(
        "#laboratory-reveal-bot-hand",
      ),
      modeButtons: Array.from(
        document.querySelectorAll<HTMLElement>("[data-laboratory-mode]"),
      ),
    },
    validation: {
      messages: document.getElementById("validation-messages"),
    },
    locale: {
      buttons: Array.from(
        document.querySelectorAll<HTMLElement>(".lang-toggle-btn"),
      ),
    },
  };
}

export type MainDom = ReturnType<typeof getMainDom>;
