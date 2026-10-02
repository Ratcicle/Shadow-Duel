import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import {
  createCanonicalStateSnapshot,
  hashCanonicalGameState,
  validateCanonicalReplay,
} from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { getTurnCardActivations } from "../../src/core/game/events/activationHistory.js";
import { record, required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { resolveSimulatedEndPhase } from "../../src/core/ai/common/simulation.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import { simulationState } from "../helpers/simulation.js";

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const wasSet of [false, true]) {
      for (const bug of ["B25", "B21", "B20", "B27"] as const) {
        for (const auraReduction of bug === "B27" ? [1300, 1400] : [0]) {
          const auraLabel = bug === "B27" ? `/prior reduction ${auraReduction}` : "";
          test(wasSet ? `B26 set Grimoire equip parity and replay ${bug} (${seat}/${controller}${auraLabel})`
            : `final equip parity and replay ${bug} (${seat}/${controller}/hand${auraLabel})`, async t => {
            const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true, laboratoryUseBot: false,
              randomSeed: 521, chainResponseTimeoutMs: 0 });
            const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
              laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
            t.after(() => { live.dispose(); playback.dispose(); });
            const hostId = bug === "B25" || bug === "B27" ? 314 : 305;
            for (const game of [live, playback]) {
              const start = game.startWithDecks.bind(game);
              game.startWithDecks = async options => {
                await start(options);
                game.turn = seat; game.phase = "main1"; game.turnCounter = 2; game.disablePresentationDelays = true;
                game.resetOncePerTurnUsage("final_equip_fixture");
                game.waitForBoardPresentation = async () => {};
                game.waitForPresentationDelay = async () => {};
                game.waitForAiPresentationStep = async () => {};
                game.player.controllerType = game.bot.controllerType = "human";
                const owner = game[seat], opponent = game.getOpponent(owner);
                owner.controllerType = controller;
                const cards = [...owner.hand, ...owner.deck], host = required(cards.find(card => card.id === hostId));
                const equips = cards.filter(card => card.id === 301), first = required(equips[0]);
                first.isFacedown = wasSet;
                if (wasSet) { first.setTurn = first.turnSetOn = 1; placeFieldCards(owner.spellTrap, first); }
                owner.hand = wasSet ? [required(equips[1])] : equips;
                owner.deck = cards.filter(card => card.id === 3);
                placeFieldCards(owner.field, host);
                if (bug === "B21") owner.graveyard.push(required(cards.find(card => card.id === 276)));
                const otherCards = [...opponent.hand, ...opponent.deck];
                opponent.hand = []; opponent.deck = otherCards.filter(card => card.id === 3);
                const target = required(otherCards.find(card => card.id === (bug === "B27" ? 302 : 306)));
                placeFieldCards(opponent.field, target);
                if (bug === "B27") {
                  const support = required(otherCards.find(card => card.id === 301));
                  placeFieldCards(opponent.spellTrap, support);
                  support.equippedTo = target; support.equipTarget = target; target.equips = [support];
                  target.atk -= auraReduction; target.tempAtkBoost = -auraReduction;
                  game.effectEngine.updatePassiveBuffs();
                  assert.deepEqual([target.atk, target.def], [1800 - auraReduction, 1000]);
                }
              };
            }
            live.ui.showConfirmPrompt = async () => true;
            live.ui.showChainResponseModal = async () => null;
            if (controller === "human") live.autoSelector.select = () => assert.fail("Human targeting must use the decision broker.");
            playback.ui.showConfirmPrompt = async () => assert.fail("Playback must consume recorded confirmations.");
            playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume recorded passes.");
            playback.ui.showTargetSelection = () => assert.fail("Playback must consume recorded targets.");
            playback.autoSelector.select = () => assert.fail("Playback cannot run a targeting policy.");
            const ownerDeck = [hostId, 301, 301, 276, ...Array<number>(16).fill(3)],
              otherDeck = bug === "B27" ? [302, 301, ...Array<number>(18).fill(3)] : [306, ...Array<number>(19).fill(3)];
            await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
              startingPlayer: seat, announceStartingPlayer: false, playerDeck: seat === "player" ? ownerDeck : otherDeck,
              botDeck: seat === "bot" ? ownerDeck : otherDeck, playerExtraDeck: [], botExtraDeck: [] });
            const owner = live[seat], opponent = live.getOpponent(owner), copies = createPlanningCopy();
            const simulated = simulationState({ turn: seat, phase: "main1", turnCounter: 2, _isPerspectiveState: true,
              bot: { id: seat, field: owner.field.map(copies.cloneCardForSim), hand: owner.hand.map(copies.cloneCardForSim),
                spellTrap: owner.spellTrap.map(copies.cloneCardForSim), graveyard: owner.graveyard.map(copies.cloneCardForSim),
                deck: owner.deck.map(copies.cloneCardForSim) },
              player: { id: opponent.id, field: opponent.field.map(copies.cloneCardForSim),
                spellTrap: opponent.spellTrap.map(copies.cloneCardForSim), deck: opponent.deck.map(copies.cloneCardForSim) } });
            const ai = new ArcanistStrategy(owner), equip = required(wasSet ? owner.spellTrap[0] : owner.hand[0]);
            ai.simulateMainPhaseAction(simulated, { type: wasSet ? "spellTrapEffect" : "spell", index: 0,
              zoneIndex: 0, cardId: 301, cardName: equip.name,
              ...(wasSet ? { effectId: "arcanist_grimoire_equip" } : {}) });
            let equippedEvents = 0, activationEvents = 0;
            live.on("card_equipped", () => { equippedEvents++; });
            live.on("spell_activated", () => { activationEvents++; });
            const pending = wasSet ? live.tryActivateSpellTrapEffect(equip, null, { owner, activationZone: "spellTrap" })
              : live.tryActivateSpell(equip, owner.hand.indexOf(equip), null, { owner });
            await completeTestSelections(live, pending);
            const activation = await pending;
            assert.equal(activation.success, true, activation.reason ?? undefined);
            assert.equal(owner.spellTrap.filter(card => card.id === 301 && !card.isFacedown).length, 1);
            assert.equal(equip.isFacedown, false);
            assert.equal(equip.equippedTo, owner.field[0]);
            assert.equal(equippedEvents, 1);
            assert.equal(activationEvents, 1);
            assert.equal(getTurnCardActivations(live).length, 1);
            assert.deepEqual(simulated.bot.hand.map(card => card.id), owner.hand.map(card => card.id));
            assert.deepEqual(simulated.player.field.map(card => [card.atk, card.def]), opponent.field.map(card => [card.atk, card.def]));
            assert.deepEqual(simulated._simUnsupportedActions || [], []);
            if (bug === "B21") assert.ok(owner.hand.some(card => card.id === 276));
            if (bug === "B25" || bug === "B27") {
              assert.deepEqual([opponent.field[0]?.atk, opponent.field[0]?.def], bug === "B27"
                ? [auraReduction === 1300 ? 200 : 0, 450] : [700, 850]);
              resolveSimulatedEndPhase(simulated);
              for (let phase = 0; phase < 4; phase++) await live.nextPhase();
              assert.deepEqual([opponent.field[0]?.atk, opponent.field[0]?.def], bug === "B27" ? [1800, 1000] : [1500, 1800]);
              assert.deepEqual(simulated.player.field.map(card => [card.atk, card.def]), opponent.field.map(card => [card.atk, card.def]));
            }
            if (bug === "B20") {
              const beforeSim = fingerprintPlanningState(simulated), beforeLive = hashCanonicalGameState(live);
              ai.simulateMainPhaseAction(simulated, { type: "spell", index: 0, cardId: 301, cardName: equip.name });
              assert.equal(fingerprintPlanningState(simulated), beforeSim);
              const second = required(owner.hand.find(card => card.id === 301));
              const rejection = await live.tryActivateSpell(second, owner.hand.indexOf(second), null, { owner });
              assert.equal(rejection.success, false);
              assert.equal(hashCanonicalGameState(live), beforeLive);
            }
            assert.deepEqual(simulated._simUnsupportedActions || [], []);
            const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "arcanist-final" }))));
            assert.equal(saved.schemaVersion, 2); assert.equal(saved.engineVersion, "engine-rules-v12");
            assert.equal(saved.cardDatabaseSignature, "7bbe98b0");
            assert.ok(saved.decisions.some(decision => decision.kind === "target"));
            assert.equal(saved.commands[0]?.type, wasSet ? "activate_effect" : "activate_card");
            const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
              "Both real Games install the same deterministic final equip fixture before recorded commands.") });
            assert.equal(result.ok, true); assert.equal(result.finalStateHash, saved.result?.finalStateHash);
            assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
            assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
          });
        }
      }
    }
  }
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const id of [307, 313, 314]) {
      test(`B08/B17/B19 ${id} canonical replay consumes imperative targets or prior activation history (${seat}/${controller})`, async t => {
        const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true, laboratoryUseBot: false,
          randomSeed: 409, chainResponseTimeoutMs: 0 });
        const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
        t.after(() => { live.dispose(); playback.dispose(); });
        for (const game of [live, playback]) {
          const start = game.startWithDecks.bind(game);
          game.startWithDecks = async options => {
            await start(options);
            game.turn = seat; game.phase = "main1"; game.turnCounter = 2;
            game.disablePresentationDelays = true;
            game.waitForBoardPresentation = async () => {};
            game.waitForPresentationDelay = async () => {};
            game.waitForAiPresentationStep = async () => {};
            game.player.controllerType = game.bot.controllerType = "human";
            const owner = game[seat], opponent = game.getOpponent(owner);
            owner.controllerType = controller;
            const cards = [...owner.hand, ...owner.deck], source = required(cards.find(card => card.id === id));
            const allies = cards.filter(card => card.id === 306);
            owner.hand = id === 313 ? [source, ...[301, 304, 310].map(spellId => required(cards.find(card => card.id === spellId)))]
              : [required(cards.find(card => card.id === 301))];
            owner.deck = cards.filter(card => card.id === 3);
            if (id === 313) placeFieldCards(owner.field, ...allies);
            else placeFieldCards(owner.field, source);
            if (id === 307) owner.graveyard.push(required(allies[0]));
            const opposing = [...opponent.hand, ...opponent.deck];
            opponent.hand = [];
            opponent.deck = opposing.filter(card => card.id === 3);
            placeFieldCards(opponent.field, required(opposing.find(card => card.id === 306)));
          };
        }
        live.ui.showConfirmPrompt = async () => assert.fail("These imperative effects have no optional confirmation.");
        live.ui.showChainResponseModal = async () => null;
        if (controller === "human") live.autoSelector.select = () => assert.fail("Human selections must use recorded decisions.");
        playback.ui.showConfirmPrompt = async () => assert.fail("Playback must consume recorded decisions.");
        playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume recorded responses.");
        playback.ui.showTargetSelection = () => assert.fail("Playback must consume recorded targets.");
        playback.autoSelector.select = () => assert.fail("Playback must not invoke a targeting policy.");
        const ownerDeck = [id, 301, 304, 310, 306, 306, ...Array<number>(14).fill(3)];
        const otherDeck = [306, ...Array<number>(19).fill(3)];
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
          startingPlayer: seat, announceStartingPlayer: false, playerDeck: seat === "player" ? ownerDeck : otherDeck,
          botDeck: seat === "bot" ? ownerDeck : otherDeck, playerExtraDeck: [], botExtraDeck: [] });
        const owner = live[seat], opponent = live.getOpponent(owner);
        const activate = async (spellId: number) => {
          const spell = required(owner.hand.find(card => card.id === spellId));
          const pending = live.tryActivateSpell(spell, owner.hand.indexOf(spell), null, { owner });
          await completeTestSelections(live, pending);
          assert.equal((await pending).success, true);
        };
        if (id === 313) {
          await activate(310);
          await activate(304);
          assert.equal(getTurnCardActivations(live).length, 2);
          const source = required(owner.hand.find(card => card.id === 313));
          const pending = live.performNormalSummon(owner, owner.hand.indexOf(source), "attack", false, [0, 1]);
          await completeTestSelections(live, pending);
          assert.equal((await pending)?.success, true);
          assert.equal(source.atk, source.baseAtk + 200);
        }
        await activate(301);
        if (id === 307) assert.ok(owner.hand.some(card => card.id === 306));
        if (id === 313) {
          const source = required(owner.field.find(card => card.id === 313));
          assert.equal(source.atk, source.baseAtk + 300);
        }
        if (id === 314) assert.equal(opponent.field[0]?.atk, Math.floor((required(opponent.field[0]).baseAtk - 100) / 2));
        const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "arcanist-history" }))));
        assert.equal(saved.schemaVersion, 2);
        assert.equal(saved.engineVersion, "engine-rules-v12");
        assert.equal(saved.decisions.some(decision => decision.kind === "choice"), false);
        assert.ok(saved.decisions.some(decision => decision.kind === "target"));
        assert.deepEqual(saved.commands.map(command => command.type), id === 313
          ? ["activate_card", "activate_card", "summon", "activate_card"] : ["activate_card"]);
        const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
          "Both real Games install the same deterministic activation-history fixture before commands.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, saved.result?.finalStateHash);
        assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
        assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
      });
    }
  }
}

