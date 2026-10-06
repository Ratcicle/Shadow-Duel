import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "colony" | "carrioncap" | "harvest" | "fusion";

function install(game: RuntimeGame, seat: "player" | "bot", controller: "human" | "ai", scenario: Scenario) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const player of [game.player, game.bot]) {
      player.controllerType = controller;
      player.deck.push(...player.hand.splice(0));
    }
    const actor = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const take = (id: number, player = actor) => {
      const card = required(player.deck.find(entry => entry.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    const carrier = take(1, opponent); placeFieldCards(opponent.field, carrier);
    carrier.addCounter("spore", scenario === "fusion" ? 6 : scenario === "harvest" ? 8 : 1);
    if (scenario === "fusion") actor.hand.push(take(403), take(402), take(402), take(12));
    else {
      const ally = take(scenario === "carrioncap" ? 405 : 401); placeFieldCards(actor.field, ally);
      if (scenario === "colony") actor.fieldSpell = take(410);
      else if (scenario === "harvest") actor.hand.push(take(414));
    }
    game.effectEngine.updatePassiveBuffs();
  };
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const)
for (const scenario of ["colony", "carrioncap", "harvest", "fusion"] as const) {
  test(`remaining Bloomrot public-command replay ${scenario}/${seat}/${controller}, EN to PT`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 410420414, laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    install(live, seat, controller, scenario); install(playback, seat, controller, scenario);
    live.ui.showChainResponseModal = async () => null;
    live.ui.showConfirmPrompt = async () => true;
    live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
    live.ui.showTriggerOrderModal = async options => (options?.candidates ?? []).map(entry => entry.candidateId);
    for (const method of ["showTargetSelection", "showChainResponseModal", "showConfirmPrompt",
      "showSpecialSummonPositionModal", "showTriggerOrderModal"] as const) {
      playback.ui[method] = () => assert.fail(`Playback cannot invoke ${method}`);
    }
    playback.autoSelector.select = () => assert.fail("Playback cannot rerun AutoSelector");
    playback.autoSelector.orderTriggerCandidates = () => assert.fail("Playback cannot rerun trigger ordering");
    const deck = [401, 402, 402, 403, 405, 410, 414, 12, ...Array<number>(12).fill(1)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [420], botExtraDeck: [420] });
    const actor = live[seat], opponent = live[seat === "player" ? "bot" : "player"];
    const carrier = required(opponent.field[0]);
    const run = async (action: Promise<unknown>) => { await completeTestSelections(live, action); return action; };
    if (scenario === "colony") {
      const result = await run(Promise.resolve(live.activateFieldSpellEffect(required(actor.fieldSpell))));
      assert.ok(result);
      assert.deepEqual([carrier.getCounter("spore"), carrier.atk, carrier.def], [2, carrier.baseAtk - 200, carrier.baseDef - 200]);
    } else if (scenario === "carrioncap") {
      const result = await run(live.tryActivateMonsterEffect(required(actor.field[0]),
        { bloomrot_carrioncap_spore_target: [carrier] }, "field", actor));
      assert.ok(result);
      assert.deepEqual([carrier.getCounter("spore"), carrier.atk, carrier.def], [2, carrier.baseAtk - 600, carrier.baseDef - 600]);
    } else if (scenario === "harvest") {
      const source = required(actor.hand[0]);
      await run(live.tryActivateSpell(source, 0, null, { owner: actor }));
      assert.equal(carrier.getCounter("spore"), 0);
      assert.deepEqual([required(actor.field[0]).atk, required(actor.field[0]).def], [2000, 2300]);
    } else {
      await run(live.performNormalSummon(actor, actor.hand.indexOf(required(actor.hand.find(card => card.id === 403)))));
      assert.equal(actor.field.filter(card => card.isToken).length, 1);
      const polymerization = required(actor.hand.find(card => card.id === 12));
      await run(live.tryActivateSpell(polymerization, actor.hand.indexOf(polymerization), null, { owner: actor }));
      const fusion = required(actor.field.find(card => card.id === 420));
      assert.deepEqual([fusion.atk, fusion.baseAtk], [3000, 3000]);
      assert.equal(actor.field.length, 1);
      assert.equal(actor.graveyard.filter(card => card.cardKind === "monster").length, 3);
    }
    const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "bloomrot-remaining" }))));
    assert.equal(saved.schemaVersion, 2); assert.equal(saved.engineVersion, "engine-rules-v23");
    assert.equal(saved.cardDatabaseSignature, getCardDatabaseSignature());
    setLocale("pt-br");
    const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete Game implements all replay driver ports.") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, saved.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
  });
}
