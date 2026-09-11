import assert from "node:assert/strict";
import test from "node:test";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type {
  ChainEffectEnginePort,
  ChainEffectTarget,
  ChainLink,
  ChainSourceZone,
  FastEffectContextInput,
  PreparedActivationInput,
  TriggerOrderSelectionContract,
} from "../../src/core/contracts/chainRuntime.js";
import { normalizeZoneInput } from "../../src/core/contracts/zones.js";
import {
  chainSelections,
  objectResult,
  record,
  required,
  selectedCards,
  selectionKey,
  selectionContract as targetContract,
  unsafeFixture,
} from "../helpers/fixtures.js";
import type { TestCard } from "./helpers/chainHarness.js";
import { createTestCandidate } from "./helpers/chainHarness.js";

import { capCostDefinitionsByLinkedTargetCapacity } from "../../src/core/chain/selection.js";
import {
  createActionResult,
  normalizeActivationResult,
  runActivationPipeline,
} from "../../src/core/game/effects/activationPipeline.js";
import { finalizeSpellTrapActivation } from "../../src/core/game/spellTrap/finalization.js";
import { cardDatabaseByName } from "../helpers/fixtures.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: PSCT Part 3 and Rulebook v10 chain-resolution example.
// https://www.yugioh-card.com/en/play/psct/psct-3/

test("ativação preparada chega à janela com fonte, custos e alvos comprometidos", async () => {
  const { chain, player } = createChainHarness();
  const source = createTestCard({ name: "Prepared source" });
  const target = createTestCard({ name: "Prepared target" });
  const effect = createTestEffect({
    id: "prepared_effect",
    targets: [{ id: "chosen" }],
  });
  let observed = null as ChainLink | null;

  chain.offerChainResponses = async () => {
    observed ||= chain.getLastChainLink();
    return {
      offers: 0,
      activations: 0,
      lastActivator: null,
      chainBuilt: false,
      consecutivePasses: 2,
    };
  };

  await chain.openActivationChain(
    chain.createPreparedActivation({
      card: source,
      controller: player,
      effect,
      activationZone: "field",
      targetSelections: chainSelections({ chosen: [target] }),
      committed: true,
      costsPaid: true,
    }),
  );

  assert.equal(required(observed).card, source);
  assert.equal(required(observed).committed, true);
  assert.equal(required(observed).costsPaid, true);
  assert.deepEqual(required(observed).targetSelections, { chosen: [target] });
  assert.deepEqual(required(observed).declaredTargets, [
    { targetId: "chosen", cards: [target] },
  ]);
});

test("cancelamento opcional anterior ao commit não paga custo nem abre janela", async () => {
  const calls = { commit: 0, cost: 0, window: 0 };
  const player = { id: "player", controllerType: "human" };
  const context = {
    player,
    ui: { log() {} },
    canStartAction: () => ({ ok: true }),
    canActivateCardEffectUnderRestrictions: () => ({ ok: true }),
    normalizeActivationResult,
    createActionResult,
    chainSystem: {
      chainsDisabled: false,
      getEffectActivationCosts: () => [],
      createPreparedActivation: (value: PreparedActivationInput) => value,
      payActivationCosts: async () => {
        calls.cost += 1;
        return { success: true };
      },
      openActivationChain: async () => {
        calls.window += 1;
        return { success: true };
      },
    },
    devLog() {},
  };
  const card = createTestCard({ name: "Optional source" });

  const result = await runActivationPipeline.call(
    unsafeFixture<ThisParameterType<typeof runActivationPipeline>>(
      context,
      "This cancellation fixture supplies only capabilities reached before commit; all later phases must remain untouched.",
    ),
    unsafeFixture<Parameters<typeof runActivationPipeline>[0]>(
      {
        card,
        owner: player,
        effect: createTestEffect({ id: "optional" }),
        activate: async () => ({
          success: false,
          reason: "Effect activation cancelled.",
        }),
        commit: async () => {
          calls.commit += 1;
          return { cardRef: card, activationZone: "field" };
        },
      },
      "Legacy cancellation fixture omits fields that are only used after commit.",
    ),
  );

  assert.ok(result.success === false);
  assert.deepEqual(calls, { commit: 0, cost: 0, window: 0 });
});