function installStartingFixture(game: RuntimeGame, seat: PlayerId) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat;
    game.phase = "main1";
    game.turnCounter = 2;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    const owner = game[seat];
    const cards = [...owner.hand, ...owner.deck];
    owner.hand = [301, 304, 310, 307].map(id => required(cards.find(card => card.id === id)));
    owner.deck = cards.filter(card => card.id === 3);
    const host = required(cards.find(card => card.id === 306));
    placeFieldCards(owner.field, host);
  };
}

async function setup(t: TestContext, seat: PlayerId, manualPlacement = false) {
  const live = createRuntimeGame({
    captureReplay: true, laboratoryMode: true, laboratoryUseBot: false, randomSeed: 407, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => manualPlacement ? "manual" : "automatic",
    fieldPlacementProvider: async request => ({ outcome: "chosen", slot: required(request.candidates.at(-1)).slot }),
  });
  const playback = createRuntimeGame({
    captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => assert.fail("Playback must use its recorded placement decision."),
  });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) installStartingFixture(game, seat);
  playback.ui.showConfirmPrompt = async () => assert.fail("Playback must not ask live storage/overwrite questions.");
  playback.autoSelector.select = () => assert.fail("Playback must not recalculate a targeting policy.");
  const ownerDeck = [301, 304, 310, 307, 306, ...Array<number>(14).fill(3)];
  const otherDeck = Array<number>(19).fill(3);
  await live.startWithDecks({
    exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
    startingPlayer: seat, announceStartingPlayer: false,
    playerDeck: seat === "player" ? ownerDeck : otherDeck,
    botDeck: seat === "bot" ? ownerDeck : otherDeck,
    playerExtraDeck: [], botExtraDeck: [],
  });
  const owner = live[seat];
  const host = required(owner.field[0]);
  const grimoire = required(owner.hand.find(card => card.id === 301));
  const activate = async (id: number, targetRef: string) => {
    const card = required(owner.hand.find(candidate => candidate.id === id));
    const pending = live.tryActivateSpell(card, owner.hand.indexOf(card), { [targetRef]: [host] }, { owner });
    await completeTestSelections(live, pending);
    const result = await pending;
    assert.equal(result.success, true, result.reason ?? undefined);
  };
  const replay = async () => {
    const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "arcanist-design" }))));
    const result = await replayCanonicalDuel(saved, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Both real Game instances install the same deterministic starting fixture."),
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, saved.result?.finalStateHash);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
    return saved;
  };
  return { live, playback, owner, host, grimoire, activate, replay };
}

