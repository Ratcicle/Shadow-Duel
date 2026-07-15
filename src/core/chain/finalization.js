import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";
import { CHAIN_ACTIVATION_KINDS } from "./link.js";

function cardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function isSpellTrap(card) {
  return card?.cardKind === "spell" || card?.cardKind === "trap";
}

function isSingleUseSpellTrap(card) {
  if (card?.cardKind === "spell") {
    return card.subtype === "normal" || isQuickSpell(card);
  }
  return (
    card?.cardKind === "trap" &&
    (card.subtype === "normal" || card.subtype === "counter")
  );
}

function compactOutcome(outcome = {}) {
  return {
    success: outcome.success !== false,
    activationNegated: outcome.activationNegated === true,
    effectNegated: outcome.effectNegated === true,
    fizzled: outcome.fizzled === true,
    resolvedWithoutEffect: outcome.resolvedWithoutEffect === true,
    reason: outcome.reason || null,
  };
}

function compactEntry(entry) {
  if (!entry) return null;
  return {
    finalizationId: entry.finalizationId,
    chainId: entry.chainId,
    linkId: entry.linkId,
    chainLevel: entry.chainLevel,
    cardInstanceId: entry.cardInstanceId,
    cardName: entry.cardName,
    controllerId: entry.controllerId,
    activationZone: entry.activationZone,
    activationKind: entry.activationKind,
    cardKind: entry.cardKind,
    subtype: entry.subtype,
    sourceLocationVersion: entry.sourceLocationVersion,
    status: entry.status,
    disposition: entry.disposition,
    outcome: { ...entry.outcome },
  };
}

function notifyFinalization(chainSystem, stage, entry) {
  chainSystem.game?.notify?.("chain_finalization", {
    stage,
    ...compactEntry(entry),
  });
}

function currentSourceState(chainSystem, entry) {
  const zone = chainSystem.determineCardZone?.(entry.card, entry.controller);
  const locationVersion = Number(entry.card?.locationVersion ?? 0);
  return {
    zone,
    locationVersion,
    samePermanence:
      zone === entry.activationZone &&
      locationVersion === Number(entry.sourceLocationVersion ?? 0),
  };
}

async function runPipelineFinalization(entry) {
  if (typeof entry.link?.pipelineFinalization !== "function") return false;
  await entry.link.pipelineFinalization(entry.rawOutcome, {
    chainId: entry.chainId,
    linkId: entry.linkId,
    finalizationId: entry.finalizationId,
  });
  return true;
}

function registerLegacyUsage(chainSystem, entry) {
  const link = entry.link;
  const effect = link?.effect;
  if (
    !effect ||
    link.skipUsageRegistration === true ||
    effect.usagePolicy === "use" ||
    effect.usagePolicy === "activate"
  ) {
    return;
  }
  const outcome = entry.outcome;
  const applied =
    outcome.success !== false &&
    outcome.activationNegated !== true &&
    outcome.effectNegated !== true &&
    outcome.fizzled !== true &&
    outcome.resolvedWithoutEffect !== true;
  if (!applied) return;
  if (effect.oncePerTurn) {
    chainSystem.game?.effectEngine?.registerOncePerTurnUsage?.(
      link.card,
      link.controller,
      effect,
    );
  }
  if (effect.oncePerDuel) {
    chainSystem.game?.effectEngine?.registerOncePerDuelUsage?.(
      link.card,
      link.controller,
      effect,
    );
  }
}

async function moveToGraveyard(chainSystem, entry, contextLabel) {
  const state = currentSourceState(chainSystem, entry);
  if (!state.samePermanence) {
    entry.status = "already_moved";
    entry.disposition = state.zone || "unknown";
    return false;
  }
  const result = await chainSystem.game?.moveCard?.(
    entry.card,
    entry.controller,
    "graveyard",
    {
      fromZone: entry.activationZone,
      sourceCard: entry.card,
      effectId: entry.link?.effectId || entry.link?.effect?.id || null,
      chainId: entry.chainId,
      linkId: entry.linkId,
      contextLabel,
      awaitEvents: true,
      deferCardToGraveTriggerResolution: true,
    },
  );
  if (result?.success === false) {
    entry.status = "failed";
    entry.disposition = state.zone || "unknown";
    return false;
  }
  entry.status = "completed";
  entry.disposition = "graveyard";
  return true;
}

