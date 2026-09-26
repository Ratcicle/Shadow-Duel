import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import { playBotMainPhase } from "../../src/core/bot/mainPhaseController.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, record, required, unsafeFixture } from "../helpers/fixtures.js";
import { placeSimulationCards } from "../helpers/simulation.js";

function scenario(t: TestContext, pairCount = 2) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const game = unsafeFixture<Game & BotGamePort>(new Game({
    laboratoryMode: true, laboratoryUseBot: true, disableChains: true,
    captureReplay: false, randomSeed: 3104,
  }), "Concrete Game installs the full EffectEngine; the Bot port exposes methods omitted by its public engine projection.");
  t.after(() => game.dispose("main_phase_ascension_test"));
  const bot = game.bot;
  assert.ok(bot instanceof Bot);
  game.turn = bot.id;
  game.phase = "main1";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.phaseDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiActionDelayMs = 0;
  game.turnLineSearchMode = "off";
  game.waitForBoardPresentation = async () => {};
  game.waitForAiPresentationStep = async () => {};
  bot.strategy.shouldUseAutomaticAscensionShortcut = () => true;
  bot.strategy.selectAutomaticAscension = ({ choices }) => {
    const choice = choices[0];
    return choice ? { ...choice, position: "attack" } : null;
  };
  bot.simulateMainPhaseAction = state => state;
  bot.evaluateBoardV2 = () => 0;
  bot.sequenceActions = actions => actions;
  for (const [materialName, ascensionName] of [
    ["Armored Dragon", "Metal Armored Dragon"],
    ["Shadow-Heart Demon Arctroth", "Shadow-Heart Arctroth Pursuer"],
  ].slice(0, pairCount)) {
    const material = new Card(cardDefinition(required(materialName)), bot.id);
    material.isFacedown = false;
    material.summonedTurn = 0;
    material.position = "attack";
    const ascension = new Card(cardDefinition(required(ascensionName)), bot.id);
    game.ensureDuelCardId(material);
    game.ensureDuelCardId(ascension);
    placeSimulationCards(bot.field, material);
    bot.extraDeck.push(ascension);
    assert.equal(game.canUseAsAscensionMaterial(bot, material).ok, true);
    assert.equal(game.checkAscensionRequirements(bot, ascension, material).ok, true);
    assert.ok(game.getAscensionCandidatesForMaterial(bot, material).includes(ascension));
  }
  bot.hand.push(new Card(cardDefinition("Blood Sucking Mosquito"), bot.id));
  bot.generateMainPhaseActions = (): AIAction[] => bot.hand.length
    ? [{ type: "spell", index: 0, cardName: "Blood Sucking Mosquito" }] : [];
  const exits: Record<string, unknown>[] = [];
  const executions: Record<string, unknown>[] = [];
  Reflect.set(game, "_arenaTracker", {
    recordProgress(kind: string, _game: unknown, details: object) {
      if (kind === "ai_main_phase_exit") exits.push(record(details));
      if (kind === "ai_main_phase_execution") executions.push(record(details));
    },
  });
  return { game, bot, executions, exit: () => required(exits.at(-1)) };
}

test("two real Ascensions share accounting and continue into an ordinary spell", async t => {
  const { game, bot, executions, exit } = scenario(t);
  await playBotMainPhase(bot, game);
  assert.deepEqual(executions.map(entry => entry.actionType), ["ascension", "ascension", "spell"]);
  assert.deepEqual(bot.field.map(card => card.name), ["Metal Armored Dragon", "Shadow-Heart Arctroth Pursuer"]);
  assert.equal(bot.extraDeck.length, 0);
  assert.equal(bot.hand.length, 0);
  assert.ok(bot.graveyard.some(card => card.name === "Armored Dragon"));
  assert.ok(bot.graveyard.some(card => card.name === "Shadow-Heart Demon Arctroth"));
  assert.equal(exit().ascensions, 2);
  assert.equal(exit().executions, 3);
  assert.equal(exit().accepted, 3);
  assert.equal(exit().changes, 3);
  assert.equal(exit().reason, "no_candidates");
});

