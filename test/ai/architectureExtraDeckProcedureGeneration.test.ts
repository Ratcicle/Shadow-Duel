import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { getGenericExtraDeckProcedureActions } from "../../src/core/ai/common/actionGeneration.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { getPlanningActionPresence, isPlanningActionPresenceCurrent } from "../../src/core/ai/common/actionIdentity.js";
import { canResolveExtraDeckProcedureActionForCurrentState, findExtraDeckCardForAction, resolveExtraDeckProcedureMaterials } from "../../src/core/bot/actionValidation.js";
import type { BotRuntimePort, BotGamePort } from "../../src/core/contracts/bot.js";
import { getAvailableFieldSlots } from "../../src/core/game/zones/placement.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

type FixtureCard = Card & { id: number; name: string };
function identified(card: Card): FixtureCard {
  function assertIdentity(value: Card): asserts value is FixtureCard {
    assert.equal(typeof value.id, "number");
    assert.equal(typeof value.name, "string");
  }
  assertIdentity(card);
  return card;
}

function fixture(seat: "bot" | "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true, captureReplay: false });
  game.turn = seat;
  game.phase = "main1";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  const owner = game[seat];
  owner.controllerType = game[seat === "bot" ? "player" : "bot"].controllerType = "ai";
  const neutral = (id: number, name: string) => identified(new Card({
    ...cardDefinition(id), name, archetype: "Neutral Fixture", effects: [],
  }, owner.id));
  const first = neutral(356, "Neutral First");
  const second = neutral(352, "Neutral Second");
  const sister = neutral(352, "Neutral Second");
  const other = neutral(351, "Neutral Spare");
  const makeSource = () => identified(new Card({
    ...cardDefinition(363), name: "Neutral Contact", archetype: "Neutral Fixture", effects: [],
    fusionMaterials: [
      { name: "Neutral First", cardKind: "monster", allowedZones: ["field"] },
      { archetype: "Neutral Fixture", cardKind: "monster", allowedZones: ["field"] },
    ],
  }, owner.id));
  const source = makeSource(), sourceSister = makeSource();
  placeFieldCards(owner.field, first, second, sister);
  owner.extraDeck.push(other, source, sourceSister);
  const calls: string[] = [];
  const query = (entry: { card: Card }) => {
    calls.push(`query:${entry.card.instanceId}`);
    const result = game.canSummonExtraDeckCardByProcedure(entry.card, owner, { silent: true });
    const combos = (result.materialCombos || []).map(combo => combo.map(card => {
      assert.ok(card instanceof Card);
      return identified(card);
    }));
    return { ok: result.ok, combos };
  };
  const validationOwner = unsafeFixture<BotRuntimePort>(owner,
    "Read-only procedure validators consume the real Player zones/id; this oracle deliberately omits unrelated Bot decisions/execution methods.");
  const validationGame = unsafeFixture<BotGamePort>(game,
    "Real canonical procedure query/placement oracle; unrelated effect-preview return fields are not consumed by these validators.");
  const planningOwner = () => ({ id: owner.id, field: Array.from(owner.field, identified) });
  const generate = (entries = [{ card: source, sourceIndex: 1 }]) => getGenericExtraDeckProcedureActions<FixtureCard, number>(planningOwner(), entries, {
    game,
    getMaterialCombos: query,
    selectMaterials: combos => {
      calls.push("select");
      const combo = combos[0];
      return combo ? { combo, evaluation: 37 } : null;
    },
    getActionDetails: selected => {
      calls.push("details");
      return { priority: selected.evaluation, reason: "Neutral callback", position: "defense", activationContext: {} };
    },
    getMaterialInstanceIds: card => [card.instanceId],
  });
  return { game, owner, validationOwner, validationGame, planningOwner, first, second, sister, other, source, sourceSister, calls, query, generate };
}

