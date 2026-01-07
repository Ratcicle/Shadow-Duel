// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/combos.js
// Sequências e combos do arquétipo Luminarch
// ─────────────────────────────────────────────────────────────────────────────

import { isLuminarch, isLuminarchByName } from "./knowledge.js";

/**
 * Detecta combos disponíveis baseado no estado do jogo.
 * @param {Object} analysis - { hand, field, fieldSpell, graveyard, extraDeck }
 * @returns {Array<Object>} Lista de combos disponíveis
 */
export function detectAvailableCombos(analysis) {
  try {
    const combos = [];

    // Guard: validação de entrada
    if (!analysis) return combos;

    // Garantir que analysis tem arrays válidos
    analysis.field = Array.isArray(analysis.field) ? analysis.field : [];
    analysis.hand = Array.isArray(analysis.hand) ? analysis.hand : [];
    analysis.graveyard = Array.isArray(analysis.graveyard)
      ? analysis.graveyard
      : [];
    analysis.oppField = Array.isArray(analysis.oppField)
      ? analysis.oppField
      : [];
    analysis.extraDeck = Array.isArray(analysis.extraDeck)
      ? analysis.extraDeck
      : [];

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 1: Tank Setup (Valiant → Aegisbearer → Citadel)
    // ═════════════════════════════════════════════════════════════════════════
    const hasValiant = analysis.hand.some(
      (c) => c && c.name === "Luminarch Valiant - Knight of the Dawn"
    );
    const hasAegisInDeck = true; // Assumimos que está no deck
    const hasCitadelInHand = analysis.hand.some(
      (c) => c && c.name === "Sanctum of the Luminarch Citadel"
    );
    const hasCitadelActive =
      analysis.fieldSpell?.name?.includes("Citadel") ?? false;

    if (hasValiant && !hasCitadelActive) {
      combos.push({
        id: "tank_setup",
        name: "Tank Setup",
        priority: 10,
        cards: [
          "Luminarch Valiant - Knight of the Dawn",
          "Luminarch Aegisbearer",
        ],
        description:
          "T1: Valiant search Aegisbearer → SS Aegis (2500 DEF taunt)",
        steps: [
          "Normal Summon Valiant",
          "Efeito: add Aegisbearer",
          "Special Summon Aegisbearer (DEF)",
          "Ativar Citadel se tiver",
        ],
        conditions: {
          hasValiantInHand: hasValiant,
          fieldNotFull: analysis.field.length < 4,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 2: Arbiter → Citadel Field
    // ═════════════════════════════════════════════════════════════════════════
    const hasArbiter = analysis.hand.some(
      (c) => c && c.name === "Luminarch Sanctified Arbiter"
    );

    if (hasArbiter && !hasCitadelActive) {
      combos.push({
        id: "arbiter_citadel",
        name: "Arbiter → Citadel",
        priority: 11,
        cards: ["Luminarch Sanctified Arbiter"],
        description: "T1: Arbiter search Citadel field spell",
        steps: [
          "Normal Summon Arbiter",
          "Efeito: search Citadel",
          "Ativar Citadel",
        ],
        conditions: {
          hasArbiterInHand: hasArbiter,
          noCitadelActive: !hasCitadelActive,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 3: Citadel + Aegis = Heal Loop
    // ═════════════════════════════════════════════════════════════════════════
    const hasAegisOnField = analysis.field.some(
      (c) => c && c.name === "Luminarch Aegisbearer"
    );

    if (hasCitadelActive && hasAegisOnField) {
      combos.push({
        id: "citadel_aegis_heal",
        name: "Citadel + Aegis Heal Loop",
        priority: 9,
        cards: ["Sanctum of the Luminarch Citadel", "Luminarch Aegisbearer"],
        description: "Aegis taunt + Citadel = +500 LP por ataque recebido",
        steps: [
          "Aegis força ataques nele",
          "Cada ataque = +500 LP (Citadel)",
          "Usar Holy Shield para converter dano em heal",
        ],
        conditions: {
          citadelActive: hasCitadelActive,
          aegisOnField: hasAegisOnField,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 4: Moonlit Blessing + Citadel = GY → Field
    // ═════════════════════════════════════════════════════════════════════════
    const hasMoonlitInHand = analysis.hand.some(
      (c) => c && c.name === "Luminarch Moonlit Blessing"
    );
    const gyHasLuminarch = (analysis.graveyard || []).some(
      (c) => c && isLuminarch(c) && c.cardKind === "monster"
    );

    if (hasMoonlitInHand && hasCitadelActive && gyHasLuminarch) {
      const bestTarget = (analysis.graveyard || [])
        .filter((c) => c && isLuminarch(c) && c.cardKind === "monster")
        .sort((a, b) => {
          if (a.name === "Luminarch Aegisbearer") return -1;
          if (b.name === "Luminarch Aegisbearer") return 1;
          return (b.level || 0) - (a.level || 0);
        })[0];

      combos.push({
        id: "moonlit_citadel_revive",
        name: "Moonlit + Citadel = Revive Direto",
        priority: 12,
        cards: [
          "Luminarch Moonlit Blessing",
          "Sanctum of the Luminarch Citadel",
        ],
        description: `GY → Campo direto (target: ${bestTarget?.name})`,
        steps: [
          "Ativar Moonlit Blessing",
          "Add da GY (efeito COM Citadel)",
          "Special Summon direto no campo",
        ],
        conditions: {
          moonlitInHand: hasMoonlitInHand,
          citadelActive: hasCitadelActive,
          gyHasTargets: gyHasLuminarch,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 5: Aegis → Sanctum Protector
    // ═════════════════════════════════════════════════════════════════════════
    const hasProtectorInHand = analysis.hand.some(
      (c) => c && c.name === "Luminarch Sanctum Protector"
    );

    if (hasAegisOnField && hasProtectorInHand) {
      combos.push({
        id: "aegis_protector",
        name: "Aegis → Sanctum Protector",
        priority: 8,
        cards: ["Luminarch Aegisbearer", "Luminarch Sanctum Protector"],
        description: "Envie Aegis → SS Protector (2800 DEF + negar ataque)",
        steps: [
          "Ativar efeito de Protector",
          "Enviar Aegisbearer como custo",
          "Special Summon Protector da mão",
          "Pode negar 1 ataque por turno",
        ],
        conditions: {
          aegisOnField: hasAegisOnField,
          protectorInHand: hasProtectorInHand,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 6: Holy Shield + Citadel = Massive Heal
    // ═════════════════════════════════════════════════════════════════════════
    const hasHolyShieldInHand = analysis.hand.some(
      (c) => c && c.name === "Luminarch Holy Shield"
    );
    const luminarchOnField = (analysis.field || []).filter(
      (c) => c && isLuminarch(c)
    );

    if (
      hasHolyShieldInHand &&
      hasCitadelActive &&
      luminarchOnField.length >= 2
    ) {
      combos.push({
        id: "holy_shield_citadel_heal",
        name: "Holy Shield + Citadel = Heal Massivo",
        priority: 10,
        cards: ["Luminarch Holy Shield", "Sanctum of the Luminarch Citadel"],
        description: `${luminarchOnField.length}x protegidos + dano vira heal + Citadel +500 LP`,
        steps: [
          "BP oponente: ativar Holy Shield",
          "Alvos ficam indestructible",
          "Dano de batalha vira heal",
          "Citadel adiciona +500 LP por ataque",
        ],
        conditions: {
          holyShieldInHand: hasHolyShieldInHand,
          citadelActive: hasCitadelActive,
          multipleTargets: luminarchOnField.length >= 2,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 7: Magic Sickle Recursion
    // ═════════════════════════════════════════════════════════════════════════
    const hasSickleOnField = analysis.field.some(
      (c) => c && c.name === "Luminarch Magic Sickle"
    );
    const gyLuminarch = (analysis.graveyard || []).filter(
      (c) => c && isLuminarch(c)
    );

    if (hasSickleOnField && gyLuminarch.length >= 2) {
      combos.push({
        id: "sickle_recursion",
        name: "Magic Sickle Recursion",
        priority: 7,
        cards: ["Luminarch Magic Sickle"],
        description: `Enviar Sickle → add 2 Luminarch da GY (${gyLuminarch.length} opções)`,
        steps: [
          "Ativar efeito de Magic Sickle",
          "Enviar do campo para GY",
          "Add até 2 Luminarch da GY para mão",
        ],
        conditions: {
          sickleOnField: hasSickleOnField,
          gyHasTargets: gyLuminarch.length >= 2,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 8: Fusion Setup (Sanctum Protector + Lv5+)
    // ═════════════════════════════════════════════════════════════════════════
    const hasProtectorOnField = analysis.field.some(
      (c) => c && c.name === "Luminarch Sanctum Protector"
    );
    const hasLv5Plus = analysis.field.some(
      (c) =>
        c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 5
    );
    const hasMegashieldInExtra = (analysis.extraDeck || []).some(
      (c) => c && c.name === "Luminarch Megashield Barbarias"
    );

    if (hasProtectorOnField && hasLv5Plus && hasMegashieldInExtra) {
      const lv5Card = analysis.field.find(
        (c) =>
          c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 5
      );
      combos.push({
        id: "megashield_fusion",
        name: "Megashield Barbarias Fusion",
        priority: 6,
        cards: ["Luminarch Sanctum Protector", lv5Card?.name],
        description: "Fusion para 3000 DEF tank + lifegain x2",
        steps: [
          "Usar Polymerization",
          "Materiais: Protector + Lv5+",
          "Fusion Summon Megashield Barbarias",
          "Lifegain dobrado (Citadel 500 → 1000)",
        ],
        conditions: {
          protectorOnField: hasProtectorOnField,
          lv5PlusOnField: hasLv5Plus,
          megashieldInExtra: hasMegashieldInExtra,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 9: Ascension Setup (Aegis 2 turnos)
    // ═════════════════════════════════════════════════════════════════════════
    const aegisFieldAge = hasAegisOnField
      ? analysis.field.find((c) => c && c.name === "Luminarch Aegisbearer")
          ?.fieldAgeTurns || 0
      : 0;
    const canAscend = aegisFieldAge >= 2;
    const hasFortressInExtra = (analysis.extraDeck || []).some(
      (c) => c && c.name === "Luminarch Fortress Aegis"
    );

    if (hasAegisOnField && hasFortressInExtra) {
      if (canAscend) {
        combos.push({
          id: "fortress_aegis_ascension",
          name: "Fortress Aegis Ascension PRONTA",
          priority: 9,
          cards: ["Luminarch Aegisbearer", "Luminarch Fortress Aegis"],
          description:
            "Aegis 2+ turnos → Ascend para Fortress (2500 DEF + recursion)",
          steps: [
            "Ascension Summon Fortress Aegis",
            "Enviar Aegisbearer como material",
            "Heal 500 LP por Luminarch no campo",
            "Pode reviver monsters DEF 2000- pagando 1000 LP",
          ],
          conditions: {
            canAscendNow: canAscend,
            fortressInExtra: hasFortressInExtra,
          },
        });
      } else {
        combos.push({
          id: "fortress_aegis_setup",
          name: "Fortress Aegis Setup (Aguardando)",
          priority: 5,
          cards: ["Luminarch Aegisbearer"],
          description: `Aegis no campo (${aegisFieldAge}/2 turnos) - manter vivo para Ascensão`,
          steps: [
            "Proteger Aegisbearer por mais turnos",
            "Usar Holy Shield/Crescent Shield",
            "Após 2 turnos: Ascension Summon disponível",
          ],
          conditions: {
            setupInProgress: !canAscend && aegisFieldAge >= 1,
          },
        });
      }
    }

    return combos.sort((a, b) => b.priority - a.priority);
  } catch (e) {
    // Log silencioso - erro já tratado, apenas retorna array vazio
    return [];
  }
}

/**
 * Avalia se vale a pena executar um combo específico.
 * @param {Object} combo
 * @param {Object} gameState
 * @returns {boolean}
 */
export function shouldExecuteCombo(combo, gameState) {
  // Verificar se todas as condições estão satisfeitas
  if (!combo.conditions) return true;

  for (const [key, value] of Object.entries(combo.conditions)) {
    if (!value) return false;
  }

  return true;
}

/**
 * Helper: detecta se deve priorizar setup defensivo.
 * @param {Object} analysis
 * @returns {boolean}
 */
export function shouldPrioritizeDefense(analysis) {
  const lp = analysis.lp || 8000;
  const oppFieldStrength = (analysis.oppField || []).reduce(
    (sum, m) => sum + (m && m.atk ? m.atk : 0),
    0
  );

  // LP baixo = defensivo
  if (lp <= 3000) return true;

  // Oponente com board forte = defensivo
  if (oppFieldStrength >= 6000) return true;

  // Campo vazio + oponente com monstros = defensivo
  if (analysis.field.length === 0 && (analysis.oppField || []).length >= 2) {
    return true;
  }

  return false;
}

/**
 * Helper: detecta se pode tentar close game.
 * @param {Object} analysis
 * @returns {boolean}
 */
export function canAttemptLethal(analysis) {
  const oppLp = analysis.oppLp || 8000;
  const myAttackers = analysis.field.filter(
    (m) => m && m.cardKind === "monster" && m.position === "attack"
  );
  const totalAtk = myAttackers.reduce((sum, m) => sum + (m.atk || 0), 0);

  // Damage direto suficiente?
  if (totalAtk >= oppLp) return true;

  // Com buff pode fechar?
  const withBuff = totalAtk + 800; // Holy Ascension
  if (withBuff >= oppLp && (analysis.lp || 8000) >= 1000) return true;

  return false;
}
