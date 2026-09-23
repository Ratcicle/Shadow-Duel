import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { TestContext } from "node:test";
import test from "node:test";
import ChainSystem from "../src/core/ChainSystem.js";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { required, selectedCards } from "./helpers/fixtures.js";
import type { RuntimeGame } from "./helpers/game.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const EXPECTED_EN =
  'If this card is Normal Summoned: You can send 1 Tuner monster from your Deck to the Graveyard.\n\nYou can banish this card from your Graveyard, then target 1 Level 4 or lower Tuner monster in your Graveyard; Special Summon it.\n\nYou can only use each effect of "Misty Katana Ghost Samurai" once per turn.';
const EXPECTED_PT_BR =
  "Se este card for Invocado por Invocação-Normal: você pode enviar 1 monstro Regulador do seu Deck para o Cemitério.\n\nVocê pode banir este card do seu Cemitério e, depois, escolher 1 monstro Regulador de Nível 4 ou menor no seu Cemitério; Invoque-o por Invocação-Especial.\n\nVocê só pode usar cada efeito de “Samurai Fantasma da Katana Nebulosa” uma vez por turno.";

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.ui.showTriggerOrderModal = async (options) =>
    required(required(options).candidates).map(
      (candidate) => candidate.candidateId,
    );
  game.ui.showConfirmPrompt = () => true;
  t.after(() => game.dispose("misty_katana_test_complete"));
  return game;
}

