/**
 * Central Quick Spell legality helpers.
 *
 * These functions are intentionally pure and side-effect free. They define the
 * shared rule surface used by later integration steps for activation, preview,
 * UI, and chain discovery.
 */

const QUICK_SPELL_SUBTYPES = new Set(["quick", "quick-play", "quickplay"]);

const CHAIN_WINDOW_CONTEXT_TYPES = new Set([
  "attack_declaration",
  "battle_step_open",
  "battle_damage",
  "card_activation",
  "effect_activation",
  "effect_targeted",
  "main_phase_action",
  "phase_change",
  "summon",
  "summon_attempt",
]);

const DIRECT_ATK_DEF_ACTIONS = new Set([
  "buff_atk_by_lp_gained_this_turn",
  "buff_stats_by_counter",
  "buff_stats_temp",
  "modify_stats_temp",
  "permanent_buff_named",
  "reduce_self_atk",
  "remove_stat_increases",
  "set_original_stats",
]);

function result(ok, detail = {}) {
  return {
    ok,
    spellSpeed: detail.spellSpeed ?? 2,
    ...detail,
  };
}

function failure(code, reason, detail = {}) {
  return result(false, { code, reason, ...detail });
}

function getRequiredSpellSpeed(context = {}) {
  const candidates = [
    context.requiredSpellSpeed,
    context.respondingToSpellSpeed,
    context.lastSpellSpeed,
  ];
  let required = 0;
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      required = Math.max(required, numeric);
    }
  }
  return required;
}

function checkSpellSpeed(context = {}) {
  const required = getRequiredSpellSpeed(context);
  if (required > 2) {
    return failure(
      "QUICK_SPELL_SPEED_TOO_LOW",
      "Quick Spell cannot respond to Spell Speed 3.",
      { requiredSpellSpeed: required },
    );
  }
  return result(true);
}

function isOwnMainPhaseOpen(game, player) {
  return (
    !!game &&
    !!player &&
    game.turn === player.id &&
    (game.phase === "main1" || game.phase === "main2")
  );
}

function hasExplicitLegalWindow(context = {}) {
  if (
    context.legalWindow === true ||
    context.isChainWindow === true ||
    context.chainWindowOpen === true ||
    context.openState === true
  ) {
    return true;
  }
  return CHAIN_WINDOW_CONTEXT_TYPES.has(context.type);
}

function hasLegalQuickSpellWindow(game, player, context = {}) {
  return hasExplicitLegalWindow(context) || isOwnMainPhaseOpen(game, player);
}

function getSetTurn(card) {
  return card?.setTurn ?? card?.turnSetOn ?? null;
}

function hasOwnPropertyValue(action, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(action, key));
}

function hasNonZeroNumber(action, keys) {
  return keys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(action, key)) return false;
    const value = Number(action[key]);
    return Number.isFinite(value) && value !== 0;
  });
}

function actionDirectlyChangesAtkDef(action) {
  if (!action || !DIRECT_ATK_DEF_ACTIONS.has(action.type)) return false;

  switch (action.type) {
    case "buff_stats_temp":
      return (
        hasNonZeroNumber(action, ["atkBoost", "defBoost"]) ||
        hasOwnPropertyValue(action, [
          "atkBoostFromContext",
          "defBoostFromContext",
        ])
      );
    case "modify_stats_temp":
      return (
        (Object.prototype.hasOwnProperty.call(action, "atkFactor") &&
          Number(action.atkFactor) !== 1) ||
        (Object.prototype.hasOwnProperty.call(action, "defFactor") &&
          Number(action.defFactor) !== 1)
      );
    case "buff_stats_by_counter":
      return hasNonZeroNumber(action, [
        "atkPerCounter",
        "defPerCounter",
        "atkBoostPerCounter",
        "defBoostPerCounter",
      ]);
    case "buff_atk_by_lp_gained_this_turn":
      return true;
    case "reduce_self_atk":
      return true;
    case "remove_stat_increases": {
      const stats = Array.isArray(action.stats)
        ? action.stats.map((stat) => String(stat).toLowerCase())
        : [];
      return (
        stats.length === 0 || stats.includes("atk") || stats.includes("def")
      );
    }
    case "permanent_buff_named":
      return hasNonZeroNumber(action, ["atkBoost", "defBoost"]);
    case "set_original_stats":
      return (
        hasOwnPropertyValue(action, [
          "atk",
          "def",
          "baseAtk",
          "baseDef",
          "atkFromContext",
          "defFromContext",
        ])
      );
    default:
      return false;
  }
}

