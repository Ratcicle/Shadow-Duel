/**
 * Movement Actions - card zone movement
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

import { resolveFieldScopeCards } from "../../actionHandlers/shared.js";
import type {
  ActionMoveResult,
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  EffectContext,
  LegacyActionHandlerResult,
  MaybePromise,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import { writeContextValue } from "../../contracts/actionRuntime.js";
import type { ActionOf } from "../../contracts/actions.js";
import type { EffectCondition } from "../../contracts/effects.js";
import type { BattlePosition } from "../../contracts/cards.js";
import type { ZoneInput } from "../../contracts/zones.js";

type MoveAction = ActionOf<"move"> & {
  readonly toZone?: ZoneInput;
  readonly reason?: string;
  readonly position?: "attack" | "defense" | "choice";
};

interface MovementRuntimeCard extends ActionRuntimeCard {
  attacksUsedThisTurn?: number;
}

interface MovementGamePort
  extends Pick<
    ActionRuntimeGamePort,
    "player" | "bot" | "updateBoard" | "checkWinCondition"
  > {
  normalizeCardOwnership?(
    card: ActionRuntimeCard,
    context: EffectContext,
    options?: object,
  ): void;
  chooseSpecialSummonPosition(
    player: ActionRuntimePlayer,
    card: ActionRuntimeCard,
    options?: object,
  ): MaybePromise<string | null | undefined>;
  moveCard(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    destination: ZoneInput,
    options?: object,
  ): MaybePromise<ActionMoveResult | boolean | null | undefined>;
}

interface MovementActionHost {
  game: MovementGamePort;
  readonly ui: { log?(message: string): void } | null;
  getZone(
    player: ActionRuntimePlayer,
    zone: ZoneInput,
  ): ActionRuntimeCard[] | null;
}

interface ControlCardCondition {
  readonly type?: string;
  readonly cardName?: string;
  readonly zone?: ZoneInput;
}

function checkControlCardCondition(
  condition: ControlCardCondition | null | undefined,
  ctx: EffectContext,
): boolean {
  if (!condition || condition.type !== "control_card") return false;

  const player = ctx?.player;
  const cardName = condition.cardName;
  if (!player || !cardName) return false;

  const zoneName = condition.zone || "fieldSpell";
  if (zoneName === "fieldSpell") {
    return player.fieldSpell?.name === cardName;
  }

  const zone = Reflect.get(player, zoneName) || [];
  return Array.isArray(zone) && zone.some((card) => card?.name === cardName);
}

function shouldAllowExtraDeckMonsterToHand(
  action: MoveAction,
  ctx: EffectContext,
): boolean {
  if (action.allowExtraDeckMonsterToHand === true) return true;
  if (action.allowExtraDeckMonsterToHandIf) {
    return checkControlCardCondition(
      action.allowExtraDeckMonsterToHandIf as ControlCardCondition,
      ctx,
    );
  }
  return false;
}

function getContextTargetCards(
  targetRef: string | null | undefined,
  ctx: EffectContext | null | undefined,
): ActionRuntimeCard[] {
  if (!targetRef || !ctx) return [];
  const contextTargets = {
    self: ctx.source,
    source: ctx.source,
    destroyed: ctx.destroyed,
    summonedCard: ctx.summonedCard,
    eventCard: ctx.eventCard,
    changedCard: ctx.changedCard,
    movedCard: ctx.movedCard,
    attacker: ctx.attacker,
    defender: ctx.defender,
    target: ctx.target,
    targetedCard: ctx.targetedCard,
    host: ctx.host,
  };
  const target = Reflect.get(contextTargets, targetRef);
  if (Array.isArray(target)) return target.filter(Boolean);
  return target ? [target as ActionRuntimeCard] : [];
}

function getCardLevelForStorage(card: ActionRuntimeCard): number {
  const level = Number(card?.level ?? 0);
  return Number.isFinite(level) ? level : 0;
}

function storeMoveActionResults(
  action: MoveAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  movedCards: ActionRuntimeCard[],
  levelSum: number,
): void {
  if (!ctx || typeof ctx !== "object") return;

  if (action.storeResultAs) {
    const storedCards = movedCards.slice();
    if (!ctx._actionTargets || typeof ctx._actionTargets !== "object") {
      ctx._actionTargets = {};
    }
    ctx._actionTargets[action.storeResultAs] = storedCards;
    if (targets && typeof targets === "object") {
      targets[action.storeResultAs] = storedCards;
    }
  }

  if (action.storeLevelSumAs) {
    writeContextValue(ctx, action.storeLevelSumAs, levelSum);
  }
}

/**
 * Apply move action - move cards between zones
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {Promise<boolean>} Whether any cards were moved
 */