function createCard(data: CardConstructorData | undefined, player: GamePlayer) {
  assert.ok(data, "Card fixture must exist.");
  const card = new Card(structuredClone(data), player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

async function waitForSelection(game: RuntimeGame, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (game.targetSelection) return game.targetSelection;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected a target selection session.");
}

async function resolveFirstSelectionCandidate(game: RuntimeGame) {
  const session = await waitForSelection(game);
  const requirement = session.requirements?.[0];
  const candidate = requirement?.candidates?.[0];
  assert.ok(requirement);
  assert.ok(candidate);
  session.selections = { [requirement.id]: [candidate.key] };
  session.currentRequirement = session.requirements.length;
  await game.finishTargetSelection();
}

test("Samurai declara três blocos compactos e limites independentes", async () => {
  const card = cardDatabaseByName.get("Misty Katana Ghost Samurai");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(locale.cards["26"].description, EXPECTED_PT_BR);

  const sendEffect = required(
    required(card.effects).find(
      ({ id }) => id === "misty_katana_ghost_samurai_send_tuner",
    ),
  );
  const reviveEffect = required(
    required(card.effects).find(
      ({ id }) => id === "misty_katana_ghost_samurai_revive_tuner",
    ),
  );
  assert.equal(required(sendEffect.summonMethods)[0], "normal");
  assert.equal(sendEffect.usagePolicy, "use");
  assert.equal(reviveEffect.usagePolicy, "use");
  assert.notEqual(sendEffect.oncePerTurnName, reviveEffect.oncePerTurnName);
  assert.deepEqual(reviveEffect.activationZones, ["graveyard"]);
  assert.deepEqual(reviveEffect.activationCosts, [{
    type: "move",
    targetRef: "self",
    player: "self",
    fromZone: "graveyard",
    to: "banished",
    contextLabel: "misty_katana_ghost_samurai_revive_cost",
  }]);
  const reviveTarget = required(required(reviveEffect.targets)[0]);
  assert.equal(reviveTarget.owner, "self");
  assert.equal(reviveTarget.zone, "graveyard");
  assert.equal(reviveTarget.cardKind, "monster");
  assert.equal(reviveTarget.isTuner, true);
  assert.equal(reviveTarget.maxLevel, 4);
  assert.deepEqual(reviveTarget.count, { min: 1, max: 1 });
  assert.equal(required(required(reviveEffect.actions)[0]).targetRef, reviveTarget.id);
  assert.equal("banishCost" in required(required(reviveEffect.actions)[0]), false);
});

test("Samurai paga o banimento e fixa o Regulador antes da janela de respostas", async (t) => {
  const game = createGame(t);
  game.player.controllerType = "ai";
  const samurai = createCard(cardDatabaseByName.get("Misty Katana Ghost Samurai"), game.player);
  const tuner = createCard(cardDatabaseByName.get("Tech-Zero Energy Core"), game.player);
  game.player.graveyard.push(samurai, tuner);
  assert.ok(game.chainSystem instanceof ChainSystem);
  let observed = false;
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.getLastChainLink();
    if (link?.effectId === "misty_katana_ghost_samurai_revive_tuner") {
      observed = game.player.banished.includes(samurai)
        && link.costsPaid === true
        && selectedCards(link.targetSelections, "misty_katana_ghost_samurai_revive_target")?.[0] === tuner;
    }
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  const result = await game.tryActivateMonsterEffect(
    samurai,
    { misty_katana_ghost_samurai_revive_target: [tuner] },
    "graveyard",
    game.player,
    { effectId: "misty_katana_ghost_samurai_revive_tuner" },
  );
  assert.ok(result.success === true);
  assert.equal(observed, true);
  assert.equal(game.player.field.includes(tuner), true);
});

for (const negation of ["activation", "effect"] as const) {
  test(`Samurai mantém o custo pago quando a ${negation} é negada`, async (t) => {
    const game = createGame(t);
    game.player.controllerType = "ai";
    const samurai = createCard(cardDatabaseByName.get("Misty Katana Ghost Samurai"), game.player);
    const tuner = createCard(cardDatabaseByName.get("Tech-Zero Energy Core"), game.player);
    game.player.graveyard.push(samurai, tuner);
    assert.ok(game.chainSystem instanceof ChainSystem);
    game.chainSystem.offerChainResponses = async () => {
      const link = required(game.chainSystem.getLastChainLink());
      assert.equal(game.player.banished.includes(samurai), true);
      if (negation === "activation") {
        game.chainSystem.markChainLinkActivationNegated(link.linkId, { negatedBy: tuner });
      } else {
        game.chainSystem.markChainLinkEffectNegated(link.linkId, { negatedBy: tuner });
      }
      return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
    };
    await game.tryActivateMonsterEffect(
      samurai,
      { misty_katana_ghost_samurai_revive_target: [tuner] },
      "graveyard",
      game.player,
      { effectId: "misty_katana_ghost_samurai_revive_tuner" },
    );
    assert.equal(game.player.banished.includes(samurai), true);
    assert.equal(game.player.graveyard.includes(tuner), true);
    assert.equal(game.player.field.includes(tuner), false);
  });
}

test("Samurai não redireciona a Invocação quando o alvo deixa o Cemitério", async (t) => {
  const game = createGame(t);
  game.player.controllerType = "ai";
  const samurai = createCard(cardDatabaseByName.get("Misty Katana Ghost Samurai"), game.player);
  const chosen = createCard(cardDatabaseByName.get("Tech-Zero Energy Core"), game.player);
  const alternate = createCard(cardDatabaseByName.get("Tech-Zero Energy Core"), game.player);
  game.player.graveyard.push(samurai, chosen, alternate);
  assert.ok(game.chainSystem instanceof ChainSystem);
  game.chainSystem.offerChainResponses = async () => {
    const moved = await game.moveCard(chosen, game.player, "banished", { fromZone: "graveyard" });
    assert.equal(moved.success, true);
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  await game.tryActivateMonsterEffect(
    samurai,
    { misty_katana_ghost_samurai_revive_target: [chosen] },
    "graveyard",
    game.player,
    { effectId: "misty_katana_ghost_samurai_revive_tuner" },
  );
  assert.equal(game.player.banished.includes(samurai), true);
  assert.equal(game.player.banished.includes(chosen), true);
  assert.equal(game.player.graveyard.includes(alternate), true);
  assert.equal(game.player.field.includes(alternate), false);
});

test("Samurai não Invoca nem troca o alvo se ele ultrapassar o Nível 4 durante a Corrente", async (t) => {
  const game = createGame(t);
  game.player.controllerType = "ai";
  const samurai = createCard(cardDatabaseByName.get("Misty Katana Ghost Samurai"), game.player);
  const chosen = createCard(cardDatabaseByName.get("Tech-Zero Energy Core"), game.player);
  const alternate = createCard(cardDatabaseByName.get("Tech-Zero Energy Core"), game.player);
  game.player.graveyard.push(samurai, chosen, alternate);
  assert.ok(game.chainSystem instanceof ChainSystem);
  game.chainSystem.offerChainResponses = async () => {
    chosen.level = 5;
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  await game.tryActivateMonsterEffect(
    samurai,
    { misty_katana_ghost_samurai_revive_target: [chosen] },
    "graveyard",
    game.player,
    { effectId: "misty_katana_ghost_samurai_revive_tuner" },
  );
  assert.equal(game.player.banished.includes(samurai), true);
  assert.equal(game.player.graveyard.includes(chosen), true);
  assert.equal(game.player.graveyard.includes(alternate), true);
  assert.equal(game.player.field.length, 0);
});

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
  const summonResult = required(await summonPromise);

  assert.ok(summonResult.success === true);
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

test("Samurai se bane, revive o Regulador e encerra a janela do Cemitério", async (t) => {
  const game = createGame(t);
  game.player.controllerType = "ai";
  const samurai = createCard(
    cardDatabaseByName.get("Misty Katana Ghost Samurai"),
    game.player,
  );
  const tuner = createCard(
    cardDatabaseByName.get("Tech-Zero Energy Core"),
    game.player,
  );
  game.player.graveyard.push(samurai, tuner);

  const result = await game.tryActivateMonsterEffect(
    samurai,
    null,
    "graveyard",
    game.player,
    { effectId: "misty_katana_ghost_samurai_revive_tuner" },
  );

  assert.ok(result.success === true);
  assert.equal(game.player.banished.includes(samurai), true);
  assert.equal(game.player.field.includes(tuner), true);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
  assert.equal(game.targetSelection, null);
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

  const result = required(
    await game.performNormalSummon(game.player, 0, "attack", false),
  );

  assert.ok(result.success === true);
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
