import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "crystal" | "bull" | "peak" | "abyssal" | "rainbow" | "protection" | "galaxy" | "armored" | "mist";

function install(game: RuntimeGame, scenario: Scenario, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.turnCounter = 4; game.phase = "main1";
    game.battleStep = "battle"; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    owner.controllerType = controller;
    for (const player of [owner, opponent]) {
      player.deck = [...player.hand, ...player.deck]; player.hand = [];
    }
    const take = (id: number, player = owner) => {
      const card = required(player.deck.find(card => card.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    if (scenario === "crystal") {
      owner.hand.push(take(264)); owner.graveyard.push(take(251), take(254), take(255));
    } else if (scenario === "bull") {
      owner.hand.push(take(259), take(254), take(255)); placeFieldCards(owner.field, take(251));
    } else if (scenario === "peak") {
      const peak = take(262); peak.addCounter("dragon_peak", 7); owner.fieldSpell = peak;
    } else if (scenario === "abyssal") {
      placeFieldCards(owner.field, take(263)); placeFieldCards(opponent.field, take(257, opponent));
    } else if (scenario === "rainbow") {
      const rainbow = required(owner.extraDeck.shift()); owner.graveyard.push(rainbow);
    } else if (scenario === "protection") {
      placeFieldCards(owner.field, required(owner.extraDeck.shift()), take(255));
    } else if (scenario === "mist") {
      placeFieldCards(opponent.field, take(272, opponent)); owner.hand.push(take(255));
    } else {
      game.phase = "battle"; game.turn = opponent.id;
      placeFieldCards(owner.field, take(scenario === "galaxy" ? 273 : 252));
      const attacker = take(259, opponent); attacker.atk = 4000;
      placeFieldCards(opponent.field, attacker);
      const drawn = take(255); owner.deck.push(drawn);
    }
  };
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const scenario of ["crystal", "bull", "peak", "abyssal", "rainbow", "protection", "galaxy", "armored", "mist"] as const) {
      test(`Dragon ${scenario} ${seat} ${controller} records and replays in another instance`, async t => {
        setLocale("en");
        const live = createRuntimeGame({ captureReplay: true, randomSeed: 629, laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
        const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
        t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
        install(live, scenario, seat, controller); install(playback, scenario, seat, controller);
        live.ui.showConfirmPrompt = async () => true;
        live.ui.showChainResponseModal = async () => null;
        live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
        playback.ui.showConfirmPrompt = async () => assert.fail("Replay cannot request confirmation");
        playback.ui.showChainResponseModal = async () => assert.fail("Replay cannot request a response");
        playback.ui.showSpecialSummonPositionModal = () => assert.fail("Replay cannot request position");
        playback.autoSelector.select = () => assert.fail("Replay cannot recompute an AI selection");
        const deck = [251, 252, 254, 255, 257, 259, 262, 263, 264, 270, 271, 272, 273, 274, ...Array<number>(8).fill(3)];
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
          playerDeck: deck, botDeck: deck, playerExtraDeck: [267], botExtraDeck: [267] });
        const owner = live[seat], opponent = live.getOpponent(owner);
        const action = scenario === "crystal" ? live.performHandSummonProcedure(required(owner.hand[0]), owner, { position: "defense" })
          : scenario === "bull" ? live.tryActivateMonsterEffect(required(owner.hand[0]), null, "hand", owner, { effectId: "bbd_special_summon_from_hand" })
          : scenario === "peak" ? live.activateFieldSpellEffect(required(owner.fieldSpell))
          : scenario === "rainbow" ? live.tryActivateMonsterEffect(required(owner.graveyard[0]), null, "graveyard", owner, { effectId: "rainbow_cosmic_dragon_gy_send_extremes" })
          : scenario === "abyssal" ? live.tryActivateMonsterEffect(required(owner.field[0]), null, "field", owner, { effectId: "abyssal_serpent_delayed_summon_effect" })
          : scenario === "protection" ? live.tryActivateMonsterEffect(required(owner.field[0]), null, "field", owner, { effectId: "rainbow_cosmic_dragon_protect_dragon" })
          : scenario === "mist" ? live.performNormalSummon(owner, 0, "attack", false)
          : live.resolveCombat(required(opponent.field[0]), required(owner.field[0]));
        await completeTestSelections(live, Promise.resolve(action));
        if (scenario === "crystal") { assert.equal(owner.banished.length, 3); assert.equal(owner.field[0]?.id, 264); }
        if (scenario === "bull") { assert.equal(owner.graveyard.length, 2); assert.ok(owner.field.some(card => card.id === 259 && card.cannotAttackThisTurn)); assert.equal(opponent.lp, 8000); }
        if (scenario === "peak") { assert.equal(owner.fieldSpell, null); assert.equal(owner.field.length, 1); }
        if (scenario === "abyssal") assert.equal(live.delayedActions.length, 1);
        if (scenario === "rainbow") { assert.equal(owner.banished[0]?.id, 267); assert.ok(owner.graveyard.length > 0); }
        if (scenario === "protection") assert.ok(owner.field.some(card => card.protectionEffects?.length === 2));
        if (scenario === "galaxy") assert.equal(owner.banished[0]?.id, 273);
        if (scenario === "armored") assert.ok(owner.field.some(card => card.id === 255));
        if (scenario === "mist") assert.equal(opponent.field[0]?.fieldPresenceSummons.length, 1);
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: `dragon-${scenario}` }))));
        assert.equal(replay.commands.length, 1, "Resolution must not add external commands");
        setLocale("pt-br");
        const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game exposes its own players and cards to the replay driver.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      });
    }
  }
}
