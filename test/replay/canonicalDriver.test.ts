import test from "node:test";
import assert from "node:assert/strict";

import type {
  CanonicalReplayCommand,
  ReplayDriverGamePort,
  ReplayRuntimeCard,
  ReplayRuntimePlayer,
} from "../../src/core/contracts/replay.js";
import {
  createCanonicalStateSnapshot,
  getCardDatabaseSignature,
} from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";

interface DriverFixture {
  game: ReplayDriverGamePort;
  calls: string[];
}

function player(id: "player" | "bot"): ReplayRuntimePlayer {
  return {
    id,
    lp: 8000,
    deck: [],
    extraDeck: [],
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
}

function driverFixture(consumeDecisions = true): DriverFixture {
  const calls: string[] = [];
  const human = player("player");
  const bot = player("bot");
  human.hand.push(
    { id: 1, duelCardId: 1, cardKind: "monster" },
    { id: 2, duelCardId: 2, cardKind: "spell" },
  );
  human.field.push(
    { id: 4, duelCardId: 4, cardKind: "monster" },
    { id: 41, duelCardId: 41, cardKind: "monster" },
  );
  human.extraDeck.push({ id: 5, duelCardId: 5, cardKind: "monster" });
  bot.field.push({ id: 9, duelCardId: 9, cardKind: "monster" });

  const game: ReplayDriverGamePort = {
    player: human,
    bot,
    phase: "draw",
    turn: "player",
    turnCounter: 1,
    decisionBroker: {
      replayCursor: 0,
      loadReplayDecisions(decisions) {
        calls.push("loadReplayDecisions");
        this.replayCursor = consumeDecisions ? decisions.length : 0;
      },
    },
    async startWithDecks() {
      calls.push("startWithDecks");
    },
    drawCards(_owner, amount) {
      calls.push(`draw:${amount}`);
    },
    shuffle() {
      calls.push("shuffle");
    },
    nextPhase() {
      calls.push("nextPhase");
    },
    skipToPhase(phase) {
      calls.push(`skipToPhase:${phase}`);
    },
    performNormalSummon(_owner, cardIndex, position, facedown) {
      calls.push(`normalSummon:${cardIndex}:${position}:${facedown}`);
    },
    setSpellOrTrap(card) {
      calls.push(`setSpellTrap:${card.id}`);
    },
    flipSummon(card) {
      calls.push(`flipSummon:${card.id}`);
    },
    performSynchroSummonFromExtraDeck(card) {
      calls.push(`synchro:${card.id}`);
    },
    performAscensionSummonFromExtraDeck(card) {
      calls.push(`ascension:${card.id}`);
    },
    performExtraDeckSummonProcedure(card) {
      calls.push(`procedure:${card.id}`);
    },
    tryActivateMonsterEffect(card) {
      calls.push(`monsterEffect:${card.id}`);
    },
    tryActivateSpell(card) {
      calls.push(`spell:${card.id}`);
    },
    tryActivateSpellTrapEffect(card) {
      calls.push(`spellTrapEffect:${card.id}`);
    },
    changeMonsterPosition(card, position) {
      calls.push(`position:${card.id}:${position}`);
    },
    getOpponent(owner) {
      return owner === human ? bot : human;
    },
    resolveCombat(attacker, target) {
      calls.push(`attack:${attacker.id}:${target?.id ?? "direct"}`);
    },
  };
  return { game, calls };
}

function replay(commands: ReadonlyArray<CanonicalReplayCommand> = []) {
  const decisions: unknown[] = [];
  return {
    format: "shadow-duel-canonical-replay",
    schemaVersion: 1,
    engineVersion: "phase-9",
    cardDatabaseSignature: getCardDatabaseSignature(),
    setup: {
      seed: 123,
      randomState: { seed: 123, state: 123, calls: 0 },
      startingPlayer: "player",
      playerDeck: [],
      playerExtraDeck: [],
      botDeck: [],
      botExtraDeck: [],
    },
    commands,
    decisions,
  };
}

function command<Type extends CanonicalReplayCommand["type"]>(
  sequence: number,
  type: Type,
  payload: Extract<CanonicalReplayCommand, { type: Type }>["payload"],
): Extract<CanonicalReplayCommand, { type: Type }> {
  return { sequence, type, actorId: "player", payload } as Extract<
    CanonicalReplayCommand,
    { type: Type }
  >;
}

test("driver executa os 15 command types suportados", async () => {
  const commands: CanonicalReplayCommand[] = [
    command(1, "noop", {}),
    command(2, "draw", { amount: 2 }),
    command(3, "shuffle", {}),
    command(4, "set_phase", { phase: "main1" }),
    command(5, "set_lp", { lp: 7000 }),
    command(6, "phase_intent", { fromPhase: "main1", toPhase: "battle" }),
    command(7, "summon", {
      duelCardId: 1,
      cardId: 1,
      position: "attack",
      facedown: false,
    }),
    command(8, "set_monster", {
      duelCardId: 1,
      cardId: 1,
      position: "defense",
      facedown: true,
    }),
    command(9, "set_spell_trap", { duelCardId: 2, cardId: 2 }),
    command(10, "flip_summon", { duelCardId: 4, cardId: 4 }),
    command(11, "extra_deck_summon", {
      duelCardId: 5,
      cardId: 5,
      summonType: "synchro",
      position: "attack",
      materialIds: [41],
    }),
    command(12, "activate_effect", {
      duelCardId: 4,
      cardId: 4,
      sourceZone: "field",
      effectId: "monster-effect",
    }),
    command(13, "activate_card", {
      duelCardId: 2,
      cardId: 2,
      sourceZone: "hand",
      effectId: null,
    }),
    command(14, "change_position", {
      duelCardId: 4,
      cardId: 4,
      position: "defense",
    }),
    command(15, "attack", { attackerId: 4, targetId: 9 }),
  ];
  const fixture = driverFixture();
  const result = await replayCanonicalDuel(replay(commands), {
    game: fixture.game,
  });

  assert.equal(result.ok, true);
  assert.equal(result.commands, 15);
  assert.equal(fixture.game.phase, "main1");
  assert.equal(fixture.game.player.lp, 7000);
  assert.deepEqual(fixture.calls, [
    "loadReplayDecisions",
    "startWithDecks",
    "draw:2",
    "shuffle",
    "skipToPhase:battle",
    "normalSummon:0:attack:false",
    "normalSummon:0:defense:true",
    "setSpellTrap:2",
    "flipSummon:4",
    "synchro:5",
    "monsterEffect:4",
    "spell:2",
    "position:4:defense",
    "attack:4:9",
  ]);
});

test("comando desconhecido é rejeitado antes de inicializar o Game", async () => {
  const fixture = driverFixture();
  const invalidReplay = replay();
  const mutable = invalidReplay as Record<string, unknown>;
  mutable.commands = [{
    sequence: 1,
    type: "unsupported_action",
    actorId: "player",
    payload: {},
  }];

  await assert.rejects(
    () => replayCanonicalDuel(invalidReplay, { game: fixture.game }),
    /Unsupported canonical replay command "unsupported_action"\./,
  );
  assert.deepEqual(fixture.calls, []);
});

test("busca usa duelCardId e mantém fallback legado por cardId", async () => {
  const fixture = driverFixture();
  const commands: CanonicalReplayCommand[] = [
    command(1, "set_spell_trap", { duelCardId: 999, cardId: 2 }),
    command(2, "change_position", {
      duelCardId: 4,
      cardId: 999,
      position: "attack",
    }),
  ];

  await replayCanonicalDuel(replay(commands), { game: fixture.game });
  assert.ok(fixture.calls.includes("setSpellTrap:2"));
  assert.ok(fixture.calls.includes("position:4:attack"));
});

test("duelCardId exato tem prioridade sobre colisão no fallback por cardId", async () => {
  const fixture = driverFixture();
  fixture.game.player.hand.unshift(
    { id: 77, duelCardId: 700, cardKind: "spell" },
  );
  fixture.game.player.hand.push(
    { id: 77, duelCardId: 701, cardKind: "spell" },
  );
  fixture.game.setSpellOrTrap = (card) => {
    fixture.calls.push(`collision:${card.duelCardId}`);
  };

  await replayCanonicalDuel(replay([
    command(1, "set_spell_trap", { duelCardId: 701, cardId: 77 }),
  ]), { game: fixture.game });

  assert.ok(fixture.calls.includes("collision:701"));
  assert.ok(!fixture.calls.includes("collision:700"));
});

test("driver rejeita decisões restantes", async () => {
  const fixture = driverFixture(false);
  const input = replay();
  input.decisions.push({
    sequence: 1,
    decisionId: 1,
    kind: "chain_response",
    actorId: "player",
    candidateKeys: [],
    value: { pass: true },
    context: null,
  });

  await assert.rejects(
    () => replayCanonicalDuel(input, { game: fixture.game }),
    /finished with 1 unconsumed decision\(s\)/,
  );
});

test("driver rejeita hash final divergente", async () => {
  const fixture = driverFixture();
  const input = {
    ...replay(),
    result: {
      winner: null,
      reason: "test",
      finalStateHash: "deadbeef",
      finalState: createCanonicalStateSnapshot(fixture.game),
    },
  };

  await assert.rejects(
    () => replayCanonicalDuel(input, { game: fixture.game }),
    /Replay final hash mismatch: expected deadbeef, observed [0-9a-f]{8}/,
  );
});
