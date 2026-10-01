import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseSimOncePerTurn,
  ensureSimOncePerTurnBucket,
  ensureSimOptSet,
  markSimOncePerTurnUsed,
  useSimOpt,
} from "../../src/core/ai/common/simStateUtils.js";
import { applyGenericSimulatedMainPhaseAction, attachSimulatedEventEmitter, prepareSimulatedSpellEffect, simulateGenericSpellEffect } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { cardDefinition } from "../helpers/fixtures.js";

for (const seat of ["player", "bot"] as const) for (const alreadyNegated of [false, true]) {
  test(`prepared negation Spell validates targets before paying once: ${seat}, negated=${alreadyNegated}`, () => {
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 4 });
    const owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
    const spell = simulationCard({ id: 9004, instanceId: "prepared-negation", cardKind: "spell", owner: seat,
      effects: [{ id: "prepared-negation-effect", timing: "on_play", targets: [
        { id: "cost", intent: "cost", owner: "self", zone: "hand", excludeSelf: true, count: { min: 1, max: 1 } },
        { id: "victim", owner: "opponent", zone: "field", cardKind: "monster", requireFaceup: true, count: { min: 1, max: 1 } },
      ], activationCosts: [{ type: "move", targetRef: "cost", fromZone: "hand", to: "graveyard",
        requireDestination: true, contextLabel: "discard" }],
      actions: [{ type: "add_status", targetRef: "victim", status: "effectsNegated", duration: "until_end_turn" }] }] });
    const cost = simulationCard({ instanceId: "negation-cost", cardKind: "monster", owner: seat });
    const victim = simulationCard({ instanceId: "negation-victim", cardKind: "monster", owner: opponent.id,
      isFacedown: false, effectsNegated: alreadyNegated });
    owner.hand.push(spell, cost); opponent.field.push(victim);
    const prepared = prepareSimulatedSpellEffect(state, spell, { selfId: seat,
      activationContext: { decisions: { selections: { cost: ["negation-cost"], victim: ["negation-victim"] } } } });
    assert.deepEqual(owner.hand, [spell, cost]);
    assert.equal(owner.graveyard.length, 0);
    if (alreadyNegated) {
      assert.equal(prepared, null, "an illegal negation cannot consume the discard");
      return;
    }
    assert.ok(prepared);
    simulateGenericSpellEffect(state, spell, {}, prepared);
    simulateGenericSpellEffect(state, spell, {}, prepared);
    assert.deepEqual(owner.hand, [spell]);
    assert.deepEqual(owner.graveyard, [cost]);
    assert.equal(victim.effectsNegated, true);
    assert.equal(victim.effectsNegationContributions?.length, 1, "prepared resolution is consumed once");
  });
}

for (const seat of ["bot", "player"] as const) for (const active of ["self", "opponent"] as const) {
  test(`shared Forest standby counts public quantities during ${active} phase (${seat})`, () => {
    const source = simulationCard({ ...cardDefinition(274), instanceId: `forest-${seat}`, owner: seat, controller: seat });
    const hidden = simulationCard({ instanceId: "hidden-hand", _simUnknownCard: true });
    Object.defineProperty(hidden, "name", { get() { throw new Error("must not inspect a hidden hand card"); } });
    const state = simulationState({ turnCounter: 4, phase: "standby" });
    const owner = state[seat], opponent = state[seat === "bot" ? "player" : "bot"];
    owner.field.push(source); owner.lpGainedThisTurn = 75;
    opponent.field.push(simulationCard({ instanceId: "set-monster", cardKind: "monster", isFacedown: true, effectsNegated: true }));
    opponent.spellTrap.push(simulationCard({ instanceId: "set-backrow", isFacedown: true }));
    opponent.fieldSpell = simulationCard({ instanceId: "opponent-field-spell" });
    opponent.hand.push(hidden, simulationCard({ instanceId: "hidden-hand-2", _simUnknownCard: true }));
    const actor = active === "self" ? owner : opponent;
    state.turn = actor.id;
    let gains = 0;
    const events = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, onLpGain({ player }) {
      assert.equal(player, owner); assert.equal(player.lpGainedThisTurn, 1075); gains++;
    } });
    events.emitSimulatedEvent?.("standby_phase", { player: actor, opponent: actor === owner ? opponent : owner });
    assert.equal(owner.lp, 9000); assert.equal(owner.lpGainedThisTurn, 1075);
    assert.equal(opponent.lp, 8000); assert.equal(gains, 1);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}

