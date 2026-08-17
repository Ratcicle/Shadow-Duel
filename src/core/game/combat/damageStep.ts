import {
  DAMAGE_STEP_ACTIVATION_CATEGORIES,
  DAMAGE_STEP_TIMINGS,
} from "../spellTrap/quickSpellRules.js";
import type {
  ChainOperationResult,
  ChainRuntimePort,
  ChainRuntimeTriggerOccurrence,
  FastEffectContextInput,
} from "../../contracts/chainRuntime.js";
import type { DamageStepTiming } from "../../contracts/effects.js";
import type {
  DamageStepBuff,
  DamageStepCard,
  DamageStepCardInstanceId,
  DamageStepCardSnapshot,
  DamageStepDestructionCandidate,
  DamageStepExecutionResult,
  DamageStepLpChangePayload,
  DamageStepOutcome,
  DamageStepOutcomeSnapshot,
  DamageStepPreparationFailure,
  DamageStepState,
  DamageStepTransaction,
  DamageStepTransactionInput,
  DamageStepTransactionSnapshot,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { DamageStepId } from "../../contracts/primitives.js";
import type { CanonicalZone } from "../../contracts/zones.js";

export { DAMAGE_STEP_ACTIVATION_CATEGORIES, DAMAGE_STEP_TIMINGS };

const DAMAGE_STEP_SEQUENCE = Object.freeze([
  DAMAGE_STEP_TIMINGS.START,
  DAMAGE_STEP_TIMINGS.BEFORE_CALCULATION,
  DAMAGE_STEP_TIMINGS.CALCULATION,
  DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
  DAMAGE_STEP_TIMINGS.END,
]);

interface DamageStepWindowResult extends ChainOperationResult {
  occurrence?: ChainRuntimeTriggerOccurrence | null;
  resolutionResult?: { reason?: string | null } | null;
  timingRecovery?: DamageStepWindowResult | null;
  suppressed?: boolean;
}

interface DamageStepUiPort {
  log?(message: string): void;
  applyFlipAnimation?(ownerId: string | undefined, index: number): void;
}

interface DamageStepDestroyResult {
  destroyed?: boolean;
}

interface BattleDestructionContext {
  attacker: DamageStepCard;
  defender: DamageStepCard;
  target: DamageStepCard;
  battleOpponent: DamageStepCard;
  sourceCard: DamageStepCard;
}

interface BattleDamageOptions {
  sourceCard: DamageStepCard;
  targetCard: DamageStepCard | null;
  cause: "battle";
  directAttack: boolean;
  triggerOpponentDamage: false;
  suppressVisual: boolean;
}

interface DamageStepDestroyOptions {
  cause: "battle";
  sourceCard: DamageStepCard;
  fromZone: "field";
  battleDestructionDetermined: true;
  atomicGroupId: number | string;
  awaitCardToGraveEvent: true;
  awaitCardMovedEvent: true;
  contextLabel: "damage_step_battle_destruction";
  actionContext: {
    damageStepId: DamageStepId;
    damageStepTiming: DamageStepTiming;
    isDamageStep: true;
  };
}

type DamageStepEventPayload = ReturnType<typeof buildStagePayload> & {
  event?: string;
  addTriggerToChain?: false;
  battleDestroyer?: DamageStepCard;
  battleDestroyers?: DamageStepCard[];
  destroyed?: DamageStepCard;
  destroyedOwner?: GamePlayer;
  destroyedOwnerId?: string;
  destroyedPosition?: string | null;
};

interface DamageStepHost {
  player: GamePlayer;
  bot: GamePlayer;
  turnCounter: number;
  phase: string;
  battleStep: string | null;
  nextDamageStepId: number;
  activeDamageStepTransaction: DamageStepTransaction | null;
  lastDamageStepTransaction: DamageStepTransaction | null;
  damageStepProcedureDepth: number;
  damageCalculationTempBuffs: DamageStepBuff[];
  endOfDamageStepTempBuffs: DamageStepBuff[];
  damageCalculationStatChangePending: boolean;
  targetSelection: unknown;
  selectionState: string;
  pendingEventSelection: unknown;
  pendingTriggerSelection: unknown;
  chainSystem: ChainRuntimePort;
  effectEngine?: { clearTargetingCache?(): void } | null;
  ui?: DamageStepUiPort | null;
  getOpponent?(player: GamePlayer | null): GamePlayer | null;
  notify?(eventName: string, payload?: unknown): void;
  emit?(
    eventName: string,
    payload: DamageStepEventPayload,
    options?: { collectTriggersOnly?: boolean },
  ): Promise<DamageStepWindowResult | null | undefined>;
  checkAndOfferTraps?(
    eventName: string,
    payload: DamageStepEventPayload,
  ): Promise<DamageStepWindowResult | null | undefined>;
  updateBoard?(): unknown;
  waitForPresentationDelay?(delayMs: number): Promise<unknown>;
  inflictDamage?(
    player: GamePlayer,
    amount: number,
    options: BattleDamageOptions,
  ): unknown;
  markAttackUsed?(attacker: DamageStepCard, target: DamageStepCard | null): void;
  canDestroyByBattle?(
    card: DamageStepCard,
    context: BattleDestructionContext,
  ): boolean;
  isBattleDestructionProtected?(
    card: DamageStepCard,
    context: BattleDestructionContext,
  ): boolean;
  destroyCard?(
    card: DamageStepCard,
    options: DamageStepDestroyOptions,
  ): Promise<DamageStepDestroyResult | null | undefined>;
  clearDamageCalculationBuffs?(): void;
  clearEndOfDamageStepBuffs?(): void;
  checkWinCondition?(): unknown;
  cleanupDamageStepTransaction?(reason?: string): unknown;
  getDamageStepState?(): DamageStepState;
}

interface EndDamageStepOptions {
  resolveTriggers?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    const message = Reflect.get(error, "message");
    if (message) return message as string;
  }
  return fallback;
}

