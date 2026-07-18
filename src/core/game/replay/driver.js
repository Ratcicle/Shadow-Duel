import Game from "../../Game.js";
import {
  hashCanonicalGameState,
  validateCanonicalReplay,
} from "./canonical.js";

function playerFor(game, actorId) {
  return actorId === "bot" ? game.bot : game.player;
}

function findCard(game, actor, payload = {}) {
  const zones = [
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
    "deck",
    "extraDeck",
  ];
  for (const zone of zones) {
    const card = (actor?.[zone] || []).find(
      (entry) =>
        (payload.duelCardId != null && entry.duelCardId === payload.duelCardId) ||
        (payload.cardId != null && entry.id === payload.cardId),
    );
    if (card) return { card, zone, index: actor[zone].indexOf(card) };
  }
  if (
    actor?.fieldSpell &&
    ((payload.duelCardId != null && actor.fieldSpell.duelCardId === payload.duelCardId) ||
      (payload.cardId != null && actor.fieldSpell.id === payload.cardId))
  ) {
    return { card: actor.fieldSpell, zone: "fieldSpell", index: 0 };
  }
  return null;
}

async function executeCommand(game, command) {
  const actor = playerFor(game, command.actorId);
  const payload = command.payload || {};
  switch (command.type) {
    case "noop":
      return true;
    case "draw":
      return game.drawCards(actor, Number(payload.amount || 1));
    case "shuffle":
      return game.shuffle(actor.deck);
    case "set_phase":
      game.phase = payload.phase;
      return true;
    case "set_lp":
      actor.lp = Number(payload.lp);
      return true;
    case "phase_intent":
      return payload.toPhase
        ? game.skipToPhase(payload.toPhase)
        : game.nextPhase();
    case "summon":
    case "set_monster": {
      const source = findCard(game, actor, payload);
      if (!source || source.zone !== "hand") throw new Error("Replay summon source is missing.");
      return game.performNormalSummon(
        actor,
        source.index,
        payload.position || "attack",
        command.type === "set_monster" || payload.facedown === true,
        payload.tributeIndices || null,
      );
    }
    case "set_spell_trap": {
      const source = findCard(game, actor, payload);
      if (!source || source.zone !== "hand") throw new Error("Replay Set source is missing.");
      return game.setSpellOrTrap(source.card, source.index, actor);
    }
    case "flip_summon": {
      const source = findCard(game, actor, payload);
      if (!source || source.zone !== "field") {
        throw new Error("Replay Flip Summon source is missing.");
      }
      return game.flipSummon(source.card);
    }
    case "extra_deck_summon": {
      const source = findCard(game, actor, payload);
      if (!source || source.zone !== "extraDeck") {
        throw new Error("Replay Extra Deck source is missing.");
      }
      const materials = (payload.materialIds || [])
        .map((duelCardId) => findCard(game, actor, { duelCardId })?.card || null)
        .filter(Boolean);
      const options = {
        position: payload.position,
        ...(materials.length > 0 ? { materials } : {}),
      };
      if (payload.summonType === "synchro") {
        return game.performSynchroSummonFromExtraDeck(source.card, actor, options);
      }
      if (payload.summonType === "ascension") {
        return game.performAscensionSummonFromExtraDeck(source.card, actor, {
          position: payload.position,
          ...(materials[0] ? { material: materials[0] } : {}),
        });
      }
      return game.performExtraDeckSummonProcedure(source.card, actor, options);
    }
    case "activate_effect":
    case "activate_card": {
      const source = findCard(game, actor, payload);
      if (!source) throw new Error("Replay activation source is missing.");
      if (source.card.cardKind === "monster") {
        return game.tryActivateMonsterEffect(
          source.card,
          null,
          source.zone,
          actor,
          { effectId: payload.effectId || null },
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
        effectId: payload.effectId || null,
      });
    }
    case "change_position": {
      const source = findCard(game, actor, payload);
      if (!source || source.zone !== "field") {
        throw new Error("Replay position-change source is missing.");
      }
      return game.changeMonsterPosition(source.card, payload.position);
    }
    case "attack": {
      const attacker = findCard(game, actor, { duelCardId: payload.attackerId });
      const opponent = game.getOpponent(actor);
      const target = payload.targetId == null
        ? null
        : findCard(game, opponent, { duelCardId: payload.targetId });
      if (!attacker) throw new Error("Replay attacker is missing.");
      return game.resolveCombat(attacker.card, target?.card || null, { player: actor });
    }
    default:
      throw new Error(`Unsupported canonical replay command "${command.type}".`);
  }
}

async function drainReplayDecisions(game) {
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

export async function replayCanonicalDuel(replay, options = {}) {
  validateCanonicalReplay(replay);
  const game = options.game || new Game({
    renderer: null,
    randomSeed: replay.setup.seed,
    replayMode: "playback",
    captureReplay: false,
    chainResponseTimeoutMs: 0,
  });
  game.decisionBroker.loadReplayDecisions(replay.decisions);
  await game.startWithDecks({
    exactDecks: true,
    preserveDeckOrder: true,
    initializeOnly: true,
    startAtDrawPhase: true,
    announceStartingPlayer: false,
    startingPlayer: replay.setup.startingPlayer,
    initialRandomState: replay.setup.randomState,
    playerDeck: replay.setup.playerDeck,
    playerExtraDeck: replay.setup.playerExtraDeck,
    botDeck: replay.setup.botDeck,
    botExtraDeck: replay.setup.botExtraDeck,
  });

  for (const command of replay.commands) {
    await executeCommand(game, command);
    await drainReplayDecisions(game);
    const observedHash = hashCanonicalGameState(game);
    if (command.stateHash && observedHash !== command.stateHash) {
      const error = new Error(
        `Replay divergence at command ${command.sequence} (${command.type}): expected ${command.stateHash}, observed ${observedHash}.`,
      );
      error.sequence = command.sequence;
      error.command = command;
      error.expectedHash = command.stateHash;
      error.observedHash = observedHash;
      throw error;
    }
  }

  if (game.decisionBroker.replayCursor !== replay.decisions.length) {
    throw new Error(
      `Replay finished with ${replay.decisions.length - game.decisionBroker.replayCursor} unconsumed decision(s).`,
    );
  }

  const finalStateHash = hashCanonicalGameState(game);
  if (replay.result?.finalStateHash && finalStateHash !== replay.result.finalStateHash) {
    throw new Error(
      `Replay final hash mismatch: expected ${replay.result.finalStateHash}, observed ${finalStateHash}.`,
    );
  }
  return { ok: true, game, finalStateHash, commands: replay.commands.length };
}
