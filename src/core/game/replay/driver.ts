import Game from "../../Game.js";
import Player from "../../Player.js";
import type { AIDecisionPlan } from "../../contracts/ai.js";
import type { EngineFault } from "../../contracts/gameRuntime.js";
import type { PlayerId } from "../../contracts/primitives.js";
import type {
  CanonicalReplay,
  CanonicalReplayCommand,
  CanonicalReplayResultSummary,
  ReplayCardLocator,
  ReplayControllerType,
  ReplayDriverGamePort,
  ReplayDriverOptions,
  ReplayRuntimeCard,
  ReplayRuntimePlayer,
  ReplaySeatControllers,
} from "../../contracts/replay.js";
import { DEFAULT_REPLAY_SEAT_CONTROLLERS } from "../../contracts/replay.js";
import { createDecisionPlanIdentities } from "../decisions/chainResponse.js";
import {
  hashCanonicalGameState,
  validateCanonicalReplay,
} from "./canonical.js";

const REPLAY_ARRAY_ZONES = Object.freeze([
  "hand",
  "field",
  "spellTrap",
  "graveyard",
  "banished",
  "deck",
  "extraDeck",
] as const);

interface LocatedReplayCard {
  card: ReplayRuntimeCard;
  zone: (typeof REPLAY_ARRAY_ZONES)[number] | "fieldSpell";
  index: number;
}

interface ReplayDivergenceMetadata {
  sequence: number;
  command: CanonicalReplayCommand;
  expectedHash: string;
  observedHash: string;
}

function playerFor(
  game: ReplayDriverGamePort,
  actorId: CanonicalReplayCommand["actorId"],
): ReplayRuntimePlayer {
  return actorId === "bot" ? game.bot : game.player;
}

function findCard(
  _game: ReplayDriverGamePort,
  actor: ReplayRuntimePlayer | undefined,
  payload: Partial<ReplayCardLocator> = {},
): LocatedReplayCard | null {
  if (payload.duelCardId != null) {
    for (const zone of REPLAY_ARRAY_ZONES) {
      const cards = actor?.[zone] || [];
      const card = cards.find(
        (entry) => entry.duelCardId === payload.duelCardId,
      );
      if (card) return { card, zone, index: cards.indexOf(card) };
    }
    if (actor?.fieldSpell?.duelCardId === payload.duelCardId) {
      return { card: actor.fieldSpell, zone: "fieldSpell", index: 0 };
    }
  }
  if (payload.cardId != null) {
    for (const zone of REPLAY_ARRAY_ZONES) {
      const cards = actor?.[zone] || [];
      const card = cards.find((entry) => entry.id === payload.cardId);
      if (card) return { card, zone, index: cards.indexOf(card) };
    }
    if (actor?.fieldSpell?.id === payload.cardId) {
      return { card: actor.fieldSpell, zone: "fieldSpell", index: 0 };
    }
  }
  return null;
}

function isReplayRuntimeCard(
  card: ReplayRuntimeCard | null,
): card is ReplayRuntimeCard {
  return Boolean(card);
}

/**
 * The recorded plan of an activation command, by runtime identity, as the
 * activating entrypoint received it live. Its other preferences are not part
 * of the command: they only ever reach AI resolvers, which playback skips.
 */
function activationPlanOptions(
  game: ReplayDriverGamePort,
  command: Extract<CanonicalReplayCommand, { type: "activate_effect" | "activate_card" }>,
): { activationContext?: { decisions: AIDecisionPlan } } {
  if (command.payload.decisions === undefined) return {};
  const decisions = createDecisionPlanIdentities(game).deserialize(command.payload.decisions);
  if (!decisions) throw new Error("Replay activation choices name cards that are no longer available.");
  return { activationContext: { decisions } };
}

