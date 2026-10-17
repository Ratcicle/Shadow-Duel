import { format } from "node:util";
import BaseStrategy from "../../src/core/ai/BaseStrategy.js";
import { gameTreeSearch, shouldUseGameTreeSearch } from "../../src/core/ai/GameTreeSearch.js";
import { PUBLIC_UNKNOWN_CARD_FIELDS } from "../../src/core/ai/common/planningCopy.js";
import { fingerprintAction } from "../../src/core/ai/common/planningDiagnostics.js";
import { fingerprintMainPhaseState } from "../../src/core/bot/mainPhaseIdentity.js";
import type { AIPlannedAction, GameTreeSearchResult } from "../../src/core/contracts/ai.js";
import type { BotAttackChoice, BotGamePort, BotRootOutcome, BotRuntimePort } from "../../src/core/contracts/bot.js";
import type { GameCard } from "../../src/core/contracts/cards.js";
import type { GamePlayer } from "../../src/core/contracts/player.js";
import {
  INVARIANCE_SAMPLE_LIMIT,
  INVARIANCE_SCHEMA,
  INVARIANCE_SCHEMA_VERSION,
  emptyInvarianceRootTally,
  type BenchmarkCase,
  type Counter,
  type InvarianceCaseRecord,
  type InvarianceRoot,
  type InvarianceRootTally,
  type InvarianceSeat,
  type Seat,
} from "./schema.js";
import { increment, round, sortedCounter } from "./statistics.js";

// Hidden-information invariance control of the benchmark harness (phase 2.3
// L09). Each live decision root of a bot runs again twice: on the real state
// and with the opponent's hidden information traded. The trade mutates the
// live zones in place, so a probe silences the harness diagnostics, never
// nests, and restores order, identity, placement and the targeting cache
// exactly, without events. The reruns may still perturb the duel (strategy
// state, timing): a run with the control is a diagnostic, never a measurement.

// ── Trade of the hidden information ────────────────────────────────────────

/** Placement fields of a hidden position: the ones an opaque projection keeps. */
const PLACEMENT_FIELDS: readonly string[] = PUBLIC_UNKNOWN_CARD_FIELDS;

/**
 * Public state of a presence on the field, which belongs to the position too:
 * the presence version and its counters, and the turn marks the runtime
 * writes when a card enters the field or is Set. The roots without an opaque
 * projection read them (replacement presences, the Set turn of a Trap).
 */
const FIELD_PRESENCE_FIELDS: readonly string[] = [
  "locationVersion", "setTurn", "turnSetOn", "summonedTurn", "enteredFieldTurn", "revealedTurn",
  "positionChangedThisTurn", "counters", "fieldPresenceState", "fieldPresenceSummons",
];

/** What a position on the field keeps: its placement and its presence. */
const FIELD_POSITION_FIELDS: readonly string[] = [...PLACEMENT_FIELDS, ...FIELD_PRESENCE_FIELDS];

interface PlacementValue {
  field: string;
  present: boolean;
  value: unknown;
}

type Placement = readonly PlacementValue[];

function readPlacement(card: GameCard, fields: readonly string[]): Placement {
  return fields.map(field => ({ field, present: Object.hasOwn(card, field), value: Reflect.get(card, field) }));
}

function writePlacement(card: GameCard, placement: Placement): void {
  for (const { field, present, value } of placement) {
    if (present) Reflect.set(card, field, value);
    else Reflect.deleteProperty(card, field);
  }
}

interface TradedZones {
  hand: GameCard[];
  deck: GameCard[];
  field: GameCard[];
  spellTrap: GameCard[];
  fieldSpell: GameCard | null;
}

function snapshotZones(player: GamePlayer): TradedZones {
  return { hand: [...player.hand], deck: [...player.deck], field: [...player.field], spellTrap: [...player.spellTrap],
    fieldSpell: player.fieldSpell };
}

