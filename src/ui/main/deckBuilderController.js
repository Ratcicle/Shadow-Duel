import { cardDatabase, cardDatabaseById } from "../../data/cards.js";
import {
  formatCardKindSubtypeLine,
  formatCardPreviewDescriptionHtml,
  formatMonsterDetailHtml,
  formatMonsterStatsLine,
  getMonsterTypeDisplayName,
  getUIText,
} from "../../core/i18n.js";
import { publicAssetUrl } from "../../core/publicUrl.js";
import {
  MAX_DECK_SIZE,
  MAX_EXTRA_DECK_SIZE,
  MIN_DECK_SIZE,
  cardHasArchetype,
  cardHasArchetypeName,
  inferDeckArchetype,
  isExtraDeckMonster,
  loadBotPreset,
  saveBotPreset,
  sortDeck,
  sortExtraDeck,
} from "./deckState.js";

const CATEGORY_FILTERS = [
  { id: "all", labelKey: "categoryAll" },
  { id: "monsters", labelKey: "categoryMonsters" },
  { id: "spells", labelKey: "categorySpells" },
  { id: "traps", labelKey: "categoryTraps" },
  { id: "extra", labelKey: "categoryExtra" },
  { id: "fusion", labelKey: "categoryFusion" },
  { id: "synchro", labelKey: "categorySynchro" },
  { id: "ascension", labelKey: "categoryAscension" },
];

const VIEW_MODES = [
  { id: "grid", labelKey: "viewGrid" },
  { id: "list", labelKey: "viewList" },
];

const SORT_MODES = [
  { id: "default", labelKey: "sortDefault" },
  { id: "type", labelKey: "sortType" },
  { id: "level", labelKey: "sortLevel" },
  { id: "name", labelKey: "sortName" },
  { id: "kind", labelKey: "sortKind" },
];

const COLLECTION_KIND_ORDER = { monster: 0, spell: 1, trap: 2 };
const COLLECTION_MONSTER_GROUP_ORDER = {
  ascension: 0,
  synchro: 1,
  fusion: 2,
  main: 3,
};
const COLLECTION_SPELL_SUBTYPE_ORDER = {
  normal: 0,
  quick: 1,
  equip: 2,
  continuous: 3,
  field: 4,
};
const COLLECTION_TRAP_SUBTYPE_ORDER = {
  normal: 0,
  continuous: 1,
  counter: 2,
};
const EXTREME_DRAGONS_ARCHETYPE = "Extreme Dragons";
const EXTREME_DRAGONS_FILTER_ID = `archetype:${EXTREME_DRAGONS_ARCHETYPE}`;
const LEGACY_DRAGON_EXTREME_FILTER_ID = "family:dragon_extreme";

const SUBTYPE_DISPLAY_LABELS = {
  normal: "subtypeNormal",
  quick: "subtypeQuick",
  equip: "subtypeEquip",
  continuous: "subtypeContinuous",
  field: "subtypeField",
  counter: "subtypeCounter",
};

function deckText(key, params = {}, fallback = null) {
  return getUIText(`ui.deckBuilder.${key}`, params, fallback);
}

const isExtraDeckCard = isExtraDeckMonster;

function localizeOption(option) {
  if (!option) return option;
  return {
    ...option,
    label: option.labelKey
      ? deckText(option.labelKey, {}, option.label || option.id)
      : option.label,
  };
}

function localizeOptions(options) {
  return options.map(localizeOption);
}

function getCardArchetypes(card) {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes.filter(Boolean);
  return card.archetype ? [card.archetype] : [];
}

