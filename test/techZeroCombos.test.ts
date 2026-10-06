import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { SelectionResult } from "../src/core/contracts/selection.js";
import { getBotDeckList, getBotExtraDeckList } from "../src/core/bot/presets.js";
import { cardDefinition, required, selectionKey } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

type Actor = "player" | "bot";
type Combo = "lancer" | "raptor" | "wyvern";

function createScenario(t: TestContext, actor: Actor) {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose("tech_zero_combo_test_complete"));
  const player = game[actor];
  game.turn = actor;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  for (const participant of [game.player, game.bot]) {
    participant.controllerType = "ai";
    // These tests prescribe decisions instead of exercising an archetype policy.
    participant.strategy = null;
  }
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
  const make = (id: number) => new Card(cardDefinition(id), player.id);
  const moves: string[] = [];
  const summons: Array<{ id: number | null; method: string; from: string }> = [];
  const drawEvents: Array<{ ids: number[]; sourceId: number }> = [];
  const fieldSizes: number[] = [];
  game.on("card_moved", ({ card, fromZone, toZone }) => {
    moves.push(`${card.id}:${fromZone}->${toZone}`);
    fieldSizes.push(player.field.length);
  });
  game.on("after_summon", ({ card, method, fromZone }) => {
    summons.push({ id: card.id ?? null, method, from: fromZone });
    fieldSizes.push(player.field.length);
  });
  game.on("cards_added_to_hand", ({ cards, fromZone, sourceCard }) => {
    if (fromZone === "deck") {
      drawEvents.push({ ids: cards.map(card => required(card.id)), sourceId: required(sourceCard?.id) });
    }
  });
  return { game, player, make, moves, summons, drawEvents, fieldSizes };
}

type Scenario = ReturnType<typeof createScenario>;

function prepareCombo(scenario: Scenario, combo: Combo, drawIds: readonly number[]) {
  const { game, player, make } = scenario;
  const main = getBotDeckList("techzero").map(make);
  const take = (id: number) => {
    const index = main.findIndex(card => card.id === id);
    assert.ok(index >= 0, `preset must contain card ${id}`);
    return required(main.splice(index, 1)[0]);
  };
  const core = take(501);
  const catapult = take(502);
  player.hand.push(catapult, core);
  const extension = combo === "lancer" ? null : take(combo === "raptor" ? 505 : 504);
  if (extension) player.hand.push(extension);
  const draws = drawIds.map(take);
  player.deck.push(...main, ...draws.slice().reverse());
  player.extraDeck.push(...getBotExtraDeckList("techzero").map(make));
  const extra = (id: number) => required(player.extraDeck.find(card => card.id === id));
  const cards = {
    core, catapult, extension,
    multimodal: extra(503), portal: extra(509), slasher: extra(510),
    mage: extra(512), phoenix: extra(514), lancer: extra(516), singularity: extra(517),
  };

  const fallbackSelect = game.autoSelector.select.bind(game.autoSelector);
  game.autoSelector.select = (contract, context) => {
    assert.ok(contract && "requirements" in contract && Array.isArray(contract.requirements));
    const result = fallbackSelect(contract, context);
    assert.ok(result.ok, "the real selection contract must have enough candidates");
    const selections: SelectionResult = { ...result.selections };
    for (const requirement of contract.requirements) {
      const id = required(requirement.id);
      const candidates = requirement.candidates ?? [];
      let chosen;
      if (id === "action_case_choice") {
        chosen = candidates.find(candidate => candidate.key?.endsWith(":decrease")) ??
          candidates.find(candidate => candidate.key?.endsWith(":decrease_2"));
      } else if (id === "tech_zero_energy_core_level_down_target") {
        chosen = candidates.find(candidate => candidate.cardRef === catapult);
      } else if (id === "tech_zero_multimodal_machine_level_target") {
        chosen = candidates.find(candidate => candidate.cardRef === cards.multimodal);
      } else if (id === "tech_zero_electrocatapult_summon_choice") {
        chosen = candidates.find(candidate => candidate.cardRef === core);
      } else if (id === "tech_zero_electrocatapult_tuner_target") {
        const revive = combo === "wyvern" && player.graveyard.includes(cards.multimodal)
          ? cards.multimodal : core;
        chosen = candidates.find(candidate => candidate.cardRef === revive);
      } else {
        continue;
      }
      selections[id] = [selectionKey(required(required(chosen, id).key))];
    }
    return { ok: true, selections };
  };
  return { ...cards, draws };
}

