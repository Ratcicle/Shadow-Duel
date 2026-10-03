import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { PlayerId } from "../src/core/contracts/primitives.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";

const passes = () => ({ offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false });

function setup(t: TestContext, id: 353 | 364, seat: PlayerId, controller: "human" | "ai") {
  t.mock.method(console, "log", () => {});
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, randomSeed: 20261003,
    chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual",
    fieldPlacementProvider: async request => ({ outcome: "chosen", slot: required(request.candidates[0]).slot }),
  });
  t.after(() => game.dispose("miragebound_source_presence_s02"));
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  owner.controllerType = controller;
  game.chainSystem.botChooseChainResponse = async () => null;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showChainResponseModal = async () => null;
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
  const source = new Card(cardDefinition(id), owner.id), copy = new Card(cardDefinition(id), owner.id);
  game.ui.showTriggerOrderModal = async options => (options?.candidates || [])
    .filter(candidate => candidate.card === source).map(candidate => candidate.candidateId);
  const scout = new Card(cardDefinition(351), owner.id), dancer = new Card(cardDefinition(352), owner.id);
  const enemy = new Card(cardDefinition(1), opponent.id);
  enemy.position = "attack";
  owner.hand.push(source, copy); placeFieldCards(owner.field, scout, dancer); placeFieldCards(opponent.field, enemy);
  const effect = required(source.effects[0]);
  assert.equal(effect.requiresSourceAtResolution, true);
  const begin = () => id === 353
    ? game.tryActivateMonsterEffect(dancer, { miragebound_dancer_bounce_target: [scout] }, "field", owner)
    : game.tryActivateMonsterEffect(scout, { miragebound_scout_position_target: [enemy] }, "field", owner);
  const cycleSource = async (returns: boolean) => {
    assert.equal((await game.moveCard(source, owner, "graveyard", { fromZone: "hand", awaitEvents: true })).success, true);
    if (returns) assert.equal((await game.moveCard(source, owner, "hand", { fromZone: "graveyard", awaitEvents: true })).success, true);
  };
  const fillField = async () => {
    while (owner.field.length < 5) {
      const filler = new Card(cardDefinition(1), owner.id); owner.graveyard.push(filler);
      assert.equal((await game.moveCard(filler, owner, "field", {
        fromZone: "graveyard", position: "attack", summonOrigin: "effect_resolution", summonMethodOverride: "special",
      })).success, true);
    }
  };
  return { game, owner, opponent, source, copy, scout, dancer, enemy, effect, begin, cycleSource, fillField };
}

async function completeResponseSelections(game: ReturnType<typeof createRuntimeGame>, action: Promise<unknown>,
  source: Card, opponentTarget: Card): Promise<void> {
  let done = false, failure: unknown;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  const resolutions = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      for (const requirement of session.requirements) {
        const selectedCard = requirement.id === "natural_selection_cost" ? source
          : requirement.id === "natural_selection_target" ? opponentTarget : null;
        const candidates = selectedCard ? requirement.candidates.filter(candidate =>
          candidate.card === selectedCard || candidate.cardRef === selectedCard) : requirement.candidates;
        session.selections[requirement.id] = candidates.slice(0, requirement.min).map(candidate => candidate.key);
      }
      const resolution = game.finishTargetSelection(); resolutions.add(resolution);
      void resolution.then(() => resolutions.delete(resolution), error => { failure = error; resolutions.delete(resolution); });
    }
    if (done && !game.targetSelection && resolutions.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "the action must finish with its human decisions consumed");
  assert.equal(game.targetSelection, null); assert.equal(resolutions.size, 0);
  await completion; if (failure) throw failure;
}

const states = ["unchanged", "response_removed", "response_returned", "response_other_copy", "response_full",
  "position_returned", "position_other_copy", "position_full", "placement_returned"] as const;

