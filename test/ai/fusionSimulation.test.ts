import assert from "node:assert/strict";
import test from "node:test";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { placeSimulationCards, simulationCard, simulationState } from "../helpers/simulation.js";

const make = (name: string) => simulationCard({ ...cardDefinition(name) });
const fillers = (count: number) => Array.from({ length: count }, () => make("Nightmare Steed"));

for (const seat of ["player", "bot"] as const) {
  function scenario(fusionName = "Shadow-Heart Warlord") {
    const fusion = make(fusionName);
    const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: seat, turnCounter: 2,
      [seat]: { extraDeck: [fusion] } });
    const player = state[seat];
    const run = () => applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }] });
    return { state, player, fusion, run };
  }

  for (const full of [false, true]) {
    test(`Fusion uses the zone freed by a field material (${seat}, full=${full})`, () => {
      const { player, fusion, run } = scenario();
      const field = make("Shadow-Heart Abyssal Eel"), hand = make("Shadow-Heart Abyssal Eel");
      placeSimulationCards(player.field, field, ...fillers(full ? 4 : 1));
      const slot = field.fieldSlot;
      player.hand.push(hand);
      run();
      assert.ok(player.field.includes(fusion));
      assert.equal(player.field.length, full ? 5 : 2);
      assert.equal(fusion.fieldSlot, slot);
      assert.deepEqual(player.graveyard, [field, hand]);
      assert.equal(new Set(player.field.map(card => card.fieldSlot)).size, player.field.length);
      assert.equal(field.lastSentToGraveAsMaterial?.turn, 2);
    });
  }

  test(`Fusion rejects hand-only materials when they cannot free the full field (${seat})`, () => {
    const { player, fusion, run } = scenario();
    placeSimulationCards(player.field, ...fillers(5));
    const materials = [make("Shadow-Heart Abyssal Eel"), make("Shadow-Heart Abyssal Eel")];
    player.hand.push(...materials); run();
    assert.deepEqual(player.hand, materials); assert.deepEqual(player.extraDeck, [fusion]);
    assert.equal(player.graveyard.length, 0);
  });

  for (const zone of ["hand", "field"] as const) {
    test(`Void Berserker requires its named material in the field (${seat}, zone=${zone})`, () => {
      const { player, fusion, run } = scenario("Void Berserker");
      const brute = make("Void Slayer Brute"), hollow = make("Void Hollow");
      if (zone === "field") placeSimulationCards(player.field, brute);
      else player.hand.push(brute);
      player.hand.push(hollow);
      run();
      assert.equal(player.field.includes(fusion), zone === "field");
      if (zone === "field") assert.deepEqual(player.graveyard, [brute, hollow]);
      else { assert.deepEqual(player.hand, [brute, hollow]); assert.deepEqual(player.extraDeck, [fusion]); assert.equal(player.graveyard.length, 0); }
    });
  }

  test(`Fusion searches alternative assignments for overlapping requirements (${seat})`, () => {
    const { player, fusion, run } = scenario("Void Berserker");
    const brute = make("Void Slayer Brute"), hollow = make("Void Hollow");
    // The cheap Hollow matches both slots; choosing it for the broad slot would fail.
    fusion.fusionMaterials = [{ archetype: "Void" }, { name: required(hollow.name), allowedZones: ["hand"] }];
    player.hand.push(hollow, brute); run();
    assert.ok(player.field.includes(fusion)); assert.deepEqual(player.graveyard, [brute, hollow]);
  });

  test(`Fusion skips a cheaper hand-only combination that leaves no destination (${seat})`, () => {
    const { player, fusion, run } = scenario();
    const field = make("Shadow-Heart Abyssal Eel"), hands = [make("Shadow-Heart Abyssal Eel"), make("Shadow-Heart Abyssal Eel")];
    field.atk = 9000;
    placeSimulationCards(player.field, field, ...fillers(4)); player.hand.push(...hands);
    run(); assert.ok(player.field.includes(fusion)); assert.ok(player.graveyard.includes(field));
    assert.equal(player.hand.length, 1); assert.equal(player.field.length, 5);
  });

  test(`Fusion rejects a large hand pool when no eligible material frees a zone (${seat})`, () => {
    const { state, player, run } = scenario("Void Hydra Titan");
    placeSimulationCards(player.field, ...fillers(5));
    player.hand.push(...Array.from({ length: 20 }, () => make("Void Hollow")));
    const before = structuredClone(state);
    run(); assert.deepEqual(state, before);
  });

  for (const departure of ["token", "banished"] as const) {
    test(`Fusion preserves ${departure} material departure without a false GY marker (${seat})`, () => {
      const { player, fusion, run } = scenario();
      const field = make("Shadow-Heart Abyssal Eel"), hand = make("Shadow-Heart Abyssal Eel");
      if (departure === "token") field.isToken = true;
      else field.banishWhenLeavesField = true;
      placeSimulationCards(player.field, field); player.hand.push(hand);
      run();
      assert.ok(player.field.includes(fusion)); assert.deepEqual(player.graveyard, [hand]);
      assert.equal(player.banished.includes(field), departure === "banished");
      assert.equal(field.lastSentToGraveAsMaterial, undefined);
      assert.equal(hand.lastSentToGraveAsMaterial?.type, "fusion");
    });
  }

  for (const invalid of ["missing", "exclusive", "restriction", "field_limit", "unpayable"] as const) {
    test(`Fusion rejects ${invalid} before consuming materials (${seat})`, () => {
      const { state, player, fusion, run } = scenario();
      const first = make("Shadow-Heart Abyssal Eel"), second = make("Shadow-Heart Abyssal Eel");
      placeSimulationCards(player.field, first); player.hand.push(second);
      if (invalid === "missing") fusion.fusionMaterials = [];
      if (invalid === "exclusive") fusion.extraDeckSummonProcedure = { type: "contact_fusion", summonMethod: "fusion", materialDestination: "graveyard" };
      if (invalid === "restriction") player.specialSummonRestrictions = [{ allowedFilters: { archetype: "Tech-Zero" }, duration: "until_end_turn", expiresOnTurn: 2, reason: null, sourceName: null, sourceId: null, effectId: null }];
      if (invalid === "field_limit") {
        fusion.fieldLimit = { key: "test_limit", label: "Test limit", max: 0, scope: "controller", filters: { archetype: "Shadow-Heart" } };
      }
      if (invalid === "unpayable") {
        first.banishWhenLeavesField = true;
        const protector = make("Tech-Zero Plasma Phoenix");
        first.archetype = "Tech-Zero"; second.archetype = "Tech-Zero";
        fusion.fusionMaterials = [{ name: required(first.name), count: 2 }];
        placeSimulationCards(player.field, protector);
      }
      const before = structuredClone(state);
      run(); assert.deepEqual(state, before); assert.ok(player.extraDeck.includes(fusion));
    });
  }
}

for (const kind of ["full_field", "wrong_zone"] as const) {
  test(`planner spell action preserves Fusion legality: ${kind}`, () => {
    const spell = make("Polymerization");
    const fusion = make(kind === "full_field" ? "Shadow-Heart Warlord" : "Void Berserker");
    const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 2, bot: {
      hand: kind === "full_field" ? [spell, make("Shadow-Heart Abyssal Eel")] : [spell, make("Void Slayer Brute"), make("Void Hollow")],
      field: kind === "full_field" ? [make("Shadow-Heart Abyssal Eel"), ...fillers(4)] : [], extraDeck: [fusion],
    } });
    applyGenericSimulatedMainPhaseAction(state, { type: "spell", index: 0, cardId: spell.id });
    assert.equal(state.bot.field.includes(fusion), kind === "full_field");
    assert.equal(state.bot.extraDeck.includes(fusion), kind === "wrong_zone");
    assert.equal(state.bot.hand.length, kind === "full_field" ? 0 : 2);
  });
}
