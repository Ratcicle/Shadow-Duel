/**
 * Fusion Requirements Module
 * Extracted from EffectEngine.js - handles fusion material requirements
 *
 * All functions assume `this` = EffectEngine instance
 */

/**
 * Match a card against a fusion requirement
 */
export function matchesFusionRequirement(card, requirement, materialZone) {
  // Handle complex object requirements (e.g., { archetype: "Shadow-Heart", minLevel: 5 })
  if (typeof requirement === "object" && requirement !== null) {
    return matchComplexRequirement(card, requirement, materialZone);
  }

  // Guard: requirement must be a non-empty string
  if (!requirement || typeof requirement !== "string") {
    return false;
  }

  // Requirement types:
  // - "specific:CARD_ID" (exactly that card)
  // - "name:CARD_NAME" (card with that exact name)
  // - "archetype:ARCHETYPE_NAME" (any card with that archetype)
  // - "type:TYPE_NAME" (monsters with specific type like Dragon)
  // - "any:monster" (any monster)
  // - "attribute:FIRE" (monsters with specific attribute)
  // - "monsterType:dragon" (monsters with specific monster type)
  // - "level:4+" (monsters with level 4 or higher)

  // Specific card match by ID
  if (requirement.startsWith("specific:")) {
    const cardId = requirement.substring("specific:".length);
    return card.id === cardId;
  }

  // Card name match
  if (requirement.startsWith("name:")) {
    const cardName = requirement.substring("name:".length);
    return card.name === cardName;
  }

  // Archetype match
  if (requirement.startsWith("archetype:")) {
    const archetypeName = requirement.substring("archetype:".length);
    // Check both single archetype and archetype array
    if (card.archetype === archetypeName) return true;
    if (
      Array.isArray(card.archetypes) &&
      card.archetypes.includes(archetypeName)
    )
      return true;
    return false;
  }

  // Type match (e.g., "type:Dragon")
  if (requirement.startsWith("type:")) {
    const typeName = requirement.substring("type:".length);
    if (card.type === typeName) return true;
    if (Array.isArray(card.types) && card.types.includes(typeName)) return true;
    return false;
  }

  // Any monster
  if (requirement === "any:monster") {
    return card.type === "monster";
  }

  // Attribute match
  if (requirement.startsWith("attribute:")) {
    const attribute = requirement.substring("attribute:".length);
    return (
      card.attribute && card.attribute.toUpperCase() === attribute.toUpperCase()
    );
  }

  // Monster type match
  if (requirement.startsWith("monsterType:")) {
    const monsterType = requirement.substring("monsterType:".length);
    return (
      card.monsterType &&
      card.monsterType.toLowerCase() === monsterType.toLowerCase()
    );
  }

  // Level comparison
  if (requirement.startsWith("level:")) {
    const levelSpec = requirement.substring("level:".length);
    if (levelSpec.endsWith("+")) {
      const minLevel = parseInt(levelSpec.slice(0, -1));
      return card.level && card.level >= minLevel;
    }
    const exactLevel = parseInt(levelSpec);
    return card.level && card.level === exactLevel;
  }

  // Zone-specific requirements
  if (requirement.startsWith("zone:")) {
    const zoneSpec = requirement.substring("zone:".length);
    return materialZone === zoneSpec;
  }

  // Try as direct card ID (backward compatibility)
  return card.id === requirement;
}

/**
 * Match a card against a complex object requirement
 * Supports combined conditions like { archetype: "Shadow-Heart", minLevel: 5 }
 * or { type: "Dragon", minLevel: 5 }
 */
function matchComplexRequirement(card, requirement, materialZone) {
  // Check name requirement
  if (requirement.name) {
    if (card.name !== requirement.name) return false;
  }

  // Check archetype requirement
  if (requirement.archetype) {
    const archetypeName = requirement.archetype;
    const hasArchetype =
      card.archetype === archetypeName ||
      (Array.isArray(card.archetypes) &&
        card.archetypes.includes(archetypeName));
    if (!hasArchetype) return false;
  }

  // Check type requirement (e.g., "Dragon")
  if (requirement.type) {
    const typeName = requirement.type;
    const hasType =
      card.type === typeName ||
      (Array.isArray(card.types) && card.types.includes(typeName));
    if (!hasType) return false;
  }

  // Check minLevel requirement
  if (requirement.minLevel !== undefined) {
    const cardLevel = card.level || 0;
    if (cardLevel < requirement.minLevel) return false;
  }

  // Check maxLevel requirement
  if (requirement.maxLevel !== undefined) {
    const cardLevel = card.level || 0;
    if (cardLevel > requirement.maxLevel) return false;
  }

  // Check attribute requirement
  if (requirement.attribute) {
    if (
      !card.attribute ||
      card.attribute.toUpperCase() !== requirement.attribute.toUpperCase()
    ) {
      return false;
    }
  }

  // Check zone restriction
  if (requirement.allowedZones) {
    if (!requirement.allowedZones.includes(materialZone)) return false;
  }

  return true;
}

/**
 * Get the fusion requirements from a fusion monster definition
 */
export function getFusionRequirements(fusionMonster) {
  // Support both array format and fusionMaterials object
  if (fusionMonster.fusionMaterials) {
    return fusionMonster.fusionMaterials;
  }
  return [];
}

/**
 * Get the required count of materials for fusion
 */
export function getFusionRequiredCount(requirements) {
  // Each requirement is one material unless it has a count property
  return requirements.reduce((total, req) => {
    if (typeof req === "object" && req.count) {
      return total + req.count;
    }
    return total + 1;
  }, 0);
}
