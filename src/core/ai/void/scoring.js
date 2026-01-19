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
  detectAvailableCombos,
  calculateFusionValue,
} from "./combos.js";
import {
  calculateThreatScore,
  canOpponentLethal,
} from "../ThreatEvaluation.js";

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
  const { hand = [], field = [], graveyard = [], extraDeck = [] } = analysis;
  const fieldSpell = analysis.fieldSpell;

  // Contar Hollows em cada zona
  const hollowsInHand = hand.filter((c) => c?.id === VOID_IDS.HOLLOW).length;
  const hollowsOnField = field.filter((c) => c?.id === VOID_IDS.HOLLOW).length;
  const hollowsInGY = graveyard.filter((c) => c?.id === VOID_IDS.HOLLOW).length;

  // Enablers para recuperar Hollows
  const haunterOnField = field.some((c) => c?.id === VOID_IDS.HAUNTER);
  const haunterInHand = hand.some((c) => c?.id === VOID_IDS.HAUNTER);
  const theVoidActive = fieldSpell?.id === VOID_IDS.THE_VOID;

  // Walker pode voltar Hollow do campo para a mão (para re-trigger)
  const walkerInHand = hand.some((c) => c?.id === VOID_IDS.WALKER);

  // Conjurer recruta do DECK (não traz Hollow da mão, mas traz Walker)
  const conjurerInHand = hand.some((c) => c?.id === VOID_IDS.CONJURER);

  // Quantos Hollows podemos acessar de forma útil?
  let accessibleHollows = hollowsInHand; // Mão = sempre acessível

  // Campo: podem ser tributados/usados como material
  accessibleHollows += hollowsOnField;

  // GY: só acessível com Haunter ou The Void
  let accessibleFromGY = 0;
  if (haunterOnField || haunterInHand) {
    // Haunter pode reviver TODOS os Hollows do GY
    accessibleFromGY = hollowsInGY;
  } else if (theVoidActive) {
    // The Void recupera 1 por turno
    accessibleFromGY = Math.min(1, hollowsInGY);
  }
  accessibleHollows += accessibleFromGY;

  // Hollows "perdidos" = no GY sem forma de recuperar
  const strandedHollows = hollowsInGY - accessibleFromGY;

  // Hollows que podem recrutar (na mão e podem ser Special Summoned)
  // Walker permite bounce Hollow do campo → mão → Special Summon novamente
  const canTriggerRecruitment =
    hollowsInHand > 0 || (hollowsOnField > 0 && walkerInHand);

  // Potencial de swarm: quantos Hollows podemos colocar no campo?
  let swarmPotential = hollowsOnField;

  // Cada Hollow na mão = pode SS e recrutar outro (se tiver método de SS)
  if (hollowsInHand > 0 && (walkerInHand || haunterOnField)) {
    // Walker SS Hollow da mão → recruta → 2 Hollows
    swarmPotential += hollowsInHand * 2;
  } else {
    swarmPotential += hollowsInHand; // Precisa encontrar forma de SS
  }

  // Haunter revive todos do GY
  if (haunterOnField || haunterInHand) {
    swarmPotential += hollowsInGY;
  }

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
      value += 2.5; // Banish removal + fusion material
      break;

    case VOID_IDS.SERPENT_DRAKE:
      value += 2.3;
      // Bônus baseado em Hollows tributados (se tiver efeitos ativos)
      if (monster.serpentDrakeBonus) {
        value += monster.serpentDrakeBonus * 0.5;
      }
      break;

    // Fusion bosses
    case VOID_IDS.HOLLOW_KING:
      value += 3.0;
      break;

    case VOID_IDS.BERSERKER:
      value += 3.5; // 2 ataques é muito forte
      break;

    case VOID_IDS.HYDRA_TITAN:
      value += 4.0; // Maior fusão
      break;

    case VOID_IDS.COSMIC_WALKER:
      value += 3.2; // Ascension com death trigger
      break;

    // Outros
    case VOID_IDS.BONE_SPIDER:
      value += 1.5; // Controle + token na morte
      break;

    case VOID_IDS.TENEBRIS_HORN:
      value += 1.0 + voidCount * 0.15; // Escala com Voids
      break;

    case VOID_IDS.RAVEN:
      value += 0.8; // Proteção para fusões
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

  const oppStrongestAtk = oppField.reduce((max, m) => {
    if (!m || m.cardKind !== "monster") return max;
    const atk = m.isFacedown ? 1500 : (m.atk || 0) + (m.tempAtkBoost || 0);
    return Math.max(max, atk);
  }, 0);

  const context = { oppStrongestAtk, hollowCount, voidCount };

  // Avaliar meus monstros
  for (const monster of myField) {
    if (!monster || monster.cardKind !== "monster") continue;
    score += evaluateVoidMonster(monster, context);
  }

  // Avaliar monstros do oponente (negativo)
  for (const monster of oppField) {
    if (!monster || monster.cardKind !== "monster") continue;
    const threatScore = calculateThreatScore(monster, {
      myStrongestAtk: Math.max(...myField.map((m) => m?.atk || 0), 0),
      hasDefenses: myField.some((m) => m?.position === "defense"),
    });
    score -= threatScore * 0.8;
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

  // Penalidade por Hollow "perdido" (no GY sem recovery)
  score -= hollowEconomy.strandedHollows * 0.2;

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. LETHAL CHECK
  // ═══════════════════════════════════════════════════════════════════════════
  if (canOpponentLethal(oppField, myLP)) {
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
