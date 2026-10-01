/**
 * Trigger Counters Module
 * Extracted from EffectEngine.js - field presence and summon type counters
 *
 * All functions assume `this` = EffectEngine instance
 */

import type { SummonMethod } from "../../contracts/summon.js";
import type { FieldPresenceSummonRecord } from "../../contracts/cards.js";
import type {
  TriggerCollectorHost,
  TriggerRuntimeCard,
  TriggerRuntimePlayer,
} from "./runtime.js";

interface SummonCounterPayload {
  readonly card?: TriggerRuntimeCard | null;
  readonly player?: TriggerRuntimePlayer | null;
  readonly method?: SummonMethod | null;
}

/** Narrow shared projections keep factual history usable by runtime and planners. */
export interface FieldPresenceHistoryCard {
  readonly cardKind?: string | null | undefined;
  readonly type?: string | null | undefined;
  readonly isFacedown?: boolean | undefined;
  readonly effectsNegated?: boolean | undefined;
  readonly fieldPresenceId?: string | number | null;
  readonly effects?: readonly {
    readonly timing?: string;
    readonly passive?: {
      readonly type?: string;
      readonly typeName?: string;
      readonly summonMethods?: readonly SummonMethod[];
      readonly countOwner?: "self" | "opponent" | "any" | "both";
    };
  }[];
  fieldPresenceState?: Record<string, number> | null;
  fieldPresenceSummons?: FieldPresenceSummonRecord[];
}

export interface FieldPresenceHistoryPlayer {
  readonly id?: string;
  readonly field?: readonly FieldPresenceHistoryCard[];
  readonly spellTrap?: readonly FieldPresenceHistoryCard[];
  readonly fieldSpell?: FieldPresenceHistoryCard | null;
}

export interface FieldPresenceHistoryState {
  readonly player?: FieldPresenceHistoryPlayer;
  readonly bot?: FieldPresenceHistoryPlayer;
  readonly turnCounter?: number | null;
}

export interface CompletedFieldSummonPayload {
  readonly card?: FieldPresenceHistoryCard | null | undefined;
  readonly player?: { readonly id?: string } | null | undefined;
  readonly method?: SummonMethod | null | undefined;
}

function presenceSources(player: FieldPresenceHistoryPlayer | undefined): FieldPresenceHistoryCard[] {
  return [...(player?.field || []), ...(player?.spellTrap || []), ...(player?.fieldSpell ? [player.fieldSpell] : [])];
}

export function recordFieldPresenceSummon(
  state: FieldPresenceHistoryState,
  payload: CompletedFieldSummonPayload,
): void {
  const card = payload.card;
  const playerId = payload.player?.id;
  if (!card || card.cardKind !== "monster" || card.isFacedown || card.fieldPresenceId == null ||
      (playerId !== "player" && playerId !== "bot") || state.turnCounter == null) return;
  // Only committed field entries are facts; attempted or negated summons are absent.
  if (![state.player, state.bot].some(player => player?.field?.includes(card))) return;
  for (const owner of [state.player, state.bot]) {
    if (!owner || owner.id === playerId) continue;
    for (const source of presenceSources(owner)) {
      if (source === card || source.isFacedown || !source.effects?.some(effect =>
        effect.timing === "passive" && effect.passive?.type === "restrict_opponent_summon_turn_attack")) continue;
      // Negation suppresses application, not the fact that the source was face-up.
      const records = (source.fieldPresenceSummons ||= []);
      if (!records.some(record => record.turn === state.turnCounter && record.targetFieldPresenceId === card.fieldPresenceId)) {
        records.push({ targetFieldPresenceId: card.fieldPresenceId, summoningPlayerId: playerId, turn: state.turnCounter });
      }
    }
  }
}

function recordFieldPresenceTypeSummonCounters(
  state: FieldPresenceHistoryState,
  payload: CompletedFieldSummonPayload,
): void {
  const { card: summonedCard, method } = payload;
  const summoningPlayerId = payload.player?.id;
  if (!summonedCard || summonedCard.cardKind !== "monster" || summonedCard.fieldPresenceId == null ||
      !summonedCard.type || (summoningPlayerId !== "player" && summoningPlayerId !== "bot") ||
      ![state.player, state.bot].some(owner => owner?.field?.includes(summonedCard))) return;
  const isSpecialSummon = method === "special" || method === "ascension" || method === "fusion" || method === "synchro";
  for (const controller of [state.player, state.bot]) {
    for (const source of controller?.field || []) {
      if (source === summonedCard || source.cardKind !== "monster" || source.isFacedown || source.fieldPresenceId == null) continue;
      for (const effect of source.effects || []) {
        const passive = effect.passive;
        if (effect.timing !== "passive" || passive?.type !== "field_presence_type_summon_count_buff" ||
            passive.typeName !== summonedCard.type) continue;
        const methods = passive.summonMethods || ["special"];
        if (methods.includes("special") ? !isSpecialSummon : !methods.some(candidate => candidate === method)) continue;
        const countOwner = passive.countOwner || "self";
        if ((countOwner === "self" && controller?.id !== summoningPlayerId) ||
            (countOwner === "opponent" && controller?.id === summoningPlayerId)) continue;
        const counters = (source.fieldPresenceState ||= {});
        const key = `summon_count_${summonedCard.type}`;
        counters[key] = (counters[key] || 0) + 1;
      }
    }
  }
}

