import {
  calculateThreatScore,
  rankOpponentThreats,
  calculateResourceValue,
  canOpponentLethal,
} from "./ThreatEvaluation.js";
import { inferRole, isAdvantageEngine } from "./RoleAnalyzer.js";
import { estimateMonsterValue, estimateCardValue } from "./StrategyUtils.js";

export default class BaseStrategy {
  constructor(bot) {
    this.bot = bot;
  }

  // Evaluate board state from the bot's perspective (LEGACY)
  evaluateBoard(_gameOrState, _perspectivePlayer) {
    return 0;
  }

  /**
   * evaluateBoardV2 — Nova avaliação contextual usando threat scoring.
   * @param {Object} gameOrState
   * @param {Object} perspectivePlayer
   * @returns {number} - Score da posição (positivo = vantagem, negativo = desvantagem)
   */
  evaluateBoardV2(gameOrState, perspectivePlayer) {
    const perspective = perspectivePlayer?.id
      ? perspectivePlayer
      : gameOrState.bot;
    const opponent = this.getOpponent(gameOrState, perspective);

    let score = 0;

    // === 1. LP ADVANTAGE ===
    const lpDiff = (perspective?.lp || 0) - (opponent?.lp || 0);
    score += lpDiff / 800; // 3200 LP diff = +4.0 score

    // Lethal proximity bonuses
    if ((opponent?.lp || 0) <= 2000) score += 2.5;
    else if ((opponent?.lp || 0) <= 4000) score += 1.0;

    // Danger penalties
    if ((perspective?.lp || 0) <= 2000) score -= 2.0;
    else if ((perspective?.lp || 0) <= 4000) score -= 0.8;

    // === 2. FIELD PRESENCE — Usando threat score ===
    const myField = perspective?.field || [];
    const oppField = opponent?.field || [];

    const context = {
      myStrongestAtk: Math.max(
        ...myField.map((m) => (m?.atk || 0) + (m?.tempAtkBoost || 0)),
        0
      ),
      hasDefenses: myField.some((m) => m?.position === "defense"),
      myArchetype: this.getMainArchetype(perspective),
      myLP: perspective?.lp || 8000,
      oppLP: opponent?.lp || 8000,
    };

    // Minhas ameaças ofensivas
    for (const monster of myField) {
      if (!monster || monster.cardKind !== "monster") continue;
      const value = this.evaluateMyMonster(monster, context);
      score += value;
    }

    // Ameaças do oponente (NEGATIVO para mim)
    const oppThreats = rankOpponentThreats(oppField, context);
    for (const { card, threatScore } of oppThreats) {
      score -= threatScore * 0.85; // Peso menor que meus monstros
    }

    // === 3. HAND ADVANTAGE ===
    const myHand = perspective?.hand || [];
    const oppHand = opponent?.hand || [];
    const handDiff = myHand.length - oppHand.length;
    score += handDiff * 0.5;

    // Hand quality (geradores de vantagem = +bônus)
    const myAdvantageEngines = myHand.filter((c) =>
      isAdvantageEngine(c)
    ).length;
    score += myAdvantageEngines * 0.4;

    // === 4. FIELD SPELL ===
    if (perspective?.fieldSpell) {
      score += 1.2;
      // Se combina com meu arquétipo
      const myArchetype = this.getMainArchetype(perspective);
      if (myArchetype && perspective.fieldSpell.archetype === myArchetype) {
        score += 0.5;
      }
    }
    if (opponent?.fieldSpell) {
      score -= 1.0;
    }

    // === 5. BACKROW (traps/continuous spells) ===
    const myBackrow = perspective?.spellTrap || [];
    const oppBackrow = opponent?.spellTrap || [];
    score += myBackrow.length * 0.25;
    score -= oppBackrow.length * 0.3; // Backrow oponente = ameaça de interrupção

    // === 6. GRAVEYARD RESOURCES ===
    const myGY = perspective?.graveyard || [];
    const recursionTargets = myGY.filter(
      (c) => c?.cardKind === "monster" && inferRole(c) !== "beater"
    ).length;
    score += recursionTargets * 0.15; // GY com alvos = recurso futuro

    // === 7. LETHAL CHECK ===
    if (canOpponentLethal(oppField, perspective?.lp || 8000)) {
      score -= 5.0; // DANGER CRITICAL
    }

    // === 8. TEMPO — Campo vazio = vulnerável ===
    if (myField.length === 0 && oppField.length > 0) {
      score -= 1.5;
    }
    if (oppField.length === 0 && myField.length > 0) {
      score += 1.0; // Controle do tabuleiro
    }

    return score;
  }

