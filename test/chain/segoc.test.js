import test from "node:test";
import assert from "node:assert/strict";

import { captureSourceSnapshot } from "../../src/core/chain/link.js";
import {
  SEGOC_GROUPS,
  TRIGGER_REQUIREMENTS,
  TRIGGER_TIMINGS,
} from "../../src/core/chain/segoc.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: Rulebook v10, p. 50 (simultaneous Spell Speed 1 effects).
// https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf
// Saved Trigger Effects must still be in their trigger location when offered.
// https://www.yugioh-card.com/en/play/2021_rules_update/

function createEntry(
  harness,
  controller,
  name,
  {
    requirement = TRIGGER_REQUIREMENTS.MANDATORY,
    timing = TRIGGER_TIMINGS.IF,
    zone = "field",
    sourceAtTrigger = null,
  } = {},
) {
  const effect = createTestEffect({
    id: `${name}_effect`,
    timing: "on_event",
    event: "test_event",
    triggerRequirement: requirement,
    triggerTiming: timing,
    speed: 1,
    actions: [{ type: "trace_trigger", name }],
  });
  const card = createTestCard({
    id: `${name}_card`,
    instanceId: `${name}_instance`,
    name,
    effects: [effect],
  });
  placeCard(controller, zone, card);
  const snapshot =
    sourceAtTrigger || captureSourceSnapshot(card, controller, zone);
  return {
    summary: `${controller.id}:${name}`,
    card,
    effect,
    owner: controller,
    sourceAtTrigger: snapshot,
    config: {
      card,
      effect,
      owner: controller,
      activationZone: zone,
      selectionKind: "triggered",
      activationContext: {
        activationZone: zone,
        sourceAtTrigger: snapshot,
      },
      async activate(_selections, activationContext) {
        if (activationContext.prepareOnly === true) {
          return { success: true, effect, targets: {} };
        }
        return { success: true, effect, targets: {} };
      },
    },
  };
}

function occurrence(chain, entries, options = {}) {
  return chain.createTriggerOccurrence(
    options.eventName || "test_event",
    options.payload || {},
    {
      entries,
      entriesProvided: true,
      atomicGroupId: options.atomicGroupId,
    },
  );
}

function activatedEffects(trace) {
  return trace.events
    .filter(
      (entry) =>
        entry.channel === "emit" && entry.eventName === "effect_activated",
    )
    .map((entry) => entry.payload.effectId);
}

test("[CS-01] triggers simultÃ¢neos formam uma Ãºnica corrente na ordem SEGOC", async () => {
  const harness = createChainHarness({ playerControllerType: "ai" });
  const { chain, player, bot, trace } = harness;
  const entries = [
    createEntry(harness, bot, "opponent_optional", {
      requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
    }),
    createEntry(harness, player, "turn_optional", {
      requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
    }),
    createEntry(harness, bot, "opponent_mandatory"),
    createEntry(harness, player, "turn_mandatory"),
  ];

  const result = await chain.resolveTriggerOccurrences([
    occurrence(chain, entries),
  ]);

  assert.equal(result.chainBuilt, true);
  assert.deepEqual(activatedEffects(trace), [
    "turn_mandatory_effect",
    "opponent_mandatory_effect",
    "turn_optional_effect",
    "opponent_optional_effect",
  ]);
  assert.deepEqual(
    trace.actions.map((entry) => entry.action.name),
    [
      "opponent_optional",
      "turn_optional",
      "opponent_mandatory",
      "turn_mandatory",
    ],
  );
  const prepared = trace.events.find(
    (entry) => entry.eventName === "trigger_chain_prepared",
  );
  assert.equal(prepared.payload.preparedCount, 4);
});

test("[CS-01] jogador escolhe a ordem dos efeitos dentro do prÃ³prio grupo", async () => {
  const modalCalls = [];
  const harness = createChainHarness({
    ui: {
      async showTriggerOrderModal({ candidates, optional }) {
        modalCalls.push({ candidates, optional });
        return candidates
          .slice()
          .reverse()
          .map((candidate) => candidate.candidateId);
      },
    },
  });
  const { chain, player, trace } = harness;
  const entries = [
    createEntry(harness, player, "first_optional", {
      requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
    }),
    createEntry(harness, player, "second_optional", {
      requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
    }),
  ];

  await chain.resolveTriggerOccurrences([occurrence(chain, entries)]);

  assert.equal(modalCalls.length, 1);
  assert.equal(modalCalls[0].optional, true);
  assert.deepEqual(activatedEffects(trace), [
    "second_optional_effect",
    "first_optional_effect",
  ]);
});

