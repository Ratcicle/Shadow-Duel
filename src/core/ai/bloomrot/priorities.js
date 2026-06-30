import {
  BLOOMROT_NAMES,
  getSporeCount,
  isBloomrot,
  isBloomrotMonster,
} from "./analysis.js";
import {
  shouldPrioritizeRottingGroundSet,
  shouldUseRottingGroundNegate,
} from "./defense.js";
import { evaluateBloomrotCounterSpend } from "./resourcePolicy.js";
import { buildBloomrotTargetPreferences } from "./targeting.js";

const N = {
  SPORELING: "Bloomrot Sporeling",
  ROOTLING: "Bloomrot Rootling",
  MYCO_WEAVER: "Bloomrot Myco-Weaver",
  ROT_STAG: "Bloomrot Rot-Stag",
  CARRIONCAP: "Bloomrot Carrioncap",
  MOLDMENDER: "Bloomrot Moldmender",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  SPORE_CLOUD: "Bloomrot Spore Cloud",
  FUNGAL_ARMOR: "Bloomrot Fungal Armor",
  OVERGROWTH: "Bloomrot Overgrowth",
  SUDDEN_GERMINATION: "Bloomrot Sudden Germination",
};

function hasOpponentFaceupTarget(analysis = {}) {
  return [
    ...(analysis.oppField || []),
    ...(analysis.oppSpellTrap || []),
    analysis.oppFieldSpell,
  ].some((card) => card && card.isFacedown !== true);
}

function hasOpponentFaceupMonster(analysis = {}) {
  return (analysis.opponentMonsters || []).some(
    (card) => card?.isFacedown !== true,
  );
}

function isBloomrotToken(card) {
  return card?.isToken === true || card?.name === BLOOMROT_NAMES.TOKEN;
}

function hasAnyNonTokenBloomrotMonster(analysis = {}) {
  return (analysis.faceUpBloomrotField || []).some(
    (card) => isBloomrotMonster(card) && !isBloomrotToken(card),
  );
}

function hasAnyBloomrotMonster(analysis = {}) {
  return [
    ...(analysis.faceUpBloomrotField || []),
    ...(analysis.ownMonsters || []),
  ].some(isBloomrotMonster);
}

function isMainPhase1(analysis = {}) {
  return String(analysis.phase || "main1").toLowerCase().includes("main1");
}

function hasRecoverableBloomrot(analysis = {}) {
  return (analysis.bloomrotGraveyard || []).length > 0;
}

function withSpendPolicy(card, analysis, options = {}) {
  const decision = evaluateBloomrotCounterSpend({
    sourceCard: card,
    analysis,
    ...options,
  });
  return {
    yes: decision.allow,
    priorityBonus: decision.priorityBonus || 0,
    reason: decision.reason,
  };
}

function alreadyHasRottingGround(analysis = {}) {
  return (analysis.spellTrap || []).some(
    (card) => card?.name === BLOOMROT_NAMES.ROTTING_GROUND,
  );
}

export function buildBloomrotActivationContext(
  card,
  analysis = {},
  options = {},
) {
  const zone = options.zone || options.sourceZone || "field";
  return {
    archetype: "Bloomrot",
    sourceName: card?.name || null,
    effect: options.effect || null,
    zone,
    activationZone: options.activationZone || zone,
    sourceZone: options.sourceZone || zone,
    fromHand: options.fromHand === true || zone === "hand",
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    actionContext: {
      archetype: "Bloomrot",
      sourceName: card?.name || null,
      effectId: options.effect?.id || null,
      targetPreferences: buildBloomrotTargetPreferences(card, analysis),
      specialSummonPositions: {
        byName: {
          [BLOOMROT_NAMES.TOKEN]: "defense",
        },
      },
    },
    analysis,
  };
}

