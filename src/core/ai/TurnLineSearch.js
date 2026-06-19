import { getBattleStatForAttackTarget, getEffectiveAtk } from "./common/cardStats.js";
import { resolvePerspectivePlayers } from "./StrategyUtils.js";
import {
  fingerprintAction,
  summarizePlanningState,
} from "./common/planningDiagnostics.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
  selectTributeIndicesByValue,
} from "../game/summon/tributeValue.js";

function actionRequiresHand(actionType) {
  return (
    actionType === "summon" ||
    actionType === "spell" ||
    actionType === "handIgnition" ||
    actionType === "set_spell_trap" ||
    actionType === "special_summon_sanctum_protector"
  );
}

function expectedHandKind(actionType) {
  if (
    actionType === "summon" ||
    actionType === "handIgnition" ||
    actionType === "special_summon_sanctum_protector"
  ) {
    return "monster";
  }
  if (actionType === "spell") return "spell";
  if (actionType === "set_spell_trap") return ["spell", "trap"];
  return null;
}

function actionIsValidForHand(action, hand) {
  if (!action) return false;
  if (!actionRequiresHand(action.type)) return true;
  if (!Array.isArray(hand)) return false;
  if (!Number.isInteger(action.index)) return false;
  const card = hand[action.index];
  if (!card) return false;
  const requiredKind = expectedHandKind(action.type);
  if (requiredKind) {
    const kinds = Array.isArray(requiredKind) ? requiredKind : [requiredKind];
    if (!kinds.includes(card.cardKind)) return false;
  }
  if (action.cardName && card.name !== action.cardName) return false;
  return true;
}

function tributeMatchesAltRequirement(card, alt) {
  if (!card || card.cardKind !== "monster" || !alt) return false;
  if (card.isFacedown) return false;
  if (alt.requiresName && card.name !== alt.requiresName) return false;
  if (alt.requiresType && card.type !== alt.requiresType) return false;
  return true;
}

function getPlannerTributeRequirement(card, player, strategy) {
  if (!card) return { tributesNeeded: 0, usingAlt: false, alt: null };
  if (typeof strategy?.getTributeRequirementFor === "function") {
    return strategy.getTributeRequirementFor(card, player) || {
      tributesNeeded: 0,
      usingAlt: false,
      alt: null,
    };
  }

  let tributesNeeded = 0;
  const level = Number(card.level || 0);
  if (level >= 5 && level <= 6) tributesNeeded = 1;
  else if (level >= 7) tributesNeeded = 2;
  if (typeof card.requiredTributes === "number" && card.requiredTributes >= 0) {
    tributesNeeded = card.requiredTributes;
  }

  const alt = card.altTribute || null;
  if (alt?.type === "no_tribute_if_empty_field" && (player?.field || []).length === 0) {
    return { tributesNeeded: 0, usingAlt: true, alt };
  }
  if (alt?.requiresType && typeof alt?.tributes === "number") {
    const hasRequiredType = (player?.field || []).some((entry) =>
      tributeMatchesAltRequirement(entry, alt),
    );
    if (hasRequiredType && alt.tributes < tributesNeeded) {
      return { tributesNeeded: alt.tributes, usingAlt: true, alt };
    }
  }
  if (alt?.requiresName && typeof alt?.tributes === "number") {
    const hasRequiredName = (player?.field || []).some((entry) =>
      tributeMatchesAltRequirement(entry, alt),
    );
    if (hasRequiredName && alt.tributes < tributesNeeded) {
      return { tributesNeeded: alt.tributes, usingAlt: true, alt };
    }
  }

  return { tributesNeeded, usingAlt: false, alt };
}

function selectPlannerTributes(field = [], tributesNeeded = 0, cardToSummon = null, strategy = null) {
  if (tributesNeeded <= 0) return [];
  if (!fieldHasTributeValue(field || [], tributesNeeded, cardToSummon)) return [];
  const selected =
    typeof strategy?.selectBestTributes === "function"
      ? strategy.selectBestTributes(field, tributesNeeded, cardToSummon)
      : selectTributeIndicesByValue(field, tributesNeeded, cardToSummon, {
          scoreCard: (card) =>
            Math.max(0, Number(card?.atk || 0)) +
            Math.max(0, Number(card?.def || 0)) * 0.25 +
            Number(card?.level || 0) * 120,
        });
  return [...new Set(selected || [])].filter(
    (index) => Number.isInteger(index) && field[index],
  );
}

