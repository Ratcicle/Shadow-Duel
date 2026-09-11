import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import "../../scripts/register_node_asset_loader.mjs";
import {
  createUIAdapter,
  createDisposedUIAdapter,
} from "../../src/core/UIAdapter.js";
import type { GameRendererPort } from "../../src/core/contracts/game.js";

const { default: Renderer } = await import("../../src/ui/Renderer.js");
const { RENDERER_METHODS } = await import(
  "../../src/ui/renderer/attachments.js"
);

test("Renderer preserves its legacy prototype keyset and attachment order", () => {
  // Captured from main at 513fb9c, before the stage 10 conversion.
  const keys = Object.getOwnPropertyNames(Renderer.prototype);
  assert.equal(keys.length, 115);
  assert.equal(
    createHash("sha256").update(JSON.stringify(keys)).digest("hex"),
    "962a9ebbb43803d1bc9d109a88899a00d63d87db8dbacf3aa6887ca7f5582a3f",
  );
  for (const [name, implementation] of Object.entries(RENDERER_METHODS)) {
    assert.equal(Reflect.get(Renderer.prototype, name), implementation);
  }
});

test("adapter preserves renderer receivers, arguments and async prompt results", async () => {
  const calls: string[] = [];
  const renderer: GameRendererPort = {
    log(message) {
      assert.equal(this, renderer);
      calls.push(message);
    },
    showConfirmPrompt(message, options) {
      assert.equal(this, renderer);
      assert.equal(options?.title, "Confirm");
      calls.push(message);
      return Promise.resolve(true);
    },
    updatePriorityIndicator(state) {
      assert.equal(this, renderer);
      assert.equal(state, null);
    },
  };
  const ui = createUIAdapter(renderer);
  ui.log("logged");
  assert.equal(
    await ui.showConfirmPrompt("choose", { title: "Confirm" }),
    true,
  );
  ui.updatePriorityIndicator(null);
  assert.deepEqual(calls, ["logged", "choose"]);
});

test("adapter overrides remain local and take precedence over the renderer", () => {
  let rendered = 0;
  let overridden = 0;
  const renderer: GameRendererPort = {
    showGameOverModal: () => {
      rendered++;
    },
  };
  const first = createUIAdapter(renderer);
  const second = createUIAdapter(renderer);
  first.showGameOverModal = () => {
    overridden++;
  };
  first.showAlert = () => {
    overridden++;
  };
  first.showGameOverModal();
  first.showAlert("silenced");
  second.showGameOverModal();
  assert.equal(overridden, 2);
  assert.equal(rendered, 1);
  assert.notEqual(first.showAlert, createDisposedUIAdapter().showAlert);
});

test("disposed and absent renderers provide compatible inert return values", async () => {
  for (const ui of [
    createUIAdapter(null),
    createUIAdapter({}),
    createDisposedUIAdapter(),
  ]) {
    assert.equal(await ui.showConfirmPrompt("confirm"), false);
    assert.equal(ui.showNumberPrompt("number", 1), null);
    assert.equal(await ui.showChainResponseModal([], null), null);
    assert.equal(await ui.showTierChoiceModal(), null);
    assert.deepEqual(await ui.showTriggerOrderModal(), []);
    assert.equal(await ui.animateCardLayout(new Map()), false);
    assert.equal(await ui.waitForLpPresentation(), false);
    assert.deepEqual(ui.captureCardRects(), new Map());
    const attack = ui.playAttackLunge({ cardKey: "missing" });
    assert.equal(await attack.contact, false);
    assert.equal(await attack.finished, false);
    assert.equal(await attack.cancel(), false);
    assert.equal(await attack, false);
    let decisions = 0;
    ui.showCardGridSelectionModal({
      cards: [{ name: "card" }],
      onConfirm: () => {
        decisions++;
      },
    });
    ui.showSpecialSummonPositionModal({ name: "card" }, () => {
      decisions++;
    });
    ui.showTargetSelection(
      null,
      () => {
        decisions++;
      },
      () => {
        decisions++;
      },
    ).close();
    ui.showFieldTargetingControls(null, null).close();
    assert.equal(decisions, 0);
    assert.equal(Reflect.get(ui, "inventedMethod"), undefined);
  }
});