test("[CS-01] Fast Effects sÃ£o oferecidos somente apÃ³s todos os triggers simultÃ¢neos", async () => {
  const harness = createChainHarness({ playerControllerType: "ai" });
  const { chain, player, bot, trace } = harness;
  const entries = [
    createEntry(harness, player, "trigger_one"),
    createEntry(harness, bot, "trigger_two"),
  ];

  await chain.resolveTriggerOccurrences([occurrence(chain, entries)]);

  const relevant = trace.events.filter(
    (entry) =>
      (entry.channel === "emit" && entry.eventName === "effect_activated") ||
      (entry.channel === "notify" &&
        entry.eventName === "fast_effect_priority" &&
        entry.payload.decision === "offered"),
  );
  assert.deepEqual(
    relevant.slice(0, 3).map((entry) => entry.eventName),
    ["effect_activated", "effect_activated", "fast_effect_priority"],
  );
  assert.equal(relevant[2].payload.playerId, player.id);
});

test("[CS-09] trigger pendente revalida a localizaÃ§Ã£o antes de entrar na corrente", async () => {
  const harness = createChainHarness({ playerControllerType: "ai" });
  const { chain, game, player, trace } = harness;
  const entry = createEntry(harness, player, "moving_source");
  const pending = occurrence(chain, [entry]);

  await game.moveCard(entry.card, player, "graveyard", { fromZone: "field" });
  const result = await chain.resolveTriggerOccurrences([pending]);

  assert.equal(result.chainBuilt, false);
  assert.deepEqual(activatedEffects(trace), []);
  const rejected = trace.events.find(
    (event) => event.eventName === "trigger_candidate_rejected",
  );
  assert.equal(rejected.payload.rejectionReason, "source_location_changed");
});

test("[CS-09] When opcional perde timing quando o evento nÃ£o foi o Ãºltimo relevante", async () => {
  const harness = createChainHarness({ playerControllerType: "ai" });
  const { chain, player, trace } = harness;
  const firstGroup = chain.allocateAtomicEventGroupId();
  const laterGroup = chain.allocateAtomicEventGroupId();
  const whenEntry = createEntry(harness, player, "optional_when", {
    requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
    timing: TRIGGER_TIMINGS.WHEN,
  });
  const ifEntry = createEntry(harness, player, "optional_if", {
    requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
    timing: TRIGGER_TIMINGS.IF,
  });

  const result = await chain.resolveTriggerOccurrences([
    occurrence(chain, [whenEntry, ifEntry], { atomicGroupId: firstGroup }),
    occurrence(chain, [], { atomicGroupId: laterGroup, eventName: "later_event" }),
  ]);

  assert.equal(result.chainBuilt, true);
  assert.deepEqual(activatedEffects(trace), ["optional_if_effect"]);
  const rejected = trace.events.find(
    (event) =>
      event.eventName === "trigger_candidate_rejected" &&
      event.payload.effectId === "optional_when_effect",
  );
  assert.equal(rejected.payload.rejectionReason, "optional_when_missed_timing");
});

test("modal opcional seleciona subconjunto e modal obrigatÃ³rio nÃ£o permite omissÃ£o", async () => {
  let optionalCall = 0;
  const harness = createChainHarness({
    ui: {
      async showTriggerOrderModal({ candidates, optional }) {
        if (optional) {
          optionalCall += 1;
          return [candidates[1].candidateId];
        }
        return [candidates[0].candidateId];
      },
    },
  });
  const { chain, player } = harness;
  const mandatory = [
    createEntry(harness, player, "mandatory_one"),
    createEntry(harness, player, "mandatory_two"),
  ];
  const opportunity = chain.buildTriggerOpportunity([
    occurrence(chain, mandatory),
  ]);
  await chain.collectTriggerCandidates(opportunity);
  const invalid = await chain.prepareTriggerOpportunity(opportunity);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "mandatory_trigger_order_incomplete");

  chain.activeTriggerOpportunity = null;
  const optional = [
    createEntry(harness, player, "optional_one", {
      requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
    }),
    createEntry(harness, player, "optional_two", {
      requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
    }),
  ];
  const result = await chain.resolveTriggerOccurrences([
    occurrence(chain, optional),
  ]);
  assert.equal(optionalCall, 1);
  assert.equal(result.selectedTriggerCount, 1);
});

test("IA ativa todos os triggers opcionais em ordem determinÃ­stica", async () => {
  const run = async () => {
    const harness = createChainHarness({ playerControllerType: "ai" });
    const { chain, player, trace } = harness;
    const entries = ["alpha", "beta", "gamma"].map((name) =>
      createEntry(harness, player, name, {
        requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
      }),
    );
    await chain.resolveTriggerOccurrences([occurrence(chain, entries)]);
    return {
      effects: activatedEffects(trace),
      ids: trace.events
        .filter((event) => event.eventName === "segoc_order_selected")
        .flatMap((event) => event.payload.orderedCandidateIds),
    };
  };

  assert.deepEqual(await run(), await run());
});