function summonActionIsStillLegal(action, state, strategy) {
  if (!action || action.type !== "summon") return true;
  const player = state?.bot || {};
  const hand = player.hand || [];
  if (!actionIsValidForHand(action, hand)) return false;
  const card = hand[action.index];
  if (!card || card.cardKind !== "monster") return false;
  if (card.cannotBeNormalSummonedOrSet) return false;
  if (card.summonRestrict === "shadow_heart_invocation_only") return false;

  const summonLimit = 1 + Math.max(0, Number(player.additionalNormalSummons || 0));
  if (Number(player.summonCount || 0) >= summonLimit) return false;

  const tributeInfo = getPlannerTributeRequirement(card, player, strategy);
  const tributesNeeded = Math.max(0, Number(tributeInfo.tributesNeeded || 0));
  const field = player.field || [];
  if (!fieldHasTributeValue(field, tributesNeeded, card)) return false;
  let physicalTributeCount = 0;
  if (tributesNeeded > 0) {
    const tributeIndices = selectPlannerTributes(field, tributesNeeded, card, strategy);
    const tributeCards = getTributeCardsFromIndices(field, tributeIndices);
    if (getTributeValueTotal(tributeCards, card) < tributesNeeded) return false;
    physicalTributeCount = tributeIndices.length;
    if (
      tributeInfo.usingAlt === true &&
      tributeInfo.alt &&
      !tributeIndices
        .slice(0, tributesNeeded)
        .some((index) => tributeMatchesAltRequirement(field[index], tributeInfo.alt))
    ) {
      return false;
    }
  }
  if (field.length - physicalTributeCount + 1 > 5) return false;

  return true;
}

function clonePlain(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (_err) {
      // Fall through to JSON clone for plain simulation data.
    }
  }
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (nested instanceof Map) return Object.fromEntries(nested.entries());
      if (nested instanceof Set) return [...nested];
      if (typeof nested === "function") return undefined;
      return nested;
    }),
  );
}

function clonePlayerState(player) {
  const safe = player || {};
  const snapshot = {
    id: safe.id || "unknown",
    name: safe.name || safe.id || "unknown",
    lp: safe.lp || 0,
    hand: safe.hand || [],
    field: safe.field || [],
    graveyard: safe.graveyard || [],
    deck: safe.deck || [],
    extraDeck: safe.extraDeck || [],
    banished: safe.banished || [],
    fieldSpell: safe.fieldSpell || null,
    spellTrap: safe.spellTrap || [],
    summonCount: safe.summonCount || 0,
    additionalNormalSummons: safe.additionalNormalSummons || 0,
    controllerType: safe.controllerType,
  };
  return clonePlain(snapshot);
}

function resolvePerspectiveBot(game, strategy) {
  return strategy?.bot || (strategy?.id ? strategy : null) || game?.bot || null;
}

function clonePlanningState(game, strategy) {
  const perspectiveBot = resolvePerspectiveBot(game, strategy);
  const isPerspectiveState = game?._isPerspectiveState === true;
  const opponent = isPerspectiveState
    ? game.player
    : resolvePerspectivePlayers(game, perspectiveBot).opponent;
  const sourceBot = isPerspectiveState
    ? game.bot
    : perspectiveBot || game?.bot || game?.player;

  const state = {
    player: clonePlayerState(opponent || game?.player),
    bot: clonePlayerState(sourceBot),
    turn: game?.turn,
    phase: game?.phase,
    turnCounter: game?.turnCounter || 0,
    _isPerspectiveState: true,
    _gameRef: game?._gameRef || game,
  };
  if (game?._simOncePerTurn) {
    state._simOncePerTurn = clonePlain(game._simOncePerTurn);
  }
  if (game?._simLuminarch) {
    state._simLuminarch = clonePlain(game._simLuminarch);
  }
  return state;
}

function normalizeCounterEntries(counters) {
  if (!counters) return [];
  if (counters instanceof Map) return [...counters.entries()];
  if (Array.isArray(counters)) return counters;
  if (typeof counters === "object") return Object.entries(counters);
  return [];
}

function summarizeBlueprints(card) {
  const stored =
    card?.storedBlueprints ||
    card?.blueprintStorageState?.storedBlueprints ||
    card?.storedEffects ||
    [];
  return (Array.isArray(stored) ? stored : [])
    .map((entry) => entry?.id || entry?.effectId || entry?.sourceName || entry?.name)
    .filter(Boolean)
    .sort()
    .join(",");
}

function summarizeCounters(card) {
  return normalizeCounterEntries(card?.counters)
    .map(([key, value]) => `${key}:${value}`)
    .sort()
    .join(",");
}

function getCardKey(card) {
  if (!card) return "empty";
  const equipNames = (card.equips || [])
    .map((equip) => equip?.name || equip?.id || "?")
    .sort()
    .join("+");
  const equippedTo = card.equippedTo?.name || card.equippedTo?.id || "";
  return [
    card.instanceId || card._instanceId || card.uid || card.uuid || "",
    card.id || 0,
    card.name || "",
    card.cardKind || "",
    card.position || "",
    card.isFacedown ? "fd" : "fu",
    card.atk || 0,
    card.def || 0,
    card.tempAtkBoost || 0,
    card.tempDefBoost || 0,
    card.equipAtkBonus || 0,
    card.equipDefBonus || 0,
    card.hasAttacked ? "attacked" : "",
    card.cannotAttackThisTurn ? "cantAtk" : "",
    summarizeCounters(card),
    summarizeBlueprints(card),
    equipNames,
    equippedTo,
  ].join(":");
}