export async function applyMove(
  this: MovementActionHost,
  action: MoveAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
): Promise<LegacyActionHandlerResult> {
  // Resolve targetRef to get the actual cards
  let targetCards =
    (targets?.[action.targetRef || ""] as MovementRuntimeCard[] | undefined) ||
    [];

  if ((!targetCards || targetCards.length === 0) && action.targetScope) {
    targetCards = Reflect.apply(resolveFieldScopeCards, undefined, [
      action.targetScope,
      ctx,
      this.game,
      { engine: this },
    ]);
  }

  if (!targetCards || targetCards.length === 0) {
    targetCards = getContextTargetCards(action.targetRef, ctx);
  }

  if (!targetCards || targetCards.length === 0) {
    return action.allowEmpty === true;
  }

  const toZone = action.to || action.toZone;
  if (!toZone) {
    console.warn("move action missing destination zone:", action);
    return false;
  }

  let moved = false;
  const movedCards: MovementRuntimeCard[] = [];
  let movedLevelSum = 0;

  for (const card of targetCards) {
    if (
      toZone === "field" &&
      card.summonRestrict === "shadow_heart_invocation_only"
    ) {
      console.log(
        `${card.name} can only be Special Summoned by "Shadow-Heart Invocation".`
      );
      continue;
    }
    if (this.game?.normalizeCardOwnership) {
      this.game.normalizeCardOwnership(card, ctx, {
        action,
        source: ctx?.source,
        contextLabel: "applyMove",
      });
    }
    let destPlayer: ActionRuntimePlayer;
    if (action.player === "self") {
      destPlayer = ctx.player as ActionRuntimePlayer;
    } else if (action.player === "opponent") {
      destPlayer = ctx.opponent as ActionRuntimePlayer;
    } else {
      destPlayer = card.owner === "player" ? this.game.player : this.game.bot;
    }

    const shouldPromptForPosition =
      toZone === "field" &&
      card.cardKind === "monster" &&
      action.preservePosition !== true &&
      this.game &&
      destPlayer === this.game.player &&
      typeof this.game.chooseSpecialSummonPosition === "function";

    const defaultFieldPosition =
      toZone === "field" &&
      card.cardKind === "monster" &&
      action.preservePosition !== true
        ? "attack"
        : null;

    const applyMoveWithPosition = async (
      chosenPosition: string | null | undefined,
    ): Promise<LegacyActionHandlerResult> => {
      const levelBeforeMove = getCardLevelForStorage(card);
      const finalPosition = shouldPromptForPosition
        ? chosenPosition || action.position || defaultFieldPosition || "attack"
        : chosenPosition ?? action.position ?? defaultFieldPosition;
      const isCostMove =
        toZone === "graveyard" &&
        /cost|discard|material|tribute/i.test(
          String(action.contextLabel || action.targetRef || action.reason || ""),
        );
      const contextLabel =
        action.contextLabel || (isCostMove ? "cost" : "applyMove");

      if (this.game && typeof this.game.moveCard === "function") {
        const moveResult = await this.game.moveCard(card, destPlayer, toZone, {
          fromZone: action.fromZone,
          position: finalPosition,
          isFacedown: action.isFacedown,
          resetAttackFlags: action.resetAttackFlags,
          contextLabel,
          sourceCard: ctx?.source || null,
          sourcePlayer: ctx?.player || null,
          effectId: ctx?.effect?.id || null,
          movedByEffect: true,
          skipSendToGraveReplacement: action.skipSendToGraveReplacement,
          skipSendToGraveActionReplacement:
            action.skipSendToGraveActionReplacement,
          awaitCardMovedEvent: true,
          awaitCardToGraveEvent: toZone === "graveyard",
          allowExtraDeckMonsterToHand: shouldAllowExtraDeckMonsterToHand(
            action,
            ctx
          ),
        });
        if (
          typeof moveResult === "object" &&
          moveResult !== null &&
          moveResult.success === false
        ) {
          return;
        }
        if (
          typeof moveResult === "object" &&
          moveResult !== null &&
          moveResult.needsSelection &&
          moveResult.selectionContract
        ) {
          return moveResult;
        }
      } else {
        const fromOwner =
          card.owner === "player" ? this.game.player : this.game.bot;
        const zones = [
          action.fromZone,
          "field",
          "hand",
          "deck",
          "graveyard",
          "spellTrap",
          "extraDeck",
          "banished",
        ].filter((zoneName): zoneName is ZoneInput => Boolean(zoneName));
        for (const zoneName of zones) {
          const arr = this.getZone(fromOwner, zoneName);
          const idx = arr ? arr.indexOf(card) : -1;
          if (arr && idx > -1) {
            arr.splice(idx, 1);
            break;
          }
        }

        const destArr = this.getZone(destPlayer, toZone);
        if (!destArr) {
          console.warn("applyMove: unknown destination zone:", toZone);
          return;
        }

        if (finalPosition) {
          card.position = finalPosition as BattlePosition;
        }
        if (typeof action.isFacedown === "boolean") {
          card.isFacedown = action.isFacedown;
        }
        if (action.resetAttackFlags) {
          card.hasAttacked = false;
          card.cannotAttackThisTurn = false;
          card.attacksUsedThisTurn = 0;
        }

        card.owner = destPlayer.id;
        destArr.push(card);
      }
      movedCards.push(card);
      movedLevelSum += levelBeforeMove;
      moved = true;

      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
      if (this.game && typeof this.game.checkWinCondition === "function") {
        this.game.checkWinCondition();
      }

      if (this.ui?.log) {
        this.ui.log(`${card.name} moved to ${toZone}.`);
      }
    };

    if (shouldPromptForPosition) {
      const positionChoice = this.game.chooseSpecialSummonPosition(
        destPlayer,
        card
      ) as MaybePromise<string | null | undefined>;
      if (
        positionChoice &&
        typeof (positionChoice as PromiseLike<string | null | undefined>)
          .then === "function"
      ) {
        const moveResult = await applyMoveWithPosition(await positionChoice);
        if (
          moveResult &&
          typeof moveResult === "object" &&
          moveResult.needsSelection
        ) return moveResult;
      } else {
        const moveResult = await applyMoveWithPosition(
          positionChoice as string | null | undefined,
        );
        if (
          moveResult &&
          typeof moveResult === "object" &&
          moveResult.needsSelection
        ) return moveResult;
      }
    } else {
      const moveResult = await applyMoveWithPosition(action.position);
      if (
        moveResult &&
        typeof moveResult === "object" &&
        moveResult.needsSelection
      ) return moveResult;
    }
  }
  if (moved) {
    storeMoveActionResults(action, ctx, targets, movedCards, movedLevelSum);
  }
  return moved;
}
