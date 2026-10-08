import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import BloomrotStrategy from "../../src/core/ai/BloomrotStrategy.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import type { DamageStepEventPayload } from "../../src/core/contracts/events.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationState } from "../helpers/simulation.js";

const ROT_ATTACK = "bloomrot_rot_stag_attack_spore_boost";
const ROT_DEFENSE = "bloomrot_rot_stag_defense_spore_boost";
const CARRION = "bloomrot_carrioncap_battle_destroy_spore_counter";

function scenario(t: TestContext, seat: "player" | "bot", id: 404 | 405) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
    captureReplay: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose("architecture_bloomrot_battle_test"));
  game.turn = seat; game.turnCounter = 4; game.phase = "battle"; game.battleStep = "battle";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.ui.showChainResponseModal = async () => null;
  game.ui.showConfirmPrompt = async () => true;
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  const definition = cardDefinition(id);
  const source = new Card({ ...definition, effects: definition.effects?.filter(effect =>
    [ROT_ATTACK, ROT_DEFENSE, CARRION].includes(effect.id || "")) ?? [] }, owner.id);
  source.isFacedown = false; source.position = "attack";
  const victim = new Card({ ...cardDefinition(1), effects: [], atk: 500, def: 500 }, opponent.id);
  victim.isFacedown = false; victim.position = "attack"; victim.addCounter("spore", 1);
  placeFieldCards(owner.field, source); placeFieldCards(opponent.field, victim);
  const recipient = (zone: "field" | "spellTrap" | "fieldSpell", facedown = false) => {
    const card = new Card({ ...cardDefinition(zone === "field" ? 1 : zone === "fieldSpell" ? 417 : 452), effects: [] }, opponent.id);
    card.isFacedown = facedown; card.position = "attack";
    if (zone === "fieldSpell") opponent.fieldSpell = card;
    else placeFieldCards(opponent[zone], card);
    return card;
  };
  const project = () => {
    const copy = createPlanningCopy();
    const player = (actor: typeof owner) => ({ id: actor.id, lp: actor.lp,
      field: actor.field.map(copy.cloneCardForSim), spellTrap: actor.spellTrap.map(copy.cloneCardForSim),
      fieldSpell: actor.fieldSpell ? copy.cloneCardForSim(actor.fieldSpell) : null,
      hand: actor.hand.map(copy.cloneCardForSim), graveyard: actor.graveyard.map(copy.cloneCardForSim),
      deck: actor.deck.map(copy.cloneCardForSim), extraDeck: actor.extraDeck.map(copy.cloneCardForSim) });
    const { temporaryEventEffects: unused, ...state } = simulationState({ _isPerspectiveState: true,
      turn: seat, turnCounter: 4, phase: "battle", bot: player(owner), player: player(opponent) });
    void unused;
    const simSource = required(state.bot.field.find(card => card.instanceId === source.instanceId));
    const simVictim = required(state.player.field.find(card => card.instanceId === victim.instanceId));
    const strategy = new BloomrotStrategy(state.bot);
    const options = strategy.getPlanningSimulationOptions(state);
    const prepare = (defending = false, preparingSource = simSource) => strategy.prepareSimulatedBattle(
      unsafeFixture<NonNullable<Parameters<typeof strategy.prepareSimulatedBattle>[0]>>({ state, bot: state.bot,
        opponent: state.player, options, attacker: defending ? simVictim : preparingSource,
        target: defending ? preparingSource : simVictim },
      "The actual TurnLineSearch hook includes state, physical owners and planning options beyond Bloomrot's legacy narrow projection"));
    const summary = { damage: 1100, destroyedCards: [{ ...simVictim, owner: "opponent", destroyedBy: "battle",
      card: simVictim, position: simVictim.position }] };
    const apply = () => strategy.applySimulatedBattleRewards(
      unsafeFixture<NonNullable<Parameters<typeof strategy.applySimulatedBattleRewards>[0]>>({ state, bot: state.bot,
        opponent: state.player, options, battlePlan: { attackerCard: simSource }, summary },
      "This is TurnLineSearch's actual rich battle reward input with the physical destroyed-card identity"));
    const finishDestruction = () => assert.equal(moveCardToZone(state.player, simVictim, "graveyard", state.player, { state }), true);
    const findRecipient = (card: Card) => required([...state.player.field, ...state.player.spellTrap,
      ...(state.player.fieldSpell ? [state.player.fieldSpell] : [])].find(entry => entry.instanceId === card.instanceId));
    return { state, simSource, simVictim, strategy, prepare, summary, apply, finishDestruction, findRecipient };
  };
  const damage = async (defending = false, attacker = source, defender = victim) => {
    game.battleStep = "damage";
    const actualAttacker = defending ? defender : attacker, actualDefender = defending ? attacker : defender;
    const attackerOwner = defending ? opponent : owner, defenderOwner = defending ? owner : opponent;
    const payload: DamageStepEventPayload = { attacker: actualAttacker, defender: actualDefender,
      attackerOwner, defenderOwner, target: actualDefender, targetOwner: defenderOwner, player: attackerOwner,
      damageStepId: 1, damageStepTiming: "before_damage_calculation", isDamageStep: true, directAttack: false,
      amount: 0, damageDealt: 0, before: null, after: null, lpGained: 0,
      pendingBattleDestructionCards: [], targetDestroyed: false, attackerDestroyed: false };
    await game.emit("battle_damage", payload);
  };
  return { game, owner, opponent, source, victim, recipient, project, damage };
}

