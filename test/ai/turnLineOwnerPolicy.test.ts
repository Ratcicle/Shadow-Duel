import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { EventResolutionOutcome } from "../../src/core/contracts/events.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, seat: "player" | "bot", opponentPreset = "bloomrot") {
  const first = new Bot(seat === "player" ? "techzero" : opponentPreset);
  first.id = "player";
  const second = new Bot(seat === "bot" ? "techzero" : opponentPreset);
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime interface");
  const runtime = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game supplies the attached Bot execution and snapshot capabilities");
  first.game = runtime;
  second.game = runtime;
  game.turn = seat;
  game.phase = "main1";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  t.after(() => game.dispose("turn_line_owner_policy"));
  const actor = seat === "player" ? first : second;
  const opponent = seat === "player" ? second : first;
  const make = (id: number, owner = actor) => new Card(cardDefinition(id), owner.id);
  return { game, runtime, actor, opponent, make };
}

function fungalArmorScenario(t: TestContext, seat: "player" | "bot") {
  const fixture = scenario(t, seat);
  const { actor, opponent, make } = fixture;
  const lancer = make(516), catapult = make(502), core = make(501), wyvern = make(504), mage = make(512);
  placeFieldCards(actor.field, lancer, catapult, core, wyvern);
  actor.extraDeck.push(mage);
  const host = make(405, opponent), armor = make(413, opponent);
  placeFieldCards(opponent.field, host);
  placeFieldCards(opponent.spellTrap, armor);
  armor.equippedTo = host;
  armor.equipTarget = host;
  host.equips = [armor];
  const action: AIAction = { type: "synchro", synchroInstanceId: mage.instanceId,
    materialInstanceIds: [core.instanceId, wyvern.instanceId], position: "attack" };
  return { ...fixture, lancer, catapult, armor, action };
}