function writeZones(player: GamePlayer, zones: TradedZones): void {
  player.hand.splice(0, player.hand.length, ...zones.hand);
  player.deck.splice(0, player.deck.length, ...zones.deck);
  player.field.splice(0, player.field.length, ...zones.field);
  player.spellTrap.splice(0, player.spellTrap.length, ...zones.spellTrap);
  player.fieldSpell = zones.fieldSpell;
}

function holdsZones(player: GamePlayer, zones: TradedZones): boolean {
  const same = (current: readonly GameCard[], expected: readonly GameCard[]) =>
    current.length === expected.length && current.every((card, index) => card === expected[index]);
  return same(player.hand, zones.hand) && same(player.deck, zones.deck) && same(player.field, zones.field) &&
    same(player.spellTrap, zones.spellTrap) && player.fieldSpell === zones.fieldSpell;
}

const isMonster = (card: GameCard): boolean => card.cardKind === "monster";
const isBackrowCard = (card: GameCard): boolean => card.cardKind !== "monster" && card.subtype !== "field";
const isFieldSpell = (card: GameCard): boolean => card.cardKind === "spell" && card.subtype === "field";

export interface HiddenTrade {
  /** Hidden positions whose card identity (definition id) the trade changes. */
  changed: number;
  /** The same positions split into Hand and Deck, and face-down cards on the field. */
  traded: { handDeck: number; faceDown: number };
  apply(): void;
  /** Restores zones and placements; false when the zones no longer held the traded cards. */
  restore(): boolean;
}

/**
 * Plans the trade of the opponent's hidden information. Hand and Deck rotate
 * by the Hand size, keeping both sizes; then each face-down card trades
 * places with a Deck card of the same kind and another identity: a monster,
 * a backrow Spell/Trap or a Field Spell. Every hidden position keeps the
 * public placement fields of its original card, so the public projection of
 * the traded state equals the real one; a position on the field also keeps
 * the public state of its presence. A card moved to the Deck keeps its own.
 */
export function planHiddenTrade(opponent: GamePlayer): HiddenTrade {
  const before = snapshotZones(opponent);
  const pool = [...before.hand, ...before.deck];
  const handSize = before.hand.length;
  const rotated = [...pool.slice(handSize), ...pool.slice(0, handSize)];
  const after: TradedZones = {
    hand: rotated.slice(0, handSize),
    deck: rotated.slice(handSize),
    field: [...before.field],
    spellTrap: [...before.spellTrap],
    fieldSpell: before.fieldSpell,
  };
  const taken = new Set<number>();
  const trade = (card: GameCard, fits: (candidate: GameCard) => boolean): GameCard | null => {
    const index = after.deck.findIndex((candidate, position) => !taken.has(position) && candidate.id !== card.id && fits(candidate));
    const replacement = index < 0 ? undefined : after.deck[index];
    if (!replacement) return null;
    taken.add(index);
    after.deck[index] = card;
    return replacement;
  };
  after.field.forEach((card, index) => {
    const replacement = card.isFacedown ? trade(card, isMonster) : null;
    if (replacement) after.field[index] = replacement;
  });
  after.spellTrap.forEach((card, index) => {
    const replacement = card.isFacedown ? trade(card, isBackrowCard) : null;
    if (replacement) after.spellTrap[index] = replacement;
  });
  if (before.fieldSpell?.isFacedown) after.fieldSpell = trade(before.fieldSpell, isFieldSpell) ?? before.fieldSpell;

  // Captured before any write: each moved card takes its position's original
  // placement, and the restoration gives every card all of its own fields back.
  const placements = new Map<GameCard, Placement>();
  const owned = new Map<GameCard, Placement>();
  const remember = (card: GameCard | null, fields: readonly string[]) => {
    if (!card || placements.has(card)) return;
    placements.set(card, readPlacement(card, fields));
    owned.set(card, readPlacement(card, FIELD_POSITION_FIELDS));
  };
  for (const zone of [before.hand, before.deck]) zone.forEach(card => remember(card, PLACEMENT_FIELDS));
  for (const zone of [before.field, before.spellTrap]) zone.forEach(card => remember(card, FIELD_POSITION_FIELDS));
  remember(before.fieldSpell, FIELD_POSITION_FIELDS);
  const moves: Array<readonly [original: GameCard, placed: GameCard]> = [];
  /** Records the moves between two arrangements of a zone; returns how many change the identity. */
  const changedMoves = (from: readonly GameCard[], to: readonly GameCard[]): number => {
    let changed = 0;
    from.forEach((card, index) => {
      const placed = to[index];
      if (!placed || placed === card) return;
      moves.push([card, placed]);
      if (placed.id !== card.id) changed += 1;
    });
    return changed;
  };
  const handDeck = changedMoves(before.hand, after.hand) + changedMoves(before.deck, after.deck);
  let faceDown = changedMoves(before.field, after.field) + changedMoves(before.spellTrap, after.spellTrap);
  if (before.fieldSpell && after.fieldSpell && after.fieldSpell !== before.fieldSpell) {
    moves.push([before.fieldSpell, after.fieldSpell]);
    if (after.fieldSpell.id !== before.fieldSpell.id) faceDown += 1;
  }

  return {
    changed: handDeck + faceDown,
    traded: { handDeck, faceDown },
    apply() {
      writeZones(opponent, after);
      for (const [original, placed] of moves) {
        const placement = placements.get(original);
        if (placement) writePlacement(placed, placement);
      }
    },
    restore() {
      const intact = holdsZones(opponent, after);
      writeZones(opponent, before);
      for (const [card, placement] of owned) writePlacement(card, placement);
      return intact;
    },
  };
}

