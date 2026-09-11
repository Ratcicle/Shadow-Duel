import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import type {
  ChainCard,
  ChainPlayer,
} from "../../src/core/contracts/chainRuntime.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { objectResult, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";
import { createTestPlayer } from "./helpers/chainHarness.js";

import { validateCardDatabase } from "../../src/core/CardDatabaseValidator.js";
import { walkActionList } from "../../src/core/actionHandlers/actionWalker.js";
import {
  buildActivationQuery,
  checkEffectZoneLegality,
  createSimulationLegalityAdapter,
  listLegalActivationCandidates,
} from "../../src/core/chain/legality.js";
import { DecisionBroker } from "../../src/core/game/decisions/broker.js";
import { updatePriorityIndicator } from "../../src/ui/renderer/log.js";
import { cardDatabaseByName } from "../helpers/fixtures.js";

function effect(cardName: string, effectId: string) {
  return required(
    cardDatabaseByName
      .get(cardName)
      ?.effects?.find((entry) => entry.id === effectId),
  );
}

test("Fase 8 migra zonas, políticas, labels e Damage Step sem adapters nas cartas", () => {
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  const effects = [...cardDatabaseByName.values()].flatMap(
    (card) => card.effects || [],
  );
  assert.equal(
    effects.filter(
      (entry) =>
        ["ignition", "manual"].includes(entry.timing ?? "") &&
        !Array.isArray(entry.activationZones),
    ).length,
    0,
  );
  assert.equal(
    effects.filter(
      (entry) =>
        ["ignition", "manual"].includes(entry.timing ?? "") &&
        Reflect.get(entry, "requireZone") !== undefined,
    ).length,
    0,
  );
  assert.equal(
    effects.filter(
      (entry) => (entry.oncePerTurn || entry.oncePerDuel) && !entry.usagePolicy,
    ).length,
    0,
  );
  assert.equal(
    effects.filter(
      (entry) => Reflect.get(entry, "allowDamageStepActivation") !== undefined,
    ).length,
    0,
  );
  assert.deepEqual(
    effect("Void Hollow King", "void_hollow_king_quick_boost")
      .damageStepTimings,
    ["start_of_damage_step", "before_damage_calculation"],
  );
  assert.deepEqual(
    effect("Bloomrot Moldmender", "bloomrot_mold_mender_attack_spores")
      .damageStepTimings,
    ["before_damage_calculation"],
  );
  for (const [cardName, effectId] of [
    ["The Shadow Heart", "the_shadow_heart_summon_and_equip"],
    ["Void Raven", "void_raven_fusion_immunity"],
    ["Arcturus, the Fallen Lord", "arcturus_fallen_gy_revival"],
    ["Bloomrot Moldmender", "bloomrot_mold_mender_attack_spores"],
  ] as const) {
    assert.equal(effect(cardName, effectId).oncePerTurn, undefined);
    assert.equal(effect(cardName, effectId).oncePerDuel, undefined);
  }
});

test("cinco cartas representativas preservam a semântica canônica de negação", () => {
  const actionTypes = (cardName: string, effectId: string) =>
    walkActionList(required(effect(cardName, effectId)?.actions)).visits.map(
      (visit) =>
        visit.action &&
        typeof visit.action === "object" &&
        "type" in visit.action
          ? visit.action.type
          : undefined,
    );

  assert.ok(
    actionTypes(
      "Guardian Deity Visas",
      "guardian_deity_visas_hand_negate_banish",
    ).includes("negate_effect"),
  );
  assert.ok(
    actionTypes(
      "Tech-Zero Final Singularity",
      "tech_zero_final_singularity_negate_leave_field",
    ).includes("negate_effect"),
  );
  assert.ok(
    actionTypes(
      "Law in the Burning West",
      "law_in_the_burning_west_activation",
    ).includes("negate_summon_or_activation_and_destroy"),
  );
  assert.ok(
    actionTypes(
      "Tech-Zero Explosive Lancer",
      "tech_zero_explosive_lancer_negate_destroy",
    ).includes("negate_summon_or_activation_and_destroy"),
  );
  assert.ok(
    actionTypes(
      "Supreme Bahamut Dragon",
      "supreme_bahamut_dragon_negate",
    ).includes("negate_summon_or_activation_and_destroy"),
  );
});

