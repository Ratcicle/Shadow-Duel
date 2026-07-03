import { getGenericAscensionActions } from "../common/ascensionPlanning.js";
import { ascensionMaterialMatches } from "../../game/summon/ascension.js";

const ARCHETYPE = "Burning West";

const BW = {
  GUNSLINGER: "Gunslinger of the Burning West",
  WANTED: "Wanted in the Burning West",
  UNDERTAKER: "Undertaker of the Burning West",
  BUTCHER: "Butcher of the Burning West",
  SPECIALIST: "Specialist of the Burning West",
  PEACEMAKER: "Burning Peacemaker",
  QUICK_DRAW: "Quick Draw in the Burning West",
  FUNERAL: "Funeral at Sunset",
  DEADEYE: "Deadeye of the Burning West",
  PREACHER: "Preacher of the Burning West",
  SHERIFF: "Sheriff of the Burning West",
  CRASH_TOWN: "Crash Town, the Burning City",
  AMBUSH: "Ambush in Crash Town",
  REWARD: "Burning Reward",
  LAW: "Law in the Burning West",
  EXECUTIONER: "Executioner of the Burning West",
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return asArray(player[zone]);
}

function cardArchetypes(card) {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes;
  return card.archetype ? [card.archetype] : [];
}

function isBurningWest(card) {
  return cardArchetypes(card).includes(ARCHETYPE);
}

function mentionsBurningWest(card) {
  return (
    isBurningWest(card) ||
    String(card?.description || "").includes(ARCHETYPE) ||
    String(card?.name || "").includes("Burning West")
  );
}

function isBurningWestMonster(card) {
  return card?.cardKind === "monster" && isBurningWest(card);
}

function isFaceUpBurningWestMonster(card) {
  return isBurningWestMonster(card) && card.isFacedown !== true;
}

function isExecutioner(card) {
  return card?.name === BW.EXECUTIONER && card?.monsterType === "ascension";
}

function getEffectiveAtk(card = {}) {
  return (
    Number(card?.atk || 0) +
    Number(card?.tempAtkBoost || 0) +
    Number(card?.equipAtkBonus || 0)
  );
}

function getEffectiveDef(card = {}) {
  return (
    Number(card?.def || 0) +
    Number(card?.tempDefBoost || 0) +
    Number(card?.equipDefBonus || 0)
  );
}

function getBattleStat(card = {}) {
  if (!card || card.cardKind !== "monster") return 0;
  return card.position === "defense" ? getEffectiveDef(card) : getEffectiveAtk(card);
}

function canAttack(card = {}) {
  return (
    card?.cardKind === "monster" &&
    card.isFacedown !== true &&
    card.position !== "defense" &&
    card.cannotAttackThisTurn !== true &&
    card.hasAttacked !== true &&
    getEffectiveAtk(card) > 0
  );
}

function canDestroyByBattle(attacker, target) {
  return (
    canAttack(attacker) &&
    target?.cardKind === "monster" &&
    target.isFacedown !== true &&
    getEffectiveAtk(attacker) > getBattleStat(target)
  );
}

function sameCard(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftIds = [
    left.instanceId,
    left._instanceId,
    left.uid,
    left.uuid,
    left.simInstanceId,
    left.fieldPresenceId,
  ].filter((value) => value !== null && value !== undefined);
  const rightIds = [
    right.instanceId,
    right._instanceId,
    right.uid,
    right.uuid,
    right.simInstanceId,
    right.fieldPresenceId,
  ].filter((value) => value !== null && value !== undefined);
  return leftIds.some((id) => rightIds.includes(id));
}

function hasPeacemakerEquipped(card, player = {}) {
  return (
    asArray(card?.equips).some((equip) => equip?.name === BW.PEACEMAKER) ||
    getCards(player, "spellTrap").some(
      (equip) =>
        equip?.name === BW.PEACEMAKER &&
        (sameCard(equip.equippedTo, card) || sameCard(equip.equipTarget, card)),
    )
  );
}

