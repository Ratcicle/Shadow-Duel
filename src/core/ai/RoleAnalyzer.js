// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/RoleAnalyzer.js
// Role inference system — analisa metadados de Card para inferir papel estratégico
// SEM HARDCODING de nomes. Genérico para qualquer deck/archetype.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infere o papel estratégico de uma carta baseado em seus efeitos.
 * @param {Object} card - A carta a analisar
 * @returns {string} - Role: "extender", "removal", "searcher", "draw_engine",
 *                     "recursion", "combat_buff", "debuff", "protection",
 *                     "payoff", "disruption", "beater", "unknown"
 */
export function inferRole(card) {
  if (!card) return "unknown";

  // Monstros sem efeitos = beaters
  if (
    card.cardKind === "monster" &&
    (!card.effects || card.effects.length === 0)
  ) {
    return "beater";
  }

  const roles = [];
  const effects = Array.isArray(card.effects) ? card.effects : [];

  for (const effect of effects) {
    const actions = Array.isArray(effect.actions) ? effect.actions : [];
    const timing = effect.timing;
    const event = effect.event;

    for (const action of actions) {
      const type = action.type;

      // EXTENDER: special summon from hand/deck/gy
      if (type === "special_summon_from_zone") {
        if (
          timing === "on_play" ||
          (timing === "on_event" && event === "after_summon")
        ) {
          roles.push("extender");
        }
      }

      // REMOVAL: destroy opponent's cards
      if (type === "destroy" && action.targetRef) {
        roles.push("removal");
      }

      // SEARCHER: add from deck to hand
      if (type === "search_any" || type === "add_from_zone_to_hand") {
        if (action.zone === "deck" || !action.zone) {
          roles.push("searcher");
        }
      }

      // DRAW ENGINE: draw cards
      if (type === "draw" && action.player !== "opponent") {
        if (timing === "on_event") {
          roles.push("draw_engine");
        } else {
          roles.push("searcher"); // spell que dá draw = searcher também
        }
      }

      // RECURSION: recover from GY
      if (type === "add_from_zone_to_hand" && action.zone === "graveyard") {
        roles.push("recursion");
      }
      if (
        type === "special_summon_from_zone" &&
        (action.zone === "graveyard" || action.sourceZone === "graveyard")
      ) {
        roles.push("recursion");
      }

      // COMBAT BUFF: boost stats
      if (
        type === "buff_stats_temp" ||
        type === "buff_atk_temp" ||
        type === "modify_stats_temp"
      ) {
        if (action.targetRef || action.player === "self") {
          roles.push("combat_buff");
        }
      }

      // DEBUFF: reduce opponent stats
      if (type === "modify_stats_temp") {
        const atkFactor = Number.isFinite(action.atkFactor)
          ? action.atkFactor
          : 1;
        const defFactor = Number.isFinite(action.defFactor)
          ? action.defFactor
          : 1;
        if (atkFactor < 1 || defFactor < 1) {
          roles.push("debuff");
        }
      }

      // PROTECTION: equip, grant immunity
      if (type === "equip" && action.battleIndestructible) {
        roles.push("protection");
      }

      // DISRUPTION: opponent targeting effects
      if (type === "damage" && action.player === "opponent") {
        roles.push("disruption");
      }
    }

    // PAYOFF: passive effects with archetype filters
    if (timing === "passive") {
      roles.push("payoff");
    }
  }

  // Prioritize most specific roles
  if (roles.includes("removal")) return "removal";
  if (roles.includes("extender")) return "extender";
  if (roles.includes("searcher")) return "searcher";
  if (roles.includes("draw_engine")) return "draw_engine";
  if (roles.includes("recursion")) return "recursion";
  if (roles.includes("combat_buff")) return "combat_buff";
  if (roles.includes("debuff")) return "debuff";
  if (roles.includes("protection")) return "protection";
  if (roles.includes("disruption")) return "disruption";
  if (roles.includes("payoff")) return "payoff";

  return roles.length > 0 ? roles[0] : "beater";
}

/**
 * Retorna TODOS os papéis que uma carta pode ter.
 * @param {Object} card
 * @returns {string[]}
 */
