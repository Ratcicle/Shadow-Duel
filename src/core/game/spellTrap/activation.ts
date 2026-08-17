// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/activation.js
// Spell/Trap activation methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

import {
  canActivateSetQuickSpell,
  canActivateQuickSpellFromHand,
  isQuickSpell,
} from "./quickSpellRules.js";
import type { QuickSpellContext } from "./quickSpellRules.js";
import { getUIText } from "../../i18n.js";
import type { MaybePromise } from "../../contracts/actionRuntime.js";
import type { GameCard } from "../../contracts/cards.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { CanonicalSelectionMap } from "../../contracts/selection.js";

type SpellTrapActivationZone = "hand" | "spellTrap" | "fieldSpell";

interface ActivationResult {
  ok?: boolean;
  success?: boolean;
  needsSelection?: boolean;
  placementOnly?: boolean;
  reason?: string | null;
  code?: string;
  cancelled?: boolean;
}

interface ActivationCommitInfo {
  cardRef: GameCard;
  activationZone: "spellTrap" | "fieldSpell";
  fromIndex: number;
  zoneIndex?: number | null;
  replacedFieldSpell?: GameCard | null;
}

interface SpellTrapActivationContext {
  fromHand?: boolean;
  activationZone?: SpellTrapActivationZone | null;
  sourceZone?: SpellTrapActivationZone;
  committed?: boolean;
  commitInfo?: ActivationCommitInfo | null;
  actionContext?: unknown;
  effectId?: string | null;
  chainId?: number | null;
  linkId?: number | null;
  autoSelectSingleTarget?: boolean;
  trapActivationFromSet?: boolean;
  quickSpellActivationFromSet?: boolean;
  quickSpellContext?: QuickSpellContext | null;
}

interface ActionGuardConfig {
  actor: GamePlayer;
  kind: string;
  phaseReq: readonly string[] | null;
}

interface ActivationPipelineInfo {
  card: GameCard;
  owner: GamePlayer;
  activationZone: "spellTrap" | "fieldSpell";
  activationContext: SpellTrapActivationContext;
}

interface SpellTrapPipelineConfig {
  card: GameCard;
  owner: GamePlayer;
  activationZone?: "spellTrap" | "fieldSpell";
  activationContext: SpellTrapActivationContext;
  selections?: CanonicalSelectionMap | null;
  selectionKind: "spellTrapEffect" | "fieldSpell";
  selectionMessage: string;
  guardKind: string;
  phaseReq: readonly string[] | null;
  gate?: (() => MaybePromise<ActivationResult | boolean>) | null;
  preview?: (() => MaybePromise<ActivationResult | null | undefined>) | null;
  commit?: (() => MaybePromise<ActivationCommitInfo | null>) | null;
  oncePerTurn: {
    card: GameCard;
    player: GamePlayer;
    effect: EffectDefinition | null | undefined;
  };
  activate(
    selections: CanonicalSelectionMap | null,
    context: SpellTrapActivationContext,
    zone: "spellTrap" | "fieldSpell",
    resolvedCard: GameCard,
  ): MaybePromise<ActivationResult | boolean | null | undefined>;
  finalize?(
    result: ActivationResult,
    info: ActivationPipelineInfo,
  ): MaybePromise<void>;
  onFailure?(result: ActivationResult): void;
  onCancel?(): void;
}

interface FinalizeSpellCardOptions {
  card?: GameCard | null;
  owner?: GamePlayer | null;
  activationZone?: "spellTrap" | "fieldSpell" | null;
  fromHand?: boolean;
  effect?: EffectDefinition | null;
  placementLog?:
    | string
    | ((card: GameCard, info: Partial<ActivationPipelineInfo>) => string);
  activationLog?:
    | string
    | ((card: GameCard, info: Partial<ActivationPipelineInfo>) => string);
}

