import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { evaluateSimulatedConditions } from "../src/core/ai/common/simulatedConditions.js";
import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { cardDatabaseByName } from "../src/data/cards.js";

const EXPECTED_EN =
  'When your opponent activates a card or effect that would banish one or more cards from your field and/or GY (Quick Effect): you can Special Summon this card from your hand, and if you do, negate that effect.\n\nYou can only use this effect of "Guardian Deity Visas" once per turn.';
const EXPECTED_PT_BR =
  "Quando seu oponente ativar um card ou efeito que baniria um ou mais cards do seu campo e/ou Cemitério (Efeito Rápido): você pode Invocar este card por Invocação-Especial da sua mão e, se isso acontecer, negue esse efeito.\n\nVocê só pode usar este efeito de “Divindade Guardiã Visas” uma vez por turno.";

function createCard(data, player) {
  const card = new Card(data, player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

test("Guardian Deity Visas declares compact text and canonical response actions", async () => {
  const card = cardDatabaseByName.get("Guardian Deity Visas");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"),
  );
  assert.equal(locale.cards["23"].description, EXPECTED_PT_BR);

  const [effect] = card.effects;
  assert.deepEqual(effect.activationZones, ["hand"]);
  assert.equal(effect.speed, 2);
  assert.equal(effect.isQuickEffect, true);
  assert.deepEqual(effect.canRespondTo, [
    "card_activation",
    "effect_activation",
  ]);
  assert.equal(effect.usagePolicy, "use");
  assert.equal(effect.oncePerTurnName, "guardian_deity_visas");
  assert.deepEqual(
    effect.actions.map(({ type }) => type),
    ["special_summon_from_zone", "negate_effect"],
  );
  assert.equal(effect.actions[0].haltOnFailure, true);
});

test("Guardian Deity Visas responds only when an opponent effect would banish an own card", (t) => {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
  });
  t.after(() => game.dispose());

  const definition = cardDatabaseByName.get("Guardian Deity Visas");
  const visas = createCard(definition, game.player);
  const ownCard = createCard(
    { id: 99211, name: "Protected own card", cardKind: "monster" },
    game.player,
  );
  const opponentCard = createCard(
    { id: 99212, name: "Opponent banish target", cardKind: "monster" },
    game.bot,
  );
  const activatedCard = createCard(
    { id: 99213, name: "Opponent banishing source", cardKind: "spell" },
    game.bot,
  );
  game.player.hand.push(visas);
  game.player.graveyard.push(ownCard);
  game.bot.field.push(opponentCard);

  const [responseEffect] = visas.effects;
  const banishEffect = {
    id: "test_banish_effect",
    actions: [{ type: "banish", targetRef: "banish_target" }],
  };
  const makeActionContext = (target, controller = game.bot) => ({
    activationAttempt: {
      card: activatedCard,
      effect: banishEffect,
      controller,
    },
    card: activatedCard,
    effect: banishEffect,
    player: controller,
    respondingToChainLink: {
      targetSelections: { banish_target: [target] },
    },
  });
  const evaluateRuntime = (actionContext) =>
    game.effectEngine.evaluateConditions(responseEffect.conditions, {
      source: visas,
      player: game.player,
      opponent: game.bot,
      activationContext: { context: actionContext },
    }).ok;
  const evaluateSimulation = (actionContext) =>
    evaluateSimulatedConditions(responseEffect.conditions, {
      state: { player: game.player, bot: game.bot },
      selfId: game.player.id,
      sourceCard: visas,
      options: { actionContext },
    });

  const validContext = makeActionContext(ownCard);
  assert.equal(evaluateRuntime(validContext), true);
  assert.equal(evaluateSimulation(validContext), true);
  assert.equal(evaluateRuntime(makeActionContext(opponentCard)), false);
  assert.equal(
    evaluateRuntime(makeActionContext(ownCard, game.player)),
    false,
  );
});
