import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "shield" | "wyrm" | "cathedral" | "leviathan";
function install(game: RuntimeGame, scenario: Scenario, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.turnCounter = 4;
    game.phase = scenario === "shield" ? "end" : scenario === "wyrm" ? "battle" : "main1";
    game.battleStep = "battle"; game.disablePresentationDelays = true; game.phaseDelayMs = 0;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat], opponent = seat === "player" ? game.bot : game.player;
    owner.controllerType = controller;
    const cards = [...owner.hand, ...owner.deck]; owner.hand = []; owner.deck = cards;
    const take = (id: number) => { const card = required(owner.deck.find(c => c.id === id)); owner.deck.splice(owner.deck.indexOf(card), 1); return card; };
    if (scenario === "shield") {
      game.turn = opponent.id;
      const eel = take(101), shield = take(113);
      placeFieldCards(owner.field, eel); placeFieldCards(owner.spellTrap, shield); shield.equippedTo = eel;
    } else if (scenario === "wyrm") {
      const victim = take(107); placeFieldCards(owner.field, victim); owner.hand.push(take(116));
      const attacker = required([...opponent.hand, ...opponent.deck].find(c => c.id === 111));
      opponent.hand = opponent.hand.filter(c => c !== attacker); opponent.deck = opponent.deck.filter(c => c !== attacker);
      placeFieldCards(opponent.field, attacker); game.turn = opponent.id;
    } else if (scenario === "cathedral") {
      const cathedral = take(119); cathedral.addCounter("judgment_marker", 3);
      placeFieldCards(owner.spellTrap, cathedral);
    } else {
      owner.hand.push(take(117)); placeFieldCards(owner.field, take(101), take(101));
    }
  };
}

async function finishHumanSelections(game: RuntimeGame, action: Promise<unknown>) {
  let done = false; let failure: unknown;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  for (let i = 0; i < 3000; i++) {
    const session = game.targetSelection;
    if (session) {
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
    for (const scenario of ["shield", "wyrm", "cathedral", "leviathan"] as const) {
      for (const accept of controller === "human" && (scenario === "shield" || scenario === "wyrm") ? [true, false] : [true]) {
        test(`replay ${scenario} ${seat} ${controller} accept=${accept} preserves decisions across languages`, async t => {
          setLocale("en");
          const live = createRuntimeGame({ captureReplay: true, randomSeed: 20260929, laboratoryMode: true,
            laboratoryUseBot: false, chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual",
            fieldPlacementProvider: async () => ({ outcome: "chosen", slot: 4 }) });
          const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
            laboratoryUseBot: false, chainResponseTimeoutMs: 0,
            fieldPlacementProvider: async () => assert.fail("playback cannot ask for a slot") });
          t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
          install(live, scenario, seat, controller); install(playback, scenario, seat, controller);
          let prompts = 0;
          live.ui.showConfirmPrompt = async () => { prompts++; return accept; };
          live.ui.showChainResponseModal = async () => null;
          live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
          playback.ui.showConfirmPrompt = async () => assert.fail("playback cannot ask for confirmation");
          playback.ui.showChainResponseModal = async () => assert.fail("playback cannot ask for response");
          playback.ui.showSpecialSummonPositionModal = () => assert.fail("playback cannot ask for position");
          const deck = [101, 101, 107, 111, 113, 116, 117, 119, 125, ...Array<number>(10).fill(3)];
          await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
            startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
            playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
          const owner = live[seat], opponent = seat === "player" ? live.bot : live.player;
          const action = scenario === "shield" ? Promise.resolve(live.nextPhase())
            : scenario === "wyrm" ? live.resolveCombat(required(opponent.field[0]), required(owner.field[0]))
            : scenario === "cathedral" ? live.tryActivateSpellTrapEffect(required(owner.spellTrap[0]), null, { owner })
            : live.tryActivateMonsterEffect(required(owner.hand[0]), null, "hand", owner);
          await finishHumanSelections(live, action);
          if (scenario === "shield") assert.equal(owner.lp, accept ? 7200 : 8000);
          else assert.equal(scenario === "cathedral" ? owner.field.length === 1 : owner.field.some(card => card.id === (scenario === "wyrm" ? 116 : 117)), accept);
          if (controller === "human" && (scenario === "wyrm" || scenario === "shield")) assert.equal(prompts, 1);
          const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "shadow-cost-test" }))));
          assert.equal(replay.commands.length, 1, "internal resolution cannot record a second command");
          assert.equal(replay.commands[0]?.type, scenario === "shield" ? "phase_intent" : scenario === "wyrm" ? "attack" : "activate_effect");
          if (controller === "human" && accept && scenario !== "shield") {
            assert.ok(replay.decisions.some(decision => decision.kind === "field_placement"));
          }
          setLocale("pt-br");
          const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game used by the canonical driver.") });
          assert.equal(result.ok, true);
          assert.equal(result.finalStateHash, replay.result?.finalStateHash);
          assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
        });
      }
    }
  }
}
