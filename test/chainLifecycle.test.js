import test from "node:test";
import assert from "node:assert/strict";

import ChainSystem from "../src/core/ChainSystem.js";
import {
  createActionResult,
  normalizeActivationResult,
  runActivationPipeline,
} from "../src/core/game/effects/activationPipeline.js";
import {
  flushPendingChainEvents,
  queuePendingChainEvent,
} from "../src/core/game/events/eventResolver.js";
import { canActivateQuickSpellFromHand } from "../src/core/game/spellTrap/quickSpellRules.js";
import { showUnifiedTrapModal } from "../src/ui/renderer/trapModals.js";
import { dragonCards } from "../src/data/cards/dragon.js";

function makePlayer(id, controllerType = "human") {
  return {
    id,
    name: id,
    controllerType,
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
}

function removeFromZones(player, card) {
  for (const zone of ["hand", "field", "spellTrap", "graveyard", "banished"]) {
    const index = player[zone].indexOf(card);
    if (index >= 0) player[zone].splice(index, 1);
  }
  if (player.fieldSpell === card) player.fieldSpell = null;
}

function makeChainHarness({ onActions = null, onMove = null } = {}) {
  const player = makePlayer("player");
  const bot = makePlayer("bot", "ai");
  const events = [];
  const game = {
    player,
    bot,
    turn: "player",
    turnCounter: 3,
    phase: "main1",
    ui: { log() {} },
    getOpponent(owner) {
      return owner === player ? bot : player;
    },
    effectEngine: {
      resolveTargets(_requirements, _ctx, selections) {
        return { ok: true, needsSelection: false, targets: selections || {} };
      },
      async applyActions(actions, ctx, targets) {
        return (
          onActions?.(actions, ctx, targets) ||
          { success: true, needsSelection: false }
        );
      },
      checkActionPreviewRequirements() {
        return { ok: true };
      },
      registerOncePerTurnUsage() {},
    },
    async emit(eventName, payload, options = {}) {
      events.push({ eventName, payload, options });
      return {
        ok: true,
        collectedOnly: options.collectTriggersOnly === true,
        eventName,
        payload,
        entries: [],
        results: [],
      };
    },
    async emitEffectActivated(payload, options = {}) {
      return this.emit("effect_activated", payload, options);
    },
    notify(eventName, payload) {
      events.push({ eventName, payload, notified: true });
    },
    async moveCard(card, owner, toZone, options = {}) {
      removeFromZones(owner, card);
      if (toZone === "fieldSpell") owner.fieldSpell = card;
      else owner[toZone].push(card);
      onMove?.(card, owner, toZone, options);
      return { success: true, fromZone: options.fromZone, toZone };
    },
    updateBoard() {},
    checkWinCondition() {},
    flushPendingChainEvents: async () => ({ ok: true, flushed: 0 }),
  };
  const chain = new ChainSystem(game);
  game.chainSystem = chain;
  return { chain, game, player, bot, events };
}

test("a ativacao original ocupa CL1, resolve em LIFO e Speed 3 bloqueia Speed 2", async () => {
  const order = [];
  const { chain, player, bot } = makeChainHarness({
    onActions(_actions, ctx) {
      order.push(ctx.source.name);
    },
  });
  const rootCard = { name: "Root", cardKind: "monster", effects: [] };
  const rootEffect = { id: "root", speed: 1, actions: [{ type: "root" }] };
  const responseCard = { name: "Response", cardKind: "monster", effects: [] };
  const responseEffect = {
    id: "response",
    speed: 2,
    isQuickEffect: true,
    actions: [{ type: "response" }],
  };

  let sawRootAsCl1 = false;
  chain.offerChainResponses = async () => {
    sawRootAsCl1 =
      chain.chainStack.length === 1 &&
      chain.chainStack[0].card === rootCard &&
      chain.chainStack[0].chainLevel === 1;
    chain.addToChain(
      chain.createPreparedActivation({
        card: responseCard,
        player: bot,
        effect: responseEffect,
        zone: "field",
        committed: true,
        costsPaid: true,
      }),
    );
  };

  await chain.openActivationChain(
    chain.createPreparedActivation({
      card: rootCard,
      player,
      effect: rootEffect,
      zone: "field",
      committed: true,
      costsPaid: true,
    }),
  );

  assert.equal(sawRootAsCl1, true);
  assert.deepEqual(order, ["Response", "Root"]);

  chain.addToChain({
    prepared: true,
    card: { name: "Counter", cardKind: "trap", subtype: "counter" },
    player,
    effect: { id: "counter", speed: 3 },
    zone: "spellTrap",
  });
  const speedCheck = chain.canActivateInChain(
    { id: "quick", speed: 2 },
    { name: "Quick", cardKind: "spell", subtype: "quick" },
    { type: "card_activation" },
  );
  assert.equal(speedCheck.ok, false);
  assert.match(speedCheck.reason, /Spell Speed 2 cannot respond to Spell Speed 3/);
});

test("alvos, commit e custos terminam antes da janela de resposta", async () => {
  const sequence = [];
  const chosenTarget = { name: "Chosen target" };
  const effect = {
    id: "prepared_effect",
    targets: [{ id: "target" }],
    activationCosts: [{ type: "pay_lp", amount: 100 }],
    actions: [{ type: "draw", amount: 1 }],
  };
  let receivedPrepared = null;
  const context = {
    player: makePlayer("player"),
    turnCounter: 1,
    ui: { log() {} },
    canStartAction: () => ({ ok: true }),
    canActivateCardEffectUnderRestrictions: () => ({ ok: true }),
    normalizeActivationResult,
    createActionResult,
    effectEngine: {
      checkActionPreviewRequirements: () => ({ ok: true }),
    },
    chainSystem: {
      chainsDisabled: false,
      getEffectActivationCosts: () => effect.activationCosts,
      createPreparedActivation: (value) => ({ ...value, prepared: true }),
      async payActivationCosts() {
        sequence.push("cost");
        return { success: true };
      },
      async openActivationChain(prepared) {
        sequence.push("window");
        receivedPrepared = prepared;
        return { success: true, needsSelection: false };
      },
    },
    updateBoard() {},
    waitForAiPresentationStep: async () => {},
    getOpponent: () => null,
    recordMaterialEffectActivation() {},
    devLog() {},
  };
  const card = { name: "Prepared card", cardKind: "spell", subtype: "normal" };
  context.player.hand.push(card);

  const result = await runActivationPipeline.call(context, {
    card,
    owner: context.player,
    effect,
    activationZone: "hand",
    activate: async (_selections, activationContext) => {
      assert.equal(activationContext.prepareOnly, true);
      sequence.push("targets");
      return {
        success: true,
        prepared: true,
        effect,
        targets: { target: [chosenTarget] },
      };
    },
    commit: async () => {
      sequence.push("commit");
      return { cardRef: card, activationZone: "spellTrap", fromIndex: 0 };
    },
    finalize: async () => sequence.push("finalize"),
  });

  assert.equal(result.success, true);
  assert.deepEqual(sequence, ["targets", "commit", "cost", "window", "finalize"]);
  assert.deepEqual(receivedPrepared.selections, { target: [chosenTarget] });
});

test("efeito opcional recusado nao compromete carta, custo nem janela", async () => {
  const calls = { commit: 0, cost: 0, window: 0 };
  const context = {
    player: makePlayer("player"),
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
  const card = { name: "Optional", cardKind: "monster" };
  const result = await runActivationPipeline.call(context, {
    card,
    owner: context.player,
    effect: { id: "optional", actions: [] },
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

test("falha do efeito nao devolve custos e ainda finaliza a ativacao", async () => {
  const sequence = [];
  const player = makePlayer("player");
  const effect = {
    id: "failure_after_cost",
    activationCosts: [{ type: "pay_lp", amount: 500 }],
    actions: [{ type: "draw", amount: 1 }],
  };
  const context = {
    player,
    ui: { log() {} },
    canStartAction: () => ({ ok: true }),
    canActivateCardEffectUnderRestrictions: () => ({ ok: true }),
    normalizeActivationResult,
    createActionResult,
    effectEngine: { checkActionPreviewRequirements: () => ({ ok: true }) },
    chainSystem: {
      chainsDisabled: false,
      getEffectActivationCosts: () => effect.activationCosts,
      createPreparedActivation: (value) => ({ ...value, prepared: true }),
      async payActivationCosts() {
        sequence.push("cost");
        return { success: true };
      },
      async openActivationChain() {
        sequence.push("effect_failed");
        return { success: false, reason: "resolution failed" };
      },
    },
    updateBoard() {},
    getOpponent: () => null,
    devLog() {},
  };
  const source = { name: "Failure Spell", cardKind: "spell", subtype: "normal" };
  const result = await runActivationPipeline.call(context, {
    card: source,
    owner: player,
    effect,
    activationZone: "spellTrap",
    activationContext: { committed: true },
    activate: async () => ({ success: true, effect, targets: {} }),
    finalize: async () => sequence.push("finalize"),
  });

  assert.equal(result.success, false);
  assert.deepEqual(sequence, ["cost", "effect_failed", "finalize"]);
});

test("triggers de ativacao entram na mesma construcao antes da prioridade", async () => {
  const { chain, game, player } = makeChainHarness();
  const rootCard = { name: "Root", cardKind: "monster" };
  const rootEffect = { id: "root", actions: [] };
  const triggerCard = { name: "Observer", cardKind: "monster" };
  const triggerEffect = { id: "observer", actions: [] };
  const originalPublish = chain.publishChainLinkActivation.bind(chain);
  let publications = 0;
  chain.publishChainLinkActivation = async (link) => {
    publications += 1;
    if (publications === 1) {
      link.activationPublished = true;
      return {
        ok: true,
        triggerPackages: [
          {
            eventName: "effect_activated",
            payload: { card: rootCard, player },
            entries: [{ config: { card: triggerCard, activate: async () => ({}) } }],
          },
        ],
      };
    }
    return originalPublish(link);
  };
  game.runActivationPipelineWait = async () => ({
    success: true,
    preparedActivation: chain.createPreparedActivation({
      card: triggerCard,
      player,
      effect: triggerEffect,
      zone: "field",
      committed: true,
      costsPaid: true,
    }),
  });
  let linksAtPriority = 0;
  chain.offerChainResponses = async () => {
    linksAtPriority = chain.chainStack.length;
  };

  await chain.openActivationChain(
    chain.createPreparedActivation({
      card: rootCard,
      player,
      effect: rootEffect,
      zone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
  assert.equal(linksAtPriority, 2);
});

test("eventos criados durante Chain sao drenados em FIFO depois do fechamento", async () => {
  const observed = [];
  let windowOpen = true;
  const game = {
    pendingChainEvents: [],
    _flushingPendingChainEvents: false,
    turnCounter: 4,
    chainSystem: {
      isChainResolving: () => false,
      isChainWindowOpen: () => windowOpen,
      isPreparingActivation: false,
    },
    devLog() {},
    async resolveEventEntries(eventName) {
      observed.push(eventName);
      return { ok: true };
    },
  };
  for (const eventName of ["card_moved", "position_change", "battle_damage"]) {
    queuePendingChainEvent.call(game, { eventName, payload: {}, entries: [] });
  }
  assert.equal((await flushPendingChainEvents.call(game)).deferred, true);
  windowOpen = false;
  const result = await flushPendingChainEvents.call(game);
  assert.equal(result.flushed, 3);
  assert.deepEqual(observed, ["card_moved", "position_change", "battle_damage"]);
});

test("Quick Spell da mao exige vaga e o commit usa moveCard", async () => {
  const player = makePlayer("player");
  const quick = { name: "Quick", cardKind: "spell", subtype: "quick" };
  player.hand.push(quick);
  const game = { turn: "player", phase: "main1" };
  const legalContext = { type: "card_activation", requiredSpellSpeed: 2 };
  player.spellTrap.push(...Array.from({ length: 5 }, (_, i) => ({ name: `Set ${i}` })));
  assert.equal(
    canActivateQuickSpellFromHand(game, quick, player, legalContext).code,
    "SPELL_TRAP_ZONE_FULL",
  );
  player.spellTrap.pop();
  assert.equal(canActivateQuickSpellFromHand(game, quick, player, legalContext).ok, true);

  let moves = 0;
  const { chain } = makeChainHarness();
  chain.game.player = player;
  chain.game.moveCard = async (card, owner, toZone, options) => {
    moves += 1;
    removeFromZones(owner, card);
    owner[toZone].push(card);
    return { success: true, fromZone: options.fromZone, toZone };
  };
  chain.game.effectEngine.resolveTargets = () => ({ ok: true, targets: {} });
  const preparation = await chain.prepareChainResponse(
    { card: quick, effect: { id: "quick", actions: [] }, zone: "hand" },
    player,
    { type: "card_activation" },
  );
  assert.equal(preparation.success, true);
  assert.equal(moves, 1);
  assert.equal(player.spellTrap.includes(quick), true);
});

test("efeito rapido sobrevive a saida da fonte; permanente exige a fonte", async () => {
  let resolutions = 0;
  const { chain, player } = makeChainHarness({
    onActions() {
      resolutions += 1;
    },
  });
  const quickMonster = { name: "Quick monster", cardKind: "monster" };
  const quickResult = await chain.resolveChainLink(
    chain.createPreparedActivation({
      card: quickMonster,
      player,
      effect: { id: "quick", isQuickEffect: true, actions: [{ type: "draw" }] },
      zone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
  assert.equal(quickResult.success, true);
  assert.equal(resolutions, 1);

  const continuous = {
    name: "Continuous",
    cardKind: "spell",
    subtype: "continuous",
  };
  const persistentResult = await chain.resolveChainLink(
    chain.createPreparedActivation({
      card: continuous,
      player,
      effect: { id: "continuous", actions: [{ type: "draw" }] },
      zone: "spellTrap",
      committed: true,
      costsPaid: true,
    }),
  );
  assert.equal(persistentResult.fizzled, true);
  assert.equal(resolutions, 1);
});

test("custo, corpo e finalizacao sao sequenciais e observaveis", async () => {
  const sequence = [];
  let trap = null;
  const { chain, player } = makeChainHarness({
    onActions(actions) {
      sequence.push(actions[0].type);
    },
    onMove(card, _owner, toZone) {
      if (card === trap && toZone === "graveyard") sequence.push("finalize");
    },
  });
  trap = { name: "Sequential Trap", cardKind: "trap", subtype: "normal" };
  const effect = {
    id: "sequential",
    activationCosts: [{ type: "cost" }],
    actions: [{ type: "effect" }],
  };
  player.spellTrap.push(trap);
  const prepared = chain.createPreparedActivation({
    card: trap,
    player,
    effect,
    zone: "spellTrap",
    committed: true,
  });
  assert.equal((await chain.payActivationCosts(prepared)).success, true);
  chain.offerChainResponses = async () => {};
  await chain.openActivationChain(prepared);
  assert.deepEqual(sequence, ["cost", "effect", "finalize"]);
});

test("eventos de ativacao e effect_targeted sao publicados uma unica vez", async () => {
  const { chain, player, events } = makeChainHarness();
  const spell = { name: "Targeting Spell", cardKind: "spell", subtype: "normal" };
  const targets = [{ name: "Target A" }, { name: "Target B" }];
  player.spellTrap.push(spell);
  chain.offerChainResponses = async () => {};
  await chain.openActivationChain(
    chain.createPreparedActivation({
      card: spell,
      player,
      effect: {
        id: "targeting",
        targets: [{ id: "chosen" }],
        actions: [],
      },
      zone: "spellTrap",
      selections: { chosen: targets },
      committed: true,
      costsPaid: true,
    }),
  );

  assert.equal(events.filter((entry) => entry.eventName === "spell_activated").length, 1);
  assert.equal(events.filter((entry) => entry.eventName === "effect_activated").length, 1);
  assert.equal(events.filter((entry) => entry.eventName === "effect_targeted").length, 2);
});

test("timeout e cancelChain abortam o prompt e gravam um unico passe", async () => {
  const { chain, game, player, events } = makeChainHarness();
  player.controllerType = "human";
  let aborts = 0;
  game.ui.showChainResponseModal = (_cards, _context, _stack, { signal }) =>
    new Promise((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          aborts += 1;
          resolve(null);
        },
        { once: true },
      );
    });
  chain.responseTimeoutMs = 5;
  await chain.playerChooseChainResponse(
    player,
    [{ card: { name: "Trap" }, effect: { id: "trap" } }],
    { type: "card_activation" },
  );
  assert.equal(aborts, 1);
  assert.equal(
    events.filter((event) => event.eventName === "chain_response").length,
    1,
  );

  chain.responseTimeoutMs = 1000;
  const pending = chain.playerChooseChainResponse(
    player,
    [{ card: { name: "Trap 2" }, effect: { id: "trap2" } }],
    { type: "card_activation" },
  );
  await Promise.resolve();
  chain.cancelChain();
  await pending;
  assert.equal(aborts, 2);
  assert.equal(
    events.filter((event) => event.eventName === "chain_response").length,
    2,
  );
});

test("AbortSignal remove o modal e seus listeners sem DOM orfao", async () => {
  class FakeElement {
    constructor() {
      this.children = [];
      this.parent = null;
      this.style = {};
    }
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
    }
    addEventListener() {}
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
    focus() {}
  }
  const listeners = new Set();
  const fakeDocument = {
    body: new FakeElement(),
    createElement: () => new FakeElement(),
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener),
  };
  const previousDocument = globalThis.document;
  globalThis.document = fakeDocument;
  try {
    const controller = new AbortController();
    const renderer = {
      activeTrapModalCancel: null,
      _getContextDescription: () => "Response?",
    };
    const promise = showUnifiedTrapModal.call(renderer, {
      cards: [{ card: { name: "Trap", cardKind: "trap", description: "" } }],
      context: { type: "card_activation" },
      mode: "chain",
      signal: controller.signal,
    });
    assert.equal(fakeDocument.body.children.length, 1);
    controller.abort("test");
    assert.equal(await promise, null);
    assert.equal(fakeDocument.body.children.length, 0);
    assert.equal(listeners.size, 0);
    assert.equal(renderer.activeTrapModalCancel, null);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Dragon Spirit Sanctuary virada para baixo responde a effect_targeted", () => {
  const { chain, game, player, bot } = makeChainHarness();
  const sanctuary = structuredClone(
    dragonCards.find((card) => card.name === "Dragon Spirit Sanctuary"),
  );
  sanctuary.owner = player.id;
  sanctuary.controller = player.id;
  sanctuary.isFacedown = true;
  sanctuary.setTurn = 1;
  player.spellTrap.push(sanctuary);
  player.hand.push({ name: "Small Dragon", cardKind: "monster", type: "dragon", level: 3 });
  const target = {
    name: "Target Dragon",
    cardKind: "monster",
    type: "dragon",
    level: 4,
    owner: player.id,
  };
  player.field.push(target);
  game.effectEngine.resolveTargets = () => ({ ok: true, needsSelection: true });
  game.effectEngine.checkOncePerTurn = () => ({ ok: true });
  game.canActivateCardEffectUnderRestrictions = () => ({ ok: true });
  const source = { name: "Opponent effect", cardKind: "monster", owner: bot.id };
  chain.chainWindowOpen = true;
  chain.addToChain({
    prepared: true,
    card: source,
    player: bot,
    effect: { id: "targeting", speed: 2 },
    zone: "field",
  });

  const candidates = chain.getActivatableCardsInChain(player, {
    type: "effect_targeted",
    event: "effect_targeted",
    target,
    targetOwner: player,
    card: source,
    player: bot,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].card.name, "Dragon Spirit Sanctuary");
  assert.equal(candidates[0].effect.id, "dragon_spirit_sanctuary_effect_targeted");
});
