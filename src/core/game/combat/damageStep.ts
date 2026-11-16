import { DAMAGE_STEP_ACTIVATION_CATEGORIES } from "../spellTrap/quickSpellRules.js";
import { getActivePiercingMultiplier, hasActivePiercing } from "./availability.js";
import {
  BATTLE_PAIR_EFFECT_FINALIZATION,
  battlePairEffectApplies,
  type BattlePairEffect,
} from "./resolution.js";
import { isAI } from "../../Player.js";
import { DAMAGE_STEP_TIMINGS } from "../../contracts/effects.js";
import type { CardAction } from "../../contracts/actions.js";
import type {
  ChainOperationResult,
  ChainRuntimePort,
  ChainRuntimeTriggerOccurrence,
  FastEffectContextInput,
} from "../../contracts/chainRuntime.js";
import type { DamageStepTiming, EffectDefinition } from "../../contracts/effects.js";
import type {
  RawSelectionContract,
  SelectionResult,
  SelectionSessionInput,
} from "../../contracts/selection.js";
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
  deferLpChangeEvent: true;
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

/** A battle pair effect as `register_battle_pair_effect` registers it. */
interface BattlePairRegistration extends BattlePairEffect {
  controllerId?: string | null;
  opponentId?: string | null;
  source?: DamageStepCard | null;
  sourceEffectId?: string | null;
  firstTargetRef?: string | null;
  secondTargetRef?: string | null;
  affectedTargetRef?: string | null;
  affectedTarget?: DamageStepCard | null;
  actions?: readonly CardAction[] | null;
}

interface BattlePairActionResult {
  success?: boolean;
  needsSelection?: boolean;
  selectionContract?: RawSelectionContract | null;
  reason?: string | null;
}

/** The context a battle pair effect's actions resolve with. */
interface BattlePairActionContext {
  source: DamageStepCard | null;
  player: GamePlayer;
  opponent: GamePlayer;
  effect: EffectDefinition | null;
  effectId: string | null;
  attacker: DamageStepCard;
  attackerOwner: GamePlayer;
  defender: DamageStepCard | null;
  defenderOwner: GamePlayer | null;
  target: DamageStepCard | null;
  targetOwner: GamePlayer | null;
  isDamageStep: true;
  actionContext: ReturnType<typeof buildStagePayload>["actionContext"];
  activationContext: {
    effectId: string | null;
    autoSelectSingleTarget: boolean;
    autoSelectTargets: boolean;
  };
  selections?: SelectionResult;
}

interface DamageStepEffectEnginePort {
  clearTargetingCache?(): void;
  applyActions?(
    actions: readonly CardAction[],
    context: unknown,
    targets: unknown,
  ): Promise<BattlePairActionResult | boolean | null | undefined>;
}

