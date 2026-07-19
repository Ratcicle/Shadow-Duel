import assert from "node:assert/strict";
import test from "node:test";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { evaluateSimulatedConditions } from "../src/core/ai/common/simulatedConditions.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { selectSimulatedTargets } from "../src/core/ai/common/targetSelection.js";
import Game from "../src/core/Game.js";
import {
  resolveCountFromSelectionDefinitions,
} from "../src/core/chain/selection.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../src/core/game/summon/synchro.js";
import { cardDatabaseById } from "../src/data/cards.js";
import {
  createChainHarness,
  createTestCard,
  placeCard,
} from "./chain/helpers/chainHarness.js";

const ROSE_PETAL_FLORAL_DRAGON_ID = 28;

function getRosePetalFloralDragon() {
  const card = cardDatabaseById.get(ROSE_PETAL_FLORAL_DRAGON_ID);
  assert.ok(card, "Rose Petal Floral Dragon must be in the card database");
  return card;
}

function getEffect(id) {
  const effect = getRosePetalFloralDragon().effects.find(
    (entry) => entry.id === id,
  );
  assert.ok(effect, `Expected effect ${id}.`);
  return effect;
}

function makeRuntimeCard(definition, ownerId) {
  const card = new Card(definition, ownerId);
  card.owner = ownerId;
  card.controller = ownerId;
  return card;
}

test("Rose Petal Floral Dragon declara Sincro, custo acoplado e Trigger canônicos", () => {
  const card = getRosePetalFloralDragon();
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  assert.equal(card.name, "Rose Petal Floral Dragon");
  assert.equal(card.monsterType, "synchro");
  assert.equal(card.level, 7);
  assert.equal(card.atk, 2500);
  assert.equal(card.def, 1700);
  assert.deepEqual(card.synchro, {
    tunerCount: 1,
    nonTunerMin: 1,
    materialFilters: { tuner: { type: "Plant", isTuner: true } },
  });

  const ignition = getEffect("rose_petal_floral_dragon_banish_destroy");
  assert.equal(ignition.timing, "ignition");
  assert.equal(ignition.speed, 1);
  assert.deepEqual(ignition.activationZones, ["field"]);
  assert.equal(ignition.usagePolicy, "use");
  assert.equal(ignition.targets[0].intent, "cost");
  assert.equal(
    ignition.targets[1].countFromSelectionRef,
    ignition.targets[0].id,
  );
  assert.equal(ignition.targets[1].minAtResolution, 0);
  assert.equal(ignition.activationCosts[0].type, "banish");
  assert.equal(ignition.actions[0].type, "destroy_targeted_cards");

  const recovery = getEffect("rose_petal_floral_dragon_leave_field_recover");
  assert.equal(recovery.event, "card_moved");
  assert.equal(recovery.fromZone, "field");
  assert.equal(recovery.requireSelfAsMoved, true);
  assert.equal(recovery.requireMovedCardWasFaceup, true);
  assert.equal(recovery.usagePolicy, "use");
  assert.equal(recovery.actions[0].type, "move");
  assert.equal(recovery.actions[0].to, "hand");
});

test("materiais exigem Regulador Planta e aceitam não-Reguladores livres", () => {
  const rose = { ...getRosePetalFloralDragon(), instanceId: "rose" };
  const plantTuner = {
    instanceId: "plant-tuner",
    cardKind: "monster",
    isTuner: true,
    type: "Plant",
    level: 3,
    isFacedown: false,
  };
  const dragonTuner = {
    instanceId: "dragon-tuner",
    cardKind: "monster",
    isTuner: true,
    type: "Dragon",
    level: 3,
    isFacedown: false,
  };
  const nonTuner = {
    instanceId: "non-tuner",
    cardKind: "monster",
    isTuner: false,
    type: "Rock",
    level: 4,
    isFacedown: false,
  };
  const player = { field: [plantTuner, dragonTuner, nonTuner] };
  const game = { canUseAsSynchroMaterial };

  assert.deepEqual(getSynchroMaterialCombos.call(game, player, rose), [
    [plantTuner, nonTuner],
  ]);
});

