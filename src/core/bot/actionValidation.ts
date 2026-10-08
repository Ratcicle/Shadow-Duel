import type {
  BotRuntimePort,
  BotGamePort,
  BotHandActionHint,
  ExpectedBotHandKind,
} from "../contracts/bot.js";
import type {
  AIAction,
  AIActionOf,
  ExtraDeckMaterialHint,
  HandProcedureMaterialHint,
  AIActivationContext,
} from "../contracts/ai.js";
import type { GameCard, CardKind } from "../contracts/cards.js";
import type { GamePlayer } from "../contracts/player.js";
import type { CardAction } from "../contracts/actions.js";
import type { EffectDefinition } from "../contracts/effects.js";
import type { CanonicalZone } from "../contracts/zones.js";

import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../game/summon/tributeValue.js";
import { canUseNormalSummonForCard } from "../Player.js";
import { canSetReactiveBackrowNow } from "../ai/common/phaseTiming.js";
import { getCanonicalEffectActivationZones } from "../chain/legality.js";
import { canMoveCardToZone } from "../ai/common/zones.js";
import { hasActionZoneCandidates } from "../ai/common/actionValidation.js";
import { bindPlanningActionPresence, getPlanningActionPresence, isPlanningActionPresenceCurrent, resolvePlanningCard, resolvePlanningMaterialIds, resolvePlanningSourceIndex } from "../ai/common/actionIdentity.js";
import { selectPayableTributes } from "../ai/common/tributePolicy.js";

export function resolveHandIndexForAction(
  bot: Pick<BotRuntimePort, "hand" | "id">,
  action: BotHandActionHint,
  expectedKind?: ExpectedBotHandKind,
): number {
  if (!action) return -1;
  const hand = bot.hand || [];
  const bound = resolvePlanningCard<GameCard>(hand, action.card, bot.id, "hand", action);
  if (bound.explicit) {
    if (!bound.card || (expectedKind && !(Array.isArray(expectedKind) ? expectedKind : [expectedKind]).includes(bound.card.cardKind))) return -1;
    return hand.indexOf(bound.card);
  }
  const idHint = action.cardId ?? action.card?.id ?? null;
  const nameHint = action.cardName || action.card?.name || null;
  const expectedKinds: readonly CardKind[] | null = Array.isArray(expectedKind)
    ? expectedKind
    : expectedKind
      ? [expectedKind]
      : null;
  const matchesKind = (card: GameCard | undefined): card is GameCard => {
    if (!card) return false;
    if (expectedKinds && !expectedKinds.includes(card.cardKind)) return false;
    return true;
  };
  const matchesById = (card: GameCard | undefined) => {
    if (!matchesKind(card)) return false;
    if (idHint === null || idHint === undefined) return false;
    return card.id === idHint;
  };
  const matchesByName = (card: GameCard | undefined) => {
    if (!matchesKind(card)) return false;
    if (!nameHint) return true;
    return card.name === nameHint;
  };

  if (Number.isInteger(action.index)) {
    const direct = hand[action.index!];
    if (matchesById(direct)) return action.index!;
    if (
      (idHint === null || idHint === undefined) &&
      !nameHint &&
      matchesKind(direct)
    ) {
      return action.index!;
    }
    if (
      (idHint === null || idHint === undefined) &&
      nameHint &&
      matchesByName(direct)
    ) {
      return action.index!;
    }
    if (nameHint && matchesByName(direct)) return action.index!;
  }

  if (idHint !== null && idHint !== undefined) {
    const foundIndex = hand.findIndex((card) => matchesById(card));
    if (foundIndex >= 0) return foundIndex;
  }

  if (nameHint) {
    const foundIndex = hand.findIndex((card) => matchesByName(card));
    if (foundIndex >= 0) return foundIndex;
  }

  return -1;
}

export function resolveHandProcedureMaterials(
  bot: BotRuntimePort,
  hints: readonly HandProcedureMaterialHint[],
  action?: object,
): GameCard[] | null {
  const materials: GameCard[] = [];
  for (const [offset, hint] of hints.entries()) {
    const zone = bot[hint.zone];
    const bound = resolvePlanningCard<GameCard>(zone, { instanceId: hint.instanceId }, bot.id, hint.zone, action, offset);
    const atIndex = zone[hint.index];
    const matches = (card: GameCard) =>
      card.id === hint.cardId && card.instanceId === hint.instanceId;
    const material = bound.explicit ? bound.card : atIndex && matches(atIndex) ? atIndex : zone.find(matches);
    if (!material || materials.includes(material)) return null;
    materials.push(material);
  }
  return materials;
}

