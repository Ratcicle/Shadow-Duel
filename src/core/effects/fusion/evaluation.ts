import type { ActionRuntimePlayer } from "../../contracts/actionRuntime.js";
import type { FusionCard, FusionRequirement } from "./requirements.js";
import type { matchesFusionRequirement } from "./requirements.js";

interface FusionEvaluationOptions {
  readonly materialZone?: string;
  readonly materialInfo?: readonly { readonly zone: string }[];
}
interface IndexedMaterial<Card extends FusionCard> {
  card: Card;
  originalIndex: number;
  zone: string;
}
interface FusionEvaluationHost {
  game?: {
    canSpecialSummonUnderRestrictions?(
      card: FusionCard,
      player: ActionRuntimePlayer,
      options: {
        summonMethod: "fusion";
        summonProcedure: "fusion";
        silent: boolean;
      },
    ): { ok: boolean };
  };
  getFusionRequirements(card: FusionCard): readonly FusionRequirement[];
  getRequiredMaterialCount(card: FusionCard): number;
  matchesFusionRequirement: typeof matchesFusionRequirement;
  findFusionMaterialCombos<Card extends FusionCard>(
    card: FusionCard,
    materials: readonly Card[],
    options?: FusionEvaluationOptions,
  ): Card[][];
  canSummonFusion(
    card: FusionCard,
    materials: readonly FusionCard[],
    player: ActionRuntimePlayer,
    options?: FusionEvaluationOptions,
  ): boolean;
}

/**
 * Fusion Evaluation Module
 * Extracted from EffectEngine.js - handles fusion availability and material combos
 *
 * All functions assume `this` = EffectEngine instance
 */

/**
 * Convert a requirement object to the string format expected by matchesFusionRequirement
 * For complex requirements with multiple conditions (archetype + minLevel), returns an object
 */
function requirementToString(requirement: FusionRequirement | undefined) {
  if (typeof requirement === "string") {
    return requirement;
  }
  if (typeof requirement === "object" && requirement !== null) {
    // Object format: { name: "Card Name" } or { archetype: "Archetype", minLevel: 5 }
    // Keep combined requirements as objects so every declared filter is checked.
    if (
      requirement.cardKind ||
      requirement.isToken !== undefined ||
      requirement.isTuner !== undefined ||
      requirement.attribute ||
      requirement.minLevel !== undefined ||
      requirement.maxLevel !== undefined ||
      requirement.allowedZones
    ) {
      return requirement;
    }
    if (requirement.name) {
      return `name:${requirement.name}`;
    }
    // For requirements with multiple conditions (archetype + minLevel or type + minLevel)
    // return the object itself so matchesFusionRequirement can handle it
    if (
      (requirement.archetype || requirement.type) &&
      requirement.minLevel !== undefined
    ) {
      return requirement; // Return object for complex matching
    }
    if (requirement.archetype) {
      return `archetype:${requirement.archetype}`;
    }
    if (requirement.type) {
      return `type:${requirement.type}`;
    }
  }
  return null;
}

/**
 * Find all possible material combinations for a fusion monster
 */
export function findFusionMaterialCombos<Card extends FusionCard>(
  this: FusionEvaluationHost,
  fusionMonster: FusionCard,
  materials: readonly Card[],
  options: FusionEvaluationOptions = {},
): Card[][] {
  const requirements = this.getFusionRequirements(fusionMonster);

  if (!requirements || requirements.length === 0) {
    return [];
  }

  // Expand requirements based on count - each count becomes a separate requirement slot
  const expandedRequirements: FusionRequirement[] = [];
  for (const req of requirements) {
    const count = typeof req === "object" && req.count ? req.count : 1;
    for (let i = 0; i < count; i++) {
      expandedRequirements.push(req);
    }
  }

  // Check if we have enough materials
  if (materials.length < expandedRequirements.length) {
    return [];
  }

  const combos: Card[][] = [];
  const materialZone = options.materialZone || "field";
  const materialInfo = options.materialInfo || [];

  // Create indexed materials to track original positions
  const indexedMaterials = materials.map((mat, idx) => ({
    card: mat,
    originalIndex: idx,
    zone: materialInfo[idx]?.zone || materialZone,
  }));

  // Recursive function to find all valid combinations
  const findCombos = (
    reqIndex: number,
    usedMaterials: IndexedMaterial<Card>[],
    remainingIndexed: IndexedMaterial<Card>[],
  ): void => {
    // All requirements satisfied
    if (reqIndex >= expandedRequirements.length) {
      combos.push(usedMaterials.map((m) => m.card));
      return;
    }

    const requirement = expandedRequirements[reqIndex];
    const reqString = requirementToString(requirement);

    // Check for zone restrictions on this requirement
    const allowedZones =
      typeof requirement === "object" ? requirement.allowedZones : null;

    // Try each available material
    for (let i = 0; i < remainingIndexed.length; i++) {
      const indexed = remainingIndexed[i]!; // i is bounded by this dense material list.
      const material = indexed.card;
      const matZone = indexed.zone;

      // Check zone restriction if specified
      if (allowedZones && !allowedZones.includes(matZone)) {
        continue;
      }

      const matches = this.matchesFusionRequirement(
        material,
        reqString,
        matZone,
      );

      if (matches) {
        // Use this material and continue with next requirement
        const newRemaining = [
          ...remainingIndexed.slice(0, i),
          ...remainingIndexed.slice(i + 1),
        ];
        findCombos(reqIndex + 1, [...usedMaterials, indexed], newRemaining);
      }
    }
  };

  findCombos(0, [], indexedMaterials);
  return combos;
}

