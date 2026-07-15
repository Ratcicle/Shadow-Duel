import ChainSystem from "../../../src/core/ChainSystem.js";
import AutoSelector from "../../../src/core/AutoSelector.js";
import { bumpCardLocationVersion } from "../../../src/core/Card.js";
import { getPublicState } from "../../../src/core/game/state/serialization.js";

const ARRAY_ZONES = [
  "hand",
  "field",
  "spellTrap",
  "graveyard",
  "banished",
  "deck",
  "extraDeck",
];

export function createTestPlayer(id, controllerType = "human") {
  return {
    id,
    name: id,
    controllerType,
    lp: 8000,
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    deck: [],
    extraDeck: [],
    fieldSpell: null,
    oncePerDuelUsageByName: Object.create(null),
  };
}

export function createTestCard(overrides = {}) {
  return {
    id: overrides.id ?? null,
    instanceId: overrides.instanceId ?? null,
    locationVersion: overrides.locationVersion ?? 0,
    name: overrides.name || "Test Card",
    owner: overrides.owner || null,
    cardKind: overrides.cardKind || "monster",
    subtype: overrides.subtype || null,
    isFacedown: overrides.isFacedown === true,
    effects: Array.isArray(overrides.effects) ? overrides.effects : [],
    ...overrides,
  };
}

export function createTestEffect(overrides = {}) {
  const timing = overrides.timing || "ignition";
  return {
    id: overrides.id || "test_effect",
    timing,
    ...(timing === "on_event"
      ? {
          triggerRequirement: "mandatory",
          triggerTiming: "if",
        }
      : {}),
    actions: Array.isArray(overrides.actions) ? overrides.actions : [],
    ...overrides,
  };
}

function removeCardFromPlayer(owner, card) {
  if (!owner || !card) return;
  for (const zone of ARRAY_ZONES) {
    const cards = owner[zone];
    if (!Array.isArray(cards)) continue;
    let index = cards.indexOf(card);
    while (index >= 0) {
      cards.splice(index, 1);
      index = cards.indexOf(card);
    }
  }
  if (owner.fieldSpell === card) owner.fieldSpell = null;
}

export function placeCard(owner, zone, card) {
  if (!owner || !zone || !card) {
    throw new TypeError("placeCard requires owner, zone, and card.");
  }
  removeCardFromPlayer(owner, card);
  card.owner = owner.id;
  card.controller = owner.id;
  if (zone === "fieldSpell") {
    owner.fieldSpell = card;
    return card;
  }
  if (!Array.isArray(owner[zone])) owner[zone] = [];
  owner[zone].push(card);
  return card;
}

function collectRequirementCandidates(requirement, ctx) {
  const player = ctx?.player || null;
  const opponent = ctx?.opponent || null;
  const owners =
    requirement?.owner === "opponent"
      ? [opponent]
      : requirement?.owner === "any"
        ? [player, opponent]
        : [player];
  const zones = Array.isArray(requirement?.zones)
    ? requirement.zones
    : [requirement?.zone || "field"];
  const candidates = [];

  for (const owner of owners.filter(Boolean)) {
    for (const zone of zones) {
      const zoneCards =
        zone === "fieldSpell"
          ? [owner.fieldSpell].filter(Boolean)
          : Array.isArray(owner[zone])
            ? owner[zone]
            : [];
      for (const card of zoneCards) {
      if (requirement.excludeSelf === true && card === ctx?.source) continue;
      if (requirement.cardKind && card.cardKind !== requirement.cardKind) continue;
      if (requirement.requireFaceup && card.isFacedown === true) continue;
      if (
        requirement.excludeCannotBeSpecialSummoned &&
        Array.isArray(card.specialSummonOnlyBy)
      ) {
        continue;
      }
      candidates.push(card);
      }
    }
  }
  return candidates;
}

function resolveTargetsForHarness(requirements = [], ctx = {}, selections = null) {
  if (selections && typeof selections === "object") {
    return { ok: true, needsSelection: false, targets: selections };
  }

  const targets = {};
  for (const requirement of requirements || []) {
    const candidates = collectRequirementCandidates(requirement, ctx);
    const minimum = Number(requirement?.count?.min ?? requirement?.min ?? 1);
    const maximum = Number(
      requirement?.count?.max ?? requirement?.max ?? Math.max(1, minimum),
    );
    if (candidates.length < minimum) {
      return {
        ok: false,
        needsSelection: false,
        reason: `Not enough candidates for ${requirement?.id || "target"}.`,
        targets: {},
      };
    }
    targets[requirement.id] = candidates.slice(0, maximum);
  }
  return { ok: true, needsSelection: false, targets };
}