test("a comparação de cards controlados tem a mesma legalidade no runtime e na simulação", (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());

  const rose = makeRuntimeCard(getRosePetalFloralDragon(), game.player.id);
  const ownSpell = makeRuntimeCard(
    { id: 9801, name: "Own Spell", cardKind: "spell", subtype: "continuous" },
    game.player.id,
  );
  game.player.field.push(rose);
  game.player.spellTrap.push(ownSpell);
  for (let index = 0; index < 3; index += 1) {
    game.bot.field.push(
      makeRuntimeCard(
        {
          id: 9810 + index,
          name: `Opponent ${index}`,
          cardKind: "monster",
          atk: 1000,
          def: 1000,
        },
        game.bot.id,
      ),
    );
  }

  const condition = getEffect(
    "rose_petal_floral_dragon_banish_destroy",
  ).conditions;
  assert.equal(
    game.effectEngine.evaluateConditions(condition, {
      source: rose,
      player: game.player,
      opponent: game.bot,
    }).ok,
    true,
  );
  assert.equal(
    evaluateSimulatedConditions(condition, {
      state: { player: game.player, bot: game.bot },
      selfId: "player",
      sourceCard: rose,
    }),
    true,
  );

  game.bot.field.splice(1);
  assert.equal(
    game.effectEngine.evaluateConditions(condition, {
      source: rose,
      player: game.player,
      opponent: game.bot,
    }).ok,
    false,
  );
});

test("a transação bane o custo antes dos alvos e limita o custo à capacidade de destruição", async () => {
  let harness;
  harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      for (const action of actions || []) {
        if (action.type !== "banish") continue;
        for (const card of targets[action.targetRef] || []) {
          await harness.game.moveCard(card, harness.player, "banished", {
            fromZone: action.fromZone || "graveyard",
          });
        }
      }
    },
  });
  const { chain, player, bot, trace } = harness;
  const source = createTestCard({
    ...structuredClone(getRosePetalFloralDragon()),
    instanceId: "rose-source",
  });
  const costs = [1, 2, 3].map((index) =>
    createTestCard({
      instanceId: `plant-cost-${index}`,
      name: `Plant cost ${index}`,
      type: "Plant",
    }),
  );
  const monsterTarget = createTestCard({ instanceId: "monster-target" });
  const facedownTrapTarget = createTestCard({
    instanceId: "trap-target",
    cardKind: "trap",
    isFacedown: true,
  });
  placeCard(player, "field", source);
  costs.forEach((card) => placeCard(player, "graveyard", card));
  placeCard(bot, "field", monsterTarget);
  placeCard(bot, "spellTrap", facedownTrapTarget);

  const context = {
    type: "main_phase_action",
    event: "main_phase_action",
    player,
    triggerPlayer: player,
    openState: true,
    legalWindow: true,
  };
  const effect = getEffect("rose_petal_floral_dragon_banish_destroy");
  const preparedResult = await chain.prepareChainResponse(
    {
      card: source,
      effect,
      effectId: effect.id,
      sourceZone: "field",
      sourceLocationVersion: 0,
      context,
    },
    player,
    context,
  );

  assert.equal(preparedResult.success, true);
  const prepared = preparedResult.preparedActivation;
  assert.equal(player.banished.length, 2);
  assert.equal(player.graveyard.length, 1);
  assert.equal(
    prepared.costSelections.rose_petal_floral_dragon_banish_cost.length,
    2,
  );
  assert.equal(
    prepared.targetSelections.rose_petal_floral_dragon_destroy_targets.length,
    2,
  );
  assert.deepEqual(
    prepared.targetSelections.rose_petal_floral_dragon_destroy_targets,
    [monsterTarget, facedownTrapTarget],
  );
  assert.equal(trace.actions[0].action.type, "banish");

  const link = chain.addToChain(prepared);
  assert.doesNotThrow(() => JSON.stringify(chain.getChainSummary()));
  assert.equal(
    link.targetSelections.rose_petal_floral_dragon_destroy_targets.length,
    link.costSelections.rose_petal_floral_dragon_banish_cost.length,
  );
  assert.deepEqual(link.resolvedSelectionCounts, {
    rose_petal_floral_dragon_destroy_targets: 2,
  });
  assert.deepEqual(chain.getChainSummary()[0].resolvedSelectionCounts, {
    rose_petal_floral_dragon_destroy_targets: 2,
  });
});

test("minAtResolution preserva os alvos restantes sem retarget", async () => {
  const resolvedTargetIds = [];
  const harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      if (actions.some((action) => action.type === "destroy_targeted_cards")) {
        resolvedTargetIds.push(
          ...(targets.rose_petal_floral_dragon_destroy_targets || []).map(
            (card) => card.instanceId,
          ),
        );
      }
      return { success: true };
    },
  });
  const { chain, game, player, bot } = harness;
  const source = createTestCard({
    ...structuredClone(getRosePetalFloralDragon()),
    instanceId: "rose-source",
  });
  const movedTarget = createTestCard({ instanceId: "moved-target" });
  const remainingTarget = createTestCard({ instanceId: "remaining-target" });
  placeCard(player, "field", source);
  placeCard(bot, "field", movedTarget);
  placeCard(bot, "field", remainingTarget);
  const effect = getEffect("rose_petal_floral_dragon_banish_destroy");
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card: source,
      controller: player,
      effect,
      activationZone: "field",
      costSelections: { rose_petal_floral_dragon_banish_cost: [] },
      targetSelections: {
        rose_petal_floral_dragon_destroy_targets: [
          movedTarget,
          remainingTarget,
        ],
      },
      committed: true,
      costsPaid: true,
    }),
  );
  await game.moveCard(movedTarget, bot, "graveyard", { fromZone: "field" });
  const result = await chain.resolveChain();

  assert.equal(result.success, true);
  assert.deepEqual(resolvedTargetIds, ["remaining-target"]);
  assert.equal(link.targetValidation.satisfiesMinimums, true);
  assert.equal(link.targetValidation.groups[0].minimum, 0);
});

