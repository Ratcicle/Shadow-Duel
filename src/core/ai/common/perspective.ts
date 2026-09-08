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
  const playerSlot = (state.player || null) as SimulatedPlayerState | null;
  const botSlot = (state.bot || null) as SimulatedPlayerState | null;
  const candidates = [playerSlot, botSlot].filter(Boolean) as SimulatedPlayerState[];

  const finalize = (
    self: SimulatedPlayerState | null | undefined,
    opponent: SimulatedPlayerState | null | undefined,
  ): PerspectivePair => {
    const resolvedSelf = self || perspectivePlayer as SimulatedPlayerState || botSlot || playerSlot || null;
    let resolvedOpponent = opponent || chooseOtherPlayer(resolvedSelf, candidates);
    if (resolvedSelf && resolvedOpponent === resolvedSelf) {
      resolvedOpponent = chooseOtherPlayer(resolvedSelf, candidates);
    }
    return { self: resolvedSelf, opponent: resolvedOpponent || null };
  };

  if (state._isPerspectiveState === true) {
    if (perspectivePlayer && perspectivePlayer === playerSlot) {
      return finalize(playerSlot, botSlot);
    }
    return finalize(botSlot || perspectivePlayer as SimulatedPlayerState, playerSlot);
  }

  if (typeof state.getOpponent === "function" && perspectivePlayer) {
    return finalize(perspectivePlayer as SimulatedPlayerState, state.getOpponent(perspectivePlayer) as SimulatedPlayerState | null);
  }

  if (perspectivePlayer && perspectivePlayer === botSlot) {
    return finalize(botSlot, playerSlot);
  }
  if (perspectivePlayer && perspectivePlayer === playerSlot) {
    return finalize(playerSlot, botSlot);
  }
  if (byId(perspectivePlayer as SimulatedPlayerState, botSlot)) {
    return finalize(botSlot, playerSlot);
  }
  if (byId(perspectivePlayer as SimulatedPlayerState, playerSlot)) {
    return finalize(playerSlot, botSlot);
  }

  return finalize(perspectivePlayer as SimulatedPlayerState || botSlot, playerSlot);
}
