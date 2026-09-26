import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const EXPECTED_EN =
  "You can Special Summon this card from your hand by banishing 5 LIGHT monsters from your field and/or GY. If Summoned this way, this card cannot be destroyed by your opponent's card effects.\n\nDuring damage calculation, if this card battles an opponent's DARK monster: it gains 1000 ATK/DEF during that damage calculation only.";
const EXPECTED_PT_BR =
  "Você pode Invocar este card por Invocação-Especial da sua mão ao banir 5 monstros de LUZ do seu campo e/ou Cemitério. Se Invocado desta forma, este card não pode ser destruído por efeitos de cards do oponente.\n\nDurante o cálculo de dano, se este card batalhar contra um monstro de TREVAS do oponente: ele ganha 1000 ATK/DEF apenas durante esse cálculo de dano.";

function createCard(data: CardConstructorData | undefined, player: GamePlayer) {
  assert.ok(data, "Card fixture must exist.");
  const card = new Card(data, player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

test("Luminous God Hyperion declares its hand procedure, passive protection and battle effects", async () => {
  const card = cardDatabaseByName.get("Luminous God Hyperion");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(locale.cards["24"].description, EXPECTED_PT_BR);

  const summon = required(card.handSummonProcedure);
  const protection = required(
    required(card.effects).find(
      ({ id }) =>
        id === "luminous_god_hyperion_grant_opponent_effect_protection",
    ),
  );
  const battleEffects = required(card.effects).filter(
    ({ id }) =>
      id.startsWith("luminous_god_hyperion_") && id.endsWith("_dark_boost"),
  );

  assert.deepEqual(summon.cost, {
    count: 5,
    zones: ["field", "graveyard"],
    filters: { cardKind: "monster", attribute: "Light" },
    destination: "banished",
  });
  assert.equal(required(card.effects).some(effect => effect.id === summon.id), false);
  assert.equal(protection.timing, "passive");
  assert.ok("passive" in protection);
  assert.deepEqual(protection.passive, {
    type: "conditional_protection",
    protectionType: "effect_destruction",
    requireSummonProcedure: summon.id,
    sourceOwner: "opponent",
  });
  assert.equal(battleEffects.length, 2);
  for (const effect of battleEffects) {
    assert.equal(effect.event, "damage_step");
    assert.deepEqual(effect.damageStepTimings, ["damage_calculation"]);
    assert.equal(required(required(effect.actions)[0]).atkBoost, 1000);
    assert.equal(required(required(effect.actions)[0]).defBoost, 1000);
    assert.equal(
      required(required(effect.actions)[0]).duration,
      "damage_calculation",
    );
  }
});

test("Hyperion's battle boost requires an opponent DARK monster", (t) => {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());

  const hyperion = createCard(
    cardDatabaseByName.get("Luminous God Hyperion"),
    game.player,
  );
  const darkMonster = createCard(
    {
      id: 99221,
      name: "DARK battle opponent",
      cardKind: "monster",
      attribute: "Dark",
    },
    game.bot,
  );
  const lightMonster = createCard(
    {
      id: 99222,
      name: "LIGHT battle opponent",
      cardKind: "monster",
      attribute: "Light",
    },
    game.bot,
  );
  const attackEffect = required(
    required(hyperion.effects).find(
      ({ id }) => id === "luminous_god_hyperion_attack_dark_boost",
    ),
  );
  const evaluate = (defender: Card) =>
    game.effectEngine.evaluateConditions(attackEffect.conditions, {
      source: hyperion,
      player: game.player,
      opponent: game.bot,
      attacker: hyperion,
      defender,
    }).ok;

  assert.equal(evaluate(darkMonster), true);
  assert.equal(evaluate(lightMonster), false);
});

for (const role of ["attacker", "defender"] as const) {
  test(`Hyperion boosts only during damage calculation as ${role}`, async (t) => {
    const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
    t.after(() => game.dispose());
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.phase = "battle";
    game.battleStep = "battle";
    game.turnCounter = 2;
    game.turn = role === "attacker" ? game.player.id : game.bot.id;
    game.player.controllerType = "ai";
    game.bot.controllerType = "ai";
    const hyperion = createCard(cardDatabaseByName.get("Luminous God Hyperion"), game.player);
    const darkMonster = createCard({
      id: 99223, name: "DARK combat opponent", cardKind: "monster",
      attribute: "Dark", atk: 3500, def: 2000,
    }, game.bot);
    hyperion.position = role === "attacker" ? "attack" : "defense";
    darkMonster.position = "attack";
    game.player.field.push(hyperion);
    game.bot.field.push(darkMonster);

    const boosts: Array<{ timing: string | null; atk: number; def: number }> = [];
    const applyActions = game.effectEngine.applyActions.bind(game.effectEngine);
    game.effectEngine.applyActions = async (actions, ctx, targets) => {
      const result = await applyActions(actions, ctx, targets);
      if (ctx.source === hyperion && actions.some(action => action.type === "buff_stats_temp")) {
        boosts.push({
          timing: game.activeDamageStepTransaction?.timing || null,
          atk: hyperion.atk, def: hyperion.def,
        });
      }
      return result;
    };
    const afterCalculationStats: number[][] = [];
    game.on("damage_step_outcome", () => {
      afterCalculationStats.push([hyperion.atk, hyperion.def]);
    });

    await game.resolveCombat(
      role === "attacker" ? hyperion : darkMonster,
      role === "attacker" ? darkMonster : hyperion,
    );

    assert.deepEqual(boosts, [{ timing: "damage_calculation", atk: 4000, def: 4000 }]);
    assert.deepEqual(afterCalculationStats, [[3000, 3000]]);
    assert.equal(game.player.field.includes(hyperion), true);
    assert.equal(game.player.lp, 8000);
    assert.equal(game.bot.lp, 7500);
    assert.equal(hyperion.atk, 3000);
    assert.equal(hyperion.def, 3000);
  });
}