test("cancelar a escolha de custo não compromete fonte nem reserva limite", async () => {
  let cost: TestCard;
  const { chain, game, player } = createChainHarness({
    onResolveTargets(requirements, _ctx, selections) {
      if (selections) {
        return { ok: true, needsSelection: false, targets: selections };
      }
      return {
        ok: false,
        needsSelection: true,
        targets: {},
        selectionContract: {
          requirements: requirements.map((requirement) => ({
            id: requirement.id,
            min: 1,
            max: 1,
            candidates: [{ key: selectionKey("cost"), cardRef: cost }],
          })),
          ui: {},
        },
      };
    },
    onStartTargetSelection(session) {
      return session.onCancel?.();
    },
  });
  const source = createTestCard({ instanceId: 89, name: "Cancelable source" });
  cost = createTestCard({ instanceId: 90, name: "Cancelable cost" });
  const effect = createTestEffect({
    id: "cancel_before_commit",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    activationZones: ["field"],
    oncePerTurn: true,
    usagePolicy: "activate",
    targets: [
      {
        id: "cost",
        owner: "self",
        zone: "hand",
        intent: "cost",
        count: { min: 1, max: 1 },
      },
    ],
  });
  source.effects = [effect];
  placeCard(player, "field", source);
  placeCard(player, "hand", cost);

  const result = await chain.prepareChainResponse(
    createTestCandidate(chain, player, {
      card: source,
      effect,
      sourceZone: "field",
      context: { type: "phase_change" },
    }),
    player,
  );

  assert.equal(result.cancelled, true);
  assert.equal(player.field.includes(source), true);
  assert.equal(game.effectUsageReservations.size, 0);
  assert.ok(game.canUseOncePerTurn(source, player, effect).ok === true);
});

test("[CS-04] cleanup de Spell/Trap ocorre somente depois de CL1", async () => {
  let harness: ReturnType<typeof createChainHarness>;
  const zonesDuringResolution: Array<{
    resolving: string;
    root: ChainSourceZone | null;
    response: ChainSourceZone | null;
  }> = [];
  const finalizationStates: Array<{
    resolving: boolean;
    finalizing: boolean;
    stackLength: number;
  }> = [];
  let rootCard: TestCard;
  let responseCard: TestCard;
  harness = createChainHarness({
    onActions(_actions, ctx) {
      zonesDuringResolution.push({
        resolving: required(ctx.source).name,
        root: harness.chain.determineCardZone(rootCard, harness.player),
        response: harness.chain.determineCardZone(responseCard, harness.bot),
      });
    },
    onMove() {
      finalizationStates.push({
        resolving: harness.chain.isResolving,
        finalizing: harness.chain.isFinalizingChain,
        stackLength: harness.chain.getChainLength(),
      });
    },
  });
  const { chain, player, bot, trace } = harness;
  rootCard = createTestCard({
    instanceId: 91,
    name: "Root Spell",
    cardKind: "spell",
    subtype: "normal",
  });
  responseCard = createTestCard({
    instanceId: 92,
    name: "Response Trap",
    cardKind: "trap",
    subtype: "normal",
  });
  const rootEffect = createTestEffect({
    id: "root_spell",
    actions: [
      unsafeFixture<CardAction>(
        { type: "root_action" },
        "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
      ),
    ],
  });
  const responseEffect = createTestEffect({
    id: "response_trap",
    speed: 2,
    actions: [
      unsafeFixture<CardAction>(
        { type: "response_action" },
        "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
      ),
    ],
  });
  placeCard(player, "spellTrap", rootCard);
  placeCard(bot, "spellTrap", responseCard);

  const rootLink = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: rootCard,
        controller: player,
        effect: rootEffect,
        activationZone: "spellTrap",
        activationContext: { sourceZone: "hand", fromHand: true },
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  const responseLink = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: responseCard,
        controller: bot,
        effect: responseEffect,
        activationZone: "spellTrap",
        activationContext: {
          sourceZone: "spellTrap",
          sourceWasFacedown: true,
        },
        committed: true,
        costsPaid: true,
      }),
    ),
  );

  const result = objectResult(await chain.resolveChain());

  assert.ok(result.success === true);
  assert.deepEqual(
    required(trace.actions).map((entry) => entry.action.type),
    ["response_action", "root_action"],
  );
  assert.deepEqual(zonesDuringResolution, [
    { resolving: "Response Trap", root: "spellTrap", response: "spellTrap" },
    { resolving: "Root Spell", root: "spellTrap", response: "spellTrap" },
  ]);
  assert.equal(player.graveyard.includes(rootCard), true);
  assert.equal(bot.graveyard.includes(responseCard), true);
  assert.deepEqual(
    trace.moves.map((move) => move.options.linkId),
    [responseLink.linkId, rootLink.linkId],
  );
  assert.deepEqual(finalizationStates, [
    { resolving: true, finalizing: true, stackLength: 0 },
    { resolving: true, finalizing: true, stackLength: 0 },
  ]);
});