function hasFaceUpWanted(player = {}) {
  return getCards(player, "spellTrap").some(
    (card) => card?.name === BW.WANTED && card.isFacedown !== true,
  );
}

function hasWantedDeclaration(player = {}, analysis = {}) {
  if (analysis.wantedDeclarationActive) return true;
  const turnCounter = Number(analysis.currentTurn || analysis.game?.turnCounter || 0);
  return getCards(player, "spellTrap").some((card) => {
    const declaration = card?.declaredValues?.burning_west_wanted_type;
    if (!declaration?.value) return false;
    if (declaration.expiresOnTurn === null || declaration.expiresOnTurn === undefined) {
      return true;
    }
    return Number(declaration.expiresOnTurn) >= turnCounter;
  });
}

function getDeclaredType(card, stateKey, turnCounter = 0) {
  const declaration = card?.declaredValues?.[stateKey];
  if (!declaration?.value) return null;
  if (
    declaration.expiresOnTurn !== null &&
    declaration.expiresOnTurn !== undefined &&
    Number(declaration.expiresOnTurn) < Number(turnCounter || 0)
  ) {
    return null;
  }
  return declaration.value;
}

function getEnteredTurn(material) {
  const values = [material?.revealedTurn, material?.summonedTurn].filter((value) =>
    Number.isFinite(value),
  );
  return values.length > 0 ? Math.max(...values) : null;
}

function isOldEnoughForSimulatedAscension(game, material) {
  const enteredTurn = getEnteredTurn(material);
  if (!Number.isFinite(enteredTurn)) return false;
  return Number(game?.turnCounter || 0) - enteredTurn >= 1;
}

function isValidExecutionerMaterial(material) {
  return (
    isFaceUpBurningWestMonster(material) &&
    Number(material.level || 0) >= 5
  );
}

function getSimulatedAscensionCandidates(game, bot, material) {
  if (!isValidExecutionerMaterial(material)) return [];
  if (!isOldEnoughForSimulatedAscension(game, material)) return [];
  return getCards(bot, "extraDeck").filter(
    (card) => isExecutioner(card) && ascensionMaterialMatches(card, material),
  );
}

function getOpponentMonsters(analysis = {}, opponent = {}) {
  return asArray(analysis.faceUpOpponentMonsters || analysis.opponentMonsters)
    .filter((card) => card?.cardKind === "monster" && card.isFacedown !== true)
    .concat(
      asArray(analysis.faceUpOpponentMonsters || analysis.opponentMonsters).length
        ? []
        : getCards(opponent, "field").filter(
            (card) => card?.cardKind === "monster" && card.isFacedown !== true,
          ),
    );
}

function getOwnFaceUpBurningWest(analysis = {}, bot = {}) {
  return asArray(analysis.faceUpBurningWestMonsters).length
    ? asArray(analysis.faceUpBurningWestMonsters)
    : getCards(bot, "field").filter(isFaceUpBurningWestMonster);
}

function isUnderPressure(analysis = {}, bot = {}, opponent = {}) {
  if (analysis.oppPressure) return true;
  const ownMonsters = getCards(bot, "field").filter((card) => card?.cardKind === "monster");
  const opponentMonsters = getOpponentMonsters(analysis, opponent);
  const strongestOpponent = opponentMonsters.reduce(
    (max, card) => Math.max(max, getEffectiveAtk(card)),
    0,
  );
  const opponentTotalAtk = opponentMonsters.reduce(
    (sum, card) => sum + Math.max(0, getEffectiveAtk(card)),
    0,
  );
  const lp = Number(bot?.lp || analysis.lp || 8000);
  return (
    opponentMonsters.length > ownMonsters.length ||
    strongestOpponent >= Math.max(2200, lp / 3) ||
    opponentTotalAtk >= lp
  );
}

