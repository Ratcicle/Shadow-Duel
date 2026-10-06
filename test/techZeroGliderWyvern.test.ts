import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../src/core/Bot.js";
import Card from "../src/core/Card.js";
import TechZeroStrategy from "../src/core/ai/TechZeroStrategy.js";
import { getGenericHandSummonProcedureActions } from "../src/core/ai/common/actionGeneration.js";
import type { AiLiveGamePort } from "../src/core/contracts/aiState.js";
import type { BotGamePort } from "../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext, id: 504 | 508, seat: "player" | "bot" = "player") {
  const first = new Bot("techzero"); first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, laboratoryMode: true, chainResponseTimeoutMs: 0 });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime interface for both physical seats");
  t.after(() => game.dispose("tech_zero_hand_procedure_test"));
  game.turn = seat; game.turnCounter = 2; game.phase = "main1";
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => false;
  game.ui.showChainResponseModal = async () => null;
  const owner = game[seat], opponent = game.getOpponent(owner);
  const source = new Card(cardDefinition(id), owner.id), other = new Card(cardDefinition(id), owner.id);
  owner.hand.push(source, other);
  const tuner = new Card(cardDefinition(501), owner.id);
  if (id === 504) placeFieldCards(owner.field, tuner);
  const port = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game, "Concrete Game supplies attached Bot execution and clone capabilities");
  return { game, owner, opponent, source, other, tuner, bot: seat === "player" ? first : second, port };
}

for (const id of [504, 508] as const) for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) test(`${id} hand procedure summons without activation and shares only successful summons (${seat}/${controller})`, async t => {
    const { game, owner, source, other } = setup(t, id, seat);
    owner.controllerType = controller;
    const links = t.mock.method(game.chainSystem, "addToChain");
    let activations = 0, summons = 0;
    game.on("effect_activated", () => { activations++; });
    game.on("after_summon", event => { if (event.card === source) { assert.equal(event.method, "special"); summons++; } });
    const result = await game.performHandSummonProcedure(source, owner, { position: "attack" });
    assert.equal(result.success, true);
    assert.equal(activations, 0); assert.equal(links.mock.callCount(), 0); assert.equal(summons, 1);
    const procedure = required(source.handSummonProcedure);
    assert.equal(source.lastSummonProcedure, procedure.id);
    assert.equal(game.canUseOncePerTurn(other, owner, required(other.handSummonProcedure)).ok, false);
    await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
    assert.equal((await game.performHandSummonProcedure(other, owner, { position: "attack" })).success, false);
    game.turnCounter += 2;
    assert.equal((await game.performHandSummonProcedure(other, owner, { position: "attack" })).success, true);
  });

  test(`${id} cancelling manual placement pays nothing and consumes no successful summon (${seat})`, async t => {
    const { game, owner, source, other } = setup(t, id, seat);
    owner.controllerType = "human"; game.getFieldPlacementMode = () => "manual";
    let decisions = 0;
    game.fieldPlacementProvider = async request => { decisions++; assert.equal(request.allowCancel, true); return { outcome: "cancelled" }; };
    const result = await game.performHandSummonProcedure(source, owner, { position: "attack" });
    assert.equal(decisions, 1); assert.equal(result.cancelled, true);
    assert.ok(owner.hand.includes(source)); assert.ok(owner.hand.includes(other));
    assert.equal(game.canUseOncePerTurn(other, owner, required(other.handSummonProcedure)).ok, true);
    assert.equal(game.lastSummonTransaction, null);
  });

  test(`${id} revalidates its condition after the human placement choice (${seat})`, async t => {
    const { game, owner, source, other, tuner } = setup(t, id, seat);
    owner.controllerType = "human"; game.getFieldPlacementMode = () => "manual";
    game.fieldPlacementProvider = async () => {
      if (id === 504) tuner.isFacedown = true;
      else { const hidden = new Card({ name: "New facedown monster", cardKind: "monster" }, owner.id); hidden.isFacedown = true; placeFieldCards(owner.field, hidden); }
      return { outcome: "chosen", slot: 4 };
    };
    const result = await game.performHandSummonProcedure(source, owner, { position: "attack" });
    assert.equal(result.success, false);
    assert.ok(owner.hand.includes(source)); assert.equal(owner.graveyard.includes(source), false);
    assert.equal(game.canUseOncePerTurn(other, owner, required(other.handSummonProcedure)).ok, true);
  });

  test(`${id} real summon negation leaves the named procedure available to another copy (${seat})`, async t => {
    const { game, owner, opponent, source, other } = setup(t, id, seat);
    opponent.controllerType = "human";
    const negator = new Card(cardDefinition(275), opponent.id); placeFieldCards(opponent.field, negator);
    let chosen = false;
    game.ui.showChainResponseModal = async (candidates, context) => {
      const response = candidates.find(candidate => candidate.card === negator);
      if (!chosen && response) { assert.equal(context?.type, "summon_attempt"); chosen = true; return response; }
      return null;
    };
    const result = await game.performHandSummonProcedure(source, owner, { position: "attack" });
    assert.equal(chosen, true); assert.equal(result.summonNegated, true); assert.equal(result.success, false);
    assert.ok(owner.graveyard.includes(source));
    assert.equal(game.canUseOncePerTurn(other, owner, required(other.handSummonProcedure)).ok, true);
    assert.equal((await game.performHandSummonProcedure(other, owner, { position: "attack" })).success, true);
    assert.equal(game.canUseOncePerTurn(other, owner, required(other.handSummonProcedure)).ok, false);
  });

  test(`${id} registered Tech-Zero routes discovery, simulation and execution through its hand procedure (${seat})`, async t => {
    const { game, owner, source, other, bot, port } = setup(t, id, seat);
    owner.summonCount = 1;
    const state = bot.cloneGameState(port), strategy = new TechZeroStrategy(state.bot);
    const actions = strategy.generateMainPhaseActions(state);
    const action = required(actions.find(candidate => candidate.type === "handSummonProcedure" && candidate.cardId === id));
    assert.equal(actions.some(candidate => candidate.type === "handIgnition" && candidate.cardId === id), false);
    assert.equal(getGenericHandSummonProcedureActions(state).filter(candidate => candidate.cardId === id).length, 2);
    strategy.simulateMainPhaseAction(state, action);
    assert.ok(state.bot.field.some(card => card.instanceId === source.instanceId));
    assert.equal(state.bot.summonCount, 1);
    assert.equal(getGenericHandSummonProcedureActions(state).some(candidate => candidate.cardId === id), false);
    assert.ok(owner.hand.includes(source)); assert.ok(owner.hand.includes(other));
    assert.equal(await bot.executeMainPhaseAction(port, action), true);
    assert.ok(owner.field.includes(source));
    assert.equal(game.canUseOncePerTurn(other, owner, required(other.handSummonProcedure)).ok, false);
  });
}

