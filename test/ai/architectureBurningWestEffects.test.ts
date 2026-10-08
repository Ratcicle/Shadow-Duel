import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import BurningWestStrategy from "../../src/core/ai/BurningWestStrategy.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import type { AIActivationContext } from "../../src/core/contracts/ai.js";
import { isFullChainHost, type ChainSelectionMap } from "../../src/core/contracts/chainRuntime.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationState } from "../helpers/simulation.js";

function scenario(t: TestContext, seat: "player" | "bot", attackerId = 455, useChains = false) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, disableChains: !useChains });
  t.after(() => game.dispose("architecture_burning_west_effects_test"));
  game.turn = seat; game.phase = "battle"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  const owner = game[seat], opponent = game[seat === "bot" ? "player" : "bot"];
  owner.controllerType = opponent.controllerType = "ai";
  owner.strategy = unsafeFixture<NonNullable<typeof owner.strategy>>(new BurningWestStrategy(owner),
    "The concrete runtime calls Burning West's choices with live Cards; its legacy simulation-branded parameter projection is narrower than ActionRuntimeStrategyPort");
  const make = (id: number, destination: "field" | "hand" | "spellTrap" | "graveyard", opposing = false) => {
    const actor = opposing ? opponent : owner;
    const card = new Card(cardDefinition(id), actor.id);
    card.isFacedown = false; card.position = "attack";
    if (destination === "field" || destination === "spellTrap") placeFieldCards(actor[destination], card);
    else actor[destination].push(card);
    return card;
  };
  const attacker = make(attackerId, "field"), destroyed = make(503, "graveyard", true);
  const project = () => {
    const copy = createPlanningCopy();
    const player = (actor: typeof owner) => ({ id: actor.id,
      lp: actor.lp, field: actor.field.map(copy.cloneCardForSim), hand: actor.hand.map(copy.cloneCardForSim),
      deck: actor.deck.map(copy.cloneCardForSim), graveyard: actor.graveyard.map(copy.cloneCardForSim),
      spellTrap: actor.spellTrap.map(copy.cloneCardForSim), extraDeck: actor.extraDeck.map(copy.cloneCardForSim) });
    const { temporaryEventEffects: unused, ...state } = simulationState({ turn: seat, phase: "battle", turnCounter: 4,
      _isPerspectiveState: true, bot: player(owner), player: player(opponent) });
    void unused;
    const simAttacker = required(state.bot.field.find(card => card.instanceId === attacker.instanceId));
    const simDestroyed = required(state.player.graveyard.find(card => card.instanceId === destroyed.instanceId));
    const summary = { damage: 0, destroyedCards: [{ ...simDestroyed, owner: "opponent", destroyedBy: "battle",
      card: simDestroyed, position: simDestroyed.position }] };
    const strategy = new BurningWestStrategy(state.bot);
    const apply = (options: object = {}) => strategy.applySimulatedBattleRewards({ state, bot: state.bot, opponent: state.player, options,
      battlePlan: { attackerCard: simAttacker }, summary });
    return { state, simAttacker, simDestroyed, summary, strategy, apply };
  };
  const activate = async (id: string, source: Card, context: AIActivationContext = {}) => {
    const triggers = await game.effectEngine.collectBattleDestroyTriggers(
      unsafeFixture<Parameters<typeof game.effectEngine.collectBattleDestroyTriggers>[0]>({ attacker, destroyed,
        attackerOwner: owner, destroyedOwner: opponent, battleDestroyer: attacker, battleDestroyers: [attacker] },
      "Reward collection reads these completed battle facts; this focused fixture omits unrelated Damage Step presentation fields"));
    const entry = required(triggers.entries.find(trigger => trigger.card === source && trigger.effect.id === id));
    const reservation = game.reserveEffectUsage({ card: source, player: owner, effect: required(source.effects.find(effect => effect.id === id)) });
    const result = await entry.config.activate(null,
      unsafeFixture<Parameters<typeof entry.config.activate>[1]>({ ...entry.config.activationContext,
        autoSelectTargets: true, autoSelectSingleTarget: true, ...context, confirmed: true },
      "Concrete collected trigger context carries executable AI decisions; public AIActivationContext permits explicit undefined source fields"));
    assert.ok(result && typeof result === "object" && "success" in result && result.success === true, JSON.stringify(result));
    if (reservation && "reservationId" in reservation) game.settleEffectUsage(reservation, {});
  };
  return { game, owner, opponent, attacker, destroyed, make, project, activate };
}

