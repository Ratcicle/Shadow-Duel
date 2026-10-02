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

for (const seat of ["player", "bot"] as const) {
  test(`cancelling a standalone selection does not record an orphan replay decision (${seat})`, t => {
    const game = new Game({ captureReplay: false, disableChains: true });
    t.after(() => game.dispose());
    const decisions: unknown[] = [];
    let cancelled = 0;
    game.on("decision_made", decision => { decisions.push(decision); });
    game.startTargetSelectionSession({
      kind: "choice", owner: game[seat], allowCancel: true,
      selectionContract: { kind: "choice", requirements: [{ id: "standalone", min: 1, max: 1,
        zone: "choice", candidates: [{ key: "yes", zone: "choice" }] }] },
      onCancel: () => { cancelled++; },
      execute: () => assert.fail("Cancellation must not execute the selection"),
    });
    game.cancelTargetSelection();
    assert.equal(cancelled, 1);
    assert.equal(game.targetSelection, null);
    assert.deepEqual(decisions, [], "Only a caller awaiting a replay command records its cancelled choice");
  });
}

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

for (const field of [false, true]) {
  for (const action of ["confirm", "cancel"] as const) {
    test(`late ${field ? "field" : "modal"} ${action} cannot affect a replacement session`, async t => {
      const game = new Game({ captureReplay: false, disableChains: true });
      t.after(() => game.dispose());
      const callbacks: { confirm: () => void; cancel: (() => void) | null }[] = [];
      game.ui.showTargetSelection = (_contract, confirm, cancel) => {
        callbacks.push({ confirm: () => confirm?.({ chosen: ["yes"] }), cancel });
        return { close() {} };
      };
      game.ui.showFieldTargetingControls = (confirm, cancel) => {
        callbacks.push({ confirm: () => confirm?.(), cancel });
        return { close() {}, updateState() {} };
      };
      let executed = 0;
      let cancelled = 0;
      const start = () => game.startTargetSelectionSession({
        kind: "choice", owner: game.player, useFieldTargeting: field,
        selectionContract: { kind: "choice", requirements: [{ id: "chosen", min: 1, max: 1,
          zone: "choice", candidates: [{ key: "yes", zone: "choice" }] }] },
        execute: () => { executed++; return true; }, onCancel: () => { cancelled++; },
      });
      start();
      const old = required(callbacks[0]);
      start();
      const current = required(game.targetSelection);
      current.selections.chosen = [required(required(current.requirements[0]).candidates[0]).key];
      if (action === "confirm") old.confirm(); else required(old.cancel)();
      await Promise.resolve();
      assert.equal(game.targetSelection, current);
      assert.equal(executed, 0);
      assert.equal(cancelled, 1);
      required(callbacks[1]).confirm();
      await Promise.resolve();
      assert.equal(executed, 1);
      assert.equal(game.targetSelection, null);
    });
  }
}

for (const reset of ["scenario", "duel", "dispose"] as const) {
  for (const ui of [{ allowCancel: false }, { preventCancel: true }]) {
    test(`${reset} systemically ends a mandatory decision before changing its state: ${JSON.stringify(ui)}`, async t => {
      const game = new Game({ captureReplay: false, disableChains: true });
      t.after(() => game.dispose());
      game.applyScenarioSetup({ phase: "main1", player: { lp: 7100, field: [{ id: 1 }] } });
      const original = required(game.player.field[0]);
      let closed = 0, aborted = 0;
      game.ui.showTargetSelection = () => ({ close() {
        closed++;
        assert.equal(game.targetSelection, null, "invalidate before calling presentation cleanup");
        assert.equal(game.player.field[0], original, "close before replacing zones");
      } });
      game.startTargetSelectionSession({
        owner: game.player, ...ui, useFieldTargeting: false,
        selectionContract: { requirements: [{ id: "chosen", min: 1, max: 1, zone: "field",
          candidates: [{ cardRef: original, zone: "field", controller: "player" }] }] },
        onAbort: () => { aborted++; },
        onCancel: () => assert.fail("System teardown is not player cancellation"),
        execute: () => assert.fail("System teardown must not choose for the player"),
      });
      if (reset === "scenario") game.applyScenarioSetup({ phase: "main1", player: { lp: 6000, field: [{ id: 3 }] } });
      else if (reset === "duel") game.resetDuelState("test_reset", { phase: "main1" });
      else game.dispose();
      assert.equal(game.targetSelection, null);
      assert.equal(game.selectionState, "idle");
      assert.equal(closed, 1);
      assert.equal(aborted, 1);
      game.forceClearTargetSelection();
      assert.equal(aborted, 1, "system teardown is idempotent");
      if (reset !== "dispose") {
        await game.nextPhase();
        assert.equal(game.phase, "battle", "old decision must not block the next phase");
      }
    });
  }
}

