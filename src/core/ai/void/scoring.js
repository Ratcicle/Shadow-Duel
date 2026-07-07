// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/void/scoring.js
// Avaliação de board e monstros específica para Void.
//
// FILOSOFIA:
// - Void valoriza quantidade (swarm) para habilitar fusões e tributos
// - Hollows têm valor especial mesmo com stats baixos
// - Combos em progresso aumentam valor do estado
// ─────────────────────────────────────────────────────────────────────────────

import {
  isVoid,
  getVoidCardKnowledge,
  VOID_CARD_KNOWLEDGE,
} from "./knowledge.js";
import {
  VOID_IDS,
  countControlledSpellTrapCards,
  detectAvailableCombos,
  calculateFusionValue,
} from "./combos.js";
import {
  calculateThreatScore,
  canOpponentLethal,
} from "../ThreatEvaluation.js";
import { analyzeResourceEconomy } from "../common/resourceEconomy.js";
import {
  assessResourceRecovery,
  assessResourceSpend,
  scoreResourcePressure,
} from "../common/resourcePolicy.js";

export const VOID_HOLLOW_RESOURCE_POLICY = {
  resourceName: "Void Hollow",
  primaryZone: "graveyard",
  thresholds: {
    preserveAt: 2,
    criticalAt: 3,
    recoveryStrandedMin: 2,
  },
  minAccessible: 2,
  defaultPreservePenalty: 2.5,
  recoverySpendPenalty: 0,
  defaultRecoveryBonus: 1.0,
  recoveryPreserveBonus: 0.4,
  spendModes: {
    revive_for_thousand_arms: { preservePenalty: 3.0, usePressurePreserve: false },
    revive_for_cosmic_walker: { preservePenalty: 2.5, usePressurePreserve: false },
    revive_for_haunter: { preservePenalty: 3.0, usePressurePreserve: false },
  },
  recoveryModes: {
    hollow_recovery: { recoveryBonus: 1.0, preserveBonus: 0.4 },
  },
};

/**
 * Analisa a "economia de Hollows" — onde estão e como podem ser acessados.
 * Hollows são o recurso principal de Void. Saber gerenciá-los é crucial.
 *
 * Hollow só recruta quando Special Summoned DA MÃO (não do deck).
 * Então Hollows no GY ou deck precisam de enablers para serem úteis.
 *
 * @param {Object} analysis - Estado do jogo
 * @returns {Object} - Análise detalhada de recursos Hollow
 */
