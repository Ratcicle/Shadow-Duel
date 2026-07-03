import { CARD_KNOWLEDGE, isExtremeDragon } from "./knowledge.js";
import { analyzeDragonState } from "./stateAnalysis.js";
import { getEffectiveAtk } from "../common/cardStats.js";

export const DRAGON_EXTRA_DECK_NAMES = [
  "Tech-Void Dragon",
  "Radiant Cosmic Dragon",
  "Metal Armored Dragon",
  "Rainbow Cosmic Dragon",
];

const CRITICAL_FOLLOW_UP_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Voltaic Dragon",
  "Luminous Dragon",
  "Purified Crystal Dragon",
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Radiant Cosmic Dragon",
  "Rainbow Cosmic Dragon",
]);

const FUSION_PRESERVE_NAMES = [
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Purified Crystal Dragon",
  "Rainbow Cosmic Dragon",
  "Radiant Cosmic Dragon",
  "Metal Armored Dragon",
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
];

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function isFaceupMonster(card) {
  return card?.cardKind === "monster" && !card.isFacedown;
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function countName(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function getCardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function getOpponent(context = {}, player = null) {
  if (context.opponent) return context.opponent;
  const game = context.game?._gameRef || context.game;
  if (!game || !player) return {};
  if (game.bot === player) return game.player || {};
  if (game.player === player) return game.bot || {};
  return game.player || game.bot || {};
}

function getDragonState(context = {}, player = {}, opponent = {}) {
  if (context.dragonState) return context.dragonState;
  if (context.analysis?.dragonState) return context.analysis.dragonState;
  return analyzeDragonState({
    game: context.game?._gameRef || context.game || null,
    bot: player,
    opponent,
    isSimulatedState:
      context.isSimulatedState === true ||
      context.game?._isPerspectiveState === true ||
      !context.game,
  });
}

function cardValue(card, zone = "") {
  const knowledge = CARD_KNOWLEDGE[card?.name] || {};
  let value =
    (knowledge.value || knowledge.priority || 0) +
    (card?.level || 0) * 0.25 +
    Math.max(card?.atk || 0, card?.def || 0) / 1000;

  if (zone === "field") value += 1.5;
  if (CRITICAL_FOLLOW_UP_NAMES.has(card?.name)) value += 8;
  if (isExtremeDragon(card)) value += 60;
  if (card?.monsterType === "fusion" || card?.monsterType === "ascension") value += 45;
  return value;
}

function materialValue(entry = {}, context = {}) {
  let value = cardValue(entry.card, entry.zone);
  const preserveNames = new Set(context.preserveNames || []);
  const preferNames = new Set(context.preferNames || []);
  if (preserveNames.has(entry.card?.name)) value += 30;
  if (preferNames.has(entry.card?.name)) value -= 8;
  return value;
}

function buildFusionMaterialEntries(player = {}) {
  if (Array.isArray(player.materialEntries)) return player.materialEntries;
  const entries = [];
  for (const zone of ["hand", "field"]) {
    const cards = zoneCards(player, zone);
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index];
      if (isDragonMonster(card)) entries.push({ zone, index, card });
    }
  }
  return entries;
}

function selectLowestValue(entries = [], count = 1, context = {}) {
  return entries
    .filter(Boolean)
    .slice()
    .sort(
      (a, b) =>
        materialValue(a, context) - materialValue(b, context) ||
        a.index - b.index,
    )
    .slice(0, count);
}

function getContext(context = {}) {
  const player = context.player || context.bot || context.owner || context.game?.bot || {};
  const game = context.game?._gameRef || context.game || null;
  const opponent = getOpponent(context, player);
  const hand = zoneCards(player, "hand");
  const field = zoneCards(player, "field");
  const graveyard = zoneCards(player, "graveyard");
  const deck = zoneCards(player, "deck");
  const extraDeck = zoneCards(player, "extraDeck");
  const opponentField = zoneCards(opponent, "field");
  const materialEntries =
    context.materialEntries ||
    buildFusionMaterialEntries({
      hand,
      field,
    });
  const dragonState = getDragonState(context, player, opponent);
  const opponentStrongestAtk = opponentField.reduce(
    (max, card) => Math.max(max, getEffectiveAtk(card)),
    0,
  );
  const opponentBackrow =
    zoneCards(opponent, "spellTrap").length +
    (opponent?.fieldSpell ? 1 : 0);
  const attackThreats = opponentField.filter(
    (card) =>
      card?.cardKind === "monster" &&
      !card.isFacedown &&
      card.position !== "defense" &&
      getEffectiveAtk(card) >= 1800,
  );

  return {
    ...context,
    game,
    player,
    bot: player,
    opponent,
    hand,
    field,
    graveyard,
    deck,
    extraDeck,
    opponentField,
    opponentBackrow,
    materialEntries,
    dragonState,
    fieldCapacity: Math.max(0, 5 - field.length),
    opponentStrongestAtk,
    battlePressure:
      opponentField.length * 10 +
      attackThreats.length * 8 +
      (opponentStrongestAtk >= 2400 ? 16 : 0) +
      ((player?.lp || 8000) <= 2500 ? 12 : 0),
    effectPressure:
      opponentBackrow * 8 +
      opponentField.filter((card) => (card?.effects || []).length > 0).length * 10,
  };
}

