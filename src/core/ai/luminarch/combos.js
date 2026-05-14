// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/combos.js
// Sequências e combos do arquétipo Luminarch
// ─────────────────────────────────────────────────────────────────────────────

import { isLuminarch, isLuminarchByName } from "./knowledge.js";
import { getTotalAttackThreat } from "../common/cardStats.js";
import {
  createAvailableCombo,
  createZoneIndex,
  getZoneCards,
  hasCardName,
  hasCardNameInZones,
} from "../common/comboDetection.js";

const LUMINARCH_COMBO_ZONES = [
  "hand",
  "field",
  "graveyard",
  "spellTrap",
  "extraDeck",
  "oppField",
];

function getLuminarchComboZones(analysis = {}) {
  const zoneIndex = createZoneIndex(analysis, LUMINARCH_COMBO_ZONES);
  return {
    zoneIndex,
    hand: getZoneCards(zoneIndex, "hand"),
    field: getZoneCards(zoneIndex, "field"),
    graveyard: getZoneCards(zoneIndex, "graveyard"),
    spellTrap: getZoneCards(zoneIndex, "spellTrap"),
    extraDeck: getZoneCards(zoneIndex, "extraDeck"),
    oppField: getZoneCards(zoneIndex, "oppField"),
  };
}

function pushCombo(combos, combo) {
  combos.push(
    createAvailableCombo({
      combo,
      name: combo.name,
      priority: combo.priority,
      ...combo,
    }),
  );
}

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
    analysis.spellTrap = Array.isArray(analysis.spellTrap)
      ? analysis.spellTrap
      : [];

    const { zoneIndex, hand, field, graveyard, oppField } =
      getLuminarchComboZones(analysis);
    
    // Detectar turno do jogo (aproximado)
    const currentTurn = analysis.currentTurn || 1;
    const isEarlyGame = currentTurn <= 3;

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 1: Tank Setup (Valiant → Aegisbearer → Citadel)
    // ═════════════════════════════════════════════════════════════════════════
    const hasValiant = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Valiant - Knight of the Dawn",
    );
    const hasAegisInDeck = true; // Assumimos que está no deck
    const hasAegisInHand = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Aegisbearer",
    );
    const hasCitadelInHand = hasCardName(
      zoneIndex,
      "hand",
      "Sanctum of the Luminarch Citadel",
    );
    const hasCitadelActive =
      analysis.fieldSpell?.name?.includes("Citadel") ?? false;

    // Prioridade MÁXIMA no Turn 1: setup completo
    if (hasValiant && !hasCitadelActive && isEarlyGame) {
      const hasFullCombo = hasCitadelInHand;
      pushCombo(combos, {
        id: "tank_setup",
        name: hasFullCombo ? "Tank Setup COMPLETO" : "Tank Setup",
        priority: hasFullCombo ? 15 : 12,
        cards: [
          "Luminarch Valiant - Knight of the Dawn",
          "Luminarch Aegisbearer",
          ...(hasFullCombo ? ["Sanctum of the Luminarch Citadel"] : []),
        ],
        description: hasFullCombo
          ? "T1 IDEAL: Valiant → Aegis → Citadel = 2500 DEF tank + field buff"
          : "T1: Valiant search Aegisbearer → SS Aegis (2500 DEF taunt)",
        steps: [
          "Normal Summon Valiant",
          "Efeito: add Aegisbearer",
          "Special Summon Aegisbearer (DEF)",
          ...(hasFullCombo ? ["Ativar Citadel"] : ["Buscar Citadel depois"]),
        ],
        conditions: {
          hasValiantInHand: hasValiant,
          fieldNotFull: field.length < 4,
          fullCombo: hasFullCombo,
        },
      });
    }
    
    // Se já tem Aegis na mão + Citadel, pode pular Valiant
    if (hasAegisInHand && hasCitadelInHand && !hasCitadelActive && isEarlyGame) {
      pushCombo(combos, {
        id: "aegis_citadel_direct",
        name: "Aegis + Citadel Setup Direto",
        priority: 13,
        cards: ["Luminarch Aegisbearer", "Sanctum of the Luminarch Citadel"],
        description: "SS Aegis direto → Citadel = 2500 DEF tank imediato",
        steps: [
          "Special Summon Aegisbearer",
          "Ativar Citadel",
          "Tank setup completo T1",
        ],
        conditions: {
          aegisInHand: hasAegisInHand,
          citadelInHand: hasCitadelInHand,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 2: Arbiter → Citadel Field
    // ═════════════════════════════════════════════════════════════════════════
    const hasArbiter = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Sanctified Arbiter",
    );

    if (hasArbiter && !hasCitadelActive) {
      // Prioridade EXTRA alta se T1 e ainda não tem field spell
      const priorityBoost = isEarlyGame && !analysis.fieldSpell ? 3 : 0;
      pushCombo(combos, {
        id: "arbiter_citadel",
        name: "Arbiter → Citadel",
        priority: 11 + priorityBoost,
        cards: ["Luminarch Sanctified Arbiter"],
        description: isEarlyGame
          ? "T1 PRIORITY: Arbiter search Citadel field spell"
          : "Arbiter search Citadel field spell",
        steps: [
          "Normal Summon Arbiter",
          "Efeito: search Citadel",
          "Ativar Citadel no mesmo turno",
        ],
        conditions: {
          hasArbiterInHand: hasArbiter,
          noCitadelActive: !hasCitadelActive,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 2.5: Knights Convocation Brick Escape
    // Quando mão está "brickada" com muitos Lv7+, usar Convocation para converter
    // ═════════════════════════════════════════════════════════════════════════
    const hasConvocationInHand = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Knights Convocation",
    );
    const hasConvocationOnField = hasCardNameInZones(
      zoneIndex,
      ["field", "spellTrap"],
      "Luminarch Knights Convocation",
    );
    const lv7PlusInHand = hand.filter(
      (c) => c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 7
    );
    const hasSearcherInDeck = true; // Assumimos Valiant/Arbiter no deck
    const noSearchersInHand = !hasValiant && !hasArbiter;

    // BRICK DETECTION: 2+ monstros Lv7+ na mão SEM searchers = brick
    const isBricked = lv7PlusInHand.length >= 2 && noSearchersInHand;
    const hasBrickEscape = hasConvocationInHand || hasConvocationOnField;

    if (isBricked && hasBrickEscape) {
      const brickNames = lv7PlusInHand.slice(0, 2).map((c) => c.name?.split(" - ")[0] || c.name).join(", ");
      pushCombo(combos, {
        id: "convocation_brick_escape",
        name: "⚠️ BRICK ESCAPE: Convocation",
        priority: 16, // Alta prioridade - resolver brick é crítico
        cards: ["Luminarch Knights Convocation", ...lv7PlusInHand.map((c) => c.name)],
        description: `Mão brickada (${lv7PlusInHand.length}x Lv7+) → Discard boss → Search Valiant/Arbiter`,
        steps: [
          hasConvocationInHand ? "Setar/Ativar Knights Convocation" : "Convocation já no campo",
          `Discard ${brickNames} (Lv7+)`,
          "Search Valiant ou Arbiter (Lv4-)",
          "Iniciar combo principal (Valiant → Aegis ou Arbiter → Citadel)",
          "Moonlit Blessing depois recupera bosses da GY",
        ],
        conditions: {
          isBricked: isBricked,
          hasConvocation: hasBrickEscape,
          lv7Count: lv7PlusInHand.length,
          noSearchers: noSearchersInHand,
        },
      });
    }

    // Mesmo sem brick, Convocation é útil se tem 1 Lv7+ e quer cycle
    if ((hasConvocationInHand || hasConvocationOnField) && lv7PlusInHand.length >= 1 && !isBricked) {
      pushCombo(combos, {
        id: "convocation_cycle",
        name: "Convocation Cycle",
        priority: 6,
        cards: ["Luminarch Knights Convocation"],
        description: "Discard Lv7+ → Search Lv4- (cycle para searchers)",
        steps: [
          "Ativar Convocation",
          `Discard ${lv7PlusInHand[0]?.name?.split(" - ")[0] || "Lv7+"}`,
          "Search Valiant/Arbiter/Sickle (Lv4-)",
        ],
        conditions: {
          hasConvocation: hasConvocationInHand || hasConvocationOnField,
          hasLv7Plus: lv7PlusInHand.length >= 1,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 3: Citadel + Aegis = Heal Loop
    // ═════════════════════════════════════════════════════════════════════════
    const hasAegisOnField = hasCardName(
      zoneIndex,
      "field",
      "Luminarch Aegisbearer",
    );

    if (hasCitadelActive && hasAegisOnField) {
      pushCombo(combos, {
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
    const hasMoonlitInHand = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Moonlit Blessing",
    );
    const gyHasLuminarch = graveyard.some(
      (c) => c && isLuminarch(c) && c.cardKind === "monster"
    );

    if (hasMoonlitInHand && hasCitadelActive && gyHasLuminarch) {
      const bestTarget = graveyard
        .filter((c) => c && isLuminarch(c) && c.cardKind === "monster")
        .sort((a, b) => {
          if (a.name === "Luminarch Aegisbearer") return -1;
          if (b.name === "Luminarch Aegisbearer") return 1;
          return (b.level || 0) - (a.level || 0);
        })[0];

      pushCombo(combos, {
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
    const hasProtectorInHand = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Sanctum Protector",
    );

    if (hasAegisOnField && hasProtectorInHand) {
      pushCombo(combos, {
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
    const hasHolyShieldInHand = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Holy Shield",
    );
    const luminarchOnField = field.filter(
      (c) => c && isLuminarch(c)
    );

    if (
      hasHolyShieldInHand &&
      hasCitadelActive &&
      luminarchOnField.length >= 2
    ) {
      pushCombo(combos, {
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
    const hasSickleOnField = hasCardName(
      zoneIndex,
      "field",
      "Luminarch Magic Sickle",
    );
    const gyLuminarch = graveyard.filter(
      (c) => c && isLuminarch(c)
    );

    if (hasSickleOnField && gyLuminarch.length >= 2) {
      pushCombo(combos, {
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
    // COMBO 7.5: Moonblade Captain + Enchanted Halberd Chain
    // Captain revive → Aegis SS → Halberd trigger → 3 monstros em 1 turno
    // ═════════════════════════════════════════════════════════════════════════
    const hasMoonbladeInHand = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Moonblade Captain",
    );
    const hasHalberdInHand = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Enchanted Halberd",
    );
    const gyHasLv4Luminarch = graveyard.some(
      (c) => c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) <= 4
    );

    if (hasMoonbladeInHand && hasHalberdInHand && gyHasLv4Luminarch) {
      const bestReviveTarget = graveyard
        .filter((c) => c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) <= 4)
        .sort((a, b) => {
          // Priorizar Aegisbearer (melhor target)
          if (a.name === "Luminarch Aegisbearer") return -1;
          if (b.name === "Luminarch Aegisbearer") return 1;
          return (b.def || 0) - (a.def || 0);
        })[0];

      pushCombo(combos, {
        id: "moonblade_halberd_chain",
        name: "🔗 Moonblade + Halberd Chain",
        priority: 13,
        cards: ["Luminarch Moonblade Captain", "Luminarch Enchanted Halberd", bestReviveTarget?.name],
        description: "Captain → Revive Lv4- → Halberd auto-SS = 3 monstros em 1 turno!",
        steps: [
          "Normal/Tribute Summon Moonblade Captain",
          `Efeito Captain: Revive ${bestReviveTarget?.name || "Lv4-"} da GY (SS)`,
          "TRIGGER: Halberd vê Luminarch SS → auto-SS da mão",
          "Resultado: 3 monstros no campo (Captain + Revive + Halberd)",
          bestReviveTarget?.name === "Luminarch Aegisbearer" ? "Aegis 2500 DEF taunt ativo!" : "Board presence forte",
        ],
        conditions: {
          hasMoonblade: hasMoonbladeInHand,
          hasHalberd: hasHalberdInHand,
          gyHasTarget: gyHasLv4Luminarch,
          bestTarget: bestReviveTarget?.name,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 7.6: Spear of Dawnfall + Piercing Lethal
    // Zerar stats de defender → Piercing para dano direto
    // ═════════════════════════════════════════════════════════════════════════
    const hasSpearInHand = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Spear of Dawnfall",
    );
    const hasPiercingMonster = field.some(
      (c) => c && c.cardKind === "monster" && !c.isFacedown && c.piercing
    );
    const oppHasDefenders = oppField.some(
      (c) => c && c.cardKind === "monster" && c.position === "defense"
    );
    const oppLp = analysis.oppLp || 8000;

    if (hasSpearInHand && hasPiercingMonster && oppHasDefenders) {
      const piercers = field.filter(
        (c) => c && c.cardKind === "monster" && !c.isFacedown && c.piercing
      );
      const totalPiercingAtk = piercers.reduce((sum, m) => sum + (m.atk || 0), 0);
      const canLethal = totalPiercingAtk >= oppLp;

      pushCombo(combos, {
        id: "spear_piercing_setup",
        name: canLethal ? "⚔️ SPEAR + PIERCING LETHAL" : "Spear + Piercing Setup",
        priority: canLethal ? 18 : 9,
        cards: ["Luminarch Spear of Dawnfall", ...piercers.map((c) => c.name)],
        description: canLethal
          ? `LETHAL! Spear zera DEF → Piercing ${totalPiercingAtk} damage = WIN`
          : `Zerar DEF de defender → Piercing damage (${totalPiercingAtk} ATK disponível)`,
        steps: [
          "Ativar Spear of Dawnfall",
          "Target: Monstro oponente em DEF",
          "ATK/DEF do target viram 0",
          `Atacar com ${piercers.map((c) => c.name?.split(" - ")[0] || c.name).join(", ")} (piercing)`,
          canLethal ? "DANO DIRETO = VITÓRIA" : "Dano massivo ao LP oponente",
        ],
        conditions: {
          hasSpear: hasSpearInHand,
          hasPiercing: hasPiercingMonster,
          oppInDefense: oppHasDefenders,
          canLethal: canLethal,
          totalDamage: totalPiercingAtk,
        },
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO 8: Fusion Setup (Sanctum Protector + Lv5+)
    // ═════════════════════════════════════════════════════════════════════════
    const hasProtectorOnField = hasCardName(
      zoneIndex,
      "field",
      "Luminarch Sanctum Protector",
    );
    const hasLv5Plus = field.some(
      (c) =>
        c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 5
    );
    const hasMegashieldInExtra = hasCardName(
      zoneIndex,
      "extraDeck",
      "Luminarch Megashield Barbarias",
    );

    if (hasProtectorOnField && hasLv5Plus && hasMegashieldInExtra) {
      const lv5Card = field.find(
        (c) =>
          c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 5
      );
      pushCombo(combos, {
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
    // COMBO 9: Fortress Aegis Ascension Chain (AVANÇADO)
    // ═════════════════════════════════════════════════════════════════════════
    const aegisFieldAge = hasAegisOnField
      ? field.find((c) => c && c.name === "Luminarch Aegisbearer")
          ?.fieldAgeTurns || 0
      : 0;
    const canAscend = aegisFieldAge >= 2;
    const hasFortressInExtra = hasCardName(
      zoneIndex,
      "extraDeck",
      "Luminarch Fortress Aegis",
    );
    // hasHalberdInHand já declarado no combo 7.5

    if (hasAegisOnField && hasFortressInExtra) {
      if (canAscend) {
        const hasFullChain = hasHalberdInHand;
        pushCombo(combos, {
          id: "fortress_aegis_ascension_chain",
          name: hasFullChain
            ? "🔥 FORTRESS AEGIS CHAIN COMPLETA"
            : "Fortress Aegis Ascension PRONTA",
          priority: hasFullChain ? 14 : 9,
          cards: [
            "Luminarch Aegisbearer",
            "Luminarch Fortress Aegis",
            ...(hasFullChain ? ["Luminarch Enchanted Halberd"] : []),
          ],
          description: hasFullChain
            ? "Ascend → Fortress revive Aegis (2500 DEF) → Halberd auto-SS → 3 TANKS!"
            : "Aegis 2+ turnos → Ascend para Fortress (2500 DEF + recursion)",
          steps: hasFullChain
            ? [
                "Perform Ascension Summon (Aegis → Fortress Aegis)",
                "Fortress efeito: revive Aegis do GY",
                "Aegis revive como Special Summon (2500 DEF taunt)",
                "🎯 Halberd vê Special Summon → auto-SS da mão!",
                "Resultado: 2 tanks taunt (Aegis 2500 + Fortress 2500) + Halberd",
              ]
            : [
                "Perform Ascension Summon (Aegis → Fortress Aegis)",
                "Fortress efeito: revive Aegis do GY",
                "Aegis volta com 2500 DEF (taunt)",
                "Setup defensivo completo",
              ],
          conditions: {
            aegisOnField: hasAegisOnField,
            aegisReady: canAscend,
            fortressInExtra: hasFortressInExtra,
            halberdInHand: hasHalberdInHand,
            fullChain: hasFullChain,
          },
        });
      } else {
        // Aegis ainda não pronto - avisar quantos turnos faltam
        const turnsLeft = Math.max(0, 2 - aegisFieldAge);
        pushCombo(combos, {
          id: "fortress_aegis_prep",
          name: "Fortress Aegis - Aguardando Maturidade",
          priority: 0, // Não executar, apenas informativo
          cards: ["Luminarch Aegisbearer", "Luminarch Fortress Aegis"],
          description: `Aegis precisa ${turnsLeft} turno(s) no campo para Ascend`,
          steps: [
            `Aguardar ${turnsLeft} turno(s)`,
            "Proteger Aegis até ficar pronto",
            "Então fazer Ascension Summon",
          ],
          conditions: {
            aegisOnField: hasAegisOnField,
            aegisNotReady: !canAscend,
            turnsLeft,
          },
        });
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COMBO: SACRED JUDGMENT COMEBACK
    // ═════════════════════════════════════════════════════════════════════════
    const hasSacredJudgment = hasCardName(
      zoneIndex,
      "hand",
      "Luminarch Sacred Judgment",
    );
    const myFieldCount = field.length;
    const oppFieldCount = oppField.length;
    const lp = analysis.lp || 8000;
    const gyLuminarchSJ = graveyard.filter(
      (c) => c && isLuminarch(c) && c.cardKind === "monster"
    );

    if (hasSacredJudgment && myFieldCount === 0 && oppFieldCount >= 2 && lp >= 2500 && gyLuminarchSJ.length >= 2) {
      // Avaliar qualidade dos monstros no GY
      const highValueMonsters = gyLuminarchSJ.filter((c) => {
        return (
          c.name?.includes("Aegisbearer") ||
          c.name?.includes("Sanctum Protector") ||
          c.name?.includes("Aurora Seraph") ||
          c.name?.includes("Fortress Aegis") ||
          (c.def && c.def >= 2000) ||
          (c.atk && c.atk >= 2000)
        );
      });

      const potentialSummons = Math.min(gyLuminarchSJ.length, oppFieldCount, 5);
      const lpGain = potentialSummons * 500;
      const netLpCost = 2000 - lpGain;
      const finalLp = lp - netLpCost;

      // Detectar se é situação crítica que justifica o risco
      const isCritical = oppFieldCount >= 3;
      const hasQuality = highValueMonsters.length >= 1;
      
      if (isCritical && hasQuality) {
        pushCombo(combos, {
          id: "sacred_judgment_comeback",
          name: "⚡ SACRED JUDGMENT COMEBACK",
          priority: oppFieldCount >= 4 ? 19 : oppFieldCount >= 3 ? 17 : 15,
          cards: ["Luminarch Sacred Judgment", ...highValueMonsters.slice(0, potentialSummons).map(c => c.name)],
          description: `DESPERATION PLAY: Pagar 2000 LP → SS ${potentialSummons} Luminarch da GY (${highValueMonsters.length} high-value) → heal ${lpGain} LP`,
          steps: [
            `Ativar Sacred Judgment (custo 2000 LP)`,
            `SS até ${potentialSummons} Luminarch da GY`,
            `Priorizar: ${highValueMonsters.slice(0, 3).map(c => c.name?.split(" - ")[0] || c.name).join(", ")}`,
            `Heal ${lpGain} LP (500 por monstro)`,
            `LP final: ${finalLp} (net cost: ${netLpCost})`,
            `Igualar/superar board do oponente`
          ],
          conditions: {
            fieldEmpty: myFieldCount === 0,
            oppDominates: oppFieldCount >= 3,
            hasResources: gyLuminarchSJ.length >= 2,
            hasQuality: highValueMonsters.length >= 1,
            survives: finalLp >= 1000,
            critical: isCritical
          }
        });
      } else if (gyLuminarchSJ.length >= 3 && finalLp >= 1500) {
        // Situação menos crítica mas ainda válida
        pushCombo(combos, {
          id: "sacred_judgment_recovery",
          name: "Sacred Judgment - Recovery Play",
          priority: 13,
          cards: ["Luminarch Sacred Judgment"],
          description: `Pagar 2000 LP → SS ${potentialSummons} Luminarch da GY → rebuild board`,
          steps: [
            `Ativar Sacred Judgment`,
            `SS ${potentialSummons} monstros (LP final: ${finalLp})`,
            `Reconstruir presença de board`
          ],
          conditions: {
            fieldEmpty: myFieldCount === 0,
            hasResources: gyLuminarchSJ.length >= 3,
            survives: finalLp >= 1500
          }
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
  const { field, oppField } = getLuminarchComboZones(analysis);
  const oppFieldStrength = oppField.reduce(
    (sum, m) => sum + (m && m.atk ? m.atk : 0),
    0
  );
  
  const myFieldStrength = field.reduce(
    (sum, m) => sum + (m && m.atk ? m.atk : 0),
    0
  );

  // LP crítico = SEMPRE defensivo
  if (lp <= 2500) return true;

  // LP baixo-médio + oponente forte = defensivo
  if (lp <= 4000 && oppFieldStrength >= 5000) return true;

  // Oponente com board muito forte = defensivo
  if (oppFieldStrength >= 7500) return true;

  // Campo vazio + oponente com 2+ monstros = defensivo
  if (field.length === 0 && oppField.length >= 2) {
    return true;
  }
  
  // Oponente dominando board (strength 2x maior)
  if (oppFieldStrength >= myFieldStrength * 2 && myFieldStrength > 0) {
    return true;
  }

  return false;
}

/**
 * Helper: detecta se deve fazer turtle/heal loop strategy.
 * Luminarch pode ganhar via stall + Citadel heal + Holy Shield.
 * @param {Object} analysis
 * @returns {Object} { shouldTurtle: boolean, reason: string }
 */
export function shouldTurtleStrategy(analysis) {
  const lp = analysis.lp || 8000;
  const oppLp = analysis.oppLp || 8000;
  const { zoneIndex, oppField } = getLuminarchComboZones(analysis);
  const hasCitadel = analysis.fieldSpell?.name?.includes("Citadel") ?? false;
  const hasAegis = hasCardName(
    zoneIndex,
    "field",
    "Luminarch Aegisbearer",
  );
  const hasHolyShield = hasCardName(
    zoneIndex,
    "hand",
    "Luminarch Holy Shield",
  );
  
  // Condição 1: LP crítico mas tenho engine de heal
  if (lp <= 3000 && hasCitadel && hasAegis) {
    return {
      shouldTurtle: true,
      reason: "LP baixo + Citadel + Aegis taunt = heal loop viável",
    };
  }
  
  // Condição 2: Oponente muito forte, preciso ganhar tempo
  const oppStrength = getTotalAttackThreat(oppField, {
    facedownValue: "printed",
    includeBoosts: false,
  });
  if (oppStrength >= 7000 && hasCitadel) {
    return {
      shouldTurtle: true,
      reason: "Oponente muito forte - stall + heal para sobreviver",
    };
  }
  
  // Condição 3: Tenho full combo defensivo (Aegis + Citadel + Holy Shield)
  if (hasCitadel && hasAegis && hasHolyShield) {
    return {
      shouldTurtle: true,
      reason: "COMBO DEFENSIVO COMPLETO - maximize heal loop",
    };
  }
  
  return {
    shouldTurtle: false,
    reason: "Sem engine de turtle/heal suficiente",
  };
}

/**
 * Helper: detecta se pode tentar close game.
 * @param {Object} analysis
 * @returns {boolean}
 */
export function canAttemptLethal(analysis) {
  const oppLp = analysis.oppLp || 8000;
  const { field, oppField } = getLuminarchComboZones(analysis);
  const myAttackers = field.filter(
    (m) => m && m.cardKind === "monster" && m.position === "attack" && !m.isFacedown
  );
  const totalAtk = myAttackers.reduce((sum, m) => sum + (m.atk || 0), 0);
  
  // Calcular damage direto potencial
  const oppDefenders = oppField.filter(
    (m) => m && m.cardKind === "monster" && !m.isFacedown
  ).length;
  
  // Cenário 1: Damage direto suficiente (sem defenders ou passa por todos)
  const directDamage = oppDefenders === 0 ? totalAtk : 0;
  if (directDamage >= oppLp) return true;

  // Cenário 2: Com buff (Holy Ascension +800 ATK/monstro)
  const luminarchCount = myAttackers.filter((m) => isLuminarch(m)).length;
  const withBuff = totalAtk + (luminarchCount * 800);
  const canAffordBuff = (analysis.lp || 8000) >= 1000;
  
  if (canAffordBuff && withBuff >= oppLp + (oppDefenders * 1000)) {
    return true;
  }

  // Cenário 3: Oponente LP crítico (<= 2000) e tenho board
  if (oppLp <= 2000 && myAttackers.length >= 2) {
    return true;
  }

  return false;
}
