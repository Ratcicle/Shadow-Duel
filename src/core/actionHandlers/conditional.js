import { cardMatchesKind } from "../Card.js";
import { getUIText } from "../i18n.js";
import { getUI, resolveTargetCards } from "./shared.js";
import { isAI } from "../Player.js";

function sameCardRef(ref, card) {
  if (!ref || !card) return false;
  if (ref === card) return true;
  if (typeof ref === "object") {
    return ref.instanceId != null && ref.instanceId === card.instanceId;
  }
  return card.instanceId != null && String(ref) === String(card.instanceId);
}

function getCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? null;
}

function getFirstTargetByRef(ref, ctx, targets) {
  if (!ref) return null;
  return (
    resolveTargetCards({ targetRef: ref }, ctx, targets, {
      defaultRef: ref === "self" ? "self" : undefined,
    })[0] || null
  );
}

function getCardController(game, card) {
  if (!game || !card) return null;
  if (game.player?.field?.includes?.(card)) return game.player;
  if (game.bot?.field?.includes?.(card)) return game.bot;
  if (game.player?.spellTrap?.includes?.(card)) return game.player;
  if (game.bot?.spellTrap?.includes?.(card)) return game.bot;
  if (game.player?.graveyard?.includes?.(card)) return game.player;
  if (game.bot?.graveyard?.includes?.(card)) return game.bot;
  if (game.player?.hand?.includes?.(card)) return game.player;
  if (game.bot?.hand?.includes?.(card)) return game.bot;
  if (game.player?.deck?.includes?.(card)) return game.player;
  if (game.bot?.deck?.includes?.(card)) return game.bot;
  return card.owner === "player" ? game.player : card.owner === "bot" ? game.bot : null;
}

function isCardOnField(controller, card) {
  return !!controller && Array.isArray(controller.field) && controller.field.includes(card);
}

function computeExpiresOnTurn(game, duration) {
  const currentTurn = Number(game?.turnCounter || 0);
  if (duration === "end_of_next_turn") return currentTurn + 1;
  return currentTurn;
}

function isActiveEquipForCard(equip, card, ctx) {
  if (!equip || !card) return false;
  if (equip.cardKind !== "spell" || equip.subtype !== "equip") return false;
  const isAttached =
    sameCardRef(equip.equippedTo, card) || sameCardRef(equip.equipTarget, card);
  if (!isAttached) return false;

  const owner =
    equip.owner === ctx?.player?.id
      ? ctx.player
      : equip.owner === ctx?.opponent?.id
        ? ctx.opponent
        : null;
  return Array.isArray(owner?.spellTrap) && owner.spellTrap.includes(equip);
}

