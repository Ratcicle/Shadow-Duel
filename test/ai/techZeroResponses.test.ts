import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, chainSelections, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { getTechZeroPendingTargetReservations } from "../../src/core/ai/techzero/responses.js";

function scenario(t: TestContext, seat: "player" | "bot") {
  const first = new Bot("techzero"); first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime in either physical seat");
  t.after(() => game.dispose("techzero_responses"));
  game.turn = seat === "player" ? "bot" : "player";
  game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  const logs: string[] = [];
  game.ui.log = message => { logs.push(message); };
  const player = seat === "player" ? first : second;
  const opponent = seat === "player" ? second : first;
  const make = (id: number) => new Card(cardDefinition(id), player.id);
  const chain = game.chainSystem;
  const pending = (actions: readonly CardAction[], targets: Card[] = []) => {
    const source = new Card({ id: 99001, name: "Visible opposing effect", cardKind: "monster", atk: 1000,
      effects: [{ id: "visible_opposing_effect", timing: "ignition", activationZones: ["field"],
        targets: targets.length ? [{ id: "victim", owner: "opponent", zone: "field", count: { min: targets.length, max: targets.length } }] : [], actions }] }, opponent.id);
    placeFieldCards(opponent.field, source);
    const link = required(chain.addToChain(chain.createPreparedActivation({ card: source, controller: opponent,
      effect: required(source.effects[0]), activationZone: "field", committed: true, costsPaid: true,
      targetSelections: chainSelections({ victim: targets }) })));
    assert.ok(link);
    return { source, link };
  };
  const choose = async () => {
    const context = chain.getCurrentChainActivationContext() || { type: "phase_change" as const, player: opponent, fromPhase: "main1", toPhase: "battle" };
    const candidates = chain.getActivatableCardsInChain(player, context);
    return { choice: await chain.botChooseChainResponse(player, candidates, context), candidates, context };
  };
  const activateChoice = async () => {
    const { choice, context } = await choose();
    assert.ok(choice, "the dedicated strategy must choose a legal response deterministically");
    const prepared = await chain.prepareChainResponse(choice, player, context);
    assert.equal(prepared.success, true);
    assert.ok(prepared.preparedActivation);
    const link = required(chain.addToChain(prepared.preparedActivation));
    return { choice, link };
  };
  return { game, player, opponent, make, chain, pending, choose, activateChoice, logs };
}

function scrapyardScenario(t: TestContext, seat: "player" | "bot") {
  const fixture = scenario(t, seat);
  const { player, make } = fixture;
  const scrapyard = make(520), tuner = make(503), slasher = make(510), mage = make(512), boss = make(517);
  tuner.properSummonEstablished = true; tuner.properSummonProcedure = "synchro";
  scrapyard.isFacedown = true; scrapyard.setTurn = 2;
  placeFieldCards(player.spellTrap, scrapyard); player.graveyard.push(tuner); player.extraDeck.push(boss);
  player.deck.push(make(518), make(519));
  placeFieldCards(player.field, slasher, mage);
  return { ...fixture, scrapyard, tuner, slasher, mage, boss };
}

