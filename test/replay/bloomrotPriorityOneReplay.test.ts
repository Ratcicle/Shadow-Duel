import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "search" | "recover" | "destroy" | "heal1" | "heal2" | "heal3";
const modeFor = (scenario: Scenario) => scenario === "search" ? "search_level_4_monster"
  : scenario === "recover" ? "recover_graveyard_card" : scenario.startsWith("heal") ? `remove_${scenario.slice(-1)}` : null;
function install(game: RuntimeGame, seat: "player" | "bot", controller: "human" | "ai", scenario: Scenario) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = controller;
    for (const owner of [game.player, game.bot]) { owner.deck.push(...owner.hand.splice(0)); }
    const owner = game[seat], enemy = game[seat === "player" ? "bot" : "player"];
    const take = (player: typeof owner, id: number) => {
      const zone = player.deck.some(entry => entry.id === id) ? player.deck : player.extraDeck;
      const card = required(zone.find(entry => entry.id === id));
      zone.splice(zone.indexOf(card), 1); card.isFacedown = false; card.position = "attack";
      return card;
    };
    if (scenario === "search" || scenario === "recover") placeFieldCards(owner.spellTrap, take(owner, 412));
    else placeFieldCards(owner.field, take(owner, scenario === "destroy" ? 418 : 419));
    if (scenario === "recover") owner.graveyard.push(take(owner, 402));
    const host = take(owner, 402); host.addCounter("spore", 1); placeFieldCards(owner.field, host);
    const opposing = take(enemy, 402); opposing.addCounter("spore", 1); opposing.position = "defense";
    placeFieldCards(enemy.field, opposing);
    const spell = take(enemy, 301); spell.addCounter("spore", 1); placeFieldCards(enemy.spellTrap, spell);
    game.effectEngine.updatePassiveBuffs();
  };
}

async function drive(game: RuntimeGame, action: Promise<unknown>, mode: string | null) {
  let done = false, failure: unknown;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  const pending = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      for (const requirement of session.requirements) {
        const selectedMode = mode && requirement.candidates.find(candidate => candidate.cardRef?.id === mode);
        const isCost = requirement.id.includes("cost");
        session.selections[requirement.id] = selectedMode ? [selectedMode.key]
          : requirement.candidates.slice(0, isCost ? requirement.max : requirement.min).map(candidate => candidate.key);
      }
      const resolution = game.finishTargetSelection(); pending.add(resolution);
      void resolution.then(() => pending.delete(resolution), error => { failure = error; pending.delete(resolution); });
    }
    if (done && !game.targetSelection && !pending.size) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  await completion;
  if (failure) throw failure;
  assert.ok(done && !game.targetSelection && !pending.size, "all choices must finish");
}

test("P1 requires current engine v16 and rejects v14 before playback mutates Game", async t => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v24");
  const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true });
  const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true });
  t.after(() => { live.dispose(); playback.dispose(); });
  const input = { ...live.finalizeReplay({ reason: "version-gate" }), engineVersion: "engine-rules-v14", cardDatabaseSignature: getCardDatabaseSignature() };
  const before = createCanonicalStateSnapshot(playback);
  await assert.rejects(() => replayCanonicalDuel(input, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game implements canonical replay ports.") }), /engineVersion/);
  assert.deepEqual(createCanonicalStateSnapshot(playback), before);
});

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const)
for (const scenario of ["search", "recover", "destroy", "heal1", "heal2", "heal3"] as const) {
  test(`P1 pooled costs replay (${scenario}, ${seat}, ${controller})`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: false, captureReplay: true, randomSeed: 401420, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: false, replayMode: "playback", chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    install(live, seat, controller, scenario); install(playback, seat, controller, scenario);
    live.ui.showChainResponseModal = async () => null;
    live.ui.showConfirmPrompt = async () => false;
    playback.ui.showTargetSelection = () => assert.fail("Playback must consume targets and cases");
    playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume responses");
    playback.ui.showConfirmPrompt = async () => assert.fail("Playback must consume confirmations");
    playback.autoSelector.select = () => assert.fail("Playback must consume recorded AI choices");
    const deck = [412, 402, 402, 301, ...Array<number>(16).fill(402)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [418, 419], botExtraDeck: [418, 419] });
    const owner = live[seat], network = scenario === "search" || scenario === "recover";
    const source = required(network ? owner.spellTrap[0] : owner.field[0]);
    const mode = modeFor(scenario);
    const context = mode ? { decisions: { cases: { [network ? "bloomrot_root_network_recover" : "bloomrot_queen_hollow_grove_remove_and_heal"]: mode } } } : undefined;
    if (controller === "ai" && mode) {
      const select = live.autoSelector.select.bind(live.autoSelector);
      live.autoSelector.select = (contract, selectorContext) => select(contract, { ...required(selectorContext),
        activationContext: { ...selectorContext?.activationContext, decisions: { ...selectorContext?.activationContext?.decisions,
          cases: required(context).decisions.cases } } });
    }
    const options = controller === "ai" && context ? { activationContext: context } : {};
    const payments: number[] = [];
    live.on("counter_removed", payload => { payments.push(payload.amount); });
    const paidBeforeResponses: number[] = [];
    const offerResponses = live.chainSystem.offerChainResponses.bind(live.chainSystem);
    live.chainSystem.offerChainResponses = async (...args) => {
      paidBeforeResponses.push(payments.reduce((sum, amount) => sum + amount, 0));
      return offerResponses(...args);
    };
    const action = network ? live.tryActivateSpellTrapEffect(source, null, { owner, ...options })
      : live.tryActivateMonsterEffect(source, null, "field", owner, options);
    await drive(live, action, mode);
    const count = scenario === "search" || scenario === "destroy" ? 2 : scenario === "recover" ? 3 : Number(scenario.slice(-1));
    const remaining = [live.player, live.bot].flatMap(player => [...player.field, ...player.spellTrap]).reduce((sum, card) => sum + card.getCounter("spore"), 0);
    assert.deepEqual(payments, [count], "the cost emits exactly one aggregate removal");
    assert.ok(paidBeforeResponses.length > 0 && paidBeforeResponses.every(amount => amount === count), "costs precede Chain responses");
    if (scenario !== "destroy") assert.equal(remaining, 3 - count);
    if (scenario.startsWith("heal")) assert.equal(owner.lp, 8000 + count * 500);
    if (scenario === "destroy") assert.equal(live.getOpponent(owner).field.length, 0);
    if (network) assert.ok(owner.hand.some(card => card.id === 402));
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "bloomrot-p1" }))));
    assert.equal(replay.schemaVersion, 2);
    assert.equal(replay.commands.length, 1);
    assert.throws(() => validateCanonicalReplay({ ...replay, cardDatabaseSignature: "db5833d7" }), /card database signature/);
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game implements canonical replay ports.") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
  });
}