function matchesCardFilters(card, filters, ctx) {
  if (!card || !filters) return false;

  const ownerFilter = filters.owner;
  if (ownerFilter === "self" && card.owner !== ctx?.player?.id) return false;
  if (ownerFilter === "opponent" && card.owner !== ctx?.opponent?.id)
    return false;

  if (filters.cardKind) {
    const kinds = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind];
    if (!cardMatchesKind(card, kinds)) return false;
  }

  if (filters.subtype) {
    const subtypes = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!subtypes.includes(card.subtype)) return false;
  }

  const nameFilter = filters.cardName || filters.name;
  if (nameFilter) {
    const names = Array.isArray(nameFilter) ? nameFilter : [nameFilter];
    if (!names.includes(card.name)) return false;
  }
  const excludeNames = [
    filters.excludeName,
    filters.excludeCardName,
    ...(Array.isArray(filters.excludeNames) ? filters.excludeNames : []),
    ...(Array.isArray(filters.excludeCardNames)
      ? filters.excludeCardNames
      : []),
  ].filter(Boolean);
  if (excludeNames.includes(card.name)) return false;

  const excludeIds = [
    filters.excludeId,
    filters.excludeCardId,
    ...(Array.isArray(filters.excludeIds) ? filters.excludeIds : []),
    ...(Array.isArray(filters.excludeCardIds) ? filters.excludeCardIds : []),
  ].filter((value) => value !== undefined && value !== null);
  if (excludeIds.includes(card.id)) return false;
  const cardInstanceId = getCardInstanceId(card);
  const excludeInstances = [
    filters.excludeInstanceId,
    ...(Array.isArray(filters.excludeInstanceIds)
      ? filters.excludeInstanceIds
      : []),
    ...(Array.isArray(filters.excludeCardInstanceIds)
      ? filters.excludeCardInstanceIds
      : []),
  ].filter((value) => value !== undefined && value !== null);
  if (cardInstanceId !== null && excludeInstances.includes(cardInstanceId)) {
    return false;
  }
  if (
    Array.isArray(filters.excludeCards) &&
    filters.excludeCards.some((excluded) => sameCardRef(excluded, card))
  ) {
    return false;
  }

  if (filters.archetype) {
    const required = Array.isArray(filters.archetype)
      ? filters.archetype
      : [filters.archetype];
    const cardArchetypes = card.archetypes
      ? card.archetypes
      : card.archetype
      ? [card.archetype]
      : [];
    const hasMatch = required.some((arc) => cardArchetypes.includes(arc));
    if (!hasMatch) return false;
  }

  if (filters.requireFaceup && card.isFacedown) return false;
  if (filters.faceUp && card.isFacedown) return false;
  if (filters.isTuner !== undefined) {
    if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
  }

  if (filters.position && filters.position !== "any") {
    if (card.position !== filters.position) return false;
  }

  if (filters.level !== undefined) {
    const cardLevel = card.level || 0;
    if (cardLevel !== filters.level) return false;
  }

  if (filters.minLevel !== undefined) {
    const cardLevel = card.level || 0;
    if (cardLevel < filters.minLevel) return false;
  }

  if (filters.maxLevel !== undefined) {
    const cardLevel = card.level || 0;
    if (cardLevel > filters.maxLevel) return false;
  }

  if (filters.minAtk !== undefined) {
    const cardAtk = card.atk || 0;
    if (cardAtk < filters.minAtk) return false;
  }

  if (filters.maxAtk !== undefined) {
    const cardAtk = card.atk || 0;
    if (cardAtk > filters.maxAtk) return false;
  }

  if (filters.minDef !== undefined) {
    const cardDef = card.def || 0;
    if (cardDef < filters.minDef) return false;
  }

  if (filters.maxDef !== undefined) {
    const cardDef = card.def || 0;
    if (cardDef > filters.maxDef) return false;
  }

  if (filters.equippedWithFilters) {
    const equipFilters = filters.equippedWithFilters || {};
    const requireEquipFaceup = equipFilters.requireFaceup !== false;
    const equips = Array.isArray(card.equips) ? card.equips : [];
    const hasMatchingEquip = equips.some((equip) => {
      if (!equip) return false;
      if (!isActiveEquipForCard(equip, card, ctx)) return false;
      if (requireEquipFaceup && equip.isFacedown) return false;
      return matchesCardFilters(equip, equipFilters, ctx);
    });
    if (!hasMatchingEquip) return false;
  }

  return true;
}

function resolveOptionalAutoSelection(game, selectionContract, ctx) {
  const player = ctx?.player || null;
  if (!isAI(player)) return null;

  const autoResult = game?.autoSelector?.select?.(selectionContract, {
    owner: player,
    player,
    source: ctx?.source || null,
    activationContext: ctx?.activationContext || {},
    selectionContract,
    game,
  });

  if (autoResult?.ok && autoResult.selections) {
    return autoResult.selections;
  }

  const fallback = {};
  for (const req of selectionContract?.requirements || []) {
    const min = Number(req?.min ?? 0);
    const max = Number(req?.max ?? min);
    const candidates = Array.isArray(req?.candidates)
      ? req.candidates
      : [];
    fallback[req.id] = candidates
      .slice(0, Math.min(Math.max(min, 0), max, candidates.length))
      .map((candidate) => candidate.key)
      .filter(Boolean);
  }
  return fallback;
}

