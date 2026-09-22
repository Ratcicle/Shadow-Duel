import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, type RuntimeGame } from "./helpers/game.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  Object.assign(game, { turn: "player", turnCounter: 2, phase: "main1", disablePresentationDelays: true });
  game.player.controllerType = game.bot.controllerType = "human";
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.ui.showChainResponseModal = async () => null;
  game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
  t.after(() => game.dispose());
  return game;
}
const make = (name: string) => new Card(cardDefinition(name), "player");

function berserkerSetup(game: RuntimeGame) {
  const spell = make("Polymerization");
  const fusion = make("Void Berserker");
  const fieldBrute = make("Void Slayer Brute");
  const handBrute = make("Void Slayer Brute");
  const hollow = make("Void Hollow");
  game.player.field.push(fieldBrute);
  game.player.hand.push(spell, handBrute, hollow);
  game.player.extraDeck.push(fusion);
  return { spell, fusion, fieldBrute, handBrute, hollow };
}

async function choose(game: RuntimeGame, kind: string, cards: Card[]) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (game.targetSelection?.kind === kind) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const selection = required(game.targetSelection);
  assert.equal(selection.kind, kind);
  const requirement = required(selection.requirements[0]);
  selection.selections = { [requirement.id]: cards.map((card) =>
    required(requirement.candidates.find((candidate) => candidate.cardRef === card)).key) };
  await game.finishTargetSelection();
}

test("Polymerization validates each material's actual zone and permits correcting a human selection", async (t) => {
  const game = setup(t);
  const { spell, fusion, fieldBrute, handBrute, hollow } = berserkerSetup(game);
  const activation = game.tryActivateSpell(spell, 0);
  await choose(game, "fusion_select", [fusion]);
  await choose(game, "fusion_materials", [handBrute, hollow]);
  for (let i = 0; i < 100 && !game.targetSelection; i++) await new Promise<void>((r) => setImmediate(r));
  assert.equal(game.player.field.includes(fusion), false);
  assert.equal(game.player.graveyard.includes(handBrute), false);
  await choose(game, "fusion_materials", [hollow, fieldBrute]);
  assert.equal((await activation).success, true);
  assert.ok(game.player.field.includes(fusion));
  assert.ok(game.player.hand.includes(handBrute));
  assert.ok(game.player.graveyard.includes(fieldBrute));
});

test("Polymerization blocks an existing summon restriction without consuming the spell", async (t) => {
  const game = setup(t);
  const { spell } = berserkerSetup(game);
  game.registerSpecialSummonRestriction(game.player, { allowedFilters: { archetype: "Tech-Zero" }, duration: "until_end_turn" });
  assert.equal(game.canActivatePolymerization(game.player), false);
  assert.equal(game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok, false);
  assert.equal((await game.tryActivateSpell(spell, 0)).success, false);
  assert.ok(game.player.hand.includes(spell));
  assert.equal(game.player.graveyard.length, 0);
});

test("Fusion execution rejects stale, duplicate and wrong-zone materials before moving any card", async (t) => {
  const game = setup(t);
  const { fusion, fieldBrute, handBrute, hollow } = berserkerSetup(game);
  assert.equal(await game.performFusionSummon([handBrute, hollow], 0, "attack", null, game.player), false);
  assert.equal(await game.performFusionSummon([fieldBrute, fieldBrute], 0, "attack", null, game.player), false);
  await game.moveCard(hollow, game.player, "graveyard", { fromZone: "hand" });
  assert.equal(await game.performFusionSummon([fieldBrute, hollow], 0, "attack", null, game.player), false);
  assert.ok(game.player.extraDeck.includes(fusion));
  assert.ok(game.player.field.includes(fieldBrute));
});

test("Fusion matching finds valid assignments independent of material selection order", (t) => {
  const game = setup(t);
  const a = make("Void Slayer Brute");
  const b = make("Void Hollow");
  const fusion = new Card({ id: 99071, name: "Overlapping fusion requirements", cardKind: "monster", monsterType: "fusion",
    fusionMaterials: [{ archetype: "Void" }, { name: a.name }] }, "player");
  for (const materials of [[a, b], [b, a]]) {
    assert.equal(game.effectEngine.evaluateFusionSelection(fusion, materials).valid, true);
  }
});

