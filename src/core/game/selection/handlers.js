/**
 * Selection handlers - click handling and high-level selection API.
 * Extracted from Game.js as part of B.3 modularization.
 */

/**
 * Handle a click on a target during field targeting selection.
 * @param {string} ownerId - "player" or "bot"
 * @param {number} cardIndex - Index of the card in the zone
 * @param {HTMLElement} cardEl - Card element (unused but kept for signature)
 * @param {string|null} location - Zone hint ("field", "spellTrap", "fieldSpell")
 * @returns {boolean} Whether the click was handled
 */
export function handleTargetSelectionClick(
  ownerId,
  cardIndex,
  cardEl,
  location = null
) {
  if (!this.targetSelection) return false;
  if (!this.targetSelection.usingFieldTargeting) return false;
  if (
    this.targetSelection.state &&
    this.targetSelection.state !== "selecting"
  ) {
    return false;
  }

  console.log("[Game] Target selection click:", {
    ownerId,
    cardIndex,
    currentRequirement: this.targetSelection.currentRequirement,
    requirementsLength: this.targetSelection.requirements?.length,
  });

  const requirement =
    this.targetSelection.requirements[this.targetSelection.currentRequirement];
  if (!requirement) {
    console.log("[Game] No option found");
    return false;
  }

  const ownerPlayer = ownerId === "player" ? this.player : this.bot;
  let card = null;
  const zoneHint = location || requirement.zones?.[0] || "field";

  if (zoneHint === "fieldSpell") {
    card = ownerPlayer.fieldSpell;
  } else if (zoneHint === "spellTrap") {
    card = ownerPlayer.spellTrap[cardIndex];
  } else {
    card = ownerPlayer.field[cardIndex];
  }

  if (!card) {
    console.log("[Game] Card not found at index:", cardIndex);
    return true;
  }

  console.log("[Game] Looking for candidate:", {
    cardName: card.name,
    cardIndex: cardIndex,
    candidatesCount: requirement.candidates.length,
    candidateNames: requirement.candidates.map(
      (c) => `${c.name} [idx:${c.zoneIndex}]`
    ),
  });

  // Find candidate by matching card reference (most reliable method)
  // NOTE: We use cardRef identity match instead of zoneIndex because
  // zoneIndex can become stale if the board is re-rendered between
  // when decoratedCandidates were created and when the click occurs
  const candidate = requirement.candidates.find(
    (cand) => cand.cardRef === card
  );

  if (!candidate) {
    console.log("[Game] Candidate not found. Checking references:");
    requirement.candidates.forEach((cand, i) => {
      console.log(`  Candidate ${i}:`, {
        name: cand.name,
        zoneIndex: cand.zoneIndex,
        cardIndex: cardIndex,
        refMatch: cand.cardRef === card,
      });
    });
    return true;
  }

  const selections = this.targetSelection.selections[requirement.id] || [];
  const max = Number(requirement.max ?? 0);
  const existing = selections.indexOf(candidate.key);
  if (existing > -1) {
    selections.splice(existing, 1);
    console.log("[Game] Deselected card");
  } else {
    if (max > 0 && selections.length >= max) {
      console.log("[Game] Max selections reached");
      return true;
    }
    selections.push(candidate.key);
    console.log(
      "[Game] Selected card, total:",
      selections.length,
      "/",
      max || requirement.max
    );
  }
  this.targetSelection.selections[requirement.id] = selections;

  const shouldAutoAdvance = this.targetSelection.autoAdvanceOnMax !== false;

  if (shouldAutoAdvance && max > 0 && selections.length >= max) {
    console.log("[Game] Max reached, advancing selection");
    this.advanceTargetSelection();
  }
  this.highlightTargetCandidates();
  this.updateFieldTargetingProgress();

  return true;
}

/**
 * High-level API to ask the player to select cards from a zone.
 * @param {Object} config - Selection configuration
 * @returns {Promise<Array>} Promise resolving to selected cards
 */
export function askPlayerToSelectCards(config = {}) {
  const owner = config.owner === "player" ? this.player : null;
  if (!owner) return Promise.resolve([]);

  const zoneName = config.zone || "field";
  let candidates = this.getZone(owner, zoneName) || [];

  const filter = config.filter;
  if (filter) {
    if (typeof filter === "function") {
      candidates = candidates.filter(filter);
    } else if (typeof filter === "object") {
      candidates = candidates.filter((card) => {
        return Object.entries(filter).every(([key, value]) => {
          if (!card) return false;
          if (Array.isArray(value)) {
            return value.includes(card[key]);
          }
          return card[key] === value;
        });
      });
    }
  }

  const min = Math.max(1, config.min ?? 1);
  const max = Math.min(config.max ?? min, candidates.length);

  if (candidates.length < min) {
    return Promise.resolve([]);
  }

  const decorated = candidates.map((card, idx) => {
    const ownerLabel = card.owner === "player" ? "player" : "opponent";
    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    const zoneArr = this.getZone(ownerPlayer, zoneName) || [];
    const zoneIndex = zoneArr.indexOf(card);
    return {
      idx,
      name: card.name,
      owner: ownerLabel,
      controller: card.owner,
      zone: zoneName,
      zoneIndex,
      position: card.position,
      atk: card.atk,
      def: card.def,
      cardKind: card.cardKind,
      cardRef: card,
    };
  });

  return new Promise((resolve) => {
    const candidatesWithKeys = decorated.map((cand, idx) => {
      if (!cand.key) {
        cand.key = this.buildSelectionCandidateKey(cand, idx);
      }
      return cand;
    });
    const requirement = {
      id: "custom_select",
      min,
      max,
      zones: [zoneName],
      owner: "player",
      filters: {},
      allowSelf: true,
      distinct: true,
      candidates: candidatesWithKeys,
    };
    const selectionContract = {
      kind: "choice",
      message:
        config.message || "Select card(s) by clicking the highlighted targets.",
      requirements: [requirement],
      ui: { useFieldTargeting: true },
      metadata: { context: "custom" },
    };

    this.startTargetSelectionSession({
      kind: "custom",
      selectionContract,
      resolve,
      execute: (selections) => {
        const chosenKeys = selections[requirement.id] || [];
        const chosen = chosenKeys
          .map((key) => requirement.candidates.find((cand) => cand.key === key))
          .map((cand) => cand?.cardRef)
          .filter(Boolean);
        resolve(chosen);
        return { success: true, needsSelection: false };
      },
    });
  });
}
