// src/core/ai/dragon/combos.js
// Combo matrix and lightweight combo detection for the Dragon deck.

import { EXTREME_DRAGON_NAMES } from "./knowledge.js";
import { getValidBoneflameCostCandidates } from "./boneflamePolicy.js";

export const DRAGON_COMBO_PRIORITY = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

export const DRAGON_COMBO_STATUS = Object.freeze({
  SUPPORTED_TODAY: "supported_today",
  PARTIAL: "partially_supported",
  PLANNED_BY_TURN_LINE_SEARCH: "planned_by_turn_line_search",
  IMPROVED_BY_BATTLE_PLANNING: "improved_by_battle_planning",
  REQUIRES_ACTION_GENERATION: "requires_action_generation",
  REQUIRES_SIMULATION: "requires_simulation",
  DEFENSIVE_PLANNING: "defensive_planning",
  CONDITIONAL_RESOURCE_LINE: "conditional_resource_line",
});

/**
 * DR-2 combo matrix. This is intentionally broader than the current detector:
 * later rollouts use this list as the implementation guide for action generation,
 * simulation, TurnLineSearch milestones, and battle planning.
 */
export const COMBO_DATABASE = [
  {
    name: "Armored Dragon Search",
    description: "Normal Summon Armored Dragon -> search lv4 Dragon from deck",
    requires: ["Armored Dragon in hand", "Normal Summon available"],
    result: "Search key Dragon + extend hand",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.SUPPORTED_TODAY,
    needs: [],
  },
  {
    name: "Luminescent Revive",
    description: "Normal Summon Luminescent Dragon -> SS lv4- Dragon from GY",
    requires: ["Luminescent Dragon in hand", "lv4- Dragon in GY", "Normal Summon available"],
    result: "2 Dragons on field from 1 Normal Summon",
    priority: 9,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.SUPPORTED_TODAY,
    needs: [],
  },
  {
    name: "Luminous + Voltaic Starter",
    description: "Empty field Luminous Dragon -> Voltaic Dragon extender",
    requires: ["Luminous Dragon in hand", "Voltaic Dragon in hand", "Empty field"],
    result: "2 Dragon bodies without Normal Summon",
    priority: 11,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Luminous + Voltaic + Armored",
    description: "Luminous starter and Voltaic extender keep Normal Summon for Armored search",
    requires: ["Luminous Dragon in hand", "Voltaic Dragon in hand", "Armored Dragon in hand", "Empty field"],
    result: "3 bodies or 2 bodies plus Armored search pressure",
    priority: 12,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "candidate ordering"],
  },
  {
    name: "Luminous + Voltaic + Awakening",
    description: "Luminous and Voltaic create 2 bodies for Extreme Dragon Awakening",
    requires: ["Luminous Dragon", "Voltaic Dragon", "Extreme Dragon Awakening"],
    result: "Awakening can search and convert 2 bodies into a Level 8+ Dragon",
    priority: 12,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "Awakening simulation"],
  },
  {
    name: "Voltaic Extension",
    description: "Control Dragon -> SS Voltaic Dragon from hand",
    requires: ["Voltaic Dragon in hand", "Dragon monster on field"],
    result: "Extra body on field, potential Black Bull or Tech-Void material",
    priority: 7,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.SUPPORTED_TODAY,
    needs: [],
  },
  {
    name: "Hellkite Swap",
    description: "Send weaker Dragon to GY -> SS Hellkite from hand",
    requires: ["Hellkite Dragon in hand", "Dragon on field"],
    result: "2300 ATK on field, Dragon in GY for setup",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Hellkite GY Recycle",
    description: "Hellkite on field -> send self to GY -> SS lv7- Dragon from GY",
    requires: ["Hellkite Dragon on field", "lv7- Dragon in GY"],
    result: "Recycle GY Dragon, Hellkite in GY for further use",
    priority: 7,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.REQUIRES_ACTION_GENERATION,
    needs: ["field ignition action generation", "simulation"],
  },
  {
    name: "Black Bull Rush",
    description: "Discard 2 Dragons, including Voltaic when valuable, -> SS Black Bull Dragon",
    requires: ["Black Bull Dragon in hand", "2+ Dragon monsters in hand"],
    result: "2500 ATK + GY setup + 800 burn damage if Voltaic is discarded",
    priority: 9,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PARTIAL,
    needs: ["discard value simulation"],
  },
  {
    name: "Luminous + Black Bull + Voltaic",
    description: "Luminous on field turns Black Bull discard into Voltaic burn plus Dragon recovery",
    requires: ["Luminous Dragon", "Black Bull Dragon", "Voltaic Dragon", "discardable Dragon"],
    result: "Black Bull pressure, 800 burn, and one recovered Dragon",
    priority: 10,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "discard-trigger simulation"],
  },
  {
    name: "Luminous + Grey Loop",
    description: "Luminous makes discard costs recover value while Grey can return from GY",
    requires: ["Luminous Dragon", "Grey Dragon", "discard outlet"],
    result: "Discard cost becomes recoverable resource instead of pure loss",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "discard-trigger simulation"],
  },
  {
    name: "Tech-Void Fusion",
    description: "Voltaic Dragon + lv5+ Dragon -> Tech-Void Dragon",
    requires: ["Polymerization", "Voltaic Dragon", "lv5+ Dragon"],
    result: "Tech-Void Dragon pressure when it beats Radiant by cost, damage, or tempo",
    priority: 10,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Armored to Tech-Void",
    description: "Armored search helps assemble Voltaic while a lv5+ Dragon completes Tech-Void",
    requires: ["Armored Dragon", "Polymerization", "lv5+ Dragon access"],
    result: "Search Voltaic or supporting Dragon, then fuse into Tech-Void when available",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "contextual Armored search"],
  },
  {
    name: "Radiant Cosmic Fusion",
    description: "3 Dragons including 1 LIGHT -> Radiant Cosmic Dragon",
    requires: ["Polymerization", "3 Dragon materials", "1 LIGHT Dragon"],
    result: "3300 ATK value boss, GY recycle, draw 1, destruction insurance",
    priority: 12,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Luminous to Radiant",
    description: "Use Luminous Dragon as LIGHT material for Radiant Cosmic Dragon",
    requires: ["Luminous Dragon", "Polymerization", "2 other Dragons"],
    result: "Radiant Cosmic Dragon with natural LIGHT material",
    priority: 12,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Armored + Luminous + Voltaic to Radiant",
    description: "Armored search plus Luminous and Voltaic creates a LIGHT-heavy Radiant line",
    requires: ["Armored Dragon", "Luminous Dragon", "Voltaic Dragon", "Polymerization"],
    result: "Radiant Cosmic Dragon with search value and extender bodies",
    priority: 12,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "contextual Armored search"],
  },
  {
    name: "Converging Stars Hand Unlock",
    description: "Discard 1 to reduce hand monster levels by 2 and unlock a heavy summon",
    requires: ["Converging Stars in hand", "high-level Dragon in hand", "discard fodder"],
    result: "Turns a bricked high-level hand into a summonable line",
    priority: 11,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Converging + Darkness",
    description: "Converging Stars -> Darkness Dragon level 5->3 -> free Normal Summon",
    requires: ["Converging Stars in hand", "Darkness Dragon in hand", "discard fodder"],
    result: "Darkness Dragon enters as a control or pressure body",
    priority: 10,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Converging + Abyssal",
    description: "Converging Stars -> Abyssal Serpent Dragon lv7->5 -> Normal Summon with 1 tribute",
    requires: ["Converging Stars in hand", "Abyssal Serpent Dragon in hand", "1 tribute on field"],
    result: "Abyssal Serpent on field to answer a major threat",
    priority: 9,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Luminous + Converging",
    description: "Luminous turns Converging discard into a recoverable Dragon resource",
    requires: ["Luminous Dragon face-up", "Converging Stars", "Dragon discard"],
    result: "Level reduction plus Dragon recovery instead of a pure discard cost",
    priority: 9,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["discard-trigger simulation"],
  },
  {
    name: "Awakening Setup",
    description: "Activate Awakening, search a Level 8+ Dragon, and line up 2 field Dragons",
    requires: ["Awakening in hand", "Level 8+ Dragon in deck", "2 Dragon bodies or extenders"],
    result: "Continuous spell live with a searched payoff ready",
    priority: 11,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "Awakening simulation"],
  },
  {
    name: "Awakening Boss Conversion",
    description: "Face-up Awakening sends 2 controlled Dragons to SS a Level 8+ Dragon from hand",
    requires: ["Awakening face-up", "Level 8+ Dragon in hand", "2 controlled Dragons"],
    result: "Converts small bodies into a boss without using Normal Summon",
    priority: 13,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "Awakening simulation"],
  },
  {
    name: "Awakening to Black Bull Attacker",
    description: "Awakening converts 2 Dragons into Black Bull for immediate pressure",
    requires: ["Awakening face-up", "Black Bull Dragon in hand", "2 controlled Dragons"],
    result: "Black Bull attacker without paying discard cost",
    priority: 13,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "Awakening simulation"],
  },
  {
    name: "Black Bull + Jagged Peak",
    description: "Black Bull's battle pressure accelerates Jagged Peak counters",
    requires: ["Black Bull Dragon", "Jagged Peak of the Dragons"],
    result: "Multiple battle destroys can build toward Jagged Peak cashout",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.IMPROVED_BY_BATTLE_PLANNING,
    needs: ["battle planning"],
  },
  {
    name: "Jagged Peak Setup",
    description: "Activate Jagged Peak -> recover lv4 Dragon from GY -> start accumulating counters",
    requires: ["Jagged Peak of the Dragons in hand", "No field spell active"],
    result: "Field spell active, recovered Dragon, path to Dragon cashout",
    priority: 9,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.SUPPORTED_TODAY,
    needs: [],
  },
  {
    name: "Jagged Peak Cashout",
    description: "5+ Dragon Peak counters -> send Jagged Peak to SS a Dragon",
    requires: ["Jagged Peak face-up", "5+ Dragon Peak counters", "Dragon in hand/deck/GY"],
    result: "Converts battle progress into a boss or key extender",
    priority: 13,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["field spell action generation", "simulation"],
  },
  {
    name: "Hellkite Roar GY to Jagged",
    description: "Banish Hellkite Roar from GY -> search Jagged Peak",
    requires: ["Hellkite Roar in GY", "Jagged Peak of the Dragons in deck"],
    result: "Access field spell engine without natural draw",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.REQUIRES_ACTION_GENERATION,
    needs: ["spell GY action generation", "simulation"],
  },
  {
    name: "Boneflame GY Extender",
    description: "Send expendable field Dragon to GY -> SS Boneflame with GY-scaling ATK",
    requires: ["Boneflame Dragon in GY", "Dragon monster on field"],
    result: "Additional attacker with potentially high ATK",
    priority: 6,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch"],
  },
  {
    name: "Black Bull GY Search",
    description: "Black Bull in GY searches a Level 7 or 8 Dragon when that is better than keeping it",
    requires: ["Black Bull Dragon in GY", "Level 7/8 Dragon in deck"],
    result: "Converts GY Black Bull into a high-level Dragon follow-up",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.REQUIRES_ACTION_GENERATION,
    needs: ["graveyard monster action generation", "simulation"],
  },
  {
    name: "Radiant Material Refund",
    description: "Radiant shuffles 1-5 useful GY cards and draws 1",
    requires: ["Radiant Cosmic Dragon fusion summon", "Useful GY cards"],
    result: "Resource stabilization without emptying critical GY lines",
    priority: 9,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.REQUIRES_SIMULATION,
    needs: ["selective GY simulation"],
  },
  {
    name: "Radiant Death Insurance",
    description: "Radiant destroyed -> revive best non-Radiant Dragon from GY",
    requires: ["Radiant Cosmic Dragon on field", "Dragon in GY"],
    result: "Punishes removal and keeps Dragon pressure",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.CONDITIONAL_RESOURCE_LINE,
    needs: ["terminal scoring"],
  },
  {
    name: "Purified Setup",
    description: "Special Summon Purified Crystal Dragon from hand using 3 Dragons in GY",
    requires: ["Purified Crystal Dragon in hand", "3 Dragons in GY"],
    result: "2500 ATK body with Dragon protection and Rainbow progress",
    priority: 11,
    strategicPriority: DRAGON_COMBO_PRIORITY.HIGH,
    status: DRAGON_COMBO_STATUS.PLANNED_BY_TURN_LINE_SEARCH,
    needs: ["TurnLineSearch", "GY resource scoring"],
  },
  {
    name: "Purified to Rainbow",
    description: "Use progressed Purified Crystal Dragon as Ascension material for Rainbow Cosmic",
    requires: ["Purified Crystal Dragon on field", "3 material effect activations"],
    result: "Rainbow Cosmic Dragon as long-game payoff",
    priority: 8,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.CONDITIONAL_RESOURCE_LINE,
    needs: ["Ascension planning", "terminal scoring"],
  },
  {
    name: "Rainbow GY Resource Setup",
    description: "Rainbow in GY sends up to 3 Extreme Dragons only when it creates real follow-up",
    requires: ["Rainbow Cosmic Dragon in GY", "Extreme Dragons in deck", "clear follow-up payoff"],
    result: "Sets up Call of the Haunted, Luminous recovery, Boneflame, or next-turn resource lines",
    priority: 5,
    strategicPriority: DRAGON_COMBO_PRIORITY.LOW,
    status: DRAGON_COMBO_STATUS.CONDITIONAL_RESOURCE_LINE,
    needs: ["graveyard monster action generation", "resource-aware simulation"],
  },
  {
    name: "Dragon Spirit Sanctuary Tag-Out",
    description: "Set Sanctuary to protect a targeted Dragon and replace it from hand",
    requires: ["Dragon Spirit Sanctuary", "Dragon on field", "Dragon in hand"],
    result: "Defensive tag-out line instead of proactive combo",
    priority: 7,
    strategicPriority: DRAGON_COMBO_PRIORITY.MEDIUM,
    status: DRAGON_COMBO_STATUS.DEFENSIVE_PLANNING,
    needs: ["defensive trigger planning"],
  },
];

