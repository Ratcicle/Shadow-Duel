// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/priorities.js
// Lógica de priorização: spell decisions, summon decisions, safety checks.
//
// RESOURCE CONSERVATION PATTERN:
// - Spells de buff ATK/combat (Battle Hymn, Rage) só ativam em Main Phase 1
// - Evita desperdiçar recursos em Main Phase 2 (pós-Battle)
// - Use analysis.phase para detectar timing apropriado
// ─────────────────────────────────────────────────────────────────────────────

import {
  CARD_KNOWLEDGE,
  isShadowHeartByName,
  isShadowHeart,
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
 * Decide se deve jogar uma spell.
 * @param {Object} card
 * @param {Object} analysis
 * @returns {SpellDecision}
 */
export function shouldPlaySpell(card, analysis) {
  const name = card.name;
  const knowledge = CARD_KNOWLEDGE[name];

  // Polymerization - Detecta TODAS as fusões viáveis
  if (name === "Polymerization") {
    const allCards = [...analysis.hand, ...analysis.field];
    const shMonsters = allCards.filter(
      (c) => isShadowHeartByName(c.name) && c.cardKind === "monster"
    );

    // Demon Dragon: Scale Dragon + Leviathan
    const hasScaleDragon = allCards.some(
      (c) => c.name === "Shadow-Heart Scale Dragon"
    );
    const hasLeviathan = allCards.some(
      (c) => c.name === "Shadow-Heart Leviathan"
    );
    if (hasScaleDragon && hasLeviathan) {
      return {
        yes: true,
        priority: 12,
        reason: "Fusion: Demon Dragon (3000 ATK, destroy 2)",
      };
    }

    // Armored Arctroth: 2 Shadow-Heart monsters
    if (shMonsters.length >= 2) {
      const materials = shMonsters.slice(0, 2);
      return {
        yes: true,
        priority: 11,
        reason: `Fusion: Armored Arctroth (2800 ATK) com ${materials[0].name}+${materials[1].name}`,
      };
    }

    // Apocalypse Dragon: 3 Shadow-Heart monsters
    if (shMonsters.length >= 3) {
      return {
        yes: true,
        priority: 13,
        reason: "Fusion: Apocalypse Dragon (3500 ATK, 3 materiais)",
      };
    }

    return {
      yes: false,
      reason: "Sem materiais suficientes (precisa 2+ Shadow-Heart monsters)",
    };
  }

  // Darkness Valley - Primeiro se tiver monstros Shadow-Heart
  if (name === "Darkness Valley") {
    if (analysis.fieldSpell) {
      return { yes: false, reason: "Já tenho field spell" };
    }
    const shMonsters = analysis.hand.filter(
      (c) => isShadowHeartByName(c.name) && c.type === "monster"
    );
    if (
      analysis.field.some((c) => isShadowHeartByName(c.name)) ||
      shMonsters.length > 0
    ) {
      return { yes: true, priority: 9, reason: "Vai buffar meus monstros" };
    }
    return { yes: false, reason: "Sem monstros Shadow-Heart para buffar" };
  }

  // Shadow-Heart Rage - Só com Scale Dragon sozinho
  if (name === "Shadow-Heart Rage") {
    // ⚠️ TIMING: Rage é buff de ATK - só útil antes da Battle Phase
    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: Battle Phase já passou (buff ATK inútil)",
      };
    }

    if (
      analysis.field.length === 1 &&
      analysis.field[0].name === "Shadow-Heart Scale Dragon"
    ) {
      return {
        yes: true,
        priority: 10,
        reason: "OTK potencial com Scale Dragon!",
      };
    }
    return { yes: false, reason: "Scale Dragon não está sozinho" };
  }

  // Shadow-Heart Infusion - Avaliação dinâmica de custo/benefício
  if (name === "Shadow-Heart Infusion") {
    if (analysis.hand.length < 3) {
      return { yes: false, reason: "Preciso de 2 cartas para descartar" };
    }
    const shInGY = analysis.graveyard.filter((c) => c.cardKind === "monster");
    if (shInGY.length === 0) {
      return { yes: false, reason: "Sem Shadow-Heart no GY para reviver" };
    }

    // Avaliar valor das cartas na mão (usando CARD_KNOWLEDGE)
    const handValues = analysis.hand
      .filter((c) => c.name !== "Shadow-Heart Infusion")
      .map((c) => ({
        card: c,
        value: CARD_KNOWLEDGE[c.name]?.value || 0,
      }))
      .sort((a, b) => a.value - b.value); // Menor valor primeiro

    // Avaliar valor do revival (melhor monstro no GY)
    const bestRevival = shInGY
      .sort((a, b) => {
        const valA = CARD_KNOWLEDGE[a.name]?.value || 0;
        const valB = CARD_KNOWLEDGE[b.name]?.value || 0;
        return valB - valA;
      })[0];
    const revivalValue = CARD_KNOWLEDGE[bestRevival.name]?.value || 0;

    // Precisamos descartar 1 carta. Pegar a de MENOR valor.
    const worstCard = handValues[0];
    const discardCost = worstCard.value;

    // Só ativar se o revival vale MAIS que o descarte
    // Bônus: cartas com "discard value" (Specter, Coward)
    const hasValueDiscard =
      worstCard.card.name === "Shadow-Heart Specter" ||
      worstCard.card.name === "Shadow-Heart Coward";
    const netValue = revivalValue - discardCost + (hasValueDiscard ? 1 : 0);

    if (netValue > 0) {
      return {
        yes: true,
        priority: hasValueDiscard ? 8 : 6,
        reason: `Reviver ${bestRevival.name} (val:${revivalValue}) > descartar ${worstCard.card.name} (val:${discardCost})`,
      };
    }

    return {
      yes: false,
      reason: `Revival ${bestRevival.name} (${revivalValue}) NÃO vale descartar ${worstCard.card.name} (${discardCost})`,
    };
  }

  // Shadow-Heart Covenant - Searcher genérico (custo: 800 LP)
  if (name === "Shadow-Heart Covenant") {
    // Prioridade MÁXIMA em T1-T2 para buscar peças antes de outras ações
    const turnCounter = analysis.game?.turnCounter || 0;
    const isEarlyGame = turnCounter <= 2;
    
    // Threshold reduzido: 1200 LP (800 custo + 400 margem mínima)
    if (analysis.lp <= 1200) {
      return {
        yes: false,
        reason: `LP crítico (${analysis.lp}) para pagar 800`,
      };
    }

    // Em T1-T2, SEMPRE ativar (priority 15 > Polymerization 12)
    // Garante buscar peças ANTES de fazer fusion
    if (isEarlyGame) {
      return {
        yes: true,
        priority: 15,
        reason: `T${turnCounter}: Buscar peça PRIMEIRO (setup ideal)`,
      };
    }

    // T3+: Priority normal (7), sem bloqueio por LP
    return { yes: true, priority: 7, reason: "Buscar peça chave do combo" };
  }

  // Shadow-Heart Battle Hymn - Buff em monstros Shadow-Heart
  if (name === "Shadow-Heart Battle Hymn") {
    // ⚠️ TIMING: Battle Hymn só é útil ANTES da Battle Phase
    // Se estamos em main2, já passou a battle phase - desperdiçar recurso!
    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: Battle Phase já passou (buff inútil)",
      };
    }

    const shOnField = analysis.field.filter((c) => isShadowHeartByName(c.name));

    if (shOnField.length === 0) {
      return { yes: false, reason: "Preciso de Shadow-Heart no campo" };
    }

    // Calcular potencial de dano com buff
    const totalATKBuff = shOnField.length * 500;
    const oppLP = analysis.oppLp || 8000;
    const currentATK = shOnField.reduce((sum, m) => sum + (m.atk || 0), 0);
    const buffedATK = currentATK + totalATKBuff;
    const canPushLethal = analysis.oppField.length === 0 && buffedATK >= oppLP;

    // Se pode fazer lethal com o buff, usar mesmo com 1 monstro
    if (canPushLethal) {
      return {
        yes: true,
        priority: 12,
        reason: `+${totalATKBuff} ATK total = ${buffedATK} ATK (LETHAL!)`,
      };
    }

    // Senão, exigir 2+ monstros para não desperdiçar
    if (shOnField.length >= 2) {
      const priority = totalATKBuff >= oppLP / 2 ? 8 : 5;
      return {
        yes: true,
        priority,
        reason: `+500 ATK para ${shOnField.length} monstros${
          totalATKBuff >= oppLP / 2 ? " (LETHAL PUSH)" : ""
        }`,
      };
    }

    return {
      yes: false,
      reason: "Preciso de 2+ Shadow-Heart no campo (ou lethal opportunity)",
    };
  }

  // Shadow-Heart Purge - Remoção
  if (name === "Shadow-Heart Purge") {
    if (analysis.oppField.length === 0) {
      return { yes: false, reason: "Oponente sem monstros (DESPERDÍCIO)" };
    }
    if (analysis.oppField.length > 0) {
      const strongestThreat = analysis.oppField.reduce(
        (max, c) => ((c.atk || 0) > (max.atk || 0) ? c : max),
        { atk: 0 }
      );
      // Prioridade baseada no threat
      const threatATK = strongestThreat.atk || 0;
      const priority = threatATK >= 2500 ? 9 : threatATK >= 2000 ? 7 : 5;
      return {
        yes: true,
        priority,
        reason: `Destruir ${
          strongestThreat.name || "ameaça"
        } (${threatATK} ATK)`,
      };
    }
    return { yes: false, reason: "Oponente sem monstros" };
  }

  // Shadow-Heart Shield - Proteção flexível (não só boss)
  if (name === "Shadow-Heart Shield") {
    // Verificar se há monstros face-up disponíveis
    const hasFaceUpMonsters = analysis.field.some(
      (c) => c.cardKind === "monster" && !c.isFacedown
    );

    if (!hasFaceUpMonsters) {
      return { yes: false, reason: "Sem monstros face-up para equipar" };
    }

    const hasBoss = analysis.field.some(
      (c) =>
        !c.isFacedown &&
        [
          "Shadow-Heart Scale Dragon",
          "Shadow-Heart Demon Arctroth",
          "Shadow-Heart Demon Dragon",
        ].includes(c.name)
    );

    const strongBody = analysis.field.some(
      (c) => !c.isFacedown && (c.atk || 0) >= 1800
    );

    const anyMonster = analysis.field.some(
      (c) => c.cardKind === "monster" && !c.isFacedown
    );

    if (hasBoss) {
      return { yes: true, priority: 5, reason: "Proteger boss com shield" };
    }

    if (strongBody) {
      return {
        yes: true,
        priority: 4,
        reason: "Proteger atacante/defensor >1800 ATK",
      };
    }

    if (anyMonster && analysis.oppField.some((m) => (m.atk || 0) > 0)) {
      return {
        yes: true,
        priority: 3,
        reason: "Proteger board pequeno de troca ruim",
      };
    }

    return { yes: false, reason: "Sem alvo útil para o shield" };
  }

  // The Shadow Heart - Comeback card (requer campo vazio)
  if (name === "The Shadow Heart") {
    // Só ativar se campo estiver vazio (requisito da carta)
    if (analysis.field.length > 0) {
      return { yes: false, reason: "Requer campo vazio para ativar" };
    }

    // Verificar se há Shadow-Heart no cemitério
    const shInGY = analysis.graveyard.filter(
      (c) => c.cardKind === "monster" && isShadowHeartByName(c.name)
    );

    if (shInGY.length === 0) {
      return { yes: false, reason: "Sem Shadow-Heart no GY para reviver" };
    }

    // Priorizar se há boss no cemitério
    const hasBossInGY = shInGY.some((c) =>
      [
        "Shadow-Heart Scale Dragon",
        "Shadow-Heart Demon Arctroth",
        "Shadow-Heart Leviathan",
        "Shadow-Heart Death Wyrm",
      ].includes(c.name)
    );

    const targetName = shInGY[0].name;
    const targetATK = shInGY[0].atk || 0;

    if (hasBossInGY) {
      return {
        yes: true,
        priority: 11,
        reason: `COMEBACK! Reviver ${targetName} (${targetATK} ATK) após board wipe`,
      };
    }

    // Se não há boss, mas há monstro médio/alto ATK, ainda vale
    if (targetATK >= 1800) {
      return {
        yes: true,
        priority: 9,
        reason: `Reviver ${targetName} (${targetATK} ATK) - recovery sólido`,
      };
    }

    // Monstro fraco só se não tiver outra opção
    return {
      yes: true,
      priority: 6,
      reason: `Reviver ${targetName} (última opção)`,
    };
  }

  // Spells genéricos com knowledge
  if (knowledge) {
    return {
      yes: true,
      priority: knowledge.priority || 3,
      reason: "Spell utilizável",
    };
  }

  return { yes: true, priority: 3, reason: "Spell genérica" };
}

