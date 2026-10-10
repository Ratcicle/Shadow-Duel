import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function install(game: RuntimeGame, controller: "human" | "ai", source: "spirit" | "quick") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.phase = "main2"; game.turn = "player"; game.turnCounter = 2;
    game.disablePresentationDelays = true; game.phaseDelayMs = 0;
    game.player.controllerType = "human"; game.bot.controllerType = controller;
    for (const owner of [game.player, game.bot]) owner.deck.push(...owner.hand.splice(0));
    const card = required(game.bot.deck.find(card => card.id === (source === "spirit" ? 16 : 1)));
    game.bot.deck.splice(game.bot.deck.indexOf(card), 1);
    if (source === "spirit") {
      card.isFacedown = true; card.setTurn = card.turnSetOn = 1;
      placeFieldCards(game.bot.spellTrap, card);
      for (let i = 0; i < 4; i++) placeFieldCards(game.bot.field, required(game.bot.deck.pop()));
    } else {
      card.effects = [{ id: "replay_phase_quick", timing: "ignition", speed: 2, isQuickEffect: true,
        activationZones: ["field"], oncePerTurn: true, usagePolicy: "use", actions: [{ type: "heal", amount: 137, player: "self" }] }];
      placeFieldCards(game.bot.field, card);
    }
  };
}

for (const route of ["next", "skip"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const source of ["spirit", "quick"] as const) {
      test(`End response ${route}/${controller}/${source} replays exact decisions in another Game`, async t => {
        const live = createRuntimeGame({ captureReplay: true, randomSeed: 137, laboratoryMode: true, laboratoryUseBot: false });
        const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
        t.after(() => { live.dispose(); playback.dispose(); });
        install(live, controller, source); install(playback, controller, source);
        let chosen = false;
        let liveEndEvents = 0;
        let playbackEndEvents = 0;
        live.on("end_phase", () => { liveEndEvents++; });
        playback.on("end_phase", () => { playbackEndEvents++; });
        live.ui.showChainResponseModal = async candidates => {
          if (chosen || live.turn !== "player" || live.phase !== "end") return null;
          chosen = true;
          return required(candidates[0]);
        };
        live.bot.strategy = { chooseChainResponse: ({ activatable }) => {
          if (chosen || live.turn !== "player" || live.phase !== "end") return { pass: true };
          chosen = true;
          return required(activatable[0]);
        } };
        playback.ui.showChainResponseModal = async () => assert.fail("playback cannot ask for human responses");
        playback.bot.strategy = { chooseChainResponse: () => assert.fail("playback cannot run AI response policy") };
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
          playerDeck: Array<number>(12).fill(1), botDeck: [16, ...Array<number>(11).fill(1)], playerExtraDeck: [], botExtraDeck: [] });
        if (route === "next") {
          await live.nextPhase();
          assert.equal(live.phase, "end");
          assert.equal(live.turnCounter, 2);
        }
        const advance = () => route === "next" ? live.nextPhase() : live.skipToPhase("end");
        await completeTestSelections(live, Promise.resolve(advance()));
        assert.equal(chosen, true);
        assert.equal(live.turn, "player");
        assert.equal(live.phase, "end");
        await completeTestSelections(live, Promise.resolve(advance()));
        assert.equal(live.turn, "bot");
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "phase-lifecycle" }))));
        assert.equal(replay.commands.length, route === "next" ? 3 : 2, "nested phase work cannot create duplicate commands");
        assert.ok(replay.decisions.some(decision => decision.kind === "chain_response"));
        const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game with the same deterministic phase fixture.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
        assert.equal(liveEndEvents, 1);
        assert.equal(playbackEndEvents, 1);
      });
    }
  }
}

