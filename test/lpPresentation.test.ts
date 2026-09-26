import assert from "node:assert/strict";
import test from "node:test";
import type Renderer from "../src/ui/Renderer.js";
import Card from "../src/core/Card.js";
import { ensureLpDisplayState, getDisplayedLp, setDisplayedLp, animateLpOdometer, showLpDamageSequence, waitForLpPresentation } from "../src/ui/renderer/animations.js";
import { cardDefinition, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

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
