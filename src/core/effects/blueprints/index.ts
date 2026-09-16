import type {
  ActionRuntimeCard,
  ActionRuntimePlayer,
  EffectContext,
  ResolvedTargetMap,
  NormalizedActionExecutionResult,
  NeedsSelectionResult,
} from "../../contracts/actionRuntime.js";
import type { CardAction } from "../../contracts/actions.js";
import type {
  CardKind,
  BlueprintStorageDefinition,
} from "../../contracts/cards.js";
import type {
  EffectCondition,
  EffectDefinition,
  EffectTarget,
} from "../../contracts/effects.js";
import type {
  CanonicalSelectionMap,
  RawSelectionContract,
  NormalizedSelectionContract,
} from "../../contracts/selection.js";
import type { GameUI } from "../../contracts/ui.js";

type BlueprintEffect = EffectDefinition & {
  readonly blueprintId?: string;
  readonly blueprintKey?: string;
  readonly blueprintDisplayName?: string;
  readonly blueprintName?: string;
  readonly blueprintText?: string;
  readonly shortRulesText?: string;
  readonly respectStoredEffectUsageLimits?: boolean;
};
interface RuntimeStorageConfig extends Partial<BlueprintStorageDefinition> {
  readonly maxStored?: number;
  readonly maxStoredEffects?: number;
  readonly allowedArchetype?: string;
  readonly archetypeTag?: string;
  readonly allowedCardKind?: CardKind;
  readonly cardKinds?: readonly CardKind[];
  readonly effectFlag?: string;
  readonly requireEquipped?: boolean;
  readonly requireFaceup?: boolean;
  readonly respectStoredEffectUsageLimits?: boolean;
}
export interface StoredEffectBlueprint {
  blueprintId: string;
  sourceCardId?: number | undefined;
  sourceCardName?: string;
  sourceCardKind?: CardKind | undefined;
  sourceCardSubtype?: (string | null) | undefined;
  sourceImage?: string | null;
  sourceEffectId?: string | null;
  archetypeTag?: string | null;
  displayName?: string;
  shortRulesText?: string;
  effectSnapshot?: BlueprintEffect | null;
  respectUsageLimits?: boolean;
}
interface BlueprintStorageState {
  storedBlueprints: StoredEffectBlueprint[];
}
interface BlueprintCard extends ActionRuntimeCard {
  blueprintStorage?: RuntimeStorageConfig | null;
  state?: { blueprintStorage?: BlueprintStorageState | null } | null;
}
interface BlueprintActivationState {
  blueprintId?: string;
  logged?: boolean;
}
type BlueprintActionContext = NonNullable<EffectContext["actionContext"]> & {
  blueprintActivation?: BlueprintActivationState;
};
type BlueprintContext = Omit<
  EffectContext,
  "actionContext" | "activationContext"
