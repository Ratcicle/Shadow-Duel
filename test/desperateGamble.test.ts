import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";
import type { CardAction } from "../src/core/contracts/actions.js";

const EXPECTED_EN =
  'Pay half your LP; draw 2 cards.\n\nFor the rest of this turn, you cannot activate effects of cards with the same names as the cards drawn by this effect.\n\nYou can only activate 1 "Desperate Gamble" per turn.';
const EXPECTED_PT_BR =
  "Pague metade dos seus PV; compre 2 cards.\n\nPelo resto deste turno, você não pode ativar efeitos de cards com o mesmo nome dos cards comprados por este efeito.\n\nVocê só pode ativar 1 “Aposta Desesperada” por turno.";

function createCard(data: CardConstructorData | undefined, player: GamePlayer) {
  assert.ok(data, "Card fixture must exist.");
  const card = new Card(data, player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

async function waitUntil(
  predicate: () => unknown,
  message: string,
  attempts = 200,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test("Desperate Gamble declares three compact effect paragraphs", async () => {
  const card = cardDatabaseByName.get("Desperate Gamble");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(locale.cards["22"].description, EXPECTED_PT_BR);

  const [effect] = required(card.effects);
  assert.ok(effect);
  assert.equal(effect.usagePolicy, "activate");
  assert.equal(effect.oncePerTurn, true);
  assert.equal(effect.oncePerTurnName, "desperate_gamble_activation");
  assert.deepEqual(
    required(effect.actions).map(({ type }) => type),
    ["draw", "restrict_effect_activations_by_names"],
  );
  assert.equal(
    required(required(effect.actions)[1]).nameSource,
    "lastDrawnCards",
  );
  assert.equal(
    required(required(effect.actions)[1]).duration,
    "until_end_turn",
  );
});

test("Desperate Gamble pays half LP, draws two cards and blocks their names", async (t) => {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose());

  const gamble = createCard(
    cardDatabaseByName.get("Desperate Gamble"),
    game.player,
  );
  const firstDraw = createCard(
    {
      id: 99201,
      name: "Desperate Gamble drawn A",
      cardKind: "monster",
      effects: [
        {
          id: "revealed_a_effect",
          timing: "ignition",
          activationZones: ["field"],
          actions: [],
        },
      ],
    },
    game.player,
  );
  const secondDraw = createCard(
    {
      id: 99202,
      name: "Desperate Gamble drawn B",
      cardKind: "spell",
      subtype: "normal",
      effects: [{ id: "revealed_b_effect", timing: "on_play" }],
    },
    game.player,
  );
  game.player.lp = 8000;
  game.player.hand = [gamble];
  game.player.deck = [secondDraw, firstDraw];

  void game.tryActivateSpell(gamble, 0);
  await waitUntil(
    () => game.player.graveyard.includes(gamble),
    "Desperate Gamble did not finish resolving.",
  );

  assert.equal(game.player.lp, 4000);
  assert.equal(game.player.hand.includes(firstDraw), true);
  assert.equal(game.player.hand.includes(secondDraw), true);
  assert.deepEqual(game.player.effectActivationRestrictions[0]?.blockedNames, [
    firstDraw.name,
    secondDraw.name,
  ]);
  assert.equal(
    game.canActivateCardEffectUnderRestrictions(
      firstDraw,
      game.player,
      required(firstDraw.effects)[0],
      { silent: true },
    ).code,
    "effect_activation_restricted",
  );
  assert.equal(
    game.canActivateCardEffectUnderRestrictions(
      secondDraw,
      game.player,
      required(secondDraw.effects)[0],
      { silent: true },
    ).code,
    "effect_activation_restricted",
  );

  game.turnCounter += 1;
  assert.ok(
    game.canActivateCardEffectUnderRestrictions(
      firstDraw,
      game.player,
      required(firstDraw.effects)[0],
      { silent: true },
    ).ok === true,
  );
});

for (const initialLp of [8000, 3, 1, 0.5]) {
  test(`Desperate Gamble preserves half of ${initialLp} LP in execution and simulation`, async (t) => {
    const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
    t.after(() => game.dispose());
    Object.assign(game, { turn: "player", phase: "main1", disablePresentationDelays: true });
    game.player.controllerType = game.bot.controllerType = "human";
    game.ui.showChainResponseModal = async () => null;
    const gamble = createCard(cardDatabaseByName.get("Desperate Gamble"), game.player);
    const copy = createCard(cardDatabaseByName.get("Desperate Gamble"), game.player);
    const first = createCard(cardDatabaseByName.get("Nightmare Steed"), game.player);
    const second = createCard(cardDatabaseByName.get("Arcane Scholar"), game.player);
    const effect = required(required(gamble.effects)[0]);
    game.player.lp = initialLp;
    game.player.hand = [gamble, copy];
    game.player.deck = [first, second];
    assert.equal(game.effectEngine.canActivateSpellFromHandPreview(gamble, game.player).ok, true);
    assert.equal((await game.tryActivateSpell(gamble, 0)).success, true);
    assert.equal(game.player.lp, initialLp / 2);
    assert.ok(game.player.hand.includes(first) && game.player.hand.includes(second));
    assert.ok(game.player.graveyard.includes(gamble));
    assert.equal(game.canUseOncePerTurn(copy, game.player, effect).ok, false);
    assert.deepEqual(new Set(game.player.effectActivationRestrictions[0]?.blockedNames), new Set([first.name, second.name]));
    game.checkWinCondition();
    assert.equal(game.gameOver, false);

    const state = simulationState({ player: { lp: initialLp, deck: [simulationCard(first), simulationCard(second)] } });
    applySimulatedActions({ state, selfId: "player", actions: [...(effect.activationCosts ?? []), ...(effect.actions ?? [])] });
    assert.equal(state.player.lp, game.player.lp);
    assert.equal(state.player.hand.length, 2);
    assert.deepEqual(new Set(state.player.effectActivationRestrictions?.[0]?.blockedNames), new Set([first.name, second.name]));
  });
}

test("Fixed and fractional LP costs retain reducer limits without consuming them in preview", async (t) => {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());
  const knight = createCard(cardDatabaseByName.get("Luminarch Pure Knight"), game.player);
  const source = createCard({ id: 99203, name: "LP cost fixture", cardKind: "spell", archetype: "Luminarch" }, game.player);
  const discount = required(knight.effects.find((effect) => effect.id === "luminarch_pure_knight_lp_discount"));
  game.player.field.push(knight);
  game.player.lp = 3001;
  const state = simulationState({ player: { lp: 3001, field: [simulationCard(knight)] } });
  const cases: { action: CardAction; expected: number }[] = [
    { action: { type: "pay_lp", amount: 1500 }, expected: 2501 },
    { action: { type: "pay_lp", fraction: 0.5 }, expected: 2250.5 },
    { action: { type: "pay_lp", amount: 1500 }, expected: 750.5 },
  ];
  for (const [index, { action, expected }] of cases.entries()) {
    const context = { source, player: game.player, opponent: game.bot };
    for (let preview = 0; preview < 3; preview++) {
      assert.equal(game.effectEngine.checkActionPreviewRequirements([action], context).ok, true);
    }
    assert.equal(game.canUseOncePerTurn(knight, game.player, discount).ok, index < 2);
    await game.effectEngine.applyActions([action], context, {});
    applySimulatedActions({ state, selfId: "player", actions: [action], options: { sourceCard: simulationCard(source) } });
    assert.equal(game.player.lp, expected);
    assert.equal(state.player.lp, expected);
  }
});
