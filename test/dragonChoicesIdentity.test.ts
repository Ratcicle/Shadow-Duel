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

const softOptEffects = [
  [257, "majestic_silver_dragon_position_switch"],
  [258, "darkness_dragon_negate"],
  [260, "hellkite_dragon_field_send_revive"],
  [262, "dragon_peak_ignite_summon"],
  [269, "boneflame_dragon_gy_revive"],
  [272, "mist_extreme_dragon_bounce"],
  [274, "forest_extreme_dragon_lp_gain_boost"],
] as const;

for (const seat of ["player", "bot"] as const) {
  test(`Bahamut negates again only after a fresh field presence (${seat})`, async t => {
    const { game, owner, opponent, make } = setup(t, seat);
    const source = make(275);
    placeFieldCards(owner.field, source);
    game.chainSystem.botChooseChainResponse = async (_player, candidates) =>
      candidates.find(candidate => candidate.card === source) || null;
    let negations = 0;
    game.on("effect_activated", event => { if (event.effectId === "supreme_bahamut_dragon_negate") negations++; });
    const activateOpponentSpell = async () => {
      const spell = make(277, opponent);
      opponent.hand.push(spell);
      game.turn = opponent.id;
      await game.tryActivateSpell(spell, opponent.hand.indexOf(spell), null, { owner: opponent });
      return spell;
    };
    const firstSpell = await activateOpponentSpell();
    assert.equal(negations, 1);
    assert.ok(opponent.graveyard.includes(firstSpell));
    const secondSpell = await activateOpponentSpell();
    assert.equal(negations, 1, "the same presence cannot respond again");
    assert.ok(opponent.spellTrap.includes(secondSpell));
    // Model recycling through public zone transitions, then execute the actual Fusion procedure.
    await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
    await game.moveCard(source, owner, "extraDeck", { fromZone: "graveyard" });
    await game.moveCard(secondSpell, opponent, "graveyard", { fromZone: "spellTrap" });
    const materials = [270, 271, 272, 273, 274].map(id => make(id));
    owner.graveyard.push(...materials);
    game.turn = owner.id;
    const summoned = await game.performExtraDeckSummonProcedure(source, owner, { materials, position: "attack" });
    assert.equal(summoned.success, true, summoned.reason || undefined);
    assert.equal(owner.banished.length, 5);
    const thirdSpell = await activateOpponentSpell();
    assert.equal(negations, 2, "the newly summoned presence has an independent use");
    assert.ok(opponent.graveyard.includes(thirdSpell));
    assert.equal(game.turnCounter, 4, "no turn reset grants the second use");
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const [id, effectId] of softOptEffects) {
    test(`${effectId} tracks each copy and resets on field exit or a new turn (${seat})`, async t => {
      const { game, owner, opponent, make } = setup(t, seat);
      const first = make(id), second = make(id);
      const effect = required(first.effects.find(entry => entry.id === effectId));
      if (id === 262) owner.fieldSpell = first;
      else if (id === 269) owner.graveyard.push(first);
      else placeFieldCards(owner.field, first);
      game.markOncePerTurnUsed(first, owner, effect);
      assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false);
      assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true, "another copy has an independent use");
      if (id === 269) {
        await game.moveCard(first, owner, "banished", { fromZone: "graveyard" });
        await game.moveCard(first, owner, "graveyard", { fromZone: "banished" });
        assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false, "leaving the GY does not reset the copy");
        const entered = await game.moveCard(first, owner, "field", { fromZone: "graveyard", isFacedown: false,
          summonMethod: "special", summonOrigin: "effect_resolution", position: "attack" });
        assert.equal(entered.success, true, entered.reason || undefined);
      } else {
        const zone = id === 262 ? "fieldSpell" : "field";
        if (id === 262) await game.moveCard(first, opponent, "fieldSpell", { fromZone: "fieldSpell" });
        else await game.moveCard(first, opponent, "field", { fromZone: "field" });
        assert.equal(game.canUseOncePerTurn(first, opponent, effect).ok, false, "control changes retain the same use");
        await game.moveCard(first, owner, "graveyard", { fromZone: zone });
      }
      if (id === 269) await game.moveCard(first, owner, "graveyard", { fromZone: "field" });
      assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, true, "a field departure resets soft OPT");
      game.markOncePerTurnUsed(first, owner, effect);
      game.turnCounter++;
      assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, true);
    });

    for (const outcome of ["activation_negated", "effect_negated"] as const) {
      test(`${effectId} keeps activate policy when ${outcome} (${seat})`, t => {
        const { game, owner, make } = setup(t, seat);
        const first = make(id), second = make(id);
        const effect = required(first.effects.find(entry => entry.id === effectId));
        const input = { card: first, player: owner, effect };
        const reservation = required(game.reserveEffectUsage(input));
        assert.ok("status" in reservation);
        assert.equal(game.checkEffectUsage(input).ok, false);
        assert.equal(game.checkEffectUsage({ ...input, card: second }).ok, true);
        game.settleEffectUsage(reservation, { activationNegated: outcome === "activation_negated" });
        assert.equal(game.checkEffectUsage(input).ok, outcome === "activation_negated");
        assert.equal(game.checkEffectUsage({ ...input, card: second }).ok, true);
      });
    }
  }

  test(`Majestic activates both copies but cannot repeat one presence (${seat})`, async t => {
    const { game, owner, opponent, make } = setup(t, seat);
    const first = make(257), second = make(257), target = make(252, opponent);
    placeFieldCards(owner.field, first, second); placeFieldCards(opponent.field, target);
    const activate = (source: Card) => game.tryActivateMonsterEffect(source,
      { majestic_position_target: [target] }, "field", owner, { effectId: "majestic_silver_dragon_position_switch" });
    assert.equal((await activate(first)).success, true);
    assert.equal(target.position, "defense");
    assert.equal((await activate(first)).ok, false);
    assert.equal(target.position, "defense");
    assert.equal((await activate(second)).success, true);
    assert.equal(target.position, "attack");
  });

  for (const [id, effectId] of softOptEffects) {
    if (id === 257) continue;
    test(`${effectId} activates both copies through the real Chain (${seat})`, async t => {
      const { game, owner, opponent, make } = setup(t, seat);
      const first = make(id), second = make(id), target = make(252, opponent), otherTarget = make(254, opponent);
      const firstCost = make(id === 258 ? 21 : 252), secondCost = make(id === 258 ? 21 : 254);
      placeFieldCards(opponent.field, target, otherTarget);
      if (id === 262) { owner.fieldSpell = first; first.addCounter("dragon_peak", 7); }
      else if (id === 269) { owner.graveyard.push(first, second); placeFieldCards(owner.field, firstCost, secondCost); }
      else if (id === 272 || id === 274) placeFieldCards(owner.field, first);
      else placeFieldCards(owner.field, first, second);
      if (id === 258) owner.hand.push(firstCost, secondCost);
      if (id === 260 || id === 262) owner.graveyard.push(make(255), make(256));
      if (id === 274) owner.lpGainedThisTurn = 300;
      let publications = 0;
      game.on("effect_activated", event => { if (event.effectId === effectId) publications++; });
      const activate = async (source: Card, chosen: Card, cost: Card) => {
        if (id === 262) return game.activateFieldSpellEffect(source);
        if (id === 274) {
          const context = { type: "main_phase_action" as const, event: "main_phase_action", player: owner,
            triggerPlayer: owner, openState: true, legalWindow: true };
          const candidate = game.chainSystem.getActivatableCardsInChain(owner, context)
            .find(entry => entry.card === source && entry.effectId === effectId);
          if (!candidate) return { ok: false, success: false };
          const preparation = await game.chainSystem.prepareChainResponse(candidate, owner, context);
          if (!preparation.success) return { ...preparation, ok: false };
          return game.chainSystem.openActivationChain(required(preparation.preparedActivation));
        }
        const selections = id === 258 ? { darkness_dragon_discard_cost: [cost], darkness_dragon_negate_target: [chosen] }
          : id === 269 ? { boneflame_cost_target: [cost] }
          : id === 272 ? { mist_bounce_target: [chosen] } : {};
        return game.tryActivateMonsterEffect(source, selections, id === 269 ? "graveyard" : "field", owner, { effectId });
      };
      await completeTestSelections(game, activate(first, target, firstCost));
      assert.equal(publications, 1, "the first copy publishes its Chain link");
      if (id === 258 || id === 272 || id === 274) {
        const repeat = await activate(first, otherTarget, secondCost);
        assert.equal(repeat?.ok, false, "the same presence cannot activate again");
      }
      if (id === 262) { owner.fieldSpell = second; second.addCounter("dragon_peak", 7); }
      else if (id === 272 || id === 274) {
        await game.moveCard(first, owner, "graveyard", { fromZone: "field" });
        placeFieldCards(owner.field, second);
      }
      await completeTestSelections(game, activate(second, otherTarget, secondCost));
      assert.equal(publications, 2, "the second copy publishes an independent Chain link");
      if (id === 258) { assert.equal(owner.hand.length, 0); assert.equal(otherTarget.effectsNegated, true); }
      if (id === 260 || id === 262) { assert.ok(owner.graveyard.includes(first)); assert.ok(owner.graveyard.includes(second)); }
      if (id === 269) { assert.ok(owner.field.includes(first)); assert.ok(owner.field.includes(second)); }
      if (id === 272) { assert.ok(opponent.hand.includes(target)); assert.ok(opponent.hand.includes(otherTarget)); }
      if (id === 274) assert.equal(second.atk, required(cardDefinition(274).atk) + 300);
    });
  }

  for (const zone of ["field", "spellTrap", "fieldSpell"] as const) {
    for (const facedown of zone === "fieldSpell" ? [false] : [false, true]) {
      test(`Mist returns an opposing ${facedown ? "set" : "face-up"} ${zone} card (${seat})`, async t => {
        const { game, owner, opponent, make } = setup(t, seat);
        const source = make(272), target = make(zone === "field" ? 252 : zone === "spellTrap" ? 261 : 262, opponent);
        target.isFacedown = facedown;
        placeFieldCards(owner.field, source);
        if (zone === "fieldSpell") opponent.fieldSpell = target;
        else placeFieldCards(opponent[zone], target);
        const result = await game.tryActivateMonsterEffect(source, { mist_bounce_target: [target] }, "field", owner,
          { effectId: "mist_extreme_dragon_bounce" });
        assert.equal(result.success, true, result.reason || undefined);
        assert.ok(opponent.hand.includes(target));
      });
    }
  }
}

