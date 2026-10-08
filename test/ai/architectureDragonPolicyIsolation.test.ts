import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) {
  for (const used of [false, true]) test(`Dragon recruit callbacks keep their planning photograph and resolved effect (${actor}/${used})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 9713 });
    t.after(() => game.dispose("architecture_dragon_policy_isolation"));
    const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> });
    owner.id = actor; game[actor] = owner;
    owner.game = unsafeFixture<BotGamePort>(game,
      "The concrete Game supplies Bot runtime execution; the fixture's EffectEngine projection is narrower than BotGamePort.");
    const opponent = game[actor === "bot" ? "player" : "bot"];
    opponent.controllerType = "ai";
    owner.strategy = new DragonStrategy(owner);
    game.turn = actor; game.phase = "main1"; game.turnCounter = 1;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    const card = (id: number) => required(game.createCardForOwner(id, owner));
    placeFieldCards(owner.field, card(252), card(279), card(260));
    owner.hand.push(card(268), card(271), card(278));
    owner.graveyard.push(card(252), card(280));
    owner.deck.push(...[264, 256, 251, 261, 259, 252, 278, 12, 280, 12, 255, 279, 279, 280, 270, 257, 277, 18, 254].map(card));
    const source = required(owner.graveyard[1]);
    const lunarSearch = required(source.effects.find(effect => effect.id === "lunar_eclipse_summon_search"));
    if (used) game.markOncePerTurnUsed(source, owner, lunarSearch);
    const effect = required(source.effects.find(effect => effect.id === "lunar_eclipse_gy_summon_deck_dragon"));
    const initialInstances = new Set(owner.field.map(card => card.instanceId));
    const { state } = createGameTreeCopy(game, owner);
    const simulatedSource = required(state.bot.graveyard[1]);
    const candidates = state.bot.deck.filter(card => card.cardKind === "monster" && card.type === "Dragon" && (card.level || 0) <= 4);
    const strategy = new DragonStrategy(state.bot);
    const { _gameRef: _originalLiveRef, ...snapshot } = state;
    const publicLiveRef = { bot: game.bot, player: game.player, turnCounter: game.turnCounter,
      oncePerTurnUsage: game.oncePerTurnUsage };
    const context = { game: { ...snapshot, _gameRef: publicLiveRef }, player: state.bot, opponent: state.player, source: simulatedSource,
      effect, effectId: effect.id, isSimulatedState: true };
    const summarize = () => {
      const result = strategy.evaluateRecruitCandidate(candidates, context);
      return { best: result.best?.instanceId, scores: result.scores.map(entry => [entry.card.instanceId, entry.score]) };
    };
    const baseline = summarize();
    const expectedId = used ? 279 : 280;
    assert.equal(candidates.find(card => card.instanceId === baseline.best)?.id, expectedId,
      "The photographed canonical OPT ledger feeds the existing policy weights.");
    // Vary only the live Game after capture; no projected candidate or ledger changes.
    const runtimeLedger = new Map(game.oncePerTurnUsage[actor]);
    game.oncePerTurnUsage[actor].clear();
    game.markOncePerTurnUsed(source, owner, lunarSearch);
    assert.deepEqual(summarize(), baseline);
    game.oncePerTurnUsage[actor].clear();
    assert.deepEqual(summarize(), baseline);
    publicLiveRef.turnCounter++;
    assert.deepEqual(summarize(), baseline, "A later live turn cannot refresh the photographed OPT state.");
    publicLiveRef.turnCounter--;
    game.oncePerTurnUsage[actor] = runtimeLedger;
    assert.equal(await owner.executeMainPhaseAction(owner.game, { type: "graveyardMonsterEffect", graveyardIndex: 1,
      cardId: 280, effectId: effect.id, priority: 18 }), true);
    new DragonStrategy(state.bot).simulateMainPhaseAction(state, { type: "graveyardMonsterEffect", graveyardIndex: 1,
      cardId: 280, effectId: effect.id, priority: 18 });
    const liveFirst = required(owner.field.find(card => !initialInstances.has(card.instanceId)));
    const simulatedFirst = required(state.bot.field.find(card => !initialInstances.has(Number(card.instanceId))));
    assert.equal(liveFirst.id, expectedId);
    assert.equal(simulatedFirst.id, liveFirst.id, "The production summon callback receives the resolving parent's effect identity.");
  });
}
