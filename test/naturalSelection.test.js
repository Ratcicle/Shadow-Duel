import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cardDatabaseByName } from "../src/data/cards.js";

const EXPECTED_EN =
  "Discard 1 card, then target 1 face-up card your opponent controls; destroy it.\n\nYou can only activate 1 \"Natural Selection\" per turn.";
const EXPECTED_PT_BR =
  "Descarte 1 card e, depois, escolha 1 card com a face para cima que seu oponente controla; destrua-o.\n\nVocê só pode ativar 1 “Seleção Natural” por turno.";

test("Natural Selection declares its compact text and canonical transaction", async () => {
  const card = cardDatabaseByName.get("Natural Selection");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"),
  );
  assert.equal(locale.cards["21"].description, EXPECTED_PT_BR);

  const [effect] = card.effects;
  assert.equal(effect.speed, 2);
  assert.equal(effect.usagePolicy, "activate");
  assert.equal(effect.oncePerTurnName, "natural_selection_activation");
  assert.deepEqual(effect.activationCosts, [
    {
      type: "move",
      targetRef: "natural_selection_cost",
      player: "self",
      fromZone: "hand",
      to: "graveyard",
      contextLabel: "natural_selection_cost",
    },
  ]);
  assert.deepEqual(
    effect.targets.find(({ id }) => id === "natural_selection_target"),
    {
      id: "natural_selection_target",
      owner: "opponent",
      zones: ["field", "spellTrap", "fieldSpell"],
      requireFaceup: true,
      count: { min: 1, max: 1 },
    },
  );
  assert.deepEqual(effect.actions, [
    {
      type: "destroy_targeted_cards",
      targetRef: "natural_selection_target",
    },
  ]);
});
