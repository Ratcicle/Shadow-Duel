import { getUI } from "../shared.js";

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