function getCardMonsterTypes(card) {
  if (!card) return [];
  if (Array.isArray(card.types)) return card.types.filter(Boolean);
  return card.type ? [card.type] : [];
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function countCards(ids = []) {
  return ids.reduce((counts, id) => {
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

function orderedDeckEntries(ids = []) {
  const entries = [];
  const byId = new Map();
  ids.forEach((id) => {
    if (!byId.has(id)) {
      const entry = { id, count: 0 };
      byId.set(id, entry);
      entries.push(entry);
    }
    byId.get(id).count += 1;
  });
  return entries
    .map((entry) => ({ ...entry, card: cardDatabaseById.get(entry.id) }))
    .filter((entry) => entry.card);
}

function formatPoolCount(total) {
  return `${total} ${
    total === 1
      ? deckText("cardSingular", {}, "card")
      : deckText("cardPlural", {}, "cards")
  }`;
}

function getOptionLabel(options, id) {
  return options.find((option) => option.id === id)?.label || "";
}

function cardName(card) {
  return card?.name || "";
}

function cardTypeLabel(card) {
  if (!card) return "";
  if (card.cardKind === "monster") {
    return card.type || card.monsterType || card.cardKind || "";
  }
  return card.subtype || card.cardKind || "";
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function compareLevel(a, b) {
  const levelA = Number.isFinite(a?.level) ? a.level : 99;
  const levelB = Number.isFinite(b?.level) ? b.level : 99;
  if (levelA !== levelB) return levelA - levelB;
  return compareText(cardName(a), cardName(b));
}

function cardKindOrder(card) {
  const kind = String(card?.cardKind || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(COLLECTION_KIND_ORDER, kind)
    ? COLLECTION_KIND_ORDER[kind]
    : 99;
}

function monsterGroupOrder(card) {
  const group =
    card?.monsterType === "ascension"
      ? "ascension"
      : card?.monsterType === "synchro"
        ? "synchro"
        : card?.monsterType === "fusion"
          ? "fusion"
          : "main";
  return COLLECTION_MONSTER_GROUP_ORDER[group];
}

function subtypeOrder(card, orderMap) {
  const subtype = String(card?.subtype || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(orderMap, subtype)
    ? orderMap[subtype]
    : 99;
}

function numericCardValue(card, prop, fallback = 0) {
  return Number.isFinite(card?.[prop]) ? card[prop] : fallback;
}

function compareCollectionMonsters(a, b) {
  const groupDiff = monsterGroupOrder(a) - monsterGroupOrder(b);
  if (groupDiff !== 0) return groupDiff;
  const levelDiff = numericCardValue(b, "level", -1) - numericCardValue(a, "level", -1);
  if (levelDiff !== 0) return levelDiff;
  const atkDiff = numericCardValue(b, "atk") - numericCardValue(a, "atk");
  if (atkDiff !== 0) return atkDiff;
  const defDiff = numericCardValue(b, "def") - numericCardValue(a, "def");
  if (defDiff !== 0) return defDiff;
  return compareText(cardName(a), cardName(b));
}

function compareCollectionCards(a, b) {
  const kindDiff = cardKindOrder(a) - cardKindOrder(b);
  if (kindDiff !== 0) return kindDiff;
  if (a?.cardKind === "monster" && b?.cardKind === "monster") {
    return compareCollectionMonsters(a, b);
  }
  if (a?.cardKind === "spell" && b?.cardKind === "spell") {
    const subtypeDiff =
      subtypeOrder(a, COLLECTION_SPELL_SUBTYPE_ORDER) -
      subtypeOrder(b, COLLECTION_SPELL_SUBTYPE_ORDER);
    if (subtypeDiff !== 0) return subtypeDiff;
  }
  if (a?.cardKind === "trap" && b?.cardKind === "trap") {
    const subtypeDiff =
      subtypeOrder(a, COLLECTION_TRAP_SUBTYPE_ORDER) -
      subtypeOrder(b, COLLECTION_TRAP_SUBTYPE_ORDER);
    if (subtypeDiff !== 0) return subtypeDiff;
  }
  return compareText(cardName(a), cardName(b));
}

export function createDeckBuilderController({
  dom,
  deckState,
  Bot,
  getCardDisplayDescription,
  getCardDisplayName,
}) {
  let categoryFilterMode = "all";
  let typeSubtypeFilterMode = "all";
  let archetypeFilterMode = "all";
  let deckViewMode = "grid";
  let sortMode = "default";
  let searchQuery = "";
  let currentBotPreset = loadBotPreset(Bot.getAvailablePresets());
  let startDeckDom = null;
  let editingDeckSlot = null;
  let deckNameBeforeEdit = "";
  let deckSaveFeedbackTimeout = null;

  function getBotPresetLabel(presetId) {
    const preset =
      Bot.getAvailablePresets().find((item) => item.id === presetId) || null;
    return preset ? preset.label : "Shadow-Heart";
  }

  function updateBotPresetStatus() {
    if (dom.botPresetSelect && dom.botPresetSelect.value !== currentBotPreset) {
      dom.botPresetSelect.value = currentBotPreset;
    }
    if (dom.botPresetStatus) {
      dom.botPresetStatus.textContent = deckText(
        "botStatus",
        { label: getBotPresetLabel(currentBotPreset) },
        `Bot: ${getBotPresetLabel(currentBotPreset)}`,
      );
    }
  }

  function closeStartDeckMenu() {
    if (!startDeckDom?.deckMenu) return;
    startDeckDom.deckMenu.classList.add("hidden");
    startDeckDom.deckMenuButton?.setAttribute("aria-expanded", "false");
  }

  function renderStartDeckMenu() {
    if (!startDeckDom?.deckMenu) return;
    const activeDeckSlot = deckState.getActiveDeckSlot();
    startDeckDom.deckMenu.innerHTML = "";
    deckState.getDeckPresets().forEach((preset, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "start-deck-menu-item";
      item.setAttribute("role", "menuitemradio");
      item.textContent = preset?.name || `Deck ${index + 1}`;
      item.classList.toggle("active", index === activeDeckSlot);
      item.setAttribute("aria-checked", String(index === activeDeckSlot));
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        if (index !== deckState.getActiveDeckSlot()) {
          deckState.switchDeckSlot(index);
          render();
        }
        updateStartDeckDisplay();
        closeStartDeckMenu();
      });
      startDeckDom.deckMenu.appendChild(item);
    });
  }

  function updateStartDeckDisplay() {
    if (!startDeckDom) return;
    renderStartDeckMenu();
  }

  function toggleStartDeckMenu() {
    if (!startDeckDom?.deckMenu) return;
    renderStartDeckMenu();
    const willOpen = startDeckDom.deckMenu.classList.contains("hidden");
    startDeckDom.deckMenu.classList.toggle("hidden", !willOpen);
    startDeckDom.deckMenuButton?.setAttribute(
      "aria-expanded",
      String(willOpen),
    );
  }

  function populateBotPresetDropdown() {
    if (!dom.botPresetSelect) return;
    dom.botPresetSelect.innerHTML = "";
    Bot.getAvailablePresets().forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      dom.botPresetSelect.appendChild(option);
    });
    updateBotPresetStatus();
  }

  function setPreview(card) {
    if (!card) return;
    if (dom.preview.image) {
      dom.preview.image.style.backgroundImage = `url('${publicAssetUrl(card.image)}')`;
      setPreviewCardFrameClass(dom.preview.image, card);
    }
    if (dom.preview.name) {
      dom.preview.name.textContent = getCardDisplayName(card) || card.name;
    }
    const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";
    const monsterStats = isMonster ? formatMonsterStatsLine(card) : null;
    if (dom.preview.atk) {
      dom.preview.atk.textContent = isMonster ? monsterStats.atk : "";
    }
    if (dom.preview.def) {
      dom.preview.def.textContent = isMonster ? monsterStats.def : "";
    }
    if (dom.preview.level) {
      if (isMonster) {
        dom.preview.level.innerHTML = formatMonsterDetailHtml(card);
      } else {
        dom.preview.level.textContent = formatCardKindSubtypeLine(card);
      }
    }
    if (dom.preview.desc) {
      dom.preview.desc.innerHTML = formatCardPreviewDescriptionHtml(
        card,
        deckText("noDescription", {}, "No description."),
      );
    }
  }

  function getAvailableArchetypes() {
    const archetypes = new Set();
    cardDatabase.forEach((card) => {
      getCardArchetypes(card).forEach((name) => archetypes.add(name));
    });
    return [...archetypes].sort((a, b) => a.localeCompare(b));
  }

  function getSubtypeDisplayLabel(subtype) {
    const key = SUBTYPE_DISPLAY_LABELS[subtype];
    return key
      ? deckText(key, {}, subtype)
      : subtype || deckText("subtypeNone", {}, "No subtype");
  }

  function getMonsterTypeOptionLabel(type) {
    return getMonsterTypeDisplayName({ type }) || type;
  }

  function createSubtypeOptions(cards, cardKind, labelPrefix = "") {
    const orderMap =
      cardKind === "spell"
        ? COLLECTION_SPELL_SUBTYPE_ORDER
        : COLLECTION_TRAP_SUBTYPE_ORDER;
    const subtypes = [
      ...new Set(
        cards
          .filter((card) => card?.cardKind === cardKind)
          .map((card) => card.subtype)
          .filter(Boolean),
      ),
    ];
    return subtypes
      .sort(
        (a, b) =>
          subtypeOrder({ subtype: a }, orderMap) -
            subtypeOrder({ subtype: b }, orderMap) || a.localeCompare(b),
      )
      .map((subtype) => ({
        id: `${cardKind}-subtype:${subtype}`,
        label: `${labelPrefix}${getSubtypeDisplayLabel(subtype)}`,
      }));
  }

  function getTypeSubtypeOptions() {
    const cardsInCategory = cardDatabase.filter(cardMatchesMode);
    const options = [{ id: "all", label: deckText("all", {}, "All") }];
    const includeMonsters = cardsInCategory.some(
      (card) => card?.cardKind === "monster",
    );
    const includeSpells = cardsInCategory.some(
      (card) => card?.cardKind === "spell",
    );
    const includeTraps = cardsInCategory.some(
      (card) => card?.cardKind === "trap",
    );
    const needsPrefix =
      [includeMonsters, includeSpells, includeTraps].filter(Boolean).length > 1;

    if (includeMonsters) {
      const monsterTypes = [
        ...new Set(
          cardsInCategory
            .filter((card) => card?.cardKind === "monster")
            .flatMap(getCardMonsterTypes)
            .filter(Boolean),
        ),
      ].sort((a, b) =>
        getMonsterTypeOptionLabel(a).localeCompare(getMonsterTypeOptionLabel(b)),
      );
      monsterTypes.forEach((type) => {
        options.push({
          id: `monster-type:${type}`,
          label: `${
            needsPrefix ? deckText("monsterPrefix", {}, "Monster: ") : ""
          }${getMonsterTypeOptionLabel(type)}`,
        });
      });
    }

    if (includeSpells) {
      options.push(
        ...createSubtypeOptions(
          cardsInCategory,
          "spell",
          needsPrefix ? deckText("spellPrefix", {}, "Spell: ") : "",
        ),
      );
    }

    if (includeTraps) {
      options.push(
        ...createSubtypeOptions(
          cardsInCategory,
          "trap",
          needsPrefix ? deckText("trapPrefix", {}, "Trap: ") : "",
        ),
      );
    }

    return options;
  }

  function ensureTypeSubtypeFilterOption(options) {
    if (!options.some((option) => option.id === typeSubtypeFilterMode)) {
      typeSubtypeFilterMode = "all";
    }
  }

  function normalizeArchetypeFilterMode(filterMode) {
    if (filterMode === LEGACY_DRAGON_EXTREME_FILTER_ID) {
      return EXTREME_DRAGONS_FILTER_ID;
    }
    return filterMode || "all";
  }

  function isExtremeDragonsCard(card) {
    return cardHasArchetypeName(card, EXTREME_DRAGONS_ARCHETYPE);
  }

  function getArchetypeOptions() {
    const options = [
      { id: "all", label: deckText("all", {}, "All") },
      {
        id: "no_archetype",
        label: deckText("noArchetype", {}, "No archetype"),
      },
    ];
    if (cardDatabase.some(isExtremeDragonsCard)) {
      options.push({
        id: EXTREME_DRAGONS_FILTER_ID,
        label: EXTREME_DRAGONS_ARCHETYPE,
      });
    }
    getAvailableArchetypes()
      .filter((archetype) => archetype !== EXTREME_DRAGONS_ARCHETYPE)
      .forEach((archetype) => {
        options.push({ id: `archetype:${archetype}`, label: archetype });
      });
    return options.sort((a, b) => {
      if (a.id === "all") return -1;
      if (b.id === "all") return 1;
      if (a.id === "no_archetype") return -1;
      if (b.id === "no_archetype") return 1;
      return a.label.localeCompare(b.label);
    });
  }

  function setSelectOptions(select, options, value) {
    if (!select) return;
    const signature = options
      .map((option) => `${option.id}:${option.label}`)
      .join("|");
    if (select.dataset.optionsSignature !== signature) {
      select.innerHTML = "";
      options.forEach((optionData) => {
        const option = document.createElement("option");
        option.value = optionData.id;
        option.textContent = optionData.label;
        select.appendChild(option);
      });
      select.dataset.optionsSignature = signature;
    }
    select.value = value;
  }

  function renderFilterControls() {
    archetypeFilterMode = normalizeArchetypeFilterMode(archetypeFilterMode);
    const categoryOptions = localizeOptions(CATEGORY_FILTERS);
    const viewModeOptions = localizeOptions(VIEW_MODES);
    const sortModeOptions = localizeOptions(SORT_MODES);
    setSelectOptions(
      dom.categoryFilterSelect,
      categoryOptions,
      categoryFilterMode,
    );
    const typeSubtypeOptions = getTypeSubtypeOptions();
    ensureTypeSubtypeFilterOption(typeSubtypeOptions);
    setSelectOptions(
      dom.typeSubtypeFilterSelect,
      typeSubtypeOptions,
      typeSubtypeFilterMode,
    );
    setSelectOptions(
      dom.archetypeFilterSelect,
      getArchetypeOptions(),
      archetypeFilterMode,
    );
    setSelectOptions(dom.viewModeSelect, viewModeOptions, deckViewMode);
    setSelectOptions(dom.sortModeSelect, sortModeOptions, sortMode);
    renderActiveFilterChips();
  }

  function createFilterChip(label, onClear) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "deck-filter-chip";
    chip.textContent = `${label} ×`;
    chip.addEventListener("click", onClear);
    return chip;
  }

  function renderActiveFilterChips() {
    if (!dom.activeFilters) return;
    dom.activeFilters.innerHTML = "";
    const chips = [];
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery) {
      chips.push(
        createFilterChip(
          deckText(
            "searchChip",
            { query: normalizedQuery },
            `Search: ${normalizedQuery}`,
          ),
          () => {
            searchQuery = "";
            if (dom.searchInput) dom.searchInput.value = "";
            render();
          },
        ),
      );
    }
    if (categoryFilterMode !== "all") {
      chips.push(
        createFilterChip(
          getOptionLabel(localizeOptions(CATEGORY_FILTERS), categoryFilterMode),
          () => {
            categoryFilterMode = "all";
            typeSubtypeFilterMode = "all";
            render();
          },
        ),
      );
    }
    if (typeSubtypeFilterMode !== "all") {
      chips.push(
        createFilterChip(
          getOptionLabel(getTypeSubtypeOptions(), typeSubtypeFilterMode),
          () => {
            typeSubtypeFilterMode = "all";
            render();
          },
        ),
      );
    }
    if (archetypeFilterMode !== "all") {
      chips.push(
        createFilterChip(
          getOptionLabel(getArchetypeOptions(), archetypeFilterMode),
          () => {
            archetypeFilterMode = "all";
            render();
          },
        ),
      );
    }
    dom.activeFilters.classList.toggle("hidden", chips.length === 0);
    if (chips.length) {
      const label = document.createElement("span");
      label.className = "deck-active-filters-label";
      label.textContent = deckText("filters", {}, "Filters:");
      dom.activeFilters.append(label, ...chips);
    }
  }

  function renderDeckSlotControls() {
    const deckPresets = deckState.getDeckPresets();
    const activeDeckSlot = deckState.getActiveDeckSlot();
    if (editingDeckSlot !== null && editingDeckSlot !== activeDeckSlot) {
      editingDeckSlot = null;
      deckNameBeforeEdit = "";
    }

    if (dom.slotTabs) {
      dom.slotTabs.innerHTML = "";
      deckPresets.forEach((preset, index) => {
        const name = preset?.name || `Deck ${index + 1}`;
        const isActive = index === activeDeckSlot;
        const isEditing = editingDeckSlot === index;
        const shell = document.createElement("div");
        shell.className = "deck-slot-tab-shell";
        shell.classList.toggle("active", isActive);
        shell.classList.toggle("editing", isEditing);

        if (isEditing) {
          const input = document.createElement("input");
          input.className = "deck-slot-tab-input";
          input.type = "text";
          input.maxLength = 24;
          input.value = name;
          input.setAttribute(
            "aria-label",
            deckText("editDeckName", {}, "Edit deck name"),
          );
          input.addEventListener("input", () => {
            deckState.renameActiveDeckSlot(input.value);
          });
          input.addEventListener("blur", () => {
            finishDeckNameEditing({ shouldSave: true, shouldRender: true });
          });
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishDeckNameEditing({ shouldSave: true, shouldRender: true });
            }
            if (event.key === "Escape") {
              event.preventDefault();
              deckState.renameActiveDeckSlot(deckNameBeforeEdit);
              finishDeckNameEditing({ shouldSave: false, shouldRender: true });
            }
          });
          shell.appendChild(input);
          dom.slotTabs.appendChild(shell);
          requestAnimationFrame(() => {
            input.focus();
            input.select();
          });
          return;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "deck-slot-tab";
        button.classList.toggle("active", isActive);
        button.title = name;
        button.setAttribute(
          "aria-current",
          isActive ? "true" : "false",
        );

        const label = document.createElement("span");
        label.className = "deck-slot-tab-text";
        label.textContent = name;
        button.appendChild(label);

        button.addEventListener("click", () => {
          if (deckState.switchDeckSlot(index)) {
            finishDeckNameEditing({ shouldSave: false, shouldRender: false });
            render();
          }
        });
        shell.appendChild(button);

        if (isActive) {
          const editButton = document.createElement("button");
          editButton.type = "button";
          editButton.className = "deck-slot-tab-edit-button";
          editButton.innerHTML = "&#9998;";
          editButton.title = deckText("editDeckName", {}, "Edit deck name");
          editButton.setAttribute(
            "aria-label",
            deckText("editDeckName", {}, "Edit deck name"),
          );
          editButton.addEventListener("click", (event) => {
            event.stopPropagation();
            startDeckNameEditing();
          });
          shell.appendChild(editButton);
        }

        dom.slotTabs.appendChild(shell);
      });
    }
  }

  function startDeckNameEditing() {
    const activeDeckSlot = deckState.getActiveDeckSlot();
    deckNameBeforeEdit =
      deckState.getDeckPresets()[activeDeckSlot]?.name ||
      `Deck ${activeDeckSlot + 1}`;
    editingDeckSlot = activeDeckSlot;
    renderDeckSlotControls();
  }

  function finishDeckNameEditing({ shouldSave, shouldRender }) {
    if (editingDeckSlot === null) return;
    if (shouldSave) {
      deckState.saveActiveDeckPreset();
    }
    editingDeckSlot = null;
    deckNameBeforeEdit = "";
    if (shouldRender) {
      renderDeckSlotControls();
      updateStartDeckDisplay();
    }
  }

  function cardMatchesMode(card) {
    if (categoryFilterMode === "all") return true;
    if (categoryFilterMode === "monsters") {
      return card.cardKind === "monster" && !isExtraDeckCard(card);
    }
    if (categoryFilterMode === "spells") return card.cardKind === "spell";
    if (categoryFilterMode === "traps") return card.cardKind === "trap";
    if (categoryFilterMode === "extra") return isExtraDeckCard(card);
    if (categoryFilterMode === "fusion") return card.monsterType === "fusion";
    if (categoryFilterMode === "synchro") {
      return card.monsterType === "synchro";
    }
    if (categoryFilterMode === "ascension") {
      return card.monsterType === "ascension";
    }
    return true;
  }

  function cardMatchesArchetypeFilter(card) {
    const activeArchetypeFilterMode =
      normalizeArchetypeFilterMode(archetypeFilterMode);
    if (activeArchetypeFilterMode === "all") return true;
    if (activeArchetypeFilterMode === "no_archetype") {
      return !cardHasArchetype(card);
    }
    if (activeArchetypeFilterMode.startsWith("archetype:")) {
      return cardHasArchetypeName(
        card,
        activeArchetypeFilterMode.slice("archetype:".length),
      );
    }
    return true;
  }

  function cardMatchesTypeSubtypeFilter(card) {
    if (typeSubtypeFilterMode === "all") return true;
    if (typeSubtypeFilterMode.startsWith("monster-type:")) {
      const type = typeSubtypeFilterMode.slice("monster-type:".length);
      return getCardMonsterTypes(card).includes(type);
    }
    if (typeSubtypeFilterMode.startsWith("spell-subtype:")) {
      const subtype = typeSubtypeFilterMode.slice("spell-subtype:".length);
      return card?.cardKind === "spell" && card?.subtype === subtype;
    }
    if (typeSubtypeFilterMode.startsWith("trap-subtype:")) {
      const subtype = typeSubtypeFilterMode.slice("trap-subtype:".length);
      return card?.cardKind === "trap" && card?.subtype === subtype;
    }
    return true;
  }

  function getSearchHaystack(card) {
    const archetypes = getCardArchetypes(card).join(" ");
    const fields = [
      card.name,
      getCardDisplayName(card),
      archetypes,
      card.cardKind,
      card.monsterType,
      card.type,
      card.subtype,
      card.attribute,
      card.level ? `level ${card.level} nivel ${card.level} ${card.level}` : "",
      Number.isFinite(card.atk) ? `atk ${card.atk} ${card.atk}` : "",
      Number.isFinite(card.def) ? `def ${card.def} ${card.def}` : "",
      card.description,
      getCardDisplayDescription(card),
    ];
    return normalizeSearchText(fields.filter(Boolean).join(" "));
  }

  function cardMatchesSearch(card) {
    const query = normalizeSearchText(searchQuery);
    if (!query) return true;
    const haystack = getSearchHaystack(card);
    return query
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => haystack.includes(term));
  }

  function cardMatchesPoolFilters(card) {
    return (
      cardMatchesMode(card) &&
      cardMatchesTypeSubtypeFilter(card) &&
      cardMatchesArchetypeFilter(card) &&
      cardMatchesSearch(card)
    );
  }

  function sortIdsBy(ids, comparator) {
    return [...ids].sort((aId, bId) =>
      comparator(cardDatabaseById.get(aId), cardDatabaseById.get(bId)),
    );
  }

  function sortMainDeckForMode(deckIds, mode) {
    if (mode === "default") return [...deckIds];
    if (mode === "kind") return sortDeck(deckIds);
    if (mode === "name") {
      return sortIdsBy(deckIds, (a, b) => compareText(cardName(a), cardName(b)));
    }
    if (mode === "level") return sortIdsBy(deckIds, compareLevel);
    if (mode === "type") {
      return sortIdsBy(
        deckIds,
        (a, b) =>
          compareText(cardTypeLabel(a), cardTypeLabel(b)) ||
          compareText(cardName(a), cardName(b)),
      );
    }
    return [...deckIds];
  }

  function sortExtraDeckForMode(extraDeckIds, mode) {
    if (mode === "default") return [...extraDeckIds];
    if (mode === "kind") return sortExtraDeck(extraDeckIds);
    if (mode === "name") {
      return sortIdsBy(extraDeckIds, (a, b) => compareText(cardName(a), cardName(b)));
    }
    if (mode === "level") return sortIdsBy(extraDeckIds, compareLevel);
    if (mode === "type") {
      return sortIdsBy(
        extraDeckIds,
        (a, b) =>
          compareText(a?.monsterType || cardTypeLabel(a), b?.monsterType || cardTypeLabel(b)) ||
          compareText(cardName(a), cardName(b)),
      );
    }
    return [...extraDeckIds];
  }

  function applySortMode() {
    if (sortMode === "default") return;
    deckState.setCurrentDeck(
      sortMainDeckForMode(deckState.getCurrentDeck(), sortMode),
    );
    deckState.setCurrentExtraDeck(
      sortExtraDeckForMode(deckState.getCurrentExtraDeck(), sortMode),
    );
  }

  function addMainCard(card) {
    const currentDeck = deckState.getCurrentDeck();
    const counts = countCards(currentDeck);
    if (currentDeck.length >= MAX_DECK_SIZE) {
      alert(deckText("mainDeckLimit", { max: MAX_DECK_SIZE }));
      return false;
    }
    if ((counts[card.id] || 0) >= 3) return false;
    currentDeck.push(card.id);
    applySortMode();
    render();
    setPreview(card);
    return true;
  }

  function removeMainCardByIndex(index, card) {
    const currentDeck = deckState.getCurrentDeck();
    currentDeck.splice(index, 1);
    render();
    setPreview(card);
  }

  function removeMainCardById(cardId) {
    const currentDeck = deckState.getCurrentDeck();
    const index = currentDeck.indexOf(cardId);
    if (index < 0) return false;
    const card = cardDatabaseById.get(cardId);
    currentDeck.splice(index, 1);
    render();
    if (card) setPreview(card);
    return true;
  }

  function addExtraCard(card) {
    const currentExtraDeck = deckState.getCurrentExtraDeck();
    const counts = countCards(currentExtraDeck);
    if (currentExtraDeck.length >= MAX_EXTRA_DECK_SIZE) {
      alert(deckText("extraDeckFull", { max: MAX_EXTRA_DECK_SIZE }));
      return false;
    }
    if ((counts[card.id] || 0) >= 1) {
      alert(deckText("extraDeckCopyLimit"));
      return false;
    }
    currentExtraDeck.push(card.id);
    applySortMode();
    render();
    setPreview(card);
    return true;
  }

  function removeExtraCardByIndex(index, card) {
    const currentExtraDeck = deckState.getCurrentExtraDeck();
    currentExtraDeck.splice(index, 1);
    render();
    setPreview(card);
  }

  function removeExtraCardById(cardId) {
    const currentExtraDeck = deckState.getCurrentExtraDeck();
    const index = currentExtraDeck.indexOf(cardId);
    if (index < 0) return false;
    const card = cardDatabaseById.get(cardId);
    currentExtraDeck.splice(index, 1);
    render();
    if (card) setPreview(card);
    return true;
  }

  function createCountBadge(count, max, extraClass = "") {
    const badge = document.createElement("div");
    badge.className = `pool-count${extraClass ? ` ${extraClass}` : ""}`;
    badge.classList.toggle("limit-reached", count >= max);
    badge.textContent = `${count}/${max}`;
    return badge;
  }

  function renderDeckGrid(currentDeck, currentExtraDeck) {
    if (dom.deckGrid) {
      dom.deckGrid.innerHTML = "";
      for (let i = 0; i < MAX_DECK_SIZE; i++) {
        const slot = document.createElement("div");
        slot.className = "deck-slot";
        const cardId = currentDeck[i];
        if (cardId) {
          const cardData = cardDatabaseById.get(cardId);
          if (cardData) {
            const cardEl = createCardThumb(cardData, getCardDisplayName);
            cardEl.onmouseenter = () => setPreview(cardData);
            cardEl.onclick = () => removeMainCardByIndex(i, cardData);
            slot.appendChild(cardEl);
          }
        }
        dom.deckGrid.appendChild(slot);
      }
    }

    if (dom.extraDeckGrid) {
      dom.extraDeckGrid.innerHTML = "";
      for (let i = 0; i < MAX_EXTRA_DECK_SIZE; i++) {
        const slot = document.createElement("div");
        slot.className = "deck-slot";
        const cardId = currentExtraDeck[i];
        if (cardId) {
          const cardData = cardDatabaseById.get(cardId);
          if (cardData) {
            const cardEl = createCardThumb(cardData, getCardDisplayName);
            cardEl.onmouseenter = () => setPreview(cardData);
            cardEl.onclick = () => removeExtraCardByIndex(i, cardData);
            slot.appendChild(cardEl);
          }
        }
        dom.extraDeckGrid.appendChild(slot);
      }
    }
  }

  function createDeckListRow(entry, config) {
    const row = document.createElement("div");
    row.className = "deck-list-row";
    row.classList.toggle("limit-reached", entry.count >= config.maxCopies);

    const count = document.createElement("span");
    count.className = "deck-list-count";
    count.textContent = `${entry.count}x`;

    const name = document.createElement("button");
    name.type = "button";
    name.className = "deck-list-name";
    name.textContent = getCardDisplayName(entry.card) || entry.card.name;
    name.addEventListener("click", () => setPreview(entry.card));

    const badge = document.createElement("span");
    badge.className = "deck-list-copy-badge";
    badge.classList.toggle("limit-reached", entry.count >= config.maxCopies);
    badge.textContent = `${entry.count}/${config.maxCopies}`;

    const controls = document.createElement("div");
    controls.className = "deck-list-controls";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "-";
    removeButton.title = deckText("removeCopy", {}, "Remove copy");
    removeButton.addEventListener("click", () => config.remove(entry.id));

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.textContent = "+";
    addButton.title = deckText("addCopy", {}, "Add copy");
    addButton.disabled =
      entry.count >= config.maxCopies || config.zoneCount >= config.zoneMax;
    addButton.addEventListener("click", () => config.add(entry.card));

    controls.append(removeButton, addButton);
    row.append(count, name, badge, controls);
    return row;
  }

  function renderDeckListSection(title, entries, config) {
    const section = document.createElement("section");
    section.className = "deck-list-section";

    const header = document.createElement("div");
    header.className = "deck-list-section-header";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const total = document.createElement("span");
    total.textContent = `${config.zoneCount}/${config.zoneMax}`;
    header.append(heading, total);
    section.appendChild(header);

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "deck-list-empty";
      empty.textContent = deckText("empty", {}, "Empty");
      section.appendChild(empty);
      return section;
    }

    entries.forEach((entry) => {
      section.appendChild(createDeckListRow(entry, config));
    });
    return section;
  }

  function renderDeckList(currentDeck, currentExtraDeck) {
    if (!dom.deckList) return;
    dom.deckList.innerHTML = "";
    dom.deckList.append(
      renderDeckListSection("Main Deck", orderedDeckEntries(currentDeck), {
        add: addMainCard,
        remove: removeMainCardById,
        maxCopies: 3,
        zoneCount: currentDeck.length,
        zoneMax: MAX_DECK_SIZE,
      }),
      renderDeckListSection("Extra Deck", orderedDeckEntries(currentExtraDeck), {
        add: addExtraCard,
        remove: removeExtraCardById,
        maxCopies: 1,
        zoneCount: currentExtraDeck.length,
        zoneMax: MAX_EXTRA_DECK_SIZE,
      }),
    );
  }

  function getVisiblePools() {
    return cardDatabase
      .filter(cardMatchesPoolFilters)
      .sort(compareCollectionCards);
  }

  function renderPool(currentDeck, currentExtraDeck) {
    if (!dom.poolGrid) return { firstAvailable: null, visibleCount: 0 };
    dom.poolGrid.innerHTML = "";

    const counts = countCards(currentDeck);
    const extraCounts = countCards(currentExtraDeck);
    const sortedCards = getVisiblePools();

    sortedCards.forEach((card) => {
      const isExtra = isExtraDeckCard(card);
      const count = isExtra
        ? extraCounts[card.id] || 0
        : counts[card.id] || 0;
      const maxCopies = isExtra ? 1 : 3;
      const cardEl = createCardThumb(card, getCardDisplayName);
      if (isExtra) cardEl.classList.add("extra-deck-thumb");
      cardEl.classList.toggle("at-limit", count >= maxCopies);
      cardEl.appendChild(
        createCountBadge(
          count,
          maxCopies,
          card.monsterType === "ascension"
            ? "ascension-count"
            : card.monsterType === "synchro"
              ? "synchro-count"
              : card.monsterType === "fusion"
                ? "fusion-count"
                : "",
        ),
      );
      cardEl.onmouseenter = () => setPreview(card);
      cardEl.onclick = () => (isExtra ? addExtraCard(card) : addMainCard(card));
      dom.poolGrid.appendChild(cardEl);
    });

    return {
      firstAvailable: sortedCards[0] || null,
      visibleCount: sortedCards.length,
    };
  }

  function updateDeckCounters(currentDeck, currentExtraDeck) {
    if (dom.deckCount) {
      dom.deckCount.textContent = `${currentDeck.length}/${MAX_DECK_SIZE}`;
      dom.deckCount.classList.toggle(
        "limit-reached",
        currentDeck.length >= MAX_DECK_SIZE,
      );
    }
    if (dom.extraDeckCount) {
      dom.extraDeckCount.textContent = `${currentExtraDeck.length}/${MAX_EXTRA_DECK_SIZE}`;
      dom.extraDeckCount.classList.toggle(
        "limit-reached",
        currentExtraDeck.length >= MAX_EXTRA_DECK_SIZE,
      );
    }
  }

  function updateViewMode() {
    const showList = deckViewMode === "list";
    dom.mainDeckSection?.classList.toggle("hidden", showList);
    dom.deckGrid?.classList.toggle("hidden", showList);
    dom.extraDeckSection?.classList.toggle("hidden", showList);
    dom.deckList?.classList.toggle("hidden", !showList);
  }

  function render() {
    renderFilterControls();
    renderDeckSlotControls();

    const currentDeck = deckState.getCurrentDeck();
    const currentExtraDeck = deckState.getCurrentExtraDeck();
    updateDeckCounters(currentDeck, currentExtraDeck);
    updateViewMode();
    renderDeckGrid(currentDeck, currentExtraDeck);
    renderDeckList(currentDeck, currentExtraDeck);

    const { firstAvailable, visibleCount } = renderPool(
      currentDeck,
      currentExtraDeck,
    );
    if (dom.poolCount) {
      dom.poolCount.textContent = formatPoolCount(visibleCount);
    }
    if (firstAvailable) setPreview(firstAvailable);
  }

  function open(startScreenRoot) {
    closeStartDeckMenu();
    hideDeckSaveFeedback();
    startScreenRoot?.classList.add("hidden");
    dom.root?.classList.remove("hidden");
    render();
  }

  function close(startScreenRoot) {
    hideDeckSaveFeedback();
    finishDeckNameEditing({ shouldSave: true, shouldRender: false });
    deckState.saveActiveDeckPreset();
    dom.root?.classList.add("hidden");
    startScreenRoot?.classList.remove("hidden");
    updateStartDeckDisplay();
  }

  function showDeckSaveFeedback() {
    if (!dom.saveFeedback) return;
    dom.saveFeedback.classList.remove("hidden");
    dom.saveFeedback.classList.add("visible");
    if (deckSaveFeedbackTimeout) {
      clearTimeout(deckSaveFeedbackTimeout);
    }
    deckSaveFeedbackTimeout = setTimeout(() => {
      dom.saveFeedback?.classList.remove("visible");
      deckSaveFeedbackTimeout = setTimeout(() => {
        dom.saveFeedback?.classList.add("hidden");
        deckSaveFeedbackTimeout = null;
      }, 180);
    }, 1400);
  }

  function hideDeckSaveFeedback() {
    if (deckSaveFeedbackTimeout) {
      clearTimeout(deckSaveFeedbackTimeout);
      deckSaveFeedbackTimeout = null;
    }
    dom.saveFeedback?.classList.remove("visible");
    dom.saveFeedback?.classList.add("hidden");
  }

  function saveDeckBuilderChanges() {
    finishDeckNameEditing({ shouldSave: true, shouldRender: true });
    deckState.saveDeck(deckState.getCurrentDeck());
    deckState.saveExtraDeck(deckState.getCurrentExtraDeck());
    updateStartDeckDisplay();
    showDeckSaveFeedback();
  }

  function prepareForDuel() {
    const currentDeck = deckState.getCurrentDeck();
    const currentExtraDeck = deckState.getCurrentExtraDeck();
    if (currentDeck.length < MIN_DECK_SIZE || currentDeck.length > MAX_DECK_SIZE) {
      alert(
        deckText("deckSizeError", {
          min: MIN_DECK_SIZE,
          max: MAX_DECK_SIZE,
        }),
      );
      return null;
    }
    deckState.saveDeck(currentDeck);
    deckState.saveExtraDeck(currentExtraDeck);
    return {
      deck: [...deckState.getCurrentDeck()],
      extraDeck: [...deckState.getCurrentExtraDeck()],
      botPreset: currentBotPreset,
      playerArchetype: inferDeckArchetype(deckState.getCurrentDeck()),
    };
  }

  function bind(startScreenRoot) {
    populateBotPresetDropdown();
    dom.cancelButton?.addEventListener("click", () => close(startScreenRoot));
    dom.saveButton?.addEventListener("click", saveDeckBuilderChanges);
    dom.searchInput?.addEventListener("input", (event) => {
      searchQuery = event.target.value || "";
      render();
    });
    dom.categoryFilterSelect?.addEventListener("change", (event) => {
      categoryFilterMode = event.target.value || "all";
      typeSubtypeFilterMode = "all";
      render();
    });
    dom.typeSubtypeFilterSelect?.addEventListener("change", (event) => {
      typeSubtypeFilterMode = event.target.value || "all";
      render();
    });
    dom.archetypeFilterSelect?.addEventListener("change", (event) => {
      archetypeFilterMode = normalizeArchetypeFilterMode(event.target.value);
      render();
    });
    dom.viewModeSelect?.addEventListener("change", (event) => {
      deckViewMode = event.target.value === "list" ? "list" : "grid";
      render();
    });
    dom.sortModeSelect?.addEventListener("change", (event) => {
      sortMode = event.target.value || "default";
      applySortMode();
      render();
    });
    dom.botPresetSelect?.addEventListener("change", (event) => {
      const value = event.target.value;
      currentBotPreset = value;
      saveBotPreset(value);
      updateBotPresetStatus();
    });
  }

  function bindStartDeckPicker(startDom) {
    startDeckDom = startDom || null;
    updateStartDeckDisplay();
    startDeckDom?.deckMenuButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleStartDeckMenu();
    });
    document.addEventListener("click", (event) => {
      const menu = startDeckDom?.deckMenu;
      const button = startDeckDom?.deckMenuButton;
      if (menu?.contains(event.target) || button?.contains(event.target)) return;
      closeStartDeckMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeStartDeckMenu();
    });
  }

  return {
    bindStartDeckPicker,
    bind,
    close,
    closeStartDeckMenu,
    getCurrentBotPreset: () => currentBotPreset,
    open,
    prepareForDuel,
    render,
  };
}

