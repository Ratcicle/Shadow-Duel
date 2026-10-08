import { placeFieldCards } from "./helpers/game.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card, { cardMatchesKind } from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";
import { projectTrapMonster } from "../src/core/effects/actions/summon.js";

const CARD_NAME = "Ancient Tree Spirit";

function makeCard(
  dataOrName: string | CardConstructorData,
  owner: Pick<GamePlayer, "id">,
) {
  const data =
    typeof dataOrName === "string"
      ? structuredClone(cardDefinition(dataOrName))
      : structuredClone(dataOrName);
  const card = new Card(data, owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  return card;
}

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.player.id;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.ui.showTrapActivationModal = async () => true;
  for (const participant of [game.player, game.bot] as const) {
    participant.hand = [];
    participant.deck = [];
    participant.field = [];
    participant.spellTrap = [];
    participant.graveyard = [];
  }
  t.after(() => game.dispose("ancient_tree_spirit_test"));
  return game;
}

test("Ancient Tree Spirit declares the separated text and Trap Monster contract", () => {
  const card = cardDatabaseByName.get(CARD_NAME);
  assert.ok(card);
  assert.equal(
    card.description,
    "Special Summon this card in Defense Position as an Effect Monster (Spirit/DARK/Level 4/ATK 1700/DEF 1900). This card is still treated as a Trap.\n\nIf this card is destroyed by battle after being Special Summoned this way: Inflict 500 damage to your opponent.",
  );

  const summonEffect = required(
    required(card.effects).find(
      (effect) => effect.id === "ancient_tree_spirit_summon",
    ),
  );
  assert.deepEqual(required(summonEffect.actions)[0], {
    type: "special_summon_self_as_trap_monster",
    position: "defense",
    monster: {
      type: "Spirit",
      attribute: "Dark",
      level: 4,
      atk: 1700,
      def: 1900,
    },
    treatedAsCardKinds: ["monster", "trap"],
    summonProcedure: "trap_monster",
  });

  const damageEffect = required(
    required(card.effects).find(
      (effect) => effect.id === "ancient_tree_spirit_battle_destroy_damage",
    ),
  );
  assert.equal(damageEffect.event, "battle_destroy");
  assert.equal(damageEffect.requireSelfAsDestroyed, true);
  assert.equal(damageEffect.requireSelfSummonProcedure, "trap_monster");
  assert.equal(required(required(damageEffect.actions)[0]).amount, 500);

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["16"].description,
    "Invoque este card por Invocação-Especial em Posição de Defesa como um Monstro de Efeito (Espírito/TREVAS/Nível 4/ATK 1700/DEF 1900). Este card ainda é considerado uma Armadilha.\n\nSe este card for destruído em batalha depois de ter sido Invocado por Invocação-Especial desta forma: cause 500 de dano ao seu oponente.",
  );

  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
});

test("Ancient Tree Spirit becomes a Trap Monster and inflicts damage when destroyed by battle", async (t) => {
  const game = createGame(t);
  const spirit = makeCard(CARD_NAME, game.player);
  spirit.isFacedown = true;
  spirit.setTurn = 1;
  spirit.turnSetOn = 1;
  placeFieldCards(game.player.spellTrap, spirit);

  const activation = await game.tryActivateSpellTrapEffect(spirit, null, {
    owner: game.player,
  });

  assert.ok(activation.success === true);
  assert.equal(game.player.spellTrap.includes(spirit), false);
  assert.equal(game.player.field.includes(spirit), true);
  assert.equal(spirit.cardKind, "monster");
  assert.equal(cardMatchesKind(spirit, "monster"), true);
  assert.equal(cardMatchesKind(spirit, "trap"), true);
  assert.equal(spirit.isTrapMonster, true);
  assert.equal(spirit.position, "defense");
  assert.deepEqual(
    [spirit.type, spirit.attribute, spirit.level, spirit.atk, spirit.def],
    ["Spirit", "Dark", 4, 1700, 1900],
  );
  assert.equal(spirit.lastSummonMethod, "special");
  assert.equal(spirit.lastSummonProcedure, "trap_monster");

  const attacker = makeCard(
    {
      id: 99130,
      name: "Ancient Tree Spirit attacker",
      cardKind: "monster",
      level: 4,
      atk: 2000,
      def: 1000,
      effects: [],
    },
    game.bot,
  );
  placeFieldCards(game.bot.field, attacker);
  game.turn = game.bot.id;
  game.phase = "battle";
  const opponentLpBefore = game.bot.lp;

  const result = required(await game.resolveCombat(attacker, spirit));

  assert.ok(result.ok === true);
  assert.equal(game.player.field.includes(spirit), false);
  assert.equal(game.player.graveyard.includes(spirit), true);
  assert.equal(spirit.cardKind, "trap");
  assert.equal(spirit.isTrapMonster, undefined);
  assert.equal(game.bot.lp, opponentLpBefore - 500);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
});

