import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDecisionInput } from "../../src/core/contracts/decisions.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

const tunerId = required(cardDefinition("Tech-Zero Pulse Soldier").id);

async function prepareOptionalEffect(id: 19 | 20) {
  const game = createRuntimeGame({ disableChains: true, laboratoryMode: true,
    laboratoryUseBot: false, randomSeed: 42 });
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "human";
  game.waitForBoardPresentation = async () => {};
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  const spell = new Card(cardDefinition(id), "player");
  game.player.hand.push(spell);
  const material = new Card(cardDefinition(1), "player");
  placeFieldCards(game.player.field, material);
  let target = material;
  if (id === 20) {
    await game.moveCard(material, game.player, "graveyard", {
      fromZone: "field", contextLabel: "fusion_material",
    });
  } else {
    const tuner = new Card(cardDefinition("Tech-Zero Pulse Soldier"), "player");
    placeFieldCards(game.player.field, tuner);
    const synchro = new Card(cardDefinition(31), "player");
    game.player.extraDeck.push(synchro);
    await game.performSynchroSummonFromExtraDeck(synchro, game.player, {
      materials: [tuner, material],
    });
    target = synchro;
  }
  return { game, spell, target };
}

// Both driver instances begin with the same legal material setup. All summons,
// activation, target selection, confirmations and resulting state use real code.
function installStartingMaterials(game: RuntimeGame, id: 19 | 20) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.phase = "main1";
    game.turnCounter = 2;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    const cards = [...game.player.hand, ...game.player.deck];
    game.player.hand = [required(cards.find(card => card.id === id))];
    game.player.deck = cards.filter(card => card.id !== id && card.id !== 1 && card.id !== tunerId);
    const material = required(cards.find(card => card.id === 1));
    placeFieldCards(game.player.field, material);
    if (id === 20) {
      await game.moveCard(material, game.player, "graveyard", { fromZone: "field", contextLabel: "fusion_material" });
    } else {
      placeFieldCards(game.player.field, required(cards.find(card => card.id === tunerId)));
    }
  };
}

for (const id of [19, 20] as const) {
  test(`${id} preserves the AI's optional summon policy without asking a human`, async t => {
    const { game, spell, target } = await prepareOptionalEffect(id);
    t.after(() => game.dispose());
    game.player.controllerType = "ai";
    game.ui.showConfirmPrompt = async () => { throw new Error("AI cannot request human confirmation."); };
    game.ui.showSpecialSummonPositionModal = () => { throw new Error("AI cannot request a human position."); };
    const targetRef = id === 19 ? "de_synchro_target" : "fusion_recycle_target";
    await game.tryActivateSpell(spell, 0, { [targetRef]: [target] });
    assert.equal(game.player.field.length, id === 19 ? 2 : 1);
  });

  for (const accepted of [true, false]) {
    test(`canonical driver replays ${id} ${accepted ? "accepted" : "declined"} across locales with all decisions and no live UI`, async t => {
      setLocale("en");
      t.after(() => setLocale("en"));
      const live = createRuntimeGame({ captureReplay: true, disableChains: true, randomSeed: 85,
        laboratoryMode: true, laboratoryUseBot: false });
      const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", disableChains: true,
        laboratoryMode: true, laboratoryUseBot: false });
      t.after(() => { live.dispose(); playback.dispose(); });
      installStartingMaterials(live, id);
      installStartingMaterials(playback, id);
      live.ui.showConfirmPrompt = async () => accepted;
      live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
      playback.ui.showConfirmPrompt = async () => { throw new Error("Replay cannot request a confirmation."); };
      playback.ui.showSpecialSummonPositionModal = () => { throw new Error("Replay cannot request a position."); };
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
        playerDeck: [id, 1, tunerId, ...Array<number>(10).fill(3)],
        botDeck: Array<number>(13).fill(3), playerExtraDeck: id === 19 ? [31] : [], botExtraDeck: [] });
      if (id === 19) {
        await live.performSynchroSummonFromExtraDeck(required(live.player.extraDeck[0]), live.player, {
          materials: [...live.player.field],
        });
      }
      const spell = required(live.player.hand.find(card => card.id === id));
      const activation = live.tryActivateSpell(spell, live.player.hand.indexOf(spell));
      for (let attempts = 0; attempts < 100 && !live.targetSelection; attempts++) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const session = required(live.targetSelection);
      const requirement = required(session.requirements[0]);
      session.selections[requirement.id] = [required(requirement.candidates[0]).key];
      await live.finishTargetSelection();
      await activation;
      assert.equal(live.player.field.length, accepted ? (id === 19 ? 2 : 1) : 0);
      assert.ok(live.player.field.every(card => card.position === "defense"));
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "optional-effects-test" }))));
      assert.equal(replay.commands.filter(command => command.type === "activate_card").length, 1);
      assert.equal(replay.decisions.filter(decision => decision.kind === "choice").length, id === 19 ? (accepted ? 4 : 2) : 1);
      setLocale("pt-br");
      const result = await replayCanonicalDuel(replay, {
        game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game integration uses its own card and player instances through the replay driver projection."),
      });
      assert.equal(result.ok, true);
      assert.equal(result.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    });
  }
}