export function createChainHarness(options = {}) {
  const player = createTestPlayer(
    options.playerId || "player",
    options.playerControllerType || "human",
  );
  const bot = createTestPlayer(
    options.botId || "bot",
    options.botControllerType || "ai",
  );
  const trace = {
    actions: [],
    moves: [],
    events: [],
    logs: [],
    responses: [],
  };

  const game = {
    player,
    bot,
    turn: options.turn || "player",
    turnCounter: options.turnCounter ?? 3,
    phase: options.phase || "main1",
    disableChains: false,
    _flushingPendingChainEvents: false,
    ui: {
      log(...args) {
        trace.logs.push(args);
      },
      ...(options.ui || {}),
    },
    getOpponent(owner) {
      return owner === player ? bot : player;
    },
    canActivateCardEffectUnderRestrictions() {
      return { ok: true };
    },
    _turnUsage: new Map(),
    getOncePerTurnLockKey(card, effect) {
      return `once_per_turn:${effect?.oncePerTurnName || effect?.id || card?.name || "effect"}`;
    },
    canUseOncePerTurn(card, owner, effect) {
      if (!effect?.oncePerTurn) return { ok: true };
      const key = `${owner?.id}:${this.getOncePerTurnLockKey(card, effect)}`;
      const used = Number(this._turnUsage.get(key) || 0);
      const limit = Number(effect.oncePerTurnLimit || 1);
      return used >= limit
        ? { ok: false, reason: "once per turn", used, limit, remaining: 0 }
        : { ok: true, used, limit, remaining: limit - used };
    },
    markOncePerTurnUsed(card, owner, effect) {
      if (!effect?.oncePerTurn) return;
      const key = `${owner?.id}:${this.getOncePerTurnLockKey(card, effect)}`;
      this._turnUsage.set(key, Number(this._turnUsage.get(key) || 0) + 1);
    },
    effectEngine: {
      async collectEventTriggers(eventName, payload) {
        if (typeof options.onCollectEventTriggers === "function") {
          return await options.onCollectEventTriggers(eventName, payload);
        }
        return { entries: [], orderRule: "harness" };
      },
      resolveTargets(requirements, ctx, selections) {
        if (typeof options.onResolveTargets === "function") {
          return options.onResolveTargets(requirements, ctx, selections);
        }
        return resolveTargetsForHarness(requirements, ctx, selections);
      },
      async applyActions(actions, ctx, targets) {
        for (const action of actions || []) {
          trace.actions.push({ action, ctx, targets });
        }
        if (typeof options.onActions === "function") {
          const result = await options.onActions(actions, ctx, targets);
          if (result !== undefined) return result;
        }
        return { success: true, needsSelection: false };
      },
      checkActionPreviewRequirements() {
        return { ok: true };
      },
      evaluateConditions() {
        return { ok: true };
      },
      checkOncePerTurn() {
        return { ok: true };
      },
      checkOncePerDuel(card, owner, effect) {
        if (!effect?.oncePerDuel) return { ok: true };
        const key = effect.oncePerDuelName || effect.id || card?.name;
        const used = Number(owner?.oncePerDuelUsageByName?.[key] || 0);
        const limit = Number(effect.oncePerDuelLimit || 1);
        return used >= limit
          ? { ok: false, reason: "once per duel", used, limit, remaining: 0 }
          : { ok: true, used, limit, remaining: limit - used };
      },
      registerOncePerDuelUsage(card, owner, effect) {
        if (!effect?.oncePerDuel || !owner) return;
        const key = effect.oncePerDuelName || effect.id || card?.name;
        owner.oncePerDuelUsageByName[key] =
          Number(owner.oncePerDuelUsageByName[key] || 0) + 1;
      },
      isEffectNegated(card) {
        return card?.effectsNegated === true;
      },
      registerOncePerTurnUsage() {},
    },
    async emit(eventName, payload, emitOptions = {}) {
      trace.events.push({
        eventName,
        payload,
        options: emitOptions,
        channel: "emit",
      });
      if (typeof options.onEmit === "function") {
        const result = await options.onEmit(eventName, payload, emitOptions);
        if (result !== undefined) return result;
      }
      return {
        ok: true,
        collectedOnly: emitOptions.collectTriggersOnly === true,
        eventName,
        payload,
        entries: [],
        results: [],
      };
    },
    async emitEffectActivated(payload, emitOptions = {}) {
      return this.emit("effect_activated", payload, emitOptions);
    },
    notify(eventName, payload) {
      trace.events.push({ eventName, payload, channel: "notify" });
      if (eventName === "chain_response") trace.responses.push(payload);
    },
    startTargetSelectionSession(session) {
      trace.responses.push({ type: "selection", session });
      if (typeof options.onStartTargetSelection === "function") {
        return options.onStartTargetSelection(session);
      }
      const selections = Object.fromEntries(
        (session.selectionContract?.requirements || []).map((requirement) => [
          requirement.id,
          (requirement.candidates || [])
            .slice(0, Number(requirement.min ?? 1))
            .map((candidate) => candidate.key),
        ]),
      );
      return session.execute?.(selections);
    },
    async moveCard(card, owner, toZone, moveOptions = {}) {
      const fromZone =
        moveOptions.fromZone || game.chainSystem?.determineCardZone(card, owner);
      removeCardFromPlayer(owner, card);
      placeCard(owner, toZone, card);
      const locationVersion =
        fromZone && fromZone !== toZone
          ? bumpCardLocationVersion(card)
          : card.locationVersion;
      game.chainSystem?.recordChainSourceMovement?.(card, {
        fromPlayer: owner,
        toPlayer: owner,
        fromZone,
        toZone,
        locationVersion,
        wasDestroyed: moveOptions.wasDestroyed === true,
      });
      const movement = { card, owner, fromZone, toZone, options: moveOptions };
      trace.moves.push(movement);
      if (fromZone && fromZone !== toZone) {
        const payload = {
          card,
          fromZone,
          toZone,
          locationVersion,
          player: owner,
          opponent: game.getOpponent(owner),
          fromPlayer: owner,
          toPlayer: owner,
          sourceCard: moveOptions.sourceCard || moveOptions.source || null,
          source: moveOptions.sourceCard || moveOptions.source || null,
          effectId: moveOptions.effectId || null,
          chainId: moveOptions.chainId ?? null,
          linkId: moveOptions.linkId ?? null,
          contextLabel: moveOptions.contextLabel || null,
          wasDestroyed: moveOptions.wasDestroyed === true,
          movedByEffect: Boolean(
            moveOptions.sourceCard || moveOptions.source || moveOptions.effectId,
          ),
        };
        await game.emit("card_moved", payload, { collectTriggersOnly: true });
        if (toZone === "graveyard") {
          await game.emit(
            "card_to_grave",
            payload,
            { collectTriggersOnly: true },
          );
        }
      }
      if (typeof options.onMove === "function") {
        await options.onMove(movement);
      }
      return { success: true, fromZone, toZone };
    },
    async presentSpellTrapActivationFlip() {},
    async runActivationPipelineWait(config = {}) {
      const activationContext = {
        ...(config.activationContext || {}),
        activationZone:
          config.activationZone || config.activationContext?.activationZone,
        prepareOnly: true,
        confirmed: config.activationContext?.confirmed === true,
      };
      const preview = await config.activate?.(
        config.selections || {},
        activationContext,
      );
      if (preview?.success === false || preview?.ok === false) return preview;
      const effect = preview?.effect || config.effect || null;
      const selections = preview?.targets || config.selections || {};
      const preparedActivation = game.chainSystem.createPreparedActivation({
        card: config.card,
        controller: config.owner,
        effect,
        activationZone: config.activationZone,
        activationContext: {
          ...activationContext,
          prepareOnly: false,
          selections,
        },
        selectionKind: config.selectionKind,
        selections,
        committed: true,
        costsPaid: true,
        pipelineManaged: true,
        skipUsageRegistration: true,
      });
      preparedActivation.pipelineCompletion = async (linkResult) => {
        if (linkResult?.success !== false) {
          await config.onSuccess?.(linkResult, activationContext);
        }
        return linkResult;
      };
      return {
        success: true,
        ok: true,
        prepared: true,
        preparedActivation,
        effect,
        targets: selections,
      };
    },
    async flushPendingTriggerOccurrences(flushOptions = {}) {
      if (typeof options.onFlushPendingTriggers === "function") {
        const custom = await options.onFlushPendingTriggers(flushOptions);
        if (custom !== undefined) return custom;
      }
      if (game._flushingPendingChainEvents) {
        return { ok: true, flushed: 0, deferred: true };
      }
      let flushed = 0;
      let chainBuilt = false;
      game._flushingPendingChainEvents = true;
      try {
        while (game.chainSystem.pendingTriggerOccurrences.length > 0) {
          const occurrences =
            game.chainSystem.pendingTriggerOccurrences.splice(0);
          flushed += occurrences.length;
          const result = await game.chainSystem.resolveTriggerOccurrences(
            occurrences,
            {
              context: { type: "post_chain", event: "post_chain" },
              deferPostChainWindow: true,
            },
          );
          chainBuilt = chainBuilt || result?.chainBuilt === true;
          if (result?.needsSelection || result?.ok === false) {
            return { ...result, chainBuilt, flushed };
          }
        }
        return { ok: true, success: true, chainBuilt, flushed };
      } finally {
        game._flushingPendingChainEvents = false;
      }
    },
    async flushPendingChainEvents() {
      return await this.flushPendingTriggerOccurrences();
    },
    updateBoard() {},
    checkWinCondition() {},
  };

  game.getPublicState = function getHarnessPublicState(forPlayerId) {
    return getPublicState.call(this, forPlayerId);
  };

  const chain = new ChainSystem(game, {
    responseTimeoutMs: options.responseTimeoutMs ?? 0,
    testMode: options.testMode === true,
  });
  game.chainSystem = chain;
  game.autoSelector = new AutoSelector(game);

  return { chain, game, player, bot, trace };
}
