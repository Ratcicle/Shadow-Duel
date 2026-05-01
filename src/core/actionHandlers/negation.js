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

  const summonAttempt = context.summonAttempt || null;
  const activationAttempt = context.activationAttempt || null;
  const targetCard =
    summonAttempt?.card ||
    activationAttempt?.card ||
    context.card ||
    context.targetCard ||
    null;

  if (!targetCard) {
    getUI(game)?.log("No summon or activation to negate.");
    return false;
  }

  if (summonAttempt) {
    summonAttempt.negated = true;
  }
  if (activationAttempt) {
    activationAttempt.negated = true;
  }
  context.negated = true;
  context.negatedBy = source;

  if (Array.isArray(game.chainSystem?.chainStack)) {
    const link = game.chainSystem.chainStack.find(
      (candidate) => candidate?.card === targetCard,
    );
    if (link) {
      link.negated = true;
      context.negatedLink = link;
    }
  }

  await removeNegatedCard(game, targetCard, source, player);
  getUI(game)?.log(`${source.name} negated ${targetCard.name}.`);
  game.updateBoard?.();
  return true;
}
