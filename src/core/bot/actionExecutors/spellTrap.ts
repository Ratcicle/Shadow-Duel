import type { BotRuntimePort, BotGamePort } from "../../contracts/bot.js";
import type { AIActionOf, ExtraDeckMaterialHint, AIActivationContext } from "../../contracts/ai.js";
import type { GameCard } from "../../contracts/cards.js";
import {
  canSetReactiveBackrowNow,
  isQuickSpellCard,
} from "../../ai/common/phaseTiming.js";

function markAiQuickSpellActivation(card: GameCard & { lastAiActivatedTurn?: number | null }, game: BotGamePort) {
  if (!isQuickSpellCard(card)) return;
  card.lastAiActivatedTurn = Number.isFinite(Number(game?.turnCounter))
    ? Number(game.turnCounter)
    : null;
}

export async function executeSpellAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"spell">): Promise<boolean> {
  const resolvedIndex = bot.resolveHandIndexForAction(action, "spell");
  if (resolvedIndex < 0) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid spell action: no matching spell in hand (index=${
        action.index
      }, card=${action.cardName || "unknown"})`,
    );
    return false;
  }
  const card = bot.hand[resolvedIndex];
  const actionActivationContext = action.activationContext || {};

  console.log(
    `[Bot.executeMainPhaseAction] 📝 Attempting spell: ${card.name}`,
  );

  if (
    game.effectEngine &&
    typeof game.effectEngine.canActivateSpellFromHandPreview === "function"
  ) {
    const preview = game.effectEngine.canActivateSpellFromHandPreview(
      card,
      bot,
      { activationContext: actionActivationContext },
    );
    console.log(`[Bot.executeMainPhaseAction] 🔍 Preview check:`, preview);
    if (preview && !preview.ok) {
      console.log(
        `[Bot.executeMainPhaseAction] ❌ Preview rejected:`,
        preview.reason,
      );
      return false;
    }
  }

  const activationEffect =
    game.effectEngine?.getSpellTrapActivationEffect?.(card, {
      fromHand: true,
    });

  const pipelineResult = await game.runActivationPipeline({
    card,
    owner: bot,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Select target(s) for the spell effect.",
    guardKind: "bot_spell_from_hand",
    phaseReq: ["main1", "main2"],
    preview: () =>
      game.effectEngine?.canActivateSpellFromHandPreview?.(card, bot, {
        activationContext: actionActivationContext,
      }),
    commit: () => game.commitCardActivationFromHand(bot, resolvedIndex),
    activationContext: {
      ...actionActivationContext,
      fromHand: true,
      sourceZone: "hand",
    },
    oncePerTurn: {
      card,
      player: bot,
      effect: activationEffect,
    },
    activate: (chosen, ctx, zone, resolvedCard) =>
      game.effectEngine.activateSpellTrapEffect(
        resolvedCard,
        bot,
        chosen,
        zone,
        ctx,
      ),
    finalize: async (result, info) => {
      await game.finalizeSpellCardActivation(result as Parameters<BotGamePort["finalizeSpellCardActivation"]>[0], info as Parameters<BotGamePort["finalizeSpellCardActivation"]>[1], {
        owner: bot,
        fromHand: true,
        effect: activationEffect,
        placementLog: `Bot places ${info.card.name}.`,
        activationLog: `Bot activates ${info.card.name}`,
      });
    },
  });
  // Pipeline retorna false, null, ou {success: false} quando falha
  const success =
    (pipelineResult as unknown) !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false;
  if (success) markAiQuickSpellActivation(card, game);
  return success;
}

export async function executeSetSpellTrapAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"set_spell_trap">): Promise<boolean> {
  const resolvedIndex = bot.resolveHandIndexForAction(action, [
    "spell",
    "trap",
  ]);
  if (resolvedIndex < 0) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid set action: no matching card in hand (index=${
        action.index
      }, card=${action.cardName || "unknown"})`,
    );
    return false;
  }
  const card = bot.hand[resolvedIndex];
  if (!canSetReactiveBackrowNow(card, game)) {
    console.log(
      `[Bot.executeMainPhaseAction] Set spell/trap rejected by phase timing: ${card.name}`,
    );
    return false;
  }
  const result = await game.setSpellOrTrap(card, resolvedIndex, bot);
  if (result && result.ok === false) {
    console.log(
      `[Bot.executeMainPhaseAction] Set spell/trap failed:`,
      (result as { reason?: string }).reason,
    );
    return false;
  }
  game.ui?.log?.(`Bot sets a card.`);
  game.updateBoard();
  return true;
}