test("system teardown settles a custom selection promise without recording a player choice", async t => {
  const game = new Game({ captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  game.applyScenarioSetup({ player: { hand: [{ id: 1 }] } });
  const decisions: unknown[] = [];
  game.on("decision_made", decision => { decisions.push(decision); });
  let settled = false;
  const pending = game.askPlayerToSelectCards({ owner: "player", zone: "hand", min: 1, max: 1 }).then(value => { settled = true; return value; });
  assert.ok(game.targetSelection);
  game.applyScenarioSetup({ player: { hand: [{ id: 3 }] } });
  await Promise.resolve();
  assert.equal(settled, true);
  assert.deepEqual(await pending, []);
  assert.deepEqual(decisions, []);
});

test("reset cannot recycle a session ID into authority for an old live callback", async t => {
  const game = new Game({ captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  const confirms: (() => void)[] = [];
  game.ui.showTargetSelection = (_contract, confirm) => {
    confirms.push(() => confirm?.({ chosen: ["yes"] })); return { close() {} };
  };
  let executions = 0;
  const start = () => game.startTargetSelectionSession({
    useFieldTargeting: false,
    selectionContract: { requirements: [{ id: "chosen", min: 1, max: 1, zone: "choice", candidates: [{ key: "yes", zone: "choice" }] }] },
    execute: () => { executions++; return true; },
  });
  start(); const oldId = required(game.targetSelection).sessionId;
  game.resetDuelState(); start();
  assert.equal(required(game.targetSelection).sessionId, oldId);
  required(confirms[0])(); await Promise.resolve();
  assert.equal(executions, 0);
  assert.ok(game.targetSelection);
});

test("invalid scenario setup preserves the current mandatory decision", t => {
  const game = new Game({ captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  game.startTargetSelectionSession({ allowCancel: false,
    selectionContract: { requirements: [{ id: "chosen", min: 1, max: 1, zone: "choice", candidates: [{ key: "yes", zone: "choice" }] }] },
  });
  const current = game.targetSelection;
  assert.equal(game.applyScenarioSetup({ schemaVersion: 2, player: { field: [{ id: 1, fieldSlot: 0 }, { id: 3, fieldSlot: 0 }] } }).success, false);
  assert.equal(game.targetSelection, current);
});

test("replay continuation from an aborted session cannot affect a new session with the same ID", async t => {
  const game = new Game({ captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  game.decisionBroker.loadReplayDecisions([{ decisionId: 1, kind: "choice", value: { selections: { chosen: [{ key: "yes" }] } } }]);
  let executions = 0;
  const start = () => game.startTargetSelectionSession({
    kind: "choice", owner: game.player, allowCancel: false,
    selectionContract: { kind: "choice", requirements: [{ id: "chosen", min: 1, max: 1,
      zone: "choice", candidates: [{ key: "yes", zone: "choice" }] }] },
    execute: () => { executions++; return true; },
  });
  const pending = start();
  const oldId = required(game.targetSelection).sessionId;
  game.resetDuelState();
  game.decisionBroker.mode = "live";
  start();
  assert.equal(required(game.targetSelection).sessionId, oldId);
  await pending;
  assert.equal(executions, 0);
  assert.ok(game.targetSelection);
  assert.equal(game.pendingReplayDecisionPromise, null);
});

test("legitimate cancellation retires its callbacks before closing UI or starting another session", t => {
  const game = new Game({ captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  let oldConfirm: (() => void) | undefined;
  let executions = 0;
  let cancellations = 0;
  const contract = { requirements: [{ id: "chosen", min: 1, max: 1, zone: "choice" as const,
    candidates: [{ key: "yes", zone: "choice" as const }] }] };
  game.ui.showTargetSelection = (_contract, confirm) => {
    const callback = () => confirm?.({ chosen: ["yes"] });
    oldConfirm ||= callback;
    return { close: callback };
  };
  game.startTargetSelectionSession({ selectionContract: contract, useFieldTargeting: false,
    execute: () => { executions++; return true; },
    onCancel: () => {
      cancellations++;
      // Prevent a recursive fixture failure while checking that A was retired first.
      assert.equal(game.targetSelection, null);
      game.startTargetSelectionSession({ selectionContract: contract, useFieldTargeting: false });
    },
  });
  game.cancelTargetSelection();
  assert.equal(cancellations, 1);
  assert.equal(executions, 0);
  const next = required(game.targetSelection);
  oldConfirm?.();
  assert.equal(game.targetSelection, next);
});
