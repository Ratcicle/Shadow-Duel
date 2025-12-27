import { cardDatabase, cardDatabaseById } from "../data/cards.js";
import {
  ActionHandlerRegistry,
  registerDefaultHandlers,
} from "./ActionHandlers.js";

const VALID_TIMINGS = new Set([
  "on_play",
  "on_event",
  "on_activate",
  "ignition",
  "on_field_activate",
  "passive",
]);

const VALID_EVENTS = new Set([
  "after_summon",
  "battle_destroy",
  "card_to_grave",
  "standby_phase",
  "attack_declared",
  "opponent_damage",
  "before_destroy",
  "effect_targeted",
]);

function formatIssue(card, message, effectIndex = null, actionIndex = null) {
  return {
    cardId: card?.id ?? null,
    cardName: card?.name ?? "Unknown",
    effectIndex,
    actionIndex,
    message,
  };
}

export function validateCardDatabase() {
  const errors = [];
  const warnings = [];

  const registry = new ActionHandlerRegistry();
  registerDefaultHandlers(registry);
  const registeredHandlerTypes =
    typeof registry.listTypes === "function"
      ? registry.listTypes()
      : Array.from(registry.handlers?.keys?.() ?? []);

  const allowedActionTypes = new Set(registeredHandlerTypes);

  const seenIds = new Map();
  const seenNames = new Map();

  for (const card of cardDatabase) {
    // Basic monster type checks for Extra Deck categories
    if (card.monsterType === "ascension") {
      // Must be a monster and live in Extra Deck during play; validate ascension metadata
      if (card.cardKind !== "monster") {
        warnings.push(
          formatIssue(
            card,
            'Ascension card should have cardKind "monster".',
            null,
            null
          )
        );
      }
      const asc = card.ascension;
      if (!asc || typeof asc !== "object") {
        errors.push(
          formatIssue(card, "Ascension cards must define ascension metadata.")
        );
      } else {
        const materialId = asc.materialId;
        if (!Number.isFinite(materialId)) {
          errors.push(
            formatIssue(card, "Ascension.materialId must be a finite number.")
          );
        } else if (!cardDatabaseById.get(materialId)) {
          errors.push(
            formatIssue(
              card,
              `Ascension.materialId ${materialId} not found in card database.`
            )
          );
        }
        const reqs = Array.isArray(asc.requirements) ? asc.requirements : [];
        reqs.forEach((req, idx) => {
          if (!req || typeof req !== "object") {
            errors.push(
              formatIssue(
                card,
                "Ascension.requirements entries must be objects.",
                null,
                idx
              )
            );
            return;
          }
          const allowedReqs = new Set([
            "material_destroyed_opponent_monsters",
            "material_effect_activations",
            "player_lp_gte",
            "player_lp_lte",
            "player_hand_gte",
            "player_graveyard_gte",
          ]);
          if (!req.type || !allowedReqs.has(req.type)) {
            warnings.push(
              formatIssue(
                card,
                `Unknown or unsupported ascension requirement type "${req.type}".`,
                null,
                idx
              )
            );
          }
        });
      }
    }
    if (typeof card.id !== "number" || !Number.isFinite(card.id)) {
      errors.push(
        formatIssue(card, "Card id must be a finite number.", null, null)
      );
    } else if (card.id <= 0) {
      errors.push(formatIssue(card, "Card id must be greater than zero."));
    } else if (seenIds.has(card.id)) {
      errors.push(
        formatIssue(
          card,
          `Duplicated id. Also used by "${seenIds.get(card.id)}".`
        )
      );
    } else {
      seenIds.set(card.id, card.name || `ID ${card.id}`);
    }

    if (!card.name || typeof card.name !== "string") {
      errors.push(
        formatIssue(card, "Card name must be a non-empty string.", null, null)
      );
    } else if (seenNames.has(card.name)) {
      errors.push(
        formatIssue(
          card,
          `Duplicated name. Also used by id ${seenNames.get(card.name)}.`
        )
      );
    } else {
      seenNames.set(card.name, card.id);
    }

    const rawEffects = card.effects;
    let effects = [];
    if (rawEffects === undefined) {
      effects = [];
    } else if (Array.isArray(rawEffects)) {
      effects = rawEffects;
    } else {
      errors.push(
        formatIssue(card, "Effects must be an array when defined.", null, null)
      );
      continue;
    }

    effects.forEach((effect, effectIndex) => {
      if (!effect || typeof effect !== "object") {
        errors.push(
          formatIssue(card, "Effect must be an object.", effectIndex, null)
        );
        return;
      }

      if (effect.timing && !VALID_TIMINGS.has(effect.timing)) {
        errors.push(
          formatIssue(
            card,
            `Invalid timing "${effect.timing}".`,
            effectIndex,
            null
          )
        );
      }

      if (effect.timing === "on_event") {
        if (!effect.event) {
          errors.push(
            formatIssue(
              card,
              "Effects with timing 'on_event' must declare an event.",
              effectIndex,
              null
            )
          );
        } else if (!VALID_EVENTS.has(effect.event)) {
          errors.push(
            formatIssue(
              card,
              `Invalid event "${effect.event}".`,
              effectIndex,
              null
            )
          );
        }
      } else if (effect.event) {
        if (!VALID_EVENTS.has(effect.event)) {
          errors.push(
            formatIssue(
              card,
              `Invalid event "${effect.event}".`,
              effectIndex,
              null
            )
          );
        } else {
          warnings.push(
            formatIssue(
              card,
              `Effect defines event "${effect.event}" but timing is "${
                effect.timing || "undefined"
              }".`,
              effectIndex,
              null
            )
          );
        }
      }

      if (effect.summonMethod !== undefined) {
        warnings.push(
          formatIssue(
            card,
            'Use "summonMethods" (array) instead of "summonMethod".',
            effectIndex,
            null
          )
        );
      }

      if (effect.requireSummonedFrom !== undefined) {
        warnings.push(
          formatIssue(
            card,
            'Use "summonFrom" instead of "requireSummonedFrom".',
            effectIndex,
            null
          )
        );
      }

      if (
        effect.summonMethods !== undefined &&
        !Array.isArray(effect.summonMethods)
      ) {
        errors.push(
          formatIssue(
            card,
            'Effect "summonMethods" must be an array.',
            effectIndex,
            null
          )
        );
      }

      const effectActions = Array.isArray(effect.actions) ? effect.actions : [];

      effectActions.forEach((action, actionIndex) => {
        if (!action || typeof action !== "object") {
          errors.push(
            formatIssue(
              card,
              "Action must be an object.",
              effectIndex,
              actionIndex
            )
          );
          return;
        }

        if (!action.type || typeof action.type !== "string") {
          errors.push(
            formatIssue(
              card,
              "Action type must be a non-empty string.",
              effectIndex,
              actionIndex
            )
          );
          return;
        }

        if (!allowedActionTypes.has(action.type)) {
          errors.push(
            formatIssue(
              card,
              `Action type "${action.type}" is not registered.`,
              effectIndex,
              actionIndex
            )
          );
        }
      });
    });
  }

  return { errors, warnings };
}
