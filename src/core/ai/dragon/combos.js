// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/combos.js
// Combo detection for Dragon deck.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EXTREME_DRAGON_NAMES,
  countExtremeInGY,
  isExtremeDragon,
} from "./knowledge.js";

/**
 * @type {ComboDefinition[]}
 */
export const COMBO_DATABASE = [
  {
    name: "Armored Dragon Search",
    description: "Normal Summon Armored Dragon → search lv4 Dragon from deck",
    requires: ["Armored Dragon in hand", "Normal Summon available"],
    result: "Search key Dragon + extend hand",
    priority: 8,
  },
  {
    name: "Luminescent Revive",
    description: "Normal Summon Luminescent Dragon → SS lv4- Dragon from GY",
    requires: ["Luminescent Dragon in hand", "lv4- Dragon in GY", "Normal Summon available"],
    result: "2 Dragons on field from 1 Normal Summon",
    priority: 9,
  },
  {
    name: "Voltaic Extension",
    description: "Control Dragon → SS Voltaic Dragon from hand",
    requires: ["Voltaic Dragon in hand", "Dragon monster on field"],
    result: "Extra body on field, potential Black Bull or Tech-Void material",
    priority: 7,
  },
  {
    name: "Hellkite Field Swap",
    description: "Send weaker Dragon to GY → SS Hellkite from hand",
    requires: ["Hellkite Dragon in hand", "Dragon on field"],
    result: "2300 ATK on field, Dragon in GY for setup",
    priority: 8,
  },
  {
    name: "Black Bull Rush",
    description: "Discard 2 Dragons (including Voltaic for 800 burn) → SS Black Bull Dragon",
    requires: ["Black Bull Dragon in hand", "2+ Dragon monsters in hand"],
    result: "2500 ATK + GY setup + 800 burn damage (if Voltaic discarded)",
    priority: 9,
  },
  {
    name: "Bahamut Win Condition",
    description: "5 Extreme Dragons in GY → Polymerization → Supreme Bahamut Dragon",
    requires: ["Polymerization in hand", "5 Extreme Dragons in GY"],
    result: "Game-winning boss — unaffected, negates per turn",
    priority: 15,
  },
  {
    name: "Tech-Void Fusion",
    description: "Voltaic Dragon + lv5+ Dragon → Tech-Void Dragon (2500+ ATK)",
    requires: ["Polymerization", "Voltaic Dragon", "lv5+ Dragon"],
    result: "Tech-Void Dragon 2500 ATK + ATK buff on fusion",
    priority: 10,
  },
  {
    name: "Jagged Peak Setup",
    description: "Activate Jagged Peak → recover lv4 Dragon from GY → start accumulating counters",
    requires: ["Jagged Peak of the Dragons in hand", "No field spell active"],
    result: "Field spell active, recovered Dragon, path to Extreme Dragon SS",
    priority: 9,
  },
  {
    name: "Hellkite GY Cycle",
    description: "Hellkite on field → send self to GY → SS lv7- Dragon from GY",
    requires: ["Hellkite Dragon on field", "lv7- Dragon in GY"],
    result: "Recycle GY Dragon, Hellkite in GY for further use",
    priority: 7,
  },
  {
    name: "Boneflame GY Pump",
    description: "Send expendable field Dragon to GY → SS Boneflame → gains ATK per GY Dragon",
    requires: ["Boneflame Dragon in GY", "Dragon monster on field"],
    result: "Additional attacker with potentially high ATK",
    priority: 6,
  },
  {
    name: "Converging Stars Darkness",
    description: "Converging Stars (discard fodder) → Darkness Dragon level 5→4 → free Normal Summon",
    requires: ["Converging Stars in hand", "Darkness Dragon in hand", "Discard fodder"],
    result: "Darkness Dragon in ATK with +300 per destroyed Dragon",
    priority: 10,
  },
  {
    name: "Converging Stars Abyssal",
    description: "Converging Stars → Abyssal Serpent Dragon lv7→6 → Normal Summon with 1 tribute",
    requires: ["Converging Stars in hand", "Abyssal Serpent Dragon in hand", "1 tribute on field"],
    result: "Abyssal Serpent on field — stalls opponent's biggest threat",
    priority: 9,
  },
  {
    name: "Awakening Setup",
    description: "Activate Awakening (cont. spell) while holding Extreme Dragon + lining up 2 fodder",
    requires: ["Awakening in hand", "Extreme Dragon in hand", "2 non-Extreme field Dragons OR extenders"],
    result: "Continuous spell live; Extreme can hit field via ignition without spending NS",
    priority: 11,
  },
  {
    name: "Awakening Ignition",
    description: "Face-up Awakening + Extreme in hand + 2 fodder field Dragons → SS Extreme",
    requires: ["Awakening face-up", "Extreme Dragon in hand", "2+ non-Extreme field Dragons", "No Extreme face-up"],
    result: "Extreme Dragon on field without using Normal Summon",
    priority: 13,
  },
];