async function executeCommand(
  game: ReplayDriverGamePort,
  command: CanonicalReplayCommand,
): Promise<unknown> {
  const actor = playerFor(game, command.actorId);
  const runtimeCommandType = command.type;
  switch (runtimeCommandType) {
    case "noop":
      return true;
    case "draw":
      return game.drawCards(actor, Number(command.payload.amount || 1));
    case "shuffle":
      return game.shuffle(actor.deck);
    case "set_phase":
      game.phase = command.payload.phase;
      return true;
    case "set_lp":
      actor.lp = Number(command.payload.lp);
      return true;
    case "phase_intent":
      if (command.payload.mode === "next") return game.nextPhase();
      // Mode-less records retain their historical target-based interpretation.
      return command.payload.toPhase
        ? game.skipToPhase(command.payload.toPhase)
        : game.nextPhase();
    case "summon":
    case "set_monster": {
      const source = findCard(game, actor, command.payload);
      if (!source || source.zone !== "hand") {
        throw new Error("Replay summon source is missing.");
      }
      return game.performNormalSummon(
        actor,
        source.index,
        command.payload.position || "attack",
        command.type === "set_monster" || command.payload.facedown === true,
        command.payload.tributeIndices || null,
      );
    }
    case "set_spell_trap": {
      const source = findCard(game, actor, command.payload);
      if (!source || source.zone !== "hand") {
        throw new Error("Replay Set source is missing.");
      }
      return game.setSpellOrTrap(source.card, source.index, actor);
    }
    case "flip_summon": {
      const source = findCard(game, actor, command.payload);
      if (!source || source.zone !== "field") {
        throw new Error("Replay Flip Summon source is missing.");
      }
      return game.flipSummon(source.card);
    }
    case "extra_deck_summon": {
      const source = findCard(game, actor, command.payload);
      if (source?.zone === "field" && command.payload.summonType === "ascension") {
        return game.tryAscensionSummon(source.card, { player: actor });
      }
      if (!source || source.zone !== "extraDeck") {
        throw new Error("Replay Extra Deck source is missing.");
      }
      const materials = (command.payload.materialIds || [])
        .map(
          (duelCardId) => findCard(game, actor, { duelCardId })?.card || null,
        )
        .filter(isReplayRuntimeCard);
      const options = {
        position: command.payload.position,
        ...(materials.length > 0 ? { materials } : {}),
      };
      if (command.payload.summonType === "synchro") {
        return game.performSynchroSummonFromExtraDeck(
          source.card,
          actor,
          options,
        );
      }
      if (command.payload.summonType === "ascension") {
        return game.performAscensionSummonFromExtraDeck(source.card, actor, {
          position: command.payload.position,
          ...(materials[0] ? { material: materials[0] } : {}),
        });
      }
      return game.performExtraDeckSummonProcedure(source.card, actor, options);
    }
    case "hand_summon_procedure": {
      const source = findCard(game, actor, command.payload);
      if (!source || source.zone !== "hand") {
        throw new Error("Replay hand procedure source is missing.");
      }
      const materials = command.payload.materialIds?.map(duelCardId => {
        const material = findCard(game, actor, { duelCardId });
        if (!material) throw new Error("Replay hand procedure cost is missing.");
        return material.card;
      });
      const counterSources = command.payload.counterSourceIds?.map(duelCardId => {
        const entry = findCard(game, game.player, { duelCardId }) || findCard(game, game.bot, { duelCardId });
        if (!entry || (entry.zone !== "field" && entry.zone !== "spellTrap" && entry.zone !== "fieldSpell")) {
          throw new Error("Replay hand procedure counter source is missing from the field.");
        }
        return entry.card;
      });
      return game.performHandSummonProcedure(source.card, actor, {
        ...(command.payload.position ? { position: command.payload.position } : {}),
        ...(materials ? { materials } : {}),
        ...(counterSources ? { counterSources } : {}),
      });
    }
    case "activate_effect":
    case "activate_card": {
      const source = findCard(game, actor, command.payload);
      if (!source) throw new Error("Replay activation source is missing.");
      const plan = activationPlanOptions(game, command);
      if (source.card.cardKind === "monster") {
        return game.tryActivateMonsterEffect(
          source.card,
          null,
          source.zone,
          actor,
          { effectId: command.payload.effectId || null, ...plan },
        );
      }
      if (source.zone === "hand") {
        return game.tryActivateSpell(source.card, source.index, null, {
          owner: actor,
          ...plan,
        });
      }
      if (source.zone === "fieldSpell") return game.activateFieldSpellEffect(source.card, plan);
      return game.tryActivateSpellTrapEffect(source.card, null, {
        owner: actor,
        activationZone: source.zone,
        effectId: command.payload.effectId || null,
        ...plan,
      });
    }
    case "change_position": {
      const source = findCard(game, actor, command.payload);
      if (!source || source.zone !== "field") {
        throw new Error("Replay position-change source is missing.");
      }
      return game.changeMonsterPosition(source.card, command.payload.position);
    }
    case "attack": {
      const attacker = findCard(game, actor, {
        duelCardId: command.payload.attackerId,
      });
      const opponent = game.getOpponent(actor);
      const target =
        command.payload.targetId == null
          ? null
          : findCard(game, opponent, { duelCardId: command.payload.targetId });
      if (!attacker) throw new Error("Replay attacker is missing.");
      return game.resolveCombat(attacker.card, target?.card || null, {
        player: actor,
      });
    }
    default:
      throw new Error(
        `Unsupported canonical replay command "${runtimeCommandType satisfies never}".`,
      );
  }
}

