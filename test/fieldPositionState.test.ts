import test from "node:test";
import assert from "node:assert/strict";
import Game from "../src/core/Game.js";
import Card from "../src/core/Card.js";
import type { EffectDefinition } from "../src/core/contracts/effects.js";
import type ChainSystem from "../src/core/ChainSystem.js";
import { applyPassiveBuffValue } from "../src/core/effects/passives/passiveBuffs.js";
import { CANONICAL_REPLAY_ENGINE_VERSION } from "../src/core/contracts/replay.js";
import { cardDatabase } from "../src/data/cards.js";
import { normalizeScenarioSetup } from "../src/core/game/devTools/setup.js";
import { compareZoneSnapshot } from "../src/core/game/zones/snapshot.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, hashCanonicalValue, validateCanonicalReplay } from "../src/core/game/replay/canonical.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

const monsterId = required(cardDatabase.find((card) => card.cardKind === "monster")).id;
const spellId = required(cardDatabase.find((card) => card.cardKind === "spell" && card.subtype !== "field")).id;

test("zone rollback restores presence counters and passive contributions without sharing their baseline", t => {
  const game = createRuntimeGame({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose());
  const metal = new Card(cardDefinition(253), "player");
  placeFieldCards(game.player.field, metal);
  metal.fieldPresenceState = { summon_count_Dragon: 1 };
  const buffKey = "metal_armored_dragon_field_presence_buff";
  applyPassiveBuffValue(metal, buffKey, 100, ["atk", "def"]);
  const snapshot = game.captureZoneSnapshot("metal-counter");
  const baseline = required(snapshot.cardState.get(metal));
  metal.fieldPresenceState.summon_count_Dragon = 2;
  applyPassiveBuffValue(metal, buffKey, 200, ["atk", "def"]);
  assert.deepEqual(baseline.fieldPresenceState, { summon_count_Dragon: 1 });
  assert.deepEqual(baseline.dynamicBuffs?.[buffKey], {
    value: 100, stats: ["atk", "def"], appliedValues: { atk: 100, def: 100 },
  });

  game.restoreZoneSnapshot(snapshot);
  assert.equal(metal.atk, 1700);
  assert.equal(metal.def, 2100);
  assert.notEqual(metal.fieldPresenceState, baseline.fieldPresenceState);
  assert.notEqual(metal.dynamicBuffs, baseline.dynamicBuffs);
  const restoredBuff = required(metal.dynamicBuffs?.[buffKey]);
  const savedBuff = required(baseline.dynamicBuffs?.[buffKey]);
  assert.notEqual(restoredBuff.stats, savedBuff.stats);
  assert.notEqual(restoredBuff.appliedValues, savedBuff.appliedValues);
  required(metal.fieldPresenceState).summon_count_Dragon = 3;
  restoredBuff.stats = ["atk"];
  required(restoredBuff.appliedValues).atk = 300;
  assert.deepEqual(baseline.fieldPresenceState, { summon_count_Dragon: 1 });
  assert.deepEqual(savedBuff, { value: 100, stats: ["atk", "def"], appliedValues: { atk: 100, def: 100 } });
  game.restoreZoneSnapshot(snapshot);
  game.effectEngine.updatePassiveBuffs();
  assert.equal(metal.atk, 1700);
  assert.equal(metal.def, 2100);
});

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
      format: "shadow-duel-canonical-replay", schemaVersion: 2, engineVersion: CANONICAL_REPLAY_ENGINE_VERSION,
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

for (const projection of ["pending", "active", "suspended"] as const) {
  test(`public trigger ${projection} state conceals hidden references while canonical capture retains them`, async t => {
    const snapshots = [];
    for (const hiddenEffectId of ["hidden_reference_a", "hidden_reference_b"]) {
      const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true, laboratoryUseBot: false });
      t.after(() => game.dispose());
      Object.assign(game, { turn: "player", phase: "main1", turnCounter: 4 });
      const target = new Card(cardDefinition(1), game.player.id);
      placeFieldCards(game.player.field, target);
      const effect = { id: hiddenEffectId, timing: "on_event", event: "card_moved",
        triggerRequirement: "optional", triggerTiming: "if", requireZone: "spellTrap", requireFaceup: true,
        targets: [{ id: "hidden_reference", intent: "reference", targetFromContext: "eventCard",
          owner: "opponent", zone: "field", count: { min: 1, max: 1 } }],
        actions: [{ type: "heal", amount: 100, player: "self" }] } satisfies EffectDefinition;
      const handSource = new Card({ ...cardDefinition(268), effects: [effect] }, game.bot.id);
      const setSource = new Card({ ...cardDefinition(268), effects: [effect] }, game.bot.id);
      Object.assign(setSource, { isFacedown: true, setTurn: 1 });
      game.bot.hand.push(handSource);
      placeFieldCards(game.bot.spellTrap, setSource);
      for (const card of [target, handSource, setSource]) game.ensureDuelCardId(card);
      const chain: ChainSystem = game.chainSystem;
      const createOccurrence = chain.createTriggerOccurrence.bind(chain);
      const capturedOccurrences: NonNullable<ReturnType<typeof createOccurrence>>[] = [];
      chain.createTriggerOccurrence = (...args) => {
        const occurrence = createOccurrence(...args);
        if (occurrence) capturedOccurrences.push(occurrence);
        return occurrence;
      };
      const captured = await game.resolveEvent("card_moved", {
        card: target, player: game.player, fromZone: "hand", toZone: "field",
      }, { collectTriggersOnly: true });
      const occurrence = required(capturedOccurrences[0]);
      assert.equal(occurrence, captured.occurrence);
      assert.equal(occurrence.referenceSnapshots?.length, 2, "both ineligible hidden sources have captured references");
      assert.deepEqual(occurrence.entries, [], "neither hidden source is eligible to activate");
      if (projection === "pending") game.chainSystem.queueTriggerOccurrence(occurrence);
      else game.chainSystem.buildTriggerOpportunity([occurrence]);
      if (projection === "suspended") {
        const parentTriggers = game.chainSystem.getTriggerState();
        // The public serializer consumes this same closed producer surface for
        // a parent frame; frame lifecycle itself is covered by afterEffectResolution.
        game.chainSystem.getAfterResolutionState = () => ({ suspended: [{
          chainId: 1, resolving: true, windowOpen: false, links: [],
          timing: game.chainSystem.getFastEffectState(), afterResolution: null,
          triggers: parentTriggers, selection: null, finalizations: [],
        }] });
        game.chainSystem.activeTriggerOpportunity = null;
      }
      snapshots.push({ public: game.getPublicState("player"), canonical: createCanonicalStateSnapshot(game) });
    }
    const first = required(snapshots[0]), second = required(snapshots[1]);
    assert.deepEqual(first.public, second.public, "identical visible states must not expose hidden effect/reference facts");
    assert.notDeepEqual(first.canonical.chain, second.canonical.chain, "canonical Chain state retains authoritative hidden facts");
    const publicJson = JSON.stringify(first.public);
    assert.equal(publicJson.includes("hidden_reference_a"), false);
    assert.equal(publicJson.includes("referenceSnapshots"), false);
    assert.equal(publicJson.includes("pendingOccurrences"), false);
    assert.equal(publicJson.includes("activeOccurrences"), false);
    assert.equal(publicJson.includes("lastRelevantAtomicGroupId"), false);
  });
}