export function collectHandSummonProcedureActions(
  bot: BotRuntimePort,
  game: BotGamePort,
): AIActionOf<"handSummonProcedure">[] {
  return bot.hand.flatMap((card, index) => {
    const procedure = card.handSummonProcedure;
    if (!procedure) return [];
    const check = game.canSummonFromHandByProcedure(card, bot);
    if (!check.ok) return [];
    const chosen = check.suggestedMaterials;
    if (chosen.length !== (procedure.cost?.count || 0)) return [];
    const materials: HandProcedureMaterialHint[] = chosen.map((material) => {
      const zone = bot.field.includes(material) ? "field" as const : "graveyard" as const;
      return { zone, index: bot[zone].indexOf(material), cardId: material.id, instanceId: material.instanceId };
    });
    return [bindPlanningActionPresence({
      type: "handSummonProcedure" as const,
      card, cardId: card.id, cardName: card.name, index, materials,
      priority: (card.atk || 0) / 500 + 1,
    }, card, bot.id, "hand", game, chosen.map(material => ({ card: material, zone: bot.field.includes(material) ? "field" : "graveyard" })))];
  });
}

export function canResolveHandSummonProcedureActionForCurrentState(
  bot: BotRuntimePort,
  action: AIActionOf<"handSummonProcedure">,
  game: BotGamePort,
): boolean {
  const index = resolveHandIndexForAction(bot, action, "monster");
  const card = bot.hand[index];
  if (!card?.handSummonProcedure) return false;
  const check = game.canSummonFromHandByProcedure(card, bot);
  if (!check.ok || action.materials.length !== (card.handSummonProcedure.cost?.count || 0)) return false;
  const materials = resolveHandProcedureMaterials(bot, action.materials, action);
  if (!materials || materials.some((material) => !check.candidates.includes(material))) return false;
  if (bot.field.length - materials.filter((material) => bot.field.includes(material)).length >= 5) return false;
  return game.canPlaceCardOnField(card, bot, {
    isFacedown: false, summonMethod: "special", excludeCards: materials, silent: true,
  }).ok;
}

export function tributeMatchesAltRequirement(
  card: GameCard | undefined,
  alt: GameCard["altTribute"] | undefined,
): boolean {
  if (!card || card.cardKind !== "monster" || !alt) return false;
  if (card.isFacedown) return false;
  if (
    (alt as { requiresName?: string }).requiresName &&
    card.name !== (alt as { requiresName?: string }).requiresName
  )
    return false;
  if (
    (alt as { requiresType?: string }).requiresType &&
    card.type !== (alt as { requiresType?: string }).requiresType
  )
    return false;
  return true;
}

