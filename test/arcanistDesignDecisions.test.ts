import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { ActionNegationContext } from "../src/core/contracts/actionRuntime.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { getTurnCardActivations } from "../src/core/game/events/activationHistory.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "ai";
  const make = (id: number, owner: Pick<typeof game.player, "id"> = game.player) => new Card(cardDefinition(id), owner.id);
  return { game, owner: game.player, opponent: game.bot, make };
}

for (const seat of ["player", "bot"] as const) {
  for (const id of [307, 314]) {
    for (const negation of ["activation", "effect"] as const) {
      test(`B08/B19 mandatory trigger preserves its existing usage policy (${seat}/${id}/${negation})`, async t => {
        const { game, make } = setup(t);
        game.turn = seat;
        const owner = game[seat], opponent = game.getOpponent(owner), source = make(id, owner);
        const target = make(306, id === 307 ? owner : opponent);
        placeFieldCards(owner.field, source);
        if (id === 307) owner.graveyard.push(target);
        else placeFieldCards(opponent.field, target);
        const effect = required(source.effects.find(entry => entry.id === (id === 307 ? "albus_arcanist_ice_recover" : "azrath_equip_halve")));
        let publications = 0;
        game.chainSystem.offerChainResponses = async () => {
          const link = game.chainSystem.chainStack.find(entry => entry.effect?.id === effect.id);
          if (link && publications++ === 0) {
            if (negation === "activation") link.activationNegated = true;
            else link.effectNegated = true;
          }
          return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
        };
        const activateEquip = async () => {
          const equip = make(301, owner);
          owner.hand.push(equip);
          const pending = game.tryActivateSpell(equip, owner.hand.indexOf(equip), { grimoire_equip_target: [source] }, { owner });
          await completeTestSelections(game, pending);
          assert.equal((await pending).success, true);
          return equip;
        };
        const firstEquip = await activateEquip();
        assert.equal(publications, 1);
        const released = id === 307 && negation === "activation";
        assert.equal(game.canUseOncePerTurn(source, owner, effect).ok, released);
        if (id === 307) assert.ok(owner.graveyard.includes(target));
        await game.moveCard(firstEquip, owner, "graveyard", { fromZone: "spellTrap", awaitEvents: true });
        await activateEquip();
        assert.equal(publications, released ? 2 : 1);
        if (released) assert.ok(owner.hand.includes(target));
      });
    }
  }

  for (const negation of ["activation", "effect"] as const) {
    test(`B17 published Arcanist Spell counts only when its activation survives (${seat}/${negation})`, async t => {
      const { game, make } = setup(t);
      game.turn = seat;
      const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
      const source = make(313, owner), ally = make(306, owner), spell = make(310, owner);
      placeFieldCards(owner.field, source, ally);
      owner.hand.push(spell);
      let window = false;
      game.chainSystem.offerChainResponses = async () => {
        const link = game.chainSystem.chainStack.find(entry => entry.card === spell);
        if (link && !window) {
          window = true;
          assert.equal(source.atk, source.baseAtk + 100, "publication precedes the response window");
          const responseContext = required(game.chainSystem.getCurrentChainActivationContext({}));
          assert.equal(responseContext.activationAttempt?.card, spell);
          await game.effectEngine.applyActions(
            [{ type: negation === "activation" ? "negate_activation" : "negate_effect" }],
            { source: make(3, opponent), player: opponent, opponent: owner,
              activationContext: { context: unsafeFixture<ActionNegationContext>(responseContext,
                "The real Chain context references this fixture's concrete Card with numeric instanceId; only its read projection is narrower.") } }, {});
          assert.equal(source.atk, source.baseAtk + (negation === "activation" ? 0 : 100),
            "the real negation handler must reconcile the continuous bonus before the original link resumes");
          assert.equal(getTurnCardActivations(game).length, negation === "activation" ? 0 : 1);
        }
        return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
      };
      const pending = game.tryActivateSpell(spell, 0, { arcanist_ice_barrier_target: [ally] }, { owner });
      await completeTestSelections(game, pending);
      await pending;
      assert.ok(window);
      assert.equal(source.atk, source.baseAtk + (negation === "activation" ? 0 : 100));
      assert.equal(getTurnCardActivations(game).length, negation === "activation" ? 0 : 1);
      assert.ok(owner.graveyard.includes(spell), "finalization remains observable after either negation");
    });
  }

  for (const controller of ["human", "ai"] as const) {
    for (const id of [307, 314]) {
      test(`B08/B19 ${id} equip trigger is mandatory but targeting remains a decision (${seat}/${controller})`, async t => {
        const { game, make } = setup(t);
        game.turn = seat;
        const owner = game[seat], opponent = game.getOpponent(owner);
        owner.controllerType = controller;
        const source = make(id, owner), equip = make(301, owner), target = make(306, id === 307 ? owner : opponent);
        placeFieldCards(owner.field, source);
        owner.hand.push(equip);
        if (id === 307) owner.graveyard.push(target);
        else placeFieldCards(opponent.field, target);
        if (controller === "human") game.autoSelector.select = () => assert.fail("Manual targets must use the broker.");
        let confirmations = 0, publications = 0;
        game.ui.showConfirmPrompt = async () => { confirmations++; return false; };
        const effectId = id === 307 ? "albus_arcanist_ice_recover" : "azrath_equip_halve";
        game.on("effect_activated", event => { if (event.effectId === effectId) publications++; });
        const pending = game.tryActivateSpell(equip, 0, { grimoire_equip_target: [source] }, { owner });
        await completeTestSelections(game, pending);
        assert.equal((await pending).success, true);
        assert.equal(publications, 1, "the imperative trigger must publish even when confirmation would return false");
        assert.equal(confirmations, 0);
        if (id === 307) { assert.ok(owner.hand.includes(target)); assert.equal(owner.graveyard.includes(target), false); }
        else assert.deepEqual([target.atk, target.def], [Math.floor((target.baseAtk - 100) / 2), Math.floor((target.baseDef - 100) / 2)]);
        assert.equal(game.canUseOncePerTurn(source, owner, required(source.effects.find(effect => effect.id === effectId))).ok, false);
      });
    }
  }

  for (const id of [307, 314]) {
    test(`B08/B19 ${id} mandatory equip trigger cannot consume usage without a legal target (${seat})`, async t => {
      const { game, make } = setup(t);
      game.turn = seat;
      const owner = game[seat], opponent = game.getOpponent(owner);
      const source = make(id, owner), equip = make(301, owner), hidden = make(306, opponent);
      placeFieldCards(owner.field, source);
      placeFieldCards(opponent.field, hidden);
      hidden.isFacedown = true;
      owner.hand.push(equip);
      game.ui.showConfirmPrompt = async () => assert.fail("No confirmation should be needed.");
      const pending = game.tryActivateSpell(equip, 0, { grimoire_equip_target: [source] }, { owner });
      await completeTestSelections(game, pending);
      assert.equal((await pending).success, true);
      assert.equal(game.canUseOncePerTurn(source, owner, required(source.effects.find(effect =>
        effect.id === (id === 307 ? "albus_arcanist_ice_recover" : "azrath_equip_halve")))).ok, true);
    });
  }

  test(`B17 Elementalist continuously counts earlier Spells from both players (${seat})`, async t => {
    const { game, make } = setup(t);
    game.turn = seat;
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const ally = make(306, owner), enemy = make(306, opponent), source = make(313, owner);
    placeFieldCards(owner.field, ally);
    placeFieldCards(opponent.field, enemy);
    const activate = async (actor: typeof owner, host: Card, id = 310) => {
      game.turn = actor.id;
      const spell = make(id, actor);
      actor.hand.push(spell);
      const targetRef = id === 310 ? "arcanist_ice_barrier_target" : "lightning_magic_lance_target";
      const pending = game.tryActivateSpell(spell, actor.hand.indexOf(spell), { [targetRef]: [host] }, { owner: actor });
      await completeTestSelections(game, pending);
      assert.equal((await pending).success, true);
    };
    await activate(owner, ally);
    await activate(opponent, enemy);
    game.turn = seat;
    owner.hand.push(source);
    await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", targetRef: "target", position: "attack" }],
      { source: ally, player: owner, opponent }, { target: [source] });
    assert.ok(owner.field.includes(source));
    assert.equal(source.atk, source.baseAtk + 200, "earlier activations must contribute on entry");
    await activate(owner, ally, 304);
    assert.equal(source.atk, source.baseAtk + 300);
    source.effectsNegated = true;
    game.effectEngine.updatePassiveBuffs();
    assert.equal(source.atk, source.baseAtk);
    source.effectsNegated = false;
    source.isFacedown = true;
    game.effectEngine.updatePassiveBuffs();
    assert.equal(source.atk, source.baseAtk);
    source.isFacedown = false;
    game.effectEngine.updatePassiveBuffs();
    assert.equal(source.atk, source.baseAtk + 300);
    await game.moveCard(source, owner, "hand", { fromZone: "field", awaitEvents: true });
    assert.equal(source.atk, source.baseAtk, "field exit clears the continuous contribution");
    await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", targetRef: "target", position: "attack" }],
      { source: ally, player: owner, opponent }, { target: [source] });
    assert.equal(source.atk, source.baseAtk + 300, "a new presence must query the same turn history");
    game.turnCounter++;
    game.effectEngine.updatePassiveBuffs();
    assert.equal(source.atk, source.baseAtk, "last turn's activations must not contribute");
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    test(`B16 equipped Elementalist publicly destroys a face-down opponent (${seat}/${controller})`, async t => {
      const { game, make } = setup(t);
      game.turn = seat;
      const owner = game[seat], opponent = game.getOpponent(owner);
      owner.controllerType = controller;
      if (controller === "human") game.autoSelector.select = () => assert.fail("Human targeting must use the selection broker.");
      const source = make(313, owner), equip = make(301, owner), enemy = make(306, opponent);
      placeFieldCards(owner.field, source);
      placeFieldCards(owner.spellTrap, equip);
      equip.equippedTo = source;
      source.equips = [equip];
      placeFieldCards(opponent.field, enemy);
      enemy.isFacedown = true;
      enemy.position = "defense";
      const hidden = required(game.getPublicState(seat).players.opponent.field[0]);
      assert.deepEqual([hidden.cardId, hidden.name, hidden.atk, hidden.def], [null, null, null, null]);
      let responses = 0;
      game.chainSystem.offerChainResponses = async () => {
        if (!game.chainSystem.chainStack.length) return { offers: 0, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
        responses++;
        assert.ok(game.chainSystem.chainStack.some(link => link.card === source));
        const declared = required(game.getPublicState(seat).players.opponent.field[0]);
        assert.deepEqual([declared.cardId, declared.name, declared.atk, declared.def], [null, null, null, null]);
        return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
      };
      const pending = game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: "elementalist_master_destroy" });
      await completeTestSelections(game, pending);
      const result = await pending;
      assert.equal(result.success, true, result.reason ?? undefined);
      assert.equal(responses, 1);
      assert.ok(opponent.graveyard.includes(enemy));
      assert.ok(owner.field.includes(source));
      assert.ok(owner.spellTrap.includes(equip));
      assert.equal(game.canUseOncePerTurn(source, owner, required(source.effects.find(effect => effect.id === "elementalist_master_destroy"))).ok, false);
    });
  }

  test(`B16 Elementalist still requires an Equip and a face-up source (${seat})`, async t => {
    const { game, make } = setup(t);
    game.turn = seat;
    const owner = game[seat], opponent = game.getOpponent(owner);
    const source = make(313, owner), enemy = make(306, opponent);
    placeFieldCards(owner.field, source);
    placeFieldCards(opponent.field, enemy);
    enemy.isFacedown = true;
    assert.equal((await game.tryActivateMonsterEffect(source, null, "field", owner,
      { effectId: "elementalist_master_destroy" })).success, false);
    const equip = make(301, owner);
    placeFieldCards(owner.spellTrap, equip);
    equip.equippedTo = source;
    source.equips = [equip];
    source.isFacedown = true;
    assert.equal((await game.tryActivateMonsterEffect(source, null, "field", owner,
      { effectId: "elementalist_master_destroy" })).success, false);
    assert.ok(opponent.field.includes(enemy));
    assert.equal(game.canUseOncePerTurn(source, owner, required(source.effects.find(effect => effect.id === "elementalist_master_destroy"))).ok, true);
  });

  for (const id of [303, 313]) {
    for (const change of ["face_down", "leave_return"] as const) {
      test(`B06/B16 ${id} revalidates ${change} without substituting its target (${seat})`, async t => {
        const { game, make } = setup(t);
        game.turn = seat;
        const owner = game[seat], opponent = game.getOpponent(owner);
        const source = make(id, owner), ally = make(306, owner), enemy = make(306, opponent), other = make(306, opponent);
        placeFieldCards(opponent.field, enemy, other);
        if (id === 303) { owner.hand.push(source); placeFieldCards(owner.field, ally); }
        else {
          placeFieldCards(owner.field, source);
          const equip = make(301, owner);
          placeFieldCards(owner.spellTrap, equip);
          equip.equippedTo = source;
          source.equips = [equip];
        }
        let changed = false;
        const version = enemy.locationVersion;
        game.chainSystem.offerChainResponses = async () => {
          if (!changed && game.chainSystem.chainStack.some(link => link.card === source)) {
            changed = true;
            if (change === "face_down") {
              enemy.isFacedown = true;
              enemy.position = "defense";
              assert.equal(enemy.locationVersion, version);
            } else {
              await game.moveCard(enemy, opponent, "hand", { fromZone: "field", awaitEvents: true });
              await game.moveCard(enemy, opponent, "field", { fromZone: "hand", summonOrigin: "effect_resolution", position: "defense" });
              assert.notEqual(enemy.locationVersion, version);
            }
          }
          return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
        };
        const pending = id === 303
          ? game.tryActivateSpell(source, 0, { crimson_magic_self_target: [ally], crimson_magic_opponent_target: [enemy] }, { owner })
          : game.tryActivateMonsterEffect(source, { elementalist_destroy_target: [enemy] }, "field", owner, { effectId: "elementalist_master_destroy" });
        await completeTestSelections(game, pending);
        await pending;
        assert.equal(changed, true);
        assert.ok(opponent.field.includes(other), "another valid monster must never be selected during resolution");
        assert.equal(opponent.graveyard.includes(enemy), change === "face_down");
        assert.equal(opponent.field.includes(enemy), change === "leave_return");
      });
    }
  }

  for (const startsDown of [true, false]) {
    test(`B16 Azrath rejects a face-down target ${startsDown ? "at declaration" : "after responses"} (${seat})`, async t => {
      const { game, make } = setup(t);
      game.turn = seat;
      const owner = game[seat], opponent = game.getOpponent(owner);
      owner.controllerType = "human";
      game.ui.showConfirmPrompt = async () => true;
      const source = make(314, owner), equip = make(301, owner), enemy = make(306, opponent);
      placeFieldCards(owner.field, source);
      placeFieldCards(opponent.field, enemy);
      enemy.isFacedown = startsDown;
      owner.hand.push(equip);
      let halveWindow = false;
      let beforeHalve = [enemy.atk, enemy.def];
      game.chainSystem.offerChainResponses = async () => {
        if (game.chainSystem.chainStack.some(link => link.effect?.id === "azrath_equip_halve")) {
          halveWindow = true;
          beforeHalve = [enemy.atk, enemy.def];
          enemy.isFacedown = true;
        }
        return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
      };
      const pending = game.tryActivateSpell(equip, 0, { grimoire_equip_target: [source] }, { owner });
      await completeTestSelections(game, pending);
      assert.equal((await pending).success, true);
      assert.equal(halveWindow, !startsDown);
      assert.deepEqual([enemy.atk, enemy.def], beforeHalve);
      assert.ok(opponent.field.includes(enemy));
    });
  }
}

