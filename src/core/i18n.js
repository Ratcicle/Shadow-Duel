import { cardDatabase } from "../data/cards.js";
import { publicUrl } from "./publicUrl.js";

const LOCALE_STORAGE_KEY = "shadowduel_locale";
const DEFAULT_LOCALE = "en";
const SUPPORTED_LOCALES = ["en", "pt-br"];

const DEFAULT_LOCALE_TEXTS = {
  ui: {
    common: {
      ok: "OK",
      cancel: "Cancel",
      confirm: "Confirm",
      close: "x",
      yes: "Yes",
      no: "No",
      activate: "Activate",
      set: "Set",
      pass: "Pass",
      refuse: "Decline",
      addToHand: "Add to Hand",
    },
    lp: "{amount} LP",
    icons: {
      atk: "ATK",
      def: "DEF",
      graveyard: "Graveyard",
      extraDeck: "Extra Deck",
    },
    zones: {
      graveyard: "GY",
      extraDeck: "Extra",
    },
    status: {
      effectsNegated: "Effects negated",
      cannotAttack: "Cannot attack",
      equipped: "Equipped",
    },
    priority: {
      owner: "Priority: {owner}",
      you: "You",
      opponent: "Opponent",
      resolving: "Resolving Chain",
    },
    selection: {
      cardFallback: "Card",
      effectLabel: "effect",
      selectTargets: "Select target(s)",
      chooseEffect: "Choose which effect you want to activate.",
      chooseOneOption: "Choose one option.",
      chooseOptionCount: "Choose {count} options.",
      chooseOptionRange: "Choose {min}-{max} options.",
      chooseTargetCount: "Choose {count} target(s) for {label}.",
      chooseTargetRange: "Choose {min}-{max} targets for {label}.",
      selectTargetCount: "Select {count} target(s) for {label}.",
      selectTargetRange: "Select {min}-{max} targets for {label}.",
      selectCardToDestroy: "Select a card to destroy.",
      noValidOptions: "No valid options to activate this effect.",
      noValidChoice: "No valid effect choice selected.",
      noValidTargets: "No valid targets.",
    },
    declaration: {
      chooseValue: "Declare 1 {propertyLabel}.",
      declaredValue: "{cardName} declared {valueLabel}.",
      typeLabel: "monster Type",
    },
    fieldTargeting: {
      monsterEffect: "monster effect",
      spellEffect: "spell effect",
      continuousSpellEffect: "continuous spell effect",
      fieldSpellEffect: "field spell effect",
      spellTrapEffect: "Spell/Trap effect",
      trapEffect: "trap effect",
      graveyardEffect: "graveyard effect",
      graveyardSpellEffect: "graveyard spell effect",
      triggeredEffect: "triggered effect",
      effect: "effect",
      targetSingular: "target",
      targetPlural: "targets",
      sourceEffect: "{sourceName}'s {effectLabel}",
      targetCount: "Select {count} {targetWord} for {sourceClause}.",
      targetRange: "Select {min}-{max} targets for {sourceClause}.",
      targetUpTo: "Select up to {max} {targetWord} for {sourceClause}.",
      targetGeneric: "Select targets for {sourceClause}.",
    },
    summon: {
      normal: "Normal Summon",
      special: "Special Summon",
      specialAction: "Special Summon",
      set: "Set",
      conditionalConfirm: "Summon",
      conditionalDecline: "Decline",
      chooseTier: "Choose Tier",
      tierFallback: "Tier {count}",
      activateEffect: "Activate",
      ascend: "Ascend",
      flip: "Flip Summon",
      toAttack: "To Attack",
      toDefense: "To Defense",
      attack: "Attack",
      defense: "Defense",
      choosePosition: "Choose the position for \"{cardName}\".",
      choosePositionTitle: "Choose Special Summon position",
      conditionMet: "Condition met.",
      controlsCard: "You control \"{cardName}\".",
      conditionalPrompt:
        "{conditionText} Special Summon \"{cardName}\" from your hand?",
      drawnPrompt:
        "You drew \"{cardName}\". Special Summon it from your hand?",
    },
    spell: {
      activate: "Activate",
      set: "Set",
      continuousSelection: "Select target(s) for the continuous spell effect.",
      fieldSelection: "Select target(s) for the field spell effect.",
      spellSelection: "Select target(s) for the spell effect.",
      spellTrapSelection: "Select target(s) for the spell/trap effect.",
      noFusionMaterials: "You do not have valid materials for a Fusion Summon!",
    },
    trap: {
      activateTitle: "Activate Trap?",
      activate: "Activate Trap",
      activateShort: "Activate",
      doNotActivate: "Do not activate",
      pass: "Pass",
      passNoResponse: "Pass (No Response)",
      responseDefault: "Respond to the action.",
      attackDeclaration: "{attacker} declared an attack on {target}.",
      directAttack: "direct attack",
      monsterFallback: "Monster",
      cardFallback: "Card",
      summon: "{card} was summoned.",
      cardActivation: "{card} was activated.",
      phaseChange: "Phase changed.",
      effectActivation: "Effect activated.",
      responseEvent: "Respond to {event}.",
    },
    fusion: {
      selectMonsterTitle: "Select Fusion Monster",
      selectMonsterHint: "Choose a Fusion Monster to summon:",
      selectMonsterLabel: "Choose a Fusion Monster to summon",
      selectMonsterMessage: "Select a Fusion Monster to summon",
      selectMaterialsTitle: "Select Fusion Materials",
      selectMaterialsHint: "Select materials:",
      selectMaterialsLabel: "Select {count} Fusion Materials",
      selectMaterialsFor: "Select materials for {cardName}",
      monsterFallback: "monster",
      invalidMaterials: "Invalid fusion materials!",
      noValidSummons: "No valid Fusion Summons available!",
      noValidMaterials: "No valid materials for this fusion!",
      notFound: "Fusion monster not found in Extra Deck!",
    },
    cardGrid: {
      selectCards: "Select Cards",
      chooseSurvivor: "Choose Survivor",
    },
    ignition: {
      titleFallback: "Activate effect?",
      prompt: "Activate this monster's effect?",
    },
    prompts: {
      confirmTitle: "Confirm",
      searchPlaceholder: "Choose a card",
      searchTitle: "Select a card from candidates",
      searchHint: "Click on a card to select it",
      destructionNegationTitle: "Activate {cardName}'s effect?",
      costLine: "Cost: {costDescription}",
      triggeredAttackTrap: "Activate {cardName} in response to the attack?",
      triggeredAttackEffect: "Activate {cardName}'s effect?",
      triggeredTargeted: "Activate {cardName} in response to targeting?",
      triggeredEffect: "Activate {cardName}'s effect?",
      thisCard: "this card",
    },
    graveyard: {
      selection: "Select target(s) for the graveyard effect.",
    },
    optionalSummon: {
      prompt: "Special Summon {cardName} from your hand?",
      confirm: "Special Summon",
      cancel: "Keep in hand",
      title: "Optional Special Summon",
    },
    optionalEffects: {
      burningRewardSummon: "Special Summon the added monster?",
    },
    upkeep: {
      prompt: "Pay {amount} LP to maintain {cardName}?",
      confirm: "Pay {amount} LP",
      cancel: "Send to GY",
      title: "Maintenance Cost",
      thisCard: "this card",
    },
    triggers: {
      selection: "Select target(s) for the triggered effect.",
      mandatoryTitle: "Order mandatory Trigger Effects",
      optionalTitle: "Choose optional Trigger Effects",
      optionalConfirmTitle: "Activate Trigger Effect?",
      activateSingle: "Activate",
      declineSingle: "Do not activate",
      mandatoryOrder: "Click a card to move its effect to the end of the order.",
      optionalOrder: "Select the effects to activate in the desired order.",
      notSelected: "Off",
      declineAll: "Activate none",
      confirmOrder: "Confirm order",
    },
    counters: {
      labels: {
        spore: "Spore Counters",
      },
      added: "Added {amount} {counterLabel} to {cardName}.",
      removed: "Removed {amount} {counterLabel} from {cardName}.",
      noneFound: "No {counterLabel} found on the field.",
      counted: "{amount} {counterLabel} counted on the field.",
      healByCount:
        "{playerName} gained {healAmount} LP ({counterCount} {counterLabel} x {amountPerCounter} LP).",
      removeAmount:
        "Choose how many {counterLabel} to remove ({min}-{max}).",
      selectPayment:
        "Select card(s) to remove {amount} {counterLabel}.",
      selectEnough:
        "Select enough cards to remove {amount} {counterLabel}.",
      paymentCancelled: "Counter payment cancelled.",
      notEnough:
        "Not enough {counterLabel} on the field to pay the cost.",
    },
    replacement: {
      cardSingular: "card",
      cardPlural: "cards",
      monsterSingular: "monster",
      monsterPlural: "monsters",
      spellSingular: "Spell",
      spellPlural: "Spells",
      trapSingular: "Trap",
      trapPlural: "Traps",
      chooseToBanish: "Choose {countText} to banish.",
      confirmCost: "{verb} {count} {costDescription} {suffix} {cardName}?",
      confirmActionCost:
        "{sourceName}: pay the replacement cost to prevent {cardName} from being destroyed?",
      chooseCost:
        "Choose {count} {cardWord} to {selectionVerb} for {cardName}'s protection.",
      protectionCancelled: "Protection cancelled.",
      actions: {
        banish: {
          verb: "Banish",
          suffix: "to save",
          selectionVerb: "banish",
          logVerb: "banishing",
          logDestination: "",
        },
        hand: {
          verb: "Return",
          suffix: "to the hand to save",
          selectionVerb: "return to the hand",
          logVerb: "returning",
          logDestination: " to the hand",
        },
        graveyard: {
          verb: "Send",
          suffix: "to the GY to save",
          selectionVerb: "send to the Graveyard",
          logVerb: "sending",
          logDestination: " to the Graveyard",
        },
      },
    },
    tieredCost: {
      costPrompt: "Choose how many cost cards to send (1-{max}):",
      selectCost: "Select the cost cards to send to the Graveyard.",
    },
    shadowHeartCathedral: {
      title: "Shadow-Heart Cathedral",
      subtitle:
        "Select 1 Shadow-Heart monster with ATK <= {maxAtk} ({counterCount} counters)",
      info: "Only Shadow-Heart monsters in your Deck are valid.",
      level: "Level",
    },
    luminarchSickle: {
      title: "Select up to 2 \"Luminarch\" monsters to add to hand",
      subtitle: "Select up to {maxSelect}.",
    },
    start: {
      startDuel: "Duel",
      myDeck: "My Deck",
      changeActiveDeck: "Change active deck",
      savedDecks: "Saved decks",
      opponent: "Opponent:",
      botArena: "Bot Arena",
      laboratory: "Laboratory",
    },
    deckBuilder: {
      title: "My Deck",
      toolbarLabel: "Deck builder tools",
      searchPlaceholder: "Search card...",
      category: "Category",
      typeSubtype: "Type/Subtype",
      archetype: "Archetype",
      view: "View",
      sort: "Sort",
      activeFiltersLabel: "Active filters",
      filters: "Filters:",
      searchChip: "Search: {query}",
      all: "All",
      none: "None",
      noArchetype: "No archetype",
      categoryAll: "All",
      categoryMonsters: "Monsters",
      categorySpells: "Spells",
      categoryTraps: "Traps",
      categoryExtra: "Extra Deck",
      categoryFusion: "Fusion",
      categorySynchro: "Synchro",
      categoryAscension: "Ascension",
      viewGrid: "Grid",
      viewList: "List",
      sortDefault: "Default",
      sortType: "By type",
      sortLevel: "By level",
      sortName: "By name",
      sortKind: "Monsters -> Spells -> Traps",
      monsterPrefix: "Monster: ",
      spellPrefix: "Spell: ",
      trapPrefix: "Trap: ",
      subtypeNormal: "Normal",
      subtypeQuick: "Quick-Play",
      subtypeEquip: "Equip",
      subtypeContinuous: "Continuous",
      subtypeField: "Field",
      subtypeCounter: "Counter",
      subtypeNone: "No subtype",
      selectCard: "Select a card",
      descriptionFallback: "Description will appear here.",
      noDescription: "No description.",
      cardSingular: "card",
      cardPlural: "cards",
      saved: "Deck saved",
      save: "Save",
      close: "Close",
      editDeckName: "Edit deck name",
      addCopy: "Add copy",
      removeCopy: "Remove copy",
      empty: "Empty",
      mainDeckLimit: "Limit of {max} cards reached.",
      extraDeckFull: "Extra Deck is full (max {max}).",
      extraDeckCopyLimit: "Only 1 copy of each Extra Deck monster per id.",
      deckSizeError: "The deck must have between {min} and {max} cards.",
      botStatus: "Bot: {label}",
    },
  },
  effects: {
    hyperion: { attackBoost: "ATK boost", defenseBoost: "DEF boost" },
    arctroth: {
      attackRemoval: "Remove boosts while attacking",
      defenseRemoval: "Remove boosts while defending",
    },
    leviathan: {
      burnAttacker: "Damage the attacker",
      burnDestroyed: "Damage after destruction",
    },
    radiantLancer: {
      attackBoost: "Gain ATK",
      destroySpellTrap: "Destroy a Spell/Trap",
    },
    volcanicExtreme: {
      burnAttacker: "Battle damage as attacker",
      burnDefender: "Battle damage as defender",
    },
    stelya: { summon: "Special Summon a Dragon", search: "Search a Dragon" },
    inkRiver: {
      normalSpell: "Counter a Normal Spell",
      fieldSpell: "Counter a Field Spell effect",
    },
    rotStag: {
      attackBoost: "Attacking boost",
      defenseBoost: "Defending boost",
    },
    butcher: {
      searchMonster: "Search a monster",
      followupSearch: "Follow-up search",
    },
    ghostSamurai: {
      attackBoost: "Boost while attacking",
      defenseBoost: "Boost while defending",
    },
    voidAberration: {
      graveBuff: "Void sent to the GY",
      fieldDestroy: "Sent from the field",
    },
  },
  effectChoices: {
    arcanist_grand_library_ignition: {
      message: "Choose an Arcanist Grand Library effect.",
      cases: {
        arcanist_grand_library_summon: {
          label: "Pay 2000 LP; Special Summon Arcanist",
          description:
            "No monsters: pay 2000 LP and Special Summon 1 Level 4 or lower Arcanist from your Deck.",
        },
        arcanist_grand_library_search_equip: {
          label: "Add an Arcanist Equip Spell",
          description:
            "With an Arcanist monster: add 1 Arcanist Equip Spell from your Deck to your hand.",
        },
      },
    },
    meeting_arcanists_choose_effect: {
      message: "Choose a Meeting of the Arcanists effect.",
      cases: {
        meeting_arcanists_discard_monsters: {
          label: "Discard 2 Arcanist monsters",
          description:
            "Discard 2 Arcanist monsters; add 1 Arcanist Spell from your Deck to your hand.",
        },
        meeting_arcanists_discard_spells: {
          label: "Discard 2 Arcanist Spells",
          description:
            "Discard 2 Arcanist Spells; add 1 Level 4 or lower Arcanist monster from your Deck to your hand.",
        },
      },
    },
    miragebound_oasis_ignition: {
      message: "Choose a Miragebound Oasis effect.",
      cases: {
        miragebound_oasis_recycle_search: {
          label: "Return Miragebound; add another",
          description:
            "Return 1 Miragebound monster you control; add a different Miragebound monster from your Deck to your hand.",
        },
        miragebound_oasis_shift_weaken: {
          label: "Change an opponent monster's position",
          description: "Target 1 opponent monster; change its battle position.",
        },
      },
    },
    burning_west_wanted_reward: {
      message: 'Choose a "Wanted in the Burning West" reward.',
      cases: {
        burning_west_wanted_summon: {
          label: "Special Summon Burning West",
          description:
            'Special Summon 1 Level 5 or lower "Burning West" monster from your hand.',
        },
        burning_west_wanted_buff: {
          label: "Gain 800 ATK",
          description:
            'Target 1 "Burning West" monster you control; it gains 800 ATK until the end of the next turn.',
        },
        burning_west_wanted_recover: {
          label: "Recover Burning West Spell/Trap",
          description:
            'Add 1 "Burning West" Spell/Trap from your Graveyard to your hand.',
        },
      },
    },
  },
};