test("[CS-04] cada movimento de cleanup emite seu evento individual", async () => {
  const { chain, player, bot, trace } = createChainHarness();
  const cards = [
    createTestCard({
      instanceId: 93,
      name: "Cleanup Spell",
      cardKind: "spell",
      subtype: "quick",
    }),
    createTestCard({
      instanceId: 94,
      name: "Cleanup Counter Trap",
      cardKind: "trap",
      subtype: "counter",
    }),
  ];
  const owners = [player, bot];
  const links = cards.map((card, index) => {
    const owner = owners[index];
    placeCard(owner, "spellTrap", card);
    return chain.addToChain(
      chain.createPreparedActivation({
        card,
        controller: owner,
        effect: createTestEffect({
          id: `cleanup_${index}`,
          speed: index === 0 ? 2 : 3,
        }),
        activationZone: "spellTrap",
        activationContext: {
          sourceZone: index === 0 ? "hand" : "spellTrap",
          fromHand: index === 0,
          sourceWasFacedown: index === 1,
        },
        committed: true,
        costsPaid: true,
      }),
    );
  });

  await chain.resolveChain();

  const movementEvents = trace.events.filter(
    (entry) =>
      entry.channel === "emit" &&
      entry.eventName === "card_moved" &&
      required(entry.payload).contextLabel === "post_chain_cleanup",
  );
  assert.equal(movementEvents.length, 2);
  assert.deepEqual(
    movementEvents.map((entry) => required(entry.payload).linkId),
    [required(required(links[1]).linkId), required(required(links[0]).linkId)],
  );
  assert.equal(
    movementEvents.every(
      (entry) => required(entry.options).collectTriggersOnly === true,
    ),
    true,
  );
  assert.equal(
    new Set(
      movementEvents.map((entry) => required(entry.payload).locationVersion),
    ).size,
    1,
    "cada carta deve registrar seu proprio primeiro movimento",
  );
});