test("ordinary Main 2 advance enters End without replaying a turn-ending shortcut", async t => {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 138, laboratoryMode: true, laboratoryUseBot: false });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) {
    const start = game.startWithDecks.bind(game);
    game.startWithDecks = async options => { await start(options); game.phase = "main2"; game.turnCounter = 2; game.phaseDelayMs = 0; };
  }
  await live.startWithDecks({ exactDecks: true, initializeOnly: true, startingPlayer: "player", announceStartingPlayer: false,
    playerDeck: Array<number>(12).fill(1), botDeck: Array<number>(12).fill(1), playerExtraDeck: [], botExtraDeck: [] });
  await live.nextPhase();
  assert.equal(live.phase, "end");
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "phase-next-only" }))));
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game fixture reproduces same starting phase.") });
  assert.equal(result.ok, true);
  assert.equal(playback.turn, "player");
  assert.equal(playback.phase, "end");
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
});

test("public summon, position, attack and turn reset replay card action state and detect counter tampering", async t => {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 139, laboratoryMode: true, laboratoryUseBot: false });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  const tampered = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); tampered.dispose(); });
  for (const game of [live, playback, tampered]) {
    const start = game.startWithDecks.bind(game);
    game.startWithDecks = async options => {
      await start(options);
      game.player.controllerType = "human";
      game.bot.controllerType = "human";
      game.disablePresentationDelays = true;
      game.phaseDelayMs = 0;
    };
  }
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
    playerDeck: Array<number>(16).fill(1), botDeck: Array<number>(16).fill(1), playerExtraDeck: [], botExtraDeck: [] });
  await live.skipToPhase("main1");
  const summonedOnTurn = live.turnCounter;
  await live.performNormalSummon(live.player, 0, "attack", false, null);
  const card = required(live.player.field[0]);
  const snapshotCard = (index = 0) => required(createCanonicalStateSnapshot(live).players.player.zones.field[index]);
  assert.equal(snapshotCard().summonedTurn, summonedOnTurn);
  assert.equal(snapshotCard().attacksUsedThisTurn, 0);
  assert.equal(snapshotCard().hasAttacked, false);
  await live.skipToPhase("end");
  assert.equal(live.turn, "bot");
  await live.skipToPhase("end");
  assert.equal(live.turn, "player");
  await live.skipToPhase("main1");
  assert.equal((await live.changeMonsterPosition(card, "defense")).ok, true);
  assert.equal(snapshotCard().positionChangedThisTurn, true);
  const attackerSummonedOnTurn = live.turnCounter;
  await live.performNormalSummon(live.player, 0, "attack", false, null);
  const attacker = required(live.player.field[1]);
  await live.skipToPhase("battle");
  await live.resolveCombat(attacker, null);
  const attacked = snapshotCard(1);
  assert.equal(attacked.attacksUsedThisTurn, 1);
  assert.equal(attacked.hasAttacked, true);
  assert.equal(attacked.summonedTurn, attackerSummonedOnTurn);
  assert.equal(attacked.positionChangedThisTurn, false);
  await live.skipToPhase("end");
  assert.equal(snapshotCard(1).attacksUsedThisTurn, 1, "usage remains until this monster's controller starts a turn");
  assert.equal(snapshotCard().positionChangedThisTurn, true);
  await live.skipToPhase("end");
  assert.equal(live.turn, "player");
  const reset = snapshotCard(1);
  assert.equal(reset.attacksUsedThisTurn, 0);
  assert.equal(reset.hasAttacked, false);
  assert.equal(reset.positionChangedThisTurn, false);
  assert.equal(reset.summonedTurn, attackerSummonedOnTurn);
  assert.equal(snapshotCard().positionChangedThisTurn, false);
  assert.equal(snapshotCard().summonedTurn, summonedOnTurn);
  assert.equal(attacked.attacksUsedThisTurn, 1, "older snapshots remain detached after reset");
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "card-action-lifecycle" }))));
  assert.ok(replay.commands.some(command => command.type === "summon"));
  assert.ok(replay.commands.some(command => command.type === "change_position"));
  const attackCommand = required(replay.commands.find(command => command.type === "attack"));
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game with identical presentation and controller configuration.") });
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
  assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
  const resolveCombat = tampered.resolveCombat.bind(tampered);
  tampered.resolveCombat = async (attacker, target, options) => {
    const result = await resolveCombat(attacker, target, options);
    required(attacker).attacksUsedThisTurn += 1;
    return result;
  };
  await assert.rejects(() => replayCanonicalDuel(replay, {
    game: unsafeFixture<ReplayDriverGamePort>(tampered, "Concrete playback Game with a deliberately corrupted attack counter."),
  }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, new RegExp(`Replay divergence at command ${attackCommand.sequence} \\(attack\\)`));
    assert.equal(Reflect.get(error, "expectedHash"), attackCommand.stateHash);
    assert.notEqual(Reflect.get(error, "observedHash"), attackCommand.stateHash);
    return true;
  });
});

