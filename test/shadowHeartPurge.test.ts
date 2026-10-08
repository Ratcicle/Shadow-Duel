import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import Card from "../src/core/Card.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { cardDatabaseById, required, selectedCards } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext, atk = 2500) {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());
  game.turn = game.player.id;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "human";
  game.ui.showChainResponseModal = async () => null;
  const purge = new Card(required(cardDatabaseById.get(103)), game.player.id);
  const cost = new Card(required(cardDatabaseById.get(105)), game.player.id);
  const monster = (id: number, power: number) => new Card({
    id, name: `Purge target ${id}`, cardKind: "monster", atk: power, def: 1000,
    level: 4, type: "Warrior", attribute: "Dark", effects: [],
  }, game.bot.id);
  const target = monster(99001, atk);
  const other = monster(99002, 2800);
  const facedown = monster(99003, 2000);
  facedown.isFacedown = true;
  game.player.hand = [purge, cost];
  placeFieldCards(game.bot.field, target, other, facedown);
  const activate = () => game.tryActivateSpell(purge, 0, {
    purge_discard: [cost], purge_target_monster: [target],
  });
  return { game, purge, cost, target, other, facedown, activate };
}

test("Purge describes the replacement effect in three synchronized paragraphs", () => {
  assert.equal(required(cardDatabaseById.get(103)).description,
    'Discard 1 "Shadow-Heart" card, then target 1 face-up monster your opponent controls; it loses 1000 ATK.\n\nIf a monster whose ATK was reduced by this effect is destroyed this turn: All monsters your opponent controls lose 1000 ATK.\n\nYou can only activate 1 "Shadow-Heart Purge" per turn.');
  const locale = JSON.parse(readFileSync(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"));
  assert.equal(locale.cards["103"].description,
    'Descarte 1 card "Coração Sombrio" e, depois, escolha 1 monstro com a face para cima que seu oponente controla; ele perde 1000 de ATK.\n\nSe um monstro cujo ATK foi reduzido por este efeito for destruído neste turno: todos os monstros que seu oponente controla perdem 1000 de ATK.\n\nVocê só pode ativar 1 "Purificação do Coração Sombrio" por turno.');
});

test("Purge pays discard and declares its monster before responses, even if negated", async t => {
  const { game, purge, cost, target, activate } = setup(t);
  let offered = false;
  game.chainSystem.offerChainResponses = async () => {
    offered = true;
    assert.ok(game.player.graveyard.includes(cost));
    assert.equal(target.atk, 2500);
    const link = required(game.chainSystem.getLastChainLink());
    assert.deepEqual(selectedCards(link.targetSelections, "purge_target_monster"), [target]);
    game.chainSystem.markChainLinkEffectNegated(link.linkId);
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  await activate();
  assert.equal(offered, true);
  assert.ok(game.player.graveyard.includes(cost));
  assert.ok(game.player.graveyard.includes(purge));
  assert.equal(target.atk, 2500);
  assert.equal(game.temporaryEventEffects.length, 0);
});

test("Purge reduction is permanent and reaching zero does not destroy", async t => {
  const { game, purge, target, activate } = setup(t, 600);
  assert.equal((await activate()).success, true);
  assert.equal(target.atk, 0);
  assert.ok(game.bot.field.includes(target));
  assert.ok(game.player.graveyard.includes(purge));
  assert.equal(target.tempAtkBoost || 0, 0);
  cleanupTempBoosts(game.bot);
  assert.equal(target.atk, 0);
  assert.equal(game.canUseOncePerTurn(purge, game.player, required(purge.effects[0])).ok, false);
});

for (const cause of ["effect", "battle"] as const) {
  test(`Purge follows actual ${cause} destruction and reduces all face-up opponents once`, async t => {
    const { game, target, other, facedown, activate } = setup(t);
    await activate();
    assert.equal(target.atk, 1500);
    assert.equal(other.atk, 2800);
    assert.equal(game.temporaryEventEffects.length, 1);
    await game.destroyCard(target, { cause, fromZone: "field" });
    assert.equal(other.atk, 1800);
    assert.equal(other.tempAtkBoost || 0, 0);
    assert.equal(facedown.atk, 2000);
    assert.equal(game.temporaryEventEffects.length, 0);
  });
}

test("Purge does not follow a target whose ATK was already zero", async t => {
  const { game, target, other, activate } = setup(t, 0);
  await activate();
  assert.equal(game.temporaryEventEffects.length, 0);
  await game.destroyCard(target, { cause: "effect", fromZone: "field" });
  assert.equal(other.atk, 2800);
});

test("Purge expires at the end of its turn without restoring the reduction", async t => {
  const { game, target, other, activate } = setup(t);
  await activate();
  game.turnCounter += 1;
  await game.destroyCard(target, { cause: "effect", fromZone: "field" });
  assert.equal(other.atk, 2800);
  assert.equal(game.temporaryEventEffects.length, 0);
});

test("Purge forgets a monster that leaves without destruction, including after it returns", async t => {
  const { game, target, other, activate } = setup(t);
  await activate();
  await game.moveCard(target, game.bot, "hand", { fromZone: "field", awaitEvents: true });
  assert.equal(game.temporaryEventEffects.length, 0);
  game.bot.hand.splice(game.bot.hand.indexOf(target), 1);
  placeFieldCards(game.bot.field, target);
  await game.destroyCard(target, { cause: "effect", fromZone: "field" });
  assert.equal(other.atk, 2800);
});

test("Purge does not retarget when the declared target leaves in response", async t => {
  const { game, target, other, cost, activate } = setup(t);
  game.chainSystem.offerChainResponses = async () => {
    await game.moveCard(target, game.bot, "hand", { fromZone: "field", awaitEvents: true });
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  await activate();
  assert.ok(game.player.graveyard.includes(cost));
  assert.equal(other.atk, 2800);
  assert.equal(game.temporaryEventEffects.length, 0);
});

test("Purge cannot reduce an unaffected target or register its destruction follow-up", async t => {
  const { game, target, other, activate } = setup(t);
  target.unaffectedByOtherCardEffects = true;
  await activate();
  assert.equal(target.atk, 2500);
  assert.equal(game.temporaryEventEffects.length, 0);
  target.unaffectedByOtherCardEffects = false;
  await game.destroyCard(target, { cause: "effect", fromZone: "field" });
  assert.equal(other.atk, 2800);
});

test("Purge's collective reduction respects immunity without targeting recipients", async t => {
  const { game, target, other, activate } = setup(t);
  other.unaffectedByOtherCardEffects = true;
  await activate();
  await game.destroyCard(target, { cause: "effect", fromZone: "field" });
  assert.equal(other.atk, 2800);
  assert.equal(game.temporaryEventEffects.length, 0);
});

test("Purge follows destruction even when the monster is banished on leaving the field", async t => {
  const { game, target, other, activate } = setup(t);
  await activate();
  target.banishWhenLeavesField = true;
  await game.destroyCard(target, { cause: "effect", fromZone: "field" });
  assert.ok(game.bot.banished.includes(target));
  assert.equal(other.atk, 1800);
});

test("Purge does not follow rule destruction", async t => {
  const { game, target, other, activate } = setup(t);
  await activate();
  await game.destroyCard(target, { cause: "rule", fromZone: "field" });
  assert.equal(other.atk, 2800);
  assert.equal(game.temporaryEventEffects.length, 0);
});

test("Purge follows destruction in a complete battle after damage calculation", async t => {
  const { game, target, other, activate } = setup(t);
  await activate();
  const attacker = new Card({ id: 99004, name: "Purge attacker", cardKind: "monster", atk: 2000, def: 1000 }, game.player.id);
  placeFieldCards(game.player.field, attacker);
  game.phase = "battle";
  game.battleStep = "battle";
  await game.resolveCombat(attacker, target);
  assert.ok(game.bot.graveyard.includes(target));
  assert.equal(game.bot.lp, 7500);
  assert.equal(other.atk, 1800);
  assert.equal(game.temporaryEventEffects.length, 0);
});

test("Purge keeps its follow-up when destruction is prevented", async t => {
  const { game, target, other, activate } = setup(t);
  await activate();
  target.unaffectedByOtherCardEffects = true;
  await game.destroyCard(target, { cause: "effect", fromZone: "field", sourceCard: other });
  assert.ok(game.bot.field.includes(target));
  assert.equal(other.atk, 2800);
  assert.equal(game.temporaryEventEffects.length, 1);
  target.unaffectedByOtherCardEffects = false;
  await game.destroyCard(target, { cause: "effect", fromZone: "field", sourceCard: other });
  assert.equal(other.atk, 1800);
});

test("Purge preserves the follow-up across control changes and debuffs the original opponent", async t => {
  const { game, target, other, purge, activate } = setup(t);
  await activate();
  await game.takeControl(target, game.player, { sourceCard: purge });
  assert.equal(game.temporaryEventEffects.length, 1);
  await game.destroyCard(target, { cause: "effect", fromZone: "field" });
  assert.equal(other.atk, 1800);
  assert.equal(game.temporaryEventEffects.length, 0);
});
