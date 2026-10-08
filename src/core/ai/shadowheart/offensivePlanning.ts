/** Shadow-Heart offensivePlanning policies; preferences remain owned by the archetype. */
import { isShadowHeartByName, isShadowHeart } from "./knowledge.js";
import { countDestroyableByAtk, getEffectiveAtk, getStrongestBattleStat } from "../common/cardStats.js";
import { createFinisherPlan, rankFinisherPlans } from "../common/finisherPlans.js";
import { isShadowHeartDragon, allCards, shouldPreserveScaleForDemonLine, SH } from "./policyContext.js";
import type { Player, PlanningGame, Analysis } from "./policyContext.js";

export function evaluateShadowHeartOffensivePlan(analysis: Analysis) {
  const hand = analysis?.hand || [];
  const field = analysis?.field || [];
  const graveyard = analysis?.graveyard || [];
  const oppField = analysis?.oppField || [];
  const oppLp = analysis?.oppLp || 0;
  const phase = analysis?.phase || "main1";

  const attackers = field.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      (isShadowHeart(card) || isShadowHeartByName(card.name)) &&
      !card.isFacedown &&
      card.position === "attack" &&
      !card.cannotAttackThisTurn &&
      !card.hasAttacked,
  );
  const totalAttack = attackers.reduce((sum, card) => sum + (card.atk || 0), 0);
  const directLethal = oppField.length === 0 && totalAttack >= oppLp && oppLp > 0;
  const battleHymnLethal =
    phase !== "main2" &&
    hand.some((card) => card.name === "Shadow-Heart Battle Hymn") &&
    attackers.length > 0 &&
    oppField.length === 0 &&
    totalAttack + attackers.length * 500 >= oppLp &&
    oppLp > 0;

  const scaleOnField = field.find(
    (card) =>
      card?.name === "Shadow-Heart Scale Dragon" &&
      !card.isFacedown &&
      card.position === "attack" &&
      !card.cannotAttackThisTurn,
  );
  const scaleInHand = hand.some((card) => card.name === "Shadow-Heart Scale Dragon");
  const rageTargetOnField = field.find(
    (card) =>
      isShadowHeartDragon(card) &&
      card.position === "attack" &&
      !card.cannotAttackThisTurn,
  );
  const rageLive =
    phase !== "main2" &&
    !!rageTargetOnField &&
    hand.some((card) => card.name === "Shadow-Heart Rage");

  const purgeWindow =
    phase !== "main2" &&
    hand.some((card) => card.name === "Shadow-Heart Purge") &&
    attackers.length > 0 &&
    oppField.some((target) => {
      if (!target || target.cardKind !== "monster" || target.isFacedown || target.position === "defense") {
        return false;
      }
      const currentAtk = target.atk || 0;
      const debuffedAtk = Math.max(0, currentAtk - 1000);
      return attackers.some((attacker) => {
        const atk = attacker.atk || 0;
        const before = atk > currentAtk ? atk - currentAtk : 0;
        const after = atk > debuffedAtk ? atk - debuffedAtk : 0;
        return (atk <= currentAtk && atk > debuffedAtk) || after >= oppLp || after - before >= 1000;
      });
    });

  const allFusionCards = [...hand, ...field];
  const shMonsters = allFusionCards.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      (isShadowHeart(card) || isShadowHeartByName(card.name)),
  );
  const scaleCount = shMonsters.filter(
    (card) => card.name === "Shadow-Heart Scale Dragon",
  ).length;
  const level8Plus = shMonsters.filter(
    (card) => card.name !== "Shadow-Heart Scale Dragon" && (card.level || 0) >= 8,
  ).length;
  const demonDragonFusionReady = scaleCount > 0 && (level8Plus > 0 || scaleCount >= 2);
  const warlordFusionLikelyReady = shMonsters.length >= 2;
  const fusionNear =
    hand.some((card) => card.name === "Polymerization") &&
    (demonDragonFusionReady || warlordFusionLikelyReady);

  const comebackReady =
    field.length === 0 &&
    hand.some((card) => card.name === "The Shadow Heart") &&
    graveyard.some(
      (card) =>
        card?.cardKind === "monster" &&
        (isShadowHeart(card) || isShadowHeartByName(card.name)),
    );

  const preserveNames = new Set<string>();
  if (fusionNear) {
    preserveNames.add("Polymerization");
    preserveNames.add("Shadow-Heart Scale Dragon");
    preserveNames.add("Shadow-Heart Demon Arctroth");
    preserveNames.add("Shadow-Heart Death Wyrm");
  }
  // Proteger materiais do Demon Dragon mesmo sem Polymerization na mão,
  // para não perder Scale Dragon + Lv8+ antes de sacar Poly.
  const hasDemonDragonSetup =
    scaleCount > 0 &&
    shMonsters.some(
      (c) => c.name !== "Shadow-Heart Scale Dragon" && (c.level || 0) >= 8,
    );
  if (hasDemonDragonSetup) {
    preserveNames.add("Shadow-Heart Scale Dragon");
    preserveNames.add("Shadow-Heart Demon Arctroth");
    preserveNames.add("Shadow-Heart Death Wyrm");
  }
  if (purgeWindow) preserveNames.add("Shadow-Heart Purge");
  if (battleHymnLethal || attackers.length >= 2) {
    preserveNames.add("Shadow-Heart Battle Hymn");
  }
  if (rageLive || rageTargetOnField || scaleOnField || scaleInHand) {
    preserveNames.add("Shadow-Heart Rage");
  }
  if (scaleOnField || scaleInHand) {
    preserveNames.add("Shadow-Heart Scale Dragon");
  }
  if (comebackReady || field.length === 0) preserveNames.add("The Shadow Heart");

  return {
    attackers,
    totalAttack,
    directLethal,
    battleHymnLethal,
    rageLive,
    purgeWindow,
    fusionNear,
    comebackReady,
    scaleOnField: !!scaleOnField,
    scaleInHand,
    hasMajorSwing:
      directLethal ||
      battleHymnLethal ||
      rageLive ||
      purgeWindow ||
      fusionNear ||
      comebackReady,
    preserveNames: [...preserveNames],
  };
}


