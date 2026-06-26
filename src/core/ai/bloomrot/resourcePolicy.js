import { BLOOMROT_NAMES, getSporeCount } from "./analysis.js";

const N = {
  ROT_STAG: "Bloomrot Rot-Stag",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  SPORE_CLOUD: "Bloomrot Spore Cloud",
  MYCO_WEAVER: "Bloomrot Myco-Weaver",
  SPORELING: "Bloomrot Sporeling",
};

const RECOVERY_VALUES = new Map([
  [BLOOMROT_NAMES.HARVEST, 36],
  [BLOOMROT_NAMES.LIVING_COLONY, 32],
  [N.SPORE_CLOUD, 26],
  [N.GRAVECAP_WIDOW, 24],
  [N.MYCO_WEAVER, 21],
  [N.SPORELING, 16],
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function fieldCounterCards(analysis = {}) {
  return [
    ...asArray(analysis.field),
    ...asArray(analysis.spellTrap),
    analysis.fieldSpell,
    ...asArray(analysis.oppField),
    ...asArray(analysis.oppSpellTrap),
    analysis.oppFieldSpell,
  ].filter(Boolean);
}

function opponentCards(analysis = {}) {
  return [
    ...asArray(analysis.oppField),
    ...asArray(analysis.oppSpellTrap),
    analysis.oppFieldSpell,
  ].filter(Boolean);
}

function faceUp(card) {
  return card && card.isFacedown !== true;
}

function effectiveAtk(card) {
  return (
    Number(card?.atk || 0) +
    Number(card?.tempAtkBoost || 0) +
    Number(card?.equipAtkBonus || 0)
  );
}

function effectiveDef(card) {
  return (
    Number(card?.def || 0) +
    Number(card?.tempDefBoost || 0) +
    Number(card?.equipDefBonus || 0)
  );
}

function battleValue(card) {
  if (!card) return 0;
  if (card.cardKind === "monster") {
    const statValue = Math.max(effectiveAtk(card), effectiveDef(card)) / 100;
    return statValue + Number(card.level || 0);
  }
  let value = 10;
  if (card.subtype === "field") value += 34;
  if (card.subtype === "continuous") value += 24;
  if (card.subtype === "equip") value += 10;
  if (faceUp(card)) value += 4;
  return value;
}

function isRelevantHarvestTarget(card) {
  if (!card) return false;
  if (card.cardKind === "monster") {
    return (
      Number(card.level || 0) >= 7 ||
      Math.max(effectiveAtk(card), effectiveDef(card)) >= 2200 ||
      getSporeCount(card) >= 4
    );
  }
  return card.subtype === "field" || card.subtype === "continuous";
}

function hasQueenMaterial(analysis = {}) {
  return asArray(analysis.faceUpBloomrotField).some(
    (card) => card?.cardKind === "monster" && Number(card.level || 0) >= 5,
  );
}

function protectedCounterCards(analysis = {}) {
  const protectedCards = new Set();
  const opponentMonsters = asArray(analysis.opponentMonsters);

  if (analysis.hasRootNetworkActive) {
    for (const card of opponentMonsters) {
      if (faceUp(card) && getSporeCount(card) >= 5) protectedCards.add(card);
    }
  }

  if (analysis.hasRottingGroundActive) {
    for (const card of opponentMonsters) {
      if (faceUp(card) && getSporeCount(card) >= 4) protectedCards.add(card);
    }
  }

  return [...protectedCards];
}

export function getBloomrotCounterSpendSummary(analysis = {}) {
  const totalSporeCount =
    Number(analysis.fieldSporeTotal) ||
    fieldCounterCards(analysis).reduce((sum, card) => sum + getSporeCount(card), 0);
  const protectedCards = protectedCounterCards(analysis);
  const protectedSporeCount = protectedCards.reduce(
    (sum, card) => sum + getSporeCount(card),
    0,
  );
  const queenReady =
    analysis.hasQueenInExtra === true &&
    totalSporeCount >= 8 &&
    hasQueenMaterial(analysis);

  return {
    totalSporeCount,
    protectedCards,
    protectedSporeCount,
    freeSporeCount: Math.max(0, totalSporeCount - protectedSporeCount),
    queenReady,
  };
}

function canPayWithoutProtectedCounters(analysis, amount) {
  const summary = getBloomrotCounterSpendSummary(analysis);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, summary };
  if (summary.totalSporeCount < amount) return { ok: false, summary };
  return {
    ok: summary.freeSporeCount >= amount,
    summary,
  };
}

function queenReserveAllows(summary, amount, purpose) {
  if (!summary.queenReady) return true;
  if (["harvest", "widow_removal", "ancient_mycelium_removal"].includes(purpose)) {
    return true;
  }
  return summary.totalSporeCount - amount >= 8;
}

function opponentFaceUpTargets(analysis = {}) {
  return opponentCards(analysis).filter(faceUp);
}

function opponentFaceUpMonsters(analysis = {}) {
  return asArray(analysis.opponentMonsters).filter(faceUp);
}

function bestHarvestTarget(analysis = {}) {
  return opponentCards(analysis)
    .map((card) => ({ card, score: battleValue(card) }))
    .sort((a, b) => b.score - a.score)[0]?.card || null;
}

function bestInfectedMonster(analysis = {}) {
  return asArray(analysis.opponentSporedMonsters)
    .filter(faceUp)
    .map((card) => ({ card, score: battleValue(card) + getSporeCount(card) * 3 }))
    .sort((a, b) => b.score - a.score)[0]?.card || null;
}

function canWidowLeaveValidTarget(analysis = {}, amount) {
  const total = getBloomrotCounterSpendSummary(analysis).totalSporeCount;
  return asArray(analysis.opponentSporedMonsters).some((card) => {
    const spores = getSporeCount(card);
    if (spores <= 0 || !faceUp(card)) return false;
    const outsideCounters = total - spores;
    return outsideCounters >= amount || spores > amount;
  });
}

function bestRecoveryValue(analysis = {}) {
  return asArray(analysis.bloomrotGraveyard).reduce((best, card) => {
    const value = RECOVERY_VALUES.get(card?.name) || 0;
    return value > best.value ? { card, value } : best;
  }, { card: null, value: 0 });
}

function allow(reason, priorityBonus = 0) {
  return { allow: true, priorityBonus, reason };
}

function block(reason, priorityBonus = 0) {
  return { allow: false, priorityBonus, reason };
}

function evaluateFixedSpend({ purpose, amount, analysis }) {
  const payment = canPayWithoutProtectedCounters(analysis, amount);
  if (!payment.ok) {
    return block("not enough safe Spore Counters to spend");
  }
  if (!queenReserveAllows(payment.summary, amount, purpose)) {
    return block("preserve 8 Spore Counters for Queen");
  }
  return allow("safe Spore Counter spend");
}

function evaluateRotStag(amount, analysis = {}) {
  const base = evaluateFixedSpend({
    purpose: "rot_stag_body",
    amount,
    analysis,
  });
  if (!base.allow) return base;
  if (opponentFaceUpTargets(analysis).length === 0) {
    return block("Rot-Stag has no useful Spore Counter target");
  }
  if (analysis.hasLivingColonyActive && (analysis.freeMonsterZones || 0) > 0) {
    return allow("Rot-Stag spend creates pressure with Living Colony", 1.2);
  }
  if ((analysis.faceUpBloomrotField || []).length === 0) {
    return allow("Rot-Stag rebuilds an empty Bloomrot field", 0.5);
  }
  if (base.priorityBonus >= 0 && getBloomrotCounterSpendSummary(analysis).freeSporeCount >= 4) {
    return allow("Rot-Stag uses spare Spore Counters", 0.2);
  }
  return block("avoid spending spores only to add a body");
}

function evaluateAncientHusk(amount, analysis = {}) {
  const base = evaluateFixedSpend({
    purpose: "ancient_husk_body",
    amount,
    analysis,
  });
  if (!base.allow) return base;
  const targets = opponentFaceUpMonsters(analysis).length;
  if (targets < 2) return block("Ancient Husk wants multiple spore targets");
  if (analysis.hasLivingColonyActive) {
    return allow("Ancient Husk spend is backed by Living Colony", 0.8);
  }
  if (getBloomrotCounterSpendSummary(analysis).freeSporeCount >= amount + 2) {
    return allow("Ancient Husk uses surplus Spore Counters", 0.3);
  }
  return block("avoid spending spores only to add Ancient Husk");
}

function evaluateWidow(amount, analysis = {}) {
  const base = evaluateFixedSpend({
    purpose: "widow_removal",
    amount,
    analysis,
  });
  if (!base.allow) return base;
  if (!canWidowLeaveValidTarget(analysis, amount)) {
    return block("Widow payment may remove the last infected target");
  }
  const target = bestInfectedMonster(analysis);
  if (!target) return block("Widow has no infected monster to destroy");
  const value = battleValue(target);
  if (value < 18) return block("Widow target is too low impact");
  return allow("Widow converts spores into removal", value >= 30 ? 2 : 1);
}

function evaluateRootNetwork(amount, analysis = {}) {
  const base = evaluateFixedSpend({
    purpose: "root_network_recover",
    amount,
    analysis,
  });
  if (!base.allow) return base;
  const recovery = bestRecoveryValue(analysis);
  if (recovery.value <= 0) return block("Root Network has no valuable recovery");
  if (recovery.value < 21) return block("Root Network recovery is not worth spores");
  return allow(`Root Network recovers ${recovery.card?.name || "a Bloomrot card"}`, recovery.value / 20);
}

function evaluateAncientMycelium(amount, analysis = {}) {
  const base = evaluateFixedSpend({
    purpose: "ancient_mycelium_removal",
    amount,
    analysis,
  });
  if (!base.allow) return base;
  const defenseTargets = opponentFaceUpMonsters(analysis).filter(
    (card) => card.position === "defense",
  );
  if (defenseTargets.length === 0) {
    return block("Ancient Mycelium has no Defense Position target");
  }
  const best = defenseTargets
    .map((card) => ({ card, score: battleValue(card) }))
    .sort((a, b) => b.score - a.score)[0];
  if ((best?.score || 0) < 16) return block("Ancient Mycelium target is too low impact");
  return allow("Ancient Mycelium converts spores into removal", 1.1);
}

function evaluateHarvest(analysis = {}) {
  const summary = getBloomrotCounterSpendSummary(analysis);
  const destroyCount = Math.floor(summary.totalSporeCount / 4);
  if (destroyCount <= 0) return block("Harvest needs at least 4 Spore Counters");
  const target = bestHarvestTarget(analysis);
  if (!target) return block("Harvest has no opponent card to destroy");
  if (!isRelevantHarvestTarget(target) && destroyCount < 2) {
    return block("Harvest target is not worth cashing in spores");
  }
  if (summary.queenReady && !isRelevantHarvestTarget(target)) {
    return block("preserve Queen setup over low-impact Harvest");
  }
  const priorityBonus = Math.min(3, destroyCount) + (isRelevantHarvestTarget(target) ? 1 : 0);
  return allow("Harvest cashes in spores for relevant removal", priorityBonus);
}

function evaluateQueenHeal(amount, analysis = {}) {
  const base = evaluateFixedSpend({
    purpose: "queen_heal",
    amount,
    analysis,
  });
  if (!base.allow) return base;
  const lp = Number(analysis.lp || analysis.selfLp || analysis.selfLP || 8000);
  if (lp > 3500) return block("Queen heal is not urgent");
  return allow("Queen heal stabilizes low LP", 1);
}

export function evaluateBloomrotCounterSpend({
  purpose,
  amount = 0,
  analysis = {},
  sourceCard = null,
} = {}) {
  const resolvedPurpose = purpose || sourceCard?.name || "generic";

  switch (resolvedPurpose) {
    case "rot_stag_body":
    case N.ROT_STAG:
      return evaluateRotStag(amount || 2, analysis);
    case "widow_removal":
    case N.GRAVECAP_WIDOW:
      return evaluateWidow(amount || 2, analysis);
    case "ancient_husk_body":
    case N.ANCIENT_HUSK:
      return evaluateAncientHusk(amount || 4, analysis);
    case "root_network_recover":
    case BLOOMROT_NAMES.ROOT_NETWORK:
      return evaluateRootNetwork(amount || 3, analysis);
    case "ancient_mycelium_removal":
    case BLOOMROT_NAMES.ANCIENT_MYCELIUM:
      return evaluateAncientMycelium(amount || 2, analysis);
    case "harvest":
    case BLOOMROT_NAMES.HARVEST:
      return evaluateHarvest(analysis);
    case "queen_heal":
    case BLOOMROT_NAMES.QUEEN:
      return evaluateQueenHeal(amount || 1, analysis);
    default:
      return evaluateFixedSpend({
        purpose: resolvedPurpose,
        amount,
        analysis,
      });
  }
}