interface SpellTrapActivationOptions {
  owner?: GamePlayer | null;
  activationZone?: SpellTrapActivationZone | null;
  effectId?: string | null;
  quickSpellContext?: QuickSpellContext | null;
  resume?: {
    commitInfo?: ActivationCommitInfo | null;
    activationZone?: "spellTrap" | "fieldSpell" | null;
    activationContext?: SpellTrapActivationContext | null;
  } | null;
  actionContext?: unknown;
}

interface FieldActivationSnapshot {
  card: GameCard;
  owner: GamePlayer;
  zone: "spellTrap";
  wasFacedown: boolean;
  previousTurnSetOn: number | null | undefined;
  previousSetTurn: number | null | undefined;
}

interface SpellTrapActivationHost {
  player: GamePlayer;
  bot: GamePlayer;
  turn: string;
  phase: string;
  turnCounter: number;
  disableEffectActivation: boolean;
  disableTraps: boolean;
  ui: {
    log(message: string): void;
    showMessage?(message: string): void;
    showTrapActivationModal(
      card: GameCard,
      context: "manual_activation",
    ): MaybePromise<boolean>;
    applySpellTrapFlipAnimation?(
      ownerId: string,
      zoneIndex: number,
      options: { deferFrames: number },
    ): unknown;
  };
  effectEngine: {
    canActivateSpellTrapEffectPreview?(
      card: GameCard,
      owner: GamePlayer,
      zone: "spellTrap",
      selections: CanonicalSelectionMap | null,
      options: unknown,
    ): ActivationResult | null;
    getSpellTrapActivationEffect?(
      card: GameCard,
      options: unknown,
    ): EffectDefinition | null;
    activateSpellTrapEffect(
      card: GameCard,
      owner: GamePlayer,
      selections: CanonicalSelectionMap | null,
      zone: string,
      context: SpellTrapActivationContext,
    ): MaybePromise<ActivationResult | boolean | null | undefined>;
    canActivateSpellFromHandPreview?(
      card: GameCard,
      owner: GamePlayer,
      options?: unknown,
    ): ActivationResult | null;
    getFieldSpellActivationEffect?(card: GameCard): EffectDefinition | null;
    canActivateFieldSpellEffectPreview?(
      card: GameCard,
      owner: GamePlayer,
    ): ActivationResult | null;
    activateFieldSpell(
      card: GameCard,
      owner: GamePlayer,
      selections: CanonicalSelectionMap | null,
      context: SpellTrapActivationContext,
    ): MaybePromise<ActivationResult | boolean | null | undefined>;
  };
  updateBoard(options?: unknown): unknown;
  devLog?(code: string, detail: unknown): void;
  createActionResult(input: ActivationResult): ActivationResult;
  normalizeActivationResult(result: ActivationResult): ActivationResult;
  guardActionStart(
    config: ActionGuardConfig,
    playerAction?: boolean,
  ): ActivationResult;
  runActivationPipeline(
    config: SpellTrapPipelineConfig,
  ): MaybePromise<ActivationResult>;
  finalizeSpellTrapActivation(
    card: GameCard,
    owner: GamePlayer,
    zone: "spellTrap" | "fieldSpell" | null,
    options: { activationContext?: SpellTrapActivationContext },
  ): Promise<void>;
  finalizeSpellCardActivation(
    result: ActivationResult,
    info: ActivationPipelineInfo,
    options: FinalizeSpellCardOptions,
  ): Promise<void>;
  rollbackFieldSpellTrapActivation?(
    snapshot: FieldActivationSnapshot,
    reason: ActivationResult | string,
  ): boolean;
  canActivatePolymerization?(owner: GamePlayer): boolean;
  commitCardActivationFromHand(
    owner: GamePlayer,
    handIndex: number,
  ): Promise<ActivationCommitInfo | null>;
  queueVisualFeedback?(feedback: unknown): boolean;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
}

function getSpellTrapSelectionMessage(
  card: GameCard | null | undefined,
): string {
  if (card?.cardKind === "spell") {
    if (card.subtype === "continuous") {
      return getUIText("ui.spell.continuousSelection");
    }
    if (card.subtype === "field") {
      return getUIText("ui.spell.fieldSelection");
    }
    return getUIText("ui.spell.spellSelection");
  }
  return getUIText("ui.spell.spellTrapSelection");
}