const COMBO_BY_NAME = new Map(COMBO_DATABASE.map((combo) => [combo.name, combo]));

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function hasRadiantMaterials(cards = []) {
  const dragons = (cards || []).filter(isDragonMonster);
  return (
    dragons.length >= 3 &&
    dragons.some((card) => String(card.attribute || "").toLowerCase() === "light")
  );
}

function hasTechVoidMaterials(cards = []) {
  const dragons = (cards || []).filter(isDragonMonster);
  return (
    dragons.some((card) => card.name === "Voltaic Dragon") &&
    dragons.some((card) => card.name !== "Voltaic Dragon" && (card.level || 0) >= 5)
  );
}

function availableCombo(name, action, overrides = {}) {
  const definition = COMBO_BY_NAME.get(name) || {};
  return {
    ...definition,
    name,
    priority: overrides.priority ?? definition.priority ?? 0,
    action,
  };
}

/**
 * Detects currently visible Dragon combo hooks. This is not the full DR-2
 * matrix; it only marks combos that can be inferred cheaply from the current
 * public analysis object.
 * @param {Object} analysis
 * @param {Function} [logFn]
 * @returns {Array}
 */
export function detectAvailableCombos(analysis, logFn = null) {
  const available = [];
  const handNames = (analysis.hand || []).map((c) => c.name);
  const fieldNames = (analysis.field || []).map((c) => c.name);
  const gyCards = analysis.graveyard || [];
  const gyNames = gyCards.map((c) => c.name);

  const log = (msg) => typeof logFn === "function" && logFn(msg);
  const hasFieldDragon = (analysis.field || []).some((c) => c.cardKind === "monster");

  if (handNames.includes("Jagged Peak of the Dragons") && !analysis.fieldSpell) {
    available.push(availableCombo("Jagged Peak Setup", { type: "spell", cardName: "Jagged Peak of the Dragons" }));
    log("Combo: Jagged Peak Setup");
  }

  if (handNames.includes("Armored Dragon") && analysis.canNormalSummon) {
    available.push(availableCombo("Armored Dragon Search", { type: "summon", cardName: "Armored Dragon" }));
    log("Combo: Armored Dragon Search");
  }

  if (
    handNames.includes("Luminescent Dragon") &&
    analysis.canNormalSummon &&
    gyCards.some((c) => c.cardKind === "monster" && (c.level || 0) <= 4)
  ) {
    available.push(availableCombo("Luminescent Revive", { type: "summon", cardName: "Luminescent Dragon" }));
    log("Combo: Luminescent Dragon revive");
  }

  if (
    handNames.includes("Luminous Dragon") &&
    handNames.includes("Voltaic Dragon") &&
    (analysis.field || []).length === 0
  ) {
    available.push(availableCombo("Luminous + Voltaic Starter", { type: "handIgnition", cardName: "Luminous Dragon" }));
    log("Combo: Luminous starter into Voltaic extender");
  }

  if (
    handNames.includes("Luminous Dragon") &&
    handNames.includes("Voltaic Dragon") &&
    handNames.includes("Armored Dragon") &&
    (analysis.field || []).length === 0
  ) {
    available.push(availableCombo("Luminous + Voltaic + Armored", { type: "handIgnition", cardName: "Luminous Dragon" }));
    log("Combo: Luminous + Voltaic keeps Armored normal summon");
  }

  if (
    handNames.includes("Luminous Dragon") &&
    handNames.includes("Voltaic Dragon") &&
    handNames.includes("Extreme Dragon Awakening")
  ) {
    available.push(availableCombo("Luminous + Voltaic + Awakening", { type: "handIgnition", cardName: "Luminous Dragon" }));
    log("Combo: Luminous + Voltaic sets up Awakening fodder");
  }

  if (handNames.includes("Voltaic Dragon") && hasFieldDragon) {
    available.push(availableCombo("Voltaic Extension", { type: "handIgnition", cardName: "Voltaic Dragon" }));
    log("Combo: Voltaic Dragon hand ignition");
  }

  if (handNames.includes("Hellkite Dragon") && hasFieldDragon) {
    available.push(availableCombo("Hellkite Swap", { type: "handIgnition", cardName: "Hellkite Dragon" }));
    log("Combo: Hellkite Dragon swap");
  }

  if (handNames.includes("Black Bull Dragon")) {
    const handDragons = (analysis.hand || []).filter(
      (c) => isDragonMonster(c) && c.name !== "Black Bull Dragon",
    );
    if (handDragons.length >= 2) {
      available.push(availableCombo("Black Bull Rush", { type: "handIgnition", cardName: "Black Bull Dragon" }));
      log("Combo: Black Bull Dragon SS");
    }
  }

  if (
    handNames.includes("Luminous Dragon") &&
    handNames.includes("Black Bull Dragon") &&
    handNames.includes("Voltaic Dragon")
  ) {
    available.push(availableCombo("Luminous + Black Bull + Voltaic", { type: "handIgnition", cardName: "Luminous Dragon" }));
    log("Combo: Luminous + Black Bull + Voltaic");
  }

  if (
    handNames.includes("Luminous Dragon") &&
    handNames.includes("Grey Dragon") &&
    handNames.some((name) => ["Black Bull Dragon", "Converging Stars"].includes(name))
  ) {
    available.push(availableCombo("Luminous + Grey Loop", { type: "handIgnition", cardName: "Luminous Dragon" }));
    log("Combo: Luminous + Grey value loop");
  }

  if (handNames.includes("Polymerization")) {
    const allCards = [...(analysis.hand || []), ...(analysis.field || [])];
    if (hasRadiantMaterials(allCards)) {
      available.push(availableCombo("Radiant Cosmic Fusion", { type: "spell", cardName: "Polymerization" }));
      log("Combo: Radiant Cosmic Dragon Fusion");
    }
    if (handNames.includes("Luminous Dragon") && hasRadiantMaterials(allCards)) {
      available.push(availableCombo("Luminous to Radiant", { type: "spell", cardName: "Polymerization" }));
      log("Combo: Luminous Dragon as Radiant LIGHT material");
    }
    if (
      handNames.includes("Armored Dragon") &&
      allCards.some((card) => isDragonMonster(card) && (card.level || 0) >= 5)
    ) {
      available.push(availableCombo("Armored to Tech-Void", { type: "summon", cardName: "Armored Dragon" }));
      log("Combo: Armored can help assemble Tech-Void");
    }
    if (hasTechVoidMaterials(allCards)) {
      available.push(availableCombo("Tech-Void Fusion", { type: "spell", cardName: "Polymerization" }));
      log("Combo: Tech-Void Dragon Fusion");
    }
  }

  if (
    handNames.includes("Converging Stars") &&
    (analysis.hand || []).some((card) => isDragonMonster(card) && (card.level || 0) >= 5)
  ) {
    available.push(availableCombo("Converging Stars Hand Unlock", { type: "spell", cardName: "Converging Stars" }));
    log("Combo: Converging Stars can unlock high-level hand");
  }

  if (
    handNames.includes("Converging Stars") &&
    handNames.includes("Darkness Dragon") &&
    analysis.canNormalSummon
  ) {
    available.push(availableCombo("Converging + Darkness", { type: "spell", cardName: "Converging Stars" }));
    log("Combo: Converging -> Darkness");
  }

  if (
    handNames.includes("Converging Stars") &&
    handNames.includes("Abyssal Serpent Dragon") &&
    analysis.canNormalSummon &&
    (analysis.field || []).some((c) => c.cardKind === "monster")
  ) {
    available.push(availableCombo("Converging + Abyssal", { type: "spell", cardName: "Converging Stars" }));
    log("Combo: Converging -> Abyssal");
  }

  if (
    fieldNames.includes("Luminous Dragon") &&
    handNames.includes("Converging Stars") &&
    (analysis.hand || []).some((card) => isDragonMonster(card))
  ) {
    available.push(availableCombo("Luminous + Converging", { type: "spell", cardName: "Converging Stars" }));
    log("Combo: Luminous + Converging recovery line");
  }

  const awakeningInHand = handNames.includes("Extreme Dragon Awakening");
  const awakeningFaceup = (analysis.spellTrap || []).some(
    (c) => !c.isFacedown && c.name === "Extreme Dragon Awakening",
  );
  const lv8DragonsInHand = (analysis.hand || []).filter(
    (c) => isDragonMonster(c) && (c.level || 0) >= 8,
  );
  const fieldDragonMons = (analysis.field || []).filter(isDragonMonster);
  const nonExtremeField = fieldDragonMons.filter((c) => !EXTREME_DRAGON_NAMES.includes(c.name));
  const hasExtremeFaceupField = fieldDragonMons.some((c) => EXTREME_DRAGON_NAMES.includes(c.name));
  const summonableLv8DragonInHand = lv8DragonsInHand.some(
    (c) => !hasExtremeFaceupField || !EXTREME_DRAGON_NAMES.includes(c.name),
  );

  if (
    awakeningInHand &&
    (nonExtremeField.length >= 2 ||
      handNames.some((name) => ["Luminous Dragon", "Luminescent Dragon", "Hellkite Dragon", "Voltaic Dragon"].includes(name)))
  ) {
    available.push(availableCombo("Awakening Setup", { type: "spell", cardName: "Extreme Dragon Awakening" }));
    log("Combo: Awakening Setup");
  }

  if (awakeningFaceup && summonableLv8DragonInHand && nonExtremeField.length >= 2) {
    available.push(availableCombo("Awakening Boss Conversion", { type: "spellTrapEffect", cardName: "Extreme Dragon Awakening" }));
    log("Combo: Awakening Boss Conversion");
    if (handNames.includes("Black Bull Dragon")) {
      available.push(availableCombo("Awakening to Black Bull Attacker", { type: "spellTrapEffect", cardName: "Extreme Dragon Awakening" }));
      log("Combo: Awakening to Black Bull");
    }
  }

  if (
    fieldNames.includes("Black Bull Dragon") &&
    (analysis.hasJaggedPeak || analysis.fieldSpell === "Jagged Peak of the Dragons")
  ) {
    available.push(availableCombo("Black Bull + Jagged Peak", { type: "battlePlan", cardName: "Black Bull Dragon" }));
    log("Combo: Black Bull + Jagged Peak pressure");
  }

  if (analysis.hasJaggedPeak && (analysis.jaggedPeakCounters || 0) >= 5) {
    available.push(availableCombo("Jagged Peak Cashout", { type: "fieldSpellEffect", cardName: "Jagged Peak of the Dragons" }));
    log("Combo: Jagged Peak cashout is live");
  }

  if (gyNames.includes("Hellkite Roar") && !analysis.fieldSpell && !handNames.includes("Jagged Peak of the Dragons")) {
    available.push(availableCombo("Hellkite Roar GY to Jagged", { type: "graveyardSpellEffect", cardName: "Hellkite Roar" }));
    log("Combo: Hellkite Roar GY can access Jagged Peak");
  }

  const boneflame = gyCards.find((card) => card?.name === "Boneflame Dragon");
  if (boneflame && getValidBoneflameCostCandidates(boneflame, analysis).length > 0) {
    available.push(availableCombo("Boneflame GY Extender", { type: "graveyardMonsterEffect", cardName: "Boneflame Dragon" }));
    log("Combo: Boneflame Dragon GY ignition");
  }

  if (gyNames.includes("Black Bull Dragon")) {
    available.push(availableCombo("Black Bull GY Search", { type: "graveyardMonsterEffect", cardName: "Black Bull Dragon" }));
    log("Combo: Black Bull GY search potential");
  }

  if (fieldNames.includes("Radiant Cosmic Dragon") && gyCards.length > 0) {
    available.push(availableCombo("Radiant Material Refund", { type: "triggeredValue", cardName: "Radiant Cosmic Dragon" }));
    log("Combo: Radiant can convert GY into a draw");
  }

  if (
    fieldNames.includes("Radiant Cosmic Dragon") &&
    gyCards.some((card) => isDragonMonster(card) && card.name !== "Radiant Cosmic Dragon")
  ) {
    available.push(availableCombo("Radiant Death Insurance", { type: "passiveValue", cardName: "Radiant Cosmic Dragon" }));
    log("Combo: Radiant has Dragon revive insurance");
  }

  if (
    handNames.includes("Purified Crystal Dragon") &&
    gyCards.filter(isDragonMonster).length >= 3
  ) {
    available.push(availableCombo("Purified Setup", { type: "handIgnition", cardName: "Purified Crystal Dragon" }));
    log("Combo: Purified Crystal Dragon setup");
  }

  if (fieldNames.includes("Purified Crystal Dragon")) {
    available.push(availableCombo("Purified to Rainbow", { type: "ascension", cardName: "Rainbow Cosmic Dragon" }));
    log("Combo: Purified can progress toward Rainbow");
  }

  if (gyNames.includes("Rainbow Cosmic Dragon")) {
    available.push(availableCombo("Rainbow GY Resource Setup", { type: "graveyardMonsterEffect", cardName: "Rainbow Cosmic Dragon" }));
    log("Combo: Rainbow GY resource setup is possible");
  }

  if (
    handNames.includes("Dragon Spirit Sanctuary") &&
    fieldDragonMons.length > 0 &&
    (analysis.hand || []).some(isDragonMonster)
  ) {
    available.push(availableCombo("Dragon Spirit Sanctuary Tag-Out", { type: "set_spell_trap", cardName: "Dragon Spirit Sanctuary" }));
    log("Combo: Dragon Spirit Sanctuary defensive tag-out");
  }

  return available;
}

/**
 * Returns combo by name.
 * @param {string} name
 * @returns {Object|null}
 */
export function getComboByName(name) {
  return COMBO_BY_NAME.get(name) || null;
}