> & {
  actionContext?: BlueprintActionContext | null;
  activationContext?:
    | (NonNullable<EffectContext["activationContext"]> & {
        blueprintId?: string;
        blueprintSourceCardId?: number | undefined;
        actionContext?: BlueprintActionContext | null;
      })
    | null;
};
interface BlueprintResult {
  success: boolean;
  needsSelection: boolean;
  reason?: (string | null) | undefined;
  selectionContract?:
    | (RawSelectionContract | NormalizedSelectionContract)
    | undefined;
  actionResult?: NormalizedActionExecutionResult | NeedsSelectionResult;
}
interface BlueprintCheckResult {
  ok: boolean;
  reason?: string | null;
}
interface BlueprintTargetResult {
  ok?: boolean | undefined;
  needsSelection?: boolean;
  selectionContract?:
    | (RawSelectionContract | NormalizedSelectionContract)
    | undefined;
  reason?: string | null;
  targets?: ResolvedTargetMap | undefined;
}
interface BlueprintHost {
  ui?: Pick<
    GameUI,
    "log" | "showConfirmPrompt" | "showCardGridSelectionModal"
  > | null;
  game?: {
    gameOver?: boolean;
    getOpponent?(
      player: Omit<ActionRuntimePlayer, "strategy">,
    ): Omit<ActionRuntimePlayer, "strategy"> | null;
    notify?(event: string, payload: object): unknown;
    updateBoard?(): unknown;
  } | null;
  getBlueprintStorageConfig: typeof getBlueprintStorageConfig;
  getBlueprintStorageState: typeof getBlueprintStorageState;
  getStoredBlueprints(
    card: BlueprintCard | null | undefined,
  ): StoredEffectBlueprint[];
  buildEffectBlueprint: typeof buildEffectBlueprint;
  resolveEffectBlueprint: typeof resolveEffectBlueprint;
  executeEffectBlueprint(
    blueprint: StoredEffectBlueprint,
    ctx: BlueprintContext,
    selections?: CanonicalSelectionMap | null,
  ): Promise<BlueprintResult>;
  cardHasArchetype(card: ActionRuntimeCard, archetype: string): boolean;
  evaluateConditions(
    conditions: readonly EffectCondition[] | undefined,
    ctx: EffectContext,
  ): BlueprintCheckResult;
  checkOncePerTurn(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    effect: EffectDefinition,
  ): BlueprintCheckResult;
  checkOncePerDuel(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    effect: EffectDefinition,
  ): BlueprintCheckResult;
  commitEffectUsage(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    effect: EffectDefinition,
  ): unknown;
  resolveTargets(
    targets: readonly EffectTarget[],
    ctx: EffectContext,
    selections: CanonicalSelectionMap | null,
  ): BlueprintTargetResult;
  applyActions(
    actions: readonly CardAction[],
    ctx: EffectContext,
    targets: ResolvedTargetMap,
  ): Promise<NormalizedActionExecutionResult | NeedsSelectionResult>;
}

/**
 * Effect Blueprints - storage and execution helpers for reusable effects.
 * All functions assume `this` = EffectEngine instance.
 */

import { isAI } from "../../Player.js";
import { publicAssetUrl } from "../../publicUrl.js";

const DEFAULT_STORABLE_FLAG = "storableByGrimoire";

const normalizeArray = <T>(
  value: T | readonly T[] | null | undefined,
): readonly T[] | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value as T].filter(Boolean);
};

const resolvePromptResult = async (
  promptResult: boolean | PromiseLike<boolean> | undefined,
) => {
  if (
    promptResult &&
    typeof (promptResult as PromiseLike<boolean>).then === "function"
  ) {
    return !!(await promptResult);
  }
  return !!promptResult;
};

const buildBlueprintDisplayCard = (blueprint: StoredEffectBlueprint) => ({
  id: blueprint.sourceCardId || blueprint.blueprintId,
  name: blueprint.displayName || blueprint.sourceCardName || "Stored Effect",
  description: blueprint.shortRulesText || "",
  cardKind: blueprint.sourceCardKind || "spell",
  subtype: blueprint.sourceCardSubtype || "normal",
  image: blueprint.sourceImage || "assets/card-back.png",
  __blueprintId: blueprint.blueprintId,
});

const renderBlueprintCard = (
  card: ReturnType<typeof buildBlueprintDisplayCard>,
) => {
  const wrapper = document.createElement("div");
  wrapper.className = "card-grid-item blueprint-card-item";

  const img = document.createElement("img");
  img.src = publicAssetUrl(card.image || "assets/card-back.png");
  img.alt = card.name || "Stored effect";
  img.className = "card-grid-image";

  const info = document.createElement("div");
  info.className = "card-grid-info";

  const name = document.createElement("div");
  name.className = "card-grid-name";
  name.textContent = card.name || "Stored effect";
  info.appendChild(name);

  if (card.description) {
    const desc = document.createElement("div");
    desc.className = "card-grid-desc";
    desc.textContent = card.description;
    info.appendChild(desc);
  }

  wrapper.appendChild(img);
  wrapper.appendChild(info);
  return wrapper;
};