test("finalizacao canônica adia Counter Trap ate depois de CL1", async () => {
  let harness: ReturnType<typeof createChainHarness>;
  let counterTrap: TestCard;
  const observedZones: Array<{
    source: string;
    counterZone: ChainSourceZone | null;
  }> = [];
  harness = createChainHarness({
    onActions(_actions, ctx) {
      observedZones.push({
        source: required(ctx.source).name,
        counterZone: harness.chain.determineCardZone(counterTrap, harness.bot),
      });
    },
  });
  const { chain, game, player, bot, trace } = harness;
  const root = createTestCard({ instanceId: 150, name: "CL1 monster" });
  counterTrap = createTestCard({
    instanceId: 151,
    name: "Counter cleanup",
    cardKind: "trap",
    subtype: "counter",
  });
  placeCard(player, "field", root);
  placeCard(bot, "spellTrap", counterTrap);
  chain.addToChain(
    chain.createPreparedActivation({
      card: root,
      controller: player,
      effect: createTestEffect({
        id: "root_before_counter_cleanup",
        actions: [
          unsafeFixture<CardAction>(
            { type: "root_action" },
            "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
          ),
        ],
      }),
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
  const counterLink = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: counterTrap,
        controller: bot,
        effect: createTestEffect({
          id: "counter_cleanup_effect",
          speed: 3,
          actions: [
            unsafeFixture<CardAction>(
              { type: "counter_action" },
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
        skipDefaultFinalization: true,
        pipelineFinalization: async (_result, finalizationContext) => {
          await finalizeSpellTrapActivation.call(
            unsafeFixture<
              ThisParameterType<typeof finalizeSpellTrapActivation>
            >(
              game,
              "Finalization fixture implements movement and usage cleanup; presentation-only Game capabilities are omitted.",
            ),
            unsafeFixture<Parameters<typeof finalizeSpellTrapActivation>[0]>(
              counterTrap,
              "Chain finalization uses the legacy minimal card projection, preserving its identity.",
            ),
            unsafeFixture<Parameters<typeof finalizeSpellTrapActivation>[1]>(
              bot,
              "Chain finalization uses only the fixture player zones.",
            ),
            "spellTrap",
            {
              activationContext: {
                ...finalizationContext,
                effectId: "counter_cleanup_effect",
              },
            },
          );
        },
      }),
    ),
  );

  await chain.resolveChain();

  assert.deepEqual(observedZones, [
    { source: "Counter cleanup", counterZone: "spellTrap" },
    { source: "CL1 monster", counterZone: "spellTrap" },
  ]);
  assert.equal(bot.graveyard.includes(counterTrap), true);
  assert.equal(counterLink.finalizationStatus, "completed");
  assert.equal(counterLink.sourceMoved, true);
  assert.equal(trace.moves.length, 1);
  assert.equal(trace.moves[0].options.contextLabel, "post_chain_cleanup");
  assert.equal(trace.moves[0].options.linkId, counterLink.linkId);
});

test("[CS-08] custo é pago antes da declaração de alvos", async () => {
  let harness: ReturnType<typeof createChainHarness>;
  let costCard: TestCard;
  let target: TestCard;
  harness = createChainHarness({
    onResolveTargets(requirements, _ctx, selections) {
      if (selections) {
        return { ok: true, needsSelection: false, targets: selections };
      }
      return {
        ok: false,
        needsSelection: true,
        targets: {},
        selectionContract: {
          requirements: requirements.map((requirement) => ({
            id: requirement.id,
            min: 1,
            max: 1,
            candidates: [
              {
                key: selectionKey(`${requirement.id}:candidate`),
                cardRef: requirement.id === "discard" ? costCard : target,
              },
            ],
          })),
          ui: {},
        },
      };
    },
    onActions(actions) {
      harness.trace.events.push({
        eventName: "cost_action_applied",
        actionTypes: actions.map((action) => action.type),
        channel: "test",
      });
    },
  });
  const { chain, game, player, bot, trace } = harness;
  costCard = createTestCard({ instanceId: 80, name: "Discard cost" });
  target = createTestCard({ instanceId: 81, name: "Declared target" });
  const source = createTestCard({
    instanceId: 82,
    name: "Transactional source",
  });
  const effect = createTestEffect({
    id: "cost_then_target",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    activationZones: ["field"],
    targets: [
      {
        id: "discard",
        owner: "self",
        zone: "hand",
        intent: "cost",
        count: { min: 1, max: 1 },
      },
      {
        id: "destroy",
        owner: "opponent",
        zone: "field",
        count: { min: 1, max: 1 },
      },
    ],
    activationCosts: [{ type: "move", targetRef: "discard", to: "graveyard" }],
  });
  source.effects = [effect];
  placeCard(player, "field", source);
  placeCard(player, "hand", costCard);
  placeCard(bot, "field", target);

  const preparation = await chain.prepareChainResponse(
    createTestCandidate(chain, player, {
      card: source,
      effect,
      sourceZone: "field",
      context: {
        type: "effect_activation",
        event: "effect_activation",
        player: bot,
      },
    }),
    player,
  );
  assert.ok(preparation.success === true);
  const prepared = required(preparation.preparedActivation);
  assert.deepEqual(prepared.costSelections, { discard: [costCard] });
  assert.deepEqual(prepared.targetSelections, { destroy: [target] });
  assert.equal(prepared.costsPaid, true);

  const stages = trace.events.map((entry) => entry.eventName);
  assert.ok(
    stages.indexOf("cost_action_applied") <
      stages.lastIndexOf("activation_transaction"),
  );
  const transactionStages = trace.events
    .filter((entry) => entry.eventName === "activation_transaction")
    .map((entry) => required(entry.payload).stage);
  assert.deepEqual(transactionStages, [
    "preflight",
    "source_committed",
    "cost_paid",
    "targets_declared",
  ]);
  const selectionSessions = trace.responses
    .filter((entry) => entry.type === "selection")
    .map((entry) => required(entry.session));
  assert.equal(
    required(targetContract(selectionSessions[0].selectionContract).purpose),
    "cost",
  );
  assert.equal(required(selectionSessions[0].allowCancel), true);
  assert.equal(
    required(targetContract(selectionSessions[1].selectionContract).purpose),
    "target",
  );
  assert.equal(required(selectionSessions[1].allowCancel), false);
  assert.equal(selectionSessions[1].onCancel, null);

  const link = required(chain.addToChain(prepared));
  assert.deepEqual(link.declaredTargets, [
    { targetId: "destroy", cards: [target] },
  ]);
  assert.deepEqual(link.costSelections, { discard: [costCard] });
  assert.doesNotThrow(() => JSON.stringify(chain.getChainSummary()));
  assert.equal(required(game.chainSystem).getLastChainLink(), link);
});

test("Natural Selection real compromete fonte, descarta custo e congela alvo", async () => {
  let harness: ReturnType<typeof createChainHarness>;
  harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      for (const action of actions) {
        if (action.type !== "move" || !action.targetRef) continue;
        const [card] = selectedCards(targets, action.targetRef);
        if (!card) continue;
        await harness.game.moveCard(
          card,
          harness.player,
          required(normalizeZoneInput(action.to)),
          {
            fromZone: action.fromZone
              ? normalizeZoneInput(action.fromZone)
              : undefined,
          },
        );
      }
    },
  });
  const { chain, game, player, bot } = harness;
  const naturalData = cardDatabaseByName.get("Natural Selection");
  assert.ok(naturalData);
  const natural = createTestCard({
    ...structuredClone(naturalData),
    instanceId: 93,
  });
  const discard = createTestCard({ instanceId: 94, name: "Real discard" });
  const target = createTestCard({ instanceId: 95, name: "Real target" });
  placeCard(player, "hand", natural);
  placeCard(player, "hand", discard);
  placeCard(bot, "field", target);
  const context: FastEffectContextInput = {
    type: "effect_activation",
    event: "effect_activation",
    player: bot,
    triggerPlayer: bot,
    openState: true,
    legalWindow: true,
  };
  const [candidate] = chain.getActivatableCardsInChain(player, context);
  assert.equal(candidate.effectId, "natural_selection_activation");

  const result = await chain.prepareChainResponse(candidate, player, context);
  assert.ok(result.success === true);
  assert.equal(player.spellTrap.includes(natural), true);
  assert.equal(player.graveyard.includes(discard), true);
  assert.deepEqual(required(result.preparedActivation).costSelections, {
    natural_selection_cost: [discard],
  });
  assert.deepEqual(required(result.preparedActivation).targetSelections, {
    natural_selection_target: [target],
  });

  const link = required(chain.addToChain(required(result.preparedActivation)));
  assert.equal(required(link.usageReservation).status, "reserved");
  assert.ok(
    chain.checkActivationUsage(natural, player, candidate.effect).ok === false,
  );
  assert.ok(
    game.canUseOncePerTurn(natural, player, candidate.effect).ok === true,
  );
});