for (const seat of ["player", "bot"] as const) {
  test(`Wanted applies its buff once and consumes the canonical copy ledger (${seat})`, async t => {
    const f = scenario(t, seat), wanted = f.make(452, "spellTrap");
    wanted.declaredValues = { burning_west_wanted_type: { property: "type", value: "Machine", expiresOnTurn: 5 } };
    const { state, simAttacker, apply } = f.project();
    const initialAtk = f.attacker.atk;
    await f.activate("burning_west_wanted_reward", wanted, { decisions: { cases: {
      burning_west_wanted_reward: "burning_west_wanted_buff" }, selections: {
      burning_west_wanted_buff_target: [f.attacker.instanceId] } } });
    apply();
    assert.equal(f.attacker.atk, initialAtk + 800);
    assert.equal(simAttacker.atk, f.attacker.atk);
    apply();
    assert.equal(simAttacker.atk, initialAtk + 800, "one Wanted cannot resolve the same reward twice");
    const simulatedWanted = required(state.bot.spellTrap[0]);
    const effect = required(wanted.effects.find(entry => entry.id === "burning_west_wanted_reward"));
    assert.equal(f.game.checkEffectUsage({ card: wanted, player: f.owner, effect }).ok, false);
    assert.equal(canUseSimulatedEffectUsage(state, effect, simulatedWanted, seat, true), false);
  });

  test(`two Wanted copies keep independent battle rewards (${seat})`, async t => {
    const f = scenario(t, seat), first = f.make(452, "spellTrap"), second = f.make(452, "spellTrap");
    for (const card of [first, second]) card.declaredValues = {
      burning_west_wanted_type: { property: "type", value: "Machine", expiresOnTurn: 5 } };
    const { simAttacker, apply } = f.project();
    const initialAtk = f.attacker.atk;
    for (const source of [first, second]) await f.activate("burning_west_wanted_reward", source,
      { decisions: { cases: { burning_west_wanted_reward: "burning_west_wanted_buff" }, selections: {
        burning_west_wanted_buff_target: [f.attacker.instanceId] } } });
    apply();
    assert.equal(f.attacker.atk, initialAtk + 1600);
    assert.equal(simAttacker.atk, f.attacker.atk);
  });

  test(`Gunslinger pays one discard and resolves one opposing discard (${seat})`, async t => {
    const f = scenario(t, seat, 451), cost = f.make(458, "hand"), opposingCost = f.make(1, "hand", true);
    const { state, apply } = f.project();
    const effect = required(f.attacker.effects.find(entry => entry.id === "burning_west_gunslinger_battle_discard"));
    // A collected trigger's resolver starts after Chain has paid activation
    // costs. Exercise that declarative cost/action sequence explicitly here.
    const reservation = required(f.game.reserveEffectUsage({ card: f.attacker, player: f.owner, effect }));
    assert.ok("reservationId" in reservation);
    const result = await f.game.effectEngine.applyActions([...(effect.activationCosts || []), ...(effect.actions || [])],
      { source: f.attacker, player: f.owner, opponent: f.opponent }, { burning_west_gunslinger_cost: [cost] });
    assert.equal(result.success, true);
    f.game.settleEffectUsage(reservation, {});
    apply();
    assert.equal(state.bot.hand.length, f.owner.hand.length);
    assert.equal(state.player.hand.length, f.opponent.hand.length);
    assert.ok(state.bot.graveyard.some(card => card.instanceId === cost.instanceId));
    assert.ok(state.player.graveyard.some(card => card.instanceId === opposingCost.instanceId));
    assert.equal(state.bot.lp, f.owner.lp);
    assert.equal(state.player.lp, f.opponent.lp);
    apply();
    assert.equal(state.bot.graveyard.filter(card => card.instanceId === cost.instanceId).length, 1);
    assert.equal(f.game.checkEffectUsage({ card: f.attacker, player: f.owner, effect }).ok, false);
    assert.equal(canUseSimulatedEffectUsage(state, effect, required(state.bot.field[0]), seat, true), false);
  });

  test(`Burning Reward recovers and summons only its added monster once (${seat})`, async t => {
    const f = scenario(t, seat), source = f.make(464, "spellTrap"), target = f.make(454, "graveyard");
    source.isFacedown = true; source.turnSetOn = 3;
    const sheriff = f.make(461, "field");
    sheriff.declaredValues = { burning_west_sheriff_type: { property: "type", value: "Machine" } };
    const { state, apply } = f.project();
    const effect = required(source.effects.find(entry => entry.id === "burning_reward"));
    const reservation = required(f.game.reserveEffectUsage({ card: source, player: f.owner, effect }));
    assert.ok("reservationId" in reservation);
    const result = await f.game.effectEngine.applyActions(effect.actions || [],
      { source, player: f.owner, opponent: f.opponent, attacker: f.attacker,
        destroyed: f.destroyed, destroyedOwner: f.opponent }, {});
    assert.equal(result.success, true);
    f.game.settleEffectUsage(reservation, {});
    assert.equal(f.owner.field.includes(target), true);
    apply();
    const summoned = required(state.bot.field.find(card => card.instanceId === target.instanceId));
    assert.equal(state.bot.hand.length, f.owner.hand.length);
    assert.equal(summoned.lastSummonedFromZone, target.lastSummonedFromZone);
    assert.equal(summoned.position, target.position);
    apply();
    assert.equal(state.bot.field.filter(card => card.instanceId === target.instanceId).length, 1);
    assert.equal(canUseSimulatedEffectUsage(state, effect, required(state.bot.graveyard.find(card => card.instanceId === source.instanceId)), seat, true), false);
  });

  test(`Peacemaker can reward two distinct battles without a fabricated turn limit (${seat})`, async t => {
    const f = scenario(t, seat), equip = f.make(456, "spellTrap");
    equip.equippedTo = f.attacker; f.attacker.equips.push(equip);
    const first = f.make(4, "spellTrap", true), second = f.make(3, "spellTrap", true);
    const { state, summary, apply } = f.project();
    await f.activate("burning_peacemaker_battle_destroy_spelltrap", equip, { decisions: { selections: {
      burning_peacemaker_spelltrap_target: [first.instanceId] } } });
    apply();
    assert.equal(state.player.spellTrap.length, 1, "a single equipped source resolves once per battle");
    const secondDestroyed = f.make(503, "graveyard", true);
    const simSecondDestroyed = createPlanningCopy().cloneCardForSim(secondDestroyed);
    state.player.graveyard.push(simSecondDestroyed);
    summary.destroyedCards[0] = { ...simSecondDestroyed, card: simSecondDestroyed, owner: "opponent", destroyedBy: "battle", position: simSecondDestroyed.position };
    await f.activate("burning_peacemaker_battle_destroy_spelltrap", equip, { decisions: { selections: {
      burning_peacemaker_spelltrap_target: [second.instanceId] } } });
    apply();
    assert.equal(f.opponent.spellTrap.length, 0);
    assert.equal(state.player.spellTrap.length, 0);
    assert.equal(state.player.graveyard.filter(card => card.instanceId === first.instanceId || card.instanceId === second.instanceId).length, 2);
  });

  test(`Wanted summons its chosen hand monster once through the shared action path (${seat})`, async t => {
    const f = scenario(t, seat), wanted = f.make(452, "spellTrap"), target = f.make(454, "hand");
    wanted.declaredValues = { burning_west_wanted_type: { property: "type", value: "Machine", expiresOnTurn: 5 } };
    const { state, apply } = f.project();
    await f.activate("burning_west_wanted_reward", wanted, { decisions: { cases: {
      burning_west_wanted_reward: "burning_west_wanted_summon" } } });
    apply();
    assert.equal(state.bot.hand.length, f.owner.hand.length);
    assert.equal(state.bot.field.filter(card => card.instanceId === target.instanceId).length, 1);
    const summoned = required(state.bot.field.find(card => card.instanceId === target.instanceId));
    assert.equal(summoned.lastSummonMethod, target.lastSummonMethod);
    assert.equal(summoned.lastSummonedFromZone, target.lastSummonedFromZone);
    assert.equal(summoned.position, target.position);
    apply();
    assert.equal(state.bot.field.filter(card => card.instanceId === target.instanceId).length, 1);
  });

  for (const negated of [false, true]) {
    test(`Executioner equal ATK survival follows its passive with negated=${negated} (${seat})`, t => {
      const f = scenario(t, seat, 466);
      const defender = f.make(1, "field", true); defender.atk = f.attacker.atk;
      f.attacker.effectsNegated = negated;
      const { state, simAttacker, strategy } = f.project();
      const simDefender = required(state.player.field[0]);
      const canDestroy = f.game.canDestroyByBattle(f.attacker,
        { owner: f.owner, attacker: f.attacker, defender });
      assert.equal(canDestroy, negated);
      strategy.prepareSimulatedBattle({ state, bot: state.bot, attacker: simAttacker, target: simDefender });
      assert.equal(simAttacker.simBattleDestructionProtected === true, !canDestroy);
    });
  }

  for (const blocked of ["facedown", "negated", "expired"] as const) {
    test(`Wanted rejects a ${blocked} source without consuming its copy (${seat})`, t => {
      const f = scenario(t, seat), wanted = f.make(452, "spellTrap");
      wanted.declaredValues = { burning_west_wanted_type: { property: "type", value: "Machine", expiresOnTurn: blocked === "expired" ? 3 : 5 } };
      wanted.isFacedown = blocked === "facedown";
      wanted.effectsNegated = blocked === "negated";
      const { state, simAttacker, apply } = f.project();
      const before = simAttacker.atk;
      assert.deepEqual(apply(), []);
      assert.equal(simAttacker.atk, before);
      assert.equal(canUseSimulatedEffectUsage(state, required(wanted.effects.find(effect => effect.id === "burning_west_wanted_reward")), required(state.bot.spellTrap[0]), seat, true), true);
    });
  }

  test(`Gunslinger without a payable discard preserves both hands and usage (${seat})`, t => {
    const f = scenario(t, seat, 451), target = f.make(1, "hand", true);
    const { state, simAttacker, apply } = f.project();
    assert.deepEqual(apply(), []);
    assert.deepEqual(state.player.hand.map(card => card.instanceId), [target.instanceId]);
    const effect = required(f.attacker.effects.find(effect => effect.id === "burning_west_gunslinger_battle_discard"));
    assert.equal(canUseSimulatedEffectUsage(state, effect, simAttacker, seat, true), true);
  });

  test(`Wanted without a legal reward leaves usage available (${seat})`, t => {
    const f = scenario(t, seat), wanted = f.make(452, "spellTrap");
    wanted.declaredValues = { burning_west_wanted_type: { property: "type", value: "Machine" } };
    const { state, apply } = f.project();
    state.bot.field.length = 0;
    assert.deepEqual(apply(), []);
    const effect = required(wanted.effects.find(effect => effect.id === "burning_west_wanted_reward"));
    assert.equal(canUseSimulatedEffectUsage(state, effect, required(state.bot.spellTrap[0]), seat, true), true);
  });

  test(`Wanted publishes exactly one completed summon and movement (${seat})`, t => {
    const f = scenario(t, seat), wanted = f.make(452, "spellTrap"), target = f.make(454, "hand");
    wanted.declaredValues = { burning_west_wanted_type: { property: "type", value: "Machine" } };
    const { apply } = f.project();
    const events: string[] = [];
    const options = { onSimulatedEvent: (event: string, payload: object) => {
      const card: unknown = Reflect.get(payload, "card");
      if (card && typeof card === "object" && Reflect.get(card, "instanceId") === target.instanceId) events.push(event);
    } };
    apply(options); apply(options);
    assert.equal(events.filter(event => event === "after_summon").length, 1);
    assert.equal(events.filter(event => event === "card_moved").length, 1);
  });

  test(`Gunslinger retains its discard policy and moves exact copies once (${seat})`, t => {
    const f = scenario(t, seat, 451);
    const cheap = f.make(458, "hand"), duplicate = f.make(458, "hand"), valuable = f.make(455, "hand");
    const opposingCheap = f.make(503, "hand", true), opposingValuable = f.make(1, "hand", true);
    const { state, apply } = f.project();
    const moved: unknown[] = [];
    const options = { onSimulatedEvent: (event: string, payload: object) => {
      if (event === "card_moved") moved.push(Reflect.get(payload, "card"));
    } };
    apply(options); apply(options);
    assert.deepEqual(state.bot.hand.map(card => card.instanceId), [duplicate.instanceId, valuable.instanceId]);
    assert.deepEqual(state.player.hand.map(card => card.instanceId), [opposingValuable.instanceId]);
    assert.equal(state.bot.graveyard.filter(card => card.instanceId === cheap.instanceId).length, 1);
    assert.equal(state.player.graveyard.filter(card => card.instanceId === opposingCheap.instanceId).length, 1);
    assert.equal(moved.length, 2);
  });

  test(`Peacemaker cannot report a protected target as destroyed (${seat})`, t => {
    const f = scenario(t, seat), equip = f.make(456, "spellTrap"), target = f.make(4, "spellTrap", true);
    equip.equippedTo = f.attacker; f.attacker.equips.push(equip);
    target.protectionEffects = [{ type: "effect_destruction", sourceOwner: "opponent", duration: "end_of_next_turn", expiresOnTurn: 5 }];
    const { state, summary, apply } = f.project();
    assert.deepEqual(apply(), []);
    assert.equal(state.player.spellTrap.length, 1);
    assert.equal(summary.destroyedCards.length, 1);
  });

  test(`Gunslinger negated after its paid cost keeps that cost and usage (${seat})`, async t => {
    const f = scenario(t, seat, 451, true), cost = f.make(458, "hand"), opposing = f.make(1, "hand", true);
    const { state, simAttacker, apply } = f.project();
    const effect = required(f.attacker.effects.find(entry => entry.id === "burning_west_gunslinger_battle_discard"));
    const chain = f.game.chainSystem;
    assert.ok(isFullChainHost(chain));
    const activation = chain.createPreparedActivation({ card: f.attacker, controller: f.owner, effect,
      activationZone: "field", committed: true, costsPaid: true,
      targetSelections: unsafeFixture<ChainSelectionMap>({ burning_west_gunslinger_cost: [cost] },
        "Chain selections use a runtime target-id map behind its nominal public projection"), context: {
        attacker: f.attacker, destroyed: f.destroyed, destroyedOwner: f.opponent,
        battleDestroyer: f.attacker, battleDestroyers: [f.attacker] } });
    assert.equal(activation.requiresSourceAtResolution, false, "Gunslinger is not a persistent source effect");
    const link = required(await chain.addToChain(activation));
    await f.game.effectEngine.applyActions(effect.activationCosts || [],
      { source: f.attacker, player: f.owner, opponent: f.opponent }, { burning_west_gunslinger_cost: [cost] });
    f.attacker.effectsNegated = true;
    const resolved = required(await chain.resolveChainLink(link));
    assert.equal(resolved.effectNegated, true);
    apply({ onSimulatedEvent: (event: string, payload: object) => {
      const card: unknown = Reflect.get(payload, "card");
      if (event === "card_moved" && card && typeof card === "object" && Reflect.get(card, "instanceId") === cost.instanceId) simAttacker.effectsNegated = true;
    } });
    assert.equal(state.bot.hand.length, f.owner.hand.length);
    assert.equal(state.player.hand.length, f.opponent.hand.length);
    assert.deepEqual(state.player.hand.map(card => card.instanceId), [opposing.instanceId]);
    assert.equal(canUseSimulatedEffectUsage(state, effect, simAttacker, seat, true), false);
  });

  for (const setOn of [4, 5]) {
    test(`Burning Reward set on turn ${setOn} cannot activate during turn 4 (${seat})`, t => {
      const f = scenario(t, seat), source = f.make(464, "spellTrap"), target = f.make(454, "graveyard");
      source.isFacedown = true; source.turnSetOn = setOn;
      assert.equal(f.game.canActivateTrap(source), false);
      const { state, apply } = f.project();
      assert.deepEqual(apply(), []);
      assert.equal(required(state.bot.spellTrap[0]).isFacedown, true);
      assert.ok(state.bot.graveyard.some(card => card.instanceId === target.instanceId));
      assert.equal(state.bot.hand.length, 0);
      const effect = required(source.effects.find(entry => entry.id === "burning_reward"));
      assert.equal(canUseSimulatedEffectUsage(state, effect, required(state.bot.spellTrap[0]), seat, true), true);
    });
  }

  test(`Burning Reward from a previous turn resolves and finalizes once (${seat})`, async t => {
    const f = scenario(t, seat, 455, true), source = f.make(464, "spellTrap"), target = f.make(454, "graveyard");
    source.isFacedown = true; source.turnSetOn = 3;
    assert.equal(f.game.canActivateTrap(source), true);
    const { state, apply } = f.project();
    const effect = required(source.effects.find(entry => entry.id === "burning_reward"));
    const chain = f.game.chainSystem;
    assert.ok(isFullChainHost(chain));
    source.isFacedown = false;
    await chain.addToChain(chain.createPreparedActivation({ card: source, controller: f.owner, effect,
      activationZone: "spellTrap", cardActivation: true, committed: true, costsPaid: true, context: {
        attacker: f.attacker, destroyed: f.destroyed, destroyedOwner: f.opponent,
        battleDestroyer: f.attacker, battleDestroyers: [f.attacker] } }));
    await chain.resolveChain();
    assert.ok(f.owner.graveyard.includes(source));
    const events: string[] = [];
    const options = { onSimulatedEvent: (event: string, payload: object) => {
      const card: unknown = Reflect.get(payload, "card");
      if (card && typeof card === "object" && Reflect.get(card, "instanceId") === source.instanceId) events.push(event);
    } };
    apply(options); apply(options);
    assert.equal(state.bot.spellTrap.length, f.owner.spellTrap.length);
    assert.equal(state.bot.hand.length, f.owner.hand.length);
    assert.equal(required(state.bot.hand[0]).instanceId, target.instanceId);
    assert.equal(state.bot.graveyard.filter(card => card.instanceId === source.instanceId).length, 1);
    assert.equal(events.filter(event => event === "card_to_grave").length, 1);
    assert.equal(events.filter(event => event === "card_moved").length, 1);
    assert.equal(f.game.checkEffectUsage({ card: source, player: f.owner, effect }).ok, false);
    assert.equal(canUseSimulatedEffectUsage(state, effect, required(state.bot.graveyard[0]), seat, true), false);
  });
}