const ATTRIBUTE_LABELS = {
  en: {
    Light: "Light",
    Dark: "Dark",
    Fire: "Fire",
    Water: "Water",
    Earth: "Earth",
    Wind: "Wind",
  },
  "pt-br": {
    Light: "Luz",
    Dark: "Trevas",
    Fire: "Fogo",
    Water: "Água",
    Earth: "Terra",
    Wind: "Vento",
  },
};

const MONSTER_TYPE_LABELS = {
  en: {},
  "pt-br": {
    Beast: "Besta",
    Dragon: "Dragão",
    Fairy: "Fada",
    Fiend: "Demônio",
    Insect: "Inseto",
    Reptile: "Réptil",
    "Sea Serpent": "Serpente Marinha",
    Pyro: "Piro",
    Spellcaster: "Mago",
    Spirit: "Espírito",
    Warrior: "Guerreiro",
    "Winged Beast": "Besta Alada",
    Machine: "Máquina",
  },
};

const TUNER_LABELS = {
  en: "Tuner",
  "pt-br": "Regulador",
};

const CARD_KIND_LABELS = {
  en: {
    spell: "Spell",
    trap: "Trap",
  },
  "pt-br": {
    spell: "Magia",
    trap: "Armadilha",
  },
};

const SUBTYPE_LABELS = {
  en: {
    normal: "Normal",
    continuous: "Continuous",
    field: "Field",
    equip: "Equip",
    quick: "Quick-Play",
    counter: "Counter",
  },
  "pt-br": {
    normal: "Normal",
    continuous: "Contínua",
    field: "Campo",
    equip: "Equipamento",
    quick: "Rápida",
    counter: "Resposta",
  },
};

