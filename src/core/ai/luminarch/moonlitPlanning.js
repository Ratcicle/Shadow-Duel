// Moonlit Blessing target and revive planning.

import { getVisibleAtk, getVisibleDef } from "../common/cardStats.js";
import { isLuminarch } from "./knowledge.js";
import {
  getBattleStatToAttack,
  getBestTemporaryCombatDebuffTarget,
  getThreatAtk,
  isDefensiveLuminarch,
} from "./priorityShared.js";

function getSelfLuminarchTargetIds(effect) {
  return new Set(
    (effect?.targets || [])
      .filter(
        (target) =>
          target &&
          target.owner === "self" &&
          target.zone === "field" &&
          target.cardKind === "monster" &&
          (!target.archetype || target.archetype === "Luminarch")
      )
      .map((target) => target.id)
      .filter(Boolean)
  );
}

function getStatBuffOptionsFromEffect(source, effect, sourceZone) {
  const targetIds = getSelfLuminarchTargetIds(effect);
  if (targetIds.size === 0) return [];

  const lpCost = (effect.actions || []).reduce(
    (sum, action) =>
      action?.type === "pay_lp" ? sum + (action.amount || 0) : sum,
    0
  );
  const options = [];
  (effect.actions || []).forEach((action) => {
    if (action.type === "pay_lp") return;

    if (!targetIds.has(action.targetRef)) return;
    if (action.type === "buff_stats_temp") {
      options.push({
        sourceName: source?.name || effect.id || "stat buff",
        sourceZone,
        atkBoost: action.atkBoost || 0,
        defBoost: action.defBoost || 0,
        lpCost,
      });
    }
    if (action.type === "equip") {
      options.push({
        sourceName: source?.name || effect.id || "equip",
        sourceZone,
        atkBoost: action.atkBonus || 0,
        defBoost: action.defBonus || 0,
        lpCost,
      });
    }
  });

  return options.filter((option) => option.atkBoost > 0 || option.defBoost > 0);
}

function getMoonlitBuffOptions(analysis) {
  const options = [];
  const fieldSpell = analysis.fieldSpell || null;
  const fieldEffect = (fieldSpell?.effects || []).find(
    (effect) => effect && effect.timing === "on_field_activate"
  );
  if (fieldSpell?.name?.includes("Citadel") && fieldEffect) {
    options.push(...getStatBuffOptionsFromEffect(fieldSpell, fieldEffect, "fieldSpell"));
  }

  (analysis.hand || [])
    .filter(
      (card) =>
        card &&
        card.cardKind === "spell" &&
        card.name !== "Luminarch Moonlit Blessing"
    )
    .forEach((card) => {
      (card.effects || [])
        .filter((effect) => effect && effect.timing === "on_play")
        .forEach((effect) => {
          options.push(...getStatBuffOptionsFromEffect(card, effect, "hand"));
        });
    });

  return options;
}

function chooseBestBuffPackage(options, lp, purpose) {
  const usable = (options || []).filter((option) => (option.lpCost || 0) <= lp);
  const limit = Math.min(usable.length, 8);
  let best = {
    atkBoost: 0,
    defBoost: 0,
    lpCost: 0,
    sources: [],
  };

  for (let mask = 1; mask < 1 << limit; mask += 1) {
    const selected = [];
    let atkBoost = 0;
    let defBoost = 0;
    let lpCost = 0;
    for (let i = 0; i < limit; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      const option = usable[i];
      selected.push(option);
      atkBoost += option.atkBoost || 0;
      defBoost += option.defBoost || 0;
      lpCost += option.lpCost || 0;
    }
    if (lpCost > lp) continue;

    const score =
      purpose === "defense"
        ? defBoost * 1.2 + atkBoost * 0.25
        : atkBoost * 1.2 + defBoost * 0.25;
    const bestScore =
      purpose === "defense"
        ? best.defBoost * 1.2 + best.atkBoost * 0.25
        : best.atkBoost * 1.2 + best.defBoost * 0.25;
    if (score > bestScore || (score === bestScore && lpCost < best.lpCost)) {
      best = {
        atkBoost,
        defBoost,
        lpCost,
        sources: selected.map((option) => option.sourceName),
      };
    }
  }

  return best;
}

function getBestAttackLine(projectedAtk, oppMonsters) {
  return (oppMonsters || [])
    .map((card) => ({
      card,
      stat: getBattleStatToAttack(card),
      atk: getThreatAtk(card),
    }))
    .filter((entry) => projectedAtk > entry.stat)
    .sort((a, b) => b.stat - a.stat)[0] || null;
}

