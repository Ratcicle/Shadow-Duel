// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/ShadowHeartStrategy.js
// Estratégia Shadow-Heart — Fachada que orquestra os módulos especializados.
//
// FILOSOFIA DO ARQUÉTIPO SHADOW-HEART:
// - Agressivo com monstros de alto ATK
// - Sinergia através de tributos e efeitos de GY
// - Boss principal: Shadow-Heart Scale Dragon (3000 ATK, recupera recursos)
// - Fusion boss: Shadow-Heart Demon Dragon (3000 ATK, destrói 2 cartas)
// - Suporte: Imp (special summon), Specter (recicla GY), Eel (burn + Leviathan)
// - Field spell: Darkness Valley (+300 ATK para Shadow-Heart)
// ─────────────────────────────────────────────────────────────────────────────

import BaseStrategy from "./BaseStrategy.js";
import {
  detectLethalOpportunity,
  detectDefensiveNeed,
  detectComeback,
  decideMacroStrategy,
  calculateMacroPriorityBonus,
} from "./MacroPlanning.js";
import {
  evaluateActionBlockingRisk,
  assessActionSafety,
} from "./ChainAwareness.js";
import {
  gameTreeSearch,
  shouldUseGameTreeSearch,
  estimateSearchComplexity,
} from "./GameTreeSearch.js";
import {
  analyzeOpponent,
  estimateTurnsToOppLethal,
} from "./OpponentPredictor.js";

// Módulos Shadow-Heart refatorados
import {
  CARD_KNOWLEDGE,
  isShadowHeart,
  isShadowHeartByName,
} from "./shadowheart/knowledge.js";
import { COMBO_DATABASE, detectAvailableCombos } from "./shadowheart/combos.js";
import {
  shouldPlaySpell,
  shouldSummonMonster,
  selectBestTributes,
  getTributeRequirementFor,
} from "./shadowheart/priorities.js";
import {
  evaluateMonster,
  evaluateBoardShadowHeart,
} from "./shadowheart/scoring.js";
import {
  simulateMainPhaseAction as simAction,
  simulateSpellEffect,
} from "./shadowheart/simulation.js";

/**
 * Estratégia Shadow-Heart - IA avançada que pensa como um jogador humano experiente.
 */