test("Fusion availability excludes exclusive procedures and combinations that cannot free a zone", (t) => {
  const game = setup(t);
  const fusion = make("Shadow-Heart Warlord");
  game.player.extraDeck.push(fusion);
  game.player.hand.push(make("Shadow-Heart Abyssal Eel"), make("Shadow-Heart Abyssal Eel"));
  game.player.field.push(...Array.from({ length: 5 }, () => make("Nightmare Steed")));
  assert.equal(game.effectEngine.getAvailableFusions(game.player.extraDeck, game.player.hand, game.player,
    { materialInfo: game.player.hand.map(() => ({ zone: "hand" })) }).length, 0);
  game.player.field.pop();
  assert.equal(game.canActivatePolymerization(game.player), true);
  fusion.extraDeckSummonProcedure = make("Arcturus, the Fallen Lord").extraDeckSummonProcedure;
  assert.equal(game.canActivatePolymerization(game.player), false);
});

test("Polymerization resolves without consuming materials if a Chain response forbids the summon", async (t) => {
  const game = setup(t);
  const { spell, fusion, fieldBrute, hollow } = berserkerSetup(game);
  const response = new Card(cardDefinition("Ancient Tree Spirit"), "bot");
  Object.assign(response, { isFacedown: true, setTurn: 1, turnSetOn: 1 });
  game.bot.spellTrap.push(response);
  let responded = false;
  game.ui.showChainResponseModal = async (candidates) => {
    if (!responded && candidates.some((candidate) => candidate.card === response)) {
      responded = true;
      game.registerSpecialSummonRestriction(game.player, { allowedFilters: { archetype: "Tech-Zero" } });
    }
    return null;
  };
  assert.equal(game.canActivatePolymerization(game.player), true);
  await game.tryActivateSpell(spell, 0);
  assert.equal(responded, true);
  assert.ok(game.player.graveyard.includes(spell));
  assert.ok(game.player.extraDeck.includes(fusion));
  assert.ok(game.player.field.includes(fieldBrute));
  assert.ok(game.player.hand.includes(hollow));
});

test("Bot fusion choices use legal combinations that free space on a full field", async (t) => {
  const game = setup(t);
  game.player.controllerType = "ai";
  const { spell, fusion, fieldBrute, handBrute } = berserkerSetup(game);
  game.player.field.push(...Array.from({ length: 4 }, () => make("Nightmare Steed")));
  assert.equal(game.canActivatePolymerization(game.player), true);
  assert.equal((await game.tryActivateSpell(spell, 0)).success, true);
  assert.ok(game.player.field.includes(fusion));
  assert.ok(game.player.graveyard.includes(fieldBrute));
  assert.ok(game.player.hand.includes(handBrute));
  assert.equal(game.player.field.length, 5);
});

test("Fusion execution retains requiredSubset and sends additional materials sequentially", async (t) => {
  const game = setup(t);
  const { fusion, fieldBrute, hollow, handBrute } = berserkerSetup(game);
  const sent: string[] = [];
  game.on("card_to_grave", ({ card }) => { sent.push(required(card.name)); });
  assert.equal(await game.performFusionSummon([fieldBrute, hollow, handBrute], 0, "attack", [fieldBrute, hollow], game.player), true);
  assert.ok(game.player.field.includes(fusion));
  assert.equal(sent.length, 3);
  assert.ok([fieldBrute, hollow, handBrute].every((card) => game.player.graveyard.includes(card)));
});

test("Fusion preview respects field presence limits after excluding its materials", (t) => {
  const game = setup(t);
  berserkerSetup(game);
  const exclusive = make("Nightmare Steed");
  exclusive.fieldPresenceRestriction = { type: "only_monster_you_control_while_faceup" };
  game.player.field.push(exclusive);
  assert.equal(game.canActivatePolymerization(game.player), false);
  exclusive.isFacedown = true;
  assert.equal(game.canActivatePolymerization(game.player), true);
});

test("A human can correct a material combination that leaves the monster field full", async (t) => {
  const game = setup(t);
  const spell = make("Polymerization");
  const fusion = make("Shadow-Heart Warlord");
  const fieldMaterial = make("Shadow-Heart Abyssal Eel");
  const handMaterials = [make("Shadow-Heart Abyssal Eel"), make("Shadow-Heart Abyssal Eel")];
  game.player.extraDeck.push(fusion);
  game.player.field.push(fieldMaterial, ...Array.from({ length: 4 }, () => make("Nightmare Steed")));
  game.player.hand.push(spell, ...handMaterials);
  const activation = game.tryActivateSpell(spell, 0);
  await choose(game, "fusion_select", [fusion]);
  await choose(game, "fusion_materials", handMaterials);
  await choose(game, "fusion_materials", [fieldMaterial, required(handMaterials[0])]);
  assert.equal((await activation).success, true);
  assert.ok(game.player.field.includes(fusion));
  assert.equal(game.player.field.length, 5);
});