function runOptionalTargetSelection(game, selectionContract, ctx, action) {
  const autoSelection = resolveOptionalAutoSelection(
    game,
    selectionContract,
    ctx,
  );
  if (autoSelection) return Promise.resolve(autoSelection);

  return new Promise((resolve) => {
    let resolved = false;
    const finalize = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    game.startTargetSelectionSession({
      kind: selectionContract?.kind || "target",
      selectionContract,
      card: ctx?.source || null,
      message: action?.selectionMessage || selectionContract?.message || null,
      allowCancel: action?.allowCancel !== false,
      resolve: finalize,
      execute: (selections) => {
        finalize(selections || {});
        return { success: true, needsSelection: false };
      },
      onCancel: () => finalize(null),
    });
  });
}

function buildOptionalConfirmationContract(action, ctx) {
  const requirementId =
    action?.confirmationId ||
    action?.selectionId ||
    `${ctx?.effect?.id || action?.type || "optional"}_confirm`;
  return {
    kind: "choice",
    message: action?.selectionMessage || "Apply this optional effect?",
    requirements: [
      {
        id: requirementId,
        label: action?.selectionLabel || "Optional effect",
        min: 1,
        max: 1,
        zone: "choice",
        zones: ["choice"],
        owner: "player",
        candidates: [
          {
            key: "yes",
            id: "yes",
            name: action?.confirmLabel || "Yes",
            label: action?.confirmLabel || "Yes",
            zone: "choice",
            cardKind: "spell",
          },
          {
            key: "no",
            id: "no",
            name: action?.cancelLabel || "No",
            label: action?.cancelLabel || "No",
            zone: "choice",
            cardKind: "spell",
          },
        ],
      },
    ],
    ui: {
      useFieldTargeting: false,
      allowCancel: action?.allowCancel !== false,
    },
    metadata: {
      context: "optional_confirmation",
      intent: "benefit",
      sourceCard: ctx?.source || null,
      sourceCardName: ctx?.source?.name || null,
      effectId: ctx?.effect?.id || null,
    },
  };
}

function getOptionalConfirmationText(action, ctx) {
  const fallback =
    action?.promptMessage ||
    action?.selectionMessage ||
    getUIText("ui.selection.chooseOneOption");
  const key = action?.promptMessageKey || action?.selectionMessageKey || null;
  if (!key) return fallback;

  return getUIText(
    key,
    {
      sourceCardName: ctx?.source?.name || "",
      effectId: ctx?.effect?.id || "",
    },
    fallback,
  );
}

function getOptionalConfirmationTitle(action) {
  const fallback =
    action?.promptTitle || getUIText("ui.prompts.confirmTitle");
  return action?.promptTitleKey
    ? getUIText(action.promptTitleKey, {}, fallback)
    : fallback;
}

async function confirmOptionalAction(action, ctx, engine) {
  const game = engine?.game;
  if (!game) return false;

  const selectionContract = buildOptionalConfirmationContract(action, ctx);
  const player = ctx?.player || null;
  const ui = getUI(game);

  if (!isAI(player) && typeof ui?.showConfirmPrompt === "function") {
    const result = ui.showConfirmPrompt(
      getOptionalConfirmationText(action, ctx),
      {
        kind: "optional_target_actions",
        sourceCardName: ctx?.source?.name || null,
        effectId: ctx?.effect?.id || null,
        confirmLabel: action?.confirmLabel,
        cancelLabel: action?.cancelLabel,
        title: getOptionalConfirmationTitle(action),
      },
    );
    return result && typeof result.then === "function"
      ? !!(await result)
      : !!result;
  }

  const selections = await runOptionalTargetSelection(
    game,
    selectionContract,
    ctx,
    action,
  );
  if (!selections) return false;

  const requirementId = selectionContract.requirements?.[0]?.id;
  const selected = Array.isArray(selections?.[requirementId])
    ? selections[requirementId]
    : [];
  return selected.includes("yes");
}

