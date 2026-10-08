import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import Bot from "../../src/core/Bot.js";
import Player, { canUseNormalSummonForCard } from "../../src/core/Player.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { simulateMainPhaseAction } from "../../src/core/ai/dragon/simulation.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationState } from "../helpers/simulation.js";

const make = (id: number | string, owner: "bot" | "player") =>
  createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), owner));

for (const actor of ["bot", "player"] as const) {
  const other = actor === "bot" ? "player" : "bot";

  test(`Dragon generation retains a legal granted Normal Summon after its first use (${actor})`, () => {
    const source = make(256, actor);
    const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
      bot: { id: actor, hand: [source], summonCount: 1, additionalNormalSummons: 1 }, player: { id: other } });
    assert.equal(canUseNormalSummonForCard(state.bot, source), true);
    const ai = new DragonStrategy(new Player(actor, "Actor"));
    assert.ok(ai.generateMainPhaseActions(state).some(action => action.type === "summon" && action.cardId === source.id));
  });

  test(`Dragon Normal Summon retains the physical instance, matching execution (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose());
    game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
    const live = new Card(cardDefinition(256), actor);
    game[actor].hand.push(live);
    const result = await game.performNormalSummon(game[actor], 0);
    assert.equal(result?.success, true);
    assert.equal(game[actor].field[0], live);

    const source = make(256, actor);
    const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
      bot: { id: actor, hand: [source] }, player: { id: other } });
    simulateMainPhaseAction(state, { type: "summon", index: 0, cardId: source.id });
    assert.equal(state.bot.field[0], source);
    assert.equal(state.bot.hand.length, 0);
    assert.equal(state.bot.summonCount, game[actor].summonCount);
  });

  test(`Dragon Peak cannot recover a non-Dragon monster, matching its runtime action (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false });
    t.after(() => game.dispose());
    const liveSource = new Card(cardDefinition(262), actor), liveCandidate = new Card(cardDefinition(302), actor);
    game[actor].fieldSpell = liveSource; game[actor].graveyard.push(liveCandidate);
    const effect = required(liveSource.effects?.find(entry => entry.timing === "on_play"));
    await game.effectEngine.applyActions(effect.actions || [],
      { source: liveSource, player: game[actor], opponent: game[other], effect }, {});
    assert.equal(game[actor].hand.length, 0);

    const source = make(262, actor), candidate = make(302, actor);
    const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
      bot: { id: actor, hand: [source], graveyard: [candidate] }, player: { id: other } });
    simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: source.id });
    assert.equal(state.bot.hand.length, game[actor].hand.length);
    assert.ok(state.bot.graveyard.includes(candidate));
  });

  for (const renamed of [false, true]) {
    test(`Dragon hand Spell executes its declared action independent of display name (renamed=${renamed}, ${actor})`, () => {
      const setup = () => {
        const source = make(261, actor), host = make(260, actor), target = make(262, other);
        if (renamed) source.name = "A future Spell with the same declared action";
        return { source, target, state: simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
          bot: { id: actor, hand: [source], field: [host] }, player: { id: other, fieldSpell: target } }) };
      };
      const projected = setup(), canonical = setup();
      const actionFor = (entry: ReturnType<typeof setup>) => ({ type: "spell" as const, index: 0, cardId: entry.source.id,
        activationContext: { decisions: { selections: { destroy_targets: [required(entry.target.instanceId)] } } } });
      applyGenericSimulatedMainPhaseAction(canonical.state, actionFor(canonical));
      assert.equal(canonical.state.player.fieldSpell, null);
      simulateMainPhaseAction(projected.state, actionFor(projected));
      assert.equal(projected.state.player.fieldSpell, canonical.state.player.fieldSpell);
      assert.equal(projected.state.player.graveyard.length, 1);
      assert.equal(projected.state.bot.graveyard[0], projected.source);
    });
  }
}

function runtimeIdentityScenario(t: TestContext, actor: "bot" | "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
  const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> });
  owner.id = actor;
  game[actor] = owner;
  game.turn = actor; game.phase = "main1"; game.turnCounter = 3; game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "ai";
  const executionGame = unsafeFixture<BotGamePort>(game,
    "The concrete Game provides Bot execution capabilities; its public EffectEngine projection is narrower than BotGamePort.");
  owner.game = executionGame;
  game.waitForBoardPresentation = async () => {};
  t.after(() => game.dispose("architecture_dragon_identity"));
  return { game, executionGame, owner };
}

