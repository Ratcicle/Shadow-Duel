import assert from "node:assert/strict";
import test from "node:test";
import MirageboundStrategy from "../../src/core/ai/MirageboundStrategy.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { MirageboundGame, MirageboundCard } from "../../src/core/ai/miragebound/contracts.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { createMaterialDuelStats } from "../../src/core/game/summon/materialStats.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { simulationCard, simulationState, placeSimulationCards } from "../helpers/simulation.js";

function card(id: number, instanceId: number) {
  const result = simulationCard({ ...cardDefinition(id), instanceId, position: "attack", isFacedown: false });
  return Object.assign(result, { name: required(result.name) });
}

function readPath(value: unknown, keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    assert.ok(current && typeof current === "object", `Expected object before ${key}`);
    current = Reflect.get(current, key);
  }
  return current;
}

function fixture(seat: "bot" | "player", field: MirageboundCard[] = [], opponent: MirageboundCard[] = []) {
  const state = unsafeFixture<ReturnType<typeof simulationState> & MirageboundGame>(simulationState({ _isPerspectiveState: true,
    turn: seat, phase: "main1", turnCounter: 4,
    bot: { id: seat, field }, player: { id: seat === "bot" ? "player" : "bot", field: opponent } }),
    "Direct fixture supplies the Miragebound read/simulation port without a live Game or a profile-specific clone brand.");
  return { state, strategy: new MirageboundStrategy(state.bot) };
}

function scoutStats(seat: "bot" | "player", activations: number) {
  const stats = createMaterialDuelStats();
  stats[seat].effectActivationsByMaterialId.set(351, activations);
  return stats;
}

class ObservedMiragebound extends MirageboundStrategy {
  calls: string[] = [];
  emitted: AIAction[] = [];
  override analyzeGameState(game: MirageboundGame) {
    this.calls.push("analysis");
    return super.analyzeGameState(game);
  }
  override rankByNameOrder(cards: MirageboundCard[] = [], names: string[] = []) {
    this.calls.push("rank");
    return super.rankByNameOrder(cards, names);
  }
  override sequenceActions(actions: AIAction[] = []) {
    this.calls.push("sequence");
    this.emitted = [...actions];
    return super.sequenceActions(actions);
  }
  override integrateP2IntoActionSelection(_game: MirageboundGame, actions: AIAction[]) {
    this.calls.push("p2");
    return actions;
  }
}