for (const seat of ["player", "bot"] as const) {
  test(`Rot-Stag initial marked-target ATK agrees with runtime (${seat})`, async t => {
    const f = scenario(t, seat, 404), sim = f.project();
    await f.damage(); sim.prepare();
    assert.equal(f.source.atk, 2500); assert.equal(sim.simSource.atk, f.source.atk);
    assert.equal(sim.simSource.def, f.source.def, "the declared action modifies only ATK");
  });

  test(`Rot-Stag consumes the shared attack/defense hard OPT ledger (${seat})`, async t => {
    const f = scenario(t, seat, 404), sim = f.project();
    await f.damage(); sim.prepare();
    for (const id of [ROT_ATTACK, ROT_DEFENSE]) {
      const effect = required(f.source.effects.find(entry => entry.id === id));
      assert.equal(f.game.canUseOncePerTurn(f.source, f.owner, effect).ok, false);
      assert.equal(canUseSimulatedEffectUsage(sim.state, effect, sim.simSource, seat, true), false);
    }
  });

  test(`Rot-Stag repeated battle preparation cannot stack its boost (${seat})`, async t => {
    const f = scenario(t, seat, 404), sim = f.project();
    await f.damage(); await f.damage(); sim.prepare(); sim.prepare();
    assert.equal(f.source.atk, 2500); assert.equal(sim.simSource.atk, f.source.atk);
  });

  test(`Rot-Stag shares the spent battle limit with another physical copy (${seat})`, async t => {
    const f = scenario(t, seat, 404);
    const second = new Card({ ...cardDefinition(404), effects: f.source.effects }, f.owner.id);
    second.isFacedown = false; second.position = "attack"; placeFieldCards(f.owner.field, second);
    const sim = f.project(), simSecond = required(sim.state.bot.field.find(card => card.instanceId === second.instanceId));
    await f.damage(); await f.damage(false, second); sim.prepare(); sim.prepare(false, simSecond);
    assert.equal(second.atk, 2000); assert.equal(simSecond.atk, second.atk);
    assert.notEqual(second.instanceId, f.source.instanceId);
  });

  for (const blocked of ["negated", "unmarked"] as const) {
    test(`Rot-Stag rejects ${blocked} battle bonus (${seat})`, async t => {
      const f = scenario(t, seat, 404);
      if (blocked === "negated") f.source.effectsNegated = true;
      else f.victim.removeCounter("spore", 1);
      const sim = f.project(); await f.damage(); sim.prepare();
      assert.equal(f.source.atk, 2000); assert.equal(sim.simSource.atk, f.source.atk);
    });
  }

  for (const position of ["attack", "defense"] as const) {
    test(`Rot-Stag defending in ${position} position changes ATK only during actual combat (${seat})`, async t => {
      const f = scenario(t, seat, 404);
      f.source.position = position; f.victim.atk = 2300;
      f.game.turn = seat === "player" ? "bot" : "player";
      const sim = f.project(), observed: number[][] = [];
      f.game.on("chain_link_resolution", event => {
        if (event.effectId === ROT_DEFENSE && event.stage === "completed") observed.push([f.source.atk, f.source.def]);
      });
      await f.game.resolveCombat(f.victim, f.source);
      assert.deepEqual(observed, [[2500, 1900]], "runtime resolves an ATK bonus even when the card is the defender");
      assert.deepEqual([f.source.atk, f.source.def], [2000, 1900], "damage-calculation bonus expires after combat");
      if (position === "defense") {
        assert.ok(f.owner.graveyard.includes(f.source), "1900 DEF still loses to 2300 ATK");
        sim.prepare(true); assert.equal(sim.simSource.def, observed[0]?.[1]);
      } else {
        assert.ok(f.opponent.graveyard.includes(f.victim), "2500 defending ATK beats the 2300 attacker");
        assert.deepEqual(sim.prepare(true), [], "an opponent defender's boost is not the attacker's positive reward");
        assert.equal(sim.simSource.atk, observed[0]?.[0]);
      }
    });
  }

  for (const zone of ["field", "spellTrap", "fieldSpell"] as const) {
    test(`Carrioncap can place one spore on the sole legal ${zone} reference (${seat})`, async t => {
      const f = scenario(t, seat, 405), recipient = f.recipient(zone), sim = f.project();
      const simRecipient = sim.findRecipient(recipient);
      let targeted = 0, completed = 0;
      f.game.on("effect_targeted", event => { if (event.effect?.id === CARRION) targeted++; });
      f.game.on("chain_link_resolution", event => { if (event.effectId === CARRION && event.stage === "completed") completed++; });
      sim.prepare(); await f.game.resolveCombat(f.source, f.victim); sim.finishDestruction(); sim.apply();
      assert.equal(recipient.getCounter("spore"), 1); assert.equal(completed, 1); assert.equal(targeted, 0);
      assert.equal(getCounterValue(simRecipient, "spore"), recipient.getCounter("spore"));
      assert.equal(sim.state.player.graveyard.filter(card => card.instanceId === f.victim.instanceId).length, 1);
    });
  }

  test(`Carrioncap consumes its hard OPT and cannot duplicate the same reward (${seat})`, async t => {
    const f = scenario(t, seat, 405), recipient = f.recipient("field"), sim = f.project();
    sim.prepare(); await f.game.resolveCombat(f.source, f.victim); sim.finishDestruction(); sim.apply();
    const effect = required(f.source.effects.find(entry => entry.id === CARRION));
    assert.equal(f.game.canUseOncePerTurn(f.source, f.owner, effect).ok, false);
    assert.equal(canUseSimulatedEffectUsage(sim.state, effect, sim.simSource, seat, true), false);
    assert.deepEqual(sim.apply(), [], "an already consumed source must not publish another reward");
    assert.equal(getCounterValue(sim.findRecipient(recipient), "spore"), recipient.getCounter("spore"));
  });

  test(`Carrioncap shares its reward limit across physical copies (${seat})`, async t => {
    const f = scenario(t, seat, 405); f.recipient("field");
    const second = new Card({ ...cardDefinition(405), effects: f.source.effects }, f.owner.id);
    second.isFacedown = false; second.position = "attack"; placeFieldCards(f.owner.field, second);
    const sim = f.project(), simSecond = required(sim.state.bot.field.find(card => card.instanceId === second.instanceId));
    sim.prepare(); await f.game.resolveCombat(f.source, f.victim); sim.finishDestruction(); sim.apply();
    const effect = required(second.effects.find(entry => entry.id === CARRION));
    assert.equal(f.game.canUseOncePerTurn(second, f.owner, effect).ok, false);
    assert.equal(canUseSimulatedEffectUsage(sim.state, effect, simSecond, seat, true), false);
  });

  test(`Carrioncap negation prevents a reward without changing recipient (${seat})`, async t => {
    const f = scenario(t, seat, 405), recipient = f.recipient("field"); f.source.effectsNegated = true;
    const sim = f.project(); sim.prepare(); await f.game.resolveCombat(f.source, f.victim);
    sim.finishDestruction(); const rewards = sim.apply();
    assert.equal(recipient.getCounter("spore"), 0);
    assert.equal(getCounterValue(sim.findRecipient(recipient), "spore"), recipient.getCounter("spore"));
    assert.deepEqual(rewards, [], "negated Carrioncap cannot report a resolved reward");
    assert.equal(Reflect.get(required(sim.findRecipient(recipient).counters), "spore"), undefined,
      "blocked effects cannot write a phantom property into the canonical Map");
  });

  test(`Carrioncap preserves the selected physical instance among same-name recipients (${seat})`, async t => {
    const f = scenario(t, seat, 405), weak = f.recipient("field"), strong = f.recipient("field");
    weak.atk = weak.def = 100; strong.atk = strong.def = 3000;
    const select = f.game.autoSelector.select.bind(f.game.autoSelector);
    f.game.autoSelector.select = (contract, context) => {
      const result = f.game.normalizeSelectionContract(contract);
      if (!result.ok) return select(contract, context);
      const choice = result.contract.requirements.find(entry => entry.id === "bloomrot_carrioncap_battle_spore_target");
      if (!choice) return select(contract, context);
      const candidate = required(choice.candidates.find(entry => entry.cardRef === strong));
      // Deterministic runtime oracle uses the legacy hook's highest-threat
      // monster. This does not assert a preference between different zones.
      return { ok: true, selections: { [choice.id]: [candidate.key] } };
    };
    const sim = f.project(); sim.prepare();
    await f.game.resolveCombat(f.source, f.victim); sim.finishDestruction(); sim.apply();
    assert.equal(weak.getCounter("spore"), 0); assert.equal(strong.getCounter("spore"), 1);
    assert.equal(getCounterValue(sim.findRecipient(weak), "spore"), 0);
    assert.equal(getCounterValue(sim.findRecipient(strong), "spore"), 1);
    assert.notEqual(weak.instanceId, strong.instanceId);
  });

  for (const blocked of ["unmarked", "facedown-recipient", "immune-recipient"] as const) {
    test(`Carrioncap honors ${blocked} battle control (${seat})`, async t => {
      const f = scenario(t, seat, 405), recipient = f.recipient("field", blocked === "facedown-recipient");
      if (blocked === "unmarked") f.victim.removeCounter("spore", 1);
      if (blocked === "immune-recipient") recipient.unaffectedByOtherCardEffects = true;
      const sim = f.project(); sim.prepare(); await f.game.resolveCombat(f.source, f.victim);
      sim.finishDestruction(); sim.apply();
      assert.equal(recipient.getCounter("spore"), 0);
      assert.equal(getCounterValue(sim.findRecipient(recipient), "spore"), 0);
      assert.equal(Reflect.get(required(sim.findRecipient(recipient).counters), "spore"), undefined,
        "blocked effects cannot write a phantom property into the canonical Map");
    });
  }
}
