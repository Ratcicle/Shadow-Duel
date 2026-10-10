import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required, chainSelections } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { createCanonicalStateSnapshot } from "../src/core/game/replay/canonical.js";
import { applyNamedStatChange, expireFaceupStatBuffs } from "../src/core/effects/actions/stats.js";

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = game.bot.controllerType = "human";
  game.ui.showChainResponseModal = async () => null;
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  const make = (id: number) => new Card(cardDefinition(id), owner.id);
  const monster = (atk = 2400) => new Card({ id: 999701, name: "Stat target", cardKind: "monster", type: "Dragon", archetype: "Shadow-Heart", atk, def: 2000, level: 4, effects: [] }, opponent.id);
  return { game, owner, opponent, make, monster };
}

for (const seat of ["player", "bot"] as const) {
  for (const invalid of ["defense", "removed_before_declaration"] as const) {
    test(`invalid direct attack does not create history (${seat}, ${invalid})`, async t => {
      const { game, owner, make } = setup(t, seat);
      const attacker = make(111); placeFieldCards(owner.field, attacker);
      game.phase = "battle"; game.battleStep = "battle";
      if (invalid === "defense") attacker.position = "defense";
      else game.checkAndOfferTraps = async () => {
        if (owner.field.includes(attacker)) await game.moveCard(attacker, owner, "hand", { fromZone: "field" });
        return { ok: true };
      };
      await game.resolveCombat(attacker, null);
      assert.equal(owner.directAttacksDeclaredThisTurn, 0);
    });
  }
  for (const negated of [false, true]) {
    test(`Rage rejects an earlier direct declaration even when negated (${seat}, ${negated})`, async t => {
      const { game, owner, make } = setup(t, seat);
      const attacker = make(111), rage = make(112);
      placeFieldCards(owner.field, attacker); owner.hand.push(rage);
      game.phase = "battle"; game.battleStep = "battle";
      game.on("attack_declared", () => { if (negated) game.lastAttackNegated = true; });
      assert.equal(required(await game.resolveCombat(attacker, null)).ok, true);
      game.phase = "main2";
      const result = await game.tryActivateSpell(rage, 0, { rage_dragon_target: [attacker] }, { owner });
      assert.equal(result.success, false);
      assert.ok(owner.hand.includes(rage));
    });
  }

  test(`Rage commits the restriction before responses (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const attacker = make(111), rage = make(112);
    placeFieldCards(owner.field, attacker); owner.hand.push(rage);
    let response = false;
    game.chainSystem.offerChainResponses = async () => {
      response = true;
      assert.equal(owner.forbidDirectAttacksThisTurn, true);
      const link = required(game.chainSystem.getLastChainLink());
      game.chainSystem.markChainLinkEffectNegated(link.linkId);
      return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
    };
    await game.tryActivateSpell(rage, 0, { rage_dragon_target: [attacker] }, { owner });
    assert.equal(response, true);
    assert.equal(owner.forbidDirectAttacksThisTurn, true);
    assert.equal(attacker.atk, cardDefinition(111).atk);
  });

  for (const atk of [600, 2500]) {
    test(`Purge permanent delta clears on field exit (${seat}, ${atk})`, async t => {
      const { game, owner, opponent, make, monster } = setup(t, seat);
      const source = make(103), cost = make(105), target = monster(atk);
      owner.hand.push(source, cost); placeFieldCards(opponent.field, target);
      await game.tryActivateSpell(source, 0, { purge_discard: [cost], purge_target_monster: [target] }, { owner });
      assert.equal(target.atk, Math.max(0, atk - 1000));
      cleanupTempBoosts(opponent);
      assert.equal(target.atk, Math.max(0, atk - 1000));
      await game.moveCard(target, opponent, "hand", { fromZone: "field" });
      assert.equal(target.atk, atk);
      assert.equal(game.temporaryEventEffects.length, 0);
    });
  }

  test(`Purge overlapping a temporary bonus restores only its surviving delta (${seat})`, async t => {
    const { game, owner, opponent, make, monster } = setup(t, seat);
    const source = make(103), target = monster(600);
    placeFieldCards(opponent.field, target);
    const context = { player: owner, opponent, source };
    await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 300 }], context, { chosen: [target] });
    await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: -1000, permanent: true }], context, { chosen: [target] });
    assert.equal(target.atk, 0);
    cleanupTempBoosts(opponent);
    assert.equal(target.atk, 0);
    await game.moveCard(target, opponent, "hand", { fromZone: "field" });
    assert.equal(target.atk, 600);
  });

  for (const modifier of ["valley", "while_faceup"] as const) {
    test(`Purge overlapping a persistent bonus survives its refresh and removal (${seat}, ${modifier})`, async t => {
      const { game, owner, opponent, make, monster } = setup(t, seat);
      const source = make(103), target = monster(600);
      placeFieldCards(opponent.field, target);
      const valley = new Card(cardDefinition(115), opponent.id);
      if (modifier === "valley") { opponent.fieldSpell = valley; game.updateBoard(); }
      else {
        applyNamedStatChange(target, "faceup_bonus", 300);
        required(target.permanentBuffsBySource?.faceup_bonus).duration = "while_faceup";
      }
      assert.equal(target.atk, 900);
      await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: -1000, permanent: true }],
        { player: owner, opponent, source }, { chosen: [target] });
      assert.equal(target.atk, 0);
      game.updateBoard(); assert.equal(target.atk, 0);
      if (modifier === "valley") await game.moveCard(valley, opponent, "graveyard", { fromZone: "fieldSpell" });
      else expireFaceupStatBuffs(target);
      assert.equal(target.atk, 0);
      await game.moveCard(target, opponent, "hand", { fromZone: "field" });
      assert.equal(target.atk, 600);
    });
  }

  test(`Purge retains cleanup accounting after an Equip leaves (${seat})`, async t => {
    const { game, owner, opponent, make, monster } = setup(t, seat);
    const source = make(103), target = monster(600), shield = new Card(cardDefinition(113), opponent.id);
    placeFieldCards(opponent.field, target); opponent.spellTrap.push(shield);
    await game.effectEngine.applyActions(required(required(shield.effects[0]).actions),
      { player: opponent, opponent: owner, source: shield }, { shield_equip_target: [target] });
    assert.equal(target.atk, 1100);
    await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: -1000, permanent: true }],
      { player: owner, opponent, source }, { chosen: [target] });
    assert.equal(target.atk, 100);
    await game.moveCard(shield, opponent, "graveyard", { fromZone: "spellTrap" });
    assert.equal(target.atk, 0);
    await game.moveCard(target, opponent, "hand", { fromZone: "field" });
    assert.equal(target.atk, 600);
  });

  test(`Pursuer source exit preserves the reduction (${seat})`, async t => {
    const { game, owner, opponent, make, monster } = setup(t, seat);
    const source = make(123), target = monster();
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
    const effect = required(source.effects[0]);
    await game.effectEngine.applyActions(required(effect.actions), { player: owner, opponent, source, effect }, { arctroth_pursuer_drain_target: [target] });
    assert.equal(target.atk, 1200); assert.equal(source.atk, 4000);
    await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
    assert.equal(target.atk, 1200);
    assert.equal(source.atk, 2800);
    await game.moveCard(target, opponent, "hand", { fromZone: "field" });
    assert.equal(target.atk, 2400);
  });
}

test("Pursuer includes Synchro and independently limits both effects by name", () => {
  const effects = required(cardDefinition(123).effects);
  assert.ok(required(required(effects[0]).targets?.[0]).summonMethods?.includes("synchro"));
  assert.notEqual(required(effects[0]).oncePerTurnName, required(effects[1]).oncePerTurnName);
  for (const effect of effects) {
    assert.equal(effect.oncePerTurn, true);
    assert.equal(effect.oncePerTurnScope, undefined);
    assert.equal(effect.usagePolicy, "use");
  }
});

for (const seat of ["player", "bot"] as const) {
  for (const from of ["hand", "field", "deck"] as const) {
    for (const to of ["graveyard", "banished"] as const) {
      test(`Coward triggers only on actual hand to GY (${seat}, ${from}, ${to})`, async t => {
        const { game, owner, opponent, make, monster } = setup(t, seat);
        owner.controllerType = "ai";
        const source = make(109), target = monster();
        if (from === "field") placeFieldCards(owner.field, source); else owner[from].push(source);
        placeFieldCards(opponent.field, target);
        let targeted = 0;
        game.on("effect_targeted", () => { targeted++; });
        await game.moveCard(source, owner, to, { fromZone: from, contextLabel: "send_to_grave", awaitEvents: true });
        await game.flushPendingTriggerOccurrences();
        const eligible = from === "hand" && to === "graveyard";
        assert.equal(target.atk, eligible ? 1200 : 2400);
        assert.equal(targeted, eligible ? 1 : 0);
        cleanupTempBoosts(opponent);
        assert.equal(target.atk, 2400);
      });
    }
  }

  for (const method of ["normal", "tribute", "flip", "special", "fusion", "synchro", "ascension"] as const) {
    test(`Pursuer targeting uses the current summon method (${seat}, ${method})`, async t => {
      const { game, owner, opponent, make, monster } = setup(t, seat);
      owner.controllerType = "ai";
      const source = make(123), target = monster();
      target.lastSummonMethod = method;
      placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
      await game.emit("after_summon", { card: source, player: owner, opponent, method: "ascension", fromZone: "extraDeck" });
      assert.equal(target.atk, ["special", "fusion", "synchro", "ascension"].includes(method) ? 1200 : 2400);
    });
  }

  for (const atk of [0, 1, 501]) {
    test(`Pursuer gains only the applied reduction and preserves it when target leaves (${seat}, ${atk})`, async t => {
      const { game, owner, opponent, make, monster } = setup(t, seat);
      const source = make(123), target = monster(atk);
      target.def = 0;
      placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
      const effect = required(source.effects[0]);
      await game.effectEngine.applyActions(required(effect.actions), { player: owner, opponent, source, effect }, { arctroth_pursuer_drain_target: [target] });
      assert.equal(source.atk, 2800 + Math.floor(atk / 2));
      assert.equal(source.def, 2700);
      await game.moveCard(target, opponent, "hand", { fromZone: "field" });
      cleanupTempBoosts(owner);
      assert.equal(target.atk, atk);
      assert.equal(source.atk, 2800 + Math.floor(atk / 2));
    });
  }

  test(`Pursuer cannot gain from an immune target (${seat})`, async t => {
    const { game, owner, opponent, make, monster } = setup(t, seat);
    const source = make(123), target = monster();
    target.immuneToOpponentEffectsUntilTurn = game.turnCounter;
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
    const effect = required(source.effects[0]);
    await game.effectEngine.applyActions(required(effect.actions), { player: owner, opponent, source, effect }, { arctroth_pursuer_drain_target: [target] });
    assert.equal(target.atk, 2400); assert.equal(source.atk, 2800);
  });

  test(`Pursuer respects Bloomrot's counter-based immunity (${seat})`, async t => {
    const { game, owner, opponent, make, monster } = setup(t, seat);
    const source = make(123), ground = make(417), target = monster();
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
    owner.spellTrap.push(ground);
    assert.equal(game.effectEngine.checkImmunity(target, owner, { sourceCard: source }).immune, false);
    target.counters.set("spore", 1);
    assert.equal(game.effectEngine.checkImmunity(target, owner, { sourceCard: source }).immune, true);
    const effect = required(source.effects[0]);
    await game.effectEngine.applyActions(required(effect.actions), { player: owner, opponent, source, effect }, { arctroth_pursuer_drain_target: [target] });
    assert.equal(target.atk, 2400); assert.equal(source.atk, 2800);
    ground.effectsNegated = true;
    assert.equal(game.effectEngine.checkImmunity(target, owner, { sourceCard: source }).immune, false);
  });

  for (const change of ["facedown", "leave_return"] as const) {
    test(`Pursuer does not replace an invalidated target (${seat}, ${change})`, async t => {
      const { game, owner, opponent, make, monster } = setup(t, seat);
      const source = make(123), target = monster(), replacement = monster();
      target.lastSummonMethod = replacement.lastSummonMethod = "synchro";
      placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target, replacement);
      assert.ok(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({ card: source, controller: owner,
        effect: required(source.effects[0]), activationZone: "field", committed: true,
        targetSelections: chainSelections({ arctroth_pursuer_drain_target: [target] }) })));
      if (change === "facedown") target.isFacedown = true;
      else {
        await game.moveCard(target, opponent, "hand", { fromZone: "field" });
        await game.moveCard(target, opponent, "field", { fromZone: "hand", position: "attack", isFacedown: false,
          summonOrigin: "effect_resolution", summonMethodOverride: "special", summonProcedure: "card_effect" });
      }
      await game.chainSystem.resolveChain();
      assert.equal(target.atk, 2400); assert.equal(replacement.atk, 2400); assert.equal(source.atk, 2800);
    });
  }

  test(`Rage allows a prior monster attack and cancellation applies no restriction (${seat})`, async t => {
    const { game, owner, opponent, make, monster } = setup(t, seat);
    const attacker = make(111), rage = make(112), defender = monster(3500);
    defender.position = "defense";
    placeFieldCards(owner.field, attacker); placeFieldCards(opponent.field, defender);
    owner.hand.push(rage); game.phase = "battle"; game.battleStep = "battle";
    await game.resolveCombat(attacker, defender);
    assert.equal(owner.directAttacksDeclaredThisTurn, 0);
    game.phase = "main2";
    const cancelled = await game.tryActivateSpell(rage, 0, { rage_dragon_target: [] }, { owner });
    assert.equal(cancelled.success, false); assert.equal(owner.forbidDirectAttacksThisTurn, false);
    await game.tryActivateSpell(rage, 0, { rage_dragon_target: [attacker] }, { owner });
    assert.equal(attacker.atk, 3700); assert.equal(owner.forbidDirectAttacksThisTurn, true);
  });

  test(`direct attack history is public, canonical and cleared for both seats (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const attacker = make(111);
    placeFieldCards(owner.field, attacker);
    game.phase = "battle"; game.battleStep = "battle";
    game.on("attack_declared", () => { assert.equal(owner.directAttacksDeclaredThisTurn, 1); });
    await game.resolveCombat(attacker, null);
    await game.moveCard(attacker, owner, "hand", { fromZone: "field" });
    assert.equal(owner.directAttacksDeclaredThisTurn, 1);
    assert.equal(game.getPublicState(seat).players.self.directAttacksDeclaredThisTurn, 1);
    const snapshot = createCanonicalStateSnapshot(game);
    assert.equal(Reflect.get(required(snapshot.players[seat]).restrictions as object, "directAttacksDeclaredThisTurn"), 1);
    game.player.deck.push(make(3)); game.bot.deck.push(make(3));
    await game.endTurn();
    assert.equal(game.player.directAttacksDeclaredThisTurn, 0);
    assert.equal(game.bot.directAttacksDeclaredThisTurn, 0);
  });

  for (const effectIndex of [0, 1] as const) {
    for (const negated of [false, true]) {
      test(`Pursuer shares each hard OPT across copies, including negation (${seat}, ${effectIndex}, ${negated})`, async t => {
        const { game, owner, opponent, make, monster } = setup(t, seat);
        owner.controllerType = opponent.controllerType = "ai";
        const first = make(123), second = make(123), target = monster(), recruit = monster();
        target.lastSummonMethod = "synchro";
        placeFieldCards(owner.field, first, second); placeFieldCards(opponent.field, target); opponent.graveyard.push(recruit);
        const effect = required(first.effects[effectIndex]), other = required(second.effects[1 - effectIndex]);
        const targetId = required(effect.targets?.[0]).id;
        const link = game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({
          card: first, controller: owner, effect, activationZone: "field", committed: true, activationNegated: negated,
          targetSelections: chainSelections({ [targetId]: [effectIndex === 0 ? target : recruit] }),
        }));
        assert.ok(link);
        await game.chainSystem.resolveChain();
        assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, false);
        assert.equal(game.canUseOncePerTurn(second, owner, other).ok, true);
        if (effectIndex === 1) assert.equal(first.canMakeSecondAttackThisTurn, !negated);
        await game.moveCard(first, owner, "graveyard", { fromZone: "field" });
        assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, false);
        game.turnCounter++;
        assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true);
      });
    }
  }

  test(`Pursuer does not gain stats after its own presence ends during responses (${seat})`, async t => {
    const { game, owner, opponent, make, monster } = setup(t, seat);
    const source = make(123), target = monster();
    target.lastSummonMethod = "synchro";
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
    const effect = required(source.effects[0]);
    const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect,
      activationZone: "field", committed: true,
      targetSelections: chainSelections({ arctroth_pursuer_drain_target: [target] }) });
    assert.ok(game.chainSystem.addToChain(prepared));
    await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
    await game.chainSystem.resolveChain();
    assert.equal(target.atk, 1200);
    assert.equal(source.atk, 2800);
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const negated of [false, true]) {
    test(`The Shadow Heart destroys its host inside the awaited move (${seat}, ${negated ? "negated" : "active"})`, async t => {
      const { game, owner } = setup(t, seat);
      const equip = game.createCardForOwner(120, owner);
      const host = game.createCardForOwner(111, owner);
      assert.ok(equip && host);
      placeFieldCards(owner.field, host);
      owner.spellTrap.push(equip);
      equip.isFacedown = false;
      equip.equippedTo = host;
      host.equips = [equip];
      equip.effectsNegated = negated;
      const logs: string[] = [];
      const log = game.ui.log.bind(game.ui);
      game.ui.log = (message: string) => { logs.push(message); log(message); };

      const moved = await game.moveCard(equip, owner, "graveyard", { fromZone: "spellTrap" });

      assert.equal(moved && typeof moved === "object" ? moved.success : moved, true);
      // Nothing is left running after the move: the host is already gone.
      assert.equal(game.zoneOpDepth, 0);
      assert.ok(owner.graveyard.includes(host), "the equipped monster is destroyed before the move resolves");
      assert.equal(owner.field.includes(host), false);
      assert.equal(logs.filter(message => message.includes("left the field")).length, 1);
    });
  }
}