export function shouldSummonBloomrotMonster(card, analysis = {}, tributeInfo = {}) {
  if (!card || card.cardKind !== "monster") return { yes: false };
  if (!isBloomrot(card)) return { yes: false };
  if ((tributeInfo.tributesNeeded || 0) > 0) {
    return { yes: false, reason: "avoid tribute summons in Bloomrot MVP" };
  }

  switch (card.name) {
    case N.MYCO_WEAVER:
      return {
        yes: true,
        priority: analysis.hasBloomrotToken ? 8.5 : 12,
        position: "attack",
        reason: "normal summon Myco-Weaver starter",
      };
    case N.SPORELING:
      return {
        yes: true,
        priority: 10.5,
        position: "attack",
        reason: "normal summon Sporeling starter",
      };
    case N.CARRIONCAP:
      return {
        yes: true,
        priority: hasOpponentFaceupMonster(analysis) ? 8.5 : 7,
        position: "attack",
        reason: "normal summon Carrioncap pressure",
      };
    case N.MOLDMENDER:
      return {
        yes: true,
        priority: analysis.oppField?.length ? 7.2 : 6,
        position: "defense",
        reason: "set up Moldmender defense",
      };
    case N.ROOTLING:
      return {
        yes: true,
        priority: analysis.hasBloomrotToken ? 5 : 6.5,
        position: "defense",
        reason: "normal summon Rootling fallback",
      };
    default:
      return { yes: false, reason: "not a Bloomrot MVP normal summon" };
  }
}

export function shouldPlayBloomrotSpell(card, analysis = {}) {
  if (!card || card.cardKind !== "spell") return { yes: false };

  switch (card.name) {
    case BLOOMROT_NAMES.LIVING_COLONY:
      if (analysis.hasLivingColonyActive) {
        return { yes: false, reason: "Living Colony already active" };
      }
      return {
        yes: true,
        priority: 13,
        reason: "activate Living Colony engine",
      };
    case BLOOMROT_NAMES.COMPOST_RITUAL:
      return {
        yes: hasOpponentFaceupTarget(analysis),
        priority: 8 + Math.min(3, analysis.faceUpBloomrotField?.length || 0),
        reason: "place Compost Ritual spores",
      };
    case N.SPORE_CLOUD:
      return {
        yes: hasOpponentFaceupTarget(analysis),
        priority: 7.5,
        reason: "spread Spore Cloud counters",
      };
    case N.OVERGROWTH:
      return {
        yes: hasOpponentFaceupMonster(analysis),
        priority: 6.8,
        reason: "infect opponent monster with Overgrowth",
      };
    case N.FUNGAL_ARMOR:
      return {
        yes: hasAnyNonTokenBloomrotMonster(analysis),
        priority: analysis.fieldSporeTotal >= 3 ? 7 : 5.8,
        reason: "equip Fungal Armor to preserve Bloomrot body",
      };
    case BLOOMROT_NAMES.HARVEST:
      {
        const policy = withSpendPolicy(card, analysis, {
          purpose: "harvest",
        });
        return {
          yes: policy.yes,
          priority:
            8 + Math.floor((analysis.fieldSporeTotal || 0) / 4) + policy.priorityBonus,
          reason: policy.reason || "cash in Harvest with relevant removal",
        };
      }
    case BLOOMROT_NAMES.POLYMERIZATION:
      return { yes: false, reason: "Bloomrot MVP skips fusion spells" };
    default:
      return { yes: false, reason: "non-MVP Bloomrot spell" };
  }
}

export function shouldActivateBloomrotHandIgnition(card, analysis = {}) {
  if (!card || !isBloomrot(card)) return { yes: false };
  if ((analysis.freeMonsterZones || 0) <= 0) return { yes: false };

  switch (card.name) {
    case N.ROOTLING:
      return {
        yes: analysis.hasBloomrotToken === true,
        priority: 9,
        reason: "special summon Rootling from hand with Bloomrot Token",
      };
    case N.ROT_STAG:
      {
        const policy = withSpendPolicy(card, analysis, {
          purpose: "rot_stag_body",
          amount: 2,
        });
        return {
          yes: policy.yes,
          priority: (analysis.opponentMonsters?.length ? 7.8 : 6.2) + policy.priorityBonus,
          reason: policy.reason || "special summon Rot-Stag by spending spores",
        };
      }
    case N.GRAVECAP_WIDOW:
      {
        const policy = withSpendPolicy(card, analysis, {
          purpose: "widow_removal",
          amount: 2,
        });
        return {
          yes: policy.yes,
          priority: 8.4 + policy.priorityBonus,
          reason: policy.reason || "special summon Gravecap Widow for removal",
        };
      }
    case N.ANCIENT_HUSK:
      {
        const policy = withSpendPolicy(card, analysis, {
          purpose: "ancient_husk_body",
          amount: 4,
        });
        return {
          yes: policy.yes,
          priority: 7 + policy.priorityBonus,
          reason: policy.reason || "special summon Ancient Husk from hand",
        };
      }
    default:
      return { yes: false };
  }
}

