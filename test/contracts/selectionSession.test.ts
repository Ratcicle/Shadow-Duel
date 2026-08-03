import assert from "node:assert/strict";
import test from "node:test";
import Game from "../../src/core/Game.js";
import type {
  SelectionCardReference,
  SelectionResult,
} from "../../src/core/contracts/selection.js";

test("selection session normalizes, exposes field state and resolves once", async () => {
  const game = new Game({ captureReplay: false, disableChains: true });
  const card = {
    id: 700,
    name: "Selection Target",
    cardKind: "monster",
    owner: "player",
    controller: "player",
    position: "attack",
    atk: 1000,
    def: 1000,
    effects: [],
  };
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
  Reflect.apply(game.startTargetSelectionSession, game, [{
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
  }]);

  assert.equal(game.selectionState, "selecting");
  assert.equal(game.targetSelection.usingFieldTargeting, true);
  assert.equal(game.targetSelection.autoAdvanceOnMax, false);
  assert.equal(game.targetSelection.selectionContract.purpose, undefined);
  assert.equal(game.targetSelection.selectionContract.timing, undefined);
  assert.equal(game.targetSelection.selectionContract.ui.message, undefined);
  const candidate = game.targetSelection.requirements[0].candidates[0];
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
  assert.deepEqual(game.targetSelection.selections, {
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

  Reflect.apply(game.startTargetSelectionSession, game, [{
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
  }]);

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

  Reflect.apply(game.startTargetSelectionSession, game, [{
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
  }]);

  const candidateKey = game.targetSelection.requirements[0].candidates[0].key;
  game.targetSelection.selections = { empty: [candidateKey] };
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
    const pending = Reflect.apply(game.startTargetSelectionSession, game, [{
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
    }]);
    await pending;
  }

  assert.notEqual(firstDuelCardId, secondDuelCardId);
  assert.deepEqual(
    observed.map((selection) => selection.target),
    [
      ["fallback-second"],
      ["fallback-second"],
      ["fallback-first"],
    ],
  );
  game.dispose();
});
