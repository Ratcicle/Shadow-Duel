// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/priorities.js
// Dragon deck spell/summon decisions and tribute logic.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CARD_KNOWLEDGE,
  CONVERGING_STARS_TARGETS,
  SELF_SUMMON_MONSTERS,
  countExtremeInGY,
  countSafeBanishTargets,
  isExtremeDragon,
} from "./knowledge.js";

/**
 * @typedef {Object} SpellDecision
 * @property {boolean} yes
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * @typedef {Object} SummonDecision
 * @property {boolean} yes
 * @property {string} [position]
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * Decides whether to play a spell/trap card.
 * @param {Object} card
 * @param {Object} analysis
 * @returns {SpellDecision}
 */
export function shouldPlaySpell(card, analysis) {
  const name = card.name;

  // ── Jagged Peak of the Dragons ─────────────────────────────────────────────
  if (name === "Jagged Peak of the Dragons") {
    if (analysis.fieldSpell) {
      return { yes: false, reason: "Field spell already active" };
    }
    return { yes: true, priority: 10, reason: "Core field spell — activate ASAP" };
  }

  // ── Converging Stars ───────────────────────────────────────────────────────
  if (name === "Converging Stars") {
    // Need a card to discard as cost
    if (analysis.hand.length < 2) {
      return { yes: false, reason: "Need 2+ cards in hand (1 for discard cost)" };
    }

    const handMonsters = analysis.hand.filter((c) => c.cardKind === "monster");

    // Check if any priority target is in hand
    const hasDarknessInHand = analysis.hand.some((c) => c.name === "Darkness Dragon");
    const hasAbyssalInHand = analysis.hand.some((c) => c.name === "Abyssal Serpent Dragon");
    const hasMajesticInHand = analysis.hand.some((c) => c.name === "Majestic Silver Dragon");

    // Also check if reducing levels would allow ANY useful summon
    // Darkness Dragon: lv5 → lv3 = 0 tributes (highest benefit)
    if (hasDarknessInHand) {
      return {
        yes: true,
        priority: 12,
        reason: "Darkness Dragon (lv5→3) becomes free summon",
      };
    }

    // Abyssal Serpent: lv7 → lv5 = saves 1 tribute (can't SS itself)
    if (hasAbyssalInHand) {
      const fieldMonsters = analysis.field.filter((c) => c.cardKind === "monster");
      if (fieldMonsters.length >= 1) {
        return {
          yes: true,
          priority: 10,
          reason: "Abyssal Serpent (lv7→5) saves 1 tribute",
        };
      }
      return { yes: false, reason: "Abyssal Serpent needs at least 1 tribute but field is empty" };
    }

    // Majestic Silver: lv7 → lv5 = use any 1 tribute (not requiring Dragon type)
    if (hasMajesticInHand) {
      const fieldMonsters = analysis.field.filter((c) => c.cardKind === "monster");
      if (fieldMonsters.length >= 1) {
        return {
          yes: true,
          priority: 8,
          reason: "Majestic Silver (lv7→5) = 1 regular tribute instead of Dragon-type",
        };
      }
    }

    // Check if any non-priority hand monster would benefit (generic case)
    const hasHighLevelBenefit = handMonsters.some((c) => {
      if (SELF_SUMMON_MONSTERS.includes(c.name)) return false;  // Has own SS
      if (CONVERGING_STARS_TARGETS.includes(c.name)) return false;  // Already checked above
      const lv = c.level || 0;
      return lv >= 5 && lv <= 8;  // lv5-6 become free; lv7-8 become 1 tribute
    });

    if (hasHighLevelBenefit) {
      return { yes: true, priority: 6, reason: "Reduces tribute requirement for hand monster" };
    }

    return { yes: false, reason: "No priority targets in hand (no tribute benefit)" };
  }

  // ── Polymerization ─────────────────────────────────────────────────────────
  if (name === "Polymerization") {
    const gyExtremeCount = analysis.extremeDragonEconomy?.extremeInGY ?? countExtremeInGY(
      analysis.graveyard.map((c) => ({ name: c.name, archetype: c.archetype, archetypes: c.archetypes }))
    );

    // Priority 1: Supreme Bahamut (5 Extreme Dragons in GY)
    if (gyExtremeCount >= 5) {
      return {
        yes: true,
        priority: 15,
        reason: "BAHAMUT AVAILABLE — 5 Extreme Dragons in GY! Game winning move!",
      };
    }

    // Priority 2: Tech-Void Dragon (Voltaic + lv5+ Dragon)
    const allCards = [...analysis.hand, ...analysis.field];
    const hasVoltaic = allCards.some((c) => c.name === "Voltaic Dragon");
    const hasLv5PlusDragon = allCards.some(
      (c) => c.type === "Dragon" && (c.level || 0) >= 5 && c.name !== "Voltaic Dragon"
    );

    if (hasVoltaic && hasLv5PlusDragon) {
      // Check if we have meaningful threats to deal with
      if (analysis.oppField.length >= 2) {
        return {
          yes: true,
          priority: 11,
          reason: "Tech-Void Dragon fusion vs 2+ opp threats",
        };
      }
      if (analysis.oppField.some((c) => (c.atk || 0) >= 2500)) {
        return {
          yes: true,
          priority: 10,
          reason: "Tech-Void Dragon fusion to match big threat",
        };
      }
      return {
        yes: true,
        priority: 8,
        reason: "Tech-Void Dragon fusion (Voltaic + lv5+ Dragon available)",
      };
    }

    return {
      yes: false,
      reason: "No valid fusion materials (need Voltaic + lv5+ Dragon, or 5 Extreme in GY)",
    };
  }

  // ── Hellkite Roar ──────────────────────────────────────────────────────────
  if (name === "Hellkite Roar") {
    // Requires lv7+ Dragon on field
    const hasLv7Dragon = analysis.field.some(
      (c) => c.cardKind === "monster" && !c.isFacedown && (c.level || 0) >= 7
    );
    if (!hasLv7Dragon) {
      return { yes: false, reason: "Need lv7+ Dragon face-up on field" };
    }

    // Check if worth playing (opp has backrow to destroy)
    if (analysis.oppBackrow >= 1) {
      const priority = analysis.oppBackrow >= 2 ? 9 : 7;
      return {
        yes: true,
        priority,
        reason: `Destroy opp backrow (${analysis.oppBackrow} set cards)`,
      };
    }

    return { yes: false, reason: "No opponent backrow to destroy (waste)" };
  }

  // ── Extreme Dragon Awakening ───────────────────────────────────────────────
  if (name === "Extreme Dragon Awakening") {
    const lv8DragonsInHand = analysis.hand.filter(
      (c) => c.cardKind === "monster" && c.type === "Dragon" && (c.level || 0) >= 8
    );
    const fieldDragons = analysis.field.filter(
      (c) => c.cardKind === "monster" && !c.isFacedown && c.type === "Dragon"
    );
    const nonExtremeFieldDragons = fieldDragons.filter((c) => !isExtremeDragon(c));
    const hasExtremeFaceup = fieldDragons.some((c) => isExtremeDragon(c));
    const hasSummonableLv8InHand = lv8DragonsInHand.some(
      (c) => !hasExtremeFaceup || !isExtremeDragon(c)
    );
    if (nonExtremeFieldDragons.length < 2) {
      const canBuildFodder = analysis.hand.some((c) =>
        ["Luminescent Dragon", "Hellkite Dragon", "Voltaic Dragon", "Boneflame Dragon"].includes(c.name)
      );
      if (!canBuildFodder) {
        return { yes: true, priority: 8, reason: "Search Level 8+ Dragon and set up Awakening for later" };
      }
      return { yes: true, priority: 10, reason: "Search Level 8+ Dragon; extenders can produce fodder" };
    }
    if (hasSummonableLv8InHand) {
      return { yes: true, priority: 12, reason: "Activate and threaten ignition: 2 Dragon fodder + Level 8+ Dragon in hand" };
    }
    return { yes: true, priority: 11, reason: "Activate to search Level 8+ Dragon, then use ignition with 2 Dragon fodder" };
  }

  // ── Call of the Haunted ────────────────────────────────────────────────────
  if (name === "Call of the Haunted") {
    // For AI, treat as set-and-react — but in main phase, check if worth activating
    const hasGYTarget = analysis.graveyard.some((c) => c.cardKind === "monster");
    if (!hasGYTarget) {
      return { yes: false, reason: "No monster in GY to revive" };
    }
    // Prefer to activate when field is empty or under pressure
    if (analysis.field.length === 0 || analysis.oppField.length > 0) {
      return { yes: true, priority: 6, reason: "Revive from GY for field presence" };
    }
    return { yes: false, reason: "Field is fine, save for reactive play" };
  }

  // Generic spell fallback
  const knowledge = CARD_KNOWLEDGE[name];
  if (knowledge) {
    return { yes: true, priority: knowledge.priority || 3, reason: "Spell available" };
  }

  return { yes: true, priority: 3, reason: "Generic spell" };
}

