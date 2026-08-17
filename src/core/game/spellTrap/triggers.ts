// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/triggers.js
// Spell/Trap trigger methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

import { FAST_EFFECT_ORIGINS } from "../../chain/timing.js";
import { isChainContextType } from "../../contracts/chain.js";
import type { ChainContextType, FastEffectOrigin } from "../../contracts/chain.js";
import type { MaybePromise } from "../../contracts/actionRuntime.js";
import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";

interface TrapEventData {
  addTriggerToChain?: boolean;
  attacker?: GameCard | null;
  defender?: GameCard | null;
  target?: GameCard | null;
  attackerOwner?: GamePlayer | null;
  defenderOwner?: GamePlayer | null;
  targetOwner?: GamePlayer | null;
  player?: GamePlayer | null;
  phase?: string | null;
  currentPhase?: string | null;
  fromPhase?: string | null;
  toPhase?: string | null;
  nextPhase?: string | null;
  battleStep?: string | null;
  damageStepTiming?: string | null;
  isDamageStep?: boolean;
  isOpponentAttack?: boolean;
  attackRedirect?: unknown;
  redirectedTarget?: GameCard | null;
  redirectedTargetOwner?: GamePlayer | null;
  trigger?: string | null;
  eventType?: string | null;
  chainLink?: object | null;
}

interface TrapTimingContext extends TrapEventData {
  type: ChainContextType;
  event: string;
  openState: true;
  legalWindow: true;
  phase: string | null;
  currentPhase: string | null;
  fromPhase: string | null;
  toPhase: string | null;
  battleStep: string | null;
  damageStepTiming: string | null;
  isDamageStep: boolean;
  attacker: GameCard | null;
  defender: GameCard | null;
  target: GameCard | null;
  attackerOwner: GamePlayer | null;
  defenderOwner: GamePlayer | null;
  targetOwner: GamePlayer | null;
  isOpponentAttack: boolean;
  addTriggerToChain: boolean;
  triggerPlayer: GamePlayer;
}

interface TrapTimingResult {
  ok?: boolean;
  success?: boolean;
  needsSelection?: boolean;
  reason?: string | null;
}

interface TrapChainPort {
  isChainResolving(): boolean;
  isChainWindowOpen?(): boolean;
  createTriggerOccurrence?(
    event: string,
    payload: TrapEventData,
    options: {
      entries: readonly [];
      entriesProvided: true;
      orderRule: "deferred_response_window";
    },
  ): unknown;
  runFastEffectTiming(input: {
    origin: FastEffectOrigin;
    context: TrapTimingContext;
    actionPlayer: GamePlayer;
    priorityPlayer: GamePlayer | null | undefined;
    phaseIntent: { fromPhase: string | null; toPhase: string | null } | null;
  }): MaybePromise<TrapTimingResult>;
}

interface TrapTriggerHost {
  player: GamePlayer;
  bot: GamePlayer;
  turn: "player" | "bot";
  phase?: string | null;
  battleStep?: string | null;
  activeDamageStepTransaction?: { timing?: string | null } | null;
  disableTraps: boolean;
  disableChains: boolean;
  chainSystem: TrapChainPort;
  effectEngine: {
    resolveTrapEffects(
      card: GameCard,
      player: GamePlayer,
      eventData: TrapEventData,
    ): MaybePromise<unknown>;
  };
  ui: { log(message: string): void };
  devLog?(code: string, detail: { summary: string }): void;
  queueTriggerOccurrence?(occurrence: unknown): unknown;
  _mapEventToChainContext(event: string): ChainContextType;
  getOpponent?(player: GamePlayer): GamePlayer | null;
  guardActionStart(input: {
    actor: GamePlayer;
    kind: "trap_activation";
    allowDuringOpponentTurn: true;
    allowDuringResolving: true;
  }): { ok: boolean; reason?: string };
  emit(
    eventName: "trap_activated",
    payload: {
      card: GameCard;
      player: GamePlayer;
      trigger?: string | null;
      chainLink?: object | null;
    },
  ): MaybePromise<unknown>;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: "graveyard",
    options: { fromZone: "spellTrap" },
  ): MaybePromise<unknown>;
  updateBoard(): void;
}

