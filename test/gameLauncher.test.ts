import assert from "node:assert/strict";
import test from "node:test";
import Game from "../src/core/Game.js";
import type Renderer from "../src/ui/Renderer.js";
import {
  createGameLauncher,
  type LaboratoryDuelConfig,
} from "../src/ui/main/gameLauncher.js";
import { required, unsafeFixture } from "./helpers/fixtures.js";

class HeadlessRenderer {}

function createLauncher(RendererFixture = HeadlessRenderer) {
  return createGameLauncher({
    Game,
    Renderer: unsafeFixture<typeof Renderer>(
      RendererFixture,
      "Launcher tests use the real Game and its inert UI adapter; the renderer constructor deliberately supplies only observed presentation methods.",
    ),
  });
}

function scenarioConfig() {
  return {
    useBot: Boolean(false),
    botPreset: "dragon",
    revealBotHand: Boolean(true),
    laboratoryMode: "test",
    setup: {
      player: {
        lp: 6400,
        hand: [{ id: 104 }],
        field: [{ id: 1, position: "defense", facedown: true }],
        deck: [{ id: 3 }, { id: 4 }],
      },
      bot: { lp: 7200, hand: [{ id: 9 }], field: [{ id: 1 }] },
    },
    duelDecks: {},
  } satisfies LaboratoryDuelConfig;
}

function duelConfig() {
  return {
    ...scenarioConfig(),
    laboratoryMode: "duel",
    duelDecks: {
      playerDeck: [1, 3, 4, 9, 1, 3, 4, 9],
      playerExtraDeck: [31],
      botDeck: [1, 3, 4, 9, 1, 3, 4, 9],
      botExtraDeck: [31],
      firstTurnPlayer: "player",
      preserveDeckOrder: true,
      announceStartingPlayer: Boolean(false),
    },
  } satisfies LaboratoryDuelConfig;
}

test("Laboratory restart restores an isolated starting scenario and options repeatedly", async (t) => {
  const launcher = createLauncher();
  t.after(() => launcher.disposeActiveGame("test_complete"));
  const config = scenarioConfig();
  const first = await launcher.startLaboratoryDuel(config);
  const initialCard = required(first.player.field[0]);

  config.setup.player.lp = 1;
  required(config.setup.player.field[0]).id = 104;
  config.setup.player.hand.length = 0;
  config.useBot = true;
  config.revealBotHand = false;
  config.botPreset = "void";
  config.laboratoryMode = "duel";
  first.player.lp = 50;
  first.player.field.length = 0;
  first.player.hand.length = 0;
  first.turnCounter = 7;
  first.phase = "end";

  const restarted = required(await launcher.restartLaboratoryDuel());
  assert.equal(first.isDisposed(), true);
  assert.equal(launcher.getActiveGame(), restarted);
  assert.notEqual(restarted, first);
  assert.notEqual(restarted.player.field[0], initialCard);
  assert.equal(restarted.player.lp, 6400);
  assert.equal(restarted.bot.lp, 7200);
  assert.equal(restarted.bot.controllerType, "human");
  assert.equal(restarted.botPreset, "dragon");
  assert.equal(restarted.laboratoryRevealBotHand, true);
  assert.equal(restarted.turnCounter, 1);
  assert.equal(restarted.phase, "main1");
  assert.deepEqual(restarted.player.hand.map((card) => card.id), [104]);
  assert.deepEqual(restarted.player.deck.map((card) => card.id), [3, 4]);
  assert.equal(required(restarted.player.field[0]).id, 1);
  assert.equal(required(restarted.player.field[0]).position, "defense");
  assert.equal(required(restarted.player.field[0]).isFacedown, true);

  restarted.player.lp = 0;
  restarted.player.hand.length = 0;
  const secondRestart = required(await launcher.restartLaboratoryDuel());
  assert.equal(restarted.isDisposed(), true);
  assert.equal(secondRestart.player.lp, 6400);
  assert.deepEqual(secondRestart.player.hand.map((card) => card.id), [104]);
});