for (const zone of ["field", "spellTrap", "fieldSpell"] as const) {
  test(`shared Standby defaults to its controller in ${zone}`, () => {
    const source = simulationCard({ instanceId: `default-standby-${zone}`, name: "Default standby source",
      effects: [{ id: "default-standby", timing: "on_event", event: "standby_phase", triggerRequirement: "mandatory", triggerTiming: "when",
        requireZone: zone, requireFaceup: true, actions: [{ type: "heal", amount: 150, player: "self" }] }] });
    const state = simulationState({ turnCounter: 4, phase: "standby" });
    if (zone === "fieldSpell") state.bot.fieldSpell = source;
    else state.bot[zone].push(source);
    const events = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
    events.emitSimulatedEvent?.("standby_phase", { player: state.player, opponent: state.bot });
    assert.equal(state.bot.lp, 8000);
    events.emitSimulatedEvent?.("standby_phase", { player: state.bot, opponent: state.player });
    assert.equal(state.bot.lp, 8150); assert.equal(state.bot.lpGainedThisTurn, 150);
  });
}

for (const active of ["bot", "player"] as const) {
  test(`shared Standby binds Overgrowth to its real host (${active})`, () => {
    const host = simulationCard({ ...cardDefinition(252), instanceId: "overgrowth-host", counters: new Map() });
    const alternate = simulationCard({ ...cardDefinition(254), instanceId: "spared-monster", counters: new Map() });
    const equip = simulationCard({ ...cardDefinition(415), instanceId: "overgrowth", equippedTo: host });
    const state = simulationState({ turn: active, turnCounter: 4, phase: "standby",
      bot: { spellTrap: [equip] }, player: { field: [host, alternate] } });
    const events = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
    events.emitSimulatedEvent?.("standby_phase", { player: state[active], opponent: state[active === "bot" ? "player" : "bot"] });
    assert.equal(host.counters?.get("spore"), 1);
    assert.equal(alternate.counters?.get("spore") || 0, 0);
  });
}

for (const suppressed of ["facedown", "negated", "empty", "unattached"] as const) {
  test(`shared Standby has no gain for ${suppressed}`, () => {
    const source = simulationCard({ ...cardDefinition(274), instanceId: "suppressed-forest",
      isFacedown: suppressed === "facedown", effectsNegated: suppressed === "negated" });
    const state = simulationState({ turnCounter: 4, phase: "standby", bot: { field: [source] } });
    if (suppressed !== "empty") state.player.hand.push(simulationCard({ instanceId: "opponent-hand" }));
    if (suppressed === "empty") {
      for (const zone of ["graveyard", "banished", "deck", "extraDeck"] as const) {
        state.player[zone].push(simulationCard({ instanceId: `excluded-${zone}` }));
      }
    }
    if (suppressed === "unattached") {
      state.bot.field.length = 0;
      state.bot.spellTrap.push(simulationCard({ name: "Unattached equip", instanceId: "unattached-equip", subtype: "equip",
        effects: [{ id: "unattached-standby", timing: "on_event", event: "standby_phase", triggerRequirement: "mandatory", triggerTiming: "when",
          actions: [{ type: "heal", amount: 200 }] }] }));
    }
    let gains = 0;
    const events = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, onLpGain() { gains++; } });
    events.emitSimulatedEvent?.("standby_phase", { player: state.bot, opponent: state.player });
    assert.equal(state.bot.lp, 8000); assert.equal(state.bot.lpGainedThisTurn || 0, 0); assert.equal(gains, 0);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}

test("shared heal records the effective gain exactly once after a multiplier", () => {
  const multiplier = simulationCard({ name: "Gain multiplier", instanceId: "gain-multiplier", cardKind: "monster",
    effects: [{ id: "gain-multiplier", timing: "passive", passive: { type: "lp_gain_multiplier", multiplier: 1.5 } }] });
  const state = simulationState({ bot: { field: [multiplier], lpGainedThisTurn: 10 } });
  applySimulatedActions({ state, actions: [{ type: "heal", amount: 201, player: "self" }] });
  assert.equal(state.bot.lp, 8301); assert.equal(state.bot.lpGainedThisTurn, 311);
});

type BotCloneCard = Parameters<typeof cloneBotGameState>[0]["hand"][number];