for (const seat of ["player", "bot"] as const) {
  test(`Ancient Tree Spirit rejects Portal's resolved restriction before revealing its Set (${seat})`, async t => {
    const game = createGame(t);
    const player = game[seat];
    game.turn = player.id;
    player.controllerType = "ai";
    const spirit = makeCard(CARD_NAME, player);
    spirit.isFacedown = true;
    spirit.setTurn = spirit.turnSetOn = 1;
    placeFieldCards(player.spellTrap, spirit);
    const discover = () => game.chainSystem.getActivatableCardsInChain(player, {
      type: "phase_change", event: "phase_end", player,
      triggerPlayer: player, openState: true, legalWindow: true,
    }).some(entry => entry.card === spirit);
    assert.equal(discover(), true);
    const portal = makeCard("Tech-Zero Summoning Portal", player);
    placeFieldCards(player.field, portal);
    const effect = required(portal.effects[0]);
    await game.effectEngine.applyActions(required(effect.actions), {
      player, source: portal, effect,
      activationContext: { decisions: { specialSummons: { [required(effect.id)]: [] } } },
    }, {});
    assert.equal(player.specialSummonRestrictions.length, 1);
    game.ensureDuelCardId(spirit);
    const original = Object.getOwnPropertyDescriptors(spirit);
    const restrictions = player.specialSummonRestrictions;
    const preview = game.effectEngine.canActivateSpellTrapEffectPreview(spirit, player, "spellTrap");
    assert.equal(preview.ok, false);
    assert.strictEqual(player.specialSummonRestrictions, restrictions);
    assert.deepEqual(Object.getOwnPropertyDescriptors(spirit), original);
    assert.equal(discover(), false);
    const activation = await game.tryActivateSpellTrapEffect(spirit, null, { owner: player });
    assert.equal(activation.success, false);
    assert.deepEqual(Object.getOwnPropertyDescriptors(spirit), original);
    assert.equal(player.spellTrap.includes(spirit), true);
    assert.equal(player.graveyard.includes(spirit), false);
  });
}

test("Trap Monster preview checks the projected monster and leaves expired restrictions untouched", t => {
  const game = createGame(t);
  const spirit = makeCard(CARD_NAME, game.player);
  spirit.isFacedown = true;
  spirit.setTurn = spirit.turnSetOn = 1;
  placeFieldCards(game.player.spellTrap, spirit);
  game.registerSpecialSummonRestriction(game.player, {
    allowedFilters: { type: "Spirit", attribute: "Dark", minLevel: 4, maxLevel: 4, minAtk: 1700, maxAtk: 1700 },
    duration: "until_end_turn",
  });
  const preview = () => game.effectEngine.canActivateSpellTrapEffectPreview(spirit, game.player, "spellTrap");
  assert.equal(preview().ok, true);
  game.registerSpecialSummonRestriction(game.player, { allowedFilters: { type: "Machine" }, duration: "until_end_turn" });
  assert.equal(preview().ok, false);
  game.turnCounter++;
  const restrictions = game.player.specialSummonRestrictions;
  const snapshot = structuredClone(restrictions);
  assert.equal(preview().ok, true);
  assert.strictEqual(game.player.specialSummonRestrictions, restrictions);
  assert.deepEqual(restrictions, snapshot);
});

test("Trap Monster projection shares configured characteristics with a legal summon from either seat", async t => {
  const game = createGame(t);
  for (const player of [game.player, game.bot]) {
    const spirit = makeCard(CARD_NAME, player);
    spirit.isFacedown = true;
    spirit.specialSummonOnlyBy = ["fusion"];
    placeFieldCards(player.spellTrap, spirit);
    const action = {
      type: "special_summon_self_as_trap_monster" as const,
      position: "defense" as const,
      summonProcedure: "fusion",
      monster: { type: "Machine", attribute: "Light" as const, level: 2, atk: 900, def: 1100 },
    };
    const before = Object.getOwnPropertyDescriptors(spirit);
    const projected = projectTrapMonster(spirit, action);
    assert.deepEqual(Object.getOwnPropertyDescriptors(spirit), before);
    assert.notStrictEqual(projected, spirit);
    assert.equal(cardMatchesKind(projected, "trap"), true);
    assert.equal(projected.isFacedown, false);
    game.registerSpecialSummonRestriction(player, { allowedFilters: {
      cardKind: "monster", type: "Machine", attribute: "Light", minLevel: 2, maxLevel: 2, minAtk: 900, maxAtk: 900,
    } });
    assert.equal(game.effectEngine.checkActionPreviewRequirements([action], { player, source: spirit }).ok, true);
    assert.equal(await game.effectEngine.applySpecialSummonSelfAsTrapMonster(action, { player, source: spirit }), true);
    for (const key of ["type", "attribute", "level", "atk", "def", "baseLevel", "baseAtk", "baseDef", "isFacedown", "cardKind", "treatedAsCardKinds"] as const) {
      assert.deepEqual(spirit[key], projected[key]);
    }
    assert.equal(spirit.lastSummonProcedure, "fusion");
    assert.equal(spirit.lastSummonedFromZone, "spellTrap");
  }
});