// ── Tallies ────────────────────────────────────────────────────────────────

function emptyRoots(): Record<InvarianceRoot, InvarianceRootTally> {
  return {
    p2: emptyInvarianceRootTally(),
    turnLineSearch: emptyInvarianceRootTally(),
    beam: emptyInvarianceRootTally(),
    greedy: emptyInvarianceRootTally(),
    attack: emptyInvarianceRootTally(),
  };
}

function copyTally(tally: InvarianceRootTally): InvarianceRootTally {
  return { ...tally, errorLabels: sortedCounter(tally.errorLabels), samples: tally.samples.map(sample => ({ ...sample })) };
}

/** The control's comparisons of one duel, per seat and root. */
export class InvarianceTallies {
  private readonly seats: Record<Seat, InvarianceSeat>;

  constructor(presets: Record<Seat, string>) {
    const seat = (preset: string): InvarianceSeat => ({ preset, roots: emptyRoots(), consoleLabels: {} });
    this.seats = { player: seat(presets.player), bot: seat(presets.bot) };
  }

  root(seat: Seat, root: InvarianceRoot): InvarianceRootTally {
    return this.seats[seat].roots[root];
  }

  consoleLabels(seat: Seat): Counter {
    return this.seats[seat].consoleLabels;
  }

  record(entry: BenchmarkCase): InvarianceCaseRecord {
    const seat = (value: InvarianceSeat): InvarianceSeat => ({
      preset: value.preset,
      roots: {
        p2: copyTally(value.roots.p2),
        turnLineSearch: copyTally(value.roots.turnLineSearch),
        beam: copyTally(value.roots.beam),
        greedy: copyTally(value.roots.greedy),
        attack: copyTally(value.roots.attack),
      },
      consoleLabels: sortedCounter(value.consoleLabels),
    });
    return {
      schema: INVARIANCE_SCHEMA,
      v: INVARIANCE_SCHEMA_VERSION,
      caseIndex: entry.caseIndex,
      caseId: entry.caseId,
      seats: { player: seat(this.seats.player), bot: seat(this.seats.bot) },
    };
  }
}