async function synchro(scenario: Scenario, destination: Card, materials: Card[]) {
  const { game, player, moves } = scenario;
  const before = moves.length;
  const result = await game.performSynchroSummonFromExtraDeck(destination, player, {
    materials,
  });
  assert.equal(result.success, true, `Synchro Summon ${destination.name}`);
  assert.ok(player.field.includes(destination));
  assert.deepEqual(moves.slice(before, before + materials.length + 1), [
    ...materials.map(card => `${card.id}:field->graveyard`),
    `${destination.id}:extraDeck->field`,
  ], "materials move individually before the new Synchro enters");
}

async function reachPortal(scenario: Scenario, cards: ReturnType<typeof prepareCombo>, combo: Combo) {
  const { game, player } = scenario;
  const { core, catapult, multimodal, portal, extension } = cards;
  assert.equal(required(await game.performNormalSummon(player, 0)).success, true);
  assert.equal(catapult.level, 2);
  assert.equal(core.level, 1);
  await synchro(scenario, multimodal, [core, catapult]);
  assert.deepEqual(player.hand, [
    ...(combo === "wyvern" ? [required(extension)] : []), required(cards.draws[0]),
  ]);
  assert.deepEqual(scenario.drawEvents, [{ ids: [required(cards.draws[0]).id], sourceId: core.id }]);
  assert.ok(player.field.includes(core));
  assert.equal(core.effectsNegated, true);
  if (combo === "wyvern") {
    assert.equal((await game.performHandSummonProcedure(required(extension), player, { position: "attack" })).success, true);
  }
  assert.equal((await game.tryActivateMonsterEffect(multimodal, null, "field", player, {
    effectId: "tech_zero_multimodal_machine_level_mod",
  })).success, true);
  assert.equal(multimodal.level, 1);
  await synchro(scenario, portal, [core, multimodal]);
  assert.equal(multimodal.level, 3, "leaving the field clears the previous level adjustment");
  assert.equal(catapult.level, 3);
  assert.equal(Boolean(core.effectsNegated), false, "Portal revives Core without Catapult's negation");
  assert.deepEqual(new Set(player.field), new Set([
    portal, multimodal, catapult, core, ...(extension ? [extension] : []),
  ]));
  assert.deepEqual(player.hand, cards.draws, "both draws remain unused in the hand");
}

