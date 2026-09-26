import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import "../scripts/register_node_asset_loader.js";
import Bot from "../src/core/Bot.js";
import { cardDatabaseById } from "../src/data/cards.js";
import { getMainDom } from "../src/ui/main/domRefs.js";
import { createDeckState, DECK_PRESETS_KEY, sortDeck, sortExtraDeck } from "../src/ui/main/deckState.js";
import { createMemoryStorage } from "./helpers/game.js";
import { unsafeFixture } from "./helpers/fixtures.js";
import type { ConfirmPromptOptions } from "../src/ui/renderer/modals.js";

const { createDeckBuilderController } = await import("../src/ui/main/deckBuilderController.js");

test("default Main sort uses category, descending Level/ATK/DEF, then name and subtype", (t) => {
  const monsters = [
    { id: 1, name: "Lv 1", level: 1, atk: 9999, def: 9999 },
    { id: 2, name: "Lv 4", level: 4, atk: 2000, def: 1000 },
    { id: 3, name: "Lv 8", level: 8, atk: 2000, def: 1000 },
    { id: 4, name: "Lv 10", level: 10, atk: 2000, def: 1000 },
    { id: 5, name: "Low ATK", level: 12, atk: 3000, def: 4000 },
    { id: 6, name: "Low DEF", level: 12, atk: 4000, def: 3000 },
    { id: 7, name: "Zulu", level: 12, atk: 4000, def: 4000 },
    { id: 8, name: "Alpha", level: 12, atk: 4000, def: 4000 },
  ].map(card => ({ ...card, cardKind: "monster" as const }));
  const cards = [...monsters,
    { id: 9, name: "A field", cardKind: "spell" as const, subtype: "field" },
    { id: 10, name: "Zulu", cardKind: "spell" as const, subtype: "normal" },
    { id: 11, name: "Alpha", cardKind: "spell" as const, subtype: "normal" },
    { id: 12, name: "A counter", cardKind: "trap" as const, subtype: "counter" },
    { id: 13, name: "Zulu", cardKind: "trap" as const, subtype: "normal" },
    { id: 14, name: "Alpha", cardKind: "trap" as const, subtype: "normal" },
  ];
  t.mock.method(cardDatabaseById, "get", (id: number) => cards.find(card => card.id === id));
  const input = [999, ...cards.map(card => card.id)];
  const original = [...input];
  assert.deepEqual(sortDeck(input), [8, 7, 6, 5, 4, 3, 2, 1, 11, 10, 9, 14, 13, 12, 999]);
  assert.deepEqual(input, original);
});

test("default Extra sort preserves Fusion/Synchro/Ascension and ranks each family descending", (t) => {
  const cards = ["fusion", "synchro", "ascension"].flatMap((monsterType, group) => [
    { id: group * 10 + 1, name: "Low level", level: 1, atk: 9999, def: 9999 },
    { id: group * 10 + 2, name: "Low ATK", level: 8, atk: 1000, def: 4000 },
    { id: group * 10 + 3, name: "Low DEF", level: 8, atk: 3000, def: 1000 },
    { id: group * 10 + 4, name: "Zulu", level: 8, atk: 3000, def: 3000 },
    { id: group * 10 + 5, name: "Alpha", level: 8, atk: 3000, def: 3000 },
  ].map(card => ({ ...card, monsterType, cardKind: "monster" })));
  t.mock.method(cardDatabaseById, "get", (id: number) => cards.find(card => card.id === id));
  const input = cards.map(card => card.id).reverse();
  assert.deepEqual(sortExtraDeck(input), [5, 4, 3, 2, 1, 15, 14, 13, 12, 11, 25, 24, 23, 22, 21]);
  assert.equal(input[0], 25);
});

