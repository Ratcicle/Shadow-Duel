import assert from "node:assert/strict";
import test from "node:test";
import type Renderer from "../../src/ui/Renderer.js";
import Player from "../../src/core/Player.js";
import { updateLP } from "../../src/ui/renderer/log.js";
import { ensureLpDisplayState, getDisplayedLp, setDisplayedLp } from "../../src/ui/renderer/animations.js";
import { unsafeFixture } from "../helpers/fixtures.js";

function hudElement() {
  const name = { textContent: "", title: "" };
  const properties = new Map<string, string>();
  return {
    name, properties,
    textContent: "8000",
    style: { setProperty: (key: string, value: string) => properties.set(key, value) },
    closest: (selector: string) => selector === ".player-info" ? { querySelector: () => name } : null,
  };
}

test("HUD updates names and LP on the corresponding participant without losing full names or values", () => {
  const playerLP = hudElement(), botLP = hudElement();
  const renderer = unsafeFixture<Renderer>({
    elements: { playerLP, botLP }, lpDisplayState: {},
    ensureLpDisplayState, getDisplayedLp, setDisplayedLp,
  }, "DOM-shaped LP/name elements isolate the existing renderer's presentation methods.");
  const player = new Player("player", "Um nome humano muito comprido", "human");
  const bot = new Player("bot", "Shadow-Heart Bot", "ai");
  for (const lp of [8000, 12345, 123456789, Number.MAX_SAFE_INTEGER, 0, 0.5]) {
    player.lp = lp;
    bot.lp = lp + 1;
    updateLP.call(renderer, player);
    updateLP.call(renderer, bot);
    assert.equal(playerLP.textContent, String(lp));
    assert.equal(botLP.textContent, String(lp + 1));
    assert.equal(playerLP.name.textContent, player.name);
    assert.equal(playerLP.name.title, player.name);
    assert.equal(botLP.name.title, "Shadow-Heart Bot");
    assert.equal(playerLP.properties.get("--lp-digits"), String(Math.max(5, String(lp).length)));
  }
  bot.name = "Jogador 2";
  updateLP.call(renderer, bot);
  assert.equal(botLP.name.textContent, "Jogador 2");
  const state = renderer.ensureLpDisplayState(player)!;
  state.animating = true;
  renderer.setDisplayedLp(player, 6500);
  player.lp = 6000;
  updateLP.call(renderer, player);
  assert.equal(playerLP.textContent, "6500", "board updates must not jump to the final LP during an animation");
});
