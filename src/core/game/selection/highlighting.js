/**
 * Selection highlighting - visual feedback for target selection.
 * Extracted from Game.js as part of B.3 modularization.
 */

/**
 * Clear all target highlights from the UI.
 */
export function clearTargetHighlights() {
  if (this.ui && typeof this.ui.clearTargetHighlights === "function") {
    this.ui.clearTargetHighlights();
  }
}

/**
 * Set selection dimming state on the field.
 * @param {boolean} active - Whether dimming should be active
 */
export function setSelectionDimming(active) {
  if (this.ui && typeof this.ui.setSelectionDimming === "function") {
    this.ui.setSelectionDimming(!!active);
  }
}

/**
 * Update field targeting progress indicator.
 */
export function updateFieldTargetingProgress() {
  if (!this.targetSelection || !this.targetSelection.usingFieldTargeting) {
    return;
  }
  const handle = this.targetSelection.controlsHandle;
  if (!handle || typeof handle.updateState !== "function") return;
  const requirement =
    this.targetSelection.requirements[this.targetSelection.currentRequirement];
  if (!requirement) return;
  const selections = this.targetSelection.selections[requirement.id] || [];
  const min = Number(requirement.min ?? 0);
  const max = Number(requirement.max ?? min);
  handle.updateState({
    selected: selections.length,
    min,
    max,
    allowEmpty: this.targetSelection.allowEmpty === true,
  });
}

/**
 * Highlight valid target candidates on the field.
 */
export function highlightTargetCandidates() {
  this.clearTargetHighlights();
  if (!this.targetSelection) {
    console.log("[Game] No target selection active");
    return;
  }
  if (!this.targetSelection.usingFieldTargeting) {
    return;
  }
  if (
    this.targetSelection.state &&
    this.targetSelection.state !== "selecting"
  ) {
    return;
  }
  const requirement =
    this.targetSelection.requirements[this.targetSelection.currentRequirement];
  if (!requirement) {
    console.log("[Game] No option to highlight");
    return;
  }

  let attackerHighlight = null;
  if (this.targetSelection.kind === "attack" && this.targetSelection.attacker) {
    const attacker = this.targetSelection.attacker;
    const attackerOwner = attacker.owner === "player" ? "player" : "bot";
    const attackerField =
      attackerOwner === "player" ? this.player.field : this.bot.field;
    const attackerIndex = attackerField.indexOf(attacker);
    if (attackerIndex > -1) {
      attackerHighlight = { owner: attackerOwner, index: attackerIndex };
    }
  }

  console.log("[Game] Highlighting targets:", {
    kind: this.targetSelection.kind,
    optionId: requirement.id,
    candidatesCount: requirement.candidates?.length,
    min: requirement.min,
    max: requirement.max,
  });

  const selected = this.targetSelection.selections[requirement.id] || [];
  const selectedSet = new Set(selected);
  const highlightTargets = requirement.candidates.map((cand) => ({
    key: cand.key,
    zone: cand.zone,
    controller: cand.controller,
    zoneIndex: cand.zoneIndex,
    name: cand.name,
    isDirectAttack: !!cand.isDirectAttack,
    isSelected: selectedSet.has(cand.key),
    isAttackTarget:
      this.targetSelection.kind === "attack" && selectedSet.has(cand.key),
  }));

  if (this.ui && typeof this.ui.applyTargetHighlights === "function") {
    this.ui.applyTargetHighlights({
      targets: highlightTargets,
      attackerHighlight,
    });
  }
  this.updateFieldTargetingProgress();
}