async function resolveOptionalTargets(action, ctx, engine) {
  const targetDefs = Array.isArray(action?.targets) ? action.targets : [];
  if (targetDefs.length === 0) {
    if (
      action?.optional === true ||
      action?.requireConfirmation === true ||
      action?.confirmOnly === true
    ) {
      const confirmed = await confirmOptionalAction(action, ctx, engine);
      if (!confirmed) {
        return { ok: false, cancelled: true, optionalDeclined: true };
      }
    }
    return { ok: true, targets: {} };
  }

  const game = engine?.game;
  if (!game) return { ok: false, reason: "Game not available." };

  const targetCtx = {
    ...ctx,
    activationContext: {
      ...(ctx?.activationContext || {}),
      logTargets: false,
    },
  };

  let targetResult = engine.resolveTargets(targetDefs, targetCtx, null);
  if (targetResult?.ok === false && !targetResult?.needsSelection) {
    return targetResult;
  }

  if (!targetResult?.needsSelection) {
    return targetResult;
  }

  const selectionContract = targetResult.selectionContract;
  if (!selectionContract) {
    return { ok: false, reason: "Selection contract not available." };
  }

  if (action?.selectionMessage) {
    selectionContract.message = action.selectionMessage;
  }

  const selections = await runOptionalTargetSelection(
    game,
    selectionContract,
    targetCtx,
    action,
  );

  if (!selections) {
    return { ok: false, cancelled: true };
  }

  targetResult = engine.resolveTargets(targetDefs, targetCtx, selections);
  return targetResult;
}

export async function handleConditionalTargetActions(
  action,
  ctx,
  targets,
  engine
) {
  const game = engine?.game;
  if (!game) return false;

  const cases = Array.isArray(action?.cases) ? action.cases : [];
  if (cases.length === 0) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
  });
  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for conditional effect.");
    return false;
  }

  const matchMode = action.matchMode === "all" ? "all" : "any";
  const applyMode = action.applyMode === "all" ? "all" : "first";

  const matchesCase = (caseEntry) => {
    const conditions = Array.isArray(caseEntry?.conditions)
      ? caseEntry.conditions
      : [];
    if (conditions.length > 0) {
      const conditionResult = engine.evaluateConditions?.(conditions, ctx);
      if (!conditionResult?.ok) return false;
    }

    const filters = caseEntry?.filters || caseEntry?.filter;
    if (!filters || Object.keys(filters).length === 0) return true;
    if (matchMode === "all") {
      return targetCards.every((card) => matchesCardFilters(card, filters, ctx));
    }
    return targetCards.some((card) => matchesCardFilters(card, filters, ctx));
  };

  let executed = false;

  for (const caseEntry of cases) {
    if (!matchesCase(caseEntry)) continue;
    const actions = Array.isArray(caseEntry?.actions) ? caseEntry.actions : [];
    if (actions.length === 0) {
      if (applyMode === "first") return executed;
      continue;
    }

    const result = await engine.applyActions(actions, ctx, targets);
    if (result && typeof result === "object" && result.needsSelection) {
      return result;
    }
    executed = result || executed;
    if (applyMode === "first") return executed;
  }

  if (!executed && Array.isArray(action.defaultActions)) {
    const result = await engine.applyActions(
      action.defaultActions,
      ctx,
      targets
    );
    if (result && typeof result === "object" && result.needsSelection) {
      return result;
    }
    executed = result || executed;
  }

  if (!executed) {
    getUI(game)?.log("No valid conditional actions for this target.");
  }

  return executed;
}

export async function handleOptionalTargetActions(action, ctx, targets, engine) {
  const game = engine?.game;
  if (!game) return false;

  const conditions = Array.isArray(action?.conditions)
    ? action.conditions
    : [];
  if (conditions.length > 0) {
    const conditionResult = engine.evaluateConditions?.(conditions, ctx);
    if (!conditionResult?.ok) {
      if (action?.logIfSkipped === true && conditionResult?.reason) {
        getUI(game)?.log(conditionResult.reason);
      }
      return false;
    }
  }

  const targetResult = await resolveOptionalTargets(action, ctx, engine);
  if (targetResult?.needsSelection) {
    return targetResult;
  }
  if (targetResult?.ok === false) {
    if (targetResult.optionalDeclined) {
      return true;
    }
    if (
      action?.logIfSkipped === true &&
      !targetResult.cancelled &&
      targetResult.reason
    ) {
      getUI(game)?.log(targetResult.reason);
    }
    return false;
  }

  const resolvedTargets = {
    ...(targets || {}),
    ...(targetResult?.targets || {}),
  };
  const actions = Array.isArray(action?.actions) ? action.actions : [];
  if (actions.length === 0) return false;

  const result = await engine.applyActions(actions, ctx, resolvedTargets);
  if (result && typeof result === "object" && result.needsSelection) {
    return result;
  }
  return result;
}

