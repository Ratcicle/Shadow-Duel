import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type DesignId = 402 | 404 | 407 | 408 | 413;
function install(game: RuntimeGame, seat: "player" | "bot", id: DesignId, controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.turnCounter = 4; game.phase = "main1";
    game.disablePresentationDelays = true;
    game.player.controllerType = game.bot.controllerType = controller;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const take = (player: typeof owner, cardId: number) => {
      const card = required(player.deck.find(entry => entry.id === cardId));
      player.deck.splice(player.deck.indexOf(card), 1); card.isFacedown = false; card.position = "attack";
      return card;
    };
    owner.hand.push(take(owner, id));
    const enemy = take(opponent, 3); enemy.addCounter("spore", 8); placeFieldCards(opponent.field, enemy);
    const ally = take(owner, id === 413 ? 402 : 3);
    if (controller === "ai" || id === 413) ally.addCounter("spore", 2);
    placeFieldCards(owner.field, ally);
    if (id === 402) {
      await game.effectEngine.applyActions([{ type: "special_summon_token", position: "defense", token: {
        name: "Bloomrot Token", archetype: "Bloomrot", atk: 0, def: 0, level: 1,
      } }], { source: ally, player: owner, opponent }, {});
    }
    game.effectEngine.updatePassiveBuffs();
  };
}

for (const id of [402, 404, 407, 408, 413] as const) for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`Bloomrot D02/D03 ${id} canonical replay (${seat}, ${controller})`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true, randomSeed: 402414 });
    const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, replayMode: "playback" });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    install(live, seat, id, controller); install(playback, seat, id, controller);
    live.ui.showChainResponseModal = async () => null;
    live.ui.showConfirmPrompt = async () => false;
    live.ui.showSpecialSummonPositionModal = (_card, done) => done("defense");
    playback.ui.showTargetSelection = () => assert.fail("Playback must consume saved choices");
    playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume saved responses");
    playback.ui.showConfirmPrompt = async () => assert.fail("Playback must consume saved confirmations");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must consume the saved position");
    playback.autoSelector.select = () => assert.fail("Playback must consume saved AI decisions");
    const deck = [402, 404, 407, 408, 413, ...Array<number>(15).fill(3)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
    const owner = live[seat], source = required(owner.hand[0]);
    const action = id === 413 ? live.tryActivateSpell(source, 0, undefined, { owner }) : live.performHandSummonProcedure(source, owner);
    await completeTestSelections(live, action);
    assert.ok(id === 413 ? owner.spellTrap.includes(source) : owner.field.includes(source));
    if (id === 413) { const host = required(owner.field[0]); assert.equal(host.atk, 2200); assert.equal(host.def, 2100); }
    else assert.equal(source.lastSummonProcedure, required(source.handSummonProcedure).id);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "bloomrot-design" }))));
    assert.deepEqual(replay.commands.map(command => command.type), [id === 413 ? "activate_card" : "hand_summon_procedure"]);
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game supplies all canonical replay ports.") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
  });
}

for (const seat of ["player", "bot"] as const) test(`explicit opposing counter source order survives hand procedure capture (${seat})`, async t => {
  const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true, randomSeed: 404 });
  const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, replayMode: "playback" });
  t.after(() => { live.dispose(); playback.dispose(); });
  install(live, seat, 404, "ai"); install(playback, seat, 404, "ai");
  const deck = [404, ...Array<number>(19).fill(3)];
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
    playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
  const owner = live[seat], source = required(owner.hand[0]), enemy = required(live.getOpponent(owner).field[0]);
  assert.equal((await live.performHandSummonProcedure(source, owner, { counterSources: [enemy], position: "defense" })).success, true);
  const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "bloomrot-counter-source" }))));
  const command = required(saved.commands[0]); assert.equal(command.type, "hand_summon_procedure");
  if (command.type === "hand_summon_procedure") assert.deepEqual(command.payload.counterSourceIds, [enemy.duelCardId]);
  const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game with replay and hand procedure capabilities.") });
  assert.equal(result.ok, true);
  assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
  assert.throws(() => validateCanonicalReplay({ ...saved, commands: saved.commands.map(entry => ({ ...entry, payload: { ...entry.payload, counterSourceIds: [-1] } })) }), /counterSourceIds/);
});
