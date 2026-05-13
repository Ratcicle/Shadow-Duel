import { getVoidCardKnowledge, isVoid } from "./knowledge.js";
import { VOID_IDS } from "./combos.js";
import { evaluateVoidMonster } from "./scoring.js";
import {
  getEffectiveAtk,
  getEffectiveDef,
  getStrongestBattleStat,
} from "../common/cardStats.js";
import {
  createFinisherPlan,
  getBestFinisherPlan,
  rankFinisherPlans,
} from "../common/finisherPlans.js";
import { assessSummonEntry } from "../common/summonAssessment.js";

const SEALING_PROTECTED_TARGET_IDS = new Set([
  VOID_IDS.ARCTURUS,
  VOID_IDS.HOLLOW_KING,
  VOID_IDS.BERSERKER,
  VOID_IDS.HYDRA_TITAN,
  VOID_IDS.COSMIC_WALKER,
  VOID_IDS.MALICIOUS_DEMON,
  VOID_IDS.THOUSAND_ARMS,
  VOID_IDS.SLAYER_BRUTE,
  VOID_IDS.SERPENT_DRAKE,
  VOID_IDS.HAUNTER,
  VOID_IDS.FORGOTTEN_KNIGHT,
]);

const SEALING_LOW_COST_TARGET_IDS = new Set([
  VOID_IDS.HOLLOW,
  VOID_IDS.CONJURER,
  VOID_IDS.WALKER,
  VOID_IDS.BEAST,
  VOID_IDS.TENEBRIS_HORN,
]);

const FUSION_PROTECTED_MATERIAL_IDS = new Set([
  VOID_IDS.RAVEN,
  VOID_IDS.ARCTURUS,
  VOID_IDS.HOLLOW_KING,
  VOID_IDS.BERSERKER,
  VOID_IDS.HYDRA_TITAN,
  VOID_IDS.COSMIC_WALKER,
  VOID_IDS.MALICIOUS_DEMON,
]);

const VOID_BOSS_SUMMON_IDS = new Set([
  VOID_IDS.ARCTURUS,
  VOID_IDS.HOLLOW_KING,
  VOID_IDS.BERSERKER,
  VOID_IDS.HYDRA_TITAN,
  VOID_IDS.COSMIC_WALKER,
  VOID_IDS.MALICIOUS_DEMON,
]);

const VOID_ENGINE_SUMMON_IDS = new Set([
  VOID_IDS.CONJURER,
  VOID_IDS.WALKER,
  VOID_IDS.HOLLOW,
  VOID_IDS.BEAST,
  VOID_IDS.TENEBRIS_HORN,
  VOID_IDS.HAUNTER,
  VOID_IDS.BONE_SPIDER,
  VOID_IDS.THOUSAND_ARMS,
]);

