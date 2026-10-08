import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { selectAutomaticAscensionAction } from "../../src/core/bot/ascensionController.js";
import { getGenericAscensionActions } from "../../src/core/ai/common/ascensionPlanning.js";
import { getGenericHandSummonProcedureActions } from "../../src/core/ai/common/actionGeneration.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { captureEventCardPresence, matchesEventCardPresence } from "../../src/core/game/zones/ownership.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "bot" | "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
  t.after(() => game.dispose("architecture_planning_presence"));
  const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> });
  owner.id = actor;
  game[actor] = owner;
  const executionGame = unsafeFixture<BotGamePort>(game,
    "Concrete Game provides all Bot methods; its public EffectEngine projection is narrower than BotGamePort.");
  owner.game = executionGame;
  game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForAiPresentationStep = async () => {};
  const opponent = game[actor === "bot" ? "player" : "bot"];
  opponent.controllerType = "ai";
  owner.lp = 2500; // The unchanged Dragon policy accepts Metal Armored as a defensive wall.
  return { game, executionGame, owner, opponent };
}

function setupAscension(context: ReturnType<typeof scenario>, lateId = false) {
  const { game, owner } = context;
  const material = required(game.createCardForOwner(252, owner));
  material.summonedTurn = 0;
  placeFieldCards(owner.field, material);
  const source = lateId ? new Card(cardDefinition(253), owner.id)
    : required(game.createCardForOwner(253, owner));
  owner.extraDeck.push(source);
  return { material, source };
}

async function channels(context: ReturnType<typeof scenario>, action: AIAction, incomingId: number) {
  const { game, executionGame, owner } = context;
  const validation = owner.filterValidActionsForCurrentState([action], executionGame).length;
  const { state } = createGameTreeCopy(game, owner);
  applyGenericSimulatedMainPhaseAction(state, action);
  const simulated = state.bot.field.some(card => card.id === incomingId);
  const executed = await owner.executeMainPhaseAction(executionGame, action);
  return { validation, simulated, executed };
}

