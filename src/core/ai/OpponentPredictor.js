/**
 * OpponentPredictor.js — P2: Modelagem Leve do Oponente
 *
 * Estima qual ação o oponente provavelmente faria em resposta.
 * Não tenta prever em tempo real (seria game-breaking), mas identifica:
 * - Qual é o papel estratégico do oponente (agressivo, defensivo, gerador)
 * - Qual card ele prioriza (beater, remover, searcher)
 * - Se ele está em modo "pressão" ou "estabilize"
 *
 * Filosofia:
 * - Heurístico, não exato
 * - Baseado em: field composition, deck archetype, LP, threats in play
 * - Usado para "desconto de confiança" em plies futuros do minimax
 *
 * Entrada: game state + opponent player object
 * Saída: { strategy: "aggressive"|"defensive"|"generator", predictedMove: card, confidence: 0-1 }
 */

import { inferRole } from "./RoleAnalyzer.js";

const safeList = (list) => (Array.isArray(list) ? list.filter(Boolean) : []);
const shouldLogWarnings = (...states) =>
  !states.some((state) => state && state.debug === false);

/**
 * Identifica o arquétipo do oponente via field + hand
 */
function identifyOpponentArchetype(opponentState) {
  try {
    if (!opponentState) return "unknown";

    const hand = safeList(opponentState.hand);
    const field = safeList(opponentState.field);
    const graveyard = safeList(opponentState.graveyard);

    // Conta cartas por archetype usando o próprio campo declarado em cards.js.
    // Mais confiável que substring matching (Void deixava de ser detectado
    // porque o nome contém "Void" e a regra de Shadow-Heart casava antes).
    const counts = {};
    for (const card of [...hand, ...field, ...graveyard]) {
      if (!card) continue;
      const archetypes = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
          ? [card.archetype]
          : [];
      for (const arch of archetypes) {
        if (!arch) continue;
        counts[arch] = (counts[arch] || 0) + 1;
      }
    }

    let bestArch = null;
    let bestCount = 0;
    for (const [arch, count] of Object.entries(counts)) {
      if (count > bestCount) {
        bestArch = arch;
        bestCount = count;
      }
    }

    return bestArch || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Avalia o "estilo de jogo" do oponente
 * Retorna: "aggressive" | "defensive" | "generator" | "mixed"
 */
function assessOpponentPlaystyle(opponentState) {
  try {
    if (!opponentState) return "mixed";

    const field = safeList(opponentState.field);
    const hand = safeList(opponentState.hand);

    // Contadores
    let atkCount = 0;
    let defCount = 0;
    let attackerCount = 0;
    let defenderCount = 0;
    let searcherCount = 0;

    for (const card of field) {
      if (!card) continue;
      const role = inferRole(card);
      if (role === "extender" || role === "searcher") searcherCount++;
      if ((card.atk || 0) > (card.def || 0)) {
        attackerCount++;
        atkCount += card.atk || 0;
      } else {
        defenderCount++;
        defCount += card.def || 0;
      }
    }

    // Decisão baseada em composição
    if (attackerCount >= 2 && atkCount > 4000) {
      return "aggressive";
    } else if (defenderCount >= 2 && defCount > 4000) {
      return "defensive";
    } else if (searcherCount >= 2 || hand.length > 6) {
      return "generator";
    }

    return "mixed";
  } catch {
    return "mixed";
  }
}

/**
 * Prediz qual card o oponente provavelmente jogaria a seguir
 * Retorna: { card, role, confidence }
 */
function predictNextOppMove(opponentState, myState) {
  try {
    if (!opponentState || !opponentState.hand) {
      return { card: null, role: "unknown", confidence: 0 };
    }

    const hand = safeList(opponentState.hand);
    const myFieldThreats = safeList(myState?.field);

    // Scoring heurístico por prioridade
    const scoredCards = hand.map((card) => {
      if (!card) {
        return { card: null, role: "unknown", score: -Infinity };
      }
      let score = 0;
      const role = inferRole(card);

      // 1. Removals contra minhas ameaças
      if (role === "removal" && myFieldThreats.length > 0) {
        score += 3; // Alta prioridade se tenho muitos monstros
      }

      // 2. Searchers (engine, gerador de vantagem)
      if (role === "searcher" || role === "extender") {
        score += 2;
      }

      // 3. Attackers (agressivo)
      if (role === "beater") {
        score += 1;
      }

      // 4. Defensores (se oponente em LP baixo)
      if (role === "defender" && (opponentState.lp || 0) <= 4000) {
        score += 2;
      }

      return { card, role, score };
    });

    // Ordena por score
    const bestCandidate = scoredCards.sort((a, b) => b.score - a.score)[0];

    return {
      card: bestCandidate?.card || null,
      role: bestCandidate?.role || "unknown",
      confidence: bestCandidate ? Math.min(bestCandidate.score / 5, 1) : 0,
    };
  } catch {
    return { card: null, role: "unknown", confidence: 0 };
  }
}

/**
 * API Pública: Análise completa do oponente
 */
export function analyzeOpponent(opponentState, myState = null) {
  const logWarnings = shouldLogWarnings(opponentState, myState);
  try {
    if (!opponentState) {
      return {
        archetype: "unknown",
        playstyle: "mixed",
        nextMove: { card: null, role: "unknown", confidence: 0 },
        threat_level: 0,
      };
    }

    const archetype = identifyOpponentArchetype(opponentState);
    const playstyle = assessOpponentPlaystyle(opponentState);
    const nextMove = predictNextOppMove(opponentState, myState || {});

    // Threat level: quanto perigo o oponente representa?
    let threatLevel = 0;
    const field = safeList(opponentState.field);
    const fieldATK = field.reduce((sum, m) => sum + (m?.atk || 0), 0);
    const fieldSize = field.length;

    if (fieldSize >= 3 && fieldATK >= 5000) threatLevel = 3; // ALTA
    else if (fieldSize >= 2 || fieldATK >= 4000) threatLevel = 2; // MÉDIA
    else if (fieldSize >= 1) threatLevel = 1; // BAIXA
    else threatLevel = 0; // NENHUMA

    return {
      archetype,
      playstyle,
      nextMove,
      threat_level: threatLevel,
      field_power: fieldATK,
      field_size: fieldSize,
    };
  } catch (e) {
    if (logWarnings) {
      console.warn(`[OpponentPredictor] analyzeOpponent erro:`, e);
    }
    return {
      archetype: "unknown",
      playstyle: "mixed",
      nextMove: { card: null, role: "unknown", confidence: 0 },
      threat_level: 0,
    };
  }
}

/**
 * Helper: Estima quanto dano o oponente pode fazer em um turno
 */
export function estimateOppDamage(opponentState) {
  try {
    if (!opponentState) return 0;

    const field = opponentState.field || [];
    const totalATK = field.reduce((sum, m) => sum + (m.atk || 0), 0);

    // Assume ataque direto com todos (simplificação)
    return totalATK;
  } catch {
    return 0;
  }
}

/**
 * Helper: Estima turnosquanto para oponente dar lethal
 */
export function estimateTurnsToOppLethal(opponentState, myLP = 8000) {
  try {
    const damage = estimateOppDamage(opponentState);
    if (damage <= 0) return Infinity;

    const turnsNeeded = Math.ceil(myLP / damage);
    return Math.max(1, turnsNeeded);
  } catch {
    return Infinity;
  }
}