function needsExecutionerBody(ascensionCard, material, context = {}) {
  const analysis = context.analysis || {};
  const bot = context.bot || analysis.player || {};
  const opponent = context.opponent || analysis.opponent || {};
  const opponentMonsters = getOpponentMonsters(analysis, opponent);
  if (!opponentMonsters.length) return false;

  const strongestOpponent = opponentMonsters.reduce(
    (max, card) => Math.max(max, getBattleStat(card)),
    0,
  );
  const ownStrongest = getCards(bot, "field").reduce(
    (max, card) =>
      card === material
        ? max
        : Math.max(max, card?.cardKind === "monster" ? getEffectiveAtk(card) : 0),
    0,
  );
  const executionerAtk = getEffectiveAtk(ascensionCard) || 2500;
  return (
    strongestOpponent >= 2200 &&
    strongestOpponent <= executionerAtk &&
    ownStrongest < strongestOpponent
  );
}

function hasBurningWestAttacker(analysis = {}, bot = {}) {
  return getOwnFaceUpBurningWest(analysis, bot).some(canAttack);
}

function hasAttackerWithoutPeacemaker(analysis = {}, bot = {}) {
  return getOwnFaceUpBurningWest(analysis, bot).some(
    (card) => canAttack(card) && !hasPeacemakerEquipped(card, bot),
  );
}

function hasDifficultBattleInteraction(analysis = {}, bot = {}, opponent = {}) {
  if (analysis.quickDrawPair) return true;
  const opponentMonsters = getOpponentMonsters(analysis, opponent);
  const ownAttackers = getOwnFaceUpBurningWest(analysis, bot).filter(canAttack);
  if (!opponentMonsters.length || !ownAttackers.length) return false;
  const ownBestAtk = ownAttackers.reduce((max, card) => Math.max(max, getEffectiveAtk(card)), 0);
  const oppBestStat = opponentMonsters.reduce((max, card) => Math.max(max, getBattleStat(card)), 0);
  return oppBestStat > ownBestAtk && oppBestStat - ownBestAtk <= 800;
}

function hasBattlePayoff(analysis = {}, bot = {}, opponent = {}) {
  return (
    analysis.hasLikelyDeclaredBattle ||
    !!analysis.bestBattlePlan ||
    (hasBurningWestAttacker(analysis, bot) && getOpponentMonsters(analysis, opponent).length > 0)
  );
}

function monsterRecoveryScore(card) {
  switch (card?.name) {
    case BW.SPECIALIST:
      return 68;
    case BW.UNDERTAKER:
      return 66;
    case BW.GUNSLINGER:
      return 62;
    case BW.BUTCHER:
      return 58;
    case BW.PREACHER:
      return 56;
    case BW.SHERIFF:
      return 54;
    default:
      return isBurningWestMonster(card) ? 50 + Math.min(16, Number(card.level || 0) * 2) : 0;
  }
}

function scoreExecutionerRecoveryCard(card, analysis = {}, context = {}) {
  const bot = context.bot || analysis.player || {};
  const opponent = context.opponent || analysis.opponent || {};
  const pressure = isUnderPressure(analysis, bot, opponent);
  const battlePayoff = hasBattlePayoff(analysis, bot, opponent);
  const wantedOnline =
    analysis.wantedActive || hasFaceUpWanted(bot) || hasWantedDeclaration(bot, analysis);

  switch (card?.name) {
    case BW.LAW:
      return pressure || getCards(opponent, "spellTrap").length > 0 ? 96 : 72;
    case BW.REWARD:
      return battlePayoff ? 88 : 64;
    case BW.PEACEMAKER:
      return hasAttackerWithoutPeacemaker(analysis, bot) ? 84 : 62;
    case BW.WANTED:
      return !wantedOnline ? 82 : 58;
    case BW.QUICK_DRAW:
      return hasDifficultBattleInteraction(analysis, bot, opponent) ? 76 : 55;
    case BW.AMBUSH:
      return pressure ? 74 : 56;
    case BW.DEADEYE:
      return analysis.hasLikelyDeclaredBattle ? 70 : 48;
    case BW.FUNERAL:
      return 45;
    default:
      return monsterRecoveryScore(card);
  }
}