export function inferAllRoles(card) {
  if (!card) return [];

  const roles = new Set();
  const effects = Array.isArray(card.effects) ? card.effects : [];

  if (card.cardKind === "monster" && effects.length === 0) {
    roles.add("beater");
  }

  for (const effect of effects) {
    const actions = Array.isArray(effect.actions) ? effect.actions : [];
    const timing = effect.timing;
    const event = effect.event;

    for (const action of actions) {
      const type = action.type;

      if (type === "special_summon_from_zone") {
        if (
          timing === "on_play" ||
          (timing === "on_event" && event === "after_summon")
        ) {
          roles.add("extender");
        }
      }
      if (type === "destroy" && action.targetRef) {
        roles.add("removal");
      }
      if (
        type === "search_any" ||
        (type === "add_from_zone_to_hand" && action.zone === "deck")
      ) {
        roles.add("searcher");
      }
      if (type === "draw" && timing === "on_event") {
        roles.add("draw_engine");
      }
      if (type === "add_from_zone_to_hand" && action.zone === "graveyard") {
        roles.add("recursion");
      }
      if (type === "buff_stats_temp" || type === "buff_atk_temp") {
        roles.add("combat_buff");
      }
      if (type === "modify_stats_temp") {
        const atkFactor = Number.isFinite(action.atkFactor)
          ? action.atkFactor
          : 1;
        if (atkFactor < 1) roles.add("debuff");
      }
      if (type === "equip") {
        roles.add("protection");
      }
    }

    if (timing === "passive") {
      roles.add("payoff");
    }
  }

  return Array.from(roles);
}

/**
 * Calcula a "urgência" de um efeito (quão rápido ele pode ser ativado).
 * @param {Object} effect - Um effect da carta
 * @returns {number} - 0.0 (não urgente) a 1.0 (imediato)
 */
export function calculateEffectUrgency(effect) {
  if (!effect) return 0;

  const timing = effect.timing;
  const event = effect.event;

  // Passive = sempre ativo
  if (timing === "passive") return 1.0;

  // on_event com after_summon = ativa imediatamente
  if (timing === "on_event" && event === "after_summon") return 0.9;

  // on_play = ativa quando jogado
  if (timing === "on_play") return 0.7;

  // on_event com battle_destroy = condicional
  if (timing === "on_event" && event === "battle_destroy") return 0.5;

  // ignition = player controlled
  if (timing === "ignition") return 0.4;

  return 0.3;
}

/**
 * Calcula o impacto de uma ação no jogo.
 * @param {Object} action - Uma action da carta
 * @returns {number} - Impacto estimado (0.0 a 2.0+)
 */
export function calculateActionImpact(action) {
  if (!action || !action.type) return 0;

  const type = action.type;

  // High impact
  if (type === "draw") return 0.5 * (action.amount || 1);
  if (type === "search_any") return 0.5;
  if (type === "destroy") return 0.7;
  if (type === "special_summon_from_zone") return 0.6;

  // Medium impact
  if (type === "add_from_zone_to_hand") return 0.4;
  if (type === "buff_stats_temp" || type === "buff_atk_temp") return 0.3;
  if (type === "heal") return (action.amount || 0) / 2000;

  // Low impact
  if (type === "damage") return (action.amount || 0) / 1500;
  if (type === "modify_stats_temp") return 0.25;

  return 0.1;
}

/**
 * Determina se uma carta é um "gerador de vantagem" (card advantage engine).
 * @param {Object} card
 * @returns {boolean}
 */
export function isAdvantageEngine(card) {
  const role = inferRole(card);
  return ["searcher", "draw_engine", "extender", "recursion"].includes(role);
}

/**
 * Determina se uma carta é "proativa" (faz algo imediatamente).
 * @param {Object} card
 * @returns {boolean}
 */
export function isProactive(card) {
  const effects = Array.isArray(card.effects) ? card.effects : [];
  for (const effect of effects) {
    if (effect.timing === "on_play") return true;
    if (effect.timing === "on_event" && effect.event === "after_summon")
      return true;
  }
  return false;
}

/**
 * Determina se uma carta é "reativa" (responde a eventos).
 * @param {Object} card
 * @returns {boolean}
 */
export function isReactive(card) {
  const effects = Array.isArray(card.effects) ? card.effects : [];
  for (const effect of effects) {
    if (effect.timing === "on_event" && effect.event !== "after_summon")
      return true;
    if (card.cardKind === "trap") return true;
  }
  return false;
}