for (const negation of ["activation", "effect"] as const) {
  test(`Majestic's real Chain ${negation} negation preserves the per-copy activate policy`, async t => {
    const { game, owner, opponent, make } = setup(t);
    const source = make(257), second = make(257), target = make(252, opponent);
    placeFieldCards(owner.field, source, second); placeFieldCards(opponent.field, target);
    const effect = required(source.effects.find(entry => entry.id === "majestic_silver_dragon_position_switch"));
    let negated = false;
    game.chainSystem.offerChainResponses = async () => {
      const link = game.chainSystem.getLastChainLink();
      if (link?.effect?.id === effect.id && !negated) {
        negated = true;
        if (negation === "activation") link.activationNegated = true;
        else link.effectNegated = true;
      }
      return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
    };
    const activate = (card: Card) => game.tryActivateMonsterEffect(card, { majestic_position_target: [target] },
      "field", owner, { effectId: effect.id });
    await activate(source);
    assert.ok(negated); assert.equal(target.position, "attack");
    assert.equal(game.canUseOncePerTurn(source, owner, effect).ok, negation === "activation");
    assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true);
    const retry = await activate(source);
    assert.equal(retry.success, negation === "activation");
    assert.equal((await activate(second)).success, true);
  });
}

test("Mist keeps a target that turns face-down during the real Chain", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(272), target = make(252, opponent);
  placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
  game.chainSystem.offerChainResponses = async () => {
    target.isFacedown = true;
    return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
  };
  await game.tryActivateMonsterEffect(source, { mist_bounce_target: [target] }, "field", owner,
    { effectId: "mist_extreme_dragon_bounce" });
  assert.ok(opponent.hand.includes(target));
});

