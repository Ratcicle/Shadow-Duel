import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import ChainSystem from "../src/core/ChainSystem.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";
import { simulateLuminarchMainPhaseAction } from "../src/core/ai/luminarch/simulation.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  t.after(() => game.dispose());
  return game;
}

function response(game: RuntimeGame, inspect: () => void | Promise<void>) {
  assert.ok(game.chainSystem instanceof ChainSystem);
  game.chainSystem.offerChainResponses = async () => {
    if (game.chainSystem.getLastChainLink()) await inspect();
    return { offers: 1, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
  };
}

for (const negate of [false, true]) {
  test(`Sickle GY recovery pays banishment before response, negated=${negate}`, async t => {
    const game = setup(t);
    const sickle = new Card(cardDefinition(156), "player");
    const spell = new Card(cardDefinition(163), "player");
    game.player.graveyard.push(sickle, spell);
    let offers = 0;
    response(game, () => {
      offers++;
      const link = required(game.chainSystem.getLastChainLink());
      assert.equal(link.costPayment?.status, "paid");
      assert.ok(game.player.banished.includes(sickle));
      assert.ok(game.player.graveyard.includes(spell));
      if (negate) link.effectNegated = true;
    });
    const result = await game.tryActivateMonsterEffect(sickle, null, "graveyard", game.player);
    assert.equal(result.ok, true);
    assert.equal(offers, 1);
    assert.ok(game.player.banished.includes(sickle));
    assert.equal(game.player.hand.includes(spell), !negate);
  });

  test(`Convocation discards before response without targeting its cost, negated=${negate}`, async t => {
    const game = setup(t);
    const source = new Card(cardDefinition(161), "player");
    const cost = new Card(cardDefinition(158), "player");
    const reward = new Card(cardDefinition(151), "player");
    placeFieldCards(game.player.spellTrap, source);
    game.player.hand.push(cost);
    game.player.deck.push(reward);
    let offers = 0;
    let targets = 0;
    game.on("effect_targeted", () => { targets++; });
    response(game, () => {
      offers++;
      const link = required(game.chainSystem.getLastChainLink());
      assert.equal(link.costPayment?.status, "paid");
      assert.ok(game.player.graveyard.includes(cost));
      assert.ok(game.player.deck.includes(reward));
      if (negate) link.effectNegated = true;
    });
    await game.tryActivateSpellTrapEffect(source, { convocation_discard: [cost] }, { owner: game.player });
    assert.equal(offers, 1);
    assert.equal(targets, 0);
    assert.ok(game.player.graveyard.includes(cost));
    assert.equal(game.player.hand.includes(reward), !negate);
  });

  test(`Protector frees its zone by paying Aegisbearer before response, negated=${negate}`, async t => {
    const game = setup(t);
    const protector = new Card(cardDefinition(157), "player");
    const cost = new Card(cardDefinition(153), "player");
    const fillers = Array.from({ length: 4 }, () => new Card(cardDefinition(151), "player"));
    placeFieldCards(game.player.field, cost, ...fillers);
    game.player.hand.push(protector);
    assert.equal(game.effectEngine.canActivateMonsterEffectPreview(protector, game.player, "hand").ok, true);
    let offers = 0;
    response(game, () => {
      const link = required(game.chainSystem.getLastChainLink());
      if (link.card !== protector) return;
      offers++;
      assert.equal(link.costPayment?.status, "paid");
      assert.ok(game.player.graveyard.includes(cost));
      assert.equal(game.player.field.length, 4);
      assert.ok(game.player.hand.includes(protector));
      if (negate) link.effectNegated = true;
    });
    await game.tryActivateMonsterEffect(protector, { aegisbearer_cost: [cost] }, "hand", game.player);
    assert.equal(offers, 1);
    assert.ok(game.player.graveyard.includes(cost));
    assert.equal(game.player.field.includes(protector), !negate);
    assert.equal(game.player.hand.includes(protector), negate);
    assert.equal(protector.cannotAttackThisTurn, false);
  });
}

for (const costState of ["missing", "facedown", "enemy"] as const) {
  test(`Protector rejects ${costState} Aegisbearer without moving cards`, async t => {
    const game = setup(t);
    const protector = new Card(cardDefinition(157), "player");
    const owner = costState === "enemy" ? game.bot : game.player;
    const cost = new Card(cardDefinition(153), owner.id);
    if (costState !== "missing") placeFieldCards(owner.field, cost);
    cost.isFacedown = costState === "facedown";
    game.player.hand.push(protector);
    assert.equal(game.effectEngine.canActivateMonsterEffectPreview(protector, game.player, "hand").ok, false);
    const result = await game.tryActivateMonsterEffect(protector, null, "hand", game.player);
    assert.equal(result.ok, false);
    assert.ok(game.player.hand.includes(protector));
    assert.equal(game.player.graveyard.length, 0);
  });
}

for (const removeAll of [false, true]) {
  test(`Spear control condition creates no friendly target and is not rechecked at resolution, removeAll=${removeAll}`, async t => {
    const game = setup(t);
    const spear = new Card(cardDefinition(167), "player");
    const ally = new Card(cardDefinition(151), "player");
    const other = new Card(cardDefinition(153), "player");
    const target = new Card(cardDefinition(151), "bot");
    placeFieldCards(game.player.field, ally, other);
    placeFieldCards(game.bot.field, target);
    game.player.hand.push(spear);
    const targeted: number[] = [];
    game.on("effect_targeted", event => { targeted.push(Number(required(event.target).instanceId)); });
    response(game, async () => {
      await game.moveCard(ally, game.player, "graveyard", { fromZone: "field", awaitEvents: true });
      if (removeAll) await game.moveCard(other, game.player, "graveyard", { fromZone: "field", awaitEvents: true });
    });
    await game.tryActivateSpell(spear, 0, { spear_zero_target: [target] }, { owner: game.player });
    assert.deepEqual(targeted, [target.instanceId]);
    assert.deepEqual([target.atk, target.def], [0, 0]);
  });
}

for (const fieldState of ["missing", "facedown", "faceup"] as const) {
  test(`Spear activation requires a controlled known Luminarch (${fieldState})`, t => {
    const game = setup(t);
    const spear = new Card(cardDefinition(167), "player");
    const ally = new Card(cardDefinition(151), "player");
    if (fieldState !== "missing") placeFieldCards(game.player.field, ally);
    ally.isFacedown = fieldState === "facedown";
    placeFieldCards(game.bot.field, new Card(cardDefinition(151), "bot"));
    game.player.hand.push(spear);
    assert.equal(game.effectEngine.canActivateSpellFromHandPreview(spear, game.player).ok, fieldState === "faceup");
  });
}

for (const discounted of [false, true]) {
  for (const lp of [500, 1500, 2500]) {
    test(`Judgment activation checks its payable LP cost (${lp}, discount=${discounted})`, async t => {
      const game = setup(t);
      const spell = new Card(cardDefinition(170), "player");
      const knight = new Card(cardDefinition(173), "player");
      if (discounted) placeFieldCards(game.player.field, knight);
      placeFieldCards(game.bot.field, new Card(cardDefinition(151), "bot"), new Card(cardDefinition(151), "bot"));
      game.player.graveyard.push(new Card(cardDefinition(151), "player"));
      game.player.hand.push(spell);
      game.player.lp = lp;
      const expectedCost = discounted ? 1000 : 2000;
      for (let i = 0; i < 3; i++) {
        assert.equal(game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok, lp >= expectedCost);
        assert.equal(game.player.lp, lp, "preview must not spend LP");
      }
      assert.equal(game.canUseOncePerTurn(knight, game.player, required(knight.effects[1])).remaining, 2);
      let offers = 0;
      response(game, () => {
        offers++;
        assert.equal(game.player.lp, lp - expectedCost);
        const link = required(game.chainSystem.getLastChainLink());
        assert.equal(link.costPayment?.status, "paid");
        link.effectNegated = true;
      });
      await game.tryActivateSpell(spell, 0, null, { owner: game.player });
      assert.equal(offers, lp >= expectedCost ? 1 : 0);
      assert.equal(game.player.lp, lp >= expectedCost ? lp - expectedCost : lp);
      if (discounted) {
        assert.equal(game.canUseOncePerTurn(knight, game.player, required(knight.effects[1])).remaining, lp >= expectedCost ? 1 : 2);
      }
    });
  }
}

for (const exhausted of [false, true]) {
  test(`Set Judgment respects remaining discount uses (${exhausted ? "exhausted" : "available"})`, async t => {
    const game = setup(t);
    const spell = new Card(cardDefinition(170), "player");
    const knight = new Card(cardDefinition(173), "player");
    placeFieldCards(game.player.spellTrap, spell);
    placeFieldCards(game.player.field, knight);
    placeFieldCards(game.bot.field, new Card(cardDefinition(151), "bot"), new Card(cardDefinition(151), "bot"));
    game.player.graveyard.push(new Card(cardDefinition(151), "player"));
    spell.isFacedown = true;
    spell.setTurn = 1;
    game.player.lp = 1500;
    const discount = required(knight.effects[1]);
    if (exhausted) {
      game.markOncePerTurnUsed(knight, game.player, discount);
      game.markOncePerTurnUsed(knight, game.player, discount);
    }
    for (let i = 0; i < 3; i++) {
      const preview = game.effectEngine.canActivateSpellTrapEffectPreview(spell, game.player, "spellTrap");
      assert.equal(preview.ok, !exhausted, preview.reason ?? undefined);
    }
    assert.equal(game.player.lp, 1500);
    let offers = 0;
    response(game, () => {
      offers++;
      assert.equal(game.player.lp, 500);
      required(game.chainSystem.getLastChainLink()).effectNegated = true;
    });
    await game.tryActivateSpellTrapEffect(spell, null, { owner: game.player });
    assert.equal(offers, exhausted ? 0 : 1);
    assert.equal(game.player.lp, exhausted ? 1500 : 500);
    const usage = game.canUseOncePerTurn(knight, game.player, discount);
    assert.equal(usage.ok, !exhausted);
    if (!exhausted) assert.equal(usage.remaining, 1);
  });
}

for (const id of [156, 161]) {
  test(`${id} cannot pay when its search has no valid result`, async t => {
    const game = setup(t);
    const source = new Card(cardDefinition(id), "player");
    const cost = new Card(cardDefinition(158), "player");
    if (id === 156) game.player.graveyard.push(source, cost);
    else {
      placeFieldCards(game.player.spellTrap, source);
      game.player.hand.push(cost);
      game.player.deck.push(new Card(cardDefinition(158), "player"));
    }
    let responses = 0;
    response(game, () => { responses++; });
    const result = id === 156
      ? await game.tryActivateMonsterEffect(source, null, "graveyard", game.player)
      : await game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
    assert.equal(result.ok, false);
    assert.equal(responses, 0);
    assert.equal(game.player.banished.length, 0);
    assert.ok(id === 156 ? game.player.graveyard.includes(source) : game.player.hand.includes(cost));
  });
}

for (const id of [157, 161]) {
  for (const cancel of [false, true]) {
    test(`${id}: human ${cancel ? "cancels before paying" : "chooses the cost manually"}`, async t => {
      const game = setup(t);
      game.player.controllerType = "human";
      game.ui.showChainResponseModal = async () => null;
      const source = new Card(cardDefinition(id), "player");
      const costA = new Card(cardDefinition(id === 157 ? 153 : 158), "player");
      const costB = new Card(cardDefinition(id === 157 ? 153 : 158), "player");
      const reward = new Card(cardDefinition(151), "player");
      if (id === 157) {
        game.player.hand.push(source);
        placeFieldCards(game.player.field, costA, costB, ...Array.from({ length: 3 }, () => new Card(cardDefinition(151), "player")));
      } else {
        placeFieldCards(game.player.spellTrap, source);
        game.player.hand.push(costA, costB);
        game.player.deck.push(reward, new Card(cardDefinition(153), "player"));
      }
      let costChoices = 0;
      let positions = 0;
      game.ui.showFieldTargetingControls = (confirm, onCancel) => {
        costChoices++;
        setImmediate(() => {
          if (cancel) required(onCancel)();
          else {
            const zone = id === 157 ? "field" : "hand";
            assert.equal(game.handleTargetSelectionClick("player", game.player[zone].indexOf(costB), null, zone), true);
            required(confirm)();
          }
        });
        return { updateState() {}, close() {} };
      };
      game.ui.showTargetSelection = (contract, confirm, onCancel) => {
        const requirement = required(required(required(contract).requirements)[0]);
        const isCost = requirement.candidates.some(entry => entry.cardRef === costB);
        if (isCost) {
          costChoices++;
          assert.ok(id === 157 ? game.player.field.includes(costB) : game.player.hand.includes(costB));
          if (cancel) {
            setImmediate(() => required(onCancel)());
            return { close() {} };
          }
        } else assert.ok(game.player.graveyard.includes(costB), "search selection follows payment");
        const candidate = required(requirement.candidates.find(entry => entry.cardRef === (isCost ? costB : reward)));
        setImmediate(() => required(confirm)({ [requirement.id]: [candidate.key] }));
        return { close() {} };
      };
      game.ui.showSpecialSummonPositionModal = (_card, choose) => {
        positions++;
        assert.ok(game.player.graveyard.includes(costB));
        choose("defense");
      };
      if (id === 157) await game.tryActivateMonsterEffect(source, null, "hand", game.player);
      else await game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
      assert.equal(costChoices, 1);
      assert.equal(game.player.graveyard.includes(costB), !cancel);
      assert.equal(game.player.graveyard.includes(costA), false);
      if (id === 157) {
        assert.equal(game.player.field.includes(source), !cancel);
        assert.equal(positions, cancel ? 0 : 1);
        if (!cancel) assert.equal(source.position, "defense");
      } else assert.equal(game.player.hand.includes(reward), !cancel);
    });
  }
}

test("Protector keeps the paid cost if a response fills the freed zone", async t => {
  const game = setup(t);
  const source = new Card(cardDefinition(157), "player");
  const cost = new Card(cardDefinition(153), "player");
  game.player.hand.push(source);
  placeFieldCards(game.player.field, cost, ...Array.from({ length: 4 }, () => new Card(cardDefinition(151), "player")));
  response(game, () => {
    const link = required(game.chainSystem.getLastChainLink());
    if (link.card !== source) return;
    assert.ok(game.player.graveyard.includes(cost));
    placeFieldCards(game.player.field, new Card(cardDefinition(151), "player"));
  });
  await game.tryActivateMonsterEffect(source, { aegisbearer_cost: [cost] }, "hand", game.player);
  assert.ok(game.player.graveyard.includes(cost));
  assert.ok(game.player.hand.includes(source));
  assert.equal(game.player.field.length, 5);
});

for (const id of [156, 157, 161]) {
  test(`${id} simulation pays its declarative cost exactly once`, () => {
    const source = simulationCard({ ...cardDefinition(id), instanceId: 90000 + id });
    const cost = simulationCard({ ...cardDefinition(id === 157 ? 153 : 158), instanceId: 90100 });
    const reward = simulationCard({ ...cardDefinition(id === 156 ? 163 : 151), instanceId: 90101 });
    const state = simulationState({ _isPerspectiveState: true, bot: {
      hand: id === 157 ? [source] : id === 161 ? [cost] : [],
      field: id === 157 ? [cost, ...Array.from({ length: 4 }, (_, index) => simulationCard({ ...cardDefinition(151), instanceId: 90200 + index }))] : [],
      spellTrap: id === 161 ? [source] : [],
      graveyard: id === 156 ? [source, reward] : [],
      deck: id === 161 ? [reward] : [],
    } });
    const effect = required(source.effects?.find(entry => entry.timing === "ignition"));
    simulateLuminarchMainPhaseAction(state, {
      type: id === 156 ? "graveyardMonsterEffect" : id === 157 ? "handIgnition" : "spellTrapEffect",
      index: 0, zoneIndex: 0, cardName: source.name, effectId: effect.id,
    });
    if (id === 156) {
      assert.deepEqual(state.bot.banished, [source]);
      assert.deepEqual(state.bot.hand, [reward]);
    } else {
      assert.deepEqual(state.bot.graveyard, [cost]);
      assert.ok(id === 157 ? state.bot.field.includes(source) : state.bot.hand.includes(reward));
    }
  });
}
