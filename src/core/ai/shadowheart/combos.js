// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/combos.js
// Database de combos e detecção para Shadow-Heart.
// ─────────────────────────────────────────────────────────────────────────────

import { isShadowHeartByName } from "./knowledge.js";

/**
 * Banco de dados de combos conhecidos do arquétipo Shadow-Heart.
 * @type {ComboDefinition[]}
 */
export const COMBO_DATABASE = [
  {
    name: "Imp Extender",
    description:
      "Imp → Special Summon Gecko/Specter → 2 corpos para tribute ou batalha",
    requires: ["Shadow-Heart Imp", "Shadow-Heart lv4 ou menor na mão"],
    result: "2 monstros no campo",
    priority: 8,
  },
  {
    name: "Specter Tribute Loop",
    description:
      "Tributa Specter para boss → Specter recupera outro Shadow-Heart do GY",
    requires: [
      "Shadow-Heart Specter no campo",
      "Shadow-Heart no GY",
      "boss na mão",
    ],
    result: "Boss no campo + carta na mão",
    priority: 9,
  },
  {
    name: "Infusion Value",
    description:
      "Descarta Specter/Coward para Infusion → Efeitos dos descartados ativam",
    requires: [
      "Shadow-Heart Infusion",
      "Specter ou Coward na mão",
      "Shadow-Heart no GY",
    ],
    result: "Revive + efeito bônus do descartado",
    priority: 8,
  },
  {
    name: "Demon Dragon Fusion",
    description:
      "Polymerization com Scale Dragon + material lv5+ → Destrói 2 cartas",
    requires: [
      "Polymerization",
      "Shadow-Heart Scale Dragon",
      "Shadow-Heart lv5+",
    ],
    result: "Demon Dragon 3000 ATK + 2 destruições",
    priority: 10,
  },
  {
    name: "Scale Dragon OTK",
    description: "Scale Dragon sozinho + Rage → 3700 ATK com 2 ataques",
    requires: [
      "Shadow-Heart Scale Dragon sozinho no campo",
      "Shadow-Heart Rage",
    ],
    result: "7400 dano potencial",
    priority: 10,
  },
  {
    name: "Griffin Comeback",
    description: "Campo vazio → Griffin sem tributo → 2000 ATK imediato",
    requires: ["Shadow-Heart Griffin", "campo próprio vazio"],
    result: "Presença de 2000 ATK sem custo",
    priority: 7,
  },
  {
    name: "Darkness Valley Setup",
    description:
      "Ativar Darkness Valley → Summon monstros Shadow-Heart → Bônus de ATK",
    requires: ["Darkness Valley", "monstros Shadow-Heart"],
    result: "+300 ATK por monstro",
    priority: 8,
  },
  {
    name: "Eel to Leviathan",
    description:
      "Summon Abyssal Eel → Ativar efeito ignition do Leviathan na mão → Enviar Eel ao GY → Special Summon Leviathan 2200 ATK",
    requires: [
      "Shadow-Heart Abyssal Eel no campo",
      "Shadow-Heart Leviathan na mão",
    ],
    result: "2200 ATK + burn effects imediato (sem usar Normal Summon extra)",
    priority: 9,
  },
];

/**
 * @typedef {Object} GameAnalysis
 * @property {Array} hand - Cartas na mão
 * @property {Array} field - Monstros no campo
 * @property {Array} graveyard - Cartas no cemitério
 * @property {string|null} fieldSpell - Field spell ativo
 * @property {boolean} canNormalSummon - Se pode normal summon
 */

/**
 * Detecta combos disponíveis com base na análise do estado.
 * @param {GameAnalysis} analysis
 * @param {Function} [logFn] - Função de log opcional
 * @returns {AvailableCombo[]}
 */
