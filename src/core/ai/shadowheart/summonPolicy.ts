/** Shadow-Heart summonPolicy policies; preferences remain owned by the archetype. */
import type { GameCard } from "../../contracts/cards.js";
import { CARD_KNOWLEDGE, isShadowHeartByName } from "./knowledge.js";
import { getTributeRequirementFor as getCanonicalTributeRequirement } from "../common/tributePolicy.js";
import { getEffectiveAtk, getEffectiveDef, getStrongestBattleStat } from "../common/cardStats.js";
import { assessSummonEntry, evaluateProjectedAttackLine } from "../common/summonAssessment.js";
import { fieldHasTributeValue, getTributeCardsFromIndices, getTributeValueTotal, selectTributeIndicesByValue } from "../../game/summon/tributeValue.js";
import { projectShadowHeartEntryStats, hasName, heartbearerCompletesTributeLine, SH, SHADOW_HEART_BOSS_SUMMON_NAMES, SHADOW_HEART_ENGINE_SUMMON_NAMES } from "./policyContext.js";
import type { StrategyCard, FullAnalysis, Player, Context } from "./policyContext.js";

export function assessShadowHeartSummonEntry(card: StrategyCard, context: Context = {}) {
  const base = assessSummonEntry(card, {
    ...context,
    profile: {
      bossNames: SHADOW_HEART_BOSS_SUMMON_NAMES,
      enginePieceNames: SHADOW_HEART_ENGINE_SUMMON_NAMES,
      lowImpactAtk: 1200,
      facedownValue: context.facedownValue ?? 1500,
      defaultReason: "default Shadow-Heart summon assessment",
      projectEntryStats: projectShadowHeartEntryStats,
      ...(context.profile || {}),
    },
  });

  if (!card || card.cardKind !== "monster") return base;

  const atk = base.projectedAtk ?? getEffectiveAtk(card);
  const def = base.projectedDef ?? getEffectiveDef(card);
  const oppField =
    context.oppField ||
    context.opponent?.field ||
    context.analysis?.oppField ||
    [];

  if (context.clearsOpponentBoardOnSummon === true) {
    return {
      ...base,
      shouldSummon: true,
      position: "attack" as const,
      scoreDelta: (base.scoreDelta || 0) + 1.2,
      reason: [
        base.reason,
        "Shadow-Heart removal summon should pressure in attack",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  if (def >= atk) {
    return {
      ...base,
      position: "attack" as const,
      reason: [
        base.reason,
        "Shadow-Heart pressure prefers attack when DEF is not lower",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  const attackLine = evaluateProjectedAttackLine(atk, oppField, {
    facedownValue: context.facedownValue ?? 1500,
  });
  const strongestFaceUpAtk = attackLine.strongestFaceUpAtk;

  return {
    ...base,
    position: attackLine.safeInAttack ? "attack" as const : "defense" as const,
    strongestThreat: Math.max(base.strongestThreat || 0, strongestFaceUpAtk),
    attackLine,
  };
}


export function shouldSummonMonster(card: StrategyCard, analysis: FullAnalysis, tributeInfo: { tributesNeeded: number; usingAlt?: boolean; alt?: (GameCard["altTribute"] & { tributes?: number }) | null | undefined }, context: Context = {}) {
  const name = card.name;
  const knowledge = CARD_KNOWLEDGE[name!];
  const fieldState = context.field || analysis?.field || [];
  const oppFieldState = context.oppField || analysis?.oppField || [];
  const summonAssessment = assessShadowHeartSummonEntry(card, {
    analysis,
    myField: fieldState,
    oppField: oppFieldState,
    phase: analysis?.phase,
  });

  // === SAFETY CHECK: Avaliar se é seguro summon em ATK ===
  const cardATK = getEffectiveAtk(card);
  const cardDEF = getEffectiveDef(card);
  const oppStrongestATK = getStrongestBattleStat(
    (analysis.oppField || []).filter((monster) => !monster?.isFacedown),
    { facedownValue: 0 },
  );
  const oppHasThreats = analysis.oppField.length > 0;

  // Se oponente tem monstro mais forte, não summon em ATK (só se for extender/combo)
  const isSuicideSummon =
    oppHasThreats && cardATK < oppStrongestATK && cardATK > 0;
  const shouldDefensivePosition = isSuicideSummon && cardDEF >= cardATK;

  // Imp - Extender de alta prioridade
  if (name === "Shadow-Heart Imp") {
    const hasTarget = analysis.hand.some(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.type === "monster" &&
        (c.level || 0) <= 4 &&
        c.name !== "Shadow-Heart Imp"
    );
    if (hasTarget) {
      if (isSuicideSummon && !shouldDefensivePosition) {
        return {
          yes: false,
          reason: `Imp seria destruído por ${oppStrongestATK} ATK oponente`,
        };
      }
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 10,
        reason: "Extender para 2 corpos",
      };
    }
    if (isSuicideSummon) {
      return {
        yes: false,
        reason: `Imp 1500 ATK vs oponente ${oppStrongestATK} ATK = suicide`,
      };
    }
    return {
      yes: true,
      position: "attack" as const,
      priority: 4,
      reason: "Beater de 1500",
    };
  }

  if (name === "Shadow-Heart Heartbearer") {
    const enablesTributeLine = heartbearerCompletesTributeLine(analysis);
    const hasTributeBossInHand = (analysis.hand || []).some(
      (candidate) =>
        candidate &&
        candidate !== card &&
        isShadowHeartByName(candidate.name) &&
        (candidate.level || 0) >= 7,
    );
    const protectsAlly = (fieldState || []).some(
      (monster) =>
        monster &&
        monster.name !== "Shadow-Heart Heartbearer" &&
        isShadowHeartByName(monster.name),
    );
    return {
      yes: true,
      position: "attack" as const,
      priority: enablesTributeLine ? 12 : hasTributeBossInHand ? 9 : protectsAlly ? 7 : 4,
      reason: enablesTributeLine
        ? "Completa linha de Tribute Summon Shadow-Heart"
        : hasTributeBossInHand
          ? "Enabler de Tribute Summon Shadow-Heart"
          : protectsAlly
          ? "Protege/revive outro Shadow-Heart"
          : "Setup Shadow-Heart flexivel",
    };
  }

  // Leviathan - Boss 2600 ATK com efeitos de burn
  if (name === "Shadow-Heart Leviathan") {
    if (!fieldHasTributeValue(fieldState, tributeInfo.tributesNeeded, card)) {
      return {
        yes: false,
        reason: `Requer ${tributeInfo.tributesNeeded} tributos (tenho ${analysis.field.length})`,
      };
    }
    if (tributeInfo.tributesNeeded > 0) {
      const tradeCheck = evaluateTributeTrade(
        card,
        fieldState,
        tributeInfo.tributesNeeded,
        { oppField: oppFieldState },
      );
      if (!tradeCheck.ok) {
        return {
          yes: false,
          reason: tradeCheck.reason,
        };
      }
    }
    const hasLeviathanLine =
      hasName(analysis.hand, SH.leviathan) ||
      (analysis.oppField || []).length === 0 ||
      (analysis.game?.turnCounter || 0) <= 2;
    return {
      yes: true,
      position: "attack" as const,
      priority: hasLeviathanLine ? 9 : 8,
      reason: hasLeviathanLine
        ? "Pressao e linha Eel -> Leviathan"
        : "Boss 2600 ATK + burn damage",
    };
  }

  // Griffin - 2000 ATK, pode invocar sem tributo sob certas condições
  if (name === "Shadow-Heart Griffin") {
    // Griffin tem altTribute que permite invocar com menos tributos
    const actualTributes = tributeInfo.tributesNeeded;
    if (!fieldHasTributeValue(fieldState, actualTributes, card)) {
      return {
        yes: false,
        reason: `Requer ${actualTributes} tributos (tenho ${analysis.field.length})`,
      };
    }
    if (actualTributes > 0) {
      const tradeCheck = evaluateTributeTrade(
        card,
        fieldState,
        actualTributes,
        { oppField: oppFieldState }
      );
      if (!tradeCheck.ok) {
        return {
          yes: false,
          reason: tradeCheck.reason,
        };
      }
    }
    return {
      yes: true,
      position: "attack" as const,
      priority: 7,
      reason: actualTributes === 0 ? "2000 ATK sem tributo!" : "2000 ATK",
    };
  }

  // Specter - Recursivo (adiciona do GY à mão)
  if (name === "Shadow-Heart Specter") {
    const hasGYTargets = analysis.graveyard.filter(
      (c) => isShadowHeartByName(c.name) && c.name !== "Shadow-Heart Specter"
    );
    if (hasGYTargets.length > 0) {
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 5,
        reason: "Recursão: adiciona Shadow-Heart do GY à mão",
      };
    }
    return {
      yes: true,
      position: "defense" as const,
      priority: 2,
      reason: "1800 ATK (setup futuro para recursão)",
    };
  }

  // Void Mage - Searcher de spell/trap com prioridade alta
  if (name === "Shadow-Heart Void Mage") {
    // Prioridade alta T1 ou quando não temos spells-chave
    const hasKeySpells = analysis.hand.some((c) =>
      [
        "Darkness Valley",
        "Shadow-Heart Covenant",
        "Shadow-Heart Shield",
        "Court of the Dead",
      ].includes(c.name!)
    );
    const hasDarknessValley = (analysis.spellTrapZone || []).some(
      (c) => c.name === "Darkness Valley"
    );

    if (!hasDarknessValley && !hasKeySpells) {
      // Altíssima prioridade se não temos setup
      // SEMPRE face-up para disparar efeito de busca (on_event after_summon requires face-up)
      // REGRA: facedown só existe com position="defense", então invocamos em attack para efeito
      const needsDefense = isSuicideSummon && shouldDefensivePosition;
      return {
        yes: true,
        // Se precisamos de defesa, invocamos em attack mesmo assim para buscar
        // O efeito de busca é mais importante que sobreviver
        position: "attack" as const,
        priority: 13,
        reason: "Buscar spell-chave (Darkness Valley/Covenant/Shield)",
      };
    }

    // Prioridade média se já temos spells
    if (isSuicideSummon) {
      // Se já temos as spells, podemos setar em defesa (facedown)
      // Nesse caso perdemos o efeito de busca, mas já temos o que precisamos
      return {
        yes: shouldDefensivePosition,
        position: "defense" as const,
        // REGRA DO JOGO: defense = sempre facedown
        priority: shouldDefensivePosition ? 12 : 0,
        reason: shouldDefensivePosition
          ? "Searcher em DEF (set)"
          : "Void Mage seria destruído",
      };
    }

    return {
      yes: true,
      position: "attack" as const,
      priority: 12,
      reason: "Searcher de spells + draw engine",
    };
  }

  // Scale Dragon - Boss principal
  if (name === "Shadow-Heart Scale Dragon") {
    if (fieldHasTributeValue(fieldState, tributeInfo.tributesNeeded, card)) {
      if (tributeInfo.tributesNeeded > 0) {
        const tradeCheck = evaluateTributeTrade(
          card,
          fieldState,
          tributeInfo.tributesNeeded,
          { oppField: oppFieldState },
        );
        if (!tradeCheck.ok) {
          return {
            yes: false,
            reason: tradeCheck.reason,
          };
        }
      }
      return {
        yes: true,
        position: "attack" as const,
        priority: 10,
        reason: "Boss de 3000 ATK!",
      };
    }
  }

  // Demon Arctroth - Boss com remoção
  if (name === "Shadow-Heart Demon Arctroth") {
    if (
      fieldHasTributeValue(fieldState, tributeInfo.tributesNeeded, card) &&
      analysis.oppField.length > 0
    ) {
      // PRIORIDADE ALTA: Ameaça battle-indestructible que só pode ser removida por efeito
      const hasBattleIndestructible = analysis.oppField.some(
        (m) => m.battleIndestructible || m.cannotBeDestroyedByBattle
      );

      if (hasBattleIndestructible) {
        return {
          yes: true,
          position: "attack" as const,
          priority: 15, // Prioridade muito alta - única forma de remover
          reason: "Remover ameaça battle-indestructible (única solução)",
        };
      }

      // Verificar se já temos lethal com os monstros atuais
      const fieldMonsters = analysis.field.filter(
        (c) => c?.cardKind === "monster"
      );
      const totalCurrentATK = fieldMonsters.reduce(
        (sum, m) => sum + (m.atk || 0),
        0
      );
      const oppTotalDEF = analysis.oppField.reduce((sum, m) => {
        const isDefense = m.position === "defense";
        return sum + (isDefense ? m.def || 0 : m.atk || 0);
      }, 0);
      const potentialDamage = Math.max(0, totalCurrentATK - oppTotalDEF);

      // Se já temos lethal com o campo atual, não tributar desnecessariamente
      if (potentialDamage >= analysis.oppLp && fieldMonsters.length > 0) {
        return {
          yes: false,
          reason: `Já tenho lethal com campo atual (${potentialDamage} dano >= ${analysis.oppLp} LP)`,
        };
      }

      // Se tributos reduzem muito ATK, só invocar se realmente necessário
      const projectedTributeIndices = selectBestTributes(
        fieldMonsters,
        tributeInfo.tributesNeeded,
        card,
        { oppField: oppFieldState },
      );
      const tributeATK = projectedTributeIndices
        .map((index) => fieldMonsters[index])
        .filter((monster): monster is StrategyCard => Boolean(monster))
        .reduce((sum, m) => sum + (m.atk || 0), 0);
      const summonATK = card.atk || 0;
      const atkLoss = tributeATK - summonATK;

      if (atkLoss > 1000) {
        // Perdendo muito ATK no trade, só vale se remove ameaça crítica
        const strongestThreat = analysis.oppField.reduce<{ atk?: number | undefined }>(
          (max, c) => ((c.atk || 0) > (max.atk || 0) ? c : max),
          { atk: 0 }
        );
        if ((strongestThreat.atk || 0) < 2000) {
          return {
            yes: false,
            reason: `Perderia ${atkLoss} ATK tributando, ameaça não é crítica`,
          };
        }
      }

      return {
        yes: true,
        position: "attack" as const,
        priority: 9,
        reason: "Destruir monstro oponente + 2600 ATK",
      };
    }
  }

  // Griffin - Sem tributo se campo vazio
  if (name === "Shadow-Heart Griffin") {
    if (analysis.field.length === 0) {
      return {
        yes: true,
        position: "attack" as const,
        priority: 8,
        reason: "2000 ATK sem tributo!",
      };
    }
  }

  // Gecko - Draw engine
  if (name === "Shadow-Heart Gecko") {
    if (analysis.field.some((c) => (c.atk || 0) >= 1800)) {
      if (isSuicideSummon) {
        return {
          yes: true,
          position: "defense" as const,
          priority: 4,
          reason: "Draw engine (defesa por safety)",
        };
      }
      return {
        yes: true,
        position: "attack" as const,
        priority: 5,
        reason: "Draw engine passivo",
      };
    }
  }

  // Specter - Recursão
  if (name === "Shadow-Heart Specter") {
    if (analysis.graveyard.length > 0) {
      if (isSuicideSummon && !shouldDefensivePosition) {
        return {
          yes: false,
          reason: `Specter 1500 ATK seria destruído por ${oppStrongestATK} ATK`,
        };
      }
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 5,
        reason: "Futuro recurso de GY",
      };
    }
  }

  // Abyssal Eel - CASO ESPECÍFICO (1600 ATK burn)
  if (name === "Shadow-Heart Abyssal Eel") {
    if (isSuicideSummon) {
      return {
        yes: false,
        reason: `Eel 1600 ATK vs oponente ${oppStrongestATK} ATK = perda de monstro + burn inútil`,
      };
    }
    const hasLeviathanInHand = hasName(analysis.hand, SH.leviathan);
    const pressureLine =
      hasLeviathanInHand ||
      (analysis.oppField || []).length === 0 ||
      (analysis.game?.turnCounter || 0) <= 2;
    return {
      yes: true,
      position: "attack" as const,
      priority: pressureLine ? 8 : 5,
      reason: pressureLine
        ? "Starter de pressao e ponte para Leviathan"
        : "Beater 1600 + burn",
    };
  }

  // Monstro genérico
  const baseAtk = card.atk || 0;
  if (baseAtk >= 1500 && tributeInfo.tributesNeeded === 0) {
    if (isSuicideSummon) {
      if (shouldDefensivePosition) {
        return {
          yes: true,
          position: "defense" as const,
          priority: 3,
          reason: `DEF ${cardDEF} vs oponente ${oppStrongestATK} ATK`,
        };
      }
      return {
        yes: false,
        reason: `${baseAtk} ATK vs oponente ${oppStrongestATK} ATK = suicide`,
      };
    }
    return {
      yes: true,
      position: summonAssessment.position || "attack",
      priority: 4,
      reason: `Beater de ${baseAtk}`,
    };
  }

  if (
    tributeInfo.tributesNeeded > 0 &&
    fieldHasTributeValue(fieldState, tributeInfo.tributesNeeded, card)
  ) {
    const tradeCheck = evaluateTributeTrade(
      card,
      fieldState,
      tributeInfo.tributesNeeded,
      { oppField: oppFieldState }
    );
    if (!tradeCheck.ok) {
      return {
        yes: false,
        reason: tradeCheck.reason,
      };
    }
    return {
      yes: true,
      position: "attack" as const,
      priority: 5,
      reason: `Tribute Summon de ${baseAtk}`,
    };
  }

  // Monstro fraco em defesa
  if (baseAtk < 1500) {
    return {
      yes: true,
      position: "defense" as const,
      priority: 2,
      reason: "Defesa/material",
    };
  }

  return { yes: false, reason: "Não vale a pena agora" };
}

/**
 * Avalia melhor tributos para um Tribute Summon.
 * Menor valor = melhor tributo.
 * @param {Array} field
 * @param {number} tributesNeeded
 * @param {Object} [cardToSummon]
 * @param {Object} [context] - Contexto adicional (oppField, game state)
 * @returns {number[]} Índices dos monstros a tributar
 */

export function selectBestTributes(
  field: StrategyCard[],
  tributesNeeded: number,
  cardToSummon: StrategyCard | null = null,
  context: Context = {}
) {
  if (
    tributesNeeded <= 0 ||
    !fieldHasTributeValue(field || [], tributesNeeded, cardToSummon)
  ) {
    return [];
  }

  // CASO ESPECIAL: Demon Arctroth vs battle-indestructible
  // Permitir tributar monstros mais fortes se for a única forma de remover ameaça
  const isDemonArctroth = cardToSummon?.name === "Shadow-Heart Demon Arctroth";
  const hasBattleIndestructibleThreat = context.oppField?.some(
    (m) => m.battleIndestructible || m.cannotBeDestroyedByBattle
  );
  const isEmergencyRemoval = isDemonArctroth && hasBattleIndestructibleThreat;

  return selectTributeIndicesByValue(field || [], tributesNeeded, cardToSummon, {
    scoreCard: (monster) => getTributeValue(monster, { isEmergencyRemoval }),
  });
}


export function isExtraDeckBoss(monster: StrategyCard) {
  const monsterType = monster?.monsterType;
  const knowledge = CARD_KNOWLEDGE[monster?.name!];
  return (
    monsterType === "fusion" ||
    monsterType === "ascension" ||
    knowledge?.role === "fusion_boss" ||
    knowledge?.role === "ascension_boss"
  );
}


function isPremiumShadowHeartMonster(monster: StrategyCard) {
  const knowledge = CARD_KNOWLEDGE[monster?.name!];
  return (
    knowledge?.role === "boss" ||
    knowledge?.role === "fusion_boss" ||
    knowledge?.role === "ascension_boss" ||
    monster?.monsterType === "fusion" ||
    monster?.monsterType === "ascension"
  );
}


function getTributeValue(monster: StrategyCard, context: Context = {}) {
  const isEmergencyRemoval = !!context.isEmergencyRemoval;
  let value = 0;
  const knowledge = CARD_KNOWLEDGE[monster.name!];

  value += (monster.atk || 0) / 400;
  value += (monster.level || 0) * 0.15;

  if (monster.name === "Shadow-Heart Demon Dragon") {
    value += isEmergencyRemoval ? 40 : 100;
  }

  if (monster.name === "Shadow-Heart Scale Dragon") {
    value += isEmergencyRemoval ? 35 : 80;
  }

  if (monster.name === "Shadow-Heart Demon Arctroth") {
    value += isEmergencyRemoval ? 30 : 70;
  }

  if (monster.name === "Shadow-Heart Death Wyrm") {
    value += isEmergencyRemoval ? 20 : 50;
  }

  if (monster.name === "Shadow-Heart Leviathan") {
    value += isEmergencyRemoval ? 18 : 45;
  }

  if (isPremiumShadowHeartMonster(monster)) {
    value += isEmergencyRemoval ? 25 : 60;
  }

  if (knowledge?.ascensionTarget) {
    value += isEmergencyRemoval ? 20 : 50;
  }

  if (monster.name === "Shadow-Heart Griffin") value += 3;
  if (monster.name === "Shadow-Heart Gecko") value += 2;

  if (monster.name === "Shadow-Heart Specter") value -= 5;

  if (monster.isToken || monster.name!.includes("Token")) value -= 10;

  if (monster.hasAttacked) value -= 2;

  return value;
}


export function evaluateTributeTrade(
  cardToSummon: StrategyCard | null,
  field: StrategyCard[],
  tributesNeeded: number,
  context: Context = {}
) {
  if (!cardToSummon || tributesNeeded <= 0) {
    return { ok: true };
  }

  const fieldMonsters = (field || []).filter(
    (card) => card && card.cardKind !== "spell" && card.cardKind !== "trap"
  );
  if (!fieldHasTributeValue(fieldMonsters, tributesNeeded, cardToSummon)) {
    return { ok: false as const, reason: "Tributos insuficientes" };
  }

  const isDemonArctroth = cardToSummon?.name === "Shadow-Heart Demon Arctroth";
  const hasBattleIndestructibleThreat = context.oppField?.some(
    (m) => m.battleIndestructible || m.cannotBeDestroyedByBattle
  );
  const isEmergencyRemoval = isDemonArctroth && hasBattleIndestructibleThreat;

  const tributeIndices = selectBestTributes(
    fieldMonsters,
    tributesNeeded,
    cardToSummon,
    context
  );

  const tributes = getTributeCardsFromIndices(fieldMonsters, tributeIndices);

  if (getTributeValueTotal(tributes, cardToSummon) < tributesNeeded) {
    return { ok: false as const, reason: "Sem tributos validos" };
  }

  const tributeCost = tributes.reduce(
    (sum, monster) => sum + getTributeValue(monster, { isEmergencyRemoval }),
    0
  );
  const summonValue = getTributeValue(cardToSummon, {});

  const summonIsPremium = isPremiumShadowHeartMonster(cardToSummon);
  const tributeHasExtraDeckBoss = tributes.some((monster) =>
    isExtraDeckBoss(monster)
  );

  if (
    tributeHasExtraDeckBoss &&
    !isExtraDeckBoss(cardToSummon) &&
    !isEmergencyRemoval
  ) {
    return {
      ok: false as const,
      reason: "Nao vale tributar Fusion/Ascension boss para invocar monstro de Main Deck",
    };
  }

  const tributeHasPremium = tributes.some((monster) => {
    const tribKnowledge = CARD_KNOWLEDGE[monster.name!];
    const tribIsPremium =
      isPremiumShadowHeartMonster(monster) || tribKnowledge?.ascensionTarget;
    return (
      tribIsPremium ||
      monster.name === "Shadow-Heart Demon Dragon" ||
      monster.name === "Shadow-Heart Scale Dragon" ||
      monster.name === "Shadow-Heart Demon Arctroth"
    );
  });

  if (tributeHasPremium && !summonIsPremium) {
    return {
      ok: false as const,
      reason: "Nao vale tributar boss para invocar monstro menor",
    };
  }

  const costRatio = tributeCost / Math.max(1, summonValue);
  const costDelta = tributeCost - summonValue;
  const badValueTrade = costDelta >= 25 && costRatio >= 1.4;

  if (badValueTrade) {
    return {
      ok: false as const,
      reason: "Tribute Summon com custo alto demais",
    };
  }

  return { ok: true };
}

/**
 * Calcula requisito de tributos para um card.
 * @param {Object} card
 * @param {Object} playerState
 * @returns {{ tributesNeeded: number, alt: Object|null }}
 */

export function getTributeRequirementFor(card: StrategyCard, playerState: Player) {
  return getCanonicalTributeRequirement(card, playerState);
}
