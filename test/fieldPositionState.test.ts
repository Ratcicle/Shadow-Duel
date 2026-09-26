import test from "node:test";
import assert from "node:assert/strict";
import Game from "../src/core/Game.js";
import { cardDatabase } from "../src/data/cards.js";
import { normalizeScenarioSetup } from "../src/core/game/devTools/setup.js";
import { compareZoneSnapshot } from "../src/core/game/zones/snapshot.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, hashCanonicalValue, validateCanonicalReplay } from "../src/core/game/replay/canonical.js";
import { required } from "./helpers/fixtures.js";

const monsterId = required(cardDatabase.find((card) => card.cardKind === "monster")).id;
const spellId = required(cardDatabase.find((card) => card.cardKind === "spell" && card.subtype !== "field")).id;

test("legacy setups normalize positions once without mutating their input", () => {
  const setup = { player: { field: [{ id: monsterId }, { id: monsterId }] }, bot: { spellTrap: [{ id: spellId }] } };
  const before = structuredClone(setup);
  const normalized = normalizeScenarioSetup(setup);
  assert.deepEqual(normalized.player?.field?.map((entry) => typeof entry === "string" ? null : entry.fieldSlot), [0, 1]);
  assert.deepEqual(normalized.bot?.spellTrap?.map((entry) => typeof entry === "string" ? null : entry.fieldSlot), [0]);
  assert.deepEqual(setup, before);
});

test("modern setup positions are mandatory, unique and in range before any live mutation", () => {
  const game = new Game();
  try {
    assert.equal(game.applyScenarioSetup({ player: { lp: 7100, field: [{ id: monsterId }] } }).success, true);
    const original = game.player.field[0];
    for (const field of [
      [{ id: monsterId, fieldSlot: 4 }, { id: monsterId, fieldSlot: 4 }],
      [{ id: monsterId, fieldSlot: 5 }],
      [{ id: monsterId, fieldSlot: 1.5 }],
      [{ id: monsterId }],
    ]) {
      const result = game.applyScenarioSetup({ schemaVersion: 2, player: { lp: 1, field } });
      assert.equal(result.success, false);
      assert.equal(game.player.lp, 7100);
      assert.strictEqual(game.player.field[0], original);
    }
    assert.throws(() => normalizeScenarioSetup({ player: { field: [{ id: monsterId, fieldSlot: 3 }, { id: monsterId }] } }), /fieldSlot/);
  } finally {
    game.dispose();
  }
});

test("explicit setup positions survive normalization and new placement only fills a vacancy", async (t) => {
  const game = new Game({ disableChains: true, disableTraps: true });
  t.after(() => game.dispose());
  const side = {
    field: [{ id: monsterId, fieldSlot: 4 }, { id: monsterId, fieldSlot: 0 }],
    spellTrap: [{ id: spellId, fieldSlot: 4 }, { id: spellId, fieldSlot: 0 }],
  };
  const setup = { schemaVersion: 2 as const, player: structuredClone(side), bot: structuredClone(side) };
  const before = structuredClone(setup);
  assert.deepEqual(normalizeScenarioSetup(setup), setup);
  assert.equal(game.applyScenarioSetup(setup).success, true);
  for (const owner of [game.player, game.bot]) {
    for (const row of ["field", "spellTrap"] as const) {
      const original = [...owner[row]];
      assert.deepEqual(original.map(card => card.fieldSlot), [4, 0]);
      const card = required(game.createCardForOwner({ id: row === "field" ? monsterId : spellId }, owner));
      owner.hand.push(card);
      const placement = await game.prepareFieldPlacement(card, owner, row);
      assert.equal(placement.outcome, "chosen");
      if (placement.outcome !== "chosen") assert.fail("Expected an available position.");
      assert.equal(placement.intent.slot, 2);
      assert.deepEqual(owner[row], original);
      assert.deepEqual(original.map(item => item.fieldSlot), [4, 0]);
    }
  }
  assert.deepEqual(setup, before);
});