test("seleções canônicas mantêm custo, alvo e resolução separados", () => {
  const { chain, player } = createChainHarness();
  const cost = createTestCard({ instanceId: 85, name: "Cost" });
  const target = createTestCard({ instanceId: 86, name: "Target" });
  const choice = createTestCard({ instanceId: 87, name: "Choice" });
  const effect = createTestEffect({
    id: "split_selections",
    targets: [
      { id: "cost", intent: "cost" },
      unsafeFixture<ChainEffectTarget>(
        { id: "target", intent: "target" },
        "Legacy explicit target intent is preserved to test canonical selection separation.",
      ),
    ],
  });
  const prepared = chain.createPreparedActivation({
    card: createTestCard({ instanceId: 88, effects: [effect] }),
    controller: player,
    effect,
    activationZone: "field",
    costSelections: chainSelections({ cost: [cost] }),
    targetSelections: chainSelections({ target: [target] }),
    resolutionSelections: chainSelections({ choice: [choice] }),
    committed: true,
    costsPaid: true,
  });

  assert.deepEqual(prepared.costSelections, { cost: [cost] });
  assert.deepEqual(prepared.targetSelections, { target: [target] });
  assert.deepEqual(prepared.resolutionSelections, { choice: [choice] });
  assert.equal(Reflect.get(prepared, "selections"), undefined);
  const link = required(chain.addToChain(prepared));
  assert.deepEqual(link.declaredTargets, [
    { targetId: "target", cards: [target] },
  ]);
  assert.equal(Reflect.get(link, "selections"), undefined);
});