export async function presentSpellTrapActivationFlip(
  this: SpellTrapActivationHost,
  card: GameCard | null | undefined,
  owner: GamePlayer | null | undefined,
  activationZone: "spellTrap" | "fieldSpell" = "spellTrap",
  options: { updateOptions?: unknown; deferFrames?: number } = {},
): Promise<boolean> {
  if (!card || !owner || activationZone !== "spellTrap") return false;
  if (!Array.isArray(owner.spellTrap) || !owner.spellTrap.includes(card)) {
    return false;
  }

  const zoneIndex = owner.spellTrap.indexOf(card);
  const boardPresentation = this.updateBoard?.(options.updateOptions || {});
  const flipPresentation = this.ui?.applySpellTrapFlipAnimation?.(
    owner.id,
    zoneIndex,
    {
      deferFrames:
        typeof options.deferFrames === "number" &&
        Number.isFinite(options.deferFrames)
        ? options.deferFrames
        : 1,
    },
  );

  const presentations = [boardPresentation, flipPresentation].filter(isPromiseLike);
  if (presentations.length === 0) return false;

  await Promise.allSettled(presentations);
  return true;
}

/**
 * Unified activation of spell/trap effects from field.
 * @param card - The card being activated.
 * @param selections - Pre-selected targets if any.
 * @returns Activation result with potential async selections.
 */