export function rankBurningWestExecutionerRecoveryCandidates(
  cards = [],
  analysis = {},
  context = {},
) {
  return asArray(cards)
    .filter(mentionsBurningWest)
    .slice()
    .sort((a, b) => {
      const scoreDelta =
        scoreExecutionerRecoveryCard(b, analysis, context) -
        scoreExecutionerRecoveryCard(a, analysis, context);
      if (scoreDelta !== 0) return scoreDelta;
      return getBattleStat(b) - getBattleStat(a);
    });
}

function getBestRecovery(bot = {}, analysis = {}, context = {}) {
  const ranked = rankBurningWestExecutionerRecoveryCandidates(
    getCards(bot, "graveyard"),
    analysis,
    context,
  );
  const card = ranked[0] || null;
  return {
    card,
    score: card ? scoreExecutionerRecoveryCard(card, analysis, context) : 0,
  };
}

function getMaterialEffectActivations(game, player, material) {
  const playerId = player?.id;
  const materialId = material?.id;
  if (!playerId || materialId === undefined || materialId === null) return 0;
  return Number(
    game?.materialDuelStats?.[playerId]?.effectActivationsByMaterialId?.get?.(
      materialId,
    ) || 0,
  );
}

function specialistMainValueUsed(bot = {}) {
  const usage = bot?.oncePerDuelUsageByName || {};
  const value = usage.burning_west_specialist_take_control;
  return value === true || Number(value || 0) > 0;
}

function materialHasProducedMainValue(material, context = {}) {
  const game = context.game || {};
  const bot = context.bot || {};
  if (getMaterialEffectActivations(game, bot, material) > 0) return true;
  if (material?.name === BW.SPECIALIST) return specialistMainValueUsed(bot);
  if (material?.name === BW.SHERIFF) {
    return !!getDeclaredType(
      material,
      "burning_west_sheriff_type",
      context.analysis?.currentTurn || game.turnCounter || 0,
    );
  }
  return false;
}

function hasSpecialistPeacemakerAttackValue(material, context = {}) {
  if (material?.name !== BW.SPECIALIST) return false;
  const analysis = context.analysis || {};
  const bot = context.bot || analysis.player || {};
  const opponent = context.opponent || analysis.opponent || {};
  if (!hasPeacemakerEquipped(material, bot) || !canAttack(material)) return false;
  const opponentMonsters = getOpponentMonsters(analysis, opponent);
  return opponentMonsters.some((target) => canDestroyByBattle(material, target));
}

function hasRelevantSheriffType(material, context = {}) {
  if (material?.name !== BW.SHERIFF) return false;
  const analysis = context.analysis || {};
  const bot = context.bot || analysis.player || {};
  const opponent = context.opponent || analysis.opponent || {};
  const declaredType =
    getDeclaredType(
      material,
      "burning_west_sheriff_type",
      analysis.currentTurn || context.game?.turnCounter || 0,
    ) || analysis.plannedDeclaredType;
  if (!declaredType) return false;
  const hasMatchingTarget = getOpponentMonsters(analysis, opponent).some(
    (monster) => monster?.type === declaredType,
  );
  return hasMatchingTarget && hasBurningWestAttacker(analysis, bot);
}

function hasBetterUndertakerRevive(material, context = {}) {
  if (material?.name !== BW.UNDERTAKER) return false;
  const analysis = context.analysis || {};
  const bot = context.bot || analysis.player || {};
  const fieldCosts = getCards(bot, "field").filter(isFaceUpBurningWestMonster);
  if (!fieldCosts.length) return false;
  const graveyardTargets = getCards(bot, "graveyard").filter(isBurningWestMonster);
  return graveyardTargets.some((target) => {
    if (target?.name === BW.UNDERTAKER && fieldCosts.every((cost) => cost.name === target.name)) {
      return false;
    }
    return monsterRecoveryScore(target) >= 58;
  });
}

function materialIsIdle(material, context = {}) {
  const analysis = context.analysis || {};
  const opponent = context.opponent || analysis.opponent || {};
  return (
    !canAttack(material) ||
    getOpponentMonsters(analysis, opponent).length === 0 ||
    !getOpponentMonsters(analysis, opponent).some((target) =>
      canDestroyByBattle(material, target),
    )
  );
}

