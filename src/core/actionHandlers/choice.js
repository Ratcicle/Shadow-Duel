import { getUI } from "./shared.js";
import { cardDatabase } from "../../data/cards.js";
import {
  getCardDisplayName,
  getMonsterTypeLabel,
  getUIText,
} from "../i18n.js";

const DEFAULT_CHOICE_IMAGE = "assets/card-back.png";

function getEffectChoiceKey(ctx, action) {
  return (
    action?.effectChoiceKey ||
    action?.choiceTextKey ||
    ctx?.effect?.id ||
    ctx?.effectId ||
    null
  );
}

function getChoiceFallbackLabel(caseEntry, index) {
  return (
    caseEntry.label ||
    caseEntry.name ||
    caseEntry.title ||
    caseEntry.id ||
    `Option ${index + 1}`
  );
}

function getChoiceCaseText(effectChoiceKey, caseId, field, fallback) {
  if (!effectChoiceKey || !caseId) return fallback;
  return getUIText(
    `effectChoices.${effectChoiceKey}.cases.${caseId}.${field}`,
    {},
    fallback,
  );
}

function getChoiceSelectionMessage(effectChoiceKey, action, ctx) {
  const source = ctx?.source || null;
  const cardName = source
    ? getCardDisplayName(source) || source.name || ""
    : "";
  const fallback =
    action.selectionMessage || getUIText("ui.selection.chooseEffect");
  if (!effectChoiceKey) return fallback;
  return getUIText(
    `effectChoices.${effectChoiceKey}.message`,
    { cardName },
    fallback,
  );
}

function getPropertyLabel(property) {
  if (property === "type") {
    return getUIText("ui.declaration.typeLabel", {}, "monster Type");
  }
  return String(property || "value");
}

function getPropertyValueLabel(property, value) {
  if (property === "type") return getMonsterTypeLabel(value);
  return String(value || "");
}

function getMonsterTypesInDatabase() {
  return Array.from(
    new Set(
      cardDatabase
        .filter((card) => card?.cardKind === "monster")
        .flatMap((card) => {
          if (Array.isArray(card.types)) return card.types;
          return card.type ? [card.type] : [];
        })
        .filter(Boolean),
    ),
  ).sort((a, b) =>
    getMonsterTypeLabel(a).localeCompare(getMonsterTypeLabel(b)),
  );
}

function resolveDeclareChoices(action) {
  if (Array.isArray(action?.choices)) return action.choices.filter(Boolean);
  if (action?.choices === "monster_types_in_database") {
    return getMonsterTypesInDatabase();
  }

  const property = action?.property;
  if (!property) return [];
  return Array.from(
    new Set(
      cardDatabase
        .map((card) => card?.[property])
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter(Boolean),
    ),
  ).sort((a, b) => String(a).localeCompare(String(b)));
}

function getDeclarationExpirationTurn(game, action) {
  const currentTurn = Number(game?.turnCounter || 0);
  if (Number.isFinite(action?.expiresOnTurn)) return action.expiresOnTurn;
  if (Number.isFinite(action?.durationTurns)) {
    return currentTurn + Math.max(0, action.durationTurns);
  }
  if (action?.duration === "while_faceup" || action?.duration === "permanent") {
    return null;
  }
  if (action?.duration === "end_of_next_turn") return currentTurn + 1;
  if (action?.duration === "end_of_turn" || action?.duration === "this_turn") {
    return currentTurn;
  }
  return currentTurn;
}

function isAIPlayer(player) {
  return player?.controllerType === "ai";
}

function resolveAutoSelection(game, selectionContract, options = {}) {
  const player = options.player || options.context?.player || null;
  if (!isAIPlayer(player)) return { attempted: false, selections: null };

  const autoResult = game?.autoSelector?.select?.(selectionContract, {
    owner: player,
    player,
    source: options.card || options.context?.source || null,
    activationContext:
      options.activationContext || options.context?.activationContext || {},
    selectionContract,
    game,
  });

  return {
    attempted: true,
    selections: autoResult?.ok ? autoResult.selections : null,
  };
}

function buildChoiceCandidates(cases, ctx, action, engine) {
  const game = engine?.game;
  const requirementId = action.requirementId || "action_case_choice";
  const choiceImage = action.choiceImage || DEFAULT_CHOICE_IMAGE;
  const effectChoiceKey = getEffectChoiceKey(ctx, action);
  const candidates = [];
  const caseByKey = new Map();

  cases.forEach((caseEntry, index) => {
    const baseKey = caseEntry.key || caseEntry.id || `case_${index + 1}`;
    const label = getChoiceCaseText(
      effectChoiceKey,
      baseKey,
      "label",
      getChoiceFallbackLabel(caseEntry, index),
    );
    const description = getChoiceCaseText(
      effectChoiceKey,
      baseKey,
      "description",
      caseEntry.description || "",
    );
    const key = `${requirementId}:${baseKey}`;

    const cardRef = {
      id: caseEntry.id || baseKey,
      name: label,
      label,
      description,
      cardKind: caseEntry.cardKind || "spell",
      image: caseEntry.image || choiceImage,
    };

    const candidate = {
      key,
      name: label,
      owner: "player",
      controller: ctx?.player?.id || "player",
      zone: "choice",
      zoneIndex: index,
      position: "",
      atk: null,
      def: null,
      cardKind: cardRef.cardKind,
      cardRef,
    };

    if (game?.buildSelectionCandidateKey) {
      candidate.key = game.buildSelectionCandidateKey(candidate, index);
    }

    candidates.push(candidate);
    caseByKey.set(candidate.key, caseEntry);
  });

  return { requirementId, candidates, caseByKey };
}

