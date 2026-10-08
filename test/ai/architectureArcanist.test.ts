import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import Player from "../../src/core/Player.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import BaseStrategy from "../../src/core/ai/BaseStrategy.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationState } from "../helpers/simulation.js";
import { applyGenericSimulatedMainPhaseAction, applySimulatedFieldSpellBattleDrawRewards } from "../../src/core/ai/common/simulation.js";
import { storeSimulatedBlueprintAfterResolution } from "../../src/core/ai/common/simulatedActions/flow.js";

const make = (id: number, owner: "bot" | "player" = "bot") =>
  createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), owner));

async function libraryBattle(actor: "bot" | "player", deck: number[], control?: "negated" | "facedown" | "used", strategy: "arcanist" | "shadowheart" | "base" = "arcanist") {
  const opponent = actor === "bot" ? "player" : "bot";
  const attacker = make(313, actor), target = make(302, opponent), library = make(312, actor);
  attacker.position = target.position = "attack";
  if (control === "negated") library.effectsNegated = true;
  if (control === "facedown") library.isFacedown = true;
  const state = simulationState({ turn: actor, phase: "main1", turnCounter: 3, _isPerspectiveState: true,
    bot: { id: actor, field: [attacker], fieldSpell: library, deck: deck.map(id => make(id, actor)) },
    player: { id: opponent, field: [target] } });
  if (control === "used") markSimulatedEffectUsage(state,
    required(library.effects?.find(effect => effect.id === "arcanist_grand_library_battle_draw")), library, actor, true);
  const owner = new Player(actor, "Actor");
  const ai = strategy === "shadowheart" ? new ShadowHeartStrategy(owner) : strategy === "base" ? new BaseStrategy(owner) : new ArcanistStrategy(owner);
  ai.generateMainPhaseActions = () => [];
  const result = required(await turnLineSearch({
    bot: state.bot, player: state.player, turn: state.turn, phase: state.phase,
    turnCounter: state.turnCounter, _isPerspectiveState: true,
    ...(state._simOncePerTurn ? { _simOncePerTurn: state._simOncePerTurn } : {}),
  }, unsafeFixture<Parameters<typeof turnLineSearch>[1]>(ai,
    "Real strategy fixture exercises battle hooks only; unrelated tribute context projections differ between strategies."), {
    turnMode: "mainBattleMain2", maxDepth: 1, nodeBudget: 8, battleStepLimit: 1,
    evaluateState: projected => 8000 - projected.player.lp,
  }));
  assert.equal(result.sequence[0]?.type, "simulatedBattle");
  assert.equal(state.bot.hand.length, 0, "planning must not mutate its input");
  assert.equal(state.bot.deck.length, deck.length);
  return result.finalState;
}

