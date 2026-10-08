/** Shadow-Heart priorities policies; preferences remain owned by the archetype. */
import { CARD_KNOWLEDGE, isShadowHeartByName, isShadowHeart } from "./knowledge.js";
import { assessShadowHeartResourceRecovery } from "./resourceEconomy.js";
import { evaluateCathedralPlacement } from "./cathedralPolicy.js";
import { evaluateShadowHeartFusionPlan } from "./offensivePlanning.js";
import { isShadowHeartDragon, hasName, isCovenantLive, SH } from "./policyContext.js";
import type { StrategyCard, FullAnalysis } from "./policyContext.js";
import { chooseCovenantSearchTarget, pickInfusionEmergencyRevive } from "./targeting.js";

export function shouldPlaySpell(card: StrategyCard, analysis: FullAnalysis) {
  const name = card.name;
  const knowledge = CARD_KNOWLEDGE[name!];

  // Polymerization - Detecta fusoes Shadow-Heart viaveis (nao Ascensoes!)
  if (name === "Polymerization") {
    const fusionPlan = evaluateShadowHeartFusionPlan(analysis);

    if (fusionPlan?.targetName) {
      return {
        yes: true,
        priority: fusionPlan.details?.spellPriority || 9,
        reason: fusionPlan.reason,
      };
    }

    if (fusionPlan?.kind === "fusion_hold") {
      return { yes: false, reason: fusionPlan.reason };
    }

    return {
      yes: false,
      reason:
        "Sem materiais para fusao Shadow-Heart (Demon Dragon: Scale + Lv8+; Warlord: 2 SH)",
    };
  }

  // Darkness Valley - Primeiro se tiver monstros Shadow-Heart
  if (name === "Darkness Valley") {
    if (analysis.fieldSpell) {
      return { yes: false, reason: "Já tenho field spell" };
    }
    const shMonsters = analysis.hand.filter(
      (c) => isShadowHeartByName(c.name) && c.type === "monster"
    );
    if (
      analysis.field.some((c) => isShadowHeartByName(c.name)) ||
      shMonsters.length > 0
    ) {
      return { yes: true, priority: 10, reason: "Vai buffar meus monstros" };
    }
    return { yes: false, reason: "Sem monstros Shadow-Heart para buffar" };
  }

  // Shadow-Heart Rage - Dragon Shadow-Heart combat push
  if (name === "Shadow-Heart Rage") {
    // ⚠️ TIMING: Rage é buff de ATK - só útil antes da Battle Phase
    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: Battle Phase já passou (buff ATK inútil)",
      };
    }

    const rageTargets = analysis.field
      .filter((card) => isShadowHeartDragon(card) && !card.cannotAttackThisTurn)
      .sort((a, b) => (b.atk || 0) - (a.atk || 0));

    const target = rageTargets[0];
    if (target) {
      return {
        yes: true,
        priority: target.name === "Shadow-Heart Scale Dragon" ? 10 : 9,
        reason: `Push de batalha com ${target.name}`,
      };
    }
    return {
      yes: false,
      reason: "Sem Dragao Shadow-Heart apto para atacar",
    };
  }

  // Shadow-Heart Infusion - Avaliação dinâmica de custo/benefício
  if (name === "Shadow-Heart Infusion") {
    if (analysis.hand.length < 3) {
      return { yes: false, reason: "Preciso de 2 cartas para descartar" };
    }
    const shInGY = analysis.graveyard.filter((c) => c.cardKind === "monster");
    const nonInfusionHand = analysis.hand.filter((c) => c.name !== SH.infusion);
    const hasBetterNormalLine =
      hasName(analysis.hand, SH.voidMage) ||
      hasName(analysis.hand, SH.imp) ||
      hasName(analysis.hand, SH.eel) ||
      hasName(analysis.hand, SH.valley) ||
      hasName(analysis.hand, SH.cathedral);

    if (shInGY.length === 0) {
      // Sem SH monster no GY: só ativar se puder descartar 1 monstro revivível como custo.
      // Linha normal preferida — evita gastar Infusion desnecessariamente.
      if (hasBetterNormalLine) {
        return { yes: false, reason: "Sem SH no GY — linha normal disponível" };
      }
      const emergencyRevive = pickInfusionEmergencyRevive(nonInfusionHand, analysis);
      if (!emergencyRevive) {
        return {
          yes: false,
          reason: "Sem SH no GY e sem monstro Shadow-Heart revivível na mão",
        };
      }
      // Precisamos de pelo menos 2 cartas além da Infusion (monstro + 2º descarte)
      if (nonInfusionHand.length < 2) {
        return { yes: false, reason: "Sem segunda carta para o descarte emergencial" };
      }
      const damagePenalty =
        analysis.phase !== "main2" &&
        (analysis.oppField || []).length === 0 &&
        (analysis.oppLp || 8000) <= (emergencyRevive.atk || 0);
      return {
        yes: true,
        priority: damagePenalty ? 6 : 8,
        reason: `Starter emergencial: forçar ${emergencyRevive.name} no descarte e reviver`,
      };
    }

    // GY tem SH monster — avaliar custo/benefício do revival
    const handValues = analysis.hand
      .filter((c) => c.name !== SH.infusion)
      .map((c) => ({
        card: c,
        value: CARD_KNOWLEDGE[c.name!]?.value || 0,
      }))
      .sort((a, b) => a.value - b.value); // Menor valor primeiro para descartar

    const bestRevival = shInGY.slice().sort((a, b) => {
      const valA = CARD_KNOWLEDGE[a.name!]?.value || 0;
      const valB = CARD_KNOWLEDGE[b.name!]?.value || 0;
      return valB - valA;
    })[0];
    const worstCard = handValues[0];
    if (!bestRevival || !worstCard) {
      return { yes: false, reason: "Sem alvo ou custo válido para revival" };
    }
    const revivalValue = CARD_KNOWLEDGE[bestRevival.name!]?.value || 0;

    const discardCost = worstCard.value;

    // Bônus: Specter/Coward têm efeito ao serem descartados
    const hasValueDiscard =
      worstCard.card.name === SH.specter || worstCard.card.name === SH.coward;
    const netValue = revivalValue - discardCost + (hasValueDiscard ? 1 : 0);

    if (netValue > 0) {
      const recoveryAssessment = assessShadowHeartResourceRecovery(analysis, {
        mode: "revive",
      });
      const recoveryBonus = Math.max(
        0,
        Math.min(2, recoveryAssessment.scoreDelta || 0),
      );
      return {
        yes: true,
        priority: (hasValueDiscard ? 8 : 6) + recoveryBonus,
        reason:
          `Reviver ${bestRevival.name} (val:${revivalValue}) > descartar ${worstCard.card.name} (val:${discardCost})` +
          (recoveryBonus > 0 ? "; economia SH favorece revival" : ""),
      };
    }

    return {
      yes: false,
      reason: `Revival ${bestRevival.name} (${revivalValue}) NÃO vale descartar ${worstCard.card.name} (${discardCost})`,
    };
  }

  // Shadow-Heart Covenant - Searcher genérico (custo: 800 LP)
  if (name === "Shadow-Heart Covenant") {
    if (!isCovenantLive(analysis)) {
      return {
        yes: false,
        reason: "Covenant requer controlar nenhum outro card",
      };
    }

    // Prioridade MÁXIMA em T1-T2 para buscar peças antes de outras ações
    const turnCounter = analysis.game?.turnCounter || 0;
    const isEarlyGame = turnCounter <= 2;

    // Threshold reduzido: 1200 LP (800 custo + 400 margem mínima)
    if (analysis.lp <= 1200) {
      return {
        yes: false,
        reason: `LP crítico (${analysis.lp}) para pagar 800`,
      };
    }

    const searchPlan = chooseCovenantSearchTarget([], analysis);

    // Em T1-T2, SEMPRE ativar antes de qualquer desenvolvimento de board
    // Garante buscar peças ANTES de fazer fusion
    if (isEarlyGame) {
      return {
        yes: true,
        priority: 24,
        reason: `T${turnCounter}: Buscar peça PRIMEIRO (setup ideal)`,
      };
    }

    if (!isEarlyGame) {
      return {
        yes: true,
        priority: 21,
        reason: `Buscar peca chave antes de desenvolver board (${searchPlan.reason})`,
      };
    }

    // T3+: Priority normal (7), sem bloqueio por LP
    return { yes: true, priority: 7, reason: "Buscar peça chave do combo" };
  }

  // Shadow-Heart Cathedral - long-term engine; Covenant still outranks it.
  if (name === "Shadow-Heart Cathedral") {
    const cathedralPlan = evaluateCathedralPlacement(analysis);
    if (!cathedralPlan.shouldActivate) {
      return { yes: false, reason: cathedralPlan.reason };
    }
    return {
      yes: true,
      priority: cathedralPlan.priority,
      reason: cathedralPlan.reason,
    };
  }

  // Shadow-Heart Battle Hymn - Buff em monstros Shadow-Heart
  if (name === "Shadow-Heart Battle Hymn") {
    // ⚠️ TIMING: Battle Hymn só é útil ANTES da Battle Phase
    // Se estamos em main2, já passou a battle phase - desperdiçar recurso!
    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: Battle Phase já passou (buff inútil)",
      };
    }

    const shOnField = analysis.field.filter(
      (c) => isShadowHeartByName(c.name) && !c.cannotAttackThisTurn,
    );

    if (shOnField.length === 0) {
      return { yes: false, reason: "Sem Shadow-Heart que possa atacar este turno" };
    }

    // Calcular potencial de dano com buff
    const totalATKBuff = shOnField.length * 500;
    const oppLP = analysis.oppLp || 8000;
    const currentATK = shOnField.reduce((sum, m) => sum + (m.atk || 0), 0);
    const buffedATK = currentATK + totalATKBuff;
    const canPushLethal = analysis.oppField.length === 0 && buffedATK >= oppLP;

    // Se pode fazer lethal com o buff, usar mesmo com 1 monstro
    if (canPushLethal) {
      return {
        yes: true,
        priority: 12,
        reason: `+${totalATKBuff} ATK total = ${buffedATK} ATK (LETHAL!)`,
      };
    }

    // Senão, exigir 2+ monstros para não desperdiçar
    if (shOnField.length >= 2) {
      const priority = totalATKBuff >= oppLP / 2 ? 8 : 5;
      return {
        yes: true,
        priority,
        reason: `+500 ATK para ${shOnField.length} monstros${
          totalATKBuff >= oppLP / 2 ? " (LETHAL PUSH)" : ""
        }`,
      };
    }

    return {
      yes: false,
      reason: "Preciso de 2+ Shadow-Heart no campo (ou lethal opportunity)",
    };
  }

  // Shadow-Heart Purge - permanent debuff with a destruction-dependent follow-up.
  if (name === "Shadow-Heart Purge") {
    const shadowHeartCardsInHand = analysis.hand.filter(
      (c) => isShadowHeart(c) || isShadowHeartByName(c.name),
    );
    const discardAvailable =
      shadowHeartCardsInHand.length > (isShadowHeartByName(card.name) ? 1 : 0);
    if (!discardAvailable) {
      return { yes: false, reason: "Sem Shadow-Heart para descartar" };
    }

    const faceUpOpponents = analysis.oppField.filter(
      (c) => c && c.cardKind === "monster" && !c.isFacedown,
    );
    if (faceUpOpponents.length === 0) {
      return { yes: false, reason: "Oponente sem monstros face-up" };
    }

    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: preservar Purge para aproveitar o debuff e a possivel destruicao em combate",
      };
    }

    const attackers = analysis.field.filter(
      (c) =>
        c &&
        c.cardKind === "monster" &&
        (isShadowHeart(c) || isShadowHeartByName(c.name)) &&
        !c.isFacedown &&
        c.position === "attack" &&
        !c.cannotAttackThisTurn &&
        !c.hasAttacked,
    );

    if (attackers.length === 0) {
      return {
        yes: false,
        reason: "Sem atacante Shadow-Heart pronto para aproveitar o debuff",
      };
    }

    const attackTargets = faceUpOpponents.filter(
      (target) => target.position !== "defense",
    );
    const combatSwing = attackTargets.some((target) => {
      const currentAtk = target.atk || 0;
      const debuffedAtk = Math.max(0, currentAtk - 1000);
      return attackers.some((attacker) => {
        const atk = attacker.atk || 0;
        return atk <= currentAtk && atk > debuffedAtk;
      });
    });

    if (combatSwing) {
      return {
        yes: true,
        priority: 6,
        reason: "Purge abre uma troca de batalha favoravel neste turno",
      };
    }

    const relevantDamage = attackTargets.some((target) => {
      const currentAtk = target.atk || 0;
      const debuffedAtk = Math.max(0, currentAtk - 1000);
      return attackers.some((attacker) => {
        const atk = attacker.atk || 0;
        const before = atk > currentAtk ? atk - currentAtk : 0;
        const after = atk > debuffedAtk ? atk - debuffedAtk : 0;
        return after >= analysis.oppLp || after - before >= 1000;
      });
    });

    if (relevantDamage) {
      return {
        yes: true,
        priority: 4,
        reason: "Purge aumenta dano relevante antes da batalha",
      };
    }

    return {
      yes: false,
      reason: "Nenhum alvo gera ganho real de combate neste turno",
    };
  }

  // Shadow-Heart Shield - Proteção flexível (não só boss)
  if (name === "Shadow-Heart Shield") {
    // Verificar se há monstros face-up disponíveis
    const hasFaceUpMonsters = analysis.field.some(
      (c) => c.cardKind === "monster" && !c.isFacedown
    );

    if (!hasFaceUpMonsters) {
      return { yes: false, reason: "Sem monstros face-up para equipar" };
    }

    const hasBoss = analysis.field.some(
      (c) =>
        !c.isFacedown &&
        [
          "Shadow-Heart Scale Dragon",
          "Shadow-Heart Demon Arctroth",
          "Shadow-Heart Demon Dragon",
        ].includes(c.name!)
    );

    const strongBody = analysis.field.some(
      (c) => !c.isFacedown && (c.atk || 0) >= 1800
    );

    const anyMonster = analysis.field.some(
      (c) => c.cardKind === "monster" && !c.isFacedown
    );

    if (hasBoss) {
      return { yes: true, priority: 5, reason: "Proteger boss com shield" };
    }

    if (strongBody) {
      return {
        yes: true,
        priority: 4,
        reason: "Proteger atacante/defensor >1800 ATK",
      };
    }

    if (anyMonster && analysis.oppField.some((m) => (m.atk || 0) > 0)) {
      return {
        yes: true,
        priority: 3,
        reason: "Proteger board pequeno de troca ruim",
      };
    }

    return { yes: false, reason: "Sem alvo útil para o shield" };
  }

  // The Shadow Heart - Comeback card (requer campo vazio)
  if (name === "The Shadow Heart") {
    // Só ativar se campo estiver vazio (requisito da carta)
    if (analysis.field.length > 0) {
      return { yes: false, reason: "Requer campo vazio para ativar" };
    }

    // Verificar se há Shadow-Heart no cemitério
    const shInGY = analysis.graveyard.filter(
      (c) => c.cardKind === "monster" && isShadowHeartByName(c.name)
    );

    if (shInGY.length === 0) {
      return { yes: false, reason: "Sem Shadow-Heart no GY para reviver" };
    }

    // Priorizar se há boss no cemitério
    const hasBossInGY = shInGY.some((c) =>
      [
        "Shadow-Heart Scale Dragon",
        "Shadow-Heart Demon Arctroth",
        "Shadow-Heart Leviathan",
        "Shadow-Heart Death Wyrm",
      ].includes(c.name!)
    );

    const revivalTarget = shInGY[0];
    if (!revivalTarget) {
      return { yes: false, priority: 0, reason: "Sem alvo Shadow-Heart no Cemitério" };
    }
    const targetName = revivalTarget.name;
    const targetATK = revivalTarget.atk || 0;

    if (hasBossInGY) {
      return {
        yes: true,
        priority: 11,
        reason: `COMEBACK! Reviver ${targetName} (${targetATK} ATK) após board wipe`,
      };
    }

    // Se não há boss, mas há monstro médio/alto ATK, ainda vale
    if (targetATK >= 1800) {
      return {
        yes: true,
        priority: 9,
        reason: `Reviver ${targetName} (${targetATK} ATK) - recovery sólido`,
      };
    }

    // Monstro fraco só se não tiver outra opção
    return {
      yes: true,
      priority: 6,
      reason: `Reviver ${targetName} (última opção)`,
    };
  }

  // Spells genéricos com knowledge
  if (knowledge) {
    return {
      yes: true,
      priority: knowledge.priority || 3,
      reason: "Spell utilizável",
    };
  }

  return { yes: true, priority: 3, reason: "Spell genérica" };
}

/**
 * Decide se deve invocar um monstro.
 * @param {Object} card
 * @param {Object} analysis
 * @param {Object} tributeInfo - { tributesNeeded, alt }
 * @param {Object} [context]
 * @returns {SummonDecision}
 */

export { estimateShadowHeartCathedralCounterGain, evaluateCathedralPlacement, chooseCathedralSummonTarget, evaluateCathedralActivation } from "./cathedralPolicy.js";

export { evaluateShadowHeartOffensivePlan, evaluateShadowHeartFusionPlan, evaluateShadowHeartFinisherPlans } from "./offensivePlanning.js";

export { shouldPreserveScaleForDemonLine, isCovenantLive } from "./policyContext.js";

export { assessShadowHeartSummonEntry, shouldSummonMonster, selectBestTributes, evaluateTributeTrade, getTributeRequirementFor } from "./summonPolicy.js";

export { chooseCovenantSearchTarget, chooseVoidMageSearchTarget, chooseGeckoSearchTarget, chooseImpSpecialTargetName, buildShadowHeartTargetPreferences, pickInfusionEmergencyRevive, rankShadowHeartSearchCandidates, evaluateShadowHeartRecruitCandidate, buildShadowHeartCostPreferences } from "./targeting.js";
