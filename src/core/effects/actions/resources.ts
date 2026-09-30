import { resolveContextNumber } from "../../actionHandlers/shared.js";
import type {
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  EffectContext,
} from "../../contracts/actionRuntime.js";
import { writeContextValue } from "../../contracts/actionRuntime.js";
import type { ActionOf } from "../../contracts/actions.js";

type ShuffleDeckAction = ActionOf<"shuffle_deck"> & {
  readonly silent?: boolean;
};

type HealAction = ActionOf<"heal"> & {
  readonly cause?: string;
  readonly sourceRect?: unknown;
};

type HealPerArchetypeMonsterAction =
  ActionOf<"heal_per_archetype_monster"> & {
    readonly cause?: string;
    readonly sourceRect?: unknown;
  };

type DamageAction = ActionOf<"damage"> & {
  readonly cause?: string;
  readonly sourceRect?: unknown;
  readonly screenShake?: boolean;
};

type ResourcePlayer = ActionRuntimePlayer & {
  draw(count?: number): ActionRuntimeCard | null;
  gainLP(amount: number, options?: object): unknown;
  takeDamage(amount: number, options?: object): unknown;
};

interface ResourceActionHost {
  game: ActionRuntimeGamePort;

}

/**
 * Resource Actions - draw, heal, damage
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply draw action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether cards were drawn
 */
export function applyDraw(
  this: ResourceActionHost,
  action: ActionOf<"draw">,
  ctx: EffectContext,
): boolean {
  const targetPlayer = (action.player === "opponent"
    ? ctx.opponent
    : ctx.player) as ResourcePlayer;
  const amount = action.amount ?? 1;
  if (this.game && typeof this.game.drawCards === "function") {
    const result = this.game.drawCards(targetPlayer, amount);
    if (ctx && result && Array.isArray(result.drawn)) {
      writeContextValue(ctx, "lastDrawnCards", result.drawn.slice());

      // v3: Emit event for replay capture - track drawn cards from effects
      if (typeof this.game.emit === "function" && result.drawn.length > 0) {
        this.game.emit("cards_added_to_hand", {
          player: targetPlayer,
          cards: result.drawn,
          fromZone: "deck",
          sourceCard: ctx.source,
          effectId: ctx.effect?.id || null,
        });
      }
    }
    return result?.ok || (result?.drawn?.length || 0) > 0;
  }

  for (let i = 0; i < amount; i++) {
    targetPlayer.draw();
  }
  return amount > 0;
}

/**
 * Apply shuffle deck action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether the deck was shuffled
 */
export function applyShuffleDeck(
  this: ResourceActionHost,
  action: ShuffleDeckAction,
  ctx: EffectContext,
): boolean {
  const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
  if (!targetPlayer) return false;

  if (typeof targetPlayer.shuffleDeck === "function") {
    targetPlayer.shuffleDeck();
  } else if (Array.isArray(targetPlayer.deck)) {
    this.game?.shuffle?.(targetPlayer.deck);
  }

  if (!action.silent && this.game?.ui?.log) {
    const ownerLabel = targetPlayer.name || targetPlayer.id || "Player";
    this.game.ui.log(`${ownerLabel} shuffled their Deck.`);
  }

  this.game?.updateBoard?.();
  return true;
}

async function emitLpGainEvent(
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  sourceCard: ActionRuntimeCard | null | undefined,
  before: number,
): Promise<boolean> {
  const gained = Math.max(0, (player?.lp || 0) - before);
  if (gained <= 0) return false;

  const payload = {
    player,
    sourceCard,
    lpGained: gained,
    lpLost: 0,
    lpPaid: 0,
    damageAmount: 0,
    before,
    after: player.lp,
  };

  if (typeof game?.emit === "function") {
    await game.emit("lp_change", payload);
  } else {
    game?.notify?.("lp_change", payload);
  }

  return true;
}

/**
 * Apply heal action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether LP was gained
 */