async function setupDestructionReplay(t: TestContext, seat: PlayerId, controller: "human" | "ai", id: number) {
  const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true, laboratoryUseBot: false,
    randomSeed: 408, chainResponseTimeoutMs: 0 });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
    laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) {
    const start = game.startWithDecks.bind(game);
    game.startWithDecks = async options => {
      await start(options);
      game.turn = seat;
      game.phase = "main1";
      game.turnCounter = 2;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = async () => {};
      game.waitForPresentationDelay = async () => {};
      game.waitForAiPresentationStep = async () => {};
      game.player.controllerType = game.bot.controllerType = "human";
      const owner = game[seat], opponent = game.getOpponent(owner);
      owner.controllerType = controller;
      const cards = [...owner.hand, ...owner.deck];
      const source = required(cards.find(card => card.id === id));
      owner.hand = id === 303 ? [source] : [];
      owner.deck = cards.filter(card => card.id === 3);
      if (id === 303) placeFieldCards(owner.field, required(cards.find(card => card.id === 306)));
      else {
        placeFieldCards(owner.field, source);
        const equip = required(cards.find(card => card.id === 301));
        placeFieldCards(owner.spellTrap, equip);
        equip.equippedTo = source;
        source.equips = [equip];
      }
      const opposingCards = [...opponent.hand, ...opponent.deck];
      const enemy = required(opposingCards.find(card => card.id === 306));
      opponent.hand = [];
      opponent.deck = opposingCards.filter(card => card.id === 3);
      placeFieldCards(opponent.field, enemy);
      enemy.isFacedown = true;
      enemy.position = "defense";
    };
  }
  live.ui.showChainResponseModal = async () => null;
  playback.ui.showConfirmPrompt = async () => assert.fail("Playback must consume recorded confirmation decisions.");
  playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume recorded responses.");
  playback.ui.showTargetSelection = () => assert.fail("Playback must consume recorded targets.");
  playback.autoSelector.select = () => assert.fail("Playback must not recalculate an AI targeting policy.");
  const ownerDeck = [id, id === 303 ? 306 : 301, ...Array<number>(18).fill(3)];
  const otherDeck = [306, ...Array<number>(19).fill(3)];
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
    startingPlayer: seat, announceStartingPlayer: false, playerDeck: seat === "player" ? ownerDeck : otherDeck,
    botDeck: seat === "bot" ? ownerDeck : otherDeck, playerExtraDeck: [], botExtraDeck: [] });
  return { live, playback, owner: live[seat], opponent: live.getOpponent(live[seat]) };
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const id of [303, 313]) {
      test(`B06/B16 ${id} replays face-down targeting in another instance (${seat}/${controller})`, async t => {
        const { live, playback, owner, opponent } = await setupDestructionReplay(t, seat, controller, id);
        const source = required(id === 303 ? owner.hand[0] : owner.field[0]);
        const enemy = required(opponent.field[0]);
        const hidden = required(live.getPublicState(seat).players.opponent.field[0]);
        assert.deepEqual([hidden.cardId, hidden.name, hidden.atk, hidden.def], [null, null, null, null]);
        const pending = id === 303 ? live.tryActivateSpell(source, 0, null, { owner })
          : live.tryActivateMonsterEffect(source, null, "field", owner, { effectId: "elementalist_master_destroy" });
        await completeTestSelections(live, pending);
        const activation = await pending;
        assert.equal(activation.success, true, activation.reason ?? undefined);
        assert.ok(opponent.graveyard.includes(enemy));
        const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "arcanist-facedown" }))));
        assert.equal(saved.schemaVersion, 2);
        assert.equal(saved.engineVersion, "engine-rules-v12");
        assert.equal(saved.commands.length, 1);
        assert.equal(saved.commands[0]?.type, id === 303 ? "activate_card" : "activate_effect");
        assert.ok(saved.decisions.some(decision => decision.kind === "target" && "selections" in decision.value &&
          decision.value.selections[id === 303 ? "crimson_magic_opponent_target" : "elementalist_destroy_target"]?.some(
            candidate => "duelCardId" in candidate && candidate.duelCardId === enemy.duelCardId)));
        const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
          "Both real Games install the same deterministic face-down targeting fixture.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, saved.result?.finalStateHash);
        assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
        assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
        assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
      });
    }
  }
}

