import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { analyzeDragonState } from "../../src/core/ai/dragon/stateAnalysis.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "bot" | "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 42 });
  t.after(() => game.dispose("architecture_dragon_migration"));
  const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> });
  owner.id = actor;
  game[actor] = owner;
  owner.game = unsafeFixture<BotGamePort>(game,
    "This concrete Game supplies the Bot's runtime capabilities; its fixture EffectEngine projection is narrower.");
  game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  const opponent = game[actor === "bot" ? "player" : "bot"];
  opponent.controllerType = "ai";
  const card = (id: number) => required(game.createCardForOwner(id, owner));
  return { game, owner, opponent, card };
}

const ids = (cards: readonly { id?: number | undefined }[]) => cards.map(card => card.id);

for (const actor of ["bot", "player"] as const) {
  test(`Dragon Voltaic uses its declared hand ignition and updates Metal's summon facts (${actor})`, async t => {
    const { game, owner, card } = scenario(t, actor);
    const metal = card(253), incoming = card(255);
    placeFieldCards(owner.field, metal); owner.hand.push(incoming);
    const { state } = createGameTreeCopy(game, owner);
    assert.equal((await game.tryActivateMonsterEffect(incoming, null, "hand", owner,
      { effectId: "voltaic_dragon_special_summon" }))?.success, true);
    new DragonStrategy(state.bot).simulateMainPhaseAction(state,
      { type: "handIgnition", index: 0, cardId: incoming.id, effectId: "voltaic_dragon_special_summon" });
    const projectedMetal = required(state.bot.field.find(card => card.id === metal.id));
    assert.equal(projectedMetal.fieldPresenceState?.summon_count_Dragon, metal.fieldPresenceState?.summon_count_Dragon);
    assert.equal(projectedMetal.atk, metal.atk);
    assert.equal(projectedMetal.def, metal.def);
    assert.ok(state.bot.field.some(card => card.instanceId === incoming.instanceId));
  });

  for (const available of [false, true]) {
    test(`Dragon Normal Summon records the actual Armored trigger resolution (${actor}/${available})`, async t => {
      const { game, owner, card } = scenario(t, actor);
      const source = card(252);
      owner.hand.push(source);
      if (available) owner.deck.push(card(254), card(278));
      const { state } = createGameTreeCopy(game, owner);
      assert.equal((await game.performNormalSummon(owner, 0, "attack"))?.success, true);
      new DragonStrategy(state.bot).simulateMainPhaseAction(state,
        { type: "summon", index: 0, cardId: 252, position: "attack" });
      assert.deepEqual(ids(state.bot.hand), ids(owner.hand));
      assert.deepEqual(ids(state.bot.deck), ids(owner.deck));
      const runtimeCount = game.materialDuelStats[actor].effectActivationsByMaterialId.get(252) ?? 0;
      assert.equal(runtimeCount, 1, "The real Bot resolves the optional search, including its legal zero-card case.");
      assert.equal(state.materialDuelStats?.[actor].effectActivationsByMaterialId.get(252) ?? 0, runtimeCount);
    });
  }

  for (const renamed of [false, true]) {
    test(`Dragon Spell uses its declared Roar action and runtime finalization (${actor}/${renamed})`, async t => {
      const { game, owner, opponent, card } = scenario(t, actor);
      const source = card(261), host = card(260);
      if (renamed) source.name = "Declared Dragon Spell control";
      const target = required(game.createCardForOwner(262, opponent));
      owner.hand.push(source); placeFieldCards(owner.field, host); opponent.fieldSpell = target;
      const { state } = createGameTreeCopy(game, owner);
      const selected = required(state.player.fieldSpell);
      const result = await game.tryActivateSpell(source, 0, null, { owner,
        activationContext: { decisions: { selections: { destroy_targets: [target.instanceId] } } } });
      assert.equal(result.success, true);
      assert.equal(opponent.fieldSpell, null);
      new DragonStrategy(state.bot).simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 261,
        activationContext: { decisions: { selections: { destroy_targets: [required(selected.instanceId)] } } } });
      assert.equal(state.player.fieldSpell, null);
      assert.deepEqual(ids(state.player.graveyard), ids(opponent.graveyard));
      assert.deepEqual(ids(state.bot.hand), ids(owner.hand));
      assert.deepEqual(ids(state.bot.spellTrap), ids(owner.spellTrap));
      assert.deepEqual(ids(state.bot.graveyard), ids(owner.graveyard));
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }

  test(`Dragon field ignition respects the actual declared position target (${actor})`, async t => {
    const { game, owner, opponent, card } = scenario(t, actor);
    const source = card(257);
    const chosen = required(game.createCardForOwner(252, opponent));
    const threat = required(game.createCardForOwner(260, opponent));
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, chosen, threat);
    const { state } = createGameTreeCopy(game, owner);
    const projectedChosen = required(state.player.field[0]);
    const effect = required(source.effects.find(entry => entry.id === "majestic_silver_dragon_position_switch"));
    assert.equal((await game.tryActivateMonsterEffect(source, { majestic_position_target: [chosen] }, "field", owner,
      { effectId: effect.id })).success, true);
    assert.equal(chosen.position, "defense");
    assert.equal(threat.position, "attack");
    new DragonStrategy(state.bot).simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0,
      cardId: 257, effectId: effect.id, activationContext: { decisions: { selections: {
        majestic_position_target: [required(projectedChosen.instanceId)],
      } } } });
    assert.deepEqual(state.player.field.map(entry => entry.position), opponent.field.map(entry => entry.position));
    assert.equal(canUseSimulatedEffectUsage(state, effect, required(state.bot.field[0]), actor, true), false);
  });

  test(`Dragon graveyard cost publishes Voltaic and Luminous child triggers once (${actor})`, async t => {
    const { game, owner, opponent, card } = scenario(t, actor);
    const source = card(254), cost = card(255), recovery = card(257), luminous = card(251);
    owner.graveyard.push(source, recovery); owner.hand.push(cost); placeFieldCards(owner.field, luminous);
    const { state } = createGameTreeCopy(game, owner);
    const projectedCost = required(state.bot.hand[0]);
    const effect = required(source.effects.find(entry => entry.id === "grey_dragon_gy_return"));
    assert.equal((await game.tryActivateMonsterEffect(source, { grey_dragon_discard_cost: [cost] }, "graveyard", owner,
      { effectId: effect.id })).success, true);
    assert.equal(opponent.lp, 7200);
    assert.ok(owner.hand.includes(recovery));
    new DragonStrategy(state.bot).simulateMainPhaseAction(state, { type: "graveyardMonsterEffect", graveyardIndex: 0,
      cardId: 254, effectId: effect.id, activationContext: { decisions: { selections: {
        grey_dragon_discard_cost: [required(projectedCost.instanceId)],
      } } } });
    assert.equal(state.player.lp, opponent.lp);
    assert.deepEqual(ids(state.bot.hand), ids(owner.hand));
    assert.deepEqual(ids(state.bot.graveyard), ids(owner.graveyard));
    const projectedLuminous = required(state.bot.field[0]);
    const luminousEffect = required(luminous.effects.find(entry => entry.id === "luminous_dragon_discard_recover"));
    assert.equal(game.effectEngine.checkOncePerTurn(luminous, owner, luminousEffect).ok, false);
    assert.equal(canUseSimulatedEffectUsage(state, luminousEffect, projectedLuminous, actor, true), false);
    const voltaicEffect = required(cost.effects.find(entry => entry.id === "voltaic_dragon_discard_damage"));
    assert.equal(game.effectEngine.checkOncePerTurn(cost, owner, voltaicEffect).ok, false);
    assert.equal(canUseSimulatedEffectUsage(state, voltaicEffect, projectedCost, actor, true), false);
  });

  test(`Dragon self-departure ignition preserves Grey's after-summon buff and canonical uses (${actor})`, async t => {
    const { game, owner, card } = scenario(t, actor);
    const source = card(260), beneficiary = card(257), recruit = card(254);
    placeFieldCards(owner.field, source, beneficiary); owner.graveyard.push(recruit);
    const { state } = createGameTreeCopy(game, owner);
    const effect = required(source.effects.find(entry => entry.id === "hellkite_dragon_field_send_revive"));
    assert.equal((await game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: effect.id })).success, true);
    assert.ok(owner.graveyard.includes(source));
    assert.ok(owner.field.includes(recruit));
    assert.equal(beneficiary.atk, 2900);
    new DragonStrategy(state.bot).simulateMainPhaseAction(state,
      { type: "monsterEffect", fieldIndex: 0, cardId: 260, effectId: effect.id });
    assert.deepEqual(ids(state.bot.field), ids(owner.field));
    assert.deepEqual(state.bot.field.map(entry => entry.atk), owner.field.map(entry => entry.atk));
    assert.deepEqual(ids(state.bot.graveyard), ids(owner.graveyard));
    assert.equal(state.materialDuelStats?.[actor].effectActivationsByMaterialId.get(260) ?? 0,
      game.materialDuelStats[actor].effectActivationsByMaterialId.get(260));
    assert.equal(state.materialDuelStats?.[actor].effectActivationsByMaterialId.get(254) ?? 0,
      game.materialDuelStats[actor].effectActivationsByMaterialId.get(254));
  });

  test(`Dragon hand ignition resolves the Solar and Lunar sequence through the same ledger (${actor})`, async t => {
    const { game, owner, card } = scenario(t, actor);
    const source = card(279), cost = card(258), lunar = card(280), searched = card(252);
    owner.hand.push(source, cost); owner.deck.push(lunar, searched);
    const { state } = createGameTreeCopy(game, owner);
    const strategy = new DragonStrategy(state.bot);
    const action = required(strategy.generateMainPhaseActions(state)
      .find(entry => entry.type === "handIgnition" && entry.effectId === "solar_eclipse_discard_summon_lunar"));
    const effect = required(source.effects.find(entry => entry.id === action.effectId));
    const projectedSource = required(state.bot.hand[0]);
    assert.equal((await game.tryActivateMonsterEffect(source, null, "hand", owner,
      { effectId: effect.id, activationContext: { ...action.activationContext, activationZone: "hand" } })).success, true);
    assert.ok(owner.field.includes(lunar));
    assert.ok(owner.field.includes(source));
    assert.deepEqual(ids(owner.hand), [252]);
    strategy.simulateMainPhaseAction(state, action);
    assert.deepEqual(ids(state.bot.field), ids(owner.field));
    assert.deepEqual(ids(state.bot.hand), ids(owner.hand));
    assert.deepEqual(ids(state.bot.graveyard), ids(owner.graveyard));
    assert.equal(game.effectEngine.checkOncePerTurn(source, owner, effect).ok, false);
    assert.equal(canUseSimulatedEffectUsage(state, effect, projectedSource, actor, true), false);
    const lunarEffect = required(lunar.effects.find(entry => entry.id === "lunar_eclipse_summon_search"));
    assert.equal(game.effectEngine.checkOncePerTurn(lunar, owner, lunarEffect).ok, false);
    assert.equal(canUseSimulatedEffectUsage(state, lunarEffect, required(state.bot.field[0]), actor, true), false);
    const { _gameRef: _liveGame, ...planningView } = state;
    const usageBefore = structuredClone(state._simOncePerTurn);
    const turnBefore = state._simOncePerTurnTurn;
    for (let preview = 0; preview < 2; preview++) {
      const resources = analyzeDragonState({ game: planningView, bot: state.bot, opponent: state.player, isSimulatedState: true });
      assert.equal(resources.opt.solarHand.used, true);
      assert.equal(resources.opt.lunarSummon.used, true);
      assert.equal(resources.opt.solarGy.used, false, "The other declared Solar effect remains independent.");
    }
    assert.deepEqual(state._simOncePerTurn, usageBefore);
    assert.equal(state._simOncePerTurnTurn, turnBefore);
    planningView.turnCounter++;
    assert.equal(analyzeDragonState({ game: planningView, bot: state.bot, opponent: state.player, isSimulatedState: true }).opt.solarHand.canUse, true);
    assert.deepEqual(state._simOncePerTurn, usageBefore, "Previewing a future turn does not consume or normalize the snapshot ledger.");

  });

  for (const fusionId of [265, 266]) {
    test(`Dragon Polymerization preserves the real fusion follow-up (${actor}/${fusionId})`, async t => {
      const { game, owner, opponent, card } = scenario(t, actor);
      const source = card(12), fusion = card(fusionId);
      owner.hand.push(source, ...[fusionId === 265 ? 255 : 251, 257, ...(fusionId === 266 ? [254] : [])].map(card));
      owner.extraDeck.push(fusion);
      owner.lp = 2000;
      placeFieldCards(opponent.field, required(game.createCardForOwner(270, opponent)));
      if (fusionId === 265) owner.graveyard.push(card(254));
      const { state } = createGameTreeCopy(game, owner);
      const strategy = new DragonStrategy(state.bot);
      const action = required(strategy.generateMainPhaseActions(state)
        .find(entry => entry.type === "spell" && entry.cardId === 12),
      "The existing Dragon policy must authorize this fusion before testing its execution.");
      const result = await game.tryActivateSpell(source, 0, null, { owner,
        activationContext: { ...action.activationContext, activationZone: "hand", sourceZone: "hand" } });
      assert.equal(result.success, true);
      assert.ok(owner.field.includes(fusion));
      strategy.simulateMainPhaseAction(state, action);
      assert.deepEqual(ids(state.bot.field), ids(owner.field));
      assert.deepEqual(state.bot.field.map(entry => entry.atk), owner.field.map(entry => entry.atk));
      assert.deepEqual(ids(state.bot.banished), ids(owner.banished));
      assert.equal(state.bot.hand.length, owner.hand.length);
      assert.equal(state.bot.deck.length, owner.deck.length);
      assert.equal(state.bot.graveyard.length, owner.graveyard.length);
      const effect = required(fusion.effects.find(entry => entry.event === "after_summon"));
      assert.equal(game.effectEngine.checkOncePerTurn(fusion, owner, effect).ok, false);
      assert.equal(canUseSimulatedEffectUsage(state, effect, required(state.bot.field[0]), actor, true), false);
    });
  }
}