test("runtime e simulação compartilham zona, chave e lista canônica", () => {
  const quickPlay: ChainCard = {
    name: "Quick fixture",
    id: 900,
    instanceId: 44,
    cardKind: "spell",
    subtype: "quick-play",
    effects: [
      {
        id: "quick",
        timing: "manual",
        speed: 2,
        activationZones: ["hand"],
      },
    ],
  };
  const player: ChainPlayer = {
    ...createTestPlayer("bot"),
    hand: [quickPlay],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
  const state = {
    turn: "bot",
    phase: "main1",
    bot: player,
    player: createTestPlayer("player"),
  };
  const query = buildActivationQuery({ state, player, sourceZones: ["hand"] });
  const candidates = listLegalActivationCandidates(
    query,
    createSimulationLegalityAdapter(state),
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateKey, "44:quick:hand");
  assert.ok(
    checkEffectZoneLegality(
      quickPlay,
      required(quickPlay.effects)[0],
      "graveyard",
    ).ok === false,
  );
});

test("serviço global distingue use de activate e usa IDs monotônicos por Game", () => {
  const game = createRuntimeGame({ captureReplay: false, randomSeed: 1 });
  const card = new Card({ id: 1, name: "Usage card" }, "player");
  card.instanceId = 1;
  const useEffect: EffectDefinition = {
    id: "use",
    timing: "on_activate",
    actions: [],
    oncePerTurn: true,
    usagePolicy: "use",
  };
  const activateEffect: EffectDefinition = {
    id: "activate",
    timing: "on_activate",
    actions: [],
    oncePerTurn: true,
    usagePolicy: "activate",
  };
  const first = required(
    game.reserveEffectUsage({
      card,
      player: game.player,
      effect: useEffect,
    }),
  );
  const second = required(
    game.reserveEffectUsage({
      card,
      player: game.player,
      effect: activateEffect,
    }),
  );
  assert.ok("status" in first && "status" in second);
  assert.equal(first.status, "consumed");
  assert.equal(second.status, "reserved");
  assert.equal(second.reservationId, first.reservationId + 1);
  assert.equal(
    Reflect.get(
      objectResult(game.settleEffectUsage(second, { activationNegated: true })),
      "status",
    ),
    "released",
  );
  game.dispose();
});

test("DecisionBroker rejeita escolha externa e playback não usa AutoSelector humano", async () => {
  const events: Array<{ name: string; payload: unknown }> = [];
  const game = {
    notify: (name: string, payload: unknown) => events.push({ name, payload }),
    recordReplayDecision: () => {},
  };
  const broker = new DecisionBroker(game);
  const actor = { id: "player", controllerType: "human" };
  const candidate = {
    candidateKey: "legal",
    card: { name: "Decision fixture" },
    effect: { id: "decision" },
  };
  const rejected = await broker.requestDecision({
    kind: "chain_response",
    actor,
    candidates: [candidate],
    resolveHuman: () => ({ ...candidate, candidateKey: "illegal" }),
  });
  assert.equal(rejected, null);
  assert.ok(events.some((entry) => entry.name === "decision_rejected"));

  broker.loadReplayDecisions([
    { decisionId: 7, kind: "chain_response", value: { candidateKey: "legal" } },
  ]);
  const replayChoice = await broker.requestDecision({
    kind: "chain_response",
    actor,
    candidates: [candidate],
    resolveHuman: () => assert.fail("human UI must not run in playback"),
  });
  assert.equal(replayChoice, candidate);
});

test("indicador de prioridade acompanha jogador e resolução sem abrir modal", () => {
  const classes = new Set();
  const element = {
    textContent: "",
    classList: {
      toggle(name: string, enabled: boolean) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      remove(...names: string[]) {
        names.forEach((name) => classes.delete(name));
      },
    },
  };
  const renderer = unsafeFixture<
    ThisParameterType<typeof updatePriorityIndicator>
  >(
    { elements: { priorityIndicator: element } },
    "This DOM fixture implements exactly the text/class operations used by the priority indicator.",
  );
  updatePriorityIndicator.call(renderer, {
    state: "fast_effect_window",
    priorityPlayerId: "player",
    turnPlayerId: "player",
  });
  assert.match(element.textContent, /Priority|Prioridade/);
  assert.ok(classes.has("visible"));
  updatePriorityIndicator.call(renderer, { state: "resolving_chain" });
  assert.ok(classes.has("resolving"));
  updatePriorityIndicator.call(renderer, null);
  assert.equal(element.textContent, "");
});

test("canonical activation candidates preserve observable property order", () => {
  const player = createTestPlayer("player");
  const card: ChainCard = {
    id: 77,
    name: "Order fixture",
    cardKind: "monster",
  };
  const effect = { id: "ordered_effect", speed: 2 as const };
  const input = {
    candidateKey: "77:ordered_effect:field",
    card,
    effect,
    effectId: "ordered_effect",
    player,
    opponent: null,
    sourceZone: "field" as const,
    spellSpeed: 2 as const,
    category: "monster_effect" as const,
    activationLabelKey: null,
    marker: "preserved",
  };

  const [candidate] = listLegalActivationCandidates(
    buildActivationQuery({ player }),
    { listCandidates: () => [input] },
  );

  assert.deepEqual(Object.keys(candidate), [
    "candidateKey",
    "card",
    "effect",
    "effectId",
    "player",
    "opponent",
    "sourceZone",
    "spellSpeed",
    "category",
    "activationLabelKey",
    "marker",
    "legality",
  ]);
});
