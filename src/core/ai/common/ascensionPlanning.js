function hasAscensionEngineChecks(game) {
  return (
    typeof game?.canUseAsAscensionMaterial === "function" &&
    typeof game?.getAscensionCandidatesForMaterial === "function" &&
    typeof game?.checkAscensionRequirements === "function"
  );
}

function isFaceupMonster(card) {
  return card && card.cardKind === "monster" && !card.isFacedown;
}

function getRealAscensionCandidates(game, player, material) {
  const materialCheck = game.canUseAsAscensionMaterial(player, material);
  if (!materialCheck?.ok) return [];

  const candidates = game.getAscensionCandidatesForMaterial(player, material) || [];
  return candidates.filter(
    (ascensionCard) =>
      game.checkAscensionRequirements(player, ascensionCard, material)?.ok,
  );
}

function resolvePriority(value) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Build generic Ascension actions while keeping strategy policy external.
 *
 * The helper only handles shared candidate discovery and action shape. It does
 * not import strategy code, card ids, or use buildPrioritizedAction so callers
 * can preserve existing Ascension action contracts exactly.
 */
export function getGenericAscensionActions(context = {}, policy = {}) {
  const { game, bot, opponent, analysis, isSimulatedState = false } = context;
  const canCheckAscension = hasAscensionEngineChecks(game);

  if (!canCheckAscension && !isSimulatedState) return [];

  const actions = [];
  const materials = (bot?.field || []).filter(isFaceupMonster);

  for (const material of materials) {
    const materialIndex = bot.field.indexOf(material);
    const materialContext = {
      ...context,
      game,
      bot,
      player: bot,
      opponent,
      analysis,
      isSimulatedState,
      material,
      materialIndex,
      canCheckAscension,
    };

    const eligible = canCheckAscension
      ? getRealAscensionCandidates(game, bot, material)
      : policy.getSimulatedAscensionCandidates?.(game, bot, material, materialContext) || [];

    for (const ascensionCard of eligible) {
      const ascensionContext = {
        ...materialContext,
        ascensionCard,
      };

      if (policy.shouldSkipAscension?.(ascensionCard, material, ascensionContext)) {
        continue;
      }

      const priority = resolvePriority(
        policy.evaluateAscensionPriority?.(
          ascensionCard,
          material,
          ascensionContext,
        ),
      );
      const position = policy.chooseAscensionPosition?.(
        ascensionCard,
        material,
        ascensionContext,
      );
      const action = {
        type: "ascension",
        materialIndex,
        ascensionCard,
        cardName: ascensionCard?.name,
        position,
        priority,
        extraDeck: true,
      };

      const decorated =
        policy.decorateAction?.(action, ascensionCard, material, ascensionContext) ||
        action;
      actions.push(decorated);
    }
  }

  return actions;
}
