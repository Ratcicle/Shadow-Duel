import AutoSelector from "../../../src/core/AutoSelector.js";
import { bumpCardLocationVersion } from "../../../src/core/Card.js";
import ChainSystem from "../../../src/core/ChainSystem.js";
import {
  checkEffectUsage,
  releaseEffectUsageReservations,
  reserveEffectUsage,
  settleEffectUsage,
} from "../../../src/core/game/effects/usage.js";
import { getPublicState } from "../../../src/core/game/state/serialization.js";
import { getActivationCandidateKey } from "../../../src/core/chain/activationDiscovery.js";
import type { CardAction } from "../../../src/core/contracts/actions.js";
import type {
  CardConstructorData,
  GameCard,
} from "../../../src/core/contracts/cards.js";
import type {
  ChainActionContext,
  ChainActivationCandidate,
  ChainActivationPipelineInput,
  ChainCard,
  ChainEffect,
  ChainEffectEnginePort,
  ChainEffectTarget,
  ChainEventPayload,
  ChainGamePort,
  ChainMaybePromise,
  ChainMoveCardOptions,
  ChainOperationResult,
  ChainPlayer,
  ChainSelectionMap,
  ChainSelectionSessionInput,
  ChainSelectionValue,
  ChainTargetResolution,
  ChainTriggerCollectionResult,
  ChainUiPort,
  ChainUsageCheck,
  ChainUsageReservation,
  FastEffectContextInput,
  PreparedActivation,
  PreparedActivationContext,
} from "../../../src/core/contracts/chainRuntime.js";
import type { DamageStepTiming } from "../../../src/core/contracts/effects.js";
import type { PlayerId } from "../../../src/core/contracts/primitives.js";
import type { CanonicalZone } from "../../../src/core/contracts/zones.js";
import { required, unsafeFixture } from "../../helpers/fixtures.js";

export type TestCard = ChainCard &
  Partial<Omit<GameCard, keyof ChainCard | keyof CardConstructorData>> &
  Omit<CardConstructorData, keyof ChainCard> & {
    effects: readonly ChainEffect[];
    locationVersion: number;
  };
export type TestEffect = {
  -readonly [Key in keyof ChainEffect]: ChainEffect[Key];
} & {
  id: string;
  actions: readonly CardAction[];
};

export function createTestCandidate(
  chain: ChainSystem,
  player: ChainPlayer,
  input: Pick<ChainActivationCandidate, "card" | "effect" | "sourceZone"> &
    Partial<ChainActivationCandidate>,
): ChainActivationCandidate {
  const { card, effect, sourceZone } = input;
  return {
    candidateKey: getActivationCandidateKey(card, effect, sourceZone),
    effectId: effect.id || null,
    player,
    controller: player,
    sourceLocationVersion: Number(card.locationVersion ?? 0),
    spellSpeed: chain.getEffectSpellSpeed(effect, card),
    context: { type: "card_activation" },
    effectLabel:
      effect.activationLabel || effect.promptMessage || effect.id || "effect",
    activationLabelKey: effect.activationLabelKey || null,
    ...input,
  };
}

