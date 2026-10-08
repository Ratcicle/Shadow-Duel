import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import BaseStrategy from "../../src/core/ai/BaseStrategy.js";
import TechZeroStrategy from "../../src/core/ai/TechZeroStrategy.js";
import { buildTechZeroActivationContext } from "../../src/core/ai/techzero/priorities.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { evaluateSimulatedConditions } from "../../src/core/ai/common/simulatedConditions.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { applyGenericSimulatedMainPhaseAction, applySimulatedEffectResolution, simulateGenericSpellEffect } from "../../src/core/ai/common/simulation.js";
import type { SimulatedActionOptions, SimulatedRuntimeState } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(actor: "player" | "bot") {
  const player = (id: "player" | "bot") => ({ id, lp: 8000, hand: [], deck: [], field: [], graveyard: [],
    banished: [], extraDeck: [], spellTrap: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 });
  const state = unsafeFixture<SimulatedRuntimeState>({ bot: player(actor), player: player(actor === "bot" ? "player" : "bot"),
    turn: actor, phase: "main1", turnCounter: 4, _isPerspectiveState: true }, "Both physical seats projected into planning slots");
  const copy = createPlanningCopy();
  const make = (id: number) => copy.cloneCardForSim(new Card(cardDefinition(id), actor));
  return { state, make };
}