function hasExtraDeckCard(ctx, name) {
  return hasName(ctx.extraDeck, name) || ctx.allowMissingExtraDeck === true;
}

function getLowGyBuffTargets(ctx) {
  return ctx.graveyard
    .map((card, index) => ({ card, index }))
    .filter(
      ({ card }) =>
        isDragonMonster(card) &&
        (card.level || 0) <= 4 &&
        !["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer"].includes(card.name),
    )
    .sort(
      (a, b) =>
        (b.card?.atk || 0) - (a.card?.atk || 0) ||
        cardValue(a.card, "graveyard") - cardValue(b.card, "graveyard"),
    );
}

function selectTechVoidMaterials(ctx) {
  const voltaic = selectLowestValue(
    ctx.materialEntries.filter((entry) => entry.card?.name === "Voltaic Dragon"),
    1,
    ctx,
  )[0];
  if (!voltaic) return [];

  const lv5 = selectLowestValue(
    ctx.materialEntries.filter(
      (entry) =>
        entry !== voltaic &&
        isDragonMonster(entry.card) &&
        entry.card.name !== "Voltaic Dragon" &&
        (entry.card.level || 0) >= 5,
    ),
    1,
    {
      ...ctx,
      preserveNames: [
        ...(ctx.preserveNames || []),
        "Fire Extreme Dragon",
        "Volcanic Extreme Dragon",
        "Purified Crystal Dragon",
      ],
    },
  )[0];

  return lv5 ? [voltaic, lv5] : [];
}

function scoreTechVoid(ctx) {
  if (!hasExtraDeckCard(ctx, "Tech-Void Dragon")) return null;
  const materials = selectTechVoidMaterials(ctx);
  if (materials.length !== 2) return null;

  const gyBuffTarget = getLowGyBuffTargets(ctx)[0] || null;
  if (!gyBuffTarget) {
    return {
      ok: false,
      fusionName: "Tech-Void Dragon",
      score: 0,
      reason: "Tech-Void has no useful Level 4 or lower GY buff target",
      materialEntries: materials,
    };
  }

  const projectedAtk = 2500 + Math.floor((gyBuffTarget.card.atk || 0) * 0.5);
  const buffChangesCombat =
    ctx.opponentStrongestAtk >= 2500 && projectedAtk > ctx.opponentStrongestAtk;
  const lethal = (ctx.opponent?.lp || 8000) <= projectedAtk;
  const relevantDamage =
    (ctx.opponent?.lp || 8000) <= 3500 ||
    ctx.opponentField.length >= 2 ||
    ctx.opponentStrongestAtk >= 2400;
  const totalVoltaic = countName(
    [...ctx.hand, ...ctx.field, ...ctx.graveyard, ...ctx.deck],
    "Voltaic Dragon",
  );
  const selectedVoltaic = materials.find((entry) => entry.card?.name === "Voltaic Dragon");
  const uniqueVoltaicExtender =
    totalVoltaic <= 1 &&
    selectedVoltaic?.zone === "hand" &&
    ctx.field.some(isFaceupMonster) &&
    ctx.fieldCapacity > 0 &&
    !lethal &&
    !buffChangesCombat &&
    ctx.battlePressure < 38;

  let score = 48;
  if (buffChangesCombat) score += 38;
  if (lethal) score += 28;
  if (relevantDamage) score += 14;
  if (ctx.opponentField.length >= 2) score += 8;
  if (projectedAtk >= 3100) score += 8;
  if (uniqueVoltaicExtender) score -= 75;
  score -= Math.max(0, materials.reduce((sum, entry) => sum + materialValue(entry, ctx), 0) - 18) * 0.6;

  return {
    ok: score >= 70,
    fusionName: "Tech-Void Dragon",
    score,
    priority: 8 + Math.min(6, score / 20),
    reason: buffChangesCombat
      ? "Tech-Void buff changes combat"
      : lethal
        ? "Tech-Void threatens lethal damage"
        : "Tech-Void creates relevant pressure",
    materialEntries: materials,
    gyBuffTarget,
    projectedAtk,
    preserveNames: unique([
      ...FUSION_PRESERVE_NAMES,
      uniqueVoltaicExtender ? "Voltaic Dragon" : null,
      "Luminous Dragon",
    ]),
  };
}