/**
 * Decides whether to Normal Summon a monster.
 * @param {Object} card
 * @param {Object} analysis
 * @param {Object} tributeInfo
 * @param {Object} [context]
 * @returns {SummonDecision}
 */
export function shouldSummonMonster(card, analysis, tributeInfo, context = {}) {
  const name = card.name;
  const fieldState = context.field || analysis?.field || [];
  const oppFieldState = context.oppField || analysis?.oppField || [];
  const cardATK = card.atk || 0;
  const cardDEF = card.def || 0;
  const oppStrongestATK = oppFieldState.reduce(
    (max, m) => Math.max(max, m.atk || 0),
    0
  );
  const oppHasThreats = oppFieldState.length > 0;
  const isSuicideSummon = oppHasThreats && cardATK < oppStrongestATK && cardATK > 0;
  const shouldDefend = isSuicideSummon && cardDEF >= cardATK;

  // ── Armored Dragon ─────────────────────────────────────────────────────────
  if (name === "Armored Dragon") {
    if (tributeInfo.tributesNeeded > 0) {
      return { yes: false, reason: "Armored Dragon: level check mismatch (should be lv4)" };
    }
    return {
      yes: true,
      position: "attack",
      priority: 8,
      reason: "Normal Summon: search key Dragon from deck",
    };
  }

  // ── Luminescent Dragon ─────────────────────────────────────────────────────
  if (name === "Luminescent Dragon") {
    if (tributeInfo.tributesNeeded > 0) {
      return { yes: false, reason: "Luminescent Dragon: level check mismatch" };
    }
    const hasGYTarget = analysis.graveyard.some(
      (c) => c.cardKind === "monster" && (c.level || 0) <= 4
    );
    if (hasGYTarget) {
      return {
        yes: true,
        position: "attack",
        priority: 9,
        reason: "Normal Summon → SS lv4- Dragon from GY (free extender)",
      };
    }
    return {
      yes: true,
      position: isSuicideSummon ? "defense" : "attack",
      priority: 5,
      reason: "1500 ATK beater (no GY target)",
    };
  }

  // ── Abyssal Serpent Dragon ────────────────────────────────────────────────
  if (name === "Abyssal Serpent Dragon") {
    const actualTributes = tributeInfo.tributesNeeded;
    if (actualTributes > fieldState.length) {
      return {
        yes: false,
        reason: `Abyssal Serpent: needs ${actualTributes} tributes, have ${fieldState.length}`,
      };
    }
    if (actualTributes > 0) {
      const tradeCheck = evaluateTributeTrade(card, fieldState, actualTributes, { oppField: oppFieldState });
      if (!tradeCheck.ok) {
        return { yes: false, reason: tradeCheck.reason };
      }
    }
    // Only worth it if opponent has a dangerous monster
    if (analysis.oppField.length > 0) {
      const target = analysis.oppField.reduce((best, c) => ((c.atk || 0) > (best.atk || 0) ? c : best), { atk: 0 });
      return {
        yes: true,
        position: "attack",
        priority: 8,
        reason: `Stall ${target.name || "threat"} for a turn with exchange effect`,
      };
    }
    return { yes: false, reason: "Abyssal Serpent: no opponent monster to target (effect wasted)" };
  }

  // ── Majestic Silver Dragon ─────────────────────────────────────────────────
  if (name === "Majestic Silver Dragon") {
    const actualTributes = tributeInfo.tributesNeeded;
    if (actualTributes > fieldState.length) {
      return {
        yes: false,
        reason: `Majestic Silver: needs ${actualTributes} tributes, have ${fieldState.length}`,
      };
    }
    if (actualTributes > 0) {
      const tradeCheck = evaluateTributeTrade(card, fieldState, actualTributes, { oppField: oppFieldState });
      if (!tradeCheck.ok) {
        return { yes: false, reason: tradeCheck.reason };
      }
    }
    return {
      yes: true,
      position: "attack",
      priority: 8,
      reason: `Majestic Silver 2500 ATK + position switch effect`,
    };
  }

  // ── Darkness Dragon ────────────────────────────────────────────────────────
  if (name === "Darkness Dragon") {
    const actualTributes = tributeInfo.tributesNeeded;
    if (actualTributes > fieldState.length) {
      return {
        yes: false,
        reason: `Darkness Dragon: needs ${actualTributes} tributes, have ${fieldState.length}`,
      };
    }

    // Situational only: only summon if it's the sole way to surpass opponent ATK
    const fieldMonsters = fieldState.filter((c) => c && c.cardKind === "monster");
    const dragonsToDestroy = fieldMonsters.filter((c) => c && (c.type === "Dragon" || c.cardKind === "monster"));
    const atksGained = dragonsToDestroy.reduce((sum, c) => sum + (c.atk || 0), 0);
    const estimatedFinalATK = 2000 + dragonsToDestroy.length * 300;

    // Only worthwhile if we destroy enough to power up AND surpass the threat
    if (dragonsToDestroy.length === 0) {
      // No other dragons to destroy — just a vanilla 2000 ATK
      if (oppStrongestATK >= 2000) {
        return { yes: false, reason: "Darkness Dragon: no dragons to destroy, 2000 ATK loses to threat" };
      }
      return {
        yes: true,
        position: "attack",
        priority: 5,
        reason: "Darkness Dragon: 2000 ATK (no field dragons to sacrifice)",
      };
    }

    // Check if powered-up Darkness Dragon would beat the opponent's strongest
    if (estimatedFinalATK > oppStrongestATK) {
      return {
        yes: true,
        position: "attack",
        priority: 9,
        reason: `Darkness Dragon: destroy ${dragonsToDestroy.length} dragons → ~${estimatedFinalATK} ATK (beats ${oppStrongestATK})`,
      };
    }

    return {
      yes: false,
      reason: `Darkness Dragon: ~${estimatedFinalATK} ATK won't beat opponent's ${oppStrongestATK} ATK (not worth destroying field)`,
    };
  }

  // ── Generic monster logic ──────────────────────────────────────────────────
  const actualTributes = tributeInfo.tributesNeeded;
  if (actualTributes > fieldState.length) {
    return { yes: false, reason: `Needs ${actualTributes} tributes, only have ${fieldState.length}` };
  }

  if (actualTributes > 0) {
    const tradeCheck = evaluateTributeTrade(card, fieldState, actualTributes, { oppField: oppFieldState });
    if (!tradeCheck.ok) {
      return { yes: false, reason: tradeCheck.reason };
    }
  }

  if (isSuicideSummon) {
    if (shouldDefend) {
      return {
        yes: true,
        position: "defense",
        priority: 3,
        reason: `${cardDEF} DEF vs opp ${oppStrongestATK} ATK — defense`,
      };
    }
    if (actualTributes === 0 && cardATK >= 1500) {
      return {
        yes: true,
        position: "defense",
        priority: 3,
        reason: `${cardATK} ATK vs opp ${oppStrongestATK} ATK — set for defense`,
      };
    }
    return { yes: false, reason: `${cardATK} ATK vs opp ${oppStrongestATK} ATK — suicide` };
  }

  if (cardATK >= 1500 && actualTributes === 0) {
    return { yes: true, position: "attack", priority: 5, reason: `${cardATK} ATK beater` };
  }

  if (actualTributes > 0 && actualTributes <= fieldState.length) {
    return {
      yes: true,
      position: "attack",
      priority: 5,
      reason: `Tribute Summon ${cardATK} ATK`,
    };
  }

  if (cardATK < 1500 && actualTributes === 0) {
    return { yes: true, position: "defense", priority: 2, reason: "Small monster in defense" };
  }

  return { yes: false, reason: "Not worth summoning now" };
}