function buildDeclareChoiceCandidates(values, action, ctx, engine) {
  const game = engine?.game;
  const requirementId =
    action.requirementId ||
    action.selectionId ||
    `${ctx?.effect?.id || action.type || "declare_card_property"}_choice`;
  const candidates = [];
  const valueByKey = new Map();
  const property = action.property;

  values.forEach((value, index) => {
    const label = getPropertyValueLabel(property, value);
    const cardRef = {
      id: String(value),
      name: label,
      label,
      description: label,
      cardKind: "spell",
      image: action.choiceImage || DEFAULT_CHOICE_IMAGE,
    };
    const candidate = {
      key: `${requirementId}:${String(value)}`,
      name: label,
      owner: "player",
      controller: ctx?.player?.id || "player",
      zone: "choice",
      zoneIndex: index,
      position: "",
      atk: null,
      def: null,
      cardKind: cardRef.cardKind,
      cardRef,
    };

    if (game?.buildSelectionCandidateKey) {
      candidate.key = game.buildSelectionCandidateKey(candidate, index);
    }

    candidates.push(candidate);
    valueByKey.set(candidate.key, value);
  });

  return { requirementId, candidates, valueByKey };
}

function shouldAllowCase(caseEntry, ctx, engine) {
  const conditions = Array.isArray(caseEntry?.conditions)
    ? caseEntry.conditions
    : [];
  if (conditions.length > 0) {
    const conditionResult = engine?.evaluateConditions?.(conditions, ctx);
    if (!conditionResult?.ok) return false;
  }

  const targets = Array.isArray(caseEntry?.targets) ? caseEntry.targets : [];
  const previewCtx = {
    ...ctx,
    activationContext: {
      ...(ctx?.activationContext || {}),
      preview: true,
    },
  };

  if (targets.length > 0) {
    const targetResult = engine.resolveTargets(targets, previewCtx, null);
    if (targetResult.ok === false) return false;
  }

  const actions = Array.isArray(caseEntry?.actions) ? caseEntry.actions : [];
  if (actions.length > 0) {
    const actionResult = engine?.checkActionPreviewRequirements?.(
      actions,
      previewCtx,
    );
    if (actionResult?.ok === false) return false;
  }

  return true;
}

function runSelectionContract(game, selectionContract, options = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const finalize = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const autoSelection = resolveAutoSelection(
      game,
      selectionContract,
      options,
    );
    if (autoSelection.attempted) {
      finalize(autoSelection.selections);
      return;
    }

    game.startTargetSelectionSession({
      kind: options.kind || selectionContract?.kind || "choice",
      selectionContract,
      card: options.card || null,
      message: options.message || null,
      allowCancel: options.allowCancel !== false,
      resolve: finalize,
      execute: (selections) => {
        finalize(selections || {});
        return { success: true, needsSelection: false };
      },
      onCancel: () => finalize(null),
    });
  });
}

async function resolveTargetsWithPrompt(engine, ctx, targetDefs) {
  let targetResult = engine.resolveTargets(targetDefs, ctx, null);
  if (!targetResult.needsSelection) {
    return targetResult;
  }

  const game = engine?.game;
  if (!game) return { ok: false, reason: "Game not available." };

  const selections = await runSelectionContract(
    game,
    targetResult.selectionContract,
    {
      kind: targetResult.selectionContract?.kind || "target",
      card: ctx?.source || null,
      allowCancel: true,
      context: ctx,
      player: ctx?.player || null,
      activationContext: ctx?.activationContext || {},
    }
  );

  if (!selections || Object.keys(selections).length === 0) {
    return { ok: false, reason: "Selection cancelled." };
  }

  targetResult = engine.resolveTargets(targetDefs, ctx, selections);
  return targetResult;
}