export async function tryActivateSpellTrapEffect(
  this: SpellTrapActivationHost,
  card: GameCard | null | undefined,
  selections: CanonicalSelectionMap | null = null,
  options: SpellTrapActivationOptions = {},
): Promise<ActivationResult> {
  if (this.disableEffectActivation || this.disableTraps) {
    this.ui?.log?.("Spell/Trap activations are disabled in network mode.");
    return this.createActionResult({
      reason: "effects_disabled",
      code: "EFFECTS_DISABLED",
    });
  }
  if (!card) {
    return this.createActionResult({
      reason: "invalid_card",
      code: "INVALID_CARD",
    });
  }
  const owner =
    options.owner ||
    (card.owner === "bot" ? this.bot : this.player) ||
    this.player;
  if (!owner) {
    return this.createActionResult({
      reason: "invalid_owner",
      code: "INVALID_OWNER",
    });
  }
  this.devLog?.("SPELL_TRAP_ACTIVATION_ATTEMPT", {
    summary: card.name,
    card: card.name,
    owner: owner.id || null,
    zone: "spellTrap",
  });

  const isTrap = card.cardKind === "trap";
  const quickSpellActivationFromSet =
    isQuickSpell(card) &&
    card.isFacedown === true &&
    owner.spellTrap?.includes?.(card);
  const quickSpellContext = quickSpellActivationFromSet
    ? {
        ...(options.quickSpellContext || {}),
        activationZone: "spellTrap",
      }
    : null;
  const guardConfig = isTrap
    ? {
        actor: owner,
        kind: "trap_activation",
        phaseReq: ["main1", "battle", "main2"],
      }
    : quickSpellActivationFromSet
    ? {
        actor: owner,
        kind: "quick_spell_activation",
        phaseReq: null,
      }
    : {
        actor: owner,
        kind: "spelltrap_effect",
        phaseReq: ["main1", "main2"],
      };

  const guard = this.guardActionStart(guardConfig);
  if (!guard.ok) return this.normalizeActivationResult(guard);

  const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
    card,
    owner,
    "spellTrap",
    selections,
    {
      activationContext: {
        autoSelectSingleTarget: true,
        trapActivationFromSet:
          card.cardKind === "trap" && card.isFacedown === true,
        quickSpellActivationFromSet,
        quickSpellContext,
      },
      ...(quickSpellContext ? { quickSpellContext } : {}),
    },
  );
  if (preview && preview.ok === false) {
    if (preview.reason) {
      this.ui.log(preview.reason);
    }
    return this.normalizeActivationResult(preview);
  }

  // If it's a trap, show confirmation modal first
  const trapActivationFromSet =
    card.cardKind === "trap" && card.isFacedown === true;
  const fieldActivationFromSet =
    trapActivationFromSet || quickSpellActivationFromSet;
  const fieldActivationSnapshot: FieldActivationSnapshot | null = fieldActivationFromSet
    ? {
        card,
        owner,
        zone: "spellTrap",
        wasFacedown: card.isFacedown,
        previousTurnSetOn: card.turnSetOn,
        previousSetTurn: card.setTurn,
      }
    : null;
  if (card.cardKind === "trap") {
    const confirmed = await this.ui.showTrapActivationModal(
      card,
      "manual_activation",
    );

    if (!confirmed) {
      this.devLog?.("TRAP_ACTIVATION_CANCELLED", {
        summary: card.name,
        card: card.name,
        owner: owner.id || null,
      });
      return this.createActionResult({
        cancelled: true,
        reason: "cancelled",
        code: "CANCELLED",
      });
    }

    // Flip the trap face-up after confirmation
    if (card.isFacedown) {
      card.isFacedown = false;
      this.ui.log(`${owner.name} ativa ${card.name}!`);
      this.updateBoard();
    }
  }

  const activationContext: SpellTrapActivationContext = {
    fromHand: false,
    activationZone: "spellTrap",
    sourceZone: "spellTrap",
    committed: false,
    trapActivationFromSet,
    quickSpellActivationFromSet,
    quickSpellContext,
  };
  const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
    card,
    { fromHand: false, activationZone: "spellTrap", trapActivationFromSet },
  );

  const pipelineQuickSpellContext: QuickSpellContext | null = quickSpellActivationFromSet
    ? {
        ...(quickSpellContext || {}),
        activationZone: "spellTrap" as const,
        effect: activationEffect,
      }
    : null;
  const pipelinePhaseReq = isTrap
    ? ["main1", "battle", "main2"]
    : quickSpellActivationFromSet
    ? null
    : ["main1", "main2"];

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner,
    activationZone: "spellTrap",
    activationContext,
    selections,
    selectionKind: "spellTrapEffect",
    selectionMessage: getSpellTrapSelectionMessage(card),
    guardKind: isTrap
      ? "trap_activation"
      : quickSpellActivationFromSet
      ? "quick_spell_activation"
      : "spelltrap_effect",
    phaseReq: pipelinePhaseReq,
    gate: quickSpellActivationFromSet
      ? () =>
          canActivateSetQuickSpell(
            this,
            card,
            owner,
            pipelineQuickSpellContext ?? undefined,
          )
      : null,
    oncePerTurn: {
      card,
      player: owner,
      effect: activationEffect,
    },
    activate: (chosen, ctx, zone) =>
      this.effectEngine.activateSpellTrapEffect(
        card,
        owner,
        chosen,
        zone,
        ctx,
      ),
    finalize: async (result, info) => {
      if (result.placementOnly) {
        this.ui.log(`${card.name} is placed on the field.`);
      } else {
        await this.finalizeSpellTrapActivation(
          card,
          owner,
          info.activationZone,
          { activationContext: info.activationContext },
        );
        this.ui.log(`${card.name} effect activated.`);
      }
      this.updateBoard();
    },
    onFailure: (result) => {
      if (fieldActivationSnapshot) {
        this.rollbackFieldSpellTrapActivation?.(
          fieldActivationSnapshot,
          result,
        );
      }
    },
    onCancel: () => {
      if (fieldActivationSnapshot) {
        this.rollbackFieldSpellTrapActivation?.(
          fieldActivationSnapshot,
          "cancelled",
        );
      }
    },
  });
  return pipelineResult;
}

/**
 * Complete a Spell card activation after the activation pipeline resolves.
 * This keeps hand Spell activations observable for triggers and analytics
 * across manual play and AI execution.
 */
