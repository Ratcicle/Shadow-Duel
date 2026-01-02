/**
 * DevTools Sanity Tests for Game
 * Handles: devRunSanityA through devRunSanityO
 */

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityA() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_A_START", {
    summary: "Sanity A: hand spell target + cancel",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      hand: ["Luminarch Holy Ascension"],
      field: [
        {
          name: "Luminarch Valiant - Knight of the Dawn",
          position: "attack",
        },
      ],
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const card = this.player.hand.find(
    (c) => c && c.name === "Luminarch Holy Ascension"
  );
  if (!card) {
    return { success: false, reason: "Sanity A card not found in hand." };
  }
  const handIndex = this.player.hand.indexOf(card);

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner: this.player,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Sanity A: select target(s) for the spell.",
    gate: () => {
      if (this.turn !== "player") return { ok: false };
      if (this.phase !== "main1" && this.phase !== "main2") {
        return {
          ok: false,
          reason: "Can only activate spells during Main Phase.",
        };
      }
      if (this.isResolvingEffect) {
        return {
          ok: false,
          reason: "Finish the current effect before activating another card.",
        };
      }
      return { ok: true };
    },
    preview: () =>
      this.effectEngine?.canActivateSpellFromHandPreview?.(card, this.player),
    commit: () => this.commitCardActivationFromHand(this.player, handIndex),
    activationContext: {
      fromHand: true,
      sourceZone: "hand",
    },
    activate: (chosen, ctx, zone, resolvedCard) =>
      this.effectEngine.activateSpellTrapEffect(
        resolvedCard,
        this.player,
        chosen,
        zone,
        ctx
      ),
    finalize: (result, info) => {
      if (!result.placementOnly) {
        this.finalizeSpellTrapActivation(
          info.card,
          this.player,
          info.activationZone
        );
      }
      this.updateBoard();
    },
  });

  const selection = this.targetSelection;
  const selectionOpened = !!selection;
  const allowCancel = selectionOpened ? !selection.preventCancel : false;
  const contractOk = selectionOpened
    ? Array.isArray(selection.selectionContract?.requirements) &&
      selection.selectionContract.requirements.length > 0
    : false;
  let selectionResolved = false;
  let cancelAttempted = false;

  if (selectionOpened) {
    if (allowCancel) {
      cancelAttempted = true;
      this.cancelTargetSelection();
      selectionResolved = true;
    } else {
      const autoResult = await this.devAutoConfirmTargetSelection();
      selectionResolved = autoResult.success;
    }
  }

  this.devForceTargetCleanup();
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const success =
    selectionOpened && selectionResolved && cleanupOk && contractOk;
  this.devLog("SANITY_A_RESULT", {
    summary: "Sanity A result",
    selectionOpened,
    allowCancel,
    contractOk,
    cancelAttempted,
    selectionResolved,
    cleanupOk,
    pipelineResult,
  });
  return {
    success,
    selectionOpened,
    allowCancel,
    contractOk,
    selectionResolved,
    cleanupOk,
    pipelineResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityB() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_B_START", {
    summary: "Sanity B: placement-only spell",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      hand: ["Darkness Valley"],
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const card = this.player.hand.find((c) => c && c.name === "Darkness Valley");
  if (!card) {
    return { success: false, reason: "Sanity B card not found in hand." };
  }
  const handIndex = this.player.hand.indexOf(card);
  const cardRef = card;

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner: this.player,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Sanity B: placement-only check.",
    gate: () => {
      if (this.turn !== "player") return { ok: false };
      if (this.phase !== "main1" && this.phase !== "main2") {
        return {
          ok: false,
          reason: "Can only activate spells during Main Phase.",
        };
      }
      if (this.isResolvingEffect) {
        return {
          ok: false,
          reason: "Finish the current effect before activating another card.",
        };
      }
      return { ok: true };
    },
    preview: () =>
      this.effectEngine?.canActivateSpellFromHandPreview?.(card, this.player),
    commit: () => this.commitCardActivationFromHand(this.player, handIndex),
    activationContext: {
      fromHand: true,
      sourceZone: "hand",
    },
    activate: (chosen, ctx, zone, resolvedCard) =>
      this.effectEngine.activateSpellTrapEffect(
        resolvedCard,
        this.player,
        chosen,
        zone,
        ctx
      ),
    finalize: (result) => {
      if (!result.placementOnly) {
        this.finalizeSpellTrapActivation(card, this.player);
      }
      this.updateBoard();
    },
  });

  this.devForceTargetCleanup();
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const placementOnlyOk =
    pipelineResult?.success === true &&
    pipelineResult?.needsSelection === false &&
    pipelineResult?.placementOnly === true;
  const placedOk = this.player.fieldSpell === cardRef;
  const success = placementOnlyOk && placedOk && cleanupOk;

  this.devLog("SANITY_B_RESULT", {
    summary: "Sanity B result",
    placementOnlyOk,
    placedOk,
    cleanupOk,
    pipelineResult,
  });
  return {
    success,
    placementOnlyOk,
    placedOk,
    cleanupOk,
    pipelineResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityC() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_C_START", {
    summary: "Sanity C: committed field spell fail + restore",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      hand: ["Darkness Valley"],
      fieldSpell: "Sanctum of the Luminarch Citadel",
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const card = this.player.hand.find((c) => c && c.name === "Darkness Valley");
  if (!card) {
    return { success: false, reason: "Sanity C card not found in hand." };
  }
  const handIndex = this.player.hand.indexOf(card);
  const cardRef = card;
  const replacedFieldSpell = this.player.fieldSpell;

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner: this.player,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Sanity C: forced failure for rollback.",
    gate: () => {
      if (this.turn !== "player") return { ok: false };
      if (this.phase !== "main1" && this.phase !== "main2") {
        return {
          ok: false,
          reason: "Can only activate spells during Main Phase.",
        };
      }
      if (this.isResolvingEffect) {
        return {
          ok: false,
          reason: "Finish the current effect before activating another card.",
        };
      }
      return { ok: true };
    },
    preview: () =>
      this.effectEngine?.canActivateSpellFromHandPreview?.(card, this.player),
    commit: () => this.commitCardActivationFromHand(this.player, handIndex),
    activationContext: {
      fromHand: true,
      sourceZone: "hand",
      devFailAfterCommit: true,
    },
    activate: (chosen, ctx, zone, resolvedCard) =>
      this.effectEngine.activateSpellTrapEffect(
        resolvedCard,
        this.player,
        chosen,
        zone,
        ctx
      ),
  });

  this.devForceTargetCleanup();
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const failureOk =
    pipelineResult?.success === false &&
    pipelineResult?.needsSelection === false;
  const restoredIndex = this.player.hand.indexOf(cardRef);
  const restoredHandOk = restoredIndex === handIndex;
  const restoredFieldOk = this.player.fieldSpell === replacedFieldSpell;
  const restoredGyOk =
    replacedFieldSpell && !this.player.graveyard.includes(replacedFieldSpell);
  const rollbackOk = restoredHandOk && restoredFieldOk && restoredGyOk;
  const success = failureOk && rollbackOk && cleanupOk;

  this.devLog("SANITY_C_RESULT", {
    summary: "Sanity C result",
    failureOk,
    rollbackOk,
    restoredHandOk,
    restoredFieldOk,
    restoredGyOk,
    cleanupOk,
    pipelineResult,
  });
  return {
    success,
    failureOk,
    rollbackOk,
    restoredHandOk,
    restoredFieldOk,
    restoredGyOk,
    cleanupOk,
    pipelineResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityD() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_D_START", {
    summary: "Sanity D: triggered target flow",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      spellTrap: ["Sword of Two Darks"],
    },
    bot: {
      spellTrap: ["Mirror Force"],
    },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const triggerCard = this.player.spellTrap.find(
    (c) => c && c.name === "Sword of Two Darks"
  );
  if (!triggerCard) {
    return { success: false, reason: "Sanity D trigger card not found." };
  }

  const targetCard = this.bot.spellTrap.find(
    (c) => c && c.name === "Mirror Force"
  );

  this.moveCard(triggerCard, this.player, "graveyard", {
    fromZone: "spellTrap",
    wasDestroyed: true,
  });
  this.updateBoard();

  const waitForSelection = async (attempts = 20, delayMs = 25) => {
    for (let i = 0; i < attempts; i += 1) {
      if (this.targetSelection) return true;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return false;
  };

  await waitForSelection();

  const selection = this.targetSelection;
  const selectionOpened = !!selection;
  const allowCancel = selectionOpened ? !selection.preventCancel : false;
  const contract = selectionOpened ? selection.selectionContract : null;
  const requirements = contract?.requirements || [];
  const contractOk = selectionOpened ? requirements.length > 0 : false;
  const candidateCount = selectionOpened
    ? requirements?.[selection.currentRequirement]?.candidates?.length || 0
    : 0;
  const usingFieldTargeting = selectionOpened
    ? !!selection.usingFieldTargeting
    : false;

  let selectionResolved = false;
  if (selectionOpened) {
    const autoResult = await this.devAutoConfirmTargetSelection();
    selectionResolved = autoResult.success;
  }

  const candidateCountOk = candidateCount === 1;
  const allowCancelOk = selectionOpened ? allowCancel === true : false;
  const targetMoved =
    targetCard &&
    !this.bot.spellTrap.includes(targetCard) &&
    this.bot.graveyard.includes(targetCard);

  this.devForceTargetCleanup();
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const success =
    selectionOpened &&
    selectionResolved &&
    cleanupOk &&
    contractOk &&
    candidateCountOk &&
    allowCancelOk &&
    targetMoved;

  this.devLog("SANITY_D_RESULT", {
    summary: "Sanity D result",
    selectionOpened,
    allowCancel,
    contractOk,
    candidateCount,
    candidateCountOk,
    allowCancelOk,
    usingFieldTargeting,
    selectionResolved,
    targetMoved,
    cleanupOk,
  });

  return {
    success,
    selectionOpened,
    allowCancel,
    contractOk,
    candidateCount,
    candidateCountOk,
    allowCancelOk,
    usingFieldTargeting,
    selectionResolved,
    targetMoved,
    cleanupOk,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityE() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_E_START", {
    summary: "Sanity E: bot auto-select selection contract",
  });

  const setupResult = this.applyManualSetup({
    turn: "bot",
    phase: "main1",
    player: { field: [] },
    bot: {
      hand: ["Luminarch Holy Ascension"],
      field: [
        {
          name: "Luminarch Valiant - Knight of the Dawn",
          position: "attack",
        },
      ],
    },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const card = this.bot.hand.find(
    (c) => c && c.name === "Luminarch Holy Ascension"
  );
  if (!card) {
    return { success: false, reason: "Sanity E card not found in bot hand." };
  }
  const handIndex = this.bot.hand.indexOf(card);
  const cardRef = card;

  const pipelineResult = await this.runActivationPipeline({
    card,
    owner: this.bot,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Sanity E: bot auto-select.",
    gate: () => {
      if (this.turn !== "bot") return { ok: false };
      if (this.phase !== "main1" && this.phase !== "main2") {
        return {
          ok: false,
          reason: "Can only activate spells during Main Phase.",
        };
      }
      if (this.isResolvingEffect) {
        return {
          ok: false,
          reason: "Finish the current effect before activating another card.",
        };
      }
      return { ok: true };
    },
    preview: () =>
      this.effectEngine?.canActivateSpellFromHandPreview?.(card, this.bot),
    commit: () => this.commitCardActivationFromHand(this.bot, handIndex),
    activationContext: {
      fromHand: true,
      sourceZone: "hand",
    },
    activate: (chosen, ctx, zone, resolvedCard) =>
      this.effectEngine.activateSpellTrapEffect(
        resolvedCard,
        this.bot,
        chosen,
        zone,
        ctx
      ),
    finalize: (result, info) => {
      if (!result.placementOnly) {
        this.finalizeSpellTrapActivation(
          info.card,
          this.bot,
          info.activationZone
        );
      }
      this.updateBoard();
    },
  });

  const selectionOpened = !!this.targetSelection;
  this.devForceTargetCleanup();
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const resolvedOk =
    pipelineResult?.success === true &&
    pipelineResult?.needsSelection === false;
  const autoSelectedOk = !selectionOpened;
  const graveyardOk = this.bot.graveyard.includes(cardRef);
  const success = resolvedOk && autoSelectedOk && cleanupOk && graveyardOk;

  this.devLog("SANITY_E_RESULT", {
    summary: "Sanity E result",
    resolvedOk,
    autoSelectedOk,
    graveyardOk,
    cleanupOk,
    pipelineResult,
  });

  return {
    success,
    resolvedOk,
    autoSelectedOk,
    graveyardOk,
    cleanupOk,
    pipelineResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityF() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_F_START", {
    summary: "Sanity F: player strategy manual confirm",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      field: [
        {
          name: "Luminarch Valiant - Knight of the Dawn",
          position: "attack",
        },
      ],
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const source = this.player.field.find(Boolean);
  if (!source) {
    return { success: false, reason: "Sanity F source card not found." };
  }

  const targetDefs = [
    {
      id: "sanity_strategy_target",
      owner: "self",
      zone: "field",
      cardKind: "monster",
      cardName: source.name,
      requireFaceup: true,
      count: { min: 1, max: 1 },
      strategy: "highest_atk",
    },
  ];

  const pipelineResult = await this.runActivationPipeline({
    card: source,
    owner: this.player,
    activationZone: "field",
    activationContext: {
      fromHand: false,
      sourceZone: "field",
    },
    selectionKind: "sanityF",
    selectionMessage: "Sanity F: confirm the target selection.",
    activate: (selections, activationCtx) => {
      const ctx = {
        source,
        player: this.player,
        opponent: this.bot,
        activationZone: "field",
        activationContext: activationCtx,
      };
      const targetResult = this.effectEngine.resolveTargets(
        targetDefs,
        ctx,
        selections
      );
      if (targetResult.needsSelection) {
        return {
          success: false,
          needsSelection: true,
          selectionContract: targetResult.selectionContract,
        };
      }
      if (targetResult.ok === false) {
        return {
          success: false,
          needsSelection: false,
          reason: targetResult.reason,
        };
      }
      return { success: true, needsSelection: false };
    },
  });

  const selection = this.targetSelection;
  const selectionOpened = !!selection;
  const allowCancel = selectionOpened ? !selection.preventCancel : false;
  const contract = selectionOpened ? selection.selectionContract : null;
  const requirement =
    contract?.requirements?.[selection?.currentRequirement ?? 0] ||
    contract?.requirements?.[0] ||
    null;
  const contractOk =
    selectionOpened &&
    Array.isArray(contract?.requirements) &&
    contract.requirements.length > 0;
  const strategyOk = requirement?.filters?.strategy === "highest_atk";
  const candidateCount = requirement?.candidates?.length || 0;

  let selectionResolved = false;
  let cancelAttempted = false;

  if (selectionOpened) {
    if (allowCancel) {
      cancelAttempted = true;
      this.cancelTargetSelection();
      selectionResolved = true;
    } else {
      const autoResult = await this.devAutoConfirmTargetSelection();
      selectionResolved = autoResult.success;
    }
  }

  this.devForceTargetCleanup();
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const candidateCountOk = candidateCount === 1;
  const success =
    selectionOpened &&
    selectionResolved &&
    cleanupOk &&
    contractOk &&
    strategyOk &&
    candidateCountOk;

  this.devLog("SANITY_F_RESULT", {
    summary: "Sanity F result",
    selectionOpened,
    allowCancel,
    contractOk,
    strategyOk,
    candidateCount,
    candidateCountOk,
    cancelAttempted,
    selectionResolved,
    cleanupOk,
    pipelineResult,
  });

  return {
    success,
    selectionOpened,
    allowCancel,
    contractOk,
    strategyOk,
    candidateCount,
    candidateCountOk,
    cancelAttempted,
    selectionResolved,
    cleanupOk,
    pipelineResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityG() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_G_START", {
    summary: "Sanity G: bot optional min=0 selection",
  });

  const setupResult = this.applyManualSetup({
    turn: "bot",
    phase: "main1",
    player: {
      field: [
        {
          name: "Luminarch Valiant - Knight of the Dawn",
          position: "attack",
        },
      ],
    },
    bot: {
      field: [{ name: "Luminarch Magic Sickle", position: "attack" }],
    },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const source = this.bot.field.find(Boolean);
  if (!source) {
    return { success: false, reason: "Sanity G source card not found." };
  }

  const targetDefs = [
    {
      id: "sanity_optional_target",
      owner: "opponent",
      zone: "field",
      cardKind: "monster",
      requireFaceup: true,
      count: { min: 0, max: 1 },
    },
  ];

  let chosenCount = null;
  let selectionPrompted = false;

  const pipelineResult = await this.runActivationPipeline({
    card: source,
    owner: this.bot,
    activationZone: "field",
    activationContext: {
      fromHand: false,
      sourceZone: "field",
    },
    selectionKind: "sanityG",
    selectionMessage: "Sanity G: optional selection (bot).",
    activate: (selections, activationCtx) => {
      const ctx = {
        source,
        player: this.bot,
        opponent: this.player,
        activationZone: "field",
        activationContext: activationCtx,
      };
      const targetResult = this.effectEngine.resolveTargets(
        targetDefs,
        ctx,
        selections
      );
      if (targetResult.needsSelection) {
        selectionPrompted = true;
        return {
          success: false,
          needsSelection: true,
          selectionContract: targetResult.selectionContract,
        };
      }
      if (targetResult.ok === false) {
        return {
          success: false,
          needsSelection: false,
          reason: targetResult.reason,
        };
      }
      const chosen = targetResult.targets?.sanity_optional_target || [];
      chosenCount = chosen.length;
      return { success: true, needsSelection: false };
    },
  });

  const selectionOpened = !!this.targetSelection;
  this.devForceTargetCleanup();
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const resolvedOk =
    pipelineResult?.success === true &&
    pipelineResult?.needsSelection === false;
  const optionalOk = chosenCount === 0;
  const autoSelectedOk = !selectionOpened;
  const success = resolvedOk && optionalOk && autoSelectedOk && cleanupOk;

  this.devLog("SANITY_G_RESULT", {
    summary: "Sanity G result",
    selectionPrompted,
    chosenCount,
    resolvedOk,
    optionalOk,
    autoSelectedOk,
    cleanupOk,
    pipelineResult,
  });

  return {
    success,
    selectionPrompted,
    chosenCount,
    resolvedOk,
    optionalOk,
    autoSelectedOk,
    cleanupOk,
    pipelineResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityH() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_H_START", {
    summary: "Sanity H: Hydra Titan before_destroy battle + Mirror Force",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "battle",
    player: {
      field: [{ name: "Shadow-Heart Scale Dragon", position: "attack" }],
      spellTrap: ["Mirror Force"],
    },
    bot: {
      field: [
        { name: "Void Hydra Titan", position: "defense" },
        { name: "Void Hydra Titan", position: "attack" },
      ],
    },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const attacker = this.player.field.find(Boolean);
  const battleTarget = this.bot.field.find(
    (card) =>
      card && card.name === "Void Hydra Titan" && card.position === "defense"
  );
  const effectTarget = this.bot.field.find(
    (card) =>
      card && card.name === "Void Hydra Titan" && card.position === "attack"
  );
  const mirrorForce = this.player.spellTrap.find(
    (card) => card && card.name === "Mirror Force"
  );

  if (!attacker || !battleTarget || !effectTarget || !mirrorForce) {
    return { success: false, reason: "Sanity H setup missing cards." };
  }

  const battleAtkBefore = battleTarget.atk;
  const effectAtkBefore = effectTarget.atk;

  const battleResult = await this.destroyCard(battleTarget, {
    cause: "battle",
    sourceCard: attacker,
    opponent: this.player,
  });

  const battleNegated = battleResult?.negated === true;
  const battleSurvived = this.bot.field.includes(battleTarget);
  const battleAtkReduced = battleTarget.atk === battleAtkBefore - 700;

  const mirrorResult = await this.effectEngine.applyMirrorForceDestroy(
    {},
    {
      game: this,
      player: this.player,
      source: mirrorForce,
      card: mirrorForce,
      eventData: { attacker },
    }
  );

  const effectSurvived = this.bot.field.includes(effectTarget);
  const effectAtkReduced = effectTarget.atk === effectAtkBefore - 700;
  const effectNegated = effectSurvived && effectAtkReduced;

  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const success =
    battleNegated &&
    battleSurvived &&
    battleAtkReduced &&
    effectNegated &&
    cleanupOk &&
    mirrorResult === true;

  this.devLog("SANITY_H_RESULT", {
    summary: "Sanity H result",
    battleNegated,
    battleSurvived,
    battleAtkReduced,
    effectNegated,
    mirrorResult,
    cleanupOk,
  });

  return {
    success,
    battleNegated,
    battleSurvived,
    battleAtkReduced,
    effectNegated,
    mirrorResult,
    cleanupOk,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityI() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_I_START", {
    summary: "Sanity I: field full protection",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      hand: ["Shadow-Heart Griffin", "Shadow-Heart Covenant"],
      field: [
        { name: "Shadow-Heart Coward", position: "attack" },
        { name: "Shadow-Heart Abyssal Eel", position: "attack" },
        { name: "Shadow-Heart Specter", position: "attack" },
        { name: "Shadow-Heart Imp", position: "attack" },
        { name: "Shadow-Heart Gecko", position: "attack" },
      ],
      spellTrap: [
        "Shadow-Heart Battle Hymn",
        "Shadow-Heart Shield",
        "Shadow-Heart Covenant",
        "Shadow-Heart Purge",
        "Shadow-Heart Infusion",
      ],
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const extraMonster = this.player.hand.find(
    (card) => card && card.cardKind === "monster"
  );
  const extraSpell = this.player.hand.find(
    (card) => card && card.cardKind !== "monster"
  );

  if (!extraMonster || !extraSpell) {
    return { success: false, reason: "Sanity I hand cards missing." };
  }

  const beforeField = this.captureZoneSnapshot("sanity_i_before_field");
  const moveFieldResult = await this.moveCard(
    extraMonster,
    this.player,
    "field",
    {
      fromZone: "hand",
    }
  );
  const afterField = this.captureZoneSnapshot("sanity_i_after_field");
  const fieldStateOk = this.compareZoneSnapshot(
    beforeField,
    afterField,
    "player"
  );
  const monsterStillInHand = this.player.hand.includes(extraMonster);
  const fieldCountOk = this.player.field.length === 5;
  const moveFieldRejected = moveFieldResult?.success === false;

  const beforeSpell = this.captureZoneSnapshot("sanity_i_before_spell");
  const moveSpellResult = await this.moveCard(
    extraSpell,
    this.player,
    "spellTrap",
    { fromZone: "hand" }
  );
  const afterSpell = this.captureZoneSnapshot("sanity_i_after_spell");
  const spellStateOk = this.compareZoneSnapshot(
    beforeSpell,
    afterSpell,
    "player"
  );
  const spellStillInHand = this.player.hand.includes(extraSpell);
  const spellCountOk = this.player.spellTrap.length === 5;
  const moveSpellRejected = moveSpellResult?.success === false;

  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;
  if (!cleanupOk) {
    this.devForceTargetCleanup();
  }

  const success =
    fieldStateOk &&
    spellStateOk &&
    monsterStillInHand &&
    spellStillInHand &&
    fieldCountOk &&
    spellCountOk &&
    moveFieldRejected &&
    moveSpellRejected &&
    cleanupOk;

  this.devLog("SANITY_I_RESULT", {
    summary: "Sanity I result",
    fieldStateOk,
    spellStateOk,
    monsterStillInHand,
    spellStillInHand,
    fieldCountOk,
    spellCountOk,
    moveFieldRejected,
    moveSpellRejected,
    cleanupOk,
  });

  return {
    success,
    fieldStateOk,
    spellStateOk,
    monsterStillInHand,
    spellStillInHand,
    fieldCountOk,
    spellCountOk,
    moveFieldRejected,
    moveSpellRejected,
    cleanupOk,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityJ() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_J_START", {
    summary: "Sanity J: rollback invariants",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      hand: ["Shadow-Heart Coward"],
      field: [],
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const card = this.player.hand.find(Boolean);
  if (!card) {
    return { success: false, reason: "Sanity J card not found." };
  }

  const before = this.captureZoneSnapshot("sanity_j_before");
  let moveResult = null;
  this.devFailAfterZoneMutation = true;
  try {
    moveResult = await this.moveCard(card, this.player, "field", {
      fromZone: "hand",
    });
  } catch (err) {
    moveResult = {
      success: false,
      reason: err?.message || "exception",
      rolledBack: true,
    };
  } finally {
    if (this.devFailAfterZoneMutation) {
      this.devFailAfterZoneMutation = false;
    }
  }

  const after = this.captureZoneSnapshot("sanity_j_after");
  const stateOk = this.compareZoneSnapshot(before, after, "player");
  const cardInHand = this.player.hand.includes(card);
  const fieldEmpty = this.player.field.length === 0;
  const rollbackFlag =
    moveResult?.rolledBack === true || moveResult?.success === false;

  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const success =
    stateOk && cardInHand && fieldEmpty && rollbackFlag && cleanupOk;

  this.devLog("SANITY_J_RESULT", {
    summary: "Sanity J result",
    stateOk,
    cardInHand,
    fieldEmpty,
    rollbackFlag,
    cleanupOk,
    moveResult,
  });

  return {
    success,
    stateOk,
    cardInHand,
    fieldEmpty,
    rollbackFlag,
    cleanupOk,
    moveResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityK() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_K_START", {
    summary: "Sanity K: once per turn",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      field: [
        {
          name: "Luminarch Valiant - Knight of the Dawn",
          position: "attack",
        },
      ],
      fieldSpell: "Sanctum of the Luminarch Citadel",
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const fieldSpell = this.player.fieldSpell;
  if (!fieldSpell) {
    return { success: false, reason: "Sanity K field spell not found." };
  }

  const activationEffect =
    this.effectEngine?.getFieldSpellActivationEffect?.(fieldSpell);
  if (!activationEffect) {
    return {
      success: false,
      reason: "Sanity K field spell effect not found.",
    };
  }

  const baseConfig = {
    card: fieldSpell,
    owner: this.player,
    activationZone: "fieldSpell",
    activationContext: {
      fromHand: false,
      activationZone: "fieldSpell",
      sourceZone: "fieldSpell",
      committed: false,
    },
    selectionKind: "fieldSpell",
    selectionMessage: "Sanity K: select target for field spell effect.",
    oncePerTurn: {
      card: fieldSpell,
      player: this.player,
      effect: activationEffect,
    },
    activate: (selections, ctx) =>
      this.effectEngine.activateFieldSpell(
        fieldSpell,
        this.player,
        selections,
        ctx
      ),
    finalize: () => {
      this.updateBoard();
    },
  };

  const lpStart = this.player.lp;
  const firstResult = await this.runActivationPipeline(baseConfig);
  const firstSelectionOpened = !!this.targetSelection;
  let firstResolved = false;
  if (firstSelectionOpened) {
    const autoResult = await this.devAutoConfirmTargetSelection();
    firstResolved = autoResult.success === true;
  }
  const lpAfterFirst = this.player.lp;
  const firstLpDelta = lpStart - lpAfterFirst;

  const secondLpBefore = this.player.lp;
  const secondResult = await this.runActivationPipeline(baseConfig);
  const secondSelectionOpened = !!this.targetSelection;
  if (secondSelectionOpened) {
    await this.devAutoConfirmTargetSelection();
  }
  const secondLpAfter = this.player.lp;
  const secondBlocked =
    secondResult?.blockedOncePerTurn === true ||
    (typeof secondResult?.reason === "string" &&
      secondResult.reason.toLowerCase().includes("1/turn"));
  const secondStateOk = secondLpAfter === secondLpBefore;

  this.turnCounter += 1;
  this.turn = "player";
  this.phase = "main1";
  this.updateBoard();

  const thirdLpBefore = this.player.lp;
  const thirdResult = await this.runActivationPipeline(baseConfig);
  const thirdSelectionOpened = !!this.targetSelection;
  let thirdResolved = false;
  if (thirdSelectionOpened) {
    const autoResult = await this.devAutoConfirmTargetSelection();
    thirdResolved = autoResult.success === true;
  }
  const thirdLpAfter = this.player.lp;
  const thirdLpDelta = thirdLpBefore - thirdLpAfter;

  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const success =
    firstSelectionOpened &&
    firstResolved &&
    firstLpDelta === 1000 &&
    secondBlocked &&
    !secondSelectionOpened &&
    secondStateOk &&
    thirdSelectionOpened &&
    thirdResolved &&
    thirdLpDelta === 1000 &&
    cleanupOk;

  this.devLog("SANITY_K_RESULT", {
    summary: "Sanity K result",
    firstSelectionOpened,
    firstResolved,
    firstLpDelta,
    secondBlocked,
    secondSelectionOpened,
    secondStateOk,
    thirdSelectionOpened,
    thirdResolved,
    thirdLpDelta,
    cleanupOk,
    firstResult,
    secondResult,
    thirdResult,
  });

  return {
    success,
    firstSelectionOpened,
    firstResolved,
    firstLpDelta,
    secondBlocked,
    secondSelectionOpened,
    secondStateOk,
    thirdSelectionOpened,
    thirdResolved,
    thirdLpDelta,
    cleanupOk,
    firstResult,
    secondResult,
    thirdResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityL() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_L_START", {
    summary: "Sanity L: action while selecting",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      hand: ["Luminarch Holy Ascension", "Luminarch Holy Ascension"],
      field: [
        {
          name: "Luminarch Valiant - Knight of the Dawn",
          position: "attack",
        },
      ],
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const firstCard = this.player.hand.find(
    (c) => c && c.name === "Luminarch Holy Ascension"
  );
  if (!firstCard) {
    return { success: false, reason: "Sanity L card not found in hand." };
  }
  const firstIndex = this.player.hand.indexOf(firstCard);

  const firstResult = await this.tryActivateSpell(firstCard, firstIndex);
  const selectionOpened = !!this.targetSelection;

  const secondCard = this.player.hand.find((c) => c && c !== firstCard);
  if (!secondCard) {
    return { success: false, reason: "Sanity L second card not found." };
  }
  const secondIndex = this.player.hand.indexOf(secondCard);
  const secondResult = await this.tryActivateSpell(secondCard, secondIndex);
  const secondBlocked =
    secondResult?.code === "BLOCKED_SELECTION_ACTIVE" &&
    secondResult?.blockedByGuard === true;

  const phaseBefore = this.phase;
  const phaseResult = await this.nextPhase();
  const phaseBlocked =
    phaseResult?.code === "BLOCKED_SELECTION_ACTIVE" &&
    this.phase === phaseBefore;

  const attacker = this.player.field.find((c) => c && c.cardKind === "monster");
  let attackBlocked = false;
  let attackResult = null;
  if (attacker) {
    const attackedBefore = attacker.hasAttacked === true;
    attackResult = await this.resolveCombat(attacker, null);
    attackBlocked =
      attackResult?.code === "BLOCKED_SELECTION_ACTIVE" &&
      attacker.hasAttacked === attackedBefore;
  }

  let selectionResolved = false;
  if (this.targetSelection) {
    const allowCancel = !this.targetSelection.preventCancel;
    if (allowCancel) {
      this.cancelTargetSelection();
      selectionResolved = true;
    } else {
      const autoResult = await this.devAutoConfirmTargetSelection();
      selectionResolved = autoResult.success === true;
    }
  }

  this.devForceTargetCleanup();
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const success =
    selectionOpened &&
    secondBlocked &&
    phaseBlocked &&
    attackBlocked &&
    selectionResolved &&
    cleanupOk;

  this.devLog("SANITY_L_RESULT", {
    summary: "Sanity L result",
    selectionOpened,
    secondBlocked,
    phaseBlocked,
    attackBlocked,
    selectionResolved,
    cleanupOk,
    firstResult,
    secondResult,
    phaseResult,
    attackResult,
  });

  return {
    success,
    selectionOpened,
    secondBlocked,
    phaseBlocked,
    attackBlocked,
    selectionResolved,
    cleanupOk,
    firstResult,
    secondResult,
    phaseResult,
    attackResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityM() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_M_START", {
    summary: "Sanity M: action while resolving",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      hand: ["Luminarch Holy Ascension"],
      field: [
        {
          name: "Luminarch Valiant - Knight of the Dawn",
          position: "attack",
        },
      ],
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const card = this.player.hand.find(
    (c) => c && c.name === "Luminarch Holy Ascension"
  );
  if (!card) {
    return { success: false, reason: "Sanity M card not found in hand." };
  }
  const handIndex = this.player.hand.indexOf(card);
  const handSizeBefore = this.player.hand.length;

  let result = null;
  this.isResolvingEffect = true;
  try {
    result = await this.tryActivateSpell(card, handIndex);
  } finally {
    this.isResolvingEffect = false;
  }

  const cardStillInHand = this.player.hand.includes(card);
  const handSizeOk = this.player.hand.length === handSizeBefore;
  const blocked =
    result?.code === "BLOCKED_RESOLVING" && result?.blockedByGuard === true;

  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;

  const success = blocked && cardStillInHand && handSizeOk && cleanupOk;

  this.devLog("SANITY_M_RESULT", {
    summary: "Sanity M result",
    blocked,
    cardStillInHand,
    handSizeOk,
    cleanupOk,
    result,
  });

  return {
    success,
    blocked,
    cardStillInHand,
    handSizeOk,
    cleanupOk,
    result,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityN() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_N_START", {
    summary: "Sanity N: deck empty draw",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "draw",
    player: {
      hand: [],
      deck: [],
    },
    bot: {},
  });

  if (!setupResult.success) {
    return setupResult;
  }

  const handSizeBefore = this.player.hand.length;
  const drawResult = this.drawCards(this.player, 1);

  const blocked =
    drawResult?.ok === false && drawResult?.reason === "deck_empty";
  const handUnchanged = this.player.hand.length === handSizeBefore;
  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;
  if (!cleanupOk) {
    this.devForceTargetCleanup();
  }

  const success = blocked && handUnchanged && cleanupOk;

  this.devLog("SANITY_N_RESULT", {
    summary: "Sanity N result",
    blocked,
    handUnchanged,
    cleanupOk,
    drawResult,
  });

  return {
    success,
    blocked,
    handUnchanged,
    cleanupOk,
    drawResult,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devRunSanityO() {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  this.devLog("SANITY_O_START", {
    summary: "Sanity O: stale target selection",
  });

  const setupResult = this.applyManualSetup({
    turn: "player",
    phase: "main1",
    player: {
      hand: ["Luminarch Holy Ascension"],
      field: [
        {
          name: "Luminarch Valiant - Knight of the Dawn",
          position: "attack",
          facedown: false,
        },
        {
          name: "Luminarch Magic Sickle",
          position: "attack",
          facedown: false,
        },
      ],
    },
    bot: { field: [] },
  });

  if (!setupResult.success) {
    return setupResult;
  }

  this.player.field.forEach((card) => {
    if (!card || card.cardKind !== "monster") return;
    this.setMonsterFacing(card, { position: "attack", facedown: false });
  });
  this.updateBoard();

  const spell = this.player.hand.find(
    (card) => card && card.name === "Luminarch Holy Ascension"
  );
  if (!spell) {
    return { success: false, reason: "Sanity O card not found in hand." };
  }

  const handIndex = this.player.hand.indexOf(spell);
  let finalResult = null;
  const selectionSessionBefore = this.selectionSessionCounter;

  const pipelineResult = await this.runActivationPipeline({
    card: spell,
    owner: this.player,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Sanity O: select target(s) for the spell.",
    gate: () => {
      if (this.turn !== "player") return { ok: false };
      if (this.phase !== "main1" && this.phase !== "main2") {
        return {
          ok: false,
          reason: "Can only activate spells during Main Phase.",
        };
      }
      if (this.isResolvingEffect) {
        return {
          ok: false,
          reason: "Finish the current effect before activating another card.",
        };
      }
      return { ok: true };
    },
    preview: () =>
      this.effectEngine?.canActivateSpellFromHandPreview?.(spell, this.player),
    commit: () => this.commitCardActivationFromHand(this.player, handIndex),
    activationContext: {
      fromHand: true,
      sourceZone: "hand",
    },
    activate: (chosen, ctx, zone, resolvedCard) =>
      this.effectEngine.activateSpellTrapEffect(
        resolvedCard,
        this.player,
        chosen,
        zone,
        ctx
      ),
    finalize: (result, info) => {
      if (!result.placementOnly) {
        this.finalizeSpellTrapActivation(
          info.card,
          this.player,
          info.activationZone
        );
      }
      this.updateBoard();
    },
    onSuccess: (result) => {
      finalResult = result;
    },
    onFailure: (result) => {
      finalResult = result;
    },
  });

  const selectionOpened = this.selectionSessionCounter > selectionSessionBefore;
  let invalidated = false;
  let selectionConfirmed = false;
  let candidateKey = null;
  let usedManualConfirm = false;
  let candidateCount = 0;

  if (selectionOpened && this.targetSelection) {
    const requirement = this.targetSelection.requirements?.[0] || null;
    const candidates = requirement?.candidates || [];
    candidateCount = candidates.length;
    const candidate = candidates[0] || null;
    candidateKey = candidate?.key || null;
    if (candidate?.cardRef) {
      this.setMonsterFacing(candidate.cardRef, { facedown: true });
      this.updateBoard();
      invalidated = true;
    }

    if (candidateKey && requirement?.id) {
      this.targetSelection.selections = {
        ...(this.targetSelection.selections || {}),
        [requirement.id]: [candidateKey],
      };
      this.targetSelection.currentRequirement =
        this.targetSelection.requirements.length;
      this.setSelectionState("confirming");
      await this.finishTargetSelection();
      usedManualConfirm = true;
      selectionConfirmed = true;
    } else {
      const confirmResult = await this.devAutoConfirmTargetSelection();
      selectionConfirmed = confirmResult?.success === true;
    }
  }

  const resultFailed =
    finalResult &&
    finalResult.success === false &&
    finalResult.reason === "Selected targets are no longer valid.";
  const spellBackInHand = this.player.hand.includes(spell);
  const spellIndexRestored = this.player.hand[handIndex] === spell;

  const cleanupState = this.devGetSelectionCleanupState();
  const cleanupOk =
    !cleanupState.selectionActive &&
    !cleanupState.controlsVisible &&
    cleanupState.highlightCount === 0;
  if (!cleanupOk) {
    this.devForceTargetCleanup();
  }

  const success =
    pipelineResult?.needsSelection === true &&
    selectionOpened &&
    candidateCount >= 2 &&
    !!candidateKey &&
    invalidated &&
    selectionConfirmed &&
    resultFailed &&
    spellBackInHand &&
    spellIndexRestored &&
    cleanupOk;

  this.devLog("SANITY_O_RESULT", {
    summary: "Sanity O result",
    selectionOpened,
    candidateCount,
    invalidated,
    selectionConfirmed,
    candidateKey,
    usedManualConfirm,
    resultFailed,
    spellBackInHand,
    spellIndexRestored,
    cleanupOk,
    finalResult,
  });

  return {
    success,
    selectionOpened,
    candidateCount,
    invalidated,
    selectionConfirmed,
    resultFailed,
    spellBackInHand,
    spellIndexRestored,
    cleanupOk,
    finalResult,
  };
}
