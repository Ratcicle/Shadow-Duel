import assert from "node:assert/strict";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { cardDatabaseByName } from "../src/data/cards.js";

function createGame(t) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.ui.showTriggerOrderModal = ({ candidates }) => candidates;
  game.ui.showConfirmPrompt = () => true;
  t.after(() => game.dispose("misty_katana_test_complete"));
  return game;
}

function createCard(data, player) {
  const card = new Card(structuredClone(data), player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

async function waitForSelection(game, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (game.targetSelection) return game.targetSelection;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected a target selection session.");
}

async function resolveFirstSelectionCandidate(game) {
  const session = await waitForSelection(game);
  const requirement = session.requirements?.[0];
  const candidate = requirement?.candidates?.[0];
  assert.ok(requirement);
  assert.ok(candidate);
  session.selections = { [requirement.id]: [candidate.key] };
  session.currentRequirement = session.requirements.length;
  await game.finishTargetSelection();
}

test("Samurai envia o Regulador do Deck e devolve o timing ao estado aberto", async (t) => {
  const game = createGame(t);
  const samurai = createCard(
    cardDatabaseByName.get("Misty Katana Ghost Samurai"),
    game.player,
  );
  const tuner = createCard(
    cardDatabaseByName.get("Tech-Zero Energy Core"),
    game.player,
  );
  game.player.hand.push(samurai);
  game.player.deck.push(tuner);

  const summonPromise = game.performNormalSummon(
    game.player,
    0,
    "attack",
    false,
  );
  await resolveFirstSelectionCandidate(game);
  const summonResult = await summonPromise;

  assert.equal(summonResult.success, true);
  assert.equal(game.player.deck.includes(tuner), false);
  assert.equal(game.player.graveyard.includes(tuner), true);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
  assert.equal(game.chainSystem.isOpenGameState(), true);
  assert.equal(game.targetSelection, null);
  assert.equal(game.chainSystem.pendingChainSelection, null);
  assert.equal(game.chainSystem.pendingTriggerSelection, null);
  assert.deepEqual(
    game.canStartAction({
      actor: game.player,
      kind: "phase_transition",
      silent: true,
    }),
    { ok: true },
  );
});

test("falha de Trigger pós-Invocação não deixa o timing em post_chain_check", async (t) => {
  const game = createGame(t);
  const monster = createCard(
    {
      id: 99010,
      name: "Timing cleanup monster",
      cardKind: "monster",
      level: 4,
      atk: 1000,
      def: 1000,
    },
    game.player,
  );
  game.player.hand.push(monster);
  game.flushPendingTriggerOccurrences = async () => ({
    ok: false,
    success: false,
    chainBuilt: true,
    reason: "forced_trigger_resolution_failure",
  });

  const result = await game.performNormalSummon(
    game.player,
    0,
    "attack",
    false,
  );

  assert.equal(result.success, true);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
  assert.equal(game.chainSystem.isOpenGameState(), true);
  assert.deepEqual(
    game.canStartAction({
      actor: game.player,
      kind: "phase_transition",
      silent: true,
    }),
    { ok: true },
  );
});