export async function finalizeSpellCardActivation(
  this: SpellTrapActivationHost,
  result: ActivationResult = {},
  info: Partial<ActivationPipelineInfo> = {},
  options: FinalizeSpellCardOptions = {},
): Promise<void> {
  const card = info.card || options.card || null;
  const owner = info.owner || options.owner || null;
  const activationZone = info.activationZone || options.activationZone || null;
  if (!card || !owner) return;

  const placementOnly = result?.placementOnly === true;
  const placementLog =
    typeof options.placementLog === "function"
      ? options.placementLog(card, info)
      : options.placementLog;
  const activationLog =
    typeof options.activationLog === "function"
      ? options.activationLog(card, info)
      : options.activationLog;

  if (placementOnly) {
    this.ui?.log?.(placementLog || `${card.name} is placed on the field.`);
  } else {
    await this.finalizeSpellTrapActivation(card, owner, activationZone, {
      activationContext: info.activationContext,
    });
    this.ui?.log?.(
      result?.success === false
        ? `${card.name} failed to resolve.`
        : activationLog || `${card.name} effect activated.`,
    );
  }

  this.updateBoard();
}

/**
 * Attempts to activate a spell card from hand.
 * @param card - The card to activate.
 * @param handIndex - Index of the card in the player's hand.
 * @param selections - Pre-selected targets if any.
 * @param options - Activation options.
 * @returns Activation result.
 */
export async function tryActivateSpell(
  this: SpellTrapActivationHost,
  card: GameCard | null | undefined,
  handIndex: number,
  selections: CanonicalSelectionMap | null = null,
  options: SpellTrapActivationOptions = {},
): Promise<ActivationResult> {
  if (this.disableEffectActivation) {
    this.ui?.log?.("Effect activations are disabled.");
    return this.createActionResult({
      reason: "effects_disabled",
      code: "EFFECTS_DISABLED",
    });
  }
  if (!card) {
    return this.createActionResult({
      reason: "invalid_card",
      code: "INVALID_CARD",
    });
  }
  const owner = options.owner || this.player;
  if (!owner) {
    return this.createActionResult({
      reason: "invalid_owner",
      code: "INVALID_OWNER",
    });
  }
  const resume = options.resume || null;
  const actionContext = options.actionContext || null;
  const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
    card,
    { fromHand: true },
  );
  const quickSpellFromHand = isQuickSpell(card);
  const quickSpellContext: QuickSpellContext | null = quickSpellFromHand
    ? {
        ...(options.quickSpellContext || {}),
        activationZone: "hand" as const,
        effect: activationEffect,
      }
    : null;

  const resumeCommitInfo = resume?.commitInfo || null;
  const resolvedActivationZone =
    resume?.activationZone || resumeCommitInfo?.activationZone || null;
  const baseActivationContext = resume?.activationContext || {
    fromHand: true,
    activationZone: resolvedActivationZone,
    sourceZone: "hand",
    committed: false,
    commitInfo: resumeCommitInfo,
    actionContext,
  };

  // VALIDAÇÃO EXTRA: Fusion spells require valid fusion materials
  // Generic check using action type instead of hardcoded card name
  const hasFusionAction = (card.effects || []).some(
    (e) =>
      e &&
      Array.isArray(e.actions) &&
      e.actions.some((a) => a && a.type === "polymerization_fusion_summon"),
  );
  if (hasFusionAction && !resume) {
    if (!this.canActivatePolymerization?.(owner)) {
      this.ui?.showMessage?.(
        getUIText("ui.spell.noFusionMaterials"),
      );
      this.ui?.log?.(
        `${
          owner.name || "Jogador"
        } não pode ativar ${card.name}: sem materiais de fusão válidos.`,
      );
      return this.createActionResult({
        reason: "no_valid_fusion_materials",
        code: "NO_VALID_FUSION_MATERIALS",
      });
    }
  }

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner,
    selections,
    selectionKind: "spellTrapEffect",
    selectionMessage: getSpellTrapSelectionMessage(card),
    guardKind: "spell_from_hand",
    phaseReq: quickSpellFromHand ? null : ["main1", "main2"],
    gate:
      resume || !quickSpellFromHand
        ? null
        : () =>
            canActivateQuickSpellFromHand(
              this,
              card,
              owner,
              quickSpellContext ?? undefined,
            ),
    preview: resume
      ? null
      : () =>
          this.effectEngine?.canActivateSpellFromHandPreview?.(
            card,
            owner,
            quickSpellContext ? { quickSpellContext } : undefined,
          ),
    commit: resume
      ? () =>
          resumeCommitInfo || {
            cardRef: card,
            activationZone: resolvedActivationZone || "spellTrap",
            fromIndex: handIndex,
          }
      : () => this.commitCardActivationFromHand(owner, handIndex),
    activationContext: {
      ...baseActivationContext,
      committed: resume ? true : baseActivationContext.committed,
      activationZone:
        resolvedActivationZone || baseActivationContext.activationZone,
      sourceZone: baseActivationContext.sourceZone || "hand",
      commitInfo: baseActivationContext.commitInfo || resumeCommitInfo || null,
      actionContext,
      quickSpellContext,
    },
    oncePerTurn: {
      card,
      player: owner,
      effect: activationEffect,
    },
    activate: (chosen, ctx, zone, resolvedCard) =>
      this.effectEngine.activateSpellTrapEffect(
        resolvedCard,
        owner,
        chosen,
        zone,
        ctx,
      ),
    finalize: async (result, info) => {
      await this.finalizeSpellCardActivation(result, info, {
        owner,
        fromHand: baseActivationContext.fromHand,
        effect: activationEffect,
        placementLog: `${info.card.name} is placed on the field.`,
        activationLog: `${info.card.name} effect activated.`,
      });
    },
  });
  return pipelineResult;
}

