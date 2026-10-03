import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { PlayerId } from "../src/core/contracts/primitives.js";
import { collectPositionChangeTriggers } from "../src/core/effects/triggers/collectors/positionChange.js";
import type { TriggerCollectorHost } from "../src/core/effects/triggers/runtime.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { attachSimulatedEventEmitter } from "../src/core/ai/common/simulation.js";
import { ensureSimOncePerTurnBucket } from "../src/core/ai/common/simStateUtils.js";
import MirageboundStrategy from "../src/core/ai/MirageboundStrategy.js";
import type { AIStrategyBotPort } from "../src/core/contracts/ai.js";
import { SUMMON_ORIGINS } from "../src/core/contracts/summon.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { simulationState } from "./helpers/simulation.js";

const modes = ["miragebound_oasis_return_weaken", "miragebound_oasis_shift_weaken"] as const;
type Mode = typeof modes[number];
const make = (id: number, owner: PlayerId) => new Card(cardDefinition(id), owner);
const passes = () => ({ offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false });

function setup(t: TestContext, seat: PlayerId = "player", controller: "human" | "ai" = "ai") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "ai";
  game[seat].controllerType = controller;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => false;
  game.ui.showChainResponseModal = async () => null;
  const owner = game[seat], opponent = game.getOpponent(owner);
  const oasis = make(354, seat), own = make(351, seat), foe = make(351, opponent.id);
  owner.fieldSpell = oasis; placeFieldCards(owner.field, own); placeFieldCards(opponent.field, foe);
  for (const card of [oasis, own, foe]) game.ensureDuelCardId(card);
  t.after(() => game.dispose());
  return { game, owner, opponent, oasis, own, foe };
}

async function choose(game: RuntimeGame, action: Promise<unknown>, mode: Mode, cancel = false) {
  let done = false, failure: unknown, cancelled = false;
  const pending = new Set<Promise<void>>();
  const completion = action.then(() => { done = true; }, error => { done = true; failure = error; });
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      if (cancel && session.kind === "choice" && !cancelled) { cancelled = true; game.cancelTargetSelection(); }
      else {
        if (session.kind !== "choice") assert.equal(session.allowCancel, false, "committed effect targets are mandatory");
        for (const requirement of session.requirements) {
          const selected = requirement.candidates.find(candidate => candidate.cardRef?.id === mode);
          session.selections[requirement.id] = selected ? [selected.key] : requirement.candidates.slice(0, requirement.min).map(candidate => candidate.key);
        }
        const resolution = game.finishTargetSelection();
        pending.add(resolution);
        void resolution.then(() => pending.delete(resolution), error => { pending.delete(resolution); failure = error; });
      }
    }
    if (done && !game.targetSelection && pending.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done && !game.targetSelection && pending.size === 0, "all choices must finish");
  await completion;
  if (failure) throw failure;
  if (cancel) assert.equal(cancelled, true);
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) for (const mode of modes) {
  test(`Oasis declares ${mode} before responses (${seat}, ${controller})`, async t => {
    const { game, owner, oasis, own, foe } = setup(t, seat, controller);
    if (controller === "ai") {
      const select = game.autoSelector.select.bind(game.autoSelector);
      game.autoSelector.select = (contract, context) => select(contract, { ...required(context), activationContext: {
        ...context?.activationContext, decisions: { ...context?.activationContext?.decisions, cases: { miragebound_oasis_ignition: mode } },
      } });
    }
    let windows = 0;
    let returnObserved = false;
    game.on("card_moved", event => {
      if (event.card !== own || event.toZone !== "hand") return;
      returnObserved = true;
      assert.equal(foe.atk, 1400, "the return movement completes before the second action changes stats");
    });
    game.chainSystem.offerChainResponses = async () => {
      const link = game.chainSystem.chainStack.find(entry => entry.card === oasis && entry.effect.id === "miragebound_oasis_ignition" && entry.resolutionStatus === "pending");
      if (!link) return passes();
      windows++;
      assert.equal(link.effect?.activationCaseId, mode);
      assert.ok(owner.field.includes(own), "return happens during resolution");
      assert.equal(foe.position, "attack");
      assert.equal(foe.atk, 1400);
      assert.deepEqual(Object.keys(link.targetSelections).sort(), mode === modes[0]
        ? ["miragebound_oasis_return_target", "miragebound_oasis_return_weaken_target"]
        : ["miragebound_oasis_weaken_target"]);
      return passes();
    };
    const action = Promise.resolve(game.activateFieldSpellEffect(oasis));
    await choose(game, action, mode);
    assert.equal((await action).success, true, (await action).reason ?? undefined);
    assert.equal(windows, 1);
    assert.equal(foe.atk, 1000);
    if (mode === modes[0]) { assert.ok(owner.hand.includes(own)); assert.equal(returnObserved, true); }
    else { assert.equal(foe.position, "defense"); assert.ok(owner.field.includes(own)); }
  });
}

test("Oasis allows mode cancellation before commitment without consuming the effect", async t => {
  const { game, oasis, owner, own } = setup(t, "player", "human");
  let announcements = 0;
  game.on("effect_activated", event => { if (event.card === oasis) announcements++; });
  const action = Promise.resolve(game.activateFieldSpellEffect(oasis));
  await choose(game, action, modes[0], true);
  assert.equal(announcements, 0);
  assert.ok(owner.field.includes(own));
  assert.equal(game.effectEngine.canActivateFieldSpellEffectPreview(oasis, owner).ok, true);
});

