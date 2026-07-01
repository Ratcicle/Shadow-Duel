export async function executeMonsterEffectAction(bot, game, action) {
  const fieldIndex = Number.isInteger(action.fieldIndex)
    ? action.fieldIndex
    : bot.field.findIndex(
        (c) =>
          c &&
          (c.id === action.cardId ||
            (!action.cardId && c.name === action.cardName)),
      );
  const card = bot.field?.[fieldIndex];
  if (!card || card.cardKind !== "monster" || card.isFacedown) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid monsterEffect action: no face-up monster at index ${fieldIndex}`,
    );
    return false;
  }

  const actionActivationContext = action.activationContext || {};
  const effectId =
    action.effectId || action.effect?.id || actionActivationContext.effectId || null;
  const activationContext = {
    ...actionActivationContext,
    fromHand: false,
    activationZone: "field",
    sourceZone: "field",
    effectId,
    autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
  };
  const activationEffect =
    game.effectEngine?.getMonsterIgnitionEffect?.(card, "field", { effectId }) ||
    (card.effects || []).find(
      (e) =>
        e &&
        e.timing === "ignition" &&
        (!e.requireZone || e.requireZone === "field") &&
        (!effectId || e.id === effectId),
    );
  activationContext.effectId = activationEffect?.id || effectId || null;

  const pipelineResult = await game.runActivationPipeline({
    card,
    owner: bot,
    activationZone: "field",
    activationContext,
    selectionKind: "monsterEffect",
    selectionMessage: "Select target(s) for the monster effect.",
    guardKind: "bot_monster_effect",
    phaseReq: ["main1", "main2"],
    preview: () =>
      game.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "field",
        null,
        { activationContext },
      ),
    oncePerTurn: {
      card,
      player: bot,
      effect: activationEffect,
    },
    activate: (chosen, ctx, zone) =>
      game.effectEngine.activateMonsterEffect(
        card,
        bot,
        chosen,
        zone,
        ctx,
      ),
    finalize: () => {
      game.ui?.log?.(`Bot activates ${card.name}'s effect`);
      game.updateBoard();
    },
  });

  return (
    pipelineResult !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false
  );
}

export async function executeGraveyardMonsterEffectAction(bot, game, action) {
  const graveyardIndex = Number.isInteger(action.graveyardIndex)
    ? action.graveyardIndex
    : bot.graveyard.findIndex(
        (c) =>
          c &&
          (c.id === action.cardId ||
            (!action.cardId && c.name === action.cardName)),
      );
  const card = bot.graveyard?.[graveyardIndex];
  if (!card || card.cardKind !== "monster") {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid graveyardMonsterEffect action: no monster at index ${graveyardIndex}`,
    );
    return false;
  }

  const actionActivationContext = action.activationContext || {};
  const effectId =
    action.effectId || action.effect?.id || actionActivationContext.effectId || null;
  const graveyardEffect =
    game.effectEngine?.getMonsterIgnitionEffect?.(card, "graveyard", {
      effectId,
    }) ||
    (card.effects || []).find(
      (e) =>
        e &&
        e.timing === "ignition" &&
        e.requireZone === "graveyard" &&
        (!effectId || e.id === effectId),
    );
  if (!graveyardEffect) {
    console.log(
      `[Bot.executeMainPhaseAction] No graveyard ignition effect found for ${card.name}`,
    );
    return false;
  }

  const activationContext = {
    ...actionActivationContext,
    fromHand: false,
    activationZone: "graveyard",
    sourceZone: "graveyard",
    effectId: graveyardEffect?.id || effectId || null,
    autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
    autoSelectSingleTarget:
      actionActivationContext.autoSelectSingleTarget !== false,
  };

  const pipelineResult = await game.runActivationPipeline({
    card,
    owner: bot,
    activationZone: "graveyard",
    activationContext,
    selectionKind: "graveyardEffect",
    selectionMessage: "Select target(s) for the graveyard effect.",
    guardKind: "bot_graveyard_monster_effect",
    phaseReq: ["main1", "main2"],
    preview: () =>
      game.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "graveyard",
        null,
        { activationContext },
      ),
    oncePerTurn: {
      card,
      player: bot,
      effect: graveyardEffect,
    },
    activate: (chosen, ctx) =>
      game.effectEngine.activateMonsterFromGraveyard(
        card,
        bot,
        chosen,
        ctx,
      ),
    finalize: () => {
      game.ui?.log?.(`Bot activates ${card.name}'s effect from graveyard`);
      game.updateBoard();
    },
  });

  return (
    pipelineResult !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false
  );
}

export async function executeHandIgnitionAction(bot, game, action) {
  const resolvedIndex = bot.resolveHandIndexForAction(action, "monster");
  if (resolvedIndex < 0) return false;
  const card = bot.hand[resolvedIndex];

  console.log(
    `[Bot.executeMainPhaseAction] 🔥 Attempting hand ignition: ${card.name}`,
  );

  // Verificar se o efeito pode ser ativado
  const actionActivationContext = action.activationContext || {};
  const effectId =
    action.effectId || action.effect?.id || actionActivationContext.effectId || null;
  const handIgnitionEffect =
    game.effectEngine?.getMonsterIgnitionEffect?.(card, "hand", { effectId }) ||
    (card.effects || []).find(
      (e) =>
        e &&
        e.timing === "ignition" &&
        e.requireZone === "hand" &&
        (!effectId || e.id === effectId),
    );
  if (!handIgnitionEffect) {
    console.log(
      `[Bot.executeMainPhaseAction] ❌ No hand ignition effect found`,
    );
    return false;
  }

  const activationContext = {
    ...actionActivationContext,
    fromHand: true,
    activationZone: "hand",
    sourceZone: "hand",
    effectId: handIgnitionEffect?.id || effectId || null,
    autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
  };

  const pipelineResult = await game.runActivationPipeline({
    card,
    owner: bot,
    activationZone: "hand",
    activationContext,
    selectionKind: "monsterEffect",
    selectionMessage: "Select target(s) for the monster effect.",
    guardKind: "bot_hand_ignition",
    phaseReq: ["main1", "main2"],
    oncePerTurn: {
      card,
      player: bot,
      effect: handIgnitionEffect,
    },
    activate: (chosen, ctx, zone) =>
      game.effectEngine.activateMonsterEffect(
        card,
        bot,
        chosen,
        "hand",
        ctx,
      ),
    finalize: () => {
      game.ui?.log?.(`Bot activates ${card.name}'s effect from hand`);
      game.updateBoard();
    },
  });
  // Pipeline retorna false, null, ou {success: false} quando falha
  return (
    pipelineResult !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false
  );
}
