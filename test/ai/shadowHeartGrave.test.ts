import assert from "node:assert/strict";
import test from "node:test";
import { simulateMainPhaseAction } from "../../src/core/ai/shadowheart/simulation.js";
import { cardDatabaseByName, required, unsafeFixture } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { createRuntimeGame } from "../helpers/game.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import { executeGraveyardSpellEffectAction } from "../../src/core/bot/actionExecutors/spellTrap.js";
import type { AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import type { BotRuntimePort, BotGamePort } from "../../src/core/contracts/bot.js";

function card(name: string) { return simulationCard({ ...required(cardDatabaseByName.get(name)) }); }

test("Shadow-Heart planning resolves the tribute payoff when Grave summons Arctroth", () => {
  const source = card("Shadow-Heart Grave");
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", bot: {
    hand: [card("Shadow-Heart Demon Arctroth")], field: [card("Shadow-Heart Heartbearer")], spellTrap: [source],
  }, player: { field: [simulationCard({ name: "Enemy", cardKind: "monster", atk: 500 })] } });
  simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, effectId: "shadow_heart_grave_summon" });
  assert.equal(state.bot.field[0]?.id, 104);
  assert.equal(state.player.field.length, 0);
});

test("Shadow-Heart planning pays Grave's GY cost and recovers its level-eight monster", () => {
  const source = card("Shadow-Heart Grave");
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", bot: { graveyard: [source, card("Shadow-Heart Demon Arctroth")] } });
  simulateMainPhaseAction(state, { type: "graveyardSpellEffect", graveyardIndex: 0, effectId: "shadow_heart_grave_recover" });
  assert.equal(state.bot.banished[0]?.id, 126);
  assert.equal(state.bot.hand[0]?.id, 104);
});

test("Shadow-Heart bot generates and executes the graveyard Trap effect", async (t) => {
  const game = createRuntimeGame({ disableChains: true, captureReplay: true });
  t.after(() => game.dispose());
  game.applyScenarioSetup({ schemaVersion: 2, turn: "bot", phase: "main1", player: { hand: [], field: [], spellTrap: [] }, bot: { hand: [], field: [], spellTrap: [], graveyard: [{ id: 126 }, { id: 104 }] } });
  game.bot.controllerType = "ai";
  game.startReplayRecording();
  const strategy = new ShadowHeartStrategy(unsafeFixture<AIStrategyBotPort>(game.bot, "Real player satisfies Shadow-Heart analysis state."));
  const action = required(strategy.generateMainPhaseActions(game).find(a => a.type === "graveyardSpellEffect" && a.cardId === 126));
  assert.equal(action.type, "graveyardSpellEffect");
  assert.equal(await executeGraveyardSpellEffectAction(
    unsafeFixture<BotRuntimePort>(game.bot, "Real player consumed by the executor's state-only paths."),
    unsafeFixture<BotGamePort>(game, "Real Game integration with executor projections."), action,
  ), true);
  assert.equal(game.bot.banished[0]?.id, 126);
  assert.equal(game.bot.hand[0]?.id, 104);
  assert.equal(game.finalizeReplay()?.commands.filter(command => command.type === "activate_effect").length, 1);
});