test("accepted no-op Ascensions try another candidate and ordinary action without a final bypass", async t => {
  const { game, bot, exit } = scenario(t);
  const attempts: string[] = [];
  // An accepted executor that makes no observable change is deliberately faulty.
  bot.executeMainPhaseAction = async (_game, action) => {
    attempts.push(action.type === "ascension" ? required(required(action.ascensionCard).name) : action.type);
    return true;
  };
  await playBotMainPhase(bot, game);
  assert.deepEqual(attempts, ["Metal Armored Dragon", "Shadow-Heart Arctroth Pursuer", "spell"]);
  assert.equal(exit().ascensions, 2);
  assert.equal(exit().executions, 3);
  assert.equal(exit().noOps, 3);
  assert.equal(exit().changes, 0);
  assert.equal(exit().reason, "alternatives_exhausted");
  assert.ok(Number(exit().repetitionsSuppressed) >= 2);
  await playBotMainPhase(bot, game);
  assert.equal(attempts.length, 3, "phase reentry cannot bypass suppression with a final Ascension");
});

test("automatic Ascensions and ordinary actions share the execution safety budget", async t => {
  const { game, bot, exit } = scenario(t, 1);
  const attempts: string[] = [];
  bot.strategy.selectAutomaticAscension = ({ choices }) => attempts.length % 2
    ? { skip: true } : { ...required(choices[0]), position: "attack" };
  // Productive synthetic states exercise the limit without creating an illegal
  // 64-card field or depending on particular card effects to loop naturally.
  bot.executeMainPhaseAction = async (_game, action) => {
    attempts.push(action.type);
    bot.lp--;
    return true;
  };
  await playBotMainPhase(bot, game);
  assert.equal(attempts.length, 64);
  assert.equal(attempts.filter(type => type === "ascension").length, 32);
  assert.equal(attempts.filter(type => type === "spell").length, 32);
  assert.equal(exit().ascensions, 32);
  assert.equal(exit().executions, 64);
  assert.equal(exit().changes, 64);
  assert.equal(exit().reason, "execution_limit");
  await playBotMainPhase(bot, game);
  assert.equal(attempts.length, 64, "automatic Ascension cannot execute beyond the shared budget on reentry");
});

for (const mode of ["main2", "opt_out", "skip"] as const) {
  test(`${mode} suppresses automatic Ascension and preserves ordinary actions`, async t => {
    const { game, bot, executions, exit } = scenario(t, 1);
    if (mode === "main2") {
      game.phase = "main2";
      bot.hand = [new Card(cardDefinition("Mirror Force"), bot.id)];
      bot.generateMainPhaseActions = (): AIAction[] => bot.hand.length
        ? [{ type: "set_spell_trap", index: 0, cardName: "Mirror Force" }] : [];
    }
    if (mode === "opt_out") bot.strategy.shouldUseAutomaticAscensionShortcut = () => false;
    if (mode === "skip") bot.strategy.selectAutomaticAscension = () => ({ skip: true });
    await playBotMainPhase(bot, game);
    assert.deepEqual(executions.map(entry => entry.actionType), [mode === "main2" ? "set_spell_trap" : "spell"]);
    assert.equal(bot.field[0]?.name, "Armored Dragon");
    assert.equal(bot.extraDeck[0]?.name, "Metal Armored Dragon");
    assert.equal(bot.hand.length, 0);
    assert.equal(exit().ascensions, 0);
    assert.equal(exit().executions, 1);
  });
}

for (const loss of ["phase", "turn", "turnCounter", "actor", "gameOver", "disposed"] as const) {
  test(`automatic Ascension cannot continue after ${loss} changes during its execution`, async t => {
    const { game, bot, exit } = scenario(t);
    const attempts: string[] = [];
    bot.executeMainPhaseAction = async (_game, action) => {
      attempts.push(action.type);
      if (loss === "phase") game.phase = "battle";
      if (loss === "turn") game.turn = "player";
      if (loss === "turnCounter") game.turnCounter++;
      if (loss === "actor") bot.id = "player";
      if (loss === "gameOver") game.gameOver = true;
      if (loss === "disposed") game.dispose("context_lost_during_ascension");
      return true;
    };
    await playBotMainPhase(bot, game);
    assert.deepEqual(attempts, ["ascension"]);
    assert.equal(exit().ascensions, 1);
    assert.equal(exit().executions, 1);
    assert.equal(exit().reason, loss === "gameOver" || loss === "disposed" ? "game_over" : "context_lost");
  });
}

test("an already ended duel executes no automatic Ascension", async t => {
  const { game, bot, exit } = scenario(t);
  let attempts = 0;
  bot.executeMainPhaseAction = async () => { attempts++; return true; };
  game.gameOver = true;
  await playBotMainPhase(bot, game);
  assert.equal(attempts, 0);
  assert.equal(exit().ascensions, 0);
  assert.equal(exit().reason, "game_over");
});