/**
 * Check and offer trap activations in response to an event.
 * Opens a chain window if activatable traps exist.
 * @param {string} event - The event that triggered this check.
 * @param eventData - Data associated with the event.
 * @returns Fast Effect Timing result.
 */
export async function checkAndOfferTraps(
  this: TrapTriggerHost,
  event: string,
  eventData: TrapEventData = {},
) {
  this.devLog?.("CHECK_TRAPS", { summary: `Called for event: ${event}` });
  if (!this.player || this.disableTraps || this.disableChains) {
    this.devLog?.("CHECK_TRAPS", {
      summary: `Early exit: player=${!!this.player}, disableTraps=${this.disableTraps}, disableChains=${this.disableChains}`,
    });
    return;
  }

  // Se o ChainSystem já está resolvendo, não interromper
  if (this.chainSystem?.isChainResolving()) {
    const occurrence = this.chainSystem.createTriggerOccurrence?.(
      event,
      { ...(eventData || {}) },
      {
        entries: [],
        entriesProvided: true,
        orderRule: "deferred_response_window",
      },
    );
    this.queueTriggerOccurrence?.(occurrence);
    this.devLog?.("CHECK_TRAPS", { summary: "Skipped: chain is resolving" });
    return;
  }

  // Prevenir abrir nova chain window enquanto outra já está aberta
  if (this.chainSystem?.isChainWindowOpen?.()) {
    this.devLog?.("CHECK_TRAPS", {
      summary: "Skipped: chain window already open",
    });
    return;
  }

  this.devLog?.("CHECK_TRAPS", {
    summary: "Proceeding to open chain window",
  });
  try {
    // Mapear evento para contexto de chain
    const contextType = this._mapEventToChainContext(event);
    const addTriggerToChain =
      typeof eventData.addTriggerToChain === "boolean"
        ? eventData.addTriggerToChain
        : contextType !== "card_activation" &&
          contextType !== "effect_activation";

    // Usar ChainSystem para abrir chain window
    const attacker = eventData.attacker || null;
    const defender = eventData.defender ?? eventData.target ?? null;
    const attackerOwner =
      eventData.attackerOwner ??
      (attacker
        ? attacker.owner === "player"
          ? this.player
          : this.bot
        : null);
    const defenderOwner =
      eventData.defenderOwner ??
      (defender
        ? defender.owner === "player"
          ? this.player
          : this.bot
        : null);

    const context: TrapTimingContext = {
      type: contextType,
      event,
      ...eventData,
      openState: true,
      legalWindow: true,
      phase: eventData.phase ?? this.phase ?? null,
      currentPhase: eventData.currentPhase ?? this.phase ?? null,
      fromPhase: eventData.fromPhase ?? eventData.currentPhase ?? null,
      toPhase:
        eventData.toPhase ??
        eventData.nextPhase ??
        eventData.currentPhase ??
        null,
      battleStep: eventData.battleStep ?? this.battleStep ?? null,
      damageStepTiming:
        eventData.damageStepTiming ??
        this.activeDamageStepTransaction?.timing ??
        null,
      isDamageStep:
        eventData.isDamageStep === true ||
        contextType === "battle_damage" ||
        eventData.damageStepTiming != null ||
        this.activeDamageStepTransaction?.timing != null,
      attacker,
      defender,
      target: defender ?? eventData.target ?? null,
      attackerOwner,
      defenderOwner,
      targetOwner: eventData.targetOwner ?? defenderOwner ?? null,
      isOpponentAttack:
        eventData.isOpponentAttack ??
        (attackerOwner && defenderOwner
          ? attackerOwner.id !== defenderOwner.id
          : false),
      addTriggerToChain,
      triggerPlayer:
        attackerOwner ||
        eventData.player ||
        (this.turn === "player" ? this.player : this.bot),
    };

    // A máquina consulta os candidatos somente na vez de cada jogador.
    this.devLog?.("CHECK_TRAPS", {
      summary: "Opening chain window via ChainSystem",
    });
    const origin =
      event === "phase_start"
        ? FAST_EFFECT_ORIGINS.PHASE_START
        : event === "phase_end"
          ? FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT
          : event === "summon_attempt"
            ? FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT
            : FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN;
    const actionPlayer =
      eventData.player ||
      eventData.attackerOwner ||
      (this.turn === "player" ? this.player : this.bot);
    const result = await this.chainSystem.runFastEffectTiming({
      origin,
      context,
      actionPlayer,
      priorityPlayer:
        origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT
          ? this.getOpponent?.(actionPlayer)
          : null,
      phaseIntent:
        origin === FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT
          ? {
              fromPhase: context.fromPhase,
              toPhase: context.toPhase,
            }
          : null,
    });
    if (context.attackRedirect) {
      eventData.attackRedirect = context.attackRedirect;
    }
    if (context.redirectedTarget) {
      eventData.redirectedTarget = context.redirectedTarget;
    }
    if (context.redirectedTargetOwner) {
      eventData.redirectedTargetOwner = context.redirectedTargetOwner;
    }
    return result;
  } finally {
    this.devLog?.("CHECK_TRAPS", { summary: "Timing coordinator complete" });
  }
}

