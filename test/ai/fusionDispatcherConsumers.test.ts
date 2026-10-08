import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import VoidStrategy from "../../src/core/ai/VoidStrategy.js";
import { simulateMainPhaseAction as simulateShadowHeart } from "../../src/core/ai/shadowheart/simulation.js";
import { buildLuminarchSimulationOptions, simulateLuminarchMainPhaseAction } from "../../src/core/ai/luminarch/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { cardDefinition, unsafeFixture } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import type { AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import { buildShadowHeartCostPreferences } from "../../src/core/ai/shadowheart/priorities.js";

const material = (name: string) => simulationCard(new Card({ ...cardDefinition(name), effects: [] }, "bot"));
const make = (name: string, owner: "bot" | "player" = "bot") => simulationCard(new Card(cardDefinition(name), owner));

for (const seat of ["player", "bot"] as const) {
  for (const alternative of ["Shadow-Heart Death Wyrm", "Shadow-Heart Griffin"] as const) {
    test(`public Polymerization preserves Devastation with ${alternative} and shares material identities with simulation (${seat})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0, randomSeed: 42 });
      t.after(() => game.dispose());
      game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
      game.player.controllerType = game.bot.controllerType = "ai";
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      const owner = game[seat];
      let nextId = 100;
      const actual = (name: string) => {
        const card = new Card({ ...cardDefinition(name), effects: [] }, seat);
        card.instanceId = nextId++; game.ensureDuelCardId(card);
        card.position = "attack"; card.isFacedown = false;
        return card;
      };
      const devastation = actual("Shadow-Heart Devastation Dragon"), other = actual(alternative), gecko = actual("Shadow-Heart Gecko");
      const fusion = new Card(cardDefinition("Shadow-Heart Warlord"), seat), spell = new Card(cardDefinition("Polymerization"), seat);
      placeFieldCards(owner.field, devastation, other); owner.hand.push(spell, gecko); owner.extraDeck.push(fusion);
      const preferences = buildShadowHeartCostPreferences({ field: owner.field, hand: owner.hand,
        graveyard: [], oppField: [], lp: 8000, oppLp: 8000, phase: "main1", canNormalSummon: false });
      const clone = (card: Card) => simulationCard({ ...cardDefinition(card.name), effects: [], instanceId: card.instanceId,
        atk: card.atk, def: card.def, position: card.position, isFacedown: card.isFacedown });
      const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 3,
        [seat]: { field: [clone(devastation), clone(other)], hand: [clone(gecko)], extraDeck: [simulationCard(fusion)] } });
      const activationContext = { actionContext: { costPreferences: preferences } };
      assert.equal((await game.tryActivateSpell(spell, 0, null, { owner, activationContext })).success, true);
      applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }], options: { actionContext: activationContext.actionContext } });
      const materialIds = (cards: readonly { instanceId?: number | string | null }[]) => cards
        .filter(card => card.instanceId === devastation.instanceId || card.instanceId === other.instanceId || card.instanceId === gecko.instanceId)
        .map(card => card.instanceId).sort((a, b) => Number(a) - Number(b));
      assert.deepEqual(materialIds(owner.graveyard), [other.instanceId, gecko.instanceId]);
      assert.deepEqual(materialIds(state[seat].graveyard), materialIds(owner.graveyard));
      assert.ok(owner.field.includes(devastation));
      assert.ok(state[seat].field.some(card => card.instanceId === devastation.instanceId));
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }
}

for (const scenario of ["demon", "pure", "crawler", "hydra"] as const) {
  test(`Fusion dispatcher preserves the ${scenario} consumer without repeating its declarative reward`, async t => {
    const fusionName = scenario === "demon" ? "Shadow-Heart Demon Dragon" : scenario === "pure" ? "Luminarch Pure Knight"
      : scenario === "crawler" ? "Void Shadow Crawler" : "Void Hydra Titan";
    const materialNames = scenario === "demon" ? ["Shadow-Heart Scale Dragon", "Shadow-Heart Demon Arctroth"]
      : scenario === "pure" ? Array.from({ length: 2 }, () => "Luminarch Valiant - Knight of the Dawn")
      : Array.from({ length: scenario === "hydra" ? 6 : 2 }, () => "Void Hollow");
    const deckNames = scenario === "pure" ? ["Sanctum of the Luminarch Citadel", "Sanctum of the Luminarch Citadel"]
      : scenario === "crawler" ? ["Void Hollow", "Void Hollow"] : ["Nightmare Steed", "Nightmare Steed", "Nightmare Steed"];
    const fusion = make(fusionName), spell = make("Polymerization"), materials = materialNames.map(material);
    const ally = material("Nightmare Steed"), enemies = [make("Nightmare Steed", "player"), make("Nightmare Steed", "player")];
    const enemySpells = [material("Mirror Force"), material("Mirror Force")];
    for (const card of enemySpells) card.owner = card.controller = card.originalOwner = "player";
    const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 3,
      bot: { hand: [spell, ...materials.slice(scenario === "hydra" ? 1 : 0)],
        field: scenario === "hydra" ? [materials[0]!, ally] : [], extraDeck: [fusion], deck: deckNames.map(material) },
      player: { field: scenario === "demon" ? enemies : [], spellTrap: scenario === "hydra" ? enemySpells : [] } });
    const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = "bot"; game.phase = "main1"; game.turnCounter = 3;
    game.player.controllerType = game.bot.controllerType = "ai";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    const runtimeMaterials = materialNames.map(name => new Card({ ...cardDefinition(name), effects: [] }, "bot"));
    const actualFusion = new Card(cardDefinition(fusionName), "bot"), actualSpell = new Card(cardDefinition("Polymerization"), "bot");
    game.bot.extraDeck.push(actualFusion);
    game.bot.hand.push(actualSpell, ...runtimeMaterials.slice(scenario === "hydra" ? 1 : 0));
    game.bot.deck.push(...deckNames.map(name => new Card({ ...cardDefinition(name), effects: [] }, "bot")));
    if (scenario === "hydra") {
      placeFieldCards(game.bot.field, runtimeMaterials[0]!, new Card({ ...cardDefinition("Nightmare Steed"), effects: [] }, "bot"));
      placeFieldCards(game.player.spellTrap, ...Array.from({ length: 2 }, () => new Card({ ...cardDefinition("Mirror Force"), effects: [] }, "player")));
    }
    if (scenario === "demon") placeFieldCards(game.player.field, ...Array.from({ length: 2 }, () => new Card({ ...cardDefinition("Nightmare Steed"), effects: [] }, "player")));
    assert.equal((await game.tryActivateSpell(actualSpell, 0, null, { owner: game.bot })).success, true);
    if (scenario === "demon") simulateShadowHeart(state, { type: "spell", index: 0, cardId: spell.id });
    else if (scenario === "pure") simulateLuminarchMainPhaseAction(state, { type: "spell", index: 0, cardId: spell.id });
    else new VoidStrategy(unsafeFixture<AIStrategyBotPort>(null,
      "The Fusion consumer uses the supplied state without consulting its live strategy actor")).simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: spell.id });
    assert.ok(state.bot.field.includes(fusion), JSON.stringify({ hand: state.bot.hand.map(card => card.name),
      field: state.bot.field.map(card => [card.name, card.instanceId]), extra: state.bot.extraDeck.map(card => card.name),
      unsupported: state._simUnsupportedActions }));
    const summary = (player: { field: Array<{ name?: string | undefined }>; spellTrap: Array<{ name?: string | undefined }>;
      hand: Array<{ name?: string | undefined }>; deck: Array<{ name?: string | undefined }> }) => ({
      field: player.field.map(card => card.name), spellTrap: player.spellTrap.map(card => card.name),
      hand: player.hand.length, deck: player.deck.map(card => card.name),
    });
    assert.deepEqual(summary(state.bot), summary(game.bot));
    assert.deepEqual(summary(state.player), summary(game.player));
    if (scenario === "pure") assert.equal(state.bot.hand.filter(card => card.name === "Sanctum of the Luminarch Citadel").length, 1);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
}

for (const seat of ["player", "bot"] as const) {
  test(`Fusion publishes the Luminarch defensive choice before its reward (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
    game.player.controllerType = game.bot.controllerType = "ai";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    const name = "Luminarch Pure Knight", materialName = "Luminarch Valiant - Knight of the Dawn";
    const makeActual = (cardName: string, stripped = false) => new Card({ ...cardDefinition(cardName),
      ...(stripped ? { effects: [] } : {}) }, seat);
    const actual = makeActual(name), actualSpell = makeActual("Polymerization");
    game[seat].extraDeck.push(actual);
    game[seat].hand.push(actualSpell, makeActual(materialName, true), makeActual(materialName, true));
    game[seat].deck.push(makeActual("Sanctum of the Luminarch Citadel", true));
    const activationContext = { actionContext: { fusionPositions: { byName: { [name]: "defense" as const } } } };
    const actualPositions: unknown[] = [], positions: unknown[] = [];
    game.on("after_summon", payload => { if (payload.card === actual) actualPositions.push(payload.card.position); });
    assert.equal((await game.tryActivateSpell(actualSpell, 0, null, { owner: game[seat], activationContext })).success, true);
    const fusion = simulationCard(makeActual(name));
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { extraDeck: [fusion], hand: [simulationCard(makeActual(materialName, true)), simulationCard(makeActual(materialName, true))],
        deck: [simulationCard(makeActual("Sanctum of the Luminarch Citadel", true))] } });
    const action = { type: "spell" as const, index: 0, cardId: actualSpell.id, activationContext };
    const chooser = buildLuminarchSimulationOptions(state, action).chooseSpecialSummonPosition;
    const options = { enableSimulatedEvents: true,
      ...(chooser ? { chooseSpecialSummonPosition: chooser } : {}),
      onSimulatedEvent: (event: string, payload: object) => {
        if (event === "after_summon" && Reflect.get(payload, "card") === fusion) positions.push(Reflect.get(payload, "position"));
      } };
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }], options }), true);
    assert.deepEqual(actualPositions, ["defense"]);
    assert.deepEqual(positions, actualPositions);
    assert.equal(fusion.position, actual.position);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
}

test("the shared Fusion dispatcher applies Raven immunity through the shared runtime rule", () => {
  const fusion = make("Void Hollow King"), spell = make("Polymerization"), raven = make("Void Raven");
  const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 3,
    bot: { hand: [spell, material("Void Hollow"), material("Void Hollow"), material("Void Hollow"), raven], extraDeck: [fusion],
      deck: [material("Void Hollow")] } });
  new VoidStrategy(unsafeFixture<AIStrategyBotPort>(null,
    "The supplied Fusion projection does not access a live strategy actor")).simulateMainPhaseAction(state,
      { type: "spell", index: 0, cardId: spell.id });
  assert.ok(state.bot.field.includes(fusion));
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
  // Void Raven grants immunity until the end of the next turn: turnCounter 3 + durationTurns 1.
  assert.equal(fusion.immuneToOpponentEffectsUntilTurn, 4);
  assert.equal(state.bot.graveyard.filter(card => card === raven).length, 1);
});
