import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { getEffectiveAtk, getEffectiveDef, getEffectiveStat } from "../../src/core/ai/common/cardStats.js";
import BaseStrategy from "../../src/core/ai/BaseStrategy.js";
import { estimateMonsterValue } from "../../src/core/ai/common/cardValue.js";
import { calculateThreatScore } from "../../src/core/ai/ThreatEvaluation.js";
import * as stats from "../../src/core/ai/common/simulatedActions/stats.js";
import * as flow from "../../src/core/ai/common/simulatedActions/flow.js";
import * as resources from "../../src/core/ai/common/simulatedActions/resources.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { resolveTargetsForAction, STOP_SIMULATION } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { SimulatedActionHandlerContext, SimulatedActionOptions, SimulatedRuntimeState } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { ActionOf, ActionType } from "../../src/core/contracts/actions.js";
import type { EffectContext } from "../../src/core/contracts/actionRuntime.js";
import type { CanonicalSelectionMap } from "../../src/core/contracts/selection.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(actor: "player" | "bot" = "bot") {
  const player = (id: "player" | "bot") => ({ id, lp: 8000, hand: [], deck: [], field: [], graveyard: [],
    banished: [], extraDeck: [], spellTrap: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 });
  const state = unsafeFixture<SimulatedRuntimeState>({
    bot: player(actor), player: player(actor === "bot" ? "player" : "bot"),
    turn: actor, phase: "main1", turnCounter: 4, _isPerspectiveState: true,
  }, "Explicit planning graph contains both physical players in perspective slots");
  const copy = createPlanningCopy();
  const make = (id: number) => copy.cloneCardForSim(new Card(cardDefinition(id), actor));
  const context = <Type extends ActionType>(action: ActionOf<Type>, options: SimulatedActionOptions = {}, selections: CanonicalSelectionMap = {}): SimulatedActionHandlerContext<Type> => ({
    action, state, options, selections, self: state.bot, opponent: state.player, selfId: state.bot.id,
    targets: resolveTargetsForAction("targetRef" in action ? action : {}, selections, options, state.player), applySimulatedActions,
  });
  return { state, make, context };
}

for (const [amount, expected] of [[-2, 6], [-1, 7], [1, 9], [2, 10]] as const) {
  test(`modify_level applies ${amount} to the selected instance`, () => {
    const { make, context } = scenario();
    const selected = make(503);
    const other = make(503);
    selected.level = 8;
    stats.applyModifyLevel(context({ type: "modify_level", targetRef: "chosen", amount },
      { sourceCard: other }, { chosen: [selected] }));
    assert.equal(selected.level, expected);
    assert.equal(selected.originalLevel, 8);
    assert.equal(other.level, 3);
    assert.equal(other.originalLevel, undefined);
  });
}

test("modify_level preserves the first temporary baseline and clamps declared bounds", () => {
  const { make, context } = scenario();
  const selected = make(503);
  const selections = { chosen: [selected] };
  stats.applyModifyLevel(context({ type: "modify_level", targetRef: "chosen", amount: -5 }, {}, selections));
  assert.equal(selected.level, 1);
  stats.applyModifyLevel(context({ type: "modify_level", targetRef: "chosen", amount: 20, maxLevel: 10 }, {}, selections));
  assert.equal(selected.level, 10);
  assert.equal(selected.originalLevel, 3);
});

test("permanent and zero level changes do not create a temporary baseline", () => {
  const { make, context } = scenario();
  const selected = make(503);
  stats.applyModifyLevel(context({ type: "modify_level", targetRef: "self", amount: 2, duration: "permanent" }, { sourceCard: selected }));
  assert.equal(selected.level, 5);
  assert.equal(selected.originalLevel, undefined);
  stats.applyModifyLevel(context({ type: "modify_level", targetRef: "self", amount: 0 }, { sourceCard: selected }));
  assert.equal(selected.originalLevel, undefined);
  const spell = make(518);
  stats.applyModifyLevel(context({ type: "modify_level", targetRef: "self", amount: 2 }, { sourceCard: spell }));
  assert.equal(spell.originalLevel, undefined);
});

