import test from "node:test";
import assert from "node:assert/strict";

import { cardDatabaseByName } from "../../src/data/cards.js";
import { validateCardDatabase } from "../../src/core/CardDatabaseValidator.js";
import Game from "../../src/core/Game.js";
import {
  buildActivationQuery,
  checkEffectZoneLegality,
  createSimulationLegalityAdapter,
  listLegalActivationCandidates,
} from "../../src/core/chain/legality.js";
import { DecisionBroker } from "../../src/core/game/decisions/broker.js";
import { updatePriorityIndicator } from "../../src/ui/renderer/log.js";

function effect(cardName, effectId) {
  return cardDatabaseByName
    .get(cardName)
    ?.effects?.find((entry) => entry.id === effectId);
}

function flattenActions(actions = []) {
  return actions.flatMap((action) => [
    action,
    ...flattenActions(action?.actions),
    ...flattenActions(action?.thenActions),
    ...flattenActions(action?.elseActions),
  ]);
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
        ["ignition", "manual"].includes(entry.timing) &&
        !Array.isArray(entry.activationZones),
    ).length,
    0,
  );
  assert.equal(
    effects.filter(
      (entry) =>
        ["ignition", "manual"].includes(entry.timing) &&
        entry.requireZone !== undefined,
    ).length,
    0,
  );
  assert.equal(
    effects.filter(
      (entry) =>
        (entry.oncePerTurn || entry.oncePerDuel) && !entry.usagePolicy,
    ).length,
    0,
  );
  assert.equal(
    effects.filter((entry) => entry.allowDamageStepActivation !== undefined)
      .length,
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
  ]) {
    assert.equal(effect(cardName, effectId).oncePerTurn, undefined);
    assert.equal(effect(cardName, effectId).oncePerDuel, undefined);
  }
});

test("cinco cartas representativas preservam a semântica canônica de negação", () => {
  const actionTypes = (cardName, effectId) =>
    flattenActions(effect(cardName, effectId)?.actions).map((action) => action.type);

  assert.ok(
    actionTypes("Guardian Deity Visas", "guardian_deity_visas_hand_negate_banish")
      .includes("negate_effect"),
  );
  assert.ok(
    actionTypes("Tech-Zero Final Singularity", "tech_zero_final_singularity_negate_leave_field")
      .includes("negate_effect"),
  );
  assert.ok(
    actionTypes("Law in the Burning West", "law_in_the_burning_west_activation")
      .includes("negate_summon_or_activation_and_destroy"),
  );
  assert.ok(
    actionTypes("Tech-Zero Explosive Lancer", "tech_zero_explosive_lancer_negate_destroy")
      .includes("negate_summon_or_activation_and_destroy"),
  );
  assert.ok(
    actionTypes("Supreme Bahamut Dragon", "supreme_bahamut_dragon_negate")
      .includes("negate_summon_or_activation_and_destroy"),
  );
});

test("runtime e simulação compartilham zona, chave e lista canônica", () => {
  const quickPlay = {
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
  const player = {
    id: "bot",
    hand: [quickPlay],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
  const state = { turn: "bot", phase: "main1", bot: player, player: { id: "player" } };
  const query = buildActivationQuery({ state, player, sourceZones: ["hand"] });
  const candidates = listLegalActivationCandidates(
    query,
    createSimulationLegalityAdapter(state),
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateKey, "44:quick:hand");
  assert.equal(checkEffectZoneLegality(quickPlay, quickPlay.effects[0], "graveyard").ok, false);
});

test("serviço global distingue use de activate e usa IDs monotônicos por Game", () => {
  const game = new Game({ captureReplay: false, randomSeed: 1 });
  const card = { id: 1, instanceId: 1, name: "Usage card" };
  const useEffect = {
    id: "use",
    oncePerTurn: true,
    usagePolicy: "use",
  };
  const activateEffect = {
    id: "activate",
    oncePerTurn: true,
    usagePolicy: "activate",
  };
  const first = game.reserveEffectUsage({
    card,
    player: game.player,
    effect: useEffect,
  });
  const second = game.reserveEffectUsage({
    card,
    player: game.player,
    effect: activateEffect,
  });
  assert.equal(first.status, "consumed");
  assert.equal(second.status, "reserved");
  assert.equal(second.reservationId, first.reservationId + 1);
  assert.equal(
    game.settleEffectUsage(second, { activationNegated: true }).status,
    "released",
  );
  game.dispose();
});

test("DecisionBroker rejeita escolha externa e playback não usa AutoSelector humano", async () => {
  const events = [];
  const game = {
    notify: (name, payload) => events.push({ name, payload }),
    recordReplayDecision: () => {},
  };
  const broker = new DecisionBroker(game);
  const actor = { id: "player", controllerType: "human" };
  const candidate = { candidateKey: "legal" };
  const rejected = await broker.requestDecision({
    kind: "chain_response",
    actor,
    candidates: [candidate],
    resolveHuman: () => ({ candidateKey: "illegal" }),
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
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
    },
  };
  const renderer = { elements: { priorityIndicator: element } };
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
