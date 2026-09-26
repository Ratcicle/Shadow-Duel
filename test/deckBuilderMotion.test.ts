import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { captureDeckCardMove, createDeckBuilderMotion } from "../src/ui/main/deckBuilderMotion.js";
import { unsafeFixture } from "./helpers/fixtures.js";

function setup(t: TestContext) {
  const previous = { document: globalThis.document, window: globalThis.window };
  let reduced = false;
  const flights: Array<{ frames: Keyframe[]; animation: Animation; ghost: { removed: boolean } ; finish: () => void }> = [];
  globalThis.window = unsafeFixture<Window & typeof globalThis>({
    innerWidth: 1200, innerHeight: 800,
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: () => ({ overflowX: "auto", overflowY: "auto" }),
  }, "Motion fixture provides viewport, reduced-motion and clipping styles only.");
  globalThis.document = unsafeFixture<Document>({
    body: { appendChild() {} },
    createElement: () => {
      const ghost = { removed: false, className: "", style: {}, setAttribute() {}, remove() { this.removed = true; },
        animate(frames: Keyframe[]) {
          let resolve!: (value: Animation) => void;
          let reject!: (error: Error) => void;
          const finished = new Promise<Animation>((finish, fail) => { resolve = finish; reject = fail; });
          const animation = unsafeFixture<Animation>({ finished, cancel: () => reject(new Error("cancelled")) }, "Only WAAPI completion/cancellation is used by the ghost lifecycle.");
          flights.push({ frames, animation, ghost, finish: () => resolve(animation) });
          return animation;
        },
      };
      return ghost;
    },
  }, "Motion fixture creates temporary ghosts without a browser renderer.");
  t.after(() => Object.assign(globalThis, previous));
  const element = (x: number, y: number, width = 60, height = 80, parentElement: HTMLElement | null = null) =>
    unsafeFixture<HTMLElement>({ className: "card-thumb card-thumb-monster", style: { backgroundImage: 'url("card.png")' }, parentElement,
      getBoundingClientRect: () => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height }),
    }, "A visible card or clipping container only supplies its rect and presentation.");
  return { element, flights, motion: createDeckBuilderMotion(), reduce: () => { reduced = true; } };
}

test("card flight uses captured origin and final target; independent ghosts clean up on finish/cancel", async (t) => {
  const { motion, element, flights } = setup(t);
  const source = captureDeckCardMove(element(100, 600))!;
  motion.move(source, element(300, 100, 75, 100));
  motion.move(source, element(400, 100, 75, 100));
  assert.equal(flights.length, 2);
  assert.equal(flights[0]!.frames[1]!.transform, "translate(200px, -500px) scale(1.25)");
  assert.equal(flights[0]!.frames[1]!.opacity, 1);
  flights[0]!.finish();
  flights[1]!.animation.cancel();
  await Promise.resolve();
  assert.ok(flights.every(flight => flight.ghost.removed));
});

test("missing or clipped pool destinations use a shrinking fade into the visible pool without changing filters", (t) => {
  const { motion, element, flights } = setup(t);
  const source = captureDeckCardMove(element(100, 100))!;
  const pool = element(20, 500, 700, 200);
  motion.move(source, null, pool);
  motion.move(source, element(50, 900, 60, 80, pool), pool);
  assert.equal(flights.length, 2);
  assert.deepEqual(flights[0]!.frames, flights[1]!.frames);
  assert.equal(flights[0]!.frames[1]!.opacity, 0);
  assert.match(String(flights[0]!.frames[1]!.transform), /scale\(0\.82\)/);
  motion.dispose();
  assert.ok(flights.every(flight => flight.ghost.removed));
});

test("absent geometry and reduced motion skip flights safely", (t) => {
  const { motion, element, flights, reduce } = setup(t);
  const source = captureDeckCardMove(element(100, 100));
  motion.move(source, null);
  motion.move(null, element(200, 200));
  assert.equal(captureDeckCardMove(element(0, 0, 0, 0)), null);
  reduce();
  assert.equal(captureDeckCardMove(element(100, 100)), null);
  motion.move(source, element(200, 200));
  assert.equal(flights.length, 0);
});
