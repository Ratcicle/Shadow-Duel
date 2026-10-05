import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import AutoSelector from "../../src/core/AutoSelector.js";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { handleChooseActionCase } from "../../src/core/actionHandlers/choice.js";
import { handleAddFromZoneToHand } from "../../src/core/actionHandlers/resources.js";
import { handleSpecialSummonFromZone } from "../../src/core/actionHandlers/summon/fromZone.js";
import { handleSynchroSummonFromExtraDeck, hasSynchroSummonPreviewCandidate } from "../../src/core/actionHandlers/summon/synchroEffects.js";
import type { ActionHandlerEnginePort, EffectContext } from "../../src/core/contracts/actionRuntime.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, seat: "player" | "bot" = "bot") {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose("tech_zero_decisions"));
  game.turn = "bot";
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  game.bot.strategy = null;
  game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
  const player = game[seat];
  const make = (id: number) => new Card(cardDefinition(id), player.id);
  const engine = unsafeFixture<ActionHandlerEnginePort>(game.effectEngine, "Concrete engine satisfies action handler runtime projections");
  return { game, player, make, engine };
}

test("exact selections preserve instance identity, order and optional quantity", () => {
  const selector = new AutoSelector({});
  const first = new Card(cardDefinition(501), "bot"), second = new Card(cardDefinition(501), "bot");
  const contract = { requirements: [{ id: "revive", min: 0, max: 2, candidates: [
    { key: "first", cardRef: first }, { key: "second", cardRef: second },
  ] }] };
  const result = selector.select(contract, { activationContext: { decisions: { selections: { revive: [second.instanceId, first.instanceId] } } } });
  assert.deepEqual(result, { ok: true, selections: { revive: ["second", "first"] } });
  assert.deepEqual(selector.select(contract, { activationContext: { decisions: { selections: { revive: [] } } } }),
    { ok: true, selections: { revive: [] } });
});

test("exact selections reject stale IDs, duplicate IDs and count violations without same-name fallback", () => {
  const selector = new AutoSelector({});
  const first = new Card(cardDefinition(501), "bot"), replacement = new Card(cardDefinition(501), "bot");
  const contract = { requirements: [{ id: "cost", min: 1, max: 1, candidates: [{ key: "replacement", cardRef: replacement }] }] };
  for (const ids of [[first.instanceId], [replacement.instanceId, replacement.instanceId], []]) {
    assert.equal(selector.select(contract, { activationContext: { decisions: { selections: { cost: ids } } } }).ok, false);
  }
});

test("exact case decisions match stable case ID without using labels", () => {
  const selector = new AutoSelector({});
  const contract = { requirements: [{ id: "action_case_choice", min: 1, max: 1, candidates: [
    { key: "up", cardRef: { id: "increase", name: "Translated up" } },
    { key: "down", cardRef: { id: "decrease", name: "Translated down" } },
  ] }] };
  assert.deepEqual(selector.select(contract, { activationContext: { decisions: { cases: { action_case_choice: "decrease" } } } }),
    { ok: true, selections: { action_case_choice: ["down"] } });
  assert.equal(selector.select(contract, { activationContext: { decisions: { cases: { action_case_choice: "gone" } } } }).ok, false);
});

test("Prism searches the exact planned card and refuses an absent search instance", async t => {
  const { player, make, engine } = scenario(t);
  const prism = make(506), first = make(501), selected = make(501), highAttack = make(505);
  placeFieldCards(player.field, prism);
  player.deck.push(first, highAttack, selected);
  const effect = required(prism.effects.find(entry => entry.id === "tech_zero_prism_activator_monster_search"));
  const action = required((effect.actions || []).find(entry => entry.type === "add_from_zone_to_hand"));
  assert.equal(action.type, "add_from_zone_to_hand");
  if (action.type !== "add_from_zone_to_hand") return;
  const context: EffectContext = { source: prism, player, effect, activationContext: { decisions: {
    selections: { tech_zero_prism_activator_monster_search_selection: [selected.instanceId] },
  } } };
  assert.equal(await handleAddFromZoneToHand(action, context, {}, engine), true);
  assert.deepEqual(player.hand, [selected]);
  assert.equal(await handleAddFromZoneToHand(action, context, {}, engine), false);
  assert.deepEqual(player.deck, [first, highAttack]);
});