for (const seat of ["player", "bot"] as const) {
  test(`Scrapyard preserves an already proven lethal attack sequence (${seat})`, async t => {
    const { game, player, opponent, choose } = scrapyardScenario(t, seat);
    game.turn = seat; opponent.lp = 1000;
    player.hand.length = 0; opponent.hand.length = 0;
    const { choice, candidates } = await choose();
    assert.ok(candidates.some(candidate => candidate.card.id === 520));
    assert.equal(choice, null, "unneeded extension must preserve a proven winning attack sequence");
  });

  test(`Scrapyard waits for Portal's exact revives to resolve (${seat})`, async t => {
    const { game, player, make, chain, choose } = scenario(t, seat);
    const portal = make(509), machine = make(503), catapult = make(502), core = make(501), scrapyard = make(520);
    placeFieldCards(player.field, portal); player.graveyard.push(machine, catapult, core);
    player.extraDeck.push(make(512)); scrapyard.isFacedown = true; scrapyard.setTurn = 2;
    placeFieldCards(player.spellTrap, scrapyard);
    const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
    const ids = [machine.instanceId, catapult.instanceId, core.instanceId];
    const link = required(chain.addToChain(chain.createPreparedActivation({ card: portal, controller: player,
      effect, activationZone: "field", committed: true, costsPaid: true,
      activationContext: { decisions: { specialSummons: { [effect.id!]: ids } } },
    })));
    assert.deepEqual(getTechZeroPendingTargetReservations(game, player.id), ids);
    assert.deepEqual(getTechZeroPendingTargetReservations(game, player.id, portal, effect.id), []);
    assert.equal((await choose()).choice, null, "Scrapyard must preserve the three pending Portal revives");
    assert.ok(link);
    link.effectNegated = true;
    assert.deepEqual(getTechZeroPendingTargetReservations(game, player.id), []);
    link.effectNegated = false;
    await chain.resolveChain();
    assert.deepEqual(player.field.map(card => card.id), [509, 503, 502, 501]);
    assert.deepEqual(getTechZeroPendingTargetReservations(game, player.id), []);
  });

  test(`pending Synchro decisions reserve their materials and Extra Deck destination (${seat})`, t => {
    const { game, player, make, chain } = scenario(t, seat);
    const source = make(520), core = make(501), catapult = make(502), machine = make(503);
    const effect = required(source.effects[0]);
    const link = required(chain.addToChain(chain.createPreparedActivation({ card: source, controller: player,
      effect, activationZone: "spellTrap", committed: true, costsPaid: true,
      activationContext: { decisions: { synchroSummons: { [effect.id!]: {
        synchroInstanceId: machine.instanceId, materialInstanceIds: [core.instanceId, catapult.instanceId], position: "attack",
      } } } },
    })));
    assert.deepEqual(new Set(getTechZeroPendingTargetReservations(game, player.id)),
      new Set([core.instanceId, catapult.instanceId, machine.instanceId]));
    assert.ok(link);
    link.resolutionStatus = "resolved";
    assert.deepEqual(getTechZeroPendingTargetReservations(game, player.id), []);
  });

  test(`Court preserves Portal's pending field capacity (${seat})`, async t => {
    const { game, player, make, chain, choose } = scenario(t, seat);
    const portal = make(509), court = make(17), machine = make(503), catapult = make(502), core = make(501);
    const phoenix = make(514);
    placeFieldCards(player.field, portal, make(507)); placeFieldCards(player.spellTrap, court);
    court.counters.set("funeral", 8); player.graveyard.push(machine, catapult, core, phoenix);
    player.lp = 1000; game.random = () => 0;
    const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
    required(chain.addToChain(chain.createPreparedActivation({ card: portal, controller: player,
      effect, activationZone: "field", committed: true, costsPaid: true,
      activationContext: { decisions: { specialSummons: { [effect.id!]: [machine.instanceId, catapult.instanceId, core.instanceId] } } },
    })));
    const { choice, candidates } = await choose();
    assert.ok(candidates.some(candidate => candidate.card === court));
    assert.equal(choice, null, "Court must not take a zone already needed by Portal");
    assert.equal(court.counters.get("funeral"), 8);
  });

  test(`Kaiser preserves the revival target of a pending material trigger (${seat})`, async t => {
    const { player, make, chain, activateChoice, game } = scenario(t, seat);
    const scrapyard = make(520), raptor = make(505), catapult = make(502), kaiser = make(513);
    scrapyard.isFacedown = true; scrapyard.setTurn = 2;
    placeFieldCards(player.spellTrap, scrapyard); placeFieldCards(player.field, catapult);
    player.graveyard.push(raptor); player.extraDeck.push(kaiser);
    await activateChoice();
    await chain.resolveChain();
    await game.flushPendingTriggerOccurrences();
    assert.ok(player.field.includes(raptor), "Kaiser must leave Electrocatapult's declared revival target in the Graveyard");
    assert.ok(player.deck.includes(catapult));
    assert.equal(raptor.effectsNegated, true);
    assert.equal(kaiser.atk, 2400, "only Electrocatapult's three levels are recycled");
  });

  test(`Scrapyard preserves the exact field target of its own pending Core effect (${seat})`, async t => {
    const { player, make, chain, choose } = scenario(t, seat);
    const core = make(501), catapult = make(502), machine = make(503), scrapyard = make(520);
    machine.properSummonEstablished = true; machine.properSummonProcedure = "synchro";
    scrapyard.isFacedown = true; scrapyard.setTurn = 2;
    placeFieldCards(player.field, core, catapult); placeFieldCards(player.spellTrap, scrapyard);
    player.graveyard.push(machine); player.extraDeck.push(make(510));
    const effect = required(core.effects.find(entry => entry.id === "tech_zero_energy_core_level_mod"));
    required(chain.addToChain(chain.createPreparedActivation({ card: core, controller: player,
      effect, activationZone: "field", committed: true, costsPaid: true,
      targetSelections: chainSelections({ tech_zero_energy_core_level_target: [core] }),
      activationContext: { decisions: { cases: { tech_zero_energy_core_level_mod: "increase" },
        selections: { tech_zero_energy_core_level_target: [core.instanceId] } } },
    })));
    const { choice } = await choose();
    assert.ok(choice === null, "the only Scrapyard Synchro consumes the pending effect's field target");
    await chain.resolveChain();
    assert.ok(player.field.includes(core));
    assert.equal(core.level, 2);
    assert.equal(scrapyard.isFacedown, true);
  });

  for (const duringChain of [false, true]) {
    test(`Core and Multimodal each draw once when making Mage ${duringChain ? "inside" : "outside"} a Chain (${seat})`, async t => {
      const { game, player, make, chain, activateChoice } = scenario(t, seat);
      const core = make(501), multimodal = make(503), mage = make(512);
      multimodal.level = 4;
      player.extraDeck.push(mage); player.deck.push(make(518), make(519), make(520));
      placeFieldCards(player.field, multimodal);
      if (duringChain) {
        const scrapyard = make(520); scrapyard.isFacedown = true; scrapyard.setTurn = 2;
        placeFieldCards(player.spellTrap, scrapyard); player.graveyard.push(core);
        await activateChoice();
        await chain.resolveChain();
        assert.equal(player.hand.length, 0, "material triggers wait until the resolving Chain finishes");
        await game.flushPendingTriggerOccurrences();
      } else {
        game.turn = seat; placeFieldCards(player.field, core);
        const state = player.cloneGameState(unsafeFixture<BotCloneGamePort>(game, "Concrete Game provides the Bot clone source"));
        player.strategy.simulateMainPhaseAction(state, { type: "synchro", synchroInstanceId: mage.instanceId,
          materialInstanceIds: [core.instanceId, multimodal.instanceId], position: "attack" });
        assert.equal(state.bot.hand.length, 2);
        assert.equal((await game.performSynchroSummonFromExtraDeck(mage, player, { materials: [core, multimodal] })).success, true);
      }
      assert.deepEqual(player.field.map(card => card.id), [512]);
      assert.equal(player.hand.length, 2, "Mage does not draw for its own summon; both material effects do");
      assert.equal(player.deck.length, 1);
    });
  }

  test(`Slasher's direct protection lasts through the next turn after a Scrapyard Chain (${seat})`, async t => {
    const { game, player, chain, activateChoice, boss, opponent } = scrapyardScenario(t, seat);
    await activateChoice();
    await chain.resolveChain();
    await game.flushPendingTriggerOccurrences();
    assert.equal(player.hand.length, 1, "the deferred material draw resolves once beside the protection trigger");
    for (const turn of [4, 5]) {
      game.turnCounter = turn;
      game.cleanupExpiredBuffs();
      assert.equal(game.isBattleDestructionProtected(boss), true);
      await game.destroyCard(boss, { cause: "effect", sourcePlayer: opponent });
      assert.ok(player.field.includes(boss));
    }
    game.turnCounter = 6;
    game.cleanupExpiredBuffs();
    assert.equal(game.isBattleDestructionProtected(boss), false);
    await game.destroyCard(boss, { cause: "effect", sourcePlayer: opponent });
    assert.ok(player.graveyard.includes(boss));
  });

  test(`a removed Scrapyard Synchro cannot receive late material protection (${seat})`, async t => {
    const { game, player, chain, activateChoice, boss } = scrapyardScenario(t, seat);
    await activateChoice();
    await chain.resolveChain();
    await game.moveCard(boss, player, "banished", { fromZone: "field" });
    await game.flushPendingTriggerOccurrences();
    assert.ok(player.banished.includes(boss));
    assert.equal(boss.protectionEffects?.length || 0, 0);
    assert.equal(game.pendingSynchroMaterialFollowups.length, 0);
  });

  test(`Phoenix's destruction schedules its exact instance for the active End Phase (${seat})`, async t => {
    const { game, player, make, chain, pending } = scenario(t, seat);
    const phoenix = make(514);
    phoenix.properSummonEstablished = true; phoenix.properSummonProcedure = "synchro";
    placeFieldCards(player.field, phoenix);
    pending([{ type: "destroy", targetRef: "victim" }], [phoenix]);
    await chain.resolveChain();
    await game.flushPendingTriggerOccurrences();
    assert.ok(player.graveyard.includes(phoenix));
    assert.equal(game.delayedActions.length, 1);
    await game.processDelayedActions("standby", game.turn);
    await game.processDelayedActions("end", seat);
    assert.equal(player.field.includes(phoenix), false);
    await game.processDelayedActions("end", game.turn);
    assert.ok(player.field.includes(phoenix));
    assert.equal(phoenix.banishWhenLeavesField, true);
    assert.equal(game.delayedActions.length, 0);
    await game.moveCard(phoenix, player, "graveyard", { fromZone: "field" });
    assert.ok(player.banished.includes(phoenix));
  });

  test(`Reactor refuses its self-cost in the actual summon turn and permits a later turn (${seat})`, async t => {
    const { game, player, make } = scenario(t, seat);
    game.turn = seat;
    const tuner = make(503), mage = make(512), reactor = make(515);
    placeFieldCards(player.field, tuner, mage);
    player.extraDeck.push(reactor);
    assert.equal((await game.performSynchroSummonFromExtraDeck(reactor, player, { materials: [tuner, mage] })).success, true);
    const activation = () => game.tryActivateMonsterEffect(reactor, null, "field", player, { effectId: "tech_zero_reactor_dragon_recycle_synchros" });
    assert.equal(reactor.summonedTurn, 4);
    assert.equal((await activation()).success, false);
    assert.ok(player.field.includes(reactor));
    game.turnCounter = 6;
    assert.equal((await activation()).success, true);
    assert.ok(player.graveyard.includes(reactor));
    assert.deepEqual(player.field.map(card => card.id).sort(), [503, 512]);
  });

  for (const mixed of [false, true]) {
    test(`Tech-Zero preserves generic Court activation with ${mixed ? "declined Scrapyard" : "no dedicated response"} (${seat})`, async t => {
      const fixture = mixed ? scrapyardScenario(t, seat) : scenario(t, seat);
      const { game, player, make, pending, choose } = fixture;
      const court = make(17); court.isFacedown = true; court.setTurn = 2;
      placeFieldCards(player.spellTrap, court);
      player.lp = 1000;
      game.random = () => 0;
      pending([{ type: "destroy_cards_by_scope", targetScope: { owner: "opponent", zone: "field" } }]);
      const { choice, candidates } = await choose();
      assert.ok(candidates.some(candidate => candidate.card === court));
      assert.equal(choice?.card.id, 17);
    });
  }

  test(`Scrapyard responds with exact materials and saves a targeted material (${seat})`, async t => {
    const { player, chain, pending, activateChoice, tuner, slasher, mage, boss, logs } = scrapyardScenario(t, seat);
    const { link } = pending([{ type: "destroy", targetRef: "victim" }], [slasher]);
    const { choice } = await activateChoice();
    const decisions = required(choice.context.activationContext?.decisions);
    assert.deepEqual(decisions.specialSummons?.tech_zero_scrapyard_activation, [tuner.instanceId]);
    assert.deepEqual(decisions.synchroSummons?.tech_zero_scrapyard_activation, {
      synchroInstanceId: boss.instanceId, materialInstanceIds: [tuner.instanceId, slasher.instanceId, mage.instanceId], position: "attack",
    });
    await chain.resolveChain();
    assert.deepEqual(player.field.map(card => card.id), [517], logs.join("\n"));
    assert.equal(link.activationNegated, false);
    assert.equal(link.effectNegated, false);
    assert.ok(player.graveyard.includes(slasher));
  });

  test(`Scrapyard's Synchro summon cannot retroactively negate a pending effect (${seat})`, async t => {
    const { game, player, chain, pending, activateChoice, boss } = scrapyardScenario(t, seat);
    const { source, link } = pending([{ type: "damage", amount: 700, player: "opponent" }]);
    const events: string[] = [];
    game.on("after_summon", payload => { if (payload.card === boss) events.push("summon"); });
    await activateChoice();
    await chain.resolveChain();
    assert.ok(player.field.includes(boss));
    assert.equal(player.lp, 7300);
    assert.equal(link.effectNegated, false);
    assert.equal(link.activationNegated, false);
    assert.equal(source.effectsNegated, false);
    await game.flushPendingTriggerOccurrences();
    assert.equal(source.effectsNegated, true, "the on-summon trigger negates the surviving source only after CL1 resolves");
    assert.ok(events.includes("summon"));
  });

  test(`Scrapyard waits while pending removal would hit its new boss (${seat})`, async t => {
    const { chain, player, pending, choose, scrapyard } = scrapyardScenario(t, seat);
    pending([{ type: "destroy_cards_by_scope", targetScope: { owner: "opponent", zone: "field" } }]);
    const { candidates, choice } = await choose();
    assert.ok(candidates.some(candidate => candidate.card === scrapyard), "legal activation remains a strategic refusal");
    assert.equal(choice === null, true);
    assert.ok(player.spellTrap.includes(scrapyard));
    assert.equal(chain.getChainLength(), 1);
  });

  for (const removed of ["tuner", "material"] as const) {
    test(`Scrapyard revalidates a removed ${removed} without substituting the same name (${seat})`, async t => {
      const { game, player, make, chain, activateChoice, tuner, slasher, boss } = scrapyardScenario(t, seat);
      const replacement = make(removed === "tuner" ? 503 : 510);
      replacement.properSummonEstablished = true;
      if (removed === "tuner") player.graveyard.push(replacement);
      else placeFieldCards(player.field, replacement);
      const { choice } = await activateChoice();
      const decisions = required(choice.context.activationContext?.decisions);
      const tunerIds = required(decisions.specialSummons?.tech_zero_scrapyard_activation);
      const materialIds = required(decisions.synchroSummons?.tech_zero_scrapyard_activation?.materialInstanceIds);
      const selected = removed === "tuner" ? required(player.graveyard.find(card => tunerIds.includes(card.instanceId))) :
        required(player.field.find(card => card.id === slasher.id && materialIds.includes(card.instanceId)));
      await game.moveCard(selected, player, "banished", { fromZone: removed === "tuner" ? "graveyard" : "field" });
      await chain.resolveChain();
      assert.ok(player.extraDeck.includes(boss));
      assert.equal(player.field.includes(boss), false);
      assert.equal(removed === "tuner" ? player.graveyard.includes(replacement) : player.field.includes(replacement), true);
      if (removed === "material") assert.ok(player.field.includes(tuner), "the completed revival is preserved when the later Synchro fails");
    });
  }

  test(`Lancer selects and resolves its existing destruction response (${seat})`, async t => {
    const { game, player, opponent, make, chain, pending, activateChoice } = scenario(t, seat);
    const lancer = make(516); placeFieldCards(player.field, lancer);
    const { source, link } = pending([{ type: "destroy", targetRef: "victim" }], [lancer]);
    await activateChoice();
    await chain.resolveChain();
    assert.equal(link.activationNegated, true);
    assert.ok(player.field.includes(lancer));
    assert.ok(opponent.graveyard.includes(source));
    assert.equal(game.canUseOncePerTurn(lancer, player, required(lancer.effects.find(effect => effect.id === "tech_zero_explosive_lancer_negate_destroy"))).ok, false);
  });

  for (const other of ["none", "monster", "set_backrow", "field_spell"] as const) {
    test(`Singularity negates removal and checks every controlled zone before banishing (${seat}, ${other})`, async t => {
      const { player, opponent, make, chain, pending, activateChoice } = scenario(t, seat);
      const singularity = make(517); placeFieldCards(player.field, singularity);
      if (other === "monster") placeFieldCards(player.field, make(501));
      if (other === "set_backrow") { const card = make(520); card.isFacedown = true; placeFieldCards(player.spellTrap, card); }
      if (other === "field_spell") player.fieldSpell = make(518);
      const { source, link } = pending([{ type: "return_to_hand", targetRef: "victim" }], [singularity]);
      await activateChoice();
      await chain.resolveChain();
      assert.equal(link.effectNegated, true);
      assert.ok(player.field.includes(singularity));
      assert.equal(opponent.banished.includes(source), other === "none");
      assert.equal(opponent.field.includes(source), other !== "none");
    });
  }
}
