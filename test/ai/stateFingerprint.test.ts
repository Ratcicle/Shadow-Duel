import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintPlanningState as fingerprint } from "../../src/core/ai/common/stateFingerprint.js";
import type { AiStateShape, SimulatedCardShape, SimulatedCardState, SimulatedPlayerState } from "../../src/core/contracts/aiState.js";
import { cardDatabase, required, unsafeFixture } from "../helpers/fixtures.js";

function card(instanceId: number): SimulatedCardState {
  return unsafeFixture<SimulatedCardState>({
    instanceId, id: required(cardDatabase[0]).id, name: "Same definition", cardKind: "monster", level: 4,
    atk: 1000, def: 800, position: "attack", isFacedown: false,
    counters: new Map([["charge", 1], ["spore", 2]]),
  } satisfies SimulatedCardShape, "Minimal simulation card; brand normally established by planner clone");
}

function player(id: string): SimulatedPlayerState {
  return {
    id, lp: 8000, hand: [card(1), card(2)], field: [card(3), card(4)],
    spellTrap: [card(5)], deck: [card(6), card(7)], graveyard: [card(8)],
    extraDeck: [card(9)], banished: [card(10)], fieldSpell: card(11),
    summonCount: 0, additionalNormalSummons: 0,
  };
}

function fixture(): AiStateShape {
  const bot = player("bot");
  const opponent = player("player");
  for (const zone of ["hand", "field", "spellTrap", "deck", "graveyard", "extraDeck", "banished"] as const) {
    for (const entry of opponent[zone]) entry.instanceId = required(entry.instanceId) + 100;
  }
  required(opponent.fieldSpell).instanceId = 111;
  return { bot, player: opponent, phase: "main1", turn: "bot", turnCounter: 3, _isPerspectiveState: true };
}

const changes: Array<[string, (state: AiStateShape, host: SimulatedCardState) => void]> = [
  ["ATK", (_, c) => { c.atk = 1001; }],
  ["DEF", (_, c) => { c.def = 801; }],
  ["temporary modifier", (_, c) => { c.tempAtkBoost = 200; }],
  ["dynamic buff", (_, c) => { c.dynamicBuffs = { aura: { appliedValues: { atk: 200 } } }; }],
  ["suppressed dynamic buff", (_, c) => { c.suppressedDynamicBuffStatsByKey = { aura: { atk: true } }; }],
  ["Level", (_, c) => { c.level = 5; }],
  ["position", (_, c) => { c.position = "defense"; }],
  ["face down", (_, c) => { c.isFacedown = true; }],
  ["counter count", (_, c) => { c.counters?.set("charge", 2); }],
  ["counter distribution", (_, c) => { c.counters = new Map([["charge", 2], ["spore", 1]]); }],
  ["instance", (_, c) => { c.instanceId = 50; }],
  ["definition", (_, c) => { c.id = required(cardDatabase[1]).id; }],
  ["owner", (_, c) => { c.owner = "player"; }],
  ["controller", (_, c) => { c.controller = "player"; }],
  ["normal summon used", s => { s.bot.summonCount = 1; }],
  ["additional summon", s => { s.bot.additionalNormalSummons = 1; }],
  ["summon permission", s => { s.bot.additionalNormalSummonPermissions = [{ count: 1, filters: { level: 4 } }]; }],
  ["summon history", s => { s.bot.normalSummonsThisTurn = [{ unknown: true }]; }],
  ["special summon restriction", s => { s.bot.specialSummonRestrictions = [{ allowedFilters: { archetype: "test" }, duration: "turn", expiresOnTurn: 4, reason: null, sourceName: null, sourceId: null, effectId: null }]; }],
  ["activation restriction", s => { s.bot.effectActivationRestrictions = [{ blockedNames: ["Same definition"], allowedAttributes: [], restrictedCardFilters: {}, duration: "turn", expiresOnTurn: 4, reason: null, sourceName: null, sourceId: null, effectId: null }]; }],
  ["player usage", s => { s.bot.oncePerTurnUsageByName = { test: { turn: 3, count: 1 } }; }],
  ["card usage", (_, c) => { c.oncePerTurnUsageByName = { test: 3 }; }],
  ["simulated OPT", s => { s._simOncePerTurn = { bot: new Map([["effect", 1]]) }; }],
  ["Arcanist OPT", s => { s._simArcanistOptUsed = new Set(["effect"]); }],
  ["passive OPT", s => { s._simPassiveOncePerTurn = new Map([["effect", 1]]); }],
  ["Dragon usage", s => { s._dragonSimOnce = { bot: { effect: true } }; }],
  ["usage snapshot", s => { s.usedThisTurn = new Map([["effect", 3]]); }],
  ["effect negation", (_, c) => { c.effectsNegated = true; }],
  ["negation duration", (_, c) => { c.effectsNegatedDuration = "until_end_turn"; }],
  ["protection", (_, c) => { c.protectionEffects = [{ type: "effect_destruction", duration: "turn", expiresOnTurn: 4 }]; }],
  ["simulation protection", (_, c) => { c._simProtectionEffects = [{ kind: "battle", duration: 4 }]; }],
  ["duration", (_, c) => { c.turnBasedBuffs = [{ stat: "atk", value: 200, expiresOnTurn: 4 }]; }],
  ["attack used", (_, c) => { c.attacksUsedThisTurn = 1; }],
  ["attack limit", (_, c) => { c.attackLimitThisTurn = 1; }],
  ["attack permission", (_, c) => { c.cannotAttackThisTurn = true; }],
  ["direct attack restriction", s => { s.bot.forbidDirectAttacksThisTurn = true; }],
  ["field presence", (_, c) => { c.fieldPresenceId = "new-presence"; }],
  ["location version", (_, c) => { c.locationVersion = 2; }],
  ["turn", s => { s.turn = "player"; }],
  ["phase", s => { s.phase = "main2"; }],
  ["turn count", s => { s.turnCounter = 4; }],
  ["perspective", s => { s.bot.id = "player"; s.player.id = "bot"; }],
  ["terminal flag", s => { Object.assign(s, { gameOver: true }); }],
  ["winner", s => { Object.assign(s, { winner: "player" }); }],
  ["blueprint", (_, c) => { c.state = { blueprintStorage: { storedBlueprints: [{ blueprintId: "stored", shortRulesText: "Draw", effectSnapshot: { id: "stored-effect", timing: "ignition", activationZones: ["field"], actions: [{ type: "draw", amount: 1 }] }, _simStoredByGrimoire: true }] } }; }],
  ["Luminarch resource", s => { s._simLuminarch = { pureKnightDiscountAvailable: true }; }],
  ["Burning West resource", s => { s._simBurningWest = { wantedRewardUsed: true }; }],
];