test("[CS-08] alvo declarado nunca é escolhido durante resolução", async () => {
  let resolutionTargetCalls = 0;
  const { chain, player, trace } = createChainHarness({
    onResolveTargets() {
      resolutionTargetCalls += 1;
      return {
        needsSelection: true,
        selectionContract: {
          kind: "target",
          timing: "activation",
          purpose: "target",
          requirements: [],
          ui: {},
        },
      };
    },
  });
  const source = createTestCard({ instanceId: 83, name: "Missing target" });
  const effect = createTestEffect({
    id: "missing_activation_target",
    targets: [
      {
        id: "required",
        owner: "opponent",
        zone: "field",
        count: { min: 1, max: 1 },
      },
    ],
  });
  placeCard(player, "field", source);
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card: source,
      controller: player,
      effect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
      targetSelections: {},
    }),
  );

  const result = required(await chain.resolveChainLink(required(link)));
  assert.ok(result.success === false);
  assert.equal(result.needsSelection, false);
  assert.equal(result.resolvedWithoutEffect, true);
  assert.equal(resolutionTargetCalls, 0);
  assert.equal(
    trace.responses.some((entry) => entry.type === "selection"),
    false,
  );
});

test("escolha não-targeting durante resolução usa resolutionSelections", async () => {
  let applyCount = 0;
  const choice = createTestCard({ instanceId: 91, name: "Resolution choice" });
  const { chain, player, trace } = createChainHarness({
    onActions(_actions, _ctx, targets) {
      applyCount += 1;
      if (!Reflect.get(targets, "choice")) {
        return {
          success: false,
          needsSelection: true,
          selectionContract: {
            kind: "choice",
            timing: "resolution",
            purpose: "choice",
            requirements: [
              {
                id: "choice",
                min: 1,
                max: 1,
                candidates: [
                  { key: selectionKey("choice:key"), cardRef: choice },
                ],
              },
            ],
            ui: { allowCancel: false, preventCancel: true },
          },
        };
      }
      return { success: true, needsSelection: false };
    },
  });
  const source = createTestCard({ instanceId: 92, name: "Choice source" });
  const effect = createTestEffect({
    id: "resolution_choice",
    actions: [
      unsafeFixture<CardAction>(
        { type: "choose_action_case" },
        "The harness injects a resolution choice and never dispatches this skeletal action to a real handler.",
      ),
    ],
  });
  placeCard(player, "field", source);
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: source,
        controller: player,
        effect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  chain.chainStack.pop();

  const pendingResult = required(await chain.resolveChainLink(required(link)));
  assert.equal(pendingResult.needsSelection, true);
  assert.equal(
    targetContract(pendingResult.selectionContract).timing,
    "resolution",
  );
  assert.equal(
    targetContract(pendingResult.selectionContract).purpose,
    "choice",
  );
  chain.pendingChainSelection = {
    link,
    selectionContract: required(pendingResult.selectionContract),
    baseTargets: null,
    selectionSource: "actions",
  };

  const result = record(await chain.startPendingChainSelection(pendingResult));
  assert.ok(result.success === true);
  assert.equal(applyCount, 2);
  assert.deepEqual(link.resolutionSelections, { choice: [choice] });
  assert.equal(Reflect.get(link, "selections"), undefined);
  const session = required(
    required(trace.responses.find((entry) => entry.type === "selection"))
      .session,
  );
  assert.equal(session.preventCancel, true);
  assert.equal(session.allowCancel, false);
  assert.equal(session.onCancel, null);
  assert.equal(targetContract(session.selectionContract).timing, "resolution");
  assert.equal(targetContract(session.selectionContract).purpose, "choice");
});

