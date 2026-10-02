import type { CardFilter } from "../../contracts/effects.js";
import type { EventEntityId, TurnCardActivationEntry, TurnCardActivationHistory } from "../../contracts/events.js";
import { matchesCardFilter, type CardFilterView } from "../../effects/filters/cardFilters.js";

interface ActivationHistoryHost {
  turnCounter?: number | undefined;
  cardActivationHistory?: TurnCardActivationHistory | undefined;
}

interface ActivationIdentity {
  chainId?: EventEntityId | null;
  linkId?: EventEntityId | null;
}

/** A stale turn is empty even for headless consumers that advance the counter directly. */
export function getTurnCardActivations(state: ActivationHistoryHost): readonly TurnCardActivationEntry[] {
  const history = state.cardActivationHistory;
  return history && history.turnCounter === (state.turnCounter ?? 0) ? history.entries : [];
}

export function recordTurnCardActivation(state: ActivationHistoryHost, payload: ActivationIdentity & {
  card?: CardFilterView | null;
  player?: { id?: string | null } | null;
}): boolean {
  const card = payload.card;
  const playerId = payload.player?.id;
  if (!card || !playerId || (card.cardKind !== "spell" && card.cardKind !== "trap")) return false;
  const entries = getTurnCardActivations(state);
  const chainId = payload.chainId ?? null, linkId = payload.linkId ?? null;
  if (chainId !== null && linkId !== null && entries.some(entry => entry.chainId === chainId && entry.linkId === linkId)) return false;
  const entry: TurnCardActivationEntry = { chainId, linkId, playerId, card: {
    id: card.id ?? null, name: card.name ?? null, cardKind: card.cardKind,
    originalCardKind: card.originalCardKind ?? null, subtype: card.subtype ?? null,
    type: card.type ?? null, monsterType: card.monsterType ?? null, attribute: card.attribute ?? null,
    archetype: card.archetype ?? null, archetypes: [...(card.archetypes || [])],
    ...(card.level !== undefined ? { level: card.level } : {}),
    ...(card.atk !== undefined ? { atk: card.atk } : {}),
    ...(card.def !== undefined ? { def: card.def } : {}),
  } };
  state.cardActivationHistory = { turnCounter: state.turnCounter ?? 0, entries: [...entries, entry] };
  return true;
}

/** Negating only the effect leaves the card activation in the turn history. */
export function removeNegatedTurnCardActivation(state: ActivationHistoryHost, payload: ActivationIdentity & {
  activationNegated?: boolean;
}): boolean {
  if (payload.activationNegated !== true || payload.chainId == null || payload.linkId == null) return false;
  const entries = getTurnCardActivations(state);
  const remaining = entries.filter(entry => entry.chainId !== payload.chainId || entry.linkId !== payload.linkId);
  if (remaining.length === entries.length) return false;
  state.cardActivationHistory = { turnCounter: state.turnCounter ?? 0, entries: remaining };
  return true;
}

export function countTurnCardActivations(state: ActivationHistoryHost, filters: CardFilter = {}, playerId?: string): number {
  return getTurnCardActivations(state).filter(entry =>
    (!playerId || entry.playerId === playerId) && matchesCardFilter(entry.card, filters)).length;
}