export function queueChainFinalization(link, outcome = {}) {
  if (!link || link.finalizationQueued === true) return null;
  if (!Number.isInteger(this.nextFinalizationId)) this.nextFinalizationId = 1;
  if (!Array.isArray(this.pendingChainFinalizations)) {
    this.pendingChainFinalizations = [];
  }
  const entry = {
    finalizationId: this.nextFinalizationId++,
    chainId: link.chainId,
    linkId: link.linkId,
    chainLevel: link.chainLevel,
    card: link.card,
    cardInstanceId: cardInstanceId(link.card),
    cardName: link.card?.name || "Unknown",
    controller: link.controller,
    controllerId: link.controller?.id || null,
    activationZone: link.activationZone || null,
    activationKind: link.activationKind || null,
    cardKind: link.card?.cardKind || null,
    subtype: link.card?.subtype || null,
    sourceLocationVersion:
      link.sourceAtActivation?.locationVersion ??
      Number(link.card?.locationVersion ?? 0),
    status: "queued",
    disposition: null,
    outcome: compactOutcome(outcome),
    rawOutcome: outcome,
    link,
  };
  link.finalizationQueued = true;
  link.finalizationStatus = "queued";
  this.pendingChainFinalizations.push(entry);
  notifyFinalization(this, "queued", entry);
  return compactEntry(entry);
}

export function getChainFinalizationState() {
  return {
    finalizing: this.isFinalizingChain === true,
    pendingCount: this.pendingChainFinalizations?.length || 0,
    entries: (this.pendingChainFinalizations || []).map(compactEntry),
  };
}

export function resetChainFinalizationState(reason = "reset") {
  for (const entry of this.pendingChainFinalizations || []) {
    if (entry.status === "queued") {
      entry.status = "cancelled";
      entry.disposition = reason;
      entry.link.finalizationStatus = "cancelled";
      notifyFinalization(this, "cancelled", entry);
    }
  }
  this.pendingChainFinalizations = [];
  this.isFinalizingChain = false;
  this.currentFinalizingLink = null;
  return this.getChainFinalizationState();
}

async function finalizeEntry(chainSystem, entry) {
  const link = entry.link;
  const outcome = entry.outcome;
  const cardActivation =
    entry.activationKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD;
  const spellTrap = isSpellTrap(entry.card);
  const activationNegated = outcome.activationNegated === true;
  const shouldUseDefault =
    spellTrap &&
    cardActivation &&
    (activationNegated ||
      (link.skipDefaultFinalization !== true &&
        isSingleUseSpellTrap(entry.card)));

  chainSystem.currentFinalizingLink = link;
  try {
    if (shouldUseDefault) {
      await moveToGraveyard(
        chainSystem,
        entry,
        activationNegated
          ? "negated_activation_cleanup"
          : "post_chain_cleanup",
      );
    } else if (link.skipDefaultFinalization === true) {
      await runPipelineFinalization(entry);
      const state = currentSourceState(chainSystem, entry);
      entry.status = state.samePermanence ? "retained" : "completed";
      entry.disposition = state.zone || "unknown";
    } else {
      const state = currentSourceState(chainSystem, entry);
      entry.status = state.samePermanence ? "retained" : "already_moved";
      entry.disposition = state.zone || "unknown";
    }

    if (link.skipDefaultFinalization !== true || activationNegated) {
      await runPipelineFinalization(entry);
    }
    registerLegacyUsage(chainSystem, entry);
    link.finalizationStatus = entry.status;
    notifyFinalization(chainSystem, "completed", entry);
    return compactEntry(entry);
  } catch (error) {
    entry.status = "failed";
    entry.disposition =
      chainSystem.determineCardZone?.(entry.card, entry.controller) || "unknown";
    link.finalizationStatus = "failed";
    notifyFinalization(chainSystem, "failed", entry);
    chainSystem.log?.(
      `[ChainSystem] Finalization failed for ${entry.cardName}: ${error?.message || error}`,
    );
    return compactEntry(entry);
  } finally {
    if (chainSystem.currentFinalizingLink === link) {
      chainSystem.currentFinalizingLink = null;
    }
  }
}

export async function finalizeWholeChain(options = {}) {
  if (this.isFinalizingChain === true) {
    return {
      ok: false,
      success: false,
      reason: "chain_finalization_reentry",
      entries: [],
    };
  }
  const pending = Array.isArray(this.pendingChainFinalizations)
    ? this.pendingChainFinalizations.splice(0)
    : [];
  if (pending.length === 0) {
    return { ok: true, success: true, entries: [] };
  }

  this.isFinalizingChain = true;
  const completed = [];
  try {
    for (const entry of pending) {
      completed.push(await finalizeEntry(this, entry));
    }
  } finally {
    this.isFinalizingChain = false;
  }
  this.game?.notify?.("chain_finalization_complete", {
    chainId: options.chainId ?? completed[0]?.chainId ?? null,
    count: completed.length,
    entries: completed,
  });
  this.game?.updateBoard?.();
  return {
    ok: completed.every((entry) => entry.status !== "failed"),
    success: completed.every((entry) => entry.status !== "failed"),
    entries: completed,
  };
}