/** Keep discovery and preparation mocks paired while preserving their contracts. */
export function installPreparedResponses(
  chain: ChainSystem,
  choose: (
    player: ChainPlayer | null | undefined,
    context: FastEffectContextInput | undefined,
  ) => ChainMaybePromise<PreparedActivation | null>,
): void {
  const preparations = new WeakMap<
    ChainActivationCandidate,
    PreparedActivation
  >();
  chain.offerChainResponse = async (player, context) => {
    const prepared = await choose(player, context);
    if (!prepared) return null;
    const candidate = createTestCandidate(
      chain,
      required(prepared.controller),
      {
        card: required(prepared.card),
        effect: required(prepared.effect),
        sourceZone: required(prepared.activationZone),
        context,
      },
    );
    preparations.set(candidate, prepared);
    return candidate;
  };
  chain.prepareChainResponse = async (candidate) => ({
    success: true,
    preparedActivation: required(preparations.get(candidate)),
  });
}
export interface TestPlayer extends ChainPlayer {
  id: PlayerId;
  hand: TestCard[];
  field: TestCard[];
  spellTrap: TestCard[];
  deck: TestCard[];
  extraDeck: TestCard[];
  graveyard: TestCard[];
  banished: TestCard[];
  fieldSpell: TestCard | null;
  oncePerDuelUsageByName: Record<string, number>;
}
type Selections = ChainSelectionMap & Record<string, ChainSelectionValue>;
type EmitOptions = { collectTriggersOnly?: boolean };
export interface TraceEvent {
  eventName: string;
  actionTypes?: string[];
  payload?: ChainEventPayload & Record<string, unknown>;
  options?: EmitOptions;
  channel?: string;
}
interface TraceMove {
  card: ChainCard;
  owner: ChainPlayer;
  fromZone: string | null | undefined;
  toZone: CanonicalZone;
  options: MoveOptions;
}
export interface HarnessTrace {
  actions: Array<{
    action: CardAction & { name?: string };
    ctx: ChainActionContext;
    targets: ChainSelectionMap;
  }>;
  moves: TraceMove[];
  events: TraceEvent[];
  logs: unknown[][];
  responses: Array<{
    type?: string;
    session?: ChainSelectionSessionInput;
    [key: string]: unknown;
  }>;
}
type MoveOptions = ChainMoveCardOptions & {
  wasDestroyed?: boolean;
  source?: ChainCard | null;
  actionContext?: PreparedActivationContext & {
    damageStepId?: number;
    isDamageStep?: boolean;
    damageStepTiming?: DamageStepTiming;
  };
};
type PipelineInput = ChainActivationPipelineInput & {
  selections?: ChainSelectionMap;
  activationContext?: PreparedActivationContext & {
    prepareOnly?: boolean;
    confirmed?: boolean;
  };
  onSuccess?: (
    result: ChainOperationResult,
    context: PreparedActivationContext,
  ) => unknown;
};
type PipelineResult = ChainOperationResult & { effect?: ChainEffect | null };
type HarnessEngine = Required<
  Pick<
    ChainEffectEnginePort,
    | "collectEventTriggers"
    | "resolveTargets"
    | "applyActions"
    | "checkActionPreviewRequirements"
    | "evaluateConditions"
    | "checkOncePerTurn"
    | "isEffectNegated"
  >
