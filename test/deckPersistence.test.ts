import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import "../scripts/register_node_asset_loader.js";
import Bot from "../src/core/Bot.js";
import Game from "../src/core/Game.js";
import {
  ACTIVE_DECK_SLOT_KEY,
  DECK_PRESETS_KEY,
  buildDefaultDeck,
  createDeckState,
} from "../src/ui/main/deckState.js";
import { createMemoryStorage } from "./helpers/game.js";

const { default: BotArena } = await import("../src/core/BotArena.js");

function installStorage(context: TestContext) {
  const previous = globalThis.localStorage;
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;
  context.after(() => {
    globalThis.localStorage = previous;
  });
  context.mock.method(console, "warn", () => {});
  return storage;
}

test("current deck format preserves card identity, names and active slot", (t) => {
  const storage = installStorage(t);
  storage.setItem(DECK_PRESETS_KEY, JSON.stringify({
    idSchemaVersion: 3,
    presets: [
      { name: "First", deck: [1, 3], extraDeck: [] },
      { name: "Saved", deck: [13, 101], extraDeck: [121, 122] },
    ],
  }));
  storage.setItem(ACTIVE_DECK_SLOT_KEY, "1");

  const state = createDeckState();
  assert.equal(state.getActiveDeckSlot(), 1);
  assert.equal(state.getDeckPresets()[1]?.name, "Saved");
  assert.deepEqual(state.getCurrentDeck(), [13, 101]);
  assert.deepEqual(state.getCurrentExtraDeck(), [121, 122]);
  assert.equal(state.getDeckPresets().length, 8);
});

test("new deck edits, names and slots survive repeated reloads", (t) => {
  installStorage(t);
  const state = createDeckState();
  state.setCurrentDeck([13, 13, 101]);
  state.setCurrentExtraDeck([121]);
  state.renameActiveDeckSlot("  First deck  ");
  assert.equal(state.switchDeckSlot(7), true);
  state.saveDeck([1, 3]);
  state.saveExtraDeck([122]);
  state.saveActiveDeckPreset("Last deck");

  const reloaded = createDeckState();
  assert.equal(reloaded.getActiveDeckSlot(), 7);
  assert.equal(reloaded.getDeckPresets()[7]?.name, "Last deck");
  assert.deepEqual(reloaded.getCurrentDeck(), [1, 3]);
  assert.deepEqual(reloaded.getCurrentExtraDeck(), [122]);
  assert.equal(reloaded.switchDeckSlot(0), true);
  assert.equal(reloaded.getDeckPresets()[0]?.name, "First deck");
  assert.deepEqual(reloaded.getCurrentDeck(), [13, 13, 101]);
  assert.deepEqual(reloaded.getCurrentExtraDeck(), [121]);

  reloaded.saveDeck([]);
  reloaded.saveExtraDeck([]);
  const reopened = createDeckState();
  assert.equal(reopened.getActiveDeckSlot(), 0);
  assert.deepEqual(reopened.getCurrentDeck(), []);
  assert.deepEqual(reopened.getCurrentExtraDeck(), []);
});

test("unsupported deck formats are ignored even when their IDs still exist", (t) => {
  const storage = installStorage(t);
  const presets = [{ name: "Old deck", deck: [13, 101], extraDeck: [121] }];
  for (const payload of [
    presets,
    { presets },
    { idSchemaVersion: 1, presets },
    { idSchemaVersion: 2, presets },
    { idSchemaVersion: 4, presets },
    { idSchemaVersion: "3", presets },
  ]) {
    const stored = JSON.stringify(payload);
    storage.setItem(DECK_PRESETS_KEY, stored);
    const state = createDeckState();
    assert.deepEqual(state.getCurrentDeck(), buildDefaultDeck(), stored);
    assert.deepEqual(state.getCurrentExtraDeck(), [], stored);
    assert.equal(state.getDeckPresets()[0]?.name, "Deck 1", stored);
    assert.equal(storage.getItem(DECK_PRESETS_KEY), stored);
  }
});

test("missing or malformed persisted decks open with the default deck", (t) => {
  const storage = installStorage(t);
  for (const stored of [null, "", "{", "null", "false", "42", '"deck"', "{}",
    '{"idSchemaVersion":3,"presets":{}}']) {
    if (stored === null) storage.removeItem(DECK_PRESETS_KEY);
    else storage.setItem(DECK_PRESETS_KEY, stored);
    const state = createDeckState();
    assert.deepEqual(state.getCurrentDeck(), buildDefaultDeck(), String(stored));
    assert.deepEqual(state.getCurrentExtraDeck(), []);
  }
});