function getCardInstanceId(
  card: DamageStepCard | null | undefined,
): DamageStepCardInstanceId {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function cardSnapshot(
  card: DamageStepCard | null | undefined,
  owner: GamePlayer | null | undefined,
  zone: CanonicalZone = "field",
): DamageStepCardSnapshot | null {
  if (!card) return null;
  return {
    cardId: card.id ?? null,
    instanceId: getCardInstanceId(card),
    name: card.name || null,
    ownerId: owner?.id || card.owner || null,
    zone,
    locationVersion: Number(card.locationVersion ?? 0),
    position: card.position || null,
    faceDown: card.isFacedown === true,
  };
}

function serializeCardSnapshot(
  snapshot: DamageStepCardSnapshot | null | undefined,
  hidden = false,
): DamageStepCardSnapshot | null {
  if (!snapshot) return null;
  return {
    cardId: hidden ? null : snapshot.cardId,
    instanceId: hidden ? null : snapshot.instanceId,
    name: hidden ? null : snapshot.name,
    ownerId: snapshot.ownerId,
    zone: snapshot.zone,
    locationVersion: snapshot.locationVersion,
    position: snapshot.position,
    faceDown: snapshot.faceDown,
  };
}

function serializeOutcome(
  transaction: DamageStepTransaction | null | undefined,
): DamageStepOutcomeSnapshot {
  const outcome: Partial<DamageStepOutcome> = transaction?.outcome || {};
  return {
    committed: outcome.committed === true,
    battled: outcome.battled === true,
    damageDealt: Number(outcome.damageDealt || 0),
    damagedPlayerId: outcome.damagedPlayer?.id || null,
    healingApplied: Number(outcome.healingApplied || 0),
    targetDestroyed: outcome.targetDestroyed === true,
    attackerDestroyed: outcome.attackerDestroyed === true,
    destructionInstanceIds: (outcome.destructionCandidates || [])
      .map((entry) => getCardInstanceId(entry.card))
      .filter((id) => id !== null),
    movedAtEndInstanceIds: (outcome.movedAtEnd || [])
      .map((card) => getCardInstanceId(card))
      .filter((id) => id !== null),
  };
}

function serializeTransaction(
  transaction: DamageStepTransaction | null | undefined,
): DamageStepTransactionSnapshot | null {
  if (!transaction) return null;
  const defenderHidden =
    transaction.sourceAtStart?.defender?.faceDown === true &&
    transaction.revealedDefender !== true;
  return {
    damageStepId: transaction.damageStepId,
    status: transaction.status,
    timing: transaction.timing,
    sequenceIndex: DAMAGE_STEP_SEQUENCE.indexOf(
      transaction.timing as DamageStepTiming,
    ),
    directAttack: transaction.directAttack === true,
    attacker: serializeCardSnapshot(transaction.sourceAtStart.attacker)!,
    defender: serializeCardSnapshot(
      transaction.sourceAtStart.defender,
      defenderHidden,
    ),
    attackerOwnerId: transaction.attackerOwner?.id || null,
    defenderOwnerId: transaction.defenderOwner?.id || null,
    revealedDefender: transaction.revealedDefender === true,
    stoppedBeforeCalculation: transaction.stoppedBeforeCalculation === true,
    outcome: serializeOutcome(transaction),
    failureReason: transaction.failureReason || null,
  };
}

function nextDamageStepId(game: DamageStepHost): DamageStepId {
  if (!Number.isInteger(game.nextDamageStepId) || game.nextDamageStepId < 1) {
    game.nextDamageStepId = 1;
  }
  const id = game.nextDamageStepId as DamageStepId;
  game.nextDamageStepId += 1;
  return id;
}

function resolveOwner(
  game: DamageStepHost,
  card: DamageStepCard | null | undefined,
  explicitOwner: GamePlayer | null = null,
): GamePlayer | null {
  if (explicitOwner) return explicitOwner;
  if (!card) return null;
  return card.owner === game?.player?.id || card.owner === "player"
    ? game.player
    : game?.bot || null;
}

export function createDamageStepTransaction(
  this: DamageStepHost,
  input: DamageStepTransactionInput = {},
): DamageStepTransaction | DamageStepPreparationFailure {
  if (Object.hasOwn(input, "target")) {
    return { ok: false, reason: "removed_damage_step_target_field" };
  }
  const attacker = input.attacker || null;
  if (!attacker) {
    return { ok: false, reason: "missing_damage_step_attacker" };
  }
  if (this.activeDamageStepTransaction) {
    return { ok: false, reason: "damage_step_already_active" };
  }
  const defender = input.defender || null;
  const attackerOwner = resolveOwner(
    this,
    attacker,
    input.attackerOwner,
  ) as GamePlayer;
  const defenderOwner = defender
    ? resolveOwner(this, defender, input.defenderOwner)
    : input.defenderOwner || this.getOpponent?.(attackerOwner) || null;
  const transaction: DamageStepTransaction = {
    damageStepId: nextDamageStepId(this),
    status: "active",
    timing: null,
    directAttack: !defender,
    attacker,
    defender,
    attackerOwner,
    defenderOwner,
    damageOptions: {
      consumeBattleLpLossFeedback:
        typeof input.consumeBattleLpLossFeedback === "function"
          ? input.consumeBattleLpLossFeedback
          : null,
    },
    sourceAtStart: {
      attacker: cardSnapshot(attacker, attackerOwner)!,
      defender: cardSnapshot(defender, defenderOwner),
    },
    revealedDefender: false,
    stoppedBeforeCalculation: false,
    endFinalized: false,
    nextDestructionIndex: 0,
    destructionQueueStart: null,
    destructionAtomicGroupId: null,
    failureReason: null,
    outcome: {
      committed: false,
      battled: false,
      damageDealt: 0,
      damagedPlayer: null,
      healingApplied: 0,
      targetDestroyed: false,
      attackerDestroyed: false,
      destructionCandidates: [],
      movedAtEnd: [],
      lpChangePayload: null,
    },
  };
  this.activeDamageStepTransaction = transaction;
  this.battleStep = "damage";
  this.notify?.("damage_step_created", serializeTransaction(transaction));
  return transaction;
}

export function getDamageStepState(this: DamageStepHost): DamageStepState {
  return {
    active: this.activeDamageStepTransaction != null,
    transaction: serializeTransaction(this.activeDamageStepTransaction),
    last: serializeTransaction(this.lastDamageStepTransaction),
  };
}

function setDamageStepTiming(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  timing: DamageStepTiming,
): void {
  transaction.timing = timing;
  game.battleStep = "damage";
  game.notify?.("damage_step_timing", serializeTransaction(transaction));
}

function cardStillMatchesSnapshot(
  owner: GamePlayer | null | undefined,
  card: DamageStepCard | null | undefined,
  snapshot: DamageStepCardSnapshot | null | undefined,
): boolean {
  return (
    !!owner &&
    !!card &&
    !!snapshot &&
    Array.isArray(owner.field) &&
    owner.field.includes(card) &&
    Number(card.locationVersion ?? 0) === Number(snapshot.locationVersion ?? 0)
  );
}

function participantsRemainValid(transaction: DamageStepTransaction): boolean {
  const attackerValid = cardStillMatchesSnapshot(
    transaction.attackerOwner,
    transaction.attacker,
    transaction.sourceAtStart.attacker,
  );
  if (
    !attackerValid ||
    transaction.attacker.isFacedown === true ||
    transaction.attacker.position !== "attack"
  ) {
    return false;
  }
  if (transaction.directAttack) return true;
  return cardStillMatchesSnapshot(
    transaction.defenderOwner,
    transaction.defender,
    transaction.sourceAtStart.defender,
  );
}

function buildStagePayload(
  transaction: DamageStepTransaction,
  timing: DamageStepTiming,
  atomicGroupId: number | string | null,
) {
  const outcome = transaction.outcome;
  return {
    damageStepId: transaction.damageStepId,
    damageStepTiming: timing,
    isDamageStep: true,
    atomicGroupId,
    attacker: transaction.attacker,
    defender: transaction.defender,
    target: transaction.defender,
    attackerOwner: transaction.attackerOwner,
    defenderOwner: transaction.defenderOwner,
    targetOwner: transaction.defenderOwner,
    player: transaction.attackerOwner,
    triggerPlayer: transaction.attackerOwner,
    directAttack: transaction.directAttack,
    wasFacedownAtStart:
      transaction.sourceAtStart.defender?.faceDown === true,
    flippedCard: transaction.revealedDefender
      ? transaction.defender
      : null,
    damagedPlayer: outcome.damagedPlayer,
    amount: outcome.damageDealt,
    damageDealt: outcome.damageDealt,
    lpGained: Number(outcome.lpChangePayload?.lpGained || 0),
    before: outcome.lpChangePayload?.before ?? null,
    after: outcome.lpChangePayload?.after ?? null,
    sourceCard: outcome.lpChangePayload?.sourceCard || transaction.attacker,
    targetDestroyed: outcome.targetDestroyed,
    attackerDestroyed: outcome.attackerDestroyed,
    pendingBattleDestructionCards: outcome.destructionCandidates.map(
      (entry) => entry.card,
    ),
    actionContext: {
      type: "damage_step",
      event: "damage_step",
      damageStepId: transaction.damageStepId,
      damageStepTiming: timing,
      isDamageStep: true,
    },
  };
}

async function collectStageOccurrences(
  game: DamageStepHost,
  events: readonly string[],
  payload: ReturnType<typeof buildStagePayload>,
): Promise<ChainRuntimeTriggerOccurrence[]> {
  const occurrences: ChainRuntimeTriggerOccurrence[] = [];
  for (const eventName of events) {
    const result = await game.emit?.(
      eventName,
      { ...payload, event: eventName },
      { collectTriggersOnly: true },
    );
    if (result?.occurrence) occurrences.push(result.occurrence);
  }
  return occurrences;
}

async function resolveStageWindow(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  events: readonly string[],
): Promise<DamageStepWindowResult> {
  const atomicGroupId =
    game.chainSystem?.allocateAtomicEventGroupId?.() ||
    `damage_step:${transaction.damageStepId}:${transaction.timing}`;
  const payload = buildStagePayload(
    transaction,
    transaction.timing as DamageStepTiming,
    atomicGroupId,
  );
  const occurrences = await collectStageOccurrences(game, events, payload);
  let triggerResult = null;
  if (occurrences.length > 0) {
    triggerResult = await game.chainSystem?.resolveTriggerOccurrences?.(
      occurrences,
      {
        actionPlayer: transaction.attackerOwner,
        context: {
          ...payload,
          type: "damage_step",
          event: "damage_step",
        } as FastEffectContextInput,
      },
    );
    if (triggerResult?.needsSelection || triggerResult?.ok === false) {
      return triggerResult;
    }
  }
  if (triggerResult?.chainBuilt !== true) {
    return (
      (await game.checkAndOfferTraps?.("damage_step", {
        ...payload,
        addTriggerToChain: false,
      })) || { ok: true, chainBuilt: false }
    );
  }
  return triggerResult;
}

async function revealDefender(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
): Promise<void> {
  const card = transaction.defender;
  if (!card?.isFacedown) return;
  const field = transaction.defenderOwner?.field || [];
  const index = field.indexOf(card);
  game.ui?.applyFlipAnimation?.(transaction.defenderOwner?.id, index);
  card.isFacedown = false;
  card.revealedTurn = game.turnCounter;
  transaction.revealedDefender = true;
  game.effectEngine?.clearTargetingCache?.();
  game.ui?.log?.(`${card.name} was flipped!`);
  game.updateBoard?.();
  await game.waitForPresentationDelay?.(600);
}

function removeTrackedBuffs(
  game: DamageStepHost,
  key: "damageCalculationTempBuffs" | "endOfDamageStepTempBuffs",
): void {
  const buffs = Array.isArray(game[key]) ? game[key] : [];
  for (const buff of buffs.splice(0)) {
    const card = buff?.card;
    if (!card) continue;
    for (const stat of ["atk", "def"] as const) {
      const amount = Number(buff?.[stat] || 0);
      if (amount === 0) continue;
      const tempKey = stat === "atk" ? "tempAtkBoost" : "tempDefBoost";
      const tracked = Number(card[tempKey] || 0);
      const removable =
        tracked === 0
          ? amount
          : Math.abs(tracked) >= Math.abs(amount)
            ? amount
            : tracked;
      card[stat] = Math.max(0, Number(card[stat] || 0) - removable);
      card[tempKey] = tracked - removable;
    }
  }
}

export function clearDamageCalculationBuffs(this: DamageStepHost): void {
  removeTrackedBuffs(this, "damageCalculationTempBuffs");
  this.damageCalculationStatChangePending = false;
}

export function clearEndOfDamageStepBuffs(this: DamageStepHost): void {
  removeTrackedBuffs(this, "endOfDamageStepTempBuffs");
}

function getActualLpLoss(
  player: GamePlayer | null | undefined,
  amount: number,
): number {
  const value = Number(amount || 0);
  if (!player || value <= 0) return 0;
  return Math.max(0, Math.min(Number(player.lp || 0), value));
}

function calculatePiercingDamage(
  attacker: DamageStepCard | null | undefined,
  attackerAtk: number,
  targetDef: number,
): number {
  if (!attacker?.piercing) return 0;
  const multiplier = Number(attacker.piercingDamageMultiplier ?? 1);
  const normalized = Number.isFinite(multiplier) && multiplier > 0
    ? multiplier
    : 1;
  return Math.floor(Math.max(0, attackerAtk - targetDef) * normalized);
}

async function applyBattleLpChange(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  player: GamePlayer | null,
  cardInvolved: DamageStepCard | null,
  amount: number,
): Promise<number> {
  if (!player || amount <= 0) return 0;
  if (
    cardInvolved?.preventsBattleDamageToController === true &&
    player.id === cardInvolved.owner
  ) {
    return 0;
  }
  if (
    cardInvolved?.battleDamageHealsControllerThisTurn === true &&
    player.id === cardInvolved.owner
  ) {
    const before = Number(player.lp || 0);
    player.gainLP?.(amount, { cause: "battle", sourceCard: cardInvolved });
    const gained = Math.max(0, Number(player.lp || 0) - before);
    transaction.outcome.healingApplied += gained;
    if (gained > 0) {
      transaction.outcome.lpChangePayload = {
        player,
        sourceCard: cardInvolved,
        lpGained: gained,
        before,
        after: player.lp,
      };
    }
    return 0;
  }
  const actual = getActualLpLoss(player, amount);
  const before = Number(player.lp || 0);
  game.inflictDamage?.(player, amount, {
    sourceCard: transaction.attacker,
    targetCard: transaction.defender,
    cause: "battle",
    directAttack: transaction.directAttack,
    triggerOpponentDamage: false,
    suppressVisual:
      transaction.damageOptions.consumeBattleLpLossFeedback?.(
        player,
        amount,
      ) === true,
  });
  const applied = Math.max(0, before - Number(player.lp || 0));
  if (applied > 0) {
    transaction.outcome.damagedPlayer = player;
    transaction.outcome.damageDealt += Math.min(actual, applied);
  }
  return applied;
}

function addDestructionCandidate(
  transaction: DamageStepTransaction,
  card: DamageStepCard | null,
  owner: GamePlayer,
  sourceCard: DamageStepCard,
  role: "attacker" | "defender",
): void {
  if (!card || transaction.outcome.destructionCandidates.some(
    (entry) => entry.card === card,
  )) {
    return;
  }
  transaction.outcome.destructionCandidates.push({
    card,
    owner,
    sourceCard,
    role,
    position: card.position || null,
    locationVersion: Number(card.locationVersion ?? 0),
  });
  if (role === "attacker") transaction.outcome.attackerDestroyed = true;
  if (role === "defender") transaction.outcome.targetDestroyed = true;
}

function canBeDestroyedByBattle(
  game: DamageStepHost,
  card: DamageStepCard,
  opponent: DamageStepCard,
): boolean {
  const context = {
    attacker: opponent,
    defender: card,
    target: card,
    battleOpponent: opponent,
    sourceCard: opponent,
  };
  if (
    typeof game.canDestroyByBattle === "function" &&
    game.canDestroyByBattle(card, context) !== true
  ) {
    return false;
  }
  return game.isBattleDestructionProtected?.(card, context) !== true;
}

async function calculateBattleOutcome(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
): Promise<void> {
  const attacker = transaction.attacker;
  const defender = transaction.defender!;
  const outcome = transaction.outcome;
  outcome.committed = true;
  outcome.battled = true;

  if (transaction.directAttack) {
    await applyBattleLpChange(
      game,
      transaction,
      transaction.defenderOwner,
      attacker,
      Number(attacker.atk || 0),
    );
    game.markAttackUsed?.(attacker, null);
    return;
  }

  const attackerAtk = Number(attacker.atk || 0);
  const defenderAtk = Number(defender.atk || 0);
  const defenderDef = Number(defender.def || 0);
  const defenderInAttack = defender.position === "attack";

  if (defenderInAttack) {
    if (attackerAtk > defenderAtk) {
      await applyBattleLpChange(
        game,
        transaction,
        transaction.defenderOwner!,
        defender,
        attackerAtk - defenderAtk,
      );
      if (canBeDestroyedByBattle(game, defender, attacker)) {
        addDestructionCandidate(
          transaction,
          defender,
          transaction.defenderOwner!,
          attacker,
          "defender",
        );
      }
    } else if (attackerAtk < defenderAtk) {
      await applyBattleLpChange(
        game,
        transaction,
        transaction.attackerOwner,
        attacker,
        defenderAtk - attackerAtk,
      );
      if (canBeDestroyedByBattle(game, attacker, defender)) {
        addDestructionCandidate(
          transaction,
          attacker,
          transaction.attackerOwner,
          defender,
          "attacker",
        );
      }
    } else if (attackerAtk > 0) {
      if (canBeDestroyedByBattle(game, attacker, defender)) {
        addDestructionCandidate(
          transaction,
          attacker,
          transaction.attackerOwner,
          defender,
          "attacker",
        );
      }
      if (canBeDestroyedByBattle(game, defender, attacker)) {
        addDestructionCandidate(
          transaction,
          defender,
          transaction.defenderOwner!,
          attacker,
          "defender",
        );
      }
    }
  } else if (attackerAtk > defenderDef) {
    if (attacker.piercing) {
      await applyBattleLpChange(
        game,
        transaction,
        transaction.defenderOwner!,
        defender,
        calculatePiercingDamage(attacker, attackerAtk, defenderDef),
      );
    }
    if (canBeDestroyedByBattle(game, defender, attacker)) {
      addDestructionCandidate(
        transaction,
        defender,
        transaction.defenderOwner!,
        attacker,
        "defender",
      );
    }
  } else if (attackerAtk < defenderDef) {
    await applyBattleLpChange(
      game,
      transaction,
      transaction.attackerOwner,
      attacker,
      defenderDef - attackerAtk,
    );
  }
  game.markAttackUsed?.(attacker, defender);
}

async function resolveQueuedDestructionTriggers(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  queueStart: number,
): Promise<DamageStepWindowResult | null> {
  const queue = game.chainSystem?.pendingTriggerOccurrences;
  if (!Array.isArray(queue) || queue.length <= queueStart) return null;
  const occurrences = queue.splice(queueStart);
  return await game.chainSystem.resolveTriggerOccurrences(occurrences, {
    actionPlayer: transaction.attackerOwner,
    context: {
      ...buildStagePayload(
        transaction,
        DAMAGE_STEP_TIMINGS.END,
        occurrences[0]?.atomicGroupId || null,
      ),
      type: "damage_step",
      event: "battle_destroy",
    } as FastEffectContextInput,
    deferPostChainWindow: true,
  });
}

async function finalizeBattleDestruction(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  { resolveTriggers = true }: EndDamageStepOptions = {},
): Promise<DamageStepWindowResult> {
  if (transaction.endFinalized) return { ok: true };
  const queue = game.chainSystem?.pendingTriggerOccurrences;
  const queueStart = (Number.isInteger(transaction.destructionQueueStart)
    ? transaction.destructionQueueStart
    : Array.isArray(queue)
      ? queue.length
      : 0) as number;
  transaction.destructionQueueStart = queueStart;
  const atomicGroupId =
    transaction.destructionAtomicGroupId ||
    game.chainSystem?.allocateAtomicEventGroupId?.() ||
    `damage_step:${transaction.damageStepId}:destruction`;
  transaction.destructionAtomicGroupId = atomicGroupId;
  game.damageStepProcedureDepth = Number(game.damageStepProcedureDepth || 0) + 1;
  try {
    while (
      transaction.nextDestructionIndex <
      transaction.outcome.destructionCandidates.length
    ) {
      const entry =
        transaction.outcome.destructionCandidates[
          transaction.nextDestructionIndex
        ];
      if (
        !entry.owner?.field?.includes(entry.card) ||
        Number(entry.card.locationVersion ?? 0) !== entry.locationVersion
      ) {
        transaction.nextDestructionIndex += 1;
        continue;
      }
      const result = await game.destroyCard?.(entry.card, {
        cause: "battle",
        sourceCard: entry.sourceCard,
        fromZone: "field",
        battleDestructionDetermined: true,
        atomicGroupId,
        awaitCardToGraveEvent: true,
        awaitCardMovedEvent: true,
        contextLabel: "damage_step_battle_destruction",
        actionContext: {
          damageStepId: transaction.damageStepId,
          damageStepTiming: DAMAGE_STEP_TIMINGS.END,
          isDamageStep: true,
        },
      });
      if (result?.destroyed === true) {
        transaction.outcome.movedAtEnd.push(entry.card);
        await game.emit?.("battle_destroy", {
          ...buildStagePayload(
            transaction,
            DAMAGE_STEP_TIMINGS.END,
            atomicGroupId,
          ),
          attacker: entry.sourceCard,
          battleDestroyer: entry.sourceCard,
          battleDestroyers: [entry.sourceCard].filter(Boolean),
          destroyed: entry.card,
          destroyedOwner: entry.owner,
          destroyedOwnerId: entry.owner?.id || entry.card.owner,
          destroyedPosition: entry.position,
        });
      }
      transaction.nextDestructionIndex += 1;
    }
    transaction.endFinalized = true;
  } finally {
    game.damageStepProcedureDepth = Math.max(
      0,
      Number(game.damageStepProcedureDepth || 0) - 1,
    );
  }
  if (!resolveTriggers) {
    if (Array.isArray(queue) && queue.length > queueStart) {
      queue.splice(queueStart);
    }
    return { ok: true, suppressed: true };
  }
  return (
    (await resolveQueuedDestructionTriggers(game, transaction, queueStart)) ||
    { ok: true }
  );
}

async function runEndOfDamageStep(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  options: EndDamageStepOptions = {},
): Promise<DamageStepWindowResult> {
  setDamageStepTiming(game, transaction, DAMAGE_STEP_TIMINGS.END);
  const destructionResult = await finalizeBattleDestruction(
    game,
    transaction,
    options,
  );
  if (destructionResult?.needsSelection) {
    return destructionResult;
  }
  const destructionFailed = destructionResult?.ok === false;
  if (options.resolveTriggers !== false) {
    const windowResult = await resolveStageWindow(game, transaction, [
      "damage_step",
    ]);
    if (windowResult?.needsSelection) {
      return windowResult;
    }
    // Destruction Trigger Chains defer their post-Chain Fast Effect window so
    // the Damage Step can finish atomically. Even when one of those effects
    // fails, complete this final timing round before propagating the failure;
    // otherwise the ChainSystem remains stranded in `post_chain_check`.
    if (destructionFailed) {
      game.clearEndOfDamageStepBuffs?.();
      return {
        ...destructionResult,
        timingRecovery: windowResult || null,
      };
    }
    if (windowResult?.ok === false) return windowResult;
  }
  game.clearEndOfDamageStepBuffs?.();
  return destructionFailed ? destructionResult : { ok: true };
}

async function requireEndOfDamageStep(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
): Promise<DamageStepWindowResult> {
  const endResult = await runEndOfDamageStep(game, transaction);
  if (endResult?.needsSelection || endResult?.ok === false) {
    throw new Error(
      endResult?.reason ||
        endResult?.resolutionResult?.reason ||
        "damage_step_end_failed",
    );
  }
  return endResult;
}

export async function executeDamageStepTransaction(
  this: DamageStepHost,
  transaction: DamageStepTransaction | null | undefined,
): Promise<DamageStepExecutionResult> {
  if (!transaction || transaction !== this.activeDamageStepTransaction) {
    return { ok: false, reason: "damage_step_transaction_not_active" };
  }
  let result: DamageStepExecutionResult | null = null;
  try {
    setDamageStepTiming(this, transaction, DAMAGE_STEP_TIMINGS.START);
    let windowResult = await resolveStageWindow(this, transaction, [
      "damage_step",
    ]);
    if (windowResult?.needsSelection || windowResult?.ok === false) {
      throw new Error(windowResult?.reason || "damage_step_start_failed");
    }
    if (!participantsRemainValid(transaction)) {
      transaction.stoppedBeforeCalculation = true;
      await requireEndOfDamageStep(this, transaction);
    } else {
      setDamageStepTiming(
        this,
        transaction,
        DAMAGE_STEP_TIMINGS.BEFORE_CALCULATION,
      );
      await revealDefender(this, transaction);
      windowResult = await resolveStageWindow(
        this,
        transaction,
        transaction.directAttack
          ? ["damage_step"]
          : ["damage_step", "battle_damage"],
      );
      if (windowResult?.needsSelection || windowResult?.ok === false) {
        throw new Error(windowResult?.reason || "damage_step_before_failed");
      }
      if (!participantsRemainValid(transaction)) {
        transaction.stoppedBeforeCalculation = true;
        await requireEndOfDamageStep(this, transaction);
      } else {
        setDamageStepTiming(
          this,
          transaction,
          DAMAGE_STEP_TIMINGS.CALCULATION,
        );
        windowResult = await resolveStageWindow(this, transaction, [
          "damage_step",
        ]);
        if (windowResult?.needsSelection || windowResult?.ok === false) {
          throw new Error(
            windowResult?.reason || "damage_step_calculation_window_failed",
          );
        }
        if (!participantsRemainValid(transaction)) {
          transaction.stoppedBeforeCalculation = true;
          await requireEndOfDamageStep(this, transaction);
        } else {
          await calculateBattleOutcome(this, transaction);
          this.clearDamageCalculationBuffs?.();
          this.checkWinCondition?.();
          this.notify?.(
            "damage_step_outcome",
            serializeTransaction(transaction),
          );

          setDamageStepTiming(
            this,
            transaction,
            DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
          );
          const afterEvents = ["damage_step"];
          if (transaction.revealedDefender) afterEvents.push("card_flipped");
          if (transaction.outcome.damageDealt > 0) {
            afterEvents.push("battle_damage_inflicted");
          }
          if (transaction.outcome.lpChangePayload) afterEvents.push("lp_change");
          if (!transaction.directAttack) afterEvents.push("battle_completed");
          windowResult = await resolveStageWindow(
            this,
            transaction,
            afterEvents,
          );
          if (windowResult?.needsSelection || windowResult?.ok === false) {
            throw new Error(windowResult?.reason || "damage_step_after_failed");
          }
          await requireEndOfDamageStep(this, transaction);
        }
      }
    }

    transaction.status = "completed";
    result = {
      ok: true,
      success: true,
      damageStepId: transaction.damageStepId,
      damageDealt: transaction.outcome.damageDealt,
      targetDestroyed: transaction.outcome.targetDestroyed,
      attackerDestroyed: transaction.outcome.attackerDestroyed,
      stoppedBeforeCalculation: transaction.stoppedBeforeCalculation,
    };
    this.notify?.("damage_step_completed", serializeTransaction(transaction));
    return result;
  } catch (error: unknown) {
    transaction.status = "failed";
    transaction.failureReason = errorMessage(error, "damage_step_failed");
    if (transaction.outcome.committed && !transaction.endFinalized) {
      try {
        await runEndOfDamageStep(this, transaction, {
          resolveTriggers: false,
        });
      } catch (finalizationError: unknown) {
        transaction.failureReason = `${transaction.failureReason}; safe finalization failed: ${
          errorMessage(finalizationError, "unknown_error")
        }`;
      }
    }
    return {
      ok: false,
      success: false,
      damageStepId: transaction.damageStepId,
      reason: transaction.failureReason,
      damageDealt: transaction.outcome.damageDealt,
      targetDestroyed: transaction.outcome.targetDestroyed,
      attackerDestroyed: transaction.outcome.attackerDestroyed,
    };
  } finally {
    this.cleanupDamageStepTransaction?.(
      transaction.status === "completed" ? "completed" : "failed",
    );
  }
}

export function cleanupDamageStepTransaction(
  this: DamageStepHost,
  reason = "cleanup",
): DamageStepState {
  const transaction = this.activeDamageStepTransaction;
  if (transaction) {
    if (transaction.status === "active") {
      transaction.status = reason === "failed" ? "failed" : "cancelled";
      transaction.failureReason = reason;
    }
    this.lastDamageStepTransaction = transaction;
  }
  this.activeDamageStepTransaction = null;
  this.damageStepProcedureDepth = 0;
  this.battleStep = this.phase === "battle" ? "battle" : null;
  if (reason !== "completed") {
    this.targetSelection = null;
    this.selectionState = "idle";
    this.pendingEventSelection = null;
    this.pendingTriggerSelection = null;
    if (this.chainSystem) {
      this.chainSystem.pendingTriggerSelection = null;
    }
  }
  this.clearDamageCalculationBuffs?.();
  this.clearEndOfDamageStepBuffs?.();
  return this.getDamageStepState?.() || {
    active: false,
    transaction: null,
    last: serializeTransaction(transaction),
  };
}