export default class ShadowHeartStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);

    // Referência ao knowledge (para compatibilidade)
    this.cardKnowledge = CARD_KNOWLEDGE;

    // Combos conhecidos
    this.knownCombos = COMBO_DATABASE;

    // Estado de análise atual
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Análise de estado
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Analisa o estado atual do jogo e registra o processo de pensamento.
   * IMPORTANTE: Usa game.bot (estado simulado) em vez de this.bot para lookahead.
   */
  analyzeGameState(game) {
    this.thoughtProcess = [];

    // FIDELIDADE: Usar o bot do game/state em vez de this.bot
    // Isso permite que lookahead (BeamSearch/GameTree) funcione corretamente
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);

    const analysis = {
      // Recursos próprios
      hand: (bot.hand || []).map((c) => ({
        name: c.name,
        type: c.cardKind,
        level: c.level,
        atk: c.atk,
      })),
      field: (bot.field || []).map((c) => ({
        name: c.name,
        atk: c.atk,
        position: c.position,
      })),
      graveyard: (bot.graveyard || []).filter((c) => isShadowHeart(c)),
      fieldSpell: bot.fieldSpell?.name || null,
      lp: bot.lp,
      summonCount: bot.summonCount || 0,
      
      // Informações de timing (para evitar desperdício de recursos)
      phase: game.phase || "main1",
      turnCounter: game.turnCounter || 0,

      // Recursos do oponente
      oppField: (opponent?.field || []).map((c) => ({
        name: c.name,
        atk: c.atk,
        def: c.def,
        position: c.position,
        isFacedown: c.isFacedown,
      })),
      oppBackrow: opponent?.spellTrap?.length || 0,
      oppHand: opponent?.hand?.length || 0,
      oppLp: opponent?.lp || 0,

      // Avaliações
      canNormalSummon: bot.summonCount < 1,
      fieldCapacity: 5 - bot.field.length,
      threatsOnBoard: [],
      availableCombos: [],
      bestPlays: [],
    };

    // Identificar ameaças do oponente
    (opponent?.field || []).forEach((c) => {
      if (c.atk > 2000 || c.isFacedown) {
        analysis.threatsOnBoard.push({
          card: c.name,
          atk: c.atk,
          threat: c.isFacedown ? "unknown" : c.atk >= 2500 ? "high" : "medium",
        });
      }
    });

    this.think(`📊 Analisando situação: ${bot.lp} LP vs ${opponent.lp} LP`);
    this.think(
      `🃏 Minha mão: ${analysis.hand.map((c) => c.name).join(", ") || "vazia"}`
    );
    this.think(
      `⚔️ Meu campo: ${analysis.field.map((c) => c.name).join(", ") || "vazio"}`
    );
    this.think(
      `🎯 Campo oponente: ${
        analysis.oppField
          .map((c) => (c.isFacedown ? "???" : c.name))
          .join(", ") || "vazio"
      }`
    );

    // Detectar combos disponíveis
    analysis.availableCombos = detectAvailableCombos(analysis, (msg) =>
      this.think(msg)
    );

    this.currentAnalysis = analysis;
    return analysis;
  }

  /**
   * Registra um pensamento no processo de análise.
   */
  think(thought) {
    this.thoughtProcess.push(thought);
    if (this.bot && this.bot.debug === false) {
      return;
    }
    console.log(`[Shadow-Heart AI] ${thought}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Avaliação de board
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Avalia o tabuleiro com análise profunda.
   */
  evaluateBoard(gameOrState, perspectivePlayer) {
    return evaluateBoardShadowHeart(
      gameOrState,
      perspectivePlayer,
      this.getOpponent.bind(this)
    );
  }

  /**
   * Avalia um monstro individual (wrapper para compatibilidade).
   */
  evaluateMonster(monster, owner, opponent) {
    return evaluateMonster(monster, owner, opponent);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Macro Planning
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Avalia macro strategy usando MacroPlanning.
   */
  evaluateMacroStrategy(game, analysis) {
    const actualGame = game._gameRef || game;
    const bot = this.bot;
    const opponent = this.getOpponent(actualGame, bot);

    const lethal = detectLethalOpportunity(
      { bot, player: opponent, field: {} },
      bot,
      opponent,
      2
    );

    const defensive = detectDefensiveNeed(
      { bot, player: opponent },
      bot,
      opponent
    );

    const comeback = detectComeback({ bot, player: opponent }, bot, opponent);

    const macro = decideMacroStrategy({ bot, player: opponent }, bot, opponent);

    if (this.bot.debug) {
      this.think(
        `    Lethal: ${
          lethal.canLethal ? "YES (in " + lethal.turnsNeeded + " turns)" : "NO"
        }`
      );
      this.think(
        `    Threat: ${defensive.threatLevel} (${defensive.turnsToKill} turns to kill)`
      );
      this.think(`    Comeback: ${comeback.isVirada ? "YES" : "NO"}`);
    }

    return macro;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Geração de ações
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Gera ações de main phase com análise profunda.
   * FIDELIDADE: Usa game.bot para lookahead funcionar corretamente.
   */
  generateMainPhaseActions(game) {
    const analysis = this.analyzeGameState(game);
    const actions = [];

    // FIDELIDADE: Usar bot do game/state para simulação correta
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const actualGame = game._gameRef || game;
    const opponent = this.getOpponent(actualGame, bot);

    // Logging reduzido em simulação para performance
    const shouldLog = !isSimulatedState;
    const log = (msg) => shouldLog && this.think(msg);

    log(`\n🧠 Gerando ações possíveis...`);

    // === P1: MACRO PLANNING ===
    const macroStrategy = this.evaluateMacroStrategy(game, analysis);
    log(
      `  📊 Macro Strategy: ${macroStrategy.strategy} (Priority: ${macroStrategy.priority})`
    );

    // === P1: CHAIN AWARENESS ===
    const chainRisks = {
      spell: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "spell"
      ),
      summon: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "summon"
      ),
      attack: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "attack"
      ),
    };

    // === PRIORIDADE 1: COMBOS DE ALTA PRIORIDADE ===
    for (const combo of analysis.availableCombos.sort(
      (a, b) => b.priority - a.priority
    )) {
      log(
        `  📌 Considerando combo: ${combo.name} (prioridade ${combo.priority})`
      );
    }

    // === GERAR AÇÕES DE SPELL ===
    // Em simulação, não verificar canActivate (não temos effectEngine)
    // Track spells already added to avoid duplicates (for 1/turn effects)
    const addedSpellNames = new Set();

    (bot.hand || []).forEach((card, index) => {
      if (card.cardKind !== "spell") return;

      // BUGFIX: Só adicionar uma cópia de cada spell (evitar duplicatas com 1/turn)
      // Spells com efeitos 1/turn não devem ter múltiplas ações geradas
      const hasOncePerTurn = (card.effects || []).some(
        (e) => e.oncePerTurn || e.oncePerTurnName
      );
      if (hasOncePerTurn && addedSpellNames.has(card.name)) {
        log(`  ⏭️ Skipping duplicate 1/turn spell: ${card.name}`);
        return;
      }

      // Só verificar canActivate em game real (não simulado)
      if (!isSimulatedState) {
        const actualGame = game._gameRef || game;
        const check = actualGame.effectEngine?.canActivate?.(card, bot);
        if (!check?.ok) return;
        
        // VALIDAÇÃO EXTRA: Polymerization requer materiais válidos
        if (card.name === "Polymerization") {
          const canActivate = actualGame.canActivatePolymerization?.() ?? false;
          if (!canActivate) {
            log(`  ⚠️ Polymerization bloqueado: sem materiais válidos`);
            return;
          }
        }
      }

      const decision = shouldPlaySpell(card, analysis);

      if (decision.yes) {
        log(`  ✅ Spell válida: ${card.name} - ${decision.reason}`);

        // Mark spell as added if it has 1/turn effect
        if (hasOncePerTurn) {
          addedSpellNames.add(card.name);
        }

        let finalPriority = decision.priority;
        const macroBuff = calculateMacroPriorityBonus(
          "spell",
          card,
          macroStrategy
        );
        finalPriority += macroBuff;

        const spellSafety = assessActionSafety(
          { bot, player: opponent },
          bot,
          opponent,
          "spell",
          card
        );
        if (spellSafety.recommendation === "very_risky") {
          finalPriority -= 15;
          log(`    ⚠️  Very risky (chain blocking): -15 priority`);
        } else if (spellSafety.recommendation === "risky") {
          finalPriority -= 8;
        }

        actions.push({
          type: "spell",
          index,
          cardId: card.id,
          priority: finalPriority,
          cardName: card.name,
          macroBuff,
          safetyScore: spellSafety.riskScore,
        });
      } else {
        log(`  ❌ Spell descartada: ${card.name} - ${decision.reason}`);
      }
    });

    // === GERAR AÇÕES DE SUMMON ===
    if (analysis.canNormalSummon) {
      (bot.hand || []).forEach((card, index) => {
        if (card.cardKind !== "monster") return;

        // BUGFIX: Não gerar summon se já invocou neste turno
        if ((bot.summonCount || 0) >= 1) return;

        const tributeInfo = this.getTributeRequirementFor(card, bot);
        if ((bot.field?.length || 0) < tributeInfo.tributesNeeded) return;
        if (analysis.fieldCapacity <= 0) return;

        const decision = shouldSummonMonster(card, analysis, tributeInfo);

        if (decision.yes) {
          log(`  ✅ Summon válido: ${card.name} - ${decision.reason}`);

          let finalPriority = decision.priority;
          const macroBuff = calculateMacroPriorityBonus(
            "summon",
            card,
            macroStrategy
          );
          finalPriority += macroBuff;

          const summonSafety = assessActionSafety(
            { bot, player: opponent },
            bot,
            opponent,
            "summon",
            card
          );
          if (summonSafety.recommendation === "very_risky") {
            finalPriority -= 10;
          }
          actions.push({
            type: "summon",
            index,
            cardId: card.id,
            position: decision.position,
            // Respect explicit facedown decision from priorities.js
            // Default to facedown only if position is defense AND no explicit decision
            facedown:
              decision.facedown !== undefined
                ? decision.facedown
                : decision.position === "defense",
            priority: finalPriority,
            cardName: card.name,
            macroBuff,
            safetyScore: summonSafety.riskScore,
          });
        }
      });
    }

    // === GERAR AÇÕES DE IGNITION DA MÃO ===
    // Monstros com efeito ignition ativável da mão (ex: Leviathan)
    (bot.hand || []).forEach((card, index) => {
      if (card.cardKind !== "monster") return;
      
      // Verificar se o monstro tem efeito ignition com requireZone: "hand"
      const handIgnitionEffect = (card.effects || []).find(
        (e) => e && e.timing === "ignition" && e.requireZone === "hand"
      );
      if (!handIgnitionEffect) return;

      // Verificar se pode ativar (tem alvos válidos no campo)
      // Para Leviathan: precisa de Abyssal Eel no campo
      const targets = handIgnitionEffect.targets || [];
      const costTarget = targets.find((t) => t.zone === "field");
      
      if (costTarget) {
        // Verificar se existe carta válida no campo para o custo
        const fieldCards = bot.field || [];
        const hasValidCost = fieldCards.some((fieldCard) => {
          if (fieldCard.cardKind !== "monster") return false;
          if (costTarget.cardName && fieldCard.name !== costTarget.cardName) return false;
          if (costTarget.archetype && fieldCard.archetype !== costTarget.archetype) return false;
          return true;
        });

        if (!hasValidCost) {
          log(`  ⏭️ Hand ignition ${card.name}: sem custo válido no campo`);
          return;
        }
      }

      // Verificar once-per-turn
      if (!isSimulatedState) {
        const actualGame = game._gameRef || game;
        if (actualGame.effectEngine) {
          const optCheck = actualGame.effectEngine.checkOncePerTurn(
            card,
            bot,
            handIgnitionEffect
          );
          if (!optCheck.ok) {
            log(`  ⏭️ Hand ignition ${card.name}: já usado neste turno`);
            return;
          }
        }
      }

      // Verificar se há espaço no campo para o special summon
      if (analysis.fieldCapacity <= 0) {
        log(`  ⏭️ Hand ignition ${card.name}: campo cheio`);
        return;
      }

      // Calcular prioridade baseada no valor do monstro
      let priority = 8; // Base alta para efeitos que geram vantagem
      
      // Bonus se for combo conhecido (Eel -> Leviathan)
      if (card.name === "Shadow-Heart Leviathan") {
        priority = 9; // Combo forte: 2200 ATK + burn
        log(`  ✅ Hand ignition: ${card.name} (Eel -> Leviathan combo)`);
      } else {
        log(`  ✅ Hand ignition: ${card.name}`);
      }

      const macroBuff = calculateMacroPriorityBonus(
        "handIgnition",
        card,
        macroStrategy
      );
      priority += macroBuff;

      actions.push({
        type: "handIgnition",
        index,
        cardId: card.id,
        priority,
        cardName: card.name,
        effectId: handIgnitionEffect.id,
        macroBuff,
      });
    });

    // === STALEMATE BREAKER ===
    // Se não há ações e há capacidade de campo, forçar summon mesmo que já tenha invocado
    // Isso evita que o jogo fique travado quando o bot acumula cartas na mão
    // BUGFIX: Skip durante simulação (BeamSearch lookahead) - não é um stalemate real
    // BUGFIX: Só ativar se summon ainda está disponível (evita tentar invocar em Main2 após já ter invocado)
    if (
      actions.length === 0 &&
      analysis.fieldCapacity > 0 &&
      !isSimulatedState &&
      (bot.summonCount || 0) < 1 // Só força summon se ainda pode invocar
    ) {
      // CRITICAL: Usar estado REAL (this.bot) para fallback, não simulado
      const realBot = this.bot || bot;

      // Log para debug
      console.log(
        `[ShadowHeartStrategy] ⚠️ STALEMATE BREAKER ativado! Hand=${realBot.hand?.length}, Field=${realBot.field?.length}`
      );
      log(`  ⚠️ STALEMATE BREAKER: Forçando summon alternativo...`);
      let monstersChecked = 0;
      let monstersBlocked = 0;

      (realBot.hand || []).forEach((card, index) => {
        if (card.cardKind !== "monster") return;
        monstersChecked++;

        const tributeInfo = this.getTributeRequirementFor(card, realBot);
        if ((realBot.field?.length || 0) < tributeInfo.tributesNeeded) {
          monstersBlocked++;
          console.log(
            `[ShadowHeartStrategy] ❌ ${card.name} requer ${
              tributeInfo.tributesNeeded
            } tributos (tenho ${realBot.field?.length || 0})`
          );
          log(
            `    ❌ ${card.name} requer ${
              tributeInfo.tributesNeeded
            } tributos (tenho ${realBot.field?.length || 0})`
          );
          return;
        }

        // Forçar summon em defesa com prioridade baixa
        console.log(
          `[ShadowHeartStrategy] 🔧 Fallback summon: ${card.name} em defesa`
        );
        log(`    🔧 Fallback summon: ${card.name} em defesa`);
        actions.push({
          type: "summon",
          index,
          cardId: card.id,
          position: "defense",
          facedown: true,
          priority: 1,
          cardName: card.name,
          isStalemateBreaker: true,
        });
      });

      if (monstersChecked > 0 && monstersBlocked === monstersChecked) {
        console.log(
          `[ShadowHeartStrategy] ⚠️ Todos ${monstersChecked} monstros na mão requerem tributos!`
        );
        log(
          `  ⚠️ Todos ${monstersChecked} monstros na mão requerem tributos! Tentando spells...`
        );
      }
    }

    // === FALLBACK SECUNDÁRIO: Forçar qualquer spell se ainda não há ações ===
    // BUGFIX: Skip durante simulação (BeamSearch lookahead) - usar lógica normal
    if (actions.length === 0 && !isSimulatedState) {
      const realBot2 = this.bot || bot;
      // BUGFIX: Garantir que LP está sempre definido (buscar do game se necessário)
      const botLP = realBot2.lp ?? this.game?.bot?.lp ?? 8000;
      if ((realBot2.hand?.length || 0) > 3) {
        // Log para debug
        console.log(
          `[ShadowHeartStrategy] 🚨 FALLBACK CRÍTICO! Hand=${realBot2.hand?.length}, Field=${realBot2.field?.length}, LP=${botLP}`
        );
        log(
          `  🆘 FALLBACK CRÍTICO: ${realBot2.hand.length} cartas na mão, 0 ações! Forçando spell...`
        );

        let spellsFound = 0;
        (realBot2.hand || []).forEach((card, index) => {
          if (card.cardKind !== "spell") return;
          
          // VALIDAÇÃO: Polymerization só pode ser ativado se tiver materiais válidos
          if (card.name === "Polymerization") {
            const canActivate = actualGame.canActivatePolymerization?.() ?? false;
            if (!canActivate) {
              console.log(
                `[ShadowHeartStrategy] ⚠️ Polymerization bloqueado: sem materiais válidos`
              );
              return; // Skip Polymerization sem materiais
            }
          }
          
          spellsFound++;

          // Tentar qualquer spell, mesmo sem validação prévia
          console.log(
            `[ShadowHeartStrategy] 🔧 Fallback spell: ${card.name} (prioridade 0.5)`
          );
          log(`    🔧 Fallback spell: ${card.name} (prioridade forçada: 0.5)`);
          actions.push({
            type: "spell",
            index,
            cardId: card.id,
            priority: 0.5,
            cardName: card.name,
            isCriticalFallback: true,
          });
        });

        // Se ainda não há ações e não há spells, reportar situação crítica
        if (spellsFound === 0 && actions.length === 0) {
          const monsterCount = (realBot2.hand || []).filter(
            (c) => c.cardKind === "monster"
          ).length;
          const trapCount = (realBot2.hand || []).filter(
            (c) => c.cardKind === "trap"
          ).length;

          console.log(
            `[ShadowHeartStrategy] ⚠️ Situação crítica: ${monsterCount}M ${trapCount}T`
          );
          console.log(
            `[ShadowHeartStrategy] Mão completa: ${(realBot2.hand || [])
              .map((c) => c.name)
              .join(", ")}`
          );
          log(
            `  ⚠️ Situação crítica: ${monsterCount} monstros (todos precisam tributos?), ${trapCount} traps na mão`
          );
          log(
            `  📋 Mão: ${(realBot2.hand || []).map((c) => c.name).join(", ")}`
          );
        }
      }
    }

    // === EFEITOS DE CAMPO ===
    // Em simulação, não verificar checkOncePerTurn
    if (bot.fieldSpell && !isSimulatedState) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate"
      );
      if (effect) {
        const actualGame = game._gameRef || game;
        const check = actualGame.effectEngine?.checkOncePerTurn?.(
          bot.fieldSpell,
          bot,
          effect
        );
        if (check?.ok) {
          actions.push({ type: "fieldEffect", priority: 5 });
        }
      }
    }

    // === P2: GAME TREE SEARCH (OPCIONAL) ===
    // Desativar P2 em simulação para evitar recursão infinita
    if (isSimulatedState) {
      return this.sequenceActions(actions);
    }

    const finalActions = this.integrateP2IntoActionSelection(
      game,
      this.sequenceActions(actions),
      analysis
    );

    return finalActions;
  }

  /**
   * Ordena ações por prioridade estratégica.
   */
  sequenceActions(actions) {
    const sorted = actions.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );

    this.think(`\n📋 Sequência de ações ordenada:`);
    sorted.forEach((a, i) => {
      this.think(
        `  ${i + 1}. ${a.type}: ${a.cardName || "?"} (pri: ${a.priority || 0})`
      );
    });

    return sorted;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers (wrappers para módulos)
  // ─────────────────────────────────────────────────────────────────────────

  isShadowHeart(card) {
    return isShadowHeart(card);
  }

  isShadowHeartByName(name) {
    return isShadowHeartByName(name);
  }

  getTributeRequirementFor(card, playerState) {
    return getTributeRequirementFor(card, playerState);
  }

  selectBestTributes(field, tributesNeeded, cardToSummon, context) {
    return selectBestTributes(field, tributesNeeded, cardToSummon, context);
  }

  simulateMainPhaseAction(state, action) {
    return simAction(state, action, this.placeSpellCard.bind(this));
  }

  simulateSpellEffect(state, card) {
    return simulateSpellEffect(state, card);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // P2: Game Tree Search e Opponent Analysis
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Game Tree Search para situações críticas.
   */
  evaluateCriticalSituationWithGameTree(game, analysis) {
    try {
      const opponent = this.getOpponent(game, this.bot) || game.opponent;
      if (!opponent) return null;

      if (!shouldUseGameTreeSearch(game, this.bot)) {
        return null;
      }

      this.think(
        `\n🔮 [P2] Situação crítica detectada! Rodando Game Tree Search (4-ply)...`
      );

      const complexity = estimateSearchComplexity(4, 3);
      this.think(`  📊 Nodes estimados: ~${complexity}`);

      const result = gameTreeSearch(game, this, this.bot, 4);

      if (result.action) {
        this.think(
          `  ✅ Game Tree melhor ação: ${
            result.action.type || "unknown"
          } (score: ${result.score.toFixed(2)}, conf: ${(
            result.confidence * 100
          ).toFixed(0)}%)`
        );
        return result;
      }

      return null;
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[ShadowHeartStrategy] Game Tree Search erro:`, e);
      }
      return null;
    }
  }

  /**
   * Analisa oponente e prediz próximas ações.
   */
  analyzeOpponentPosition(game) {
    try {
      const opponent = this.getOpponent(game, this.bot) || game.opponent;
      if (!opponent) return null;

      const analysis = analyzeOpponent(opponent, this.bot);
      const turnsToKill = estimateTurnsToOppLethal(
        opponent,
        this.bot.lp || 8000
      );

      this.think(`\n📍 [P2] Análise do Oponente:`);
      this.think(`  🏛️  Arquétipo: ${analysis.archetype}`);
      this.think(`  ⚔️  Estilo: ${analysis.playstyle}`);
      this.think(
        `  🎯 Próxima ação provável: ${
          analysis.nextMove.card?.name || "desconhecida"
        } (${analysis.nextMove.role})`
      );
      this.think(
        `  ⏱️  Turnos até lethal: ${
          turnsToKill === Infinity ? "∞" : turnsToKill
        }`
      );
      this.think(`  ⚡ Nível de ameaça: ${analysis.threat_level}/3`);

      return {
        ...analysis,
        turnsToLethal: turnsToKill,
      };
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[ShadowHeartStrategy] Opponent Analysis erro:`, e);
      }
      return null;
    }
  }

  /**
   * Integra P2 na seleção de ações.
   */
  integrateP2IntoActionSelection(game, actions, analysis) {
    try {
      if (!actions || actions.length === 0) return actions;

      const oppAnalysis = this.analyzeOpponentPosition(game);
      if (!oppAnalysis) return actions;

      const gameTreeResult = this.evaluateCriticalSituationWithGameTree(
        game,
        analysis
      );
      if (!gameTreeResult || !gameTreeResult.action) {
        return actions;
      }

      const gameTreeAction = gameTreeResult.action;
      const gameTreeScore = gameTreeResult.score;

      this.think(
        `\n🎯 [P2] Game Tree sobrescreve: score=+${gameTreeScore.toFixed(
          2
        )} vs P1`
      );

      const indexInActions = actions.findIndex(
        (a) =>
          a.type === gameTreeAction.type && a.index === gameTreeAction.index
      );

      if (indexInActions >= 0) {
        const action = actions[indexInActions];
        action.p2Score = gameTreeScore;
        action.p2Approved = true;
        actions.splice(indexInActions, 1);
        actions.unshift(action);
      }

      return actions;
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[ShadowHeartStrategy] P2 Integration erro:`, e);
      }
      return actions;
    }
  }
}