> & {
  checkOncePerDuel(
    card: ChainCard | null | undefined,
    owner: ChainPlayer,
    effect: ChainEffect,
  ): ChainUsageCheck;
};
export interface HarnessOptions {
  playerId?: PlayerId;
  botId?: PlayerId;
  playerControllerType?: string;
  botControllerType?: string;
  turn?: string;
  turnCounter?: number;
  phase?: string;
  responseTimeoutMs?: number;
  testMode?: boolean;
  ui?: ChainUiPort;
  onCollectEventTriggers?: HarnessEngine["collectEventTriggers"];
  onResolveTargets?: HarnessEngine["resolveTargets"];
  onActions?: (
    actions: readonly (CardAction & { name?: string })[],
    context: ChainActionContext,
    targets: ChainSelectionMap,
  ) => void | ChainOperationResult | Promise<void | ChainOperationResult>;
  onEmit?: (
    event: string,
    payload: ChainEventPayload,
    options: EmitOptions,
  ) =>
    | void
    | ChainTriggerCollectionResult
    | Promise<void | ChainTriggerCollectionResult>;
  onMove?: (move: TraceMove) => unknown;
  onStartTargetSelection?: (session: ChainSelectionSessionInput) => unknown;
  onFlushPendingTriggers?: (options: {
    reason?: string;
  }) => void | ChainOperationResult | Promise<void | ChainOperationResult>;
}
type UsageHost = ThisParameterType<typeof checkEffectUsage>;
type UsageResult = ReturnType<typeof checkEffectUsage>;
export interface HarnessGame extends ChainGamePort {
  gameOver?: boolean;
  battleStep?: string | null;
  isDisposed?(): boolean;
  guardActionStart?: import("../../../src/core/Game.js").default["guardActionStart"];
  getNextPhase?: import("../../../src/core/Game.js").default["getNextPhase"];
  checkAndOfferTraps?: import("../../../src/core/Game.js").default["checkAndOfferTraps"];
  devLog?: import("../../../src/core/Game.js").default["devLog"];
  clearAttackResolutionIndicators?(): void;
  clearAttackReadyIndicators?(): void;
  player: TestPlayer;
  bot: TestPlayer;
  turn: string;
  phase: string;
  turnCounter: number;
  disableChains: boolean;
  _flushingPendingTriggerOccurrences: boolean;
  nextEffectUsageReservationId: number;
  effectUsageReservations: UsageHost["effectUsageReservations"];
  ui: ChainUiPort;
  effectEngine: HarnessEngine;
  chainSystem?: ChainSystem;
  _turnUsage: Map<string, number>;
  getOncePerTurnLockKey(
    card: ChainCard | null | undefined,
    effect: ChainEffect,
  ): string;
  canUseOncePerTurn(
    card: ChainCard | null | undefined,
    owner: ChainPlayer,
    effect: ChainEffect,
  ): ChainUsageCheck;
  markOncePerTurnUsed(
    card: ChainCard | null | undefined,
    owner: ChainPlayer,
    effect: ChainEffect,
  ): void;
  getOpponent(owner: ChainPlayer | null): TestPlayer;
  emit(
    event: string,
    payload: ChainEventPayload,
    options?: EmitOptions,
  ): Promise<ChainTriggerCollectionResult>;
  notify(eventName: string, payload?: unknown): void;
  startTargetSelectionSession(session: ChainSelectionSessionInput): unknown;
  moveCard(
    card: ChainCard,
    owner: ChainPlayer,
    toZone: CanonicalZone,
    options?: MoveOptions,
  ): Promise<ChainOperationResult>;
  runActivationPipelineWait(config?: PipelineInput): Promise<PipelineResult>;
  flushPendingTriggerOccurrences(options?: {
    reason?: string;
  }): Promise<ChainOperationResult & { flushed?: number }>;
  getPublicState?(forPlayerId?: PlayerId): ReturnType<typeof getPublicState>;
}

const ARRAY_ZONES = [
  "hand",
  "field",
  "spellTrap",
  "graveyard",
  "banished",
  "deck",
  "extraDeck",
] as const;

