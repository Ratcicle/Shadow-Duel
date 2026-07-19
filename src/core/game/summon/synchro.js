import { isAI } from "../../Player.js";
import { SUMMON_MODES, SUMMON_ORIGINS } from "./transaction.js";
import { checkSpecialSummonEligibility } from "./eligibility.js";

function getCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? null;
}

function isSynchroExtraDeckCard(card) {
  return (
    card &&
    card.cardKind === "monster" &&
    card.monsterType === "synchro"
  );
}

function isTuner(card) {
  return card?.isTuner === true;
}

function normalizeRoleRules(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === "object");
  }
  return typeof value === "object" ? [value] : [];
}

function materialEffectsAreActive(game, card) {
  if (!card || card.isFacedown) return false;
  if (typeof game?.effectEngine?.isEffectNegated === "function") {
    return !game.effectEngine.isEffectNegated(card);
  }
  return card.effectsNegated !== true;
}

function getCardLevel(card) {
  const level = Number(card?.level || 0);
  return Number.isFinite(level) ? level : 0;
}

function uniqueCards(cards = []) {
  const seen = new Set();
  const result = [];
  for (const card of cards) {
    if (!card) continue;
    const key = getCardInstanceId(card) || card;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

function sameCardSet(left = [], right = []) {
  if (left.length !== right.length) return false;
  const remaining = [...right];
  for (const card of left) {
    const index = remaining.indexOf(card);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function selectionMatchesCombo(materials = [], combos = []) {
  return combos.some((combo) => sameCardSet(materials, combo));
}

function getSynchroConfig(card) {
  const config = card?.synchro && typeof card.synchro === "object"
    ? card.synchro
    : {};
  return {
    tunerCount: Number.isFinite(Number(config.tunerCount))
      ? Math.max(1, Number(config.tunerCount))
      : 1,
    nonTunerMin: Number.isFinite(Number(config.nonTunerMin))
      ? Math.max(1, Number(config.nonTunerMin))
      : 1,
    nonTunerMax: Number.isFinite(Number(config.nonTunerMax))
      ? Math.max(1, Number(config.nonTunerMax))
      : Infinity,
    materialFilters: config.materialFilters || {},
    position: config.position || "choice",
  };
}

function valueMatchesFilter(value, filterValue) {
  if (filterValue === undefined || filterValue === null) return true;
  const requiredValues = Array.isArray(filterValue) ? filterValue : [filterValue];
  return requiredValues.includes(value);
}

function cardMatchesSimpleSynchroFilter(card, filters = {}) {
  if (!card) return false;
  const idFilter = filters.cardId ?? filters.id;
  if (!valueMatchesFilter(card.id, idFilter)) return false;
  if (!valueMatchesFilter(card.name, filters.name || filters.cardName)) {
    return false;
  }
  if (!valueMatchesFilter(card.cardKind, filters.cardKind)) return false;
  if (!valueMatchesFilter(card.monsterType, filters.monsterType)) return false;
  if (filters.isTuner !== undefined) {
    if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.type && !valueMatchesFilter(card.type, filters.type)) {
    return false;
  }
  if (filters.attribute && !valueMatchesFilter(card.attribute, filters.attribute)) {
    return false;
  }
  if (filters.minLevel !== undefined && getCardLevel(card) < filters.minLevel) {
    return false;
  }
  if (filters.maxLevel !== undefined && getCardLevel(card) > filters.maxLevel) {
    return false;
  }
  if (
    (filters.requireFaceup === true || filters.faceUp === true) &&
    card.isFacedown
  ) {
    return false;
  }
  return true;
}

function cardMatchesSynchroFilter(game, card, filters) {
  if (!filters || Object.keys(filters).length === 0) return true;
  if (game?.effectEngine?.cardMatchesFilters) {
    return game.effectEngine.cardMatchesFilters(card, filters);
  }
  return cardMatchesSimpleSynchroFilter(card, filters);
}

function materialPassesSynchroFilters(game, card, role, materialFilters = {}) {
  if (!cardMatchesSynchroFilter(game, card, materialFilters.all || {})) {
    return false;
  }
  const roleFilters =
    role === "tuner"
      ? materialFilters.tuner || {}
      : materialFilters.nonTuner || materialFilters.non_tuner || {};
  return cardMatchesSynchroFilter(game, card, roleFilters);
}

function canTreatAsSynchroNonTuner(game, card, synchroCard) {
  if (!isTuner(card)) return true;
  if (!materialEffectsAreActive(game, card)) return false;

  const rules = normalizeRoleRules(card?.synchroMaterialRoles?.nonTunerFor);
  if (rules.length === 0) return false;

  return rules.some((rule) => cardMatchesSynchroFilter(game, synchroCard, rule));
}

function getSynchroMaterialRoleEntries(game, card, synchroCard, config) {
  const entries = [];
  if (
    isTuner(card) &&
    materialPassesSynchroFilters(
      game,
      card,
      "tuner",
      config.materialFilters,
    )
  ) {
    entries.push({ card, role: "tuner" });
  }

  if (
    canTreatAsSynchroNonTuner(game, card, synchroCard) &&
    materialPassesSynchroFilters(
      game,
      card,
      "nonTuner",
      config.materialFilters,
    )
  ) {
    entries.push({ card, role: "nonTuner" });
  }

  return entries;
}

function roleGroupsShareCards(left = [], right = []) {
  const used = new Set(
    left.map((entry) => getCardInstanceId(entry.card) || entry.card),
  );
  return right.some((entry) =>
    used.has(getCardInstanceId(entry.card) || entry.card),
  );
}

function dedupeSynchroCombos(combos = []) {
  const seen = new Set();
  const result = [];
  for (const combo of combos) {
    const instanceIds = combo.map((card) => getCardInstanceId(card));
    if (instanceIds.some((id) => id === null)) {
      result.push(combo);
      continue;
    }
    const key = instanceIds.map(String).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(combo);
  }
  return result;
}

function buildCombinations(cards, minSize, maxSize) {
  const result = [];
  const limit = Math.min(cards.length, maxSize);
  const search = (start, picked) => {
    if (picked.length >= minSize) {
      result.push([...picked]);
    }
    if (picked.length >= limit) return;
    for (let index = start; index < cards.length; index += 1) {
      picked.push(cards[index]);
      search(index + 1, picked);
      picked.pop();
    }
  };
  search(0, []);
  return result;
}

function captureSynchroMaterialMetadata(card, player, game) {
  return {
    instanceId: getCardInstanceId(card),
    cardId: card?.id ?? null,
    name: card?.name || null,
    level: getCardLevel(card),
    isTuner: isTuner(card),
    ownerId: card?.owner || player?.id || null,
    controllerId: player?.id || card?.controller || card?.owner || null,
    usedOnTurn: Number.isFinite(Number(game?.turnCounter))
      ? Number(game.turnCounter)
      : null,
  };
}

function nextSynchroSummonContextId(game) {
  if (!game) return `synchro_${Math.random().toString(36).slice(2, 9)}`;
  const next = Number(game.synchroSummonContextCounter || 0) + 1;
  game.synchroSummonContextCounter = next;
  return `synchro_${game.turnCounter || 0}_${next}`;
}

function takeSynchroMaterialFollowups(game, contextId) {
  if (!game || !contextId) return [];
  const followups = Array.isArray(game.pendingSynchroMaterialFollowups)
    ? game.pendingSynchroMaterialFollowups
    : [];
  const matching = [];
  const remaining = [];
  for (const entry of followups) {
    if (entry?.synchroSummonContextId === contextId) {
      matching.push(entry);
    } else {
      remaining.push(entry);
    }
  }
  game.pendingSynchroMaterialFollowups = remaining;
  return matching;
}

function appendDeferredSynchroMaterialTriggerPackage(packages, moveResult) {
  const triggerPackage = moveResult?.deferredCardToGraveTriggerPackage || null;
  if (!triggerPackage || triggerPackage.collectedOnly !== true) return;
  if (!Array.isArray(triggerPackage.entries)) return;
  packages.push(triggerPackage);
}

function getPlayerById(game, playerId, fallback = null) {
  if (!game || !playerId) return fallback;
  if (game.player?.id === playerId) return game.player;
  if (game.bot?.id === playerId) return game.bot;
  return fallback;
}

async function applySynchroMaterialFollowupsForContext(
  game,
  synchroSummonContextId,
  synchroCard,
  player,
  actionContext,
) {
  const followups = takeSynchroMaterialFollowups(
    game,
    synchroSummonContextId,
  );
  if (followups.length === 0) {
    return { ok: true, needsSelection: false };
  }

  const followupResult =
    await game.applyPendingSynchroMaterialFollowups?.(
      synchroCard,
      player,
      followups,
      {
        actionContext,
        summonMethod: "synchro",
        summonProcedure: "synchro",
      },
    );
  if (followupResult?.needsSelection) {
    return followupResult;
  }
  if (followupResult?.success === false) {
    return {
      ok: false,
      needsSelection: false,
      reason: followupResult.reason || "synchro_material_followup_failed",
    };
  }
  return { ok: true, needsSelection: false };
}

async function resolveDeferredSynchroMaterialTriggers(
  game,
  packages,
  synchroSummonContextId,
  synchroCard,
  player,
  actionContext,
) {
  const entries = packages.flatMap((entryPackage) =>
    Array.isArray(entryPackage?.entries) ? entryPackage.entries : [],
  );
  if (entries.length > 0) {
    const onCompleteHandlers = packages
      .map((entryPackage) => entryPackage?.onComplete)
      .filter((handler) => typeof handler === "function");
    const orderRules = packages
      .map((entryPackage) => entryPackage?.orderRule)
      .filter(Boolean);
    const payload = {
      player,
      opponent: game.getOpponent?.(player) || null,
      contextLabel: "synchro_material",
      actionContext,
      deferredSynchroMaterialTriggers: true,
      synchroSummonContextId,
      synchroSummonedCard: synchroCard,
    };
    const triggerResult = await game.resolveEventEntries?.(
      "card_to_grave",
      payload,
      entries,
      {
        orderRule: orderRules.join(" -> "),
        onComplete:
          onCompleteHandlers.length > 0
            ? () => {
                for (const handler of onCompleteHandlers) handler();
              }
            : null,
      },
    );
    if (triggerResult?.needsSelection) {
      game.pendingSynchroMaterialTriggerContinuation = {
        stage: "material_triggers",
        synchroSummonContextId,
        summonedCard: synchroCard,
        playerId: player?.id || null,
        actionContext,
      };
      return triggerResult;
    }
  }

  game.pendingSynchroMaterialTriggerContinuation = null;
  return await applySynchroMaterialFollowupsForContext(
    game,
    synchroSummonContextId,
    synchroCard,
    player,
    actionContext,
  );
}

export async function finishPendingSynchroMaterialTriggerContinuation(
  resolutionResult = null,
  eventName = null,
) {
  const pending = this.pendingSynchroMaterialTriggerContinuation;
  if (!pending || resolutionResult?.needsSelection) return null;
  if (resolutionResult && resolutionResult.ok === false) return null;
  if (eventName && eventName !== "after_summon" && eventName !== "card_to_grave") {
    return null;
  }

  const player = getPlayerById(this, pending.playerId, null);
  const synchroCard = pending.summonedCard || null;
  if (!player || !synchroCard || !pending.synchroSummonContextId) {
    this.pendingSynchroMaterialTriggerContinuation = null;
    return null;
  }

  if (pending.stage === "after_summon") {
    const packages = Array.isArray(pending.deferredTriggerPackages)
      ? pending.deferredTriggerPackages
      : [];
    this.pendingSynchroMaterialTriggerContinuation = null;
    return await resolveDeferredSynchroMaterialTriggers(
      this,
      packages,
      pending.synchroSummonContextId,
      synchroCard,
      player,
      pending.actionContext || {},
    );
  }

  this.pendingSynchroMaterialTriggerContinuation = null;
  return await applySynchroMaterialFollowupsForContext(
    this,
    pending.synchroSummonContextId,
    synchroCard,
    player,
    pending.actionContext || {},
  );
}

function buildSynchroMaterialSelectionContract(game, card, player, candidates) {
  const owner = player.id === "player" ? "player" : "opponent";
  const decorated = candidates
    .map((material, index) => {
      const zoneIndex = player.field.indexOf(material);
      const candidate = {
        name: material.name,
        owner,
        controller: player.id,
        zone: "field",
        zoneIndex,
        atk: material.atk || 0,
        def: material.def || 0,
        level: getCardLevel(material),
        cardKind: material.cardKind,
        cardRef: material,
      };
      candidate.key =
        game.buildSelectionCandidateKey?.(candidate, index) ||
        `${player.id}:field:${zoneIndex}:${material.id || index}`;
      return candidate;
    });

  return {
    kind: "choice",
    message: `Select Synchro materials for ${card.name}.`,
    requirements: [
      {
        id: "synchro_materials",
        min: 2,
        max: decorated.length,
        zones: ["field"],
        owner,
        filters: {
          cardKind: "monster",
          faceUp: true,
        },
        allowSelf: true,
        distinct: true,
        candidates: decorated,
        label: "Synchro Materials",
      },
    ],
    ui: { useFieldTargeting: true, allowCancel: true },
    metadata: {
      context: "extra_deck_synchro_materials",
      sourceCard: card,
    },
  };
}

export function canUseAsSynchroMaterial(player, materialCard) {
  if (!player || !materialCard) {
    return { ok: false, reason: "Missing material." };
  }
  if (!Array.isArray(player.field) || !player.field.includes(materialCard)) {
    return { ok: false, reason: "Synchro materials must be on the field." };
  }
  if (materialCard.cardKind !== "monster") {
    return { ok: false, reason: "Synchro materials must be monsters." };
  }
  if (materialCard.isFacedown) {
    return { ok: false, reason: "Synchro materials must be face-up." };
  }
  return { ok: true };
}

export function getSynchroMaterialCombos(player, synchroCard) {
  if (!player || !isSynchroExtraDeckCard(synchroCard)) return [];
  const targetLevel = getCardLevel(synchroCard);
  if (targetLevel <= 0) return [];

  const config = getSynchroConfig(synchroCard);
  const materialRoleEntries = (player.field || []).flatMap((card) => {
    const materialCheck = this.canUseAsSynchroMaterial?.(player, card) || {
      ok: false,
    };
    if (materialCheck.ok !== true) return [];
    return getSynchroMaterialRoleEntries(
      this,
      card,
      synchroCard,
      config,
    );
  });

  const tuners = materialRoleEntries.filter((entry) => entry.role === "tuner");
  const nonTuners = materialRoleEntries.filter(
    (entry) => entry.role === "nonTuner",
  );
  const tunerCombos = buildCombinations(
    tuners,
    config.tunerCount,
    config.tunerCount,
  );
  const nonTunerCombos = buildCombinations(
    nonTuners,
    config.nonTunerMin,
    config.nonTunerMax,
  );

  const combos = [];
  for (const tunerGroup of tunerCombos) {
    if (tunerGroup.length !== config.tunerCount) continue;
    for (const nonTunerGroup of nonTunerCombos) {
      const nonTunerCount = nonTunerGroup.length;
      if (
        nonTunerCount < config.nonTunerMin ||
        nonTunerCount > config.nonTunerMax
      ) {
        continue;
      }
      if (roleGroupsShareCards(tunerGroup, nonTunerGroup)) continue;

      const combo = [...tunerGroup, ...nonTunerGroup].map(
        (entry) => entry.card,
      );
      const totalLevel = combo.reduce((sum, card) => sum + getCardLevel(card), 0);
      if (totalLevel === targetLevel) {
        combos.push(combo);
      }
    }
  }
  return dedupeSynchroCombos(combos);
}

export function canSummonSynchroCard(player, synchroCard, options = {}) {
  if (!player || !isSynchroExtraDeckCard(synchroCard)) {
    return { ok: false, reason: "No Synchro summon procedure.", type: "synchro" };
  }
  const eligibility = checkSpecialSummonEligibility(synchroCard, {
    summonProcedure: "synchro",
    fromZone: "extraDeck",
  });
  if (!eligibility.ok) {
    return {
      ok: false,
      reason: eligibility.reason || "This card cannot be Synchro Summoned.",
      type: "synchro",
    };
  }
  if (
    options.checkActionWindow !== false &&
    typeof this.canStartAction === "function"
  ) {
    const actionCheck = this.canStartAction({
      actor: player,
      kind: "synchro_summon",
      phaseReq: ["main1", "main2"],
      silent: options.silent !== false,
    });
    if (!actionCheck.ok) {
      return {
        ok: false,
        reason: actionCheck.reason || "This card cannot be summoned now.",
        type: "synchro",
      };
    }
  }

  const materialCombos = this.getSynchroMaterialCombos?.(
    player,
    synchroCard,
  ) || [];
  if (materialCombos.length === 0) {
    return {
      ok: false,
      reason: "Need exactly 1 Tuner and 1 or more non-Tuners with matching total Levels.",
      type: "synchro",
      candidates: [],
      materialCombos,
    };
  }

  const fieldCheck = this.canPlaceCardOnField?.(synchroCard, player, {
    isFacedown: false,
    excludeCards: materialCombos[0],
    summonMethod: "synchro",
    summonProcedure: "synchro",
    silent: options.silent !== false,
  });
  if (fieldCheck?.ok === false) {
    return {
      ...fieldCheck,
      type: "synchro",
      candidates: uniqueCards(materialCombos.flat()),
      materialCombos,
    };
  }

  return {
    ok: true,
    type: "synchro",
    candidates: uniqueCards(materialCombos.flat()),
    materialCombos,
    requiredCount: null,
  };
}

export async function performSynchroSummon(player, materials, synchroCard, options = {}) {
  if (!player || !synchroCard || !Array.isArray(materials)) {
    return { success: false, reason: "invalid_synchro_summon" };
  }

  const check = this.canSummonSynchroCard(player, synchroCard, {
    silent: false,
    checkActionWindow: options.checkActionWindow !== false,
  });
  if (!check.ok) {
    this.ui?.log?.(check.reason || "Cannot Synchro Summon this card.");
    return { success: false, reason: check.reason || "synchro_unavailable" };
  }
  if (!selectionMatchesCombo(materials, check.materialCombos)) {
    this.ui?.log?.("Invalid Synchro materials.");
    return { success: false, reason: "invalid_synchro_materials" };
  }

  const positionPref = options.position || getSynchroConfig(synchroCard).position;
  const resolvedPosition =
    positionPref === "choice" &&
    typeof this.effectEngine?.chooseSpecialSummonPosition === "function"
      ? await this.effectEngine.chooseSpecialSummonPosition(synchroCard, player, {
          position: positionPref,
        })
      : positionPref === "defense"
        ? "defense"
        : "attack";

  const materialMetadata = materials.map((card) =>
    captureSynchroMaterialMetadata(card, player, this),
  );
  const synchroSummonContextId =
    options.synchroSummonContextId || nextSynchroSummonContextId(this);
  const synchroActionContext = {
    ...(options.actionContext || {}),
    synchroSummonContextId,
    synchroSummonCardId: synchroCard.id ?? null,
    synchroSummonCardName: synchroCard.name || null,
  };

  const summonOrigin =
    options.summonOrigin === SUMMON_ORIGINS.EFFECT_RESOLUTION
      ? SUMMON_ORIGINS.EFFECT_RESOLUTION
      : SUMMON_ORIGINS.PROCEDURE;
  const deferredMaterialTriggerPackages = [];
  const prepared = this.createPreparedSummon({
    card: synchroCard,
    controller: player,
    sourceZone: "extraDeck",
    summonOrigin,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "synchro",
    summonProcedure: "synchro",
    position: resolvedPosition,
    costPayments: materials.map((material) => ({
      card: material,
      owner: player,
      fromZone: "field",
      toZone: "graveyard",
      kind: "synchro_material",
      pay: async () => {
        const moveResult = await this.moveCard(material, player, "graveyard", {
          fromZone: "field",
          contextLabel: "synchro_material",
          awaitCardToGraveEvent: true,
          awaitCardMovedEvent: true,
          deferCardToGraveTriggerResolution: true,
          wasDestroyed: false,
          actionContext: synchroActionContext,
        });
        appendDeferredSynchroMaterialTriggerPackage(
          deferredMaterialTriggerPackages,
          moveResult,
        );
        if (moveResult?.success === false) {
          takeSynchroMaterialFollowups(this, synchroSummonContextId);
        }
        return moveResult;
      },
    })),
    perform: async (transaction) =>
      await this.runZoneOp(
        "SYNCHRO_SUMMON",
        async () => {
          const postMaterialLimitCheck = this.canPlaceCardOnField?.(
            synchroCard,
            player,
            {
              isFacedown: false,
              summonMethod: "synchro",
              summonProcedure: "synchro",
            },
          );
          if (postMaterialLimitCheck?.ok === false) {
            takeSynchroMaterialFollowups(this, synchroSummonContextId);
            return {
              success: false,
              reason:
                postMaterialLimitCheck.reason ||
                "Cannot place Synchro monster on the field.",
            };
          }

          const summonResult = await this.moveCard(
            synchroCard,
            player,
            "field",
            {
              fromZone: "extraDeck",
              position: resolvedPosition,
              isFacedown: false,
              resetAttackFlags: true,
              summonMethodOverride: "synchro",
              summonProcedure: "synchro",
              summonOrigin,
              summonTransaction: transaction,
              contextLabel: "synchro_summon",
              actionContext: synchroActionContext,
              synchroMaterialFollowups: takeSynchroMaterialFollowups(
                this,
                synchroSummonContextId,
              ),
            },
          );
          if (summonResult?.success === false) {
            return {
              success: false,
              reason: summonResult.reason || "Synchro summon failed.",
            };
          }

          synchroCard.synchroMaterials = materialMetadata;
          if (summonResult.needsSelection) {
            this.pendingSynchroMaterialTriggerContinuation = {
              stage: "after_summon",
              synchroSummonContextId,
              summonedCard: synchroCard,
              playerId: player?.id || null,
              actionContext: synchroActionContext,
              deferredTriggerPackages: deferredMaterialTriggerPackages,
            };
            return {
              success: true,
              needsSelection: true,
              selectionContract: summonResult.selectionContract,
            };
          }
          const deferredTriggerResult =
            await resolveDeferredSynchroMaterialTriggers(
              this,
              deferredMaterialTriggerPackages,
              synchroSummonContextId,
              synchroCard,
              player,
              synchroActionContext,
            );
          if (deferredTriggerResult?.needsSelection) {
            return {
              success: true,
              needsSelection: true,
              selectionContract: deferredTriggerResult.selectionContract,
            };
          }
          return { success: true, needsSelection: false };
        },
        {
          contextLabel: "synchro_summon",
          card: synchroCard,
          fromZone: "extraDeck",
          toZone: "field",
        },
      ),
  });
  const result = await this.executeSummonTransaction(prepared);

  if (result?.success) {
    this.closeExtraDeckModal?.();
    this.ui?.log?.(
      `${player.name || player.id} Synchro Summoned ${synchroCard.name}.`,
    );
    this.updateBoard?.();
  } else if (result?.reason) {
    this.ui?.log?.(result.reason);
  }

  return (
    result || {
      success: false,
      needsSelection: false,
      reason: "Synchro summon failed.",
    }
  );
}

export async function performSynchroSummonFromExtraDeck(
  cardOrIndex,
  player,
  options = {},
) {
  const extraDeck = player?.extraDeck || [];
  const card =
    typeof cardOrIndex === "number" ? extraDeck[cardOrIndex] : cardOrIndex;
  if (!card || !player) return { success: false, reason: "missing_card" };

  const check = this.canSummonSynchroCard(player, card, {
    silent: false,
    checkActionWindow: !Array.isArray(options.materials),
  });
  if (!check.ok) {
    this.ui?.log?.(check.reason || "Cannot Synchro Summon this card.");
    return { success: false, reason: check.reason || "synchro_unavailable" };
  }

  let materials = Array.isArray(options.materials) ? options.materials : null;
  if (!materials) {
    if (isAI(player)) {
      materials = check.materialCombos[0] || [];
    } else {
      const selectionContract = buildSynchroMaterialSelectionContract(
        this,
        card,
        player,
        check.candidates,
      );
      this.closeExtraDeckModal?.();
      this.startTargetSelectionSession({
        kind: "synchro",
        card,
        owner: player,
        selectionContract,
        message: selectionContract.message,
        execute: async (selections) => {
          const keys = selections?.synchro_materials || [];
          const selected = keys
            .map((key) =>
              selectionContract.requirements[0].candidates.find(
                (candidate) => candidate.key === key,
              )?.cardRef,
            )
            .filter(Boolean);
          return await this.performSynchroSummon(player, selected, card, {
            checkActionWindow: false,
          });
        },
      });
      return { success: false, needsSelection: true, selectionContract };
    }
  }

  return await this.performSynchroSummon(player, materials, card, {
    checkActionWindow: !Array.isArray(options.materials),
  });
}
