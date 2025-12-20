import BaseStrategy from "./BaseStrategy.js";
import { cardDatabase } from "../../data/cards.js";

/**
 * Estratégia Shadow-Heart - IA avançada que pensa como um jogador humano experiente.
 *
 * FILOSOFIA DO ARQUÉTIPO SHADOW-HEART:
 * - Agressivo com monstros de alto ATK
 * - Sinergia através de tributos e efeitos de GY
 * - Boss principal: Shadow-Heart Scale Dragon (3000 ATK, recupera recursos)
 * - Fusion boss: Shadow-Heart Demon Dragon (3000 ATK, destrói 2 cartas)
 * - Suporte: Imp (special summon), Specter (recicla GY), Eel (burn + Leviathan)
 * - Field spell: Darkness Valley (+300 ATK para Shadow-Heart)
 */
export default class ShadowHeartStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);

    // Banco de conhecimento sobre cartas Shadow-Heart
    this.cardKnowledge = this.buildCardKnowledge();

    // Combos conhecidos
    this.knownCombos = this.buildComboDatabase();

    // Estado de análise atual
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  /**
   * Constrói o banco de conhecimento sobre cada carta Shadow-Heart
   */
  buildCardKnowledge() {
    return {
      // ===== MONSTROS =====
      "Shadow-Heart Scale Dragon": {
        role: "boss",
        priority: 10,
        summonCondition: "3_tributes",
        effect: "Ao destruir por batalha, recupera 1 Shadow-Heart do GY",
        synergies: ["Darkness Valley", "Shadow-Heart Rage", "Polymerization"],
        playPatterns: [
          "Invocar quando tiver 3 tributos disponíveis",
          "Proteger com Shadow-Heart Shield",
          "Usar Shadow-Heart Rage para 3700 ATK + 2 ataques",
          "Usar como material para Demon Dragon Fusion",
        ],
        value: 15,
      },
      "Shadow-Heart Demon Dragon": {
        role: "fusion_boss",
        priority: 12,
        summonCondition: "fusion_scale_dragon_plus_lv5",
        effect: "Ao ser Fusion Summoned, destrói 2 cartas do oponente",
        synergies: ["Polymerization", "Shadow-Heart Scale Dragon"],
        playPatterns: [
          "Fusion Summon quando oponente tem 2+ ameaças no campo",
          "Usar efeito de destruição para limpar backrow perigoso",
          "Se destruído, revive Scale Dragon do GY",
        ],
        value: 18,
      },
      "Shadow-Heart Demon Arctroth": {
        role: "boss",
        priority: 8,
        summonCondition: "2_tributes",
        effect: "Ao ser Tribute Summoned, destrói 1 monstro do oponente",
        synergies: ["Shadow-Heart Imp", "tributes"],
        playPatterns: [
          "Tribute Summon quando oponente tem monstro forte no campo",
          "Usar Imp + outro monstro como tributo",
          "Combina remoção com presença de 2600 ATK",
        ],
        value: 10,
      },
      "Shadow-Heart Griffin": {
        role: "beater",
        priority: 7,
        summonCondition: "no_tribute_if_empty_field",
        effect: "Sem tributo se campo vazio",
        synergies: ["comeback"],
        playPatterns: [
          "Invocar sem tributo quando perdendo",
          "Bom para abrir jogo ou recuperar",
          "2000 ATK sólido para nível 5",
        ],
        value: 7,
      },
      "Shadow-Heart Imp": {
        role: "extender",
        priority: 9,
        summonCondition: "normal",
        effect:
          "Ao ser Normal Summoned, Special Summon 1 Shadow-Heart lv4 ou menor da mão",
        synergies: [
          "Shadow-Heart Gecko",
          "Shadow-Heart Specter",
          "Shadow-Heart Coward",
          "tributes",
        ],
        playPatterns: [
          "Normal Summon para gerar 2 monstros no campo",
          "Usar para preparar Tribute Summon de Arctroth",
          "Combo: Imp → Gecko → Batalha → Draw",
          "Gera recursos para fusão",
        ],
        value: 8,
      },
      "Shadow-Heart Gecko": {
        role: "draw_engine",
        priority: 6,
        summonCondition: "normal",
        effect: "Se monstro oponente é destruído por batalha, compra 1",
        synergies: ["Shadow-Heart Imp", "atacadores fortes"],
        playPatterns: [
          "Manter no campo enquanto ataca com outros monstros",
          "Gera vantagem de cartas passivamente",
          "Bom alvo para Special Summon do Imp",
        ],
        value: 5,
      },
      "Shadow-Heart Specter": {
        role: "recursion",
        priority: 7,
        summonCondition: "normal",
        effect: "Se for pro GY, adiciona 1 Shadow-Heart do GY à mão",
        synergies: ["tributes", "Shadow-Heart Infusion", "discard"],
        playPatterns: [
          "Usar como tributo para recuperar boss do GY",
          "Descartar para Infusion e recuperar outro monstro",
          "Combo: Tributa Specter → Recupera Scale Dragon do GY",
        ],
        value: 6,
      },
      "Shadow-Heart Coward": {
        role: "discard_effect",
        priority: 5,
        summonCondition: "normal",
        effect:
          "Se descartado, corta ATK/DEF de 1 monstro oponente pela metade",
        synergies: ["Shadow-Heart Infusion", "discard costs"],
        playPatterns: [
          "Descartar para Infusion para debuffar ameaça do oponente",
          "Transforma desvantagem em remoção soft",
          "Permite que monstros mais fracos vençam batalhas",
        ],
        value: 4,
      },
      "Shadow-Heart Abyssal Eel": {
        role: "utility",
        priority: 6,
        summonCondition: "normal",
        effect:
          "Se atacado em DEF: 600 dano. Pode se enviar ao GY para Special Summon Leviathan",
        synergies: ["Shadow-Heart Leviathan", "burn"],
        playPatterns: [
          "Setar em defesa para bait de ataque + burn",
          "Usar efeito ignition para Special Summon Leviathan",
          "Não desperdiçar se não tiver Leviathan na mão",
        ],
        value: 5,
      },
      "Shadow-Heart Leviathan": {
        role: "beater_burn",
        priority: 6,
        summonCondition: "special_or_normal",
        effect:
          "Queima 500 ao destruir; 800 se destruído por batalha. Ótimo alvo para Eel ou extender de mão",
        synergies: ["Shadow-Heart Abyssal Eel", "burn", "OTK setups"],
        playPatterns: [
          "Special via Eel para pressionar imediatamente",
          "Atacar monstros fracos para garantir burn e limpar campo",
          "Se estiver em risco de destruição, trocar por remoção forçada do oponente",
        ],
        value: 6,
      },
      "Shadow-Heart Death Wyrm": {
        role: "hand_trap_boss",
        priority: 7,
        summonCondition: "special_from_hand_on_battle_destroy",
        effect:
          "Quick Effect: entra da mão quando Shadow-Heart é destruído por batalha",
        synergies: ["grind games", "tempo swing", "reposição de campo"],
        playPatterns: [
          "Segurar na mão como interrupção após trades desfavoráveis",
          "Aproveitar destruição de fodders (Imp/Gecko) para trazer 2400 ATK imediato",
          "Após entrar, usar para pressionar ou tributar para Arctroth se necessário",
        ],
        value: 7,
      },
      "Shadow-Heart Observer": {
        role: "special_summoner",
        priority: 6,
        summonCondition: "normal",
        effect:
          "Ao ser Normal Summoned, Special Summon monstro da mão com mesmo nível de monstro oponente lv4-",
        synergies: ["campo do oponente", "extender"],
        playPatterns: [
          "Usar quando oponente tem monstro lv4 ou menor",
          "Gera 2 corpos no campo para tribute/batalha",
        ],
        value: 5,
      },

      // ===== SPELLS =====
      Polymerization: {
        role: "fusion_enabler",
        priority: 10,
        playCondition: "scale_dragon_in_field_and_lv5_material",
        effect: "Fusion Summon Demon Dragon",
        synergies: ["Shadow-Heart Scale Dragon", "Shadow-Heart Demon Dragon"],
        playPatterns: [
          "Ativar quando Scale Dragon está no campo + material lv5+",
          "Destruir 2 cartas do oponente é game-changing",
          "Não usar se oponente tem backrow suspeito que pode negar",
        ],
        value: 12,
      },
      "Darkness Valley": {
        role: "field_spell",
        priority: 9,
        playCondition: "has_shadowheart_monsters",
        effect:
          "+300 ATK para todos Shadow-Heart. Destrói atacante se boss lv8+ é destruído",
        synergies: ["todos os monstros Shadow-Heart"],
        playPatterns: [
          "Ativar PRIMEIRO antes de summonar",
          "Transforma monstros medianos em ameaças",
          "Protege bosses de trades ruins",
        ],
        value: 8,
      },
      "Shadow-Heart Rage": {
        role: "combat_trick",
        priority: 7,
        playCondition: "scale_dragon_alone_on_field",
        effect: "Scale Dragon ganha 700 ATK/DEF e pode atacar 2x",
        synergies: ["Shadow-Heart Scale Dragon"],
        playPatterns: [
          "Usar durante Battle Phase com Scale Dragon sozinho",
          "3700 ATK com 2 ataques = OTK potential",
          "Guardar para turno de lethal",
        ],
        value: 7,
      },
      "Shadow-Heart Infusion": {
        role: "graveyard_revival",
        priority: 8,
        playCondition: "2_cards_in_hand_and_shadowheart_in_gy",
        effect: "Descarta 2, revive Shadow-Heart do GY",
        synergies: [
          "Shadow-Heart Specter",
          "Shadow-Heart Coward",
          "bosses no GY",
        ],
        playPatterns: [
          "Descartar Specter para recuperar 2 monstros (1 do efeito + 1 do Specter)",
          "Descartar Coward para debuffar oponente enquanto revive",
          "Reviver Scale Dragon ou Arctroth do GY",
        ],
        value: 7,
      },
      "Shadow-Heart Covenant": {
        role: "searcher",
        priority: 8,
        playCondition: "800_lp_available",
        effect: "Paga 800 LP, busca qualquer Shadow-Heart do deck",
        synergies: ["setup", "combos"],
        playPatterns: [
          "Buscar Imp para extender",
          "Buscar Scale Dragon se tiver tributos",
          "Buscar Infusion se tiver setup no GY",
        ],
        value: 6,
      },
      "Shadow-Heart Battle Hymn": {
        role: "combat_buff",
        priority: 5,
        playCondition: "has_shadowheart_monsters_on_field",
        effect: "+500 ATK para todos Shadow-Heart até fim do turno",
        synergies: ["múltiplos monstros", "batalha"],
        playPatterns: [
          "Usar antes de Battle Phase com 2+ monstros",
          "Stacka com Darkness Valley para +800 total",
        ],
        value: 4,
      },
      "Shadow-Heart Shield": {
        role: "protection",
        priority: 6,
        playCondition: "has_monster_to_protect",
        effect: "+500 ATK/DEF, indestrutível por batalha, custo 800 LP/turno",
        synergies: ["bosses", "proteção"],
        playPatterns: [
          "Equipar em Scale Dragon ou Arctroth",
          "Considerar custo de LP a longo prazo",
          "Bom se estiver ganhando e quer manter vantagem",
        ],
        value: 5,
      },
      "Shadow-Heart Purge": {
        role: "removal",
        priority: 7,
        playCondition: "opponent_has_monsters",
        effect: "Destrói 1 monstro oponente",
        synergies: ["remoção", "setup para ataque direto"],
        playPatterns: [
          "Remover ameaça antes de atacar",
          "Priorizar bosses do oponente",
          "Usar para abrir caminho para lethal",
        ],
        value: 6,
      },
    };
  }

  /**
   * Constrói banco de dados de combos conhecidos
   */
  buildComboDatabase() {
    return [
      {
        name: "Imp Extender",
        description:
          "Imp → Special Summon Gecko/Specter → 2 corpos para tribute ou batalha",
        requires: ["Shadow-Heart Imp", "Shadow-Heart lv4 ou menor na mão"],
        result: "2 monstros no campo",
        priority: 8,
      },
      {
        name: "Specter Tribute Loop",
        description:
          "Tributa Specter para boss → Specter recupera outro Shadow-Heart do GY",
        requires: [
          "Shadow-Heart Specter no campo",
          "Shadow-Heart no GY",
          "boss na mão",
        ],
        result: "Boss no campo + carta na mão",
        priority: 9,
      },
      {
        name: "Infusion Value",
        description:
          "Descarta Specter/Coward para Infusion → Efeitos dos descartados ativam",
        requires: [
          "Shadow-Heart Infusion",
          "Specter ou Coward na mão",
          "Shadow-Heart no GY",
        ],
        result: "Revive + efeito bônus do descartado",
        priority: 8,
      },
      {
        name: "Demon Dragon Fusion",
        description:
          "Polymerization com Scale Dragon + material lv5+ → Destrói 2 cartas",
        requires: [
          "Polymerization",
          "Shadow-Heart Scale Dragon",
          "Shadow-Heart lv5+",
        ],
        result: "Demon Dragon 3000 ATK + 2 destruições",
        priority: 10,
      },
      {
        name: "Scale Dragon OTK",
        description: "Scale Dragon sozinho + Rage → 3700 ATK com 2 ataques",
        requires: [
          "Shadow-Heart Scale Dragon sozinho no campo",
          "Shadow-Heart Rage",
        ],
        result: "7400 dano potencial",
        priority: 10,
      },
      {
        name: "Griffin Comeback",
        description: "Campo vazio → Griffin sem tributo → 2000 ATK imediato",
        requires: ["Shadow-Heart Griffin", "campo próprio vazio"],
        result: "Presença de 2000 ATK sem custo",
        priority: 7,
      },
      {
        name: "Darkness Valley Setup",
        description:
          "Ativar Darkness Valley → Summon monstros Shadow-Heart → Bônus de ATK",
        requires: ["Darkness Valley", "monstros Shadow-Heart"],
        result: "+300 ATK por monstro",
        priority: 8,
      },
    ];
  }

  /**
   * Analisa o estado atual do jogo e registra o processo de pensamento
   */
  analyzeGameState(game) {
    this.thoughtProcess = [];
    const bot = this.bot;
    const opponent = game.player;

    const analysis = {
      // Recursos próprios
      hand: bot.hand.map((c) => ({
        name: c.name,
        type: c.cardKind,
        level: c.level,
        atk: c.atk,
      })),
      field: bot.field.map((c) => ({
        name: c.name,
        atk: c.atk,
        position: c.position,
      })),
      graveyard: bot.graveyard.filter((c) => this.isShadowHeart(c)),
      fieldSpell: bot.fieldSpell?.name || null,
      lp: bot.lp,
      summonCount: bot.summonCount || 0,

      // Recursos do oponente
      oppField: opponent.field.map((c) => ({
        name: c.name,
        atk: c.atk,
        def: c.def,
        position: c.position,
        isFacedown: c.isFacedown,
      })),
      oppBackrow: opponent.spellTrap?.length || 0,
      oppHand: opponent.hand?.length || 0,
      oppLp: opponent.lp,

      // Avaliações
      canNormalSummon: bot.summonCount < 1,
      fieldCapacity: 5 - bot.field.length,
      threatsOnBoard: [],
      availableCombos: [],
      bestPlays: [],
    };

    // Identificar ameaças do oponente
    opponent.field.forEach((c) => {
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
    analysis.availableCombos = this.detectAvailableCombos(analysis);

    this.currentAnalysis = analysis;
    return analysis;
  }

  /**
   * Registra um pensamento no processo de análise
   */
  think(thought) {
    this.thoughtProcess.push(thought);
    console.log(`[Shadow-Heart AI] ${thought}`);
  }

  /**
   * Detecta combos disponíveis com os recursos atuais
   */
  detectAvailableCombos(analysis) {
    const available = [];
    const handNames = analysis.hand.map((c) => c.name);
    const fieldNames = analysis.field.map((c) => c.name);
    const gyNames = analysis.graveyard.map((c) => c.name);

    // Imp Extender
    if (handNames.includes("Shadow-Heart Imp") && analysis.canNormalSummon) {
      const targets = analysis.hand.filter(
        (c) =>
          this.isShadowHeartByName(c.name) &&
          c.type === "monster" &&
          (c.level || 0) <= 4 &&
          c.name !== "Shadow-Heart Imp"
      );
      if (targets.length > 0) {
        available.push({
          name: "Imp Extender",
          priority: 8,
          action: { type: "summon", cardName: "Shadow-Heart Imp" },
        });
        this.think(`💡 Combo detectado: Imp Extender com ${targets[0].name}`);
      }
    }

    // Demon Dragon Fusion
    if (handNames.includes("Polymerization")) {
      const hasScaleDragon =
        fieldNames.includes("Shadow-Heart Scale Dragon") ||
        handNames.includes("Shadow-Heart Scale Dragon");
      const hasLv5Material = [...analysis.hand, ...analysis.field].some(
        (c) =>
          this.isShadowHeartByName(c.name) &&
          c.type === "monster" &&
          (c.level || 0) >= 5 &&
          c.name !== "Shadow-Heart Scale Dragon"
      );

      if (hasScaleDragon && hasLv5Material) {
        available.push({
          name: "Demon Dragon Fusion",
          priority: 10,
          action: { type: "spell", cardName: "Polymerization" },
        });
        this.think(`🔥 Combo detectado: Fusion para Demon Dragon!`);
      }
    }

    // Scale Dragon OTK
    if (
      fieldNames.includes("Shadow-Heart Scale Dragon") &&
      analysis.field.length === 1 &&
      handNames.includes("Shadow-Heart Rage")
    ) {
      available.push({
        name: "Scale Dragon OTK",
        priority: 10,
        action: { type: "spell", cardName: "Shadow-Heart Rage" },
      });
      this.think(`🔥 Combo detectado: Scale Dragon OTK (3700 ATK x2)!`);
    }

    // Griffin Comeback
    if (
      handNames.includes("Shadow-Heart Griffin") &&
      analysis.field.length === 0 &&
      analysis.canNormalSummon
    ) {
      available.push({
        name: "Griffin Comeback",
        priority: 7,
        action: { type: "summon", cardName: "Shadow-Heart Griffin" },
      });
      this.think(`💡 Combo detectado: Griffin sem tributo`);
    }

    // Infusion Value
    if (
      handNames.includes("Shadow-Heart Infusion") &&
      analysis.hand.length >= 3 &&
      analysis.graveyard.some((c) => c.cardKind === "monster")
    ) {
      const hasValueDiscard =
        handNames.includes("Shadow-Heart Specter") ||
        handNames.includes("Shadow-Heart Coward");
      available.push({
        name: "Infusion Revival",
        priority: hasValueDiscard ? 8 : 6,
        action: { type: "spell", cardName: "Shadow-Heart Infusion" },
      });
      this.think(
        `💡 Combo detectado: Infusion ${
          hasValueDiscard ? "com valor extra" : ""
        }`
      );
    }

    // Darkness Valley Setup
    if (handNames.includes("Darkness Valley") && !analysis.fieldSpell) {
      available.push({
        name: "Darkness Valley Setup",
        priority: 8,
        action: { type: "spell", cardName: "Darkness Valley" },
      });
      this.think(`💡 Field Spell disponível: Darkness Valley`);
    }

    return available;
  }

  /**
   * Avalia o tabuleiro com análise profunda
   */
  evaluateBoard(gameOrState, perspectivePlayer) {
    const opponent = this.getOpponent(gameOrState, perspectivePlayer);
    const perspective = perspectivePlayer.id
      ? perspectivePlayer
      : gameOrState.bot;

    let score = 0;

    // === AVALIAÇÃO DE LP ===
    const lpDiff = perspective.lp - opponent.lp;
    score += lpDiff / 600; // Peso maior para diferença de LP

    // Bônus por estar perto de vencer
    if (opponent.lp <= 3000) score += 2;
    if (opponent.lp <= 1500) score += 3;

    // Penalidade por estar em perigo
    if (perspective.lp <= 2000) score -= 1;
    if (perspective.lp <= 1000) score -= 2;

    // === AVALIAÇÃO DE CAMPO ===
    for (const monster of perspective.field) {
      score += this.evaluateMonster(monster, perspective, opponent);
    }

    for (const monster of opponent.field) {
      score -= this.evaluateMonster(monster, opponent, perspective) * 0.9;
    }

    // === AVALIAÇÃO DE FIELD SPELL ===
    if (perspective.fieldSpell) {
      if (perspective.fieldSpell.name === "Darkness Valley") {
        const shCount = perspective.field.filter((m) =>
          this.isShadowHeart(m)
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
      (c) => this.isShadowHeart(c) && c.cardKind === "monster"
    );
    if (shInGY.length > 0) {
      // GY com targets é recurso potencial
      const bestATK = Math.max(...shInGY.map((c) => c.atk || 0));
      score += bestATK / 3000;
    }

    // === AVALIAÇÃO DE BACKROW ===
    score += (perspective.spellTrap?.length || 0) * 0.2;
    score -= (opponent.spellTrap?.length || 0) * 0.25; // Backrow oponente é ameaça

    // === AVALIAÇÃO DE PRESSÃO ===
    // Bônus por ter atacantes fortes prontos
    const readyAttackers = perspective.field.filter(
      (m) =>
        m.position === "attack" && !m.hasAttacked && !m.cannotAttackThisTurn
    );
    for (const attacker of readyAttackers) {
      // Pode atacar diretamente?
      if (opponent.field.length === 0) {
        score += (attacker.atk || 0) / 1500;
      }
      // Pode destruir algo?
      const canDestroy = opponent.field.some(
        (def) =>
          def.position === "attack" && (def.atk || 0) < (attacker.atk || 0)
      );
      if (canDestroy) score += 0.3;
    }

    return score;
  }

  /**
   * Avalia um monstro individual
   */
  evaluateMonster(monster, owner, opponent) {
    if (!monster) return 0;

    const knowledge = this.cardKnowledge[monster.name];
    let value = knowledge?.value || 0;

    // Valor base de stats
    const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
    const def = (monster.def || 0) + (monster.tempDefBoost || 0);
    const stat = monster.position === "defense" ? def : atk;
    value += stat / 800;
    value += (monster.level || 0) * 0.1;

    // Bônus Shadow-Heart
    if (this.isShadowHeart(monster)) {
      value += 0.5;

      // Bônus específicos
      if (monster.name === "Shadow-Heart Scale Dragon") value += 3;
      if (monster.name === "Shadow-Heart Demon Dragon") value += 4;
      if (monster.name === "Shadow-Heart Demon Arctroth") value += 2;
      if (monster.name === "Shadow-Heart Imp") value += 1; // Potencial de extender
      if (monster.name === "Shadow-Heart Gecko") value += 0.5; // Draw engine
      if (monster.name === "Shadow-Heart Leviathan") value += 1; // Burn + mid boss
      if (monster.name === "Shadow-Heart Death Wyrm") value += 1.5; // Hand trap swing
    }

    // Penalidades
    if (monster.cannotAttackThisTurn) value -= 0.5;
    if (monster.hasAttacked) value -= 0.2;

    // Bônus de proteção
    if (monster.battleIndestructible) value += 1;
    if (monster.mustBeAttacked) value += 0.5; // Taunt protege outros

    // Vulnerabilidade
    if (monster.position === "attack") {
      const canBeDestroyed = (opponent.field || []).some(
        (opp) =>
          opp.position === "attack" && (opp.atk || 0) > (monster.atk || 0)
      );
      if (canBeDestroyed) value -= 0.5;
    }

    return value;
  }

  /**
   * Gera ações de main phase com análise profunda
   */
  generateMainPhaseActions(game) {
    const analysis = this.analyzeGameState(game);
    const actions = [];
    const bot = this.bot;

    this.think(`\n🧠 Gerando ações possíveis...`);

    // === PRIORIDADE 1: COMBOS DE ALTA PRIORIDADE ===
    for (const combo of analysis.availableCombos.sort(
      (a, b) => b.priority - a.priority
    )) {
      this.think(
        `  📌 Considerando combo: ${combo.name} (prioridade ${combo.priority})`
      );
    }

    // === GERAR AÇÕES DE SPELL ===
    bot.hand.forEach((card, index) => {
      if (card.cardKind !== "spell") return;

      const check = game.effectEngine.canActivate(card, bot);
      if (!check.ok) return;

      const knowledge = this.cardKnowledge[card.name];
      const shouldPlay = this.shouldPlaySpell(card, analysis, knowledge);

      if (shouldPlay.yes) {
        this.think(`  ✅ Spell válida: ${card.name} - ${shouldPlay.reason}`);
        actions.push({
          type: "spell",
          index,
          priority: shouldPlay.priority,
          cardName: card.name,
        });
      } else {
        this.think(
          `  ❌ Spell descartada: ${card.name} - ${shouldPlay.reason}`
        );
      }
    });

    // === GERAR AÇÕES DE SUMMON ===
    if (analysis.canNormalSummon) {
      bot.hand.forEach((card, index) => {
        if (card.cardKind !== "monster") return;

        const tributeInfo = this.getTributeRequirementFor(card, bot);
        if (bot.field.length < tributeInfo.tributesNeeded) return;
        if (analysis.fieldCapacity <= 0) return;

        const knowledge = this.cardKnowledge[card.name];
        const shouldSummon = this.shouldSummonMonster(
          card,
          analysis,
          knowledge
        );

        if (shouldSummon.yes) {
          this.think(
            `  ✅ Summon válido: ${card.name} - ${shouldSummon.reason}`
          );
          actions.push({
            type: "summon",
            index,
            position: shouldSummon.position,
            facedown: shouldSummon.position === "defense",
            priority: shouldSummon.priority,
            cardName: card.name,
          });
        }
      });
    }

    // === EFEITOS DE CAMPO ===
    if (bot.fieldSpell) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate"
      );
      if (effect) {
        const check = game.effectEngine.checkOncePerTurn(
          bot.fieldSpell,
          bot,
          effect
        );
        if (check.ok) {
          actions.push({ type: "fieldEffect", priority: 5 });
        }
      }
    }

    return this.sequenceActions(actions);
  }

  /**
   * Decide se deve jogar uma spell
   */
  shouldPlaySpell(card, analysis, knowledge) {
    const name = card.name;

    // Polymerization - Só se tiver setup completo
    if (name === "Polymerization") {
      const hasScaleDragon =
        analysis.field.some((c) => c.name === "Shadow-Heart Scale Dragon") ||
        analysis.hand.some((c) => c.name === "Shadow-Heart Scale Dragon");
      const hasMaterial = [...analysis.hand, ...analysis.field].some(
        (c) =>
          this.isShadowHeartByName(c.name) &&
          c.level >= 5 &&
          c.name !== "Shadow-Heart Scale Dragon"
      );

      if (hasScaleDragon && hasMaterial) {
        return { yes: true, priority: 12, reason: "Setup de fusão completo!" };
      }
      return { yes: false, reason: "Falta Scale Dragon ou material lv5+" };
    }

    // Darkness Valley - Primeiro se tiver monstros Shadow-Heart
    if (name === "Darkness Valley") {
      if (analysis.fieldSpell) {
        return { yes: false, reason: "Já tenho field spell" };
      }
      const shMonsters = analysis.hand.filter(
        (c) => this.isShadowHeartByName(c.name) && c.type === "monster"
      );
      if (
        analysis.field.some((c) => this.isShadowHeartByName(c.name)) ||
        shMonsters.length > 0
      ) {
        return { yes: true, priority: 9, reason: "Vai buffar meus monstros" };
      }
      return { yes: false, reason: "Sem monstros Shadow-Heart para buffar" };
    }

    // Shadow-Heart Rage - Só com Scale Dragon sozinho
    if (name === "Shadow-Heart Rage") {
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

    // Shadow-Heart Infusion - Precisa de custo e target
    if (name === "Shadow-Heart Infusion") {
      if (analysis.hand.length < 3) {
        return { yes: false, reason: "Preciso de 2 cartas para descartar" };
      }
      const shInGY = analysis.graveyard.filter((c) => c.cardKind === "monster");
      if (shInGY.length === 0) {
        return { yes: false, reason: "Sem Shadow-Heart no GY para reviver" };
      }
      // Verificar se temos discards com valor
      const hasValueDiscard = analysis.hand.some(
        (c) =>
          c.name === "Shadow-Heart Specter" || c.name === "Shadow-Heart Coward"
      );
      return {
        yes: true,
        priority: hasValueDiscard ? 8 : 6,
        reason: `Reviver ${shInGY[0].name}`,
      };
    }

    // Shadow-Heart Covenant - Searcher genérico
    if (name === "Shadow-Heart Covenant") {
      if (analysis.lp < 1500) {
        return { yes: false, reason: "LP muito baixo para pagar 800" };
      }
      return { yes: true, priority: 7, reason: "Buscar peça chave do combo" };
    }

    // Shadow-Heart Battle Hymn - Só com múltiplos monstros
    if (name === "Shadow-Heart Battle Hymn") {
      const shOnField = analysis.field.filter((c) =>
        this.isShadowHeartByName(c.name)
      );
      if (shOnField.length >= 2) {
        return {
          yes: true,
          priority: 5,
          reason: `+500 ATK para ${shOnField.length} monstros`,
        };
      }
      return { yes: false, reason: "Preciso de 2+ Shadow-Heart no campo" };
    }

    // Shadow-Heart Purge - Remoção
    if (name === "Shadow-Heart Purge") {
      if (analysis.oppField.length > 0) {
        const strongestThreat = analysis.oppField.reduce(
          (max, c) => ((c.atk || 0) > (max.atk || 0) ? c : max),
          { atk: 0 }
        );
        return {
          yes: true,
          priority: 7,
          reason: `Destruir ${strongestThreat.name || "ameaça"}`,
        };
      }
      return { yes: false, reason: "Oponente sem monstros" };
    }

    // Shadow-Heart Shield - Proteção para boss
    if (name === "Shadow-Heart Shield") {
      const hasBoss = analysis.field.some((c) =>
        [
          "Shadow-Heart Scale Dragon",
          "Shadow-Heart Demon Arctroth",
          "Shadow-Heart Demon Dragon",
        ].includes(c.name)
      );
      if (hasBoss) {
        return { yes: true, priority: 6, reason: "Proteger meu boss" };
      }
      return { yes: false, reason: "Sem boss para proteger" };
    }

    // Spells genéricos
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
   * Decide se deve invocar um monstro
   */
  shouldSummonMonster(card, analysis, knowledge) {
    const name = card.name;
    const tributeInfo = this.getTributeRequirementFor(card, this.bot);

    // Imp - Extender de alta prioridade
    if (name === "Shadow-Heart Imp") {
      const hasTarget = analysis.hand.some(
        (c) =>
          this.isShadowHeartByName(c.name) &&
          c.type === "monster" &&
          (c.level || 0) <= 4 &&
          c.name !== "Shadow-Heart Imp"
      );
      if (hasTarget) {
        return {
          yes: true,
          position: "attack",
          priority: 9,
          reason: "Extender para 2 corpos",
        };
      }
      return {
        yes: true,
        position: "attack",
        priority: 6,
        reason: "Beater de 1500",
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
        return {
          yes: true,
          position: "attack",
          priority: 5,
          reason: "Futuro recurso de GY",
        };
      }
    }

    // Monstro genérico
    const baseAtk = card.atk || 0;
    if (baseAtk >= 1500 && tributeInfo.tributesNeeded === 0) {
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
   * Ordena ações por prioridade estratégica
   */
  sequenceActions(actions) {
    // Ordena por prioridade
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

  // ==================== HELPERS ====================

  isShadowHeart(card) {
    if (!card) return false;
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
      ? [card.archetype]
      : [];
    return archetypes.includes("Shadow-Heart");
  }

  isShadowHeartByName(name) {
    return name && name.startsWith("Shadow-Heart");
  }

  getOpponent(gameOrState, perspectivePlayer) {
    if (typeof gameOrState.getOpponent === "function") {
      return gameOrState.getOpponent(perspectivePlayer);
    }
    return gameOrState.player && perspectivePlayer?.id === "bot"
      ? gameOrState.player
      : gameOrState.bot;
  }

  getTributeRequirementFor(card, playerState) {
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

  selectBestTributes(field, tributesNeeded, cardToSummon) {
    if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
      return [];
    }

    // Avalia cada monstro - MENOR valor = melhor tributo
    const monstersWithValue = field.map((monster, index) => {
      let value = 0;
      const knowledge = this.cardKnowledge[monster.name];

      // Valor base
      value += (monster.atk || 0) / 400;
      value += (monster.level || 0) * 0.15;

      // Monstros importantes: NÃO tributar
      if (knowledge?.role === "boss" || knowledge?.role === "fusion_boss")
        value += 20;
      if (monster.name === "Shadow-Heart Scale Dragon") value += 15;
      if (monster.name === "Shadow-Heart Gecko") value += 3; // Draw engine
      if (monster.name === "Shadow-Heart Leviathan") value += 6; // burn beater
      if (monster.name === "Shadow-Heart Death Wyrm") value += 8; // hand trap boss

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

  simulateMainPhaseAction(state, action) {
    if (!action) return state;

    switch (action.type) {
      case "summon": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;

        const tributeInfo = this.getTributeRequirementFor(card, player);
        const tributeIndices = this.selectBestTributes(
          player.field,
          tributeInfo.tributesNeeded,
          card
        );

        // Remove tributos
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
        newCard.position = action.position;
        newCard.isFacedown = action.facedown;
        newCard.hasAttacked = false;
        newCard.attacksUsedThisTurn = 0;
        player.field.push(newCard);
        player.summonCount = (player.summonCount || 0) + 1;
        break;
      }
      case "spell": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        player.hand.splice(action.index, 1);
        const placedCard = { ...card };
        this.simulateSpellEffect(state, placedCard);
        const placement = this.placeSpellCard(state, placedCard);
        if (!placement.placed) {
          player.graveyard.push(placedCard);
        }
        break;
      }
      case "fieldEffect": {
        const player = state.bot;
        if (player.fieldSpell?.name === "Darkness Valley") {
          player.field.forEach((m) => {
            if (this.isShadowHeart(m)) {
              m.atk = (m.atk || 0) + 300;
            }
          });
        }
        break;
      }
    }

    return state;
  }

  simulateSpellEffect(state, card) {
    const player = state.bot;
    const opponent = state.player;

    switch (card.name) {
      case "Polymerization": {
        // Simula fusão
        const scaleIdx = player.field.findIndex(
          (c) => c.name === "Shadow-Heart Scale Dragon"
        );
        const materialIdx = player.field.findIndex(
          (c, i) =>
            i !== scaleIdx && this.isShadowHeart(c) && (c.level || 0) >= 5
        );

        if (scaleIdx !== -1) {
          player.graveyard.push(player.field[scaleIdx]);
          player.field.splice(scaleIdx, 1);
        }
        if (materialIdx !== -1 && materialIdx !== scaleIdx) {
          const adjustedIdx =
            materialIdx > scaleIdx ? materialIdx - 1 : materialIdx;
          player.graveyard.push(player.field[adjustedIdx]);
          player.field.splice(adjustedIdx, 1);
        }

        if (player.field.length < 5) {
          player.field.push({
            name: "Shadow-Heart Demon Dragon",
            atk: 3000,
            def: 3000,
            level: 10,
            position: "attack",
            hasAttacked: false,
            cardKind: "monster",
            archetypes: ["Shadow-Heart"],
          });
        }
        break;
      }
      case "Shadow-Heart Infusion": {
        if (player.hand.length >= 2 && player.field.length < 5) {
          const discards = player.hand.splice(0, 2);
          player.graveyard.push(...discards);

          const target = player.graveyard
            .filter((c) => this.isShadowHeart(c) && c.cardKind === "monster")
            .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];

          if (target) {
            const idx = player.graveyard.indexOf(target);
            player.graveyard.splice(idx, 1);
            target.position = "attack";
            target.cannotAttackThisTurn = true;
            player.field.push(target);
          }
        }
        break;
      }
      case "Darkness Valley": {
        player.fieldSpell = { ...card };
        player.field.forEach((m) => {
          if (this.isShadowHeart(m)) {
            m.atk = (m.atk || 0) + 300;
          }
        });
        break;
      }
      case "Shadow-Heart Purge": {
        const target = opponent.field
          .slice()
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
        if (target) {
          opponent.field.splice(opponent.field.indexOf(target), 1);
          opponent.graveyard.push(target);
        }
        break;
      }
      case "Shadow-Heart Battle Hymn": {
        player.field.forEach((m) => {
          if (this.isShadowHeart(m)) {
            m.atk = (m.atk || 0) + 500;
            m.tempAtkBoost = (m.tempAtkBoost || 0) + 500;
          }
        });
        break;
      }
      case "Shadow-Heart Rage": {
        const scale = player.field.find(
          (c) => c.name === "Shadow-Heart Scale Dragon"
        );
        if (scale && player.field.length === 1) {
          scale.atk = (scale.atk || 0) + 700;
          scale.def = (scale.def || 0) + 700;
          scale.extraAttacks = 1;
        }
        break;
      }
      case "Monster Reborn": {
        if (player.field.length >= 5) break;
        const pool = [...player.graveyard, ...opponent.graveyard];
        const best = pool
          .filter((c) => c.cardKind === "monster")
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
        if (best) {
          const grave = player.graveyard.includes(best)
            ? player.graveyard
            : opponent.graveyard;
          grave.splice(grave.indexOf(best), 1);
          best.position = "attack";
          player.field.push(best);
        }
        break;
      }
      case "Arcane Surge": {
        player.hand.push({ placeholder: true }, { placeholder: true });
        break;
      }
      case "Infinity Searcher": {
        player.hand.push({ placeholder: true });
        break;
      }
    }
  }
}
