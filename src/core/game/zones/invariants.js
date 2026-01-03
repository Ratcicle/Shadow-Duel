/**
 * Zone state invariants - validation and consistency checks.
 * Extracted from Game.js as part of B.4 modularization.
 */

/**
 * Assert that the game state is consistent (no invariant violations).
 * @param {string} contextLabel - Label for logging
 * @param {Object} options - Options (failFast, normalize)
 * @returns {{ok: boolean, issues: Array, hasCritical: boolean, criticalIssues: Array}}
 */
export function assertStateInvariants(
  contextLabel = "state_check",
  options = {}
) {
  const failFast =
    options.failFast !== undefined ? options.failFast : this.devModeEnabled;
  const normalize = options.normalize !== false;
  const issues = [];

  if (normalize) {
    this.normalizeZoneCardOwnership(contextLabel, {
      enforceZoneOwner: true,
    });
  }
  const addIssue = (message, detail) => {
    issues.push({ message, detail });
  };
  const normalizeZone = (player, zoneName, list) => {
    if (!Array.isArray(list)) return;
    const hasHoles = list.some((item) => !item);
    if (hasHoles) {
      addIssue("zone_has_empty_slots", {
        player: player?.id,
        zone: zoneName,
      });
      if (normalize) {
        const filtered = list.filter((item) => item);
        if (player && Array.isArray(player[zoneName])) {
          player[zoneName] = filtered;
        }
      }
    }
  };

  const checkZoneLimit = (player, zoneName, max) => {
    const list = player?.[zoneName];
    if (Array.isArray(list) && list.length > max) {
      addIssue("zone_limit_exceeded", {
        player: player?.id,
        zone: zoneName,
        length: list.length,
        max,
      });
    }
  };

  const collectZones = (player) => [
    { name: "hand", list: player?.hand || [] },
    { name: "field", list: player?.field || [] },
    { name: "spellTrap", list: player?.spellTrap || [] },
    { name: "graveyard", list: player?.graveyard || [] },
    { name: "deck", list: player?.deck || [] },
    { name: "extraDeck", list: player?.extraDeck || [] },
  ];

  [this.player, this.bot].forEach((player) => {
    if (!player) return;
    checkZoneLimit(player, "field", 5);
    checkZoneLimit(player, "spellTrap", 5);
    collectZones(player).forEach(({ name, list }) =>
      normalizeZone(player, name, list)
    );
  });

  const locationMap = new Map();
  const registerCard = (card, playerId, zoneName) => {
    if (!card) return;
    if (!locationMap.has(card)) {
      locationMap.set(card, []);
    }
    locationMap.get(card).push({ playerId, zoneName });
  };

  [this.player, this.bot].forEach((player) => {
    if (!player) return;
    collectZones(player).forEach(({ name, list }) => {
      list.forEach((card) => registerCard(card, player.id, name));
    });
    if (player.fieldSpell) {
      registerCard(player.fieldSpell, player.id, "fieldSpell");
    }
  });

  locationMap.forEach((locations, card) => {
    if (locations.length > 1) {
      addIssue("card_in_multiple_zones", {
        card: card?.name,
        locations,
      });
    }
    locations.forEach((entry) => {
      if (card?.owner && card.owner !== entry.playerId) {
        addIssue("owner_mismatch", {
          card: card?.name,
          owner: card.owner,
          zoneOwner: entry.playerId,
          zone: entry.zoneName,
        });
      }
      if (card?.controller && card.controller !== entry.playerId) {
        addIssue("controller_mismatch", {
          card: card?.name,
          controller: card.controller,
          zoneOwner: entry.playerId,
          zone: entry.zoneName,
        });
      }
    });
  });

  [this.player, this.bot].forEach((player) => {
    if (!player?.fieldSpell) return;
    const fieldSpell = player.fieldSpell;
    const locs = locationMap.get(fieldSpell) || [];
    if (locs.length > 1) {
      addIssue("field_spell_in_multiple_zones", {
        card: fieldSpell.name,
        locations: locs,
      });
    }
  });

  const selectionState = this.selectionState || "idle";
  if (this.targetSelection && selectionState === "idle") {
    addIssue("selection_stale", { state: selectionState });
    this.forceClearTargetSelection("stale_selection");
  } else if (!this.targetSelection) {
    if (selectionState === "selecting" || selectionState === "confirming") {
      addIssue("selection_state_mismatch", { state: selectionState });
      this.setSelectionState("idle");
    } else if (selectionState === "resolving") {
      const resolvingContext =
        this.isResolvingEffect || this.eventResolutionDepth > 0;
      if (!resolvingContext) {
        this.setSelectionState("idle");
      }
    }
  }

  const nonCriticalIssues = new Set([
    "selection_stale",
    "selection_state_mismatch",
    "resolving_state_stale",
  ]);
  const hasCritical = issues.some(
    (issue) => !nonCriticalIssues.has(issue.message)
  );
  const criticalIssues = issues.filter(
    (issue) => !nonCriticalIssues.has(issue.message)
  );

  if (issues.length) {
    const summary = `[Game] State invariants failed (${contextLabel})`;
    const log = hasCritical ? console.error : console.warn;
    log(summary, issues);
    if (failFast && hasCritical) {
      throw new Error(`${summary} issues=${issues.length}`);
    }
  }

  return { ok: issues.length === 0, issues, hasCritical, criticalIssues };
}
