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
    score += lpDiff / 600; // 3600 LP diff = +6.0 score (mais agressivo)

    // Lethal proximity bonuses (incentivo para fechar o jogo)
    if ((opponent?.lp || 0) <= 2000) score += 3.5;
    else if ((opponent?.lp || 0) <= 3000) score += 2.0;
    else if ((opponent?.lp || 0) <= 4000) score += 0.8;

    // Danger penalties (reduzidas para evitar defensividade excessiva)
    if ((perspective?.lp || 0) <= 1500) score -= 2.5;
    else if ((perspective?.lp || 0) <= 3000) score -= 1.2;
    else if ((perspective?.lp || 0) <= 5000) score -= 0.4;

    // === 2. FIELD PRESENCE — Usando threat score ===
    const myField = perspective?.field || [];
    const oppField = opponent?.field || [];

    const context = {
      myStrongestAtk: Math.max(
        ...myField.map((m) => (m?.atk || 0) + (m?.tempAtkBoost || 0)),
        0,
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
      isAdvantageEngine(c),
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
      (c) => c?.cardKind === "monster" && inferRole(c) !== "beater",
    ).length;
    score += recursionTargets * 0.15; // GY com alvos = recurso futuro

    // === 7. READY ATTACKERS — Bônus para monstros prontos para atacar ===
    const readyAttackers = myField.filter(
      (m) =>
        m?.position === "attack" && !m?.hasAttacked && !m?.cannotAttackThisTurn,
    );
    for (const attacker of readyAttackers) {
      const atkValue =
        ((attacker?.atk || 0) + (attacker?.tempAtkBoost || 0)) / 1200;
      score += atkValue * 0.6; // 3000 ATK = +1.5 score
      // Bônus se oponente tem campo vazio (direct attack potential)
      if (oppField.length === 0) {
        score += atkValue * 0.4;
      }
    }

    // === 8. LETHAL CHECK ===
    if (canOpponentLethal(oppField, perspective?.lp || 8000)) {
      score -= 6.0; // DANGER CRITICAL (aumentado)
    }

    // === 9. TEMPO — Campo vazio = vulnerável ===
    if (myField.length === 0 && oppField.length > 0) {
      score -= 2.0; // Mais penalidade (era 1.5)
    }
    if (oppField.length === 0 && myField.length > 0) {
      score += 1.5; // Mais bônus para controle de tabuleiro (era 1.0)
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
   * Gera ações de troca de posição quando houver vantagem clara.
   * @param {Object} game
   * @param {Object} bot
   * @param {Object} opponent
   * @returns {Array}
   */
  getPositionChangeActions(game, bot, opponent) {
    const actions = [];
    if (!bot || !opponent) return actions;

    const oppField = Array.isArray(opponent.field) ? opponent.field : [];
    const estimateOpponentStat = (card) => {
      if (!card || card.cardKind !== "monster") return 0;
      if (card.isFacedown) return 1500;
      const atk =
        (card.atk || 0) + (card.tempAtkBoost || 0) + (card.equipAtkBonus || 0);
      const def =
        (card.def || 0) + (card.tempDefBoost || 0) + (card.equipDefBonus || 0);
      return card.position === "attack" ? atk : def;
    };

    const strongestOpponentStat = oppField.reduce((max, card) => {
      const stat = estimateOpponentStat(card);
      return Math.max(max, stat);
    }, 0);

    const canChangePosition = (card) => {
      if (!card || card.cardKind !== "monster") return false;
      if (typeof game?.canChangePosition === "function") {
        return game.canChangePosition(card);
      }
      const turnCounter = game?.turnCounter ?? 0;
      if (card.isFacedown) return false;
      if (card.positionChangedThisTurn) return false;
      if (card.summonedTurn && turnCounter <= card.summonedTurn) return false;
      if (card.hasAttacked) return false;
      return true;
    };

    for (const card of bot.field || []) {
      if (!card || card.cardKind !== "monster") continue;
      if (!canChangePosition(card)) continue;

      const atk =
        (card.atk || 0) + (card.tempAtkBoost || 0) + (card.equipAtkBonus || 0);
      const def =
        (card.def || 0) + (card.tempDefBoost || 0) + (card.equipDefBonus || 0);

      if (card.position === "defense") {
        if (card.cannotAttackThisTurn) continue;
        const hasNoOpponents = oppField.length === 0;
        const advantage = atk - strongestOpponentStat;
        const canPressure = hasNoOpponents || advantage >= 100;
        if (!canPressure) continue;

        const priorityBase = hasNoOpponents ? 2.2 : 1.6;
        const priority = Math.max(
          0.5,
          priorityBase + Math.min(2, Math.max(-0.5, advantage / 1000)),
        );

        actions.push({
          type: "position_change",
          cardId: card.id,
          cardName: card.name,
          toPosition: "attack",
          priority,
        });
        continue;
      }

      if (card.position === "attack") {
        if (oppField.length === 0) continue;
        const threatened = atk + 50 < strongestOpponentStat;
        const canHoldDefense = def >= strongestOpponentStat + 50;
        const prefersDefense = def > atk + 200;
        if (!threatened || (!canHoldDefense && !prefersDefense)) continue;

        const priorityBase = canHoldDefense ? 1.4 : 1.1;
        const safetyDelta = def - strongestOpponentStat;
        const priority = Math.max(
          0.4,
          priorityBase + Math.min(1.5, Math.max(-0.3, safetyDelta / 1200)),
        );

        actions.push({
          type: "position_change",
          cardId: card.id,
          cardName: card.name,
          toPosition: "defense",
          priority,
        });
      }
    }

    return actions;
  }

  /**
   * Retorna o oponente do jogador perspectiva.
   * @param {Object} gameOrState
   * @param {Object} perspectivePlayer
   * @returns {Object} - Oponente
   */
  getOpponent(gameOrState, perspectivePlayer) {
    if (!gameOrState || !perspectivePlayer) {
      console.warn("[BaseStrategy] getOpponent: invalid args", {
        gameOrState: !!gameOrState,
        perspectivePlayer: !!perspectivePlayer,
      });
      return null;
    }

    // Se é o bot, oponente é player
    const isBot =
      perspectivePlayer.id === "bot" || perspectivePlayer === gameOrState.bot;
    const opponent = isBot ? gameOrState.player : gameOrState.bot;

    if (!opponent) {
      console.warn("[BaseStrategy] getOpponent: opponent not found", {
        perspective: perspectivePlayer.id,
        gameState: { player: !!gameOrState.player, bot: !!gameOrState.bot },
      });
    }

    return opponent || null;
  }
}