test("fonte movida como custo preserva o snapshot de ativação", async () => {
  let harness: ReturnType<typeof createChainHarness>;
  harness = createChainHarness({
    async onActions(actions, ctx) {
      if (
        actions.some(
          (action) => "targetRef" in action && action.targetRef === "self",
        )
      ) {
        await harness.game.moveCard(
          required(ctx.source),
          required(ctx.player),
          "graveyard",
          {
            fromZone: "field",
          },
        );
      }
    },
  });
  const { chain, player } = harness;
  const source = createTestCard({ instanceId: 84, name: "Self cost" });
  const effect = createTestEffect({
    id: "self_cost_effect",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    activationZones: ["field"],
    activationCosts: [{ type: "move", targetRef: "self", to: "graveyard" }],
  });
  source.effects = [effect];
  placeCard(player, "field", source);

  const result = await chain.prepareChainResponse(
    createTestCandidate(chain, player, {
      card: source,
      effect,
      sourceZone: "field",
      context: { type: "phase_change" },
    }),
    player,
  );
  assert.ok(result.success === true);
  assert.equal(
    required(required(result.preparedActivation).sourceAtActivation).zone,
    "field",
  );
  assert.equal(
    required(required(result.preparedActivation).sourceAtActivation)
      .locationVersion,
    0,
  );
  assert.equal(required(result.preparedActivation).sourceMoved, true);
  assert.equal(
    required(required(result.preparedActivation).latestSourceLocation).zone,
    "graveyard",
  );
});

test("alvo invalido nao gera retarget nem reembolso de custo", async () => {
  let targetResolutionCalls = 0;
  let actionCalls = 0;
  const { chain, game, player, bot, trace } = createChainHarness({
    onResolveTargets() {
      targetResolutionCalls += 1;
      return { ok: false, needsSelection: true };
    },
    onActions() {
      actionCalls += 1;
    },
  });
  const source = createTestCard({
    instanceId: 130,
    name: "Frozen target source",
  });
  const cost = createTestCard({ instanceId: 131, name: "Paid cost" });
  const declaredTarget = createTestCard({
    instanceId: 132,
    name: "Declared target",
  });
  const replacement = createTestCard({
    instanceId: 133,
    name: "Replacement candidate",
  });
  const effect = createTestEffect({
    id: "frozen_target_effect",
    targets: [
      unsafeFixture<ChainEffectTarget>(
        {
          id: "declared",
          intent: "target",
          owner: "opponent",
          zone: "field",
          cardKind: "monster",
          count: { min: 1, max: 1 },
        },
        "Legacy explicit target intent is retained to verify selection separation.",
      ),
    ],
    actions: [{ type: "destroy_targeted_cards", targetRef: "declared" }],
  });
  placeCard(player, "field", source);
  placeCard(player, "hand", cost);
  placeCard(bot, "field", declaredTarget);
  placeCard(bot, "field", replacement);
  await game.moveCard(cost, player, "graveyard", { fromZone: "hand" });

  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: source,
        controller: player,
        effect,
        activationZone: "field",
        costSelections: chainSelections({ paid: [cost] }),
        targetSelections: chainSelections({ declared: [declaredTarget] }),
        costPayment: {
          status: "paid",
          actions: [{ index: 0, type: "discard" }],
        },
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  await game.moveCard(declaredTarget, bot, "graveyard", {
    fromZone: "field",
  });

  const result = objectResult(await chain.resolveChain());

  assert.ok(result.success === false);
  assert.equal(actionCalls, 0);
  assert.equal(targetResolutionCalls, 0);
  assert.equal(player.graveyard.includes(cost), true);
  assert.equal(bot.graveyard.includes(declaredTarget), true);
  assert.equal(bot.field.includes(replacement), true);
  assert.equal(required(link.targetValidation).satisfiesMinimums, false);
  assert.equal(required(link.targetValidation).groups[0].cards[0].valid, false);
  assert.equal(
    required(link.targetValidation).groups[0].cards[0].reason,
    "target_location_changed",
  );
  assert.equal(
    trace.responses.some((entry) => entry.type === "selection"),
    false,
  );
  assert.deepEqual(
    trace.moves.map((move) => move.card.name),
    ["Paid cost", "Declared target"],
  );
});