test("Albus summons its own hand presence without activating an effect or selecting a cost", async t => {
  const { game, owner, make } = setup(t);
  const albus = make(307), second = make(307), ally = make(306);
  owner.hand.push(albus, second);
  placeFieldCards(owner.field, ally);
  owner.controllerType = "human";
  const chain = t.mock.method(game.chainSystem, "addToChain");
  let activations = 0;
  game.on("effect_activated", () => { activations++; });
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, true);
  const result = await game.performHandSummonProcedure(albus, owner, { position: "defense" });
  assert.equal(result.success, true);
  assert.equal(game.targetSelection, null);
  assert.equal(chain.mock.callCount(), 0);
  assert.equal(activations, 0);
  assert.ok(owner.field.includes(albus));
  assert.ok(owner.hand.includes(second));
  assert.equal(albus.position, "defense");
  assert.equal(game.lastSummonTransaction?.summonOrigin, "procedure");
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, false);
  assert.equal(game.materialDuelStats.player.effectActivationsByMaterialId.get(307) ?? 0, 0);
  assert.equal(game.canUseOncePerTurn(albus, owner,
    required(albus.effects.find(effect => effect.id === "albus_arcanist_ice_recover"))).ok, true);
  game.turnCounter++;
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, true);
});

for (const seat of ["player", "bot"] as const) {
  test(`Albus consumes its procedure limit only after success and can retry after real summon negation (${seat})`, async t => {
    const { game, make } = setup(t);
    game.turn = seat;
    const owner = game[seat], opponent = game.getOpponent(owner);
    const first = make(307, owner), second = make(307, owner), third = make(307, owner);
    const ally = make(306, owner), negator = make(275, opponent);
    owner.hand.push(first, second, third);
    placeFieldCards(owner.field, ally);
    placeFieldCards(opponent.field, negator);
    opponent.controllerType = "human";
    let chosen = false, availableDuringAttempt: boolean | undefined;
    let albusActivations = 0;
    game.on("effect_activated", event => { if (event.card?.id === 307) albusActivations++; });
    game.ui.showChainResponseModal = async (candidates, context) => {
      const response = candidates.find(candidate => candidate.card === negator);
      if (response && !chosen) {
        assert.equal(context?.type, "summon_attempt");
        availableDuringAttempt = game.canUseOncePerTurn(second, owner, required(second.handSummonProcedure)).ok;
        chosen = true;
        return response;
      }
      return null;
    };
    const denied = await game.performHandSummonProcedure(first, owner, { position: "attack" });
    assert.equal(chosen, true, "the opponent must negate through a real summon-response Chain");
    assert.equal(denied.summonNegated, true);
    assert.equal(denied.success, false);
    assert.equal(availableDuringAttempt, true, "the attempt must not consume the name limit");
    assert.ok(owner.graveyard.includes(first));
    assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, true);
    const retried = await game.performHandSummonProcedure(second, owner, { position: "defense" });
    assert.equal(retried.success, true);
    assert.ok(owner.field.includes(second));
    assert.equal(game.canSummonFromHandByProcedure(third, owner).ok, false);
    assert.equal(albusActivations, 0);
    assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(307) ?? 0, 0);
    game.turnCounter++;
    assert.equal(game.canSummonFromHandByProcedure(third, owner).ok, true);
  });
}