function evaluateExecutionerAscension(ascensionCard, material, context = {}) {
  const analysis = context.analysis || {};
  const bot = context.bot || analysis.player || {};
  const opponent = context.opponent || analysis.opponent || {};

  if (!isExecutioner(ascensionCard)) {
    return { skip: true, priority: 0, reason: "not Executioner" };
  }
  if (!isValidExecutionerMaterial(material)) {
    return { skip: true, priority: 0, reason: "material is not a prime Burning West level 5+" };
  }

  const recovery = getBestRecovery(bot, analysis, { ...context, bot, opponent });
  const usefulRecovery = recovery.score >= 55;
  const pressure = isUnderPressure(analysis, bot, opponent);
  const bodyNeed = needsExecutionerBody(ascensionCard, material, {
    ...context,
    bot,
    opponent,
  });
  const producedValue = materialHasProducedMainValue(material, {
    ...context,
    bot,
  });
  const idleMaterial = materialIsIdle(material, { ...context, bot, opponent });

  if (hasSpecialistPeacemakerAttackValue(material, { ...context, bot, opponent })) {
    return {
      skip: true,
      priority: 0,
      reason: "Specialist with Burning Peacemaker still has valuable attacks",
      recovery,
    };
  }
  if (hasRelevantSheriffType(material, { ...context, bot, opponent })) {
    return {
      skip: true,
      priority: 0,
      reason: "Sheriff declared Type is relevant for current battles",
      recovery,
    };
  }
  if (
    hasBetterUndertakerRevive(material, { ...context, bot }) &&
    !bodyNeed &&
    !pressure &&
    recovery.score < 88
  ) {
    return {
      skip: true,
      priority: 0,
      reason: "Undertaker revive line is stronger than Ascension",
      recovery,
    };
  }
  if (!usefulRecovery && !bodyNeed && !pressure && !producedValue && !idleMaterial) {
    return {
      skip: true,
      priority: 0,
      reason: "Executioner lacks recovery or board payoff",
      recovery,
    };
  }

  let priority = 64;
  priority += Math.min(18, recovery.score / 5);
  if (bodyNeed) priority += 10;
  if (pressure) priority += 5;
  if (producedValue) priority += 5;
  if (idleMaterial) priority += 4;
  if (!usefulRecovery && !bodyNeed && !pressure) priority -= 16;
  if (material?.name === BW.SPECIALIST) priority -= 5;
  if (material?.name === BW.UNDERTAKER) priority -= 3;
  if (material?.name === BW.SHERIFF) priority -= 3;

  return {
    skip: priority < 60,
    priority: Math.max(0, Math.min(98, priority)),
    reason: recovery.card
      ? `Executioner recovers ${recovery.card.name}`
      : bodyNeed || pressure
        ? "Executioner converts material into a 2500 ATK body"
        : "Executioner converts idle Burning West material",
    recovery,
    position: chooseBurningWestAscensionPosition({
      ascensionCard,
      material,
      game: context.game,
      bot,
      opponent,
      analysis,
    }),
  };
}

function getCachedEvaluation(ascensionCard, material, context = {}) {
  if (
    context.burningWestExecutionerEvaluation &&
    context.burningWestExecutionerEvaluation.ascensionCard === ascensionCard &&
    context.burningWestExecutionerEvaluation.material === material
  ) {
    return context.burningWestExecutionerEvaluation;
  }
  const result = {
    ascensionCard,
    material,
    ...evaluateExecutionerAscension(ascensionCard, material, context),
  };
  context.burningWestExecutionerEvaluation = result;
  return result;
}

