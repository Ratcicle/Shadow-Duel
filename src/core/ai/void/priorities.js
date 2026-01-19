import { getVoidCardKnowledge, isVoid } from "./knowledge.js";

export function shouldPlayVoidSpell(card, game, bot, opponent) {
  if (!card || card.cardKind !== "spell") return { yes: false, priority: 0 };
  const knowledge = getVoidCardKnowledge(card);
  const oppFieldCount = opponent?.field?.length || 0;
  const myFieldCount = bot?.field?.length || 0;
  const myLp = bot?.lp || 0;
  const oppLp = opponent?.lp || 0;

  if (card.subtype === "field") {
    const shouldRevive =
      myFieldCount === 0 && (bot?.graveyard || []).some(isVoid);
    const priority = shouldRevive ? 8 : 5;
    return { yes: true, priority };
  }

  if (knowledge?.role === "board_clear") {
    const shouldReset = oppFieldCount > myFieldCount && oppFieldCount >= 2;
    return { yes: shouldReset, priority: shouldReset ? 7.5 : 0 };
  }

  if (knowledge?.role === "tempo") {
    const shouldTempo = oppFieldCount > 0 && myFieldCount > 0;
    return { yes: shouldTempo, priority: shouldTempo ? 6 : 0 };
  }

  if (knowledge?.role === "field_spell") {
    const shouldUse = myFieldCount === 0 && myLp > 0 && oppLp > 0;
    return { yes: shouldUse, priority: shouldUse ? 7 : 0 };
  }

  return { yes: true, priority: 4 };
}

export function shouldSummonVoidMonster(card, game, bot, opponent) {
  if (!card || card.cardKind !== "monster") return { yes: false, priority: 0 };
  const knowledge = getVoidCardKnowledge(card);
  const oppFieldCount = opponent?.field?.length || 0;
  const atk = card.atk || 0;
  const def = card.def || 0;
  let priority = atk / 600;

  if (knowledge?.role === "boss") priority += 2.0;
  if (knowledge?.tags?.includes("swarm")) priority += 1.4;
  if (knowledge?.tags?.includes("direct"))
    priority += oppFieldCount === 0 ? 1.2 : 0.4;
  if (knowledge?.role === "control") priority += 0.8;
  if (def > atk + 300) priority -= 0.4;

  return { yes: true, priority };
}

export function chooseVoidSummonPosition(card, opponent) {
  const oppField = opponent?.field || [];
  const oppStrongest = oppField.reduce((max, monster) => {
    if (!monster || monster.cardKind !== "monster") return max;
    const atk = monster.isFacedown ? 1500 : monster.atk || 0;
    return Math.max(max, atk);
  }, 0);

  const atk = card.atk || 0;
  const def = card.def || 0;
  if (oppStrongest <= 0) return "attack";
  if (atk >= oppStrongest + 200) return "attack";
  if (def >= oppStrongest + 200) return "defense";
  if (atk >= oppStrongest) return "attack";
  return atk >= def ? "attack" : "defense";
}

export function evaluateVoidFusionPriority(bot) {
  const field = bot?.field || [];
  const hand = bot?.hand || [];
  const voids = [...field, ...hand].filter(isVoid);
  const hollows = voids.filter((card) => card?.id === 154);
  const slayerField = field.some((card) => card?.id === 162);
  const otherVoidCount = voids.filter((card) => card?.id !== 162).length;

  const hydraReady = voids.length >= 6;
  if (hydraReady) {
    return { priority: 12, target: "Void Hydra Titan" };
  }

  const berserkerReady = slayerField && otherVoidCount >= 1;
  if (berserkerReady) {
    return { priority: 10.5, target: "Void Berserker" };
  }

  const hollowKingReady = hollows.length >= 3;
  if (hollowKingReady) {
    return { priority: 9.5, target: "Void Hollow King" };
  }

  return { priority: 0, target: null };
}
