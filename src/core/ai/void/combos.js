// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/void/combos.js
// Database de combos e detecção para Void.
//
// FILOSOFIA DO ARQUÉTIPO VOID:
// - Swarm de Void Hollows para fusões ou tributos
// - Pipeline: Conjurer → Hollow → Haunter → Fusão/Boss
// - Fusões escalam com quantidade de materiais (Hydra = 6 Voids)
// - Ascension: Void Cosmic Walker (Void Walker com 2 ativações)
// ─────────────────────────────────────────────────────────────────────────────

import {
  isVoid,
  getVoidCardKnowledge,
  VOID_CARD_KNOWLEDGE,
} from "./knowledge.js";
import {
  countAcrossZones,
  countCardId,
  countMatching,
  createDetectedCombo,
  createZoneIndex,
  finalizeDetectedCombos,
  findComboByName,
  hasCardId,
} from "../common/comboDetection.js";

// IDs das cartas Void
export const VOID_IDS = {
  CONJURER: 201,
  WALKER: 202,
  BEAST: 203,
  HOLLOW: 204,
  HAUNTER: 205,
  GHOST_WOLF: 206,
  HOLLOW_KING: 207, // Fusão
  BONE_SPIDER: 208,
  FORGOTTEN_KNIGHT: 209,
  RAVEN: 210,
  TENEBRIS_HORN: 211,
  SLAYER_BRUTE: 212,
  BERSERKER: 213, // Fusão
  SERPENT_DRAKE: 214,
  HYDRA_TITAN: 215, // Fusão
  SEALING: 216,
  THE_VOID: 217, // Field
  GRAVITATIONAL: 218,
  LOST_THRONE: 219,
  MIRROR_DIMENSION: 220,
  COSMIC_WALKER: 222, // Ascension
  THOUSAND_ARMS: 221,
  MALICIOUS_DEMON: 223, // Ascension de Thousand-Arms
  ARCTURUS: 224, // Lord of the Void (boss máximo)
  FALLEN_ARCTURUS: 225, // Fusion from Arcturus in GY
  POLYMERIZATION: 12,
};

export function countControlledSpellTrapCards(player = {}) {
  const backrowCount = (player?.spellTrap || []).filter(
    (card) => card && (card.cardKind === "spell" || card.cardKind === "trap"),
  ).length;
  const fieldSpell = player?.fieldSpell || null;
  const fieldSpellCount =
    fieldSpell &&
    (fieldSpell.cardKind === "spell" || fieldSpell.cardKind === "trap")
      ? 1
      : 0;
  return backrowCount + fieldSpellCount;
}

function countOpponentSpellTrapCardsFromAnalysis(analysis = {}) {
  return countControlledSpellTrapCards({
    spellTrap: analysis.oppSpellTrap || analysis.opponent?.spellTrap || [],
    fieldSpell: analysis.oppFieldSpell || analysis.opponent?.fieldSpell || null,
  });
}

/**
 * Banco de dados de combos conhecidos do arquétipo Void.
 */
