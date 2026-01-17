import { getUI } from "./shared.js";

const DEFAULT_CHOICE_IMAGE = "assets/card-back.png";

function buildChoiceCandidates(cases, ctx, action, engine) {
  const game = engine?.game;
  const requirementId = action.requirementId || "action_case_choice";
  const choiceImage = action.choiceImage || DEFAULT_CHOICE_IMAGE;
  const candidates = [];
  const caseByKey = new Map();

  cases.forEach((caseEntry, index) => {
    const label =
      caseEntry.label ||
      caseEntry.name ||
      caseEntry.title ||
      caseEntry.id ||
      `Option ${index + 1}`;
    const description = caseEntry.description || "";
    const baseKey = caseEntry.key || caseEntry.id || `case_${index + 1}`;
    const key = `${requirementId}:${baseKey}`;

    const cardRef = {
      id: caseEntry.id || baseKey,
      name: label,
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

function shouldAllowCase(caseEntry, ctx, engine) {
  const targets = Array.isArray(caseEntry?.targets) ? caseEntry.targets : [];
  if (targets.length === 0) return true;

  const previewCtx = {
    ...ctx,
    activationContext: {
      ...(ctx?.activationContext || {}),
      preview: true,
    },
  };
  const targetResult = engine.resolveTargets(targets, previewCtx, null);
  return targetResult.ok !== false;
}

function runSelectionContract(game, selectionContract, options = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const finalize = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

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
    getUI(game)?.log("No valid options to activate this effect.");
    return false;
  }

  const { requirementId, candidates, caseByKey } = buildChoiceCandidates(
    availableCases,
    ctx,
    action,
    engine
  );
  const selectionLabel = action.selectionLabel || "effect";

  const selectionContract = {
    kind: "choice",
    message:
      action.selectionMessage || "Choose which effect you want to activate.",
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
  });

  if (!selections || Object.keys(selections).length === 0) {
    return false;
  }

  const chosenKeys = selections[requirementId] || [];
  const chosenKey = Array.isArray(chosenKeys) ? chosenKeys[0] : chosenKeys;
  const chosenCase = caseByKey.get(chosenKey);

  if (!chosenCase) {
    getUI(game)?.log("No valid effect choice selected.");
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
      getUI(game)?.log(targetResult.reason || "No valid targets.");
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