for (const actor of ["bot", "player"] as const) {
  for (const binding of ["missing", "expired", "copied"] as const) {
    test(`Bot Normal Summon revalidation and execution honor a ${binding} physical binding (${actor})`, async t => {
      const { executionGame, owner } = runtimeIdentityScenario(t, actor);
      const present = new Card(cardDefinition(256), actor);
      owner.hand.push(present);
      const planned = binding === "missing" ? new Card(cardDefinition(256), actor)
        : createPlanningCopy().cloneCardForSim(present);
      if (binding === "expired") present.locationVersion += 2;
      const action: AIAction = { type: "summon", card: planned, cardId: present.id, index: 0, position: "attack" };
      const valid = owner.filterValidActionsForCurrentState([action], executionGame);
      const executed = await owner.executeMainPhaseAction(executionGame, action);
      const shouldExecute = binding === "copied";
      assert.equal(executed, shouldExecute, "a cloned projection of the same current presence is legal; another copy/presence is not");
      assert.equal(valid.length, shouldExecute ? 1 : 0);
      assert.equal(shouldExecute ? owner.field[0] : owner.hand[0], present);
      assert.equal(owner.summonCount, shouldExecute ? 1 : 0);
    });
  }

  for (const binding of ["missing", "expired", "copied"] as const) {
    test(`Bot Ascension revalidation and execution honor a ${binding} physical material (${actor})`, async t => {
      const { executionGame, owner } = runtimeIdentityScenario(t, actor);
      const present = new Card(cardDefinition(252), actor), ascension = new Card(cardDefinition(253), actor);
      present.summonedTurn = 0;
      placeFieldCards(owner.field, present);
      owner.extraDeck.push(ascension);
      const planned = binding === "missing" ? new Card(cardDefinition(252), actor)
        : createPlanningCopy().cloneCardForSim(present);
      if (binding === "expired") present.locationVersion += 2;
      const action: AIAction = { type: "ascension", ascensionCard: ascension, material: planned,
        materialId: planned.id, materialIndex: 0, position: "attack" };
      const valid = owner.filterValidActionsForCurrentState([action], executionGame);
      const executed = await owner.executeMainPhaseAction(executionGame, action);
      const shouldExecute = binding === "copied";
      assert.equal(executed, shouldExecute);
      assert.equal(valid.length, shouldExecute ? 1 : 0);
      if (shouldExecute) {
        assert.equal(owner.field[0], ascension);
        assert.equal(owner.graveyard[0], present);
        assert.deepEqual(owner.extraDeck, []);
      } else {
        assert.equal(owner.field[0], present);
        assert.equal(owner.extraDeck[0], ascension);
        assert.deepEqual(owner.graveyard, []);
      }
    });
  }

  for (const binding of ["missing", "expired", "current"] as const) {
    test(`Bot contact Fusion validates explicit ${binding} material hints without substitution (${actor})`, async t => {
      const { executionGame, owner } = runtimeIdentityScenario(t, actor);
      const material = new Card(cardDefinition("Miragebound Glass Viper"), actor);
      const second = new Card(cardDefinition("Miragebound Sand Priestess"), actor);
      const fusion = new Card(cardDefinition(363), actor);
      placeFieldCards(owner.field, material, second);
      owner.extraDeck.push(fusion);
      const requested = binding === "missing" ? new Card(cardDefinition(required(material.id)), actor).instanceId
        : binding === "expired" ? "previous-field-presence" : material.instanceId;
      const action: AIAction = { type: "extraDeckProcedure", extraDeckCard: fusion,
        cardId: fusion.id, extraDeckIndex: 0, requiredMaterialCount: 2,
        materials: [{ index: 0, id: material.id, instanceIds: [requested] },
          { index: 1, id: second.id, instanceIds: [second.instanceId] }], position: "attack" };
      const valid = owner.filterValidActionsForCurrentState([action], executionGame);
      const executed = await owner.executeMainPhaseAction(executionGame, action);
      const shouldExecute = binding === "current";
      assert.equal(executed, shouldExecute);
      assert.equal(valid.length, shouldExecute ? 1 : 0);
      if (shouldExecute) {
        assert.equal(owner.field[0], fusion);
        assert.ok(owner.graveyard.includes(material));
        assert.ok(owner.graveyard.includes(second));
      } else {
        assert.equal(owner.field[0], material);
        assert.equal(owner.field[1], second);
        assert.equal(owner.extraDeck[0], fusion);
        assert.deepEqual(owner.graveyard, []);
      }
    });
  }
}

