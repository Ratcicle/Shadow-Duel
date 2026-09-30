import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "effect_damage" | "battle_damage" | "activation_cost";

// Both runs begin with the same cards from the recorded decks. Runtime actions,
// LP occurrences, Chain, decisions and hashes are exercised without replacements.
// Human Wyrm confirmations are covered by shadowHeartCostsReplay.test.ts.
function installScenario(game: RuntimeGame, scenario: Scenario) {
  const start = game.startWithDecks.bind(game);
  const observed = { lpChanges: 0, completedTriggers: [] as string[] };
  game.startWithDecks = async options => {
    await start(options);
    game.turn = "player";
    game.turnCounter = 3;
    game.phase = scenario === "activation_cost" ? "main1" : "battle";
    game.battleStep = "battle";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const observers = scenario === "battle_damage" ? game.player : game.bot;
    for (const owner of [game.player, game.bot]) {
      const cards = [...owner.hand, ...owner.deck];
      owner.hand = [];
      owner.deck = cards;
      const take = (id: number) => {
        const card = required(owner.deck.find(card => card.id === id));
        owner.deck.splice(owner.deck.indexOf(card), 1);
        return card;
      };
      if (owner === observers) {
        placeFieldCards(owner.field, take(118));
        placeFieldCards(owner.spellTrap, take(119));
      }
      if (owner === game.player) {
        if (scenario === "activation_cost") owner.hand.push(take(33));
        else placeFieldCards(owner.field, take(111));
      } else if (scenario === "effect_damage") {
        const eel = take(101);
        eel.position = "defense";
        placeFieldCards(owner.field, eel);
      } else if (scenario === "battle_damage") {
        placeFieldCards(owner.field, take(107));
        owner.hand.push(take(116));
      }
    }
    game.on("lp_change", () => { observed.lpChanges++; });
    game.on("chain_link_resolution", event => {
      if (event.stage === "completed" && event.effectId) observed.completedTriggers.push(event.effectId);
    });
  };
  return observed;
}

for (const scenario of ["effect_damage", "battle_damage", "activation_cost"] as const) {
  test(`canonical replay preserves Shadow-Heart ${scenario} across locales`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 20260929,
      laboratoryMode: true, laboratoryUseBot: false });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback",
      laboratoryMode: true, laboratoryUseBot: false });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    const observed = installScenario(live, scenario);
    const replayObserved = installScenario(playback, scenario);
    playback.ui.showConfirmPrompt = async () => assert.fail("Replay must not ask for confirmation");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("Replay must not ask for position");
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
      playerDeck: [33, 111, 118, 119, ...Array<number>(10).fill(3)],
      botDeck: [101, 107, 116, 118, 119, ...Array<number>(10).fill(3)],
      playerExtraDeck: [], botExtraDeck: [] });
    if (scenario === "activation_cost") {
      assert.equal((await live.tryActivateSpell(required(live.player.hand[0]), 0)).success, true);
    } else {
      await live.resolveCombat(required(live.player.field.find(card => card.id === 111)),
        required(live.bot.field.find(card => card.id === (scenario === "effect_damage" ? 101 : 107))));
    }
    assert.equal(observed.lpChanges, 1);
    assert.equal(observed.completedTriggers.filter(id => id === "shadow_heart_void_mage_draw").length, 1);
    if (scenario !== "activation_cost") {
      assert.equal(observed.completedTriggers.filter(id => id === "shadow_heart_cathedral_add_counter").length, 1);
    }
    if (scenario === "battle_damage") assert.ok(live.bot.field.some(card => card.id === 116));
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "shadow-heart-lp-test" }))));
    assert.deepEqual(replay.commands.map(command => command.type), [scenario === "activation_cost" ? "activate_card" : "attack"]);
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game owns the cards and players used by canonical playback."),
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(replayObserved, observed);
  });
}
