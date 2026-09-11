import type { GameUI } from "./ui.js";
import type { GamePlayer } from "./player.js";
import type {
  DuelCardId,
  PlayerId,
  RawCardDefinitionId,
} from "./primitives.js";

export const GAME_PHASES = Object.freeze([
  "draw",
  "standby",
  "main1",
  "battle",
  "main2",
  "end",
] as const);

export type GamePhase = (typeof GAME_PHASES)[number];

export type ReplayMode = "live" | "playback";

export type DeterministicRandomSeed = string | number;

export interface DeterministicRandomSnapshot {
  seed: number;
  state: number;
  calls: number;
}

/** Explicit constructor surface retained by Game during its TypeScript move. */
export interface GameOptions {
  disableChains?: boolean;
  disableTraps?: boolean;
  disableEffectActivation?: boolean;
  randomSeed?: DeterministicRandomSeed;
  captureReplay?: boolean;
  laboratoryMode?: boolean;
  laboratoryRevealBotHand?: boolean;
  laboratoryUseBot?: boolean;
  playerName?: string;
  opponentName?: string;
  opponentOverride?: GamePlayer;
  botPreset?: string;
  renderer?: GameRendererPort | null;
  replayMode?: ReplayMode;
  damageCalculationStatPresentationDelayMs?: number;
  normalDuelStrategicReport?: boolean;
  playerArchetype?: string;
  botArchetype?: string;
  devMode?: boolean;
  chainResponseTimeoutMs?: number;
}

export interface GameRendererPort extends Partial<GameUI> {
  destroy?(): void;
}

/** Exact-deck entries retain their deterministic replay identity. */
export interface StartDeckEntry {
  id: RawCardDefinitionId;
  duelCardId: DuelCardId | number;
}

export type StartDeckCard = RawCardDefinitionId | StartDeckEntry;

interface StartWithDecksCommonOptions {
  startAtDrawPhase?: boolean;
  laboratoryMode?: boolean;
  revealBotHand?: boolean;
  startingPlayer?: PlayerId | null;
  firstTurnPlayer?: PlayerId | null;
  announceStartingPlayer?: boolean;
  preserveDeckOrder?: boolean;
  initializeOnly?: boolean;
  initialRandomState?: Partial<DeterministicRandomSnapshot> | null;
}

export interface ExactStartWithDecksOptions
  extends StartWithDecksCommonOptions {
  exactDecks: true;
  playerDeck?: readonly StartDeckCard[] | null;
  playerExtraDeck?: readonly StartDeckCard[] | null;
  botDeck?: readonly StartDeckCard[] | null;
  botExtraDeck?: readonly StartDeckCard[] | null;
}

export interface GeneratedStartWithDecksOptions
  extends StartWithDecksCommonOptions {
  exactDecks?: false;
  playerDeck?: readonly RawCardDefinitionId[] | null;
  playerExtraDeck?: readonly RawCardDefinitionId[] | null;
  botDeck?: readonly RawCardDefinitionId[] | null;
  botExtraDeck?: readonly RawCardDefinitionId[] | null;
}

export type StartWithDecksOptions =
  | ExactStartWithDecksOptions
  | GeneratedStartWithDecksOptions;

export interface StartingPlayerAnnouncementOptions {
  enabled?: boolean;
  durationMs?: number;
}

export interface ActionAvailabilityResult {
  ok: boolean;
  reason?: string | null;
  code?: string | null;
}

export interface DeterministicRandomPort {
  readonly seed: number;
  state: number;
  calls: number;
  next(): number;
  shuffle<Value>(items: Value[]): Value[];
  snapshot(): DeterministicRandomSnapshot;
  restore(snapshot?: Partial<DeterministicRandomSnapshot>): DeterministicRandomSnapshot;
}