// ── Probes ─────────────────────────────────────────────────────────────────

/** What the control needs from the harness of one duel. */
export interface InvarianceHost {
  /** The tallies of the duel `game` belongs to while it is observed; null otherwise. */
  talliesFor(game: BotGamePort): InvarianceTallies | null;
  /** Silences the harness observer and the Arena tracker of `game`; the result restores them. */
  silence(game: BotGamePort): () => void;
}

/** One probe at a time: a rerun that reaches another live root never probes it again. */
let probing = false;

function messageLabel(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? "").slice(0, 200);
}

function errorLabel(error: unknown): string {
  return messageLabel(error instanceof Error ? error.message : String(error)) || "Unknown error";
}

/** console.error/warn of the reruns go to the side file, never to the record's counters. */
function captureConsole(labels: Counter): () => void {
  const { error, warn } = console;
  const collect = (kind: string) => (...values: unknown[]) => { increment(labels, `${kind}: ${messageLabel(format(...values))}`); };
  console.error = collect("error");
  console.warn = collect("warn");
  return () => {
    console.error = error;
    console.warn = warn;
  };
}

function stateFingerprint(game: BotGamePort, bot: BotRuntimePort): string | null {
  try {
    return fingerprintMainPhaseState(game, bot);
  } catch {
    return null;
  }
}

function clearTargetingCache(game: BotGamePort): void {
  game.effectEngine?.clearTargetingCache?.();
}

/**
 * The live targeting cache and its hit counters, as the probe found them.
 * Both reruns start from an empty cache, so they differ only by the trade;
 * the duel then finds its own entries again, never the probe's (a cleared
 * cache changes later candidate lists).
 */
function saveTargetingCache(game: BotGamePort): () => void {
  const engine: unknown = game.effectEngine;
  const cache: unknown = engine ? Reflect.get(engine, "_targetingCache") : undefined;
  if (!engine || !(cache instanceof Map)) return () => clearTargetingCache(game);
  const entries = [...cache];
  const counters = ["_targetingCacheHits", "_targetingCacheMisses"].map(key => [key, Reflect.get(engine, key)] as const);
  return () => {
    cache.clear();
    for (const [key, value] of entries) cache.set(key, value);
    for (const [key, value] of counters) Reflect.set(engine, key, value);
  };
}

function sameScore(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Object.is(left, right) || Math.abs(left - right) <= 1e-9;
}

function sampleScore(score: number | null): number | null {
  return score === null || !Number.isFinite(score) ? null : round(score, 6);
}

interface Probe {
  game: BotGamePort;
  bot: BotRuntimePort;
  tally: InvarianceRootTally;
  trade: HiddenTrade;
  stateBefore: string | null;
  close(): void;
}

function recordError(tally: InvarianceRootTally, error: unknown): void {
  tally.errors += 1;
  increment(tally.errorLabels, errorLabel(error));
}

function openProbe(host: InvarianceHost, bot: BotRuntimePort, game: BotGamePort, root: InvarianceRoot): Probe | null {
  if (probing) return null;
  const tallies = host.talliesFor(game);
  const seat = bot.id === "player" || bot.id === "bot" ? bot.id : null;
  if (!tallies || !seat) return null;
  const tally = tallies.root(seat, root);
  let trade: HiddenTrade;
  try {
    const opponent = bot.resolveOpponent(game);
    if (!opponent) return null;
    trade = planHiddenTrade(opponent);
  } catch (error) {
    recordError(tally, error);
    return null;
  }
  if (trade.changed === 0) {
    tally.vacuous += 1;
    return null;
  }
  probing = true;
  const restoreDiagnostics = host.silence(game);
  const releaseConsole = captureConsole(tallies.consoleLabels(seat));
  const restoreCache = saveTargetingCache(game);
  return {
    game, bot, tally, trade, stateBefore: stateFingerprint(game, bot),
    close() {
      restoreCache();
      releaseConsole();
      restoreDiagnostics();
      probing = false;
    },
  };
}

