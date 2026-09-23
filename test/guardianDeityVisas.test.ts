import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import type { EffectCondition } from "../src/core/contracts/effects.js";
import { chainSelections, required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import ChainSystem from "../src/core/ChainSystem.js";
import { evaluateSimulatedConditions } from "../src/core/ai/common/simulatedConditions.js";
import { evaluateActivationPreviewConditions } from "../src/core/effects/conditions/runtime.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const EXPECTED_EN =
  'When your opponent activates a card or effect that would banish one or more cards from your field and/or GY (Quick Effect): you can Special Summon this card from your hand, and if you do, negate that effect.\n\nYou can only use this effect of "Guardian Deity Visas" once per turn.';
const EXPECTED_PT_BR =
  "Quando seu oponente ativar um card ou efeito que baniria um ou mais cards do seu campo e/ou Cemitério (Efeito Rápido): você pode Invocar este card por Invocação-Especial da sua mão e, se isso acontecer, negue esse efeito.\n\nVocê só pode usar este efeito de “Divindade Guardiã Visas” uma vez por turno.";

function createCard(data: CardConstructorData | undefined, player: GamePlayer) {
  assert.ok(data, "Card fixture must exist.");
  const card = new Card(data, player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

test("Visas is discovered against Final Singularity through actual Chain Link contexts", (t) => {
  const game = createRuntimeGame({ captureReplay: false });
  t.after(() => game.dispose());
  game.phase = "main1";
  game.turn = game.player.id;
  const visas = createCard(cardDatabaseByName.get("Guardian Deity Visas"), game.player);
  const singularity = createCard(cardDatabaseByName.get("Tech-Zero Final Singularity"), game.bot);
  const source = createCard({
    id: 99216, name: "Graveyard removal", cardKind: "monster",
    effects: [{
      id: "graveyard_removal", timing: "ignition", activationZones: ["graveyard"],
      targets: [{ id: "destroy_target", owner: "opponent", zone: "field", count: { min: 1, max: 1 } }],
      actions: [{ type: "destroy", targetRef: "destroy_target" }],
    }],
  }, game.player);
  game.player.hand.push(visas);
  game.player.graveyard.push(source);
  game.bot.field.push(singularity);
  assert.ok(game.chainSystem instanceof ChainSystem);
  const chain = game.chainSystem;
  assert.ok(chain.addToChain(chain.createPreparedActivation({
    card: source, controller: game.player, effect: required(source.effects?.[0]),
    activationZone: "graveyard", committed: true, costsPaid: true,
    targetSelections: chainSelections({ destroy_target: [singularity] }),
  })));
  const responseContext = required(chain.getCurrentChainActivationContext());
  const singularityEffect = required(singularity.effects?.find(effect => effect.id === "tech_zero_final_singularity_negate_leave_field"));
  assert.ok(chain.addToChain(chain.createPreparedActivation({
    card: singularity, controller: game.bot, effect: singularityEffect,
    activationZone: "field", committed: true, costsPaid: true, context: responseContext,
  })));
  const available = () => chain.getActivatableCardsInChain(game.player, required(chain.getCurrentChainActivationContext()))
    .some(candidate => candidate.card === visas);
  assert.equal(available(), true);
  const other = createCard({ id: 99217, name: "Other controlled card", cardKind: "trap" }, game.bot);
  other.isFacedown = true;
  game.bot.spellTrap.push(other);
  game.effectEngine.clearTargetingCache();
  assert.equal(available(), false);
});

test("activation previews reject recursive and stateful condition evaluation", () => {
  const cycle = { type: "any_of", conditions: [] as object[] };
  cycle.conditions.push(cycle);
  const forbidden = [
    cycle,
    { type: "activation_would_banish_cards_matching_filters" },
    { type: "destroyed_card_matches_declared_value" },
    { type: "battle_opponent_matches_declared_value" },
    { type: "has_stored_blueprint" },
  ];
  for (const condition of forbidden) {
    assert.equal(evaluateActivationPreviewConditions([condition], () => {
      assert.fail("A preview must not invoke a recursive or stateful predicate.");
    }), false);
  }
});

test("Guardian Deity Visas declares compact text and canonical response actions", async () => {
  const card = cardDatabaseByName.get("Guardian Deity Visas");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(locale.cards["23"].description, EXPECTED_PT_BR);

  const [effect] = required(card.effects);
  assert.ok(effect);
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
    required(effect.actions).map(({ type }) => type),
    ["special_summon_from_zone", "negate_effect"],
  );
  assert.equal(required(required(effect.actions)[0]).haltOnFailure, true);
});

test("Guardian Deity Visas responds only when an opponent effect would banish an own card", (t) => {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
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

  const [responseEffect] = required(visas.effects);
  assert.ok(responseEffect);
  const banishEffect = {
    id: "test_banish_effect",
    actions: [{ type: "banish", targetRef: "banish_target" }],
  };
  const makeActionContext = (target: Card, controller = game.bot) => ({
    activationAttempt: {
      card: activatedCard,
      effect: banishEffect,
      controller,
    },
    card: activatedCard,
    effect: banishEffect,
    player: controller,
    respondingToChainLink: {
      targetSelections: chainSelections({ banish_target: [target] }),
    },
  });
  const evaluateRuntime = (
    actionContext: ReturnType<typeof makeActionContext>,
  ) =>
    game.effectEngine.evaluateConditions(responseEffect.conditions, {
      source: visas,
      player: game.player,
      opponent: game.bot,
      activationContext: { context: actionContext },
    }).ok;
  const evaluateSimulation = (
    actionContext: ReturnType<typeof makeActionContext>,
  ) =>
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
  assert.equal(evaluateRuntime(makeActionContext(ownCard, game.player)), false);
});

test("Guardian Deity Visas previews a conditional banish of the negated card", (t) => {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());

  const visas = createCard(cardDatabaseByName.get("Guardian Deity Visas"), game.player);
  const singularity = createCard(cardDatabaseByName.get("Tech-Zero Final Singularity"), game.bot);
  const ownCard = createCard(
    { id: 99214, name: "Own activated card", cardKind: "monster" },
    game.player,
  );
  const extraCard = createCard(
    { id: 99215, name: "Other opponent card", cardKind: "spell" },
    game.bot,
  );
  const responseEffect = required(visas.effects).find(
    (effect) => effect.id === "guardian_deity_visas_hand_negate_banish",
  );
  const singularityEffect = required(singularity.effects).find(
    (effect) => effect.id === "tech_zero_final_singularity_negate_leave_field",
  );
  assert.ok(responseEffect);
  assert.ok(singularityEffect);

  game.player.hand.push(visas);
  game.bot.field.push(singularity);
  game.player.graveyard.push(ownCard);

  const previousActivation = {
    card: ownCard,
    activationAttempt: { card: ownCard, controller: game.player },
  };
  const actionContext = {
    card: singularity,
    player: game.bot,
    effect: singularityEffect,
    activationAttempt: {
      card: singularity,
      controller: game.bot,
      effect: singularityEffect,
    },
    respondingToChainLink: {
      card: singularity,
      context: previousActivation,
    },
  };
  const evaluateRuntime = () => game.effectEngine.evaluateConditions(
    responseEffect.conditions,
    {
      source: visas,
      player: game.player,
      opponent: game.bot,
      activationContext: { context: actionContext },
    },
  ).ok;
  const evaluateSimulation = () => evaluateSimulatedConditions(
    responseEffect.conditions,
    {
      state: { player: game.player, bot: game.bot },
      selfId: game.player.id,
      sourceCard: visas,
      options: { actionContext },
    },
  );

  assert.equal(evaluateRuntime(), true);
  assert.equal(evaluateSimulation(), true);
  assert.equal(game.player.graveyard.includes(ownCard), true);
  assert.equal(game.bot.field.includes(singularity), true);
  assert.equal(Object.hasOwn(actionContext, "_actionTargets"), false);

  const banishBranch = required(singularityEffect.actions?.[1]);
  assert.equal(banishBranch.type, "conditional_actions");
  if (banishBranch.type !== "conditional_actions") assert.fail("Expected conditional banish.");
  const branchCases: readonly (readonly EffectCondition[])[] = [
    [{ type: "any_of", conditions: required(banishBranch.conditions) }],
    [{
      type: "context_number_compare",
      key: "_actionTargets.tech_zero_final_singularity_negated_card.length",
      op: "eq",
      value: 1,
    }, ...required(banishBranch.conditions)],
  ];
  for (const conditions of branchCases) {
    const effect = {
      ...singularityEffect,
      actions: [required(singularityEffect.actions?.[0]), { ...banishBranch, conditions }],
    };
    const context = {
      ...actionContext,
      effect,
      activationAttempt: { ...actionContext.activationAttempt, effect },
    };
    const runtime = (): boolean => game.effectEngine.evaluateConditions(responseEffect.conditions, {
      source: visas, player: game.player, opponent: game.bot,
      activationContext: { context },
    }).ok;
    const simulation = (): boolean => evaluateSimulatedConditions(responseEffect.conditions, {
      state: { player: game.player, bot: game.bot }, selfId: game.player.id,
      sourceCard: visas, options: { actionContext: context },
    });
    assert.equal(runtime(), true, "A readable composed branch should expose the banish.");
    assert.equal(simulation(), true);
    game.bot.spellTrap.push(extraCard);
    assert.equal(runtime(), false, "A false composed branch must not expose the banish.");
    assert.equal(simulation(), false);
    game.bot.spellTrap.pop();
  }

  game.player.graveyard.pop();
  game.player.field.push(ownCard);
  assert.equal(evaluateRuntime(), true);
  assert.equal(evaluateSimulation(), true);

  game.bot.spellTrap.push(extraCard);
  extraCard.isFacedown = true;
  assert.equal(evaluateRuntime(), false);
  assert.equal(evaluateSimulation(), false);

  game.bot.spellTrap.pop();
  game.player.field.pop();
  game.player.hand.push(ownCard);
  assert.equal(evaluateRuntime(), false);
  assert.equal(evaluateSimulation(), false);
});