export async function handleRedirectCurrentAttackToTarget(
  action,
  ctx,
  targets,
  engine,
) {
  const game = engine?.game;
  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: action?.targetRef,
  });
  const target = targetCards[0] || null;
  if (!game || !target || target.cardKind !== "monster") return false;

  const attackContext =
    ctx?.actionContext ||
    ctx?.activationContext?.actionContext ||
    ctx?.activationContext?.context ||
    null;
  if (!attackContext) return false;

  const attacker = attackContext.attacker || ctx?.attacker || null;
  const attackerOwner =
    attackContext.attackerOwner || ctx?.attackerOwner || getCardController(game, attacker);
  const targetOwner = getCardController(game, target);
  if (!attacker || !attackerOwner || !targetOwner) return false;
  if (!isCardOnField(targetOwner, target)) return false;
  if (targetOwner === attackerOwner || targetOwner.id === attackerOwner.id) {
    return false;
  }

  attackContext.attackRedirect = {
    target,
    targetOwner,
    source: ctx?.source || null,
    reason: action?.contextLabel || "redirect_attack",
  };
  attackContext.redirectedTarget = target;
  attackContext.redirectedTargetOwner = targetOwner;
  game.updateBoard?.();
  return true;
}

export async function handleConditionalActions(action, ctx, targets, engine) {
  const game = engine?.game;
  if (!game) return false;

  const conditions = Array.isArray(action?.conditions)
    ? action.conditions
    : [];
  if (conditions.length > 0) {
    const conditionResult = engine.evaluateConditions?.(conditions, ctx);
    if (!conditionResult?.ok) {
      if (action?.logIfSkipped === true && conditionResult?.reason) {
        getUI(game)?.log(conditionResult.reason);
      }
      return false;
    }
  }

  const actions = Array.isArray(action?.actions) ? action.actions : [];
  if (actions.length === 0) return false;

  const result = await engine.applyActions(actions, ctx, targets || {});
  if (result && typeof result === "object" && result.needsSelection) {
    return result;
  }
  return result;
}

function cloneDeclaredValuesForTemporaryEffect(action, source) {
  const sourceDeclaredValues =
    source?.declaredValues && typeof source.declaredValues === "object"
      ? source.declaredValues
      : {};
  const refs = [
    action.declaredValueRef,
    action.declaredValueStateKey,
    action.stateKey,
  ].filter(Boolean);

  const declaredValues = {};
  if (refs.length > 0) {
    for (const ref of refs) {
      const stateKey =
        typeof ref === "string" ? ref : ref?.stateKey || ref?.key || null;
      if (!stateKey || !sourceDeclaredValues[stateKey]) continue;
      declaredValues[stateKey] = { ...sourceDeclaredValues[stateKey] };
    }
    return declaredValues;
  }

  for (const [stateKey, declaration] of Object.entries(sourceDeclaredValues)) {
    declaredValues[stateKey] =
      declaration && typeof declaration === "object"
        ? { ...declaration }
        : declaration;
  }
  return declaredValues;
}