for (const seat of ["bot", "player"] as const) {
  test(`Miragebound bounce preferences protect progressed Scout and retain physical Viper ties (${seat})`, () => {
    const dancer = card(352, 41001), scout = card(351, 41002);
    const firstViper = card(356, 41003), secondViper = card(356, 41004);
    const { state, strategy } = fixture(seat, [dancer, scout, firstViper, secondViper], [card(1, 41005)]);
    const game: MirageboundGame = { ...state, materialDuelStats: scoutStats(seat, 1) };
    const effect = required(dancer.effects?.find(effect => effect.id === "miragebound_dancer_bounce_buff"));
    const context = required(strategy.buildActivationContextForEffect({ sourceCard: dancer, effect, player: state.bot, game }));
    const preference = required(context.actionContext?.targetPreferences?.miragebound_dancer_bounce_target);
    assert.deepEqual(preference.preferredInstanceIds?.slice(0, 2), [41003, 41004]);
    assert.ok(preference.avoidInstanceIds?.includes(41002));
    const costPreferences: unknown = Reflect.get(required(context.actionContext), "costPreferences");
    assert.ok(costPreferences && typeof costPreferences === "object");
    const preservedNames: unknown = Reflect.get(costPreferences, "preserveNames");
    assert.ok(Array.isArray(preservedNames) && preservedNames.includes(scout.name));
    assert.equal(Reflect.get(costPreferences, "preserveLastOffensivePayoff"), true);
    assert.equal(strategy.currentAnalysis?.preserveScout, true);
  });

  test(`Miragebound False King procedure retains exact physical cost and success-only consumption (${seat})`, () => {
    const cost = card(352, 41101), incoming = card(358, 41102);
    const { state, strategy } = fixture(seat, [cost]);
    state.bot.hand.push(incoming);
    const before = JSON.stringify(state);
    const action = required(strategy.generateMainPhaseActions(state).find(action => action.type === "handSummonProcedure"));
    assert.equal(action.type, "handSummonProcedure");
    assert.equal(action.index, 0);
    assert.equal(action.cardId, incoming.id);
    assert.equal(incoming.handSummonProcedure?.oncePerTurnConsumeOn, "success");
    assert.equal(JSON.stringify(state), before, "generation is read-only and does not pay the procedure");
    assert.equal(strategy.simulateMainPhaseAction(state, action), state);
    assert.equal(state.bot.hand.includes(cost), true);
    assert.equal(state.bot.field.includes(cost), false);
    assert.equal(state.bot.field.includes(incoming), true);
    assert.equal(state.bot.hand.includes(incoming), false);
    assert.equal(state.bot.field.length, 1);
  });

  test(`Miragebound Dancer resolution returns the selected sister once and keeps progressed Scout (${seat})`, () => {
    const source = card(352, 41111), sister = card(352, 41112), scout = card(351, 41113);
    const { state, strategy } = fixture(seat, [source, sister, scout], [card(1, 41114)]);
    const game: MirageboundGame = { ...state, materialDuelStats: scoutStats(seat, 1) };
    const analysis = strategy.analyzeGameState(game);
    const action = required(strategy.getMonsterEffectActions(game, state.bot, analysis).find(action => action.fieldIndex === 0));
    assert.equal(action.effectId, "miragebound_dancer_bounce_buff");
    assert.equal(strategy.simulateMainPhaseAction(state, action), state);
    assert.deepEqual(state.bot.hand.map(card => card.instanceId), [sister.instanceId]);
    assert.deepEqual(state.bot.field.map(card => card.instanceId), [source.instanceId, scout.instanceId]);
    assert.equal(source.atk, 2200);
    const effect = required(source.effects?.find(effect => effect.id === action.effectId));
    assert.equal(canUseSimulatedEffectUsage(state, effect, source, seat, true), false);
    const after = JSON.stringify(state);
    strategy.simulateMainPhaseAction(state, action);
    assert.equal(JSON.stringify(state), after, "a spent effect cannot return another card or apply a second boost");
  });

  test(`Miragebound special positions retain Priestess defense and Viper pressure/material branches (${seat})`, () => {
    const threat = card(1, 41201); threat.atk = 3000;
    const { state, strategy } = fixture(seat, [], [threat]);
    const viper = card(356, 41202), priestess = card(357, 41203);
    let analysis = strategy.analyzeGameState(state);
    assert.equal(strategy.chooseSpecialSummonPosition(viper, { game: state, player: state.bot, analysis }), "defense");
    assert.equal(strategy.chooseSpecialSummonPosition(priestess, { game: state, player: state.bot, analysis }), "defense");
    placeSimulationCards(state.bot.field, viper, card(352, 41204));
    state.bot.extraDeck.push(card(363, 41205));
    analysis = strategy.analyzeGameState(state);
    assert.equal(analysis.hasLeviathanMaterials, true);
    assert.equal(strategy.chooseSpecialSummonPosition(viper, { game: state, player: state.bot, analysis }), "attack");
  });

  for (const activations of [0, 1, 2]) {
    test(`Miragebound Scout ${activations} activations retain ignition priority and Ascension material (${seat})`, () => {
      const scout = card(351, 41301), sovereign = card(355, 41302);
      const { state, strategy } = fixture(seat, [scout], [card(1, 41303)]);
      state.bot.extraDeck.push(sovereign);
      const game: MirageboundGame = { ...state, materialDuelStats: scoutStats(seat, activations) };
      const analysis = strategy.analyzeGameState(game);
      assert.equal(analysis.scoutEffectActivations, activations);
      assert.equal(analysis.preserveScout, activations >= 1);
      const ignition = required(strategy.getMonsterEffectActions(game, state.bot, analysis).find(action => action.cardId === scout.id));
      assert.equal(ignition.priority, activations < 2 ? 8.5 : 7.5);
      const ascensions = strategy.getExtraDeckActions(game, state.bot, analysis).filter(action => action.type === "ascension");
      assert.equal(ascensions.length, activations >= 2 ? 1 : 0);
      if (activations >= 2) {
        const action = required(ascensions[0]);
        assert.equal(action.materialId, scout.id);
        assert.equal(action.materialName, scout.name);
        assert.equal(action.cardId, sovereign.id);
        assert.equal(action.position, "attack");
      }
    });
  }

  test(`Miragebound Leviathan retains ordered materials, stable physical ties and full-field release (${seat})`, () => {
    const scout = card(351, 41401), viper = card(356, 41402);
    const firstDancer = card(352, 41403), secondDancer = card(352, 41404), priestess = card(357, 41405);
    const { state, strategy } = fixture(seat, [scout, viper, firstDancer, secondDancer, priestess], [card(1, 41406), card(1, 41407)]);
    const leviathan = card(363, 41408); state.bot.extraDeck.push(leviathan);
    const game: MirageboundGame = { ...state, materialDuelStats: scoutStats(seat, 1) };
    const before = JSON.stringify(state);
    const action = required(strategy.getExtraDeckActions(game, state.bot, strategy.analyzeGameState(game)).find(action => action.type === "extraDeckProcedure"));
    assert.equal(action.extraDeckCard, leviathan);
    assert.deepEqual(action.materialIndices, [1, 2]);
    assert.deepEqual(action.materialIds, [356, 352]);
    assert.deepEqual(action.materialInstanceIds, [[41402], [41403]]);
    assert.deepEqual(action.materialNames, [viper.name, firstDancer.name]);
    assert.equal(action.requiredMaterialCount, 2);
    assert.equal(action.priority, 15);
    assert.equal(action.position, "attack");
    assert.equal(JSON.stringify(state), before);
    assert.equal(strategy.simulateMainPhaseAction(state, action), state);
    assert.deepEqual(state.bot.field.map(card => card.instanceId), [41401, 41404, 41405, 41408]);
    assert.equal(state.bot.field[0], scout);
    assert.equal(state.bot.field[1], secondDancer);
    assert.equal(state.bot.field[2], priestess);
    assert.equal(required(state.bot.field[3]).lastSummonMethod, "fusion");
    assert.equal(state.bot.graveyard.includes(viper), true);
    assert.equal(state.bot.graveyard.includes(firstDancer), true);
  });

  test(`Miragebound automatic Sovereign position keeps its independent low-LP defensive rule (${seat})`, () => {
    const threat = card(1, 41501); threat.position = "defense"; threat.atk = 100; threat.def = 4000;
    const { state, strategy } = fixture(seat, [card(351, 41502)], [threat]);
    const sovereign = card(355, 41503), material = required(state.bot.field[0]);
    state.bot.lp = 2000;
    const selected = required(strategy.selectAutomaticAscension({ choices: [{ ascensionCard: sovereign, material }], game: state, bot: state.bot, opponent: state.player }));
    assert.equal(selected.material, material);
    assert.equal(selected.ascensionCard, sovereign);
    assert.equal(selected.position, "defense");
    assert.equal(strategy.chooseSpecialSummonPosition(sovereign, { game: state, player: state.bot }), "attack");
    state.bot.lp = 2001;
    assert.equal(strategy.chooseAutomaticAscensionPosition({ ascensionCard: sovereign, game: state, bot: state.bot, opponent: state.player }), "attack");
    assert.equal(strategy.shouldUseAutomaticAscensionShortcut(), false);
  });

  test(`Miragebound Chain chooses lethal Horizon and does not commit a second defensive response (${seat})`, async () => {
    const dancer = card(352, 41601), viper = card(356, 41602), attacker = card(1, 41603);
    attacker.atk = 5000;
    const { state, strategy } = fixture(seat, [dancer, viper], [attacker]); state.bot.lp = 1000;
    const horizon = card(360, 41604), vanishing = card(361, 41605);
    const args = { game: state, player: state.bot, activatable: [{ card: vanishing, zone: "hand" }, { card: horizon, zone: "spellTrap" }],
      context: { type: "attack_declaration", attacker, target: dancer, attackerOwner: state.player, targetOwner: state.bot } };
    type Args = NonNullable<Parameters<MirageboundStrategy["chooseChainResponse"]>[0]>;
    const response = required(await strategy.chooseChainResponse(unsafeFixture<Args>(args,
      "Decision-only Chain fixture supplies already-discovered simulated options; no runtime Chain method is invoked.")));
    assert.equal(response.card, horizon);
    assert.equal(response.reason, "False Horizon prevents lethal attack pressure");
    assert.equal(readPath(response, ["priority"]), 156);
    assert.equal(readPath(response.activationContext, ["actionContext", "targetPreferences", "miragebound_false_horizon_return_target", "preferredInstanceIds", "0"]), dancer.instanceId);
    const committed = await strategy.chooseChainResponse(unsafeFixture<Args>({ ...args,
      chainSystem: { getChainSummary: () => [{ controllerId: seat, cardName: horizon.name }] } },
      "Partial Chain summary port only; decision fixture does not resolve or activate a Chain."));
    assert.deepEqual(committed, { pass: true, reason: "Miragebound defense already committed to this chain" });
  });

  test(`Miragebound Chain protects the targeted physical Dancer and preserves a progressed Scout (${seat})`, async () => {
    const first = card(352, 41701), target = card(352, 41702), scout = card(351, 41703), attacker = card(1, 41704);
    const { state, strategy } = fixture(seat, [first, target, scout], [attacker]);
    const game: MirageboundGame = { ...state, materialDuelStats: scoutStats(seat, 1) };
    const vanishing = card(361, 41705);
    const args = { game, player: state.bot, activatable: [{ card: vanishing, zone: "hand" }],
      context: { type: "effect_targeted", player: state.player, target, targetOwner: state.bot } };
    type Args = NonNullable<Parameters<MirageboundStrategy["chooseChainResponse"]>[0]>;
    const response = required(await strategy.chooseChainResponse(unsafeFixture<Args>(args,
      "Decision-only Chain fixture uses canonical simulated identity and already-discovered options.")));
    assert.equal(response.card, vanishing);
    assert.equal(response.reason, "Vanishing Step protects targeted Miragebound");
    const selectedId = readPath(response.activationContext, ["actionContext", "targetPreferences", "miragebound_vanishing_step_return_target", "preferredInstanceIds", "0"]);
    assert.equal(selectedId, target.instanceId);
    assert.notEqual(selectedId, first.instanceId);
    const preserved = await strategy.chooseChainResponse(unsafeFixture<Args>({ ...args, context: { ...args.context, target: scout } },
      "Decision-only Chain fixture switches only the physical targeted monster."));
    assert.deepEqual(preserved, { pass: true, reason: "no valuable Miragebound response" });
  });

  test(`Miragebound wrapper dispatch retains search order, physical hand indices and emitted Normal actions (${seat})`, () => {
    const { state } = fixture(seat);
    const first = card(351, 41801), second = card(351, 41802);
    state.bot.hand.push(first, card(354, 41803), second);
    const strategy = new ObservedMiragebound(state.bot);
    strategy.thoughtProcess.push("previous");
    strategy.generateMainPhaseActions(state);
    assert.deepEqual(strategy.emitted.filter(action => action.type === "summon").map(action => [action.index, action.priority, action.position]),
      [[0, 12, "attack"], [2, 12, "attack"]]);
    assert.equal(strategy.calls[0], "analysis");
    assert.deepEqual(strategy.calls.slice(-2), ["sequence", "p2"]);
    assert.equal(strategy.currentAnalysis?.hand, state.bot.hand);
    assert.deepEqual(strategy.thoughtProcess, []);
    const oasis = card(354, 41804), mirror = card(359, 41805), horizon = card(360, 41806);
    const candidates = [mirror, horizon, oasis];
    assert.deepEqual(strategy.rankSearchCandidates(candidates, {}, { source: first, game: state }), [oasis, mirror, horizon]);
    assert.equal(strategy.calls.slice(-1)[0], "rank");
    assert.deepEqual(candidates, [mirror, horizon, oasis]);
    assert.deepEqual(strategy.rankByNameOrder([second, first], [first.name!, first.name!]), [second, first]);
  });
}
