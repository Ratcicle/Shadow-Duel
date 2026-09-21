import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Card from "../src/core/Card.js";
import { createRuntimeGame } from "./helpers/game.js";
import { cardDefinition, required } from "./helpers/fixtures.js";

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

for (const monsterType of ["fusion", "synchro", "ascension"] as const) {
  test(`Fusion Recycle returns a ${monsterType} material to the Extra Deck without offering a summon`, async (t) => {
    const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
    t.after(() => game.dispose());
    game.turn = "player";
    game.phase = "main1";
    game.turnCounter = 2;
    game.disablePresentationDelays = true;
    game.player.controllerType = "human";
    game.bot.controllerType = "human";
    const material = new Card({
      id: 99901, name: `${monsterType} material`, cardKind: "monster",
      monsterType, level: 4, atk: 1000, def: 1000, effects: [],
    }, "player");
    const spell = new Card(cardDefinition("Fusion Recycle"), "player");
    game.player.field.push(material);
    game.player.hand.push(spell);
    await game.moveCard(material, game.player, "graveyard", {
      fromZone: "field", contextLabel: "fusion_material",
    });
    const effect = required(spell.effects[0]);
    const targetDefinition = required(required(effect.targets)[0]);
    const context = { player: game.player, opponent: game.bot, source: spell };
    const legalTargets = game.effectEngine.resolveTargets([targetDefinition], context, null);
    assert.notEqual(legalTargets.ok, false, "Extra Deck material must be a legal target");
    let prompts = 0;
    game.ui.showConfirmPrompt = async () => { prompts += 1; return true; };
    const result = await game.tryActivateSpell(spell, 0, {
      fusion_recycle_target: [material],
    }, { owner: game.player });
    assert.equal(result.success, true);
    assert.ok(game.player.extraDeck.includes(material));
    assert.equal(game.player.hand.includes(material), false);
    assert.equal(game.player.field.includes(material), false);
    assert.equal(game.player.graveyard.includes(material), false);
    assert.equal(prompts, 0, "Returning to Extra Deck must not offer the optional summon");
  });
}

for (const invalidCase of ["no material history", "Synchro Material", "previous turn", "opponent Graveyard"] as const) {
  test(`Fusion Recycle still rejects ${invalidCase}`, async (t) => {
    const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
    t.after(() => game.dispose());
    game.turn = "player";
    game.phase = "main1";
    game.turnCounter = 2;
    game.disablePresentationDelays = true;
    const owner = invalidCase === "opponent Graveyard" ? game.bot : game.player;
    const material = new Card(cardDefinition("Shadow-Heart Warlord"), owner.id);
    const spell = new Card(cardDefinition("Fusion Recycle"), "player");
    owner.field.push(material);
    game.player.hand.push(spell);
    await game.moveCard(material, owner, "graveyard", {
      fromZone: "field",
      contextLabel: invalidCase === "no material history" ? "test_move"
        : invalidCase === "Synchro Material" ? "synchro_material" : "fusion_material",
    });
    if (invalidCase === "previous turn") game.turnCounter += 1;
    assert.equal(game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok, false);
  });
}