for (const actor of ["player", "bot"] as const) {
  test(`negated Multimodal cannot substitute for a non-Tuner (${actor})`, async (t) => {
    const scenario = createScenario(t, actor);
    const { game, player, make, moves } = scenario;
    const core = make(501);
    const multimodal = make(503);
    const slasher = make(510);
    placeFieldCards(player.field, core, multimodal);
    player.extraDeck.push(slasher);
    assert.equal(game.getSynchroMaterialCombos(player, slasher).length, 1);

    multimodal.effectsNegated = true;
    multimodal.effectsNegatedDuration = "while_faceup";
    const result = await game.performSynchroSummonFromExtraDeck(slasher, player, {
      materials: [core, multimodal],
    });
    assert.equal(result.success, false);
    assert.deepEqual(player.field, [core, multimodal]);
    assert.deepEqual(player.extraDeck, [slasher]);
    assert.deepEqual(player.graveyard, []);
    assert.deepEqual(moves, []);
  });

  test(`five occupied zones block Wyvern without spending its turn limit (${actor})`, async (t) => {
    const { game, player, make } = createScenario(t, actor);
    const core = make(501);
    placeFieldCards(player.field, core, make(502), make(505), make(506), make(508));
    const wyvern = make(504);
    player.hand.push(wyvern);
    const activate = () => game.performHandSummonProcedure(wyvern, player, { position: "attack" });
    assert.equal((await activate()).success, false);
    assert.deepEqual(player.hand, [wyvern]);
    assert.equal(player.field.length, 5);

    await game.moveCard(core, player, "graveyard", { fromZone: "field" });
    assert.equal((await activate()).success, true);
    assert.deepEqual(player.hand, []);
    assert.ok(player.field.includes(wyvern));
    assert.equal(player.field.length, 5);
  });

  test(`two Core copies share the Synchro draw limit (${actor})`, async (t) => {
    const scenario = createScenario(t, actor);
    const { game, player, make, drawEvents } = scenario;
    const first = make(501);
    const second = make(501);
    const catapult = make(502);
    const wyvern = make(504);
    const slasher = make(510);
    const ghost = make(511);
    placeFieldCards(player.field, first, catapult, second, wyvern);
    player.extraDeck.push(slasher, ghost);
    player.deck.push(make(518), make(519), make(520));
    // Decline recovery so neither optional effect changes the isolated draw count.
    game.autoSelector.orderTriggerCandidates = candidates => candidates.filter(candidate =>
      candidate.effect.id !== "tech_zero_electrocatapult_synchro_revive" &&
      candidate.effect.id !== "tech_zero_ghost_samurai_synchro_recover_tuner");

    await synchro(scenario, slasher, [first, catapult]);
    const drawn = required(player.hand[0]);
    assert.equal(player.hand.length, 1);
    assert.equal(player.deck.length, 2);
    await synchro(scenario, ghost, [second, wyvern]);
    assert.deepEqual(player.hand, [drawn]);
    assert.equal(player.deck.length, 2);
    assert.deepEqual(drawEvents, [{ ids: [drawn.id], sourceId: first.id }]);
    assert.ok(player.graveyard.includes(first) && player.graveyard.includes(second));
  });

  test(`two Core copies share the level adjustment limit (${actor})`, async (t) => {
    const { game, player, make } = createScenario(t, actor);
    const connector = make(507);
    const first = make(501);
    const second = make(501);
    const firstCatapult = make(502);
    const secondCatapult = make(502);
    placeFieldCards(player.field, connector);
    player.hand.push(firstCatapult, first, secondCatapult, second);
    let adjustmentChoices = 0;
    const fallbackSelect = game.autoSelector.select.bind(game.autoSelector);
    game.autoSelector.select = (contract, context) => {
      assert.ok(contract && "requirements" in contract && Array.isArray(contract.requirements));
      const result = fallbackSelect(contract, context);
      assert.ok(result.ok);
      for (const requirement of contract.requirements) {
        const candidates = requirement.candidates ?? [];
        if (requirement.id === "action_case_choice") {
          const increase = required(candidates.find(candidate => candidate.key?.endsWith(":increase")));
          result.selections[requirement.id] = [selectionKey(required(increase.key))];
          adjustmentChoices += 1;
        } else if (requirement.id === "tech_zero_energy_core_level_up_target") {
          const target = required(candidates.find(candidate => candidate.cardRef === connector));
          result.selections[requirement.id] = [selectionKey(required(target.key))];
        }
      }
      return result;
    };

    assert.equal(required(await game.performNormalSummon(player, 0)).success, true);
    assert.equal(connector.level, 6);
    assert.equal(adjustmentChoices, 1);
    // Connector's active passive supplies the second Normal Summon.
    assert.equal(required(await game.performNormalSummon(player, player.hand.indexOf(secondCatapult))).success, true);
    assert.ok(player.field.includes(first) && player.field.includes(second));
    assert.equal(connector.level, 6);
    assert.equal(adjustmentChoices, 1);
    assert.deepEqual(player.hand, []);
  });

  test(`two Raptor copies share the hand extension limit (${actor})`, async (t) => {
    const { game, player, make } = createScenario(t, actor);
    const core = make(501);
    const catapult = make(502);
    const first = make(505);
    const second = make(505);
    player.graveyard.push(core);
    player.hand.push(catapult, first, second);

    assert.equal(required(await game.performNormalSummon(player, 0)).success, true);
    assert.ok(player.field.includes(core) && player.field.includes(catapult));
    assert.equal(player.field.filter(card => card === first || card === second).length, 1);
    assert.equal(player.hand.filter(card => card === first || card === second).length, 1);
    assert.equal(player.field.length, 3, "space remains for the blocked second copy");
  });

  test(`two Raptor copies share the token generation limit (${actor})`, async (t) => {
    const scenario = createScenario(t, actor);
    const { game, player, make, summons } = scenario;
    const first = make(505);
    const second = make(505);
    const catapult = make(502);
    const prism = make(506);
    const kaiser = make(513);
    const mage = make(512);
    placeFieldCards(player.field, first, catapult, second, prism);
    player.extraDeck.push(kaiser, mage);
    game.autoSelector.orderTriggerCandidates = candidates => candidates.filter(candidate =>
      candidate.effect.id !== "tech_zero_electrocatapult_synchro_revive" &&
      candidate.effect.id !== "tech_zero_turbocharge_kaiser_synchro_recycle_buff");

    await synchro(scenario, kaiser, [first, catapult]);
    const tokens = player.field.filter(card => card.isToken);
    assert.equal(tokens.length, 2);
    for (const token of tokens) {
      await game.moveCard(token, player, "graveyard", { fromZone: "field" });
    }
    await synchro(scenario, mage, [second, prism]);
    assert.equal(player.field.some(card => card.isToken), false);
    assert.equal(player.field.length, 2, "three zones remain available for the second token effect");
    assert.ok(player.graveyard.includes(first) && player.graveyard.includes(second));
    assert.equal(summons.filter(entry => entry.from === "token").length, 2);
  });

  for (const drawIds of [[518, 17], [519, 520]] as const) {
    for (const combo of ["lancer", "raptor", "wyvern"] as const) {
      test(`electrocatapult_core_${combo === "lancer" ? "lancer" : `${combo}_singularity`} (${actor}, draws ${drawIds})`, async (t) => {
        const scenario = createScenario(t, actor);
        const { game, player, summons, drawEvents, fieldSizes } = scenario;
        const cards = prepareCombo(scenario, combo, drawIds);
        const { core, catapult, multimodal, portal, slasher, mage, phoenix, lancer, singularity, extension } = cards;
        const initialDeckSize = player.deck.length;
        await reachPortal(scenario, cards, combo);
        if (combo === "wyvern") await synchro(scenario, phoenix, [multimodal, required(extension)]);
        await synchro(scenario, slasher, [core, catapult]);
        if (combo === "lancer") {
          await synchro(scenario, mage, [core, slasher]);
          assert.equal(game.isBattleDestructionProtected(mage), true);
          await synchro(scenario, lancer, [multimodal, portal, mage]);
          assert.deepEqual(player.field, [lancer]);
          assert.equal(lancer.level, 10);
          assert.equal(lancer.attackLimitThisTurn, 2);
          assert.equal(game.isBattleDestructionProtected(lancer), false, "Slasher's protection is not inherited twice");
          assert.deepEqual(new Set(player.graveyard), new Set([catapult, core, slasher, multimodal, portal, mage]));
        } else if (combo === "raptor") {
          await synchro(scenario, mage, [required(extension), portal]);
          await synchro(scenario, singularity, [multimodal, slasher, mage]);
          assert.deepEqual(new Set(player.field), new Set([singularity, core]));
          assert.equal(core.effectsNegated, true);
          assert.equal(singularity.atk, 4000);
          assert.equal(game.isBattleDestructionProtected(singularity), true);
          assert.deepEqual(singularity.protectionEffects?.map(protection => ({
            type: protection.type, expires: protection.expiresOnTurn, owner: protection.sourceOwner,
          })), [
            { type: "battle_destruction", expires: 3, owner: "any" },
            { type: "effect_destruction", expires: 3, owner: "opponent" },
          ]);
          assert.deepEqual(new Set(player.graveyard), new Set([catapult, extension, portal, multimodal, slasher, mage]));
          assert.equal(summons.some(entry => entry.from === "token"), false);
          assert.equal(player.field.some(card => card.isToken), false);
        } else {
          assert.equal(multimodal.effectsNegated, true, "negated Multimodal remains a valid Synchro Tuner");
          await synchro(scenario, singularity, [multimodal, portal, phoenix]);
          assert.deepEqual(new Set(player.field), new Set([singularity, slasher]));
          assert.equal(singularity.atk, 4000, "Slasher does not buff a monster summoned later");
          assert.equal(slasher.atk, 2100);
          assert.equal(game.isBattleDestructionProtected(singularity), false);
          assert.deepEqual(new Set(player.graveyard), new Set([extension, core, catapult, multimodal, portal, phoenix]));
        }
        assert.deepEqual(player.hand, cards.draws);
        assert.equal(player.deck.length, initialDeckSize - 2);
        assert.equal(player.banished.length, 0);
        assert.ok(fieldSizes.every(size => size <= 5));
        assert.deepEqual(summons.filter(entry => entry.method === "synchro").map(entry => entry.id),
          combo === "lancer" ? [503, 509, 510, 512, 516] :
            combo === "raptor" ? [503, 509, 510, 512, 517] : [503, 509, 514, 510, 517]);
        assert.deepEqual(drawEvents, [
          { ids: [required(cards.draws[0]).id], sourceId: core.id },
          { ids: [required(cards.draws[1]).id], sourceId: multimodal.id },
        ]);
      });
    }
  }
}
