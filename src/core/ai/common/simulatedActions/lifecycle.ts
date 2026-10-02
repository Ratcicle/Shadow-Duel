import { expireEffectNegation } from "../../../effects/negation.js";
import { removeTrackedStatChange } from "../../../effects/actions/stats.js";
import { restoreTemporaryStatuses } from "../../../Card.js";
import { SUMMON_METHODS } from "../../../contracts/summon.js";
import { normalizeZoneInput } from "../../../contracts/zones.js";
import { establishProperSummon } from "../../../game/summon/eligibility.js";
import { canSimulatedProcedureEnterField, canSimulatedSpecialSummon } from "../simulation.js";
import { getZoneCards, moveCardToZone, refreshSimulatedFieldAuras, refreshSimulatedFieldPresenceTypeSummonBuffs } from "../zones.js";
import { applySummonState, recordCompletedSimulatedSummon } from "./shared.js";
import { destroySimulatedCard } from "./destruction.js";
import type { SimulatedCardState } from "../../../contracts/aiState.js";
import type { CardProtectionEffect } from "../../../contracts/cards.js";
import type { SimulatedActionOptions, SimulatedRuntimeState } from "./shared.js";

/** Resolve only this phase's scheduled entries; each action observes prior events. */
export function processSimulatedDelayedActions(
  state: SimulatedRuntimeState,
  phase: string,
  activePlayerId: string,
  options: SimulatedActionOptions = {},
): void {
  const scheduled = (state.delayedActions || []).filter(entry =>
    entry.triggerCondition.phase === phase && entry.triggerCondition.player === activePlayerId,
  ).sort((left, right) => right.priority - left.priority);
  for (const entry of scheduled) {
    // Consume before emitting events so a recursive phase callback cannot replay it.
    state.delayedActions = (state.delayedActions || []).filter(candidate => candidate !== entry);
    if (entry.actionType === "delayed_destroy") {
      const { card, sourceCard, sourcePlayer } = entry.payload;
      const players = [state.bot, state.player];
      const owner = players.find(player => player.id === entry.payload.owner);
      if (!owner?.field.includes(card)) continue;
      if (!sourcePlayer || !players.includes(sourcePlayer)) {
        state._simUnsupportedActions ??= [];
        state._simUnsupportedActions.push("delayed_destroy_source_player");
        continue;
      }
      destroySimulatedCard(card, owner, sourcePlayer, state, { ...options, sourceCard });
      continue;
    }
    for (const summon of entry.payload.summons) {
      const owner = [state.bot, state.player].find(player => player.id === summon.owner);
      const opponent = owner === state.bot ? state.player : state.bot;
      const card = summon.card;
      const fromZone = normalizeZoneInput(summon.fromZone);
      const method = SUMMON_METHODS.find(value => value === summon.summonMethod);
      if (!method) {
        state._simUnsupportedActions ??= [];
        state._simUnsupportedActions.push("delayed_summon_method");
        continue;
      }
      if (!owner || !getZoneCards(owner, fromZone).includes(card) ||
          (card.locationVersion || 0) !== summon.expectedLocationVersion) continue;
      if (!canSimulatedSpecialSummon(card, owner, summon.summonProcedure || method, fromZone) ||
          !canSimulatedProcedureEnterField(card, owner, opponent, [])) continue;
      if (!moveCardToZone(owner, card, "field", owner, { state })) continue;
      card.owner = owner.id;
      card.controller = owner.id;
      applySummonState(card, {
        ...(summon.position ? { position: summon.position } : {}),
        ...(summon.statusesOnSummon ? { statusesOnSummon: summon.statusesOnSummon } : {}),
      }, state, owner, options);
      card.lastSummonMethod = method;
      card.lastSummonedFromZone = fromZone;
      card.lastSummonProcedure = summon.summonProcedure;
      card.lastSummonedTurn = state.turnCounter;
      establishProperSummon(card, { summonProcedure: summon.summonProcedure || method, fromZone });
      recordCompletedSimulatedSummon(state, { card, player: owner, method });
      options.emitSimulatedEvent?.("after_summon", { card, player: owner, method, fromZone,
        summonProcedure: summon.summonProcedure, sourceCard: card });
      options.emitSimulatedEvent?.("card_moved", { card, player: owner, fromZone, toZone: "field", movedByEffect: true });
      if (summon.getsBuffIfTargetWasFusionOrAscension && card.cardKind === "monster") {
        card.atk = (card.atk || 0) + 800;
        card.turnBasedBuffs ??= [];
        card.turnBasedBuffs.push({ stat: "atk", value: 800, expiresOnTurn: (state.turnCounter || 0) + 1 });
      }
    }
  }
}