for (const actor of ["bot", "player"] as const) {
  test(`Dragon Stars completes its own level reduction before resolving discard child triggers (${actor})`, async t => {
    const { game, owner, opponent, card } = scenario(t, actor);
    const first = card(276), second = card(276), cost = card(255), secondCost = card(255), recruit = card(254), luminous = card(251);
    owner.hand.push(first, second, cost, secondCost); owner.graveyard.push(recruit); placeFieldCards(owner.field, luminous);
    const { state } = createGameTreeCopy(game, owner);
    const projectedSources = [required(state.bot.hand[0]), required(state.bot.hand[1])];
    const projectedCosts = [required(state.bot.hand[2]), required(state.bot.hand[3])];
    for (const [index, [source, discard]] of [[first, cost], [second, secondCost]].entries()) {
      const result = await game.tryActivateSpell(required(source), owner.hand.indexOf(required(source)), null, { owner, activationContext: {
        decisions: { selections: { estrelas_convergentes_discard: [required(discard).instanceId] } },
      } });
      assert.equal(result.success, true);
      assert.ok(owner.hand.includes(recruit), "The real Dragon Bot resolves Luminous recovery.");
      assert.equal(recruit.level, index === 0 ? 4 : 2, "First recovery follows parent reduction; only the second parent reduces the recovered card.");
      new DragonStrategy(state.bot).simulateMainPhaseAction(state, { type: "spell",
        index: state.bot.hand.indexOf(required(projectedSources[index])), cardId: 276,
        activationContext: { decisions: { selections: { estrelas_convergentes_discard: [required(required(projectedCosts[index]).instanceId)] } } } });
      assert.deepEqual(state.bot.hand.map(card => ({ id: card.id, level: card.level })), owner.hand.map(card => ({ id: card.id, level: card.level })));
      assert.deepEqual(ids(state.bot.graveyard), ids(owner.graveyard));
      assert.equal(state.player.lp, opponent.lp);
    }
  });
}