test("a negated Majestic source consumes its use without changing the target", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(257), target = make(252, opponent);
  source.effectsNegated = true;
  placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
  await game.tryActivateMonsterEffect(source, { majestic_position_target: [target] }, "field", owner,
    { effectId: "majestic_silver_dragon_position_switch" });
  assert.equal(target.position, "attack");
  assert.equal(game.canUseOncePerTurn(source, owner, required(source.effects[0])).ok, false);
});

for (const invalid of ["facedown_source", "own_target", "hand_target", "stale_target"] as const) {
  test(`Mist rejects ${invalid} without choosing another card`, async t => {
    const { game, owner, opponent, make } = setup(t);
    const source = make(272), targetOwner = invalid === "own_target" ? owner : opponent;
    const target = make(252, targetOwner), alternate = make(254, opponent);
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, alternate);
    if (invalid === "hand_target") targetOwner.hand.push(target);
    else placeFieldCards(targetOwner.field, target);
    if (invalid === "facedown_source") source.isFacedown = true;
    if (invalid === "stale_target") {
      game.chainSystem.offerChainResponses = async () => {
        await game.moveCard(target, opponent, "graveyard", { fromZone: "field" });
        await game.moveCard(target, opponent, "field", { fromZone: "graveyard", isFacedown: false,
          summonOrigin: "effect_resolution", summonMethod: "special", position: "attack" });
        return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
      };
    }
    const result = await game.tryActivateMonsterEffect(source, { mist_bounce_target: [target] }, "field", owner,
      { effectId: "mist_extreme_dragon_bounce" });
    if (invalid !== "stale_target") assert.equal(result.ok, false);
    assert.ok(opponent.field.includes(alternate));
    assert.equal(opponent.hand.includes(alternate), false);
    assert.equal(targetOwner.hand.includes(target), invalid === "hand_target");
  });
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
    placeFieldCards(opponent.spellTrap, trap);
    trap.isFacedown = true;
    trap.turnSetOn = trap.setTurn = 1;
    game.chainSystem.botChooseChainResponse = async (_player, candidates) => {
      const candidate = candidates.find(candidate => candidate.card === trap);
      return candidate ? { ...candidate, context: { ...candidate.context, activationContext: {
        ...candidate.context.activationContext,
        decisions: { specialSummons: { [required(candidate.effect?.id)]: [replacement.instanceId] } },
      },
      } } : null;
    };
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