/** End Phase cleanup does not advance turnCounter or remove next-turn effects. */
export function cleanupSimulatedEndTurn(state: SimulatedRuntimeState): void {
  for (const player of [state.bot, state.player]) {
    for (const card of [...player.field, ...player.spellTrap, ...(player.fieldSpell ? [player.fieldSpell] : [])]) {
      card.fieldPresenceSummons = [];
      expireEffectNegation(card, "until_end_turn");
    }
    for (const card of player.field) {
      if (card.tempAtkBoost) { removeTrackedStatChange(card, "atk", card.tempAtkBoost); card.tempAtkBoost = 0; }
      if (card.tempDefBoost) { removeTrackedStatChange(card, "def", card.tempDefBoost); card.tempDefBoost = 0; }
      delete card.temporarySuppressedDynamicBuffStatsByKey;
      if (card.originalAtk != null) { card.atk = card.originalAtk; card.originalAtk = null; }
      if (card.originalDef != null) { card.def = card.originalDef; card.originalDef = null; }
      if (card.originalLevel != null) { card.level = card.originalLevel; card.originalLevel = null; }

      card.tempBattleIndestructible = false;
      card.battleDamageHealsControllerThisTurn = false;
      card.canAttackDirectlyThisTurn = false;
      delete card.attackLimitThisTurn;
      delete card.attackLimitDuration;
      card.extraAttackTargetRestriction = card.baseExtraAttackTargetRestriction || null;
      delete card.passiveExtraAttackTargetRestriction;
      delete card.canAttackAllOpponentMonstersThisTurn;
      delete card.attackedMonstersThisTurn;
      restoreTemporaryStatuses(card);
    }
    for (const card of player.hand) {
      if (card.originalLevel != null) { card.level = card.originalLevel; card.originalLevel = null; }
    }
    player.forbidDirectAttacksThisTurn = false;
    player.directAttacksDeclaredThisTurn = 0;
  }
  refreshSimulatedFieldPresenceTypeSummonBuffs(state);
  refreshSimulatedFieldAuras(state);
}

/** Same inclusive expiry boundary as runtime startTurn's cleanup passes. */
export function cleanupExpiredSimulatedTurnEffects(state: SimulatedRuntimeState): void {
  const currentTurn = state.turnCounter || 0;
  const expired = (entry: { expiresOnTurn?: number | null }) =>
    typeof entry.expiresOnTurn === "number" && Number.isFinite(entry.expiresOnTurn) && currentTurn > entry.expiresOnTurn;
  for (const player of [state.bot, state.player]) {
    for (const card of player.field) {
      for (const buff of card.turnBasedBuffs || []) {
        if (!expired(buff)) continue;
        if (buff.stat === "atk") removeTrackedStatChange(card, "atk", buff.value);
        else removeTrackedStatChange(card, "def", buff.value);
      }
      if (card.turnBasedBuffs) card.turnBasedBuffs = card.turnBasedBuffs.filter(entry => !expired(entry));
      if (card.protectionEffects) card.protectionEffects = card.protectionEffects.filter(entry => !expired(entry));
    }
    if (player.specialSummonRestrictions) player.specialSummonRestrictions = player.specialSummonRestrictions.filter(entry => entry.duration !== "until_end_turn" || !expired(entry));
    if (player.effectActivationRestrictions) player.effectActivationRestrictions = player.effectActivationRestrictions.filter(entry => entry.duration !== "until_end_turn" || !expired(entry));
  }
}

export function hasSimulatedProtection(
  card: Pick<SimulatedCardState, "protectionEffects" | "isFacedown"> | null | undefined,
  type: CardProtectionEffect["type"],
  turnCounter: number,
  context: { ownerId?: string; sourceOwnerId?: string } = {},
): boolean {
  return card?.protectionEffects?.some(entry => {
    if (entry.type !== type) return false;
    const scope = entry.sourceOwner || "any";
    if (scope !== "any") {
      if (!context.ownerId || !context.sourceOwnerId) return false;
      if ((scope === "self") !== (context.ownerId === context.sourceOwnerId)) return false;
    }
    if (entry.duration === "while_faceup") return !card.isFacedown;
    if (typeof entry.expiresOnTurn === "number" && Number.isFinite(entry.expiresOnTurn)) return turnCounter <= entry.expiresOnTurn;
    if (entry.duration === "end_of_turn") return turnCounter === entry.grantedOnTurn;
    return typeof entry.duration !== "number" || turnCounter <= entry.duration;
  }) || false;
}
