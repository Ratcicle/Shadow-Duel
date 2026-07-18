import test from "node:test";
import assert from "node:assert/strict";

import {
  createActionResult,
  normalizeActivationResult,
  runActivationPipeline,
} from "../../src/core/game/effects/activationPipeline.js";
import { finalizeSpellTrapActivation } from "../../src/core/game/spellTrap/finalization.js";
import { cardDatabaseByName } from "../../src/data/cards.js";
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
  let observed = null;

  chain.offerChainResponses = async () => {
    observed ||= chain.getLastChainLink();
    return { consecutivePasses: 2 };
  };

  await chain.openActivationChain(
    chain.createPreparedActivation({
      card: source,
      controller: player,
      effect,
      activationZone: "field",
      targetSelections: { chosen: [target] },
      committed: true,
      costsPaid: true,
    }),
  );

  assert.equal(observed.card, source);
  assert.equal(observed.committed, true);
  assert.equal(observed.costsPaid, true);
  assert.deepEqual(observed.targetSelections, { chosen: [target] });
  assert.deepEqual(observed.declaredTargets, [
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
      createPreparedActivation: (value) => value,
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

  const result = await runActivationPipeline.call(context, {
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
  });

  assert.equal(result.success, false);
  assert.deepEqual(calls, { commit: 0, cost: 0, window: 0 });
});

test("cancelar a escolha de custo não compromete fonte nem reserva limite", async () => {
  let cost;
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
            candidates: [{ key: "cost", cardRef: cost }],
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
    {
      card: source,
      effect,
      sourceZone: "field",
      context: { type: "phase_change" },
    },
    player,
  );

  assert.equal(result.cancelled, true);
  assert.equal(player.field.includes(source), true);
  assert.equal(game.effectUsageReservations.size, 0);
  assert.equal(game.canUseOncePerTurn(source, player, effect).ok, true);
});

