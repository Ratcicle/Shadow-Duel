import { isAI } from "../../Player.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../../game/summon/synchro.js";
import { getUI, resolveTargetCards, selectCards } from "../shared.js";

function getCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? null;
}

function getCardLevel(card) {
  const level = Number(card?.level || 0);
  return Number.isFinite(level) ? level : 0;
}

function getOwnerById(game, ownerId, fallback = null) {
  if (!game || !ownerId) return fallback;
  if (game.player?.id === ownerId) return game.player;
  if (game.bot?.id === ownerId) return game.bot;
  return fallback;
}

function findCardLocation(game, card) {
  if (!game || !card) return null;
  const zones = [
    "field",
    "spellTrap",
    "hand",
    "graveyard",
    "deck",
    "extraDeck",
    "banished",
  ];
  for (const owner of [game.player, game.bot].filter(Boolean)) {
    if (owner.fieldSpell === card) {
      return { owner, zone: "fieldSpell" };
    }
    for (const zone of zones) {
      if (Array.isArray(owner[zone]) && owner[zone].includes(card)) {
        return { owner, zone };
      }
    }
  }
  return null;
}

function findCardInPlayerGraveyardByInstance(player, instanceId) {
  if (instanceId === undefined || instanceId === null) return null;
  return (player?.graveyard || []).find(
    (card) => getCardInstanceId(card) === instanceId,
  );
}

function matchesActionFilters(engine, card, filters = {}) {
  if (!card) return false;
  if (!filters || Object.keys(filters).length === 0) return true;
  if (typeof engine?.cardMatchesFilters === "function") {
    return engine.cardMatchesFilters(card, filters);
  }
  if (filters.cardKind) {
    const expected = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind];
    if (!expected.includes(card.cardKind)) return false;
  }
  if (filters.monsterType) {
    const expected = Array.isArray(filters.monsterType)
      ? filters.monsterType
      : [filters.monsterType];
    if (!expected.includes(card.monsterType)) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.isTuner !== undefined) {
    if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
  }
  return true;
}

function getSynchroCandidateFilters(action = {}) {
  return {
    cardKind: "monster",
    monsterType: "synchro",
    ...(action.filters || action.candidateFilters || {}),
  };
}

function getLegalSynchroEntries(game, player, action, engine) {
  if (!game || !player) return [];
  const filters = getSynchroCandidateFilters(action);
  return (player.extraDeck || [])
    .filter((card) => matchesActionFilters(engine, card, filters))
    .map((card) => {
      const check = game.canSummonSynchroCard?.(player, card, {
        checkActionWindow: false,
        silent: true,
      });
      return { card, check };
    })
    .filter((entry) => entry.check?.ok === true);
}

function buildCardChoiceContract(game, player, cards, action) {
  const owner = player?.id === "player" ? "player" : "opponent";
  const candidates = cards.map((card, index) => ({
    key:
      game.buildSelectionCandidateKey?.(
        {
          name: card.name,
          owner,
          controller: player?.id || owner,
          zone: "extraDeck",
          zoneIndex: (player?.extraDeck || []).indexOf(card),
          cardRef: card,
        },
        index,
      ) || `extraDeck_${getCardInstanceId(card) || card.id}_${index}`,
    name: card.name,
    image: card.image,
    atk: card.atk,
    def: card.def,
    level: card.level,
    cardKind: card.cardKind,
    monsterType: card.monsterType,
    owner,
    controller: player?.id || owner,
    zone: "extraDeck",
    zoneIndex: (player?.extraDeck || []).indexOf(card),
    cardRef: card,
  }));
  return {
    kind: "choice",
    message: action.selectionMessage || "Select a Synchro Monster to Summon.",
    requirements: [
      {
        id: "synchro_extra_deck_card",
        min: 1,
        max: 1,
        zones: ["extraDeck"],
        owner,
        candidates,
        label: "Synchro Monster",
      },
    ],
    ui: { useFieldTargeting: false, allowCancel: action.allowCancel !== false },
    metadata: {
      context: "effect_synchro_summon_extra_deck",
      sourceCard: action.sourceCard || null,
    },
  };
}

function buildMaterialSelectionContract(game, card, player, candidates) {
  const owner = player?.id === "player" ? "player" : "opponent";
  const decorated = candidates.map((material, index) => {
    const zoneIndex = (player?.field || []).indexOf(material);
    const candidate = {
      name: material.name,
      image: material.image,
      owner,
      controller: player?.id || owner,
      zone: "field",
      zoneIndex,
      atk: material.atk || 0,
      def: material.def || 0,
      level: getCardLevel(material),
      cardKind: material.cardKind,
      monsterType: material.monsterType,
      cardRef: material,
    };
    candidate.key =
      game.buildSelectionCandidateKey?.(candidate, index) ||
      `${player?.id || owner}:field:${zoneIndex}:${material.id || index}`;
    return candidate;
  });
  return {
    kind: "synchro",
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
      context: "effect_synchro_materials",
      sourceCard: card,
    },
  };
}