/**
 * Map game events to chain context types.
 * @param {string} event - The event name.
 * @returns {string} Chain context type.
 */
export function _mapEventToChainContext(
  this: TrapTriggerHost,
  event: string,
): ChainContextType {
  const eventToContext = {
    attack_declared: "attack_declaration",
    battle_step_open: "battle_step_open",
    summon_attempt: "summon_attempt",
    after_summon: "summon",
    phase_end: "phase_change",
    phase_start: "phase_change",
    card_activation: "card_activation",
    effect_activation: "effect_activation",
    battle_damage: "battle_damage",
    damage_step: "damage_step",
    battle_damage_inflicted: "damage_step",
    card_flipped: "damage_step",
    battle_destroy: "battle_destroy",
    effect_targeted: "effect_targeted",
    card_set: "action_without_chain",
    normal_draw: "action_without_chain",
    position_change: "action_without_chain",
  };
  const contextType = Reflect.get(eventToContext, event);
  return isChainContextType(contextType)
    ? contextType
    : "action_without_chain";
}

/**
 * Activates a trap card from the spell/trap zone.
 * @param {Card} card - The trap card to activate.
 * @param eventData - Context data for the activation.
 * @returns Activation result.
 */
export async function activateTrapFromZone(
  this: TrapTriggerHost,
  card: GameCard | null | undefined,
  eventData: TrapEventData = {},
) {
  if (!card || card.cardKind !== "trap") return;

  const trapIndex = this.player.spellTrap.indexOf(card);
  if (trapIndex === -1) return;

  const guard = this.guardActionStart({
    actor: this.player,
    kind: "trap_activation",
    allowDuringOpponentTurn: true,
    allowDuringResolving: true,
  });
  if (!guard.ok) return guard;

  // Virar a carta face-up
  card.isFacedown = false;
  this.ui.log(`${this.player.name} ativa ${card.name}!`);

  // Emitir evento para captura de replay
  this.emit("trap_activated", {
    card,
    player: this.player,
    trigger: eventData.trigger || eventData.eventType,
    chainLink: eventData.chainLink,
  });

  // Resolver efeitos
  const result = await this.effectEngine.resolveTrapEffects(
    card,
    this.player,
    eventData
  );

  // Se for trap normal, mover para o cemitério após resolver
  if (card.subtype === "normal") {
    this.moveCard(card, this.player, "graveyard", { fromZone: "spellTrap" });
  }
  // Se for continuous, permanece no campo face-up

  this.updateBoard();
  return result;
}