for (const blockedBy of ["full", "exclusive", "source_exclusive", "field_limit", "cannot_special", "procedure", "missing_source"] as const) {
  test(`Trap Monster preview and execution reject ${blockedBy} before any choice`, async t => {
    const game = createGame(t);
    const player = game.player;
    const spirit = makeCard(CARD_NAME, player);
    spirit.isFacedown = true;
    placeFieldCards(player.spellTrap, spirit);
    switch (blockedBy) {
      case "full":
        placeFieldCards(player.field, ...Array.from({ length: 5 }, () => makeCard("Tech-Zero Energy Core", player)));
        break;
      case "exclusive": placeFieldCards(player.field, makeCard("Supreme Bahamut Dragon", player)); break;
      case "source_exclusive":
        spirit.fieldPresenceRestriction = { type: "only_monster_you_control_while_faceup" };
        placeFieldCards(player.field, makeCard("Tech-Zero Energy Core", player));
        break;
      case "field_limit":
        spirit.fieldLimit = { key: "test_spirit_limit", label: "Spirit", scope: "controller", max: 1, filters: { name: CARD_NAME } };
        placeFieldCards(player.field, makeCard({ ...cardDefinition(CARD_NAME), cardKind: "monster" }, player));
        break;
      case "cannot_special": spirit.cannotBeSpecialSummoned = true; break;
      case "procedure": spirit.specialSummonOnlyBy = ["fusion"]; break;
      case "missing_source": player.spellTrap.length = 0; break;
    }
    const effect = required(spirit.effects[0]);
    const action = required(effect.actions?.[0]);
    assert.equal(action.type, "special_summon_self_as_trap_monster");
    if (action.type !== "special_summon_self_as_trap_monster") return;
    game.effectEngine.chooseSpecialSummonPosition = async () => assert.fail("No position choice for an illegal summon");
    game.prepareFieldPlacement = async () => assert.fail("No slot choice for an illegal summon");
    const before = Object.getOwnPropertyDescriptors(spirit);
    assert.equal(game.effectEngine.checkActionPreviewRequirements([action], { player, source: spirit }).ok, false);
    assert.equal(await game.effectEngine.applySpecialSummonSelfAsTrapMonster({ ...action, position: "choice" }, { player, source: spirit }), false);
    assert.deepEqual(Object.getOwnPropertyDescriptors(spirit), before);
  });
}

for (const changedDuring of ["position", "slot"] as const) {
test(`Trap Monster rechecks legality after the ${changedDuring} choice before transforming the live Trap`, async t => {
  const game = createGame(t);
  const player = game.player;
  const spirit = makeCard(CARD_NAME, player);
  placeFieldCards(player.spellTrap, spirit);
  const action = required(required(spirit.effects[0]).actions?.[0]);
  if (action.type !== "special_summon_self_as_trap_monster") return assert.fail("Expected Trap Monster action");
  game.ensureDuelCardId(spirit);
  const before = Object.getOwnPropertyDescriptors(spirit);
  const prepare = game.prepareFieldPlacement.bind(game);
  game.effectEngine.chooseSpecialSummonPosition = async () => {
    if (changedDuring === "position") {
      game.registerSpecialSummonRestriction(player, { allowedFilters: { type: "Machine" } });
    }
    return "defense";
  };
  game.prepareFieldPlacement = async (...args) => {
    assert.equal(changedDuring, "slot", "Position revalidation must reject before another prompt");
    const result = await prepare(...args);
    game.registerSpecialSummonRestriction(player, { allowedFilters: { type: "Machine" } });
    return result;
  };
  assert.equal(await game.effectEngine.applySpecialSummonSelfAsTrapMonster({ ...action, position: "choice" }, { player, source: spirit }), false);
  assert.deepEqual(Object.getOwnPropertyDescriptors(spirit), before);
  assert.equal(player.field.length, 0);
});
}

test("Restriction arriving after Trap activation prevents the summon and preserves normal Continuous Trap cleanup", async t => {
  const game = createGame(t);
  const spirit = makeCard(CARD_NAME, game.player);
  spirit.isFacedown = true;
  spirit.setTurn = spirit.turnSetOn = 1;
  placeFieldCards(game.player.spellTrap, spirit);
  let summons = 0;
  game.on("after_summon", () => { summons++; });
  const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
  let responses = 0;
  game.chainSystem.offerChainResponses = async (...args) => {
    responses++;
    game.registerSpecialSummonRestriction(game.player, { allowedFilters: { archetype: "Tech-Zero" } });
    return offer(...args);
  };
  await game.tryActivateSpellTrapEffect(spirit, null, { owner: game.player });
  assert.ok(responses > 0);
  assert.equal(summons, 0);
  assert.equal(spirit.cardKind, "trap");
  assert.equal(spirit.isTrapMonster, undefined);
  assert.equal(spirit.isFacedown, false);
  assert.equal(game.player.field.length, 0);
  assert.equal(game.player.spellTrap.includes(spirit), true);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
});
