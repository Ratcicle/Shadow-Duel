import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import {
  buildTechZeroActivationContext,
  chooseTechZeroLevelAdjustment,
  chooseTechZeroPortalTargets,
  chooseTechZeroPrismDiscard,
  chooseTechZeroResourceTargets,
  chooseTechZeroRevival,
  getTechZeroReservedResources,
  scoreTechZeroSummon,
  shouldUseTechZeroAssembly,
  techZeroConnectorNormalAvailable,
  type TechZeroPolicyContext,
} from "../../src/core/ai/techzero/priorities.js";
import { getTechZeroRole } from "../../src/core/ai/techzero/knowledge.js";
import { cardDefinition, required } from "../helpers/fixtures.js";

const card = (id: number) => new Card(cardDefinition(id), "bot");
const context = (changes: Partial<TechZeroPolicyContext> = {}): TechZeroPolicyContext => ({
  player: { id: "bot", field: [], hand: [], graveyard: [], extraDeck: [], spellTrap: [] },
  ...changes,
});

test("Core selects the exact level-three Catapult that opens Multimodal", () => {
  const core = card(501), catapult = card(502), wrongCopy = card(502), multimodal = card(503);
  wrongCopy.level = 4;
  const ctx = context({ player: { field: [core, wrongCopy, catapult], extraDeck: [multimodal] } });
  assert.deepEqual(chooseTechZeroLevelAdjustment(core, [wrongCopy, core, catapult], ctx), {
    caseId: "decrease", targetInstanceId: catapult.instanceId,
    targetRef: "tech_zero_energy_core_level_target",
  });
  assert.equal(catapult.level, 3, "analysis does not apply the adjustment");
});

test("Multimodal reduces itself to one for Core plus Multimodal into Portal", () => {
  const core = card(501), multimodal = card(503), portal = card(509);
  core.effectsNegated = true;
  const ctx = context({ player: { field: [multimodal, core], extraDeck: [portal] } });
  assert.deepEqual(chooseTechZeroLevelAdjustment(multimodal, [core, multimodal], ctx), {
    caseId: "decrease_2", targetInstanceId: multimodal.instanceId,
    targetRef: "tech_zero_multimodal_machine_level_target",
  });
  multimodal.effectsNegated = true;
  assert.equal(chooseTechZeroLevelAdjustment(multimodal, [core, multimodal], ctx), null);
});

test("level policy refuses a stale target and a change that opens no Synchro", () => {
  const core = card(501), catapult = card(502);
  const ctx = context({ player: { field: [core], extraDeck: [card(503)] } });
  assert.equal(chooseTechZeroLevelAdjustment(core, [catapult], ctx), null);
  assert.equal(chooseTechZeroLevelAdjustment(core, [core], context({ player: { field: [core] } })), null);
});

test("level policy opens different exact materials for an already available Lancer", () => {
  const machine = card(503), phoenix = card(514), reactor = card(515), lancer = card(516);
  const ctx = context({ player: { field: [machine, phoenix, reactor], extraDeck: [lancer] } });
  assert.deepEqual(chooseTechZeroLevelAdjustment(machine, [machine], ctx), {
    caseId: "decrease_1", targetInstanceId: machine.instanceId,
    targetRef: "tech_zero_multimodal_machine_level_target",
  });
  assert.deepEqual(chooseTechZeroLevelAdjustment(machine, [reactor], ctx), {
    caseId: "decrease_1", targetInstanceId: reactor.instanceId,
    targetRef: "tech_zero_multimodal_machine_level_target",
  });
  assert.equal(machine.level, 3);
  assert.equal(reactor.level, 8);
});

test("Portal restores M, E and Core once each regardless of graveyard order", () => {
  const core = card(501), spareCore = card(501), catapult = card(502), multimodal = card(503), prism = card(506);
  const candidates = [prism, spareCore, catapult, core, multimodal];
  const ctx = context({ player: { field: [card(509)], graveyard: candidates } });
  const result = chooseTechZeroPortalTargets(candidates, ctx);
  assert.deepEqual(result.map(entry => entry.id), [503, 502, 501]);
  assert.deepEqual(chooseTechZeroPortalTargets([...candidates].reverse(), ctx), result);
  assert.equal(new Set(result.map(entry => entry.name)).size, 3);
});

test("Portal honors available zones and caller's smaller count", () => {
  const candidates = [card(501), card(502), card(503)];
  const ctx = context({ player: { field: [card(509), card(504), card(505), card(510)] } });
  assert.deepEqual(chooseTechZeroPortalTargets(candidates, ctx).map(entry => entry.id), [503]);
  assert.deepEqual(chooseTechZeroPortalTargets(candidates, context(), 0), []);
  assert.deepEqual(chooseTechZeroPortalTargets(candidates, context(), 2).map(entry => entry.id), [503, 502]);
});

