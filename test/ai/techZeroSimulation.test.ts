import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { applyGenericSimulatedMainPhaseAction, attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { AiLiveGamePort, AiPlayerInput } from "../../src/core/contracts/aiState.js";
import type { AIAction, SynchroAIAction } from "../../src/core/contracts/ai.js";
import type { SimulatedActionOptions } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { SelectionResult } from "../../src/core/contracts/selection.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, record, selectionKey, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "player" | "bot") {
  const first = new Bot("techzero");
  first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime and clone interface");
  t.after(() => game.dispose("tech_zero_simulation_test"));
  game.turn = actor;
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
  const bot = actor === "player" ? first : second;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game satisfies the attached Bot runtime and snapshot boundaries");
  first.game = botGame;
  const make = (id: number) => new Card(cardDefinition(id), bot.id);
  return { game, bot, botGame, make };
}

function board(player: AiPlayerInput) {
  return {
    field: player.field?.map(card => ({ id: card.id, level: card.level, negated: !!card.effectsNegated,
      position: card.position })).sort((a, b) => (a.id || 0) - (b.id || 0)),
    graveyard: player.graveyard?.map(card => card.id).sort(),
    extraDeck: player.extraDeck?.map(card => card.id).sort(),
    banished: player.banished?.map(card => card.id).sort(),
    handCount: player.hand?.length,
    deckCount: player.deck?.length,
    normals: player.summonCount,
  };
}

function movement(event: string, payload: object): string | null {
  if (event !== "card_moved") return null;
  const entry = record(payload);
  return `${record(entry.card).id}:${entry.fromZone}->${entry.toZone}`;
}

