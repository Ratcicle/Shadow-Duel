import type { MirageboundAnalysis, MirageboundCard } from "./contracts.js";
import { MB, MIRAGEBOUND, getCardsByNames, getInstanceIds, getOpponentCards, hasName, isMiragebound } from "./knowledge.js";
import { estimateCardValue, estimateMonsterValue } from "../StrategyUtils.js";

export function getRebelPositionEffectBonus(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  if (!analysis.hasRebelOpenZoneTriggerWindow) return 0;
  return analysis.hasRebelPiercingPressure ? 2.4 : 1.4;
}

export function canReUseViperAfterBounce(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  return analysis.availableMonsterZonesAfterBounce > 0;
}

export function buildBounceTargetBuckets(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const faceUpMiragebounds = analysis.faceUpMiragebounds || [];
  const preferred: MirageboundCard[] = [];
  const avoided: MirageboundCard[] = [];

  const addPreferred = (cards: MirageboundCard[]) => {
    preferred.push(...(cards || []));
  };
  const addAvoided = (cards: MirageboundCard[]) => {
    avoided.push(...(cards || []));
  };

  if (analysis.hasViperBouncePayoff && canReUseViperAfterBounce(analysis)) {
    addPreferred(getCardsByNames(faceUpMiragebounds, [MB.GLASS_VIPER]));
  } else if (hasName(faceUpMiragebounds, MB.GLASS_VIPER)) {
    addAvoided(getCardsByNames(faceUpMiragebounds, [MB.GLASS_VIPER]));
  }

  if (analysis.hasPriestessBouncePayoff) {
    addPreferred(getCardsByNames(faceUpMiragebounds, [MB.SAND_PRIESTESS]));
  }

  const dancer = getCardsByNames(faceUpMiragebounds, [MB.DANCER]);
  if (analysis.fieldCapacity > 0 || analysis.hasOasisActive) {
    addPreferred(dancer);
  }

  if (!analysis.preserveScout) {
    addPreferred(getCardsByNames(faceUpMiragebounds, [MB.SCOUT]));
  } else {
    addAvoided(getCardsByNames(faceUpMiragebounds, [MB.SCOUT]));
  }

  addPreferred(getCardsByNames(faceUpMiragebounds, [MB.JACKAL]));

  if (!analysis.canKeepOffenseAfterBounce) {
    addAvoided(getCardsByNames(faceUpMiragebounds, [
      MB.DANCER,
      MB.JACKAL,
      MB.FALSE_KING,
      MB.GLASS_SOVEREIGN,
      MB.DESERT_LEVIATHAN,
      MB.REBEL,
    ]));
  }

  addAvoided(getCardsByNames(faceUpMiragebounds, [MB.FALSE_KING]));
  addAvoided(getCardsByNames(faceUpMiragebounds, [MB.REBEL]));

  return {
    preferred,
    avoided,
    preferredInstanceIds: getInstanceIds(preferred),
    avoidInstanceIds: getInstanceIds(avoided),
  };
}

export function buildBounceNameProfile(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const buckets = buildBounceTargetBuckets(analysis);
  const preferred: string[] = [];
  if (analysis.hasViperBouncePayoff && canReUseViperAfterBounce(analysis)) {
    preferred.push(MB.GLASS_VIPER);
  }
  if (analysis.hasPriestessBouncePayoff) preferred.push(MB.SAND_PRIESTESS);
  preferred.push(MB.DANCER, MB.JACKAL);
  if (!analysis.preserveScout) preferred.push(MB.SCOUT);

  const preserveNames: string[] = analysis.preserveScout ? [MB.SCOUT] : [];
  const avoidNames: string[] = analysis.preserveScout ? [MB.SCOUT] : [];
  if (analysis.hasRebelInField) {
    preserveNames.push(MB.REBEL);
    avoidNames.push(MB.REBEL);
  }

  return {
    preferredNames: [...new Set(preferred)],
    preserveNames: [...new Set(preserveNames)],
    avoidNames: [...new Set(avoidNames)],
    preferredInstanceIds: buckets.preferredInstanceIds,
    avoidInstanceIds: buckets.avoidInstanceIds,
  };
}

export function buildMirageboundCostPreferences(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const bounceProfile = buildBounceNameProfile(analysis);
  return {
    archetype: MIRAGEBOUND,
    preferNames: bounceProfile.preferredNames,
    preserveNames: bounceProfile.preserveNames,
    offensivePayoffNames: [
      MB.FALSE_KING,
      MB.DANCER,
      MB.GLASS_SOVEREIGN,
      MB.DESERT_LEVIATHAN,
      MB.REBEL,
    ],
    preserveLastOffensivePayoff: true,
  };
}

