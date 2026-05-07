import {
  evaluateTributeSummonCost,
  getTributeRequirementFor,
  selectBestTributes,
} from "../common/tributePolicy.js";
import { getEffectiveAtk, getEffectiveDef } from "../common/cardStats.js";
import { evaluateCardExpendability } from "./cardValue.js";
import { isLuminarch } from "./knowledge.js";

export const LUMINARCH_DEFENSIVE_NAMES = [
  "Luminarch Aegisbearer",
  "Luminarch Sanctum Protector",
  "Luminarch Fortress Aegis",
  "Luminarch Megashield Barbarias",
];

export const LUMINARCH_OFFENSIVE_NAMES = [
  "Luminarch Valiant - Knight of the Dawn",
  "Luminarch Moonblade Captain",
  "Luminarch Celestial Marshal",
  "Luminarch Radiant Lancer",
  "Luminarch Aurora Seraph",
  "Luminarch Megashield Barbarias",
];

export function isRadiantLancer(card) {
  return card?.name === "Luminarch Radiant Lancer";
}

export function spendsAegisbearerProtectorCore(cards) {
  const names = new Set((cards || []).map((card) => card?.name).filter(Boolean));
  return (
    names.has("Luminarch Aegisbearer") &&
    names.has("Luminarch Sanctum Protector")
  );
}

export function getLuminarchTributeRequirementFor(card, playerState) {
  return getTributeRequirementFor(card, playerState);
}

function getLuminarchBoardValue(card, context = {}) {
  if (!card || card.cardKind !== "monster") return 0;
  const expendability = evaluateCardExpendability(card, context);
  let value = Math.max(getEffectiveAtk(card), getEffectiveDef(card)) / 1000;
  value += (card.level || 0) * 0.12;
  value += (expendability.value ?? 5) * 0.4;
  if (!expendability.expendable) value += 1;
  if (card.mustBeAttacked) value += 1.2;
  if (card.battleIndestructibleOncePerTurn) value += 1.2;
  if (
    (card.effects || []).some(
      (effect) =>
        effect?.timing === "passive" &&
        effect.replacementEffect?.type === "destruction",
    )
  ) {
    value += 2;
  }
  if (
    (card.effects || []).some(
      (effect) =>
        effect?.event === "battle_destroy" &&
        (effect.actions || []).some((action) => action.type === "heal_from_destroyed_atk"),
    )
  ) {
    value += 1;
  }
  return value;
}

function isHighValueLuminarchTribute(card, context = {}) {
  if (!card || card.cardKind !== "monster") return false;
  const expendability = evaluateCardExpendability(card, context);
  if (expendability.expendable) return false;
  if (card.name === "Luminarch Aurora Seraph") return true;
  if (LUMINARCH_DEFENSIVE_NAMES.includes(card.name)) return true;
  if (card.name === "Luminarch Radiant Lancer" && getEffectiveAtk(card) > 2600) {
    return true;
  }
  return (
    (card.level || 0) >= 7 &&
    Math.max(getEffectiveAtk(card), getEffectiveDef(card)) >= 2400 &&
    (expendability.value ?? 0) >= 8
  );
}

function getBestMoonbladeReviveTarget(bot) {
  return (bot?.graveyard || [])
    .filter(
      (card) =>
        card &&
        card.cardKind === "monster" &&
        isLuminarch(card) &&
        (card.level || 0) <= 4,
    )
    .map((card) => ({
      card,
      value: getLuminarchBoardValue(card, {
        field: bot?.field || [],
        graveyard: bot?.graveyard || [],
        hand: bot?.hand || [],
        spellTrap: bot?.spellTrap || [],
        fieldSpell: bot?.fieldSpell || null,
        usedEffects: bot?.usedEffects || [],
      }),
    }))
    .sort((a, b) => b.value - a.value)[0]?.card || null;
}

