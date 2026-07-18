import { getUI } from "./shared.js";

function resolveOwner(game, card, fallbackPlayer = null) {
  if (!game || !card) return fallbackPlayer;
  if (game.player && card.owner === game.player.id) return game.player;
  if (game.bot && card.owner === game.bot.id) return game.bot;
  for (const player of [game.player, game.bot]) {
    if (!player) continue;
    const zones = [
      player.hand,
      player.field,
      player.spellTrap,
      player.graveyard,
      player.extraDeck,
      player.banished,
    ];
    if (zones.some((zone) => Array.isArray(zone) && zone.includes(card))) {
      return player;
    }
    if (player.fieldSpell === card) return player;
  }
  return fallbackPlayer;
}

function resolveZone(game, owner, card) {
  if (!game || !owner || !card) return null;
  if (typeof game.effectEngine?.findCardZone === "function") {
    const zone = game.effectEngine.findCardZone(owner, card);
    if (zone) return zone;
  }
  if (owner.hand?.includes(card)) return "hand";
  if (owner.field?.includes(card)) return "field";
  if (owner.spellTrap?.includes(card)) return "spellTrap";
  if (owner.graveyard?.includes(card)) return "graveyard";
  if (owner.extraDeck?.includes(card)) return "extraDeck";
  if (owner.banished?.includes(card)) return "banished";
  if (owner.fieldSpell === card) return "fieldSpell";
  return null;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function getActivationProtectionSources(game) {
  const sources = [];
  for (const owner of [game?.player, game?.bot]) {
    if (!owner) continue;
    for (const card of owner.field || []) {
      sources.push({ card, owner, zone: "field" });
    }
    if (owner.fieldSpell) {
      sources.push({ card: owner.fieldSpell, owner, zone: "fieldSpell" });
    }
    for (const card of owner.spellTrap || []) {
      sources.push({ card, owner, zone: "spellTrap" });
    }
  }
  return sources;
}

function isPassiveSourceActive(card, effect, passive, sourceZone) {
  if (!card || !effect || effect.timing !== "passive") return false;
  if (effect.requireZone && effect.requireZone !== sourceZone) return false;
  if (passive.requireZone && passive.requireZone !== sourceZone) return false;
  const requireFaceup =
    effect.requireFaceup === true || passive.requireFaceup === true;
  if (requireFaceup && card.isFacedown) return false;
  return true;
}

function cardMentionsAny(card, values) {
  const haystack = `${card?.name || ""}\n${card?.description || ""}`;
  return asArray(values)
    .filter(Boolean)
    .some((value) => haystack.includes(String(value)));
}

function passiveMatchesActivationCard(game, passive, targetCard) {
  if (!targetCard) return false;

  const targetCardKinds = asArray(
    passive.targetCardKinds ||
      passive.targetCardKind ||
      passive.cardKinds ||
      passive.cardKind,
  ).filter(Boolean);
  if (
    targetCardKinds.length > 0 &&
    !targetCardKinds.includes(targetCard.cardKind)
  ) {
    return false;
  }

  const textIncludes = asArray(
    passive.textIncludes ||
      passive.nameOrDescriptionIncludes ||
      passive.textIncludesAny,
  ).filter(Boolean);
  if (textIncludes.length > 0 && !cardMentionsAny(targetCard, textIncludes)) {
    return false;
  }

  const filters = passive.targetFilters || passive.filters || null;
  if (filters && !game.effectEngine?.cardMatchesFilters?.(targetCard, filters)) {
    return false;
  }

  return true;
}

export function isActivationNegationProtected(
  game,
  targetCard,
  activationAttempt,
) {
  if (!game || !targetCard || !activationAttempt) return null;

  for (const source of getActivationProtectionSources(game)) {
    const sourceCard = source.card;
    if (!sourceCard || !Array.isArray(sourceCard.effects)) continue;

    for (const effect of sourceCard.effects) {
      const passive = effect?.passive || {};
      if (passive.type !== "activation_negation_protection") continue;
      if (!isPassiveSourceActive(sourceCard, effect, passive, source.zone)) {
        continue;
      }
      if (!passiveMatchesActivationCard(game, passive, targetCard)) {
        continue;
      }

      const sourceOwner = source.owner;
      const opponent = game.getOpponent?.(sourceOwner) || null;
      const conditions = Array.isArray(effect.conditions)
        ? effect.conditions
        : Array.isArray(passive.conditions)
          ? passive.conditions
          : passive.condition
            ? [passive.condition]
            : [];
      if (conditions.length > 0) {
        const conditionResult = game.effectEngine?.evaluateConditions?.(
          conditions,
          {
            source: sourceCard,
            player: sourceOwner,
            opponent,
            protectedCard: targetCard,
            activationAttempt,
            activationZone: source.zone,
            sourceZone: source.zone,
          },
        );
        if (conditionResult && conditionResult.ok === false) {
          continue;
        }
      }

      return { sourceCard, sourceOwner, effect, passive };
    }
  }

  return null;
}

async function removeNegatedCard(game, card, source, sourcePlayer) {
  if (!game || !card) return false;
  const owner = resolveOwner(game, card, sourcePlayer);
  const zone = resolveZone(game, owner, card);
  if (!owner || !zone) return false;

  if (zone === "field" || zone === "spellTrap" || zone === "fieldSpell") {
    const result = await game.destroyCard(card, {
      cause: "effect",
      sourceCard: source,
      sourcePlayer,
      opponent: sourcePlayer,
      fromZone: zone,
      contextLabel: "negated_activation_destroy",
    });
    return result?.destroyed === true;
  }

  if (zone !== "graveyard" && zone !== "banished") {
    const result = await game.moveCard(card, owner, "graveyard", {
      fromZone: zone,
      contextLabel: "negated_card_to_graveyard",
      wasDestroyed: true,
      destroyCause: "effect",
      destroySource: source,
    });
    return result?.success !== false;
  }

  return false;
}

function markChainLinkNegated(game, context) {
  if (!Array.isArray(game?.chainSystem?.chainStack)) return null;
  const chainSystem = game.chainSystem;
  const linkReference =
    context?.respondingToChainLink ||
    context?.activationAttempt?.linkId ||
    null;
  const link = chainSystem.markChainLinkActivationNegated?.(linkReference, {
    negatedBy: context?.negatedBy || null,
  });
  if (link) {
    context.negatedLink = link;
  }
  return link;
}

function markChainLinkEffectNegated(game, context) {
  if (!Array.isArray(game?.chainSystem?.chainStack)) return null;
  const chainSystem = game.chainSystem;
  const linkReference =
    context?.respondingToChainLink ||
    context?.activationAttempt?.linkId ||
    null;
  const link = chainSystem.markChainLinkEffectNegated?.(linkReference, {
    negatedBy: context?.negatedBy || null,
  });
  if (link) context.effectNegatedLink = link;
  return link;
}

export async function handleNegateActivation(action, ctx, targets, engine) {
  const game = engine?.game;
  const source = ctx?.source || null;
  const player = ctx?.player || null;
  const context = ctx?.activationContext?.context || ctx?.actionContext || {};
  if (!game || !source || !context) return false;

  const activationAttempt = context.activationAttempt || null;
  const targetCard =
    activationAttempt?.card ||
    context.card ||
    context.targetCard ||
    context.sourceCard ||
    null;

  if (!activationAttempt || !targetCard) {
    getUI(game)?.log("No activation to negate.");
    return false;
  }

  const protection = isActivationNegationProtected(
    game,
    targetCard,
    activationAttempt,
  );
  if (protection) {
    context.negationProtected = true;
    context.negationProtectionSource = protection.sourceCard;
    getUI(game)?.log(
      `${targetCard.name}'s activation cannot be negated by ${source.name}.`,
    );
    game.updateBoard?.();
    return true;
  }

  activationAttempt.activationNegated = true;
  context.activationNegated = true;
  context.negatedBy = source;
  markChainLinkNegated(game, context);

  if (action.storeNegatedCardAs) {
    if (!ctx._actionTargets || typeof ctx._actionTargets !== "object") {
      ctx._actionTargets = {};
    }
    ctx._actionTargets[action.storeNegatedCardAs] = [targetCard];
  }
  ctx.negatedActivationCard = targetCard;

  getUI(game)?.log(`${source.name} negated ${targetCard.name}.`);
  game.updateBoard?.();
  return true;
}

export async function handleNegateEffect(action, ctx, targets, engine) {
  const game = engine?.game;
  const source = ctx?.source || null;
  const context = ctx?.activationContext?.context || ctx?.actionContext || {};
  const activationAttempt = context.activationAttempt || null;
  const targetCard =
    activationAttempt?.card ||
    context.card ||
    context.targetCard ||
    context.sourceCard ||
    null;
  if (!game || !source || !activationAttempt || !targetCard) {
    getUI(game)?.log?.("No effect to negate.");
    return false;
  }

  context.effectNegated = true;
  context.effectNegatedBy = source;
  const link = markChainLinkEffectNegated(game, context);
  if (!link) {
    getUI(game)?.log?.("No Chain Link found for effect negation.");
    return false;
  }
  if (action.storeNegatedCardAs) {
    ctx._actionTargets = ctx._actionTargets || {};
    ctx._actionTargets[action.storeNegatedCardAs] = [targetCard];
  }
  ctx.negatedEffectCard = targetCard;
  getUI(game)?.log?.(`${source.name} negated ${targetCard.name}'s effect.`);
  game.updateBoard?.();
  return true;
}

export async function handleNegateSummonOrActivationAndDestroy(
  action,
  ctx,
  targets,
  engine,
) {
  const game = engine?.game;
  const source = ctx?.source || null;
  const player = ctx?.player || null;
  const context = ctx?.activationContext?.context || {};
  if (!game || !source || !context) return false;

  const summonTransaction = context.summonTransaction || null;
  const activationAttempt = context.activationAttempt || null;
  const targetCard =
    summonTransaction?.card ||
    activationAttempt?.card ||
    context.card ||
    context.targetCard ||
    null;

  if (!targetCard) {
    getUI(game)?.log("No summon or activation to negate.");
    return false;
  }

  if (activationAttempt) {
    const protection = isActivationNegationProtected(
      game,
      targetCard,
      activationAttempt,
    );
    if (protection) {
      context.negationProtected = true;
      context.negationProtectionSource = protection.sourceCard;
      getUI(game)?.log(
        `${targetCard.name}'s activation cannot be negated by ${source.name}.`,
      );
      game.updateBoard?.();
      return true;
    }
  }

  if (summonTransaction) {
    const summonId =
      context.summonId ??
      summonTransaction.summonId ??
      null;
    const transaction = game.markSummonNegated?.(summonId, {
      destination: action.negatedSummonDestination || "graveyard",
      destroyed: true,
      sourceCard: source,
      sourcePlayer: player,
      linkId: context.linkId ?? null,
    });
    if (!transaction) {
      getUI(game)?.log?.("No pending Summon found for negation.");
      return false;
    }
    context.summonTransaction = transaction;
    context.summonId = transaction.summonId;
    context.summonNegated = true;
    context.negatedBy = source;
    getUI(game)?.log(`${source.name} negated ${targetCard.name}.`);
    game.updateBoard?.();
    return true;
  }
  if (activationAttempt) {
    activationAttempt.activationNegated = true;
  }
  context.activationNegated = true;
  context.negatedBy = source;

  markChainLinkNegated(game, context);

  await removeNegatedCard(game, targetCard, source, player);
  getUI(game)?.log(`${source.name} negated ${targetCard.name}.`);
  game.updateBoard?.();
  return true;
}
