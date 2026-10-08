import type { MirageboundAnalysis, MirageboundGame, MirageboundPlayer } from "./contracts.js";
import { MB, getBattleStat, getEffectiveAtk, getEffectiveDef, getFieldCapacity, getMaterialEffectActivations, getOpponentCards, hasName, hasPositionChangeEffectAccess, isAttackPositionThreat, isFaceUpMirageboundMonster, isFaceUpMonster, isMiragebound, isSimulatedState } from "./knowledge.js";
import { buildStrategyAnalysis } from "../common/analysis.js";
import { hasActivePiercing } from "../../game/combat/availability.js";

import type MirageboundStrategy from "../MirageboundStrategy.js";

type AnalyzeGameStatePort = Pick<MirageboundStrategy, "bot" | "currentAnalysis" | "getOpponent" | "thoughtProcess">;

export function analyzeGameState(strategy: AnalyzeGameStatePort, game: MirageboundGame): MirageboundAnalysis {
  strategy.thoughtProcess = [];
  const simulated = isSimulatedState(game);
  const actor = (simulated ? game.bot : strategy.bot || game?.bot) as MirageboundPlayer;
  const opponent = (actor ? strategy.getOpponent(game, actor) : null) as MirageboundPlayer | null;
  const base = buildStrategyAnalysis({
    bot: actor,
    opponent,
    game,
    strategy: strategy,
  });

  const faceUpMiragebounds = (base.field || []).filter(
    isFaceUpMirageboundMonster,
  );
  const mirageboundHand = (base.hand || []).filter(isMiragebound);
  const mirageboundGraveyard = (base.graveyard || []).filter(isMiragebound);
  const opponentMonsters = (base.oppField || []).filter(
    (card) => card?.cardKind === "monster",
  );
  const opponentAttackPositionMonsters = opponentMonsters.filter(
    isAttackPositionThreat,
  );
  const opponentDefensePositionMonsters = opponentMonsters.filter(
    (card) => card?.cardKind === "monster" && card.position === "defense",
  );
  const readyAttackers = (base.field || []).filter(
    (card) =>
      isFaceUpMonster(card) &&
      card.position === "attack" &&
      !card.hasAttacked &&
      !card.cannotAttackThisTurn,
  );
  const strongestOpponentStat = opponentMonsters.reduce(
    (max, card) => Math.max(max, getBattleStat(card)),
    0,
  );
  const strongestOpponentAtk = opponentAttackPositionMonsters.reduce(
    (max, card) => Math.max(max, getEffectiveAtk(card)),
    0,
  );
  const bestOwnBattleStat = (base.field || [])
    .filter(isFaceUpMonster)
    .reduce(
      (max, card) => Math.max(max, getEffectiveAtk(card), getEffectiveDef(card)),
      0,
    );
  const fieldCapacity = getFieldCapacity(actor);
  const availableMonsterZonesAfterBounce =
    faceUpMiragebounds.length > 0 ? Math.max(fieldCapacity, 1) : fieldCapacity;
  const scoutEffectActivations = getMaterialEffectActivations(game, actor, 351);
  const hasScoutInField = hasName(faceUpMiragebounds, MB.SCOUT);
  const hasSovereignInField = hasName(faceUpMiragebounds, MB.GLASS_SOVEREIGN);
  const hasDesertLeviathan = hasName(faceUpMiragebounds, MB.DESERT_LEVIATHAN);
  const hasDesertLeviathanInExtraDeck = hasName(base.extraDeck || [], MB.DESERT_LEVIATHAN);
  const hasViperBouncePayoff =
    hasName(faceUpMiragebounds, MB.GLASS_VIPER) &&
    availableMonsterZonesAfterBounce > 0;
  const hasPriestessBouncePayoff =
    hasName(faceUpMiragebounds, MB.SAND_PRIESTESS) &&
    mirageboundGraveyard.length > 0;
  const hasJackalInHand = hasName(base.hand, MB.JACKAL);
  const hasJackalBouncePayoff =
    hasJackalInHand && opponentMonsters.length > 0 && availableMonsterZonesAfterBounce > 0;
  const hasFalseKingInHand = hasName(base.hand, MB.FALSE_KING);
  const hasDancerInHand = hasName(base.hand, MB.DANCER);
  const hasMirrorPathOnField = hasName(base.spellTrap || [], MB.MIRROR_PATH);
  const hasFalseHorizonAvailable =
    hasName(base.hand || [], MB.FALSE_HORIZON) ||
    hasName(base.spellTrap || [], MB.FALSE_HORIZON);
  const hasVanishingStepAvailable =
    hasName(base.hand || [], MB.VANISHING_STEP) ||
    hasName(base.spellTrap || [], MB.VANISHING_STEP);
  const hasRebelInHand = hasName(base.hand || [], MB.REBEL);
  const hasRebelInField = hasName(faceUpMiragebounds, MB.REBEL);
  const hasPositionChangeAccess = hasPositionChangeEffectAccess(
    base,
    faceUpMiragebounds,
  );
  const hasRebelOpenZoneTriggerWindow =
    hasRebelInHand &&
    fieldCapacity > 0 &&
    opponentMonsters.length > 0 &&
    hasPositionChangeAccess;
  const hasRebelVanishingStepWindow =
    hasRebelInHand &&
    hasVanishingStepAvailable &&
    faceUpMiragebounds.length > 0 &&
    availableMonsterZonesAfterBounce > 0 &&
    opponentMonsters.length > 0;
  const hasRebelFalseKingTriggerWindow =
    hasRebelInHand &&
    hasFalseKingInHand &&
    fieldCapacity > 0 &&
    faceUpMiragebounds.length > 0 &&
    opponentMonsters.length > 0;
  const hasRebelPositionTriggerWindow =
    hasRebelOpenZoneTriggerWindow ||
    hasRebelVanishingStepWindow ||
    hasRebelFalseKingTriggerWindow;
  const hasRebelPiercingPressure =
    (hasRebelInHand || faceUpMiragebounds.some(card => card.id === 364 && hasActivePiercing(card))) &&
    (opponentDefensePositionMonsters.length > 0 ||
      (hasRebelPositionTriggerWindow &&
        opponentAttackPositionMonsters.length > 0));
  const canViperPressureAfterSummon =
    hasDesertLeviathan ||
    strongestOpponentStat <= 1500 ||
    opponentMonsters.some((monster) =>
      readyAttackers.some(
        (attacker) => getEffectiveAtk(attacker) > Math.max(0, getBattleStat(monster) - 500),
      ),
    );
  const canKeepOffenseAfterBounce =
    readyAttackers.length > 1 ||
    hasDancerInHand ||
    hasFalseKingInHand ||
    hasJackalBouncePayoff ||
    (hasViperBouncePayoff && canViperPressureAfterSummon) ||
    hasSovereignInField ||
    hasRebelPositionTriggerWindow;
  const hasMeaningfulBounce =
    faceUpMiragebounds.length > 0 &&
    (hasViperBouncePayoff || hasPriestessBouncePayoff || hasJackalBouncePayoff);
  const oppPressure =
    opponentAttackPositionMonsters.some((card) => getEffectiveAtk(card) >= 2000) ||
    strongestOpponentStat >= 2000 ||
    (strongestOpponentAtk > 0 && strongestOpponentAtk >= bestOwnBattleStat);
  const needsBattleProtection = oppPressure && faceUpMiragebounds.length > 0;
  const hasSafeBackrowDefense =
    hasFalseHorizonAvailable ||
    hasVanishingStepAvailable ||
    hasMirrorPathOnField;
  const mirrorPathIsOnlyBattleProtection =
    hasMirrorPathOnField &&
    needsBattleProtection &&
    !hasFalseHorizonAvailable &&
    !hasVanishingStepAvailable;

  const analysis: MirageboundAnalysis = {
    ...base,
    player: actor,
    opponent,
    canNormalSummon: base.summonAvailable,
    fieldCapacity,
    availableMonsterZonesAfterBounce,
    faceUpMiragebounds,
    mirageboundField: faceUpMiragebounds,
    mirageboundHand,
    mirageboundGraveyard,
    opponentMonsters,
    opponentAttackPositionMonsters,
    opponentDefensePositionMonsters,
    opponentCards: getOpponentCards(base),
    readyAttackers,
    strongestOpponentStat,
    strongestOpponentAtk,
    bestOwnBattleStat,
    hasOasisActive: base.fieldSpell?.name === MB.OASIS,
    hasDesertLeviathan,
    hasSovereignInField,
    hasScoutInField,
    scoutEffectActivations,
    scoutNearAscension: hasScoutInField && scoutEffectActivations >= 1,
    scoutReadyForAscension: hasScoutInField && scoutEffectActivations >= 2,
    preserveScout: hasScoutInField && scoutEffectActivations >= 1,
    hasJackalInHand,
    hasJackalBouncePayoff,
    hasFalseKingInHand,
    hasDancerInHand,
    hasRebelInHand,
    hasRebelInField,
    hasRebelOpenZoneTriggerWindow,
    hasRebelVanishingStepWindow,
    hasRebelFalseKingTriggerWindow,
    hasRebelPositionTriggerWindow,
    hasRebelPiercingPressure,
    hasViperBouncePayoff,
    hasPriestessBouncePayoff,
    hasMeaningfulBounce,
    hasPlannedBounce: hasMeaningfulBounce,
    canKeepOffenseAfterBounce,
    canViperPressureAfterSummon,
    hasFalseHorizonAvailable,
    hasVanishingStepAvailable,
    hasMirrorPathOnField,
    needsBattleProtection,
    hasSafeBackrowDefense,
    mirrorPathIsOnlyBattleProtection,
    hasHeatHazeRecoveryLine:
      mirageboundGraveyard.length > 0 &&
      opponentAttackPositionMonsters.length > 0 &&
      faceUpMiragebounds.length > 0,
    opponentBackrowPressure:
      Boolean(base.oppFieldSpell) ||
      (base.oppSpellTrap || []).some(
        (card) => card?.subtype === "continuous" || card?.subtype === "field",
      ),
    hasLeviathanMaterials:
      hasDesertLeviathanInExtraDeck &&
      hasName(faceUpMiragebounds, MB.GLASS_VIPER) &&
      faceUpMiragebounds.some((card) => card.name !== MB.GLASS_VIPER),
    hasLeviathanLine:
      hasDesertLeviathanInExtraDeck &&
      opponentMonsters.length > 0 &&
      hasName(faceUpMiragebounds, MB.GLASS_VIPER) &&
      faceUpMiragebounds.some((card) => card.name !== MB.GLASS_VIPER),
    oppPressure,
  };

  strategy.currentAnalysis = analysis;
  return analysis;
}