test("revivals and optional recycles preserve pending instances even in an emergency", () => {
  const machine = card(503), core = card(501), wyvern = card(504), court = card(17);
  const ctx = context({ player: { field: [], graveyard: [machine, core, wyvern] },
    reservedInstanceIds: [machine.instanceId, core.instanceId], threatenedLethal: true });
  assert.equal(chooseTechZeroRevival(court, [machine, core, wyvern], ctx), wyvern);
  assert.deepEqual(chooseTechZeroPortalTargets([machine, core, wyvern], ctx), [wyvern]);
  assert.deepEqual(chooseTechZeroResourceTargets("assembly", [machine, core, wyvern], ctx, 2), [wyvern]);
});

test("Scrapyard cannot choose a destination already committed to another pending effect", () => {
  const tuner = card(503), portal = card(509), mage = card(512), scrapyard = card(520);
  const ctx = context({ player: { field: [portal], graveyard: [tuner], extraDeck: [mage] }, reservedInstanceIds: [mage.instanceId] });
  const effect = required(scrapyard.effects[0]);
  assert.deepEqual(buildTechZeroActivationContext(scrapyard, effect, ctx).decisions?.synchroSummons, {});
});

test("Catapult revives negated Multimodal as the Synchro tuner for a boss", () => {
  const catapult = card(502), core = card(501), multimodal = card(503);
  multimodal.effectsNegated = true;
  const ctx = context({ player: { field: [card(509), card(514)], graveyard: [core, multimodal], extraDeck: [card(517)] } });
  assert.equal(chooseTechZeroRevival(catapult, [core, multimodal], ctx), multimodal);
  assert.equal(getTechZeroRole(multimodal), "synchro_tuner");
});

test("Catapult keeps Core as the first recovery while an active M can make Portal", () => {
  const catapult = card(502), core = card(501), raptor = card(505);
  const ctx = context({ player: { field: [card(503)], graveyard: [raptor, core], extraDeck: [card(509)] } });
  assert.equal(chooseTechZeroRevival(catapult, [raptor, core], ctx), core);
});

test("Kaiser and Ghost preserve a tuner that Scrapyard can convert into Lancer", () => {
  const multimodal = card(503), spare = card(504), phoenix = card(514);
  const ctx = context({ player: { field: [phoenix], graveyard: [multimodal, spare], extraDeck: [card(516)], spellTrap: [card(520)] } });
  assert.equal(getTechZeroReservedResources(ctx).has(multimodal.instanceId), true);
  assert.deepEqual(chooseTechZeroResourceTargets("kaiser", [multimodal, spare], ctx, 3), [spare]);
  assert.deepEqual(chooseTechZeroResourceTargets("ghost", [multimodal], ctx, 1), []);
});

test("resource protection follows exact instances and includes caller's reserved cards", () => {
  const first = card(501), second = card(501);
  const ctx = context({ player: { graveyard: [first, second] }, reservedInstanceIds: [first.instanceId] });
  assert.deepEqual(chooseTechZeroResourceTargets("kaiser", [first, second], ctx, 3), [second]);
});

test("Kaiser and Ghost preserve graveyard tuners for a reachable Lancer's attacks", () => {
  const core = card(501), multimodal = card(503), spare = card(504);
  const ctx = context({ player: {
    field: [card(503), card(509), card(512)], graveyard: [core, multimodal, spare], extraDeck: [card(516)],
  } });
  assert.deepEqual(chooseTechZeroResourceTargets("ghost", [core, multimodal], ctx, 1), []);
  assert.deepEqual(chooseTechZeroResourceTargets("kaiser", [core, multimodal, spare], ctx, 3), [spare]);
});

test("Prism discards Core to make the searched Catapult live, preserving reserved copies", () => {
  const core = card(501), raptor = card(505), pulse = card(508);
  const ctx = context({ player: { hand: [card(506), raptor, core, pulse] } });
  assert.equal(chooseTechZeroPrismDiscard([raptor, core, pulse], ctx), core);
  assert.equal(chooseTechZeroPrismDiscard([raptor, core, pulse], { ...ctx, reservedInstanceIds: [core.instanceId] }), pulse);
  assert.equal(chooseTechZeroPrismDiscard([core], { ...ctx, reservedInstanceIds: [core.instanceId] }), null);
});

test("active Connector is preferred while its additional Normal can produce a body", () => {
  const connector = card(507);
  const ctx = context({ player: { hand: [card(502), card(501)], field: [], summonCount: 1 } });
  const activeValue = scoreTechZeroSummon(connector, ctx);
  assert.equal(techZeroConnectorNormalAvailable(connector), true);
  connector.effectsNegated = true;
  assert.equal(techZeroConnectorNormalAvailable(connector), false);
  assert.ok(activeValue > scoreTechZeroSummon(connector, ctx));
});

