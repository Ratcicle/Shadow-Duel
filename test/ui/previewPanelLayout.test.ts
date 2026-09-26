import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIEW_PANEL_STORAGE_KEY,
  clampPreviewPosition,
  createPreviewPanelPreference,
  getPreviewDockMode,
  getPreviewDragPosition,
  hasPreviewDragStarted,
  parsePreviewPanelState,
} from "../../src/ui/main/previewPanelLayout.js";

test("preview defaults to docked-right and rejects malformed or unsupported storage", () => {
  for (const raw of [null, "", "{", "null", "[]", "true", "4",
    '{"version":3,"mode":"docked-left"}', '{"mode":"docked-left"}',
    '{"version":1,"mode":"other"}',
  ]) {
    assert.deepEqual(parsePreviewPanelState(raw), { mode: "docked-right" });
  }
});

test("preview restores each mode and finite floating coordinates", () => {
  for (const mode of ["docked-right", "docked-left"] as const) {
    assert.deepEqual(parsePreviewPanelState(JSON.stringify({ version: 1, mode })), { mode });
  }
  assert.deepEqual(parsePreviewPanelState('{"version":1,"mode":"floating","x":42.5,"y":-12}'),
    { mode: "floating", x: 42.5, y: -12 });
});

test("preview persists mode, independent sizes and position without touching unrelated preferences", () => {
  const values = new Map([["other", "keep"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const preference = createPreviewPanelPreference(storage);
  assert.deepEqual(preference.getState(), { mode: "docked-right" });
  const geometry = { x: 123, y: 80, floatingWidth: 400, floatingHeight: 560, dockedWidth: 280 };
  for (const mode of ["floating", "docked-left", "docked-right", "floating"] as const) {
    preference.setState({ mode, ...geometry });
    assert.deepEqual(createPreviewPanelPreference(storage).getState(), { mode, ...geometry });
    assert.deepEqual(JSON.parse(values.get(PREVIEW_PANEL_STORAGE_KEY)!), { version: 2, mode, ...geometry });
  }
  assert.equal(values.get("other"), "keep");
});

test("preview sanitizes each dimension independently and retains legacy mode and position", () => {
  assert.deepEqual(parsePreviewPanelState('{"version":1,"mode":"floating","x":40,"y":8}'), { mode: "floating", x: 40, y: 8 });
  for (const value of [null, "200", -100, 0, 1e999]) {
    const parsed = parsePreviewPanelState(JSON.stringify({ version: 2, mode: "floating", x: "bad", y: -200, floatingWidth: value, floatingHeight: 560, dockedWidth: 280 }));
    assert.deepEqual(parsed, { mode: "floating", x: 8, y: -200, floatingHeight: 560, dockedWidth: 280 });
  }
  assert.deepEqual(parsePreviewPanelState('{"version":2,"mode":"floating","x":1e999,"y":null,"floatingWidth":9000,"floatingHeight":-1}'), { mode: "floating", x: 8, y: 8, floatingWidth: 9000 });
});

test("unavailable storage and failed writes still allow live preview layout changes", () => {
  for (const storage of [null, {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("quota"); },
  }]) {
    const preference = createPreviewPanelPreference(storage);
    preference.setState({ mode: "floating", x: 30, y: 8 });
    const copy = preference.getState();
    if (copy.mode === "floating") copy.x = 999;
    assert.deepEqual(preference.getState(), { mode: "floating", x: 30, y: 8 });
  }
});

test("preview clamps to visible viewport margins after shrinking the window", () => {
  assert.deepEqual(clampPreviewPosition({ x: 1500, y: 300 }, { width: 224, height: 584 }, { width: 1366, height: 600 }), { x: 1134, y: 8 });
  assert.deepEqual(clampPreviewPosition({ x: -20, y: -50 }, { width: 224, height: 584 }, { width: 1366, height: 600 }), { x: 8, y: 8 });
  assert.deepEqual(clampPreviewPosition({ x: 500, y: 120 }, { width: 224, height: 584 }, { width: 1366, height: 900 }), { x: 500, y: 120 });
  assert.deepEqual(clampPreviewPosition({ x: 10, y: 999 }, { width: 300, height: 800 }, { width: 200, height: 400 }), { x: 8, y: 8 });
});

test("preview dock thresholds measure nearest panel edge against the viewport", () => {
  assert.equal(getPreviewDockMode(48, 224, 1366), "docked-left");
  assert.equal(getPreviewDockMode(49, 224, 1366), "floating");
  assert.equal(getPreviewDockMode(1094, 224, 1366), "docked-right");
  assert.equal(getPreviewDockMode(1093, 224, 1366), "floating");
  assert.equal(getPreviewDockMode(500, 224, 1366), "floating");
  assert.equal(getPreviewDockMode(8, 224, 1366), "docked-left");
  assert.equal(getPreviewDockMode(8, 184, 200), "docked-right");
});

test("preview drag waits for actual movement and preserves the grabbed offset", () => {
  assert.equal(hasPreviewDragStarted({ x: 100, y: 10 }, { x: 103, y: 10 }), false);
  assert.equal(hasPreviewDragStarted({ x: 100, y: 10 }, { x: 104, y: 10 }), true);
  assert.equal(hasPreviewDragStarted({ x: 100, y: 10 }, { x: 103, y: 13 }), true);
  assert.deepEqual(getPreviewDragPosition({ x: 1246, y: 14 }, { x: 1240, y: 16 }, { x: 1134, y: 8 }), { x: 1128, y: 10 });
});
