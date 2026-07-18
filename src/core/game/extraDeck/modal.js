/**
 * modal.js
 *
 * Extra Deck modal methods extracted from Game.js.
 * Handles extra deck viewing UI.
 *
 * Methods: openExtraDeckModal, closeExtraDeckModal
 */

import { isAI } from "../../Player.js";
import {
  SUMMON_MODES,
  SUMMON_ORIGINS,
} from "../summon/transaction.js";

const SUPPORTED_PROCEDURE_TYPES = new Set([
  "graveyard_banish_fusion",
  "contact_fusion",
]);

function asArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return fallback;
  return [value];
}

function cardHasArchetype(card, archetype) {
  if (!archetype) return true;
  const archetypes = Array.isArray(card?.archetypes)
    ? card.archetypes
    : card?.archetype
      ? [card.archetype]
      : [];
  return archetypes.includes(archetype);
}

function cardMatchesRequirement(card, requirement = {}, materialZone = null) {
  if (!card) return false;
  if (requirement.cardKind && card.cardKind !== requirement.cardKind) return false;
  if (requirement.archetype && !cardHasArchetype(card, requirement.archetype)) {
    return false;
  }
  if (requirement.type && card.type !== requirement.type) return false;
  if (requirement.name && card.name !== requirement.name) return false;
  if (requirement.attribute) {
    const expected = String(requirement.attribute).toLowerCase();
    if (String(card.attribute || "").toLowerCase() !== expected) return false;
  }
  if (requirement.minLevel !== undefined && (card.level || 0) < requirement.minLevel) {
    return false;
  }
  if (requirement.maxLevel !== undefined && (card.level || 0) > requirement.maxLevel) {
    return false;
  }
  const allowedZones = asArray(requirement.allowedZones, null);
  if (allowedZones && materialZone && !allowedZones.includes(materialZone)) {
    return false;
  }
  return true;
}

function getProcedureMaterials(player, procedure) {
  const materialReq = procedure?.materials?.[0] || null;
  if (!player || !materialReq) return [];
  const zone = materialReq.zone || "graveyard";
  const list = Array.isArray(player[zone]) ? player[zone] : [];
  return list.filter((card) => cardMatchesRequirement(card, materialReq, zone));
}

function expandMaterialRequirements(requirements = []) {
  const expanded = [];
  for (const requirement of requirements) {
    const count = Number(requirement?.count || 1);
    for (let index = 0; index < Math.max(1, count); index += 1) {
      expanded.push(requirement || {});
    }
  }
  return expanded;
}

function findMaterialCombos(requirements = [], materialEntries = []) {
  const expanded = expandMaterialRequirements(requirements);
  if (expanded.length === 0 || materialEntries.length < expanded.length) {
    return [];
  }

  const combos = [];
  const search = (reqIndex, picked, remaining) => {
    if (reqIndex >= expanded.length) {
      combos.push(picked.map((entry) => entry.card));
      return;
    }

    const requirement = expanded[reqIndex];
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      if (!cardMatchesRequirement(entry.card, requirement, entry.zone)) {
        continue;
      }
      search(
        reqIndex + 1,
        [...picked, entry],
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
      );
    }
  };

  search(0, [], materialEntries);
  return combos;
}

function getContactFusionMaterialEntries(card, player) {
  const requirements = card?.fusionMaterials || [];
  const allowedZones = new Set();
  for (const requirement of requirements) {
    for (const zone of asArray(requirement?.allowedZones, ["field"])) {
      allowedZones.add(zone);
    }
  }
  if (allowedZones.size === 0) allowedZones.add("field");

  const entries = [];
  for (const zone of allowedZones) {
    const list = Array.isArray(player?.[zone]) ? player[zone] : [];
    for (const material of list) {
      entries.push({ card: material, zone });
    }
  }
  return entries;
}

function uniqueCards(cards = []) {
  const seen = new Set();
  const unique = [];
  for (const card of cards) {
    if (!card || seen.has(card)) continue;
    seen.add(card);
    unique.push(card);
  }
  return unique;
}

