import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Player from "../src/core/Player.js";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { FastEffectContextInput } from "../src/core/contracts/chainRuntime.js";
import { normalizeZoneInput } from "../src/core/contracts/zones.js";
import { createTestCandidate } from "./chain/helpers/chainHarness.js";
import {
  array,
  chainSelections,
  objectResult,
  required,
  selectedCards,
} from "./helpers/fixtures.js";
import {
  runtimeCard as completeCard,
  createRuntimeGame,
} from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { evaluateSimulatedConditions } from "../src/core/ai/common/simulatedConditions.js";
import { selectSimulatedTargets } from "../src/core/ai/common/targetSelection.js";
import { resolveCountFromSelectionDefinitions } from "../src/core/chain/selection.js";
import {
  createChainHarness,
  createTestCard,
  placeCard,
} from "./chain/helpers/chainHarness.js";
import { cardDatabaseById } from "./helpers/fixtures.js";

const ROSE_PETAL_FLORAL_DRAGON_ID = 28;
const EXPECTED_EN =
  '1 Plant Tuner + 1+ non-Tuner monsters\n\nIf your opponent controls more cards than you do: You can banish 1 to 3 Plant monsters from your GY, then target the same number of cards your opponent controls; destroy them.\n\nIf this card leaves the field: You can target 1 Plant monster in your GY; add it to your hand.\n\nYou can only use each effect of "Rose Petal Floral Dragon" once per turn.';
const EXPECTED_PT_BR =
  "1 Regulador Planta + 1+ monstros não-Reguladores\n\nSe seu oponente controlar mais cards que você: você pode banir de 1 a 3 monstros Planta do seu Cemitério e, depois, escolher o mesmo número de cards que seu oponente controla; destrua-os.\n\nSe este card deixar o campo: você pode escolher 1 monstro Planta no seu Cemitério; adicione-o à sua mão.\n\nVocê só pode usar cada efeito de “Dragão Floral de Pétalas de Rosa” uma vez por turno.";

function getRosePetalFloralDragon() {
  const card = cardDatabaseById.get(ROSE_PETAL_FLORAL_DRAGON_ID);
  assert.ok(card, "Rose Petal Floral Dragon must be in the card database");
  return card;
}

function getEffect(id: string) {
  const effect = required(getRosePetalFloralDragon().effects).find(
    (entry) => entry.id === id,
  );
  assert.ok(effect, `Expected effect ${id}.`);
  return effect;
}

function makeRuntimeCard(definition: CardConstructorData, ownerId: string) {
  const card = new Card(definition, ownerId);
  card.owner = ownerId;
  card.controller = ownerId;
  return card;
}