function getEffectTarget(effect, targetRef) {
  if (!targetRef || !Array.isArray(effect?.targets)) return null;
  return effect.targets.find((target) => target?.id === targetRef) || null;
}

function isSelfGraveyardCostAction(action, effect) {
  if (!action || action.type !== "move") return false;
  if (action.contextLabel !== "cost") return false;
  if (String(action.to || "").toLowerCase() !== "graveyard") return false;
  if (action.targetRef === "self") return true;

  const target = getEffectTarget(effect, action.targetRef);
  return target?.requireThisCard === true;
}

function isDamageStepContext(context = {}) {
  return (
    context.type === "battle_damage" ||
    context.isDamageStep === true ||
    context.damageStepTiming != null
  );
}

function getCardSpellSpeed(card, effect = null) {
  if (Number.isFinite(Number(effect?.speed))) {
    return Number(effect.speed);
  }
  if (card?.cardKind === "trap" && card?.subtype === "counter") return 3;
  if (isQuickSpell(card)) return 2;
  if (card?.cardKind === "trap") return 2;
  if (card?.cardKind === "monster") {
    return effect?.isQuickEffect === true ? 2 : 1;
  }
  return 1;
}

function isCounterTrap(card) {
  return card?.cardKind === "trap" && card?.subtype === "counter";
}

function isQuickMonsterEffect(effect, card) {
  return (
    card?.cardKind === "monster" &&
    (effect?.isQuickEffect === true || Number(effect?.speed) === 2)
  );
}

function isDamageStepEffectSource(effect, card) {
  return (
    isQuickSpell(card) ||
    card?.cardKind === "trap" ||
    isQuickMonsterEffect(effect, card) ||
    (effect?.timing === "on_event" && effect?.event === "battle_damage")
  );
}

export function isQuickSpell(card) {
  return (
    card?.cardKind === "spell" &&
    QUICK_SPELL_SUBTYPES.has(String(card.subtype || "").toLowerCase())
  );
}

export function getQuickSpellActivationZone(card, player) {
  if (!card || !player || !isQuickSpell(card)) return null;
  if (Array.isArray(player.hand) && player.hand.includes(card)) return "hand";
  if (Array.isArray(player.spellTrap) && player.spellTrap.includes(card)) {
    return "spellTrap";
  }
  return null;
}

export function canActivateQuickSpellFromHand(
  game,
  card,
  player,
  context = {},
) {
  if (!isQuickSpell(card)) {
    return failure("NOT_QUICK_SPELL", "Card is not a Quick Spell.", {
      activationZone: "hand",
    });
  }
  if (!player?.hand?.includes?.(card)) {
    return failure("NOT_IN_HAND", "Quick Spell is not in hand.", {
      activationZone: "hand",
    });
  }
  if (game?.turn !== player.id) {
    return failure(
      "OPPONENT_TURN_HAND",
      "Quick Spell cannot be activated from hand on the opponent's turn.",
      { activationZone: "hand" },
    );
  }

  const speedCheck = checkSpellSpeed(context);
  if (!speedCheck.ok) return { ...speedCheck, activationZone: "hand" };

  const damageStepCheck = canActivateInDamageStep(
    context.effect,
    card,
    context,
  );
  if (!damageStepCheck.ok) {
    return { ...damageStepCheck, activationZone: "hand" };
  }

  if (!hasLegalQuickSpellWindow(game, player, context)) {
    return failure(
      "NO_LEGAL_WINDOW",
      "No legal Quick Spell activation window is open.",
      { activationZone: "hand" },
    );
  }

  return result(true, { activationZone: "hand" });
}