export function canResolveSummonActionForCurrentState(
  bot: BotRuntimePort,
  action: AIAction,
  game: BotGamePort,
): boolean {
  const resolvedIndex = resolveHandIndexForAction(bot, action, "monster");
  if (resolvedIndex < 0) return false;
  const card = bot.hand?.[resolvedIndex];
  if (!card || card.cardKind !== "monster") return false;
  if (card.cannotBeNormalSummonedOrSet) return false;
  if (card.summonRestrict === "shadow_heart_invocation_only") return false;

  if (!canUseNormalSummonForCard(bot, card)) return false;

  const tributeInfo = bot.getTributeRequirementFor(card, bot) || {
    tributesNeeded: 0,
  };
  const tributesNeeded = Math.max(0, Number(tributeInfo.tributesNeeded || 0));
  const field = Array.isArray(bot.field) ? bot.field : [];
  if (!fieldHasTributeValue(field, tributesNeeded, card)) return false;

  let tributeIndices: number[] = [];
  if (tributesNeeded > 0) {
    const opponent = game
      ? bot === game.player
        ? game.bot
        : game.player
      : null;
    const selection = selectPayableTributes(bot, field, game, candidates =>
      typeof bot.selectBestTributes === "function"
        ? bot.selectBestTributes(candidates, tributesNeeded, card, {
            oppField: opponent?.field || [],
            game,
          })
        : candidates.map((_entry, index) => index).slice(0, tributesNeeded));
    tributeIndices = selection.indices;
    if (!Array.isArray(tributeIndices) || tributeIndices.length === 0) {
      return false;
    }
    const uniqueIndices = [...new Set(tributeIndices)].filter(
      (index) => Number.isInteger(index) && field[index],
    );
    const tributeCards = getTributeCardsFromIndices(field, uniqueIndices);
    if (getTributeValueTotal(tributeCards, card) < tributesNeeded) return false;
    if (!tributeCards.every(tribute => canMoveCardToZone(bot, tribute, "graveyard", bot, { state: game }))) return false;
    const tradeCheck =
      typeof bot.evaluateTributeTrade === "function"
        ? bot.evaluateTributeTrade(card, selection.candidates, tributesNeeded, {
            oppField: opponent?.field || [],
            game,
          })
        : { ok: true };
    if (tradeCheck?.ok === false) return false;
    tributeIndices = uniqueIndices;
    if (
      tributeInfo.usingAlt === true &&
      tributeInfo.alt &&
      !tributeIndices.some((index) =>
        tributeMatchesAltRequirement(field[index], tributeInfo.alt),
      )
    ) {
      return false;
    }
  }

  if (field.length - tributeIndices.length + 1 > 5) return false;

  if (typeof game?.canPlaceCardOnField === "function") {
    const isFacedown = (action as AIActionOf<"summon">).facedown === true;
    const excluded = tributeIndices
      .map((index) => field[index])
      .filter(Boolean);
    const placeCheck = game.canPlaceCardOnField(card, bot, {
      zone: "monster",
      isFacedown,
      excludeCards: excluded,
      silent: true,
    } as Parameters<BotGamePort["canPlaceCardOnField"]>[2]);
    if (placeCheck?.ok === false) return false;
  }

  return true;
}