test("action preview rejects a stale search or case before any activation cost", t => {
  const { game, player, make } = scenario(t);
  const prism = make(506), core = make(501), missing = make(501);
  placeFieldCards(player.field, prism, core);
  player.deck.push(make(505));
  const effect = required(prism.effects.find(entry => entry.id === "tech_zero_prism_activator_monster_search"));
  const search = required(effect.actions?.find(entry => entry.type === "add_from_zone_to_hand"));
  assert.equal(game.effectEngine.checkActionPreviewRequirements([search], { player, source: prism, effect, activationContext: { decisions: {
    selections: { tech_zero_prism_activator_monster_search_selection: [missing.instanceId] },
  } } }).ok, false);
  const coreEffect = required(core.effects.find(entry => entry.id === "tech_zero_energy_core_level_mod"));
  assert.equal(game.effectEngine.checkActionPreviewRequirements(coreEffect.actions || [], { player, source: core, effect: coreEffect, activationContext: { decisions: {
    cases: { tech_zero_energy_core_level_mod: "missing_case" },
  } } }).ok, false);
});

test("Prism's executable action rejects a stale search before discarding or paying its self-cost", async t => {
  const bot = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: bot, captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose("prism_stale_action"));
  game.turn = "bot"; game.phase = "main1"; game.turnCounter = 2;
  game.player.controllerType = "ai";
  game.disablePresentationDelays = true;
  const prism = new Card(cardDefinition(506), "bot"), core = new Card(cardDefinition(501), "bot");
  const first = new Card(cardDefinition(502), "bot"), second = new Card(cardDefinition(502), "bot");
  bot.hand.push(prism, core); bot.deck.push(first, second);
  const live = unsafeFixture<BotGamePort & AiLiveGamePort>(game, "Concrete Game satisfies bot execution and AI state views");
  const action = required(bot.strategy.generateMainPhaseActions(live).find(candidate => candidate.type === "handIgnition"));
  const searchIds = required(action.activationContext?.decisions?.selections?.tech_zero_prism_activator_monster_search_selection);
  const selected = required(bot.deck.find(card => searchIds.includes(card.instanceId)));
  bot.deck.splice(bot.deck.indexOf(selected), 1);
  assert.equal(await bot.executeMainPhaseAction(live, action), false);
  assert.deepEqual(bot.hand.map(card => card.instanceId), [prism.instanceId, core.instanceId]);
  assert.deepEqual(bot.graveyard, []);
});

test("action preview revalidates every Portal body and exact zero selections remain legal", t => {
  const { game, player, make } = scenario(t);
  const portal = make(509), first = make(501), missing = make(501);
  placeFieldCards(player.field, portal);
  player.graveyard.push(first);
  const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
  for (const [ids, expected] of [[[], true], [[first.instanceId], true], [[missing.instanceId], false]] as const) {
    assert.equal(game.effectEngine.checkActionPreviewRequirements(effect.actions || [], { player, source: portal, effect, activationContext: { decisions: {
      specialSummons: { [effect.id!]: ids },
    } } }).ok, expected);
  }
});

test("Portal preview permits explicit remaining-instance revalidation", t => {
  const { game, player, make } = scenario(t);
  const portal = make(509), first = make(501), missing = make(502);
  placeFieldCards(player.field, portal); player.graveyard.push(first);
  const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
  assert.equal(game.effectEngine.checkActionPreviewRequirements(effect.actions || [], { player, source: portal, effect, activationContext: { decisions: {
    specialSummons: { [required(effect.id)]: [missing.instanceId, first.instanceId] },
    specialSummonRevalidation: { [required(effect.id)]: "remaining" },
  } } }).ok, true);
});

test("Core level decision uses the selected case and exact Electrocatapult in the real engine", async t => {
  const { player, make, engine } = scenario(t);
  const core = make(501), first = make(502), second = make(502);
  placeFieldCards(player.field, core, first, second);
  const effect = required(core.effects.find(entry => entry.id === "tech_zero_energy_core_level_mod"));
  const action = required((effect.actions || []).find(entry => entry.type === "choose_action_case"));
  assert.equal(action.type, "choose_action_case");
  if (action.type !== "choose_action_case") return;
  const context: EffectContext = { source: core, player, effect, _actionTargets: { tech_zero_energy_core_level_target: [second] }, activationContext: {
    decisions: { cases: { tech_zero_energy_core_level_mod: "decrease" }, selections: { tech_zero_energy_core_level_target: [second.instanceId] } },
  } };
  const result = await handleChooseActionCase(action, context, { tech_zero_energy_core_level_target: [second] }, engine);
  assert.ok(typeof result === "object" && result !== null && "success" in result && result.success);
  assert.equal(first.level, 3);
  assert.equal(second.level, 2);
});

