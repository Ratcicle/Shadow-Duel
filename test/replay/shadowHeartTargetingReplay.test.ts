import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "infusion" | "imp" | "heartbearer" | "warlord" | "scale_decline";
function install(game: RuntimeGame, scenario: Scenario, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turnCounter = 4; game.battleStep = "battle";
    game.player.deck.push(...game.player.hand.splice(0)); game.bot.deck.push(...game.bot.hand.splice(0));
    game.phase = "main1"; game.turn = seat;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    const owner = game[seat], opponent = seat === "player" ? game.bot : game.player;
    owner.controllerType = controller; opponent.controllerType = "ai";
    const take = (id: number) => { const card = required(owner.deck.find(c => c.id === id)); owner.deck.splice(owner.deck.indexOf(card), 1); return card; };
    if (scenario === "infusion") owner.hand.push(take(110), take(102), take(102));
    else if (scenario === "imp") owner.hand.push(take(107), take(102), take(102));
    else {
      const attacker = required(opponent.deck.find(c => c.id === (scenario === "heartbearer" || scenario === "scale_decline" ? 111 : 102)));
      opponent.deck.splice(opponent.deck.indexOf(attacker), 1); placeFieldCards(opponent.field, attacker);
      if (scenario === "scale_decline") {
        const scale = take(111); scale.lastSummonMethod = "tribute";
        placeFieldCards(owner.field, scale); owner.graveyard.push(take(102));
        attacker.atk = 4000; game.turn = opponent.id;
      } else if (scenario === "heartbearer") {
        placeFieldCards(owner.field, take(125), take(102)); game.turn = opponent.id;
      } else {
        const warlord = required(owner.extraDeck[0]); owner.extraDeck.splice(0, 1); warlord.properSummonEstablished = true;
        placeFieldCards(owner.field, warlord); owner.graveyard.push(take(102), take(102));
      }
      game.phase = "battle";
    }
  };
}

async function finishHumanSelections(game: RuntimeGame, action: Promise<unknown>) {
  let done = false; let failure: unknown;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  for (let i = 0; i < 3000; i++) {
    const session = game.targetSelection;
    if (session) {
      if (session.requirements.every(requirement => requirement.min === 0)) {
        game.cancelTargetSelection();
        continue;
      }
      for (const requirement of session.requirements) {
        session.selections[requirement.id] = requirement.candidates.slice(-requirement.min).map(c => c.key);
      }
      await game.finishTargetSelection();
    }
    if (done && !game.targetSelection) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "human selection must complete");
  await completion;
  if (failure) throw failure;
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const scenario of ["infusion", "imp", "heartbearer", "warlord", "scale_decline"] as const) {
      if (scenario === "scale_decline" && controller === "ai") continue;
      test(`replay ${scenario} ${seat} ${controller} consumes late choices across languages`, async t => {
        setLocale("en");
        const live = createRuntimeGame({ captureReplay: true, randomSeed: 20260929, laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual",
          fieldPlacementProvider: async request => ({ outcome: "chosen", slot: required(request.candidates[0]).slot }) });
        const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0,
          fieldPlacementProvider: async () => assert.fail("playback cannot ask for a slot") });
        t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
        install(live, scenario, seat, controller); install(playback, scenario, seat, controller);
        let prompts = 0;
        live.ui.showConfirmPrompt = async () => { prompts++; return true; };
        live.ui.showChainResponseModal = async () => null;
        live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
        playback.ui.showConfirmPrompt = async () => assert.fail("playback cannot ask for confirmation");
        playback.ui.showChainResponseModal = async () => assert.fail("playback cannot ask for response");
        playback.ui.showSpecialSummonPositionModal = () => assert.fail("playback cannot ask for position");
        const deck = [101, 102, 102, 107, 110, 111, 125, ...Array<number>(13).fill(3)];
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
          playerDeck: deck, botDeck: deck, playerExtraDeck: [122], botExtraDeck: [122] });
        const owner = live[seat], opponent = seat === "player" ? live.bot : live.player;
        const action = scenario === "infusion" ? live.tryActivateSpell(required(owner.hand[0]), 0, null, { owner })
          : scenario === "imp" ? live.performNormalSummon(owner, 0, "attack", false)
          : scenario === "heartbearer" ? live.resolveCombat(required(opponent.field[0]), required(owner.field[1]))
          : scenario === "scale_decline" ? live.resolveCombat(required(opponent.field[0]), required(owner.field[0]))
          : live.resolveCombat(required(owner.field[0]), required(opponent.field[0]));
        await finishHumanSelections(live, Promise.resolve(action));
        assert.equal(owner.field.some(card => card.id === 102), scenario !== "scale_decline");
        if (controller === "human" && scenario !== "infusion") assert.equal(prompts, 1, "only the optional trigger is confirmed");
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "shadow-targeting-test" }))));
        assert.equal(replay.commands.length, 1, "internal resolution cannot record a second command");
        setLocale("pt-br");
        const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game used by the canonical driver.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      });
    }
  }
}
