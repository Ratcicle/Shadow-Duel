import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { simulateMainPhaseAction } from "../../src/core/ai/dragon/simulation.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { scoreDragonDiscardCandidate } from "../../src/core/ai/dragon/costPolicy.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";

const make = (id: number) => simulationCard({ ...cardDefinition(id), owner: "bot", controller: "bot", instanceId: `cost-${id}` });

for (const eligible of [false, true]) for (const chosen of ["none", "backrow", "fieldSpell"] as const) {
  test(`Dragon Roar delegates the explicit ${chosen} choice with an eligible Dragon ${eligible}`, () => {
    const roar = make(261), dragon = { ...make(260), isFacedown: !eligible };
    const backrow = { ...make(268), owner: "player", controller: "player", isFacedown: true };
    const fieldSpell = { ...make(262), owner: "player", controller: "player" };
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
      bot: { hand: [roar], field: [dragon] }, player: { spellTrap: [backrow], fieldSpell } });
    const selected = chosen === "none" ? [] : [required((chosen === "backrow" ? backrow : fieldSpell).instanceId)];
    simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 261,
      activationContext: { decisions: { selections: { destroy_targets: selected } } } });
    assert.equal(state.player.graveyard.length, eligible && chosen !== "none" ? 1 : 0);
    assert.equal(state.player.spellTrap.includes(backrow), !eligible || chosen !== "backrow");
    assert.equal(state.player.fieldSpell === fieldSpell, !eligible || chosen !== "fieldSpell");
    assert.equal(state._simUnsupportedActions, undefined);
  });
}

for (const invalid of ["stale", "own", "hand", "monster", "two"] as const) {
  test(`Dragon Roar retains the rejection of an explicit ${invalid} target plan`, () => {
    const roar = make(261), dragon = make(260), backrow = { ...make(262), owner: "player", controller: "player" };
    const own = make(268), monster = { ...make(252), owner: "player", controller: "player" };
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
      bot: { hand: [roar], field: [dragon], spellTrap: [own] },
      player: { fieldSpell: backrow, field: [monster], hand: [{ ...backrow, instanceId: "hand-target" }] } });
    const selection = invalid === "stale" ? ["stale"] : invalid === "own" ? [required(own.instanceId)]
      : invalid === "hand" ? ["hand-target"] : invalid === "monster" ? [required(monster.instanceId)]
      : [required(backrow.instanceId), required(own.instanceId)];
    simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 261,
      activationContext: { decisions: { selections: { destroy_targets: selection } } } });
    assert.deepEqual(state._simUnsupportedActions, ["exact_selection:destroy_targets"]);
    assert.equal(state.player.fieldSpell, backrow);
    assert.ok(state.bot.spellTrap.includes(own));
    assert.ok(state.player.field.includes(monster));
  });
}

