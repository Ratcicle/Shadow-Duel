import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import "../../scripts/register_node_asset_loader.js";
import Card from "../../src/core/Card.js";
import Player from "../../src/core/Player.js";
import type { DuelCardId, PlayerId } from "../../src/core/contracts/primitives.js";
import type Renderer from "../../src/ui/Renderer.js";
import type { UiCard, UiCardElement } from "../../src/ui/renderer/types.js";
import type { CardElementOptions } from "../../src/ui/renderer/preview.js";
import type { FieldPlacementRequest } from "../../src/core/contracts/placement.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";

const { renderField, renderSpellTrap } = await import(
  "../../src/ui/renderer/board.js"
);
const { bindZoneCardClick, bindCardHover } = await import(
  "../../src/ui/renderer/bindings.js"
);
const { chooseFieldPlacement, cancelFieldPlacement, refreshFieldPlacement } = await import("../../src/ui/renderer/placement.js");

// Only the DOM operations used by the board and delegated event bindings are
// modeled here. Layout and native pointer hit testing belong to browser QA.
class BoardElement extends EventTarget {
  readonly children: BoardElement[] = [];
  readonly dataset: Record<string, string | undefined> = {};
  readonly style: Record<string, string> = {};
  parentElement: BoardElement | null = null;
  className = "";
  id = "";
  readonly fragment: boolean;
  private html = "";
  readonly attributes = new Map<string, string>();
  textContent = "";
  tabIndex = -1;

  constructor(fragment = false) {
    super();
    this.fragment = fragment;
  }

  readonly classList = {
    add: (...names: string[]) => {
      this.className = [...new Set([...this.className.split(/\s+/), ...names])]
        .filter(Boolean)
        .join(" ");
    },
    contains: (name: string) => this.className.split(/\s+/).includes(name),
    remove: (...names: string[]) => {
      this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" ");
    },
  };

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  get isConnected(): boolean { return this.id === "game-container" || Boolean(this.parentElement?.isConnected); }
  contains(node: BoardElement): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  remove(): void {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  focus(): void {
    Object.defineProperty(document, "activeElement", { configurable: true, value: this });
    for (let parent = this.parentElement; parent; parent = parent.parentElement) {
      const event = new Event("focusin");
      Object.defineProperty(event, "target", { value: this });
      parent.dispatchEvent(event);
    }
  }
  querySelectorAll(selector: string): BoardElement[] { return this.descendantsWithClass(selector.slice(1)); }
  querySelector(selector: string): BoardElement | null { return this.querySelectorAll(selector)[0] ?? null; }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
  }

  appendChild(child: BoardElement): BoardElement {
    if (child.fragment) {
      for (const entry of [...child.children]) this.appendChild(entry);
      child.children.length = 0;
    } else {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }

  closest(selector: string): BoardElement | null {
    for (let node: BoardElement | null = this; node; node = node.parentElement) {
      if (selector.startsWith(".") && node.classList.contains(selector.slice(1)))
        return node;
      if (selector.startsWith("#") && node.id === selector.slice(1)) return node;
    }
    return null;
  }

  descendantsWithClass(name: string): BoardElement[] {
    return this.children.flatMap((child) => [
      ...(child.classList.contains(name) ? [child] : []),
      ...child.descendantsWithClass(name),
    ]);
  }

  dispatchFrom(type: "click" | "mouseover", target: BoardElement): void {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    this.dispatchEvent(event);
  }
}

type Row = "field" | "spellTrap";
interface CardRenderCall {
  card: UiCard;
  visible: boolean;
  options: CardElementOptions;
  element: BoardElement;
}