test("planned targets are revalidated during preview and a human session still asks for selection", t => {
  const { game, player, make } = scenario(t);
  const core = make(501), catapult = make(502), replacement = make(502);
  placeFieldCards(player.field, core, catapult, replacement);
  const targets = [{ id: "selected", owner: "self", zone: "field", cardKind: "monster", count: { min: 1, max: 1 } }] as const;
  const activationContext = { preview: true, decisions: { selections: { selected: [catapult.instanceId] } } };
  const context = { player, source: core, activationContext };
  const preview = game.effectEngine.resolveTargets(targets, context, null);
  assert.ok(preview.ok && "targets" in preview);
  assert.deepEqual(preview.targets.selected, [catapult]);
  player.field.splice(player.field.indexOf(catapult), 1);
  assert.equal(game.effectEngine.resolveTargets(targets, context, null).ok, false);
  player.controllerType = "human";
  const human = game.effectEngine.resolveTargets(targets, context, null);
  assert.ok("needsSelection" in human && human.needsSelection);
});

test("an AI can decline optional triggers before consuming their once-per-turn use", t => {
  const { game, player, make } = scenario(t);
  const portal = make(509);
  placeFieldCards(player.field, portal);
  player.graveyard.push(make(501));
  const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
  let calls = 0;
  player.strategy = unsafeFixture<NonNullable<typeof player.strategy>>({
    shouldActivateEffect: () => { calls += 1; return false; },
  }, "Optional trigger policy fixture exercises the trigger collector boundary");
  const options = unsafeFixture<Parameters<typeof game.effectEngine.buildTriggerEntry>[0]>({ sourceCard: portal, owner: player, effect, activationZone: "field" }, "Concrete Player and effect satisfy trigger collector projections");
  assert.equal(game.effectEngine.buildTriggerEntry(options), null);
  assert.equal(calls, 1);
  assert.equal(game.canUseOncePerTurn(portal, player, effect).ok, true);
  player.controllerType = "human";
  assert.notEqual(game.effectEngine.buildTriggerEntry(options), null);
  assert.equal(calls, 1);
});

test("Portal resolves an exact ordered group and refuses a stale optional group", async t => {
  const { player, make, engine } = scenario(t);
  const portal = make(509), core = make(501), multimodal = make(503), catapult = make(502);
  placeFieldCards(player.field, portal);
  player.graveyard.push(core, catapult, multimodal);
  const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
  const action = required((effect.actions || []).find(entry => entry.type === "special_summon_from_zone"));
  assert.equal(action.type, "special_summon_from_zone");
  if (action.type !== "special_summon_from_zone") return;
  const ctx: EffectContext = { player, source: portal, effect, activationContext: { decisions: {
    specialSummons: { [effect.id!]: [multimodal.instanceId, core.instanceId] },
  } } };
  assert.equal(await handleSpecialSummonFromZone(action, ctx, {}, engine), true);
  assert.deepEqual(player.field, [portal, multimodal, core]);
  assert.deepEqual(player.graveyard, [catapult]);
  const stale: EffectContext = { ...ctx, activationContext: { decisions: { specialSummons: { [effect.id!]: [core.instanceId] } } } };
  assert.equal(await handleSpecialSummonFromZone(action, stale, {}, engine), false);
  assert.deepEqual(player.graveyard, [catapult]);
  player.graveyard.length = 0;
  assert.equal(await handleSpecialSummonFromZone(action, stale, {}, engine), false);
});

for (const seat of ["player", "bot"] as const) {
  for (const change of ["banished", "capacity", "empty", "full"] as const) {
    test(`Portal revalidates only its remaining planned instances after ${change} (${seat})`, async t => {
      const { player, make, engine } = scenario(t, seat);
      const portal = make(509), selected = make(501), replacement = make(501), catapult = make(502);
      placeFieldCards(player.field, portal);
      player.graveyard.push(replacement, catapult);
      if (change !== "banished" && change !== "empty") player.graveyard.push(selected);
      if (change === "capacity" || change === "full")
        placeFieldCards(player.field, make(504), make(505), make(507));
      if (change === "full") placeFieldCards(player.field, make(508));
      if (change === "empty") player.graveyard.splice(player.graveyard.indexOf(catapult), 1);
      const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
      const context: EffectContext = { player, source: portal, effect, activationContext: { decisions: {
        specialSummons: { [required(effect.id)]: [catapult.instanceId, selected.instanceId] },
        specialSummonRevalidation: { [required(effect.id)]: "remaining" },
      } } };
      const result = await engine.applyActions(effect.actions || [], context, {});
      assert.ok(result && typeof result === "object" && "success" in result && result.success);
      assert.equal(player.field.includes(replacement), false, "an unplanned namesake must never replace a missing instance");
      assert.equal(player.field.includes(catapult), change !== "empty" && change !== "full");
      assert.equal(player.field.includes(selected), false);
      assert.equal(player.specialSummonRestrictions.length, 1);
    });
  }
}

