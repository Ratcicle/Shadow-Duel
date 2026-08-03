import Game from "../../Game.js";
import type {
  CanonicalReplay,
  CanonicalReplayCommand,
  CanonicalReplayResultSummary,
  ReplayCardLocator,
  ReplayDriverGamePort,
  ReplayDriverOptions,
  ReplayRuntimeCard,
  ReplayRuntimePlayer,
} from "../../contracts/replay.js";
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
      if (!source || source.zone !== "extraDeck") {
        throw new Error("Replay Extra Deck source is missing.");
      }
      const materials = (command.payload.materialIds || [])
        .map((duelCardId) => findCard(game, actor, { duelCardId })?.card || null)
        .filter(isReplayRuntimeCard);
      const options = {
        position: command.payload.position,
        ...(materials.length > 0 ? { materials } : {}),
      };
      if (command.payload.summonType === "synchro") {
        return game.performSynchroSummonFromExtraDeck(source.card, actor, options);
      }
      if (command.payload.summonType === "ascension") {
        return game.performAscensionSummonFromExtraDeck(source.card, actor, {
          position: command.payload.position,
          ...(materials[0] ? { material: materials[0] } : {}),
        });
      }
      return game.performExtraDeckSummonProcedure(source.card, actor, options);
    }
    case "activate_effect":
    case "activate_card": {
      const source = findCard(game, actor, command.payload);
      if (!source) throw new Error("Replay activation source is missing.");
      if (source.card.cardKind === "monster") {
        return game.tryActivateMonsterEffect(
          source.card,
          null,
          source.zone,
          actor,
          { effectId: command.payload.effectId || null },
        );
      }
      if (source.zone === "hand") {
        return game.tryActivateSpell(source.card, source.index, null, {
          owner: actor,
        });
      }
      return game.tryActivateSpellTrapEffect(source.card, null, {
        owner: actor,
        activationZone: source.zone,
        effectId: command.payload.effectId || null,
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
      const target = command.payload.targetId == null
        ? null
        : findCard(game, opponent, { duelCardId: command.payload.targetId });
      if (!attacker) throw new Error("Replay attacker is missing.");
      return game.resolveCombat(attacker.card, target?.card || null, {
        player: actor,
      });
    }
    default:
      throw new Error(
        `Unsupported canonical replay command "${runtimeCommandType}".`,
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

export async function replayCanonicalDuel(
  replay: unknown,
  options: ReplayDriverOptions = {},
): Promise<CanonicalReplayResultSummary> {
  const canonicalReplay = validateCanonicalReplay(replay);
  const game = options.game || (new Game({
    renderer: null,
    randomSeed: canonicalReplay.setup.seed,
    replayMode: "playback",
    captureReplay: false,
    chainResponseTimeoutMs: 0,
  }) as ReplayDriverGamePort);
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

  for (const command of canonicalReplay.commands) {
    await executeCommand(game, command);
    await drainReplayDecisions(game);
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
