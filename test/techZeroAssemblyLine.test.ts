import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import test from "node:test";
import type { ChainSelectionMap } from "../src/core/contracts/chainRuntime.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import {
  objectResult,
  record,
  required,
  selectedCards,
  unsafeFixture,
} from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const CARD_NAME = "Tech-Zero Assembly Line";
const EFFECT_ID = "tech_zero_assembly_line_activation";
const COST_REF = "tech_zero_assembly_line_banish_cost";

function getCardData(name: string = CARD_NAME) {
  const card = cardDatabaseByName.get(name);
  assert.ok(card, `${name} must exist in the card database.`);
  return card;
}

function getEffect() {
  const effect = required(getCardData().effects).find(
    (entry) => entry.id === EFFECT_ID,
  );
  assert.ok(effect, `Expected effect ${EFFECT_ID}.`);
  return effect;
}

function runtimeCard(name: string, player: GamePlayer) {
  const card = new Card(getCardData(name), player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.phaseDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiPresentationStepDelayMs = 0;
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
  t.after(() => game.dispose("tech_zero_assembly_line_test_complete"));
  return game;
}

test("Assembly Line declara somente o banimento como custo e escolhe a Invocação na resolução", () => {
  const effect = getEffect();
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.equal(effect.oncePerTurn, true);
  assert.equal(effect.oncePerTurnName, EFFECT_ID);
  assert.equal(effect.usagePolicy, "activate");

  assert.equal(
    required(effect.conditions).some(
      (condition) =>
        record(condition).type === "field_card_count" &&
        record(condition).zone === "graveyard",
    ),
    false,
  );
  assert.deepEqual(
    required(effect.targets).map((target) => ({
      id: target.id,
      intent: target.intent,
      zone: target.zone,
      count: target.count,
    })),
    [
      {
        id: COST_REF,
        intent: "cost",
        zone: "graveyard",
        count: { min: 2, max: 2 },
      },
    ],
  );
  assert.deepEqual(required(effect.activationCommitActions), [
    { type: "forbid_direct_attack_this_turn", player: "self" },
  ]);

  const summonAction = required(effect.actions)[0];
  assert.equal(summonAction.type, "special_summon_from_zone");
  assert.equal(summonAction.zone, "deck");
  assert.equal(summonAction.cardKind, "monster");
  assert.equal(summonAction.archetype, "Tech-Zero");
  assert.deepEqual(summonAction.count, { min: 1, max: 1 });
  assert.equal(Object.hasOwn(summonAction, "targetRef"), false);
});

test("Assembly Line funciona com exatamente dois monstros no Cemitério e escolhe do Deck durante a resolução", async (t) => {
  const game = createGame(t);
  const spell = runtimeCard(CARD_NAME, game.player);
  const costs = [
    runtimeCard("Tech-Zero Energy Core", game.player),
    runtimeCard("Tech-Zero Electrocatapult", game.player),
  ];
  const firstCandidate = runtimeCard("Tech-Zero Glider Wyvern", game.player);
  const selectedCandidate = runtimeCard("Tech-Zero Iron Raptor", game.player);
  game.player.hand.push(spell);
  game.player.graveyard.push(...costs);
  game.player.deck.push(firstCandidate, selectedCandidate);

  let activationWindowSnapshot = null as {
    costSelections: ChainSelectionMap;
    targetSelections: ChainSelectionMap;
    directAttackForbidden: boolean;
  } | null;
  const originalOpenActivationChain = game.chainSystem.openActivationChain.bind(
    game.chainSystem,
  );
  game.chainSystem.openActivationChain = async (prepared) => {
    activationWindowSnapshot = {
      costSelections: required(required(prepared).costSelections),
      targetSelections: required(required(prepared).targetSelections),
      directAttackForbidden: game.player.forbidDirectAttacksThisTurn === true,
    };
    return originalOpenActivationChain(prepared);
  };

  let resolutionChoiceSnapshot = null;
  game.ui.getSearchModalElements = () =>
    unsafeFixture<ReturnType<typeof game.ui.getSearchModalElements>>(
      {},
      "The replacement visual callback reads candidate data and never accesses DOM elements.",
    );
  game.ui.showSearchModalVisual = (
    _elements,
    candidates,
    _defaultName,
    select,
  ) => {
    resolutionChoiceSnapshot = {
      isResolving: game.chainSystem.isResolving === true,
      candidates: candidates.map((card) => card.name),
    };
    select(selectedCandidate.name, selectedCandidate);
  };

  const result = await game.tryActivateSpell(spell, 0, {
    [COST_REF]: costs,
  });

  assert.ok(result.success === true);
  assert.equal(
    costs.every((card) => game.player.banished.includes(card)),
    true,
  );
  assert.equal(game.player.graveyard.includes(spell), true);
  assert.equal(game.player.field.includes(selectedCandidate), true);
  assert.equal(game.player.deck.includes(firstCandidate), true);
  assert.equal(selectedCandidate.banishWhenLeavesField, true);
  assert.equal(game.player.forbidDirectAttacksThisTurn, true);
  assert.deepEqual(required(activationWindowSnapshot).targetSelections, {});
  assert.deepEqual(
    selectedCards(required(activationWindowSnapshot).costSelections, COST_REF),
    costs,
  );
  assert.equal(required(activationWindowSnapshot).directAttackForbidden, true);
  assert.deepEqual(resolutionChoiceSnapshot, {
    isResolving: true,
    candidates: [firstCandidate.name, selectedCandidate.name],
  });
  assert.equal(game.chainSystem.getFastEffectState().state, "open");

  await game.moveCard(selectedCandidate, game.player, "graveyard", {
    fromZone: "field",
    contextLabel: "assembly_line_leave_field_test",
  });
  assert.equal(game.player.graveyard.includes(selectedCandidate), false);
  assert.equal(game.player.banished.includes(selectedCandidate), true);
  assert.equal(selectedCandidate.banishWhenLeavesField, undefined);
});

test("a pré-validação exige custo, alvo de Invocação e zona livre sem pagar recursos", (t) => {
  const exactGame = createGame(t);
  const exactSpell = runtimeCard(CARD_NAME, exactGame.player);
  exactGame.player.hand.push(exactSpell);
  exactGame.player.graveyard.push(
    runtimeCard("Tech-Zero Energy Core", exactGame.player),
    runtimeCard("Tech-Zero Electrocatapult", exactGame.player),
  );
  exactGame.player.deck.push(
    runtimeCard("Tech-Zero Glider Wyvern", exactGame.player),
  );
  assert.ok(
    exactGame.effectEngine.canActivateSpellFromHandPreview(
      exactSpell,
      exactGame.player,
    ).ok === true,
  );

  exactGame.player.graveyard.pop();
  assert.ok(
    exactGame.effectEngine.canActivateSpellFromHandPreview(
      exactSpell,
      exactGame.player,
    ).ok === false,
  );
  assert.equal(exactGame.player.banished.length, 0);

  exactGame.player.graveyard.push(
    runtimeCard("Tech-Zero Electrocatapult", exactGame.player),
  );
  exactGame.player.deck.length = 0;
  assert.ok(
    exactGame.effectEngine.canActivateSpellFromHandPreview(
      exactSpell,
      exactGame.player,
    ).ok === false,
  );

  exactGame.player.deck.push(
    runtimeCard("Tech-Zero Glider Wyvern", exactGame.player),
  );
  exactGame.player.field.push(
    ...Array.from({ length: 5 }, (_, index) => {
      const card = runtimeCard("Tech-Zero Energy Core", exactGame.player);
      card.instanceId = unsafeFixture<number>(
        `assembly-full-field-${index}`,
        "Preserve readable legacy IDs for full-field fixtures.",
      );
      return card;
    }),
  );
  assert.ok(
    exactGame.effectEngine.canActivateSpellFromHandPreview(
      exactSpell,
      exactGame.player,
    ).ok === false,
  );
});

test("a restrição de ataque direto é comprometida antes do elo e existe também na simulação", async (t) => {
  const game = createGame(t);
  const spell = runtimeCard(CARD_NAME, game.player);
  const effect = getEffect();
  game.player.spellTrap.push(spell);
  const prepared = game.chainSystem.createPreparedActivation({
    card: spell,
    controller: game.player,
    effect,
    activationZone: "spellTrap",
    committed: true,
    costsPaid: true,
  });

  assert.equal(game.player.forbidDirectAttacksThisTurn, false);
  const commitment =
    await game.chainSystem.applyActivationCommitActions(prepared);
  assert.ok(commitment.success === true);
  assert.equal(game.player.forbidDirectAttacksThisTurn, true);
  assert.equal(required(prepared.activationCommitment).status, "applied");
  const link = objectResult(game.chainSystem.addToChain(prepared));
  link.activationNegated = true;
  assert.equal(game.player.forbidDirectAttacksThisTurn, true);

  const state = simulationState({
    turnCounter: 1,
    bot: { id: "bot", field: [] },
    player: { id: "player", field: [] },
  });
  applySimulatedActions({
    actions: effect.activationCommitActions,
    selections: {},
    state,
    selfId: "bot",
    options: { sourceCard: simulationCard({ id: 519, name: CARD_NAME }) },
  });
  assert.equal(state.bot.forbidDirectAttacksThisTurn, true);
  assert.deepEqual(state._simUnsupportedActions || [], []);
});