for (const actor of ["bot", "player"] as const) {
  test(`a generated mutable hand-procedure source cannot survive leaving and returning to hand (${actor})`, async t => {
    const context = scenario(t, actor);
    const { game, executionGame, owner } = context;
    const source = required(game.createCardForOwner(251, owner));
    owner.hand.push(source);
    const action = required(owner.generateMainPhaseActions(executionGame).find(entry => entry.type === "handSummonProcedure"));
    assert.equal(action.card, source, "this producer already binds the physical source");
    const before = captureEventCardPresence(source, actor, "hand");
    await game.moveCard(source, owner, "banished", { fromZone: "hand" });
    await game.moveCard(source, owner, "hand", { fromZone: "banished" });
    assert.ok(owner.hand.includes(source));
    assert.equal(action.card, source, "the original command's reference mutates with the source");
    assert.ok(source.locationVersion > before.locationVersion);
    assert.equal(matchesEventCardPresence(source, before, actor, "hand"), false);
    assert.deepEqual(await channels(context, action, 251), { validation: 0, simulated: false, executed: false });
    assert.deepEqual(owner.hand, [source]);
  });

  for (const producer of ["live", "projection"] as const) {
    test(`the ${producer} hand-procedure producer accepts the same current physical source (${actor})`, async t => {
      const context = scenario(t, actor);
      const { game, executionGame, owner } = context;
      const source = required(game.createCardForOwner(251, owner));
      owner.hand.push(source);
      const { state } = createGameTreeCopy(game, owner);
      const action = required((producer === "live" ? owner.generateMainPhaseActions(executionGame)
        : getGenericHandSummonProcedureActions(state)).find(entry => entry.type === "handSummonProcedure"));
      assert.equal(action.card?.instanceId, source.instanceId);
      assert.equal(action.card?.locationVersion, source.locationVersion);
      if (producer === "projection") assert.notEqual(action.card, source);
      assert.deepEqual(await channels(context, action, 251), { validation: 1, simulated: true, executed: true });
      assert.equal(owner.field[0], source);
    });
  }

  test(`a generated mutable Ascension Extra Deck source cannot survive leaving and returning (${actor})`, async t => {
    const context = scenario(t, actor);
    const { game, executionGame, owner } = context;
    const { source } = setupAscension(context);
    const action = required(selectAutomaticAscensionAction(owner, executionGame));
    assert.equal(action.ascensionCard, source);
    t.diagnostic(`Ascension material presence binding published: ${action.material !== undefined}`);
    const before = captureEventCardPresence(source, actor, "extraDeck");
    await game.moveCard(source, owner, "banished", { fromZone: "extraDeck" });
    await game.moveCard(source, owner, "extraDeck", { fromZone: "banished" });
    assert.ok(owner.extraDeck.includes(source));
    assert.equal(action.ascensionCard, source);
    assert.ok(source.locationVersion > before.locationVersion);
    assert.equal(matchesEventCardPresence(source, before, actor, "extraDeck"), false);
    assert.deepEqual(await channels(context, action, 253), { validation: 0, simulated: false, executed: false });
    assert.deepEqual(owner.extraDeck, [source]);
  });

  for (const producer of ["live", "projection"] as const) {
    test(`the ${producer} Ascension producer accepts a current Extra Deck projection (${actor})`, async t => {
      const context = scenario(t, actor);
      const { game, executionGame, owner } = context;
      const { source } = setupAscension(context);
      const { state } = createGameTreeCopy(game, owner);
      const action = producer === "live" ? required(selectAutomaticAscensionAction(owner, executionGame))
        : required(getGenericAscensionActions({ bot: state.bot, opponent: state.player, isSimulatedState: true }, {
          getSimulatedAscensionCandidates: () => state.bot.extraDeck,
          chooseAscensionPosition: () => "defense",
        })[0]);
      assert.equal(action.ascensionCard?.instanceId, source.instanceId);
      if (producer === "projection") assert.notEqual(action.ascensionCard, source);
      assert.deepEqual(await channels(context, action, 253), { validation: 1, simulated: true, executed: true });
      assert.equal(owner.field[0], source);
    });
  }

  test(`hand-procedure material hints cannot revive their old field presence after generation (${actor})`, async t => {
    const context = scenario(t, actor);
    const { game, executionGame, owner, opponent } = context;
    const source = required(game.createCardForOwner(358, owner));
    const material = required(game.createCardForOwner(351, owner));
    owner.hand.push(source);
    placeFieldCards(owner.field, material);
    const action = required(owner.generateMainPhaseActions(executionGame).find(entry =>
      entry.type === "handSummonProcedure" && entry.cardId === 358));
    assert.equal(action.type, "handSummonProcedure");
    const hint = required(action.materials[0]);
    assert.equal(hint.instanceId, material.instanceId, "the hint already binds a particular cost instance");
    const before = captureEventCardPresence(material, actor, "field");
    await game.moveCard(material, owner, "banished", { fromZone: "field" });
    await game.effectEngine.applyActions([
      { type: "special_summon_from_zone", zone: "banished", count: 1, position: "attack" },
    ], { player: game[actor], opponent }, {});
    assert.ok(owner.field.includes(material), "the real effect flow re-establishes the same physical cost card");
    assert.equal(game.canSummonFromHandByProcedure(source, owner).ok, true,
      "a newly generated procedure remains legal; only the old material presence has expired");
    assert.equal(hint.instanceId, material.instanceId);
    assert.ok(material.locationVersion > before.locationVersion);
    assert.equal(matchesEventCardPresence(material, before, actor, "field"), false);
    assert.deepEqual(await channels(context, action, 358), { validation: 0, simulated: false, executed: false });
  });

  for (const family of ["handProcedure", "ascension"] as const) {
    test(`assigning duelCardId without movement preserves a generated ${family} command (${actor})`, async t => {
      const context = scenario(t, actor);
      const { game, executionGame, owner } = context;
      const source = family === "handProcedure" ? new Card(cardDefinition(251), actor)
        : setupAscension(context, true).source;
      assert.equal(source.duelCardId, undefined, "direct Card construction defers the Game-owned ID assignment");
      if (family === "handProcedure") owner.hand.push(source);
      const action = family === "handProcedure"
        ? required(owner.generateMainPhaseActions(executionGame).find(entry => entry.type === "handSummonProcedure"))
        : required(selectAutomaticAscensionAction(owner, executionGame));
      const zone = family === "handProcedure" ? "hand" : "extraDeck";
      const before = captureEventCardPresence(source, actor, zone);
      game.ensureDuelCardId(source);
      const after = captureEventCardPresence(source, actor, zone);
      assert.equal(after.instanceId, before.instanceId);
      assert.equal(after.locationVersion, before.locationVersion);
      assert.equal(after.zone, before.zone);
      assert.equal(after.faceUp, before.faceUp);
      assert.equal(matchesEventCardPresence(source, before, actor, zone), before.duelCardId !== null,
        "the canonical matcher remains strict; preparation must establish a stable ID before binding");
      t.diagnostic(`duelCardId at generation: ${before.duelCardId ?? "absent; assigned later without movement"}`);
      assert.deepEqual(await channels(context, action, family === "handProcedure" ? 251 : 253),
        { validation: 1, simulated: true, executed: true });
    });
  }
}