export function analyzeHollowEconomy(analysis) {
  const { hand = [], field = [] } = analysis;
  const fieldSpell = analysis.fieldSpell;

  const economy = analyzeResourceEconomy(analysis, {
    resourceName: "Void Hollow",
    zones: ["hand", "field", "graveyard"],
    matchResource: (card) => card?.id === VOID_IDS.HOLLOW,
    getEnablers: () => ({
      haunterOnField: field.some((c) => c?.id === VOID_IDS.HAUNTER),
      haunterInHand: hand.some((c) => c?.id === VOID_IDS.HAUNTER),
      theVoidActive: fieldSpell?.id === VOID_IDS.THE_VOID,
      walkerInHand: hand.some((c) => c?.id === VOID_IDS.WALKER),
      conjurerInHand: hand.some((c) => c?.id === VOID_IDS.CONJURER),
    }),
    computeAccessibility: ({ countsByZone, enablers }) => {
      const accessibleFromGY =
        enablers.haunterOnField || enablers.haunterInHand
          ? countsByZone.graveyard
          : enablers.theVoidActive
            ? Math.min(1, countsByZone.graveyard)
            : 0;

      return {
        accessibleByZone: {
          hand: countsByZone.hand,
          field: countsByZone.field,
          graveyard: accessibleFromGY,
        },
        strandedByZone: {
          graveyard: countsByZone.graveyard - accessibleFromGY,
        },
      };
    },
    computePotential: ({ countsByZone, enablers }) => {
      let swarmPotential = countsByZone.field;

      if (countsByZone.hand > 0 && (enablers.walkerInHand || enablers.haunterOnField)) {
        swarmPotential += countsByZone.hand * 2;
      } else {
        swarmPotential += countsByZone.hand;
      }

      if (enablers.haunterOnField || enablers.haunterInHand) {
        swarmPotential += countsByZone.graveyard;
      }

      return {
        canTriggerRecruitment:
          countsByZone.hand > 0 || (countsByZone.field > 0 && enablers.walkerInHand),
        swarmPotential,
      };
    },
    computeFlags: ({ enablers, totalAccessibleResources, totalStrandedResources }) => ({
      isHealthy: totalAccessibleResources >= 2 && totalStrandedResources <= 1,
      needsRecovery:
        totalStrandedResources >= 2 && !enablers.haunterOnField && !enablers.haunterInHand,
    }),
  });

  const hollowsInHand = economy.countsByZone.hand || 0;
  const hollowsOnField = economy.countsByZone.field || 0;
  const hollowsInGY = economy.countsByZone.graveyard || 0;

  // Enablers para recuperar Hollows
  const haunterOnField = economy.enablers.haunterOnField;
  const haunterInHand = economy.enablers.haunterInHand;
  const theVoidActive = economy.enablers.theVoidActive;

  // Walker pode voltar Hollow do campo para a mão (para re-trigger)
  const walkerInHand = economy.enablers.walkerInHand;

  // Conjurer recruta do DECK (não traz Hollow da mão, mas traz Walker)
  const conjurerInHand = economy.enablers.conjurerInHand;

  // Quantos Hollows podemos acessar de forma útil?
  const accessibleHollows = economy.totalAccessibleResources;

  // Hollows "perdidos" = no GY sem forma de recuperar
  const strandedHollows = economy.totalStrandedResources;

  // Hollows que podem recrutar (na mão e podem ser Special Summoned)
  // Walker permite bounce Hollow do campo → mão → Special Summon novamente
  const canTriggerRecruitment = economy.potential?.canTriggerRecruitment || false;

  // Potencial de swarm: quantos Hollows podemos colocar no campo?
  const swarmPotential = economy.potential?.swarmPotential || 0;

  return {
    // Contagens
    hollowsInHand,
    hollowsOnField,
    hollowsInGY,
    totalHollows: hollowsInHand + hollowsOnField + hollowsInGY,

    // Acessibilidade
    totalAccessibleHollows: accessibleHollows,
    strandedHollows,

    // Enablers
    hasHaunterRevive: haunterOnField || haunterInHand,
    hasTheVoidRecovery: theVoidActive,
    hasWalkerBounce: walkerInHand,
    hasConjurerRecruit: conjurerInHand,

    // Potencial
    canTriggerRecruitment,
    swarmPotential,

    // Estado geral
    isHealthy: accessibleHollows >= 2 && strandedHollows <= 1,
    needsRecovery: strandedHollows >= 2 && !haunterOnField && !haunterInHand,
    resourceEconomy: economy,
  };
}

