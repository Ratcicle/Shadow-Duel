import assert from "node:assert/strict";
import test from "node:test";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type {
  ChainPlayer,
  ChainSourceZone,
  ChainTriggerEntry,
} from "../../src/core/contracts/chainRuntime.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import type { TestCard } from "./helpers/chainHarness.js";
import { installPreparedResponses } from "./helpers/chainHarness.js";

import {
  CHAIN_EFFECT_KINDS,
  captureSourceSnapshot,
} from "../../src/core/chain/link.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: complete chain construction and resolution flow, Rulebook v10.
// https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf

test("dois harnesses consecutivos não compartilham estado", () => {
  const first = createChainHarness();
  const second = createChainHarness();
  first.chain.addToChain(
    first.chain.createPreparedActivation({
      card: createTestCard({ name: "First-only card" }),
      controller: first.player,
      effect: createTestEffect({ id: "first_only" }),
      activationZone: "field",
    }),
  );
  first.trace.events.push({ eventName: "first-only" });

  assert.equal(first.chain.getChainLength(), 1);
  assert.equal(second.chain.getChainLength(), 0);
  assert.equal(second.trace.events.length, 0);
  assert.notEqual(first.player, second.player);
});

test("cancelChain limpa stack, janela, seleção e flags mutáveis", () => {
  const { chain, player } = createChainHarness();
  chain.addToChain(
    chain.createPreparedActivation({
      card: createTestCard({ name: "Pending card" }),
      controller: player,
      effect: createTestEffect({ id: "pending" }),
      activationZone: "field",
    }),
  );
  chain.chainWindowOpen = true;
  chain.chainWindowContext = { type: "card_activation" };
  chain.isResolving = true;
  chain.isPreparingActivation = true;
  chain.pendingChainSelection = {
    link: required(chain.getLastChainLink()),
    selectionContract: null,
    selectionSource: "actions",
    baseTargets: null,
  };
  chain.cardsBeingResolved.add(required(chain.getLastChainLink()).card);
  chain.chainEventCompletions.push(() => {});
  chain.chainTriggerEffectsOffered.set(
    required(chain.getLastChainLink()).card,
    new Set(),
  );

  chain.cancelChain();

  assert.equal(chain.getChainLength(), 0);
  assert.equal(chain.isChainWindowOpen(), false);
  assert.equal(chain.chainWindowContext, null);
  assert.equal(chain.isResolving, false);
  assert.equal(chain.isPreparingActivation, false);
  assert.equal(chain.pendingChainSelection, null);
  assert.equal(chain.currentChainLevel, 0);
  assert.equal(chain.cardsBeingResolved.size, 0);
  assert.equal(chain.chainEventCompletions.length, 0);
  assert.equal(chain.chainTriggerEffectsOffered.size, 0);
});

test("IDs de corrente e elo são determinísticos e isolados por harness", () => {
  const first = createChainHarness();
  const second = createChainHarness();
  const addLink = (
    harness: ReturnType<typeof createChainHarness>,
    suffix: string,
  ) =>
    required(
      harness.chain.addToChain(
        harness.chain.createPreparedActivation({
          card: createTestCard({ name: `Card ${suffix}` }),
          controller: harness.player,
          effect: createTestEffect({ id: `effect_${suffix}` }),
          activationZone: "field",
          committed: true,
          costsPaid: true,
        }),
      ),
    );

  const firstLink = addLink(first, "one");
  const secondLink = addLink(first, "two");
  const isolatedLink = addLink(second, "isolated");

  assert.deepEqual(
    [firstLink.chainId, firstLink.linkId, firstLink.chainLevel],
    [1, 1, 1],
  );
  assert.deepEqual(
    [secondLink.chainId, secondLink.linkId, secondLink.chainLevel],
    [1, 2, 2],
  );
  assert.deepEqual(
    [isolatedLink.chainId, isolatedLink.linkId, isolatedLink.chainLevel],
    [1, 1, 1],
  );

  first.chain.cancelChain();
  const nextChainLink = addLink(first, "next_chain");
  assert.deepEqual(
    [nextChainLink.chainId, nextChainLink.linkId, nextChainLink.chainLevel],
    [2, 3, 1],
  );
});