test("Albus procedure requires a face-up controlled Arcanist and a free field slot", t => {
  const { game, owner, make } = setup(t);
  const albus = make(307), ally = make(306);
  owner.hand.push(albus);
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, false);
  placeFieldCards(owner.field, ally);
  ally.isFacedown = true;
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, false);
  ally.isFacedown = false;
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, true);
  placeFieldCards(owner.field, make(306), make(306), make(306), make(306));
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, false);
});

for (const changed of ["source_presence", "condition"] as const) {
  test(`Albus revalidates ${changed} after position selection`, async t => {
    const { game, owner, make } = setup(t);
    const albus = make(307), ally = make(306);
    owner.hand.push(albus);
    placeFieldCards(owner.field, ally);
    t.mock.method(game.effectEngine, "chooseSpecialSummonPosition", async () => {
      if (changed === "condition") ally.isFacedown = true;
      else {
        await game.moveCard(albus, owner, "graveyard", { fromZone: "hand" });
        await game.moveCard(albus, owner, "hand", { fromZone: "graveyard" });
      }
      return "attack" as const;
    });
    const result = await game.performHandSummonProcedure(albus, owner);
    assert.equal(result.success, false);
    assert.ok(owner.hand.includes(albus));
    assert.equal(game.canUseOncePerTurn(albus, owner, required(albus.handSummonProcedure)).ok, true);
  });
}

