import {
  cardDatabase,
  cardDatabaseById,
  cardDatabaseGroups,
} from "../data/cards.js";
import {
  CARD_ID_RANGE_POLICY,
  getCardIdRangeByKey,
  getCardIdRangeSize,
  isCardIdInRange,
  validateCardIdRangeRegistry,
} from "../data/cards/ranges.js";
import {
  ActionHandlerRegistry,
  registerDefaultHandlers,
} from "./ActionHandlers.js";
import {
  getActionCatalogEntry,
  validateActionShape,
} from "./actionHandlers/actionCatalog.js";

const VALID_TIMINGS = new Set([
  "on_play",
  "on_event",
  "on_activate",
  "ignition",
  "on_field_activate",
  "passive",
  "manual",
]);

// `on_activate` effects may be scoped to a specific response window. This is
// distinct from `on_event`: the event limits when the player may activate the
// card, but the effect is not collected as an automatic event trigger.
const EVENT_COMPATIBLE_TIMINGS = new Set(["on_event", "on_activate"]);
const VALID_TRIGGER_REQUIREMENTS = new Set(["mandatory", "optional"]);
const VALID_TRIGGER_TIMINGS = new Set(["if", "when"]);
const VALID_ACTIVATION_ZONES = new Set([
  "hand",
  "field",
  "spellTrap",
  "fieldSpell",
  "graveyard",
  "banished",
]);
const VALID_USAGE_POLICIES = new Set(["use", "activate"]);
const VALID_DAMAGE_STEP_TIMINGS = new Set([
  "start_of_damage_step",
  "before_damage_calculation",
  "damage_calculation",
  "after_damage_calculation",
  "end_of_damage_step",
]);

function flattenActions(actions = []) {
  const flattened = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action || typeof action !== "object") continue;
    flattened.push(action);
    for (const key of ["actions", "thenActions", "elseActions"]) {
      flattened.push(...flattenActions(action[key]));
    }
    for (const option of Array.isArray(action.cases) ? action.cases : []) {
      flattened.push(...flattenActions(option?.actions));
    }
  }
  return flattened;
}

function activationCollisionKey(effect) {
  if (!effect || effect.timing === "passive") return null;
  if (effect.timing === "on_event") {
    return `trigger:${effect.event || "unknown"}`;
  }
  if (effect.timing === "ignition" || effect.timing === "manual") {
    const zones = Array.isArray(effect.activationZones)
      ? [...effect.activationZones].sort().join(",")
      : effect.requireZone || "unknown";
    return `manual:${effect.timing}:${zones}`;
  }
  return null;
}