/** A choice still unanswered after this many rounds ends its action. */
const BATTLE_PAIR_CHOICE_ROUNDS = 8;

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
  effectEngine?: DamageStepEffectEnginePort | null;
  temporaryBattlePairEffects?: Array<BattlePairRegistration | null> | null;
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
  markAttackUsed?(
    attacker: DamageStepCard,
    target: DamageStepCard | null,
  ): void;
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
  resolvePendingSpellTrapFinalization?(
    card: DamageStepCard,
    owner: GamePlayer,
    activationZone: "spellTrap",
    options: { deferUntil: typeof BATTLE_PAIR_EFFECT_FINALIZATION },
  ): Promise<boolean>;
  startTargetSelectionSession?(session: SelectionSessionInput): unknown;
  devLog?(code: string, detail?: unknown): void;
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
    duelCardId: card.duelCardId ?? null,
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
    duelCardId: hidden ? null : snapshot.duelCardId,
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
    destructionDuelCardIds: (outcome.destructionCandidates || [])
      .flatMap(({ card }) => card.duelCardId == null ? [] : [card.duelCardId]),
    movedAtEndDuelCardIds: (outcome.movedAtEnd || [])
      .flatMap(card => card.duelCardId == null ? [] : [card.duelCardId]),
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
    battleAttacker: transaction.attacker,
    battleAttackerOwner: transaction.attackerOwner,
    battleAttackerLocationVersion: transaction.sourceAtStart.attacker.locationVersion,
    defender: transaction.defender,
    target: transaction.defender,
    attackerOwner: transaction.attackerOwner,
    defenderOwner: transaction.defenderOwner,
    targetOwner: transaction.defenderOwner,
    player: transaction.attackerOwner,
    triggerPlayer: transaction.attackerOwner,
    directAttack: transaction.directAttack,
    wasFacedownAtStart: transaction.sourceAtStart.defender?.faceDown === true,
    flippedCard: transaction.revealedDefender ? transaction.defender : null,
    damagedPlayer: outcome.damagedPlayer,
    amount: outcome.damageDealt,
    damageDealt: outcome.damageDealt,
    lpChangePlayer: outcome.lpChangePayload?.player || null,
    lpGained: Number(outcome.lpChangePayload?.lpGained || 0),
    lpLost: Number(outcome.lpChangePayload?.lpLost || 0),
    lpPaid: Number(outcome.lpChangePayload?.lpPaid || 0),
    damageAmount: Number(outcome.lpChangePayload?.damageAmount || 0),
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
      { ...payload, event: eventName, ...(eventName === "lp_change" ? { player: payload.lpChangePlayer ?? payload.player } : {}) },
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

/** A stat reset ends registrations for that physical card's departed presence. */
export function retireDamageStepBuffsForCard(
  game: Pick<DamageStepHost, "damageCalculationTempBuffs" | "endOfDamageStepTempBuffs">,
  card: DamageStepCard,
): void {
  for (const buffs of [game.damageCalculationTempBuffs, game.endOfDamageStepTempBuffs]) {
    if (!Array.isArray(buffs)) continue;
    retireTrackedDamageStepBuffsForCard(buffs, card);
  }
}

export function retireTrackedDamageStepBuffsForCard(buffs: Array<{ card?: object | null }>, card: object): void {
  for (let index = buffs.length - 1; index >= 0; index -= 1) {
    if (buffs[index]?.card === card) buffs.splice(index, 1);
  }
}

/** Expiry receipts cannot consume a later modifier after their delta was removed. */
export function consumeTrackedDamageStepBuffs<Card extends object>(
  groups: readonly (Array<{ card?: Card | null; atk?: number; def?: number }> | undefined)[],
  card: Card,
  stat: "atk" | "def",
  amount: number,
  sameCard: (left: Card | null | undefined, right: Card) => boolean = (left, right) => left === right,
): void {
  let remaining = amount;
  for (const buffs of groups) {
    for (const buff of buffs || []) {
      if (!sameCard(buff.card, card) || remaining <= 0) continue;
      const tracked = Math.max(0, Number(buff[stat] || 0));
      const consumed = Math.min(tracked, remaining);
      buff[stat] = Number(buff[stat] || 0) - consumed;
      remaining -= consumed;
    }
  }
}

function removeTrackedBuffs(
  game: DamageStepHost,
  key: "damageCalculationTempBuffs" | "endOfDamageStepTempBuffs",
): void {
  const buffs = Array.isArray(game[key]) ? game[key] : [];
  removeTrackedDamageStepBuffs(buffs);
}

