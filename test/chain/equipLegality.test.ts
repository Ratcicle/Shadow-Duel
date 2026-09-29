import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, runtimeCard } from "../helpers/game.js";
import { finalizeSpellTrapActivation } from "../../src/core/game/spellTrap/finalization.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());
  game.player.controllerType = game.bot.controllerType = "ai";
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 3;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  return game;
}

for (const [id, targetRef] of [[10, "lds_equip_target"], [11, "sotd_equip_target"]] as const) {
  for (const seat of ["player", "bot"] as const) {
    test(`${id} AI chooses only a face-up host in the ${seat} seat`, async t => {
      const game = setup(t);
      game.turn = seat;
      const owner = game[seat];
      const source = runtimeCard(cardDefinition(id), seat);
      const hidden = runtimeCard({ ...cardDefinition(1), isFacedown: true }, seat);
      const visible = runtimeCard(cardDefinition(1), seat);
      placeFieldCards(owner.field, hidden, visible);
      owner.hand.push(source);
      game.ui.showTargetSelection = () => { throw new Error("AI cannot ask a human to select a host."); };
      const result = await game.tryActivateSpell(source, 0, null, { owner });
      assert.equal(result.success, true);
      assert.equal(source.equippedTo, visible);
    });
  }

  test(`${id} leaves failed equip cleanup to finalization without a Chain`, async t => {
    const game = setup(t);
    const source = runtimeCard(cardDefinition(id));
    placeFieldCards(game.player.spellTrap, source);
    let moved = 0;
    game.on("card_to_grave", event => { if (event.card === source) moved++; });
    const result = await game.effectEngine.applyEquip({ type: "equip", targetRef }, {
      source, player: game.player, opponent: game.bot,
    }, {});
    assert.equal(result, false);
    assert.ok(game.player.spellTrap.includes(source));
    assert.equal(moved, 0);
    await finalizeSpellTrapActivation.call(game, source, game.player, "spellTrap");
    assert.ok(game.player.graveyard.includes(source));
    await finalizeSpellTrapActivation.call(game, source, game.player, "spellTrap");
    assert.equal(moved, 1);
  });

  for (const zone of ["hand", "spellTrap"] as const) {
    test(`${id} refuses a facedown-only board before committing from ${zone}`, async t => {
      const game = setup(t);
      const source = runtimeCard(cardDefinition(id));
      const target = runtimeCard({ ...cardDefinition(1), isFacedown: true, position: "defense" });
      placeFieldCards(game.player.field, target);
      if (zone === "hand") game.player.hand.push(source);
      else { source.isFacedown = true; source.setTurn = 1; placeFieldCards(game.player.spellTrap, source); }
      const result = zone === "hand"
        ? await game.tryActivateSpell(source, 0, { [targetRef]: [target] })
        : await game.tryActivateSpellTrapEffect(source, { [targetRef]: [target] });
      assert.equal(result.success, false);
      assert.ok(game.player[zone].includes(source));
      assert.equal(source.isFacedown, zone === "spellTrap");
      assert.equal(game.player.graveyard.length, 0);
    });
  }

  test(`${id} human selection excludes facedown cards on a mixed board`, async t => {
    const game = setup(t);
    game.player.controllerType = "human";
    const source = runtimeCard(cardDefinition(id));
    const hidden = runtimeCard({ ...cardDefinition(1), isFacedown: true });
    const visible = runtimeCard(cardDefinition(1));
    placeFieldCards(game.player.field, hidden, visible);
    game.player.hand.push(source);
    const pending = game.tryActivateSpell(source, 0);
    for (let i = 0; i < 100 && !game.targetSelection; i++) await new Promise<void>(resolve => setImmediate(resolve));
    const session = required(game.targetSelection);
    assert.equal(required(session.requirements[0]).candidates.length, 1);
    game.handleTargetSelectionClick("player", 0, null, "field");
    assert.deepEqual(session.selections[required(session.requirements[0]).id] || [], []);
    assert.equal(game.handleTargetSelectionClick("player", 1, null, "field"), true);
    game.advanceTargetSelection();
    assert.equal((await pending).success, true);
    assert.equal(source.equippedTo, visible);
    assert.ok(game.player.spellTrap.includes(source));
  });

  for (const change of ["none", "facedown", "graveyard", "returned", "control", "source_returned"] as const) {
    test(`${id} revalidates and finalizes its Equip activation (${change})`, async t => {
      const game = setup(t);
      const source = runtimeCard(cardDefinition(id));
      const target = runtimeCard(cardDefinition(1));
      const alternative = runtimeCard(cardDefinition(1));
      const backrow = runtimeCard(cardDefinition(13), "bot");
      placeFieldCards(game.player.field, target, alternative);
      placeFieldCards(game.bot.spellTrap, backrow);
      game.player.hand.push(source);
      let moved = 0;
      game.on("card_to_grave", event => { if (event.card === source) moved++; });
      let responded = false;
      game.chainSystem.offerChainResponses = async () => {
        if (!responded) {
          responded = true;
          if (change === "facedown") target.isFacedown = true;
          if (change === "graveyard" || change === "returned") {
            await game.moveCard(target, game.player, "graveyard", { fromZone: "field", awaitEvents: true });
            if (change === "returned") await game.moveCard(target, game.player, "field", {
              fromZone: "graveyard", summonMethodOverride: "special", summonOrigin: "effect_resolution", position: "attack",
            });
          }
          if (change === "control") await game.takeControl(target, game.bot);
          if (change === "source_returned") {
            await game.moveCard(source, game.player, "hand", { fromZone: "spellTrap", awaitEvents: true });
            await game.moveCard(source, game.player, "spellTrap", { fromZone: "hand", isFacedown: false, awaitEvents: true });
          }
        }
        return { lastActivator: null, chainBuilt: game.chainSystem.chainStack.length > 0, consecutivePasses: 2, offers: 1, activations: 0 };
      };
      await game.tryActivateSpell(source, 0, { [targetRef]: [target] });
      if (change === "none") {
        assert.equal(source.equippedTo, target);
        assert.ok(game.player.spellTrap.includes(source));
        assert.equal(moved, 0);
      } else if (change === "source_returned") {
        assert.ok(game.player.spellTrap.includes(source), "old activation must not clean up a new presence");
        assert.equal(moved, 0);
      } else {
        assert.ok(game.player.graveyard.includes(source));
        assert.equal(moved, 1);
        assert.ok(game.bot.graveyard.includes(backrow), "the Equip's graveyard trigger must resolve");
        assert.ok(!source.equippedTo);
        assert.ok(!alternative.equips?.includes(source), "do not select a replacement target");
      }
    });
  }
}