for (const seat of ["player", "bot"] as const) {
  for (const operation of ["search", "recruit", "condition"] as const) {
    test(`TurnLine replans when an opposing ${operation} depends on a hidden deck card (${seat})`, async t => {
      const { runtime, actor, opponent, make } = scenario(t, seat, "void");
      const actions: CardAction[] = operation === "condition"
        ? [{ type: "heal", amount: 100, player: "self" }]
        : operation === "search"
          ? [{ type: "search_any", zone: "deck", player: "self", filters: { cardKind: "monster" }, count: { min: 1, max: 1 } }]
          : [{ type: "special_summon_from_zone", zone: "deck", player: "self", filters: { cardKind: "monster" }, position: "attack" }];
      const source = new Card({ ...cardDefinition(1), id: 990903, name: "Public hidden-zone trigger", effects: [{
        id: "hidden-zone-trigger", timing: "on_event", event: "after_summon", requireOpponentSummon: true,
        triggerRequirement: "mandatory", triggerTiming: "if", summonMethods: ["normal"],
        ...(operation === "condition" ? { conditions: [{ type: "control_card_filters" as const,
          owner: "self" as const, zone: "deck" as const, filters: { cardKind: "monster" as const }, min: 1 }] } : {}),
        actions,
      }] }, opponent.id);
      placeFieldCards(opponent.field, source);
      const hidden = make(204, opponent);
      opponent.deck.push(hidden);
      actor.hand.push(make(1));
      const initialLp = opponent.lp;
      const action: AIAction = { type: "summon", index: 0, cardId: 1, position: "attack" };
      const result = required(await turnLineSearch(runtime, actor.strategy, { maxDepth: 2, preGeneratedActions: [action] }));
      assert.equal(result.completion.terminationReason, "requires_replan",
        "an opaque card failing an identity filter cannot establish that a public effect fails");
      assert.equal(result.sequence.length, 1);
      assert.equal(result.completion.unsupportedBranches, 0);
      assert.equal(opponent.deck[0], hidden, "planning leaves the live hidden deck intact");
      assert.equal(await actor.executeMainPhaseAction(runtime, action), true);
      if (operation === "condition") {
        assert.equal(opponent.lp, initialLp + 100);
      } else {
        assert.equal(opponent.deck.length, 0);
        assert.ok((operation === "search" ? opponent.hand : opponent.field).includes(hidden));
      }
    });
  }

  for (const hiddenCount of [0, 1]) {
    test(`TurnLine uses public counts for an empty filtered deck or an unfiltered hidden deck (${seat}, ${hiddenCount})`, async t => {
      const { runtime, actor, opponent, make } = scenario(t, seat, "void");
      const source = new Card({ ...cardDefinition(1), id: 990904, name: "Public deck-count trigger", effects: [{
        id: "deck-count-trigger", timing: "on_event", event: "after_summon", requireOpponentSummon: true,
        triggerRequirement: "mandatory", triggerTiming: "if", summonMethods: ["normal"],
        conditions: [{ type: "control_card_filters", owner: "self", zone: "deck", min: 1,
          ...(hiddenCount ? {} : { filters: { cardKind: "monster" as const } }) }],
        actions: [{ type: "heal", amount: 100, player: "self" }],
      }] }, opponent.id);
      placeFieldCards(opponent.field, source);
      if (hiddenCount) opponent.deck.push(make(204, opponent));
      actor.hand.push(make(1));
      const initialLp = opponent.lp;
      const action: AIAction = { type: "summon", index: 0, cardId: 1, position: "attack" };
      const result = required(await turnLineSearch(runtime, actor.strategy, { maxDepth: 2, preGeneratedActions: [action] }));
      assert.notEqual(result.completion.terminationReason, "requires_replan");
      assert.equal(result.finalState?.player.lp, initialLp + hiddenCount * 100);
    });
  }

  test(`TurnLine uses Void's recruitment policy for an opposing public trigger (${seat})`, async t => {
    const { runtime, actor, opponent, make } = scenario(t, seat, "void");
    const source = new Card({ ...cardDefinition(1), id: 990901, name: "Public recruitment trigger", effects: [{
      id: "public-recruit", timing: "on_event", event: "after_summon", requireOpponentSummon: true,
      triggerRequirement: "mandatory", triggerTiming: "if", summonMethods: ["normal"],
      actions: [{ type: "search_any", zone: "graveyard", player: "self",
        count: { min: 1, max: 1 } }],
    }] }, opponent.id);
    placeFieldCards(opponent.field, source);
    opponent.graveyard.push(make(201, opponent), make(204, opponent));
    actor.hand.push(make(1));
    const action: AIAction = { type: "summon", index: 0, cardId: 1, position: "attack" };
    const result = required(await turnLineSearch(runtime, actor.strategy, { maxDepth: 1, preGeneratedActions: [action] }));
    const predicted = required(result.finalState);
    assert.deepEqual(predicted.player.hand.map(card => card.id), [204],
      "Void values Hollow's board role above the higher-ATK Conjurer");
    assert.equal(await actor.executeMainPhaseAction(runtime, action), true);
    assert.deepEqual(predicted.player.hand.map(card => card.id), opponent.hand.map(card => card.id));
  });

  test(`TurnLine predicts Bloomrot's Fungal Armor target using its controller policy (${seat})`, async t => {
    const { game, runtime, actor, lancer, catapult, action } = fungalArmorScenario(t, seat);
    const flushResults: EventResolutionOutcome[] = [];
    const flush = game.flushPendingTriggerOccurrences.bind(game);
    game.flushPendingTriggerOccurrences = async options => {
      const result = await flush(options);
      flushResults.push(result);
      return result;
    };
    const result = required(await turnLineSearch(runtime, actor.strategy, {
      maxDepth: 1, preGeneratedActions: [action],
    }));
    const predicted = required(result.finalState);
    assert.equal(predicted.bot.field.find(card => card.id === 516)?.counters?.get("spore"), 1);
    assert.equal(predicted.bot.field.find(card => card.id === 502)?.counters?.get("spore") || 0, 0);
    assert.equal(lancer.getCounter("spore"), 0, "planning cannot mutate the live board");
    assert.equal(await actor.executeMainPhaseAction(runtime, action), true);
    assert.equal(lancer.getCounter("spore"), 1);
    assert.equal(catapult.getCounter("spore"), 0);
    assert.deepEqual(predicted.bot.field.map(card => card.id), actor.field.map(card => card.id));
    assert.deepEqual(game.chainSystem.pendingTriggerOccurrences, [],
      "Core's failed draw cannot abandon the triggers from Armor's destruction");
    assert.ok(flushResults.some(result => result.ok === false),
      "draining Armor's trigger must preserve Core's failed draw result");
  });

  test(`TurnLine owner policies retain public cards and hide opponent secrets (${seat})`, async t => {
    const choices: Array<number | undefined> = [];
    for (const hiddenId of [407, 401]) {
      const { runtime, actor, opponent, make, action } = fungalArmorScenario(t, seat);
      actor.hand.push(make(518));
      opponent.hand.push(make(hiddenId, opponent));
      opponent.deck.push(make(hiddenId, opponent));
      opponent.extraDeck.push(make(418, opponent));
      const facedown = make(417, opponent);
      facedown.isFacedown = true;
      placeFieldCards(opponent.spellTrap, facedown);
      const result = required(await turnLineSearch(runtime, actor.strategy, {
        maxDepth: 1, preGeneratedActions: [action],
      }));
      const predicted = required(result.finalState);
      choices.push(predicted.bot.field.find(card => card.counters?.get("spore"))?.id);
      assert.equal(predicted.bot.hand[0]?.id, 518, "the root player's own hand stays known");
      for (const zone of ["hand", "deck", "extraDeck"] as const) {
        assert.equal(predicted.player[zone].length, 1);
        assert.equal(predicted.player[zone][0]?.name, undefined, `${zone} must not reveal its identity`);
        assert.equal(predicted.player[zone][0]?.id, undefined);
        assert.equal(predicted.player[zone][0]?.instanceId, opponent[zone][0]?.instanceId);
      }
      const unknownBackrow = required(predicted.player.spellTrap.find(card => card.instanceId === facedown.instanceId));
      assert.equal(unknownBackrow.name, undefined);
      assert.equal(unknownBackrow.isFacedown, true);
      assert.equal(opponent.hand[0]?.id, hiddenId, "the live hand remains intact");
    }
    assert.deepEqual(choices, [516, 516], "changing hidden cards cannot change the public predicted choice");
  });

  test(`TurnLine never reads hidden card identities or the live opponent policy (${seat})`, async t => {
    const { runtime, actor, opponent, make, action } = fungalArmorScenario(t, seat);
    const hidden = make(407, opponent);
    opponent.hand.push(hidden);
    Object.defineProperty(hidden, "name", { get() { throw new Error("read hidden card name"); } });
    Object.defineProperty(hidden, "id", { get() { throw new Error("read hidden card definition"); } });
    Reflect.set(opponent.strategy, "buildActivationContextForEffect", () => { throw new Error("used live opponent policy"); });
    const result = required(await turnLineSearch(runtime, actor.strategy, { maxDepth: 1, preGeneratedActions: [action] }));
    assert.equal(result.finalState?.bot.field.find(card => card.id === 516)?.counters?.get("spore"), 1);
  });

  test(`TurnLine requests a fresh plan after moving an unknown opponent card (${seat})`, async t => {
    const { runtime, actor, opponent, make } = scenario(t, seat);
    const armor = make(413, opponent);
    armor.isFacedown = true;
    placeFieldCards(opponent.spellTrap, armor);
    const source = new Card({ ...cardDefinition(1), id: 990902, name: "Public backrow removal", effects: [{
      id: "remove-hidden", timing: "ignition", activationZones: ["field"],
      targets: [{ id: "backrow", owner: "opponent", zone: "spellTrap", count: { min: 1, max: 1 } }],
      actions: [{ type: "destroy", targetRef: "backrow" }],
    }] }, actor.id);
    placeFieldCards(actor.field, source);
    const action: AIAction = { type: "monsterEffect", fieldIndex: 0, cardId: source.id, effectId: "remove-hidden" };
    const result = required(await turnLineSearch(runtime, actor.strategy, { maxDepth: 2, preGeneratedActions: [action] }));
    assert.equal(result.completion.terminationReason, "requires_replan");
    assert.equal(result.sequence.length, 1, "no followup may assume the unknown card has no graveyard effect");
    assert.ok(result.finalState?.player.graveyard.some(card => card.instanceId === armor.instanceId));
  });
}
