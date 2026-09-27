import assert from "node:assert/strict";
import test from "node:test";
import { diffPlanningSummaries, summarizePlanningState } from "../../src/core/ai/common/planningDiagnostics.js";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

const player = { id: "player", lp: 8000, hand: [] };
const unknown = { _simUnknownDraw: true };

test("revealing simulated draws is expected while preserving each previously known hand card", () => {
  const expectedState = { player, bot: { id: "bot", lp: 8000,
    hand: [{ name: "Core" }, { name: "Core" }, unknown, unknown], deck: [] } };
  const expected = summarizePlanningState(expectedState);
  const actual = summarizePlanningState({ player, bot: { ...expectedState.bot,
    hand: [{ name: "Core" }, { name: "Lab" }, { name: "Core" }, { name: "Court" }] } });
  const diff = diffPlanningSummaries(expected, actual);
  assert.equal(diff.matched, true);
  assert.equal(diff.severity, "minor");
  assert.equal(diff.diffs[0]?.reason, "unknown_draw_revealed");
});

test("draw uncertainty cannot hide a missing known copy or a wrong hand size", () => {
  const expected = summarizePlanningState({ player, bot: { id: "bot", lp: 8000,
    hand: [{ name: "Core" }, { name: "Core" }, unknown] } });
  for (const names of [["Core", "Lab", "Court"], ["Core", "Core"], ["Core", "Core", "Lab", "Court"]]) {
    const actual = summarizePlanningState({ player, bot: { id: "bot", lp: 8000, hand: names.map(name => ({ name })) } });
    assert.equal(diffPlanningSummaries(expected, actual).severity, "hand_deck_mismatch");
  }
});

test("a card merely named unknown is not an unobserved draw", () => {
  const expected = summarizePlanningState({ player, bot: { id: "bot", hand: [{ name: "unknown" }] } });
  const actual = summarizePlanningState({ player, bot: { id: "bot", hand: [{ name: "Core" }] } });
  assert.equal(diffPlanningSummaries(expected, actual).matched, false);
});

for (const seat of ["player", "bot"] as const) {
  test(`unchanged hidden opponent cards do not become planning mismatches after a Normal Summon (${seat})`, async t => {
    const first = new Bot(seat === "player" ? "techzero" : "void"); first.id = "player";
    const second = new Bot(seat === "bot" ? "techzero" : "void");
    const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
    game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime in either seat");
    const runtime = unsafeFixture<BotGamePort & AiLiveGamePort>(game, "Concrete Game supplies attached Bot execution capabilities");
    first.game = runtime; second.game = runtime;
    t.after(() => game.dispose("public_planning_diagnostics"));
    game.turn = seat; game.turnCounter = 4; game.phase = "main1"; game.disablePresentationDelays = true;
    const actor = seat === "player" ? first : second;
    const opponent = seat === "player" ? second : first;
    actor.hand.push(new Card(cardDefinition(1), seat));
    const hiddenHand = new Card(cardDefinition(204), opponent.id);
    const hiddenMonster = new Card({ id: 990981, name: "Hidden monster", cardKind: "monster", atk: 1700, def: 1300, effects: [] }, opponent.id);
    const hiddenTrap = new Card({ id: 990982, name: "Hidden trap", cardKind: "trap", effects: [] }, opponent.id);
    hiddenMonster.isFacedown = true; hiddenMonster.position = "defense"; hiddenTrap.isFacedown = true;
    opponent.hand.push(hiddenHand);
    placeFieldCards(opponent.field, hiddenMonster); placeFieldCards(opponent.spellTrap, hiddenTrap);
    const action: AIAction = { type: "summon", index: 0, cardId: 1, position: "attack" };
    const planned = required(await turnLineSearch(runtime, actor.strategy, { maxDepth: 1, preGeneratedActions: [action] }));
    const expected = summarizePlanningState(required(planned.finalState), { bot: actor });
    assert.equal(await actor.executeMainPhaseAction(runtime, action), true);
    const actual = summarizePlanningState(game, { bot: actor });
    const diff = diffPlanningSummaries(expected, actual);
    assert.equal(diff.matched, true, JSON.stringify(diff));
    assert.deepEqual(expected.opponent, actual.opponent);
    assert.equal(actual.opponent.field[0]?.instanceId, hiddenMonster.instanceId);
    assert.equal(actual.opponent.field[0]?.fieldSlot, hiddenMonster.fieldSlot);
    assert.equal(actual.opponent.field[0]?.name, "unknown");
    assert.equal(actual.opponent.field[0]?.atk, 0);
    assert.equal(actual.opponent.spellTrap[0]?.kind, null);
  });
}

test("public summaries never read opponent hand identities or facedown private properties", () => {
  const hidden = { instanceId: 42, isFacedown: true, position: "defense", fieldSlot: 3 };
  for (const field of ["name", "id", "cardKind", "atk", "def", "counters", "storedEffects", "equips"]) {
    Object.defineProperty(hidden, field, { get() { throw new Error(`read hidden ${field}`); } });
  }
  let summary: ReturnType<typeof summarizePlanningState> | undefined;
  assert.doesNotThrow(() => {
    summary = summarizePlanningState({ bot: { id: "bot" }, player: { id: "player",
      hand: [hidden], field: [hidden], spellTrap: [hidden], fieldSpell: hidden, banished: [hidden] } });
  });
  assert.equal(summary?.opponent.handSize, 1);
  assert.equal(summary?.opponent.field[0]?.kind, "monster");
});

test("public diagnostics retain hidden hand counts, instances, zones, slots, positions and reveals", () => {
  const card = { instanceId: 42, fieldSlot: 0, isFacedown: true, position: "defense" };
  const summarize = (opponent: Parameters<typeof summarizePlanningState>[0]) => summarizePlanningState(opponent);
  const state = { bot: { id: "bot" }, player: { id: "player", hand: [{ instanceId: 5 }], field: [card], spellTrap: [] } };
  const expected = summarize(state);
  const variants = [
    { ...state.player, hand: [] },
    { ...state.player, hand: [{ instanceId: 6 }] },
    { ...state.player, field: [{ ...card, instanceId: 43 }] },
    { ...state.player, field: [{ ...card, fieldSlot: 1 }] },
    { ...state.player, field: [{ ...card, position: "attack" }] },
    { ...state.player, field: [], spellTrap: [card] },
    { ...state.player, field: [{ ...card, isFacedown: false, name: "Revealed monster", atk: 1700 }] },
  ];
  for (const opponent of variants) {
    const actual = summarize({ ...state, player: opponent });
    assert.equal(diffPlanningSummaries(expected, actual).matched, false, JSON.stringify(opponent));
  }
});
