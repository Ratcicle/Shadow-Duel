import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import type { CanonicalReplayGamePort } from "../../src/core/contracts/replay.js";
import { getCardDatabaseSignature, serializeReplayEventPayload } from "../../src/core/game/replay/canonical.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";

test("P2 event serialization preserves immutable declared filters with a card name and kind", () => {
  const filter = Object.freeze({ name: "Bloomrot Living Colony", cardKind: "spell", subtype: "field" });
  const payload = { actions: [{ conditions: [{ type: "control_card_filters", filters: filter }] }] };
  const game: CanonicalReplayGamePort = {
    ensureDuelCardId() { return assert.fail("A declared filter cannot receive a physical card identity"); },
  };
  assert.deepEqual(serializeReplayEventPayload(game, payload), payload);
  assert.equal(Object.hasOwn(filter, "duelCardId"), false);
});

test("P2 Germination condition serialization cannot mutate the live card database signature", t => {
  const game = createRuntimeGame({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose());
  const source = new Card(cardDefinition(416), "player");
  const effect = required(source.effects.find(entry => entry.id === "bloomrot_sudden_germination_attack"));
  const optionalAction = required(effect.actions?.find(action => action.type === "optional_target_actions"));
  const before = getCardDatabaseSignature();
  const projected = serializeReplayEventPayload(game, { actions: [optionalAction] });
  assert.equal(getCardDatabaseSignature(), before);
  assert.deepEqual(projected, JSON.parse(JSON.stringify({ actions: [optionalAction] })));
});

test("P2 physical cards retain distinct duel identities without exporting local instance IDs", t => {
  const game = createRuntimeGame({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose());
  const first = new Card(cardDefinition(416), "player");
  const second = new Card(cardDefinition(416), "player");
  first.locationVersion = 3;
  const projected = serializeReplayEventPayload(game, { cards: [first, second] });
  assert.notEqual(first.duelCardId, second.duelCardId);
  assert.deepEqual(projected, { cards: [
    { cardId: 416, duelCardId: game.ensureDuelCardId(first), locationVersion: 3 },
    { cardId: 416, duelCardId: game.ensureDuelCardId(second), locationVersion: 0 },
  ] });
  assert.equal(JSON.stringify(projected).includes("instanceId"), false);
});