test("evento ou procedimento não ativável nunca cria CL1", async () => {
  const { chain, player } = createChainHarness();
  let observedLength = null;
  chain.offerChainResponses = async () => {
    observedLength = chain.getChainLength();
    return {
      offers: 0,
      activations: 0,
      consecutivePasses: 2,
      lastActivator: null,
      chainBuilt: false,
    };
  };

  await chain.openChainWindow(
    {
      type: "summon_attempt",
      card: createTestCard({ name: "Summon procedure" }),
      effect: createTestEffect({ id: "not_an_activation" }),
      controller: player,
      triggerPlayer: player,
      addTriggerToChain: true,
    },
    { firstPlayer: player },
  );

  assert.equal(observedLength, 0);
  assert.equal(chain.getChainLength(), 0);
  assert.equal(chain.activeChainId, null);
});

test("Trigger Effect preserva snapshots distintos do trigger e da ativação", async () => {
  const { chain, game, player } = createChainHarness();
  const source = createTestCard({ name: "Trigger source" });
  placeCard(player, "field", source);
  const sourceAtTrigger = captureSourceSnapshot(source, player, "field");

  await game.moveCard(source, player, "graveyard", { fromZone: "field" });
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: source,
        controller: player,
        effect: createTestEffect({ id: "trigger_effect", timing: "on_event" }),
        activationZone: "graveyard",
        activationContext: {
          sourceZone: "graveyard",
          activationZone: "graveyard",
          sourceAtTrigger,
          selectionKind: "triggered",
        },
        selectionKind: "triggered",
        committed: true,
        costsPaid: true,
      }),
    ),
  );

  assert.equal(link.effectKind, CHAIN_EFFECT_KINDS.TRIGGER);
  assert.deepEqual(link.sourceAtTrigger, sourceAtTrigger);
  assert.equal(required(link.sourceAtTrigger).locationVersion, 0);
  assert.equal(required(link.sourceAtActivation).locationVersion, 1);
  assert.equal(required(link.sourceAtActivation).zone, "graveyard");
});

test("resumo e estado público expõem somente o contrato serializável", () => {
  const { chain, game, player } = createChainHarness();
  chain.chainWindowOpen = true;
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: createTestCard({
          id: 99,
          instanceId: 501,
          name: "Public source",
        }),
        controller: player,
        effect: createTestEffect({ id: "public_effect", speed: 2 }),
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );

  const summary = chain.getChainSummary();
  const state = game.getPublicState!(player.id);

  assert.equal(summary[0].chainId, link.chainId);
  assert.equal(summary[0].linkId, link.linkId);
  assert.equal(summary[0].cardName, "Public source");
  assert.equal(summary[0].effectKind, CHAIN_EFFECT_KINDS.QUICK);
  assert.equal(Reflect.get(summary[0], "card"), undefined);
  assert.equal(Reflect.get(summary[0], "controller"), undefined);
  assert.doesNotThrow(() => JSON.stringify(summary));
  assert.deepEqual(state.chain, {
    chainId: 1,
    windowOpen: true,
    resolving: false,
    links: summary,
    timing: chain.getFastEffectState(),
    triggers: chain.getTriggerState(),
    finalization: chain.getChainFinalizationState(),
  });
});

test("addToChain rejeita a assinatura posicional removida", () => {
  const { chain, player } = createChainHarness();
  assert.throws(
    () =>
      unsafeFixture<(...args: unknown[]) => unknown>(
        chain.addToChain,
        "Removed positional arguments must fail at the runtime entrypoint.",
      ).call(
        chain,
        createTestCard({ name: "Legacy source" }),
        player,
        createTestEffect({ id: "legacy_effect" }),
      ),
    /canonical PreparedActivation/,
  );
  assert.equal(chain.getChainLength(), 0);
});

