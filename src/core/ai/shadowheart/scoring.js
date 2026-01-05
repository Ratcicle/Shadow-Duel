// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/scoring.js
// Funções de avaliação e scoring específicas para Shadow-Heart.
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_KNOWLEDGE, isShadowHeart } from "./knowledge.js";

/**
 * Avalia um monstro individual para scoring de board.
 * @param {Object} monster
 * @param {Object} owner
 * @param {Object} opponent
 * @returns {number}
 */
export function evaluateMonster(monster, owner, opponent) {
  if (!monster) return 0;

  const knowledge = CARD_KNOWLEDGE[monster.name];
  let value = knowledge?.value || 0;

  // Valor base de stats
  const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
  const def = (monster.def || 0) + (monster.tempDefBoost || 0);
  const stat = monster.position === "defense" ? def : atk;
  value += stat / 800;
  value += (monster.level || 0) * 0.1;

  // Bônus Shadow-Heart
  if (isShadowHeart(monster)) {
    value += 0.5;

    // Bônus específicos
    if (monster.name === "Shadow-Heart Scale Dragon") value += 3;
    if (monster.name === "Shadow-Heart Demon Dragon") value += 4;
    if (monster.name === "Shadow-Heart Demon Arctroth") value += 2;
    if (monster.name === "Shadow-Heart Imp") value += 1;
    if (monster.name === "Shadow-Heart Gecko") value += 0.5;
    if (monster.name === "Shadow-Heart Leviathan") value += 1;
    if (monster.name === "Shadow-Heart Death Wyrm") value += 1.5;
  }

  // Penalidades
  if (monster.cannotAttackThisTurn) value -= 0.5;
  if (monster.hasAttacked) value -= 0.2;

  // Bônus de proteção
  if (monster.battleIndestructible) value += 1;
  if (monster.mustBeAttacked) value += 0.5;

  // Vulnerabilidade
  if (monster.position === "attack") {
    const canBeDestroyed = (opponent?.field || []).some(
      (opp) =>
        opp.position === "attack" && (opp.atk || 0) > (monster.atk || 0)
    );
    if (canBeDestroyed) value -= 0.5;
  }

  return value;
}

/**
 * Avalia o tabuleiro completo do ponto de vista Shadow-Heart.
 * @param {Object} gameOrState
 * @param {Object} perspectivePlayer
 * @param {Function} getOpponent - Função para resolver oponente
 * @returns {number}
 */
export function evaluateBoardShadowHeart(gameOrState, perspectivePlayer, getOpponent) {
  const opponent = getOpponent(gameOrState, perspectivePlayer);
  const perspective = perspectivePlayer.id
    ? perspectivePlayer
    : gameOrState.bot;

  let score = 0;

  // === AVALIAÇÃO DE LP ===
  const lpDiff = perspective.lp - opponent.lp;
  score += lpDiff / 600;

  // Bônus por estar perto de vencer
  if (opponent.lp <= 3000) score += 2;
  if (opponent.lp <= 1500) score += 3;

  // Penalidade por estar em perigo
  if (perspective.lp <= 2000) score -= 1;
  if (perspective.lp <= 1000) score -= 2;

  // === AVALIAÇÃO DE CAMPO ===
  for (const monster of perspective.field) {
    score += evaluateMonster(monster, perspective, opponent);
  }

  for (const monster of opponent.field) {
    score -= evaluateMonster(monster, opponent, perspective) * 0.9;
  }

  // === AVALIAÇÃO DE FIELD SPELL ===
  if (perspective.fieldSpell) {
    if (perspective.fieldSpell.name === "Darkness Valley") {
      const shCount = perspective.field.filter((m) =>
        isShadowHeart(m)
      ).length;
      score += 1.5 + shCount * 0.3;
    } else {
      score += 1;
    }
  }
  if (opponent.fieldSpell) score -= 0.8;

  // === AVALIAÇÃO DE RECURSOS ===
  const handAdvantage =
    (perspective.hand?.length || 0) - (opponent.hand?.length || 0);
  score += handAdvantage * 0.4;

  // Bônus por ter revivers/searchers na mão
  const hasKeySpells = (perspective.hand || []).some((c) =>
    [
      "Shadow-Heart Infusion",
      "Shadow-Heart Covenant",
      "Polymerization",
      "Monster Reborn",
    ].includes(c.name)
  );
  if (hasKeySpells) score += 0.5;

  // === AVALIAÇÃO DE GY ===
  const shInGY = (perspective.graveyard || []).filter(
    (c) => isShadowHeart(c) && c.cardKind === "monster"
  );
  if (shInGY.length > 0) {
    const bestATK = Math.max(...shInGY.map((c) => c.atk || 0));
    score += bestATK / 3000;
  }

  // === AVALIAÇÃO DE BACKROW ===
  score += (perspective.spellTrap?.length || 0) * 0.2;
  score -= (opponent.spellTrap?.length || 0) * 0.25;

  // === AVALIAÇÃO DE PRESSÃO ===
  const readyAttackers = perspective.field.filter(
    (m) =>
      m.position === "attack" && !m.hasAttacked && !m.cannotAttackThisTurn
  );
  for (const attacker of readyAttackers) {
    if (opponent.field.length === 0) {
      score += (attacker.atk || 0) / 1500;
    }
    const canDestroy = opponent.field.some(
      (def) =>
        def.position === "attack" && (def.atk || 0) < (attacker.atk || 0)
    );
    if (canDestroy) score += 0.3;
  }

  return score;
}
