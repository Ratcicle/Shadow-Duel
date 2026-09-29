import assert from "node:assert/strict";
import test from "node:test";
import type ChainSystem from "../../src/core/ChainSystem.js";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type ChainGame = RuntimeGame & { chainSystem: ChainSystem };

// The fixture supplies the response's resulting face-down state in both runs.
// It does not simulate a response card or record a second external command.
// Selection, Chain revalidation, cleanup, the GY trigger and replay use real code.
function installEquipScenario(game: ChainGame, id: 10 | 11) {
  const moves = { equip: 0, backrow: 0 };
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.phase = "main1";
    game.turnCounter = 3;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    const cards = [...game.player.hand, ...game.player.deck];
    const source = required(cards.find(card => card.id === id));
    const target = required(cards.find(card => card.id === 1));
    game.player.hand = [source];
    game.player.deck = cards.filter(card => card !== source && card !== target);
    placeFieldCards(game.player.field, target);
    const enemyCards = [...game.bot.hand, ...game.bot.deck];
    const backrow = required(enemyCards.find(card => card.id === 13));
    game.bot.hand = [];
    game.bot.deck = enemyCards.filter(card => card !== backrow);
    placeFieldCards(game.bot.spellTrap, backrow);
    game.on("card_to_grave", event => {
      if (event.card === source) moves.equip++;
      if (event.card === backrow) moves.backrow++;
    });
    let responded = false;
    game.chainSystem.offerChainResponses = async () => {
      if (!responded) {
        responded = true;
        target.isFacedown = true;
      }
      return { lastActivator: null, chainBuilt: game.chainSystem.chainStack.length > 0,
        consecutivePasses: 2, offers: 1, activations: 0 };
    };
  };
  return moves;
}

for (const id of [10, 11] as const) {
  test(`${id} replays invalid Equip cleanup and its GY trigger once across locales`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 789,
      laboratoryMode: true, laboratoryUseBot: false });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback",
      laboratoryMode: true, laboratoryUseBot: false });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    const liveMoves = installEquipScenario(live, id);
    const replayMoves = installEquipScenario(playback, id);
    playback.ui.showConfirmPrompt = async () => assert.fail("Replay cannot ask for confirmation");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("Replay cannot ask for position");
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
      playerDeck: [id, 1, ...Array<number>(11).fill(3)],
      botDeck: [13, ...Array<number>(12).fill(3)], playerExtraDeck: [], botExtraDeck: [] });
    const source = required(live.player.hand[0]);
    let finished = false;
    const activation = live.tryActivateSpell(source, 0);
    void activation.then(() => { finished = true; }, () => { finished = true; });
    const submitted = new Set<NonNullable<RuntimeGame["targetSelection"]>>();
    const selections: Promise<unknown>[] = [];
    for (let attempts = 0; attempts < 1000 && !finished; attempts++) {
      const session = live.targetSelection;
      if (session && !submitted.has(session)) {
        submitted.add(session);
        for (const requirement of session.requirements) {
          session.selections[requirement.id] = [required(requirement.candidates[0]).key];
        }
        selections.push(live.finishTargetSelection());
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.equal(finished, true, "Activation and the follow-up trigger must finish");
    await Promise.all(selections);
    await activation;
    assert.equal(submitted.size, 2, "Human chooses both the Equip host and the GY trigger target");
    assert.deepEqual(liveMoves, { equip: 1, backrow: 1 });
    assert.ok(live.player.graveyard.includes(source));
    assert.equal(live.bot.graveyard.filter(card => card.id === 13).length, 1);
    assert.equal(source.equippedTo, null);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "equip-cleanup-test" }))));
    assert.deepEqual(replay.commands.map(command => command.type), ["activate_card"]);
    assert.equal(replay.decisions.filter(decision => decision.kind === "target").length, 2);
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game owns the card and player instances used by canonical playback."),
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(replayMoves, liveMoves);
  });
}