async function drainReplayDecisions(game: ReplayDriverGamePort): Promise<void> {
  let guard = 0;
  while (game.pendingReplayDecisionPromise) {
    if (guard++ > 100) {
      throw new Error("Replay decision drain exceeded its safety limit.");
    }
    const pending = game.pendingReplayDecisionPromise;
    await pending;
    if (game.pendingReplayDecisionPromise === pending) {
      game.pendingReplayDecisionPromise = null;
    }
  }
}

/** The controller of each seat, as recorded or implied by its absence. */
export function getReplaySeatControllers(
  replay: Pick<CanonicalReplay, "setup">,
): ReplaySeatControllers {
  return { ...DEFAULT_REPLAY_SEAT_CONTROLLERS, ...replay.setup.controllers };
}

/**
 * What a strict playback Game refused or contained. A refusal throws to stop
 * the computation, but the engine contains errors at some boundaries (trigger
 * collection, SEGOC, event resolution), where the error may never reach the
 * driver; so the driver also reads this state after each step and fails on it.
 */
interface StrictPlaybackState {
  /** Policy consultations refused so far, in order. */
  readonly violations: string[];
  /** Recorded decisions the broker rejected since they were loaded. */
  readonly replayRejections: () => readonly string[];
  /** The engine faults the Game has contained so far. */
  readonly engineFaults: () => readonly EngineFault[];
}

const strictPlaybackStates = new WeakMap<object, StrictPlaybackState>();

/** Records a refused policy consultation, then stops the computation. */
function refusePolicyConsultation(violations: string[], message: string): never {
  violations.push(message);
  throw new Error(message);
}

/**
 * A playback seat: the recorded controller type and nothing else. An AI seat
 * has no strategy and cannot move by itself; any attempt to consult it is a
 * choice the replay did not capture, so it is recorded in `violations` and
 * throws instead of recomputing.
 */
export function createReplaySeat(
  id: PlayerId,
  controllerType: ReplayControllerType,
  violations: string[] = [],
): Player {
  const seat = new Player(id, id === "player" ? "You" : "Opponent", controllerType);
  if (controllerType === "ai") {
    const refuse = (what: string): never => refusePolicyConsultation(
      violations,
      `Replay ${id} seat consulted its ${what}; playback only consumes recorded decisions.`,
    );
    Object.defineProperty(seat, "strategy", {
      configurable: true,
      enumerable: false,
      get: () => refuse("strategy"),
    });
    Object.defineProperty(seat, "makeMove", {
      configurable: true,
      enumerable: false,
      value: () => refuse("AI move"),
    });
  }
  return seat;
}

/**
 * Builds the strict headless playback Game of a replay: seats rebuilt from
 * its controllers, without strategies, and no AutoSelector or AI randomness
 * (both serve only AI resolvers, which playback never runs). Every refusal is
 * recorded on the Game, and the driver fails the replay on it even when the
 * engine contained the error. Presentation delays are timing only (hashes
 * come from canonical state), so they are skipped here; a caller-supplied Game
 * keeps its own seats and configuration.
 */
export function createHeadlessPlaybackGame(
  replay: Pick<CanonicalReplay, "setup">,
): ReplayDriverGamePort {
  const controllers = getReplaySeatControllers(replay);
  const violations: string[] = [];
  const game = new Game({
    renderer: null,
    randomSeed: replay.setup.seed,
    replayMode: "playback",
    captureReplay: false,
    chainResponseTimeoutMs: 0,
    opponentOverride: createReplaySeat("bot", controllers.bot, violations),
  });
  if (controllers.player === "ai") {
    game.player = createReplaySeat("player", "ai", violations);
    game.player.game = game;
  }
  const refuse = (what: string): never => refusePolicyConsultation(
    violations,
    `Replay playback consulted the ${what}; playback only consumes recorded decisions.`,
  );
  game.autoSelector = {
    select: () => refuse("AutoSelector"),
    orderTriggerCandidates: () => refuse("AutoSelector"),
  };
  game.aiRandom = () => refuse("AI randomness");
  game.disablePresentationDelays = true;
  strictPlaybackStates.set(game, {
    violations,
    replayRejections: () => game.decisionBroker.replayRejections,
    engineFaults: () => game.engineFaults,
  });
  return game as ReplayDriverGamePort;
}