/** Shared removal of the actual, clamped stat deltas registered for a Damage Step. */
export function removeTrackedDamageStepBuffs(
  buffs: Array<{ card?: { atk?: number | undefined; def?: number | undefined;
    tempAtkBoost?: number | undefined; tempDefBoost?: number | undefined } | null;
    atk?: number; def?: number }>,
): void {
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
  const multiplier = getActivePiercingMultiplier(attacker);
  return Math.floor(Math.max(0, attackerAtk - targetDef) * multiplier);
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
  await game.inflictDamage?.(player, amount, {
    sourceCard: transaction.attacker,
    targetCard: transaction.defender,
    cause: "battle",
    directAttack: transaction.directAttack,
    deferLpChangeEvent: true,
    suppressVisual:
      transaction.damageOptions.consumeBattleLpLossFeedback?.(
        player,
        amount,
      ) === true,
  });
  const applied = Math.max(0, before - Number(player.lp || 0));
  if (applied > 0) {
    transaction.outcome.lpChangePayload = {
      player, sourceCard: transaction.attacker, before, after: player.lp,
      lpGained: 0, lpLost: applied, lpPaid: 0, damageAmount: applied,
    };
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
  if (
    !card ||
    transaction.outcome.destructionCandidates.some(
      (entry) => entry.card === card,
    )
  ) {
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
    if (hasActivePiercing(attacker)) {
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
  timing: DamageStepTiming = DAMAGE_STEP_TIMINGS.END,
  event = "battle_destroy",
): Promise<DamageStepWindowResult | null> {
  const queue = game.chainSystem?.pendingTriggerOccurrences;
  if (!Array.isArray(queue) || queue.length <= queueStart) return null;
  const occurrences = queue.splice(queueStart);
  return await game.chainSystem.resolveTriggerOccurrences(occurrences, {
    actionPlayer: transaction.attackerOwner,
    context: {
      ...buildStagePayload(
        transaction,
        timing,
        occurrences[0]?.atomicGroupId || null,
      ),
      type: "damage_step",
      event,
    } as FastEffectContextInput,
    deferPostChainWindow: true,
  });
}

function findPlayerById(
  game: DamageStepHost,
  playerId: string | null | undefined,
): GamePlayer | null {
  if (!playerId) return null;
  if (game.player?.id === playerId) return game.player;
  if (game.bot?.id === playerId) return game.bot;
  return null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof Reflect.get(value, "then") === "function"
  );
}

function asBattlePairActionResult(
  value: BattlePairActionResult | boolean | null | undefined,
): BattlePairActionResult {
  if (typeof value === "object" && value !== null) return value;
  return { success: value !== false };
}

/**
 * A choice an action asks its controller while its battle pair resolves. As in
 * a Chain Link's resolution, it is mandatory and never an activation target.
 * An AI controller's actions choose for themselves, so it is not asked here.
 */
function requestBattlePairChoice(
  game: DamageStepHost,
  source: DamageStepCard | null,
  controller: GamePlayer,
  contract: RawSelectionContract | null | undefined,
): Promise<SelectionResult | null> {
  if (
    !contract ||
    isAI(controller) ||
    typeof game.startTargetSelectionSession !== "function" ||
    contract.timing === "activation" ||
    contract.purpose === "target" ||
    contract.kind === "target"
  ) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (selections: SelectionResult | null): void => {
      if (settled) return;
      settled = true;
      resolve(selections);
    };
    const opened = game.startTargetSelectionSession?.({
      kind: contract.kind || "choice",
      owner: controller,
      card: source,
      selectionContract: {
        ...contract,
        timing: "resolution",
        purpose: "resolution",
        ui: { ...(contract.ui || {}), allowCancel: false, preventCancel: true },
      },
      message: contract.message || `Select target(s) for ${source?.name || "the battle"}`,
      allowCancel: false,
      preventCancel: true,
      execute: (selections) => {
        finish(selections);
        return { success: true, needsSelection: false };
      },
      onAbort: () => finish(null),
    });
    // A contract that opens no session is never answered.
    if (game.targetSelection == null && !isPromiseLike(opened)) finish(null);
  });
}

/**
 * The registration's actions, one at a time. A choice resumes only the action
 * that asked for it: an action that already resolved, such as a destruction,
 * is never applied again, and the Damage Step waits at its timing meanwhile.
 */