const CARD_KIND_SUBTYPE_PHRASES = {
  en: {
    spell: {
      normal: "Normal Spell",
      continuous: "Continuous Spell",
      field: "Field Spell",
      equip: "Equip Spell",
      quick: "Quick-Play Spell",
    },
    trap: {
      normal: "Normal Trap",
      continuous: "Continuous Trap",
      counter: "Counter Trap",
    },
  },
  "pt-br": {
    spell: {
      normal: "Magia Normal",
      continuous: "Magia Contínua",
      field: "Magia de Campo",
      equip: "Magia de Equipamento",
      quick: "Magia Rápida",
    },
    trap: {
      normal: "Armadilha Normal",
      continuous: "Armadilha Contínua",
      counter: "Armadilha de Resposta",
    },
  },
};

const LOCALE_SOURCES = {
  // English text is the canonical card data in cards.js.
  "pt-br": "locales/pt-br.json",
};

function getLocaleUrl(localePath) {
  if (typeof window !== "undefined") {
    return new URL(publicUrl(localePath), window.location.origin);
  }
  return new URL(`../../public/${localePath.replace(/^\/+/, "")}`, import.meta.url);
}

async function loadLocalePayload(publicPath) {
  try {
    const url = getLocaleUrl(publicPath);
    // Browser/runtime with fetch over HTTP(S)
    if (typeof fetch === "function" && url.protocol !== "file:") {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[i18n] Failed to load locale file ${publicPath}`);
        return {};
      }
      return await response.json();
    }
    // Node or file:// fallback
    const nodeFsPromises = "node:fs/promises";
    const { readFile } = await import(nodeFsPromises);
    const fileData = await readFile(url);
    return JSON.parse(fileData.toString());
  } catch (err) {
    console.error(`[i18n] Error loading locale file ${publicPath}:`, err);
    return {};
  }
}

async function loadAllLocales() {
  const entries = await Promise.all(
    Object.entries(LOCALE_SOURCES).map(async ([locale, path]) => {
      const payload = await loadLocalePayload(path);
      return [locale, payload];
    })
  );
  return Object.fromEntries(entries);
}

const rawLocales = await loadAllLocales();

const normalizedLocales = Object.fromEntries(
  Object.entries(rawLocales).map(([locale, payload]) => [
    locale,
    normalizeLocalePayload(payload),
  ])
);

let currentLocale = DEFAULT_LOCALE;
let lastCoverageLogLocale = null;

function normalizeLocalePayload(payload) {
  const cards = {};
  const ui = {};
  const effectChoices = {};
  if (!isObject(payload)) {
    return { cards, ui, effectChoices };
  }

  const sections = [];
  if (isObject(payload.cards)) {
    sections.push(payload.cards);
  }
  if (isObject(payload.cardTranslations)) {
    if (isObject(payload.cardTranslations.cards)) {
      sections.push(payload.cardTranslations.cards);
    } else {
      sections.push(payload.cardTranslations);
    }
  }
  if (isObject(payload.translations)) {
    if (isObject(payload.translations.cards)) {
      sections.push(payload.translations.cards);
    } else {
      sections.push(payload.translations);
    }
  }

  sections.forEach((section) => {
    Object.entries(section).forEach(([rawKey, rawValue]) => {
      const idKey = String(rawKey || "").trim();
      if (!idKey) return;
      cards[idKey] = cards[idKey] || {};
      if (typeof rawValue === "string") {
        cards[idKey].name = rawValue.trim();
      } else if (isObject(rawValue)) {
        if (typeof rawValue.name === "string") {
          cards[idKey].name = rawValue.name.trim();
        }
        if (typeof rawValue.description === "string") {
          cards[idKey].description = rawValue.description.trim();
        }
      }
    });
  });

  if (isObject(payload.ui)) {
    Object.assign(ui, payload.ui);
  }
  if (isObject(payload.effectChoices)) {
    Object.assign(effectChoices, payload.effectChoices);
  }

  return { cards, ui, effectChoices };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStoredLocale() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch (err) {
    console.warn("Unable to read stored locale", err);
    return null;
  }
}

function persistLocale(locale) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch (err) {
    console.warn("Unable to persist locale", err);
  }
}

function ensureSupportedLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale) ? locale : null;
}

function logCoverageIfNeeded(locale) {
  if (locale !== "pt-br") return;
  if (lastCoverageLogLocale === locale) return;
  lastCoverageLogLocale = locale;
  const ptCards = normalizedLocales["pt-br"].cards || {};
  const totalCount = cardDatabase.length;
  let translatedCount = 0;
  let extraCount = 0;

  const dbIds = new Set(cardDatabase.map((card) => String(card?.id)));

  for (const cardId of Object.keys(ptCards)) {
    if (!dbIds.has(cardId)) extraCount += 1;
  }

  for (const card of cardDatabase) {
    const idKey = String(card?.id);
    const entry = ptCards[idKey];
    if (!entry) continue;
    if (typeof entry.name === "string" || typeof entry.description === "string")
      translatedCount += 1;
  }

  console.info(
    `[i18n] pt-br translations: ${translatedCount}/${totalCount} cards (${
      totalCount - translatedCount
    } missing, ${extraCount} extra).`
  );
}

export function initializeLocale() {
  const stored = ensureSupportedLocale(readStoredLocale());
  currentLocale = stored || DEFAULT_LOCALE;
  logCoverageIfNeeded(currentLocale);
  return currentLocale;
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  const normalized = ensureSupportedLocale(locale);
  if (!normalized) return currentLocale;
  currentLocale = normalized;
  persistLocale(normalized);
  logCoverageIfNeeded(normalized);
  return currentLocale;
}

export function getCardDisplayName(card) {
  return getCardDisplayProperty(card, "name");
}

export function getCardDisplayDescription(card) {
  return getCardDisplayProperty(card, "description");
}

function findFirstSentenceBreak(text) {
  const match = String(text || "").match(/^([\s\S]*?\.)\s+(\S[\s\S]*)$/u);
  if (!match) return -1;
  return match[1].length;
}

function findMaterialLineBreak(text) {
  const normalized = String(text || "");
  const newlineIndex = normalized.search(/\n+\s*\S/u);
  if (newlineIndex > 0) return newlineIndex;

  const effectStartPattern =
    /\s+(Requirement:|Requisito:|If\s+|Se\s+|This card\b|Este card\b|You can\b|Voc[eê]\s+pode\b|Once per turn\b|Uma vez por turno\b|While\s+|Enquanto\s+|Your opponent\b|Seu oponente\b|Todo\s+|Must be\b|Deve ser\b|When\s+|Quando\s+|During\s+|Durante\s+)/iu;
  const effectStartMatch = normalized.match(effectStartPattern);
  if (effectStartMatch?.index > 0) return effectStartMatch.index;

  return findFirstSentenceBreak(normalized);
}

function startsWithMaterialLine(card, text) {
  const monsterType = String(card?.monsterType || "").toLowerCase();
  if (!["fusion", "ascension", "synchro"].includes(monsterType)) return false;

  const normalized = String(text || "").trimStart();
  if (!normalized) return false;

  const labeledMaterialPattern =
    /^(?:Fusion Materials?|Materials?|Materiais(?:\s+de\s+Fus[aã]o)?|Material\s+de\s+Ascens[aã]o|Ascension Material|Ascens[aã]o|Synchro Materials?|Materiais(?:\s+de)?\s+Sincro):/iu;
  if (labeledMaterialPattern.test(normalized)) return true;

  if (monsterType === "synchro") {
    return /\b(Tuner|Regulador|non-?Tuner|n[aã]o-Regulador(?:es)?)\b/iu.test(
      normalized,
    );
  }

  if (monsterType === "fusion" && card?.fusionMaterials) {
    const firstSentenceEnd = findFirstSentenceBreak(normalized);
    const firstSentence =
      firstSentenceEnd >= 0 ? normalized.slice(0, firstSentenceEnd) : normalized;
    return /(?:\+|\b\d+\+?\s+|monsters?|monstros?)\b/iu.test(firstSentence);
  }

  return false;
}

function formatDescriptionMaterialLineBreak(card, description) {
  const text = String(description || "");
  if (!startsWithMaterialLine(card, text)) return text;

  const leadingWhitespaceLength = text.length - text.trimStart().length;
  const trimmed = text.slice(leadingWhitespaceLength);
  const breakIndex = findMaterialLineBreak(trimmed);
  if (breakIndex < 0 || breakIndex >= trimmed.length - 1) return text;

  const materialLine = text
    .slice(0, leadingWhitespaceLength + breakIndex)
    .replace(/\.\s*$/u, "")
    .trimEnd();
  const effectText = trimmed.slice(breakIndex).replace(/^\s+/u, "");
  return `${materialLine}\n${effectText}`;
}

export function formatCardPreviewDescriptionHtml(card, fallback = "") {
  const description =
    getCardDisplayDescription(card) ||
    card?.description ||
    fallback ||
    "";
  return escapeHtml(formatDescriptionMaterialLineBreak(card, description)).replace(
    /\n/g,
    "<br>",
  );
}

export function getUIText(key, params = {}, fallback = null) {
  const path = String(key || "").trim();
  if (!path) return fallback ?? "";

  const localeValue = getPathValue(normalizedLocales[currentLocale], path);
  const defaultValue = getPathValue(DEFAULT_LOCALE_TEXTS, path);
  const fallbackValue =
    typeof localeValue === "string"
      ? localeValue
      : typeof defaultValue === "string"
        ? defaultValue
        : typeof fallback === "string"
          ? fallback
          : path;
  return interpolateText(fallbackValue, params);
}

function humanizeCounterType(counterType) {
  return String(counterType || "counter")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .join(" ");
}

function singularizeCounterLabel(label) {
  const normalized = String(label || "").trim();
  if (!normalized) return normalized;
  if (/^Marcadores\b/iu.test(normalized)) {
    return normalized.replace(/^Marcadores\b/iu, "Marcador");
  }
  if (/^Contadores\b/iu.test(normalized)) {
    return normalized.replace(/^Contadores\b/iu, "Marcador");
  }
  return normalized
    .replace(/\bCounters$/i, "Counter")
    .replace(/\bcounters$/i, "counter");
}

function normalizePortugueseCounterLabel(label) {
  const normalized = String(label || "").trim();
  if (/^Contadores\b/iu.test(normalized)) {
    return normalized.replace(/^Contadores\b/iu, "Marcadores");
  }
  if (/^Contador\b/iu.test(normalized)) {
    return normalized.replace(/^Contador\b/iu, "Marcador");
  }
  return normalized;
}

export function getCounterDisplayLabel(counterType, amount = 2) {
  const key = String(counterType || "default").trim();
  const localized = key ? getUIText(`ui.counters.labels.${key}`, {}, "") : "";
  const pluralLabel = normalizePortugueseCounterLabel(
    localized || `${humanizeCounterType(key)} counters`,
  );
  return Number(amount) === 1 ? singularizeCounterLabel(pluralLabel) : pluralLabel;
}

export function getMonsterAttributeDisplayName(attribute) {
  const rawAttribute = String(attribute || "").trim();
  if (!rawAttribute) return "";
  return ATTRIBUTE_LABELS[currentLocale]?.[rawAttribute] || rawAttribute;
}

export function getMonsterTypeDisplayName(card) {
  const rawTypes = Array.isArray(card?.types)
    ? card.types
    : card?.type
      ? [card.type]
      : [];
  if (rawTypes.length === 0) {
    return currentLocale === "pt-br" ? "Monstro" : "Monster";
  }

  return rawTypes
    .map((type) => {
      const rawType = String(type || "").trim();
      return MONSTER_TYPE_LABELS[currentLocale]?.[rawType] || rawType;
    })
    .filter(Boolean)
    .join(" / ");
}

export function getMonsterTypeLabel(type) {
  const rawType = String(type || "").trim();
  if (!rawType) return "";
  return MONSTER_TYPE_LABELS[currentLocale]?.[rawType] || rawType;
}

export function getMonsterDetailParts(card) {
  const level = Number.isFinite(card?.level) ? card.level : "-";
  const type = getMonsterTypeDisplayName(card);
  const attribute = getMonsterAttributeDisplayName(card?.attribute);
  const tuner = card?.isTuner === true ? TUNER_LABELS[currentLocale] || "Tuner" : "";
  return { level, type, attribute, tuner };
}

export function formatMonsterDetailLine(card) {
  const { level, type, attribute, tuner } = getMonsterDetailParts(card);
  const parts = [`⭐${level}`, tuner, type];
  if (attribute) parts.push(attribute);
  return parts.filter(Boolean).join(" | ");
}

export function formatMonsterDetailHtml(card) {
  const { level, type, attribute, tuner } = getMonsterDetailParts(card);
  const rest = [tuner, type, attribute].filter(Boolean).map(escapeHtml).join(" | ");
  return `⭐<span class="monster-level-number">${escapeHtml(level)}</span>${
    rest ? ` | ${rest}` : ""
  }`;
}

export function formatMonsterStatsLine(card) {
  const atk = Number.isFinite(card?.atk) ? card.atk : "-";
  const def = Number.isFinite(card?.def) ? card.def : "-";
  return {
    atk: `ATK: ${atk}`,
    def: `DEF: ${def}`,
  };
}

export function formatCardKindSubtypeLine(card) {
  const rawKind = String(card?.cardKind || "card").trim();
  const rawSubtype = String(card?.subtype || "").trim();
  const phrase =
    CARD_KIND_SUBTYPE_PHRASES[currentLocale]?.[rawKind]?.[rawSubtype] ||
    CARD_KIND_SUBTYPE_PHRASES.en?.[rawKind]?.[rawSubtype];
  if (phrase) return phrase;

  const kindLabel = CARD_KIND_LABELS[currentLocale]?.[rawKind] || rawKind.toUpperCase();
  const subtypeLabel = rawSubtype
    ? SUBTYPE_LABELS[currentLocale]?.[rawSubtype] || rawSubtype.toUpperCase()
    : "";
  if (!subtypeLabel) return kindLabel;
  return currentLocale === "pt-br"
    ? `${kindLabel} ${subtypeLabel}`
    : `${subtypeLabel} ${kindLabel}`;
}

function getCardDisplayProperty(card, property) {
  const fallbackText = String(
    property === "name" ? card?.name || "" : card?.description || ""
  ).trim();
  const idKey = card && (card.id !== undefined ? String(card.id) : null);
  if (idKey) {
    const localeEntry = normalizedLocales[currentLocale]?.cards?.[idKey];
    if (localeEntry && typeof localeEntry[property] === "string") {
      return localeEntry[property];
    }
    const enEntry = normalizedLocales["en"]?.cards?.[idKey];
    if (enEntry && typeof enEntry[property] === "string") {
      return enEntry[property];
    }
  }
  return fallbackText;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPathValue(source, path) {
  if (!isObject(source) || !path) return undefined;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((cursor, part) => {
      if (!isObject(cursor)) return undefined;
      return cursor[part];
    }, source);
}

function interpolateText(text, params = {}) {
  return String(text ?? "").replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = params?.[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}