for (const actor of ["player", "bot"] as const) {
  test(`Slasher followup is bound to one Synchro context without granting protection early (${actor})`, () => {
    const { state, make, context } = scenario(actor);
    const slasher = make(510);
    const previous = make(514);
    state.bot.graveyard.push(slasher);
    state.bot.field.push(previous);
    const action: ActionOf<"register_synchro_material_followup"> = {
      type: "register_synchro_material_followup",
      actions: [{ type: "grant_protection", targetRef: "synchro_summoned_card", protectionType: "battle_destruction", duration: "end_of_next_turn" }],
    };
    flow.applyRegisterSynchroMaterialFollowup(context(action, { sourceCard: slasher, actionContext: { synchroSummonContextId: "synchro:one" } }));
    const followup = required(state.pendingSynchroMaterialFollowups?.[0]);
    assert.equal(followup.synchroSummonContextId, "synchro:one");
    assert.equal(followup.ownerId, actor);
    assert.equal(followup.source, slasher);
    assert.deepEqual(followup.actions, action.actions);
    assert.equal(previous.battleIndestructible, false);
    assert.equal(slasher.battleIndestructible, false);
  });

  test(`Phoenix schedules its own instance for the current physical player's End Phase (${actor})`, () => {
    const { state, make, context } = scenario(actor);
    const phoenix = make(514);
    state.bot.graveyard.push(phoenix);
    state.turn = state.player.id;
    flow.applyScheduleSpecialSummon(context({ type: "schedule_special_summon", cardRef: "self", fromZone: "graveyard",
      phase: "end", triggerPlayer: "current", position: "choice", statusesOnSummon: [{ status: "banishWhenLeavesField" }] },
    { sourceCard: phoenix }));
    const delayed = required(state.delayedActions?.[0]);
    assert.equal(delayed.actionType, "delayed_summon");
    assert.deepEqual(delayed.triggerCondition, { phase: "end", player: state.player.id });
    assert.equal(delayed.scheduledTurn, 4);
    const summon = required(delayed.payload.summons[0]);
    assert.equal(summon.card, phoenix);
    assert.equal(summon.owner, actor);
    assert.equal(summon.placementActorId, actor);
    assert.equal(summon.fromZone, "graveyard");
    assert.equal(summon.position, "choice");
    assert.deepEqual(summon.statusesOnSummon, [{ status: "banishWhenLeavesField" }]);
    assert.deepEqual(state.bot.field, []);
    assert.deepEqual(state.bot.graveyard, [phoenix]);
  });
}

test("missing Synchro context is diagnosed without inventing a future beneficiary", () => {
  const { state, make, context } = scenario();
  flow.applyRegisterSynchroMaterialFollowup(context({ type: "register_synchro_material_followup",
    actions: [{ type: "draw", amount: 1 }] }, { sourceCard: make(510) }));
  assert.deepEqual(state._simUnsupportedActions, ["register_synchro_material_followup"]);
  assert.equal(state.pendingSynchroMaterialFollowups?.length ?? 0, 0);
});

test("scheduling a selected card preserves summon recipient and trigger player separately", () => {
  const { state, make, context } = scenario();
  const card = make(514);
  flow.applyScheduleSpecialSummon(context({ type: "schedule_special_summon", targetRef: "chosen", owner: "opponent",
    triggerPlayer: "self", returnPhase: "standby", priority: 3 }, {}, { chosen: [card] }));
  const delayed = required(state.delayedActions?.[0]);
  assert.deepEqual(delayed.triggerCondition, { phase: "standby", player: "bot" });
  assert.equal(delayed.priority, 3);
  assert.equal(delayed.actionType, "delayed_summon");
  assert.equal(required(delayed.payload.summons[0]).owner, "player");
});

test("summon/activation negation stays unsupported while the turn simulator has no Chain context producer", () => {
  const { state, make, context } = scenario();
  const source = make(517);
  const opponentCard = make(518);
  state.player.spellTrap.push(opponentCard);
  const actionContext = { activationAttempt: { card: opponentCard, activationNegated: false } };
  flow.applyNegateSummonOrActivationAndDestroy(context({ type: "negate_summon_or_activation_and_destroy" }, { sourceCard: source, actionContext }));
  assert.deepEqual(state._simUnsupportedActions, ["negate_summon_or_activation_and_destroy"]);
  assert.equal(actionContext.activationAttempt.activationNegated, false);
  assert.deepEqual(state.player.spellTrap, [opponentCard]);
  assert.deepEqual(state.player.graveyard, []);
});

