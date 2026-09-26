import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import { getAvailableBotPresets, getBotPresetPresentation } from "../../src/core/bot/presets.js";
import { cardDatabase } from "../../src/data/cards.js";

const representatives = [
  ["shadowheart", "Shadow-Heart Scale Dragon"],
  ["luminarch", "Luminarch Fortress Aegis"],
  ["void", "Arcturus, Lord of the Void"],
  ["dragon", "Radiant Cosmic Dragon"],
  ["arcanist", "Arcanist Apprentice"],
  ["miragebound", "Miragebound Rebel"],
  ["bloomrot", "Bloomrot Carrioncap"],
  ["burningwest", "Gunslinger of the Burning West"],
  ["techzero", "Tech-Zero Explosive Lancer"],
] as const;

test("each bot portrait uses the approved monster, an in-bounds crop and a valid accent", () => {
  for (const [id, name] of representatives) {
    const preset = getBotPresetPresentation(id);
    assert.ok(preset, id);
    assert.match(preset.hudAccent, /^#[a-f\d]{6}$/i);
    const card = cardDatabase.find(card => card.name === name);
    assert.equal(card?.cardKind, "monster");
    assert.equal(preset.avatarPortrait.asset, card?.image);
    assert.ok(statSync(new URL(`../../public/${preset.avatarPortrait.asset}`, import.meta.url)).isFile());
    const { sourceWidth, crop } = preset.avatarPortrait;
    assert.ok(Number.isFinite(sourceWidth) && sourceWidth > 0);
    assert.ok([crop.x, crop.y, crop.size].every(Number.isFinite));
    assert.ok(crop.size > 0 && crop.size < sourceWidth);
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.size <= sourceWidth);
    // All nine approved source assets are 896 × 1200; browser QA also checks natural dimensions.
    assert.equal(sourceWidth, 896);
    assert.ok(crop.y + crop.size <= 1200);
  }
  assert.equal(getBotPresetPresentation("__proto__"), null);
  assert.equal(getBotPresetPresentation("missing"), null);
});

test("revised accents represent the whole Void, Miragebound and Tech-Zero collections", () => {
  assert.equal(getBotPresetPresentation("void")?.hudAccent, "#5686a2");
  assert.equal(getBotPresetPresentation("miragebound")?.hudAccent, "#c99a4d");
  assert.equal(getBotPresetPresentation("techzero")?.hudAccent, "#6faec6");
});

test("playable presets expose their canonical identity without exposing mutable catalog data", () => {
  for (const preset of getAvailableBotPresets()) {
    assert.deepEqual(getBotPresetPresentation(preset.id), preset);
    preset.avatarPortrait.crop.x = -1;
    assert.ok(getBotPresetPresentation(preset.id)!.avatarPortrait.crop.x >= 0);
  }
  assert.equal(getAvailableBotPresets().length, 8, "visual data must not silently add an unsupported AI");
});
