import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { required, selectedCards } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { selectSimulatedTargets } from "../src/core/ai/common/targetSelection.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const CARD_NAME = "Transmutate";
const EFFECT_ID = "transmutate_effect";
const COST_REF = "transmutate_cost";
const TARGET_REF = "transmutate_target";

function getDefinition() {
  const definition = cardDatabaseByName.get(CARD_NAME);
  assert.ok(definition, `${CARD_NAME} must exist in the database.`);
  return definition;
}

function getEffect() {
  const effect = required(getDefinition().effects).find(
    (entry) => entry.id === EFFECT_ID,
  );
  assert.ok(effect, `${EFFECT_ID} must exist.`);
  return effect;
}

function makeMonster(
  id: number,
  name: string,
  owner: Pick<GamePlayer, "id">,
  {
    level = 4,
    currentLevel = level,
    facedown = false,
  }: { level?: number; currentLevel?: number; facedown?: boolean } = {},
) {
  const card = new Card(
    {
      id,
      name,
      cardKind: "monster",
      atk: 1000,
      def: 1000,
      level,
      type: "Warrior",
      attribute: "Earth",
      effects: [],
    },
    owner.id,
  );
  card.owner = owner.id;
  card.controller = owner.id;
  card.level = currentLevel;
  card.isFacedown = facedown;
  card.position = "attack";
  return card;
}

function makeSpell(owner: GamePlayer) {
  const card = new Card(getDefinition(), owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  return card;
}

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,

    chainResponseTimeoutMs: 1,
  });
  game.turn = game.player.id;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
  t.after(() => game.dispose("transmutate_test_complete"));
  return game;
}

test("Transmutate declara custo, alvo por Nível original e limite de ativação", () => {
  const definition = getDefinition();
  const effect = getEffect();
  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  const validation = validateCardDatabase();

  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.equal(
    definition.description,
    'Send 1 face-up monster you control to the GY, then target 1 monster in your GY with the same original Level it had, but a different name; Special Summon it. You can only activate 1 "Transmutate" per turn.',
  );
  assert.equal(effect.oncePerTurn, true);
  assert.equal(effect.oncePerTurnName, "transmutate_activation");
  assert.equal(effect.usagePolicy, "activate");
  assert.equal(required(effect.targets)[0].intent, "cost");
  assert.equal(required(effect.targets)[0].requireFaceup, true);
  assert.equal(
    required(
      required(required(effect.targets)[0].pairedTarget).compareAttribute,
    ).attr,
    "originalLevel",
  );
  assert.equal(
    required(required(effect.targets)[0].pairedTarget).excludeSameName,
    true,
  );
  assert.equal(required(effect.targets)[1].excludeNameRef, COST_REF);
  assert.deepEqual(required(effect.targets)[1].compareAttribute, {
    attr: "originalLevel",
    ref: COST_REF,
    op: "eq",
  });
  assert.equal(required(effect.activationCosts)[0].targetRef, COST_REF);
  assert.equal(required(effect.actions)[0].type, "special_summon_from_zone");
  assert.equal(required(effect.actions)[0].targetRef, TARGET_REF);
  assert.equal(
    locale.cards["7"].description,
    "Envie 1 monstro com a face para cima que você controla para o Cemitério e, depois, escolha 1 monstro no seu Cemitério com o mesmo Nível original que ele, mas com um nome diferente; Invoque o alvo por Invocação-Especial. Você só pode ativar 1 “Transmutar” por turno.",
  );
});

test("o custo usa o Nível original, é pago antes do alvo e libera a zona", async (t) => {
  const game = createGame(t);
  const spell = makeSpell(game.player);
  const cost = makeMonster(991001, "Changed Level Material", game.player, {
    level: 4,
    currentLevel: 6,
  });
  const target = makeMonster(991002, "Original Level Target", game.player, {
    level: 4,
  });
  const wrongLevel = makeMonster(991003, "Current Level Target", game.player, {
    level: 6,
  });
  const sameName = makeMonster(991004, "Changed Level Material", game.player, {
    level: 4,
  });
  const fillers = [991005, 991006, 991007, 991008].map((id) =>
    makeMonster(id, `Occupied Zone ${id}`, game.player),
  );
  game.player.hand.push(spell);
  game.player.field.push(cost, ...fillers);
  game.player.graveyard.push(target, wrongLevel, sameName);

  const preview = game.effectEngine.canActivateSpellFromHandPreview(
    spell,
    game.player,
  );
  let responseSnapshot = null;
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.getLastChainLink();
    if (link?.effectId === EFFECT_ID) {
      responseSnapshot = {
        costPaid: game.player.graveyard.includes(cost),
        declaredTarget: selectedCards(link.targetSelections, TARGET_REF)?.[0],
        costSelection: selectedCards(link.costSelections, COST_REF)?.[0],
      };
    }
    return {
      lastActivator: null,
      chainBuilt: false,
      consecutivePasses: 2,
      offers: 1,
      activations: 0,
    };
  };

  const result = await game.tryActivateSpell(spell, 0, {
    [COST_REF]: [cost],
    [TARGET_REF]: [target],
  });

  assert.ok(preview.ok === true);
  assert.ok(result.success === true);
  assert.deepEqual(responseSnapshot, {
    costPaid: true,
    declaredTarget: target,
    costSelection: cost,
  });
  assert.equal(game.player.field.includes(target), true);
  assert.equal(game.player.graveyard.includes(cost), true);
  assert.equal(game.player.graveyard.includes(wrongLevel), true);
  assert.equal(game.player.graveyard.includes(sameName), true);
  assert.equal(game.player.field.length, 5);
  assert.equal(target.lastSummonMethod, "special");
  assert.equal(target.lastSummonedFromZone, "graveyard");

  const secondCopy = makeSpell(game.player);
  const secondCost = makeMonster(991009, "Second Material", game.player);
  const secondTarget = makeMonster(991010, "Second Target", game.player);
  game.player.hand.push(secondCopy);
  game.player.field.pop();
  game.player.field.push(secondCost);
  game.player.graveyard.push(secondTarget);
  assert.ok(
    game.effectEngine.canActivateSpellFromHandPreview(secondCopy, game.player)
      .ok === false,
  );
});

