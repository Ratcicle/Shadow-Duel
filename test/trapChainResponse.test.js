import assert from "node:assert/strict";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { cardDatabaseByName } from "../src/data/cards.js";
import { showChainResponseModal } from "../src/ui/renderer/trapModals.js";

function createCard(data, player) {
  const card = new Card(structuredClone(data), player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

function createAttackWindowGame(t, trapName) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.bot.id;
  game.phase = "battle";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";

  const trap = createCard(cardDatabaseByName.get(trapName), game.player);
  trap.isFacedown = true;
  trap.setTurn = 1;
  const attacker = createCard(
    {
      id: 99040,
      name: `${trapName} attacker`,
      cardKind: "monster",
      atk: 2000,
      def: 1000,
    },
    game.bot,
  );
  attacker.position = "attack";
  const defender = createCard(
    {
      id: 99041,
      name: `${trapName} defender`,
      cardKind: "monster",
      atk: 500,
      def: 500,
    },
    game.player,
  );
  defender.position = "attack";

  game.player.spellTrap.push(trap);
  game.bot.field.push(attacker);
  game.player.field.push(defender);
  t.after(() => game.dispose("trap_chain_response_test_complete"));

  return { game, trap, attacker, defender };
}

function installCanonicalModalSelection(game, trap) {
  let modalCalls = 0;
  game.ui.showChainResponseModal = async (
    activatable,
    context,
    chainStack,
    options,
  ) => {
    modalCalls += 1;
    if (modalCalls > 1) return null;
    const selected = activatable.find((candidate) => candidate.card === trap);
    assert.ok(selected);
    return showChainResponseModal.call(
      {
        showUnifiedTrapModal: async () => ({
          card: selected.card,
          effect: selected.effect,
          activate: true,
        }),
      },
      activatable,
      context,
      chainStack,
      options,
    );
  };
  return () => modalCalls;
}

async function openAttackWindow(game, attacker, defender) {
  return game.checkAndOfferTraps("attack_declared", {
    attacker,
    target: defender,
    defender,
    attackerOwner: game.bot,
    defenderOwner: game.player,
    targetOwner: game.player,
    battleStep: "battle",
    isOpponentAttack: true,
  });
}

test("modal de resposta devolve a mesma instância do candidato canônico", async () => {
  const card = { id: 1 };
  const effect = { id: "effect" };
  const candidate = {
    candidateKey: "1:effect:spellTrap",
    card,
    effect,
    sourceZone: "spellTrap",
  };
  const selected = await showChainResponseModal.call(
    {
      showUnifiedTrapModal: async () => ({ card, effect, activate: true }),
    },
    [candidate],
    { type: "attack_declaration" },
  );

  assert.equal(selected, candidate);
  assert.equal(selected.candidateKey, candidate.candidateKey);
});

test("Mirror Force ativada pelo modal destrói os atacantes e nega o ataque", async (t) => {
  const { game, trap, attacker, defender } = createAttackWindowGame(
    t,
    "Mirror Force",
  );
  const getModalCalls = installCanonicalModalSelection(game, trap);

  const result = await openAttackWindow(game, attacker, defender);

  assert.equal(getModalCalls(), 1);
  assert.equal(result.chainBuilt, true);
  assert.equal(result.success, true);
  assert.equal(game.player.graveyard.includes(trap), true);
  assert.equal(game.bot.field.includes(attacker), false);
  assert.equal(game.bot.graveyard.includes(attacker), true);
  assert.equal(game.lastAttackNegated, true);
  assert.equal(game.chainSystem.isOpenGameState(), true);
});

test("Power Force Field ativada pelo modal nega o ataque e encerra a Battle Phase", async (t) => {
  const { game, trap, attacker, defender } = createAttackWindowGame(
    t,
    "Power Force Field",
  );
  const getModalCalls = installCanonicalModalSelection(game, trap);

  const result = await openAttackWindow(game, attacker, defender);

  assert.equal(getModalCalls(), 1);
  assert.equal(result.chainBuilt, true);
  assert.equal(result.success, true);
  assert.equal(game.player.graveyard.includes(trap), true);
  assert.equal(game.bot.field.includes(attacker), true);
  assert.equal(game.lastAttackNegated, true);
  assert.equal(game.phase, "main2");
  assert.equal(game.chainSystem.isOpenGameState(), true);
});

test("Power Force Field entrega a Main Phase 2 ao bot somente depois da Chain", async (t) => {
  const { game, trap, attacker, defender } = createAttackWindowGame(
    t,
    "Power Force Field",
  );
  installCanonicalModalSelection(game, trap);

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => callback();
  t.after(() => {
    if (originalRequestAnimationFrame === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  game.disablePresentationDelays = false;
  game.aiActionDelayMs = 0;
  game.waitForPresentationDelay = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  game.waitForBoardPresentation = game.waitForPresentationDelay;

  const moveAttempts = [];
  game.bot.makeMove = async () => {
    moveAttempts.push({
      phase: game.phase,
      timing: game.chainSystem.getFastEffectState(),
      guard: game.canStartAction({
        actor: game.bot,
        kind: "bot_turn",
        silent: true,
      }),
    });
  };

  const result = await openAttackWindow(game, attacker, defender);
  for (let attempt = 0; attempt < 50 && moveAttempts.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  assert.equal(result.success, true);
  assert.equal(game.phase, "main2");
  assert.equal(game.chainSystem.isOpenGameState(), true);
  assert.equal(moveAttempts.length, 1);
  assert.equal(moveAttempts[0].phase, "main2");
  assert.equal(moveAttempts[0].timing.state, "open");
  assert.equal(moveAttempts[0].guard.ok, true);
});
