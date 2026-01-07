/**
 * fusionPriority.js
 * Sistema de prioridade para fusões - detecta quando fusão > jogadas defensivas
 * Baseado na análise: "Fusion boss stats > everything quando domina oponente"
 */

// Base de conhecimento de fusões Luminarch
const LUMINARCH_FUSIONS = {
  "Luminarch Megashield Barbarias": {
    materials: ["Luminarch Sanctum Protector", "Luminarch Aegisbearer"], // ou qualquer Lv5+ Luminarch
    stats: { atk: 2500, def: 3000 }, // Base stats (pode chegar 3300 ATK com switch effect)
    effects: ["LP gains doubled", "Switch position + 800 ATK boost"]
  }
  // Nota: Fortress Aegis é ASCENSION (não usa Polymerization), não está aqui
};

/**
 * Detecta se há oportunidade de fusão disponível (Poly + materiais corretos)
 * @param {Object} context - Contexto do jogo (hand, field, opponent, etc)
 * @returns {Array} - Lista de oportunidades de fusão [{fusion, materials, poly}]
 */
export function detectFusionOpportunities(context) {
  const { hand, field, opponent } = context;
  const opportunities = [];

  // Verificar se tem Polymerization na mão
  const poly = hand.find(c => c.name === "Polymerization");
  if (!poly) return opportunities;

  // Pool de materiais disponíveis (mão + campo)
  const availableCards = [...hand, ...field.filter(c => c.controller === "bot")];

  // Verificar cada fusão conhecida do Luminarch
  for (const fusionName in LUMINARCH_FUSIONS) {
    const fusionData = LUMINARCH_FUSIONS[fusionName];
    
    // Buscar materiais no pool disponível
    const foundMaterials = [];
    const requiredMaterials = [...fusionData.materials]; // cópia para não modificar original

    for (const card of availableCards) {
      const materialIndex = requiredMaterials.findIndex(mat => card.name === mat);
      if (materialIndex !== -1) {
        foundMaterials.push(card);
        requiredMaterials.splice(materialIndex, 1); // remove material encontrado
      }
      
      // Se encontrou todos os materiais, registrar oportunidade
      if (requiredMaterials.length === 0) {
        opportunities.push({
          fusionName,
          fusionData,
          materials: foundMaterials,
          poly,
          stats: fusionData.stats
        });
        break;
      }
    }
  }

  return opportunities;
}

/**
 * Calcula "power swing" - mudança no estado do board após fusão
 * Compara cenário atual vs cenário pós-fusão
 * @param {Object} opportunity - Oportunidade de fusão detectada
 * @param {Object} context - Contexto do jogo
 * @returns {Object} - { swing, details }
 */
export function calculatePowerSwing(opportunity, context) {
  const { opponent, field } = context;
  const { fusionData, materials } = opportunity;

  // === CENÁRIO ATUAL ===
  // ATK total disponível no campo atual
  const currentBoardATK = field
    .filter(c => c.controller === "bot" && c.cardKind === "monster")
    .reduce((sum, c) => sum + (c.atk || 0), 0);

  // Materiais que estão no campo contribuem para currentBoardATK
  const materialsOnField = materials.filter(m => field.includes(m));
  const currentMaterialATK = materialsOnField.reduce((sum, m) => sum + (m.atk || 0), 0);

  // === CENÁRIO PÓS-FUSÃO ===
  // ATK do boss de fusão
  const fusionATK = fusionData.stats?.atk || 0;

  // ATK total pós-fusão = (board atual - materiais usados) + fusão boss
  const postFusionBoardATK = (currentBoardATK - currentMaterialATK) + fusionATK;

  // Power swing = diferença de ATK total
  const atkSwing = postFusionBoardATK - currentBoardATK;

  // === AMEAÇAS DO OPONENTE ===
  const opponentThreats = opponent.field
    .filter(c => c.cardKind === "monster")
    .map(c => ({
      name: c.name,
      atk: c.position === "attack" ? (c.atk || 0) : 0,
      def: c.position === "defense" ? (c.isFacedown ? 1500 : (c.def || 0)) : 0,
      position: c.position
    }));

  const opponentMaxATK = Math.max(...opponentThreats.map(t => t.atk), 0);
  const opponentTotalATK = opponentThreats.reduce((sum, t) => sum + t.atk, 0);

  // === AVALIAÇÃO DE DOMINÂNCIA ===
  // Boss domina se:
  // 1. ATK do boss > maior ameaça do oponente (pode destruir tudo)
  // 2. ATK do boss sozinho >= 60% do ATK total do oponente
  const bossDominatesMaxThreat = fusionATK > opponentMaxATK;
  const bossDominatesBoard = opponentTotalATK === 0 || (fusionATK / opponentTotalATK) >= 0.6;
  const dominates = bossDominatesMaxThreat && bossDominatesBoard;

  // === REMOÇÕES POTENCIAIS ===
  // Quantos monstros do oponente o boss pode destruir em combate
  const potentialKills = opponentThreats.filter(t => 
    t.position === "attack" && fusionATK > t.atk
  ).length;

  return {
    swing: atkSwing,
    dominates,
    details: {
      currentBoardATK,
      postFusionBoardATK,
      fusionATK,
      atkSwing,
      opponentMaxATK,
      opponentTotalATK,
      potentialKills,
      bossDominatesMaxThreat,
      bossDominatesBoard,
      materialsUsed: materials.length,
      materialsFromField: materialsOnField.length
    }
  };
}

