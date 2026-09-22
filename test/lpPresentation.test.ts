import assert from "node:assert/strict";
import test from "node:test";
import type Renderer from "../src/ui/Renderer.js";
import { ensureLpDisplayState, getDisplayedLp, setDisplayedLp, animateLpOdometer, showLpDamageSequence, waitForLpPresentation } from "../src/ui/renderer/animations.js";
import { unsafeFixture } from "./helpers/fixtures.js";

test("LP counters and reduced-motion payment animations retain fractions", async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: true }) } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const element = { textContent: "0.5", closest: () => null };
  const renderer = unsafeFixture<Renderer>({
    elements: { playerLP: element }, lpDisplayState: {},
    ensureLpDisplayState, getDisplayedLp, setDisplayedLp, animateLpOdometer, showLpDamageSequence, waitForLpPresentation,
  }, "Only the LP display methods and their text element are exercised; there is no renderer or DOM lifecycle.");
  const player = { id: "player" as const, lp: 0.5 };
  assert.equal(renderer.getDisplayedLp(player), 0.5);
  await renderer.animateLpOdometer(player, 1, 0.5);
  assert.equal(element.textContent, "0.5");
  player.lp = 0.25;
  assert.equal(renderer.showLpDamageSequence(player, 0.25, { fromLp: 0.5, toLp: 0.25, cause: "cost" }), true);
  await renderer.waitForLpPresentation(player);
  assert.equal(renderer.getDisplayedLp(player), 0.25);
  assert.equal(element.textContent, "0.25");
});
