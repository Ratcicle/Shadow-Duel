import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import test from "node:test";
import type {
  CardConstructorData,
  GameCard,
} from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { record, required, unsafeFixture } from "./helpers/fixtures.js";
import type { RuntimeGame } from "./helpers/game.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import type Renderer from "../src/ui/Renderer.js";
import { showChainResponseModal } from "../src/ui/renderer/trapModals.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

function createCard(data: CardConstructorData | undefined, player: GamePlayer) {
  assert.ok(data, "Card fixture must exist.");
  const card = new Card(structuredClone(data), player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

function createAttackWindowGame(t: TestContext, trapName: string) {
  const game = createRuntimeGame({
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

function installCanonicalModalSelection(game: RuntimeGame, trap: GameCard) {
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
    const result = await showChainResponseModal.call(
      unsafeFixture<Renderer>(
        {
          showUnifiedTrapModal: async () => ({
            card: required(selected.card),
            effect: selected.effect ?? null,
            activate: true,
          }),
        },
        "Isolated modal adapter test supplies only the delegated modal; it does not construct a DOM renderer.",
      ),
      activatable,
      context,
      chainStack,
      options,
    );
    return result == null
      ? null
      : required(activatable.find((candidate) => candidate === result));
  };
  return () => modalCalls;
}

async function openAttackWindow(
  game: RuntimeGame,
  attacker: GameCard,
  defender: GameCard,
) {
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
  const card = { id: 1, name: "Canonical modal candidate" };
  const effect = { id: "effect", activationLabel: "Canonical modal effect" };
  const candidate = {
    candidateKey: "1:effect:spellTrap",
    card,
    effect,
    sourceZone: "spellTrap",
  };
  const selected = await showChainResponseModal.call(
    unsafeFixture<Renderer>(
      {
        showUnifiedTrapModal: async () => ({ card, effect, activate: true }),
      },
      "Isolated identity test supplies only the delegated modal; it does not construct a DOM renderer.",
    ),
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

  const result = required(await openAttackWindow(game, attacker, defender));

  assert.equal(getModalCalls(), 1);
  assert.equal(record(result).chainBuilt, true);
  assert.ok(result.success === true);
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

  const result = required(await openAttackWindow(game, attacker, defender));

  assert.equal(getModalCalls(), 1);
  assert.equal(record(result).chainBuilt, true);
  assert.ok(result.success === true);
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
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  t.after(() => {
    if (originalRequestAnimationFrame === undefined) {
      Reflect.deleteProperty(globalThis, "requestAnimationFrame");
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

  const moveAttempts: Array<{
    phase: RuntimeGame["phase"];
    timing: ReturnType<RuntimeGame["chainSystem"]["getFastEffectState"]>;
    guard: ReturnType<RuntimeGame["canStartAction"]>;
  }> = [];
  Object.assign(game.bot, {
    makeMove: async () => {
      moveAttempts.push({
        phase: game.phase,
        timing: game.chainSystem.getFastEffectState(),
        guard: game.canStartAction({
          actor: game.bot,
          kind: "bot_turn",
          silent: true,
        }),
      });
    },
  });

  const result = required(await openAttackWindow(game, attacker, defender));
  for (
    let attempt = 0;
    attempt < 50 && moveAttempts.length === 0;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  assert.ok(result.success === true);
  assert.equal(game.phase, "main2");
  assert.equal(game.chainSystem.isOpenGameState(), true);
  assert.equal(moveAttempts.length, 1);
  assert.equal(moveAttempts[0].phase, "main2");
  assert.equal(moveAttempts[0].timing.state, "open");
  assert.ok(moveAttempts[0].guard.ok === true);
});