for (const actor of ["player", "bot"] as const) {
  test(`Electrocatapult declines its optional resolution summon when no legal small monster exists (${actor})`, () => {
    const { state, make } = scenario(actor);
    const source = make(502), raptor = make(505);
    state.bot.hand.push(source); state.bot.graveyard.push(raptor);
    const strategy = new TechZeroStrategy(state.bot);
    const effect = required(source.effects?.find(entry => entry.id === "tech_zero_electrocatapult_normal_summon"));
    assert.equal(strategy.shouldActivateEffect({ sourceCard: source, effect, player: state.bot, game: state }), false,
      "an empty resolution-summon plan must retain the previous empty-target refusal");
    strategy.simulateMainPhaseAction(state, { type: "summon", index: 0, cardId: 502, position: "attack" });
    assert.deepEqual(state.bot.field.map(card => card.id), [502]);
    assert.deepEqual(state.bot.graveyard.map(card => card.id), [505]);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const zone of ["hand", "graveyard"] as const) {
    test(`Electrocatapult compiles its ${zone} resolution summon into the exact non-targeted channel (${actor})`, () => {
      const { state, make } = scenario(actor);
      const source = make(502), core = make(501);
      source.fieldSlot = 0; state.bot.field.push(source); state.bot[zone].push(core);
      const effect = required(source.effects?.find(entry => entry.id === "tech_zero_electrocatapult_normal_summon"));
      const activationContext = buildTechZeroActivationContext(source, effect, { player: state.bot, opponent: state.player });
      assert.deepEqual(activationContext.decisions?.specialSummons?.[required(effect.id)], [core.instanceId]);
      assert.equal(activationContext.decisions?.selections?.tech_zero_electrocatapult_summon_target, undefined);
      assert.equal(activationContext.decisions?.selections?.tech_zero_electrocatapult_summon_choice, undefined);
      assert.equal(applySimulatedEffectResolution({ effect, state, selections: {}, options: { sourceCard: source, effect,
        activationContext: { decisions: required(activationContext.decisions) }, shouldActivateEffect: () => false } }), true);
      assert.ok(state.bot.field.includes(core));
      assert.equal(state.bot[zone].includes(core), false);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }

  for (const occupied of [false, true]) {
  test(`Lab placement is generated live and in the planning clone without consuming its ignition (${actor}, occupied ${occupied})`, async t => {
    const first = new Bot("techzero"); first.id = "player";
    const second = new Bot("techzero");
    const game = createRuntimeGame({ opponentOverride: second, laboratoryMode: true, captureReplay: false });
    game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot implements physical Player fixture");
    t.after(() => game.dispose());
    game.turn = actor; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
    const bot = actor === "player" ? first : second;
    const live = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game, "Concrete Game exposes Bot execution and cloning ports");
    first.game = second.game = live;
    const lab = new Card(cardDefinition(518), actor);
    const previous = occupied ? new Card(cardDefinition(518), actor) : null;
    if (previous) {
      previous.effectsNegated = true; previous.effectsNegatedDuration = "while_faceup";
      bot.fieldSpell = previous;
    }
    bot.hand.push(lab);
    const action = required(bot.strategy.generateMainPhaseActions(live).find(entry => entry.type === "spell" && entry.cardId === 518));
    assert.equal(action.effectId, undefined);
    assert.equal(action.activationContext?.decisions, undefined);
    const clone = bot.cloneGameState(live);
    assert.ok(bot.strategy.generateMainPhaseActions(clone).some(entry => entry.type === "spell" && entry.cardId === 518));
    bot.strategy.simulateMainPhaseAction(clone, action);
    assert.equal(await bot.executeMainPhaseAction(live, action), true);
    assert.equal(bot.fieldSpell, lab);
    assert.equal(clone.bot.fieldSpell?.id, 518);
    assert.equal(clone.bot.fieldSpell?.locationVersion, lab.locationVersion);
    assert.deepEqual(clone.cardActivationHistory, game.cardActivationHistory,
      "placement without an activation effect must preserve the runtime card activation history");
    if (previous) {
      assert.ok(bot.graveyard.includes(previous));
      const simulatedPrevious = required(clone.bot.graveyard.find(card => card.instanceId === previous.instanceId));
      assert.equal(simulatedPrevious.effectsNegated, previous.effectsNegated);
      assert.equal(simulatedPrevious.locationVersion, previous.locationVersion);
    }
    assert.equal(bot.strategy.generateMainPhaseActions(live).some(entry => entry.type === "fieldEffect"), false);
  });
  }

  test(`case without local targets retains the declared outer target (${actor})`, () => {
    const { state, make } = scenario(actor);
    const source = make(501), target = make(502);
    source.fieldSlot = 0; target.fieldSlot = 1; state.bot.field.push(source, target);
    const effect: EffectDefinition = { id: "outer_case", timing: "ignition", activationZones: ["field"],
      targets: [{ id: "outer", zone: "field", owner: "self", cardKind: "monster" }], actions: [{ type: "choose_action_case",
        effectChoiceKey: "outer_case", cases: [{ id: "decrease", conditions: [{ type: "targetRefMatchesFilters", targetRef: "outer", filters: { minLevel: 2 } }],
          actions: [{ type: "modify_level", targetRef: "outer", amount: -1 }] }] }] };
    const options: SimulatedActionOptions = { sourceCard: source, effect, activationContext: { decisions: { cases: { outer_case: "decrease" } } } };
    assert.equal(applySimulatedActions({ actions: effect.actions || [], selections: { outer: [target] }, state, options }), true);
    assert.equal(target.level, 2);
    assert.equal(source.level, 1);
  });

  test(`empty stored target does not recover a stale selection for a branch condition (${actor})`, () => {
    const { state, make } = scenario(actor);
    const target = make(502); state.bot.field.push(target);
    const context = unsafeFixture<Parameters<typeof evaluateSimulatedConditions>[1]>({ state, _actionTargets: { outer: [] },
      options: { actionContext: { _actionTargets: { outer: [target] } } } }, "Stored empty target must override older context projection");
    assert.equal(evaluateSimulatedConditions([{ type: "targetRefMatchesFilters", targetRef: "outer", filters: { minLevel: 2 } }], context), false);
  });

  test(`Prism compiles its non-targeted resolution summon into the exact channel (${actor})`, () => {
    const { state, make } = scenario(actor);
    const prism = make(506), core = make(501), raptor = make(505);
    state.bot.graveyard.push(prism); state.bot.hand.push(core, raptor);
    const original = required(prism.effects?.find(effect => effect.id === "tech_zero_prism_activator_synchro_summon"));
    const effect: EffectDefinition = { ...original, targets: [], actions: [{ type: "special_summon_from_zone", zone: "hand",
      filters: { cardKind: "monster", archetype: "Tech-Zero" }, selectionId: "tech_zero_prism_activator_hand_summon_target",
      negateEffects: true, negateEffectsDuration: "until_end_turn" }] };
    const decisions = buildTechZeroActivationContext(prism, effect, { player: state.bot, opponent: state.player }).decisions;
    assert.deepEqual(decisions?.specialSummons?.[required(effect.id)], [core.instanceId]);
    assert.equal(decisions?.selections?.tech_zero_prism_activator_hand_summon_target, undefined);
  });

  test(`Scrapyard compiles revival and after-resolution materials without declaring a target (${actor})`, () => {
    const { state, make } = scenario(actor);
    const scrapyard = make(520), core = make(501), prism = make(506), machine = make(503);
    prism.fieldSlot = 0; state.bot.field.push(prism); state.bot.graveyard.push(core); state.bot.extraDeck.push(machine);
    const original = required(scrapyard.effects?.[0]);
    const effect: EffectDefinition = { ...original, targets: [], actions: [{ type: "special_summon_from_zone", zone: "graveyard",
      filters: { cardKind: "monster", archetype: "Tech-Zero", isTuner: true }, selectionId: "tech_zero_scrapyard_tuner" }] };
    const decisions = buildTechZeroActivationContext(scrapyard, effect, { player: state.bot, opponent: state.player }).decisions;
    assert.deepEqual(decisions?.specialSummons?.[required(effect.id)], [core.instanceId]);
    assert.deepEqual(decisions?.synchroSummons?.[required(effect.id)]?.materialInstanceIds, [core.instanceId, prism.instanceId]);
    assert.equal(decisions?.selections?.tech_zero_scrapyard_tuner, undefined);
  });

  test(`generic spell after-resolution phase reads the primary result reference (${actor})`, () => {
    const { state, make } = scenario(actor);
    const spell = make(518), target = make(501);
    state.bot.graveyard.push(target);
    const effect: EffectDefinition = { id: "after_spell", timing: "on_play", targets: [{ id: "chosen", owner: "self", zone: "graveyard" }],
      actions: [{ type: "move", targetRef: "chosen", to: "hand", storeResultAs: "returned" }],
      afterResolutionActions: [{ type: "conditional_actions", conditions: [{ type: "context_number_compare",
        key: "_actionTargets.returned.length", op: "gt", value: 0 }],
        actions: [{ type: "add_status", targetRef: "returned", status: "piercing" }] }] };
    spell.effects = [effect];
    simulateGenericSpellEffect(state, spell, { activationContext: { decisions: { selections: { chosen: [required(target.instanceId)] } } } });
    assert.ok(state.bot.hand.includes(target));
    assert.equal(target.piercing, true);
  });

  test(`field replacement simulation publishes movement and clears departing statuses (${actor})`, () => {
    const { state, make } = scenario(actor);
    const previous = make(518), incoming = make(518);
    state.bot.fieldSpell = previous; state.bot.hand.push(incoming);
    previous.effectsNegated = true; previous.effectsNegatedDuration = "while_faceup";
    const events: string[] = [];
    const strategy = new BaseStrategy(state.bot);
    const options: SimulatedActionOptions = { emitSimulatedEvent: (event, payload) => events.push(`${event}:${Reflect.get(payload, "toZone")}`) };
    assert.equal(strategy.placeSpellCard(state, incoming, options).placed, true);
    assert.equal(state.bot.fieldSpell, incoming);
    assert.equal(previous.effectsNegated, false);
    assert.equal(previous.locationVersion, 1);
    assert.equal(incoming.locationVersion, 1);
    assert.deepEqual(state.bot.hand, []);
    assert.deepEqual(events, ["card_to_grave:graveyard", "card_moved:graveyard", "card_moved:fieldSpell"]);
  });

  test(`field replacement uses the redirected destination and its lifecycle (${actor})`, () => {
    const { state, make } = scenario(actor);
    const previous = make(518), incoming = make(518), galaxy = make(273);
    galaxy.owner = state.player.id; galaxy.controller = state.player.id; galaxy.fieldSlot = 0;
    state.player.field.push(galaxy); state.bot.fieldSpell = previous; state.bot.hand.push(incoming);
    const events: string[] = [];
    assert.equal(new BaseStrategy(state.bot).placeSpellCard(state, incoming, {
      emitSimulatedEvent: (event, payload) => events.push(`${event}:${Reflect.get(payload, "toZone")}`),
    }).placed, true);
    assert.ok(state.bot.banished.includes(previous));
    assert.equal(state.bot.graveyard.includes(previous), false);
    assert.deepEqual(events, ["card_moved:banished", "card_moved:fieldSpell"]);
  });

  test(`field replacement revalidates the incoming source after departure events (${actor})`, () => {
    const { state, make } = scenario(actor);
    const previous = make(518), incoming = make(518);
    state.bot.fieldSpell = previous; state.bot.hand.push(incoming);
    assert.equal(new BaseStrategy(state.bot).placeSpellCard(state, incoming, {
      emitSimulatedEvent: event => {
        if (event === "card_to_grave") {
          state.bot.hand.splice(state.bot.hand.indexOf(incoming), 1);
          state.bot.banished.push(incoming); incoming.locationVersion = 1;
        }
      },
    }).placed, false);
    assert.equal(state.bot.fieldSpell, null);
    assert.ok(state.bot.graveyard.includes(previous));
    assert.ok(state.bot.banished.includes(incoming));
  });

  test(`rejected field departure preserves the occupied slot and incoming hand card (${actor})`, () => {
    const { state, make } = scenario(actor);
    const previous = make(518), incoming = make(518), galaxy = make(273), protector = make(501);
    galaxy.owner = state.player.id; galaxy.controller = state.player.id; galaxy.fieldSlot = 0;
    protector.effects = [{ id: "fixture_field_spell_protection", timing: "passive", requireZone: "field", passive: {
      type: "banish_protection", targetScope: { owner: "self", zone: "fieldSpell" },
    } }];
    protector.fieldSlot = 0; state.bot.field.push(protector); state.player.field.push(galaxy);
    state.bot.fieldSpell = previous; state.bot.hand.push(incoming);
    assert.equal(new BaseStrategy(state.bot).placeSpellCard(state, incoming).placed, false);
    assert.equal(state.bot.fieldSpell, previous);
    assert.deepEqual(state.bot.hand, [incoming]);
    assert.equal(previous.locationVersion || 0, 0);
    assert.deepEqual(state.bot.graveyard, []);
  });

  test(`negated primary does not execute the after-resolution phase (${actor})`, () => {
    const { state, make } = scenario(actor);
    const source = make(518); state.bot.fieldSpell = source;
    const effect: EffectDefinition = { id: "negated_after", timing: "on_play", actions: [{ type: "draw", amount: 1 }],
      afterResolutionActions: [{ type: "add_status", status: "piercing" }] };
    assert.equal(applySimulatedEffectResolution({ effect, effectActionsAllowed: false, state,
      selections: {}, options: { sourceCard: source, effect } }), true);
    assert.equal(source.piercing, false);
  });

  test(`Scrapyard completes its declared exact plan only after a successful revival (${actor})`, () => {
    const { state, make } = scenario(actor);
    const source = make(520), core = make(501), prism = make(506), machine = make(503);
    prism.fieldSlot = 0; state.bot.field.push(prism); state.bot.graveyard.push(core); state.bot.extraDeck.push(machine);
    source.isFacedown = true; source.setTurn = 2; source.turnSetOn = 2; source.fieldSlot = 0; state.bot.spellTrap.push(source);
    const effect = required(source.effects?.[0]);
    const activationContext = buildTechZeroActivationContext(source, effect, { player: state.bot, opponent: state.player });
    applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", cardId: 520, zoneIndex: 0,
      effectId: required(effect.id), activationContext }, { shouldActivateEffect: () => false });
    assert.ok(state.bot.field.includes(machine), JSON.stringify({ field: state.bot.field.map(card => card.id),
      graveyard: state.bot.graveyard.map(card => card.id), unsupported: state._simUnsupportedActions, decisions: activationContext.decisions }));
    assert.ok(state.bot.graveyard.includes(core));
    assert.ok(state.bot.graveyard.includes(prism));
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`failed primary stops the after-resolution phase (${actor})`, () => {
    const { state, make } = scenario(actor);
    const source = make(518); state.bot.fieldSpell = source;
    const effect: EffectDefinition = { id: "failed_after", timing: "on_play",
      actions: [{ type: "move", targetRef: "missing", to: "hand", requireAll: true }],
      afterResolutionActions: [{ type: "add_status", status: "piercing" }] };
    assert.equal(applySimulatedEffectResolution({ effect, state, selections: { missing: [] }, options: { sourceCard: source, effect } }), false);
    assert.equal(source.piercing, false);
  });
}