export function shouldPlayMirageboundSpell(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const name = card?.name;
  if (name === MB.OASIS) {
    if (analysis.hasOasisActive) return { yes: false };
    return { yes: true, priority: 13, reason: "establish Oasis engine" };
  }

  if (name === MB.HEAT_HAZE) {
    if (analysis.faceUpMiragebounds.length === 0) return { yes: false };
    if (analysis.opponentMonsters.length === 0) return { yes: false };
    const hasRecursion = analysis.mirageboundGraveyard.length > 0;
    const rebelBonus = getRebelPositionEffectBonus(analysis);
    const priority =
      (hasRecursion ? 8.5 : analysis.hasOasisActive ? 6.5 : 5.5) +
      rebelBonus;
    return {
      yes: true,
      priority,
      reason: analysis.hasRebelOpenZoneTriggerWindow
        ? "shift threat and trigger Rebel extender"
        : hasRecursion
          ? "shift threat and recover Miragebound"
          : "shift threat",
    };
  }

  if (name === MB.VANISHING_STEP) {
    if (analysis.faceUpMiragebounds.length === 0) return { yes: false };
    if (analysis.opponentMonsters.length === 0) return { yes: false };
    const rebelPayoff = analysis.hasRebelVanishingStepWindow;
    if (!analysis.hasMeaningfulBounce && !rebelPayoff) return { yes: false };
    return {
      yes: true,
      priority: analysis.hasMeaningfulBounce ? 9.5 : 7.4,
      reason: rebelPayoff
        ? "bounce to trigger Rebel hand extender"
        : "cash in bounce payoff now",
    };
  }

  if (name === MB.MIRROR_PATH) {
    const alreadyControls = hasName(analysis.spellTrap || [], MB.MIRROR_PATH);
    if (alreadyControls) return { yes: false };
    return {
      yes: true,
      priority: analysis.oppPressure ? 7 : 5.5,
      reason: "establish Miragebound battle protection",
    };
  }

  return { yes: false };
}

export function shouldSetMirageboundBackrow(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  if (card?.name === MB.FALSE_HORIZON) {
    return {
      yes: true,
      priority: analysis.oppPressure ? 6 : 4.5,
      reason: "prepare attack response",
    };
  }
  if (card?.name === MB.VANISHING_STEP) {
    return {
      yes: true,
      priority: analysis.hasMeaningfulBounce ? 5.5 : 3.5,
      reason: "hold quick bounce for opponent turn",
    };
  }
  return { yes: false };
}

export function shouldSummonMirageboundMonster(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis, tributeInfo: {tributesNeeded?:number} = {}): {yes:boolean;priority?:number;position?:"attack"|"defense";reason?:string} {
  if (!card || card.cardKind !== "monster") return { yes: false };
  if (card.name === MB.REBEL) return { yes: false };
  if (card.name === MB.FALSE_KING) return { yes: false };
  if ((tributeInfo.tributesNeeded || 0) > 0) return { yes: false };

  if (card.name === MB.SCOUT) {
    return {
      yes: true,
      priority: analysis.hasOasisActive ? 11.5 : 12,
      position: "attack",
      reason: "normal summon Scout starter",
    };
  }

  if (card.name === MB.SAND_PRIESTESS) {
    return {
      yes: true,
      priority: analysis.mirageboundGraveyard.length > 0 ? 8.2 : 7.2,
      position: analysis.oppPressure ? "defense" : "attack",
      reason: "set up Priestess control",
    };
  }

  if (card.name === MB.GLASS_VIPER) {
    return {
      yes: true,
      priority: analysis.hasLeviathanMaterials ? 8 : 7,
      position: analysis.oppPressure ? "defense" : "attack",
      reason: "set up Viper bounce payoff",
    };
  }

  if (card.name === MB.DANCER) {
    return {
      yes: true,
      priority: analysis.faceUpMiragebounds.length > 0 ? 6.5 : 5.5,
      position: "attack",
      reason: "normal summon Dancer body",
    };
  }

  if (card.name === MB.JACKAL) {
    if (analysis.hasPlannedBounce) return { yes: false };
    return {
      yes: true,
      priority: 4.5,
      position: "attack",
      reason: "normal summon Jackal only without bounce line",
    };
  }

  if (isMiragebound(card)) {
    return {
      yes: true,
      priority: 3,
      position: "attack",
      reason: "summon Miragebound body",
    };
  }

  return { yes: false };
}

export function shouldActivateHandIgnition(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  if (card?.name === MB.DANCER) {
    if (analysis.fieldCapacity <= 0) return { yes: false };
    if (analysis.faceUpMiragebounds.length === 0) return { yes: false };
    if (
      !analysis.hasMeaningfulBounce &&
      analysis.opponentMonsters.length === 0 &&
      analysis.faceUpMiragebounds.length > 1
    ) {
      return { yes: false };
    }
    return {
      yes: true,
      priority: analysis.hasMeaningfulBounce ? 9 : 7,
      reason: "special summon Dancer as extender",
    };
  }

  return { yes: false };
}