async function applyBattlePairActions(
  game: DamageStepHost,
  entry: BattlePairRegistration,
  controller: GamePlayer,
  ctx: BattlePairActionContext,
  targets: Readonly<Record<string, readonly DamageStepCard[]>>,
): Promise<void> {
  const engine = game.effectEngine;
  if (typeof engine?.applyActions !== "function") return;
  for (const action of entry.actions || []) {
    let result = asBattlePairActionResult(await engine.applyActions([action], ctx, targets));
    for (let round = 0; result.needsSelection && round < BATTLE_PAIR_CHOICE_ROUNDS; round += 1) {
      const selections = await requestBattlePairChoice(
        game,
        ctx.source,
        controller,
        result.selectionContract,
      );
      if (!selections) break;
      ctx.selections = { ...ctx.selections, ...selections };
      result = asBattlePairActionResult(await engine.applyActions([action], ctx, targets));
    }
    if (result.needsSelection || result.success === false) {
      game.devLog?.("BATTLE_PAIR_EFFECT_STOPPED", {
        summary: `${ctx.source?.name || "Battle pair effect"} stopped at ${action.type}`,
        action: action.type,
        needsSelection: result.needsSelection === true,
        reason: result.reason ?? null,
      });
      return;
    }
  }
}

function getBattlePairSourceEffect(
  entry: BattlePairRegistration,
): EffectDefinition | null {
  const effects = entry.source?.effects;
  if (!Array.isArray(effects) || !entry.sourceEffectId) return null;
  return effects.find((effect) => effect?.id === entry.sourceEffectId) || null;
}

/**
 * One registration. As in the contract removed in 3256e50, its actions apply
 * with the pair's targets while the monster it affects is still a monster on
 * the opponent's field. Its source then receives the finalization decided at
 * its activation even when they did not apply, so it never stays in its zone.
 */
async function applyBattlePairEffect(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  entry: BattlePairRegistration,
): Promise<void> {
  const source = entry.source ?? null;
  const controller =
    findPlayerById(game, entry.controllerId) || resolveOwner(game, source);
  if (!controller) return;
  const opponent =
    findPlayerById(game, entry.opponentId) || game.getOpponent?.(controller) || null;
  const first = entry.firstTarget ?? null;
  const second = entry.secondTarget ?? null;
  const affected = entry.affectedTarget ?? null;
  if (
    opponent &&
    first &&
    second &&
    affected?.cardKind === "monster" &&
    opponent.field.includes(affected)
  ) {
    game.ui?.log?.(`${source?.name || "A battle pair effect"} applies to this battle.`);
    const timing = transaction.timing as DamageStepTiming;
    const ctx: BattlePairActionContext = {
      source,
      player: controller,
      opponent,
      effect: getBattlePairSourceEffect(entry),
      effectId: entry.sourceEffectId ?? null,
      attacker: transaction.attacker,
      attackerOwner: transaction.attackerOwner,
      defender: transaction.defender,
      defenderOwner: transaction.defenderOwner,
      target: transaction.defender,
      targetOwner: transaction.defenderOwner,
      isDamageStep: true,
      actionContext: buildStagePayload(transaction, timing, null).actionContext,
      activationContext: {
        effectId: entry.sourceEffectId ?? null,
        autoSelectSingleTarget: isAI(controller),
        autoSelectTargets: isAI(controller),
      },
    };
    const targets: Record<string, readonly DamageStepCard[]> = {
      battle_pair_first: [first],
      battle_pair_second: [second],
      battle_pair_affected: [affected],
    };
    if (entry.firstTargetRef) targets[entry.firstTargetRef] = [first];
    if (entry.secondTargetRef) targets[entry.secondTargetRef] = [second];
    if (entry.affectedTargetRef) targets[entry.affectedTargetRef] = [affected];
    await applyBattlePairActions(game, entry, controller, ctx, targets);
    game.updateBoard?.();
    game.checkWinCondition?.();
  } else {
    game.devLog?.("BATTLE_PAIR_EFFECT_WITHOUT_TARGET", {
      summary: `${source?.name || "Battle pair effect"}: the affected monster left the opponent's field`,
      timing: transaction.timing,
    });
  }
  if (source) {
    await game.resolvePendingSpellTrapFinalization?.(source, controller, "spellTrap", {
      deferUntil: BATTLE_PAIR_EFFECT_FINALIZATION,
    });
  }
}