function getTributeNeedForNormalSummon(card) {
  if (!card || card.cardKind !== "monster") return Infinity;
  if (card.cannotBeNormalSummonedOrSet) return Infinity;
  const level = Number(card.level || 0);
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

function canNormalSummonWithCurrentField(card, fieldCount) {
  return getTributeNeedForNormalSummon(card) <= fieldCount;
}

function getFieldIgnitions(monster) {
  return (monster?.effects || []).filter(
    (effect) =>
      effect &&
      effect.timing === "ignition" &&
      (!effect.requireZone || effect.requireZone === "field"),
  );
}

function isSafeSealingTarget(monster, bot, game) {
  if (!monster || SEALING_PROTECTED_TARGET_IDS.has(monster.id)) return false;
  if (monster.usedEffectThisTurn || monster.hasAttacked) return true;
  if (SEALING_LOW_COST_TARGET_IDS.has(monster.id)) return true;

  const ignitions = getFieldIgnitions(monster);
  if (ignitions.length === 0) return true;
  if (!game?.effectEngine?.checkOncePerTurn) return false;

  return ignitions.every((effect) => {
    const check = game.effectEngine.checkOncePerTurn(monster, bot, effect);
    return check?.ok === false;
  });
}

function isProtectedVoidFusionMaterial(card, bot) {
  if (!card || FUSION_PROTECTED_MATERIAL_IDS.has(card.id)) return true;
  if (
    card.id === VOID_IDS.THOUSAND_ARMS &&
    (bot?.extraDeck || []).some((extra) => extra?.id === VOID_IDS.MALICIOUS_DEMON)
  ) {
    return true;
  }
  return false;
}

export function shouldPlayVoidSpell(card, game, bot, opponent) {
  if (!card || card.cardKind !== "spell") return { yes: false, priority: 0 };
  const knowledge = getVoidCardKnowledge(card);
  const oppFieldCount = opponent?.field?.length || 0;
  const myFieldCount = bot?.field?.length || 0;
  const myLp = bot?.lp || 0;
  const oppLp = opponent?.lp || 0;
  const isSimulatedState = game?._isPerspectiveState === true;

  // ─────────────────────────────────────────────────────────────────────────
  // MIRROR DIMENSION (continuous, reactive SS)
  // Ativar proativamente: quando ainda não está em campo E há monstros lv4+
  // na mão para casar com o level matching de summons do oponente.
  // ─────────────────────────────────────────────────────────────────────────
  if (card.id === VOID_IDS.MIRROR_DIMENSION) {
    const alreadyOnField = (bot?.spellTrap || []).some(
      (c) => c?.id === VOID_IDS.MIRROR_DIMENSION,
    );
    if (alreadyOnField) {
      return { yes: false, priority: 0, reason: "Mirror Dimension já em campo" };
    }
    const handMonstersLv4Plus = (bot?.hand || []).filter(
      (c) => c?.cardKind === "monster" && (c.level || 0) >= 4,
    ).length;
    if (handMonstersLv4Plus === 0) {
      return {
        yes: false,
        priority: 0,
        reason: "Sem monstro lv4+ na mão para SS reativo",
      };
    }
    return {
      yes: true,
      priority: 5.5 + Math.min(handMonstersLv4Plus, 3) * 0.4,
      reason: "Mirror Dimension proativo (resposta a summons do oponente)",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEALING THE VOID
  // Custo: zera ATK/DEF e nega efeitos de 1 Void no campo (este turno).
  // Payoff: ganha 1 Normal Summon extra.
  // Vale alta prioridade quando o alvo já queimou sua ignition (custo zero
  // efetivo). Vale prioridade média se o alvo não tem ignition (Hollow,
  // Tenebris Horn). Vale prioridade baixa se há ignitions ainda disponíveis
  // (gastar Sealing nelas é desperdício do efeito do monstro).
  // ─────────────────────────────────────────────────────────────────────────
  if (card.id === VOID_IDS.SEALING) {
    const fieldVoids = (bot?.field || []).filter(
      (m) => m && m.cardKind === "monster" && !m.isFacedown && isVoid(m),
    );
    if (fieldVoids.length === 0) {
      return { yes: false, priority: 0, reason: "Sem Void face-up para alvo" };
    }

    const safeTargets = fieldVoids.filter((monster) =>
      isSafeSealingTarget(monster, bot, game),
    );
    if (safeTargets.length === 0) {
      return {
        yes: false,
        priority: 0,
        reason: "Sealing sem alvo Void descartavel ou ja usado",
      };
    }

    const summonLimit = 1 + (bot?.additionalNormalSummons || 0);
    const normalAvailable = (bot?.summonCount || 0) < summonLimit;
    const immediateNormalTargets = (bot?.hand || []).filter(
      (candidate) =>
        candidate?.cardKind === "monster" &&
        isVoid(candidate) &&
        candidate.id !== VOID_IDS.RAVEN &&
        candidate.id !== VOID_IDS.HOLLOW &&
        canNormalSummonWithCurrentField(candidate, fieldVoids.length),
    );
    if (immediateNormalTargets.length === 0) {
      return {
        yes: false,
        priority: 0,
        reason: "Sem monstro Void relevante para a Normal Summon adicional",
      };
    }

    const createsActualExtraNormal =
      !normalAvailable || immediateNormalTargets.length >= 2;
    if (!createsActualExtraNormal) {
      return {
        yes: false,
        priority: 0,
        reason: "Sealing nao adiciona summon extra real neste estado",
      };
    }

    const hasHighPayoffNormal = immediateNormalTargets.some((candidate) =>
      [
        VOID_IDS.ARCTURUS,
        VOID_IDS.THOUSAND_ARMS,
        VOID_IDS.SLAYER_BRUTE,
        VOID_IDS.SERPENT_DRAKE,
        VOID_IDS.HAUNTER,
        VOID_IDS.FORGOTTEN_KNIGHT,
      ].includes(candidate.id),
    );
    const burnedTargets = safeTargets.filter(
      (monster) =>
        monster.usedEffectThisTurn ||
        getFieldIgnitions(monster).some((effect) => {
          const check = game?.effectEngine?.checkOncePerTurn?.(
            monster,
            bot,
            effect,
          );
          return check?.ok === false;
        }),
    ).length;

    let priority = hasHighPayoffNormal ? 7.2 : 5.8;
    if (!normalAvailable) priority += 0.8;
    if (burnedTargets > 0) priority += 0.6;
    if (immediateNormalTargets.length >= 2) priority += 0.4;
    if (isSimulatedState && priority > 6.5) priority -= 0.3;

    return {
      yes: true,
      priority,
      reason: "Sealing com alvo barato e Normal Summon extra imediata",
    };

    const handMonsterCount = (bot?.hand || []).filter(
      (c) => c?.cardKind === "monster",
    ).length;
    if (handMonsterCount === 0) {
      return {
        yes: false,
        priority: 0,
        reason: "Sem monstro extra para a Normal Summon adicional",
      };
    }

    // Em simulação ou sem effectEngine, fallback moderado.
    if (isSimulatedState || !game?.effectEngine?.checkOncePerTurn) {
      return {
        yes: true,
        priority: 4.0,
        reason: "Sealing para Normal Summon extra (estado simulado)",
      };
    }

    let burned = 0;
    let fresh = 0;
    let noIgnition = 0;
    for (const monster of fieldVoids) {
      const ignitions = (monster.effects || []).filter(
        (e) =>
          e &&
          e.timing === "ignition" &&
          (!e.requireZone || e.requireZone === "field"),
      );
      if (ignitions.length === 0) {
        noIgnition += 1;
        continue;
      }
      const allBurned = ignitions.every((effect) => {
        const check = game.effectEngine.checkOncePerTurn(monster, bot, effect);
        return check?.ok === false;
      });
      if (allBurned) burned += 1;
      else fresh += 1;
    }

    if (burned > 0) {
      return {
        yes: true,
        priority: 7.5,
        reason: "Sealing pós-payoff: alvo tem ignition queimada (custo zero)",
      };
    }
    if (fresh > 0 && noIgnition === 0) {
      return {
        yes: true,
        priority: 2.5,
        reason: "Sealing arriscado: queimaria ignition disponível",
      };
    }
    // Maioria sem ignition (Hollow/Tenebris Horn) — uso decente sem perda real
    return {
      yes: true,
      priority: 5.5,
      reason: "Sealing em monstro sem ignition disponível",
    };
  }

  if (card.subtype === "field") {
    const shouldRevive =
      myFieldCount === 0 && (bot?.graveyard || []).some(isVoid);
    const priority = shouldRevive ? 8 : 5;
    return { yes: true, priority };
  }

  if (knowledge?.role === "starter") {
    const searchTargets = (bot?.deck || []).filter(
      (candidate) =>
        candidate?.cardKind === "monster" &&
        isVoid(candidate) &&
        (candidate.atk || 0) <= 1600,
    );

    if (searchTargets.length === 0) {
      return { yes: false, priority: 0 };
    }

    if (myFieldCount === 0) {
      const hasHollow = searchTargets.some(
        (candidate) => candidate?.name === "Void Hollow" || candidate?.id === 154,
      );
      return {
        yes: true,
        priority: hasHollow ? 8.8 : 7.2,
        reason: hasHollow
          ? "Starter: busca Hollow e pode invocar da mão"
          : "Starter: busca e estabelece monstro Void",
      };
    }

    return {
      yes: true,
      priority: 4.8,
      reason: "Busca peça de engine sem extensão grátis",
    };
  }

  if (knowledge?.role === "board_clear") {
    const shouldReset = oppFieldCount > myFieldCount && oppFieldCount >= 2;
    return { yes: shouldReset, priority: shouldReset ? 7.5 : 0 };
  }

  if (knowledge?.role === "tempo" || knowledge?.role === "removal") {
    const shouldTempo = oppFieldCount > 0 && myFieldCount > 0;
    return {
      yes: shouldTempo,
      priority: shouldTempo ? 5.5 : 0,
      reason: "Bounce one-shot requer troca de tempo clara",
    };
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

  if (
    knowledge?.role === "boss" ||
    knowledge?.role === "solo_finisher" ||
    knowledge?.role === "ascension_material"
  ) {
    priority += 2.0;
  }
  if (knowledge?.tags?.includes("swarm")) priority += 1.4;
  if (knowledge?.tags?.includes("direct"))
    priority += oppFieldCount === 0 ? 1.2 : 0.4;
  if (knowledge?.role === "control") priority += 0.8;
  if (knowledge?.role === "starter") priority += 1.2;
  if (knowledge?.role === "midrange") priority += 0.8;
  if (knowledge?.role === "support") priority += 0.5;
  if (def > atk + 300) priority -= 0.4;

  return { yes: true, priority };
}

export function assessVoidSummonEntry(card, context = {}) {
  if (!card || card.cardKind !== "monster") {
    return assessSummonEntry(card, {
      ...context,
      profile: { invalidReason: "Invalid summon candidate" },
    });
  }

  const game = context.game || null;
  const analysis = context.analysis || null;
  const player = context.player || context.bot || null;
  const opponent =
    context.opponent ||
    (game && player && typeof game.getOpponent === "function"
      ? game.getOpponent(player)
      : null);
  const oppField = opponent?.field || analysis?.oppField || [];
  const myField = player?.field || analysis?.field || [];
  const source = context.source || {};
  const action = context.action || {};
  const strongestThreat = getStrongestOpponentBattleStat(oppField);
  const oppHasThreat = strongestThreat > 0;
  const isWalkerBounce =
    source?.id === VOID_IDS.WALKER ||
    source?.name === "Void Walker" ||
    action?.type === "bounce_and_summon";
  const isEmergency = myField.length === 0 && oppHasThreat;

  if (card.id === VOID_IDS.RAVEN) {
    const position = "defense";
    if (!isEmergency) {
      return {
        shouldSummon: false,
        position,
        scoreDelta: -80,
        reason: "Raven should stay in hand for Void fusion protection",
        strongestThreat,
      };
    }
    return {
      shouldSummon: true,
      position,
      scoreDelta: -8,
      reason: "Emergency body only: Raven enters defense",
      strongestThreat,
    };
  }

  const base = assessSummonEntry(card, {
    ...context,
    game,
    analysis,
    player,
    opponent,
    profile: {
      bossIds: VOID_BOSS_SUMMON_IDS,
      enginePieceIds: VOID_ENGINE_SUMMON_IDS,
      isBoss: (candidate) =>
        getVoidCardKnowledge(candidate)?.role === "boss" ||
        VOID_BOSS_SUMMON_IDS.has(candidate?.id),
      defaultReason: "default Void summon assessment",
    },
  });

  if (isWalkerBounce && card.id === VOID_IDS.HOLLOW) {
    return {
      ...base,
      scoreDelta: (base.scoreDelta || 0) + 1.2,
      reason: [
        base.reason,
        "Walker into Hollow enables hand summon chain",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  return base;
}

export function assessVoidNormalSummonEntry(card, context = {}) {
  const base = assessVoidSummonEntry(card, {
    ...context,
    action: {
      ...(context.action || {}),
      type: "normal_summon",
      cannotAttackThisTurn: false,
    },
  });
  if (!card || card.cardKind !== "monster") return base;

  if (card.id === VOID_IDS.RAVEN) {
    return {
      ...base,
      position: "defense",
      facedown: false,
      reason: [
        base.reason,
        "normal summon Raven only as emergency defense",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  const field = context.player?.field || context.analysis?.field || [];
  const graveyard = context.player?.graveyard || context.analysis?.graveyard || [];
  const tributeCards = Array.isArray(context.tributeCards)
    ? context.tributeCards
    : [];
  const tributeCount = Number.isFinite(context.tributeCount)
    ? context.tributeCount
    : tributeCards.length;
  const remainingFieldCount = Math.max(0, field.length - tributeCount);
  const voidsInGYAfterTribute =
    graveyard.filter(isVoid).length + tributeCards.filter(isVoid).length;
  const strongestThreat = base.strongestThreat || 0;
  const faceupValue = hasVoidFaceupNormalSummonValue(card);

  let effectiveAtk = getEffectiveAtk(card);
  if (card.id === VOID_IDS.ARCTURUS && remainingFieldCount === 0) {
    effectiveAtk += voidsInGYAfterTribute * 100;
  }

  if (faceupValue) {
    const beatsThreat = strongestThreat <= 0 || effectiveAtk > strongestThreat;
    return {
      ...base,
      shouldSummon: true,
      position: "attack",
      facedown: false,
      scoreDelta:
        (base.scoreDelta || 0) +
        (beatsThreat ? 1.4 : -0.4) +
        (card.id === VOID_IDS.ARCTURUS && remainingFieldCount === 0 ? 1.2 : 0),
      reason: [
        base.reason,
        "normal summon must stay face-up for Void payoff",
        card.id === VOID_IDS.ARCTURUS && remainingFieldCount === 0
          ? `Arcturus projected ATK ${effectiveAtk}`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
      projectedAtk: effectiveAtk,
    };
  }

  const shouldSetDefensively =
    strongestThreat > 0 && getEffectiveDef(card) > getEffectiveAtk(card);
  return {
    ...base,
    position: shouldSetDefensively ? "defense" : "attack",
    facedown: shouldSetDefensively,
    projectedAtk: effectiveAtk,
  };
}

export function chooseVoidSummonPosition(card, opponent, analysis = null) {
  return assessVoidSummonEntry(card, { opponent, analysis }).position;
  if (!card || card.cardKind !== "monster") return "attack";
  const oppField = opponent?.field || [];
  const oppStrongest = oppField.reduce((max, monster) => {
    if (!monster || monster.cardKind !== "monster") return max;
    const atk = monster.isFacedown ? 1500 : monster.atk || 0;
    return Math.max(max, atk);
  }, 0);

  // Sem ameaça: ATK sempre.
  if (oppStrongest <= 0) return "attack";

  // Avalia o monstro nas duas posições e escolhe a de maior valor.
  // evaluateVoidMonster já considera role/efeito do arquétipo + posição
  // relativa à ameaça do oponente.
  const ctx = {
    oppStrongestAtk: oppStrongest,
    hollowCount: analysis?.hollowCount || 0,
    voidCount: analysis?.voidCount || 0,
    hollowsInGY: analysis?.hollowEconomy?.hollowsInGY || 0,
    voidsInGY: 0,
  };

  const valueAttack = evaluateVoidMonster(
    { ...card, position: "attack" },
    ctx,
  );
  const valueDefense = evaluateVoidMonster(
    { ...card, position: "defense" },
    ctx,
  );

  // Empate técnico → preferir ATK (gera pressão; defesa fica para casos claros).
  return valueAttack + 0.05 >= valueDefense ? "attack" : "defense";
}

/**
 * Avalia se vale a pena atrasar Hollow King para tentar Hydra Titan no próximo
 * turno. Reserva acontece quando há 4-5 Voids acessíveis (não chegou em 6) E
 * existe extensor pronto para fechar o gap (Conjurer/Walker fresh no campo,
 * Lost Throne na mão, Haunter+Hollows GY, ou Hollow extra na mão).
 */
function shouldReserveForHydra(bot, voidsAccessible) {
  const fieldIds = (bot?.field || []).map((c) => c?.id).filter(Boolean);
  const handIds = (bot?.hand || []).map((c) => c?.id).filter(Boolean);
  const gyIds = (bot?.graveyard || []).map((c) => c?.id).filter(Boolean);
  const extraIds = (bot?.extraDeck || []).map((c) => c?.id).filter(Boolean);

  if (!extraIds.includes(VOID_IDS.HYDRA_TITAN)) return false;
  if (voidsAccessible >= 6 || voidsAccessible < 4) return false;

  const conjurerOnField = fieldIds.includes(VOID_IDS.CONJURER);
  const walkerOnField = fieldIds.includes(VOID_IDS.WALKER);
  const hasLostThrone = handIds.includes(VOID_IDS.LOST_THRONE);
  const haunterRevive =
    (handIds.includes(VOID_IDS.HAUNTER) || gyIds.includes(VOID_IDS.HAUNTER)) &&
    gyIds.includes(VOID_IDS.HOLLOW);
  const extraHollowInHand = handIds.includes(VOID_IDS.HOLLOW);
  const thousandArmsRevive =
    fieldIds.includes(VOID_IDS.THOUSAND_ARMS) &&
    gyIds.includes(VOID_IDS.HOLLOW);

  return (
    conjurerOnField ||
    walkerOnField ||
    hasLostThrone ||
    haunterRevive ||
    extraHollowInHand ||
    thousandArmsRevive
  );
}

function countCards(cards = [], predicate) {
  return (cards || []).filter((card) => card && predicate(card)).length;
}

function hasCardId(cards = [], id) {
  return (cards || []).some((card) => card?.id === id);
}

function canUseAscensionFinisher(game, bot, materialId, ascensionId) {
  const realGame = game?._gameRef || game;
  const material = (bot?.field || []).find(
    (card) => card?.id === materialId && card.cardKind === "monster",
  );
  const ascensionCard = (bot?.extraDeck || []).find(
    (card) => card?.id === ascensionId,
  );
  if (!material || !ascensionCard) return false;
  if (
    typeof realGame?.canUseAsAscensionMaterial !== "function" ||
    typeof realGame?.checkAscensionRequirements !== "function"
  ) {
    return true;
  }
  return (
    realGame.canUseAsAscensionMaterial(bot, material)?.ok !== false &&
    realGame.checkAscensionRequirements(bot, ascensionCard)?.ok !== false
  );
}

function estimateVoidHydraDraws(bot) {
  const field = bot?.field || [];
  const hand = bot?.hand || [];
  const fieldVoids = field.filter(isVoid);
  const handVoids = hand.filter(isVoid);
  const fieldMaterialsNeeded = Math.max(0, 6 - handVoids.length);
  return Math.max(
    0,
    fieldVoids.length - Math.min(fieldMaterialsNeeded, fieldVoids.length),
  );
}

function strongestBattleStat(monsters = []) {
  return getStrongestOpponentBattleStat(monsters);
}

function countDestroyableByAtk(monsters = [], atk = 0) {
  return countCards(monsters, (monster) => {
    if (monster.cardKind !== "monster") return false;
    const stat = monster.isFacedown
      ? 1500
      : monster.position === "defense"
        ? getEffectiveDef(monster)
        : getEffectiveAtk(monster);
    return atk > stat;
  });
}

export function evaluateVoidFinisherPlans(bot, opponent, game = null, analysis = null) {
  const field = bot?.field || [];
  const hand = bot?.hand || [];
  const resolvedOpponent =
    opponent ||
    (bot?.game && typeof bot.game.getOpponent === "function"
      ? bot.game.getOpponent(bot)
      : null);
  const graveyard = bot?.graveyard || [];
  const deck = bot?.deck || [];
  const extraIds = (bot?.extraDeck || []).map((c) => c?.id).filter(Boolean);
  const voids = [...field, ...hand].filter(isVoid);
  const voidsInGY = graveyard.filter(isVoid);
  const hollows = voids.filter((card) => card?.id === VOID_IDS.HOLLOW);
  const hollowsInGY = countCards(graveyard, (card) => card.id === VOID_IDS.HOLLOW);
  const slayerField = field.some((card) => card?.id === VOID_IDS.SLAYER_BRUTE);
  const otherVoidCount = voids.filter(
    (card) => card?.id !== VOID_IDS.SLAYER_BRUTE,
  ).length;
  const ravenInHand = hand.some((card) => card?.id === VOID_IDS.RAVEN);
  const oppFieldCount =
    resolvedOpponent?.field?.filter((card) => card?.cardKind === "monster")
      .length || 0;
  const oppMonsters =
    resolvedOpponent?.field?.filter((card) => card?.cardKind === "monster") ||
    [];
  const oppStrongest = strongestBattleStat(oppMonsters);
  const oppLP = resolvedOpponent?.lp || analysis?.oppLP || 8000;
  const myLP = bot?.lp || analysis?.myLP || 8000;
  const hasPoly = hasCardId(hand, VOID_IDS.POLYMERIZATION);
  const expendableVoids = voids.filter(
    (card) => !isProtectedVoidFusionMaterial(card, bot),
  );
  const plans = [];

  if (
    hasCardId(hand, VOID_IDS.ARCTURUS) &&
    (bot?.summonCount || 0) < 1 + (bot?.additionalNormalSummons || 0) &&
    field.filter((card) => card?.cardKind === "monster").length >= 2
  ) {
    const fieldMonsters = field.filter((card) => card?.cardKind === "monster");
    const canBeSolo = fieldMonsters.length <= 2;
    const projectedAtk =
      2800 + (canBeSolo ? Math.min(voidsInGY.length + 2, 10) * 100 : 0);
    const jointLethal =
      fieldMonsters.reduce((sum, card) => sum + getEffectiveAtk(card), projectedAtk) >=
      oppLP;
    let score = canBeSolo ? 78 : 56;
    score += Math.min(voidsInGY.length, 8) * (canBeSolo ? 2 : 0.5);
    if (projectedAtk > oppStrongest) score += 9;
    if (projectedAtk >= oppLP && oppFieldCount === 0) score += 10;
    if (jointLethal) score += 8;
    if (canBeSolo) score += 6; // Battle Phase lock has real value when he is the plan.
    if (!canBeSolo && !jointLethal) score -= 18;
    plans.push(
      createFinisherPlan({
        kind: "normal_summon",
        targetName: "Arcturus, Lord of the Void",
        score100: score,
        reason: canBeSolo
          ? "Arcturus fica solo, escala com o GY e trava a Battle Phase"
          : "Arcturus acompanhado perde parte do payoff solo",
        details: { projectedAtk, canBeSolo, voidsInGY: voidsInGY.length },
      }),
    );
  }

  if (
    extraIds.includes(VOID_IDS.MALICIOUS_DEMON) &&
    canUseAscensionFinisher(
      game,
      bot,
      VOID_IDS.THOUSAND_ARMS,
      VOID_IDS.MALICIOUS_DEMON,
    )
  ) {
    let score =
      hollowsInGY >= 3
        ? 94
        : hollowsInGY === 2
          ? 78
          : hollowsInGY === 1
            ? 66
            : 42;
    if (oppFieldCount === 0 && hollowsInGY >= 2) score += 5;
    if (hollowsInGY >= 1 && oppLP <= 2600 * hollowsInGY) score += 9;
    if (oppStrongest >= 2600 && hollowsInGY <= 1) score -= 10;
    plans.push(
      createFinisherPlan({
        kind: "ascension",
        targetName: "Malicious Demon of the Void",
        score100: score,
        preserveHollowsInGY: hollowsInGY >= 1,
        reason:
          hollowsInGY >= 3
            ? "Malicious tem multiplos ataques relevantes com Hollows no GY"
            : "Malicious ainda compete, mas precisa de mais Hollows no GY",
        details: { hollowsInGY },
      }),
    );
  }

  if (
    extraIds.includes(VOID_IDS.HYDRA_TITAN) &&
    hasPoly &&
    expendableVoids.length >= 6
  ) {
    const projectedDraws = estimateVoidHydraDraws(bot);
    const stabilizesBoard =
      oppFieldCount >= 2 || oppStrongest >= 2800 || myLP <= 3000;
    let score =
      projectedDraws >= 2 ? 95 : projectedDraws === 1 ? 88 : stabilizesBoard ? 82 : 58;
    if (ravenInHand) score += 4;
    if (oppFieldCount === 0 && oppLP <= 3500) score += 8;
    if (projectedDraws <= 0 && !stabilizesBoard) score -= 8;
    plans.push(
      createFinisherPlan({
        kind: "fusion",
        targetName: "Void Hydra Titan",
        score100: score,
        reason:
          projectedDraws > 0
            ? `Hydra converte board em ${projectedDraws} compra(s)`
            : "Hydra estabiliza, mas sem compras precisa competir com payoff melhor",
        details: { projectedDraws, stabilizesBoard },
      }),
    );
  }

  if (
    extraIds.includes(VOID_IDS.BERSERKER) &&
    hasPoly &&
    slayerField &&
    expendableVoids.some((card) => card?.id !== VOID_IDS.SLAYER_BRUTE)
  ) {
    const lethalPotential = oppLP <= 5600;
    const destroyableTargets = countDestroyableByAtk(oppMonsters, 2800);
    let score = 76 + Math.min(destroyableTargets, 2) * 7;
    if (lethalPotential) score += 12;
    if (ravenInHand) score += 3;
    if (oppFieldCount > 0 && destroyableTargets === 0) score -= 9;
    plans.push(
      createFinisherPlan({
        kind: "fusion",
        targetName: "Void Berserker",
        score100: score,
        reason: lethalPotential
          ? "Berserker ameaca lethal com dois ataques"
          : "Berserker remove monstros e habilita bounce de batalha",
        details: { destroyableTargets, lethalPotential },
      }),
    );
  }

  if (extraIds.includes(VOID_IDS.HOLLOW_KING) && hasPoly && hollows.length >= 3) {
    if (shouldReserveForHydra(bot, voids.length)) {
      plans.push(
        createFinisherPlan({
          kind: "fusion",
          targetName: "Void Hollow King",
          score100: 58,
          reason: "Hollow King atrasado: Hydra Titan acessivel em 1-2 turnos",
          details: { reservedForHydra: true },
        }),
      );
    } else {
      const resilienceNeeded =
        oppFieldCount >= 2 || oppStrongest >= 2500 || myLP <= 3000;
      let score = resilienceNeeded ? 82 : 74;
      if (ravenInHand) score += 2;
      if (hasCardId(deck, VOID_IDS.HOLLOW) && hollows.length === 3) score += 2;
      plans.push(
        createFinisherPlan({
          kind: "fusion",
          targetName: "Void Hollow King",
          score100: score,
          reason: resilienceNeeded
            ? "Hollow King e o melhor plano de resiliencia agora"
            : "Hollow King e payoff estavel quando nao ha finisher superior",
          details: { resilienceNeeded },
        }),
      );
    }
  }

  return rankFinisherPlans(plans);
}

export function evaluateVoidFusionPriority(bot) {
  const game = bot?.game || null;
  const opponent =
    bot?.game && typeof bot.game.getOpponent === "function"
      ? bot.game.getOpponent(bot)
      : null;
  const best = getBestFinisherPlan(
    evaluateVoidFinisherPlans(bot, opponent, game),
    "fusion",
  );
  return best
    ? {
        priority: best.actionPriority,
        target: best.targetName,
        reason: best.reason,
        preserveHollowsInGY: best.preserveHollowsInGY,
        plan: best,
      }
    : { priority: 0, target: null };
}

function getStrongestOpponentBattleStat(field = []) {
  return getStrongestBattleStat(field, { facedownValue: 1500 });
}

function hasVoidFaceupNormalSummonValue(card) {
  if (!card || card.cardKind !== "monster") return false;
  if (
    [
      VOID_IDS.ARCTURUS,
      VOID_IDS.CONJURER,
      VOID_IDS.WALKER,
      VOID_IDS.BEAST,
      VOID_IDS.BONE_SPIDER,
      VOID_IDS.TENEBRIS_HORN,
      VOID_IDS.THOUSAND_ARMS,
    ].includes(card.id)
  ) {
    return true;
  }
  return (card.effects || []).some(
    (effect) =>
      effect &&
      (effect.timing === "ignition" ||
        effect.timing === "passive" ||
        (effect.timing === "on_event" &&
          effect.event === "after_summon" &&
          (!effect.summonMethods ||
            effect.summonMethods.includes("normal") ||
            effect.summonMethods.includes("tribute")))),
  );
}