// Minimal event/DOM surface: real controller, deck state and card database run unchanged.
class ElementFixture extends EventTarget {
  className = "";
  children: ElementFixture[] = [];
  dataset: Record<string, string> = {};
  style = { backgroundImage: "", setProperty() {} };
  value = "";
  textContent: string | null = "";
  disabled = false;
  title = "";
  onclick: (() => void) | null = null;
  onmouseenter: (() => void) | null = null;
  attributes = new Map<string, string>();
  html = "";
  classList = {
    add: (...values: string[]) => { this.className = [...new Set([...this.className.split(" "), ...values])].join(" "); },
    remove: (...values: string[]) => { this.className = this.className.split(" ").filter(value => !values.includes(value)).join(" "); },
    contains: (value: string) => this.className.split(" ").includes(value),
    toggle: (value: string, force = !this.classList.contains(value)) => {
      if (force) this.classList.add(value); else this.classList.remove(value);
      return force;
    },
  };
  set innerHTML(value: string) { this.html = value; this.children = []; }
  get innerHTML() { return this.html; }
  append(...children: ElementFixture[]) { this.children.push(...children); }
  appendChild(child: ElementFixture) { this.append(child); return child; }
  replaceChildren(...children: ElementFixture[]) { this.children = children; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  click() { if (!this.disabled) { this.onclick?.(); this.dispatchEvent(new Event("click")); } }
  change(value: string, type = "change") { this.value = value; this.dispatchEvent(new Event(type)); }
}

function setup(t: TestContext) {
  const previous = { document: globalThis.document, localStorage: globalThis.localStorage, confirm: globalThis.confirm };
  const nodes = new Map<string, ElementFixture>();
  const node = (id: string) => { let element = nodes.get(id); if (!element) { element = new ElementFixture(); nodes.set(id, element); } return element; };
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;
  globalThis.document = unsafeFixture<Document>({
    getElementById: (id: string) => ["deck-slot-tabs", "start-deck-menu"].includes(id) ? null : node(id),
    querySelector: (selector: string) => selector.startsWith("#") ? node(selector.slice(1)) : null,
    querySelectorAll: () => [],
    createElement: () => new ElementFixture(),
  }, "DOM fixture implements only the deck controller's element creation, queries and events.");
  let accepted: boolean | Promise<boolean> = true;
  const confirmations: Array<{ message: string; options?: ConfirmPromptOptions }> = [];
  globalThis.confirm = () => assert.fail("Deck Builder must use the injected custom prompt");
  t.after(() => { Object.assign(globalThis, previous); });
  storage.setItem(DECK_PRESETS_KEY, JSON.stringify({ idSchemaVersion: 3, presets: [{ name: "Fixture", deck: [1, 3, 13], extraDeck: [121, 122] }] }));
  const state = createDeckState();
  const controller = createDeckBuilderController({ dom: getMainDom().deckBuilder, deckState: state, Bot,
    confirmPrompt: async (message, options) => { confirmations.push({ message, options }); return accepted; },
    getCardDisplayName: card => card?.name || "", getCardDisplayDescription: card => card?.description || "" });
  controller.bind(null);
  controller.open(null);
  return { state, controller, node, storage, confirmations, cancel: () => { accepted = false; }, accept: () => { accepted = true; },
    defer: () => {
      let resolve!: (value: boolean) => void;
      accepted = new Promise<boolean>(finish => { resolve = finish; });
      return resolve;
    } };
}

const flushPrompt = () => new Promise<void>(resolve => setImmediate(resolve));

test("opening and selecting default sort actually sort in memory without saving", (t) => {
  const { state, controller, node, storage } = setup(t);
  const saved = storage.getItem(DECK_PRESETS_KEY);
  assert.deepEqual(node("deck-sort-mode").children.map(option => option.value), ["default", "type", "level", "name"]);
  assert.deepEqual(state.getCurrentDeck(), sortDeck([1, 3, 13]));
  node("deck-sort-mode").change("name");
  node("deck-sort-mode").change("default");
  assert.deepEqual(state.getCurrentDeck(), sortDeck([1, 3, 13]));
  state.setCurrentDeck([1, 13, 3]);
  controller.open(null);
  assert.deepEqual(state.getCurrentDeck(), sortDeck([1, 3, 13]));
  assert.equal(storage.getItem(DECK_PRESETS_KEY), saved);
  node("pool-grid").children.find(card => !card.classList.contains("extra-deck-thumb"))!.click();
  assert.deepEqual(state.getCurrentDeck(), sortDeck(state.getCurrentDeck()));
  assert.equal(storage.getItem(DECK_PRESETS_KEY), saved);
});

for (const view of ["grid", "list"]) {
  for (const zone of ["main", "extra"] as const) {
    test(`clear ${zone} in ${view} preserves the other zone, controls, preview and storage`, async (t) => {
      const { state, node, storage, confirmations, cancel, accept } = setup(t);
      node("deck-view-mode").change(view);
      node("deck-sort-mode").change("name");
      node("deck-category-filter").change("monsters");
      node("deck-type-subtype-filter").change("monster-type:Fiend");
      node("deck-archetype-filter").change("archetype:Shadow-Heart");
      node("deck-search").change("Shadow", "input");
      node("pool-grid").children[1]!.onmouseenter?.();
      const currentPreview = node("deck-preview-name").textContent;
      const before = { main: [...state.getCurrentDeck()], extra: [...state.getCurrentExtraDeck()] };
      const saved = storage.getItem(DECK_PRESETS_KEY);
      const button = () => view === "grid" ? node(zone === "main" ? "deck-clear-main" : "deck-clear-extra")
        : node("deck-list").children[zone === "main" ? 0 : 1]!.children[0]!.children.find(child => child.classList.contains("deck-clear-button"))!;
      assert.ok(button(), "The zone exposes a clear action in both views.");
      cancel(); button().click();
      await flushPrompt();
      assert.deepEqual(state.getCurrentDeck(), before.main);
      assert.deepEqual(state.getCurrentExtraDeck(), before.extra);
      accept(); button().click();
      await flushPrompt();
      assert.equal(confirmations.length, 2);
      const title = zone === "main" ? "Main Deck" : "Extra Deck";
      assert.deepEqual(confirmations[1], {
        message: `Clear all cards from the ${title}?`,
        options: { title: `Clear ${title}`, confirmLabel: "Clear", cancelLabel: "Cancel" },
      });
      assert.deepEqual(state.getCurrentDeck(), zone === "main" ? [] : before.main);
      assert.deepEqual(state.getCurrentExtraDeck(), zone === "extra" ? [] : before.extra);
      assert.equal(node(zone === "main" ? "deck-count" : "extradeck-count").textContent, zone === "main" ? "0/30" : "0/10");
      assert.equal(button().disabled, true);
      assert.equal(node("deck-preview-name").textContent, currentPreview);
      assert.equal(node("deck-search").value, "Shadow");
      assert.equal(node("deck-category-filter").value, "monsters");
      assert.equal(node("deck-type-subtype-filter").value, "monster-type:Fiend");
      assert.equal(node("deck-archetype-filter").value, "archetype:Shadow-Heart");
      assert.equal(node("deck-sort-mode").value, "name");
      assert.equal(node("deck-view-mode").value, view);
      assert.equal(node("deck-grid").children.length, 30);
      assert.equal(node("extradeck-grid").children.length, 10);
      assert.equal(storage.getItem(DECK_PRESETS_KEY), saved);
      node("deck-category-filter").change(zone === "main" ? "monsters" : "extra");
      node("pool-grid").children[0]!.click();
      assert.equal((zone === "main" ? state.getCurrentDeck() : state.getCurrentExtraDeck()).length, 1);
    });
  }
}

test("pending clear prompts cannot duplicate or clear another deck after switching slots", async (t) => {
  const { state, controller, node, confirmations, defer } = setup(t);
  const answer = defer();
  const original = [...state.getCurrentDeck()];
  node("deck-clear-main").click();
  node("deck-clear-main").click();
  assert.equal(confirmations.length, 1);
  assert.deepEqual(state.getCurrentDeck(), original);
  state.switchDeckSlot(1);
  controller.render();
  const otherDeck = [...state.getCurrentDeck()];
  answer(true);
  await flushPrompt();
  assert.deepEqual(state.getCurrentDeck(), otherDeck);
});

test("grid add/remove updates one copy immediately and identifies the sorted slots canonically", (t) => {
  const { state, node } = setup(t);
  state.setCurrentDeck([1, 1, 3]);
  node("deck-sort-mode").change("default");
  const source = node("pool-grid").children.find(card => card.dataset.cardId === "1")!;
  assert.ok(source);
  source.click();
  assert.equal(state.getCurrentDeck().filter(id => id === 1).length, 3);
  assert.deepEqual(state.getCurrentDeck(), sortDeck([1, 1, 1, 3]));
  const index = state.getCurrentDeck().lastIndexOf(1);
  const slot = node("deck-grid").children[index]!;
  assert.equal(slot.dataset.deckIndex, String(index));
  assert.equal(slot.dataset.deckZone, "main");
  assert.equal(slot.children[0]!.dataset.cardId, "1");
  slot.children[0]!.click();
  assert.equal(state.getCurrentDeck().filter(id => id === 1).length, 2);
  assert.deepEqual(state.getCurrentDeck(), sortDeck([1, 1, 3]));
});
