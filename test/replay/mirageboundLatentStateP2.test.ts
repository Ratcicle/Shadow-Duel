import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState } from "../../src/core/game/replay/canonical.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const seat of ["player", "bot"] as const) test(`P2 canonical state hashes per-copy usage separately (${seat})`, t => {
  const game = createRuntimeGame({ captureReplay: false }); t.after(() => game.dispose());
  const card = new Card(cardDefinition(355), seat); placeFieldCards(game[seat].field, card);
  const effect = required(card.effects.find(entry => entry.id === "miragebound_glass_sovereign_bounce"));
  const firstHash = hashCanonicalGameState(game);
  game.markOncePerTurnUsed(card, game[seat], effect);
  const usedHash = hashCanonicalGameState(game);
  assert.notEqual(usedHash, firstHash, "latent copy usage affects the next legal activation");
  const detached = createCanonicalStateSnapshot(game);
  card.oncePerTurnResetVersion = (card.oncePerTurnResetVersion || 0) + 1;
  assert.notEqual(hashCanonicalGameState(game), usedHash);
  assert.notDeepEqual(createCanonicalStateSnapshot(game), detached, "a new presence has a distinct, fresh limit");
});

test("P2 canonical hash distinguishes external piercing from identical innate flags", t => {
  const game = createRuntimeGame({ captureReplay: false }); t.after(() => game.dispose());
  const card = new Card(cardDefinition(364), "player"); placeFieldCards(game.player.field, card);
  const firstHash = hashCanonicalGameState(game);
  card.piercingGrantedByEffect = true;
  assert.notEqual(hashCanonicalGameState(game), firstHash);
});
