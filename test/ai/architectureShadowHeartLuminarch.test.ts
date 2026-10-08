import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import LuminarchStrategy from "../../src/core/ai/LuminarchStrategy.js";
import { canUseNormalSummonForCard } from "../../src/core/Player.js";
import { getNormalSummonTributeOptions } from "../../src/core/game/summon/tributeValue.js";
import { evaluateLuminarchRadiantWavePolicy } from "../../src/core/ai/luminarch/defensePolicy.js";
import { evaluateMoonlitReviveCandidate } from "../../src/core/ai/luminarch/moonlitPlanning.js";
import { markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { resolveSimulatedLpCost } from "../../src/core/ai/common/simulatedActions/shared.js";
import { createArchitectureFixture } from "../helpers/architectureBaseline.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const archetype of ["shadowheart", "luminarch"] as const) {
  for (const permission of ["unrestricted", "matching", "exhausted", "wrong_archetype"] as const) {
    test(`${archetype} Strategy respects a remaining Normal Summon permission: ${permission}`, () => {
      const { state } = createArchitectureFixture(archetype, "starter", "bot");
      state.bot.hand = [required(state.bot.hand[0])];
      state.bot.summonCount = 1;
      state.bot.additionalNormalSummons = permission === "unrestricted" ? 1 : 0;
      if (permission === "matching" || permission === "wrong_archetype") {
        state.bot.additionalNormalSummonPermissions = [{ count: 1, filters: {
          archetype: permission === "matching" ? required(state.bot.hand[0]).archetype! : "Void",
        } }];
      }
      const strategy = archetype === "shadowheart" ? new ShadowHeartStrategy(state.bot) : new LuminarchStrategy(state.bot);
      const legal = canUseNormalSummonForCard(state.bot, required(state.bot.hand[0]));
      assert.equal(legal, permission === "unrestricted" || permission === "matching");
      const summons = strategy.generateMainPhaseActions(state).filter(action => action.type === "summon");
      assert.equal(summons.length, legal ? 1 : 0);
      assert.equal(state.bot.summonCount, 1, "A candidate query cannot spend the allowance.");
    });
  }
  test(`${archetype} full-field Strategy still admits its profitable legal Tribute Summon`, () => {
    const { state } = createArchitectureFixture(archetype, "full_field", "bot");
    const bossId = archetype === "shadowheart" ? 104 : 155;
    const incoming = simulationCard({ ...cardDefinition(bossId), instanceId: 8001 });
    state.bot.hand = [incoming];
    // Valid but disposable bodies make this a policy-positive conversion,
    // rather than asserting that every legal tribute should be selected.
    state.bot.field = [1, 5, 9, 23, 26].map((id, index) => simulationCard({
      ...cardDefinition(id), instanceId: 8100 + index, isFacedown: false, atk: 0, def: 0,
      fieldSlot: index as 0 | 1 | 2 | 3 | 4,
    }));
    state.player.field = [simulationCard({ ...cardDefinition(1), instanceId: 8201, isFacedown: false })];
    assert.ok(getNormalSummonTributeOptions(state.bot, incoming).length > 0);
    const strategy = archetype === "shadowheart" ? new ShadowHeartStrategy(state.bot) : new LuminarchStrategy(state.bot);
    assert.ok(strategy.generateMainPhaseActions(state).some(action => action.type === "summon" && action.cardId === bossId));
    assert.equal(state.bot.field.length, 5);
  });
}

for (const restricted of [false, true]) {
  test(`Barbarias through Strategy preserves an existing attack restriction (${restricted}) and consumes its soft OPT`, () => {
    const barbarias = simulationCard({ ...cardDefinition(171), instanceId: 9001, isFacedown: false, position: "defense", cannotAttackThisTurn: restricted });
    const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 4, bot: { field: [barbarias] } });
    const strategy = new LuminarchStrategy(state.bot);
    const action = { type: "monsterEffect" as const, fieldIndex: 0, cardId: 171, effectId: "megashield_barbarias_switch_boost", priority: 10 };
    strategy.simulateMainPhaseAction(state, action);
    assert.equal(barbarias.position, "attack");
    assert.equal(barbarias.atk, 3300);
    assert.equal(barbarias.cannotAttackThisTurn, restricted);
    // Put it back in Defense without resetting the turn or copy identity:
    // a second attempted activation must not produce a second 800 ATK.
    barbarias.position = "defense";
    strategy.simulateMainPhaseAction(state, action);
    assert.equal(barbarias.atk, 3300);
    assert.equal(barbarias.position, "defense");
  });
}