/**
 * Get the total required material count for a fusion monster
 */
export function getRequiredMaterialCount(
  this: FusionEvaluationHost,
  fusionMonster: FusionCard,
) {
  const requirements = this.getFusionRequirements(fusionMonster);
  if (!requirements || requirements.length === 0) return 0;

  return requirements.reduce((total, req) => {
    const count = typeof req === "object" && req.count ? req.count : 1;
    return total + count;
  }, 0);
}

/**
 * Evaluate if a selection of materials is valid for fusion
 */
export function evaluateFusionSelection(
  this: FusionEvaluationHost,
  fusionMonster: FusionCard,
  selectedMaterials: readonly FusionCard[],
  options: FusionEvaluationOptions = {},
) {
  const requirements = this.getFusionRequirements(fusionMonster);
  if (!requirements || requirements.length === 0) {
    return { valid: false, reason: "No fusion requirements defined" };
  }

  // Expand requirements based on count
  const expandedRequirements: FusionRequirement[] = [];
  for (const req of requirements) {
    const count = typeof req === "object" && req.count ? req.count : 1;
    for (let i = 0; i < count; i++) {
      expandedRequirements.push(req);
    }
  }

  if (selectedMaterials.length !== expandedRequirements.length) {
    return {
      valid: false,
      reason: `Need exactly ${expandedRequirements.length} materials, got ${selectedMaterials.length}`,
    };
  }

  const materialZone = options.materialZone || "field";

  // Check if each material satisfies its corresponding requirement
  const usedMaterials = new Set();
  for (let i = 0; i < expandedRequirements.length; i++) {
    const requirement = expandedRequirements[i];
    const reqString = requirementToString(requirement);

    // Find a matching material that hasn't been used
    let found = false;
    for (const material of selectedMaterials) {
      if (
        !usedMaterials.has(material) &&
        this.matchesFusionRequirement(material, reqString, materialZone)
      ) {
        usedMaterials.add(material);
        found = true;
        break;
      }
    }

    if (!found) {
      return {
        valid: false,
        reason: `No material satisfies requirement: ${reqString}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Check if a fusion monster can be summoned with available materials
 */
export function canSummonFusion(
  this: FusionEvaluationHost,
  fusionMonster: FusionCard,
  materials: readonly FusionCard[],
  player: ActionRuntimePlayer,
  options: FusionEvaluationOptions = {},
) {
  const requirements = this.getFusionRequirements(fusionMonster);
  if (!requirements || requirements.length === 0) return false;
  const restrictionCheck = this.game?.canSpecialSummonUnderRestrictions?.(
    fusionMonster,
    player,
    {
      summonMethod: "fusion",
      summonProcedure: "fusion",
      silent: true,
    },
  );
  if (restrictionCheck?.ok === false) return false;

  // Calculate total required materials
  const requiredCount = this.getRequiredMaterialCount(fusionMonster);
  if (materials.length < requiredCount) return false;

  const combos = this.findFusionMaterialCombos(
    fusionMonster,
    materials,
    options,
  );
  return combos.length > 0;
}

/**
 * Get all fusions that can be summoned with available materials
 * @param {Array} extraDeck - Extra deck cards
 * @param {Array} materials - Available material cards
 * @param {Object} player - Player object
 * @param {Object} options - Options including materialInfo with zone data
 */
export function getAvailableFusions<Card extends FusionCard>(
  this: FusionEvaluationHost,
  extraDeck: readonly Card[],
  materials: readonly Card[],
  player: ActionRuntimePlayer,
  options: FusionEvaluationOptions = {},
) {
  const availableFusions = [];

  for (const fusionCard of extraDeck) {
    if (fusionCard.monsterType !== "fusion") continue;

    if (this.canSummonFusion(fusionCard, materials, player, options)) {
      const combos = this.findFusionMaterialCombos(
        fusionCard,
        materials,
        options,
      );
      availableFusions.push({
        fusion: fusionCard,
        materialCombos: combos,
      });
    }
  }

  return availableFusions;
}