test("Rose Petal Floral Dragon declara Sincro, custo acoplado e Trigger canônicos", async () => {
  const card = getRosePetalFloralDragon();
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  assert.equal(card.name, "Rose Petal Floral Dragon");
  assert.equal(card.description, EXPECTED_EN);
  const locale = JSON.parse(
    await readFile(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards[String(ROSE_PETAL_FLORAL_DRAGON_ID)].description,
    EXPECTED_PT_BR,
  );
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
  assert.equal(required(ignition.targets)[0].intent, "cost");
  assert.equal(
    required(ignition.targets)[1].countFromSelectionRef,
    required(ignition.targets)[0].id,
  );
  assert.equal(required(ignition.targets)[1].minAtResolution, 0);
  assert.equal(required(ignition.activationCosts)[0].type, "banish");
  assert.equal(required(ignition.actions)[0].type, "destroy_targeted_cards");

  const recovery = getEffect("rose_petal_floral_dragon_leave_field_recover");
  assert.equal(recovery.event, "card_moved");
  assert.equal(recovery.fromZone, "field");
  assert.equal(recovery.requireSelfAsMoved, true);
  assert.equal(recovery.requireMovedCardWasFaceup, true);
  assert.equal(recovery.usagePolicy, "use");
  assert.equal(required(recovery.actions)[0].type, "move");
  assert.equal(required(recovery.actions)[0].to, "hand");
});

test("materiais exigem Regulador Planta e aceitam não-Reguladores livres", (t) => {
  const rose = completeCard({
    ...getRosePetalFloralDragon(),
    instanceId: "rose",
  });
  const plantTuner = completeCard({
    instanceId: "plant-tuner",
    cardKind: "monster",
    isTuner: true,
    type: "Plant",
    level: 3,
    isFacedown: false,
  });
  const dragonTuner = completeCard({
    instanceId: "dragon-tuner",
    cardKind: "monster",
    isTuner: true,
    type: "Dragon",
    level: 3,
    isFacedown: false,
  });
  const nonTuner = completeCard({
    instanceId: "non-tuner",
    cardKind: "monster",
    isTuner: false,
    type: "Rock",
    level: 4,
    isFacedown: false,
  });
  const player = Object.assign(new Player("player", "Material fixture"), {
    field: [plantTuner, dragonTuner, nonTuner],
  });
  const game = createRuntimeGame({
    disableChains: true,
    captureReplay: false,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());

  assert.deepEqual(game.getSynchroMaterialCombos(player, rose), [
    [plantTuner, nonTuner],
  ]);
});

test("a comparação de cards controlados tem a mesma legalidade no runtime e na simulação", (t) => {
  const game = createRuntimeGame({
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
  assert.ok(
    game.effectEngine.evaluateConditions(condition, {
      source: rose,
      player: game.player,
      opponent: game.bot,
    }).ok === true,
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
  assert.ok(
    game.effectEngine.evaluateConditions(condition, {
      source: rose,
      player: game.player,
      opponent: game.bot,
    }).ok === false,
  );
});

test("a transação bane o custo antes dos alvos e limita o custo à capacidade de destruição", async () => {
  let harness: ReturnType<typeof createChainHarness>;
  harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      for (const action of actions || []) {
        if (action.type !== "banish") continue;
        for (const card of selectedCards(targets, required(action.targetRef))) {
          await harness.game.moveCard(card, harness.player, "banished", {
            fromZone: normalizeZoneInput(action.fromZone || "graveyard"),
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

  const context: FastEffectContextInput = {
    type: "main_phase_action",
    event: "main_phase_action",
    player,
    triggerPlayer: player,
    openState: true,
    legalWindow: true,
  };
  const effect = getEffect("rose_petal_floral_dragon_banish_destroy");
  // This transaction test starts with an accepted offer; discovery has its own suite.
  chain.revalidateActivationCandidate = (candidate) => ({
    ok: true,
    candidate,
  });
  const preparedResult = await chain.prepareChainResponse(
    createTestCandidate(chain, player, {
      card: source,
      effect,
      effectId: effect.id,
      sourceZone: "field",
      sourceLocationVersion: 0,
      context,
    }),
    player,
    context,
  );

  assert.ok(preparedResult.success === true);
  const prepared = required(preparedResult.preparedActivation);
  assert.equal(player.banished.length, 2);
  assert.equal(player.graveyard.length, 1);
  assert.equal(
    selectedCards(
      prepared.costSelections,
      "rose_petal_floral_dragon_banish_cost",
    ).length,
    2,
  );
  assert.equal(
    selectedCards(
      prepared.targetSelections,
      "rose_petal_floral_dragon_destroy_targets",
    ).length,
    2,
  );
  assert.deepEqual(
    selectedCards(
      prepared.targetSelections,
      "rose_petal_floral_dragon_destroy_targets",
    ),
    [monsterTarget, facedownTrapTarget],
  );
  assert.equal(required(trace.actions)[0].action.type, "banish");

  const link = required(chain.addToChain(prepared));
  assert.doesNotThrow(() => JSON.stringify(chain.getChainSummary()));
  assert.equal(
    selectedCards(
      link.targetSelections,
      "rose_petal_floral_dragon_destroy_targets",
    ).length,
    selectedCards(link.costSelections, "rose_petal_floral_dragon_banish_cost")
      .length,
  );
  assert.deepEqual(link.resolvedSelectionCounts, {
    rose_petal_floral_dragon_destroy_targets: 2,
  });
  assert.deepEqual(chain.getChainSummary()[0].resolvedSelectionCounts, {
    rose_petal_floral_dragon_destroy_targets: 2,
  });
});

test("minAtResolution preserva os alvos restantes sem retarget", async () => {
  const resolvedTargetIds: Array<string | number | null | undefined> = [];
  const harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      if (actions.some((action) => action.type === "destroy_targeted_cards")) {
        resolvedTargetIds.push(
          ...selectedCards(
            targets,
            "rose_petal_floral_dragon_destroy_targets",
          ).map((card) => card.instanceId),
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
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: source,
        controller: player,
        effect,
        activationZone: "field",
        costSelections: chainSelections({
          rose_petal_floral_dragon_banish_cost: [],
        }),
        targetSelections: chainSelections({
          rose_petal_floral_dragon_destroy_targets: [
            movedTarget,
            remainingTarget,
          ],
        }),
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  await game.moveCard(movedTarget, bot, "graveyard", { fromZone: "field" });
  const result = objectResult(await chain.resolveChain());

  assert.ok(result.success === true);
  assert.deepEqual(resolvedTargetIds, ["remaining-target"]);
  assert.equal(required(link.targetValidation).satisfiesMinimums, true);
  assert.equal(required(link.targetValidation).groups[0].minimum, 0);
});

test("o Trigger de deixar o campo exige face-up, cobre todos os destinos e ignora troca de controle", async (t) => {
  const game = createRuntimeGame({
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

  for (const toZone of [
    "graveyard",
    "hand",
    "deck",
    "banished",
    "extraDeck",
  ] as const) {
    const leaving = await game.effectEngine.collectCardMovedTriggers({
      card: rose,
      fromPlayer: game.player,
      toPlayer: game.player,
      player: game.player,
      opponent: game.bot,
      fromZone: "field",
      toZone,
      wasFaceupBeforeMove: true,
    });
    assert.equal(
      leaving.entries.length,
      1,
      `Expected Trigger when moving to ${toZone}.`,
    );
    assert.equal(
      leaving.entries[0].effect.id,
      "rose_petal_floral_dragon_leave_field_recover",
    );
    assert.equal(
      Reflect.get(required(leaving.entries[0].effect.actions)[0], "targetRef"),
      "rose_petal_floral_dragon_recover_target",
    );
  }

  const facedown = await game.effectEngine.collectCardMovedTriggers({
    card: rose,
    fromPlayer: game.player,
    toPlayer: game.player,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "graveyard",
    wasFaceupBeforeMove: false,
  });
  const controlChange = await game.effectEngine.collectCardMovedTriggers({
    card: rose,
    fromPlayer: game.player,
    toPlayer: game.player,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "field",
    wasFaceupBeforeMove: true,
  });
  assert.equal(facedown.entries.length, 0);
  assert.equal(controlChange.entries.length, 0);
});

test("o Trigger de deixar o campo recupera a Planta e encerra o timing", async (t) => {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.turn = game.player.id;
  game.phase = "main1";
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose());

  const rose = makeRuntimeCard(getRosePetalFloralDragon(), game.player.id);
  const plant = makeRuntimeCard(
    {
      id: 9821,
      name: "Recovered Plant",
      cardKind: "monster",
      type: "Plant",
      attribute: "Earth",
      level: 3,
    },
    game.player.id,
  );
  game.player.field.push(rose);
  game.player.graveyard.push(plant);

  const moved = await game.moveCard(rose, game.player, "banished", {
    fromZone: "field",
    awaitEvents: true,
  });

  assert.ok(moved.success === true);
  assert.equal(game.player.banished.includes(rose), true);
  assert.equal(game.player.hand.includes(plant), true);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
  assert.equal(game.targetSelection, null);
});

test("a simulação preserva a quantidade vinculada e aplica custo antes da destruição", () => {
  const effect = getEffect("rose_petal_floral_dragon_banish_destroy");
  const source = simulationCard({
    ...structuredClone(getRosePetalFloralDragon()),
    instanceId: "sim-rose",
    owner: "bot",
    controller: "bot",
  });
  const plantCost = simulationCard({
    instanceId: "sim-plant",
    name: "Simulated Plant",
    cardKind: "monster",
    type: "Plant",
    owner: "bot",
    controller: "bot",
  });
  const opponentMonster = simulationCard({
    instanceId: "sim-opponent-monster",
    cardKind: "monster",
    atk: 1900,
    owner: "player",
    controller: "player",
  });
  const opponentTrap = simulationCard({
    instanceId: "sim-opponent-trap",
    cardKind: "trap",
    isFacedown: true,
    owner: "player",
    controller: "player",
  });
  const state = simulationState({
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
  });
  const actions = [
    ...required(effect.activationCosts),
    ...required(effect.actions),
  ];
  const selections = selectSimulatedTargets({
    targets: effect.targets,
    actions,
    state,
    sourceCard: source,
    selfId: "bot",
  });
  assert.equal(
    array(selections.rose_petal_floral_dragon_banish_cost).length,
    1,
  );
  assert.equal(
    array(selections.rose_petal_floral_dragon_destroy_targets).length,
    1,
  );

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
    required(effect.targets).filter((target) => target.intent !== "cost"),
    selections,
  );
  assert.deepEqual(resolvedDefinitions[0].count, { min: 1, max: 1 });
});
