/**
 * Indicator methods for Renderer
 * Handles: applyActivationIndicators, applyAttackReadyIndicators, clearAttackReadyIndicators,
 * applyAttackResolutionIndicators, clearAttackResolutionIndicators, applyFlipAnimation,
 * setPlayerFieldTributeable, setPlayerFieldSelected, clearPlayerFieldTributeable,
 * applyTargetHighlights, clearTargetHighlights, setSelectionDimming, applyHandTargetableIndices,
 * getSelectionCleanupState, applyZoneActivationIndicators, decorateActivatableCard,
 * setActivationHint, clearActivationHint
 */

/**
 * @this {import('../Renderer.js').default}
 */
export function applyActivationIndicators(owner, indicators = {}) {
  const prefix = owner === "player" ? "player" : "bot";
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}Hand`],
    indicators.hand || {}
  );
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}Field`],
    indicators.field || {}
  );
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}SpellTrap`],
    indicators.spellTrap || {}
  );

  const fieldSpellContainer = this.elements[`${prefix}FieldSpell`];
  if (fieldSpellContainer) {
    const cardEl = fieldSpellContainer.querySelector(".card");
    if (cardEl) {
      this.clearActivationHint(cardEl);
      const hint = indicators.fieldSpell;
      if (hint && hint.label) {
        this.setActivationHint(cardEl, hint.label);
      }
      if (hint?.canActivate) {
        this.decorateActivatableCard(cardEl);
      }
    }
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyAttackReadyIndicators(owner, indices = []) {
  this.clearAttackReadyIndicators();
  if (!Array.isArray(indices) || indices.length === 0) return;
  const container =
    owner === "player" ? this.elements.playerField : this.elements.botField;
  if (!container) return;
  indices.forEach((index) => {
    const cardEl = container.querySelector(`.card[data-index=\"${index}\"]`);
    if (cardEl) {
      cardEl.classList.add("attack-ready");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearAttackReadyIndicators() {
  const containers = [this.elements.playerField, this.elements.botField];
  containers.forEach((container) => {
    if (!container) return;
    container
      .querySelectorAll(".card.attack-ready")
      .forEach((el) => el.classList.remove("attack-ready"));
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyAttackResolutionIndicators({
  attackerOwner = "player",
  attackerIndex = -1,
  targetOwner = "bot",
  targetIndex = -1,
  directAttack = false,
} = {}) {
  this.clearAttackResolutionIndicators();

  const attackerContainer =
    attackerOwner === "player"
      ? this.elements.playerField
      : this.elements.botField;
  if (attackerContainer && attackerIndex >= 0) {
    const attackerEl = attackerContainer.querySelector(
      `.card[data-index=\"${attackerIndex}\"]`
    );
    if (attackerEl) {
      attackerEl.classList.add("attack-attacker");
    }
  }

  if (directAttack) {
    if (this.elements.botHand) {
      this.elements.botHand.classList.add("direct-attack-active");
    }
    return;
  }

  const targetContainer =
    targetOwner === "player"
      ? this.elements.playerField
      : this.elements.botField;
  if (targetContainer && targetIndex >= 0) {
    const targetEl = targetContainer.querySelector(
      `.card[data-index=\"${targetIndex}\"]`
    );
    if (targetEl) {
      targetEl.classList.add("attack-target");
    }
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearAttackResolutionIndicators() {
  const containers = [this.elements.playerField, this.elements.botField];
  containers.forEach((container) => {
    if (!container) return;
    container
      .querySelectorAll(".card.attack-attacker")
      .forEach((el) => el.classList.remove("attack-attacker"));
    container
      .querySelectorAll(".card.attack-target")
      .forEach((el) => el.classList.remove("attack-target"));
  });
  if (this.elements.botHand) {
    this.elements.botHand.classList.remove("direct-attack-active");
  }
}

/**
 * Applies flip animation to a card on the field.
 *
 * Uses deferred application (requestAnimationFrame) to ensure the animation
 * class is applied to the final DOM element after updateBoard() recreates it.
 * This solves the race condition where updateBoard() would remove the class
 * immediately after it was applied.
 *
 * @this {import('../Renderer.js').default}
 */
export function applyFlipAnimation(owner, index) {
  if (index < 0) return;

  // Defer to next frame to apply class after updateBoard() recreates DOM
  requestAnimationFrame(() => {
    const container =
      owner === "player" ? this.elements.playerField : this.elements.botField;
    if (!container) return;

    const cardEl = container.querySelector(`.card[data-index="${index}"]`);
    if (cardEl) {
      cardEl.classList.add("flipping");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setPlayerFieldTributeable(indices = []) {
  if (!this.elements.playerField) return;
  indices.forEach((index) => {
    const cardEl = this.elements.playerField.querySelector(
      `.card[data-index="${index}"]`
    );
    if (cardEl) {
      cardEl.classList.add("tributeable");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setPlayerFieldSelected(index, selected) {
  if (!this.elements.playerField || index < 0) return;
  const cardEl = this.elements.playerField.querySelector(
    `.card[data-index="${index}"]`
  );
  if (!cardEl) return;
  if (selected) {
    cardEl.classList.add("selected");
  } else {
    cardEl.classList.remove("selected");
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearPlayerFieldTributeable() {
  if (!this.elements.playerField) return;
  this.elements.playerField
    .querySelectorAll(".tributeable, .selected")
    .forEach((el) => el.classList.remove("tributeable", "selected"));
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyTargetHighlights({
  targets = [],
  attackerHighlight = null,
} = {}) {
  this.clearTargetHighlights();

  if (attackerHighlight) {
    const { owner, index } = attackerHighlight;
    const container =
      owner === "player" ? this.elements.playerField : this.elements.botField;
    if (container && index >= 0) {
      const attackerEl = container.querySelector(
        `.card[data-index=\"${index}\"]`
      );
      if (attackerEl) {
        attackerEl.classList.add("attack-attacker");
      }
    }
  }

  targets.forEach((cand) => {
    let targetEl = null;
    if (cand.isDirectAttack) {
      targetEl = this.elements.botHand;
    } else if (cand.zone === "field") {
      const container =
        cand.controller === "player"
          ? this.elements.playerField
          : this.elements.botField;
      if (container) {
        targetEl = container.querySelector(
          `.card[data-index=\"${cand.zoneIndex}\"]`
        );
      }
    } else if (cand.zone === "spellTrap") {
      const container =
        cand.controller === "player"
          ? this.elements.playerSpellTrap
          : this.elements.botSpellTrap;
      if (container) {
        targetEl = container.querySelector(
          `.card[data-index=\"${cand.zoneIndex}\"]`
        );
      }
    } else if (cand.zone === "fieldSpell") {
      const container =
        cand.controller === "player"
          ? this.elements.playerFieldSpell
          : this.elements.botFieldSpell;
      if (container) {
        targetEl = container.querySelector(".card");
      }
    }

    if (!targetEl) {
      return;
    }

    targetEl.classList.add("targetable");
    if (cand.isDirectAttack) {
      targetEl.style.pointerEvents = "auto";
      targetEl.classList.add("direct-attack-target");
    }
    if (cand.isSelected) {
      targetEl.classList.add("selected-target");
    }
    if (cand.isAttackTarget) {
      targetEl.classList.add("attack-target");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearTargetHighlights() {
  const containers = [
    this.elements.playerHand,
    this.elements.botHand,
    this.elements.playerField,
    this.elements.botField,
    this.elements.playerSpellTrap,
    this.elements.botSpellTrap,
    this.elements.playerFieldSpell,
    this.elements.botFieldSpell,
  ];

  containers.forEach((container) => {
    if (!container) return;
    container.classList.remove(
      "targetable",
      "selected-target",
      "attack-attacker",
      "attack-target",
      "direct-attack-target"
    );
    container
      .querySelectorAll(
        ".card.targetable, .card.selected-target, .card.attack-attacker, .card.attack-target, .direct-attack-target"
      )
      .forEach((el) => {
        el.classList.remove(
          "targetable",
          "selected-target",
          "attack-attacker",
          "attack-target",
          "direct-attack-target"
        );
      });
  });

  if (this.elements.botHand) {
    this.elements.botHand.style.pointerEvents = "";
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setSelectionDimming(active) {
  const container = document.getElementById("game-container");
  if (!container) return;
  container.classList.toggle("selection-dim", !!active);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyHandTargetableIndices(owner, indices = []) {
  const container =
    owner === "player" ? this.elements.playerHand : this.elements.botHand;
  if (!container) return;
  const indexSet = new Set(indices);
  const cards = container.querySelectorAll(".card");
  cards.forEach((cardEl, index) => {
    if (indexSet.has(index)) {
      cardEl.classList.add("targetable");
    } else {
      cardEl.classList.remove("targetable");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function getSelectionCleanupState() {
  const controlsVisible = !!document.querySelector(".field-targeting-controls");
  const highlightCount = document.querySelectorAll(
    ".card.targetable, .card.selected-target"
  ).length;
  return { controlsVisible, highlightCount };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyZoneActivationIndicators(container, zoneIndicators) {
  if (!container || !zoneIndicators) return;
  const cardEls = container.querySelectorAll(".card");
  cardEls.forEach((cardEl) => {
    const index = Number(cardEl.dataset.index);
    if (Number.isNaN(index)) return;
    this.clearActivationHint(cardEl);
    const hint = zoneIndicators[index];
    if (!hint) return;
    if (hint.label) {
      this.setActivationHint(cardEl, hint.label);
    }
    if (hint.canActivate) {
      this.decorateActivatableCard(cardEl);
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function decorateActivatableCard(cardEl) {
  cardEl.classList.add("card-activatable");
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setActivationHint(cardEl, label) {
  if (!label) return;
  cardEl.title = label;
  cardEl.dataset.activationHint = "true";
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearActivationHint(cardEl) {
  cardEl.classList.remove("card-activatable");
  if (cardEl.dataset.activationHint) {
    delete cardEl.dataset.activationHint;
    cardEl.removeAttribute("title");
  }
}
