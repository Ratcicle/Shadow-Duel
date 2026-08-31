import type { AIActivationContext } from "../../contracts/ai.js";
import type { CanonicalZone } from "../../contracts/zones.js";

export interface PreviewGuardResult {
  readonly ok?: boolean;
  readonly reason?: string;
}

type PreviewEvaluation = PreviewGuardResult | boolean | null | undefined;

interface PreviewEffectEnginePort {
  canActivate?(card: unknown, player: unknown): PreviewGuardResult | null;
  checkOncePerTurn?(
    card: unknown,
    player: unknown,
    effect: unknown,
  ): PreviewGuardResult | null;
  canActivateSpellFromHandPreview?(
    card: unknown,
    player: unknown,
    options?: unknown,
  ): PreviewEvaluation;
  canActivateMonsterEffectPreview?(
    card: unknown,
    player: unknown,
    zone: CanonicalZone,
    selections?: unknown,
    options?: unknown,
  ): PreviewEvaluation;
  canActivateSpellTrapEffectPreview?(
    card: unknown,
    player: unknown,
    zone: CanonicalZone,
    selections?: unknown,
    options?: unknown,
  ): PreviewEvaluation;
  canActivateFieldSpellEffectPreview?(
    card: unknown,
    player: unknown,
    selections?: unknown,
    options?: unknown,
  ): PreviewEvaluation;
}

export interface PreviewGamePort {
  readonly _gameRef?: PreviewGamePort | null;
  readonly _isPerspectiveState?: boolean;
  readonly effectEngine?: PreviewEffectEnginePort | null;
}

export interface PreviewGuardOptions {
  readonly debug?: boolean;
  readonly bot?: { readonly debug?: boolean } | null;
  readonly debugLabel?: string;
}

export function getActualGame(
  game: unknown,
): PreviewGamePort | null | undefined {
  return (
    (game as PreviewGamePort | null | undefined)?._gameRef ||
    (game as PreviewGamePort | null | undefined)
  );
}

export function isPerspectiveSimulation(
  game: unknown,
): boolean {
  return (game as PreviewGamePort | null | undefined)?._isPerspectiveState === true;
}

function logPreviewError(
  error: unknown,
  options: PreviewGuardOptions = {},
): void {
  if (!options.debug && !options.bot?.debug) return;
  console.warn(`[${options.debugLabel || "AI Preview"}] Preview failed:`, error);
}

export function canUsePreview(
  game: unknown,
  previewFn: (actualGame: PreviewGamePort) => PreviewEvaluation,
  options: PreviewGuardOptions = {},
): boolean {
  if (isPerspectiveSimulation(game)) return true;
  const actualGame = getActualGame(game);
  if (!actualGame?.effectEngine || typeof previewFn !== "function") return true;

  try {
    const preview = previewFn(actualGame);
    return preview ? (preview as PreviewGuardResult).ok !== false : true;
  } catch (error) {
    logPreviewError(error, options);
    return false;
  }
}

export function checkOncePerTurnIfRealGame(
  game: unknown,
  card: unknown,
  player: unknown,
  effect: unknown,
): PreviewGuardResult {
  if (isPerspectiveSimulation(game)) return { ok: true };
  const actualGame = getActualGame(game);
  return (
    actualGame?.effectEngine?.checkOncePerTurn?.(card, player, effect) || {
      ok: true,
    }
  );
}

export function canActivateSpellFromHand(
  game: unknown,
  card: unknown,
  player: unknown,
  activationContext: AIActivationContext | null | undefined,
  options: PreviewGuardOptions = {},
): boolean {
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
  game: unknown,
  card: unknown,
  player: unknown,
  zone: CanonicalZone,
  activationContext: AIActivationContext | null | undefined,
  options: PreviewGuardOptions = {},
): boolean {
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
  game: unknown,
  card: unknown,
  player: unknown,
  zone: CanonicalZone,
  activationContext: AIActivationContext | null | undefined,
  options: PreviewGuardOptions = {},
): boolean {
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
  game: unknown,
  card: unknown,
  player: unknown,
  activationContext: AIActivationContext | null | undefined,
  options: PreviewGuardOptions = {},
): boolean {
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