test("Laboratory duel restart preserves deck lists and initial duel options", async (t) => {
  const launcher = createLauncher();
  t.after(() => launcher.disposeActiveGame("test_complete"));
  const config = duelConfig();
  const first = await launcher.startLaboratoryDuel(config);
  const initialHand = first.player.hand.map((card) => card.id);
  const initialDeck = first.player.deck.map((card) => card.id);
  const initialBotHand = first.bot.hand.map((card) => card.id);
  config.duelDecks.playerDeck.fill(104);
  config.duelDecks.botDeck.length = 0;
  config.duelDecks.playerExtraDeck.length = 0;
  config.duelDecks.botExtraDeck.length = 0;
  first.player.deck.length = 0;
  first.player.extraDeck.length = 0;
  first.bot.hand.length = 0;
  first.player.lp = 1500;

  const restarted = required(await launcher.restartLaboratoryDuel());
  assert.equal(first.isDisposed(), true);
  assert.equal(restarted.phase, "draw");
  assert.equal(restarted.turn, "player");
  assert.equal(restarted.player.lp, 8000);
  assert.deepEqual(restarted.player.hand.map((card) => card.id), initialHand);
  assert.deepEqual(restarted.player.deck.map((card) => card.id), initialDeck);
  assert.deepEqual(restarted.bot.hand.map((card) => card.id), initialBotHand);
  assert.deepEqual(restarted.player.extraDeck.map((card) => card.id), [31]);
  assert.deepEqual(restarted.bot.extraDeck.map((card) => card.id), [31]);
});

test("leaving the Laboratory or starting a normal duel discards its restart configuration", async (t) => {
  const launcher = createLauncher();
  t.after(() => launcher.disposeActiveGame("test_complete"));
  assert.equal(await launcher.restartLaboratoryDuel(), null);
  await launcher.startLaboratoryDuel(scenarioConfig());
  launcher.disposeActiveGame("return_to_laboratory");
  assert.equal(launcher.getActiveGame(), null);
  assert.equal(await launcher.restartLaboratoryDuel(), null);

  await launcher.startLaboratoryDuel(scenarioConfig());
  const normal = launcher.startNormalDuel({
    botPreset: "dragon",
    deck: [1, 3, 4, 9, 1, 3, 4, 9],
    extraDeck: [31],
    playerArchetype: "dragon",
  });
  assert.equal(await launcher.restartLaboratoryDuel(), null);
  assert.equal(launcher.getActiveGame(), normal);
});

test("disposing a Laboratory duel closes target selection and persistent zone modals", async () => {
  const calls: string[] = [];
  class ObservedRenderer {
    showTargetSelection() {
      return { close: () => calls.push("target_closed") };
    }
    hideFieldTargetingControls() { calls.push("controls_hidden"); }
    clearTargetHighlights() { calls.push("highlights_cleared"); }
    setSelectionDimming(active: boolean) { calls.push(`dimming_${active}`); }
    toggleModal(show: boolean) { calls.push(`graveyard_${show}`); }
    toggleExtraDeckModal(show: boolean) { calls.push(`extra_${show}`); }
    destroy() { calls.push("destroyed"); }
  }
  const launcher = createLauncher(ObservedRenderer);
  const game = await launcher.startLaboratoryDuel(scenarioConfig());
  Reflect.apply(game.startTargetSelectionSession, game, [{
    kind: "choice",
    selectionContract: {
      kind: "choice",
      requirements: [{
        id: "choice", min: 1, max: 1, zones: ["choice"],
        candidates: [{ key: "yes", name: "Yes", controller: "player", zone: "choice" }],
      }],
      ui: { useFieldTargeting: false, allowCancel: true },
    },
    execute() { return { success: true, needsSelection: false }; },
  }]);
  assert.ok(game.targetSelection);
  calls.length = 0;

  launcher.disposeActiveGame("return_to_laboratory");

  assert.equal(game.isDisposed(), true);
  assert.equal(game.targetSelection, null);
  assert.deepEqual(calls, [
    "highlights_cleared", "dimming_false", "controls_hidden", "target_closed",
    "graveyard_false", "extra_false", "destroyed",
  ]);
});

test("a pending Laboratory launch returns its own game when a later launch supersedes it", async (t) => {
  const announcement: { release: ((shown: boolean) => void) | null } = { release: null };
  class DelayedRenderer {
    showDuelStartAnnouncement() {
      return new Promise<boolean>((resolve) => { announcement.release = resolve; });
    }
  }
  const launcher = createLauncher(DelayedRenderer);
  t.after(() => launcher.disposeActiveGame("test_complete"));
  const config = duelConfig();
  config.duelDecks.announceStartingPlayer = true;
  const pendingFirst = launcher.startLaboratoryDuel(config);
  const first = required(launcher.getActiveGame());
  const later = await launcher.startLaboratoryDuel(scenarioConfig());
  required(announcement.release)(true);
  assert.equal(await pendingFirst, first);
  assert.equal(first.isDisposed(), true);
  assert.equal(launcher.getActiveGame(), later);
});