test("Elementalist has immediate continuous protection that suspends under negation", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(313), destruction = make(303, opponent);
  placeFieldCards(owner.field, source);
  const options = { cause: "effect", sourceCard: destruction, sourcePlayer: opponent } as const;
  const protectedResult = await game.destroyCard(source, options);
  assert.ok("destroyed" in protectedResult);
  assert.equal(protectedResult.destroyed, false);
  source.effectsNegated = true;
  const negatedResult = await game.destroyCard(source, options);
  assert.ok("destroyed" in negatedResult);
  assert.equal(negatedResult.destroyed, true);
});

test("Elementalist destruction is an equipped ignition with independent per-copy limits", async t => {
  const { game, owner, opponent, make } = setup(t);
  const first = make(313), second = make(313), target = make(306, opponent), other = make(306, opponent);
  placeFieldCards(owner.field, first, second);
  placeFieldCards(opponent.field, target, other);
  const effect = required(first.effects.find(entry => entry.id === "elementalist_master_destroy"));
  assert.equal(effect.timing, "ignition");
  assert.equal(effect.oncePerTurnScope, "card");
  assert.equal(game.effectEngine.evaluateConditions(effect.conditions, { source: first, player: owner, opponent }).ok, false);
  const equip = make(301);
  placeFieldCards(owner.spellTrap, equip);
  equip.equippedTo = first;
  first.equips = [equip];
  const result = await game.tryActivateMonsterEffect(first, { elementalist_destroy_target: [target] }, "field", owner,
    { effectId: effect.id });
  assert.equal(result.success, true);
  assert.ok(opponent.graveyard.includes(target));
  assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true);
  assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false);
});

