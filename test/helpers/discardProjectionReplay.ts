import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CanonicalReplay, ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "./fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./game.js";

export type DiscardScenario = "redirect-empty" | "redirect-existing" | "facedown" | "fill-last-slot" | "pass-response";
export interface DiscardReplayPayload {
  seat: "player" | "bot";
  controller: "human" | "ai";
  scenario: DiscardScenario;
  replay: CanonicalReplay;
  snapshot: ReturnType<typeof createCanonicalStateSnapshot>;
  random: ReturnType<RuntimeGame["getRandomState"]>;
}

export const discardReplayDeck = [110, 101, 101, 101, 105, 105, 105, 273, 18, 1, 1, 1, 9, 3, 3, 3];

export function installDiscardScenario(
  game: RuntimeGame,
  seat: DiscardReplayPayload["seat"],
  controller: DiscardReplayPayload["controller"],
  scenario: DiscardScenario,
) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const player of [game.player, game.bot]) {
      player.deck.push(...player.hand.splice(0));
      player.controllerType = "human";
    }
    const owner = game[seat], opponent = seat === "player" ? game.bot : game.player;
    owner.controllerType = controller;
    const take = (id: number, player = owner) => {
      const card = required(player.deck.find(candidate => candidate.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    owner.hand.push(take(110));
    if (scenario === "fill-last-slot" || scenario === "pass-response") {
      owner.hand.push(take(105), take(105), take(105));
      owner.graveyard.push(take(101), take(101));
      placeFieldCards(owner.field, take(1), take(1), take(1), take(9));
      const haunted = take(18);
      haunted.isFacedown = true; haunted.setTurn = haunted.turnSetOn = 1;
      placeFieldCards(owner.spellTrap, haunted);
      for (const card of [...owner.field, ...owner.spellTrap]) game.effectEngine.assignFieldPresenceId(card);
    } else {
      owner.hand.push(take(101), take(101));
      if (scenario === "redirect-existing") owner.graveyard.push(take(101));
      const galaxy = take(273, opponent);
      galaxy.isFacedown = scenario === "facedown";
      placeFieldCards(opponent.field, galaxy);
    }
  };
}

/** Child-process entry: playback must not reuse live objects, UI, or AI decisions. */
export async function replayDiscardScenarioFromStdin() {
  const payload: DiscardReplayPayload = JSON.parse(readFileSync(0, "utf8"));
  const replay = validateCanonicalReplay(payload.replay);
  const game = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
    laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  installDiscardScenario(game, payload.seat, payload.controller, payload.scenario);
  game.ui.showChainResponseModal = async () => assert.fail("playback cannot ask for a response");
  game.ui.showConfirmPrompt = async () => assert.fail("playback cannot ask for confirmation");
  game.ui.showTriggerOrderModal = async () => assert.fail("playback cannot ask for trigger order");
  game.ui.showTargetSelection = () => assert.fail("playback cannot ask for targets");
  game.ui.showSpecialSummonPositionModal = () => assert.fail("playback cannot ask for position");
  game.autoSelector.select = () => assert.fail("playback cannot rerun AI");
  setLocale("pt-br");
  try {
    const result = await replayCanonicalDuel(replay, {
      game: unsafeFixture<ReplayDriverGamePort>(game, "Concrete Game with the same deterministic initial position in a fresh process."),
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(game.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(game), payload.snapshot);
    assert.deepEqual(game.getRandomState(), payload.random);
  } finally {
    game.dispose();
  }
}
