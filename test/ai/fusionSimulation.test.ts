import assert from "node:assert/strict";
import test from "node:test";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { placeSimulationCards, simulationCard, simulationState } from "../helpers/simulation.js";

const make = (name: string) => simulationCard({ ...cardDefinition(name) });
const fillers = (count: number) => Array.from({ length: count }, () => make("Nightmare Steed"));

function permutations(values: readonly number[]): number[][] {
  if (values.length === 0) return [[]];
  return values.flatMap(value => permutations(values.filter(other => other !== value)).map(rest => [value, ...rest]));
}

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

  test(`Fusion minimizes the whole overlapping assignment instead of its first slot (${seat})`, () => {
    const { player, fusion, run } = scenario();
    const cheapGecko = make("Shadow-Heart Gecko"), eel = make("Shadow-Heart Abyssal Eel"), costlyGecko = make("Shadow-Heart Gecko");
    cheapGecko.atk = 100; cheapGecko.def = 100; cheapGecko.level = 1;
    eel.atk = 1000; eel.def = 1000; eel.level = 1;
    costlyGecko.atk = 5000; costlyGecko.def = 5000; costlyGecko.level = 1;
    fusion.fusionMaterials = [{ archetype: "Shadow-Heart" }, { name: "Shadow-Heart Gecko" }];
    player.hand.push(cheapGecko, eel, costlyGecko);
    run();
    assert.ok(player.field.includes(fusion));
    assert.deepEqual(new Set(player.graveyard), new Set([cheapGecko, eel]));
    assert.deepEqual(player.hand, [costlyGecko]);
  });

  test(`Fusion stable identities break equal-cost ties independently of pool order (${seat})`, () => {
    const { player, fusion, run } = scenario();
    const materials = [30, 10, 20].map(instanceId => simulationCard({ ...cardDefinition("Shadow-Heart Abyssal Eel"), instanceId }));
    player.hand.push(...materials);
    run();
    assert.ok(player.field.includes(fusion));
    assert.deepEqual(player.graveyard.map(card => card.instanceId).sort((a, b) => Number(a) - Number(b)), [10, 20]);
  });

  test(`Fusion considers future negative costs instead of pruning by the positive prefix (${seat})`, () => {
    const { state, player, fusion } = scenario();
    const cheapGecko = make("Shadow-Heart Gecko"), eel = make("Shadow-Heart Abyssal Eel"), costlyGecko = make("Shadow-Heart Gecko");
    cheapGecko.atk = 100; cheapGecko.level = 1;
    eel.atk = 1000; eel.level = 1;
    costlyGecko.atk = 240000; costlyGecko.level = 1;
    fusion.fusionMaterials = [{ archetype: "Shadow-Heart" }, { name: "Shadow-Heart Gecko" }];
    player.hand.push(cheapGecko, eel, costlyGecko);
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }],
      options: { costPreferences: { forceNames: ["Shadow-Heart Gecko"] } } });
    assert.deepEqual(new Set(player.graveyard), new Set([cheapGecko, eel]));
    assert.deepEqual(player.hand, [costlyGecko]);
  });

  for (const face of ["attack", "defense"] as const) {
    test(`Fusion equal costs preserve ${face === "attack" ? "ready ATK" : "field bodies"} before lower instance IDs (${seat})`, () => {
      const { player, fusion, run } = scenario();
      const field = simulationCard({ ...cardDefinition("Shadow-Heart Abyssal Eel"), instanceId: 1,
        atk: 1000, def: 1000, position: face, isFacedown: false });
      const hands = [20, 10].map(instanceId => simulationCard({ ...cardDefinition("Shadow-Heart Abyssal Eel"),
        instanceId, atk: 1000, def: 1000, position: "attack", isFacedown: false }));
      placeSimulationCards(player.field, field); player.hand.push(...hands);
      run();
      assert.ok(player.field.includes(fusion)); assert.ok(player.field.includes(field));
      assert.deepEqual(new Set(player.graveyard), new Set(hands));
    });
  }

  test(`Fusion minimizes interchangeable count requirements with instance preferences (${seat})`, () => {
    const { state, player, fusion } = scenario("Void Hydra Titan");
    fusion.fusionMaterials = [{ archetype: "Void", count: 3 }];
    const materials = [50, 40, 30, 20, 10].map(instanceId => simulationCard({ ...cardDefinition("Void Hollow"), instanceId }));
    player.hand.push(...materials);
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }],
      options: { costPreferences: { preferredInstanceIds: [40], avoidInstanceIds: [10] } } });
    assert.ok(player.field.includes(fusion));
    assert.deepEqual(player.graveyard.map(card => card.instanceId).sort((a, b) => Number(a) - Number(b)), [20, 30, 40]);
  });

  test(`Fusion count-three choices match the independent identity oracle across all pool permutations (${seat})`, () => {
    // Fixed costs are .22, .32, 1.12, 2.12 before the existing +/-100 and -120
    // preferences. The best three identities follow directly from those values.
    const policies = [
      { preferences: {}, expected: [10, 20, 30] },
      { preferences: { preferredInstanceIds: [40] }, expected: [10, 20, 40] },
      { preferences: { preferredInstanceIds: [40], avoidInstanceIds: [10] }, expected: [20, 30, 40] },
      { preferences: { forceNames: ["Shadow-Heart Abyssal Eel"] }, expected: [10, 20, 30] },
    ];
    for (const policy of policies) {
      for (const order of permutations([10, 20, 30, 40])) {
        const { state, player, fusion } = scenario();
        fusion.effects = [];
        fusion.fusionMaterials = [{ archetype: "Shadow-Heart", count: 3 }];
        const attacks: Record<number, number> = { 10: 100, 20: 200, 30: 1000, 40: 2000 };
        player.hand.push(...order.map(instanceId => simulationCard({ ...cardDefinition("Shadow-Heart Abyssal Eel"),
          instanceId, atk: required(attacks[instanceId]), level: 1, position: "attack", isFacedown: false, effects: [] })));
        applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }],
          options: { costPreferences: policy.preferences } });
        assert.deepEqual(player.graveyard.map(card => card.instanceId).sort((left, right) => Number(left) - Number(right)), policy.expected,
          JSON.stringify({ order, preferences: policy.preferences }));
      }
    }
  });

  test(`Fusion decimal cost bounds preserve the lower identity when recipe and sum orders differ (${seat})`, () => {
    const { player, fusion, run } = scenario();
    fusion.effects = [];
    fusion.fusionMaterials = [{ name: "Shadow-Heart Gecko" }, { name: "Shadow-Heart Abyssal Eel" }, { name: "Shadow-Heart Griffin" }];
    const low = simulationCard({ ...cardDefinition("Shadow-Heart Gecko"), effects: [], instanceId: 1, atk: 100, level: 1 });
    const middleFirst = simulationCard({ ...cardDefinition("Shadow-Heart Abyssal Eel"), effects: [], instanceId: 30, atk: 700, level: 1 });
    const middleBest = simulationCard({ ...cardDefinition("Shadow-Heart Abyssal Eel"), effects: [], instanceId: 10, atk: 700, level: 1 });
    const last = simulationCard({ ...cardDefinition("Shadow-Heart Griffin"), effects: [], instanceId: 2, atk: 200, level: 1 });
    player.hand.push(low, middleFirst, middleBest, last);
    run();
    assert.deepEqual(player.graveyard.map(card => card.instanceId).sort((left, right) => Number(left) - Number(right)), [1, 2, 10]);
    assert.deepEqual(player.hand, [middleFirst]);
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