for (const seat of ["bot", "player"] as const) {
  test(`generic procedure delegates neutral requirements and preserves ordered hints (${seat})`, () => {
    const f = fixture(seat);
    try {
      const action = required(f.generate()[0]);
      assert.equal(action.priority, 37);
      assert.equal(action.reason, "Neutral callback");
      assert.equal(action.position, "defense");
      assert.equal(action.extraDeckIndex, 1);
      assert.equal(action.extraDeckCard, f.source);
      assert.deepEqual(action.materialIndices, [0, 1]);
      assert.deepEqual(action.materialInstanceIds, [[f.first.instanceId], [f.second.instanceId]]);
      assert.deepEqual(resolveExtraDeckProcedureMaterials(f.validationOwner, action), [f.first, f.second]);
      assert.ok(canResolveExtraDeckProcedureActionForCurrentState(f.validationOwner, action, f.validationGame));
      assert.deepEqual(f.calls, [`query:${f.source.instanceId}`, "select", "details"]);
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });

  test(`generic procedure honors canonical failure before selection (${seat})`, () => {
    const f = fixture(seat);
    try {
      f.owner.graveyard.push(...f.owner.field.splice(1));
      assert.equal(f.game.canSummonExtraDeckCardByProcedure(f.source, f.owner, { silent: true }).ok, false);
      assert.deepEqual(f.generate(), []);
      assert.deepEqual(f.calls, [`query:${f.source.instanceId}`]);
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });

  test(`generic procedure visits explicit entries in order and delegates undeclared rejection (${seat})`, () => {
    const f = fixture(seat);
    try {
      const actions = f.generate([
        { card: f.other, sourceIndex: 0 }, { card: f.sourceSister, sourceIndex: 2 }, { card: f.source, sourceIndex: 1 },
      ]);
      assert.deepEqual(actions.map(action => action.extraDeckCard), [f.sourceSister, f.source]);
      assert.deepEqual(actions.map(action => action.extraDeckIndex), [2, 1]);
      assert.deepEqual(f.calls.filter(call => call.startsWith("query:")), [`query:${f.other.instanceId}`, `query:${f.sourceSister.instanceId}`, `query:${f.source.instanceId}`]);
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });

  test(`generic procedure respects null and empty policy selections (${seat})`, () => {
    const f = fixture(seat);
    try {
      for (const empty of [false, true]) {
        let detailsCalled = false;
        const actions = getGenericExtraDeckProcedureActions<FixtureCard, number>(f.planningOwner(), [{ card: f.source, sourceIndex: 1 }], {
          game: f.game, getMaterialCombos: f.query,
          selectMaterials: () => empty ? { combo: [], evaluation: 0 } : null,
          getActionDetails: () => { detailsCalled = true; return { priority: 0, reason: "unused", position: "attack", activationContext: {} }; },
          getMaterialInstanceIds: card => [card.instanceId],
        });
        assert.deepEqual(actions, []);
        assert.equal(detailsCalled, false);
      }
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });

  test(`generic procedure avoids unsupported other-zone hint transport (${seat})`, () => {
    const f = fixture(seat);
    try {
      f.owner.field.splice(f.owner.field.indexOf(f.sister), 1); f.owner.graveyard.push(f.sister);
      let detailsCalled = false;
      const actions = getGenericExtraDeckProcedureActions<FixtureCard, number>(f.planningOwner(), [{ card: f.source, sourceIndex: 1 }], {
        getMaterialCombos: f.query, selectMaterials: () => ({ combo: [f.first, f.sister], evaluation: 1 }),
        getActionDetails: () => { detailsCalled = true; return { priority: 1, reason: "unused", position: "attack", activationContext: {} }; },
        getMaterialInstanceIds: card => [card.instanceId],
      });
      assert.deepEqual(actions, []);
      assert.equal(detailsCalled, false);
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });

  test(`generic procedure binds after decoration and keeps physical copies after reorder (${seat})`, () => {
    const f = fixture(seat);
    try {
      const action = required(getGenericExtraDeckProcedureActions<FixtureCard, number>(f.planningOwner(), [{ card: f.source, sourceIndex: 1 }], {
        game: f.game, getMaterialCombos: f.query,
        selectMaterials: combos => ({ combo: required(combos[0]), evaluation: 37 }),
        getActionDetails: () => ({ priority: 37, reason: "before decoration", position: "attack", activationContext: {} }),
        getMaterialInstanceIds: card => [card.instanceId],
        decorateAction: previous => ({ ...previous, priority: 99, reason: "decorated" }),
      })[0]);
      assert.equal(action.priority, 99);
      assert.ok(getPlanningActionPresence(action));
      const copied = unsafeFixture<typeof action>(createPlanningCopy().copyValue(createPlanningCopy().copyValue(action)), "Canonical graph copy of a known ProcedureAction preserves the closed command shape and private frame.");
      f.owner.field.reverse(); f.owner.extraDeck.reverse();
      assert.ok(isPlanningActionPresenceCurrent(copied, f.owner));
      assert.equal(findExtraDeckCardForAction(f.validationOwner, copied), f.source);
      assert.deepEqual(resolveExtraDeckProcedureMaterials(f.validationOwner, copied), [f.first, f.second]);
      assert.ok(canResolveExtraDeckProcedureActionForCurrentState(f.validationOwner, copied, f.validationGame));
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });

  test(`generic procedure rejects the selected material leaving and returning (${seat})`, async () => {
    const f = fixture(seat);
    try {
      const action = required(f.generate()[0]);
      await f.game.moveCard(f.second, f.owner, "hand", { fromZone: "field" });
      await f.game.moveCard(f.second, f.owner, "field", { fromZone: "hand", summonOrigin: "effect_resolution", position: "attack" });
      assert.ok(f.owner.field.includes(f.second));
      assert.equal(isPlanningActionPresenceCurrent(action, f.owner), false);
      assert.deepEqual(resolveExtraDeckProcedureMaterials(f.validationOwner, action), []);
      assert.equal(canResolveExtraDeckProcedureActionForCurrentState(f.validationOwner, action, f.validationGame), false);
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });

  test(`generic procedure rejects the selected source leaving and returning (${seat})`, async () => {
    const f = fixture(seat);
    try {
      const action = required(f.generate()[0]);
      await f.game.moveCard(f.source, f.owner, "banished", { fromZone: "extraDeck" });
      await f.game.moveCard(f.source, f.owner, "extraDeck", { fromZone: "banished" });
      assert.ok(f.owner.extraDeck.includes(f.source));
      assert.equal(isPlanningActionPresenceCurrent(action, f.owner), false);
      assert.equal(findExtraDeckCardForAction(f.validationOwner, action), undefined);
      assert.equal(canResolveExtraDeckProcedureActionForCurrentState(f.validationOwner, action, f.validationGame), false);
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });

  test(`generic procedure pays exact ordered physical materials once and frees a full field (${seat})`, async () => {
    const f = fixture(seat);
    try {
      while (getAvailableFieldSlots(f.owner.field).length > 0) {
        placeFieldCards(f.owner.field, new Card(cardDefinition(351), f.owner.id));
      }
      assert.equal(getAvailableFieldSlots(f.owner.field).length, 0);
      const action = required(f.generate()[0]);
      const materials = resolveExtraDeckProcedureMaterials(f.validationOwner, action);
      assert.deepEqual(materials, [f.first, f.second]);
      const costEvents: unknown[] = [];
      let summons = 0;
      f.game.on("card_moved", payload => {
        if (payload.toZone === "graveyard") costEvents.push(payload.card);
      });
      f.game.on("after_summon", payload => {
        if (payload.card === f.source) summons++;
      });
      const result = await f.game.performExtraDeckSummonProcedure(f.source, f.owner, { materials, position: "defense" });
      assert.equal(result.success, true);
      assert.deepEqual(f.owner.graveyard, [f.first, f.second]);
      assert.deepEqual(costEvents, [f.first, f.second]);
      assert.equal(summons, 1);
      assert.ok(f.owner.field.includes(f.source));
      assert.ok(f.owner.field.includes(f.sister));
      assert.ok(f.owner.extraDeck.includes(f.sourceSister));
      assert.equal(f.source.position, "defense");
      assert.equal(isPlanningActionPresenceCurrent(action, f.owner), false);
    } finally { f.game.dispose("stage9_generic_proposal"); }
  });
}