export async function executeSpellTrapEffectAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"spellTrapEffect">): Promise<boolean> {
  const zoneIndex = Number.isInteger(action.zoneIndex)
    ? action.zoneIndex
    : action.index;
  const card = bot.spellTrap?.[zoneIndex!];
  if (!card || (card.cardKind !== "spell" && card.cardKind !== "trap")) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid spellTrapEffect action: no spell/trap at index ${zoneIndex}`,
    );
    return false;
  }

  const activationEffect =
    game.effectEngine?.getSpellTrapActivationEffect?.(card, {
      fromHand: false,
      activationZone: "spellTrap",
    });
  const actionActivationContext = action.activationContext || {};

  const activationContext: AIActivationContext = {
    ...actionActivationContext,
    fromHand: false,
    activationZone: "spellTrap",
    sourceZone: "spellTrap",
    trapActivationFromSet:
      actionActivationContext.trapActivationFromSet === true ||
      (card.cardKind === "trap" && card.isFacedown === true),
    autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
    autoSelectSingleTarget:
      actionActivationContext.autoSelectSingleTarget !== false,
  };

  const pipelineResult = await game.runActivationPipeline({
    card,
    owner: bot,
    activationZone: "spellTrap",
    activationContext,
    selectionKind: "spellTrapEffect",
    selectionMessage: "Select target(s) for the spell effect.",
    guardKind: "bot_spelltrap_effect",
    phaseReq: ["main1", "main2"],
    preview: () =>
      game.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        bot,
        "spellTrap",
        null,
        { activationContext },
      ),
    oncePerTurn: {
      card,
      player: bot,
      effect: activationEffect,
    },
    activate: (chosen, ctx, zone) =>
      game.effectEngine.activateSpellTrapEffect(
        card,
        bot,
        chosen,
        zone,
        ctx,
      ),
    finalize: async (result, info) => {
      if (result.placementOnly) {
        game.ui?.log?.(`Bot places ${info.card.name}.`);
      } else {
        await game.finalizeSpellTrapActivation(
          info.card,
          bot,
          info.activationZone as Parameters<BotGamePort["finalizeSpellTrapActivation"]>[2],
          { activationContext: info.activationContext },
        );
        game.ui?.log?.(`Bot activates ${info.card.name}`);
      }
      game.updateBoard();
    },
  });

  const success = !!pipelineResult && pipelineResult.success !== false;
  if (success) markAiQuickSpellActivation(card, game);
  return success;
}

export async function executeGraveyardSpellEffectAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"graveyardSpellEffect">): Promise<boolean> {
  const graveyardIndex = Number.isInteger(action.graveyardIndex)
    ? action.graveyardIndex
    : bot.graveyard.findIndex(
        (c) =>
          c &&
          (c.id === action.cardId ||
            (!action.cardId && c.name === action.cardName)),
      );
  const card = bot.graveyard?.[graveyardIndex!];
  if (!card || card.cardKind !== "spell") {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid graveyardSpellEffect action: no spell at index ${graveyardIndex}`,
    );
    return false;
  }

  const graveyardEffect =
    game.effectEngine?.getSpellTrapActivationEffect?.(card, {
      fromHand: false,
      activationZone: "graveyard",
    });
  if (!graveyardEffect) {
    console.log(
      `[Bot.executeMainPhaseAction] No graveyard spell ignition effect found for ${card.name}`,
    );
    return false;
  }

  const actionActivationContext = action.activationContext || {};
  const activationContext: AIActivationContext = {
    ...actionActivationContext,
    fromHand: false,
    activationZone: "graveyard",
    sourceZone: "graveyard",
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
    selectionMessage: "Select target(s) for the graveyard spell effect.",
    guardKind: "bot_graveyard_spell_effect",
    phaseReq: ["main1", "main2"],
    preview: () =>
      game.effectEngine?.canActivateSpellTrapEffectPreview?.(
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
    activate: (chosen, ctx, zone) =>
      game.effectEngine.activateSpellTrapEffect(
        card,
        bot,
        chosen,
        zone,
        ctx,
      ),
    finalize: () => {
      game.ui?.log?.(`Bot activates ${card.name}'s effect from graveyard`);
      game.updateBoard();
    },
  });

  const success =
    (pipelineResult as unknown) !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false;
  if (success) markAiQuickSpellActivation(card, game);
  return success;
}

export async function executeFieldEffectAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"fieldEffect">): Promise<boolean> {
  if (!bot.fieldSpell) return false;
  const fieldSpell = bot.fieldSpell;
  const actionActivationContext = action.activationContext || {};
  const activationContext: AIActivationContext = {
    ...actionActivationContext,
    fromHand: false,
    activationZone: "fieldSpell",
    sourceZone: "fieldSpell",
  };
  const activationEffect =
    game.effectEngine?.getFieldSpellActivationEffect?.(fieldSpell);
  const pipelineResult = await game.runActivationPipeline({
    card: fieldSpell,
    owner: bot,
    activationZone: "fieldSpell",
    activationContext,
    selectionKind: "fieldSpell",
    selectionMessage: "Select target(s) for the field spell effect.",
    guardKind: "bot_fieldspell_effect",
    phaseReq: ["main1", "main2"],
    preview: () =>
      game.effectEngine?.canActivateFieldSpellEffectPreview?.(
        fieldSpell,
        bot,
        null,
        { activationContext },
      ),
    oncePerTurn: {
      card: fieldSpell,
      player: bot,
      effect: activationEffect,
    },
    activate: (selections, ctx) =>
      game.effectEngine.activateFieldSpell(
        fieldSpell,
        bot,
        selections,
        ctx,
      ),
    finalize: () => {
      game.ui?.log?.(`Bot activates ${fieldSpell.name}'s effect`);
      game.updateBoard();
    },
  });
  // Pipeline retorna false, null, ou {success: false} quando falha
  return (
    (pipelineResult as unknown) !== false &&
    pipelineResult !== null &&
    pipelineResult?.success !== false
  );
}
