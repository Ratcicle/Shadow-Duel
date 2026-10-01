import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { ReplayDecisionInput } from "../src/core/contracts/decisions.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, completeTestSelections } from "./helpers/game.js";

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
    captureReplay: false, chainResponseTimeoutMs: 0, randomSeed: 42 });
  t.after(() => game.dispose());
  game.turn = seat;
  game.phase = "main1";
  game.turnCounter = 4;
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.autoSelector.orderTriggerCandidates = candidates => [...candidates];
  const owner = game[seat];
  const opponent = game[seat === "player" ? "bot" : "player"];
  const make = (id: number, player = owner) => {
    const card = new Card(cardDefinition(id), player.id);
    card.isFacedown = false;
    card.position = "attack";
    return card;
  };
  return { game, owner, opponent, make };
}

for (const seat of ["player", "bot"] as const) {
  test(`Grey recovers the activating copy in the ${seat} seat`, async t => {
    const { game, owner, make } = setup(t, seat);
    const source = make(254), other = make(254), cost = make(252);
    owner.graveyard.push(other, source);
    owner.hand.push(cost);
    const result = await game.tryActivateMonsterEffect(source, { grey_dragon_discard_cost: [cost] },
      "graveyard", owner, { effectId: "grey_dragon_gy_return" });
    assert.equal(result.success, true);
    assert.ok(owner.hand.includes(source));
    assert.ok(owner.graveyard.includes(other));
    assert.ok(owner.graveyard.includes(cost));
  });

  for (const accepted of [false, true]) {
    test(`Galaxy ${seat} ${accepted ? "accepts" : "declines"} replacement with an empty opposing field`, async t => {
      const { game, owner, opponent, make } = setup(t, seat);
      owner.controllerType = "human";
      const source = make(273);
      placeFieldCards(owner.field, source);
      const decisions: ReplayDecisionInput[] = [];
      game.on("decision_made", decision => { decisions.push(decision); });
      let prompts = 0;
      game.ui.showConfirmPrompt = async () => { prompts++; return accepted; };
      await game.destroyCard(source, { cause: "effect", sourceCard: make(7, opponent), sourcePlayer: opponent });
      assert.equal(prompts, 1);
      assert.equal(owner.banished.includes(source), accepted);
      assert.equal(owner.graveyard.includes(source), !accepted);
      assert.equal(game.delayedActions.length, accepted ? 1 : 0);
      assert.equal(owner.oncePerDuelUsageByName?.galaxy_extreme_dragon_self_banish ?? 0, accepted ? 1 : 0);
      assert.equal(decisions.filter(decision => decision.kind === "choice").length, 1);
    });
  }
}

test("Grey cannot recover a new graveyard presence after a response", async t => {
  const { game, owner, make } = setup(t);
  const source = make(254), other = make(254), cost = make(252);
  owner.graveyard.push(other, source);
  owner.hand.push(cost);
  let moved = false;
  game.chainSystem.offerChainResponses = async () => {
    if (!moved) {
      moved = true;
      await game.moveCard(source, owner, "banished", { fromZone: "graveyard" });
      await game.moveCard(source, owner, "graveyard", { fromZone: "banished" });
    }
    return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
  };
  await game.tryActivateMonsterEffect(source, { grey_dragon_discard_cost: [cost] },
    "graveyard", owner, { effectId: "grey_dragon_gy_return" });
  assert.ok(moved);
  assert.ok(owner.graveyard.includes(source));
  assert.ok(owner.graveyard.includes(other));
  assert.ok(owner.graveyard.includes(cost));
  assert.equal(owner.hand.length, 0);
});