for (const planner of ["common", "dragon"] as const) {
  const simulate = (state: ReturnType<typeof simulationState>, action: AIAction) => {
    if (planner === "common") applyGenericSimulatedMainPhaseAction(state, action);
    else simulateMainPhaseAction(state, action);
  };
  for (const [id, effectId] of [[257, "majestic_silver_dragon_position_switch"], [258, "darkness_dragon_negate"]] as const) {
    test(`${planner} planner consumes ${effectId} on a negated source after its valid cost`, () => {
      const source = { ...make(id), effectsNegated: true }, second = { ...make(id), instanceId: "second-negated-copy" };
      const target = { ...make(252), owner: "player", controller: "player", position: "attack" as const };
      const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
        bot: { field: [source, second], hand: [make(254)] }, player: { field: [target] } });
      const effect = required(source.effects?.find(entry => entry.id === effectId));
      simulate(state, { type: "monsterEffect", fieldIndex: 0, cardId: id, effectId });
      assert.equal(target.position, "attack"); assert.equal(target.effectsNegated, undefined);
      assert.equal(state.bot.hand.length, id === 258 ? 0 : 1);
      assert.equal(canUseSimulatedEffectUsage(state, effect, source), false);
      assert.equal(canUseSimulatedEffectUsage(state, effect, second), true);
    });

    test(`${planner} planner gives each ${effectId} copy one use per presence`, () => {
      const first = make(id), second = { ...make(id), instanceId: "second-copy" };
      const target = { ...make(252), owner: "player", controller: "player", position: "attack" as const };
      const freshTarget = { ...target, instanceId: "second-target" };
      const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
        bot: { field: [first, second], hand: [make(254), make(251), make(256)] },
        player: { field: id === 258 ? [target, freshTarget] : [target] } });
      const effect = required(first.effects?.find(entry => entry.id === effectId));
      simulate(state, { type: "monsterEffect", fieldIndex: 0, cardId: id, effectId });
      assert.equal(canUseSimulatedEffectUsage(state, effect, first), false);
      assert.equal(canUseSimulatedEffectUsage(state, effect, second), true);
      const position = target.position, remaining = state.bot.hand.length;
      simulate(state, { type: "monsterEffect", fieldIndex: 0, cardId: id, effectId });
      assert.equal(target.position, position); assert.equal(state.bot.hand.length, remaining);
      if (id === 258) {
        assert.equal(target.effectsNegated, true);
        assert.notEqual(freshTarget.effectsNegated, true, "a legal target remains, so usage alone blocks the first copy");
      }
      simulate(state, { type: "monsterEffect", fieldIndex: 1, cardId: id, effectId });
      assert.equal(canUseSimulatedEffectUsage(state, effect, second), false);
      if (id === 258) {
        assert.equal(freshTarget.effectsNegated, true, "the second copy negates its own legal target");
        assert.equal(state.bot.hand.length, remaining - 1);
      }
      state.turnCounter++;
      assert.equal(canUseSimulatedEffectUsage(state, effect, first), true);
      moveCardToZone(state.bot, first, "graveyard", state.bot, { state });
      moveCardToZone(state.bot, first, "field", state.bot, { state });
      assert.equal(canUseSimulatedEffectUsage(state, effect, first), true);
    });

    test(`${planner} planner imports spent ${effectId} usage`, () => {
      const source = make(id), target = { ...make(252), owner: "player", controller: "player", position: "attack" as const };
      const effect = required(source.effects?.find(entry => entry.id === effectId));
      source.oncePerTurnUsageByName = { [required(effect.oncePerTurnName)]: { turn: 4, count: 1 } };
      const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
        bot: { field: [source], hand: [make(254)] }, player: { field: [target] } });
      simulate(state, { type: "monsterEffect", fieldIndex: 0, cardId: id, effectId });
      assert.equal(target.position, "attack"); assert.equal(target.effectsNegated, undefined);
      assert.equal(state.bot.hand.length, 1);
    });
  }

  test(`${planner} planner gives each Boneflame GY copy its own use`, () => {
    const first = make(269), second = { ...make(269), instanceId: "second-boneflame" };
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
      bot: { graveyard: [first, second], field: [{ ...make(252), atk: 0 }, { ...make(254), atk: 0 }] } });
    const effect = required(first.effects?.find(entry => entry.id === "boneflame_dragon_gy_revive"));
    simulate(state, { type: "graveyardMonsterEffect", graveyardIndex: 0, cardId: 269, effectId: effect.id });
    assert.ok(state.bot.field.some(card => card.instanceId === first.instanceId));
    assert.equal(canUseSimulatedEffectUsage(state, effect, second), true);
    simulate(state, { type: "graveyardMonsterEffect", graveyardIndex: state.bot.graveyard.indexOf(second), cardId: 269, effectId: effect.id });
    const summoned = required(state.bot.field.find(card => card.instanceId === second.instanceId));
    assert.equal(canUseSimulatedEffectUsage(state, effect, summoned), false);
    moveCardToZone(state.bot, summoned, "graveyard", state.bot, { state });
    assert.equal(canUseSimulatedEffectUsage(state, effect, summoned), true);
  });

  for (const [id, effectId] of [[260, "hellkite_dragon_field_send_revive"], [262, "dragon_peak_ignite_summon"]] as const) {
    test(`${planner} planner binds ${effectId} payment to the original source presence`, () => {
      const source = make(id), recruit = make(255);
      const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
        bot: { graveyard: [recruit], field: id === 260 ? [source] : [], fieldSpell: id === 262 ? source : null } });
      if (id === 262) source.counters = new Map([["dragon_peak", 7]]);
      const effect = required(source.effects?.find(entry => entry.id === effectId));
      const originalPresence = { ...source };
      simulate(state, id === 262 ? { type: "fieldEffect", cardId: id, effectId }
        : { type: "monsterEffect", fieldIndex: 0, cardId: id, effectId });
      assert.ok(state.bot.graveyard.includes(source));
      assert.ok(state.bot.field.some(card => card.instanceId === recruit.instanceId));
      assert.equal(source.oncePerTurnResetVersion, 1);
      assert.equal(canUseSimulatedEffectUsage(state, effect, originalPresence), false);
      assert.equal(canUseSimulatedEffectUsage(state, effect, source), true, "a future source presence must remain available");
    });
  }
}