const pickBlueprintFromModal = async (
  ui: BlueprintHost["ui"],
  blueprints: readonly StoredEffectBlueprint[],
  options: {
    title?: string;
    subtitle?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  } = {},
) => {
  if (!ui || typeof ui.showCardGridSelectionModal !== "function") {
    return blueprints[0] || null;
  }

  const displayCards = blueprints.map(buildBlueprintDisplayCard);

  return new Promise<StoredEffectBlueprint | null>((resolve) => {
    ui.showCardGridSelectionModal({
      title: options.title || "Escolha o efeito armazenado",
      subtitle: options.subtitle || "Selecione 1 efeito.",
      cards: displayCards,
      minSelect: 1,
      maxSelect: 1,
      confirmLabel: options.confirmLabel || "Confirmar",
      cancelLabel: options.cancelLabel || "Cancelar",
      renderCard: renderBlueprintCard,
      onConfirm: (chosen) => {
        const chosenCard = Array.isArray(chosen) ? chosen[0] : null;
        const blueprintId = chosenCard?.__blueprintId;
        const blueprint =
          blueprints.find((bp) => bp.blueprintId === blueprintId) ||
          blueprints[0] ||
          null;
        resolve(blueprint);
      },
      onCancel: () => resolve(null),
    });
  });
};

export function getBlueprintStorageConfig(
  card: BlueprintCard | null | undefined,
) {
  const raw = card?.blueprintStorage;
  if (!raw || typeof raw !== "object") return null;

  const maxSlots = Number(
    raw.maxSlots ?? raw.maxStored ?? raw.maxStoredEffects ?? 1,
  );

  return {
    maxSlots: Number.isFinite(maxSlots) && maxSlots > 0 ? maxSlots : 1,
    allowedArchetypes: normalizeArray(
      raw.allowedArchetypes || raw.allowedArchetype || raw.archetypeTag,
    ),
    allowedCardKinds: normalizeArray(
      raw.allowedCardKinds || raw.allowedCardKind || raw.cardKinds,
    ),
    storableEffectFlag:
      raw.storableEffectFlag || raw.effectFlag || DEFAULT_STORABLE_FLAG,
    allowOverwrite: raw.allowOverwrite !== false,
    requireEquipped: raw.requireEquipped !== false,
    requireFaceup: raw.requireFaceup !== false,
    promptOnStore: raw.promptOnStore !== false,
    autoStoreForAI: raw.autoStoreForAI === true,
    respectStoredEffectUsageLimits: raw.respectStoredEffectUsageLimits === true,
  };
}

export function getBlueprintStorageState(
  card: BlueprintCard,
  create: true,
): BlueprintStorageState;
export function getBlueprintStorageState(
  card: BlueprintCard | null | undefined,
  create?: boolean,
): BlueprintStorageState | null;
export function getBlueprintStorageState(
  card: BlueprintCard | null | undefined,
  create = false,
): BlueprintStorageState | null {
  if (!card) return null;
  if (!card.state && !create) return null;
  if (!card.state && create) {
    card.state = {};
  }
  if (!card.state!.blueprintStorage && create) {
    card.state!.blueprintStorage = { storedBlueprints: [] };
  }
  const storage = card.state?.blueprintStorage || null;
  if (storage && !Array.isArray(storage.storedBlueprints)) {
    storage.storedBlueprints = [];
  }
  return storage;
}

export function getStoredBlueprints(
  this: BlueprintHost,
  card: BlueprintCard | null | undefined,
) {
  const storage = this.getBlueprintStorageState(card, false);
  return storage?.storedBlueprints || [];
}

export function clearBlueprintStorage(card: BlueprintCard | null | undefined) {
  if (!card?.state?.blueprintStorage) return false;
  delete card.state.blueprintStorage;
  if (card.state && Object.keys(card.state).length === 0) {
    card.state = null;
  }
  return true;
}