test("a human attack chosen through the selection session replays after its awaited combat", async t => {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 140, laboratoryMode: true, laboratoryUseBot: false });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) {
    const start = game.startWithDecks.bind(game);
    game.startWithDecks = async options => {
      await start(options);
      game.player.controllerType = game.bot.controllerType = "human";
      game.disablePresentationDelays = true;
      game.phaseDelayMs = 0;
    };
  }
  playback.ui.showTargetSelection = () => assert.fail("Playback cannot ask for an attack target");
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
    playerDeck: Array<number>(16).fill(1), botDeck: Array<number>(16).fill(1), playerExtraDeck: [], botExtraDeck: [] });
  await live.skipToPhase("main1");
  await live.performNormalSummon(live.player, 0, "attack", false, null);
  const attacker = required(live.player.field[0]);
  await live.skipToPhase("end");
  await live.skipToPhase("end");
  assert.equal(live.turn, "player");
  await live.skipToPhase("battle");
  live.startAttackTargetSelection(attacker, []);
  const session = required(live.targetSelection);
  const requirement = required(session.requirements[0]);
  session.selections[requirement.id] = [required(requirement.candidates.find(candidate =>
    Reflect.get(candidate, "isDirectAttack") === true)).key];
  await live.finishTargetSelection();
  assert.ok(live.bot.lp < 8000, "the combat resolved before the selection settled");
  assert.equal(live.combatResolutionDepth, 0);

  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "selection-attack" }))));
  assert.equal(replay.decisions.filter(decision => decision.kind === "attack").length, 0,
    "the attack command carries the target; no separate decision is recorded");
  assert.ok(replay.commands.some(command => command.type === "attack"));
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game with identical presentation and controller configuration.") });
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
  assert.equal(playback.bot.lp, live.bot.lp);
});

test("a monster effect activated from the human Graveyard modal records its command and replays", async t => {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 143, laboratoryMode: true, laboratoryUseBot: false });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) {
    const start = game.startWithDecks.bind(game);
    game.startWithDecks = async options => {
      await start(options);
      game.player.controllerType = game.bot.controllerType = "human";
      game.disablePresentationDelays = true;
      game.phaseDelayMs = 0;
      game.player.deck.push(...game.player.hand.splice(0));
      // Void Tenebris Horn revives itself while 2 "Void Hollow" are in the Graveyard.
      for (const id of [204, 204, 211]) {
        const card = required(game.player.deck.find(entry => entry.id === id));
        game.player.deck.splice(game.player.deck.indexOf(card), 1);
        game.player.graveyard.push(card);
      }
    };
  }
  playback.ui.renderGraveyardModal = () => assert.fail("Playback cannot open the Graveyard modal");
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
    playerDeck: [204, 204, 211, ...Array<number>(17).fill(1)], botDeck: Array<number>(20).fill(1),
    playerExtraDeck: [], botExtraDeck: [] });
  await live.skipToPhase("main1");
  const horn = required(live.player.graveyard.find(card => card.id === 211));
  const modal: { options?: Parameters<typeof live.ui.renderGraveyardModal>[1] } = {};
  live.ui.renderGraveyardModal = (_cards, options) => { modal.options = options; };
  const activation: { pending?: Promise<unknown> } = {};
  const activate = live.tryActivateMonsterEffect.bind(live);
  live.tryActivateMonsterEffect = (...args) => {
    const result = activate(...args);
    activation.pending = result;
    return result;
  };
  live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback cannot ask for a position");
  live.openGraveyardModal(live.player);
  const select = required(required(modal.options).onSelect);
  select(horn, live.player.graveyard.indexOf(horn),
    unsafeFixture<HTMLElement>({}, "The Graveyard activation handler reads only the card."),
    unsafeFixture<MouseEvent>({}, "The Graveyard activation handler reads only the card."));
  await completeTestSelections(live, required(activation.pending));
  assert.ok(live.player.field.includes(horn), "the Graveyard effect revived the card");

  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "graveyard-modal" }))));
  const command = required(replay.commands.find(entry => entry.type === "activate_effect"));
  assert.equal(command.payload.sourceZone, "graveyard");
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game with identical presentation and controller configuration.") });
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
  assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
});

