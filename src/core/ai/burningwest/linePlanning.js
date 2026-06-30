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

const DEFAULT_PROFILE = {
  enabled: false,
  mode: "off",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 260,
  candidateLimit: 8,
  battleStepLimit: 1,
  reasons: [],
  critical: false,
};

const BATTLE_PAYOFF_NAMES = new Set([
  BW.WANTED,
  BW.DEADEYE,
  BW.REWARD,
  BW.PEACEMAKER,
  BW.GUNSLINGER,
  BW.SHERIFF,
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getBotState(state = {}) {
  return state.bot || state.player || {};
}

function getOpponentState(state = {}) {
  return state.player || state.opponent || {};
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
  return isBurningWest(card) || String(card?.description || "").includes(ARCHETYPE);
}

function isBurningWestMonster(card) {
  return card?.cardKind === "monster" && isBurningWest(card);
}

function isFaceUpBurningWestMonster(card) {
  return isBurningWestMonster(card) && card.isFacedown !== true;
}

function isBurningWestSpellTrap(card) {
  return ["spell", "trap"].includes(card?.cardKind) && mentionsBurningWest(card);
}

function hasName(cards = [], name) {
  return asArray(cards).some((card) => card?.name === name);
}

function countName(cards = [], name) {
  return asArray(cards).filter((card) => card?.name === name).length;
}

function countWhere(cards = [], predicate) {
  return asArray(cards).filter(predicate).length;
}

function getEffectiveAtk(card = {}) {
  return (
    Number(card?.atk || 0) +
    Number(card?.tempAtkBoost || 0) +
    Number(card?.equipAtkBonus || 0)
  );
}

function getBattleTargetStat(card = {}) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.position === "attack") return getEffectiveAtk(card);
  return Number(card.def || 0) + Number(card.tempDefBoost || 0) + Number(card.equipDefBonus || 0);
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
  return canAttack(attacker) && target?.cardKind === "monster" && getEffectiveAtk(attacker) > getBattleTargetStat(target);
}

function isExtraDeckMonster(card = {}) {
  return ["fusion", "synchro", "ascension"].includes(card?.monsterType);
}

function cardThreat(card = {}) {
  if (!card || card.cardKind !== "monster") return 0;
  return (
    Math.max(getEffectiveAtk(card), Number(card.def || 0)) +
    Number(card.level || 0) * 120 +
    (isExtraDeckMonster(card) ? 900 : 0)
  );
}

function actionName(action = {}) {
  return action.cardName || action.card?.name || action.name || action.sourceName || "";
}

function sequenceNames(sequence = []) {
  return asArray(sequence).map(actionName).filter(Boolean);
}

function sequenceUses(sequence = [], predicate) {
  return asArray(sequence).some(predicate);
}

function addMilestone(entries, label, score, detail = "") {
  if (!Number.isFinite(score) || score === 0) return;
  entries.push({ label, score, detail });
}

function allOwnCards(player = {}) {
  return [
    ...getCards(player, "hand"),
    ...getCards(player, "field"),
    ...getCards(player, "spellTrap"),
    ...getCards(player, "graveyard"),
    ...getCards(player, "deck"),
    ...getCards(player, "extraDeck"),
    ...getCards(player, "fieldSpell"),
  ];
}

function countOpponentBoardCards(player = {}) {
  return (
    getCards(player, "field").length +
    getCards(player, "spellTrap").length +
    getCards(player, "fieldSpell").length
  );
}

function countFaceUpBurningWest(player = {}) {
  return countWhere(getCards(player, "field"), isFaceUpBurningWestMonster);
}

function countBurningWestCards(player = {}) {
  return allOwnCards(player).filter(mentionsBurningWest).length;
}

function countBurningWestSpellTrapsInHand(player = {}) {
  return countWhere(getCards(player, "hand"), isBurningWestSpellTrap);
}

function countBurningWestMonstersInHand(player = {}) {
  return countWhere(getCards(player, "hand"), isBurningWestMonster);
}

function hasFaceUpWanted(player = {}) {
  return getCards(player, "spellTrap").some(
    (card) => card?.name === BW.WANTED && card.isFacedown !== true,
  );
}

function hasRewardReady(player = {}) {
  return (
    hasName(getCards(player, "hand"), BW.REWARD) ||
    hasName(getCards(player, "spellTrap"), BW.REWARD)
  );
}

