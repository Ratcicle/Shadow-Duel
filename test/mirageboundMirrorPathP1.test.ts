import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { applyGenericSimulatedMainPhaseAction } from "../src/core/ai/common/simulation.js";
import { destroySimulatedCard } from "../src/core/ai/common/simulatedActions/destruction.js";
import { cardDefinition, required, chainSelections, record } from "./helpers/fixtures.js";
import type { CardProtectionEffect } from "../src/core/contracts/cards.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

const effectId = "miragebound_mirror_path_destroy_spell_trap";
const targetId = "miragebound_mirror_path_spell_trap_target";
type TargetZone = "spellTrap" | "fieldSpell";
type Protection = "none" | "protection" | "immunity";

function setup(t: TestContext, seat: "player" | "bot", controller: "human" | "ai" = "ai") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat];
  owner.controllerType = controller;
  const opponent = seat === "player" ? game.bot : game.player;
  const source = new Card(cardDefinition(359), owner.id);
  placeFieldCards(owner.spellTrap, source);
  const target = new Card({ id: 9903591, name: "Mirror Path target", cardKind: "spell", subtype: "continuous", effects: [] }, opponent.id);
  return { game, owner, opponent, source, target };
}

function protect(target: { protectionEffects?: CardProtectionEffect[]; immuneToOpponentEffectsUntilTurn?: number | null }, protection: Protection) {
  if (protection === "protection") target.protectionEffects = [{ type: "effect_destruction", duration: "permanent" }];
  if (protection === "immunity") target.immuneToOpponentEffectsUntilTurn = 4;
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const destination of ["faceup Spell/Trap", "facedown Spell/Trap", "Field Spell"] as const) {
      test(`Mirror Path destroys ${destination} after its cost in ${seat}/${controller}`, async t => {
        const { game, owner, opponent, source, target } = setup(t, seat, controller);
        const zone: TargetZone = destination === "Field Spell" ? "fieldSpell" : "spellTrap";
        target.isFacedown = destination === "facedown Spell/Trap";
        if (zone === "fieldSpell") { target.subtype = "field"; opponent.fieldSpell = target; }
        else placeFieldCards(opponent.spellTrap, target);
        let paidBeforeResponse = false;
        const trace: string[] = [];
        game.on("effect_activated", event => {
          if (event.card === source || event.source === source) {
            paidBeforeResponse = owner.graveyard.includes(source);
            assert.ok(zone === "fieldSpell" ? opponent.fieldSpell === target : opponent.spellTrap.includes(target));
            trace.push("publication");
          }
        });
        game.on("card_to_grave", event => {
          if (event.card === source) trace.push("cost");
          if (event.card === target) {
            assert.equal(event.wasDestroyed, true);
            assert.equal(event.destroyCause, "effect");
            assert.equal(event.destroySource, source);
            trace.push("destruction");
          }
        });
        const activation = game.tryActivateSpellTrapEffect(source, null, { owner });
        await completeTestSelections(game, activation);
        const result = await activation;
        assert.equal(result.success, true, result.reason || undefined);
        assert.ok(paidBeforeResponse, "the source must be paid before response publication");
        assert.equal(owner.graveyard.filter(card => card === source).length, 1);
        assert.ok(opponent.graveyard.includes(target), "destruction must resolve after the persistent source leaves");
        assert.deepEqual(trace, ["cost", "publication", "destruction"]);
      });
    }
  }
  for (const zone of ["spellTrap", "fieldSpell"] as const) {
    for (const protection of ["protection", "immunity"] as const) {
      test(`Mirror Path respects ${protection} in ${zone}/${seat}`, async t => {
        const { game, owner, opponent, source, target } = setup(t, seat);
        protect(target, protection);
        if (zone === "fieldSpell") { target.subtype = "field"; opponent.fieldSpell = target; }
        else placeFieldCards(opponent.spellTrap, target);
        let destroyed = 0;
        game.on("card_to_grave", event => { if (event.card === target && event.wasDestroyed) destroyed++; });
        await game.tryActivateSpellTrapEffect(source, { [targetId]: [target] }, { owner });
        assert.ok(owner.graveyard.includes(source), "failed destruction cannot refund the cost");
        assert.equal(zone === "fieldSpell" ? opponent.fieldSpell === target : opponent.spellTrap.includes(target), true);
        assert.equal(destroyed, 0);
      });
    }
  }
  for (const outcome of ["activation negated", "effect negated", "target leaves", "target leaves and returns"] as const) {
    test(`Mirror Path preserves cost when ${outcome} in ${seat}`, async t => {
      const { game, owner, opponent, source, target } = setup(t, seat);
      placeFieldCards(opponent.spellTrap, target);
      const effect = required(source.effects.find(effect => effect.id === effectId));
      const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect,
        activationZone: "spellTrap", committed: true, targetSelections: chainSelections({ [targetId]: [target] }),
        ...(outcome === "activation negated" ? { activationNegated: true } : {}) });
      assert.equal((await game.chainSystem.payActivationCosts(prepared)).success, true);
      const link = required(game.chainSystem.addToChain(prepared));
      assert.ok(link);
      if (outcome === "effect negated") game.chainSystem.markChainLinkEffectNegated(link.linkId, { negatedBy: null });
      if (outcome.startsWith("target leaves")) {
        await game.moveCard(target, opponent, "hand", { fromZone: "spellTrap", awaitEvents: true });
        if (outcome === "target leaves and returns") await game.moveCard(target, opponent, "spellTrap", { fromZone: "hand", isFacedown: false, awaitEvents: true });
      }
      await game.chainSystem.resolveChain();
      assert.equal(owner.graveyard.filter(card => card === source).length, 1);
      assert.equal(opponent.graveyard.includes(target), false);
      assert.ok(outcome === "target leaves" ? opponent.hand.includes(target) : opponent.spellTrap.includes(target));
    });
  }
}

