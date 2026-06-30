const BW = Object.freeze({
  AMBUSH: "Ambush in Crash Town",
  LAW: "Law in the Burning West",
  QUICK_DRAW: "Quick Draw in the Burning West",
  CRASH_TOWN: "Crash Town, the Burning City",
  PREACHER: "Preacher of the Burning West",
  PEACEMAKER: "Burning Peacemaker",
  WANTED: "Wanted in the Burning West",
  REWARD: "Burning Reward",
  DEAD_EYE: "Deadeye of the Burning West",
  GUNSLINGER: "Gunslinger of the Burning West",
  BUTCHER: "Butcher of the Burning West",
  SHERIFF: "Sheriff of the Burning West",
  UNDERTAKER: "Undertaker of the Burning West",
  SPECIALIST: "Specialist of the Burning West",
  EXECUTIONER: "Executioner of the Burning West",
  FUNERAL: "Funeral at Sunset"
});

const BURNING_WEST_DEFENSE_NAMES = new Set([BW.AMBUSH, BW.LAW, BW.QUICK_DRAW]);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function compactCards(cards) {
  return asArray(cards).filter(Boolean);
}

function uniqueCards(cards) {
  const seen = new Set();
  const result = [];
  for (const card of compactCards(cards)) {
    const key = cardInstanceKey(card) || card;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

function getCardName(card) {
  return card?.name || card?.card?.name || "";
}

function getOwnerId(owner) {
  if (!owner) return null;
  if (typeof owner === "string") return owner;
  return owner.id || owner.name || null;
}

function getPlayerId(player) {
  return player?.id || player?.name || null;
}

function cardInstanceKey(card) {
  return card?.instanceId || card?.uuid || card?.id || getCardName(card);
}

function sameCard(a, b) {
  if (!a || !b) return false;
  const aKey = cardInstanceKey(a);
  const bKey = cardInstanceKey(b);
  return aKey != null && bKey != null && aKey === bKey;
}

function listHasCard(cards, card) {
  return compactCards(cards).some((candidate) => sameCard(candidate, card));
}

function ownsCard(player, card) {
  if (!player || !card) return false;
  const playerId = getPlayerId(player);
  const ownerId = getOwnerId(card.owner || card.controller || card.player);
  if (playerId && ownerId && playerId === ownerId) return true;
  return [
    player.field,
    player.hand,
    player.monsterZone,
    player.spellTrapZone,
    player.graveyard,
    player.deck,
    player.extraDeck,
    player.fieldSpell ? [player.fieldSpell] : [],
    player.fieldZone ? [player.fieldZone] : []
  ].some((zone) => listHasCard(zone, card));
}

function cardText(card) {
  return [
    card?.name,
    card?.archetype,
    card?.description,
    card?.text,
    card?.effectText,
    card?.type,
    ...(Array.isArray(card?.archetypes) ? card.archetypes : [])
  ].filter(Boolean).join(" ");
}

function isBurningWest(card) {
  return /Burning West|Crash Town|Wanted in the Burning West|Burning Reward/i.test(cardText(card));
}

function isMonster(card) {
  return card?.cardKind === "monster" || card?.type === "monster";
}

function isFaceUp(card) {
  return card?.faceUp !== false
    && card?.faceDown !== true
    && card?.isFacedown !== true
    && card?.position !== "face_down";
}

function isFaceUpBurningWestMonster(card) {
  return isMonster(card) && isFaceUp(card) && isBurningWest(card);
}

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function getEffectiveAtk(card) {
  return Math.max(
    0,
    numberValue(card?.currentAtk, numberValue(card?.atk, 0)) +
      numberValue(card?.tempAtk, 0) +
      numberValue(card?.tempAtkBoost, 0) +
      numberValue(card?.equipAtkBonus, 0)
  );
}

function getEffectiveDef(card) {
  return Math.max(
    0,
    numberValue(card?.currentDef, numberValue(card?.def, 0)) +
      numberValue(card?.tempDef, 0) +
      numberValue(card?.tempDefBoost, 0) +
      numberValue(card?.equipDefBonus, 0)
  );
}

function isAttackPosition(card) {
  return card?.position !== "defense" && card?.battlePosition !== "defense";
}

function getBattleStat(card) {
  return isAttackPosition(card) ? getEffectiveAtk(card) : getEffectiveDef(card);
}

function getBattleStatForPosition(card, position) {
  return position === "defense" ? getEffectiveDef(card) : getEffectiveAtk(card);
}

function getMonsterZones(player) {
  return uniqueCards([
    ...compactCards(player?.monsterZone),
    ...compactCards(player?.field)
  ]);
}

function getSpellTrapZones(player) {
  return uniqueCards([
    ...compactCards(player?.spellTrapZone),
    ...compactCards(player?.spellTrap)
  ]);
}

function getFieldCards(player) {
  return [
    ...getMonsterZones(player),
    ...getSpellTrapZones(player),
    player?.fieldSpell,
    player?.fieldZone
  ].filter(Boolean);
}

function getOpponent(game, player, analysis = {}) {
  return analysis.opponent
    || (game?.player1 === player ? game?.player2 : null)
    || (game?.player2 === player ? game?.player1 : null)
    || game?.getOpponent?.(player)
    || null;
}

function inferBattleContext(context = {}, analysis = {}) {
  const attack = context.attack || context.battle || context.battleContext || context.combat || {};
  const attacker = context.attacker
    || context.attackingMonster
    || context.attackMonster
    || attack.attacker
    || attack.attackingMonster
    || analysis.currentAttacker
    || null;
  const defender = context.defender
    || context.attackTarget
    || context.target
    || context.defendingMonster
    || attack.defender
    || attack.target
    || attack.attackTarget
    || analysis.currentDefender
    || null;
  const directAttack = Boolean(
    context.directAttack
    || context.isDirectAttack
    || attack.directAttack
    || attack.isDirectAttack
    || (attacker && !defender)
  );
  return { attacker, defender, directAttack };
}

function evaluateIncomingBattleThreat({ game, player, analysis = {}, context = {} } = {}) {
  const opponent = getOpponent(game, player, analysis);
  const { attacker, defender, directAttack } = inferBattleContext(context, analysis);
  if (!attacker) {
    return {
      valid: false,
      reason: "no current attack context",
      attacker: null,
      defender: null,
      opponent,
      directAttack: false,
      projectedDamage: 0,
      losesDefender: false,
      lethal: false
    };
  }

  const attackerIsOurs = ownsCard(player, attacker);
  const targetIsOurs = directAttack || !defender || ownsCard(player, defender);
  if (attackerIsOurs || !targetIsOurs) {
    return {
      valid: false,
      reason: "attack is not threatening this player",
      attacker,
      defender,
      opponent,
      directAttack,
      projectedDamage: 0,
      losesDefender: false,
      lethal: false
    };
  }

  const attackerAtk = getEffectiveAtk(attacker);
  const defenderStat = defender ? getBattleStat(defender) : 0;
  let projectedDamage = 0;
  let losesDefender = false;
  let trade = false;

  if (directAttack || !defender) {
    projectedDamage = attackerAtk;
  } else if (isAttackPosition(defender)) {
    const diff = attackerAtk - getEffectiveAtk(defender);
    projectedDamage = Math.max(0, diff);
    losesDefender = diff >= 0;
    trade = diff === 0;
  } else {
    const diff = attackerAtk - getEffectiveDef(defender);
    projectedDamage = Math.max(0, diff);
    losesDefender = diff > 0;
  }

  const lp = numberValue(player?.lp ?? player?.lifePoints, 8000);
  const attackerThreat = Math.max(attackerAtk, getBattleStat(attacker));

  return {
    valid: true,
    reason: "incoming opponent attack",
    attacker,
    defender,
    opponent,
    directAttack,
    projectedDamage,
    losesDefender,
    trade,
    lethal: projectedDamage >= lp,
    highDamage: projectedDamage >= 1500,
    attackerThreat
  };
}

function hasCardNamed(cards, name) {
  return compactCards(cards).some((card) => getCardName(card) === name);
}

function hasPeacemakerEquipped(card) {
  return compactCards(card?.equippedCards).some((equipped) => getCardName(equipped) === BW.PEACEMAKER)
    || compactCards(card?.equips).some((equipped) => getCardName(equipped) === BW.PEACEMAKER)
    || compactCards(card?.equipCards).some((equipped) => getCardName(equipped) === BW.PEACEMAKER)
    || compactCards(card?.attachedCards).some((equipped) => getCardName(equipped) === BW.PEACEMAKER)
    || Boolean(card?.statuses?.burningPeacemaker || card?.flags?.burningPeacemaker);
}

function hasRelevantSheriffDeclaration(card, analysis = {}) {
  if (getCardName(card) !== BW.SHERIFF) return false;
  const values = [
    ...asArray(analysis.activeDeclaredTypes),
    ...asArray(analysis.declaredTypes),
    ...asArray(analysis.activeTypeDeclarations),
    card?.declaredType,
    card?.selectedType,
    card?.flags?.declaredType
  ].filter(Boolean);
  return values.length > 0;
}

function isReadyAscensionMaterial(card) {
  return isFaceUpBurningWestMonster(card) && numberValue(card?.level, 0) >= 5;
}

function scoreProtectedCard(card, analysis = {}) {
  if (!card) return 0;
  const name = getCardName(card);
  let score = 0;

  if (name === BW.EXECUTIONER) score += 42;
  if (name === BW.SPECIALIST && hasPeacemakerEquipped(card)) score += 38;
  if (name === BW.SPECIALIST) score += 26;
  if (name === BW.UNDERTAKER) score += 24;
  if (name === BW.SHERIFF) score += hasRelevantSheriffDeclaration(card, analysis) ? 26 : 18;
  if (name === BW.PREACHER) score += 16;
  if (isReadyAscensionMaterial(card)) score += 18;
  if (isFaceUpBurningWestMonster(card)) score += 12;

  if (name === BW.WANTED) score += 34;
  if (name === BW.PEACEMAKER) score += 28;
  if (name === BW.LAW) score += 26;
  if (name === BW.REWARD) score += analysis?.battleRewardLive ? 25 : 18;
  if (name === BW.QUICK_DRAW) score += 17;
  if (name === BW.AMBUSH) score += 16;
  if (name === BW.DEAD_EYE) score += 16;
  if (name === BW.FUNERAL) score += 12;
  if (name === BW.CRASH_TOWN) score += 10;

  if (isBurningWest(card) && score === 0) score += 9;
  return score;
}

function getImportantBurningWestCards(player, analysis = {}) {
  return getFieldCards(player)
    .filter((card) => isBurningWest(card))
    .map((card) => ({ card, score: scoreProtectedCard(card, analysis) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

function flattenCardCandidates(value) {
  const result = [];
  const visit = (entry) => {
    if (!entry) return;
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (entry.cardKind || entry.name || entry.instanceId || entry.uuid) {
      result.push(entry);
      return;
    }
    for (const key of ["card", "target", "targetCard", "movedCard", "destroyedCard"]) {
      if (entry[key]) visit(entry[key]);
    }
    for (const key of ["cards", "targets", "targetCards", "destroyedCards", "wouldDestroyCards"]) {
      if (entry[key]) visit(entry[key]);
    }
  };
  visit(value);
  return result;
}

function collectThreatenedCards(context = {}, analysis = {}) {
  const fields = [
    context.destroyedCards,
    context.cardsToDestroy,
    context.destructionTargets,
    context.threatenedCards,
    context.affectedCards,
    context.targetCards,
    context.targets,
    context.target,
    context.cardToDestroy,
    context.activationContext?.destroyedCards,
    context.activationContext?.cardsToDestroy,
    context.activationContext?.wouldDestroyCards,
    context.activationContext?.targetCards,
    context.activationContext?.targets,
    context.actionContext?.destroyedCards,
    context.actionContext?.cardsToDestroy,
    context.actionContext?.targetCards,
    context.actionContext?.targets,
    context.preview?.destroyedCards,
    context.preview?.wouldDestroyCards,
    context.preview?.targets,
    analysis.threatenedCards
  ];

  const seen = new Set();
  const cards = [];
  for (const field of fields) {
    for (const card of flattenCardCandidates(field)) {
      const key = cardInstanceKey(card);
      if (key == null || seen.has(key)) continue;
      seen.add(key);
      cards.push(card);
    }
  }
  return cards;
}

function optionName(option) {
  return getCardName(option?.card || option);
}

function hasBurningWestDefenseResponseInChain(chainSystem, player) {
  const playerId = getPlayerId(player);
  const links = [
    ...asArray(chainSystem?.chainStack),
    ...asArray(chainSystem?.stack),
    ...asArray(chainSystem?.chain),
    ...asArray(chainSystem?.getChainSummary?.())
  ];

  return links.some((link) => {
    const card = link?.card || link?.sourceCard || link?.source || link?.activation?.card;
    if (!card || !BURNING_WEST_DEFENSE_NAMES.has(getCardName(card))) return false;
    const ownerId = getOwnerId(link?.player || link?.owner || card.owner || card.controller);
    return !playerId || !ownerId || ownerId === playerId;
  });
}

function getDefenseCandidates(player) {
  return [
    ...compactCards(player?.hand),
    ...compactCards(player?.graveyard)
  ].filter((card) => isMonster(card) && isBurningWest(card) && numberValue(card?.level, 0) <= 5);
}

function getPreferredAmbushPosition(card, threat) {
  const name = getCardName(card);
  if (name === BW.PREACHER || name === BW.UNDERTAKER) return "defense";
  if (threat?.attacker && getEffectiveAtk(card) + 500 >= getEffectiveAtk(threat.attacker)) return "attack";
  return getEffectiveDef(card) + 500 >= getEffectiveAtk(threat?.attacker) ? "defense" : "attack";
}

function scoreAmbushCandidate(card, threat, analysis = {}) {
  if (!card || !threat?.attacker) return 0;
  const name = getCardName(card);
  const attackerAtk = getEffectiveAtk(threat.attacker);
  const attackAfterBuff = getEffectiveAtk(card) + 500;
  const defenseAfterBuff = getEffectiveDef(card) + 500;
  const bestStat = Math.max(attackAfterBuff, defenseAfterBuff);
  let score = 18 + Math.min(18, Math.floor(bestStat / 200));

  if (attackAfterBuff > attackerAtk) score += 26;
  else if (attackAfterBuff === attackerAtk) score += 16;
  if (defenseAfterBuff >= attackerAtk) score += 18;
  if (threat.lethal && bestStat >= attackerAtk) score += 28;
  if (threat.highDamage && defenseAfterBuff >= attackerAtk) score += 14;

  if (name === BW.UNDERTAKER) {
    score += attackerAtk >= defenseAfterBuff ? 32 : 18;
  } else if (name === BW.SPECIALIST) {
    score += attackAfterBuff >= attackerAtk ? 28 : 16;
  } else if (name === BW.PREACHER) {
    score += threat.lethal || threat.losesDefender ? 24 : 10;
  } else if (name === BW.GUNSLINGER || name === BW.BUTCHER) {
    score += bestStat >= attackerAtk ? 18 : 2;
  } else if (name === BW.SHERIFF) {
    score += hasRelevantSheriffDeclaration(card, analysis) ? 20 : 12;
  }

  if (scoreProtectedCard(card, analysis) > 30 && bestStat < attackerAtk && !threat.lethal) {
    score -= 10;
  }
  return score;
}

export function evaluateBurningWestRecruitCandidate(candidates, context = {}) {
  const cards = compactCards(candidates).filter((card) => isMonster(card) && isBurningWest(card));
  if (!cards.length) return null;

  const analysis = context.analysis || {};
  const threat = evaluateIncomingBattleThreat({
    game: context.game,
    player: context.player,
    analysis,
    context: context.activationContext || context.context || context
  });
  const sourceName = getCardName(context.source);
  const isAmbush = sourceName === BW.AMBUSH
    || context.effect?.id === "ambush_in_crash_town"
    || context.action?.contextLabel === "ambush_in_crash_town"
    || context.activationContext?.sourceName === BW.AMBUSH;
  if (!isAmbush) return null;

  const scored = cards.map((card) => {
    const score = threat.valid
      ? scoreAmbushCandidate(card, threat, analysis)
      : scoreProtectedCard(card, analysis) +
        Math.floor(Math.max(getEffectiveAtk(card), getEffectiveDef(card)) / 200);
    return {
      card,
      score,
      reason: threat.valid
        ? `Ambush body score ${score} into ${getCardName(threat.attacker)}`
        : `Burning West recruit score ${score}`
    };
  }).sort((a, b) => b.score - a.score);

  return {
    best: scored[0]?.card || null,
    score: scored[0]?.score || 0,
    scores: scored,
    reason: scored[0]?.reason || "no Burning West recruit candidate"
  };
}

export function evaluateBurningWestAmbushResponse(option, analysis = {}, context = {}) {
  if (optionName(option) !== BW.AMBUSH) return null;
  const player = context.player || analysis.player;
  const game = context.game;
  const threat = evaluateIncomingBattleThreat({ game, player, analysis, context });
  if (!threat.valid) {
    return { option, pass: true, score: 0, reason: threat.reason };
  }

  if (getMonsterZones(player).length >= 5) {
    return { option, pass: true, score: 0, reason: "Ambush has no monster zone space" };
  }

  const candidates = getDefenseCandidates(player);
  if (!candidates.length) {
    return { option, pass: true, score: 0, reason: "Ambush has no Burning West summon target" };
  }

  const recruit = evaluateBurningWestRecruitCandidate(candidates, {
    ...context,
    source: option.card,
    effect: option.effect,
    analysis
  });
  const bestCandidate = recruit?.best || null;
  if (!bestCandidate) {
    return { option, pass: true, score: 0, reason: "Ambush has no profitable body" };
  }

  let score = 28 + Math.min(35, Math.floor(threat.projectedDamage / 80)) + Math.min(30, recruit.score);
  if (threat.lethal) score += 70;
  if (threat.highDamage) score += 22;
  if (threat.losesDefender) score += 12 + scoreProtectedCard(threat.defender, analysis);
  if (threat.attackerThreat >= 2300) score += 14;

  const threshold = threat.lethal || threat.losesDefender ? 50 : 62;
  const pass = score < threshold;
  return {
    option,
    pass,
    score,
    reason: pass
      ? "Ambush attack is not valuable enough"
      : `Ambush protects against ${getCardName(threat.attacker)} with ${getCardName(bestCandidate)}`,
    threat,
    bestCandidate
  };
}

function crashTownBlocksQuickDraw({ player, opponent, analysis = {} }) {
  const fieldSpell =
    analysis.fieldSpell || player?.fieldSpell || player?.fieldZone || analysis.game?.fieldSpell || null;
  if (getCardName(fieldSpell) !== BW.CRASH_TOWN) return false;
  const ownMonsters = getMonsterZones(player);
  const opponentMonsters = getMonsterZones(opponent);
  return ownMonsters.length === 1
    && opponentMonsters.length === 1
    && isFaceUpBurningWestMonster(ownMonsters[0])
    && isFaceUp(opponentMonsters[0]);
}

function selectQuickDrawOwnTarget(player, threat, analysis = {}) {
  if (threat?.defender && isFaceUpBurningWestMonster(threat.defender) && ownsCard(player, threat.defender)) {
    return threat.defender;
  }
  return getMonsterZones(player)
    .filter(isFaceUpBurningWestMonster)
    .sort((a, b) => scoreProtectedCard(b, analysis) - scoreProtectedCard(a, analysis))[0] || null;
}

export function evaluateBurningWestQuickDrawResponse(option, analysis = {}, context = {}) {
  if (optionName(option) !== BW.QUICK_DRAW) return null;
  const player = context.player || analysis.player;
  const game = context.game;
  const opponent = getOpponent(game, player, analysis);
  const threat = evaluateIncomingBattleThreat({ game, player, analysis, context });
  if (!threat.valid || !threat.attacker) {
    return { option, pass: true, score: 0, reason: "Quick Draw has no valuable current battle pair" };
  }
  if (crashTownBlocksQuickDraw({ player, opponent, analysis: { ...analysis, game } })) {
    return { option, pass: true, score: 0, reason: "Crash Town blocks Quick Draw effect destruction payoff" };
  }

  const ownTarget = selectQuickDrawOwnTarget(player, threat, analysis);
  if (!ownTarget) {
    return { option, pass: true, score: 0, reason: "Quick Draw has no face-up Burning West target" };
  }

  const attackDiff = Math.abs(getEffectiveAtk(ownTarget) - getEffectiveAtk(threat.attacker));
  let score = 30;
  if (threat.defender && sameCard(ownTarget, threat.defender)) score += 18;
  if (threat.losesDefender) score += 22 + scoreProtectedCard(ownTarget, analysis);
  if (threat.lethal) score += 48;
  if (getEffectiveAtk(threat.attacker) >= getEffectiveAtk(ownTarget)) score += 18;
  if (attackDiff <= 500) score += 16;
  if (getEffectiveAtk(threat.attacker) >= 2200) score += 12;

  const pass = score < 58;
  return {
    option,
    pass,
    score,
    reason: pass
      ? "Quick Draw battle removal is not valuable enough"
      : `Quick Draw removes ${getCardName(threat.attacker)} using ${getCardName(ownTarget)}`,
    threat,
    ownTarget,
    opponentTarget: threat.attacker
  };
}

function isOpponentActivation(context = {}, player) {
  const responsePlayer = context.responsePlayer || player;
  const actor =
    context.activatingPlayer ||
    context.sourcePlayer ||
    context.actionPlayer ||
    context.triggerPlayer ||
    context.contextPlayer ||
    context.owner ||
    null;
  if (!actor || !responsePlayer) return true;
  return getPlayerId(actor) !== getPlayerId(responsePlayer);
}

export function evaluateBurningWestLawResponse(option, analysis = {}, context = {}) {
  if (optionName(option) !== BW.LAW) return null;
  const player = context.player || analysis.player;
  if (!isOpponentActivation(context, player)) {
    return { option, pass: true, score: 0, reason: "Law does not answer own activation" };
  }

  const threatened = collectThreatenedCards(context, analysis)
    .filter((card) => ownsCard(player, card) && isBurningWest(card));
  const important = threatened.length
    ? threatened.map((card) => ({ card, score: scoreProtectedCard(card, analysis) }))
    : getImportantBurningWestCards(player, analysis).slice(0, 3);

  const maxValue = important.reduce((max, entry) => Math.max(max, entry.score), 0);
  const multiCard = important.length >= 2;
  let score = threatened.length ? 46 : 34;
  score += maxValue;
  if (multiCard) score += 24;
  if (important.some((entry) => [BW.WANTED, BW.PEACEMAKER, BW.LAW, BW.REWARD, BW.EXECUTIONER].includes(getCardName(entry.card)))) {
    score += 14;
  }
  if (important.some((entry) => isReadyAscensionMaterial(entry.card))) score += 12;
  if (analysis.underPressure || analysis.opponentPressure) score += 10;

  const pass = score < 70;
  const protectedName = important[0]?.card ? getCardName(important[0].card) : "no key card";
  return {
    option,
    pass,
    score,
    reason: pass
      ? "Law target value is too low"
      : `Law protects ${protectedName}`,
    threatenedCards: important.map((entry) => entry.card)
  };
}

function getPreferredInstanceIds(cards) {
  return compactCards(cards)
    .map((card) => card?.instanceId || card?.uuid || card?.id)
    .filter(Boolean);
}

function mergeActionContext(base, addition) {
  return {
    ...(base || {}),
    ...(addition || {}),
    targetPreferences: {
      ...(base?.targetPreferences || {}),
      ...(addition?.targetPreferences || {})
    },
    specialSummonPositions: {
      ...(base?.specialSummonPositions || {}),
      ...(addition?.specialSummonPositions || {}),
      byName: {
        ...(base?.specialSummonPositions?.byName || {}),
        ...(addition?.specialSummonPositions?.byName || {})
      }
    }
  };
}

export function buildBurningWestDefenseActivationContext({
  option,
  analysis = {},
  context = {},
  evaluation = {},
  buildActivationContext
} = {}) {
  const card = option?.card;
  const base = typeof buildActivationContext === "function"
    ? buildActivationContext(card, analysis, {
        zone: option?.zone,
        sourceZone: option?.zone,
        activationZone: option?.zone,
        effect: option?.effect,
        reason: evaluation.reason
      })
    : {};

  const name = getCardName(card);
  let actionContext = base?.actionContext || {};

  if (name === BW.QUICK_DRAW) {
    actionContext = mergeActionContext(actionContext, {
      targetPreferences: {
        quick_draw_burning_west_target: {
          intent: "benefit",
          role: "named_preference",
          preferredInstanceIds: getPreferredInstanceIds([evaluation.ownTarget]),
          preferredNames: [getCardName(evaluation.ownTarget)].filter(Boolean)
        },
        quick_draw_opponent_target: {
          intent: "harm",
          role: "named_preference",
          preferredInstanceIds: getPreferredInstanceIds([evaluation.opponentTarget]),
          preferredNames: [getCardName(evaluation.opponentTarget)].filter(Boolean)
        }
      }
    });
  }

  if (name === BW.AMBUSH && evaluation.bestCandidate) {
    actionContext = mergeActionContext(actionContext, {
      specialSummonPositions: {
        byName: {
          [getCardName(evaluation.bestCandidate)]: getPreferredAmbushPosition(evaluation.bestCandidate, evaluation.threat)
        }
      }
    });
  }

  return {
    ...base,
    sourceName: name,
    sourceZone: option?.zone || base?.sourceZone,
    activationZone: option?.zone || base?.activationZone,
    chainContext: context,
    actionContext
  };
}

function canSheriffProfitablyDie(targetCard, player) {
  if (getCardName(targetCard) !== BW.SHERIFF) return false;
  return hasCardNamed(player?.deck, BW.PEACEMAKER)
    || hasCardNamed(player?.deck, BW.WANTED)
    || hasCardNamed(player?.deck, BW.REWARD);
}

function wantsCardInGraveyard(card) {
  const name = getCardName(card);
  return name === BW.UNDERTAKER
    || name === BW.BUTCHER
    || name === BW.GUNSLINGER
    || name === BW.FUNERAL;
}

function inferReplacementThreat(context = {}, analysis = {}) {
  return {
    lethal: Boolean(context.lethal || context.wouldBeLethal || context.preventsLethal || analysis.lethalThreat),
    pressure: Boolean(context.underPressure || analysis.underPressure || analysis.opponentPressure),
    multiCard: asArray(context.destroyedCards || context.cardsToDestroy || context.targets).length >= 2,
    cause: context.cause || context.reason || context.event || ""
  };
}

export function evaluateBurningWestReplacementPolicy({
  game,
  player,
  sourceCard,
  effect,
  replacementEffect,
  targetCard,
  cause,
  fromZone,
  context = {},
  kind,
  analysis = {}
} = {}) {
  if (getCardName(sourceCard) !== BW.PREACHER) {
    return { use: true, score: 0, reason: "not a Burning West Preacher replacement" };
  }
  if (!targetCard || !ownsCard(player, targetCard) || !isBurningWest(targetCard)) {
    return { use: false, score: 0, reason: "Preacher only protects meaningful Burning West cards" };
  }

  const threat = inferReplacementThreat({ ...context, cause }, analysis);
  const targetValue = scoreProtectedCard(targetCard, analysis);
  const targetName = getCardName(targetCard);
  let score = targetValue;

  if (threat.lethal) score += 80;
  if (threat.pressure) score += 12;
  if (threat.multiCard) score += 10;
  if (targetName === BW.EXECUTIONER) score += 26;
  if (targetName === BW.SPECIALIST && hasPeacemakerEquipped(targetCard)) score += 35;
  if (isReadyAscensionMaterial(targetCard)) score += 18;
  if (targetName === BW.WANTED || targetName === BW.PEACEMAKER || targetName === BW.LAW || targetName === BW.REWARD) score += 14;

  const lowerCause = String(cause || threat.cause || "").toLowerCase();
  if (!threat.lethal && canSheriffProfitablyDie(targetCard, player)) {
    score -= lowerCause.includes("battle") ? 34 : 18;
  }
  if (!threat.lethal && kind === "send_to_grave" && wantsCardInGraveyard(targetCard)) {
    score -= 24;
  }
  if (!threat.lethal && targetValue <= 16 && !analysis.underPressure) {
    score -= 14;
  }

  const use = score >= 52;
  return {
    use,
    score,
    reason: use
      ? `Preacher protects ${targetName}`
      : `Preacher saves itself for higher-value protection than ${targetName}`,
    effect,
    replacementEffect,
    fromZone,
    game
  };
}

export {
  BW as BURNING_WEST_DEFENSE_CARDS,
  BURNING_WEST_DEFENSE_NAMES,
  evaluateIncomingBattleThreat,
  hasBurningWestDefenseResponseInChain,
  scoreProtectedCard
};