function createBoard(t: TestContext) {
  const nodes = new Map<string, BoardElement>();
  const element = (id: string, parent?: BoardElement) => {
    const node = new BoardElement();
    node.id = id;
    nodes.set(id, node);
    parent?.appendChild(node);
    return node;
  };
  const gameContainer = element("game-container");
  const playerArea = element("player-area", gameContainer);
  const botArea = element("bot-area", gameContainer);
  const elements = {
    phaseTrack: element("phase-track", gameContainer),
    playerField: element("player-field", playerArea),
    playerSpellTrap: element("player-spelltrap", playerArea),
    botField: element("bot-field", botArea),
    botSpellTrap: element("bot-spelltrap", botArea),
  };
  const previousGlobals = new Map(["document", "HTMLElement", "Element"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const documentEvents = new EventTarget();
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: BoardElement });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: BoardElement });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: unsafeFixture<Document>(
      {
        createElement: () => new BoardElement(),
        createDocumentFragment: () => new BoardElement(true),
        getElementById: (id: string) => nodes.get(id) ?? null,
        addEventListener: documentEvents.addEventListener.bind(documentEvents),
        removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
        activeElement: null,
      },
      "The board test supplies only its element, fragment and ID lookup DOM operations.",
    ),
  });
  t.after(() => {
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  const calls: CardRenderCall[] = [];
  const previews: Array<UiCard | null> = [];
  const renderer = unsafeFixture<Renderer>(
    {
      elements,
      activeFieldPlacement: null,
      refreshFieldPlacement,
      createCardElement(
        card: UiCard | null | undefined,
        visible: boolean,
        options: CardElementOptions = {},
      ): UiCardElement {
        assert.ok(card, "Empty slots must never request a placeholder card.");
        const node = new BoardElement();
        node.className = "card";
        node.dataset.cardKey = String(card.instanceId);
        const content = new BoardElement();
        content.className = "card-name";
        node.appendChild(content);
        calls.push({ card, visible, options, element: node });
        return unsafeFixture<UiCardElement>(
          node,
          "Card artwork is replaced by a minimal DOM element to isolate board structure.",
        );
      },
      renderPreview: (card: UiCard | null) => previews.push(card),
    },
    "Board rendering and binding tests intentionally omit unrelated Renderer services.",
  );
  return {
    renderer,
    calls,
    previews,
    gameContainer,
    phaseTrack: elements.phaseTrack,
    dispatchKey(key: string, shiftKey = false) {
      const event = new Event("keydown", { cancelable: true });
      Object.defineProperties(event, { key: { value: key }, shiftKey: { value: shiftKey } });
      documentEvents.dispatchEvent(event);
    },
    row(owner: PlayerId, zone: Row) {
      return required(
        nodes.get(`${owner}-${zone === "field" ? "field" : "spelltrap"}`),
      );
    },
  };
}

function populate(owner: PlayerId, count: number) {
  const player = new Player(owner, owner, owner === "bot" ? "ai" : "human");
  for (let index = 0; index < count; index++) {
    player.field.push(
      new Card({ name: `Monster ${index}`, cardKind: "monster" }, owner),
    );
    player.spellTrap.push(
      new Card(
        {
          name: `Spell/Trap ${index}`,
          cardKind: index % 2 === 0 ? "spell" : "trap",
        },
        owner,
      ),
    );
    required(player.field[index]).fieldSlot = required(([0, 1, 2, 3, 4] as const)[index]);
    required(player.spellTrap[index]).fieldSlot = required(([0, 1, 2, 3, 4] as const)[index]);
  }
  return player;
}

function renderRows(renderer: Renderer, player: Player): void {
  renderField.call(renderer, player, { turnCounter: 7 });
  renderSpellTrap.call(renderer, player);
}

function assertSlots(
  row: BoardElement,
  cards: readonly Card[],
  location: Row,
): void {
  assert.equal(row.children.length, 5, `${row.id} must always contain five slots`);
  assert.equal(row.descendantsWithClass("field-card-slot").length, 5);
  assert.equal(row.descendantsWithClass("card").length, cards.length);
  row.children.forEach((slot, index) => {
    assert.equal(slot.className, "field-card-slot");
    assert.equal(slot.dataset.index, undefined, "The slot is not a card identity.");
    assert.equal(slot.dataset.location, undefined);
    const localSlot = row.id.startsWith("bot-") ? 4 - index : index;
    assert.equal(slot.dataset.fieldSlot, String(localSlot));
    const card = cards.find((entry) => entry.fieldSlot === localSlot);
    if (!card) {
      assert.equal(slot.children.length, 0);
      return;
    }
    assert.equal(slot.children.length, 1);
    const rendered = required(slot.children[0]);
    assert.ok(rendered.classList.contains("card"));
    assert.equal(rendered.dataset.index, String(cards.indexOf(card)));
    assert.equal(rendered.dataset.location, location);
    assert.equal(rendered.dataset.cardKey, String(card.instanceId));
  });
}

for (const owner of ["player", "bot"] as const) {
  for (let count = 0; count <= 5; count++) {
    test(`${owner} board renders five slots per row with ${count} real cards`, (t) => {
      const board = createBoard(t);
      const player = populate(owner, count);
      const field = player.field;
      const spellTrap = player.spellTrap;
      const before = JSON.stringify([field, spellTrap]);
      // Freezing exposes accidental sorting, padding, card annotations or removal.
      for (const card of [...field, ...spellTrap]) Object.freeze(card);
      Object.freeze(field);
      Object.freeze(spellTrap);
      renderRows(board.renderer, player);

      assertSlots(board.row(owner, "field"), field, "field");
      assertSlots(board.row(owner, "spellTrap"), spellTrap, "spellTrap");
      assert.equal(board.calls.length, count * 2);
      assert.equal(player.field, field);
      assert.equal(player.spellTrap, spellTrap);
      assert.equal(JSON.stringify([field, spellTrap]), before);
      assert.deepEqual(board.calls.map(({ card }) => card), [
        ...field,
        ...spellTrap,
      ]);
    });
  }

  test(`${owner} list reindexes without moving surviving cards between slots`, (t) => {
    const board = createBoard(t);
    const player = populate(owner, 5);
    renderRows(board.renderer, player);
    const removedMonster = player.field.splice(1, 1)[0];
    const removedSpell = player.spellTrap.splice(2, 1)[0];
    board.calls.length = 0;
    renderRows(board.renderer, player);

    assertSlots(board.row(owner, "field"), player.field, "field");
    assertSlots(board.row(owner, "spellTrap"), player.spellTrap, "spellTrap");
    assert.ok(
      board.calls.every(
        ({ card }) => card !== removedMonster && card !== removedSpell,
      ),
    );
    assert.deepEqual(board.calls.map(({ card }) => card), [
      ...player.field,
      ...player.spellTrap,
    ]);
  });

  test(`${owner} slots preserve attack, defense, facedown and status render options`, (t) => {
    const board = createBoard(t);
    const player = populate(owner, 3);
    required(player.field[0]).position = "attack";
    required(player.field[1]).position = "defense";
    required(player.field[2]).position = "defense";
    required(player.field[2]).isFacedown = true;
    required(player.spellTrap[1]).isFacedown = true;
    required(player.spellTrap[2]).isFacedown = true;
    renderRows(board.renderer, player);

    const byListIndex = (left: BoardElement, right: BoardElement) => Number(left.dataset.index) - Number(right.dataset.index);
    const monsters = board.row(owner, "field").descendantsWithClass("card").sort(byListIndex);
    assert.deepEqual(
      monsters.map((card) => card.classList.contains("defense")),
      [false, true, true],
    );
    assert.deepEqual(
      monsters.map((card) => card.classList.contains("facedown")),
      [false, false, true],
    );
    assert.equal(required(monsters[2]).innerHTML, '<div class="card-back"></div>');
    assert.equal(required(monsters[2]).style.backgroundImage, "none");
    const spells = board.row(owner, "spellTrap").descendantsWithClass("card").sort(byListIndex);
    assert.deepEqual(
      spells.map((card) => card.classList.contains("facedown")),
      [false, true, true],
    );
    assert.equal(required(spells[1]).innerHTML, '<div class="card-back"></div>');
    assert.equal(required(spells[2]).innerHTML, '<div class="card-back"></div>');
    for (const call of board.calls.slice(0, 3)) {
      assert.equal(call.visible, true);
      assert.deepEqual(call.options, { showStatusIcons: true, turnCounter: 7 });
    }
    assert.deepEqual(board.calls.slice(3).map(({ visible }) => visible), [
      true,
      owner === "player",
      owner === "player",
    ]);
  });

  for (const location of ["field", "spellTrap"] as const) {
    test(`${owner} ${location} delegates only real card clicks and hover through slots`, (t) => {
      const board = createBoard(t);
      const player = populate(owner, 2);
      required(player[location][1]).fieldSlot = 4;
      renderRows(board.renderer, player);
      const row = board.row(owner, location);
      const clicks: Array<{ index: number; element: HTMLElement }> = [];
      const hovers: Array<{
        owner: PlayerId;
        location: string | undefined;
        index: number;
      }> = [];
      bindZoneCardClick.call(board.renderer, row.id, (_event, element, index) => {
        clicks.push({ index, element });
      });
      bindCardHover.call(board.renderer, (cardOwner, cardLocation, index) => {
        hovers.push({ owner: cardOwner, location: cardLocation, index });
      });
      const emptySlot = required(row.children[2], "empty middle slot");
      row.dispatchFrom("click", emptySlot);
      board.gameContainer.dispatchFrom("mouseover", emptySlot);
      assert.deepEqual(clicks, []);
      assert.deepEqual(hovers, []);
      assert.deepEqual(board.previews, [null]);

      const card = required(row.descendantsWithClass("card").find((entry) => entry.dataset.index === "1"));
      const content = required(card.children[0]);
      row.dispatchFrom("click", card);
      row.dispatchFrom("click", content);
      board.gameContainer.dispatchFrom("mouseover", content);
      assert.deepEqual(clicks.map(({ index }) => index), [1, 1]);
      assert.ok(clicks.every(({ element }) => Object.is(element, card)));
      assert.deepEqual(hovers, [{ owner, location, index: 1 }]);

      card.classList.add("hidden");
      board.gameContainer.dispatchFrom("mouseover", content);
      assert.equal(
        hovers.length,
        1,
        "Existing hidden-card hover guard must remain effective.",
      );
    });
  }
}

function placementRequest(allowCancel = true): FieldPlacementRequest {
  return {
    procedureId: "placement:test",
    decidingPlayerId: "player",
    destinationPlayerId: "player",
    row: "field",
    duelCardId: unsafeFixture<DuelCardId>("card:test", "UI placement preserves the opaque card identity without resolving it."),
    allowCancel,
    candidates: [{ candidateKey: "slot:2", slot: 2 }, { candidateKey: "slot:4", slot: 4 }],
  };
}

test("manual placement chooses the fifth slot without invoking card handlers", async (t) => {
  const board = createBoard(t);
  const player = populate("player", 1);
  renderRows(board.renderer, player);
  const row = board.row("player", "field");
  let clicks = 0;
  bindZoneCardClick.call(board.renderer, row.id, () => { clicks++; });
  const pending = chooseFieldPlacement.call(board.renderer, placementRequest());
  assert.equal(row.children.filter((slot) => slot.classList.contains("placement-available")).length, 2);
  assert.equal(required(row.children[0]).classList.contains("placement-available"), false);
  board.gameContainer.dispatchFrom("click", required(row.children[0]));
  assert.ok(board.renderer.activeFieldPlacement);
  board.gameContainer.dispatchFrom("click", required(row.children[4]));
  assert.deepEqual(await pending, { outcome: "chosen", slot: 4 });
  assert.equal(clicks, 0);
  assert.equal(board.renderer.activeFieldPlacement, null);
  assert.equal(row.children.some((slot) => slot.classList.contains("placement-available")), false);
  assert.equal(board.phaseTrack.children.length, 0);
});

test("placement survives row rerenders, retains focus, and supports keyboard choice", async (t) => {
  const board = createBoard(t);
  const player = populate("player", 0);
  renderRows(board.renderer, player);
  const pending = chooseFieldPlacement.call(board.renderer, placementRequest());
  const row = board.row("player", "field");
  required(row.children[4]).focus();
  // Native DOM returns focus to body when the focused child is detached.
  Object.defineProperty(document, "body", { configurable: true, value: null });
  Object.defineProperty(document, "activeElement", { configurable: true, value: null });
  renderRows(board.renderer, player);
  assert.equal(document.activeElement, row.children[4]);
  board.dispatchKey("Enter");
  assert.deepEqual(await pending, { outcome: "chosen", slot: 4 });
});

test("cancel is explicit before commitment; mandatory choice ignores Escape and abort rejects", async (t) => {
  const board = createBoard(t);
  renderRows(board.renderer, populate("player", 0));
  const cancelable = chooseFieldPlacement.call(board.renderer, placementRequest());
  board.dispatchKey("Escape");
  assert.deepEqual(await cancelable, { outcome: "cancelled" });

  const mandatory = chooseFieldPlacement.call(board.renderer, placementRequest(false));
  board.dispatchKey("Escape");
  assert.ok(board.renderer.activeFieldPlacement);
  const aborted = assert.rejects(mandatory, { name: "AbortError" });
  cancelFieldPlacement.call(board.renderer);
  await aborted;
  assert.equal(board.renderer.activeFieldPlacement, null);
  assert.equal(board.phaseTrack.children.length, 0);
  const next = chooseFieldPlacement.call(board.renderer, placementRequest());
  board.gameContainer.dispatchFrom("click", required(board.row("player", "field").children[2]));
  assert.deepEqual(await next, { outcome: "chosen", slot: 2 });
});

test("renderer rejects missing and duplicate canonical positions instead of inventing slots", (t) => {
  const board = createBoard(t);
  const player = populate("player", 2);
  required(player.field[1]).fieldSlot = null;
  assert.throws(() => renderRows(board.renderer, player), /Invalid field position/);
  required(player.field[1]).fieldSlot = 0;
  assert.throws(() => renderRows(board.renderer, player), /Invalid field position/);
});

test("human placement into the opponent row returns local coordinates and ignores occupied candidates", async (t) => {
  const board = createBoard(t);
  const opponent = populate("bot", 1);
  required(opponent.field[0]).fieldSlot = 2;
  renderRows(board.renderer, opponent);
  const pending = chooseFieldPlacement.call(board.renderer, {
    ...placementRequest(), destinationPlayerId: "bot",
  });
  const row = board.row("bot", "field");
  assert.equal(required(row.children[2]).classList.contains("placement-available"), false);
  assert.equal(required(row.children[0]).dataset.fieldSlot, "4");
  assert.equal(required(row.children[0]).classList.contains("placement-available"), true);
  board.gameContainer.dispatchFrom("click", required(row.children[0]));
  assert.deepEqual(await pending, { outcome: "chosen", slot: 4 });
});
