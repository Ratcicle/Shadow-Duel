/**
 * modal.js
 *
 * Extra Deck modal methods extracted from Game.js.
 * Handles extra deck viewing UI.
 *
 * Methods: openExtraDeckModal, closeExtraDeckModal
 */

import { isAI } from "../../Player.js";

function cardMatchesRequirement(card, requirement = {}) {
  if (!card) return false;
  if (requirement.cardKind && card.cardKind !== requirement.cardKind) return false;
  if (requirement.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(requirement.archetype)) return false;
  }
  if (requirement.type && card.type !== requirement.type) return false;
  if (requirement.name && card.name !== requirement.name) return false;
  return true;
}

function getProcedureMaterials(player, procedure) {
  const materialReq = procedure?.materials?.[0] || null;
  if (!player || !materialReq) return [];
  const zone = materialReq.zone || "graveyard";
  const list = Array.isArray(player[zone]) ? player[zone] : [];
  return list.filter((card) => cardMatchesRequirement(card, materialReq));
}

export function canSummonExtraDeckCardByProcedure(card, player, options = {}) {
  const procedure = card?.extraDeckSummonProcedure;
  if (!card || !player || !procedure) {
    return { ok: false, reason: "No summon procedure." };
  }
  if (procedure.type !== "graveyard_banish_fusion") {
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
  const materialReq = procedure.materials?.[0] || {};
  const requiredCount = Number(materialReq.count || 0);
  const candidates = getProcedureMaterials(player, procedure);
  if (candidates.length < requiredCount) {
    return {
      ok: false,
      reason: `Need ${requiredCount} valid material(s) in the Graveyard.`,
      candidates,
    };
  }
  const fieldCheck = this.canPlaceCardOnField?.(card, player, {
    isFacedown: false,
    silent: options.silent !== false,
  });
  if (fieldCheck?.ok === false) {
    return { ...fieldCheck, candidates };
  }
  return { ok: true, candidates, requiredCount, procedure };
}

function buildMaterialSelectionContract(card, candidates, count) {
  return {
    requirements: [
      {
        id: "extra_deck_materials",
        candidates: candidates.map((material, index) => ({
          key: `gy_${material.instanceId || material.id}_${index}`,
          cardRef: material,
          name: material.name,
          image: material.image,
          atk: material.atk,
          def: material.def,
          zone: "graveyard",
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

  for (const material of materials) {
    await this.moveCard(material, player, procedure.materialDestination || "banished", {
      fromZone: "graveyard",
      contextLabel: "extra_deck_summon_material",
    });
  }

  const position = options.position || "attack";
  const result = await this.moveCard(card, player, "field", {
    fromZone: "extraDeck",
    position,
    isFacedown: false,
    resetAttackFlags: true,
    summonMethodOverride: procedure.summonMethod || "fusion",
    summonProcedure: procedure.type,
    contextLabel: "extra_deck_summon_procedure",
  });
  if (result?.success === false) {
    return result;
  }
  this.closeExtraDeckModal?.();
  this.ui?.log?.(`${card.name} was Fusion Summoned.`);
  this.updateBoard?.();
  return { success: true };
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
    if (!card?.extraDeckSummonProcedure) continue;
    availability.set(
      card,
      this.canSummonExtraDeckCardByProcedure(card, player, { silent: true }),
    );
  }
  this.ui.renderExtraDeckModal(player.extraDeck, {
    isSummonable: (card) => canUseProcedures && availability.get(card)?.ok === true,
    getDisabledReason: (card) => availability.get(card)?.reason || null,
    onCardClick: async (card) => {
      if (!canUseProcedures || availability.get(card)?.ok !== true) return;
      await this.performExtraDeckSummonProcedure(card, player);
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