function selectRadiantMaterials(ctx) {
  const luminous = selectLowestValue(
    ctx.materialEntries.filter((entry) => entry.card?.name === "Luminous Dragon"),
    1,
    ctx,
  )[0];
  if (!luminous) return [];

  const others = selectLowestValue(
    ctx.materialEntries.filter(
      (entry) => entry !== luminous && isDragonMonster(entry.card),
    ),
    2,
    {
      ...ctx,
      preserveNames: [
        ...(ctx.preserveNames || []),
        "Voltaic Dragon",
        "Purified Crystal Dragon",
        "Fire Extreme Dragon",
        "Volcanic Extreme Dragon",
      ],
    },
  );
  return others.length === 2 ? [luminous, ...others] : [];
}

function getRadiantRecycleTargets(ctx) {
  const critical = new Set([
    "Solar Eclipse Dragon",
    "Lunar Eclipse Dragon",
    "Stelya, Dragon Tamer",
    "Voltaic Dragon",
    "Luminous Dragon",
  ]);
  return ctx.graveyard
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !critical.has(card?.name))
    .sort(
      (a, b) =>
        cardValue(a.card, "graveyard") - cardValue(b.card, "graveyard") ||
        a.index - b.index,
    );
}

function scoreRadiant(ctx) {
  if (!hasExtraDeckCard(ctx, "Radiant Cosmic Dragon")) return null;
  const materials = selectRadiantMaterials(ctx);
  if (materials.length !== 3) return null;

  const recycleTargets = getRadiantRecycleTargets(ctx);
  const criticalGyCount = ctx.graveyard.filter((card) =>
    ["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer"].includes(card?.name),
  ).length;
  const consumesAllBodies =
    ctx.field.filter((card) => card?.cardKind === "monster").length > 0 &&
    materials.filter((entry) => entry.zone === "field").length >=
      ctx.field.filter((card) => card?.cardKind === "monster").length &&
    ctx.hand.filter(isDragonMonster).length <= materials.filter((entry) => entry.zone === "hand").length;
  const stableBattle =
    ctx.opponentStrongestAtk > 0 &&
    getEffectiveAtk({ atk: 3300 }) >= ctx.opponentStrongestAtk;
  const futureRevive = ctx.graveyard.some(
    (card) => isDragonMonster(card) && card.name !== "Radiant Cosmic Dragon",
  );

  let score = 58;
  if (stableBattle && ctx.opponentStrongestAtk >= 2300) score += 22;
  if (ctx.battlePressure >= 30) score += 18;
  if (recycleTargets.length > 0) score += 14;
  if (futureRevive) score += 8;
  if ((ctx.player?.lp || 8000) <= 3000) score += 8;
  if (criticalGyCount >= 2 && recycleTargets.length === 0 && ctx.battlePressure < 35) score -= 35;
  if (consumesAllBodies && ctx.battlePressure < 35) score -= 18;
  score -= Math.max(0, materials.reduce((sum, entry) => sum + materialValue(entry, ctx), 0) - 28) * 0.45;

  return {
    ok: score >= 72,
    fusionName: "Radiant Cosmic Dragon",
    score,
    priority: 8 + Math.min(6, score / 20),
    reason: stableBattle
      ? "Radiant stabilizes battle and refunds resources"
      : "Radiant converts materials into a resilient boss",
    materialEntries: materials,
    recycleTargets,
    futureRevive,
    preserveNames: unique([
      ...FUSION_PRESERVE_NAMES,
      "Voltaic Dragon",
      "Purified Crystal Dragon",
    ]),
  };
}

