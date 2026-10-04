import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, completeTestSelections, type RuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
type Scenario = "first-link" | "second-link" | "second-link-decline";
const majesticEffect = "majestic_silver_dragon_position_switch";
const leviathanEffect = "magmatic_obsidian_leviathan_facedown_lock";
const sanctuaryEffect = "dragon_spirit_sanctuary_effect_targeted";

function installSetup(game: RuntimeGame, seat: Seat, scenario: Scenario) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = scenario === "first-link" ? (seat === "player" ? "bot" : "player") : seat;
    game.turnCounter = 4; game.phase = "main1"; game.disablePresentationDelays = true;
    game.player.controllerType = game.bot.controllerType = "human";
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const take = (player: typeof owner, id: number) => {
      const zone = player.deck.some(card => card.id === id) ? player.deck : player.extraDeck;
      const card = required(zone.find(card => card.id === id));
      zone.splice(zone.indexOf(card), 1); card.isFacedown = false; card.position = "attack";
      return card;
    };
    placeFieldCards(owner.field, take(owner, 257));
    placeFieldCards(opponent.field, take(opponent, 257), take(opponent, 27));
    for (const player of [owner, opponent]) {
      const trap = take(player, 268); trap.isFacedown = true; trap.setTurn = trap.turnSetOn = 1;
      placeFieldCards(player.spellTrap, trap);
    }
    opponent.hand.push(take(opponent, 4));
  };
}

for (const seat of ["player", "bot"] as const) for (const scenario of ["first-link", "second-link", "second-link-decline"] as const) {
  test(`targeted response uses the declared ${scenario} target (${seat}), with canonical replay`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true,
      randomSeed: 3033, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
      replayMode: "playback", chainResponseTimeoutMs: 0 });
    t.after(() => { game.dispose(); playback.dispose(); });
    installSetup(game, seat, scenario); installSetup(playback, seat, scenario);
    const deck = [257, 268, 4, 3, 3, 1, 1, 4, 3, 3];
    await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
      startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck,
      playerExtraDeck: [27], botExtraDeck: [27] });
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const dragon = required(owner.field[0]), otherDragon = required(opponent.field[0]);
    const trap = required(owner.spellTrap[0]), otherTrap = required(opponent.spellTrap[0]);
    const effect = required(dragon.effects.find(effect => effect.id === majesticEffect));
    const initialKey = game.getOncePerTurnLockKey(dragon, effect);
    const initialIdentity = { instance: dragon.instanceId, duel: game.ensureDuelCardId(dragon), version: dragon.locationVersion };
    const activationIds: string[] = [], sourceUsage: { status: string; key: string | null }[] = [];
    let returnedWhileReserved = 0, choseLeviathan = false, offeredSanctuary = 0, choseSanctuary = false;
    let rejectedOldTargetAfterThirdLink = false;
    game.on("effect_usage", event => {
      if (event.sourceInstanceId === dragon.instanceId && event.effectId === majesticEffect)
        sourceUsage.push({ status: event.status, key: event.turnKey });
    });
    game.on("effect_activated", event => {
      activationIds.push(event.effectId || "");
      if (event.sourceCard === trap && scenario === "second-link") {
        const last = required(game.chainSystem.getLastChainLink());
        assert.equal(last.chainLevel, 3);
        assert.deepEqual(last.declaredTargets, [], "Sanctuary references an event card without targeting it");
        const candidates = game.chainSystem.getActivatableCardsInChain(opponent, required(game.chainSystem.chainWindowContext));
        rejectedOldTargetAfterThirdLink = !candidates.some(candidate => candidate.card === otherTrap);
      }
    });
    game.on("after_summon", event => {
      if (event.card !== dragon || scenario !== "second-link") return;
      const reservation = game.getEffectUsageState().reservations.find(entry => entry.effectId === majesticEffect);
      assert.equal(reservation?.status, "reserved"); assert.equal(reservation?.turnKey, initialKey);
      assert.equal(game.checkEffectUsage({ card: dragon, player: owner, effect }).ok, true);
      returnedWhileReserved++;
    });
    game.ui.showConfirmPrompt = async () => true;
    game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
    game.ui.showChainResponseModal = async candidates => {
      const leviathan = candidates.find(candidate => candidate.card?.id === 27);
      if (scenario !== "first-link" && !choseLeviathan && leviathan) { choseLeviathan = true; return leviathan; }
      const sanctuary = candidates.find(candidate => candidate.card === trap);
      if (sanctuary) {
        offeredSanctuary++;
        if (scenario !== "second-link-decline") { choseSanctuary = true; return sanctuary; }
      }
      return null;
    };
    game.chainSystem.botChooseChainResponse = async () => null;
    const source = scenario === "first-link" ? otherDragon : dragon;
    const controller = scenario === "first-link" ? opponent : owner;
    const target = scenario === "first-link" ? dragon : otherDragon;
    const action = game.tryActivateMonsterEffect(source, { majestic_position_target: [target] }, "field", controller, { effectId: majesticEffect });
    await completeTestSelections(game, action); await action;
    assert.equal(offeredSanctuary, 1, "Sanctuary must be offered for the current Dragon target");
    assert.equal(choseLeviathan, scenario !== "first-link");
    assert.equal(choseSanctuary, scenario !== "second-link-decline");
    assert.equal(dragon.instanceId, initialIdentity.instance); assert.equal(game.ensureDuelCardId(dragon), initialIdentity.duel);
    assert.equal(dragon.locationVersion, initialIdentity.version + (choseSanctuary ? 2 : 0));
    assert.equal(dragon.isFacedown, !choseSanctuary);
    assert.equal(owner.graveyard.includes(trap), choseSanctuary);
    assert.ok(opponent.spellTrap.includes(otherTrap)); assert.equal(otherTrap.isFacedown, true);
    assert.equal(game.effectUsageReservations.size, 0); assert.equal(game.targetSelection, null);
    if (scenario !== "first-link") assert.ok(opponent.graveyard.some(card => card.id === 4), "real discard is paid");
    if (scenario === "second-link") {
      assert.equal(returnedWhileReserved, 1); assert.equal(rejectedOldTargetAfterThirdLink, true);
      assert.deepEqual(activationIds, [majesticEffect, leviathanEffect, sanctuaryEffect]);
      assert.deepEqual(sourceUsage, [{ status: "reserved", key: initialKey }, { status: "consumed", key: initialKey }]);
      assert.equal(game.canUseOncePerTurn(dragon, owner, effect, { lockKey: initialKey }).ok, false);
      assert.equal(game.checkEffectUsage({ card: dragon, player: owner, effect }).ok, true);
      const retry = game.tryActivateMonsterEffect(dragon, { majestic_position_target: [otherDragon] }, "field", owner, { effectId: majesticEffect });
      await completeTestSelections(game, retry); assert.equal((await retry).success, true);
      assert.equal(game.checkEffectUsage({ card: dragon, player: owner, effect }).ok, false);
    }
    playback.ui.showConfirmPrompt = async () => assert.fail("playback must not ask consent");
    playback.ui.showChainResponseModal = async () => assert.fail("playback must not ask responses");
    playback.ui.showTargetSelection = () => assert.fail("playback must not ask targets");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("playback must not ask position");
    playback.autoSelector.select = () => assert.fail("playback must not rerun AI");
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({ reason: "targeted-response-context" }))));
    assert.equal(replay.engineVersion, "engine-rules-v18");
    assert.equal(replay.schemaVersion, 2);
    assert.equal(replay.cardDatabaseSignature, "c30857b8");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete Game with identical deterministic setup provides canonical playback.") });
    assert.equal(result.ok, true); assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(game));
  });
}