export async function handleChooseActionCase(action, ctx, targets, engine) {
  const game = engine?.game;
  const player = ctx?.player;
  if (!game || !player) return false;

  const allCases = Array.isArray(action?.cases) ? action.cases : [];
  if (allCases.length === 0) return false;

  const availableCases =
    action.filterAvailableCases === false
      ? allCases
      : allCases.filter((caseEntry) => shouldAllowCase(caseEntry, ctx, engine));

  if (availableCases.length === 0) {
    getUI(game)?.log(getUIText("ui.selection.noValidOptions"));
    return false;
  }

  const { requirementId, candidates, caseByKey } = buildChoiceCandidates(
    availableCases,
    ctx,
    action,
    engine
  );
  const selectionLabel =
    action.selectionLabel || getUIText("ui.selection.effectLabel");
  const effectChoiceKey = getEffectChoiceKey(ctx, action);

  const selectionContract = {
    kind: "choice",
    message: getChoiceSelectionMessage(effectChoiceKey, action, ctx),
    requirements: [
      {
        id: requirementId,
        label: selectionLabel,
        min: 1,
        max: 1,
        candidates,
      },
    ],
    ui: {
      allowCancel: action.allowCancel !== false,
      useFieldTargeting: false,
    },
    metadata: {
      intent: "benefit",
    },
  };

  const selections = await runSelectionContract(game, selectionContract, {
    kind: action.selectionKind || "choice",
    card: ctx?.source || null,
    allowCancel: action.allowCancel !== false,
    context: ctx,
    player,
    activationContext: ctx?.activationContext || {},
  });

  if (!selections || Object.keys(selections).length === 0) {
    return false;
  }

  const chosenKeys = selections[requirementId] || [];
  const chosenKey = Array.isArray(chosenKeys) ? chosenKeys[0] : chosenKeys;
  const chosenCase = caseByKey.get(chosenKey);

  if (!chosenCase) {
    getUI(game)?.log(getUIText("ui.selection.noValidChoice"));
    return false;
  }

  const caseTargets = Array.isArray(chosenCase.targets)
    ? chosenCase.targets
    : [];
  let resolvedTargets = {};

  if (caseTargets.length > 0) {
    const targetResult = await resolveTargetsWithPrompt(
      engine,
      ctx,
      caseTargets
    );
    if (targetResult.needsSelection) {
      return targetResult;
    }
    if (targetResult.ok === false) {
      getUI(game)?.log(
        targetResult.reason || getUIText("ui.selection.noValidTargets"),
      );
      return false;
    }
    resolvedTargets = targetResult.targets || {};
  }

  const actions = Array.isArray(chosenCase.actions) ? chosenCase.actions : [];
  if (actions.length === 0) {
    return false;
  }

  const result = await engine.applyActions(actions, ctx, resolvedTargets);
  if (result && typeof result === "object" && result.needsSelection) {
    return result;
  }

  return result;
}

export async function handleDeclareCardProperty(action, ctx, targets, engine) {
  const game = engine?.game;
  const player = ctx?.player;
  const source = ctx?.source;
  if (!game || !player || !source || !action?.property || !action?.stateKey) {
    return false;
  }

  const choices = resolveDeclareChoices(action);
  if (choices.length === 0) {
    getUI(game)?.log("No values available to declare.");
    return false;
  }

  let declaredValue = action.value || null;

  if (!declaredValue) {
    const { requirementId, candidates, valueByKey } =
      buildDeclareChoiceCandidates(choices, action, ctx, engine);
    const propertyLabel = getPropertyLabel(action.property);
    const selectionContract = {
      kind: "choice",
      message:
        action.selectionMessage ||
        getUIText(
          "ui.declaration.chooseValue",
          { propertyLabel },
          `Declare 1 ${propertyLabel}.`,
        ),
      requirements: [
        {
          id: requirementId,
          label: action.selectionLabel || propertyLabel,
          min: 1,
          max: 1,
          candidates,
        },
      ],
      ui: {
        allowCancel: action.allowCancel !== false,
        useFieldTargeting: false,
      },
      metadata: {
        intent: "declare",
        sourceCard: source,
        effectId: ctx?.effect?.id || null,
      },
    };

    const selections = await runSelectionContract(game, selectionContract, {
      kind: "choice",
      card: source,
      allowCancel: action.allowCancel !== false,
      context: ctx,
      player,
      activationContext: ctx?.activationContext || {},
    });

    if (!selections || Object.keys(selections).length === 0) {
      return false;
    }

    const chosenKeys = selections[requirementId] || [];
    const chosenKey = Array.isArray(chosenKeys) ? chosenKeys[0] : chosenKeys;
    declaredValue = valueByKey.get(chosenKey) || null;
  }

  if (!declaredValue) {
    return false;
  }

  if (!source.declaredValues || typeof source.declaredValues !== "object") {
    source.declaredValues = {};
  }

  const valueLabel = getPropertyValueLabel(action.property, declaredValue);
  source.declaredValues[action.stateKey] = {
    property: action.property,
    value: declaredValue,
    valueLabel,
    declaredOnTurn: game.turnCounter || 0,
    expiresOnTurn: getDeclarationExpirationTurn(game, action),
    duration: action.duration || null,
  };

  getUI(game)?.log(
    getUIText(
      "ui.declaration.declaredValue",
      {
        cardName: getCardDisplayName(source),
        valueLabel,
      },
      `${getCardDisplayName(source)} declared ${valueLabel}.`,
    ),
  );
  game.updateBoard?.();
  return true;
}