  /**
   * Avalia um monstro meu no contexto atual.
   * @param {Object} monster
   * @param {Object} context
   * @returns {number}
   */
  evaluateMyMonster(monster, context) {
    if (!monster) return 0;

    let value = 0;

    // Base stats
    const atk =
      (monster.atk || 0) +
      (monster.tempAtkBoost || 0) +
      (monster.equipAtkBonus || 0);
    const def =
      (monster.def || 0) +
      (monster.tempDefBoost || 0) +
      (monster.equipDefBonus || 0);
    const stat = monster.position === "defense" ? def : atk;
    value += stat / 900;
    value += (monster.level || 0) * 0.1;

    // Role-based bonuses
    const role = inferRole(monster);
    if (isAdvantageEngine(monster)) {
      value += 1.0; // Geradores no campo = muito bom
    }
    if (role === "removal") {
      value += 0.6;
    }

    // Combat readiness
    if (
      monster.position === "attack" &&
      !monster.hasAttacked &&
      !monster.cannotAttackThisTurn
    ) {
      value += 0.4; // Pronto para atacar

      // Pode atacar diretamente?
      if (context.oppField?.length === 0 || monster.canAttackDirectlyThisTurn) {
        value += atk / 1500; // Direto ao LP = muito valor
      }
    }

    // Protection
    if (monster.battleIndestructible || monster.tempBattleIndestructible) {
      value += 0.8;
    }

    // Penalties
    if (monster.cannotAttackThisTurn) value -= 0.4;
    if (monster.hasAttacked) value -= 0.2;
    if (monster.isFacedown) value *= 0.7;

    return value;
  }

  /**
   * Detecta o arquétipo principal do player (mais comum no deck/campo).
   * @param {Object} player
   * @returns {string|null}
   */
  getMainArchetype(player) {
    if (!player) return null;

    const allCards = [
      ...(player.field || []),
      ...(player.hand || []),
      ...(player.graveyard || []),
    ];

    const archetypeCounts = {};
    for (const card of allCards) {
      if (!card) continue;
      const archetypes = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
        ? [card.archetype]
        : [];

      for (const arch of archetypes) {
        archetypeCounts[arch] = (archetypeCounts[arch] || 0) + 1;
      }
    }

    let maxCount = 0;
    let mainArch = null;
    for (const [arch, count] of Object.entries(archetypeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        mainArch = arch;
      }
    }

    return mainArch;
  }

  // Generate candidate main-phase actions
  generateMainPhaseActions(_game) {
    return [];
  }

  // Order actions (optional)
  sequenceActions(actions) {
    return actions;
  }

  // Simulate a main-phase action on a cloned state
  simulateMainPhaseAction(state, action) {
    return state;
  }

  // Hook to simulate a specific spell effect inside the cloned state
  simulateSpellEffect(_state, _card) {}

  placeSpellCard(state, card) {
    if (!state || !card) return { placed: false, zone: null };
    const player = state.bot;
    if (!player) return { placed: false, zone: null };

    if (card.subtype === "field") {
      if (player.fieldSpell) {
        player.graveyard.push(player.fieldSpell);
      }
      player.fieldSpell = { ...card };
      return { placed: true, zone: "fieldSpell" };
    }

    if (card.subtype === "continuous" || card.subtype === "equip") {
      player.spellTrap = player.spellTrap || [];
      player.spellTrap.push({ ...card });
      return { placed: true, zone: "spellTrap" };
    }

    return { placed: false, zone: null };
  }

  // Tribute requirement helper (can be overridden)
  getTributeRequirementFor(card, playerState) {
    let tributesNeeded = 0;
    if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
    else if (card.level >= 7) tributesNeeded = 2;
    return { tributesNeeded, usingAlt: false, alt: null };
  }

  // Pick tribute indices from field
  selectBestTributes(_field, _tributesNeeded, _cardToSummon) {
    return [];
  }

  /**
   * Retorna o oponente do jogador perspectiva.
   * @param {Object} gameOrState
   * @param {Object} perspectivePlayer
   * @returns {Object} - Oponente
   */
  getOpponent(gameOrState, perspectivePlayer) {
    if (!gameOrState || !perspectivePlayer) return null;

    // Se é o bot, oponente é player
    if (
      perspectivePlayer.id === "bot" ||
      perspectivePlayer === gameOrState.bot
    ) {
      return gameOrState.player;
    }

    // Se é o player, oponente é bot
    return gameOrState.bot;
  }
}
