import type { CollectedTriggerEventMap } from "../../../contracts/events.js";
import type { CardAction } from "../../../contracts/actions.js";
import type {
  TriggerCollectorHost,
  TriggerContext,
  TriggerEntry,
  TriggerPackage,
  TriggerRuntimeCard,
  TriggerRuntimePlayer,
  TriggerZone,
} from "../runtime.js";
import { debugTriggerLog } from "./shared.js";
import { walkActionList } from "../../../actionHandlers/actionWalker.js";

function getParticipantZone(
  engine: TriggerCollectorHost,
  owner: TriggerRuntimePlayer | null | undefined,
  card: TriggerRuntimeCard | null | undefined,
): TriggerZone {
  if (!owner || !card) return null;
  return engine.findCardZone?.(owner, card) || null;
}

function getBattleOpponent(
  ctx: TriggerContext | null | undefined,
  sourceCard: TriggerRuntimeCard | null | undefined,
): TriggerRuntimeCard | null {
  if (!ctx || !sourceCard) return null;
  if (sourceCard === ctx.attacker) return ctx.defender || ctx.target || null;
  if (sourceCard === (ctx.defender || ctx.target)) return ctx.attacker || null;
  return null;
}

function isFieldFaceupMonster(
  owner: TriggerRuntimePlayer | null | undefined,
  card: TriggerRuntimeCard | null | undefined,
): boolean {
  return Boolean(
    owner &&
    card &&
    Array.isArray(owner.field) &&
    owner.field.includes(card) &&
    card.cardKind === "monster" &&
    card.isFacedown !== true
  );
}

function actionUsesBattleOpponent(
  actions: readonly CardAction[] = [],
): boolean {
  return walkActionList(actions).visits.some(
    ({ action }) =>
      action != null &&
      typeof action === "object" &&
      Reflect.get(action, "targetRef") === "battle_opponent",
  );
}

/**
 * Collects trigger entries for the end of a completed monster battle.
 * Sources are the original battle participants, even if one has left the field.
 */
export async function collectBattleCompletedTriggers(
  this: TriggerCollectorHost,
  payload: CollectedTriggerEventMap["battle_completed"],
): Promise<TriggerPackage> {
  const entries: TriggerEntry[] = [];
  const orderRule =
    "attacker owner -> defender owner; sources: original battle participants";

  if (
    !payload ||
    !payload.attacker ||
    !payload.defender ||
    !payload.attackerOwner ||
    !payload.defenderOwner
  ) {
    return { entries, orderRule };
  }

  const attacker = payload.attacker;
  const defender = payload.defender;
  const attackerOwner = payload.attackerOwner;
  const defenderOwner = payload.defenderOwner;
  const actionContext = payload?.actionContext || null;
  const participants = [
    { card: attacker, owner: attackerOwner, other: defenderOwner },
    { card: defender, owner: defenderOwner, other: attackerOwner },
  ];
  const processed = new Set<TriggerRuntimeCard>();

  for (const participant of participants) {
    const card = participant.card;
    const owner = participant.owner;
    if (!card || !owner || processed.has(card)) continue;
    processed.add(card);
    if (!Array.isArray(card.effects)) continue;

    const sourceZone = getParticipantZone(this, owner, card);
    const ctx: TriggerContext = {
      source: card,
      player: owner,
      opponent: participant.other,
      attacker,
      defender,
      target: defender,
      attackerOwner,
      defenderOwner,
      targetOwner: defenderOwner,
      damageDealt: payload.damageDealt || 0,
      targetDestroyed: payload.targetDestroyed === true,
      attackerDestroyed: payload.attackerDestroyed === true,
      actionContext,
    };

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "battle_completed") continue;

      if (
        effect.requireFaceup === true &&
        sourceZone === "field" &&
        card.isFacedown === true
      ) {
        continue;
      }

      if (effect.requireZone && effect.requireZone !== sourceZone) {
        continue;
      }

      if (effect.requireSelfBattled && card !== attacker && card !== defender) {
        continue;
      }
      if (effect.requireSelfAsAttacker && card !== attacker) {
        continue;
      }
      if (effect.requireSelfAsDefender && card !== defender) {
        continue;
      }
      if (effect.requireSelfDestroyedByBattle === true) {
        const selfDestroyed =
          (card === attacker && payload.attackerDestroyed === true) ||
          (card === defender && payload.targetDestroyed === true);
        if (!selfDestroyed) {
          continue;
        }
      }

      if (actionUsesBattleOpponent(effect.actions || [])) {
        const battleOpponent = getBattleOpponent(ctx, card);
        const battleOpponentOwner =
          battleOpponent === attacker ? attackerOwner : defenderOwner;
        if (!isFieldFaceupMonster(battleOpponentOwner, battleOpponent)) {
          continue;
        }
      }

      const optCheck = this.checkOncePerTurn(card, owner, effect);
      if (!optCheck.ok) {
        debugTriggerLog(this, optCheck.reason);
        continue;
      }

      const duelCheck = this.checkOncePerDuel(card, owner, effect);
      if (!duelCheck.ok) {
        debugTriggerLog(this, duelCheck.reason);
        continue;
      }

      const activationContext = this.buildTriggerActivationContext(
        card,
        owner,
        sourceZone || "graveyard",
      );
      const entry = this.buildTriggerEntry({
        sourceCard: card,
        owner,
        effect,
        ctx,
        activationContext,
        selectionKind: "triggered",
        selectionMessage: "Select target(s) for the triggered effect.",
      });

      if (entry) entries.push(entry);
    }
  }

  return { entries, orderRule };
}
