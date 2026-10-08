import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import "../scripts/register_node_asset_loader.js";
import type Renderer from "../src/ui/Renderer.js";
import Card from "../src/core/Card.js";
import { ensureLpDisplayState, getDisplayedLp, setDisplayedLp, animateLpOdometer, showLpDamageSequence, waitForLpPresentation, hasActiveLpPresentation, showFieldDamageHit, showLpChange } from "../src/ui/renderer/animations.js";
import { cardDefinition, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

const { default: RendererClass } = await import("../src/ui/Renderer.js");

function lpLifecycleFixture(t: TestContext, animationApi = true) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const animations: Array<{ finished: Promise<void>; cancel(): void; finish(): void; cancelled: boolean }> = [];
  function element() {
    const classes = new Set<string>();
    return {
      classes, classList: { add: (...names: string[]) => names.forEach(name => classes.add(name)), remove: (...names: string[]) => names.forEach(name => classes.delete(name)) },
      textContent: "8000", className: "", style: { left: "", top: "", setProperty() {} },
      offsetWidth: 100, removed: false,
      remove() { this.removed = true; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      animate: animationApi ? () => {
        let resolveFinished: () => void = () => {};
        let rejectFinished: (reason: Error) => void = () => {};
        const finished = new Promise<void>((resolve, reject) => {
          resolveFinished = resolve;
          rejectFinished = reject;
        });
        const animation = { finished, cancelled: false,
          cancel() { this.cancelled = true; rejectFinished(new Error("Animation cancelled")); },
          finish: () => resolveFinished(),
        };
        animations.push(animation);
        return animation;
      } : undefined,
    };
  }
  const counter = element();
  const lp = { ...element(), closest: () => counter };
  const area = element();
  const floats: ReturnType<typeof element>[] = [];
  const layer = { appendChild: (child: ReturnType<typeof element>) => floats.push(child) };
  const root = { querySelector: () => layer };
  const globals: Record<string, unknown> = {
    window: { matchMedia: () => ({ matches: false }) },
    document: { getElementById: (id: string) => id === "game-container" ? root : area, createElement: element },
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const makeRenderer = () => unsafeFixture<Renderer>({
    destroyed: false, elements: { playerLP: lp }, lpDisplayState: {},
    ensureLpDisplayState, getDisplayedLp, setDisplayedLp, animateLpOdometer,
    showLpDamageSequence, waitForLpPresentation, hasActiveLpPresentation, showFieldDamageHit, showLpChange,
    cancelFieldPlacement() {}, destroy: RendererClass.prototype.destroy,
  }, "Real LP presentation and Renderer.destroy with controlled DOM, RAF and Web Animations; Pixi initialization and unrelated modals are absent.");
  const renderer = makeRenderer();
  t.after(() => renderer.destroy());
  return { renderer, makeRenderer, frames, animations, counter, lp, floats, area };
}

test("destroy cancels a pending LP RAF and late callbacks cannot overwrite a new duel", async t => {
  const { renderer, makeRenderer, frames, lp, counter } = lpLifecycleFixture(t);
  const oldPlayer = { id: "player" as const, lp: 7000 };
  const pending = renderer.animateLpOdometer(oldPlayer, 8000, 7000);
  const lateFrame = frames.values().next().value;
  assert.ok(lateFrame);
  renderer.destroy();
  assert.equal(frames.size, 0, "destroy must cancel the scheduled animation frame");
  const fresh = makeRenderer();
  t.after(() => fresh.destroy());
  fresh.setDisplayedLp({ id: "player", lp: 8000 }, 8000);
  counter.classList.add("lp-flash-damage");
  lateFrame(performance.now() + 5000);
  t.mock.timers.tick(10_000);
  assert.equal(await pending, false);
  assert.equal(lp.textContent, "8000");
  assert.equal(counter.classes.has("lp-flash-damage"), true);
  assert.equal(renderer.setDisplayedLp(oldPlayer, 1), false);
  assert.equal(await renderer.animateLpOdometer(oldPlayer, 8000, 1), false);
  assert.equal(renderer.showLpChange(oldPlayer, 1), false);
  assert.equal(lp.textContent, "8000");
});

for (const animationApi of [true, false]) {
  test(`destroy settles queued LP work and removes floats (${animationApi ? "Web Animations" : "timer fallback"})`, async t => {
    const { renderer, makeRenderer, frames, animations, floats, lp } = lpLifecycleFixture(t, animationApi);
    const player = { id: "player" as const, lp: 6000 };
    renderer.showLpDamageSequence(player, 1000, { fromLp: 8000, toLp: 7000 });
    renderer.showLpDamageSequence(player, 1000, { fromLp: 7000, toLp: 6000 });
    const waiting = renderer.waitForLpPresentation(player);
    await Promise.resolve();
    assert.equal(floats.length, 2);
    renderer.destroy();
    assert.ok(floats.every(float => float.removed), "dispose must remove owned floats immediately");
    assert.ok(animations.every(animation => animation.cancelled));
    const fresh = makeRenderer();
    t.after(() => fresh.destroy());
    fresh.setDisplayedLp({ id: "player", lp: 8000 }, 8000);
    assert.equal(await waiting, false, "a disposed presentation settles without waiting for its timers");
    assert.equal(renderer.hasActiveLpPresentation(player), false);
    assert.equal(renderer.lpDisplayState.player?.queue.length, 0);
    assert.equal(renderer.lpDisplayState.player?.floatingPromises.size, 0);
    t.mock.timers.tick(10_000);
    for (const callback of frames.values()) callback(performance.now() + 5000);
    assert.equal(lp.textContent, "8000");
  });
}

test("completed LP animations retain fractions and disposing their flash cannot touch a new duel", async t => {
  const { renderer, makeRenderer, frames, lp, counter } = lpLifecycleFixture(t);
  const player = { id: "player" as const, lp: 0.25 };
  const pending = renderer.animateLpOdometer(player, 0.5, 0.25);
  const frame = frames.values().next().value;
  assert.ok(frame);
  frame(performance.now() + 5000);
  assert.equal(await pending, true);
  assert.equal(lp.textContent, "0.25");
  renderer.destroy();
  const fresh = makeRenderer();
  t.after(() => fresh.destroy());
  counter.classList.add("lp-flash-damage");
  t.mock.timers.tick(1000);
  assert.equal(counter.classes.has("lp-flash-damage"), true);
});

test("live floating LP presentation reaches its fractional destination and releases the queue", async t => {
  const { renderer, animations, frames, floats, lp } = lpLifecycleFixture(t);
  const player = { id: "player" as const, lp: 7999.5 };
  renderer.showLpDamageSequence(player, 0.5, { fromLp: 8000, toLp: player.lp });
  const waiting = renderer.waitForLpPresentation(player);
  assert.equal(animations.length, 1);
  animations[0]!.finish();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(frames.size, 1, "arrival must start the LP odometer");
  for (const [id, frame] of frames) {
    frames.delete(id);
    frame(performance.now() + 5000);
  }
  assert.equal(await waiting, true);
  assert.equal(lp.textContent, "7999.5");
  assert.ok(floats.every(float => float.removed));
  assert.equal(renderer.hasActiveLpPresentation(player), false);
  assert.equal(renderer.lpDisplayState.player?.queue.length, 0);
});

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

for (const role of ["attacker", "defender"] as const) {
  test(`Hyperion versus Midnight Nightmare Steed displays only the final 1400 damage as ${role}`, async (t) => {
    const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
    t.after(() => game.dispose());
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.phase = "battle";
    game.battleStep = "battle";
    game.turnCounter = 2;
    game.turn = role === "attacker" ? game.player.id : game.bot.id;
    game.player.controllerType = "ai";
    game.bot.controllerType = "ai";
    const hyperion = new Card(cardDefinition("Luminous God Hyperion"), game.player.id);
    const steed = new Card(cardDefinition("Midnight Nightmare Steed"), game.bot.id);
    hyperion.position = role === "attacker" ? "attack" : "defense";
    steed.position = "attack";
    game.player.field.push(hyperion);
    game.bot.field.push(steed);

    const displayedDamage: Array<{ player: string; amount: number; fromLp: number | undefined; toLp: number | undefined }> = [];
    game.ui.showLpDamageSequence = (player, amount, options = {}) => {
      displayedDamage.push({ player: player!.id, amount, fromLp: options.fromLp, toLp: options.toLp });
      return true;
    };
    // Exercise the real combat contact callback without requiring DOM animation.
    const presentation = game.ui.playAttackLunge(null);
    game.ui.playAttackLunge = (intent) => {
      intent?.onContact?.({});
      return presentation;
    };

    await game.resolveCombat(
      role === "attacker" ? hyperion : steed,
      role === "attacker" ? steed : hyperion,
    );

    assert.equal(game.bot.lp, 6600);
    assert.equal(game.player.lp, 8000);
    assert.deepEqual(displayedDamage, [{ player: game.bot.id, amount: 1400, fromLp: 8000, toLp: 6600 }]);
  });
}
