import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { simulateMainPhaseAction } from "../../src/core/ai/shadowheart/simulation.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { cleanupSimulatedEndTurn } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const SUMMON = "shadow_heart_hatred_empress_summon";
const NEGATE = "shadow_heart_hatred_empress_negate";
const card = (id: number, owner: "player" | "bot" = "bot") => simulationCard(new Card(cardDefinition(id), owner));

function project<Card extends { id?: number | string | null | undefined; atk?: number | undefined; isFacedown?: boolean | undefined; effectsNegated?: boolean | undefined; extraAttacks?: number | undefined }>(cards: Iterable<Card>) {
  return Array.from(cards, card => ({ id: card.id, atk: card.atk, facedown: card.isFacedown ?? false,
    negated: card.effectsNegated ?? false, extraAttacks: card.extraAttacks ?? 0 }))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

for (const seat of ["player", "bot"] as const) {
  for (const search of ["accept", "decline", "no candidate"] as const) {
    test(`complete E1 simulation matches real Chain in ${seat} (${search})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
      t.after(() => game.dispose());
      game.turn = seat; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
      game.waitForPresentationDelay = async () => {}; game.waitForAiPresentationStep = async () => {}; game.waitForBoardPresentation = async () => {};
      game.player.controllerType = game.bot.controllerType = "ai";
      const owner = game[seat], make = (id: number) => new Card(cardDefinition(id), owner.id);
      const source = make(127), first = make(101), second = make(125), recruit = make(104);
      owner.hand.push(source, first, second);
      if (search !== "no candidate") owner.deck.push(recruit);
      const simulatedSource = card(127), simFirst = card(101), simSecond = card(125), simRecruit = card(104);
      const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", turnCounter: 4,
        bot: { hand: [simulatedSource, simFirst, simSecond], deck: search === "no candidate" ? [] : [simRecruit] } });
      const liveSelection = search === "accept" ? [recruit.instanceId] : [];
      const simSelection = search === "accept" ? [required(simRecruit.instanceId)] : [];
      const result = await game.tryActivateMonsterEffect(source, { hatred_empress_discard: [first, second] }, "hand", owner,
        { effectId: SUMMON, activationContext: { decisions: { selections: { hatred_empress_search: liveSelection } } } });
      assert.equal(result.success, true, result.reason || undefined);
      simulateMainPhaseAction(state, { type: "handIgnition", index: 0, cardId: 127, effectId: SUMMON,
        activationContext: { decisions: { selections: { hatred_empress_discard: [required(simFirst.instanceId), required(simSecond.instanceId)], hatred_empress_search: simSelection } } } });
      assert.deepEqual(project(state.bot.field), project(owner.field));
      assert.deepEqual(project(state.bot.hand), project(owner.hand));
      assert.deepEqual(project(state.bot.deck), project(owner.deck));
      assert.deepEqual(project(state.bot.graveyard), project(owner.graveyard));
      assert.ok(state.bot.field.includes(simulatedSource));
      assert.equal(canUseSimulatedEffectUsage(state, required(simulatedSource.effects?.[0]), card(127)), false);
      assert.equal(canUseSimulatedEffectUsage(state, required(simulatedSource.effects?.[1]), card(127)), true);
    });
  }

  test(`complete E2 simulation matches real Chain negation, count and durations in ${seat}`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
    game.waitForPresentationDelay = async () => {}; game.waitForAiPresentationStep = async () => {}; game.waitForBoardPresentation = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat], opponent = seat === "player" ? game.bot : game.player;
    const source = new Card(cardDefinition(127), owner.id), ally = new Card(cardDefinition(101), owner.id), other = new Card(cardDefinition(1), owner.id);
    placeFieldCards(owner.field, source, ally, other);
    const fresh = new Card(cardDefinition(1), opponent.id), freshSecond = new Card(cardDefinition(1), opponent.id), already = new Card(cardDefinition(1), opponent.id), immune = new Card(cardDefinition(1), opponent.id), hidden = new Card(cardDefinition(1), opponent.id);
    already.effectsNegated = true; immune.unaffectedByOpponentCardEffects = true; hidden.isFacedown = true;
    placeFieldCards(opponent.field, fresh, freshSecond, already, immune, hidden);
    const simSource = card(127), simAlly = card(101), simOther = card(1);
    const simFresh = card(1, "player"), simFreshSecond = card(1, "player"), simAlready = card(1, "player"), simImmune = card(1, "player"), simHidden = card(1, "player");
    simAlready.effectsNegated = true; simImmune.unaffectedByOpponentCardEffects = true; simHidden.isFacedown = true;
    const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", turnCounter: 4,
      bot: { field: [simSource, simAlly, simOther] }, player: { field: [simFresh, simFreshSecond, simAlready, simImmune, simHidden] } });
    assert.equal((await game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: NEGATE })).success, true);
    simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0, cardId: 127, effectId: NEGATE });
    assert.deepEqual(project(state.bot.field), project(owner.field));
    assert.deepEqual(project(state.bot.graveyard), project(owner.graveyard));
    assert.deepEqual(project(state.player.field), project(opponent.field));
    assert.equal(simAlly.atk, 2200);
    assert.equal(canUseSimulatedEffectUsage(state, required(simSource.effects?.[0]), card(127)), true);
    assert.equal(canUseSimulatedEffectUsage(state, required(simSource.effects?.[1]), card(127)), false);
    game.cleanupTempBoosts(owner); game.cleanupTempBoosts(opponent); cleanupSimulatedEndTurn(state);
    assert.deepEqual(project(state.bot.field), project(owner.field));
    assert.deepEqual(project(state.player.field), project(opponent.field));
    assert.equal(simAlly.atk, 2200);
    await game.effectEngine.applyActions([{ type: "set_facedown_defense", targetRef: "ally" }], { source, player: owner, opponent }, { ally: [ally] });
    applySimulatedActions({ state, actions: [{ type: "set_facedown_defense", targetRef: "ally" }], selections: { ally: [simAlly] }, options: { sourceCard: simSource } });
    assert.deepEqual(project(state.bot.field), project(owner.field));
  });
}

// Main-phase simulation receives actions inside the public Main Phase boundary;
// phase/turn legality is covered through the real activation pipeline above.
for (const invalid of ["one other monster", "full field", "no face-up opponent"] as const) {
  test(`complete simulation preserves costs and OPT when rejected: ${invalid}`, () => {
    const source = card(127), first = card(101), second = card(125);
    const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", turnCounter: 4,
      bot: { hand: invalid === "one other monster" ? [source, first] : [source, first, second],
        field: invalid === "full field" ? Array.from({ length: 5 }, () => card(101)) : [] } });
    if (invalid === "no face-up opponent") {
      state.bot.hand = []; state.bot.field.push(source); source.fieldSlot = 0;
      const hidden = card(1, "player"); hidden.isFacedown = true; state.player.field.push(hidden); hidden.fieldSlot = 0;
      simulateMainPhaseAction(state, { type: "monsterEffect", cardId: 127, fieldIndex: 0, effectId: NEGATE });
      assert.ok(state.bot.field.includes(source));
      assert.equal(canUseSimulatedEffectUsage(state, required(source.effects?.[1]), source), true);
    } else {
      simulateMainPhaseAction(state, { type: "handIgnition", cardId: 127, index: 0, effectId: SUMMON });
      assert.ok(state.bot.hand.includes(source) && state.bot.hand.includes(first));
      assert.equal(canUseSimulatedEffectUsage(state, required(source.effects?.[0]), source), true);
    }
    assert.equal(state.bot.graveyard.length, 0);
  });
}

for (const unchanged of ["already negated", "immune"] as const) {
  test(`complete E2 simulation pays and consumes OPT with only ${unchanged} opposition`, () => {
    const source = card(127), ally = card(101), target = card(1, "player");
    target.effectsNegated = unchanged === "already negated";
    target.unaffectedByOpponentCardEffects = unchanged === "immune";
    const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", turnCounter: 4,
      bot: { field: [source, ally] }, player: { field: [target] } });
    simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0, cardId: 127, effectId: NEGATE });
    assert.ok(state.bot.graveyard.includes(source));
    assert.equal(ally.atk, ally.baseAtk);
    assert.equal(target.effectsNegated, unchanged === "already negated");
    assert.equal(canUseSimulatedEffectUsage(state, required(source.effects?.[1]), source), false);
  });
}