test("o Trigger de deixar o campo exige face-up, cobre todos os destinos e ignora troca de controle", async (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  const rose = makeRuntimeCard(getRosePetalFloralDragon(), game.player.id);
  const plant = makeRuntimeCard(
    {
      id: 9820,
      name: "Plant in Graveyard",
      cardKind: "monster",
      type: "Plant",
      atk: 500,
      def: 500,
    },
    game.player.id,
  );
  game.player.field.push(rose);
  game.player.graveyard.push(plant);

  for (const toZone of ["graveyard", "hand", "deck", "banished"]) {
    const leaving = await game.effectEngine.collectCardMovedTriggers({
      card: rose,
      player: game.player,
      opponent: game.bot,
      fromZone: "field",
      toZone,
      wasFaceupBeforeMove: true,
    });
    assert.equal(leaving.entries.length, 1, `Expected Trigger when moving to ${toZone}.`);
    assert.equal(
      leaving.entries[0].effect.id,
      "rose_petal_floral_dragon_leave_field_recover",
    );
    assert.equal(
      leaving.entries[0].effect.actions[0].targetRef,
      "rose_petal_floral_dragon_recover_target",
    );
  }

  const facedown = await game.effectEngine.collectCardMovedTriggers({
    card: rose,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "graveyard",
    wasFaceupBeforeMove: false,
  });
  const controlChange = await game.effectEngine.collectCardMovedTriggers({
    card: rose,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "field",
    wasFaceupBeforeMove: true,
  });
  assert.equal(facedown.entries.length, 0);
  assert.equal(controlChange.entries.length, 0);
});

test("a simulação preserva a quantidade vinculada e aplica custo antes da destruição", () => {
  const effect = getEffect("rose_petal_floral_dragon_banish_destroy");
  const source = {
    ...structuredClone(getRosePetalFloralDragon()),
    instanceId: "sim-rose",
    owner: "bot",
    controller: "bot",
  };
  const plantCost = {
    instanceId: "sim-plant",
    name: "Simulated Plant",
    cardKind: "monster",
    type: "Plant",
    owner: "bot",
    controller: "bot",
  };
  const opponentMonster = {
    instanceId: "sim-opponent-monster",
    cardKind: "monster",
    atk: 1900,
    owner: "player",
    controller: "player",
  };
  const opponentTrap = {
    instanceId: "sim-opponent-trap",
    cardKind: "trap",
    isFacedown: true,
    owner: "player",
    controller: "player",
  };
  const state = {
    bot: {
      id: "bot",
      field: [source],
      spellTrap: [],
      graveyard: [plantCost],
      banished: [],
      hand: [],
      deck: [],
      fieldSpell: null,
    },
    player: {
      id: "player",
      field: [opponentMonster],
      spellTrap: [opponentTrap],
      graveyard: [],
      banished: [],
      hand: [],
      deck: [],
      fieldSpell: null,
    },
  };
  const actions = [...effect.activationCosts, ...effect.actions];
  const selections = selectSimulatedTargets({
    targets: effect.targets,
    actions,
    state,
    sourceCard: source,
    selfId: "bot",
  });
  assert.equal(selections.rose_petal_floral_dragon_banish_cost.length, 1);
  assert.equal(selections.rose_petal_floral_dragon_destroy_targets.length, 1);

  applySimulatedActions({
    actions,
    selections,
    state,
    selfId: "bot",
    options: { sourceCard: source },
  });
  assert.equal(state.bot.banished.includes(plantCost), true);
  const activeOpponentCards = [
    ...state.player.field,
    ...state.player.spellTrap,
  ];
  assert.equal(activeOpponentCards.length, 1);
  assert.equal(state.player.graveyard.length, 1);

  const resolvedDefinitions = resolveCountFromSelectionDefinitions(
    effect.targets.filter((target) => target.intent !== "cost"),
    selections,
  );
  assert.deepEqual(resolvedDefinitions[0].count, { min: 1, max: 1 });
});