test("[CS-04] cleanup de Spell/Trap ocorre somente depois de CL1", async () => {
  let harness;
  const zonesDuringResolution = [];
  const finalizationStates = [];
  let rootCard;
  let responseCard;
  harness = createChainHarness({
    onActions(_actions, ctx) {
      zonesDuringResolution.push({
        resolving: ctx.source.name,
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
    actions: [{ type: "root_action" }],
  });
  const responseEffect = createTestEffect({
    id: "response_trap",
    speed: 2,
    actions: [{ type: "response_action" }],
  });
  placeCard(player, "spellTrap", rootCard);
  placeCard(bot, "spellTrap", responseCard);

  const rootLink = chain.addToChain(
    chain.createPreparedActivation({
      card: rootCard,
      controller: player,
      effect: rootEffect,
      activationZone: "spellTrap",
      activationContext: { sourceZone: "hand", fromHand: true },
      committed: true,
      costsPaid: true,
    }),
  );
  const responseLink = chain.addToChain(
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
  );

  const result = await chain.resolveChain();

  assert.equal(result.success, true);
  assert.deepEqual(
    trace.actions.map((entry) => entry.action.type),
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
      entry.payload.contextLabel === "post_chain_cleanup",
  );
  assert.equal(movementEvents.length, 2);
  assert.deepEqual(
    movementEvents.map((entry) => entry.payload.linkId),
    [links[1].linkId, links[0].linkId],
  );
  assert.equal(
    movementEvents.every(
      (entry) => entry.options.collectTriggersOnly === true,
    ),
    true,
  );
  assert.equal(
    new Set(movementEvents.map((entry) => entry.payload.locationVersion)).size,
    1,
    "cada carta deve registrar seu proprio primeiro movimento",
  );
});

test("finalizacao canônica adia Counter Trap ate depois de CL1", async () => {
  let harness;
  let counterTrap;
  const observedZones = [];
  harness = createChainHarness({
    onActions(_actions, ctx) {
      observedZones.push({
        source: ctx.source.name,
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
        actions: [{ type: "root_action" }],
      }),
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
  const counterLink = chain.addToChain(
    chain.createPreparedActivation({
      card: counterTrap,
      controller: bot,
      effect: createTestEffect({
        id: "counter_cleanup_effect",
        speed: 3,
        actions: [{ type: "counter_action" }],
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
          game,
          counterTrap,
          bot,
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
  let harness;
  let costCard;
  let target;
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
                key: `${requirement.id}:candidate`,
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
    activationCosts: [
      { type: "move", targetRef: "discard", to: "graveyard" },
    ],
  });
  source.effects = [effect];
  placeCard(player, "field", source);
  placeCard(player, "hand", costCard);
  placeCard(bot, "field", target);

  const preparation = await chain.prepareChainResponse(
    {
      card: source,
      effect,
      sourceZone: "field",
      context: {
        type: "effect_activation",
        event: "effect_activation",
        player: bot,
      },
    },
    player,
  );
  assert.equal(preparation.success, true);
  const prepared = preparation.preparedActivation;
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
    .map((entry) => entry.payload.stage);
  assert.deepEqual(transactionStages, [
    "preflight",
    "source_committed",
    "cost_paid",
    "targets_declared",
  ]);
  const selectionSessions = trace.responses
    .filter((entry) => entry.type === "selection")
    .map((entry) => entry.session);
  assert.equal(selectionSessions[0].selectionContract.purpose, "cost");
  assert.equal(selectionSessions[0].allowCancel, true);
  assert.equal(selectionSessions[1].selectionContract.purpose, "target");
  assert.equal(selectionSessions[1].allowCancel, false);
  assert.equal(selectionSessions[1].onCancel, null);

  const link = chain.addToChain(prepared);
  assert.deepEqual(link.declaredTargets, [
    { targetId: "destroy", cards: [target] },
  ]);
  assert.deepEqual(link.costSelections, { discard: [costCard] });
  assert.doesNotThrow(() => JSON.stringify(chain.getChainSummary()));
  assert.equal(game.chainSystem.getLastChainLink(), link);
});

test("Natural Selection real compromete fonte, descarta custo e congela alvo", async () => {
  let harness;
  harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      for (const action of actions) {
        if (action.type !== "move" || !action.targetRef) continue;
        const [card] = targets[action.targetRef] || [];
        if (!card) continue;
        await harness.game.moveCard(card, harness.player, action.to, {
          fromZone: action.fromZone,
        });
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
  const context = {
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
  assert.equal(result.success, true);
  assert.equal(player.spellTrap.includes(natural), true);
  assert.equal(player.graveyard.includes(discard), true);
  assert.deepEqual(result.preparedActivation.costSelections, {
    natural_selection_cost: [discard],
  });
  assert.deepEqual(result.preparedActivation.targetSelections, {
    natural_selection_target: [target],
  });

  const link = chain.addToChain(result.preparedActivation);
  assert.equal(link.usageReservation.status, "reserved");
  assert.equal(
    chain.checkActivationUsage(natural, player, candidate.effect).ok,
    false,
  );
  assert.equal(game.canUseOncePerTurn(natural, player, candidate.effect).ok, true);
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
      { id: "target", intent: "target" },
    ],
  });
  const prepared = chain.createPreparedActivation({
    card: createTestCard({ instanceId: 88, effects: [effect] }),
    controller: player,
    effect,
    activationZone: "field",
    costSelections: { cost: [cost] },
    targetSelections: { target: [target] },
    resolutionSelections: { choice: [choice] },
    committed: true,
    costsPaid: true,
  });

  assert.deepEqual(prepared.costSelections, { cost: [cost] });
  assert.deepEqual(prepared.targetSelections, { target: [target] });
  assert.deepEqual(prepared.resolutionSelections, { choice: [choice] });
  assert.equal(prepared.selections, undefined);
  const link = chain.addToChain(prepared);
  assert.deepEqual(link.declaredTargets, [
    { targetId: "target", cards: [target] },
  ]);
  assert.equal(link.selections, undefined);
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

  const result = await chain.resolveChainLink(link);
  assert.equal(result.success, false);
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
      if (!targets.choice) {
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
                candidates: [{ key: "choice:key", cardRef: choice }],
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
    actions: [{ type: "choose_action_case" }],
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
    }),
  );
  chain.chainStack.pop();

  const pendingResult = await chain.resolveChainLink(link);
  assert.equal(pendingResult.needsSelection, true);
  assert.equal(pendingResult.selectionContract.timing, "resolution");
  assert.equal(pendingResult.selectionContract.purpose, "choice");
  chain.pendingChainSelection = {
    link,
    selectionContract: pendingResult.selectionContract,
    selectionSource: "actions",
  };

  const result = await chain.startPendingChainSelection(pendingResult);
  assert.equal(result.success, true);
  assert.equal(applyCount, 2);
  assert.deepEqual(link.resolutionSelections, { choice: [choice] });
  assert.equal(link.selections, undefined);
  const session = trace.responses.find((entry) => entry.type === "selection")
    .session;
  assert.equal(session.preventCancel, true);
  assert.equal(session.allowCancel, false);
  assert.equal(session.onCancel, null);
  assert.equal(session.selectionContract.timing, "resolution");
  assert.equal(session.selectionContract.purpose, "choice");
});

test("fonte movida como custo preserva o snapshot de ativação", async () => {
  let harness;
  harness = createChainHarness({
    async onActions(actions, ctx) {
      if (actions.some((action) => action.targetRef === "self")) {
        await harness.game.moveCard(ctx.source, ctx.player, "graveyard", {
          fromZone: "field",
        });
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
    activationCosts: [
      { type: "move", targetRef: "self", to: "graveyard" },
    ],
  });
  source.effects = [effect];
  placeCard(player, "field", source);

  const result = await chain.prepareChainResponse(
    {
      card: source,
      effect,
      sourceZone: "field",
      context: { type: "phase_change" },
    },
    player,
  );
  assert.equal(result.success, true);
  assert.equal(result.preparedActivation.sourceAtActivation.zone, "field");
  assert.equal(result.preparedActivation.sourceAtActivation.locationVersion, 0);
  assert.equal(result.preparedActivation.sourceMoved, true);
  assert.equal(result.preparedActivation.latestSourceLocation.zone, "graveyard");
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
  const source = createTestCard({ instanceId: 130, name: "Frozen target source" });
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
      {
        id: "declared",
        intent: "target",
        owner: "opponent",
        zone: "field",
        cardKind: "monster",
        count: { min: 1, max: 1 },
      },
    ],
    actions: [{ type: "destroy_targeted_cards", targetRef: "declared" }],
  });
  placeCard(player, "field", source);
  placeCard(player, "hand", cost);
  placeCard(bot, "field", declaredTarget);
  placeCard(bot, "field", replacement);
  await game.moveCard(cost, player, "graveyard", { fromZone: "hand" });

  const link = chain.addToChain(
    chain.createPreparedActivation({
      card: source,
      controller: player,
      effect,
      activationZone: "field",
      costSelections: { paid: [cost] },
      targetSelections: { declared: [declaredTarget] },
      costPayment: { status: "paid", actions: [{ type: "discard" }] },
      committed: true,
      costsPaid: true,
    }),
  );
  await game.moveCard(declaredTarget, bot, "graveyard", {
    fromZone: "field",
  });

  const result = await chain.resolveChain();

  assert.equal(result.success, false);
  assert.equal(actionCalls, 0);
  assert.equal(targetResolutionCalls, 0);
  assert.equal(player.graveyard.includes(cost), true);
  assert.equal(bot.graveyard.includes(declaredTarget), true);
  assert.equal(bot.field.includes(replacement), true);
  assert.equal(link.targetValidation.satisfiesMinimums, false);
  assert.equal(link.targetValidation.groups[0].cards[0].valid, false);
  assert.equal(link.targetValidation.groups[0].cards[0].reason, "target_location_changed");
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
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card: source,
      controller: player,
      effect,
      activationZone: "field",
      targetSelections: { target: [target] },
      committed: true,
      costsPaid: true,
    }),
  );
  target.position = "defense";

  await chain.resolveChain();

  assert.equal(actionCalls, 0);
  assert.equal(bot.field.includes(target), true);
  assert.equal(bot.field.includes(replacement), true);
  assert.equal(link.targetValidation.groups[0].cards[0].valid, false);
  assert.equal(
    link.targetValidation.groups[0].cards[0].reason,
    "target_no_longer_matches",
  );
});
