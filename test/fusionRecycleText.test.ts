import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cardDatabaseByName } from "./helpers/fixtures.js";

const EXPECTED_EN =
  'Target 1 monster in your GY that was sent there as Fusion Material this turn; add it to your hand. If the added monster is Level 4 or lower, you can Special Summon it in Defense Position, but negate its effects until the end of this turn.\n\nYou can only activate 1 "Fusion Recycle" per turn.';
const EXPECTED_PT_BR =
  "Escolha 1 monstro no seu Cemitério que foi enviado para lá como Matéria de Fusão neste turno; adicione-o à sua mão. Se o monstro adicionado for de Nível 4 ou menor, você pode Invocá-lo por Invocação-Especial em Posição de Defesa, mas negue seus efeitos até o final deste turno.\n\nVocê só pode ativar 1 “Reciclar Fusão” por turno.";

test("Fusion Recycle uses a compact paragraph break before its activation limit", async () => {
  const card = cardDatabaseByName.get("Fusion Recycle");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(locale.cards["20"].description, EXPECTED_PT_BR);
});
