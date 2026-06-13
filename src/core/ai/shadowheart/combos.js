// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/combos.js
// Database de combos e detecção para Shadow-Heart.
// ─────────────────────────────────────────────────────────────────────────────

import { isShadowHeartByName } from "./knowledge.js";
import {
  createAvailableCombo,
  createZoneIndex,
  findComboByName,
  getZoneCards,
  hasCardName,
  hasCardNameInZones,
} from "../common/comboDetection.js";

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
    name: "Shadow-Heart Dragon Rage Push",
    description: "Dragao Shadow-Heart + Rage -> +700 ATK/DEF com 2 ataques",
    requires: [
      "Dragao Shadow-Heart no campo",
      "Shadow-Heart Rage",
    ],
    result: "pressao de batalha com segundo ataque",
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
  const zoneIndex = createZoneIndex(analysis);
  const hand = getZoneCards(zoneIndex, "hand");
  const field = getZoneCards(zoneIndex, "field");
  const graveyard = getZoneCards(zoneIndex, "graveyard");
  const handAndField = [...hand, ...field];

  const hasInHand = (name) => hasCardName(zoneIndex, "hand", name);
  const hasOnField = (name) => hasCardName(zoneIndex, "field", name);
  const hasInHandOrField = (name) =>
    hasCardNameInZones(zoneIndex, ["hand", "field"], name);
  const comboByName = (name) => findComboByName(COMBO_DATABASE, name);

  const log = (msg) => {
    if (typeof logFn === "function") logFn(msg);
  };
  const addCombo = (name, details = {}) => {
    const { logMessage, ...comboDetails } = details;
    available.push(
      createAvailableCombo({
        combo: comboByName(name),
        name,
        ...comboDetails,
      }),
    );
    if (logMessage) log(logMessage);
  };

  // Imp Extender
  if (hasInHand("Shadow-Heart Imp") && analysis.canNormalSummon) {
    const targets = hand.filter(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.type === "monster" &&
        (c.level || 0) <= 4 &&
        c.name !== "Shadow-Heart Imp",
    );
    if (targets.length > 0) {
      addCombo("Imp Extender", {
        priority: 8,
        action: { type: "summon", cardName: "Shadow-Heart Imp" },
        logMessage: `Combo detectado: Imp Extender com ${targets[0].name}`,
      });
    }
  }

  // Demon Dragon Fusion
  if (hasInHand("Polymerization")) {
    const hasScaleDragon = hasInHandOrField("Shadow-Heart Scale Dragon");
    const hasLv5Material = handAndField.some(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.cardKind === "monster" &&
        (c.level || 0) >= 5 &&
        c.name !== "Shadow-Heart Scale Dragon",
    );

    if (hasScaleDragon && hasLv5Material) {
      addCombo("Demon Dragon Fusion", {
        priority: 10,
        action: { type: "spell", cardName: "Polymerization" },
        logMessage: "Combo detectado: Fusion para Demon Dragon!",
      });
    } else {
      // Warlord Fusion (fallback): 2 quaisquer Shadow-Heart
      const shCount = handAndField.filter(
        (c) => isShadowHeartByName(c.name) && c.cardKind === "monster",
      ).length;
      if (shCount >= 2) {
        addCombo("Warlord Fusion", {
          priority: 8,
          action: { type: "spell", cardName: "Polymerization" },
          logMessage: `Combo detectado: Fusion para Warlord (${shCount} SH disponiveis)`,
        });
      }
    }
  }

  // Shadow-Heart Dragon Rage push
  if (
    field.some(
      (card) =>
        card &&
        card.cardKind === "monster" &&
        !card.isFacedown &&
        card.type === "Dragon" &&
        isShadowHeartByName(card.name),
    ) &&
    hasInHand("Shadow-Heart Rage")
  ) {
    addCombo("Shadow-Heart Dragon Rage Push", {
      priority: 10,
      action: { type: "spell", cardName: "Shadow-Heart Rage" },
      logMessage: "Combo detectado: Rage em Dragao Shadow-Heart (+700 e 2 ataques)!",
    });
  }

  // Griffin Comeback
  if (
    hasInHand("Shadow-Heart Griffin") &&
    field.length === 0 &&
    analysis.canNormalSummon
  ) {
    addCombo("Griffin Comeback", {
      priority: 7,
      action: { type: "summon", cardName: "Shadow-Heart Griffin" },
      logMessage: "Combo detectado: Griffin sem tributo",
    });
  }

  // Infusion Value
  if (
    hasInHand("Shadow-Heart Infusion") &&
    hand.length >= 3 &&
    graveyard.some((c) => c.cardKind === "monster")
  ) {
    const hasValueDiscard =
      hasInHand("Shadow-Heart Specter") || hasInHand("Shadow-Heart Coward");
    addCombo("Infusion Revival", {
      priority: hasValueDiscard ? 8 : 6,
      action: { type: "spell", cardName: "Shadow-Heart Infusion" },
      logMessage: `Combo detectado: Infusion ${hasValueDiscard ? "com valor extra" : ""}`,
    });
  }

  // Darkness Valley Setup
  if (hasInHand("Darkness Valley") && !analysis.fieldSpell) {
    addCombo("Darkness Valley Setup", {
      priority: 8,
      action: { type: "spell", cardName: "Darkness Valley" },
      logMessage: "Field Spell disponivel: Darkness Valley",
    });
  }

  // Eel to Leviathan Combo
  // Leviathan na mao + Abyssal Eel no campo = pode ativar ignition da mao
  if (
    hasInHand("Shadow-Heart Leviathan") &&
    hasOnField("Shadow-Heart Abyssal Eel")
  ) {
    addCombo("Eel to Leviathan", {
      priority: 9,
      action: { type: "handIgnition", cardName: "Shadow-Heart Leviathan" },
      logMessage: "Combo detectado: Eel -> Leviathan (2200 ATK + burn)!",
    });
  }

  return available;
}

export function getComboByName(name) {
  return findComboByName(COMBO_DATABASE, name);
}