for (const [duration, expiresOnTurn] of [["end_of_turn", 4], ["end_of_next_turn", 5], ["while_faceup", null], ["9", 9]] as const) {
  test(`granted protection records ${duration} without creating permanent flags`, () => {
    const { make, context } = scenario();
    const source = make(510);
    const destination = make(517);
    stats.applyGrantProtection(context({ type: "grant_protection", targetRef: "result", protectionType: "battle_destruction", duration },
      { sourceCard: source }, { result: [destination] }));
    stats.applyGrantProtection(context({ type: "grant_protection", targetRef: "result", protectionType: "effect_destruction", duration, sourceOwner: "opponent" },
      { sourceCard: source }, { result: [destination] }));
    assert.deepEqual(destination.protectionEffects, [
      { type: "battle_destruction", source: "Tech-Zero Atomic Slasher", duration, grantedOnTurn: 4, expiresOnTurn, sourceOwner: "any", removeOnLeave: true },
      { type: "effect_destruction", source: "Tech-Zero Atomic Slasher", duration, grantedOnTurn: 4, expiresOnTurn, sourceOwner: "opponent", removeOnLeave: true },
    ]);
    assert.equal(destination.battleIndestructible, false);
    assert.equal(destination._simEffectDestructionProtectedFromOpponent, undefined);
    assert.equal(source.protectionEffects, undefined);
  });
}

test("protection defaults and scoped recipients match the declarative runtime", () => {
  const { state, make, context } = scenario();
  const source = make(510);
  const own = make(503);
  const opponent = make(514);
  state.bot.field.push(own);
  state.player.field.push(opponent);
  stats.applyGrantProtection(context({ type: "grant_protection", protectionType: "effect_destruction", removeOnLeave: false,
    targetScope: { owner: "opponent", zone: "field" } }, { sourceCard: source }));
  assert.equal(own.protectionEffects, undefined);
  assert.deepEqual(opponent.protectionEffects, [{
    type: "effect_destruction", source: "Tech-Zero Atomic Slasher", duration: "while_faceup", grantedOnTurn: 4,
    expiresOnTurn: null, sourceOwner: "any", removeOnLeave: false,
  }]);
});

for (const actor of ["player", "bot"] as const) {
  test(`Level changes and direct-result protection match real effect resolution (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
    t.after(() => game.dispose("tech_zero_effect_parity"));
    game.turn = actor;
    game.turnCounter = 4;
    game.phase = "main1";
    game.disablePresentationDelays = true;
    const owner = game[actor];
    const source = new Card(cardDefinition(510), actor);
    const destination = new Card(cardDefinition(517), actor);
    placeFieldCards(owner.field, destination);
    owner.graveyard.push(source);
    const { make, context } = scenario(actor);
    const simulatedSource = make(510);
    const simulatedDestination = make(517);
    const actions = [
      { type: "modify_level", targetRef: "result", amount: -2 },
      { type: "modify_level", targetRef: "result", amount: 1 },
      { type: "grant_protection", targetRef: "result", protectionType: "battle_destruction", duration: "end_of_next_turn" },
      { type: "grant_protection", targetRef: "result", protectionType: "effect_destruction", duration: "end_of_next_turn", sourceOwner: "opponent" },
    ] satisfies Array<ActionOf<"modify_level"> | ActionOf<"grant_protection">>;
    await game.effectEngine.applyActions(actions, { player: owner, opponent: game[actor === "player" ? "bot" : "player"], source }, { result: [destination] });
    for (const action of actions) {
      if (action.type === "modify_level") stats.applyModifyLevel(context(action, { sourceCard: simulatedSource }, { result: [simulatedDestination] }));
      else stats.applyGrantProtection(context(action, { sourceCard: simulatedSource }, { result: [simulatedDestination] }));
    }
    assert.equal(destination.level, 11);
    assert.equal(destination.originalLevel, 12);
    assert.equal(simulatedDestination.level, destination.level);
    assert.equal(simulatedDestination.originalLevel, destination.originalLevel);
    assert.deepEqual(simulatedDestination.protectionEffects, destination.protectionEffects);
  });
}

for (const actor of ["player", "bot"] as const) {
  test(`Slasher scoped buff matches runtime stats and next-turn records (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
    t.after(() => game.dispose("slasher_buff_parity"));
    game.turn = actor;
    game.turnCounter = 4;
    game.phase = "main1";
    game.disablePresentationDelays = true;
    const owner = game[actor];
    const opponent = game[actor === "player" ? "bot" : "player"];
    const source = new Card(cardDefinition(510), actor);
    const core = new Card(cardDefinition(501), actor);
    const facedown = new Card(cardDefinition(503), actor);
    facedown.isFacedown = true;
    const opposing = new Card(cardDefinition(503), opponent.id);
    placeFieldCards(owner.field, source, core, facedown);
    placeFieldCards(opponent.field, opposing);
    const action = required(source.effects.find(effect => effect.id === "tech_zero_atomic_slasher_synchro_buff")?.actions?.[0]);
    assert.equal(action.type, "buff_stats_temp");
    if (action.type !== "buff_stats_temp") return;
    const { state, context } = scenario(actor);
    const copy = createPlanningCopy();
    const simulated = [source, core, facedown].map(card => copy.cloneCardForSim(card));
    state.bot.field.push(...simulated);
    const simulatedOpponent = copy.cloneCardForSim(opposing);
    state.player.field.push(simulatedOpponent);
    await game.effectEngine.applyActions([action], { source, player: owner, opponent }, {});
    stats.applyBuffStatsTemp(context(action, { sourceCard: required(simulated[0]) }));
    for (const [index, live] of [source, core, facedown].entries()) {
      const projected = required(simulated[index]);
      assert.equal(projected.atk, live.atk);
      assert.equal(projected.def, live.def);
      assert.deepEqual(projected.turnBasedBuffs, live.turnBasedBuffs);
      assert.equal(projected.tempAtkBoost, 0);
      assert.equal(projected.tempDefBoost, 0);
    }
    assert.equal(source.atk, source.baseAtk + 300);
    assert.equal(required(required(simulated[0]).turnBasedBuffs?.[0]).expiresOnTurn, 5);
    assert.equal(simulatedOpponent.atk, opposing.atk);
  });
}