function evaluateLuminarchTributeSummonPayoff(cardToSummon, tributes, context) {
  const bot = context.bot || {};
  const opponent = context.opponent || {};
  const summonAtk = getEffectiveAtk(cardToSummon);
  const summonDef = getEffectiveDef(cardToSummon);
  const tributeAtk = Math.max(0, ...tributes.map((card) => getEffectiveAtk(card)));
  const tributeStat = Math.max(
    0,
    ...tributes.map((card) => Math.max(getEffectiveAtk(card), getEffectiveDef(card))),
  );
  const opponentMonsters = (opponent.field || []).filter(
    (card) => card && card.cardKind === "monster",
  );
  const strongestBattleStat = opponentMonsters.reduce((max, monster) => {
    const stat = monster.isFacedown
      ? 1500
      : monster.position === "defense"
        ? getEffectiveDef(monster)
        : getEffectiveAtk(monster);
    return Math.max(max, stat);
  }, 0);
  const opponentTotalAtk = opponentMonsters.reduce(
    (sum, monster) => sum + (monster.isFacedown ? 1500 : getEffectiveAtk(monster)),
    0,
  );

  if (
    isRadiantLancer(cardToSummon) &&
    context.shouldSummon?.lancerPlan?.hasLine &&
    context.shouldSummon?.lancerPlan?.improvesThreatMatchup
  ) {
    return { ok: true, reason: "Radiant Lancer has immediate snowball payoff" };
  }

  if (opponentMonsters.length === 0) {
    const remainingAtk = (bot.field || [])
      .filter((card) => card && !tributes.includes(card))
      .reduce((sum, card) => sum + (card.position === "attack" ? getEffectiveAtk(card) : 0), 0);
    if (remainingAtk + summonAtk >= (opponent.lp || 8000)) {
      return { ok: true, reason: "tribute summon creates lethal pressure" };
    }
  }

  if (strongestBattleStat > 0 && summonAtk > strongestBattleStat && tributeAtk <= strongestBattleStat) {
    return { ok: true, reason: "summoned monster clears a threat tributes could not clear" };
  }

  if ((cardToSummon.level || 0) >= 7 && Math.max(summonAtk, summonDef) >= tributeStat + 500) {
    return { ok: true, reason: "tribute summon upgrades into a stronger boss" };
  }

  if (cardToSummon.name === "Luminarch Moonblade Captain") {
    const reviveTarget = getBestMoonbladeReviveTarget(bot);
    const remainingField = (bot.field || []).filter((card) => card && !tributes.includes(card));
    const hasStableDefense = remainingField.some(
      (card) =>
        card &&
        !card.isFacedown &&
        (LUMINARCH_DEFENSIVE_NAMES.includes(card.name) ||
          getEffectiveDef(card) >= Math.max(1800, strongestBattleStat)),
    );
    const reviveStabilizes =
      reviveTarget &&
      (reviveTarget.mustBeAttacked ||
        getEffectiveDef(reviveTarget) >= Math.max(1800, strongestBattleStat));

    if (
      opponentTotalAtk >= (bot.lp || 8000) &&
      !hasStableDefense &&
      reviveStabilizes
    ) {
      return {
        ok: true,
        reason: `Moonblade revive ${reviveTarget.name} prevents lethal pressure`,
      };
    }
  }

  return { ok: false, reason: "no immediate tactical payoff" };
}

function evaluateLuminarchTributeKeepScore(card, evaluationContext, context) {
  const oppField = Array.isArray(context.oppField) ? context.oppField : [];
  const oppStrongest = oppField.reduce((max, monster) => {
    if (!monster || monster.cardKind !== "monster") return max;
    return Math.max(max, monster.atk || 0);
  }, 0);

  const atk = (card.atk || 0) + (card.tempAtkBoost || 0);
  const def = (card.def || 0) + (card.tempDefBoost || 0);
  const hiddenDef = card.isFacedown ? 1500 : 0;
  const combatStat = Math.max(atk, def, hiddenDef);

  const expendability = evaluateCardExpendability(card, evaluationContext);

  let keepScore = combatStat / 1000;
  keepScore += (card.level || 0) * 0.12;
  keepScore += (expendability.value ?? 5) * 0.4;
  if (!expendability.expendable) keepScore += 1.0;
  if (card.mustBeAttacked) keepScore += 1.2;

  const solidDefender =
    card.position === "defense" &&
    def >= Math.max(1800, oppStrongest - 200);
  if (solidDefender) keepScore += 0.6;

  if (card.isFacedown) keepScore -= 0.5;

  return keepScore;
}

const LUMINARCH_TRIBUTE_POLICY = {
  evaluateCardValue: evaluateLuminarchTributeKeepScore,
  isProtectedTribute: isHighValueLuminarchTribute,
  evaluateSummonPayoff: evaluateLuminarchTributeSummonPayoff,
};

function buildLuminarchEvaluationContext(botState = {}, field = []) {
  return {
    field: field || [],
    graveyard: botState.graveyard || [],
    hand: botState.hand || [],
    spellTrap: botState.spellTrap || [],
    fieldSpell: botState.fieldSpell || null,
    usedEffects: botState.usedEffects || [],
  };
}

export function selectBestLuminarchTributes(
  field,
  tributesNeeded,
  cardToSummon,
  context = {},
) {
  const botState = context.botState || {};
  return selectBestTributes(
    field,
    tributesNeeded,
    cardToSummon,
    {
      ...context,
      evaluationContext: buildLuminarchEvaluationContext(botState, field),
    },
    LUMINARCH_TRIBUTE_POLICY,
  );
}

export function evaluateLuminarchTributeSummonCost(
  cardToSummon,
  tributes,
  context = {},
) {
  const bot = context.bot || {};
  return evaluateTributeSummonCost(
    cardToSummon,
    tributes,
    {
      ...context,
      evaluationContext: buildLuminarchEvaluationContext(bot, bot.field || []),
    },
    LUMINARCH_TRIBUTE_POLICY,
  );
}