/**
 * Calculates tribute requirement for a Dragon deck card.
 * Handles altTribute: { requiresType, tributes } pattern.
 * @param {Object} card
 * @param {Object} playerState
 * @returns {{ tributesNeeded: number, usingAlt: boolean, alt: Object|null }}
 */
export function getTributeRequirementFor(card, playerState) {
  let tributesNeeded = 0;
  const level = card.level || 0;

  if (level >= 5 && level <= 6) tributesNeeded = 1;
  else if (level >= 7) tributesNeeded = 2;

  if (
    typeof card.requiredTributes === "number" &&
    card.requiredTributes >= 0
  ) {
    tributesNeeded = card.requiredTributes;
  }

  const alt = card.altTribute;

  // Standard alt: no tribute if empty field
  if (alt?.type === "no_tribute_if_empty_field" && (playerState.field?.length || 0) === 0) {
    return { tributesNeeded: 0, usingAlt: true, alt };
  }

  // Dragon-style alt: { requiresType: "Dragon", tributes: N }
  // Majestic Silver Dragon: can use 1 Dragon tribute instead of 2 normal
  if (alt?.requiresType && typeof alt?.tributes === "number") {
    const field = playerState.field || [];
    const hasRequiredType = field.some(
      (c) => c && c.type === alt.requiresType && c.cardKind === "monster"
    );
    if (hasRequiredType && alt.tributes < tributesNeeded) {
      return { tributesNeeded: alt.tributes, usingAlt: true, alt };
    }
  }

  return { tributesNeeded, usingAlt: false, alt };
}

