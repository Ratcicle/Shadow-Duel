import type {
  AiPlayerInput,
  AiStateInput,
  AiStateShape,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";

type PerspectivePlayerInput = AiPlayerInput | SimulatedPlayerState;

interface PerspectiveResolverState extends AiStateInput {
  getOpponent?(player: PerspectivePlayerInput): PerspectivePlayerInput | null;
}

function projectPlayer(
  player: PerspectivePlayerInput | null | undefined,
): SimulatedPlayerState | null {
  return player ? player as SimulatedPlayerState : null;
}

interface PerspectivePair {
  self: SimulatedPlayerState | null;
  opponent: SimulatedPlayerState | null;
}

export function getPerspectivePlayers(
  state: Pick<AiStateShape, "player" | "bot">,
  selfId = "bot",
): { self: SimulatedPlayerState; opponent: SimulatedPlayerState } {
  if (selfId === "player") {
    return { self: state.player, opponent: state.bot };
  }
  return { self: state.bot, opponent: state.player };
}

function chooseOtherPlayer(
  self: SimulatedPlayerState | null | undefined,
  candidates: readonly SimulatedPlayerState[] = [],
): SimulatedPlayerState | null {
  return candidates.find((candidate) => candidate && candidate !== self) || null;
}

function byId(
  player: SimulatedPlayerState | null | undefined,
  slot: SimulatedPlayerState | null | undefined,
): boolean {
  return !!(
    player &&
    slot &&
    player.id !== undefined &&
    slot.id !== undefined &&
    player.id === slot.id
  );
}

export function resolvePerspectivePlayers(
  gameOrState: PerspectiveResolverState | null | undefined,
  perspectivePlayer: PerspectivePlayerInput | null | undefined,
): PerspectivePair {
  const state = gameOrState || {};
  const playerSlot = projectPlayer(state.player);
  const botSlot = projectPlayer(state.bot);
  const projectedPerspective = projectPlayer(perspectivePlayer);
  const candidates = [playerSlot, botSlot].filter(
    (candidate): candidate is SimulatedPlayerState => candidate !== null,
  );

  const finalize = (
    self: SimulatedPlayerState | null | undefined,
    opponent: SimulatedPlayerState | null | undefined,
  ): PerspectivePair => {
    const resolvedSelf = self || projectedPerspective || botSlot || playerSlot || null;
    let resolvedOpponent = opponent || chooseOtherPlayer(resolvedSelf, candidates);
    if (resolvedSelf && resolvedOpponent === resolvedSelf) {
      resolvedOpponent = chooseOtherPlayer(resolvedSelf, candidates);
    }
    return { self: resolvedSelf, opponent: resolvedOpponent || null };
  };

  if (state._isPerspectiveState === true) {
    if (projectedPerspective && projectedPerspective === playerSlot) {
      return finalize(playerSlot, botSlot);
    }
    return finalize(botSlot || projectedPerspective, playerSlot);
  }

  if (typeof state.getOpponent === "function" && perspectivePlayer) {
    return finalize(
      projectedPerspective,
      projectPlayer(state.getOpponent(perspectivePlayer)),
    );
  }

  if (projectedPerspective && projectedPerspective === botSlot) {
    return finalize(botSlot, playerSlot);
  }
  if (projectedPerspective && projectedPerspective === playerSlot) {
    return finalize(playerSlot, botSlot);
  }
  if (byId(projectedPerspective, botSlot)) {
    return finalize(botSlot, playerSlot);
  }
  if (byId(projectedPerspective, playerSlot)) {
    return finalize(playerSlot, botSlot);
  }

  return finalize(projectedPerspective || botSlot, playerSlot);
}