test("malformed slots use defaults without discarding other current slots", (t) => {
  const storage = installStorage(t);
  for (const invalidPreset of [null, [], "deck", {},
    { name: 42, deck: [13], extraDeck: [] },
    { name: "Invalid", deck: "13", extraDeck: [] },
    { name: "Invalid", deck: ["13"], extraDeck: [] },
    { name: "Invalid", deck: [13], extraDeck: {} },
    { name: "Invalid", deck: [13], extraDeck: [null] }]) {
    storage.setItem(DECK_PRESETS_KEY, JSON.stringify({
      idSchemaVersion: 3,
      presets: [invalidPreset, { name: "Valid", deck: [101], extraDeck: [121] }],
    }));
    const state = createDeckState();
    assert.deepEqual(state.getCurrentDeck(), buildDefaultDeck());
    assert.deepEqual(state.getCurrentExtraDeck(), []);
    assert.equal(state.getDeckPresets()[0]?.name, "Deck 1");
    assert.deepEqual(state.getDeckPresets()[1], {
      name: "Valid", deck: [101], extraDeck: [121],
    });
  }
});

test("deck storage never reads or writes old keys or removes unrelated preferences", (t) => {
  const storage = installStorage(t);
  const oldValues = {
    shadow_duel_deck: "[13,101]",
    shadow_duel_extra_deck: "[121]",
    shadow_duel_deck_id_schema_version: "3",
    shadow_duel_language: "pt-br",
    shadow_duel_bot_preset: "dragon",
  };
  for (const [key, value] of Object.entries(oldValues)) storage.setItem(key, value);
  const read = storage.getItem.bind(storage);
  const write = storage.setItem.bind(storage);
  const reads: string[] = [];
  const writes: string[] = [];
  t.mock.method(storage, "getItem", (key: string) => {
    reads.push(key);
    return read(key);
  });
  t.mock.method(storage, "setItem", (key: string, value: string) => {
    writes.push(key);
    write(key, value);
  });

  const state = createDeckState();
  assert.deepEqual(state.getCurrentDeck(), buildDefaultDeck());
  state.saveDeck([13, 101]);
  state.saveExtraDeck([121]);
  const reloaded = createDeckState();
  assert.deepEqual(reloaded.getCurrentDeck(), [13, 101]);
  assert.deepEqual(reloaded.getCurrentExtraDeck(), [121]);
  assert.deepEqual([...new Set(reads)].sort(), [ACTIVE_DECK_SLOT_KEY, DECK_PRESETS_KEY].sort());
  assert.deepEqual([...new Set(writes)].sort(), [ACTIVE_DECK_SLOT_KEY, DECK_PRESETS_KEY].sort());
  for (const [key, value] of Object.entries(oldValues)) assert.equal(read(key), value);
});

test("unavailable storage does not prevent deck editing", (t) => {
  const storage = installStorage(t);
  t.mock.method(storage, "getItem", () => { throw new Error("Storage denied"); });
  t.mock.method(storage, "setItem", () => { throw new Error("Storage full"); });
  const state = createDeckState();
  assert.deepEqual(state.getCurrentDeck(), buildDefaultDeck());
  state.saveDeck([1, 13]);
  state.saveExtraDeck([121]);
  assert.deepEqual(state.getCurrentDeck(), [1, 13]);
  assert.deepEqual(state.getCurrentExtraDeck(), [121]);
});

test("Arena reads the selected current deck and ignores old deck storage", (t) => {
  const storage = installStorage(t);
  storage.setItem("shadow_duel_deck", "[13]");
  storage.setItem("shadow_duel_extra_deck", "[121]");
  const arena = new BotArena(Game, Bot);
  assert.deepEqual(arena.loadStoredDeckData(), { main: [], extra: [] });
  const state = createDeckState();
  state.saveDeck([1]);
  state.switchDeckSlot(2);
  state.saveDeck([13, 101]);
  state.saveExtraDeck([122]);
  assert.deepEqual(arena.loadStoredDeckData(), {
    main: [13, 101], extra: [122],
  });
});