test("a duel won in the Damage Step records its final state after the attack command settles", async t => {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 142, laboratoryMode: true, laboratoryUseBot: false });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) {
    const start = game.startWithDecks.bind(game);
    game.startWithDecks = async options => {
      await start(options);
      game.player.controllerType = game.bot.controllerType = "human";
      game.disablePresentationDelays = true;
      game.phaseDelayMs = 0;
      game.bot.lp = 100;
    };
  }
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
    playerDeck: Array<number>(16).fill(1), botDeck: Array<number>(16).fill(1), playerExtraDeck: [], botExtraDeck: [] });
  await live.skipToPhase("main1");
  await live.performNormalSummon(live.player, 0, "attack", false, null);
  const attacker = required(live.player.field[0]);
  await live.skipToPhase("end");
  await live.skipToPhase("end");
  await live.skipToPhase("battle");
  let finalizedDuringCombat = false;
  const finalize = live.finalizeReplay.bind(live);
  live.finalizeReplay = result => {
    finalizedDuringCombat = live.combatResolutionDepth > 0;
    return finalize(result);
  };
  live.startAttackTargetSelection(attacker, []);
  const session = required(live.targetSelection);
  const requirement = required(session.requirements[0]);
  session.selections[requirement.id] = [required(requirement.candidates.find(candidate =>
    Reflect.get(candidate, "isDirectAttack") === true)).key];
  await live.finishTargetSelection();
  assert.equal(live.winner, "player");
  assert.equal(finalizedDuringCombat, true, "the win finalized the recording inside the attack");

  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.exportReplay({ download: false }))));
  const lastCommand = required(replay.commands.at(-1));
  assert.equal(lastCommand.type, "attack");
  assert.equal(replay.result?.finalStateHash, lastCommand.stateHash);
  assert.deepEqual(replay.result?.finalState, createCanonicalStateSnapshot(live));
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game with identical presentation and controller configuration.") });
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
  assert.equal(playback.bot.lp, live.bot.lp);
});

test("a normal duel's automatic opening turn is replayed before the first command", async t => {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 141, laboratoryMode: true, laboratoryUseBot: false });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) {
    game.player.controllerType = game.bot.controllerType = "human";
    game.disablePresentationDelays = true;
    game.phaseDelayMs = 0;
  }
  // Not initializeOnly and not startAtDrawPhase: the duel starts its opening turn by itself.
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, startingPlayer: "player",
    announceStartingPlayer: false, playerDeck: Array<number>(16).fill(1), botDeck: Array<number>(16).fill(1),
    playerExtraDeck: [], botExtraDeck: [] });
  assert.equal(live.turnCounter, 1);
  assert.notEqual(live.phase, "draw", "the opening turn advanced without any command");
  await live.skipToPhase("end");

  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "opening-turn" }))));
  assert.equal(replay.setup.openingTurnStarted, true);
  assert.ok(replay.commands.length > 0);
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game with identical presentation and controller configuration.") });
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
  assert.equal(playback.turnCounter, live.turnCounter);
});