/**
 * Selects best tribute indices from field for Dragon deck.
 * Avoids tributing high-value cards like Extreme Dragons.
 * @param {Array} field
 * @param {number} tributesNeeded
 * @param {Object} [cardToSummon]
 * @returns {number[]}
 */
export function selectBestTributes(field, tributesNeeded, cardToSummon = null) {
  if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) return [];

  const monstersWithValue = field.map((monster, index) => {
    const value = getTributeValue(monster);
    return { monster, index, value };
  });

  monstersWithValue.sort((a, b) => a.value - b.value);
  return monstersWithValue.slice(0, tributesNeeded).map((t) => t.index);
}

function getTributeValue(monster) {
  if (!monster) return 0;
  let value = (monster.atk || 0) / 400;
  value += (monster.level || 0) * 0.15;

  // Extreme Dragons: never tribute if possible
  if (isExtremeDragon(monster)) value += 200;

  // Boss monsters: avoid tributing
  const knowledge = CARD_KNOWLEDGE[monster.name];
  if (knowledge?.role === "boss" || knowledge?.role === "win_condition") value += 100;
  if (knowledge?.role === "ascension_boss" || knowledge?.role === "fusion_boss") value += 80;

  // Good to tribute — small low-value monsters
  if (monster.name === "Voltaic Dragon") value -= 3;
  if (monster.name === "Boneflame Dragon") value -= 2;
  if (monster.isToken || monster.name?.includes("Token")) value -= 10;

  // Already attacked monsters are slightly less valuable
  if (monster.hasAttacked) value -= 2;

  return value;
}