for (const actor of ["bot", "player"] as const) {
  test(`Shared field Spell draw leaves other battle reward families to their existing consumer (${actor})`, () => {
    const opponent = actor === "bot" ? "player" : "bot";
    const source = make(312, actor), attacker = make(313, actor), destroyed = make(302, opponent);
    source.effects = [...source.effects || [], { id: "unmigrated_battle_damage_control", timing: "on_event",
      event: "battle_destroy", triggerRequirement: "mandatory", triggerTiming: "if",
      actions: [{ type: "damage", amount: 700, player: "opponent" }] }];
    const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "battle",
      bot: { id: actor, fieldSpell: source, field: [attacker], deck: [make(303, actor)] },
      player: { id: opponent, graveyard: [destroyed] } });
    applySimulatedFieldSpellBattleDrawRewards(state, { attackerIndex: 0, destroyedCards: [
      { owner: "opponent", destroyedBy: "battle", card: destroyed, position: "attack" },
    ] });
    assert.equal(state.bot.hand.length, 1);
    assert.equal(state.player.lp, 8000);
  });

  for (const invalid of ["negated", "facedown", "unequipped"] as const) {
    test(`The first configured blueprint holder blocks later holders when ${invalid}, matching runtime (${actor})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false });
      t.after(() => game.dispose());
      const owner = game[actor], host = new Card(cardDefinition(302), actor), source = new Card(cardDefinition(304), actor);
      const first = new Card(cardDefinition(301), actor), second = new Card(cardDefinition(301), actor);
      // Two distinct future storage capabilities isolate routing independently
      // of the current Grimoire's single-copy field restriction.
      first.name = "First configured holder"; second.name = "Second configured holder";
      first.equippedTo = second.equippedTo = host; host.equips = [first, second];
      if (invalid === "negated") first.effectsNegated = true;
      if (invalid === "facedown") first.isFacedown = true;
      if (invalid === "unequipped") first.equippedTo = null;
      placeFieldCards(owner.field, host); placeFieldCards(owner.spellTrap, first, second);
      const effect = required(source.effects?.find(entry => entry.timing === "on_play"));
      const runtime = await game.effectEngine.handleBlueprintStorageAfterResolution(source, effect,
        { source, player: owner, opponent: game[actor === "bot" ? "player" : "bot"] });
      assert.equal(runtime, false);
      assert.equal(game.effectEngine.getStoredBlueprints(second).length, 0);
      const copy = createPlanningCopy();
      const projectedFirst = copy.cloneCardForSim(first), projectedSecond = copy.cloneCardForSim(second);
      const state = simulationState({ bot: { id: actor, spellTrap: [projectedFirst, projectedSecond] } });
      assert.equal(storeSimulatedBlueprintAfterResolution(state.bot, copy.cloneCardForSim(source), effect), false);
      assert.equal(projectedSecond.state?.blueprintStorage?.storedBlueprints.length || 0, 0);
    });
  }
  for (const strategy of ["shadowheart", "base"] as const) {
    test(`Declared field Spell battle draw works independently of the ${strategy} strategy (${actor})`, async () => {
      const state = await libraryBattle(actor, [303, 4], undefined, strategy);
      assert.equal(state.bot.hand.length, 1);
      assert.equal(state.bot.deck.length, 1);
      assert.equal(state.bot.hand[0]?._simUnknownDraw, true);
      assert.equal(state._simRequiresReplan, true);
    });
  }
  test(`Grand Library draw count agrees with the real battle trigger (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose());
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    game.turn = actor; game.phase = "battle"; game.turnCounter = 3;
    const attacker = new Card(cardDefinition(313), actor), destroyed = new Card(cardDefinition(302), opponent.id);
    owner.fieldSpell = new Card(cardDefinition(312), actor);
    placeFieldCards(owner.field, attacker);
    opponent.graveyard.push(destroyed);
    owner.deck.push(...[303, 4].map(id => new Card(cardDefinition(id), actor)));
    const triggers = await game.effectEngine.collectBattleDestroyTriggers(
      unsafeFixture<Parameters<typeof game.effectEngine.collectBattleDestroyTriggers>[0]>({ attacker, destroyed,
        attackerOwner: owner, destroyedOwner: opponent, battleDestroyer: attacker, battleDestroyers: [attacker] },
      "Collector fixture supplies battle identities; timing and attack transaction are covered by combat integration tests."));
    const entry = required(triggers.entries.find(trigger => trigger.effect.id === "arcanist_grand_library_battle_draw"));
    const result = await entry.config.activate(null, { ...entry.config.activationContext, confirmed: true });
    assert.ok(result && typeof result === "object" && "success" in result && result.success === true, JSON.stringify(result));
    const projected = await libraryBattle(actor, [303, 4]);
    assert.equal(projected.bot.hand.length, owner.hand.length);
    assert.equal(projected.bot.deck.length, owner.deck.length);
    assert.equal(owner.hand.length, 1);
  });

  test(`Generic hand equip retains its physical reference (${actor})`, () => {
    const host = make(302, actor), source = make(301, actor);
    const state = simulationState({ _isPerspectiveState: true, bot: { id: actor, hand: [source], field: [host] } });
    const ai = new ArcanistStrategy(new Player(actor, "Actor"));
    const options = ai.getPlanningSimulationOptions(state);
    applyGenericSimulatedMainPhaseAction(state, { type: "spell", index: 0, cardId: source.id },
      { ...options, actionOverrides: null });
    assert.equal(state.bot.spellTrap[0], source);
    assert.equal(source.equippedTo, host);
    assert.ok(host.equips?.includes(source));
  });

  test(`Generic hand equip with no legal host stays in hand (${actor})`, () => {
    const source = make(301, actor);
    const state = simulationState({ _isPerspectiveState: true, bot: { id: actor, hand: [source] } });
    const ai = new ArcanistStrategy(new Player(actor, "Actor"));
    applyGenericSimulatedMainPhaseAction(state, { type: "spell", index: 0, cardId: source.id },
      { ...ai.getPlanningSimulationOptions(state), actionOverrides: null });
    assert.deepEqual(state.bot.hand, [source]);
    assert.deepEqual(state.bot.spellTrap, []);
    assert.deepEqual(state.bot.graveyard, []);
  });

  test(`Grand Library battle draw is opaque and stops expansion (${actor})`, async () => {
    const state = await libraryBattle(actor, [303, 4]);
    assert.equal(state.bot.hand.length, 1);
    assert.equal(state.bot.deck.length, 1);
    assert.equal(state.bot.hand[0]?._simUnknownDraw, true);
    assert.equal(state.bot.hand[0]?.id, undefined);
    assert.equal(state.bot.hand[0]?.name, undefined);
    assert.equal(state._simRequiresReplan, true);
    assert.equal(state._simUnknownDrawCount, 1);
  });
  for (const control of ["negated", "facedown", "used"] as const) {
    test(`Grand Library respects ${control} eligibility (${actor})`, async () => {
      const state = await libraryBattle(actor, [303, 4], control);
      assert.equal(state.bot.hand.length, 0);
      assert.equal(state.bot.deck.length, 2);
      assert.notEqual(state._simRequiresReplan, true);
    });
  }
}