interface StrictPlaybackChecks {
  /** Fails at the first refused policy consultation. */
  consultations(step: string): void;
  /**
   * Fails at the first recorded decision the broker rejected, then at the
   * first engine fault contained since playback started.
   */
  containedErrors(step: string): void;
}

/** The checks of a strict playback Game; other Games always pass them. */
function createStrictPlaybackChecks(game: ReplayDriverGamePort): StrictPlaybackChecks {
  const state = strictPlaybackStates.get(game);
  if (!state) return { consultations: () => {}, containedErrors: () => {} };
  const violationsBefore = state.violations.length;
  const faultsBefore = new Set(state.engineFaults());
  return {
    consultations: step => {
      const violation = state.violations[violationsBefore];
      if (violation !== undefined) {
        throw new Error(`Strict replay playback failed ${step}: ${violation}`);
      }
    },
    containedErrors: step => {
      const [rejection] = state.replayRejections();
      if (rejection !== undefined) {
        throw new Error(`Strict replay playback failed ${step}: a recorded decision was rejected (${rejection})`);
      }
      const fault = state.engineFaults().find(entry => !faultsBefore.has(entry));
      if (fault) {
        throw new Error(
          `Strict replay playback failed ${step}: the engine contained a fault (${fault.scope}: ${fault.message}).`,
        );
      }
    },
  };
}

export async function replayCanonicalDuel(
  replay: unknown,
  options: ReplayDriverOptions = {},
): Promise<CanonicalReplayResultSummary> {
  const canonicalReplay = validateCanonicalReplay(replay);
  const game =
    options.game || createHeadlessPlaybackGame(canonicalReplay);
  const strict = createStrictPlaybackChecks(game);
  game.decisionBroker.loadReplayDecisions(canonicalReplay.decisions);
  await game.startWithDecks({
    exactDecks: true,
    preserveDeckOrder: true,
    initializeOnly: true,
    startAtDrawPhase: true,
    announceStartingPlayer: false,
    startingPlayer: canonicalReplay.setup.startingPlayer,
    initialRandomState: canonicalReplay.setup.randomState,
    playerDeck: canonicalReplay.setup.playerDeck,
    playerExtraDeck: canonicalReplay.setup.playerExtraDeck,
    botDeck: canonicalReplay.setup.botDeck,
    botExtraDeck: canonicalReplay.setup.botExtraDeck,
  });
  strict.consultations("during setup");
  strict.containedErrors("during setup");
  if (canonicalReplay.setup.openingTurnStarted === true) {
    await game.startTurn();
    await drainReplayDecisions(game);
    strict.consultations("in the opening turn");
    strict.containedErrors("in the opening turn");
  }

  for (const command of canonicalReplay.commands) {
    const step = `at command ${command.sequence} (${command.type})`;
    await executeCommand(game, command);
    await drainReplayDecisions(game);
    // A refused consultation explains a divergence, so it comes first; a
    // rejected decision or contained fault that left the recorded state
    // unchanged still fails the command after the hash matches.
    strict.consultations(step);
    const observedHash = hashCanonicalGameState(game);
    if (command.stateHash && observedHash !== command.stateHash) {
      const error: Error & Partial<ReplayDivergenceMetadata> = new Error(
        `Replay divergence at command ${command.sequence} (${command.type}): expected ${command.stateHash}, observed ${observedHash}.`,
      );
      error.sequence = command.sequence;
      error.command = command;
      error.expectedHash = command.stateHash;
      error.observedHash = observedHash;
      throw error;
    }
    strict.containedErrors(step);
  }

  if (game.decisionBroker.replayCursor !== canonicalReplay.decisions.length) {
    throw new Error(
      `Replay finished with ${canonicalReplay.decisions.length - game.decisionBroker.replayCursor} unconsumed decision(s).`,
    );
  }

  const finalStateHash = hashCanonicalGameState(game);
  if (
    canonicalReplay.result?.finalStateHash &&
    finalStateHash !== canonicalReplay.result.finalStateHash
  ) {
    throw new Error(
      `Replay final hash mismatch: expected ${canonicalReplay.result.finalStateHash}, observed ${finalStateHash}.`,
    );
  }
  return {
    ok: true,
    game,
    finalStateHash,
    commands: canonicalReplay.commands.length,
  };
}