/** Called once after field entry commits, before summon callbacks or triggers. */
export function recordCompletedFieldSummon(
  state: FieldPresenceHistoryState,
  payload: CompletedFieldSummonPayload,
): void {
  recordFieldPresenceSummon(state, payload);
  recordFieldPresenceTypeSummonCounters(state, payload);
}

export function clearFieldPresenceSummonTarget(state: FieldPresenceHistoryState, card: FieldPresenceHistoryCard): void {
  if (card.fieldPresenceId == null) return;
  for (const owner of [state.player, state.bot]) {
    for (const source of presenceSources(owner)) {
      if (source.fieldPresenceSummons?.length) source.fieldPresenceSummons = source.fieldPresenceSummons.filter(
        record => record.targetFieldPresenceId !== card.fieldPresenceId,
      );
    }
  }
}

/**
 * Handle special summon type counters for passive effects
 * Tracks how many monsters of each type have been special summoned
 * @param {Object} payload - The after_summon event payload
 */
export function handleSpecialSummonTypeCounters(
  this: Pick<TriggerCollectorHost, "updatePassiveBuffs">,
  payload: SummonCounterPayload | null | undefined,
): void {
  const { card: summonedCard, player, method } = payload || {};
  if (!summonedCard || method !== "special" || !player) return;

  const typeName = summonedCard.type || null;
  if (!typeName) return;

  const controllerId = player.id || player;
  const fieldCards = player.field || [];

  for (const fieldCard of fieldCards) {
    if (!fieldCard || fieldCard.isFacedown) continue;
    if (fieldCard.cardKind !== "monster") continue;

    const effects = fieldCard.effects || [];
    for (const effect of effects) {
      if (!effect || effect.timing !== "passive") continue;
      const passive = effect.passive;
      if (!passive) continue;
      if (passive.type !== "type_special_summoned_count_buff") continue;
      if (passive.scope !== "card_state") continue; // only per-instance counters

      const passiveType = passive.typeName || passive.monsterType || null;
      if (!passiveType || passiveType !== typeName) continue;

      // Ensure state map and increment
      const state = fieldCard.state || (fieldCard.state = {});
      const map =
        state.specialSummonTypeCount || (state.specialSummonTypeCount = {});
      map[typeName] = (map[typeName] || 0) + 1;
    }
  }

  // Update passives after increment to reflect new buff values
  this.updatePassiveBuffs();
}

/**
 * Assign a unique field presence ID to a card when it enters the field.
 * This ID is used to track counters that should reset when the card leaves and returns.
 * @param {Object} card - The card entering the field
 */
export function assignFieldPresenceId(
  this: Pick<TriggerCollectorHost, "game">,
  card: TriggerRuntimeCard | null | undefined,
): void {
  if (!card) return;

  card.fieldPresenceId =
    this.game?.createDeterministicId?.(`field_presence_${card.id}`) ||
    `field_presence_${card.id}_${card.locationVersion || 0}`;
  card.fieldPresenceSummons = [];

  // Initialize presence-specific state for tracking counters
  if (!card.fieldPresenceState) {
    card.fieldPresenceState = {};
  }
}

/**
 * Clear field presence ID and associated state when a card leaves the field.
 * This ensures counters reset when the card returns to the field later.
 * @param {Object} card - The card leaving the field
 */
export function clearFieldPresenceId(
  card: TriggerRuntimeCard | null | undefined,
): void {
  if (!card) return;

  // Clear presence-specific counters
  if (card.fieldPresenceState) {
    card.fieldPresenceState = null;
  }
  card.fieldPresenceSummons = [];

  // Clear the presence ID
  delete card.fieldPresenceId;
}

/**
 * Handle field-presence-based type summon counters.
 * This tracks how many monsters of a specific type have been Special Summoned
 * WHILE a specific card is face-up on the field.
 * @param {Object} payload - Event payload from after_summon
 */
export function handleFieldPresenceTypeSummonCounters(
  this: Pick<TriggerCollectorHost, "game" | "updatePassiveBuffs">,
  payload: SummonCounterPayload | null | undefined,
): void {
  recordFieldPresenceTypeSummonCounters(this.game, payload || {});
  this.updatePassiveBuffs();
}
