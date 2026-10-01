import { getUI } from "../shared.js";
import type { ActionOf } from "../../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import { readContextValue } from "../../contracts/actionRuntime.js";

type ScheduledSummonAction = ActionOf<"schedule_special_summon">;

function resolveScheduledCard(
  action: ScheduledSummonAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
): ActionRuntimeCard | null {
  const cardRef = action.cardRef || action.targetRef || "self";
  if (cardRef === "self" || cardRef === "source") return ctx?.source || null;
  const target = targets?.[cardRef];
  if (Array.isArray(target)) return target[0] || null;
  return (target ||
    readContextValue(ctx, cardRef) ||
    null) as ActionRuntimeCard | null;
}

function resolvePlayerId(
  rule: string | undefined,
  ctx: EffectContext,
  game: ActionRuntimeGamePort,
) {
  const value = rule || "current";
  if (value === "current" || value === "turn") return game?.turn || null;
  if (value === "self") return ctx?.player?.id || null;
  if (value === "opponent") return ctx?.opponent?.id || null;
  return value;
}

export async function handleScheduleSpecialSummon(
  action: ActionOf<"schedule_special_summon">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
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

  game.scheduleDelayedAction!(
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
          placementActorId: player.id,
          fromZone,
          expectedLocationVersion: card.locationVersion,
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
  action: ActionOf<"abyssal_serpent_delayed_summon">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
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

  const target = targetCards[0]!; // The resolved target array is non-empty above.
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

  const sourceMove = await game.moveCard!(source, player, "graveyard");
  const sourceOwner = sourceMove === false || (typeof sourceMove === "object" && sourceMove?.success === false)
    ? null
    : [game.player, game.bot].find(owner => owner.graveyard.includes(source));
  const sourceSummon = sourceOwner ? {
    card: source,
    owner: sourceOwner.id,
    placementActorId: player.id,
    fromZone: "graveyard",
    expectedLocationVersion: source.locationVersion,
    getsBuffIfTargetWasFusionOrAscension: isFusionOrAscension,
  } : null;
  const targetMove = await game.moveCard!(target, opponent, "graveyard");
  const targetOwner = targetMove === false || (typeof targetMove === "object" && targetMove?.success === false)
    ? null
    : [game.player, game.bot].find(owner => owner.graveyard.includes(target));
  const targetSummon = targetOwner ? {
    card: target,
    owner: targetOwner.id,
    placementActorId: player.id,
    fromZone: "graveyard",
    expectedLocationVersion: target.locationVersion,
    getsBuffIfTargetWasFusionOrAscension: false,
  } : null;

  const summonPayload = {
    summons: [...(sourceSummon ? [sourceSummon] : []), ...(targetSummon ? [targetSummon] : [])],
  };

  if (summonPayload.summons.length === 0) return false;

  ui?.log?.(
    `${summonPayload.summons.map(entry => entry.card.name).join(" and ")} will be Special Summoned during the opponent's next Standby Phase.`,
  );

  const opponentPlayerId =
    opponent.id || (player.id === "player" ? "bot" : "player");

  game.scheduleDelayedAction!(
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