/**
 * Evaluates if a tribute trade is worthwhile.
 * @param {Object} cardToSummon
 * @param {Array} field
 * @param {number} tributesNeeded
 * @param {Object} [context]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluateTributeTrade(cardToSummon, field, tributesNeeded, context = {}) {
  if (!cardToSummon || tributesNeeded <= 0) return { ok: true };

  const fieldMonsters = (field || []).filter(
    (c) => c && c.cardKind !== "spell" && c.cardKind !== "trap"
  );
  if (fieldMonsters.length < tributesNeeded) {
    return { ok: false, reason: "Insufficient tributes" };
  }

  const tributeIndices = selectBestTributes(fieldMonsters, tributesNeeded, cardToSummon);
  if (tributeIndices.length < tributesNeeded) {
    return { ok: false, reason: "No valid tributes" };
  }

  const tributes = tributeIndices.map((i) => fieldMonsters[i]).filter(Boolean);

  // Never tribute an Extreme Dragon
  const hasExtremeTribute = tributes.some((m) => isExtremeDragon(m));
  if (hasExtremeTribute) {
    return { ok: false, reason: "Would tribute Extreme Dragon (preserve for Bahamut)" };
  }

  const tributeCost = tributes.reduce((sum, m) => sum + getTributeValue(m), 0);
  const summonValue = getTributeValue(cardToSummon);
  const costDelta = tributeCost - summonValue;
  const costRatio = tributeCost / Math.max(1, summonValue);

  const summonKnowledge = CARD_KNOWLEDGE[cardToSummon?.name];
  const summonIsBoss =
    summonKnowledge?.role === "boss" ||
    summonKnowledge?.role === "win_condition" ||
    summonKnowledge?.role === "fusion_boss";

  // Don't tribute a boss for a non-boss
  const tributeHasBoss = tributes.some((m) => {
    const k = CARD_KNOWLEDGE[m.name];
    return k?.role === "boss" || k?.role === "win_condition" || k?.role === "fusion_boss";
  });
  if (tributeHasBoss && !summonIsBoss) {
    return { ok: false, reason: "Not worth tributing boss for weaker monster" };
  }

  if (costDelta >= 20 && costRatio >= 1.4) {
    return { ok: false, reason: "Tribute cost too high for value gained" };
  }

  return { ok: true };
}