for (const uses of [0, 1, 2]) {
  test(`Radiant Wave policy uses the public LP quote after Pure Knight reducer uses=${uses}`, () => {
    const knight = simulationCard({ ...cardDefinition(173), instanceId: 9101, isFacedown: false });
    const wave = simulationCard({ ...cardDefinition(164), instanceId: 9102 });
    const threat = simulationCard({ ...cardDefinition(270), instanceId: 9103, isFacedown: false });
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, bot: { field: [knight], hand: [wave], lp: 1800 }, player: { field: [threat] } });
    const reducer = required(knight.effects?.find(effect => effect.timing === "passive" && "passive" in effect && effect.passive?.type === "lp_cost_reduction"));
    for (let use = 0; use < uses; use++) markSimulatedEffectUsage(state, reducer, knight, "bot", true);
    const quote = resolveSimulatedLpCost({ action: { type: "pay_lp", amount: 2000 }, baseAmount: 2000, targetPlayer: state.bot,
      self: state.bot, opponent: state.player, state, options: { sourceCard: wave } });
    const strategy = new LuminarchStrategy(state.bot);
    const analysis = strategy.buildPlanningAnalysis(state);
    const before = structuredClone(state);
    const decision = evaluateLuminarchRadiantWavePolicy(analysis);
    assert.equal(quote.finalAmount, uses < 2 ? 1000 : 2000);
    assert.equal(decision.lpCost, quote.finalAmount);
    if (uses === 2) assert.equal(decision.yes, false, "An exhausted reducer cannot make an unaffordable removal candidate legal.");
    assert.deepEqual(state, before);
  });
}

test("Barbarias Strategy resolves its exact selected allied copy instead of always changing the source", () => {
  const source = simulationCard({ ...cardDefinition(171), instanceId: 9201, isFacedown: false, position: "attack" });
  const first = simulationCard({ ...cardDefinition(151), instanceId: 9202, isFacedown: false, position: "defense" });
  const selected = simulationCard({ ...cardDefinition(151), instanceId: 9203, isFacedown: false, position: "defense" });
  const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 4, bot: { field: [source, first, selected] } });
  const initialAtk = required(selected.atk);
  new LuminarchStrategy(state.bot).simulateMainPhaseAction(state, {
    type: "monsterEffect", fieldIndex: 0, cardId: 171, priority: 10, effectId: "megashield_barbarias_switch_boost",
    activationContext: { decisions: { selections: { barbarias_switch_target: [9203] } } },
  });
  assert.equal(source.position, "attack");
  assert.equal(first.position, "defense");
  assert.equal(selected.position, "attack");
  assert.equal(selected.atk, initialAtk + 800);
});

test("Barbarias Strategy cannot apply its position/ATK actions while its effects are negated", () => {
  const source = simulationCard({ ...cardDefinition(171), instanceId: 9301, isFacedown: false, position: "defense", effectsNegated: true });
  const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 4, bot: { field: [source] } });
  new LuminarchStrategy(state.bot).simulateMainPhaseAction(state, {
    type: "monsterEffect", fieldIndex: 0, cardId: 171, priority: 10, effectId: "megashield_barbarias_switch_boost",
  });
  assert.equal(source.position, "defense");
  assert.equal(source.atk, 2500);
});

