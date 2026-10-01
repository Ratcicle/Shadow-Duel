import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  Object.assign(game, { turn: "player", turnCounter: 4, phase: "main1", disablePresentationDelays: true });
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "human";
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showChainResponseModal = async () => null;
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
  t.after(() => game.dispose());
  return game;
}

async function finishSelections(
  game: RuntimeGame,
  action: Promise<unknown>,
  choose: (session: NonNullable<RuntimeGame["targetSelection"]>) => Card | undefined,
) {
  let done = false;
  let failure: unknown;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  const callbacks = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      const preferred = choose(session);
      for (const requirement of session.requirements) {
        const candidate = required(requirement.candidates.find(entry => entry.cardRef === preferred)
          ?? requirement.candidates[0]);
        session.selections[requirement.id] = [candidate.key];
      }
      const callback = game.finishTargetSelection();
      callbacks.add(callback);
      void callback.then(() => callbacks.delete(callback), error => { failure = error; callbacks.delete(callback); });
    }
    if (done && !game.targetSelection && callbacks.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "the real activation and resumed Chain must finish");
  await completion;
  if (failure) throw failure;
  assert.equal(game.targetSelection, null);
  assert.equal(callbacks.size, 0);
}

for (const destroyBinding of [true, false]) {
  test(`deferred Valiant summon ${destroyBinding ? "cannot search after linked destruction" : "searches once when another trap is destroyed"}`, async t => {
    const game = setup(t);
    const dragon = new Card(cardDefinition("Majestic Silver Dragon"), game.player.id);
    const roar = new Card(cardDefinition("Hellkite Roar"), game.player.id);
    const call = new Card(cardDefinition("Call of the Haunted"), game.bot.id);
    const otherTrap = new Card(cardDefinition("Mirror Force"), game.bot.id);
    const valiant = new Card(cardDefinition(151), game.bot.id);
    const searched = new Card(cardDefinition(151), game.bot.id);
    Object.assign(call, { isFacedown: true, setTurn: 2 });
    Object.assign(otherTrap, { isFacedown: true, setTurn: 2 });
    placeFieldCards(game.player.field, dragon);
    placeFieldCards(game.bot.spellTrap, call, otherTrap);
    game.player.hand.push(roar);
    game.bot.graveyard.push(valiant);
    game.bot.deck.push(searched);
    let offeredCall = false;
    game.ui.showChainResponseModal = async candidates => {
      if (offeredCall) return null;
      const candidate = candidates.find(entry => entry.card === call);
      if (candidate) offeredCall = true;
      return candidate ?? null;
    };
    const activations: string[] = [];
    const resolutions: string[] = [];
    game.on("effect_activated", event => { if (event.effectId) activations.push(event.effectId); });
    game.on("chain_link_resolution", event => {
      if (event.stage === "completed" && event.effectId) resolutions.push(event.effectId);
    });
    let pausedAfterSummon = false;
    let savedPresence: number | null | undefined;
    await finishSelections(game, game.tryActivateSpell(roar, 0).then(result => {
      assert.equal(result.success, true, result.reason ?? undefined);
      return result;
    }), session => {
      if (session.requirements.some(requirement => requirement.id === "destroy_targets")) {
        pausedAfterSummon = true;
        assert.equal(game.chainSystem.isChainResolving(), true, "Hellkite waits inside the resolving Chain for its manual choice");
        assert.ok(game.bot.field.includes(valiant));
        assert.equal(game.bot.hand.length, 0, "the summon trigger cannot resolve inside the original Chain");
        assert.deepEqual(activations, ["hellkite_roar_pop_backrow", "call_of_the_haunted_activate"]);
        const occurrence = required(game.chainSystem.pendingTriggerOccurrences.find(entry => entry.eventName === "after_summon"));
        savedPresence = occurrence.entries?.find(entry => entry.card === valiant)?.sourceAtTrigger?.locationVersion;
        return destroyBinding ? call : otherTrap;
      }
      return session.requirements.some(requirement => requirement.id === "haunted_target") ? valiant : searched;
    });
    assert.ok(offeredCall);
    assert.ok(pausedAfterSummon);
    assert.equal(game.bot.hand.includes(searched), !destroyBinding);
    assert.equal(game.bot.graveyard.includes(valiant), destroyBinding);
    assert.equal(savedPresence, 1, "capture must preserve the summoned field presence across suspension");
    assert.equal(activations.filter(id => id === "luminarch_valiant_search").length, destroyBinding ? 0 : 1);
    assert.deepEqual(resolutions.slice(0, 2), ["call_of_the_haunted_activate", "hellkite_roar_pop_backrow"]);
    assert.equal(game.chainSystem.pendingTriggerOccurrences.length, 0);
    assert.equal(game.chainSystem.pendingChainSelection, null);
  });
}