function materialSelectionMatchesCombo(materials = [], combos = []) {
  if (!Array.isArray(materials) || !Array.isArray(combos)) return false;
  return combos.some((combo) => {
    if (!Array.isArray(combo) || combo.length !== materials.length) return false;
    const remaining = [...combo];
    for (const material of materials) {
      const index = remaining.indexOf(material);
      if (index < 0) return false;
      remaining.splice(index, 1);
    }
    return true;
  });
}

function getDefaultMaterialDestination(procedure) {
  if (procedure?.materialDestination) return procedure.materialDestination;
  return procedure?.type === "contact_fusion" ? "graveyard" : "banished";
}

function getDefaultMaterialSourceZone(procedure) {
  if (procedure?.type === "contact_fusion") return "field";
  return procedure?.materials?.[0]?.zone || "graveyard";
}

function isAscensionExtraDeckCard(card) {
  return (
    card &&
    card.cardKind === "monster" &&
    card.monsterType === "ascension" &&
    card.ascension &&
    typeof card.ascension === "object"
  );
}

function isSynchroExtraDeckCard(card) {
  return (
    card &&
    card.cardKind === "monster" &&
    card.monsterType === "synchro"
  );
}

function buildAscensionMaterialCandidates(game, ascensionCard, player) {
  if (!game || !isAscensionExtraDeckCard(ascensionCard) || !player) {
    return [];
  }
  const materials = [];
  for (const material of player.field || []) {
    if (!material) continue;
    const materialCheck = game.canUseAsAscensionMaterial?.(player, material);
    if (materialCheck?.ok !== true) continue;
    const requirementCheck = game.checkAscensionRequirements?.(
      player,
      ascensionCard,
      material,
    );
    if (requirementCheck?.ok === true) {
      materials.push(material);
    }
  }
  return materials;
}

function buildAscensionMaterialSelectionContract(
  ascensionCard,
  player,
  materials,
  game,
) {
  const owner = player.id === "player" ? "player" : "opponent";
  const candidates = materials
    .map((material) => {
      const zoneIndex = player.field.indexOf(material);
      return {
        name: material.name,
        owner,
        controller: player.id,
        zone: "field",
        zoneIndex,
        atk: material.atk || 0,
        def: material.def || 0,
        level: material.level || 0,
        cardKind: material.cardKind,
        cardRef: material,
      };
    })
    .map((cand, idx) => ({
      ...cand,
      key:
        game.buildSelectionCandidateKey?.(cand, idx) ||
        `${cand.zoneIndex}:${idx}`,
    }));

  return {
    kind: "choice",
    message: `Select Ascension material for ${ascensionCard.name}.`,
    requirements: [
      {
        id: "ascension_material",
        min: 1,
        max: 1,
        zones: ["field"],
        owner,
        filters: {},
        allowSelf: true,
        distinct: true,
        candidates,
      },
    ],
    ui: { useFieldTargeting: true, allowCancel: true },
    metadata: {
      context: "extra_deck_ascension_material",
      sourceCard: ascensionCard,
    },
  };
}