test("Glider requires an identifiable face-up own Tech-Zero Tuner; Pulse counts facedown monsters", async t => {
  const { game, owner, opponent, source, tuner } = setup(t, 504);
  assert.equal(game.canSummonFromHandByProcedure(source, owner).ok, true);
  tuner.isFacedown = true;
  assert.equal(game.canSummonFromHandByProcedure(source, owner).ok, false);
  tuner.isFacedown = false; tuner.isTuner = false;
  assert.equal(game.canSummonFromHandByProcedure(source, owner).ok, false);
  tuner.isTuner = true; tuner.archetype = "Other"; tuner.archetypes = ["Other"];
  assert.equal(game.canSummonFromHandByProcedure(source, owner).ok, false);
  owner.field = []; tuner.archetype = "Tech-Zero"; tuner.archetypes = ["Tech-Zero"]; placeFieldCards(opponent.field, tuner);
  assert.equal(game.canSummonFromHandByProcedure(source, owner).ok, false);
  const pulse = new Card(cardDefinition(508), owner.id); owner.hand.push(pulse);
  assert.equal(game.canSummonFromHandByProcedure(pulse, owner).ok, true);
  const hidden = new Card({ name: "Own hidden monster", cardKind: "monster" }, owner.id); hidden.isFacedown = true;
  placeFieldCards(owner.field, hidden);
  assert.equal(game.canSummonFromHandByProcedure(pulse, owner).ok, false);
  assert.equal((await game.performHandSummonProcedure(pulse, owner, { position: "attack" })).success, false);
});