function zoneCards(player: GamePlayer, zoneName: CanonicalZone): GameCard[] {
  if (!player) return [];
  if (zoneName === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  const zone = player[zoneName];
  return Array.isArray(zone) ? zone.filter(Boolean) : [];
}

function controlledPublicCards(player: GamePlayer) {
  return [
    ...zoneCards(player, "field").map((card) => ({ card, zone: "field" })),
    ...zoneCards(player, "spellTrap").map((card) => ({
      card,
      zone: "spellTrap",
    })),
    ...zoneCards(player, "fieldSpell").map((card) => ({
      card,
      zone: "fieldSpell",
    })),
  ];
}

function findEffectForAction(
  card: GameCard,
  action: AIAction,
  fallbackZone: CanonicalZone,
) {
  const contextualEffect = action?.activationContext?.effect;
  if (contextualEffect && Array.isArray(contextualEffect.actions)) {
    return contextualEffect;
  }

  const effects: readonly EffectDefinition[] = Array.isArray(card?.effects)
    ? card.effects
    : [];
  if (action?.effectId) {
    const byId = effects.find((effect) => effect?.id === action.effectId);
    if (byId) return byId;
  }

  return (
    effects.find((effect) => {
      if (effect?.timing !== "ignition") return false;
      if (
        fallbackZone &&
        !getCanonicalEffectActivationZones(card, effect).includes(fallbackZone)
      ) {
        return false;
      }
      return true;
    }) || null
  );
}

function actionRemovesFieldCounters(action: CardAction): boolean {
  if (!action) return false;
  if (
    action.type !== "remove_counters_from_field" &&
    action.type !== "remove_all_counters_from_field"
  ) {
    return false;
  }
  const zones: readonly (string | undefined)[] = Array.isArray(action.zones)
    ? action.zones
    : [action.zone].filter(Boolean);
  if (zones.length === 0) return true;
  return zones.some((zone) =>
    ["field", "spellTrap", "fieldSpell"].includes(zone as string),
  );
}

function actionSummonsFromHand(action: CardAction): boolean {
  return action?.type === "conditional_summon_from_hand";
}

function effectRemovesCountersBeforeHandSummon(
  effect: EffectDefinition | null,
): boolean {
  const actions: readonly CardAction[] = Array.isArray(effect?.actions)
    ? effect.actions
    : [];
  const summonIndex = actions.findIndex(actionSummonsFromHand);
  if (summonIndex <= 0) return false;
  return actions.slice(0, summonIndex).some(actionRemovesFieldCounters);
}

function actionSpecialSummonsToSelfField(action: CardAction): boolean {
  if (!action) return false;
  if (
    action.type !== "special_summon_token" &&
    action.type !== "special_summon_from_zone" &&
    action.type !== "special_summon_matching_level" &&
    action.type !== "draw_and_summon" &&
    action.type !== "search_then_optional_special_summon_from_hand"
  ) {
    return false;
  }
  return (
    (action as { player?: string }).player === undefined ||
    (action as { player?: string }).player === "self"
  );
}

function cardEffectActiveInZone(
  card: GameCard,
  zone: string,
  effect: EffectDefinition,
): boolean {
  if (!card || !effect) return false;
  if (effect.requireZone && effect.requireZone !== zone) return false;
  if (effect.requireFaceup === true && card.isFacedown === true) return false;
  if (zone === "spellTrap" && card.isFacedown === true) return false;
  return true;
}

function controlsCounterRemovedSelfSummonTrigger(player: GamePlayer): boolean {
  return controlledPublicCards(player).some(({ card, zone }) => {
    const effects: readonly EffectDefinition[] = Array.isArray(card?.effects)
      ? card.effects
      : [];
    return effects.some((effect) => {
      if (effect?.timing !== "on_event") return false;
      if (effect.event !== "counter_removed") return false;
      if (!cardEffectActiveInZone(card, zone, effect)) return false;
      const actions: readonly CardAction[] = Array.isArray(effect.actions)
        ? effect.actions
        : [];
      return actions.some(actionSpecialSummonsToSelfField);
    });
  });
}

function needsCounterRemovedSummonZoneReserve(
  bot: BotRuntimePort,
  action: AIAction,
  card: GameCard,
): boolean {
  if ((bot?.field || []).length <= 3) return false;
  const effect = findEffectForAction(card, action, "hand");
  if (!effectRemovesCountersBeforeHandSummon(effect)) return false;
  return controlsCounterRemovedSelfSummonTrigger(bot);
}

export function findExtraDeckCardForAction(
  bot: BotRuntimePort,
  action: AIActionOf<"extraDeckProcedure">,
) {
  const extraDeck = bot?.extraDeck || [];
  const bound = resolvePlanningCard<GameCard>(extraDeck, action.extraDeckCard, bot.id, "extraDeck", action);
  if (bound.explicit) return bound.card;
  if (Number.isInteger(action.extraDeckIndex)) {
    const direct = extraDeck[action.extraDeckIndex!];
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

function findFieldMaterialForHint(
  field: GameCard[] = [],
  hint: ExtraDeckMaterialHint = {},
) {
  const ids = Array.isArray(hint.instanceIds) ? hint.instanceIds : [];
  if (ids.length > 0) {
    return resolvePlanningMaterialIds<GameCard>(field, ids);
  }

  if (Number.isInteger(hint.index)) {
    const direct = field[hint.index!];
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

export function resolveExtraDeckProcedureMaterials(
  bot: BotRuntimePort,
  action: AIActionOf<"extraDeckProcedure">,
) {
  const field = bot?.field || [];
  const hints = Array.isArray(action.materials)
    ? action.materials
    : (action.materialIndices || []).map((index, offset) => ({
        index,
        id: action.materialIds?.[offset],
        name: action.materialNames?.[offset],
        instanceIds: action.materialInstanceIds?.[offset],
      }));
  const materials: GameCard[] = [];
  for (const [offset, hint] of hints.entries()) {
    const bound = resolvePlanningCard<GameCard>(field, undefined, bot.id, "field", action, offset);
    const material = bound.explicit ? bound.card : findFieldMaterialForHint(field, hint);
    if (!material || materials.includes(material)) return [];
    materials.push(material);
  }
  return materials;
}

function materialSelectionMatchesCombo(
  materials: readonly GameCard[] = [],
  combos: readonly (readonly GameCard[])[] = [],
): boolean {
  if (!Array.isArray(materials) || !Array.isArray(combos)) return false;
  return combos.some((combo: readonly GameCard[]) => {
    if (!Array.isArray(combo) || combo.length !== materials.length)
      return false;
    const remaining: GameCard[] = [...combo];
    for (const material of materials as readonly GameCard[]) {
      const index = remaining.indexOf(material);
      if (index < 0) return false;
      remaining.splice(index, 1);
    }
    return true;
  });
}

export function resolveAscensionActionForCurrentState(
  bot: BotRuntimePort, action: AIActionOf<"ascension">,
): { material: GameCard; card: GameCard } | null {
  const boundMaterial = resolvePlanningCard<GameCard>(bot.field, action.material, bot.id, "field", action, 0);
  const material = boundMaterial.explicit ? boundMaterial.card : bot.field[action.materialIndex!];
  const boundSource = resolvePlanningCard<GameCard>(bot.extraDeck, action.ascensionCard, bot.id, "extraDeck", action);
  const card = boundSource.explicit ? boundSource.card : bot.extraDeck.find(candidate =>
    candidate.id === action.ascensionCard?.id || candidate.name === action.cardName || candidate.name === action.ascensionCard?.name);
  return material && card ? { material, card } : null;
}

/** Bind a newly generated runtime command before its mutable references move. */
export function bindGeneratedMainPhaseAction(
  bot: BotRuntimePort, game: BotGamePort, action: AIAction,
): AIAction {
  if (getPlanningActionPresence(action)) return action;
  let source: GameCard | undefined | null;
  let zone: CanonicalZone;
  switch (action.type) {
    case "summon": case "spell": case "set_spell_trap":
    case "handIgnition": case "handSummonProcedure": case "special_summon_sanctum_protector":
      zone = "hand";
      source = bot.hand[resolveHandIndexForAction(bot, action)];
      break;
    case "monsterEffect": case "position_change":
      zone = "field"; source = bot.field[resolvePlanningSourceIndex(bot.field, action, bot.id, zone, action.card) ?? action.fieldIndex!]; break;
    case "graveyardMonsterEffect": case "graveyardSpellEffect":
      zone = "graveyard"; source = bot.graveyard[resolvePlanningSourceIndex(bot.graveyard, action, bot.id, zone, action.card) ?? action.graveyardIndex!]; break;
    case "spellTrapEffect":
      zone = "spellTrap"; source = bot.spellTrap[resolvePlanningSourceIndex(bot.spellTrap, action, bot.id, zone, action.card) ?? action.zoneIndex ?? action.index!]; break;
    case "fieldEffect": zone = "fieldSpell"; source = bot.fieldSpell; break;
    case "ascension": {
      const resolved = resolveAscensionActionForCurrentState(bot, action);
      return resolved ? bindPlanningActionPresence(action, resolved.card, bot.id, "extraDeck", game,
        [{ card: resolved.material, zone: "field" }]) : action;
    }
    case "extraDeckProcedure": {
      source = findExtraDeckCardForAction(bot, action);
      const materials = resolveExtraDeckProcedureMaterials(bot, action);
      return source ? bindPlanningActionPresence(action, source, bot.id, "extraDeck", game,
        materials.map(card => ({ card, zone: "field" }))) : action;
    }
    case "synchro": return action; // Its existing ordered instance contract is authoritative.
  }
  return source ? bindPlanningActionPresence(action, source, bot.id, zone, game) : action;
}

export function canResolveExtraDeckProcedureActionForCurrentState(
  bot: BotRuntimePort,
  action: AIActionOf<"extraDeckProcedure">,
  game: BotGamePort,
): boolean {
  const card = findExtraDeckCardForAction(bot, action);
  if (!card || !card.extraDeckSummonProcedure) return false;
  if (typeof game?.canSummonExtraDeckCardByProcedure !== "function") {
    return false;
  }

  const check = game.canSummonExtraDeckCardByProcedure(card, bot, {
    silent: true,
  });
  if (!check?.ok) return false;

  const materials = resolveExtraDeckProcedureMaterials(bot, action);
  if (materials.length !== Number(check.requiredCount || materials.length)) {
    return false;
  }
  const candidateSet = new Set(check.candidates || []);
  if (materials.some((material) => !candidateSet.has(material))) return false;
  if (
    check.materialCombos &&
    !materialSelectionMatchesCombo(materials, check.materialCombos)
  ) {
    return false;
  }
  return true;
}

export function filterValidActionsForCurrentState(
  bot: BotRuntimePort,
  actions: AIAction[],
  game: BotGamePort,
): AIAction[] {
  if (!Array.isArray(actions)) return [];
  return actions.filter((action) => {
    if (!action || !action.type) return false;
    if (!isPlanningActionPresenceCurrent(action, bot)) return false;
    if (action.type === "synchro") {
      return resolveSynchroActionForCurrentState(bot, action, game) !== null;
    }
    if (action.type === "summon") {
      return canResolveSummonActionForCurrentState(bot, action, game);
    }
    if (action.type === "handSummonProcedure") {
      return canResolveHandSummonProcedureActionForCurrentState(bot, action, game);
    }
    if (action.type === "spell") {
      const handIndex = resolveHandIndexForAction(bot, action, "spell");
      const card = bot.hand?.[handIndex];
      if (!card) return false;
      const activationContext: AIActivationContext = {
        ...(action.activationContext || {}),
        fromHand: true,
        sourceZone: "hand",
      };
      const preview = game?.effectEngine?.canActivateSpellFromHandPreview?.(
        card,
        bot,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "set_spell_trap") {
      const handIndex = resolveHandIndexForAction(bot, action, [
        "spell",
        "trap",
      ]);
      if (handIndex < 0) return false;
      const card = bot.hand?.[handIndex];
      return canSetReactiveBackrowNow(card, game);
    }
    if (action.type === "spellTrapEffect") {
      const zoneIndex = resolvePlanningSourceIndex(bot.spellTrap, action, bot.id, "spellTrap", action.card) ?? (Number.isInteger(action.zoneIndex) ? action.zoneIndex : action.index);
      const card = bot.spellTrap?.[zoneIndex!];
      if (!card || (card.cardKind !== "spell" && card.cardKind !== "trap"))
        return false;
      const activationContext: AIActivationContext = {
        ...(action.activationContext || {}),
        fromHand: false,
        activationZone: "spellTrap",
        sourceZone: "spellTrap",
        trapActivationFromSet:
          action.activationContext?.trapActivationFromSet === true ||
          (card.cardKind === "trap" && card.isFacedown === true),
        autoSelectTargets:
          action.activationContext?.autoSelectTargets !== false,
        autoSelectSingleTarget:
          action.activationContext?.autoSelectSingleTarget !== false,
      };
      const preview = game?.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        bot,
        "spellTrap",
        null,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "graveyardSpellEffect") {
      const graveyardIndex = resolvePlanningSourceIndex(bot.graveyard, action, bot.id, "graveyard", action.card) ?? (Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : bot.graveyard.findIndex(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          ));
      const card = bot.graveyard?.[graveyardIndex!];
      if (!card || (card.cardKind !== "spell" && card.cardKind !== "trap")) return false;
      const activationContext: AIActivationContext = {
        ...(action.activationContext || {}),
        fromHand: false,
        activationZone: "graveyard",
        sourceZone: "graveyard",
      };
      const preview = game?.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        bot,
        "graveyard",
        null,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "special_summon_sanctum_protector") {
      const handIndex = resolveHandIndexForAction(bot, action, "monster");
      if (handIndex < 0) return false;
      const materialIndex = Number.isInteger(action.materialIndex)
        ? action.materialIndex
        : bot.field.findIndex(
            (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown,
          );
      const material = bot.field[materialIndex!];
      return !!(
        material &&
        material.name === "Luminarch Aegisbearer" &&
        !material.isFacedown
      );
    }
    if (action.type === "handIgnition") {
      const handIndex = resolveHandIndexForAction(bot, action, "monster");
      const card = bot.hand?.[handIndex];
      if (!card || card.cardKind !== "monster") return false;
      if (needsCounterRemovedSummonZoneReserve(bot, action, card)) {
        return false;
      }
      const activationContext: AIActivationContext = {
        ...(action.activationContext || {}),
        effectId:
          action.effectId ||
          action.effect?.id ||
          action.activationContext?.effectId ||
          null,
        fromHand: true,
        activationZone: "hand",
        sourceZone: "hand",
        autoSelectTargets:
          action.activationContext?.autoSelectTargets !== false,
      };
      const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "hand",
        null,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "graveyardMonsterEffect") {
      const graveyardIndex = resolvePlanningSourceIndex(bot.graveyard, action, bot.id, "graveyard", action.card) ?? (Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : bot.graveyard.findIndex(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          ));
      const card = bot.graveyard?.[graveyardIndex!];
      if (!card || card.cardKind !== "monster") return false;
      const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "graveyard",
        null,
        {
          activationContext: {
            ...(action.activationContext || {}),
            effectId:
              action.effectId ||
              action.effect?.id ||
              action.activationContext?.effectId ||
              null,
          },
        },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "monsterEffect") {
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
        return false;
      }
      const effect = findEffectForAction(card, action, "field");
      if (effect?.actions?.some(effectAction => effectAction.type === "bounce_and_summon" &&
          !hasActionZoneCandidates(bot, effectAction, card))) return false;
      const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "field",
        null,
        {
          activationContext: {
            ...(action.activationContext || {}),
            effectId:
              action.effectId ||
              action.effect?.id ||
              action.activationContext?.effectId ||
              null,
          },
        },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "ascension") {
      const resolved = resolveAscensionActionForCurrentState(bot, action);
      if (!resolved) return false;
      const { material, card } = resolved;
      if (game?.canUseAsAscensionMaterial) {
        const check = game.canUseAsAscensionMaterial(bot, material);
        if (check && check.ok === false) return false;
      }
      if (
        typeof game?.checkAscensionRequirements === "function" &&
        action.ascensionCard
      ) {
        const requirementCheck = game.checkAscensionRequirements(
          bot,
          card,
          material,
        );
        if (requirementCheck && requirementCheck.ok === false) return false;
      }
      if (
        action.ascensionCard &&
        typeof game?.canPlaceCardOnField === "function"
      ) {
        const placeCheck = game.canPlaceCardOnField(
          card,
          bot,
          {
            isFacedown: false,
            excludeCards: [material],
            summonMethod: "ascension",
            summonProcedure: "ascension",
            silent: true,
          },
        );
        if (placeCheck?.ok === false) return false;
      }
      return true;
    }
    if (action.type === "extraDeckProcedure") {
      return canResolveExtraDeckProcedureActionForCurrentState(
        bot,
        action,
        game,
      );
    }
    if (action.type === "fieldEffect") {
      if (!bot.fieldSpell) return false;
      const activationContext: AIActivationContext = {
        ...(action.activationContext || {}),
        fromHand: false,
        activationZone: "fieldSpell",
        sourceZone: "fieldSpell",
      };
      const preview = game?.effectEngine?.canActivateFieldSpellEffectPreview?.(
        bot.fieldSpell,
        bot,
        null,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "position_change") {
      const boundIndex = resolvePlanningSourceIndex(bot.field, action, bot.id, "field", action.card);
      const target = boundIndex !== null ? bot.field[boundIndex] : Number.isInteger(action.fieldIndex)
        ? bot.field?.[action.fieldIndex!]
        : (bot.field || []).find(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      if (!target) return false;
      if (
        typeof game?.canChangePosition === "function" &&
        !game.canChangePosition(target)
      ) {
        return false;
      }
      if (
        action.toPosition &&
        (action.toPosition === "attack" || action.toPosition === "defense") &&
        target.position === action.toPosition
      ) {
        return false;
      }
      return true;
    }
    return true;
  });
}

/** Resolve exact instances and recheck the complete material set before payment. */
export function resolveSynchroActionForCurrentState(
  bot: BotRuntimePort,
  action: AIActionOf<"synchro">,
  game: BotGamePort,
): { card: GameCard; materials: GameCard[] } | null {
  if (action.position !== "attack" && action.position !== "defense") return null;
  const destinations = bot.extraDeck.filter(card => card.instanceId === action.synchroInstanceId);
  const card = destinations[0];
  if (destinations.length !== 1 || !card || card.monsterType !== "synchro") return null;
  if (!Array.isArray(action.materialInstanceIds) || action.materialInstanceIds.length === 0 ||
      new Set(action.materialInstanceIds).size !== action.materialInstanceIds.length) return null;
  const materials: GameCard[] = [];
  for (const id of action.materialInstanceIds) {
    const matches = bot.field.filter(material => material.instanceId === id);
    const material = matches[0];
    if (matches.length !== 1 || !material) return null;
    materials.push(material);
  }
  if (!materials.every(material => canMoveCardToZone(bot, material, "graveyard", bot, { state: game }))) return null;
  const check = game.canSummonSynchroCard(bot, card, { silent: true });
  if (!check.ok || !materialSelectionMatchesCombo(materials, check.materialCombos)) return null;
  const placement = game.canPlaceCardOnField(card, bot, {
    excludeCards: materials, isFacedown: false,
    summonMethod: "synchro", summonProcedure: "synchro", silent: true,
  });
  return placement.ok === false ? null : { card, materials };
}