for (const zone of ["field", "spellTrap", "fieldSpell"] as const) {
  test(`soft OPT resets on ${zone} departure but survives a control move`, () => {
    const card = simulationCard({ id: 99100, instanceId: "soft-source", name: "Scoped source",
      cardKind: zone === "field" ? "monster" : "spell", oncePerTurnResetVersion: 0 });
    const soft = { id: "soft", oncePerTurn: true, oncePerTurnScope: "card" as const };
    const hard = { id: "hard", oncePerTurn: true };
    const state = simulationState({ turnCounter: 4 });
    if (zone === "fieldSpell") state.bot.fieldSpell = card;
    else state.bot[zone].push(card);
    markSimulatedEffectUsage(state, soft, card, "bot", true);
    markSimulatedEffectUsage(state, hard, card, "bot", true);
    assert.equal(moveCardToZone(state.player, card, zone, state.bot, { state }), true);
    assert.equal(card.oncePerTurnResetVersion, 0);
    assert.equal(canUseSimulatedEffectUsage(state, soft, card, "player", true), false);
    assert.equal(canUseSimulatedEffectUsage(state, hard, card, "player", true), true);
    assert.equal(moveCardToZone(state.bot, card, zone, state.player, { state }), true);
    assert.equal(canUseSimulatedEffectUsage(state, soft, card, "bot", true), false);
    assert.equal(moveCardToZone(state.bot, card, "graveyard", state.bot, { state }), true);
    assert.equal(card.oncePerTurnResetVersion, 1);
    assert.equal(canUseSimulatedEffectUsage(state, soft, card, "bot", true), true);
    assert.equal(canUseSimulatedEffectUsage(state, hard, card, "bot", true), false);
  });
}

test("counted soft OPT aggregates both controllers while hard OPT stays with its player", () => {
  const card = simulationCard({ instanceId: "counted-source", name: "Counted source",
    oncePerTurnUsageByName: { counted_soft: { turn: 4, count: 1 } } });
  const soft = { id: "counted_soft", oncePerTurn: true, oncePerTurnScope: "card" as const, maxUsesPerTurn: 3 };
  const hard = { id: "counted_hard", oncePerTurn: true, maxUsesPerTurn: 2 };
  const state = simulationState({ turnCounter: 4, bot: { field: [card] } });
  markSimulatedEffectUsage(state, soft, card, "bot", true);
  markSimulatedEffectUsage(state, hard, card, "bot", true);
  moveCardToZone(state.player, card, "field", state.bot, { state });
  assert.equal(canUseSimulatedEffectUsage(state, soft, card, "player", true), true);
  markSimulatedEffectUsage(state, soft, card, "player", true);
  assert.equal(canUseSimulatedEffectUsage(state, soft, card, "player", true), false);
  assert.equal(canUseSimulatedEffectUsage(state, soft, card, "bot", true), false);
  assert.equal(canUseSimulatedEffectUsage(state, hard, card, "player", true), true);
  assert.equal(canUseSimulatedEffectUsage(state, hard, card, "bot", true), true);
  markSimulatedEffectUsage(state, hard, card, "bot", true);
  assert.equal(canUseSimulatedEffectUsage(state, hard, card, "bot", true), false);
  assert.equal(canUseSimulatedEffectUsage(state, hard, card, "player", true), true);
  state.turnCounter++;
  assert.equal(canUseSimulatedEffectUsage(state, soft, card, "player", true), true);
});

function ensureLegacySimOptSet(input: object): Set<string> {
  const runtimeEnsure: unknown = ensureSimOptSet;
  if (typeof runtimeEnsure !== "function") {
    throw new TypeError("ensureSimOptSet must remain callable");
  }
  return Reflect.apply(runtimeEnsure, undefined, [input]) as Set<string>;
}

test("legacy one-shot buckets normalize arrays to Sets without reordering", () => {
  const state = { _simOptUsed: ["first", "second", "first"] };

  const bucket = ensureSimOptSet(state);

  assert.equal(bucket, state._simOptUsed);
  assert.deepEqual([...bucket], ["first", "second"]);
  assert.equal(ensureSimOptSet(state), bucket);
});

test("legacy one-shot buckets replace unsupported values with an empty Set", () => {
  const state = { _simOptUsed: { stale: true } };

  const bucket = ensureLegacySimOptSet(state);

  assert.ok(bucket instanceof Set);
  assert.equal(bucket, state._simOptUsed);
  assert.deepEqual([...bucket], []);
});

test("useSimOpt preserves empty-key and first-use semantics", () => {
  const state: { _simOptUsed?: Set<string> } = {};

  assert.equal(useSimOpt(state, null), true);
  assert.equal("_simOptUsed" in state, false);
  assert.equal(useSimOpt(state, "effect"), true);
  assert.equal(useSimOpt(state, "effect"), false);
  assert.deepEqual([...state._simOptUsed ?? []], ["effect"]);
});

test("simulated once-per-turn buckets canonicalize every legacy shape", () => {
  const map = new Map([["existing", 2]]);
  const state = {
    _simOncePerTurn: {
      bot: map,
      player: new Set(["set-first", "set-second"]),
      array: [["tuple", 2], "single"],
      object: { first: 3, second: 1 },
    },
  };

  assert.equal(ensureSimOncePerTurnBucket(state, "bot"), map);
  assert.deepEqual(
    [...ensureSimOncePerTurnBucket(state, "player")],
    [["set-first", 1], ["set-second", 1]],
  );
  assert.deepEqual(
    [...ensureSimOncePerTurnBucket(state, "array")],
    [["tuple", 2], ["single", 1]],
  );
  assert.deepEqual(
    [...ensureSimOncePerTurnBucket(state, "object")],
    [["first", 3], ["second", 1]],
  );
});

