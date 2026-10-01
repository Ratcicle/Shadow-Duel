import { required } from "../helpers/fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import type {
  SelectionCardReference,
  SelectionResult,
  RawSelectionUIConfig,
} from "../../src/core/contracts/selection.js";

for (const ui of [
  { allowCancel: false },
  { allowCancel: true, preventCancel: true },
] satisfies RawSelectionUIConfig[]) {
  test(`mandatory cancellation is inert for ${JSON.stringify(ui)}`, async t => {
    const game = new Game({ captureReplay: false, disableChains: true });
    t.after(() => game.dispose());
    const callbacks: string[] = [];
    game.ui.showTargetSelection = () => ({ close: () => { callbacks.push("close"); } });
    game.startTargetSelectionSession({
      kind: "choice", owner: game.player,
      selectionContract: { kind: "choice", ui: { ...ui, useFieldTargeting: false },
        requirements: [{ id: "chosen", min: 1, max: 1, zone: "choice",
          candidates: [{ key: "yes", zone: "choice" }] }] },
      onCancel: () => { callbacks.push("cancel"); },
      resolve: () => { callbacks.push("resolve"); },
      execute: () => { callbacks.push("execute"); return true; },
    });
    const session = required(game.targetSelection);
    const key = required(required(session.requirements[0]).candidates[0]).key;
    session.selections.chosen = [key];
    game.cancelTargetSelection();
    assert.equal(game.targetSelection, session);
    assert.equal(game.selectionState, "selecting");
    assert.deepEqual(session.selections, { chosen: [key] });
    assert.deepEqual(callbacks, []);
    await game.finishTargetSelection();
    assert.equal(game.targetSelection, null);
    assert.deepEqual(callbacks, ["close", "execute"]);
  });
}

