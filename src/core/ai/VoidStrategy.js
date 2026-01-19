import BaseStrategy from "./BaseStrategy.js";
import { estimateCardValue, estimateMonsterValue } from "./StrategyUtils.js";
import {
  isVoid,
  getVoidCardKnowledge,
  VOID_EXTRA_DECK_IDS,
} from "./void/knowledge.js";
import {
  chooseVoidSummonPosition,
  evaluateVoidFusionPriority,
  shouldPlayVoidSpell,
  shouldSummonVoidMonster,
} from "./void/priorities.js";
import {
  VOID_IDS,
  COMBO_DATABASE,
  detectAvailableCombos,
  getComboSequence,
  calculateFusionValue,
} from "./void/combos.js";
import {
  evaluateBoardVoid,
  evaluateVoidMonster,
  analyzeHollowEconomy,
} from "./void/scoring.js";

export default class VoidStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);
    // Estado de análise atual
    this.currentAnalysis = null;
    this.thoughtProcess = [];
    this.knownCombos = COMBO_DATABASE;
  }

  /**
   * Avaliação de board usando a nova lógica Void-específica.
   * Mantém compatibilidade com evaluateBoard mas usa evaluateBoardVoid internamente.
   */
  evaluateBoard(gameOrState, perspectivePlayer) {
    return evaluateBoardVoid(gameOrState, perspectivePlayer);
  }

  /**
   * Analisa o estado atual e detecta combos disponíveis.
   */
  analyzeGameState(game) {
    this.thoughtProcess = [];
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);

    const analysis = {
      // Recursos próprios
      hand: bot.hand || [],
      field: bot.field || [],
      graveyard: bot.graveyard || [],
      extraDeck: bot.extraDeck || [],
      spellTrap: bot.spellTrap || [],
      fieldSpell: bot.fieldSpell,
      lp: bot.lp || 8000,
      summonAvailable:
        (bot.summonCount || 0) < 1 + (bot.additionalNormalSummons || 0),

      // Recursos do oponente
      oppField: opponent?.field || [],
      oppHand: opponent?.hand || [],
      oppGraveyard: opponent?.graveyard || [],
      oppSpellTrap: opponent?.spellTrap || [],
      oppFieldSpell: opponent?.fieldSpell,
      oppLP: opponent?.lp || 8000,

      // Métricas calculadas
      oppFieldCount: (opponent?.field || []).length,
      oppStrongestAtk: (opponent?.field || []).reduce((max, m) => {
        if (!m || m.cardKind !== "monster") return max;
        const atk = m.isFacedown ? 1500 : (m.atk || 0) + (m.tempAtkBoost || 0);
        return Math.max(max, atk);
      }, 0),
      myStrongestAtk: (bot.field || []).reduce((max, m) => {
        if (!m || m.cardKind !== "monster") return max;
        return Math.max(max, (m.atk || 0) + (m.tempAtkBoost || 0));
      }, 0),
      hollowCount: (bot.field || []).filter((m) => m?.id === VOID_IDS.HOLLOW)
        .length,
      voidCount: (bot.field || []).filter(isVoid).length,
      hollowsInHand: (bot.hand || []).filter((m) => m?.id === VOID_IDS.HOLLOW)
        .length,
      myLP: bot.lp || 8000,
    };

    // Detectar combos disponíveis
    analysis.availableCombos = detectAvailableCombos(analysis);
    analysis.readyCombos = analysis.availableCombos.filter((c) => c.ready);

    // Analisar economia de Hollows (campo, mão, GY, acessibilidade)
    analysis.hollowEconomy = analyzeHollowEconomy(analysis);

    // Analisar payoffs disponíveis para swarm
    analysis.swarmPayoffs = this.analyzeSwarmPayoffs(analysis);

    // Determinar estratégia macro
    analysis.macroStrategy = this.decideMacroStrategy(analysis);

    this.currentAnalysis = analysis;
    return analysis;
  }

  /**
   * Analisa quais payoffs estão disponíveis para justificar um swarm de Hollows.
   * Swarm sem payoff = campo fraco que será destruído.
   */
  analyzeSwarmPayoffs(analysis) {
    const { hand, field, graveyard, extraDeck } = analysis;
    const handIds = (hand || []).map((c) => c?.id).filter(Boolean);
    const gyIds = (graveyard || []).map((c) => c?.id).filter(Boolean);
    const extraIds = (extraDeck || []).map((c) => c?.id).filter(Boolean);
    const hollowsOnField = (field || []).filter(
      (m) => m?.id === VOID_IDS.HOLLOW,
    ).length;
    const hollowsInHand = handIds.filter((id) => id === VOID_IDS.HOLLOW).length;
    const hollowsInGY = gyIds.filter((id) => id === VOID_IDS.HOLLOW).length;
    const voidCountTotal =
      (hand || []).filter(isVoid).length + (field || []).filter(isVoid).length;

    const payoffs = {
      hasBossPayoff: false, // Tem boss para tributar Hollows
      hasFusionPayoff: false, // Pode fazer fusão com Hollows
      hasGYPayoff: false, // Pode usar Hollows no GY (Haunter revive)
      totalPayoffValue: 0,
      reasons: [],
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // BOSS PAYOFFS: Monstros que tributam Hollows/Voids
    // ═══════════════════════════════════════════════════════════════════════════

    // Haunter (tributa 1 Hollow → 2100 ATK, pode reviver 3 depois)
    if (handIds.includes(VOID_IDS.HAUNTER)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 3.5;
      payoffs.reasons.push("Haunter pode tributar Hollow e reviver depois");
    }

    // Slayer Brute (tributa 2 Voids → 2500 ATK com banish)
    if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 4.0;
      payoffs.reasons.push("Slayer Brute pode tributar 2 Voids");
    }

    // Serpent Drake (tributa 1-3 Hollows → 2300+ ATK com bônus)
    if (handIds.includes(VOID_IDS.SERPENT_DRAKE)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 3.5;
      payoffs.reasons.push("Serpent Drake escala com Hollows tributados");
    }

    // Forgotten Knight (tributa 1 Void → 2000 ATK)
    if (handIds.includes(VOID_IDS.FORGOTTEN_KNIGHT)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 2.0;
      payoffs.reasons.push("Forgotten Knight pode tributar Void");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FUSION PAYOFFS
    // ═══════════════════════════════════════════════════════════════════════════
    const hasPoly = handIds.includes(VOID_IDS.POLYMERIZATION);

    // Hollow King (3 Hollows)
    if (hasPoly && extraIds.includes(VOID_IDS.HOLLOW_KING)) {
      const potentialHollows = hollowsOnField + hollowsInHand + 2; // +2 do combo
      if (potentialHollows >= 3) {
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 4.5;
        payoffs.reasons.push("Hollow King fusion possível");
      }
    }

    // Hydra Titan (6 Voids)
    if (hasPoly && extraIds.includes(VOID_IDS.HYDRA_TITAN)) {
      const potentialVoids = voidCountTotal + 2; // +2 do combo (Hollows extras)
      if (potentialVoids >= 5) {
        // Quase lá
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 5.0;
        payoffs.reasons.push("Hydra Titan fusion próxima");
      }
    }

    // Berserker (Slayer no campo + Void) - precisa Slayer primeiro
    if (hasPoly && extraIds.includes(VOID_IDS.BERSERKER)) {
      if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 4.0;
        payoffs.reasons.push("Berserker fusion via Slayer");
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GY PAYOFFS: Hollows no cemitério são recurso
    // ═══════════════════════════════════════════════════════════════════════════

    // Haunter no GY pode reviver até 3 Hollows
    if (gyIds.includes(VOID_IDS.HAUNTER) && hollowsInGY >= 1) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 2.0;
      payoffs.reasons.push("Haunter no GY pode reviver Hollows");
    }

    // Conjurer no GY pode se reviver (tributa Void do campo)
    if (gyIds.includes(VOID_IDS.CONJURER)) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 1.5;
      payoffs.reasons.push("Conjurer pode se reviver do GY");
    }

    // Tenebris Horn no GY (once per duel revive)
    if (gyIds.includes(VOID_IDS.TENEBRIS_HORN)) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 1.0;
      payoffs.reasons.push("Tenebris Horn pode se reviver");
    }

    return payoffs;
  }

  /**
   * Avalia qual monstro recrutar do deck (ex: Conjurer effect).
   * Considera sinergia com o estado atual, não apenas ATK.
   *
   * REGRA CHAVE: Walker > Hollow (se Hollow na mão), porque:
   * - Walker pode bounce e SS Hollow da mão
   * - Hollow SS da mão recruta outro Hollow
   * - Resultado: 3 bodies vs 2 bodies
   *
   * @param {Array} candidates - Cartas candidatas para recrutar
   * @param {Object} context - Contexto (source, game, etc)
   * @returns {Object} - { best, scores, reasoning }
   */
  evaluateRecruitCandidate(candidates, context = {}) {
    if (!candidates || candidates.length === 0) {
      return { best: null, scores: [], reasoning: "No candidates" };
    }

    const game = context.game || this.bot?.game;
    const bot = context.player || this.bot || game?.bot;
    const analysis = this.currentAnalysis || this.analyzeGameState(game);
    const hollowEconomy = analysis?.hollowEconomy || {};

    const hand = bot?.hand || [];
    const field = bot?.field || [];

    const hollowsInHand = hand.filter((c) => c?.id === VOID_IDS.HOLLOW).length;
    const walkerInHand = hand.some((c) => c?.id === VOID_IDS.WALKER);
    const hollowsOnField = field.filter(
      (c) => c?.id === VOID_IDS.HOLLOW,
    ).length;

    const scores = candidates.map((card) => {
      let score = (card.atk || 0) / 1000; // Base: ATK normalizado
      let reasons = [];

      switch (card.id) {
        case VOID_IDS.WALKER:
          // Walker é MUITO valioso se temos Hollow na mão
          if (hollowsInHand > 0) {
            score += 4.0; // Habilita Hollow SS da mão → recruta
            reasons.push(`Walker + Hollow na mão = combo (+4.0)`);
          } else {
            score += 1.0; // Ainda útil para bounce futuros
            reasons.push(`Walker sem Hollow na mão (+1.0)`);
          }
          break;

        case VOID_IDS.HOLLOW:
          // Hollow recrutado do deck NÃO recruta outro (não é SS da mão)
          // Ainda vale como body, mas menos que Walker quando temos Hollow na mão
          if (hollowsInHand > 0) {
            score += 0.5; // Redundante se já tem na mão
            reasons.push(`Hollow do deck - já tem na mão (+0.5)`);
          } else if (hollowsOnField >= 2) {
            score += 0.3; // Já tem muitos, não precisa mais
            reasons.push(`Já tem ${hollowsOnField} Hollows no campo (+0.3)`);
          } else {
            score += 1.5; // Bom para ter presença
            reasons.push(`Hollow para presença (+1.5)`);
          }
          break;

        case VOID_IDS.BONE_SPIDER:
          // Bone Spider é bom para controle
          if ((analysis.oppFieldCount || 0) > 0) {
            score += 1.5; // Pode reduzir ATK inimigo
            reasons.push(`Bone Spider vs campo inimigo (+1.5)`);
          } else {
            score += 0.5;
            reasons.push(`Bone Spider sem alvos (+0.5)`);
          }
          break;

        case VOID_IDS.TENEBRIS_HORN:
          // Escala com Voids no campo
          const voidCount = (analysis.voidCount || 0) + 1;
          const scalingBonus = voidCount * 0.3;
          score += scalingBonus;
          reasons.push(`Tenebris Horn escala +${scalingBonus.toFixed(1)}`);
          break;

        case VOID_IDS.RAVEN:
          // Proteção útil se temos ameaças no campo
          if (hollowsOnField >= 2 || field.length >= 3) {
            score += 1.2;
            reasons.push(`Raven protege board (+1.2)`);
          } else {
            score += 0.3;
            reasons.push(`Raven sem board para proteger (+0.3)`);
          }
          break;

        default:
          // Outros monstros Void
          score += 0.5;
          reasons.push(`Void genérico (+0.5)`);
      }

      return { card, score, reasons };
    });

    // Ordenar por score decrescente
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0]?.card || null;
    const reasoning = scores[0]?.reasons?.join("; ") || "No specific reasoning";

    return {
      best,
      scores,
      reasoning,
      // Retorna função para usar como botSelect
      asBotSelect: () => [best].filter(Boolean),
    };
  }

  /**
   * Avalia se ativar Void Gravitational Pull é vantajoso.
   *
   * O efeito devolve 1 Void meu e 1 monstro do oponente para a mão.
   * Só vale a pena se:
   * 1. Tenho mais de 1 monstro no campo (não ficar com campo vazio)
   * 2. OU o monstro do oponente é uma ameaça maior que o meu
   * 3. OU tenho como re-invocar o monstro devolvido facilmente
   *
   * @param {Object} bot - Jogador bot
   * @param {Object} opponent - Jogador oponente
   * @returns {Object} - { shouldActivate, priority, reason }
   */
  evaluateGravitationalPull(bot, opponent) {
    const myField = bot?.field || [];
    const oppField = opponent?.field || [];
    const myHand = bot?.hand || [];

    // Monstros válidos para devolver (Void face-up)
    const myVoids = myField.filter(
      (m) => m?.cardKind === "monster" && isVoid(m) && !m?.isFacedown,
    );
    const oppMonsters = oppField.filter((m) => m?.cardKind === "monster");

    // Se não tem alvos válidos, não pode ativar
    if (myVoids.length === 0 || oppMonsters.length === 0) {
      return {
        shouldActivate: false,
        priority: 0,
        reason: "Sem alvos válidos",
      };
    }

    // Calcular valores
    const myWeakest = myVoids.reduce(
      (min, m) => {
        const atk = (m.atk || 0) + (m.tempAtkBoost || 0);
        return atk < min.atk ? { card: m, atk } : min;
      },
      {
        card: myVoids[0],
        atk: (myVoids[0].atk || 0) + (myVoids[0].tempAtkBoost || 0),
      },
    );

    const oppStrongest = oppMonsters.reduce(
      (max, m) => {
        const atk = m.isFacedown ? 1500 : (m.atk || 0) + (m.tempAtkBoost || 0);
        return atk > max.atk ? { card: m, atk } : max;
      },
      { card: oppMonsters[0], atk: 0 },
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // REGRA 1: Não ativar se só tenho 1 monstro e ficarei com campo vazio
    // ═══════════════════════════════════════════════════════════════════════════
    if (myVoids.length === 1 && myField.length === 1) {
      // Exceção: Se o monstro do oponente é MUITO mais forte e eu tenho como voltar
      const canReinvoke = myHand.some(
        (c) =>
          c?.id === VOID_IDS.CONJURER ||
          c?.id === VOID_IDS.WALKER ||
          c?.id === VOID_IDS.HAUNTER,
      );

      const threatDiff = oppStrongest.atk - myWeakest.atk;

      if (threatDiff >= 800 && canReinvoke) {
        // Vale a pena remover ameaça grande se posso reconstruir
        return {
          shouldActivate: true,
          priority: 6.0,
          reason: `Remover ameaça forte (${oppStrongest.card?.name} ${oppStrongest.atk}ATK) - posso reinvocar`,
        };
      }

      // Não vale ficar com campo vazio
      return {
        shouldActivate: false,
        priority: 0,
        reason: `Ficaria com campo vazio (só tenho ${myWeakest.card?.name})`,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REGRA 2: Avaliar troca de recursos
    // ═══════════════════════════════════════════════════════════════════════════

    // Se oponente só tem 1 monstro e eu tenho vários, vale devolver
    if (oppMonsters.length === 1 && myVoids.length >= 2) {
      return {
        shouldActivate: true,
        priority: 7.0,
        reason: `Limpar único monstro do oponente (${oppStrongest.card?.name}) mantendo presença`,
      };
    }

    // Se monstro do oponente é mais forte que meu mais fraco, vale trocar
    if (oppStrongest.atk > myWeakest.atk + 300) {
      return {
        shouldActivate: true,
        priority: 5.5 + (oppStrongest.atk - myWeakest.atk) / 1000,
        reason: `Trocar ${myWeakest.card?.name} (${myWeakest.atk}) por ${oppStrongest.card?.name} (${oppStrongest.atk})`,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REGRA 3: Considerar se devolver meu monstro me ajuda (reuso de efeito)
    // ═══════════════════════════════════════════════════════════════════════════

    // Conjurer na mão de novo = pode recrutar novamente
    const conjurerOnField = myVoids.some((m) => m.id === VOID_IDS.CONJURER);
    if (conjurerOnField && myVoids.length >= 2) {
      // Posso devolver Conjurer e invocar de novo para recrutar
      return {
        shouldActivate: true,
        priority: 6.5,
        reason: "Reciclar Conjurer para novo recrute",
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEFAULT: Só ativar se claramente vantajoso
    // ═══════════════════════════════════════════════════════════════════════════

    // Se chegou aqui, provavelmente não é uma boa jogada
    if (myVoids.length >= 2 && oppStrongest.atk >= 1500) {
      return {
        shouldActivate: true,
        priority: 4.5,
        reason: "Trocar monstro por ameaça moderada",
      };
    }

    return {
      shouldActivate: false,
      priority: 0,
      reason: "Troca não vantajosa",
    };
  }

  /**
   * Decide a estratégia macro baseada no estado do jogo.
   */
  decideMacroStrategy(analysis) {
    const {
      myLP,
      oppLP,
      oppFieldCount,
      oppStrongestAtk,
      voidCount,
      readyCombos,
      swarmPayoffs,
      hollowEconomy,
    } = analysis;

    // Check lethal
    const myTotalAtk = (analysis.field || [])
      .filter((m) => m?.position === "attack" && !m?.hasAttacked)
      .reduce((sum, m) => sum + (m?.atk || 0), 0);

    if (oppFieldCount === 0 && myTotalAtk >= oppLP) {
      return { mode: "lethal", priority: 15 };
    }

    // Check danger
    if (myLP <= 2000) {
      return { mode: "defensive", priority: 10 };
    }

    // Check se precisa de recovery (Hollows perdidos no GY)
    if (hollowEconomy?.needsRecovery && !hollowEconomy?.hasHaunterRevive) {
      // Priorizar buscar Haunter ou The Void
      return {
        mode: "recovery",
        priority: 9,
        reason: "Hollows stranded in GY",
      };
    }

    // Check fusion opportunity
    const fusionCombo = readyCombos.find((c) => c.combo?.fusion);
    if (fusionCombo) {
      return { mode: "fusion", priority: 12, target: fusionCombo };
    }

    // Check swarm opportunity — MAS SÓ SE TEM PAYOFF!
    // Void é deck agressivo, swarm sem payoff = campo fraco que será destruído
    const swarmCombo = readyCombos.find(
      (c) =>
        c.combo?.name?.includes("Conjurer") ||
        c.combo?.name?.includes("Pipeline"),
    );

    if (swarmCombo && voidCount < 3) {
      const hasPayoff =
        swarmPayoffs?.hasBossPayoff ||
        swarmPayoffs?.hasFusionPayoff ||
        swarmPayoffs?.totalPayoffValue >= 2.0;

      if (hasPayoff) {
        return {
          mode: "swarm",
          priority: 10 + (swarmPayoffs?.totalPayoffValue || 0) / 2,
          target: swarmCombo,
          payoffs: swarmPayoffs,
        };
      }
    }

    // Sem payoff claro, ser mais conservador
    // Pode invocar monstros individualmente mas não priorizar combo completo
    return { mode: "buildup", priority: 5 };
  }

  generateMainPhaseActions(game) {
    const actions = [];
    const analysis = this.analyzeGameState(game);
    const bot = game._isPerspectiveState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);
    const isSimulatedState = game._isPerspectiveState === true;

    const handIds = (bot.hand || []).map((card) => card?.id).filter(Boolean);
    const fieldIds = (bot.field || []).map((card) => card?.id).filter(Boolean);
    const hollowFieldCount = analysis.hollowCount;
    const voidFieldCount = analysis.voidCount;
    const macroStrategy = analysis.macroStrategy;
    const swarmPayoffs = analysis.swarmPayoffs || {};

    // ═══════════════════════════════════════════════════════════════════════════
    // ASCENSION CHECK
    // ═══════════════════════════════════════════════════════════════════════════
    const canCheckAscension =
      typeof game?.canUseAsAscensionMaterial === "function" &&
      typeof game?.getAscensionCandidatesForMaterial === "function" &&
      typeof game?.checkAscensionRequirements === "function";

    if (canCheckAscension) {
      const materials = (bot.field || []).filter(
        (m) => m && m.cardKind === "monster" && !m.isFacedown,
      );
      for (const material of materials) {
        const check = game.canUseAsAscensionMaterial(bot, material);
        if (!check?.ok) continue;
        const candidates =
          game.getAscensionCandidatesForMaterial(bot, material) || [];
        const eligible = candidates.filter(
          (asc) => game.checkAscensionRequirements(bot, asc)?.ok,
        );
        for (const ascensionCard of eligible) {
          // Cosmic Walker é prioridade alta
          const isCosmicWalker = ascensionCard.id === VOID_IDS.COSMIC_WALKER;
          actions.push({
            type: "ascension",
            materialIndex: bot.field.indexOf(material),
            ascensionCard,
            cardName: ascensionCard.name,
            priority: isCosmicWalker ? 11 : 9 + (ascensionCard.atk || 0) / 1000,
            extraDeck: true,
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COMBO-AWARE ACTION GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    // Boost de prioridade baseado em combos detectados
    const comboBoosts = this.calculateComboBoosts(analysis);

    if (bot.hand && bot.hand.length > 0) {
      bot.hand.forEach((card, index) => {
        if (!card) return;

        // ─────────────────────────────────────────────────────────────────────
        // SPELLS
        // ─────────────────────────────────────────────────────────────────────
        if (card.cardKind === "spell") {
          const hasFusionAction = (card.effects || []).some((effect) =>
            (effect.actions || []).some(
              (action) =>
                action && action.type === "polymerization_fusion_summon",
            ),
          );
          if (!isSimulatedState && hasFusionAction) {
            const canActivate = game.canActivatePolymerization?.();
            if (!canActivate) return;
          }

          let decision = shouldPlayVoidSpell(card, game, bot, opponent);
          let fusionHint = null;

          // Penalizar Sealing the Void se há efeitos ignition disponíveis em campo
          if (card.id === VOID_IDS.SEALING && !isSimulatedState) {
            const fieldMonstersWithUnusedIgnition = (bot.field || []).filter(
              (m) => {
                if (!m || m.cardKind !== "monster") return false;
                const hasIgnition = (m.effects || []).some(
                  (e) => e && e.timing === "ignition" && !e.requireZone,
                );
                if (!hasIgnition) return false;
                // Verificar se já foi usado
                const firstIgnition = (m.effects || []).find(
                  (e) => e.timing === "ignition" && !e.requireZone,
                );
                if (firstIgnition) {
                  const check = game.effectEngine?.checkOncePerTurn?.(
                    m,
                    bot,
                    firstIgnition,
                  );
                  return check?.ok !== false; // Retorna true se AINDA NÃO foi usado
                }
                return false;
              },
            );
            if (fieldMonstersWithUnusedIgnition.length > 0) {
              // Tem efeitos ignition disponíveis - dar prioridade baixa para Sealing
              decision.priority = Math.min(decision.priority, 2.5);
            }
          }

          if (hasFusionAction) {
            const fusionEval = evaluateVoidFusionPriority(bot);
            fusionHint = fusionEval.target;
            if (fusionEval.priority <= 0) return;

            // Usar calculateFusionValue para prioridade mais precisa
            const fusionValue = this.evaluateFusionOpportunity(analysis);
            decision = {
              yes: true,
              priority: Math.max(
                decision.priority,
                fusionEval.priority,
                fusionValue,
              ),
            };

            // Se macro strategy é fusion, boost extra
            if (macroStrategy.mode === "fusion") {
              decision.priority += 2.0;
            }
          }

          if (decision.yes) {
            actions.push({
              type: "spell",
              index,
              cardId: card.id,
              cardName: card.name,
              priority: hasFusionAction
                ? Math.max(8.5, decision.priority)
                : decision.priority,
              extraDeck: hasFusionAction,
              fusionTargetHint: fusionHint,
            });
          }
          return;
        }

        // ─────────────────────────────────────────────────────────────────────
        // NORMAL SUMMON (com sequenciamento de combo)
        // ─────────────────────────────────────────────────────────────────────
        const summonLimit = 1 + (bot.additionalNormalSummons || 0);
        if (card.cardKind === "monster" && bot.summonCount < summonLimit) {
          const summonDecision = shouldSummonVoidMonster(
            card,
            game,
            bot,
            opponent,
          );
          if (!summonDecision.yes) return;

          // Combo boost baseado na análise
          let comboBoost = comboBoosts[card.id] || 0;

          // ═══════════════════════════════════════════════════════════════════
          // CONJURER: Só vale combo completo se tem PAYOFF
          // Swarm sem payoff = campo fraco que será destruído
          // ═══════════════════════════════════════════════════════════════════
          if (card.id === VOID_IDS.CONJURER) {
            const hasPayoff =
              swarmPayoffs.hasBossPayoff ||
              swarmPayoffs.hasFusionPayoff ||
              swarmPayoffs.totalPayoffValue >= 2.0;

            if (hasPayoff) {
              comboBoost += 3.0; // Base boost alto COM payoff

              // COMBO COMPLETO: Conjurer + Hollow na mão + payoff
              if (handIds.includes(VOID_IDS.HOLLOW)) {
                comboBoost += 2.5; // Combo perfeito!

                // Bônus adicional baseado no tipo de payoff
                if (swarmPayoffs.hasFusionPayoff) {
                  comboBoost += 1.5; // Fusão é o melhor payoff
                }
                if (handIds.includes(VOID_IDS.HAUNTER)) {
                  comboBoost += 1.5; // Haunter tributa Hollow → 2100 ATK
                }
                if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
                  comboBoost += 1.5; // Slayer tributa 2 → 2500 ATK
                }
                if (handIds.includes(VOID_IDS.SERPENT_DRAKE)) {
                  comboBoost += 1.0; // Drake tributa Hollows
                }
              } else {
                // Conjurer sem Hollow ainda é ok (recruta qualquer Void lv4-)
                comboBoost += 1.0;
              }
            } else {
              // SEM PAYOFF: Conjurer ainda é ok mas não prioriza combo
              comboBoost += 1.0; // Boost menor
              // Não faz o combo completo, só recruta um corpo
            }
          }

          // ═══════════════════════════════════════════════════════════════════
          // HOLLOW: NUNCA normal summon se tem opção melhor
          // ═══════════════════════════════════════════════════════════════════
          if (card.id === VOID_IDS.HOLLOW) {
            if (handIds.includes(VOID_IDS.CONJURER)) {
              comboBoost -= 5.0; // NUNCA - Conjurer traz Walker que desce Hollow
            } else if (handIds.includes(VOID_IDS.WALKER)) {
              comboBoost -= 2.0; // Prefere Walker para descer Hollow da mão
            } else {
              // Sem opção melhor, Hollow sozinho é fraco mas é alguma coisa
              comboBoost += 0.0;
            }
          }

          // ═══════════════════════════════════════════════════════════════════
          // WALKER: Bom se tem Hollow na mão (e não tem Conjurer)
          // ═══════════════════════════════════════════════════════════════════
          if (card.id === VOID_IDS.WALKER) {
            if (handIds.includes(VOID_IDS.CONJURER)) {
              comboBoost -= 3.0; // Conjurer recruta Walker do deck
            } else if (handIds.includes(VOID_IDS.HOLLOW)) {
              // Walker + Hollow é bom combo se tem payoff
              const hasPayoff =
                swarmPayoffs.hasBossPayoff || swarmPayoffs.hasFusionPayoff;
              comboBoost += hasPayoff ? 2.5 : 1.0;
            } else {
              const otherVoidsInHand = (bot.hand || []).filter(
                (c) =>
                  isVoid(c) && c.id !== VOID_IDS.WALKER && (c.level || 0) <= 4,
              ).length;
              if (otherVoidsInHand > 0) {
                comboBoost += 0.5;
              }
            }
          }

          const position = chooseVoidSummonPosition(card, opponent);
          actions.push({
            type: "summon",
            index,
            cardId: card.id,
            cardName: card.name,
            position,
            facedown: position === "defense",
            priority: summonDecision.priority + comboBoost,
          });
        }

        // ─────────────────────────────────────────────────────────────────────
        // HAND IGNITION (com sequenciamento)
        // ─────────────────────────────────────────────────────────────────────
        if (card.cardKind === "monster") {
          const hasHandIgnition = (card.effects || []).some(
            (e) => e && e.timing === "ignition" && e.requireZone === "hand",
          );
          if (hasHandIgnition) {
            const knowledge = getVoidCardKnowledge(card);
            let ignitionPriority = knowledge?.role === "boss" ? 7 : 5.5;

            // Haunter: prioriza se tem Hollows para tributar E se tem mais no GY
            if (card.id === VOID_IDS.HAUNTER) {
              if (hollowFieldCount >= 1) {
                ignitionPriority += 2.5;
                // Bônus extra se tem Haunter no GY (pode reviver Hollows depois)
                const haunterInGY = (bot.graveyard || []).some(
                  (c) => c?.id === VOID_IDS.HAUNTER,
                );
                if (haunterInGY) {
                  ignitionPriority += 1.0;
                }
              }
            }

            // Slayer Brute: prioriza se tem 2+ Voids E se queremos boss
            if (card.id === VOID_IDS.SLAYER_BRUTE) {
              if (voidFieldCount >= 2) {
                ignitionPriority += 2.5;
                // Extra se temos Poly para Berserker depois
                if (handIds.includes(VOID_IDS.POLYMERIZATION)) {
                  ignitionPriority += 1.5;
                }
              }
            }

            // Serpent Drake: prioriza baseado em quantos Hollows pode tributar
            if (card.id === VOID_IDS.SERPENT_DRAKE) {
              if (hollowFieldCount >= 1) {
                ignitionPriority += 1.5 + hollowFieldCount * 0.5;
              }
            }

            // Forgotten Knight
            if (card.id === VOID_IDS.FORGOTTEN_KNIGHT && voidFieldCount >= 1) {
              ignitionPriority += 1.5;
            }

            actions.push({
              type: "handIgnition",
              index,
              cardId: card.id,
              cardName: card.name,
              priority: ignitionPriority,
            });
          }
        }
      });
    }

    if (bot.spellTrap && bot.spellTrap.length > 0) {
      bot.spellTrap.forEach((card, index) => {
        if (!card || card.cardKind !== "spell") return;
        const effect = (card.effects || []).find(
          (e) => e.timing === "ignition",
        );
        if (!effect) return;
        if (!isSimulatedState) {
          const check = game.effectEngine?.checkOncePerTurn?.(
            card,
            bot,
            effect,
          );
          if (check?.ok === false) return;
        }

        // Avaliação específica para Gravitational Pull
        if (card.id === VOID_IDS.GRAVITATIONAL) {
          const evaluation = this.evaluateGravitationalPull(bot, opponent);
          if (!evaluation.shouldActivate) {
            // Não adicionar a ação se não for vantajoso
            return;
          }
          actions.push({
            type: "spellTrapEffect",
            zoneIndex: index,
            cardId: card.id,
            cardName: card.name,
            priority: evaluation.priority,
          });
          return;
        }

        actions.push({
          type: "spellTrapEffect",
          zoneIndex: index,
          cardId: card.id,
          cardName: card.name,
          priority: 5.5,
        });
      });
    }

    if (bot.fieldSpell && !isSimulatedState) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate",
      );
      if (effect) {
        // Verificar once per turn
        const check = game.effectEngine?.checkOncePerTurn?.(
          bot.fieldSpell,
          bot,
          effect,
        );
        if (check?.ok === false) {
          // Já usado neste turno, não gerar ação
        } else {
          // Verificar requireEmptyField
          if (effect.requireEmptyField && bot.field && bot.field.length > 0) {
            // Não pode ativar - tem monstros no campo
          } else {
            // Verificar se tem alvos válidos (para The Void, precisa de monstro no GY)
            let hasValidTargets = true;
            if (bot.fieldSpell.id === VOID_IDS.THE_VOID) {
              // The Void precisa de monstro Void level 4- no GY
              const validTargets = (bot.graveyard || []).filter(
                (c) =>
                  c?.cardKind === "monster" && isVoid(c) && (c.level || 0) <= 4,
              );
              hasValidTargets = validTargets.length > 0;
            }

            if (hasValidTargets) {
              actions.push({
                type: "fieldEffect",
                priority: 6,
                cardName: bot.fieldSpell.name,
              });
            }
          }
        }
      }
    }

    const positionActions = this.getPositionChangeActions(game, bot, opponent);
    if (positionActions.length > 0) {
      actions.push(...positionActions);
    }

    return this.sequenceActions(actions);
  }

  /**
   * Calcula boosts de prioridade para cartas baseado em combos detectados.
   * @param {Object} analysis - Análise do estado do jogo
   * @returns {Object} - Map de cardId -> boost
   */
  calculateComboBoosts(analysis) {
    const boosts = {};
    const readyCombos = analysis.readyCombos || [];

    for (const comboInfo of readyCombos) {
      const combo = comboInfo.combo;
      if (!combo) continue;

      // Boost para cartas que iniciam o combo
      if (combo.sequence && combo.sequence.length > 0) {
        const firstStep = combo.sequence[0];
        if (firstStep.cardId) {
          boosts[firstStep.cardId] =
            (boosts[firstStep.cardId] || 0) + combo.priority / 5;
        }
      }

      // Boost para materiais de fusão
      if (combo.fusion) {
        for (const materialId of combo.fusion.materials || []) {
          if (typeof materialId === "number") {
            boosts[materialId] = (boosts[materialId] || 0) + 0.5;
          }
        }
      }
    }

    return boosts;
  }

  /**
   * Avalia a oportunidade de fazer uma fusão.
   * @param {Object} analysis - Análise do estado do jogo
   * @returns {number} - Valor da fusão
   */
  evaluateFusionOpportunity(analysis) {
    const readyCombos = analysis.readyCombos || [];
    const fusionCombos = readyCombos.filter((c) => c.combo?.fusion);

    if (fusionCombos.length === 0) return 0;

    // Pegar a melhor fusão disponível
    const best = fusionCombos[0];
    return calculateFusionValue(best.combo.fusion.target, analysis);
  }

  sequenceActions(actions) {
    // Sequenciamento inteligente baseado em combos
    const sorted = actions.sort((a, b) => {
      // 1. Extra deck actions (fusão/ascensão) têm prioridade especial
      const extraA = a.extraDeck ? 1 : 0;
      const extraB = b.extraDeck ? 1 : 0;
      if (extraA !== extraB) return extraB - extraA;

      // 2. Dentro de mesma categoria, ordenar por prioridade
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;

      // 3. Desempate: preferir summons antes de spells (setup antes de payoff)
      if (priorityA === priorityB) {
        const typeOrder = {
          summon: 3,
          handIgnition: 2,
          spell: 1,
          position_change: 0,
        };
        return (typeOrder[b.type] || 0) - (typeOrder[a.type] || 0);
      }

      return priorityB - priorityA;
    });

    return sorted;
  }

  simulateMainPhaseAction(state, action) {
    if (!action) return state;
    switch (action.type) {
      case "summon": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        const tributeInfo = this.getTributeRequirementFor(card, player);
        const tributesNeeded = tributeInfo.tributesNeeded || 0;
        if (player.field.length < tributesNeeded) break;
        const tributeIndices = this.selectBestTributes(
          player.field,
          tributesNeeded,
          card,
        );
        tributeIndices.sort((a, b) => b - a);
        tributeIndices.forEach((idx) => {
          const t = player.field[idx];
          if (t) {
            player.graveyard.push(t);
            player.field.splice(idx, 1);
          }
        });
        player.hand.splice(action.index, 1);
        const newCard = { ...card };
        newCard.position = action.position || "attack";
        newCard.isFacedown = action.facedown || false;
        newCard.hasAttacked = false;
        newCard.attacksUsedThisTurn = 0;
        if (newCard.cardKind === "monster") {
          player.field.push(newCard);
          player.summonCount = (player.summonCount || 0) + 1;
        } else {
          player.graveyard.push(newCard);
        }
        break;
      }
      case "spell": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        player.hand.splice(action.index, 1);
        if (card.subtype === "field") {
          if (player.fieldSpell) player.graveyard.push(player.fieldSpell);
          player.fieldSpell = { ...card };
        } else if (card.subtype === "continuous" || card.subtype === "equip") {
          player.spellTrap = player.spellTrap || [];
          player.spellTrap.push({ ...card });
        } else {
          player.graveyard.push({ ...card });
        }
        break;
      }
      case "position_change": {
        const player = state.bot;
        const target = (player.field || []).find(
          (c) =>
            c &&
            (c.id === action.cardId ||
              (!action.cardId && c.name === action.cardName)),
        );
        if (!target) break;
        if (target.isFacedown) break;
        if (target.positionChangedThisTurn) break;
        if (target.hasAttacked) break;
        const newPosition =
          action.toPosition === "defense" ? "defense" : "attack";
        if (target.position === newPosition) break;
        target.position = newPosition;
        target.positionChangedThisTurn = true;
        target.cannotAttackThisTurn = newPosition === "defense";
        break;
      }
      default:
        break;
    }
    return state;
  }
}