/**
 * Activates a field spell effect (already on field).
 * @param {Card} card - The field spell card.
 * @returns Activation result.
 */
export function activateFieldSpellEffect(
  this: SpellTrapActivationHost,
  card: GameCard | null | undefined,
): MaybePromise<ActivationResult> {
  if (!card) {
    return this.createActionResult({
      reason: "invalid_card",
      code: "INVALID_CARD",
    });
  }
  const owner = card.owner === "player" ? this.player : this.bot;
  if (!owner) {
    return this.createActionResult({
      reason: "invalid_owner",
      code: "INVALID_OWNER",
    });
  }
  const guard = this.guardActionStart(
    {
      actor: owner,
      kind: "fieldspell_effect",
      phaseReq: ["main1", "main2"],
    },
    owner === this.player,
  );
  if (!guard.ok) return this.normalizeActivationResult(guard);
  const activationContext: SpellTrapActivationContext = {
    fromHand: false,
    activationZone: "fieldSpell",
    sourceZone: "fieldSpell",
    committed: false,
  };
  const activationEffect =
    this.effectEngine?.getFieldSpellActivationEffect?.(card);
  const pipelineResult = this.runActivationPipeline({
    card,
    owner,
    activationZone: "fieldSpell",
    activationContext,
    selectionKind: "fieldSpell",
    selectionMessage: getUIText("ui.spell.fieldSelection"),
    guardKind: "fieldspell_effect",
    phaseReq: ["main1", "main2"],
    preview: () =>
      this.effectEngine?.canActivateFieldSpellEffectPreview?.(card, owner),
    oncePerTurn: {
      card,
      player: owner,
      effect: activationEffect,
    },
    activate: (selections, ctx) =>
      this.effectEngine.activateFieldSpell(card, owner, selections, ctx),
    finalize: () => {
      this.ui.log(`${card.name} field effect activated.`);
      this.queueVisualFeedback?.({
        kind: "effect-activation",
        sourceCard: card,
        ownerId: owner.id,
        fromZone: "fieldSpell",
        tone: "gold",
      });
      this.updateBoard();
    },
  });
  return pipelineResult;
}
