import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import Player from "../../src/core/Player.js";
import type { FieldPlacementPreparation, FieldPlacementIntent } from "../../src/core/contracts/placement.js";
import { applySpecialSummonToken, applySpecialSummonSelfAsTrapMonster } from "../../src/core/effects/actions/summon.js";
import { applyMove } from "../../src/core/effects/actions/movement.js";
import { performSummonFromHand } from "../../src/core/actionHandlers/summon/fromHand.js";
import type { ActionHandlerEnginePort, ActionRuntimeCard, ActionRuntimePlayer } from "../../src/core/contracts/actionRuntime.js";
import { unsafeFixture } from "../helpers/fixtures.js";

function players() {
  return {
    player: Object.assign(new Player("player", "Player", "human"), { strategy: null }),
    opponent: Object.assign(new Player("bot", "Opponent", "ai"), { strategy: null }),
  };
}

test("partial-host summons and sequential tokens fill canonical slots from the center out", async () => {
  const { player, opponent } = players();
  const existing = new Card({ name: "Existing", cardKind: "monster" }, "player");
  existing.fieldSlot = 3;
  player.field.push(existing);
  const summoned = new Card({ name: "Hand monster", cardKind: "monster" }, "player");
  player.hand.push(summoned);
  const game = { player, bot: opponent, updateBoard: () => {}, ui: { log: () => {} } };
  const engine = unsafeFixture<ActionHandlerEnginePort>({ game, chooseSpecialSummonPosition: async () => "attack" }, "Partial host deliberately omits moveCard to test the pure fallback allocator.");
  await performSummonFromHand(summoned, 0, player, { type: "draw_and_summon" }, engine);
  assert.equal(summoned.fieldSlot, 2);
  assert.equal(existing.fieldSlot, 3);
  const host = unsafeFixture<ThisParameterType<typeof applySpecialSummonToken>>({ game, chooseSpecialSummonPosition: async () => "defense" }, "Token fallback has no runtime movement coordinator.");
  for (let i = 0; i < 2; i++) {
    assert.equal(await applySpecialSummonToken.call(host, { type: "special_summon_token", token: { name: "Token", atk: 0, def: 0 } }, { player, opponent }), true);
  }
  assert.deepEqual(player.field.map((card) => card.fieldSlot), [3, 2, 1, 0]);
});

test("generic effects preserve the actor when placing on the opponent field", async () => {
  const { player, opponent } = players();
  const card = new Card({ name: "Gift", cardKind: "monster" }, "player");
  let chosenActor: unknown;
  let destination: unknown;
  const host = unsafeFixture<ThisParameterType<typeof applyMove>>({
    game: {
      player, bot: opponent,
      moveCard: (_card: ActionRuntimeCard, target: ActionRuntimePlayer, _zone: string, options: object) => {
        chosenActor = Reflect.get(options, "placementActor"); destination = target;
        return { success: true };
      },
    },
  }, "Movement host observes coordinator arguments without implementing a real duel.");
  await applyMove.call(host, { type: "move", targetRef: "gift", to: "field", player: "opponent", position: "defense" }, { player, opponent }, { gift: [card] });
  assert.equal(chosenActor, player);
  assert.equal(destination, opponent);
});

test("partial-host movement clears a leaving slot and removes tokens instead of storing them", async () => {
  const { player, opponent } = players();
  const token = new Card({ name: "Token", cardKind: "monster" }, "player");
  token.isToken = true;
  token.fieldSlot = 3;
  player.field.push(token);
  const host = unsafeFixture<ThisParameterType<typeof applyMove>>({
    game: { player, bot: opponent },
    getZone: (owner: ActionRuntimePlayer, zone: string) => zone === "field" ? owner.field : zone === "graveyard" ? owner.graveyard : null,
  }, "Partial host isolates fallback token removal without any movement coordinator.");
  await applyMove.call(host, { type: "move", targetRef: "token", to: "graveyard" }, { player, opponent }, { token: [token] });
  assert.equal(token.fieldSlot, null);
  assert.equal(player.field.length, 0);
  assert.equal(player.graveyard.length, 0);
});

for (const failure of ["rules", "abort"] as const) {
  test(`Trap Monster ${failure} failure restores type, facing and its Spell/Trap slot`, async () => {
    const { player, opponent } = players();
    const source = new Card({ name: "Trap", cardKind: "trap", subtype: "continuous" }, "player");
    source.fieldSlot = 4;
    source.isFacedown = true;
    player.spellTrap.push(source);
    const before = Object.getOwnPropertyDescriptors(source);
    let prepared = false;
    const host = unsafeFixture<ThisParameterType<typeof applySpecialSummonSelfAsTrapMonster>>({
      game: {
        player, bot: opponent, ui: { log: () => {} },
        prepareFieldPlacement: async (_card: ActionRuntimeCard, target: ActionRuntimePlayer, _row: string, options: { allowCancel: boolean }): Promise<FieldPlacementPreparation> => {
          assert.equal(source.cardKind, "trap");
          assert.equal(source.fieldSlot, 4);
          assert.equal(source.isFacedown, true);
          assert.equal(target, player);
          assert.equal(options.allowCancel, false);
          prepared = true;
          return { outcome: "chosen", intent: unsafeFixture<FieldPlacementIntent>({ slot: 2 }, "The move stub only observes the previously chosen slot.") };
        },
        moveCard: async () => {
          assert.equal(prepared, true);
          assert.equal(source.cardKind, "monster");
          if (failure === "abort") throw new DOMException("Reset", "AbortError");
          return { success: false };
        },
      },
      findCardZone: () => "spellTrap",
    }, "Simulate placement failure immediately after the Trap Monster transforms, without moving lists.");
    const run = applySpecialSummonSelfAsTrapMonster.call(host, { type: "special_summon_self_as_trap_monster", position: "defense", monster: { type: "Spirit", level: 4, atk: 1000, def: 1200 } }, { player, opponent, source });
    if (failure === "abort") await assert.rejects(run, { name: "AbortError" });
    else assert.equal(await run, false);
    assert.deepEqual(Object.getOwnPropertyDescriptors(source), before);
    assert.equal(player.spellTrap[0], source);
    assert.equal(player.field.length, 0);
  });
}