test("Grand Library hand projection is invariant under hidden Deck identities and order", async () => {
  const states = await Promise.all([[303, 4], [4, 303], [1, 302]].map(deck => libraryBattle("bot", deck)));
  assert.deepEqual(states[0]?.bot.hand, states[1]?.bot.hand);
  assert.deepEqual(states[0]?.bot.hand, states[2]?.bot.hand);
});

test("Bot generation on the seed 9713 clone does not require runtime hand-procedure methods", t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 9713 });
  t.after(() => game.dispose());
  const bot = Object.assign(new Bot("arcanist"), { oncePerDuelUsageByName: {} as Record<string, number> });
  game.bot = bot; game.turn = "bot"; game.phase = "main1"; game.turnCounter = 1;
  bot.hand.push(...[307, 302, 311, 303].map(id => new Card(cardDefinition(id), "bot")));
  const state = bot.cloneGameState(unsafeFixture<Parameters<Bot["cloneGameState"]>[0]>(game,
    "Concrete runtime fixture supplies the Bot clone contract."));
  assert.equal(Reflect.get(state, "canSummonFromHandByProcedure"), undefined);
  const actions = bot.generateMainPhaseActions(state);
  assert.ok(actions.some(action => action.type === "summon" && action.cardId === 302));
  assert.equal(actions.some(action => action.type === "handSummonProcedure"), false,
    "Albus has no face-up Arcanist host in this original opening");
});

test("Bot clone hand-procedure generation uses cloned host and hand rather than the live Bot", t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 9713 });
  t.after(() => game.dispose());
  const bot = Object.assign(new Bot("arcanist"), { oncePerDuelUsageByName: {} as Record<string, number> });
  game.bot = bot; game.turn = "bot"; game.phase = "main1"; game.turnCounter = 1;
  bot.hand.push(new Card(cardDefinition(307), "bot"));
  const host = new Card(cardDefinition(302), "bot"), equip = new Card(cardDefinition(301), "bot");
  equip.equippedTo = host; host.equips = [equip];
  placeFieldCards(bot.field, host); placeFieldCards(bot.spellTrap, equip);
  const state = bot.cloneGameState(unsafeFixture<Parameters<Bot["cloneGameState"]>[0]>(game,
    "Concrete runtime fixture supplies the Bot clone contract."));
  bot.hand.length = 0;
  const procedure = required(bot.generateMainPhaseActions(state).find(action => action.type === "handSummonProcedure"));
  assert.equal(procedure.cardId, 307);
  assert.equal(procedure.card, state.bot.hand[0]);
});