/** Puts the real information back and checks that the live state is the one the probe found. */
function restoreTrade(probe: Probe): void {
  const intact = probe.trade.restore();
  const stateAfter = stateFingerprint(probe.game, probe.bot);
  if (!intact || (probe.stateBefore !== null && stateAfter !== probe.stateBefore)) probe.tally.restoreFailures += 1;
}

function compare<Choice>(
  probe: Probe,
  live: BotRootOutcome<Choice>,
  real: BotRootOutcome<Choice>,
  swapped: BotRootOutcome<Choice>,
  print: (choice: Choice) => string,
): void {
  const describe = (outcome: BotRootOutcome<Choice>) => outcome.choice === null ? "none" : print(outcome.choice);
  const tally = probe.tally;
  const liveKey = describe(live);
  const realKey = describe(real);
  const swappedKey = describe(swapped);
  tally.checked += 1;
  const liveActionDiff = liveKey !== realKey;
  const liveScoreDiff = !sameScore(live.score, real.score);
  if (liveActionDiff) tally.liveActionDiff += 1;
  if (liveScoreDiff) tally.liveScoreDiff += 1;
  // A root that did not reproduce its live decision on the real state stays
  // out of the gate: its traded comparison cannot tell hidden information
  // from state carried between calls.
  const reproduced = !liveActionDiff && !liveScoreDiff;
  if (!reproduced) tally.nonReproducible += 1;
  const tradedActionDiff = realKey !== swappedKey;
  const tradedScoreDiff = !sameScore(real.score, swapped.score);
  if (reproduced && tradedActionDiff) tally.actionDiff += 1;
  if (reproduced && tradedScoreDiff) tally.scoreDiff += 1;
  if ((tradedActionDiff || tradedScoreDiff || !reproduced) && tally.samples.length < INVARIANCE_SAMPLE_LIMIT) {
    tally.samples.push({
      turn: probe.game.turnCounter, phase: typeof probe.game.phase === "string" ? probe.game.phase : null,
      traded: { ...probe.trade.traded },
      live: liveKey, real: realKey, swapped: swappedKey,
      liveScore: sampleScore(live.score), realScore: sampleScore(real.score), swappedScore: sampleScore(swapped.score),
    });
  }
}

function attempt<Choice>(tally: InvarianceRootTally, rerun: () => BotRootOutcome<Choice>): BotRootOutcome<Choice> | null {
  try {
    return rerun();
  } catch (error) {
    recordError(tally, error);
    return null;
  }
}

async function attemptAsync<Choice>(
  tally: InvarianceRootTally,
  rerun: () => Promise<BotRootOutcome<Choice>>,
): Promise<BotRootOutcome<Choice> | null> {
  try {
    return await rerun();
  } catch (error) {
    recordError(tally, error);
    return null;
  }
}

/**
 * A synchronous root (P2, attack choice): nothing else runs while the trade
 * is applied. A failure of the control is tallied and never reaches the duel.
 */
function probeRoot<Choice>(
  host: InvarianceHost, bot: BotRuntimePort, game: BotGamePort, root: InvarianceRoot,
  live: BotRootOutcome<Choice>, rerun: () => BotRootOutcome<Choice>, print: (choice: Choice) => string,
): void {
  const probe = openProbe(host, bot, game, root);
  if (!probe) return;
  try {
    clearTargetingCache(game);
    const real = attempt(probe.tally, rerun);
    if (!real) return;
    let swapped: BotRootOutcome<Choice> | null = null;
    try {
      probe.trade.apply();
      clearTargetingCache(game);
      swapped = attempt(probe.tally, rerun);
    } finally {
      restoreTrade(probe);
    }
    if (swapped) compare(probe, live, real, swapped, print);
  } catch (error) {
    recordError(probe.tally, error);
  } finally {
    probe.close();
  }
}