test("simulated once-per-turn usage is counted and capped", () => {
  const state = { _simOncePerTurn: { bot: new Set(["legacy"]) } };

  assert.equal(canUseSimOncePerTurn(state, "legacy", 2), true);
  markSimOncePerTurnUsed(state, "legacy", 2);
  assert.equal(canUseSimOncePerTurn(state, "legacy", 2), false);
  markSimOncePerTurnUsed(state, "legacy", 2);
  assert.equal(ensureSimOncePerTurnBucket(state).get("legacy"), 2);
});

test("generic spell placement preserves hook receiver and truthy results", () => {
  const spell: Partial<BotCloneCard> = {
    id: 501,
    name: "Persistent Probe",
    cardKind: "spell" as const,
    subtype: "continuous",
  };
  const opponent = {
    id: "player",
    lp: 8000,
    hand: [],
    field: [],
    graveyard: [],
    deck: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
    spellTrap: [],
    summonCount: 0,
    additionalNormalSummons: 0,
    controllerType: "ai" as const,
  };
  const bot = {
    ...opponent,
    id: "bot",
    hand: [spell as BotCloneCard],
    resolveOpponent: () => opponent,
    strategy: {
      simulateMainPhaseAction: () => undefined,
      simulateSpellEffect: () => undefined,
    },
  };
  const game = {
    player: opponent,
    bot,
    turn: "bot",
    phase: "main1",
    turnCounter: 3,
  };
  const state = cloneBotGameState(bot, game);
  let receiver: object | undefined;
  const options = {
    placeSpellCard(
      this: object,
      currentState: typeof state,
      placedCard: (typeof state.bot.hand)[number],
    ) {
      receiver = this;
      currentState.bot.spellTrap.push(placedCard);
      return { placed: 1 };
    },
  };

  applyGenericSimulatedMainPhaseAction(
    state,
    { type: "spell", index: 0, cardName: spell.name },
    options,
  );

  assert.equal(receiver, options);
  assert.equal(state.bot.hand.length, 0);
  assert.equal(state.bot.spellTrap[0]?.name, spell.name);
  assert.equal(state.bot.graveyard.length, 0);
});


for (const actor of ["bot", "player"] as const) {
  test(`prepared Spell choices pay once before declarative resolution (${actor})`, () => {
    const spell = simulationCard({ id: 9001, instanceId: "prepared-spell", cardKind: "spell", effects: [{
      id: "prepared-effect", timing: "on_play", oncePerTurn: true, oncePerTurnName: "prepared-effect",
      targets: [{ id: "cost", intent: "cost", zone: "hand", owner: "self", excludeSelf: true, count: { min: 1, max: 1 } }],
      activationCosts: [{ type: "move", targetRef: "cost", fromZone: "hand", to: "graveyard", requireDestination: true, contextLabel: "discard" }],
      actions: [{ type: "reduce_hand_monster_levels", amount: 2 }],
    }] });
    const paid = simulationCard({ id: 9002, instanceId: "prepared-cost", cardKind: "monster", level: 6 });
    const remaining = simulationCard({ id: 9003, instanceId: "prepared-hand", cardKind: "monster", level: 6 });
    const state = simulationState({ turn: actor, phase: "main1", turnCounter: 4, _isPerspectiveState: true,
      bot: { id: actor, hand: [spell, paid, remaining] }, player: { id: actor === "bot" ? "player" : "bot" } });
    let events = 0;
    const prepared = prepareSimulatedSpellEffect(state, spell, { selfId: "bot", enableSimulatedEvents: true,
      activationContext: { decisions: { selections: { cost: ["prepared-cost"] } } },
      emitSimulatedEvent(event) {
        if (event !== "card_to_grave") return;
        events++;
        assert.ok(state.bot.graveyard.includes(paid));
        assert.equal(paid.level, 6, "the cost card leaves hand before hand levels are changed");
        assert.equal(remaining.level, 6, "the discard event precedes resolution");
      },
    });
    assert.ok(prepared); assert.equal(events, 0); assert.equal(state.bot.hand.length, 3);
    simulateGenericSpellEffect(state, spell, {}, prepared);
    assert.equal(events, 1); assert.equal(remaining.level, 4); assert.equal(paid.level, 6);
    assert.equal(remaining.originalLevel, 6);
    simulateGenericSpellEffect(state, spell, {}, prepared);
    assert.equal(events, 1); assert.equal(remaining.level, 4);
    assert.equal(prepareSimulatedSpellEffect(state, spell, { selfId: "bot" }), null, "the named use is consumed");
  });
}
