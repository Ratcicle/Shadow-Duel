import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { cardDatabaseByName } from "../src/data/cards.js";

const EXPECTED_EN =
  "You can Special Summon this card from your hand by banishing 5 LIGHT monsters from your field and/or GY. If Summoned this way, this card cannot be destroyed by your opponent's card effects.\n\nDuring damage calculation, if this card battles an opponent's DARK monster: it gains 1000 ATK/DEF during that damage calculation only.";
const EXPECTED_PT_BR =
  "Você pode Invocar este card por Invocação-Especial da sua mão ao banir 5 monstros de LUZ do seu campo e/ou Cemitério. Se Invocado desta forma, este card não pode ser destruído por efeitos de cards do oponente.\n\nDurante o cálculo de dano, se este card batalhar um monstro de TREVAS do oponente: ele ganha 1000 ATK/DEF apenas durante esse cálculo de dano.";

function createCard(data, player) {
  const card = new Card(data, player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

test("Luminous God Hyperion declares compact text and its three effect contracts", async () => {
  const card = cardDatabaseByName.get("Luminous God Hyperion");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"),
  );
  assert.equal(locale.cards["24"].description, EXPECTED_PT_BR);

  const summon = card.effects.find(
    ({ id }) => id === "luminous_god_hyperion_special_summon",
  );
  const protection = card.effects.find(
    ({ id }) =>
      id === "luminous_god_hyperion_grant_opponent_effect_protection",
  );
  const battleEffects = card.effects.filter(({ id }) =>
    id.startsWith("luminous_god_hyperion_") && id.endsWith("_dark_boost"),
  );

  assert.deepEqual(summon.activationZones, ["hand"]);
  assert.deepEqual(summon.targets[0].zones, ["field", "graveyard"]);
  assert.equal(summon.targets[0].attribute, "Light");
  assert.deepEqual(summon.targets[0].count, { min: 5, max: 5 });
  assert.equal(protection.event, "after_summon");
  assert.equal(protection.actions[0].protectionType, "effect_destruction");
  assert.equal(protection.actions[0].sourceOwner, "opponent");
  assert.equal(protection.actions[0].duration, "while_faceup");
  assert.equal(battleEffects.length, 2);
  for (const effect of battleEffects) {
    assert.equal(effect.event, "battle_damage");
    assert.equal(effect.actions[0].atkBoost, 1000);
    assert.equal(effect.actions[0].defBoost, 1000);
    assert.equal(effect.actions[0].duration, "damage_calculation");
  }
});

test("Hyperion's battle boost requires an opponent DARK monster", (t) => {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
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
  const attackEffect = hyperion.effects.find(
    ({ id }) => id === "luminous_god_hyperion_attack_dark_boost",
  );
  const evaluate = (defender) =>
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