test("alvo congelado e revalidado sem trocar por outro candidato", async () => {
  let actionCalls = 0;
  const { chain, player, bot } = createChainHarness({
    onActions() {
      actionCalls += 1;
    },
  });
  const source = createTestCard({ instanceId: 134, name: "Position source" });
  const target = createTestCard({
    instanceId: 135,
    name: "Attack target",
    position: "attack",
  });
  const replacement = createTestCard({
    instanceId: 136,
    name: "Other attack target",
    position: "attack",
  });
  const effect = createTestEffect({
    id: "position_target",
    targets: [
      {
        id: "target",
        owner: "opponent",
        zone: "field",
        cardKind: "monster",
        position: "attack",
        count: { min: 1, max: 1 },
      },
    ],
    actions: [{ type: "destroy_targeted_cards", targetRef: "target" }],
  });
  placeCard(player, "field", source);
  placeCard(bot, "field", target);
  placeCard(bot, "field", replacement);
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: source,
        controller: player,
        effect,
        activationZone: "field",
        targetSelections: chainSelections({ target: [target] }),
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  target.position = "defense";

  await chain.resolveChain();

  assert.equal(actionCalls, 0);
  assert.equal(bot.field.includes(target), true);
  assert.equal(bot.field.includes(replacement), true);
  assert.equal(required(link.targetValidation).groups[0].cards[0].valid, false);
  assert.equal(
    required(link.targetValidation).groups[0].cards[0].reason,
    "target_no_longer_matches",
  );
});

test("linked-cost capacity remains defensive without a target resolver", () => {
  const costs = [{ id: "cost", count: { min: 1, max: 2 } }];
  const targets = [{ id: "target", countFromSelectionRef: "cost" }];

  const result = capCostDefinitionsByLinkedTargetCapacity(
    costs,
    targets,
    unsafeFixture<ChainEffectEnginePort>(
      {},
      "Missing target resolver is the deliberately defensive branch under test.",
    ),
    null,
  );

  assert.equal(result, costs);
});

test("trigger-order selections keep the legacy resolution session path", async () => {
  const { chain, game, player } = createChainHarness();
  const source = createTestCard({ instanceId: 950, name: "SEGOC source" });
  const effect = createTestEffect({ id: "segoc_resolution", actions: [] });
  const link = chain.createChainLink({
    card: source,
    controller: player,
    effect,
    activationZone: "field",
  });
  const selectionContract: TriggerOrderSelectionContract = {
    kind: "trigger_order",
    group: null,
    optional: false,
    candidates: [],
  };
  chain.pendingChainSelection = {
    link,
    selectionContract,
    selectionSource: "actions",
    baseTargets: null,
  };
  let opened = false;
  game.startTargetSelectionSession = (session) => {
    opened = true;
    session.onResult!({ success: true, needsSelection: false });
  };

  const result = record(
    await chain.startPendingChainSelection({ selectionContract }),
  );

  assert.equal(opened, true);
  assert.ok(result.success === true);
});