export function canSummonExtraDeckCardByProcedure(card, player, options = {}) {
  const procedure = card?.extraDeckSummonProcedure;
  if (!card || !player || !procedure) {
    return { ok: false, reason: "No summon procedure." };
  }
  if (!SUPPORTED_PROCEDURE_TYPES.has(procedure.type)) {
    return { ok: false, reason: "Unsupported summon procedure." };
  }
  if (
    options.checkActionWindow !== false &&
    typeof this.canStartAction === "function"
  ) {
    const actionCheck = this.canStartAction({
      actor: player,
      kind: "extra_deck_summon",
      phaseReq: ["main1", "main2"],
      silent: options.silent !== false,
    });
    if (!actionCheck.ok) {
      return {
        ok: false,
        reason: actionCheck.reason || "This card cannot be summoned now.",
      };
    }
  }
  if (Array.isArray(card.specialSummonOnlyBy)) {
    if (!card.specialSummonOnlyBy.includes(procedure.type)) {
      return { ok: false, reason: "Summon procedure is not allowed." };
    }
  }
  let requiredCount = 0;
  let candidates = [];
  let materialCombos = null;
  let materialEntries = [];
  let fieldCheckExclusions = [];

  if (procedure.type === "contact_fusion") {
    const requirements = card.fusionMaterials || [];
    materialEntries = getContactFusionMaterialEntries(card, player);
    materialCombos = findMaterialCombos(requirements, materialEntries);
    requiredCount = expandMaterialRequirements(requirements).length;
    candidates = uniqueCards(materialCombos.flat());
    fieldCheckExclusions = materialCombos[0] || [];
  } else {
    const materialReq = procedure.materials?.[0] || {};
    requiredCount = Number(materialReq.count || 0);
    candidates = getProcedureMaterials(player, procedure);
    materialEntries = candidates.map((material) => ({
      card: material,
      zone: materialReq.zone || "graveyard",
    }));
  }

  if (
    candidates.length < requiredCount ||
    (materialCombos && materialCombos.length === 0)
  ) {
    const zoneLabel =
      procedure.type === "contact_fusion" ? "on the field" : "in the Graveyard";
    return {
      ok: false,
      reason: `Need ${requiredCount} valid material(s) ${zoneLabel}.`,
      candidates,
      materialCombos,
      materialEntries,
    };
  }
  const fieldCheck = this.canPlaceCardOnField?.(card, player, {
    isFacedown: false,
    excludeCards: fieldCheckExclusions,
    summonMethod: procedure.type === "contact_fusion" ? "fusion" : procedure.type,
    summonProcedure: procedure.type,
    silent: options.silent !== false,
  });
  if (fieldCheck?.ok === false) {
    return { ...fieldCheck, candidates, materialCombos, materialEntries };
  }
  return {
    ok: true,
    candidates,
    requiredCount,
    procedure,
    materialCombos,
    materialEntries,
  };
}

export function canSummonAscensionCardFromExtraDeck(card, player, options = {}) {
  if (!isAscensionExtraDeckCard(card) || !player) {
    return { ok: false, reason: "No Ascension summon procedure." };
  }
  if (
    options.checkActionWindow !== false &&
    typeof this.canStartAction === "function"
  ) {
    const actionCheck = this.canStartAction({
      actor: player,
      kind: "ascension_summon",
      phaseReq: ["main1", "main2"],
      silent: options.silent !== false,
    });
    if (!actionCheck.ok) {
      return {
        ok: false,
        reason: actionCheck.reason || "This card cannot be summoned now.",
      };
    }
  }

  const candidates = buildAscensionMaterialCandidates(this, card, player);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "No valid Ascension material on the field.",
      candidates,
    };
  }

  const fieldChecks = candidates.map((material) => ({
    material,
    check: this.canPlaceCardOnField?.(card, player, {
      isFacedown: false,
      excludeCards: [material],
      summonMethod: "ascension",
      summonProcedure: "ascension",
      silent: options.silent !== false,
    }) || { ok: true },
  }));
  const validAfterFieldChecks = fieldChecks
    .filter(({ check }) => check?.ok !== false)
    .map(({ material }) => material);
  if (validAfterFieldChecks.length === 0) {
    const reason =
      fieldChecks.find(({ check }) => check?.reason)?.check?.reason ||
      "Cannot place Ascension monster on the field.";
    return { ok: false, reason, candidates };
  }

  return {
    ok: true,
    type: "ascension",
    candidates: validAfterFieldChecks,
    requiredCount: 1,
  };
}

export function canSummonExtraDeckCard(card, player, options = {}) {
  if (card?.extraDeckSummonProcedure) {
    const procedureCheck = this.canSummonExtraDeckCardByProcedure(
      card,
      player,
      options,
    );
    if (procedureCheck.ok) {
      return { ...procedureCheck, type: "procedure" };
    }
    if (!isAscensionExtraDeckCard(card)) {
      return { ...procedureCheck, type: "procedure" };
    }
  }

  if (isAscensionExtraDeckCard(card)) {
    return this.canSummonAscensionCardFromExtraDeck(card, player, options);
  }

  if (isSynchroExtraDeckCard(card)) {
    return this.canSummonSynchroCard?.(player, card, options) || {
      ok: false,
      reason: "No Synchro summon procedure.",
      type: "synchro",
    };
  }

  return { ok: false, reason: null, type: "none" };
}