/**
 * The battle pair effects registered for this battle at the current timing,
 * consumed from the registry before any of them runs, so each applies once.
 */
function takeBattlePairEffects(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
): BattlePairRegistration[] {
  const registrations = game.temporaryBattlePairEffects;
  if (transaction.directAttack || !Array.isArray(registrations)) return [];
  const timing = transaction.timing as DamageStepTiming;
  const turnCounter = Number(game.turnCounter || 0);
  const applicable = registrations.filter(
    (entry): entry is BattlePairRegistration =>
      battlePairEffectApplies(entry, turnCounter, transaction.attacker, transaction.defender, timing),
  );
  if (applicable.length > 0) {
    game.temporaryBattlePairEffects = registrations.filter(
      (entry) => !entry || !applicable.includes(entry),
    );
  }
  return applicable;
}

/**
 * Phase 2.3 L25b: battle pair effects (`register_battle_pair_effect`) apply
 * when their pair battles, as the Damage Step timing each one declares
 * begins. Their movements are queued as the Damage Step's own procedure and
 * resolve as one trigger opportunity, as the end of the Damage Step does for
 * battle destruction.
 */
async function resolveBattlePairEffects(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  applicable: readonly BattlePairRegistration[],
): Promise<DamageStepWindowResult | null> {
  const timing = transaction.timing as DamageStepTiming;
  const queue = game.chainSystem?.pendingTriggerOccurrences;
  const queueStart = Array.isArray(queue) ? queue.length : 0;
  game.damageStepProcedureDepth = Number(game.damageStepProcedureDepth || 0) + 1;
  try {
    for (const entry of applicable) {
      await applyBattlePairEffect(game, transaction, entry);
    }
  } finally {
    game.damageStepProcedureDepth = Math.max(
      0,
      Number(game.damageStepProcedureDepth || 0) - 1,
    );
  }
  return await resolveQueuedDestructionTriggers(
    game,
    transaction,
    queueStart,
    timing,
    "damage_step",
  );
}

/**
 * A timing whose battle pair effects apply as it begins. Their trigger
 * opportunity defers its post-Chain window to this timing's own window, which
 * therefore opens even when one of those effects failed, as at the end of the
 * Damage Step; the failure is propagated after it.
 */
async function resolveTimingWithBattlePairEffects(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  applicable: readonly BattlePairRegistration[],
  events: readonly string[],
): Promise<DamageStepWindowResult> {
  const pairResult = await resolveBattlePairEffects(game, transaction, applicable);
  if (pairResult?.needsSelection) return pairResult;
  const windowResult = await resolveStageWindow(game, transaction, events);
  if (
    pairResult?.ok !== false ||
    windowResult?.needsSelection ||
    windowResult?.ok === false
  ) {
    return windowResult;
  }
  return { ...pairResult, timingRecovery: windowResult };
}

/**
 * The window of a timing at which battle pair effects can apply. Without one
 * for this battle, it is the stage window itself, with no added step.
 */
function resolvePairTimingWindow(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  events: readonly string[],
): Promise<DamageStepWindowResult> {
  const applicable = takeBattlePairEffects(game, transaction);
  return applicable.length > 0
    ? resolveTimingWithBattlePairEffects(game, transaction, applicable, events)
    : resolveStageWindow(game, transaction, events);
}