/**
 * Decide se deve invocar um monstro.
 * @param {Object} card
 * @param {Object} analysis
 * @param {Object} tributeInfo - { tributesNeeded, alt }
 * @returns {SummonDecision}
 */
export function shouldSummonMonster(card, analysis, tributeInfo) {
  const name = card.name;
  const knowledge = CARD_KNOWLEDGE[name];

  // === SAFETY CHECK: Avaliar se é seguro summon em ATK ===
  const cardATK = card.atk || 0;
  const cardDEF = card.def || 0;
  const oppStrongestATK = analysis.oppField.reduce(
    (max, m) => Math.max(max, m.atk || 0),
    0
  );
  const oppHasThreats = analysis.oppField.length > 0;

  // Se oponente tem monstro mais forte, não summon em ATK (só se for extender/combo)
  const isSuicideSummon =
    oppHasThreats && cardATK < oppStrongestATK && cardATK > 0;
  const shouldDefensivePosition = isSuicideSummon && cardDEF >= cardATK;

  // Imp - Extender de alta prioridade
  if (name === "Shadow-Heart Imp") {
    const hasTarget = analysis.hand.some(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.type === "monster" &&
        (c.level || 0) <= 4 &&
        c.name !== "Shadow-Heart Imp"
    );
    if (hasTarget) {
      if (isSuicideSummon && !shouldDefensivePosition) {
        return {
          yes: false,
          reason: `Imp seria destruído por ${oppStrongestATK} ATK oponente`,
        };
      }
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 9,
        reason: "Extender para 2 corpos",
      };
    }
    if (isSuicideSummon) {
      return {
        yes: false,
        reason: `Imp 1500 ATK vs oponente ${oppStrongestATK} ATK = suicide`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 6,
      reason: "Beater de 1500",
    };
  }

  // Leviathan - Boss 2600 ATK com efeitos de burn
  if (name === "Shadow-Heart Leviathan") {
    if (tributeInfo.tributesNeeded > analysis.field.length) {
      return {
        yes: false,
        reason: `Requer ${tributeInfo.tributesNeeded} tributos (tenho ${analysis.field.length})`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 8,
      reason: "Boss 2600 ATK + burn damage",
    };
  }

  // Griffin - 2000 ATK, pode invocar sem tributo sob certas condições
  if (name === "Shadow-Heart Griffin") {
    // Griffin tem altTribute que permite invocar com menos tributos
    const actualTributes = tributeInfo.usingAlt
      ? tributeInfo.alt.tributes
      : tributeInfo.tributesNeeded;
    if (actualTributes > analysis.field.length) {
      return {
        yes: false,
        reason: `Requer ${actualTributes} tributos (tenho ${analysis.field.length})`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 7,
      reason: actualTributes === 0 ? "2000 ATK sem tributo!" : "2000 ATK",
    };
  }

  // Specter - Recursivo (adiciona do GY à mão)
  if (name === "Shadow-Heart Specter") {
    const hasGYTargets = analysis.graveyard.filter(
      (c) => isShadowHeartByName(c.name) && c.name !== "Shadow-Heart Specter"
    );
    if (hasGYTargets.length > 0) {
      return {
        yes: true,
        position: "attack",
        priority: 7,
        reason: "Recursão: adiciona Shadow-Heart do GY à mão",
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 5,
      reason: "1800 ATK (setup futuro para recursão)",
    };
  }

  // Void Mage - Searcher de spell/trap com prioridade alta
  if (name === "Shadow-Heart Void Mage") {
    // Prioridade alta T1 ou quando não temos spells-chave
    const hasKeySpells = analysis.hand.some((c) =>
      [
        "Darkness Valley",
        "Shadow-Heart Covenant",
        "Shadow-Heart Shield",
      ].includes(c.name)
    );
    const hasDarknessValley = (analysis.spellTrapZone || []).some(
      (c) => c.name === "Darkness Valley"
    );

    if (!hasDarknessValley && !hasKeySpells) {
      // Altíssima prioridade se não temos setup
      // SEMPRE face-up para disparar efeito de busca (on_event after_summon requires face-up)
      return {
        yes: true,
        position:
          isSuicideSummon && shouldDefensivePosition ? "defense" : "attack",
        facedown: false, // Force face-up to trigger search effect
        priority: 9,
        reason: "Buscar spell-chave (Darkness Valley/Covenant/Shield)",
      };
    }

    // Prioridade média se já temos spells
    if (isSuicideSummon) {
      return {
        yes: shouldDefensivePosition,
        position: "defense",
        facedown: false, // Still face-up if summoning for value
        priority: shouldDefensivePosition ? 5 : 0,
        reason: shouldDefensivePosition
          ? "Searcher em DEF"
          : "Void Mage seria destruído",
      };
    }

    return {
      yes: true,
      position: "attack",
      facedown: false, // Always face-up for search effect
      priority: 7,
      reason: "Searcher de spells + draw engine",
    };
  }

  // Scale Dragon - Boss principal
  if (name === "Shadow-Heart Scale Dragon") {
    if (tributeInfo.tributesNeeded <= analysis.field.length) {
      return {
        yes: true,
        position: "attack",
        priority: 10,
        reason: "Boss de 3000 ATK!",
      };
    }
  }

  // Demon Arctroth - Boss com remoção
  if (name === "Shadow-Heart Demon Arctroth") {
    if (
      tributeInfo.tributesNeeded <= analysis.field.length &&
      analysis.oppField.length > 0
    ) {
      // Verificar se já temos lethal com os monstros atuais
      const fieldMonsters = analysis.field.filter(
        (c) => c?.cardKind === "monster"
      );
      const totalCurrentATK = fieldMonsters.reduce(
        (sum, m) => sum + (m.atk || 0),
        0
      );
      const oppTotalDEF = analysis.oppField.reduce((sum, m) => {
        const isDefense = m.position === "defense";
        return sum + (isDefense ? m.def || 0 : m.atk || 0);
      }, 0);
      const potentialDamage = Math.max(0, totalCurrentATK - oppTotalDEF);

      // Se já temos lethal com o campo atual, não tributar desnecessariamente
      if (potentialDamage >= analysis.oppLp && fieldMonsters.length > 0) {
        return {
          yes: false,
          reason: `Já tenho lethal com campo atual (${potentialDamage} dano >= ${analysis.oppLp} LP)`,
        };
      }

      // Se tributos reduzem muito ATK, só invocar se realmente necessário
      const tributeATK = fieldMonsters
        .slice(0, tributeInfo.tributesNeeded)
        .reduce((sum, m) => sum + (m.atk || 0), 0);
      const summonATK = card.atk || 0;
      const atkLoss = tributeATK - summonATK;

      if (atkLoss > 1000) {
        // Perdendo muito ATK no trade, só vale se remove ameaça crítica
        const strongestThreat = analysis.oppField.reduce(
          (max, c) => ((c.atk || 0) > (max.atk || 0) ? c : max),
          { atk: 0 }
        );
        if ((strongestThreat.atk || 0) < 2000) {
          return {
            yes: false,
            reason: `Perderia ${atkLoss} ATK tributando, ameaça não é crítica`,
          };
        }
      }

      return {
        yes: true,
        position: "attack",
        priority: 9,
        reason: "Destruir monstro oponente + 2600 ATK",
      };
    }
  }

  // Griffin - Sem tributo se campo vazio
  if (name === "Shadow-Heart Griffin") {
    if (analysis.field.length === 0) {
      return {
        yes: true,
        position: "attack",
        priority: 8,
        reason: "2000 ATK sem tributo!",
      };
    }
  }

  // Gecko - Draw engine
  if (name === "Shadow-Heart Gecko") {
    if (analysis.field.some((c) => (c.atk || 0) >= 1800)) {
      if (isSuicideSummon) {
        return {
          yes: true,
          position: "defense",
          priority: 4,
          reason: "Draw engine (defesa por safety)",
        };
      }
      return {
        yes: true,
        position: "attack",
        priority: 5,
        reason: "Draw engine passivo",
      };
    }
  }

  // Specter - Recursão
  if (name === "Shadow-Heart Specter") {
    if (analysis.graveyard.length > 0) {
      if (isSuicideSummon && !shouldDefensivePosition) {
        return {
          yes: false,
          reason: `Specter 1500 ATK seria destruído por ${oppStrongestATK} ATK`,
        };
      }
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 5,
        reason: "Futuro recurso de GY",
      };
    }
  }

  // Abyssal Eel - CASO ESPECÍFICO (1600 ATK burn)
  if (name === "Shadow-Heart Abyssal Eel") {
    if (isSuicideSummon) {
      return {
        yes: false,
        reason: `Eel 1600 ATK vs oponente ${oppStrongestATK} ATK = perda de monstro + burn inútil`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 4,
      reason: "Beater 1600 + burn",
    };
  }

  // Monstro genérico
  const baseAtk = card.atk || 0;
  if (baseAtk >= 1500 && tributeInfo.tributesNeeded === 0) {
    if (isSuicideSummon) {
      if (shouldDefensivePosition) {
        return {
          yes: true,
          position: "defense",
          priority: 3,
          reason: `DEF ${cardDEF} vs oponente ${oppStrongestATK} ATK`,
        };
      }
      return {
        yes: false,
        reason: `${baseAtk} ATK vs oponente ${oppStrongestATK} ATK = suicide`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 4,
      reason: `Beater de ${baseAtk}`,
    };
  }

  if (
    tributeInfo.tributesNeeded > 0 &&
    tributeInfo.tributesNeeded <= analysis.field.length
  ) {
    return {
      yes: true,
      position: "attack",
      priority: 5,
      reason: `Tribute Summon de ${baseAtk}`,
    };
  }

  // Monstro fraco em defesa
  if (baseAtk < 1500) {
    return {
      yes: true,
      position: "defense",
      priority: 2,
      reason: "Defesa/material",
    };
  }

  return { yes: false, reason: "Não vale a pena agora" };
}

/**
 * Avalia melhor tributos para um Tribute Summon.
 * Menor valor = melhor tributo.
 * @param {Array} field
 * @param {number} tributesNeeded
 * @param {Object} [cardToSummon]
 * @returns {number[]} Índices dos monstros a tributar
 */
export function selectBestTributes(field, tributesNeeded, cardToSummon = null) {
  if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
    return [];
  }

  const monstersWithValue = field.map((monster, index) => {
    let value = 0;
    const knowledge = CARD_KNOWLEDGE[monster.name];

    // Valor base
    value += (monster.atk || 0) / 400;
    value += (monster.level || 0) * 0.15;

    // Monstros importantes: NÃO tributar
    if (knowledge?.role === "boss" || knowledge?.role === "fusion_boss")
      value += 20;
    if (monster.name === "Shadow-Heart Scale Dragon") value += 15;
    if (monster.name === "Shadow-Heart Demon Arctroth") value += 12; // Material de Ascensão
    if (monster.name === "Shadow-Heart Gecko") value += 3;
    if (monster.name === "Shadow-Heart Leviathan") value += 6;
    if (monster.name === "Shadow-Heart Death Wyrm") value += 8;

    // Materiais de Ascensão: EVITAR tributar (podem ascender)
    if (knowledge?.ascensionTarget) value += 10;

    // Specter é BOM tributo (ativa efeito)
    if (monster.name === "Shadow-Heart Specter") value -= 5;

    // Tokens são ótimos tributos
    if (monster.isToken || monster.name.includes("Token")) value -= 10;

    // Monstros que já atacaram valem menos
    if (monster.hasAttacked) value -= 2;

    return { monster, index, value };
  });

  monstersWithValue.sort((a, b) => a.value - b.value);
  return monstersWithValue.slice(0, tributesNeeded).map((t) => t.index);
}

/**
 * Calcula requisito de tributos para um card.
 * @param {Object} card
 * @param {Object} playerState
 * @returns {{ tributesNeeded: number, alt: Object|null }}
 */
export function getTributeRequirementFor(card, playerState) {
  let tributesNeeded = 0;
  if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
  else if (card.level >= 7 && card.level <= 8) tributesNeeded = 2;
  else if (card.level >= 9) tributesNeeded = card.requiredTributes || 3;

  // Alt tribute conditions
  const alt = card.altTribute;
  if (
    alt?.type === "no_tribute_if_empty_field" &&
    (playerState.field?.length || 0) === 0
  ) {
    tributesNeeded = 0;
  }

  return { tributesNeeded, alt };
}