export function createCardThumb(card, getCardDisplayName) {
  const el = document.createElement("div");
  const typeClass = getDeckBuilderCardTypeClass(card);
  el.className = `card-thumb ${typeClass}`;
  el.style.backgroundImage = `url('${publicAssetUrl(card.image)}')`;
  el.title = getCardDisplayName(card) || card.name;
  return el;
}

function getDeckBuilderCardTypeClass(card) {
  if (card?.monsterType === "fusion") return "card-thumb-fusion";
  if (card?.monsterType === "synchro") return "card-thumb-synchro";
  if (card?.monsterType === "ascension") return "card-thumb-ascension";
  if (card?.cardKind === "spell") return "card-thumb-spell";
  if (card?.cardKind === "trap") return "card-thumb-trap";
  if (card?.cardKind === "monster") return "card-thumb-monster";
  return "card-thumb-generic";
}

const PREVIEW_CARD_FRAME_CLASSES = [
  "preview-card-monster",
  "preview-card-fusion",
  "preview-card-synchro",
  "preview-card-ascension",
  "preview-card-spell",
  "preview-card-trap",
];

function getPreviewCardFrameClass(card) {
  if (card?.cardKind === "spell") return "preview-card-spell";
  if (card?.cardKind === "trap") return "preview-card-trap";
  if (card?.monsterType === "fusion") return "preview-card-fusion";
  if (card?.monsterType === "synchro") return "preview-card-synchro";
  if (card?.monsterType === "ascension") return "preview-card-ascension";
  return "preview-card-monster";
}

function setPreviewCardFrameClass(element, card) {
  if (!element) return;
  element.classList.remove(...PREVIEW_CARD_FRAME_CLASSES);
  element.classList.add(getPreviewCardFrameClass(card));
}