async function confirmOptionalRevive(game, player, action, source) {
  if (isAI(player)) return true;
  const ui = getUI(game);
  if (typeof ui?.showConfirmPrompt !== "function") return true;
  const result = ui.showConfirmPrompt(
    action.promptMessage ||
      `Special Summon the Synchro Materials used for ${source?.name || "that monster"}?`,
    {
      title: action.promptTitle || "Confirm",
      confirmLabel: action.confirmLabel || "Special Summon",
      cancelLabel: action.cancelLabel || "Cancel",
    },
  );
  return result && typeof result.then === "function"
    ? !!(await result)
    : !!result;
}

function canSpecialSummonMaterial(game, player, card, options = {}) {
  if (!game || !player || !card || card.cardKind !== "monster") return false;
  if (card.cannotBeSpecialSummoned) return false;
  if (
    Array.isArray(card.specialSummonOnlyBy) &&
    !card.specialSummonOnlyBy.includes("special")
  ) {
    return false;
  }
  const restrictionCheck = game.canSpecialSummonUnderRestrictions?.(card, player, {
    summonMethod: "special",
    fromZone: "graveyard",
    silent: true,
  });
  if (restrictionCheck?.ok === false) return false;
  const placementCheck = game.canPlaceCardOnField?.(card, player, {
    isFacedown: false,
    excludeCards: options.excludeCards || [],
    summonMethod: "special",
    summonProcedure: null,
    silent: true,
  });
  return placementCheck?.ok !== false;
}

function resolveDeSynchroMaterials(game, player, synchroCard) {
  const materialMetadata = Array.isArray(synchroCard?.synchroMaterials)
    ? synchroCard.synchroMaterials
    : [];
  if (materialMetadata.length === 0) {
    return { ok: false, reason: "No recorded Synchro Materials." };
  }
  const materials = [];
  for (const entry of materialMetadata) {
    const card = findCardInPlayerGraveyardByInstance(player, entry?.instanceId);
    if (!card) {
      return { ok: false, reason: "Not all Synchro Materials are in your Graveyard." };
    }
    if (
      !canSpecialSummonMaterial(game, player, card, {
        excludeCards: [synchroCard],
      })
    ) {
      return { ok: false, reason: `${card.name} cannot be Special Summoned.` };
    }
    materials.push(card);
  }
  const targetOnOwnField = (player.field || []).includes(synchroCard);
  const freeZones = Math.max(
    0,
    5 - (player.field || []).length + (targetOnOwnField ? 1 : 0),
  );
  if (materials.length > freeZones) {
    return { ok: false, reason: "Not enough Monster Zones." };
  }
  return { ok: true, materials };
}

export async function handleDeSynchro(action, ctx, targets, engine) {
  const game = engine?.game;
  const player = ctx?.player;
  if (!game || !player) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: action.targetRef,
  });
  const synchroCard = targetCards.find(
    (card) =>
      card?.cardKind === "monster" &&
      card.monsterType === "synchro" &&
      card.isFacedown !== true,
  );
  if (!synchroCard) {
    getUI(game)?.log("No valid Synchro Monster selected.");
    return false;
  }

  const targetLocation = findCardLocation(game, synchroCard);
  if (targetLocation?.zone !== "field") {
    getUI(game)?.log("The selected Synchro Monster is no longer on the field.");
    return false;
  }

  const homePlayer =
    getOwnerById(game, synchroCard.owner, targetLocation.owner) ||
    targetLocation.owner;
  const reviveCheck = resolveDeSynchroMaterials(game, player, synchroCard);

  const moveResult = await game.moveCard(synchroCard, homePlayer, "extraDeck", {
    fromZone: "field",
    contextLabel: action.contextLabel || "de_synchro_return",
    sourceCard: ctx?.source || null,
    effectId: ctx?.effect?.id || null,
  });
  if (moveResult?.success === false) {
    getUI(game)?.log(moveResult.reason || "Could not return the Synchro Monster.");
    return false;
  }

  if (reviveCheck.ok !== true) {
    if (reviveCheck.reason) getUI(game)?.log(reviveCheck.reason);
    return true;
  }

  const shouldRevive = await confirmOptionalRevive(
    game,
    player,
    action,
    synchroCard,
  );
  if (!shouldRevive) return true;

  for (const material of reviveCheck.materials) {
    if (!player.graveyard?.includes(material)) continue;
    if ((player.field || []).length >= 5) break;
    const position = await engine.chooseSpecialSummonPosition(material, player, {
      position: action.position || "choice",
    });
    const result = await game.moveCard(material, player, "field", {
      fromZone: "graveyard",
      position,
      isFacedown: false,
      resetAttackFlags: true,
      summonMethodOverride: "special",
      contextLabel: action.reviveContextLabel || "de_synchro_material_summon",
      sourceCard: ctx?.source || null,
      effectId: ctx?.effect?.id || null,
    });
    if (result?.success === false) {
      getUI(game)?.log(result.reason || `${material.name} could not be Summoned.`);
      break;
    }
  }

  return true;
}