for (const [name, change] of changes) {
  test(`fingerprint distinguishes isolated ${name}`, () => {
    const state = fixture();
    const before = fingerprint(state);
    change(state, required(state.bot.field[0]));
    assert.notEqual(fingerprint(state), before);
  });
}

for (const zone of ["hand", "field", "spellTrap", "deck", "graveyard", "extraDeck", "banished"] as const) {
  test(`fingerprint preserves ${zone} identities at equal counts`, () => {
    const state = fixture();
    const before = fingerprint(state);
    required(state.bot[zone][0]).instanceId = 999;
    assert.notEqual(fingerprint(state), before);
  });
}

test("equivalent clones and reordered property/Map/Set insertion have the same key", () => {
  const state = fixture();
  state._simOptUsed = new Set(["b", "a"]);
  const copy = structuredClone(state);
  const original = required(copy.bot.field[0]);
  for (const key of Object.keys(original)) Reflect.deleteProperty(original, key);
  Object.assign(original, Object.fromEntries(Object.entries(required(state.bot.field[0])).reverse()));
  required(copy.bot.field[0]).counters = new Map([["spore", 2], ["charge", 1]]);
  copy._simOptUsed = new Set(["a", "b"]);
  assert.equal(fingerprint(copy), fingerprint(state));
});

test("zone order, repeated copies and empty indices remain observable", () => {
  const state = fixture();
  const original = fingerprint(state);
  state.bot.deck.reverse();
  assert.notEqual(fingerprint(state), original);
  state.bot.deck.reverse();
  state.bot.field.reverse(); // same definition, distinct instances
  assert.notEqual(fingerprint(state), original);
  const sparse = fixture();
  delete sparse.bot.field[0];
  const holeKey = fingerprint(sparse);
  sparse.bot.field.splice(0, 1);
  assert.notEqual(fingerprint(sparse), holeKey);
  const repeated = fixture();
  repeated.bot.field.push(required(repeated.bot.field[0]));
  assert.notEqual(fingerprint(repeated), original);
});

test("absence, false, zero, null and explicit undefined are not collapsed", () => {
  const keys = [undefined, false, 0, null].map(value => {
    const state = fixture();
    Reflect.set(required(state.bot.field[0]), "attackLimitThisTurn", value);
    return fingerprint(state);
  });
  keys.push(fingerprint(fixture()));
  assert.equal(new Set(keys).size, 5);
});

test("equal effective buffs with different expiry and blueprint actions remain distinct", () => {
  const state = fixture();
  const host = required(state.bot.field[0]);
  host.turnBasedBuffs = [{ stat: "atk", value: 300, expiresOnTurn: 3 }];
  const before = fingerprint(state);
  required(host.turnBasedBuffs[0]).expiresOnTurn = 4;
  assert.notEqual(fingerprint(state), before);
  host.state = { blueprintStorage: { storedBlueprints: [{ blueprintId: "same-id", shortRulesText: "", effectSnapshot: { id: "stored-effect", timing: "ignition", activationZones: ["field"], actions: [{ type: "draw", amount: 1 }] }, _simStoredByGrimoire: true }] } };
  const stored = fingerprint(state);
  required(required(host.state).blueprintStorage?.storedBlueprints[0]).effectSnapshot = { id: "stored-effect", timing: "ignition", activationZones: ["field"], actions: [{ type: "draw", amount: 2 }] };
  assert.notEqual(fingerprint(state), stored);
});