function hasPeacemakerAccess(player = {}) {
  return (
    hasName(getCards(player, "hand"), BW.PEACEMAKER) ||
    hasName(getCards(player, "spellTrap"), BW.PEACEMAKER) ||
    hasName(getCards(player, "graveyard"), BW.PEACEMAKER)
  );
}

function cardHasPeacemaker(card = {}, player = {}) {
  return (
    asArray(card.equips).some((equip) => equip?.name === BW.PEACEMAKER) ||
    getCards(player, "spellTrap").some(
      (entry) => entry?.name === BW.PEACEMAKER && entry.equippedTo === card,
    )
  );
}

function getDeclaredType(card = {}, stateKey, turnCounter = 0) {
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

function hasSpecialistPeacemakerPressure(player = {}) {
  const hand = getCards(player, "hand");
  const field = getCards(player, "field");
  const specialist = field.find(
    (card) => card?.name === BW.SPECIALIST && canAttack(card),
  );
  if (specialist && (cardHasPeacemaker(specialist, player) || hasName(hand, BW.PEACEMAKER))) {
    return true;
  }
  return (
    hasName(hand, BW.SPECIALIST) &&
    hasName(hand, BW.PEACEMAKER) &&
    (hasFaceUpWanted(player) || hasName(hand, BW.WANTED) || field.length > 0)
  );
}

function hasExecutionerWindow(player = {}) {
  return (
    hasName(getCards(player, "extraDeck"), BW.EXECUTIONER) &&
    getCards(player, "field").some(
      (card) =>
        isFaceUpBurningWestMonster(card) &&
        Number(card.level || 0) >= 5,
    )
  );
}

function hasExecutionerOnField(player = {}) {
  return getCards(player, "field").some(
    (card) => card?.name === BW.EXECUTIONER && card.isFacedown !== true,
  );
}

function isExecutionerAscensionAction(action = {}) {
  return action?.type === "ascension" && actionName(action) === BW.EXECUTIONER;
}

function executionerAscensionActions(sequence = []) {
  return asArray(sequence).filter(isExecutionerAscensionAction);
}

function findAscensionMaterial(action = {}, player = {}) {
  const field = getCards(player, "field");
  if (Number.isInteger(action.materialIndex) && field[action.materialIndex]) {
    return field[action.materialIndex];
  }
  if (action.materialId !== undefined || action.materialName) {
    return field.find(
      (card) =>
        (action.materialId === undefined || card?.id === action.materialId) &&
        (!action.materialName || card?.name === action.materialName),
    );
  }
  return null;
}

function materialRecoveryValue(card = {}) {
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
      return isBurningWestMonster(card) ? 50 : 0;
  }
}

function hasSpecialistPeacemakerBattleValue(material = {}, player = {}, opponent = {}) {
  if (material.name !== BW.SPECIALIST) return false;
  if (!cardHasPeacemaker(material, player) || !canAttack(material)) return false;
  return getCards(opponent, "field").some(
    (target) =>
      target?.cardKind === "monster" &&
      target.isFacedown !== true &&
      canDestroyByBattle(material, target),
  );
}

function hasRelevantSheriffTypePressure(material = {}, player = {}, opponent = {}, turnCounter = 0) {
  if (material.name !== BW.SHERIFF) return false;
  const declaredType = getDeclaredType(material, "burning_west_sheriff_type", turnCounter);
  if (!declaredType) return false;
  const matchingTarget = getCards(opponent, "field").some(
    (target) => target?.cardKind === "monster" && target.isFacedown !== true && target.type === declaredType,
  );
  const readyAttacker = getCards(player, "field").some(
    (card) => isFaceUpBurningWestMonster(card) && canAttack(card),
  );
  return matchingTarget && readyAttacker;
}

function hasUndertakerReviveValue(material = {}, player = {}) {
  if (material.name !== BW.UNDERTAKER) return false;
  const fieldCosts = getCards(player, "field").filter(isFaceUpBurningWestMonster);
  const graveyardTargets = getCards(player, "graveyard").filter(isBurningWestMonster);
  return fieldCosts.length > 0 && graveyardTargets.some((card) => materialRecoveryValue(card) >= 58);
}

function isIdleExecutionerMaterial(material = {}, opponent = {}) {
  if (!material || material.cardKind !== "monster") return false;
  const targets = getCards(opponent, "field").filter(
    (card) => card?.cardKind === "monster" && card.isFacedown !== true,
  );
  return (
    !canAttack(material) ||
    targets.length === 0 ||
    !targets.some((target) => canDestroyByBattle(material, target))
  );
}

