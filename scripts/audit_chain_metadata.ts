import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import type { RawCardDefinition } from "../src/core/contracts/cards.js";
import type { EffectDefinition } from "../src/core/contracts/effects.js";
import { cardDatabase } from "../src/data/cards.js";

// Audit legacy keys as well as the current authoring contract.
type AuditedEffect = EffectDefinition & {
  allowDamageStepActivation?: unknown;
  manualActivationOnly?: unknown;
};

const effects = cardDatabase.flatMap((card: RawCardDefinition) =>
  (card.effects || []).map((effect: AuditedEffect) => ({ card, effect })),
);

const ambiguities = [];
for (const { card, effect } of effects) {
  const prefix = `${card.id}:${card.name}:${effect.id || "effect"}`;
  if (
    (effect.timing === "ignition" || effect.timing === "manual") &&
    (!Array.isArray(effect.activationZones) ||
      effect.activationZones.length === 0)
  ) {
    ambiguities.push(`${prefix}: missing activationZones`);
  }
  if (
    (effect.oncePerTurn || effect.oncePerDuel) &&
    !["use", "activate"].includes(effect.usagePolicy ?? "")
  ) {
    ambiguities.push(`${prefix}: missing usagePolicy`);
  }
  if (effect.allowDamageStepActivation !== undefined) {
    ambiguities.push(`${prefix}: forbidden allowDamageStepActivation`);
  }
  if (effect.manualActivationOnly !== undefined) {
    ambiguities.push(`${prefix}: forbidden manualActivationOnly`);
  }
  if (
    (effect.timing === "ignition" || effect.timing === "manual") &&
    effect.requireZone !== undefined
  ) {
    ambiguities.push(
      `${prefix}: ignition/manual uses requireZone instead of activationZones`,
    );
  }
}

const validation = validateCardDatabase();
const report = {
  cards: cardDatabase.length,
  effects: effects.length,
  ignitionOrManual: effects.filter(({ effect }) =>
    ["ignition", "manual"].includes(effect.timing ?? ""),
  ).length,
  limitedEffects: effects.filter(
    ({ effect }) => effect.oncePerTurn || effect.oncePerDuel,
  ).length,
  labeledEffects: effects.filter(({ effect }) => effect.activationLabelKey)
    .length,
  metadataAmbiguities: ambiguities.length,
  validationErrors: validation.errors.length,
  validationWarnings: validation.warnings.length,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...report, ambiguities }, null, 2));
} else {
  console.log(
    `[chain-metadata] ${report.cards} cards, ${report.effects} effects, ` +
      `${report.metadataAmbiguities} ambiguities, ${report.validationErrors} errors, ` +
      `${report.validationWarnings} warnings.`,
  );
}

if (
  ambiguities.length > 0 ||
  validation.errors.length > 0 ||
  validation.warnings.length > 0
) {
  for (const issue of ambiguities) console.error(issue);
  for (const issue of validation.errors) console.error(issue.message);
  for (const issue of validation.warnings) console.error(issue.message);
  process.exitCode = 1;
}
