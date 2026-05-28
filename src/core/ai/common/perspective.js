export function getPerspectivePlayers(state, selfId = "bot") {
  if (selfId === "player") {
    return { self: state.player, opponent: state.bot };
  }
  return { self: state.bot, opponent: state.player };
}

function chooseOtherPlayer(self, candidates = []) {
  return candidates.find((candidate) => candidate && candidate !== self) || null;
}

function byId(player, slot) {
  return !!(
    player &&
    slot &&
    player.id !== undefined &&
    slot.id !== undefined &&
    player.id === slot.id
  );
}

export function resolvePerspectivePlayers(gameOrState, perspectivePlayer) {
  const state = gameOrState || {};
  const playerSlot = state.player || null;
  const botSlot = state.bot || null;
  const candidates = [playerSlot, botSlot].filter(Boolean);

  const finalize = (self, opponent) => {
    const resolvedSelf = self || perspectivePlayer || botSlot || playerSlot || null;
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
    return finalize(botSlot || perspectivePlayer, playerSlot);
  }

  if (typeof state.getOpponent === "function" && perspectivePlayer) {
    return finalize(perspectivePlayer, state.getOpponent(perspectivePlayer));
  }

  if (perspectivePlayer && perspectivePlayer === botSlot) {
    return finalize(botSlot, playerSlot);
  }
  if (perspectivePlayer && perspectivePlayer === playerSlot) {
    return finalize(playerSlot, botSlot);
  }
  if (byId(perspectivePlayer, botSlot)) {
    return finalize(botSlot, playerSlot);
  }
  if (byId(perspectivePlayer, playerSlot)) {
    return finalize(playerSlot, botSlot);
  }

  return finalize(perspectivePlayer || botSlot, playerSlot);
}