export function rankDragonFusionPlans(context = {}) {
  const ctx = getContext(context);
  return [scoreTechVoid(ctx), scoreRadiant(ctx)]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

export function selectDragonFusionPlan(context = {}) {
  const ranked = rankDragonFusionPlans(context);
  const best = ranked.find((plan) => plan.ok);
  return best || ranked[0] || null;
}

function preferenceForEntries(entries = []) {
  return {
    preferredNames: unique(entries.map((entry) => entry.card?.name)),
    preferNames: unique(entries.map((entry) => entry.card?.name)),
    preferredInstanceIds: entries
      .map((entry) => getCardInstanceId(entry.card))
      .filter((id) => id !== null && id !== undefined),
  };
}

function buildPlanTargetPreferences(plan, ctx) {
  const targetPreferences = {};
  if (plan?.fusionName === "Tech-Void Dragon" && plan.gyBuffTarget) {
    targetPreferences.tech_void_banish_target = {
      role: "buff",
      purpose: "combat",
      preferredNames: [plan.gyBuffTarget.card?.name].filter(Boolean),
      preferNames: [plan.gyBuffTarget.card?.name].filter(Boolean),
      preferredInstanceIds: [getCardInstanceId(plan.gyBuffTarget.card)].filter(
        (id) => id !== null && id !== undefined,
      ),
    };
  }
  if (plan?.fusionName === "Radiant Cosmic Dragon") {
    const recycleTargets = plan.recycleTargets || getRadiantRecycleTargets(ctx);
    targetPreferences.radiant_cosmic_recycle_targets = {
      role: "resource_recycle",
      preferredNames: unique(recycleTargets.slice(0, 5).map((entry) => entry.card?.name)),
      preferNames: unique(recycleTargets.slice(0, 5).map((entry) => entry.card?.name)),
      preferredInstanceIds: recycleTargets
        .slice(0, 5)
        .map((entry) => getCardInstanceId(entry.card))
        .filter((id) => id !== null && id !== undefined),
    };
  }
  return targetPreferences;
}

function bestOwnProtectionTargets(ctx) {
  return ctx.field
    .filter((card) => isDragonMonster(card) && !card.isFacedown)
    .sort(
      (a, b) =>
        cardValue(b, "field") - cardValue(a, "field") ||
        getEffectiveAtk(b) - getEffectiveAtk(a),
    );
}

export function buildDragonExtraDeckActionContext(context = {}) {
  const ctx = getContext(context);
  const sourceName =
    context.source?.name ||
    context.sourceCard?.name ||
    context.card?.name ||
    context.action?.cardName ||
    "";
  const effectId =
    context.effect?.id ||
    context.effectId ||
    context.action?.effectId ||
    "";
  const plan =
    context.extraDeckPlan ||
    context.dragonExtraDeckPlan ||
    (sourceName === "Polymerization" ? selectDragonFusionPlan(ctx) : null);

  const targetPreferences = {};
  let fusionPreferences = null;
  let fusionPositions = null;
  let costPreferences = null;

  if (sourceName === "Polymerization" && plan?.ok) {
    const materialPreference = preferenceForEntries(plan.materialEntries);
    fusionPreferences = {
      preferredNames: [plan.fusionName],
      scoresByName: {
        [plan.fusionName]: plan.score,
      },
    };
    fusionPositions = {
      byName: {
        [plan.fusionName]: "attack",
      },
    };
    costPreferences = {
      preferNames: materialPreference.preferNames,
      preserveNames: unique([
        ...(plan.preserveNames || []),
        ...FUSION_PRESERVE_NAMES.filter(
          (name) => !materialPreference.preferNames.includes(name),
        ),
      ]),
      offensivePayoffNames: [plan.fusionName],
    };
    Object.assign(targetPreferences, buildPlanTargetPreferences(plan, ctx));
  }

  if (sourceName === "Tech-Void Dragon" || effectId === "tech_void_fusion_banish_buff") {
    const target = getLowGyBuffTargets(ctx)[0];
    if (target) {
      targetPreferences.tech_void_banish_target = {
        role: "buff",
        purpose: "combat",
        preferredNames: [target.card.name],
        preferNames: [target.card.name],
        preferredInstanceIds: [getCardInstanceId(target.card)].filter(
          (id) => id !== null && id !== undefined,
        ),
      };
    }
  }

  if (sourceName === "Radiant Cosmic Dragon" || effectId === "radiant_cosmic_dragon_fusion_recycle_draw") {
    const recycleTargets = getRadiantRecycleTargets(ctx);
    targetPreferences.radiant_cosmic_recycle_targets = {
      role: "resource_recycle",
      preferredNames: unique(recycleTargets.slice(0, 5).map((entry) => entry.card?.name)),
      preferNames: unique(recycleTargets.slice(0, 5).map((entry) => entry.card?.name)),
      preferredInstanceIds: recycleTargets
        .slice(0, 5)
        .map((entry) => getCardInstanceId(entry.card))
        .filter((id) => id !== null && id !== undefined),
    };
  }

  if (sourceName === "Rainbow Cosmic Dragon" || effectId === "rainbow_cosmic_dragon_protect_dragon") {
    const protectTargets = bestOwnProtectionTargets(ctx);
    targetPreferences.rainbow_cosmic_protection_target = {
      role: "protection",
      preferredNames: unique(protectTargets.slice(0, 4).map((card) => card.name)),
      preferNames: unique(protectTargets.slice(0, 4).map((card) => card.name)),
      preferredInstanceIds: protectTargets
        .slice(0, 4)
        .map(getCardInstanceId)
        .filter((id) => id !== null && id !== undefined),
    };
  }

  return {
    costPreferences,
    targetPreferences,
    fusionPreferences,
    fusionPositions,
    dragonExtraDeckPlan: plan?.ok
      ? {
          fusionName: plan.fusionName,
          score: plan.score,
          reason: plan.reason,
          projectedAtk: plan.projectedAtk,
        }
      : null,
  };
}

function materialEffectActivationCount(game, player, material) {
  const playerId = player?.id || material?.controller || material?.owner || "bot";
  const map =
    game?.materialDuelStats?.[playerId]?.effectActivationsByMaterialId ||
    game?._gameRef?.materialDuelStats?.[playerId]?.effectActivationsByMaterialId;
  if (map?.get && Number.isFinite(material?.id)) return map.get(material.id) || 0;
  const simMap = player?._simMaterialEffectActivationsByMaterialId;
  if (simMap?.get && Number.isFinite(material?.id)) return simMap.get(material.id) || 0;
  return Number(material?.effectActivations || material?.simEffectActivations || 0);
}

function scoreAscensionChoice(choice = {}, context = {}) {
  const ctx = getContext(context);
  const ascension = choice.ascensionCard;
  const material = choice.material;
  if (!ascension || !material) return null;

  if (ascension.name === "Metal Armored Dragon") {
    const defensiveBattle =
      ctx.opponentStrongestAtk >= 1800 ||
      ctx.opponentField.length >= 2 ||
      (ctx.player?.lp || 8000) <= 3000;
    let score = 42;
    if (defensiveBattle) score += 28;
    if ((ctx.player?.lp || 8000) <= 3000) score += 12;
    if (ctx.effectPressure > ctx.battlePressure && ctx.battlePressure < 28) score -= 14;
    if (ctx.hand.some((card) => card?.name === "Polymerization") && ctx.battlePressure < 30) score -= 10;
    return {
      ...choice,
      score,
      ok: score >= 62,
      position: "defense",
      reason: "Metal Armored is a defensive battle wall",
    };
  }

  if (ascension.name === "Rainbow Cosmic Dragon") {
    const activations = materialEffectActivationCount(ctx.game, ctx.player, material);
    const hasProtectionTarget = ctx.field.some(
      (card) => card !== material && isDragonMonster(card) && !card.isFacedown,
    );
    const battleSwing =
      ctx.opponentStrongestAtk > 0 && 3500 >= ctx.opponentStrongestAtk;
    const needsBodies =
      ctx.opponentField.length >= 3 &&
      ctx.field.filter((card) => card?.cardKind === "monster").length <= 2 &&
      ctx.battlePressure < 45;
    let score = 68;
    if (activations >= 3) score += 8;
    if (battleSwing) score += 18;
    if (hasProtectionTarget) score += 12;
    if ((ctx.player?.lp || 8000) <= 3000) score += 8;
    if (needsBodies) score -= 26;
    return {
      ...choice,
      score,
      ok: score >= 76,
      position:
        (ctx.player?.lp || 8000) <= 2500 && ctx.opponentStrongestAtk > 3500
          ? "defense"
          : "attack",
      reason: "Rainbow Cosmic is a final boss payoff",
    };
  }

  return null;
}

export function rankDragonAscensionChoices(choices = [], context = {}) {
  return (choices || [])
    .map((choice) => scoreAscensionChoice(choice, context))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

export function selectDragonAscensionChoice(choices = [], context = {}) {
  const ranked = rankDragonAscensionChoices(choices, context);
  return ranked.find((choice) => choice.ok) || null;
}

export function chooseDragonAscensionPosition({ ascensionCard, material, game, bot, opponent } = {}) {
  const ranked = rankDragonAscensionChoices(
    [{ ascensionCard, material }],
    { game, player: bot, bot, opponent },
  );
  return ranked[0]?.position || ascensionCard?.ascension?.position || "choice";
}