export async function handleRegisterTemporaryEventEffect(
  action,
  ctx,
  targets,
  engine,
) {
  const game = engine?.game;
  const source = ctx?.source || null;
  const player = ctx?.player || null;
  if (!game || !source || !player || !action?.event) return false;

  const effect = {
    id:
      action.effectId ||
      action.id ||
      `${ctx?.effect?.id || action.type}_${action.event}`,
    timing: "on_event",
    event: action.event,
    promptUser: action.promptUser === true,
    promptMessage: action.promptMessage,
    conditions: Array.isArray(action.conditions) ? action.conditions : [],
    targets: Array.isArray(action.targets) ? action.targets : [],
    actions: Array.isArray(action.actions) ? action.actions : [],
  };

  const entry = {
    id:
      action.uniqueKey ||
      `${source.instanceId || source.id || source.name}:${
        ctx?.effect?.id || action.type
      }:${Math.random().toString(36).slice(2, 9)}`,
    event: action.event,
    ownerId: player.id,
    sourceName: action.sourceName || source.name,
    sourceCardId: source.id ?? null,
    sourceCardKind: source.cardKind || "spell",
    sourceCardSubtype: source.subtype || null,
    sourceArchetype: source.archetype || null,
    sourceArchetypes: Array.isArray(source.archetypes)
      ? [...source.archetypes]
      : source.archetype
        ? [source.archetype]
        : [],
    sourceImage: source.image || null,
    sourceInstanceId: getCardInstanceId(source),
    sourceEffectId: ctx?.effect?.id || null,
    effect,
    declaredValues: cloneDeclaredValuesForTemporaryEffect(action, source),
    createdOnTurn: Number(game.turnCounter || 0),
    expiresOnTurn: computeExpiresOnTurn(game, action.duration || "end_of_turn"),
    usesRemaining: Number.isFinite(Number(action.uses))
      ? Math.max(0, Number(action.uses))
      : 1,
    duration: action.duration || "end_of_turn",
  };

  if (!Array.isArray(game.temporaryEventEffects)) {
    game.temporaryEventEffects = [];
  }
  if (action.uniqueKey) {
    game.temporaryEventEffects = game.temporaryEventEffects.filter(
      (existing) =>
        !existing ||
        existing.id !== action.uniqueKey ||
        existing.ownerId !== player.id,
    );
  }
  game.temporaryEventEffects.push(entry);
  return true;
}

export async function handleRegisterSynchroMaterialFollowup(
  action,
  ctx,
  targets,
  engine,
) {
  const game = engine?.game;
  const player = ctx?.player || null;
  const source = ctx?.source || null;
  const actionContext =
    ctx?.actionContext ||
    ctx?.activationContext?.actionContext ||
    ctx?.activationContext ||
    {};
  const synchroSummonContextId =
    action.synchroSummonContextId ||
    actionContext.synchroSummonContextId ||
    null;
  const actions = Array.isArray(action?.actions) ? action.actions : [];

  if (!game || !player || !source || !synchroSummonContextId) {
    return false;
  }
  if (actions.length === 0) return false;

  const entry = {
    id:
      action.uniqueKey ||
      `${source.instanceId || source.id || source.name}:${
        ctx?.effect?.id || action.type
      }:${Math.random().toString(36).slice(2, 9)}`,
    type: "synchro_material_followup",
    synchroSummonContextId,
    ownerId: player.id || null,
    source,
    sourceName: action.sourceName || source.name,
    sourceCardId: source.id ?? null,
    sourceInstanceId: getCardInstanceId(source),
    sourceEffectId: ctx?.effect?.id || null,
    actions,
  };

  if (!Array.isArray(game.pendingSynchroMaterialFollowups)) {
    game.pendingSynchroMaterialFollowups = [];
  }
  game.pendingSynchroMaterialFollowups.push(entry);
  return true;
}

