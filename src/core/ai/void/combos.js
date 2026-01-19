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

// IDs das cartas Void
export const VOID_IDS = {
  CONJURER: 151,
  WALKER: 152,
  BEAST: 153,
  HOLLOW: 154,
  HAUNTER: 155,
  GHOST_WOLF: 156,
  HOLLOW_KING: 157, // Fusão
  BONE_SPIDER: 158,
  FORGOTTEN_KNIGHT: 159,
  RAVEN: 160,
  TENEBRIS_HORN: 161,
  SLAYER_BRUTE: 162,
  BERSERKER: 163, // Fusão
  SERPENT_DRAKE: 164,
  HYDRA_TITAN: 165, // Fusão
  SEALING: 166,
  THE_VOID: 167, // Field
  GRAVITATIONAL: 168,
  LOST_THRONE: 169,
  MIRROR_DIMENSION: 170,
  COSMIC_WALKER: 171, // Ascension
  POLYMERIZATION: 13,
};

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
      { action: "summon", cardId: 151, note: "Normal Summon Conjurer" },
      {
        action: "ignition",
        cardId: 151,
        note: "Conjurer recruta Walker do deck",
      },
      {
        action: "ignition",
        cardId: 152,
        note: "Walker volta à mão, Special Summon Hollow da mão",
      },
      {
        action: "trigger",
        cardId: 154,
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
      { action: "summon", cardId: 151, note: "Normal Summon Conjurer" },
      {
        action: "ignition",
        cardId: 151,
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
        cardId: 154,
        note: "Special Summon Hollow DA MÃO",
      },
      {
        action: "trigger",
        cardId: 154,
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
        cardId: 152,
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
        cardId: 152,
        note: "Walker volta à mão, Special Summon Hollow da mão",
      },
      {
        action: "trigger",
        cardId: 154,
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
    fusion: { target: 157, materials: [154, 154, 154] },
  },
  {
    name: "Berserker Fusion",
    description: "Slayer Brute (campo) + Void → Void Berserker",
    requires: ["Polymerization", "Void Slayer Brute no campo", "1 Void"],
    result: "Berserker 2800 ATK (2 ataques + bounce)",
    priority: 10.5,
    fusion: { target: 163, materials: [162, "any_void"] },
  },
  {
    name: "Hydra Titan Fusion",
    description: "6 Voids → Void Hydra Titan",
    requires: ["Polymerization", "6x Void (campo/mão)"],
    result: "Hydra Titan 3500 ATK (board clear + draw + resiliente)",
    priority: 12,
    fusion: {
      target: 165,
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
      { action: "handIgnition", cardId: 155, note: "Haunter tributa Hollow" },
      {
        action: "gyIgnition",
        cardId: 155,
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
        cardId: 164,
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
        cardId: 162,
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
      { action: "summon", cardId: 151 },
      { action: "ignition", cardId: 151 },
      { action: "trigger", cardId: 154 },
      { action: "handIgnition", cardId: 155 },
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
    name: "Lost Throne Reset",
    description: "Board clear deixando apenas o mais forte de cada lado",
    requires: [
      "Void Lost Throne",
      "Monstro forte próprio",
      "Oponente com múltiplos",
    ],
    result: "Remove múltiplas ameaças mantendo seu boss",
    priority: 8.5,
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
  const detected = [];

  const handIds = (hand || []).map((c) => c?.id).filter(Boolean);
  const fieldIds = (field || []).map((c) => c?.id).filter(Boolean);
  const gyIds = (graveyard || []).map((c) => c?.id).filter(Boolean);
  const extraIds = (extraDeck || []).map((c) => c?.id).filter(Boolean);

  const hasInHand = (id) => handIds.includes(id);
  const hasOnField = (id) => fieldIds.includes(id);
  const hasInGY = (id) => gyIds.includes(id);
  const hasInExtra = (id) => extraIds.includes(id);
  const countInHand = (id) => handIds.filter((i) => i === id).length;
  const countOnField = (id) => fieldIds.filter((i) => i === id).length;
  const countInGY = (id) => gyIds.filter((i) => i === id).length;
  const countVoidsOnField = () => (field || []).filter(isVoid).length;
  const countVoidsInHand = () => (hand || []).filter(isVoid).length;
  const countVoidsTotal = () => countVoidsOnField() + countVoidsInHand();
  const countHollowsTotal = () =>
    countInHand(VOID_IDS.HOLLOW) + countOnField(VOID_IDS.HOLLOW);
  const hasPoly = hasInHand(VOID_IDS.POLYMERIZATION);

  // ═══════════════════════════════════════════════════════════════════════════
  // Conjurer Walker Hollow Pipeline (MELHOR COMBO)
  // Conjurer → Walker do deck → Walker sobe e desce Hollow da mão → Hollow recruta
  // ═══════════════════════════════════════════════════════════════════════════
  if (
    hasInHand(VOID_IDS.CONJURER) &&
    hasInHand(VOID_IDS.HOLLOW) &&
    summonAvailable
  ) {
    detected.push({
      combo: COMBO_DATABASE.find(
        (c) => c.name === "Conjurer Walker Hollow Pipeline",
      ),
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
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Conjurer Basic"),
      ready: true,
      missing: [],
      priority: 8,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Walker into Hollow (Walker no campo + Hollow na mão)
  // Walker sobe, Hollow desce DA MÃO e recruta outro
  // ═══════════════════════════════════════════════════════════════════════════
  if (hasOnField(VOID_IDS.WALKER) && hasInHand(VOID_IDS.HOLLOW)) {
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Walker into Hollow"),
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
      detected.push({
        combo: COMBO_DATABASE.find((c) => c.name === "Walker Rotation"),
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
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Hollow Chain (da mão)"),
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
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Hollow King Fusion"),
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
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Berserker Fusion"),
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
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Hydra Titan Fusion"),
      ready: voidCount >= 6,
      missing: voidCount >= 6 ? [] : [`${6 - voidCount} Void(s) faltando`],
      priority: voidCount >= 6 ? 12 : 3,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Combos de Hand Ignition
  // ═══════════════════════════════════════════════════════════════════════════

  // Haunter
  if (hasInHand(VOID_IDS.HAUNTER) && countOnField(VOID_IDS.HOLLOW) >= 1) {
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Haunter Hollow Swarm"),
      ready: true,
      missing: [],
      priority: 9,
    });
  }

  // Serpent Drake
  if (hasInHand(VOID_IDS.SERPENT_DRAKE) && countOnField(VOID_IDS.HOLLOW) >= 1) {
    const hollowCount = countOnField(VOID_IDS.HOLLOW);
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Serpent Drake Power Up"),
      ready: true,
      missing: [],
      priority: 8.5 + hollowCount * 0.5, // Mais Hollows = mais bônus
    });
  }

  // Slayer Brute
  if (hasInHand(VOID_IDS.SLAYER_BRUTE) && countVoidsOnField() >= 2) {
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Slayer Brute Rush"),
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
    detected.push({
      combo: COMBO_DATABASE.find(
        (c) => c.name === "Conjurer to Haunter Pipeline",
      ),
      ready: true,
      missing: [],
      priority: 10.5,
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
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "The Void Recovery"),
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
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Sealing Extra Summon"),
      ready: hasExtraMonster,
      missing: hasExtraMonster ? [] : ["Monstro extra para invocar"],
      priority: hasExtraMonster ? 7 : 3,
    });
  }

  // Lost Throne
  if (hasInHand(VOID_IDS.LOST_THRONE)) {
    const oppFieldCount = analysis.oppFieldCount || 0;
    const myStrongest = Math.max(...(field || []).map((m) => m?.atk || 0), 0);
    const shouldUse = oppFieldCount >= 2 && myStrongest >= 2000;
    detected.push({
      combo: COMBO_DATABASE.find((c) => c.name === "Lost Throne Reset"),
      ready: shouldUse,
      missing: shouldUse ? [] : ["Condições não ideais"],
      priority: shouldUse ? 8.5 : 2,
    });
  }

  // Sort by priority
  return detected
    .filter((d) => d.combo)
    .sort((a, b) => b.priority - a.priority);
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
  const { oppFieldCount, oppStrongestAtk, myLP, oppLP } = analysis;

  switch (fusionId) {
    case VOID_IDS.HOLLOW_KING:
      // Bom se oponente tem campo moderado, valor na resiliência
      return 9 + (oppFieldCount >= 2 ? 1 : 0);

    case VOID_IDS.BERSERKER:
      // Excelente para OTK (2 ataques + bounce)
      const lethalPotential = oppLP <= 5600 ? 3 : 0; // 2800 x 2 = 5600
      return 10 + lethalPotential + (oppFieldCount >= 1 ? 1 : 0);

    case VOID_IDS.HYDRA_TITAN:
      // Maior fusão, sempre forte
      return 12 + (oppFieldCount >= 3 ? 2 : 0);

    default:
      return 5;
  }
}
