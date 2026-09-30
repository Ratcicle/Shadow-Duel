import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, completeTestSelections, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "coward_fusion" | "purge_cost" | "rage_history" | "pursuer";
function install(game: RuntimeGame, scenario: Scenario, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turnCounter = 4; game.turn = seat; game.phase = "main1";
    game.player.deck.push(...game.player.hand.splice(0)); game.bot.deck.push(...game.bot.hand.splice(0));
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    owner.controllerType = controller; opponent.controllerType = "ai";
    const take = (id: number, from = owner.deck) => { const card = required(from.find(card => card.id === id)); from.splice(from.indexOf(card), 1); return card; };
    if (scenario === "rage_history") {
      placeFieldCards(owner.field, take(111)); owner.hand.push(take(112));
      game.phase = "battle"; game.battleStep = "battle";
    } else {
      const target = take(111, opponent.deck);
      if (scenario === "pursuer") target.lastSummonMethod = "synchro";
      placeFieldCards(opponent.field, target);
      if (scenario === "pursuer") {
        const material = take(104); material.summonedTurn = 0;
        placeFieldCards(owner.field, material);
      }
      else if (scenario === "purge_cost") owner.hand.push(take(103), take(109));
      else owner.hand.push(take(required(cardDefinition("Polymerization").id)), take(109), take(101));
    }
  };
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const scenario of ["coward_fusion", "purge_cost", "rage_history", "pursuer"] as const) {
      test(`final rules replay ${scenario}, ${seat}, ${controller}, EN to PT`, async t => {
        setLocale("en");
        const live = createRuntimeGame({ captureReplay: true, randomSeed: 20260929, laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual",
          fieldPlacementProvider: async request => ({ outcome: "chosen", slot: required(request.candidates[0]).slot }) });
        const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0,
          fieldPlacementProvider: async () => assert.fail("playback cannot ask for placement") });
        t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
        install(live, scenario, seat, controller); install(playback, scenario, seat, controller);
        live.ui.showChainResponseModal = async () => null;
        live.ui.showConfirmPrompt = async () => true;
        live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
        playback.ui.showChainResponseModal = async () => assert.fail("playback cannot ask for responses");
        playback.ui.showConfirmPrompt = async () => assert.fail("playback cannot ask for confirmation");
        playback.ui.showSpecialSummonPositionModal = () => assert.fail("playback cannot ask for position");
        const deck = [required(cardDefinition("Polymerization").id), 101, 103, 104, 109, 111, 112, ...Array<number>(13).fill(3)];
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
          playerDeck: deck, botDeck: deck, playerExtraDeck: [122, 123], botExtraDeck: [122, 123] });
        const owner = live[seat], opponent = live[seat === "player" ? "bot" : "player"];
        if (scenario === "rage_history") {
          await live.resolveCombat(required(owner.field[0]), null);
          await live.nextPhase();
          assert.equal((await live.tryActivateSpell(required(owner.hand[0]), 0, null, { owner })).success, false);
          assert.equal(owner.directAttacksDeclaredThisTurn, 1);
        } else {
          const action = scenario === "pursuer"
            ? live.performAscensionSummonFromExtraDeck(required(owner.extraDeck.find(card => card.id === 123)), owner)
            : live.tryActivateSpell(required(owner.hand[0]), 0, null, { owner });
          await completeTestSelections(live, Promise.resolve(action));
          assert.equal(required(opponent.field[0]).atk, scenario === "purge_cost" ? 1000 : 1500);
          if (scenario === "pursuer") assert.ok(owner.field.some(card => card.id === 123));
          if (scenario === "coward_fusion") assert.ok(owner.field.some(card => card.id === 122));
        }
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "shadow-final-rules" }))));
        assert.equal(replay.commands.length, scenario === "rage_history" ? 3 : 1);
        setLocale("pt-br");
        const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game implementing the replay driver port.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      });
    }
  }
}