for (const seat of ["player", "bot"] as const) for (const event of ["attack", "effect"] as const) {
  for (const scenario of ["self", "lowered", "raised", "full", "stale", "negated"] as const) {
    test(`Sanctuary resolves its current hand choice: ${scenario}, ${event} (${seat})`, async t => {
      const { game, owner, opponent, make } = setup(t, seat);
      const trap = make(268), dragon = make(254), attacker = make(257, opponent);
      const baseLevel = dragon.level;
      placeFieldCards(owner.field, dragon); placeFieldCards(opponent.field, attacker);
      placeFieldCards(owner.spellTrap, trap);
      trap.isFacedown = true; trap.turnSetOn = trap.setTurn = 1;
      if (scenario === "lowered" || scenario === "raised") {
        dragon.originalLevel = dragon.level;
        dragon.level = scenario === "lowered" ? 1 : 9;
        owner.hand.push(make(251)); // Level 5 is excluded after Grey returns to Level 4.
      }
      if (scenario === "full") placeFieldCards(owner.field, ...Array.from({ length: 4 }, () => make(255)));
      let summons = 0, publishedTargets = 0, responsesDuringReturn = 0;
      let returnInProgress = false;
      const activations: { inField: boolean; version: number; isTrapLink: boolean }[] = [];
      const choices: { inHand: boolean; level: number | undefined }[] = [];
      const presence = dragon.locationVersion;
      game.on("effect_activated", async payload => {
        if (payload.sourceCard !== trap) return;
        const link = required(game.chainSystem.getLastChainLink());
        activations.push({ inField: owner.field.includes(dragon), version: dragon.locationVersion,
          isTrapLink: link.card === trap });
        if (scenario === "stale") {
          await game.moveCard(dragon, owner, "graveyard", { fromZone: "field" });
          await game.moveCard(dragon, owner, "field", { fromZone: "graveyard", summonMethod: "special",
            summonOrigin: "effect_resolution", isFacedown: false, position: "attack" });
        }
        if (scenario === "negated") link.effectNegated = true;
      });
      game.on("after_summon", payload => { if (payload.card === dragon) { summons++; returnInProgress = false; } });
      game.on("effect_targeted", payload => { if (payload.sourceCard === trap) publishedTargets++; });
      game.on("card_moved", payload => { if (payload.card === dragon && payload.toZone === "hand") returnInProgress = true; });
      game.on("decision_made", decision => {
        if (returnInProgress && decision.kind === "chain_response") responsesDuringReturn++;
        const value = decision.value;
        if (decision.kind === "choice" && value && typeof value === "object" && "selections" in value &&
            value.selections && typeof value.selections === "object" && "replacement" in value.selections) {
          choices.push({ inHand: owner.hand.includes(dragon), level: dragon.level });
        }
      });
      game.chainSystem.botChooseChainResponse = async (_player, candidates) =>
        candidates.find(candidate => candidate.card === trap) || null;
      game.turn = opponent.id;
      if (event === "attack") {
        game.phase = "battle"; game.battleStep = "battle";
        await game.resolveCombat(attacker, dragon);
      } else {
        await game.tryActivateMonsterEffect(attacker, { majestic_position_target: [dragon] }, "field", opponent,
          { effectId: "majestic_silver_dragon_position_switch" });
      }
      assert.deepEqual(activations, [{ inField: true, version: presence, isTrapLink: true }],
        "the Dragon stays in the field through activation");
      const resolves = scenario !== "stale" && scenario !== "negated";
      assert.deepEqual(choices, resolves ? [{ inHand: true, level: baseLevel }] : [],
        "the choice sees the Dragon's level after returning to hand");
      assert.equal(summons, resolves ? 1 : scenario === "stale" ? 1 : 0);
      assert.equal(publishedTargets, 0, "Sanctuary references the attacked/targeted Dragon without declaring a new target");
      assert.equal(responsesDuringReturn, 0, "return and summon share a single resolution");
      if (resolves) assert.ok(owner.field.includes(dragon), "the returned Dragon can be chosen again");
    });
  }
}

