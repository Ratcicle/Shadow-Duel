import assert from "node:assert/strict";
import test from "node:test";
import type Renderer from "../../src/ui/Renderer.js";
import Player from "../../src/core/Player.js";
import { updateLP } from "../../src/ui/renderer/log.js";
import { ensureLpDisplayState, getDisplayedLp, setDisplayedLp } from "../../src/ui/renderer/animations.js";
import { unsafeFixture } from "../helpers/fixtures.js";
import { getAvailableBotPresets } from "../../src/core/bot/presets.js";

function styleFixture() {
  const values = new Map<string, string>();
  return { values, setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key) };
}

function hudElement() {
  const name = { textContent: "", title: "" };
  const properties = new Map<string, string>();
  const style = styleFixture();
  const images: Array<{ src: string; alt: string; draggable: boolean; className: string; style: ReturnType<typeof styleFixture> }> = [];
  const avatar = {
    ownerDocument: { createElement: () => ({ src: "", alt: "", draggable: true, className: "", style: styleFixture(), getAttribute() { return this.src; } }) },
    querySelector: () => images[0] ?? null,
    replaceChildren: (...children: typeof images) => { images.splice(0, images.length, ...children); },
  };
  const hud = { style, querySelector: (selector: string) => selector === ".name" ? name : selector === ".player-avatar-frame" ? avatar : null };
  return {
    name, properties, hud, images,
    textContent: "8000",
    style: { setProperty: (key: string, value: string) => properties.set(key, value) },
    closest: (selector: string) => selector === ".player-info" ? hud : null,
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

test("HUD identity follows AI preset changes and clears portraits for human participants on either side", () => {
  const playerLP = hudElement(), botLP = hudElement();
  const renderer = unsafeFixture<Renderer>({ elements: { playerLP, botLP } }, "DOM-shaped HUD elements exercise the real renderer without a browser.");
  for (const [id, element] of [["player", playerLP], ["bot", botLP]] as const) {
    const participant = new Player(id, "Explicit participant name", "ai");
    for (const preset of getAvailableBotPresets()) {
      participant.archetype = preset.id;
      updateLP.call(renderer, participant);
      assert.equal(element.images.length, 1);
      assert.equal(element.images[0]!.src, `/${preset.avatarPortrait.asset}`);
      assert.equal(element.hud.style.values.get("--hud-accent"), preset.hudAccent);
      assert.equal(element.name.textContent, "Explicit participant name");
      const image = element.images[0];
      updateLP.call(renderer, participant);
      assert.equal(element.images[0], image, "LP updates must reuse the portrait node");
    }
    participant.controllerType = "human";
    updateLP.call(renderer, participant);
    assert.equal(element.images.length, 0, "humans stay empty even with an archetype/deck");
    assert.equal(element.hud.style.values.has("--hud-accent"), false);
    participant.controllerType = "ai";
    participant.archetype = "unknown";
    updateLP.call(renderer, participant);
    assert.equal(element.images.length, 0);
  }
});