export function assessVoidHollowResourcePolicy(analysis = {}) {
  const hollowEconomy = analysis.hollowEconomy || analyzeHollowEconomy(analysis);
  const economy = hollowEconomy.resourceEconomy || {
    resourceName: "Void Hollow",
    countsByZone: {
      hand: hollowEconomy.hollowsInHand || 0,
      field: hollowEconomy.hollowsOnField || 0,
      graveyard: hollowEconomy.hollowsInGY || 0,
    },
    totalAccessibleResources: hollowEconomy.totalAccessibleHollows || 0,
    totalStrandedResources: hollowEconomy.strandedHollows || 0,
    flags: {
      needsRecovery: hollowEconomy.needsRecovery,
    },
  };
  const preserveForFinisher =
    analysis.bestFinisherPlan?.preserveHollowsInGY === true &&
    String(analysis.phase || "").toLowerCase().includes("main1");
  const context = { preserveForPayoff: preserveForFinisher };

  return {
    pressure: scoreResourcePressure(economy, VOID_HOLLOW_RESOURCE_POLICY, context),
    preserveHollowsInGY: preserveForFinisher,
    needsRecovery: hollowEconomy.needsRecovery,
    recovery: assessResourceRecovery({
      economy,
      recovery: { mode: "hollow_recovery" },
      policy: VOID_HOLLOW_RESOURCE_POLICY,
      context,
    }),
    spend: {
      thousandArmsRevive: assessResourceSpend({
        economy,
        spend: { mode: "revive_for_thousand_arms" },
        policy: VOID_HOLLOW_RESOURCE_POLICY,
        context,
      }),
      cosmicWalkerRevive: assessResourceSpend({
        economy,
        spend: { mode: "revive_for_cosmic_walker" },
        policy: VOID_HOLLOW_RESOURCE_POLICY,
        context,
      }),
      haunterRevive: assessResourceSpend({
        economy,
        spend: { mode: "revive_for_haunter" },
        policy: VOID_HOLLOW_RESOURCE_POLICY,
        context,
      }),
    },
  };
}

/**
 * Avalia um monstro Void no contexto do arquétipo.
 * @param {Object} monster - Carta do monstro
 * @param {Object} context - Contexto do jogo
 * @returns {number} - Valor do monstro
 */