export function createTestPlayer(
  id: PlayerId,
  controllerType = "human",
): TestPlayer {
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

export function createTestCard(
  overrides: Omit<Partial<TestCard>, "id" | "archetypes"> & {
    id?: number | string;
    archetypes?: readonly string[];
  } = {},
): TestCard {
  const legacyId = overrides.id ?? null;
  const id =
    typeof legacyId === "number"
      ? legacyId
      : unsafeFixture<TestCard["id"]>(
          legacyId,
          "Legacy Chain fixtures use null/string database IDs; their instance IDs provide source identity.",
        );
  const { id: _legacyId, archetypes, ...fields } = overrides;
  return {
    id,
    instanceId: overrides.instanceId ?? null,
    locationVersion: overrides.locationVersion ?? 0,
    name: overrides.name || "Test Card",
    owner: overrides.owner || null,
    cardKind: overrides.cardKind || "monster",
    subtype: overrides.subtype || null,
    isFacedown: overrides.isFacedown === true,
    effects: Array.isArray(overrides.effects) ? overrides.effects : [],
    ...fields,
    ...(archetypes ? { archetypes: [...archetypes] } : {}),
  };
}

export function createTestEffect(
  overrides: Partial<TestEffect> = {},
): TestEffect {
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

function removeCardFromPlayer(owner: ChainPlayer, card: ChainCard) {
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

export function placeCard<Value extends ChainCard>(
  owner: ChainPlayer,
  zone: CanonicalZone,
  card: Value,
): Value {
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

function collectRequirementCandidates(
  requirement: ChainEffectTarget,
  ctx: ChainActionContext,
) {
  const player = ctx?.player || null;
  const opponent = ctx?.opponent || null;
  const owners =
    requirement?.owner === "opponent"
      ? [opponent]
      : requirement?.owner === "any"
        ? [player, opponent]
        : [player];
  const zones: readonly CanonicalZone[] = Array.isArray(requirement?.zones)
    ? requirement.zones
    : [requirement?.zone || "field"];
  const candidates = [];

  for (const owner of owners.filter(
    (owner): owner is ChainPlayer => owner != null,
  )) {
    for (const zone of zones) {
      const zoneCards =
        zone === "fieldSpell"
          ? [owner.fieldSpell].filter((card): card is ChainCard => card != null)
          : Array.isArray(owner[zone])
            ? owner[zone]
            : [];
      for (const card of zoneCards) {
        if (requirement.excludeSelf === true && card === ctx?.source) continue;
        if (requirement.cardKind && card.cardKind !== requirement.cardKind)
          continue;
        if (requirement.requireFaceup && card.isFacedown === true) continue;
        if (
          requirement.excludeCannotBeSpecialSummoned &&
          "specialSummonOnlyBy" in card &&
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

function resolveTargetsForHarness(
  requirements: readonly ChainEffectTarget[] = [],
  ctx: ChainActionContext = {},
  selections: ChainSelectionMap | null = null,
): ChainTargetResolution {
  if (selections && typeof selections === "object") {
    return { ok: true, needsSelection: false, targets: selections };
  }

  const targets: Selections = {};
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

export function createChainHarness(options: HarnessOptions = {}) {
  const player = createTestPlayer(
    options.playerId || "player",
    options.playerControllerType || "human",
  );
  const bot = createTestPlayer(
    options.botId || "bot",
    options.botControllerType || "ai",
  );
  const trace: HarnessTrace = {
    actions: [],
    moves: [],
    events: [],
    logs: [],
    responses: [],
  };

  const game: HarnessGame = {
    player,
    bot,
    turn: options.turn || "player",
    turnCounter: options.turnCounter ?? 3,
    phase: options.phase || "main1",
    disableChains: false,
    _flushingPendingTriggerOccurrences: false,
    nextEffectUsageReservationId: 1,
    effectUsageReservations: new Map(),
    // The usage implementation accepts a full Game projection; this harness
    // supplies the smaller capability set used by these functions.
    checkEffectUsage(input) {
      return checkEffectUsage.call(
        game as UsageHost,
        input as Parameters<typeof checkEffectUsage>[0],
      );
    },
    reserveEffectUsage(input) {
      return reserveEffectUsage.call(
        game as UsageHost,
        unsafeFixture<Parameters<typeof reserveEffectUsage>[0]>(
          input,
          "The Chain harness supplies minimal card/player projections to the isolated usage service.",
        ),
      );
    },
    settleEffectUsage(reservation, outcome) {
      return settleEffectUsage.call(
        game as UsageHost,
        reservation as Parameters<typeof settleEffectUsage>[0],
        outcome,
      ) as ChainUsageReservation | null;
    },
    releaseEffectUsageReservations(reason) {
      releaseEffectUsageReservations.call(game as UsageHost, reason);
    },
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
        return { entries: [], orderRule: "harness", onComplete: null };
      },
      resolveTargets(requirements, ctx, selections) {
        if (typeof options.onResolveTargets === "function") {
          return options.onResolveTargets(requirements, ctx, selections);
        }
        return resolveTargetsForHarness(requirements, ctx, selections);
      },
      async applyActions(actions, ctx, targets) {
        for (const action of actions || []) {
          required(trace.actions).push({ action, ctx, targets });
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
        const used = Number(
          (owner as TestPlayer)?.oncePerDuelUsageByName?.[key!] || 0,
        );
        const limit = Number(effect.oncePerDuelLimit || 1);
        return used >= limit
          ? { ok: false, reason: "once per duel", used, limit, remaining: 0 }
          : { ok: true, used, limit, remaining: limit - used };
      },
      isEffectNegated(card) {
        return (card as TestCard)?.effectsNegated === true;
      },
    },
    async emit(eventName, payload, emitOptions = {}) {
      trace.events.push({
        eventName,
        payload: payload as TraceEvent["payload"],
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
      trace.events.push({
        eventName,
        payload: payload as TraceEvent["payload"],
        channel: "notify",
      });
      if (eventName === "chain_response")
        trace.responses.push(payload as HarnessTrace["responses"][number]);
    },
    startTargetSelectionSession(session) {
      trace.responses.push({ type: "selection", session });
      if (typeof options.onStartTargetSelection === "function") {
        return options.onStartTargetSelection(session);
      }
      const contract = session.selectionContract;
      const requirements =
        "requirements" in contract && Array.isArray(contract.requirements)
          ? contract.requirements
          : [];
      const selections = Object.fromEntries(
        requirements.map((requirement) => [
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
        moveOptions.fromZone ||
        game.chainSystem?.determineCardZone(card, owner);
      removeCardFromPlayer(owner, card);
      placeCard(owner, toZone, card);
      const locationVersion =
        fromZone && fromZone !== toZone
          ? bumpCardLocationVersion(card)
          : card.locationVersion;
      const sourceMovement = {
        fromPlayer: owner,
        toPlayer: owner,
        fromZone,
        toZone,
        locationVersion,
        wasDestroyed: moveOptions.wasDestroyed === true,
      };
      game.chainSystem?.recordChainSourceMovement?.(card, sourceMovement);
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
          actionContext: moveOptions.actionContext || null,
          damageStepId: moveOptions.actionContext?.damageStepId ?? null,
          damageStepTiming: moveOptions.actionContext?.damageStepTiming ?? null,
          isDamageStep: moveOptions.actionContext?.isDamageStep === true,
          wasDestroyed: moveOptions.wasDestroyed === true,
          movedByEffect: Boolean(
            moveOptions.sourceCard ||
              moveOptions.source ||
              moveOptions.effectId,
          ),
        };
        await game.emit("card_moved", payload, { collectTriggersOnly: true });
        if (toZone === "graveyard") {
          await game.emit("card_to_grave", payload, {
            collectTriggersOnly: true,
          });
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
      const preview: PipelineResult | undefined = await config.activate?.(
        config.selections || {},
        activationContext,
      );
      if (preview?.success === false || preview?.ok === false) return preview;
      const effect = preview?.effect || config.effect || null;
      const selections = preview?.targets || config.selections || {};
      const preparedActivation = game.chainSystem!.createPreparedActivation({
        card: config.card,
        controller: config.owner,
        effect,
        activationZone: config.activationZone,
        activationContext: {
          ...activationContext,
          prepareOnly: false,
          targetSelections: selections,
        } as PreparedActivationContext,
        selectionKind: config.selectionKind,
        targetSelections: selections,
        committed: true,
        costsPaid: true,
        pipelineManaged: true,
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
      if (game._flushingPendingTriggerOccurrences) {
        return { ok: true, flushed: 0, deferred: true };
      }
      let flushed = 0;
      let chainBuilt = false;
      game._flushingPendingTriggerOccurrences = true;
      try {
        while (game.chainSystem!.pendingTriggerOccurrences.length > 0) {
          const occurrences =
            game.chainSystem!.pendingTriggerOccurrences.splice(0);
          flushed += occurrences.length;
          const result = await game.chainSystem!.resolveTriggerOccurrences(
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
        game._flushingPendingTriggerOccurrences = false;
      }
    },
    updateBoard() {},
    checkWinCondition() {},
  };

  game.getPublicState = function getHarnessPublicState(forPlayerId) {
    return getPublicState.call(
      unsafeFixture<ThisParameterType<typeof getPublicState>>(
        this,
        "Serialization observes only state in this minimal Chain host; unrelated Game capabilities are absent.",
      ),
      forPlayerId,
    );
  };

  const chain = new ChainSystem(game, {
    responseTimeoutMs: options.responseTimeoutMs ?? 0,
  });
  game.chainSystem = chain;
  const selector = new AutoSelector(
    unsafeFixture<ConstructorParameters<typeof AutoSelector>[0]>(
      game,
      "The Chain fixture omits Player LP methods; AutoSelector only reads card/player state.",
    ),
  );
  game.autoSelector = unsafeFixture<NonNullable<ChainGamePort["autoSelector"]>>(
    selector,
    "Legacy Chain selection fixtures use minimal candidates at the AutoSelector boundary.",
  );

  return { chain, game, player, bot, trace };
}