for (const id of [19, 20] as const) {
  for (const accepted of [true, false]) {
    test(`${id} records the human's ${accepted ? "acceptance" : "refusal"} and consumes it without a playback prompt`, async (t) => {
      const live = await prepareOptionalEffect(id);
      const playback = await prepareOptionalEffect(id);
      t.after(() => { live.game.dispose(); playback.game.dispose(); });
      assert.equal(hashCanonicalGameState(live.game), hashCanonicalGameState(playback.game));
      const decisions: ReplayDecisionInput[] = [];
      live.game.on("decision_made", decision => { decisions.push(decision); });
      let prompts = 0;
      live.game.ui.showConfirmPrompt = async () => { prompts++; return accepted; };
      playback.game.ui.showConfirmPrompt = async () => { throw new Error("Playback must consume the recorded confirmation."); };
      playback.game.ui.showSpecialSummonPositionModal = () => { throw new Error("Playback must consume the recorded summon position."); };
      const targetRef = id === 19 ? "de_synchro_target" : "fusion_recycle_target";
      await live.game.tryActivateSpell(live.spell, 0, { [targetRef]: [live.target] });
      assert.equal(prompts, 1);
      assert.equal(live.game.player.field.length, accepted ? (id === 19 ? 2 : 1) : 0);
      if (id === 20) assert.equal(live.game.player.hand.includes(live.target), !accepted);
      assert.ok(live.game.player.field.every(card => card.position === "defense"));
      assert.equal(decisions.filter(decision => decision.kind === "choice").length, id === 19 && accepted ? 3 : 1);
      playback.game.decisionBroker.loadReplayDecisions(decisions);
      await playback.game.tryActivateSpell(playback.spell, 0, { [targetRef]: [playback.target] });
      assert.equal(playback.game.decisionBroker.replayCursor, decisions.length);
      assert.equal(hashCanonicalGameState(playback.game), hashCanonicalGameState(live.game));
    });
  }
}

for (const accepted of [true, false]) {
  test(`Void Lost Throne replays the human's second search candidate and optional summon (${accepted ? "accepted" : "declined"}) across locales`, async t => {
    setLocale("en");
    t.after(() => setLocale("en"));
    const live = createRuntimeGame({ captureReplay: true, disableChains: true, randomSeed: 86,
      laboratoryMode: true, laboratoryUseBot: false });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", disableChains: true,
      laboratoryMode: true, laboratoryUseBot: false });
    t.after(() => { live.dispose(); playback.dispose(); });
    for (const game of [live, playback]) {
      const start = game.startWithDecks.bind(game);
      game.startWithDecks = async options => {
        await start(options);
        game.phase = "main1"; game.turnCounter = 2;
        game.disablePresentationDelays = true;
        game.waitForBoardPresentation = async () => {};
        game.player.controllerType = game.bot.controllerType = "human";
        const cards = [...game.player.hand, ...game.player.deck];
        game.player.hand = [required(cards.find(card => card.id === 219))];
        game.player.deck = cards.filter(card => card.id !== 219);
      };
    }
    live.ui.showConfirmPrompt = async () => accepted;
    live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
    live.ui.getSearchModalElements = () => assert.fail("A human search uses the selection session, not the search modal");
    playback.ui.showConfirmPrompt = async () => { throw new Error("Replay cannot request a confirmation."); };
    playback.ui.showSpecialSummonPositionModal = () => { throw new Error("Replay cannot request a position."); };
    playback.ui.getSearchModalElements = () => { throw new Error("Replay cannot open the search modal."); };
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
      playerDeck: [219, 204, 211, ...Array<number>(10).fill(3)],
      botDeck: Array<number>(13).fill(3), playerExtraDeck: [], botExtraDeck: [] });
    const spell = required(live.player.hand.find(card => card.id === 219));
    const activation = live.tryActivateSpell(spell, live.player.hand.indexOf(spell));
    for (let attempts = 0; attempts < 100 && !live.targetSelection; attempts++) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    const session = required(live.targetSelection);
    const requirement = required(session.requirements[0]);
    assert.ok(requirement.candidates.length >= 2, "both Void monsters are offered");
    const second = required(requirement.candidates[1]);
    session.selections[requirement.id] = [second.key];
    await live.finishTargetSelection();
    await activation;
    const chosen = required(Reflect.get(second, "cardRef")) as Card;
    assert.equal(live.player.field.includes(chosen), accepted);
    assert.equal(live.player.hand.includes(chosen), !accepted);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "lost-throne-test" }))));
    assert.ok(replay.decisions.some(decision => decision.kind === "choice"), "the optional summon is a recorded choice");
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game integration uses its own card and player instances through the replay driver projection."),
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
  });
}
