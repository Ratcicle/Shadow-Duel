/**
 * Effect Blueprints - storage and execution helpers for reusable effects.
 * All functions assume `this` = EffectEngine instance.
 */

import { isAI } from "../../Player.js";

const DEFAULT_STORABLE_FLAG = "storableByGrimoire";

const normalizeArray = (value) => {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
};

const resolvePromptResult = async (promptResult) => {
  if (promptResult && typeof promptResult.then === "function") {
    return !!(await promptResult);
  }
  return !!promptResult;
};

const buildBlueprintDisplayCard = (blueprint) => ({
  id: blueprint.sourceCardId || blueprint.blueprintId,
  name: blueprint.displayName || blueprint.sourceCardName || "Stored Effect",
  description: blueprint.shortRulesText || "",
  cardKind: blueprint.sourceCardKind || "spell",
  subtype: blueprint.sourceCardSubtype || "normal",
  image: blueprint.sourceImage || "assets/card-back.png",
  __blueprintId: blueprint.blueprintId,
});

const renderBlueprintCard = (card) => {
  const wrapper = document.createElement("div");
  wrapper.className = "card-grid-item blueprint-card-item";

  const img = document.createElement("img");
  img.src = card.image || "assets/card-back.png";
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
  ui,
  blueprints,
  options = {}
) => {
  if (!ui || typeof ui.showCardGridSelectionModal !== "function") {
    return blueprints[0] || null;
  }

  const displayCards = blueprints.map(buildBlueprintDisplayCard);

  return new Promise((resolve) => {
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

export function getBlueprintStorageConfig(card) {
  const raw = card?.blueprintStorage;
  if (!raw || typeof raw !== "object") return null;

  const maxSlots = Number(
    raw.maxSlots ?? raw.maxStored ?? raw.maxStoredEffects ?? 1
  );

  return {
    maxSlots: Number.isFinite(maxSlots) && maxSlots > 0 ? maxSlots : 1,
    allowedArchetypes: normalizeArray(
      raw.allowedArchetypes || raw.allowedArchetype || raw.archetypeTag
    ),
    allowedCardKinds: normalizeArray(
      raw.allowedCardKinds || raw.allowedCardKind || raw.cardKinds
    ),
    storableEffectFlag:
      raw.storableEffectFlag || raw.effectFlag || DEFAULT_STORABLE_FLAG,
    allowOverwrite: raw.allowOverwrite !== false,
    requireEquipped: raw.requireEquipped !== false,
    requireFaceup: raw.requireFaceup !== false,
    promptOnStore: raw.promptOnStore !== false,
    autoStoreForAI: raw.autoStoreForAI === true,
  };
}

export function getBlueprintStorageState(card, create = false) {
  if (!card) return null;
  if (!card.state && !create) return null;
  if (!card.state && create) {
    card.state = {};
  }
  if (!card.state.blueprintStorage && create) {
    card.state.blueprintStorage = { storedBlueprints: [] };
  }
  const storage = card.state?.blueprintStorage || null;
  if (storage && !Array.isArray(storage.storedBlueprints)) {
    storage.storedBlueprints = [];
  }
  return storage;
}

export function getStoredBlueprints(card) {
  const storage = this.getBlueprintStorageState(card, false);
  return storage?.storedBlueprints || [];
}

export function clearBlueprintStorage(card) {
  if (!card?.state?.blueprintStorage) return false;
  delete card.state.blueprintStorage;
  if (card.state && Object.keys(card.state).length === 0) {
    card.state = null;
  }
  return true;
}

export function buildEffectBlueprint(sourceCard, effect) {
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

  let effectSnapshot = null;
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

export function resolveEffectBlueprint(blueprint) {
  if (!blueprint) return null;
  if (blueprint.effectSnapshot) return blueprint.effectSnapshot;
  return null;
}

export async function executeEffectBlueprint(blueprint, ctx, selections = null) {
  if (!blueprint || !ctx?.player || !ctx?.source) {
    return { success: false, needsSelection: false, reason: "Missing context." };
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

  if (effect.requireEmptyField && execCtx.player.field.length > 0) {
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

  const optCheck = this.checkOncePerTurn(execCtx.source, execCtx.player, effect);
  if (!optCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: optCheck.reason,
    };
  }

  const duelCheck = this.checkOncePerDuel(execCtx.source, execCtx.player, effect);
  if (!duelCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: duelCheck.reason,
    };
  }

  const selectionMap = selections || execCtx.selections || null;
  const targetResult = this.resolveTargets(
    effect.targets || [],
    execCtx,
    selectionMap
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
    targetResult.targets || {}
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
      ...actionsResult,
    };
  }

  this.registerOncePerTurnUsage(execCtx.source, execCtx.player, effect);
  this.registerOncePerDuelUsage(execCtx.source, execCtx.player, effect);

  return { success: true, needsSelection: false };
}

export async function activateStoredBlueprint(action, ctx) {
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

  let blueprint = null;
  if (activationState.blueprintId) {
    blueprint = stored.find((bp) => bp.blueprintId === activationState.blueprintId);
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
    ctx?.selections
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
  sourceCard,
  effect,
  ctx
) {
  if (!sourceCard || !effect || sourceCard.cardKind !== "spell") return false;
  const player = ctx?.player;
  if (!player || !this.game) return false;
  if (this.game.gameOver) return false;

  const storageCards = (player.spellTrap || []).filter(
    (card) => card && this.getBlueprintStorageConfig(card)
  );
  if (!storageCards.length) return false;

  const storageCard = storageCards[0];
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
      this.cardHasArchetype(sourceCard, arc)
    );
    if (!matches) return false;
  }

  const storableFlag = config.storableEffectFlag || DEFAULT_STORABLE_FLAG;
  const isEffectStorable = !!effect[storableFlag];
  const isCardStorable = !!sourceCard[storableFlag];
  if (!isEffectStorable && !isCardStorable) return false;

  const blueprint = this.buildEffectBlueprint(sourceCard, effect);
  if (!blueprint) return false;

  const storageState = this.getBlueprintStorageState(storageCard, true);
  const storedBlueprints = storageState?.storedBlueprints || [];
  const maxSlots = config.maxSlots || 1;
  const hasSpace = storedBlueprints.length < maxSlots;

  let shouldStore = true;
  let replaceIndex = null;

  if (!hasSpace) {
    if (!config.allowOverwrite) {
      return false;
    }

    if (!isAI(player) && config.promptOnStore) {
      const existingName =
        storedBlueprints[0]?.displayName || "efeito armazenado";
      const prompt = this.ui?.showConfirmPrompt?.(
        `Substituir o efeito armazenado (${existingName}) por ${blueprint.displayName}?`
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
      const replacement = await pickBlueprintFromModal(this.ui, storedBlueprints, {
        title: "Substituir efeito armazenado",
        subtitle: "Selecione 1 efeito para substituir.",
        confirmLabel: "Substituir",
      });
      replaceIndex = replacement
        ? storedBlueprints.findIndex(
            (bp) => bp.blueprintId === replacement.blueprintId
          )
        : null;
    }

    if (replaceIndex == null || replaceIndex < 0) {
      replaceIndex = 0;
    }
  } else if (!isAI(player) && config.promptOnStore) {
    const prompt = this.ui?.showConfirmPrompt?.(
      `Salvar o efeito desta magia no Grimorio?`
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

  let replacedBlueprint = null;
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