for (const id of [353, 364] as const) for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) for (const state of states) {
    test(`S02 original source ${id}: ${state} (${seat}, ${controller}; labeled identity hooks)`, async t => {
      const { game, owner, source, copy, enemy, effect, begin, cycleSource, fillField } = setup(t, id, seat, controller);
      let changed = false, published = 0, summoned = 0;
      game.on("effect_activated", event => { if (event.card === source && event.effectId === effect.id) published++; });
      game.on("after_summon", event => { if (event.card === source || event.card === copy) summoned++; });
      // These hooks exercise revalidation boundaries, not additional legal card effects.
      game.chainSystem.offerChainResponses = async () => {
        if (!changed && state.startsWith("response_") && game.chainSystem.chainStack.some(link => link.card === source)) {
          changed = true;
          if (state === "response_full") await fillField();
          else await cycleSource(state === "response_returned");
        }
        return passes();
      };
      const choosePosition = game.effectEngine.chooseSpecialSummonPosition.bind(game.effectEngine);
      game.effectEngine.chooseSpecialSummonPosition = async (card, player, options) => {
        const result = await choosePosition(card, player, options);
        if (card === source && !changed && state.startsWith("position_")) {
          changed = true;
          if (state === "position_full") await fillField();
          else await cycleSource(state === "position_returned");
        }
        return result;
      };
      const preparePlacement = game.prepareFieldPlacement.bind(game);
      game.prepareFieldPlacement = async (card, player, row, options) => {
        const result = await preparePlacement(card, player, row, options);
        if (card === source && !changed && state === "placement_returned") {
          changed = true; await cycleSource(true);
        }
        return result;
      };
      const action = begin(); await completeTestSelections(game, action); await action;
      assert.equal(published, 1, "the hand effect was committed before the state change");
      assert.equal(changed, state !== "unchanged");
      assert.equal(owner.field.includes(source), state === "unchanged");
      assert.equal(owner.hand.includes(copy), true, "another copy cannot replace the published source");
      assert.equal(summoned, state === "unchanged" ? 1 : 0);
      assert.equal(game.canUseOncePerTurn(copy, owner, effect).ok, false, "committed hard OPT use remains consumed");
      assert.equal(enemy.position, id === 353 && state !== "unchanged" ? "attack" : "defense",
        "Jackal changes its target only after its original source successfully summons");
    });
  }
}

for (const seat of ["player", "bot"] as const) for (const id of [353, 364] as const) for (const controller of ["human", "ai"] as const) {
  for (const invalidSnapshot of ["missing", "stale_version", "wrong_instance", "wrong_controller", "wrong_zone"] as const) {
    test(`S02 self-summon fails closed for ${invalidSnapshot} ${id} (${seat}, ${controller})`, async t => {
      const { game, owner, opponent, source, effect } = setup(t, id, seat, controller);
      const snapshot = required(game.chainSystem.createPreparedActivation({ card: source, controller: owner,
        effect, activationZone: "hand", committed: true, costsPaid: true }).sourceAtActivation);
      if (invalidSnapshot === "stale_version") snapshot.locationVersion++;
      if (invalidSnapshot === "wrong_instance") snapshot.cardInstanceId = source.instanceId + 1;
      if (invalidSnapshot === "wrong_controller") snapshot.controllerId = opponent.id;
      if (invalidSnapshot === "wrong_zone") snapshot.zone = "graveyard";
      let positions = 0;
      const choosePosition = game.effectEngine.chooseSpecialSummonPosition.bind(game.effectEngine);
      game.effectEngine.chooseSpecialSummonPosition = async (...args) => { positions++; return choosePosition(...args); };
      const ctx = { player: owner, opponent, source, effect,
        activationContext: { sourceAtActivation: invalidSnapshot === "missing" ? null : snapshot } };
      const result = await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", requireSource: true,
        position: "choice", haltOnFailure: true }], ctx, {});
      assert.equal(result.success, false);
      assert.equal(positions, 0, "an invalid original source must not offer a resolution choice");
      assert.ok(owner.hand.includes(source)); assert.equal(owner.field.includes(source), false);
    });
  }

  test(`S02 original presence guard preserves existing cost continuation guard ${id} (${seat}, ${controller})`, async t => {
    const { game, owner, opponent, source, effect } = setup(t, id, seat, controller);
    const snapshot = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect, activationZone: "hand" }).sourceAtActivation;
    let costValid = true;
    const preparePlacement = game.prepareFieldPlacement.bind(game);
    game.prepareFieldPlacement = async (...args) => { const result = await preparePlacement(...args); costValid = false; return result; };
    const result = await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", requireSource: true,
      position: "choice", haltOnFailure: true }],
      { player: owner, opponent, source, effect, activationContext: { sourceAtActivation: snapshot }, validateCostPayment: () => costValid },
      {});
    assert.equal(result.success, false); assert.ok(owner.hand.includes(source)); assert.equal(owner.field.includes(source), false);
  });

  test(`S02 source controller is rechecked at movement commitment ${id} (${seat}, ${controller})`, async t => {
    const { game, owner, opponent, source, effect } = setup(t, id, seat, controller);
    const snapshot = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect, activationZone: "hand" }).sourceAtActivation;
    const preparePlacement = game.prepareFieldPlacement.bind(game);
    game.prepareFieldPlacement = async (...args) => {
      const result = await preparePlacement(...args);
      // Explicit snapshot-integrity hook: preserve version to exercise the composed callback.
      source.controller = opponent.id;
      return result;
    };
    const result = await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", requireSource: true,
      position: "choice", haltOnFailure: true }],
      { player: owner, opponent, source, effect, activationContext: { sourceAtActivation: snapshot } }, {});
    assert.equal(result.success, false); assert.ok(owner.hand.includes(source)); assert.equal(owner.field.includes(source), false);
    assert.equal(source.locationVersion, required(snapshot).locationVersion);
  });
}