for (const actor of ["player", "bot"] as const) {
  test(`Synchro simulation matches real material moves, draw and negated revival (${actor})`, async t => {
    const { game, bot, botGame, make } = scenario(t, actor);
    const core = make(501);
    const catapult = make(502);
    catapult.level = 2;
    const multimodal = make(503);
    placeFieldCards(bot.field, core, catapult);
    bot.extraDeck.push(multimodal);
    bot.deck.push(make(518), make(520));
    const state = bot.cloneGameState(botGame);
    const action: SynchroAIAction = {
      type: "synchro", synchroInstanceId: multimodal.instanceId,
      materialInstanceIds: [core.instanceId, catapult.instanceId], position: "attack",
    };
    const realMoves: string[] = [], realEvents: string[] = [];
    for (const event of ["card_to_grave", "card_moved", "after_summon"] as const) {
      game.on(event, payload => {
        realEvents.push(`${event}:${record(record(payload).card).id}`);
        const move = movement(event, payload); if (move) realMoves.push(move);
      });
    }
    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    const simulatedMoves: string[] = [], simulatedEvents: string[] = [];
    applyGenericSimulatedMainPhaseAction(state, action, {
      enableSimulatedEvents: true,
      onSimulatedEvent(event: string, payload: object) {
        if (["card_to_grave", "card_moved", "after_summon"].includes(event)) simulatedEvents.push(`${event}:${record(record(payload).card).id}`);
        const move = movement(event, payload); if (move) simulatedMoves.push(move);
      },
    });
    assert.deepEqual(board(state.bot), board(bot));
    assert.deepEqual(simulatedMoves, realMoves);
    assert.deepEqual(simulatedEvents, realEvents);
    assert.equal(required(state.bot.field.find(card => card.id === 501)).effectsNegated, true);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`explicit and effect Synchros preserve the same material choice (${actor})`, t => {
    const { bot, botGame, make } = scenario(t, actor);
    const multimodal = make(503);
    const phoenix = make(514);
    const lancer = make(516);
    placeFieldCards(bot.field, multimodal, phoenix);
    bot.extraDeck.push(lancer);
    bot.deck.push(make(518));
    const direct = bot.cloneGameState(botGame);
    const effect = bot.cloneGameState(botGame);
    const choice: SynchroAIAction = {
      type: "synchro", synchroInstanceId: lancer.instanceId,
      materialInstanceIds: [multimodal.instanceId, phoenix.instanceId], position: "defense",
    };
    const directEvents: string[] = [], effectEvents: string[] = [];
    applyGenericSimulatedMainPhaseAction(direct, choice, { enableSimulatedEvents: true,
      onSimulatedEvent: (event, payload) => { directEvents.push(`${event}:${record(record(payload).card).id}`); } });
    applySimulatedActions({
      state: effect, actions: [{ type: "synchro_summon_from_extra_deck", position: "defense" }],
      options: attachSimulatedEventEmitter(effect, { enableSimulatedEvents: true, chooseSynchroMaterials: () => choice,
        onSimulatedEvent: (event, payload) => { effectEvents.push(`${event}:${record(record(payload).card).id}`); } }),
    });
    assert.deepEqual(board(effect.bot), board(direct.bot));
    assert.deepEqual(effectEvents, directEvents);
    assert.equal(required(direct.bot.field[0]).id, 516);
  });
}

for (const actor of ["player", "bot"] as const) {
  test(`TZ-01 agrees with the real game after every action and replans after each draw (${actor})`, async t => {
    const { game, bot, botGame, make } = scenario(t, actor);
    const core = make(501), catapult = make(502), multimodal = make(503), portal = make(509);
    bot.hand.push(catapult, core);
    bot.extraDeck.push(multimodal, portal);
    bot.deck.push(make(518), make(520));
    const fallback = game.autoSelector.select.bind(game.autoSelector);
    game.autoSelector.select = (contract, context) => {
      assert.ok(contract && "requirements" in contract && Array.isArray(contract.requirements));
      const result = fallback(contract, context);
      assert.ok(result.ok);
      const selections: SelectionResult = { ...result.selections };
      for (const requirement of contract.requirements) {
        const id = required(requirement.id);
        const candidates = requirement.candidates || [];
        const chosen = id === "action_case_choice"
          ? candidates.find(candidate => candidate.key?.endsWith(":decrease")) ??
            candidates.find(candidate => candidate.key?.endsWith(":decrease_2"))
          : id === "tech_zero_energy_core_level_target" ? candidates.find(candidate => candidate.cardRef === catapult)
          : id === "tech_zero_multimodal_machine_level_target" ? candidates.find(candidate => candidate.cardRef === multimodal)
          : id === "tech_zero_electrocatapult_summon_target" || id === "tech_zero_electrocatapult_tuner_target"
            ? candidates.find(candidate => candidate.cardRef === core) : null;
        if (chosen) selections[id] = [selectionKey(required(chosen.key))];
      }
      return { ok: true, selections };
    };
    let state = bot.cloneGameState(botGame);
    const simulatedMoves: string[] = [], realMoves: string[] = [];
    game.on("card_moved", payload => { const move = movement("card_moved", payload); if (move) realMoves.push(move); });
    const options: SimulatedActionOptions = {
      enableSimulatedEvents: true,
      chooseActionCase: cases => cases.find(entry => record(entry).id === "decrease") || cases.find(entry => record(entry).id === "decrease_2") || cases[0],
      targetPreferences: {
        tech_zero_energy_core_level_target: { preferredInstanceIds: [catapult.instanceId] },
        tech_zero_multimodal_machine_level_target: { preferredInstanceIds: [multimodal.instanceId] },
        tech_zero_electrocatapult_summon_target: { preferredInstanceIds: [core.instanceId] },
        tech_zero_electrocatapult_tuner_target: { preferredInstanceIds: [core.instanceId] },
      },
      chooseSpecialSummonCards: (candidates, {action}) => action.distinctNames
        ? [503, 502, 501].flatMap(id => candidates.filter(card => card.id === id)) : candidates,
      onSimulatedEvent(event, payload) { const move = movement(event, payload); if (move) simulatedMoves.push(move); },
    };
    const actions: AIAction[] = [
      { type: "summon", index: 0, cardId: 502, position: "attack" },
      { type: "synchro", synchroInstanceId: multimodal.instanceId, materialInstanceIds: [core.instanceId, catapult.instanceId], position: "attack" },
      { type: "monsterEffect", cardId: 503, effectId: "tech_zero_multimodal_machine_level_mod" },
      { type: "synchro", synchroInstanceId: portal.instanceId, materialInstanceIds: [core.instanceId, multimodal.instanceId], position: "attack" },
    ];
    for (const action of actions) {
      realMoves.length = 0;
      simulatedMoves.length = 0;
      const success = action.type === "summon"
        ? (await game.performNormalSummon(bot, 0))?.success
        : action.type === "monsterEffect"
          ? (await game.tryActivateMonsterEffect(multimodal, null, "field", bot, { effectId: "tech_zero_multimodal_machine_level_mod" })).success
          : await bot.executeMainPhaseAction(botGame, action);
      assert.equal(success, true, action.type);
      applyGenericSimulatedMainPhaseAction(state, action, options);
      assert.deepEqual(board(state.bot), board(bot), action.type);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      if (action.type === "synchro") {
        assert.deepEqual(simulatedMoves, realMoves, "material and revival movement order");
        assert.equal(state._simRequiresReplan, true);
        state = bot.cloneGameState(botGame);
        assert.ok(state.bot.hand.every(card => !card._simUnknownDraw), "new snapshot sees the actual drawn cards");
      }
    }
    assert.deepEqual(new Set(state.bot.field.map(card => card.id)), new Set([509, 503, 502, 501]));
    assert.equal(state.bot.hand.length, 2);
    assert.equal(state.bot.summonCount, 1);
    assert.equal(state.bot.specialSummonRestrictions?.length, 1);
  });
}

for (const actor of ["player", "bot"] as const) {
  for (const count of [0, 1, 2, 3]) {
    test(`Portal resolves ${count} distinct revivals and applies its restriction (${actor})`, t => {
      const { bot, botGame, make } = scenario(t, actor);
      const portal = make(509), multimodal = make(503);
      multimodal.properSummonEstablished = true;
      placeFieldCards(bot.field, portal);
      bot.graveyard.push(multimodal, make(502), make(502), make(501));
      const state = bot.cloneGameState(botGame);
      const order: number[] = [];
      const options = attachSimulatedEventEmitter(state, {
        enableSimulatedEvents: true,
        shouldActivateEffect: ({effect}) => effect.id === "tech_zero_summoning_portal_synchro_revive",
        chooseSpecialSummonCards: candidates => [503, 502, 501].flatMap(id => candidates.filter(card => card.id === id).slice(0, 1)).slice(0, count),
        onSimulatedEvent(event, payload) {
          if (event === "after_summon") order.push(Number(record(record(payload).card).id));
        },
      });
      options.emitSimulatedEvent?.("after_summon", { card: state.bot.field[0], player: state.bot, method: "synchro", fromZone: "extraDeck" });
      assert.equal(state.bot.field.length, 1 + count);
      assert.deepEqual(order.slice(1), [503, 502, 501].slice(0, count));
      assert.equal(new Set(state.bot.field.map(card => card.name)).size, state.bot.field.length);
      assert.equal(state.bot.specialSummonRestrictions?.length, 1);
      const raptorActions = required(make(505).effects.find(effect => effect.id === "tech_zero_iron_raptor_synchro_tokens")).actions;
      applySimulatedActions({ state, actions: raptorActions, options });
      assert.equal(state.bot.field.some(card => card.isToken), false, "Portal restriction excludes unarchetyped tokens");
    });
  }

  test(`Portal can decline before usage, and repeated names never occupy two revival slots (${actor})`, t => {
    const { bot, botGame, make } = scenario(t, actor);
    placeFieldCards(bot.field, make(509));
    bot.graveyard.push(make(502), make(502), make(501));
    const state = bot.cloneGameState(botGame);
    const decline = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, shouldActivateEffect: () => false });
    const event = { card: state.bot.field[0], player: state.bot, method: "synchro", fromZone: "extraDeck" };
    decline.emitSimulatedEvent?.("after_summon", event);
    assert.equal(state.bot.field.length, 1);
    assert.equal(state.bot.specialSummonRestrictions?.length || 0, 0);
    const accept = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      shouldActivateEffect: ({effect}) => effect.id === "tech_zero_summoning_portal_synchro_revive" });
    accept.emitSimulatedEvent?.("after_summon", event);
    assert.equal(state.bot.field.length, 3);
    assert.equal(state.bot.field.filter(card => card.id === 502).length, 1);
    assert.equal(state.bot.specialSummonRestrictions?.length, 1);
  });

  test(`Portal rechecks free slots after each revival trigger (${actor})`, t => {
    const { bot, botGame, make } = scenario(t, actor);
    const multimodal = make(503); multimodal.properSummonEstablished = true;
    placeFieldCards(bot.field, make(509), make(508));
    bot.graveyard.push(make(501), make(502), multimodal);
    bot.hand.push(make(505));
    const state = bot.cloneGameState(botGame);
    const sizes: number[] = [];
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      shouldActivateEffect: ({effect}) => effect.id !== "tech_zero_energy_core_level_mod",
      chooseSpecialSummonCards: candidates => [501, 502, 503].flatMap(id => candidates.filter(card => card.id === id)),
      onSimulatedEvent(event) { if (event === "after_summon") sizes.push(state.bot.field.length); },
    });
    options.emitSimulatedEvent?.("after_summon", { card: state.bot.field[0], player: state.bot, method: "synchro", fromZone: "extraDeck" });
    assert.deepEqual(sizes, [2, 3, 4, 5]);
    assert.ok(state.bot.graveyard.some(card => card.id === 503));
    assert.equal(state.bot.hand.length, 0);
  });

  test(`Slasher protects only its direct Synchro result (${actor})`, t => {
    const { bot, botGame, make } = scenario(t, actor);
    const slasher = make(510), firstM = make(503), secondM = make(503), phoenix = make(514), lancer = make(516);
    placeFieldCards(bot.field, slasher, firstM, secondM);
    bot.extraDeck.push(phoenix, lancer);
    const state = bot.cloneGameState(botGame);
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: phoenix.instanceId,
      materialInstanceIds: [firstM.instanceId, slasher.instanceId], position: "attack" }, { enableSimulatedEvents: true });
    const result = required(state.bot.field.find(card => card.id === 514));
    assert.deepEqual(result.protectionEffects?.map(protection => protection.type), ["battle_destruction", "effect_destruction"]);
    assert.ok(result.protectionEffects?.every(protection => protection.expiresOnTurn === 3));
    assert.equal(state.bot.field.find(card => card.instanceId === secondM.instanceId)?.protectionEffects?.length || 0, 0);
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: lancer.instanceId,
      materialInstanceIds: [secondM.instanceId, phoenix.instanceId], position: "attack" }, { enableSimulatedEvents: true });
    assert.equal(required(state.bot.field.find(card => card.id === 516)).protectionEffects?.length || 0, 0);
    assert.equal(state.pendingSynchroMaterialFollowups?.length || 0, 0);
  });

  test(`Mage draws only while it remains on the field (${actor})`, t => {
    const { bot, botGame, make } = scenario(t, actor);
    const mage = make(512), core = make(501), catapult = make(502), multimodal = make(503), kaiser = make(513);
    catapult.level = 2;
    placeFieldCards(bot.field, mage, core, catapult);
    bot.extraDeck.push(multimodal, kaiser);
    bot.deck.push(make(518), make(519), make(520));
    const state = bot.cloneGameState(botGame);
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: multimodal.instanceId,
      materialInstanceIds: [core.instanceId, catapult.instanceId], position: "attack" }, { enableSimulatedEvents: true });
    assert.equal(state.bot.hand.length, 2, "Core and the Mage still on the field each draw once");
    const other = bot.cloneGameState(botGame);
    applyGenericSimulatedMainPhaseAction(other, { type: "synchro", synchroInstanceId: kaiser.instanceId,
      materialInstanceIds: [core.instanceId, mage.instanceId], position: "attack" }, { enableSimulatedEvents: true, shouldActivateEffect: () => false });
    assert.equal(other.bot.hand.length, 1, "Mage used as material is absent when the new Synchro arrives");
  });

  test(`Kaiser uses the levels of cards actually recycled including Synchros (${actor})`, t => {
    const { bot, botGame, make } = scenario(t, actor);
    const raptor = make(505), catapult = make(502), kaiser = make(513);
    placeFieldCards(bot.field, raptor, catapult);
    bot.extraDeck.push(kaiser);
    bot.graveyard.push(make(510));
    const state = bot.cloneGameState(botGame);
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: kaiser.instanceId,
      materialInstanceIds: [raptor.instanceId, catapult.instanceId], position: "attack" }, {
      enableSimulatedEvents: true,
      shouldActivateEffect: ({effect}) => effect.id === "tech_zero_turbocharge_kaiser_synchro_recycle_buff",
    });
    assert.equal(required(state.bot.field.find(card => card.id === 513)).atk, 3100);
    assert.equal(state.bot.deck.length, 2);
    assert.ok(state.bot.extraDeck.some(card => card.id === 510));
    assert.equal(state.bot.graveyard.length, 0);
  });
}

