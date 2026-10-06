import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
type Family = "level" | "reactor" | "singularity";
type Controller = "human" | "ai";

/** Identical initial zones are rebuilt after the recorder/driver installs exact decks. */
function installFixture(game: RuntimeGame, seat: Seat, family: Family, controller: Controller) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat;
    game.phase = "main1";
    game.turnCounter = 4;
    game.phaseDelayMs = 0;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    game[seat].controllerType = controller;
    game.player.strategy = game.bot.strategy = null;
    for (const owner of [game.player, game.bot]) owner.deck.push(...owner.hand.splice(0));
    const owner = game[seat];
    const opponent = game[seat === "player" ? "bot" : "player"];
    const take = (holder: typeof owner, id: number) => {
      const zone = holder.deck.some(card => card.id === id) ? holder.deck : holder.extraDeck;
      const card = required(zone.find(card => card.id === id));
      zone.splice(zone.indexOf(card), 1);
      card.isFacedown = false;
      card.position = "attack";
      if (card.monsterType === "synchro") {
        card.properSummonEstablished = true;
        card.properSummonProcedure = "synchro";
      }
      return card;
    };
    const materialIds = family === "level" ? [503] : family === "reactor" ? [501, 514] : [503, 510, 511];
    placeFieldCards(owner.field, ...materialIds.map(id => take(owner, id)));
    if (family !== "level") placeFieldCards(opponent.field, take(opponent, 507));
  };
}

for (const seat of ["player", "bot"] as const) {
  for (const family of ["level", "reactor", "singularity"] as const) {
    const controllers: readonly Controller[] = family === "level" ? ["human", "ai"] : ["human"];
    for (const controller of controllers) {
      test(`durationless ${family} survives a recorded turn boundary and EN/PT replay (${seat}/${controller})`, { timeout: 20000 }, async t => {
        setLocale("en");
        const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true,
          randomSeed: 503515517, chainResponseTimeoutMs: 0 });
        const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
          replayMode: "playback", chainResponseTimeoutMs: 0 });
        t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
        installFixture(live, seat, family, controller);
        installFixture(playback, seat, family, controller);
        live.ui.showConfirmPrompt = async () => true;
        live.ui.showTriggerOrderModal = async options => options?.optional ? []
          : (options?.candidates || []).map(candidate => candidate.candidateId);
        live.ui.showChainResponseModal = async () => null;
        live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
        const deck = [501, 507, ...Array<number>(18).fill(3)];
        const extra = [503, 510, 511, 514, 515, 517];
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
          playerDeck: deck, botDeck: deck, playerExtraDeck: extra, botExtraDeck: extra });
        const owner = live[seat];
        const opponent = live[seat === "player" ? "bot" : "player"];
        const affected = required(family === "level" ? owner.field[0] : opponent.field[0]);
        const source = family === "level" ? affected : required(owner.extraDeck.find(card => card.id === (family === "reactor" ? 515 : 517)));
        const action = family === "level"
          ? live.tryActivateMonsterEffect(source, null, "field", owner, { effectId: "tech_zero_multimodal_machine_level_mod" })
          : live.performSynchroSummonFromExtraDeck(source, owner, { materials: [...owner.field] });
        await completeTestSelections(live, action);
        assert.equal((await action).success, true);
        const modifiedLevel = affected.level;
        if (family === "level") assert.notEqual(modifiedLevel, 3);
        else {
          assert.equal(affected.effectsNegated, true);
          assert.equal(affected.effectsNegatedDuration, "while_faceup");
        }
        const transition = live.skipToPhase("end");
        await completeTestSelections(live, transition);
        await transition;
        assert.equal(live.turnCounter, 5);
        assert.notEqual(live.turn, seat);
        assert.ok((family === "level" ? owner : opponent).field.includes(affected));
        if (family === "level") assert.equal(affected.level, modifiedLevel);
        else assert.equal(affected.effectsNegated, true);
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "techzero-duration-defaults" }))));
        assert.ok(replay.commands.some(command => command.type === "phase_intent"));
        assert.equal(replay.engineVersion, "engine-rules-v23");
        if (controller === "ai") {
          const mode = required(replay.decisions.find(decision => decision.kind === "choice"));
          const target = required(replay.decisions.find(decision => decision.kind === "target"));
          assert.equal(mode.actorId, seat);
          assert.equal(mode.candidateKeys.length, 4);
          assert.equal(target.actorId, seat);
          assert.ok(JSON.stringify(target.value).includes(`"duelCardId":${affected.duelCardId}`));
        }
        playback.ui.showTargetSelection = () => assert.fail("Playback must consume recorded selections");
        playback.ui.showConfirmPrompt = async () => assert.fail("Playback must consume recorded consent");
        playback.ui.showTriggerOrderModal = async () => assert.fail("Playback must consume recorded trigger ordering");
        playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume recorded Chain passes");
        playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must consume recorded summon position");
        playback.autoSelector.select = () => assert.fail("Playback must not rerun AI choices");
        setLocale("pt-br");
        const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
          "Concrete runtime rebuilds the same deterministic deck and initial-zone fixture in another Game.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
        assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
        assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
        assert.deepEqual(playback.getRandomState(), live.getRandomState());
      });
    }
  }
}