test("remaining-instance revalidation still rejects duplicates and a missing required minimum", async t => {
  const { player, make, engine } = scenario(t);
  const source = make(509), core = make(501);
  placeFieldCards(player.field, source); player.graveyard.push(core);
  for (const ids of [[core.instanceId, core.instanceId], ["absent"]]) {
    const context: EffectContext = { player, source, activationContext: { decisions: {
      specialSummons: { special_summon_from_zone: ids },
      specialSummonRevalidation: { special_summon_from_zone: "remaining" },
    } } };
    assert.equal(await handleSpecialSummonFromZone({ type: "special_summon_from_zone", zone: "graveyard", count: 1 }, context, {}, engine), false);
    assert.deepEqual(player.field, [source]);
  }
});

test("optional remaining-instance revalidation succeeds after its source zone becomes empty", async t => {
  const { player, make, engine } = scenario(t);
  const source = make(509), missing = make(501);
  placeFieldCards(player.field, source);
  assert.equal(await handleSpecialSummonFromZone({ type: "special_summon_from_zone", zone: "graveyard", count: { min: 0, max: 3 } },
    { player, source, activationContext: { decisions: {
      specialSummons: { special_summon_from_zone: [missing.instanceId] },
      specialSummonRevalidation: { special_summon_from_zone: "remaining" },
    } } }, {}, engine), true);
});

test("Portal can choose the second instance of a name while enforcing distinct selected names", async t => {
  const { player, make, engine } = scenario(t);
  const portal = make(509), first = make(501), second = make(501), catapult = make(502);
  placeFieldCards(player.field, portal);
  player.graveyard.push(first, second, catapult);
  const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
  const action = required(effect.actions?.find(entry => entry.type === "special_summon_from_zone"));
  assert.equal(action.type, "special_summon_from_zone");
  if (action.type !== "special_summon_from_zone") return;
  const ctx: EffectContext = { player, source: portal, effect, activationContext: { decisions: {
    specialSummons: { [effect.id!]: [second.instanceId, catapult.instanceId] },
  } } };
  assert.equal(await handleSpecialSummonFromZone(action, { ...ctx, activationContext: { decisions: {
    specialSummons: { [effect.id!]: [first.instanceId, second.instanceId] },
  } } }, {}, engine), false);
  assert.equal(await handleSpecialSummonFromZone(action, ctx, {}, engine), true);
  assert.ok(player.field.includes(second));
  assert.deepEqual(player.graveyard, [first]);
});

test("Portal's exact zero-card resolution still applies its restriction when the field fills", async t => {
  const { game, player, make, engine } = scenario(t);
  const portal = make(509), core = make(501);
  placeFieldCards(player.field, portal, make(502), make(502), make(504), make(504));
  player.graveyard.push(core);
  const effect = required(portal.effects.find(entry => entry.id === "tech_zero_summoning_portal_synchro_revive"));
  const ctx: EffectContext = { player, source: portal, effect, activationContext: { decisions: {
    specialSummons: { [effect.id!]: [] },
  } } };
  assert.equal(game.effectEngine.checkActionPreviewRequirements(effect.actions || [], {
    ...ctx, activationContext: { decisions: required(ctx.activationContext?.decisions) },
  }).ok, true);
  const summonAction = required(effect.actions?.find(action => action.type === "special_summon_from_zone"));
  if (summonAction.type !== "special_summon_from_zone") return assert.fail("Expected Portal revival action");
  assert.equal(await handleSpecialSummonFromZone(summonAction, ctx, {}, engine), true);
  const result = await engine.applyActions(effect.actions || [], ctx, {});
  assert.ok(result !== null && typeof result === "object" && "success" in result && result.success);
  assert.equal(player.field.length, 5);
  assert.deepEqual(player.graveyard, [core]);
  assert.equal(player.specialSummonRestrictions.length, 1);
});

test("effect Synchro preview and execution preserve the exact destination and material copy", async t => {
  const { player, make, engine } = scenario(t);
  const core = make(501), first = make(502), second = make(502), multimodal = make(503), portal = make(509);
  first.level = 2; second.level = 2;
  placeFieldCards(player.field, core, first, second);
  player.extraDeck.push(portal, multimodal);
  const action = { type: "synchro_summon_from_extra_deck", position: "defense" } as const;
  const ctx: EffectContext = { player, source: core, activationContext: { decisions: { synchroSummons: {
    synchro_summon_from_extra_deck: { synchroInstanceId: multimodal.instanceId, materialInstanceIds: [core.instanceId, second.instanceId], position: "defense" },
  } } } };
  assert.equal(hasSynchroSummonPreviewCandidate(engine, action, ctx), true);
  assert.equal(await handleSynchroSummonFromExtraDeck(action, ctx, {}, engine), true);
  assert.ok(player.field.includes(first));
  assert.ok(player.field.includes(multimodal));
  assert.equal(multimodal.position, "defense");
  assert.equal(hasSynchroSummonPreviewCandidate(engine, action, ctx), false);
});