export function buildEffectBlueprint(
  sourceCard: ActionRuntimeCard | null | undefined,
  effect: BlueprintEffect | null | undefined,
): StoredEffectBlueprint | null {
  if (!sourceCard || !effect) return null;
  const blueprintId =
    effect.blueprintId ||
    effect.blueprintKey ||
    `${sourceCard.id || "card"}:${effect.id || "effect"}`;
  const displayName =
    effect.blueprintDisplayName ||
    effect.blueprintName ||
    sourceCard.name ||
    "Stored Effect";
  const shortRulesText =
    effect.blueprintText ||
    effect.shortRulesText ||
    sourceCard.description ||
    "";

  let effectSnapshot: BlueprintEffect | null = null;
  try {
    effectSnapshot = JSON.parse(JSON.stringify(effect));
  } catch (err) {
    effectSnapshot = { ...effect };
  }

  return {
    blueprintId,
    sourceCardId: sourceCard.id,
    sourceCardName: sourceCard.name,
    sourceCardKind: sourceCard.cardKind,
    sourceCardSubtype: sourceCard.subtype,
    sourceImage: sourceCard.image || null,
    sourceEffectId: effect.id || null,
    archetypeTag: sourceCard.archetype || null,
    displayName,
    shortRulesText,
    effectSnapshot,
  };
}

export function resolveEffectBlueprint(
  blueprint: StoredEffectBlueprint | null | undefined,
) {
  if (!blueprint) return null;
  if (blueprint.effectSnapshot) return blueprint.effectSnapshot;
  return null;
}

export async function executeEffectBlueprint(
  this: BlueprintHost,
  blueprint: StoredEffectBlueprint | null | undefined,
  ctx: BlueprintContext,
  selections: CanonicalSelectionMap | null = null,
): Promise<BlueprintResult> {
  if (!blueprint || !ctx?.player || !ctx?.source) {
    return {
      success: false,
      needsSelection: false,
      reason: "Missing context.",
    };
  }

  const effect = this.resolveEffectBlueprint(blueprint);
  if (!effect) {
    this.ui?.log?.("Stored effect is not available.");
    return {
      success: false,
      needsSelection: false,
      reason: "Stored effect not available.",
    };
  }

  const activationContext = ctx.activationContext || {};
  activationContext.blueprintId = blueprint.blueprintId;
  activationContext.blueprintSourceCardId = blueprint.sourceCardId;

  const execCtx = {
    ...ctx,
    effect,
    opponent: ctx.opponent || this.game?.getOpponent?.(ctx.player),
    activationZone: ctx.activationZone || "spellTrap",
    activationContext,
    actionContext: ctx.actionContext || activationContext.actionContext,
  };

  if (effect.requireEmptyField && execCtx.player!.field.length > 0) {
    return {
      success: false,
      needsSelection: false,
      reason: "You must control no monsters to activate this effect.",
    };
  }

  const condCheck = this.evaluateConditions(effect.conditions, execCtx);
  if (!condCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: condCheck.reason,
    };
  }

  const respectUsageLimits = blueprint.respectUsageLimits === true;
  if (respectUsageLimits) {
    const optCheck = this.checkOncePerTurn(
      execCtx.source!,
      execCtx.player!,
      effect,
    );
    if (!optCheck.ok) {
      return {
        success: false,
        needsSelection: false,
        reason: optCheck.reason,
      };
    }

    const duelCheck = this.checkOncePerDuel(
      execCtx.source!,
      execCtx.player!,
      effect,
    );
    if (!duelCheck.ok) {
      return {
        success: false,
        needsSelection: false,
        reason: duelCheck.reason,
      };
    }
  }

  const selectionMap = selections || execCtx.selections || null;
  const targetResult = this.resolveTargets(
    effect.targets || [],
    execCtx,
    selectionMap,
  );

  if (targetResult.needsSelection) {
    return {
      success: false,
      needsSelection: true,
      selectionContract: targetResult.selectionContract,
    };
  }

  if (!targetResult.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: targetResult.reason,
    };
  }

  const actionsResult = await this.applyActions(
    effect.actions || [],
    execCtx,
    targetResult.targets || {},
  );
  if (
    actionsResult &&
    typeof actionsResult === "object" &&
    actionsResult.needsSelection
  ) {
    return {
      success: false,
      needsSelection: true,
      selectionContract: actionsResult.selectionContract,
      ...(actionsResult as Partial<NeedsSelectionResult>),
    };
  }
  if (
    actionsResult &&
    typeof actionsResult === "object" &&
    actionsResult.success === false
  ) {
    return {
      success: false,
      needsSelection: false,
      reason: actionsResult.reason || "Stored effect actions failed.",
      actionResult: actionsResult,
    };
  }

  if (respectUsageLimits) {
    this.commitEffectUsage(execCtx.source!, execCtx.player!, effect);
  }

  return { success: true, needsSelection: false };
}