test("equipment cycles use stable instance links, including identical definitions", () => {
  const state = fixture();
  const first = required(state.bot.field[0]);
  const second = required(state.bot.field[1]);
  const equip = required(state.bot.spellTrap[0]);
  first.equips = [equip];
  equip.equippedTo = first;
  equip.equipTarget = first;
  const before = fingerprint(state);
  assert.equal(fingerprint(structuredClone(state)), before);
  equip.equippedTo = second;
  equip.equipTarget = second;
  first.equips = [];
  second.equips = [equip];
  assert.notEqual(fingerprint(state), before);
});

test("legacy identity fallback preserves distinct positions and equipment links", () => {
  const state = fixture();
  for (const entry of state.bot.field) delete entry.instanceId;
  const equip = required(state.bot.spellTrap[0]);
  equip.equippedTo = required(state.bot.field[0]);
  const before = fingerprint(state);
  assert.equal(fingerprint(structuredClone(state)), before);
  equip.equippedTo = required(state.bot.field[1]);
  assert.notEqual(fingerprint(state), before);
});

test("replacement references outside zones also terminate at card identities", () => {
  const state = fixture();
  const source = card(900);
  const host = card(901);
  source.equippedTo = host;
  host.equips = [source];
  state._simReplacementEffects = [{ sourceCard: source, targetCard: host, duration: 3 }];
  const before = fingerprint(state);
  assert.equal(fingerprint(structuredClone(state)), before);
  host.atk = 2000;
  assert.notEqual(fingerprint(state), before);
});

test("temporary control expiry, event uses and battle-pair links participate in identity", () => {
  const state = Object.assign(fixture(), {
    temporaryControlEffects: [{ id: "control", cardInstanceId: 3, holderId: "bot", previousControllerId: "player", expiresOnTurn: 3, sourceInstanceId: 5, createdOnTurn: 3 }],
    temporaryEventEffects: [{ event: "after_summon", ownerId: "bot", usesRemaining: 1, expiresOnTurn: 3, effect: { actions: [{ type: "heal", amount: 100 }] } }],
    temporaryBattlePairEffects: [] as Array<{ firstTarget: SimulatedCardState; secondTarget: SimulatedCardState; affectedTarget: SimulatedCardState }>,
  });
  const host = required(state.bot.field[0]);
  const other = required(state.bot.field[1]);
  const equip = required(state.bot.spellTrap[0]);
  equip.equippedTo = host;
  host.equips = [equip];
  state.temporaryBattlePairEffects.push({ firstTarget: host, secondTarget: other, affectedTarget: host });
  let before = fingerprint(state);
  assert.equal(fingerprint(structuredClone(state)), before);
  required(state.temporaryControlEffects[0]).expiresOnTurn++;
  assert.notEqual(fingerprint(state), before);
  before = fingerprint(state);
  required(state.temporaryEventEffects[0]).usesRemaining++;
  assert.notEqual(fingerprint(state), before);
  before = fingerprint(state);
  required(state.temporaryBattlePairEffects[0]).affectedTarget = other;
  assert.notEqual(fingerprint(state), before);
});

test("pure diagnostic metadata, functions and UI do not affect identity", () => {
  const state = fixture();
  const before = fingerprint(state);
  Object.assign(state, { logs: ["new log"], elapsedMs: 100, ui: { frame: 3 }, _simUnsupportedActions: ["diagnostic"] });
  Object.assign(required(state.bot.field[0]), { getCounter: () => { throw new Error("do not execute methods"); }, simDragonExtraDeckScore: 10, image: "other.png" });
  state._simLuminarch = { milestones: ["diagnostic"] };
  Object.assign(required(state.bot.field[0]), { state: { debug: "ignored" } });
  assert.equal(fingerprint(state), before);
});

test("fingerprinting is non-mutating and never reads _gameRef or diagnostic/UI getters", () => {
  const state = fixture();
  const expected = structuredClone(state);
  const before = fingerprint(state);
  const fail = () => { throw new Error("forbidden live/diagnostic access"); };
  for (const target of [state, state.bot, required(state.bot.field[0])]) {
    for (const key of ["_gameRef", "ui", "logs", "elapsedMs"]) {
      Object.defineProperty(target, key, { get: fail, enumerable: true });
    }
  }
  assert.equal(fingerprint(state), before);
  assert.equal(fingerprint(expected), before);
  assert.deepEqual([...required(state.bot.field[0]).counters || []], [["charge", 1], ["spore", 2]]);
  assert.deepEqual(state.bot.deck.map(c => c.instanceId), [6, 7]);
  Object.freeze(state.bot.deck);
  Object.freeze(state.bot.field);
  Object.freeze(state.bot);
  Object.freeze(state);
  assert.equal(fingerprint(state), before);
});