test("public and canonical snapshots preserve slots while concealing opposing set identities", () => {
  const game = new Game();
  try {
    game.applyScenarioSetup({ schemaVersion: 2, player: { field: [{ id: monsterId, fieldSlot: 4 }] }, bot: { field: [{ id: monsterId, fieldSlot: 2, facedown: true }], spellTrap: [{ id: spellId, fieldSlot: 3, facedown: true }] } });
    const publicState = game.getPublicState();
    assert.equal(publicState.schemaVersion, 2);
    const hiddenMonster = required(publicState.players.opponent.field[0]);
    const hiddenSpell = required(publicState.players.opponent.spellTrap[0]);
    assert.equal(hiddenMonster.fieldSlot, 2);
    assert.equal(hiddenMonster.cardId, null);
    assert.equal(hiddenMonster.properSummonEstablished, null);
    assert.equal(hiddenSpell.fieldSlot, 3);
    assert.equal(hiddenSpell.cardId, null);
    assert.equal(hiddenSpell.cardKind, null);
    assert.equal(required(game.getPublicState("bot").players.self.field[0]).cardId, monsterId);
    const hashBefore = hashCanonicalValue(createCanonicalStateSnapshot(game));
    required(game.player.field[0]).fieldSlot = 1;
    assert.notEqual(hashCanonicalValue(createCanonicalStateSnapshot(game)), hashBefore);
  } finally {
    game.dispose();
  }
});

test("zone rollback restores positions and releases cards created after its snapshot", () => {
  const game = new Game();
  try {
    game.applyScenarioSetup({ player: { field: [{ id: monsterId }] } });
    const card = required(game.player.field[0]);
    const snapshot = game.captureZoneSnapshot("positions");
    card.fieldSlot = 4;
    assert.equal(compareZoneSnapshot(snapshot, game.captureZoneSnapshot("changed")), false);
    const created = required(game.createCardForOwner({ id: monsterId }, game.player));
    created.fieldSlot = 1;
    game.player.field.push(created);
    game.restoreZoneSnapshot(snapshot);
    assert.equal(card.fieldSlot, 0);
    assert.equal(created.fieldSlot, null);
    assert.deepEqual(game.player.field, [card]);
    assert.equal(compareZoneSnapshot(snapshot, game.captureZoneSnapshot("restored")), true);
  } finally {
    game.dispose();
  }
});

test("replay v2 rejects absent, duplicate or non-field positions instead of repairing them", () => {
  const game = new Game();
  try {
    game.applyScenarioSetup({ player: { field: [{ id: monsterId }, { id: monsterId }], hand: [{ id: monsterId }] } });
    const replay = {
      format: "shadow-duel-canonical-replay", schemaVersion: 2,
      cardDatabaseSignature: getCardDatabaseSignature(),
      setup: { seed: 1, randomState: null, startingPlayer: "player", playerDeck: [], botDeck: [], playerExtraDeck: [], botExtraDeck: [] },
      commands: [], decisions: [], result: { finalState: createCanonicalStateSnapshot(game) },
    };
    assert.doesNotThrow(() => validateCanonicalReplay(replay));
    const invalid = structuredClone(replay);
    required(invalid.result.finalState.players.player.zones.field[1]).fieldSlot = 0;
    assert.throws(() => validateCanonicalReplay(invalid), /unique occupied slot/);
    const absent = structuredClone(replay);
    Reflect.deleteProperty(required(absent.result.finalState.players.player.zones.field[0]), "fieldSlot");
    assert.throws(() => validateCanonicalReplay(absent), /fieldSlot/);
    const outside = structuredClone(replay);
    required(outside.result.finalState.players.player.zones.hand[0]).fieldSlot = 2;
    assert.throws(() => validateCanonicalReplay(outside), /null outside a field row/);
    assert.equal(required(game.player.field[1]).fieldSlot, 1);
  } finally {
    game.dispose();
  }
});