export function evaluateShadowHeartFusionPlan(analysis: Analysis = {}) {
  const allCards = [...(analysis.hand || []), ...(analysis.field || [])];
  const shMonsters = allCards.filter(
    (card) => isShadowHeartByName(card?.name) && card.cardKind === "monster",
  );
  const hasScaleDragon = allCards.some((card) => card?.name === SH.scale);
  const validLevel8Plus = shMonsters.filter((card) => {
    if (card.name === SH.scale) return false;
    return (card.level || 0) >= 8;
  });
  const scaleCount = allCards.filter((card) => card?.name === SH.scale).length;

  if (hasScaleDragon && (validLevel8Plus.length > 0 || scaleCount >= 2)) {
    const materialName =
      validLevel8Plus[0]?.name ?? SH.scale;
    return createFinisherPlan({
      kind: "fusion",
      targetName: SH.demonDragon,
      score100: 100,
      reason: `Fusion: Demon Dragon (3000 ATK, destroy 2) com Scale Dragon + ${materialName}`,
      details: {
        spellPriority: 17,
        materialNames: [SH.scale, materialName],
      },
    });
  }

  if (shMonsters.length >= 2) {
    if (shouldPreserveScaleForDemonLine(analysis)) {
      return {
        kind: "fusion_hold",
        targetName: null,
        score100: 0,
        actionPriority: 0,
        reason:
          "Preservar Scale Dragon para linha proxima de Demon Dragon em vez de Warlord cedo",
      };
    }

    const [m1, m2] = shMonsters;
    if (!m1 || !m2) return null;
    return createFinisherPlan({
      kind: "fusion",
      targetName: SH.warlord,
      score100: 72,
      reason: `Fusion: Warlord (2500 ATK, protection + revive) com ${m1.name} + ${m2.name}`,
      details: {
        spellPriority: 9,
        materialNames: [m1.name, m2.name],
      },
    });
  }

  return null;
}


export function evaluateShadowHeartFinisherPlans(
  bot: Player | null = null,
  opponent: Player | null = null,
  game: PlanningGame | null = null,
  analysis: Analysis | null = null,
) {
  const field = analysis?.field || bot?.field || [];
  const hand = analysis?.hand || bot?.hand || [];
  const oppField = analysis?.oppField || opponent?.field || [];
  const oppLp = analysis?.oppLp || opponent?.lp || 8000;
  const summonLimit = 1 + (bot?.additionalNormalSummons || 0);
  const canNormalSummon =
    analysis?.canNormalSummon ?? (bot?.summonCount || 0) < summonLimit;
  const strongestThreat = getStrongestBattleStat(oppField, {
    facedownValue: 1500,
  });
  const plans = [];

  const fusionPlan = evaluateShadowHeartFusionPlan(analysis || { hand, field });
  if (fusionPlan?.targetName) plans.push(fusionPlan);

  const scaleInHand = hand.find((card) => card?.name === SH.scale);
  if (scaleInHand && canNormalSummon && field.length >= 2) {
    const atk = getEffectiveAtk(scaleInHand);
    plans.push(
      createFinisherPlan({
        kind: "normal_summon",
        targetName: SH.scale,
        score100:
          78 +
          (atk > strongestThreat ? 8 : 0) +
          (oppField.length === 0 && atk >= oppLp ? 10 : 0),
        reason: "Scale Dragon cria pressao alta e recupera recursos por batalha",
        details: { atk },
      }),
    );
  }

  const arctrothInHand = hand.find((card) => card?.name === SH.arctroth);
  if (arctrothInHand && canNormalSummon && field.length >= 2 && oppField.length > 0) {
    const destroyable = countDestroyableByAtk(oppField, getEffectiveAtk(arctrothInHand), {
      facedownValue: 1500,
    });
    const battleIndestructible = oppField.some(
      (monster) =>
        monster?.battleIndestructible || monster?.cannotBeDestroyedByBattle,
    );
    plans.push(
      createFinisherPlan({
        kind: "normal_summon",
        targetName: SH.arctroth,
        score100: battleIndestructible ? 92 : 74 + Math.min(2, destroyable) * 6,
        reason: battleIndestructible
          ? "Demon Arctroth remove ameaca que batalha nao resolve"
          : "Demon Arctroth converte tributos em remocao e pressao",
        details: { destroyable, battleIndestructible },
      }),
    );
  }

  const leviathanInHand = hand.find((card) => card?.name === SH.leviathan);
  const eelOnField = field.some((card) => card?.name === SH.eel);
  if (leviathanInHand && eelOnField) {
    const atk = getEffectiveAtk(leviathanInHand);
    plans.push(
      createFinisherPlan({
        kind: "hand_ignition",
        targetName: SH.leviathan,
        score100:
          70 +
          (atk > strongestThreat ? 6 : 0) +
          (oppField.length === 0 && atk >= oppLp ? 8 : 0),
        reason: "Leviathan usa Eel como ponte para pressao e burn",
        details: { atk },
      }),
    );
  }

  return rankFinisherPlans(plans);
}

/**
 * @typedef {Object} SpellDecision
 * @property {boolean} yes
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * @typedef {Object} SummonDecision
 * @property {boolean} yes
 * @property {string} [position]
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * Decide se deve jogar uma spell.
 * @param {Object} card
 * @param {Object} analysis
 * @returns {SpellDecision}
 */
