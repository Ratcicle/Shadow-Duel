import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { cardDatabaseByName } from "../src/data/cards.js";

const EXPECTED_EN =
  "Special Summon 1 Level 4 or lower LIGHT or DARK monster from your Deck, but negate its effects. For the rest of this turn after this effect resolves, you cannot activate monster effects, except monster effects with the same Attribute as the monster Summoned by this effect.\n\nYou can only activate 1 \"Battle Between Good and Evil\" per turn.";
const EXPECTED_PT_BR =
  "Invoque por Invocação-Especial 1 monstro de LUZ ou de TREVAS de Nível 4 ou menor do seu Deck, mas negue seus efeitos. Pelo resto deste turno depois que este efeito resolver, você não pode ativar efeitos de monstros, exceto efeitos de monstros com o mesmo Atributo que o monstro Invocado por este efeito.\n\nVocê só pode ativar 1 “Batalha Entre o Bem e o Mal” por turno.";

function createCard(data, player) {
  const card = new Card(data, player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

test("Battle Between Good and Evil declares compact text and canonical filters", async () => {
  const card = cardDatabaseByName.get("Battle Between Good and Evil");
  assert.ok(card);
  assert.equal(card.description, EXPECTED_EN);

  const locale = JSON.parse(
    await readFile(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"),
  );
  assert.equal(locale.cards["25"].description, EXPECTED_PT_BR);

  const [effect] = card.effects;
  assert.equal(effect.usagePolicy, "activate");
  assert.equal(
    effect.oncePerTurnName,
    "battle_between_good_and_evil_activation",
  );
  assert.deepEqual(effect.targets[0].attribute, ["Light", "Dark"]);
  assert.equal(effect.targets[0].maxLevel, 4);
  assert.deepEqual(
    effect.actions.map(({ type }) => type),
    [
      "special_summon_from_zone",
      "restrict_effect_activations_by_attribute",
    ],
  );
  assert.equal(effect.actions[0].negateEffects, true);
  assert.equal(effect.actions[0].negateEffectsDuration, "while_faceup");
  assert.equal(effect.actions[0].haltOnFailure, true);
});

test("Battle Between Good and Evil summons, negates and restricts other Attributes", async (t) => {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
  });
  game.disablePresentationDelays = true;
  t.after(() => game.dispose());

  const spell = createCard(
    cardDatabaseByName.get("Battle Between Good and Evil"),
    game.player,
  );
  const summoned = createCard(
    {
      id: 99231,
      name: "Summoned LIGHT monster",
      cardKind: "monster",
      level: 4,
      attribute: "Light",
      effects: [{ id: "summoned_light_effect", timing: "ignition" }],
    },
    game.player,
  );
  const allowed = createCard(
    {
      id: 99232,
      name: "Other LIGHT monster",
      cardKind: "monster",
      attribute: "Light",
      effects: [{ id: "allowed_light_effect", timing: "ignition" }],
    },
    game.player,
  );
  const blocked = createCard(
    {
      id: 99233,
      name: "Blocked DARK monster",
      cardKind: "monster",
      attribute: "Dark",
      effects: [{ id: "blocked_dark_effect", timing: "ignition" }],
    },
    game.player,
  );
  game.player.spellTrap.push(spell);
  game.player.deck.push(summoned);

  const [effect] = spell.effects;
  const actions = effect.actions.map((action) =>
    action.type === "special_summon_from_zone"
      ? { ...action, position: "attack" }
      : action,
  );
  const result = await game.effectEngine.applyActions(
    actions,
    {
      source: spell,
      player: game.player,
      opponent: game.bot,
      effect,
    },
    { battle_between_good_and_evil_summon_target: [summoned] },
  );

  assert.equal(result.success, true);
  assert.equal(game.player.field.includes(summoned), true);
  assert.equal(summoned.effectsNegated, true);
  assert.equal(summoned.effectsNegatedDuration, "while_faceup");
  assert.deepEqual(
    game.player.effectActivationRestrictions[0]?.allowedAttributes,
    ["Light"],
  );
  assert.equal(
    game.canActivateCardEffectUnderRestrictions(
      allowed,
      game.player,
      allowed.effects[0],
      { silent: true },
    ).ok,
    true,
  );
  assert.equal(
    game.canActivateCardEffectUnderRestrictions(
      blocked,
      game.player,
      blocked.effects[0],
      { silent: true },
    ).code,
    "effect_activation_attribute_restricted",
  );

  game.turnCounter += 1;
  assert.equal(
    game.canActivateCardEffectUnderRestrictions(
      blocked,
      game.player,
      blocked.effects[0],
      { silent: true },
    ).ok,
    true,
  );
});