for (const actor of ["bot", "player"] as const) {
  test(`Seismic Impact hand activation pays its chosen cost and uses the canonical ledger (${actor})`, () => {
    const opponent = actor === "bot" ? "player" : "bot";
    const host = make(302, actor), cost = make(301, actor), source = make(316, actor), target = make(306, opponent);
    cost.equippedTo = host; host.equips = [cost];
    const state = simulationState({ turn: actor, phase: "main1", turnCounter: 3, _isPerspectiveState: true,
      bot: { id: actor, hand: [source], field: [host], spellTrap: [cost] }, player: { id: opponent, field: [target] } });
    const ai = new ArcanistStrategy(new Player(actor, "Actor"));
    ai.simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 316, cardName: source.name,
      activationContext: { decisions: { selections: {
        seismic_impact_equip_cost: [required(cost.instanceId)], seismic_impact_target: [required(target.instanceId)],
      } } } });
    assert.equal(state.bot.hand.length, 0);
    assert.ok(state.bot.graveyard.some(card => card.instanceId === cost.instanceId));
    assert.ok(state.bot.graveyard.some(card => card.instanceId === source.instanceId));
    assert.ok(state.player.banished.some(card => card.instanceId === target.instanceId));
    assert.equal(host.equips?.length, 0);
    assert.equal(canUseSimulatedEffectUsage(state, required(source.effects?.find(effect => effect.timing === "on_play")), source, actor, true), false);
  });

  test(`Blueprint storage follows declarative metadata rather than the holder's name (${actor})`, () => {
    const host = make(302, actor), holder = make(301, actor), source = make(304, actor);
    holder.name = "Synthetic blueprint holder"; holder.equippedTo = host; host.equips = [holder];
    const state = simulationState({ turn: actor, phase: "main1", turnCounter: 3, _isPerspectiveState: true,
      bot: { id: actor, hand: [source], field: [host], spellTrap: [holder] } });
    const ai = new ArcanistStrategy(new Player(actor, "Actor"));
    ai.simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: source.id, cardName: source.name,
      activationContext: { decisions: { selections: { lightning_magic_lance_target: [required(host.instanceId)] } } } });
    assert.deepEqual(holder.state?.blueprintStorage?.storedBlueprints.map(blueprint => blueprint.sourceCardId), [304]);
  });

  test(`Negated Ink River cannot gain counters from a valid Normal Spell (${actor})`, () => {
    const host = make(302, actor), source = make(304, actor), river = make(311, actor);
    river.effectsNegated = true;
    const state = simulationState({ turn: actor, phase: "main1", turnCounter: 3, _isPerspectiveState: true,
      bot: { id: actor, hand: [source], field: [host], spellTrap: [river] } });
    new ArcanistStrategy(new Player(actor, "Actor")).simulateMainPhaseAction(state,
      { type: "spell", index: 0, cardId: source.id, cardName: source.name });
    assert.equal(river.counters?.get("ink") || 0, 0);
  });

  test(`Ink River activation reads the original cloned source after hand removal (${actor})`, () => {
    const host = make(302, actor), source = make(304, actor), river = make(311, actor);
    const state = simulationState({ turn: actor, phase: "main1", turnCounter: 3, _isPerspectiveState: true,
      bot: { id: actor, hand: [source], field: [host], spellTrap: [river] } });
    new ArcanistStrategy(new Player(actor, "Actor")).simulateMainPhaseAction(state,
      { type: "spell", index: 0, cardId: source.id });
    assert.equal(river.counters?.get("ink"), 1);
    assert.ok(state.bot.graveyard.includes(source));
  });
}