export function evaluateMoonlitReviveCandidate(card, analysis = {}) {
  if (!card || card.cardKind !== "monster") {
    return { target: card, score: -100, purpose: "none", position: "attack" };
  }

  const oppMonsters = (analysis.oppField || []).filter(
    (entry) => entry && entry.cardKind === "monster"
  );
  const oppStrongestBattleStat = oppMonsters.reduce(
    (max, monster) => Math.max(max, getBattleStatToAttack(monster)),
    0
  );
  const oppStrongestAtk = oppMonsters.reduce(
    (max, monster) => Math.max(max, getThreatAtk(monster)),
    0
  );
  const oppTotalAtk = oppMonsters.reduce(
    (sum, monster) => sum + getThreatAtk(monster),
    0
  );
  const hasTank = (analysis.field || []).some(
    (entry) =>
      entry &&
      entry.cardKind === "monster" &&
      !entry.isFacedown &&
      isLuminarch(entry) &&
      (isDefensiveLuminarch(entry) || getVisibleDef(entry) >= oppStrongestAtk)
  );
  const pressure =
    (analysis.lp || 8000) <= 3500 ||
    oppTotalAtk >= (analysis.lp || 8000) ||
    (oppStrongestAtk >= 2200 && !hasTank);

  const buffOptions = getMoonlitBuffOptions(analysis);
  const attackBuff = chooseBestBuffPackage(buffOptions, analysis.lp || 0, "attack");
  const defenseBuff = chooseBestBuffPackage(buffOptions, analysis.lp || 0, "defense");
  const atk = getVisibleAtk(card);
  const def = getVisibleDef(card);
  const projectedAtk = atk + attackBuff.atkBoost;
  const projectedDef = def + defenseBuff.defBoost;
  const attackLine = getBestAttackLine(projectedAtk, oppMonsters);
  const canAttackOverAll =
    oppStrongestBattleStat === 0 || projectedAtk > oppStrongestBattleStat;
  const canCounterattack = !!attackLine && (canAttackOverAll || projectedAtk > atk);
  const blocksBestThreat = projectedDef >= oppStrongestAtk;
  const defensive = isDefensiveLuminarch(card);

  let purpose = pressure ? "stabilize" : "value";
  let position = atk >= def ? "attack" : "defense";
  let score = (card.level || 0) * 0.2 + Math.max(atk, def) / 1000;

  if (canCounterattack) {
    purpose = pressure ? "counterattack" : "pressure";
    position = "attack";
    score += projectedAtk / 450;
    score += (attackLine?.stat || 0) / 350;
    if (canAttackOverAll) score += 3;
    if (pressure) score += 3;
    if (attackBuff.sources.length > 0) score += 1;
  } else if (pressure) {
    purpose = "stabilize";
    position = "defense";
    score += projectedDef / 450;
    if (defensive) score += 4;
    if (blocksBestThreat) score += 2;
    if (!blocksBestThreat && !defensive) score -= 2;
  } else {
    const bestDebuffTarget = getBestTemporaryCombatDebuffTarget({
      ...analysis,
      field: [...(analysis.field || []), card],
    });
    const wantsPressure =
      (analysis.oppLp || 8000) <= 3000 || bestDebuffTarget.score > 0;
    if (wantsPressure && atk >= 1600) {
      purpose = "pressure";
      position = "attack";
      score += atk / 450;
      if (atk >= 2000 || card.piercing) score += 2;
    } else if (defensive) {
      position = "defense";
      score += 1.2;
    }
  }

  return {
    target: card,
    score,
    purpose,
    position,
    projectedAtk,
    projectedDef,
    attackBuffSources: attackBuff.sources,
    defenseBuffSources: defenseBuff.sources,
    attackLine,
    pressure,
    canCounterattack,
    blocksBestThreat,
    reason: canCounterattack
      ? `counterattack ${attackLine.card.name} with ${projectedAtk} ATK`
      : blocksBestThreat
        ? `stabilize with ${projectedDef} DEF`
        : `${purpose} in ${position}`,
  };
}

export function getMoonlitTargetPlan(analysis) {
  const gyMonsters = (analysis.graveyard || []).filter(
    (card) => card && card.cardKind === "monster" && isLuminarch(card)
  );
  if (gyMonsters.length === 0) {
    return { target: null, score: 0, purpose: "none", position: "attack" };
  }

  const candidatePlans = gyMonsters.map((card) =>
    evaluateMoonlitReviveCandidate(card, analysis)
  );
  const bestPlan = candidatePlans.sort((a, b) => b.score - a.score)[0];
  return {
    ...bestPlan,
    candidatePlans,
  };
}