test("eventos derivados compartilham grupo atÃ´mico sem colapsar aÃ§Ãµes sequenciais", () => {
  const { chain } = createChainHarness();
  const movementGroup = chain.allocateAtomicEventGroupId();
  const toGrave = occurrence(chain, [], {
    eventName: "card_to_grave",
    atomicGroupId: movementGroup,
  });
  const moved = occurrence(chain, [], {
    eventName: "card_moved",
    atomicGroupId: movementGroup,
  });
  const nextMove = occurrence(chain, [], { eventName: "card_moved" });

  assert.equal(toGrave.atomicGroupId, moved.atomicGroupId);
  assert.notEqual(moved.atomicGroupId, nextMove.atomicGroupId);
  assert.notEqual(toGrave.occurrenceId, moved.occurrenceId);
  assert.notEqual(moved.occurrenceId, nextMove.occurrenceId);
});

test("eventos sobrepostos no mesmo grupo atÃ´mico nÃ£o duplicam o mesmo trigger", async () => {
  const harness = createChainHarness({ playerControllerType: "ai" });
  const { chain, player, trace } = harness;
  const group = chain.allocateAtomicEventGroupId();
  const entry = createEntry(harness, player, "deduplicated");

  const result = await chain.resolveTriggerOccurrences([
    occurrence(chain, [entry], {
      eventName: "spell_activated",
      atomicGroupId: group,
    }),
    occurrence(chain, [entry], {
      eventName: "effect_activated",
      atomicGroupId: group,
    }),
  ]);

  assert.equal(result.triggerCount, 1);
  assert.deepEqual(activatedEffects(trace), ["deduplicated_effect"]);
});

test("estado e eventos de SEGOC sÃ£o serializÃ¡veis", async () => {
  const harness = createChainHarness({ playerControllerType: "ai" });
  const { chain, game, player, trace } = harness;
  await chain.resolveTriggerOccurrences([
    occurrence(chain, [createEntry(harness, player, "serializable")]),
  ]);

  const triggerEvents = trace.events.filter((event) =>
    event.eventName.startsWith("trigger_") ||
    event.eventName === "segoc_order_selected",
  );
  assert.doesNotThrow(() => JSON.stringify(triggerEvents));
  assert.doesNotThrow(() => JSON.stringify(game.getPublicState(player.id).chain.triggers));
});

test("cancelamento limpa fila e seleÃ§Ã£o sem reutilizar IDs", () => {
  const { chain } = createChainHarness();
  const first = occurrence(chain, []);
  chain.queueTriggerOccurrence(first);
  chain.pendingTriggerSelection = { opportunityId: 1 };
  chain.cancelChain();
  const second = occurrence(chain, []);

  assert.equal(chain.pendingTriggerOccurrences.length, 0);
  assert.equal(chain.pendingTriggerSelection, null);
  assert.equal(second.occurrenceId, first.occurrenceId + 1);
});

test("pÃ³s-Chain drena oportunidades sucessivas antes da janela final", async () => {
  let harness = null;
  const queued = new Set();
  harness = createChainHarness({
    playerControllerType: "ai",
    async onActions(actions) {
      const name = actions?.[0]?.name;
      if (name === "post_first" && !queued.has("second")) {
        queued.add("second");
        harness.chain.queueTriggerOccurrence(
          occurrence(harness.chain, [
            createEntry(harness, harness.player, "post_second"),
          ]),
        );
      } else if (name === "post_second" && !queued.has("third")) {
        queued.add("third");
        harness.chain.queueTriggerOccurrence(
          occurrence(harness.chain, [
            createEntry(harness, harness.player, "post_third"),
          ]),
        );
      }
    },
  });
  const { chain, game, player, trace } = harness;
  chain.queueTriggerOccurrence(
    occurrence(chain, [createEntry(harness, player, "post_first")]),
  );

  const result = await game.flushPendingTriggerOccurrences();

  assert.equal(result.flushed, 3);
  assert.equal(chain.pendingTriggerOccurrences.length, 0);
  assert.deepEqual(activatedEffects(trace), [
    "post_first_effect",
    "post_second_effect",
    "post_third_effect",
  ]);
  assert.equal(chain.nextChainId, 4);
});

test("recusar todos os triggers opcionais nÃ£o cria corrente vazia", async () => {
  const harness = createChainHarness({
    ui: {
      async showTriggerOrderModal() {
        return [];
      },
    },
  });
  const { chain, player, trace } = harness;
  const result = await chain.resolveTriggerOccurrences([
    occurrence(chain, [
      createEntry(harness, player, "declined_optional", {
        requirement: TRIGGER_REQUIREMENTS.OPTIONAL,
      }),
    ]),
  ]);

  assert.equal(result.chainBuilt, false);
  assert.equal(result.selectedTriggerCount, 0);
  assert.equal(chain.activeChainId, null);
  assert.equal(chain.nextChainId, 1);
  assert.deepEqual(activatedEffects(trace), []);
});

test("grupos SEGOC tÃªm contrato pÃºblico estÃ¡vel", () => {
  assert.deepEqual(Object.values(SEGOC_GROUPS), [
    "turn_player_mandatory",
    "opponent_mandatory",
    "turn_player_optional",
    "opponent_optional",
  ]);
});