function summarizeZone(cards = [], { sort = false } = {}) {
  const values = (cards || []).filter(Boolean).map(getCardKey);
  if (sort) values.sort();
  return values.join("|");
}

function summarizeSimOpt(value) {
  if (!value) return "";
  const normalize = (entry) => {
    if (entry instanceof Set) return [...entry].sort().join(",");
    if (Array.isArray(entry)) return entry.slice().sort().join(",");
    if (entry && typeof entry === "object") {
      return Object.entries(entry)
        .map(([key, nested]) => `${key}=${normalize(nested)}`)
        .sort()
        .join(";");
    }
    return String(entry);
  };
  return normalize(value);
}

function getPlanningStateHash(state) {
  const bot = state?.bot || {};
  const opponent = state?.player || {};
  const playerSummary = (player) =>
    [
      player.id || "",
      player.lp || 0,
      player.summonCount || 0,
      player.additionalNormalSummons || 0,
      summarizeZone(player.hand, { sort: true }),
      summarizeZone(player.field),
      summarizeZone(player.spellTrap),
      getCardKey(player.fieldSpell),
      summarizeZone(player.graveyard, { sort: true }),
      summarizeZone(player.banished, { sort: true }),
    ].join("~");

  return [
    state?.phase || "",
    state?.turn || "",
    state?.turnCounter || 0,
    playerSummary(bot),
    playerSummary(opponent),
    summarizeSimOpt(state?._simOncePerTurn),
  ].join("||");
}

function filterStillLegalRootActions(actions, state, strategy = null) {
  if (!Array.isArray(actions)) return [];
  const hand = state?.bot?.hand || [];
  return actions.filter((action) => {
    if (!actionIsValidForHand(action, hand)) return false;
    return summonActionIsStillLegal(action, state, strategy);
  });
}

function simulatePlanningAction(state, action, strategy) {
  if (typeof strategy?.simulateMainPhaseAction === "function") {
    strategy.simulateMainPhaseAction(state, action);
  }
  return state;
}

function evaluateBasePlanningScore(state, strategy, options = {}) {
  if (typeof options.evaluateState === "function") {
    return options.evaluateState(state, state.bot);
  }
  if (
    options.useV2Evaluation !== false &&
    typeof strategy?.evaluateBoardV2 === "function"
  ) {
    return strategy.evaluateBoardV2(state, state.bot);
  }
  if (typeof strategy?.evaluateBoard === "function") {
    return strategy.evaluateBoard(state, state.bot);
  }
  return 0;
}

function normalizeMilestoneResult(result) {
  const scoreDelta = Number(result?.scoreDelta ?? result?.milestoneScore ?? 0);
  return {
    scoreDelta: Number.isFinite(scoreDelta) ? scoreDelta : 0,
    milestones: Array.isArray(result?.milestones) ? result.milestones : [],
  };
}

function evaluatePlanningTerminal(
  finalState,
  strategy,
  options = {},
  sequence = [],
  initialState = null,
) {
  const rawBaseScore = evaluateBasePlanningScore(finalState, strategy, options);
  const baseScore = Number.isFinite(Number(rawBaseScore))
    ? Number(rawBaseScore)
    : 0;
  const milestoneInput = {
    initialState,
    finalState,
    sequence,
    baseScore,
    finalScore: baseScore,
    options,
    profile: options.profile,
    planningContext: options.planningContext,
  };
  const milestoneResult =
    typeof strategy?.scoreLineMilestones === "function"
      ? strategy.scoreLineMilestones(milestoneInput)
      : null;
  const { scoreDelta: milestoneScore, milestones } =
    normalizeMilestoneResult(milestoneResult);
  const terminalContext = {
    ...milestoneInput,
    milestoneScore,
    milestones,
  };
  const terminalScore =
    typeof strategy?.scoreLineTerminal === "function"
      ? strategy.scoreLineTerminal(terminalContext)
      : baseScore + milestoneScore;
  const score = Number.isFinite(Number(terminalScore))
    ? Number(terminalScore)
    : baseScore + milestoneScore;

  return {
    score,
    baseScore,
    milestoneScore,
    milestones,
    context: {
      ...terminalContext,
      finalScore: score,
    },
  };
}

function describeAction(action) {
  if (!action) return "no action";
  if (action.type === "simulatedBattle") {
    const target = action.direct ? "direct" : action.targetName || "target";
    return `${action.type}:${action.attackerName || "attacker"}>${target}`;
  }
  const card = action.card?.name || action.cardName || action.name || action.index;
  return card !== undefined ? `${action.type}:${card}` : String(action.type);
}

function isMainBattleMain2Mode(options = {}) {
  return options.turnMode === "mainBattleMain2";
}

function isMain1Phase(phase) {
  return !phase || phase === "main1" || phase === "main";
}