for (const action of [
  { type: "buff_stats_temp", targetRef: "self", atkBoostFromContext: { key: "levelSum", multiplier: 100 }, duration: "end_of_turn" },
  { type: "buff_stats_temp", targetRef: "self", atkBoost: -5000, defBoost: -5000 },
  { type: "buff_stats_temp", targetRef: "self", atkBoost: 100, defBoost: 200, permanent: true },
  { type: "buff_stats_temp", targetRef: "self", atkBoost: 100, defBoost: 200, durationTurns: 3 },
  { type: "buff_stats_temp", targetRef: "self", atkBoost: 100, defBoost: 200, expiresOnTurn: 7 },
  { type: "buff_stats_temp", targetRef: "self", atkBoostFromContext: { key: "totals.value", divideBy: 3, multiplier: 100, round: "floor" },
    defBoostFromContext: { key: "totals.value", divideBy: 3, round: "ceil" } },
] satisfies Array<ActionOf<"buff_stats_temp">>) {
  test(`stat buff parity preserves applied deltas and effective stats: ${JSON.stringify(action)}`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
    t.after(() => game.dispose("stat_buff_parity"));
    game.turnCounter = 4;
    game.disablePresentationDelays = true;
    const source = new Card(cardDefinition(515), "bot");
    placeFieldCards(game.bot.field, source);
    const { context } = scenario();
    const projected = createPlanningCopy().cloneCardForSim(source);
    const actionContext = { source: projected, levelSum: 6, totals: { value: 7 } };
    const runtimeActionContext = unsafeFixture<NonNullable<EffectContext["actionContext"]>>(
      { levelSum: 6, totals: { value: 7 } },
      "Declarative actions store numeric results under dynamic context keys such as storeLevelSumAs");
    await game.effectEngine.applyActions([action], { source, player: game.bot, opponent: game.player,
      actionContext: runtimeActionContext }, {});
    stats.applyBuffStatsTemp(context(action, { sourceCard: projected, activationContext: { actionContext } }));
    assert.equal(projected.atk, source.atk);
    assert.equal(projected.def, source.def);
    assert.equal(projected.tempAtkBoost, source.tempAtkBoost);
    assert.equal(projected.tempDefBoost, source.tempDefBoost);
    assert.deepEqual(projected.turnBasedBuffs, source.turnBasedBuffs);
    assert.equal(getEffectiveAtk(projected), source.atk);
    assert.equal(getEffectiveDef(projected), source.def);
    assert.equal(getEffectiveStat(projected, "atk"), source.atk);
    assert.equal(getEffectiveStat(projected, "def"), source.def);
  });
}

test("board and resource evaluators read canonical totals without adding cleanup records", () => {
  const { make } = scenario();
  const card = make(515);
  card.atk = 3300;
  card.def = 2900;
  card.tempAtkBoost = 600;
  card.tempDefBoost = 300;
  const sameTotals = { ...card, tempAtkBoost: 0, tempDefBoost: 0 };
  const strategy = new BaseStrategy(null);
  assert.equal(strategy.evaluateMyMonster(card, {}), strategy.evaluateMyMonster(sameTotals, {}));
  assert.equal(estimateMonsterValue(card), estimateMonsterValue(sameTotals));
  assert.equal(calculateThreatScore(card), calculateThreatScore(sameTotals));
});

