import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { AIState } from "../../src/core/contracts/ai.js";
import type { SimulationGameState } from "../../src/core/contracts/aiState.js";
import type { GameCard } from "../../src/core/contracts/cards.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

async function battle(turn: number, protections: NonNullable<GameCard["protectionEffects"]>) {
  const attacker = simulationCard({ id: 99001, instanceId: 99001, name: "Attacker", cardKind: "monster", atk: 3000, def: 0, position: "attack" });
  const target = simulationCard({ id: 99002, instanceId: 99002, name: "Protected Synchro", cardKind: "monster", atk: 1000, def: 0,
    position: "attack", protectionEffects: protections });
  const state: SimulationGameState = simulationState({ phase: "main1", turn: "bot", turnCounter: turn,
    bot: { field: [attacker] }, player: { field: [target] } });
  const result = await turnLineSearch(state, {
    generateMainPhaseActions: () => [],
    simulateMainPhaseAction: () => undefined,
    evaluateBoard: (snapshot: AIState) => 8000 - (snapshot.player?.lp || 0),
  }, { turnMode: "mainBattleMain2", maxDepth: 1, battleStepLimit: 1 });
  assert.ok(result);
  assert.equal(result.finalState?.player.lp, 6000, "protection does not prevent battle damage");
  assert.equal(state.player.field.length, 1, "planning keeps the live fixture unchanged");
  return result.finalState;
}

for (const turn of [4, 5, 6]) {
  test(`Slasher's granted battle protection is active through the next turn (${turn})`, async () => {
    const source = simulationCard(new Card(cardDefinition(510), "player"));
    const target = simulationCard(new Card(cardDefinition(516), "player"));
    const state = simulationState({ turnCounter: 4, player: { field: [target], graveyard: [source] } });
    const followup = required(source.effects?.find(effect => effect.id === "tech_zero_atomic_slasher_synchro_material_protection")?.actions?.[0]);
    assert.equal(followup.type, "register_synchro_material_followup");
    if (followup.type !== "register_synchro_material_followup") return;
    applySimulatedActions({ state, selfId: "player", selections: { synchro_summoned_card: [target] },
      actions: followup.actions, options: { sourceCard: source } });
    const finalState = required(await battle(turn, required(target.protectionEffects)));
    assert.equal(finalState.player.field.length, turn <= 5 ? 1 : 0);
    assert.equal(finalState.player.graveyard.length, turn <= 5 ? 0 : 1);
  });
}

for (const sourceOwner of ["any", "opponent", "self"] as const) {
  test(`battle protection respects the destruction source owner (${sourceOwner})`, async () => {
    const finalState = required(await battle(4, [{ type: "battle_destruction", sourceOwner, duration: "end_of_next_turn", expiresOnTurn: 5 }]));
    assert.equal(finalState.player.field.length, sourceOwner === "self" ? 0 : 1);
  });
}

test("protection against effects does not also prevent battle destruction", async () => {
  const finalState = required(await battle(4, [{ type: "effect_destruction", sourceOwner: "opponent", duration: "end_of_next_turn", expiresOnTurn: 5 }]));
  assert.equal(finalState.player.field.length, 0);
});