function buildMaterialSelectionContract(
  card,
  candidates,
  count,
  procedure,
  materialEntries = [],
) {
  const defaultZone = getDefaultMaterialSourceZone(procedure);
  const getMaterialZone = (material) =>
    materialEntries.find((entry) => entry.card === material)?.zone || defaultZone;
  return {
    requirements: [
      {
        id: "extra_deck_materials",
        candidates: candidates.map((material, index) => ({
          key: `${getMaterialZone(material)}_${material.instanceId || material.id}_${index}`,
          cardRef: material,
          name: material.name,
          image: material.image,
          atk: material.atk,
          def: material.def,
          zone: getMaterialZone(material),
          owner: material.owner,
        })),
        min: count,
        max: count,
        label: `Select ${count} Fusion Materials`,
      },
    ],
    ui: {
      allowCancel: true,
      message: `Select materials for ${card.name}`,
    },
  };
}

export async function performExtraDeckSummonProcedure(cardOrIndex, player, options = {}) {
  const extraDeck = player?.extraDeck || [];
  const card =
    typeof cardOrIndex === "number" ? extraDeck[cardOrIndex] : cardOrIndex;
  if (!card || !player) return { success: false, reason: "missing_card" };

  const check = this.canSummonExtraDeckCardByProcedure(card, player, {
    silent: false,
    checkActionWindow: !Array.isArray(options.materials),
  });
  if (!check.ok) {
    this.ui?.log?.(check.reason || "Cannot summon this card.");
    return { success: false, reason: check.reason || "procedure_unavailable" };
  }

  const procedure = check.procedure;
  const requiredCount = check.requiredCount;
  let materials = Array.isArray(options.materials) ? options.materials : null;

  if (!materials) {
    const contract = buildMaterialSelectionContract(
      card,
      check.candidates,
      requiredCount,
      procedure,
      check.materialEntries,
    );

    if (isAI(player)) {
      const auto = this.autoSelector?.select?.(contract, {
        owner: player,
        selectionKind: "extra_deck_materials",
      });
      const keys = auto?.selections?.extra_deck_materials || [];
      materials = keys
        .map((key) =>
          contract.requirements[0].candidates.find((cand) => cand.key === key)
            ?.cardRef,
        )
            .filter(Boolean);
      if (
        check.materialCombos &&
        !materialSelectionMatchesCombo(materials, check.materialCombos)
      ) {
        materials = check.materialCombos[0] || [];
      }
    } else {
      this.startTargetSelectionSession({
        kind: "extra_deck_summon",
        card,
        owner: player,
        selectionContract: contract,
        message: contract.ui.message,
        execute: (selections) => {
          const keys = selections?.extra_deck_materials || [];
          const selected = keys
            .map((key) =>
              contract.requirements[0].candidates.find((cand) => cand.key === key)
                ?.cardRef,
            )
            .filter(Boolean);
          void this.performExtraDeckSummonProcedure(card, player, {
            materials: selected,
          });
          return { success: true, needsSelection: false };
        },
      });
      return { success: false, needsSelection: true, selectionContract: contract };
    }
  }

  if (!Array.isArray(materials) || materials.length !== requiredCount) {
    return { success: false, reason: "invalid_material_count" };
  }
  const candidateSet = new Set(check.candidates);
  if (materials.some((material) => !candidateSet.has(material))) {
    return { success: false, reason: "invalid_materials" };
  }
  if (
    check.materialCombos &&
    !materialSelectionMatchesCombo(materials, check.materialCombos)
  ) {
    return { success: false, reason: "invalid_materials" };
  }

  const position = options.position || "attack";
  const prepared = this.createPreparedSummon({
    card,
    controller: player,
    sourceZone: "extraDeck",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: procedure.summonMethod || "fusion",
    summonProcedure: procedure.type,
    position,
    costPayments: materials.map((material) => {
      const materialEntry = check.materialEntries?.find(
        (entry) => entry.card === material,
      );
      const materialDestination = getDefaultMaterialDestination(procedure);
      return {
        card: material,
        owner: player,
        fromZone:
          materialEntry?.zone || getDefaultMaterialSourceZone(procedure),
        toZone: materialDestination,
        kind: "extra_deck_material",
        contextLabel: "extra_deck_summon_material",
        options: {
          awaitCardToGraveEvent: materialDestination === "graveyard",
          awaitCardMovedEvent: true,
        },
      };
    }),
    perform: async (transaction) =>
      await this.moveCard(card, player, "field", {
        fromZone: "extraDeck",
        position,
        isFacedown: false,
        resetAttackFlags: true,
        summonMethodOverride: procedure.summonMethod || "fusion",
        summonProcedure: procedure.type,
        summonOrigin: SUMMON_ORIGINS.PROCEDURE,
        summonTransaction: transaction,
        contextLabel: "extra_deck_summon_procedure",
        awaitCardMovedEvent: true,
      }),
  });
  const result = await this.executeSummonTransaction(prepared);
  if (result?.success === false) {
    return result;
  }
  this.closeExtraDeckModal?.();
  this.ui?.log?.(`${card.name} was Fusion Summoned.`);
  this.updateBoard?.();
  return { ...result, success: true };
}