/**
 * Avalia se materiais são "expendable" (gastáveis) para fusão
 * Materiais são expendable quando:
 * 1. Já cumpriram seu papel (searcher que já buscou, tank pronto para ascensão)
 * 2. O upgrade de fusão é significativamente melhor (boss > material individual)
 * 3. Não há uso mais estratégico para o material (ex: Protector SS effect < fusão)
 * @param {Object} material - Carta material
 * @param {Object} opportunity - Oportunidade de fusão
 * @param {Object} context - Contexto do jogo
 * @returns {Boolean} - true se material é expendable
 */
export function isMaterialExpendable(material, opportunity, context) {
  const { fusionData } = opportunity;
  const fusionATK = fusionData.stats?.atk || 0;
  const materialATK = material.atk || 0;

  // Upgrade significativo: fusion boss tem 50%+ ATK que material
  const significantUpgrade = fusionATK >= materialATK * 1.5;

  // Sanctum Protector específico: SS effect (2800 DEF tank) < fusão (2500 ATK boss + LP doubling)
  if (material.name === "Luminarch Sanctum Protector") {
    // Se fusion é Barbarias, Protector é expendable mesmo sem usar effect
    if (opportunity.fusionName === "Luminarch Megashield Barbarias") {
      return true; // 2500 ATK boss + LP doubling > 2800 DEF tank
    }
  }

  // Aegisbearer específico: se está na mão, pode ir direto pra fusão sem summon
  if (material.name === "Luminarch Aegisbearer") {
    const { hand } = context;
    if (hand && hand.some(c => c.name === material.name)) {
      return true; // Não precisa summon primeiro, vai direto pra fusão
    }
  }

  // Regra geral: se upgrade é significativo, material é expendable
  return significantUpgrade;
}

/**
 * Decide se fusão deve ser priorizada sobre jogadas defensivas
 * Baseado na análise: "Fusion > Defense quando boss domina"
 * @param {Object} opportunity - Oportunidade de fusão
 * @param {Object} context - Contexto do jogo
 * @returns {Object} - { shouldPrioritize, priority, reason }
 */
export function shouldPrioritizeFusion(opportunity, context) {
  const powerSwing = calculatePowerSwing(opportunity, context);
  const { swing, dominates, details } = powerSwing;

  // Verificar se materiais são expendable
  const allMaterialsExpendable = opportunity.materials.every(mat => 
    isMaterialExpendable(mat, opportunity, context)
  );

  // === DECISÃO DE PRIORIDADE ===
  
  // Caso 1: Boss DOMINA + materiais expendable + swing positivo
  // → PRIORIDADE MÁXIMA (18-19)
  if (dominates && allMaterialsExpendable && swing >= 0) {
    return {
      shouldPrioritize: true,
      priority: 19,
      reason: `Fusion domina board (${details.fusionATK} ATK > ${details.opponentMaxATK} opp max), swing +${swing}, materiais expendable`
    };
  }

  // Caso 2: Boss domina mas swing negativo (perdendo ATK total)
  // → PRIORIDADE ALTA (17) se dominância compensa perda
  if (dominates && swing < 0 && details.fusionATK > details.opponentMaxATK) {
    return {
      shouldPrioritize: true,
      priority: 17,
      reason: `Boss domina ameaças (${details.fusionATK} > ${details.opponentMaxATK}) apesar de swing ${swing}`
    };
  }

  // Caso 3: Swing muito positivo (+800 ou mais) mesmo sem dominância total
  // → PRIORIDADE MÉDIA-ALTA (16)
  if (swing >= 800 && allMaterialsExpendable) {
    return {
      shouldPrioritize: true,
      priority: 16,
      reason: `Power swing significativo (+${swing}), materiais expendable`
    };
  }

  // Caso 4: Swing positivo mas sem dominância clara
  // → PRIORIDADE MÉDIA (14)
  if (swing > 0 && allMaterialsExpendable) {
    return {
      shouldPrioritize: true,
      priority: 14,
      reason: `Swing positivo (+${swing}), materiais expendable`
    };
  }

  // Caso 5: Fusão não vale a pena agora
  // → BAIXA PRIORIDADE (8-10) ou não priorizar
  return {
    shouldPrioritize: false,
    priority: 8,
    reason: `Swing insuficiente (${swing}), boss não domina, ou materiais não expendable`
  };
}

/**
 * Função principal: avalia todas as oportunidades de fusão e retorna a melhor
 * @param {Object} context - Contexto do jogo
 * @returns {Object|null} - Melhor oportunidade com decisão de prioridade, ou null
 */
export function evaluateFusionPriority(context) {
  const opportunities = detectFusionOpportunities(context);
  if (opportunities.length === 0) return null;

  // Avaliar cada oportunidade
  const evaluatedOpportunities = opportunities.map(opp => {
    const decision = shouldPrioritizeFusion(opp, context);
    const powerSwing = calculatePowerSwing(opp, context);
    return {
      ...opp,
      decision,
      powerSwing
    };
  });

  // Ordenar por prioridade (maior primeiro)
  evaluatedOpportunities.sort((a, b) => b.decision.priority - a.decision.priority);

  // Retornar melhor oportunidade (maior prioridade)
  const best = evaluatedOpportunities[0];
  
  // Log para debug
  if (best.decision.shouldPrioritize) {
    console.log(`[FusionPriority] ${best.fusionName}: Priority ${best.decision.priority} - ${best.decision.reason}`);
  }

  return best;
}