test("Dragon strategy discovers only the unspent Majestic copy in a cloned state", t => {
  const bot = new Bot();
  const game = createRuntimeGame({ opponentOverride: bot, disableChains: true, randomSeed: 1 });
  t.after(() => game.dispose());
  game.turn = bot.id; game.phase = "main1"; game.turnCounter = 4;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game with Bot supplies the attached planning and validation methods");
  const strategy = new DragonStrategy(bot);
  placeFieldCards(bot.field, new Card(cardDefinition(257), bot.id), new Card(cardDefinition(257), bot.id));
  bot.hand.push(new Card(cardDefinition(254), bot.id));
  placeFieldCards(game.player.field, new Card(cardDefinition(259), game.player.id));
  const state = bot.cloneGameState(botGame);
  const discover = () => strategy.generateMainPhaseActions(state)
    .filter(action => action.type === "monsterEffect" && action.effectId === "majestic_silver_dragon_position_switch")
    .map(action => action.type === "monsterEffect" ? action.fieldIndex : undefined);
  assert.deepEqual(discover(), [0, 1], "both copies have a legal opportunity before either use");
  const source = required(state.bot.field[0]);
  markSimulatedEffectUsage(state, required(source.effects?.find(effect => effect.id === "majestic_silver_dragon_position_switch")),
    source, bot.id, true);
  assert.deepEqual(discover(), [1]);
  assert.equal(game.bot.hand.length, 1, "action discovery does not consume live costs");
});

test("Dragon planner sends Black Bull costs without Voltaic burn or Luminous recovery", () => {
  const source = make(259), voltaic = make(255), armored = make(252), luminous = make(251), grey = make(254);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
    bot: { hand: [source, voltaic, armored], field: [luminous], graveyard: [grey] } });
  simulateMainPhaseAction(state, { type: "handIgnition", cardId: 259, index: 0, effectId: "bbd_special_summon_from_hand" });
  assert.equal(state.player.lp, 8000);
  assert.ok(state.bot.graveyard.includes(grey));
  assert.equal(state.bot.field.filter(card => card.id === 259).length, 1);
  assert.equal(state.bot.graveyard.length, 3);
});

test("Black Bull cost scoring does not reward Voltaic's discard-only burn", () => {
  const voltaic = make(255), blackBull = make(259), darkness = make(258);
  const player = { hand: [voltaic, blackBull], field: [], graveyard: [], deck: [], spellTrap: [], extraDeck: [], fieldSpell: null };
  const sendScore = scoreDragonDiscardCandidate(voltaic, { player, source: blackBull });
  const discardScore = scoreDragonDiscardCandidate(voltaic, { player, source: darkness });
  assert.ok(sendScore > discardScore, "sending preserves body/material value without burn payoff");
});

test("Dragon planner applies Rainbow's resolution choice after paying its GY cost", () => {
  const source = make(267), extreme = make(270), followUp = make(260);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
    bot: { graveyard: [source], deck: [extreme], hand: [followUp] } });
  simulateMainPhaseAction(state, { type: "graveyardMonsterEffect", cardId: 267, effectId: "rainbow_cosmic_dragon_gy_send_extremes" });
  assert.ok(state.bot.banished.includes(source));
  assert.ok(state.bot.graveyard.includes(extreme));
});

for (const counters of [6, 7]) for (const representation of ["map", "object"]) {
  test(`Dragon planner uses seven Peak counters (has ${counters}, ${representation})`, () => {
    const source = make(262), recruit = make(257);
    const peak = representation === "map" ? source : { ...source, counters: { dragon_peak: counters } };
    if (representation === "map") source.counters = new Map([["dragon_peak", counters]]);
    const base = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
      bot: { deck: [recruit] } });
    const state = { ...base, bot: { ...base.bot, fieldSpell: peak } };
    simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 262, effectId: "dragon_peak_ignite_summon" });
    assert.equal(state.bot.graveyard.some(card => card.id === 262), counters === 7);
    assert.equal(state.bot.field.some(card => card.id === recruit.id), counters === 7);
  });
}