export async function performAscensionSummonFromExtraDeck(
  cardOrIndex,
  player,
  options = {},
) {
  const extraDeck = player?.extraDeck || [];
  const card =
    typeof cardOrIndex === "number" ? extraDeck[cardOrIndex] : cardOrIndex;
  if (!card || !player) return { success: false, reason: "missing_card" };

  const check = this.canSummonAscensionCardFromExtraDeck(card, player, {
    silent: false,
    checkActionWindow: !options.material,
  });
  if (!check.ok) {
    this.ui?.log?.(check.reason || "Cannot Ascension Summon this card.");
    return { success: false, reason: check.reason || "ascension_unavailable" };
  }

  const materials = check.candidates || [];
  const material =
    options.material || (materials.length === 1 ? materials[0] : null);
  if (material) {
    this.closeExtraDeckModal?.();
    return await this.performAscensionSummon(player, material, card);
  }

  const selectionContract = buildAscensionMaterialSelectionContract(
    card,
    player,
    materials,
    this,
  );
  this.closeExtraDeckModal?.();
  this.startTargetSelectionSession({
    kind: "ascension",
    card,
    selectionContract,
    message: selectionContract.message,
    execute: async (selections) => {
      const key = (selections?.ascension_material || [])[0];
      const chosen =
        selectionContract.requirements[0].candidates.find(
          (candidate) => candidate.key === key,
        )?.cardRef || null;
      if (!chosen) {
        return {
          success: false,
          needsSelection: false,
          reason: "No Ascension material selected.",
        };
      }
      return await this.performAscensionSummon(player, chosen, card);
    },
  });
  return {
    success: false,
    needsSelection: true,
    selectionContract,
  };
}

/**
 * Opens the Extra Deck modal for a player.
 * @param {Object} player - The player whose Extra Deck to show
 */
export function openExtraDeckModal(player) {
  const activePlayer = this.turn === player?.id;
  const canUseProcedures = activePlayer && !isAI(player);
  const availability = new Map();
  for (const card of player?.extraDeck || []) {
    const check = this.canSummonExtraDeckCard?.(card, player, {
      silent: true,
    }) || { ok: false, reason: null };
    if (check.type !== "none" || check.reason) {
      availability.set(card, check);
    }
  }
  this.ui.renderExtraDeckModal(player.extraDeck, {
    isSummonable: (card) => canUseProcedures && availability.get(card)?.ok === true,
    getDisabledReason: (card) => availability.get(card)?.reason || null,
    onCardClick: async (card) => {
      if (!canUseProcedures) return;
      const check = availability.get(card);
      if (check?.ok !== true) return;
      if (check.type === "ascension") {
        await this.performAscensionSummonFromExtraDeck(card, player);
      } else if (check.type === "synchro") {
        await this.performSynchroSummonFromExtraDeck(card, player);
      } else {
        await this.performExtraDeckSummonProcedure(card, player);
      }
    },
  });
  this.ui.toggleExtraDeckModal(true);
}

/**
 * Closes the Extra Deck modal.
 */
export function closeExtraDeckModal() {
  this.ui?.toggleExtraDeckModal?.(false);
}