test("deferred summons distinguish the first presence from the same card summoned again", async t => {
  const game = setup(t);
  game.player.controllerType = "ai";
  const valiant = new Card(cardDefinition(151), game.player.id);
  game.player.graveyard.push(valiant);
  game.player.deck.push(new Card(cardDefinition(151), game.player.id), new Card(cardDefinition(151), game.player.id));
  const activations: number[] = [];
  const rejections: string[] = [];
  game.on("effect_activated", event => {
    if (event.effectId === "luminarch_valiant_search") activations.push(valiant.locationVersion);
  });
  game.on("trigger_candidate_rejected", event => {
    if (event.effectId === "luminarch_valiant_search" && event.rejectionReason) rejections.push(event.rejectionReason);
  });
  game.chainSystem.isPreparingActivation = true;
  for (let summon = 0; summon < 2; summon++) {
    const summoned = await game.moveCard(valiant, game.player, "field", {
      fromZone: "graveyard", awaitEvents: true, summonOrigin: "effect_resolution", position: "attack",
    });
    assert.equal(summoned.success, true);
    if (summon === 0) await game.moveCard(valiant, game.player, "graveyard", { fromZone: "field", awaitEvents: true });
  }
  assert.equal(game.player.hand.length, 0);
  assert.deepEqual(activations, []);
  assert.deepEqual(game.chainSystem.pendingTriggerOccurrences
    .filter(occurrence => occurrence.eventName === "after_summon")
    .map(occurrence => occurrence.entries?.find(entry => entry.card === valiant)?.sourceAtTrigger?.locationVersion), [1, 3]);
  game.chainSystem.isPreparingActivation = false;
  await game.flushPendingTriggerOccurrences();
  assert.deepEqual(activations, [3], "only the second summon remains eligible");
  assert.deepEqual(rejections, ["source_location_changed"]);
  assert.equal(game.player.hand.length, 1);
  assert.equal(game.chainSystem.pendingTriggerOccurrences.length, 0);
});

test("an empty deferred summon package cannot gain an observer that enters afterward", async t => {
  const game = setup(t);
  game.player.controllerType = "ai";
  const summoned = new Card({ name: "Earlier summon", cardKind: "monster" }, game.bot.id);
  const observer = new Card({ name: "Later observer", cardKind: "monster", effects: [{
    id: "observe_opponent_summon", timing: "on_event", event: "after_summon",
    triggerRequirement: "mandatory", triggerTiming: "if", requireOpponentSummon: true,
    actions: [{ type: "draw", amount: 1, player: "self" }],
  }] }, game.player.id);
  game.bot.hand.push(summoned);
  game.player.hand.push(observer);
  game.player.deck.push(new Card(cardDefinition(151), game.player.id));
  let collections = 0;
  let completions = 0;
  const collect = game.effectEngine.collectAfterSummonTriggers.bind(game.effectEngine);
  game.effectEngine.collectAfterSummonTriggers = async payload => {
    const result = await collect(payload);
    if (payload.card !== summoned) return result;
    collections++;
    return { ...result, onComplete: async () => { completions++; await result.onComplete?.(); } };
  };
  game.chainSystem.isPreparingActivation = true;
  for (const [card, owner] of [[summoned, game.bot], [observer, game.player]] as const) {
    const result = await game.moveCard(card, owner, "field", {
      fromZone: "hand", summonOrigin: "effect_resolution", position: "attack", awaitEvents: true,
    });
    assert.equal(result.success, true);
  }
  assert.equal(completions, 0, "collection must not run package completion inside the Chain");
  game.chainSystem.isPreparingActivation = false;
  await game.flushPendingTriggerOccurrences();
  assert.equal(game.player.hand.length, 0, "a later source cannot observe the earlier summon");
  assert.equal(collections, 1, "the captured empty package must not be collected again");
  assert.equal(completions, 1, "package completion runs once after SEGOC");
});

