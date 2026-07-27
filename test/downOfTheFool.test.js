import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cardDatabaseByName } from "../src/data/cards.js";

test("Down of the Fool preserves the requested text and Normal Summon trigger", () => {
  const card = cardDatabaseByName.get("Down of the Fool");
  assert.ok(card);

  const effect = card.effects.find(
    (entry) => entry.id === "down_of_the_fool_destroy_summoned_monster",
  );
  assert.ok(effect);
  assert.equal(effect.event, "after_summon");
  assert.equal(effect.requireOpponentSummon, true);
  assert.deepEqual(effect.summonMethods, ["normal"]);
  assert.equal(effect.targets[0].targetFromContext, "summonedCard");
  assert.equal(effect.targets[0].minAtk, 1600);
  assert.equal(effect.actions[0].type, "destroy");

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["15"].description,
    "Quando seu oponente Invocar por Invocação-Normal um monstro com 1600 ou mais de ATK: escolha esse monstro; destrua-o.",
  );
});