export async function handleRegisterBattlePairEffect(action, ctx, targets, engine) {
  const game = engine?.game;
  if (!game) return false;

  const firstTargetRef = action.firstTargetRef || action.targetARef || action.targetRef;
  const secondTargetRef =
    action.secondTargetRef || action.targetBRef || action.opponentTargetRef;
  const affectedTargetRef =
    action.affectedTargetRef || action.destroyTargetRef || secondTargetRef;

  const firstTarget = getFirstTargetByRef(firstTargetRef, ctx, targets);
  const secondTarget = getFirstTargetByRef(secondTargetRef, ctx, targets);
  const affectedTarget = getFirstTargetByRef(affectedTargetRef, ctx, targets);

  if (!firstTarget || !secondTarget || !affectedTarget) {
    return true;
  }

  const firstOwner = getCardController(game, firstTarget);
  const secondOwner = getCardController(game, secondTarget);
  const affectedOwner = getCardController(game, affectedTarget);
  if (
    !isCardOnField(firstOwner, firstTarget) ||
    !isCardOnField(secondOwner, secondTarget) ||
    !isCardOnField(affectedOwner, affectedTarget)
  ) {
    return true;
  }

  const entry = {
    id:
      action.uniqueKey ||
      `${ctx?.source?.instanceId || ctx?.source?.id || "source"}:${
        ctx?.effect?.id || action.type
      }:${Math.random().toString(36).slice(2, 9)}`,
    timing: action.timing || "before_damage_calculation",
    duration: action.duration || "end_of_turn",
    createdOnTurn: Number(game.turnCounter || 0),
    expiresOnTurn: computeExpiresOnTurn(game, action.duration || "end_of_turn"),
    controllerId: ctx?.player?.id || null,
    opponentId: ctx?.opponent?.id || null,
    source: ctx?.source || null,
    sourceCardId: ctx?.source?.id ?? null,
    sourceInstanceId: getCardInstanceId(ctx?.source),
    sourceEffectId: ctx?.effect?.id || null,
    firstTargetRef,
    secondTargetRef,
    affectedTargetRef,
    firstTarget,
    secondTarget,
    affectedTarget,
    firstInstanceId: getCardInstanceId(firstTarget),
    secondInstanceId: getCardInstanceId(secondTarget),
    affectedInstanceId: getCardInstanceId(affectedTarget),
    firstFieldPresenceId: firstTarget.fieldPresenceId || null,
    secondFieldPresenceId: secondTarget.fieldPresenceId || null,
    affectedFieldPresenceId: affectedTarget.fieldPresenceId || null,
    actions: Array.isArray(action.actions)
      ? action.actions
      : [{ type: "destroy", targetRef: affectedTargetRef }],
  };

  if (!Array.isArray(game.temporaryBattlePairEffects)) {
    game.temporaryBattlePairEffects = [];
  }
  game.temporaryBattlePairEffects.push(entry);
  return true;
}

export async function handleSetSourceAfterResolutionIf(
  action,
  ctx,
  targets,
  engine,
) {
  const game = engine?.game;
  const source = ctx?.source || null;
  const player = ctx?.player || null;
  if (!game || !source || !player) return true;

  const firstTarget = getFirstTargetByRef(action.firstTargetRef, ctx, targets);
  const secondTarget = getFirstTargetByRef(action.secondTargetRef, ctx, targets);
  if (!firstTarget || !secondTarget) return true;

  const conditionType = action.condition?.type || action.conditionType || "atk_difference_lte";
  const maxDifference = Number(
    action.condition?.value ??
      action.condition?.maxDifference ??
      action.atkDifferenceMax ??
      action.maxDifference ??
      0,
  );

  let conditionPassed = false;
  if (conditionType === "atk_difference_lte") {
    const difference = Math.abs(
      Number(firstTarget.atk || 0) - Number(secondTarget.atk || 0),
    );
    conditionPassed = difference <= maxDifference;
  }

  if (!Array.isArray(player.spellTrap) || !player.spellTrap.includes(source)) {
    return true;
  }

  const deferUntil =
    action.deferFinalizationUntil || action.deferUntil || null;
  const activationContext = ctx.activationContext || {};
  ctx.activationContext = activationContext;
  activationContext.spellTrapFinalization = {
    type: conditionPassed ? "set_source" : "default",
    sourceInstanceId: getCardInstanceId(source),
    sourceCardId: source.id ?? null,
    sourceEffectId: ctx?.effect?.id || null,
    setTurn: Number(game.turnCounter || 0),
    ...(deferUntil ? { deferUntil } : {}),
    reason: action.contextLabel || "set_after_resolution",
  };
  return true;
}