test("Oasis cannot use a hidden Miragebound; generic opposing monster may be face-down", async t => {
  const { game, owner, oasis, own, foe } = setup(t);
  own.isFacedown = true; foe.isFacedown = true;
  assert.equal(game.effectEngine.canActivateFieldSpellEffectPreview(oasis, owner).ok, false);
  own.isFacedown = false;
  assert.equal(game.effectEngine.canActivateFieldSpellEffectPreview(oasis, owner).ok, true);
  const action = Promise.resolve(game.activateFieldSpellEffect(oasis));
  await choose(game, action, modes[0]);
  assert.ok(owner.hand.includes(own));
  assert.equal(foe.atk, 1000);
  assert.equal(foe.isFacedown, true);
});

for (const move of ["leave", "leave_return"] as const) test(`Oasis failed return does not apply its second action: ${move}`, async t => {
  const { game, owner, oasis, own, foe } = setup(t);
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.chainStack.find(entry => entry.card === oasis);
    if (!link) return passes();
    await game.moveCard(own, owner, "graveyard", { fromZone: "field" });
    if (move === "leave_return") await game.moveCard(own, owner, "field", { fromZone: "graveyard", summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION, summonMethod: "special" });
    return passes();
  };
  const select = game.autoSelector.select.bind(game.autoSelector);
  game.autoSelector.select = (contract, context) => select(contract, { ...required(context), activationContext: {
    ...context?.activationContext, decisions: { cases: { miragebound_oasis_ignition: modes[0] } },
  } });
  const action = Promise.resolve(game.activateFieldSpellEffect(oasis));
  await choose(game, action, modes[0]);
  assert.equal(foe.atk, 1400);
  assert.equal(owner.hand.includes(own), false);
});

test("Oasis event locks use canonical duel identity, distinguish copies and reset each turn", async t => {
  const { game, oasis, opponent, foe } = setup(t);
  const second = make(351, opponent.id); placeFieldCards(opponent.field, second);
  const event = (card: Card) => ({ card, player: opponent, opponent: game.getOpponent(opponent), fromPosition: "attack" as const, toPosition: "defense" as const });
  const collector = unsafeFixture<TriggerCollectorHost>(game.effectEngine,
    "The real EffectEngine installs this collector; its strategy projection has a wider public host type");
  const collected = await collectPositionChangeTriggers.call(collector, event(foe));
  const effect = required(collected.entries.find(entry => entry.card === oasis)?.effect);
  assert.equal(effect.oncePerTurnName, `miragebound_oasis_position_debuff:event_card:${foe.duelCardId}`);
  const other = await collectPositionChangeTriggers.call(collector, event(second));
  const secondEffect = required(other.entries.find(entry => entry.card === oasis)?.effect);
  assert.ok(second.duelCardId, "headless cards obtain a canonical ID before reserving their lock");
  assert.notEqual(effect.oncePerTurnName, secondEffect.oncePerTurnName);
  await game.emit("position_change", event(foe));
  assert.equal(foe.atk, 1000);
  await game.emit("position_change", event(foe));
  assert.equal(foe.atk, 1000);
  await game.emit("position_change", event(second));
  assert.equal(second.atk, 1000);
  game.resetOncePerTurnUsage("start_turn"); game.turnCounter++;
  await game.emit("position_change", event(foe));
  assert.equal(foe.atk, 600);
});

test("Oasis simulation uses the same canonical event-card lock as runtime", () => {
  const clone = createPlanningCopy().cloneCardForSim;
  const oasis = clone(make(354, "bot")), eventCard = make(351, "player");
  const identity = createRuntimeGame({ disableChains: true });
  const duelCardId = identity.ensureDuelCardId(eventCard); identity.dispose();
  const foe = clone(eventCard);
  const state = simulationState({ turnCounter: 3, bot: { fieldSpell: oasis }, player: { field: [foe] } });
  applySimulatedActions({ state, selfId: "bot", actions: [{ type: "switch_position", targetRef: "foe" }], selections: { foe: [foe] },
    options: attachSimulatedEventEmitter(state, { enableSimulatedEvents: true }) });
  assert.equal(foe.atk, 1000);
  assert.equal(ensureSimOncePerTurnBucket(state, "bot").get(`miragebound_oasis_position_debuff:event_card:${duelCardId}`), 1);
  applySimulatedActions({ state, selfId: "bot", actions: [{ type: "switch_position", targetRef: "foe" }], selections: { foe: [foe] },
    options: attachSimulatedEventEmitter(state, { enableSimulatedEvents: true }) });
  assert.equal(foe.atk, 1000, "second change of the same monster cannot repeat its debuff");
  state.turnCounter++;
  applySimulatedActions({ state, selfId: "bot", actions: [{ type: "switch_position", targetRef: "foe" }], selections: { foe: [foe] },
    options: attachSimulatedEventEmitter(state, { enableSimulatedEvents: true }) });
  assert.equal(foe.atk, 600, "the canonical per-monster lock resets next turn");
});

test("Oasis simulation policy reads the preference by parent activation effect ID", () => {
  const strategy = new MirageboundStrategy(unsafeFixture<AIStrategyBotPort>(null,
    "The pure mode-selection policy reads the supplied cases and activation context without accessing the actor"));
  const choices = [{ id: modes[0], label: "return" }, { id: modes[1], label: "shift" }];
  assert.equal(strategy.chooseActionCase(choices, { activationContext: {
    targetPreferences: { miragebound_oasis_ignition: { preferredNames: ["shift"] } },
  } }), choices[1]);
});