for (const reducerStatus of ["absent", "available", "exhausted"] as const) {
  test(`Moonlit follow-up planning includes Citadel's activation LP cost (${reducerStatus})`, () => {
    const citadel = simulationCard({ ...cardDefinition(162), instanceId: 9401, isFacedown: false });
    const revive = simulationCard({ ...cardDefinition(151), instanceId: 9402 });
    const knight = simulationCard({ ...cardDefinition(173), instanceId: 9403, isFacedown: false });
    const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 4,
      bot: { fieldSpell: citadel, graveyard: [revive], field: reducerStatus === "absent" ? [] : [knight], lp: 500 } });
    const reducer = required(knight.effects?.find(effect => effect.id === "luminarch_pure_knight_lp_discount"));
    if (reducerStatus === "exhausted") for (let use = 0; use < 2; use++) markSimulatedEffectUsage(state, reducer, knight, "bot", true);
    const effect = required(citadel.effects?.find(entry => entry.id === "sanctum_luminarch_citadel_buff"));
    const cost = required(effect.activationCosts?.find(action => action.type === "pay_lp"));
    assert.equal(cost.type, "pay_lp");
    const quote = resolveSimulatedLpCost({ action: cost, baseAmount: 1000, targetPlayer: state.bot,
      self: state.bot, opponent: state.player, state, options: { sourceCard: citadel } });
    assert.equal(quote.finalAmount, reducerStatus === "available" ? 0 : 1000);
    // The correction is anchored in the live engine, including physical owner
    // usage. A projected discount alone is not an oracle for legality.
    for (const seat of ["player", "bot"] as const) {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      try {
        game.turnCounter = 4;
        const owner = game[seat];
        const opponent = game[seat === "player" ? "bot" : "player"];
        owner.lp = 500;
        const liveCitadel = new Card(cardDefinition(162), owner.id);
        const liveKnight = new Card(cardDefinition(173), owner.id);
        liveCitadel.isFacedown = false;
        liveKnight.isFacedown = false;
        owner.fieldSpell = liveCitadel;
        if (reducerStatus !== "absent") placeFieldCards(owner.field, liveKnight);
        const liveReducer = required(liveKnight.effects?.find(entry => entry.id === reducer.id));
        if (reducerStatus === "exhausted") {
          for (let use = 0; use < 2; use++) game.effectEngine.markOncePerTurn(liveReducer, { player: owner, source: liveKnight });
        }
        const liveEffect = required(liveCitadel.effects?.find(entry => entry.id === effect.id));
        const liveCost = required(liveEffect.activationCosts?.find(action => action.type === "pay_lp"));
        assert.equal(liveCost.type, "pay_lp");
        const runtimeQuote = game.effectEngine.resolveLpCost(liveCost,
          { player: owner, opponent, source: liveCitadel }, 1000, { preview: true, consume: false });
        assert.equal(runtimeQuote.finalAmount, quote.finalAmount);
        assert.equal(owner.lp, 500);
      } finally {
        game.dispose("moonlit_activation_cost_oracle");
      }
    }
    const analysis = new LuminarchStrategy(state.bot).buildPlanningAnalysis(state);
    const before = structuredClone(state);
    const plan = evaluateMoonlitReviveCandidate(revive, analysis);
    assert.equal(plan.projectedAtk, required(revive.atk) + (quote.finalAmount <= state.bot.lp ? 500 : 0));
    assert.deepEqual(state, before, "a follow-up quote cannot consume the real reducer");
  });
}

test("Pure Knight's source filter keeps Marshal's monster activation cost at 2000 LP", () => {
  const knight = simulationCard({ ...cardDefinition(173), instanceId: 9501, isFacedown: false });
  const marshal = simulationCard({ ...cardDefinition(155), instanceId: 9502 });
  const state = simulationState({ turnCounter: 4, bot: { field: [knight], hand: [marshal] } });
  const before = structuredClone(state);
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal(resolveSimulatedLpCost({ action: { type: "pay_lp", amount: 2000 }, baseAmount: 2000,
      targetPlayer: state.bot, self: state.bot, opponent: state.player, state, options: { sourceCard: marshal } }).finalAmount, 2000);
  }
  assert.deepEqual(state, before);
});