export async function applyHeal(
  this: ResourceActionHost,
  action: HealAction,
  ctx: EffectContext,
): Promise<boolean> {
  const targetPlayer = (action.player === "opponent"
    ? ctx.opponent
    : ctx.player) as ResourcePlayer;
  let amount = action.amount ?? 0;
  if (action.amountFromContext) {
    amount += resolveContextNumber(action.amountFromContext, ctx);
  }
  amount = Math.floor(Number(amount || 0));
  if (!Number.isFinite(amount)) amount = 0;

  // LP gain multiplier is now handled by Player.gainLP() based on passive effects
  const before = targetPlayer.lp || 0;
  targetPlayer.gainLP(amount, {
    cause: action.cause || "effect",
    sourceCard: ctx.source || null,
    sourceRect: action.sourceRect || ctx?.activationContext?.sourceRect || null,
  });
  await emitLpGainEvent(this.game, targetPlayer, ctx.source, before);
  return amount !== 0;
}

/**
 * Apply heal per archetype monster action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether LP was gained
 */
export async function applyHealPerArchetypeMonster(
  this: ResourceActionHost,
  action: HealPerArchetypeMonsterAction,
  ctx: EffectContext,
): Promise<boolean> {
  const targetPlayer = (action.player === "opponent"
    ? ctx.opponent
    : ctx.player) as ResourcePlayer;
  const archetype = action.archetype;
  const amountPerMonster = action.amountPerMonster ?? 0;

  if (!targetPlayer || amountPerMonster <= 0 || !archetype) return false;

  const count = (targetPlayer.field || []).reduce((acc, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return acc;
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
      ? [card.archetype]
      : [];
    return archetypes.includes(archetype) ? acc + 1 : acc;
  }, 0);

  const totalHeal = count * amountPerMonster;
  if (totalHeal > 0) {
    const before = targetPlayer.lp || 0;
    targetPlayer.gainLP(totalHeal, {
      cause: action.cause || "effect",
      sourceCard: ctx.source || null,
      sourceRect: action.sourceRect || ctx?.activationContext?.sourceRect || null,
    });
    await emitLpGainEvent(this.game, targetPlayer, ctx.source, before);
    console.log(
      `${targetPlayer.id} gained ${totalHeal} LP from ${count} ${archetype} monster(s).`
    );
    return true;
  }

  return false;
}

/**
 * Apply damage action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {Promise<boolean>} Whether damage was dealt
 */
export async function applyDamage(
  this: ResourceActionHost,
  action: DamageAction,
  ctx: EffectContext,
): Promise<boolean> {
  const targetPlayer = (action.player === "self"
    ? ctx.player
    : ctx.opponent) as ResourcePlayer;
  const amount = action.amount ?? 0;

  if (!targetPlayer || amount <= 0) return false;
  const before = targetPlayer.lp;
  if (typeof this.game.inflictDamage === "function") {
    await this.game.inflictDamage(targetPlayer, amount, {
      cause: action.cause || "effect",
      sourceCard: ctx.source || null,
      sourceRect: action.sourceRect || ctx.activationContext?.sourceRect || null,
      screenShake: action.screenShake,
    });
  } else {
    targetPlayer.takeDamage(amount, { cause: action.cause || "effect", screenShake: action.screenShake });
    const lost = Math.max(0, before - targetPlayer.lp);
    if (lost > 0) {
      this.game.notify?.("damage_inflicted", {
        target: targetPlayer, sourceCard: ctx.source, amount: lost, lpLost: lost, newLP: targetPlayer.lp,
      });
      await this.game.emit?.("lp_change", {
        player: targetPlayer, sourceCard: ctx.source, before, after: targetPlayer.lp,
        lpGained: 0, lpLost: lost, lpPaid: 0, damageAmount: lost, damagedPlayer: targetPlayer,
      });
    }
  }
  return targetPlayer.lp < before;
}