for (const event of ["attack", "effect"] as const) {
  test(`Sanctuary can replace a Dragon after opponent ${event} targeting`, async t => {
    const { game, owner, opponent, make } = setup(t, "bot");
    const source = make(257), dragon = make(event === "attack" ? 254 : 257, opponent);
    const trap = make(268, opponent), replacement = make(event === "attack" ? 255 : 254, opponent);
    placeFieldCards(owner.field, source);
    placeFieldCards(opponent.field, dragon);
    opponent.hand.push(replacement);
    opponent.spellTrap.push(trap);
    trap.isFacedown = true;
    trap.turnSetOn = trap.setTurn = 1;
    game.chainSystem.botChooseChainResponse = async (_player, candidates) =>
      candidates.find(candidate => candidate.card === trap) || null;
    const activations: string[] = [];
    game.on("effect_activated", value => { activations.push(value.effectId || ""); });
    const summons: number[] = [];
    game.on("after_summon", value => { if (value.card.id) summons.push(value.card.id); });
    if (event === "attack") {
      game.phase = "battle";
      game.battleStep = "battle";
      await game.resolveCombat(source, dragon);
    } else {
      await game.tryActivateMonsterEffect(source, { majestic_position_target: [dragon] }, "field", owner,
        { effectId: "majestic_silver_dragon_position_switch" });
    }
    assert.ok(activations.includes(`dragon_spirit_sanctuary_${event === "attack" ? "attack" : "effect_targeted"}`));
    assert.ok(opponent.hand.includes(dragon));
    assert.ok(summons.includes(required(replacement.id)), JSON.stringify({ summons, hand: opponent.hand.map(c => c.id),
      field: opponent.field.map(c => c.id), graveyard: opponent.graveyard.map(c => c.id) }));
  });
}

for (const accepted of [false, true]) {
  test(`Armored replays the human's ${accepted ? "acceptance" : "refusal"} without asking again`, async t => {
    function combat() {
      const { game, make } = setup(t, "bot");
      game.player.controllerType = "human";
      game.phase = "battle";
      game.battleStep = "battle";
      const defender = make(252, game.player), attacker = make(259, game.bot);
      placeFieldCards(game.player.field, defender);
      placeFieldCards(game.bot.field, attacker);
      game.player.deck.push(make(255, game.player), make(255, game.player));
      game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
      return { game, defender, attacker };
    }
    const live = combat(), playback = combat();
    const decisions: ReplayDecisionInput[] = [];
    live.game.on("decision_made", decision => { decisions.push(decision); });
    live.game.ui.showConfirmPrompt = async () => accepted;
    await completeTestSelections(live.game, live.game.resolveCombat(live.attacker, live.defender));
    assert.ok(decisions.some(decision => decision.kind === "choice"));
    assert.equal(live.game.player.field.some(card => card.id === 255), accepted);
    playback.game.decisionBroker.loadReplayDecisions(decisions);
    playback.game.ui.showConfirmPrompt = async () => { throw new Error("Playback must consume the recorded confirmation."); };
    playback.game.ui.showSpecialSummonPositionModal = () => { throw new Error("Playback must consume the recorded position."); };
    await playback.game.resolveCombat(playback.attacker, playback.defender);
    assert.equal(playback.game.player.field.some(card => card.id === 255), accepted);
    assert.equal(playback.game.decisionBroker.replayCursor, decisions.length);
  });
}

for (const accepted of [false, true]) {
  test(`Galaxy replays ${accepted ? "acceptance and the required later choice" : "refusal"} without live prompts`, async t => {
    function board() {
      const fixture = setup(t);
      fixture.owner.controllerType = "human";
      const source = fixture.make(273), first = fixture.make(257, fixture.opponent), chosen = fixture.make(254, fixture.opponent);
      placeFieldCards(fixture.owner.field, source);
      placeFieldCards(fixture.opponent.field, first, chosen);
      for (const card of [source, first, chosen]) fixture.game.ensureDuelCardId(card);
      return { ...fixture, source, first, chosen };
    }
    const live = board(), playback = board();
    const decisions: ReplayDecisionInput[] = [];
    live.game.on("decision_made", decision => { decisions.push(decision); });
    let confirmations = 0;
    live.game.ui.showConfirmPrompt = async () => { confirmations++; return accepted; };
    const destruction = live.game.destroyCard(live.source, { cause: "effect", sourceCard: live.first, sourcePlayer: live.opponent });
    if (accepted) {
      for (let attempts = 0; attempts < 100 && !live.game.targetSelection; attempts++) {
        await new Promise<void>(resolve => setTimeout(resolve, 1));
      }
      const session = required(live.game.targetSelection);
      assert.ok(live.owner.banished.includes(live.source), "self-banish precedes the later selection");
      assert.equal(session.preventCancel, true);
      live.game.cancelTargetSelection();
      assert.equal(live.game.targetSelection, session);
      await live.game.finishTargetSelection();
      assert.equal(live.game.targetSelection, session, "an empty selection cannot complete the accepted replacement");
      const requirement = required(session.requirements[0]);
      const candidate = required(requirement.candidates.find(candidate => candidate.cardRef === live.chosen));
      session.selections[requirement.id] = [candidate.key];
      await live.game.finishTargetSelection();
    }
    await destruction;
    assert.equal(confirmations, 1);
    assert.equal(live.owner.banished.includes(live.source), accepted);
    assert.equal(live.opponent.banished.includes(live.chosen), accepted);
    assert.ok(live.opponent.field.includes(live.first));
    assert.equal(decisions.length, accepted ? 2 : 1);
    playback.game.decisionBroker.loadReplayDecisions(decisions);
    playback.game.ui.showConfirmPrompt = async () => { throw new Error("Galaxy replay must consume its recorded confirmation."); };
    playback.game.ui.showTargetSelection = () => { throw new Error("Galaxy replay must consume its recorded card selection."); };
    await playback.game.destroyCard(playback.source, { cause: "effect", sourceCard: playback.first, sourcePlayer: playback.opponent });
    assert.equal(playback.owner.banished.includes(playback.source), accepted);
    assert.equal(playback.opponent.banished.includes(playback.chosen), accepted);
    assert.ok(playback.opponent.field.includes(playback.first));
    assert.equal(playback.game.decisionBroker.replayCursor, decisions.length);
  });
}