test("Dragon planner lets Hellkite's field payment free the summon slot", () => {
  const source = make(260);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
    bot: { hand: [source], field: Array.from({ length: 5 }, (_, index) => ({ ...make(252), instanceId: `field-${index}` })) } });
  simulateMainPhaseAction(state, { type: "handIgnition", cardId: 260, index: 0, effectId: "hellkite_dragon_hand_ss_cost" });
  assert.equal(state.bot.field.filter(card => card.id === 260).length, 1);
  assert.equal(state.bot.field.length, 5);
  assert.equal(state.bot.graveyard.length, 1);
});

test("Dragon planner does not pay Peak when no Dragon can be summoned", () => {
  const source = make(262); source.counters = new Map([["dragon_peak", 7]]);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, bot: { fieldSpell: source } });
  simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 262, effectId: "dragon_peak_ignite_summon" });
  assert.equal(state.bot.fieldSpell, source);
  assert.equal(state.bot.graveyard.length, 0);
});

for (const negated of [false, true]) {
  test(`Common planner rejects Black Bull's redirected GY costs (Galaxy negated: ${negated})`, () => {
    const source = make(259), first = make(252), second = make(254);
    const galaxy = { ...make(273), owner: "player", controller: "player", effectsNegated: negated };
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
      bot: { hand: [source, first, second] }, player: { field: [galaxy] } });
    applyGenericSimulatedMainPhaseAction(state, { type: "handIgnition", cardId: 259, index: 0, effectId: "bbd_special_summon_from_hand" });
    assert.equal(state.bot.field.some(card => card.id === source.id), negated);
    assert.equal(state.bot.graveyard.length, negated ? 2 : 0);
    assert.equal(state.bot.banished.length, 0);
    assert.equal(state.bot.hand.length, negated ? 0 : 3);
  });
  test(`Dragon planner rejects Black Bull's redirected GY costs (Galaxy negated: ${negated})`, () => {
    const source = make(259), first = make(252), second = make(254);
    const galaxy = { ...make(273), owner: "player", controller: "player", effectsNegated: negated };
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
      bot: { hand: [source, first, second] }, player: { field: [galaxy] } });
    simulateMainPhaseAction(state, { type: "handIgnition", cardId: 259, index: 0, effectId: "bbd_special_summon_from_hand" });
    assert.equal(state.bot.field.some(card => card.id === source.id), negated);
    assert.equal(state.bot.graveyard.length, negated ? 2 : 0);
    assert.equal(state.bot.banished.length, 0);
    assert.equal(state.bot.hand.length, negated ? 0 : 3);
  });
  for (const route of ["hellkiteHand", "hellkiteField", "peak", "boneflame"] as const) {
    test(`Dragon planner preserves redirected ${route} payment (Galaxy negated: ${negated})`, () => {
      const source = make(route === "peak" ? 262 : route === "boneflame" ? 269 : 260);
      const cost = { ...make(252), atk: 0 }, recruit = make(255);
      const galaxy = { ...make(273), owner: "player", controller: "player", effectsNegated: negated };
      const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
        player: { field: [galaxy] } });
      let summonedId: number;
      if (route === "peak") {
        source.counters = new Map([["dragon_peak", 7]]); state.bot.fieldSpell = source; state.bot.deck.push(recruit);
        simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 262, effectId: "dragon_peak_ignite_summon" });
        assert.equal(state.bot.fieldSpell === source, !negated); summonedId = recruit.id!;
      } else if (route === "hellkiteField") {
        state.bot.field.push(source); state.bot.graveyard.push(recruit);
        simulateMainPhaseAction(state, { type: "monsterEffect", cardId: 260, effectId: "hellkite_dragon_field_send_revive" });
        assert.equal(state.bot.field.includes(source), !negated); summonedId = recruit.id!;
      } else if (route === "hellkiteHand") {
        state.bot.hand.push(source); state.bot.field.push(cost);
        simulateMainPhaseAction(state, { type: "handIgnition", cardId: 260, index: 0, effectId: "hellkite_dragon_hand_ss_cost" });
        assert.equal(state.bot.field.includes(cost), !negated); summonedId = source.id!;
      } else {
        state.bot.graveyard.push(source); state.bot.field.push(cost);
        simulateMainPhaseAction(state, { type: "graveyardMonsterEffect", cardId: 269, effectId: "boneflame_dragon_gy_revive" });
        assert.equal(state.bot.field.includes(cost), !negated); summonedId = source.id!;
      }
      assert.equal(state.bot.field.some(card => card.id === summonedId), negated);
      assert.equal(state.bot.banished.length, 0);
    });
  }
}
