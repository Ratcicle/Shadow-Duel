import type { DuelCardId, PlayerId } from "./primitives.js";

export type FieldSlot = 0 | 1 | 2 | 3 | 4;
export type PlacementRow = "field" | "spellTrap";
export type FieldPlacementMode = "automatic" | "manual";

export interface FieldPlacementCandidate {
  candidateKey: string;
  slot: FieldSlot;
}

export interface FieldPlacementContext {
  procedureId: string;
  decidingPlayerId: PlayerId;
  destinationPlayerId: PlayerId;
  row: PlacementRow;
  duelCardId: DuelCardId;
  allowCancel: boolean;
}

export interface FieldPlacementRequest extends FieldPlacementContext {
  candidates: readonly FieldPlacementCandidate[];
}

export type FieldPlacementResult =
  | { outcome: "chosen"; slot: FieldSlot }
  | { outcome: "cancelled" };

/** A choice, not occupancy: response effects may still use this vacancy. */
export interface FieldPlacementIntent extends FieldPlacementContext {
  slot: FieldSlot;
  /** Local lifecycle guard; excluded from serialized decisions and state. */
  generation: number;
}

export interface PrepareFieldPlacementOptions {
  actor?: import("./player.js").GamePlayer | null;
  allowCancel?: boolean;
  intent?: FieldPlacementIntent | null;
}

export type FieldPlacementPreparation =
  | { outcome: "chosen"; intent: FieldPlacementIntent }
  | { outcome: "cancelled" | "unavailable" };

export interface GamePlacementPort {
  prepareFieldPlacement(
    card: import("./cards.js").GameCard,
    destination: import("./player.js").GamePlayer,
    row: PlacementRow,
    options?: PrepareFieldPlacementOptions,
  ): Promise<FieldPlacementPreparation>;
}