for (const actor of ["player", "bot"] as const) {
  test(`Reactor cannot recycle on the turn of its simulated Synchro Summon (${actor})`, t => {
    const { bot, botGame, make } = scenario(t, actor);
    const raptor = make(505), mage = make(512), reactor = make(515);
    placeFieldCards(bot.field, raptor, mage);
    bot.extraDeck.push(reactor);
    const state = bot.cloneGameState(botGame);
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: reactor.instanceId,
      materialInstanceIds: [raptor.instanceId, mage.instanceId], position: "attack" }, {
      shouldActivateEffect: () => false,
    });
    const summoned = required(state.bot.field.find(card => card.id === 515));
    assert.equal(summoned.summonedTurn, state.turnCounter);
    assert.equal(summoned.lastSummonedTurn, state.turnCounter);
    const before = board(state.bot);
    applyGenericSimulatedMainPhaseAction(state, { type: "monsterEffect", cardId: 515,
      effectId: "tech_zero_reactor_dragon_recycle_synchros" }, { enableSimulatedEvents: true });
    assert.deepEqual(board(state.bot), before);
  });
}

for (const actor of ["player", "bot"] as const) {
  test(`Slasher buffs the Core revived earlier in the same Synchro Chain (${actor})`, async t => {
    const { game, bot, botGame, make } = scenario(t, actor);
    const core = make(501), catapult = make(502), slasher = make(510);
    placeFieldCards(bot.field, core, catapult);
    bot.extraDeck.push(slasher);
    bot.deck.push(make(518));
    const state = bot.cloneGameState(botGame);
    const action: SynchroAIAction = { type: "synchro", synchroInstanceId: slasher.instanceId,
      materialInstanceIds: [core.instanceId, catapult.instanceId], position: "attack" };
    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    applyGenericSimulatedMainPhaseAction(state, action);
    const simulatedCore = required(state.bot.field.find(card => card.id === 501));
    assert.equal(simulatedCore.atk, core.atk);
    assert.equal(simulatedCore.def, core.def);
    assert.equal(simulatedCore.atk, 400);
    assert.deepEqual(simulatedCore.turnBasedBuffs?.map(buff => ({ stat: buff.stat, value: buff.value, expiresOnTurn: buff.expiresOnTurn })),
      core.turnBasedBuffs?.map(buff => ({ stat: buff.stat, value: buff.value, expiresOnTurn: buff.expiresOnTurn })));
    assert.equal(required(state.bot.field.find(card => card.id === 510)).atk, slasher.atk);
    assert.equal(game.turnCounter, 2);
  });
}