export async function handleSynchroSummonFromExtraDeck(
  action,
  ctx,
  targets,
  engine,
) {
  const game = engine?.game;
  const player =
    action.player === "opponent" ? ctx?.opponent : ctx?.player;
  if (!game || !player) return false;

  const legalEntries = getLegalSynchroEntries(game, player, action, engine);
  if (legalEntries.length === 0) {
    getUI(game)?.log("No legal Synchro Summon is available.");
    return false;
  }

  let selectedEntry = null;
  if (isAI(player)) {
    selectedEntry = legalEntries
      .slice()
      .sort(
        (a, b) =>
          Number(b.card?.atk || 0) +
          Number(b.card?.def || 0) -
          (Number(a.card?.atk || 0) + Number(a.card?.def || 0)),
      )[0];
  } else {
    const cardContract = buildCardChoiceContract(
      game,
      player,
      legalEntries.map((entry) => entry.card),
      action,
    );
    const keys = await selectCards({
      game,
      player,
      selectionContract: cardContract,
      requirementId: "synchro_extra_deck_card",
      kind: "synchro_extra_deck",
    });
    if (!Array.isArray(keys) || keys.length === 0) {
      return false;
    }
    const selectedKey = keys[0];
    const candidate = cardContract.requirements[0].candidates.find(
      (entry) => entry.key === selectedKey,
    )?.cardRef;
    selectedEntry = legalEntries.find((entry) => entry.card === candidate);
  }

  const synchroCard = selectedEntry?.card;
  if (!synchroCard) return false;
  const check =
    game.canSummonSynchroCard?.(player, synchroCard, {
      checkActionWindow: false,
      silent: false,
    }) || selectedEntry.check;
  if (check?.ok !== true) {
    getUI(game)?.log(check?.reason || "Cannot Synchro Summon this card.");
    return false;
  }

  let materials = null;
  if (isAI(player)) {
    materials = check.materialCombos?.[0] || [];
  } else {
    const materialContract = buildMaterialSelectionContract(
      game,
      synchroCard,
      player,
      check.candidates || [],
    );
    const keys = await selectCards({
      game,
      player,
      selectionContract: materialContract,
      requirementId: "synchro_materials",
      kind: "synchro",
    });
    if (!Array.isArray(keys) || keys.length === 0) return false;
    materials = keys
      .map((key) =>
        materialContract.requirements[0].candidates.find(
          (candidate) => candidate.key === key,
        )?.cardRef,
      )
      .filter(Boolean);
  }

  const result = await game.performSynchroSummon?.(
    player,
    materials,
    synchroCard,
    {
      checkActionWindow: false,
      position: action.position,
      actionContext: ctx?.actionContext || ctx?.activationContext?.actionContext,
    },
  );
  return result?.success === true;
}

export function hasSynchroSummonPreviewCandidate(engine, action, ctx) {
  const game = engine?.game;
  const player = action?.player === "opponent" ? ctx?.opponent : ctx?.player;
  if (!game || !player) return false;

  const filters = getSynchroCandidateFilters(action);
  const extraDeckCandidates = (player.extraDeck || []).filter((card) =>
    matchesActionFilters(engine, card, filters),
  );
  if (extraDeckCandidates.length === 0) return false;

  const pending = action.previewPendingSummon || null;
  const pendingCards = pending
    ? (player[pending.zone || "graveyard"] || []).filter((card) =>
        matchesActionFilters(engine, card, pending.filters || {}),
      )
    : [null];
  if (pendingCards.length === 0) return false;

  const gameLike = {
    effectEngine: {
      cardMatchesFilters: engine?.cardMatchesFilters?.bind(engine),
      isEffectNegated: (card) => card?.effectsNegated === true,
    },
    canUseAsSynchroMaterial,
  };

  return pendingCards.some((pendingCard) => {
    if (pendingCard && !canSpecialSummonMaterial(game, player, pendingCard)) {
      return false;
    }
    const field = pendingCard
      ? [...(player.field || []), pendingCard]
      : [...(player.field || [])];
    const previewPlayer = { ...player, field };
    return extraDeckCandidates.some((card) => {
      const combos =
        getSynchroMaterialCombos.call(gameLike, previewPlayer, card) || [];
      return combos.some(
        (combo) => (field.length - combo.length + 1) <= 5,
      );
    });
  });
}