export function evaluateVoidMonster(monster, context = {}) {
  if (!monster || monster.cardKind !== "monster") return 0;

  const {
    oppStrongestAtk = 0,
    hollowCount = 0,
    voidCount = 0,
    hollowsInGY = 0,
    voidsInGY = 0,
    phase = "main",
  } = context;
  const knowledge = getVoidCardKnowledge(monster);
  const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
  const def = monster.def || 0;
  const position = monster.position || "attack";

  let value = 0;

  // Base value por stats
  if (position === "attack") {
    value += atk / 800; // 2400 ATK = 3.0
  } else {
    value += def / 1000; // 2000 DEF = 2.0
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Bônus por papel no arquétipo
  // ═══════════════════════════════════════════════════════════════════════════

  switch (monster.id) {
    // Hollows são valiosos como materiais
    case VOID_IDS.HOLLOW:
      value += 1.5; // Sempre útil para combos
      if (hollowCount >= 2) value += 0.5; // Mais Hollows = closer to fusion
      break;

    // Conjurer é engine
    case VOID_IDS.CONJURER:
      value += 2.0; // Recruta do deck
      if (hollowCount === 0) value += 0.5; // Ainda mais valioso se não tem Hollows
      break;

    // Walker é extender recursivo
    case VOID_IDS.WALKER:
      value += 1.8;
      break;

    // Haunter habilita swarm massivo
    case VOID_IDS.HAUNTER:
      value += 2.2;
      break;

    // Bosses
    case VOID_IDS.SLAYER_BRUTE:
      value += 2.5; // Conditional banish + fusion material
      break;

    case VOID_IDS.SERPENT_DRAKE:
      value += 2.5;
      break;

    case VOID_IDS.FORGOTTEN_KNIGHT:
      value += 1.8 + Math.min(hollowsInGY, 4) * 0.25;
      if (atk > oppStrongestAtk && oppStrongestAtk > 0) value += 0.8;
      break;

    case VOID_IDS.HYDRA_TITAN:
      value += 4.0;
      if (context.hydraProjectedDraws > 0) {
        value += Math.min(context.hydraProjectedDraws, 2) * 0.8;
      }
      break;

    case VOID_IDS.MALICIOUS_DEMON:
      value += 3.6;
      if (hollowsInGY > 0) value += Math.min(hollowsInGY, 4) * 0.45;
      break;

    case VOID_IDS.ARCTURUS:
      value += 4.5;
      if (voidsInGY > 0) value += Math.min(voidsInGY, 8) * 0.3;
      if (voidCount <= 1) value += 1.2;
      else value -= Math.min(voidCount - 1, 4) * 0.6;
      break;

    case VOID_IDS.FALLEN_ARCTURUS:
      value += 4.1;
      if (voidsInGY > 0) value += Math.min(voidsInGY, 3) * 0.35;
      break;

    // Fusion bosses
    case VOID_IDS.HOLLOW_KING:
      value += 3.0;
      break;

    case VOID_IDS.BERSERKER:
      value += 3.5; // 2 ataques é muito forte
      break;

    case VOID_IDS.SHADOW_CRAWLER:
      value += 2.4; // GY setup + targeted removal
      if (oppStrongestAtk >= 2000) value += 0.4;
      break;

    case VOID_IDS.ABERRATION:
      value += 2.8 + Math.min(voidsInGY, 4) * 0.15;
      if (atk > oppStrongestAtk && oppStrongestAtk > 0) value += 0.5;
      break;

    case VOID_IDS.COSMIC_WALKER:
      value += 3.2; // Ascension com death trigger
      break;

    // Outros
    case VOID_IDS.BONE_SPIDER:
      value += 1.5; // Controle + revive Hollow na morte
      break;

    case VOID_IDS.TENEBRIS_HORN:
      value += 1.0 + voidCount * 0.15; // Escala com Voids
      break;

    case VOID_IDS.RAVEN:
      value += 0.8; // Proteção para fusões
      break;

    // Boss escalável de Hollows do GY (mini-Haunter com bounce)
    case VOID_IDS.THOUSAND_ARMS:
      value += 2.4;
      if (hollowsInGY > 0) value += Math.min(hollowsInGY, 2) * 0.4;
      break;

    default:
      if (knowledge?.role === "boss") value += 1.5;
      else if (knowledge?.role === "extender") value += 1.0;
      else if (knowledge?.role === "control") value += 0.8;
  }

  // Bônus/penalidade por posição relativa ao oponente
  if (position === "attack" && atk >= oppStrongestAtk) {
    value += 0.8; // Pode atacar com segurança
  } else if (position === "attack" && atk < oppStrongestAtk - 500) {
    value -= 0.5; // Vulnerável
  }

  // Penalidade se já atacou (menos útil no turno)
  if (monster.hasAttacked) {
    value -= 0.3;
  }

  return value;
}

/**
 * Avaliação completa do board para Void.
 * Usa conceitos de evaluateBoardV2 mas com heurísticas específicas do arquétipo.
 * @param {Object} gameOrState
 * @param {Object} perspectivePlayer
 * @returns {number}
 */
export function evaluateBoardVoid(gameOrState, perspectivePlayer) {
  const perspective = perspectivePlayer?.id
    ? perspectivePlayer
    : gameOrState.bot;
  const opponent =
    gameOrState.player?.id === perspective?.id
      ? gameOrState.bot
      : gameOrState.player;

  let score = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. LP ADVANTAGE
  // ═══════════════════════════════════════════════════════════════════════════
  const myLP = perspective?.lp || 0;
  const oppLP = opponent?.lp || 0;
  const lpDiff = myLP - oppLP;
  score += lpDiff / 650; // Ligeiramente mais agressivo que base

  // Lethal proximity
  if (oppLP <= 2000) score += 3.0;
  else if (oppLP <= 3500) score += 1.5;
  else if (oppLP <= 5000) score += 0.5;

  // Danger penalties
  if (myLP <= 1500) score -= 2.5;
  else if (myLP <= 3000) score -= 1.0;

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. FIELD PRESENCE — Void-specific
  // ═══════════════════════════════════════════════════════════════════════════
  const myField = perspective?.field || [];
  const oppField = opponent?.field || [];
  const myHand = perspective?.hand || [];
  const myGY = perspective?.graveyard || [];
  const myExtra = perspective?.extraDeck || [];

  // Contar recursos Void
  const hollowCount = myField.filter((m) => m?.id === VOID_IDS.HOLLOW).length;
  const voidCount = myField.filter(isVoid).length;
  const hollowsInGY = myGY.filter((m) => m?.id === VOID_IDS.HOLLOW).length;
  const voidsInGY = myGY.filter(isVoid).length;
  const hydraProjectedDraws = countControlledSpellTrapCards(opponent);

  const oppStrongestAtk = oppField.reduce((max, m) => {
    if (!m || m.cardKind !== "monster") return max;
    const atk = m.isFacedown ? 1500 : (m.atk || 0) + (m.tempAtkBoost || 0);
    return Math.max(max, atk);
  }, 0);

  const context = {
    oppStrongestAtk,
    hollowCount,
    voidCount,
    hollowsInGY,
    voidsInGY,
    hydraProjectedDraws,
  };

  // Avaliar meus monstros
  for (const monster of myField) {
    if (!monster || monster.cardKind !== "monster") continue;
    score += evaluateVoidMonster(monster, context);
  }

  // Avaliar monstros do oponente (negativo).
  // Bone Spider lock: monstros com `cannotAttackUntilTurn` no turno atual ou
  // futuro são tratados como ameaça parcial — não podem atacar este turno,
  // mas ainda podem ativar efeitos / ser tributados.
  const currentTurn =
    typeof gameOrState?.turnCounter === "number"
      ? gameOrState.turnCounter
      : 0;
  for (const monster of oppField) {
    if (!monster || monster.cardKind !== "monster") continue;
    const threatScore = calculateThreatScore(monster, {
      myStrongestAtk: Math.max(...myField.map((m) => m?.atk || 0), 0),
      hasDefenses: myField.some((m) => m?.position === "defense"),
    });
    let multiplier = 0.8;
    const lockedThisTurn =
      monster.cannotAttackThisTurn ||
      (typeof monster.cannotAttackUntilTurn === "number" &&
        monster.cannotAttackUntilTurn >= currentTurn);
    if (lockedThisTurn) {
      // Lockado = não pode atacar. Vale ~40% do threat (preserva valor de
      // efeitos / sinergias / futuros turnos quando o lock expira).
      multiplier = 0.32;
    }
    score -= threatScore * multiplier;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. SWARM BONUS — Void quer quantidade
  // ═══════════════════════════════════════════════════════════════════════════
  score += voidCount * 0.6; // Cada Void no campo = +0.6

  // Bônus por Hollows (materiais de fusão principais)
  score += hollowCount * 0.4;

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. COMBO POTENTIAL — Avaliar combos disponíveis
  // ═══════════════════════════════════════════════════════════════════════════
  const analysis = {
    hand: myHand,
    field: myField,
    graveyard: myGY,
    extraDeck: myExtra,
    deck: perspective?.deck || [],
    fieldSpell: perspective?.fieldSpell,
    summonAvailable: (perspective?.summonCount || 0) < 1,
    oppFieldCount: oppField.length,
    oppStrongestAtk,
    myLP,
    oppLP,
  };

  const availableCombos = detectAvailableCombos(analysis);
  const readyCombos = availableCombos.filter((c) => c.ready);

  // Bônus por combos prontos
  for (const combo of readyCombos) {
    const comboValue = (combo.priority || 5) / 10; // Normalizar para ~0.5-1.2
    score += comboValue;
  }

  // Bônus extra por fusões disponíveis
  const fusionReady = readyCombos.filter((c) => c.combo?.fusion);
  if (fusionReady.length > 0) {
    const bestFusion = fusionReady[0];
    score += calculateFusionValue(bestFusion.combo.fusion.target, analysis) / 5;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. HAND ADVANTAGE
  // ═══════════════════════════════════════════════════════════════════════════
  const oppHand = opponent?.hand || [];
  const handDiff = myHand.length - oppHand.length;
  score += handDiff * 0.4;

  // Hand quality — cartas que habilitam combos
  const comboEnablers = myHand.filter((c) => {
    const id = c?.id;
    return (
      id === VOID_IDS.CONJURER ||
      id === VOID_IDS.POLYMERIZATION ||
      id === VOID_IDS.HAUNTER ||
      id === VOID_IDS.HOLLOW
    );
  }).length;
  score += comboEnablers * 0.3;

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. FIELD SPELL
  // ═══════════════════════════════════════════════════════════════════════════
  if (perspective?.fieldSpell?.id === VOID_IDS.THE_VOID) {
    score += 1.0; // The Void é recurso de recovery
  }
  if (opponent?.fieldSpell) {
    score -= 0.8;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. BACKROW
  // ═══════════════════════════════════════════════════════════════════════════
  const myBackrow = perspective?.spellTrap || [];
  const oppBackrow = opponent?.spellTrap || [];
  score += myBackrow.length * 0.2;
  score -= oppBackrow.length * 0.25;

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. HOLLOW ECONOMY — Gerenciamento de Hollows
  // ═══════════════════════════════════════════════════════════════════════════
  const hollowEconomy = analyzeHollowEconomy(analysis);

  // Hollows no GY são úteis se temos como aproveitá-los
  if (hollowsInGY > 0) {
    // Só vale pontos se Haunter disponível ou The Void ativo
    if (hollowEconomy.hasHaunterRevive) {
      score += hollowsInGY * 0.4; // Cada Hollow = material futuro
    } else if (hollowEconomy.hasTheVoidRecovery) {
      score += hollowsInGY * 0.2; // Pode puxar 1 por turno
    } else {
      // GY sem recovery = recursos perdidos
      score -= hollowsInGY * 0.1;
    }
  }

  // Bônus por diversidade de recursos Hollow (campo + mão + GY acessível)
  score += hollowEconomy.totalAccessibleHollows * 0.15;

  const wantsHollowsInGY =
    myField.some((card) =>
      [VOID_IDS.MALICIOUS_DEMON, VOID_IDS.FORGOTTEN_KNIGHT].includes(card?.id),
    ) ||
    myExtra.some((card) => card?.id === VOID_IDS.MALICIOUS_DEMON);
  const arcturusAccessible =
    myField.some((card) => card?.id === VOID_IDS.ARCTURUS) ||
    myHand.some((card) => card?.id === VOID_IDS.ARCTURUS);
  if (wantsHollowsInGY && hollowsInGY > 0) {
    score += Math.min(hollowsInGY, 4) * 0.35;
  }
  if (arcturusAccessible && voidsInGY > 0) {
    score += Math.min(voidsInGY, 8) * 0.15;
  }
  if (
    myField.some((card) => card?.id === VOID_IDS.ARCTURUS) &&
    myField.filter((card) => card && card.cardKind === "monster" && !card.isFacedown)
      .length > 1
  ) {
    score -= 1.4;
  }

  // Penalidade por Hollow "perdido" (no GY sem recovery)
  score -= hollowEconomy.strandedHollows * 0.2;

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. LETHAL CHECK
  // ═══════════════════════════════════════════════════════════════════════════
  if (canOpponentLethal(oppField, myLP, opponent)) {
    score -= 5.0;
  }

  // Check se EU posso dar lethal
  const myTotalAtk = myField
    .filter((m) => m?.position === "attack" && !m?.hasAttacked)
    .reduce((sum, m) => sum + (m?.atk || 0) + (m?.tempAtkBoost || 0), 0);

  if (oppField.length === 0 && myTotalAtk >= oppLP) {
    score += 6.0; // Lethal disponível!
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. TEMPO
  // ═══════════════════════════════════════════════════════════════════════════
  if (myField.length === 0 && oppField.length > 0) {
    score -= 2.0;
  }
  if (oppField.length === 0 && myField.length > 0) {
    score += 1.5;
  }

  return score;
}
