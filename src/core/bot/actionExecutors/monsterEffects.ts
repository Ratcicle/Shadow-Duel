import { resolvePlanningSourceIndex } from "../../ai/common/actionIdentity.js";
import type { BotRuntimePort, BotGamePort } from "../../contracts/bot.js";
import type {
  AIActionOf,
  ExtraDeckMaterialHint,
  AIActivationContext,
} from "../../contracts/ai.js";
import type { GameCard } from "../../contracts/cards.js";
import { getCanonicalEffectActivationZones } from "../../chain/legality.js";

export async function executeMonsterEffectAction(
  bot: BotRuntimePort,
  game: BotGamePort,
  action: AIActionOf<"monsterEffect">,
): Promise<boolean> {
  const fieldIndex = resolvePlanningSourceIndex(bot.field, action, bot.id, "field", action.card) ?? (Number.isInteger(action.fieldIndex)
    ? action.fieldIndex
    : bot.field.findIndex(
        (c) =>
          c &&
          (c.id === action.cardId ||
            (!action.cardId && c.name === action.cardName)),
      ));
  const card = bot.field?.[fieldIndex!];
  if (!card || card.cardKind !== "monster" || card.isFacedown) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid monsterEffect action: no face-up monster at index ${fieldIndex}`,
    );
    return false;
  }

  const actionActivationContext = action.activationContext || {};
  const effectId =
    action.effectId ||
    action.effect?.id ||
    actionActivationContext.effectId ||
    null;
  const activationContext: AIActivationContext = {
    ...actionActivationContext,
    fromHand: false,
    activationZone: "field",
    sourceZone: "field",
    effectId,
    autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
  };
  const activationEffect =
    game.effectEngine?.getMonsterIgnitionEffect?.(card, "field", {
      effectId,
    }) ||
    (card.effects || []).find(
      (e) =>
        e &&
        e.timing === "ignition" &&
        getCanonicalEffectActivationZones(card, e).includes("field") &&
        (!effectId || e.id === effectId),
    );
  activationContext.effectId = activationEffect?.id || effectId || null;

  // The canonical activation records the replay command, like a human's.
  const pipelineResult = await game.tryActivateMonsterEffect(card, null, "field", bot, {
    effectId: activationContext.effectId ?? null,
    activationContext,
  });

  return (
    (pipelineResult as unknown) !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false
  );
}

export async function executeGraveyardMonsterEffectAction(
  bot: BotRuntimePort,
  game: BotGamePort,
  action: AIActionOf<"graveyardMonsterEffect">,
): Promise<boolean> {
  const graveyardIndex = resolvePlanningSourceIndex(bot.graveyard, action, bot.id, "graveyard", action.card) ?? (Number.isInteger(action.graveyardIndex)
    ? action.graveyardIndex
    : bot.graveyard.findIndex(
        (c) =>
          c &&
          (c.id === action.cardId ||
            (!action.cardId && c.name === action.cardName)),
      ));
  const card = bot.graveyard?.[graveyardIndex!];
  if (!card || card.cardKind !== "monster") {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid graveyardMonsterEffect action: no monster at index ${graveyardIndex}`,
    );
    return false;
  }

  const actionActivationContext = action.activationContext || {};
  const effectId =
    action.effectId ||
    action.effect?.id ||
    actionActivationContext.effectId ||
    null;
  const graveyardEffect =
    game.effectEngine?.getMonsterIgnitionEffect?.(card, "graveyard", {
      effectId,
    }) ||
    (card.effects || []).find(
      (e) =>
        e &&
        e.timing === "ignition" &&
        getCanonicalEffectActivationZones(card, e).includes("graveyard") &&
        (!effectId || e.id === effectId),
    );
  if (!graveyardEffect) {
    console.log(
      `[Bot.executeMainPhaseAction] No graveyard ignition effect found for ${card.name}`,
    );
    return false;
  }

  const activationContext: AIActivationContext = {
    ...actionActivationContext,
    fromHand: false,
    activationZone: "graveyard",
    sourceZone: "graveyard",
    effectId: graveyardEffect?.id || effectId || null,
    autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
    autoSelectSingleTarget:
      actionActivationContext.autoSelectSingleTarget !== false,
  };

  // The canonical activation records the replay command, like a human's.
  const pipelineResult = await game.tryActivateMonsterEffect(card, null, "graveyard", bot, {
    effectId: activationContext.effectId ?? null,
    activationContext,
  });

  return (
    (pipelineResult as unknown) !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false
  );
}

export async function executeHandIgnitionAction(
  bot: BotRuntimePort,
  game: BotGamePort,
  action: AIActionOf<"handIgnition">,
): Promise<boolean> {
  const resolvedIndex = bot.resolveHandIndexForAction(action, "monster");
  if (resolvedIndex < 0) return false;
  const card = bot.hand[resolvedIndex]!; // resolveHandIndexForAction validated this occupied slot.

  console.log(
    `[Bot.executeMainPhaseAction] 🔥 Attempting hand ignition: ${card.name}`,
  );

  // Verificar se o efeito pode ser ativado
  const actionActivationContext = action.activationContext || {};
  const effectId =
    action.effectId ||
    action.effect?.id ||
    actionActivationContext.effectId ||
    null;
  const handIgnitionEffect =
    game.effectEngine?.getMonsterIgnitionEffect?.(card, "hand", { effectId }) ||
    (card.effects || []).find(
      (e) =>
        e &&
        e.timing === "ignition" &&
        getCanonicalEffectActivationZones(card, e).includes("hand") &&
        (!effectId || e.id === effectId),
    );
  if (!handIgnitionEffect) {
    console.log(
      `[Bot.executeMainPhaseAction] ❌ No hand ignition effect found`,
    );
    return false;
  }

  const activationContext: AIActivationContext = {
    ...actionActivationContext,
    fromHand: true,
    activationZone: "hand",
    sourceZone: "hand",
    effectId: handIgnitionEffect?.id || effectId || null,
    autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
  };

  const pipelineResult = await game.tryActivateMonsterEffect(card, null, "hand", bot, {
    effectId: activationContext.effectId ?? null,
    activationContext,
  });
  // Pipeline retorna false, null, ou {success: false} quando falha
  return (
    (pipelineResult as unknown) !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false
  );
}
