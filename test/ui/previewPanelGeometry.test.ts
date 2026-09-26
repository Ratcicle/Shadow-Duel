import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPreviewSize, getPreviewSizeLimits, resizePreviewRect, resizeDockedWidth,
  getPreviewDetachPosition,
} from "../../src/ui/main/previewPanelGeometry.js";

const viewport = { width: 1366, height: 768 };
const defaults = { width: 224, height: 752 };
const limits = getPreviewSizeLimits(viewport, defaults);
const rect = { x: 400, y: 100, width: 300, height: 560 };

test("preview dimensions keep responsive defaults and bound custom sizes", () => {
  assert.deepEqual(clampPreviewSize(defaults, limits), defaults);
  assert.deepEqual(clampPreviewSize({ width: 10, height: 10 }, limits), { width: 224, height: 520 });
  assert.deepEqual(clampPreviewSize({ width: 900, height: 900 }, limits), { width: 520, height: 752 });
  assert.equal(getPreviewSizeLimits({ width: 1000, height: 768 }, defaults).maxWidth, 450);
  assert.equal(getPreviewSizeLimits(viewport, { width: 304, height: 752 }).minWidth, 240);
});

test("a viewport smaller than the minimum reduces both dimensions to usable space", () => {
  const small = getPreviewSizeLimits({ width: 180, height: 300 }, defaults);
  assert.deepEqual(clampPreviewSize(defaults, small), { width: 164, height: 284 });
});

test("laboratory controls reserve reading height within the viewport limit", () => {
  assert.equal(getPreviewSizeLimits(viewport, defaults, 100).minHeight, 620);
  const short = getPreviewSizeLimits({ width: 1366, height: 600 }, defaults, 100);
  assert.equal(short.minHeight, 584);
  assert.equal(short.maxHeight, 584);
});

test("resize edges preserve the opposite edge and untouched axis", () => {
  assert.deepEqual(resizePreviewRect(rect, "w", { x: -40, y: 10 }, viewport, limits), { ...rect, x: 360, width: 340 });
  assert.deepEqual(resizePreviewRect(rect, "e", { x: 40, y: 10 }, viewport, limits), { ...rect, width: 340 });
  assert.deepEqual(resizePreviewRect(rect, "n", { x: 10, y: -40 }, viewport, limits), { ...rect, y: 60, height: 600 });
  assert.deepEqual(resizePreviewRect(rect, "s", { x: 10, y: 40 }, viewport, limits), { ...rect, height: 600 });
});

test("all four corners resize both axes around the opposite corner", () => {
  assert.deepEqual(resizePreviewRect(rect, "nw", { x: -40, y: -40 }, viewport, limits), { x: 360, y: 60, width: 340, height: 600 });
  assert.deepEqual(resizePreviewRect(rect, "ne", { x: 40, y: -40 }, viewport, limits), { ...rect, y: 60, width: 340, height: 600 });
  assert.deepEqual(resizePreviewRect(rect, "sw", { x: -40, y: 40 }, viewport, limits), { ...rect, x: 360, width: 340, height: 600 });
  assert.deepEqual(resizePreviewRect(rect, "se", { x: 40, y: 40 }, viewport, limits), { ...rect, width: 340, height: 600 });
});

test("resize clamps immediately at min, max and viewport edges without moving the anchor", () => {
  assert.deepEqual(resizePreviewRect(rect, "nw", { x: -999, y: -999 }, viewport, limits), { x: 180, y: 8, width: 520, height: 652 });
  assert.deepEqual(resizePreviewRect(rect, "nw", { x: 999, y: 999 }, viewport, limits), { x: 476, y: 140, width: 224, height: 520 });
  assert.deepEqual(resizePreviewRect(rect, "se", { x: 999, y: 999 }, viewport, limits), { ...rect, width: 520, height: 660 });
  const nearRight = { ...rect, x: 1058 };
  assert.deepEqual(resizePreviewRect(nearRight, "e", { x: 100, y: 0 }, viewport, limits), nearRight);
});

test("docked widths use the inward edge while preserving a shared width", () => {
  assert.equal(resizeDockedWidth(300, "docked-left", 40, limits), 340);
  assert.equal(resizeDockedWidth(300, "docked-right", -40, limits), 340);
  assert.equal(resizeDockedWidth(300, "docked-left", -999, limits), 224);
  assert.equal(resizeDockedWidth(300, "docked-right", -999, limits), 520);
});

test("detach keeps the grabbed fraction when restoring a different floating size", () => {
  const start = { x: 550, y: 106 };
  assert.deepEqual(getPreviewDetachPosition(start, rect, { width: 400, height: 600 }), { x: 350, y: 100 });
  assert.deepEqual(getPreviewDetachPosition(start, rect, rect), { x: 400, y: 100 });
});