for (const seat of ["player", "bot"] as const) {
  for (const scenario of ["initial_refusal", "accept_overwrite", "refuse_overwrite"] as const) {
    test(`Grimoire canonical replay preserves ${scenario} and copied activation (${seat})`, async t => {
      const { live, playback, owner, host, grimoire, activate, replay } = await setup(t, seat);
      const answers = scenario === "initial_refusal" ? [false] : [true, scenario === "accept_overwrite"];
      let prompts = 0;
      live.ui.showConfirmPrompt = async () => required(answers[prompts++], "expected storage confirmation");
      await activate(301, "grimoire_equip_target");
      await activate(304, "lightning_magic_lance_target");
      assert.equal(live.effectEngine.getStoredBlueprints(grimoire).length, scenario === "initial_refusal" ? 0 : 1);
      let expectedSource = scenario === "initial_refusal" ? null : 304;
      if (scenario !== "initial_refusal") {
        await activate(310, "arcanist_ice_barrier_target");
        expectedSource = scenario === "accept_overwrite" ? 310 : 304;
        assert.equal(required(live.effectEngine.getStoredBlueprints(grimoire)[0]).sourceCardId, expectedSource);
        const targetRef = expectedSource === 310 ? "arcanist_ice_barrier_target" : "lightning_magic_lance_target";
        const pending = live.tryActivateSpellTrapEffect(grimoire, { [targetRef]: [host] }, { owner });
        await completeTestSelections(live, pending);
        assert.equal((await pending).success, true);
        assert.ok(owner.spellTrap.includes(grimoire));
        assert.equal(host.atk, expectedSource === 310 ? 2000 : 2500);
        assert.equal(owner.hand.filter(card => card.id === 3).length, expectedSource === 310 ? 4 : 2);
        assert.equal(live.temporaryReplacementEffects.length, expectedSource === 310 ? 2 : 1);

        const replacements = live.temporaryReplacementEffects;
        const protectedHash = hashCanonicalGameState(live);
        live.temporaryReplacementEffects = [];
        assert.notEqual(hashCanonicalGameState(live), protectedHash, "pending prevention must contribute to the canonical state hash");
        live.temporaryReplacementEffects = replacements;
      }
      assert.equal(prompts, answers.length);
      const saved = await replay();
      const replayGrimoire = required(playback[seat].spellTrap.find(card => card.id === 301));
      assert.deepEqual(playback.effectEngine.getStoredBlueprints(replayGrimoire), live.effectEngine.getStoredBlueprints(grimoire));
      assert.equal(playback.effectEngine.getStoredBlueprints(replayGrimoire)[0]?.sourceCardId ?? null, expectedSource);
      const storageDecisions = saved.decisions.filter(decision => decision.kind === "choice");
      assert.deepEqual(storageDecisions.map(decision => "candidateKey" in decision.value && decision.value.candidateKey === "confirm"), answers);
      assert.ok(saved.decisions.some(decision => decision.kind === "target"));
      assert.equal(saved.commands.filter(command => command.type === "activate_effect").length, scenario === "initial_refusal" ? 0 : 1);

      if (expectedSource !== null) {
        const storage = live.effectEngine.getBlueprintStorageState(grimoire, true);
        const stored = storage.storedBlueprints;
        const before = hashCanonicalGameState(live);
        storage.storedBlueprints = [];
        assert.notEqual(hashCanonicalGameState(live), before, "different stored effects must not collapse to the same state hash");
        storage.storedBlueprints = stored;
        const snapshot = record(createCanonicalStateSnapshot(playback));
        assert.ok(Array.isArray(snapshot.temporaryReplacementEffects));
        assert.equal(snapshot.temporaryReplacementEffects.length, expectedSource === 310 ? 2 : 1);
        const registration = record(snapshot.temporaryReplacementEffects[0]);
        assert.equal(registration.usesRemaining, 1);
        assert.equal(registration.expiresOnTurn, 3);
        const replacement = record(registration.replacementEffect);
        assert.equal(Object.hasOwn(replacement, "targetCards"), false);
        assert.equal(Object.hasOwn(replacement, "targetInstanceIds"), false);
        assert.ok(Array.isArray(replacement.targetPresences));
        const presence = record(replacement.targetPresences[0]);
        assert.equal(Object.hasOwn(presence, "instanceId"), false);
        assert.equal(presence.duelCardId, host.duelCardId);
        assert.equal(presence.locationVersion, host.locationVersion);
      }
    });
  }

  test(`Albus no-cost hand procedure replays its placement without activation or payment (${seat})`, async t => {
    const { live, playback, owner, replay } = await setup(t, seat, true);
    const albus = required(owner.hand.find(card => card.id === 307));
    const handBefore = owner.hand.length;
    const result = await live.performHandSummonProcedure(albus, owner, { position: "attack" });
    assert.equal(result.success, true, result.reason ?? undefined);
    assert.ok(owner.field.includes(albus));
    assert.equal(albus.fieldSlot, 4);
    assert.equal(owner.hand.length, handBefore - 1);
    assert.equal(owner.graveyard.length, 0);
    assert.equal(owner.banished.length, 0);
    const saved = await replay();
    assert.deepEqual(saved.commands.map(command => command.type), ["hand_summon_procedure"]);
    assert.equal(saved.decisions.filter(decision => decision.kind === "cost").length, 0);
    assert.equal(saved.decisions.filter(decision => decision.kind === "field_placement").length, 1);
    const replayedAlbus = required(playback[seat].field.find(card => card.id === 307));
    assert.equal(replayedAlbus.fieldSlot, 4);
    assert.equal(replayedAlbus.lastSummonProcedure, albus.lastSummonProcedure);
  });
}