for (const zone of ["field", "spellTrap", "fieldSpell"] as const) {
  for (const protection of ["none", "protection", "immunity"] as const) {
    test(`simulated destruction matches ${protection} in ${zone}`, () => {
      const source = simulationCard({ ...cardDefinition(359), owner: "bot" });
      const target = simulationCard({ id: 9903591, name: "Simulation target", cardKind: zone === "field" ? "monster" : "spell", owner: "player", effects: [] });
      protect(target, protection);
      const state = simulationState({ turnCounter: 4, player: zone === "fieldSpell" ? { fieldSpell: target } : { [zone]: [target] } });
      const events: string[] = [];
      const destroyed = destroySimulatedCard(target, state.player, state.bot, state, { sourceCard: source,
        emitSimulatedEvent: (name, payload) => { const event = record(payload); if (event.card === target) { assert.equal(event.wasDestroyed, true); events.push(name); } } });
      assert.equal(destroyed, protection === "none");
      assert.equal(state.player.graveyard.includes(target), protection === "none");
      assert.deepEqual(events, protection === "none" ? ["card_to_grave", "card_moved"] : []);
    });
  }
}

for (const protection of ["none", "protection", "immunity"] as const) {
  test(`Mirror Path simulation pays once and resolves against ${protection}`, () => {
    const source = simulationCard({ ...cardDefinition(359), instanceId: 35901, owner: "bot" });
    const target = simulationCard({ id: 9903591, instanceId: 35902, name: "Simulation target", cardKind: "spell", subtype: "continuous", owner: "player", effects: [] });
    protect(target, protection);
    const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", turnCounter: 4,
      bot: { spellTrap: [source] }, player: { spellTrap: [target] } });
    applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, effectId });
    assert.equal(state.bot.graveyard.filter(card => card === source).length, 1);
    assert.equal(state.player.graveyard.includes(target), protection === "none");
    assert.equal(state.player.spellTrap.includes(target), protection !== "none");
  });
}

test("persistent source requirement remains the default in simulation", () => {
  const source = simulationCard({ id: 9903592, instanceId: 35903, name: "Source-presence control", cardKind: "spell", subtype: "continuous", owner: "bot", effects: [{
    id: "source_presence_control", timing: "ignition", activationZones: ["spellTrap"],
    activationCosts: [{ type: "move", targetRef: "self", to: "graveyard", player: "self", fromZone: "spellTrap" }],
    actions: [{ type: "damage", amount: 500, player: "opponent" }],
  }] });
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", bot: { spellTrap: [source] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, effectId: "source_presence_control" });
  assert.ok(state.bot.graveyard.includes(source));
  assert.equal(state.player.lp, 8000);
});