function isBattleReadyPlannerAttacker(card) {
  if (!card || card.cardKind !== "monster") return false;
  if (card.isFacedown) return false;
  if (card.position === "defense") return false;
  if (card.cannotAttackThisTurn || card.hasAttacked) return false;
  return getEffectiveAtk(card) > 0;
}

function getPlannerMaxAttacks(card, state) {
  let extra = Number(card?.extraAttacks || 0);
  if (card?.dynamicExtraAttacks?.source === "graveyard_count") {
    const config = card.dynamicExtraAttacks;
    extra = (state?.bot?.graveyard || []).filter(
      (entry) => entry?.name === config.name,
    ).length;
    extra -= 1;
  }
  if (card?.canAttackAllOpponentMonstersThisTurn) {
    return Math.max(1, Number(card.multiAttackLimit || 1));
  }
  const secondAttack =
    card?.canMakeSecondAttackThisTurn && !card?.secondAttackUsedThisTurn ? 1 : 0;
  return Math.max(1, 1 + Math.max(0, extra) + secondAttack);
}

function canPlannerAttackerStillAttack(card, state) {
  if (!isBattleReadyPlannerAttacker(card)) return false;
  const used = Number(card.attacksUsedThisTurn || 0);
  return used < getPlannerMaxAttacks(card, state);
}

function removeFromZone(zone, card) {
  if (!Array.isArray(zone) || !card) return false;
  const index = zone.indexOf(card);
  if (index < 0) return false;
  zone.splice(index, 1);
  return true;
}

function pushToGraveyard(player, card) {
  if (!player || !card) return;
  if (!Array.isArray(player.graveyard)) player.graveyard = [];
  player.graveyard.push(card);
}

function sameCardIdentity(a, b) {
  if (!a || !b) return false;
  const aInstance = a.instanceId || a._instanceId || a.uid || a.uuid;
  const bInstance = b.instanceId || b._instanceId || b.uid || b.uuid;
  if (aInstance && bInstance) return aInstance === bInstance;
  return a === b;
}

function detachEquipsForDestroyedMonster(player, monster) {
  if (!player || !monster) return [];
  const detached = [];
  const hostEquips = Array.isArray(monster.equips) ? monster.equips : [];
  hostEquips.forEach((equip) => {
    if (equip) detached.push(equip);
  });
  monster.equips = [];

  if (Array.isArray(player.spellTrap)) {
    for (let index = player.spellTrap.length - 1; index >= 0; index -= 1) {
      const card = player.spellTrap[index];
      if (!card) continue;
      if (sameCardIdentity(card.equippedTo, monster)) {
        detached.push(card);
        player.spellTrap.splice(index, 1);
      }
    }
  }

  detached.forEach((equip) => {
    equip.equippedTo = null;
    pushToGraveyard(player, equip);
  });
  return detached;
}

function destroyPlannerMonster(player, monster) {
  if (!player || !monster) return false;
  if (!removeFromZone(player.field, monster)) return false;
  detachEquipsForDestroyedMonster(player, monster);
  pushToGraveyard(player, monster);
  return true;
}

function getSimTurnCounter(turnCounter) {
  return Number.isFinite(Number(turnCounter)) ? Number(turnCounter) : 0;
}

function hasBattleDestructionProtection(card, turnCounter) {
  const currentTurn = getSimTurnCounter(turnCounter);
  return Boolean(
    card?.battleIndestructible ||
      card?.tempBattleIndestructible ||
      card?.cannotBeDestroyedByBattle ||
      card?.simBattleDestructionProtected ||
      (card?.battleIndestructibleOncePerTurn &&
        card?.battleIndestructibleOncePerTurnLastUsedTurn !== currentTurn),
  );
}

function preventBattleDestruction(card, turnCounter) {
  if (!hasBattleDestructionProtection(card, turnCounter)) return false;
  const currentTurn = getSimTurnCounter(turnCounter);
  const nonOnceProtection = Boolean(
    card?.battleIndestructible ||
      card?.tempBattleIndestructible ||
      card?.cannotBeDestroyedByBattle ||
      card?.simBattleDestructionProtected,
  );
  if (card?.simBattleDestructionProtected) {
    card.simBattleDestructionProtected = false;
  }
  if (
    !nonOnceProtection &&
    card?.battleIndestructibleOncePerTurn &&
    card?.battleIndestructibleOncePerTurnLastUsedTurn !== currentTurn
  ) {
    card.battleIndestructibleOncePerTurnLastUsedTurn = currentTurn;
    card.battleIndestructibleOncePerTurnUsed = true;
  }
  return true;
}

function preventsBattleDamageToController(card) {
  return card?.preventsBattleDamageToController === true;
}

function isArcanistMonster(card) {
  if (!card || card.cardKind !== "monster") return false;
  if (card.archetype === "Arcanist") return true;
  return Array.isArray(card.archetypes) && card.archetypes.includes("Arcanist");
}

