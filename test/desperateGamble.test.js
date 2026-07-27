import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { cardDatabaseByName } from "../src/data/cards.js";

const EXPECTED_EN =
  "Pay half your LP; draw 2 cards.\n\nFor the rest of this turn, you cannot activate effects of cards with the same names as the cards drawn by this effect.\n\nYou can only activate 1 \"Desperate Gamble\" per turn.";
const EXPECTED_PT_BR =
  "Pague metade dos seus PV; compre 2 cards.\n\nPelo resto deste turno, você não pode ativar efeitos de cards com o mesmo nome dos cards comprados por este efeito.\n\nVocê só pode ativar 1 “Aposta Desesperada” por turno.";

function createCard(data, player) {
  const card = new Card(data, player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

async function waitUntil(predicate, message, attempts = 200) {
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
    await readFile(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"),
  );
  assert.equal(locale.cards["22"].description, EXPECTED_PT_BR);

  const [effect] = card.effects;
  assert.equal(effect.usagePolicy, "activate");
  assert.equal(effect.oncePerTurn, true);
  assert.equal(effect.oncePerTurnName, "desperate_gamble_activation");
  assert.deepEqual(
    effect.actions.map(({ type }) => type),
    ["draw", "restrict_effect_activations_by_names"],
  );
  assert.equal(effect.actions[1].nameSource, "lastDrawnCards");
  assert.equal(effect.actions[1].duration, "until_end_turn");
});

test("Desperate Gamble pays half LP, draws two cards and blocks their names", async (t) => {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
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
      effects: [{ id: "revealed_a_effect", timing: "ignition" }],
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
  assert.deepEqual(
    game.player.effectActivationRestrictions[0]?.blockedNames,
    [firstDraw.name, secondDraw.name],
  );
  assert.equal(
    game.canActivateCardEffectUnderRestrictions(
      firstDraw,
      game.player,
      firstDraw.effects[0],
      { silent: true },
    ).code,
    "effect_activation_restricted",
  );
  assert.equal(
    game.canActivateCardEffectUnderRestrictions(
      secondDraw,
      game.player,
      secondDraw.effects[0],
      { silent: true },
    ).code,
    "effect_activation_restricted",
  );

  game.turnCounter += 1;
  assert.equal(
    game.canActivateCardEffectUnderRestrictions(
      firstDraw,
      game.player,
      firstDraw.effects[0],
      { silent: true },
    ).ok,
    true,
  );
});