test("snapshots include Flip Summon cards temporarily absent from their field list", () => {
  const game = new Game();
  try {
    game.applyScenarioSetup({ player: { field: [{ id: monsterId, fieldSlot: 4, facedown: true }] } });
    const card = required(game.player.field.pop());
    const prepared = game.createPreparedSummon({ card, controller: game.player, summonMethod: "flip", summonOrigin: "procedure", sourceZone: "field" });
    const transaction = game.beginSummonTransaction(prepared);
    assert.ok(transaction.ok);
    assert.strictEqual(game.activeSummonTransaction, transaction.transaction);
    const snapshot = game.captureZoneSnapshot("flip-in-transit");
    assert.equal(snapshot.cardState.get(card)?.fieldSlot, 4);
    card.fieldSlot = null;
    game.restoreZoneSnapshot(snapshot);
    assert.equal(card.fieldSlot, 4);
    assert.deepEqual(game.player.field, []);
  } finally {
    game.dispose();
  }
});

test("technical placement rollback preserves a completed response and its occupied slot", async () => {
  const game = new Game({ devMode: true, disableChains: true, captureReplay: false });
  try {
    game.applyScenarioSetup({ phase: "main1", player: { hand: [{ id: monsterId }, { id: spellId }] } });
    const entrant = required(game.player.hand[0]);
    const response = required(game.player.hand[1]);
    game.offerSummonAttempt = async (_card, _player, options) => {
      const placed = await game.moveCard(response, game.player, "spellTrap", { fromZone: "hand" });
      assert.equal(placed.success, true);
      game.devFailAfterZoneMutation = true;
      return { ok: true, transaction: required(required(options).summonTransaction), ownsTransaction: false };
    };
    const result = required(await game.performNormalSummon(game.player, 0, "attack", false));
    assert.equal(result.success, false);
    assert.deepEqual(game.player.spellTrap, [response]);
    assert.equal(response.fieldSlot, 2);
    assert.equal(game.player.hand.includes(response), false);
    assert.equal(game.player.field.includes(entrant), false);
    assert.equal(entrant.fieldSlot, null);
    assert.equal(game.zoneOpSnapshot, null);
    assert.equal(game.activeSummonTransaction, null);
  } finally {
    game.dispose();
  }
});

test("failed control transfer restores controller, slot and temporary return record", async () => {
  const game = new Game({ disableChains: true, captureReplay: false });
  try {
    game.applyScenarioSetup({ bot: { field: [{ id: monsterId, fieldSlot: 3 }] } });
    const card = required(game.bot.field[0]);
    await game.takeControl(card, game.player, { duration: "until_end_phase" });
    const records = structuredClone(game.temporaryControlEffects);
    const originalEmit = game.emit.bind(game);
    game.emit = async (event, payload, options) => {
      if (event === "control_changed") throw new Error("injected control publication failure");
      return originalEmit(event, payload, options);
    };
    const result = await game.transferControl(card, game.bot);
    assert.equal(result.success, false);
    assert.equal(card.controller, game.player.id);
    assert.equal(card.fieldSlot, 2);
    assert.deepEqual(game.player.field, [card]);
    assert.deepEqual(game.bot.field, []);
    assert.deepEqual(game.temporaryControlEffects, records);
  } finally {
    game.dispose();
  }
});

test("technical D2 destruction rollback preserves the pending return record and holder slot", async () => {
  const game = new Game({ devMode: true, disableChains: true, captureReplay: false });
  try {
    game.turnCounter = 7;
    game.applyScenarioSetup({ bot: { field: [{ id: monsterId }] } });
    const card = required(game.bot.field[0]);
    await game.takeControl(card, game.player, { duration: "until_end_phase" });
    game.applyScenarioSetup({ bot: { field: Array.from({ length: 5 }, () => ({ id: monsterId })) } });
    const records = structuredClone(game.temporaryControlEffects);
    game.devFailAfterZoneMutation = true;
    await assert.rejects(() => game.processTemporaryControlEffects(), /Temporary control rule destruction failed/);
    assert.deepEqual(game.player.field, [card]);
    assert.equal(card.fieldSlot, 2);
    assert.deepEqual(game.temporaryControlEffects, records);
    assert.equal(game.bot.graveyard.includes(card), false);
    await game.processTemporaryControlEffects();
    assert.deepEqual(game.temporaryControlEffects, []);
    assert.equal(game.bot.graveyard.includes(card), true);
    assert.equal(card.fieldSlot, null);
  } finally {
    game.dispose();
  }
});