export async function activateStoredBlueprint(
  this: BlueprintHost,
  action: object,
  ctx: BlueprintContext,
) {
  const source = ctx?.source;
  const player = ctx?.player;
  if (!source || !player) return false;

  const stored = this.getStoredBlueprints(source);
  if (!stored.length) {
    this.ui?.log?.("Nenhum efeito armazenado para ativar.");
    return false;
  }

  const actionContext =
    ctx.actionContext ||
    (ctx.activationContext ? (ctx.activationContext.actionContext = {}) : null);
  if (ctx && actionContext) {
    ctx.actionContext = actionContext;
  }

  const activationState =
    actionContext?.blueprintActivation ||
    (actionContext ? (actionContext.blueprintActivation = {}) : {});

  let blueprint: StoredEffectBlueprint | null | undefined = null;
  if (activationState.blueprintId) {
    blueprint = stored.find(
      (bp) => bp.blueprintId === activationState.blueprintId,
    );
  }

  if (!blueprint) {
    if (stored.length === 1) {
      blueprint = stored[0];
    } else if (isAI(player)) {
      blueprint = stored[0];
    } else {
      blueprint = await pickBlueprintFromModal(this.ui, stored, {
        title: "Escolha o efeito armazenado",
        subtitle: "Selecione 1 efeito para ativar.",
        confirmLabel: "Ativar",
      });
    }
  }

  if (!blueprint) {
    if (actionContext) {
      delete actionContext.blueprintActivation;
    }
    return false;
  }

  if (activationState) {
    activationState.blueprintId = blueprint.blueprintId;
  }

  const execResult = await this.executeEffectBlueprint(
    blueprint,
    ctx,
    ctx?.selections,
  );

  if (execResult?.needsSelection) {
    return execResult;
  }

  if (execResult?.success) {
    if (!activationState.logged) {
      this.game?.notify?.("grimoire_blueprint_activated", {
        player,
        storageCard: source,
        blueprint,
      });
      activationState.logged = true;
    }
  } else if (execResult?.reason) {
    this.ui?.log?.(execResult.reason);
  }

  if (actionContext) {
    delete actionContext.blueprintActivation;
  }

  return execResult?.success ?? false;
}