test("Assembly is refused when its direct-attack lock loses an available lethal", () => {
  const ctx = context({ directLethalAvailable: true, threatenedLethal: true,
    player: { graveyard: [card(501), card(504)] } });
  assert.equal(shouldUseTechZeroAssembly(ctx).allow, false);
});

test("Assembly may consume heuristic reserves when needed to survive", () => {
  const core = card(501), multimodal = card(503);
  const ctx = context({ player: { field: [card(516)], graveyard: [core, multimodal] } });
  assert.equal(shouldUseTechZeroAssembly(ctx).allow, false);
  const emergency = { ...ctx, threatenedLethal: true };
  assert.equal(shouldUseTechZeroAssembly(emergency).allow, true);
  assert.deepEqual(chooseTechZeroResourceTargets("assembly", [multimodal, core], emergency, 2).map(entry => entry.id).sort(), [501, 503]);
});

test("a plain Tuner cannot be mistaken for Multimodal's Synchro role", () => {
  assert.equal(getTechZeroRole(card(501)), "tuner");
  const c = required([card(504)][0]);
  assert.equal(getTechZeroRole(c), "extender");
});

test("activation context gives Core's case and target by exact IDs", () => {
  const core = card(501), catapult = card(502), effect = required(core.effects[0]);
  const result = buildTechZeroActivationContext(core, effect,
    context({ player: { field: [core, catapult], extraDeck: [card(503)] } }));
  assert.deepEqual(result.decisions?.selections, { tech_zero_energy_core_level_target: [catapult.instanceId] });
  assert.equal(result.decisions?.cases?.action_case_choice, "decrease");
});

test("Portal activation carries the same three exact revivals as the policy", () => {
  const portal = card(509), multimodal = card(503), catapult = card(502), core = card(501);
  const result = buildTechZeroActivationContext(portal, required(portal.effects[0]), context({ player: {
    field: [portal], graveyard: [core, catapult, multimodal, card(506)],
  } }));
  assert.deepEqual(result.decisions?.specialSummons?.tech_zero_summoning_portal_synchro_revive,
    [multimodal.instanceId, catapult.instanceId, core.instanceId]);
});

test("Lab's exact decisions never recycle one instance twice or take Scrapyard's tuner", () => {
  const lab = card(518), multimodal = card(503), portal = card(509), wyvern = card(504);
  const result = buildTechZeroActivationContext(lab, required(lab.effects[0]), context({ player: {
    field: [card(514)], graveyard: [multimodal, wyvern, portal], extraDeck: [card(516)], spellTrap: [card(520)],
  } }));
  assert.deepEqual(result.decisions?.selections, {
    tech_zero_development_lab_synchro_target: [portal.instanceId],
    tech_zero_development_lab_shuffle_choice: [wyvern.instanceId],
  });
});

test("Prism activation pins the discard cost and does not consume reserved Core", () => {
  const prism = card(506), core = card(501), pulse = card(508);
  const result = buildTechZeroActivationContext(prism, required(prism.effects[0]), context({ player: {
    hand: [prism, core, pulse], deck: [card(502)],
  }, reservedInstanceIds: [core.instanceId] }));
  assert.deepEqual(result.decisions?.selections?.tech_zero_prism_activator_discard_target, [pulse.instanceId]);
});

test("Assembly pins two expendable costs and recruits an active Connector for its extra Normal", () => {
  const assembly = card(519), core = card(501), wyvern = card(504), connector = card(507), catapult = card(502);
  const result = buildTechZeroActivationContext(assembly, required(assembly.effects[0]), context({ player: {
    field: [], hand: [card(502), card(501)], graveyard: [core, wyvern], deck: [catapult, connector], summonCount: 1,
  } }));
  assert.deepEqual(new Set(result.decisions?.selections?.tech_zero_assembly_line_banish_cost), new Set([core.instanceId, wyvern.instanceId]));
  assert.deepEqual(result.decisions?.specialSummons?.tech_zero_assembly_line_activation, [connector.instanceId]);
});

test("Scrapyard context reserves the exact revived tuner and exact Synchro materials", () => {
  const scrapyard = card(520), multimodal = card(503), core = card(501), phoenix = card(514), lancer = card(516);
  const result = buildTechZeroActivationContext(scrapyard, required(scrapyard.effects[0]), context({ player: {
    field: [phoenix], graveyard: [core, multimodal], extraDeck: [lancer],
  } }));
  assert.deepEqual(result.decisions?.specialSummons?.tech_zero_scrapyard_activation, [multimodal.instanceId]);
  const synchro = required(result.decisions?.synchroSummons?.tech_zero_scrapyard_activation);
  assert.equal(synchro.synchroInstanceId, lancer.instanceId);
  assert.deepEqual(new Set(synchro.materialInstanceIds), new Set([phoenix.instanceId, multimodal.instanceId]));
});
