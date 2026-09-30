import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import type { TriggerRuntimePlayer } from "../src/core/effects/triggers/runtime.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

const make = (id: number, owner = "player") => new Card(cardDefinition(id), owner);

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false });
  game.disablePresentationDelays = true;
  game.phaseDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiPresentationStepDelayMs = 0;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 2;
  t.after(() => game.dispose());
  return game;
}

test("101 Eel burns only when already face-up in Defense at attack declaration", async (t) => {
  const game = setup(t);
  const attacker = new Card({ id: 99001, name: "Attacker", cardKind: "monster", atk: 2000, def: 0, effects: [] }, "player");
  const eel = make(101, "bot");
  eel.position = "defense";
  eel.isFacedown = true;
  placeFieldCards(game.player.field, attacker);
  placeFieldCards(game.bot.field, eel);
  game.phase = "battle";
  game.battleStep = "battle";

  await game.resolveCombat(attacker, eel);
  assert.equal(game.player.lp, 8000);
});

test("101 face-up Defense Eel burns exactly 600 on attack declaration", async (t) => {
  const game = setup(t);
  const attacker = new Card({ id: 99008, name: "Attacker", cardKind: "monster", atk: 2000, def: 0, effects: [] }, "player");
  const eel = make(101, "bot");
  eel.position = "defense";
  placeFieldCards(game.player.field, attacker);
  placeFieldCards(game.bot.field, eel);
  game.phase = "battle";
  game.battleStep = "battle";

  await game.resolveCombat(attacker, eel);
  assert.equal(game.player.lp, 7400);
});

test("113 set Shield remains set without upkeep payment on its owner's Standby", async (t) => {
  const game = setup(t);
  const shield = make(113);
  game.player.hand.push(shield);
  await game.setSpellOrTrap(shield, 0, game.player);
  game.phase = "standby";
  game.turnCounter = 4;
  let prompts = 0;
  game.ui.showConfirmPrompt = async () => { prompts++; return true; };

  await game.emit("standby_phase", { player: game.player, opponent: game.bot });
  assert.equal(prompts, 0);
  assert.equal(game.player.lp, 8000);
  assert.ok(game.player.spellTrap.includes(shield));
  assert.equal(shield.isFacedown, true);
});

test("113 equipped Shield charges only during its controller's Standby", async (t) => {
  const game = setup(t);
  const shield = make(113);
  const host = make(101);
  shield.equippedTo = host;
  game.player.spellTrap.push(shield);
  placeFieldCards(game.player.field, host);
  game.player.controllerType = "human";
  game.ui.showConfirmPrompt = async () => true;
  game.phase = "standby";
  game.turnCounter = 4;

  await game.emit("standby_phase", { player: game.bot, opponent: game.player });
  assert.equal(game.player.lp, 8000);
  await game.emit("standby_phase", { player: game.player, opponent: game.bot });
  assert.equal(game.player.lp, 7200);
  assert.ok(game.player.spellTrap.includes(shield));
});

test("115 Valley destroys the original attacker after own Level 8 Shadow-Heart falls", async (t) => {
  const game = setup(t);
  const valley = make(115, "bot");
  const defender = make(111, "bot");
  const attacker = new Card({ id: 99002, name: "Strong attacker", cardKind: "monster", atk: 4000, def: 0, effects: [] }, "player");
  game.bot.fieldSpell = valley;
  placeFieldCards(game.bot.field, defender);
  placeFieldCards(game.player.field, attacker);
  game.phase = "battle";
  game.battleStep = "battle";

  await game.resolveCombat(attacker, defender);
  assert.ok(game.bot.graveyard.includes(defender));
  assert.ok(game.player.graveyard.includes(attacker));
});

test("115 Valley does not punish an effect destruction", async (t) => {
  const game = setup(t);
  const valley = make(115, "bot");
  const victim = make(111, "bot");
  const opponentMonster = new Card({ id: 99015, name: "Opponent monster", cardKind: "monster", atk: 2000, def: 0, effects: [] }, "player");
  game.bot.fieldSpell = valley;
  placeFieldCards(game.bot.field, victim);
  placeFieldCards(game.player.field, opponentMonster);

  await game.destroyCard(victim, { cause: "effect", sourceCard: opponentMonster, opponent: game.player });
  assert.ok(game.player.field.includes(opponentMonster));
});

for (const victimKind of ["wrong-level", "wrong-archetype"] as const) {
  test(`115 Valley ignores ${victimKind} battle victim`, async (t) => {
    const game = setup(t);
    game.bot.fieldSpell = make(115, "bot");
    const victim = victimKind === "wrong-level"
      ? make(101, "bot")
      : new Card({ id: 99009, name: "Other Level 8", cardKind: "monster", atk: 1000, def: 1000, level: 8, effects: [] }, "bot");
    const attacker = new Card({ id: 99010, name: "Attacker", cardKind: "monster", atk: 4000, def: 0, effects: [] }, "player");
    placeFieldCards(game.bot.field, victim);
    placeFieldCards(game.player.field, attacker);
    game.phase = "battle";
    game.battleStep = "battle";

    await game.resolveCombat(attacker, victim);
    assert.ok(game.player.field.includes(attacker));
  });
}