test("simulated draws remove the runtime top and preserve only unknown card count", () => {
  const { state, make, context } = scenario();
  const bottom = make(518);
  const middle = make(501);
  const top = make(517);
  state.bot.deck.push(bottom, middle, top);
  const options: SimulatedActionOptions = { actionContext: {} };
  resources.applyDraw(context({ type: "draw", amount: 2 }, options));
  assert.deepEqual(state.bot.deck, [bottom]);
  assert.deepEqual(state.bot.hand.map(card => ({ ...card })), [
    { instanceId: "sim:draw:1", owner: "bot", _simUnknownDraw: true },
    { instanceId: "sim:draw:2", owner: "bot", _simUnknownDraw: true },
  ]);
  assert.equal(state._simRequiresReplan, true);
  assert.equal(state._simUnknownDrawCount, 2);
  assert.deepEqual(options.lastDrawnCards, state.bot.hand);
  assert.equal(options.lastDrawnCard, state.bot.hand[0]);
  assert.deepEqual(options.actionContext?.lastDrawnCards, state.bot.hand);
  assert.equal(state._simUnsupportedActions, undefined);
});

test("draw projection never reads a hidden card's properties and survives deck permutations", () => {
  const hands = [];
  for (const ids of [[501, 518], [518, 501]]) {
    const { state, make, context } = scenario();
    state.bot.deck.push(...ids.map(make));
    for (const card of state.bot.deck) {
      Object.defineProperty(card, "name", { configurable: true, get() { throw new Error("hidden name read"); } });
      Object.defineProperty(card, "cardKind", { configurable: true, get() { throw new Error("hidden kind read"); } });
    }
    resources.applyDraw(context({ type: "draw", amount: 1 }));
    assert.equal(state.bot.hand[0]?._simUnknownDraw, true);
    hands.push(state.bot.hand);
  }
  assert.deepEqual(hands[0], hands[1]);
});

test("zero and empty draws preserve counts and do not require replan", () => {
  const { state, make, context } = scenario();
  state.bot.deck.push(make(518));
  resources.applyDraw(context({ type: "draw", amount: 0 }));
  assert.equal(state.bot.deck.length, 1);
  assert.equal(state.bot.hand.length, 0);
  assert.equal(state._simRequiresReplan, undefined);
  resources.applyDraw(context({ type: "draw", amount: 3 }));
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state._simUnknownDrawCount, 1);
  state._simRequiresReplan = false;
  resources.applyDraw(context({ type: "draw", amount: 1 }));
  assert.equal(state._simRequiresReplan, false);
  assert.equal(state._simUnknownDrawCount, 1);
});

for (const actor of ["player", "bot"] as const) {
  test(`opponent draws retain physical ownership and unique generated identity (${actor})`, () => {
    const { state, make, context } = scenario(actor);
    state._simGeneratedInstanceCounter = 7;
    state.bot.deck.push(make(501));
    state.player.deck.push(make(518));
    resources.applyDraw(context({ type: "draw", amount: 1 }));
    resources.applyDraw(context({ type: "draw", amount: 1, player: "opponent" }));
    assert.equal(state.bot.hand[0]?.instanceId, "sim:draw:8");
    assert.equal(state.player.hand[0]?.instanceId, "sim:draw:9");
    assert.equal(state.bot.hand[0]?.owner, actor);
    assert.equal(state.player.hand[0]?.owner, state.player.id);
    assert.equal(state._simUnknownDrawCount, 2);
  });
}

test("draw_and_summon stops at the unknown draw without evaluating or summoning it", () => {
  const { state, make, context } = scenario();
  const pulse = make(508);
  state.bot.graveyard.push(pulse);
  state.bot.deck.push(make(501));
  const result = resources.applyDrawAndSummon(context({ type: "draw_and_summon", drawAmount: 1,
    condition: { type: "match_card_props", filters: { cardKind: "monster" } }, optional: false }, { sourceCard: pulse }));
  assert.equal(result, STOP_SIMULATION);
  assert.deepEqual(state.bot.field, []);
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state.bot.hand[0]?._simUnknownDraw, true);
  assert.equal(state._simRequiresReplan, true);
  assert.equal(state._simUnsupportedActions, undefined);
});
