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
function requirementToString(requirement) {
  if (typeof requirement === "string") {
    return requirement;
  }
  if (typeof requirement === "object" && requirement !== null) {
    // Object format: { name: "Card Name" } or { archetype: "Archetype", minLevel: 5 }
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
export function findFusionMaterialCombos(
  fusionMonster,
  materials,
  options = {}
) {
  const requirements = this.getFusionRequirements(fusionMonster);
  console.log(
    `[findFusionMaterialCombos] Fusion: ${fusionMonster.name}, requirements:`,
    requirements
  );

  if (!requirements || requirements.length === 0) {
    console.log(
      `[findFusionMaterialCombos] No requirements found for ${fusionMonster.name}`
    );
    return [];
  }

  // Expand requirements based on count - each count becomes a separate requirement slot
  const expandedRequirements = [];
  for (const req of requirements) {
    const count = typeof req === "object" && req.count ? req.count : 1;
    for (let i = 0; i < count; i++) {
      expandedRequirements.push(req);
    }
  }

  console.log(
    `[findFusionMaterialCombos] Expanded requirements count: ${expandedRequirements.length}`
  );

  // Check if we have enough materials
  if (materials.length < expandedRequirements.length) {
    console.log(
      `[findFusionMaterialCombos] Not enough materials: have ${materials.length}, need ${expandedRequirements.length}`
    );
    return [];
  }

  const combos = [];
  const materialZone = options.materialZone || "field";
  const materialInfo = options.materialInfo || [];

  // Create indexed materials to track original positions
  const indexedMaterials = materials.map((mat, idx) => ({
    card: mat,
    originalIndex: idx,
    zone: materialInfo[idx]?.zone || materialZone,
  }));

  console.log(
    `[findFusionMaterialCombos] Indexed materials:`,
    indexedMaterials.map((m) => `${m.card.name} (zone: ${m.zone})`)
  );

  // Recursive function to find all valid combinations
  const findCombos = (reqIndex, usedMaterials, remainingIndexed) => {
    // All requirements satisfied
    if (reqIndex >= expandedRequirements.length) {
      combos.push(usedMaterials.map((m) => m.card));
      return;
    }

    const requirement = expandedRequirements[reqIndex];
    const reqString = requirementToString(requirement);
    console.log(
      `[findFusionMaterialCombos] Req ${reqIndex}: ${JSON.stringify(
        requirement
      )} -> reqString: "${reqString}"`
    );

    // Check for zone restrictions on this requirement
    const allowedZones =
      typeof requirement === "object" ? requirement.allowedZones : null;

    console.log(`[findFusionMaterialCombos] allowedZones:`, allowedZones);

    // Try each available material
    for (let i = 0; i < remainingIndexed.length; i++) {
      const indexed = remainingIndexed[i];
      const material = indexed.card;
      const matZone = indexed.zone;

      // Check zone restriction if specified
      if (allowedZones && !allowedZones.includes(matZone)) {
        console.log(
          `[findFusionMaterialCombos] ${
            material.name
          } rejected: zone ${matZone} not in ${JSON.stringify(allowedZones)}`
        );
        continue;
      }

      const matches = this.matchesFusionRequirement(
        material,
        reqString,
        matZone
      );
      console.log(
        `[findFusionMaterialCombos] ${material.name} matches "${reqString}": ${matches}`
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
  console.log(
    `[findFusionMaterialCombos] Found ${combos.length} combos for ${fusionMonster.name}`
  );
  return combos;
}

/**
 * Get the total required material count for a fusion monster
 */
export function getRequiredMaterialCount(fusionMonster) {
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
  fusionMonster,
  selectedMaterials,
  options = {}
) {
  const requirements = this.getFusionRequirements(fusionMonster);
  if (!requirements || requirements.length === 0) {
    return { valid: false, reason: "No fusion requirements defined" };
  }

  // Expand requirements based on count
  const expandedRequirements = [];
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
  fusionMonster,
  materials,
  player,
  options = {}
) {
  const requirements = this.getFusionRequirements(fusionMonster);
  if (!requirements || requirements.length === 0) return false;

  // Calculate total required materials
  const requiredCount = this.getRequiredMaterialCount(fusionMonster);
  if (materials.length < requiredCount) return false;

  const combos = this.findFusionMaterialCombos(
    fusionMonster,
    materials,
    options
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
export function getAvailableFusions(
  extraDeck,
  materials,
  player,
  options = {}
) {
  const availableFusions = [];

  for (const fusionCard of extraDeck) {
    if (fusionCard.monsterType !== "fusion") continue;

    if (this.canSummonFusion(fusionCard, materials, player, options)) {
      const combos = this.findFusionMaterialCombos(
        fusionCard,
        materials,
        options
      );
      availableFusions.push({
        fusion: fusionCard,
        materialCombos: combos,
      });
    }
  }

  return availableFusions;
}