for (const seat of ["player", "bot"] as const) {
  for (const destination of ["extraDeck", "banished"] as const) {
    test(`Sanctuary rejects a return redirected to ${destination} (${seat})`, async t => {
      const { game, owner, opponent, make } = setup(t, seat);
      const source = make(268), dragon = make(destination === "extraDeck" ? 253 : 254);
      if (destination === "banished") dragon.banishWhenLeavesField = true;
      placeFieldCards(owner.spellTrap, source); placeFieldCards(owner.field, dragon);
      const substitute = make(255); owner.hand.push(substitute);
      const effect = required(source.effects[0]);
      const context = { source, player: owner, opponent, effect, defender: dragon };
      assert.equal(game.effectEngine.checkActionPreviewRequirements(required(effect.actions), context).ok, false);
      // If the redirect appears after activation, resolution still cannot summon.
      const result = await game.effectEngine.applyActions(required(effect.actions), context, { returning: [dragon] });
      assert.equal(result.success, false);
      assert.ok(owner[destination].includes(dragon));
      assert.ok(owner.hand.includes(substitute));
      assert.equal(owner.field.length, 0);
    });
  }

  test(`Sanctuary preview returns a controlled Dragon to its original owner's hand (${seat})`, async t => {
    const { game, owner, opponent, make } = setup(t, seat);
    const source = make(268), dragon = make(254, opponent);
    placeFieldCards(owner.spellTrap, source); placeFieldCards(opponent.field, dragon);
    assert.equal((await game.takeControl(dragon, owner)).success, true);
    const effect = required(source.effects[0]);
    const context = { source, player: owner, opponent, effect, defender: dragon };
    assert.equal(game.effectEngine.checkActionPreviewRequirements(required(effect.actions), context).ok, false,
      "a card returning to the opponent's hand cannot fill our summon requirement");
    owner.hand.push(make(255));
    assert.equal(game.effectEngine.checkActionPreviewRequirements(required(effect.actions), context).ok, true);
    assert.equal(await game.effectEngine.applyActions(required(effect.actions), context, { returning: [dragon] }).then(r => r.success), true);
    assert.ok(opponent.hand.includes(dragon));
    assert.equal(owner.field[0]?.id, 255);
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