export function shouldActivateBloomrotMonsterEffect(card, analysis = {}) {
  if (!card || !isBloomrot(card)) return { yes: false };

  switch (card.name) {
    case N.ROOTLING:
      return {
        yes: hasOpponentFaceupTarget(analysis),
        priority: 6.8,
        reason: "Rootling adds a Spore Counter",
      };
    case N.MYCO_WEAVER:
      return {
        yes:
          hasOpponentFaceupTarget(analysis) &&
          (analysis.faceUpBloomrotField || []).length > 1,
        priority: 7.2,
        reason: "Myco-Weaver converts spare Bloomrot into spores",
      };
    case N.CARRIONCAP:
      return {
        yes: isMainPhase1(analysis) && hasOpponentFaceupMonster(analysis),
        priority: 9.4,
        reason: "Carrioncap debuffs before battle",
      };
    case BLOOMROT_NAMES.ANCIENT_MYCELIUM:
      {
        const policy = withSpendPolicy(card, analysis, {
          purpose: "ancient_mycelium_removal",
          amount: 2,
        });
        return {
          yes: policy.yes,
          priority: 8.2 + policy.priorityBonus,
          reason: policy.reason || "Ancient Mycelium removal",
        };
      }
    default:
      return { yes: false };
  }
}

export function shouldActivateBloomrotSpellTrapEffect(card, analysis = {}) {
  if (!card || !isBloomrot(card)) return { yes: false };

  switch (card.name) {
    case BLOOMROT_NAMES.ROOT_NETWORK:
      {
        const policy = withSpendPolicy(card, analysis, {
          purpose: "root_network_recover",
          amount: 3,
        });
        return {
          yes: hasRecoverableBloomrot(analysis) && policy.yes,
          priority: 6 + policy.priorityBonus,
          reason: policy.reason || "Root Network recovers Bloomrot card",
        };
      }
    case BLOOMROT_NAMES.ROTTING_GROUND:
      return shouldUseRottingGroundNegate(analysis);
    default:
      return { yes: false };
  }
}

export function shouldActivateBloomrotFieldEffect(card, analysis = {}) {
  if (card?.name !== BLOOMROT_NAMES.LIVING_COLONY) return { yes: false };
  return {
    yes: hasOpponentFaceupMonster(analysis) || hasAnyBloomrotMonster(analysis),
    priority: 8.5,
    reason: "Living Colony places a Spore Counter",
  };
}

export function shouldSetBloomrotBackrow(card, analysis = {}) {
  if (!card) return { yes: false };

  if (card.name === N.SUDDEN_GERMINATION) {
    const underPressure =
      (analysis.opponentMonsters || []).length > 0 ||
      (Number(analysis.player?.lp) || 8000) <= 3500;
    return {
      yes: true,
      priority: underPressure ? 5.7 : 4.5,
      reason: underPressure
        ? "set Sudden Germination under battle pressure"
        : "set Sudden Germination defense",
    };
  }
  if (card.name === BLOOMROT_NAMES.ROTTING_GROUND) {
    const decision = shouldPrioritizeRottingGroundSet(analysis);
    return {
      ...decision,
      yes: !alreadyHasRottingGround(analysis) && decision.yes,
    };
  }
  return { yes: false };
}

export function shouldSkipDuplicateBloomrotBackrow(card, analysis = {}) {
  return card?.name === BLOOMROT_NAMES.ROTTING_GROUND && alreadyHasRottingGround(analysis);
}

export function getSporeInvestmentScore(analysis = {}) {
  return Math.min(8, Math.floor((analysis.fieldSporeTotal || 0) / 2));
}