export function canActivateSetQuickSpell(game, card, player, context = {}) {
  if (!isQuickSpell(card)) {
    return failure("NOT_QUICK_SPELL", "Card is not a Quick Spell.", {
      activationZone: "spellTrap",
    });
  }
  if (!player?.spellTrap?.includes?.(card)) {
    return failure(
      "NOT_IN_SPELL_TRAP_ZONE",
      "Quick Spell is not in the Spell/Trap Zone.",
      { activationZone: "spellTrap" },
    );
  }
  if (card.isFacedown !== true) {
    return failure("NOT_SET", "Quick Spell must be Set to activate here.", {
      activationZone: "spellTrap",
    });
  }

  const setTurn = getSetTurn(card);
  if (setTurn === null || setTurn === undefined) {
    return failure("SET_TURN_MISSING", "Set turn is missing.", {
      activationZone: "spellTrap",
    });
  }
  if (!Number.isFinite(Number(game?.turnCounter))) {
    return failure("TURN_COUNTER_MISSING", "Current turn is missing.", {
      activationZone: "spellTrap",
    });
  }
  if (Number(setTurn) >= Number(game.turnCounter)) {
    return failure(
      "SET_THIS_TURN",
      "Quick Spell cannot be activated the turn it was Set.",
      { activationZone: "spellTrap" },
    );
  }

  const speedCheck = checkSpellSpeed(context);
  if (!speedCheck.ok) return { ...speedCheck, activationZone: "spellTrap" };

  const damageStepCheck = canActivateInDamageStep(
    context.effect,
    card,
    context,
  );
  if (!damageStepCheck.ok) {
    return { ...damageStepCheck, activationZone: "spellTrap" };
  }

  if (!hasLegalQuickSpellWindow(game, player, context)) {
    return failure(
      "NO_LEGAL_WINDOW",
      "No legal Quick Spell activation window is open.",
      { activationZone: "spellTrap" },
    );
  }

  return result(true, { activationZone: "spellTrap" });
}

export function canActivateQuickSpell(game, card, player, context = {}) {
  const requestedZone = context.activationZone || context.zone || null;
  const zone =
    requestedZone === "hand" || requestedZone === "spellTrap"
      ? requestedZone
      : getQuickSpellActivationZone(card, player);

  if (zone === "hand") {
    return canActivateQuickSpellFromHand(game, card, player, context);
  }
  if (zone === "spellTrap") {
    return canActivateSetQuickSpell(game, card, player, context);
  }

  return failure(
    "QUICK_SPELL_ZONE_NOT_FOUND",
    "Quick Spell is not in an activatable zone.",
    { activationZone: null },
  );
}

export function effectDirectlyChangesAtkDef(effect) {
  const actions = Array.isArray(effect?.actions) ? effect.actions : [];
  if (actions.length === 0) return false;

  let foundDirectStatChange = false;
  for (const action of actions) {
    if (!action || !action.type) return false;
    if (actionDirectlyChangesAtkDef(action)) {
      foundDirectStatChange = true;
      continue;
    }
    if (isSelfGraveyardCostAction(action, effect)) {
      continue;
    }
    return false;
  }

  return foundDirectStatChange;
}

export function canActivateDuringDamageStep(effect, card, context = {}) {
  const spellSpeed = getCardSpellSpeed(card, effect);
  if (!isDamageStepContext(context)) {
    return result(true, { spellSpeed });
  }
  if (isCounterTrap(card)) {
    return result(true, { spellSpeed: 3 });
  }
  if (effect?.allowDamageStepActivation === true) {
    return result(true, { spellSpeed });
  }
  if (
    isDamageStepEffectSource(effect, card) &&
    effectDirectlyChangesAtkDef(effect)
  ) {
    return result(true, { spellSpeed });
  }
  return failure(
    "DAMAGE_STEP_RESTRICTED",
    "This effect cannot be activated during the Damage Step.",
    { spellSpeed },
  );
}

export function canActivateInDamageStep(effect, card, context = {}) {
  return canActivateDuringDamageStep(effect, card, context);
}