export function chooseBurningWestAscensionPosition({
  ascensionCard,
  game,
  bot,
  opponent,
  analysis = {},
} = {}) {
  if (!isExecutioner(ascensionCard)) {
    return ascensionCard?.ascension?.position || "choice";
  }
  const resolvedOpponent = opponent || analysis.opponent || null;
  const pressure = isUnderPressure(analysis, bot, resolvedOpponent);
  const opponentMonsters = getOpponentMonsters(analysis, resolvedOpponent);
  const strongestOpponent = opponentMonsters.reduce(
    (max, card) => Math.max(max, getEffectiveAtk(card)),
    0,
  );
  const totalOpponentAtk = opponentMonsters.reduce(
    (sum, card) => sum + Math.max(0, getEffectiveAtk(card)),
    0,
  );
  const lp = Number(bot?.lp || analysis.lp || 8000);

  if (
    pressure &&
    lp <= 2500 &&
    totalOpponentAtk >= lp &&
    strongestOpponent <= getEffectiveDef(ascensionCard)
  ) {
    return "defense";
  }

  return "attack";
}

export function getBurningWestExtraDeckActions({
  game,
  bot,
  analysis,
  strategy,
} = {}) {
  if (!game || !bot || !analysis) return [];
  const buildActivationContext = strategy?.buildBurningWestActivationContext;
  const isSimulatedState = game?._isPerspectiveState === true;

  return getGenericAscensionActions(
    {
      game,
      bot,
      opponent: analysis.opponent,
      analysis,
      isSimulatedState,
    },
    {
      getSimulatedAscensionCandidates,
      shouldSkipAscension: (ascensionCard, material, context) =>
        getCachedEvaluation(ascensionCard, material, context).skip === true,
      evaluateAscensionPriority: (ascensionCard, material, context) =>
        getCachedEvaluation(ascensionCard, material, context).priority,
      chooseAscensionPosition: (ascensionCard, material, context) =>
        getCachedEvaluation(ascensionCard, material, context).position,
      decorateAction: (action, ascensionCard, material, context) => {
        const evaluation = getCachedEvaluation(ascensionCard, material, context);
        return {
          ...action,
          cardId: ascensionCard?.id,
          materialId: material?.id,
          materialName: material?.name,
          reason: evaluation.reason,
          executionerPlan: {
            recoveryName: evaluation.recovery?.card?.name || null,
            recoveryScore: evaluation.recovery?.score || 0,
          },
          activationContext:
            buildActivationContext?.(ascensionCard, analysis, {
              zone: "extraDeck",
              activationZone: "extraDeck",
              sourceZone: "extraDeck",
            }) || {},
        };
      },
    },
  ).filter((action) => action.cardName === BW.EXECUTIONER && action.priority > 0);
}

export function selectBurningWestAutomaticAscension({
  choices = [],
  game,
  bot,
  opponent,
  analysis,
} = {}) {
  if (!Array.isArray(choices) || choices.length === 0) {
    return { skip: true, reason: "no Ascension choices" };
  }
  const resolvedAnalysis =
    analysis ||
    bot?.strategy?.currentAnalysis ||
    {
      player: bot,
      opponent,
      game,
    };
  const scored = choices
    .filter((choice) => isExecutioner(choice?.ascensionCard))
    .map((choice) => {
      const evaluation = evaluateExecutionerAscension(
        choice.ascensionCard,
        choice.material,
        {
          game,
          bot,
          opponent,
          analysis: resolvedAnalysis,
        },
      );
      return { ...choice, evaluation, score: evaluation.priority };
    })
    .filter((choice) => choice.evaluation.skip !== true && choice.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { skip: true, reason: "no valuable Executioner Ascension" };
  }

  const best = scored[0];
  return {
    material: best.material,
    ascensionCard: best.ascensionCard,
    position:
      best.evaluation.position ||
      chooseBurningWestAscensionPosition({
        material: best.material,
        ascensionCard: best.ascensionCard,
        game,
        bot,
        opponent,
        analysis: resolvedAnalysis,
      }),
    priority: best.score,
    reason: best.evaluation.reason,
  };
}

export const burningWestExtraDeckInternals = {
  evaluateExecutionerAscension,
  rankBurningWestExecutionerRecoveryCandidates,
};