function applyGrandLibraryBattleReward(state, battlePlan) {
  const bot = state?.bot;
  if (!bot || bot.fieldSpell?.name !== "Arcanist Grand Library") return [];
  if (state._simGrandLibraryBattleRewardUsed) return [];
  const destroyedOpponentMonster = (battlePlan.destroyedCards || []).some(
    (entry) => entry?.owner === "opponent" && entry?.cardKind === "monster",
  );
  if (!destroyedOpponentMonster) return [];
  const attacker = battlePlan.attackerCard || bot.field?.[battlePlan.attackerIndex];
  if (!isArcanistMonster(attacker)) return [];
  const drawn = bot.deck?.shift?.();
  if (!drawn) return [];
  if (!Array.isArray(bot.hand)) bot.hand = [];
  bot.hand.push(drawn);
  state._simGrandLibraryBattleRewardUsed = true;
  return [drawn.name || "drawn card"];
}

function applyStrategyBattleRewards(state, battlePlan, summary, strategy, options = {}) {
  if (typeof strategy?.applySimulatedBattleRewards !== "function") return [];
  const rewards = strategy.applySimulatedBattleRewards({
    state,
    battlePlan,
    summary,
    bot: state?.bot,
    opponent: state?.player,
    options,
  });
  return Array.isArray(rewards) ? rewards.filter(Boolean) : [];
}

function prepareStrategyBattle(state, battlePlan, strategy, options = {}) {
  if (typeof strategy?.prepareSimulatedBattle !== "function") return [];
  const bot = state?.bot;
  const opponent = state?.player;
  const attacker = bot?.field?.[battlePlan?.attackerIndex];
  const target = Number.isInteger(battlePlan?.targetIndex)
    ? opponent?.field?.[battlePlan.targetIndex]
    : null;
  const result = strategy.prepareSimulatedBattle({
    state,
    battlePlan,
    attacker,
    target,
    bot,
    opponent,
    options,
  });
  if (Array.isArray(result)) return result.filter(Boolean);
  if (Array.isArray(result?.rewardNames)) return result.rewardNames.filter(Boolean);
  if (result?.rewardName) return [result.rewardName];
  return [];
}

function applySimulatedBattle(state, battlePlan, strategy = null, options = {}) {
  const bot = state?.bot;
  const opponent = state?.player;
  if (!bot || !opponent || !battlePlan) return null;
  const attacker = bot.field?.[battlePlan.attackerIndex];
  const target = Number.isInteger(battlePlan.targetIndex)
    ? opponent.field?.[battlePlan.targetIndex]
    : null;
  if (!canPlannerAttackerStillAttack(attacker, state)) return null;
  const prepareRewards = prepareStrategyBattle(state, battlePlan, strategy, options);
  const attackStat = getEffectiveAtk(attacker);
  const usedAttacks = Number(attacker.attacksUsedThisTurn || 0);
  const summary = {
    type: "simulatedBattle",
    attackerName: attacker.name,
    targetName: target?.name || null,
    direct: !target,
    damage: 0,
    destroyedNames: [],
    destroyedCards: [],
    rewardNames: [...prepareRewards],
    lpGains: [],
    phaseBridge: "main1_battle_main2",
  };
  const recordDestroyed = (card, owner) => {
    if (!card) return;
    summary.destroyedNames.push(card.name || "card");
    summary.destroyedCards.push({
      id: card.id,
      name: card.name,
      owner,
      cardKind: card.cardKind,
      type: card.type,
      archetype: card.archetype,
      archetypes: Array.isArray(card.archetypes) ? [...card.archetypes] : undefined,
      level: card.level || 0,
      atk: card.atk || 0,
      def: card.def || 0,
      baseAtk: card.baseAtk ?? card.originalAtk ?? card.atk ?? 0,
    });
  };
  const inflictDamage = (recipient, amount, involvedCard = null) => {
    const raw = Math.max(0, Number(amount || 0));
    if (
      raw > 0 &&
      involvedCard?.battleDamageHealsControllerThisTurn === true &&
      (!involvedCard.owner || involvedCard.owner === recipient?.id)
    ) {
      const before = Number(recipient.lp || 0);
      recipient.lp = before + raw;
      summary.lpGains.push({
        playerId: recipient.id || null,
        amount: raw,
        sourceName: involvedCard.name || null,
        reason: "battle_damage_heal",
      });
      summary.rewardNames.push("battle damage converted to LP");
      return 0;
    }
    const damage = preventsBattleDamageToController(involvedCard) ? 0 : raw;
    recipient.lp = Math.max(0, Number(recipient.lp || 0) - damage);
    return damage;
  };
  const destroyIfAllowed = (owner, card, ownerLabel) => {
    if (!card) return false;
    if (preventBattleDestruction(card, state?.turnCounter)) return false;
    recordDestroyed(card, ownerLabel);
    return destroyPlannerMonster(owner, card);
  };

  if (!target) {
    summary.damage = inflictDamage(opponent, attackStat, null);
  } else {
    const targetStat = getBattleStatForAttackTarget(target);
    if (target.position === "attack") {
      if (attackStat > targetStat) {
        summary.damage = inflictDamage(opponent, attackStat - targetStat, target);
        destroyIfAllowed(opponent, target, "opponent");
      } else if (attackStat < targetStat) {
        const damageTaken = inflictDamage(bot, targetStat - attackStat, attacker);
        summary.damage = -damageTaken;
        destroyIfAllowed(bot, attacker, "self");
      } else {
        destroyIfAllowed(opponent, target, "opponent");
        destroyIfAllowed(bot, attacker, "self");
      }
    } else if (attackStat > targetStat) {
      destroyIfAllowed(opponent, target, "opponent");
      if (attacker.piercing) {
        summary.damage = inflictDamage(opponent, attackStat - targetStat, target);
      }
    } else if (attackStat < targetStat) {
      const damageTaken = inflictDamage(bot, targetStat - attackStat, attacker);
      summary.damage = -damageTaken;
    }
  }

  if (bot.field?.includes(attacker)) {
    attacker.attacksUsedThisTurn = usedAttacks + 1;
    attacker.hasAttacked =
      attacker.attacksUsedThisTurn >= getPlannerMaxAttacks(attacker, state);
  }
  summary.rewardNames.push(
    ...applyGrandLibraryBattleReward(state, {
      ...battlePlan,
      attackerCard: attacker,
      destroyedCards: summary.destroyedCards,
    }),
  );
  summary.rewardNames.push(
    ...applyStrategyBattleRewards(
      state,
      {
        ...battlePlan,
        attackerCard: attacker,
        destroyedCards: summary.destroyedCards,
      },
      summary,
      strategy,
      options,
    ),
  );
  return summary;
}

