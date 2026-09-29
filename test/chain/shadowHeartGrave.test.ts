import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRuntimeGame } from "../helpers/game.js";
import { required } from "../helpers/fixtures.js";
import { FAST_EFFECT_ORIGINS } from "../../src/core/contracts/chain.js";
import type { FastEffectContextInput } from "../../src/core/contracts/chainRuntime.js";
import { DAMAGE_STEP_TIMINGS } from "../../src/core/contracts/effects.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turnCounter = 3;
  game.applyScenarioSetup({ schemaVersion: 2, turn: "bot", phase: "main1",
    player: { hand: [{ id: 104 }], field: [{ id: 125, fieldSlot: 0 }], spellTrap: [{ id: 126, fieldSlot: 0, facedown: true }], graveyard: [{ id: 126 }, { id: 104 }] },
    bot: { hand: [], field: [], spellTrap: [] },
  }, { immediateActions: true });
  game.player.controllerType = "ai";
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.waitForBoardPresentation = async () => {};
  return game;
}

test("Grave is offered off-turn only with a legal summon and outside the Damage Step", (t) => {
  const game = setup(t);
  const source = required(game.player.spellTrap[0]);
  const context: FastEffectContextInput = { type: "phase_change", event: "phase_end", player: game.bot, triggerPlayer: game.bot, openState: true, legalWindow: true };
  const candidates = () => game.chainSystem.getActivatableCardsInChain(game.player, context);
  assert.equal(candidates().filter(c => c.card === source).length, 1);
  assert.equal(candidates().some(c => c.sourceZone === "graveyard"), false, "speed-one recovery cannot respond");
  game.player.summonCount = 1;
  assert.equal(candidates().length, 0);
  game.player.summonCount = 0;
  source.setTurn = game.turnCounter;
  assert.equal(candidates().length, 0);
  source.setTurn = 1;
  assert.equal(game.chainSystem.getActivatableCardsInChain(game.player, { ...context, damageStepTiming: DAMAGE_STEP_TIMINGS.START }).length, 0);
  game.player.field = [];
  assert.equal(candidates().length, 0, "Arctroth requires Tributes");
});

test("Grave resolves a Tribute Summon within the Chain without a summon-negation window", async (t) => {
  const game = setup(t);
  const source = required(game.player.spellTrap[0]);
  const effect = required(source.effects[0]);
  const monster = required(game.player.hand[0]);
  let summonAttempts = 0;
  const events: string[] = [];
  game.on("after_summon", event => { if (event.card === monster) events.push(String(event.method)); });
  const originalTiming = game.chainSystem.runFastEffectTiming.bind(game.chainSystem);
  game.chainSystem.runFastEffectTiming = async input => {
    if (input?.origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) summonAttempts++;
    return await originalTiming(input);
  };
  source.isFacedown = false;
  required(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({
    card: source, controller: game.player, effect, activationZone: "spellTrap", committed: true, costsPaid: true,
    activationContext: { sourceWasFacedown: true },
  })));
  await game.chainSystem.resolveChain();
  assert.ok(game.player.field.includes(monster));
  assert.equal(monster.position, "attack");
  assert.equal(monster.isFacedown, false);
  assert.equal(game.player.summonCount, 1);
  assert.deepEqual(events, ["tribute"]);
  assert.equal(summonAttempts, 0);
  assert.ok(game.player.graveyard.includes(source));
});

test("negated activations consume each Grave effect independently across copies and retain paid banishment", async (t) => {
  const game = setup(t);
  const chain = game.chainSystem;
  const source = required(game.player.spellTrap[0]);
  const copy = required(game.player.graveyard.find(c => c.id === 126));
  const summon = required(source.effects[0]);
  const recover = required(source.effects[1]);
  source.isFacedown = false;
  required(chain.addToChain(chain.createPreparedActivation({ card: source, controller: game.player, effect: summon,
    activationZone: "spellTrap", activationContext: { sourceWasFacedown: true }, committed: true, costsPaid: true, activationNegated: true })));
  await chain.resolveChain();
  assert.equal(chain.checkActivationUsage(copy, game.player, summon).ok, false);
  assert.equal(chain.checkActivationUsage(copy, game.player, recover).ok, true);
  assert.equal(game.player.summonCount, 0);
  const prepared = chain.createPreparedActivation({ card: source, controller: game.player, effect: recover,
    activationZone: "graveyard", committed: true, activationNegated: true });
  assert.equal((await chain.payActivationCosts(prepared)).success, true);
  required(chain.addToChain(prepared));
  await chain.resolveChain();
  assert.ok(game.player.banished.includes(source));
  assert.equal(game.player.hand.length, 1, "negated recovery adds nothing");
  assert.equal(chain.checkActivationUsage(copy, game.player, recover).ok, false);
});