test("116 field copy cannot consume hand copy's battle trigger", async (t) => {
  const game = setup(t);
  const fieldWyrm = make(116, "bot");
  const handWyrm = make(116, "bot");
  const victim = make(111, "bot");
  const attacker = new Card({ id: 99003, name: "Strong attacker", cardKind: "monster", atk: 4000, def: 0, effects: [] }, "player");
  placeFieldCards(game.bot.field, fieldWyrm, victim);
  placeFieldCards(game.player.field, attacker);
  game.bot.hand.push(handWyrm);
  game.phase = "battle";
  game.battleStep = "battle";

  await game.resolveCombat(attacker, victim);
  assert.ok(game.bot.field.includes(handWyrm));
  assert.equal(game.effectEngine.checkOncePerTurn(fieldWyrm, game.bot, required(fieldWyrm.effects[0])).ok, true);
});

test("116 two hand copies each retain their per-card use", async (t) => {
  const game = setup(t);
  const first = make(116, "bot");
  const second = make(116, "bot");
  const firstVictim = make(111, "bot");
  const secondVictim = make(111, "bot");
  const firstAttacker = new Card({ id: 99011, name: "First attacker", cardKind: "monster", atk: 4000, def: 0, effects: [] }, "player");
  const secondAttacker = new Card({ id: 99012, name: "Second attacker", cardKind: "monster", atk: 4000, def: 0, effects: [] }, "player");
  game.bot.hand.push(first, second);
  placeFieldCards(game.bot.field, firstVictim, secondVictim);
  placeFieldCards(game.player.field, firstAttacker, secondAttacker);
  game.phase = "battle";
  game.battleStep = "battle";

  await game.resolveCombat(firstAttacker, firstVictim);
  await game.resolveCombat(secondAttacker, secondVictim);
  assert.ok(game.bot.field.includes(first));
  assert.ok(game.bot.field.includes(second));
});

test("116 summons from the human player's hand after a battle loss", async (t) => {
  const game = setup(t);
  game.player.controllerType = "human";
  game.ui.showChainResponseModal = async () => null;
  let confirmations = 0;
  game.ui.showConfirmPrompt = async () => { confirmations++; return true; };
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
  const wyrm = make(116);
  const victim = make(111);
  const attacker = new Card({ id: 99016, name: "Bot attacker", cardKind: "monster", atk: 4000, def: 0, effects: [] }, "bot");
  game.player.hand.push(wyrm);
  placeFieldCards(game.player.field, victim);
  placeFieldCards(game.bot.field, attacker);
  game.turn = "bot";
  game.phase = "battle";
  game.battleStep = "battle";

  await game.resolveCombat(attacker, victim);
  assert.ok(game.player.field.includes(wyrm));
  assert.ok(confirmations > 0);
});

test("116 per-card use stays spent when its Chain activation is negated", (t) => {
  const game = setup(t);
  const wyrm = make(116);
  game.player.hand.push(wyrm);
  const effect = required(wyrm.effects[0]);
  const link = required(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({
    card: wyrm,
    controller: game.player,
    effect,
    activationZone: "hand",
    committed: true,
    costsPaid: true,
  })));
  assert.ok(typeof link === "object");

  game.chainSystem.markChainLinkActivationNegated(link.linkId);
  game.chainSystem.settleUsageForChainLink(link);
  assert.equal(game.effectEngine.checkOncePerTurn(wyrm, game.player, effect).ok, false);
});

test("116 preview rejects a full field before reserving use", (t) => {
  const game = setup(t);
  const wyrm = make(116);
  game.player.hand.push(wyrm);
  for (let index = 0; index < 5; index++) {
    placeFieldCards(game.player.field, new Card({ id: 99100 + index, name: `Occupant ${index}`, cardKind: "monster", atk: 100, def: 100, effects: [] }, "player"));
  }
  const effect = required(wyrm.effects[0]);
  const result = game.effectEngine.checkActionPreviewRequirements(effect.actions || [], {
    source: wyrm,
    player: game.player,
    opponent: game.bot,
    effect,
  });
  assert.equal(result.ok, false);
  assert.equal(game.effectEngine.checkOncePerTurn(wyrm, game.player, effect).ok, true);
});

test("116 hand trigger becomes invalid if the source leaves before activation", async (t) => {
  const game = setup(t);
  const wyrm = make(116, "bot");
  const victim = make(111, "bot");
  game.bot.hand.push(wyrm);
  const effect = required(wyrm.effects[0]);
  const owner = unsafeFixture<TriggerRuntimePlayer>(game.bot, "Concrete Player has the trigger runtime capabilities; its strategy port is wider.");
  const opponent = unsafeFixture<TriggerRuntimePlayer>(game.player, "Concrete Player has the trigger runtime capabilities; its strategy port is wider.");
  const ctx = { source: wyrm, player: owner, opponent, destroyed: victim, destroyedOwner: owner };
  const entry = required(game.effectEngine.buildTriggerEntry({ sourceCard: wyrm, owner, effect, ctx }));
  await game.moveCard(wyrm, game.bot, "graveyard", { fromZone: "hand" });

  const result = await entry.config.activate(null, entry.config.activationContext);
  assert.ok(result && typeof result === "object" && "success" in result);
  assert.equal(result.success, false);
  assert.equal(game.effectEngine.checkOncePerTurn(wyrm, game.bot, effect).ok, true);
  assert.equal(game.effectEngine.buildTriggerEntry({ sourceCard: wyrm, owner, effect, ctx }), null);
});