test("custo face-down, mesmo nome ou Nível original diferente não tornam a ativação legal", (t) => {
  const game = createGame(t);
  const spell = makeSpell(game.player);
  const facedownCost = makeMonster(991011, "Facedown Material", game.player, {
    level: 4,
    facedown: true,
  });
  const sameName = makeMonster(991012, "Facedown Material", game.player, {
    level: 4,
  });
  const wrongLevel = makeMonster(991013, "Wrong Original Level", game.player, {
    level: 6,
  });
  game.player.hand.push(spell);
  game.player.field.push(facedownCost);
  game.player.graveyard.push(sameName, wrongLevel);

  assert.ok(
    game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok ===
      false,
  );

  facedownCost.isFacedown = false;
  assert.ok(
    game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok ===
      false,
  );
});

test("um alvo que sai do Cemitério não é substituído e o custo não é devolvido", async (t) => {
  const game = createGame(t);
  const spell = makeSpell(game.player);
  const cost = makeMonster(991014, "No Retarget Material", game.player);
  const declared = makeMonster(991015, "Declared Target", game.player);
  const replacement = makeMonster(991016, "Replacement Target", game.player);
  game.player.hand.push(spell);
  game.player.field.push(cost);
  game.player.graveyard.push(declared, replacement);

  game.chainSystem.offerChainResponses = async () => {
    const index = game.player.graveyard.indexOf(declared);
    assert.notEqual(index, -1);
    game.player.graveyard.splice(index, 1);
    game.player.banished.push(declared);
    return {
      lastActivator: null,
      chainBuilt: false,
      consecutivePasses: 2,
      offers: 1,
      activations: 0,
    };
  };

  await game.tryActivateSpell(spell, 0, {
    [COST_REF]: [cost],
    [TARGET_REF]: [declared],
  });

  assert.equal(game.player.graveyard.includes(cost), true);
  assert.equal(game.player.banished.includes(declared), true);
  assert.equal(game.player.graveyard.includes(replacement), true);
  assert.equal(game.player.field.includes(replacement), false);
});

test("a simulação escolhe custo e alvo com o mesmo contrato de Nível original", () => {
  const effect = getEffect();
  const state = simulationState();
  const self = state.bot;
  const opponent = state.player;
  const cost = simulationCard(
    makeMonster(991017, "Sim Material", self, {
      level: 4,
      currentLevel: 7,
    }),
  );
  const target = simulationCard(
    makeMonster(991018, "Sim Target", self, { level: 4 }),
  );
  const wrongLevel = simulationCard(
    makeMonster(991019, "Sim Wrong Level", self, {
      level: 7,
    }),
  );
  const sameName = simulationCard(
    makeMonster(991020, "Sim Material", self, { level: 4 }),
  );
  self.field.push(cost);
  self.graveyard.push(wrongLevel, sameName, target);

  const selections = selectSimulatedTargets({
    targets: effect.targets,
    actions: effect.actions,
    state,
    sourceCard: simulationCard({ id: 7, name: CARD_NAME, cardKind: "spell" }),
    selfId: "bot",
  });

  assert.deepEqual(selections[COST_REF], [cost]);
  assert.deepEqual(selections[TARGET_REF], [target]);

  applySimulatedActions({
    actions: [...required(effect.activationCosts), ...required(effect.actions)],
    selections,
    state,
    selfId: "bot",
    options: {
      sourceCard: simulationCard({ id: 7, name: CARD_NAME, cardKind: "spell" }),
    },
  });
  assert.equal(self.graveyard.includes(cost), true);
  assert.equal(self.field.includes(target), true);
  assert.equal(self.graveyard.includes(wrongLevel), true);
  assert.equal(self.graveyard.includes(sameName), true);
});