/**
 * A Main Phase search: the controller awaits the probe right after its own
 * readiness check, so the trade stays applied only while the rerun's
 * microtasks run. The returned promise never rejects.
 */
async function probeSearchRoot(
  host: InvarianceHost, bot: BotRuntimePort, game: BotGamePort, root: InvarianceRoot,
  live: BotRootOutcome<AIPlannedAction>, rerun: () => Promise<BotRootOutcome<AIPlannedAction>>,
): Promise<void> {
  const probe = openProbe(host, bot, game, root);
  if (!probe) return;
  try {
    clearTargetingCache(game);
    const real = await attemptAsync(probe.tally, rerun);
    if (!real) return;
    let swapped: BotRootOutcome<AIPlannedAction> | null = null;
    try {
      probe.trade.apply();
      clearTargetingCache(game);
      swapped = await attemptAsync(probe.tally, rerun);
    } finally {
      restoreTrade(probe);
    }
    if (swapped) compare(probe, live, real, swapped, printAction);
  } catch (error) {
    recordError(probe.tally, error);
  } finally {
    probe.close();
  }
}

function printAction(action: AIPlannedAction): string {
  return JSON.stringify(fingerprintAction(action));
}

/** Attacker and target by instance: the trade keeps every hidden position's instanceId. */
function printAttack(choice: BotAttackChoice): string {
  return JSON.stringify([choice.attacker.instanceId, choice.target ? choice.target.instanceId : null]);
}

function gameTreeOutcome(result: GameTreeSearchResult | null): BotRootOutcome<AIPlannedAction> {
  return { choice: result?.action ?? null, score: result?.score ?? null };
}

/** The ply BaseStrategy.evaluateCriticalSituationWithGameTree gives gameTreeSearch. */
const P2_MAX_PLY = 4;

/**
 * P2 runs inside the strategy's action generation, so its probe wraps this
 * strategy instance only. The gate reads public data (LP, field sizes and
 * the bot's own hand), so the real and traded reruns share it. The reruns
 * call the strategy's search with its ply: the strategy turns a search that
 * throws into a null result, which would read as a choice, and here it
 * counts as an error of the control.
 */
function instrumentGameTree(bot: BotRuntimePort, host: InvarianceHost): void {
  const strategy = bot.strategy;
  if (!(strategy instanceof BaseStrategy)) return;
  const evaluate = strategy.evaluateCriticalSituationWithGameTree;
  strategy.evaluateCriticalSituationWithGameTree = (game, analysis = null) => {
    const live = evaluate.call(strategy, game, analysis);
    const liveGame = bot.game;
    if (liveGame && Object.is(game, liveGame) && shouldUseGameTreeSearch(game, strategy.bot)) {
      probeRoot(host, bot, liveGame, "p2", gameTreeOutcome(live), () => {
        if (live && live.depth !== P2_MAX_PLY) throw new Error(`P2 ply ${live.depth} differs from the control's ${P2_MAX_PLY}`);
        const result = gameTreeSearch(game, strategy, strategy.bot, P2_MAX_PLY);
        if (result.error !== undefined) throw new Error(`gameTreeSearch: ${result.error}`);
        // As the strategy: a search without an action is no P2 decision.
        return gameTreeOutcome(result.action ? result : null);
      }, printAction);
    }
    return live;
  };
}

/** Installs the control on one harness bot: the P2 wrapper and the decision-root observer. */
export function installInvarianceControl(bot: BotRuntimePort, host: InvarianceHost): void {
  instrumentGameTree(bot, host);
  bot.decisionRootObserver = {
    observeSearch: (root, game, live, rerun) => probeSearchRoot(host, bot, game, root, live, rerun),
    observeAttack: (game, live, rerun) => probeRoot(host, bot, game, "attack", live, rerun, printAttack),
  };
}
