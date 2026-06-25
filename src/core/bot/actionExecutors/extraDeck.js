function getCardInstanceIds(card) {
  return [
    card?.instanceId,
    card?._instanceId,
    card?.uid,
    card?.uuid,
    card?.simInstanceId,
    card?.fieldPresenceId,
  ].filter((id) => id !== null && id !== undefined);
}

function findExtraDeckCard(bot, action) {
  const extraDeck = bot?.extraDeck || [];
  if (Number.isInteger(action.extraDeckIndex)) {
    const direct = extraDeck[action.extraDeckIndex];
    if (
      direct &&
      (direct.id === action.cardId ||
        direct.name === action.cardName ||
        direct.name === action.extraDeckCard?.name)
    ) {
      return direct;
    }
  }
  return extraDeck.find(
    (card) =>
      card &&
      (card.id === action.cardId ||
        card.name === action.cardName ||
        card.name === action.extraDeckCard?.name),
  );
}

function findMaterialByHint(field, hint = {}) {
  if (!Array.isArray(field)) return null;
  const ids = Array.isArray(hint.instanceIds) ? hint.instanceIds : [];
  if (ids.length > 0) {
    const byInstance = field.find((card) => {
      const cardIds = getCardInstanceIds(card);
      return cardIds.some((id) => ids.includes(id));
    });
    if (byInstance) return byInstance;
  }
  if (Number.isInteger(hint.index)) {
    const direct = field[hint.index];
    if (
      direct &&
      (hint.id === undefined || direct.id === hint.id) &&
      (!hint.name || direct.name === hint.name)
    ) {
      return direct;
    }
  }
  return field.find(
    (card) =>
      card &&
      (hint.id === undefined || card.id === hint.id) &&
      (!hint.name || card.name === hint.name),
  );
}

function resolveActionMaterials(bot, action) {
  const field = bot?.field || [];
  const hints = Array.isArray(action.materials)
    ? action.materials
    : (action.materialIndices || []).map((index, offset) => ({
        index,
        id: action.materialIds?.[offset],
        name: action.materialNames?.[offset],
        instanceIds: action.materialInstanceIds?.[offset],
      }));
  const materials = [];
  for (const hint of hints) {
    const material = findMaterialByHint(field, hint);
    if (!material || materials.includes(material)) return [];
    materials.push(material);
  }
  return materials;
}

export async function executeExtraDeckProcedureAction(bot, game, action) {
  try {
    const card = findExtraDeckCard(bot, action);
    if (!card) {
      console.log(
        `[Bot.executeMainPhaseAction] Extra Deck: card not found for ${action.cardName}`,
      );
      return false;
    }

    const materials = resolveActionMaterials(bot, action);
    if (!materials.length) {
      console.log(
        `[Bot.executeMainPhaseAction] Extra Deck: materials not found for ${card.name}`,
      );
      return false;
    }

    const result = await game.performExtraDeckSummonProcedure(card, bot, {
      materials,
      position: action.position || "attack",
    });

    if (result?.success) {
      console.log(
        `[Bot.executeMainPhaseAction] Extra Deck summon successful: ${card.name}`,
      );
      game.updateBoard?.();
      return true;
    }

    console.log(
      `[Bot.executeMainPhaseAction] Extra Deck summon failed:`,
      result?.reason,
    );
    return false;
  } catch (error) {
    console.error(
      `[Bot.executeMainPhaseAction] Extra Deck summon error:`,
      error?.message || error,
    );
    return false;
  }
}