test("Apprentice aura updates when its equip is removed and applies to new allies", t => {
  const { game, owner, make } = setup(t);
  const apprentice = make(302), ally = make(306), equip = make(301);
  placeFieldCards(owner.field, apprentice, ally);
  placeFieldCards(owner.spellTrap, equip);
  equip.equippedTo = apprentice;
  apprentice.equips = [equip];
  game.effectEngine.updatePassiveBuffs();
  assert.equal(ally.atk, ally.baseAtk + 300);
  const newcomer = make(307);
  placeFieldCards(owner.field, newcomer);
  game.effectEngine.updatePassiveBuffs();
  assert.equal(newcomer.atk, newcomer.baseAtk + 300);
  apprentice.equips = [];
  equip.equippedTo = null;
  game.effectEngine.updatePassiveBuffs();
  assert.equal(ally.atk, ally.baseAtk);
  assert.equal(newcomer.atk, newcomer.baseAtk);
});

test("Lightning Lance attack boost expires at turn end", async t => {
  const { game, owner, make } = setup(t);
  const target = make(306), lance = make(304);
  placeFieldCards(owner.field, target);
  owner.hand.push(lance);
  assert.equal((await game.tryActivateSpell(lance, 0, { lightning_magic_lance_target: [target] }, { owner })).success, true);
  assert.equal(target.atk, target.baseAtk + 500);
  cleanupTempBoosts(owner);
  assert.equal(target.atk, target.baseAtk);
});

test("Azrath debuffs only monsters present for each Arcanist Spell activation", async t => {
  const { game, owner, opponent, make } = setup(t);
  const azrath = make(314), ally = make(306), first = make(306, opponent), later = make(306, opponent);
  placeFieldCards(owner.field, azrath, ally);
  placeFieldCards(opponent.field, first);
  const activate = async () => {
    const lance = make(304);
    owner.hand.push(lance);
    assert.equal((await game.tryActivateSpell(lance, owner.hand.indexOf(lance), { lightning_magic_lance_target: [ally] }, { owner })).success, true);
  };
  await activate();
  assert.deepEqual([first.atk, first.def], [first.baseAtk - 100, first.baseDef - 100]);
  placeFieldCards(opponent.field, later);
  game.effectEngine.updatePassiveBuffs();
  assert.deepEqual([later.atk, later.def], [later.baseAtk, later.baseDef]);
  cleanupTempBoosts(opponent);
  assert.deepEqual([first.atk, first.def], [first.baseAtk, first.baseDef]);
});