test("[CS-01][CS-02][CS-04] Summon, SEGOC, respostas, LIFO e cleanup integram em um único fluxo", async () => {
  let harness: ReturnType<typeof createChainHarness>;
  let responseCard: TestCard;
  const zonesDuringResolution: Array<{
    source: string;
    responseZone: ChainSourceZone | null;
  }> = [];
  harness = createChainHarness({
    playerControllerType: "ai",
    onActions(_actions, ctx) {
      zonesDuringResolution.push({
        source: required(ctx.source).name,
        responseZone: harness.chain.determineCardZone(
          responseCard,
          harness.player,
        ),
      });
    },
  });
  const { chain, player, bot, trace } = harness;

  const createTriggerEntry = (
    owner: ChainPlayer,
    name: string,
  ): ChainTriggerEntry => {
    const effect = createTestEffect({
      id: `${name}_effect`,
      timing: "on_event",
      event: "after_summon",
      triggerRequirement: "mandatory",
      triggerTiming: "if",
      speed: 1,
      actions: [
        unsafeFixture<CardAction>(
          { type: "trace_integration", name },
          "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
        ),
      ],
    });
    const card = createTestCard({
      instanceId: `${name}_instance`,
      name,
      effects: [effect],
    });
    placeCard(owner, "field", card);
    const sourceAtTrigger = captureSourceSnapshot(card, owner, "field");
    return {
      card,
      effect,
      owner,
      sourceAtTrigger,
      config: {
        card,
        effect,
        owner,
        activationZone: "field",
        selectionKind: "triggered",
        activationContext: {
          activationZone: "field",
          sourceAtTrigger,
        },
        async activate() {
          return { success: true, effect, targets: {} };
        },
      },
    };
  };

  const summonCard = createTestCard({
    instanceId: "summoned_instance",
    name: "Summoned monster",
  });
  placeCard(player, "field", summonCard);
  const turnTrigger = createTriggerEntry(player, "Turn trigger");
  const opponentTrigger = createTriggerEntry(bot, "Opponent trigger");
  const occurrence = chain.createTriggerOccurrence(
    "after_summon",
    { card: summonCard, player, opponent: bot },
    {
      entries: [opponentTrigger, turnTrigger],
      entriesProvided: true,
    },
  );

  responseCard = createTestCard({
    instanceId: "integration_response",
    name: "Fast response",
    cardKind: "trap",
    subtype: "normal",
  });
  placeCard(player, "spellTrap", responseCard);
  const response = chain.createPreparedActivation({
    card: responseCard,
    controller: player,
    effect: createTestEffect({
      id: "fast_response_effect",
      timing: "on_activate",
      speed: 2,
      actions: [
        unsafeFixture<CardAction>(
          { type: "trace_integration", name: "fast_response" },
          "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
        ),
      ],
    }),
    activationZone: "spellTrap",
    activationContext: {
      sourceZone: "spellTrap",
      sourceWasFacedown: true,
    },
    committed: true,
    costsPaid: true,
  });
  let responseUsed = false;
  installPreparedResponses(chain, async (responder) => {
    if (!responseUsed && responder === player) {
      responseUsed = true;
      return response;
    }
    return null;
  });

  const result = await chain.resolveTriggerOccurrences([required(occurrence)]);

  assert.equal(result.chainBuilt, true);
  assert.equal(responseUsed, true);
  assert.equal(
    chain.nextChainId,
    2,
    "Summon e SEGOC devem usar uma unica corrente",
  );
  assert.deepEqual(
    required(trace.actions).map((entry) => entry.action.name),
    ["fast_response", "Opponent trigger", "Turn trigger"],
  );
  assert.deepEqual(zonesDuringResolution, [
    { source: "Fast response", responseZone: "spellTrap" },
    { source: "Opponent trigger", responseZone: "spellTrap" },
    { source: "Turn trigger", responseZone: "spellTrap" },
  ]);
  assert.equal(player.graveyard.includes(responseCard), true);
  const firstPriority = required(
    trace.events.find(
      (entry) =>
        entry.eventName === "fast_effect_priority" &&
        required(entry.payload).decision === "offered",
    ),
  );
  assert.equal(required(firstPriority.payload).playerId, player.id);
  const completedCleanup = trace.events.filter(
    (entry) =>
      entry.eventName === "chain_finalization" &&
      required(entry.payload).stage === "completed",
  );
  assert.equal(completedCleanup.length, 3);
  assert.equal(
    required(
      required(
        completedCleanup.find(
          (entry) => required(entry.payload).cardName === "Fast response",
        ),
      ).payload,
    ).disposition,
    "graveyard",
  );
});