test("Galaxy does not accept a human replacement through the inert UI adapter", async t => {
  const { game, owner, opponent, make } = setup(t);
  owner.controllerType = "human";
  const source = make(273);
  placeFieldCards(owner.field, source);
  const result = await game.destroyCard(source, { cause: "effect", sourceCard: make(7, opponent), sourcePlayer: opponent });
  assert.ok("destroyed" in result && result.destroyed === true);
  assert.ok(owner.graveyard.includes(source));
  assert.equal(owner.oncePerDuelUsageByName?.galaxy_extreme_dragon_self_banish || 0, 0);
  assert.equal(game.delayedActions.length, 0);
});

for (const accepted of [false, true]) {
  test(`card-cost destruction replacement ${accepted ? "pays the chosen card" : "declines without paying"}`, async t => {
    const { game, owner, opponent, make } = setup(t);
    owner.controllerType = "human";
    const source = make(159);
    const cost = new Card({ name: "Replacement cost", cardKind: "monster", archetype: "Luminarch", level: 1, atk: 100, def: 100 }, owner.id);
    placeFieldCards(owner.field, source, cost);
    let confirmations = 0;
    game.ui.showConfirmPrompt = async () => { confirmations++; return accepted; };
    await completeTestSelections(game, game.destroyCard(source, { cause: "effect", sourceCard: make(7, opponent), sourcePlayer: opponent }));
    assert.equal(confirmations, 1);
    assert.equal(owner.field.includes(source), accepted);
    assert.equal(owner.graveyard.includes(cost), accepted);
    const effect = required(source.effects.find(effect => effect.id === "luminarch_aurora_seraph_protect"));
    assert.equal(game.canUseOncePerTurn(source, owner, effect).ok, !accepted);
  });
}

test("automatic destruction replacement does not prompt for optional confirmation", async t => {
  const { game, owner, opponent, make } = setup(t);
  owner.controllerType = "human";
  const source = make(161), target = make(159);
  placeFieldCards(owner.spellTrap, source);
  placeFieldCards(owner.field, target);
  game.ui.showConfirmPrompt = async () => { throw new Error("Automatic replacement must not ask for confirmation."); };
  const result = await game.destroyCard(target, { cause: "effect", sourceCard: make(7, opponent), sourcePlayer: opponent });
  assert.ok("destroyed" in result && result.destroyed === false);
  assert.ok(owner.field.includes(target));
});

test("automatic replacement still pays its action cost", async t => {
  const { game, owner, opponent, make } = setup(t);
  owner.controllerType = "human";
  const source = make(165), target = make(159);
  placeFieldCards(owner.spellTrap, source);
  placeFieldCards(owner.field, target);
  source.equippedTo = target;
  target.equips.push(source);
  game.ui.showConfirmPrompt = async () => { throw new Error("Automatic replacement must not ask for confirmation."); };
  const result = await game.destroyCard(target, { cause: "battle", sourceCard: make(7, opponent), sourcePlayer: opponent });
  assert.ok("destroyed" in result && result.destroyed === false);
  assert.ok(owner.field.includes(target));
  assert.ok(owner.graveyard.includes(source));
  assert.equal(target.equips.includes(source), false);
});
