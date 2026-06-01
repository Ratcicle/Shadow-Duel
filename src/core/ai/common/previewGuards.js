export function getActualGame(game) {
  return game?._gameRef || game;
}

export function isPerspectiveSimulation(game) {
  return game?._isPerspectiveState === true;
}

function logPreviewError(error, options = {}) {
  if (!options.debug && !options.bot?.debug) return;
  console.warn(`[${options.debugLabel || "AI Preview"}] Preview failed:`, error);
}

export function canUsePreview(game, previewFn, options = {}) {
  if (isPerspectiveSimulation(game)) return true;
  const actualGame = getActualGame(game);
  if (!actualGame?.effectEngine || typeof previewFn !== "function") return true;

  try {
    const preview = previewFn(actualGame);
    return preview ? preview.ok !== false : true;
  } catch (error) {
    logPreviewError(error, options);
    return false;
  }
}

export function checkOncePerTurnIfRealGame(game, card, player, effect) {
  if (isPerspectiveSimulation(game)) return { ok: true };
  const actualGame = getActualGame(game);
  return (
    actualGame?.effectEngine?.checkOncePerTurn?.(card, player, effect) || {
      ok: true,
    }
  );
}

export function canActivateSpellFromHand(
  game,
  card,
  player,
  activationContext,
  options = {},
) {
  if (isPerspectiveSimulation(game)) return true;
  return canUsePreview(
    game,
    (actualGame) => {
      const effectEngine = actualGame?.effectEngine;
      if (!effectEngine) return true;

      if (typeof effectEngine.canActivate === "function") {
        const check = effectEngine.canActivate(card, player);
        if (check && check.ok === false) return check;
      }

      if (typeof effectEngine.canActivateSpellFromHandPreview !== "function") {
        return true;
      }

      return effectEngine.canActivateSpellFromHandPreview(card, player, {
        activationContext,
      });
    },
    options,
  );
}

export function canActivateMonsterEffect(
  game,
  card,
  player,
  zone,
  activationContext,
  options = {},
) {
  return canUsePreview(
    game,
    (actualGame) =>
      actualGame?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        player,
        zone,
        null,
        { activationContext },
      ),
    options,
  );
}

export function canActivateSpellTrapEffect(
  game,
  card,
  player,
  zone,
  activationContext,
  options = {},
) {
  return canUsePreview(
    game,
    (actualGame) =>
      actualGame?.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        player,
        zone,
        null,
        { activationContext },
      ),
    options,
  );
}

export function canActivateFieldSpellEffect(
  game,
  card,
  player,
  activationContext,
  options = {},
) {
  return canUsePreview(
    game,
    (actualGame) =>
      actualGame?.effectEngine?.canActivateFieldSpellEffectPreview?.(
        card,
        player,
        null,
        { activationContext },
      ),
    options,
  );
}