function hasFavorableBattle(player = {}, opponent = {}) {
  const attackers = getCards(player, "field").filter(isFaceUpBurningWestMonster);
  const targets = getCards(opponent, "field").filter(
    (card) => card?.cardKind === "monster" && card.isFacedown !== true,
  );
  return attackers.some((attacker) =>
    targets.some((target) => canDestroyByBattle(attacker, target)),
  );
}

function hasLikelyBattlePayoff(analysis = {}, player = {}, opponent = {}) {
  if (analysis.hasLikelyDeclaredBattle) return true;
  if (!analysis.bestBattlePlan && !hasFavorableBattle(player, opponent)) return false;
  if (analysis.wantedActive || analysis.wantedInHand || hasFaceUpWanted(player)) return true;
  if (hasRewardReady(player) && getCards(player, "graveyard").some(isBurningWestMonster)) return true;
  if (hasPeacemakerAccess(player)) return true;
  if (analysis.quickDrawPair) return true;
  return getCards(player, "field").some((card) => BATTLE_PAYOFF_NAMES.has(card?.name));
}

function hasBurningWestStarterLine(analysis = {}, player = {}) {
  const hand = getCards(player, "hand");
  const deck = getCards(player, "deck");
  const hasButcher = hasName(hand, BW.BUTCHER) && analysis.canNormalSummon !== false;
  const hasWantedAccess =
    analysis.wantedActive ||
    analysis.wantedInHand ||
    hasFaceUpWanted(player) ||
    hasName(hand, BW.WANTED);
  const hasGunslingerAccess =
    hasName(hand, BW.GUNSLINGER) || hasName(deck, BW.GUNSLINGER);
  return hasButcher && hasWantedAccess && hasGunslingerAccess;
}

