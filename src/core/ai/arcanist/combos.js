import {
  ARCANIST_NAMES,
  controlsArcanistEquip,
  hasArcanistEquip,
  isArcanistMonster,
  isArcanistSpell,
} from "./knowledge.js";

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function pushCombo(combos, combo) {
  combos.push({
    available: true,
    ...combo,
  });
}

export const COMBO_DATABASE = [
  {
    id: "apprentice_library_grimoire",
    name: "Apprentice -> Library -> Grimoire",
    priority: 15,
  },
  {
    id: "library_empty_field_recruit",
    name: "Grand Library starter recruit",
    priority: 13,
  },
  {
    id: "grimoire_azrath_halve",
    name: "Grimoire on Azrath",
    priority: 14,
  },
  {
    id: "ink_river_spell_loop",
    name: "Ink River spell loop",
    priority: 10,
  },
];

export function detectAvailableCombos(analysis = {}) {
  const combos = [];
  const hand = analysis.hand || [];
  const field = analysis.field || [];
  const graveyard = analysis.graveyard || [];
  const spellTrap = analysis.spellTrap || [];
  const oppField = analysis.oppField || [];

  const hasApprentice = hasName(hand, ARCANIST_NAMES.APPRENTICE);
  const hasLibraryInHand = hasName(hand, ARCANIST_NAMES.GRAND_LIBRARY);
  const hasGrimoireInHand = hasName(hand, ARCANIST_NAMES.GRIMOIRE);
  const hasLibraryActive =
    analysis.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY;
  const hasFaceUpArcanist = field.some(
    (card) => isArcanistMonster(card) && !card.isFacedown,
  );
  const hasEquippedArcanist = field.some(
    (card) => isArcanistMonster(card) && !card.isFacedown && hasArcanistEquip(card),
  );

  if (hasApprentice && !hasLibraryActive) {
    pushCombo(combos, {
      id: "apprentice_library_grimoire",
      name: "Apprentice -> Library -> Grimoire",
      priority: hasLibraryInHand || hasGrimoireInHand ? 16 : 14,
      cards: [
        ARCANIST_NAMES.APPRENTICE,
        hasLibraryInHand ? ARCANIST_NAMES.GRAND_LIBRARY : "Arcanist Spell search",
        hasGrimoireInHand ? ARCANIST_NAMES.GRIMOIRE : "Equip search",
      ],
      description: "Normal Summon Apprentice to assemble Library or Grimoire.",
    });
  }

  if (hasLibraryInHand && !hasFaceUpArcanist) {
    pushCombo(combos, {
      id: "library_empty_field_recruit",
      name: "Grand Library starter recruit",
      priority: 13,
      cards: [ARCANIST_NAMES.GRAND_LIBRARY],
      description: "Use Grand Library to pay 2000 LP and recruit a Lv4- Arcanist.",
    });
  }

  const azrathField = field.find(
    (card) => card?.name === ARCANIST_NAMES.AZRATH && !card.isFacedown,
  );
  if (azrathField && (hasGrimoireInHand || hasArcanistEquip(azrathField))) {
    pushCombo(combos, {
      id: "grimoire_azrath_halve",
      name: "Grimoire on Azrath",
      priority: oppField.length > 0 ? 15 : 9,
      cards: [ARCANIST_NAMES.AZRATH, ARCANIST_NAMES.GRIMOIRE],
      description: "Equip Azrath to halve the opponent's best monster.",
    });
  }

  const inkRiver = spellTrap.find(
    (card) => card?.name === ARCANIST_NAMES.INK_RIVER && !card.isFacedown,
  );
  const recoverableSpells = graveyard.filter(isArcanistSpell).length;
  if (inkRiver && recoverableSpells > 0) {
    const counters =
      inkRiver.counters instanceof Map
        ? inkRiver.counters.get("ink") || 0
        : inkRiver.counters?.ink || 0;
    if (counters >= 2) {
      pushCombo(combos, {
        id: "ink_river_spell_loop",
        name: "Ink River spell loop",
        priority: 10,
        cards: [ARCANIST_NAMES.INK_RIVER],
        description: "Remove 2 Ink counters to recover a spent Arcanist spell.",
      });
    }
  }

  if (
    hasName(hand, ARCANIST_NAMES.SEISMIC_IMPACT) &&
    hasEquippedArcanist &&
    controlsArcanistEquip(analysis.player) &&
    (analysis.oppField || []).length +
      (analysis.oppSpellTrap || []).length +
      (analysis.oppFieldSpell ? 1 : 0) >
      0
  ) {
    pushCombo(combos, {
      id: "equipped_seismic_banish",
      name: "Equipped Seismic banish",
      priority: 13,
      cards: [ARCANIST_NAMES.SEISMIC_IMPACT],
      description: "Spend an Arcanist Equip to let Seismic Impact banish.",
    });
  }

  return combos.sort((a, b) => b.priority - a.priority);
}
