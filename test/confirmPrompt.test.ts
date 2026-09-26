import assert from "node:assert/strict";
import test from "node:test";
import "../scripts/register_node_asset_loader.js";
import { unsafeFixture } from "./helpers/fixtures.js";

const { showConfirmPrompt } = await import("../src/ui/renderer/modals.js");

class PromptElement extends EventTarget {
  className = "";
  textContent = "";
  type = "";
  parentNode: PromptElement | null = null;
  children: PromptElement[] = [];
  appendChild(child: PromptElement) { this.children.push(child); child.parentNode = this; }
  removeChild(child: PromptElement) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
  focus() {}
}

for (const targetClass of ["primary", "secondary", "confirm-modal-close"]) {
  test(`Enter respects the focused ${targetClass} action in the shared confirmation prompt`, async (t) => {
    const previous = globalThis.document;
    const body = new PromptElement();
    const elements: PromptElement[] = [];
    let onKeyDown: ((event: KeyboardEvent) => void) | null = null;
    const documentFixture = {
      body,
      createElement: () => { const element = new PromptElement(); elements.push(element); return element; },
      addEventListener: (_type: string, handler: (event: KeyboardEvent) => void) => { onKeyDown = handler; },
      removeEventListener: () => { onKeyDown = null; },
    };
    globalThis.document = unsafeFixture<Document>(documentFixture, "Prompt DOM fixture supplies the actual modal's tree, click targets and keyboard registration.");
    t.after(() => { globalThis.document = previous; });
    const result = showConfirmPrompt("Clear this deck?", { confirmLabel: "Clear", cancelLabel: "Cancel" });
    const target = elements.find(element => element.className === targetClass);
    assert.ok(target);
    let prevented = false;
    const event = unsafeFixture<KeyboardEvent>({ key: "Enter", target, preventDefault: () => { prevented = true; } }, "The prompt only consumes the key, button target and default prevention.");
    // The registration happens synchronously when the modal opens.
    const dispatch = onKeyDown as ((event: KeyboardEvent) => void) | null;
    assert.ok(dispatch);
    dispatch(event);
    assert.equal(await result, targetClass === "primary");
    assert.equal(body.children.length, 0);
    assert.equal(onKeyDown, null);
    assert.equal(prevented, true);
  });
}