export function buildBurningWestPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const player = analysis.player || analysis.bot || context.bot || game.bot || {};
  const opponent = analysis.opponent || context.opponent || game.player || {};
  const hand = analysis.hand || getCards(player, "hand");
  const spellTrap = analysis.spellTrap || getCards(player, "spellTrap");
  const graveyard = analysis.graveyard || getCards(player, "graveyard");
  const phase = String(analysis.phase || game.phase || "main1").toLowerCase();
  const manual = game?.turnLineSearchEnabled === true;
  const reasons = [];

  if (analysis.wantedActive || analysis.wantedInHand || hasName(hand, BW.WANTED)) {
    reasons.push("Burning West Wanted access");
  }
  if (hasBurningWestStarterLine(analysis, player)) {
    reasons.push("Butcher + Wanted starter line");
  } else if (hasName(hand, BW.BUTCHER) && analysis.canNormalSummon !== false) {
    reasons.push("Butcher starter available");
  }
  if (analysis.bestBattlePlan || hasFavorableBattle(player, opponent)) {
    reasons.push("favorable Burning West battle");
  }
  if (analysis.peacemakerInHand || hasPeacemakerAccess(player)) {
    reasons.push("Burning Peacemaker pressure");
  }
  if (hasName(hand, BW.DEADEYE) && analysis.hasLikelyDeclaredBattle) {
    reasons.push("Deadeye declared-Type payoff");
  }
  if (
    (hasName(hand, BW.REWARD) || hasName(spellTrap, BW.REWARD)) &&
    graveyard.some(isBurningWestMonster)
  ) {
    reasons.push("Burning Reward recovery payoff");
  }
  if ((hasName(hand, BW.QUICK_DRAW) || hasName(spellTrap, BW.QUICK_DRAW)) && analysis.quickDrawPair) {
    reasons.push("Quick Draw battle pair");
  }
  if (hasExecutionerWindow(player)) {
    reasons.push("Executioner setup window");
  }

  const starterLine = hasBurningWestStarterLine(analysis, player);
  const battleBridge =
    (phase === "main1" || phase === "main") &&
    hasLikelyBattlePayoff(analysis, player, opponent);
  const specialistExtraAttack = hasSpecialistPeacemakerPressure(player);
  const enabled = manual || reasons.length > 0;
  const requestedTurnMode = game?.turnLineSearchTurnMode;

  return {
    ...DEFAULT_PROFILE,
    enabled,
    mode: manual && reasons.length === 0 ? "manual" : enabled ? "critical" : "off",
    turnMode: requestedTurnMode || (battleBridge ? "mainBattleMain2" : "mainOnly"),
    beamWidth: Number.isFinite(game?.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth
      : 3,
    maxDepth: Number.isFinite(game?.turnLineSearchMaxDepth)
      ? game.turnLineSearchMaxDepth
      : phase.includes("main2")
        ? 3
        : starterLine
          ? 5
          : 4,
    nodeBudget: Number.isFinite(game?.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget
      : 260 + (battleBridge ? 40 : 0) + (starterLine ? 30 : 0),
    candidateLimit: Number.isFinite(game?.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : 8,
    battleStepLimit: Number.isFinite(game?.turnLineSearchBattleStepLimit)
      ? game.turnLineSearchBattleStepLimit
      : specialistExtraAttack
        ? 2
        : 1,
    reasons: unique(reasons),
    critical: reasons.length > 0,
  };
}

function getBattleSteps(sequence = []) {
  return asArray(sequence).filter((action) => action?.type === "simulatedBattle");
}

function battleRewardNames(sequence = []) {
  return getBattleSteps(sequence).flatMap((step) => asArray(step.rewardNames));
}

function battleDestroyedCards(sequence = []) {
  return getBattleSteps(sequence).flatMap((step) => asArray(step.destroyedCards));
}

function battleDamage(sequence = []) {
  return getBattleSteps(sequence).reduce(
    (sum, step) => sum + Math.max(0, Number(step.damage || 0)),
    0,
  );
}

function countRemovedOpponentCards(initialOpponent = {}, finalOpponent = {}) {
  return Math.max(
    0,
    countOpponentBoardCards(initialOpponent) - countOpponentBoardCards(finalOpponent),
  );
}

function rewardMatches(rewards = [], pattern) {
  return rewards.some((name) => pattern.test(String(name || "")));
}

function hasQuickDrawEffectRemoval(sequence = []) {
  const rewards = battleRewardNames(sequence);
  return rewardMatches(rewards, /Quick Draw.*destroyed/i);
}

function lineHasRealPayoff({
  sequence,
  initialBot,
  finalBot,
  initialOpponent,
  finalOpponent,
} = {}) {
  if (battleDamage(sequence) > 0) return true;
  if (countRemovedOpponentCards(initialOpponent, finalOpponent) > 0) return true;
  if (battleRewardNames(sequence).some((name) => /(Wanted|Deadeye|Reward|Peacemaker|Gunslinger)/i.test(name))) {
    return true;
  }
  if (countFaceUpBurningWest(finalBot) > countFaceUpBurningWest(initialBot)) return true;
  if (countBurningWestCards(finalBot) > countBurningWestCards(initialBot)) return true;
  if (!hasExecutionerOnField(initialBot) && hasExecutionerOnField(finalBot)) return true;
  if (hasExecutionerWindow(finalBot)) return true;
  return false;
}

function isUnderPressure(player = {}, opponent = {}) {
  const ownMonsters = getCards(player, "field").filter((card) => card?.cardKind === "monster");
  const opponentMonsters = getCards(opponent, "field").filter((card) => card?.cardKind === "monster");
  const strongestOpponent = opponentMonsters.reduce(
    (max, card) => Math.max(max, card?.isFacedown ? 0 : getEffectiveAtk(card)),
    0,
  );
  return (
    opponentMonsters.length > ownMonsters.length ||
    strongestOpponent >= Math.max(1900, Number(player.lp || 8000) / 3)
  );
}

function scoreBattleMilestones(entries, sequence = []) {
  const destroyed = battleDestroyedCards(sequence);
  const rewards = battleRewardNames(sequence);
  const damage = battleDamage(sequence);
  const battleDestroyedOpponent = destroyed.filter(
    (entry) =>
      entry?.owner === "opponent" &&
      entry.cardKind === "monster" &&
      entry.destroyedBy === "battle",
  );
  const effectDestroyedOpponent = destroyed.filter(
    (entry) =>
      entry?.owner === "opponent" &&
      entry.cardKind === "monster" &&
      entry.destroyedBy === "effect",
  );

  if (battleDestroyedOpponent.length > 0) {
    const threatScore = battleDestroyedOpponent.reduce(
      (sum, card) => sum + cardThreat(card),
      0,
    );
    addMilestone(
      entries,
      "battle destroyed opponent monster",
      Math.min(5.5, battleDestroyedOpponent.length * 1.8 + threatScore / 1200),
    );
  }
  if (effectDestroyedOpponent.length > 0) {
    addMilestone(
      entries,
      hasQuickDrawEffectRemoval(sequence)
        ? "Quick Draw removed battle target"
        : "effect removed opponent monster",
      Math.min(3.5, effectDestroyedOpponent.length * 1.4),
    );
  }
  if (damage > 0) {
    addMilestone(entries, "battle damage converted", Math.min(3.5, damage / 900));
  }
  if (rewardMatches(rewards, /Wanted summoned/i)) {
    addMilestone(entries, "Wanted converted battle into summon", 3);
  }
  if (rewardMatches(rewards, /Wanted buffed/i)) {
    addMilestone(entries, "Wanted converted battle into buff", 1.8);
  }
  if (rewardMatches(rewards, /Wanted recovered/i)) {
    addMilestone(entries, "Wanted converted battle into recovery", 1.8);
  }
  if (rewardMatches(rewards, /Deadeye drew/i)) {
    addMilestone(entries, "Deadeye drew from declared-Type battle", 2.4);
  }
  if (rewardMatches(rewards, /Deadeye burned/i)) {
    addMilestone(entries, "Deadeye punished Extra Deck monster", 2);
  }
  if (rewardMatches(rewards, /Reward recovered/i)) {
    addMilestone(entries, "Burning Reward recovered monster", 1.8);
  }
  if (rewardMatches(rewards, /Reward summoned/i)) {
    addMilestone(entries, "Burning Reward extended from declared Type", 2.6);
  }
  if (rewardMatches(rewards, /Peacemaker destroyed/i)) {
    addMilestone(entries, "Burning Peacemaker destroyed backrow", 2.1);
  }
  if (rewardMatches(rewards, /Gunslinger discarded/i)) {
    addMilestone(entries, "Gunslinger converted battle into discard", 1.2);
  }
}

function scoreSetupMilestones(entries, context = {}) {
  const { sequence, initialBot, finalBot } = context;
  const usedNames = new Set(sequenceNames(sequence));
  const initialHand = getCards(initialBot, "hand");
  const finalHand = getCards(finalBot, "hand");
  const initialField = getCards(initialBot, "field");
  const finalField = getCards(finalBot, "field");
  const initialGraveyard = getCards(initialBot, "graveyard");
  const finalGraveyard = getCards(finalBot, "graveyard");
  const executionerActions = executionerAscensionActions(sequence);

  if (!hasFaceUpWanted(initialBot) && hasFaceUpWanted(finalBot)) {
    addMilestone(entries, "Wanted engine online", 2.2);
  }
  if (
    sequenceUses(sequence, (action) => action?.type === "spellTrapEffect" && actionName(action) === BW.WANTED)
  ) {
    addMilestone(entries, "Wanted declared a Type", 1.4);
  }
  if (
    usedNames.has(BW.BUTCHER) &&
    countName(finalField, BW.BUTCHER) > countName(initialField, BW.BUTCHER)
  ) {
    addMilestone(entries, "Butcher starter reached field", 2);
  }
  if (
    usedNames.has(BW.BUTCHER) &&
    countBurningWestMonstersInHand(finalBot) > countBurningWestMonstersInHand(initialBot)
  ) {
    addMilestone(entries, "Butcher searched Burning West monster", 2.2);
  }
  if (
    usedNames.has(BW.BUTCHER) &&
    countBurningWestSpellTrapsInHand(finalBot) > countBurningWestSpellTrapsInHand(initialBot)
  ) {
    addMilestone(entries, "Butcher follow-up searched Spell/Trap", 2.4);
  }
  if (
    countName(finalHand, BW.GUNSLINGER) > countName(initialHand, BW.GUNSLINGER) ||
    countName(finalField, BW.GUNSLINGER) > countName(initialField, BW.GUNSLINGER)
  ) {
    addMilestone(entries, "Gunslinger extender access gained", 1.5);
  }
  if (usedNames.has(BW.PEACEMAKER)) {
    const equippedAttacker = getCards(finalBot, "field").find(
      (card) => isFaceUpBurningWestMonster(card) && canAttack(card) && cardHasPeacemaker(card, finalBot),
    );
    addMilestone(
      entries,
      equippedAttacker ? "Burning Peacemaker equipped attacker" : "Burning Peacemaker access used",
      equippedAttacker ? 1.8 : 0.8,
    );
  }
  if (
    !hasExecutionerWindow(initialBot) &&
    hasExecutionerWindow(finalBot)
  ) {
    addMilestone(entries, "Executioner material window preserved", 1.4);
  }
  if (
    executionerActions.length > 0 ||
    (!hasExecutionerOnField(initialBot) && hasExecutionerOnField(finalBot))
  ) {
    addMilestone(entries, "Executioner reached field", 3.2);
  }
  for (const action of executionerActions) {
    const recoveryScore = Number(action.executionerPlan?.recoveryScore || 0);
    const recoveryName = action.executionerPlan?.recoveryName || null;
    if (recoveryScore >= 55) {
      addMilestone(
        entries,
        recoveryName
          ? `Executioner recovered ${recoveryName}`
          : "Executioner recovered Burning West card",
        Math.min(2.8, recoveryScore / 35),
      );
    } else if (finalHand.length > initialHand.length) {
      addMilestone(entries, "Executioner gained card economy", 1.2);
    }

    const material = findAscensionMaterial(action, initialBot);
    if (
      material &&
      countName(finalGraveyard, material.name) > countName(initialGraveyard, material.name) &&
      hasExecutionerOnField(finalBot)
    ) {
      addMilestone(entries, "Executioner material loop set up", 1.2);
    }
    if (material && isIdleExecutionerMaterial(material, context.initialOpponent || {})) {
      addMilestone(entries, "idle level 5+ material became pressure", 1.4);
    }
  }
  const faceUpDelta = countFaceUpBurningWest(finalBot) - countFaceUpBurningWest(initialBot);
  if (faceUpDelta > 0) {
    addMilestone(entries, "more face-up Burning West bodies", Math.min(2.4, faceUpDelta * 0.8));
  }
}

function scorePenalties(entries, context = {}) {
  const { sequence, initialBot, finalBot, initialOpponent, finalOpponent, turnCounter = 0 } = context;
  const usedNames = new Set(sequenceNames(sequence));
  const rewards = battleRewardNames(sequence);
  const realPayoff = lineHasRealPayoff(context);
  const executionerActions = executionerAscensionActions(sequence);
  const quickDrawSpent = sequenceUses(
    sequence,
    (action) =>
      actionName(action) === BW.QUICK_DRAW &&
      ["spell", "spellTrapEffect"].includes(action?.type),
  );

  if (usedNames.has(BW.DEADEYE) && !rewardMatches(rewards, /Deadeye drew/i)) {
    addMilestone(entries, "Deadeye used without declared-Type payoff", -2.6);
  }
  if (quickDrawSpent && !hasQuickDrawEffectRemoval(sequence)) {
    addMilestone(entries, "Quick Draw spent without removal", -2);
  }
  if (sequence.length >= 4 && !realPayoff) {
    addMilestone(entries, "long Burning West line without payoff", -3);
  }
  if (
    countFaceUpBurningWest(finalBot) === 0 &&
    isUnderPressure(finalBot, finalOpponent)
  ) {
    addMilestone(entries, "ended without face-up Burning West under pressure", -4.5);
  }
  if (
    usedNames.has(BW.SPECIALIST) &&
    countFaceUpBurningWest(finalBot) < countFaceUpBurningWest(initialBot) - 1 &&
    countRemovedOpponentCards(initialOpponent, finalOpponent) === 0
  ) {
    addMilestone(entries, "Specialist line gave up board without payoff", -3);
  }
  for (const action of executionerActions) {
    const material = findAscensionMaterial(action, initialBot);
    const recoveryScore = Number(action.executionerPlan?.recoveryScore || 0);
    if (
      recoveryScore < 55 &&
      !isUnderPressure(initialBot, initialOpponent) &&
      countRemovedOpponentCards(initialOpponent, finalOpponent) === 0
    ) {
      addMilestone(entries, "Executioner ascended without recovery or board need", -3);
    }
    if (material && hasSpecialistPeacemakerBattleValue(material, initialBot, initialOpponent)) {
      addMilestone(entries, "spent active Specialist + Peacemaker attacks", -4);
    }
    if (material && hasRelevantSheriffTypePressure(material, initialBot, initialOpponent, turnCounter)) {
      addMilestone(entries, "spent relevant Sheriff Type pressure", -3.5);
    }
    if (material && hasUndertakerReviveValue(material, initialBot)) {
      addMilestone(entries, "spent Undertaker with stronger revive line", -3);
    }
  }
  if (!realPayoff && sequence.length > 1) {
    addMilestone(entries, "Burning West sequence did not convert value", -1.2);
  }
}

export function scoreBurningWestLineMilestones(context = {}) {
  const initialState = context.initialState || {};
  const finalState = context.finalState || {};
  const sequence = asArray(context.sequence);
  const initialBot = getBotState(initialState);
  const finalBot = getBotState(finalState);
  const initialOpponent = getOpponentState(initialState);
  const finalOpponent = getOpponentState(finalState);
  const entries = [];
  const scoreContext = {
    sequence,
    initialBot,
    finalBot,
    initialOpponent,
    finalOpponent,
    turnCounter: initialState.turnCounter || context.turnCounter || 0,
  };

  scoreSetupMilestones(entries, scoreContext);
  scoreBattleMilestones(entries, sequence);

  const removedOpponentCards = countRemovedOpponentCards(initialOpponent, finalOpponent);
  if (removedOpponentCards > 0) {
    addMilestone(entries, "opponent board reduced", Math.min(4, removedOpponentCards * 1.4));
  }

  const handDelta = getCards(finalBot, "hand").length - getCards(initialBot, "hand").length;
  if (handDelta > 0) {
    addMilestone(entries, "card economy gained", Math.min(2.5, handDelta * 0.8));
  }

  scorePenalties(entries, scoreContext);

  const scoreDelta = entries.reduce((sum, entry) => sum + entry.score, 0);
  entries.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  return {
    scoreDelta,
    milestones: entries,
    lineImpact: {
      removedOpponentCards,
      battleDamage: battleDamage(sequence),
      initialFaceUpBurningWest: countFaceUpBurningWest(initialBot),
      finalFaceUpBurningWest: countFaceUpBurningWest(finalBot),
      initialBurningWestCards: countBurningWestCards(initialBot),
      finalBurningWestCards: countBurningWestCards(finalBot),
      executionerWindow: hasExecutionerWindow(finalBot),
      executionerOnField: hasExecutionerOnField(finalBot),
    },
  };
}

export function scoreBurningWestLineTerminal(context = {}) {
  const finalBot = getBotState(context.finalState || {});
  const finalOpponent = getOpponentState(context.finalState || {});
  if ((finalBot.lp || 0) <= 0) return -10000;
  if ((finalOpponent.lp || 0) <= 0) return 10000;

  const baseScore = Number(context.baseScore ?? context.finalScore ?? 0);
  const milestoneScore = Number(context.milestoneScore || 0);
  const profile = context.profile || context.planningContext?.profile || {};
  const cap = profile.critical ? 16 : 11;
  return baseScore + clamp(milestoneScore, -cap, cap);
}

function compactActionStep(action = {}) {
  if (!action) return "";
  if (action.type === "simulatedBattle") {
    const target = action.direct ? "direct" : action.targetName || "target";
    return `battle ${action.attackerName || "attacker"} -> ${target}`;
  }
  const name = actionName(action);
  if (action.type === "spell") return `activate ${name}`;
  if (action.type === "spellTrapEffect") return `${name} effect`;
  if (action.type === "handIgnition") return `${name} hand effect`;
  if (action.type === "graveyardSpellEffect") return `${name} GY effect`;
  if (action.type === "ascension") return `ascend ${action.materialName || "material"} -> ${name}`;
  if (action.type === "summon") return `summon ${name}`;
  if (action.type === "set_spell_trap") return `set ${name}`;
  return `${action.type || "action"} ${name}`.trim();
}

function milestoneLabel(entry = {}) {
  if (typeof entry === "string") return entry;
  const score = Number(entry.score || 0);
  return `${score >= 0 ? "+" : ""}${score.toFixed(1)} ${entry.label || entry.reason || "milestone"}`;
}

export function describeBurningWestPlannedLine(context = {}) {
  const sequence = asArray(context.sequence);
  if (!sequence.length) return "Burning West planner found no line";
  const steps = sequence.slice(0, 5).map(compactActionStep).filter(Boolean);
  const milestones = asArray(context.milestones)
    .slice(0, 4)
    .map(milestoneLabel)
    .join("; ");
  return `Burning West planned line: ${steps.join(" -> ")}${milestones ? ` | ${milestones}` : ""}`;
}