test("a deferred summon can target a monster that reaches the graveyard before activation", async t => {
  const game = setup(t);
  game.player.controllerType = "ai";
  const luminescent = new Card(cardDefinition(256), game.player.id);
  const target = new Card(cardDefinition(255), game.player.id);
  game.player.hand.push(luminescent, target);
  game.chainSystem.isPreparingActivation = true;
  const summon = await game.moveCard(luminescent, game.player, "field", {
    fromZone: "hand", summonOrigin: "effect_resolution", summonMethodOverride: "normal",
    position: "attack", awaitEvents: true,
  });
  assert.equal(summon.success, true);
  await game.moveCard(target, game.player, "graveyard", { fromZone: "hand", awaitEvents: true });
  game.chainSystem.isPreparingActivation = false;
  await game.flushPendingTriggerOccurrences();
  assert.ok(game.player.field.includes(target), "activation target availability is checked after the original Chain");
});

for (const sourceLeaves of [false, true]) {
  test(`deferred action availability and AI planning run only for a surviving source (leaves=${sourceLeaves})`, async t => {
    const game = setup(t);
    game.player.controllerType = "ai";
    const valiant = new Card(cardDefinition(151), game.player.id);
    const searched = new Card(cardDefinition(151), game.player.id);
    game.player.graveyard.push(valiant, searched);
    let policies = 0;
    let plans = 0;
    game.player.strategy = unsafeFixture<NonNullable<typeof game.player.strategy>>({
      shouldActivateEffect: () => { policies++; return game.player.deck.includes(searched); },
      buildActivationContextForEffect: () => { plans++; return {}; },
    }, "Controlled AI activation policy inspects live availability; no other strategy capabilities are needed.");
    game.chainSystem.isPreparingActivation = true;
    const result = await game.moveCard(valiant, game.player, "field", {
      fromZone: "graveyard", summonOrigin: "effect_resolution", position: "attack", awaitEvents: true,
    });
    assert.equal(result.success, true);
    assert.equal(policies, 0, "AI preference waits for the legal trigger opportunity");
    assert.equal(plans, 0, "AI planning waits for the legal trigger opportunity");
    await game.moveCard(searched, game.player, "deck", { fromZone: "graveyard", awaitEvents: true });
    if (sourceLeaves) await game.moveCard(valiant, game.player, "graveyard", { fromZone: "field", awaitEvents: true });
    game.chainSystem.isPreparingActivation = false;
    await game.flushPendingTriggerOccurrences();
    assert.equal(game.player.hand.includes(searched), !sourceLeaves);
    assert.equal(policies, sourceLeaves ? 0 : 1);
    assert.equal(plans, sourceLeaves ? 0 : 1);
  });
}

test("a captured temporary summon trigger retains live action availability and is consumed once", async t => {
  const game = setup(t);
  game.player.controllerType = "ai";
  const source = new Card({ name: "Temporary trigger source", cardKind: "spell" }, game.player.id);
  const summoned = new Card({ name: "Bound summon", cardKind: "monster" }, game.player.id);
  const searched = new Card(cardDefinition(151), game.player.id);
  game.player.graveyard.push(source, summoned, searched);
  const registered = await game.effectEngine.applyActions([{
    type: "register_temporary_event_effect", event: "after_summon", duration: "until_consumed", uses: 1,
    triggerRequirement: "mandatory", triggerTiming: "if", bindEventTargetRef: "bound",
    actions: [{ type: "search_any", archetype: "Luminarch", cardKind: "monster", player: "self" }],
  }], { source, player: game.player, opponent: game.bot }, { bound: [summoned] });
  assert.equal(registered.success, true);
  const activations: string[] = [];
  game.on("effect_activated", event => { if (event.effectId) activations.push(event.effectId); });
  game.chainSystem.isPreparingActivation = true;
  const result = await game.moveCard(summoned, game.player, "field", {
    fromZone: "graveyard", summonOrigin: "effect_resolution", position: "attack", awaitEvents: true,
  });
  assert.equal(result.success, true);
  assert.deepEqual(activations, []);
  assert.equal(game.temporaryEventEffects.length, 0, "the bound registration is consumed by the captured event");
  await game.moveCard(searched, game.player, "deck", { fromZone: "graveyard", awaitEvents: true });
  game.chainSystem.isPreparingActivation = false;
  await game.flushPendingTriggerOccurrences();
  assert.ok(game.player.hand.includes(searched));
  assert.equal(activations.length, 1);
  await game.flushPendingTriggerOccurrences();
  assert.equal(activations.length, 1);
});