test("116 summon restriction suppresses the hand trigger without spending its use", async (t) => {
  const game = setup(t);
  const handWyrm = make(116, "bot");
  const victim = make(111, "bot");
  const attacker = new Card({ id: 99004, name: "Strong attacker", cardKind: "monster", atk: 4000, def: 0, effects: [] }, "player");
  game.bot.hand.push(handWyrm);
  placeFieldCards(game.bot.field, victim);
  placeFieldCards(game.player.field, attacker);
  game.registerSpecialSummonRestriction(game.bot, { allowedFilters: { type: "Machine" }, duration: "until_end_turn" });
  game.phase = "battle";
  game.battleStep = "battle";

  await game.resolveCombat(attacker, victim);
  assert.ok(game.bot.hand.includes(handWyrm));
  assert.equal(game.effectEngine.checkOncePerTurn(handWyrm, game.bot, required(handWyrm.effects[0])).ok, true);
});

test("facedown board source applies no passive even when its effect omits face-up", (t) => {
  const game = setup(t);
  const source = new Card({
    id: 99005,
    name: "Hidden monster source",
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    effects: [{
      id: "hidden_status",
      timing: "passive",
      passive: {
        type: "position_status",
        activePosition: "defense",
        status: "battleIndestructible",
      },
    }],
  }, "player");
  source.position = "defense";
  source.isFacedown = true;
  placeFieldCards(game.player.field, source);

  game.effectEngine.updatePassiveBuffs();
  assert.notEqual(source.battleIndestructible, true);
});

test("turning a passive source facedown removes its previously applied status", (t) => {
  const game = setup(t);
  const source = new Card({
    id: 99014,
    name: "Status source",
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    effects: [{ id: "defense_status", timing: "passive", passive: { type: "position_status", activePosition: "defense", status: "battleIndestructible" } }],
  }, "player");
  source.position = "defense";
  placeFieldCards(game.player.field, source);
  game.effectEngine.updatePassiveBuffs();
  assert.equal(source.battleIndestructible, true);

  source.isFacedown = true;
  game.effectEngine.updatePassiveBuffs();
  assert.notEqual(source.battleIndestructible, true);
});

test("115 punishment uses the original attacking monster, even if battle destroyer differs", async (t) => {
  const game = setup(t);
  const valley = make(115, "bot");
  const defender = make(111, "bot");
  const originalAttacker = new Card({ id: 99006, name: "Original attacker", cardKind: "monster", atk: 2000, def: 0, effects: [] }, "player");
  const otherDestroyer = new Card({ id: 99007, name: "Other destroyer", cardKind: "monster", atk: 2000, def: 0, effects: [] }, "player");
  game.bot.fieldSpell = valley;
  placeFieldCards(game.player.field, originalAttacker, otherDestroyer);
  const effect = required(valley.effects[1]);

  await game.effectEngine.applyActions(effect.actions || [], {
    source: valley,
    player: game.bot,
    opponent: game.player,
    effect,
    destroyed: defender,
    attacker: otherDestroyer,
    battleAttacker: originalAttacker,
    battleAttackerOwner: game.player,
  }, {});
  assert.ok(game.player.graveyard.includes(originalAttacker));
  assert.ok(game.player.field.includes(otherDestroyer));
});

for (const returnToField of [false, true]) {
  test(`115 punishment ignores attacker after it leaves the field (returns=${returnToField})`, async (t) => {
    const game = setup(t);
    const valley = make(115, "bot");
    const defender = make(111, "bot");
    const attacker = new Card({ id: 99013, name: "Departing attacker", cardKind: "monster", atk: 2000, def: 0, effects: [] }, "player");
    game.bot.fieldSpell = valley;
    placeFieldCards(game.player.field, attacker);
    const versionAtBattle = attacker.locationVersion;
    await game.moveCard(attacker, game.player, "graveyard", { fromZone: "field" });
    if (returnToField) await game.moveCard(attacker, game.player, "field", { fromZone: "graveyard", placementActor: game.player, summonOrigin: "effect_resolution", summonMethodOverride: "special" });
    const effect = required(valley.effects[1]);

    await game.effectEngine.applyActions(effect.actions || [], {
      source: valley,
      player: game.bot,
      opponent: game.player,
      effect,
      destroyed: defender,
      attacker,
      battleAttacker: attacker,
      battleAttackerOwner: game.player,
      battleAttackerLocationVersion: versionAtBattle,
    }, {});
    if (returnToField) assert.ok(game.player.field.includes(attacker));
    else assert.ok(game.player.graveyard.includes(attacker));
  });
}