export function shouldActivateMonsterEffect(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis, context: {effect?: import("../../contracts/effects.js").EffectDefinition} = {}) {
  const otherMiragebounds = analysis.faceUpMiragebounds.filter(
    (candidate) => candidate !== card,
  );
  const opponentTargets = analysis.opponentMonsters.length > 0;

  if (card?.name === MB.GLASS_SOVEREIGN) {
    if (otherMiragebounds.length === 0) return { yes: false };
    if (getOpponentCards(analysis).length === 0) return { yes: false };
    return {
      yes: true,
      priority: 11.5,
      reason: "Sovereign bounce converts tempo",
    };
  }

  if (card?.name === MB.DANCER) {
    if (otherMiragebounds.length === 0) return { yes: false };
    if (analysis.hasLeviathanLine && analysis.opponentMonsters.length >= 2) {
      return { yes: false };
    }
    if (!analysis.hasMeaningfulBounce && !opponentTargets) return { yes: false };
    return {
      yes: true,
      priority: analysis.hasMeaningfulBounce ? 9.2 : 7,
      reason: "bounce Miragebound for Dancer pressure",
    };
  }

  if (card?.name === MB.SCOUT) {
    if (!opponentTargets) return { yes: false };
    return {
      yes: true,
      priority:
        7.5 +
        (analysis.hasOasisActive ? 1.5 : 0) +
        (analysis.scoutEffectActivations < 2 ? 1 : 0) +
        getRebelPositionEffectBonus(analysis),
      reason: "Scout changes battle position and advances Ascension",
    };
  }

  if (card?.name === MB.SAND_PRIESTESS) {
    if (!opponentTargets) return { yes: false };
    return {
      yes: true,
      priority:
        (analysis.mirageboundGraveyard.length > 0 ? 8.8 : 7.8) +
        getRebelPositionEffectBonus(analysis),
      reason: "Priestess shifts and weakens threat",
    };
  }

  if (card?.name === MB.FALSE_KING) {
    if (!opponentTargets) return { yes: false };
    return {
      yes: true,
      priority: 7.6 + getRebelPositionEffectBonus(analysis),
      reason: "False King shifts opponent threat",
    };
  }

  return { yes: false };
}

export function shouldActivateFieldSpell(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  if (card?.name !== MB.OASIS) return { yes: false };
  if (analysis.opponentMonsters.length === 0) return { yes: false };
  return {
    yes: true,
    priority:
      (analysis.hasMeaningfulBounce ? 10.2 : 8.4) +
      getRebelPositionEffectBonus(analysis),
    reason: analysis.hasMeaningfulBounce
      ? "Oasis bounce mode has payoff"
      : analysis.hasRebelOpenZoneTriggerWindow
        ? "Oasis shift mode triggers Rebel extender"
        : "Oasis shift mode controls threat",
  };
}

export function shouldActivateSpellTrapEffect(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  if (card?.name !== MB.MIRROR_PATH) return { yes: false };
  if ((analysis.oppSpellTrap || []).length === 0 && !analysis.oppFieldSpell) {
    return { yes: false };
  }
  if (analysis.mirrorPathIsOnlyBattleProtection) {
    return { yes: false };
  }
  return {
    yes: true,
    priority: 6,
    reason: "Mirror Path removes opposing backrow",
  };
}

export function getMirageboundCardValue(card: MirageboundCard) {
  if (!card) return 0;
  const base = estimateCardValue(card);
  if (card.name === MB.SCOUT) return base + 8;
  if (card.name === MB.GLASS_VIPER) return base + 5;
  if (card.name === MB.SAND_PRIESTESS) return base + 4;
  if (card.name === MB.FALSE_KING) return base + 4;
  if (card.name === MB.REBEL) return base + 4.5;
  if (card.name === MB.DANCER) return base + 3;
  if (card.name === MB.JACKAL) return base + 2;
  if (card.name === MB.GLASS_SOVEREIGN) return base + 10;
  if (card.name === MB.DESERT_LEVIATHAN) return base + 9;
  return base;
}

export function selectBestTributes(field: MirageboundCard[] = [], tributesNeeded = 0, cardToSummon: MirageboundCard | null = null) {
  if (tributesNeeded <= 0) return [];
  return (field || [])
    .map((card, index) => ({
      index,
      value:
        estimateMonsterValue(card) +
        (isMiragebound(card) ? 5 : 0) +
        (card?.name === MB.SCOUT ? 20 : 0),
    }))
    .sort((a, b) => a.value - b.value)
    .slice(0, tributesNeeded)
    .map((entry) => entry.index);
}
