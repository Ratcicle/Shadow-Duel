import type { SpecialSummonProcedure } from "../../contracts/cards.js";
import type { CanonicalZone } from "../../contracts/zones.js";

export interface SpecialSummonEligibilityCard {
  name?: string | null;
  cannotBeSpecialSummoned?: boolean;
  specialSummonOnlyBy?: readonly string[] | string | null;
  mustFirstBeSpecialSummonedBy?: readonly string[] | string | null;
  properSummonEstablished?: boolean;
  properSummonProcedure?: string | null;
}

export interface SpecialSummonEligibilityOptions {
  summonProcedure?: SpecialSummonProcedure | string | null;
  fromZone?: CanonicalZone | string | null;
}

export interface ProperSummonTransactionInput {
  summonProcedure?: SpecialSummonProcedure | string | null;
  sourceZone?: CanonicalZone | string | null;
  fromZone?: CanonicalZone | string | null;
  sourceAtStart?: { zone?: CanonicalZone | string | null } | null;
}

export type SpecialSummonEligibilityResult =
  | { ok: true }
  | { ok: false; code: string; reason: string };

function normalizeProcedures(
  value: readonly string[] | string | null | undefined,
): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value as string] : [];
}

export function checkSpecialSummonEligibility(
  card: SpecialSummonEligibilityCard | null | undefined,
  options: SpecialSummonEligibilityOptions = {},
): SpecialSummonEligibilityResult {
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

export function establishProperSummon(
  card: SpecialSummonEligibilityCard | null | undefined,
  transaction: ProperSummonTransactionInput = {},
): boolean {
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
    procedure === null ||
    !allowed.includes(procedure) ||
    sourceZone !== "extraDeck"
  ) {
    return false;
  }
  card.properSummonEstablished = true;
  card.properSummonProcedure = procedure;
  return true;
}

export function resetProperSummon(
  card: SpecialSummonEligibilityCard | null | undefined,
): boolean {
  if (!card) return false;
  card.properSummonEstablished = false;
  card.properSummonProcedure = null;
  return true;
}
