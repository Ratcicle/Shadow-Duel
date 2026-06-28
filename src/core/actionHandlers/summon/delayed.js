import { getUI } from "../shared.js";

function resolveScheduledCard(action, ctx, targets) {
  const cardRef = action.cardRef || action.targetRef || "self";
  if (cardRef === "self" || cardRef === "source") return ctx?.source || null;
  const target = targets?.[cardRef];
  if (Array.isArray(target)) return target[0] || null;
  return target || ctx?.[cardRef] || null;
}

function resolvePlayerId(rule, ctx, game) {
  const value = rule || "current";
  if (value === "current" || value === "turn") return game?.turn || null;
  if (value === "self") return ctx?.player?.id || null;
  if (value === "opponent") return ctx?.opponent?.id || null;
  return value;
}

export async function handleScheduleSpecialSummon(action, ctx, targets, engine) {
  const game = engine?.game;
  const player = ctx?.player;
  const card = resolveScheduledCard(action, ctx, targets);
  const ui = getUI(game);
  if (!game || !player || !card) {
    ui?.log?.("No card available to schedule for Special Summon.");
    return false;
  }

  const owner =
    action.owner === "opponent" || action.summonPlayer === "opponent"
      ? ctx?.opponent
      : player;
  if (!owner) return false;

  const phase = action.phase || action.returnPhase || "end";
  const fromZone = action.fromZone || action.zone || "graveyard";
  const triggerPlayerId = resolvePlayerId(
    action.triggerPlayer || action.player,
    ctx,
    game,
  );
  if (!triggerPlayerId) return false;

  game.scheduleDelayedAction(
    "delayed_summon",
    {
      phase,
      player: triggerPlayerId,
    },
    {
      summons: [
        {
          card,
          owner: owner.id,
          fromZone,
          position: action.position,
          statusesOnSummon: action.statusesOnSummon || null,
          summonMethod: action.summonMethod || "special",
          summonProcedure: action.summonProcedure || null,
        },
      ],
    },
    Number.isFinite(Number(action.priority)) ? Number(action.priority) : 1,
  );

  ui?.log?.(`${card.name} will be Special Summoned during the ${phase} phase.`);
  return true;
}

export async function handleAbyssalSerpentDelayedSummon(
  action,
  ctx,
  targets,
  engine,
) {
  const { player, source } = ctx;
  const game = engine?.game;
  const ui = getUI(game);

  if (!player || !source || !game) {
    return false;
  }

  const targetRef = action.targetRef || "abyssal_target";
  const targetCards = targets?.[targetRef];

  if (!Array.isArray(targetCards) || targetCards.length === 0) {
    ui?.log?.("No target selected for Abyssal Serpent effect.");
    return false;
  }

  const target = targetCards[0];
  const opponent = ctx?.opponent || game.getOpponent?.(player);

  if (!opponent) {
    ui?.log?.("Cannot determine opponent.");
    return false;
  }

  if (!player.field.includes(source)) {
    ui?.log?.("Source card is not on field.");
    return false;
  }

  if (!opponent.field.includes(target)) {
    ui?.log?.("Target card is not on field.");
    return false;
  }

  const isFusionOrAscension =
    target.monsterType === "fusion" || target.monsterType === "ascension";

  await game.moveCard(source, player, "graveyard");
  await game.moveCard(target, opponent, "graveyard");

  ui?.log?.(
    `${source.name} and ${target.name} are sent to the GY. They will be special summoned during the opponent's next Standby Phase.`,
  );

  const summonPayload = {
    summons: [
      {
        card: source,
        owner: "player",
        fromZone: "graveyard",
        getsBuffIfTargetWasFusionOrAscension: isFusionOrAscension,
      },
      {
        card: target,
        owner: "bot",
        fromZone: "graveyard",
        getsBuffIfTargetWasFusionOrAscension: false,
      },
    ],
  };

  const opponentPlayerId =
    opponent.id || (player.id === "player" ? "bot" : "player");

  game.scheduleDelayedAction(
    "delayed_summon",
    {
      phase: "standby",
      player: opponentPlayerId,
    },
    summonPayload,
    1,
  );

  return true;
}

