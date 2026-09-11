import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cardDatabaseByName } from "./helpers/fixtures.js";

test("Call of the Haunted separates activation from its destruction binding", () => {
  const card = cardDatabaseByName.get("Call of the Haunted");
  assert.ok(card);
  assert.equal(
    card.description,
    "Activate this card by targeting 1 monster in your GY; Special Summon that target in Attack Position.\n\nWhen this card leaves the field, destroy that target. When that target leaves the field, destroy this card.",
  );

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["18"].description,
    "Ative este card ao escolher 1 monstro no seu Cemitério; Invoque-o por Invocação-Especial em Posição de Ataque.\n\nQuando este card deixar o campo, destrua esse monstro. Quando esse monstro deixar o campo, destrua este card.",
  );
});
