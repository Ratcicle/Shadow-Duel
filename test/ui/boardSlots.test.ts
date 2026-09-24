import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import "../../scripts/register_node_asset_loader.js";
import Card from "../../src/core/Card.js";
import Player from "../../src/core/Player.js";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import type Renderer from "../../src/ui/Renderer.js";
import type { UiCard, UiCardElement } from "../../src/ui/renderer/types.js";
import type { CardElementOptions } from "../../src/ui/renderer/preview.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";

const { renderField, renderSpellTrap } = await import(
  "../../src/ui/renderer/board.js"
);
const { bindZoneCardClick, bindCardHover } = await import(
  "../../src/ui/renderer/bindings.js"
);

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
  };

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
    playerField: element("player-field", playerArea),
    playerSpellTrap: element("player-spelltrap", playerArea),
    botField: element("bot-field", botArea),
    botSpellTrap: element("bot-spelltrap", botArea),
  };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: unsafeFixture<Document>(
      {
        createElement: () => new BoardElement(),
        createDocumentFragment: () => new BoardElement(true),
        getElementById: (id: string) => nodes.get(id) ?? null,
      },
      "The board test supplies only its element, fragment and ID lookup DOM operations.",
    ),
  });
  t.after(() => {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  const calls: CardRenderCall[] = [];
  const previews: Array<UiCard | null> = [];
  const renderer = unsafeFixture<Renderer>(
    {
      elements,
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
    const card = cards[index];
    if (!card) {
      assert.equal(slot.children.length, 0);
      return;
    }
    assert.equal(slot.children.length, 1);
    const rendered = required(slot.children[0]);
    assert.ok(rendered.classList.contains("card"));
    assert.equal(rendered.dataset.index, String(index));
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

  test(`${owner} board reindexes remaining packed cards when refreshed`, (t) => {
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

    const monsters = board.row(owner, "field").descendantsWithClass("card");
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
    const spells = board.row(owner, "spellTrap").descendantsWithClass("card");
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
      const emptySlot = required(row.children[4], "empty fifth slot");
      row.dispatchFrom("click", emptySlot);
      board.gameContainer.dispatchFrom("mouseover", emptySlot);
      assert.deepEqual(clicks, []);
      assert.deepEqual(hovers, []);
      assert.deepEqual(board.previews, [null]);

      const card = required(row.descendantsWithClass("card")[1]);
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
