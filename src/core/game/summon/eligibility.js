function normalizeProcedures(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

export function checkSpecialSummonEligibility(card, options = {}) {
  if (!card) {
    return { ok: false, code: "missing_card", reason: "No card to summon." };
  }
  if (card.cannotBeSpecialSummoned === true) {
    return {
      ok: false,
      code: "cannot_be_special_summoned",
      reason: `${card.name || "This card"} cannot be Special Summoned.`,
    };
  }

  const summonProcedure = options.summonProcedure || "special";
  const fromZone = options.fromZone || null;
  const strictProcedures = normalizeProcedures(card.specialSummonOnlyBy);
  if (
    strictProcedures.length > 0 &&
    !strictProcedures.includes(summonProcedure)
  ) {
    return {
      ok: false,
      code: "special_summon_restriction",
      reason: `${card.name || "This card"} cannot be Special Summoned this way.`,
    };
  }

  const firstProcedures = normalizeProcedures(
    card.mustFirstBeSpecialSummonedBy,
  );
  if (firstProcedures.length === 0) return { ok: true };

  if (fromZone === "extraDeck") {
    if (firstProcedures.includes(summonProcedure)) return { ok: true };
    return {
      ok: false,
      code: "proper_summon_required",
      reason: `${card.name || "This card"} must first be Special Summoned by its proper procedure.`,
    };
  }

  if (card.properSummonEstablished === true) return { ok: true };
  return {
    ok: false,
    code: "proper_summon_required",
    reason: `${card.name || "This card"} was not properly Special Summoned first.`,
  };
}

export function establishProperSummon(card, transaction = {}) {
  if (!card) return false;
  const allowed = normalizeProcedures(card.mustFirstBeSpecialSummonedBy);
  const procedure = transaction.summonProcedure || null;
  const sourceZone =
    transaction.sourceZone ||
    transaction.fromZone ||
    transaction.sourceAtStart?.zone ||
    null;
  if (
    allowed.length === 0 ||
    !allowed.includes(procedure) ||
    sourceZone !== "extraDeck"
  ) {
    return false;
  }
  card.properSummonEstablished = true;
  card.properSummonProcedure = procedure;
  return true;
}

export function resetProperSummon(card) {
  if (!card) return false;
  card.properSummonEstablished = false;
  card.properSummonProcedure = null;
  return true;
}