/**
 * @typedef {Object} GameAnalysis
 * @property {Array} hand
 * @property {Array} field
 * @property {Array} graveyard
 * @property {string|null} fieldSpell
 * @property {boolean} canNormalSummon
 * @property {number} oppLp
 * @property {Array} oppField
 */

/**
 * Detects available combos for the Dragon deck.
 * @param {GameAnalysis} analysis
 * @param {Function} [logFn]
 * @returns {Array}
 */
export function detectAvailableCombos(analysis, logFn = null) {
  const available = [];
  const handNames = analysis.hand.map((c) => c.name);
  const fieldNames = analysis.field.map((c) => c.name);
  const gyCards = analysis.graveyard || [];
  const gyNames = gyCards.map((c) => c.name);

  const log = (msg) => typeof logFn === "function" && logFn(msg);

  const hasFieldDragon = analysis.field.some((c) => c.cardKind === "monster");
  const gyExtremeCount = countExtremeInGY(gyCards);

  // ── Bahamut Win Condition ──────────────────────────────────────────────────
  if (gyExtremeCount >= 5 && handNames.includes("Polymerization")) {
    available.push({
      name: "Bahamut Win Condition",
      priority: 15,
      action: { type: "spell", cardName: "Polymerization" },
    });
    log(`💥 BAHAMUT WIN CONDITION AVAILABLE! ${gyExtremeCount} Extreme Dragons in GY!`);
  }

  // ── Jagged Peak Setup ─────────────────────────────────────────────────────
  if (handNames.includes("Jagged Peak of the Dragons") && !analysis.fieldSpell) {
    available.push({
      name: "Jagged Peak Setup",
      priority: 9,
      action: { type: "spell", cardName: "Jagged Peak of the Dragons" },
    });
    log(`💡 Combo: Jagged Peak Setup (field spell + GY recovery)`);
  }

  // ── Armored Dragon Search ─────────────────────────────────────────────────
  if (handNames.includes("Armored Dragon") && analysis.canNormalSummon) {
    available.push({
      name: "Armored Dragon Search",
      priority: 8,
      action: { type: "summon", cardName: "Armored Dragon" },
    });
    log(`💡 Combo: Armored Dragon Search`);
  }

  // ── Luminescent Revive ────────────────────────────────────────────────────
  if (
    handNames.includes("Luminescent Dragon") &&
    analysis.canNormalSummon &&
    gyCards.some((c) => c.cardKind === "monster" && (c.level || 0) <= 4)
  ) {
    available.push({
      name: "Luminescent Revive",
      priority: 9,
      action: { type: "summon", cardName: "Luminescent Dragon" },
    });
    log(`💡 Combo: Luminescent Dragon → SS lv4- from GY`);
  }

  // ── Voltaic Extension ─────────────────────────────────────────────────────
  if (handNames.includes("Voltaic Dragon") && hasFieldDragon) {
    available.push({
      name: "Voltaic Extension",
      priority: 7,
      action: { type: "handIgnition", cardName: "Voltaic Dragon" },
    });
    log(`💡 Combo: Voltaic Dragon hand ignition SS`);
  }

  // ── Hellkite Field Swap ───────────────────────────────────────────────────
  if (handNames.includes("Hellkite Dragon") && hasFieldDragon) {
    available.push({
      name: "Hellkite Field Swap",
      priority: 8,
      action: { type: "handIgnition", cardName: "Hellkite Dragon" },
    });
    log(`💡 Combo: Hellkite Dragon hand ignition → 2300 ATK`);
  }

  // ── Black Bull Rush ───────────────────────────────────────────────────────
  if (handNames.includes("Black Bull Dragon")) {
    const handDragons = analysis.hand.filter(
      (c) => (c.type === "Dragon" || c.cardKind === "monster") && c.name !== "Black Bull Dragon"
    );
    if (handDragons.length >= 2) {
      available.push({
        name: "Black Bull Rush",
        priority: 9,
        action: { type: "handIgnition", cardName: "Black Bull Dragon" },
      });
      log(`🔥 Combo: Black Bull Dragon SS (discard 2 Dragons)`);
    }
  }

  // ── Tech-Void Fusion ──────────────────────────────────────────────────────
  if (handNames.includes("Polymerization")) {
    const allCards = [...analysis.hand, ...analysis.field];
    const hasVoltaic = allCards.some((c) => c.name === "Voltaic Dragon");
    const hasLv5Plus = allCards.some(
      (c) => (c.type === "Dragon" || c.cardKind === "monster") && (c.level || 0) >= 5 && c.name !== "Voltaic Dragon"
    );
    if (hasVoltaic && hasLv5Plus && gyExtremeCount < 5) {
      available.push({
        name: "Tech-Void Fusion",
        priority: 10,
        action: { type: "spell", cardName: "Polymerization" },
      });
      log(`🔥 Combo: Tech-Void Dragon Fusion`);
    }
  }

  // ── Converging Stars Darkness ─────────────────────────────────────────────
  if (
    handNames.includes("Converging Stars") &&
    handNames.includes("Darkness Dragon") &&
    analysis.canNormalSummon
  ) {
    available.push({
      name: "Converging Stars Darkness",
      priority: 10,
      action: { type: "spell", cardName: "Converging Stars" },
    });
    log(`💡 Combo: Converging Stars → Darkness Dragon free summon`);
  }

  // ── Converging Stars Abyssal ──────────────────────────────────────────────
  if (
    handNames.includes("Converging Stars") &&
    handNames.includes("Abyssal Serpent Dragon") &&
    analysis.canNormalSummon
  ) {
    const fieldMonsters = analysis.field.filter((c) => c.cardKind === "monster");
    if (fieldMonsters.length >= 1) {
      available.push({
        name: "Converging Stars Abyssal",
        priority: 9,
        action: { type: "spell", cardName: "Converging Stars" },
      });
      log(`💡 Combo: Converging Stars → Abyssal Serpent (lv7→6, 1 tribute)`);
    }
  }

  // ── Boneflame GY Pump ─────────────────────────────────────────────────────
  if (gyNames.includes("Boneflame Dragon") && hasFieldDragon) {
    available.push({
      name: "Boneflame GY Pump",
      priority: 6,
      action: { type: "graveyardMonsterEffect", cardName: "Boneflame Dragon" },
    });
    log(`💡 Combo: Boneflame Dragon GY ignition`);
  }

  // ── Extreme Dragon Awakening ──────────────────────────────────────────────
  const awakeningInHand = handNames.includes("Extreme Dragon Awakening");
  const awakeningFaceup = (analysis.spellTrap || []).some(
    (c) => !c.isFacedown && c.name === "Extreme Dragon Awakening"
  );
  const extremeInHand = analysis.hand.some((c) =>
    EXTREME_DRAGON_NAMES.includes(c.name)
  );
  const fieldDragonMons = analysis.field.filter(
    (c) => c.cardKind === "monster" && c.type === "Dragon"
  );
  const nonExtremeField = fieldDragonMons.filter(
    (c) => !EXTREME_DRAGON_NAMES.includes(c.name)
  );
  const hasExtremeFaceupField = fieldDragonMons.some((c) =>
    EXTREME_DRAGON_NAMES.includes(c.name)
  );

  if (
    awakeningInHand &&
    extremeInHand &&
    !hasExtremeFaceupField &&
    (nonExtremeField.length >= 2 ||
      handNames.some((n) =>
        ["Luminescent Dragon", "Hellkite Dragon", "Voltaic Dragon"].includes(n)
      ))
  ) {
    available.push({
      name: "Awakening Setup",
      priority: 11,
      action: { type: "spell", cardName: "Extreme Dragon Awakening" },
    });
    log(`💡 Combo: Awakening Setup`);
  }
  if (
    awakeningFaceup &&
    extremeInHand &&
    nonExtremeField.length >= 2 &&
    !hasExtremeFaceupField
  ) {
    available.push({
      name: "Awakening Ignition",
      priority: 13,
      action: { type: "spellTrapEffect", cardName: "Extreme Dragon Awakening" },
    });
    log(`🐉 Combo: Awakening Ignition → SS Extreme Dragon`);
  }

  return available;
}

/**
 * Returns combo by name.
 * @param {string} name
 * @returns {ComboDefinition|null}
 */
export function getComboByName(name) {
  return COMBO_DATABASE.find((c) => c.name === name) || null;
}