export function detectAvailableCombos(analysis, logFn = null) {
  const available = [];
  const handNames = analysis.hand.map((c) => c.name);
  const fieldNames = analysis.field.map((c) => c.name);
  const gyNames = analysis.graveyard.map((c) => c.name);

  const log = (msg) => {
    if (typeof logFn === "function") logFn(msg);
  };

  // Imp Extender
  if (handNames.includes("Shadow-Heart Imp") && analysis.canNormalSummon) {
    const targets = analysis.hand.filter(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.type === "monster" &&
        (c.level || 0) <= 4 &&
        c.name !== "Shadow-Heart Imp"
    );
    if (targets.length > 0) {
      available.push({
        name: "Imp Extender",
        priority: 8,
        action: { type: "summon", cardName: "Shadow-Heart Imp" },
      });
      log(`💡 Combo detectado: Imp Extender com ${targets[0].name}`);
    }
  }

  // Demon Dragon Fusion
  if (handNames.includes("Polymerization")) {
    const hasScaleDragon =
      fieldNames.includes("Shadow-Heart Scale Dragon") ||
      handNames.includes("Shadow-Heart Scale Dragon");
    const hasLv5Material = [...analysis.hand, ...analysis.field].some(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.type === "monster" &&
        (c.level || 0) >= 5 &&
        c.name !== "Shadow-Heart Scale Dragon"
    );

    if (hasScaleDragon && hasLv5Material) {
      available.push({
        name: "Demon Dragon Fusion",
        priority: 10,
        action: { type: "spell", cardName: "Polymerization" },
      });
      log(`🔥 Combo detectado: Fusion para Demon Dragon!`);
    }
  }

  // Scale Dragon OTK
  if (
    fieldNames.includes("Shadow-Heart Scale Dragon") &&
    analysis.field.length === 1 &&
    handNames.includes("Shadow-Heart Rage")
  ) {
    available.push({
      name: "Scale Dragon OTK",
      priority: 10,
      action: { type: "spell", cardName: "Shadow-Heart Rage" },
    });
    log(`🔥 Combo detectado: Scale Dragon OTK (3700 ATK x2)!`);
  }

  // Griffin Comeback
  if (
    handNames.includes("Shadow-Heart Griffin") &&
    analysis.field.length === 0 &&
    analysis.canNormalSummon
  ) {
    available.push({
      name: "Griffin Comeback",
      priority: 7,
      action: { type: "summon", cardName: "Shadow-Heart Griffin" },
    });
    log(`💡 Combo detectado: Griffin sem tributo`);
  }

  // Infusion Value
  if (
    handNames.includes("Shadow-Heart Infusion") &&
    analysis.hand.length >= 3 &&
    analysis.graveyard.some((c) => c.cardKind === "monster")
  ) {
    const hasValueDiscard =
      handNames.includes("Shadow-Heart Specter") ||
      handNames.includes("Shadow-Heart Coward");
    available.push({
      name: "Infusion Revival",
      priority: hasValueDiscard ? 8 : 6,
      action: { type: "spell", cardName: "Shadow-Heart Infusion" },
    });
    log(`💡 Combo detectado: Infusion ${hasValueDiscard ? "com valor extra" : ""}`);
  }

  // Darkness Valley Setup
  if (handNames.includes("Darkness Valley") && !analysis.fieldSpell) {
    available.push({
      name: "Darkness Valley Setup",
      priority: 8,
      action: { type: "spell", cardName: "Darkness Valley" },
    });
    log(`💡 Field Spell disponível: Darkness Valley`);
  }

  // Eel to Leviathan Combo
  // Leviathan na mão + Abyssal Eel no campo = pode ativar ignition da mão
  if (
    handNames.includes("Shadow-Heart Leviathan") &&
    fieldNames.includes("Shadow-Heart Abyssal Eel")
  ) {
    available.push({
      name: "Eel to Leviathan",
      priority: 9,
      action: { type: "handIgnition", cardName: "Shadow-Heart Leviathan" },
    });
    log(`🔥 Combo detectado: Eel → Leviathan (2200 ATK + burn)!`);
  }

  return available;
}

/**
 * Retorna combo por nome.
 * @param {string} name
 * @returns {ComboDefinition|null}
 */
export function getComboByName(name) {
  return COMBO_DATABASE.find((c) => c.name === name) || null;
}
