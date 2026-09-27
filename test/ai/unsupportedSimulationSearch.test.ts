import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import { beamSearchTurn, greedySearchWithEvalV2 } from "../../src/core/ai/BeamSearch.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { playBotMainPhase } from "../../src/core/bot/mainPhaseController.js";
import type { AIAction, AIPlannedAction, AIState } from "../../src/core/contracts/ai.js";
import type { AiStateShape, SimulationGameState } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { fixtureGameTreeSearch } from "../helpers/gameTree.js";
import { cardDefinition, unsafeFixture } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const incomplete: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "defense", effectId: "incomplete" };
const complete: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "defense", effectId: "complete" };
type Engine = "beam" | "greedy" | "gameTree" | "turnLine";
interface Policy {
  generateMainPhaseActions(state: AIState): AIAction[];
  simulateMainPhaseAction(state: AiStateShape, action: AIPlannedAction): void;
  evaluateBoard(state: AIState): number;
}
function state(): SimulationGameState {
  return simulationState({ turn: "bot", phase: "main1", turnCounter: 2,
    bot: { field: [simulationCard({ id: 99901, instanceId: 99901, cardKind: "monster", level: 3, atk: 1000 })] } });
}
async function search(engine: Engine, input: ReturnType<typeof state>, policy: Policy) {
  if (engine === "beam") return beamSearchTurn(input, policy, { maxDepth: 3, beamWidth: 3 });
  if (engine === "greedy") return greedySearchWithEvalV2(input, policy);
  if (engine === "gameTree") return fixtureGameTreeSearch(input, policy, input.bot, 3);
  return turnLineSearch(input, policy, { maxDepth: 3, beamWidth: 3 });
}

for (const engine of ["beam", "greedy", "gameTree", "turnLine"] as const) {
  for (const alternative of [false, true]) {
    test(`${engine} rejects incomplete simulated branches, including fallback (alternative: ${alternative})`, async () => {
      const input = state();
      let incompleteEvaluations = 0;
      const result = await search(engine, input, {
        generateMainPhaseActions: snapshot => (snapshot.bot?.lp || 0) !== 8000 ? [] : [incomplete, ...(alternative ? [complete] : [])],
        simulateMainPhaseAction(snapshot, action) {
          const invalid = "effectId" in action && action.effectId === "incomplete";
          snapshot.bot.lp += invalid ? 1_000_000 : 100;
          if (invalid) snapshot._simUnsupportedActions = ["effect_branch_missing"];
        },
        evaluateBoard(snapshot) {
          if ("_simUnsupportedActions" in snapshot && snapshot._simUnsupportedActions?.length) incompleteEvaluations++;
          return snapshot.bot?.lp || 0;
        },
      });
      assert.equal(result?.action && "effectId" in result.action ? result.action.effectId : null, alternative ? "complete" : null);
      assert.equal(incompleteEvaluations, 0);
      assert.equal(input.bot.lp, 8000);
    });
  }

  test(`${engine} stops planning after an unknown draw instead of extending through its card identity`, async () => {
    const input = state();
    let extensionsAfterDraw = 0;
    const result = await search(engine, input, {
      generateMainPhaseActions(snapshot) {
        if ("_simRequiresReplan" in snapshot && snapshot._simRequiresReplan) extensionsAfterDraw++;
        return [complete];
      },
      simulateMainPhaseAction(snapshot) {
        snapshot.bot.lp += 100;
        snapshot._simRequiresReplan = true;
      },
      evaluateBoard: snapshot => snapshot.bot?.lp || 0,
    });
    assert.equal(result?.action && "effectId" in result.action ? result.action.effectId : null, "complete");
    assert.equal(extensionsAfterDraw, 0);
    if (result && "sequence" in result) assert.equal(result.sequence.length, 1);
    assert.equal(input._simRequiresReplan, undefined);
  });
}

for (const supportedNoOp of [false, true]) {
  test(`controller fallback skips incomplete simulations and preserves complete no-ops (${supportedNoOp})`, async t => {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "warn", () => {});
    const game = unsafeFixture<Game & BotGamePort>(new Game({ laboratoryMode: true, laboratoryUseBot: true, disableChains: true, captureReplay: false }),
      "Concrete Game installs activation methods omitted by the public Bot preview port.");
    t.after(() => game.dispose("unsupported_simulation_search"));
    const bot = game.bot;
    assert.ok(bot instanceof Bot);
    game.turn = bot.id;
    game.phase = "main1";
    game.turnCounter = 2;
    game.disablePresentationDelays = true;
    game.aiSuccessfulActionDelayMs = 0;
    game.aiActionDelayMs = 0;
    game.turnLineSearchMode = "off";
    bot.strategy.shouldUseAutomaticAscensionShortcut = () => false;
    bot.field.push(new Card(cardDefinition("Nightmare Steed"), bot.id));
    const executed: string[] = [];
    bot.generateMainPhaseActions = () => executed.length ? [] : [incomplete, ...(supportedNoOp ? [complete] : [])];
    bot.sequenceActions = actions => actions;
    bot.filterValidActionsForCurrentState = actions => actions;
    bot.evaluateBoardV2 = () => 0;
    bot.simulateMainPhaseAction = (snapshot, action) => {
      if (action.effectId === "incomplete") snapshot._simUnsupportedActions = ["missing_action"];
      return snapshot;
    };
    bot.executeMainPhaseAction = async (_game, action) => { executed.push(action.effectId || ""); return true; };
    await playBotMainPhase(bot, game);
    assert.deepEqual(executed, supportedNoOp ? ["complete"] : []);
  });
}