test("optional resolution cancellation still records an empty choice", async t => {
  const game = new Game({ captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  const decisions: unknown[] = [];
  game.on("decision_made", decision => { decisions.push(decision.value); });
  let selected: SelectionResult | null = null;
  game.startTargetSelectionSession({
    owner: game.player, allowCancel: true, allowEmpty: true, cancelAsEmptySelection: true,
    selectionContract: { kind: "choice", requirements: [{ id: "chosen", min: 0, max: 1,
      zone: "choice", candidates: [{ key: "yes", zone: "choice" }] }] },
    execute: selections => { selected = selections; return true; },
    onCancel: () => assert.fail("Optional resolution must complete with an empty choice"),
  });
  game.cancelTargetSelection();
  assert.equal(game.targetSelection, null);
  assert.deepEqual(selected, { chosen: [] });
  assert.deepEqual(decisions, [{ selections: { chosen: [] } }]);
});

test("forced cleanup can clear a mandatory field selection without cancelling its effect", t => {
  const game = new Game({ captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  const card = new Card({ name: "Field choice", cardKind: "monster" }, "player");
  let controlsHidden = 0;
  game.ui.hideFieldTargetingControls = () => { controlsHidden++; };
  game.startTargetSelectionSession({
    owner: game.player, allowCancel: false, useFieldTargeting: true,
    selectionContract: { requirements: [{ id: "chosen", min: 1, max: 1, zone: "field",
      candidates: [{ cardRef: card, zone: "field", controller: "player" }] }] },
    onCancel: () => assert.fail("Mandatory cleanup must not cancel the effect"),
  });
  const session = required(game.targetSelection);
  game.cancelTargetSelection();
  assert.equal(game.targetSelection, session);
  assert.equal(controlsHidden, 0);
  game.forceClearTargetSelection();
  assert.equal(game.targetSelection, null);
  assert.equal(game.selectionState, "idle");
  assert.equal(controlsHidden, 1);
});

test("mandatory selection cannot finish with empty, repeated, or excessive choices", async t => {
  const game = new Game({ captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  const card = new Card({ name: "Mandatory choice", cardKind: "monster" }, "player");
  let completions = 0;
  game.startTargetSelectionSession({
    kind: "choice", owner: game.player, card, preventCancel: true,
    selectionContract: {
      kind: "choice", requirements: [{ id: "chosen", min: 1, max: 1, zone: "field",
        candidates: [{ cardRef: card, name: card.name, zone: "field", owner: "player" }] }],
    },
    execute: () => { completions++; return { success: true, needsSelection: false }; },
  });
  const session = required(game.targetSelection);
  const key = required(required(session.requirements[0]).candidates[0]).key;
  await game.finishTargetSelection();
  assert.equal(game.targetSelection, session);
  assert.equal(completions, 0);
  session.selections.chosen = [key, key];
  await game.finishTargetSelection();
  assert.equal(game.targetSelection, session);
  assert.equal(completions, 0);
  session.selections.chosen = [key];
  await game.finishTargetSelection();
  assert.equal(game.targetSelection, null);
  assert.equal(completions, 1);
});

test("selection session normalizes, exposes field state and resolves once", async () => {
  const game = new Game({ captureReplay: false, disableChains: true });
  const card = new Card(
    {
      id: 700,
      name: "Selection Target",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
      level: 4,
      effects: [],
    },
    "player",
  );
  game.player.field.push(card);

  const progressStates: object[] = [];
  let controlsHidden = 0;
  Reflect.set(game.ui, "showFieldTargetingControls", () => ({
    updateState(state: object) {
      progressStates.push(state);
    },
  }));
  Reflect.set(game.ui, "hideFieldTargetingControls", () => {
    controlsHidden += 1;
  });
  game.ui.log = () => {};

  let executedSelections: object | null = null;
  Reflect.apply(game.startTargetSelectionSession, game, [
    {
      kind: "target",
      owner: game.player,
      card,
      selectionContract: {
        kind: "target",
        timing: "activation",
        purpose: "target",
        message: "Choose the target",
        requirements: {
          id: "target",
          min: 1,
          max: 1,
          candidates: [
            {
              cardRef: card,
              controller: "player",
              zone: "field",
              zoneIndex: 0,
            },
          ],
        },
        ui: { useFieldTargeting: true, message: "raw-only" },
      },
      execute(selections: SelectionResult) {
        executedSelections = selections;
        return { success: true, needsSelection: false };
      },
    },
  ]);

  assert.equal(game.selectionState, "selecting");
  const targetSelection = game.targetSelection;
  assert.ok(targetSelection);
  assert.equal(targetSelection.usingFieldTargeting, true);
  assert.equal(targetSelection.autoAdvanceOnMax, false);
  assert.equal(
    Reflect.get(targetSelection.selectionContract, "purpose"),
    undefined,
  );
  assert.equal(
    Reflect.get(targetSelection.selectionContract, "timing"),
    undefined,
  );
  assert.equal(
    Reflect.get(targetSelection.selectionContract.ui, "message"),
    undefined,
  );
  const candidate = required(
    required(targetSelection.requirements[0]).candidates[0],
  );
  assert.equal(candidate.key, "player:field:0:700");

  assert.equal(
    Reflect.apply(game.handleTargetSelectionClick, game, [
      "player",
      0,
      null,
      "field",
    ]),
    true,
  );
  assert.deepEqual(targetSelection.selections, {
    target: [candidate.key],
  });
  await Reflect.apply(game.finishTargetSelection, game, []);

  assert.deepEqual(executedSelections, { target: [candidate.key] });
  assert.equal(game.targetSelection, null);
  assert.equal(game.selectionState, "idle");
  assert.ok(progressStates.length > 0);
  assert.equal(controlsHidden, 1);
  game.dispose();
});

test("selection cancellation preserves callback order and clears modal state", () => {
  const game = new Game({ captureReplay: false, disableChains: true });
  const callbacks: string[] = [];
  let modalClosed = 0;
  Reflect.set(game.ui, "showTargetSelection", () => ({
    close() {
      modalClosed += 1;
    },
  }));
  game.ui.log = () => {};

  Reflect.apply(game.startTargetSelectionSession, game, [
    {
      kind: "choice",
      selectionContract: {
        kind: "choice",
        requirements: [
          {
            id: "choice",
            min: 1,
            max: 1,
            zones: ["choice"],
            candidates: [
              {
                key: "yes",
                name: "Yes",
                controller: "player",
                zone: "choice",
              },
            ],
          },
        ],
        ui: { useFieldTargeting: false, allowCancel: true },
      },
      onCancel() {
        callbacks.push("cancel");
      },
      resolve(value: SelectionResult | SelectionCardReference[] | null) {
        assert.deepEqual(value, []);
        callbacks.push("resolve");
      },
      execute() {
        return { success: true, needsSelection: false };
      },
    },
  ]);

  assert.equal(game.selectionState, "selecting");
  Reflect.apply(game.cancelTargetSelection, game, []);
  assert.deepEqual(callbacks, ["cancel", "resolve"]);
  assert.equal(modalClosed, 1);
  assert.equal(game.targetSelection, null);
  assert.equal(game.selectionState, "idle");
  game.dispose();
});

test("selection completion keeps null card references out of decision telemetry", async () => {
  const game = new Game({ captureReplay: false, disableChains: true });
  const notifications: string[] = [];
  Reflect.set(game.ui, "showTargetSelection", () => ({ close() {} }));
  game.ui.log = () => {};
  const originalNotify = game.notify.bind(game);
  game.notify = (eventName, payload) => {
    notifications.push(eventName);
    originalNotify(eventName, payload);
  };

  Reflect.apply(game.startTargetSelectionSession, game, [
    {
      kind: "choice",
      selectionContract: {
        kind: "choice",
        requirements: [
          {
            id: "empty",
            min: 1,
            max: 1,
            zones: ["choice"],
            candidates: [
              {
                key: "empty-choice",
                cardRef: null,
                controller: "player",
                zone: "choice",
              },
            ],
          },
        ],
        ui: { useFieldTargeting: false },
      },
      execute() {
        return { success: true, needsSelection: false };
      },
    },
  ]);

  const targetSelection = game.targetSelection;
  assert.ok(targetSelection);
  const candidateKey = required(
    required(targetSelection.requirements[0]).candidates[0],
  ).key;
  targetSelection.selections = { empty: [candidateKey] };
  await Reflect.apply(game.finishTargetSelection, game, []);

  assert.equal(notifications.includes("decision_completed"), false);
  assert.equal(game.targetSelection, null);
  game.dispose();
});

test("selection replay matches duel identity before candidate and fallback keys", async () => {
  const game = new Game({ captureReplay: false, disableChains: true });
  game.ui.log = () => {};
  const firstCard = { id: 801, name: "First replay card", effects: [] };
  const secondCard = { id: 802, name: "Second replay card", effects: [] };
  const firstDuelCardId = game.ensureDuelCardId(firstCard);
  const secondDuelCardId = game.ensureDuelCardId(secondCard);
  const candidates = [
    {
      key: "fallback-first",
      candidateKey: "candidate-first",
      effectId: "effect-first",
      cardRef: firstCard,
      controller: "player",
      zone: "hand",
    },
    {
      key: "fallback-second",
      candidateKey: "candidate-second",
      effectId: "effect-second",
      cardRef: secondCard,
      controller: "player",
      zone: "hand",
    },
  ];
  game.decisionBroker.loadReplayDecisions([
    {
      decisionId: 1,
      kind: "target",
      value: {
        selections: {
          target: [
            {
              duelCardId: secondDuelCardId,
              effectId: "effect-second",
              candidateKey: "candidate-first",
              key: "fallback-first",
            },
          ],
        },
      },
    },
    {
      decisionId: 2,
      kind: "target",
      value: {
        selections: {
          target: [
            {
              duelCardId: null,
              effectId: null,
              candidateKey: "candidate-second",
              key: "fallback-first",
            },
          ],
        },
      },
    },
    {
      decisionId: 3,
      kind: "target",
      value: {
        selections: { target: [{ key: "fallback-first" }] },
      },
    },
  ]);

  const observed: SelectionResult[] = [];
  for (let index = 0; index < 3; index += 1) {
    const pending = Reflect.apply(game.startTargetSelectionSession, game, [
      {
        kind: "target",
        owner: game.player,
        selectionContract: {
          kind: "target",
          requirements: [
            {
              id: "target",
              min: 1,
              max: 1,
              zones: ["hand"],
              candidates,
            },
          ],
          ui: { useFieldTargeting: false },
        },
        execute(selections: SelectionResult) {
          observed.push(selections);
          return { success: true, needsSelection: false };
        },
      },
    ]);
    await pending;
  }

  assert.notEqual(firstDuelCardId, secondDuelCardId);
  assert.deepEqual(
    observed.map((selection) => selection.target),
    [["fallback-second"], ["fallback-second"], ["fallback-first"]],
  );
  game.dispose();
});