// Migration controls: a physical source/material is a binding, not a hint that
// may be replaced with another copy sharing the database ID or display name.
for (const actor of ["bot", "player"] as const) {
  const other = actor === "bot" ? "player" : "bot";
  for (const executor of ["common", "dragon"] as const) {
    const apply = (state: ReturnType<typeof simulationState>, action: AIAction): void => {
      if (executor === "common") applyGenericSimulatedMainPhaseAction(state, action);
      else simulateMainPhaseAction(state, action);
    };

    test(`a missing explicit hand source cannot summon its sibling (${executor}, ${actor})`, () => {
      const absent = make(256, actor), sibling = make(256, actor);
      assert.notEqual(absent.instanceId, sibling.instanceId);
      const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
        bot: { id: actor, hand: [sibling] }, player: { id: other } });
      const action: AIAction = { type: "summon", index: 0, cardId: absent.id, card: absent };
      apply(state, action);
      assert.deepEqual(state.bot.field, []);
      assert.equal(state.bot.hand[0], sibling);
      assert.equal(state.bot.summonCount, 0);
    });

    test(`an explicit hand source from an expired presence cannot summon (${executor}, ${actor})`, () => {
      const returned = make(256, actor);
      returned.locationVersion = 2;
      const plannedPresence = { ...returned, locationVersion: 0 };
      const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
        bot: { id: actor, hand: [returned] }, player: { id: other } });
      const action: AIAction = { type: "summon", index: 0, cardId: returned.id, card: plannedPresence };
      apply(state, action);
      assert.deepEqual(state.bot.field, []);
      assert.equal(state.bot.hand[0], returned);
    });

    test(`Ascension cannot substitute a missing explicit material with its sibling (${executor}, ${actor})`, () => {
      const absent = make(252, actor), sibling = make(252, actor), ascension = make(253, actor);
      const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
        bot: { id: actor, field: [sibling], extraDeck: [ascension] }, player: { id: other } });
      const action: AIAction = { type: "ascension", ascensionCard: ascension,
        material: absent, materialIndex: 0, materialId: absent.id };
      apply(state, action);
      assert.equal(state.bot.field[0], sibling);
      assert.equal(state.bot.extraDeck[0], ascension);
      assert.deepEqual(state.bot.graveyard, []);
    });

    test(`Ascension cannot summon an absent explicit Extra Deck copy (${executor}, ${actor})`, () => {
      const material = make(252, actor), absent = make(253, actor), sibling = make(253, actor);
      const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
        bot: { id: actor, field: [material], extraDeck: [sibling] }, player: { id: other } });
      const action: AIAction = { type: "ascension", ascensionCard: absent,
        material, materialIndex: 0, materialId: material.id };
      apply(state, action);
      assert.equal(state.bot.field[0], material);
      assert.equal(state.bot.extraDeck[0], sibling);
      assert.deepEqual(state.bot.graveyard, []);
    });
  }

  for (const missing of ["instance", "presence"] as const) {
    test(`the common procedure cannot replace an explicit missing ${missing} material with an ID/index fallback (${actor})`, () => {
      const material = make("Miragebound Glass Viper", actor), secondMaterial = make("Miragebound Sand Priestess", actor), fusion = make(363, actor);
      material.fieldPresenceId = "returned-presence";
      const requested = missing === "instance" ? "absent-instance" : "previous-presence";
      const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
        bot: { id: actor, field: [material, secondMaterial], extraDeck: [fusion] }, player: { id: other } });
      const action: AIAction = { type: "extraDeckProcedure", extraDeckCard: fusion,
        cardId: fusion.id, extraDeckIndex: 0, requiredMaterialCount: 2,
        materials: [{ index: 0, id: material.id, instanceIds: [requested] },
          { index: 1, id: secondMaterial.id, instanceIds: [required(secondMaterial.instanceId)] }] };
      applyGenericSimulatedMainPhaseAction(state, action);
      assert.equal(state.bot.field[0], material);
      assert.equal(state.bot.extraDeck[0], fusion);
      assert.deepEqual(state.bot.graveyard, []);
    });
  }

  test(`the procedure controls use a legal Fusion pair when every physical hint is present (${actor})`, () => {
    const first = make("Miragebound Glass Viper", actor), second = make("Miragebound Sand Priestess", actor), fusion = make(363, actor);
    const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
      bot: { id: actor, field: [first, second], extraDeck: [fusion] }, player: { id: other } });
    applyGenericSimulatedMainPhaseAction(state, { type: "extraDeckProcedure", extraDeckCard: fusion,
      cardId: fusion.id, extraDeckIndex: 0, requiredMaterialCount: 2,
      materials: [first, second].map((card, index) => ({ index, id: card.id,
        instanceIds: [required(card.instanceId)] })) });
    assert.equal(state.bot.field[0]?.id, fusion.id);
    assert.equal(state.bot.extraDeck.length, 0);
    assert.ok(state.bot.graveyard.includes(first));
    assert.ok(state.bot.graveyard.includes(second));
  });
}