export async function handleBlueprintStorageAfterResolution(
  this: BlueprintHost,
  sourceCard: BlueprintCard | null | undefined,
  effect: BlueprintEffect | null | undefined,
  ctx: BlueprintContext,
) {
  if (!sourceCard || !effect || sourceCard.cardKind !== "spell") return false;
  const player = ctx?.player;
  if (!player || !this.game) return false;
  if (this.game.gameOver) return false;

  const storageCards = (player.spellTrap || []).filter(
    (card) => card && this.getBlueprintStorageConfig(card),
  );
  if (!storageCards.length) return false;

  const storageCard = storageCards[0]!; // The filtered storage list is non-empty above.
  const config = this.getBlueprintStorageConfig(storageCard);
  if (!config) return false;

  if (config.requireFaceup && storageCard.isFacedown) return false;
  if (config.requireEquipped && !storageCard.equippedTo) return false;

  if (config.allowedCardKinds?.length) {
    if (!config.allowedCardKinds.includes(sourceCard.cardKind)) {
      return false;
    }
  }

  if (config.allowedArchetypes?.length) {
    const matches = config.allowedArchetypes.some((arc) =>
      this.cardHasArchetype(sourceCard, arc),
    );
    if (!matches) return false;
  }

  const storableFlag = config.storableEffectFlag || DEFAULT_STORABLE_FLAG;
  const isEffectStorable = !!(
    effect as BlueprintEffect & Record<string, unknown>
  )[storableFlag];
  const isCardStorable = !!(
    sourceCard as BlueprintCard & Record<string, unknown>
  )[storableFlag];
  if (!isEffectStorable && !isCardStorable) return false;

  const blueprint = this.buildEffectBlueprint(sourceCard, effect);
  if (!blueprint) return false;
  blueprint.respectUsageLimits =
    config.respectStoredEffectUsageLimits === true ||
    effect.respectStoredEffectUsageLimits === true;

  const storageState = this.getBlueprintStorageState(storageCard, true);
  const storedBlueprints = storageState?.storedBlueprints || [];
  const maxSlots = config.maxSlots || 1;
  const hasSpace = storedBlueprints.length < maxSlots;

  let shouldStore = true;
  let replaceIndex: number | null = null;

  if (!hasSpace) {
    if (!config.allowOverwrite) {
      return false;
    }

    if (!isAI(player) && config.promptOnStore) {
      const existingName =
        storedBlueprints[0]?.displayName || "efeito armazenado";
      const prompt = this.ui?.showConfirmPrompt?.(
        `Substituir o efeito armazenado (${existingName}) por ${blueprint.displayName}?`,
      );
      shouldStore = await resolvePromptResult(prompt);
    } else if (isAI(player) && !config.autoStoreForAI) {
      shouldStore = false;
    }

    if (!shouldStore) {
      this.game?.notify?.("grimoire_storage_decision", {
        player,
        storageCard,
        sourceCard,
        blueprint,
        stored: false,
        replaced: false,
      });
      return false;
    }

    if (storedBlueprints.length > 1 && !isAI(player)) {
      const replacement = await pickBlueprintFromModal(
        this.ui,
        storedBlueprints,
        {
          title: "Substituir efeito armazenado",
          subtitle: "Selecione 1 efeito para substituir.",
          confirmLabel: "Substituir",
        },
      );
      replaceIndex = replacement
        ? storedBlueprints.findIndex(
            (bp) => bp.blueprintId === replacement.blueprintId,
          )
        : null;
    }

    if (replaceIndex == null || replaceIndex < 0) {
      replaceIndex = 0;
    }
  } else if (!isAI(player) && config.promptOnStore) {
    const prompt = this.ui?.showConfirmPrompt?.(
      `Salvar o efeito desta magia no Grimorio?`,
    );
    shouldStore = await resolvePromptResult(prompt);
  } else if (isAI(player) && !config.autoStoreForAI) {
    shouldStore = false;
  }

  if (!shouldStore) {
    this.game?.notify?.("grimoire_storage_decision", {
      player,
      storageCard,
      sourceCard,
      blueprint,
      stored: false,
      replaced: false,
    });
    return false;
  }

  let replacedBlueprint: StoredEffectBlueprint | null = null;
  if (replaceIndex != null) {
    replacedBlueprint = storedBlueprints[replaceIndex] || null;
    storedBlueprints[replaceIndex] = blueprint;
  } else {
    storedBlueprints.push(blueprint);
  }

  storageState.storedBlueprints = storedBlueprints.slice(0, maxSlots);

  this.game?.notify?.("grimoire_storage_decision", {
    player,
    storageCard,
    sourceCard,
    blueprint,
    stored: true,
    replaced: !!replacedBlueprint,
    replacedBlueprintId: replacedBlueprint?.blueprintId || null,
  });

  this.game?.updateBoard?.();
  return true;
}
