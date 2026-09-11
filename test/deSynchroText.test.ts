import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cardDatabaseByName } from "./helpers/fixtures.js";

const EXPECTED_EN =
  'Target 1 Synchro Monster on the field; return it to the Extra Deck, then, if all the Synchro Material Monsters used for its Synchro Summon are in your GY, you can Special Summon them.\n\nYou can only activate 1 "De-Synchro" per turn.';
const EXPECTED_PT_BR =
  "Escolha 1 Monstro Sincro no campo; devolva-o ao Deck Adicional e, depois, se todos os Monstros de Matéria Sincro usados para sua Invocação-Sincro estiverem no seu Cemitério, você pode Invocá-los por Invocação-Especial.\n\nVocê só pode ativar 1 “De-Sincro” por turno.";

test("De-Synchro uses a compact paragraph break before its activation limit", async () => {
  const card = cardDatabaseByName.get("De-Synchro");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(locale.cards["19"].description, EXPECTED_PT_BR);
});