const VALID_EVENTS = new Set([
  "after_summon",
  "battle_destroy",
  "battle_completed",
  "damage_step",
  "card_flipped",
  "battle_damage_inflicted",
  "card_to_grave",
  "card_moved",
  "counter_removed",
  "standby_phase",
  "end_phase",
  "attack_declared",
  "battle_damage",
  "opponent_damage",
  "before_destroy",
  "effect_targeted",
  "card_activation",
  "effect_activation",
  "card_equipped",
  "lp_change",
  "spell_activated",
  "effect_activated",
  "position_change",
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

function validateCardIdGovernance() {
  const errors = [];
  const warnings = [];
  const summary = [];
  const groupedCards = new Set();
  const groupedIds = new Map();

  for (const message of validateCardIdRangeRegistry()) {
    errors.push(formatIssue(null, message));
  }

  for (const group of cardDatabaseGroups) {
    const range = getCardIdRangeByKey(group?.rangeKey);
    const cards = Array.isArray(group?.cards) ? group.cards : [];

    if (!range) {
      const groupKey = group?.rangeKey || "unknown";
      errors.push(
        formatIssue(
          null,
          `Card group "${groupKey}" has no declared ID range.`,
        ),
      );
      continue;
    }

    const capacity = getCardIdRangeSize(range);
    summary.push({
      key: range.key,
      label: range.label,
      start: range.start,
      end: range.end,
      capacity,
      used: cards.length,
      remaining: capacity - cards.length,
      enforceAssignedRanges: CARD_ID_RANGE_POLICY.enforceAssignedRanges,
    });

    if (cards.length > capacity) {
      const rangeLabel = `${range.start}-${range.end}`;
      errors.push(
        formatIssue(
          null,
          `Card group "${range.key}" uses ${cards.length} IDs but range ${rangeLabel} only has ${capacity} slots.`,
        ),
      );
    }

    for (const card of cards) {
      groupedCards.add(card);
      if (card?.id !== undefined && card?.id !== null) {
        const memberships = groupedIds.get(card.id) || [];
        memberships.push(range.key);
        groupedIds.set(card.id, memberships);
      }

      if (
        CARD_ID_RANGE_POLICY.enforceAssignedRanges &&
        !isCardIdInRange(card?.id, range)
      ) {
        const rangeLabel = `${range.start}-${range.end}`;
        errors.push(
          formatIssue(
            card,
            `Card id ${card?.id} must be inside ${range.key} range ${rangeLabel}.`,
          ),
        );
      }
    }
  }

  for (const card of cardDatabase) {
    if (!groupedCards.has(card)) {
      errors.push(
        formatIssue(
          card,
          "Card is exported in cardDatabase but is not assigned to a card group.",
        ),
      );
    }
  }

  for (const [cardId, memberships] of groupedIds.entries()) {
    if (memberships.length > 1) {
      const groups = memberships.join(", ");
      errors.push(
        formatIssue(
          { id: cardId, name: `ID ${cardId}` },
          `Card id ${cardId} is assigned to multiple groups: ${groups}.`,
        ),
      );
    }
  }

  return { errors, warnings, summary };
}

export function validateCardDatabase() {
  const errors = [];
  const warnings = [];
  const idGovernance = validateCardIdGovernance();
  errors.push(...idGovernance.errors);
  warnings.push(...idGovernance.warnings);

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
            null,
          ),
        );
      }
      const asc = card.ascension;
      if (!asc || typeof asc !== "object") {
        errors.push(
          formatIssue(card, "Ascension cards must define ascension metadata."),
        );
      } else {
        const materialId = asc.materialId;
        const materialFilters = asc.materialFilters || asc.material || null;
        if (
          !Number.isFinite(materialId) &&
          (!materialFilters || typeof materialFilters !== "object")
        ) {
          errors.push(
            formatIssue(
              card,
              "Ascension cards must define materialId or materialFilters.",
            ),
          );
        } else if (Number.isFinite(materialId) && !cardDatabaseById.get(materialId)) {
          errors.push(
            formatIssue(
              card,
              `Ascension.materialId ${materialId} not found in card database.`,
            ),
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
                idx,
              ),
            );
            return;
          }
          const allowedReqs = new Set([
            "material_destroyed_opponent_monsters",
            "material_effect_activations",
            "material_turns_on_field",
            "player_lp_gte",
            "player_lp_lte",
            "player_hand_gte",
            "player_graveyard_gte",
            "field_counters_at_least",
          ]);
          if (!req.type || !allowedReqs.has(req.type)) {
            warnings.push(
              formatIssue(
                card,
                `Unknown or unsupported ascension requirement type "${req.type}".`,
                null,
                idx,
              ),
            );
          }
        });
      }
    }
    if (card.monsterType === "synchro") {
      if (card.cardKind !== "monster") {
        warnings.push(
          formatIssue(
            card,
            'Synchro card should have cardKind "monster".',
            null,
            null,
          ),
        );
      }
      if (!Number.isFinite(Number(card.level)) || Number(card.level) <= 0) {
        errors.push(
          formatIssue(card, "Synchro cards must define a positive Level."),
        );
      }
    }
    if (typeof card.id !== "number" || !Number.isFinite(card.id)) {
      errors.push(
        formatIssue(card, "Card id must be a finite number.", null, null),
      );
    } else if (card.id <= 0) {
      errors.push(formatIssue(card, "Card id must be greater than zero."));
    } else if (seenIds.has(card.id)) {
      errors.push(
        formatIssue(
          card,
          `Duplicated id. Also used by "${seenIds.get(card.id)}".`,
        ),
      );
    } else {
      seenIds.set(card.id, card.name || `ID ${card.id}`);
    }

    if (!card.name || typeof card.name !== "string") {
      errors.push(
        formatIssue(card, "Card name must be a non-empty string.", null, null),
      );
    } else if (seenNames.has(card.name)) {
      errors.push(
        formatIssue(
          card,
          `Duplicated name. Also used by id ${seenNames.get(card.name)}.`,
        ),
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
        formatIssue(card, "Effects must be an array when defined.", null, null),
      );
      continue;
    }

    effects.forEach((effect, effectIndex) => {
      if (!effect || typeof effect !== "object") {
        errors.push(
          formatIssue(card, "Effect must be an object.", effectIndex, null),
        );
        return;
      }

      if (effect.timing && !VALID_TIMINGS.has(effect.timing)) {
        errors.push(
          formatIssue(
            card,
            `Invalid timing "${effect.timing}".`,
            effectIndex,
            null,
          ),
        );
      }

      if (effect.timing === "on_event" && !effect.event) {
        errors.push(
          formatIssue(
            card,
            "Effects with timing 'on_event' must declare an event.",
            effectIndex,
            null,
          ),
        );
      } else if (effect.timing === "on_event") {
        if (!VALID_EVENTS.has(effect.event)) {
          errors.push(
            formatIssue(
              card,
              `Invalid event "${effect.event}".`,
              effectIndex,
              null,
            ),
          );
        }
        if (!VALID_TRIGGER_REQUIREMENTS.has(effect.triggerRequirement)) {
          errors.push(
            formatIssue(
              card,
              "Effects with timing 'on_event' must declare triggerRequirement as 'mandatory' or 'optional'.",
              effectIndex,
              null,
            ),
          );
        }
        if (!VALID_TRIGGER_TIMINGS.has(effect.triggerTiming)) {
          errors.push(
            formatIssue(
              card,
              "Effects with timing 'on_event' must declare triggerTiming as 'if' or 'when'.",
              effectIndex,
              null,
            ),
          );
        }
      } else if (effect.event) {
        if (!VALID_EVENTS.has(effect.event)) {
          errors.push(
            formatIssue(
              card,
              `Invalid event "${effect.event}".`,
              effectIndex,
              null,
            ),
          );
        } else if (!EVENT_COMPATIBLE_TIMINGS.has(effect.timing)) {
          warnings.push(
            formatIssue(
              card,
              `Effect defines event "${effect.event}" but timing is "${
                effect.timing || "undefined"
              }".`,
              effectIndex,
              null,
            ),
          );
        }
      }

      if (effect.summonMethod !== undefined) {
        warnings.push(
          formatIssue(
            card,
            'Use "summonMethods" (array) instead of "summonMethod".',
            effectIndex,
            null,
          ),
        );
      }

      if (effect.requireSummonedFrom !== undefined) {
        warnings.push(
          formatIssue(
            card,
            'Use "summonFrom" instead of "requireSummonedFrom".',
            effectIndex,
            null,
          ),
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
            null,
          ),
        );
      }

      if (
        effect.activationCosts !== undefined &&
        !Array.isArray(effect.activationCosts)
      ) {
        errors.push(
          formatIssue(
            card,
            'Effect "activationCosts" must be an array.',
            effectIndex,
            null,
          ),
        );
      }

      if (effect.damageStepTimings !== undefined) {
        const damageStepTimings = effect.damageStepTimings;
        if (
          !Array.isArray(damageStepTimings) ||
          damageStepTimings.length === 0
        ) {
          errors.push(
            formatIssue(
              card,
              "damageStepTimings must be a non-empty array when defined.",
              effectIndex,
              null,
            ),
          );
        } else {
          const uniqueTimings = new Set(damageStepTimings);
          if (uniqueTimings.size !== damageStepTimings.length) {
            errors.push(
              formatIssue(
                card,
                "damageStepTimings must not contain duplicate values.",
                effectIndex,
                null,
              ),
            );
          }
          for (const timing of uniqueTimings) {
            if (!VALID_DAMAGE_STEP_TIMINGS.has(timing)) {
              errors.push(
                formatIssue(
                  card,
                  `Invalid Damage Step timing "${timing}".`,
                  effectIndex,
                  null,
                ),
              );
            }
          }
        }
      }
      if (effect.allowDamageStepActivation !== undefined) {
        errors.push(
          formatIssue(
            card,
            '"allowDamageStepActivation" is forbidden in card data; declare "damageStepTimings".',
            effectIndex,
            null,
          ),
        );
      }
      if (effect.manualActivationOnly !== undefined) {
        errors.push(
          formatIssue(
            card,
            '"manualActivationOnly" was removed; declare timing and activationZones explicitly.',
            effectIndex,
            null,
          ),
        );
      }
      if (effect.activationZones !== undefined) {
        if (
          !Array.isArray(effect.activationZones) ||
          effect.activationZones.length === 0
        ) {
          errors.push(
            formatIssue(
              card,
              'Effect "activationZones" must be a non-empty array.',
              effectIndex,
              null,
            ),
          );
        } else {
          const uniqueZones = new Set(effect.activationZones);
          if (uniqueZones.size !== effect.activationZones.length) {
            errors.push(
              formatIssue(
                card,
                'Effect "activationZones" cannot contain duplicates.',
                effectIndex,
                null,
              ),
            );
          }
          for (const zone of uniqueZones) {
            if (!VALID_ACTIVATION_ZONES.has(zone)) {
              errors.push(
                formatIssue(
                  card,
                  `Invalid activation zone "${zone}".`,
                  effectIndex,
                  null,
                ),
              );
            }
          }
        }
      }
      if (
        (effect.timing === "ignition" || effect.timing === "manual") &&
        effect.requireZone !== undefined
      ) {
        errors.push(
          formatIssue(
            card,
            'Ignition/manual effects must use "activationZones" instead of "requireZone".',
            effectIndex,
            null,
          ),
        );
      }
      if (
        (effect.timing === "ignition" || effect.timing === "manual") &&
        (!Array.isArray(effect.activationZones) ||
          effect.activationZones.length === 0)
      ) {
        errors.push(
          formatIssue(
            card,
            `Effect with timing "${effect.timing}" must declare activationZones.`,
            effectIndex,
            null,
          ),
        );
      }
      if (
        effect.usagePolicy !== undefined &&
        !VALID_USAGE_POLICIES.has(effect.usagePolicy)
      ) {
        errors.push(
          formatIssue(
            card,
            'Effect "usagePolicy" must be "use" or "activate".',
            effectIndex,
            null,
          ),
        );
      }
      if (
        (effect.oncePerTurn === true || effect.oncePerDuel) &&
        !VALID_USAGE_POLICIES.has(effect.usagePolicy)
      ) {
        errors.push(
          formatIssue(
            card,
            "Every oncePerTurn/oncePerDuel effect must declare usagePolicy.",
            effectIndex,
            null,
          ),
        );
      }
      if (
        effect.activationLabelKey !== undefined &&
        (typeof effect.activationLabelKey !== "string" ||
          effect.activationLabelKey.trim() === "")
      ) {
        errors.push(
          formatIssue(
            card,
            'Effect "activationLabelKey" must be a non-empty i18n key.',
            effectIndex,
            null,
          ),
        );
      }

      const actionTypes = new Set(
        flattenActions(effect.actions).map((action) => action.type),
      );
      const responseContexts = new Set(
        Array.isArray(effect.canRespondTo)
          ? effect.canRespondTo
          : effect.canRespondTo
            ? [effect.canRespondTo]
            : [],
      );
      if (
        (actionTypes.has("negate_activation") ||
          actionTypes.has("negate_effect")) &&
        !responseContexts.has("card_activation") &&
        !responseContexts.has("effect_activation")
      ) {
        errors.push(
          formatIssue(
            card,
            "Activation/effect negation must declare a card_activation or effect_activation response context.",
            effectIndex,
            null,
          ),
        );
      }
      if (
        effect.usagePolicy !== undefined &&
        effect.oncePerTurn !== true &&
        !effect.oncePerDuel
      ) {
        errors.push(
          formatIssue(
            card,
            'Effect "usagePolicy" requires oncePerTurn or oncePerDuel.',
            effectIndex,
            null,
          ),
        );
      }
      if (
        effect.requiresSourceAtResolution !== undefined &&
        typeof effect.requiresSourceAtResolution !== "boolean"
      ) {
        errors.push(
          formatIssue(
            card,
            'Effect "requiresSourceAtResolution" must be boolean.',
            effectIndex,
            null,
          ),
        );
      }

      const effectActions = Array.isArray(effect.actions) ? effect.actions : [];
      const activationCosts = Array.isArray(effect.activationCosts)
        ? effect.activationCosts
        : [];
      const targetIds = new Set(
        Array.isArray(effect.targets)
          ? effect.targets
              .filter((target) => target && typeof target.id === "string")
              .map((target) => target.id)
          : [],
      );
      for (const target of Array.isArray(effect.targets) ? effect.targets : []) {
        if (
          target?.intent !== undefined &&
          target.intent !== "cost" &&
          target.intent !== "target"
        ) {
          errors.push(
            formatIssue(
              card,
              `Invalid target intent "${target.intent}".`,
              effectIndex,
              null,
            ),
          );
        }
      }
      const costTargetIds = new Set(
        Array.isArray(effect.targets)
          ? effect.targets
              .filter(
                (target) =>
                  target?.intent === "cost" && typeof target.id === "string",
              )
              .map((target) => target.id)
          : [],
      );

      const producedTargetIds = new Set();
      const stagedActions = [
        ...activationCosts.map((action, actionIndex) => ({
          action,
          actionIndex,
          stage: "cost",
        })),
        ...effectActions.map((action, actionIndex) => ({
          action,
          actionIndex,
          stage: "resolution",
        })),
      ];
      stagedActions.forEach(({ action, actionIndex, stage }) => {
        if (!action || typeof action !== "object") {
          errors.push(
            formatIssue(
              card,
              "Action must be an object.",
              effectIndex,
              actionIndex,
            ),
          );
          return;
        }

        if (!action.type || typeof action.type !== "string") {
          errors.push(
            formatIssue(
              card,
              "Action type must be a non-empty string.",
              effectIndex,
              actionIndex,
            ),
          );
          return;
        }

        if (
          stage === "resolution" &&
          (action.activationStage === "cost" ||
            action.stage === "cost" ||
            action.type === "pay_lp" ||
            costTargetIds.has(action.targetRef) ||
            /(^|_)cost($|_)/i.test(String(action.contextLabel || "")))
        ) {
          errors.push(
            formatIssue(
              card,
              'Activation costs must be declared in "activationCosts", never inferred from resolution actions.',
              effectIndex,
              actionIndex,
            ),
          );
        }

        if (!allowedActionTypes.has(action.type)) {
          errors.push(
            formatIssue(
              card,
              `Action type "${action.type}" is not registered.`,
              effectIndex,
              actionIndex,
            ),
          );
          return;
        }

        const catalogEntry = getActionCatalogEntry(action.type);
        if (!catalogEntry) {
          warnings.push(
            formatIssue(
              card,
              `Action type "${action.type}" is registered but missing from ACTION_CATALOG.`,
              effectIndex,
              actionIndex,
            ),
          );
          return;
        }

        if (stage === "cost" && catalogEntry.selection === "dynamic") {
          errors.push(
            formatIssue(
              card,
              `Activation cost "${action.type}" cannot open a dynamic selection; declare its cards in effect.targets.`,
              effectIndex,
              actionIndex,
            ),
          );
        }
        if (
          stage === "cost" &&
          typeof action.targetRef === "string" &&
          targetIds.has(action.targetRef) &&
          !costTargetIds.has(action.targetRef)
        ) {
          errors.push(
            formatIssue(
              card,
              `Activation cost "${action.type}" must reference a target declared with intent: "cost".`,
              effectIndex,
              actionIndex,
            ),
          );
        }
        if (
          stage === "resolution" &&
          typeof action.targetRef === "string" &&
          costTargetIds.has(action.targetRef)
        ) {
          errors.push(
            formatIssue(
              card,
              `Resolution action "${action.type}" cannot consume cost target "${action.targetRef}"; move the action to activationCosts or use an effect target.`,
              effectIndex,
              actionIndex,
            ),
          );
        }

        const availableTargetIds = new Set([
          ...targetIds,
          ...producedTargetIds,
        ]);
        const shapeResult = validateActionShape(action, {
          targetIds: availableTargetIds,
        });
        for (const message of shapeResult.errors) {
          errors.push(formatIssue(card, message, effectIndex, actionIndex));
        }
        for (const message of shapeResult.warnings) {
          warnings.push(formatIssue(card, message, effectIndex, actionIndex));
        }

        for (const ref of [
          action.resultRef,
          action.storeResultAs,
          action.storeNegatedCardAs,
        ]) {
          if (typeof ref === "string" && ref.length > 0) {
            producedTargetIds.add(ref);
          }
        }
      });
    });

    const collisions = new Map();
    for (const effect of effects) {
      const key = activationCollisionKey(effect);
      if (!key) continue;
      const group = collisions.get(key) || [];
      group.push(effect);
      collisions.set(key, group);
    }
    for (const group of collisions.values()) {
      if (group.length < 2) continue;
      for (const effect of group) {
        if (typeof effect.activationLabelKey === "string") continue;
        const effectIndex = effects.indexOf(effect);
        errors.push(
          formatIssue(
            card,
            `Simultaneous candidate "${effect.id || effectIndex}" must declare activationLabelKey.`,
            effectIndex,
            null,
          ),
        );
      }
    }
  }

  return { errors, warnings, idGovernance: idGovernance.summary };
}