function buildPlannerBattlePlans(state) {
  const bot = state?.bot;
  const opponent = state?.player;
  if (!bot || !opponent) return [];
  const opponentMonsters = (opponent.field || []).filter(
    (card) => card?.cardKind === "monster",
  );
  const plans = [];
  (bot.field || []).forEach((attacker, attackerIndex) => {
    if (!canPlannerAttackerStillAttack(attacker, state)) return;
    const usedAttacks = Number(attacker.attacksUsedThisTurn || 0);
    const monsterOnlyExtraAttack =
      usedAttacks > 0 && attacker.extraAttackTargetRestriction === "monster";
    if (
      !attacker.cannotAttackDirectly &&
      !monsterOnlyExtraAttack &&
      (opponentMonsters.length === 0 || attacker.canAttackDirectlyThisTurn)
    ) {
      plans.push({
        attackerIndex,
        targetIndex: null,
        direct: true,
      });
    }
    opponent.field.forEach((target, targetIndex) => {
      if (!target || target.cardKind !== "monster") return;
      plans.push({
        attackerIndex,
        targetIndex,
        direct: false,
      });
    });
  });
  return plans;
}

function chooseBestSingleSimulatedBattle(state, strategy, options = {}) {
  const plans = buildPlannerBattlePlans(state);
  if (plans.length === 0) return null;
  const baseScore = evaluateBasePlanningScore(state, strategy, options);
  let best = null;

  plans.forEach((plan) => {
    const originalAttacker = state.bot?.field?.[plan.attackerIndex] || null;
    const originalTarget = Number.isInteger(plan.targetIndex)
      ? state.player?.field?.[plan.targetIndex] || null
      : null;
    const wasSecondAttack =
      Number(originalAttacker?.attacksUsedThisTurn || 0) > 0;
    const candidateState = clonePlanningState(state, strategy);
    const summary = applySimulatedBattle(candidateState, plan, strategy, options);
    if (!summary) return;
    const destroyedOpponent = summary.destroyedNames.filter(
      (_name, index) => summary.destroyedCards[index]?.owner === "opponent",
    ).length;
    const destroyedSelf = summary.destroyedNames.filter(
      (_name, index) => summary.destroyedCards[index]?.owner === "self",
    ).length;
    const scoreAfter = evaluateBasePlanningScore(candidateState, strategy, options);
    let score = scoreAfter - baseScore;
    if ((candidateState.player?.lp || 0) <= 0) score += 100;
    score += Math.max(0, summary.damage || 0) / 450;
    score += destroyedOpponent * 3;
    score -= destroyedSelf * 4;
    score += (summary.rewardNames || []).length * 2.5;
    if (typeof strategy?.scoreBattleAttackCandidate === "function") {
      const attackerAfter = (candidateState.bot?.field || []).find(
        (card) => card?.name === summary.attackerName,
      );
      const targetAfter = originalTarget
        ? (candidateState.player?.field || []).find(
            (card) => card?.name === originalTarget.name,
          )
        : null;
      const hookDelta = strategy.scoreBattleAttackCandidate({
        attacker: attackerAfter || originalAttacker,
        target: originalTarget,
        baseDelta: scoreAfter - baseScore,
        simState: candidateState,
        game: candidateState,
        bot: candidateState.bot,
        opponent: candidateState.player,
        lethalNow: (candidateState.player?.lp || 0) <= 0,
        attackerSurvived: Boolean(attackerAfter),
        targetSurvived: Boolean(targetAfter),
        isSecondAttack: wasSecondAttack,
        summary,
      });
      if (Number.isFinite(hookDelta)) score += hookDelta;
    }
    if (score <= 0 && destroyedOpponent === 0 && summary.damage <= 0) return;
    if (!best || score > best.score) {
      best = {
        plan,
        score,
        state: candidateState,
        summary,
      };
    }
  });

  return best;
}