for (const seat of ["player", "bot"] as const) test(`S02 opt-in guard preserves default Viper self-summon compatibility (${seat})`, async t => {
  const { game, owner, opponent } = setup(t, 353, seat, "ai");
  const viper = new Card(cardDefinition(356), owner.id), effect = required(viper.effects[0]);
  owner.hand.push(viper);
  const snapshot = game.chainSystem.createPreparedActivation({ card: viper, controller: owner, effect, activationZone: "hand" }).sourceAtActivation;
  await game.moveCard(viper, owner, "graveyard", { fromZone: "hand", awaitEvents: true });
  await game.moveCard(viper, owner, "hand", { fromZone: "graveyard", awaitEvents: true });
  const result = await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", requireSource: true,
    position: "attack", haltOnFailure: true }],
    { player: owner, opponent, source: viper, effect, activationContext: { sourceAtActivation: snapshot } }, {});
  assert.equal(effect.requiresSourceAtResolution, undefined, "Viper was not included in the director's opt-in decision");
  assert.equal(result.success, true); assert.ok(owner.field.includes(viper));
});

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  for (const policy of ["absent", "false"] as const) {
    test(`S02 opt-in guard preserves Viper's ${policy} policy during position choice (${seat}, ${controller})`, async t => {
      const { game, owner, opponent } = setup(t, 353, seat, controller);
      const viper = new Card(cardDefinition(356), owner.id);
      const originalEffect = required(viper.effects[0]);
      const effect = policy === "false" ? { ...originalEffect, requiresSourceAtResolution: false } : originalEffect;
      owner.hand.push(viper);
      const snapshot = game.chainSystem.createPreparedActivation({ card: viper, controller: owner, effect, activationZone: "hand" }).sourceAtActivation;
      let choices = 0;
      const choosePosition = game.effectEngine.chooseSpecialSummonPosition.bind(game.effectEngine);
      game.effectEngine.chooseSpecialSummonPosition = async (card, player, options) => {
        const position = await choosePosition(card, player, options);
        if (card === viper) {
          choices++;
          // Diagnostic identity hook: other effects do not opt into S02's presence rule.
          assert.ok(await game.moveCard(viper, owner, "graveyard", { fromZone: "hand", awaitEvents: true }));
          assert.ok(await game.moveCard(viper, owner, "hand", { fromZone: "graveyard", awaitEvents: true }));
        }
        return position;
      };
      const result = await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", requireSource: true,
        position: "choice", haltOnFailure: true }],
        { player: owner, opponent, source: viper, effect, activationContext: { sourceAtActivation: snapshot } }, {});
      assert.equal(result.success, true); assert.equal(choices, 1);
      assert.ok(owner.field.includes(viper)); assert.equal(viper.locationVersion, 3);
    });
  }
}

// The removal is a real discovered response card; only the return is a labeled hook.
for (const seat of ["player", "bot"] as const) for (const id of [353, 364] as const) for (const returns of [false, true]) {
  test(`S02 Natural Selection discards the published source ${id}; return hook=${returns} (${seat}, human)`, async t => {
    const { game, owner, opponent, source, copy, enemy, effect, begin } = setup(t, id, seat, "human");
    const natural = new Card(cardDefinition(21), owner.id), secondEnemy = new Card(cardDefinition(5), opponent.id);
    owner.hand.push(natural); placeFieldCards(opponent.field, secondEnemy);
    let responded = false, paid = false;
    game.ui.showChainResponseModal = async candidates => {
      if (responded || !game.chainSystem.chainStack.some(link => link.card === source)) return null;
      const response = candidates.find(candidate => candidate.card === natural);
      if (!response) return null;
      responded = true; return response;
    };
    game.on("card_moved", async event => {
      if (event.card === source && event.fromZone === "hand" && event.toZone === "graveyard" && event.contextLabel === "discard") {
        paid = true;
        if (returns) await game.moveCard(source, owner, "hand", { fromZone: "graveyard", awaitEvents: true });
      }
    });
    // Explicit human selections stay in the normal selection session and broker.
    const action = begin(); await completeResponseSelections(game, action, source, secondEnemy); await action;
    assert.ok(responded && paid, "Natural Selection really paid its discard during the response window");
    assert.ok(opponent.graveyard.includes(secondEnemy)); assert.ok(owner.graveyard.includes(natural));
    assert.equal(owner.field.includes(source), false); assert.equal(owner.field.includes(copy), false);
    assert.equal(owner.hand.includes(source), returns); assert.equal(owner.graveyard.includes(source), !returns);
    assert.equal(game.canUseOncePerTurn(copy, owner, effect).ok, false);
    assert.equal(enemy.position, id === 353 ? "attack" : "defense");
  });
}
