import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import "../scripts/register_node_asset_loader.js";
import { unsafeFixture } from "./helpers/fixtures.js";

const { showConfirmPrompt } = await import("../src/ui/renderer/modals.js");

class PromptElement extends EventTarget {
  className = "";
  textContent = "";
  type = "";
  parentNode: PromptElement | null = null;
  children: PromptElement[] = [];
  isRoot = false;
  private readonly focusElement: (element: PromptElement) => void;
  constructor(focusElement: (element: PromptElement) => void) { super(); this.focusElement = focusElement; }
  appendChild(child: PromptElement) { this.children.push(child); child.parentNode = this; }
  removeChild(child: PromptElement) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
  get isConnected(): boolean { return this.isRoot || this.parentNode?.isConnected === true; }
  focus() { this.focusElement(this); }
}

function setup(t: TestContext) {
  const previous = globalThis.document;
  const focusElement = (element: PromptElement) => { documentFixture.activeElement = element; };
  const body = new PromptElement(focusElement);
  body.isRoot = true;
  const elements: PromptElement[] = [];
  const handlers: { keydown: ((event: KeyboardEvent) => void) | null } = { keydown: null };
  const documentFixture = {
    body,
    activeElement: null as PromptElement | null,
    createElement: () => { const element = new PromptElement(focusElement); elements.push(element); return element; },
    addEventListener: (_type: string, handler: (event: KeyboardEvent) => void) => { handlers.keydown = handler; },
    removeEventListener: () => { handlers.keydown = null; },
  };
  globalThis.document = unsafeFixture<Document>(documentFixture,
    "Prompt DOM fixture models keyboard registration, element connection and active focus.");
  const trigger = documentFixture.createElement();
  trigger.className = "background-trigger";
  body.appendChild(trigger);
  trigger.focus();
  const key = (key: string, target = documentFixture.activeElement, shiftKey = false) => {
    let prevented = false;
    handlers.keydown?.(unsafeFixture<KeyboardEvent>({ key, target, shiftKey,
      preventDefault: () => { prevented = true; }, stopPropagation() {} },
    "Keyboard input supplies the key, target, shift modifier and event cancellation."));
    return prevented;
  };
  t.after(() => { key("Escape"); globalThis.document = previous; });
  const button = (className: string) => {
    const element = [...elements].reverse().find(element => element.className === className);
    assert.ok(element);
    return element;
  };
  return { body, documentFixture, trigger, handlers, key, button };
}

for (const targetClass of ["primary", "secondary", "confirm-modal-close"]) {
  test(`Enter respects the focused ${targetClass} action and restores focus`, async t => {
    const { body, documentFixture, trigger, handlers, key, button } = setup(t);
    const result = showConfirmPrompt("Clear this deck?");
    button(targetClass).focus();
    assert.equal(key("Enter"), true);
    assert.equal(await result, targetClass === "primary");
    assert.deepEqual(body.children, [trigger]);
    assert.equal(handlers.keydown, null);
    assert.equal(documentFixture.activeElement, trigger);
  });
}

for (const targetClass of ["background-trigger", "confirm-modal-message"]) {
  test(`Enter on ${targetClass} cannot approve the confirmation`, async t => {
    const { key, button } = setup(t);
    let settled = false;
    const result = Promise.resolve(showConfirmPrompt("Clear this deck?")).then(value => { settled = true; return value; });
    button(targetClass).focus();
    assert.equal(key("Enter"), true);
    await Promise.resolve();
    assert.equal(settled, false, "non-action input must leave the decision pending");
    key("Escape");
    assert.equal(await result, false);
  });
}

test("Tab and Shift+Tab cycle within confirmation controls", async t => {
  const { documentFixture, trigger, key, button } = setup(t);
  const result = showConfirmPrompt("Clear this deck?");
  for (const expected of ["secondary", "confirm-modal-close", "primary", "secondary"]) {
    assert.equal(key("Tab"), true);
    assert.equal(documentFixture.activeElement, button(expected));
  }
  for (const expected of ["primary", "confirm-modal-close", "secondary"]) {
    key("Tab", documentFixture.activeElement, true);
    assert.equal(documentFixture.activeElement, button(expected));
  }
  trigger.focus();
  key("Tab");
  assert.equal(documentFixture.activeElement, button("confirm-modal-close"));
  key("Escape");
  assert.equal(await result, false);
});

test("replacing a confirmation cancels the first and cleans up the final listener", async t => {
  const { body, documentFixture, trigger, handlers, key, button } = setup(t);
  const first = showConfirmPrompt("First?");
  const second = showConfirmPrompt("Second?");
  assert.equal(await first, false);
  assert.equal(body.children.length, 2);
  button("secondary").focus();
  key("Enter");
  assert.equal(await second, false);
  assert.deepEqual(body.children, [trigger]);
  assert.equal(handlers.keydown, null);
  assert.equal(documentFixture.activeElement, trigger);
});
