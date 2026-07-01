function normalizePhase(source, analysis = null) {
  if (typeof source === "string") return source.toLowerCase();
  const phase = source?.phase || analysis?.phase || analysis?.game?.phase || "";
  return String(phase || "").toLowerCase();
}

export function isMain1Phase(source, analysis = null) {
  const phase = normalizePhase(source, analysis);
  return phase === "main1" || phase === "main";
}

export function isMain2Phase(source, analysis = null) {
  const phase = normalizePhase(source, analysis);
  return phase === "main2" || phase === "main_2";
}

export function isQuickSpellCard(card) {
  const subtype = String(card?.subtype || "").toLowerCase();
  return (
    card?.cardKind === "spell" &&
    (subtype === "quick" || subtype === "quick-play" || subtype === "quickplay")
  );
}

export function isReactiveBackrowCard(card) {
  return card?.cardKind === "trap" || isQuickSpellCard(card);
}

function getTurnCounter(source, analysis = null) {
  const value =
    source?.turnCounter ??
    analysis?.turnCounter ??
    analysis?.game?.turnCounter ??
    analysis?.game?._gameRef?.turnCounter;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function canSetReactiveBackrowNow(card, gameOrState = null, analysis = null) {
  if (!isReactiveBackrowCard(card)) return false;
  if (!isMain2Phase(gameOrState, analysis)) return false;
  if (isQuickSpellCard(card)) {
    const turnCounter = getTurnCounter(gameOrState, analysis);
    if (
      turnCounter !== null &&
      Number(card.lastAiActivatedTurn) === turnCounter
    ) {
      return false;
    }
  }
  return true;
}

export function getActionCard(action, context = {}) {
  if (!action) return null;
  if (action.card) return action.card;
  const player =
    context.player ||
    context.bot ||
    context.state?.bot ||
    context.game?.bot ||
    context.game?.player ||
    null;
  const hand = context.hand || player?.hand || [];
  if (Number.isInteger(action.index) && Array.isArray(hand)) {
    const handCard = hand[action.index];
    if (
      handCard &&
      (!action.cardId || handCard.id === action.cardId) &&
      (!action.cardName || handCard.name === action.cardName)
    ) {
      return handCard;
    }
  }
  const zones = [
    hand,
    player?.field,
    player?.spellTrap,
    player?.graveyard,
    player?.deck,
    player?.extraDeck,
  ];
  for (const zone of zones) {
    if (!Array.isArray(zone)) continue;
    const found = zone.find(
      (card) =>
        card &&
        ((action.cardId && card.id === action.cardId) ||
          (action.cardName && card.name === action.cardName)),
    );
    if (found) return found;
  }
  if (action.cardId || action.cardName) {
    return {
      id: action.cardId,
      name: action.cardName,
      cardKind: action.cardKind,
      subtype: action.subtype,
    };
  }
  return null;
}

export function isPostBattlePayoffAction(action, context = {}) {
  if (!action) return false;
  if (action.timingRole === "post_battle_payoff") return true;
  const hookOwner =
    typeof context.strategy?.isPostBattlePayoffAction === "function"
      ? context.strategy
      : typeof context.strategy?.strategy?.isPostBattlePayoffAction === "function"
        ? context.strategy.strategy
        : typeof context.bot?.strategy?.isPostBattlePayoffAction === "function"
          ? context.bot.strategy
          : null;
  const hook = hookOwner?.isPostBattlePayoffAction;
  if (typeof hook !== "function") return false;
  try {
    return hook.call(hookOwner, action, context) === true;
  } catch {
    return false;
  }
}

export function isPreBattleValueAction(action, context = {}) {
  if (!action || action.type === "simulatedBattle") return false;
  if (isPostBattlePayoffAction(action, context)) return false;
  if (action.type === "set_spell_trap") return false;
  if (action.timingRole === "reactive_backrow") return false;
  if (action.timingRole === "pre_battle_value") return true;

  const type = action.type;
  return (
    type === "summon" ||
    type === "special_summon_sanctum_protector" ||
    type === "extraDeckProcedure" ||
    type === "ascension" ||
    type === "spell" ||
    type === "monsterEffect" ||
    type === "handIgnition" ||
    type === "fieldEffect" ||
    type === "spellTrapEffect" ||
    type === "graveyardMonsterEffect" ||
    type === "graveyardSpellEffect" ||
    (type === "position_change" && action.toPosition !== "defense")
  );
}

export function isAllowedAiActionForCurrentPhase(action, context = {}) {
  if (!action) return false;
  const gameOrState = context.state || context.game || {};
  const card = getActionCard(action, context);

  if (action.type === "set_spell_trap") {
    return canSetReactiveBackrowNow(
      card,
      gameOrState,
      context.analysis || null,
    );
  }

  if (isMain2Phase(gameOrState, context.analysis || null)) {
    return isPostBattlePayoffAction(action, context);
  }

  return true;
}

export function filterAiActionsForCurrentPhase(actions, context = {}) {
  if (!Array.isArray(actions)) return [];
  return actions.filter((action) =>
    isAllowedAiActionForCurrentPhase(action, context),
  );
}

export function hasPreBattleValueActions(actions, context = {}) {
  return (actions || []).some((action) =>
    isPreBattleValueAction(action, context),
  );
}
