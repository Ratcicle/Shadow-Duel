import type { FieldSlot, FieldPlacementRequest, FieldPlacementResult, FieldPlacementPreparation, PlacementRow, PrepareFieldPlacementOptions } from "../../contracts/placement.js";
import type { FullGameHost } from "../../contracts/gameRuntime.js";
import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";

export const FIELD_SLOTS: readonly FieldSlot[] = Object.freeze([0, 1, 2, 3, 4]);

interface PositionedCard {
  fieldSlot?: FieldSlot | null;
}

export function isFieldSlot(value: unknown): value is FieldSlot {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 5;
}

/** Occupancy derives only from canonical card positions, never list order. */
export function getAvailableFieldSlots(cards: readonly PositionedCard[]): FieldSlot[] {
  const occupied = new Set<FieldSlot>();
  for (const card of cards) {
    if (!isFieldSlot(card.fieldSlot) || occupied.has(card.fieldSlot)) {
      throw new Error("Invalid or duplicate canonical field position.");
    }
    occupied.add(card.fieldSlot);
  }
  return FIELD_SLOTS.filter(slot => !occupied.has(slot));
}

/** Used by setup/simulation; live placements obtain their choice from the broker. */
export function assignAutomaticFieldSlot(card: PositionedCard, cards: readonly PositionedCard[]): FieldSlot | null {
  const slot = getAvailableFieldSlots(cards.filter(occupant => occupant !== card))[0] ?? null;
  if (slot !== null) card.fieldSlot = slot;
  return slot;
}

export function clearFieldSlot(card: PositionedCard): void {
  card.fieldSlot = null;
}

/** Flip attempts retain the already occupied space while the card is in transit. */
export function getFieldOccupants(game: Pick<FullGameHost, "activeSummonTransaction">, player: GamePlayer, row: PlacementRow): GameCard[] {
  const cards = [...player[row]];
  const transaction = game.activeSummonTransaction;
  if (row === "field" && transaction?.summonMethod === "flip" && transaction.controller === player && transaction.card && !cards.includes(transaction.card) && isFieldSlot(transaction.card.fieldSlot)) {
    cards.push(transaction.card);
  }
  return cards;
}

export function validateFieldPlacementResult(value: unknown, request: FieldPlacementRequest): FieldPlacementResult {
  if (typeof value !== "object" || value === null) throw new Error("Invalid field placement result.");
  const outcome: unknown = Reflect.get(value, "outcome");
  if (outcome === "cancelled" && request.allowCancel) return { outcome: "cancelled" };
  const slot: unknown = Reflect.get(value, "slot");
  if (outcome === "chosen" && isFieldSlot(slot) && request.candidates.some(candidate => candidate.slot === slot)) return { outcome: "chosen", slot };
  throw new Error("Field placement result is not a legal choice.");
}

export async function prepareFieldPlacement(
  this: FullGameHost,
  card: GameCard,
  destination: GamePlayer,
  row: PlacementRow,
  options: PrepareFieldPlacementOptions = {},
): Promise<FieldPlacementPreparation> {
  const generation = this.fieldPlacementGeneration;
  if (this.isDisposed() || (options.intent && options.intent.generation !== generation)) {
    throw new Error("Field placement belongs to an ended duel.");
  }
  const slots = getAvailableFieldSlots(getFieldOccupants(this, destination, row).filter(occupant => occupant !== card));
  if (slots.length === 0) return { outcome: "unavailable" };
  const duelCardId = this.ensureDuelCardId(card);
  const previous = options.intent;
  if (previous && previous.duelCardId === duelCardId && previous.destinationPlayerId === destination.id && previous.row === row && slots.includes(previous.slot)) {
    return { outcome: "chosen", intent: previous };
  }
  const actor = options.actor || destination;
  const sequence = (this.generatedIdCounters.get("field_placement") || 0) + 1;
  this.generatedIdCounters.set("field_placement", sequence);
  const context = {
    procedureId: `field_placement_${sequence}`,
    decidingPlayerId: actor.id,
    destinationPlayerId: destination.id,
    row,
    duelCardId,
    allowCancel: !previous && options.allowCancel === true,
  };
  const candidates = slots.map(slot => ({ candidateKey: `${destination.id}:${row}:${slot}`, slot }));
  const request: FieldPlacementRequest = { ...context, candidates };
  const assertActive = () => {
    if (this.isDisposed() || generation !== this.fieldPlacementGeneration) throw new Error("Field placement belongs to an ended duel.");
  };
  const automatic = (): FieldPlacementResult => ({ outcome: "chosen", slot: slots[0]! });
  const resolveHuman = async (): Promise<FieldPlacementResult> => {
    const mode = this.getFieldPlacementMode();
    if (mode !== "manual" || slots.length === 1) return automatic();
    if (this.pendingFieldPlacement) throw new Error("Another field placement is already pending.");
    this.pendingFieldPlacement = request;
    const controller = new AbortController();
    this.fieldPlacementAbort = controller;
    try {
      const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Field placement was aborted.")), { once: true }));
      const result = await Promise.race([this.fieldPlacementProvider ? this.fieldPlacementProvider(request) : this.ui.chooseFieldPlacement(request), aborted]);
      assertActive();
      return validateFieldPlacementResult(result, request);
    } finally {
      if (this.pendingFieldPlacement === request) this.pendingFieldPlacement = null;
      if (this.fieldPlacementAbort === controller) this.fieldPlacementAbort = null;
    }
  };
  const result = await this.decisionBroker.requestDecision({
    kind: "field_placement", actor, candidates, contextSnapshot: context,
    requireCandidate: false, resolveAI: automatic, resolveHuman,
    serializeResult: value => { assertActive(); return validateFieldPlacementResult(value, request); },
    deserializeReplayValue: value => validateFieldPlacementResult(value, request),
  });
  assertActive();
  return result.outcome === "chosen" ? { outcome: "chosen", intent: { ...context, slot: result.slot, generation } } : result;
}