function normalizeBattleStepLimit(options = {}) {
  const raw =
    options.battleStepLimit ??
    options.profile?.battleStepLimit ??
    options.planningContext?.profile?.battleStepLimit ??
    1;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function aggregateBattleSummaries(steps = [], totalScore = 0) {
  const validSteps = (steps || []).filter(Boolean);
  const first = validSteps[0] || {};
  const destroyedCards = validSteps.flatMap((step) => step.destroyedCards || []);
  const destroyedNames = validSteps.flatMap((step) => step.destroyedNames || []);
  const rewardNames = validSteps.flatMap((step) => step.rewardNames || []);
  const damage = validSteps.reduce((sum, step) => sum + Number(step.damage || 0), 0);
  return {
    type: "simulatedBattle",
    attackerName: first.attackerName || "attacker",
    targetName: first.targetName || null,
    direct: first.direct === true,
    damage,
    destroyedNames,
    destroyedCards,
    rewardNames,
    battleSteps: validSteps,
    phaseBridge: "main1_battle_main2",
    priority: totalScore,
  };
}

function chooseBestSimulatedBattle(state, strategy, options = {}) {
  const limit = normalizeBattleStepLimit(options);
  let currentState = state;
  let totalScore = 0;
  let firstPlan = null;
  const steps = [];

  for (let stepIndex = 0; stepIndex < limit; stepIndex += 1) {
    const next = chooseBestSingleSimulatedBattle(currentState, strategy, options);
    if (!next) break;
    if (!firstPlan) firstPlan = next.plan;
    steps.push(next.summary);
    totalScore += Number(next.score || 0);
    currentState = next.state;
    if ((currentState.player?.lp || 0) <= 0) break;
  }

  if (steps.length === 0) return null;
  return {
    plan: firstPlan,
    score: totalScore,
    state: currentState,
    summary: aggregateBattleSummaries(steps, totalScore),
  };
}

function tryMainBattleMain2Bridge(state, sequence, strategy, options = {}) {
  if (!isMainBattleMain2Mode(options)) return null;
  if (state?._simPlanningBattleDone) return null;
  if (!isMain1Phase(state?.phase)) return null;
  if (!Array.isArray(sequence)) return null;

  const battle = chooseBestSimulatedBattle(state, strategy, options);
  if (!battle) return null;
  battle.state.phase = "main2";
  battle.state._simPlanningBattleDone = true;
  const pseudoStep = {
    ...battle.summary,
    priority: battle.score,
  };
  return {
    state: battle.state,
    action: pseudoStep,
    score: battle.score,
  };
}

function getCandidatesForDepth(state, strategy, depth, options) {
  if (depth === 0 && Array.isArray(options.preGeneratedActions)) {
    const legal = filterStillLegalRootActions(
      options.preGeneratedActions,
      state,
      strategy,
    );
    if (legal.length > 0) return legal;
  }
  if (typeof strategy?.generateMainPhaseActions !== "function") return [];
  const generated = strategy.generateMainPhaseActions(state) || [];
  return depth === 0
    ? filterStillLegalRootActions(generated, state, strategy)
    : generated;
}

export async function turnLineSearch(game, strategy, options = {}) {
  const {
    beamWidth = 3,
    maxDepth = 3,
    nodeBudget = 200,
    candidateLimit = 8,
    turnMode = "mainOnly",
  } = options;

  if (turnMode !== "mainOnly" && turnMode !== "mainBattleMain2") return null;
  if (!game || !strategy || typeof strategy.simulateMainPhaseAction !== "function") {
    return null;
  }

  let nodesEvaluated = 0;
  const seenStates = new Set();
  const root = clonePlanningState(game, strategy);
  seenStates.add(getPlanningStateHash(root));

  const search = async (currentState, depth, sequence = []) => {
    const terminalEval = () =>
      evaluatePlanningTerminal(currentState, strategy, options, sequence, root);

    if (depth >= maxDepth || nodesEvaluated >= nodeBudget) {
      const terminal = terminalEval();
      return {
        sequence,
        score: terminal.score,
        baseScore: terminal.baseScore,
        milestoneScore: terminal.milestoneScore,
        milestones: terminal.milestones,
        terminalContext: terminal.context,
        finalState: currentState,
        reason: depth >= maxDepth ? "max_depth" : "node_budget",
      };
    }

    let candidates = getCandidatesForDepth(currentState, strategy, depth, options);
    if (!Array.isArray(candidates) || candidates.length === 0) {
      if (nodesEvaluated < nodeBudget) {
        const bridge = tryMainBattleMain2Bridge(
          currentState,
          sequence,
          strategy,
          options,
        );
        if (bridge) {
          nodesEvaluated += 1;
          const bridgeHash = getPlanningStateHash(bridge.state);
          if (!seenStates.has(bridgeHash)) {
            seenStates.add(bridgeHash);
            const future = await search(bridge.state, depth + 1, [
              ...sequence,
              bridge.action,
            ]);
            return {
              action: bridge.action,
              sequence: future.sequence,
              score: future.score,
              baseScore: future.baseScore,
              milestoneScore: future.milestoneScore,
              milestones: future.milestones,
              terminalContext: future.terminalContext,
              finalState: future.finalState,
              reason: future.reason,
            };
          }
        }
      }
      const terminal = terminalEval();
      return {
        sequence,
        score: terminal.score,
        baseScore: terminal.baseScore,
        milestoneScore: terminal.milestoneScore,
        milestones: terminal.milestones,
        terminalContext: terminal.context,
        finalState: currentState,
        reason: "no_candidates",
      };
    }

    candidates = candidates
      .slice()
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, Math.max(1, candidateLimit));

    const effectiveBeamWidth = Math.max(1, Math.min(beamWidth, candidates.length));
    const branches = [];

    for (const action of candidates.slice(0, effectiveBeamWidth)) {
      if (nodesEvaluated >= nodeBudget) break;
      const nextState = clonePlanningState(currentState, strategy);
      const beforeHash = getPlanningStateHash(nextState);
      simulatePlanningAction(nextState, action, strategy);
      nodesEvaluated += 1;
      const afterHash = getPlanningStateHash(nextState);

      if (beforeHash === afterHash || seenStates.has(afterHash)) {
        continue;
      }
      seenStates.add(afterHash);

      const future = await search(nextState, depth + 1, [...sequence, action]);
      branches.push({
        action,
        sequence: future.sequence,
        score: future.score,
        baseScore: future.baseScore,
        milestoneScore: future.milestoneScore,
        milestones: future.milestones,
        terminalContext: future.terminalContext,
        finalState: future.finalState,
        reason: future.reason,
      });
    }

    if (nodesEvaluated < nodeBudget) {
      const bridge = tryMainBattleMain2Bridge(
        currentState,
        sequence,
        strategy,
        options,
      );
      if (bridge) {
        nodesEvaluated += 1;
        const bridgeHash = getPlanningStateHash(bridge.state);
        if (!seenStates.has(bridgeHash)) {
          seenStates.add(bridgeHash);
          const future = await search(bridge.state, depth + 1, [
            ...sequence,
            bridge.action,
          ]);
          branches.push({
            action: bridge.action,
            sequence: future.sequence,
            score: future.score,
            baseScore: future.baseScore,
            milestoneScore: future.milestoneScore,
            milestones: future.milestones,
            terminalContext: future.terminalContext,
            finalState: future.finalState,
            reason: future.reason,
          });
        }
      }
    }

    if (branches.length === 0) {
      const terminal = terminalEval();
      return {
        sequence,
        score: terminal.score,
        baseScore: terminal.baseScore,
        milestoneScore: terminal.milestoneScore,
        milestones: terminal.milestones,
        terminalContext: terminal.context,
        finalState: currentState,
        reason: "no_state_changing_branches",
      };
    }

    branches.sort((a, b) => b.score - a.score);
    return branches[0];
  };

  const result = await search(root, 0, []);
  if (!result?.sequence?.length) return null;
  const firstStepState = clonePlanningState(root, strategy);
  simulatePlanningAction(firstStepState, result.sequence[0], strategy);
  const diagnostics = {
    rootSummary: summarizePlanningState(root, { strategy }),
    firstStepSummary: summarizePlanningState(firstStepState, { strategy }),
    terminalSummary: summarizePlanningState(result.finalState, { strategy }),
    sequenceFingerprints: result.sequence.map(fingerprintAction),
  };
  const describeContext = {
    initialState: root,
    finalState: result.finalState,
    sequence: result.sequence,
    score: result.score,
    baseScore: result.baseScore,
    milestoneScore: result.milestoneScore,
    milestones: result.milestones || [],
    reason: result.reason,
    options,
    profile: options.profile,
    planningContext: options.planningContext,
  };
  const described =
    typeof strategy?.describePlannedLine === "function"
      ? strategy.describePlannedLine(describeContext)
      : "";

  return {
    action: result.sequence[0],
    score: result.score,
    baseScore: result.baseScore,
    milestoneScore: result.milestoneScore,
    sequence: result.sequence,
    finalState: result.finalState,
    nodesEvaluated,
    milestones: result.milestones || [],
    diagnostics,
    reason:
      described ||
      result.reason ||
      result.sequence.map((action) => describeAction(action)).join(" -> "),
    used: true,
  };
}