async function finalizeBattleDestruction(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
  { resolveTriggers = true }: EndDamageStepOptions = {},
): Promise<DamageStepWindowResult> {
  if (transaction.endFinalized) return { ok: true };
  const queue = game.chainSystem?.pendingTriggerOccurrences;
  const queueStart = (
    Number.isInteger(transaction.destructionQueueStart)
      ? transaction.destructionQueueStart
      : Array.isArray(queue)
        ? queue.length
        : 0
  ) as number;
  transaction.destructionQueueStart = queueStart;
  const atomicGroupId =
    transaction.destructionAtomicGroupId ||
    game.chainSystem?.allocateAtomicEventGroupId?.() ||
    `damage_step:${transaction.damageStepId}:destruction`;
  transaction.destructionAtomicGroupId = atomicGroupId;
  game.damageStepProcedureDepth =
    Number(game.damageStepProcedureDepth || 0) + 1;
  try {
    while (
      transaction.nextDestructionIndex <
      transaction.outcome.destructionCandidates.length
    ) {
      const entry =
        transaction.outcome.destructionCandidates[
          transaction.nextDestructionIndex
        ]!; // The sequential cursor is bounded by destructionCandidates.length.
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
          // battle_destroy uses `attacker` for the battle destroyer, including
          // a defending monster that defeated the original attacker.
          attackerOwner:
            entry.role === "attacker"
              ? transaction.defenderOwner! // Battle destruction requires a defender and its owner.
              : transaction.attackerOwner,
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
    (await resolveQueuedDestructionTriggers(game, transaction, queueStart)) || {
      ok: true,
    }
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

/**
 * Phase 2.3 L25b: an attack that stops before damage calculation was still
 * declared, so the attacker that declared it consumes it, as when an attack
 * stops in the Battle Step and as in the contract removed in 3256e50. An
 * attacker that left the field, even to return as a new card, has no attack
 * to consume.
 */
async function stopBeforeDamageCalculation(
  game: DamageStepHost,
  transaction: DamageStepTransaction,
): Promise<void> {
  transaction.stoppedBeforeCalculation = true;
  if (
    cardStillMatchesSnapshot(
      transaction.attackerOwner,
      transaction.attacker,
      transaction.sourceAtStart.attacker,
    )
  ) {
    game.markAttackUsed?.(transaction.attacker, transaction.defender);
  }
  await requireEndOfDamageStep(game, transaction);
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
    let windowResult = await resolvePairTimingWindow(this, transaction, [
      "damage_step",
    ]);
    if (windowResult?.needsSelection || windowResult?.ok === false) {
      throw new Error(windowResult?.reason || "damage_step_start_failed");
    }
    if (!participantsRemainValid(transaction)) {
      await stopBeforeDamageCalculation(this, transaction);
    } else {
      setDamageStepTiming(
        this,
        transaction,
        DAMAGE_STEP_TIMINGS.BEFORE_CALCULATION,
      );
      await revealDefender(this, transaction);
      windowResult = await resolvePairTimingWindow(
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
        await stopBeforeDamageCalculation(this, transaction);
      } else {
        setDamageStepTiming(this, transaction, DAMAGE_STEP_TIMINGS.CALCULATION);
        windowResult = await resolveStageWindow(this, transaction, [
          "damage_step",
        ]);
        if (windowResult?.needsSelection || windowResult?.ok === false) {
          throw new Error(
            windowResult?.reason || "damage_step_calculation_window_failed",
          );
        }
        if (!participantsRemainValid(transaction)) {
          await stopBeforeDamageCalculation(this, transaction);
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
          if (transaction.outcome.lpChangePayload)
            afterEvents.push("lp_change");
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
        transaction.failureReason = `${transaction.failureReason}; safe finalization failed: ${errorMessage(
          finalizationError,
          "unknown_error",
        )}`;
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
  return (
    this.getDamageStepState?.() || {
      active: false,
      transaction: null,
      last: serializeTransaction(transaction),
    }
  );
}