export const COMBO_DATABASE = [
  // ═══════════════════════════════════════════════════════════════════════════
  // COMBO PRINCIPAL: Pipeline de Swarm
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "Conjurer Walker Hollow Pipeline",
    description:
      "Conjurer → Walker do deck → Walker sobe pra mão e desce Hollow da mão → Hollow recruta do deck",
    requires: [
      "Void Conjurer na mão",
      "Void Hollow na mão",
      "Normal Summon disponível",
    ],
    result: "3 monstros no campo (Conjurer + 2 Hollows) + Walker na mão",
    priority: 11,
    sequence: [
      { action: "summon", cardId: 201, note: "Normal Summon Conjurer" },
      {
        action: "ignition",
        cardId: 201,
        note: "Conjurer recruta Walker do deck",
      },
      {
        action: "ignition",
        cardId: 202,
        note: "Walker volta à mão, Special Summon Hollow da mão",
      },
      {
        action: "trigger",
        cardId: 204,
        note: "Hollow (da mão) recruta outro Hollow do deck",
      },
    ],
  },
  {
    name: "Conjurer Basic",
    description: "Conjurer → recruta qualquer Void lv4- do deck",
    requires: ["Void Conjurer na mão", "Normal Summon disponível"],
    result: "2 monstros no campo (Conjurer + Void lv4-)",
    priority: 8,
    sequence: [
      { action: "summon", cardId: 201, note: "Normal Summon Conjurer" },
      {
        action: "ignition",
        cardId: 201,
        note: "Conjurer recruta Void do deck",
      },
    ],
  },
  {
    name: "Hollow Chain (da mão)",
    description:
      "Special Summon Hollow DA MÃO → recruta outro do deck. Hollow só ativa se vier da mão!",
    requires: [
      "Void Hollow na mão",
      "Forma de Special Summon (Walker/Conjurer efeito não conta!)",
    ],
    result: "2 Hollows no campo",
    priority: 9,
    sequence: [
      {
        action: "special",
        cardId: 204,
        note: "Special Summon Hollow DA MÃO",
      },
      {
        action: "trigger",
        cardId: 204,
        note: "Hollow recruta outro do deck",
      },
    ],
  },
  {
    name: "Walker Rotation",
    description:
      "Walker no campo → retorna à mão → Special Summon Void lv4- da mão",
    requires: ["Void Walker no campo", "Void lv4- na mão"],
    result: "Novo monstro no campo + Walker na mão para reusar",
    priority: 8,
    sequence: [
      {
        action: "ignition",
        cardId: 202,
        note: "Walker volta à mão e desce outro Void da mão",
      },
    ],
  },
  {
    name: "Walker into Hollow",
    description:
      "Walker no campo + Hollow na mão → Walker sobe, Hollow desce e recruta",
    requires: ["Void Walker no campo", "Void Hollow na mão"],
    result: "2 Hollows no campo + Walker na mão",
    priority: 9.5,
    sequence: [
      {
        action: "ignition",
        cardId: 202,
        note: "Walker volta à mão, Special Summon Hollow da mão",
      },
      {
        action: "trigger",
        cardId: 204,
        note: "Hollow (da mão) recruta outro Hollow do deck",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMBOS DE FUSÃO
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "Hollow King Fusion",
    description: "3 Hollows → Void Hollow King",
    requires: ["Polymerization", "3x Void Hollow (campo/mão)"],
    result: "Hollow King 2500 ATK (revive 3 Hollows se destruído)",
    priority: 9.5,
    fusion: { target: 207, materials: [204, 204, 204] },
  },
  {
    name: "Berserker Fusion",
    description: "Slayer Brute (campo) + Void → Void Berserker",
    requires: ["Polymerization", "Void Slayer Brute no campo", "1 Void"],
    result: "Berserker 2800 ATK (2 ataques + bounce)",
    priority: 10.5,
    fusion: { target: 213, materials: [212, "any_void"] },
  },
  {
    name: "Hydra Titan Fusion",
    description: "6 Voids → Void Hydra Titan",
    requires: ["Polymerization", "6x Void (campo/mão)"],
    result: "Hydra Titan 3500 ATK (backrow clear + draw + resiliente)",
    priority: 12,
    fusion: {
      target: 215,
      materials: ["void", "void", "void", "void", "void", "void"],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMBOS AVANÇADOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "Haunter Hollow Swarm",
    description:
      "Tributa Hollow → Summon Haunter → Banish Haunter do GY → Revive 3 Hollows",
    requires: ["Void Haunter na mão", "Void Hollow no campo", "Haunter no GY"],
    result: "Haunter 2100 ATK + potencial para 3 Hollows extras",
    priority: 9,
    sequence: [
      { action: "handIgnition", cardId: 205, note: "Haunter tributa Hollow" },
      {
        action: "gyIgnition",
        cardId: 205,
        note: "Banish Haunter para reviver Hollows",
      },
    ],
  },
  {
    name: "Serpent Drake Power Up",
    description: "Tributa 1-3 Hollows → Summon Serpent Drake com bônus",
    requires: ["Void Serpent Drake na mão", "1+ Void Hollow no campo"],
    result: "Serpent Drake 2300+ ATK (até indestrutível + destruição)",
    priority: 8.5,
    sequence: [
      {
        action: "handIgnition",
        cardId: 214,
        note: "Tributa Hollows para Serpent Drake",
      },
    ],
  },
  {
    name: "Slayer Brute Rush",
    description:
      "Tributa 2 Voids → Summon Slayer Brute 2500 ATK (banish removal)",
    requires: ["Void Slayer Brute na mão", "2 Voids no campo"],
    result: "Boss 2500 ATK que bane monstros destruídos",
    priority: 8,
    sequence: [
      {
        action: "handIgnition",
        cardId: 212,
        note: "Tributa 2 Voids para Slayer",
      },
    ],
  },
  {
    name: "Conjurer to Haunter Pipeline",
    description:
      "Conjurer → Hollow x2 → Tributa Hollow para Haunter → Campo cheio",
    requires: ["Void Conjurer", "Void Haunter na mão"],
    result: "Conjurer + Hollow + Haunter (3 monstros fortes)",
    priority: 10.5,
    sequence: [
      { action: "summon", cardId: 201 },
      { action: "ignition", cardId: 201 },
      { action: "trigger", cardId: 204 },
      { action: "handIgnition", cardId: 205 },
    ],
  },
  {
    name: "Forgotten Knight Removal",
    description:
      "Tributa Void do campo → Summon Knight → Banish para destruir S/T",
    requires: [
      "Void Forgotten Knight na mão",
      "Void no campo",
      "Knight no GY depois",
    ],
    result: "Knight 2000 ATK + destruição de spell/trap",
    priority: 7.5,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BOSSES SUPERIORES (Thousand-Arms, Arcturus, Malicious Demon)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "Thousand-Arms Hand-SS",
    description:
      "Tributa 1 Void do campo → Special Summon Thousand-Arms (2100 ATK) da mão",
    requires: ["Void Thousand-Arms na mão", "1 Void no campo"],
    result: "Boss 2100 ATK no campo + uma ativação de efeito do material registrada",
    priority: 8,
    sequence: [
      {
        action: "handIgnition",
        cardId: 221,
        note: "Tributa Void e desce Thousand-Arms da mão",
      },
    ],
  },
  {
    name: "Thousand-Arms Bounce-Revive",
    description:
      "Thousand-Arms no campo → bounce → revive até 2 Hollows do GY com +700 ATK/DEF",
    requires: ["Void Thousand-Arms no campo", "1+ Void Hollow no GY"],
    result: "Thousand-Arms na mão (reusável) + 2 Hollows fortalecidos no campo",
    priority: 9.5,
    sequence: [
      {
        action: "ignition",
        cardId: 221,
        note: "Bounce + revive 2 Hollows com +700",
      },
    ],
  },
  {
    name: "Arcturus Tribute Summon",
    description:
      "2 tributos → Arcturus 2800 ATK (lock de Battle Phase + ATK escala com Voids no GY se for único monstro)",
    requires: ["Arcturus na mão", "2 monstros para tributar", "Voids no GY (recomendado)"],
    result:
      "Lord of the Void no campo: oponente não ativa nada na BP + survival via banish 2 Voids do GY",
    priority: 11,
    sequence: [
      { action: "summon", cardId: 224, note: "Tributa 2 monstros para Arcturus" },
    ],
  },
  {
    name: "Malicious Demon Ascension",
    description:
      "Thousand-Arms no campo (com 2 ativações de efeito) → ascende para Malicious Demon",
    requires: ["Thousand-Arms no campo com 2+ ativações de efeito"],
    result:
      "Boss 2600 ATK com ataques múltiplos por Hollow no GY",
    priority: 11,
  },
  {
    name: "Malicious Demon Death Loop",
    description:
      "Malicious Demon morre → revive até 3 Hollows do GY + busca Polymerization do deck",
    requires: ["Malicious Demon no campo", "Hollows no GY", "Poly no deck"],
    result: "3 Hollows extras + Poly na mão (habilita refusão Hollow King/Hydra Titan)",
    priority: 9.5,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMBOS DE SPELL
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "The Void Recovery",
    description: "Campo vazio → Field Spell revive Void lv4-",
    requires: ["The Void (field spell)", "Campo vazio", "Void no GY"],
    result: "Presença imediata sem custo de mão",
    priority: 8,
  },
  {
    name: "Sealing Extra Summon",
    description: "Nega stats de um Void → Ganha normal summon extra",
    requires: [
      "Sealing the Void",
      "Void face-up",
      "Outro monstro para invocar",
    ],
    result: "2 Normal Summons no turno",
    priority: 7,
  },
  {
    name: "Lost Throne Starter",
    description:
      "Campo vazio -> busca Void Hollow e pode Invocar da mao para abrir swarm",
    requires: ["Void Lost Throne", "Campo vazio", "Void Hollow no deck"],
    result: "Void Hollow no campo com trigger normal de Special Summon da mao",
    priority: 8.8,
  },
  {
    name: "Beast Search Hollow",
    description: "Void Beast busca Void Hollow como starter secundario",
    requires: ["Void Beast na mao", "Normal Summon disponivel", "Void Hollow no deck"],
    result: "Acesso a Hollow para uma ponte de Special Summon futura",
    priority: 7.8,
    sequence: [
      { action: "summon", cardId: 203, note: "Normal Summon Void Beast" },
      { action: "trigger", cardId: 203, note: "Beast busca Void Hollow" },
    ],
  },
  {
    name: "Conjurer Graveyard Reloop",
    description:
      "Tributa corpo Void barato para reviver Conjurer e abrir outro recruit",
    requires: ["Void Conjurer no GY", "Void descartavel no campo"],
    result: "Conjurer volta como engine/material se ha follow-up claro",
    priority: 9.4,
  },
  {
    name: "Cosmic Walker Hollow Reclaimer",
    description: "Cosmic Walker revive Void Hollow do GY",
    requires: ["Void Cosmic Walker no campo", "Void Hollow no GY"],
    result: "Hollow volta como corpo de custo/material/pressao",
    priority: 9,
  },
  {
    name: "Forgotten Knight Hollow Scaling",
    description:
      "Forgotten Knight ganha valor quando Hollows ficam no cemiterio",
    requires: ["Void Forgotten Knight acessivel", "Void Hollow no GY"],
    result: "Corpo intermediario que pode superar combate pelo scaling",
    priority: 8.6,
  },
  {
    name: "Arcturus Solo Battle Lock",
    description:
      "Arcturus entra sozinho ou quase sozinho para escalar com Voids no GY",
    requires: ["Arcturus na mao", "2 tributos", "Voids no GY"],
    result: "Finalizador solo com lock de Battle Phase",
    priority: 9.5,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ASCENSION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "Cosmic Walker Ascension",
    description: "Void Walker com 2 ativações → Ascende para Cosmic Walker",
    requires: ["Void Walker com 2+ ativações no campo"],
    result: "Cosmic Walker 2100 ATK (swarm engine + death trigger)",
    priority: 9,
  },
];

/**
 * Detecta combos disponíveis no estado atual do jogo.
 * @param {Object} analysis - Estado analisado (hand, field, graveyard, etc.)
 * @returns {Array<{combo: Object, ready: boolean, missing: string[]}>}
 */
export function detectAvailableCombos(analysis) {
  const { hand, field, graveyard, extraDeck, fieldSpell, summonAvailable } =
    analysis;
  const deck = analysis.deck || [];
  const detected = [];

  const zoneIndex = createZoneIndex({
    hand,
    field,
    graveyard,
    deck,
    extraDeck,
  });
  const hasInHand = (id) => hasCardId(zoneIndex, "hand", id);
  const hasOnField = (id) => hasCardId(zoneIndex, "field", id);
  const hasInGY = (id) => hasCardId(zoneIndex, "graveyard", id);
  const hasInDeck = (id) => hasCardId(zoneIndex, "deck", id);
  const hasInExtra = (id) => hasCardId(zoneIndex, "extraDeck", id);
  const countInHand = (id) => countCardId(zoneIndex, "hand", id);
  const countOnField = (id) => countCardId(zoneIndex, "field", id);
  const countInGY = (id) => countCardId(zoneIndex, "graveyard", id);
  const countVoidsOnField = () => countMatching(zoneIndex, "field", isVoid);
  const countVoidsInHand = () => countMatching(zoneIndex, "hand", isVoid);
  const countVoidsTotal = () =>
    countAcrossZones(zoneIndex, ["field", "hand"], isVoid);
  const countVoidsInGY = () => countMatching(zoneIndex, "graveyard", isVoid);
  const countHollowsTotal = () =>
    countInHand(VOID_IDS.HOLLOW) + countOnField(VOID_IDS.HOLLOW);
  const hasPoly = hasInHand(VOID_IDS.POLYMERIZATION);
  const comboByName = (name) => findComboByName(COMBO_DATABASE, name);
  const addCombo = (name, details) => {
    detected.push(
      createDetectedCombo({
        combo: comboByName(name),
        ...details,
      }),
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Conjurer Walker Hollow Pipeline (MELHOR COMBO)
  // Conjurer → Walker do deck → Walker sobe e desce Hollow da mão → Hollow recruta
  // ═══════════════════════════════════════════════════════════════════════════
  if (
    hasInHand(VOID_IDS.CONJURER) &&
    hasInHand(VOID_IDS.HOLLOW) &&
    summonAvailable
  ) {
    addCombo("Conjurer Walker Hollow Pipeline", {
      ready: true,
      missing: [],
      priority: 11, // Máxima prioridade - 3 corpos + Walker na mão
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Conjurer Basic (só Conjurer, sem Hollow na mão)
  // ═══════════════════════════════════════════════════════════════════════════
  if (
    hasInHand(VOID_IDS.CONJURER) &&
    !hasInHand(VOID_IDS.HOLLOW) &&
    summonAvailable
  ) {
    addCombo("Conjurer Basic", {
      ready: true,
      missing: [],
      priority: 8,
    });
  }

  // Beast Search Hollow (starter secundario quando Conjurer/Lost Throne nao lideram)
  if (
    hasInHand(VOID_IDS.BEAST) &&
    summonAvailable &&
    !hasInHand(VOID_IDS.HOLLOW) &&
    hasInDeck(VOID_IDS.HOLLOW)
  ) {
    addCombo("Beast Search Hollow", {
      ready: true,
      missing: [],
      priority: 7.8,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Walker into Hollow (Walker no campo + Hollow na mão)
  // Walker sobe, Hollow desce DA MÃO e recruta outro
  // ═══════════════════════════════════════════════════════════════════════════
  if (hasOnField(VOID_IDS.WALKER) && hasInHand(VOID_IDS.HOLLOW)) {
    addCombo("Walker into Hollow", {
      ready: true,
      missing: [],
      priority: 9.5, // Muito bom - ganha 2 Hollows + Walker na mão
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Walker Rotation (Walker no campo + outro Void lv4- na mão, MAS NÃO Hollow)
  // Se tem Hollow, prefere Walker into Hollow
  // ═══════════════════════════════════════════════════════════════════════════
  if (hasOnField(VOID_IDS.WALKER) && !hasInHand(VOID_IDS.HOLLOW)) {
    const hasOtherVoidToSummon = (hand || []).some(
      (c) =>
        isVoid(c) &&
        c.id !== VOID_IDS.WALKER &&
        c.id !== VOID_IDS.HOLLOW &&
        (c.level || 0) <= 4,
    );
    if (hasOtherVoidToSummon) {
      addCombo("Walker Rotation", {
        ready: true,
        missing: [],
        priority: 8,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Hollow Chain (Hollow na mão + forma de special summon que não seja Conjurer)
  // IMPORTANTE: Conjurer recruta do DECK, então Hollow vindo do Conjurer NÃO ativa
  // Walker é a forma principal de descer Hollow da mão
  // ═══════════════════════════════════════════════════════════════════════════
  if (hasInHand(VOID_IDS.HOLLOW)) {
    // Walker no campo pode descer Hollow da mão
    const canSpecialHollowFromHand = hasOnField(VOID_IDS.WALKER);
    // Haunter no GY pode reviver Hollow, MAS isso não é "da mão"
    // Então só Walker conta aqui
    addCombo("Hollow Chain (da mão)", {
      ready: canSpecialHollowFromHand,
      missing: canSpecialHollowFromHand
        ? []
        : ["Walker no campo para descer Hollow da mão"],
      priority: canSpecialHollowFromHand ? 9 : 3,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FUSÕES
  // ═══════════════════════════════════════════════════════════════════════════

  // Hollow King (3 Hollows)
  if (hasPoly && hasInExtra(VOID_IDS.HOLLOW_KING)) {
    const hollowCount = countHollowsTotal();
    addCombo("Hollow King Fusion", {
      ready: hollowCount >= 3,
      missing:
        hollowCount >= 3 ? [] : [`${3 - hollowCount} Hollow(s) faltando`],
      priority: hollowCount >= 3 ? 9.5 : 4,
    });
  }

  // Berserker (Slayer no campo + Void)
  if (hasPoly && hasInExtra(VOID_IDS.BERSERKER)) {
    const slayerOnField = hasOnField(VOID_IDS.SLAYER_BRUTE);
    const hasOtherVoid = countVoidsTotal() >= (slayerOnField ? 2 : 1);
    addCombo("Berserker Fusion", {
      ready: slayerOnField && hasOtherVoid,
      missing: slayerOnField
        ? hasOtherVoid
          ? []
          : ["Outro Void"]
        : ["Slayer Brute no campo"],
      priority: slayerOnField && hasOtherVoid ? 10.5 : 5,
    });
  }

  // Hydra Titan (6 Voids)
  if (hasPoly && hasInExtra(VOID_IDS.HYDRA_TITAN)) {
    const voidCount = countVoidsTotal();
    const fieldVoidCount = countVoidsOnField();
    const handVoidCount = countVoidsInHand();
    const fieldMonsterCount = (field || []).filter(
      (card) => card?.cardKind === "monster",
    ).length;
    const fieldMaterialsNeeded = Math.max(0, 6 - handVoidCount);
    const projectedDraws = Math.max(
      0,
      fieldMonsterCount - Math.min(fieldMaterialsNeeded, fieldVoidCount),
    );
    const ravenInHand = hasInHand(VOID_IDS.RAVEN);
    addCombo("Hydra Titan Fusion", {
      ready: voidCount >= 6,
      missing: voidCount >= 6 ? [] : [`${6 - voidCount} Void(s) faltando`],
      priority:
        voidCount >= 6
          ? 8.8 + Math.min(projectedDraws, 2) * 0.9 + (ravenInHand ? 0.7 : 0)
          : 3,
      projectedDraws,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Combos de Hand Ignition
  // ═══════════════════════════════════════════════════════════════════════════

  // Haunter
  if (hasInHand(VOID_IDS.HAUNTER) && countOnField(VOID_IDS.HOLLOW) >= 1) {
    addCombo("Haunter Hollow Swarm", {
      ready: true,
      missing: [],
      priority: 9,
    });
  }

  // Serpent Drake
  if (hasInHand(VOID_IDS.SERPENT_DRAKE) && countOnField(VOID_IDS.HOLLOW) >= 1) {
    const hollowCount = countOnField(VOID_IDS.HOLLOW);
    addCombo("Serpent Drake Power Up", {
      ready: true,
      missing: [],
      priority: 8.5 + hollowCount * 0.5, // Mais Hollows = mais bônus
    });
  }

  // Slayer Brute
  if (hasInHand(VOID_IDS.SLAYER_BRUTE) && countVoidsOnField() >= 2) {
    addCombo("Slayer Brute Rush", {
      ready: true,
      missing: [],
      priority: 8,
    });
  }

  // Conjurer to Haunter Pipeline (combo completo)
  if (
    hasInHand(VOID_IDS.CONJURER) &&
    hasInHand(VOID_IDS.HAUNTER) &&
    summonAvailable
  ) {
    addCombo("Conjurer to Haunter Pipeline", {
      ready: true,
      missing: [],
      priority: 10.5,
    });
  }

  // Conjurer GY reloop: so sinalizar alto se ha follow-up real no deck.
  if (hasInGY(VOID_IDS.CONJURER) && countVoidsOnField() >= 1) {
    const hasRecruitTarget = (deck || []).some(
      (card) => isVoid(card) && card?.cardKind === "monster" && (card.level || 0) <= 4,
    );
    const highPayoff =
      hasRecruitTarget &&
      (hasInHand(VOID_IDS.HOLLOW) ||
        hasPoly ||
        hasInHand(VOID_IDS.SLAYER_BRUTE) ||
        hasInHand(VOID_IDS.SERPENT_DRAKE));
    addCombo("Conjurer Graveyard Reloop", {
      ready: hasRecruitTarget,
      missing: hasRecruitTarget ? [] : ["Void lv4- no deck para recrutar"],
      priority: highPayoff ? 9.4 : 8.2,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOSSES SUPERIORES
  // ═══════════════════════════════════════════════════════════════════════════

  // Thousand-Arms Hand-SS (precisa 1 Void no campo para tributar)
  if (hasInHand(VOID_IDS.THOUSAND_ARMS) && countVoidsOnField() >= 1) {
    addCombo("Thousand-Arms Hand-SS", {
      ready: true,
      missing: [],
      priority: 8,
    });
  }

  // Thousand-Arms Bounce-Revive (Thousand-Arms no campo + Hollow no GY)
  if (hasOnField(VOID_IDS.THOUSAND_ARMS) && countInGY(VOID_IDS.HOLLOW) >= 1) {
    const hollowsAvail = Math.min(countInGY(VOID_IDS.HOLLOW), 2);
    addCombo("Thousand-Arms Bounce-Revive", {
      ready: true,
      missing: [],
      priority: 8.5 + hollowsAvail * 0.5, // +0.5 por Hollow revivido
    });
  }

  if (hasOnField(VOID_IDS.COSMIC_WALKER)) {
    const hollowsInGY = countInGY(VOID_IDS.HOLLOW);
    addCombo("Cosmic Walker Hollow Reclaimer", {
      ready: hollowsInGY >= 1,
      missing: hollowsInGY >= 1 ? [] : ["Void Hollow no GY"],
      priority: hollowsInGY >= 1 ? 8.0 + Math.min(hollowsInGY, 2) * 0.5 : 6.0,
    });
  }

  // Arcturus Tribute Summon (precisa 2 monstros no campo + Normal Summon disponível)
  if (hasInHand(VOID_IDS.ARCTURUS) && summonAvailable) {
    const monstersOnField = (field || []).filter(
      (m) => m && m.cardKind === "monster",
    ).length;
    const ready = monstersOnField >= 2;
    const voidsInGY = countVoidsInGY();
    const projectedVoidsInGY = voidsInGY + Math.min(monstersOnField, 2);
    const canBeSolo = monstersOnField <= 2;
    addCombo("Arcturus Tribute Summon", {
      ready,
      missing: ready
        ? []
        : [`${2 - monstersOnField} monstro(s) para tributar`],
      // Boost por Voids no GY (cada par = uma "vida extra" via replacementEffect)
      priority:
        ready
          ? (canBeSolo ? 8.7 : 7.6) + Math.min(projectedVoidsInGY, 6) * 0.35
          : 4,
    });
  }

  if (
    hasInHand(VOID_IDS.ARCTURUS) &&
    summonAvailable &&
    countVoidsInGY() + Math.min(countVoidsOnField(), 2) >= 3
  ) {
    const monstersOnField = (field || []).filter(
      (m) => m && m.cardKind === "monster",
    ).length;
    addCombo("Arcturus Solo Battle Lock", {
      ready: monstersOnField >= 2,
      missing: monstersOnField >= 2 ? [] : ["2 tributos para Arcturus"],
      priority:
        monstersOnField >= 2
          ? 8.5 + Math.min(countVoidsInGY() + 2, 6) * 0.35
          : 4,
    });
  }

  // Malicious Demon Ascension (Thousand-Arms no campo + Demon no extra)
  // A checagem de "2 ativações" é feita downstream via game.checkAscensionRequirements;
  // aqui sinalizamos interesse no combo quando o material está em jogo.
  if (
    hasOnField(VOID_IDS.THOUSAND_ARMS) &&
    hasInExtra(VOID_IDS.MALICIOUS_DEMON)
  ) {
    const hollowsInGY = countInGY(VOID_IDS.HOLLOW);
    addCombo("Malicious Demon Ascension", {
      ready: true,
      missing: [],
      // Quanto mais Hollows no GY, mais ataques Malicious Demon faz
      priority:
        hollowsInGY >= 3
          ? 9.2 + Math.min(hollowsInGY, 4) * 0.5
          : hollowsInGY >= 2
            ? 7.5
            : 4.5,
    });
  }

  if (
    (hasOnField(VOID_IDS.FORGOTTEN_KNIGHT) ||
      hasInHand(VOID_IDS.FORGOTTEN_KNIGHT)) &&
    countInGY(VOID_IDS.HOLLOW) >= 1
  ) {
    const hollowsInGY = countInGY(VOID_IDS.HOLLOW);
    const projectedAtk = 2000 + hollowsInGY * 200;
    const beatsThreat =
      (analysis.oppStrongestAtk || 0) <= 0 || projectedAtk > analysis.oppStrongestAtk;
    addCombo("Forgotten Knight Hollow Scaling", {
      ready: true,
      missing: [],
      priority: (beatsThreat ? 8.6 : 7.5) + Math.min(hollowsInGY, 3) * 0.2,
      projectedAtk,
    });
  }

  // Malicious Demon Death Loop (Demon no campo + Hollows no GY)
  if (
    hasOnField(VOID_IDS.MALICIOUS_DEMON) &&
    countInGY(VOID_IDS.HOLLOW) >= 1
  ) {
    addCombo("Malicious Demon Death Loop", {
      ready: true,
      missing: [],
      priority: 8.5,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Combos de Spell
  // ═══════════════════════════════════════════════════════════════════════════

  // The Void (field spell)
  if (hasInHand(VOID_IDS.THE_VOID) && (field || []).length === 0) {
    const hasVoidInGY = (graveyard || []).some(
      (c) => isVoid(c) && (c.level || 0) <= 4,
    );
    addCombo("The Void Recovery", {
      ready: hasVoidInGY,
      missing: hasVoidInGY ? [] : ["Void lv4- no GY"],
      priority: hasVoidInGY ? 8 : 4,
    });
  }

  // Sealing the Void
  if (
    hasInHand(VOID_IDS.SEALING) &&
    countVoidsOnField() >= 1 &&
    summonAvailable
  ) {
    const hasExtraMonster =
      (hand || []).filter((c) => c?.cardKind === "monster").length >= 2;
    addCombo("Sealing Extra Summon", {
      ready: hasExtraMonster,
      missing: hasExtraMonster ? [] : ["Monstro extra para invocar"],
      priority: hasExtraMonster ? 7 : 3,
    });
  }

  // Lost Throne
  if (hasInHand(VOID_IDS.LOST_THRONE)) {
    const fieldEmpty = (field || []).length === 0;
    const deck = analysis.deck || [];
    const searchableVoid = deck.some(
      (c) => isVoid(c) && c?.cardKind === "monster" && (c.atk || 0) <= 1600,
    );
    const hasHollowTarget = deck.some((c) => c?.id === VOID_IDS.HOLLOW);
    const shouldUse = fieldEmpty && searchableVoid;
    addCombo("Lost Throne Starter", {
      ready: shouldUse,
      missing: shouldUse
        ? []
        : [
            fieldEmpty ? "Void <=1600 ATK no deck" : "Campo vazio",
            hasHollowTarget ? null : "Void Hollow no deck",
          ].filter(Boolean),
      priority: shouldUse ? (hasHollowTarget ? 8.8 : 7.2) : 2,
    });
  }

  // Sort by priority
  return finalizeDetectedCombos(detected);
}

/**
 * Determina a melhor sequência de ações para executar um combo.
 * @param {Object} combo - Combo detectado
 * @param {Object} analysis - Estado do jogo
 * @returns {Array<Object>} - Lista de ações ordenadas
 */
export function getComboSequence(combo, analysis) {
  if (!combo?.combo?.sequence) return [];

  return combo.combo.sequence.map((step) => ({
    ...step,
    enabled: true, // Pode ser refinado com checks de disponibilidade
  }));
}

/**
 * Calcula o valor de fazer uma fusão específica.
 * @param {number} fusionId - ID da carta de fusão
 * @param {Object} analysis - Estado do jogo
 * @returns {number} - Valor estimado
 */
export function calculateFusionValue(fusionId, analysis) {
  const { oppFieldCount, oppLP } = analysis;

  // Sinergias compartilhadas
  const field = analysis.field || [];
  const hand = analysis.hand || [];
  const fieldIds = (analysis.field || []).map((c) => c?.id).filter(Boolean);
  const handIds = (analysis.hand || []).map((c) => c?.id).filter(Boolean);
  const tenebrisOnField = fieldIds.includes(VOID_IDS.TENEBRIS_HORN);
  const ravenInHand = handIds.includes(VOID_IDS.RAVEN);
  const projectedHydraDraws = countOpponentSpellTrapCardsFromAnalysis(analysis);

  // Tenebris Horn passive: +100 ATK/DEF por Void no campo (incluindo a fusão)
  const tenebrisBonus = tenebrisOnField ? 0.6 : 0;
  // Raven discard pós-fusão: imunidade por 1 turno (S-tier para fusões grandes)
  const ravenBonus = ravenInHand ? 0.8 : 0;

  switch (fusionId) {
    case VOID_IDS.HOLLOW_KING:
      // Bom se oponente tem campo moderado, valor na resiliência
      return (
        8.2 + (oppFieldCount >= 2 ? 0.8 : 0) + tenebrisBonus + ravenBonus * 0.5
      );

    case VOID_IDS.BERSERKER: {
      // Excelente para OTK (2 ataques + bounce)
      const lethalPotential = oppLP <= 5600 ? 3 : 0; // 2800 x 2 = 5600
      return (
        10.2 +
        lethalPotential +
        (oppFieldCount >= 1 ? 0.9 : 0) +
        tenebrisBonus +
        ravenBonus * 0.6
      );
    }

    case VOID_IDS.HYDRA_TITAN: {
      // Hydra removes opponent backrow on summon and converts each real
      // destruction into draw pressure. Raven remains excellent protection.
      return (
        8.2 +
        Math.min(projectedHydraDraws, 2) * 1.0 +
        (oppFieldCount >= 3 ? 1.2 : 0) +
        (projectedHydraDraws <= 0 && oppFieldCount < 2 ? -1.1 : 0) +
        ravenBonus * 1.5 // Raven vale mais para Hydra (3500 ATK protegido)
      );
    }

    default:
      return 5 + tenebrisBonus + ravenBonus;
  }
}
